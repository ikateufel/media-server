import { stat } from 'node:fs/promises'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import { PARTIAL_WATCHED_THRESHOLD_SECONDS } from '~/composables/useVideoFolder'
import { getFavoriteSet, getFullProgressMap } from './libraryState'
import { buildTrailerEntryFromTrailersBasename, scanTrailersCatalogInRoot } from './trailerCatalogScan'
import {
  getTagsMapForSession,
  isCompletedTagName,
  isMemorableTagName,
  isTrailerWatchedTagName,
} from './videoTagsDb'
import { normalizeTrailerRel, readRecentPlaybackList, readTrailerViewHistoryList } from './recentPlaybackDb'
import {
  createSurpriseBatch,
  getActiveSurpriseBatchId,
  markSurpriseBatchViewed,
  readSurprisePicks,
  SURPRISE_PICKS_PER_SESSION,
  type SurprisePickRow,
} from './surpriseDb'
import { buildCatalogEntriesFromPlaybackRows } from './buildCatalogFromPlaybackRows'
import type { VideoMenuItem } from './videoMenu'
import { isTrashLibrarySession } from './trashLibrary'

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
}

function playbackKey(session: number, trailerRel: string): string {
  return `${Math.max(0, Math.floor(session))}:${normalizeTrailerRel(trailerRel)}`
}

interface SurpriseEngagementSets {
  destaquesKeys: Set<string>
  viewHistoryKeys: Set<string>
  favoriteKeys: Set<string>
}

async function buildSurpriseEngagementSets(roots: string[]): Promise<SurpriseEngagementSets> {
  const destaquesKeys = new Set<string>()
  for (const r of readRecentPlaybackList()) {
    destaquesKeys.add(playbackKey(r.session, r.trailerRel))
  }
  const viewHistoryKeys = new Set<string>()
  for (const r of readTrailerViewHistoryList(10_000)) {
    viewHistoryKeys.add(playbackKey(r.session, r.trailerRel))
  }
  const favoriteKeys = new Set<string>()
  for (let session = 0; session < roots.length; session++) {
    const favSet = await getFavoriteSet(session)
    for (const rel of favSet) {
      favoriteKeys.add(playbackKey(session, rel))
    }
  }
  return { destaquesKeys, viewHistoryKeys, favoriteKeys }
}

/** Sai do lote activo da Surpresa só quando o trailer foi visto até ao fim. */
function shouldLeaveSurpriseBatch(tags: string[] | undefined): boolean {
  return (tags ?? []).some((t) => isTrailerWatchedTagName(t))
}

/** Só entra num lote novo quem é totalmente inédito. */
function isEligibleForNewSurprisePick(opts: {
  tags: string[] | undefined
  watchedSeconds: number | null | undefined
  session: number
  trailerRel: string
  destaquesKeys: Set<string>
  viewHistoryKeys: Set<string>
  favoriteKeys: Set<string>
}): boolean {
  const tags = opts.tags ?? []
  if (tags.some((t) => isTrailerWatchedTagName(t))) return false
  if (tags.some((t) => isCompletedTagName(t) || isMemorableTagName(t))) return false
  const sec = opts.watchedSeconds
  if (typeof sec === 'number' && Number.isFinite(sec) && sec >= PARTIAL_WATCHED_THRESHOLD_SECONDS) {
    return false
  }
  const key = playbackKey(opts.session, opts.trailerRel)
  if (opts.destaquesKeys.has(key) || opts.favoriteKeys.has(key) || opts.viewHistoryKeys.has(key)) {
    return false
  }
  return true
}

async function generateSurprisePicks(roots: string[], menu: VideoMenuItem[]): Promise<SurprisePickRow[]> {
  const out: SurprisePickRow[] = []
  let order = 0
  const engagement = await buildSurpriseEngagementSets(roots)

  for (let session = 0; session < roots.length; session++) {
    if (isTrashLibrarySession(session, menu)) continue
    const root = roots[session]!.trim()
    try {
      await stat(root)
    } catch {
      continue
    }

    const scanned = await scanTrailersCatalogInRoot(root)
    const tagMap = getTagsMapForSession(
      session,
      scanned.items.map((e) => e.trailerRel),
    )
    const progressMap = await getFullProgressMap(session)

    const pool: TrailerListEntry[] = []
    for (const it of scanned.items) {
      if (!it.hasMain) continue
      const watchedSeconds = progressMap.get(it.mainRel) ?? null
      if (
        !isEligibleForNewSurprisePick({
          tags: tagMap.get(it.trailerRel),
          watchedSeconds,
          session,
          trailerRel: it.trailerRel,
          destaquesKeys: engagement.destaquesKeys,
          viewHistoryKeys: engagement.viewHistoryKeys,
          favoriteKeys: engagement.favoriteKeys,
        })
      ) {
        continue
      }
      pool.push(it)
    }

    shuffleInPlace(pool)
    const take = Math.min(SURPRISE_PICKS_PER_SESSION, pool.length)
    for (let i = 0; i < take; i++) {
      const e = pool[i]!
      out.push({
        session,
        trailerRel: e.trailerRel,
        pickOrder: order++,
      })
    }
  }

  return out
}

async function filterActiveSurprisePicks(
  picks: SurprisePickRow[],
  roots: string[],
): Promise<SurprisePickRow[]> {
  if (!picks.length) return picks
  const out: SurprisePickRow[] = []
  for (const p of picks) {
    if (p.session < 0 || p.session >= roots.length) continue
    const root = roots[p.session]!.trim()
    const norm = normalizeTrailerRel(p.trailerRel)
    if (!norm.startsWith('trailers/')) continue
    const trailerName = norm.slice('trailers/'.length)
    const built = await buildTrailerEntryFromTrailersBasename(root, trailerName)
    if (!built?.entry.hasMain) continue
    const tagMap = getTagsMapForSession(p.session, [built.entry.trailerRel])
    if (!shouldLeaveSurpriseBatch(tagMap.get(built.entry.trailerRel))) {
      out.push(p)
    }
  }
  return out
}

/** Lista Surpresa activa ou nova (5 aleatórios inéditos por pasta). */
export async function resolveSurpriseCatalogItems(
  roots: string[],
  menu: VideoMenuItem[],
): Promise<{
  items: TrailerListEntry[]
  tagSuggestions: string[]
  batchId: number | null
}> {
  let batchId = getActiveSurpriseBatchId()
  let picks = batchId !== null ? readSurprisePicks(batchId) : []

  if (batchId !== null && picks.length) {
    const stillActive = await filterActiveSurprisePicks(picks, roots)
    if (!stillActive.length) {
      markSurpriseBatchViewed(batchId)
      batchId = null
      picks = []
    } else if (stillActive.length !== picks.length) {
      markSurpriseBatchViewed(batchId)
      batchId = createSurpriseBatch(stillActive)
      picks = stillActive
    } else {
      picks = stillActive
    }
  }

  if (batchId !== null && !picks.length) {
    markSurpriseBatchViewed(batchId)
    batchId = null
    picks = []
  }

  if (batchId === null) {
    picks = await generateSurprisePicks(roots, menu)
    if (picks.length) {
      batchId = createSurpriseBatch(picks)
    }
  }

  const rows = picks.map((p) => ({
    session: p.session,
    trailerRel: p.trailerRel,
    orderMs: p.pickOrder,
  }))

  const built = await buildCatalogEntriesFromPlaybackRows(rows, roots)
  return { ...built, batchId }
}
