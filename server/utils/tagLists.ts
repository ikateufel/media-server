import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { normalizeTagInput, TAG_MAX_LEN } from './videoTagsDb'

export interface TagList {
  id: string
  name: string
  tags: string[]
  updatedAt: string
}

export interface TagListsState {
  lists: TagList[]
}

const EMPTY: TagListsState = { lists: [] }

function stateFilePath() {
  return join(process.cwd(), 'data', 'tag-lists.json')
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeListName(raw: unknown): string | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!s) return null
  if (s.length > 80) return s.slice(0, 80)
  return s
}

function normalizeTagArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const n = normalizeTagInput(typeof item === 'string' ? item : String(item ?? ''))
    if (!n || n.length > TAG_MAX_LEN) continue
    const key = n.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return out
}

function parseList(raw: unknown): TagList | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null
  const name = normalizeListName(o.name)
  if (!id || !name) return null
  const updatedAt =
    typeof o.updatedAt === 'string' && o.updatedAt.trim() ? o.updatedAt.trim() : nowIso()
  return { id, name, tags: normalizeTagArray(o.tags), updatedAt }
}

export async function readTagLists(): Promise<TagListsState> {
  try {
    const raw = await readFile(stateFilePath(), 'utf-8')
    const j = JSON.parse(raw) as Partial<TagListsState>
    const lists = Array.isArray(j.lists)
      ? j.lists.map(parseList).filter((x): x is TagList => Boolean(x))
      : []
    return { lists }
  } catch {
    return { lists: [...EMPTY.lists] }
  }
}

async function writeTagLists(state: TagListsState): Promise<TagListsState> {
  const path = stateFilePath()
  await mkdir(dirname(path), { recursive: true })
  const clean: TagListsState = {
    lists: state.lists.map((l) => ({
      id: l.id,
      name: l.name,
      tags: normalizeTagArray(l.tags),
      updatedAt: l.updatedAt || nowIso(),
    })),
  }
  await writeFile(path, `${JSON.stringify(clean, null, 2)}\n`, 'utf-8')
  return clean
}

export async function createTagList(nameRaw: unknown): Promise<TagListsState> {
  const name = normalizeListName(nameRaw)
  if (!name) throw new Error('Nome da lista obrigatório.')
  const state = await readTagLists()
  if (state.lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Já existe uma lista com este nome.')
  }
  state.lists.push({
    id: randomUUID(),
    name,
    tags: [],
    updatedAt: nowIso(),
  })
  state.lists.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return writeTagLists(state)
}

export async function renameTagList(idRaw: unknown, nameRaw: unknown): Promise<TagListsState> {
  const id = String(idRaw ?? '').trim()
  const name = normalizeListName(nameRaw)
  if (!id) throw new Error('id da lista obrigatório.')
  if (!name) throw new Error('Nome da lista obrigatório.')
  const state = await readTagLists()
  const list = state.lists.find((l) => l.id === id)
  if (!list) throw new Error('Lista não encontrada.')
  if (state.lists.some((l) => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Já existe uma lista com este nome.')
  }
  list.name = name
  list.updatedAt = nowIso()
  state.lists.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return writeTagLists(state)
}

export async function deleteTagList(idRaw: unknown): Promise<TagListsState> {
  const id = String(idRaw ?? '').trim()
  if (!id) throw new Error('id da lista obrigatório.')
  const state = await readTagLists()
  const next = state.lists.filter((l) => l.id !== id)
  if (next.length === state.lists.length) throw new Error('Lista não encontrada.')
  return writeTagLists({ lists: next })
}

export async function setTagListTags(idRaw: unknown, tagsRaw: unknown): Promise<TagListsState> {
  const id = String(idRaw ?? '').trim()
  if (!id) throw new Error('id da lista obrigatório.')
  const state = await readTagLists()
  const list = state.lists.find((l) => l.id === id)
  if (!list) throw new Error('Lista não encontrada.')
  list.tags = normalizeTagArray(tagsRaw)
  list.updatedAt = nowIso()
  return writeTagLists(state)
}

export async function toggleTagInList(
  idRaw: unknown,
  tagRaw: unknown,
  wantIn?: boolean | null,
): Promise<TagListsState> {
  const id = String(idRaw ?? '').trim()
  const tag = normalizeTagInput(typeof tagRaw === 'string' ? tagRaw : String(tagRaw ?? ''))
  if (!id) throw new Error('id da lista obrigatório.')
  if (!tag) throw new Error('tag inválida.')
  const state = await readTagLists()
  const list = state.lists.find((l) => l.id === id)
  if (!list) throw new Error('Lista não encontrada.')
  const key = tag.toLowerCase()
  const has = list.tags.some((t) => t.toLowerCase() === key)
  const shouldAdd = wantIn == null ? !has : Boolean(wantIn)
  if (shouldAdd && !has) list.tags = normalizeTagArray([...list.tags, tag])
  if (!shouldAdd && has) list.tags = list.tags.filter((t) => t.toLowerCase() !== key)
  list.updatedAt = nowIso()
  return writeTagLists(state)
}
