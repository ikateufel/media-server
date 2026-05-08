import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createError } from 'h3'
import {
  isPreviewCatalogRel,
  previewFrameCacheFilePath,
  PREVIEW_FRAME_SLOT_COUNT,
} from './previewFrameCache'
import { moveTitleLibraryState } from './libraryState'
import { resolvePreviewTrailerRel } from './previewTrailer'
import { findMainFileInSessionRootSync, trailerToMainFilename } from './trailerNames'
import { transferTitleBetweenSessions } from './videoTagsDb'
import { resolveSafeUnderRoot } from './videoPaths'

async function isExistingFile(p: string): Promise<boolean> {
  try {
    const st = await stat(p)
    return st.isFile()
  } catch {
    return false
  }
}

async function safeRenameOrCopy(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  try {
    await rename(src, dest)
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EXDEV') {
      await copyFile(src, dest)
      await unlink(src)
      return
    }
    throw e
  }
}

/**
 * Move físico de um título (completo + trailer + preview) de uma raiz VIDEO_ROOT para outra,
 * juntos com os JPEG em `.thumb_cache/` usados pelo catálogo, e migra estado (favoritos, progresso,
 * tags SQLite).
 */
export async function moveTitleBetweenVideoRoots(opts: {
  roots: string[]
  fromSession: number
  toSession: number
  trailerRelRaw: string
}): Promise<{ mainRel: string; trailerRel: string; movedFiles: number; movedThumbs: number }> {
  const { roots, fromSession, toSession, trailerRelRaw } = opts
  if (!Number.isFinite(fromSession) || !Number.isFinite(toSession)) {
    throw createError({ statusCode: 400, statusMessage: 'Sessões inválidas.' })
  }
  const fromI = Math.floor(fromSession)
  const toI = Math.floor(toSession)
  if (fromI < 0 || fromI >= roots.length || toI < 0 || toI >= roots.length) {
    throw createError({ statusCode: 400, statusMessage: 'Índice de sessão fora do intervalo.' })
  }
  if (fromI === toI) {
    throw createError({ statusCode: 400, statusMessage: 'Escolha uma pasta diferente da actual.' })
  }

  const trailerRel = trailerRelRaw.replace(/\\/g, '/').trim()
  if (!trailerRel) {
    throw createError({ statusCode: 400, statusMessage: 'trailerRel em falta.' })
  }
  if (!trailerRel.toLowerCase().startsWith('trailers/')) {
    throw createError({ statusCode: 400, statusMessage: 'trailerRel tem de começar por trailers/.' })
  }

  const fromRoot = roots[fromI]!.trim()
  const toRoot = roots[toI]!.trim()

  let trailerFull: string
  try {
    trailerFull = resolveSafeUnderRoot(fromRoot, trailerRel)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Caminho do trailer inválido.' })
  }

  const within = trailerRel.slice('trailers/'.length)
  if (!within || within.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'trailerRel inválido.' })
  }

  const guessedMain = trailerToMainFilename(within)
  if (!guessedMain) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nome de trailer não reconhecido.',
    })
  }

  const foundMain = findMainFileInSessionRootSync(fromRoot, within)
  const mainFilename = foundMain?.mainFilename ?? guessedMain
  const mainRel = mainFilename.replace(/\\/g, '/')

  const previewRelResolved = await resolvePreviewTrailerRel(fromRoot, within)

  const previewNorm = previewRelResolved ? previewRelResolved.replace(/\\/g, '/') : ''
  const relsToMove: string[] = [mainRel, trailerRel]
  if (previewNorm && !relsToMove.some((r) => r.replace(/\\/g, '/') === previewNorm)) {
    relsToMove.push(previewNorm)
  }

  const seenSrc = new Set<string>()
  const fileMoves: { src: string; dest: string; rel: string }[] = []
  for (const rel of relsToMove) {
    let src: string
    try {
      src = resolveSafeUnderRoot(fromRoot, rel)
    } catch {
      continue
    }
    if (seenSrc.has(src)) continue
    if (!(await isExistingFile(src))) continue
    seenSrc.add(src)

    let dest: string
    try {
      dest = resolveSafeUnderRoot(toRoot, rel)
    } catch {
      throw createError({ statusCode: 400, statusMessage: `Destino inválido para ${rel}` })
    }

    if (await isExistingFile(dest)) {
      throw createError({
        statusCode: 409,
        statusMessage: `Já existe um ficheiro com o mesmo nome na pasta de destino (${rel}).`,
      })
    }
    fileMoves.push({ src, dest, rel })
  }

  if (fileMoves.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Nenhum ficheiro encontrado para mover.' })
  }

  await mkdir(join(toRoot, 'trailers'), { recursive: true })
  await mkdir(join(toRoot, 'preview'), { recursive: true })

  const relForFrames = (previewRelResolved ?? trailerRel).replace(/\\/g, '/')
  let frameSourceFull: string | null = null
  let mtimeMsForCache = 0
  if (isPreviewCatalogRel(relForFrames)) {
    try {
      frameSourceFull = resolveSafeUnderRoot(fromRoot, relForFrames)
      const st = await stat(frameSourceFull)
      if (st.isFile()) mtimeMsForCache = st.mtimeMs
    } catch {
      frameSourceFull = null
    }
  }

  for (const { src, dest } of fileMoves) {
    await safeRenameOrCopy(src, dest)
  }

  let movedThumbs = 0
  if (frameSourceFull && mtimeMsForCache > 0) {
    for (let slot = 0; slot < PREVIEW_FRAME_SLOT_COUNT; slot++) {
      const srcJpg = previewFrameCacheFilePath(fromRoot, relForFrames, slot, mtimeMsForCache)
      const dstJpg = previewFrameCacheFilePath(toRoot, relForFrames, slot, mtimeMsForCache)
      if (!(await isExistingFile(srcJpg))) continue
      if (await isExistingFile(dstJpg)) {
        await unlink(dstJpg).catch(() => {})
      }
      await mkdir(dirname(dstJpg), { recursive: true })
      await safeRenameOrCopy(srcJpg, dstJpg)
      movedThumbs++
    }
  }

  transferTitleBetweenSessions(fromI, toI, trailerRel, mainRel)
  await moveTitleLibraryState(fromI, toI, trailerRel, mainRel)

  return {
    mainRel,
    trailerRel,
    movedFiles: fileMoves.length,
    movedThumbs,
  }
}
