/**
 * Apaga tags em data/library-tags.sqlite preservando as inseridas manualmente
 * (video_tags.is_manual = 1).
 *
 * Por defeito remove apenas associacoes automaticas (is_manual = 0) e depois
 * limpa nomes da tabela tags que ficaram orfaos.
 *
 * Flags:
 *   --all        Apaga TUDO, incluindo tags manuais (comportamento antigo).
 *
 * Uso: npx tsx scripts/tag-clear-sqlite.ts
 *      npm run clear-tags
 *      npm run clear-tags -- --all
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dbPath = join(process.cwd(), 'data', 'library-tags.sqlite')

function ensureIsManualColumn(d: DatabaseSync) {
  const cols = d.prepare('PRAGMA table_info(video_tags)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'is_manual')) {
    d.exec('ALTER TABLE video_tags ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0')
  }
}

function main() {
  const wipeAll = process.argv.slice(2).some((a) => a === '--all')

  if (!existsSync(dbPath)) {
    console.log('Nada a fazer: nao existe', dbPath)
    return
  }

  const d = new DatabaseSync(dbPath)
  try {
    ensureIsManualColumn(d)

    const vtTotal =
      (d.prepare('SELECT COUNT(*) AS c FROM video_tags').get() as { c: number } | undefined)?.c ?? 0
    const vtManual =
      (d.prepare('SELECT COUNT(*) AS c FROM video_tags WHERE is_manual = 1').get() as
        | { c: number }
        | undefined)?.c ?? 0
    const tgTotal =
      (d.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number } | undefined)?.c ?? 0

    d.exec('BEGIN')
    if (wipeAll) {
      d.exec('DELETE FROM video_tags')
      d.exec('DELETE FROM tags')
    } else {
      d.exec('DELETE FROM video_tags WHERE is_manual = 0')
      d.exec('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)')
    }
    d.exec('COMMIT')

    const vtAfter =
      (d.prepare('SELECT COUNT(*) AS c FROM video_tags').get() as { c: number } | undefined)?.c ?? 0
    const tgAfter =
      (d.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number } | undefined)?.c ?? 0

    if (wipeAll) {
      console.log(`[--all] Tudo apagado: ${vtTotal} ligacoes video_tags, ${tgTotal} nomes em tags.`)
    } else {
      const vtRemoved = vtTotal - vtAfter
      const tgRemoved = tgTotal - tgAfter
      console.log(
        `Tags automaticas limpas: ${vtRemoved} ligacoes video_tags removidas, ${tgRemoved} nomes em tags removidos.`,
      )
      console.log(`Preservadas: ${vtManual} ligacoes manuais (is_manual=1), ${tgAfter} nomes ainda referenciados.`)
    }
    console.log('Ficheiro:', dbPath)
  } finally {
    d.close()
  }
}

main()
