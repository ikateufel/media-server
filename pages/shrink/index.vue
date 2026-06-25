<template>
  <div class="admin-page">
    <header class="admin-head">
      <h1 class="admin-title">Shrink de vídeos</h1>
      <div class="admin-head-links">
        <NuxtLink to="/" class="admin-back">← Reprodutor</NuxtLink>
        <NuxtLink to="/admin" class="admin-back">Admin</NuxtLink>
        <NuxtLink to="/editor" class="admin-back">Editor</NuxtLink>
      </div>
    </header>

    <p class="admin-lead">
      Encurta vídeos completos com <code class="admin-code">shrink_video.bat</code> — saída em
      <code class="admin-code">shrinked\</code> na pasta de origem de cada ficheiro. Arraste ficheiros
      ou escolha-os; indique a pasta de origem no servidor (caminho absoluto).
    </p>

    <p v-if="!isWinServer" class="admin-warn" role="status">
      O servidor está em <strong>{{ serverPlatform }}</strong> — o shrink só funciona com Node em Windows.
    </p>

    <section class="admin-card">
      <h2 class="admin-h2">Token</h2>
      <div class="admin-row">
        <input
          v-model="token"
          type="password"
          class="admin-input admin-input--wide"
          autocomplete="current-password"
          placeholder="VIDEO_ADMIN_TOKEN"
        />
        <button type="button" class="admin-btn" @click="persistToken">Guardar</button>
        <button type="button" class="admin-btn admin-btn--ghost" @click="loadMenu">Carregar bibliotecas</button>
      </div>
      <p v-if="loadError" class="admin-err">{{ loadError }}</p>
    </section>

    <section class="admin-card">
      <h2 class="admin-h2">Pasta de origem</h2>
      <p class="admin-muted">
        Escolha uma biblioteca no menu ou escreva qualquer caminho de pasta existente. Os nomes da fila
        são relativos a essa pasta — use só o nome do ficheiro se os vídeos estiverem na raiz.
      </p>
      <div class="admin-row">
        <select v-model="sourceSession" class="admin-input admin-input--wide" @change="onSourceSessionChange">
          <option value="">— escolher biblioteca —</option>
          <option v-for="(row, i) in menuRows" :key="i" :value="String(i)">
            [{{ i }}] {{ row.title || row.path }}
          </option>
        </select>
      </div>
      <input
        v-model="sourceRoot"
        type="text"
        class="admin-input admin-input--full shrink-source-path"
        spellcheck="false"
        placeholder="H:\videos\biblioteca"
      />
      <div class="admin-row shrink-list-actions">
        <button
          type="button"
          class="admin-btn"
          :disabled="listLoading"
          @click="loadReprocessList"
        >
          Carregar lista
        </button>
      </div>
      <p class="admin-muted shrink-list-hint">
        <strong>Guardar fila</strong> abre o diálogo do sistema para gravar a fila onde quiser
        (pasta + nomes em <code class="admin-code">.txt</code>).
        <strong>Carregar lista</strong> abre o diálogo para escolher esse ficheiro
        (compare / multipass com <code class="admin-code">2|</code> / <code class="admin-code">3|</code>, ou fila guardada).
      </p>
      <p v-if="listMsg" :class="listMsgOk ? 'admin-ok' : 'admin-err'">{{ listMsg }}</p>
    </section>

    <section class="admin-card">
      <h2 class="admin-h2">Fila</h2>
      <div
        class="drop-zone"
        :class="{ 'drop-zone--active': dropActive }"
        @dragenter.prevent="dropActive = true"
        @dragover.prevent="dropActive = true"
        @dragleave.prevent="dropActive = false"
        @drop.prevent="onDrop"
      >
        <p class="drop-zone-title">Arraste vídeos para aqui</p>
        <p class="admin-muted drop-zone-hint">
          {{ VIDEO_EXT_LABEL }}. Para muitos ficheiros em subpastas, use
          <strong>«Escolher pasta»</strong> — arrastar ficheiros soltos só envia o <em>nome</em>, não o caminho;
          nomes iguais em pastas diferentes contam como duplicado.
        </p>
        <div class="admin-row drop-zone-actions">
          <button type="button" class="admin-btn" @click="pickFiles">Escolher ficheiros</button>
          <button type="button" class="admin-btn admin-btn--ghost" @click="pickFolder">Escolher pasta</button>
          <button
            type="button"
            class="admin-btn admin-btn--ghost"
            :disabled="!canSaveQueue || saveQueueLoading"
            @click="saveQueueList"
          >
            Guardar fila
          </button>
          <button type="button" class="admin-btn admin-btn--ghost" :disabled="!queue.length" @click="clearQueue">
            Limpar fila
          </button>
        </div>
        <input ref="fileInputRef" type="file" multiple :accept="VIDEO_FILE_INPUT_ACCEPT" class="sr-only" @change="onFileInput" />
        <input
          ref="queueListFileInputRef"
          type="file"
          accept=".txt,text/plain"
          class="sr-only"
          @change="onQueueListFileInput"
        />
        <input ref="folderInputRef" type="file" multiple webkitdirectory class="sr-only" @change="onFolderInput" />
      </div>

      <p v-if="importMsg" class="import-summary" role="status">{{ importMsg }}</p>
      <details v-if="importSkippedExt.length || importSkippedDup.length || importSkippedSmall.length" class="import-skipped-details">
        <summary class="import-skipped-summary">
          Ver {{ importSkippedExt.length + importSkippedDup.length + importSkippedSmall.length }} ignorado(s)
        </summary>
        <ul v-if="importSkippedExt.length" class="import-skipped-list">
          <li v-for="name in importSkippedExt" :key="`ext:${name}`" class="import-skipped-item">
            <span class="import-skipped-tag">extensão</span> {{ name }}
          </li>
        </ul>
        <ul v-if="importSkippedDup.length" class="import-skipped-list">
          <li v-for="name in importSkippedDup" :key="`dup:${name}`" class="import-skipped-item">
            <span class="import-skipped-tag">duplicado</span> {{ name }}
          </li>
        </ul>
        <ul v-if="importSkippedSmall.length" class="import-skipped-list">
          <li v-for="name in importSkippedSmall" :key="`small:${name}`" class="import-skipped-item">
            <span class="import-skipped-tag">&lt; {{ minSizeMb }} MB</span> {{ name }}
          </li>
        </ul>
      </details>

      <ul v-if="queue.length" class="queue-list">
        <li
          v-for="item in queue"
          :key="item.id"
          class="queue-item"
          :class="queueItemClass(item.rel)"
        >
          <span
            class="queue-rel"
            :class="queueRelClass(item.rel)"
            :title="queueItemTitle(item.rel)"
          >{{ item.rel }}</span>
          <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" @click="removeQueueItem(item.id)">
            Remover
          </button>
        </li>
      </ul>
      <p v-else class="admin-muted">Nenhum ficheiro na fila.</p>

      <div v-if="failedItems.length" class="queue-errors" role="alert">
        <h3 class="queue-errors-title">{{ failedItems.length }} ficheiro{{ failedItems.length === 1 ? '' : 's' }} com erro</h3>
        <ul class="queue-errors-list">
          <li v-for="f in failedItems" :key="f.rel" class="queue-errors-item">
            <span class="queue-errors-rel" :title="f.rel">{{ f.rel }}</span>
            <span class="queue-errors-msg">{{ f.message }}</span>
          </li>
        </ul>
      </div>

      <div v-if="oversizedItems.length" class="queue-oversized" role="status">
        <h3 class="queue-oversized-title">
          {{ oversizedItems.length }} ficheiro{{ oversizedItems.length === 1 ? '' : 's' }} com saída maior que a origem
        </h3>
        <p class="admin-muted queue-oversized-hint">
          Listas para rever depois em
          <code class="admin-code">data\shrink-oversized-paths.txt</code> (caminhos),
          <code class="admin-code">data\shrink-oversized-rels.txt</code> (nomes para fila) e
          <code class="admin-code">data\shrink-oversized-todo.txt</code> (detalhe).
          Log completo: <code class="admin-code">data\shrink-oversized.log</code>.
        </p>
        <ul class="queue-oversized-list">
          <li v-for="f in oversizedItems" :key="f.rel" class="queue-oversized-item">
            <span class="queue-oversized-rel" :title="f.rel">{{ f.rel }}</span>
            <span class="queue-oversized-msg">{{ f.message }}</span>
          </li>
        </ul>
      </div>

      <p v-if="validateMsg" :class="validateOk ? 'admin-ok' : 'admin-err'">{{ validateMsg }}</p>
    </section>

    <section class="admin-card">
      <h2 class="admin-h2">Opções do vídeo final</h2>
      <div class="admin-row shrink-options">
        <label class="shrink-field">
          <span class="shrink-label">Ignorar &lt; (MB)</span>
          <input
            v-model.number="minSizeMb"
            type="number"
            min="0"
            step="1"
            class="admin-input shrink-num"
            title="0 = processar todos os ficheiros da fila"
          />
        </label>
        <label class="shrink-field">
          <span class="shrink-label">Altura máx. (px)</span>
          <input v-model.number="height" type="number" min="144" max="4320" step="1" class="admin-input shrink-num" />
        </label>
        <label class="shrink-field">
          <span class="shrink-label">Velocidade</span>
          <select v-model="speed" class="admin-input">
            <option :value="1.25">1.25×</option>
            <option :value="1.5">1.5×</option>
            <option :value="2">2×</option>
          </select>
        </label>
        <label class="shrink-field shrink-field--codec">
          <span class="shrink-label">Codec de vídeo</span>
          <select v-model="codec" class="admin-input">
            <option value="h264_nvenc">H.264 NVENC (GPU, predefinido)</option>
            <option value="hevc_nvenc">HEVC NVENC (GPU, ficheiros menores)</option>
            <option value="auto">Automático (GPU — mesma família do original)</option>
            <option value="libx264">H.264 libx264 (CPU, lento)</option>
            <option value="libx265">HEVC libx265 (CPU, muito lento)</option>
          </select>
        </label>
        <label class="admin-check-label shrink-prioritize">
          <input v-model="prioritizeSize" type="checkbox" />
          Priorizar tamanho (2.ª passagem se &lt;30% redução; 3.ª se ainda &gt; origem)
        </label>
        <label class="admin-check-label shrink-force">
          <input v-model="force" type="checkbox" />
          Substituir se já existir em shrinked\ (--force)
        </label>
      </div>
      <p class="admin-muted shrink-codec-hint">
        <strong>Ignorar &lt; (MB)</strong>: ficheiros menores que este valor são ignorados na validação e no
        processamento. Use <strong>0</strong> para incluir todos. Ao escolher pasta/ficheiros, os pequenos nem
        entram na fila (quando o browser envia o tamanho).
        <strong>1.ª passagem</strong>: NVENC na GPU (preset p2) + decode CUDA quando disponível.
        <strong>Validar no servidor</strong> também verifica o codec (H.264/HEVC OK; VP9/AV1/ProRes etc. são ignorados).
        Scale/áudio ainda usam CPU — no Task Manager o ffmpeg pode parecer “CPU alto” mesmo com GPU activa.
        Se a saída ficar <strong>&gt;70% do original</strong>, o shrinked é apagado (vê
        <code class="admin-code">[INFO] Encoder</code> e
        <code class="admin-code">[META] cap bitrate</code> no log).
        <strong>Priorizar tamanho</strong>: aí corre <strong>2.ª passagem</strong> (bitrate ~origem) e, se ainda
        &gt; origem, <strong>3.ª passagem</strong> agressiva.
        Durante o job, quem entra na 2.ª/3.ª fase vai para
        <code class="admin-code">data\shrink-phase2-run-rels.txt</code> e
        <code class="admin-code">data\shrink-phase3-run-rels.txt</code>.
      </p>
      <div class="admin-row shrink-actions">
        <button
          type="button"
          class="admin-btn admin-btn--primary"
          :disabled="!canProcess"
          @click="startShrinkJob"
        >
          Processar {{ queue.length }} ficheiro{{ queue.length === 1 ? '' : 's' }}
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--ghost"
          :disabled="!queue.length || validating"
          @click="validateQueue"
        >
          Validar no servidor
        </button>
      </div>
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

      <div v-if="job" class="job-counters">
        <span class="job-counter job-counter--ok"><strong>{{ job.totals.ok }}</strong> OK</span>
        <span class="job-counter"><strong>{{ job.totals.skip }}</strong> ignorados</span>
        <span class="job-counter" :class="{ 'job-counter--err': job.totals.err > 0 }">
          <strong>{{ job.totals.err }}</strong> erro{{ job.totals.err === 1 ? '' : 's' }}
        </span>
        <span v-if="jobActive || job.totalFiles > 0" class="job-counter">
          ficheiro <strong>{{ Math.max(0, job.currentFileIndex) + 1 }}</strong>/{{ job.totalFiles }}
        </span>
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
</template>

<script setup lang="ts">
import {
  formatShrinkListFile,
  parseShrinkListFile,
  SHRINK_LIST_FILE_DEFAULT_NAME,
  SHRINK_LIST_FILE_PICKER_TYPES,
} from '#shared/shrinkListFile'
import {
  isVideoFileName,
  VIDEO_EXT_LABEL,
  VIDEO_FILE_INPUT_ACCEPT,
} from '#shared/videoExtensions'

interface MenuRow {
  path: string
  title: string
}

interface QueueItem {
  id: string
  rel: string
}

type QueueFileState = 'ok' | 'err' | 'skip' | 'running' | 'oversized'

interface QueueFileMeta {
  status: QueueFileState
  message?: string
}

interface OversizedOutputEntry {
  rel: string
  sourceBytes: number
  outputBytes: number
}

interface JobFileResult {
  rel: string
  path?: string
  exitCode: number | null
  okCount: number
  errCount: number
  skipCount: number
  error?: string
  failedItems?: { file: string; message: string }[]
  oversizedOutput?: OversizedOutputEntry
}

type JobStatus = 'running' | 'done' | 'failed' | 'cancelled'

interface JobLine {
  seq: number
  fileIndex: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

type ShrinkCodec = 'auto' | 'h264_nvenc' | 'libx264' | 'hevc_nvenc' | 'libx265'

interface ShrinkReprocessListResponse {
  sourceRoot: string
  files: string[]
  count: number
  empty?: boolean
  message?: string
  phase2Count?: number
  phase3Count?: number
  needsPrioritizeSize?: boolean
  listPath?: string
}

interface JobSnapshot {
  id: string
  status: JobStatus
  sourceRoot: string
  height: number
  speed: number
  codec: ShrinkCodec
  force: boolean
  prioritizeSize?: boolean
  minSizeMb?: number
  totalFiles: number
  currentFileIndex: number
  totals: { ok: number; err: number; skip: number }
  results?: JobFileResult[]
  lines: JobLine[]
  totalLines: number
  cancelRequested: boolean
  startedAt: number
  endedAt: number | null
  oversizedOutputs?: OversizedOutputEntry[]
}

const SHRINK_JOB_STORAGE_KEY = 'video_admin_shrink_job_id'
const VISIBLE_LINES_CAP = 400

const token = ref('')
const menuRows = ref<MenuRow[]>([])
const sourceSession = ref('')
const sourceRoot = ref('')
const loadError = ref('')
const queue = ref<QueueItem[]>([])
const dropActive = ref(false)
const height = ref(1080)
const speed = ref<1.25 | 1.5 | 2>(1.5)
const codec = ref<ShrinkCodec>('h264_nvenc')
const prioritizeSize = ref(false)
const force = ref(false)
const minSizeMb = ref(0)

const validating = ref(false)
const validateMsg = ref('')
const validateOk = ref(false)
const startErr = ref('')
const queueStatus = ref<Record<string, QueueFileMeta>>({})
const importMsg = ref('')
const importSkippedExt = ref<string[]>([])
const importSkippedDup = ref<string[]>([])
const importSkippedSmall = ref<string[]>([])

const listLoading = ref(false)
const saveQueueLoading = ref(false)
const listMsg = ref('')
const listMsgOk = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)
const queueListFileInputRef = ref<HTMLInputElement | null>(null)

const serverPlatform = ref('')
const isWinServer = computed(() => serverPlatform.value === 'win32')

const job = ref<JobSnapshot | null>(null)
const jobErr = ref('')
const jobActive = computed(() => job.value?.status === 'running')
const tailRef = ref<HTMLPreElement | null>(null)
const autoScrollTail = ref(true)
let eventSource: EventSource | null = null

const canProcess = computed(
  () =>
    isWinServer.value &&
    !jobActive.value &&
    !!token.value.trim() &&
    !!sourceRoot.value.trim() &&
    queue.value.length > 0,
)

const canSaveQueue = computed(
  () => !!token.value.trim() && !!sourceRoot.value.trim() && queue.value.length > 0,
)

const failedItems = computed(() => {
  const out: { rel: string; message: string }[] = []
  const seen = new Set<string>()
  for (const item of queue.value) {
    const st = queueItemStatus(item.rel)
    if (st?.status !== 'err') continue
    const key = item.rel.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ rel: item.rel, message: st.message ?? 'Erro' })
  }
  return out
})

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

function oversizedMessage(entry: OversizedOutputEntry): string {
  const pct =
    entry.sourceBytes > 0
      ? Math.round(((entry.outputBytes - entry.sourceBytes) * 100) / entry.sourceBytes)
      : 0
  return `${formatBytes(entry.outputBytes)} vs origem ${formatBytes(entry.sourceBytes)} (+${pct}%)`
}

const oversizedItems = computed(() => {
  const out: { rel: string; message: string }[] = []
  const seen = new Set<string>()
  for (const item of queue.value) {
    const st = queueItemStatus(item.rel)
    if (st?.status !== 'oversized') continue
    const key = item.rel.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ rel: item.rel, message: st.message ?? 'Saída maior que origem' })
  }
  return out
})

function queueStatusKey(rel: string): string {
  return rel.toLowerCase()
}

function pathMatchesQueueRel(filePath: string, rel: string): boolean {
  const normPath = filePath.toLowerCase().replace(/\\/g, '/')
  const normRel = rel.toLowerCase().replace(/\\/g, '/')
  if (!normRel) return false
  return normPath === normRel || normPath.endsWith(`/${normRel}`)
}

function queueItemsForJobFile(rel: string, path?: string): QueueItem[] {
  const relL = rel.toLowerCase()
  const matches = queue.value.filter((q) => {
    const qL = q.rel.toLowerCase()
    if (qL === relL) return true
    if (path && pathMatchesQueueRel(path, q.rel)) return true
    return false
  })
  if (matches.length <= 1) return matches
  const exact = matches.find((q) => q.rel.toLowerCase() === relL)
  return exact ? [exact] : [matches[0]!]
}

function setQueueStatusForJobFile(rel: string, path: string | undefined, meta: QueueFileMeta | null) {
  const items = queueItemsForJobFile(rel, path)
  if (!items.length) {
    setQueueStatus(rel, meta)
    return
  }
  for (const item of items) {
    setQueueStatus(item.rel, meta)
  }
}

function queueItemStatus(rel: string): QueueFileMeta | null {
  return queueStatus.value[queueStatusKey(rel)] ?? null
}

function setQueueStatus(rel: string, meta: QueueFileMeta | null) {
  const key = queueStatusKey(rel)
  if (!meta) {
    const next = { ...queueStatus.value }
    delete next[key]
    queueStatus.value = next
    return
  }
  queueStatus.value = { ...queueStatus.value, [key]: meta }
}

function applyResultStatus(result: JobFileResult) {
  if (result.exitCode === null) {
    setQueueStatusForJobFile(result.rel, result.path, { status: 'running' })
    return
  }
  if (result.oversizedOutput) {
    setQueueStatusForJobFile(result.rel, result.path, {
      status: 'oversized',
      message: oversizedMessage(result.oversizedOutput),
    })
    return
  }
  if (result.skipCount > 0) {
    setQueueStatusForJobFile(result.rel, result.path, {
      status: 'skip',
      message: 'Ignorado (já existe ou skip)',
    })
    return
  }
  if (result.errCount > 0 || (result.exitCode !== 0 && result.okCount === 0)) {
    const msg =
      result.failedItems?.[0]?.message ??
      result.error ??
      (result.exitCode != null ? `Falhou (exit ${result.exitCode})` : 'Erro')
    setQueueStatusForJobFile(result.rel, result.path, { status: 'err', message: msg })
    return
  }
  setQueueStatusForJobFile(result.rel, result.path, { status: 'ok' })
}

function syncQueueStatusFromJob(snap: JobSnapshot) {
  if (!snap.results?.length) return
  for (const r of snap.results) {
    applyResultStatus(r)
  }
}

function queueItemClass(rel: string): string {
  const st = queueItemStatus(rel)
  return st ? `queue-item--${st.status}` : ''
}

function queueRelClass(rel: string): string {
  const st = queueItemStatus(rel)
  if (st?.status === 'err') return 'queue-rel--err'
  if (st?.status === 'oversized') return 'queue-rel--oversized'
  if (st?.status === 'ok') return 'queue-rel--ok'
  if (st?.status === 'skip') return 'queue-rel--skip'
  if (st?.status === 'running') return 'queue-rel--running'
  return ''
}

function queueItemTitle(rel: string): string {
  const st = queueItemStatus(rel)
  if (st?.message) return `${rel}\n${st.message}`
  return rel
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

function minSizeBytes(): number {
  const m = Number(minSizeMb.value)
  if (!Number.isFinite(m) || m <= 0) return 0
  return Math.floor(m * 1024 * 1024)
}

function addToQueue(relRaw: string): 'added' | 'ext' | 'dup' {
  const rel = normalizeRel(relRaw)
  if (!rel || !isVideoName(rel)) return 'ext'
  if (queue.value.some((q) => q.rel.toLowerCase() === rel.toLowerCase())) return 'dup'
  queue.value.push({ id: `${rel}-${Date.now()}-${Math.random()}`, rel })
  setQueueStatus(rel, null)
  validateMsg.value = ''
  return 'added'
}

interface QueueImportSummary {
  received: number
  added: number
  skippedExt: string[]
  skippedDup: string[]
  skippedSmall: string[]
}

function importRels(rels: string[]): QueueImportSummary {
  const summary: QueueImportSummary = {
    received: rels.length,
    added: 0,
    skippedExt: [],
    skippedDup: [],
    skippedSmall: [],
  }
  for (const relRaw of rels) {
    const display = relRaw.trim() || relRaw
    const rel = normalizeRel(relRaw)
    const result = addToQueue(relRaw)
    if (result === 'added') {
      summary.added++
    } else if (result === 'ext') {
      summary.skippedExt.push(display)
    } else {
      summary.skippedDup.push(rel || display)
    }
  }
  return summary
}

interface RelSize {
  rel: string
  size: number
}

function importRelSizes(items: RelSize[]): QueueImportSummary {
  const minB = minSizeBytes()
  const rels: string[] = []
  const skippedSmall: string[] = []
  for (const { rel, size } of items) {
    if (minB > 0 && size < minB) {
      skippedSmall.push(rel)
      continue
    }
    rels.push(rel)
  }
  const summary = importRels(rels)
  summary.skippedSmall = skippedSmall
  summary.received = items.length
  return summary
}

function showImportSummary(summary: QueueImportSummary) {
  importSkippedExt.value = summary.skippedExt
  importSkippedDup.value = summary.skippedDup
  importSkippedSmall.value = summary.skippedSmall
  if (!summary.skippedExt.length && !summary.skippedDup.length && !summary.skippedSmall.length) {
    importMsg.value =
      summary.received > 0
        ? `${summary.added} ficheiro(s) na fila.`
        : ''
    return
  }
  const parts: string[] = []
  if (summary.skippedExt.length) {
    parts.push(`${summary.skippedExt.length} com extensão não suportada`)
  }
  if (summary.skippedDup.length) {
    parts.push(
      `${summary.skippedDup.length} duplicado(s) — já na fila ou mesmo nome (arrastar só envia o nome, não a subpasta)`,
    )
  }
  if (summary.skippedSmall.length) {
    parts.push(`${summary.skippedSmall.length} abaixo de ${minSizeMb.value} MB`)
  }
  importMsg.value = `De ${summary.received} recebidos → ${summary.added} na fila. Ignorados: ${parts.join('; ')}.`
}

function relFromFile(f: File): string {
  return f.webkitRelativePath ? normalizeRel(f.webkitRelativePath) : normalizeRel(f.name)
}

function addFilesFromList(list: FileList | File[]) {
  const items: RelSize[] = []
  for (const f of list) items.push({ rel: relFromFile(f), size: f.size })
  showImportSummary(importRelSizes(items))
}

async function readEntryFiles(
  entry: FileSystemEntry,
  prefix: string,
  out: RelSize[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      ;(entry as FileSystemFileEntry).file(resolve, reject)
    })
    const rel = prefix ? `${prefix}/${file.name}` : file.name
    out.push({ rel: normalizeRel(rel), size: file.size })
    return
  }
  if (!entry.isDirectory) return
  const dir = entry as FileSystemDirectoryEntry
  const nextPrefix = prefix ? `${prefix}/${dir.name}` : dir.name
  const reader = dir.createReader()
  let batch: FileSystemEntry[]
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    for (const child of batch) {
      await readEntryFiles(child, nextPrefix, out)
    }
  } while (batch.length > 0)
}

async function collectDropRelSizes(e: DragEvent): Promise<RelSize[]> {
  const dt = e.dataTransfer
  if (!dt) return []

  const out: RelSize[] = []
  const items = dt.items ? [...dt.items] : []
  const fileItems = items.filter((item) => item.kind === 'file')
  const hasDirectory = fileItems.some((item) => item.webkitGetAsEntry?.()?.isDirectory)

  if (fileItems.length && (hasDirectory || fileItems.length === 1)) {
    for (const item of fileItems) {
      const entry = item.webkitGetAsEntry?.()
      if (entry) await readEntryFiles(entry, '', out)
    }
  }

  if (!out.length && dt.files?.length) {
    for (const f of dt.files) out.push({ rel: relFromFile(f), size: f.size })
  }
  return out
}

async function onDrop(e: DragEvent) {
  dropActive.value = false
  const items = await collectDropRelSizes(e)
  if (!items.length) return
  showImportSummary(importRelSizes(items))
}

function pickFiles() {
  fileInputRef.value?.click()
}

function pickFolder() {
  folderInputRef.value?.click()
}

function onFileInput(ev: Event) {
  const input = ev.target as HTMLInputElement
  if (input.files?.length) addFilesFromList(input.files)
  input.value = ''
}

function onFolderInput(ev: Event) {
  const input = ev.target as HTMLInputElement
  if (input.files?.length) addFilesFromList(input.files)
  input.value = ''
}

function removeQueueItem(id: string) {
  const item = queue.value.find((q) => q.id === id)
  if (item) setQueueStatus(item.rel, null)
  queue.value = queue.value.filter((q) => q.id !== id)
}

function clearQueue() {
  queue.value = []
  queueStatus.value = {}
  validateMsg.value = ''
  importMsg.value = ''
  importSkippedExt.value = []
  importSkippedDup.value = []
  importSkippedSmall.value = []
}

function onSourceSessionChange() {
  const i = Number(sourceSession.value)
  if (!Number.isFinite(i) || i < 0 || i >= menuRows.value.length) return
  sourceRoot.value = menuRows.value[i]!.path.trim()
}

function syncSourceSessionFromRoot(root: string) {
  const norm = root.trim().toLowerCase().replace(/[/\\]+$/, '')
  if (!norm) return
  const idx = menuRows.value.findIndex(
    (row) => row.path.trim().toLowerCase().replace(/[/\\]+$/, '') === norm,
  )
  sourceSession.value = idx >= 0 ? String(idx) : ''
}

function applyReprocessList(data: ShrinkReprocessListResponse) {
  if (data.sourceRoot?.trim()) {
    sourceRoot.value = data.sourceRoot.trim()
    syncSourceSessionFromRoot(data.sourceRoot)
  }
  if (data.needsPrioritizeSize) {
    prioritizeSize.value = true
  }
  queue.value = []
  queueStatus.value = {}
  validateMsg.value = ''
  const summary = importRels(data.files ?? [])
  showImportSummary(summary)
  if (data.empty) {
    listMsgOk.value = false
    listMsg.value = data.message ?? 'Lista vazia.'
    return
  }
  listMsgOk.value = true
  const parts: string[] = [`${data.count} ficheiro(s) carregado(s).`]
  if (data.phase2Count) parts.push(`${data.phase2Count} com 2.ª passagem (2|).`)
  if (data.phase3Count) {
    parts.push(`${data.phase3Count} com 3.ª passagem (3|) — Priorizar tamanho activado.`)
  }
  listMsg.value = parts.join(' ')
}

async function loadReprocessList() {
  listMsg.value = ''
  listMsgOk.value = false
  listLoading.value = true
  try {
    if ('showOpenFilePicker' in window) {
      const handles = await window.showOpenFilePicker!({
        types: [...SHRINK_LIST_FILE_PICKER_TYPES],
        multiple: false,
      })
      const file = await handles[0]!.getFile()
      const content = await file.text()
      applyQueueListFromText(content, file.name)
    } else {
      queueListFileInputRef.value?.click()
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    const ex = e as { message?: string }
    listMsgOk.value = false
    listMsg.value = ex?.message || 'Falha ao carregar lista.'
  } finally {
    listLoading.value = false
  }
}

function applyQueueListFromText(content: string, filename?: string) {
  const data = parseShrinkListFile(content)
  applyReprocessList({
    sourceRoot: data.sourceRoot,
    files: data.files,
    count: data.count,
    phase2Count: data.phase2Count,
    phase3Count: data.phase3Count,
    needsPrioritizeSize: data.needsPrioritizeSize,
    empty: data.count === 0 && !data.sourceRoot.trim(),
    message: data.count === 0 ? 'Lista vazia ou sem entradas válidas.' : undefined,
  })
  if (filename && data.count > 0) {
    listMsg.value = `${listMsg.value} (${filename})`
  }
}

async function saveQueueList() {
  if (!canSaveQueue.value) return
  listMsg.value = ''
  listMsgOk.value = false
  saveQueueLoading.value = true
  try {
    const content = formatShrinkListFile(
      sourceRoot.value,
      queue.value.map((q) => q.rel),
    )

    if ('showSaveFilePicker' in window) {
      const handle = await window.showSaveFilePicker!({
        suggestedName: SHRINK_LIST_FILE_DEFAULT_NAME,
        types: [...SHRINK_LIST_FILE_PICKER_TYPES],
      })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      listMsgOk.value = true
      listMsg.value = `${queue.value.length} ficheiro(s) guardado(s) em ${handle.name}.`
    } else {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = SHRINK_LIST_FILE_DEFAULT_NAME
      a.click()
      URL.revokeObjectURL(url)
      listMsgOk.value = true
      listMsg.value = `${queue.value.length} ficheiro(s) — download iniciado (${SHRINK_LIST_FILE_DEFAULT_NAME}).`
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    const ex = e as { message?: string }
    listMsgOk.value = false
    listMsg.value = ex?.message || 'Falha ao guardar fila.'
  } finally {
    saveQueueLoading.value = false
  }
}

async function onQueueListFileInput(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  listLoading.value = true
  try {
    const content = await file.text()
    applyQueueListFromText(content, file.name)
  } catch {
    listMsgOk.value = false
    listMsg.value = 'Falha ao ler ficheiro.'
  } finally {
    listLoading.value = false
  }
}

async function adminHeaders(): Promise<Record<string, string>> {
  const t = token.value.trim()
  if (!t) throw new Error('Preencha o token e guarde.')
  return { Authorization: `Bearer ${t}` }
}

function persistToken() {
  if (!import.meta.client) return
  sessionStorage.setItem('video_admin_token', token.value.trim())
  loadError.value = ''
}

async function loadMenu() {
  loadError.value = ''
  try {
    const h = await adminHeaders()
    const data = await $fetch<{
      serverPlatform: string
      items: MenuRow[]
    }>('/api/admin/menu', { headers: h })
    serverPlatform.value = data.serverPlatform ?? ''
    menuRows.value = Array.isArray(data.items) ? data.items : []
    if (!sourceRoot.value.trim() && menuRows.value[0]) {
      sourceSession.value = '0'
      sourceRoot.value = menuRows.value[0]!.path.trim()
    }
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    loadError.value = ex?.data?.statusMessage || ex?.message || 'Falha ao carregar menu.'
  }
}

async function validateQueue() {
  validateMsg.value = ''
  validateOk.value = false
  if (!sourceRoot.value.trim() || !queue.value.length) return
  validating.value = true
  try {
    const h = await adminHeaders()
    const data = await $fetch<{
      count: number
      failedCount: number
      skippedCount?: number
      failed: { rel: string; message: string }[]
      skipped?: { rel: string; message: string }[]
      items?: { rel: string; path: string }[]
    }>('/api/admin/shrink-validate', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: {
        sourceRoot: sourceRoot.value.trim(),
        files: queue.value.map((q) => q.rel),
        minSizeMb: minSizeMb.value,
      },
    })
    queueStatus.value = {}
    for (const f of data.skipped ?? []) {
      setQueueStatus(f.rel, { status: 'skip', message: f.message })
    }
    for (const f of data.failed ?? []) {
      setQueueStatus(f.rel, { status: 'err', message: f.message })
    }
    const pathToRel = new Map<string, string>()
    for (const item of data.items ?? []) {
      const pathKey = item.path.toLowerCase()
      const prev = pathToRel.get(pathKey)
      if (prev && prev !== item.rel) {
        setQueueStatus(item.rel, {
          status: 'err',
          message: `Duplicado — mesmo ficheiro que «${prev}»`,
        })
      } else {
        pathToRel.set(pathKey, item.rel)
      }
    }
    const skippedCount = data.skippedCount ?? data.skipped?.length ?? 0
    if ((data.failedCount ?? 0) === 0) {
      validateOk.value = true
      validateMsg.value =
        skippedCount > 0
          ? `${data.count} ficheiro(s) OK · ${skippedCount} ignorado(s) (< ${minSizeMb.value} MB)`
          : `${data.count} ficheiro(s) encontrado(s) no servidor.`
    } else {
      validateOk.value = false
      const skipPart = skippedCount > 0 ? ` · ${skippedCount} ignorado(s) (< ${minSizeMb.value} MB)` : ''
      validateMsg.value = `${data.failedCount} com erro · ${data.count} OK no servidor${skipPart}.`
    }
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
    if (id) sessionStorage.setItem(SHRINK_JOB_STORAGE_KEY, id)
    else sessionStorage.removeItem(SHRINK_JOB_STORAGE_KEY)
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
  const t = token.value.trim()
  if (!t) {
    jobErr.value = 'Token em falta.'
    return
  }
  const url = `/api/admin/shrink-stream?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(t)}`
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
      syncQueueStatusFromJob(job.value)
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
  es.addEventListener('progress', (ev) => {
    if (!job.value) return
    try {
      const data = JSON.parse((ev as MessageEvent).data) as {
        totals: JobSnapshot['totals']
        currentFileIndex: number
      }
      job.value.totals = data.totals
      job.value.currentFileIndex = data.currentFileIndex
    } catch {
      /* */
    }
  })
  es.addEventListener('file-start', (ev) => {
    if (!job.value) return
    try {
      const data = JSON.parse((ev as MessageEvent).data) as { rel: string; path?: string }
      setQueueStatusForJobFile(data.rel, data.path, { status: 'running' })
    } catch {
      /* */
    }
  })
  es.addEventListener('file-end', (ev) => {
    if (!job.value) return
    try {
      const data = JSON.parse((ev as MessageEvent).data) as {
        fileIndex: number
        result: JobFileResult
      }
      if (!job.value.results) job.value.results = []
      job.value.results[data.fileIndex] = data.result
      applyResultStatus(data.result)
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
      const snap = JSON.parse((ev as MessageEvent).data) as JobSnapshot
      job.value = snap
      syncQueueStatusFromJob(snap)
      void scrollTailToBottom()
    } catch {
      /* */
    }
    closeStream()
  })
  es.onerror = () => {
    if (job.value?.status !== 'running') closeStream()
  }
}

async function attachToJob(jobId: string) {
  openStreamForJob(jobId)
}

async function bootstrapJob() {
  if (!token.value.trim()) return
  try {
    const h = await adminHeaders()
    const data = await $fetch<{ shrinkRunningJob: JobSnapshot | null }>('/api/admin/shrink-status', {
      headers: h,
    })
    const running = data.shrinkRunningJob
    if (running) {
      rememberJobId(running.id)
      await attachToJob(running.id)
      return
    }
    const stored = sessionStorage.getItem(SHRINK_JOB_STORAGE_KEY)
    if (stored) {
      const snap = await $fetch<JobSnapshot>(`/api/admin/shrink-status?jobId=${encodeURIComponent(stored)}`, {
        headers: h,
      })
      if (snap.status === 'running') await attachToJob(stored)
      else {
        job.value = snap
        syncQueueStatusFromJob(snap)
      }
    }
  } catch {
    /* */
  }
}

async function startShrinkJob() {
  if (!canProcess.value) return
  startErr.value = ''
  jobErr.value = ''
  job.value = null
  for (const q of queue.value) {
    setQueueStatus(q.rel, null)
  }
  try {
    const h = await adminHeaders()
    const data = await $fetch<{ jobId: string }>('/api/admin/shrink-start', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: {
        sourceRoot: sourceRoot.value.trim(),
        files: queue.value.map((q) => q.rel),
        height: height.value,
        speed: speed.value,
        codec: codec.value,
        force: force.value,
        prioritizeSize: prioritizeSize.value,
        minSizeMb: minSizeMb.value,
      },
    })
    rememberJobId(data.jobId)
    await attachToJob(data.jobId)
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    startErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao iniciar shrink.'
  }
}

async function cancelJob() {
  if (!job.value || !jobActive.value) return
  if (!confirm('Cancelar o processamento em curso?')) return
  try {
    const h = await adminHeaders()
    await $fetch('/api/admin/shrink-cancel', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
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
  if (line.stream === 'stderr') return 'tail-line tail-line--err'
  if (line.stream === 'meta') return 'tail-line tail-line--meta'
  const t = line.text.trimStart()
  if (t.startsWith('[OK]')) return 'tail-line tail-line--ok'
  if (t.startsWith('[ERRO]')) return 'tail-line tail-line--err'
  if (t.startsWith('[SKIP]')) return 'tail-line tail-line--meta'
  if (t.startsWith('[PROCESSANDO]')) return 'tail-line tail-line--proc'
  return 'tail-line'
}

onMounted(() => {
  if (!import.meta.client) return
  token.value = sessionStorage.getItem('video_admin_token') ?? ''
  if (token.value.trim()) {
    void loadMenu().then(() => bootstrapJob())
  }
})

onUnmounted(() => {
  closeStream()
})
</script>

<style scoped>
.admin-page {
  min-height: 100vh;
  padding: 1.25rem 1.5rem 2.5rem;
  background: #0c0d10;
  color: #e8eaed;
  font-family: system-ui, sans-serif;
}

.admin-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.admin-head-links {
  display: flex;
  gap: 0.75rem;
}

.admin-title {
  margin: 0;
  font-size: 1.45rem;
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
  max-width: 56rem;
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

.shrink-source-path {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.82rem;
}

.shrink-list-actions {
  margin-top: 0.65rem;
}

.shrink-list-hint {
  margin: 0.5rem 0 0;
  font-size: 0.82rem;
  line-height: 1.45;
}

.drop-zone {
  border: 2px dashed #3d444d;
  border-radius: 10px;
  padding: 1.25rem 1rem;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
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

.import-summary {
  margin: 0.65rem 0 0;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  font-size: 0.88rem;
  line-height: 1.45;
  color: #ffd9b8;
  background: color-mix(in srgb, #d97a2a 14%, transparent);
  border: 1px solid color-mix(in srgb, #d97a2a 35%, transparent);
}

.import-skipped-details {
  margin: 0.35rem 0 0.65rem;
  font-size: 0.84rem;
  color: #9aa0a6;
}

.import-skipped-summary {
  cursor: pointer;
  margin-bottom: 0.35rem;
}

.import-skipped-list {
  list-style: none;
  margin: 0 0 0.5rem;
  padding: 0;
  max-height: 10rem;
  overflow: auto;
}

.import-skipped-item {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.78rem;
  padding: 0.15rem 0;
  word-break: break-all;
}

.import-skipped-tag {
  display: inline-block;
  min-width: 4.5rem;
  color: #f8b4b0;
  font-family: system-ui, sans-serif;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.queue-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0;
  max-height: 240px;
  overflow: auto;
}

.queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid #2d333b;
}

.queue-rel {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.82rem;
  word-break: break-all;
  text-align: left;
}

.queue-item--err {
  background: color-mix(in srgb, #da3633 8%, transparent);
  margin: 0 -0.35rem;
  padding-left: 0.35rem;
  padding-right: 0.35rem;
  border-radius: 4px;
}

.queue-rel--err {
  color: #f85149;
  font-weight: 600;
}

.queue-rel--ok {
  color: #7ee787;
}

.queue-rel--skip {
  color: #9aa0a6;
}

.queue-rel--running {
  color: #8ab4f8;
}

.queue-rel--oversized {
  color: #d29922;
}

.queue-oversized {
  margin-top: 0.85rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid color-mix(in srgb, #d29922 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, #d29922 10%, transparent);
}

.queue-oversized-title {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
  color: #e3b341;
}

.queue-oversized-hint {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
}

.queue-oversized-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 200px;
  overflow: auto;
}

.queue-oversized-item {
  padding: 0.3rem 0;
  border-top: 1px solid color-mix(in srgb, #d29922 25%, transparent);
  font-size: 0.82rem;
}

.queue-oversized-item:first-child {
  border-top: none;
}

.queue-oversized-rel {
  display: block;
  font-family: ui-monospace, Consolas, monospace;
  color: #e8eaed;
  word-break: break-all;
}

.queue-oversized-msg {
  display: block;
  color: #d29922;
  margin-top: 0.15rem;
}

.queue-errors {
  margin-top: 0.85rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid color-mix(in srgb, #da3633 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, #da3633 10%, transparent);
}

.queue-errors-title {
  margin: 0 0 0.45rem;
  font-size: 0.9rem;
  color: #f85149;
}

.queue-errors-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 200px;
  overflow: auto;
}

.queue-errors-item {
  padding: 0.3rem 0;
  border-top: 1px solid color-mix(in srgb, #da3633 25%, transparent);
  font-size: 0.82rem;
}

.queue-errors-item:first-child {
  border-top: none;
}

.queue-errors-rel {
  display: block;
  font-family: ui-monospace, Consolas, monospace;
  color: #f85149;
  word-break: break-all;
}

.queue-errors-msg {
  display: block;
  color: #f8b4b0;
  margin-top: 0.15rem;
  font-size: 0.78rem;
}

.shrink-options {
  align-items: flex-end;
  margin-bottom: 0.75rem;
}

.shrink-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.shrink-label {
  font-size: 0.78rem;
  color: #9aa0a6;
}

.shrink-num {
  width: 6rem;
}

.shrink-field--codec {
  min-width: min(100%, 16rem);
  flex: 1;
}

.shrink-field--codec .admin-input {
  min-width: 100%;
}

.shrink-codec-hint {
  margin: 0 0 0.65rem;
  font-size: 0.84rem;
}

.shrink-actions {
  margin-top: 0;
}

.shrink-force {
  margin-left: 0.25rem;
}

.shrink-prioritize {
  flex: 1 1 100%;
  margin-top: 0.35rem;
}

.admin-check-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.88rem;
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

.job-counters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0.65rem 0;
  font-size: 0.85rem;
}

.job-counter--ok strong {
  color: #7ee787;
}

.job-counter--err strong {
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
</style>
