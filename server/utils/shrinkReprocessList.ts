import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseShrinkListFile } from '#shared/shrinkListFile'

export const SHRINK_REPROCESS_LIST_FILE = join('data', 'shrink-reprocess.txt')
export const SHRINK_MULTIPASS_LIST_FILE = join('data', 'shrink-multipass.txt')

export interface ShrinkReprocessListPayload {
  sourceRoot: string
  files: string[]
  count: number
  listPath: string
  phase2Count?: number
  phase3Count?: number
  needsPrioritizeSize?: boolean
}

/** 1.ª linha = pasta origem; resto = nomes (opcional prefixo 2| ou 3|). */
export function parseShrinkReprocessFile(content: string, listPath = SHRINK_REPROCESS_LIST_FILE): ShrinkReprocessListPayload {
  const parsed = parseShrinkListFile(content)
  return { ...parsed, listPath }
}
export async function readShrinkReprocessList(projectRoot: string): Promise<ShrinkReprocessListPayload> {
  const multipassPath = join(projectRoot, SHRINK_MULTIPASS_LIST_FILE)
  if (existsSync(multipassPath)) {
    const raw = await readFile(multipassPath, 'utf8')
    return parseShrinkReprocessFile(raw, SHRINK_MULTIPASS_LIST_FILE)
  }
  const listPath = join(projectRoot, SHRINK_REPROCESS_LIST_FILE)
  if (!existsSync(listPath)) {
    return { sourceRoot: '', files: [], count: 0, listPath }
  }
  const raw = await readFile(listPath, 'utf8')
  const parsed = parseShrinkReprocessFile(raw)
  return { ...parsed, listPath }
}
