import { createError, readBody } from 'h3'
import { getVideoMenuItems } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'
import { createSyncJob, type SyncJobKind } from '../../utils/syncJobs'

/**
 * Cria um job de sincronização (`trailer.bat` / `preview.bat`) e devolve o `jobId`
 * imediatamente. O cliente deve seguir com SSE (`/api/admin/sync-stream?jobId=...`)
 * ou polling (`/api/admin/sync-status?jobId=...`).
 *
 * Body:
 *   { kind: 'trailers' | 'previews' | 'both', session?: number, all?: boolean }
 *
 * `both` corre primeiro `trailer.bat` para todas as sessões pedidas e só depois
 * `preview.bat` (mesma ordem). Tudo num único job, com cancelamento atómico.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as {
    kind?: string
    session?: unknown
    all?: unknown
  } | null

  const kindRaw = String(body?.kind ?? '').toLowerCase()
  const kind: SyncJobKind | null =
    kindRaw === 'trailers' || kindRaw === 'trailer'
      ? 'trailers'
      : kindRaw === 'previews' || kindRaw === 'preview'
        ? 'previews'
        : kindRaw === 'both' || kindRaw === 'all'
          ? 'both'
          : null
  if (!kind) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Campo "kind" inválido: use "trailers", "previews" ou "both".',
    })
  }

  const items = getVideoMenuItems(config)
  if (!items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).',
    })
  }

  const all = body?.all === true || body?.all === 'true' || body?.all === 1
  let sessions: number[]
  if (all) {
    sessions = items.map((_, i) => i)
  } else {
    const session = Number(body?.session ?? NaN)
    if (!Number.isFinite(session) || session < 0 || session >= items.length) {
      throw createError({
        statusCode: 400,
        statusMessage: `Campo "session" obrigatório (0..${items.length - 1}) ou use { "all": true }.`,
      })
    }
    sessions = [Math.floor(session)]
  }

  const snap = createSyncJob({
    kind,
    projectRoot: process.cwd(),
    sessions,
    all,
    menu: items,
  })

  return {
    jobId: snap.id,
    kind: snap.kind,
    all: snap.all,
    totalSessions: snap.totalSessions,
    startedAt: snap.startedAt,
  }
})
