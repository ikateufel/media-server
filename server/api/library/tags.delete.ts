import { createError, getQuery } from 'h3'
import { normalizeTagInput, removeTagFromVideo } from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler((event) => {
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
  const trailerRel =
    typeof trailerRelRaw === 'string' && !Array.isArray(trailerRelRaw)
      ? trailerRelRaw.trim().replace(/\\/g, '/')
      : ''
  const nameRaw = q.name
  const name = typeof nameRaw === 'string' && !Array.isArray(nameRaw) ? nameRaw : ''

  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRel || !name.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Query: session, trailerRel e name são obrigatórios.',
    })
  }

  if (!normalizeTagInput(name)) {
    throw createError({ statusCode: 400, statusMessage: 'Nome de tag inválido.' })
  }

  const tags = removeTagFromVideo(session, trailerRel, name)
  return { tags }
})
