import { createError, readBody } from 'h3'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { startDuplicateScanJob, getActiveDuplicateScanJob } from '../../utils/duplicateScanJobs'

/**
 * POST /api/duplicates/scan — inicia job em background e devolve jobId.
 * Seguir com GET /api/duplicates/scan-status?jobId=
 */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const body = (await readBody(event).catch(() => null)) as {
    minScore?: unknown
    minSharedTags?: unknown
    session?: unknown
    maxGroups?: unknown
  } | null

  const minScoreRaw = typeof body?.minScore === 'number' ? body.minScore : Number(body?.minScore)
  const minSharedRaw =
    typeof body?.minSharedTags === 'number' ? body.minSharedTags : Number(body?.minSharedTags)
  const maxGroupsRaw =
    typeof body?.maxGroups === 'number' ? body.maxGroups : Number(body?.maxGroups)

  let session: number | null = null
  if (body?.session !== null && body?.session !== undefined && body?.session !== '') {
    const sessionRaw = typeof body.session === 'number' ? body.session : Number(body.session)
    if (Number.isFinite(sessionRaw) && sessionRaw >= 0) session = Math.floor(sessionRaw)
  }

  const active = getActiveDuplicateScanJob()
  if (active?.status === 'running') {
    return {
      ok: true,
      jobId: active.id,
      status: active.status,
      progress: active.progress,
      resumed: true,
    }
  }

  try {
    const snap = startDuplicateScanJob({
      minScore: Number.isFinite(minScoreRaw) ? minScoreRaw : undefined,
      minSharedTags: Number.isFinite(minSharedRaw) ? minSharedRaw : undefined,
      maxGroups: Number.isFinite(maxGroupsRaw) ? maxGroupsRaw : undefined,
      session,
    })
    return {
      ok: true,
      jobId: snap.id,
      status: snap.status,
      progress: snap.progress,
      resumed: false,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    throw createError({
      statusCode: 500,
      statusMessage: `Falha ao iniciar scan de duplicados: ${msg}`,
    })
  }
})
