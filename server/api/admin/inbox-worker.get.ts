import { loadInboxWorkerSettings, loadInboxWorkerState } from '../../utils/inboxWorkerStore'
import { getInboxWorkerPublicStatus } from '../../utils/inboxWorker'
import { requireAdminToken } from '../../utils/requireAdmin'

export default defineEventHandler(async (event) => {
  requireAdminToken(event)
  await loadInboxWorkerSettings()
  await loadInboxWorkerState()
  return getInboxWorkerPublicStatus()
})
