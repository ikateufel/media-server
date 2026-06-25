import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SHRINK_MULTIPASS_LIST_FILE, SHRINK_REPROCESS_LIST_FILE } from './shrinkReprocessList'

export type ShrinkMultipassPhase = 2 | 3

function looksLikeWindowsRoot(line: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(line.trim())
}

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

function parseMultipassLine(raw: string): { phase: ShrinkMultipassPhase | null; name: string } {
  const t = raw.trim()
  const m = t.match(/^([23])\|(.+)$/)
  if (m) return { phase: Number(m[1]) as ShrinkMultipassPhase, name: m[2]!.trim() }
  return { phase: null, name: t }
}

async function readLines(filePath: string): Promise<string[]> {
  try {
    return (await readFile(filePath, 'utf8')).split(/\r?\n/)
  } catch {
    return []
  }
}

async function ensureMultipassHeader(filePath: string, sourceRoot: string): Promise<string[]> {
  const root = resolve(sourceRoot)
  const lines = await readLines(filePath)
  if (!lines.length || !lines.some((l) => l.trim() && !l.startsWith('#'))) {
    return [root, '# 2| segunda passagem  |  3| Priorizar tamanho', '']
  }
  const firstContent = lines.find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? ''
  if (!looksLikeWindowsRoot(firstContent)) {
    return [root, '# 2| segunda passagem  |  3| Priorizar tamanho', ...lines]
  }
  return lines
}

async function upsertMultipassEntry(
  filePath: string,
  sourceRoot: string,
  fileRel: string,
  phase: ShrinkMultipassPhase,
): Promise<void> {
  const rel = fileRel.replace(/\\/g, '/').trim()
  const key = rel.toLowerCase()
  const entry = `${phase}|${rel}`
  let lines = await ensureMultipassHeader(filePath, sourceRoot)

  let found = false
  lines = lines.map((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return line
    const parsed = parseMultipassLine(t)
    if (parsed.name.toLowerCase() !== key) return line
    found = true
    if ((parsed.phase ?? 2) >= phase) return line
    return entry
  })

  if (!found) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('')
    lines.push(entry)
  }

  await writeFile(filePath, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8')
}

async function appendUniquePlainLine(
  filePath: string,
  sourceRoot: string,
  fileRel: string,
): Promise<void> {
  const rel = fileRel.replace(/\\/g, '/').trim()
  const key = rel.toLowerCase()
  let lines = await readLines(filePath)
  if (!lines.length || !lines.some((l) => l.trim() && !l.startsWith('#'))) {
    lines = [resolve(sourceRoot), '']
  }
  const exists = lines.some((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return false
    return parseMultipassLine(t).name.toLowerCase() === key
  })
  if (exists) return
  if (lines.length && lines[lines.length - 1] !== '') lines.push('')
  lines.push(rel)
  await writeFile(filePath, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8')
}

async function appendDetailLine(
  filePath: string,
  opts: {
    phase: ShrinkMultipassPhase
    pctOfOrig: number
    sourceBytes: number
    outputBytes: number
    fileRel: string
  },
): Promise<void> {
  const header = 'fase\tpct_origem\tmotivo\torigem\tsaida\tnome'
  let lines = await readLines(filePath)
  if (!lines.length) {
    lines = [header]
  } else if (!lines[0]?.startsWith('fase\t')) {
    lines = [header, ...lines]
  }
  const reason = opts.phase === 3 ? 'maior que origem' : 'reducao insuficiente'
  const row = [
    String(opts.phase),
    String(opts.pctOfOrig),
    reason,
    formatBytes(opts.sourceBytes),
    formatBytes(opts.outputBytes),
    opts.fileRel.replace(/\\/g, '/'),
  ].join('\t')
  lines.push(row)
  await writeFile(filePath, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8')
}

/** Regista ficheiro descartado na 1.ª passagem para fila multipass (Carregar lista). */
export async function logShrinkMultipassEntry(opts: {
  projectRoot: string
  sourceRoot: string
  fileRel: string
  phase: ShrinkMultipassPhase
  sourceBytes?: number
  outputBytes?: number
  pctOfOrig?: number
}): Promise<void> {
  const dataDir = join(opts.projectRoot, 'data')
  await mkdir(dataDir, { recursive: true })

  const rel = opts.fileRel.replace(/\\/g, '/')
  const sourceRoot = resolve(opts.sourceRoot)
  const multipassPath = join(opts.projectRoot, SHRINK_MULTIPASS_LIST_FILE)
  const reprocessPath = join(opts.projectRoot, SHRINK_REPROCESS_LIST_FILE)
  const detailPath = join(dataDir, 'shrink-multipass-detail.txt')

  await upsertMultipassEntry(multipassPath, sourceRoot, rel, opts.phase)
  await appendUniquePlainLine(reprocessPath, sourceRoot, rel)

  const orig = opts.sourceBytes ?? 0
  const out = opts.outputBytes ?? 0
  const pct =
    opts.pctOfOrig ??
    (orig > 0 ? Math.round((out * 100) / orig) : 0)
  if (orig > 0 && out > 0) {
    await appendDetailLine(detailPath, {
      phase: opts.phase,
      pctOfOrig: pct,
      sourceBytes: orig,
      outputBytes: out,
      fileRel: rel,
    })
  }
}
