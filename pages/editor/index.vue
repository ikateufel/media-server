<template>
  <div class="admin-page" :class="{ 'admin-page--with-video': !!videoSrc }">
    <header class="admin-head">
      <h1 class="admin-title">Editor de vídeo</h1>
      <div class="admin-head-links">
        <NuxtLink to="/" class="admin-back">← Reprodutor</NuxtLink>
        <NuxtLink to="/admin" class="admin-back">Admin</NuxtLink>
        <NuxtLink to="/historico" class="admin-back">Histórico</NuxtLink>
        <NuxtLink to="/shrink" class="admin-back">Shrink</NuxtLink>
      </div>
    </header>

    <p v-if="!videoSrc" class="admin-lead">
      Marque trechos a <strong>excluir</strong> (vermelho) ou <strong>recortar</strong> (verde).
      <strong>Split</strong> no instante actual divide o vídeo em partes
      (<code class="admin-code">edited\nome_1.mp4</code>,
      <code class="admin-code">_2</code>, <code class="admin-code">_3</code>…) —
      exclusões e recortes aplicam-se dentro de cada parte.
    </p>

    <p v-if="!isWinServer" class="admin-warn" role="status">
      O servidor está em <strong>{{ serverPlatform }}</strong> — a exportação só funciona com Node em Windows.
    </p>

    <section v-if="videoSrc" class="admin-card admin-card--narrow admin-card--compact">
      <div class="admin-row editor-file-row">
        <select v-model="sourceSession" class="admin-input" @change="onSourceSessionChange">
          <option value="">— biblioteca —</option>
          <option v-for="(row, i) in menuRows" :key="i" :value="String(i)">
            [{{ i }}] {{ row.title || row.path }}
          </option>
        </select>
        <input
          v-model="fileRel"
          type="text"
          class="admin-input admin-input--wide editor-source-path"
          spellcheck="false"
        />
        <button type="button" class="admin-btn" :disabled="!canLoadVideo" @click="loadVideo">Recarregar</button>
      </div>
      <p v-if="loadError" class="admin-err">{{ loadError }}</p>
      <p v-if="videoLoadErr" class="admin-err">{{ videoLoadErr }}</p>
    </section>

    <section v-if="!videoSrc" class="admin-card admin-card--narrow">
      <h2 class="admin-h2">Vídeo de origem</h2>
      <p class="admin-muted">
        Escolha a biblioteca no menu (ex.: «_selected»). O caminho do ficheiro é relativo a essa pasta —
        use só o nome se o vídeo estiver na raiz da biblioteca.
      </p>
      <p v-if="loadError" class="admin-err">{{ loadError }}</p>
      <div class="admin-row">
        <select v-model="sourceSession" class="admin-input admin-input--wide" @change="onSourceSessionChange">
          <option value="">— escolher biblioteca —</option>
          <option v-for="(row, i) in menuRows" :key="i" :value="String(i)">
            [{{ i }}] {{ row.title || row.path }}
          </option>
        </select>
        <button type="button" class="admin-btn admin-btn--ghost" @click="loadMenu">Actualizar bibliotecas</button>
      </div>
      <input
        v-model="sourceRoot"
        type="text"
        class="admin-input admin-input--full editor-source-path"
        spellcheck="false"
        placeholder="H:\videos\biblioteca"
      />

      <div
        class="drop-zone"
        :class="{ 'drop-zone--active': dropActive }"
        @dragenter.prevent="dropActive = true"
        @dragover.prevent="dropActive = true"
        @dragleave.prevent="dropActive = false"
        @drop.prevent="onDrop"
      >
        <p class="drop-zone-title">Arraste um vídeo para aqui</p>
        <p class="admin-muted drop-zone-hint">
          O browser <strong>não</strong> envia o caminho completo no disco — indique a biblioteca acima
          (pasta no servidor). {{ VIDEO_EXT_LABEL }} — arrastar ou «Escolher ficheiro» preenche só o nome;
          «Escolher pasta» inclui subpastas relativas.
        </p>
        <div class="admin-row drop-zone-actions">
          <button type="button" class="admin-btn" @click="pickFile">Escolher ficheiro</button>
          <button type="button" class="admin-btn admin-btn--ghost" @click="pickFolder">Escolher pasta</button>
        </div>
        <input ref="fileInputRef" type="file" :accept="VIDEO_FILE_INPUT_ACCEPT" class="sr-only" @change="onFileInput" />
        <input ref="folderInputRef" type="file" multiple webkitdirectory class="sr-only" @change="onFolderInput" />
      </div>

      <div class="admin-row editor-file-row">
        <input
          v-model="fileRel"
          type="text"
          class="admin-input admin-input--wide editor-source-path"
          spellcheck="false"
          placeholder="filme.mkv ou subpasta/filme.mp4"
        />
        <button type="button" class="admin-btn" :disabled="!canLoadVideo" @click="loadVideo">Carregar</button>
      </div>
      <p v-if="videoLoadErr" class="admin-err">{{ videoLoadErr }}</p>
    </section>

    <div v-if="videoSrc" class="editor-workspace">
    <section class="admin-card editor-player-card">
      <div class="editor-player-head">
        <h2 class="admin-h2">Player</h2>
        <p class="admin-muted editor-file-label">{{ fileRel }}</p>
      </div>

      <div class="editor-stage">
      <div ref="videoWrapRef" class="editor-video-wrap">
        <video
          :key="videoSrc"
          ref="videoRef"
          class="editor-video"
          controls
          playsinline
          preload="auto"
          :src="videoSrc"
          @loadedmetadata="onVideoLoaded"
          @timeupdate="onTimeUpdate"
          @error="onVideoError"
        />
      </div>

      <div class="editor-controls">
      <div class="editor-time-row">
        <span class="editor-time-current">{{ formatTime(currentTime) }}</span>
        <span class="editor-time-sep">/</span>
        <span class="editor-time-duration">{{ formatTime(duration) }}</span>
      </div>

      <div
        class="editor-timeline"
        role="slider"
        aria-label="Linha temporal"
        tabindex="0"
        @click="onTimelineClick"
        @keydown.left.prevent="seekRelative(-1)"
        @keydown.right.prevent="seekRelative(1)"
      >
        <div class="editor-timeline-track">
          <div
            v-for="(chunk, ci) in splitChunks"
            :key="`chunk-${ci}`"
            class="editor-timeline-chunk"
            :class="ci % 2 === 0 ? 'editor-timeline-chunk--a' : 'editor-timeline-chunk--b'"
            :style="segmentStyle(chunk)"
            :title="`Parte ${ci + 1}`"
          />
          <div
            v-for="seg in markedSegments"
            :key="seg.id"
            class="editor-timeline-mark"
            :class="
              seg.mode === 'exclude' ? 'editor-timeline-mark--exclude' : 'editor-timeline-mark--keep'
            "
            :style="segmentStyle(seg)"
          />
          <div
            v-for="sp in splitPoints"
            :key="sp.id"
            class="editor-timeline-split"
            :style="{ left: splitPointPct(sp.time) + '%' }"
            :title="`Split ${formatTime(sp.time)}`"
          />
          <div class="editor-timeline-playhead" :style="{ left: playheadPct + '%' }" />
          <div
            v-if="pendingStart != null"
            class="editor-timeline-pending"
            :class="
              activeMarkMode === 'exclude'
                ? 'editor-timeline-pending--exclude'
                : 'editor-timeline-pending--keep'
            "
            :style="pendingStyle"
          />
        </div>
      </div>

      <div class="editor-mode-toggle" role="group" aria-label="Modo de marcação pendente">
        <button
          type="button"
          class="editor-mode-btn"
          :class="{ 'editor-mode-btn--active': activeMarkMode === 'exclude' }"
          @click="activeMarkMode = 'exclude'"
        >
          Excluir
        </button>
        <button
          type="button"
          class="editor-mode-btn"
          :class="{ 'editor-mode-btn--active': activeMarkMode === 'keep' }"
          @click="activeMarkMode = 'keep'"
        >
          Recortar
        </button>
      </div>

      <div class="admin-row editor-mark-row">
        <button type="button" class="admin-btn" title="Atalho: I" @click="markIn">Marcar início (I)</button>
        <button type="button" class="admin-btn" title="Atalho: O" @click="markOut">Marcar fim (O)</button>
        <button
          type="button"
          class="admin-btn editor-btn-split"
          :title="
            canAddSplit
              ? 'Divide o vídeo neste instante (atalho: P)'
              : 'Move o cursor — split precisa de ≥0,5s do início, do fim e de outro corte'
          "
          :disabled="!canAddSplit"
          @click="addSplitPoint"
        >
          Split
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--danger"
          :disabled="!canAddMark"
          @click="addMarked('exclude')"
        >
          Adicionar exclusão
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--success"
          :disabled="!canAddMark"
          @click="addMarked('keep')"
        >
          Adicionar recorte
        </button>
        <button
          v-if="markedSegments.length"
          type="button"
          class="admin-btn admin-btn--ghost"
          @click="clearAllMarks"
        >
          Limpar trechos
        </button>
        <span v-if="markInTime != null" class="editor-mark-hint">
          Início: {{ formatTime(markInTime) }}
          <template v-if="markOutTime != null"> → Fim: {{ formatTime(markOutTime) }}</template>
        </span>
      </div>
      <p class="admin-muted editor-mark-help">
        <strong>Split</strong> — corta neste ponto; cada parte vira um ficheiro
        (<code class="admin-code">nome_1.mp4</code>, <code class="admin-code">_2</code>…).
        <strong>Excluir</strong> — marca o que sai; exporta o resto.
        <strong>Recortar</strong> — marca o que fica; exporta só esses pedaços.
        Repete início/fim para cada trecho. Trechos sobrepostos do mesmo tipo são fundidos na exportação.
        Atalho <kbd>Enter</kbd> usa o modo seleccionado acima.
      </p>
      </div>
      </div>

      <div v-if="splitPoints.length" class="editor-split-section">
        <h3 class="editor-h3">Partes ({{ chunkPlansPreview.length }})</h3>
        <div class="admin-row editor-mark-row">
          <button
            type="button"
            class="admin-btn admin-btn--ghost"
            @click="clearSplitPoints"
          >
            Limpar splits
          </button>
        </div>
        <p class="admin-muted editor-mark-help">
          {{ splitPoints.length }} corte{{ splitPoints.length === 1 ? '' : 's' }} →
          {{ splitPoints.length + 1 }} ficheiros
          em <code class="admin-code">edited\nome_1.mp4</code> …
          <code class="admin-code">nome_{{ splitPoints.length + 1 }}.mp4</code>.
        </p>
        <ul class="editor-split-list">
          <li v-for="sp in splitPoints" :key="sp.id" class="editor-split-item">
            <button type="button" class="editor-split-time" @click="seekTo(sp.time)">
              {{ formatTime(sp.time) }}
            </button>
            <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" @click="removeSplitPoint(sp.id)">
              Apagar
            </button>
          </li>
        </ul>
        <div v-if="chunkPlansPreview.length" class="editor-chunks-preview">
          <h4 class="editor-chunks-title">Blocos a gravar</h4>
          <ul class="editor-chunks-list">
            <li v-for="plan in chunkPlansPreview" :key="plan.label" class="editor-chunk-row">
              <span class="editor-chunk-label">{{ plan.label }}</span>
              <span class="editor-chunk-range">
                {{ formatTime(plan.chunk.start) }} – {{ formatTime(plan.chunk.end) }}
              </span>
              <span class="editor-chunk-meta">
                → {{ plan.keepSegments.length }} trecho{{ plan.keepSegments.length === 1 ? '' : 's' }}
                · {{ formatTime(chunkKeepDuration(plan)) }}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="markedSegments.length" class="editor-segments">
        <h3 class="editor-h3">Marcações ({{ markedSegments.length }})</h3>
        <ul class="editor-segment-list">
          <li v-for="seg in markedSegments" :key="seg.id" class="editor-segment-item">
            <span
              class="editor-segment-badge"
              :class="
                seg.mode === 'exclude' ? 'editor-segment-badge--exclude' : 'editor-segment-badge--keep'
              "
            >
              {{ seg.mode === 'exclude' ? 'Excluir' : 'Recortar' }}
            </span>
            <button type="button" class="editor-segment-range" @click="seekTo(seg.start)">
              {{ formatTime(seg.start) }} – {{ formatTime(seg.end) }}
              <span class="editor-segment-dur">({{ formatTime(seg.end - seg.start) }})</span>
            </button>
            <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" @click="removeMarked(seg.id)">
              Apagar
            </button>
          </li>
        </ul>
        <p v-if="excludeMarked.length" class="admin-muted editor-keep-summary">
          <strong>Excluir:</strong> ficam {{ excludeExportPreview.length }} trecho{{
            excludeExportPreview.length === 1 ? '' : 's'
          }}
          · {{ formatTime(excludeExportDuration) }}
        </p>
        <p v-if="keepMarked.length" class="admin-muted editor-keep-summary">
          <strong>Recortar:</strong> exportam {{ keepExportPreview.length }} trecho{{
            keepExportPreview.length === 1 ? '' : 's'
          }}
          · {{ formatTime(keepExportDuration) }}
        </p>
      </div>
      <p v-else class="admin-muted">Nenhum trecho marcado.</p>
    </section>

    <section v-if="videoSrc" class="admin-card">
      <h2 class="admin-h2">Exportar</h2>
      <div class="admin-row editor-options">
        <label class="editor-field">
          <span class="editor-label">Altura máx. (px)</span>
          <input v-model.number="height" type="number" min="144" max="4320" step="1" class="admin-input editor-num" />
        </label>
        <label class="editor-field">
          <span class="editor-label">Velocidade</span>
          <select v-model="speed" class="admin-input">
            <option :value="1">1× (normal)</option>
            <option :value="1.25">1.25×</option>
            <option :value="1.5">1.5×</option>
            <option :value="2">2×</option>
          </select>
        </label>
        <label class="admin-check-label editor-force">
          <input v-model="force" type="checkbox" />
          Substituir se já existir em edited\
        </label>
        <label
          v-if="canUseVideoOption"
          class="admin-check-label editor-force"
          :title="useVideoHint"
        >
          <input v-model="useVideo" type="checkbox" :disabled="!!splitPoints.length" />
          Usar vídeo (backup + substituir original)
        </label>
      </div>
      <div class="admin-row editor-export-actions">
        <button
          type="button"
          class="admin-btn editor-btn-split-export"
          :disabled="!canExportSplit"
          @click="startExportSplit"
        >
          Gerar partes (1, 2, 3…)
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--danger"
          :disabled="!canExportExclude"
          @click="startExport('exclude')"
        >
          {{ useVideo ? 'Usar vídeo (excluir)' : 'Gerar ficheiro único (excluir)' }}
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--success"
          :disabled="!canExportKeep"
          @click="startExport('keep')"
        >
          {{ useVideo ? 'Usar vídeo (recortes)' : 'Gerar ficheiro único (recortes)' }}
        </button>
      </div>
      <div class="admin-row">
        <button
          type="button"
          class="admin-btn admin-btn--ghost"
          :disabled="!canExportSplit || validating"
          @click="validateExportSplit"
        >
          Validar partes
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--ghost"
          :disabled="!canExportExclude || validating"
          @click="validateExport('exclude')"
        >
          Validar exclusão
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--ghost"
          :disabled="!canExportKeep || validating"
          @click="validateExport('keep')"
        >
          Validar recorte
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--ghost"
          :disabled="!canOpenEditedFolder || revealEditedBusy"
          title="Abre a pasta edited\ do vídeo no Explorador"
          @click="openEditedFolder"
        >
          {{ revealEditedBusy ? 'A abrir…' : 'Abrir pasta edited' }}
        </button>
      </div>
      <p v-if="revealEditedErr" class="admin-err">{{ revealEditedErr }}</p>
      <p v-if="validateMsg" :class="validateOk ? 'admin-ok' : 'admin-err'">{{ validateMsg }}</p>
      <p v-if="startErr" class="admin-err">{{ startErr }}</p>
    </section>

    <section v-if="job || jobErr" class="admin-card admin-card--log">
      <div class="job-head">
        <h2 class="admin-h2">Processamento</h2>
        <div class="job-head-actions">
          <span v-if="job" class="job-status" :class="`job-status--${job.status}`">
            {{ statusLabel(job.status) }}
            <span v-if="job.cancelRequested && job.status === 'running'"> (a cancelar…)</span>
          </span>
          <button
            v-if="jobActive"
            type="button"
            class="admin-btn admin-btn--sm admin-btn--danger"
            :disabled="job?.cancelRequested"
            @click="cancelJob"
          >
            Cancelar
          </button>
          <button v-if="job && !jobActive" type="button" class="admin-btn admin-btn--sm admin-btn--ghost" @click="clearJobView">
            Limpar
          </button>
        </div>
      </div>
      <p v-if="jobErr" class="admin-err">{{ jobErr }}</p>
      <div v-if="job?.oversizedOutput" class="editor-oversized" role="status">
        <h3 class="editor-oversized-title">Saída maior que a origem</h3>
        <p class="admin-muted editor-oversized-hint">
          O ficheiro gerado ficou maior que o original. Registo em
          <code class="admin-code">data\editor-oversized.log</code>.
        </p>
        <p class="editor-oversized-msg">{{ oversizedOutputMsg }}</p>
      </div>
      <details v-if="job && job.lines.length" class="job-tail-details" open>
        <summary class="job-tail-summary">
          Saída ao vivo
          <label class="job-tail-autoscroll">
            <input v-model="autoScrollTail" type="checkbox" /> auto-scroll
          </label>
        </summary>
        <pre ref="tailRef" class="admin-pre job-tail" @scroll="onTailScroll"><span
          v-for="line in job.lines"
          :key="line.seq"
          :class="lineCssClass(line)"
        >{{ line.text }}{{ '\n' }}</span></pre>
      </details>
    </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  buildChunkExportPlans,
  computeChunksFromSplits,
  formatTime,
  keepSegmentsForExport,
  mergeSegments,
  normalizeSplitTimes,
  type CutSegment,
  type EditorChunkPlan,
  type EditorMarkMode,
  type MarkedSegment,
} from '~/composables/useVideoEditor'
import {
  isVideoFileName,
  VIDEO_EXT_LABEL,
  VIDEO_FILE_INPUT_ACCEPT,
} from '#shared/videoExtensions'

interface SplitPoint {
  id: string
  time: number
}

interface MenuRow {
  path: string
  title: string
}

type JobStatus = 'running' | 'done' | 'failed' | 'cancelled'

interface JobLine {
  seq: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

interface OversizedOutputEntry {
  rel: string
  sourceBytes: number
  outputBytes: number
}

interface JobSnapshot {
  id: string
  status: JobStatus
  lines: JobLine[]
  totalLines: number
  cancelRequested: boolean
  oversizedOutput?: OversizedOutputEntry | null
  newFileRel?: string | null
  useVideo?: boolean
}

const EDITOR_JOB_STORAGE_KEY = 'video_admin_editor_job_id'
const VISIBLE_LINES_CAP = 400

const loadError = ref('')
const route = useRoute()
const menuRows = ref<MenuRow[]>([])
const sourceSession = ref('')
const sourceRoot = ref('')
const fileRel = ref('')
const videoLoadErr = ref('')
const videoSrc = ref('')
const dropActive = ref(false)

const videoRef = ref<HTMLVideoElement | null>(null)
const videoWrapRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)
const duration = ref(0)
const currentTime = ref(0)

const markInTime = ref<number | null>(null)
const markOutTime = ref<number | null>(null)
const activeMarkMode = ref<EditorMarkMode>('exclude')
const markedSegments = ref<MarkedSegment[]>([])
const splitPoints = ref<SplitPoint[]>([])

const height = ref(1080)
const speed = ref<1 | 1.25 | 1.5 | 2>(1)
const force = ref(false)
const useVideo = ref(false)
const validating = ref(false)
const validateMsg = ref('')
const validateOk = ref(false)
const startErr = ref('')
const revealEditedBusy = ref(false)
const revealEditedErr = ref('')

const serverPlatform = ref('')
const isWinServer = computed(() => serverPlatform.value === 'win32')

const job = ref<JobSnapshot | null>(null)
const jobErr = ref('')
const jobActive = computed(() => job.value?.status === 'running')
const tailRef = ref<HTMLPreElement | null>(null)
const autoScrollTail = ref(true)

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

const oversizedOutputMsg = computed(() => {
  const e = job.value?.oversizedOutput
  if (!e) return ''
  const pct =
    e.sourceBytes > 0 ? Math.round(((e.outputBytes - e.sourceBytes) * 100) / e.sourceBytes) : 0
  return `${e.rel}: ${formatBytes(e.outputBytes)} vs origem ${formatBytes(e.sourceBytes)} (+${pct}%)`
})
let eventSource: EventSource | null = null

const excludeMarked = computed(() => markedSegments.value.filter((s) => s.mode === 'exclude'))
const keepMarked = computed(() => markedSegments.value.filter((s) => s.mode === 'keep'))

const excludeExportPreview = computed(() => {
  if (!duration.value) return []
  return keepSegmentsForExport(duration.value, 'exclude', excludeMarked.value)
})

const keepExportPreview = computed(() => {
  if (!duration.value) return []
  return keepSegmentsForExport(duration.value, 'keep', keepMarked.value)
})

const excludeExportDuration = computed(() =>
  excludeExportPreview.value.reduce((acc, s) => acc + (s.end - s.start), 0),
)

const keepExportDuration = computed(() =>
  keepExportPreview.value.reduce((acc, s) => acc + (s.end - s.start), 0),
)

const splitTimes = computed(() => splitPoints.value.map((s) => s.time))

const splitChunks = computed(() => {
  if (!duration.value || !splitPoints.value.length) return []
  return computeChunksFromSplits(duration.value, splitTimes.value)
})

const canAddSplit = computed(() => {
  if (!duration.value) return false
  const next = normalizeSplitTimes([...splitTimes.value, currentTime.value], duration.value)
  return next.length > splitTimes.value.length
})

const chunkPlansPreview = computed((): EditorChunkPlan[] => {
  if (!duration.value || !splitPoints.value.length) return []
  const exclude = mergeSegments(
    markedSegments.value
      .filter((s) => s.mode === 'exclude')
      .map((s) => ({ start: s.start, end: s.end })),
  )
  const keep = mergeSegments(
    markedSegments.value
      .filter((s) => s.mode === 'keep')
      .map((s) => ({ start: s.start, end: s.end })),
  )
  return buildChunkExportPlans(duration.value, splitTimes.value, exclude, keep)
})

const playheadPct = computed(() =>
  duration.value > 0 ? Math.min(100, (currentTime.value / duration.value) * 100) : 0,
)

const pendingStart = computed(() => markInTime.value)

const pendingStyle = computed(() => {
  if (markInTime.value == null || !duration.value) return {}
  const start = markInTime.value
  const end = markOutTime.value ?? currentTime.value
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  return {
    left: `${(a / duration.value) * 100}%`,
    width: `${Math.max(0.3, ((b - a) / duration.value) * 100)}%`,
  }
})

const canLoadVideo = computed(() => {
  const hasFile = !!fileRel.value.trim() && isVideoName(fileRel.value)
  if (!hasFile) return false
  return !!effectiveSourceRoot()
})

function resolvedSessionIndex(): number | null {
  const raw = sourceSession.value
  if (raw === '' || raw == null) return null
  const sn = Number(raw)
  if (!Number.isFinite(sn) || sn < 0 || !Number.isInteger(sn)) return null
  return sn
}

/** Pasta efectiva: campo manual ou path da biblioteca seleccionada no menu. */
function effectiveSourceRoot(): string {
  const manual = sourceRoot.value.trim()
  if (manual) return manual
  const sn = resolvedSessionIndex()
  if (sn == null || sn < 0 || sn >= menuRows.value.length) return ''
  return menuRows.value[sn]!.path.trim()
}

function usesSessionVideoApi(): boolean {
  return resolvedSessionIndex() != null
}

const canAddMark = computed(() => {
  if (markInTime.value == null || markOutTime.value == null) return false
  return markOutTime.value - markInTime.value > 0.1
})

const exportBaseOk = computed(
  () =>
    isWinServer.value &&
    !jobActive.value &&
    !!effectiveSourceRoot() &&
    !!fileRel.value.trim() &&
    !!videoSrc.value,
)

const canExportExclude = computed(
  () => exportBaseOk.value && excludeMarked.value.length > 0 && !splitPoints.value.length,
)
const canExportKeep = computed(
  () => exportBaseOk.value && keepMarked.value.length > 0 && !splitPoints.value.length,
)
const canExportSplit = computed(
  () => exportBaseOk.value && splitPoints.value.length > 0 && duration.value > 0,
)

const canUseVideoOption = computed(() => exportBaseOk.value && resolvedSessionIndex() != null)

const useVideoHint = computed(() =>
  splitPoints.value.length
    ? 'Desactivado com splits — gera vários ficheiros em edited\\'
    : 'Copia o original para edited_backup\\ e substitui o ficheiro principal pelo editado.',
)

const canOpenEditedFolder = computed(() => {
  if (!fileRel.value.trim() || !isVideoName(fileRel.value)) return false
  return resolveRevealSession() != null
})

function resolveRevealSession(): number | null {
  const fromSelect = resolvedSessionIndex()
  if (fromSelect != null) return fromSelect
  const root = sourceRoot.value.trim().replace(/[/\\]+$/, '').toLowerCase()
  if (!root) return null
  const idx = menuRows.value.findIndex(
    (r) => r.path.trim().replace(/[/\\]+$/, '').toLowerCase() === root,
  )
  return idx >= 0 ? idx : null
}

async function openEditedFolder() {
  revealEditedErr.value = ''
  const session = resolveRevealSession()
  const rel = normalizeRel(fileRel.value)
  if (session == null || !rel) {
    revealEditedErr.value = 'Indique a biblioteca e o ficheiro de origem.'
    return
  }
  revealEditedBusy.value = true
  try {
    await $fetch('/api/admin/reveal-in-explorer', {
      method: 'POST',
      body: { session, target: 'edited', rel },
    })
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    revealEditedErr.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível abrir a pasta edited.'
  } finally {
    revealEditedBusy.value = false
  }
}

function splitPointPct(time: number): number {
  if (!duration.value) return 0
  return Math.min(100, Math.max(0, (time / duration.value) * 100))
}

function chunkKeepDuration(plan: EditorChunkPlan): number {
  return plan.keepSegments.reduce((acc, s) => acc + (s.end - s.start), 0)
}

function isVideoName(name: string): boolean {
  return isVideoFileName(name)
}

function normalizeRel(raw: string): string {
  let rel = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const root = sourceRoot.value.trim()
  if (root) {
    const rootName = root.replace(/[/\\]+$/, '').split(/[/\\]/).pop()?.toLowerCase() ?? ''
    const prefix = rel.split('/')[0]?.toLowerCase() ?? ''
    if (rootName && prefix === rootName && rel.includes('/')) {
      rel = rel.split('/').slice(1).join('/')
    }
  }
  return rel
}

function segmentStyle(seg: CutSegment) {
  if (!duration.value) return {}
  return {
    left: `${(seg.start / duration.value) * 100}%`,
    width: `${Math.max(0.3, ((seg.end - seg.start) / duration.value) * 100)}%`,
  }
}

function onSourceSessionChange() {
  const i = Number(sourceSession.value)
  if (!Number.isFinite(i) || i < 0 || i >= menuRows.value.length) return
  sourceRoot.value = menuRows.value[i]!.path.trim()
}

function readRouteVideoQuery(): boolean {
  const fileRaw = route.query.file
  const sessionRaw = route.query.session
  const useVideoRaw = route.query.useVideo
  const file =
    typeof fileRaw === 'string' ? fileRaw : Array.isArray(fileRaw) ? (fileRaw[0] ?? '') : ''
  if (!file.trim()) return false
  const sn = Number(
    typeof sessionRaw === 'string' ? sessionRaw : Array.isArray(sessionRaw) ? (sessionRaw[0] ?? NaN) : NaN,
  )
  if (Number.isFinite(sn) && sn >= 0) {
    sourceSession.value = String(Math.floor(sn))
    if (sn < menuRows.value.length) {
      sourceRoot.value = menuRows.value[sn]!.path.trim()
    }
    const uv =
      typeof useVideoRaw === 'string'
        ? useVideoRaw
        : Array.isArray(useVideoRaw)
          ? (useVideoRaw[0] ?? '')
          : ''
    useVideo.value = uv !== '0' && uv !== 'false'
  }
  // Depois de fixar a pasta — normalizeRel usa sourceRoot para tirar prefixos.
  fileRel.value = normalizeRel(file)
  return true
}

async function applyRoutePrefill() {
  if (!readRouteVideoQuery()) return
  if (canLoadVideo.value) {
    await loadVideo()
  }
}

function pickFile() {
  fileInputRef.value?.click()
}

function pickFolder() {
  folderInputRef.value?.click()
}

function relFromFile(f: File): string {
  return f.webkitRelativePath ? normalizeRel(f.webkitRelativePath) : normalizeRel(f.name)
}

function pickVideoRelFromList(list: FileList | File[]): string | null {
  for (const f of list) {
    const rel = relFromFile(f)
    if (isVideoName(rel)) return rel
  }
  return null
}

function editorVideoUrl(root: string, rel: string): string {
  // Nunca /api/video aqui — exige unlock do catálogo e falha com 401 no /editor.
  const q = new URLSearchParams()
  q.set('rel', rel)
  const session = resolvedSessionIndex()
  if (session != null && session < menuRows.value.length) {
    // Preferir session: evita caminhos Windows longos/especiais na query string.
    q.set('session', String(session))
    return `/api/admin/editor-video?${q.toString()}`
  }
  const rootTrim = root.trim()
  if (!rootTrim) {
    throw new Error('Pasta de origem em falta.')
  }
  q.set('sourceRoot', rootTrim)
  return `/api/admin/editor-video?${q.toString()}`
}

function parseApiErrorBody(body: string): string {
  try {
    const j = JSON.parse(body) as { statusMessage?: string; message?: string }
    return (j.message || j.statusMessage || '').trim()
  } catch {
    return (
      body.match(/"statusMessage"\s*:\s*"([^"]+)"/)?.[1] ||
      body.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ||
      ''
    )
  }
}

/**
 * Diagnóstico só em erro — `cache: 'no-store'` + Range curto.
 * NÃO chamar antes de atribuir `videoSrc`: um GET Range na mesma URL
 * pode ficar na cache HTTP e o <video> recebe 1 byte → falha de reprodução.
 */
async function diagnoseEditorVideo(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    })
    if (res.ok || res.status === 206) return null
    const body = await res.text().catch(() => '')
    const msg = parseApiErrorBody(body)
    return msg || `HTTP ${res.status}`
  } catch {
    return 'Sem resposta do servidor ao pedir o vídeo.'
  }
}

function applyVideoRel(relRaw: string, autoLoad = true) {
  const rel = normalizeRel(relRaw)
  if (!rel || !isVideoName(rel)) return false
  fileRel.value = rel
  videoLoadErr.value = ''
  if (autoLoad && canLoadVideo.value) {
    void loadVideo()
  }
  return true
}

function onDrop(e: DragEvent) {
  dropActive.value = false
  const files = e.dataTransfer?.files
  if (!files?.length) return
  const rel = pickVideoRelFromList(files)
  if (!rel) {
    videoLoadErr.value = 'Nenhum vídeo válido no arrasto.'
    return
  }
  applyVideoRel(rel)
}

function onFileInput(ev: Event) {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) applyVideoRel(relFromFile(f))
  input.value = ''
}

function onFolderInput(ev: Event) {
  const input = ev.target as HTMLInputElement
  if (!input.files?.length) return
  const rel = pickVideoRelFromList(input.files)
  if (!rel) {
    videoLoadErr.value = 'Nenhum vídeo na pasta escolhida.'
  } else {
    applyVideoRel(rel)
  }
  input.value = ''
}

async function loadVideo() {
  videoLoadErr.value = ''
  const rel = normalizeRel(fileRel.value)
  const sn = resolvedSessionIndex()
  if (sn != null && sn < menuRows.value.length) {
    sourceRoot.value = menuRows.value[sn]!.path.trim()
  }
  const root = effectiveSourceRoot()
  if (!rel || !isVideoName(rel)) {
    videoLoadErr.value = 'Indique um ficheiro de vídeo válido.'
    return
  }
  if (!root) {
    videoLoadErr.value =
      menuRows.value.length === 0
        ? 'Aguarde o carregamento das bibliotecas…'
        : 'Escolha uma biblioteca ou indique a pasta de origem.'
    return
  }
  if (!sourceRoot.value.trim()) sourceRoot.value = root
  fileRel.value = rel
  markedSegments.value = []
  splitPoints.value = []
  markInTime.value = null
  markOutTime.value = null
  duration.value = 0
  currentTime.value = 0
  if (videoWrapRef.value) {
    videoWrapRef.value.style.aspectRatio = ''
    videoWrapRef.value.style.width = ''
  }
  try {
    // Cache-buster leve: evita reutilizar resposta Range de 1 byte na cache HTTP.
    const base = editorVideoUrl(root, rel)
    const sep = base.includes('?') ? '&' : '?'
    videoSrc.value = `${base}${sep}_=${Date.now()}`
  } catch (e: unknown) {
    videoSrc.value = ''
    videoLoadErr.value = e instanceof Error ? e.message : 'Pasta de origem inválida.'
  }
}

function onVideoLoaded() {
  const v = videoRef.value
  if (!v) return
  duration.value = Number.isFinite(v.duration) ? v.duration : 0
  videoLoadErr.value = ''
  const wrap = videoWrapRef.value
  if (wrap && v.videoWidth > 0 && v.videoHeight > 0) {
    wrap.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`
    wrap.style.width = `min(100%, calc((100dvh - 11.5rem) * ${v.videoWidth} / ${v.videoHeight}))`
  }
}

async function onVideoError() {
  const src = videoSrc.value
  let detail = ''
  if (src && import.meta.client) {
    const probeErr = await diagnoseEditorVideo(src)
    if (probeErr) {
      detail = ` ${probeErr}`
    } else {
      // API OK (bytes chegaram) — falha no decode do browser.
      const code = videoRef.value?.error?.code
      if (code === 3) {
        detail =
          ' O ficheiro chegou do servidor, mas o H.264 está corrupto (falha ao descodificar). Re-descarregue ou repare o MP4.'
      } else if (code === 4) {
        detail =
          ' O ficheiro chegou do servidor, mas o browser não consegue lê-lo (bitstream/codec inválido). Re-descarregue ou repare o MP4.'
      } else if (code === 2) {
        detail = ' Falha de rede ao obter o stream.'
      } else {
        detail =
          ' O ficheiro chegou do servidor, mas o player falhou ao abrir (provavelmente MP4 corrupto).'
      }
    }
  } else {
    const code = videoRef.value?.error?.code
    if (code === 4) detail = ' Formato/codec não suportado pelo browser.'
    else if (code === 2) detail = ' Falha de rede ao obter o stream.'
  }
  videoLoadErr.value = `Não foi possível reproduzir o vídeo.${detail}`
  duration.value = 0
}

function onTimeUpdate() {
  const v = videoRef.value
  if (!v) return
  currentTime.value = v.currentTime
}

function seekTo(sec: number) {
  const v = videoRef.value
  if (!v) return
  v.currentTime = Math.max(0, Math.min(sec, duration.value || sec))
}

function seekRelative(delta: number) {
  seekTo(currentTime.value + delta)
}

function onTimelineClick(ev: MouseEvent) {
  const el = ev.currentTarget as HTMLElement
  const track = el.querySelector('.editor-timeline-track') as HTMLElement | null
  if (!track || !duration.value) return
  const rect = track.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
  seekTo(pct * duration.value)
}

function markIn() {
  markInTime.value = currentTime.value
  if (markOutTime.value != null && markOutTime.value <= markInTime.value) {
    markOutTime.value = null
  }
}

function markOut() {
  if (markInTime.value == null) {
    markInTime.value = 0
  }
  markOutTime.value = currentTime.value
  if (markOutTime.value < markInTime.value) {
    const tmp = markInTime.value
    markInTime.value = markOutTime.value
    markOutTime.value = tmp
  }
}

function addMarked(mode: EditorMarkMode) {
  if (!canAddMark.value || markInTime.value == null || markOutTime.value == null) return
  const start = Math.max(0, markInTime.value)
  const end = Math.min(duration.value || markOutTime.value, markOutTime.value)
  if (end - start < 0.1) return

  markedSegments.value.push({
    id: `${mode}-${start}-${end}-${Date.now()}-${Math.random()}`,
    start,
    end,
    mode,
  })
  markedSegments.value.sort((a, b) => a.start - b.start)
  markInTime.value = currentTime.value
  markOutTime.value = null
  validateMsg.value = ''
}

function clearAllMarks() {
  markedSegments.value = []
  markInTime.value = null
  markOutTime.value = null
  validateMsg.value = ''
}

function addSplitPoint() {
  if (!duration.value) return
  const t = currentTime.value
  const before = splitTimes.value.length
  const next = normalizeSplitTimes([...splitTimes.value, t], duration.value)
  if (next.length <= before) {
    validateMsg.value = 'Split inválido — muito perto do início, do fim ou de outro split.'
    validateOk.value = false
    return
  }
  splitPoints.value = next.map((time) => {
    const found = splitPoints.value.find((s) => Math.abs(s.time - time) < 0.02)
    return found ?? { id: `split-${time}-${Date.now()}-${Math.random()}`, time }
  })
  validateMsg.value = ''
}

function removeSplitPoint(id: string) {
  splitPoints.value = splitPoints.value.filter((s) => s.id !== id)
  validateMsg.value = ''
}

function clearSplitPoints() {
  splitPoints.value = []
  validateMsg.value = ''
}

function removeMarked(id: string) {
  markedSegments.value = markedSegments.value.filter((s) => s.id !== id)
  validateMsg.value = ''
}

async function loadMenu() {
  loadError.value = ''
  try {
    const data = await $fetch<{
      serverPlatform: string
      items: MenuRow[]
    }>('/api/editor/menu')
    serverPlatform.value = data.serverPlatform ?? ''
    menuRows.value = Array.isArray(data.items) ? data.items : []
    if (!sourceRoot.value.trim() && menuRows.value[0] && !route.query.session) {
      sourceSession.value = '0'
      sourceRoot.value = menuRows.value[0]!.path.trim()
    }
    await applyRoutePrefill()
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    loadError.value = ex?.data?.statusMessage || ex?.message || 'Falha ao carregar menu.'
  }
}

function markedForMode(mode: EditorMarkMode) {
  return mergeSegments(
    markedSegments.value
      .filter((s) => s.mode === mode)
      .map((s) => ({ start: s.start, end: s.end })),
  )
}

function exportBody(mode?: EditorMarkMode) {
  const session = resolvedSessionIndex()
  return {
    sourceRoot: effectiveSourceRoot(),
    file: normalizeRel(fileRel.value),
    editMode: mode ?? 'exclude',
    splitPoints: splitTimes.value,
    excludeSegments: markedForMode('exclude'),
    keepMarkedSegments: markedForMode('keep'),
    duration: duration.value > 0 ? duration.value : undefined,
    height: height.value,
    speed: speed.value,
    force: force.value,
    useVideo: useVideo.value && !splitPoints.value.length,
    ...(session != null ? { session } : {}),
  }
}

function exportBodySingle(mode: EditorMarkMode) {
  return {
    ...exportBody(mode),
    splitPoints: [],
  }
}

async function validateExportSplit() {
  validateMsg.value = ''
  validateOk.value = false
  if (!canExportSplit.value) return
  validating.value = true
  try {
    const data = await $fetch<{ partCount: number; chunkPlans: { label: string }[] }>(
      '/api/admin/editor-validate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: exportBody(),
      },
    )
    validateOk.value = true
    const labels = data.chunkPlans.map((p) => p.label).join(', ')
    validateMsg.value = `OK — ${data.partCount} parte(s): ${labels}`
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    validateMsg.value = ex?.data?.statusMessage || ex?.message || 'Validação falhou.'
  } finally {
    validating.value = false
  }
}

async function startExportSplit() {
  if (!canExportSplit.value) return
  startErr.value = ''
  jobErr.value = ''
  try {
    const data = await $fetch<{ jobId: string }>('/api/admin/editor-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: exportBody(),
    })
    rememberJobId(data.jobId)
    openStreamForJob(data.jobId)
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    startErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao iniciar exportação.'
  }
}

async function validateExport(mode: EditorMarkMode) {
  validateMsg.value = ''
  validateOk.value = false
  const can = mode === 'exclude' ? canExportExclude.value : canExportKeep.value
  if (!can) return
  validating.value = true
  try {
    const data = await $fetch<{ keepCount: number; markedCount: number; editMode: EditorMarkMode }>(
      '/api/admin/editor-validate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: exportBodySingle(mode),
      },
    )
    validateOk.value = true
    const modeLabel = data.editMode === 'keep' ? 'recorte' : 'exclusão'
    validateMsg.value = `OK (${modeLabel}) — ${data.markedCount} marcação(ões), ${data.keepCount} trecho(s) a exportar.`
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    validateMsg.value = ex?.data?.statusMessage || ex?.message || 'Validação falhou.'
  } finally {
    validating.value = false
  }
}

function closeStream() {
  if (eventSource) {
    try {
      eventSource.close()
    } catch {
      /* */
    }
    eventSource = null
  }
}

function rememberJobId(id: string | null) {
  if (!import.meta.client) return
  try {
    if (id) sessionStorage.setItem(EDITOR_JOB_STORAGE_KEY, id)
    else sessionStorage.removeItem(EDITOR_JOB_STORAGE_KEY)
  } catch {
    /* */
  }
}

async function scrollTailToBottom() {
  if (!autoScrollTail.value) return
  await nextTick()
  const el = tailRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function onTailScroll(ev: Event) {
  const el = ev.currentTarget as HTMLPreElement
  if (!el) return
  autoScrollTail.value = el.scrollHeight - (el.scrollTop + el.clientHeight) < 16
}

function pruneLinesIfNeeded(snap: JobSnapshot) {
  if (snap.lines.length > VISIBLE_LINES_CAP) {
    snap.lines.splice(0, snap.lines.length - VISIBLE_LINES_CAP)
  }
}

function openStreamForJob(jobId: string) {
  closeStream()
  const url = `/api/admin/editor-stream?jobId=${encodeURIComponent(jobId)}`
  let es: EventSource
  try {
    es = new EventSource(url)
  } catch (e) {
    jobErr.value = e instanceof Error ? e.message : String(e)
    return
  }
  eventSource = es

  es.addEventListener('snapshot', (ev) => {
    try {
      job.value = JSON.parse((ev as MessageEvent).data) as JobSnapshot
      void scrollTailToBottom()
    } catch {
      /* */
    }
  })
  es.addEventListener('line', (ev) => {
    if (!job.value) return
    try {
      const line = JSON.parse((ev as MessageEvent).data) as JobLine
      if (job.value.lines.some((l) => l.seq === line.seq)) return
      job.value.lines.push(line)
      job.value.totalLines = Math.max(job.value.totalLines, line.seq)
      pruneLinesIfNeeded(job.value)
      void scrollTailToBottom()
    } catch {
      /* */
    }
  })
  es.addEventListener('status', (ev) => {
    if (!job.value) return
    try {
      const data = JSON.parse((ev as MessageEvent).data) as { status: JobStatus }
      job.value.status = data.status
    } catch {
      /* */
    }
  })
  es.addEventListener('end', (ev) => {
    try {
      job.value = JSON.parse((ev as MessageEvent).data) as JobSnapshot
      void scrollTailToBottom()
      if (job.value?.status === 'done' && job.value.newFileRel) {
        fileRel.value = job.value.newFileRel
        void loadVideo()
      }
    } catch {
      /* */
    }
    closeStream()
  })
  es.onerror = () => {
    if (job.value?.status !== 'running') closeStream()
  }
}

async function bootstrapJob() {
  try {
    const data = await $fetch<{ editorRunningJob: JobSnapshot | null }>('/api/admin/editor-status')
    const running = data.editorRunningJob
    if (running) {
      rememberJobId(running.id)
      openStreamForJob(running.id)
      return
    }
    const stored = sessionStorage.getItem(EDITOR_JOB_STORAGE_KEY)
    if (stored) {
      const snap = await $fetch<JobSnapshot>(
        `/api/admin/editor-status?jobId=${encodeURIComponent(stored)}`,
      )
      if (snap.status === 'running') openStreamForJob(stored)
      else job.value = snap
    }
  } catch {
    /* */
  }
}

async function startExport(mode: EditorMarkMode) {
  const can = mode === 'exclude' ? canExportExclude.value : canExportKeep.value
  if (!can) return
  startErr.value = ''
  jobErr.value = ''
  try {
    const data = await $fetch<{ jobId: string }>('/api/admin/editor-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: exportBodySingle(mode),
    })
    rememberJobId(data.jobId)
    openStreamForJob(data.jobId)
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    startErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao iniciar exportação.'
  }
}

async function cancelJob() {
  if (!job.value || !jobActive.value) return
  if (!confirm('Cancelar o processamento em curso?')) return
  try {
    await $fetch('/api/admin/editor-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { jobId: job.value.id },
    })
    if (job.value) job.value.cancelRequested = true
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    jobErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao cancelar.'
  }
}

function clearJobView() {
  closeStream()
  job.value = null
  jobErr.value = ''
  rememberJobId(null)
}

function statusLabel(s: JobStatus): string {
  if (s === 'running') return 'A correr'
  if (s === 'done') return 'Concluído'
  if (s === 'failed') return 'Falhou'
  return 'Cancelado'
}

function lineCssClass(line: JobLine): string {
  const t = line.text.trimStart()
  if (t.startsWith('[OVERSIZED]')) return 'tail-line tail-line--warn'
  if (line.stream === 'stderr') {
    if (t.startsWith('[AVISO]')) return 'tail-line tail-line--warn'
    return 'tail-line tail-line--err'
  }
  if (line.stream === 'meta') return 'tail-line tail-line--meta'
  if (t.startsWith('[OK]')) return 'tail-line tail-line--ok'
  if (t.startsWith('[ERRO]')) return 'tail-line tail-line--err'
  if (t.startsWith('[AVISO]')) return 'tail-line tail-line--meta'
  if (t.startsWith('[META]')) return 'tail-line tail-line--proc'
  return 'tail-line'
}

function onKeyDown(ev: KeyboardEvent) {
  if (!videoSrc.value) return
  const tag = (ev.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (ev.key === 'i' || ev.key === 'I') {
    ev.preventDefault()
    markIn()
  } else if (ev.key === 'o' || ev.key === 'O') {
    ev.preventDefault()
    markOut()
  } else if (ev.key === 'p' || ev.key === 'P') {
    ev.preventDefault()
    addSplitPoint()
  } else if (ev.key === 'Enter' && canAddMark.value) {
    ev.preventDefault()
    addMarked(activeMarkMode.value)
  }
}

onMounted(() => {
  if (!import.meta.client) return
  readRouteVideoQuery()
  window.addEventListener('keydown', onKeyDown)
  // Só carrega o vídeo depois do menu (senão session sem sourceRoot ia para /api/video → 401).
  void loadMenu().then(() => bootstrapJob())
})

watch(
  () => [route.query.session, route.query.file, route.query.useVideo],
  () => {
    if (!menuRows.value.length) return
    readRouteVideoQuery()
    if (canLoadVideo.value) {
      void applyRoutePrefill()
    }
  },
)

onUnmounted(() => {
  closeStream()
  if (import.meta.client) window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.admin-page {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  max-width: none;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0.85rem 1.1rem 1.75rem;
  background: #0c0d10;
  color: #e8eaed;
  font-family: system-ui, sans-serif;
}

.admin-page--with-video {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100dvh;
  overflow: hidden;
  padding: 0.45rem 0.75rem 0.65rem;
}

.admin-page--with-video .admin-head {
  flex-shrink: 0;
  margin-bottom: 0.3rem;
}

.admin-page--with-video .admin-title {
  font-size: 1.1rem;
}

.admin-page--with-video .admin-card--compact {
  flex-shrink: 0;
  margin-bottom: 0.4rem;
}

.admin-page--with-video .editor-workspace {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.admin-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}

.admin-head-links {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.admin-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 650;
}

.admin-back {
  color: #8ab4f8;
  text-decoration: none;
  font-size: 0.9rem;
}

.admin-back:hover {
  text-decoration: underline;
}

.admin-lead {
  max-width: 52rem;
  line-height: 1.45;
  color: #bdc1c6;
  margin: 0 0 1rem;
}

.admin-code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.88em;
  background: #1a1d24;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

.admin-warn {
  background: color-mix(in srgb, #d97a2a 18%, transparent);
  border: 1px solid color-mix(in srgb, #d97a2a 45%, transparent);
  border-radius: 8px;
  padding: 0.55rem 0.75rem;
  margin-bottom: 1rem;
  color: #ffd9b8;
}

.admin-card {
  background: #15171c;
  border: 1px solid #2d333b;
  border-radius: 10px;
  padding: 1rem 1.1rem;
  margin-bottom: 1rem;
  max-width: none;
  width: 100%;
  box-sizing: border-box;
}

.admin-card--narrow {
  max-width: 56rem;
}

.admin-card--compact {
  padding: 0.65rem 0.85rem;
  margin-bottom: 0.65rem;
}

.admin-card--compact .admin-h2 {
  margin-bottom: 0.35rem;
  font-size: 0.95rem;
}

.editor-workspace {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: none;
}

.admin-h2 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}

.admin-muted {
  color: #9aa0a6;
  font-size: 0.88rem;
  margin: 0 0 0.65rem;
}

.admin-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.35rem;
}

.admin-input {
  background: #0c0d10;
  border: 1px solid #3d444d;
  color: #e8eaed;
  border-radius: 6px;
  padding: 0.4rem 0.55rem;
  font-size: 0.9rem;
}

.admin-input--wide {
  min-width: min(100%, 22rem);
  flex: 1;
}

.admin-input--full {
  width: 100%;
  margin-top: 0.5rem;
  box-sizing: border-box;
}

.admin-btn {
  background: #2d333b;
  border: 1px solid #444c56;
  color: #e8eaed;
  border-radius: 6px;
  padding: 0.38rem 0.75rem;
  cursor: pointer;
  font-size: 0.88rem;
}

.admin-btn:hover:not(:disabled) {
  background: #373e47;
}

.admin-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.admin-btn--primary {
  background: #238636;
  border-color: #2ea043;
}

.admin-btn--ghost {
  background: transparent;
}

.admin-btn--danger {
  background: color-mix(in srgb, #da3633 35%, #2d333b);
  border-color: #da3633;
}

.admin-btn--sm {
  padding: 0.22rem 0.45rem;
  font-size: 0.78rem;
}

.admin-err {
  color: #f8b4b0;
  font-size: 0.88rem;
  margin: 0.5rem 0 0;
}

.admin-ok {
  color: #7ee787;
  font-size: 0.88rem;
  margin: 0.5rem 0 0;
}

.admin-check-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.88rem;
}

.editor-source-path {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.82rem;
}

.editor-file-row {
  margin-top: 0.65rem;
}

.drop-zone {
  border: 2px dashed #3d444d;
  border-radius: 10px;
  padding: 1.25rem 1rem;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
  margin-top: 0.65rem;
}

.drop-zone--active {
  border-color: #8ab4f8;
  background: color-mix(in srgb, #8ab4f8 8%, transparent);
}

.drop-zone-title {
  margin: 0 0 0.35rem;
  font-weight: 600;
}

.drop-zone-hint {
  margin-bottom: 0.75rem;
}

.drop-zone-actions {
  justify-content: center;
}

.editor-mark-help {
  margin: 0 0 0.75rem;
  font-size: 0.84rem;
}

.editor-mark-help strong {
  color: #e8eaed;
}

.editor-workspace {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
}

.editor-player-card {
  max-width: none;
  margin-bottom: 0;
}

.admin-page--with-video .editor-player-card {
  flex: 0 0 auto;
  padding: 0.55rem 0.7rem 0.7rem;
}

.editor-player-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 1rem;
  margin-bottom: 0.4rem;
}

.admin-page--with-video .editor-player-head {
  margin-bottom: 0.3rem;
}

.editor-player-head .admin-h2 {
  margin: 0;
}

.editor-player-head .editor-file-label {
  margin: 0;
}

.editor-file-label {
  word-break: break-all;
  font-family: ui-monospace, Consolas, monospace;
}

.editor-stage {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: 100%;
}

.editor-video-wrap {
  position: relative;
  width: min(100%, calc((100dvh - 11.5rem) * 16 / 9));
  max-width: 100%;
  aspect-ratio: 16 / 9;
  margin-inline: auto;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.editor-video {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.editor-controls {
  flex: 0 0 auto;
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  border: 1px solid #2d333b;
  background: #12151a;
}

.editor-controls .editor-mark-help {
  margin-bottom: 0;
}

.editor-time-row {
  display: flex;
  gap: 0.35rem;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.88rem;
  margin-bottom: 0.5rem;
}

.editor-time-current {
  color: #8ab4f8;
}

.editor-time-sep,
.editor-time-duration {
  color: #9aa0a6;
}

.editor-timeline {
  position: relative;
  height: 2.25rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
  outline: none;
}

.editor-timeline:focus-visible .editor-timeline-track {
  box-shadow: 0 0 0 2px #8ab4f8;
}

.editor-timeline-track {
  position: relative;
  height: 100%;
  background: #2d333b;
  border-radius: 6px;
  overflow: hidden;
}

.editor-timeline-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1;
}

.editor-timeline-mark--exclude {
  background: color-mix(in srgb, #da3633 55%, transparent);
  border-left: 1px solid #da3633;
  border-right: 1px solid #da3633;
}

.editor-timeline-mark--keep {
  background: color-mix(in srgb, #3fb950 55%, transparent);
  border-left: 1px solid #3fb950;
  border-right: 1px solid #3fb950;
}

.editor-timeline-pending {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}

.editor-timeline-pending--exclude {
  background: color-mix(in srgb, #fdd663 45%, transparent);
  border: 1px dashed #da3633;
}

.editor-timeline-pending--keep {
  background: color-mix(in srgb, #3fb950 35%, transparent);
  border: 1px dashed #3fb950;
}

.editor-timeline-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: #8ab4f8;
  pointer-events: none;
  z-index: 2;
}

.editor-timeline-chunk {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 0;
}

.editor-timeline-chunk--a {
  background: color-mix(in srgb, #58a6ff 18%, transparent);
}

.editor-timeline-chunk--b {
  background: color-mix(in srgb, #3fb950 16%, transparent);
}

.editor-timeline-split {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  margin-left: -1.5px;
  background: #58a6ff;
  box-shadow: 0 0 6px color-mix(in srgb, #58a6ff 60%, transparent);
  pointer-events: none;
  z-index: 3;
}

.editor-split-section {
  margin: 1rem 0 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #2d333b;
}

.editor-btn-split {
  border-color: #58a6ff;
  color: #8ab4f8;
}

.editor-btn-split-export {
  background: color-mix(in srgb, #58a6ff 25%, #238636);
  border-color: #58a6ff;
}

.editor-split-list {
  list-style: none;
  padding: 0;
  margin: 0 0 0.75rem;
}

.editor-split-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid #2d333b;
}

.editor-split-time {
  background: none;
  border: none;
  color: #8ab4f8;
  cursor: pointer;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.85rem;
  padding: 0;
}

.editor-split-time:hover {
  text-decoration: underline;
}

.editor-chunks-preview {
  background: color-mix(in srgb, #58a6ff 6%, transparent);
  border: 1px solid color-mix(in srgb, #58a6ff 25%, #2d333b);
  border-radius: 8px;
  padding: 0.65rem 0.75rem;
}

.editor-chunks-title {
  margin: 0 0 0.45rem;
  font-size: 0.88rem;
  color: #8ab4f8;
}

.editor-chunks-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.editor-chunk-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  padding: 0.3rem 0;
  font-size: 0.82rem;
  border-top: 1px solid color-mix(in srgb, #58a6ff 15%, transparent);
}

.editor-chunk-row:first-child {
  border-top: none;
}

.editor-chunk-label {
  font-weight: 650;
  color: #58a6ff;
  font-family: ui-monospace, Consolas, monospace;
  min-width: 2rem;
}

.editor-chunk-range {
  font-family: ui-monospace, Consolas, monospace;
  color: #e8eaed;
}

.editor-chunk-meta {
  color: #9aa0a6;
}

.editor-mark-row {
  margin-bottom: 0.75rem;
}

.editor-mode-toggle {
  display: inline-flex;
  margin-bottom: 0.65rem;
  border: 1px solid #3d444d;
  border-radius: 6px;
  overflow: hidden;
}

.editor-mode-btn {
  padding: 0.35rem 0.85rem;
  font-size: 0.85rem;
  border: none;
  background: #21262d;
  color: #9aa0a6;
  cursor: pointer;
}

.editor-mode-btn + .editor-mode-btn {
  border-left: 1px solid #3d444d;
}

.editor-mode-btn--active.editor-mode-btn:first-child {
  background: color-mix(in srgb, #da3633 25%, #21262d);
  color: #f85149;
}

.editor-mode-btn--active.editor-mode-btn:last-child {
  background: color-mix(in srgb, #3fb950 25%, #21262d);
  color: #3fb950;
}

.editor-export-actions {
  margin-bottom: 0.5rem;
}

.admin-btn--success {
  background: #238636;
  border-color: #2ea043;
  color: #fff;
}

.admin-btn--success:hover:not(:disabled) {
  background: #3fb950;
}

.editor-segment-badge {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
}

.editor-segment-badge--exclude {
  background: color-mix(in srgb, #da3633 30%, transparent);
  color: #f85149;
}

.editor-segment-badge--keep {
  background: color-mix(in srgb, #3fb950 30%, transparent);
  color: #3fb950;
}

.editor-mark-hint {
  font-size: 0.82rem;
  color: #9aa0a6;
  font-family: ui-monospace, Consolas, monospace;
}

.editor-h3 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}

.editor-segment-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.editor-segment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid #2d333b;
}

.editor-segment-range {
  background: none;
  border: none;
  color: #f8b4b0;
  cursor: pointer;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.85rem;
  text-align: left;
  padding: 0;
}

.editor-segment-range:hover {
  text-decoration: underline;
}

.editor-segment-dur {
  color: #9aa0a6;
}

.editor-keep-summary {
  margin-top: 0.65rem;
}

.editor-options {
  align-items: flex-end;
  margin-bottom: 0.75rem;
}

.editor-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.editor-label {
  font-size: 0.78rem;
  color: #9aa0a6;
}

.editor-num {
  width: 6rem;
}

.editor-force {
  margin-left: 0.25rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.job-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.job-head-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.job-status {
  font-size: 0.85rem;
  font-weight: 600;
}

.job-status--running {
  color: #8ab4f8;
}

.job-status--done {
  color: #7ee787;
}

.job-status--failed,
.job-status--cancelled {
  color: #f8b4b0;
}

.job-tail-details {
  margin-top: 0.5rem;
}

.job-tail-summary {
  cursor: pointer;
  font-size: 0.9rem;
  margin-bottom: 0.35rem;
}

.job-tail-autoscroll {
  margin-left: 0.75rem;
  font-size: 0.78rem;
  font-weight: normal;
  color: #9aa0a6;
}

.admin-pre {
  background: #0c0d10;
  border: 1px solid #2d333b;
  border-radius: 8px;
  padding: 0.65rem;
  max-height: min(50vh, 420px);
  overflow: auto;
  font-size: 0.75rem;
  line-height: 1.35;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.tail-line--ok {
  color: #7ee787;
}

.tail-line--err {
  color: #f8b4b0;
}

.tail-line--proc {
  color: #fdd663;
}

.tail-line--meta {
  color: #9aa0a6;
}

.tail-line--warn {
  color: #e3b341;
}

.editor-oversized {
  margin: 0.75rem 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid color-mix(in srgb, #d29922 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, #d29922 10%, transparent);
}

.editor-oversized-title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  color: #e3b341;
}

.editor-oversized-hint {
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
}

.editor-oversized-msg {
  margin: 0;
  font-size: 0.85rem;
  color: #d29922;
  font-family: ui-monospace, Consolas, monospace;
}
</style>
