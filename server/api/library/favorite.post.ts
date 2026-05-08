import { createError, readBody } from 'h3'
import { toggleFavorite } from '../../utils/libraryState'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as { session?: unknown; trailerRel?: unknown }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const trailerRel = typeof body.trailerRel === 'string' ? body.trailerRel : ''
  if (!Number.isFinite(session) || session < 0 || !trailerRel.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'session e trailerRel são obrigatórios.' })
  }
  const isFavorite = await toggleFavorite(session, trailerRel)
  return { isFavorite }
})
