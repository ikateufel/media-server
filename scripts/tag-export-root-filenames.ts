/**
 * Exporta listagens de nomes de ficheiros de vídeo (um .csv por sessão do menu).
 * Cada linha = nome de ficheiro na **raiz** da pasta ou em **uma subpasta de 1º nível**.
 * Não desce além desse nível.
 *
 * Raízes e ordem: `data/video-menu.json` se existir; senão `VIDEO_ROOT` / `VIDEO_ROOTS` no .env.
 * Nome do .csv = título do menu (ou rótulo da pasta).
 *
 * Uso (na raiz do projecto):
 *   npx tsx scripts/tag-export-root-filenames.ts
 *   npx tsx scripts/tag-export-root-filenames.ts --out=data/file-lists
 *   npx tsx scripts/tag-export-root-filenames.ts --session=0
 *
 * --no-trailers  Ignorado (mantido só por compatibilidade; trailers já não entram na lista).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { getVideoMenuRowsForCli } from '../server/utils/videoMenu'

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.mpeg', '.mpg'])

function sanitizeCsvBasename(label: string, sessionIndex: number): string {
  let s = label
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim()
    .replace(/[.\s]+$/g, '')
  if (!s) s = `session-${sessionIndex}`
  return s
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

function csvEscapeLine(s: string): string {
  const v = String(s ?? '')
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function fileNamesToCsvBody(names: string[]): string {
  return names.map((n) => csvEscapeLine(n)).join('\r\n') + '\r\n'
}

/** Vídeos na raiz de `root` e em 1º nível (`Sub/ficheiro.ext`), sem recursão profunda. */
async function collectRootVideoNames(root: string): Promise<string[]> {
  const abs = resolve(root.trim())
  const out: string[] = []
  let entries
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.isFile()) {
      const name = e.name
      if (name.startsWith('zz_')) continue
      const ext = extname(name).toLowerCase()
      if (!VIDEO_EXT.has(ext)) continue
      out.push(name)
      continue
    }
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    let subEntries
    try {
      subEntries = await readdir(join(abs, e.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const se of subEntries) {
      if (!se.isFile()) continue
      const file = se.name
      if (file.startsWith('zz_')) continue
      const ext = extname(file).toLowerCase()
      if (!VIDEO_EXT.has(ext)) continue
      out.push(`${e.name}/${file}`.replace(/\\/g, '/'))
    }
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function parseArgs(argv: string[]) {
  let outDir = join(process.cwd(), 'data', 'file-lists')
  let session: number | null = null
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Uso: npx tsx scripts/tag-export-root-filenames.ts [opcoes]

  --out=DIR       Pasta de saida (default: data/file-lists)
  --session=N     So a sessao N (indice do menu / VIDEO_ROOT)
  --no-trailers   (ignorado; lista so a raiz)
  -h, --help      Ajuda

Gera <titulo-menu>.csv: uma linha por ficheiro de video na raiz da sessao
ou na primeira subpasta (Sub/ficheiro.ext).

UTF-8 com BOM (Excel no Windows).
`)
      process.exit(0)
    }
    const mo = a.match(/^--out=(.+)$/)
    if (mo) outDir = resolve(process.cwd(), mo[1].trim())
    const ms = a.match(/^--session=(\d+)$/)
    if (ms) session = Number(ms[1])
  }
  return { outDir, session }
}

async function main() {
  loadDotenv()
  const { outDir, session: onlySession } = parseArgs(process.argv.slice(2))

  const menuRows = getVideoMenuRowsForCli()
  if (!menuRows.length) {
    console.error('Sem raízes: defina data/video-menu.json ou VIDEO_ROOT no .env.')
    process.exit(1)
  }

  if (onlySession !== null && (onlySession < 0 || onlySession >= menuRows.length)) {
    console.error(`--session=${onlySession} fora do intervalo (0..${menuRows.length - 1}).`)
    process.exit(1)
  }

  const indices = onlySession !== null ? [onlySession] : menuRows.map((_, i) => i)

  mkdirSync(outDir, { recursive: true })

  for (const i of indices) {
    const row = menuRows[i]!
    const root = row.path.trim()
    const names = await collectRootVideoNames(root)
    names.sort((a, b) => a.localeCompare(b))

    const csvBody = fileNamesToCsvBody(names)
    const bom = '\uFEFF'
    const baseName = sanitizeCsvBasename(row.title, i)
    const outFile = join(outDir, `${baseName}.csv`)
    writeFileSync(outFile, bom + csvBody, 'utf-8')
    console.log(`Escrito ${outFile} (${names.length} nomes na raiz + 1o nivel de ${root}).`)
  }

  console.log(`\nPasta de saida: ${outDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
