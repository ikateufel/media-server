<template>
  <div class="admin-page">
    <header class="admin-head">
      <h1 class="admin-title">Histórico de jobs</h1>
      <div class="admin-head-links">
        <NuxtLink to="/" class="admin-back">← Reprodutor</NuxtLink>
        <NuxtLink to="/admin" class="admin-back">Admin</NuxtLink>
        <NuxtLink to="/shrink" class="admin-back">Shrink</NuxtLink>
        <NuxtLink to="/editor" class="admin-back">Editor</NuxtLink>
      </div>
    </header>

    <p class="admin-lead">
      Lista permanente de vídeos shrinkados e trailers reprocessados. Limpar a fila activa no
      reprodutor <strong>não apaga</strong> este histórico
      (<code class="admin-code">data/process-job-history.json</code>).
    </p>

    <section class="admin-card">
      <div class="admin-row hist-filters">
        <label class="hist-filter">
          <span>Tipo</span>
          <select v-model="kindFilter" class="admin-input" @change="loadHistory">
            <option value="all">Todos</option>
            <option value="shrink">Shrink</option>
            <option value="trailer">Trailer</option>
          </select>
        </label>
        <button type="button" class="admin-btn" :disabled="loading" @click="loadHistory">
          Actualizar
        </button>
      </div>
      <p v-if="loadError" class="admin-err">{{ loadError }}</p>
      <p v-else-if="loading" class="admin-muted">A carregar…</p>
      <p v-else-if="!items.length" class="admin-muted">Ainda sem entradas no histórico.</p>
      <ul v-else class="hist-list">
        <li
          v-for="item in items"
          :key="item.id"
          class="hist-item"
          :class="`hist-item--${item.status}`"
        >
          <div class="hist-item-top">
            <span class="hist-kind">{{ item.kind === 'shrink' ? 'Shrink' : 'Trailer' }}</span>
            <span class="hist-status">{{ item.status === 'done' ? 'ok' : 'falhou' }}</span>
            <span class="hist-when" :title="formatFull(item.endedAt)">{{ formatWhen(item.endedAt) }}</span>
          </div>
          <div class="hist-label" :title="item.mainRel">{{ item.label }}</div>
          <div class="hist-meta">
            sessão {{ item.session }} · {{ item.mainRel }}
          </div>
          <p v-if="item.error" class="hist-error">{{ item.error }}</p>
          <div class="hist-actions">
            <a
              class="hist-open-catalog"
              :href="catalogOpenHref(item)"
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir no catálogo
            </a>
            <button
              v-if="item.log"
              type="button"
              class="hist-log-toggle"
              @click="toggleLog(item.id)"
            >
              {{ expandedLogId === item.id ? 'Ocultar log' : 'Ver log' }}
            </button>
          </div>
          <pre v-if="item.log && expandedLogId === item.id" class="hist-log">{{ item.log }}</pre>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
interface HistItem {
  id: string
  kind: 'shrink' | 'trailer'
  status: 'done' | 'failed'
  session: number
  mainRel: string
  trailerRel?: string
  label: string
  error?: string
  startedAt: number
  endedAt: number
  log?: string
}

const kindFilter = ref<'all' | 'shrink' | 'trailer'>('all')
const items = ref<HistItem[]>([])
const loading = ref(false)
const loadError = ref('')
const expandedLogId = ref<string | null>(null)

function formatWhen(ms: number) {
  if (!Number.isFinite(ms)) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

function formatFull(ms: number) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : ''
}

function toggleLog(id: string) {
  expandedLogId.value = expandedLogId.value === id ? null : id
}

function catalogOpenHref(item: HistItem) {
  const parts = [`session=${encodeURIComponent(String(item.session))}`]
  const trailer = typeof item.trailerRel === 'string' ? item.trailerRel.trim().replace(/\\/g, '/') : ''
  if (trailer.toLowerCase().startsWith('trailers/')) {
    parts.push(`rel=${encodeURIComponent(trailer)}`)
  }
  const main = item.mainRel.trim().replace(/\\/g, '/')
  if (main) parts.push(`file=${encodeURIComponent(main)}`)
  return `/?${parts.join('&')}`
}

async function loadHistory() {
  loading.value = true
  loadError.value = ''
  expandedLogId.value = null
  try {
    const q = kindFilter.value === 'all' ? '' : `?kind=${kindFilter.value}`
    const res = await $fetch<{ items: HistItem[] }>(`/api/admin/process-job-history${q}`)
    items.value = Array.isArray(res.items) ? res.items : []
  } catch (e: unknown) {
    const ex = e as { data?: { statusMessage?: string }; message?: string }
    loadError.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível carregar o histórico.'
    items.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadHistory()
})
</script>

<style scoped>
.admin-page {
  max-width: 920px;
  margin: 0 auto;
  padding: 1.25rem 1rem 3rem;
  color: #e8eaed;
  font-family: system-ui, 'Segoe UI', sans-serif;
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
  margin-bottom: 0.75rem;
}
.admin-title {
  margin: 0;
  font-size: 1.45rem;
}
.admin-head-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.admin-back {
  color: #8ab4f8;
  text-decoration: none;
}
.admin-lead {
  color: #bdc1c6;
  line-height: 1.45;
  margin: 0 0 1.25rem;
}
.admin-code {
  font-size: 0.88em;
  background: #2d333b;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
}
.admin-card {
  background: #15171c;
  border: 1px solid #2d333b;
  border-radius: 12px;
  padding: 1rem 1.1rem 1.15rem;
}
.admin-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: end;
  margin-bottom: 0.85rem;
}
.admin-input {
  font: inherit;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  border: 1px solid #3c4043;
  background: #0c0d10;
  color: #e8eaed;
}
.admin-btn {
  font: inherit;
  font-weight: 600;
  padding: 0.42rem 0.85rem;
  border-radius: 8px;
  border: 1px solid #1a73e8;
  background: #1a73e8;
  color: #fff;
  cursor: pointer;
}
.admin-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.admin-muted {
  color: #9aa0a6;
}
.admin-err {
  color: #f28b82;
}
.hist-filter {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: #9aa0a6;
}
.hist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.hist-item {
  border: 1px solid #2d333b;
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
  background: #0c0d10;
}
.hist-item--failed {
  border-color: #5c2b2b;
}
.hist-item--done {
  border-color: #1e3d2f;
}
.hist-item-top {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
  margin-bottom: 0.25rem;
  font-size: 0.78rem;
}
.hist-kind {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #8ab4f8;
}
.hist-status {
  color: #bdc1c6;
}
.hist-when {
  margin-left: auto;
  color: #9aa0a6;
}
.hist-label {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hist-meta {
  font-size: 0.75rem;
  color: #80868b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 0.15rem;
}
.hist-error {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: #f28b82;
}
.hist-actions {
  margin-top: 0.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}
.hist-open-catalog {
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.28rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #1a73e8;
  background: #1a73e8;
  color: #fff;
  text-decoration: none;
  cursor: pointer;
}
.hist-open-catalog:hover {
  background: #1765cc;
}
.hist-log-toggle {
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.28rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #3c4043;
  background: #1a1d22;
  color: #e8eaed;
  cursor: pointer;
}
.hist-log-toggle:hover {
  background: #252a32;
}
.hist-log {
  margin: 0.45rem 0 0;
  padding: 0.55rem 0.65rem;
  max-height: 280px;
  overflow: auto;
  border-radius: 8px;
  border: 1px solid #2d333b;
  background: #090a0c;
  color: #bdc1c6;
  font-size: 0.72rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
