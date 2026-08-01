import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { readRecentPlaybackList } from '../../utils/recentPlaybackDb'

/** Estados actuais do pin «Recentes» (SQLite), para sincronizar o ícone olho no cliente. */
export default defineEventHandler((event) => {
  requireCatalogUnlock(event)
  return {
    items: readRecentPlaybackList().map((r) => ({
      session: r.session,
      trailerRel: r.trailerRel,
    })),
  }
})
