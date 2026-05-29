<script setup lang="ts">
import { catalogPreviewFrameUrl } from '~/composables/useVideoFolder'

const props = withDefaults(
  defineProps<{
    previewRel: string
    sessionIndex: number
    /** 1 = uma imagem (Destaques / TV); 4 = grelha 2×2. */
    maxSlots?: number
  }>(),
  { maxSlots: 4 },
)

const catalogFrameSlots = computed(() => {
  const n = Math.min(4, Math.max(1, Math.floor(props.maxSlots)))
  return Array.from({ length: n }, (_, i) => i) as number[]
})

const singleFrameMode = computed(() => catalogFrameSlots.value.length === 1)

const rootEl = ref<HTMLElement | null>(null)
/** Tile intersectou o scroll — mostra grelha (slots preenchem-se aos poucos). */
const inView = ref(false)
/** Quantos slots (0..4) têm `<img>` montado; 0 = só skeleton até IO. */
const slotsToShow = ref(0)

let io: IntersectionObserver | null = null
let idleCbId: number | undefined
let slotTimeoutId: ReturnType<typeof setTimeout> | undefined

function cancelSlotBumps() {
  if (idleCbId !== undefined && typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(idleCbId)
    idleCbId = undefined
  }
  if (slotTimeoutId !== undefined) {
    clearTimeout(slotTimeoutId)
    slotTimeoutId = undefined
  }
}

function armNextSlot() {
  const cap = catalogFrameSlots.value.length
  if (slotsToShow.value >= cap) return
  const go = () => {
    idleCbId = undefined
    slotTimeoutId = undefined
    if (slotsToShow.value >= cap) return
    slotsToShow.value++
    if (slotsToShow.value < cap) armNextSlot()
  }
  if (typeof requestIdleCallback !== 'undefined') {
    idleCbId = requestIdleCallback(go, { timeout: 900 })
  } else {
    slotTimeoutId = setTimeout(go, 48)
  }
}

function onImgError(ev: Event) {
  const el = ev.target
  if (el instanceof HTMLImageElement) el.style.visibility = 'hidden'
}

function scrollRootFor(el: HTMLElement): Element | null {
  return (
    el.closest('.tv-minimal-rail-scroll') ??
    el.closest('.trailer-grid-scroll') ??
    null
  )
}

function resetFrameState() {
  cancelSlotBumps()
  inView.value = false
  slotsToShow.value = 0
}

function revealFrames() {
  cancelSlotBumps()
  inView.value = true
  slotsToShow.value = 1
  if (!singleFrameMode.value) armNextSlot()
}

function attachIntersectionObserver() {
  io?.disconnect()
  io = null
  const el = rootEl.value
  if (!el) return
  const scrollRoot = scrollRootFor(el)
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          revealFrames()
          io?.disconnect()
          io = null
          break
        }
      }
    },
    {
      root: scrollRoot instanceof Element ? scrollRoot : null,
      rootMargin: '48px 0px',
      threshold: 0,
    },
  )
  io.observe(el)
}

watch(
  () => [props.previewRel, props.sessionIndex, props.maxSlots] as const,
  () => {
    resetFrameState()
    void nextTick(() => attachIntersectionObserver())
  },
)

onMounted(() => {
  attachIntersectionObserver()
})

onUnmounted(() => {
  cancelSlotBumps()
  io?.disconnect()
  io = null
})
</script>

<template>
  <div
    ref="rootEl"
    class="catalog-frame-strip"
    :class="{ 'catalog-frame-strip--single': catalogFrameSlots.length === 1 }"
    role="presentation"
  >
    <template v-if="inView">
      <template v-for="slot in catalogFrameSlots" :key="slot">
        <img
          v-if="slot < slotsToShow"
          class="catalog-frame-img"
          decoding="async"
          :fetchpriority="slot === 0 ? 'high' : 'low'"
          alt=""
          :src="catalogPreviewFrameUrl(props.previewRel, props.sessionIndex, slot)"
          @error="onImgError"
        />
        <div v-else class="catalog-frame-skeleton-cell" aria-hidden="true" />
      </template>
    </template>
    <div
      v-else
      class="catalog-frame-skeleton"
      :class="{ 'catalog-frame-skeleton--single': catalogFrameSlots.length === 1 }"
      aria-hidden="true"
    >
      <span v-for="slot in catalogFrameSlots" :key="slot" class="catalog-frame-skeleton-cell" />
    </div>
  </div>
</template>

<style scoped>
.catalog-frame-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #0a0a0c;
}

.catalog-frame-img {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: cover;
  display: block;
}

.catalog-frame-skeleton {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #0a0a0c;
}

.catalog-frame-skeleton-cell {
  min-height: 0;
  min-width: 0;
  background: linear-gradient(135deg, #12141a 0%, #1a1d24 50%, #12141a 100%);
}

.catalog-frame-strip--single,
.catalog-frame-skeleton--single {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}
</style>
