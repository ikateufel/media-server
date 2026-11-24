import { createError, readBody } from 'h3'
import { runAutoTagsPipeline } from '../../utils/autoTagsPipeline'
import { getVideoMenuItems } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'

/**
 * Executa o mesmo pipeline que `npm run auto-tags` (scripts/tag-pipeline.ts).
 *
 * Body:
 *   { dryRun?: boolean, all?: boolean, session?: number, clearManual?: boolean, newOnly?: boolean }
 *
 * `all: true` → exporta todas as sessões; caso contrário `session` é obrigatório (índice 0..n-1).
 * `clearManual: true` → repassa `--all` ao passo de limpeza (apaga também tags manuais).
 * `newOnly: true` → não limpa tags; só importa para vídeos que ainda não têm nenhuma tag.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as {
    dryRun?: unknown
    all?: unknown
    session?: unknown
    clearManual?: unknown
    newOnly?: unknown
  } | null

  const items = getVideoMenuItems(config)
  if (!items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).',
    })
  }

  const dryRun = body?.dryRun === true || body?.dryRun === 'true' || body?.dryRun === 1
  const clearManual =
    body?.clearManual === true || body?.clearManual === 'true' || body?.clearManual === 1
  const newOnly = body?.newOnly === true || body?.newOnly === 'true' || body?.newOnly === 1
  const all = body?.all === true || body?.all === 'true' || body?.all === 1

  if (newOnly && clearManual) {
    throw createError({
      statusCode: 400,
      statusMessage: 'newOnly e clearManual não podem ser usados em conjunto.',
    })
  }

  const pipelineArgs: string[] = []
  if (dryRun) pipelineArgs.push('--dry-run')
  if (newOnly) pipelineArgs.push('--new-only')
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
    newOnly,
  }
})
