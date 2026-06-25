import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { formatShrinkListFile, parseShrinkListFile } from '#shared/shrinkListFile'
import type { ShrinkReprocessListPayload } from './shrinkReprocessList'

export const SHRINK_QUEUE_LIST_FILE = join('data', 'shrink-queue.txt')

function parseShrinkQueueFile(content: string): ShrinkReprocessListPayload {
  return { ...parseShrinkListFile(content), listPath: SHRINK_QUEUE_LIST_FILE }
}

export async function readShrinkQueueList(projectRoot: string): Promise<ShrinkReprocessListPayload> {
  const listPath = join(projectRoot, SHRINK_QUEUE_LIST_FILE)
  try {
    const raw = await readFile(listPath, 'utf8')
    return parseShrinkQueueFile(raw)
  } catch {
    return { sourceRoot: '', files: [], count: 0, listPath: SHRINK_QUEUE_LIST_FILE }
  }
}

export async function writeShrinkQueueList(
  projectRoot: string,
  sourceRoot: string,
  files: string[],
): Promise<{ count: number; listPath: string }> {
  const root = resolve(sourceRoot.trim())
  const content = formatShrinkListFile(root, files)
  const dataDir = join(projectRoot, 'data')
  await mkdir(dataDir, { recursive: true })
  const listPath = join(projectRoot, SHRINK_QUEUE_LIST_FILE)
  await writeFile(listPath, content, 'utf8')
  const parsed = parseShrinkQueueFile(content)
  return { count: parsed.count, listPath: SHRINK_QUEUE_LIST_FILE }
}
