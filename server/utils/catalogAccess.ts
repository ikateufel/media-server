import { createHash } from 'node:crypto'
import {
  createError,
  getCookie,
  getQuery,
  setCookie,
  deleteCookie,
  type H3Event,
} from 'h3'
import { getCatalogPasswordFromDisk } from './videoMenu'

export const CATALOG_UNLOCK_COOKIE = 'vp_catalog_ok'
export const CATALOG_TV_BYPASS_COOKIE = 'vp_catalog_tv'

export function catalogUnlockToken(password: string): string {
  return createHash('sha256').update(`vp-catalog-v1:${password}`).digest('hex').slice(0, 40)
}

export function isCatalogPasswordRequired(): boolean {
  return Boolean(getCatalogPasswordFromDisk())
}

function queryTvBypass(event: H3Event): boolean {
  const raw = getQuery(event).tv
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = String(v ?? '').toLowerCase()
  return n === '1' || n === 'true' || n === 'yes'
}

export function isCatalogTvBypass(event: H3Event): boolean {
  if (queryTvBypass(event)) return true
  return getCookie(event, CATALOG_TV_BYPASS_COOKIE) === '1'
}

export function isCatalogUnlocked(event: H3Event): boolean {
  if (isCatalogTvBypass(event)) return true
  const pw = getCatalogPasswordFromDisk()
  if (!pw) return true
  const cookie = getCookie(event, CATALOG_UNLOCK_COOKIE)
  return Boolean(cookie && cookie === catalogUnlockToken(pw))
}

export function requireCatalogUnlock(event: H3Event): void {
  if (isCatalogUnlocked(event)) return
  throw createError({
    statusCode: 401,
    statusMessage: 'Catálogo bloqueado — introduz a senha.',
  })
}

export function setCatalogUnlockCookie(event: H3Event, password: string): void {
  setCookie(event, CATALOG_UNLOCK_COOKIE, catalogUnlockToken(password), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
}

export function setCatalogTvBypassCookie(event: H3Event): void {
  setCookie(event, CATALOG_TV_BYPASS_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
}

export function clearCatalogUnlockCookie(event: H3Event): void {
  deleteCookie(event, CATALOG_UNLOCK_COOKIE, { path: '/' })
}

export function clearCatalogTvBypassCookie(event: H3Event): void {
  deleteCookie(event, CATALOG_TV_BYPASS_COOKIE, { path: '/' })
}
