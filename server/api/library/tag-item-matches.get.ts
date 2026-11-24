import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { createError, getQuery } from 'h3'
import { listCatalogMatchesForQuery } from '../../utils/tagListPreview'

/**
 * Vídeos do catálogo que pertencem a um item de lista, paginados (para escolher a capa).
 * Query: `query` (nome do item), `page` (0-based), `pageSize` (1..24, padrão 12).
 */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const q = getQuery(event) as Record<string, unknown>
  const query = typeof q.query === 'string' ? q.query.trim().replace(/\s+/g, ' ') : ''
  if (query.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'query obrigatória.' })
  }
  const pageSize = Math.min(24, Math.max(1, Math.floor(Number(q.pageSize) || 12)))
  const page = Math.max(0, Math.floor(Number(q.page) || 0))

  const hits = await listCatalogMatchesForQuery(event, query)
  const slice = hits.slice(page * pageSize, page * pageSize + pageSize)
  return {
    total: hits.length,
    page,
    pageSize,
    items: slice.map((h) => ({
      session: h.session,
      label: h.entry.label || h.entry.mainFilename || h.entry.trailerRel,
      trailerRel: h.entry.trailerRel,
      previewRel: (h.entry.previewRel || h.entry.trailerRel || '').replace(/\\/g, '/'),
    })),
  }
})
