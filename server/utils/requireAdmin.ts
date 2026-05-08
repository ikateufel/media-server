import { createError, getHeader, getQuery, type H3Event } from 'h3'

/**
 * Token admin no servidor: `VIDEO_ADMIN_TOKEN` (como `VIDEO_ROOT`, via `process.env`),
 * ou `runtimeConfig.adminToken` (preenchido em runtime com `NUXT_ADMIN_TOKEN` no `.env` / ambiente).
 */
export function getResolvedAdminToken(event: H3Event): string | undefined {
  const fromVideo = (process.env.VIDEO_ADMIN_TOKEN ?? '').trim()
  if (fromVideo) return fromVideo
  const cfg = useRuntimeConfig(event) as { adminToken?: unknown }
  const fromRc = String(cfg.adminToken ?? '').trim()
  return fromRc || undefined
}

function ensureAdminEnabled(adminToken: string | undefined): string {
  const need = (adminToken ?? '').trim()
  if (!need) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'Admin desactivado no servidor: defina VIDEO_ADMIN_TOKEN ou NUXT_ADMIN_TOKEN no ambiente do servidor e reinicie.',
    })
  }
  return need
}

export function requireAdminToken(event: H3Event) {
  const need = ensureAdminEnabled(getResolvedAdminToken(event))
  const auth = getHeader(event, 'authorization') ?? ''
  const m = auth.match(/^Bearer\s+(\S+)/i)
  const token = m?.[1]?.trim() ?? ''
  if (token !== need) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Token em falta ou inválido. Use o cabeçalho Authorization: Bearer <VIDEO_ADMIN_TOKEN>.',
    })
  }
}

/**
 * Variante de `requireAdminToken` que também aceita `?token=...` na query string.
 * Necessário para SSE/`EventSource` (a API do browser não permite cabeçalhos custom).
 */
export function requireAdminTokenAllowQuery(event: H3Event) {
  const need = ensureAdminEnabled(getResolvedAdminToken(event))
  const auth = getHeader(event, 'authorization') ?? ''
  const m = auth.match(/^Bearer\s+(\S+)/i)
  let token = m?.[1]?.trim() ?? ''
  if (!token) {
    const q = getQuery(event) as Record<string, unknown>
    if (typeof q.token === 'string') token = q.token.trim()
  }
  if (token !== need) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Token em falta ou inválido. Use Authorization: Bearer <VIDEO_ADMIN_TOKEN> ou ?token=...',
    })
  }
}
