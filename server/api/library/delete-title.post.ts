import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createError, readBody } from 'h3'
import { purgeTitleFromLibraryState } from '../../utils/libraryState'
import { purgeVideoTags } from '../../utils/videoTagsDb'
import { resolvePreviewTrailerRel } from '../../utils/previewTrailer'
import { findMainFileInSessionRootSync, trailerToMainFilename } from '../../utils/trailerNames'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'
import { resolveSafeUnderRoot } from '../../utils/videoPaths'
import { movePathsToRecycleBin } from '../../utils/moveToRecycleBin'

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

  const trailerRel = trailerRelRaw.replace(/\\/g, '/')
  const root = roots[Math.floor(session)]!.trim()

  let trailerFull: string
  try {
    trailerFull = resolveSafeUnderRoot(root, trailerRel)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Caminho do trailer inválido.' })
  }

  const trailerSuffix = trailerRel.replace(/^trailers\//i, '').trim()
  if (!trailerSuffix || trailerSuffix.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'Caminho do trailer inválido.' })
  }

  const guessedMain = trailerToMainFilename(trailerSuffix)
  if (!guessedMain) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nome de trailer não reconhecido (esperado ficheiro de vídeo em trailers/ ou legado zz_*_acelerado.*).',
    })
  }

  const foundMain = findMainFileInSessionRootSync(root, trailerSuffix)
  const mainFilename = foundMain?.mainFilename ?? guessedMain
  const mainRel = mainFilename.replace(/\\/g, '/')
  let mainFull: string
  try {
    mainFull = resolveSafeUnderRoot(root, mainRel)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Caminho do vídeo principal inválido.' })
  }

  const previewRel = await resolvePreviewTrailerRel(root, trailerSuffix)
  let previewFull: string | null = null
  if (previewRel) {
    try {
      previewFull = resolveSafeUnderRoot(root, previewRel)
    } catch {
      previewFull = null
    }
  }

  const candidates = [previewFull, trailerFull, mainFull].filter((p): p is string => !!p)
  const paths: string[] = []
  const seen = new Set<string>()
  for (const p of candidates) {
    try {
      const st = await stat(p)
      if (st.isFile() && !seen.has(p)) {
        seen.add(p)
        paths.push(p)
      }
    } catch {
      /* ficheiro em falta */
    }
  }

  if (paths.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Nenhum ficheiro encontrado para enviar à Lixeira.' })
  }

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
    names: paths.map((p) => basename(p)),
  }
})
