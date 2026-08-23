import { createError, readBody } from 'h3'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import {
  isInRecentPlayback,
  normalizeTrailerRel,
  purgeRecentPlaybackTitle,
  pushRecentPlayback,
} from '../../utils/recentPlaybackDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/** POST /api/duplicates/destaque — { session, trailerRel } → { inDestaques } */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  const body = (await readBody(event).catch(() => null)) as {
    session?: unknown
    trailerRel?: unknown
  } | null
  const session = typeof body?.session === 'number' ? body.session : Number(body?.session)
  const trailerRel = normalizeTrailerRel(body?.trailerRel)
  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRel) {
    throw createError({ statusCode: 400, statusMessage: 'session e trailerRel são obrigatórios.' })
  }
  if (!trailerRel.startsWith('trailers/')) {
    throw createError({ statusCode: 400, statusMessage: 'trailerRel inválido.' })
  }
  const sess = Math.floor(session)
  const already = isInRecentPlayback(sess, trailerRel)
  if (already) {
    purgeRecentPlaybackTitle(sess, trailerRel)
    return { ok: true, inDestaques: false, trailerRel }
  }
  pushRecentPlayback(sess, trailerRel)
  return { ok: true, inDestaques: true, trailerRel }
})
