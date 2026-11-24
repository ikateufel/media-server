import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPersistGate, writeJsonFileAtomic } from './atomicJsonFile'
import { PREVIEW_FRAME_MAX_SLOTS } from './previewFrameCache'

/** Frame escolhido para representar um item de lista. */
export interface ItemCover {
  session: number
  rel: string
  slot: number
}

/** Máximo de fotos escolhidas por item (as que substituem as automáticas). */
export const ITEM_COVER_MAX = 2

const COVERS_FILE = () => join(process.cwd(), 'data', 'item-covers.json')
const persistCovers = createPersistGate()

export function itemCoverKey(listId: string, query: string): string {
  return `${listId.trim()}|${query.trim().replace(/\s+/g, ' ').toLowerCase()}`
}

function isValidCover(c: Partial<ItemCover> | null | undefined): c is ItemCover {
  return (
    !!c &&
    typeof c.session === 'number' &&
    typeof c.rel === 'string' &&
    typeof c.slot === 'number' &&
    c.slot >= 0 &&
    c.slot < PREVIEW_FRAME_MAX_SLOTS
  )
}

/** Lê `{ "<listId>|<item>": ItemCover[] }`; aceita também o formato antigo (um objeto só). */
export async function readItemCovers(): Promise<Record<string, ItemCover[]>> {
  try {
    const raw = JSON.parse(await readFile(COVERS_FILE(), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, ItemCover[]> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const list = (Array.isArray(v) ? v : [v]) as Partial<ItemCover>[]
      const valid = list.filter(isValidCover).slice(0, ITEM_COVER_MAX)
      if (valid.length) out[k] = valid
    }
    return out
  } catch {
    return {}
  }
}

/** `covers = []` remove a escolha (volta às fotos automáticas). */
export function setItemCovers(
  listId: string,
  query: string,
  covers: ItemCover[],
): Promise<Record<string, ItemCover[]>> {
  return persistCovers(async () => {
    const all = await readItemCovers()
    const key = itemCoverKey(listId, query)
    const clean = covers.filter(isValidCover).slice(0, ITEM_COVER_MAX)
    if (!clean.length) delete all[key]
    else all[key] = clean
    await writeJsonFileAtomic(COVERS_FILE(), all)
    return all
  })
}
