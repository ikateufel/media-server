/**
 * Migra bibliotecas já processadas com o esquema antigo:
 * - Move `trailers/preview.*` (ex. preview.zz_*_acelerado.mp4) → `preview/<nome>.mp4`
 * - Renomeia `preview/zz_*_acelerado.*` → `preview/<nome>.*`
 * - Renomeia `trailers/zz_*_acelerado.*` → `trailers/<nome>.*`
 * - Atualiza `trailer_rel` em data/library-tags.sqlite e favoritos em data/library-state.json
 *
 * Requer Node 22+ (sqlite embutido). Lê VIDEO_ROOT do .env (mesma regra que import-tags).
 *
 * Uso (na raiz do projecto):
 *   npx tsx scripts/migrate-legacy-trailers-previews.ts --dry-run
 *   npx tsx scripts/migrate-legacy-trailers-previews.ts
 *   npm run migrate-legacy-trailers -- --dry-run
 *
 * Com varias pastas em VIDEO_ROOT, use --root e --session=N se migrar uma pasta fora da ordem do .env.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseVideoRootsFromEnv } from '../server/utils/parseVideoRoots'
import {
  legacyPreviewInTrailersToFlat,
  legacyTrailerBasenameToFlat,
} from '../server/utils/trailerNames'

interface LibraryStateFile {
  favorites?: Record<string, string[]>
  fullProgress?: Record<string, unknown>
}

interface RelPair {
  session: number
  oldRel: string
  newRel: string
}

function loadDotenv() {
  const p = join(process.cwd(), '.env')
  if (!existsSync(p)) return
  const text = readFileSync(p, 'utf-8')
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

function parseArgs(argv: string[]) {
  let dryRun = false
  let singleRoot: string | null = null
  let sessionForSingleRoot = 0
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Migra trailers/previews legados (zz_ / preview.) para nomes planos e pasta preview/.

  --dry-run, -n       So lista alteracoes (sem renomear nem gravar BD/JSON)
  --root=PATH         So esta pasta (com VIDEO_ROOT multiplo, combina com --session)
  --session=N         Indice da sessao no app (0, 1, ...) para tags/favoritos; com --root o default e 0
`)
      process.exit(0)
    }
    if (a === '--dry-run' || a === '-n') dryRun = true
    const m = a.match(/^--root=(.+)$/)
    if (m) singleRoot = resolve(process.cwd(), m[1].trim())
    const ms = a.match(/^--session=(\d+)$/)
    if (ms) sessionForSingleRoot = Number(ms[1])
  }
  return { dryRun, singleRoot, sessionForSingleRoot }
}

function posixRel(dir: string, name: string): string {
  return `${dir}/${name}`.replace(/\\/g, '/')
}

async function safeRenameFile(src: string, dst: string, dryRun: boolean, label: string): Promise<boolean> {
  let st
  try {
    st = await stat(src)
  } catch {
    return false
  }
  if (!st.isFile()) return false
  if (src === dst) return false
  try {
    await stat(dst)
    console.warn(`[AVISO] Destino ja existe, a saltar: ${label} -> ${dst}`)
    return false
  } catch {
    /* destino nao existe */
  }
  if (dryRun) {
    console.log(`[dry-run] ${label}`)
    return true
  }
  await rename(src, dst)
  console.log(`[ok] ${label}`)
  return true
}

async function migrateSessionRoot(root: string, session: number, dryRun: boolean): Promise<RelPair[]> {
  const pairs: RelPair[] = []
  const trailersDir = join(root, 'trailers')
  const previewDir = join(root, 'preview')

  if (!existsSync(trailersDir)) {
    console.log(`[sessao ${session}] Sem pasta trailers: ${trailersDir}`)
    return pairs
  }

  await mkdir(previewDir, { recursive: true })

  const trailerNames = await readdir(trailersDir)

  for (const name of trailerNames) {
    if (!name.toLowerCase().startsWith('preview.')) continue
    const flat = legacyPreviewInTrailersToFlat(name)
    if (!flat) {
      console.warn(
        `[sessao ${session}] Ficheiro trailers/${name} nao reconhecido como preview legado; ignorado.`,
      )
      continue
    }
    const src = join(trailersDir, name)
    const dst = join(previewDir, flat)
    await safeRenameFile(
      src,
      dst,
      dryRun,
      `mv ${posixRel('trailers', name)} -> ${posixRel('preview', flat)}`,
    )
  }

  if (existsSync(previewDir)) {
    for (const name of await readdir(previewDir)) {
      const flat = legacyTrailerBasenameToFlat(name)
      if (!flat || flat === name) continue
      const src = join(previewDir, name)
      const dst = join(previewDir, flat)
      await safeRenameFile(
        src,
        dst,
        dryRun,
        `mv ${posixRel('preview', name)} -> ${posixRel('preview', flat)}`,
      )
    }
  }

  const trailerNames2 = await readdir(trailersDir)
  for (const name of trailerNames2) {
    if (name.toLowerCase().startsWith('preview.')) continue
    const flat = legacyTrailerBasenameToFlat(name)
    if (!flat || flat === name) continue
    const src = join(trailersDir, name)
    const dst = join(trailersDir, flat)
    const ok = await safeRenameFile(
      src,
      dst,
      dryRun,
      `mv ${posixRel('trailers', name)} -> ${posixRel('trailers', flat)}`,
    )
    if (ok) {
      pairs.push({
        session,
        oldRel: posixRel('trailers', name),
        newRel: posixRel('trailers', flat),
      })
    }
  }

  return pairs
}

function migrateSqlite(pairs: RelPair[], dryRun: boolean) {
  if (!pairs.length) return
  const dbPath = join(process.cwd(), 'data', 'library-tags.sqlite')
  if (!existsSync(dbPath)) {
    console.log('SQLite inexistente, a saltar tags:', dbPath)
    return
  }
  if (dryRun) {
    console.log(`[dry-run] SQLite: ${pairs.length} trailer_rel a reescrever em video_tags`)
    for (const p of pairs) console.log(`         [${p.session}] ${p.oldRel} -> ${p.newRel}`)
    return
  }

  const d = new DatabaseSync(dbPath)
  try {
    d.exec('BEGIN')
    for (const { session, oldRel, newRel } of pairs) {
      if (oldRel === newRel) continue
      const rows = d
        .prepare('SELECT tag_id FROM video_tags WHERE session = ? AND trailer_rel = ?')
        .all(session, oldRel) as { tag_id: number }[]
      for (const { tag_id } of rows) {
        d.prepare(
          'INSERT OR IGNORE INTO video_tags (session, trailer_rel, tag_id) VALUES (?, ?, ?)',
        ).run(session, newRel, tag_id)
      }
      d.prepare('DELETE FROM video_tags WHERE session = ? AND trailer_rel = ?').run(session, oldRel)
    }
    d.exec('COMMIT')
    console.log(`SQLite: video_tags migrados (${pairs.length} trailers).`)
  } catch (e) {
    try {
      d.exec('ROLLBACK')
    } catch {
      /* */
    }
    throw e
  } finally {
    d.close()
  }
}

async function migrateLibraryStateJson(pairs: RelPair[], dryRun: boolean) {
  if (!pairs.length) return
  const path = join(process.cwd(), 'data', 'library-state.json')
  if (!existsSync(path)) {
    console.log('library-state.json inexistente, a saltar favoritos.')
    return
  }
  const raw = await readFile(path, 'utf-8')
  const state = JSON.parse(raw) as LibraryStateFile
  if (!state.favorites || typeof state.favorites !== 'object') return

  let changed = false
  for (const { session, oldRel, newRel } of pairs) {
    const k = String(Math.max(0, Math.floor(session)))
    const arr = state.favorites[k]
    if (!Array.isArray(arr)) continue
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === oldRel) {
        arr[i] = newRel
        changed = true
      }
    }
  }

  if (!changed) return
  if (dryRun) {
    console.log('[dry-run] library-state.json: favoritos com trailer_rel antigo seriam atualizados.')
    return
  }
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  console.log('library-state.json: favoritos atualizados.')
}

async function main() {
  loadDotenv()
  const { dryRun, singleRoot, sessionForSingleRoot } = parseArgs(process.argv.slice(2))
  const raw = process.env.VIDEO_ROOT ?? process.env.NUXT_VIDEO_ROOT ?? ''
  const roots = singleRoot ? [singleRoot] : parseVideoRootsFromEnv(raw)
  if (!roots.length) {
  console.error('Defina VIDEO_ROOT no .env ou use --root=<caminho-absoluto-da-biblioteca>')
    process.exit(1)
  }

  console.log(dryRun ? '--- DRY-RUN (sem alterar ficheiros nem BD) ---' : '--- MIGRAÇÃO ---')
  const allPairs: RelPair[] = []
  for (let s = 0; s < roots.length; s++) {
    const root = roots[s]!.trim()
    if (!existsSync(root)) {
      console.warn(`[sessao ${s}] Raiz inexistente: ${root}`)
      continue
    }
    const sessionIndex = singleRoot ? sessionForSingleRoot : s
    console.log(`\n[sessao app=${sessionIndex}] ${root}`)
    const pairs = await migrateSessionRoot(root, sessionIndex, dryRun)
    allPairs.push(...pairs)
  }

  migrateSqlite(allPairs, dryRun)
  await migrateLibraryStateJson(allPairs, dryRun)

  console.log(
    dryRun
      ? '\nCorra sem --dry-run para aplicar (apos rever a lista acima).'
      : `\nConcluido. Trailers renomeados: ${allPairs.length}.`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
