import { requireCatalogUnlock } from '../utils/catalogAccess'
import { readStoredDuplicateScan } from '../utils/duplicateCandidates'

/** GET /api/duplicates — lista gravada (sem reprocessar). */
export default defineEventHandler((event) => {
  requireCatalogUnlock(event)
  const stored = readStoredDuplicateScan()
  return {
    ok: true,
    stored: !!stored,
    ...(stored ?? {
      savedAt: null,
      scannedVideos: 0,
      candidatePairs: 0,
      matchedPairs: 0,
      groups: [],
      minScore: 0.75,
      minSharedTags: 1,
      ms: 0,
      options: null,
    }),
  }
})
