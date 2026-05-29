import { stat } from 'node:fs/promises'
import { createError, getQuery } from 'h3'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import { RECENTS_SESSION_ID } from '~/composables/useVideoFolder'
import {
  buildTrailerEntryFromTrailersBasename,
  enrichSingleTrailerEntryForSession,
} from '../../utils/trailerCatalogScan'
import { isCatalogTrailerRelSuffix } from '../../utils/trailerNames'
import { readRecentPlaybackList } from '../../utils/recentPlaybackDb'
import { getResolvedAdminToken } from '../../utils/requireAdmin'
import {
  getFastPlaySettingsFromDisk,
  getVideoMenuItems,
  getVideoRootsFromRuntime,
  type VideoMenuItem,
} from '../../utils/videoMenu'
import type { RecentPlaybackRow } from '../../utils/recentPlaybackDb'

function buildRecentsOriginCounts(
  rows: RecentPlaybackRow[],
  rootsLength: number,
  menu: VideoMenuItem[],
): { session: number; tag: string; count: number }[] {
  const counts = new Map<number, number>()
  for (const row of rows) {
    const s = row.session
    if (!Number.isFinite(s) || s < 0 || s >= rootsLength) continue
    const norm = row.trailerRel.trim().replace(/\\/g, '/')
    if (!norm.startsWith('trailers/')) continue
    const trailerName = norm.slice('trailers/'.length)
    if (!trailerName || !isCatalogTrailerRelSuffix(trailerName)) continue
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([session, count]) => ({
      session,
      tag: menu[session]?.title?.trim() || `Biblioteca ${session}`,
      count,
    }))
    .filter((r) => r.tag.length > 0)
    .sort((a, b) =>
      b.count !== a.count
        ? b.count - a.count
        : a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }),
    )
    .slice(0, 12)
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Defina pastas em data/video-menu.json ou VIDEO_ROOT no .env.',
    })
  }

  const menu = getVideoMenuItems(config)
  const allOrdered = readRecentPlaybackList()
  const originCounts = buildRecentsOriginCounts(allOrdered, roots.length, menu)

  const q = getQuery(event)
  const libSessionRaw = q.librarySession
  let ordered = allOrdered
  if (libSessionRaw !== undefined && libSessionRaw !== null && String(libSessionRaw).trim() !== '') {
    const want = Math.floor(Number(libSessionRaw))
    if (Number.isFinite(want) && want >= 0) {
      ordered = allOrdered.filter((r) => r.session === want)
    }
  }

  const total = ordered.length
  const offsetRaw = q.offset
  const limitRaw = q.limit
  const offset =
    offsetRaw !== undefined && offsetRaw !== null && String(offsetRaw).trim() !== ''
      ? Math.max(0, Math.floor(Number(offsetRaw)) || 0)
      : 0
  const limitParsed =
    limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== ''
      ? Math.floor(Number(limitRaw)) || 0
      : 0
  const limit = limitParsed > 0 ? Math.min(limitParsed, 50) : total
  const page = limit > 0 && limit < total ? ordered.slice(offset, offset + limit) : ordered

  const items: TrailerListEntry[] = []
  const tagSuggestions = new Set<string>()

  for (const row of page) {
    if (!Number.isFinite(row.session) || row.session < 0 || row.session >= roots.length) continue
    const root = roots[row.session]!.trim()
    try {
      await stat(root)
    } catch {
      continue
    }

    const norm = row.trailerRel.trim().replace(/\\/g, '/')
    if (!norm.startsWith('trailers/')) continue
    const trailerName = norm.slice('trailers/'.length)
    if (!trailerName || !isCatalogTrailerRelSuffix(trailerName)) continue

    const pair = await buildTrailerEntryFromTrailersBasename(root, trailerName)
    if (!pair) continue

    await enrichSingleTrailerEntryForSession(row.session, pair.entry, pair.mainStat)
    pair.entry.librarySession = row.session
    const touchedMs = Date.parse(row.touchedAt)
    if (Number.isFinite(touchedMs)) pair.entry.highlightedAtMs = touchedMs
    items.push(pair.entry)
    for (const t of pair.entry.tags ?? []) tagSuggestions.add(t)
  }

  const adminToken = getResolvedAdminToken(event) ?? ''

  const pageEnd = offset + page.length

  return {
    session: RECENTS_SESSION_ID,
    rootLabel: 'Destaques',
    items,
    total,
    offset,
    hasMore: pageEnd < total,
    originCounts,
    tagSuggestions: [...tagSuggestions].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    ),
    serverPlatform: process.platform,
    adminRevealExplorer: adminToken.length > 0,
    fastPlay: getFastPlaySettingsFromDisk(),
  }
})
