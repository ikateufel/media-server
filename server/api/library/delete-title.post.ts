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
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const body = (await readBody(event)) as { session?: unknown; trailerRel?: unknown }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const trailerRelRaw = typeof body.trailerRel === 'string' ? body.trailerRel.trim() : ''
  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRelRaw) {
    throw createError({ statusCode: 400, statusMessage: 'session e trailerRel são obrigatórios.' })
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
