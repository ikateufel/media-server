import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { getFavoriteSet } from './libraryState'
import { listRecentPlaybackRelsForSession } from './recentPlaybackDb'
import type { CatalogScanOptions } from './trailerCatalogScan'
import {
  countWatchedClassForSession,
  listTrailerRelsWatchedClass,
  listTrailerRelsWithTagExact,
  listTrailerRelsWithTagSubstring,
} from './videoTagsDb'

export type CatalogTriFilter = 'all' | 'only' | 'exclude'

export type CatalogLoadFilters = {
  tag: string | null
  folderQ: string
  folderMode: 'files' | 'tags'
  watchedOnly: boolean
  favorite: CatalogTriFilter
  destaques: CatalogTriFilter
}

export type CatalogFilterStats = {
  watchedCount: number
  favoriteCount: number
}

function parseTri(raw: unknown): CatalogTriFilter {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'only' || s === 'exclude') return s
  return 'all'
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (!sets.length) return new Set()
  let out = sets[0]!
  for (let i = 1; i < sets.length; i++) {
    const next = new Set<string>()
    for (const x of out) {
      if (sets[i]!.has(x)) next.add(x)
    }
    out = next
  }
  return out
}

/** Lê filtros de catálogo dos query params de `/api/trailers`. */
export function parseCatalogLoadFilters(event: H3Event): CatalogLoadFilters {
  const q = getQuery(event) as Record<string, unknown>
  const tagRaw = typeof q.tag === 'string' ? q.tag.trim() : ''
  const folderQ = typeof q.folderQ === 'string' ? q.folderQ.trim() : ''
  const folderMode = q.folderMode === 'files' ? 'files' : 'tags'
  const watchedRaw = typeof q.watchedOnly === 'string' ? q.watchedOnly.trim().toLowerCase() : ''
  const watchedOnly = watchedRaw === '1' || watchedRaw === 'true' || watchedRaw === 'yes'
  return {
    tag: tagRaw || null,
    folderQ,
    folderMode,
    watchedOnly,
    favorite: parseTri(q.favorite),
    destaques: parseTri(q.destaques),
  }
}

export function catalogLoadFiltersActive(f: CatalogLoadFilters): boolean {
  return Boolean(
    f.tag ||
      f.folderQ ||
      f.watchedOnly ||
      f.favorite !== 'all' ||
      f.destaques !== 'all',
  )
}

/**
 * Resolve allow/deny + atalhos de path para o scan evitar `stat` em títulos fora do filtro.
 */
export async function resolveCatalogScanOptions(
  session: number,
  filters: CatalogLoadFilters,
): Promise<{ scan: CatalogScanOptions; stats: CatalogFilterStats }> {
  const favSet = await getFavoriteSet(session)
  const stats: CatalogFilterStats = {
    watchedCount: countWatchedClassForSession(session),
    favoriteCount: favSet.size,
  }

  if (!catalogLoadFiltersActive(filters)) {
    return { scan: {}, stats }
  }

  const allowParts: Set<string>[] = []
  const deny = new Set<string>()

  if (filters.tag) {
    allowParts.push(new Set(listTrailerRelsWithTagExact(session, filters.tag)))
  }
  if (filters.folderQ && filters.folderMode === 'tags') {
    allowParts.push(new Set(listTrailerRelsWithTagSubstring(session, filters.folderQ)))
  }
  if (filters.watchedOnly) {
    allowParts.push(new Set(listTrailerRelsWatchedClass(session)))
  }
  if (filters.favorite === 'only') {
    allowParts.push(new Set(favSet))
  } else if (filters.favorite === 'exclude') {
    for (const r of favSet) deny.add(r)
  }

  if (filters.destaques === 'only') {
    allowParts.push(new Set(listRecentPlaybackRelsForSession(session)))
  } else if (filters.destaques === 'exclude') {
    for (const r of listRecentPlaybackRelsForSession(session)) deny.add(r)
  }

  const scan: CatalogScanOptions = {
    allowTrailerRels: allowParts.length ? intersectSets(allowParts) : null,
    denyTrailerRels: deny.size ? deny : null,
    tagExact: filters.tag,
    tagSubstring:
      filters.folderQ && filters.folderMode === 'tags' ? filters.folderQ : null,
    fileSubstring:
      filters.folderQ && filters.folderMode === 'files' ? filters.folderQ : null,
  }

  return { scan, stats }
}
