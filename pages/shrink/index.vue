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
        Escolha a biblioteca no menu (ex.: «_selected»). Os nomes da fila são relativos a essa pasta —
        use só o nome do ficheiro se os vídeos estiverem na raiz da biblioteca.
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
          <button type="button" class="admin-btn admin-btn--ghost" :disabled="!queue.length" @click="clearQueue">
            Limpar fila
          </button>
        </div>
        <input ref="fileInputRef" type="file" multiple :accept="VIDEO_FILE_INPUT_ACCEPT" class="sr-only" @change="onFileInput" />
        <input ref="folderInputRef" type="file" multiple webkitdirectory class="sr-only" @change="onFolderInput" />
      </div>

      <p v-if="importMsg" class="import-summary" role="status">{{ importMsg }}</p>
      <details v-if="importSkippedExt.length || importSkippedDup.length" class="import-skipped-details">
        <summary class="import-skipped-summary">
          Ver {{ importSkippedExt.length + importSkippedDup.length }} ignorado(s)
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
          A saída ficou maior que o original. Lista em
          <code class="admin-code">data\shrink-oversized.log</code>.
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
            <option value="auto">Automático (mesma família do original)</option>
            <option value="h264_nvenc">H.264 NVENC (GPU, rápido)</option>
            <option value="libx264">H.264 libx264 (CPU)</option>
            <option value="hevc_nvenc">HEVC NVENC (GPU, menor)</option>
            <option value="libx265">HEVC libx265 (CPU, lento)</option>
          </select>
        </label>
        <label v-if="codec === 'auto'" class="admin-check-label shrink-prioritize">
          <input v-model="prioritizeSize" type="checkbox" />
          Priorizar tamanho reduzido (HEVC + retry com resolução menor se a saída ficar maior)
        </label>
        <label class="admin-check-label shrink-force">
          <input v-model="force" type="checkbox" />
          Substituir se já existir em shrinked\ (--force)
        </label>
      </div>
      <p class="admin-muted shrink-codec-hint">
        <strong>Automático</strong> lê o codec do ficheiro (ffprobe): H.264 → H.264, HEVC → H.265, com GPU se
        existir. Com <strong>priorizar tamanho</strong>, usa HEVC e, se a saída ainda for maior que o original,
        tenta resoluções mais baixas e codecs mais compactos. Áudio AAC 96–128 kbps nos retries.
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
        <span v-if="job.totalFiles > 1" class="job-counter">
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

interface JobSnapshot {
  id: string
  status: JobStatus
  sourceRoot: string
  height: number
  speed: number
  codec: ShrinkCodec
  force: boolean
  prioritizeSize?: boolean
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
const codec = ref<ShrinkCodec>('auto')
const prioritizeSize = ref(false)
const force = ref(false)

watch(codec, (c) => {
  if (c !== 'auto') prioritizeSize.value = false
})
const validating = ref(false)
const validateMsg = ref('')
const validateOk = ref(false)
const startErr = ref('')
const queueStatus = ref<Record<string, QueueFileMeta>>({})
const importMsg = ref('')
const importSkippedExt = ref<string[]>([])
const importSkippedDup = ref<string[]>([])

const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)

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
    setQueueStatus(result.rel, { status: 'running' })
    return
  }
  if (result.oversizedOutput) {
    setQueueStatus(result.rel, {
      status: 'oversized',
      message: oversizedMessage(result.oversizedOutput),
    })
    return
  }
  if (result.skipCount > 0) {
    setQueueStatus(result.rel, { status: 'skip', message: 'Ignorado (já existe ou skip)' })
    return
  }
  if (result.errCount > 0 || (result.exitCode !== 0 && result.okCount === 0)) {
    const msg =
      result.failedItems?.[0]?.message ??
      result.error ??
      (result.exitCode != null ? `Falhou (exit ${result.exitCode})` : 'Erro')
    setQueueStatus(result.rel, { status: 'err', message: msg })
    return
  }
  setQueueStatus(result.rel, { status: 'ok' })
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
}

function importRels(rels: string[]): QueueImportSummary {
  const summary: QueueImportSummary = {
    received: rels.length,
    added: 0,
    skippedExt: [],
    skippedDup: [],
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

function showImportSummary(summary: QueueImportSummary) {
  importSkippedExt.value = summary.skippedExt
  importSkippedDup.value = summary.skippedDup
  if (!summary.skippedExt.length && !summary.skippedDup.length) {
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
  importMsg.value = `De ${summary.received} recebidos → ${summary.added} na fila. Ignorados: ${parts.join('; ')}.`
}

function relFromFile(f: File): string {
  return f.webkitRelativePath ? normalizeRel(f.webkitRelativePath) : normalizeRel(f.name)
}

function addFilesFromList(list: FileList | File[]) {
  const rels: string[] = []
  for (const f of list) rels.push(relFromFile(f))
  showImportSummary(importRels(rels))
}

async function readEntryFiles(
  entry: FileSystemEntry,
  prefix: string,
  out: string[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      ;(entry as FileSystemFileEntry).file(resolve, reject)
    })
    const rel = prefix ? `${prefix}/${file.name}` : file.name
    out.push(normalizeRel(rel))
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

async function collectDropRels(e: DragEvent): Promise<string[]> {
  const dt = e.dataTransfer
  if (!dt) return []

  const rels: string[] = []
  const items = dt.items ? [...dt.items] : []
  const fileItems = items.filter((item) => item.kind === 'file')
  const hasDirectory = fileItems.some((item) => item.webkitGetAsEntry?.()?.isDirectory)

  if (fileItems.length && (hasDirectory || fileItems.length === 1)) {
    for (const item of fileItems) {
      const entry = item.webkitGetAsEntry?.()
      if (entry) await readEntryFiles(entry, '', rels)
    }
  }

  if (!rels.length && dt.files?.length) {
    for (const f of dt.files) rels.push(relFromFile(f))
  }
  return rels
}

async function onDrop(e: DragEvent) {
  dropActive.value = false
  const rels = await collectDropRels(e)
  if (!rels.length) return
  showImportSummary(importRels(rels))
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
}

function onSourceSessionChange() {
  const i = Number(sourceSession.value)
  if (!Number.isFinite(i) || i < 0 || i >= menuRows.value.length) return
  sourceRoot.value = menuRows.value[i]!.path.trim()
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
      failed: { rel: string; message: string }[]
    }>('/api/admin/shrink-validate', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: {
        sourceRoot: sourceRoot.value.trim(),
        files: queue.value.map((q) => q.rel),
      },
    })
    queueStatus.value = {}
    for (const f of data.failed ?? []) {
      setQueueStatus(f.rel, { status: 'err', message: f.message })
    }
    if ((data.failedCount ?? 0) === 0) {
      validateOk.value = true
      validateMsg.value = `${data.count} ficheiro(s) encontrado(s) no servidor.`
    } else {
      validateOk.value = false
      validateMsg.value = `${data.failedCount} com erro · ${data.count} OK no servidor.`
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
      const data = JSON.parse((ev as MessageEvent).data) as { rel: string }
      setQueueStatus(data.rel, { status: 'running' })
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
        prioritizeSize: codec.value === 'auto' && prioritizeSize.value,
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
