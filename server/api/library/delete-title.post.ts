import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { basename } from 'node:path'
import { createError, readBody } from 'h3'
import { purgeTitleFromLibraryState } from '../../utils/libraryState'
import { movePathsToRecycleBin } from '../../utils/moveToRecycleBin'
import {
  collectTitleVideoPathsForDeletion,
  purgePreviewThumbCacheForTitle,
} from '../../utils/titleFileCleanup'
import { purgeVideoTags } from '../../utils/videoTagsDb'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const raw = await readBody(event).catch(() => null)
  let body: { session?: unknown; trailerRel?: unknown } | null = null
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    body = raw as { session?: unknown; trailerRel?: unknown }
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as { session?: unknown; trailerRel?: unknown }
      }
    } catch {
      body = null
    }
  }
  const session =
    typeof body?.session === 'number' ? body.session : Number(body?.session)
  const trailerRelRaw =
    typeof body?.trailerRel === 'string'
      ? body.trailerRel.trim()
      : body?.trailerRel == null
        ? ''
        : String(body.trailerRel).trim()
  if (!body) {
    throw createError({ statusCode: 400, statusMessage: 'Corpo JSON em falta ou inválido.' })
  }
  if (!trailerRelRaw) {
    throw createError({ statusCode: 400, statusMessage: 'trailerRel em falta.' })
  }
  if (!Number.isFinite(session) || session < 0) {
    throw createError({ statusCode: 400, statusMessage: 'session inválida.' })
  }
  if (session >= roots.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `session ${Math.floor(session)} fora do menu (0..${roots.length - 1}).`,
    })
  }

  const root = roots[Math.floor(session)]!.trim()
  const collected = await collectTitleVideoPathsForDeletion(root, trailerRelRaw)
  if (!collected?.paths.length) {
    throw createError({ statusCode: 404, statusMessage: 'Nenhum ficheiro encontrado para enviar à Lixeira.' })
  }

  const { paths, trailerRel, mainRel, previewRel } = collected
  const cacheRels = [...new Set([previewRel, trailerRel].filter((r): r is string => !!r))]
  const thumbsRemoved = await purgePreviewThumbCacheForTitle(root, cacheRels)

  try {
    await movePathsToRecycleBin(paths)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    throw createError({
      statusCode: 500,
      statusMessage: `Não foi possível mover para a Lixeira: ${msg}`,
    })
  }

  await purgeTitleFromLibraryState(session, trailerRel, mainRel)
  purgeVideoTags(session, trailerRel)

  return {
    ok: true,
    moved: paths.length,
    thumbsRemoved,
    names: paths.map((p) => basename(p)),
  }
})
