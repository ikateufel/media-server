/**
 * Lista trailers e previews cujo vídeo completo já não existe na pasta da biblioteca.
 * Opcionalmente envia para a lixeira (`--delete`) e limpa JPEGs em `.thumb_cache/`.
 *
 * Uso:
 *   npx tsx scripts/find-orphan-trailers-previews.ts
 *   npx tsx scripts/find-orphan-trailers-previews.ts --dry-run
 *   npx tsx scripts/find-orphan-trailers-previews.ts --delete
 *   npx tsx scripts/find-orphan-trailers-previews.ts --session=0
 *   npm run find-orphan-trailers-previews
 */
import { existsSync, readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import {
  collectOrphanTrailerPreviewPaths,
  purgePreviewThumbCacheForTitle,
} from '../server/utils/titleFileCleanup'
import {
  legacyPreviewInTrailersToFlat,
  parseTrailersDirRelativePath,
  trailerToMainFilename,
  findMainFileInSessionRoot,
} from '../server/utils/trailerNames'
import { scanTrailersCatalogInRoot } from '../server/utils/trailerCatalogScan'
import { getVideoMenuRowsForCli } from '../server/utils/videoMenu'

const PREVIEW_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.avi'])

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
  let dryRun = true
  let deleteFiles = false
  let sessionFilter: number | null = null
  let singleRoot: string | null = null

  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Trailers/previews sem vídeo completo na biblioteca.

  --dry-run, -n     Só lista (predefinido se não passar --delete)
  --delete          Envia ficheiros para a lixeira e limpa .thumb_cache/
  --session=N       Só a sessão N (índice do menu)
  --root=PATH       Só uma pasta (índice de sessão ignorado se for a única raiz)
`)
      process.exit(0)
    }
    if (a === '--delete') {
      deleteFiles = true
      dryRun = false
      continue
    }
    if (a === '--dry-run' || a === '-n') {
      dryRun = true
      deleteFiles = false
      continue
    }
    const m = a.match(/^--root=(.+)$/)
    if (m) singleRoot = resolve(process.cwd(), m[1]!.trim())
    const ms = a.match(/^--session=(\d+)$/)
    if (ms) sessionFilter = Number(ms[1])
  }

  if (!deleteFiles && !argv.some((a) => a === '--delete')) dryRun = true

  return { dryRun, deleteFiles, sessionFilter, singleRoot }
}

function isPreviewVideoFile(name: string): boolean {
  return PREVIEW_VIDEO_EXTS.has(extname(name).toLowerCase())
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isFile()
  } catch {
    return false
  }
}

async function hasAnyTrailerForPreviewRel(root: string, withinPreview: string): Promise<boolean> {
  const parsed = parseTrailersDirRelativePath(withinPreview)
  const fileName = parsed?.fileName ?? withinPreview
  const stem = basename(fileName, extname(fileName))
  const relWithin = parsed?.subfolder ? `${parsed.subfolder}/${fileName}` : fileName
  const trailersDir = join(root, 'trailers')

  const candidates = [join(trailersDir, relWithin), join(trailersDir, fileName)]
  for (const ext of ['.mp4', '.mkv', '.webm', '.m4v']) {
    const flat = stem + ext
    const rel = parsed?.subfolder ? `${parsed.subfolder}/${flat}` : flat
    candidates.push(join(trailersDir, rel), join(trailersDir, `zz_${stem}_acelerado${ext}`))
  }
  if (parsed?.subfolder) {
    candidates.push(join(root, parsed.subfolder, 'trailers', fileName))
    for (const ext of ['.mp4', '.mkv']) {
      candidates.push(join(root, parsed.subfolder, 'trailers', stem + ext))
    }
  }
  for (const c of candidates) {
    if (await fileExists(c)) return true
  }
  return false
}

/** Previews em `preview/` sem trailer em `trailers/` e sem completo na raiz. */
async function collectStandalonePreviewOrphans(root: string): Promise<string[]> {
  const previewDir = join(root, 'preview')
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(previewDir, { withFileTypes: true })
  } catch {
    return []
  }

  const paths = new Set<string>()

  async function consider(relWithin: string) {
    if (!isPreviewVideoFile(relWithin)) return
    if (await hasAnyTrailerForPreviewRel(root, relWithin)) return
    const foundMain = await findMainFileInSessionRoot(root, relWithin)
    if (foundMain) return
    const full = join(previewDir, relWithin)
    if (await fileExists(full)) paths.add(full)
  }

  for (const e of entries) {
    if (e.isFile()) {
      await consider(e.name)
      continue
    }
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    let sub: Awaited<ReturnType<typeof readdir>>
    try {
      sub = await readdir(join(previewDir, e.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const f of sub) {
      if (!f.isFile()) continue
      await consider(`${e.name}/${f.name}`.replace(/\\/g, '/'))
    }
  }

  return [...paths]
}

/** `trailers/preview.*` legados (não entram no catálogo) sem completo. */
async function collectLegacyPreviewInTrailersOrphans(root: string): Promise<string[]> {
  const trailersDir = join(root, 'trailers')
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(trailersDir, { withFileTypes: true })
  } catch {
    return []
  }

  const paths: string[] = []

  for (const e of entries) {
    if (!e.isFile()) continue
    if (!e.name.toLowerCase().startsWith('preview.')) continue
    const flat = legacyPreviewInTrailersToFlat(e.name)
    if (!flat) continue
    const foundMain = await findMainFileInSessionRoot(root, flat)
    if (foundMain) continue
    const full = join(trailersDir, e.name)
    if (await fileExists(full)) paths.push(full)
  }

  return paths
}

async function deletePaths(paths: string[]): Promise<number> {
  const { default: trash } = await import('trash')
  let failed = 0
  for (const p of paths) {
    try {
      await trash(p, { glob: false })
      console.log(`  [lixeira] ${p}`)
    } catch (e) {
      console.error(`  [FALHOU] ${p}`, e instanceof Error ? e.message : e)
      failed++
    }
  }
  return failed
}

async function main() {
  loadDotenv()
  const { dryRun, deleteFiles, sessionFilter, singleRoot } = parseArgs(process.argv.slice(2))

  const menu = getVideoMenuRowsForCli()
  if (!menu.length && !singleRoot) {
    console.error('Sem bibliotecas (video-menu.json ou VIDEO_ROOT).')
    process.exit(1)
  }

  const sessions: { session: number; path: string; title: string }[] = []
  if (singleRoot) {
    sessions.push({ session: 0, path: singleRoot, title: basename(singleRoot) })
  } else {
    for (let session = 0; session < menu.length; session++) {
      if (sessionFilter != null && session !== sessionFilter) continue
      const row = menu[session]!
      sessions.push({ session, path: row.path, title: row.title || row.path })
    }
  }

  if (!sessions.length) {
    console.error('Nenhuma sessão corresponde ao filtro.')
    process.exit(1)
  }

  console.error(
    dryRun
      ? 'Modo listagem (--delete para enviar à lixeira).'
      : 'Modo DELETE: ficheiros vão para a lixeira.',
  )

  let totalGroups = 0
  let totalFiles = 0
  const allPaths = new Set<string>()
  const thumbRelsByRoot = new Map<string, Set<string>>()

  for (const { session, path, title } of sessions) {
    const root = path.trim()
    if (!root) continue
    const label = title || root

    const { items } = await scanTrailersCatalogInRoot(root)
    const orphans = items.filter((it) => !it.hasMain)

    const standalonePreviews = await collectStandalonePreviewOrphans(root)
    const legacyPreviews = await collectLegacyPreviewInTrailersOrphans(root)

    if (!orphans.length && !standalonePreviews.length && !legacyPreviews.length) continue

    console.log(`\n[${session}] ${label}`)
    console.log(`  Raiz: ${root}`)

    for (const it of orphans) {
      const collected = await collectOrphanTrailerPreviewPaths(root, it.trailerRel)
      if (!collected) continue
      totalGroups++
      console.log(`  Órfão: ${collected.trailerRel} (completo em falta: ${collected.expectedMainRel})`)
      for (const p of collected.paths) {
        console.log(`    ${p}`)
        allPaths.add(p)
        totalFiles++
      }
      const rels = thumbRelsByRoot.get(root) ?? new Set()
      rels.add(collected.trailerRel)
      if (collected.previewRel) rels.add(collected.previewRel)
      thumbRelsByRoot.set(root, rels)
    }

    for (const p of standalonePreviews) {
      if (allPaths.has(p)) continue
      totalGroups++
      console.log(`  Preview órfão (sem trailer/completo): ${p}`)
      allPaths.add(p)
      totalFiles++
      const rel = `preview/${relative(join(root, 'preview'), p).replace(/\\/g, '/')}`
      const rels = thumbRelsByRoot.get(root) ?? new Set()
      rels.add(rel)
      thumbRelsByRoot.set(root, rels)
    }

    for (const p of legacyPreviews) {
      if (allPaths.has(p)) continue
      totalGroups++
      console.log(`  Preview legado em trailers/: ${p}`)
      allPaths.add(p)
      totalFiles++
    }
  }

  console.log('')
  console.error(
    `Resumo: ${totalGroups} grupo(s), ${allPaths.size} ficheiro(s) de vídeo distinto(s).`,
  )

  if (allPaths.size === 0) {
    console.error('Nada a remover — todos os trailers/previews têm completo ou não há órfãos.')
    process.exit(0)
  }

  if (dryRun) {
    console.error('Para apagar: npm run find-orphan-trailers-previews -- --delete')
    process.exit(0)
  }

  let failed = 0
  for (const [root, rels] of thumbRelsByRoot) {
    const n = await purgePreviewThumbCacheForTitle(root, [...rels])
    if (n > 0) console.error(`  [${root}] ${n} JPEG(s) em .thumb_cache/ removido(s)`)
  }

  failed += await deletePaths([...allPaths])
  if (failed > 0) process.exit(1)
  console.error('Concluído.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
