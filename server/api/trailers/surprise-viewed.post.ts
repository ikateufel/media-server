import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { markActiveSurpriseBatchViewed } from '../../utils/surpriseDb'

/** Marca a lista Surpresa actual como vista — na próxima visita gera-se uma nova. */
export default defineEventHandler((event) => {
  requireCatalogUnlock(event)
  const ok = markActiveSurpriseBatchViewed()
  return { ok }
})
