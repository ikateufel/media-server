import { createError, readBody } from 'h3'
import { updateInboxWorkerSettings } from '../../utils/inboxWorker'
import { requireAdminToken } from '../../utils/requireAdmin'

export default defineEventHandler(async (event) => {
  requireAdminToken(event)
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Body JSON inválido.' })
  }
  try {
    return await updateInboxWorkerSettings(body)
  } catch (e: unknown) {
    throw createError({
      statusCode: 400,
      statusMessage: e instanceof Error ? e.message : String(e),
    })
  }
})
