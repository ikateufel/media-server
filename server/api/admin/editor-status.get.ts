import { createError, getQuery } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import { getEditorJobSnapshot, getRunningEditorJobSnapshot } from '../../utils/editorJobs'

export default defineEventHandler((event) => {
  requireAdminToken(event)

  const q = getQuery(event) as Record<string, unknown>
  const jobId = typeof q.jobId === 'string' ? q.jobId.trim() : ''
  if (!jobId) {
    return {
      editorRunningJob: getRunningEditorJobSnapshot(),
    }
  }

  const snap = getEditorJobSnapshot(jobId)
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
