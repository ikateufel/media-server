import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { getMainStemFromTrailerName, trailerToMainFilename, MAIN_COMPLETE_TRY_EXTS } from './trailerNames'

/** Vídeo completo na biblioteca: na raiz ou uma subpasta directa (mesmo layout que `findMainFileInSessionRoot`). */
const ROOT_VIDEO_EXT = new Set<string>(MAIN_COMPLETE_TRY_EXTS.map((e) => e.toLowerCase()))

const SKIP_ROOT_DIRS = new Set([
  'trailers',
  'preview',
  '.thumb_cache',
  'node_modules',
  '$RECYCLE.BIN',
  'System Volume Information',
])

/** Mesma lista que `previewTrailer.ts` para ficheiros em `preview/`. */
const PREVIEW_VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.avi'] as const

function orderedPreviewExts(trailerExt: string): readonly string[] {
  const e = trailerExt.toLowerCase()
  const rest = PREVIEW_VIDEO_EXTS.filter((x) => x !== e)
  return [e, ...rest] as unknown as readonly string[]
}

function isPreviewDirVideoExt(lowerExt: string): boolean {
  return (PREVIEW_VIDEO_EXTS as readonly string[]).some((x) => x === lowerExt)
}

export type LibraryCountsMode = 'counts' | 'pairing'

export interface LibraryFolderStatsResult {
  session: number
  title?: string
  path: string
  ok: boolean
  error?: string
  /** Vídeos completos na raiz mais uma subpasta directa (ex.: `Filme.mkv`, `Série/Filme.mkv`). */
  rootVideoCount?: number
  trailersDirExists?: boolean
  /** Ficheiros em `trailers/` que entram no catálogo. */
  trailerCatalogFiles?: number
  /** Ficheiros em `trailers/` que não são contados pelo catálogo (legado, previews antigos nessa pasta, etc.). */
  trailerIgnoredFiles?: number
  previewDirExists?: boolean
  /** Ficheiros de vídeo em `preview/` na raiz ou numa subpasta directa. */
  previewDirVideoFiles?: number
  /** Com pelo menos um ficheiro correspondente na pasta `preview/` (stem + extensões típicas). */
  trailersWithDedicatedPreview?: number
  /** Catálogo sem ficheiro dedicado só em `preview/` (playback via trailer ou legado em `trailers/`). */
  trailersWithoutDedicatedPreview?: number
  /** Ficheiros em `preview/` cujo stem não corresponde a nenhum trailer do catálogo. */
  previewOrphanVideoFiles?: number
}

async function dirExists(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isDirectory()
  } catch {
    return false
  }
}

async function safeReaddir(abs: string): Promise<{ name: string; isDir: boolean; isFile: boolean }[]> {
  const list = await readdir(abs, { withFileTypes: true })
  return list.map((d) => ({ name: d.name, isDir: d.isDirectory(), isFile: d.isFile() }))
}

async function countRootVideos(root: string): Promise<number> {
  const abs = resolve(root.trim())
  const entries = await safeReaddir(abs)
  let n = 0
  for (const e of entries) {
    const name = e.name
    if (name.startsWith('.')) continue
    if (e.isDir) {
      const lower = name.toLowerCase()
      if (
        SKIP_ROOT_DIRS.has(name) ||
        SKIP_ROOT_DIRS.has(lower) ||
        name.toUpperCase().startsWith('._')
      ) {
        continue
      }
      let subList: Awaited<ReturnType<typeof safeReaddir>>
      try {
        subList = await safeReaddir(join(abs, name))
      } catch {
        continue
      }
      for (const se of subList) {
        if (!se.isFile || se.name.startsWith('.')) continue
        const ex = extname(se.name).toLowerCase()
        if (ROOT_VIDEO_EXT.has(ex)) n++
      }
      continue
    }
    if (!e.isFile) continue
    const ex = extname(name).toLowerCase()
    if (ROOT_VIDEO_EXT.has(ex)) n++
  }
  return n
}

/** Ficheiros de vídeo em `preview/` na raiz ou numa subpasta directa (espelha `trailers/<sub>/`). */
async function countPreviewDirVideosOneLevel(previewAbs: string): Promise<number> {
  let n = 0
  const pEntries = await safeReaddir(previewAbs)
  for (const e of pEntries) {
    if (e.isFile) {
      if (e.name.startsWith('.')) continue
      if (isPreviewDirVideoExt(extname(e.name).toLowerCase())) n++
      continue
    }
    if (!e.isDir || e.name.startsWith('.')) continue
    let subList: Awaited<ReturnType<typeof safeReaddir>>
    try {
      subList = await safeReaddir(join(previewAbs, e.name))
    } catch {
      continue
    }
    for (const se of subList) {
      if (!se.isFile || se.name.startsWith('.')) continue
      if (isPreviewDirVideoExt(extname(se.name).toLowerCase())) n++
    }
  }
  return n
}

async function countPreviewOrphansOneLevel(
  previewAbs: string,
  trailerStems: Set<string>,
): Promise<number> {
  let orphans = 0
  const pEntries = await safeReaddir(previewAbs)
  for (const e of pEntries) {
    if (e.isFile) {
      if (e.name.startsWith('.')) continue
      const ext = extname(e.name).toLowerCase()
      if (!isPreviewDirVideoExt(ext)) continue
      const stemLower = basename(e.name, ext).toLowerCase()
      if (!trailerStems.has(stemLower)) orphans++
      continue
    }
    if (!e.isDir || e.name.startsWith('.')) continue
    let subList: Awaited<ReturnType<typeof safeReaddir>>
    try {
      subList = await safeReaddir(join(previewAbs, e.name))
    } catch {
      continue
    }
    for (const se of subList) {
      if (!se.isFile || se.name.startsWith('.')) continue
      const ext = extname(se.name).toLowerCase()
      if (!isPreviewDirVideoExt(ext)) continue
      const stemLower = basename(se.name, ext).toLowerCase()
      if (!trailerStems.has(stemLower)) orphans++
    }
  }
  return orphans
}

async function hasDedicatedPreviewUnderPreview(root: string, trailerRelative: string): Promise<boolean> {
  const norm = trailerRelative.replace(/\\/g, '/')
  const guessed = trailerToMainFilename(norm)
  if (!guessed) return false
  const rawExt = extname(norm)
  const stem = basename(guessed, extname(guessed))
  const relDir = norm.includes('/') ? norm.slice(0, Math.max(0, norm.lastIndexOf('/'))) : ''

  try {
    const st = await stat(join(root.trim(), 'preview', norm))
    if (st.isFile()) return true
  } catch {
    /* */
  }
  for (const pext of orderedPreviewExts(rawExt)) {
    const name = stem + pext
    const relPath = relDir ? `${relDir}/${name}` : name
    if (relPath === norm) continue
    try {
      const st = await stat(join(root.trim(), 'preview', relPath))
      if (st.isFile()) return true
    } catch {
      /* */
    }
  }
  return false
}

/**
 * Analisa uma raiz de biblioteca: contagens; opcionalmente cruzamento `trailers/` ↔ `preview/`.
 */
export async function analyzeLibraryFolder(
  rootRaw: string,
  sessionIndex: number,
  mode: LibraryCountsMode,
): Promise<LibraryFolderStatsResult> {
  const pathTrim = rootRaw.trim()
  const session = sessionIndex
  const base: LibraryFolderStatsResult = { session, path: pathTrim, ok: false }

  if (!pathTrim) {
    return { ...base, ok: false, error: 'Caminho vazio.' }
  }

  const root = resolve(pathTrim)
  try {
    const stRoot = await stat(root)
    if (!stRoot.isDirectory()) {
      return { ...base, path: root, ok: false, error: 'O caminho não é uma pasta.' }
    }
  } catch {
    return { ...base, path: root, ok: false, error: 'Pasta inacessível ou inexistente.' }
  }

  const trailersAbs = join(root, 'trailers')
  const previewAbs = join(root, 'preview')
  const trailersDirExists = await dirExists(trailersAbs)
  const previewDirExists = await dirExists(previewAbs)

  let trailerCatalogFiles = 0
  let trailerIgnoredFiles = 0
  const trailerStemsForOrphans = new Set<string>()
  let previewDirVideoFiles = 0

  if (trailersDirExists) {
    const tEntries = await safeReaddir(trailersAbs)
    for (const e of tEntries) {
      if (e.isFile) {
        const guessed = trailerToMainFilename(e.name)
        if (!guessed) {
          trailerIgnoredFiles++
          continue
        }
        trailerCatalogFiles++
        const stem = getMainStemFromTrailerName(e.name)
        if (stem) trailerStemsForOrphans.add(stem.toLowerCase())
        continue
      }
      if (!e.isDir || e.name.startsWith('.')) continue
      let subList: Awaited<ReturnType<typeof safeReaddir>>
      try {
        subList = await safeReaddir(join(trailersAbs, e.name))
      } catch {
        continue
      }
      for (const se of subList) {
        if (!se.isFile) continue
        const relWithin = `${e.name}/${se.name}`
        const guessed = trailerToMainFilename(se.name)
        if (!guessed) {
          trailerIgnoredFiles++
          continue
        }
        trailerCatalogFiles++
        const stem = getMainStemFromTrailerName(relWithin)
        if (stem) trailerStemsForOrphans.add(stem.toLowerCase())
      }
    }
  }

  if (previewDirExists) {
    previewDirVideoFiles = await countPreviewDirVideosOneLevel(previewAbs)
  }

  const rootVideoCount = await countRootVideos(root)

  const out: LibraryFolderStatsResult = {
    session,
    path: root,
    ok: true,
    rootVideoCount,
    trailersDirExists,
    trailerCatalogFiles,
    trailerIgnoredFiles,
    previewDirExists,
    previewDirVideoFiles,
  }

  if (mode === 'pairing' && trailersDirExists && trailerCatalogFiles > 0) {
    let dedicated = 0
    const tEntries = await safeReaddir(trailersAbs)
    for (const e of tEntries) {
      if (e.isFile) {
        if (!trailerToMainFilename(e.name)) continue
        if (await hasDedicatedPreviewUnderPreview(root, e.name)) dedicated++
        continue
      }
      if (!e.isDir || e.name.startsWith('.')) continue
      let subList: Awaited<ReturnType<typeof safeReaddir>>
      try {
        subList = await safeReaddir(join(trailersAbs, e.name))
      } catch {
        continue
      }
      for (const se of subList) {
        if (!se.isFile) continue
        const relWithin = `${e.name}/${se.name}`
        if (!trailerToMainFilename(se.name)) continue
        if (await hasDedicatedPreviewUnderPreview(root, relWithin)) dedicated++
      }
    }
    out.trailersWithDedicatedPreview = dedicated
    out.trailersWithoutDedicatedPreview = trailerCatalogFiles - dedicated
  }

  if (mode === 'pairing' && previewDirExists) {
    out.previewOrphanVideoFiles = await countPreviewOrphansOneLevel(
      previewAbs,
      trailerStemsForOrphans,
    )
  }

  return out
}
