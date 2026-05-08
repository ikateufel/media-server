/**
 * Em cada raiz de biblioteca (video-menu.json ou VIDEO_ROOT), na pasta raiz da sessão:
 * encontra vídeos que **não** têm trailer correspondente em `trailers/` e move-os para `analyze/`
 * para inspeção manual (ffprobe falhou, nome estranho, etc.).
 *
 * Considera trailer existente se houver **qualquer** destes ficheiros em `trailers/`:
 *   - `<stem>.mp4` (esquema actual do trailer.bat)
 *   - `zz_<stem>_acelerado.mp4` (legado)
 *
 * Só olha para ficheiros **directamente na raiz** da sessão (igual ao trailer.bat com `*.mp4` na pasta do filme).
 * Ignora **subpastas** na raiz (só ficheiros directos na raiz; trailers/, analyze/, etc. não são listados como ficheiros).
 *
 * Uso:
 *   npx tsx scripts/move-no-trailer-to-analyze.ts --dry-run
 *   npx tsx scripts/move-no-trailer-to-analyze.ts
 *   npm run analyze-no-trailer -- --dry-run
 *
 * Windows: correr scripts/analyze-no-trailer.bat na pasta da biblioteca (como trailer.bat); LIST_ONLY=1 so lista.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, rename, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { getVideoRootsForCli } from '../server/utils/videoMenu'

const VIDEO_EXT = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.m2ts',
  '.mts',
  '.3gp',
])

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
  let sessionFilter: number | null = null
  let singleRoot: string | null = null
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Move para analyze/ os videos na raiz da sessao sem trailer em trailers/.

  --dry-run, -n       So lista, nao move
  --session=N       So a sessao N (indice do menu)
  --root=PATH       So uma pasta (combine com --session se nao for a 0)
`)
      process.exit(0)
    }
    if (a === '--dry-run' || a === '-n') dryRun = true
    const m = a.match(/^--root=(.+)$/)
    if (m) singleRoot = resolve(process.cwd(), m[1].trim())
    const ms = a.match(/^--session=(\d+)$/)
    if (ms) sessionFilter = Number(ms[1])
  }
  return { dryRun, sessionFilter, singleRoot }
}

/** Nomes de trailer possíveis em trailers/ para um ficheiro principal na raiz. */
function expectedTrailerBasenames(mainFilename: string): string[] {
  const ext = extname(mainFilename).toLowerCase()
  const stem = basename(mainFilename, ext)
  return [`${stem}.mp4`, `zz_${stem}_acelerado.mp4`]
}

async function hasAnyTrailer(trailersDir: string, mainFilename: string): Promise<boolean> {
  for (const t of expectedTrailerBasenames(mainFilename)) {
    try {
      const st = await stat(join(trailersDir, t))
      if (st.isFile()) return true
    } catch {
      /* */
    }
  }
  return false
}

function uniqueDestPath(analyzeDir: string, name: string): string {
  const dest = join(analyzeDir, name)
  let out = dest
  const ext = extname(name)
  const stem = basename(name, ext)
  let n = 1
  while (existsSync(out)) {
    out = join(analyzeDir, `${stem}_${n}${ext}`)
    n++
  }
  return out
}

async function processRoot(root: string, sessionLabel: string, dryRun: boolean): Promise<number> {
  const trailersDir = join(root, 'trailers')
  const analyzeDir = join(root, 'analyze')
  let moved = 0

  if (!existsSync(trailersDir)) {
    console.warn(`[${sessionLabel}] Sem pasta trailers/; nada a comparar.`)
    return 0
  }

  const entries = await readdir(root, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])
  for (const d of entries) {
    if (d.isDirectory()) continue
    if (!d.isFile()) continue
    const name = d.name
    if (name.startsWith('.')) continue
    const low = name.toLowerCase()
    if (low.startsWith('zz_')) continue
    if (low.startsWith('preview.')) continue
    const ext = extname(name).toLowerCase()
    if (!VIDEO_EXT.has(ext)) continue

    if (await hasAnyTrailer(trailersDir, name)) continue

    const src = join(root, name)
    if (dryRun) {
      console.log(`[${sessionLabel}] [dry-run] sem trailer -> analyze/: ${name}`)
      moved++
      continue
    }

    await mkdir(analyzeDir, { recursive: true })
    const dst = uniqueDestPath(analyzeDir, name)
    await rename(src, dst)
    console.log(`[${sessionLabel}] movido: ${name} -> analyze/${basename(dst)}`)
    moved++
  }
  return moved
}

async function main() {
  loadDotenv()
  const { dryRun, sessionFilter, singleRoot } = parseArgs(process.argv.slice(2))
  const roots = singleRoot ? [singleRoot] : getVideoRootsForCli()
  if (!roots.length) {
    console.error('Sem raizes: defina VIDEO_ROOT no .env ou data/video-menu.json.')
    process.exit(1)
  }

  let total = 0
  for (let i = 0; i < roots.length; i++) {
    const sessionIndex = singleRoot ? (sessionFilter ?? 0) : i
    if (!singleRoot && sessionFilter !== null && i !== sessionFilter) continue

    const root = roots[i]!.trim()
    try {
      await stat(root)
    } catch {
      console.warn(`[sessao ${sessionIndex}] Raiz inexistente: ${root}`)
      continue
    }

    const label = `sessao ${sessionIndex}`
    console.log(`\n${label}: ${root}`)
    const n = await processRoot(root, label, dryRun)
    total += n
    if (n === 0) console.log('  (nenhum ficheiro na raiz sem trailer)')
  }

  console.log(
    dryRun
      ? `\nDry-run: ${total} ficheiro(s) seriam movidos para analyze/. Corra sem --dry-run para aplicar.`
      : `\nConcluido: ${total} ficheiro(s) movidos para analyze/.`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
