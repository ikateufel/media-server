import { stat } from 'node:fs/promises'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import {
  buildTrailerEntryFromTrailersBasename,
  enrichSingleTrailerEntryForSession,
} from './trailerCatalogScan'
import { isCatalogTrailerRelSuffix } from './trailerNames'
import { normalizeTrailerRel } from './recentPlaybackDb'

export interface CatalogPlaybackRow {
  session: number
  trailerRel: string
  /** Epoch ms para ordenação na UI (`highlightedAtMs`). */
  orderMs?: number
  touchedAt?: string
}

/** Constrói entradas de catálogo a partir de linhas session+trailerRel (Destaques, Surpresa, Últimos vistos). */
export async function buildCatalogEntriesFromPlaybackRows(
  rows: CatalogPlaybackRow[],
  roots: string[],
): Promise<{ items: TrailerListEntry[]; tagSuggestions: string[] }> {
  const items: TrailerListEntry[] = []
  const tagSuggestions = new Set<string>()

  for (const row of rows) {
    if (!Number.isFinite(row.session) || row.session < 0 || row.session >= roots.length) continue
    const root = roots[row.session]!.trim()
    try {
      await stat(root)
    } catch {
      continue
    }

    const norm = normalizeTrailerRel(row.trailerRel)
    if (!norm.startsWith('trailers/')) continue
    const trailerName = norm.slice('trailers/'.length)
    if (!trailerName || !isCatalogTrailerRelSuffix(trailerName)) continue

    const pair = await buildTrailerEntryFromTrailersBasename(root, trailerName)
    if (!pair) continue

    await enrichSingleTrailerEntryForSession(row.session, pair.entry, pair.mainStat)
    pair.entry.librarySession = row.session

    let orderMs = row.orderMs
    if (orderMs === undefined && row.touchedAt) {
      const parsed = Date.parse(row.touchedAt)
      if (Number.isFinite(parsed)) orderMs = parsed
    }
    if (orderMs !== undefined && Number.isFinite(orderMs)) {
      pair.entry.highlightedAtMs = orderMs
    }

    items.push(pair.entry)
    for (const t of pair.entry.tags ?? []) tagSuggestions.add(t)
  }

  return {
    items,
    tagSuggestions: [...tagSuggestions].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    ),
  }
}
