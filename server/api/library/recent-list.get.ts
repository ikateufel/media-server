import { readRecentPlaybackList } from '../../utils/recentPlaybackDb'

/** Estados actuais do pin «Recentes» (SQLite), para sincronizar o ícone olho no cliente. */
export default defineEventHandler(() => ({
  items: readRecentPlaybackList().map((r) => ({
    session: r.session,
    trailerRel: r.trailerRel,
  })),
}))
