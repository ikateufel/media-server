import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createError } from 'h3'
import { formatCutsFile, type CutSegment } from './editorCuts'

export type EditorSpeed = 1 | 1.25 | 1.5 | 2

export function normalizeEditorSpeed(raw: unknown): EditorSpeed | null {
  const n = Number(raw)
  if (n === 1 || n === 1.25 || n === 1.5 || n === 2) return n
  return null
}

/**
 * Executa `scripts/edit_video.bat` para um ficheiro com trechos a manter.
 */
export async function runEditorBatForFile(opts: {
  projectRoot: string
  videoAbsolutePath: string
  keepSegments: CutSegment[]
  height: number
  speed: EditorSpeed
  force: boolean
  onSpawn?: (pid: number | null) => void
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'edit_video.bat só está disponível quando o servidor corre em Windows.',
    })
  }

  const videoPath = resolve(opts.videoAbsolutePath)
  if (!existsSync(videoPath)) {
    throw createError({ statusCode: 400, statusMessage: `Vídeo inexistente: ${videoPath}` })
  }

  if (!opts.keepSegments.length) {
    throw createError({ statusCode: 400, statusMessage: 'Nenhum trecho a exportar.' })
  }

  const scriptPath = resolve(join(opts.projectRoot, 'scripts', 'edit_video.bat'))
  if (!existsSync(scriptPath)) {
    throw createError({ statusCode: 500, statusMessage: `Script em falta: ${scriptPath}` })
  }

  const workDir = join(opts.projectRoot, 'data', 'bat-work', 'edit')
  await mkdir(workDir, { recursive: true })
  const cutsPath = join(workDir, `cuts-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(cutsPath, formatCutsFile(opts.keepSegments), 'utf8')

  const videoDir = dirname(videoPath)

  return new Promise((resolvePromise, reject) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', scriptPath], {
      cwd: videoDir,
      env: {
        ...process.env,
        VIDEO_PLAYER_ROOT: opts.projectRoot,
        VP_EDIT_INPUT: videoPath,
        VP_EDIT_CUTS: cutsPath,
        VP_EDIT_HEIGHT: String(Math.floor(opts.height)),
        VP_EDIT_SPEED: String(opts.speed),
        VP_EDIT_FORCE: opts.force ? '1' : '0',
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
      const combined = carry + chunk
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
