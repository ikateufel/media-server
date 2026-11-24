import { createError, readBody } from 'h3'
import { runInboxWorkerTick } from '../../utils/inboxWorker'
import { loadInboxWorkerSettings, loadInboxWorkerState } from '../../utils/inboxWorkerStore'
import { requireAdminToken } from '../../utils/requireAdmin'

/**
 * Body: { action: 'run-now' }
 */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)
  await loadInboxWorkerSettings()
  await loadInboxWorkerState()

  const body = (await readBody(event).catch(() => null)) as { action?: unknown } | null
  const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : ''

  if (action === 'run-now') {
    return await runInboxWorkerTick({ force: true })
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Acção inválida. Use { "action": "run-now" }.',
  })
})
