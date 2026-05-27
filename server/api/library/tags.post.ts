import { createError, readBody } from 'h3'
import { resolveTrailerRelForTagMutation } from '../../utils/catalogTagMutation'
import { TAG_MAX_LEN, addTagToVideo, normalizeTagInput } from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const body = (await readBody(event)) as { session?: unknown; trailerRel?: unknown; name?: unknown }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const trailerRelRaw = typeof body.trailerRel === 'string' ? body.trailerRel.trim() : ''
  const trailerRel = trailerRelRaw.replace(/\\/g, '/')
  const nameRaw = typeof body.name === 'string' ? body.name : ''

  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRel || !nameRaw.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'session, trailerRel e name são obrigatórios.',
    })
  }

  if (!normalizeTagInput(nameRaw)) {
    throw createError({
      statusCode: 400,
      statusMessage: `A tag tem de ter 1–${TAG_MAX_LEN} caracteres (após remover espaços extra).`,
    })
  }

  const canonicalRel = await resolveTrailerRelForTagMutation(event, session, trailerRel)
  const tags = addTagToVideo(session, canonicalRel, nameRaw, true)
  return { tags }
})
