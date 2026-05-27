import { pickCanonicalTrailerRel } from './catalogPhysicalKey'
import { remapFavoriteTrailerRel, getFavoriteSet } from './libraryState'
import { remapRecentPlaybackTrailerRel } from './recentPlaybackDb'
import { findMainFileInSessionRoot } from './trailerNames'
import { getVideoTagsDb, runVideoTagsTxn } from './videoTagsDb'

function normalizeTrailerRel(rel: string): string {
  return rel.replace(/\\/g, '/').trim()
}

async function mainRelForTrailerOnDisk(
  root: string,
  trailerRel: string,
): Promise<string | null> {
  const norm = normalizeTrailerRel(trailerRel)
  if (!norm.toLowerCase().startsWith('trailers/')) return null
  const within = norm.slice('trailers/'.length)
  const found = await findMainFileInSessionRoot(root.trim(), within)
  return found ? found.mainFilename.replace(/\\/g, '/') : null
}

/** Todos os `trailer_rel` conhecidos na sessão (tags, favoritos, recentes). */
export function collectSessionTrailerRelSources(session: number, favoriteRels?: Iterable<string>): string[] {
  const d = getVideoTagsDb()
  const s = Math.max(0, Math.floor(session))
  const out = new Set<string>()

  const tagRows = d
    .prepare('SELECT DISTINCT trailer_rel FROM video_tags WHERE session = ?')
    .all(s) as { trailer_rel: string }[]
  for (const r of tagRows) {
    const rel = normalizeTrailerRel(r.trailer_rel)
    if (rel.startsWith('trailers/')) out.add(rel)
  }

  const recentRows = d
    .prepare('SELECT DISTINCT trailer_rel FROM recent_playback WHERE session = ?')
    .all(s) as { trailer_rel: string }[]
  for (const r of recentRows) {
    const rel = normalizeTrailerRel(r.trailer_rel)
    if (rel.startsWith('trailers/')) out.add(rel)
  }

  if (favoriteRels) {
    for (const rel of favoriteRels) {
      const n = normalizeTrailerRel(rel)
      if (n.startsWith('trailers/')) out.add(n)
    }
  }

  return [...out]
}

function mergeTrailerRelTagsInSqlite(session: number, fromRel: string, toRel: string): void {
  if (fromRel === toRel) return
  const d = getVideoTagsDb()
  runVideoTagsTxn(d, () => {
    const rows = d
      .prepare(
        'SELECT tag_id, is_manual FROM video_tags WHERE session = ? AND trailer_rel = ?',
      )
      .all(session, fromRel) as { tag_id: number; is_manual: number }[]
    for (const { tag_id, is_manual } of rows) {
      d.prepare(
        `INSERT INTO video_tags (session, trailer_rel, tag_id, is_manual)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session, trailer_rel, tag_id) DO UPDATE SET
           is_manual = MAX(video_tags.is_manual, excluded.is_manual)`,
      ).run(session, toRel, tag_id, is_manual)
    }
    d.prepare('DELETE FROM video_tags WHERE session = ? AND trailer_rel = ?').run(session, fromRel)
  })
}

export type CatalogTagRepairResult = {
  groupsMerged: number
  aliasesRemoved: number
}

/**
 * Une tags/favoritos/recentes de vários `trailer_rel` que apontam ao mesmo vídeo completo no disco.
 */
export async function repairSessionTrailerRelDuplicates(
  session: number,
  root: string,
  extraTrailerRels: string[] = [],
): Promise<CatalogTagRepairResult> {
  const s = Math.max(0, Math.floor(session))
  const favSet = await getFavoriteSet(s)
  const relsSet = new Set(collectSessionTrailerRelSources(s, favSet))
  for (const rel of extraTrailerRels) {
    const n = normalizeTrailerRel(rel)
    if (n.startsWith('trailers/')) relsSet.add(n)
  }
  const rels = [...relsSet]

  const groups = new Map<string, string[]>()
  for (const rel of rels) {
    const mainRel = await mainRelForTrailerOnDisk(root, rel)
    const key = mainRel ? `main:${mainRel}` : `trailer:${rel}`
    const g = groups.get(key) ?? []
    g.push(rel)
    groups.set(key, g)
  }

  let groupsMerged = 0
  let aliasesRemoved = 0

  for (const group of groups.values()) {
    if (group.length <= 1) continue
    groupsMerged++
    const canonical = pickCanonicalTrailerRel(group)
    for (const alias of group) {
      if (alias === canonical) continue
      mergeTrailerRelTagsInSqlite(s, alias, canonical)
      await remapFavoriteTrailerRel(s, alias, canonical)
      remapRecentPlaybackTrailerRel(s, alias, canonical)
      aliasesRemoved++
    }
  }

  return { groupsMerged, aliasesRemoved }
}

const repairedSessionRoots = new Set<string>()

/** Repara SQLite uma vez por par sessão+raiz (evita trabalho repetido em cada GET). */
export async function ensureSessionCatalogTagRepair(
  session: number,
  root: string,
  extraTrailerRels: string[] = [],
): Promise<void> {
  const key = `${Math.max(0, Math.floor(session))}:${root.trim()}`
  if (repairedSessionRoots.has(key) && extraTrailerRels.length === 0) return
  await repairSessionTrailerRelDuplicates(session, root.trim(), extraTrailerRels)
  repairedSessionRoots.add(key)
}

/**
 * Antes de gravar tags/favoritos, normaliza para o `trailer_rel` canónico do mesmo vídeo físico.
 */
export async function resolveCanonicalTrailerRelFromDisk(
  session: number,
  root: string,
  trailerRel: string,
): Promise<string> {
  const norm = normalizeTrailerRel(trailerRel)
  if (!norm.toLowerCase().startsWith('trailers/')) return norm

  const mainRel = await mainRelForTrailerOnDisk(root, norm)
  if (!mainRel) return norm

  const favSet = await getFavoriteSet(session)
  const candidates = collectSessionTrailerRelSources(session, favSet)
  const sameMain: string[] = [norm]
  for (const rel of candidates) {
    if (rel === norm) continue
    const m = await mainRelForTrailerOnDisk(root, rel)
    if (m === mainRel) sameMain.push(rel)
  }
  return pickCanonicalTrailerRel(sameMain)
}
