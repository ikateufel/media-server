import { createError, getQuery } from 'h3'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { getActiveDuplicateScanJob, getDuplicateScanJob } from '../../utils/duplicateScanJobs'

/** GET /api/duplicates/scan-status?jobId= — progresso / resultado do scan. */
export default defineEventHandler((event) => {
  requireCatalogUnlock(event)
  const q = getQuery(event) as Record<string, unknown>
  const jobId = typeof q.jobId === 'string' ? q.jobId.trim() : ''
  const snap = jobId ? getDuplicateScanJob(jobId) : getActiveDuplicateScanJob()
  if (!snap) {
    throw createError({ statusCode: 404, statusMessage: 'Job de scan não encontrado ou expirado.' })
  }
  return {
    ok: true,
    jobId: snap.id,
    status: snap.status,
    progress: snap.progress,
    error: snap.error,
    result: snap.status === 'done' ? snap.result : null,
    startedAt: snap.startedAt,
    endedAt: snap.endedAt,
  }
})
