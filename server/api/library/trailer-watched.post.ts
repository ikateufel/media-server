import { createError, readBody } from 'h3'
import { resolveTrailerRelForTagMutation } from '../../utils/catalogTagMutation'
import {
  TRAILER_WATCHED_TAG_NAME,
  markTrailerWatched,
  unmarkTrailerWatched,
} from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/**
 * Marca/desmarca um trailer (preview) como "visto até ao fim".
 *
 * Diferente de `/api/library/completed` (que se refere ao vídeo full): esta marca
 * NÃO empurra o título para o fim da grelha nem o exclui do botão "trailer aleatório".
 * Serve apenas como indicador visual no catálogo.
 *
 * Body:
 *   { session: number, trailerRel: string, watched?: boolean }
 *
 * - `watched` omisso ou `true` → adiciona a tag `trailer-visto` (manual, sobrevive a `clear-tags`).
 * - `watched: false` → remove a tag.
 *
 * Resposta: { watched, trailerWatchedTagName, tags }
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const body = (await readBody(event)) as {
    session?: unknown
    trailerRel?: unknown
    watched?: unknown
  }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const trailerRelRaw = typeof body.trailerRel === 'string' ? body.trailerRel.trim() : ''
  const trailerRel = trailerRelRaw.replace(/\\/g, '/')
  const watched = body.watched === undefined ? true : Boolean(body.watched)

  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRel) {
    throw createError({
      statusCode: 400,
      statusMessage: 'session e trailerRel são obrigatórios.',
    })
  }

  const canonicalRel = await resolveTrailerRelForTagMutation(event, session, trailerRel)
  const tags = watched
    ? markTrailerWatched(session, canonicalRel)
    : unmarkTrailerWatched(session, canonicalRel)

  return { watched, trailerWatchedTagName: TRAILER_WATCHED_TAG_NAME, tags }
})
