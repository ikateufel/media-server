import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createError } from 'h3'

export type ShrinkSpeed = 1.25 | 1.5 | 2

export type ShrinkCodec = 'auto' | 'h264_nvenc' | 'libx264' | 'hevc_nvenc' | 'libx265'

export function normalizeShrinkCodec(raw: unknown): ShrinkCodec | null {
  const s = String(raw ?? 'auto').trim().toLowerCase()
  if (
    s === 'auto' ||
    s === 'h264_nvenc' ||
    s === 'libx264' ||
    s === 'hevc_nvenc' ||
    s === 'libx265'
  ) {
    return s
  }
  return null
}

/**
 * Executa `scripts/shrink_video.bat` para um ficheiro.
 * Caminho do vídeo via `VP_SHRINK_INPUT` (evita parênteses/espaços na linha de comando do cmd).
 */
export async function runShrinkBatForFile(opts: {
  projectRoot: string
  videoAbsolutePath: string
  height: number
  speed: ShrinkSpeed
  codec: ShrinkCodec
  force: boolean
  prioritizeSize: boolean
  onSpawn?: (pid: number | null) => void
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'shrink_video.bat só está disponível quando o servidor corre em Windows.',
    })
  }

  const videoPath = resolve(opts.videoAbsolutePath)
  if (!existsSync(videoPath)) {
    throw createError({ statusCode: 400, statusMessage: `Vídeo inexistente: ${videoPath}` })
  }

  const scriptPath = resolve(join(opts.projectRoot, 'scripts', 'shrink_video.bat'))
  if (!existsSync(scriptPath)) {
    throw createError({ statusCode: 500, statusMessage: `Script em falta: ${scriptPath}` })
  }

  const videoDir = dirname(videoPath)

  return new Promise((resolvePromise, reject) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', scriptPath], {
      cwd: videoDir,
      env: {
        ...process.env,
        VIDEO_PLAYER_ROOT: opts.projectRoot,
        VP_SHRINK_INPUT: videoPath,
        VP_SHRINK_HEIGHT: String(Math.floor(opts.height)),
        VP_SHRINK_SPEED: String(opts.speed),
        VP_SHRINK_CODEC: opts.codec,
        VP_SHRINK_FORCE: opts.force ? '1' : '0',
        VP_SHRINK_PRIORITIZE_SIZE: opts.prioritizeSize ? '1' : '0',
        USE_NVENC: '1',
        VP_SHRINK_FROM_SERVER: '1',
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
