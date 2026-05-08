import { getVideoTagsDb, runVideoTagsTxn } from './videoTagsDb'

export interface RecentPlaybackRow {
  session: number
  trailerRel: string
  touchedAt: string
}

const RECENT_PLAYBACK_MAX = 5

export function normalizeTrailerRel(rel: unknown): string {
  if (typeof rel !== 'string') return ''
  return rel.trim().replace(/\\/g, '/')
}

/** Até os últimos N títulos distintos (session + trailer Rel), mais recente primeiro — guardado em SQLite (`library-tags.sqlite`). */
export function pushRecentPlayback(session: number, trailerRel: string): void {
  const rel = normalizeTrailerRel(trailerRel)
  if (!rel.startsWith('trailers/')) return
  const s = Math.max(0, Math.floor(session))
  const touched = new Date().toISOString()

  const d = getVideoTagsDb()
  runVideoTagsTxn(d, () => {
    d.prepare('DELETE FROM recent_playback WHERE session = ? AND trailer_rel = ?').run(s, rel)
    d.prepare('INSERT INTO recent_playback (session, trailer_rel, touched_at) VALUES (?, ?, ?)').run(
      s,
      rel,
      touched,
    )
    const rows = d
      .prepare('SELECT session, trailer_rel FROM recent_playback ORDER BY touched_at DESC')
      .all() as { session: number; trailer_rel: string }[]
    if (rows.length <= RECENT_PLAYBACK_MAX) return
    const del = d.prepare('DELETE FROM recent_playback WHERE session = ? AND trailer_rel = ?')
    for (const r of rows.slice(RECENT_PLAYBACK_MAX)) {
      del.run(r.session, r.trailer_rel)
    }
  })
}

export function readRecentPlaybackList(): RecentPlaybackRow[] {
  const d = getVideoTagsDb()
  const rows = d
    .prepare(
      `SELECT session, trailer_rel AS trailerRel, touched_at AS touchedAt
       FROM recent_playback
       ORDER BY touched_at DESC
       LIMIT ?`,
    )
    .all(RECENT_PLAYBACK_MAX) as RecentPlaybackRow[]
  return rows
}

export function purgeRecentPlaybackTitle(session: number, trailerRel: string): void {
  const relN = normalizeTrailerRel(trailerRel)
  const d = getVideoTagsDb()
  d.prepare('DELETE FROM recent_playback WHERE session = ? AND trailer_rel = ?').run(
    Math.max(0, Math.floor(session)),
    relN,
  )
}

export function remapRecentPlaybackAfterMove(fromSession: number, toSession: number, trailerRel: string): void {
  const rel = normalizeTrailerRel(trailerRel)
  const fromS = Math.max(0, Math.floor(fromSession))
  const toS = Math.max(0, Math.floor(toSession))
  if (!rel.startsWith('trailers/')) return

  const d = getVideoTagsDb()
  runVideoTagsTxn(d, () => {
    d.prepare('DELETE FROM recent_playback WHERE session = ? AND trailer_rel = ?').run(toS, rel)
    d.prepare(
      'UPDATE recent_playback SET session = ? WHERE session = ? AND trailer_rel = ?',
    ).run(toS, fromS, rel)
  })
}
