import { createError, readBody } from 'h3'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { previewQueriesAgainstCatalog, previewQueriesForList } from '../../utils/tagListPreview'

/**
 * POST /api/library/tag-list-previews
 * body: { queries: string[], listId?: string, sample?: number, force?: boolean }
 * Com listId: devolve cache SQLite e só reprocessa itens em falta.
 */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const body = (await readBody(event).catch(() => null)) as {
    queries?: unknown
    listId?: unknown
    sample?: unknown
    force?: unknown
  } | null

  const queries = Array.isArray(body?.queries)
    ? body!.queries.map((q) => String(q ?? '').trim()).filter(Boolean)
    : []
  if (!queries.length) {
    throw createError({ statusCode: 400, statusMessage: 'queries[] obrigatório.' })
  }
  if (queries.length > 40) {
    throw createError({ statusCode: 400, statusMessage: 'Máximo 40 queries por pedido.' })
  }

  const sample = Number(body?.sample ?? 6)
  const listId = typeof body?.listId === 'string' ? body.listId.trim() : ''
  const force = Boolean(body?.force)

  if (listId) {
    const { rows, fromCache, computed } = await previewQueriesForList(
      event,
      listId,
      queries,
      sample,
      force,
    )
    return { ok: true, rows, fromCache, computed, cached: computed === 0 }
  }

  const rows = await previewQueriesAgainstCatalog(event, queries, sample)
  return { ok: true, rows, fromCache: 0, computed: rows.length, cached: false }
})
