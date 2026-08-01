import { createError, readBody } from 'h3'
import {
  clearCatalogUnlockCookie,
  setCatalogUnlockCookie,
} from '../utils/catalogAccess'
import { getCatalogPasswordFromDisk } from '../utils/videoMenu'

export default defineEventHandler(async (event) => {
  const configured = getCatalogPasswordFromDisk()
  if (!configured) {
    clearCatalogUnlockCookie(event)
    return { ok: true, required: false }
  }

  const body = (await readBody(event).catch(() => null)) as { password?: unknown } | null
  const password = typeof body?.password === 'string' ? body.password.trim() : ''
  if (!password || password !== configured) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Senha incorrecta.',
    })
  }

  setCatalogUnlockCookie(event, configured)
  return { ok: true, required: true }
})
