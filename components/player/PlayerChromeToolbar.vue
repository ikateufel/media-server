<script setup lang="ts">
import IconTrailerRandom from '~/components/IconTrailerRandom.vue'
import { PLAYBACK_RATES } from '~/composables/useVideoFolder'

export type PlayerChromeMode = 'trailer' | 'full'

export interface PlayerChromeTitle {
  displayName: string
  mainFilename?: string
  mainSizeBytes?: number
  isFavorite: boolean
  isMemorable: boolean
  inDestaques: boolean
  hasMain: boolean
  tags: string[]
}

const props = withDefaults(
  defineProps<{
    mode: PlayerChromeMode
    title: PlayerChromeTitle | null
    chromeCollapsed: boolean
    theaterMode?: boolean
    playbackRate: number
    playbackRates?: readonly number[]
    showTheater?: boolean
    showTags?: boolean
    showMove?: boolean
    showEditor?: boolean
    showTrailerReprocess?: boolean
    showShrink?: boolean
    showDelete?: boolean
    showReveal?: boolean
    showNav?: boolean
    showPin?: boolean
    showShuffle?: boolean
    showOpenFull?: boolean
    showFastPlay?: boolean
    showNameRow?: boolean
    showSizeInName?: boolean
    destaqueBusy?: boolean
    shrinkBusy?: boolean
    trailerBusy?: boolean
    pinCount?: number
    pinAtCap?: boolean
    pinDisabled?: boolean
    pinTitle?: string
    pinAria?: string
    shuffleOn?: boolean
    shuffleDisabled?: boolean
    fastPlayOn?: boolean
    tagsPanelOpen?: boolean
    tagsHidden?: boolean
    revealTitle?: string
    revealAria?: string
    rateSelectId?: string
    tagSuggestions?: string[]
    tagFilterActive?: string | null
    tagInput: string
    tagInputId?: string
    datalistId?: string
  }>(),
  {
    theaterMode: false,
    playbackRates: () => PLAYBACK_RATES,
    showTheater: true,
    showTags: true,
    showMove: true,
    showEditor: true,
    showTrailerReprocess: true,
    showShrink: true,
    showDelete: true,
    showReveal: true,
    showNav: false,
    showPin: false,
    showShuffle: false,
    showOpenFull: true,
    showFastPlay: true,
    showNameRow: true,
    showSizeInName: true,
    destaqueBusy: false,
    shrinkBusy: false,
    trailerBusy: false,
    pinCount: 0,
    pinAtCap: false,
    pinDisabled: false,
    pinTitle: 'Fixar trailer',
    pinAria: 'Fixar trailer',
    shuffleOn: false,
    shuffleDisabled: false,
    fastPlayOn: false,
    tagsPanelOpen: false,
    tagsHidden: false,
    revealTitle: 'Abrir pasta no explorador',
    revealAria: 'Abrir pasta no explorador',
    rateSelectId: 'rate-select-player',
    tagSuggestions: () => [],
    tagFilterActive: null,
    tagInputId: 'tag-input-player',
    datalistId: 'player-tag-suggestions',
  },
)

const emit = defineEmits<{
  'update:chromeCollapsed': [value: boolean]
  'update:theaterMode': [value: boolean]
  'update:playbackRate': [value: number]
  'update:tagInput': [value: string]
  toggleFavorite: []
  toggleMemorable: []
  toggleDestaque: []
  openTags: []
  openMove: []
  openEditor: []
  openTrailerReprocess: []
  openShrink: []
  deleteTitle: []
  reveal: []
  prevTrailer: []
  nextTrailer: []
  pinSplit: []
  clearPins: []
  toggleShuffle: []
  openFull: []
  closeFull: []
  toggleFastPlay: []
  openTagInput: []
  hideTags: []
  addTags: []
  tagPointerDown: [tag: string, event: PointerEvent]
  tagPointerUp: [tag: string, event: PointerEvent]
  tagPointerCancel: [event: PointerEvent]
}>()

const rates = computed(() =>
  props.playbackRates?.length ? props.playbackRates : PLAYBACK_RATES,
)

const fileLabel = computed(
  () => props.title?.mainFilename || props.title?.displayName || '',
)

const sizeBytes = computed(() => Number(props.title?.mainSizeBytes ?? 0))

function formatGB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function onRateChange(e: Event) {
  const v = Number((e.target as HTMLSelectElement).value)
  if (Number.isFinite(v)) emit('update:playbackRate', v)
}

function onTagInput(e: Event) {
  emit('update:tagInput', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <div
    class="player-chrome toolbar"
    :class="mode === 'trailer' ? 'toolbar--trailer toolbar--trailer-compact' : 'toolbar--full toolbar--full-main'"
  >
    <div :class="mode === 'trailer' ? 'toolbar-trailer-icons' : 'toolbar-full-main-row'">
      <button
        type="button"
        class="icon-tool icon-tool--chrome-toggle"
        :class="{ 'icon-tool--on': chromeCollapsed }"
        :title="chromeCollapsed ? 'Mostrar controlos e nome' : 'Recolher controlos e nome'"
        :aria-pressed="chromeCollapsed"
        :aria-label="chromeCollapsed ? 'Mostrar controlos e nome' : 'Recolher controlos e nome'"
        @click="emit('update:chromeCollapsed', !chromeCollapsed)"
      >
        <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path :d="chromeCollapsed ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'" />
        </svg>
      </button>

      <div
        v-show="!chromeCollapsed"
        :class="mode === 'trailer' ? 'toolbar-trailer-icons-main' : 'toolbar-full-icons-main'"
      >
        <button
          v-if="mode === 'full'"
          type="button"
          class="icon-tool"
          title="Voltar ao trailer"
          @click="emit('closeFull')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <button
          v-if="showTheater"
          type="button"
          class="icon-tool icon-tool--theater"
          :class="{ 'icon-tool--on': theaterMode }"
          :title="theaterMode ? 'Sair do modo cinema' : 'Modo cinema (só vídeo e barra inferior)'"
          :aria-pressed="theaterMode"
          aria-label="Alternar modo cinema"
          @click="emit('update:theaterMode', !theaterMode)"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
            <path d="m6.2 5.3 3.1 3.9" />
            <path d="m12.4 3.4 3.1 4" />
            <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
        </button>

        <button
          v-if="mode === 'trailer' && title && showTags"
          type="button"
          class="icon-tool icon-tool--tag"
          :class="{ 'icon-tool--on': tagsPanelOpen && !tagsHidden }"
          :aria-expanded="tagsPanelOpen && !tagsHidden"
          :title="tagsHidden ? 'Mostrar tags' : 'Adicionar tag'"
          :aria-label="tagsHidden ? 'Mostrar tags' : 'Adicionar tag'"
          @click="emit('openTags')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83Z" />
            <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <button
          v-if="title"
          type="button"
          class="icon-tool icon-tool--fav"
          :class="{ 'icon-tool--fav-on': title.isFavorite }"
          :aria-pressed="title.isFavorite"
          :title="title.isFavorite ? 'Retirar dos favoritos' : 'Favorito'"
          @click="emit('toggleFavorite')"
        >
          {{ title.isFavorite ? '★' : '☆' }}
        </button>

        <button
          v-if="title"
          type="button"
          class="icon-tool icon-tool--memorable"
          :class="{ 'icon-tool--memorable-on': title.isMemorable }"
          :aria-pressed="title.isMemorable"
          :title="
            title.isMemorable
              ? 'Retirar marca de memorável'
              : 'Memorável (marca como visto e empurra para o fim)'
          "
          @click="emit('toggleMemorable')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 4h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4z" />
            <path d="M17 5h3a2 2 0 0 1-3 4" />
            <path d="M7 5H4a2 2 0 0 0 3 4" />
            <path d="M9 21h6" />
            <path d="M12 12v6" />
            <path d="M9.5 18h5l-.5 3h-4z" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <button
          v-if="title"
          type="button"
          class="icon-tool icon-tool--recents"
          :class="{ 'icon-tool--recents-on': title.inDestaques }"
          :disabled="destaqueBusy"
          :title="
            title.inDestaques
              ? 'Remover da lista «Destaques»'
              : 'Adicionar a «Destaques» (lista no topo do menu)'
          "
          :aria-label="title.inDestaques ? 'Remover de Destaques' : 'Adicionar a Destaques'"
          :aria-pressed="title.inDestaques"
          @click="emit('toggleDestaque')"
        >
          <svg
            v-if="!title.inDestaques"
            class="icon-svg"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
          <svg
            v-else
            class="icon-svg"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
            />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>

        <button
          v-if="title && showMove"
          type="button"
          class="icon-tool icon-tool--move-library"
          title="Mover vídeo completo, trailer, preview e miniaturas para outra biblioteca de pastas"
          aria-label="Mover para outra pasta"
          @click="emit('openMove')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <path d="M12 11v6M9 14h6" />
          </svg>
        </button>

        <button
          v-if="title?.hasMain && showEditor"
          type="button"
          class="icon-tool icon-tool--editor"
          title="Editar vídeo completo (abre o editor — backup e substitui o original)"
          aria-label="Abrir no editor de vídeo"
          @click="emit('openEditor')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>

        <button
          v-if="title?.hasMain && showTrailerReprocess"
          type="button"
          class="icon-tool icon-tool--trailer-redo"
          :class="{ 'icon-tool--busy': trailerBusy }"
          :disabled="shrinkBusy"
          title="Reprocessar trailer deste vídeo (fila — opções do trailer.bat)"
          aria-label="Reprocessar trailer"
          @click="emit('openTrailerReprocess')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
        </button>

        <button
          v-if="title?.hasMain && showShrink"
          type="button"
          class="icon-tool icon-tool--shrink"
          :class="{ 'icon-tool--busy': shrinkBusy }"
          :disabled="trailerBusy"
          title="Shrink do vídeo completo (fila — substitui o original)"
          aria-label="Shrink do vídeo completo"
          @click="emit('openShrink')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            <path d="M10 20v-1a2 2 0 1 1 4 0v1a2 2 0 1 1-4 0Z" />
            <path d="M12 7v1" />
            <path d="M12 11v1" />
            <path d="M12 15v1" />
          </svg>
        </button>

        <template v-if="mode === 'trailer' && showNav">
          <button type="button" class="icon-tool" title="Trailer anterior" @click="emit('prevTrailer')">
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <g transform="scale(-1 1) translate(-24 0)">
                <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
              </g>
            </svg>
          </button>
          <button type="button" class="icon-tool" title="Próximo trailer" @click="emit('nextTrailer')">
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
            </svg>
          </button>
        </template>

        <button
          v-if="mode === 'trailer' && showPin"
          type="button"
          class="icon-tool"
          :class="{
            'icon-tool--on': (pinCount ?? 0) > 0,
            'icon-tool--at-cap': pinAtCap,
          }"
          :disabled="pinDisabled"
          :title="pinTitle"
          :aria-label="pinAria"
          @click="emit('pinSplit')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2.5" y="5" width="8.5" height="14" rx="1.5" />
            <rect x="13" y="5" width="8.5" height="14" rx="1.5" />
          </svg>
        </button>

        <button
          v-if="mode === 'trailer' && showPin && (pinCount ?? 0) > 0"
          type="button"
          class="icon-tool"
          title="Remover trailers fixos (por baixo)"
          aria-label="Remover trailers fixos"
          @click="emit('clearPins')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <button
          v-if="mode === 'trailer' && showShuffle"
          type="button"
          class="icon-tool"
          :class="{ 'icon-tool--shuffle-on': shuffleOn }"
          title="Aleatório ao avançar"
          :disabled="shuffleDisabled"
          :aria-pressed="shuffleOn"
          aria-label="Alternar aleatório ao avançar"
          @click="emit('toggleShuffle')"
        >
          <IconTrailerRandom />
        </button>

        <button
          v-if="mode === 'trailer' && showOpenFull"
          type="button"
          class="icon-tool icon-tool--primary"
          :disabled="title ? !title.hasMain : true"
          :title="title && !title.hasMain ? 'Completo em falta' : 'Vídeo completo'"
          @click="emit('openFull')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="14" rx="2" />
            <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <button
          v-if="title && showDelete"
          type="button"
          class="icon-tool icon-tool--danger"
          title="Mover para a Lixeira (completo, trailer, preview)"
          @click="emit('deleteTitle')"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M8 6V4h8v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12M10 11v6M14 11v6" stroke-linecap="round" />
          </svg>
        </button>

        <button
          v-if="mode === 'full' && title && showFastPlay"
          type="button"
          class="icon-tool icon-tool--fast-play"
          :class="{ 'icon-tool--on': fastPlayOn }"
          title="Fast Play"
          :aria-pressed="fastPlayOn"
          @click="emit('toggleFastPlay')"
        >
          FAST
        </button>
      </div>

      <div class="toolbar-chrome-persist">
        <div class="rate-block rate-block--inline">
          <select
            :id="rateSelectId"
            class="rate-select rate-select--compact"
            :value="playbackRate"
            title="Velocidade"
            aria-label="Velocidade"
            @change="onRateChange"
          >
            <option v-for="r in rates" :key="r" :value="r">
              {{ r === 1 ? '1×' : `${r}×` }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <div
      v-if="showNameRow && title && !chromeCollapsed"
      class="media-card-playback-name-row"
    >
      <button
        v-if="showReveal"
        type="button"
        class="icon-tool icon-tool--reveal-explorer"
        :title="revealTitle"
        :aria-label="revealAria"
        @click="emit('reveal')"
      >
        <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
        </svg>
      </button>
      <p class="media-card-playback-video-name" :title="fileLabel">
        <span
          v-if="showSizeInName && sizeBytes > 0"
          class="media-card-playback-video-size"
        >{{ formatGB(sizeBytes) }}</span>
        {{ fileLabel }}
      </p>
    </div>

    <div
      v-if="title && showTags && !tagsHidden && (mode === 'trailer' || !chromeCollapsed)"
      :class="[
        mode === 'trailer' ? 'toolbar-tags-panel' : 'toolbar-full-tags',
        { 'toolbar-tags-panel--input-open': tagsPanelOpen },
      ]"
    >
      <div v-if="mode === 'trailer'" class="toolbar-tags-panel-actions">
        <button type="button" class="tag-panel-action-btn" @click="emit('openTagInput')">
          Adicionar tags
        </button>
        <button type="button" class="tag-panel-action-btn" @click="emit('hideTags')">
          Esconder tags
        </button>
      </div>
      <div v-show="mode === 'full' || tagsPanelOpen" class="tag-input-row">
        <input
          :id="tagInputId"
          :value="tagInput"
          type="text"
          class="tag-input"
          maxlength="80"
          placeholder="Uma ou várias tags (separar com , ou ;)"
          :list="datalistId"
          autocomplete="off"
          @input="onTagInput($event)"
          @keydown.enter.prevent="emit('addTags')"
        />
        <button type="button" class="tag-add-btn" @click="emit('addTags')">Adicionar</button>
      </div>
      <datalist :id="datalistId">
        <option v-for="s in tagSuggestions" :key="s" :value="s" />
      </datalist>
      <div
        v-if="title.tags.length > 0"
        class="tag-chip-list"
        aria-label="Tags deste título"
      >
        <button
          v-for="t in title.tags"
          :key="t"
          type="button"
          class="tag-chip"
          :class="{ 'tag-chip--active': tagFilterActive === t }"
          :title="`Manter ~2s premido e soltar para remover «${t}»`"
          @pointerdown="emit('tagPointerDown', t, $event)"
          @pointerup="emit('tagPointerUp', t, $event)"
          @pointercancel="emit('tagPointerCancel', $event)"
        >
          <span class="tag-chip-text">{{ t }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style src="~/assets/css/player-chrome.css"></style>
