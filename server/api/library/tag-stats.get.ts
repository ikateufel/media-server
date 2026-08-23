import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { listTagCountsGlobal } from '../../utils/videoTagsDb'

/** GET /api/library/tag-stats — tags globais com contagem (todas as pastas). */
export default defineEventHandler((event) => {
  requireCatalogUnlock(event)
  const tags = listTagCountsGlobal()
  const totalAssignments = tags.reduce((sum, t) => sum + t.count, 0)
  return {
    tags,
    totalTags: tags.length,
    totalAssignments,
  }
})
