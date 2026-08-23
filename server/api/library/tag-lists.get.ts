import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { readTagLists } from '../../utils/tagLists'

/** GET /api/library/tag-lists — listas para categorizar tags. */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  return await readTagLists()
})
