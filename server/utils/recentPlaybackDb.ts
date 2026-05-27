import { getVideoTagsDb, runVideoTagsTxn } from './videoTagsDb'

export interface RecentPlaybackRow {
  session: number
  trailerRel: string
  touchedAt: string
}

export function normalizeTrailerRel(rel: unknown): string {
  if (typeof rel !== 'string') return ''
  return rel.trim().replace(/\\/g, '/')
}

/** Títulos distintos (session + trailer Rel), mais recente primeiro — sem limite de quantidade; SQLite `library-tags.sqlite`. */
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
  })
}

export function readRecentPlaybackList(): RecentPlaybackRow[] {
  const d = getVideoTagsDb()
  const rows = d
    .prepare(
      `SELECT session, trailer_rel AS trailerRel, touched_at AS touchedAt
       FROM recent_playback
       ORDER BY touched_at DESC`,
    )
    .all() as RecentPlaybackRow[]
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

/** Unifica entrada em Destaques quando dois `trailer_rel` são o mesmo vídeo. */
export function remapRecentPlaybackTrailerRel(session: number, fromRel: string, toRel: string): void {
  const from = normalizeTrailerRel(fromRel)
  const to = normalizeTrailerRel(toRel)
  if (!from.startsWith('trailers/') || from === to) return
  const s = Math.max(0, Math.floor(session))
  const d = getVideoTagsDb()
  runVideoTagsTxn(d, () => {
    const fromRow = d
      .prepare('SELECT touched_at FROM recent_playback WHERE session = ? AND trailer_rel = ?')
      .get(s, from) as { touched_at: string } | undefined
    const toRow = d
      .prepare('SELECT touched_at FROM recent_playback WHERE session = ? AND trailer_rel = ?')
      .get(s, to) as { touched_at: string } | undefined
    if (fromRow && toRow) {
      const keep = fromRow.touched_at > toRow.touched_at ? fromRow.touched_at : toRow.touched_at
      d.prepare('UPDATE recent_playback SET touched_at = ? WHERE session = ? AND trailer_rel = ?').run(
        keep,
        s,
        to,
      )
      d.prepare('DELETE FROM recent_playback WHERE session = ? AND trailer_rel = ?').run(s, from)
    } else if (fromRow) {
      d.prepare('UPDATE recent_playback SET trailer_rel = ? WHERE session = ? AND trailer_rel = ?').run(
        to,
        s,
        from,
      )
    }
  })
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
