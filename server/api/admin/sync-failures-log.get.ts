import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SyncFailuresLogPayload } from '../../utils/syncFailuresLog'
import { requireAdminToken } from '../../utils/requireAdmin'

const emptyPayload: SyncFailuresLogPayload = {
  savedAt: '',
  jobId: '',
  jobStatus: '',
  itemCount: 0,
  items: [],
}

/** Lê `data/sync-last-failures.json` gravado ao terminar um job trailers/previews. */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)

  const filePath = join(process.cwd(), 'data', 'sync-last-failures.json')
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as SyncFailuresLogPayload
    return {
      ...emptyPayload,
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      itemCount: Array.isArray(parsed.items) ? parsed.items.length : 0,
    }
  } catch {
    return { ...emptyPayload }
  }
})
