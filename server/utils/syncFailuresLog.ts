import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface SyncFailureLogItem {
  sessionIndex: number
  libraryTitle: string
  libraryPath: string
  phase: 'trailers' | 'previews'
  /** Ficheiro em processamento antes do [ERRO] (ex.: filme na raíz). */
  sourceFile: string
  detail: string
}

export interface SyncFailuresLogPayload {
  savedAt: string
  jobId: string
  jobStatus: string
  itemCount: number
  items: SyncFailureLogItem[]
}

/**
 * Persiste último relatório de [ERRO] dos .bat (`data/sync-last-failures.json`).
 * Escreve sempre ao terminar um job — `items` vazio quando não houve erros por ficheiro.
 */
export async function writeSyncFailuresLog(
  projectRoot: string,
  payload: Omit<SyncFailuresLogPayload, 'itemCount'> & { items: SyncFailureLogItem[] },
): Promise<void> {
  const dir = join(projectRoot, 'data')
  const filePath = join(dir, 'sync-last-failures.json')
  await mkdir(dir, { recursive: true })
  const out: SyncFailuresLogPayload = {
    ...payload,
    itemCount: payload.items.length,
  }
  await writeFile(filePath, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
}
