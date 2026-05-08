import { createError, getQuery } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import { getJobSnapshot, getRunningSyncJobSnapshot, listRecentJobs } from '../../utils/syncJobs'

/**
 * Snapshot de um job (ou lista dos jobs recentes se `jobId` for omitido).
 *
 * Query:
 *   - jobId=<uuid>           → snapshot completo desse job
 *   - sinceSeq=<n>           → reduz `lines` a `seq > n` (útil para polling)
 *   - (sem jobId)            → `jobs`: recentes (até 30min após terminarem),
 *                               `syncRunningJob`: job global em execução no servidor (ou null)
 */
export default defineEventHandler((event) => {
  requireAdminToken(event)

  const q = getQuery(event) as Record<string, unknown>
  const jobId = typeof q.jobId === 'string' ? q.jobId.trim() : ''
  if (!jobId) {
    return {
      jobs: listRecentJobs(),
      syncRunningJob: getRunningSyncJobSnapshot(),
    }
  }

  const snap = getJobSnapshot(jobId)
  if (!snap) {
    throw createError({ statusCode: 404, statusMessage: 'Job não encontrado ou expirado.' })
  }

  const sinceSeqRaw = q.sinceSeq
  const sinceSeq =
    typeof sinceSeqRaw === 'string' || typeof sinceSeqRaw === 'number'
      ? Number(sinceSeqRaw)
      : NaN
  if (Number.isFinite(sinceSeq) && sinceSeq > 0) {
    return { ...snap, lines: snap.lines.filter((l) => l.seq > sinceSeq) }
  }
  return snap
})
