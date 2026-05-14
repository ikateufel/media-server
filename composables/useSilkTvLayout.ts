import { computed, onMounted, ref, watch } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

const TV_ASSIST_STORAGE_KEY = 'video-player-tv-layout-assist'

function readTvAssistStored(): boolean {
  if (!import.meta.client || typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(TV_ASSIST_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeTvAssistStored(on: boolean) {
  if (!import.meta.client || typeof localStorage === 'undefined') return
  try {
    if (on) localStorage.setItem(TV_ASSIST_STORAGE_KEY, '1')
    else localStorage.removeItem(TV_ASSIST_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * `?tv=1` (ou true/yes) grava em `localStorage` até `?tv=0`. Esse modo manual controla **só** o
 * assistente de rolagem do catálogo (▲▼, «Topo da lista», scrollbar escondida). O layout alargado
 * (`layout--tv-silk`) usa `isTvLayout` (manual **ou** UA Silk/Fire TV).
 */
function parseTvAssistFromQuery(query: RouteLocationNormalizedLoaded['query']): boolean {
  const v = query.tv
  if (v === undefined || v === null) return false
  const raw = Array.isArray(v) ? v[0] : v
  const n = String(raw).toLowerCase()
  return n === '1' || n === 'true' || n === 'yes'
}

/** `?tv=0` (ou false / no / off) desliga o modo forçado e apaga a preferência guardada. */
function parseTvOffFromQuery(query: RouteLocationNormalizedLoaded['query']): boolean {
  const v = query.tv
  if (v === undefined || v === null) return false
  const raw = Array.isArray(v) ? v[0] : v
  const n = String(raw).toLowerCase()
  return n === '0' || n === 'false' || n === 'no' || n === 'off'
}

/**
 * Heurística para Amazon Silk / Fire TV e variantes. Não é segurança — só UX/CSS.
 * Alguns WebViews omitem «Silk» no userAgent; o layout TV manual continua disponível com `?tv=1`.
 */
function detectSilkTvLikeUa(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const u = ua.toLowerCase()

  if (/\bsilk\b/.test(u)) return true
  if (/amazonwebappplatform/i.test(ua)) return true
  if (/\bfire\s*tv\b/.test(u) || /\bfiretv\b/.test(u)) return true
  if (/\baft[a-z0-9]/i.test(ua)) return true

  try {
    const nav = navigator as Navigator & {
      userAgentData?: { brands?: { brand: string }[] }
    }
    const brands = nav.userAgentData?.brands
    if (Array.isArray(brands)) {
      for (const { brand } of brands) {
        const b = String(brand)
        if (/\bsilk\b/i.test(b)) return true
        if (/\bfire\s*tv\b/i.test(b) || /\bfiretv\b/i.test(b)) return true
      }
    }
  } catch {
    /* ignore */
  }

  return false
}

/**
 * - `manualTvAssist`: `?tv=1` / preferência guardada (até `?tv=0`) — botões ▲▼ + scrollbar do grelha escondida.
 * - `isSilkTvUa`: só User-Agent Silk / Fire TV (para outras heurísticas; rolagem do catálogo **não** depende disto).
 * - `isTvLayout`: UA Silk/Fire TV **ou** `manualTvAssist` — classe `layout--tv-silk`, margens, grelha.
 */
export function useSilkTvLayout() {
  const route = useRoute()

  const uaSilkRef = ref(import.meta.client ? detectSilkTvLikeUa() : false)
  const tvStoredOn = ref(import.meta.client ? readTvAssistStored() : false)

  watch(
    () => route.query.tv,
    () => {
      if (parseTvOffFromQuery(route.query)) {
        writeTvAssistStored(false)
        tvStoredOn.value = false
        return
      }
      if (parseTvAssistFromQuery(route.query)) {
        writeTvAssistStored(true)
        tvStoredOn.value = true
      }
    },
    { immediate: true },
  )

  const manualTvAssist = computed(() => {
    if (parseTvOffFromQuery(route.query)) return false
    if (parseTvAssistFromQuery(route.query)) return true
    return tvStoredOn.value
  })

  const isSilkTvUa = computed(() => uaSilkRef.value)
  const isTvLayout = computed(() => uaSilkRef.value || manualTvAssist.value)

  onMounted(() => {
    uaSilkRef.value = detectSilkTvLikeUa()
    tvStoredOn.value = readTvAssistStored()
  })

  return { manualTvAssist, isSilkTvUa, isTvLayout }
}
