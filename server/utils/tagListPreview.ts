import type { TrailerListEntry } from '~/composables/useVideoFolder'
import { dedupeCatalogItemsByPhysicalVideo } from './catalogPhysicalKey'
import { repairSessionTrailerRelDuplicates } from './catalogTagRepair'
import {
  getCachedTagListPreviews,
  normalizePreviewQueryKey,
  upsertTagListPreviews,
} from './tagListPreviewCache'
import { enrichTrailerListForSession, scanTrailersCatalogInRoot } from './trailerCatalogScan'
import { getVideoMenuItems } from './videoMenu'
import type { H3Event } from 'h3'

export interface TagListPreviewSample {
  session: number
  trailerRel: string
  label: string
  /** Rel usado em /api/library/preview-frame */
  previewRel: string
}

export interface TagListPreviewRow {
  query: string
  total: number
  samples: TagListPreviewSample[]
}

function needleParts(needle: string): string[] {
  return needle
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 0)
}

/**
 * Mosaico das listas: exige todas as palavras (AND) no conjunto
 * label + nome do ficheiro + tags.
 */
function entryMatchesQuery(entry: TrailerListEntry, query: string): boolean {
  const q = query.trim()
  if (q.length < 2) return false
  const parts = needleParts(q)
  if (!parts.length) return false
  const hay = [entry.label, entry.mainFilename, ...(entry.tags ?? [])]
    .join('\0')
    .toLowerCase()
  return parts.every((part) => hay.includes(part))
}

function shufflePick<T>(arr: T[], n: number): T[] {
  if (n <= 0 || !arr.length) return []
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]!
    copy[i] = copy[j]!
    copy[j] = tmp
  }
  return copy.slice(0, Math.min(n, copy.length))
}

type CatalogHit = {
  session: number
  entry: TrailerListEntry
}

/** Uma linha de miniaturas no mosaico da lista. */
/** Uma imagem por vídeo, até 6 títulos distintos. */
export const TAG_LIST_PREVIEW_SAMPLE = 6

/**
 * Uma passagem pelo catálogo; para cada query devolve total + amostra aleatória
 * (para mosaico de orientação nas listas de tags). Match = todas as palavras.
 */
export async function previewQueriesAgainstCatalog(
  event: H3Event,
  queriesRaw: string[],
  samplePerQuery = TAG_LIST_PREVIEW_SAMPLE,
): Promise<TagListPreviewRow[]> {
  const sample = Math.max(1, Math.min(TAG_LIST_PREVIEW_SAMPLE, Math.floor(samplePerQuery) || TAG_LIST_PREVIEW_SAMPLE))
  const queries = [
    ...new Set(
      queriesRaw
        .map((q) => String(q ?? '').trim().replace(/\s+/g, ' '))
        .filter((q) => q.length >= 2),
    ),
  ]
  if (!queries.length) return []

  const config = useRuntimeConfig(event)
  const menu = getVideoMenuItems(config)
  const catalog: CatalogHit[] = []

  for (let session = 0; session < menu.length; session++) {
    const row = menu[session]
    if (!row) continue
    const root = row.path.trim()
    if (!root) continue
    try {
      const { items: scanned, mainStatsByRel } = await scanTrailersCatalogInRoot(root)
      await repairSessionTrailerRelDuplicates(
        session,
        root,
        scanned.map((e) => e.trailerRel),
      )
      const items = dedupeCatalogItemsByPhysicalVideo(scanned)
      await enrichTrailerListForSession(session, items, mainStatsByRel)
      for (const entry of items) {
        catalog.push({
          session,
          entry: { ...entry, librarySession: session },
        })
      }
    } catch {
      /* pasta inacessível */
    }
  }

  return queries.map((query) => {
    const hits = catalog.filter((h) => entryMatchesQuery(h.entry, query))
    const picked = shufflePick(hits, sample)
    return {
      query,
      total: hits.length,
      samples: picked.map((h) => {
        const previewRel = (h.entry.previewRel || h.entry.trailerRel || '').replace(/\\/g, '/')
        return {
          session: h.session,
          trailerRel: h.entry.trailerRel,
          label: h.entry.label || h.entry.mainFilename || h.entry.trailerRel,
          previewRel,
        }
      }),
    }
  })
}

/**
 * Usa cache SQLite por lista+item; só re-varre o catálogo para queries em falta
 * (ou todas se `force`).
 */
export async function previewQueriesForList(
  event: H3Event,
  listId: string,
  queriesRaw: string[],
  samplePerQuery = TAG_LIST_PREVIEW_SAMPLE,
  force = false,
): Promise<{ rows: TagListPreviewRow[]; fromCache: number; computed: number }> {
  const queries = [
    ...new Set(
      queriesRaw
        .map((q) => String(q ?? '').trim().replace(/\s+/g, ' '))
        .filter((q) => q.length >= 2),
    ),
  ]
  if (!queries.length) return { rows: [], fromCache: 0, computed: 0 }

  const sample = Math.max(
    1,
    Math.min(TAG_LIST_PREVIEW_SAMPLE, Math.floor(samplePerQuery) || TAG_LIST_PREVIEW_SAMPLE),
  )
  const id = String(listId ?? '').trim()
  const cached = !force && id ? getCachedTagListPreviews(id, queries) : new Map()
  const missing = force
    ? queries
    : queries.filter((q) => {
        const key = normalizePreviewQueryKey(q)
        const hit = cached.get(key)
        if (!hit) return true
        const want = Math.min(sample, hit.total || sample)
        if (hit.samples.length < want) {
          cached.delete(key)
          return true
        }
        return false
      })

  let computedRows: TagListPreviewRow[] = []
  if (missing.length) {
    computedRows = await previewQueriesAgainstCatalog(event, missing, samplePerQuery)
    if (id) upsertTagListPreviews(id, computedRows)
  }

  const computedByKey = new Map(
    computedRows.map((r) => [normalizePreviewQueryKey(r.query), r] as const),
  )
  const rows = queries.map((query) => {
    const key = normalizePreviewQueryKey(query)
    return (
      computedByKey.get(key) ??
      cached.get(key) ?? {
        query,
        total: 0,
        samples: [],
      }
    )
  })

  return {
    rows,
    fromCache: queries.length - missing.length,
    computed: missing.length,
  }
}
