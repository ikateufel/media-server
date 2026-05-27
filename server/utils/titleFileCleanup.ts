import { stat, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  isPreviewCatalogRel,
  previewFrameCacheFilePath,
  PREVIEW_FRAME_SLOT_COUNT,
} from './previewFrameCache'
import { resolvePreviewTrailerRel } from './previewTrailer'
import {
  findMainFileInSessionRoot,
  resolveCatalogRelAbsoluteCandidates,
  trailerToMainFilename,
} from './trailerNames'
import { resolveSafeUnderRoot } from './videoPaths'

const PREVIEW_VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.avi'] as const

function orderedPreviewExts(trailerExt: string): string[] {
  const e = trailerExt.toLowerCase()
  const rest = PREVIEW_VIDEO_EXTS.filter((x) => x !== e)
  return [e, ...rest]
}

function legacyPreviewBasenames(stem: string, pext: string): string[] {
  return [
    `preview.${stem}${pext}`,
    `preview_${stem}${pext}`,
    `${stem}.preview${pext}`,
    `${stem}_preview${pext}`,
  ]
}

async function addExistingFile(paths: Set<string>, full: string): Promise<void> {
  try {
    const st = await stat(full)
    if (st.isFile()) paths.add(full)
  } catch {
    /* */
  }
}

/** Todos os caminhos absolutos de um `rel` de catálogo (padrão + legado `Sub/trailers/…`). */
async function addFilesForCatalogRel(root: string, rel: string, paths: Set<string>): Promise<void> {
  const norm = rel.replace(/\\/g, '/').trim()
  if (!norm) return
  const candidates = resolveCatalogRelAbsoluteCandidates(root, norm)
  for (const p of candidates) {
    await addExistingFile(paths, p)
  }
  try {
    await addExistingFile(paths, resolveSafeUnderRoot(root, norm))
  } catch {
    /* */
  }
}

/**
 * Vídeos de preview associados ao trailer (preview/, legado em trailers/, variantes de extensão).
 */
async function addAllPreviewVideoPaths(
  root: string,
  trailerPathWithinTrailers: string,
  paths: Set<string>,
): Promise<string | null> {
  const norm = trailerPathWithinTrailers.replace(/\\/g, '/').trim()
  const rawExt = extname(norm)
  const stem = basename(norm, rawExt)
  const extLower = rawExt.toLowerCase()
  const relDir = norm.includes('/') ? norm.slice(0, Math.max(0, norm.lastIndexOf('/'))) : ''
  const trailersDir = join(root, 'trailers')

  await addExistingFile(paths, join(root, 'preview', norm))

  for (const pext of orderedPreviewExts(extLower)) {
    const name = stem + pext
    const relPath = relDir ? `${relDir}/${name}` : name
    if (relPath !== norm) {
      await addExistingFile(paths, join(root, 'preview', relPath))
    }
    for (const legacy of legacyPreviewBasenames(stem, pext)) {
      const legacyRel = relDir ? `${relDir}/${legacy}` : legacy
      await addExistingFile(paths, join(trailersDir, legacyRel))
    }
  }

  const previewRel = await resolvePreviewTrailerRel(root, norm)
  if (previewRel) {
    await addFilesForCatalogRel(root, previewRel, paths)
  }
  return previewRel
}

export type TitleDeletePathsResult = {
  trailerRel: string
  mainRel: string
  previewRel: string | null
  paths: string[]
}

export type OrphanTrailerPreviewPathsResult = {
  trailerRel: string
  expectedMainRel: string
  previewRel: string | null
  paths: string[]
}

async function collectTrailerPreviewPathsOnly(
  root: string,
  trailerRel: string,
  within: string,
  expectedMainRel: string,
): Promise<OrphanTrailerPreviewPathsResult | null> {
  const paths = new Set<string>()
  await addFilesForCatalogRel(root, trailerRel, paths)
  const previewRel = await addAllPreviewVideoPaths(root, within, paths)
  if (paths.size === 0) return null
  return {
    trailerRel,
    expectedMainRel,
    previewRel,
    paths: [...paths],
  }
}

/**
 * Trailer/preview(s) quando o vídeo completo já não existe na biblioteca (órfãos).
 */
export async function collectOrphanTrailerPreviewPaths(
  root: string,
  trailerRelRaw: string,
): Promise<OrphanTrailerPreviewPathsResult | null> {
  const trailerRel = trailerRelRaw.replace(/\\/g, '/').trim()
  if (!trailerRel.toLowerCase().startsWith('trailers/')) return null

  const within = trailerRel.slice('trailers/'.length).trim()
  if (!within || within.includes('..')) return null

  const guessedMain = trailerToMainFilename(within)
  if (!guessedMain) return null

  const foundMain = await findMainFileInSessionRoot(root, within)
  if (foundMain) return null

  return collectTrailerPreviewPathsOnly(
    root,
    trailerRel,
    within,
    guessedMain.replace(/\\/g, '/'),
  )
}

/**
 * Lista ficheiros de vídeo a enviar à Lixeira: completo na raiz, trailer, preview(s) e variantes legadas.
 */
export async function collectTitleVideoPathsForDeletion(
  root: string,
  trailerRelRaw: string,
): Promise<TitleDeletePathsResult | null> {
  const trailerRel = trailerRelRaw.replace(/\\/g, '/').trim()
  if (!trailerRel.toLowerCase().startsWith('trailers/')) return null

  const within = trailerRel.slice('trailers/'.length).trim()
  if (!within || within.includes('..')) return null

  const guessedMain = trailerToMainFilename(within)
  if (!guessedMain) return null

  const foundMain = await findMainFileInSessionRoot(root, within)
  const mainRel = (foundMain?.mainFilename ?? guessedMain).replace(/\\/g, '/')

  const paths = new Set<string>()
  await addFilesForCatalogRel(root, trailerRel, paths)
  await addFilesForCatalogRel(root, mainRel, paths)
  const previewRel = await addAllPreviewVideoPaths(root, within, paths)

  if (paths.size === 0) return null

  return {
    trailerRel,
    mainRel,
    previewRel,
    paths: [...paths],
  }
}

/** Remove JPEGs em `.thumb_cache/` para os `rel` de preview/trailer (antes de apagar os vídeos). */
export async function purgePreviewThumbCacheForTitle(
  root: string,
  rels: string[],
): Promise<number> {
  const seen = new Set<string>()
  let removed = 0

  for (const rel of rels) {
    const norm = rel.replace(/\\/g, '/').trim()
    if (!isPreviewCatalogRel(norm)) continue

    let mtimeMs = 0
    for (const p of resolveCatalogRelAbsoluteCandidates(root, norm)) {
      try {
        const st = await stat(p)
        if (st.isFile()) {
          mtimeMs = st.mtimeMs
          break
        }
      } catch {
        /* */
      }
    }
    if (!mtimeMs) continue

    for (let slot = 0; slot < PREVIEW_FRAME_SLOT_COUNT; slot++) {
      const jpg = previewFrameCacheFilePath(root, norm, slot, mtimeMs)
      if (seen.has(jpg)) continue
      seen.add(jpg)
      try {
        await unlink(jpg)
        removed++
      } catch {
        /* */
      }
    }
  }

  return removed
}
