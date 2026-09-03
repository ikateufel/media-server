<script setup lang="ts">
import { catalogPreviewFrameUrl } from '~/composables/useVideoFolder'

const props = defineProps<{
  samples: {
    session: number
    trailerRel: string
    previewRel: string
    label: string
  }[]
  itemLabel: string
}>()

const emit = defineEmits<{
  open: []
}>()

const urls = computed(() => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of props.samples) {
    const rel = s.previewRel || s.trailerRel
    if (!rel) continue
    const url = catalogPreviewFrameUrl(rel, s.session, 2)
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
})

const tick = ref(0)
const hovering = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
let prefetch: HTMLImageElement | null = null

const src = computed(() => {
  const list = urls.value
  if (!list.length) return ''
  if (!hovering.value || list.length < 2) return list[0]!
  return list[((tick.value % list.length) + list.length) % list.length]!
})

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  hovering.value = false
  tick.value = 0
  prefetch = null
}

function start() {
  const list = urls.value
  if (list.length < 2 || timer) return
  hovering.value = true
  tick.value = 0
  timer = setInterval(() => {
    tick.value += 1
    const next = list[((tick.value + 1) % list.length + list.length) % list.length]
    if (!next) return
    prefetch = new Image()
    prefetch.src = next
  }, 500)
}

onUnmounted(stop)
</script>

<template>
  <button
    v-if="src"
    type="button"
    class="mosaic"
    :title="samples[0]?.label || itemLabel"
    :aria-label="`Pré-visualização de «${itemLabel}»`"
    @pointerenter="start"
    @pointerleave="stop"
    @click="emit('open')"
  >
    <span class="mosaic-sizer" aria-hidden="true" />
    <img class="mosaic-img" :src="src" alt="" decoding="async" />
  </button>
</template>

<style scoped>
.mosaic {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 1px solid #2d333b;
  border-radius: 8px;
  overflow: hidden;
  isolation: isolate;
  background: #050608;
  cursor: pointer;
}

.mosaic-sizer {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  pointer-events: none;
}

.mosaic:hover {
  outline: 1px solid #5f9dee;
  outline-offset: -1px;
}

.mosaic-img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  background: #050608;
  pointer-events: none;
}
</style>
