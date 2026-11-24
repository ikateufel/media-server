/**
 * npm run pull:db:data -- <dias>
 *
 * 1. "Puxa" (exporta) a janela inteira do histórico (desde o início dos tempos)
 *    de recent_playback, trailer_view_history, surprise_batch e surprise_pick
 *    para data/db-pull/db-history-<timestamp>.json.
 * 2. Apaga do SQLite tudo que for anterior a `<dias>` dias atrás.
 *
 * Tags, favoritos, menu e avaliações de duplicados NÃO são tocados.
 * Rodar com o servidor ligado é seguro: a limpeza é uma transação.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  exportHistory,
  historyCutoffIso,
  parseKeepDays,
  pruneHistory,
} from './lib/db-history-prune.ts'

const DB_PATH = join(process.cwd(), 'data', 'library-tags.sqlite')
const OUT_DIR = join(process.cwd(), 'data', 'db-pull')

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-')
}

function main() {
  const keepDays = parseKeepDays(process.argv[2])
  const nowMs = Date.now()
  const cutoff = historyCutoffIso(nowMs, keepDays)

  const db = new DatabaseSync(DB_PATH)
  try {
    const snap = exportHistory(db, nowMs)
    mkdirSync(OUT_DIR, { recursive: true })
    const file = join(OUT_DIR, `db-history-${stamp(new Date(nowMs))}.json`)
    writeFileSync(file, JSON.stringify(snap, null, 2), 'utf8')
    console.log(`[pull] backup: ${file}`)
    console.log(
      `[pull] linhas no backup: recent_playback=${snap.recent_playback.length}, ` +
        `trailer_view_history=${snap.trailer_view_history.length}, ` +
        `surprise_batch=${snap.surprise_batch.length}, surprise_pick=${snap.surprise_pick.length}`,
    )

    console.log(`[limpeza] mantendo a partir de ${cutoff} (${keepDays} dia(s))`)
    const counts = pruneHistory(db, cutoff)
    console.log(
      `[limpeza] apagadas: recent_playback=${counts.recent_playback}, ` +
        `trailer_view_history=${counts.trailer_view_history}, ` +
        `surprise_batch=${counts.surprise_batch}, surprise_pick=${counts.surprise_pick}`,
    )
  } finally {
    db.close()
  }
}

main()
