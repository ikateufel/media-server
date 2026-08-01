import { createError } from 'h3'
import { SURPRESA_SESSION_ID } from '~/composables/useVideoFolder'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { resolveSurpriseCatalogItems } from '../../utils/surpriseCatalog'
import { getFastPlaySettingsFromDisk, getVideoMenuItems, getVideoRootsFromRuntime } from '../../utils/videoMenu'

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

  const menu = getVideoMenuItems(config)
  const { items, tagSuggestions } = await resolveSurpriseCatalogItems(roots, menu)

  return {
    session: SURPRESA_SESSION_ID,
    rootLabel: 'Surpresa',
    items,
    tagSuggestions,
    serverPlatform: process.platform,
    fastPlay: getFastPlaySettingsFromDisk(),
  }
})
