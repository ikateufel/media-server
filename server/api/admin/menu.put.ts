import { createError, readBody } from 'h3'
import { getVideoMenuItems, writeVideoMenuToDisk, type VideoMenuItem } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as
    | { items?: unknown; fastPlay?: unknown }
    | null

  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Corpo JSON inválido.' })
  }

  const fastPlayOnly = !('items' in body) && 'fastPlay' in body

  if (fastPlayOnly) {
    try {
      const menuItems = getVideoMenuItems(config)
      await writeVideoMenuToDisk(menuItems, body.fastPlay)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw createError({ statusCode: 400, statusMessage: msg })
    }
    const merged = getVideoMenuItems(config)
    return {
      ok: true,
      items: merged.map((e) => ({ path: e.path, title: e.title })),
    }
  }

  const rows = body.items
  if (!Array.isArray(rows)) {
    throw createError({ statusCode: 400, statusMessage: 'Corpo JSON inválido: esperado { "items": [ { "path", "title" }, ... ] }.' })
  }

  const items: VideoMenuItem[] = rows
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .map((r) => ({
      path: String((r as { path?: string }).path ?? '').trim(),
      title: String((r as { title?: string }).title ?? '').trim(),
    }))
    .filter((r) => r.path)

  try {
    await writeVideoMenuToDisk(items, body?.fastPlay)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw createError({ statusCode: 400, statusMessage: msg })
  }

  const merged = getVideoMenuItems(config)
  return {
    ok: true,
    items: merged.map((e) => ({ path: e.path, title: e.title })),
  }
})
