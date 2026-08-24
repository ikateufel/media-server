import { getVideoTagsDb, runVideoTagsTxn } from './videoTagsDb'
import type { TagListPreviewRow, TagListPreviewSample } from './tagListPreview'

function ensureSchema() {
  const d = getVideoTagsDb()
  d.exec(`
    CREATE TABLE IF NOT EXISTS tag_list_item_previews (
      list_id TEXT NOT NULL,
      query_key TEXT NOT NULL,
      query_display TEXT NOT NULL,
      total INTEGER NOT NULL,
      samples_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (list_id, query_key)
    );
    CREATE INDEX IF NOT EXISTS idx_tag_list_item_previews_list
      ON tag_list_item_previews(list_id);
  `)
}

/** Versão do match do mosaico — muda quando a regra de match muda (invalida cache antigo). */
const PREVIEW_CACHE_MATCH_VER = 'all-v1'

export function normalizePreviewQueryKey(raw: string): string {
  const base = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
  return base ? `${PREVIEW_CACHE_MATCH_VER}:${base}` : ''
}

function parseSamples(raw: string): TagListPreviewSample[] {
  try {
    const j = JSON.parse(raw) as unknown
    if (!Array.isArray(j)) return []
    const out: TagListPreviewSample[] = []
    for (const x of j) {
      if (!x || typeof x !== 'object') continue
      const o = x as Record<string, unknown>
      const session = Math.floor(Number(o.session))
      const trailerRel =
        typeof o.trailerRel === 'string' ? o.trailerRel.trim().replace(/\\/g, '/') : ''
      const previewRel =
        typeof o.previewRel === 'string'
          ? o.previewRel.trim().replace(/\\/g, '/')
          : trailerRel
      const label = typeof o.label === 'string' ? o.label : trailerRel
      if (!Number.isFinite(session) || session < 0 || !trailerRel) continue
      out.push({ session, trailerRel, previewRel, label })
    }
    return out
  } catch {
    return []
  }
}

/** Lê cache para as queries pedidas; chave = query normalizada. */
export function getCachedTagListPreviews(
  listId: string,
  queries: string[],
): Map<string, TagListPreviewRow> {
  ensureSchema()
  const id = String(listId ?? '').trim()
  const map = new Map<string, TagListPreviewRow>()
  if (!id || !queries.length) return map

  const d = getVideoTagsDb()
  const stmt = d.prepare(
    `SELECT query_key, query_display, total, samples_json
     FROM tag_list_item_previews
     WHERE list_id = ? AND query_key = ?`,
  )

  for (const q of queries) {
    const key = normalizePreviewQueryKey(q)
    if (!key || map.has(key)) continue
    const row = stmt.get(id, key) as
      | { query_key: string; query_display: string; total: number; samples_json: string }
      | undefined
    if (!row) continue
    map.set(key, {
      query: String(q).trim().replace(/\s+/g, ' ') || row.query_display,
      total: Math.max(0, Math.floor(Number(row.total) || 0)),
      samples: parseSamples(row.samples_json),
    })
  }
  return map
}

export function upsertTagListPreviews(listId: string, rows: TagListPreviewRow[]): void {
  ensureSchema()
  const id = String(listId ?? '').trim()
  if (!id || !rows.length) return
  const d = getVideoTagsDb()
  const now = new Date().toISOString()
  const upsert = d.prepare(
    `INSERT INTO tag_list_item_previews
      (list_id, query_key, query_display, total, samples_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(list_id, query_key) DO UPDATE SET
      query_display = excluded.query_display,
      total = excluded.total,
      samples_json = excluded.samples_json,
      updated_at = excluded.updated_at`,
  )
  runVideoTagsTxn(d, () => {
    for (const row of rows) {
      const display = String(row.query ?? '').trim().replace(/\s+/g, ' ')
      const key = normalizePreviewQueryKey(display)
      if (!key) continue
      upsert.run(
        id,
        key,
        display,
        Math.max(0, Math.floor(Number(row.total) || 0)),
        JSON.stringify(Array.isArray(row.samples) ? row.samples : []),
        now,
      )
    }
  })
}

export function deleteTagListPreview(listId: string, queryRaw: string): void {
  ensureSchema()
  const id = String(listId ?? '').trim()
  const key = normalizePreviewQueryKey(queryRaw)
  if (!id || !key) return
  getVideoTagsDb()
    .prepare('DELETE FROM tag_list_item_previews WHERE list_id = ? AND query_key = ?')
    .run(id, key)
}

export function deleteAllTagListPreviews(listId: string): void {
  ensureSchema()
  const id = String(listId ?? '').trim()
  if (!id) return
  getVideoTagsDb().prepare('DELETE FROM tag_list_item_previews WHERE list_id = ?').run(id)
}

/** Remove cache de queries que já não estão na lista. */
export function pruneTagListPreviewsToQueries(listId: string, keepQueries: string[]): void {
  ensureSchema()
  const id = String(listId ?? '').trim()
  if (!id) return
  const keep = new Set(
    keepQueries.map(normalizePreviewQueryKey).filter((k) => k.length > 0),
  )
  const d = getVideoTagsDb()
  const existing = d
    .prepare('SELECT query_key FROM tag_list_item_previews WHERE list_id = ?')
    .all(id) as { query_key: string }[]
  const del = d.prepare(
    'DELETE FROM tag_list_item_previews WHERE list_id = ? AND query_key = ?',
  )
  runVideoTagsTxn(d, () => {
    for (const row of existing) {
      if (!keep.has(row.query_key)) del.run(id, row.query_key)
    }
  })
}
