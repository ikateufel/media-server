import {
  getVideoMenuItems,
  tryLoadVideoMenuFromDisk,
} from '../../utils/videoMenu'

export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  const items = getVideoMenuItems(config)
  const fromFile = tryLoadVideoMenuFromDisk()
  const source: 'file' | 'env' = fromFile?.length ? 'file' : 'env'

  return {
    source,
    serverPlatform: process.platform,
    items: items.map((e) => ({ path: e.path, title: e.title })),
  }
})
