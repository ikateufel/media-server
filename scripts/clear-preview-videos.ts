/**
 * Remove vídeos curtos em `preview/` (slideshow antigo do preview.bat).
 * NÃO apaga `.thumb_cache/` nem trailers normais em `trailers/`.
 *
 * Uso:
 *   npx tsx scripts/clear-preview-videos.ts
 *   npx tsx scripts/clear-preview-videos.ts --delete
 *   npx tsx scripts/clear-preview-videos.ts --delete --session=0
 *   npx tsx scripts/clear-preview-videos.ts --delete --root=D:\videos\biblioteca
 *   npm run clear-preview-videos
 */
import { existsSync, readFileSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { movePathsToRecycleBin } from '../server/utils/moveToRecycleBin'
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
  let includeLegacyInTrailers = true
  let removeEmptyDirs = true

  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Apaga vídeos em preview/ (slideshow legado). Miniaturas .thumb_cache/ ficam intactas.

  --dry-run, -n       Só lista (predefinido)
  --delete            Envia ficheiros para a lixeira
  --session=N         Só a sessão N (índice do menu)
  --root=PATH         Só esta pasta de biblioteca
  --no-legacy         Não remove trailers/preview.* legados
  --keep-dirs         Não remove pastas preview/ vazias depois do delete
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
    if (a === '--no-legacy') includeLegacyInTrailers = false
    if (a === '--keep-dirs') removeEmptyDirs = false
    const m = a.match(/^--root=(.+)$/)
    if (m) singleRoot = resolve(process.cwd(), m[1]!.trim())
    const ms = a.match(/^--session=(\d+)$/)
    if (ms) sessionFilter = Number(ms[1])
  }

  if (!deleteFiles && !argv.some((a) => a === '--delete')) dryRun = true

  return { dryRun, deleteFiles, sessionFilter, singleRoot, includeLegacyInTrailers, removeEmptyDirs }
}

function isPreviewVideoFile(name: string): boolean {
  return PREVIEW_VIDEO_EXTS.has(extname(name).toLowerCase())
}

async function fileIsVideo(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isFile() && isPreviewVideoFile(path)
  } catch {
    return false
  }
}

/** Todos os vídeos em preview/ (recursivo em todas as subpastas). */
async function collectPreviewDirVideos(root: string): Promise<string[]> {
  const previewDir = join(root, 'preview')
  const out: string[] = []

  async function walk(dir: string) {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isFile()) {
        if (await fileIsVideo(full)) out.push(full)
      } else if (e.isDirectory()) {
        await walk(full)
      }
    }
  }

  await walk(previewDir)
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Ficheiros preview.* dentro de trailers/ (legado, fora do catálogo). */
async function collectLegacyPreviewInTrailers(root: string): Promise<string[]> {
  const trailersDir = join(root, 'trailers')
  const out: string[] = []
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(trailersDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isFile()) continue
    if (!e.name.toLowerCase().startsWith('preview.')) continue
    if (!isPreviewVideoFile(e.name)) continue
    const full = join(trailersDir, e.name)
    if (await fileIsVideo(full)) out.push(full)
  }
  return out
}

function removeEmptyPreviewDirs(root: string) {
  const previewDir = join(root, 'preview')
  if (!existsSync(previewDir)) return

  function walk(dir: string) {
    let entries: string[]
    try {
      entries = readdirSyncSafe(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSyncSafe(full)?.isDirectory()) walk(full)
    }
    const remaining = readdirSyncSafe(dir).filter((n) => !n.startsWith('.'))
    if (remaining.length === 0) {
      rmdirSync(dir)
      console.log(`  [pasta vazia removida] ${dir}`)
    }
  }

  walk(previewDir)
}

function readdirSyncSafe(dir: string): string[] {
  return readdirSync(dir)
}

function statSyncSafe(path: string): import('node:fs').Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

async function main() {
  loadDotenv()
  const {
    dryRun,
    deleteFiles,
    sessionFilter,
    singleRoot,
    includeLegacyInTrailers,
    removeEmptyDirs,
  } = parseArgs(process.argv.slice(2))

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
      if (sessionFilter !== null && session !== sessionFilter) continue
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
      ? 'Modo listagem (--delete para enviar à lixeira). .thumb_cache/ não é tocado.'
      : 'Modo DELETE: vídeos preview/ → lixeira. .thumb_cache/ intacto.',
  )

  const allPaths = new Set<string>()
  const rootsTouched = new Set<string>()

  for (const { session, path, title } of sessions) {
    const root = path.trim()
    if (!root) continue

    const fromPreview = await collectPreviewDirVideos(root)
    const fromLegacy = includeLegacyInTrailers ? await collectLegacyPreviewInTrailers(root) : []

    if (!fromPreview.length && !fromLegacy.length) continue

    console.log(`\n[${session}] ${title}`)
    console.log(`  Raiz: ${root}`)

    for (const p of fromPreview) {
      if (allPaths.has(p)) continue
      allPaths.add(p)
      rootsTouched.add(root)
      const rel = relative(root, p).replace(/\\/g, '/')
      console.log(`  preview/: ${rel}`)
    }
    for (const p of fromLegacy) {
      if (allPaths.has(p)) continue
      allPaths.add(p)
      rootsTouched.add(root)
      const rel = relative(root, p).replace(/\\/g, '/')
      console.log(`  legado trailers/: ${rel}`)
    }
  }

  console.log('')
  console.error(`Resumo: ${allPaths.size} ficheiro(s) de vídeo preview.`)

  if (allPaths.size === 0) {
    console.error('Nada a remover — nenhum vídeo em preview/.')
    process.exit(0)
  }

  if (dryRun) {
    console.error('Para apagar: npm run clear-preview-videos -- --delete')
    process.exit(0)
  }

  const paths = [...allPaths]
  try {
    await movePathsToRecycleBin(paths)
    for (const p of paths) console.log(`  [lixeira] ${p}`)
  } catch (e) {
    console.error('Falha ao enviar para a lixeira:', e instanceof Error ? e.message : e)
    process.exit(1)
  }

  if (removeEmptyDirs) {
    for (const root of rootsTouched) removeEmptyPreviewDirs(root)
  }

  console.error('Concluído. Miniaturas em .thumb_cache/ mantidas — correr warm-preview-cache se quiser regenerar JPEGs.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
