import { getVideoTagsDb, runVideoTagsTxn } from './videoTagsDb'
import { normalizeTrailerRel } from './recentPlaybackDb'

export const SURPRISE_PICKS_PER_SESSION = 5

export interface SurprisePickRow {
  session: number
  trailerRel: string
  pickOrder: number
}

function ensureSurpriseTables() {
  const d = getVideoTagsDb()
  d.exec(`
    CREATE TABLE IF NOT EXISTS surprise_batch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      viewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS surprise_pick (
      batch_id INTEGER NOT NULL,
      session INTEGER NOT NULL,
      trailer_rel TEXT NOT NULL,
      pick_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (batch_id, session, trailer_rel),
      FOREIGN KEY (batch_id) REFERENCES surprise_batch(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_surprise_batch_viewed ON surprise_batch(viewed_at);
  `)
}

export function getActiveSurpriseBatchId(): number | null {
  ensureSurpriseTables()
  const d = getVideoTagsDb()
  const row = d
    .prepare(
      `SELECT id FROM surprise_batch
       WHERE viewed_at IS NULL
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get() as { id: number } | undefined
  return row?.id ?? null
}

export function readSurprisePicks(batchId: number): SurprisePickRow[] {
  ensureSurpriseTables()
  const d = getVideoTagsDb()
  const rows = d
    .prepare(
      `SELECT session, trailer_rel AS trailerRel, pick_order AS pickOrder
       FROM surprise_pick
       WHERE batch_id = ?
       ORDER BY pick_order ASC, session ASC, trailer_rel ASC`,
    )
    .all(batchId) as SurprisePickRow[]
  return rows.map((r) => ({
    session: r.session,
    trailerRel: normalizeTrailerRel(r.trailerRel),
    pickOrder: r.pickOrder,
  }))
}

export function createSurpriseBatch(picks: SurprisePickRow[]): number {
  ensureSurpriseTables()
  const d = getVideoTagsDb()
  const createdAt = new Date().toISOString()
  let batchId = 0
  runVideoTagsTxn(d, () => {
    const ins = d.prepare('INSERT INTO surprise_batch (created_at, viewed_at) VALUES (?, NULL)')
    ins.run(createdAt)
    const idRow = d.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }
    batchId = Number(idRow.id)
    const pickIns = d.prepare(
      'INSERT INTO surprise_pick (batch_id, session, trailer_rel, pick_order) VALUES (?, ?, ?, ?)',
    )
    for (const p of picks) {
      pickIns.run(batchId, Math.max(0, Math.floor(p.session)), normalizeTrailerRel(p.trailerRel), p.pickOrder)
    }
  })
  return batchId
}

export function markActiveSurpriseBatchViewed(): boolean {
  ensureSurpriseTables()
  const id = getActiveSurpriseBatchId()
  if (id === null) return false
  const d = getVideoTagsDb()
  d.prepare('UPDATE surprise_batch SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL').run(
    new Date().toISOString(),
    id,
  )
  return true
}

export function markSurpriseBatchViewed(batchId: number): void {
  ensureSurpriseTables()
  const d = getVideoTagsDb()
  d.prepare('UPDATE surprise_batch SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL').run(
    new Date().toISOString(),
    batchId,
  )
}
