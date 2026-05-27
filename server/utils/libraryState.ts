import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { dirname, join } from 'node:path'

import { purgeRecentPlaybackTitle, remapRecentPlaybackAfterMove } from './recentPlaybackDb'



export interface LibraryState {

  favorites: Record<string, string[]>

  fullProgress: Record<string, { seconds: number; duration?: number; updated: string }>

}

  

const EMPTY: LibraryState = {

  favorites: {},

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

      fullProgress:

        j.fullProgress && typeof j.fullProgress === 'object' && !Array.isArray(j.fullProgress)

          ? (j.fullProgress as LibraryState['fullProgress'])

          : {},

    }

  } catch {

    return { ...EMPTY, favorites: { ...EMPTY.favorites }, fullProgress: { ...EMPTY.fullProgress } }

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



export function fullProgressKey(session: number, mainRel: string): string {

  return `${sessionKey(session)}:${mainRel}`

}



/** Devolve `true` se ficou favorito. */

export async function toggleFavorite(session: number, trailerRel: string): Promise<boolean> {

  const state = await readLibraryState()

  const k = sessionKey(session)

  const set = new Set(state.favorites[k] ?? [])

  if (set.has(trailerRel)) set.delete(trailerRel)

  else set.add(trailerRel)

  state.favorites[k] = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  await writeLibraryState(state)

  return set.has(trailerRel)

}



export async function getFavoriteSet(session: number): Promise<Set<string>> {

  const state = await readLibraryState()

  return new Set(state.favorites[sessionKey(session)] ?? [])

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

): Promise<void> {

  const state = await readLibraryState()

  const fromK = sessionKey(fromSession)

  const toK = sessionKey(toSession)



  const fromArr = state.favorites[fromK] ?? []

  if (fromArr.includes(trailerRel)) {

    state.favorites[fromK] = fromArr.filter((r) => r !== trailerRel)

    if (state.favorites[fromK].length === 0) delete state.favorites[fromK]

    const toArr = state.favorites[toK] ?? []

    if (!toArr.includes(trailerRel)) {

      state.favorites[toK] = [...toArr, trailerRel].sort((a, b) =>

        a.localeCompare(b, undefined, { sensitivity: 'base' }),

      )

    }

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

  delete state.fullProgress[fullProgressKey(session, mainRel)]

  purgeRecentPlaybackTitle(session, trailerRel)

  await writeLibraryState(state)

}

