#!/usr/bin/env node
// ============================================================================
// shrink-downloaded.mjs — encolhe IN-PLACE (sem backup) uma pasta de downloads.
//
// Como funciona:
//   1. Percorre a pasta recursivamente (subpastas incluídas), ignorando
//      shrinked/, shrinked_backup/ e pastas ocultas.
//   2. Só considera vídeos com tamanho >= --min-size (por omissão 1 GiB).
//   3. Ignora os que já estão marcados como shrinkados:
//      - histórico do servidor (data/process-job-history.json, session + caminho
//        relativo) — a mesma marca usada pelo menu e pela pipeline «novos»;
//      - registo local (data/shrink-downloaded-shrunk.json), que não é podado
//        como o histórico do servidor;
//      - BD do menu (data/library-tags.sqlite): linhas shrinked_backup/..._bak
//        em main_file_meta e tags shrinked / shrinked_backup;
//      - metadados vp_shrink_speed no próprio ficheiro (o shrink_video.bat
//        escreve-os; o encoder usa use_metadata_tags para ficarem no MP4).
//   4. Chama scripts/shrink_video.bat em modo "servidor"
//      (VP_SHRINK_FROM_SERVER=1): sem copia para shrinked_backup\ e sem
//      registos de fase em data\.
//   5. Substitui o original pelo MP4 encolhido — o mesmo comportamento do
//      shrink in-place do servidor: move a saida de shrinked\<nome>.mp4 para
//      <nome>.mp4 ao lado do original, apaga o original e remove a pasta
//      shrinked\ se ficar vazia.
//   6. Regista cada shrink no histórico do servidor e no registo local, para o
//      menu saber que já foi shrinkado e para nunca voltar a processá-lo.
//
// Uso:
//   node scripts/shrink-downloaded.mjs
//   node scripts/shrink-downloaded.mjs "H:\temp\note_h\downloaded"
//   node scripts/shrink-downloaded.mjs --dry-run --verbose
//   node scripts/shrink-downloaded.mjs --min-size 1GB --yes
//   node scripts/shrink-downloaded.mjs --height 1080 --speed 1.5 --codec auto
//
// Opções:
//   --root <pasta>        pasta a varrer (por omissão H:\temp\note_h\downloaded)
//   --min-size <tam>      tamanho minimo, ex.: 1GB, 1GiB, 500MB (por omissão 1GiB)
//   --height <px>         altura alvo (144-4320, por omissão 1080)
//   --speed <x>           velocidade 1.25, 1.5 ou 2 (por omissão 1.5)
//   --codec <nome>        auto | h264_nvenc | libx264 | hevc_nvenc | libx265
//   --prioritize-size     2a passagem de qualidade do shrink_video.bat (mais lenta)
//   --max-out-pct <n>     aceita a saida so ate n% do original (0 = sem limite;
//                         por omissão 100 = qualquer ficheiro mais pequeno)
//   --no-history          pasta fora das bibliotecas: marca so nos metadados
//   --dry-run             so lista o que faria; nao toca em nada
//   --yes, -y             nao pede confirmacao
//   --verbose             lista tambem os ficheiros ja shrinkados
//   --help, -h            mostra esta ajuda
//
// A pasta tem de estar dentro de uma biblioteca do menu
// (data/library-tags.sqlite), como no shrink-folder.mjs; caso contrário use
// --no-history.
//
// Log: <pasta>\shrink-downloaded.log (uma linha por ficheiro, em --dry-run
// nao escreve nada).
// ============================================================================

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  appendFile,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const REPO_ROOT = resolve(import.meta.dirname, '..')
const BAT_PATH = join(REPO_ROOT, 'scripts', 'shrink_video.bat')
const LIBRARY_DB = join(REPO_ROOT, 'data', 'library-tags.sqlite')
const HISTORY_PATH = join(REPO_ROOT, 'data', 'process-job-history.json')
const HISTORY_MAX = 500
// Registo local, sem limite pratico e sem logs: garante que um shrink feito por
// este script nunca e repetido, mesmo que o historico do servidor seja podado
// (HISTORY_MAX) ou apagado.
const LEDGER_PATH = join(REPO_ROOT, 'data', 'shrink-downloaded-shrunk.json')
const LEDGER_MAX = 10000
const DEFAULT_ROOT = 'H:\\temp\\note_h\\downloaded'
const GIB = 1024 ** 3
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|m4v|webm|ts|m2ts|mpg|mpeg|flv|3gp)$/i
const SKIP_DIRS = new Set([
  'shrinked',
  'shrinked_backup',
  '.thumb_cache',
  '$recycle.bin',
  'system volume information',
])
const SPEEDS = [1.25, 1.5, 2]
const CODECS = ['auto', 'h264_nvenc', 'libx264', 'hevc_nvenc', 'libx265']
const LOG_HEADER = '# data\tresultado\tficheiro\tdestino\tantes_bytes\tdepois_bytes\tpercentagem'

function fail(message) {
  console.error(`\n[ERRO] ${message}`)
  process.exit(1)
}

function parseSize(raw) {
  const match = String(raw).trim().match(/^(\d+(?:[.,]\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/i)
  if (!match) fail(`tamanho invalido: ${raw} (ex.: 1GB, 1GiB, 500MB)`)
  const n = Number(match[1].replace(',', '.'))
  const unit = (match[2] || 'gb').toLowerCase()
  const multipliers = {
    b: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000 ** 2,
    mib: 1024 ** 2,
    gb: 1000 ** 3,
    gib: 1024 ** 3,
  }
  return Math.round(n * multipliers[unit])
}

function parseIntStrict(raw, name) {
  if (!/^\d+$/.test(String(raw).trim())) fail(`${name} espera um numero inteiro, recebeu: ${raw}`)
  return Number(raw)
}

function fmtSize(bytes) {
  if (bytes <= 0) return '0 KB'
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function videoOutPath(file) {
  return join(dirname(file), 'shrinked', `${basename(file, extname(file))}.mp4`)
}

function finalPath(file) {
  return join(dirname(file), `${basename(file, extname(file))}.mp4`)
}

function normRel(rel) {
  return String(rel ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .toLowerCase()
}

function toPosixRel(absUnderRoot, root) {
  return relative(resolve(root), resolve(absUnderRoot)).split(sep).join('/')
}

function printHelp() {
  console.log(
    [
      '',
      'shrink-downloaded.mjs — encolhe in-place (sem backup) os videos de uma pasta.',
      '',
      '  node scripts/shrink-downloaded.mjs [pasta] [opcoes]',
      '',
      'Por omissao: pasta H:\\temp\\note_h\\downloaded, videos >= 1 GiB, 1080p, 1.5x,',
      'codec auto, e pede confirmacao antes de substituir.',
      '',
      '  --dry-run             so lista os candidatos',
      '  --yes, -y             nao pede confirmacao',
      '  --verbose             mostra tambem os ja shrinkados',
      '  --min-size 1GB        tamanho minimo (GB/GiB/MB/MiB)',
      '  --height 1080         altura alvo (144-4320)',
      '  --speed 1.5           velocidade (1.25, 1.5, 2)',
      '  --codec auto          auto | h264_nvenc | libx264 | hevc_nvenc | libx265',
      '  --prioritize-size     2a passagem de qualidade se a saida passar 70%',
      '  --max-out-pct 100     aceita saida ate n% do original (0 = sem limite)',
      '  --no-history          pasta fora das bibliotecas: marca so nos metadados',
      '',
      'A pasta tem de estar dentro de uma biblioteca do menu (data/library-tags.sqlite).',
      'Os ficheiros ja shrinkados (historico do servidor, BD do menu via',
      'shrinked_backup, registo local ou metadados vp_shrink_speed) sao ignorados.',
      'O original e substituido pelo MP4 encolhido, sem copia de backup, e o shrink',
      'fica registado no historico e no registo local',
      '',
      'Nao correr ao mesmo tempo que um shrink/trailer do servidor (o historico e reescrito).',
      '',
    ].join('\n'),
  )
}

function parseArgs(argv) {
  const cfg = {
    root: DEFAULT_ROOT,
    minBytes: GIB,
    height: 1080,
    speed: 1.5,
    codec: 'auto',
    prioritizeSize: false,
    maxOutPct: 100,
    noHistory: false,
    dryRun: false,
    yes: false,
    verbose: false,
    help: false,
  }
  const positionals = []
  let rootFlag = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      cfg.help = true
      continue
    }
    if (arg === '-y' || arg === '--yes') {
      cfg.yes = true
      continue
    }
    if (arg === '--dry-run') {
      cfg.dryRun = true
      continue
    }
    if (arg === '--verbose') {
      cfg.verbose = true
      continue
    }
    if (arg === '--no-prioritize-size') {
      cfg.prioritizeSize = false
      continue
    }
    if (arg === '--prioritize-size') {
      cfg.prioritizeSize = true
      continue
    }
    if (arg === '--no-history') {
      cfg.noHistory = true
      continue
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)
    let value = eq === -1 ? undefined : arg.slice(eq + 1)
    const take = () => {
      if (value !== undefined) return value
      value = argv[++i]
      if (value === undefined) fail(`${name} precisa de um valor`)
      return value
    }
    switch (name) {
      case '--root':
        rootFlag = take()
        break
      case '--min-size':
        cfg.minBytes = parseSize(take())
        break
      case '--height':
        cfg.height = parseIntStrict(take(), '--height')
        break
      case '--speed':
        cfg.speed = Number(take())
        break
      case '--codec':
        cfg.codec = take().toLowerCase()
        break
      case '--max-out-pct':
        cfg.maxOutPct = parseIntStrict(take(), '--max-out-pct')
        break
      default:
        fail(`opcao desconhecida: ${arg} (ver --help)`)
    }
  }
  if (positionals.length > 1) fail('Indique apenas uma pasta.')
  if (positionals.length === 1 && rootFlag !== null) {
    fail('Use --root ou a pasta posicional, nao ambos.')
  }
  cfg.root = rootFlag ?? positionals[0] ?? DEFAULT_ROOT

  if (!Number.isInteger(cfg.height) || cfg.height < 144 || cfg.height > 4320) {
    fail(`altura invalida: ${cfg.height} (144-4320)`)
  }
  if (!SPEEDS.includes(cfg.speed)) fail(`velocidade invalida: ${cfg.speed} (1.25, 1.5 ou 2)`)
  if (!CODECS.includes(cfg.codec)) fail(`codec invalido: ${cfg.codec} (${CODECS.join(', ')})`)
  if (!Number.isInteger(cfg.maxOutPct) || cfg.maxOutPct < 0 || cfg.maxOutPct > 100) {
    fail('--max-out-pct tem de estar entre 0 e 100')
  }
  if (cfg.minBytes <= 0) fail('--min-size tem de ser maior que zero')
  return cfg
}

function resolveFfprobe() {
  const candidates = []
  if (process.env.FFMPEG_DIR) candidates.push(join(process.env.FFMPEG_DIR, 'ffprobe.exe'))
  candidates.push('C:\\ffmpeg\\bin\\ffprobe.exe')
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (base) candidates.push(join(base, 'ffmpeg', 'bin', 'ffprobe.exe'))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'ffprobe.exe' // deixa o Windows resolver pelo PATH
}

const FFPROBE = resolveFfprobe()

async function ensureFfprobe() {
  try {
    await execFileAsync(FFPROBE, ['-version'], { windowsHide: true, maxBuffer: 1024 * 1024 })
  } catch (error) {
    fail(
      `ffprobe nao encontrado (${FFPROBE}). Instale o FFmpeg, adicione ao PATH ou defina FFMPEG_DIR. (${error.code ?? error.message})`,
    )
  }
}

async function probeTags(file) {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE,
      ['-v', 'error', '-print_format', 'json', '-show_entries', 'format_tags', file],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    )
    const parsed = JSON.parse(stdout || '{}')
    const tags = parsed?.format?.tags
    return tags && typeof tags === 'object' ? tags : {}
  } catch {
    return null
  }
}

function isMarked(tags) {
  const lower = {}
  for (const [key, value] of Object.entries(tags)) lower[key.toLowerCase()] = String(value ?? '').trim()
  const flag = (lower.vp_shrink || '').toLowerCase()
  return Boolean(lower.vp_shrink_speed) || flag === '1' || flag === 'true' || flag === 'yes'
}

/** Biblioteca do menu que contém a pasta (a mais profunda, como no shrink-folder.mjs). */
function findLibrary(rootAbs) {
  if (!existsSync(LIBRARY_DB)) return null
  const db = new DatabaseSync(LIBRARY_DB, { readOnly: true })
  const matches = []
  try {
    const rows = db.prepare('SELECT sort_order, title, path FROM video_menu_items ORDER BY sort_order').all()
    const target = resolve(rootAbs).toLowerCase()
    for (const row of rows) {
      const rawPath = String(row.path ?? '').trim()
      if (!rawPath) continue
      const libRoot = resolve(rawPath)
      const lower = libRoot.toLowerCase()
      if (target === lower || target.startsWith(lower + sep)) {
        matches.push({ session: Number(row.sort_order), title: String(row.title ?? ''), root: libRoot })
      }
    }
  } finally {
    db.close()
  }
  matches.sort((a, b) => b.root.length - a.root.length)
  return matches[0] ?? null
}

/** Conjunto de shrinks concluídos, como findSuccessfulShrinkHistory (session + caminho relativo). */
async function loadHistory() {
  let raw
  try {
    raw = await readFile(HISTORY_PATH, 'utf8')
  } catch {
    return { items: [], shrunk: new Set() }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    fail(`historico ilegivel (${HISTORY_PATH}): ${error.message}`)
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : []
  const shrunk = new Set()
  for (const entry of items) {
    if (!entry || entry.kind !== 'shrink' || entry.status !== 'done') continue
    const session = Number(entry.session)
    if (!Number.isFinite(session) || session < 0) continue
    const rel = normRel(entry.mainRel)
    if (rel) shrunk.add(`${Math.floor(session)}|${rel}`)
  }
  return { items, shrunk }
}

async function addHistoryEntry(entry) {
  let items = []
  try {
    const raw = await readFile(HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    items = Array.isArray(parsed?.items) ? parsed.items : []
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const key = normRel(entry.mainRel)
  const already = items.some(
    (e) =>
      e &&
      e.kind === 'shrink' &&
      e.status === 'done' &&
      Number(e.session) === entry.session &&
      normRel(e.mainRel) === key,
  )
  if (already) return
  const next = [entry, ...items]
    .sort((a, b) => (Number(b?.endedAt) || 0) - (Number(a?.endedAt) || 0))
    .slice(0, HISTORY_MAX)
  const tmp = `${HISTORY_PATH}.tmp`
  await writeFile(tmp, JSON.stringify({ items: next }, null, 2), 'utf8')
  await rename(tmp, HISTORY_PATH)
}

/** Registo local de shrinks (session + caminho relativo), independente do limite do historico. */
async function loadLedger() {
  let raw
  try {
    raw = await readFile(LEDGER_PATH, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { items: [], keys: new Set(), dirty: false }
    fail(`registo local ilegivel (${LEDGER_PATH}): ${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    fail(`registo local ilegivel (${LEDGER_PATH}): ${error.message}`)
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : []
  const keys = new Set()
  for (const entry of items) {
    const session = Number(entry?.session)
    if (!Number.isFinite(session) || session < 0) continue
    const rel = normRel(entry.mainRel)
    if (rel) keys.add(`${Math.floor(session)}|${rel}`)
  }
  return { items, keys, dirty: false }
}

function rememberShrunk(ledger, session, mainRel, endedAt) {
  const rel = normRel(mainRel)
  if (!rel) return false
  const key = `${session}|${rel}`
  if (ledger.keys.has(key)) return false
  ledger.keys.add(key)
  ledger.items.push({
    session: Math.floor(session),
    mainRel,
    endedAt: Number(endedAt) || 0,
  })
  ledger.dirty = true
  return true
}

async function saveLedger(ledger) {
  if (!ledger.dirty) return
  const items = ledger.items
    .filter((entry) => entry && normRel(entry.mainRel))
    .sort((a, b) => (Number(b.endedAt) || 0) - (Number(a.endedAt) || 0))
    .slice(0, LEDGER_MAX)
  const tmp = `${LEDGER_PATH}.tmp`
  await writeFile(tmp, JSON.stringify({ items }, null, 2), 'utf8')
  await rename(tmp, LEDGER_PATH)
  ledger.items = items
  ledger.dirty = false
}

/**
 * Marcas historicas na BD do menu (`data/library-tags.sqlite`):
 *  - `main_file_meta` guarda as linhas `shrinked_backup/<...>_bak.<ext>` mesmo
 *    depois de a pasta de backup ser apagada — e o registo de que o ficheiro
 *    foi shrinkado (o backup era criado antes de substituir o original);
 *  - as tags `shrinked` / `shrinked_backup` em `video_tags`.
 * Devolve chaves `<pasta relativa>|<stem>` em minusculas.
 */
function loadDbShrunk(session) {
  const keys = new Set()
  if (!existsSync(LIBRARY_DB)) return keys
  const db = new DatabaseSync(LIBRARY_DB, { readOnly: true })
  try {
    const backupRows = db
      .prepare(
        `SELECT main_rel FROM main_file_meta
         WHERE session = ?
           AND (main_rel LIKE 'shrinked_backup/%' OR main_rel LIKE '%/shrinked_backup/%')`,
      )
      .all(session)
    for (const row of backupRows) {
      const rel = String(row.main_rel ?? '').replace(/\\/g, '/')
      const lower = rel.toLowerCase()
      const idx = lower.lastIndexOf('/shrinked_backup/')
      if (idx < 0 && !lower.startsWith('shrinked_backup/')) continue
      const dir = idx < 0 ? '' : rel.slice(0, idx)
      const name = rel.slice(rel.lastIndexOf('/') + 1)
      const match = name.match(/^(.*)_bak(?:_[^/]*)?\.[^.]+$/)
      if (!match) continue
      keys.add(`${dir.toLowerCase()}|${match[1].toLowerCase()}`)
    }

    const tagRows = db
      .prepare(
        `SELECT vt.trailer_rel FROM video_tags vt
         JOIN tags t ON t.id = vt.tag_id
         WHERE vt.session = ? AND lower(t.name) IN ('shrinked', 'shrinked_backup')`,
      )
      .all(session)
    for (const row of tagRows) {
      let rel = String(row.trailer_rel ?? '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
      if (rel.toLowerCase().startsWith('trailers/')) rel = rel.slice('trailers/'.length)
      const isBackup = rel.toLowerCase().startsWith('shrinked_backup/')
      if (isBackup) rel = rel.slice('shrinked_backup/'.length)
      const dir = isBackup || !rel.includes('/') ? '' : rel.slice(0, rel.lastIndexOf('/'))
      const name = rel.slice(rel.lastIndexOf('/') + 1)
      const stem = name
        .replace(/_bak(?:_[^/]*)?(\.[^.]+)$/i, '$1')
        .replace(/\.[^.]+$/, '')
      if (!stem) continue
      keys.add(`${dir.toLowerCase()}|${stem.toLowerCase()}`)
    }
  } catch (error) {
    fail(`nao foi possivel ler a BD do menu (${LIBRARY_DB}): ${error.message}`)
  } finally {
    db.close()
  }
  return keys
}

async function walk(dir, out) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    console.log(`[AVISO] nao foi possivel ler ${dir}: ${error.message}`)
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name.toLowerCase())) continue
      await walk(full, out)
    } else if (entry.isFile() && VIDEO_EXT.test(entry.name)) {
      out.push(full)
    }
  }
}

function runShrinkBat(file, cfg) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', BAT_PATH], {
      cwd: dirname(file),
      env: {
        ...process.env,
        VIDEO_PLAYER_ROOT: REPO_ROOT,
        VP_SHRINK_INPUT: file,
        VP_SHRINK_HEIGHT: String(cfg.height),
        VP_SHRINK_SPEED: String(cfg.speed),
        VP_SHRINK_CODEC: cfg.codec,
        VP_SHRINK_FORCE: '1',
        VP_SHRINK_PRIORITIZE_SIZE: cfg.prioritizeSize ? '1' : '0',
        // Sem backup (shrinked_backup\) e sem logs de fase em data\.
        VP_SHRINK_FROM_SERVER: '1',
        USE_NVENC: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.on('error', reject)
    child.on('close', (code) => resolvePromise(code ?? 1))
  })
}

// Mesma substituicao do shrinkInPlaceJobs.ts: move a saida para <nome>.mp4 ao
// lado do original, apaga o original e limpa a pasta shrinked\ se ficar vazia.
async function replaceOriginal(file, out) {
  const dest = finalPath(file)
  if (dest.toLowerCase() === file.toLowerCase()) {
    const tmp = `${dest}.vp-shrink-tmp`
    await rm(tmp, { force: true }).catch(() => {})
    await rename(file, tmp)
    try {
      await rename(out, dest)
    } catch (error) {
      await rename(tmp, file).catch(() => {})
      throw error
    }
    await rm(tmp, { force: true }).catch(() => {})
  } else {
    await rename(out, dest)
    try {
      await unlink(file)
    } catch (error) {
      console.log(
        `[AVISO] MP4 criado, mas o original nao pode ser apagado (${error.message}): ${file}`,
      )
    }
  }
  await rmdir(dirname(out)).catch(() => {}) // so remove se estiver vazia
  return dest
}

async function appendLog(path, fields) {
  try {
    if (!existsSync(path)) await appendFile(path, LOG_HEADER + '\r\n', 'utf8')
    await appendFile(path, fields.join('\t') + '\r\n', 'utf8')
  } catch (error) {
    console.log(`[AVISO] nao foi possivel escrever o log ${path}: ${error.message}`)
  }
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2))
  if (cfg.help) {
    printHelp()
    return
  }
  if (process.platform !== 'win32') fail('Este script so funciona em Windows.')
  if (!existsSync(BAT_PATH)) fail(`script em falta: ${BAT_PATH}`)
  const root = resolve(cfg.root)
  if (!existsSync(root)) fail(`pasta nao encontrada: ${root}`)
  if (SKIP_DIRS.has(basename(root).toLowerCase())) {
    fail(`essa e uma pasta de saida/backup (${basename(root)}); indique a pasta dos originais.`)
  }

  const lib = findLibrary(root)
  if (!lib && !cfg.noHistory) {
    if (!existsSync(LIBRARY_DB)) {
      fail(
        `base de dados em falta: ${LIBRARY_DB}\n       Use --no-history para marcar so pelos metadados.`,
      )
    }
    fail(
      `Pasta fora de qualquer biblioteca do menu: ${root}\n       Use --no-history para marcar so pelos metadados.`,
    )
  }
  // Numa biblioteca o historico e SEMPRE verificado (mesmo com --no-history);
  // o flag so permite trabalhar fora de bibliotecas, onde so ha metadados.
  const history = lib ? await loadHistory() : { items: [], shrunk: new Set() }
  const ledger = lib ? await loadLedger() : null
  const dbShrunk = lib ? loadDbShrunk(lib.session) : new Set()
  await ensureFfprobe()

  console.log('====================================================')
  console.log('  SHRINK-DOWNLOADED — in-place, sem backup')
  console.log(`  Pasta:   ${root}`)
  if (lib) {
    console.log(`  Biblioteca: ${lib.title} (session ${lib.session}) — ${lib.root}`)
    console.log(
      '  Marcador: historico do servidor + BD (shrinked_backup) + registo local + metadados vp_shrink_speed',
    )
  } else {
    console.log('  Marcador: apenas metadados vp_shrink_speed (pasta fora de bibliotecas)')
  }
  console.log(`  Filtro:  videos >= ${fmtSize(cfg.minBytes)}; ja shrinkados ignorados`)
  console.log(
    `  Encode:  ${cfg.height}px, ${cfg.speed}x, ${cfg.codec}` +
      `${cfg.prioritizeSize ? ', priorizar tamanho' : ''}` +
      `${cfg.dryRun ? '  [DRY-RUN]' : ''}`,
  )
  console.log('====================================================')

  const allVideos = []
  await walk(root, allVideos)
  console.log(`\n${allVideos.length} video(s) encontrados; a ler tamanhos e metadados...`)

  const candidates = []
  let markedHistory = 0
  let markedDb = 0
  let markedTag = 0
  let ledgerAdded = 0
  let small = 0
  let unreadable = 0
  let conflicts = 0
  let markedBytes = 0

  for (const file of allVideos) {
    let info
    try {
      info = await stat(file)
    } catch {
      unreadable++
      continue
    }
    if (info.size < cfg.minBytes) {
      small++
      continue
    }
    const mainRel = lib ? toPosixRel(file, lib.root) : null
    const markerKey = lib && mainRel ? `${lib.session}|${normRel(mainRel)}` : null
    const relDir = mainRel && mainRel.includes('/') ? mainRel.slice(0, mainRel.lastIndexOf('/')) : ''
    const stem = mainRel ? basename(mainRel, extname(mainRel)) : ''
    const dbKey = lib && mainRel ? `${relDir.toLowerCase()}|${stem.toLowerCase()}` : null

    if (lib && dbKey && dbShrunk.has(dbKey)) {
      markedDb++
      markedBytes += info.size
      if (rememberShrunk(ledger, lib.session, mainRel, 0)) ledgerAdded++
      if (cfg.verbose) console.log(`[SKIP] ja shrinkado (BD/backup, ${fmtSize(info.size)}): ${file}`)
      continue
    }
    if (lib && (history.shrunk.has(markerKey) || ledger.keys.has(markerKey))) {
      markedHistory++
      markedBytes += info.size
      if (rememberShrunk(ledger, lib.session, mainRel, 0)) ledgerAdded++
      if (cfg.verbose) console.log(`[SKIP] ja shrinkado (historico/registo, ${fmtSize(info.size)}): ${file}`)
      continue
    }
    const tags = await probeTags(file)
    if (tags === null) {
      unreadable++
      console.log(`[AVISO] metadados ilegiveis, ignorado: ${file}`)
      continue
    }
    if (isMarked(tags)) {
      markedTag++
      markedBytes += info.size
      if (lib && rememberShrunk(ledger, lib.session, mainRel, 0)) ledgerAdded++
      if (cfg.verbose) console.log(`[SKIP] ja shrinkado (metadados, ${fmtSize(info.size)}): ${file}`)
      continue
    }
    const dest = finalPath(file)
    if (dest.toLowerCase() !== file.toLowerCase() && existsSync(dest)) {
      conflicts++
      console.log(`[AVISO] destino ja existe, ignorado: ${file}  ->  ${dest}`)
      continue
    }
    candidates.push({ file, size: info.size, dest, mainRel })
  }

  candidates.sort((a, b) => b.size - a.size)
  const totalBytes = candidates.reduce((sum, item) => sum + item.size, 0)

  console.log(
    `\nResumo da analise: ${candidates.length} a processar` +
      ` · ${small} abaixo do minimo` +
      (conflicts ? ` · ${conflicts} com destino ocupado` : '') +
      (unreadable ? ` · ${unreadable} ilegiveis` : ''),
  )
  console.log(
    `  ja shrinkados: ${markedHistory} pelo historico/registo + ${markedDb} pela BD (backup)` +
      ` + ${markedTag} pelos metadados (${fmtSize(markedBytes)} nao serao tocados)`,
  )

  // Guarda no registo local os marcadores que so existiam no historico do
  // servidor, para nao depender do limite de 500 entradas desse ficheiro.
  if (lib && ledger.dirty && !cfg.dryRun) {
    try {
      await saveLedger(ledger)
      if (ledgerAdded > 0) {
        console.log(`[REGISTO] +${ledgerAdded} marcador(es) local(is); total ${ledger.items.length}.`)
      }
    } catch (error) {
      console.log(`[AVISO] nao foi possivel guardar o registo local: ${error.message}`)
    }
  }

  if (candidates.length === 0) {
    console.log('\nNada a fazer.')
    return
  }

  if (cfg.verbose || cfg.dryRun) {
    console.log('')
    for (const item of candidates) {
      console.log(`  ${fmtSize(item.size).padStart(9)}  ${item.file}`)
    }
  }
  console.log(`\nTotal a processar: ${fmtSize(totalBytes)}`)

  if (cfg.dryRun) {
    console.log('\n[DRY-RUN] Nada foi alterado.')
    return
  }

  if (!cfg.yes) {
    if (!process.stdin.isTTY) fail('Sem terminal interativo para confirmar. Use --yes.')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = (await rl.question('\nContinuar e substituir os originais (sem backup)? [s/N] '))
      .trim()
      .toLowerCase()
    rl.close()
    if (!['s', 'sim', 'y', 'yes'].includes(answer)) {
      console.log('Cancelado — nada foi alterado.')
      return
    }
  }

  const logPath = join(root, 'shrink-downloaded.log')
  console.log('')

  let ok = 0
  let insufficient = 0
  let failed = 0
  let noOutput = 0
  let skippedNow = 0
  let savedBytes = 0
  let index = 0

  for (const item of candidates) {
    index++
    const { file, size: before } = item
    const out = videoOutPath(file)
    console.log(`\n[${index}/${candidates.length}] ${file}`)
    console.log(`        ${fmtSize(before)} -> ${item.dest}`)
    const startedAt = Date.now()
    const startedIso = new Date(startedAt).toISOString()

    // Re-verificacao imediata antes de encodar: se o ficheiro foi marcado
    // entretanto (ex.: shrink pelo servidor durante esta execucao), nao repete.
    const recheck = await probeTags(file)
    if (recheck === null) {
      failed++
      console.log('[AVISO] metadados ilegiveis antes do encode — ignorado.')
      await appendLog(logPath, [startedIso, 'erro_metadados', file, item.dest, before, '', ''])
      continue
    }
    if (isMarked(recheck)) {
      skippedNow++
      console.log('[SKIP] ja shrinkado (verificado agora) — ignorado.')
      if (lib && item.mainRel) {
        if (rememberShrunk(ledger, lib.session, item.mainRel, Date.now())) {
          await saveLedger(ledger).catch(() => {})
        }
      }
      await appendLog(logPath, [startedIso, 'ja_shrinkado', file, item.dest, before, '', ''])
      continue
    }

    let code
    try {
      code = await runShrinkBat(file, cfg)
    } catch (error) {
      failed++
      console.log(`[ERRO] falha ao executar shrink_video.bat: ${error.message}`)
      await appendLog(logPath, [startedIso, 'erro_execucao', file, item.dest, before, '', ''])
      continue
    }

    if (code !== 0) {
      failed++
      console.log(`[ERRO] shrink_video.bat terminou com codigo ${code}`)
      await appendLog(logPath, [startedIso, 'erro', file, item.dest, before, '', ''])
      continue
    }

    let outSize = 0
    try {
      outSize = (await stat(out)).size
    } catch {
      outSize = 0
    }
    if (!outSize || outSize < 1024) {
      noOutput++
      console.log('[SKIP] shrink_video.bat nao criou saida (reducao insuficiente ou ja processado).')
      await appendLog(logPath, [startedIso, 'sem_saida', file, item.dest, before, '', ''])
      continue
    }

    const pct = Math.round((outSize * 100) / before)
    if (cfg.maxOutPct > 0 && outSize * 100 > before * cfg.maxOutPct) {
      insufficient++
      console.log(`[SKIP] reducao insuficiente (${pct}% do original) — original mantido.`)
      await rm(out, { force: true }).catch(() => {})
      await appendLog(logPath, [startedIso, 'reducao_insuficiente', file, item.dest, before, outSize, pct])
      continue
    }

    let dest = item.dest
    try {
      dest = await replaceOriginal(file, out)
    } catch (error) {
      failed++
      console.log(`[ERRO] falha ao substituir o original: ${error.message}`)
      console.log(`        saida preservada em: ${out}`)
      await appendLog(logPath, [startedIso, 'erro_substituir', file, item.dest, before, outSize, pct])
      continue
    }

    ok++
    savedBytes += before - outSize
    console.log(`[OK] ${fmtSize(before)} -> ${fmtSize(outSize)} (${pct}%) — ${dest}`)
    await appendLog(logPath, [startedIso, 'ok', file, dest, before, outSize, pct])

    if (lib) {
      const endedAt = Date.now()
      const newMainRel = toPosixRel(dest, lib.root)
      // Registo local primeiro: e a garantia de que nunca volta a ser shrinkado.
      rememberShrunk(ledger, lib.session, newMainRel, endedAt)
      try {
        await saveLedger(ledger)
      } catch (error) {
        console.log(`[AVISO] registo local nao atualizado: ${error.message}`)
      }
      try {
        await addHistoryEntry({
          id: `shrink-${endedAt}-${randomUUID().replace(/-/g, '').slice(0, 7)}`,
          kind: 'shrink',
          status: 'done',
          session: lib.session,
          mainRel: newMainRel,
          label: basename(newMainRel),
          startedAt,
          endedAt,
          jobId: randomUUID(),
          log: `[SHRINK-DOWNLOADED] ${file} -> ${dest} (${before} -> ${outSize} bytes)`,
        })
        console.log(`[HISTORICO] registado como shrinkado (session ${lib.session})`)
      } catch (error) {
        console.log(`[AVISO] shrink feito, mas o historico nao foi atualizado: ${error.message}`)
      }
    }

    const newTags = await probeTags(dest)
    if (newTags && !isMarked(newTags)) {
      console.log('[AVISO] ficheiro substituido mas sem marca vp_shrink_speed — pode ser reprocessado.')
    }
  }

  console.log('\n====================================================')
  console.log(
    `[FIM] ok=${ok} · reducao_insuficiente=${insufficient}` +
      ` · sem_saida=${noOutput}` +
      (skippedNow ? ` · ja_shrinkado=${skippedNow}` : '') +
      ` · falhas=${failed}`,
  )
  if (ok > 0) console.log(`[FIM] poupados ${fmtSize(savedBytes)}`)
  console.log(`Log: ${logPath}`)
  console.log('====================================================')
  if (failed > 0) process.exitCode = 1
}

await main().catch((error) => {
  console.error(`\n[FATAL] ${error?.stack ?? error}`)
  process.exit(1)
})
