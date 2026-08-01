import { getQuery } from 'h3'
import {
  clearCatalogTvBypassCookie,
  clearCatalogUnlockCookie,
  isCatalogPasswordRequired,
  isCatalogUnlocked,
  setCatalogTvBypassCookie,
} from '../utils/catalogAccess'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const rawTv = q.tv
  const tvVal = Array.isArray(rawTv) ? rawTv[0] : rawTv
  const tvN = String(tvVal ?? '').toLowerCase()
  const tvQuery = tvN === '1' || tvN === 'true' || tvN === 'yes'

  const rawFresh = q.fresh
  const freshVal = Array.isArray(rawFresh) ? rawFresh[0] : rawFresh
  const freshN = String(freshVal ?? '').toLowerCase()
  const fresh = freshN === '1' || freshN === 'true'

  if (tvQuery) {
    setCatalogTvBypassCookie(event)
    return {
      required: false,
      unlocked: true,
      tvBypass: true,
    }
  }

  clearCatalogTvBypassCookie(event)

  if (fresh) {
    clearCatalogUnlockCookie(event)
  }

  const required = isCatalogPasswordRequired()
  return {
    required,
    unlocked: !required || isCatalogUnlocked(event),
    tvBypass: false,
  }
})
