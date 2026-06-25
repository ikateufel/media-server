import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

export type ShrinkPhaseRun = 2 | 3

export function shrinkPhaseRunListPaths(projectRoot: string, phase: ShrinkPhaseRun) {
  const logDir = join(projectRoot, 'data')
  const tag = `phase${phase}`
  return {
    log: join(logDir, `shrink-${tag}-run.log`),
    paths: join(logDir, `shrink-${tag}-run-paths.txt`),
    rels: join(logDir, `shrink-${tag}-run-rels.txt`),
    root: join(logDir, `shrink-${tag}-run-root.txt`),
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
      const rel = t.replace(/^[23]\|/, '')
      return rel.toLowerCase() === key
    })
}

async function appendUniqueListLine(
  filePath: string,
  line: string,
  headerIfNew: string,
): Promise<void> {
  const trimmed = line.trim()
  if (!trimmed) return
  const key = trimmed.replace(/^[23]\|/, '').toLowerCase()
  if (await fileHasLine(filePath, key)) return
  let prefix = ''
  try {
    await readFile(filePath, 'utf8')
  } catch {
    prefix = headerIfNew
  }
  await appendFile(filePath, `${prefix}${trimmed}\n`, 'utf8')
}

async function ensureRootLine(rootFile: string, sourceRoot: string): Promise<void> {
  const root = resolve(sourceRoot)
  try {
    const raw = await readFile(rootFile, 'utf8')
    if (raw.split(/\r?\n/).some((l) => l.trim() === root)) return
  } catch {
    await appendFile(
      rootFile,
      [`# Pasta de origem (shrink)`, root, ''].join('\n'),
      'utf8',
    )
    return
  }
  await appendFile(rootFile, `${root}\n`, 'utf8')
}

/** Regista ficheiro que entrou na 2.ª ou 3.ª passagem durante o processamento. */
export async function logShrinkPhaseRun(opts: {
  projectRoot: string
  phase: ShrinkPhaseRun
  sourcePath: string
  fileRel?: string
  sourceRoot?: string
  note?: string
}): Promise<void> {
  const sourcePath = resolve(opts.sourcePath)
  const rel = (opts.fileRel ?? basename(sourcePath)).replace(/\\/g, '/')
  const sourceRoot = opts.sourceRoot ? resolve(opts.sourceRoot) : dirname(sourcePath)
  const lists = shrinkPhaseRunListPaths(opts.projectRoot, opts.phase)
  await mkdir(join(opts.projectRoot, 'data'), { recursive: true })

  const line = [
    new Date().toISOString(),
    String(opts.phase),
    sourcePath,
    rel,
    opts.note ?? '',
  ].join('\t')
  await appendFile(lists.log, `${line}\n`, 'utf8')

  await appendUniqueListLine(
    lists.paths,
    sourcePath,
    [`# shrink fase ${opts.phase} — caminho absoluto (durante processamento)`, ''].join('\n'),
  )

  await appendUniqueListLine(
    lists.rels,
    rel,
    [`# shrink fase ${opts.phase} — relativo à pasta de origem (fila shrink)`, ''].join('\n'),
  )

  await ensureRootLine(lists.root, sourceRoot)
}
