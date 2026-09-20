import {
  getCatalogPasswordFromDisk,
  getFastPlaySettingsFromDisk,
  getVideoMenuItems,
  tryLoadVideoMenuFromDisk,
} from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const items = getVideoMenuItems(config)
  const fromDb = tryLoadVideoMenuFromDisk()
  const source: 'db' | 'env' = fromDb?.length ? 'db' : 'env'
  const catalogPassword = getCatalogPasswordFromDisk()

  return {
    source,
    serverPlatform: process.platform,
    items: items.map((e) => ({ path: e.path, title: e.title })),
    fastPlay: getFastPlaySettingsFromDisk(),
    catalogPassword,
    catalogPasswordEnabled: Boolean(catalogPassword),
  }
})
