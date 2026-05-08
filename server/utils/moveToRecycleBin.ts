import { execFile } from 'node:child_process'
import { platform } from 'node:process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

function powershellExe(): string {
  const root = process.env.SystemRoot ?? process.env.windir
  return root ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe'
}

/** Aspas simples PowerShell: escapar com ''. */
function escapePsSingleQuoted(path: string): string {
  return path.replace(/'/g, "''")
}

/**
 * Layout compatível com `SHFILEOPSTRUCTW` em Win32 x64/x86:
 * - `BOOL` = int32 (não `bool` CLR de 1 byte)
 * - `lpszProgressTitle` = ponteiro (não `string`)
 *
 * Versões anteriores usavam `bool`/`string` e corrompiam offsets → falhas silenciosas ou sem mover ficheiros.
 */
function buildRecycleBinPsScript(paths: string[]): string {
  const quoted = paths.map((fp) => `'${escapePsSingleQuoted(fp)}'`).join(', ')
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
Add-Type -TypeDefinition @'
${csharp}
'@
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
function Move-OneFileToRecycleCom([string]$fullPath) {
  $shell = New-Object -ComObject Shell.Application
  # PS 5.1: Split-Path -LiteralPath -Parent dá AmbiguousParameterSet; Path API é literal-safe.
  $parent = [System.IO.Path]::GetDirectoryName($fullPath)
  $leaf = [System.IO.Path]::GetFileName($fullPath)
  if ([string]::IsNullOrEmpty($parent)) { throw "Caminho sem pasta pai: $fullPath" }
  $folder = $shell.Namespace($parent)
  if ($null -eq $folder) { throw "Shell.Namespace falhou para '$parent'" }
  $item = $folder.ParseName($leaf)
  if ($null -eq $item) { throw "Shell.ParseName falhou para '$leaf'" }
  $item.InvokeVerb('delete')
}
$paths = @(${quoted})
foreach ($p in $paths) {
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $fullPath = (Resolve-Path -LiteralPath $p).Path
  try {
    Move-OneFileToRecycleSh $fullPath
  } catch {
    # SHFileOperation falhou; se o ficheiro existir, tenta COM abaixo.
  }
  if (Test-Path -LiteralPath $fullPath) {
    Move-OneFileToRecycleCom $fullPath
  }
  if (Test-Path -LiteralPath $fullPath) {
    throw "Ficheiro ainda existe após Lixeira: $fullPath"
  }
}
`.trim()
}

function encodedPsCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Envia ficheiros para a Lixeira do SO.
 *
 * Windows: PowerShell + `SHFileOperation` (shell32, `FOF_ALLOWUNDO`), com fallback **COM**
 * `Shell.Application` + `InvokeVerb('delete')` se o primeiro método falhar (estruturas/PowerShell variam).
 *
 * macOS/Linux: pacote `trash`.
 */
export async function movePathsToRecycleBin(paths: string[]): Promise<void> {
  if (!paths.length) return

  if (platform === 'win32') {
    const psBin = powershellExe()
    const script = buildRecycleBinPsScript(paths)
    const enc = encodedPsCommand(script)
    await pExecFile(psBin, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc])
    return
  }

  const { default: trash } = await import('trash')
  await trash(paths, { glob: false })
}
