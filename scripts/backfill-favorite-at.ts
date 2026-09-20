/**
 * Preenche `favoriteAt` em data/library-state.json para favoritos antigos sem timestamp.
 *
 * Heurística (por ordem):
 *  1. `fullProgress.updated` do mainRel associado ao trailer
 *  2. mtime do ficheiro trailer no disco
 *  3. 1970-01-01T00:00:00.000Z (legado — data desconhecida)
 *
 * Uso:
 *   npx tsx scripts/backfill-favorite-at.ts --dry-run
 *   npm run backfill-favorite-at
 */
import { existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  fullProgressKey,
  readLibraryState,
  writeLibraryState,
  type LibraryState,
} from '../server/utils/libraryState'
import { findMainFileInSessionRoot } from '../server/utils/trailerNames'
import { resolveSafeUnderRoot } from '../server/utils/videoPaths'
import { getVideoMenuRowsForCli } from '../server/utils/videoMenu'

const LEGACY_UNKNOWN_AT = '1970-01-01T00:00:00.000Z'

function loadDotenv() {
  const p = join(process.cwd(), '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
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
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Preenche favoriteAt para favoritos sem timestamp em library-state.json.

  --dry-run, -n   Só lista alterações (sem gravar)
`)
      process.exit(0)
    }
    if (a === '--dry-run' || a === '-n') dryRun = true
  }
  return { dryRun }
}

function normalizeTrailerRel(rel: string): string {
  return rel.replace(/\\/g, '/').trim()
}

async function resolveFavoriteAtIso(
  state: LibraryState,
  session: number,
  root: string,
  trailerRel: string,
): Promise<{ at: string; source: 'progress' | 'trailer-mtime' | 'legacy' }> {
  const norm = normalizeTrailerRel(trailerRel)
  if (!norm.toLowerCase().startsWith('trailers/')) {
    return { at: LEGACY_UNKNOWN_AT, source: 'legacy' }
  }

  const within = norm.slice('trailers/'.length)
  const main = await findMainFileInSessionRoot(root.trim(), within)
  if (main) {
    const mainRel = main.mainFilename.replace(/\\/g, '/')
    const prog = state.fullProgress[fullProgressKey(session, mainRel)]
    const updated = prog?.updated
    if (typeof updated === 'string' && updated.trim() && Number.isFinite(Date.parse(updated))) {
      return { at: new Date(Date.parse(updated)).toISOString(), source: 'progress' }
    }
  }

  try {
    const trailerPath = resolveSafeUnderRoot(root.trim(), norm)
    const st = await stat(trailerPath)
    if (st.isFile()) {
      return { at: new Date(st.mtimeMs).toISOString(), source: 'trailer-mtime' }
    }
  } catch {
    /* ficheiro inexistente ou caminho inválido */
  }

  return { at: LEGACY_UNKNOWN_AT, source: 'legacy' }
}

async function backfillFavoriteAt(dryRun: boolean) {
  const menu = getVideoMenuRowsForCli()
  if (!menu.length) {
    console.error('Sem bibliotecas (video-menu.json ou VIDEO_ROOT).')
    process.exit(1)
  }

  const state = await readLibraryState()
  let added = 0
  const bySource = { progress: 0, 'trailer-mtime': 0, legacy: 0 }

  for (const [sessionKey, rels] of Object.entries(state.favorites)) {
    if (!Array.isArray(rels) || !rels.length) continue
    const session = Number(sessionKey)
    if (!Number.isFinite(session) || session < 0 || session >= menu.length) {
      console.warn(`Sessão ${sessionKey} fora do menu — a saltar ${rels.length} favorito(s).`)
      continue
    }
    const root = menu[session]!.path
    if (!root?.trim()) continue

    const times = state.favoriteAt[sessionKey] ?? (state.favoriteAt[sessionKey] = {})

    for (const trailerRel of rels) {
      const norm = normalizeTrailerRel(trailerRel)
      if (!norm) continue
      const existing = times[norm] ?? times[trailerRel]
      if (typeof existing === 'string' && existing.trim() && Number.isFinite(Date.parse(existing))) {
        if (!times[norm]) times[norm] = new Date(Date.parse(existing)).toISOString()
        continue
      }

      const { at, source } = await resolveFavoriteAtIso(state, session, root, norm)
      times[norm] = at
      if (trailerRel !== norm && trailerRel in times) delete times[trailerRel]
      added++
      bySource[source]++
      const label = menu[session]!.title || root
      console.log(`[${session}] ${label}: ${norm} → ${at} (${source})`)
    }
  }

  if (!added) {
    console.log('Nada a preencher — todos os favoritos já têm favoriteAt.')
    return
  }

  console.log(
    `\n${added} timestamp(s): progress=${bySource.progress}, trailer-mtime=${bySource['trailer-mtime']}, legacy=${bySource.legacy}`,
  )

  if (dryRun) {
    console.log('[dry-run] library-state.json não foi alterado.')
    return
  }

  await writeLibraryState(state)
  console.log('library-state.json gravado.')
}

async function main() {
  loadDotenv()
  const { dryRun } = parseArgs(process.argv.slice(2))
  await backfillFavoriteAt(dryRun)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
