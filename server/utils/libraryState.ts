import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { dirname, join } from 'node:path'

import { purgeRecentPlaybackTitle, remapRecentPlaybackAfterMove } from './recentPlaybackDb'



export interface LibraryState {

  favorites: Record<string, string[]>

  /** ISO 8601: instante em que o utilizador marcou o título como favorito. */
  favoriteAt: Record<string, Record<string, string>>

  fullProgress: Record<string, { seconds: number; duration?: number; updated: string }>

}

  

const EMPTY: LibraryState = {

  favorites: {},

  favoriteAt: {},

  fullProgress: {},

}



function stateFilePath() {

  return join(process.cwd(), 'data', 'library-state.json')

}



export async function readLibraryState(): Promise<LibraryState> {

  try {

    const raw = await readFile(stateFilePath(), 'utf-8')

    const j = JSON.parse(raw) as Partial<LibraryState & { recentPlayback?: unknown }>

    return {

      favorites:

        j.favorites && typeof j.favorites === 'object' && !Array.isArray(j.favorites)

          ? (j.favorites as Record<string, string[]>)

          : {},

      favoriteAt: parseFavoriteAt(j.favoriteAt),

      fullProgress:

        j.fullProgress && typeof j.fullProgress === 'object' && !Array.isArray(j.fullProgress)

          ? (j.fullProgress as LibraryState['fullProgress'])

          : {},

    }

  } catch {

    return {

      ...EMPTY,

      favorites: { ...EMPTY.favorites },

      favoriteAt: { ...EMPTY.favoriteAt },

      fullProgress: { ...EMPTY.fullProgress },

    }

  }

}



export async function writeLibraryState(state: LibraryState): Promise<void> {

  const path = stateFilePath()

  await mkdir(dirname(path), { recursive: true })

  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')

}



export function sessionKey(session: number): string {

  return String(Math.max(0, Math.floor(session)))

}

function parseFavoriteAt(raw: unknown): Record<string, Record<string, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, Record<string, string>> = {}
  for (const [sk, map] of Object.entries(raw as Record<string, unknown>)) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue
    const inner: Record<string, string> = {}
    for (const [rel, at] of Object.entries(map as Record<string, unknown>)) {
      if (typeof at !== 'string' || !at.trim()) continue
      const ms = Date.parse(at)
      if (!Number.isFinite(ms)) continue
      inner[rel] = new Date(ms).toISOString()
    }
    if (Object.keys(inner).length) out[sk] = inner
  }
  return out
}

function pruneFavoriteAt(state: LibraryState, k: string, rels: Iterable<string>): void {
  const keep = new Set(rels)
  const map = state.favoriteAt[k]
  if (!map) return
  for (const rel of Object.keys(map)) {
    if (!keep.has(rel)) delete map[rel]
  }
  if (Object.keys(map).length === 0) delete state.favoriteAt[k]
}

function moveFavoriteAtEntry(
  state: LibraryState,
  fromK: string,
  toK: string,
  trailerRel: string,
): void {
  const fromMap = state.favoriteAt[fromK]
  const at = fromMap?.[trailerRel]
  if (fromMap) {
    delete fromMap[trailerRel]
    if (Object.keys(fromMap).length === 0) delete state.favoriteAt[fromK]
  }
  if (!at) return
  const toMap = state.favoriteAt[toK] ?? (state.favoriteAt[toK] = {})
  if (!toMap[trailerRel] || at < toMap[trailerRel]!) toMap[trailerRel] = at
}



export function fullProgressKey(session: number, mainRel: string): string {

  return `${sessionKey(session)}:${mainRel}`

}



export type ToggleFavoriteResult = { isFavorite: boolean; favoritedAt: string | null }

/** Devolve se ficou favorito e o instante gravado (só quando passa a favorito). */

export async function toggleFavorite(session: number, trailerRel: string): Promise<ToggleFavoriteResult> {

  const state = await readLibraryState()

  const k = sessionKey(session)

  const set = new Set(state.favorites[k] ?? [])
  const times = state.favoriteAt[k] ?? (state.favoriteAt[k] = {})

  if (set.has(trailerRel)) {
    set.delete(trailerRel)
    delete times[trailerRel]
  } else {
    set.add(trailerRel)
    times[trailerRel] = new Date().toISOString()
  }

  state.favorites[k] = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  pruneFavoriteAt(state, k, set)

  await writeLibraryState(state)

  return { isFavorite: set.has(trailerRel), favoritedAt: times[trailerRel] ?? null }

}



export async function getFavoriteSet(session: number): Promise<Set<string>> {

  const state = await readLibraryState()

  return new Set(state.favorites[sessionKey(session)] ?? [])

}

/** Mapa `trailerRel -> ISO` do instante em que foi marcado favorito. */
export async function getFavoriteAtMap(session: number): Promise<Map<string, string>> {
  const state = await readLibraryState()
  const map = state.favoriteAt[sessionKey(session)] ?? {}
  return new Map(Object.entries(map))
}

/** Move favorito de um `trailer_rel` alias para o canónico (mesmo vídeo físico). */
export async function remapFavoriteTrailerRel(
  session: number,
  fromRel: string,
  toRel: string,
): Promise<void> {
  const from = fromRel.replace(/\\/g, '/').trim()
  const to = toRel.replace(/\\/g, '/').trim()
  if (!from || from === to) return
  const state = await readLibraryState()
  const k = sessionKey(session)
  const arr = state.favorites[k] ?? []
  const hadFrom = arr.includes(from)
  const hadTo = arr.includes(to)
  if (!hadFrom && !hadTo) return
  const next = new Set(arr)
  next.delete(from)
  if (hadFrom || hadTo) next.add(to)
  state.favorites[k] = [...next].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const times = state.favoriteAt[k] ?? (state.favoriteAt[k] = {})
  const fromAt = times[from]
  const toAt = times[to]
  delete times[from]
  if (hadFrom || hadTo) {
    const kept = [fromAt, toAt].filter((v): v is string => !!v).sort()[0]
    if (kept) times[to] = kept
  }
  pruneFavoriteAt(state, k, next)
  await writeLibraryState(state)
}

export async function getFullProgress(

  session: number,

  mainRel: string,

): Promise<{ seconds: number; duration?: number } | null> {

  const state = await readLibraryState()

  const row = state.fullProgress[fullProgressKey(session, mainRel)]

  if (!row || typeof row.seconds !== 'number' || !Number.isFinite(row.seconds)) return null

  return { seconds: row.seconds, duration: row.duration }

}



/** Mapa `mainRel -> segundos vistos` para todos os títulos da sessão com progresso registado. */

export async function getFullProgressMap(session: number): Promise<Map<string, number>> {

  const state = await readLibraryState()

  const out = new Map<string, number>()

  const prefix = `${sessionKey(session)}:`

  for (const [k, v] of Object.entries(state.fullProgress)) {

    if (!k.startsWith(prefix)) continue

    if (!v || typeof v.seconds !== 'number' || !Number.isFinite(v.seconds)) continue

    out.set(k.slice(prefix.length), v.seconds)

  }

  return out

}



export async function setFullProgress(

  session: number,

  mainRel: string,

  seconds: number,

  duration?: number,

): Promise<void> {

  const state = await readLibraryState()

  const key = fullProgressKey(session, mainRel)

  if (!Number.isFinite(seconds) || seconds < 0) {

    delete state.fullProgress[key]

    await writeLibraryState(state)

    return

  }

  state.fullProgress[key] = {

    seconds,

    ...(typeof duration === 'number' && Number.isFinite(duration) ? { duration } : {}),

    updated: new Date().toISOString(),

  }

  await writeLibraryState(state)

}



export async function clearFullProgress(session: number, mainRel: string): Promise<void> {

  const state = await readLibraryState()

  delete state.fullProgress[fullProgressKey(session, mainRel)]

  await writeLibraryState(state)

}



/** Migra favoritos e progresso de `full` quando o título muda de pasta (índice de sessão). */

export async function moveTitleLibraryState(

  fromSession: number,

  toSession: number,

  trailerRel: string,

  mainRel: string,

  opts?: { toIsTrash?: boolean },

): Promise<void> {

  const state = await readLibraryState()

  const fromK = sessionKey(fromSession)

  const toK = sessionKey(toSession)



  const fromArr = state.favorites[fromK] ?? []

  if (fromArr.includes(trailerRel)) {

    state.favorites[fromK] = fromArr.filter((r) => r !== trailerRel)

    if (state.favorites[fromK].length === 0) delete state.favorites[fromK]

    if (!opts?.toIsTrash) {

      const toArr = state.favorites[toK] ?? []

      if (!toArr.includes(trailerRel)) {

        state.favorites[toK] = [...toArr, trailerRel].sort((a, b) =>

          a.localeCompare(b, undefined, { sensitivity: 'base' }),

        )

      }

      moveFavoriteAtEntry(state, fromK, toK, trailerRel)

      pruneFavoriteAt(state, toK, state.favorites[toK] ?? [])

    } else {

      const fromMap = state.favoriteAt[fromK]

      if (fromMap) {

        delete fromMap[trailerRel]

        if (Object.keys(fromMap).length === 0) delete state.favoriteAt[fromK]

      }

    }

    pruneFavoriteAt(state, fromK, state.favorites[fromK] ?? [])

  }



  const oldPk = fullProgressKey(fromSession, mainRel)

  const newPk = fullProgressKey(toSession, mainRel)

  const prog = state.fullProgress[oldPk]

  if (prog) {

    delete state.fullProgress[oldPk]

    state.fullProgress[newPk] = prog

  }



  remapRecentPlaybackAfterMove(fromSession, toSession, trailerRel)

  await writeLibraryState(state)

}



/** Remove favorito e progresso associados a um título apagado. */

export async function purgeTitleFromLibraryState(

  session: number,

  trailerRel: string,

  mainRel: string,

): Promise<void> {

  const state = await readLibraryState()

  const k = sessionKey(session)

  const arr = state.favorites[k] ?? []

  state.favorites[k] = arr.filter((r) => r !== trailerRel)

  if (state.favorites[k].length === 0) delete state.favorites[k]
  pruneFavoriteAt(state, k, state.favorites[k] ?? [])

  delete state.fullProgress[fullProgressKey(session, mainRel)]

  purgeRecentPlaybackTitle(session, trailerRel)

  await writeLibraryState(state)

}

