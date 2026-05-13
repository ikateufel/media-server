import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { createError, getQuery } from 'h3'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import {
  enrichTrailerListForSession,
  scanTrailersCatalogInRoot,
  tagSuggestionsForSession,
} from '../utils/trailerCatalogScan'
import { getFastPlaySettingsFromDisk, getVideoRootsFromRuntime } from '../utils/videoMenu'
import { getResolvedAdminToken } from '../utils/requireAdmin'
import { parseSessionQuery } from '../utils/videoSession'

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
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Defina pastas em data/video-menu.json ou VIDEO_ROOT no .env.',
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

  try {
    const scanned = await scanTrailersCatalogInRoot(root)
    items = scanned.items
    await enrichTrailerListForSession(session, items, scanned.mainStatsByRel)
  } catch {
    // Catálogo em trailers/ ou pastas legado inacessível: tenta só vídeos completos na raiz.
    items = await collectMainOnlyEntries(root)
    catalogMode = 'main-only'
  }

  if (!items.length) {
    const fallback = await collectMainOnlyEntries(root)
    if (fallback.length) {
      items = fallback
      catalogMode = 'main-only'
    }
  }

  const adminToken = getResolvedAdminToken(event) ?? ''

  return {
    session,
    rootLabel: basename(resolve(root)),
    items,
    tagSuggestions: tagSuggestionsForSession(session),
    catalogMode,
    /** Cliente: só para decidir UI (ex. botão Explorador em Windows). */
    serverPlatform: process.platform,
    /** `true` quando VIDEO_ADMIN_TOKEN está definido — necessário para `/api/admin/reveal-in-explorer`. */
    adminRevealExplorer: adminToken.length > 0,
    fastPlay: getFastPlaySettingsFromDisk(),
  }
})
