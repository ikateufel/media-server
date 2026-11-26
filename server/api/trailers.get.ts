import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { createError, getQuery } from 'h3'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import {
  catalogLoadFiltersActive,
  parseCatalogLoadFilters,
  resolveCatalogScanOptions,
} from '../utils/catalogLoadFilters'
import { ensureSessionCatalogTagRepair } from '../utils/catalogTagRepair'
import { dedupeCatalogItemsByPhysicalVideo, dropPhysicalGroupsWithDeniedRel } from '../utils/catalogPhysicalKey'
import {
  enrichTrailerListForSession,
  scanTrailersCatalogInRoot,
  tagSuggestionsForSession,
} from '../utils/trailerCatalogScan'
import { getFastPlaySettingsFromDisk, getVideoMenuItems, getVideoRootsFromRuntime } from '../utils/videoMenu'
import { parseSessionQuery } from '../utils/videoSession'
import { isTrashLibrarySession } from '../utils/trashLibrary'
import { requireCatalogUnlock } from '../utils/catalogAccess'

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.wmv'])

async function collectMainOnlyEntries(root: string): Promise<TrailerListEntry[]> {
  const out: TrailerListEntry[] = []
  const rootEntries = await readdir(root, { withFileTypes: true })

  function pushMain(mainRel: string, st: { size: number; mtimeMs: number }, folderName?: string) {
    const fileName = basename(mainRel)
    const stem = basename(fileName, extname(fileName))
    const label = folderName ? `${folderName}-${stem}` : stem
    out.push({
      // Sem trailers: mantém shape da UI e evita crash de keying/map.
      trailerRel: `trailers/${mainRel}`.replace(/\\/g, '/'),
      previewRel: null,
      mainRel: mainRel.replace(/\\/g, '/'),
      mainFilename: mainRel.replace(/\\/g, '/'),
      label,
      trailerSizeBytes: 0,
      hasMain: true,
      mainSizeBytes: st.size,
      mainSortTimeMs: st.mtimeMs,
      watchedSeconds: null,
      tags: [],
    })
  }

  for (const e of rootEntries) {
    if (e.isFile()) {
      const ext = extname(e.name).toLowerCase()
      if (!VIDEO_EXT.has(ext)) continue
      try {
        const st = await stat(join(root, e.name))
        if (!st.isFile()) continue
        pushMain(e.name, st)
      } catch {
        /* ignore */
      }
      continue
    }
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const low = e.name.toLowerCase()
    if (low === 'trailers' || low === 'preview') continue
    let subEntries: Awaited<ReturnType<typeof readdir>>
    try {
      subEntries = await readdir(join(root, e.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const se of subEntries) {
      if (!se.isFile()) continue
      const ext = extname(se.name).toLowerCase()
      if (!VIDEO_EXT.has(ext)) continue
      const rel = `${e.name}/${se.name}`.replace(/\\/g, '/')
      try {
        const st = await stat(join(root, e.name, se.name))
        if (!st.isFile()) continue
        pushMain(rel, st, e.name)
      } catch {
        /* ignore */
      }
    }
  }
  return out
}

export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Defina pastas no menu (Admin / SQLite) ou VIDEO_ROOT no .env.',
    })
  }

  const session = parseSessionQuery(getQuery(event) as Record<string, unknown>, roots.length)
  const root = roots[session].trim()

  try {
    await stat(root)
  } catch {
    throw createError({ statusCode: 503, statusMessage: `VIDEO_ROOT inexistente ou inacessível: ${root}` })
  }

  let items: TrailerListEntry[] = []
  let catalogMode: 'trailers' | 'main-only' = 'trailers'
  const filters = parseCatalogLoadFilters(event)
  const { scan: scanOpts, stats: catalogStats, postDeny } = await resolveCatalogScanOptions(session, filters)
  const filtersActive = catalogLoadFiltersActive(filters)

  try {
    const scanned = await scanTrailersCatalogInRoot(root, scanOpts)
    await ensureSessionCatalogTagRepair(
      session,
      root,
      scanned.items.map((e) => e.trailerRel),
    )
    // Favoritos/destaques "excluir": vale por vídeo físico (inclui entradas alias do mesmo vídeo).
    items = dedupeCatalogItemsByPhysicalVideo(dropPhysicalGroupsWithDeniedRel(scanned.items, postDeny))
    await enrichTrailerListForSession(session, items, scanned.mainStatsByRel)
  } catch {
    // Catálogo em trailers/ ou pastas legado inacessível: tenta só vídeos completos na raiz.
    items = await collectMainOnlyEntries(root)
    catalogMode = 'main-only'
  }

  if (!items.length && !filtersActive) {
    const fallback = await collectMainOnlyEntries(root)
    if (fallback.length) {
      items = fallback
      catalogMode = 'main-only'
    }
  }

  // Fallback main-only: aplicar filtros em memória (não há allowlist de disco).
  if (catalogMode === 'main-only' && filtersActive && items.length) {
    items = items.filter((e) => {
      const tags = e.tags ?? []
      if (filters.tag && !tags.some((t) => t.trim().toLowerCase() === filters.tag!.toLowerCase())) {
        return false
      }
      if (filters.folderQ) {
        const q = filters.folderQ.toLowerCase()
        if (filters.folderMode === 'tags') {
          if (!tags.some((t) => t.toLowerCase().includes(q))) return false
        } else {
          const hay = `${e.label ?? ''} ${e.mainFilename ?? ''} ${e.trailerRel ?? ''} ${e.mainRel ?? ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
      }
      if (filters.watchedOnly) {
        const watched = tags.some((t) => {
          const n = t.trim().toLowerCase()
          return n === 'concluido' || n === 'memoravel'
        })
        if (!watched) return false
      }
      if (filters.favorite === 'only' && e.isFavorite !== true) return false
      if (filters.favorite === 'exclude' && e.isFavorite === true) return false
      return true
    })
  }

  const menu = getVideoMenuItems(config)
  if (isTrashLibrarySession(session, menu)) {
    items = items.filter((e) => e.isFavorite !== true)
  }

  return {
    session,
    rootLabel: basename(resolve(root)),
    items,
    tagSuggestions: tagSuggestionsForSession(session),
    catalogMode,
    catalogStats,
    catalogFiltered: filtersActive,
    /** Cliente: só para decidir UI (ex. botão Explorador em Windows). */
    serverPlatform: process.platform,
    fastPlay: getFastPlaySettingsFromDisk(),
  }
})
