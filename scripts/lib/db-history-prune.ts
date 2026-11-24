/**
 * Limpeza do histórico do SQLite (`data/library-tags.sqlite`).
 *
 * Só mexe em tabelas de HISTÓRICO com data — nunca em tags, favoritos, menu
 * ou avaliações de duplicados (essas não têm prazo):
 *   - recent_playback      (coluna touched_at)  — lista de recentes
 *   - trailer_view_history (coluna viewed_at)   — vistos
 *   - surprise_batch       (coluna created_at)  — lotes do "aleatório";
 *                          as escolhas (surprise_pick) dos lotes apagados também saem.
 *
 * Datas são ISO 8601 em UTC (ex.: `2026-11-24T22:31:33.444Z`), por isso a
 * comparação de texto com o cutoff ISO respeita a ordem cronológica.
 */
import type { DatabaseSync } from 'node:sqlite'

export const DAY_MS = 24 * 60 * 60 * 1000

/** Cutoff ISO: tudo com data anterior a este instante é apagado. */
export function historyCutoffIso(nowMs: number, keepDays: number): string {
  if (!Number.isFinite(keepDays) || keepDays < 0) {
    throw new Error(`keepDays inválido: ${keepDays}`)
  }
  return new Date(nowMs - keepDays * DAY_MS).toISOString()
}

/** Lê o número de dias do argumento da CLI. Aceita inteiros >= 0. */
export function parseKeepDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    throw new Error('Informe os dias a manter. Ex.: npm run pull:db:data 7')
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Dias inválidos: "${raw}". Use um inteiro >= 0.`)
  }
  return n
}

export type HistoryExport = {
  exportedAt: string
  recent_playback: unknown[]
  trailer_view_history: unknown[]
  surprise_batch: unknown[]
  surprise_pick: unknown[]
}

/** Cópia completa (janela desde o início dos tempos) das tabelas de histórico. */
export function exportHistory(db: DatabaseSync, nowMs: number): HistoryExport {
  const all = (sql: string) => db.prepare(sql).all() as unknown[]
  return {
    exportedAt: new Date(nowMs).toISOString(),
    recent_playback: all('SELECT * FROM recent_playback ORDER BY touched_at'),
    trailer_view_history: all('SELECT * FROM trailer_view_history ORDER BY viewed_at'),
    surprise_batch: all('SELECT * FROM surprise_batch ORDER BY created_at'),
    surprise_pick: all('SELECT * FROM surprise_pick ORDER BY batch_id, pick_order'),
  }
}

export type PruneCounts = {
  recent_playback: number
  trailer_view_history: number
  surprise_batch: number
  surprise_pick: number
}

/**
 * Apaga o histórico anterior ao cutoff, numa única transação.
 * Devolve quantas linhas saíram de cada tabela.
 */
export function pruneHistory(db: DatabaseSync, cutoffIso: string): PruneCounts {
  db.exec('BEGIN IMMEDIATE')
  try {
    // Lotes antigos: apagamos primeiro as escolhas deles (não depende de foreign_keys estar ligado).
    const oldBatchIds = (
      db.prepare('SELECT id FROM surprise_batch WHERE created_at < ?').all(cutoffIso) as { id: number }[]
    ).map((r) => r.id)

    let surprisePick = 0
    const delPick = db.prepare('DELETE FROM surprise_pick WHERE batch_id = ?')
    for (const id of oldBatchIds) {
      surprisePick += Number(delPick.run(id).changes)
    }

    const surpriseBatch = Number(
      db.prepare('DELETE FROM surprise_batch WHERE created_at < ?').run(cutoffIso).changes,
    )
    const recent = Number(
      db.prepare('DELETE FROM recent_playback WHERE touched_at < ?').run(cutoffIso).changes,
    )
    const viewed = Number(
      db.prepare('DELETE FROM trailer_view_history WHERE viewed_at < ?').run(cutoffIso).changes,
    )

    db.exec('COMMIT')
    return {
      recent_playback: recent,
      trailer_view_history: viewed,
      surprise_batch: surpriseBatch,
      surprise_pick: surprisePick,
    }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
