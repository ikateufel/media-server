import {
  getVideoMenuItems,
  tryLoadVideoMenuFromDisk,
} from '../../utils/videoMenu'

export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  const items = getVideoMenuItems(config)
  const fromDb = tryLoadVideoMenuFromDisk()
  const source: 'db' | 'env' = fromDb?.length ? 'db' : 'env'

  return {
    source,
    serverPlatform: process.platform,
    items: items.map((e) => ({ path: e.path, title: e.title })),
  }
})
