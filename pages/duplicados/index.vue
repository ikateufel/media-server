<template>
  <div class="dup-page">
    <div
      v-if="catalogGateVisible"
      class="catalog-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="catalog-gate-title"
    >
      <form v-if="!catalogGateChecking" class="catalog-gate-card" @submit.prevent="submitCatalogUnlock">
        <h1 id="catalog-gate-title" class="catalog-gate-title">Catálogo bloqueado</h1>
        <p class="catalog-gate-hint">Introduza a senha para aceder aos duplicados neste browser.</p>
        <input
          ref="catalogGateInputRef"
          v-model="catalogGatePassword"
          type="password"
          class="catalog-gate-input"
          autocomplete="current-password"
          placeholder="Senha"
          :disabled="catalogGateBusy"
        />
        <p v-if="catalogGateError" class="catalog-gate-error" role="alert">{{ catalogGateError }}</p>
        <button type="submit" class="catalog-gate-btn" :disabled="catalogGateBusy || !catalogGatePassword.trim()">
          {{ catalogGateBusy ? 'A verificar…' : 'Desbloquear' }}
        </button>
      </form>
      <p v-else class="catalog-gate-hint">A verificar acesso…</p>
    </div>

    <div v-show="!catalogGateVisible" class="dup-page-inner">
    <header class="admin-head">
      <h1 class="admin-title">Possíveis duplicados</h1>
      <div class="admin-head-links">
        <NuxtLink to="/" class="admin-back">← Reprodutor</NuxtLink>
        <NuxtLink to="/admin" class="admin-back">Admin</NuxtLink>
        <NuxtLink to="/historico" class="admin-back">Histórico</NuxtLink>
      </div>
    </header>

    <p class="admin-lead">
      Lista e veredictos em <code class="admin-code">library-tags.sqlite</code>
      (<code class="admin-code">duplicate_scan</code> / <code class="admin-code">duplicate_verdicts</code>).
      Abrir não reprocessa — usa «Correr scan» para actualizar.
    </p>

    <section class="admin-card">
      <div class="admin-row">
        <label class="admin-check-label">
          Score mín.
          <input v-model.number="minScore" type="number" class="admin-input" min="0.4" max="0.99" step="0.01" />
        </label>
        <label class="admin-check-label">
          Tags mín.
          <input v-model.number="minSharedTags" type="number" class="admin-input" min="1" max="10" step="1" />
        </label>
        <label class="admin-check-label">
          Sessão
          <input v-model="sessionFilter" type="text" class="admin-input" inputmode="numeric" placeholder="todas" />
        </label>
        <label class="admin-check-label admin-check-label--row" title="Se desligado, cada card mostra «Carregar trailer»">
          <span>Carregar trailers ao abrir grupo</span>
          <input v-model="autoLoadTrailers" type="checkbox" class="admin-check" />
        </label>
        <button type="button" class="admin-btn" :disabled="loadBusy || scanBusy" @click="loadStored">
          Actualizar lista
        </button>
        <button type="button" class="admin-btn admin-btn--primary" :disabled="scanBusy" @click="runScan">
          {{ scanBusy ? 'A processar…' : 'Correr scan e gravar' }}
        </button>
      </div>
      <div v-if="scanBusy" class="scan-progress" role="status" aria-live="polite">
        <div class="scan-progress-track">
          <div class="scan-progress-bar" :style="{ width: `${Math.max(2, scanPct)}%` }" />
        </div>
        <p class="scan-progress-text">
          <strong>{{ scanPct }}%</strong>
          · {{ scanProgressMsg || 'A processar…' }}
        </p>
      </div>
      <p v-if="err" class="admin-err">{{ err }}</p>
      <p v-else-if="metaLine" class="admin-meta">{{ metaLine }}</p>
    </section>

    <section
      v-if="focusGroup"
      class="focus-block"
      :class="{ 'focus-block--sure': isSureDuplicateGroup(focusGroup) }"
    >
      <header class="focus-head">
        <strong>Grupo {{ focusGroup.id }}</strong>
        <span
          v-if="isSureDuplicateGroup(focusGroup)"
          class="dup-sure-badge"
          title="Mesmo nome em pastas/sessões diferentes"
        >
          Batata · repetido
        </span>
        <span class="admin-meta">
          max {{ formatPct(focusGroup.maxScore) }} · {{ focusVideos.length }} vídeo{{ focusVideos.length === 1 ? '' : 's' }}
        </span>
        <span class="admin-meta">Marca «Manter» num card; Resolvido apaga os outros (Lixeira).</span>
        <button
          type="button"
          class="admin-btn"
          :disabled="verdictBusy !== null || focusVideos.length < 2"
          title="Estes títulos não são o mesmo conteúdo — só tira da lista"
          @click="submitGroupVerdict(focusGroup, 'not_duplicate')"
        >
          {{ verdictBusy === 'not_duplicate' ? 'A gravar…' : 'Não é repetido' }}
        </button>
        <button
          type="button"
          class="admin-btn admin-btn--danger"
          :disabled="verdictBusy !== null || focusVideos.length < 2 || !keepKey"
          title="Manter o marcado e apagar os outros para a Lixeira"
          @click="submitResolved(focusGroup)"
        >
          {{ verdictBusy === 'resolved' ? 'A apagar…' : 'Resolvido' }}
        </button>
      </header>

      <div class="compare-row" :class="compareRowClass">
        <article
          v-for="(v, idx) in focusVideos"
          :key="videoKey(v)"
          class="pane"
          :class="{
            'pane--keep': keepKey === videoKey(v),
            'pane--sure': isSureDuplicateGroup(focusGroup),
          }"
        >
          <header class="pane-head">
            <label class="keep-label">
              <input
                type="radio"
                name="dup-keep"
                :checked="keepKey === videoKey(v)"
                @change="keepKey = videoKey(v)"
              />
              Manter
            </label>
            <strong>#{{ idx + 1 }}</strong>
            <span class="pane-sess" :title="cardMeta(v)?.sessionLabel || ''">
              S{{ v.session }}
              <template v-if="cardMeta(v)?.sessionLabel"> · {{ cardMeta(v)!.sessionLabel }}</template>
            </span>
          </header>

          <div class="pane-video-wrap" @click="armCard(v)">
            <video
              v-if="isCardArmed(v) && cardMediaSrc(v)"
              :ref="(el) => setVideoRef(v, el)"
              :key="`${videoKey(v)}-${cardMode[videoKey(v)] || 'trailer'}`"
              class="pane-video"
              :src="cardMediaSrc(v)!"
              controls
              playsinline
              :preload="autoLoadTrailers ? 'auto' : 'none'"
              @loadeddata="onCardLoadedData(v)"
              @play="onCardPlay(v)"
              @error="onCardVideoError(v)"
            />
            <button
              v-else
              type="button"
              class="pane-arm"
              @click.stop="armCard(v)"
            >
              Carregar trailer
            </button>
          </div>

          <p class="pane-name" :title="v.trailerRel">{{ v.displayName }}</p>
          <p class="pane-sizes">
            Completo {{ formatBytes(cardMeta(v)?.mainBytes) }}
            <span v-if="cardMetaLoading[videoKey(v)]" class="pane-sizes-loading">…</span>
            <span
              v-if="cardMeta(v)?.alreadyShrunk"
              class="pane-shrinked"
              :title="shrinkedTitle(cardMeta(v))"
            >
              já shrinkado
            </span>
          </p>
          <p v-if="v.tags?.length && !isPlayerPanelOpen(v)" class="pane-tags">{{ v.tags.join(', ') }}</p>

          <div class="pane-actions pane-actions--player-toggle">
            <button
              type="button"
              class="admin-btn"
              :class="{ 'admin-btn--on': isPlayerPanelOpen(v) }"
              title="Mostrar barra de controlos do player"
              @click="togglePlayerPanel(v)"
            >
              {{ isPlayerPanelOpen(v) ? 'Fechar controlos' : 'Player' }}
            </button>
            <a
              class="admin-btn"
              :href="catalogHref(v)"
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir este título no catálogo / reprodutor"
            >
              Abrir no catálogo
            </a>
          </div>

          <div
            v-show="isPlayerPanelOpen(v)"
            class="pane-player-panel"
            :class="{ 'pane-player-panel--theater': cardTheater[videoKey(v)] }"
          >
            <PlayerChromeToolbar
              :mode="(cardMode[videoKey(v)] || 'trailer') === 'full' ? 'full' : 'trailer'"
              :title="chromeTitleFor(v)"
              :chrome-collapsed="!!cardChromeCollapsed[videoKey(v)]"
              :theater-mode="!!cardTheater[videoKey(v)]"
              :playback-rate="cardPlaybackRate[videoKey(v)] ?? 1"
              :show-theater="true"
              :show-tags="true"
              :show-move="moveTargets.length > 0"
              :show-editor="true"
              :show-trailer-reprocess="true"
              :show-shrink="true"
              :show-delete="true"
              :show-reveal="true"
              :show-nav="false"
              :show-pin="false"
              :show-shuffle="false"
              :show-open-full="true"
              :show-fast-play="false"
              :show-name-row="true"
              :show-size-in-name="true"
              :destaque-busy="destaqueBusy === videoKey(v)"
              :shrink-busy="shrinkBusy === videoKey(v)"
              :trailer-busy="trailerBusy === videoKey(v)"
              :tags-panel-open="!!tagInputOpen[videoKey(v)]"
              :tags-hidden="!!cardTagsHidden[videoKey(v)]"
              :tag-input="tagInputByKey[videoKey(v)] ?? ''"
              :tag-suggestions="tagSuggestionsFor(v)"
              :tag-input-id="`dup-tag-input-${videoKey(v)}`"
              :datalist-id="`dup-tag-suggestions-${videoKey(v)}`"
              :rate-select-id="`dup-rate-${videoKey(v)}`"
              @update:chrome-collapsed="cardChromeCollapsed[videoKey(v)] = $event"
              @update:theater-mode="cardTheater[videoKey(v)] = $event"
              @update:playback-rate="setCardPlaybackRate(v, $event)"
              @update:tag-input="tagInputByKey[videoKey(v)] = $event"
              @toggle-favorite="toggleFavorite(v)"
              @toggle-memorable="toggleMemorable(v)"
              @toggle-destaque="toggleDestaque(v)"
              @open-tags="showTagsAndToggleInput(v)"
              @open-move="openMoveDialog(v)"
              @open-editor="openEditorFor(v)"
              @open-trailer-reprocess="enqueueTrailerReprocess(v)"
              @open-shrink="openShrinkDialog(v)"
              @delete-title="deleteVideoTitle(v)"
              @reveal="revealVideo(v)"
              @open-full="setCardMode(v, 'full')"
              @close-full="setCardMode(v, 'trailer')"
              @open-tag-input="openTagInput(v)"
              @hide-tags="hideTagsFor(v)"
              @add-tags="addTagsForVideo(v)"
              @tag-pointer-down="(t, e) => onDupTagPointerDown(v, t, e)"
              @tag-pointer-up="(t, e) => onDupTagPointerUp(v, t, e)"
              @tag-pointer-cancel="onDupTagPointerCancel"
            />
          </div>
        </article>
      </div>
    </section>
    <p v-else class="admin-muted focus-empty">Clica num grupo abaixo para carregar todos os vídeos.</p>

    <section v-if="groups.length" class="admin-card" :class="{ 'admin-card--scanning': scanBusy }">
      <h2 class="admin-h2">
        {{ groups.length }} grupo{{ groups.length === 1 ? '' : 's' }}
        <span class="admin-meta"> · clique no grupo para abrir todos os vídeos</span>
        <span v-if="scanBusy" class="admin-meta"> · lista anterior até o scan acabar</span>
      </h2>
      <div class="dup-groups">
        <article
          v-for="g in displayGroups"
          :key="g.id"
          class="dup-group"
          :class="{
            'dup-group--focus': focusGroupId === g.id,
            'dup-group--sure': isSureDuplicateGroup(g),
          }"
          role="button"
          tabindex="0"
          :title="
            isSureDuplicateGroup(g)
              ? 'Nome igual em pastas diferentes — quase de certeza repetido'
              : 'Carregar todos os vídeos deste grupo'
          "
          @click="loadGroup(g)"
          @keydown.enter.prevent="loadGroup(g)"
          @keydown.space.prevent="loadGroup(g)"
        >
          <header class="dup-group-head">
            <strong>Grupo {{ g.id }}</strong>
            <span
              v-if="isSureDuplicateGroup(g)"
              class="dup-sure-badge"
              title="Mesmo nome em pastas/sessões diferentes"
            >
              Batata · repetido
            </span>
            <span class="admin-meta">max {{ formatPct(g.maxScore) }} · {{ g.videos.length }} vídeos</span>
            <span class="dup-group-actions" @click.stop>
              <button
                type="button"
                class="admin-btn admin-btn--sm"
                :disabled="verdictBusy !== null || g.videos.length < 2"
                @click="submitGroupVerdict(g, 'not_duplicate')"
              >
                Não é repetido
              </button>
            </span>
          </header>
          <ul class="dup-video-list">
            <li
              v-for="v in g.videos"
              :key="videoKey(v)"
              class="dup-video"
              :class="{ 'dup-video--in': isFocused(v) }"
            >
              <span class="dup-sess" :title="listMeta[videoKey(v)]?.sessionLabel || `S${v.session}`">
                S{{ v.session }}
                <template v-if="listMeta[videoKey(v)]?.sessionLabel">
                  · {{ listMeta[videoKey(v)]!.sessionLabel }}
                </template>
              </span>
              <span class="dup-name" :title="v.trailerRel">{{ v.displayName }}</span>
              <span class="dup-size">
                {{ formatBytes(listMeta[videoKey(v)]?.mainBytes) }}
              </span>
            </li>
          </ul>
        </article>
      </div>
    </section>
    <p v-else-if="scanBusy" class="admin-muted">Scan a correr — a barra acima mostra o progresso.</p>
    <p v-else-if="stored && !loadBusy" class="admin-muted">
      Nenhum grupo no último scan
      <template v-if="stats.scannedVideos">
        ({{ stats.scannedVideos }} vídeos · {{ stats.matchedPairs }} pares).
      </template>
      Confirma que «Sessão» está vazio (todas) e volta a correr.
    </p>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-show="moveDialogOpen"
      class="dup-move-backdrop"
      @click="moveDialogOpen = false"
    />
    <div
      v-show="moveDialogOpen"
      class="dup-move-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-move-title"
    >
      <div class="dup-move-card">
        <div class="dup-move-head">
          <span id="dup-move-title">Mover para outra pasta</span>
          <button type="button" class="admin-btn" :disabled="moveBusy" @click="moveDialogOpen = false">
            ×
          </button>
        </div>
        <p class="admin-muted">
          Move o vídeo completo, trailer, preview e miniaturas para a pasta seleccionada.
        </p>
        <nav class="dup-move-list" aria-label="Destino">
          <button
            v-for="s in moveTargetsForCurrent"
            :key="s.id"
            type="button"
            class="admin-btn"
            :disabled="moveBusy"
            @click="confirmMoveToSession(s.id)"
          >
            {{ s.label }}
          </button>
        </nav>
        <p v-if="moveBusy" class="admin-muted">A mover ficheiros…</p>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-show="shrinkDialogOpen"
      class="dup-move-backdrop"
      @click="shrinkDialogOpen = false"
    />
    <div
      v-show="shrinkDialogOpen"
      class="dup-shrink-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-shrink-title"
    >
      <div class="dup-shrink-card">
        <div class="dup-move-head">
          <span id="dup-shrink-title">Shrink — fila</span>
          <button type="button" class="admin-btn" @click="shrinkDialogOpen = false">×</button>
        </div>
        <div class="dup-shrink-body">
          <p class="admin-muted">
            Adiciona à fila; processa no servidor e <strong>substitui o original</strong>
            (backup em <code class="admin-code">shrinked_backup</code>).
            Progresso no reprodutor / Admin · histórico em
            <NuxtLink to="/historico" class="empty-hint-link">/historico</NuxtLink>.
          </p>
          <p v-if="shrinkDialogVideo" class="dup-shrink-file">
            Actual: {{ chromeTitleFor(shrinkDialogVideo)?.mainFilename || shrinkDialogVideo.displayName }}
          </p>
          <p v-if="shrinkDialogAlreadyHint" class="dup-shrink-already" role="alert">
            <span class="dup-shrink-already-title">Já foi shrinkado</span>
            {{ shrinkDialogAlreadyHint }}
          </p>
          <div class="dup-shrink-grid">
            <label class="dup-shrink-field">
              <span>Resolução (altura)</span>
              <select v-model.number="shrinkForm.height" class="admin-input">
                <option v-for="h in SHRINK_IN_PLACE_HEIGHT_OPTIONS" :key="h" :value="h">
                  {{ SHRINK_IN_PLACE_HEIGHT_LABELS[h] ?? `${h}p` }}
                </option>
              </select>
            </label>
            <label class="dup-shrink-field">
              <span>Velocidade (×)</span>
              <select v-model.number="shrinkForm.speed" class="admin-input">
                <option v-for="s in SHRINK_IN_PLACE_SPEED_OPTIONS" :key="s" :value="s">{{ s }}×</option>
              </select>
            </label>
            <label class="dup-shrink-field dup-shrink-field--full">
              <span>Codec de vídeo</span>
              <select v-model="shrinkForm.codec" class="admin-input">
                <option v-for="c in SHRINK_IN_PLACE_CODEC_OPTIONS" :key="c.value" :value="c.value">
                  {{ c.label }}
                </option>
              </select>
            </label>
            <label class="dup-shrink-check">
              <input v-model="shrinkForm.prioritizeSize" type="checkbox" />
              <span>Priorizar tamanho (2ª passagem se a saída ficar grande)</span>
            </label>
          </div>
        </div>
        <div class="dup-shrink-actions">
          <button type="button" class="admin-btn" @click="resetShrinkForm">Restaurar padrões</button>
          <button type="button" class="admin-btn" @click="shrinkDialogOpen = false">Fechar</button>
          <button
            type="button"
            class="admin-btn admin-btn--primary"
            :disabled="shrinkBusy !== null || !shrinkDialogVideo"
            @click="confirmShrinkFromDialog"
          >
            {{ shrinkBusy ? '…' : 'Adicionar na fila' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { apiVideoUrl } from '~/composables/useVideoFolder'
import PlayerChromeToolbar from '~/components/player/PlayerChromeToolbar.vue'
import type { PlayerChromeTitle } from '~/components/player/PlayerChromeToolbar.vue'
import {
  normalizeShrinkInPlaceParams,
  SHRINK_IN_PLACE_CODEC_OPTIONS,
  SHRINK_IN_PLACE_HEIGHT_LABELS,
  SHRINK_IN_PLACE_HEIGHT_OPTIONS,
  SHRINK_IN_PLACE_PARAMS_DEFAULT,
  SHRINK_IN_PLACE_SPEED_OPTIONS,
  type ShrinkInPlaceParams,
} from '#shared/shrinkInPlaceParams'
import {
  normalizeTrailerBatParams,
  trailerParamsFromStorage,
  type TrailerBatParams,
} from '#shared/trailerParams'

type PlayMode = 'trailer' | 'full'

interface DupVideo {
  session: number
  trailerRel: string
  displayName: string
  stem: string
  tags: string[]
}

interface DupPair {
  score: number
  nameScore: number
  tagJaccard: number
  sharedTags: string[]
  a: DupVideo
  b: DupVideo
}

interface DupGroup {
  id: number
  maxScore: number
  videos: DupVideo[]
  pairs: DupPair[]
}

interface DupPayload {
  ok?: boolean
  stored?: boolean
  savedAt?: string | null
  scannedVideos?: number
  candidatePairs?: number
  matchedPairs?: number
  groups?: DupGroup[]
  minScore?: number
  minSharedTags?: number
  ms?: number
  options?: {
    minScore: number
    minSharedTags: number
    session: number | null
    maxGroups: number
  } | null
}

interface MediaInfo {
  session: number
  sessionLabel: string
  trailerRel: string
  trailerBytes: number | null
  mainRel: string | null
  mainBytes: number | null
  isFavorite?: boolean
  inDestaques?: boolean
  alreadyShrunk?: boolean
  shrinkEndedAt?: number | null
}

const minScore = ref(0.75)
const minSharedTags = ref(1)
const sessionFilter = ref('')
const loadBusy = ref(false)
const scanBusy = ref(false)
const scanPct = ref(0)
const scanProgressMsg = ref('')
const err = ref('')
const stored = ref(false)
const savedAt = ref<string | null>(null)
const groups = ref<DupGroup[]>([])
const stats = ref({
  scannedVideos: 0,
  candidatePairs: 0,
  matchedPairs: 0,
  ms: 0,
  minScore: 0.75,
})

const focusGroupId = ref<number | null>(null)
const focusVideos = ref<DupVideo[]>([])
const cardMode = reactive<Record<string, PlayMode>>({})
const cardMainTry = reactive<Record<string, number>>({})
const cardMetaLoading = reactive<Record<string, boolean>>({})
const listMeta = reactive<Record<string, MediaInfo>>({})
const revealBusy = ref<string | null>(null)
const favBusy = ref<string | null>(null)
const destaqueBusy = ref<string | null>(null)
const shrinkBusy = ref<string | null>(null)
const trailerBusy = ref<string | null>(null)

const SHRINK_IN_PLACE_STORAGE_KEY = 'video_player_shrink_in_place_params'

function loadTrailerParamsFromStorage(): TrailerBatParams {
  if (!import.meta.client) return normalizeTrailerBatParams(null)
  return trailerParamsFromStorage(localStorage)
}

function loadShrinkInPlaceParamsFromStorage(): ShrinkInPlaceParams {
  if (!import.meta.client) return normalizeShrinkInPlaceParams(null)
  try {
    const raw = localStorage.getItem(SHRINK_IN_PLACE_STORAGE_KEY)
    if (!raw) return normalizeShrinkInPlaceParams(null)
    return normalizeShrinkInPlaceParams(JSON.parse(raw) as Record<string, unknown>)
  } catch {
    return normalizeShrinkInPlaceParams(null)
  }
}

function saveShrinkInPlaceParamsToStorage(p: ShrinkInPlaceParams) {
  if (!import.meta.client) return
  try {
    localStorage.setItem(SHRINK_IN_PLACE_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* */
  }
}

const shrinkDialogOpen = ref(false)
const shrinkDialogVideo = ref<DupVideo | null>(null)
const shrinkForm = ref<ShrinkInPlaceParams>(loadShrinkInPlaceParamsFromStorage())

const shrinkDialogAlreadyHint = computed(() => {
  const v = shrinkDialogVideo.value
  if (!v) return ''
  const meta = cardMeta(v)
  if (!meta?.alreadyShrunk) return ''
  if (meta.shrinkEndedAt) {
    try {
      return `Histórico: shrink pelo grid em ${new Date(meta.shrinkEndedAt).toLocaleString()}. Enfileirar outra vez substitui o ficheiro de novo — vais precisar de confirmar duas vezes.`
    } catch {
      /* */
    }
  }
  return 'Histórico: este vídeo já foi shrinkado pelo grid. Enfileirar outra vez substitui o ficheiro de novo — vais precisar de confirmar duas vezes.'
})

async function openShrinkDialog(v: DupVideo) {
  const info = await ensureMainRel(v)
  if (!info?.mainRel) return
  shrinkDialogVideo.value = v
  shrinkForm.value = loadShrinkInPlaceParamsFromStorage()
  shrinkDialogOpen.value = true
}

function resetShrinkForm() {
  shrinkForm.value = { ...SHRINK_IN_PLACE_PARAMS_DEFAULT }
}

async function confirmShrinkFromDialog() {
  const v = shrinkDialogVideo.value
  if (!v || shrinkBusy.value) return
  const info = await ensureMainRel(v)
  if (!info?.mainRel) return

  if (info.alreadyShrunk) {
    const when = info.shrinkEndedAt
      ? (() => {
          try {
            return new Date(info.shrinkEndedAt!).toLocaleString()
          } catch {
            return null
          }
        })()
      : null
    const msg1 = when
      ? `Este vídeo já foi shrinkado (${when}).\n\nEnfileirar outra vez? O ficheiro actual será processado e substituído de novo.`
      : `Este vídeo já foi shrinkado.\n\nEnfileirar outra vez? O ficheiro actual será processado e substituído de novo.`
    if (!confirm(msg1)) return
    if (
      !confirm(
        'Confirma outra vez: este vídeo já tem histórico de shrink.\n\nTens a certeza que queres enfileirar e substituir o ficheiro de novo?',
      )
    ) {
      return
    }
  }

  const ref = titleRef(v)
  const params = normalizeShrinkInPlaceParams(shrinkForm.value)
  shrinkForm.value = params
  saveShrinkInPlaceParamsToStorage(params)
  const key = videoKey(v)
  shrinkBusy.value = key
  err.value = ''
  try {
    const state = await $fetch<{ items?: { status?: string }[] }>('/api/admin/shrink-in-place-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        action: 'enqueue',
        session: ref.session,
        mainRel: info.mainRel,
        trailerRel: ref.trailerRel,
        label: v.displayName || info.mainRel,
        params,
      },
    })
    const pending = (state.items ?? []).filter(
      (i) => i.status === 'pending' || i.status === 'running',
    ).length
    err.value = `Shrink na fila (${pending} activo(s)). Progresso no reprodutor / Admin.`
    shrinkDialogOpen.value = false
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao enfileirar shrink.')
  } finally {
    shrinkBusy.value = null
  }
}
const verdictBusy = ref<'not_duplicate' | 'resolved' | null>(null)
const keepKey = ref<string | null>(null)
const armedKeys = ref<string[]>([])
const videoEls = new Map<string, HTMLVideoElement>()
const AUTOLOAD_LS_KEY = 'vp-dup-autoload-trailers'
const autoLoadTrailers = ref(true)
let autoPlayBatch = false
const pendingAutoPlay = new Set<string>()
const CATALOG_TAB_UNLOCK_KEY = 'vp_catalog_tab_ok'

const catalogGateRequired = ref(false)
const catalogUnlocked = ref(true)
const catalogGatePassword = ref('')
const catalogGateError = ref('')
const catalogGateBusy = ref(false)
const catalogGateChecking = ref(true)
const catalogGateInputRef = ref<HTMLInputElement | null>(null)
const catalogGateVisible = computed(
  () => catalogGateChecking.value || (catalogGateRequired.value && !catalogUnlocked.value),
)

function readCatalogTabUnlocked(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  try {
    return sessionStorage.getItem(CATALOG_TAB_UNLOCK_KEY) === '1'
  } catch {
    return false
  }
}

function writeCatalogTabUnlocked(on: boolean) {
  if (typeof sessionStorage === 'undefined') return
  try {
    if (on) sessionStorage.setItem(CATALOG_TAB_UNLOCK_KEY, '1')
    else sessionStorage.removeItem(CATALOG_TAB_UNLOCK_KEY)
  } catch {
    /* */
  }
}

if (import.meta.client) {
  try {
    const raw = localStorage.getItem(AUTOLOAD_LS_KEY)
    if (raw === '0' || raw === 'false') autoLoadTrailers.value = false
    else if (raw === '1' || raw === 'true') autoLoadTrailers.value = true
  } catch {
    /* */
  }
}

watch(autoLoadTrailers, (on) => {
  if (!import.meta.client) return
  try {
    localStorage.setItem(AUTOLOAD_LS_KEY, on ? '1' : '0')
  } catch {
    /* */
  }
  if (!focusVideos.value.length) return
  if (on) {
    armedKeys.value = focusVideos.value.map(videoKey)
    for (const v of focusVideos.value) pendingAutoPlay.add(videoKey(v))
    autoPlayBatch = true
    void nextTick(() => {
      for (const v of focusVideos.value) tryAutoPlayCard(v)
      endAutoPlayBatchSoon()
    })
  } else {
    pendingAutoPlay.clear()
    autoPlayBatch = false
    armedKeys.value = []
    for (const el of videoEls.values()) {
      try {
        el.pause()
      } catch {
        /* */
      }
    }
  }
})

function isCardArmed(v: DupVideo): boolean {
  return armedKeys.value.includes(videoKey(v))
}

function armCard(v: DupVideo) {
  const key = videoKey(v)
  if (!armedKeys.value.includes(key)) armedKeys.value = [...armedKeys.value, key]
}

function tryAutoPlayCard(v: DupVideo) {
  const key = videoKey(v)
  if (!pendingAutoPlay.has(key)) return
  const el = videoEls.get(key)
  if (!el) return
  pendingAutoPlay.delete(key)
  void el.play().catch(async () => {
    try {
      el.muted = true
      await el.play()
    } catch {
      /* */
    }
  })
}

function endAutoPlayBatchSoon() {
  window.setTimeout(() => {
    autoPlayBatch = false
  }, 600)
}

function setVideoRef(v: DupVideo, el: unknown) {
  const key = videoKey(v)
  if (el instanceof HTMLVideoElement) {
    videoEls.set(key, el)
    if (autoLoadTrailers.value && pendingAutoPlay.has(key)) {
      if (el.readyState >= 2) tryAutoPlayCard(v)
    }
  } else videoEls.delete(key)
}

function onCardLoadedData(v: DupVideo) {
  const key = videoKey(v)
  const rate = cardPlaybackRate[key]
  const el = videoEls.get(key)
  if (el && rate && Number.isFinite(rate)) el.playbackRate = rate
  if (autoLoadTrailers.value) tryAutoPlayCard(v)
}

function onCardPlay(v: DupVideo) {
  if (autoPlayBatch) return
  const key = videoKey(v)
  for (const [k, el] of videoEls) {
    if (k !== key && !el.paused) {
      try {
        el.pause()
      } catch {
        /* */
      }
    }
  }
}

const focusGroup = computed(() => {
  const id = focusGroupId.value
  if (id == null) return null
  return groups.value.find((g) => g.id === id) ?? null
})

const displayGroups = computed(() => {
  const list = [...groups.value]
  list.sort((a, b) => Number(isSureDuplicateGroup(b)) - Number(isSureDuplicateGroup(a)) || a.id - b.id)
  return list
})

const compareRowClass = computed(() => {
  const n = focusVideos.value.length
  if (n <= 1) return 'compare-row--1'
  if (n === 2) return 'compare-row--2'
  if (n === 3) return 'compare-row--3'
  return 'compare-row--4'
})

const metaLine = computed(() => {
  if (!stored.value) return ''
  const when = savedAt.value ? new Date(savedAt.value).toLocaleString() : '—'
  return `Gravado: ${when} · ${stats.value.scannedVideos} vídeos · ${stats.value.matchedPairs} pares · ${groups.value.length} grupos · limiar ${stats.value.minScore}`
})

function identityNameKey(v: DupVideo): string {
  const fromRel = String(v.trailerRel || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || ''
  const base = (fromRel.replace(/\.[^.]+$/i, '') || v.displayName || '').trim().toLowerCase()
  return base.replace(/\s+/g, ' ')
}

function parentFolderKey(v: DupVideo): string {
  const rel = String(v.trailerRel || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const i = rel.lastIndexOf('/')
  const dir = i >= 0 ? rel.slice(0, i) : ''
  return `${Math.floor(v.session)}::${dir}`
}

/** Nome idêntico + pasta/sessão diferente → quase de certeza o mesmo ficheiro. */
function isSureDuplicateGroup(g: DupGroup): boolean {
  const vids = g.videos || []
  if (vids.length < 2) return false
  for (let i = 0; i < vids.length; i++) {
    const a = vids[i]!
    const na = identityNameKey(a)
    if (!na) continue
    const fa = parentFolderKey(a)
    for (let j = i + 1; j < vids.length; j++) {
      const b = vids[j]!
      if (na !== identityNameKey(b)) continue
      if (fa !== parentFolderKey(b)) return true
    }
  }
  return false
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n * 1000) / 10}%`
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function shrinkedTitle(meta: MediaInfo | null | undefined): string {
  if (!meta?.alreadyShrunk) return ''
  if (meta.shrinkEndedAt) {
    try {
      return `No histórico de shrink (${new Date(meta.shrinkEndedAt).toLocaleString()})`
    } catch {
      /* */
    }
  }
  return 'No histórico de shrink do grid'
}

function videoKey(v: DupVideo): string {
  const session = Math.floor(Number(v.session))
  const rel = String(v.trailerRel || '')
    .trim()
    .replace(/\\/g, '/')
  return `${Number.isFinite(session) && session >= 0 ? session : 0}::${rel}`
}

function apiErrMessage(e: unknown, fallback: string): string {
  const ex = e as {
    data?: { statusMessage?: string; message?: string }
    statusMessage?: string
    message?: string
  }
  return (
    ex?.data?.message ||
    ex?.data?.statusMessage ||
    ex?.statusMessage ||
    ex?.message ||
    fallback
  )
}

function titleRef(v: DupVideo): { session: number; trailerRel: string } {
  return {
    session: Math.floor(Number(v.session)),
    trailerRel: String(v.trailerRel || '').trim().replace(/\\/g, '/'),
  }
}

function catalogHref(v: DupVideo): string {
  const ref = titleRef(v)
  const q = new URLSearchParams()
  q.set('session', String(ref.session))
  q.set('rel', ref.trailerRel)
  return `/?${q.toString()}`
}

const TAG_INPUT_MAX_LEN = 80
const TAG_LONGPRESS_MS = 2000
const MEMORABLE_TAG = 'memoravel'

const playerPanelOpen = reactive<Record<string, boolean>>({})
const tagInputOpen = reactive<Record<string, boolean>>({})
const tagInputByKey = reactive<Record<string, string>>({})
const tagSuggestionsBySession = reactive<Record<string, string[]>>({})
const memorableBusy = ref<string | null>(null)
const cardChromeCollapsed = reactive<Record<string, boolean>>({})
const cardTheater = reactive<Record<string, boolean>>({})
const cardTagsHidden = reactive<Record<string, boolean>>({})
const cardPlaybackRate = reactive<Record<string, number>>({})

const librarySessions = ref<{ id: number; label: string }[]>([])
const moveDialogOpen = ref(false)
const moveBusy = ref(false)
const moveSourceVideo = ref<DupVideo | null>(null)

const moveTargetsForCurrent = computed(() => {
  const src = moveSourceVideo.value
  const sid = src ? Math.floor(Number(src.session)) : -1
  return librarySessions.value.filter((s) => s.id >= 0 && s.id !== sid)
})

const moveTargets = computed(() => librarySessions.value.filter((s) => s.id >= 0))

let dupTagPointer: { t: number; key: string; tagName: string } | null = null

function sortTags(tags: string[]): string[] {
  return [...tags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

function splitTagInputToParts(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0 && s.length <= TAG_INPUT_MAX_LEN)
}

function isPlayerPanelOpen(v: DupVideo): boolean {
  return Boolean(playerPanelOpen[videoKey(v)])
}

function isTagInputOpen(v: DupVideo): boolean {
  return Boolean(tagInputOpen[videoKey(v)])
}

function isMemorable(v: DupVideo): boolean {
  return (v.tags ?? []).some((t) => t.trim().toLowerCase() === MEMORABLE_TAG)
}

function chromeTitleFor(v: DupVideo): PlayerChromeTitle {
  const meta = cardMeta(v)
  const mainRel = meta?.mainRel || null
  const mainName = mainRel
    ? mainRel.replace(/\\/g, '/').split('/').pop() || v.displayName
    : v.displayName
  return {
    displayName: v.displayName,
    mainFilename: mainName,
    mainSizeBytes: meta?.mainBytes ?? 0,
    isFavorite: !!meta?.isFavorite,
    isMemorable: isMemorable(v),
    inDestaques: !!meta?.inDestaques,
    hasMain: !!mainRel,
    tags: [...(v.tags ?? [])],
  }
}

function setCardPlaybackRate(v: DupVideo, rate: number) {
  const key = videoKey(v)
  const r = Number(rate)
  cardPlaybackRate[key] = Number.isFinite(r) && r > 0 ? r : 1
  const el = videoEls.get(key)
  if (el) el.playbackRate = cardPlaybackRate[key]!
}

function showTagsAndToggleInput(v: DupVideo) {
  const key = videoKey(v)
  cardTagsHidden[key] = false
  tagInputOpen[key] = !tagInputOpen[key]
}

function hideTagsFor(v: DupVideo) {
  const key = videoKey(v)
  cardTagsHidden[key] = true
  tagInputOpen[key] = false
}

function openEditorFor(v: DupVideo) {
  const meta = cardMeta(v)
  if (!meta?.mainRel) {
    err.value = 'Sem ficheiro completo para o editor.'
    return
  }
  const q = new URLSearchParams()
  q.set('session', String(titleRef(v).session))
  q.set('file', meta.mainRel)
  navigateTo(`/editor?${q.toString()}`)
}

function openMoveDialog(v: DupVideo) {
  moveSourceVideo.value = v
  moveDialogOpen.value = true
}

async function confirmMoveToSession(destSession: number) {
  const v = moveSourceVideo.value
  if (!v || moveBusy.value) return
  const ref = titleRef(v)
  moveBusy.value = true
  err.value = ''
  try {
    await $fetch('/api/library/move-title', {
      method: 'POST',
      body: {
        session: ref.session,
        targetSession: destSession,
        trailerRel: ref.trailerRel,
      },
    })
    moveDialogOpen.value = false
    moveSourceVideo.value = null
    err.value = 'Título movido. Corre o scan outra vez se a lista ficar desactualizada.'
    focusVideos.value = focusVideos.value.filter((x) => videoKey(x) !== videoKey(v))
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao mover o título.')
  } finally {
    moveBusy.value = false
  }
}

async function deleteVideoTitle(v: DupVideo) {
  if (
    !confirm(
      `Mover «${v.displayName}» para a Lixeira?\n(completo, trailer e preview)`,
    )
  ) {
    return
  }
  const ref = titleRef(v)
  err.value = ''
  try {
    await $fetch('/api/library/delete-title', {
      method: 'POST',
      body: { session: ref.session, trailerRel: ref.trailerRel },
    })
    focusVideos.value = focusVideos.value.filter((x) => videoKey(x) !== videoKey(v))
    err.value = `«${v.displayName}» enviado para a Lixeira.`
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao apagar o título.')
  }
}

async function loadLibrarySessions() {
  try {
    const data = await $fetch<{ sessions?: { id: number; label: string }[] }>('/api/sessions')
    librarySessions.value = Array.isArray(data.sessions) ? data.sessions : []
  } catch {
    librarySessions.value = []
  }
}

function tagSuggestionsFor(v: DupVideo): string[] {
  const s = Math.floor(Number(v.session))
  return tagSuggestionsBySession[String(Number.isFinite(s) && s >= 0 ? s : 0)] ?? []
}

function patchVideoTags(v: DupVideo, tags: string[]) {
  const key = videoKey(v)
  const next = sortTags(tags)
  const apply = (vid: DupVideo) => {
    if (videoKey(vid) === key) vid.tags = next
  }
  for (const vid of focusVideos.value) apply(vid)
  for (const g of groups.value) {
    for (const vid of g.videos) apply(vid)
  }
}

async function ensureTagSuggestions(session: number) {
  const sk = String(session)
  if (tagSuggestionsBySession[sk]?.length) return
  try {
    const data = await $fetch<{ suggestions?: string[] }>('/api/library/tags', {
      query: { session },
      credentials: 'include',
    })
    tagSuggestionsBySession[sk] = Array.isArray(data.suggestions) ? sortTags(data.suggestions) : []
  } catch {
    tagSuggestionsBySession[sk] = []
  }
}

function mergeTagSuggestions(session: number, ...names: string[]) {
  if (!names.length) return
  const sk = String(session)
  const set = new Set(tagSuggestionsBySession[sk] ?? [])
  let added = false
  for (const n of names) {
    if (!set.has(n)) {
      set.add(n)
      added = true
    }
  }
  if (added) tagSuggestionsBySession[sk] = sortTags([...set])
}

async function togglePlayerPanel(v: DupVideo) {
  const key = videoKey(v)
  const open = !playerPanelOpen[key]
  playerPanelOpen[key] = open
  if (open) {
    await ensureTagSuggestions(Math.floor(Number(v.session)))
    armCard(v)
  }
}

function openTagInput(v: DupVideo) {
  const key = videoKey(v)
  cardTagsHidden[key] = false
  tagInputOpen[key] = true
}

function closeTagInput(v: DupVideo) {
  tagInputOpen[videoKey(v)] = false
}

async function addTagsForVideo(v: DupVideo) {
  const key = videoKey(v)
  const parts = [...new Set(splitTagInputToParts(tagInputByKey[key] ?? ''))]
  if (!parts.length) return
  const ref = titleRef(v)
  const prevTags = [...(v.tags ?? [])]
  patchVideoTags(v, [...new Set([...prevTags, ...parts])])
  mergeTagSuggestions(ref.session, ...parts)
  tagInputByKey[key] = ''

  try {
    let serverTags = prevTags
    for (const name of parts) {
      const res = await $fetch<{ tags?: string[] }>('/api/library/tags', {
        method: 'POST',
        credentials: 'include',
        body: { session: ref.session, trailerRel: ref.trailerRel, name },
      })
      if (Array.isArray(res.tags)) serverTags = res.tags
    }
    patchVideoTags(v, serverTags)
  } catch (e: unknown) {
    patchVideoTags(v, prevTags)
    err.value = apiErrMessage(e, 'Não foi possível gravar a tag.')
  }
}

async function removeTagFromVideo(v: DupVideo, tagName: string) {
  const ref = titleRef(v)
  const prevTags = [...(v.tags ?? [])]
  const tagLower = tagName.trim().toLowerCase()
  patchVideoTags(
    v,
    prevTags.filter((t) => t.trim().toLowerCase() !== tagLower),
  )
  try {
    const res = await $fetch<{ tags?: string[] }>(
      `/api/library/tags?session=${ref.session}&trailerRel=${encodeURIComponent(ref.trailerRel)}&name=${encodeURIComponent(tagName)}`,
      { method: 'DELETE', credentials: 'include' },
    )
    if (Array.isArray(res.tags)) patchVideoTags(v, res.tags)
  } catch (e: unknown) {
    patchVideoTags(v, prevTags)
    err.value = apiErrMessage(e, 'Não foi possível remover a tag.')
  }
}

function onDupTagPointerDown(v: DupVideo, tagName: string, e: PointerEvent) {
  if (e.button !== 0) return
  dupTagPointer = { t: Date.now(), key: videoKey(v), tagName }
  const el = e.currentTarget
  if (el instanceof HTMLElement) {
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* */
    }
  }
}

function onDupTagPointerCancel(e: PointerEvent) {
  const el = e.currentTarget
  if (el instanceof HTMLElement) {
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      /* */
    }
  }
  dupTagPointer = null
}

async function onDupTagPointerUp(v: DupVideo, tagName: string, e: PointerEvent) {
  if (e.button !== 0) return
  const el = e.currentTarget
  if (el instanceof HTMLElement) {
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      /* */
    }
  }
  const st = dupTagPointer
  dupTagPointer = null
  if (!st || st.key !== videoKey(v) || st.tagName !== tagName) return
  if (Date.now() - st.t >= TAG_LONGPRESS_MS) {
    if (!confirm(`Remover a tag «${tagName}» deste título?`)) return
    await removeTagFromVideo(v, tagName)
  }
}

async function toggleMemorable(v: DupVideo) {
  const key = videoKey(v)
  if (memorableBusy.value) return
  const ref = titleRef(v)
  if (!ref.trailerRel) return
  const next = !isMemorable(v)
  memorableBusy.value = key
  err.value = ''
  const prevTags = [...(v.tags ?? [])]
  if (next) {
    patchVideoTags(v, [...prevTags.filter((t) => t.trim().toLowerCase() !== MEMORABLE_TAG), MEMORABLE_TAG])
  } else {
    patchVideoTags(
      v,
      prevTags.filter((t) => t.trim().toLowerCase() !== MEMORABLE_TAG),
    )
  }
  try {
    const res = await $fetch<{ tags?: string[] }>('/api/library/memorable', {
      method: 'POST',
      credentials: 'include',
      body: { session: ref.session, trailerRel: ref.trailerRel, memorable: next },
    })
    if (Array.isArray(res.tags)) patchVideoTags(v, res.tags)
  } catch (e: unknown) {
    patchVideoTags(v, prevTags)
    err.value = apiErrMessage(e, 'Falha ao gravar memorável.')
  } finally {
    memorableBusy.value = null
  }
}

function cardMeta(v: DupVideo): MediaInfo | null {
  return listMeta[videoKey(v)] ?? null
}

async function fetchMediaInfo(v: DupVideo): Promise<MediaInfo | null> {
  const key = videoKey(v)
  if (listMeta[key]) return listMeta[key]
  const ref = titleRef(v)
  if (!Number.isFinite(ref.session) || ref.session < 0 || !ref.trailerRel) return null
  try {
    const data = await $fetch<MediaInfo>('/api/duplicates/media-info', {
      method: 'POST',
      body: ref,
    })
    listMeta[key] = data
    return data
  } catch {
    return null
  }
}

async function loadCardMeta(v: DupVideo) {
  const key = videoKey(v)
  cardMetaLoading[key] = true
  try {
    await fetchMediaInfo(v)
  } finally {
    cardMetaLoading[key] = false
  }
}

function prefetchGroupMeta(g: DupGroup) {
  for (const v of g.videos) void fetchMediaInfo(v)
}

function isFocused(v: DupVideo): boolean {
  const k = videoKey(v)
  return focusVideos.value.some((x) => videoKey(x) === k)
}

function guessMainRels(trailerRel: string): string[] {
  const norm = trailerRel.replace(/\\/g, '/').replace(/^\/+/, '')
  const within = /^trailers\//i.test(norm) ? norm.slice('trailers/'.length) : norm
  const parts = within.split('/').filter(Boolean)
  const file = parts[parts.length - 1] || within
  const sub = parts.length >= 2 ? parts[0]! : null
  let stem = file.replace(/\.[^.]+$/i, '')
  const legacy = stem.match(/^zz_(.+)_acelerado$/i)
  if (legacy?.[1]) stem = legacy[1]
  const preferExt = (file.match(/\.[^.]+$/i)?.[0] || '.mp4').toLowerCase()
  const exts = [preferExt, '.mp4', '.mkv', '.m4v', '.webm', '.mov', '.avi', '.wmv']
  const uniqExt = [...new Set(exts)]
  const out: string[] = []
  for (const e of uniqExt) {
    const name = `${stem}${e}`
    if (sub) out.push(`${sub}/${name}`)
    out.push(name)
  }
  return out
}

function cardMediaSrc(v: DupVideo): string | null {
  const key = videoKey(v)
  if (cardMode[key] !== 'full') return apiVideoUrl(v.trailerRel, v.session)
  const known = cardMeta(v)?.mainRel
  if (known) return apiVideoUrl(known, v.session)
  const candidates = guessMainRels(v.trailerRel)
  const rel = candidates[cardMainTry[key] || 0] || candidates[0]
  return rel ? apiVideoUrl(rel, v.session) : null
}

function setCardMode(v: DupVideo, mode: PlayMode) {
  const key = videoKey(v)
  cardMode[key] = mode
  if (mode === 'full') cardMainTry[key] = 0
  armCard(v)
}

function onCardVideoError(v: DupVideo) {
  const key = videoKey(v)
  if (cardMode[key] !== 'full') return
  const candidates = guessMainRels(v.trailerRel)
  const cur = cardMainTry[key] || 0
  if (cur + 1 < candidates.length) cardMainTry[key] = cur + 1
}

function clearFocus() {
  for (const el of videoEls.values()) {
    try {
      el.pause()
    } catch {
      /* */
    }
  }
  videoEls.clear()
  pendingAutoPlay.clear()
  autoPlayBatch = false
  focusVideos.value = []
  focusGroupId.value = null
  keepKey.value = null
  armedKeys.value = []
}

function loadGroup(g: DupGroup) {
  for (const el of videoEls.values()) {
    try {
      el.pause()
    } catch {
      /* */
    }
  }
  videoEls.clear()
  pendingAutoPlay.clear()
  focusGroupId.value = g.id
  focusVideos.value = [...g.videos]
  keepKey.value = g.videos[0] ? videoKey(g.videos[0]) : null
  for (const v of g.videos) {
    const key = videoKey(v)
    if (!cardMode[key]) cardMode[key] = 'trailer'
    if (cardMainTry[key] == null) cardMainTry[key] = 0
    void loadCardMeta(v)
  }
  if (autoLoadTrailers.value) {
    armedKeys.value = g.videos.map(videoKey)
    autoPlayBatch = true
    for (const v of g.videos) pendingAutoPlay.add(videoKey(v))
    void nextTick(() => {
      for (const v of focusVideos.value) tryAutoPlayCard(v)
      endAutoPlayBatchSoon()
    })
  } else {
    armedKeys.value = []
    autoPlayBatch = false
  }
  prefetchGroupMeta(g)
}

function applyPayload(data: DupPayload) {
  stored.value = !!data.stored || !!data.savedAt
  savedAt.value = typeof data.savedAt === 'string' ? data.savedAt : null
  groups.value = Array.isArray(data.groups) ? data.groups : []
  stats.value = {
    scannedVideos: data.scannedVideos ?? 0,
    candidatePairs: data.candidatePairs ?? 0,
    matchedPairs: data.matchedPairs ?? 0,
    ms: data.ms ?? 0,
    minScore: data.minScore ?? data.options?.minScore ?? 0.75,
  }
  if (data.options) {
    minScore.value = data.options.minScore
    minSharedTags.value = data.options.minSharedTags
  }
  sessionFilter.value = ''
  syncFocusWithGroups()
  for (const g of groups.value.slice(0, 5)) prefetchGroupMeta(g)
}

function syncFocusWithGroups() {
  const id = focusGroupId.value
  if (id == null) {
    clearFocus()
    return
  }
  const g = groups.value.find((x) => x.id === id)
  if (!g) {
    clearFocus()
    return
  }
  focusVideos.value = [...g.videos]
  if (!keepKey.value || !g.videos.some((v) => videoKey(v) === keepKey.value)) {
    keepKey.value = g.videos[0] ? videoKey(g.videos[0]) : null
  }
}

async function loadStored() {
  loadBusy.value = true
  err.value = ''
  try {
    const data = await $fetch<DupPayload>('/api/duplicates')
    applyPayload(data)
    if (!focusVideos.value.length && groups.value[0]?.videos.length) {
      loadGroup(groups.value[0])
    }
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao ler lista.')
  } finally {
    loadBusy.value = false
  }
}

async function pollScanJob(jobId: string) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 400))
    let st: {
      status: string
      progress?: { pct?: number; message?: string }
      error?: string | null
      result?: DupPayload | null
    }
    try {
      st = await $fetch('/api/duplicates/scan-status', { query: { jobId } })
    } catch (e: unknown) {
      err.value = apiErrMessage(e, 'Job de scan perdido (servidor reiniciou?). Lista antiga mantida.')
      return
    }
    if (st.progress?.pct != null) scanPct.value = Math.min(100, Math.floor(st.progress.pct))
    if (st.progress?.message) scanProgressMsg.value = st.progress.message
    if (st.status === 'done') {
      if (st.result) {
        applyPayload({ ...st.result, stored: true })
        clearFocus()
        if (groups.value[0]?.videos.length) loadGroup(groups.value[0])
      } else {
        await loadStored()
      }
      scanPct.value = 100
      scanProgressMsg.value = 'Concluído'
      return
    }
    if (st.status === 'failed') {
      err.value = st.error || 'Falha no scan.'
      return
    }
  }
}

async function runScan() {
  if (scanBusy.value) return
  scanBusy.value = true
  scanPct.value = 1
  scanProgressMsg.value = 'A iniciar…'
  err.value = ''
  await nextTick()
  try {
    const sessionRaw = sessionFilter.value.trim()
    const sessionNum = sessionRaw === '' ? null : Number(sessionRaw)
    const started = await $fetch<{
      jobId: string
      status: string
      progress?: { pct?: number; message?: string }
    }>('/api/duplicates/scan', {
      method: 'POST',
      body: {
        minScore: minScore.value,
        minSharedTags: minSharedTags.value,
        session:
          sessionNum !== null && Number.isFinite(sessionNum) && sessionNum >= 0
            ? Math.floor(sessionNum)
            : null,
        maxGroups: 100,
      },
    })
    const jobId = started.jobId
    if (started.progress?.pct != null) scanPct.value = Math.max(1, Math.floor(started.progress.pct))
    if (started.progress?.message) scanProgressMsg.value = started.progress.message
    await pollScanJob(jobId)
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha no scan.')
  } finally {
    scanBusy.value = false
  }
}

async function submitGroupVerdict(g: DupGroup, reason: 'not_duplicate') {
  if (verdictBusy.value || g.videos.length < 2) return
  const videos = g.videos.map(titleRef).filter((r) => r.trailerRel)
  if (videos.length < 2) {
    err.value = 'Grupo sem títulos válidos.'
    return
  }
  const names = g.videos
    .slice(0, 6)
    .map((v) => `S${v.session} · ${v.displayName}`)
    .join('\n')
  const more = g.videos.length > 6 ? `\n… +${g.videos.length - 6}` : ''
  if (
    !confirm(
      `Marcar grupo ${g.id} como NÃO repetido?\n\n${videos.length} títulos · só tira da lista (não apaga ficheiros).\n\n${names}${more}`,
    )
  ) {
    return
  }

  verdictBusy.value = reason
  err.value = ''
  try {
    const data = await $fetch<DupPayload>('/api/duplicates/verdict', {
      method: 'POST',
      body: { reason, videos },
    })
    applyPayload({ ...data, stored: true })
    clearFocus()
    if (groups.value[0]?.videos.length) loadGroup(groups.value[0])
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao gravar veredicto.')
  } finally {
    verdictBusy.value = null
  }
}

async function submitResolved(g: DupGroup) {
  if (verdictBusy.value || g.videos.length < 2 || !keepKey.value) return
  const keep = g.videos.find((v) => videoKey(v) === keepKey.value)
  if (!keep) {
    err.value = 'Escolhe qual vídeo Manter.'
    return
  }
  const toDelete = g.videos.filter((v) => videoKey(v) !== keepKey.value)
  if (!toDelete.length) {
    err.value = 'Nada para apagar — marca outro título como Manter.'
    return
  }
  const delLines = toDelete.map((v) => `S${v.session} · ${v.displayName}`).join('\n')
  if (
    !confirm(
      `RESOLVIDO: manter 1 e apagar ${toDelete.length} para a Lixeira?\n\nManter:\nS${keep.session} · ${keep.displayName}\n\nApagar:\n${delLines}\n\nCompleto + trailer + preview de cada um apagado.`,
    )
  ) {
    return
  }

  verdictBusy.value = 'resolved'
  err.value = ''
  const deleted: string[] = []
  const failed: string[] = []
  try {
    for (const v of toDelete) {
      const ref = titleRef(v)
      try {
        await $fetch('/api/library/delete-title', {
          method: 'POST',
          body: ref,
        })
        deleted.push(`S${ref.session} · ${v.displayName}`)
      } catch (e: unknown) {
        failed.push(`${v.displayName}: ${apiErrMessage(e, 'falha')}`)
      }
    }

    const videos = g.videos.map(titleRef).filter((r) => r.trailerRel)
    const data = await $fetch<DupPayload>('/api/duplicates/verdict', {
      method: 'POST',
      body: { reason: 'resolved', videos },
    })
    applyPayload({ ...data, stored: true })
    clearFocus()
    if (groups.value[0]?.videos.length) loadGroup(groups.value[0])

    if (failed.length) {
      err.value = `Apagados ${deleted.length}. Falharam: ${failed.join(' · ')}`
    }
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao resolver grupo.')
  } finally {
    verdictBusy.value = null
  }
}

async function toggleFavorite(v: DupVideo) {
  const key = videoKey(v)
  if (favBusy.value) return
  const ref = titleRef(v)
  if (!ref.trailerRel) return
  favBusy.value = key
  err.value = ''
  try {
    const res = await $fetch<{ isFavorite?: boolean }>('/api/duplicates/favorite', {
      method: 'POST',
      body: ref,
    })
    const prev = listMeta[key]
    if (prev) {
      listMeta[key] = { ...prev, isFavorite: !!res.isFavorite }
    } else {
      await loadCardMeta(v)
      if (listMeta[key]) listMeta[key] = { ...listMeta[key]!, isFavorite: !!res.isFavorite }
    }
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao gravar favorito.')
  } finally {
    favBusy.value = null
  }
}

async function toggleDestaque(v: DupVideo) {
  const key = videoKey(v)
  if (destaqueBusy.value) return
  const ref = titleRef(v)
  if (!ref.trailerRel) return
  destaqueBusy.value = key
  err.value = ''
  try {
    const res = await $fetch<{ inDestaques?: boolean }>('/api/duplicates/destaque', {
      method: 'POST',
      body: ref,
    })
    const prev = listMeta[key]
    if (prev) {
      listMeta[key] = { ...prev, inDestaques: !!res.inDestaques }
    } else {
      await loadCardMeta(v)
      if (listMeta[key]) listMeta[key] = { ...listMeta[key]!, inDestaques: !!res.inDestaques }
    }
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao gravar Destaques.')
  } finally {
    destaqueBusy.value = null
  }
}

async function revealVideo(v: DupVideo) {
  const key = videoKey(v)
  if (revealBusy.value) return
  const ref = titleRef(v)
  revealBusy.value = key
  err.value = ''
  try {
    if (!cardMeta(v)) await loadCardMeta(v)
    const info = cardMeta(v)
    const useMain = !!(info?.mainRel)
    await $fetch('/api/admin/reveal-in-explorer', {
      method: 'POST',
      body: {
        session: ref.session,
        target: useMain ? 'main' : 'trailer',
        rel: useMain ? info!.mainRel! : ref.trailerRel,
      },
    })
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao abrir a pasta.')
  } finally {
    revealBusy.value = null
  }
}

async function ensureMainRel(v: DupVideo): Promise<MediaInfo | null> {
  if (!cardMeta(v)) await loadCardMeta(v)
  const info = cardMeta(v)
  if (!info?.mainRel) {
    err.value = 'Sem ficheiro completo — não dá para enfileirar.'
    return null
  }
  return info
}

async function enqueueShrink(v: DupVideo) {
  const key = videoKey(v)
  if (shrinkBusy.value) return
  const info = await ensureMainRel(v)
  if (!info?.mainRel) return

  if (info.alreadyShrunk) {
    const when = info.shrinkEndedAt
      ? (() => {
          try {
            return new Date(info.shrinkEndedAt!).toLocaleString()
          } catch {
            return null
          }
        })()
      : null
    const msg1 = when
      ? `Este vídeo já foi shrinkado (${when}).\n\nEnfileirar outra vez? O ficheiro actual será processado e substituído de novo.`
      : `Este vídeo já foi shrinkado.\n\nEnfileirar outra vez? O ficheiro actual será processado e substituído de novo.`
    if (!confirm(msg1)) return
    if (
      !confirm(
        'Confirma outra vez: este vídeo já tem histórico de shrink.\n\nTens a certeza que queres enfileirar e substituir o ficheiro de novo?',
      )
    ) {
      return
    }
  } else if (!confirm(`Enfileirar shrink de «${v.displayName}»?`)) {
    return
  }

  const ref = titleRef(v)
  const params = loadShrinkInPlaceParamsFromStorage()
  shrinkBusy.value = key
  err.value = ''
  try {
    const state = await $fetch<{ items?: { status?: string }[] }>('/api/admin/shrink-in-place-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        action: 'enqueue',
        session: ref.session,
        mainRel: info.mainRel,
        trailerRel: ref.trailerRel,
        label: v.displayName || info.mainRel,
        params,
      },
    })
    const pending = (state.items ?? []).filter(
      (i) => i.status === 'pending' || i.status === 'running',
    ).length
    err.value = `Shrink na fila (${pending} activo(s)). Progresso no reprodutor / Admin.`
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao enfileirar shrink.')
  } finally {
    shrinkBusy.value = null
  }
}

async function enqueueTrailerReprocess(v: DupVideo) {
  const key = videoKey(v)
  if (trailerBusy.value) return
  const info = await ensureMainRel(v)
  if (!info?.mainRel) return
  if (!confirm(`Reprocessar trailer de «${v.displayName}»?`)) return

  const ref = titleRef(v)
  const params = loadTrailerParamsFromStorage()
  trailerBusy.value = key
  err.value = ''
  try {
    const state = await $fetch<{ items?: { status?: string }[] }>(
      '/api/admin/trailer-reprocess-queue',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          action: 'enqueue',
          session: ref.session,
          mainRel: info.mainRel,
          trailerRel: ref.trailerRel,
          label: v.displayName || info.mainRel,
          params,
        },
      },
    )
    const pending = (state.items ?? []).filter(
      (i) => i.status === 'pending' || i.status === 'running',
    ).length
    err.value = `Trailer na fila (${pending} activo(s)). Progresso no reprodutor / Admin.`
  } catch (e: unknown) {
    err.value = apiErrMessage(e, 'Falha ao enfileirar reprocessar trailer.')
  } finally {
    trailerBusy.value = null
  }
}

async function bootstrapDupPage() {
  await loadLibrarySessions()
  await loadStored()
  if (scanBusy.value) return
  try {
    const active = await $fetch<{
      jobId?: string
      status?: string
      progress?: { pct?: number; message?: string }
    }>('/api/duplicates/scan-status').catch(() => null)
    if (!active || active.status !== 'running' || !active.jobId) return
    scanBusy.value = true
    scanPct.value = Math.max(1, Math.floor(active.progress?.pct ?? 1))
    scanProgressMsg.value = active.progress?.message || 'A retomar scan…'
    await pollScanJob(active.jobId)
  } catch {
    /* sem job activo */
  } finally {
    scanBusy.value = false
  }
}

async function submitCatalogUnlock() {
  catalogGateError.value = ''
  catalogGateBusy.value = true
  try {
    await $fetch('/api/catalog-unlock', {
      method: 'POST',
      credentials: 'include',
      body: { password: catalogGatePassword.value },
    })
    writeCatalogTabUnlocked(true)
    catalogUnlocked.value = true
    catalogGatePassword.value = ''
    await bootstrapDupPage()
  } catch (e: unknown) {
    catalogGateError.value = apiErrMessage(e, 'Senha incorrecta.')
    catalogUnlocked.value = false
    writeCatalogTabUnlocked(false)
  } finally {
    catalogGateBusy.value = false
  }
}

onMounted(() => {
  void (async () => {
    catalogGateChecking.value = true
    try {
      const tabOk = readCatalogTabUnlocked()
      const lockUrl = tabOk ? '/api/catalog-lock' : '/api/catalog-lock?fresh=1'
      const lock = await $fetch<{ required: boolean; unlocked: boolean }>(lockUrl, {
        credentials: 'include',
      })
      catalogGateRequired.value = Boolean(lock.required)
      if (lock.required) {
        if (tabOk && lock.unlocked) {
          catalogUnlocked.value = true
        } else {
          writeCatalogTabUnlocked(false)
          catalogUnlocked.value = false
        }
      } else {
        writeCatalogTabUnlocked(false)
        catalogUnlocked.value = true
      }
    } catch {
      catalogGateRequired.value = false
      catalogUnlocked.value = true
    } finally {
      catalogGateChecking.value = false
    }

    if (catalogGateRequired.value && !catalogUnlocked.value) {
      await nextTick()
      catalogGateInputRef.value?.focus()
      return
    }
    await bootstrapDupPage()
  })()
})
</script>

<style scoped>
.dup-page {
  flex: 1 1 auto;
  width: 100%;
  box-sizing: border-box;
  min-height: 100dvh;
  min-height: 100%;
  background: #0c0d10;
  color: #e8eaed;
  font-family: system-ui, 'Segoe UI', sans-serif;
}

.catalog-gate {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0c0d10;
}

.catalog-gate-card {
  width: min(92vw, 22rem);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.25rem 1.35rem;
  border: 1px solid #2a2d36;
  border-radius: 12px;
  background: #14161c;
}

.catalog-gate-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: #e8eaef;
}

.catalog-gate-hint {
  margin: 0;
  font-size: 0.875rem;
  color: #9aa0ad;
  line-height: 1.4;
}

.catalog-gate-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.65rem 0.75rem;
  border: 1px solid #3a3f4c;
  border-radius: 8px;
  background: #0c0d10;
  color: #e8eaef;
  font-size: 1rem;
}

.catalog-gate-error {
  margin: 0;
  font-size: 0.85rem;
  color: #f8b4b0;
}

.catalog-gate-btn {
  padding: 0.65rem 0.9rem;
  border: none;
  border-radius: 8px;
  background: #3d6df0;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.catalog-gate-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dup-page-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 1rem 1.1rem 2.5rem;
  box-sizing: border-box;
}

.admin-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-bottom: 0.75rem;
}

.admin-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
}

.admin-head-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.admin-back {
  color: #8ab4f8;
  text-decoration: none;
  font-size: 0.9rem;
}

.admin-lead {
  color: #bdc1c6;
  font-size: 0.9rem;
  line-height: 1.45;
  margin: 0 0 1rem;
}

.admin-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.84em;
  color: #fdd663;
}

.empty-hint-link {
  color: #8ab4f8;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.admin-card {
  background: #15171c;
  border: 1px solid #2d333b;
  border-radius: 10px;
  padding: 1rem 1.1rem;
  margin-bottom: 1rem;
}

.admin-h2 {
  margin: 0 0 0.65rem;
  font-size: 1rem;
  font-weight: 700;
}

.admin-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.75rem;
  align-items: flex-end;
}

.scan-progress {
  margin-top: 0.85rem;
  padding: 0.7rem 0.75rem 0.65rem;
  background: #12141a;
  border: 1px solid #2a5a9e;
  border-radius: 8px;
  box-shadow: 0 0 0 1px rgba(26, 115, 232, 0.25);
}

.scan-progress-track {
  height: 12px;
  background: #1a1d24;
  border-radius: 6px;
  overflow: hidden;
}

.scan-progress-bar {
  height: 100%;
  min-width: 2%;
  background: linear-gradient(90deg, #1a73e8, #4ea1ff);
  transition: width 0.25s ease;
}

.scan-progress-text {
  margin: 0.45rem 0 0;
  font-size: 0.88rem;
  color: #e8eaed;
}

.scan-progress-text strong {
  color: #8ab4f8;
  font-variant-numeric: tabular-nums;
}

.admin-card--scanning {
  opacity: 0.55;
  pointer-events: none;
}

.admin-check-label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: #9aa0a6;
}

.admin-check-label--row {
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
  align-self: flex-end;
  padding-bottom: 0.35rem;
  cursor: pointer;
  user-select: none;
  color: #bdc1c6;
}

.admin-check {
  width: 1rem;
  height: 1rem;
  accent-color: #1a73e8;
}

.admin-input {
  background: #0d0e10;
  border: 1px solid #3c4043;
  border-radius: 8px;
  color: #e8eaed;
  padding: 0.35rem 0.5rem;
  min-width: 4.5rem;
}

.admin-btn {
  border: 1px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  border-radius: 8px;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  font-size: 0.88rem;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
}

.admin-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.admin-btn--primary {
  background: #1a73e8;
  border-color: #1a73e8;
}

.admin-btn--danger {
  background: #3c1f1e;
  border-color: #8b2e2a;
  color: #f8b4b0;
}

.admin-btn--on {
  border-color: #5f9dee;
  background: #2a3f5f;
}

.admin-btn--fav {
  border-color: #c9a227;
  background: #3a3218;
  color: #fdd663;
}

.admin-btn--shrink {
  border-color: rgba(242, 139, 130, 0.55);
  color: #f28b82;
}

.admin-btn--destaque {
  border-color: #5f9dee;
  background: #1e2a3d;
  color: #8ab4f8;
}

.admin-btn--sm {
  padding: 0.22rem 0.45rem;
  font-size: 0.75rem;
}

.admin-muted {
  color: #9aa0a6;
  font-size: 0.88rem;
}

.admin-meta {
  color: #bdc1c6;
  font-size: 0.84rem;
  font-weight: 400;
}

.admin-err {
  color: #f8b4b0;
  font-size: 0.88rem;
  margin: 0.55rem 0 0;
}

.compare-row {
  display: grid;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}

.compare-row--1 {
  grid-template-columns: 1fr;
}

.compare-row--2 {
  grid-template-columns: 1fr 1fr;
}

.compare-row--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.compare-row--4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 1100px) {
  .compare-row--4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .compare-row--2,
  .compare-row--3,
  .compare-row--4 {
    grid-template-columns: 1fr;
  }
}

.focus-block {
  margin: 0 0 1rem;
  padding: 0.75rem 0.85rem 0.9rem;
  border: 1px solid #2d333b;
  border-radius: 10px;
  background: #0f1116;
}

.focus-block--sure {
  border-color: transparent;
  background:
    linear-gradient(#0f1116, #0f1116) padding-box,
    conic-gradient(
      from var(--dup-spin, 0deg),
      #22c55e,
      #14532d 28%,
      transparent 42%,
      #4ade80 68%,
      #22c55e
    )
      border-box;
  border: 2px solid transparent;
  animation: dup-sure-spin 1.5s linear infinite;
}

.dup-sure-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.12rem 0.45rem;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #052e16;
  background: #4ade80;
}

.focus-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.65rem;
  margin-bottom: 0.65rem;
}

.focus-empty {
  margin: 0 0 1rem;
}

.pane {
  background: #15171c;
  border: 1px solid #2d333b;
  border-radius: 10px;
  padding: 0.65rem 0.75rem 0.8rem;
  min-width: 0;
}

.pane--sure {
  border-color: transparent;
  background:
    linear-gradient(#15171c, #15171c) padding-box,
    conic-gradient(
      from var(--dup-spin, 0deg),
      #22c55e,
      #14532d 28%,
      transparent 42%,
      #4ade80 68%,
      #22c55e
    )
      border-box;
  border: 2px solid transparent;
  animation: dup-sure-spin 1.5s linear infinite;
}

.pane--keep {
  border-color: #5f9dee;
  box-shadow: 0 0 0 1px color-mix(in srgb, #5f9dee 40%, transparent);
}

.keep-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: #8ab4f8;
  cursor: pointer;
  user-select: none;
}

.keep-label input {
  accent-color: #1a73e8;
}

.pane-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.55rem;
  margin-bottom: 0.45rem;
}

.pane-sess {
  color: #8ab4f8;
  font-size: 0.82rem;
  font-weight: 600;
}

.pane-video-wrap {
  aspect-ratio: 16 / 9;
  background: #0a0b0d;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pane-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #000;
}

.pane-empty {
  margin: 0;
  padding: 1rem;
  color: #5f6368;
  font-size: 0.88rem;
  text-align: center;
}

.pane-arm {
  width: 100%;
  height: 100%;
  border: none;
  background: #0a0b0d;
  color: #8ab4f8;
  font: inherit;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
}

.pane-arm:hover {
  background: #12141a;
  color: #c2d7fc;
}

.pane-name {
  margin: 0.45rem 0 0;
  font-size: 0.86rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-sizes {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: #fdd663;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.35rem;
  align-items: baseline;
}

.pane-sizes-sep {
  color: #5f6368;
}

.pane-sizes-loading {
  color: #9aa0a6;
}

.pane-shrinked {
  color: #f28b82;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.pane-tags {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: #9aa0a6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
}

.pane-actions--player-toggle {
  margin-top: 0.45rem;
}

.pane-player-panel {
  margin-top: 0.35rem;
  padding-top: 0.45rem;
  border-top: 1px solid #2d333b;
}

.pane-player-panel--theater .pane-video-wrap {
  /* reserved: cinema no card usa a mesma barra */
}

.dup-move-backdrop {
  position: fixed;
  inset: 0;
  z-index: 243;
  background: rgba(0, 0, 0, 0.55);
}

.dup-move-dialog {
  position: fixed;
  inset: 0;
  z-index: 244;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  pointer-events: none;
}

.dup-move-card {
  pointer-events: auto;
  width: min(400px, 94vw);
  max-height: min(72vh, 520px);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  background: #1a1d22;
  border: 1px solid #2d333b;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  padding: 0.85rem;
  overflow: auto;
}

.dup-move-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-weight: 700;
  color: #e8eaed;
}

.dup-move-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.dup-shrink-dialog {
  position: fixed;
  inset: 0;
  z-index: 244;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  pointer-events: none;
}

.dup-shrink-card {
  pointer-events: auto;
  width: min(540px, 96vw);
  max-height: min(88vh, 720px);
  display: flex;
  flex-direction: column;
  background: #1a1d22;
  border: 1px solid #2d333b;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.dup-shrink-body {
  flex: 1;
  overflow: auto;
  padding: 0 0.85rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.dup-shrink-file {
  margin: 0;
  font-size: 0.85rem;
  color: #e8eaed;
  word-break: break-all;
}

.dup-shrink-already {
  margin: 0;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  border: 2px solid #e0aa20;
  background: linear-gradient(180deg, #4a3210 0%, #2e1f0a 100%);
  color: #ffe7a3;
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.45;
}

.dup-shrink-already-title {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #ffcc66;
}

.dup-shrink-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem 0.65rem;
}

.dup-shrink-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  font-size: 0.8rem;
  color: #bdc1c6;
}

.dup-shrink-field--full {
  grid-column: 1 / -1;
}

.dup-shrink-field .admin-input,
.dup-shrink-card .admin-input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  border: 1px solid #3c4043;
  background: #15171c;
  color: #e8eaed;
}

.dup-shrink-check {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  font-size: 0.82rem;
  color: #e8eaed;
}

.dup-shrink-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
  padding: 0.65rem 0.85rem 0.85rem;
  border-top: 1px solid #2d333b;
}

.dup-shrink-card .admin-btn--primary {
  border-color: #1a73e8;
  background: #1a73e8;
  color: #fff;
}

.pane-tags-panel {
  margin-top: 0.55rem;
  padding: 0.55rem 0.6rem;
  border-radius: 8px;
  background: #12141a;
  border: 1px solid #2d333b;
}

.pane-tags-panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
}

.tag-panel-action-btn {
  border: 1px solid #3c4043;
  background: #1e2128;
  color: #e8eaed;
  border-radius: 6px;
  padding: 0.28rem 0.55rem;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.tag-panel-action-btn:hover {
  border-color: #5f6368;
  background: #252830;
}

.tag-input-row {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
}

.tag-input {
  flex: 1;
  min-width: 0;
  border: 1px solid #3c4043;
  border-radius: 6px;
  background: #0c0d10;
  color: #e8eaed;
  padding: 0.35rem 0.5rem;
  font: inherit;
  font-size: 0.82rem;
}

.tag-add-btn {
  border: 1px solid #1a73e8;
  background: #1a73e8;
  color: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.65rem;
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}

.tag-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag-chip {
  border: 1px solid #3c4043;
  background: #1e2128;
  color: #c2d7fc;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
}

.tag-chip:hover {
  border-color: #5f9dee;
  background: #252830;
}

.tag-chip-text {
  pointer-events: none;
}

.admin-btn--memorable {
  border-color: #c9a227;
  background: #2a2410;
  color: #fdd663;
}

.dup-groups {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: min(55vh, 640px);
  overflow: auto;
}

.dup-group {
  border: 1px solid #2d333b;
  border-radius: 8px;
  padding: 0.55rem 0.7rem;
  background: #12141a;
  cursor: pointer;
}

.dup-group:hover {
  border-color: #5f6368;
}

.dup-group--focus {
  border-color: #5f9dee;
}

.dup-group--sure {
  border-color: transparent;
  background:
    linear-gradient(#12141a, #12141a) padding-box,
    conic-gradient(
      from var(--dup-spin, 0deg),
      #22c55e,
      #14532d 28%,
      transparent 42%,
      #4ade80 68%,
      #22c55e
    )
      border-box;
  border: 2px solid transparent;
  animation: dup-sure-spin 1.5s linear infinite;
}

.dup-group--sure:hover {
  border-color: transparent;
}

.dup-group--sure.dup-group--focus {
  border-color: transparent;
}

@property --dup-spin {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@keyframes dup-sure-spin {
  to {
    --dup-spin: 360deg;
  }
}

.dup-group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.65rem;
  margin-bottom: 0.35rem;
}

.dup-group-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-left: auto;
}

.dup-video-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.dup-video {
  display: grid;
  grid-template-columns: minmax(5.5rem, auto) minmax(0, 1fr) auto;
  gap: 0.45rem;
  align-items: baseline;
  min-width: 0;
  padding: 0.15rem 0;
}

.dup-video--in .dup-name {
  color: #8ab4f8;
}

.dup-sess {
  color: #8ab4f8;
  font-weight: 600;
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 11rem;
}

.dup-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.84rem;
}

.dup-size {
  color: #fdd663;
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
