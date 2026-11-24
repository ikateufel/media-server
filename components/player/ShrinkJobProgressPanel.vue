<template>
  <div
    class="job-progress-panel"
    :class="{ 'job-progress-panel--failed': failed }"
    role="status"
    aria-live="polite"
    :aria-busy="busy"
  >
    <div class="job-progress-head">
      <span class="job-progress-title">
        {{
          busy
            ? queueLength > 1
              ? `Shrink fila ${queueDoneCount + 1}/${queueLength}`
              : 'Shrink em curso'
            : lastStatus || (failed ? 'Shrink falhou' : 'Shrink')
        }}
      </span>
      <span v-if="fileLabel" class="job-progress-file" :title="fileLabel">
        {{ fileLabel }}
      </span>
      <button
        v-if="logLines.length"
        type="button"
        class="job-progress-copy"
        title="Copiar log completo"
        @click="copyLog"
      >
        Copiar log
      </button>
      <button
        v-if="logLines.length"
        type="button"
        class="job-progress-copy"
        :title="logCollapsed ? 'Mostrar log' : 'Recolher log'"
        :aria-expanded="!logCollapsed"
        @click="logCollapsed = !logCollapsed"
      >
        {{ logCollapsed ? 'Mostrar log' : 'Recolher log' }}
      </button>
      <button
        v-if="!busy"
        type="button"
        class="job-progress-dismiss"
        title="Fechar painel"
        aria-label="Fechar painel de progresso"
        @click="emit('dismiss')"
      >
        ×
      </button>
    </div>
    <div
      class="job-progress-track"
      :class="{
        'job-progress-track--indeterminate': busy && (pct === null || pct < 90),
      }"
    >
      <div
        class="job-progress-fill"
        :style="
          pct !== null && !(busy && pct < 90) ? { width: `${pct}%` } : undefined
        "
      />
    </div>
    <p v-if="errorSummary" class="job-progress-error">{{ errorSummary }}</p>
    <p class="job-progress-line">{{ latestLine || 'A iniciar…' }}</p>
    <div
      v-if="logLines.length && !logCollapsed"
      ref="logEl"
      class="job-progress-log"
      aria-label="Log do shrink"
    >
      <div
        v-for="row in logLines"
        :key="row.id"
        class="job-progress-log-line"
        :class="`job-progress-log-line--${row.kind}`"
      >
        {{ row.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Painel isolado: linhas SSE do shrink actualizam só este componente,
 * sem re-renderizar o stage/vídeo do player.
 */
type ShrinkLogKind = 'ok' | 'err' | 'skip' | 'meta' | 'plain'

interface ShrinkLogRow {
  id: number
  text: string
  kind: ShrinkLogKind
}

const props = defineProps<{
  busy: boolean
  failed: boolean
  fileLabel: string
  lastStatus: string
  errorSummary: string
  queueLength: number
  queueDoneCount: number
}>()

const emit = defineEmits<{
  dismiss: []
  'content-change': [hasContent: boolean]
  toast: [message: string, kind: 'success' | 'error']
}>()

const LOG_CAP = 250
const FLUSH_MS = 120

const logLines = shallowRef<ShrinkLogRow[]>([])
const latestLine = ref('')
const pct = ref<number | null>(null)
const logCollapsed = ref(false)
const logEl = ref<HTMLElement | null>(null)

let nextLogId = 1
let durationSec: number | null = null
const seenSeq = new Set<number>()
const pendingRows: ShrinkLogRow[] = []
let flushTimer: number | null = null
let scrollPending = false
let pendingLatest = ''
let pendingPct: number | null | undefined = undefined

function classifyLine(t: string): ShrinkLogKind {
  if (/\[(ERRO|FATAL|DET)\]/i.test(t) || /\berror\b/i.test(t)) return 'err'
  if (/\[(SKIP|OVERSIZED|INSUFFICIENT)/i.test(t)) return 'skip'
  if (/\[OK\]/i.test(t)) return 'ok'
  if (/\[(INICIO|META|PROCESSANDO|REPLACE|BAT|PHASE|RETRY|LOG|UI)\]/i.test(t)) return 'meta'
  return 'plain'
}

function parseHhMmSsToSeconds(raw: string): number | null {
  const m = raw.trim().match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = Number(m[3])
  if (![h, min, sec].every((n) => Number.isFinite(n))) return null
  return h * 3600 + min * 60 + sec
}

function emitContent() {
  emit('content-change', logLines.value.length > 0 || Boolean(latestLine.value) || Boolean(props.fileLabel))
}

function scheduleScroll() {
  if (scrollPending) return
  scrollPending = true
  void nextTick(() => {
    scrollPending = false
    const el = logEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function flushPending() {
  flushTimer = null
  let changed = false
  if (pendingLatest) {
    latestLine.value = pendingLatest
    pendingLatest = ''
    changed = true
  }
  if (pendingPct !== undefined) {
    pct.value = pendingPct
    pendingPct = undefined
    changed = true
  }
  if (pendingRows.length) {
    const next = logLines.value.length
      ? logLines.value.slice()
      : ([] as ShrinkLogRow[])
    next.push(...pendingRows)
    pendingRows.length = 0
    if (next.length > LOG_CAP) next.splice(0, next.length - LOG_CAP)
    logLines.value = next
    scheduleScroll()
    changed = true
  }
  if (changed) emitContent()
}

function scheduleFlush() {
  if (flushTimer != null) return
  flushTimer = window.setTimeout(flushPending, FLUSH_MS)
}

function ingestLine(text: string, seq?: number) {
  if (typeof seq === 'number' && Number.isFinite(seq)) {
    if (seenSeq.has(seq)) return
    seenSeq.add(seq)
  }
  const t = String(text ?? '').replace(/\r/g, '').trim()
  if (!t) return

  pendingLatest = t
  pendingRows.push({ id: nextLogId++, text: t, kind: classifyLine(t) })

  const dur = t.match(/Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/i)
  if (dur?.[1]) {
    const s = parseHhMmSsToSeconds(dur[1])
    if (s !== null && s > 0) durationSec = s
  }
  const time = t.match(/\btime=(\d+:\d{2}:\d{2}(?:\.\d+)?)/i)
  if (time?.[1] && durationSec && durationSec > 0) {
    const cur = parseHhMmSsToSeconds(time[1])
    if (cur !== null) {
      pendingPct = Math.max(0, Math.min(99, Math.round((cur / durationSec) * 100)))
    }
  }
  if (/\[REPLACE\]/i.test(t)) pendingPct = 96
  else if (/\[OK\]/i.test(t)) pendingPct = 100

  scheduleFlush()
}

function reset(fileLabel = '') {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  pendingRows.length = 0
  pendingLatest = ''
  pendingPct = undefined
  logLines.value = []
  latestLine.value = ''
  pct.value = null
  logCollapsed.value = false
  durationSec = null
  seenSeq.clear()
  emit('content-change', Boolean(fileLabel))
}

function setLatestLine(text: string) {
  latestLine.value = text
  emitContent()
}

function setPct(value: number | null) {
  pct.value = value
}

async function copyLog() {
  const text = logLines.value.map((r) => r.text).join('\n')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    emit('toast', 'Log copiado.', 'success')
  } catch {
    emit('toast', 'Não foi possível copiar o log.', 'error')
  }
}

defineExpose({
  ingestLine,
  reset,
  setLatestLine,
  setPct,
  get hasLines() {
    return logLines.value.length > 0
  },
})

watch(
  () => props.fileLabel,
  () => emitContent(),
)
</script>

<style scoped>
.job-progress-panel {
  flex-shrink: 0;
  margin-top: 0.15rem;
  padding: 0.55rem 0.65rem 0.6rem;
  border-radius: 10px;
  border: 1px solid #2d3a4a;
  background: #12161c;
}

.job-progress-panel--failed {
  border-color: #8b3a36;
  background: #1a1212;
}

.job-progress-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.55rem;
  margin-bottom: 0.4rem;
}

.job-progress-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #c5ddf5;
  letter-spacing: 0.02em;
}

.job-progress-panel--failed .job-progress-title {
  color: #f8b4b0;
}

.job-progress-file {
  flex: 1 1 8rem;
  min-width: 0;
  font-size: 0.72rem;
  color: #9aa0a6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-progress-copy {
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.22rem 0.45rem;
  border-radius: 7px;
  border: 1px solid #3c4043;
  background: #1e2228;
  color: #c5cad3;
  cursor: pointer;
}

.job-progress-copy:hover {
  background: #2a2f37;
  color: #fff;
}

.job-progress-dismiss {
  flex: 0 0 auto;
  width: 1.6rem;
  height: 1.6rem;
  border: 1px solid #3c4043;
  border-radius: 7px;
  background: #1e2228;
  color: #c5cad3;
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
}

.job-progress-dismiss:hover {
  background: #2a2f37;
  color: #fff;
}

.job-progress-track {
  position: relative;
  height: 7px;
  border-radius: 999px;
  background: #1c222b;
  overflow: hidden;
  margin-bottom: 0.4rem;
}

.job-progress-fill {
  height: 100%;
  width: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #1a73e8, #5f9dee);
  transition: width 0.25s ease;
}

.job-progress-track--indeterminate .job-progress-fill {
  width: 38%;
  animation: job-progress-slide 1.15s ease-in-out infinite;
}

@keyframes job-progress-slide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

.job-progress-error {
  margin: 0 0 0.35rem;
  padding: 0.35rem 0.45rem;
  border-radius: 8px;
  border: 1px solid rgba(220, 105, 100, 0.35);
  background: rgba(88, 32, 32, 0.35);
  font-size: 0.78rem;
  line-height: 1.35;
  color: #ffd0cb;
  word-break: break-word;
}

.job-progress-line {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  line-height: 1.35;
  color: #e8eaed;
  word-break: break-word;
}

.job-progress-log {
  max-height: min(42vh, 18rem);
  overflow: auto;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  background: #0c0e12;
  border: 1px solid #252a32;
  font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.68rem;
  line-height: 1.45;
  color: #9aa0a6;
}

.job-progress-log-line {
  white-space: pre-wrap;
  word-break: break-word;
}

.job-progress-log-line + .job-progress-log-line {
  margin-top: 0.14rem;
}

.job-progress-log-line--err {
  color: #f8b4b0;
}

.job-progress-log-line--skip {
  color: #e8c27a;
}

.job-progress-log-line--ok {
  color: #a8d7b5;
}

.job-progress-log-line--meta {
  color: #9ec5f0;
}
</style>
