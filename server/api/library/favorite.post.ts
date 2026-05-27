import { createError, readBody } from 'h3'
import { resolveTrailerRelForTagMutation } from '../../utils/catalogTagMutation'
import { toggleFavorite } from '../../utils/libraryState'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  const body = (await readBody(event)) as { session?: unknown; trailerRel?: unknown }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const trailerRelRaw = typeof body.trailerRel === 'string' ? body.trailerRel : ''
  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRelRaw.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'session e trailerRel são obrigatórios.' })
  }
  const trailerRel = await resolveTrailerRelForTagMutation(event, session, trailerRelRaw)
  const isFavorite = await toggleFavorite(session, trailerRel)
  return { isFavorite }
})
