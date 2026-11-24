import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { readPreviewCovers } from '../../utils/previewCoverStore'

/** Capas escolhidas pelo utilizador: `{ covers: { "<session>|<rel>": slot } }`. */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  return { covers: await readPreviewCovers() }
})
