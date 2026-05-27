import { createError, readBody } from 'h3'
import { resolveTrailerRelForTagMutation } from '../../utils/catalogTagMutation'
import {
  COMPLETED_TAG_NAME,
  markTrailerCompleted,
  unmarkTrailerCompleted,
} from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/**
 * Marca/desmarca um trailer como "concluído" (visto até ao fim na versão full).
 *
 * Body:
 *   { session: number, trailerRel: string, completed?: boolean }
 *
 * - `completed` omisso ou `true` → adiciona a tag `concluido` (manual, sobrevive a `npm run clear-tags`).
 * - `completed: false` → remove a tag.
 *
 * Resposta: { completed, completedTagName, tags }
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
    completed?: unknown
  }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const trailerRelRaw = typeof body.trailerRel === 'string' ? body.trailerRel.trim() : ''
  const trailerRel = trailerRelRaw.replace(/\\/g, '/')
  const completed = body.completed === undefined ? true : Boolean(body.completed)

  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRel) {
    throw createError({
      statusCode: 400,
      statusMessage: 'session e trailerRel são obrigatórios.',
    })
  }

  const canonicalRel = await resolveTrailerRelForTagMutation(event, session, trailerRel)
  const tags = completed
    ? markTrailerCompleted(session, canonicalRel)
    : unmarkTrailerCompleted(session, canonicalRel)

  return { completed, completedTagName: COMPLETED_TAG_NAME, tags }
})
