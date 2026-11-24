import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { createError, readBody } from 'h3'
import { isPreviewCatalogRel, PREVIEW_FRAME_MAX_SLOTS } from '../../utils/previewFrameCache'
import { ITEM_COVER_MAX, setItemCovers } from '../../utils/itemCoverStore'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/**
 * Define as fotos escolhidas de um item dentro de uma lista (0 a 2). Lista vazia = automático.
 *
 * Body: `{ listId: string, query: string, covers: { session, rel, slot }[] }`
 */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const body = (await readBody(event)) as {
    listId?: unknown
    query?: unknown
    covers?: unknown
  }
  const listId = typeof body.listId === 'string' ? body.listId.trim() : ''
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!listId || query.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'listId e query são obrigatórios.' })
  }
  if (!Array.isArray(body.covers) || body.covers.length > ITEM_COVER_MAX) {
    throw createError({ statusCode: 400, statusMessage: `covers: lista com até ${ITEM_COVER_MAX} frames.` })
  }

  const covers: { session: number; rel: string; slot: number }[] = []
  for (const c of body.covers as { session?: unknown; rel?: unknown; slot?: unknown }[]) {
    const session = Number(c?.session)
    const rel = typeof c?.rel === 'string' ? c.rel.trim() : ''
    const slot = Number(c?.slot)
    if (!Number.isInteger(session) || session < 0 || session >= roots.length) {
      throw createError({ statusCode: 400, statusMessage: 'session inválida.' })
    }
    if (!rel || !isPreviewCatalogRel(rel)) {
      throw createError({ statusCode: 400, statusMessage: 'rel tem de ser um ficheiro de preview.' })
    }
    if (!Number.isInteger(slot) || slot < 0 || slot >= PREVIEW_FRAME_MAX_SLOTS) {
      throw createError({ statusCode: 400, statusMessage: 'slot inválido.' })
    }
    covers.push({ session, rel, slot })
  }

  const all = await setItemCovers(listId, query, covers)
  return { ok: true, covers: all }
})
