import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { createError, readBody } from 'h3'
import { isPreviewCatalogRel, PREVIEW_FRAME_MAX_SLOTS } from '../../utils/previewFrameCache'
import { setPreviewCover } from '../../utils/previewCoverStore'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/**
 * Define (ou limpa) o frame usado como foto principal de um título na lista.
 *
 * Body: `{ session: number, rel: string, slot: number | null }`
 */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const body = (await readBody(event)) as { session?: unknown; rel?: unknown; slot?: unknown }
  const session = Number(body.session)
  const rel = typeof body.rel === 'string' ? body.rel.trim() : ''
  const slot = body.slot === null ? null : Number(body.slot)

  if (!Number.isInteger(session) || session < 0 || session >= roots.length) {
    throw createError({ statusCode: 400, statusMessage: 'session inválida.' })
  }
  if (!rel || !isPreviewCatalogRel(rel)) {
    throw createError({ statusCode: 400, statusMessage: 'rel tem de ser um ficheiro de preview.' })
  }
  if (slot !== null && (!Number.isInteger(slot) || slot < 0 || slot >= PREVIEW_FRAME_MAX_SLOTS)) {
    throw createError({ statusCode: 400, statusMessage: 'slot inválido.' })
  }

  const covers = await setPreviewCover(session, rel, slot)
  return { ok: true, covers }
})
