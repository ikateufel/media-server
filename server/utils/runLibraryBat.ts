import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createError } from 'h3'
import { isVideoFileName } from '#shared/videoExtensions'

export type LibraryBatKind = 'trailers' | 'previews'

const LOG_CAP = 900_000

async function hasDirectVideoFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.some((e) => e.isFile() && isVideoFileName(e.name))
  } catch {
    return false
  }
}

/**
 * Mantém os .bat inalterados e escolhe onde chamar:
 * - raiz da biblioteca, se tiver vídeos diretos;
 * - cada subpasta de 1º nível com vídeos diretos.
 * Não desce além disso.
 */
async function computeBatRunRoots(libraryRoot: string): Promise<string[]> {
  const root = resolve(libraryRoot)
  const out: string[] = []
  if (await hasDirectVideoFiles(root)) out.push(root)

  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return out.length ? out : [root]
  }

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const low = e.name.toLowerCase()
    if (low === 'trailers' || low === 'preview') continue
    const sub = join(root, e.name)
    if (await hasDirectVideoFiles(sub)) out.push(sub)
  }

  return out.length ? out : [root]
}

/**
 * Executa `scripts/trailer.bat` ou `scripts/preview.bat` com `cwd` na raiz da biblioteca (vídeos na raiz, `trailers/`, `preview/`).
 * Só Windows (os .bat dependem de `cmd` e `ffmpeg-on-path.bat`).
 *
 * Usa caminhos absolutos “normais” (sem `\\?\` de `toNamespacedPath`): o `cmd.exe` como processo-filho
 * falha com `cwd` ou `/c` em formato estendido (mensagem de UNC / pasta inexistente).
 *
 * - `onSpawn(pid)` é chamado assim que o processo arranca (ou com `null` em caso de erro). Útil para cancelar via `process.kill(pid)`.
 * - `onLine(stream, line)` é chamado por cada linha não vazia (com `\r`/`\n` removidos). Permite streaming/progresso.
 */
export async function runLibraryBatInRoot(opts: {
  projectRoot: string
  libraryRoot: string
  kind: LibraryBatKind
  onSpawn?: (pid: number | null) => void
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Sincronização por trailer.bat / preview.bat só está disponível quando o servidor corre em Windows.',
    })
  }

  const batName = opts.kind === 'trailers' ? 'trailer.bat' : 'preview.bat'
  const scriptPathResolved = resolve(join(opts.projectRoot, 'scripts', batName))
  if (!existsSync(scriptPathResolved)) {
    throw createError({ statusCode: 500, statusMessage: `Script em falta: ${scriptPathResolved}` })
  }

  const cwdResolved = resolve(opts.libraryRoot)
  if (!existsSync(cwdResolved)) {
    throw createError({ statusCode: 400, statusMessage: `Pasta da biblioteca inexistente: ${cwdResolved}` })
  }

  const scriptPath = scriptPathResolved
  const cwd = cwdResolved

  /**
   * Não usar `call "path"` num único argumento: no Windows o Node escapa as aspas e o CMD vê
   * o caminho com aspas incorrectas ("não é reconhecido como comando interno").
   * `cmd /c` + caminho absoluto do .bat como último argv — o runtime trata de aspas se houver espaços.
   */
  return new Promise((resolvePromise, reject) => {
    const label = `[library-bat][${opts.kind}]`
    const child = spawn('cmd.exe', ['/d', '/s', '/c', scriptPath], {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    console.log(`${label} spawn pid=${child.pid ?? '?'}`, {
      scriptPath,
      cwd,
    })
    try {
      opts.onSpawn?.(child.pid ?? null)
    } catch {
      /* hook do utilizador não deve afundar o spawn */
    }

    let stdout = ''
    let stderr = ''
    let outCarry = ''
    let errCarry = ''

    const push = (buf: Buffer, which: 'out' | 'err') => {
      const s = buf.toString('utf8')
      if (which === 'out') {
        stdout += s
        if (stdout.length > LOG_CAP) stdout = '…\n' + stdout.slice(-LOG_CAP)
      } else {
        stderr += s
        if (stderr.length > LOG_CAP) stderr = '…\n' + stderr.slice(-LOG_CAP)
      }
    }

    const emitLine = (stream: 'stdout' | 'stderr', line: string) => {
      const trimmed = line.replace(/\r$/, '')
      if (!trimmed.trim()) return
      if (stream === 'stderr') console.warn(`${label}[${stream}] ${trimmed}`)
      else console.log(`${label}[${stream}] ${trimmed}`)
      try {
        opts.onLine?.(stream, trimmed)
      } catch {
        /* */
      }
    }

    const flushCarry = (carry: string, stream: 'stdout' | 'stderr') => {
      const t = carry.trim()
      if (!t) return ''
      emitLine(stream, t)
      return ''
    }

    const t0 = Date.now()
    const heartbeat = setInterval(() => {
      const sec = Math.round((Date.now() - t0) / 1000)
      console.log(`${label} a correr há ${sec}s (pid=${child.pid ?? '?'}) …`)
    }, 45_000)

    child.stdout?.on('data', (c: Buffer) => {
      push(c, 'out')
      outCarry += c.toString('utf8')
      const parts = outCarry.split(/\r?\n/)
      outCarry = parts.pop() ?? ''
      for (const line of parts) emitLine('stdout', line)
    })
    child.stderr?.on('data', (c: Buffer) => {
      push(c, 'err')
      errCarry += c.toString('utf8')
      const parts = errCarry.split(/\r?\n/)
      errCarry = parts.pop() ?? ''
      for (const line of parts) emitLine('stderr', line)
    })
    child.on('error', (e) => {
      clearInterval(heartbeat)
      console.error(`${label} spawn error`, e)
      reject(e)
    })
    child.on('close', (code) => {
      clearInterval(heartbeat)
      outCarry = flushCarry(outCarry, 'stdout')
      errCarry = flushCarry(errCarry, 'stderr')
      const exitCode = code ?? 1
      console.log(`${label} terminou exitCode=${exitCode} após ${Math.round((Date.now() - t0) / 1000)}s`)
      resolvePromise({ exitCode, stdout, stderr })
    })
  })
}

/** Executa o .bat na raiz e/ou subpastas de 1º nível (sem recursão profunda). */
export async function runLibraryBatForLibrary(opts: {
  projectRoot: string
  libraryRoot: string
  kind: LibraryBatKind
  onSpawn?: (pid: number | null) => void
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const roots = await computeBatRunRoots(opts.libraryRoot)
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  for (const targetRoot of roots) {
    opts.onLine?.('stdout', `[SCOPE] ${opts.kind} em ${targetRoot}`)
    const r = await runLibraryBatInRoot({
      ...opts,
      libraryRoot: targetRoot,
    })
    stdout += `\n[SCOPE:${targetRoot}]\n${r.stdout}`
    stderr += `\n[SCOPE:${targetRoot}]\n${r.stderr}`
    if (r.exitCode !== 0) exitCode = r.exitCode
  }

  return { exitCode, stdout, stderr }
}

export function tailText(s: string, max = 12_000): string {
  if (s.length <= max) return s
  return `… (${s.length} caracteres)\n` + s.slice(-max)
}
