import { createError, readBody } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import { cancelEditorJob, getEditorJobSnapshot } from '../../utils/editorJobs'

export default defineEventHandler(async (event) => {
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as { jobId?: unknown } | null
  const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : ''
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "jobId" obrigatório.' })
  }
  const ok = cancelEditorJob(jobId)
  if (!ok) {
    const snap = getEditorJobSnapshot(jobId)
    if (!snap) {
      throw createError({ statusCode: 404, statusMessage: 'Job não encontrado.' })
    }
    return { ok: false, status: snap.status, reason: 'Job não está em execução.' }
  }
  return { ok: true }
})
