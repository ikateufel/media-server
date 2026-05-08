import { createError, readBody } from 'h3'
import {
  MEMORABLE_TAG_NAME,
  markTrailerMemorable,
  unmarkTrailerMemorable,
} from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/**
 * Marca/desmarca um vídeo como "memorável" (trofeu).
 *
 * Para efeitos de ordenação e do botão "trailer aleatório", esta tag tem o mesmo
 * efeito do `concluido` (vai para o fim, sai do pool aleatório). Mas é mantida
 * como tag separada para distinguir visualmente a escolha manual do utilizador.
 *
 * Body:
 *   { session: number, trailerRel: string, memorable?: boolean }
 *
 * - `memorable` omisso ou `true` → adiciona a tag `memoravel` (manual).
 * - `memorable: false` → remove a tag.
 *
 * Resposta: { memorable, memorableTagName, tags }
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
    memorable?: unknown
  }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const trailerRelRaw = typeof body.trailerRel === 'string' ? body.trailerRel.trim() : ''
  const trailerRel = trailerRelRaw.replace(/\\/g, '/')
  const memorable = body.memorable === undefined ? true : Boolean(body.memorable)

  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRel) {
    throw createError({
      statusCode: 400,
      statusMessage: 'session e trailerRel são obrigatórios.',
    })
  }

  const tags = memorable
    ? markTrailerMemorable(session, trailerRel)
    : unmarkTrailerMemorable(session, trailerRel)

  return { memorable, memorableTagName: MEMORABLE_TAG_NAME, tags }
})
