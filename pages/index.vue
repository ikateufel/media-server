<template>
  <div class="layout" :class="{ 'layout--tv-silk': isSilkTvLike }">
    <div v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</div>

    <div
      v-if="toastVisible"
      class="toast"
      :class="toastVariant === 'success' ? 'toast--success' : 'toast--error'"
      role="status"
      aria-live="polite"
    >
      {{ toastMessage }}
    </div>

    <div
      class="main-stack"
      :class="{
        'main-stack--catalog-collapsed': catalogGridCollapsed,
        'main-stack--with-catalog-split': catalogSplitterInLayout,
      }"
      :style="mainStackGridStyle"
    >
      <section class="media-card">
        <div class="media-card-top">
          <button
            v-if="sessions.length"
            type="button"
            class="menu-btn"
            aria-haspopup="true"
            :aria-expanded="sessionMenuOpen"
            aria-controls="session-menu-panel"
            title="Bibliotecas"
            @click="sessionMenuOpen = true"
          >
            <span class="menu-btn-bars" aria-hidden="true" />
          </button>
          <p
            v-if="selectedEntry && (previewUrl || playerUrl)"
            class="media-card-filename media-card-folder"
            :title="selectedEntry.mainFilename"
          >
            {{ playbackFolderCaption }}
          </p>
          <div v-else class="media-card-filename media-card-filename--empty" aria-hidden="true" />
        </div>

        <div
          class="video-shell"
          :class="{
            'video-shell--with-pins': pinnedTrailers.length > 0 && !playerUrl && previewUrl,
            'video-shell--catalog-collapsed-layout':
              catalogGridCollapsed && pinnedTrailers.length > 0 && !playerUrl && previewUrl,
            'video-shell--slot-count-3':
              catalogGridCollapsed && pinnedTrailers.length === 2 && !playerUrl && previewUrl,
          }"
        >
          <template v-if="!playerUrl && previewUrl && pinnedTrailers.length > 0">
            <div class="video-shell-main" title="Segue o título seleccionado na grelha">
              <span class="video-shell-pane-badge video-shell-pane-badge--main" aria-hidden="true">Grelha</span>
              <div ref="previewFullscreenWrapRef" class="stage-fullscreen-wrap">
                <video
                  ref="previewVideoRef"
                  :key="`${sessionIndex}-${previewUrl}`"
                  class="stage-video"
                  :src="previewUrl"
                  :muted="previewTrailerMuted"
                  playsinline
                  controls
                  :preload="videoPreloadAttr"
                  @loadeddata="onPreviewLoaded"
                  @ended="onPreviewEnded"
                  @ratechange="syncRateFromVideo"
                  @volumechange="onPreviewTrailerVolumeChange"
                  @error="onStageVideoError"
                />
                <div
                  v-show="trailerStageFullscreen && entries.length > 0"
                  class="stage-fullscreen-trailer-actions"
                  aria-label="Controlo no trailer em ecrã inteiro"
                >
                  <button
                    type="button"
                    class="stage-fullscreen-trailer-btn"
                    title="Próximo trailer"
                    @click.stop="goToNextTrailer"
                  >
                    <span>Próximo trailer</span>
                    <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                      <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="video-shell-pinned-row" role="group" aria-label="Trailers fixos em loop">
              <div
                v-for="(pUrl, idx) in pinnedTrailers"
                :key="`pinned-${sessionIndex}-${idx}-${pUrl}`"
                class="video-shell-pane video-shell-pane--pinned"
                :title="`Trailer fixo ${idx + 1} em loop. A grelha muda em cima; estes mantêm-se.`"
              >
                <span class="video-shell-pane-badge" aria-hidden="true">Fixo {{ idx + 1 }}</span>
                <video
                  class="stage-video"
                  :src="pUrl"
                  :muted="previewTrailerMuted"
                  playsinline
                  controls
                  loop
                  :preload="videoPreloadAttr"
                  @loadeddata="onPinnedPreviewLoaded"
                  @ratechange="onPinnedRateChange"
                  @volumechange="onPreviewTrailerVolumeChange"
                  @error="onStageVideoError"
                />
              </div>
            </div>
          </template>
          <div
            v-else-if="!playerUrl && previewUrl"
            ref="previewFullscreenWrapRef"
            class="stage-fullscreen-wrap"
          >
            <video
              ref="previewVideoRef"
              :key="`${sessionIndex}-${previewUrl}`"
              class="stage-video"
              :src="previewUrl"
              :muted="previewTrailerMuted"
              playsinline
              controls
              :preload="videoPreloadAttr"
              @loadeddata="onPreviewLoaded"
              @ended="onPreviewEnded"
              @ratechange="syncRateFromVideo"
              @volumechange="onPreviewTrailerVolumeChange"
              @error="onStageVideoError"
            />
            <div
              v-show="trailerStageFullscreen && entries.length > 0"
              class="stage-fullscreen-trailer-actions"
              aria-label="Controlo no trailer em ecrã inteiro"
            >
              <button
                type="button"
                class="stage-fullscreen-trailer-btn"
                title="Próximo trailer"
                @click.stop="goToNextTrailer"
              >
                <span>Próximo trailer</span>
                <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                  <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                </svg>
              </button>
            </div>
          </div>
          <video
            v-else-if="playerUrl"
            ref="mainVideoRef"
            :key="`${sessionIndex}-${playerUrl}`"
            class="stage-video"
            :class="{ 'stage-video--fast-play': fastPlayEnabled }"
            :src="playerUrl"
            :controls="mainVideoNativeControls"
            playsinline
            :preload="videoPreloadAttr"
            @loadedmetadata="onMainVideoLoadedMetadata"
            @timeupdate="onMainVideoTimeUpdate"
            @seeking="onMainVideoSeeking"
            @ended="onMainVideoEnded"
            @ratechange="syncRateFromVideo"
            @click="onMainVideoSurfaceClick"
            @error="onStageVideoError"
          />
          <div v-else class="preview-placeholder">Escolha um título na lista.</div>
        </div>

        <div v-if="!playerUrl && previewUrl" class="toolbar toolbar--trailer toolbar--trailer-compact">
          <div class="toolbar-trailer-icons">
            <button
              v-if="focusedIndex !== null && selectedEntry"
              type="button"
              class="icon-tool icon-tool--fav"
              :class="{ 'icon-tool--fav-on': selectedEntry.isFavorite }"
              :aria-pressed="!!selectedEntry.isFavorite"
              :title="selectedEntry.isFavorite ? 'Retirar dos favoritos' : 'Favorito'"
              @click="toggleFavoriteAtIndex(focusedIndex)"
            >
              {{ selectedEntry.isFavorite ? '★' : '☆' }}
            </button>
            <button
              v-if="focusedIndex !== null && selectedEntry"
              type="button"
              class="icon-tool icon-tool--memorable"
              :class="{ 'icon-tool--memorable-on': isEntryMemorable(selectedEntry) }"
              :aria-pressed="isEntryMemorable(selectedEntry)"
              :title="isEntryMemorable(selectedEntry)
                ? 'Retirar marca de memorável'
                : 'Memorável (marca como visto e empurra para o fim)'"
              @click="toggleMemorableAtIndex(focusedIndex)"
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
              v-if="focusedIndex !== null && selectedEntry"
              type="button"
              class="icon-tool icon-tool--recents"
              :class="{ 'icon-tool--recents-on': isPlaybackTitleInRecentList(selectedEntry) }"
              :disabled="recentsMutationBusy"
              :title="
                isPlaybackTitleInRecentList(selectedEntry)
                  ? 'Remover da lista «Destaques»'
                  : 'Adicionar a «Destaques» (lista no topo do menu)'
              "
              :aria-label="
                isPlaybackTitleInRecentList(selectedEntry)
                  ? 'Remover de Destaques'
                  : 'Adicionar a Destaques'
              "
              :aria-pressed="isPlaybackTitleInRecentList(selectedEntry)"
              @click="toggleCurrentTitleRecents"
            >
              <svg
                v-if="!isPlaybackTitleInRecentList(selectedEntry)"
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
              v-if="moveTitleDesktopEligible && focusedIndex !== null && selectedEntry"
              type="button"
              class="icon-tool icon-tool--move-library"
              title="Mover vídeo completo, trailer, preview e miniaturas para outra biblioteca de pastas"
              aria-label="Mover para outra pasta"
              @click="openMoveTitleDialog()"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <path d="M12 11v6M9 14h6" />
              </svg>
            </button>
            <button type="button" class="icon-tool" title="Trailer anterior" @click="goToPrevTrailer">
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <g transform="scale(-1 1) translate(-24 0)">
                  <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                </g>
              </svg>
            </button>
            <button type="button" class="icon-tool" title="Próximo trailer" @click="goToNextTrailer">
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
              </svg>
            </button>
            <button
              type="button"
              class="icon-tool"
              :class="{
                'icon-tool--on': pinnedTrailers.length > 0,
                'icon-tool--at-cap': pinnedTrailers.length >= MAX_PINNED_TRAILERS,
              }"
              :disabled="!previewUrl"
              :title="pinSplitToolbarTitle"
              :aria-label="pinSplitToolbarAria"
              @click="onPinSplitToolbarClick"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2.5" y="5" width="8.5" height="14" rx="1.5" />
                <rect x="13" y="5" width="8.5" height="14" rx="1.5" />
              </svg>
            </button>
            <button
              v-if="pinnedTrailers.length > 0"
              type="button"
              class="icon-tool"
              title="Remover trailers fixos (por baixo)"
              aria-label="Remover trailers fixos"
              @click="clearPinnedTrailers"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <button
              type="button"
              class="icon-tool"
              :class="{ 'icon-tool--on': shuffleForwardEnabled }"
              title="Aleatório ao avançar (próximo trailer, fim do preview ou FF). Voltar é sempre pela ordem; depois de voltar, um único avanço segue na fila antes do aleatório voltar."
              :disabled="entries.length < 2"
              :aria-pressed="shuffleForwardEnabled"
              aria-label="Alternar aleatório ao avançar"
              @click="toggleShuffleForward"
            >
              <IconTrailerRandom />
            </button>
            <button
              type="button"
              class="icon-tool icon-tool--primary"
              :disabled="selectedEntry ? !selectedEntry.hasMain : true"
              :title="selectedEntry && !selectedEntry.hasMain ? 'Completo em falta' : 'Vídeo completo'"
              @click="openFullFromPreview"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="14" rx="2" />
                <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <button
              v-if="focusedIndex !== null && selectedEntry"
              type="button"
              class="icon-tool icon-tool--danger"
              title="Mover para a Lixeira (completo, trailer, preview)"
              @click="deleteTitleAtIndex(focusedIndex)"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M8 6V4h8v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12M10 11v6M14 11v6" stroke-linecap="round" />
              </svg>
            </button>
            <button
              v-if="focusedIndex !== null && selectedEntry && !isSilkTvLike"
              type="button"
              class="icon-tool"
              :class="{ 'icon-tool--on': trailerTagPanelOpen }"
              :aria-expanded="trailerTagPanelOpen"
              title="Adicionar tag"
              aria-label="Adicionar tag"
              @click="trailerTagPanelOpen = !trailerTagPanelOpen"
            >
              <svg
                class="icon-svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83Z" />
                <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <div class="rate-block rate-block--inline">
              <label for="rate-select-trailer" class="rate-label rate-label--compact">Velocidade</label>
              <select
                id="rate-select-trailer"
                class="rate-select rate-select--compact"
                :value="playbackRate"
                @change="setPlaybackRate(Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="r in PLAYBACK_RATES" :key="r" :value="r">
                  {{ r === 1 ? '1×' : `${r}×` }}
                </option>
              </select>
            </div>
          </div>
          <div
            v-if="!playerUrl && previewUrl && selectedEntry"
            class="media-card-playback-name-row"
          >
            <button
              v-if="revealExplorerEligible"
              type="button"
              class="icon-tool icon-tool--reveal-explorer"
              :title="revealInFolderButtonTitle"
              :aria-label="revealInFolderAriaLabel"
              @click="revealPlayingFileInExplorer"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
              </svg>
            </button>
            <p
              class="media-card-playback-video-name"
              :title="selectedEntry.mainFilename"
            >
              <span
                v-if="selectedEntry.mainSizeBytes > 0"
                class="media-card-playback-video-size"
              >{{ formatGB(selectedEntry.mainSizeBytes) }}</span>
              {{ selectedEntry.mainFilename }}
            </p>
          </div>
          <div
            v-if="focusedIndex !== null && selectedEntry && !isSilkTvLike"
            class="toolbar-tags-panel"
            :class="{ 'toolbar-tags-panel--input-open': trailerTagPanelOpen }"
          >
            <div v-show="trailerTagPanelOpen" class="tag-input-row">
              <input
                id="tag-input-main"
                v-model="newTagInput"
                type="text"
                class="tag-input"
                maxlength="80"
                placeholder="Uma ou várias tags (separar com , ou ;)"
                list="catalog-tag-suggestions"
                autocomplete="off"
                @keydown.enter.prevent="addTagFromInput"
              />
              <button type="button" class="tag-add-btn" @click="addTagFromInput">Adicionar</button>
            </div>
            <datalist id="catalog-tag-suggestions">
              <option v-for="s in tagSuggestions" :key="s" :value="s" />
            </datalist>
            <div
              v-if="(selectedEntry?.tags?.length ?? 0) > 0"
              class="tag-chip-list"
              aria-label="Tags deste título"
            >
              <button
                v-for="t in selectedEntry?.tags ?? []"
                :key="t"
                type="button"
                class="tag-chip"
                :class="{ 'tag-chip--active': catalogTagFilter === t }"
                :title="`Toque para filtrar o catálogo por «${t}». Manter ~2s premido e soltar para remover (com confirmação).`"
                @pointerdown="selectedEntry && onTagChipPointerDown(libSession(selectedEntry), selectedEntry.trailerRel, t, $event)"
                @pointerup="selectedEntry && onTagChipPointerUp(libSession(selectedEntry), selectedEntry.trailerRel, t, $event)"
                @pointercancel="onTagChipPointerCancel($event)"
              >
                <span class="tag-chip-text">{{ t }}</span>
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="playerUrl" class="toolbar toolbar--full toolbar--full-main">
          <div class="toolbar-full-main-row">
            <button type="button" class="icon-tool" title="Voltar ao trailer" @click="closeFullVideo">
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <button
              v-if="activeIndex !== null && mainVideoEntry"
              type="button"
              class="icon-tool icon-tool--fav"
              :class="{ 'icon-tool--fav-on': mainVideoEntry.isFavorite }"
              :aria-pressed="!!mainVideoEntry.isFavorite"
              :title="mainVideoEntry.isFavorite ? 'Retirar dos favoritos' : 'Favorito'"
              @click="toggleFavoriteAtIndex(activeIndex)"
            >
              {{ mainVideoEntry.isFavorite ? '★' : '☆' }}
            </button>
            <button
              v-if="activeIndex !== null && mainVideoEntry"
              type="button"
              class="icon-tool icon-tool--memorable"
              :class="{ 'icon-tool--memorable-on': isEntryMemorable(mainVideoEntry) }"
              :aria-pressed="isEntryMemorable(mainVideoEntry)"
              :title="isEntryMemorable(mainVideoEntry)
                ? 'Retirar marca de memorável'
                : 'Memorável (marca como visto e empurra para o fim)'"
              @click="toggleMemorableAtIndex(activeIndex)"
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
              v-if="activeIndex !== null && mainVideoEntry"
              type="button"
              class="icon-tool icon-tool--recents"
              :class="{ 'icon-tool--recents-on': isPlaybackTitleInRecentList(mainVideoEntry) }"
              :disabled="recentsMutationBusy"
              :title="
                isPlaybackTitleInRecentList(mainVideoEntry)
                  ? 'Remover da lista «Destaques»'
                  : 'Adicionar a «Destaques» (lista no topo do menu)'
              "
              :aria-label="
                isPlaybackTitleInRecentList(mainVideoEntry)
                  ? 'Remover de Destaques'
                  : 'Adicionar a Destaques'
              "
              :aria-pressed="isPlaybackTitleInRecentList(mainVideoEntry)"
              @click="toggleCurrentTitleRecents"
            >
              <svg
                v-if="!isPlaybackTitleInRecentList(mainVideoEntry)"
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
              v-if="moveTitleDesktopEligible && activeIndex !== null && mainVideoEntry"
              type="button"
              class="icon-tool icon-tool--move-library"
              title="Mover vídeo completo, trailer, preview e miniaturas para outra biblioteca de pastas"
              aria-label="Mover para outra pasta"
              @click="openMoveTitleDialog()"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <path d="M12 11v6M9 14h6" />
              </svg>
            </button>
            <button
              v-if="activeIndex !== null && mainVideoEntry"
              type="button"
              class="icon-tool icon-tool--danger"
              title="Mover para a Lixeira (completo, trailer, preview)"
              @click="deleteTitleAtIndex(activeIndex)"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M8 6V4h8v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12M10 11v6M14 11v6" stroke-linecap="round" />
              </svg>
            </button>
            <button
              v-if="activeIndex !== null && mainVideoEntry"
              type="button"
              class="icon-tool icon-tool--fast-play"
              :class="{ 'icon-tool--on': fastPlayEnabled }"
              :title="
                fastPlayEnabled
                  ? 'Fast Play: ecrã inteiro; saltos automáticos; último trecho normal. No telemóvel a barra fica oculta — toque no vídeo para pausar. Desligue o FAST para sair do ecrã inteiro e voltar à barra.'
                  : 'Fast Play: entra em ecrã inteiro, saltos automáticos no vídeo completo (parâmetros no Admin). No telemóvel, sem barra nativa durante o FAST.'
              "
              :aria-pressed="fastPlayEnabled"
              @click="toggleFastPlay"
            >
              FAST
            </button>
            <div class="rate-block rate-block--inline">
              <label for="rate-select-main" class="rate-label rate-label--compact">Velocidade</label>
              <select
                id="rate-select-main"
                class="rate-select rate-select--compact"
                :value="playbackRate"
                @change="setPlaybackRate(Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="r in PLAYBACK_RATES" :key="r" :value="r">
                  {{ r === 1 ? '1×' : `${r}×` }}
                </option>
              </select>
            </div>
          </div>
          <div v-if="playerUrl && mainVideoEntry" class="media-card-playback-name-row">
            <button
              v-if="revealExplorerEligible"
              type="button"
              class="icon-tool icon-tool--reveal-explorer"
              :title="revealInFolderButtonTitle"
              :aria-label="revealInFolderAriaLabel"
              @click="revealPlayingFileInExplorer"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
              </svg>
            </button>
            <p
              class="media-card-playback-video-name"
              :title="mainVideoEntry.mainFilename"
            >
              {{ mainVideoEntry.mainFilename }}
            </p>
          </div>
          <div v-if="mainVideoEntry" class="toolbar-full-tags">
            <div class="tag-input-row">
              <input
                id="tag-input-full"
                v-model="newTagInput"
                type="text"
                class="tag-input"
                maxlength="80"
                placeholder="Uma ou várias tags (separar com , ou ;)"
                list="catalog-tag-suggestions"
                autocomplete="off"
                @keydown.enter.prevent="addTagFromInput"
              />
              <button type="button" class="tag-add-btn" @click="addTagFromInput">Adicionar</button>
            </div>
            <div
              v-if="(mainVideoEntry.tags?.length ?? 0) > 0"
              class="tag-chip-list"
              aria-label="Tags deste título"
            >
              <button
                v-for="t in mainVideoEntry.tags ?? []"
                :key="t"
                type="button"
                class="tag-chip"
                :class="{ 'tag-chip--active': catalogTagFilter === t }"
                :title="`Toque para filtrar o catálogo por «${t}». Manter ~2s premido e soltar para remover (com confirmação).`"
                @pointerdown="onTagChipPointerDown(libSession(mainVideoEntry), mainVideoEntry.trailerRel, t, $event)"
                @pointerup="onTagChipPointerUp(libSession(mainVideoEntry), mainVideoEntry.trailerRel, t, $event)"
                @pointercancel="onTagChipPointerCancel($event)"
              >
                <span class="tag-chip-text">{{ t }}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div
        v-if="catalogSplitterInLayout"
        class="catalog-pane-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Arrastar para mudar a largura do vídeo e do catálogo. Duplo clique repõe o tamanho por defeito."
        tabindex="0"
        @keydown="onCatalogSplitterKeydown"
        @pointerdown="onCatalogSplitterPointerDown"
        @pointermove="onCatalogSplitterPointerMove"
        @pointerup="onCatalogSplitterPointerUp"
        @pointercancel="onCatalogSplitterPointerCancel"
        @dblclick.prevent="resetCatalogPaneWidth"
      />

      <aside class="sidebar" :class="{ 'sidebar--catalog-collapsed': catalogGridCollapsed }">
        <div class="catalog-head">
          <h2 class="panel-title list-heading">Catálogo</h2>
          <div v-if="searchSessionActive && !catalogGridCollapsed" class="catalog-search-row">
            <select
              v-model="searchSessionMode"
              class="catalog-search-mode"
              aria-label="Modo da busca global"
            >
              <option value="files">Arquivos</option>
              <option value="tags">Tags</option>
            </select>
            <input
              v-model="searchSessionInput"
              class="catalog-search-input"
              type="search"
              placeholder="Buscar em tags e nomes de arquivos (todas as pastas)"
              aria-label="Buscar global em todas as pastas"
              @keydown.enter.prevent="runSearchSession"
            />
            <button type="button" class="catalog-search-btn" @click="runSearchSession">Buscar</button>
          </div>
          <div v-if="searchSessionActive && searchSessionError" class="catalog-search-error">
            {{ searchSessionError }}
          </div>
          <div class="catalog-head-tools">
            <button
              type="button"
              class="catalog-grid-toggle"
              :class="{ 'catalog-grid-toggle--collapsed': catalogGridCollapsed }"
              :aria-expanded="!catalogGridCollapsed"
              aria-controls="catalog-grid-panel"
              :aria-label="catalogGridCollapsed ? 'Mostrar catálogo e grelha' : 'Recolher catálogo (mais espaço para o vídeo)'"
              :title="
                catalogGridCollapsed
                  ? 'Mostrar catálogo e grelha'
                  : 'Recolher catálogo — esconde a grelha e liberta largura para o player'
              "
              @click="catalogGridCollapsed = !catalogGridCollapsed"
            >
              <svg
                v-if="catalogGridCollapsed"
                class="catalog-grid-toggle-svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" rx="1.2" />
                <rect x="14" y="3" width="7" height="7" rx="1.2" />
                <rect x="3" y="14" width="7" height="7" rx="1.2" />
                <rect x="14" y="14" width="7" height="7" rx="1.2" />
              </svg>
              <svg
                v-else
                class="catalog-grid-toggle-svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
                <path d="M14 9l3 3-3 3" />
              </svg>
            </button>
            <button
              v-if="showTvCatalogScrollAssist && entries.length"
              type="button"
              class="catalog-top-btn"
              title="Primeiro título da lista e rolagem ao topo da grelha"
              aria-label="Ir ao topo da lista do catálogo"
              @click="scrollCatalogGridToTopAndFocusFirst"
            >
              Topo da lista
            </button>
            <div class="catalog-sort" role="toolbar" aria-label="Ordenação do catálogo">
              <button
                type="button"
                class="catalog-sort-btn"
                :class="{ 'catalog-sort-btn--active': catalogSortKey === 'name' }"
                title="Ordenar por nome do título. Voltar a clicar inverte a ordem."
                @click="cycleCatalogSort('name')"
              >
                Nome<span v-if="catalogSortKey === 'name'" class="catalog-sort-dir" aria-hidden="true">{{
                  catalogSortDir === 'asc' ? ' ↑' : ' ↓'
                }}</span>
              </button>
              <button
                type="button"
                class="catalog-sort-btn"
                :class="{ 'catalog-sort-btn--active': catalogSortKey === 'date' }"
                title="Ordenar por data do ficheiro completo (criação quando disponível). Voltar a clicar inverte."
                @click="cycleCatalogSort('date')"
              >
                Data<span v-if="catalogSortKey === 'date'" class="catalog-sort-dir" aria-hidden="true">{{
                  catalogSortDir === 'asc' ? ' ↑' : ' ↓'
                }}</span>
              </button>
              <button
                type="button"
                class="catalog-sort-btn"
                :class="{ 'catalog-sort-btn--active': catalogSortKey === 'size' }"
                title="Ordenar por tamanho do ficheiro completo na raiz. Voltar a clicar inverte."
                @click="cycleCatalogSort('size')"
              >
                Tamanho<span v-if="catalogSortKey === 'size'" class="catalog-sort-dir" aria-hidden="true">{{
                  catalogSortDir === 'asc' ? ' ↑' : ' ↓'
                }}</span>
              </button>
            </div>
            <button
              type="button"
              class="watched-filter-toggle"
              :class="{ 'watched-filter-toggle--on': showOnlyWatched }"
              :aria-pressed="showOnlyWatched"
              :disabled="!showOnlyWatched && watchedCount === 0"
              :title="showOnlyWatched
                ? 'Mostrar todos novamente'
                : watchedCount === 0
                  ? 'Ainda não há vídeos marcados como concluídos ou memoráveis'
                  : `Mostrar apenas vídeos já vistos ou memoráveis (${watchedCount})`"
              @click="toggleShowOnlyWatched"
            >
              <svg class="watched-filter-toggle-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 4h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4z" />
                <path d="M17 5h3a2 2 0 0 1-3 4" />
                <path d="M7 5H4a2 2 0 0 0 3 4" />
                <path d="M9 21h6" />
                <path d="M12 12v6" />
                <path d="M9.5 18h5l-.5 3h-4z" fill="currentColor" stroke="none" />
              </svg>
              <span>Só vistos</span>
              <span v-if="watchedCount > 0" class="watched-filter-count">{{ watchedCount }}</span>
            </button>
            <button
              type="button"
              class="watched-filter-toggle watched-filter-toggle--fav"
              :class="{ 'watched-filter-toggle--on': showOnlyFavorites }"
              :aria-pressed="showOnlyFavorites"
              :disabled="!showOnlyFavorites && favoriteCount === 0"
              :title="showOnlyFavorites
                ? 'Mostrar todos novamente'
                : favoriteCount === 0
                  ? 'Ainda não há vídeos marcados como favoritos'
                  : `Mostrar apenas vídeos favoritos (${favoriteCount})`"
              @click="toggleShowOnlyFavorites"
            >
              <span aria-hidden="true">{{ showOnlyFavorites ? '★' : '☆' }}</span>
              <span>Só favoritos</span>
              <span v-if="favoriteCount > 0" class="watched-filter-count">{{ favoriteCount }}</span>
            </button>
            <button
              v-if="catalogTagFilter"
              type="button"
              class="tag-filter-clear"
              :title="`Remover filtro «${catalogTagFilter}»`"
              @click="clearCatalogTagFilter"
            >
              Filtro: {{ catalogTagFilter }}
              <span class="tag-filter-clear-x" aria-hidden="true">×</span>
            </button>
          </div>
          <div v-if="sessionMenuTopTags.length && !catalogGridCollapsed" class="catalog-top-tags">
            <span class="catalog-top-tags-title">Top tags</span>
            <div class="catalog-top-tags-row">
              <button
                v-for="tag in sessionMenuTopTags"
                :key="tag"
                type="button"
                class="catalog-top-tag"
                :class="{ 'catalog-top-tag--active': catalogTagFilter === tag }"
                @click="onTopTagPick(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </div>
        <div v-if="catalogMode === 'main-only'" class="empty-hint">
          Esta sessão está sem catálogo em <code class="code">trailers/</code> / <code class="code">preview/</code>.
          Ao clicar no grid, o vídeo completo abre diretamente.
          <NuxtLink to="/admin" class="empty-hint-link">Processar trailers/previews no Admin</NuxtLink>
        </div>
        <div
          v-else-if="searchSessionActive && searchSessionQuery.trim().length < 2 && !loading"
          class="empty-hint"
        >
          Digite pelo menos 2 caracteres e clique em <strong>Buscar</strong> para pesquisar em todas as pastas.
        </div>
        <div
          v-else-if="searchSessionActive && searchSessionQuery.trim().length >= 2 && !entries.length && !loading"
          class="empty-hint"
        >
          Nenhum resultado para <code class="code">{{ searchSessionQuery }}</code> na sessão Busca.
        </div>
        <div v-if="catalogTagFilter && !entries.length && !loading && fullEntries.length" class="empty-hint">
          Nenhum título com a tag <code class="code">{{ catalogTagFilter }}</code>.
          <button type="button" class="empty-hint-link" @click="clearCatalogTagFilter">Mostrar todos</button>
        </div>
        <div v-else-if="showOnlyWatched && !entries.length && !loading && fullEntries.length" class="empty-hint">
          Nenhum vídeo marcado como concluído ou memorável aqui.
          <button type="button" class="empty-hint-link" @click="toggleShowOnlyWatched">Mostrar todos</button>
        </div>
        <div v-else-if="showOnlyFavorites && !entries.length && !loading && fullEntries.length" class="empty-hint">
          Nenhum vídeo marcado como favorito aqui.
          <button type="button" class="empty-hint-link" @click="toggleShowOnlyFavorites">Mostrar todos</button>
        </div>
        <div v-else-if="sessionIndex === RECENTS_SESSION_ID && !entries.length && !loading" class="empty-hint">
          Ainda não há títulos em Destaques. No trailer ou no vídeo completo, usa o botão do <strong>olho</strong>
          na barra para adicionar aqui.
        </div>
        <div v-else-if="!entries.length && !loading" class="empty-hint">
          Nenhum trailer em <code class="code">trailers/</code> desta sessão (previews opcionais em <code class="code">preview/</code>) ou VIDEO_ROOT mal configurado
          (uma pasta, várias com <code class="code">|</code>, ou JSON array).
        </div>
        <div v-else-if="loading" class="loading">A carregar lista…</div>
        <div class="catalog-grid-scroll-wrap">
          <div
            id="catalog-grid-panel"
            v-show="!catalogGridCollapsed"
            class="trailer-grid-scroll"
          >
            <div class="trailer-grid" role="list" aria-label="Catálogo de trailers">
            <div
              v-for="(entry, i) in entries"
              :key="`${libSession(entry)}:${entry.trailerRel}`"
              class="grid-tile"
              role="group"
              :data-trailer-rel="entry.trailerRel"
              :class="{
                'grid-tile--selected': focusedIndex === i,
                'grid-tile--full': activeIndex === i,
                'grid-tile--no-main': !entry.hasMain,
                'grid-tile--fav': entry.isFavorite,
              }"
              :title="
                sessionIndex === RECENTS_SESSION_ID
                  ? `Destaques · ${libraryFolderLabel(libSession(entry))} · ${entry.mainFilename} · ${formatSize(entry.trailerSizeBytes)}`
                  : `${entry.mainFilename} · ${formatSize(entry.trailerSizeBytes)}`
              "
              @pointerdown="onGridTileChromePointerDown(i, $event)"
              @pointerup="onGridTileChromePointerUp"
              @pointerleave="onGridTileChromePointerUp"
              @pointercancel="onGridTileChromePointerUp"
            >
              <button
                type="button"
                class="fav-btn fav-btn--tile"
                :class="{ 'fav-btn--on': entry.isFavorite }"
                :aria-pressed="!!entry.isFavorite"
                :title="entry.isFavorite ? 'Retirar dos favoritos' : 'Favorito (sobe na lista)'"
                @click.stop="toggleFavoriteAtIndex(i)"
              >
                {{ entry.isFavorite ? '★' : '☆' }}
              </button>
              <button
                v-if="sessionIndex === RECENTS_SESSION_ID"
                type="button"
                class="grid-tile-remove-recents"
                :disabled="recentsMutationBusy"
                title="Remover só desta lista Destaques (não apaga ficheiros)"
                aria-label="Remover de Destaques"
                @click.stop="removeFromRecentsAtIndex(i)"
              >
                <svg class="grid-tile-remove-recents-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round">
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                  />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
              <span
                v-if="isEntryMemorable(entry)"
                class="watch-badge watch-badge--memorable"
                title="Memorável"
                aria-label="Memorável"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M7 4h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4z" />
                  <path d="M17 5h3a2 2 0 0 1-3 4" />
                  <path d="M7 5H4a2 2 0 0 0 3 4" />
                  <path d="M9 21h6" />
                  <path d="M12 12v6" />
                  <path d="M9.5 18h5l-.5 3h-4z" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span
                v-else-if="isEntryCompleted(entry)"
                class="watch-badge watch-badge--done"
                title="Já visto até ao fim"
                aria-label="Já visto até ao fim"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
              </span>
              <span
                v-else-if="isEntryPartiallyWatched(entry)"
                class="watch-badge watch-badge--partial"
                :title="`Visto parcialmente (${formatWatchedSeconds(entry.watchedSeconds)})`"
                aria-label="Visto parcialmente"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
                  <path d="M12 3 a9 9 0 0 1 0 18 z" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span
                v-else-if="isEntryTrailerWatched(entry)"
                class="watch-badge watch-badge--trailer"
                title="Trailer já visto até ao fim"
                aria-label="Trailer já visto"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M10 8.5l6 3.5-6 3.5v-7z" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <div
                v-if="entry.previewRel"
                class="grid-tile-thumb"
                role="button"
                tabindex="0"
                :aria-label="
                  gridInlinePreviewIndex === i
                    ? `Pré-visualização de ${entry.label}. Toque outra vez para o trailer no palco.`
                    : `Miniatura de ${entry.label}. Toque para substituir pelo preview em vídeo.`
                "
                @click.stop="onCatalogThumbClick(i)"
                @keydown.enter.prevent.stop="onCatalogThumbClick(i)"
                @keydown.space.prevent.stop="onCatalogThumbClick(i)"
              >
                <video
                  v-if="gridInlinePreviewIndex === i"
                  class="grid-inline-preview-video"
                  :src="apiVideoUrl(entry.previewRel, libSession(entry))"
                  :muted="previewTrailerMuted"
                  playsinline
                  :preload="videoPreloadAttr"
                  tabindex="-1"
                  @loadeddata="onGridInlinePreviewLoaded"
                />
                <CatalogFrameStrip
                  v-else
                  :preview-rel="entry.previewRel"
                  :session-index="libSession(entry)"
                />
                <button
                  v-if="entry.previewRel && gridInlinePreviewIndex === i"
                  type="button"
                  class="grid-tile-maxi"
                  title="Miniaturas em ecrã inteiro"
                  aria-label="Miniaturas em ecrã inteiro"
                  @click.stop="openCatalogGalleryDialog(i)"
                >
                  <svg class="grid-tile-maxi-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 3H5a2 2 0 00-2 2v4M21 9V5a2 2 0 00-2-2h-4M15 21h4a2 2 0 002-2v-4M3 15v4a2 2 0 002 2h4" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
              <div v-else class="grid-tile-thumb grid-tile-thumb--empty" aria-hidden="true">
                <div class="catalog-thumb-placeholder" />
              </div>
              <button
                type="button"
                class="grid-tile-select"
                :aria-label="
                  sessionIndex === RECENTS_SESSION_ID
                    ? `Escolher trailer ${entry.label} em Destaques, origem ${libraryFolderLabel(libSession(entry))}`
                    : `Escolher trailer ${entry.label}`
                "
                @click="onListItemClick(i)"
              >
                <span
                  v-if="sessionIndex === RECENTS_SESSION_ID"
                  class="grid-tile-recents-meta"
                  :title="`Lista Destaques · vídeo da biblioteca «${libraryFolderLabel(libSession(entry))}»`"
                >
                  <span class="grid-tile-recents-tag">Destaques</span>
                  <span class="grid-tile-recents-lib">{{ libraryFolderLabel(libSession(entry)) }}</span>
                </span>
                <span class="grid-tile-label">{{ entry.label }}</span>
                <span v-if="!entry.hasMain" class="badge badge--tile">sem completo</span>
                <span
                  v-if="(entry.tags?.length ?? 0) > 0"
                  class="grid-tile-tags"
                  :title="(entry.tags ?? []).join(', ')"
                >
                  <span
                    v-for="t in (entry.tags ?? []).slice(0, 2)"
                    :key="t"
                    class="grid-tile-tag"
                    :class="{ 'grid-tile-tag--active': catalogTagFilter === t }"
                    >{{ t }}</span
                  >
                  <span
                    v-if="(entry.tags ?? []).length > 2"
                    class="grid-tile-tag grid-tile-tag--more"
                    >+{{ (entry.tags ?? []).length - 2 }}</span
                  >
                </span>
              </button>
            </div>
          </div>
          </div>
          <div
            v-if="showTvCatalogScrollAssist && entries.length && !catalogGridCollapsed"
            class="catalog-scroll-assist"
            role="toolbar"
            aria-label="Rolar lista do catálogo"
          >
            <button
              type="button"
              class="catalog-scroll-assist-btn"
              aria-label="Lista para cima"
              @click="scrollCatalogByDirection(-1)"
            >
              ▲
            </button>
            <button
              type="button"
              class="catalog-scroll-assist-btn"
              aria-label="Lista para baixo"
              @click="scrollCatalogByDirection(1)"
            >
              ▼
            </button>
          </div>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <div
        v-show="sessionMenuOpen"
        id="session-menu-backdrop"
        class="session-menu-backdrop"
        @click="sessionMenuOpen = false"
      />
      <aside
        v-show="sessionMenuOpen"
        id="session-menu-panel"
        class="session-menu-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-menu-title"
      >
        <div class="session-menu-head">
          <span id="session-menu-title" class="session-menu-title">Bibliotecas</span>
          <button type="button" class="session-menu-close" aria-label="Fechar" @click="sessionMenuOpen = false">
            ×
          </button>
        </div>
        <nav class="session-menu-list" aria-label="Pastas">
          <button
            v-for="s in sessions"
            :key="s.id"
            type="button"
            class="session-menu-item"
            :class="{ 'session-menu-item--active': sessionIndex === s.id }"
            @click="onSessionMenuPick(s.id)"
          >
            <span class="session-menu-item-label">
              <svg
                v-if="s.id === SEARCH_SESSION_ID"
                class="session-menu-item-eye"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <svg
                v-if="s.id === RECENTS_SESSION_ID"
                class="session-menu-item-eye"
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
              {{ s.label }}
            </span>
          </button>
        </nav>
      </aside>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="catalogGalleryIndex !== null && galleryDialogEntry?.previewRel"
        class="catalog-gallery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Miniaturas"
        @click.self="closeCatalogGalleryDialog"
      >
        <button type="button" class="catalog-gallery-close" aria-label="Fechar" @click="closeCatalogGalleryDialog">
          ×
        </button>
        <div class="catalog-gallery-body">
          <p class="catalog-gallery-caption">{{ galleryDialogEntry.label }}</p>
          <div class="catalog-gallery-stack">
            <img
              v-for="slot in catalogFrameSlots"
              :key="slot"
              class="catalog-gallery-img"
              loading="eager"
              decoding="async"
              alt=""
              :src="catalogPreviewFrameUrl(galleryDialogEntry.previewRel, libSession(galleryDialogEntry), slot)"
            />
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-show="moveTitleDialogOpen"
        class="move-title-backdrop"
        @click="moveTitleDialogOpen = false"
      />
      <div
        v-show="moveTitleDialogOpen"
        class="move-title-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-title-dialog-title"
      >
        <div class="move-title-dialog-card">
          <div class="session-menu-head">
            <span id="move-title-dialog-title" class="session-menu-title">Mover para outra pasta</span>
            <button
              type="button"
              class="session-menu-close"
              aria-label="Fechar"
              :disabled="moveTitleBusy"
              @click="moveTitleDialogOpen = false"
            >
              ×
            </button>
          </div>
          <p class="move-title-dialog-hint">
            Move o vídeo completo (raiz da biblioteca), ficheiro em trailers, preview e miniaturas JPEG em .thumb_cache para a pasta seleccionada.
          </p>
          <p v-if="moveTitleError" class="move-title-dialog-err">{{ moveTitleError }}</p>
          <nav class="move-title-dialog-list" aria-label="Destino">
            <button
              v-for="s in moveTitleTargetSessions"
              :key="s.id"
              type="button"
              class="session-menu-item"
              :disabled="moveTitleBusy"
              @click="confirmMoveTitleToSession(s.id)"
            >
              {{ s.label }}
            </button>
          </nav>
          <p v-if="moveTitleBusy" class="move-title-dialog-busy" aria-live="polite">A mover ficheiros…</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import {
  MEMORABLE_TAG_NAME,
  PLAYBACK_RATES,
  RECENTS_SESSION_ID,
  SEARCH_SESSION_ID,
  TRAILER_WATCHED_TAG_NAME,
  apiVideoUrl,
  parseApiVideoUrl,
  catalogPreviewFrameUrl,
  isEntryCompleted,
  isEntryMemorable,
  isEntryPartiallyWatched,
  isEntryTrailerWatched,
  isEntryWatchedClass,
} from '~/composables/useVideoFolder'
import IconTrailerRandom from '~/components/IconTrailerRandom.vue'
import { useSilkTvLayout } from '~/composables/useSilkTvLayout'

const { isSilkTvLike } = useSilkTvLayout()

const videoPreloadAttr = computed<'auto' | 'metadata'>(() => {
  if (!import.meta.client) return 'metadata'
  if (isSilkTvLike.value) return 'auto'
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return 'auto'
  } catch {
    /* */
  }
  return 'metadata'
})

/** Plataforma do servidor Node (`process.platform` do host onde corre o Nuxt/Nitro). */
const serverPlatform = ref('')
/** Servidor tem VIDEO_ADMIN_TOKEN (útil para mensagens / futuro estado “desactivado”). */
const adminRevealExplorer = ref(false)
const catalogMode = ref<'trailers' | 'main-only'>('trailers')

/** Onde o servidor abre a pasta (Finder / Explorador / Linux); o browser pode ser outro OS. */
const revealInFolderButtonTitle = computed(() => {
  const p = serverPlatform.value.toLowerCase()
  const place =
    p === 'darwin'
      ? 'no Finder deste Mac (máquina do servidor Node)'
      : p === 'win32'
        ? 'no Explorador desse Windows (máquina do servidor)'
        : p === 'linux'
          ? 'no gestor de ficheiros desse Linux (servidor)'
          : 'na pasta na máquina do servidor'
  return `Abrir o ficheiro na pasta — ${place}. Requer VIDEO_ADMIN_TOKEN (ou NUXT_ADMIN_TOKEN) no servidor e «Guardar no browser» na página Admin.`
})

const revealInFolderAriaLabel = computed(() => {
  const p = serverPlatform.value.toLowerCase()
  if (p === 'darwin') return 'Abrir no Finder na máquina do servidor'
  if (p === 'win32') return 'Abrir no Explorador na máquina do servidor'
  if (p === 'linux') return 'Abrir pasta no gestor de ficheiros do servidor'
  return 'Abrir pasta do ficheiro no servidor'
})

/**
 * Botão «revelar pasta»: servidor Windows, macOS ou Linux; não mostrar em Silk/Fire TV.
 * O ficheiro abre-se sempre na **máquina onde corre o Node**, não no teu browser remoto.
 */
const revealExplorerEligible = computed(() => {
  if (isSilkTvLike.value) return false
  const p = serverPlatform.value.toLowerCase()
  return p === 'win32' || p === 'darwin' || p === 'linux'
})

/** Largura mínima para mostrar o botão «Mover de pasta» (evita em telemóvel / ecrã estreito). */
const isWideDesktopUi = ref(false)
const realLibrarySessionCount = computed(() => sessions.value.filter((s) => s.id >= 0).length)
/** Sessões (além da actual). */
const moveTitleDesktopEligible = computed(
  () => !isSilkTvLike.value && realLibrarySessionCount.value > 1 && isWideDesktopUi.value,
)
const moveTitleDialogOpen = ref(false)
const moveTitleBusy = ref(false)
const moveTitleError = ref('')

interface VideoSessionTab {
  id: number
  label: string
  topTags?: string[]
}

const route = useRoute()
const router = useRouter()

/** Botões ▲▼ e classe em document.documentElement — mesmo critério que layout--tv-silk (UA ou ?tv=1). */
const showTvCatalogScrollAssist = computed(() => isSilkTvLike.value)

const sessions = ref<VideoSessionTab[]>([])
const sessionIndex = ref(0)

function libSession(entry: TrailerListEntry | null | undefined): number {
  const n = entry?.librarySession
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return Math.floor(n)
  return sessionIndex.value >= 0 ? sessionIndex.value : 0
}

/** Rótulo da pasta/biblioteca no menu (`sessions`), por índice real da sessão (≥0). */
function libraryFolderLabel(sessionId: number): string {
  const row = sessions.value.find((s) => s.id === sessionId)
  const label = row?.label?.trim()
  if (label) return label
  if (sessionId >= 0) return `Biblioteca ${sessionId}`
  return ''
}

const recentsMutationBusy = ref(false)

/** Chaves `session:trailerRel` (= estado em SQLite) para ícone olho aberto/fechado. */
const recentPlaybackKeys = ref<Set<string>>(new Set())

function playbackRecentKey(session: number, trailerRel: string): string {
  return `${Math.max(0, Math.floor(session))}:${String(trailerRel).trim().replace(/\\/g, '/')}`
}

function isPlaybackTitleInRecentList(entry: TrailerListEntry | null | undefined): boolean {
  if (!entry) return false
  return recentPlaybackKeys.value.has(playbackRecentKey(libSession(entry), entry.trailerRel))
}

async function refreshRecentPlaybackKeys() {
  try {
    const data = await $fetch<{ items: { session: number; trailerRel: string }[] }>('/api/library/recent-list')
    const next = new Set<string>()
    for (const r of data.items ?? []) next.add(playbackRecentKey(r.session, r.trailerRel))
    recentPlaybackKeys.value = next
  } catch {
    /* manter último estado */
  }
}

/** Avisos breves para acções Recentes (olho / remover da grelha). */
const toastVisible = ref(false)
const toastMessage = ref('')
const toastVariant = ref<'success' | 'error'>('success')
let toastHideTimer: ReturnType<typeof setTimeout> | null = null

function showToast(message: string, variant: 'success' | 'error' = 'success') {
  if (toastHideTimer !== null) {
    clearTimeout(toastHideTimer)
    toastHideTimer = null
  }
  toastMessage.value = message
  toastVariant.value = variant
  toastVisible.value = true
  toastHideTimer = setTimeout(() => {
    toastVisible.value = false
    toastHideTimer = null
  }, 3400)
}

/** Olho na barra: alterna entrada em «Recentes» (SQLite). */
async function toggleCurrentTitleRecents() {
  const e =
    playerUrl.value && mainVideoEntry.value ? mainVideoEntry.value : selectedEntry.value
  if (!e || recentsMutationBusy.value) return
  const inList = isPlaybackTitleInRecentList(e)
  recentsMutationBusy.value = true
  try {
    if (inList) {
      await $fetch('/api/library/recent-remove', {
        method: 'POST',
        body: { session: libSession(e), trailerRel: e.trailerRel },
      })
      showToast('Removido de Destaques.', 'success')
      const removeIdx = entries.value.findIndex(
        (x) => libSession(x) === libSession(e) && x.trailerRel === e.trailerRel,
      )
      await refreshRecentPlaybackKeys()
      if (sessionIndex.value === RECENTS_SESSION_ID) {
        const neighborRel =
          removeIdx >= 0 && entries.value.length > 1
            ? (entries.value[removeIdx + 1] ?? entries.value[removeIdx - 1])?.trailerRel
            : undefined
        await loadTrailers(
          typeof neighborRel === 'string' ? { preserveFocusTrailerRel: neighborRel } : {},
        )
      }
    } else {
      await $fetch('/api/library/recent-play', {
        method: 'POST',
        body: { session: libSession(e), trailerRel: e.trailerRel },
      })
      showToast('Adicionado a Destaques.', 'success')
      await refreshRecentPlaybackKeys()
      if (sessionIndex.value === RECENTS_SESSION_ID) {
        await loadTrailers({ preserveFocusTrailerRel: e.trailerRel })
      }
    }
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    showToast(
      ex?.data?.statusMessage || ex?.message || 'Não foi possível atualizar Destaques.',
      'error',
    )
  } finally {
    recentsMutationBusy.value = false
  }
}

async function removeFromRecentsAtIndex(i: number) {
  const e = entries.value[i]
  if (!e || recentsMutationBusy.value) return
  recentsMutationBusy.value = true
  try {
    await $fetch('/api/library/recent-remove', {
      method: 'POST',
      body: { session: libSession(e), trailerRel: e.trailerRel },
    })
    showToast('Removido de Destaques.', 'success')
    const neighborRel =
      entries.value.length > 1
        ? (entries.value[i + 1] ?? entries.value[i - 1])?.trailerRel ?? undefined
        : undefined
    await loadTrailers(
      typeof neighborRel === 'string' ? { preserveFocusTrailerRel: neighborRel } : {},
    )
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    showToast(
      ex?.data?.statusMessage || ex?.message || 'Não foi possível remover de Destaques.',
      'error',
    )
  } finally {
    recentsMutationBusy.value = false
  }
}

/** Evita `router.replace` a disparar o watcher da rota em loop. */
let ignoreNextRouteQueryWatch = false
/** Durante aplicação de query partilhada, não reescrever a URL. */
let suppressShareUrlSync = false
/**
 * `true` enquanto o vídeo completo está activo com `rel` na URL; ao sair, o próximo sync passa a
 * `?session=N` só (sem `rel`). Em modo trailer não se reescreve `rel` ao mudar de título.
 */
const hadFullVideoForShareUrlRef = ref(false)

const fullEntries = ref<TrailerListEntry[]>([])
/** Filtro da grelha por tag; `null` = mostrar todos. */
const catalogTagFilter = ref<string | null>(null)
/**
 * Filtro "Só vistos": quando `true`, restringe o catálogo aos vídeos com
 * tag `concluido` OU `memoravel`. Combina com `catalogTagFilter` (AND).
 */
const showOnlyWatched = ref(false)
const showOnlyFavorites = ref(false)

type CatalogSortKey = 'name' | 'date' | 'size'
const catalogSortKey = ref<CatalogSortKey>('name')
const catalogSortDir = ref<'asc' | 'desc'>('asc')

function compareCatalogEntries(a: TrailerListEntry, b: TrailerListEntry): number {
  // "Vistos" = concluído OU memorável → empurrados para o fim, em qualquer caso.
  const wa = isEntryWatchedClass(a)
  const wb = isEntryWatchedClass(b)
  if (wa !== wb) return wa ? 1 : -1
  const fa = a.isFavorite === true
  const fb = b.isFavorite === true
  if (fa !== fb) return fa ? -1 : 1
  const dir = catalogSortDir.value === 'asc' ? 1 : -1
  if (catalogSortKey.value === 'name') {
    const c = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    if (c !== 0) return dir * c
    return a.mainRel.localeCompare(b.mainRel, undefined, { sensitivity: 'base' })
  }
  if (catalogSortKey.value === 'size') {
    if (a.hasMain !== b.hasMain) return a.hasMain ? -1 : 1
    const sa = a.mainSizeBytes ?? 0
    const sb = b.mainSizeBytes ?? 0
    if (sa !== sb) return dir * (sa < sb ? -1 : sa > sb ? 1 : 0)
    return a.mainRel.localeCompare(b.mainRel, undefined, { sensitivity: 'base' })
  }
  if (a.hasMain !== b.hasMain) return a.hasMain ? -1 : 1
  const ta = a.mainSortTimeMs ?? 0
  const tb = b.mainSortTimeMs ?? 0
  if (ta !== tb) return dir * (ta < tb ? -1 : ta > tb ? 1 : 0)
  return a.mainRel.localeCompare(b.mainRel, undefined, { sensitivity: 'base' })
}

function sortCatalogList(list: TrailerListEntry[]): TrailerListEntry[] {
  return [...list].sort(compareCatalogEntries)
}

const entries = computed(() => {
  const tag = catalogTagFilter.value
  const raw = fullEntries.value
  let filtered = tag ? raw.filter((e) => (e.tags ?? []).includes(tag)) : raw
  if (showOnlyWatched.value) {
    filtered = filtered.filter(isEntryWatchedClass)
  }
  if (showOnlyFavorites.value) {
    filtered = filtered.filter((e) => e.isFavorite === true)
  }
  return sortCatalogList(filtered)
})

const moveTitleSourceSession = computed(() => {
  const e =
    playerUrl.value && activeIndex.value !== null
      ? entries.value[activeIndex.value]
      : focusedIndex.value !== null
        ? entries.value[focusedIndex.value]
        : null
  if (!e) return sessionIndex.value >= 0 ? sessionIndex.value : 0
  return libSession(e)
})

const moveTitleTargetSessions = computed(() =>
  sessions.value.filter((s) => s.id >= 0 && s.id !== moveTitleSourceSession.value),
)

const watchedCount = computed(() => fullEntries.value.filter(isEntryWatchedClass).length)
const favoriteCount = computed(() => fullEntries.value.filter((e) => e.isFavorite === true).length)
const sessionMenuTopTags = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of fullEntries.value) {
    for (const t of entry.tags ?? []) {
      const tag = t.trim()
      if (!tag) continue
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })))
    .slice(0, 5)
    .map(([tag]) => tag)
})
const searchSessionActive = computed(() => sessionIndex.value === SEARCH_SESSION_ID)

/** Alterna o filtro "Só vistos" mantendo o foco no vídeo actual sempre que possível. */
function toggleShowOnlyWatched() {
  const prevFocusedRel =
    focusedIndex.value !== null && entries.value[focusedIndex.value]
      ? entries.value[focusedIndex.value].trailerRel
      : null
  const wasFullRel =
    playerUrl.value && activeIndex.value !== null && entries.value[activeIndex.value]
      ? entries.value[activeIndex.value].trailerRel
      : null
  showOnlyWatched.value = !showOnlyWatched.value
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

/** Alterna o filtro "Só favoritos" mantendo foco/playback quando possível. */
function toggleShowOnlyFavorites() {
  const prevFocusedRel =
    focusedIndex.value !== null && entries.value[focusedIndex.value]
      ? entries.value[focusedIndex.value].trailerRel
      : null
  const wasFullRel =
    playerUrl.value && activeIndex.value !== null && entries.value[activeIndex.value]
      ? entries.value[activeIndex.value].trailerRel
      : null
  showOnlyFavorites.value = !showOnlyFavorites.value
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

function captureEntryRel(idx: number | null): string | null {
  if (idx === null) return null
  return entries.value[idx]?.trailerRel ?? null
}

function cycleCatalogSort(key: CatalogSortKey) {
  const relFocus = captureEntryRel(focusedIndex.value)
  const relActive = playerUrl.value ? captureEntryRel(activeIndex.value) : null
  const relInline = captureEntryRel(gridInlinePreviewIndex.value)
  const relGallery = captureEntryRel(catalogGalleryIndex.value)

  if (catalogSortKey.value === key) {
    catalogSortDir.value = catalogSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    catalogSortKey.value = key
    catalogSortDir.value = 'asc'
  }

  nextTick(() => {
    const map = (rel: string | null) =>
      rel ? entries.value.findIndex((e) => e.trailerRel === rel) : -1
    if (relFocus) {
      const ni = map(relFocus)
      if (ni >= 0) focusedIndex.value = ni
    }
    if (relActive) {
      const na = map(relActive)
      if (na >= 0) activeIndex.value = na
    }
    if (relInline) {
      const nx = map(relInline)
      gridInlinePreviewIndex.value = nx >= 0 ? nx : null
    }
    if (relGallery) {
      const ng = map(relGallery)
      catalogGalleryIndex.value = ng >= 0 ? ng : null
    }

    const fr = captureEntryRel(focusedIndex.value)
    if (fr) {
      requestAnimationFrame(() => scrollCatalogGridToTrailerRel(fr))
    }
  })
}

const errorMsg = ref('')
const loading = ref(false)

const focusedIndex = ref<number | null>(null)
const activeIndex = ref<number | null>(null)

const previewUrl = ref<string | null>(null)
const previewVideoRef = ref<HTMLVideoElement | null>(null)
/** Contentor do trailer para fullscreen com overlay (não só o elemento vídeo). */
const previewFullscreenWrapRef = ref<HTMLElement | null>(null)
const trailerStageFullscreen = ref(false)

/** Máximo de trailers fixos por baixo do principal (grelha + 2 = 3 vídeos). */
const MAX_PINNED_TRAILERS = 2
/** Trailers em loop por baixo do palco principal; não mudam ao mudar a selecção na grelha. */
const pinnedTrailers = ref<string[]>([])

/** Quando ligado, «próximo» (botão, FF no comando, fim do preview) escolhe trailer aleatório. */
const shuffleForwardEnabled = ref(false)
/** Após «anterior», o próximo avanço é sempre sequencial uma vez (mesmo com aleatório ligado). */
const sequentialForwardOnceAfterPrev = ref(false)

const playerUrl = ref<string | null>(null)
const mainVideoRef = ref<HTMLVideoElement | null>(null)

const playbackRate = ref(1)
const fastPlayEnabled = ref(false)

const fastPlayRate = ref(2)
const fastPlayStepSeconds = ref(60)
const fastPlayWindowSeconds = ref(10)
const fastPlayLastMinuteSeconds = ref(60)
let fastPlaySegmentStartAt = 0
let fastPlayProgrammaticSeek = false

/**
 * Com FAST activo, sem `controls` no vídeo completo (desktop fullscreen incluído): seeks programáticos
 * fazem vários browsers mostrarem a barra nativa. Usa a toolbar e toque no vídeo para pausar/continuar;
 * desligue o FAST para voltar à barra nativa e poder arrastar.
 */
const mainVideoNativeControls = computed(() => !fastPlayEnabled.value)

const PREVIEW_TRAILER_MUTED_KEY = 'video-player-preview-trailer-muted'

function readPreviewTrailerMutedFromStorage(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    return localStorage.getItem(PREVIEW_TRAILER_MUTED_KEY) !== '0'
  } catch {
    return true
  }
}

/** Trailers/previews no palco e vídeo inline na grelha; persistido até mudares nos controlos do vídeo. */
const previewTrailerMuted = ref(true)

function persistPreviewTrailerMuted() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PREVIEW_TRAILER_MUTED_KEY, previewTrailerMuted.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function onPreviewTrailerVolumeChange(ev: Event) {
  const v = ev.target
  if (!(v instanceof HTMLVideoElement)) return
  const next = v.muted
  if (previewTrailerMuted.value === next) return
  previewTrailerMuted.value = next
  persistPreviewTrailerMuted()
}

onBeforeMount(() => {
  if (!import.meta.client) return
  previewTrailerMuted.value = readPreviewTrailerMutedFromStorage()
})

/** Segundos a aplicar em `loadedmetadata` do vídeo completo (uma vez). */
const fullVideoResumeAt = ref<number | null>(null)
const MAIN_PROGRESS_SAVE_MS = 2500
let lastMainProgressSave = 0

let orientationMql: MediaQueryList | null = null
let desktopWidthMql: MediaQueryList | null = null
function onDesktopWidthUiChange() {
  isWideDesktopUi.value = desktopWidthMql?.matches ?? false
}

const tagSuggestions = ref<string[]>([])
const newTagInput = ref('')

/** Índices 0..3 para quatro JPEGs estáticos (`/api/library/preview-frame`). */
const catalogFrameSlots = [0, 1, 2, 3] as const

/** Índice do tile onde o preview em vídeo substituiu os JPEGs (2.º toque abre o trailer no palco). */
const gridInlinePreviewIndex = ref<number | null>(null)

function onGridInlinePreviewLoaded(ev: Event) {
  const v = ev.target
  if (v instanceof HTMLVideoElement) v.play().catch(() => {})
}

function onCatalogThumbClick(i: number) {
  if (!entries.value[i]?.previewRel) return
  if (gridInlinePreviewIndex.value === i) {
    onListItemClick(i)
    return
  }
  gridInlinePreviewIndex.value = i
}

const sessionMenuOpen = ref(false)
const trailerTagPanelOpen = ref(false)
const searchSessionInput = ref('')
const searchSessionQuery = ref('')
const searchSessionError = ref('')
const searchSessionMode = ref<'files' | 'tags'>('tags')

const CATALOG_GRID_COLLAPSED_KEY = 'video-player-catalog-grid-collapsed'
const catalogGridCollapsed = ref(false)

watch(catalogGridCollapsed, (v) => {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(CATALOG_GRID_COLLAPSED_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
})

const CATALOG_PANE_WIDTH_KEY = 'video-player-catalog-pane-width-px'
const CATALOG_SPLITTER_COL_PX = 12

/** Largura fixa da coluna do catálogo (px); `null` = usar `minmax(280px, min(54vw, 1100px))` no CSS inline. */
const catalogPaneWidthPx = ref<number | null>(null)

function clampCatalogPaneWidth(px: number): number {
  if (typeof window === 'undefined') return Math.round(px)
  const gapAllowance = 52
  const playerMin = 220
  const catalogMin = 260
  const catalogMax = 1600
  const maxCatalog = Math.min(
    catalogMax,
    Math.max(catalogMin, window.innerWidth - playerMin - CATALOG_SPLITTER_COL_PX - gapAllowance),
  )
  return Math.round(Math.min(Math.max(px, catalogMin), maxCatalog))
}

const catalogSplitterInLayout = computed(
  () => isWideDesktopUi.value && !isSilkTvLike.value && !catalogGridCollapsed.value,
)

const mainStackGridStyle = computed((): Record<string, string> => {
  if (!import.meta.client || !isWideDesktopUi.value) return {}

  if (catalogGridCollapsed.value) {
    return {
      gridTemplateColumns: 'minmax(0, 1fr) 3.35rem',
      columnGap: '0.45rem',
    }
  }

  if (isSilkTvLike.value) {
    return {}
  }

  const thirdCol =
    catalogPaneWidthPx.value === null
      ? 'minmax(280px, min(54vw, 1100px))'
      : `${clampCatalogPaneWidth(catalogPaneWidthPx.value)}px`

  return {
    gridTemplateColumns: `minmax(0, 1fr) ${CATALOG_SPLITTER_COL_PX}px ${thirdCol}`,
    columnGap: 'clamp(0.85rem, 2.2vw, 2rem)',
  }
})

function saveCatalogPaneWidth() {
  if (typeof sessionStorage === 'undefined') return
  if (catalogPaneWidthPx.value === null) return
  try {
    sessionStorage.setItem(CATALOG_PANE_WIDTH_KEY, String(catalogPaneWidthPx.value))
  } catch {
    /* ignore */
  }
}

function resetCatalogPaneWidth() {
  catalogPaneWidthPx.value = null
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(CATALOG_PANE_WIDTH_KEY)
  } catch {
    /* ignore */
  }
}

function onWindowResizeClampCatalogPane() {
  if (catalogPaneWidthPx.value === null) return
  catalogPaneWidthPx.value = clampCatalogPaneWidth(catalogPaneWidthPx.value)
}

let catalogSplitDragActive = false
let catalogSplitPointerStartX = 0
let catalogSplitWidthStart = 0

function onCatalogSplitterPointerDown(e: PointerEvent) {
  if (!catalogSplitterInLayout.value) return
  if (e.button !== 0) return
  const stack = (e.currentTarget as HTMLElement).closest('.main-stack')
  const aside = stack?.querySelector('aside.sidebar')
  const measured =
    aside instanceof HTMLElement ? Math.round(aside.getBoundingClientRect().width) : null
  const base =
    catalogPaneWidthPx.value ?? (measured !== null ? clampCatalogPaneWidth(measured) : 400)
  catalogPaneWidthPx.value = base
  catalogSplitDragActive = true
  catalogSplitPointerStartX = e.clientX
  catalogSplitWidthStart = base
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onCatalogSplitterPointerMove(e: PointerEvent) {
  if (!catalogSplitDragActive) return
  const dx = e.clientX - catalogSplitPointerStartX
  // Catálogo à direita: arrastar o separador para a direita (dx > 0) estreita o catálogo; para a esquerda alarga.
  catalogPaneWidthPx.value = clampCatalogPaneWidth(catalogSplitWidthStart - dx)
}

function onCatalogSplitterPointerUp(e: PointerEvent) {
  if (!catalogSplitDragActive) return
  catalogSplitDragActive = false
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  saveCatalogPaneWidth()
}

function onCatalogSplitterPointerCancel(e: PointerEvent) {
  catalogSplitDragActive = false
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
}

function onCatalogSplitterKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const step = 28
  const stack = (e.currentTarget as HTMLElement).closest('.main-stack')
  const aside = stack?.querySelector('aside.sidebar')
  let base = catalogPaneWidthPx.value
  if (base === null && aside instanceof HTMLElement) {
    base = clampCatalogPaneWidth(Math.round(aside.getBoundingClientRect().width))
  }
  if (base === null) base = 400
  const delta = e.key === 'ArrowRight' ? -step : step
  catalogPaneWidthPx.value = clampCatalogPaneWidth(base + delta)
  saveCatalogPaneWidth()
}

const catalogGalleryIndex = ref<number | null>(null)

const galleryDialogEntry = computed(() => {
  const i = catalogGalleryIndex.value
  if (i === null) return null
  return entries.value[i] ?? null
})

function openCatalogGalleryDialog(i: number) {
  if (!entries.value[i]?.previewRel) return
  catalogGalleryIndex.value = i
}

function closeCatalogGalleryDialog() {
  catalogGalleryIndex.value = null
}

function onSessionMenuPick(id: number) {
  sessionMenuOpen.value = false
  void selectSession(id)
}

function onTopTagPick(tag: string) {
  if (!tag) return
  catalogTagFilter.value = catalogTagFilter.value === tag ? null : tag
  sessionMenuOpen.value = false
}

async function runSearchSession() {
  const q = searchSessionInput.value.trim()
  searchSessionError.value = ''
  if (q.length < 2) {
    searchSessionQuery.value = ''
    if (searchSessionActive.value) {
      await loadTrailers()
    }
    return
  }
  searchSessionQuery.value = q
  if (!searchSessionActive.value) {
    await selectSession(SEARCH_SESSION_ID)
    return
  }
  await loadTrailers()
}

let gridChromeLongTimer: ReturnType<typeof setTimeout> | null = null

/** Toque longo (~0,5s) na margem do tile (não no thumb/botões) abre a galeria em ecrã inteiro. */
function onGridTileChromePointerDown(i: number, e: PointerEvent) {
  if (e.button !== 0) return
  if (e.target !== e.currentTarget) return
  if (!entries.value[i]?.previewRel) return
  if (gridChromeLongTimer) clearTimeout(gridChromeLongTimer)
  gridChromeLongTimer = window.setTimeout(() => {
    gridChromeLongTimer = null
    openCatalogGalleryDialog(i)
  }, 520)
}

function onGridTileChromePointerUp() {
  if (gridChromeLongTimer) {
    clearTimeout(gridChromeLongTimer)
    gridChromeLongTimer = null
  }
}

function documentTargetIsFormField(evTarget: EventTarget | null): boolean {
  const t = evTarget
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  )
}

function scrollCatalogStepPx(): number {
  if (typeof window === 'undefined') return 200
  return Math.min(380, Math.max(100, Math.round(window.innerHeight * 0.3)))
}

/** dir 1 = baixo, -1 = cima. Devolve true se `scrollTop` mudou. */
function scrollCatalogApplyStep(dir: 1 | -1): boolean {
  const root = catalogScrollRootEl()
  if (!root) return false
  const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight)
  if (maxScroll <= 0) return false
  const step = scrollCatalogStepPx()
  const dest = Math.min(maxScroll, Math.max(0, root.scrollTop + dir * step))
  if (dest === root.scrollTop) return false
  root.scrollTo({ top: dest, behavior: 'auto' })
  return true
}

/** Botões ▲▼ no catálogo (Silk): não dependem da barra nativa nem das teclas de volume. */
function scrollCatalogByDirection(dir: 1 | -1) {
  if (!entries.value.length) return
  const wasCollapsed = catalogGridCollapsed.value
  if (wasCollapsed) catalogGridCollapsed.value = false
  if (wasCollapsed) {
    nextTick(() => scrollCatalogApplyStep(dir))
  } else {
    scrollCatalogApplyStep(dir)
  }
}

/**
 * TV / comando: tentar rolar o catálogo com teclas que alguns browsers expõem.
 * Nota: Volume+/− são muitas vezes consumidos pelo SO e **nunca chegam** à página — use os botões ▲▼ ou FF/RW nos títulos.
 */
function handleCatalogRemoteScrollKeys(e: KeyboardEvent): boolean {
  if (documentTargetIsFormField(e.target)) return false
  if (!entries.value.length) return false

  let tvLikeScroll = isSilkTvLike.value
  if (!tvLikeScroll && typeof window !== 'undefined') {
    try {
      tvLikeScroll = window.matchMedia('(pointer: coarse)').matches
    } catch {
      tvLikeScroll = false
    }
  }
  if (!tvLikeScroll) return false

  const k = e.key
  let dir: 1 | -1 | null = null
  if (k === 'VolumeDown' || k === 'AudioVolumeDown' || k === 'ChannelDown') dir = 1
  else if (k === 'VolumeUp' || k === 'AudioVolumeUp' || k === 'ChannelUp') dir = -1
  else if (k === 'PageDown') dir = 1
  else if (k === 'PageUp') dir = -1

  if (dir === null) return false

  const wasCollapsed = catalogGridCollapsed.value
  if (wasCollapsed) catalogGridCollapsed.value = false

  const finish = (): boolean => {
    const moved = scrollCatalogApplyStep(dir!)
    if (moved) {
      try {
        e.preventDefault()
      } catch {
        /* volume: preventDefault pode ser ignorado */
      }
    }
    return moved
  }

  if (wasCollapsed) {
    nextTick(finish)
    return true
  }

  return finish()
}

function onGlobalDocumentKeydown(e: KeyboardEvent) {
  if (handleCatalogRemoteScrollKeys(e)) return

  if (isSilkTvLike.value) {
    if (!documentTargetIsFormField(e.target)) {
      const k = e.key
      if (k === 'MediaFastForward' || k === 'MediaTrackNext') {
        if (entries.value.length) {
          e.preventDefault()
          goToNextTrailer()
          return
        }
      } else if (k === 'MediaRewind' || k === 'MediaTrackPrevious') {
        if (entries.value.length) {
          e.preventDefault()
          goToPrevTrailer()
          return
        }
      } else if (k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') {
        const el = activeVideoEl()
        if (el) {
          e.preventDefault()
          if (k === 'MediaPause') el.pause()
          else if (k === 'MediaPlay') void el.play().catch(() => {})
          else if (el.paused) void el.play().catch(() => {})
          else el.pause()
          return
        }
      }
    }
  }

  if (e.key === 'Escape') {
    if (catalogGalleryIndex.value !== null) {
      closeCatalogGalleryDialog()
      return
    }
    if (sessionMenuOpen.value) sessionMenuOpen.value = false
    return
  }
  if (e.key === 'Home') {
    const t = e.target
    if (documentTargetIsFormField(t)) {
      return
    }
    if (!entries.value.length) return
    e.preventDefault()
    scrollCatalogGridToTopAndFocusFirst()
  }
}

watch([catalogGalleryIndex, sessionMenuOpen], () => {
  if (typeof document === 'undefined') return
  document.body.style.overflow =
    catalogGalleryIndex.value !== null || sessionMenuOpen.value ? 'hidden' : ''
})

const selectedEntry = computed(() => {
  const i = focusedIndex.value
  if (i === null) return null
  return entries.value[i] ?? null
})

/** Diretório relativo à raiz da sessão (vazio se o completo está na raiz). */
function parentRelDir(mainRel: string): string {
  const n = mainRel.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = n.lastIndexOf('/')
  return i > 0 ? n.slice(0, i) : ''
}

/** Pasta no topo do cartão: biblioteca (menu) e, se aplicável, subpasta do `mainRel`. */
const playbackFolderCaption = computed(() => {
  const entry = selectedEntry.value
  if (!entry) return ''
  const lib = sessions.value.find((s) => s.id === libSession(entry))?.label?.trim() ?? ''
  const sub = parentRelDir(entry.mainRel)
  const destaquesPrefix =
    sessionIndex.value === RECENTS_SESSION_ID ? (lib ? `Destaques · ${lib}` : 'Destaques') : ''
  if (sessionIndex.value === RECENTS_SESSION_ID) {
    if (sub && destaquesPrefix) return `${destaquesPrefix} · ${sub.replace(/\//g, ' / ')}`
    return destaquesPrefix || 'Destaques'
  }
  if (sub && lib) return `${lib} · ${sub.replace(/\//g, ' / ')}`
  if (sub) return sub.replace(/\//g, ' / ')
  return lib || '—'
})

/** Título cujo vídeo completo está no palco (índice na lista filtrada). */
const mainVideoEntry = computed(() => {
  if (!playerUrl.value) return null
  const i = activeIndex.value
  if (i !== null) {
    const fromIdx = entries.value[i]
    if (fromIdx) return fromIdx
  }
  const parsed = parseApiVideoUrl(playerUrl.value)
  if (!parsed) return null
  const norm = (r: string) => r.replace(/\\/g, '/').replace(/^\/+/, '')
  const want = norm(parsed.rel)
  return (
    fullEntries.value.find((e) => norm(e.mainRel) === want && libSession(e) === parsed.session) ?? null
  )
})

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatGB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function revealPlayingFileInExplorer() {
  if (typeof sessionStorage === 'undefined') return
  const tok = sessionStorage.getItem('video_admin_token')?.trim() ?? ''
  if (!tok) {
    errorMsg.value =
      'Para abrir a pasta no servidor, abre a página Admin e clica em «Guardar no browser» com o mesmo token (VIDEO_ADMIN_TOKEN).'
    return
  }
  if (!adminRevealExplorer.value) {
    errorMsg.value =
      'O servidor não reportou token admin activo. Coloca VIDEO_ADMIN_TOKEN ou NUXT_ADMIN_TOKEN no .env na raiz do projecto, guarda o ficheiro, reinicia o npm run dev/start e recarrega a lista (muda de biblioteca e volta).'
    return
  }

  let target: 'main' | 'trailer' | 'preview'
  let rel: string
  let sessionForReveal: number

  if (playerUrl.value && mainVideoEntry.value) {
    target = 'main'
    rel = mainVideoEntry.value.mainRel
    sessionForReveal = libSession(mainVideoEntry.value)
  } else if (playerUrl.value) {
    const p = parseApiVideoUrl(playerUrl.value)
    if (!p) {
      errorMsg.value =
        'Não foi possível determinar o ficheiro em reprodução para abrir na pasta no servidor.'
      return
    }
    target = 'main'
    rel = p.rel
    sessionForReveal = p.session
  } else if (!playerUrl.value && previewUrl.value && selectedEntry.value) {
    const e = selectedEntry.value
    if (e.hasMain) {
      target = 'main'
      rel = e.mainRel
    } else {
      target = 'trailer'
      rel = e.trailerRel
    }
    sessionForReveal = libSession(e)
  } else {
    errorMsg.value = 'Não há ficheiro seleccionado para mostrar na pasta no servidor.'
    return
  }

  try {
    await $fetch('/api/admin/reveal-in-explorer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json',
      },
      body: {
        session: sessionForReveal,
        target,
        rel,
      },
    })
    errorMsg.value = ''
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível abrir a pasta no servidor.'
  }
}

function formatWatchedSeconds(secs: number | null | undefined): string {
  if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0) return ''
  const total = Math.floor(secs)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}

function setPreviewForIndex(i: number | null) {
  previewUrl.value = null
  if (i === null || !entries.value[i]) return
  const e = entries.value[i]
  if (!e.previewRel) return
  previewUrl.value = apiVideoUrl(e.trailerRel, libSession(e))
}

function setTrailerIndex(i: number) {
  gridInlinePreviewIndex.value = null
  trailerTagPanelOpen.value = false
  focusedIndex.value = i
  setPreviewForIndex(i)
  void nextTick(() => {
    requestAnimationFrame(() => {
      const rel = entries.value[i]?.trailerRel
      if (rel) scrollCatalogGridToTrailerRel(rel)
    })
  })
}

function onPreviewLoaded() {
  errorMsg.value = ''
  const el = previewVideoRef.value
  if (el) {
    el.playbackRate = playbackRate.value
    el.play().catch(() => {})
  }
}

function stageVideoMediaErrorReason(code: number): string {
  if (typeof MediaError !== 'undefined') {
    if (code === MediaError.MEDIA_ERR_ABORTED) return 'carregamento interrompido'
    if (code === MediaError.MEDIA_ERR_NETWORK) return 'rede ou fluxo interrompido'
    if (code === MediaError.MEDIA_ERR_DECODE)
      return 'decode — codec/formato não suportado neste equipamento'
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)
      return 'tipo de ficheiro ou codec não suportado pelo browser'
  }
  return code ? `erro de média (${code})` : 'erro desconhecido'
}

function onStageVideoError(ev: Event) {
  const el = ev.target
  if (!(el instanceof HTMLVideoElement)) return
  const code = el.error?.code ?? 0
  let label = 'vídeo'
  if (previewUrl.value && selectedEntry.value) label = selectedEntry.value.label
  else if (playerUrl.value && mainVideoEntry.value) label = mainVideoEntry.value.label
  errorMsg.value = `Não foi possível reproduzir (${label}). ${stageVideoMediaErrorReason(code)}. Se usar HEVC/H.265 ou áudio só em AC3, converta para H.264 + AAC em MP4.`
}

function onPinnedPreviewLoaded(ev: Event) {
  const el = ev.target
  if (el instanceof HTMLVideoElement) {
    el.playbackRate = playbackRate.value
    el.play().catch(() => {})
  }
}

function onPinnedRateChange(ev: Event) {
  const el = ev.target
  if (!(el instanceof HTMLVideoElement) || !Number.isFinite(el.playbackRate)) return
  if (Math.abs(el.playbackRate - playbackRate.value) < 0.001) return
  setPlaybackRate(el.playbackRate)
}

function clearPinnedTrailers() {
  pinnedTrailers.value = []
}

/** Adiciona o trailer actual da grelha como painel fixo em loop (máx. 2). */
function addPinnedTrailer() {
  const u = previewUrl.value
  if (!u || pinnedTrailers.value.length >= MAX_PINNED_TRAILERS) return
  const last = pinnedTrailers.value[pinnedTrailers.value.length - 1]
  if (last === u) return
  pinnedTrailers.value = [...pinnedTrailers.value, u]
}

const pinSplitToolbarTitle = computed(() => {
  if (pinnedTrailers.value.length >= MAX_PINNED_TRAILERS) {
    return 'Já estão 3 vídeos (grelha + 2 fixos). Clica para remover os fixos e ficar só com o trailer da grelha.'
  }
  return `Fixar este trailer por baixo em loop (${pinnedTrailers.value.length}/2). Máximo 3 vídeos: grelha + 2 fixos.`
})

const pinSplitToolbarAria = computed(() =>
  pinnedTrailers.value.length >= MAX_PINNED_TRAILERS
    ? 'Remover trailers fixos e ficar só com o da grelha'
    : 'Fixar trailer por baixo',
)

/** Com 2 fixos (3 vídeos no total), o mesmo botão remove todos os fixos. */
function onPinSplitToolbarClick() {
  if (pinnedTrailers.value.length >= MAX_PINNED_TRAILERS) {
    clearPinnedTrailers()
    return
  }
  addPinnedTrailer()
}

watch(previewUrl, (u) => {
  if (!u && pinnedTrailers.value.length) clearPinnedTrailers()
})

/** Índice aleatório (lista filtrada), mesma política que o antigo «trailer aleatório». */
function pickRandomTrailerIndex(): number | null {
  const list = entries.value
  const n = list.length
  if (n < 2) return null
  const cur = focusedIndex.value ?? 0
  const pool: number[] = []
  for (let i = 0; i < n; i++) {
    if (i === cur) continue
    if (isEntryWatchedClass(list[i]!)) continue
    pool.push(i)
  }
  if (!pool.length) {
    for (let i = 0; i < n; i++) {
      if (i !== cur) pool.push(i)
    }
  }
  if (!pool.length) return null
  return pool[Math.floor(Math.random() * pool.length)]!
}

function toggleShuffleForward() {
  if (entries.value.length < 2) return
  shuffleForwardEnabled.value = !shuffleForwardEnabled.value
}

function goToNextTrailer() {
  const n = entries.value.length
  if (n === 0) return

  if (sequentialForwardOnceAfterPrev.value) {
    sequentialForwardOnceAfterPrev.value = false
    const cur = focusedIndex.value ?? 0
    const next = cur + 1 < n ? cur + 1 : 0
    playerUrl.value = null
    activeIndex.value = null
    setTrailerIndex(next)
    return
  }

  if (shuffleForwardEnabled.value) {
    const j = pickRandomTrailerIndex()
    if (j !== null) {
      playerUrl.value = null
      activeIndex.value = null
      setTrailerIndex(j)
      return
    }
  }

  const cur = focusedIndex.value ?? 0
  const next = cur + 1 < n ? cur + 1 : 0
  playerUrl.value = null
  activeIndex.value = null
  setTrailerIndex(next)
}

function goToPrevTrailer() {
  const n = entries.value.length
  if (n === 0) return
  sequentialForwardOnceAfterPrev.value = true
  const cur = focusedIndex.value ?? 0
  const prev = cur - 1 >= 0 ? cur - 1 : n - 1
  playerUrl.value = null
  activeIndex.value = null
  setTrailerIndex(prev)
}

/** Avança para o próximo trailer quando o atual termina (lista circular). */
function onPreviewEnded() {
  void markCurrentTrailerWatchedFireAndForget()
  goToNextTrailer()
}

/**
 * Marca como `trailer-visto` o trailer actualmente em foco (que acabou de chegar ao fim do preview).
 * Atualiza a tag localmente para o badge azul aparecer já no próximo render — não afecta sort/random.
 */
async function markCurrentTrailerWatchedFireAndForget() {
  const i = focusedIndex.value
  if (i === null) return
  const entry = entries.value[i]
  if (!entry) return
  if (isEntryTrailerWatched(entry) || isEntryCompleted(entry) || isEntryMemorable(entry)) return
  const trailerRel = entry.trailerRel
  try {
    await $fetch<{ tags: string[] }>('/api/library/trailer-watched', {
      method: 'POST',
      body: { session: libSession(entry), trailerRel, watched: true },
    })
    const ls = libSession(entry)
    const idx = fullEntries.value.findIndex((e) => e.trailerRel === trailerRel && libSession(e) === ls)
    if (idx >= 0) {
      const cur = fullEntries.value[idx].tags ?? []
      if (!cur.some((t) => t.toLowerCase() === TRAILER_WATCHED_TAG_NAME)) {
        fullEntries.value[idx].tags = [...cur, TRAILER_WATCHED_TAG_NAME].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        )
      }
    }
  } catch {
    /* */
  }
}

function shouldAutoFullscreenOnLandscape() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(max-width: 920px)').matches ||
    window.matchMedia('(pointer: coarse)').matches
  )
}

function activeVideoEl(): HTMLVideoElement | null {
  return playerUrl.value ? mainVideoRef.value : previewVideoRef.value
}

/** Alvo do fullscreen automático em landscape: trailer → contentor com botões; vídeo completo → elemento vídeo. */
function fullscreenTargetForAutorient(): HTMLElement | null {
  if (playerUrl.value) return mainVideoRef.value
  return previewFullscreenWrapRef.value ?? previewVideoRef.value
}

async function tryEnterFullscreen(el: HTMLElement | null) {
  if (!el) return
  const innerVideo =
    el instanceof HTMLVideoElement ? el : (el.querySelector('video') as HTMLVideoElement | null)

  /** Primeiro: contentor (overlay «próximo»); se falhar, o mesmo fluxo no elemento vídeo (compat mobile). */
  if (!(el instanceof HTMLVideoElement) && typeof el.requestFullscreen === 'function') {
    try {
      await el.requestFullscreen()
      return
    } catch {
      /* continuar para o vídeo */
    }
  }

  if (el instanceof HTMLVideoElement) {
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen()
        return
      }
    } catch {
      /* */
    }
    const wk = (el as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen
    wk?.()
    return
  }

  if (innerVideo) {
    try {
      if (innerVideo.requestFullscreen) {
        await innerVideo.requestFullscreen()
        return
      }
    } catch {
      /* */
    }
    const wk = (innerVideo as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen
    wk?.()
  }
}

async function tryEnterVideoFullscreen(el: HTMLVideoElement) {
  await tryEnterFullscreen(el)
}

function syncTrailerStageFullscreenFlag() {
  if (!import.meta.client || typeof document === 'undefined') return
  const wrap = previewFullscreenWrapRef.value
  trailerStageFullscreen.value = !!wrap && document.fullscreenElement === wrap
}

function onDocumentFullscreenChange() {
  syncTrailerStageFullscreenFlag()
}

/** Sai de fullscreen só se o elemento activo for o vídeo completo (ex.: ao desligar FAST). */
function exitFullscreenIfMainVideo() {
  if (!import.meta.client || typeof document === 'undefined') return
  const v = mainVideoRef.value
  if (!v) return
  if (document.fullscreenElement !== v) return
  document.exitFullscreen?.().catch(() => {})
}

function onLandscapeOrientationChange() {
  if (!shouldAutoFullscreenOnLandscape()) return
  const landscape = window.matchMedia('(orientation: landscape)').matches
  if (landscape) {
    const attempt = () => {
      const el = fullscreenTargetForAutorient()
      if (el) return tryEnterFullscreen(el)
      return Promise.resolve()
    }
    void attempt().then(() => {
      if (typeof document === 'undefined' || document.fullscreenElement) return
      void nextTick(() => void attempt())
    })
    window.setTimeout(() => {
      if (typeof document !== 'undefined' && !document.fullscreenElement) void attempt()
    }, 200)
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {})
  }
}

function onListItemClick(i: number) {
  const e = entries.value[i]
  if (e && !e.previewRel && e.hasMain) {
    void openVideo(i)
    return
  }
  playerUrl.value = null
  activeIndex.value = null
  setTrailerIndex(i)
}

/** Sai do vídeo completo e mostra outra vez só o trailer (previewUrl mantém-se) */
async function closeFullVideo() {
  stopFastPlay(false)
  await flushMainProgressIfAny()
  playerUrl.value = null
  activeIndex.value = null
}

function openFullFromPreview() {
  const i = focusedIndex.value
  if (i === null) return
  void openVideo(i)
}

async function openVideo(i: number) {
  stopFastPlay(false)
  clearPinnedTrailers()
  gridInlinePreviewIndex.value = null
  catalogGalleryIndex.value = null
  sessionMenuOpen.value = false
  const entry = entries.value[i]
  if (!entry) {
    activeIndex.value = null
    return
  }
  if (!entry.hasMain) {
    activeIndex.value = null
    errorMsg.value = `Vídeo completo não encontrado na raiz: ${entry.mainFilename}`
    return
  }
  errorMsg.value = ''
  lastMainProgressSave = 0
  let resumeAt: number | null = null
  try {
    const r = await $fetch<{ seconds: number | null }>(
      `/api/library/full-progress?session=${libSession(entry)}&mainRel=${encodeURIComponent(entry.mainRel)}`,
    )
    if (typeof r?.seconds === 'number' && Number.isFinite(r.seconds) && r.seconds > 2) {
      resumeAt = r.seconds
    }
  } catch {
    /* */
  }
  fullVideoResumeAt.value = resumeAt
  activeIndex.value = i
  playerUrl.value = apiVideoUrl(entry.mainRel, libSession(entry))
  nextTick(() => {
    const v = mainVideoRef.value
    if (v) {
      v.playbackRate = playbackRate.value
      v.play().catch(() => {})
    }
  })
}

function mainProgressStorageRel(): string | null {
  const i = activeIndex.value
  if (i === null || !entries.value[i]) return null
  return entries.value[i].mainRel
}

async function persistMainProgress(force: boolean) {
  if (!playerUrl.value) return
  const v = mainVideoRef.value
  const mainRel = mainProgressStorageRel()
  if (!v || !mainRel || !Number.isFinite(v.currentTime)) return
  const now = Date.now()
  if (!force && now - lastMainProgressSave < MAIN_PROGRESS_SAVE_MS) return
  lastMainProgressSave = now
  const seconds = v.currentTime
  const duration = Number.isFinite(v.duration) ? v.duration : undefined
  const act = activeIndex.value
  const ent = act !== null ? entries.value[act] : undefined
  try {
    await $fetch('/api/library/full-progress', {
      method: 'POST',
      body: {
        session: libSession(ent),
        mainRel,
        seconds,
        ...(duration !== undefined ? { duration } : {}),
      },
    })
    const ls = libSession(ent)
    const idx = fullEntries.value.findIndex((e) => e.mainRel === mainRel && libSession(e) === ls)
    if (idx >= 0) fullEntries.value[idx].watchedSeconds = seconds
  } catch {
    /* */
  }
}

async function flushMainProgressIfAny() {
  if (!playerUrl.value) return
  await persistMainProgress(true)
}

function onMainVideoLoadedMetadata() {
  const v = mainVideoRef.value
  const t = fullVideoResumeAt.value
  fullVideoResumeAt.value = null
  if (!v) return
  if (t != null && Number.isFinite(t) && Number.isFinite(v.duration) && t < v.duration - 4) {
    try {
      v.currentTime = t
    } catch {
      /* */
    }
  }
  fastPlaySegmentStartAt = Number.isFinite(v.currentTime) ? v.currentTime : 0
}

function onMainVideoTimeUpdate() {
  applyFastPlayStepIfNeeded()
  void persistMainProgress(false)
}

function onMainVideoSeeking() {
  if (!fastPlayEnabled.value) return
  if (fastPlayProgrammaticSeek) return
  // Intervenção manual (barra/seek do utilizador) desliga o modo automático.
  stopFastPlay(false)
}

/** Com controlos nativos ocultos (FAST em touch), toque no vídeo = pausar / continuar. */
function onMainVideoSurfaceClick() {
  if (mainVideoNativeControls.value) return
  const v = mainVideoRef.value
  if (!v) return
  if (v.paused) void v.play().catch(() => {})
  else v.pause()
}

function stopFastPlay(keepEnabled: boolean) {
  const v = mainVideoRef.value
  if (v && Number.isFinite(playbackRate.value)) {
    v.playbackRate = playbackRate.value
  }
  fastPlayProgrammaticSeek = false
  fastPlaySegmentStartAt = 0
  if (!keepEnabled) {
    fastPlayEnabled.value = false
    exitFullscreenIfMainVideo()
  }
}

function toggleFastPlay() {
  fastPlayEnabled.value = !fastPlayEnabled.value
  const v = mainVideoRef.value
  if (!fastPlayEnabled.value || !v) {
    if (!fastPlayEnabled.value) stopFastPlay(false)
    return
  }
  v.playbackRate = fastPlayRate.value
  fastPlaySegmentStartAt = Number.isFinite(v.currentTime) ? v.currentTime : 0
  if (v.paused) v.play().catch(() => {})
  void nextTick(() => {
    const el = mainVideoRef.value
    if (el && fastPlayEnabled.value) tryEnterVideoFullscreen(el).catch(() => {})
  })
}

function applyFastPlayStepIfNeeded() {
  if (!fastPlayEnabled.value || fastPlayProgrammaticSeek) return
  const v = mainVideoRef.value
  if (!v || !Number.isFinite(v.currentTime) || !Number.isFinite(v.duration)) return
  if (v.paused || v.ended) return

  const duration = v.duration
  const current = v.currentTime
  const lastMinuteStart = Math.max(0, duration - fastPlayLastMinuteSeconds.value)

  // Último minuto toca contínuo sem mais saltos.
  if (current >= lastMinuteStart) return

  if (!Number.isFinite(fastPlaySegmentStartAt) || fastPlaySegmentStartAt < 0) {
    fastPlaySegmentStartAt = current
  }
  const playedInSegment = current - fastPlaySegmentStartAt
  if (playedInSegment < fastPlayWindowSeconds.value) return

  const nextMinuteMark =
    (Math.floor(current / fastPlayStepSeconds.value) + 1) * fastPlayStepSeconds.value
  if (!Number.isFinite(nextMinuteMark) || nextMinuteMark <= current) return
  if (nextMinuteMark >= lastMinuteStart) return

  fastPlayProgrammaticSeek = true
  try {
    v.currentTime = nextMinuteMark
    fastPlaySegmentStartAt = nextMinuteMark
    if (v.paused) v.play().catch(() => {})
  } catch {
    /* */
  } finally {
    setTimeout(() => {
      fastPlayProgrammaticSeek = false
    }, 0)
  }
}

function onMainVideoEnded() {
  stopFastPlay(false)
  void (async () => {
    const i = activeIndex.value
    const entry = i !== null ? entries.value[i] ?? null : null
    if (!entry) return
    const mainRel = entry.mainRel
    const trailerRel = entry.trailerRel
    const ls = libSession(entry)
    try {
      await $fetch('/api/library/full-progress', {
        method: 'DELETE',
        query: { session: ls, mainRel },
      })
    } catch {
      /* */
    }
    let markedCompleted = false
    try {
      await $fetch('/api/library/completed', {
        method: 'POST',
        body: { session: ls, trailerRel, completed: true },
      })
      markedCompleted = true
    } catch {
      /* */
    }
    if (markedCompleted) {
      try {
        await loadTrailers({ preserveFocusTrailerRel: trailerRel })
      } catch {
        /* */
      }
    }
  })()
}

const TAG_INPUT_MAX_LEN = 80

function splitTagInputToParts(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0 && s.length <= TAG_INPUT_MAX_LEN)
}

const TAG_LONGPRESS_MS = 2000

let tagPointer: { t: number; trailerRel: string; tagName: string; libSession: number } | null = null

function onTagChipPointerDown(libS: number, trailerRel: string, tagName: string, e: PointerEvent) {
  if (e.button !== 0) return
  tagPointer = { t: Date.now(), trailerRel, tagName, libSession: libS }
  const el = e.currentTarget
  if (el instanceof HTMLElement) {
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* */
    }
  }
}

function onTagChipPointerCancel(e: PointerEvent) {
  const el = e.currentTarget
  if (el instanceof HTMLElement) {
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      /* */
    }
  }
  tagPointer = null
}

async function onTagChipPointerUp(libS: number, trailerRel: string, tagName: string, e: PointerEvent) {
  if (e.button !== 0) return
  const el = e.currentTarget
  if (el instanceof HTMLElement) {
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      /* */
    }
  }
  const st = tagPointer
  tagPointer = null
  if (!st || st.trailerRel !== trailerRel || st.tagName !== tagName || st.libSession !== libS) return
  const dt = Date.now() - st.t
  if (dt >= TAG_LONGPRESS_MS) {
    if (!confirm(`Remover a tag «${tagName}» deste título?`)) return
    await removeTagFromEntry(trailerRel, tagName, libS)
  } else {
    applyCatalogTagFilter(tagName)
  }
}

/** Toque curto: filtra a grelha. Manter premido (~2s) e soltar: confirma e remove a tag deste vídeo. */
function applyCatalogTagFilter(tagName: string) {
  const prevFocusedRel =
    focusedIndex.value !== null && entries.value[focusedIndex.value]
      ? entries.value[focusedIndex.value].trailerRel
      : null
  const wasFullRel =
    playerUrl.value && activeIndex.value !== null && entries.value[activeIndex.value]
      ? entries.value[activeIndex.value].trailerRel
      : null

  if (catalogTagFilter.value === tagName) catalogTagFilter.value = null
  else catalogTagFilter.value = tagName

  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

function clearCatalogTagFilter() {
  if (!catalogTagFilter.value) return
  const prevFocusedRel =
    focusedIndex.value !== null && entries.value[focusedIndex.value]
      ? entries.value[focusedIndex.value].trailerRel
      : null
  const wasFullRel =
    playerUrl.value && activeIndex.value !== null && entries.value[activeIndex.value]
      ? entries.value[activeIndex.value].trailerRel
      : null
  catalogTagFilter.value = null
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

async function refocusAfterTagFilterChange(prevFocusedRel: string | null, wasFullRel: string | null) {
  await nextTick()
  const list = entries.value

  if (!list.length) {
    await closeFullVideo()
    focusedIndex.value = null
    previewUrl.value = null
    return
  }

  if (playerUrl.value && wasFullRel) {
    const ni = list.findIndex((e) => e.trailerRel === wasFullRel)
    if (ni < 0) await closeFullVideo()
    else {
      activeIndex.value = ni
      focusedIndex.value = ni
    }
  }

  if (playerUrl.value) return

  if (prevFocusedRel) {
    const ni = list.findIndex((e) => e.trailerRel === prevFocusedRel)
    if (ni >= 0) {
      setTrailerIndex(ni)
      return
    }
  }
  setTrailerIndex(0)
}

async function addTagFromInput() {
  const e =
    playerUrl.value && activeIndex.value !== null
      ? (entries.value[activeIndex.value] ?? null)
      : selectedEntry.value
  if (!e) return
  const parts = [...new Set(splitTagInputToParts(newTagInput.value))]
  if (!parts.length) return
  try {
    for (const name of parts) {
      await $fetch('/api/library/tags', {
        method: 'POST',
        body: {
          session: libSession(e),
          trailerRel: e.trailerRel,
          name,
        },
      })
    }
    newTagInput.value = ''
    errorMsg.value = ''
    await loadTrailers({ preserveFocusTrailerRel: e.trailerRel })
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível gravar a tag (servidor).'
  }
}

async function removeTagFromEntry(trailerRel: string, tagName: string, libS: number) {
  try {
    await $fetch(
      `/api/library/tags?session=${libS}&trailerRel=${encodeURIComponent(trailerRel)}&name=${encodeURIComponent(tagName)}`,
      { method: 'DELETE' },
    )
    errorMsg.value = ''
    await loadTrailers({ preserveFocusTrailerRel: trailerRel })
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível remover a tag (servidor).'
  }
}

async function toggleFavoriteAtIndex(i: number) {
  const e = entries.value[i]
  if (!e) return
  try {
    await $fetch('/api/library/favorite', {
      method: 'POST',
      body: { session: libSession(e), trailerRel: e.trailerRel },
    })
    errorMsg.value = ''
    await loadTrailers({ preserveFocusTrailerRel: e.trailerRel })
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível gravar o favorito (servidor).'
  }
}

/**
 * Alterna a tag `memoravel` no vídeo do índice `i`. A tag empurra o vídeo para o
 * fim do catálogo e exclui-o do "trailer aleatório", mas mantém o estado visual
 * próprio (badge dourado) — diferente do `concluido` automático.
 *
 * Atualiza o estado local imediatamente para feedback instantâneo (sem esperar
 * pelo fetch dos trailers); ainda assim re-carrega para garantir consistência.
 */
async function toggleMemorableAtIndex(i: number) {
  const e = entries.value[i]
  if (!e) return
  const isMemorable = isEntryMemorable(e)
  const next = !isMemorable
  const trailerRel = e.trailerRel
  const ls = libSession(e)

  const idx = fullEntries.value.findIndex((x) => x.trailerRel === trailerRel && libSession(x) === ls)
  if (idx >= 0) {
    const cur = fullEntries.value[idx].tags ?? []
    if (next && !cur.some((t) => t.toLowerCase() === MEMORABLE_TAG_NAME)) {
      fullEntries.value[idx].tags = [...cur, MEMORABLE_TAG_NAME].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      )
    } else if (!next) {
      fullEntries.value[idx].tags = cur.filter((t) => t.toLowerCase() !== MEMORABLE_TAG_NAME)
    }
  }

  try {
    await $fetch('/api/library/memorable', {
      method: 'POST',
      body: { session: ls, trailerRel, memorable: next },
    })
    errorMsg.value = ''
    await loadTrailers({ preserveFocusTrailerRel: trailerRel })
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível gravar a marca «memorável».'
    if (idx >= 0) {
      const cur = fullEntries.value[idx].tags ?? []
      if (next) {
        fullEntries.value[idx].tags = cur.filter((t) => t.toLowerCase() !== MEMORABLE_TAG_NAME)
      } else if (!cur.some((t) => t.toLowerCase() === MEMORABLE_TAG_NAME)) {
        fullEntries.value[idx].tags = [...cur, MEMORABLE_TAG_NAME].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        )
      }
    }
  }
}

async function deleteTitleAtIndex(i: number) {
  const e = entries.value[i]
  if (!e) return
  const parts = [
    'Mover para a Lixeira do sistema?',
    '',
    `• Vídeo na raiz: ${e.mainFilename}`,
    '• Trailer em trailers/',
    e.previewRel ? '• Preview em preview/ (ou legado em trailers/)' : '',
    '',
    'Só ficheiros que existirem são movidos. Podes recuperar na Lixeira.',
  ].filter(Boolean)
  if (!confirm(parts.join('\n'))) return

  if (playerUrl.value && activeIndex.value === i) {
    await closeFullVideo()
  }

  try {
    await $fetch('/api/library/delete-title', {
      method: 'POST',
      body: { session: libSession(e), trailerRel: e.trailerRel },
    })
    errorMsg.value = ''
    await loadTrailers()
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível mover os ficheiros para a Lixeira.'
  }
}

function openMoveTitleDialog() {
  moveTitleError.value = ''
  moveTitleDialogOpen.value = true
}

async function confirmMoveTitleToSession(targetId: number) {
  if (moveTitleBusy.value) return
  const wasFull = !!playerUrl.value
  const fromSession = moveTitleSourceSession.value
  const entry =
    wasFull && activeIndex.value !== null
      ? entries.value[activeIndex.value]
      : focusedIndex.value !== null
        ? entries.value[focusedIndex.value]
        : null
  if (!entry || targetId === fromSession) {
    moveTitleDialogOpen.value = false
    return
  }
  const trailerRel = entry.trailerRel
  moveTitleBusy.value = true
  moveTitleError.value = ''
  try {
    await $fetch('/api/library/move-title', {
      method: 'POST',
      body: { session: fromSession, targetSession: targetId, trailerRel },
    })
    errorMsg.value = ''
    moveTitleDialogOpen.value = false
    pinnedTrailers.value = []
    sessionIndex.value = targetId
    await loadTrailers({ preserveFocusTrailerRel: trailerRel })
    await nextTick()
    const idx = entries.value.findIndex((e) => e.trailerRel === trailerRel)
    if (idx >= 0) {
      gridInlinePreviewIndex.value = null
      trailerTagPanelOpen.value = false
      focusedIndex.value = idx
      const ent = entries.value[idx]!
      if (wasFull) {
        activeIndex.value = idx
        playerUrl.value = apiVideoUrl(ent.mainRel, libSession(ent))
        previewUrl.value = apiVideoUrl(ent.trailerRel, libSession(ent))
      } else {
        setPreviewForIndex(idx)
      }
      void nextTick(() => {
        requestAnimationFrame(() => scrollCatalogGridToTrailerRel(ent.trailerRel))
      })
    } else {
      focusedIndex.value = null
      previewUrl.value = null
      playerUrl.value = null
      activeIndex.value = null
    }
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string }; message?: string }
    moveTitleError.value =
      ex?.data?.statusMessage || ex?.message || 'Não foi possível mover os ficheiros.'
  } finally {
    moveTitleBusy.value = false
  }
}

function applyPlaybackRateToAllVideos(rate: number) {
  const main = mainVideoRef.value
  if (main && Math.abs(main.playbackRate - rate) > 0.001) main.playbackRate = rate
  const preview = previewVideoRef.value
  if (preview && Math.abs(preview.playbackRate - rate) > 0.001) preview.playbackRate = rate
  if (typeof document !== 'undefined') {
    const pinned = document.querySelectorAll<HTMLVideoElement>('.video-shell-pinned-row video')
    pinned.forEach((el) => {
      if (Math.abs(el.playbackRate - rate) > 0.001) el.playbackRate = rate
    })
  }
}

function setPlaybackRate(rate: number) {
  playbackRate.value = rate
  applyPlaybackRateToAllVideos(rate)
}

function syncRateFromVideo() {
  // Em FAST, a velocidade do vídeo completo é temporária e não deve sobrescrever o seletor global.
  if (fastPlayEnabled.value && playerUrl.value) return
  const v = playerUrl.value ? mainVideoRef.value : previewVideoRef.value
  if (v && Number.isFinite(v.playbackRate)) {
    if (Math.abs(v.playbackRate - playbackRate.value) < 0.001) return
    setPlaybackRate(v.playbackRate)
  }
}

async function loadSessions() {
  try {
    const data = await $fetch<{ sessions: VideoSessionTab[] }>('/api/sessions')
    sessions.value = data.sessions
    const routeSession = parseShareSessionQuery(route.query.session)
    const defaultSessionId =
      sessions.value.find((s) => s.id === RECENTS_SESSION_ID)?.id ??
      sessions.value.find((s) => s.id >= 0)?.id ??
      sessions.value[0]?.id ??
      0

    // Se a URL define sessão válida, respeitar.
    if (routeSession !== null && sessions.value.some((s) => s.id === routeSession)) {
      sessionIndex.value = routeSession
      return
    }

    // Sem ?session=, iniciar na vista agregada Favoritos (-1), se existir.
    if (routeSession === null) {
      sessionIndex.value = defaultSessionId
      return
    }

    if (!sessions.value.some((s) => s.id === sessionIndex.value)) {
      sessionIndex.value = defaultSessionId
    }
  } catch (e: unknown) {
    sessions.value = []
    const err = e as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value =
      err?.data?.statusMessage || err?.message || 'Não foi possível carregar as sessões (VIDEO_ROOT).'
  }
}

/**
 * Refaz `loadSessions` + `loadTrailers` preservando o foco/full em curso.
 * Usado pelo canal `BroadcastChannel` quando a admin pede para recarregar
 * (depois de gerar trailers/previews ou editar `data/video-menu.json`).
 */
async function refreshLibraryFromExternal() {
  await loadSessions()
  if (!sessions.value.length) {
    fullEntries.value = []
    return
  }
  const playingRel =
    playerUrl.value && activeIndex.value !== null && entries.value[activeIndex.value]
      ? entries.value[activeIndex.value].trailerRel
      : null
  const focusedRel =
    focusedIndex.value !== null && entries.value[focusedIndex.value]
      ? entries.value[focusedIndex.value].trailerRel
      : null
  await loadTrailers({ preserveFocusTrailerRel: playingRel ?? focusedRel })
}

let libraryRefreshChannel: BroadcastChannel | null = null
function onLibraryRefreshMessage(ev: MessageEvent) {
  const data = ev.data as { type?: string } | null
  if (!data || data.type !== 'library-refresh') return
  void refreshLibraryFromExternal()
}

async function selectSession(id: number, opts?: { preserveFocusTrailerRel?: string | null }) {
  if (id === sessionIndex.value) {
    const rel = typeof opts?.preserveFocusTrailerRel === 'string' ? opts.preserveFocusTrailerRel : ''
    if (rel) {
      focusEntryByTrailerRel(rel)
      await nextTick()
      requestAnimationFrame(() => {
        scrollCatalogGridToTrailerRel(rel)
      })
    }
    return
  }
  if (!sessions.value.some((s) => s.id === id)) return
  await flushMainProgressIfAny()
  clearPinnedTrailers()
  gridInlinePreviewIndex.value = null
  catalogGalleryIndex.value = null
  catalogTagFilter.value = null
  trailerTagPanelOpen.value = false
  shuffleForwardEnabled.value = false
  sequentialForwardOnceAfterPrev.value = false
  sessionIndex.value = id
  playerUrl.value = null
  activeIndex.value = null
  previewUrl.value = null
  await loadTrailers(opts)
}

/** Fallback quando não há URL nem entrada preservada: aleatório em desktop; primeiro item em Silk/Fire TV. */
function fallbackCatalogStartIndex(len: number): number {
  if (len <= 0) return 0
  if (isSilkTvLike.value) return 0
  return Math.floor(Math.random() * len)
}

async function loadTrailers(opts?: { preserveFocusTrailerRel?: string | null }) {
  if (!sessions.value.length) {
    fullEntries.value = []
    tagSuggestions.value = []
    focusedIndex.value = null
    gridInlinePreviewIndex.value = null
    catalogGalleryIndex.value = null
    serverPlatform.value = ''
    adminRevealExplorer.value = false
    catalogMode.value = 'trailers'
    recentPlaybackKeys.value = new Set()
    return
  }
  errorMsg.value = ''
  searchSessionError.value = ''
  loading.value = true
  gridInlinePreviewIndex.value = null
  catalogGalleryIndex.value = null
  const preserveRel =
    typeof opts?.preserveFocusTrailerRel === 'string' ? opts.preserveFocusTrailerRel : null
  const playingMainRel =
    playerUrl.value && activeIndex.value !== null && entries.value[activeIndex.value]
      ? entries.value[activeIndex.value].trailerRel
      : null
  const keepFullPlayback = Boolean(
    preserveRel && playingMainRel && playingMainRel === preserveRel,
  )
  const isSearchSession = sessionIndex.value === SEARCH_SESSION_ID
  const searchQ = searchSessionQuery.value.trim()
  const trailerUrl = isSearchSession
    ? searchQ.length >= 2
      ? `/api/library/search?q=${encodeURIComponent(searchQ)}&mode=${encodeURIComponent(searchSessionMode.value)}`
      : ''
    : sessionIndex.value === RECENTS_SESSION_ID
      ? '/api/trailers/recent'
      : `/api/trailers?session=${sessionIndex.value}`
  if (!trailerUrl) {
    fullEntries.value = []
    tagSuggestions.value = []
    focusedIndex.value = null
    playerUrl.value = null
    activeIndex.value = null
    previewUrl.value = null
    catalogMode.value = 'trailers'
    loading.value = false
    return
  }
  try {
    const data = await $fetch<{
      items: TrailerListEntry[]
      tagSuggestions?: string[]
      serverPlatform?: string
      adminRevealExplorer?: boolean
      catalogMode?: 'trailers' | 'main-only'
      fastPlay?: {
        rate?: number
        stepSeconds?: number
        windowSeconds?: number
        lastMinuteSeconds?: number
      }
    }>(trailerUrl)
    serverPlatform.value =
      typeof data.serverPlatform === 'string' ? data.serverPlatform : ''
    adminRevealExplorer.value = data.adminRevealExplorer === true
    if (data.fastPlay && typeof data.fastPlay === 'object') {
      const nRate = Number(data.fastPlay.rate)
      const nStep = Number(data.fastPlay.stepSeconds)
      const nWindow = Number(data.fastPlay.windowSeconds)
      const nLast = Number(data.fastPlay.lastMinuteSeconds)
      if (Number.isFinite(nRate) && nRate >= 0.5 && nRate <= 4) fastPlayRate.value = nRate
      if (Number.isFinite(nStep) && nStep >= 10 && nStep <= 600) {
        fastPlayStepSeconds.value = Math.round(nStep)
      }
      if (Number.isFinite(nWindow) && nWindow >= 2 && nWindow <= 120) {
        fastPlayWindowSeconds.value = Math.round(nWindow)
      }
      if (Number.isFinite(nLast) && nLast >= 10 && nLast <= 600) {
        fastPlayLastMinuteSeconds.value = Math.round(nLast)
      }
    }
    catalogMode.value =
      !isSearchSession && data.catalogMode === 'main-only' ? 'main-only' : 'trailers'
    fullEntries.value = data.items.map((e) => ({
      ...e,
      mainSizeBytes: e.mainSizeBytes ?? 0,
      mainSortTimeMs: e.mainSortTimeMs ?? 0,
    }))
    tagSuggestions.value = Array.isArray(data.tagSuggestions) ? data.tagSuggestions : []
    const tag = catalogTagFilter.value
    const filtered = tag
      ? fullEntries.value.filter((e) => (e.tags ?? []).includes(tag))
      : [...fullEntries.value]
    const list =
      sessionIndex.value === RECENTS_SESSION_ID || isSearchSession ? [...filtered] : sortCatalogList(filtered)

    const qSessionFromRoute = parseShareSessionQuery(route.query.session)
    const shareRelForThisSession =
      !preserveRel &&
      (qSessionFromRoute === null || qSessionFromRoute === sessionIndex.value)
        ? normalizeShareRelQuery(route.query.rel)
        : ''

    if (list.length) {
      if (preserveRel) {
        const ni = list.findIndex((e) => e.trailerRel === preserveRel)
        focusedIndex.value = ni >= 0 ? ni : fallbackCatalogStartIndex(list.length)
      } else if (shareRelForThisSession) {
        const ei = list.findIndex((e) => e.trailerRel === shareRelForThisSession)
        focusedIndex.value = ei >= 0 ? ei : fallbackCatalogStartIndex(list.length)
      } else {
        focusedIndex.value = fallbackCatalogStartIndex(list.length)
      }
    } else {
      focusedIndex.value = null
    }

    if (keepFullPlayback && preserveRel) {
      const ni = list.findIndex((e) => e.trailerRel === preserveRel)
      if (ni >= 0) {
        activeIndex.value = ni
        focusedIndex.value = ni
      } else {
        activeIndex.value = null
        playerUrl.value = null
        setPreviewForIndex(focusedIndex.value)
      }
    } else {
      activeIndex.value = null
      playerUrl.value = null
      setPreviewForIndex(focusedIndex.value)
    }

    if (list.length && focusedIndex.value !== null) {
      const tr = list[focusedIndex.value]?.trailerRel
      if (tr) {
        await nextTick()
        requestAnimationFrame(() => {
          scrollCatalogGridToTrailerRel(tr)
        })
      }
    }
    await refreshRecentPlaybackKeys()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; message?: string }
    fullEntries.value = []
    tagSuggestions.value = []
    if (isSearchSession) {
      searchSessionError.value =
        err?.data?.statusMessage || err?.message || 'Não foi possível executar a busca global.'
    } else {
      errorMsg.value =
        err?.data?.statusMessage || err?.message || 'Não foi possível carregar a lista de trailers.'
    }
  } finally {
    loading.value = false
  }
}

function routeQueryString(q: unknown): string {
  if (q === undefined || q === null) return ''
  if (Array.isArray(q)) return q[0] != null ? String(q[0]) : ''
  return String(q)
}

function normalizeShareRelQuery(raw: unknown): string {
  const t = routeQueryString(raw).trim().replace(/\\/g, '/')
  if (!t || t.includes('..')) return ''
  return t
}

function parseShareSessionQuery(raw: unknown): number | null {
  const s = routeQueryString(raw)
  if (s === '') return null
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n)) return null
  if (n === SEARCH_SESSION_ID) return n
  if (n === RECENTS_SESSION_ID) return n
  if (n < 0) return null
  return n
}

function focusEntryByTrailerRel(trailerRel: string): boolean {
  let ix = entries.value.findIndex((e) => e.trailerRel === trailerRel)
  if (ix < 0) {
    if (!fullEntries.value.some((e) => e.trailerRel === trailerRel)) return false
    catalogTagFilter.value = null
    ix = entries.value.findIndex((e) => e.trailerRel === trailerRel)
  }
  if (ix < 0) return false
  setTrailerIndex(ix)
  return true
}

function shareRouteQueryMatchesDesired(desired: Record<string, string>): boolean {
  const curS = routeQueryString(route.query.session)
  const curR = normalizeShareRelQuery(route.query.rel)
  const wantS = desired.session ?? ''
  const wantR = desired.rel ? normalizeShareRelQuery(desired.rel) : ''
  return curS === wantS && curR === wantR
}

/**
 * Query desejada: `session` sempre que há biblioteca; `rel` só no completo ou, em trailer,
 * quando o URL já traz `rel` e coincide com o título focado (link partilhado).
 * Ao sair do completo (`justClosedFull`), só `session` (remove `rel` imposto pelo completo).
 */
function buildDesiredShareQuery(justClosedFull: boolean): Record<string, string> {
  if (!sessions.value.length) return {}
  const sessionStr = String(sessionIndex.value)
  const isFull = Boolean(playerUrl.value && activeIndex.value !== null)

  if (isFull) {
    const e = entries.value[activeIndex.value!]
    if (!e) return { session: sessionStr }
    return { session: sessionStr, rel: e.trailerRel }
  }

  if (justClosedFull) {
    return { session: sessionStr }
  }

  const out: Record<string, string> = { session: sessionStr }
  const rr = normalizeShareRelQuery(route.query.rel)
  const fr =
    focusedIndex.value !== null ? entries.value[focusedIndex.value]?.trailerRel ?? '' : ''
  if (rr && fr && rr === fr) out.rel = rr
  return out
}

function syncShareUrlFromState() {
  if (suppressShareUrlSync) return
  if (!sessions.value.length) return

  const isFull = Boolean(playerUrl.value && activeIndex.value !== null)
  const wasFull = hadFullVideoForShareUrlRef.value

  if (isFull) hadFullVideoForShareUrlRef.value = true
  else if (wasFull) hadFullVideoForShareUrlRef.value = false

  const desired = buildDesiredShareQuery(wasFull && !isFull)
  if (shareRouteQueryMatchesDesired(desired)) return

  ignoreNextRouteQueryWatch = true
  void router
    .replace({ path: route.path, query: desired })
    .finally(() => {
      nextTick(() => {
        ignoreNextRouteQueryWatch = false
      })
    })
}

function catalogScrollRootEl(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector('.trailer-grid-scroll')
  return el instanceof HTMLElement ? el : null
}

/** Alíneas extra para cabeçalhos / chrome do browser (Silk no Fire TV quase não usa safe-area). */
function catalogScrollInsets(): { top: number; bottom: number } {
  return isSilkTvLike.value
    ? { top: 36, bottom: 28 }
    : { top: 12, bottom: 14 }
}

/** Coloca o tile visível dentro de `.trailer-grid-scroll` (sem rolar a página). */
function scrollCatalogGridToTrailerRel(trailerRel: string) {
  const scrollRoot = catalogScrollRootEl()
  if (!scrollRoot) return
  const tile = scrollRoot.querySelector(`[data-trailer-rel="${CSS.escape(trailerRel)}"]`)
  if (!(tile instanceof HTMLElement)) return

  const rootRect = scrollRoot.getBoundingClientRect()
  const tileRect = tile.getBoundingClientRect()
  const tileTop = tileRect.top - rootRect.top + scrollRoot.scrollTop
  const tileBottom = tileTop + tileRect.height
  const inset = catalogScrollInsets()
  const viewTop = scrollRoot.scrollTop
  const viewBottom = scrollRoot.scrollTop + scrollRoot.clientHeight
  const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)

  let nextTop = scrollRoot.scrollTop
  if (tileTop < viewTop + inset.top) {
    nextTop = Math.max(0, tileTop - inset.top)
  } else if (tileBottom > viewBottom - inset.bottom) {
    nextTop = Math.min(maxScroll, tileBottom - scrollRoot.clientHeight + inset.bottom)
  } else {
    return
  }

  scrollRoot.scrollTo({
    top: nextTop,
    behavior: isSilkTvLike.value ? 'auto' : 'smooth',
  })
}

/** Primeira linha da grelha + trailer índice 0 (útil em comando Fire TV / tecla Home). */
function scrollCatalogGridToTopAndFocusFirst() {
  if (!entries.value.length) return
  catalogGridCollapsed.value = false
  const scrollRoot = catalogScrollRootEl()
  scrollRoot?.scrollTo({ top: 0, behavior: 'auto' })
  playerUrl.value = null
  activeIndex.value = null
  setTrailerIndex(0)
}

async function applyShareQueryFromRoute() {
  const qSession = parseShareSessionQuery(route.query.session)
  const rel = normalizeShareRelQuery(route.query.rel)
  if (rel === '' && qSession === null) return

  suppressShareUrlSync = true
  try {
    if (
      qSession !== null &&
      sessions.value.some((s) => s.id === qSession) &&
      qSession !== sessionIndex.value
    ) {
      await flushMainProgressIfAny()
      gridInlinePreviewIndex.value = null
      catalogGalleryIndex.value = null
      catalogTagFilter.value = null
      trailerTagPanelOpen.value = false
      sessionIndex.value = qSession
      playerUrl.value = null
      activeIndex.value = null
      previewUrl.value = null
      await loadTrailers()
    }

    if (rel) {
      const playingRel =
        playerUrl.value && activeIndex.value !== null
          ? entries.value[activeIndex.value]?.trailerRel
          : null
      if (playerUrl.value && playingRel && playingRel !== rel) {
        await closeFullVideo()
      }

      const cur = focusedIndex.value !== null ? entries.value[focusedIndex.value]?.trailerRel : null
      if (cur !== rel) {
        if (!focusEntryByTrailerRel(rel)) {
          errorMsg.value = `Título não encontrado nesta biblioteca: ${rel}`
        }
      }
    }

    if (
      rel &&
      focusedIndex.value !== null &&
      entries.value[focusedIndex.value]?.trailerRel === rel
    ) {
      await nextTick()
      requestAnimationFrame(() => {
        scrollCatalogGridToTrailerRel(rel)
      })
    }
  } finally {
    suppressShareUrlSync = false
  }
}

watch(
  () => [route.query.session, route.query.rel],
  async () => {
    if (ignoreNextRouteQueryWatch) return
    if (!sessions.value.length) return
    await applyShareQueryFromRoute()
  },
)

watch([sessionIndex, focusedIndex, activeIndex, playerUrl], () => {
  syncShareUrlFromState()
}, { flush: 'post' })

watch(
  showTvCatalogScrollAssist,
  (on) => {
    if (!import.meta.client) return
    document.documentElement.classList.toggle('video-player-tv-catalog-assist', on)
  },
  { immediate: true },
)

onMounted(async () => {
  await loadSessions()
  if (sessions.value.length) {
    await loadTrailers()
    await applyShareQueryFromRoute()
    await nextTick()
    syncShareUrlFromState()
  }
  if (typeof window === 'undefined') return
  try {
    catalogGridCollapsed.value = sessionStorage.getItem(CATALOG_GRID_COLLAPSED_KEY) === '1'
  } catch {
    /* ignore */
  }
  try {
    const raw = sessionStorage.getItem(CATALOG_PANE_WIDTH_KEY)
    if (raw) {
      const n = Number.parseInt(raw, 10)
      if (Number.isFinite(n)) catalogPaneWidthPx.value = clampCatalogPaneWidth(n)
    }
  } catch {
    /* ignore */
  }
  window.addEventListener('resize', onWindowResizeClampCatalogPane)
  orientationMql = window.matchMedia('(orientation: landscape)')
  orientationMql.addEventListener('change', onLandscapeOrientationChange)
  desktopWidthMql = window.matchMedia('(min-width: 960px)')
  onDesktopWidthUiChange()
  desktopWidthMql.addEventListener('change', onDesktopWidthUiChange)
  document.addEventListener('keydown', onGlobalDocumentKeydown)
  document.addEventListener('fullscreenchange', onDocumentFullscreenChange)
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      libraryRefreshChannel = new BroadcastChannel('video-player-library')
      libraryRefreshChannel.addEventListener('message', onLibraryRefreshMessage)
    } catch {
      libraryRefreshChannel = null
    }
  }
})

onUnmounted(() => {
  stopFastPlay(false)
  void flushMainProgressIfAny()
  if (gridChromeLongTimer) {
    clearTimeout(gridChromeLongTimer)
    gridChromeLongTimer = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onGlobalDocumentKeydown)
    document.removeEventListener('fullscreenchange', onDocumentFullscreenChange)
    document.body.style.overflow = ''
    document.documentElement.classList.remove('video-player-tv-catalog-assist')
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onWindowResizeClampCatalogPane)
  }
  orientationMql?.removeEventListener('change', onLandscapeOrientationChange)
  desktopWidthMql?.removeEventListener('change', onDesktopWidthUiChange)
  if (libraryRefreshChannel) {
    try {
      libraryRefreshChannel.removeEventListener('message', onLibraryRefreshMessage)
      libraryRefreshChannel.close()
    } catch {
      /* ignore */
    }
    libraryRefreshChannel = null
  }
})
</script>

<style scoped>
.code {
  font-size: 0.85em;
  background: #2d333b;
  padding: 0.12rem 0.35rem;
  border-radius: 4px;
  color: #e8eaed;
}

.layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background: #0c0d10;
  color: #e8eaed;
  font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
  padding: clamp(0.5rem, 1.5vw, 1rem) clamp(0.4rem, 2vw, 1.75rem)
    calc(0.75rem + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
}

/** Silk / TV: menos margens; topo mínimo para o chrome do browser / safe-area. */
.layout--tv-silk {
  padding: 0.35rem 0.45rem calc(0.45rem + env(safe-area-inset-bottom, 0px));
  padding-top: max(0.35rem, env(safe-area-inset-top, 0px), 1.1rem);
}

@media (min-width: 960px) {
  /**
   * Ancorar à viewport evita que a cadeia flex/`min-height` do `#__nuxt` crie altura extra
   * e rolagem na página — o scroll fica só nas áreas internas (grelha, diálogos).
   */
  .layout {
    position: fixed;
    inset: 0;
    width: auto;
    max-width: none;
    height: auto;
    max-height: none;
    overflow: hidden;
    overscroll-behavior: none;
    padding-top: max(0.5rem, env(safe-area-inset-top, 0px));
  }

  .layout--tv-silk {
    padding: 0.3rem 0.5rem 0.35rem;
    padding-top: max(0.3rem, env(safe-area-inset-top, 0px), 0.95rem);
  }
}

.error {
  flex-shrink: 0;
  margin: 0 0 0.5rem;
  padding: 0.65rem 0.85rem;
  background: #3c1f1e;
  border: 1px solid #8b2e2a;
  border-radius: 8px;
  color: #f8b4b0;
  font-size: 0.85rem;
}

.toast {
  position: fixed;
  bottom: max(12px, env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  z-index: 99990;
  max-width: min(92vw, 22rem);
  padding: 0.52rem 0.92rem;
  border-radius: 10px;
  font-size: 0.865rem;
  font-weight: 500;
  line-height: 1.35;
  text-align: center;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.toast--success {
  background: rgba(38, 88, 58, 0.96);
  border: 1px solid rgba(100, 180, 130, 0.5);
  color: #eaf8ee;
}

.toast--error {
  background: rgba(88, 32, 32, 0.96);
  border: 1px solid rgba(220, 105, 100, 0.45);
  color: #ffe8e4;
}

.main-stack {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: none;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(0.65rem, 1.8vw, 1.15rem);
  align-items: stretch;
}

@media (min-width: 960px) {
  .main-stack {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, min(54vw, 1100px));
    grid-template-rows: minmax(0, 1fr);
    column-gap: clamp(0.85rem, 2.2vw, 2rem);
    row-gap: 0;
    align-items: stretch;
    align-content: stretch;
    transition: column-gap 0.2s ease;
  }

  /** Rail estreito: o player ocupa quase toda a largura. */
  .main-stack--catalog-collapsed {
    grid-template-columns: minmax(0, 1fr) 3.35rem;
    column-gap: 0.45rem;
  }

  .media-card {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    min-height: 0;
    max-height: none;
    height: 100%;
    flex: none;
    transition:
      min-width 0.2s ease,
      max-width 0.2s ease,
      padding 0.2s ease;
  }

  .sidebar--catalog-collapsed {
    width: 3.35rem;
    min-width: 3.35rem;
    max-width: 3.35rem;
    padding: 0.35rem 0.25rem;
    overflow: hidden;
  }

  .sidebar--catalog-collapsed .catalog-head {
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 0.45rem;
    padding: 0.25rem 0.1rem 0.35rem;
  }

  .sidebar--catalog-collapsed .list-heading {
    display: none;
  }

  .sidebar--catalog-collapsed .catalog-head-tools {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 0.45rem;
    width: 100%;
  }

  .sidebar--catalog-collapsed .catalog-sort {
    display: none;
  }

  .sidebar--catalog-collapsed .tag-filter-clear,
  .sidebar--catalog-collapsed .watched-filter-toggle,
  .sidebar--catalog-collapsed .watched-filter-toggle--fav {
    display: none;
  }

  .sidebar--catalog-collapsed .empty-hint,
  .sidebar--catalog-collapsed .loading {
    display: none !important;
  }

  /** Separador vídeo | catálogo (desktop, não-TV): colunas 1–player, 2–splitter, 3–sidebar */
  .main-stack--with-catalog-split .catalog-pane-splitter {
    grid-column: 2;
    grid-row: 1;
    align-self: stretch;
    justify-self: stretch;
    width: 100%;
    min-width: 0;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    position: relative;
    z-index: 2;
    border-radius: 6px;
  }

  .main-stack--with-catalog-split .catalog-pane-splitter::after {
    content: '';
    position: absolute;
    top: 8%;
    bottom: 8%;
    left: 50%;
    transform: translateX(-50%);
    width: 4px;
    border-radius: 3px;
    background: color-mix(in srgb, #8ab4f8 38%, #3c4043);
    pointer-events: none;
  }

  .main-stack--with-catalog-split .catalog-pane-splitter:hover::after,
  .main-stack--with-catalog-split .catalog-pane-splitter:focus-visible::after {
    background: color-mix(in srgb, #8ab4f8 72%, #5f6368);
  }

  .main-stack--with-catalog-split .catalog-pane-splitter:focus-visible {
    outline: 2px solid #8ab4f8;
    outline-offset: 2px;
  }

  .main-stack--with-catalog-split .sidebar {
    grid-column: 3;
  }
}

.sidebar {
  background: #1e2228;
  border: 1px solid #2d333b;
  border-radius: 12px;
  min-height: min(200px, 40dvh);
  flex: 1 1 auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  order: 2;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

@media (max-width: 959px) {
  .sidebar {
    min-height: clamp(220px, 38vh, 520px);
    max-height: min(72vh, 960px);
  }
}

.catalog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.45rem 0.65rem;
  flex-shrink: 0;
  padding: 0.5rem 0.75rem 0.35rem;
}

.catalog-search-row {
  width: 100%;
  display: flex;
  gap: 0.4rem;
}

.catalog-search-mode {
  border: 1px solid #3f6ea8;
  background: #13263f;
  color: #e8f3ff;
  border-radius: 8px;
  padding: 0.42rem 0.5rem;
  font: inherit;
  font-size: 0.82rem;
  min-width: 106px;
  flex: 0 0 auto;
}

.catalog-search-input {
  flex: 1;
  min-width: 0;
  background: #13263f;
  border: 1px solid #3f6ea8;
  color: #e8f3ff;
  border-radius: 8px;
  padding: 0.42rem 0.56rem;
  font: inherit;
  font-size: 0.84rem;
}

.catalog-search-btn {
  border: 1px solid #5c8fcd;
  background: #234c7c;
  color: #e8f3ff;
  border-radius: 8px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.42rem 0.66rem;
  cursor: pointer;
}

.catalog-search-error {
  width: 100%;
  font-size: 0.78rem;
  color: #f8b4b0;
}

.catalog-top-tags {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.1rem;
}

.catalog-top-tags-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7aa9e8;
  flex: 0 0 auto;
}

.catalog-top-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  min-width: 0;
}

.catalog-top-tag {
  border: 1px solid #3f6ea8;
  background: #1d3553;
  color: #cde3ff;
  border-radius: 999px;
  padding: 0.1rem 0.55rem;
  font: inherit;
  font-size: 0.74rem;
  cursor: pointer;
}

.catalog-top-tag--active {
  border-color: #7fb2f3;
  background: #2a5181;
  color: #eff6ff;
}

.catalog-head-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
  flex: 1 1 auto;
  min-width: 0;
}

.catalog-grid-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border-radius: 8px;
  border: 1px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}

.catalog-grid-toggle:hover {
  background: #2d333b;
  border-color: #5f6368;
  color: #f8f9fa;
}

.catalog-grid-toggle--collapsed {
  color: #bdc1c6;
  border-color: #3c4043;
  background: #1e2228;
}

.catalog-grid-toggle-svg {
  display: block;
  width: 17px;
  height: 17px;
}

.catalog-sort {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}

.catalog-sort-btn {
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.28rem 0.42rem;
  border-radius: 8px;
  border: 1px solid #454a53;
  background: #252a32;
  color: #bdc1c6;
  cursor: pointer;
  line-height: 1.2;
  -webkit-tap-highlight-color: transparent;
}

.catalog-sort-btn:hover {
  background: #2d333b;
  border-color: #5f6368;
  color: #e8eaed;
}

.catalog-sort-btn--active {
  border-color: #5f9dee;
  background: #2a3f5f;
  color: #e8f1ff;
}

.catalog-sort-dir {
  font-weight: 700;
  opacity: 0.95;
}

.catalog-top-btn {
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.32rem 0.55rem;
  border-radius: 8px;
  border: 1px solid #6b5a2a;
  background: #2a2415;
  color: #fdd663;
  cursor: pointer;
  line-height: 1.2;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}

.catalog-top-btn:hover {
  background: #3a3220;
  border-color: #8b752a;
}

.layout--tv-silk .grid-tile {
  scroll-margin-top: 1.75rem;
  scroll-margin-bottom: 0.65rem;
  content-visibility: visible;
  contain-intrinsic-size: unset;
}

.layout--tv-silk .grid-tile-thumb {
  touch-action: pan-y;
}

@media (pointer: coarse) {
  .trailer-grid-scroll {
    overflow-y: scroll;
    touch-action: pan-y;
    overscroll-behavior-y: contain;
  }

  .grid-tile-thumb {
    touch-action: pan-y;
  }

  .grid-tile {
    content-visibility: visible;
    contain-intrinsic-size: unset;
  }
}

.tag-filter-clear {
  flex-shrink: 0;
  font: inherit;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.28rem 0.45rem 0.28rem 0.55rem;
  border-radius: 999px;
  border: 1px solid #5f9dee;
  background: #2a3f5f;
  color: #e8f1ff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  -webkit-tap-highlight-color: transparent;
}

.tag-filter-clear:hover {
  background: #355a8a;
}

.tag-filter-clear-x {
  font-size: 0.95rem;
  line-height: 1;
  opacity: 0.9;
}

.watched-filter-toggle {
  flex-shrink: 0;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  border: 1px solid #454a53;
  background: #1d2026;
  color: #bdc1c6;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}

.watched-filter-toggle:hover:not(:disabled) {
  background: #2a2f37;
  color: #e8eaed;
}

.watched-filter-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.watched-filter-toggle--on {
  background: #2e2510;
  border-color: #b78a2a;
  color: #fbe293;
}

.watched-filter-toggle--on:hover:not(:disabled) {
  background: #3a2f15;
  color: #ffe7a3;
}

.watched-filter-toggle--fav.watched-filter-toggle--on {
  background: #1f3252;
  border-color: #5f9dee;
  color: #d8eaff;
}

.watched-filter-toggle--fav.watched-filter-toggle--on:hover:not(:disabled) {
  background: #274169;
  color: #e7f2ff;
}

.watched-filter-toggle-svg {
  width: 0.95rem;
  height: 0.95rem;
}

.watched-filter-count {
  font-size: 0.68rem;
  padding: 0 0.32rem;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 18%, transparent);
  font-variant-numeric: tabular-nums;
}

.empty-hint-link {
  display: block;
  margin-top: 0.65rem;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  color: #8ab4d9;
  background: transparent;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.empty-hint-link:hover {
  color: #c8e4ff;
}

.list-heading {
  flex: 1;
  min-width: 0;
  padding: 0;
  margin: 0;
}

.empty-hint,
.loading {
  padding: 1.25rem;
  color: #9aa0a6;
  font-size: 0.9rem;
}

.trailer-grid-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  padding: 0 clamp(0.35rem, 1.2vw, 0.65rem) 0.5rem;
}

.catalog-grid-scroll-wrap {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
}

.catalog-scroll-assist {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 6px 6px 4px;
  justify-content: center;
  align-self: stretch;
  border-left: 1px solid #2d333b;
  background: linear-gradient(180deg, #16181d 0%, #121418 100%);
}

.catalog-scroll-assist-btn {
  flex: 1;
  min-height: 88px;
  width: clamp(52px, 12vw, 64px);
  margin: 0;
  padding: 0;
  border-radius: 10px;
  border: 2px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.catalog-scroll-assist-btn:active {
  background: #3a4250;
  border-color: #8ab4f8;
}

.trailer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 148px), 1fr));
  gap: clamp(0.5rem, 1.4vw, 0.85rem);
}

@media (min-width: 480px) {
  .trailer-grid {
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  }
}

@media (min-width: 768px) {
  .trailer-grid {
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 0.75rem;
  }
}

@media (min-width: 960px) {
  .trailer-grid {
    grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
    gap: 0.8rem;
  }
}

@media (min-width: 1400px) {
  .trailer-grid {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 0.9rem;
  }
}

@media (min-width: 1800px) {
  .trailer-grid {
    grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
    gap: 1rem;
  }
}

.grid-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  margin: 0;
  padding: clamp(0.45rem, 1.1vw, 0.65rem);
  border: 1px solid #2d333b;
  border-radius: 10px;
  background: #15171c;
  color: inherit;
  font: inherit;
  text-align: center;
  cursor: default;
  content-visibility: auto;
  contain-intrinsic-size: auto 240px;
  transition:
    background 0.12s,
    border-color 0.12s,
    box-shadow 0.12s;
  -webkit-tap-highlight-color: transparent;
}

.grid-tile--fav {
  border-color: color-mix(in srgb, #fcc934 40%, #2d333b);
}

.fav-btn {
  border: 1px solid #454a53;
  background: #252a32;
  color: #bdc1c6;
  border-radius: 10px;
  font-size: 1.12rem;
  line-height: 1;
  padding: 0.32rem 0.5rem;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}

.fav-btn:hover {
  background: #2d333b;
  color: #e8eaed;
}

.fav-btn--on {
  color: #fcc934;
  border-color: #6b5a2a;
  background: #2a2415;
}

.fav-btn--on:hover {
  color: #ffd666;
}

.fav-btn--tile {
  position: absolute;
  top: 0.3rem;
  right: 0.3rem;
  z-index: 3;
  padding: 0.18rem 0.36rem;
  font-size: 0.95rem;
}

.grid-tile-remove-recents {
  position: absolute;
  top: 2.62rem;
  right: 0.3rem;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.72rem;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(22, 26, 30, 0.88);
  color: #c5cad3;
}

.grid-tile-remove-recents:hover:not(:disabled) {
  color: #fff;
  background: rgba(55, 40, 40, 0.92);
  border-color: rgba(240, 150, 120, 0.4);
}

.grid-tile-remove-recents:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.grid-tile-remove-recents-svg {
  width: 1.02rem;
  height: 1.02rem;
  display: block;
}

.watch-badge {
  position: absolute;
  top: 0.3rem;
  left: 0.3rem;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0.18rem;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.4);
  background: rgba(20, 24, 28, 0.78);
  color: #e3e5e8;
  pointer-events: auto;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.watch-badge svg {
  width: 100%;
  height: 100%;
  display: block;
}

.watch-badge--done {
  background: #1a3a23;
  border-color: #2c8c4a;
  color: #81c995;
}

.watch-badge--partial {
  background: #3a2e10;
  border-color: #c79318;
  color: #fcc934;
}

.watch-badge--trailer {
  background: #15263d;
  border-color: #2f6cb6;
  color: #5f9dee;
}

.watch-badge--memorable {
  background: #2e2510;
  border-color: #b78a2a;
  color: #fbe293;
  box-shadow: 0 0 0 1px color-mix(in srgb, #fbe293 18%, transparent);
}

.fav-btn--toolbar {
  flex-shrink: 0;
  min-height: 46px;
  min-width: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.toolbar-trailer-row {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0.5rem;
  width: 100%;
}

.toolbar-trailer-row .preview-btn {
  flex: 1;
  min-width: min(100%, 140px);
}

.toolbar-tags {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-top: 0.15rem;
  border-top: 1px solid #2d333b;
  margin-top: 0.35rem;
}

.tag-field-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #9aa0a6;
  font-weight: 600;
}

.tag-input-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}

.tag-input {
  flex: 1;
  min-width: 120px;
  font: inherit;
  font-size: 0.85rem;
  padding: 0.42rem 0.55rem;
  border-radius: 8px;
  border: 1px solid #3c4043;
  background: #15171c;
  color: #e8eaed;
}

.tag-input::placeholder {
  color: #5f6368;
}

.tag-input:focus {
  outline: 2px solid #5f9dee;
  outline-offset: 0;
  border-color: #5f9dee;
}

.tag-add-btn {
  flex-shrink: 0;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.42rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tag-add-btn:hover {
  background: #2d333b;
}

.tag-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  max-width: 100%;
  font: inherit;
  font-size: 0.72rem;
  padding: 0.2rem 0.38rem 0.2rem 0.45rem;
  border-radius: 999px;
  border: 1px solid #3d4f63;
  background: #1a2430;
  color: #b8d4f0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tag-chip:hover {
  border-color: #5f9dee;
  background: #243044;
  color: #e8f1ff;
}

.tag-chip--active {
  border-color: #fcc934;
  color: #ffe7a3;
  background: #2a2415;
}

.tag-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}

.grid-tile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
  justify-content: center;
  margin-top: 0.15rem;
  max-width: 100%;
}

.grid-tile-tag {
  font-size: 0.58rem;
  font-weight: 600;
  padding: 0.08rem 0.28rem;
  border-radius: 4px;
  background: #1a2430;
  color: #8ab4d9;
  border: 1px solid #2d3d4d;
  max-width: 5.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-tile-tag--more {
  color: #9aa0a6;
  background: #252a32;
  border-color: #3c4043;
  max-width: none;
}

.grid-tile-tag--active {
  border-color: #fcc934;
  color: #ffe7a3;
  background: #2a2415;
}

.grid-tile:has(.grid-tile-select:hover) {
  background: #1e2228;
  border-color: #3c4043;
}

.grid-tile--selected {
  border-color: #5f9dee;
  box-shadow: 0 0 0 1px #5f9dee;
}

.grid-tile--full {
  background: #1a2418;
  border-color: #81c995;
}

.grid-tile--no-main {
  opacity: 0.88;
}

.grid-tile-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  min-height: 68px;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
  flex-shrink: 0;
  touch-action: manipulation;
  user-select: none;
  -webkit-touch-callout: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Desktop: só `aspect-ratio` define a altura — evita distorção ao fazer scroll na grelha. */
@media (min-width: 768px) {
  .grid-tile-thumb {
    min-height: 0;
    max-height: none;
  }

  .grid-tile {
    content-visibility: visible;
    contain-intrinsic-size: unset;
  }
}

/* Em viewports estreitos limita só o excesso; a largura da célula manda no tamanho. */
@media (max-width: 479px) {
  .grid-tile-thumb {
    max-height: min(40vw, 160px);
  }
}

.grid-tile-thumb--empty {
  cursor: default;
  pointer-events: none;
}

.grid-tile-thumb:focus-visible {
  outline: 2px solid #5f9dee;
  outline-offset: 2px;
}

.grid-inline-preview-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.catalog-thumb-placeholder {
  width: 100%;
  height: 100%;
  min-height: 100%;
  background: linear-gradient(135deg, #12141a 0%, #1a1d24 50%, #12141a 100%);
}

.grid-tile-select {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  width: 100%;
  margin: 0;
  padding: 0.45rem 0.15rem 0.2rem;
  min-width: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.grid-tile-select:hover {
  background: color-mix(in srgb, #5f9dee 10%, transparent);
}

.grid-tile-select:focus-visible {
  outline: 2px solid #5f9dee;
  outline-offset: 2px;
}

.grid-tile-label {
  font-size: clamp(0.76rem, calc(0.65rem + 0.55vw), 0.92rem);
  line-height: 1.25;
  color: #e3e5e8;
  display: block;
  width: 100%;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.grid-tile-recents-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  width: 100%;
  min-width: 0;
  margin-bottom: 0.08rem;
}

.grid-tile-recents-tag {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #fdd663;
  padding: 0.06rem 0.28rem;
  border-radius: 4px;
  background: rgba(253, 214, 99, 0.12);
  border: 1px solid rgba(253, 214, 99, 0.35);
}

.grid-tile-recents-lib {
  font-size: 0.62rem;
  font-weight: 600;
  color: #9db9e8;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #f9ab00;
  font-weight: 600;
}

.badge--tile {
  margin-top: 0.05rem;
}

.media-card {
  display: flex;
  flex-direction: column;
  gap: clamp(0.5rem, 1.2vw, 0.75rem);
  min-height: 0;
  order: 1;
  background: #0d0e10;
  border: 1px solid #2d333b;
  border-radius: 12px;
  padding: clamp(0.55rem, 1.4vw, 0.85rem) clamp(0.55rem, 1.6vw, 1rem) 0.75rem;
}

.panel-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9aa0a6;
  margin: 0;
  font-weight: 600;
}

.media-card-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.25rem;
  flex-shrink: 0;
}

.menu-btn {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid #3c4043;
  background: #1e2228;
  color: #e8eaed;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

.menu-btn:hover {
  background: #252a32;
  border-color: #5f6368;
}

.menu-btn-bars {
  display: block;
  width: 18px;
  height: 2px;
  background: currentColor;
  border-radius: 1px;
  box-shadow: 0 -6px 0 currentColor, 0 6px 0 currentColor;
}

.media-card-filename {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: clamp(0.82rem, 1.1vw, 0.98rem);
  font-weight: 600;
  color: #e8eaed;
  line-height: 1.3;
  text-align: left;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-height: 2.8em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.media-card-filename--empty {
  min-height: 1.25rem;
}

.media-card-folder {
  color: #bdc1c6;
  font-weight: 600;
}

.media-card-playback-name-row {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  width: 100%;
  min-width: 0;
}

.media-card-playback-name-row .media-card-playback-video-name {
  flex: 1;
  width: auto;
}

.icon-tool--reveal-explorer {
  flex-shrink: 0;
  margin-top: 0.06rem;
}

.media-card-playback-video-name {
  margin: 0;
  width: 100%;
  min-width: 0;
  font-size: clamp(0.75rem, 1vw, 0.88rem);
  font-weight: 500;
  color: #e8eaed;
  line-height: 1.35;
  text-align: left;
  word-break: break-word;
  overflow-wrap: anywhere;
  padding-top: 0.1rem;
}

.media-card-playback-video-size {
  display: inline-block;
  margin-right: 0.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  background: rgba(138, 180, 248, 0.18);
  color: #8ab4f8;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-size: 0.85em;
  white-space: nowrap;
}

.session-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 240;
  background: rgba(0, 0, 0, 0.55);
}

.session-menu-panel {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 241;
  width: min(380px, 94vw);
  max-width: 100%;
  background: #1a1d22;
  border-right: 1px solid #2d333b;
  box-shadow: 8px 0 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  padding: env(safe-area-inset-top, 0) 0 env(safe-area-inset-bottom, 0) 0;
}

.session-menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.85rem 0.9rem;
  border-bottom: 1px solid #2d333b;
  flex-shrink: 0;
}

.session-menu-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #e8eaed;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.session-menu-close {
  border: none;
  background: transparent;
  color: #9aa0a6;
  font-size: 1.8rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.3rem 0.55rem;
  border-radius: 8px;
}

.session-menu-close:hover {
  color: #e8eaed;
  background: #2d333b;
}

.session-menu-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.85rem 0.8rem;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.session-menu-item {
  font: inherit;
  font-size: 1rem;
  font-weight: 600;
  text-align: left;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  border: 1px solid #3c4043;
  background: #1e2228;
  color: #bdc1c6;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  line-height: 1.35;
  min-height: 3rem;
  -webkit-tap-highlight-color: transparent;
}

.session-menu-item-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

@media (pointer: coarse) {
  .session-menu-panel {
    width: min(430px, 96vw);
  }

  .session-menu-item {
    font-size: 1.05rem;
    padding: 0.88rem 0.95rem;
    min-height: 3.4rem;
  }
}

.session-menu-item-eye {
  width: 1rem;
  height: 1rem;
  flex: 0 0 auto;
  color: #fdd663;
}

.session-menu-item:hover {
  background: #252a32;
  color: #e8eaed;
}

.session-menu-item--active {
  background: #2a3f5f;
  border-color: #5f9dee;
  color: #e8f1ff;
}

.session-menu-item--active .session-menu-item-eye {
  color: #ffe082;
}

.move-title-backdrop {
  position: fixed;
  inset: 0;
  z-index: 243;
  background: rgba(0, 0, 0, 0.55);
}

.move-title-dialog {
  position: fixed;
  inset: 0;
  z-index: 244;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  pointer-events: none;
}

.move-title-dialog-card {
  pointer-events: auto;
  width: min(400px, 94vw);
  max-height: min(72vh, 520px);
  display: flex;
  flex-direction: column;
  background: #1a1d22;
  border: 1px solid #2d333b;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.move-title-dialog-hint {
  margin: 0;
  padding: 0 0.75rem 0.5rem;
  font-size: 0.82rem;
  line-height: 1.45;
  color: #9aa0a6;
}

.move-title-dialog-err {
  margin: 0;
  padding: 0 0.75rem 0.5rem;
  font-size: 0.82rem;
  color: #f8b4b0;
}

.move-title-dialog-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem 0.65rem;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.move-title-dialog-busy {
  margin: 0;
  padding: 0 0.75rem 0.65rem;
  font-size: 0.8rem;
  color: #8ab4d9;
}

.icon-tool--move-library {
  color: #9aa0a6;
}

.catalog-gallery-dialog {
  position: fixed;
  inset: 0;
  z-index: 280;
  background: rgba(4, 5, 8, 0.96);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: max(0.35rem, env(safe-area-inset-top)) max(0.35rem, env(safe-area-inset-right))
    max(0.35rem, env(safe-area-inset-bottom)) max(0.35rem, env(safe-area-inset-left));
  box-sizing: border-box;
}

.catalog-gallery-body {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: clamp(0.45rem, 1.5vw, 0.75rem);
  padding-top: max(2.85rem, calc(env(safe-area-inset-top, 0px) + 2.25rem));
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.catalog-gallery-stack {
  display: grid;
  grid-template-columns: 1fr;
  gap: clamp(6px, 1.5vw, 14px);
  width: 100%;
  flex: 1;
  min-height: 0;
  align-items: start;
}

@media (min-width: 768px) {
  .catalog-gallery-stack {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.catalog-gallery-img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  object-position: center;
  background: #050608;
  border-radius: clamp(6px, 1.2vw, 10px);
  min-width: 0;
}

.catalog-gallery-caption {
  margin: 0;
  flex-shrink: 0;
  font-size: clamp(0.88rem, 2.8vw, 1.05rem);
  font-weight: 600;
  color: #e8eaed;
  text-align: center;
  max-width: 100%;
  padding: 0 0.25rem;
  line-height: 1.3;
}

.catalog-gallery-close {
  position: absolute;
  top: max(0.5rem, env(safe-area-inset-top));
  right: max(0.5rem, env(safe-area-inset-right));
  z-index: 2;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 1px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.catalog-gallery-close:hover {
  background: #3c4043;
}

.grid-tile-maxi {
  position: absolute;
  bottom: 4px;
  left: 4px;
  z-index: 4;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(8, 9, 12, 0.72);
  color: #e8eaed;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

.grid-tile-maxi:hover {
  background: rgba(30, 34, 40, 0.92);
  border-color: #5f9dee;
}

.grid-tile-maxi-svg {
  width: 18px;
  height: 18px;
}

.video-shell {
  background: #000;
  border-radius: 10px;
  border: 1px solid #2d333b;
  width: 100%;
  max-width: 100%;
  margin-inline: auto;
  aspect-ratio: 16 / 9;
  max-height: min(52vh, 520px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* Trailer único: o contentor de fullscreen tem de ocupar todo o 16:9 (senão requestFullscreen no div falha). */
.video-shell:not(.video-shell--with-pins) {
  align-items: stretch;
}

.video-shell--with-pins {
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  aspect-ratio: auto;
  gap: 8px;
  padding: 8px;
  max-height: min(78vh, 960px);
  min-height: 0;
  overflow: auto;
}

.video-shell-main {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: min(52vh, 560px);
  margin-inline: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 8px;
  border: 1px solid #2d333b;
  overflow: hidden;
}

/* Sempre em coluna: grelha em cima, fixos um por baixo do outro, com scroll no .video-shell--with-pins. */
.video-shell-pinned-row {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 8px;
  flex: 0 0 auto;
  width: 100%;
  min-height: 0;
  align-items: stretch;
  justify-content: flex-start;
}

.video-shell-pane {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a0c;
  border-radius: 8px;
  border: 1px solid #2d333b;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  max-height: none;
}

.video-shell-pane-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #e8eaed;
  background: rgba(8, 9, 12, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 0.2rem 0.45rem;
  border-radius: 6px;
  pointer-events: none;
}

.video-shell-pane-badge--main {
  left: auto;
  right: 6px;
  border-color: rgba(90, 145, 240, 0.45);
  color: #b8d4ff;
}

@media (max-width: 640px) {
  .video-shell-pane {
    /* Ecrã estreito: evita blocos 16/9 demasiado altos */
    max-height: min(52vw, 280px);
  }

  .video-shell-pane-badge--main {
    left: 6px;
    right: auto;
  }
}

@media (max-width: 959px) {
  .video-shell {
    max-height: min(50vh, 560px);
  }
}

@media (min-width: 960px) {
  .video-shell {
    flex: 0 1 auto;
    width: 100%;
    max-height: min(calc(100dvh - 10.5rem), 78dvh, 960px);
  }

  /* Ocupa a altura disponível na media-card e faz scroll quando há grelha + fixos empilhados. */
  .video-shell--with-pins {
    flex: 1 1 auto;
    min-height: 0;
    align-self: stretch;
    max-height: min(calc(100dvh - 9rem), 84dvh, 980px);
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }

  /** Catálogo recolhido: mesma largura em todas as colunas → players com o mesmo tamanho (16/9 idêntico). */
  .video-shell--with-pins.video-shell--catalog-collapsed-layout {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto;
    align-items: center;
    justify-items: stretch;
    overflow: hidden;
    min-height: clamp(240px, 42dvh, 680px);
    max-height: min(calc(100dvh - 8.5rem), 72dvh, 920px);
  }

  .video-shell--with-pins.video-shell--catalog-collapsed-layout.video-shell--slot-count-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .video-shell--with-pins.video-shell--catalog-collapsed-layout .video-shell-pinned-row {
    display: contents;
  }

  .video-shell--with-pins.video-shell--catalog-collapsed-layout .video-shell-main,
  .video-shell--with-pins.video-shell--catalog-collapsed-layout .video-shell-pane {
    width: 100%;
    min-width: 0;
    margin-inline: 0;
    aspect-ratio: 16 / 9;
    height: auto;
    max-height: min(calc(100dvh - 10rem), 62dvh, 860px);
    align-self: center;
    justify-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }

  /** Vista em coluna (catálogo aberto): mesmo teto para grelha e fixos — antes só o main tinha max-height. */
  .video-shell--with-pins:not(.video-shell--catalog-collapsed-layout) .video-shell-main,
  .video-shell--with-pins:not(.video-shell--catalog-collapsed-layout) .video-shell-pane {
    max-height: min(calc(100dvh - 18rem), 52dvh, 680px);
  }

  .video-shell-main {
    max-height: min(calc(100dvh - 22rem), 58dvh, 720px);
  }
}

@media (min-width: 1400px) {
  .video-shell {
    max-height: min(calc(100dvh - 10rem), 80dvh, 1080px);
  }

  .video-shell--with-pins:not(.video-shell--catalog-collapsed-layout) {
    max-height: min(calc(100dvh - 8.5rem), 86dvh, 1040px);
  }

  .video-shell--with-pins.video-shell--catalog-collapsed-layout {
    max-height: min(calc(100dvh - 8rem), 72dvh, 980px);
  }
}

/* Silk (Fire TV): ~2× área útil do vídeo, coluna do catálogo ~½, sem chips/listas de tags. */
.layout--tv-silk .toolbar-full-tags,
.layout--tv-silk .grid-tile-tags,
.layout--tv-silk .catalog-top-tags {
  display: none !important;
}

.layout--tv-silk .video-shell-pane-badge {
  display: none !important;
}

.layout--tv-silk .main-stack {
  gap: 0.35rem;
}

.layout--tv-silk .media-card {
  gap: 0.35rem;
  padding: 0.4rem 0.45rem 0.45rem;
  border-radius: 10px;
}

.layout--tv-silk .media-card-top {
  min-height: 1.6rem;
  gap: 0.35rem;
}

.layout--tv-silk .toolbar {
  gap: 0.35rem;
}

.layout--tv-silk .toolbar--trailer-compact {
  gap: 0.28rem;
}

.layout--tv-silk .toolbar-trailer-icons {
  gap: 0.28rem;
}

.layout--tv-silk .catalog-head {
  padding: 0.28rem 0.45rem 0.18rem;
  gap: 0.28rem 0.4rem;
}

.layout--tv-silk .trailer-grid-scroll {
  padding: 0 0.12rem 0.28rem;
}

.layout--tv-silk .catalog-scroll-assist {
  padding: 0.4rem 0.32rem;
  gap: 0.55rem;
  justify-content: stretch;
  align-items: stretch;
  width: clamp(60px, 12vw, 86px);
  min-width: clamp(60px, 12vw, 86px);
}

.layout--tv-silk .catalog-scroll-assist-btn {
  flex: 1 1 0;
  min-height: 6.5rem;
  width: 100%;
  max-width: none;
  font-size: clamp(1.6rem, 4.2vw, 2.4rem);
  border-radius: 12px;
}

.layout--tv-silk .video-shell--with-pins {
  gap: 5px;
  padding: 5px;
}

.layout--tv-silk .media-card-playback-name-row {
  gap: 0.3rem;
}

.layout--tv-silk .toolbar--full-main {
  gap: 0.35rem;
}

.layout--tv-silk .video-shell {
  max-height: min(88vh, 1040px);
}

@media (max-width: 959px) {
  .layout--tv-silk .video-shell {
    max-height: min(72vh, 800px);
  }
}

@media (min-width: 960px) {
  .layout--tv-silk .main-stack:not(.main-stack--catalog-collapsed) {
    grid-template-columns: minmax(0, 1fr) minmax(140px, min(27vw, 550px));
    column-gap: 0.35rem;
  }

  .layout--tv-silk .main-stack--catalog-collapsed {
    column-gap: 0.28rem;
  }

  .layout--tv-silk .video-shell {
    max-height: min(calc(100dvh - 3.25rem), 92dvh, min(1920px, 100dvh));
  }

  .layout--tv-silk .video-shell--with-pins {
    max-height: min(calc(100dvh - 2.75rem), 94dvh, min(1920px, 100dvh));
  }

  .layout--tv-silk .video-shell--with-pins.video-shell--catalog-collapsed-layout {
    max-height: min(calc(100dvh - 5rem), 82dvh, 1200px);
  }

  .layout--tv-silk
    .video-shell--with-pins.video-shell--catalog-collapsed-layout
    .video-shell-main,
  .layout--tv-silk
    .video-shell--with-pins.video-shell--catalog-collapsed-layout
    .video-shell-pane {
    max-height: min(calc(100dvh - 5.75rem), 74dvh, 1040px);
  }

  .layout--tv-silk .video-shell--with-pins:not(.video-shell--catalog-collapsed-layout) .video-shell-main,
  .layout--tv-silk .video-shell--with-pins:not(.video-shell--catalog-collapsed-layout) .video-shell-pane {
    max-height: min(calc(100dvh - 9.5rem), 76dvh, 1040px);
  }

  .layout--tv-silk .video-shell-main {
    max-height: min(calc(100dvh - 6rem), 90dvh, min(1920px, 100dvh));
  }
}

@media (min-width: 1400px) {
  .layout--tv-silk .video-shell {
    max-height: min(calc(100dvh - 3rem), 94dvh, min(1920px, 100dvh));
  }

  .layout--tv-silk .video-shell--with-pins:not(.video-shell--catalog-collapsed-layout) {
    max-height: min(calc(100dvh - 3.5rem), 94dvh, min(1920px, 100dvh));
  }

  .layout--tv-silk .video-shell--with-pins.video-shell--catalog-collapsed-layout {
    max-height: min(calc(100dvh - 5rem), 82dvh, 1200px);
  }
}

.stage-fullscreen-wrap {
  position: relative;
  align-self: stretch;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-shell-main .stage-fullscreen-wrap {
  flex: 1 1 auto;
  min-height: 0;
}

.stage-fullscreen-trailer-actions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  padding: 0.65rem 0.85rem 0.85rem;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.72), transparent);
}

.stage-fullscreen-trailer-btn {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(12, 13, 16, 0.88);
  color: #e8eaed;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.stage-fullscreen-trailer-btn:hover {
  background: rgba(30, 33, 40, 0.95);
  border-color: rgba(95, 157, 238, 0.55);
}

.stage-fullscreen-trailer-btn-ico {
  width: 1.15rem;
  height: 1.15rem;
  flex-shrink: 0;
  opacity: 0.95;
}

.stage-video {
  width: 100%;
  height: 100%;
  max-height: inherit;
  object-fit: contain;
  vertical-align: bottom;
  display: block;
}

.stage-video--fast-play {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Reforço WebKit: alguns browsers ainda injectam UI em fullscreen após seek. */
.stage-video--fast-play::-webkit-media-controls,
.stage-video--fast-play::-webkit-media-controls-enclosure,
.stage-video--fast-play::-webkit-media-controls-panel {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none;
}

.stage-video:not(.stage-video--fast-play)::-webkit-media-controls-panel {
  min-height: 44px;
}

.preview-placeholder {
  color: #5f6368;
  font-size: 0.88rem;
  line-height: 1.45;
  padding: 1rem;
  text-align: center;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  flex-shrink: 0;
}

.toolbar--trailer-compact {
  gap: 0.45rem;
}

.toolbar-trailer-icons {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 0.35rem;
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 2px;
}

.icon-tool {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  min-width: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  border: 1px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s, border-color 0.12s, transform 0.08s;
}

.icon-tool:hover:not(:disabled) {
  background: #2d333b;
  border-color: #5f6368;
}

.icon-tool:active:not(:disabled) {
  transform: scale(0.96);
}

.icon-tool:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-tool--fav {
  font-size: 1.15rem;
}

.icon-tool--fav-on {
  color: #fcc934;
  border-color: #6b5a2a;
  background: #2a2415;
}

.icon-tool--memorable {
  color: #d4b878;
}

.icon-tool--memorable:hover:not(:disabled) {
  color: #f1d188;
}

.icon-tool--memorable-on {
  color: #fbe293;
  border-color: #b78a2a;
  background: #2e2510;
}

.icon-tool--memorable-on:hover:not(:disabled) {
  color: #ffe7a3;
}

.icon-tool--recents-on {
  color: #9ec5f0;
  border-color: #4a6888;
  background: #1a2734;
}

.icon-tool--recents-on:hover:not(:disabled) {
  color: #c5ddf5;
}

.icon-tool--primary {
  background: #1a73e8;
  border-color: #1a73e8;
  color: #fff;
}

.icon-tool--primary:hover:not(:disabled) {
  background: #1967d2;
}

.icon-tool--danger {
  background: #3c1f1e;
  border-color: #8b2e2a;
  color: #f8b4b0;
}

.icon-tool--danger:hover:not(:disabled) {
  background: #4a2523;
  color: #fff;
}

.icon-tool--on {
  border-color: #5f9dee;
  background: #2a3f5f;
  color: #e8f1ff;
}

.icon-tool--fast-play {
  min-width: 44px;
  padding: 0 0.35rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.icon-tool--at-cap {
  border-color: #f9ab00;
  background: #2a2415;
  color: #ffe7a3;
}

.icon-tool--at-cap:hover:not(:disabled) {
  border-color: #fcc934;
  background: #332a12;
  color: #fff8e1;
}

.icon-svg {
  width: 20px;
  height: 20px;
  display: block;
}

.toolbar-tags-panel {
  width: 100%;
  padding-top: 0.35rem;
  border-top: 1px solid #2d333b;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.toolbar--full-compact {
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.toolbar--full-main {
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
}

.toolbar-full-main-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
}

/* Silk/Fire TV: evita o bloco de velocidade "escapar" à direita em toolbars muito cheias. */
.layout--tv-silk .toolbar-full-main-row {
  flex-wrap: wrap;
  row-gap: 0.35rem;
}

.layout--tv-silk .toolbar-full-main-row > .rate-block--inline {
  flex: 1 1 100%;
  width: 100%;
  max-width: 100%;
  justify-content: flex-start;
  gap: 0.35rem;
  order: 100;
  padding-top: 0.35rem;
  margin-top: 0.05rem;
  border-top: 1px solid #2d333b;
}

.layout--tv-silk .toolbar-full-main-row > .rate-block--inline .rate-select--compact {
  flex: 0 1 auto;
  min-width: 3.6rem;
  max-width: min(44vw, 7rem);
}

.toolbar-full-tags {
  width: 100%;
  min-width: 0;
  padding-top: 0.35rem;
  border-top: 1px solid #2d333b;
}

.rate-block--inline {
  flex: 0 0 auto;
  min-width: 0;
  justify-content: flex-end;
  flex-wrap: nowrap;
  gap: 0.45rem;
}

.rate-label--compact {
  font-size: 0.78rem;
  font-weight: 600;
  color: #bdc1c6;
  white-space: nowrap;
}

.rate-select--compact {
  min-height: 36px;
  min-width: 4.25rem;
  max-width: 7rem;
  padding: 0.26rem 0.42rem;
  font-size: 0.82rem;
  font-weight: 600;
  border-radius: 9px;
}

.preview-btn {
  flex: 1;
  min-height: 46px;
  padding: 0.55rem 0.85rem;
  border-radius: 10px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, transform 0.08s;
  -webkit-tap-highlight-color: transparent;
}

.preview-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.preview-btn-next {
  background: #2d333b;
  border-color: #3c4043;
  color: #e8eaed;
}

.preview-btn-next:hover:not(:disabled) {
  background: #3c4043;
}

.preview-btn-back {
  background: #252a32;
  border-color: #454a53;
  color: #e8eaed;
}

.preview-btn-back:hover:not(:disabled) {
  background: #2d333b;
}

.preview-btn-open {
  background: #1a73e8;
  border-color: #1a73e8;
  color: #fff;
}

.preview-btn-open:hover:not(:disabled) {
  background: #1967d2;
}

.preview-btn-delete {
  flex: 1;
  min-width: min(100%, 120px);
  background: #3c1f1e;
  border-color: #8b2e2a;
  color: #f8b4b0;
}

.preview-btn-delete:hover:not(:disabled) {
  background: #4a2523;
  border-color: #a63a35;
  color: #fff;
}

.preview-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar--full {
  gap: 0.65rem;
  background: #1a1d24;
  border: 1px solid #2d333b;
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
}

.rate-block {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.rate-label {
  font-size: 0.82rem;
  color: #bdc1c6;
}

.rate-label--prominent {
  font-size: 0.95rem;
  font-weight: 600;
  color: #e8eaed;
}

.rate-select {
  background: #2d333b;
  color: #e8eaed;
  border: 1px solid #3c4043;
  border-radius: 8px;
  padding: 0.4rem 0.55rem;
  font-size: 0.88rem;
  min-width: 5.5rem;
  cursor: pointer;
}

.rate-select--prominent {
  flex: 1;
  min-width: 8rem;
  min-height: 52px;
  padding: 0.55rem 0.85rem;
  font-size: 1.05rem;
  font-weight: 600;
  border-radius: 10px;
  border-color: #5f6368;
}

.rate-select:focus {
  outline: 2px solid #1a73e8;
  outline-offset: 2px;
}

@media (max-width: 899px) {
  .toolbar-trailer-icons {
    flex-wrap: wrap;
    row-gap: 0.35rem;
  }

  .toolbar-trailer-icons > .rate-block--inline {
    flex: 1 1 100%;
    width: 100%;
    max-width: 100%;
    justify-content: flex-start;
    align-items: center;
    gap: 0.35rem;
    order: 100;
    padding-top: 0.35rem;
    margin-top: 0.05rem;
    border-top: 1px solid #2d333b;
  }

  .toolbar-trailer-icons > .rate-block--inline .rate-select--compact {
    flex: 0 1 auto;
    min-width: 3.5rem;
    max-width: min(34vw, 6.25rem);
    min-height: 32px;
    padding: 0.15rem 0.3rem;
    font-size: 0.76rem;
  }

  .toolbar-full-main-row {
    flex-wrap: wrap;
    row-gap: 0.35rem;
  }

  .toolbar-full-main-row > .rate-block--inline {
    flex: 1 1 100%;
    width: 100%;
    max-width: 100%;
    justify-content: flex-start;
    gap: 0.35rem;
    order: 100;
    padding-top: 0.35rem;
    margin-top: 0.05rem;
    border-top: 1px solid #2d333b;
  }

  .toolbar-full-main-row > .rate-block--inline .rate-select--compact {
    flex: 0 1 auto;
    min-width: 3.5rem;
    max-width: min(34vw, 6.25rem);
    min-height: 32px;
    padding: 0.15rem 0.3rem;
    font-size: 0.76rem;
  }

  .rate-label--compact {
    font-size: 0.72rem;
  }
}

@media (min-width: 600px) {
  .toolbar--full:not(.toolbar--full-compact) {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .toolbar--full:not(.toolbar--full-compact) .rate-block {
    flex: 1;
    justify-content: flex-end;
    min-width: 220px;
  }

  .rate-select--prominent {
    flex: 0 1 auto;
    max-width: 14rem;
  }
}
</style>
