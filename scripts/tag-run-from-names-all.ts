/**
 * Para cada sessão em data/video-menu.json (fallback: VIDEO_ROOT no .env),
 * corre scripts/tag-from-names.py sobre <raiz>/trailers e grava
 * data/file-lists/tags_<rótulo>.csv.
 *
 * Convenção árvore (subpastas): caminho zz_checking\\chica → ficheiro tags_zz_checking.chica.csv
 * (--tree-relpath no Python); o title no menu folha deve ser ex. "zz_checking.chica".
 *
 * Pipeline completo: npm run auto-tags. Este ficheiro só corre o passo Python (tags_*.csv).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getVideoMenuRowsForCli } from '../server/utils/videoMenu'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const pyScript = join(__dirname, 'tag-from-names.py')

/** Pass-through para tag-from-names.py (--tags-json / --garbage-json). */
function tagRulesArgvFromEnv(): string[] {
  const a: string[] = []
  const t = process.env.VIDEO_TAGS_JSON?.trim()
  const g = process.env.VIDEO_TAGS_GARBAGE_JSON?.trim()
  if (t) a.push('--tags-json', t)
  if (g) a.push('--garbage-json', g)
  return a
}

function loadDotenv() {
  const p = join(projectRoot, '.env')
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

function dirHasVideoFiles(dir: string): boolean {
  const extRe = /\.(mp4|mkv|avi|mov|webm|m4v)$/i
  try {
    const dirents = readdirSync(dir, { withFileTypes: true })
    for (const d of dirents) {
      if (d.isFile() && extRe.test(d.name)) return true
      if (!d.isDirectory() || d.name.startsWith('.')) continue
      try {
        const sub = readdirSync(join(dir, d.name))
        if (sub.some((f) => extRe.test(f))) return true
      } catch {
        /* */
      }
    }
    return false
  } catch {
    return false
  }
}

function runPython(trailersDir: string, label: string, treeRelpath?: string): number {
  const rules = tagRulesArgvFromEnv()
  const args =
    treeRelpath !== undefined
      ? ['-u', pyScript, '--dir', trailersDir, '--tree-relpath', treeRelpath, ...rules]
      : ['-u', pyScript, '--dir', trailersDir, '--label', label, ...rules]
  const tryCmd = (cmd: string, cmdArgs: string[]) => {
    const r = spawnSync(cmd, cmdArgs, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    })
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return r.status ?? 0
  }
  let code = tryCmd('python', args)
  if (code === null) code = tryCmd('py', ['-3', ...args])
  if (code === null) {
    console.error('Nao encontrei "python" nem "py -3" no PATH. Instala Python 3 e pandas (pip install pandas).')
    return 1
  }
  return code
}

function main() {
  loadDotenv()
  let onlySession: number | null = null
  for (const a of process.argv.slice(2)) {
    if (a === '--help' || a === '-h') {
      console.log(`
Uso: npx tsx scripts/tag-run-from-names-all.ts [--session=N]

Corre tag-from-names.py em cada sessão com pasta trailers/.
  --session=N   Só a sessão N (índice do menu)
`)
      process.exit(0)
    }
    const ms = a.match(/^--session=(\d+)$/)
    if (ms) onlySession = Number(ms[1])
  }

  const rows = getVideoMenuRowsForCli()
  if (!rows.length) {
    console.error('Sem bibliotecas: data/video-menu.json (items) ou VIDEO_ROOT / VIDEO_ROOTS no .env.')
    process.exit(1)
  }

  if (onlySession !== null && (onlySession < 0 || onlySession >= rows.length)) {
    console.error(`--session=${onlySession} fora do intervalo (0..${rows.length - 1}).`)
    process.exit(1)
  }

  const indices = onlySession !== null ? [onlySession] : rows.map((_, i) => i)

  let failed = 0
  for (const i of indices) {
    const row = rows[i]!
    const root = row.path.trim()
    const label = row.title.trim()
    const trailersDir = join(root, 'trailers')
    if (!existsSync(trailersDir)) {
      console.warn(`[skip] sem pasta trailers: ${trailersDir}`)
      continue
    }
    if (!dirHasVideoFiles(trailersDir)) {
      console.warn(`[skip] nenhum .mp4/.mkv/.avi/.mov em: ${trailersDir}`)
      continue
    }
    console.log(`\n=== [${i}] ${label} ===`)
    const code = runPython(trailersDir, label)
    if (code !== 0) failed++
  }

  if (failed) {
    console.error(`\nTerminou com ${failed} sessao(oes) com erro.`)
    process.exit(1)
  }
  console.log('\nFeito: tag-from-names.py nas sessoes seleccionadas com trailers.')
}

main()
