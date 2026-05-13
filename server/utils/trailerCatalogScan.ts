import type { Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import { resolvePreviewTrailerRel } from './previewTrailer'
import {
  findMainFileInSessionRoot,
  folderPairWordsTag,
  gridLabelForTrailersSubfolder,
  parseTrailersDirRelativePath,
  resolveCatalogRelAbsoluteCandidates,
  trailerToMainFilename,
} from './trailerNames'
import { getFavoriteSet, getFullProgressMap } from './libraryState'
import {
  getMainMetaMap,
  getTagsMapForSession,
  listTagNamesForSession,
  upsertMainFileMeta,
} from './videoTagsDb'

function pickMainSortTimeMs(st: Stats): number {
  const b = st.birthtimeMs
  if (Number.isFinite(b) && b > 0) return b
  return st.mtimeMs
}

function mergeFolderPairIntoTags(tags: string[] | undefined, folderPair: string | undefined): string[] {
  const base = [...(tags ?? [])]
  if (!folderPair) return base
  const low = folderPair.toLowerCase()
  if (base.some((t) => t.trim().toLowerCase() === low)) return base
  return [...base, folderPair]
}

/**
 * Constrói uma entrada do catálogo para um caminho relativo em `trailers/`
 * (`ficheiro.ext` ou `subpasta/ficheiro.ext` — só um nível de subpasta).
 */
export async function buildTrailerEntryFromTrailersBasename(
  root: string,
  trailerPathWithinTrailersDir: string,
): Promise<{ entry: TrailerListEntry; mainStat: Stats | null } | null> {
  const norm = trailerPathWithinTrailersDir.replace(/\\/g, '/').trim()
  const parsed = parseTrailersDirRelativePath(norm)
  if (!parsed) return null

  const { subfolder, fileName } = parsed
  const guessedMain = trailerToMainFilename(fileName)
  if (!guessedMain) return null

  const trailerCandidates = resolveCatalogRelAbsoluteCandidates(root, `trailers/${norm}`)
  const trailerRel = `trailers/${norm}`.replace(/\\/g, '/')

  let trailerSizeBytes = 0
  let trailerFound = false
  for (const p of trailerCandidates) {
    try {
      const s = await stat(p)
      if (!s.isFile()) continue
      trailerSizeBytes = s.size
      trailerFound = true
      break
    } catch {
      /* try next */
    }
  }
  if (!trailerFound) {
    return null
  }

  const foundMain = await findMainFileInSessionRoot(root.trim(), norm)
  const hasMain = !!foundMain
  const mainFilename = foundMain?.mainFilename ?? guessedMain
  const mainRel = mainFilename.replace(/\\/g, '/')
  const mainStat = foundMain?.stat ?? null

  const previewRel = await resolvePreviewTrailerRel(root, norm)

  const label =
    subfolder != null
      ? gridLabelForTrailersSubfolder(subfolder, fileName)
      : basename(mainFilename, extname(mainFilename))
  const folderPairTag = subfolder != null ? folderPairWordsTag(subfolder) || undefined : undefined

  const entry: TrailerListEntry = {
    trailerRel,
    previewRel,
    mainRel,
    mainFilename,
    label,
    folderPairTag,
    trailerSizeBytes,
    hasMain,
    mainSizeBytes: mainStat?.size ?? 0,
    mainSortTimeMs: mainStat ? pickMainSortTimeMs(mainStat) : 0,
  }

  return { entry, mainStat }
}

export async function scanTrailersCatalogInRoot(root: string): Promise<{
  items: TrailerListEntry[]
  mainStatsByRel: Map<string, Stats>
}> {
  const rootTrim = root.trim()
  const trailersDir = join(rootTrim, 'trailers')
  /** Sem `trailers/` na raiz ainda há catálogo legado em `<pasta>/trailers/` (ex.: pastas por atriz). */
  let dirents: Awaited<ReturnType<typeof readdir>>
  try {
    dirents = await readdir(trailersDir, { withFileTypes: true })
  } catch {
    dirents = []
  }
  const items: TrailerListEntry[] = []
  const mainStatsByRel = new Map<string, Stats>()

  for (const d of dirents) {
    if (d.isFile()) {
      const built = await buildTrailerEntryFromTrailersBasename(rootTrim, d.name)
      if (!built) continue
      if (built.mainStat) mainStatsByRel.set(built.entry.mainRel, built.mainStat)
      items.push(built.entry)
      continue
    }

    if (!d.isDirectory() || d.name.startsWith('.')) continue

    let subFiles: typeof dirents
    try {
      subFiles = await readdir(join(trailersDir, d.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const f of subFiles) {
      if (!f.isFile()) continue
      const relWithin = `${d.name}/${f.name}`.replace(/\\/g, '/')
      const built = await buildTrailerEntryFromTrailersBasename(rootTrim, relWithin)
      if (!built) continue
      if (built.mainStat) mainStatsByRel.set(built.entry.mainRel, built.mainStat)
      items.push(built.entry)
    }
  }

  // Compat legado: sessão com subpastas por "atriz", onde cada uma guarda `trailers/`.
  const rootDirents = await readdir(rootTrim, { withFileTypes: true })
  for (const d of rootDirents) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue
    const low = d.name.toLowerCase()
    if (low === 'trailers' || low === 'preview') continue
    let actressTrailers: Awaited<ReturnType<typeof readdir>>
    try {
      actressTrailers = await readdir(join(rootTrim, d.name, 'trailers'), { withFileTypes: true })
    } catch {
      continue
    }
    for (const f of actressTrailers) {
      if (!f.isFile()) continue
      const relWithin = `${d.name}/${f.name}`.replace(/\\/g, '/')
      const built = await buildTrailerEntryFromTrailersBasename(rootTrim, relWithin)
      if (!built) continue
      if (built.mainStat) mainStatsByRel.set(built.entry.mainRel, built.mainStat)
      items.push(built.entry)
    }
  }

  return { items, mainStatsByRel }
}

/**
 * Actualiza meta de ficheiro, favoritos, tags e progresso — mesmo contrato que `trailers.get`.
 */
export async function enrichTrailerListForSession(
  session: number,
  items: TrailerListEntry[],
  mainStatsByRel: Map<string, Stats>,
): Promise<void> {
  const mainRelsWithFile = [...mainStatsByRel.keys()]
  const cached = getMainMetaMap(session, mainRelsWithFile)

  for (const it of items) {
    if (!it.hasMain) continue
    const st = mainStatsByRel.get(it.mainRel)
    if (!st) continue
    const row = cached.get(it.mainRel)
    const same = row && row.mtime_ms === st.mtimeMs && row.size_bytes === st.size
    const birthRaw = st.birthtimeMs
    const birthtimeMs =
      Number.isFinite(birthRaw) && birthRaw > 0 ? Math.round(birthRaw) : null
    if (!same) {
      upsertMainFileMeta(session, it.mainRel, st.size, st.mtimeMs, birthtimeMs)
    }
    it.mainSizeBytes = st.size
    it.mainSortTimeMs = pickMainSortTimeMs(st)
  }

  const favSet = await getFavoriteSet(session)
  const progressMap = await getFullProgressMap(session)
  const tagMap = getTagsMapForSession(
    session,
    items.map((it) => it.trailerRel),
  )

  for (const it of items) {
    it.isFavorite = favSet.has(it.trailerRel)
    const fromDb = tagMap.get(it.trailerRel) ?? []
    it.tags = mergeFolderPairIntoTags(fromDb, it.folderPairTag)
    const sec = progressMap.get(it.mainRel)
    it.watchedSeconds = typeof sec === 'number' && Number.isFinite(sec) ? sec : null
  }
}

/** Metadados de catálogo (meta cache SQLite, favoritos, progresso, tags) para uma entrada isolada. */
export async function enrichSingleTrailerEntryForSession(
  session: number,
  entry: TrailerListEntry,
  mainStat: Stats | null,
): Promise<void> {
  const map = new Map<string, Stats>()
  if (mainStat) map.set(entry.mainRel, mainStat)
  await enrichTrailerListForSession(session, [entry], map)
}

/** Para `trailers.get` — sugestões de tags da sessão. */
export function tagSuggestionsForSession(session: number): string[] {
  return listTagNamesForSession(session)
}
