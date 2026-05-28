import type { Ref } from 'vue'
import type { TrailerListEntry } from '~/composables/useVideoFolder'

/** Primeira página em Destaques (Fire TV / memória). */
export const RECENTS_PAGE_INITIAL = 10
/** Itens por «load more». */
export const RECENTS_PAGE_MORE = 5
/** Máximo de entradas em `fullEntries` na sessão Destaques. */
export const RECENTS_MAX_IN_MEMORY = 15

export interface RecentsCatalogPage {
  items: TrailerListEntry[]
  total: number
  hasMore: boolean
  offset: number
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
  /** Última linha de diagnóstico (modo TV, visível na grelha). */
  const loadStatusLine = ref('')

  function trimWindowFromTop(): number {
    let removed = 0
    while (fullEntries.value.length > RECENTS_MAX_IN_MEMORY) {
      fullEntries.value.shift()
      removed++
    }
    return removed
  }

  async function fetchPage(offset: number, limit: number): Promise<RecentsCatalogPage> {
    return await $fetch<RecentsCatalogPage>(
      `/api/trailers/recent?offset=${offset}&limit=${limit}`,
    )
  }

  function applyMeta(data: RecentsCatalogPage) {
    total.value = data.total
    hasMore.value = data.hasMore
  }

  async function loadInitial(): Promise<RecentsCatalogPage> {
    loadingMore.value = false
    fetchOffset.value = 0
    logRecentsCatalog(`carga inicial: a pedir ${RECENTS_PAGE_INITIAL}…`, loadStatusLine)
    const data = await fetchPage(0, RECENTS_PAGE_INITIAL)
    fullEntries.value = data.items.map(normalizeRecentsEntry)
    fetchOffset.value = data.items.length
    applyMeta(data)
    logRecentsCatalog(
      `carga inicial OK: ${data.items.length} itens (total ${data.total}), em memória ${fullEntries.value.length}, hasMore=${data.hasMore}`,
      loadStatusLine,
    )
    return data
  }

  /** Carrega mais itens (mais antigos). Remove do topo se passar de {@link RECENTS_MAX_IN_MEMORY}. */
  async function loadMore(
    trigger: string,
  ): Promise<{ data: RecentsCatalogPage; trimmedFromTop: number } | null> {
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
  }

  return {
    total,
    hasMore,
    loadingMore,
    fetchOffset,
    loadStatusLine,
    loadInitial,
    loadMore,
    reset,
  }
}
