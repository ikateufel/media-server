/**
 * Le data/file-lists (ou --dir=...) e processa ficheiros tags_<rótulo>.csv/.txt.
 * Rótulo = title da sessão em data/video-menu.json (fallback .env).
 *
 * Árvore de pastas no nome do ficheiro: caminho relativo zz_checking\\chica → tags_zz_checking.chica.csv
 * (segmentos unidos por "."); o title dessa sessão folha deve ser ex. "zz_checking.chica".
 * @see server/utils/tagsFileLabel.ts — relativeTreePathToTagsFileLabel
 *
 * Formato fixo: colunas separadas por PIPE | (campos entre "..." se tiverem | ou aspas).
 *   arquivo.mp4|tagA;tagB;tagC
 *   "nome, com virgula.mkv"|tagA;tagB
 * A segunda coluna e UMA string: varias tags so separadas por PONTO-E-VIRGULA (;).
 * Linha de cabecalho tipo arquivo|tags e ignorada.
 *
 * Raízes e rótulos das sessões: data/video-menu.json (items[].path / title) quando válido;
 * senão VIDEO_ROOT / VIDEO_ROOTS no .env (mesma ordem que o servidor).
 *
 * Uso:
 *   npx tsx scripts/tag-import-file-lists.ts
 *   npx tsx scripts/tag-import-file-lists.ts --dry-run
 *   npx tsx scripts/tag-import-file-lists.ts --dir=data/file-lists
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { getVideoMenuRowsForCli } from '../server/utils/videoMenu'
import { isCatalogTrailerRelSuffix } from '../server/utils/trailerNames'
import { addTagToVideo, normalizeTagInput } from '../server/utils/videoTagsDb'

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
  let dir = join(process.cwd(), 'data', 'file-lists')
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Lê ficheiros tags_<rótulo>.csv ou .txt em --dir (default: data/file-lists).
<rótulo> = title no menu; para subpastas usa pontos: zz_checking.chica ↔ tags_zz_checking.chica.csv

Cada linha: ficheiro.mp4|tag1;tag2;tag3  (colunas por | ; tags na 2. coluna por ;)

  --dir=PATH     Pasta a varrer
  --dry-run, -n  So mostra o que faria
`)
      process.exit(0)
    }
    if (a === '--dry-run' || a === '-n') dryRun = true
    const m = a.match(/^--dir=(.+)$/)
    if (m) dir = resolve(process.cwd(), m[1].trim())
  }
  return { dryRun, dir }
}

function resolveTrailerRel(sessionRoot: string, firstField: string): string | null {
  const f = firstField.trim().replace(/\\/g, '/')
  if (!f) return null
  const rel = (f.startsWith('trailers/') ? f : `trailers/${f}`).replace(/\\/g, '/')
  const within = rel.startsWith('trailers/') ? rel.slice('trailers/'.length) : ''
  if (!within || within.includes('..') || !isCatalogTrailerRelSuffix(within)) return null
  const abs = join(sessionRoot, ...rel.split('/'))
  if (existsSync(abs)) return rel
  return null
}

function labelFromTagsFilename(file: string): string | null {
  const base = basename(file)
  const ext = extname(base).toLowerCase()
  if (ext !== '.csv' && ext !== '.txt') return null
  const name = basename(base, ext)
  const low = name.toLowerCase()
  if (!low.startsWith('tags_')) return null
  return name.slice('tags_'.length) || null
}

/** Igual a tag-from-names.py `_safe_label_for_filename` — nomes de ficheiro sem caracteres reservados. */
function safeLabelForFilename(s: string): string {
  const bad = '<>:"/\\|?*'
  let out = ''
  for (const c of s.trim()) {
    out += bad.includes(c) ? '_' : c
  }
  return out.trim() || 'Tags_Automaticas'
}

function sessionIndexForLabel(labels: string[], labelFromFile: string): number {
  const want = labelFromFile.trim().toLowerCase()
  const wantSafe = safeLabelForFilename(labelFromFile).toLowerCase()
  return labels.findIndex((l) => {
    const t = l.trim().toLowerCase()
    if (t === want) return true
    return safeLabelForFilename(l).toLowerCase() === wantSafe
  })
}

/** Campos separados por | (fora de aspas). "" dentro de campo = aspas literais. */
function splitPipeFields(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
        continue
      }
      inQ = !inQ
      continue
    }
    if (!inQ && c === '|') {
      fields.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  fields.push(cur.trim())
  return fields.map((f) => {
    let s = f.trim()
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"')
    return s.trim()
  })
}

function parseTagLines(body: string): { file: string; tags: string[] }[] {
  const raw = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body
  const out: { file: string; tags: string[] }[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const parts = splitPipeFields(t)
    if (parts.length < 2) continue
    const file = parts[0] ?? ''
    if (!file) continue
    const fileLow = file.toLowerCase()
    if (fileLow === 'arquivo' || fileLow === 'filename' || fileLow === 'file') continue
    if (fileLow === 'tags') continue
    const tagsBlob =
      parts.length === 2 ? parts[1] ?? '' : parts.slice(1).join('|').trim()
    const tags = tagsBlob
      .split(';')
      .map((x) => normalizeTagInput(x))
      .filter((x): x is string => !!x)
    if (!tags.length) continue
    out.push({ file, tags: [...new Set(tags)] })
  }
  return out
}

function main() {
  loadDotenv()
  const { dryRun, dir } = parseArgs(process.argv.slice(2))

  if (!existsSync(dir)) {
    console.error('Pasta inexistente:', dir)
    process.exit(1)
  }

  const menuRows = getVideoMenuRowsForCli()
  if (!menuRows.length) {
    console.error(
      'Sem bibliotecas: preenche data/video-menu.json (items) ou define VIDEO_ROOT / VIDEO_ROOTS no .env.',
    )
    process.exit(1)
  }

  const roots = menuRows.map((r) => r.path.trim())
  const labels = menuRows.map((r) => r.title.trim())
  const files = readdirSync(dir).filter((f) => {
    const ext = extname(f).toLowerCase()
    if (ext !== '.csv' && ext !== '.txt') return false
    return basename(f, ext).toLowerCase().startsWith('tags_')
  })

  if (!files.length) {
    console.log('Nenhum ficheiro tags_* em', dir)
    return
  }

  let totalAdds = 0
  let totalLines = 0
  let totalSkipped = 0

  for (const fn of files.sort()) {
    const label = labelFromTagsFilename(fn)
    if (!label) continue
    const session = sessionIndexForLabel(labels, label)
    if (session < 0) {
      console.warn(`[ignorar] "${fn}": rotulo "${label}" nao corresponde a nenhuma sessao. Sessoes: ${labels.join(' | ')}`)
      continue
    }

    const root = roots[session]!.trim()
    const path = join(dir, fn)
    const body = readFileSync(path, 'utf-8')
    const rows = parseTagLines(body)
    console.log(`\n[${fn}] sessao ${session} (${label}) -> ${root}`)
    console.log(`  ${rows.length} linha(s) com tags`)

    for (const { file, tags } of rows) {
      const trailerRel = resolveTrailerRel(root, file)
      if (!trailerRel) {
        console.warn(`  [skip] sem trailer para: ${root}\\${file}`)
        totalSkipped++
        continue
      }
      totalLines++
      for (const tag of tags) {
        if (dryRun) {
          console.log(`  [dry-run] ${trailerRel} + ${tag}`)
        } else {
          addTagToVideo(session, trailerRel, tag)
        }
        totalAdds++
      }
    }
  }

  if (dryRun) {
    console.log(`\nResumo dry-run: ${totalAdds} insercoes em falta (${totalLines} linhas ok, ${totalSkipped} skips).`)
  } else {
    console.log(`\nResumo: ${totalAdds} operacoes addTag (${totalLines} ficheiros, ${totalSkipped} skips).`)
  }
}

try {
  main()
} catch (e) {
  console.error(e)
  process.exit(1)
}
