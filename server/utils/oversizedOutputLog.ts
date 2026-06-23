import { existsSync } from 'node:fs'
import { appendFile, mkdir, stat } from 'node:fs/promises'
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

async function appendOversizedLog(
  projectRoot: string,
  tool: OversizedTool,
  entry: OversizedOutputEntry,
): Promise<void> {
  const logDir = join(projectRoot, 'data')
  await mkdir(logDir, { recursive: true })
  const pct =
    entry.sourceBytes > 0
      ? (((entry.outputBytes - entry.sourceBytes) * 100) / entry.sourceBytes).toFixed(0)
      : '?'
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
  const pct =
    entry.sourceBytes > 0
      ? Math.round(((entry.outputBytes - entry.sourceBytes) * 100) / entry.sourceBytes)
      : 0
  return `Saída maior que origem (${formatBytes(entry.outputBytes)} vs ${formatBytes(entry.sourceBytes)}, +${pct}%)`
}
