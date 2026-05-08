import { createError, getQuery } from 'h3'
import { getTagsForVideo, listTagNamesForSession } from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'
import { parseSessionQuery } from '../../utils/videoSession'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const q = getQuery(event) as Record<string, unknown>
  const session = parseSessionQuery(q, roots.length)
  const trailerRelRaw = q.trailerRel
  const trailerRel =
    typeof trailerRelRaw === 'string' && !Array.isArray(trailerRelRaw)
      ? trailerRelRaw.trim().replace(/\\/g, '/')
      : ''

  if (trailerRel) {
    return {
      tags: getTagsForVideo(session, trailerRel),
      suggestions: listTagNamesForSession(session),
    }
  }

  return {
    suggestions: listTagNamesForSession(session),
  }
})
