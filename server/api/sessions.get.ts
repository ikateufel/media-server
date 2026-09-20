import { createError } from 'h3'
import { RECENTS_SESSION_ID, SEARCH_SESSION_ID, SURPRESA_SESSION_ID, LAST_VIEWED_SESSION_ID } from '~/composables/useVideoFolder'
import { requireCatalogUnlock } from '../utils/catalogAccess'
import { getVideoMenuItems } from '../utils/videoMenu'
import { listTopTagNamesForSession } from '../utils/videoTagsDb'

export default defineEventHandler((event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const menu = getVideoMenuItems(config)
  if (!menu.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Defina pastas no menu (Admin / SQLite) ou VIDEO_ROOT no .env.',
    })
  }

  const sessions = [
    { id: SEARCH_SESSION_ID, label: 'Busca' },
    { id: RECENTS_SESSION_ID, label: 'Destaques' },
    { id: SURPRESA_SESSION_ID, label: 'Surpresa' },
    { id: LAST_VIEWED_SESSION_ID, label: 'Últimos vistos' },
    ...menu.map((entry, id) => ({
      id,
      label: entry.title,
      topTags: listTopTagNamesForSession(id, 5),
    })),
  ]

  return { sessions }
})
