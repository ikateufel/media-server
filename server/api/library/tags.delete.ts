import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { createError, getQuery } from 'h3'
import { resolveTrailerRelForTagMutation } from '../../utils/catalogTagMutation'
import { getTagsForVideo, normalizeTagInput, removeTagFromVideo } from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const q = getQuery(event) as Record<string, unknown>
  const sessionRaw = q.session
  const session =
    typeof sessionRaw === 'number'
      ? sessionRaw
      : typeof sessionRaw === 'string'
        ? Number(sessionRaw)
        : NaN
  const trailerRelRaw = q.trailerRel
  const trailerRelIn =
    typeof trailerRelRaw === 'string' && !Array.isArray(trailerRelRaw)
      ? trailerRelRaw.trim().replace(/\\/g, '/')
      : ''
  const nameRaw = q.name
  const name = typeof nameRaw === 'string' && !Array.isArray(nameRaw) ? nameRaw : ''

  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRelIn || !name.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Query: session, trailerRel e name são obrigatórios.',
    })
  }

  if (!normalizeTagInput(name)) {
    throw createError({ statusCode: 400, statusMessage: 'Nome de tag inválido.' })
  }

  const requested = trailerRelIn
  const canonicalRel = await resolveTrailerRelForTagMutation(event, session, trailerRelIn)
  removeTagFromVideo(session, canonicalRel, name)
  removeTagFromVideo(session, requested, name)
  const tags = [
    ...new Set([...getTagsForVideo(session, requested), ...getTagsForVideo(session, canonicalRel)]),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return { tags, trailerRel: requested }
})
