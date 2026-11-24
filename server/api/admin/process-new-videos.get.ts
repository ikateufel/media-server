import { requireAdminToken } from '../../utils/requireAdmin'
import { getProcessNewVideosPublicStatus } from '../../utils/processNewVideos'

export default defineEventHandler((event) => {
  requireAdminToken(event)
  return getProcessNewVideosPublicStatus()
})
