import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

type DatabaseSync = import('node:sqlite').DatabaseSync

const require = createRequire(import.meta.url)
let databaseSyncCtor: typeof import('node:sqlite').DatabaseSync | null = null

function getDatabaseSyncCtor(): typeof import('node:sqlite').DatabaseSync {
  if (!databaseSyncCtor) {
    databaseSyncCtor = (require('node:sqlite') as typeof import('node:sqlite')).DatabaseSync
  }
  return databaseSyncCtor
}

let db: DatabaseSync | null = null

function dbFilePath() {
  return join(process.cwd(), 'data', 'library-tags.sqlite')
}

export function runVideoTagsTxn(d: DatabaseSync, fn: () => void) {
  d.exec('BEGIN')
  try {
    fn()
    d.exec('COMMIT')
  } catch (e) {
    try {
      d.exec('ROLLBACK')
    } catch {
      /* */
    }
    throw e
  }
}

function runInTransaction(d: DatabaseSync, fn: () => void): void {
  runVideoTagsTxn(d, fn)
}

function migrateLegacyRecentPlaybackFromJson(d: DatabaseSync): void {
  const cntRow = d.prepare('SELECT COUNT(*) AS c FROM recent_playback').get() as { c: number }
  if (cntRow.c > 0) return
  const statePath = join(process.cwd(), 'data', 'library-state.json')
  if (!existsSync(statePath)) return
  try {
    const raw = readFileSync(statePath, 'utf8')
    const j = JSON.parse(raw) as { recentPlayback?: unknown } & Record<string, unknown>
    const arr = j.recentPlayback
    if (!Array.isArray(arr) || !arr.length) return
    const rows: { session: number; trailerRel: string; touchedAt: string }[] = []
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue
      const o = x as { session?: unknown; trailerRel?: unknown; touchedAt?: unknown }
      const session =
        typeof o.session === 'number' && Number.isFinite(o.session) ? Math.floor(o.session) : NaN
      const trailerRel =
        typeof o.trailerRel === 'string' ? o.trailerRel.trim().replace(/\\/g, '/') : ''
      const touchedAt = typeof o.touchedAt === 'string' ? o.touchedAt : ''
      if (!Number.isFinite(session) || session < 0) continue
      if (!trailerRel.startsWith('trailers/')) continue
      if (!touchedAt) continue
      rows.push({ session, trailerRel, touchedAt })
    }
    rows.sort((a, b) => (a.touchedAt < b.touchedAt ? 1 : a.touchedAt > b.touchedAt ? -1 : 0))
    const seen = new Set<string>()
    const capped: typeof rows = []
    for (const r of rows) {
      const k = `${r.session}:${r.trailerRel}`
      if (seen.has(k)) continue
      seen.add(k)
      capped.push(r)
      if (capped.length >= 5) break
    }
    if (!capped.length) return
    runVideoTagsTxn(d, () => {
      const ins = d.prepare(
        'INSERT INTO recent_playback (session, trailer_rel, touched_at) VALUES (?, ?, ?)',
      )
      for (const r of capped) ins.run(r.session, r.trailerRel, r.touchedAt)
    })
    delete j.recentPlayback
    writeFileSync(statePath, `${JSON.stringify(j, null, 2)}\n`, 'utf8')
  } catch {
    /* ficheiro corrompido ou bloqueado — ignorar migração */
  }
}

function ensureVideoTagsIsManualColumn(d: DatabaseSync) {
  const cols = d.prepare('PRAGMA table_info(video_tags)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'is_manual')) {
    d.exec('ALTER TABLE video_tags ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0')
  }
}

function openDb(): DatabaseSync {
  const path = dbFilePath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const DatabaseSync = getDatabaseSyncCtor()
  const d = new DatabaseSync(path)
  d.exec('PRAGMA journal_mode = WAL')
  d.exec('PRAGMA foreign_keys = ON')
  d.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE
    );
    CREATE TABLE IF NOT EXISTS video_tags (
      session INTEGER NOT NULL,
      trailer_rel TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      is_manual INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session, trailer_rel, tag_id),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_video_tags_lookup ON video_tags(session, trailer_rel);
    CREATE TABLE IF NOT EXISTS main_file_meta (
      session INTEGER NOT NULL,
      main_rel TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      birthtime_ms INTEGER,
      PRIMARY KEY (session, main_rel)
    );
    CREATE TABLE IF NOT EXISTS recent_playback (
      session INTEGER NOT NULL,
      trailer_rel TEXT NOT NULL,
      touched_at TEXT NOT NULL,
      PRIMARY KEY (session, trailer_rel)
    );
    CREATE INDEX IF NOT EXISTS idx_recent_playback_touched ON recent_playback(touched_at);
  `)
  ensureVideoTagsIsManualColumn(d)
  migrateLegacyRecentPlaybackFromJson(d)
  return d
}

export function getVideoTagsDb(): DatabaseSync {
  if (!db) db = openDb()
  return db
}

export const TAG_MAX_LEN = 80

/**
 * Tag canónica usada para marcar um vídeo como já visto até ao fim na versão "full".
 * Comparações são case-insensitive (SQLite COLLATE NOCASE), mas sensíveis a acentos —
 * por isso fixamos uma forma ASCII para evitar duplicados acidentais (`concluido` ≠ `concluído`).
 */
export const COMPLETED_TAG_NAME = 'concluido'

/**
 * Tag canónica para marcar que o utilizador viu o **trailer/preview** até ao fim.
 * Diferente de `concluido` (que se refere ao vídeo full). Não influencia a ordenação
 * nem o "trailer aleatório"; serve apenas como indicador visual no catálogo.
 */
export const TRAILER_WATCHED_TAG_NAME = 'trailer-visto'

/**
 * Tag canónica para marcar um vídeo como "memorável" — escolha manual do utilizador
 * (botão trofeu). Equivale a "já assistido" para efeitos de ordenação/aleatório
 * (vai para o fim e fica fora do random), mas é apresentado com badge dourado
 * próprio para se distinguir de `concluido`.
 *
 * Nota: o vídeo pode ter ambas as tags em simultâneo (ex.: visto e memorável).
 */
export const MEMORABLE_TAG_NAME = 'memoravel'

export function isCompletedTagName(name: string): boolean {
  return name.trim().toLowerCase() === COMPLETED_TAG_NAME
}

export function isTrailerWatchedTagName(name: string): boolean {
  return name.trim().toLowerCase() === TRAILER_WATCHED_TAG_NAME
}

export function isMemorableTagName(name: string): boolean {
  return name.trim().toLowerCase() === MEMORABLE_TAG_NAME
}

export function normalizeTagInput(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (!t || t.length > TAG_MAX_LEN) return null
  return t
}

export function getTagsForVideo(session: number, trailerRel: string): string[] {
  const d = getVideoTagsDb()
  const rows = d
    .prepare(
      `SELECT t.name
       FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id
       WHERE vt.session = ? AND vt.trailer_rel = ?
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(session, trailerRel) as { name: string }[]
  return rows.map((r) => r.name)
}

/** Nomes de tags já usados nesta sessão (autocompletar). */
export function listTagNamesForSession(session: number): string[] {
  const d = getVideoTagsDb()
  const rows = d
    .prepare(
      `SELECT DISTINCT t.name
       FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id
       WHERE vt.session = ?
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(session) as { name: string }[]
  return rows.map((r) => r.name)
}

/** Top tags por quantidade de títulos na sessão (para menu da pasta). */
export function listTopTagNamesForSession(session: number, limit = 5): string[] {
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 5
  const d = getVideoTagsDb()
  const rows = d
    .prepare(
      `SELECT t.name, COUNT(*) AS qty
       FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id
       WHERE vt.session = ?
       GROUP BY t.id, t.name
       ORDER BY qty DESC, t.name COLLATE NOCASE
       LIMIT ?`,
    )
    .all(session, n) as { name: string; qty: number }[]
  return rows.map((r) => r.name)
}

export function getTagsMapForSession(session: number, trailerRels: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (!trailerRels.length) return out
  const d = getVideoTagsDb()
  const placeholders = trailerRels.map(() => '?').join(', ')
  const rows = d
    .prepare(
      `SELECT vt.trailer_rel, t.name
       FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id
       WHERE vt.session = ? AND vt.trailer_rel IN (${placeholders})
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(session, ...trailerRels) as { trailer_rel: string; name: string }[]
  for (const r of rows) {
    const arr = out.get(r.trailer_rel) ?? []
    arr.push(r.name)
    out.set(r.trailer_rel, arr)
  }
  return out
}

export function addTagToVideo(
  session: number,
  trailerRel: string,
  rawName: string,
  isManual = false,
): string[] {
  const name = normalizeTagInput(rawName)
  if (!name) return getTagsForVideo(session, trailerRel)

  const manualFlag = isManual ? 1 : 0

  const d = getVideoTagsDb()
  runInTransaction(d, () => {
    d.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name)
    const row = d.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined
    if (!row) return
    d.prepare(
      `INSERT INTO video_tags (session, trailer_rel, tag_id, is_manual)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session, trailer_rel, tag_id) DO UPDATE SET
         is_manual = MAX(video_tags.is_manual, excluded.is_manual)`,
    ).run(session, trailerRel, row.id, manualFlag)
  })

  return getTagsForVideo(session, trailerRel)
}

/** Marca o vídeo como concluído (tag manual `concluido`). Devolve a lista de tags resultante. */
export function markTrailerCompleted(session: number, trailerRel: string): string[] {
  return addTagToVideo(session, trailerRel, COMPLETED_TAG_NAME, true)
}

/** Remove a marca de concluído (apaga a tag `concluido`). Devolve a lista de tags resultante. */
export function unmarkTrailerCompleted(session: number, trailerRel: string): string[] {
  return removeTagFromVideo(session, trailerRel, COMPLETED_TAG_NAME)
}

export function isTrailerCompleted(session: number, trailerRel: string): boolean {
  return getTagsForVideo(session, trailerRel).some(isCompletedTagName)
}

/** Marca que o trailer (preview) foi visto até ao fim (tag manual `trailer-visto`). */
export function markTrailerWatched(session: number, trailerRel: string): string[] {
  return addTagToVideo(session, trailerRel, TRAILER_WATCHED_TAG_NAME, true)
}

/** Remove a marca de trailer-visto. */
export function unmarkTrailerWatched(session: number, trailerRel: string): string[] {
  return removeTagFromVideo(session, trailerRel, TRAILER_WATCHED_TAG_NAME)
}

export function isTrailerWatched(session: number, trailerRel: string): boolean {
  return getTagsForVideo(session, trailerRel).some(isTrailerWatchedTagName)
}

/** Marca o vídeo como memorável (tag manual `memoravel`). Devolve a lista de tags resultante. */
export function markTrailerMemorable(session: number, trailerRel: string): string[] {
  return addTagToVideo(session, trailerRel, MEMORABLE_TAG_NAME, true)
}

/** Remove a marca de memorável (apaga a tag `memoravel`). Devolve a lista de tags resultante. */
export function unmarkTrailerMemorable(session: number, trailerRel: string): string[] {
  return removeTagFromVideo(session, trailerRel, MEMORABLE_TAG_NAME)
}

export function isTrailerMemorable(session: number, trailerRel: string): boolean {
  return getTagsForVideo(session, trailerRel).some(isMemorableTagName)
}

export function removeTagFromVideo(session: number, trailerRel: string, rawName: string): string[] {
  const name = normalizeTagInput(rawName)
  if (!name) return getTagsForVideo(session, trailerRel)

  const d = getVideoTagsDb()
  runInTransaction(d, () => {
    const row = d.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined
    if (!row) return
    d.prepare('DELETE FROM video_tags WHERE session = ? AND trailer_rel = ? AND tag_id = ?').run(
      session,
      trailerRel,
      row.id,
    )
    const still = d
      .prepare('SELECT 1 AS ok FROM video_tags WHERE tag_id = ? LIMIT 1')
      .get(row.id) as { ok: number } | undefined
    if (!still) d.prepare('DELETE FROM tags WHERE id = ?').run(row.id)
  })

  return getTagsForVideo(session, trailerRel)
}

export interface MainFileMetaRow {
  size_bytes: number
  mtime_ms: number
  birthtime_ms: number | null
}

export function getMainMetaMap(session: number, mainRels: string[]): Map<string, MainFileMetaRow> {
  const out = new Map<string, MainFileMetaRow>()
  if (!mainRels.length) return out
  const d = getVideoTagsDb()
  const placeholders = mainRels.map(() => '?').join(', ')
  const rows = d
    .prepare(
      `SELECT main_rel, size_bytes, mtime_ms, birthtime_ms
       FROM main_file_meta
       WHERE session = ? AND main_rel IN (${placeholders})`,
    )
    .all(session, ...mainRels) as {
      main_rel: string
      size_bytes: number
      mtime_ms: number
      birthtime_ms: number | null
    }[]
  for (const r of rows) {
    out.set(r.main_rel, {
      size_bytes: r.size_bytes,
      mtime_ms: r.mtime_ms,
      birthtime_ms: r.birthtime_ms,
    })
  }
  return out
}

export function upsertMainFileMeta(
  session: number,
  mainRel: string,
  sizeBytes: number,
  mtimeMs: number,
  birthtimeMs: number | null,
): void {
  const d = getVideoTagsDb()
  d.prepare(
    `INSERT INTO main_file_meta (session, main_rel, size_bytes, mtime_ms, birthtime_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session, main_rel) DO UPDATE SET
       size_bytes = excluded.size_bytes,
       mtime_ms = excluded.mtime_ms,
       birthtime_ms = excluded.birthtime_ms`,
  ).run(session, mainRel, sizeBytes, mtimeMs, birthtimeMs)
}

export function transferTitleBetweenSessions(
  fromSession: number,
  toSession: number,
  trailerRel: string,
  mainRel: string,
): void {
  const d = getVideoTagsDb()
  runInTransaction(d, () => {
    d.prepare('UPDATE video_tags SET session = ? WHERE session = ? AND trailer_rel = ?').run(
      toSession,
      fromSession,
      trailerRel,
    )
    d.prepare('UPDATE main_file_meta SET session = ? WHERE session = ? AND main_rel = ?').run(
      toSession,
      fromSession,
      mainRel,
    )
  })
}

export function purgeVideoTags(session: number, trailerRel: string): void {
  const d = getVideoTagsDb()
  runInTransaction(d, () => {
    const tagIds = d
      .prepare('SELECT tag_id FROM video_tags WHERE session = ? AND trailer_rel = ?')
      .all(session, trailerRel) as { tag_id: number }[]
    d.prepare('DELETE FROM video_tags WHERE session = ? AND trailer_rel = ?').run(session, trailerRel)
    for (const { tag_id } of tagIds) {
      const still = d
        .prepare('SELECT 1 AS ok FROM video_tags WHERE tag_id = ? LIMIT 1')
        .get(tag_id) as { ok: number } | undefined
      if (!still) d.prepare('DELETE FROM tags WHERE id = ?').run(tag_id)
    }
  })
}
