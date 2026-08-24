export type CatalogTriFilter = 'all' | 'only' | 'exclude'
export type CatalogSortKey = 'name' | 'date' | 'size'

export type CatalogSessionPrefs = {
  tagFilter: string | null
  originFilter: string | null
  folderFilterInput: string
  folderFilterMode: 'files' | 'tags'
  showOnlyWatched: boolean
  favoriteFilter: CatalogTriFilter
  destaquesFilter: CatalogTriFilter
  sortKey: CatalogSortKey
  sortDir: 'asc' | 'desc'
  searchInput: string
  searchQuery: string
  searchMode: 'files' | 'tags'
  /** any = qualquer palavra; all = todas as palavras; approx = proximidade. */
  searchMatch?: 'any' | 'all' | 'approx'
}

const CATALOG_SESSION_PREFS_KEY = 'video_player_catalog_session_prefs'
const LEGACY_CATALOG_SORT_KEY = 'video_player_catalog_sort'

function isCatalogTriFilter(v: unknown): v is CatalogTriFilter {
  return v === 'all' || v === 'only' || v === 'exclude'
}

function isCatalogSortKey(v: unknown): v is CatalogSortKey {
  return v === 'name' || v === 'date' || v === 'size'
}

function readLegacyCatalogSort(): { key: CatalogSortKey; dir: 'asc' | 'desc' } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LEGACY_CATALOG_SORT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { key?: unknown; dir?: unknown }
    if (!isCatalogSortKey(parsed.key)) return null
    if (parsed.dir !== 'asc' && parsed.dir !== 'desc') return null
    return { key: parsed.key, dir: parsed.dir }
  } catch {
    return null
  }
}

function parseStoredPrefs(raw: unknown): CatalogSessionPrefs | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const sortKey = isCatalogSortKey(o.sortKey) ? o.sortKey : null
  const sortDir = o.sortDir === 'asc' || o.sortDir === 'desc' ? o.sortDir : null
  if (!sortKey || !sortDir) return null
  return {
    tagFilter: typeof o.tagFilter === 'string' ? o.tagFilter : o.tagFilter === null ? null : null,
    originFilter:
      typeof o.originFilter === 'string' ? o.originFilter : o.originFilter === null ? null : null,
    folderFilterInput: typeof o.folderFilterInput === 'string' ? o.folderFilterInput : '',
    folderFilterMode: o.folderFilterMode === 'files' ? 'files' : 'tags',
    showOnlyWatched: o.showOnlyWatched === true,
    favoriteFilter: isCatalogTriFilter(o.favoriteFilter) ? o.favoriteFilter : 'all',
    destaquesFilter: isCatalogTriFilter(o.destaquesFilter) ? o.destaquesFilter : 'all',
    sortKey,
    sortDir,
    searchInput: typeof o.searchInput === 'string' ? o.searchInput : '',
    searchQuery: typeof o.searchQuery === 'string' ? o.searchQuery : '',
    searchMode: o.searchMode === 'files' ? 'files' : 'tags',
    searchMatch:
      o.searchMatch === 'all' ? 'all' : o.searchMatch === 'approx' ? 'approx' : 'any',
  }
}

function readAllStoredPrefs(): Record<string, CatalogSessionPrefs> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(CATALOG_SESSION_PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, CatalogSessionPrefs> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const prefs = parseStoredPrefs(v)
      if (prefs) out[k] = prefs
    }
    return out
  } catch {
    return {}
  }
}

export function readCatalogSessionPrefs(sessionId: number): CatalogSessionPrefs | null {
  const all = readAllStoredPrefs()
  const stored = all[String(sessionId)]
  if (stored) return stored
  if (sessionId >= 0) {
    const legacy = readLegacyCatalogSort()
    if (legacy) {
      return {
        tagFilter: null,
        originFilter: null,
        folderFilterInput: '',
        folderFilterMode: 'tags',
        showOnlyWatched: false,
        favoriteFilter: 'all',
        destaquesFilter: 'all',
        sortKey: legacy.key,
        sortDir: legacy.dir,
        searchInput: '',
        searchQuery: '',
        searchMode: 'tags',
        searchMatch: 'any',
      }
    }
  }
  return null
}

export function writeCatalogSessionPrefs(sessionId: number, prefs: CatalogSessionPrefs) {
  if (typeof localStorage === 'undefined') return
  try {
    const all = readAllStoredPrefs()
    all[String(sessionId)] = prefs
    localStorage.setItem(CATALOG_SESSION_PREFS_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}
