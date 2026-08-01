import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { createError, readBody } from 'h3'
import { resolveTrailerRelForTagMutation } from '../../utils/catalogTagMutation'
import { TAG_MAX_LEN, addTagToVideo, getTagsForVideo, normalizeTagInput } from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
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

  const requested = trailerRel.replace(/\\/g, '/').trim()
  const canonicalRel = await resolveTrailerRelForTagMutation(event, session, requested)
  addTagToVideo(session, canonicalRel, nameRaw, true)
  const merged = new Set<string>([
    ...getTagsForVideo(session, canonicalRel),
    ...getTagsForVideo(session, requested),
  ])
  const normalized = normalizeTagInput(nameRaw)
  if (normalized) merged.add(normalized)
  for (const t of merged) {
    addTagToVideo(session, requested, t, true)
    if (canonicalRel !== requested) addTagToVideo(session, canonicalRel, t, true)
  }
  return { tags: getTagsForVideo(session, requested), trailerRel: requested }
})
