import type { Ref } from 'vue'
import type { TrailerListEntry } from '~/composables/useVideoFolder'

/** Primeira página em Destaques (Fire TV / memória). */
export const RECENTS_PAGE_INITIAL = 30
/** Itens por «load more». */
export const RECENTS_PAGE_MORE = 30
/** Máximo de entradas em `fullEntries` na sessão Destaques. */
export const RECENTS_MAX_IN_MEMORY = 60

export interface RecentsOriginCount {
  session: number
  tag: string
  count: number
}

export interface RecentsCatalogPage {
  items: TrailerListEntry[]
  total: number
  hasMore: boolean
  offset: number
  /** Pastas do menu com títulos em Destaques (lista completa SQLite, independente da página). */
  originCounts?: RecentsOriginCount[]
  tagSuggestions?: string[]
  serverPlatform?: string
  adminRevealExplorer?: boolean
  catalogMode?: 'trailers' | 'main-only'
  fastPlay?: {
    rate?: number
    stepSeconds?: number
    windowSeconds?: number
    lastMinuteSeconds?: number
    fullscreenOnFastPlay?: boolean
  }
}

function normalizeRecentsEntry(e: TrailerListEntry): TrailerListEntry {
  return {
    ...e,
    mainSizeBytes: e.mainSizeBytes ?? 0,
    mainSortTimeMs: e.mainSortTimeMs ?? 0,
    highlightedAtMs: e.highlightedAtMs,
  }
}

const LOG_PREFIX = '[VP Destaques]'

function logRecentsCatalog(msg: string, statusLine: Ref<string>) {
  const line = `${LOG_PREFIX} ${msg}`
  if (import.meta.client) console.info(line)
  statusLine.value = msg
}

export function useRecentsCatalogWindow(fullEntries: Ref<TrailerListEntry[]>) {
  const total = ref(0)
  const hasMore = ref(false)
  const loadingMore = ref(false)
  const fetchOffset = ref(0)
  const librarySessionFilter = ref<number | null>(null)
  const originCounts = ref<RecentsOriginCount[]>([])
  /** Só na primeira entrada em Destaques; filtro ORIGEM usa carga completa sem «load more». */
  const paginationEnabled = ref(true)
  /** Última linha de diagnóstico (modo TV, visível na grelha). */
  const loadStatusLine = ref('')

  function setLibrarySessionFilter(session: number | null) {
    librarySessionFilter.value =
      session !== null && Number.isFinite(session) && session >= 0 ? Math.floor(session) : null
  }

  function setPaginationEnabled(on: boolean) {
    paginationEnabled.value = on
    if (!on) {
      hasMore.value = false
      loadingMore.value = false
    }
  }

  function applyOriginCounts(rows: RecentsOriginCount[] | undefined) {
    originCounts.value = Array.isArray(rows) ? rows : []
  }

  function trimWindowFromTop(): number {
    let removed = 0
    while (fullEntries.value.length > RECENTS_MAX_IN_MEMORY) {
      fullEntries.value.shift()
      removed++
    }
    return removed
  }

  function appendLibrarySessionParam(params: URLSearchParams) {
    if (librarySessionFilter.value !== null) {
      params.set('librarySession', String(librarySessionFilter.value))
    }
  }

  async function fetchPage(offset: number, limit: number): Promise<RecentsCatalogPage> {
    const params = new URLSearchParams()
    params.set('offset', String(offset))
    params.set('limit', String(limit))
    appendLibrarySessionParam(params)
    return await $fetch<RecentsCatalogPage>(`/api/trailers/recent?${params}`)
  }

  /** Lista completa (sem offset/limit) — troca de filtro ORIGEM ou saída da paginação. */
  async function fetchAll(): Promise<RecentsCatalogPage> {
    const params = new URLSearchParams()
    appendLibrarySessionParam(params)
    const qs = params.toString()
    return await $fetch<RecentsCatalogPage>(`/api/trailers/recent${qs ? `?${qs}` : ''}`)
  }

  function applyMeta(data: RecentsCatalogPage) {
    total.value = data.total
    hasMore.value = data.hasMore
  }

  async function loadInitial(): Promise<RecentsCatalogPage> {
    paginationEnabled.value = true
    loadingMore.value = false
    fetchOffset.value = 0
    logRecentsCatalog(`carga inicial: a pedir ${RECENTS_PAGE_INITIAL}…`, loadStatusLine)
    const data = await fetchPage(0, RECENTS_PAGE_INITIAL)
    fullEntries.value = data.items.map(normalizeRecentsEntry)
    fetchOffset.value = data.items.length
    applyMeta(data)
    applyOriginCounts(data.originCounts)
    logRecentsCatalog(
      `carga inicial OK: ${data.items.length} itens (total ${data.total}), em memória ${fullEntries.value.length}, hasMore=${data.hasMore}`,
      loadStatusLine,
    )
    return data
  }

  /** Sem paginação (filtro ORIGEM ou limpar filtro). */
  async function loadFull(): Promise<RecentsCatalogPage> {
    paginationEnabled.value = false
    loadingMore.value = false
    fetchOffset.value = 0
    hasMore.value = false
    logRecentsCatalog('carga completa (sem paginação)…', loadStatusLine)
    const data = await fetchAll()
    fullEntries.value = data.items.map(normalizeRecentsEntry)
    fetchOffset.value = data.items.length
    total.value = data.total
    hasMore.value = false
    applyOriginCounts(data.originCounts)
    logRecentsCatalog(
      `carga completa OK: ${data.items.length} itens (total ${data.total})`,
      loadStatusLine,
    )
    return data
  }

  /** Carrega mais itens (mais antigos). Mantém ordem global (mais recente primeiro). */
  async function loadMore(
    trigger: string,
  ): Promise<{ data: RecentsCatalogPage; trimmedFromTop: number } | null> {
    if (!paginationEnabled.value) {
      logRecentsCatalog(`[${trigger}] ignorado: paginação desactivada`, loadStatusLine)
      return null
    }
    if (!hasMore.value) {
      logRecentsCatalog(`[${trigger}] ignorado: hasMore=false (total ${total.value})`, loadStatusLine)
      return null
    }
    if (loadingMore.value) {
      logRecentsCatalog(`[${trigger}] ignorado: já a carregar`, loadStatusLine)
      return null
    }
    loadingMore.value = true
    const offsetBefore = fetchOffset.value
    const memBefore = fullEntries.value.length
    logRecentsCatalog(
      `[${trigger}] +${RECENTS_PAGE_MORE} itens (offset ${offsetBefore}, em memória ${memBefore})…`,
      loadStatusLine,
    )
    try {
      const data = await fetchPage(fetchOffset.value, RECENTS_PAGE_MORE)
      if (!data.items.length) {
        hasMore.value = false
        logRecentsCatalog(`[${trigger}] API devolveu 0 itens — fim da lista`, loadStatusLine)
        return null
      }
      fullEntries.value = [...fullEntries.value, ...data.items.map(normalizeRecentsEntry)]
      fetchOffset.value += data.items.length
      applyMeta(data)
      const trimmedFromTop = trimWindowFromTop()
      const trimNote =
        trimmedFromTop > 0 ? `, removidos ${trimmedFromTop} do topo (máx ${RECENTS_MAX_IN_MEMORY})` : ''
      logRecentsCatalog(
        `[${trigger}] OK: +${data.items.length} (offset ${offsetBefore}→${fetchOffset.value}), em memória ${fullEntries.value.length}${trimNote}, hasMore=${data.hasMore}`,
        loadStatusLine,
      )
      return { data, trimmedFromTop }
    } catch (err: unknown) {
      const ex = err as { message?: string }
      logRecentsCatalog(`[${trigger}] ERRO: ${ex?.message ?? 'falha no fetch'}`, loadStatusLine)
      throw err
    } finally {
      loadingMore.value = false
    }
  }

  function reset() {
    fetchOffset.value = 0
    total.value = 0
    hasMore.value = false
    loadingMore.value = false
    loadStatusLine.value = ''
    librarySessionFilter.value = null
    originCounts.value = []
    paginationEnabled.value = true
  }

  return {
    total,
    hasMore,
    loadingMore,
    fetchOffset,
    loadStatusLine,
    originCounts,
    librarySessionFilter,
    paginationEnabled,
    setLibrarySessionFilter,
    setPaginationEnabled,
    applyOriginCounts,
    loadInitial,
    loadFull,
    loadMore,
    reset,
  }
}
