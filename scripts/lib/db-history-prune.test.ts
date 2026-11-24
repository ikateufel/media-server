/**
 * Testes de `db-history-prune.ts`. Rodar com:
 *   node_modules/.bin/tsx --test scripts/lib/db-history-prune.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import {
  DAY_MS,
  exportHistory,
  historyCutoffIso,
  parseKeepDays,
  pruneHistory,
} from './db-history-prune.ts'

const NOW = Date.parse('2026-11-24T12:00:00.000Z')

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE recent_playback (
      session INTEGER NOT NULL, trailer_rel TEXT NOT NULL, touched_at TEXT NOT NULL,
      PRIMARY KEY (session, trailer_rel));
    CREATE TABLE trailer_view_history (
      session INTEGER NOT NULL, trailer_rel TEXT NOT NULL, viewed_at TEXT NOT NULL);
    CREATE TABLE surprise_batch (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, viewed_at TEXT);
    CREATE TABLE surprise_pick (
      batch_id INTEGER NOT NULL, session INTEGER NOT NULL, trailer_rel TEXT NOT NULL,
      pick_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (batch_id, session, trailer_rel));
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO tags (id, name) VALUES (1, 'jc');
  `)
  return db
}

function daysAgo(d: number): string {
  return new Date(NOW - d * DAY_MS).toISOString()
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n
}

test('historyCutoffIso subtrai os dias em UTC', () => {
  assert.equal(historyCutoffIso(NOW, 7), daysAgo(7))
  assert.equal(historyCutoffIso(NOW, 0), new Date(NOW).toISOString())
})

test('historyCutoffIso rejeita dias negativos ou NaN', () => {
  assert.throws(() => historyCutoffIso(NOW, -1))
  assert.throws(() => historyCutoffIso(NOW, Number.NaN))
})

test('parseKeepDays aceita inteiros >= 0 e rejeita o resto', () => {
  assert.equal(parseKeepDays('7'), 7)
  assert.equal(parseKeepDays('0'), 0)
  assert.throws(() => parseKeepDays(undefined))
  assert.throws(() => parseKeepDays(''))
  assert.throws(() => parseKeepDays('abc'))
  assert.throws(() => parseKeepDays('2.5'))
  assert.throws(() => parseKeepDays('-3'))
})

test('pruneHistory mantém só os últimos N dias e não mexe em tags', () => {
  const db = makeDb()
  const ins = db.prepare('INSERT INTO recent_playback (session, trailer_rel, touched_at) VALUES (?, ?, ?)')
  ins.run(0, 'old.mp4', daysAgo(30))
  ins.run(0, 'edge-keep.mp4', daysAgo(7) === historyCutoffIso(NOW, 7) ? daysAgo(7) : daysAgo(6))
  ins.run(0, 'recent.mp4', daysAgo(1))

  const vh = db.prepare('INSERT INTO trailer_view_history (session, trailer_rel, viewed_at) VALUES (?, ?, ?)')
  vh.run(0, 'v-old.mp4', daysAgo(90))
  vh.run(0, 'v-new.mp4', daysAgo(2))

  const cutoff = historyCutoffIso(NOW, 7)
  const counts = pruneHistory(db, cutoff)

  assert.deepEqual(counts, {
    recent_playback: 1,
    trailer_view_history: 1,
    surprise_batch: 0,
    surprise_pick: 0,
  })
  assert.equal(count(db, 'recent_playback'), 2)
  assert.equal(count(db, 'trailer_view_history'), 1)
  assert.equal(count(db, 'tags'), 1, 'tags não podem ser apagadas')
})

test('pruneHistory apaga lotes antigos junto com as escolhas deles', () => {
  const db = makeDb()
  const ib = db.prepare('INSERT INTO surprise_batch (created_at, viewed_at) VALUES (?, ?)')
  ib.run(daysAgo(20), daysAgo(20))  // id 1 — antigo
  ib.run(daysAgo(1), null)          // id 2 — recente
  const ip = db.prepare('INSERT INTO surprise_pick (batch_id, session, trailer_rel, pick_order) VALUES (?, ?, ?, ?)')
  ip.run(1, 0, 'a.mp4', 0)
  ip.run(1, 0, 'b.mp4', 1)
  ip.run(2, 0, 'c.mp4', 0)

  const counts = pruneHistory(db, historyCutoffIso(NOW, 7))

  assert.equal(counts.surprise_batch, 1)
  assert.equal(counts.surprise_pick, 2)
  assert.equal(count(db, 'surprise_batch'), 1)
  assert.equal(count(db, 'surprise_pick'), 1, 'escolha do lote recente fica')
})

test('exportHistory traz a janela inteira antes de apagar', () => {
  const db = makeDb()
  db.prepare('INSERT INTO recent_playback (session, trailer_rel, touched_at) VALUES (?, ?, ?)').run(0, 'x.mp4', daysAgo(400))
  db.prepare('INSERT INTO trailer_view_history (session, trailer_rel, viewed_at) VALUES (?, ?, ?)').run(0, 'y.mp4', daysAgo(400))

  const snap = exportHistory(db, NOW)
  assert.equal(snap.recent_playback.length, 1)
  assert.equal(snap.trailer_view_history.length, 1)

  pruneHistory(db, historyCutoffIso(NOW, 7))
  assert.equal(count(db, 'recent_playback'), 0)
  // o backup continua com o que foi apagado
  assert.equal(snap.recent_playback.length, 1)
})

test('pruneHistory com 0 dias apaga todo o histórico', () => {
  const db = makeDb()
  db.prepare('INSERT INTO recent_playback (session, trailer_rel, touched_at) VALUES (?, ?, ?)').run(0, 'z.mp4', new Date(NOW - 1000).toISOString())
  const counts = pruneHistory(db, historyCutoffIso(NOW, 0))
  assert.equal(counts.recent_playback, 1)
  assert.equal(count(db, 'recent_playback'), 0)
})
