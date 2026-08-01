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

export interface TrailerViewHistoryRow {
  session: number
  trailerRel: string
  viewedAt: string
}

function ensureViewHistoryTable() {
  const d = getVideoTagsDb()
  d.exec(`
    CREATE TABLE IF NOT EXISTS trailer_view_history (
      session INTEGER NOT NULL,
      trailer_rel TEXT NOT NULL,
      viewed_at TEXT NOT NULL,
      PRIMARY KEY (session, trailer_rel)
    );
    CREATE INDEX IF NOT EXISTS idx_trailer_view_history_at ON trailer_view_history(viewed_at);
  `)
}

export const TRAILER_VIEW_HISTORY_LIMIT = 50

/** Histórico automático de trailers reproduzidos (lista «Últimos vistos» — distinto de Destaques). */
export function pushTrailerViewHistory(session: number, trailerRel: string): void {
  const rel = normalizeTrailerRel(trailerRel)
  if (!rel.startsWith('trailers/')) return
  const s = Math.max(0, Math.floor(session))
  const viewedAt = new Date().toISOString()
  const d = getVideoTagsDb()
  ensureViewHistoryTable()
  runVideoTagsTxn(d, () => {
    d.prepare('DELETE FROM trailer_view_history WHERE session = ? AND trailer_rel = ?').run(s, rel)
    d.prepare(
      'INSERT INTO trailer_view_history (session, trailer_rel, viewed_at) VALUES (?, ?, ?)',
    ).run(s, rel, viewedAt)
    d.prepare(
      `DELETE FROM trailer_view_history
       WHERE rowid NOT IN (
         SELECT rowid FROM trailer_view_history ORDER BY viewed_at DESC LIMIT ?
       )`,
    ).run(TRAILER_VIEW_HISTORY_LIMIT)
  })
}

export function readTrailerViewHistoryList(
  limit = TRAILER_VIEW_HISTORY_LIMIT,
): TrailerViewHistoryRow[] {
  ensureViewHistoryTable()
  const d = getVideoTagsDb()
  const cap = Math.max(1, Math.min(200, Math.floor(limit)))
  return d
    .prepare(
      `SELECT session, trailer_rel AS trailerRel, viewed_at AS viewedAt
       FROM trailer_view_history
       ORDER BY viewed_at DESC
       LIMIT ?`,
    )
    .all(cap) as TrailerViewHistoryRow[]
}

export function purgeTrailerViewHistory(session: number, trailerRel: string): void {
  ensureViewHistoryTable()
  const rel = normalizeTrailerRel(trailerRel)
  const d = getVideoTagsDb()
  d.prepare('DELETE FROM trailer_view_history WHERE session = ? AND trailer_rel = ?').run(
    Math.max(0, Math.floor(session)),
    rel,
  )
}
