import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createError } from 'h3'
import type { TrailerBatParams } from '#shared/trailerParams'
import { trailerBatParamsToProcessEnv } from '#shared/trailerParams'

/**
 * Executa `scripts/trailer.bat` para um vídeo (reprocessar trailer).
 * Caminho via `VP_TRAILER_INPUT`; `VP_TRAILER_FORCE=1` substitui trailer existente.
 */
export async function runTrailerBatForFile(opts: {
  projectRoot: string
  videoAbsolutePath: string
  trailerParams?: TrailerBatParams
  onSpawn?: (pid: number | null) => void
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'trailer.bat só está disponível quando o servidor corre em Windows.',
    })
  }

  const videoPath = resolve(opts.videoAbsolutePath)
  if (!existsSync(videoPath)) {
    throw createError({ statusCode: 400, statusMessage: `Vídeo inexistente: ${videoPath}` })
  }

  const scriptPath = resolve(join(opts.projectRoot, 'scripts', 'trailer.bat'))
  if (!existsSync(scriptPath)) {
    throw createError({ statusCode: 500, statusMessage: `Script em falta: ${scriptPath}` })
  }

  const videoDir = dirname(videoPath)
  const paramEnv = opts.trailerParams ? trailerBatParamsToProcessEnv(opts.trailerParams) : {}

  return new Promise((resolvePromise, reject) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', scriptPath], {
      cwd: videoDir,
      env: {
        ...process.env,
        ...paramEnv,
        VIDEO_PLAYER_ROOT: opts.projectRoot,
        VP_TRAILER_INPUT: videoPath,
        VP_TRAILER_FORCE: '1',
        SKIP_PAUSE: '1',
        SystemRoot: process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows',
        windir: process.env.windir ?? process.env.SystemRoot ?? 'C:\\Windows',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
      opts.onSpawn?.(child.pid ?? null)
    } catch {
      /* */
    }

    let stdout = ''
    let stderr = ''
    let outCarry = ''
    let errCarry = ''

    const emitLines = (chunk: string, stream: 'stdout' | 'stderr') => {
      const carry = stream === 'stdout' ? outCarry : errCarry
      let combined = carry + chunk
      const parts = combined.split(/\r?\n/)
      const rest = parts.pop() ?? ''
      if (stream === 'stdout') outCarry = rest
      else errCarry = rest
      for (const line of parts) {
        const trimmed = line.replace(/\r$/, '')
        if (!trimmed.trim()) continue
        try {
          opts.onLine?.(stream, trimmed)
        } catch {
          /* */
        }
      }
    }

    child.stdout?.on('data', (c: Buffer) => {
      const s = c.toString('utf8')
      stdout += s
      emitLines(s, 'stdout')
    })
    child.stderr?.on('data', (c: Buffer) => {
      const s = c.toString('utf8')
      stderr += s
      emitLines(s, 'stderr')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const flush = (carry: string, stream: 'stdout' | 'stderr') => {
        const t = carry.trim()
        if (!t) return
        try {
          opts.onLine?.(stream, t)
        } catch {
          /* */
        }
      }
      flush(outCarry, 'stdout')
      flush(errCarry, 'stderr')
      resolvePromise({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}
