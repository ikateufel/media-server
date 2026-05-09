import { getQuery } from 'h3'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import { enrichTrailerListForSession, scanTrailersCatalogInRoot } from '../../utils/trailerCatalogScan'
import { getResolvedAdminToken } from '../../utils/requireAdmin'
import { getVideoMenuItems } from '../../utils/videoMenu'

interface SearchRankedEntry {
  entry: TrailerListEntry
  nameMatched: boolean
  matchedTagsCount: number
}

type SearchMode = 'files' | 'tags'

function normalizeSearchTerm(raw: unknown): string {
  const q = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
  return q.trim().toLowerCase()
}

function includesNeedle(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle)
}

function normalizeSearchMode(raw: unknown): SearchMode {
  const v = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
  return v.trim().toLowerCase() === 'tags' ? 'tags' : 'files'
}

function toSearchRankedEntry(
  entry: TrailerListEntry,
  session: number,
  needle: string,
  mode: SearchMode,
): SearchRankedEntry | null {
  const tags = entry.tags ?? []
  const matchedTagsCount =
    mode === 'tags' ? tags.reduce((acc, t) => (includesNeedle(t, needle) ? acc + 1 : acc), 0) : 0
  const nameMatched =
    mode === 'files' &&
    (includesNeedle(entry.label, needle) || includesNeedle(entry.mainFilename, needle))

  if (!nameMatched && matchedTagsCount === 0) return null
  return {
    entry: {
      ...entry,
      librarySession: session,
    },
    nameMatched,
    matchedTagsCount,
  }
}

export default defineEventHandler(async (event) => {
  const q = normalizeSearchTerm(getQuery(event).q)
  const mode = normalizeSearchMode(getQuery(event).mode)
  const adminToken = getResolvedAdminToken(event) ?? ''
  const adminRevealExplorer = adminToken.length > 0
  if (q.length < 2) {
    return {
      query: q,
      mode,
      items: [] as TrailerListEntry[],
      tagSuggestions: [] as string[],
      serverPlatform: process.platform,
      adminRevealExplorer,
    }
  }

  const config = useRuntimeConfig(event)
  const menu = getVideoMenuItems(config)
  const ranked: SearchRankedEntry[] = []
  const tagSuggestions = new Set<string>()

  for (let session = 0; session < menu.length; session++) {
    const row = menu[session]
    if (!row) continue
    const root = row.path.trim()
    if (!root) continue
    try {
      const { items, mainStatsByRel } = await scanTrailersCatalogInRoot(root)
      await enrichTrailerListForSession(session, items, mainStatsByRel)
      for (const entry of items) {
        const hit = toSearchRankedEntry(entry, session, q, mode)
        if (hit) {
          ranked.push(hit)
          for (const t of hit.entry.tags ?? []) tagSuggestions.add(t)
        }
      }
    } catch {
      /* Ignorar pastas inacessíveis e continuar na busca global. */
    }
  }

  ranked.sort((a, b) => {
    if (a.nameMatched !== b.nameMatched) return a.nameMatched ? -1 : 1
    if (a.matchedTagsCount !== b.matchedTagsCount) return b.matchedTagsCount - a.matchedTagsCount
    const s = a.entry.label.localeCompare(b.entry.label, undefined, { sensitivity: 'base' })
    if (s !== 0) return s
    return a.entry.mainRel.localeCompare(b.entry.mainRel, undefined, { sensitivity: 'base' })
  })

  return {
    query: q,
    mode,
    items: ranked.slice(0, 200).map((x) => x.entry),
    tagSuggestions: [...tagSuggestions].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    ),
    serverPlatform: process.platform,
    adminRevealExplorer,
  }
})
