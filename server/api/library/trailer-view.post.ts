import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { createError, readBody } from 'h3'
import { resolveTrailerRelForTagMutation } from '../../utils/catalogTagMutation'
import { pushTrailerViewHistory } from '../../utils/recentPlaybackDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/** Regista trailer reproduzido/seleccionado (lista «Últimos vistos»). */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Defina pastas em data/video-menu.json ou VIDEO_ROOT no .env.',
    })
  }

  const body = (await readBody(event).catch(() => null)) as {
    session?: unknown
    trailerRel?: unknown
  } | null
  const sessionRaw = body?.session
  const trailerRel = typeof body?.trailerRel === 'string' ? body.trailerRel : ''
  const session = typeof sessionRaw === 'number' ? sessionRaw : Number(sessionRaw ?? NaN)

  if (!Number.isFinite(session) || session < 0 || session >= roots.length) {
    throw createError({ statusCode: 400, statusMessage: 'session inválido' })
  }

  const canonicalRel = await resolveTrailerRelForTagMutation(event, Math.floor(session), trailerRel)
  pushTrailerViewHistory(Math.floor(session), canonicalRel)
  return { ok: true }
})
