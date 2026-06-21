<template>
  <div class="admin-page">
    <header class="admin-head">
      <h1 class="admin-title">Shrink de vídeos</h1>
      <div class="admin-head-links">
        <NuxtLink to="/" class="admin-back">← Reprodutor</NuxtLink>
        <NuxtLink to="/admin" class="admin-back">Admin</NuxtLink>
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
        Caminho absoluto no servidor onde estão os vídeos. Os nomes da fila são resolvidos relativamente a esta pasta.
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
          mp4, mkv, m4v, avi, mov, webm — ficheiros na raiz da pasta de origem (só o nome) ou subpastas
          (use «Escolher pasta»).
        </p>
        <div class="admin-row drop-zone-actions">
          <button type="button" class="admin-btn" @click="pickFiles">Escolher ficheiros</button>
          <button type="button" class="admin-btn admin-btn--ghost" @click="pickFolder">Escolher pasta</button>
          <button type="button" class="admin-btn admin-btn--ghost" :disabled="!queue.length" @click="clearQueue">
            Limpar fila
          </button>
        </div>
        <input ref="fileInputRef" type="file" multiple accept="video/*,.mp4,.mkv,.m4v,.avi,.mov,.webm" class="sr-only" @change="onFileInput" />
        <input ref="folderInputRef" type="file" multiple webkitdirectory class="sr-only" @change="onFolderInput" />
      </div>

      <ul v-if="queue.length" class="queue-list">
        <li v-for="item in queue" :key="item.id" class="queue-item">
          <span class="queue-rel" :title="item.rel">{{ item.rel }}</span>
          <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" @click="removeQueueItem(item.id)">
            Remover
          </button>
        </li>
      </ul>
      <p v-else class="admin-muted">Nenhum ficheiro na fila.</p>
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
        <label class="admin-check-label shrink-force">
          <input v-model="force" type="checkbox" />
          Substituir se já existir em shrinked\ (--force)
        </label>
      </div>
      <div class="admin-row">
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
interface MenuRow {
  path: string
  title: string
}

interface QueueItem {
  id: string
  rel: string
}

type JobStatus = 'running' | 'done' | 'failed' | 'cancelled'

interface JobLine {
  seq: number
  fileIndex: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

interface JobSnapshot {
  id: string
  status: JobStatus
  sourceRoot: string
  height: number
  speed: number
  force: boolean
  totalFiles: number
  currentFileIndex: number
  totals: { ok: number; err: number; skip: number }
  lines: JobLine[]
  totalLines: number
  cancelRequested: boolean
  startedAt: number
  endedAt: number | null
}

const VIDEO_EXT_RE = /\.(mp4|mkv|m4v|avi|mov|webm)$/i
const SHRINK_JOB_STORAGE_KEY = 'video_admin_shrink_job_id'
const VISIBLE_LINES_CAP = 400

const token = ref('')
const menuRows = ref<MenuRow[]>([])
const sourceSession = ref('')
const sourceRoot = ref('')
const loadError = ref('')
const queue = ref<QueueItem[]>([])
const dropActive = ref(false)
const height = ref(540)
const speed = ref<1.25 | 1.5 | 2>(1.5)
const force = ref(false)
const validating = ref(false)
const validateMsg = ref('')
const validateOk = ref(false)
const startErr = ref('')

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

function isVideoName(name: string): boolean {
  return VIDEO_EXT_RE.test(name.trim())
}

function normalizeRel(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

function addToQueue(relRaw: string) {
  const rel = normalizeRel(relRaw)
  if (!rel || !isVideoName(rel)) return
  if (queue.value.some((q) => q.rel.toLowerCase() === rel.toLowerCase())) return
  queue.value.push({ id: `${rel}-${Date.now()}-${Math.random()}`, rel })
  validateMsg.value = ''
}

function addFilesFromList(list: FileList | File[]) {
  for (const f of list) {
    const rel = f.webkitRelativePath ? normalizeRel(f.webkitRelativePath) : normalizeRel(f.name)
    addToQueue(rel)
  }
}

function onDrop(e: DragEvent) {
  dropActive.value = false
  const files = e.dataTransfer?.files
  if (!files?.length) return
  addFilesFromList(files)
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
  queue.value = queue.value.filter((q) => q.id !== id)
}

function clearQueue() {
  queue.value = []
  validateMsg.value = ''
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
    const data = await $fetch<{ count: number }>('/api/admin/shrink-validate', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: {
        sourceRoot: sourceRoot.value.trim(),
        files: queue.value.map((q) => q.rel),
      },
    })
    validateOk.value = true
    validateMsg.value = `${data.count} ficheiro(s) encontrado(s) no servidor.`
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
      else job.value = snap
    }
  } catch {
    /* */
  }
}

async function startShrinkJob() {
  if (!canProcess.value) return
  startErr.value = ''
  jobErr.value = ''
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
        force: force.value,
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

.shrink-force {
  margin-left: 0.25rem;
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
