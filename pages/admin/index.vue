<template>
  <div class="admin-page">
    <header class="admin-head">
      <h1 class="admin-title">Administração</h1>
      <NuxtLink to="/" class="admin-back">← Reprodutor</NuxtLink>
    </header>

    <p class="admin-lead">
      Gerir pastas em <code class="admin-code">data/video-menu.json</code>, nomes do menu e sincronizar
      <code class="admin-code">trailers/</code> e <code class="admin-code">preview/</code> (scripts
      <code class="admin-code">scripts/trailer.bat</code> e <code class="admin-code">scripts/preview.bat</code> no
      servidor Windows).
    </p>

    <p v-if="!isWinServer" class="admin-warn" role="status">
      O processo Node está em <strong>{{ serverPlatform }}</strong>: a sincronização por .bat só funciona se o
      servidor for Windows.
    </p>

    <section class="admin-card">
      <h2 class="admin-h2">Token</h2>
      <p class="admin-muted">
        Defina <code class="admin-code">VIDEO_ADMIN_TOKEN</code> no ambiente do servidor e use o mesmo valor aqui.
      </p>
      <div class="admin-row">
        <input
          v-model="token"
          type="password"
          class="admin-input admin-input--wide"
          autocomplete="current-password"
          placeholder="VIDEO_ADMIN_TOKEN"
        />
        <button type="button" class="admin-btn" @click="persistToken">Guardar no browser</button>
        <button type="button" class="admin-btn admin-btn--ghost" @click="loadMenu">Carregar menu</button>
        <button
          type="button"
          class="admin-btn"
          :title="
            broadcastSupported
              ? 'Recarrega o menu local e avisa o reprodutor (na mesma janela/browser) para refazer a lista de bibliotecas e trailers.'
              : 'O browser não suporta BroadcastChannel — só recarrega o menu desta página.'
          "
          @click="reloadLibrariesAndBroadcast"
        >
          Recarregar bibliotecas no reprodutor
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--danger"
          :disabled="stopServerBusy"
          title="Encerra o processo Node do servidor (útil para manutenção/restart manual)"
          @click="stopServerProcess"
        >
          Parar servidor
        </button>
      </div>
      <p v-if="stopServerMsg" class="admin-ok">{{ stopServerMsg }}</p>
      <p v-if="stopServerErr" class="admin-err">{{ stopServerErr }}</p>
      <p v-if="reloadMsg" class="admin-ok">{{ reloadMsg }}</p>
      <p v-if="loadError" class="admin-err">{{ loadError }}</p>
      <p v-else-if="!rows.length && !source" class="admin-muted">
        Guarde o token e clique em «Carregar menu» para editar as pastas.
      </p>
      <p v-else-if="source" class="admin-meta">
        Origem: <strong>{{ source === 'file' ? 'video-menu.json' : 'fallback .env (sem JSON válido)' }}</strong>
      </p>
    </section>

    <section v-if="rows.length" class="admin-card">
      <h2 class="admin-h2">Pastas e nomes do menu</h2>
      <p class="admin-muted">O «nome do menu» é o rótulo na lista de bibliotecas. O caminho deve ser a raiz onde estão os vídeos completos, <code class="admin-code">trailers/</code> e <code class="admin-code">preview/</code>.</p>
      <p class="admin-muted admin-muted--tight">
        <strong>Contagens</strong>: vídeos completos na raiz ou numa subpasta directa (ex.: <code class="admin-code">Série/Título.mkv</code>) vs catálogo em
        <code class="admin-code">trailers/</code> vs vídeos em <code class="admin-code">preview/</code> (também uma subpasta directa).
        <strong>Trailers↔preview</strong>: quantos trailers têm cópia dedicada na pasta preview e quantos ficheiros em preview não batem com nenhum trailer do catálogo.
      </p>

      <div class="admin-table-wrap">
        <table class="admin-table admin-table--folders">
          <colgroup>
            <col class="admin-col-idx" />
            <col class="admin-col-path" />
            <col class="admin-col-title" />
            <col class="admin-col-check" />
            <col class="admin-col-sync" />
            <col class="admin-col-autotags" />
            <col class="admin-col-del" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Caminho</th>
              <th>Nome no menu</th>
              <th>Checagem</th>
              <th>Sincronizar</th>
              <th title="Pipeline npm run auto-tags para esta biblioteca">Auto-tags</th>
              <th aria-label="Remover linha"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="i">
              <td class="admin-td-idx">{{ i }}</td>
              <td class="admin-td-path">
                <input
                  v-model="row.path"
                  type="text"
                  class="admin-input admin-input--full"
                  spellcheck="false"
                />
              </td>
              <td><input v-model="row.title" type="text" class="admin-input admin-input--full" /></td>
              <td class="admin-td-check">
                <div class="admin-check-lines" :class="{ 'admin-check-lines--dim': statsRowLoading === i }">
                  <div class="admin-check-line" :title="statsCountsByRow[i] || ''">
                    {{ statsCountsByRow[i] || '—' }}
                  </div>
                  <div v-if="statsPairByRow[i]" class="admin-check-line admin-check-line--sub" :title="statsPairByRow[i] || ''">
                    {{ statsPairByRow[i] }}
                  </div>
                </div>
                <div class="admin-check-btns">
                  <button
                    type="button"
                    class="admin-btn admin-btn--sm"
                    :disabled="statsBusy || jobActive"
                    title="Contar completos (raiz + subpasta directa), trailers/ e preview/"
                    @click="checkFolderStatsRow(i, 'counts')"
                  >
                    Contagens
                  </button>
                  <button
                    type="button"
                    class="admin-btn admin-btn--sm"
                    :disabled="statsBusy || jobActive"
                    title="Cruzar trailers do catálogo com ficheiros em preview/"
                    @click="checkFolderStatsRow(i, 'pairing')"
                  >
                    T↔P
                  </button>
                </div>
              </td>
              <td class="admin-td-sync">
                <button
                  type="button"
                  class="admin-btn admin-btn--sm"
                  :disabled="jobActive || !isWinServer"
                  @click="startSyncJob('trailers', { session: i })"
                >
                  Trailers
                </button>
                <button
                  type="button"
                  class="admin-btn admin-btn--sm"
                  :disabled="jobActive || !isWinServer"
                  @click="startSyncJob('previews', { session: i })"
                >
                  Previews
                </button>
              </td>
              <td class="admin-td-autotags">
                <button
                  type="button"
                  class="admin-btn admin-btn--sm"
                  :disabled="autoTagsBusy || jobActive"
                  title="Corre o pipeline de tags automáticas só para esta sessão (índice da linha)"
                  @click="runAutoTags({ session: i })"
                >
                  Auto-tags
                </button>
              </td>
              <td class="admin-td-del">
                <button
                  type="button"
                  class="admin-btn admin-btn--sm admin-btn--danger"
                  :disabled="rows.length <= 1"
                  :title="rows.length <= 1 ? 'Tem de existir pelo menos uma linha' : 'Remover esta pasta do menu'"
                  aria-label="Remover esta pasta do menu"
                  @click="removeRow(i)"
                >
                  <svg
                    class="admin-btn-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 6h18M8 6V4h8v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12M10 11v6M14 11v6" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="admin-h3">Tags automáticas</h3>
      <p class="admin-muted">
        Equivalente a <code class="admin-code">npm run auto-tags</code>: exporta nomes, gera
        <code class="admin-code">tags_*.csv</code>
        via Python sobre <code class="admin-code">trailers/</code> e importa para a SQLite de tags. É preciso Python no PATH
        no servidor no passo intermédio.
      </p>
      <div class="admin-row admin-row--checks">
        <label class="admin-check-label">
          <input v-model="autoTagsDryRun" type="checkbox" /> Simulação (--dry-run)
        </label>
        <label class="admin-check-label admin-check-label--warn" title="Apaga todas as tags na base, inclusive manuais">
          <input v-model="autoTagsClearManual" type="checkbox" /> Limpar também tags manuais (--all)
        </label>
      </div>

      <div class="admin-actions">
        <button
          type="button"
          class="admin-btn admin-btn--primary"
          :disabled="autoTagsBusy || jobActive || !rows.length"
          title="Corre export + Python + import para todas as bibliotecas do menu"
          @click="runAutoTags({ all: true })"
        >
          Auto-tags (todas)
        </button>
        <button type="button" class="admin-btn admin-btn--ghost" @click="addRow">+ Linha</button>
        <button type="button" class="admin-btn admin-btn--ghost" @click="removeLastRow" :disabled="rows.length <= 1">
          − Última
        </button>
        <button type="button" class="admin-btn admin-btn--primary" :disabled="saveBusy" @click="saveMenu">
          Gravar menu
        </button>
        <button
          type="button"
          class="admin-btn"
          :disabled="statsBusy || jobActive || !rows.length"
          title="Contagens para todas as linhas (usa os caminhos actuais da tabela)"
          @click="checkFolderStatsAll('counts')"
        >
          Contagens (todas)
        </button>
        <button
          type="button"
          class="admin-btn"
          :disabled="statsBusy || jobActive || !rows.length"
          title="Trailers↔preview para todas as linhas"
          @click="checkFolderStatsAll('pairing')"
        >
          Trailers↔preview (todas)
        </button>
        <button
          type="button"
          class="admin-btn"
          :disabled="jobActive || !isWinServer || !rows.length"
          @click="startSyncJob('trailers', { all: true })"
        >
          Trailers (todas)
        </button>
        <button
          type="button"
          class="admin-btn"
          :disabled="jobActive || !isWinServer || !rows.length"
          @click="startSyncJob('previews', { all: true })"
        >
          Previews (todas)
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--primary"
          :disabled="jobActive || !isWinServer || !rows.length"
          title="Corre primeiro Trailers para todas as bibliotecas, depois Previews. Tudo num único job — basta esperar."
          @click="startSyncJob('both', { all: true })"
        >
          Trailers + Previews (todas)
        </button>
      </div>
      <p v-if="autoTagsBusy" class="admin-muted">A correr o pipeline auto-tags… (pode demorar vários minutos)</p>
      <p v-if="autoTagsErr" class="admin-err">{{ autoTagsErr }}</p>
      <details v-if="autoTagsResult" class="admin-autotags-details" open>
        <summary class="admin-autotags-summary">
          Saída do pipeline
          <span class="admin-meta">&nbsp;· exit {{ autoTagsResult.exitCode }}</span>
          <span v-if="autoTagsResult.truncated" class="admin-warn">&nbsp;(saída truncada)</span>
        </summary>
        <pre class="admin-pre admin-pre--autotags">{{ autoTagsMergedOutput }}</pre>
      </details>
      <p v-if="saveMsg" class="admin-ok">{{ saveMsg }}</p>
      <p v-if="saveErr" class="admin-err">{{ saveErr }}</p>
      <p v-if="statsErr" class="admin-err">{{ statsErr }}</p>
    </section>

    <section class="admin-card">
      <div class="failures-head">
        <h2 class="admin-h2">Ficheiros falhados (último sync)</h2>
        <button
          type="button"
          class="admin-btn admin-btn--sm admin-btn--ghost"
          :disabled="failuresBusy"
          title="Relê data/sync-last-failures.json"
          @click="loadSyncFailures"
        >
          Actualizar
        </button>
      </div>
      <p class="admin-muted">
        Lista gravada automaticamente ao terminar jobs <strong>Trailers</strong>/<strong>Previews</strong> (erros das linhas
        <code class="admin-code">[ERRO]</code> dos scripts, com o ficheiro do último
        <code class="admin-code">[PROCESSANDO]</code> ou <code class="admin-code">[PREVIEW]</code> antes do erro).
      </p>
      <p v-if="failuresErr" class="admin-err">{{ failuresErr }}</p>
      <p
        v-else-if="failuresHydrated && !syncFailures.savedAt && !syncFailures.items.length"
        class="admin-muted"
      >
        Sem falhas registadas no último job — ou ainda não correu sync com erros.
      </p>
      <template v-else-if="failuresHydrated && (syncFailures.savedAt || syncFailures.items.length)">
        <p class="admin-meta failures-meta-summary">
          Última gravação:
          <strong>{{ syncFailures.savedAt ? formatFailuresDate(syncFailures.savedAt) : '—' }}</strong>
          · job <code class="admin-code">{{ syncFailures.jobId || '—' }}</code> · estado
          <strong>{{ syncFailures.jobStatus || '—' }}</strong> ·
          <strong>{{ syncFailures.items.length }}</strong>
          entrada{{ syncFailures.items.length === 1 ? '' : 's' }}
        </p>
      </template>
      <ul v-if="syncFailures.items.length" class="failures-list">
        <li v-for="(it, ix) in syncFailures.items" :key="ix" class="failures-item">
          <div class="failures-item-top">
            <span class="failures-phase" :class="`failures-phase--${it.phase}`">{{ it.phase }}</span>
            <span class="failures-sess">Sessão {{ it.sessionIndex }}</span>
          </div>
          <div class="failures-file" :title="it.sourceFile">{{ it.sourceFile }}</div>
          <div class="failures-detail">{{ it.detail }}</div>
          <div class="failures-lib" :title="it.libraryPath">
            {{ it.libraryTitle || it.libraryPath || '—' }}
          </div>
        </li>
      </ul>
      <div v-if="failuresBusy" class="admin-muted failures-loading">A carregar…</div>
    </section>

    <section v-if="job || jobErr" class="admin-card admin-card--log">
      <div class="job-head">
        <h2 class="admin-h2">
          Sincronização
          <span v-if="job" class="job-kind">· {{ jobScopeLabel(job) }}</span>
        </h2>
        <div class="job-head-actions">
          <span
            v-if="job"
            class="job-status"
            :class="`job-status--${job.status}`"
            :title="`Início: ${new Date(job.startedAt).toLocaleString()}`"
          >
            {{ statusLabel(job.status) }}
            <span v-if="job.cancelRequested && job.status === 'running'"> (a cancelar…)</span>
          </span>
          <button
            v-if="jobActive"
            type="button"
            class="admin-btn admin-btn--sm admin-btn--danger"
            :disabled="job?.cancelRequested"
            @click="cancelCurrentJob"
          >
            Cancelar
          </button>
          <button
            v-if="job && !jobActive"
            type="button"
            class="admin-btn admin-btn--sm admin-btn--ghost"
            @click="clearJobView"
          >
            Limpar
          </button>
        </div>
      </div>

      <p v-if="jobErr" class="admin-err">{{ jobErr }}</p>

      <div v-if="job" class="job-counters">
        <span class="job-counter">
          <strong>{{ job.totals.started }}</strong> processados
        </span>
        <span class="job-counter job-counter--ok">
          <strong>{{ job.totals.ok }}</strong> OK
        </span>
        <span class="job-counter" :class="{ 'job-counter--err': job.totals.err > 0 }">
          <strong>{{ job.totals.err }}</strong> erro{{ job.totals.err === 1 ? '' : 's' }}
        </span>
        <span v-if="job.totalSessions > 1" class="job-counter">
          sessão <strong>{{ Math.max(0, job.currentSessionIndex) + 1 }}</strong>/{{ job.totalSessions }}
        </span>
        <span class="job-counter job-counter--time">
          {{ job.endedAt ? `terminou em ${formatTimeAgo(job.endedAt)}` : `a correr há ${formatTimeAgo(job.startedAt)}` }}
        </span>
      </div>

      <div v-if="job && job.results.length" class="job-sessions">
        <table class="admin-table admin-table--compact">
          <thead>
            <tr>
              <th>#</th>
              <th v-if="job.kind === 'both'">Tipo</th>
              <th>Biblioteca</th>
              <th class="job-col-count">Iniciados</th>
              <th class="job-col-count">OK</th>
              <th class="job-col-count">Erros</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, ri) in job.results"
              :key="`${r.kind}-${r.session}-${ri}`"
              :class="{
                'job-row--current': ri === job.currentSessionIndex && jobActive,
                'job-row--ok': r.exitCode === 0,
                'job-row--err': r.exitCode !== null && r.exitCode !== 0,
              }"
            >
              <td class="admin-td-idx">{{ r.session }}</td>
              <td v-if="job.kind === 'both'" class="job-col-kind">
                <span class="kind-pill" :class="`kind-pill--${r.kind}`">{{ r.kind === 'trailers' ? 'trailer' : 'preview' }}</span>
              </td>
              <td :class="{ 'job-td-lib--tall': r.failedItems?.length }">
                <div class="job-row-title" :title="r.path">{{ r.title || r.path }}</div>
                <ul v-if="r.failedItems?.length" class="job-failed-inline">
                  <li v-for="(fi, fiIx) in r.failedItems" :key="fiIx">
                    <span class="job-failed-file">{{ fi.file }}</span>
                    <span class="job-failed-msg">{{ fi.message }}</span>
                  </li>
                </ul>
              </td>
              <td class="job-col-count">{{ r.startedCount }}</td>
              <td class="job-col-count">{{ r.okCount }}</td>
              <td class="job-col-count">{{ r.errCount }}</td>
              <td>{{ sessionStatusLabel(r, job.currentSessionIndex, ri) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <details v-if="job && job.lines.length" class="job-tail-details" open>
        <summary class="job-tail-summary">
          Saída ao vivo
          <span class="job-tail-meta">
            {{ job.lines.length }}/{{ job.totalLines }} linhas
            <label class="job-tail-autoscroll">
              <input v-model="autoScrollTail" type="checkbox" /> auto-scroll
            </label>
          </span>
        </summary>
        <pre ref="tailRef" class="admin-pre job-tail" @scroll="onTailScroll">{{ '' }}<span
          v-for="line in job.lines"
          :key="line.seq"
          :class="lineCssClass(line)"
        >{{ line.text }}{{ '\n' }}</span></pre>
      </details>

      <p v-if="job && jobActive" class="admin-muted job-tip">
        O script corre no servidor; podes fechar ou abrir o Admin neste ou outro dispositivo — com o mesmo token
        voltas a ver o progresso (job activo global no servidor).
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
interface MenuRow {
  path: string
  title: string
}

const token = ref('')
const rows = ref<MenuRow[]>([])
const source = ref<'file' | 'env' | ''>('')
const loadError = ref('')
const saveMsg = ref('')
const saveErr = ref('')
const saveBusy = ref(false)

/** Linha de texto: contagens (R/T/P); segunda linha: cruzamento preview. */
interface LibraryFolderStatsApiResult {
  session: number
  path: string
  ok: boolean
  error?: string
  rootVideoCount?: number
  trailerCatalogFiles?: number
  trailerIgnoredFiles?: number
  previewDirVideoFiles?: number
  trailersDirExists?: boolean
  previewDirExists?: boolean
  trailersWithDedicatedPreview?: number
  trailersWithoutDedicatedPreview?: number
  previewOrphanVideoFiles?: number
}

const statsCountsByRow = ref<Record<number, string>>({})
const statsPairByRow = ref<Record<number, string>>({})
const statsBusy = ref(false)
const statsErr = ref('')
const statsRowLoading = ref<number | null>(null)

interface SyncFailureRow {
  sessionIndex: number
  libraryTitle: string
  libraryPath: string
  phase: string
  sourceFile: string
  detail: string
}
const syncFailures = ref<{
  savedAt: string
  jobId: string
  jobStatus: string
  items: SyncFailureRow[]
}>({ savedAt: '', jobId: '', jobStatus: '', items: [] })
const failuresBusy = ref(false)
const failuresErr = ref('')
const failuresHydrated = ref(false)

interface AutoTagsApiResponse {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  truncated?: boolean
}

const autoTagsDryRun = ref(false)
const autoTagsClearManual = ref(false)
const autoTagsBusy = ref(false)
const autoTagsErr = ref('')
const autoTagsResult = ref<AutoTagsApiResponse | null>(null)

const autoTagsMergedOutput = computed(() => {
  const r = autoTagsResult.value
  if (!r) return ''
  const parts: string[] = []
  if (r.stdout?.trim()) parts.push('[stdout]\n' + r.stdout)
  if (r.stderr?.trim()) parts.push('[stderr]\n' + r.stderr)
  return parts.join('\n\n') || '(sem texto na saída)'
})

type JobStatus = 'running' | 'done' | 'failed' | 'cancelled'
type JobBatKind = 'trailers' | 'previews'
type JobKind = JobBatKind | 'both'
interface JobLine {
  seq: number
  at: number
  session: number
  phase: JobBatKind | 'meta'
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}
interface JobSessionResult {
  kind: JobBatKind
  session: number
  title: string
  path: string
  exitCode: number | null
  startedCount: number
  okCount: number
  errCount: number
  error?: string
  startedAt?: number
  endedAt?: number
  failedItems?: { file: string; message: string }[]
}
interface JobSnapshot {
  id: string
  kind: JobKind
  all: boolean
  status: JobStatus
  startedAt: number
  endedAt: number | null
  totalSessions: number
  currentSessionIndex: number
  totals: { started: number; ok: number; err: number }
  results: JobSessionResult[]
  lines: JobLine[]
  totalLines: number
  cancelRequested: boolean
}

const job = ref<JobSnapshot | null>(null)
const jobErr = ref('')
const jobActive = computed(() => job.value?.status === 'running')
const VISIBLE_LINES_CAP = 400
const tailRef = ref<HTMLPreElement | null>(null)
const autoScrollTail = ref(true)
const SYNC_JOB_STORAGE_KEY = 'video_admin_sync_job_id'
let eventSource: EventSource | null = null
let endedAutoBroadcastFor: string | null = null

/** Plataforma do processo Node (servidor), vinda de GET /api/admin/menu. */
const serverPlatform = ref('')
const isWinServer = computed(() => serverPlatform.value === 'win32')

/** Mensagem temporária para o botão "Recarregar bibliotecas". */
const reloadMsg = ref('')
let reloadMsgTimer: ReturnType<typeof setTimeout> | null = null
const stopServerBusy = ref(false)
const stopServerMsg = ref('')
const stopServerErr = ref('')

const broadcastSupported = computed(
  () => import.meta.client && typeof BroadcastChannel !== 'undefined',
)

let libraryRefreshChannel: BroadcastChannel | null = null

function ensureLibraryRefreshChannel(): BroadcastChannel | null {
  if (!import.meta.client || typeof BroadcastChannel === 'undefined') return null
  if (!libraryRefreshChannel) {
    try {
      libraryRefreshChannel = new BroadcastChannel('video-player-library')
    } catch {
      libraryRefreshChannel = null
    }
  }
  return libraryRefreshChannel
}

/** Avisa todos os separadores do reprodutor (no mesmo browser) para chamar loadSessions+loadTrailers. */
function broadcastLibraryRefresh(): boolean {
  const ch = ensureLibraryRefreshChannel()
  if (!ch) return false
  try {
    ch.postMessage({ type: 'library-refresh', at: Date.now() })
    return true
  } catch {
    return false
  }
}

function flashReloadMsg(text: string) {
  reloadMsg.value = text
  if (reloadMsgTimer) clearTimeout(reloadMsgTimer)
  reloadMsgTimer = setTimeout(() => {
    reloadMsg.value = ''
  }, 4000)
}

async function reloadLibrariesAndBroadcast() {
  await loadMenu()
  const sent = broadcastLibraryRefresh()
  flashReloadMsg(
    sent
      ? 'Menu recarregado. Sinal enviado ao reprodutor neste browser — outras janelas/dispositivos precisam de recarregar (F5).'
      : 'Menu recarregado. Este browser não suporta BroadcastChannel: recarregue o reprodutor manualmente (F5).',
  )
}

async function stopServerProcess() {
  if (stopServerBusy.value) return
  stopServerErr.value = ''
  stopServerMsg.value = ''
  if (!confirm('Parar o servidor agora?\n\nEsta ação encerra o processo Node atual.')) return
  if (!confirm('Confirma mesmo o encerramento do servidor?')) return
  stopServerBusy.value = true
  try {
    const h = await adminHeaders()
    await $fetch('/api/admin/stop-server', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: {},
    })
    stopServerMsg.value = 'Sinal enviado. O servidor deve encerrar em instantes.'
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    stopServerErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao parar servidor.'
  } finally {
    stopServerBusy.value = false
  }
}

onMounted(() => {
  if (!import.meta.client) return
  token.value = sessionStorage.getItem('video_admin_token') ?? ''
  if (token.value.trim()) {
    void Promise.all([loadMenu(), bootstrapSyncJobOnAdminLoad(), loadSyncFailures()])
  }
})

onUnmounted(() => {
  if (reloadMsgTimer) {
    clearTimeout(reloadMsgTimer)
    reloadMsgTimer = null
  }
  if (libraryRefreshChannel) {
    try {
      libraryRefreshChannel.close()
    } catch {
      /* ignore */
    }
    libraryRefreshChannel = null
  }
  closeStream()
})

async function adminHeaders(): Promise<Record<string, string>> {
  const t = token.value.trim()
  if (!t) throw new Error('Preencha o token e guarde.')
  return { Authorization: `Bearer ${t}` }
}

function formatFailuresDate(iso: string): string {
  const s = iso.trim()
  if (!s) return ''
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : s
}

async function loadSyncFailures() {
  failuresErr.value = ''
  const t = token.value.trim()
  if (!t) {
    failuresHydrated.value = true
    syncFailures.value = { savedAt: '', jobId: '', jobStatus: '', items: [] }
    return
  }
  failuresBusy.value = true
  try {
    const h = await adminHeaders()
    const data = await $fetch<{
      savedAt?: string
      jobId?: string
      jobStatus?: string
      items?: SyncFailureRow[]
    }>('/api/admin/sync-failures-log', { headers: h })
    syncFailures.value = {
      savedAt: data.savedAt ?? '',
      jobId: data.jobId ?? '',
      jobStatus: data.jobStatus ?? '',
      items: Array.isArray(data.items) ? data.items : [],
    }
    failuresHydrated.value = true
  } catch (e: unknown) {
    failuresHydrated.value = true
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    failuresErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao ler lista de falhas.'
  } finally {
    failuresBusy.value = false
  }
}

function persistToken() {
  if (!import.meta.client) return
  sessionStorage.setItem('video_admin_token', token.value.trim())
  loadError.value = ''
  saveMsg.value = 'Token guardado neste browser.'
}

async function loadMenu() {
  loadError.value = ''
  saveMsg.value = ''
  try {
    const h = await adminHeaders()
    const data = await $fetch<{
      source: 'file' | 'env'
      serverPlatform: string
      items: MenuRow[]
    }>('/api/admin/menu', { headers: h })
    source.value = data.source
    serverPlatform.value = data.serverPlatform || ''
    rows.value = data.items.map((e) => ({ path: e.path, title: e.title }))
    if (!rows.value.length) {
      rows.value = [{ path: '', title: '' }]
    }
    statsCountsByRow.value = {}
    statsPairByRow.value = {}
    statsErr.value = ''
    if (!jobActive.value) void attachToRunningSyncJobFromServer()
    void loadSyncFailures()
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    loadError.value = ex?.data?.statusMessage || ex?.message || 'Falha ao carregar o menu.'
    rows.value = []
    source.value = ''
    statsCountsByRow.value = {}
    statsPairByRow.value = {}
  }
}

function addRow() {
  rows.value.push({ path: '', title: '' })
}

function removeLastRow() {
  if (rows.value.length <= 1) return
  rows.value.pop()
}

function removeRow(i: number) {
  if (rows.value.length <= 1) return
  if (i < 0 || i >= rows.value.length) return
  const row = rows.value[i]
  const isEmpty = !row.path.trim() && !row.title.trim()
  if (!isEmpty) {
    const label = (row.title || row.path || `linha ${i}`).trim() || `linha ${i}`
    if (!confirm(`Remover esta pasta do menu?\n\n${label}\n\n(Apenas remove a entrada — não apaga ficheiros. Lembre-se de gravar o menu no fim.)`)) return
  }
  rows.value.splice(i, 1)
}

async function saveMenu() {
  saveErr.value = ''
  saveMsg.value = ''
  const valid = rows.value.filter((r) => r.path.trim())
  if (!valid.length) {
    saveErr.value = 'Indique pelo menos um caminho.'
    return
  }
  saveBusy.value = true
  try {
    const h = await adminHeaders()
    await $fetch('/api/admin/menu', {
      method: 'PUT',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: { items: valid },
    })
    saveMsg.value = 'Menu gravado. Recarregue o reprodutor para aplicar (ou mude de biblioteca).'
    await loadMenu()
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    saveErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao gravar.'
  } finally {
    saveBusy.value = false
  }
}

function formatTimeAgo(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}m`
}

function pruneLinesIfNeeded(snap: JobSnapshot) {
  if (snap.lines.length > VISIBLE_LINES_CAP) {
    snap.lines.splice(0, snap.lines.length - VISIBLE_LINES_CAP)
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
  const distFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
  autoScrollTail.value = distFromBottom < 16
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
    if (id) sessionStorage.setItem(SYNC_JOB_STORAGE_KEY, id)
    else sessionStorage.removeItem(SYNC_JOB_STORAGE_KEY)
  } catch {
    /* */
  }
}

function maybeAutoBroadcastOnFinish(snap: JobSnapshot) {
  if (snap.status !== 'done') return
  if (endedAutoBroadcastFor === snap.id) return
  endedAutoBroadcastFor = snap.id
  if (broadcastLibraryRefresh()) {
    flashReloadMsg('Sincronização concluída. Reprodutor avisado para refazer a lista.')
  }
}

function openStreamForJob(jobId: string) {
  closeStream()
  const t = token.value.trim()
  if (!t) {
    jobErr.value = 'Token em falta — guarde-o e tente de novo.'
    return
  }
  const url = `/api/admin/sync-stream?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(t)}`
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
      const snap = JSON.parse((ev as MessageEvent).data) as JobSnapshot
      job.value = snap
      void scrollTailToBottom()
      maybeAutoBroadcastOnFinish(snap)
    } catch {
      /* */
    }
  })
  es.addEventListener('line', (ev) => {
    if (!job.value) return
    try {
      const line = JSON.parse((ev as MessageEvent).data) as JobLine
      if (line.seq <= job.value.totalLines && job.value.lines.some((l) => l.seq === line.seq)) return
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
        currentSessionIndex: number
      }
      job.value.totals = data.totals
      job.value.currentSessionIndex = data.currentSessionIndex
    } catch {
      /* */
    }
  })
  es.addEventListener('session-end', (ev) => {
    if (!job.value) return
    try {
      const data = JSON.parse((ev as MessageEvent).data) as {
        session: number
        result: JobSessionResult
      }
      const target = data.result
      // Em `both` há duas linhas por sessão (trailers + previews) — temos de casar
      // por (session, kind) e procurar a primeira ainda sem `endedAt`.
      const idx = job.value.results.findIndex(
        (r) => r.session === target.session && r.kind === target.kind && !r.endedAt,
      )
      const fallback = job.value.results.findIndex(
        (r) => r.session === target.session && r.kind === target.kind,
      )
      const useIdx = idx >= 0 ? idx : fallback
      if (useIdx >= 0) job.value.results[useIdx] = { ...target }
    } catch {
      /* */
    }
  })
  es.addEventListener('status', (ev) => {
    if (!job.value) return
    try {
      const data = JSON.parse((ev as MessageEvent).data) as { status: JobStatus }
      job.value.status = data.status
      if (data.status !== 'running') job.value.endedAt = Date.now()
      if (data.status !== 'running') void loadSyncFailures()
    } catch {
      /* */
    }
  })
  es.addEventListener('end', (ev) => {
    try {
      const snap = JSON.parse((ev as MessageEvent).data) as JobSnapshot
      job.value = snap
      maybeAutoBroadcastOnFinish(snap)
    } catch {
      /* */
    }
    closeStream()
    rememberJobId(null)
    void loadSyncFailures()
  })
  es.onerror = () => {
    // Não propaga UI: o EventSource tenta reconectar sozinho. Se o job já tinha terminado,
    // o snapshot ficou marcado e o servidor rejeita a próxima chamada (404) → fechamos.
    if (!job.value || job.value.status !== 'running') {
      closeStream()
    }
  }
}

async function bootstrapSyncJobOnAdminLoad() {
  const savedJobId = sessionStorage.getItem(SYNC_JOB_STORAGE_KEY) ?? ''
  if (savedJobId) await attachToJob(savedJobId)
  if (!jobActive.value) await attachToRunningSyncJobFromServer()
}

/** Reanexa ao job de trailers/previews que já está a correr neste servidor (outro separador ou sem sessionStorage). */
async function attachToRunningSyncJobFromServer() {
  if (jobActive.value) return
  try {
    const h = await adminHeaders()
    const data = await $fetch<{ syncRunningJob?: JobSnapshot | null }>('/api/admin/sync-status', {
      headers: h,
    })
    const run = data.syncRunningJob
    if (run?.status === 'running' && run.id) {
      jobErr.value = ''
      rememberJobId(run.id)
      await attachToJob(run.id)
    }
  } catch {
    /* rede ou token inválido ao pedir estado global */
  }
}

async function attachToJob(jobId: string) {
  jobErr.value = ''
  try {
    const h = await adminHeaders()
    const snap = await $fetch<JobSnapshot>(
      `/api/admin/sync-status?jobId=${encodeURIComponent(jobId)}`,
      { headers: h },
    )
    job.value = snap
    rememberJobId(snap.status === 'running' ? snap.id : null)
    void scrollTailToBottom()
    if (snap.status === 'running') {
      openStreamForJob(jobId)
    } else {
      maybeAutoBroadcastOnFinish(snap)
      void loadSyncFailures()
    }
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string; statusCode?: number }
    jobErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao ler estado do job.'
    rememberJobId(null)
  }
}

async function startSyncJob(kind: JobKind, opts: { all?: boolean; session?: number }) {
  if (jobActive.value) return
  jobErr.value = ''
  try {
    const h = await adminHeaders()
    const data = await $fetch<{ jobId: string }>('/api/admin/sync-start', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: { kind, ...(opts.all ? { all: true } : { session: opts.session }) },
    })
    endedAutoBroadcastFor = null
    rememberJobId(data.jobId)
    await attachToJob(data.jobId)
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    jobErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao iniciar a sincronização.'
  }
}

async function runAutoTags(opts: { all?: boolean; session?: number }) {
  if (autoTagsBusy.value || jobActive.value) return

  const clearManual = autoTagsClearManual.value
  if (clearManual) {
    if (
      !confirm(
        'Limpar todas as tags na base (automatic + manuais) antes do pipeline? Equivalente ao flag --all. Não dá para anular só isto.',
      )
    )
      return
  }

  autoTagsBusy.value = true
  autoTagsErr.value = ''
  autoTagsResult.value = null
  try {
    const h = await adminHeaders()
    const data = await $fetch<AutoTagsApiResponse>('/api/admin/auto-tags', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: {
        dryRun: autoTagsDryRun.value,
        all: opts.all === true,
        ...(opts.all === true ? {} : { session: opts.session }),
        clearManual,
      },
    })
    autoTagsResult.value = data
    if (!data.ok) {
      autoTagsErr.value = `O pipeline terminou com código ${data.exitCode}.`
    } else {
      flashReloadMsg(
        'Pipeline auto-tags concluído. Recarrega o reprodutor (F5) para ver tags actualizadas.',
      )
    }
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    autoTagsErr.value = ex?.data?.statusMessage || ex?.message || 'Falha ao correr auto-tags.'
  } finally {
    autoTagsBusy.value = false
  }
}

async function cancelCurrentJob() {
  if (!job.value || !jobActive.value) return
  if (!confirm('Cancelar a sincronização em curso? O ficheiro a meio será descartado.')) return
  jobErr.value = ''
  try {
    const h = await adminHeaders()
    await $fetch('/api/admin/sync-cancel', {
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
  endedAutoBroadcastFor = null
  rememberJobId(null)
}

function statusLabel(s: JobStatus): string {
  if (s === 'running') return 'A correr'
  if (s === 'done') return 'Concluído'
  if (s === 'failed') return 'Falhou'
  return 'Cancelado'
}

function kindLabel(k: JobKind): string {
  if (k === 'both') return 'trailers + previews'
  return k
}

function jobScopeLabel(snap: JobSnapshot): string {
  const scope = snap.all
    ? '(todas)'
    : `(sessão ${snap.results[0]?.session ?? '?'})`
  return `${kindLabel(snap.kind)} ${scope}`
}

function sessionStatusLabel(r: JobSessionResult, currentIdx: number, rowIdx: number): string {
  if (r.exitCode === null) {
    if (rowIdx === currentIdx) return 'a correr'
    if (rowIdx < currentIdx) return '—'
    return 'à espera'
  }
  if (r.exitCode === 0) return 'OK'
  if (r.error) return r.error
  return `exit ${r.exitCode}`
}

function lineCssClass(line: JobLine): string {
  if (line.stream === 'stderr') return 'tail-line tail-line--err'
  if (line.stream === 'meta') return 'tail-line tail-line--meta'
  const t = line.text.trimStart()
  if (t.startsWith('[OK]')) return 'tail-line tail-line--ok'
  if (t.startsWith('[ERRO]')) return 'tail-line tail-line--err'
  if (t.startsWith('[PROCESSANDO]')) return 'tail-line tail-line--proc'
  return 'tail-line'
}

function formatStatsCountsLine(r: LibraryFolderStatsApiResult): string {
  if (!r.ok) return r.error ? `Erro: ${r.error}` : 'Erro'
  const warn: string[] = []
  if (r.trailersDirExists === false) warn.push('sem trailers/')
  if (r.previewDirExists === false) warn.push('sem preview/')
  const tail = warn.length ? ` · ${warn.join(', ')}` : ''
  const ign = r.trailerIgnoredFiles ? ` (${r.trailerIgnoredFiles} ign.)` : ''
  return `R:${r.rootVideoCount ?? '?'} · T:${r.trailerCatalogFiles ?? '?'}${ign} · P:${r.previewDirVideoFiles ?? '?'}${tail}`
}

function formatStatsPairLine(r: LibraryFolderStatsApiResult): string {
  if (!r.ok) return ''
  const hasDedicated =
    typeof r.trailersWithDedicatedPreview === 'number' &&
    typeof r.trailersWithoutDedicatedPreview === 'number'
  const orph =
    typeof r.previewOrphanVideoFiles === 'number' ? r.previewOrphanVideoFiles : null
  if (!hasDedicated && orph === null) return ''
  if (!hasDedicated) return `órf.preview ${orph}`
  const ded = r.trailersWithDedicatedPreview ?? 0
  const noDed = r.trailersWithoutDedicatedPreview ?? '—'
  const o = orph ?? 0
  return `Prev.ded. ${ded} · s/preview ${noDed} · órf.preview ${o}`
}

async function checkFolderStatsRow(rowIndex: number, mode: 'counts' | 'pairing') {
  statsErr.value = ''
  const path = rows.value[rowIndex]?.path?.trim() ?? ''
  if (!path) {
    statsErr.value = 'Preenche o caminho desta linha antes de checar.'
    return
  }
  statsBusy.value = true
  statsRowLoading.value = rowIndex
  try {
    const h = await adminHeaders()
    const data = await $fetch<{ results: LibraryFolderStatsApiResult[] }>('/api/admin/library-folder-stats', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: {
        mode,
        items: [{ session: rowIndex, path }],
      },
    })
    const r = data.results[0]
    if (!r) return
    statsCountsByRow.value = { ...statsCountsByRow.value, [rowIndex]: formatStatsCountsLine(r) }
    if (mode === 'pairing') {
      statsPairByRow.value = { ...statsPairByRow.value, [rowIndex]: formatStatsPairLine(r) }
    }
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    statsErr.value = ex?.data?.statusMessage || ex?.message || 'Falha na checagem.'
  } finally {
    statsBusy.value = false
    statsRowLoading.value = null
  }
}

async function checkFolderStatsAll(mode: 'counts' | 'pairing') {
  statsErr.value = ''
  const items = rows.value.map((row, session) => ({ session, path: row.path }))
  statsBusy.value = true
  statsRowLoading.value = null
  try {
    const h = await adminHeaders()
    const data = await $fetch<{ results: LibraryFolderStatsApiResult[] }>('/api/admin/library-folder-stats', {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: { mode, items },
    })
    const counts: Record<number, string> = { ...statsCountsByRow.value }
    const pairs: Record<number, string> = { ...statsPairByRow.value }
    for (const r of data.results) {
      counts[r.session] = formatStatsCountsLine(r)
      if (mode === 'pairing') pairs[r.session] = formatStatsPairLine(r)
    }
    statsCountsByRow.value = counts
    if (mode === 'pairing') statsPairByRow.value = pairs
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    statsErr.value = ex?.data?.statusMessage || ex?.message || 'Falha na checagem.'
  } finally {
    statsBusy.value = false
  }
}
</script>

<style scoped>
.admin-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: clamp(0.75rem, 2vw, 1.5rem);
  color: #e8eaed;
  font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
  flex: 1 1 auto;
  width: 100%;
  box-sizing: border-box;
  min-height: 100dvh;
  min-height: 100%;
  background: #0c0d10;
}

.admin-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.admin-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
}

.admin-back {
  color: #8ab4f8;
  text-decoration: none;
  font-weight: 600;
}

.admin-back:hover {
  text-decoration: underline;
}

.admin-lead,
.admin-muted {
  color: #9aa0a6;
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0 0 1rem;
}

.admin-muted--tight {
  margin-top: -0.5rem;
  font-size: 0.82rem;
}

.admin-code {
  font-size: 0.85em;
  background: #1a1d22;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  color: #c8e4ff;
}

.admin-warn {
  background: #2a2415;
  border: 1px solid #6b5a2a;
  color: #fdd663;
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  font-size: 0.88rem;
  margin: 0 0 1rem;
}

.admin-warn--sync {
  margin-top: 0.35rem;
}

.admin-card {
  background: #15171c;
  border: 1px solid #2d333b;
  border-radius: 10px;
  padding: 1rem 1.1rem;
  margin-bottom: 1rem;
}

.admin-card--log {
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
}

.admin-h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 700;
  color: #e8eaed;
}

.admin-h3 {
  margin: 1rem 0 0.35rem;
  font-size: 0.92rem;
  font-weight: 700;
  color: #bdc1c6;
}

.admin-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.5rem;
}

.admin-row--checks {
  gap: 1rem;
}

.admin-check-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: #bdc1c6;
  cursor: pointer;
}

.admin-check-label input {
  cursor: pointer;
}

.admin-check-label--warn {
  color: #f0b88c;
}

.admin-input {
  flex: 1;
  min-width: 0;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid #454a53;
  background: #0c0d10;
  color: #e8eaed;
  font: inherit;
  font-size: 0.88rem;
}

.admin-input--wide {
  flex: 2 1 240px;
  min-width: 200px;
}

.admin-btn {
  padding: 0.45rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}

.admin-btn:hover:not(:disabled) {
  background: #2d333b;
}

.admin-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.admin-btn--ghost {
  background: transparent;
}

.admin-btn--primary {
  background: #1a73e8;
  border-color: #1a73e8;
  color: #fff;
}

.admin-btn--sm {
  padding: 0.28rem 0.45rem;
  font-size: 0.78rem;
}

.admin-meta {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: #9aa0a6;
}

.admin-err {
  color: #f8b4b0;
  margin: 0.5rem 0 0;
  font-size: 0.88rem;
}

.admin-ok {
  color: #81c995;
  margin: 0.5rem 0 0;
  font-size: 0.88rem;
}

.admin-table-wrap {
  overflow-x: auto;
  margin: 0.75rem 0;
  width: 100%;
  min-width: 0;
  align-self: stretch;
  background-color: #14161c;
  border-radius: 8px;
  border: 1px solid #2d333b;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  table-layout: auto;
}

.admin-col-idx {
  width: 2.5rem;
}

.admin-col-path {
  width: 38%;
}

.admin-col-title {
  width: 22%;
}

.admin-col-check {
  min-width: 11.5rem;
  width: 18%;
}

.admin-col-sync {
  width: 1px;
}

.admin-col-autotags {
  width: 1px;
}

.admin-td-autotags {
  white-space: nowrap;
}

.admin-td-sync,
.admin-td-autotags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.admin-col-del {
  width: 1px;
}

.admin-table th,
.admin-table td {
  border: 1px solid #2d333b;
  padding: 0.35rem 0.45rem;
  text-align: left;
  vertical-align: middle;
}

.admin-table--folders tbody td {
  background-color: #17181e;
  color: #e8eaed;
}

.admin-table--folders tbody tr:hover td {
  background-color: #1f2229;
}

.admin-table th {
  background: #1a1d22;
  color: #bdc1c6;
  font-weight: 600;
}

.admin-td-idx {
  text-align: center;
  color: #9aa0a6;
}


.admin-input--full {
  width: 100%;
  box-sizing: border-box;
}

.admin-td-check {
  font-size: 0.74rem;
  line-height: 1.35;
  color: #bdc1c6;
  vertical-align: top;
}

.admin-check-lines--dim {
  opacity: 0.45;
}

.admin-check-line {
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}

.admin-check-line--sub {
  color: #9aa0a6;
  margin-top: 0.2rem;
  font-size: 0.7rem;
}

.admin-check-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.4rem;
}

.admin-td-sync {
  white-space: nowrap;
}

.admin-td-sync .admin-btn {
  margin-right: 0.35rem;
}

.admin-td-del {
  text-align: center;
  white-space: nowrap;
}

.admin-btn--danger {
  border-color: #5b2a2a;
  background: #2a1717;
  color: #f8b4b0;
}

.admin-btn--danger:hover:not(:disabled) {
  background: #3a1f1f;
  border-color: #7a3838;
  color: #ffd0cc;
}

.admin-btn-icon {
  width: 16px;
  height: 16px;
  display: block;
}

.admin-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.admin-pre {
  margin: 0;
  flex: 1;
  min-height: 120px;
  overflow: auto;
  font-size: 0.78rem;
  line-height: 1.35;
  background: #0c0d10;
  color: #bdc1c6;
  padding: 0.65rem;
  border-radius: 8px;
  border: 1px solid #2d333b;
}

.admin-pre--autotags {
  max-height: min(45vh, 320px);
  min-height: 80px;
  margin-top: 0.5rem;
}

.admin-autotags-details {
  margin-top: 0.65rem;
}

.admin-autotags-summary {
  cursor: pointer;
  color: #bdc1c6;
  font-size: 0.88rem;
}

.admin-btn--danger {
  background: #3a1f20;
  border-color: #c5302a;
  color: #f8b4b0;
}

.admin-btn--danger:hover:not(:disabled) {
  background: #4a2a2c;
}

.job-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.job-head .admin-h2 {
  margin: 0;
}

.job-kind {
  color: #9aa0a6;
  font-weight: 500;
  font-size: 0.85rem;
}

.job-head-actions {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.job-status {
  font-size: 0.78rem;
  font-weight: 700;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  border: 1px solid #454a53;
  background: #252a32;
  color: #bdc1c6;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.job-status--running {
  background: #1a2a3d;
  border-color: #2f6cb6;
  color: #8ab4f8;
}

.job-status--done {
  background: #1a3a23;
  border-color: #2c8c4a;
  color: #81c995;
}

.job-status--failed {
  background: #3a1f20;
  border-color: #c5302a;
  color: #f8b4b0;
}

.job-status--cancelled {
  background: #2a2415;
  border-color: #6b5a2a;
  color: #fdd663;
}

.job-counters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.85rem;
  font-size: 0.85rem;
  color: #bdc1c6;
  margin: 0.45rem 0 0.65rem;
}

.job-counter strong {
  font-size: 0.95rem;
  color: #e8eaed;
}

.job-counter--ok strong {
  color: #81c995;
}

.job-counter--err strong {
  color: #f8b4b0;
}

.job-counter--time {
  color: #9aa0a6;
}

.admin-table--compact th,
.admin-table--compact td {
  padding: 0.25rem 0.4rem;
  font-size: 0.8rem;
}

.admin-table--compact tbody td {
  background-color: #17181e;
}

.failures-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.failures-head .admin-h2 {
  margin: 0;
}

.failures-meta-summary {
  margin: 0 0 0.75rem;
}

.failures-list {
  list-style: none;
  padding: 0;
  margin: 0.35rem 0 0;
  max-height: min(52vh, 400px);
  overflow: auto;
}

.failures-item {
  border: 1px solid #2d333b;
  border-radius: 8px;
  padding: 0.45rem 0.55rem;
  margin-bottom: 0.45rem;
  background: #14161c;
}

.failures-item-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.failures-phase {
  font-size: 0.66rem;
  font-weight: 700;
  padding: 0.08rem 0.42rem;
  border-radius: 4px;
  text-transform: lowercase;
}

.failures-phase--trailers {
  background: color-mix(in srgb, #d97a2a 22%, transparent);
  color: #ffd9b8;
}

.failures-phase--previews {
  background: color-mix(in srgb, #2f6cb6 22%, transparent);
  color: #cfe1f6;
}

.failures-sess {
  font-size: 0.72rem;
  color: #9aa0a6;
}

.failures-file {
  font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.8rem;
  color: #cfe1f6;
  margin-top: 0.25rem;
  word-break: break-all;
}

.failures-detail {
  font-size: 0.8rem;
  color: #f8b4b0;
  margin-top: 0.2rem;
  line-height: 1.35;
}

.failures-lib {
  font-size: 0.74rem;
  color: #9aa0a6;
  margin-top: 0.2rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.failures-loading {
  margin-top: 0.35rem;
}

.job-failed-inline {
  list-style: none;
  padding: 0;
  margin: 0.35rem 0 0;
  max-width: 28rem;
}

.job-failed-inline li {
  margin-top: 0.2rem;
}

.job-failed-file {
  display: block;
  font-size: 0.72rem;
  color: #fdd663;
  word-break: break-all;
}

.job-failed-msg {
  display: block;
  font-size: 0.7rem;
  color: #f8b4b0;
  line-height: 1.3;
  word-break: break-word;
}

.job-col-count {
  text-align: right;
  width: 4.5rem;
  font-variant-numeric: tabular-nums;
}

.job-row-title {
  max-width: 32rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-td-lib--tall .job-row-title {
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
}

.job-col-kind {
  width: 5.5rem;
}

.kind-pill {
  display: inline-block;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  border: 1px solid transparent;
}

.kind-pill--trailers {
  background: color-mix(in srgb, #d97a2a 25%, transparent);
  color: #ffd9b8;
  border-color: color-mix(in srgb, #d97a2a 60%, transparent);
}

.kind-pill--previews {
  background: color-mix(in srgb, #2f6cb6 25%, transparent);
  color: #cfe1f6;
  border-color: color-mix(in srgb, #2f6cb6 60%, transparent);
}

.job-row--current {
  background: color-mix(in srgb, #2f6cb6 18%, transparent);
}

.job-row--ok td {
  color: #cfe9d4;
}

.job-row--err td {
  color: #f8b4b0;
}

.job-tail-details {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.job-tail-summary {
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  color: #bdc1c6;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.job-tail-meta {
  font-weight: 400;
  font-size: 0.78rem;
  color: #9aa0a6;
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
}

.job-tail-autoscroll {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.job-tail {
  margin-top: 0.35rem;
  white-space: pre;
  max-height: 40vh;
  min-height: 180px;
}

.tail-line {
  display: block;
}

.tail-line--meta {
  color: #8ab4f8;
}

.tail-line--ok {
  color: #81c995;
}

.tail-line--err {
  color: #f8b4b0;
}

.tail-line--proc {
  color: #fdd663;
}

.job-tip {
  font-size: 0.78rem;
  margin-top: 0.5rem;
}
</style>
