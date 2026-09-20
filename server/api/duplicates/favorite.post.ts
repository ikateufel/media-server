import { createError, readBody } from 'h3'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { toggleFavorite } from '../../utils/libraryState'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/** POST /api/duplicates/favorite — { session, trailerRel } → { isFavorite } */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  const body = (await readBody(event).catch(() => null)) as {
    session?: unknown
    trailerRel?: unknown
  } | null
  const session = typeof body?.session === 'number' ? body.session : Number(body?.session)
  const trailerRel =
    typeof body?.trailerRel === 'string' ? body.trailerRel.trim().replace(/\\/g, '/') : ''
  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRel) {
    throw createError({ statusCode: 400, statusMessage: 'session e trailerRel são obrigatórios.' })
  }
  const { isFavorite, favoritedAt } = await toggleFavorite(Math.floor(session), trailerRel)
  return { ok: true, isFavorite, favoritedAt }
})
