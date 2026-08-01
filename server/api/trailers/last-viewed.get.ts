import { createError } from 'h3'
import { LAST_VIEWED_LIMIT, LAST_VIEWED_SESSION_ID } from '~/composables/useVideoFolder'
import { buildCatalogEntriesFromPlaybackRows } from '../../utils/buildCatalogFromPlaybackRows'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { readTrailerViewHistoryList } from '../../utils/recentPlaybackDb'
import { getFastPlaySettingsFromDisk, getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Defina pastas em data/video-menu.json ou VIDEO_ROOT no .env.',
    })
  }

  const all = readTrailerViewHistoryList(LAST_VIEWED_LIMIT)
  const page = all
  const rows = page.map((r) => ({
    session: r.session,
    trailerRel: r.trailerRel,
    touchedAt: r.viewedAt,
  }))

  const { items, tagSuggestions } = await buildCatalogEntriesFromPlaybackRows(rows, roots)

  return {
    session: LAST_VIEWED_SESSION_ID,
    rootLabel: 'Últimos vistos',
    items,
    total: items.length,
    limit: LAST_VIEWED_LIMIT,
    tagSuggestions,
    serverPlatform: process.platform,
    fastPlay: getFastPlaySettingsFromDisk(),
  }
})
