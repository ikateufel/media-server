import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createError, readBody } from 'h3'
import { getVideoMenuItems } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'

const OUTPUT_CAP_CHARS = 400_000

/** Evita spawn em `.cmd` no Windows (EINVAL com shell:false); usa o entrypoint .mjs do pacote. */
function resolveTsxCommand(projectRoot: string): { command: string; argvPrefix: string[] } {
  const cliMjs = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (existsSync(cliMjs)) {
    return { command: process.execPath, argvPrefix: [cliMjs] }
  }
  if (process.platform !== 'win32') {
    const bin = join(projectRoot, 'node_modules', '.bin', 'tsx')
    if (existsSync(bin)) {
      return { command: bin, argvPrefix: [] }
    }
  }
  return { command: 'tsx', argvPrefix: [] }
}

function runAutoTagsPipeline(
  projectRoot: string,
  pipelineArgs: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const { command, argvPrefix } = resolveTsxCommand(projectRoot)
    const script = join(projectRoot, 'scripts', 'tag-pipeline.ts')
    const child = spawn(command, [...argvPrefix, script, ...pipelineArgs], {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let stdoutTrunc = false
    let stderrTrunc = false

    const append = (target: 'out' | 'err', chunk: string) => {
      if (target === 'out') {
        const next = stdout + chunk
        if (next.length > OUTPUT_CAP_CHARS) {
          stdout = next.slice(-OUTPUT_CAP_CHARS)
          stdoutTrunc = true
        } else {
          stdout = next
        }
      } else {
        const next = stderr + chunk
        if (next.length > OUTPUT_CAP_CHARS) {
          stderr = next.slice(-OUTPUT_CAP_CHARS)
          stderrTrunc = true
        } else {
          stderr = next
        }
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => append('out', c))
    child.stderr?.on('data', (c: string) => append('err', c))
    child.on('error', reject)
    child.on('close', (code) =>
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        truncated: stdoutTrunc || stderrTrunc,
      }),
    )
  })
}

/**
 * Executa o mesmo pipeline que `npm run auto-tags` (scripts/tag-pipeline.ts).
 *
 * Body:
 *   { dryRun?: boolean, all?: boolean, session?: number, clearManual?: boolean }
 *
 * `all: true` → exporta todas as sessões; caso contrário `session` é obrigatório (índice 0..n-1).
 * `clearManual: true` → repassa `--all` ao passo de limpeza (apaga também tags manuais).
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as {
    dryRun?: unknown
    all?: unknown
    session?: unknown
    clearManual?: unknown
  } | null

  const items = getVideoMenuItems(config)
  if (!items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).',
    })
  }

  const dryRun = body?.dryRun === true || body?.dryRun === 'true' || body?.dryRun === 1
  const clearManual = body?.clearManual === true || body?.clearManual === 'true' || body?.clearManual === 1
  const all = body?.all === true || body?.all === 'true' || body?.all === 1

  const pipelineArgs: string[] = []
  if (dryRun) pipelineArgs.push('--dry-run')
  if (clearManual) pipelineArgs.push('--all')

  if (all) {
    // sem --session → exporta todas as sessões
  } else {
    const session = Number(body?.session ?? NaN)
    if (!Number.isFinite(session) || session < 0 || session >= items.length) {
      throw createError({
        statusCode: 400,
        statusMessage: `Campo "session" obrigatório (0..${items.length - 1}) ou use { "all": true }.`,
      })
    }
    pipelineArgs.push(`--session=${Math.floor(session)}`)
  }

  const projectRoot = process.cwd()
  let result: { exitCode: number; stdout: string; stderr: string; truncated: boolean }
  try {
    result = await runAutoTagsPipeline(projectRoot, pipelineArgs)
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    throw createError({
      statusCode: 500,
      statusMessage: `Falha ao iniciar o pipeline: ${err.message || String(e)}`,
    })
  }

  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
  }
})
