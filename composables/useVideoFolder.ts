/** Velocidades comuns de reprodução */
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

/**
 * Índice reservado no menu de bibliotecas: aba «Favoritos» (`GET /api/sessions`).
 * Não corresponde a uma entrada em `VIDEO_ROOT`; o catálogo vem de `GET /api/trailers/recent`.
 */
export const RECENTS_SESSION_ID = -1
/** Índice reservado no menu de bibliotecas: aba «Busca» (resultados globais em todas as pastas). */
export const SEARCH_SESSION_ID = -2

/**
 * Tag canónica que marca um vídeo como concluído (visto até ao fim na versão full).
 * Estes vídeos são empurrados para o fim da grelha e excluídos do botão "aleatório".
 * Mantida em sincronia com `server/utils/videoTagsDb.ts → COMPLETED_TAG_NAME`.
 */
export const COMPLETED_TAG_NAME = 'concluido'

/**
 * Tag canónica que marca o trailer (preview clip) como visto até ao fim.
 * NÃO afeta a ordenação nem o "trailer aleatório" — serve só como indicador visual.
 * Mantida em sincronia com `server/utils/videoTagsDb.ts → TRAILER_WATCHED_TAG_NAME`.
 */
export const TRAILER_WATCHED_TAG_NAME = 'trailer-visto'

/**
 * Tag canónica para marcar um vídeo como "memorável" (botão trofeu).
 * Empurra para o fim da grelha **e** exclui do "trailer aleatório", igual ao `concluido`,
 * mas é apresentado com badge dourado próprio para distinguir a marca manual.
 * Mantida em sincronia com `server/utils/videoTagsDb.ts → MEMORABLE_TAG_NAME`.
 */
export const MEMORABLE_TAG_NAME = 'memoravel'

export function isCompletedTag(name: string): boolean {
  return name.trim().toLowerCase() === COMPLETED_TAG_NAME
}

export function isTrailerWatchedTag(name: string): boolean {
  return name.trim().toLowerCase() === TRAILER_WATCHED_TAG_NAME
}

export function isMemorableTag(name: string): boolean {
  return name.trim().toLowerCase() === MEMORABLE_TAG_NAME
}

export function isEntryCompleted(entry: { tags?: string[] }): boolean {
  const tags = entry.tags
  if (!tags || !tags.length) return false
  for (const t of tags) {
    if (isCompletedTag(t)) return true
  }
  return false
}

export function isEntryTrailerWatched(entry: { tags?: string[] }): boolean {
  const tags = entry.tags
  if (!tags || !tags.length) return false
  for (const t of tags) {
    if (isTrailerWatchedTag(t)) return true
  }
  return false
}

export function isEntryMemorable(entry: { tags?: string[] }): boolean {
  const tags = entry.tags
  if (!tags || !tags.length) return false
  for (const t of tags) {
    if (isMemorableTag(t)) return true
  }
  return false
}

/** Considerado "já visto" para sort/random: concluído OU memorável. */
export function isEntryWatchedClass(entry: { tags?: string[] }): boolean {
  return isEntryCompleted(entry) || isEntryMemorable(entry)
}

export interface TrailerListEntry {
  trailerRel: string
  /** Catálogo: `preview/<mesmo_nome_que_o_trailer>` ou legado em `trailers/`; `null` se não existir. */
  previewRel: string | null
  mainRel: string
  mainFilename: string
  label: string
  trailerSizeBytes: number
  hasMain: boolean
  /** Tamanho do vídeo completo na raiz (ficheiro `mainFilename`); 0 se não existir. */
  mainSizeBytes: number
  /** Epoch ms para ordenar por data: birthtime do main quando fiável, senão mtime. */
  mainSortTimeMs: number
  /** Definido no servidor (`data/library-state.json`). */
  isFavorite?: boolean
  /** Tags SQLite (`data/library-tags.sqlite`), por sessão + `trailerRel`. */
  tags?: string[]
  /**
   * Só quando o trailer está em `trailers/<pasta>/ficheiro`: tag derivada das duas primeiras
   * palavras do nome da pasta (juntas); também é fundida em `tags` ao servir o catálogo.
   */
  folderPairTag?: string
  /**
   * Segundos vistos da versão completa (resume / progresso parcial) — `null` se nunca foi tocada.
   * Vem de `data/library-state.json → fullProgress`. Usado para mostrar o badge de "parcial".
   */
  watchedSeconds?: number | null
  /** Índice real em `VIDEO_ROOT` quando o item aparece só em vistas agregadas (Favoritos). */
  librarySession?: number
}

/** Limiar em segundos para considerar que o vídeo foi "visto parcialmente". */
export const PARTIAL_WATCHED_THRESHOLD_SECONDS = 60

export function isEntryPartiallyWatched(entry: TrailerListEntry): boolean {
  if (isEntryCompleted(entry)) return false
  if (isEntryMemorable(entry)) return false
  const s = entry.watchedSeconds
  return typeof s === 'number' && Number.isFinite(s) && s >= PARTIAL_WATCHED_THRESHOLD_SECONDS
}

export function apiVideoUrl(rel: string, session: number) {
  const s = Number.isFinite(session) && session >= 0 ? Math.floor(session) : 0
  return `/api/video?rel=${encodeURIComponent(rel)}&session=${s}`
}

/** Número de slots de JPEG estático por título na grelha (API `preview-frame`). */
export const CATALOG_PREVIEW_FRAME_SLOTS = 4

export function catalogPreviewFrameUrl(previewRel: string, session: number, slot: number): string {
  const sess = Number.isFinite(session) && session >= 0 ? Math.floor(session) : 0
  const s = ((slot % CATALOG_PREVIEW_FRAME_SLOTS) + CATALOG_PREVIEW_FRAME_SLOTS) % CATALOG_PREVIEW_FRAME_SLOTS
  const q = new URLSearchParams()
  q.set('session', String(sess))
  q.set('rel', previewRel)
  q.set('slot', String(s))
  return `/api/library/preview-frame?${q.toString()}`
}
