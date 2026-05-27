import { execFile } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

function powershellExe(): string {
  const root = process.env.SystemRoot ?? process.env.windir
  return root ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe'
}

async function writeRecyclePathList(paths: string[]): Promise<string> {
  const listPath = join(tmpdir(), `vp-recycle-${randomBytes(8).toString('hex')}.txt`)
  const body = paths
    .map((p) => p.trim().replace(/[\r\n]+/g, ''))
    .filter(Boolean)
    .join('\r\n')
  await writeFile(listPath, body, 'utf8')
  return listPath
}

/** Script PS: lista em ficheiro (env) + VB SendToRecycleBin; fallback SHFileOperation. */
function buildRecycleBinPsScript(): string {
  const csharp = `
using System;
using System.Runtime.InteropServices;
namespace RB {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ShFileOp {
    public IntPtr hwnd;
    public uint wFunc;
    public IntPtr pFrom;
    public IntPtr pTo;
    public ushort fFlags;
    private ushort pad_fFlags_;
    public int fAnyOperationsAborted;
    public IntPtr hNameMappings;
    public IntPtr lpszProgressTitle;
  }
  public static class ShellRecycle {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = false)]
    public static extern int SHFileOperation(ref ShFileOp lpFileOp);
  }
}
`.trim()

  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -TypeDefinition @'
${csharp}
'@

function Move-OneFileToRecycleVb([string]$fullPath) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
    $fullPath,
    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
  )
}

function Move-OneFileToRecycleSh([string]$fullPath) {
  $dn = [char]0 + [char]0
  $ptr = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($fullPath + $dn)
  try {
    $o = New-Object RB.ShFileOp
    $o.hwnd = [IntPtr]::Zero
    $o.wFunc = 3
    $o.pFrom = $ptr
    $o.pTo = [IntPtr]::Zero
    $o.fFlags = [ushort](64 + 16 + 4)
    $o.fAnyOperationsAborted = 0
    $o.hNameMappings = [IntPtr]::Zero
    $o.lpszProgressTitle = [IntPtr]::Zero
    $rc = [RB.ShellRecycle]::SHFileOperation([ref]$o)
    if ($rc -ne 0 -or $o.fAnyOperationsAborted -ne 0) {
      throw "SHFileOperation rc=$rc aborted=$($o.fAnyOperationsAborted)"
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
  }
}

function Move-OnePathToRecycle([string]$rawPath) {
  $p = [string]$rawPath.Trim()
  if ([string]::IsNullOrWhiteSpace($p)) { return }
  if (-not (Test-Path -LiteralPath $p)) { return }
  $fullPath = [string](Resolve-Path -LiteralPath $p).Path
  try {
    Move-OneFileToRecycleVb $fullPath
  } catch {
    Move-OneFileToRecycleSh $fullPath
  }
  if (Test-Path -LiteralPath $fullPath) {
    throw "Ficheiro ainda existe após Lixeira: $fullPath"
  }
}

$listPath = [string]$env:VP_RECYCLE_LIST
if ([string]::IsNullOrWhiteSpace($listPath) -or -not (Test-Path -LiteralPath $listPath)) {
  throw 'Lista de caminhos inválida (VP_RECYCLE_LIST).'
}

Get-Content -LiteralPath $listPath -Encoding UTF8 | ForEach-Object {
  Move-OnePathToRecycle -rawPath $_
}
`.trim()
}

function encodedPsCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Envia ficheiros para a Lixeira do SO.
 *
 * Windows: ficheiro temporário com caminhos (UTF-8) + PowerShell
 * (`Microsoft.VisualBasic` SendToRecycleBin, fallback `SHFileOperation`).
 *
 * macOS/Linux: pacote `trash`.
 */
export async function movePathsToRecycleBin(paths: string[]): Promise<void> {
  if (!paths.length) return

  if (platform === 'win32') {
    const listPath = await writeRecyclePathList(paths)
    const psBin = powershellExe()
    const script = buildRecycleBinPsScript()
    const enc = encodedPsCommand(script)
    try {
      await pExecFile(
        psBin,
        ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
        {
          env: { ...process.env, VP_RECYCLE_LIST: listPath },
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        },
      )
    } finally {
      await unlink(listPath).catch(() => {})
    }
    return
  }

  const { default: trash } = await import('trash')
  await trash(paths, { glob: false })
}
