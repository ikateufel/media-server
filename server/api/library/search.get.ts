import { getQuery } from 'h3'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { dedupeCatalogItemsByPhysicalVideo } from '../../utils/catalogPhysicalKey'
import { repairSessionTrailerRelDuplicates } from '../../utils/catalogTagRepair'
import { enrichTrailerListForSession, scanTrailersCatalogInRoot } from '../../utils/trailerCatalogScan'
import { jaccardTokens, jaroWinkler, normalizeNameForSimilarity } from '../../utils/textSimilarity'
import { getVideoMenuItems } from '../../utils/videoMenu'

interface SearchRankedEntry {
  entry: TrailerListEntry
  nameMatched: boolean
  matchedTagsCount: number
  similarityScore: number
}

type SearchMode = 'files' | 'tags'
type SearchMatch = 'any' | 'all' | 'approx'

const APPROX_MIN_SCORE = 0.52

function normalizeSearchTerm(raw: unknown): string {
  const q = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
  return q.trim().toLowerCase()
}

function searchNeedleParts(needle: string): string[] {
  return needle
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 0)
}

function matchesSearchNeedle(hay: string, needle: string, match: SearchMatch): boolean {
  const parts = searchNeedleParts(needle)
  if (!parts.length) return false
  const hayL = hay.toLowerCase()
  return match === 'all'
    ? parts.every((part) => hayL.includes(part))
    : parts.some((part) => hayL.includes(part))
}

function tokenMatchScore(part: string, hayStem: string, hayTokens: Set<string>): number {
  const p = part.toLowerCase()
  if (hayStem.includes(p)) return 1
  let best = jaroWinkler(p, hayStem)
  for (const t of hayTokens) {
    if (t.includes(p) || p.includes(t)) best = Math.max(best, 0.92)
    best = Math.max(best, jaroWinkler(p, t))
  }
  return best
}

function approximateTextScore(text: string, needle: string): number {
  const parts = searchNeedleParts(needle)
  if (!parts.length) return 0
  const { stem, tokens } = normalizeNameForSimilarity(text)
  if (!stem && !tokens.size) return 0
  const needleNorm = normalizeNameForSimilarity(needle)
  const jac = jaccardTokens(needleNorm.tokens, tokens)
  const jw = jaroWinkler(needleNorm.stem, stem)
  const partScores = parts.map((p) => tokenMatchScore(p, stem, tokens))
  const partAgg = partScores.reduce((a, b) => a + b, 0) / partScores.length
  return 0.3 * jac + 0.3 * jw + 0.4 * partAgg
}

function tagsMatchNeedle(tags: string[], needle: string, match: SearchMatch): boolean {
  const parts = searchNeedleParts(needle)
  if (!parts.length) return false
  if (match === 'approx') {
    return tagsApproxScore(tags, needle) >= APPROX_MIN_SCORE
  }
  if (match === 'all') {
    return parts.every((part) => tags.some((t) => t.toLowerCase().includes(part)))
  }
  return tags.some((t) => matchesSearchNeedle(t, needle, 'any'))
}

function tagsApproxScore(tags: string[], needle: string): number {
  let best = 0
  for (const t of tags) {
    best = Math.max(best, approximateTextScore(t, needle))
  }
  if (tags.length > 1) {
    best = Math.max(best, approximateTextScore(tags.join(' '), needle))
  }
  return best
}

function countMatchingTags(tags: string[], needle: string, match: SearchMatch): number {
  const parts = searchNeedleParts(needle)
  if (!parts.length) return 0
  if (match === 'approx') {
    const score = tagsApproxScore(tags, needle)
    return score >= APPROX_MIN_SCORE ? Math.round(score * 10) : 0
  }
  if (match === 'all') {
    if (!tagsMatchNeedle(tags, needle, 'all')) return 0
    let count = 0
    for (const t of tags) {
      if (parts.some((part) => t.toLowerCase().includes(part))) count++
    }
    return count
  }
  let count = 0
  for (const t of tags) {
    if (matchesSearchNeedle(t, needle, 'any')) count++
  }
  return count
}

function normalizeSearchMode(raw: unknown): SearchMode {
  const v = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
  return v.trim().toLowerCase() === 'tags' ? 'tags' : 'files'
}

function normalizeSearchMatch(raw: unknown): SearchMatch {
  const v = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
  const s = v.trim().toLowerCase()
  if (s === 'all' || s === 'and') return 'all'
  if (s === 'approx' || s === 'aprox' || s === 'fuzzy') return 'approx'
  return 'any'
}

function filesApproxScore(entry: TrailerListEntry, needle: string): number {
  return Math.max(
    approximateTextScore(entry.label, needle),
    approximateTextScore(entry.mainFilename, needle),
    approximateTextScore(`${entry.label} ${entry.mainFilename}`, needle),
  )
}

function toSearchRankedEntry(
  entry: TrailerListEntry,
  session: number,
  needle: string,
  mode: SearchMode,
  match: SearchMatch,
): SearchRankedEntry | null {
  const tags = entry.tags ?? []
  if (match === 'approx') {
    const similarityScore =
      mode === 'tags' ? tagsApproxScore(tags, needle) : filesApproxScore(entry, needle)
    if (similarityScore < APPROX_MIN_SCORE) return null
    return {
      entry: {
        ...entry,
        librarySession: session,
      },
      nameMatched: mode === 'files',
      matchedTagsCount: mode === 'tags' ? countMatchingTags(tags, needle, match) : 0,
      similarityScore,
    }
  }

  const matchedTagsCount = mode === 'tags' ? countMatchingTags(tags, needle, match) : 0
  const nameMatched =
    mode === 'files' &&
    (matchesSearchNeedle(entry.label, needle, match) ||
      matchesSearchNeedle(entry.mainFilename, needle, match) ||
      (match === 'all' &&
        matchesSearchNeedle(`${entry.label} ${entry.mainFilename}`, needle, 'all')))

  if (!nameMatched && matchedTagsCount === 0) return null
  return {
    entry: {
      ...entry,
      librarySession: session,
    },
    nameMatched,
    matchedTagsCount,
    similarityScore: 0,
  }
}

export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const query = getQuery(event)
  const q = normalizeSearchTerm(query.q)
  const mode = normalizeSearchMode(query.mode)
  const match = normalizeSearchMatch(query.match)
  if (q.length < 2) {
    return {
      query: q,
      mode,
      match,
      items: [] as TrailerListEntry[],
      tagSuggestions: [] as string[],
      serverPlatform: process.platform,
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
      const { items: scanned, mainStatsByRel } = await scanTrailersCatalogInRoot(root)
      await repairSessionTrailerRelDuplicates(
        session,
        root,
        scanned.map((e) => e.trailerRel),
      )
      const items = dedupeCatalogItemsByPhysicalVideo(scanned)
      await enrichTrailerListForSession(session, items, mainStatsByRel)
      for (const entry of items) {
        const hit = toSearchRankedEntry(entry, session, q, mode, match)
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
    if (match === 'approx') {
      if (a.similarityScore !== b.similarityScore) return b.similarityScore - a.similarityScore
    } else {
      if (a.nameMatched !== b.nameMatched) return a.nameMatched ? -1 : 1
      if (a.matchedTagsCount !== b.matchedTagsCount) return b.matchedTagsCount - a.matchedTagsCount
    }
    const s = a.entry.label.localeCompare(b.entry.label, undefined, { sensitivity: 'base' })
    if (s !== 0) return s
    return a.entry.mainRel.localeCompare(b.entry.mainRel, undefined, { sensitivity: 'base' })
  })

  return {
    query: q,
    mode,
    match,
    items: ranked.slice(0, 200).map((x) => x.entry),
    tagSuggestions: [...tagSuggestions].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    ),
    serverPlatform: process.platform,
  }
})
