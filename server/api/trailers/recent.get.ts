import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createError } from 'h3'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import { RECENTS_SESSION_ID } from '~/composables/useVideoFolder'
import {
  buildTrailerEntryFromTrailersBasename,
  enrichSingleTrailerEntryForSession,
} from '../../utils/trailerCatalogScan'
import { isCatalogTrailerRelSuffix } from '../../utils/trailerNames'
import { readRecentPlaybackList } from '../../utils/recentPlaybackDb'
import { getFastPlaySettingsFromDisk, getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Defina pastas em data/video-menu.json ou VIDEO_ROOT no .env.',
    })
  }

  const ordered = readRecentPlaybackList()
  const items: TrailerListEntry[] = []
  const tagSuggestions = new Set<string>()

  for (const row of ordered) {
    if (!Number.isFinite(row.session) || row.session < 0 || row.session >= roots.length) continue
    const root = roots[row.session]!.trim()
    try {
      await stat(root)
    } catch {
      continue
    }
    const trailersDir = join(root, 'trailers')
    try {
      await stat(trailersDir)
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
    items.push(pair.entry)
    for (const t of pair.entry.tags ?? []) tagSuggestions.add(t)
  }

  const adminToken = String(config.adminToken ?? '').trim()

  return {
    session: RECENTS_SESSION_ID,
    rootLabel: 'Destaques',
    items,
    tagSuggestions: [...tagSuggestions].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    ),
    serverPlatform: process.platform,
    adminRevealExplorer: adminToken.length > 0,
    fastPlay: getFastPlaySettingsFromDisk(),
  }
})
