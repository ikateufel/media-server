import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { readItemCovers } from '../../utils/itemCoverStore'

/** Capas escolhidas para itens de listas: `{ covers: { "<listId>|<item>": { session, rel, slot } } }`. */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  return { covers: await readItemCovers() }
})
