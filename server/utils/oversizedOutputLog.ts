import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

export type OversizedTool = 'editor' | 'shrink'

export interface OversizedOutputEntry {
  rel: string
  sourcePath: string
  outputPath: string
  sourceBytes: number
  outputBytes: number
  loggedAt: number
}

function outputMp4Path(sourcePath: string, subdir: 'edited' | 'shrinked'): string {
  const stem = basename(sourcePath, extname(sourcePath))
  return join(dirname(sourcePath), subdir, `${stem}.mp4`)
}

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

function oversizedPct(entry: OversizedOutputEntry): string {
  if (entry.sourceBytes <= 0) return '?'
  return String(Math.round(((entry.outputBytes - entry.sourceBytes) * 100) / entry.sourceBytes))
}

/** Caminhos dos ficheiros de lista para trabalho manual. */
export function oversizedListPaths(projectRoot: string, tool: OversizedTool) {
  const logDir = join(projectRoot, 'data')
  return {
    log: join(logDir, `${tool}-oversized.log`),
    paths: join(logDir, `${tool}-oversized-paths.txt`),
    rels: join(logDir, `${tool}-oversized-rels.txt`),
    todo: join(logDir, `${tool}-oversized-todo.txt`),
  }
}

async function fileHasLine(filePath: string, needle: string): Promise<boolean> {
  const key = needle.trim().toLowerCase()
  if (!key) return false
  let content = ''
  try {
    content = await readFile(filePath, 'utf8')
  } catch {
    return false
  }
  return content
    .split(/\r?\n/)
    .some((line) => {
      const t = line.trim()
      if (!t || t.startsWith('#')) return false
      return t.toLowerCase() === key
    })
}

async function appendUniqueListLine(
  filePath: string,
  line: string,
  headerIfNew: string,
): Promise<void> {
  const trimmed = line.trim()
  if (!trimmed) return
  if (await fileHasLine(filePath, trimmed)) return
  let prefix = ''
  try {
    await readFile(filePath, 'utf8')
  } catch {
    prefix = headerIfNew
  }
  await appendFile(filePath, `${prefix}${trimmed}\n`, 'utf8')
}

async function appendOversizedWorkLists(
  projectRoot: string,
  tool: OversizedTool,
  entry: OversizedOutputEntry,
): Promise<void> {
  const paths = oversizedListPaths(projectRoot, tool)
  await mkdir(join(projectRoot, 'data'), { recursive: true })

  const pct = oversizedPct(entry)
  const todoLine = [
    new Date(entry.loggedAt).toISOString(),
    `+${pct}%`,
    formatBytes(entry.sourceBytes),
    formatBytes(entry.outputBytes),
    entry.rel,
    entry.sourcePath,
    entry.outputPath,
  ].join('\t')

  await appendUniqueListLine(
    paths.paths,
    entry.sourcePath,
    [
      `# ${tool} oversized — caminho absoluto da origem (um por linha)`,
      '# Copiar para scripts, Explorer ou reencodar manualmente.',
      '',
    ].join('\n'),
  )

  if (entry.rel.trim()) {
    await appendUniqueListLine(
      paths.rels,
      entry.rel.replace(/\\/g, '/'),
      [
        `# ${tool} oversized — caminho relativo à biblioteca (fila shrink)`,
        '# Um nome por linha; usar com a pasta de origem correcta no Admin.',
        '',
      ].join('\n'),
    )
  }

  const todoHeader = [
    `# ${tool} oversized — detalhe para rever depois`,
    '# data\t+%\torigem\tsaida\trel\tcaminho_origem\tcaminho_saida',
    '',
  ].join('\n')
  let todoPrefix = ''
  try {
    await readFile(paths.todo, 'utf8')
  } catch {
    todoPrefix = todoHeader
  }
  await appendFile(paths.todo, `${todoPrefix}${todoLine}\n`, 'utf8')
}

async function appendOversizedLog(
  projectRoot: string,
  tool: OversizedTool,
  entry: OversizedOutputEntry,
): Promise<void> {
  const logDir = join(projectRoot, 'data')
  await mkdir(logDir, { recursive: true })
  const pct = oversizedPct(entry)
  const line = [
    new Date(entry.loggedAt).toISOString(),
    tool,
    entry.sourcePath,
    entry.outputPath,
    String(entry.sourceBytes),
    String(entry.outputBytes),
    `+${pct}%`,
  ].join('\t')
  await appendFile(join(logDir, `${tool}-oversized.log`), `${line}\n`, 'utf8')
  await appendOversizedWorkLists(projectRoot, tool, entry)
}

/** Se a saída for maior que a origem, regista em `data/<tool>-oversized.log`. */
export async function logIfOutputLargerThanSource(opts: {
  projectRoot: string
  sourcePath: string
  outputSubdir: 'edited' | 'shrinked'
  tool: OversizedTool
  fileRel?: string
}): Promise<OversizedOutputEntry | null> {
  const sourcePath = resolve(opts.sourcePath)
  const outputPath = outputMp4Path(sourcePath, opts.outputSubdir)

  if (!existsSync(outputPath)) return null

  let srcStat
  let outStat
  try {
    ;[srcStat, outStat] = await Promise.all([stat(sourcePath), stat(outputPath)])
  } catch {
    return null
  }

  if (!srcStat.isFile() || !outStat.isFile()) return null
  if (outStat.size <= srcStat.size) return null

  const entry: OversizedOutputEntry = {
    rel: opts.fileRel ?? basename(sourcePath),
    sourcePath,
    outputPath,
    sourceBytes: srcStat.size,
    outputBytes: outStat.size,
    loggedAt: Date.now(),
  }

  await appendOversizedLog(opts.projectRoot, opts.tool, entry)
  return entry
}

export function oversizedOutputMessage(entry: OversizedOutputEntry): string {
  const pct = Number(oversizedPct(entry)) || 0
  return `Saída maior que origem (${formatBytes(entry.outputBytes)} vs ${formatBytes(entry.sourceBytes)}, +${pct}%)`
}

export interface ShrinkBitrateRetryEntry {
  rel: string
  sourcePath: string
  outputPath: string
  sourceBytes: number
  outputBytes: number
  loggedAt: number
}

/** Caminhos das listas de 2.ª passagem (bitrate retry). */
export function shrinkRetryListPaths(projectRoot: string) {
  const logDir = join(projectRoot, 'data')
  return {
    log: join(logDir, 'shrink-retry.log'),
    paths: join(logDir, 'shrink-retry-paths.txt'),
    rels: join(logDir, 'shrink-retry-rels.txt'),
    todo: join(logDir, 'shrink-retry-todo.txt'),
  }
}

function sizeDeltaPct(sourceBytes: number, outputBytes: number): string {
  if (sourceBytes <= 0) return '?'
  const pct = Math.round(((outputBytes - sourceBytes) * 100) / sourceBytes)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

/** Regista ficheiro que passou pela 2.ª passagem (priorizar tamanho + 1.ª saída maior). */
export async function logShrinkBitrateRetry(opts: {
  projectRoot: string
  sourcePath: string
  fileRel?: string
  sourceBytes: number
  outputBytes: number
}): Promise<ShrinkBitrateRetryEntry> {
  const sourcePath = resolve(opts.sourcePath)
  const outputPath = outputMp4Path(sourcePath, 'shrinked')
  const entry: ShrinkBitrateRetryEntry = {
    rel: opts.fileRel ?? basename(sourcePath),
    sourcePath,
    outputPath,
    sourceBytes: opts.sourceBytes,
    outputBytes: opts.outputBytes,
    loggedAt: Date.now(),
  }

  const lists = shrinkRetryListPaths(opts.projectRoot)
  await mkdir(join(opts.projectRoot, 'data'), { recursive: true })

  const pct = sizeDeltaPct(entry.sourceBytes, entry.outputBytes)
  const todoLine = [
    new Date(entry.loggedAt).toISOString(),
    pct,
    formatBytes(entry.sourceBytes),
    formatBytes(entry.outputBytes),
    entry.rel,
    entry.sourcePath,
    entry.outputPath,
  ].join('\t')

  await appendFile(
    lists.log,
    [
      new Date(entry.loggedAt).toISOString(),
      entry.sourcePath,
      entry.outputPath,
      String(entry.sourceBytes),
      String(entry.outputBytes),
      pct,
    ].join('\t') + '\n',
    'utf8',
  )

  await appendUniqueListLine(
    lists.paths,
    entry.sourcePath,
    [
      '# shrink 2.ª passagem — caminho absoluto da origem (um por linha)',
      '# Ficheiros cuja 1.ª passagem ficou maior; correu retry de bitrate.',
      '',
    ].join('\n'),
  )

  if (entry.rel.trim()) {
    await appendUniqueListLine(
      lists.rels,
      entry.rel.replace(/\\/g, '/'),
      [
        '# shrink 2.ª passagem — relativo à biblioteca (fila shrink)',
        '',
      ].join('\n'),
    )
  }

  const todoHeader = [
    '# shrink 2.ª passagem — detalhe',
    '# data\tΔ%\torigem\tsaida_2a\trel\tcaminho_origem\tcaminho_saida',
    '',
  ].join('\n')
  let todoPrefix = ''
  try {
    await readFile(lists.todo, 'utf8')
  } catch {
    todoPrefix = todoHeader
  }
  await appendFile(lists.todo, `${todoPrefix}${todoLine}\n`, 'utf8')

  return entry
}
