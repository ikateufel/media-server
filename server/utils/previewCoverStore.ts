import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPersistGate, writeJsonFileAtomic } from './atomicJsonFile'
import { PREVIEW_FRAME_MAX_SLOTS } from './previewFrameCache'

/** Ficheiro com a capa escolhida por título: `{ "<session>|<rel>": slot }`. */
const COVERS_FILE = () => join(process.cwd(), 'data', 'preview-covers.json')

const persistCovers = createPersistGate()

export function previewCoverKey(session: number, rel: string): string {
  const n = rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  return `${Math.floor(session)}|${n}`
}

export async function readPreviewCovers(): Promise<Record<string, number>> {
  try {
    const raw = JSON.parse(await readFile(COVERS_FILE(), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < PREVIEW_FRAME_MAX_SLOTS) {
        out[k] = v
      }
    }
    return out
  } catch {
    return {}
  }
}

/** `slot = null` remove a escolha (volta ao frame por defeito, slot 0). */
export function setPreviewCover(
  session: number,
  rel: string,
  slot: number | null,
): Promise<Record<string, number>> {
  return persistCovers(async () => {
    const covers = await readPreviewCovers()
    const key = previewCoverKey(session, rel)
    if (slot === null) delete covers[key]
    else covers[key] = slot
    await writeJsonFileAtomic(COVERS_FILE(), covers)
    return covers
  })
}
