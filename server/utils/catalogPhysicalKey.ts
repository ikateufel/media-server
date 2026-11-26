import { basename } from 'node:path'
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import { legacyTrailerBasenameToFlat } from './trailerNames'

/** Prioridade menor = trailer_rel preferido como chave canónica em SQLite. */
export function trailerRelCanonicalPriority(trailerRel: string): number {
  const norm = trailerRel.replace(/\\/g, '/').trim()
  const file = basename(norm)
  if (file.toLowerCase().startsWith('preview.')) return 200
  if (legacyTrailerBasenameToFlat(file)) return 100
  const within = norm.replace(/^trailers\//i, '')
  if (within.split('/').filter(Boolean).length > 2) return 50
  return 0
}

export function pickCanonicalTrailerRel(trailerRels: string[]): string {
  const uniq = [...new Set(trailerRels.map((r) => r.replace(/\\/g, '/').trim()).filter(Boolean))]
  if (!uniq.length) return ''
  if (uniq.length === 1) return uniq[0]!
  return [...uniq].sort((a, b) => {
    const pa = trailerRelCanonicalPriority(a)
    const pb = trailerRelCanonicalPriority(b)
    if (pa !== pb) return pa - pb
    if (a.length !== b.length) return a.length - b.length
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })[0]!
}

/** Chave de agrupamento: um cartão por vídeo completo (ou por trailer se não houver main). */
export function physicalVideoGroupKey(entry: Pick<TrailerListEntry, 'trailerRel' | 'mainRel' | 'hasMain'>): string {
  if (entry.hasMain && entry.mainRel.trim()) {
    return `main:${entry.mainRel.replace(/\\/g, '/').trim()}`
  }
  return `trailer:${entry.trailerRel.replace(/\\/g, '/').trim()}`
}

export function pickBestCatalogEntry(group: TrailerListEntry[]): TrailerListEntry {
  if (group.length === 1) return group[0]!
  const canonicalRel = pickCanonicalTrailerRel(group.map((e) => e.trailerRel))
  const match = group.find((e) => e.trailerRel === canonicalRel)
  if (match) return match
  return [...group].sort((a, b) => {
    const pa = trailerRelCanonicalPriority(a.trailerRel)
    const pb = trailerRelCanonicalPriority(b.trailerRel)
    if (pa !== pb) return pa - pb
    return a.trailerRel.localeCompare(b.trailerRel, undefined, { sensitivity: 'base' })
  })[0]!
}

/**
 * Remove os vídeos físicos que têm QUALQUER `trailerRel` no conjunto `deny`.
 *
 * Um mesmo vídeo pode aparecer no scan com mais de uma chave (ex.: `trailers/x.mp4` e
 * `trailers/Pasta.XXX/x.mp4`). O favorito fica na chave canónica; filtrar só pela chave
 * exata deixava a entrada "alias" na lista "Sem favoritos", e o clique no favorito
 * acabava alternando a chave canónica (desmarcando o vídeo).
 */
export function dropPhysicalGroupsWithDeniedRel(
  items: TrailerListEntry[],
  deny: Set<string> | null | undefined,
): TrailerListEntry[] {
  if (!deny || deny.size === 0) return items
  const denied = new Set<string>()
  for (const it of items) {
    if (deny.has(it.trailerRel)) denied.add(physicalVideoGroupKey(it))
  }
  if (denied.size === 0) return items
  return items.filter((it) => !denied.has(physicalVideoGroupKey(it)))
}

/**
 * Um cartão por vídeo físico (mesmo `mainRel`). Evita duplicados quando existem
 * `trailers/Filme.mkv` + `trailers/zz_Filme_acelerado.*` ou scan legado + `trailers/`.
 */
export function dedupeCatalogItemsByPhysicalVideo(items: TrailerListEntry[]): TrailerListEntry[] {
  const groups = new Map<string, TrailerListEntry[]>()
  for (const it of items) {
    const key = physicalVideoGroupKey(it)
    const g = groups.get(key) ?? []
    g.push(it)
    groups.set(key, g)
  }
  const out: TrailerListEntry[] = []
  for (const g of groups.values()) {
    out.push(pickBestCatalogEntry(g))
  }
  return out
}
