import { getVideoMenuItems, tryLoadVideoMenuFromDisk } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const items = getVideoMenuItems(config)
  const fromFile = tryLoadVideoMenuFromDisk()
  const source: 'file' | 'env' = fromFile?.length ? 'file' : 'env'

  return {
    source,
    serverPlatform: process.platform,
    items: items.map((e) => ({ path: e.path, title: e.title })),
  }
})
