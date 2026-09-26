<template>
  <div
    class="layout"
    :class="{
      'layout--tv-silk': isTvLayout,
      'layout--tv-minimal': isTvLayout,
      'layout--theater': theaterMode && !isTvLayout,
    }"
  >
    <div v-if="catalogGateVisible" class="catalog-gate" role="dialog" aria-modal="true" aria-labelledby="catalog-gate-title">
      <form v-if="!catalogGateChecking" class="catalog-gate-card" @submit.prevent="submitCatalogUnlock">
        <h1 id="catalog-gate-title" class="catalog-gate-title">Catálogo bloqueado</h1>
        <p class="catalog-gate-hint">Introduza a senha para aceder aos vídeos neste browser.</p>
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

    <div v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</div>

    <!-- Modo TV: vídeo + tags de pasta (centro) + rail lateral só miniaturas. -->
    <div v-if="isTvLayout" class="tv-minimal">
      <div class="tv-minimal-main">
        <video
          v-show="tvMinimalVideoSrc"
          ref="tvMinimalVideoRef"
          class="tv-minimal-video"
          :class="{ 'tv-minimal-video--full': tvMinimalIsFull, 'stage-video--fast-play': fastPlayEnabled && tvMinimalIsFull }"
          playsinline
          :controls="tvMinimalIsFull ? mainVideoNativeControls : true"
          :muted="tvMinimalIsFull ? false : previewTrailerMuted"
          :preload="videoPreloadAttr"
          @loadeddata="onTvMinimalLoadedData"
          @loadedmetadata="onTvMinimalLoadedMetadata"
          @timeupdate="onTvMinimalTimeUpdate"
          @seeked="onTvMinimalSeeked"
          @play="onTvMinimalPlay"
          @pause="syncMainVideoPausedForUi"
          @ended="onTvMinimalEnded"
          @ratechange="syncRateFromVideo"
          @volumechange="onPreviewTrailerVolumeChange"
          @click="onTvMinimalSurfaceClick"
          @error="onStageVideoError"
        />
        <div v-if="loading" class="tv-minimal-overlay">A carregar lista…</div>
        <div v-else-if="!entries.length && !loading" class="tv-minimal-overlay">
          Nenhum título nesta sessão.
        </div>
        <div v-else-if="!tvMinimalVideoSrc" class="tv-minimal-overlay">
          Sem trailer para este título.
        </div>
        <div class="tv-minimal-bar" role="toolbar" aria-label="Navegação e filtros">
          <div class="tv-minimal-bar-left">
            <div class="tv-minimal-actions" aria-label="Navegação">
              <button
                type="button"
                class="tv-minimal-btn"
                :disabled="entries.length < 2 || tvMinimalIsFull"
                aria-label="Trailer anterior"
                @click="tvMinimalPrev"
              >
                ◀
              </button>
              <button
                v-if="!tvMinimalIsFull"
                type="button"
                class="tv-minimal-btn tv-minimal-btn--primary"
                :disabled="!selectedEntry?.hasMain"
                :title="selectedEntry && !selectedEntry.hasMain ? 'Completo em falta' : 'Tocar vídeo completo'"
                aria-label="Tocar vídeo completo"
                @click="openFullFromPreview"
              >
                Completo
              </button>
              <button
                v-else
                type="button"
                class="tv-minimal-btn tv-minimal-btn--secondary"
                aria-label="Voltar ao trailer"
                title="Voltar ao trailer"
                @click="onTvMinimalBackToTrailer"
              >
                Trailer
              </button>
              <div class="tv-minimal-rate">
                <label for="rate-select-tv-minimal" class="tv-minimal-rate-label">Vel.</label>
                <select
                  id="rate-select-tv-minimal"
                  class="tv-minimal-rate-select"
                  :value="playbackRate"
                  :disabled="fastPlayEnabled"
                  :title="fastPlayEnabled ? 'Desactive FAST para mudar a velocidade manualmente' : 'Velocidade do vídeo completo'"
                  @change="setPlaybackRate(Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="r in PLAYBACK_RATES" :key="r" :value="r">
                    {{ r === 1 ? '1×' : `${r}×` }}
                  </option>
                </select>
              </div>
              <button
                type="button"
                class="tv-minimal-btn"
                :disabled="entries.length < 2 || tvMinimalIsFull"
                aria-label="Próximo trailer"
                @click="tvMinimalNext"
              >
                ▶
              </button>
              <button
                v-if="sessionIndex === RECENTS_SESSION_ID && focusedIndex !== null"
                type="button"
                class="tv-minimal-btn tv-minimal-btn--remove-destaques"
                :disabled="recentsMutationBusy"
                title="Remover da lista Destaques (não apaga ficheiros)"
                aria-label="Tirar dos Destaques"
                @click="removeFocusedFromRecents"
              >
                Tirar
              </button>
            </div>
            <div
              v-if="sessionIndex === RECENTS_SESSION_ID && tvOriginTags.length"
              class="tv-minimal-origin"
              role="toolbar"
              aria-label="Filtrar Destaques por biblioteca de origem"
            >
              <span class="tv-minimal-origin-label">ORIGEM</span>
              <button
                v-for="row in tvOriginTags"
                :key="row.tag"
                type="button"
                class="tv-minimal-origin-btn"
                :class="{ 'tv-minimal-origin-btn--active': catalogOriginFilter === row.tag }"
                :title="`${row.count} título(s) com origem «${row.tag}»`"
                @click="onOriginTagPick(row.tag)"
              >
                {{ row.tag }}
                <span class="tv-minimal-origin-count">{{ row.count }}</span>
              </button>
              <button
                v-if="catalogOriginFilter"
                type="button"
                class="tv-minimal-origin-btn tv-minimal-origin-btn--clear"
                aria-label="Limpar filtro de origem"
                @click="clearCatalogOriginFilter"
              >
                ×
              </button>
            </div>
          </div>
          <div v-if="tvMinimalCaption" class="tv-minimal-meta">
            <p class="tv-minimal-title" :title="tvMinimalCaption">
              {{ tvMinimalCaption }}
            </p>
            <p v-if="entries.length && !tvMinimalIsFull" class="tv-minimal-pos">
              {{ (focusedIndex ?? 0) + 1 }} / {{ entries.length }}
            </p>
            <p v-else-if="tvMinimalIsFull" class="tv-minimal-pos tv-minimal-pos--full">
              Completo
            </p>
          </div>
        </div>
      </div>
      <aside class="tv-minimal-rail" aria-label="Lista de títulos">
        <button
          v-if="entries.length"
          type="button"
          class="tv-minimal-rail-scroll-btn"
          aria-label="Lista para cima"
          title="Subir na lista"
          @click="scrollTvMinimalRail(-1)"
        >
          ▲
        </button>
        <div ref="tvMinimalRailScroll" class="tv-minimal-rail-scroll">
          <button
            v-for="(entry, i) in entries"
            :key="`${catalogOriginFilter ?? ''}:${libSession(entry)}:${entry.trailerRel}`"
            type="button"
            class="tv-minimal-thumb"
            :class="{ 'tv-minimal-thumb--active': focusedIndex === i }"
            :title="entry.label"
            :aria-label="`Tocar ${entry.label}`"
            :aria-current="focusedIndex === i ? 'true' : undefined"
            @click="tvMinimalSelectIndex(i)"
          >
            <img
              v-if="entry.previewRel || entry.trailerRel"
              class="tv-minimal-thumb-img"
              decoding="async"
              alt=""
              :src="catalogPreviewFrameUrl(entry.previewRel ?? entry.trailerRel, libSession(entry), 0)"
            />
            <span v-else class="tv-minimal-thumb-ph" aria-hidden="true" />
          </button>
          <div
            v-if="sessionIndex === RECENTS_SESSION_ID && recentsHasMore && recentsPaginationEnabled"
            ref="recentsLoadSentinel"
            class="recents-load-sentinel"
            aria-hidden="true"
          />
          <p
            v-if="recentsPaginationEnabled && recentsLoadingMore"
            class="tv-minimal-rail-hint"
          >
            +
          </p>
        </div>
        <button
          v-if="entries.length"
          type="button"
          class="tv-minimal-rail-scroll-btn"
          aria-label="Lista para baixo"
          title="Descer na lista"
          @click="scrollTvMinimalRail(1)"
        >
          ▼
        </button>
      </aside>
    </div>

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
      v-if="!isTvLayout"
      class="main-stack"
      :class="{
        'main-stack--catalog-collapsed': catalogGridCollapsed,
        'main-stack--with-catalog-split': catalogSplitterInLayout,
        'main-stack--theater': theaterMode,
      }"
      :style="mainStackGridStyle"
    >
      <section class="media-card">
        <div class="media-card-pin">
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
          <template v-if="isTvLayout">
            <div
              v-if="tvStageVideoSrc"
              ref="previewFullscreenWrapRef"
              class="stage-fullscreen-wrap"
            >
              <video
                ref="tvStageVideoRef"
                class="stage-video"
                :class="{ 'stage-video--fast-play': fastPlayEnabled && tvStageIsMain }"
                playsinline
                :controls="tvStageIsMain ? mainVideoNativeControls : true"
                :muted="tvStageIsMain ? false : previewTrailerMuted"
                :preload="videoPreloadAttr"
                @loadeddata="onTvStageLoadedData"
                @loadedmetadata="onTvStageLoadedMetadata"
                @timeupdate="onTvStageTimeUpdate"
                @seeked="onTvStageSeeked"
                @play="onTvStagePlay"
                @pause="syncMainVideoPausedForUi"
                @ended="onTvStageEnded"
                @ratechange="syncRateFromVideo"
                @volumechange="onPreviewTrailerVolumeChange"
                @click="onTvStageSurfaceClick"
                @error="onStageVideoError"
              />
              <div
                v-show="!tvStageIsMain && trailerStageFullscreen && entries.length > 0"
                class="stage-fullscreen-trailer-actions"
                aria-label="Controlo no trailer em ecrã inteiro"
              >
                <button
                  type="button"
                  class="stage-fullscreen-trailer-btn"
                  title="Trailer anterior"
                  aria-label="Trailer anterior"
                  :disabled="entries.length < 2"
                  @click.stop="goToPrevTrailer"
                >
                  <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                    <g transform="scale(-1 1) translate(-24 0)">
                      <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                    </g>
                  </svg>
                  <span>Voltar trailer</span>
                </button>
                <button
                  type="button"
                  class="stage-fullscreen-trailer-btn"
                  title="Próximo trailer"
                  aria-label="Próximo trailer"
                  :disabled="entries.length < 2"
                  @click.stop="goToNextTrailer"
                >
                  <span>Próximo trailer</span>
                  <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                    <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="stage-fullscreen-trailer-btn stage-fullscreen-trailer-btn--primary"
                  :disabled="selectedEntry ? !selectedEntry.hasMain : true"
                  :title="selectedEntry && !selectedEntry.hasMain ? 'Completo em falta' : 'Vídeo completo'"
                  aria-label="Tocar vídeo completo"
                  @click.stop="openFullFromPreview"
                >
                  <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="4" width="20" height="14" rx="2" />
                    <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
                  </svg>
                  <span>Tocar completo</span>
                </button>
              </div>
            </div>
            <div v-else class="preview-placeholder">Escolha um título na lista.</div>
          </template>
          <template v-else-if="!playerUrl && previewUrl && pinnedTrailers.length > 0">
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
                  @play="onPreviewPlay"
                  @timeupdate="onPreviewTimeUpdate"
                  @ended="onPreviewEnded"
                  @ratechange="syncRateFromVideo"
                  @volumechange="onPreviewTrailerVolumeChange"
                  @error="onStageVideoError"
                />
                <div
                  v-show="trailerStageFullscreen && !trailerPreviewVideoFullscreen && entries.length > 0"
                  class="stage-fullscreen-trailer-actions"
                  aria-label="Controlo no trailer em ecrã inteiro"
                >
                  <button
                    type="button"
                    class="stage-fullscreen-trailer-btn"
                    title="Trailer anterior"
                    aria-label="Trailer anterior"
                    :disabled="entries.length < 2"
                    @click.stop="goToPrevTrailer"
                  >
                    <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                      <g transform="scale(-1 1) translate(-24 0)">
                        <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                      </g>
                    </svg>
                    <span>Voltar trailer</span>
                  </button>
                  <button
                    type="button"
                    class="stage-fullscreen-trailer-btn"
                    title="Próximo trailer"
                    aria-label="Próximo trailer"
                    :disabled="entries.length < 2"
                    @click.stop="goToNextTrailer"
                  >
                    <span>Próximo trailer</span>
                    <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                      <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="stage-fullscreen-trailer-btn stage-fullscreen-trailer-btn--primary"
                    :disabled="selectedEntry ? !selectedEntry.hasMain : true"
                    :title="selectedEntry && !selectedEntry.hasMain ? 'Completo em falta' : 'Vídeo completo'"
                    aria-label="Tocar vídeo completo"
                    @click.stop="openFullFromPreview"
                  >
                    <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="2" y="4" width="20" height="14" rx="2" />
                      <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
                    </svg>
                    <span>Tocar completo</span>
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
              @play="onPreviewPlay"
              @timeupdate="onPreviewTimeUpdate"
              @ended="onPreviewEnded"
              @ratechange="syncRateFromVideo"
              @volumechange="onPreviewTrailerVolumeChange"
              @error="onStageVideoError"
            />
            <div
              v-show="trailerStageFullscreen && !trailerPreviewVideoFullscreen && entries.length > 0"
              class="stage-fullscreen-trailer-actions"
              aria-label="Controlo no trailer em ecrã inteiro"
            >
              <button
                type="button"
                class="stage-fullscreen-trailer-btn"
                title="Trailer anterior"
                aria-label="Trailer anterior"
                :disabled="entries.length < 2"
                @click.stop="goToPrevTrailer"
              >
                <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                  <g transform="scale(-1 1) translate(-24 0)">
                    <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                  </g>
                </svg>
                <span>Voltar trailer</span>
              </button>
              <button
                type="button"
                class="stage-fullscreen-trailer-btn"
                title="Próximo trailer"
                aria-label="Próximo trailer"
                :disabled="entries.length < 2"
                @click.stop="goToNextTrailer"
              >
                <span>Próximo trailer</span>
                <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                  <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
                </svg>
              </button>
              <button
                type="button"
                class="stage-fullscreen-trailer-btn stage-fullscreen-trailer-btn--primary"
                :disabled="selectedEntry ? !selectedEntry.hasMain : true"
                :title="selectedEntry && !selectedEntry.hasMain ? 'Completo em falta' : 'Vídeo completo'"
                aria-label="Tocar vídeo completo"
                @click.stop="openFullFromPreview"
              >
                <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="4" width="20" height="14" rx="2" />
                  <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
                </svg>
                <span>Tocar completo</span>
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
            @seeked="onMainVideoSeeked"
            @play="syncMainVideoPausedForUi"
            @pause="syncMainVideoPausedForUi"
            @ended="onMainVideoEnded"
            @ratechange="syncRateFromVideo"
            @click="onMainVideoSurfaceClick"
            @error="onStageVideoError"
          />
          <div v-else class="preview-placeholder">Escolha um título na lista.</div>
        </div>

        <div class="media-card-chrome">
        <div
          v-if="shrinkInPlacePanelVisible"
          class="job-progress-panel"
          :class="{ 'job-progress-panel--failed': shrinkInPlaceFailed }"
          role="status"
          aria-live="polite"
          :aria-busy="shrinkInPlaceBusy"
        >
          <div class="job-progress-head">
            <span class="job-progress-title">
              {{
                shrinkInPlaceBusy
                  ? shrinkQueue.length > 1
                    ? `Shrink fila ${shrinkQueueDoneCount + 1}/${shrinkQueue.length}`
                    : 'Shrink em curso'
                  : shrinkInPlaceLastStatus || (shrinkInPlaceFailed ? 'Shrink falhou' : 'Shrink')
              }}
            </span>
            <span v-if="shrinkInPlaceFileLabel" class="job-progress-file" :title="shrinkInPlaceFileLabel">
              {{ shrinkInPlaceFileLabel }}
            </span>
            <button
              v-if="shrinkInPlaceLogLines.length"
              type="button"
              class="job-progress-copy"
              title="Copiar log completo"
              @click="copyShrinkInPlaceLog"
            >
              Copiar log
            </button>
            <button
              v-if="shrinkInPlaceLogLines.length"
              type="button"
              class="job-progress-copy"
              :title="shrinkInPlaceLogCollapsed ? 'Mostrar log' : 'Recolher log'"
              :aria-expanded="!shrinkInPlaceLogCollapsed"
              @click="shrinkInPlaceLogCollapsed = !shrinkInPlaceLogCollapsed"
            >
              {{ shrinkInPlaceLogCollapsed ? 'Mostrar log' : 'Recolher log' }}
            </button>
            <button
              v-if="!shrinkInPlaceBusy"
              type="button"
              class="job-progress-dismiss"
              title="Fechar painel"
              aria-label="Fechar painel de progresso"
              @click="resetShrinkInPlaceProgressUi()"
            >
              ×
            </button>
          </div>
          <div
            class="job-progress-track"
            :class="{
              'job-progress-track--indeterminate':
                shrinkInPlaceBusy && (shrinkInPlacePct === null || shrinkInPlacePct < 90),
            }"
          >
            <div
              class="job-progress-fill"
              :style="
                shrinkInPlacePct !== null && !(shrinkInPlaceBusy && shrinkInPlacePct < 90)
                  ? { width: `${shrinkInPlacePct}%` }
                  : undefined
              "
            />
          </div>
          <p v-if="shrinkInPlaceErrorSummary" class="job-progress-error">{{ shrinkInPlaceErrorSummary }}</p>
          <p class="job-progress-line">{{ shrinkInPlaceLatestLine || 'A iniciar…' }}</p>
          <div
            v-if="shrinkInPlaceLogLines.length && !shrinkInPlaceLogCollapsed"
            ref="shrinkInPlaceLogEl"
            class="job-progress-log"
            aria-label="Log do shrink"
          >
            <div
              v-for="(row, i) in shrinkInPlaceLogLines"
              :key="`${i}-${row.text.slice(0, 40)}`"
              class="job-progress-log-line"
              :class="`job-progress-log-line--${row.kind}`"
            >
              {{ row.text }}
            </div>
          </div>
        </div>

        <!-- Barra partilhada: components/player/PlayerChromeToolbar.vue -->
        <PlayerChromeToolbar
          v-if="!playerUrl && previewUrl"
          mode="trailer"
          :title="playerChromeTrailerTitle"
          :chrome-collapsed="trailerControlsCollapsed"
          :theater-mode="theaterMode"
          :playback-rate="playbackRate"
          :playback-rates="PLAYBACK_RATES"
          :show-theater="true"
          :show-tags="!isTvLayout"
          :show-move="moveTitleDesktopEligible && focusedIndex !== null && !!selectedEntry"
          :show-editor="editorDesktopEligible && !!editorOpenEntry"
          :show-trailer-reprocess="trailerReprocessEligible && !!editorOpenEntry"
          :show-shrink="shrinkInPlaceEligible && !!editorOpenEntry"
          :show-delete="focusedIndex !== null && !!selectedEntry"
          :show-reveal="revealExplorerEligible"
          :show-nav="true"
          :show-pin="!isTvLayout"
          :show-shuffle="true"
          :show-open-full="true"
          :show-fast-play="false"
          :show-name-row="!!selectedEntry"
          :show-size-in-name="true"
          :destaque-busy="recentsMutationBusy"
          :shrink-busy="shrinkInPlaceBusy"
          :trailer-busy="trailerReprocessBusy"
          :pin-count="pinnedTrailers.length"
          :pin-at-cap="pinnedTrailers.length >= MAX_PINNED_TRAILERS"
          :pin-disabled="!previewUrl"
          :pin-title="pinSplitToolbarTitle"
          :pin-aria="pinSplitToolbarAria"
          :shuffle-on="shuffleForwardEnabled"
          :shuffle-disabled="entries.length < 2"
          :tags-panel-open="trailerTagPanelOpen"
          :tags-hidden="trailerTagsHidden"
          :reveal-title="revealInFolderButtonTitle"
          :reveal-aria="revealInFolderAriaLabel"
          :tag-input="newTagInput"
          :tag-suggestions="tagSuggestions"
          tag-input-id="tag-input-main"
          datalist-id="catalog-tag-suggestions"
          rate-select-id="rate-select-trailer"
          :tag-filter-active="catalogTagFilter"
          @update:chrome-collapsed="trailerControlsCollapsed = $event"
          @update:theater-mode="theaterMode = $event"
          @update:playback-rate="setPlaybackRate"
          @update:tag-input="newTagInput = $event"
          @toggle-favorite="toggleFavoriteAtIndex(null)"
          @toggle-memorable="toggleMemorableAtIndex(null)"
          @toggle-destaque="toggleCurrentTitleRecents"
          @open-tags="showTrailerTagsAndToggleInput"
          @open-move="openMoveTitleDialog()"
          @open-editor="openCurrentVideoInEditor"
          @open-trailer-reprocess="openTrailerReprocessDialog"
          @open-shrink="openShrinkInPlaceDialog"
          @delete-title="focusedIndex !== null && deleteTitleAtIndex(focusedIndex)"
          @reveal="revealPlayingFileInExplorer"
          @prev-trailer="goToPrevTrailer"
          @next-trailer="goToNextTrailer"
          @pin-split="onPinSplitToolbarClick"
          @clear-pins="clearPinnedTrailers"
          @toggle-shuffle="toggleShuffleForward"
          @open-full="openFullFromPreview"
          @open-tag-input="openTrailerTagInput"
          @hide-tags="hideTrailerTags"
          @add-tags="addTagFromInput"
          @tag-pointer-down="(t, e) => selectedEntry && onTagChipPointerDown(libSession(selectedEntry), selectedEntry.trailerRel, t, e)"
          @tag-pointer-up="(t, e) => selectedEntry && onTagChipPointerUp(libSession(selectedEntry), selectedEntry.trailerRel, t, e)"
          @tag-pointer-cancel="onTagChipPointerCancel"
        />

        <PlayerChromeToolbar
          v-else-if="playerUrl"
          mode="full"
          :title="playerChromeFullTitle"
          :chrome-collapsed="trailerControlsCollapsed"
          :theater-mode="theaterMode"
          :playback-rate="playbackRate"
          :playback-rates="PLAYBACK_RATES"
          :show-theater="true"
          :show-tags="true"
          :show-move="moveTitleDesktopEligible && activeIndex !== null && !!mainVideoEntry"
          :show-editor="editorDesktopEligible && !!editorOpenEntry"
          :show-trailer-reprocess="trailerReprocessEligible && !!editorOpenEntry"
          :show-shrink="shrinkInPlaceEligible && !!editorOpenEntry"
          :show-delete="activeIndex !== null && !!mainVideoEntry"
          :show-reveal="revealExplorerEligible"
          :show-nav="false"
          :show-pin="false"
          :show-shuffle="false"
          :show-open-full="false"
          :show-fast-play="true"
          :show-name-row="!!mainVideoEntry"
          :show-size-in-name="false"
          :destaque-busy="recentsMutationBusy"
          :shrink-busy="shrinkInPlaceBusy"
          :trailer-busy="trailerReprocessBusy"
          :fast-play-on="fastPlayEnabled"
          :tags-panel-open="true"
          :tags-hidden="trailerTagsHidden"
          :reveal-title="revealInFolderButtonTitle"
          :reveal-aria="revealInFolderAriaLabel"
          :tag-input="newTagInput"
          :tag-suggestions="tagSuggestions"
          tag-input-id="tag-input-full"
          datalist-id="catalog-tag-suggestions-full"
          rate-select-id="rate-select-main"
          :tag-filter-active="catalogTagFilter"
          @update:chrome-collapsed="trailerControlsCollapsed = $event"
          @update:theater-mode="theaterMode = $event"
          @update:playback-rate="setPlaybackRate"
          @update:tag-input="newTagInput = $event"
          @toggle-favorite="toggleFavoriteAtIndex(null)"
          @toggle-memorable="toggleMemorableAtIndex(null)"
          @toggle-destaque="toggleCurrentTitleRecents"
          @open-move="openMoveTitleDialog()"
          @open-editor="openCurrentVideoInEditor"
          @open-trailer-reprocess="openTrailerReprocessDialog"
          @open-shrink="openShrinkInPlaceDialog"
          @delete-title="activeIndex !== null && deleteTitleAtIndex(activeIndex)"
          @reveal="revealPlayingFileInExplorer"
          @close-full="closeFullVideo"
          @toggle-fast-play="toggleFastPlay"
          @add-tags="addTagFromInput"
          @tag-pointer-down="(t, e) => mainVideoEntry && onTagChipPointerDown(libSession(mainVideoEntry), mainVideoEntry.trailerRel, t, e)"
          @tag-pointer-up="(t, e) => mainVideoEntry && onTagChipPointerUp(libSession(mainVideoEntry), mainVideoEntry.trailerRel, t, e)"
          @tag-pointer-cancel="onTagChipPointerCancel"
        />
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
        <div class="catalog-head" :class="{ 'catalog-head--chrome-hidden': catalogChromeHidden }">
          <div class="catalog-head-title-row">
            <h2 class="panel-title list-heading">Catálogo</h2>
            <div class="catalog-head-title-actions">
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
                type="button"
                class="catalog-chrome-toggle"
                :class="{ 'catalog-chrome-toggle--on': catalogChromeHidden }"
                :title="catalogChromeHidden ? 'Mostrar controlos do catálogo' : 'Esconder controlos do catálogo'"
                :aria-pressed="catalogChromeHidden"
                :aria-label="catalogChromeHidden ? 'Mostrar controlos do catálogo' : 'Esconder controlos do catálogo'"
                @click="catalogChromeHidden = !catalogChromeHidden"
              >
                <svg class="catalog-chrome-toggle-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path :d="catalogChromeHidden ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'" />
                </svg>
              </button>
            </div>
          </div>
          <template v-if="!catalogChromeHidden">
          <div v-if="searchSessionActive && !catalogGridCollapsed" class="catalog-search-row">
            <select
              v-model="searchSessionMode"
              class="catalog-search-mode"
              aria-label="Modo da busca global"
            >
              <option value="files">Arquivos</option>
              <option value="tags">Tags</option>
            </select>
            <select
              v-model="searchSessionMatch"
              class="catalog-search-mode catalog-search-match"
              aria-label="Correspondência da busca global"
              @change="onSearchSessionMatchChange"
            >
              <option value="any">Qualquer</option>
              <option value="all">Todas</option>
              <option value="approx">Aproximado</option>
            </select>
            <input
              v-model="searchSessionInput"
              class="catalog-search-input"
              type="search"
              :placeholder="
                searchSessionMatch === 'all'
                  ? 'Todas as palavras… (todas as pastas)'
                  : searchSessionMatch === 'approx'
                    ? 'Texto aproximado… (todas as pastas)'
                    : 'Qualquer palavra… (todas as pastas)'
              "
              aria-label="Buscar global em todas as pastas"
              @keydown.enter.prevent="runSearchSession"
            />
            <button type="button" class="catalog-search-btn" @click="runSearchSession">Buscar</button>
          </div>
          <div
            v-if="searchSessionActive && !catalogGridCollapsed"
            class="catalog-tag-browse"
          >
            <button
              type="button"
              class="catalog-tag-browse-btn"
              title="Ver todas as tags, contagens e listas de categorização"
              @click="openTagBrowseDialog"
            >
              <span class="catalog-tag-browse-label">Tags</span>
              <span class="catalog-tag-browse-meta">
                <template v-if="tagBrowseLoaded">
                  {{ tagBrowseRows.length }} tag{{ tagBrowseRows.length === 1 ? '' : 's' }}
                  · {{ tagBrowseLists.length }} lista{{ tagBrowseLists.length === 1 ? '' : 's' }}
                </template>
                <template v-else>abrir catálogo</template>
              </span>
            </button>
          </div>
          <div
            v-else-if="!catalogGridCollapsed && !searchSessionActive"
            class="catalog-search-row catalog-search-row--folder"
          >
            <select
              v-model="folderFilterMode"
              class="catalog-search-mode"
              aria-label="Modo do filtro nesta pasta"
            >
              <option value="tags">Tags</option>
              <option value="files">Arquivos</option>
            </select>
            <input
              v-model="folderFilterInput"
              class="catalog-search-input"
              type="search"
              placeholder="Filtrar tags / nomes nesta pasta"
              aria-label="Filtrar catálogo só nesta pasta"
              @keydown.escape.prevent="folderFilterInput = ''"
            />
            <button
              v-if="folderFilterInput.trim()"
              type="button"
              class="catalog-search-btn"
              @click="folderFilterInput = ''"
            >
              Limpar
            </button>
          </div>
          <div v-if="searchSessionActive && searchSessionError" class="catalog-search-error">
            {{ searchSessionError }}
          </div>
          <div class="catalog-head-tools">
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
                :title="catalogSortDateTitle"
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
              <button
                type="button"
                class="catalog-sort-btn"
                :class="{ 'catalog-sort-btn--active': catalogSortKey === 'favorite' }"
                title="Ordenar por timestamp de favorito. Voltar a clicar inverte."
                @click="cycleCatalogSort('favorite')"
              >
                FlagTime<span v-if="catalogSortKey === 'favorite'" class="catalog-sort-dir" aria-hidden="true">{{
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
              :class="{
                'watched-filter-toggle--on': favoriteCatalogFilter === 'only',
                'watched-filter-toggle--exclude': favoriteCatalogFilter === 'exclude',
              }"
              :aria-pressed="favoriteCatalogFilter !== 'all'"
              :title="favoriteCatalogFilterTitle"
              @click="cycleFavoriteCatalogFilter"
            >
              <span aria-hidden="true">{{ favoriteCatalogFilterIcon }}</span>
              <span>{{ favoriteCatalogFilterLabel }}</span>
              <span v-if="favoriteCount > 0 && favoriteCatalogFilter === 'all'" class="watched-filter-count">{{
                favoriteCount
              }}</span>
            </button>
            <button
              v-if="sessionIndex !== RECENTS_SESSION_ID"
              type="button"
              class="watched-filter-toggle watched-filter-toggle--destaques"
              :class="{
                'watched-filter-toggle--on': destaquesCatalogFilter === 'only',
                'watched-filter-toggle--exclude': destaquesCatalogFilter === 'exclude',
              }"
              :aria-pressed="destaquesCatalogFilter !== 'all'"
              :title="destaquesCatalogFilterTitle"
              @click="cycleDestaquesCatalogFilter"
            >
              <svg
                v-if="destaquesCatalogFilter !== 'exclude'"
                class="watched-filter-toggle-svg"
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
                class="watched-filter-toggle-svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2.25"
                stroke-linecap="round"
              >
                <path
                  d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              <span>{{ destaquesCatalogFilterLabel }}</span>
              <span
                v-if="destaquesCount > 0 && destaquesCatalogFilter === 'all'"
                class="watched-filter-count"
              >{{ destaquesCount }}</span>
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
            <button
              v-if="catalogOriginFilter"
              type="button"
              class="tag-filter-clear tag-filter-clear--origin"
              :title="`Remover filtro de origem «${catalogOriginFilter}»`"
              @click="clearCatalogOriginFilter"
            >
              Origem: {{ catalogOriginFilter }}
              <span class="tag-filter-clear-x" aria-hidden="true">×</span>
            </button>
          </div>
          <div
            v-if="sessionMenuTopTags.length && !catalogGridCollapsed"
            class="catalog-top-tags"
          >
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
          <div
            v-if="sessionIndex === RECENTS_SESSION_ID && sessionMenuOriginTags.length && !catalogGridCollapsed"
            class="catalog-top-tags catalog-top-tags--origin"
          >
            <span class="catalog-top-tags-title">ORIGEM</span>
            <div class="catalog-top-tags-row">
              <button
                v-for="row in sessionMenuOriginTags"
                :key="row.tag"
                type="button"
                class="catalog-top-tag catalog-top-tag--origin"
                :class="{ 'catalog-top-tag--active': catalogOriginFilter === row.tag }"
                :title="`${row.count} título(s) com origem «${row.tag}»`"
                @click="onOriginTagPick(row.tag)"
              >
                {{ row.tag }}
                <span class="catalog-top-tag-count">{{ row.count }}</span>
              </button>
            </div>
          </div>
          </template>
        </div>
        <div v-if="catalogMode === 'main-only'" class="empty-hint">
          Esta sessão está sem catálogo em <code class="code">trailers/</code> / <code class="code">preview/</code>.
          Ao clicar no grid, o vídeo completo abre diretamente.
          <NuxtLink to="/admin" class="empty-hint-link">Processar trailers/previews no Admin</NuxtLink>
          ·
          <NuxtLink to="/editor" class="empty-hint-link">Editor de vídeo</NuxtLink>
          ·
          <NuxtLink to="/shrink" class="empty-hint-link">Shrink de vídeos</NuxtLink>
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
        <div
          v-else-if="folderFilterInput.trim() && !entries.length && !loading && fullEntries.length"
          class="empty-hint"
        >
          Nenhum título nesta pasta para
          <code class="code">{{ folderFilterInput.trim() }}</code>
          ({{ folderFilterMode === 'tags' ? 'tags' : 'arquivos' }}).
          <button type="button" class="empty-hint-link" @click="folderFilterInput = ''">Limpar filtro</button>
        </div>
        <div
          v-else-if="catalogOriginFilter && !entries.length && !loading && fullEntries.length"
          class="empty-hint"
        >
          Nenhum título com origem <code class="code">{{ catalogOriginFilter }}</code> em Destaques.
          <button type="button" class="empty-hint-link" @click="clearCatalogOriginFilter">Mostrar todos</button>
        </div>
        <div v-else-if="showOnlyWatched && !entries.length && !loading && fullEntries.length" class="empty-hint">
          Nenhum vídeo marcado como concluído ou memorável aqui.
          <button type="button" class="empty-hint-link" @click="toggleShowOnlyWatched">Mostrar todos</button>
        </div>
        <div
          v-else-if="favoriteCatalogFilter === 'only' && !entries.length && !loading && fullEntries.length"
          class="empty-hint"
        >
          Nenhum vídeo marcado como favorito aqui.
          <button type="button" class="empty-hint-link" @click="resetFavoriteCatalogFilter">Mostrar todos</button>
        </div>
        <div
          v-else-if="destaquesCatalogFilter === 'only' && !entries.length && !loading && fullEntries.length"
          class="empty-hint"
        >
          Nenhum título na lista Destaques nesta biblioteca.
          <button type="button" class="empty-hint-link" @click="resetDestaquesCatalogFilter">Mostrar todos</button>
        </div>
        <div
          v-else-if="favoriteCatalogFilter === 'exclude' && !entries.length && !loading && fullEntries.length"
          class="empty-hint"
        >
          Todos os títulos aqui são favoritos — não há nada a mostrar com «sem favoritos».
          <button type="button" class="empty-hint-link" @click="resetFavoriteCatalogFilter">Mostrar todos</button>
        </div>
        <div
          v-else-if="destaquesCatalogFilter === 'exclude' && !entries.length && !loading && fullEntries.length"
          class="empty-hint"
        >
          Todos os títulos aqui estão em Destaques — não há nada a mostrar com «sem destaques».
          <button type="button" class="empty-hint-link" @click="resetDestaquesCatalogFilter">Mostrar todos</button>
        </div>
        <div v-else-if="sessionIndex === RECENTS_SESSION_ID && !entries.length && !loading" class="empty-hint">
          Ainda não há títulos em Destaques. No trailer ou no vídeo completo, usa o botão do <strong>olho</strong>
          na barra para adicionar aqui.
        </div>
        <div v-else-if="sessionIndex === SURPRESA_SESSION_ID && !entries.length && !loading" class="empty-hint">
          Nenhuma surpresa disponível — só entram vídeos totalmente inéditos. Um título sai da lista quando o
          <strong>trailer chega ao fim</strong> (trailer visto).
        </div>
        <div v-else-if="sessionIndex === LAST_VIEWED_SESSION_ID && !entries.length && !loading" class="empty-hint">
          Ainda não reproduziu nenhum trailer. Toque um título noutra pasta (mesmo que pouco) para aparecer aqui (últimos {{ LAST_VIEWED_LIMIT }}). Reproduzir dentro desta lista não altera a ordem.
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
              v-if="isTvLayout && tvGridPaddingTopPx > 0"
              class="tv-grid-spacer"
              :style="{ height: `${tvGridPaddingTopPx}px` }"
              aria-hidden="true"
            />
            <template
              v-for="item in catalogGridDisplayItems"
              :key="
                item.kind === 'folder-header'
                  ? `folder-${item.sessionId}`
                  : `${libSession(item.entry)}:${item.entry.trailerRel}`
              "
            >
            <div
              v-if="item.kind === 'folder-header'"
              class="grid-folder-header"
              role="presentation"
              :aria-label="`Pasta ${item.label}`"
            >
              <span class="grid-folder-header-label">{{ item.label }}</span>
              <span class="grid-folder-header-line" aria-hidden="true" />
            </div>
            <div
              v-else
              class="grid-tile"
              role="group"
              :data-trailer-rel="item.entry.trailerRel"
              :class="{
                'grid-tile--selected': focusedIndex === item.index,
                'grid-tile--full': activeIndex === item.index,
                'grid-tile--no-main': !item.entry.hasMain,
                'grid-tile--fav': item.entry.isFavorite,
                'grid-tile--in-destaques':
                  sessionIndex !== RECENTS_SESSION_ID && isPlaybackTitleInRecentList(item.entry),
              }"
              :title="catalogGridTileTitle(item.entry)"
              @pointerdown="onGridTileChromePointerDown(item.index, $event)"
              @pointerup="onGridTileChromePointerUp"
              @pointerleave="onGridTileChromePointerUp"
              @pointercancel="onGridTileChromePointerUp"
            >
              <button
                type="button"
                class="fav-btn fav-btn--tile"
                :class="{ 'fav-btn--on': item.entry.isFavorite }"
                :aria-pressed="!!item.entry.isFavorite"
                :title="item.entry.isFavorite ? 'Retirar dos favoritos' : 'Favorito'"
                @click.stop="toggleFavoriteAtIndex(item.index, { grid: true })"
              >
                {{ item.entry.isFavorite ? '★' : '☆' }}
              </button>
              <button
                v-if="sessionIndex === RECENTS_SESSION_ID"
                type="button"
                class="grid-tile-remove-recents"
                :disabled="recentsMutationBusy"
                title="Remover só desta lista Destaques (não apaga ficheiros)"
                aria-label="Remover de Destaques"
                @click.stop="removeFromRecentsAtIndex(item.index)"
              >
                <svg class="grid-tile-remove-recents-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round">
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                  />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
              <span
                v-if="sessionIndex !== RECENTS_SESSION_ID && isPlaybackTitleInRecentList(item.entry)"
                class="grid-tile-destaques-eye"
                title="Na lista Destaques"
                aria-label="Na lista Destaques"
              >
                <svg
                  class="grid-tile-destaques-eye-svg"
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
              </span>
              <span
                v-if="isEntryMemorable(item.entry)"
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
                v-else-if="isEntryCompleted(item.entry)"
                class="watch-badge watch-badge--done"
                title="Já visto até ao fim"
                aria-label="Já visto até ao fim"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
              </span>
              <span
                v-else-if="isEntryPartiallyWatched(item.entry)"
                class="watch-badge watch-badge--partial"
                :title="`Visto parcialmente (${formatWatchedSeconds(item.entry.watchedSeconds)})`"
                aria-label="Visto parcialmente"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
                  <path d="M12 3 a9 9 0 0 1 0 18 z" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span
                v-else-if="isEntryTrailerWatched(item.entry)"
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
                v-if="item.entry.previewRel || item.entry.trailerRel"
                class="grid-tile-thumb"
                role="button"
                tabindex="0"
                :aria-label="
                  gridInlinePreviewIndex === item.index
                    ? `Pré-visualização de ${item.entry.label}. Toque outra vez para o trailer no palco.`
                    : `Miniatura de ${item.entry.label}. Toque para substituir pelo preview em vídeo.`
                "
                @click.stop="onCatalogThumbClick(item.index)"
                @keydown.enter.prevent.stop="onCatalogThumbClick(item.index)"
                @keydown.space.prevent.stop="onCatalogThumbClick(item.index)"
              >
                <video
                  v-if="
                    catalogThumbInlineVideo &&
                    isDedicatedPreviewVideoRel(item.entry.previewRel) &&
                    gridInlinePreviewIndex === item.index
                  "
                  class="grid-inline-preview-video"
                  :src="apiVideoUrl(item.entry.previewRel!, libSession(item.entry))"
                  :muted="previewTrailerMuted"
                  playsinline
                  :preload="videoPreloadAttr"
                  tabindex="-1"
                  @loadeddata="onGridInlinePreviewLoaded"
                  @play="onGridInlinePreviewPlay"
                  @timeupdate="onGridInlinePreviewTimeUpdate"
                />
                <CatalogFrameStrip
                  v-else
                  :preview-rel="item.entry.previewRel ?? item.entry.trailerRel"
                  :session-index="libSession(item.entry)"
                  :max-slots="catalogThumbMaxSlots"
                />
                <button
                  v-if="
                    catalogThumbInlineVideo &&
                    isDedicatedPreviewVideoRel(item.entry.previewRel) &&
                    gridInlinePreviewIndex === item.index
                  "
                  type="button"
                  class="grid-tile-maxi"
                  title="Miniaturas em ecrã inteiro"
                  aria-label="Miniaturas em ecrã inteiro"
                  @click.stop="openCatalogGalleryDialog(item.index)"
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
                    ? `Escolher trailer ${item.entry.label} em ${libraryFolderLabel(libSession(item.entry))}`
                    : isAggregatedLibrarySession()
                      ? `Escolher trailer ${item.entry.label} em ${aggregatedListTagForSession()}, origem ${libraryFolderLabel(libSession(item.entry))}`
                      : `Escolher trailer ${item.entry.label}`
                "
                @click="onListItemClick(item.index)"
              >
                <span
                  v-if="showCatalogTileOriginMeta"
                  class="grid-tile-recents-meta"
                  :title="
                    sessionIndex === RECENTS_SESSION_ID
                      ? `Origem: biblioteca «${libraryFolderLabel(libSession(item.entry))}»`
                      : `Lista ${aggregatedListTagForSession()} · vídeo da biblioteca «${libraryFolderLabel(libSession(item.entry))}»`
                  "
                >
                  <span
                    v-if="sessionIndex !== RECENTS_SESSION_ID"
                    class="grid-tile-recents-tag"
                  >{{ aggregatedListTagForSession() }}</span>
                  <span class="grid-tile-recents-lib">{{ libraryFolderLabel(libSession(item.entry)) }}</span>
                </span>
                <span class="grid-tile-label">{{ item.entry.label }}</span>
                <span v-if="!item.entry.hasMain" class="badge badge--tile">sem completo</span>
                <span
                  v-if="(item.entry.tags?.length ?? 0) > 0"
                  class="grid-tile-tags"
                  :title="(item.entry.tags ?? []).join(', ')"
                >
                  <span
                    v-for="t in (item.entry.tags ?? []).slice(0, 2)"
                    :key="t"
                    class="grid-tile-tag"
                    :class="{ 'grid-tile-tag--active': catalogTagFilter === t }"
                    >{{ t }}</span
                  >
                  <span
                    v-if="(item.entry.tags ?? []).length > 2"
                    class="grid-tile-tag grid-tile-tag--more"
                    >+{{ (item.entry.tags ?? []).length - 2 }}</span
                  >
                </span>
              </button>
            </div>
            </template>
            <div
              v-if="isTvLayout && tvGridPaddingBottomPx > 0"
              class="tv-grid-spacer"
              :style="{ height: `${tvGridPaddingBottomPx}px` }"
              aria-hidden="true"
            />
            <div
              v-if="isTvLayout && sessionIndex === RECENTS_SESSION_ID && recentsHasMore && recentsPaginationEnabled"
              ref="recentsLoadSentinel"
              class="recents-load-sentinel"
              aria-hidden="true"
            />
            <p
              v-if="isTvLayout && sessionIndex === RECENTS_SESSION_ID && (recentsLoadingMore || recentsLoadStatusLine)"
              class="recents-load-hint"
              :class="{ 'recents-load-hint--status': recentsLoadStatusLine && !recentsLoadingMore }"
            >
              {{ recentsLoadingMore ? 'A carregar mais…' : recentsLoadStatusLine }}
            </p>
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

    <Teleport v-if="!isTvLayout" to="body">
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
              <svg
                v-if="s.id === SURPRESA_SESSION_ID"
                class="session-menu-item-eye"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M9.5 2.5l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" />
                <path d="M18.5 12.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
              </svg>
              <svg
                v-if="s.id === LAST_VIEWED_SESSION_ID"
                class="session-menu-item-eye"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {{ s.label }}
            </span>
          </button>
        </nav>
      </aside>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="catalogGalleryIndex !== null && (galleryDialogEntry?.previewRel || galleryDialogEntry?.trailerRel)"
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
              :src="catalogPreviewFrameUrl((galleryDialogEntry.previewRel ?? galleryDialogEntry.trailerRel)!, libSession(galleryDialogEntry), slot)"
            />
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-show="trailerPreviewVideoFullscreen && entries.length > 0"
        class="stage-fullscreen-trailer-actions stage-fullscreen-trailer-actions--body-fs"
        aria-label="Controlo no trailer em ecrã inteiro"
      >
        <button
          type="button"
          class="stage-fullscreen-trailer-btn"
          title="Trailer anterior"
          aria-label="Trailer anterior"
          :disabled="entries.length < 2"
          @click.stop="goToPrevTrailer"
        >
          <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <g transform="scale(-1 1) translate(-24 0)">
              <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
            </g>
          </svg>
          <span>Voltar trailer</span>
        </button>
        <button
          type="button"
          class="stage-fullscreen-trailer-btn"
          title="Próximo trailer"
          aria-label="Próximo trailer"
          :disabled="entries.length < 2"
          @click.stop="goToNextTrailer"
        >
          <span>Próximo trailer</span>
          <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M7 6v12l7-6-7-6zm9 0v12h2V6h-2z" />
          </svg>
        </button>
        <button
          type="button"
          class="stage-fullscreen-trailer-btn stage-fullscreen-trailer-btn--primary"
          :disabled="selectedEntry ? !selectedEntry.hasMain : true"
          :title="selectedEntry && !selectedEntry.hasMain ? 'Completo em falta' : 'Vídeo completo'"
          aria-label="Tocar vídeo completo"
          @click.stop="openFullFromPreview"
        >
          <svg class="stage-fullscreen-trailer-btn-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="14" rx="2" />
            <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
          </svg>
          <span>Tocar completo</span>
        </button>
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

    <Teleport to="body">
      <div
        v-show="tagBrowseDialogOpen"
        class="move-title-backdrop"
        @click="closeTagBrowseDialog"
      />
      <div
        v-show="tagBrowseDialogOpen"
        class="tag-browse-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-browse-dialog-title"
      >
        <div class="tag-browse-dialog-card" @pointerdown="onTagBrowseCardPointerDown">
          <div class="session-menu-head">
            <span id="tag-browse-dialog-title" class="session-menu-title">Tags · catálogo</span>
            <button
              type="button"
              class="session-menu-close"
              aria-label="Fechar"
              @click="closeTagBrowseDialog"
            >
              ×
            </button>
          </div>
          <p class="tag-browse-hint tag-browse-hint--desk">
            Contagem em todas as pastas. Clica numa tag para buscar. Listas (ex. «Supermercado»)
            guardam itens de busca (ex. «Arroz Branco») — ao abrir a lista, mostra mosaicos
            aleatórios dos vídeos encontrados.
          </p>
          <p class="tag-browse-hint tag-browse-hint--mobile">
            Tags para buscar · Listas com mosaicos de orientação.
          </p>
          <p v-if="tagBrowseError" class="tag-browse-err" role="alert">{{ tagBrowseError }}</p>

          <div class="tag-browse-tabs" role="tablist" aria-label="Secções">
            <button
              type="button"
              role="tab"
              class="tag-browse-tab"
              :class="{ 'tag-browse-tab--active': tagBrowsePanel === 'tags' }"
              :aria-selected="tagBrowsePanel === 'tags'"
              @click="tagBrowsePanel = 'tags'; closeTagBrowseMenu()"
            >
              Tags
              <span class="tag-browse-tab-meta">{{ tagBrowseRows.length }}</span>
            </button>
            <button
              type="button"
              role="tab"
              class="tag-browse-tab"
              :class="{ 'tag-browse-tab--active': tagBrowsePanel === 'lists' }"
              :aria-selected="tagBrowsePanel === 'lists'"
              @click="tagBrowsePanel = 'lists'; closeTagBrowseMenu()"
            >
              Listas
              <span class="tag-browse-tab-meta">{{ tagBrowseLists.length }}</span>
            </button>
          </div>
          <p
            v-if="tagBrowseSelectedList"
            class="tag-browse-active-list"
          >
            Lista activa:
            <strong>{{ tagBrowseSelectedList.name }}</strong>
            <button
              v-if="tagBrowsePanel === 'tags'"
              type="button"
              class="tag-browse-active-list-go"
              @click="tagBrowsePanel = 'lists'"
            >
              Ver lista
            </button>
          </p>

          <div
            class="tag-browse-layout"
            :class="`tag-browse-layout--panel-${tagBrowsePanel}`"
          >
            <section
              class="tag-browse-col tag-browse-col--tags"
              aria-label="Tags"
              role="tabpanel"
            >
              <div class="tag-browse-toolbar">
                <input
                  v-model="tagBrowseFilter"
                  type="search"
                  class="tag-browse-filter"
                  placeholder="Filtrar tags…"
                  aria-label="Filtrar tags"
                />
                <span class="tag-browse-count">
                  {{ tagBrowseFilteredRows.length }}/{{ tagBrowseRows.length }}
                </span>
              </div>
              <div v-if="tagBrowseLoading" class="tag-browse-empty">A carregar…</div>
              <div v-else-if="!tagBrowseFilteredRows.length" class="tag-browse-empty">
                Nenhuma tag{{ tagBrowseFilter.trim() ? ' neste filtro' : '' }}.
              </div>
              <ul v-else class="tag-browse-list" role="list">
                <li v-for="row in tagBrowseFilteredRows" :key="row.name" class="tag-browse-row">
                  <button
                    type="button"
                    class="tag-browse-tag"
                    :title="`Buscar «${row.name}»`"
                    @click="searchFromTagBrowse(row.name)"
                  >
                    <span class="tag-browse-tag-name">{{ row.name }}</span>
                    <span class="tag-browse-tag-count">{{ row.count }}</span>
                  </button>
                  <button
                    v-if="tagBrowseSelectedListId"
                    type="button"
                    class="tag-browse-toggle"
                    :class="{ 'tag-browse-toggle--on': tagInSelectedList(row.name) }"
                    :title="
                      tagInSelectedList(row.name)
                        ? `Tirar de «${tagBrowseSelectedList?.name}»`
                        : `Meter em «${tagBrowseSelectedList?.name}»`
                    "
                    :aria-label="
                      tagInSelectedList(row.name)
                        ? `Tirar «${row.name}» da lista`
                        : `Meter «${row.name}» na lista`
                    "
                    :disabled="tagBrowseListBusy"
                    @click="toggleTagInSelectedList(row.name)"
                  >
                    {{ tagInSelectedList(row.name) ? '✓' : '+' }}
                  </button>
                </li>
              </ul>
            </section>

            <section
              class="tag-browse-col tag-browse-col--lists"
              aria-label="Listas de tags"
              role="tabpanel"
            >
              <aside
                class="tag-browse-lists-pane"
                :class="{ 'tag-browse-lists-pane--compact': !!tagBrowseSelectedList }"
                aria-label="Listas guardadas"
              >
                <h3 class="tag-browse-col-title">Listas</h3>
                <form class="tag-browse-create" @submit.prevent="createTagBrowseList">
                  <input
                    v-model="tagBrowseNewListName"
                    type="text"
                    class="tag-browse-filter"
                    maxlength="80"
                    placeholder="Nova lista (ex. Supermercado)…"
                    aria-label="Nome da nova lista"
                  />
                  <button
                    type="submit"
                    class="tag-browse-create-btn"
                    :disabled="tagBrowseListBusy || !tagBrowseNewListName.trim()"
                  >
                    Criar
                  </button>
                </form>
                <div v-if="!tagBrowseLists.length" class="tag-browse-empty">
                  Ainda sem listas. Cria uma e adiciona itens de busca.
                </div>
                <ul v-else class="tag-browse-lists" role="list">
                  <li
                    v-for="list in tagBrowseLists"
                    :key="list.id"
                    class="tag-browse-list-item"
                    :class="{
                      'tag-browse-list-item--active': tagBrowseSelectedListId === list.id,
                      'tag-browse-list-item--menu': isTagBrowseMenuOpen('list', list.id),
                    }"
                  >
                    <button
                      type="button"
                      class="tag-browse-list-pick"
                      :aria-label="`${list.name}, ${list.tags.length} ${list.tags.length === 1 ? 'item' : 'itens'}`"
                      @click="selectTagBrowseList(list.id)"
                    >
                      <span class="tag-browse-list-name">{{ list.name }}</span>
                      <span class="tag-browse-list-qty" :title="'Itens nesta lista'">
                        {{ list.tags.length }}
                        {{ list.tags.length === 1 ? 'item' : 'itens' }}
                      </span>
                    </button>
                    <div class="tag-browse-overflow-wrap">
                      <button
                        type="button"
                        class="tag-browse-hamburger"
                        title="Mais acções"
                        aria-label="Mais acções da lista"
                        :aria-expanded="isTagBrowseMenuOpen('list', list.id)"
                        :disabled="tagBrowseListBusy"
                        @click.stop="toggleTagBrowseMenu('list', list.id, list.name, $event)"
                      >
                        <span aria-hidden="true" />
                        <span aria-hidden="true" />
                        <span aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                </ul>
              </aside>
              <div
                class="tag-browse-selected-pane"
                :class="{ 'tag-browse-selected-pane--empty': !tagBrowseSelectedList }"
              >
              <div v-if="tagBrowseSelectedList" class="tag-browse-selected">
                <p class="tag-browse-selected-head">
                  Em «{{ tagBrowseSelectedList.name }}»
                  <span class="tag-browse-list-qty">{{ tagBrowseSelectedList.tags.length }}</span>
                </p>
                <form class="tag-browse-create" @submit.prevent="addItemToSelectedList">
                  <input
                    v-model="tagBrowseNewItemName"
                    type="text"
                    class="tag-browse-filter"
                    maxlength="80"
                    placeholder="Novo item (ex. Arroz Branco)…"
                    aria-label="Adicionar item à lista"
                  />
                  <button
                    type="submit"
                    class="tag-browse-create-btn"
                    :disabled="tagBrowseListBusy || tagBrowseNewItemName.trim().length < 2"
                  >
                    + Item
                  </button>
                </form>
                <p v-if="tagBrowsePreviewLoading" class="tag-browse-empty tag-browse-empty--inline">
                  A carregar mosaicos…
                </p>
                <p
                  v-if="!tagBrowseSelectedList.tags.length"
                  class="tag-browse-empty"
                >
                  Escreve um item acima ou usa + na aba Tags.
                </p>
                <ul
                  v-else
                  class="tag-browse-item-cards"
                  role="list"
                  @scroll.passive="closeTagBrowseMenu"
                >
                  <li
                    v-for="t in tagBrowseSelectedList.tags"
                    :key="t"
                    class="tag-browse-item-card"
                    :class="{ 'tag-browse-item-card--menu': isTagBrowseMenuOpen('item', t) }"
                  >
                    <div
                      v-if="(tagBrowsePreviewByQuery[t]?.samples.length ?? 0) > 0"
                      class="tag-browse-mosaic-wrap"
                    >
                      <TagBrowseItemMosaic
                        :samples="tagBrowsePreviewByQuery[t]!.samples"
                        :item-label="t"
                        @open="searchFromTagBrowse(t)"
                      />
                    </div>
                    <p
                      v-else-if="tagBrowsePreviewByQuery[t] && tagBrowsePreviewByQuery[t]!.total === 0"
                      class="tag-browse-empty tag-browse-empty--tiny tag-browse-empty--mosaic"
                    >
                      Nenhum vídeo encontrado ainda.
                    </p>
                    <div class="tag-browse-item-card-head">
                      <form
                        v-if="tagBrowseEditingItem === t"
                        class="tag-browse-item-edit"
                        @submit.prevent="commitTagBrowseItemRename"
                      >
                        <input
                          v-model="tagBrowseEditDraft"
                          type="text"
                          class="tag-browse-filter tag-browse-item-edit-input"
                          maxlength="80"
                          aria-label="Renomear item"
                          @keydown.escape.prevent="cancelTagBrowseItemEdit"
                        />
                        <button
                          type="submit"
                          class="tag-browse-item-icon-btn tag-browse-item-icon-btn--ok"
                          title="Guardar"
                          :disabled="tagBrowseListBusy || tagBrowseEditDraft.trim().length < 2"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="tag-browse-item-icon-btn"
                          title="Cancelar"
                          :disabled="tagBrowseListBusy"
                          @click="cancelTagBrowseItemEdit"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </form>
                      <template v-else>
                        <button
                          type="button"
                          class="tag-browse-item-name"
                          :title="`Buscar «${t}»`"
                          @click="searchFromTagBrowse(t)"
                        >
                          {{ t }}
                        </button>
                        <span
                          v-if="tagBrowsePreviewByQuery[t]"
                          class="tag-browse-item-total"
                          :title="'Correspondências no catálogo'"
                        >
                          {{ tagBrowsePreviewByQuery[t]!.total }}
                        </span>
                        <div class="tag-browse-overflow-wrap">
                          <button
                            type="button"
                            class="tag-browse-hamburger"
                            title="Mais acções"
                            aria-label="Mais acções do item"
                            :aria-expanded="isTagBrowseMenuOpen('item', t)"
                            :disabled="tagBrowseListBusy"
                            @click.stop="toggleTagBrowseMenu('item', t, t, $event)"
                          >
                            <span aria-hidden="true" />
                            <span aria-hidden="true" />
                            <span aria-hidden="true" />
                          </button>
                        </div>
                      </template>
                    </div>
                  </li>
                </ul>
              </div>
              <p v-else class="tag-browse-empty tag-browse-empty--pick-list">
                Seleciona uma lista para ver e editar os itens.
              </p>
              </div>
            </section>
          </div>
        </div>
      </div>
      <div
        v-if="tagBrowseDialogOpen && tagBrowseMenu"
        class="tag-browse-overflow tag-browse-overflow--portal"
        role="menu"
        :style="tagBrowseMenuPos"
        @pointerdown.stop
      >
        <template v-if="!tagBrowseMenu.confirm">
          <button
            v-if="tagBrowseMenu.kind === 'item'"
            type="button"
            class="tag-browse-overflow-item"
            role="menuitem"
            :disabled="tagBrowseListBusy"
            @click="startTagBrowseItemEdit(tagBrowseMenu.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Editar
          </button>
          <button
            type="button"
            class="tag-browse-overflow-item tag-browse-overflow-item--danger"
            role="menuitem"
            :disabled="tagBrowseListBusy"
            @click="askTagBrowseMenuDelete()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Excluir
          </button>
        </template>
        <div v-else class="tag-browse-overflow-confirm">
          <p v-if="tagBrowseMenu.kind === 'list'">
            Apagar a lista «{{ tagBrowseMenu.label }}»?
          </p>
          <p v-else>
            Excluir o item «{{ tagBrowseMenu.label }}» desta lista?
          </p>
          <div class="tag-browse-overflow-confirm-actions">
            <button
              type="button"
              class="tag-browse-overflow-item"
              :disabled="tagBrowseListBusy"
              @click="cancelTagBrowseMenuDelete()"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="tag-browse-overflow-item tag-browse-overflow-item--danger"
              :disabled="tagBrowseListBusy"
              @click="confirmTagBrowseMenuDelete()"
            >
              Excluir
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-show="trailerReprocessDialogOpen"
        class="move-title-backdrop"
        @click="trailerReprocessDialogOpen = false"
      />
      <div
        v-show="trailerReprocessDialogOpen"
        class="trailer-reprocess-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trailer-reprocess-dialog-title"
      >
        <div class="trailer-reprocess-dialog-card">
          <div class="session-menu-head">
            <span id="trailer-reprocess-dialog-title" class="session-menu-title">Trailer — fila</span>
            <button
              type="button"
              class="session-menu-close"
              aria-label="Fechar"
              @click="trailerReprocessDialogOpen = false"
            >
              ×
            </button>
          </div>
          <div class="trailer-reprocess-dialog-body">
            <p class="trailer-reprocess-dialog-hint">
              Adiciona à fila; processam-se em sequência no servidor (sobrevive a refresh).
              Histórico permanente em
              <NuxtLink to="/historico" class="empty-hint-link">/historico</NuxtLink>
              — limpar a fila não apaga o histórico.
            </p>
            <p v-if="editorOpenEntry" class="trailer-reprocess-dialog-file">
              Actual: {{ editorOpenEntry.mainFilename }}
            </p>
            <p v-if="trailerShrunkNotice" class="shrink-already-warn" role="status">
              <span class="shrink-already-warn-title">Já foi shrinkado</span>
              {{ trailerShrunkNotice }}
            </p>

            <label class="trailer-reprocess-field trailer-reprocess-field--full">
              <span class="trailer-reprocess-label">Modo de coleta</span>
              <select v-model="trailerParamsForm.collect" class="admin-input">
                <option v-for="(label, mode) in TRAILER_COLLECT_LABELS" :key="mode" :value="mode">
                  {{ label }}
                </option>
              </select>
            </label>

            <div v-if="trailerParamsIsLegado" class="trailer-reprocess-grid">
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Duração do corte (s)</span>
                <input
                  v-model.number="trailerParamsForm.legacySegSec"
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  class="admin-input"
                />
              </label>
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Intervalo (s)</span>
                <input
                  v-model.number="trailerParamsForm.legacyStepSec"
                  type="number"
                  min="1"
                  max="3600"
                  step="1"
                  class="admin-input"
                />
              </label>
            </div>

            <div v-if="trailerParamsIsPadrao" class="trailer-reprocess-grid">
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Corte (s)</span>
                <input
                  v-model.number="trailerParamsForm.pctSeg"
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  class="admin-input"
                />
              </label>
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Intervalo (%)</span>
                <input
                  v-model.number="trailerParamsForm.pctStep"
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  class="admin-input"
                />
              </label>
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Filme longo após (s)</span>
                <input
                  v-model.number="trailerParamsForm.longMinSec"
                  type="number"
                  min="60"
                  max="86400"
                  step="60"
                  class="admin-input"
                />
              </label>
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Passo longo (s)</span>
                <input
                  v-model.number="trailerParamsForm.longStepSec"
                  type="number"
                  min="30"
                  max="3600"
                  step="30"
                  class="admin-input"
                />
              </label>
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Bloco final (s)</span>
                <input
                  v-model.number="trailerParamsForm.tailSec"
                  type="number"
                  min="1"
                  max="600"
                  step="1"
                  class="admin-input"
                />
              </label>
            </div>

            <label v-if="!trailerParamsIsPadrao" class="trailer-reprocess-field trailer-reprocess-field--full">
              <span class="trailer-reprocess-label">Duração máx. saída legado (s)</span>
              <input
                v-model.number="trailerParamsForm.maxOutSec"
                type="number"
                min="30"
                max="900"
                step="5"
                class="admin-input"
              />
            </label>

            <div class="trailer-reprocess-grid">
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Velocidade do trailer (×)</span>
                <select v-model.number="trailerParamsForm.speed" class="admin-input">
                  <option
                    v-for="s in TRAILER_SPEED_OPTIONS"
                    :key="s"
                    :value="s"
                  >
                    {{ s === 1 ? '1× (normal)' : `${s}×` }}
                  </option>
                </select>
              </label>
              <p class="trailer-reprocess-speed-hint">
                <template v-if="shrinkAlreadyDone && trailerParamsForm.speed === 1">
                  1× porque o vídeo já foi shrinkado — não acelera outra vez.
                </template>
                <template v-else-if="trailerParamsForm.speed === 1">
                  1× = mesma velocidade do original.
                </template>
                <template v-else>
                  Áudio e vídeo a {{ trailerParamsForm.speed }}× — duração de cada frame:
                  <strong>{{ formatTrailerFrameFactor(trailerParamsForm.speed) }}</strong>
                  (ajustado automaticamente).
                </template>
              </p>
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Altura máx. (px)</span>
                <input
                  v-model.number="trailerParamsForm.heightPx"
                  type="number"
                  min="144"
                  max="2160"
                  step="1"
                  class="admin-input"
                />
              </label>
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Encoder</span>
                <select v-model="trailerParamsForm.useNvenc" class="admin-input">
                  <option value="auto">Auto (NVENC se disponível)</option>
                  <option value="cpu">CPU (libx264)</option>
                  <option value="nvenc">NVENC (NVIDIA)</option>
                </select>
              </label>
              <label
                v-if="trailerParamsForm.useNvenc !== 'cpu'"
                class="trailer-reprocess-field"
              >
                <span class="trailer-reprocess-label">Preset NVENC</span>
                <select v-model="trailerParamsForm.nvencPreset" class="admin-input">
                  <option v-for="p in TRAILER_NVENC_PRESET_OPTIONS" :key="p" :value="p">{{ p }}</option>
                </select>
              </label>
            </div>
          </div>
          <div v-if="trailerQueue.length" class="shrink-queue">
            <div class="shrink-queue-head">
              <span class="shrink-queue-title">
                Fila {{ trailerQueueDoneCount }}/{{ trailerQueue.length }}
                <template v-if="trailerReprocessBusy"> · a processar</template>
              </span>
              <button
                v-if="trailerQueueDoneCount"
                type="button"
                class="admin-btn admin-btn--ghost admin-btn--sm"
                title="Tira da lista os já concluídos ou falhados (não apaga /historico)"
                @click="clearFinishedTrailerQueue"
              >
                Limpar processados
              </button>
              <button
                v-if="trailerQueuePendingCount"
                type="button"
                class="admin-btn admin-btn--ghost admin-btn--sm"
                @click="clearPendingTrailerQueue"
              >
                Limpar pendentes
              </button>
            </div>
            <ul class="shrink-queue-list">
              <li
                v-for="(item, qi) in trailerQueue"
                :key="item.id"
                class="shrink-queue-item"
                :class="`shrink-queue-item--${item.status}`"
              >
                <span class="shrink-queue-idx">{{ qi + 1 }}.</span>
                <span class="shrink-queue-label" :title="item.mainRel">{{ item.label }}</span>
                <span class="shrink-queue-status">{{ shrinkQueueStatusLabel(item.status) }}</span>
                <button
                  v-if="item.status === 'pending'"
                  type="button"
                  class="admin-btn admin-btn--ghost admin-btn--sm"
                  @click="removeTrailerQueueItem(item.id)"
                >
                  Tirar
                </button>
              </li>
            </ul>
          </div>

          <div class="trailer-reprocess-dialog-actions">
            <button
              type="button"
              class="admin-btn admin-btn--ghost"
              @click="resetTrailerParamsForm"
            >
              Restaurar padrões
            </button>
            <button
              type="button"
              class="admin-btn admin-btn--ghost"
              @click="trailerReprocessDialogOpen = false"
            >
              Fechar
            </button>
            <button
              type="button"
              class="admin-btn admin-btn--primary"
              :disabled="!editorOpenEntry?.hasMain || !canEnqueueCurrentTrailer"
              @click="enqueueCurrentTrailerReprocess"
            >
              Adicionar na fila
            </button>
          </div>
        </div>
      </div>

      <div
        v-show="shrinkInPlaceDialogOpen"
        class="move-title-backdrop"
        @click="shrinkInPlaceDialogOpen = false"
      />
      <div
        v-show="shrinkInPlaceDialogOpen"
        class="trailer-reprocess-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shrink-in-place-dialog-title"
      >
        <div class="trailer-reprocess-dialog-card">
          <div class="session-menu-head">
            <span id="shrink-in-place-dialog-title" class="session-menu-title">Shrink — fila</span>
            <button
              type="button"
              class="session-menu-close"
              aria-label="Fechar"
              @click="shrinkInPlaceDialogOpen = false"
            >
              ×
            </button>
          </div>
          <div class="trailer-reprocess-dialog-body">
            <p class="trailer-reprocess-dialog-hint">
              Adiciona vídeos à fila; processam-se em sequência no servidor (um de cada vez).
              A fila fica guardada em disco — podes dar refresh e continuar a acompanhar.
              Histórico em <NuxtLink to="/historico" class="empty-hint-link">/historico</NuxtLink>.
              Cada um cria <code class="admin-code">shrinked\</code>, faz backup em
              <code class="admin-code">shrinked_backup\*_bak*</code> e <strong>substitui o original</strong>.
              Podes fechar este diálogo sem cancelar a fila.
            </p>
            <p v-if="editorOpenEntry" class="trailer-reprocess-dialog-file">
              Actual: {{ editorOpenEntry.mainFilename }}
            </p>
            <p v-if="shrinkAlreadyDoneHint" class="shrink-already-warn" role="alert">
              <span class="shrink-already-warn-title">Já foi shrinkado</span>
              {{ shrinkAlreadyDoneHint }}
            </p>

            <div class="trailer-reprocess-grid">
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Resolução (altura)</span>
                <select v-model.number="shrinkInPlaceForm.height" class="admin-input">
                  <option
                    v-for="h in SHRINK_IN_PLACE_HEIGHT_OPTIONS"
                    :key="h"
                    :value="h"
                  >
                    {{ SHRINK_IN_PLACE_HEIGHT_LABELS[h] ?? `${h}p` }}
                  </option>
                </select>
              </label>
              <label class="trailer-reprocess-field">
                <span class="trailer-reprocess-label">Velocidade (×)</span>
                <select v-model.number="shrinkInPlaceForm.speed" class="admin-input">
                  <option v-for="s in SHRINK_IN_PLACE_SPEED_OPTIONS" :key="s" :value="s">{{ s }}×</option>
                </select>
              </label>
              <label class="trailer-reprocess-field trailer-reprocess-field--full">
                <span class="trailer-reprocess-label">Codec de vídeo</span>
                <select v-model="shrinkInPlaceForm.codec" class="admin-input">
                  <option v-for="c in SHRINK_IN_PLACE_CODEC_OPTIONS" :key="c.value" :value="c.value">
                    {{ c.label }}
                  </option>
                </select>
              </label>
              <label class="trailer-reprocess-field trailer-reprocess-field--full trailer-reprocess-check">
                <input v-model="shrinkInPlaceForm.prioritizeSize" type="checkbox" />
                <span>Priorizar tamanho (2ª passagem qualidade se a saída ficar grande)</span>
              </label>
            </div>

            <div v-if="shrinkQueue.length" class="shrink-queue">
            <div class="shrink-queue-head">
              <span class="shrink-queue-title">
                Fila {{ shrinkQueueDoneCount }}/{{ shrinkQueue.length }}
                <template v-if="shrinkInPlaceBusy"> · a processar</template>
              </span>
              <button
                v-if="shrinkQueueDoneCount"
                type="button"
                class="admin-btn admin-btn--ghost admin-btn--sm"
                title="Tira da lista os já concluídos ou falhados (não apaga /historico)"
                @click="clearFinishedShrinkQueue"
              >
                Limpar processados
              </button>
              <button
                v-if="shrinkQueuePendingCount"
                type="button"
                class="admin-btn admin-btn--ghost admin-btn--sm"
                @click="clearPendingShrinkQueue"
              >
                Limpar pendentes
              </button>
            </div>
              <ul class="shrink-queue-list">
                <li
                  v-for="(item, qi) in shrinkQueue"
                  :key="item.id"
                  class="shrink-queue-item"
                  :class="`shrink-queue-item--${item.status}`"
                >
                  <span class="shrink-queue-idx">{{ qi + 1 }}.</span>
                  <span class="shrink-queue-label" :title="item.mainRel">{{ item.label }}</span>
                  <span class="shrink-queue-status">{{ shrinkQueueStatusLabel(item.status) }}</span>
                  <button
                    v-if="item.status === 'pending'"
                    type="button"
                    class="admin-btn admin-btn--ghost admin-btn--sm"
                    @click="removeShrinkQueueItem(item.id)"
                  >
                    Tirar
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div class="trailer-reprocess-dialog-actions">
            <button
              type="button"
              class="admin-btn admin-btn--ghost"
              @click="resetShrinkInPlaceForm"
            >
              Restaurar padrões
            </button>
            <button
              type="button"
              class="admin-btn admin-btn--ghost"
              @click="shrinkInPlaceDialogOpen = false"
            >
              Fechar
            </button>
            <button
              type="button"
              class="admin-btn admin-btn--primary"
              :disabled="!editorOpenEntry?.hasMain || !canEnqueueCurrentShrink"
              @click="enqueueCurrentShrinkInPlace"
            >
              Adicionar na fila
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { TrailerListEntry } from '~/composables/useVideoFolder'
import PlayerChromeToolbar from '~/components/player/PlayerChromeToolbar.vue'
import type { PlayerChromeTitle } from '~/components/player/PlayerChromeToolbar.vue'
import {
  MEMORABLE_TAG_NAME,
  PLAYBACK_RATES,
  RECENTS_SESSION_ID,
  SEARCH_SESSION_ID,
  SURPRESA_SESSION_ID,
  LAST_VIEWED_SESSION_ID,
  LAST_VIEWED_LIMIT,
  TRAILER_WATCHED_TAG_NAME,
  apiVideoUrl,
  parseApiVideoUrl,
  catalogPreviewFrameUrl,
  isDedicatedPreviewVideoRel,
  isEntryCompleted,
  isEntryMemorable,
  isEntryPartiallyWatched,
  isEntryTrailerWatched,
  isEntryWatchedClass,
} from '~/composables/useVideoFolder'
import IconTrailerRandom from '~/components/IconTrailerRandom.vue'
import { useSilkTvLayout } from '~/composables/useSilkTvLayout'
import {
  readCatalogSessionPrefs,
  writeCatalogSessionPrefs,
  type CatalogSessionPrefs,
} from '~/composables/useCatalogSessionPrefs'
import { useRecentsCatalogWindow } from '~/composables/useRecentsCatalogWindow'
import { useTvCatalogVirtualGrid } from '~/composables/useTvCatalogVirtualGrid'
import { useTvStageVideo } from '~/composables/useTvStageVideo'
import {
  TRAILER_BAT_PARAMS_DEFAULT,
  TRAILER_COLLECT_LABELS,
  TRAILER_PARAMS_STORAGE_KEY,
  TRAILER_SPEED_OPTIONS,
  formatTrailerFrameFactor,
  normalizeTrailerBatParams,
  trailerParamsFromStorage,
  type TrailerBatParams,
} from '#shared/trailerParams'
import {
  SHRINK_IN_PLACE_CODEC_OPTIONS,
  SHRINK_IN_PLACE_HEIGHT_LABELS,
  SHRINK_IN_PLACE_HEIGHT_OPTIONS,
  SHRINK_IN_PLACE_PARAMS_DEFAULT,
  SHRINK_IN_PLACE_SPEED_OPTIONS,
  normalizeShrinkInPlaceParams,
  type ShrinkInPlaceParams,
} from '#shared/shrinkInPlaceParams'

const { manualTvAssist, isTvLayout } = useSilkTvLayout()
const catalogPrefsEnabled = computed(() => !manualTvAssist.value)

/** Aberto a partir de /duplicados (`?dup=1`) — esconde excluir / mover / editor / shrink. */
const fromDuplicatesLite = computed(() => {
  const v = route.query.dup
  const raw = Array.isArray(v) ? v[0] : v
  const n = String(raw ?? '').toLowerCase()
  return n === '1' || n === 'true' || n === 'yes'
})

const videoPreloadAttr = computed<'auto' | 'metadata'>(() => {
  if (!import.meta.client) return 'metadata'
  if (isTvLayout.value) return 'auto'
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
  if (isTvLayout.value) return false
  const p = serverPlatform.value.toLowerCase()
  return p === 'win32' || p === 'darwin' || p === 'linux'
})

/** Largura mínima para mostrar o botão «Mover de pasta» (evita em telemóvel / ecrã estreito). */
const isWideDesktopUi = ref(false)
const realLibrarySessionCount = computed(() => sessions.value.filter((s) => s.id >= 0).length)
/** Sessões (além da actual). */
const moveTitleDesktopEligible = computed(
  () => !isTvLayout.value && realLibrarySessionCount.value > 1 && isWideDesktopUi.value,
)
/** Desktop largo: atalho para o editor com o vídeo completo actual. */
const editorDesktopEligible = computed(() => !isTvLayout.value && isWideDesktopUi.value)
const editorOpenEntry = computed((): TrailerListEntry | null => {
  if (isTvLayout.value) return null
  if (playerUrl.value && mainVideoEntry.value?.hasMain) return mainVideoEntry.value
  if (selectedEntry.value?.hasMain) return selectedEntry.value
  return null
})

function toPlayerChromeTitle(
  entry: TrailerListEntry | null | undefined,
  inDestaques = false,
): PlayerChromeTitle | null {
  if (!entry) return null
  return {
    displayName: entry.mainFilename || entry.trailerRel,
    mainFilename: entry.mainFilename,
    mainSizeBytes: entry.mainSizeBytes,
    isFavorite: !!entry.isFavorite,
    isMemorable: isEntryMemorable(entry),
    inDestaques,
    hasMain: !!entry.hasMain,
    tags: [...(entry.tags ?? [])],
  }
}

const playerChromeTrailerTitle = computed(() =>
  toPlayerChromeTitle(selectedEntry.value, !!destaqueToolbarActive.value),
)

const playerChromeFullTitle = computed(() =>
  toPlayerChromeTitle(mainVideoEntry.value, !!destaqueToolbarActive.value),
)
const trailerReprocessEligible = computed(
  () => !isTvLayout.value && serverPlatform.value.toLowerCase() === 'win32',
)
const shrinkInPlaceEligible = computed(
  () => !isTvLayout.value && serverPlatform.value.toLowerCase() === 'win32',
)
const trailerReprocessBusy = ref(false)
interface TrailerQueueServerState {
  items: ShrinkQueueItem[]
  updatedAt: number
  busy: boolean
  currentJobId: string | null
  currentItemId: string | null
}
const trailerQueue = ref<ShrinkQueueItem[]>([])
let trailerQueueEs: EventSource | null = null
let trailerQueueMonitorWanted = false
let trailerQueueLastRunningId: string | null = null
const trailerQueuePendingCount = computed(
  () => trailerQueue.value.filter((i) => i.status === 'pending').length,
)
const trailerQueueDoneCount = computed(
  () => trailerQueue.value.filter((i) => i.status === 'done' || i.status === 'failed').length,
)
const canEnqueueCurrentTrailer = computed(() => {
  const entry = editorOpenEntry.value
  if (!entry?.hasMain) return false
  const session = libSession(entry)
  const mainRel = entry.mainRel
  return !trailerQueue.value.some(
    (i) =>
      (i.status === 'pending' || i.status === 'running') &&
      i.session === session &&
      i.mainRel === mainRel,
  )
})
const shrinkInPlaceBusy = ref(false)
type ShrinkLogKind = 'ok' | 'err' | 'skip' | 'meta' | 'plain'
interface ShrinkLogRow {
  text: string
  kind: ShrinkLogKind
}
type ShrinkQueueItemStatus = 'pending' | 'running' | 'done' | 'failed'
interface ShrinkQueueItem {
  id: string
  session: number
  mainRel: string
  trailerRel: string
  label: string
  params: ShrinkInPlaceParams
  status: ShrinkQueueItemStatus
  error?: string
  jobId?: string | null
}
interface ShrinkQueueServerState {
  items: ShrinkQueueItem[]
  updatedAt: number
  busy: boolean
  currentJobId: string | null
  currentItemId: string | null
}
const shrinkQueue = ref<ShrinkQueueItem[]>([])
let shrinkQueueEs: EventSource | null = null
let shrinkQueueMonitorWanted = false
let shrinkQueueLastRunningId: string | null = null
const shrinkQueuePendingCount = computed(
  () => shrinkQueue.value.filter((i) => i.status === 'pending').length,
)
const shrinkQueueDoneCount = computed(
  () => shrinkQueue.value.filter((i) => i.status === 'done' || i.status === 'failed').length,
)
const canEnqueueCurrentShrink = computed(() => {
  const entry = editorOpenEntry.value
  if (!entry?.hasMain) return false
  const session = libSession(entry)
  const mainRel = entry.mainRel
  return !shrinkQueue.value.some(
    (i) =>
      (i.status === 'pending' || i.status === 'running') &&
      i.session === session &&
      i.mainRel === mainRel,
  )
})
function shrinkQueueStatusLabel(s: ShrinkQueueItemStatus): string {
  if (s === 'pending') return 'na fila'
  if (s === 'running') return 'a correr'
  if (s === 'done') return 'ok'
  return 'falhou'
}
const shrinkInPlaceLogLines = ref<ShrinkLogRow[]>([])
const shrinkInPlaceLatestLine = ref('')
const shrinkInPlaceFileLabel = ref('')
const shrinkInPlacePct = ref<number | null>(null)
const shrinkInPlaceLastStatus = ref('')
const shrinkInPlaceErrorSummary = ref('')
const shrinkInPlaceFailed = ref(false)
const shrinkInPlaceLogEl = ref<HTMLElement | null>(null)
const shrinkInPlaceLogCollapsed = ref(false)
const shrinkInPlacePanelVisible = computed(
  () =>
    shrinkInPlaceBusy.value ||
    shrinkInPlaceLogLines.value.length > 0 ||
    shrinkQueue.value.some((i) => i.status === 'pending' || i.status === 'running'),
)
let shrinkInPlaceDurationSec: number | null = null
const SHRINK_LOG_CAP = 250
const shrinkInPlaceSeenSeq = new Set<number>()

function classifyShrinkLogLine(t: string): ShrinkLogKind {
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

function scrollShrinkLogToBottom() {
  void nextTick(() => {
    const el = shrinkInPlaceLogEl.value
    if (!el) return
    el.scrollTop = el.scrollHeight
  })
}

function ingestShrinkLogLine(text: string, seq?: number) {
  if (typeof seq === 'number' && Number.isFinite(seq)) {
    if (shrinkInPlaceSeenSeq.has(seq)) return
    shrinkInPlaceSeenSeq.add(seq)
  }
  const t = String(text ?? '').replace(/\r/g, '').trim()
  if (!t) return
  shrinkInPlaceLatestLine.value = t
  const next = [...shrinkInPlaceLogLines.value, { text: t, kind: classifyShrinkLogLine(t) }]
  if (next.length > SHRINK_LOG_CAP) next.splice(0, next.length - SHRINK_LOG_CAP)
  shrinkInPlaceLogLines.value = next
  scrollShrinkLogToBottom()

  const dur = t.match(/Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/i)
  if (dur?.[1]) {
    const s = parseHhMmSsToSeconds(dur[1])
    if (s !== null && s > 0) shrinkInPlaceDurationSec = s
  }
  const time = t.match(/\btime=(\d+:\d{2}:\d{2}(?:\.\d+)?)/i)
  if (time?.[1] && shrinkInPlaceDurationSec && shrinkInPlaceDurationSec > 0) {
    const cur = parseHhMmSsToSeconds(time[1])
    if (cur !== null) {
      shrinkInPlacePct.value = Math.max(
        0,
        Math.min(99, Math.round((cur / shrinkInPlaceDurationSec) * 100)),
      )
    }
  }
  if (/\[REPLACE\]/i.test(t)) shrinkInPlacePct.value = 96
  else if (/\[OK\]/i.test(t)) shrinkInPlacePct.value = 100
}

function resetShrinkInPlaceProgressUi(fileLabel = '') {
  shrinkInPlaceLogLines.value = []
  shrinkInPlaceLatestLine.value = ''
  shrinkInPlaceFileLabel.value = fileLabel
  shrinkInPlacePct.value = null
  shrinkInPlaceLastStatus.value = ''
  shrinkInPlaceErrorSummary.value = ''
  shrinkInPlaceFailed.value = false
  shrinkInPlaceDurationSec = null
  shrinkInPlaceSeenSeq.clear()
  shrinkInPlaceLogCollapsed.value = false
}

async function copyShrinkInPlaceLog() {
  const text = shrinkInPlaceLogLines.value.map((r) => r.text).join('\n')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    showToast('Log copiado.', 'success')
  } catch {
    showToast('Não foi possível copiar o log.', 'error')
  }
}

const SHRINK_IN_PLACE_STORAGE_KEY = 'video_player_shrink_in_place_params'
const TRAILER_NVENC_PRESET_OPTIONS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'] as const

function loadTrailerParamsFromStorage(): TrailerBatParams {
  if (typeof localStorage === 'undefined') return { ...TRAILER_BAT_PARAMS_DEFAULT }
  return trailerParamsFromStorage(localStorage)
}

function saveTrailerParamsToStorage(p: TrailerBatParams) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TRAILER_PARAMS_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* */
  }
}

function loadShrinkInPlaceParamsFromStorage(): ShrinkInPlaceParams {
  if (typeof localStorage === 'undefined') return { ...SHRINK_IN_PLACE_PARAMS_DEFAULT }
  try {
    const raw = localStorage.getItem(SHRINK_IN_PLACE_STORAGE_KEY)
    if (!raw) return { ...SHRINK_IN_PLACE_PARAMS_DEFAULT }
    return normalizeShrinkInPlaceParams(JSON.parse(raw) as Record<string, unknown>)
  } catch {
    return { ...SHRINK_IN_PLACE_PARAMS_DEFAULT }
  }
}

function saveShrinkInPlaceParamsToStorage(p: ShrinkInPlaceParams) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SHRINK_IN_PLACE_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* */
  }
}

const trailerReprocessDialogOpen = ref(false)
const shrinkInPlaceDialogOpen = ref(false)
const trailerParamsForm = ref<TrailerBatParams>(loadTrailerParamsFromStorage())
const shrinkInPlaceForm = ref<ShrinkInPlaceParams>(loadShrinkInPlaceParamsFromStorage())
const trailerParamsIsPadrao = computed(() => trailerParamsForm.value.collect === 'padrao')
const trailerParamsIsLegado = computed(() => trailerParamsForm.value.collect === 'legado')
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

/** Botões ▲▼ + «Topo da lista» + scrollbar escondida: só `?tv=1` (ou guardado em localStorage até `?tv=0`). */
const showTvCatalogScrollAssist = computed(() => manualTvAssist.value)

const sessions = ref<VideoSessionTab[]>([])
const sessionIndex = ref(0)

function libSession(entry: TrailerListEntry | null | undefined): number {
  if (!entry) {
    const si = sessionIndex.value
    return typeof si === 'number' && Number.isFinite(si) && si >= 0 ? Math.floor(si) : 0
  }
  const n = entry.librarySession
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return Math.floor(n)
  if (isAggregatedLibrarySession()) {
    const rel = entry.trailerRel
    for (const x of fullEntries.value) {
      const xs = x.librarySession
      if (
        typeof xs === 'number' &&
        Number.isFinite(xs) &&
        xs >= 0 &&
        trailerRelMatchesFocus(x.trailerRel, rel)
      ) {
        return Math.floor(xs)
      }
    }
  }
  const si = sessionIndex.value
  if (typeof si === 'number' && Number.isFinite(si) && si >= 0) return Math.floor(si)
  return 0
}

/** Destaques, Surpresa e Últimos vistos — entradas de várias bibliotecas com `librarySession`. */
function isAggregatedLibrarySession(si: number = sessionIndex.value): boolean {
  return (
    si === RECENTS_SESSION_ID || si === SURPRESA_SESSION_ID || si === LAST_VIEWED_SESSION_ID
  )
}

function aggregatedListTagForSession(si: number = sessionIndex.value): string {
  if (si === RECENTS_SESSION_ID) return 'Destaques'
  if (si === SURPRESA_SESSION_ID) return 'Surpresa'
  if (si === LAST_VIEWED_SESSION_ID) return 'Últimos vistos'
  return ''
}

/** Rótulo da pasta/biblioteca no menu (`sessions`), por índice real da sessão (≥0). */
function libraryFolderLabel(sessionId: number): string {
  const row = sessions.value.find((s) => s.id === sessionId)
  const label = row?.label?.trim()
  if (label) return label
  if (sessionId >= 0) return `Biblioteca ${sessionId}`
  return ''
}

function libraryFolderSortRank(sessionId: number): number {
  const idx = sessions.value.findIndex((s) => s.id === sessionId)
  return idx >= 0 ? idx : 10_000 + sessionId
}

/** Agrupa entradas multi-biblioteca pela ordem das pastas no menu. */
function sortEntriesGroupedByLibraryFolder(
  list: TrailerListEntry[],
  withinFolder: (a: TrailerListEntry, b: TrailerListEntry) => number,
): TrailerListEntry[] {
  return [...list].sort((a, b) => {
    const ra = libraryFolderSortRank(libSession(a))
    const rb = libraryFolderSortRank(libSession(b))
    if (ra !== rb) return ra - rb
    return withinFolder(a, b)
  })
}

const recentsWithinFolderSort = (a: TrailerListEntry, b: TrailerListEntry) => {
  const ta = a.highlightedAtMs ?? 0
  const tb = b.highlightedAtMs ?? 0
  if (ta !== tb) return tb - ta
  const sa = libSession(a)
  const sb = libSession(b)
  if (sa !== sb) return sa - sb
  return a.trailerRel.localeCompare(b.trailerRel, undefined, { sensitivity: 'base' })
}

const surpriseWithinFolderSort = (a: TrailerListEntry, b: TrailerListEntry) => {
  const ta = a.highlightedAtMs ?? 0
  const tb = b.highlightedAtMs ?? 0
  if (ta !== tb) return ta - tb
  return a.mainRel.localeCompare(b.mainRel, undefined, { sensitivity: 'base' })
}

/** Chaves `session:trailerRel` (= estado em SQLite) para ícone olho aberto/fechado. */
const recentPlaybackKeyList = ref<string[]>([])
/** Evita cliques duplos no olho Destaques enquanto a API responde. */
const recentsMutationBusy = ref(false)

/** Mesma normalização que `server/utils/recentPlaybackDb.normalizeTrailerRel` para bater com SQLite. */
function normalizeTrailerRelForRecentKey(rel: string): string {
  return String(rel ?? '').trim().replace(/\\/g, '/')
}

function playbackRecentKey(session: number, trailerRel: string): string {
  const s = Math.max(0, Math.floor(session))
  return `${s}:${normalizeTrailerRelForRecentKey(trailerRel)}`
}

function trailerRelMatchesFocus(a: string, b: string): boolean {
  const na = a.trim().replace(/\\/g, '/').toLowerCase()
  const nb = b.trim().replace(/\\/g, '/').toLowerCase()
  return na === nb
}

function catalogRelStem(rel: string): string {
  let n = rel.trim().replace(/\\/g, '/').toLowerCase()
  if (n.startsWith('trailers/')) n = n.slice('trailers/'.length)
  const slash = n.lastIndexOf('/')
  const base = slash >= 0 ? n.slice(slash + 1) : n
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function normalizeCatalogPath(rel: string): string {
  return rel.trim().replace(/\\/g, '/').toLowerCase()
}

function entryMatchesMainRel(e: TrailerListEntry, mainRel: string): boolean {
  const n = normalizeCatalogPath(mainRel)
  if (!n) return false
  const main = normalizeCatalogPath(String(e.mainRel ?? ''))
  if (main && main === n) return true
  const baseN = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
  const baseM = main.includes('/') ? main.slice(main.lastIndexOf('/') + 1) : main
  if (baseN && baseM && baseN === baseM) return true
  const stem = catalogRelStem(n)
  if (!stem) return false
  if (catalogRelStem(main) === stem || catalogRelStem(e.trailerRel) === stem) return true
  if (main && (main.endsWith(`/${n}`) || n.endsWith(`/${main}`))) return true
  if (baseN && main.endsWith(`/${baseN}`)) return true
  return false
}

function entryMatchesShareRel(e: TrailerListEntry, rel: string): boolean {
  if (!rel.trim()) return false
  if (trailerRelMatchesFocus(e.trailerRel, rel)) return true
  const n = normalizeCatalogPath(rel)
  const main = normalizeCatalogPath(String(e.mainRel ?? ''))
  if (main && (main === n || `trailers/${main}` === n)) return true
  if (main && n.startsWith('trailers/') && entryMatchesMainRel(e, n.slice('trailers/'.length))) {
    return true
  }
  const stem = catalogRelStem(rel)
  if (!stem) return false
  return catalogRelStem(e.trailerRel) === stem || (main ? catalogRelStem(main) === stem : false)
}

function clearCatalogFiltersForShareFocus() {
  catalogTagFilter.value = null
  folderFilterInput.value = ''
  catalogOriginFilter.value = null
  favoriteCatalogFilter.value = 'all'
  destaquesCatalogFilter.value = 'all'
  showOnlyWatched.value = false
}

function softReloadCatalogKeepFocus() {
  const keep =
    (focusedIndex.value !== null ? entries.value[focusedIndex.value]?.trailerRel : null) ||
    resolvePlaybackEntryFromUrls()?.trailerRel ||
    null
  void loadTrailers(keep ? { preserveFocusTrailerRel: keep } : undefined)
}

function focusEntryByShareTarget(opts: { rel?: string; main?: string }): boolean {
  const rel = typeof opts.rel === 'string' ? opts.rel.trim() : ''
  const main = typeof opts.main === 'string' ? opts.main.trim() : ''
  if (!rel && !main) return false

  const match = (e: TrailerListEntry) => {
    if (rel && entryMatchesShareRel(e, rel)) return true
    if (main && entryMatchesMainRel(e, main)) return true
    return false
  }

  let ix = entries.value.findIndex(match)
  if (ix < 0) {
    if (!fullEntries.value.some(match)) return false
    clearCatalogFiltersForShareFocus()
    ix = entries.value.findIndex(match)
  }
  if (ix < 0) return false
  setTrailerIndex(ix)
  return true
}

function isPlaybackTitleInRecentList(entry: TrailerListEntry | null | undefined): boolean {
  if (!entry) return false
  const ls = libSession(entry)
  const rel = entry.trailerRel
  const keys = recentPlaybackKeyList.value
  if (keys.includes(playbackRecentKey(ls, rel))) return true
  for (const key of keys) {
    const colon = key.indexOf(':')
    if (colon <= 0) continue
    const s = Number(key.slice(0, colon))
    if (!Number.isFinite(s)) continue
    const kRel = key.slice(colon + 1)
    if (s === ls && trailerRelMatchesFocus(kRel, rel)) return true
  }
  return false
}

function syncRecentPlaybackKey(session: number, trailerRel: string, inList: boolean) {
  const key = playbackRecentKey(session, trailerRel)
  const cur = recentPlaybackKeyList.value
  if (inList) {
    if (!cur.includes(key)) recentPlaybackKeyList.value = [...cur, key]
    return
  }
  recentPlaybackKeyList.value = cur.filter((k) => k !== key)
}

function destaqueFetchErrorMessage(err: unknown, fallback: string): string {
  const ex = err as {
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

async function refreshRecentPlaybackKeys() {
  try {
    const data = await $fetch<{ items: { session: number; trailerRel: string }[] }>('/api/library/recent-list')
    const next: string[] = []
    for (const r of data.items ?? []) next.push(playbackRecentKey(r.session, r.trailerRel))
    recentPlaybackKeyList.value = next
  } catch {
    /* manter último estado */
  }
}

function applyDestaqueTrailerRelLocal(session: number, fromRel: string, toRel: string) {
  const canonical = normalizeTrailerRelForRecentKey(toRel)
  if (!canonical.startsWith('trailers/')) return
  for (const e of fullEntries.value) {
    if (libSession(e) === session && trailerRelMatchesFocus(e.trailerRel, fromRel)) {
      e.trailerRel = canonical
    }
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
    await refreshRecentPlaybackKeys()
    const neighborRel =
      entries.value.length > 1
        ? (entries.value[i + 1] ?? entries.value[i - 1])?.trailerRel ?? undefined
        : undefined
    await loadTrailers(
      typeof neighborRel === 'string' ? { preserveFocusTrailerRel: neighborRel } : {},
    )
  } catch (err: unknown) {
    showToast(destaqueFetchErrorMessage(err, 'Não foi possível remover de Destaques.'), 'error')
  } finally {
    recentsMutationBusy.value = false
  }
}

function removeFocusedFromRecents() {
  const i = focusedIndex.value
  if (i === null) return
  void removeFromRecentsAtIndex(i)
}

/** Descarta respostas de loadTrailers fora de ordem (evita reload lento sobrepor-se a um mais recente). */
let catalogLoadToken = 0

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

const recentsCatalog = useRecentsCatalogWindow(fullEntries)
const recentsTotal = recentsCatalog.total
const recentsHasMore = recentsCatalog.hasMore
const recentsLoadingMore = recentsCatalog.loadingMore
const recentsLoadStatusLine = recentsCatalog.loadStatusLine
const recentsPaginationEnabled = recentsCatalog.paginationEnabled
const recentsLoadSentinel = ref<HTMLElement | null>(null)
const tvMinimalRailScroll = ref<HTMLElement | null>(null)
let recentsLoadObserver: IntersectionObserver | null = null

/** Modo TV (`?tv=1`): uma imagem estática na grelha; sem vídeo inline no cartão. */
const catalogThumbMaxSlots = computed(() => (isTvLayout.value ? 1 : 4))
const catalogThumbInlineVideo = computed(
  () => false,
  /* legado: slideshow preview/ no tile; desactivado — só miniaturas JPEG + trailer no palco */
)
/** Filtro da grelha por tag; `null` = mostrar todos. */
const catalogTagFilter = ref<string | null>(null)
/** Filtro por pasta/biblioteca de origem (só Destaques). */
const catalogOriginFilter = ref<string | null>(null)
/** Caixa de filtro local (só a lista da sessão/pasta actual). */
const folderFilterInput = ref('')
const folderFilterMode = ref<'files' | 'tags'>('tags')
/**
 * Filtro "Só vistos": quando `true`, restringe o catálogo aos vídeos com
 * tag `concluido` OU `memoravel`. Combina com `catalogTagFilter` (AND).
 */
const showOnlyWatched = ref(false)

/** Filtro triplo no catálogo: todos → só → excluir → todos. */
type CatalogTriFilter = 'all' | 'only' | 'exclude'

const favoriteCatalogFilter = ref<CatalogTriFilter>('all')
const destaquesCatalogFilter = ref<CatalogTriFilter>('all')

function cycleCatalogTriFilter(current: CatalogTriFilter): CatalogTriFilter {
  if (current === 'all') return 'only'
  if (current === 'only') return 'exclude'
  return 'all'
}

type CatalogSortKey = 'name' | 'date' | 'size' | 'favorite'
const CATALOG_SORT_STORAGE_KEY = 'video_player_catalog_sort'

function readStoredCatalogSort(): { key: CatalogSortKey; dir: 'asc' | 'desc' } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CATALOG_SORT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { key?: unknown; dir?: unknown }
    const key = parsed.key
    const dir = parsed.dir
    if (key !== 'name' && key !== 'date' && key !== 'size' && key !== 'favorite') return null
    if (dir !== 'asc' && dir !== 'desc') return null
    return { key, dir }
  } catch {
    return null
  }
}

function writeStoredCatalogSort(key: CatalogSortKey, dir: 'asc' | 'desc') {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CATALOG_SORT_STORAGE_KEY, JSON.stringify({ key, dir }))
  } catch {
    /* ignore */
  }
}

const storedCatalogSort = readStoredCatalogSort()
const catalogSortKey = ref<CatalogSortKey>(storedCatalogSort?.key ?? 'size')
const catalogSortDir = ref<'asc' | 'desc'>(storedCatalogSort?.dir ?? 'desc')

function applyDestaquesCatalogSortDefaults() {
  catalogSortKey.value = 'date'
  catalogSortDir.value = 'desc'
}

function applyFolderCatalogSortDefaults() {
  const stored = readStoredCatalogSort()
  if (stored) {
    catalogSortKey.value = stored.key
    catalogSortDir.value = stored.dir
    return
  }
  catalogSortKey.value = 'size'
  catalogSortDir.value = 'desc'
}

function compareCatalogEntries(a: TrailerListEntry, b: TrailerListEntry): number {
  const fixedOrder = isAggregatedLibrarySession()

  if (!fixedOrder) {
    const wa = isEntryWatchedClass(a)
    const wb = isEntryWatchedClass(b)
    if (wa !== wb) return wa ? 1 : -1
  }

  if (fixedOrder) {
    const ta = a.highlightedAtMs ?? 0
    const tb = b.highlightedAtMs ?? 0
    const surpriseAsc = sessionIndex.value === SURPRESA_SESSION_ID
    if (ta !== tb) {
      if (surpriseAsc) return ta < tb ? -1 : ta > tb ? 1 : 0
      return ta < tb ? 1 : ta > tb ? -1 : 0
    }
    return a.mainRel.localeCompare(b.mainRel, undefined, { sensitivity: 'base' })
  }

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
  if (catalogSortKey.value === 'favorite') {
    // Favoritos com timestamp primeiro; não-favoritos vão no fim.
    const fa = a.favoritedAtMs ?? 0
    const fb = b.favoritedAtMs ?? 0
    const hasFavA = a.isFavorite === true && fa > 0
    const hasFavB = b.isFavorite === true && fb > 0
    if (hasFavA !== hasFavB) return hasFavA ? -dir : dir
    if (fa !== fb) return dir * (fa < fb ? -1 : fa > fb ? 1 : 0)
    if (a.hasMain !== b.hasMain) return a.hasMain ? -1 : 1
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
  const origin = catalogOriginFilter.value
  const raw = fullEntries.value
  const si = sessionIndex.value
  let filtered = tag
    ? raw.filter((e) => {
        const list = isAggregatedLibrarySession(si) ? entryUserTags(e) : (e.tags ?? [])
        return list.includes(tag)
      })
    : raw
  // Destaques: filtro ORIGEM só no servidor (`librarySession`); evita lista vazia com filtro duplo.
  if (origin && si !== RECENTS_SESSION_ID) {
    const want = origin.trim().toLowerCase()
    filtered = filtered.filter((e) =>
      entryOriginTags(e).some((t) => t.trim().toLowerCase() === want),
    )
  }
  const folderQ = folderFilterInput.value.trim().toLowerCase()
  if (folderQ && si !== SEARCH_SESSION_ID) {
    if (folderFilterMode.value === 'tags') {
      filtered = filtered.filter((e) => {
        const list = isAggregatedLibrarySession(si) ? entryUserTags(e) : (e.tags ?? [])
        return list.some((t) => t.toLowerCase().includes(folderQ))
      })
    } else {
      filtered = filtered.filter((e) => {
        const hay = `${e.label ?? ''} ${e.mainFilename ?? ''} ${e.trailerRel ?? ''} ${e.mainRel ?? ''}`
        return hay.toLowerCase().includes(folderQ)
      })
    }
  }
  if (showOnlyWatched.value) {
    filtered = filtered.filter(isEntryWatchedClass)
  }
  if (favoriteCatalogFilter.value === 'only') {
    filtered = filtered.filter((e) => e.isFavorite === true)
  } else if (favoriteCatalogFilter.value === 'exclude') {
    filtered = filtered.filter((e) => e.isFavorite !== true)
  }
  if (destaquesCatalogFilter.value === 'only') {
    filtered = filtered.filter((e) => isPlaybackTitleInRecentList(e))
  } else if (destaquesCatalogFilter.value === 'exclude') {
    filtered = filtered.filter((e) => !isPlaybackTitleInRecentList(e))
  }
  // Destaques / Últimos vistos: ordem global por data de entrada (mais recente primeiro).
  if (si === RECENTS_SESSION_ID || si === LAST_VIEWED_SESSION_ID) {
    return [...filtered].sort(recentsWithinFolderSort)
  }
  if (si === SURPRESA_SESSION_ID) {
    return sortEntriesGroupedByLibraryFolder(filtered, surpriseWithinFolderSort)
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
const destaquesCount = computed(() => {
  if (sessionIndex.value === RECENTS_SESSION_ID && recentsTotal.value > 0) {
    return recentsTotal.value
  }
  return fullEntries.value.filter((e) => isPlaybackTitleInRecentList(e)).length
})

const favoriteCatalogFilterIcon = computed(() => {
  if (favoriteCatalogFilter.value === 'only') return '★'
  if (favoriteCatalogFilter.value === 'exclude') return '☆'
  return '☆'
})

const favoriteCatalogFilterLabel = computed(() => {
  if (favoriteCatalogFilter.value === 'only') return 'Só favoritos'
  if (favoriteCatalogFilter.value === 'exclude') return 'Sem favoritos'
  return 'Favoritos'
})

const favoriteCatalogFilterTitle = computed(() => {
  const n = favoriteCount.value
  if (favoriteCatalogFilter.value === 'all') {
    return n > 0
      ? `Filtrar favoritos (${n}): clicar para mostrar só favoritos`
      : 'Filtrar favoritos: clicar para mostrar só favoritos'
  }
  if (favoriteCatalogFilter.value === 'only') {
    return 'A mostrar só favoritos — clicar para ocultar favoritos'
  }
  return 'A ocultar favoritos — clicar para mostrar todos'
})

const destaquesCatalogFilterLabel = computed(() => {
  if (destaquesCatalogFilter.value === 'only') return 'Só destaques'
  if (destaquesCatalogFilter.value === 'exclude') return 'Sem destaques'
  return 'Destaques'
})

const destaquesCatalogFilterTitle = computed(() => {
  const n = destaquesCount.value
  if (destaquesCatalogFilter.value === 'all') {
    return n > 0
      ? `Filtrar Destaques (${n}): clicar para mostrar só destaques`
      : 'Filtrar Destaques: clicar para mostrar só destaques'
  }
  if (destaquesCatalogFilter.value === 'only') {
    return 'A mostrar só Destaques — clicar para ocultar destaques'
  }
  return 'A ocultar Destaques — clicar para mostrar todos'
})

const catalogSortDateTitle = computed(() =>
  sessionIndex.value === RECENTS_SESSION_ID
    ? 'Ordenar por data em que o título foi adicionado a Destaques. Voltar a clicar inverte.'
    : sessionIndex.value === LAST_VIEWED_SESSION_ID
      ? 'Ordenar por data da última reprodução do trailer. Voltar a clicar inverte.'
      : 'Ordenar por data do ficheiro completo (criação quando disponível). Voltar a clicar inverte.',
)

const sessionMenuTopTags = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of fullEntries.value) {
    const list =
      isAggregatedLibrarySession() ? entryUserTags(entry) : (entry.tags ?? [])
    for (const t of list) {
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

/** Bibliotecas do menu em Destaques (API: lista SQLite completa, não só a janela em memória). */
const sessionMenuOriginTags = computed(() => {
  if (sessionIndex.value !== RECENTS_SESSION_ID) return []
  return recentsCatalog.originCounts.value
})

/** Tags ORIGEM no modo TV — só Destaques. */
const tvOriginTags = computed(() => {
  if (!isTvLayout.value || sessionIndex.value !== RECENTS_SESSION_ID) return []
  return sessionMenuOriginTags.value
})

/** Sessão da biblioteca (menu) para o filtro ORIGEM activo em Destaques. */
function recentsLibrarySessionFilter(): number | null {
  const tag = catalogOriginFilter.value?.trim()
  if (!tag) return null
  const fromApi = recentsCatalog.originCounts.value.find((r) => r.tag === tag)
  if (fromApi && fromApi.session >= 0) return fromApi.session
  const sid = sessions.value.find((s) => s.id >= 0 && s.label?.trim() === tag)?.id
  return sid !== undefined && sid >= 0 ? sid : null
}

function syncRecentsOriginApiFilter() {
  recentsCatalog.setLibrarySessionFilter(recentsLibrarySessionFilter())
}
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

function captureCatalogFilterFocusSnapshot() {
  return {
    prevFocusedRel:
      focusedIndex.value !== null && entries.value[focusedIndex.value]
        ? entries.value[focusedIndex.value].trailerRel
        : null,
    wasFullRel:
      playerUrl.value && activeIndex.value !== null && entries.value[activeIndex.value]
        ? entries.value[activeIndex.value].trailerRel
        : null,
  }
}

function cycleFavoriteCatalogFilter() {
  const { prevFocusedRel, wasFullRel } = captureCatalogFilterFocusSnapshot()
  favoriteCatalogFilter.value = cycleCatalogTriFilter(favoriteCatalogFilter.value)
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

function resetFavoriteCatalogFilter() {
  const { prevFocusedRel, wasFullRel } = captureCatalogFilterFocusSnapshot()
  favoriteCatalogFilter.value = 'all'
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

function cycleDestaquesCatalogFilter() {
  const { prevFocusedRel, wasFullRel } = captureCatalogFilterFocusSnapshot()
  destaquesCatalogFilter.value = cycleCatalogTriFilter(destaquesCatalogFilter.value)
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

function resetDestaquesCatalogFilter() {
  const { prevFocusedRel, wasFullRel } = captureCatalogFilterFocusSnapshot()
  destaquesCatalogFilter.value = 'all'
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

function captureEntryRel(idx: number | null): string | null {
  if (idx === null) return null
  return entries.value[idx]?.trailerRel ?? null
}

function cycleCatalogSort(key: CatalogSortKey) {
  if (isAggregatedLibrarySession()) {
    if (sessionIndex.value === RECENTS_SESSION_ID || sessionIndex.value === LAST_VIEWED_SESSION_ID) {
      applyDestaquesCatalogSortDefaults()
    }
    return
  }

  const relFocus = captureEntryRel(focusedIndex.value)
  const relActive = playerUrl.value ? captureEntryRel(activeIndex.value) : null
  const relInline = captureEntryRel(gridInlinePreviewIndex.value)
  const relGallery = captureEntryRel(catalogGalleryIndex.value)

  if (catalogSortKey.value === key) {
    catalogSortDir.value = catalogSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    catalogSortKey.value = key
    catalogSortDir.value = key === 'name' ? 'asc' : 'desc'
  }
  writeStoredCatalogSort(catalogSortKey.value, catalogSortDir.value)

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
const catalogGateRequired = ref(false)
const catalogUnlocked = ref(true)
const catalogGatePassword = ref('')
const catalogGateError = ref('')
const catalogGateBusy = ref(false)
const catalogGateChecking = ref(true)
const catalogGateInputRef = ref<HTMLInputElement | null>(null)
const catalogGateVisible = computed(
  () =>
    !manualTvAssist.value &&
    !isTvLayout.value &&
    (catalogGateChecking.value || (catalogGateRequired.value && !catalogUnlocked.value)),
)

const focusedIndex = ref<number | null>(null)
const activeIndex = ref<number | null>(null)

const previewUrl = ref<string | null>(null)
const previewVideoRef = ref<HTMLVideoElement | null>(null)
/** Contentor do trailer para fullscreen com overlay (não só o elemento vídeo). */
const previewFullscreenWrapRef = ref<HTMLElement | null>(null)
/** Trailer em ecrã inteiro no contentor: overlay quando `fullscreenElement` é o wrap. */
const trailerStageFullscreen = ref(false)
/** Mobile / fallback: fullscreen só no `<video>` — overlay em `Teleport` para o `body`. */
const trailerPreviewVideoFullscreen = ref(false)

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

const {
  tvStageVideoRef,
  tvStageVideoSrc,
  tvStageIsMain,
  releaseVideoElement,
} = useTvStageVideo(isTvLayout, previewUrl, playerUrl)

function mainStageVideoEl(): HTMLVideoElement | null {
  if (isTvLayout.value) return tvMinimalVideoRef.value
  return mainVideoRef.value
}

function stageVideoEl(): HTMLVideoElement | null {
  if (isTvLayout.value) return tvMinimalVideoRef.value
  return playerUrl.value ? mainVideoRef.value : previewVideoRef.value
}

function previewStageVideoEl(): HTMLVideoElement | null {
  if (isTvLayout.value) return tvMinimalVideoRef.value
  return previewVideoRef.value
}

const {
  catalogGridRenderItems,
  tvGridPaddingTopPx,
  tvGridPaddingBottomPx,
} = useTvCatalogVirtualGrid(isTvLayout, entries, focusedIndex)

type CatalogGridDisplayItem =
  | { kind: 'folder-header'; sessionId: number; label: string }
  | { kind: 'tile'; entry: TrailerListEntry; index: number }

const showCatalogFolderHeaders = computed(
  () => sessionIndex.value === SURPRESA_SESSION_ID && !isTvLayout.value,
)

/** Meta «origem» no cartão — Destaques e Surpresa/TV; separadores de pasta só na Surpresa desktop. */
const showCatalogTileOriginMeta = computed(() => {
  const si = sessionIndex.value
  if (si === RECENTS_SESSION_ID) return true
  if (si === SURPRESA_SESSION_ID || si === LAST_VIEWED_SESSION_ID) {
    return !showCatalogFolderHeaders.value
  }
  return false
})

function catalogGridTileTitle(entry: TrailerListEntry): string {
  const size = formatSize(entry.trailerSizeBytes)
  const si = sessionIndex.value
  const lib = libraryFolderLabel(libSession(entry))
  if (si === RECENTS_SESSION_ID) {
    return `${lib} · ${entry.mainFilename} · ${size}`
  }
  if (si === SURPRESA_SESSION_ID || si === LAST_VIEWED_SESSION_ID) {
    return `${aggregatedListTagForSession()} · ${lib} · ${entry.mainFilename} · ${size}`
  }
  return `${entry.mainFilename} · ${size}`
}

const catalogGridDisplayItems = computed((): CatalogGridDisplayItem[] => {
  const rows = catalogGridRenderItems.value
  if (!showCatalogFolderHeaders.value) {
    return rows.map((row) => ({ kind: 'tile' as const, entry: row.entry, index: row.index }))
  }
  const out: CatalogGridDisplayItem[] = []
  let lastSession: number | null = null
  for (const row of rows) {
    const sid = libSession(row.entry)
    if (sid !== lastSession) {
      out.push({ kind: 'folder-header', sessionId: sid, label: libraryFolderLabel(sid) })
      lastSession = sid
    }
    out.push({ kind: 'tile', entry: row.entry, index: row.index })
  }
  return out
})

/** Modo TV minimal: um unico video no palco (sem grelha). */
const tvMinimalVideoRef = ref<HTMLVideoElement | null>(null)

const tvMinimalVideoSrc = computed(() => {
  if (!isTvLayout.value) return null
  if (playerUrl.value) return playerUrl.value
  if (previewUrl.value) return previewUrl.value
  return null
})

const tvMinimalIsFull = computed(() => isTvLayout.value && !!playerUrl.value)

const tvMinimalCaption = computed(() => {
  const e =
    tvMinimalIsFull.value && activeIndex.value !== null
      ? entries.value[activeIndex.value]
      : selectedEntry.value
  if (!e) return ''
  return e.label?.trim() || e.mainFilename || ''
})

function applyTvMinimalVideoSrc(url: string | null) {
  const v = tvMinimalVideoRef.value
  if (!v) return
  releaseVideoElement(v)
  if (!url) return
  v.src = url
  v.load()
}

watch(
  tvMinimalVideoSrc,
  (url) => {
    if (!isTvLayout.value) return
    void nextTick(() => applyTvMinimalVideoSrc(url))
  },
  { flush: 'post' },
)

watch(isTvLayout, (on, wasOn) => {
  if (on) {
    void nextTick(() => applyTvMinimalVideoSrc(tvMinimalVideoSrc.value))
  } else {
    releaseVideoElement(tvMinimalVideoRef.value)
  }
  if (
    wasOn !== undefined &&
    on !== wasOn &&
    sessionIndex.value === RECENTS_SESSION_ID &&
    sessions.value.length
  ) {
    const rel =
      focusedIndex.value !== null
        ? entries.value[focusedIndex.value]?.trailerRel
        : undefined
    void loadTrailers(
      typeof rel === 'string' ? { preserveFocusTrailerRel: rel } : {},
    )
  }
})

/** Arranca o trailer no índice (modo TV só vídeo). */
function ensureTvMinimalPlayback(index = 0) {
  if (!isTvLayout.value) return
  teardownRecentsLoadObserver()
  const list = entries.value
  if (!list.length) {
    previewUrl.value = null
    playerUrl.value = null
    focusedIndex.value = null
    applyTvMinimalVideoSrc(null)
    return
  }
  const i = Math.min(Math.max(0, Math.floor(index)), list.length - 1)
  const next = list[i]
  const playing = resolvePlaybackEntryFromUrls()
  if (
    playerUrl.value &&
    playing &&
    next &&
    trailerRelMatchesFocus(playing.trailerRel, next.trailerRel) &&
    libSession(playing) === libSession(next)
  ) {
    focusedIndex.value = i
    activeIndex.value = i
    return
  }
  playerUrl.value = null
  activeIndex.value = null
  gridInlinePreviewIndex.value = null
  focusedIndex.value = i
  setPreviewForIndex(i)
  void nextTick(() => {
    if (i === 0 && sessionIndex.value === RECENTS_SESSION_ID) {
      const root = tvMinimalRailScroll.value
      if (root) root.scrollTop = 0
    }
    applyTvMinimalVideoSrc(tvMinimalVideoSrc.value)
  })
  if (import.meta.client) {
    console.info(`[VP TV] trailer ${i + 1}/${list.length}: ${list[i]?.label ?? ''}`)
  }
}

function tvMinimalPrev() {
  goToPrevTrailer()
}

function tvMinimalNext() {
  goToNextTrailer()
}

function tvMinimalSelectIndex(i: number) {
  if (!entries.value[i]) return
  ensureTvMinimalPlayback(i)
  void nextTick(() => {
    const root = tvMinimalRailScroll.value
    const btn = root?.querySelectorAll<HTMLElement>('.tv-minimal-thumb')[i]
    btn?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  })
}

function onTvMinimalLoadedMetadata() {
  if (!isTvLayout.value || !playerUrl.value) return
  onMainVideoLoadedMetadata()
}

function onTvMinimalLoadedData() {
  if (!isTvLayout.value) return
  errorMsg.value = ''
  const el = tvMinimalVideoRef.value
  if (!el) return
  if (playerUrl.value) {
    el.playbackRate = fastPlayEnabled.value ? fastPlayRate.value : playbackRate.value
  } else {
    el.playbackRate = playbackRate.value
  }
  void el.play().catch(() => {})
}

function onTvMinimalPlay() {
  syncMainVideoPausedForUi()
  if (!playerUrl.value) recordTrailerLastViewed(selectedEntry.value)
}

function onTvMinimalTimeUpdate() {
  if (!isTvLayout.value) return
  if (!playerUrl.value) {
    recordTrailerLastViewed(selectedEntry.value)
    return
  }
  onMainVideoTimeUpdate()
}

function onTvMinimalSeeked() {
  if (!isTvLayout.value || !playerUrl.value) return
  onMainVideoSeeked()
}

function onTvMinimalSurfaceClick() {
  if (!isTvLayout.value) return
  if (playerUrl.value) onMainVideoSurfaceClick()
}

function onTvMinimalEnded() {
  if (!isTvLayout.value) return
  if (playerUrl.value) {
    onMainVideoEnded()
    return
  }
  void advanceAfterTrailerEnded()
}

async function onTvMinimalBackToTrailer() {
  await closeFullVideo()
  void nextTick(() => applyTvMinimalVideoSrc(tvMinimalVideoSrc.value))
}

const playbackRate = ref(isTvLayout.value ? 0.8 : 1)
const fastPlayEnabled = ref(false)

const fastPlayRate = ref(2)
const fastPlayStepSeconds = ref(60)
const fastPlayWindowSeconds = ref(10)
const fastPlayLastMinuteSeconds = ref(60)
const fastPlayFullscreenOn = ref(true)
let fastPlaySegmentStartAt = 0
let fastPlayProgrammaticSeek = false

/** FAST: sem controlos nativos enquanto toca; com pausa mostra a barra (progresso / seek). */
const mainVideoPausedForUi = ref(false)

function syncMainVideoPausedForUi() {
  const v = playerUrl.value ? mainStageVideoEl() : mainVideoRef.value
  if (!v) {
    mainVideoPausedForUi.value = false
    return
  }
  mainVideoPausedForUi.value = v.paused || v.ended
}

const mainVideoNativeControls = computed(
  () => !fastPlayEnabled.value || mainVideoPausedForUi.value,
)

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
  if (!(v instanceof HTMLVideoElement)) return
  v.play().catch(() => {})
}

function onGridInlinePreviewPlay() {
  const i = gridInlinePreviewIndex.value
  if (i === null) return
  recordTrailerLastViewed(entries.value[i] ?? null)
}

function onGridInlinePreviewTimeUpdate() {
  const i = gridInlinePreviewIndex.value
  if (i === null) return
  recordTrailerLastViewed(entries.value[i] ?? null)
}

function onCatalogThumbClick(i: number) {
  const e = entries.value[i]
  if (!e?.previewRel && !e?.trailerRel) return
  if (!catalogThumbInlineVideo.value) {
    onListItemClick(i)
    return
  }
  if (gridInlinePreviewIndex.value === i) {
    onListItemClick(i)
    return
  }
  gridInlinePreviewIndex.value = i
}

const theaterMode = ref(false)
const sessionMenuOpen = ref(false)
const trailerTagPanelOpen = ref(false)
const trailerTagsHidden = ref(false)
const trailerControlsCollapsed = ref(false)
const catalogChromeHidden = ref(false)

const UI_CHROME_CONTROLS_COLLAPSED_KEY = 'video-player-ui-controls-collapsed'
const UI_CHROME_NAME_HIDDEN_KEY = 'video-player-ui-name-hidden'
const UI_CHROME_TAGS_HIDDEN_KEY = 'video-player-ui-tags-hidden'
const UI_CHROME_CATALOG_HIDDEN_KEY = 'video-player-ui-catalog-chrome-hidden'

function readSessionFlag(key: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeSessionFlag(key: string, on: boolean) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

watch(trailerControlsCollapsed, (v) => writeSessionFlag(UI_CHROME_CONTROLS_COLLAPSED_KEY, v))
watch(trailerTagsHidden, (v) => writeSessionFlag(UI_CHROME_TAGS_HIDDEN_KEY, v))
watch(catalogChromeHidden, (v) => writeSessionFlag(UI_CHROME_CATALOG_HIDDEN_KEY, v))

function showTrailerTagsAndToggleInput() {
  if (trailerTagsHidden.value) {
    trailerTagsHidden.value = false
    trailerTagPanelOpen.value = true
    return
  }
  trailerTagPanelOpen.value = !trailerTagPanelOpen.value
}

function openTrailerTagInput() {
  trailerTagPanelOpen.value = true
}

function hideTrailerTags() {
  trailerTagPanelOpen.value = false
  trailerTagsHidden.value = true
}

const searchSessionInput = ref('')
const searchSessionQuery = ref('')
const searchSessionError = ref('')
const searchSessionMode = ref<'files' | 'tags'>('tags')
const searchSessionMatch = ref<'any' | 'all' | 'approx'>('any')

function onSearchSessionMatchChange() {
  if (searchSessionQuery.value.trim().length >= 2) void runSearchSession()
}

interface TagBrowseRow {
  name: string
  count: number
}
interface TagBrowseList {
  id: string
  name: string
  tags: string[]
  updatedAt?: string
}
interface TagBrowsePreviewSample {
  session: number
  trailerRel: string
  label: string
  previewRel: string
}

const tagBrowseDialogOpen = ref(false)
const tagBrowseLoading = ref(false)
const tagBrowseLoaded = ref(false)
const tagBrowseError = ref('')
const tagBrowseFilter = ref('')
const tagBrowseRows = ref<TagBrowseRow[]>([])
const tagBrowseLists = ref<TagBrowseList[]>([])
const tagBrowseSelectedListId = ref<string | null>(null)
const tagBrowsePanel = ref<'tags' | 'lists'>('tags')
const tagBrowseNewListName = ref('')
const tagBrowseNewItemName = ref('')
const tagBrowseListBusy = ref(false)
const tagBrowsePreviewLoading = ref(false)
const tagBrowseEditingItem = ref<string | null>(null)
const tagBrowseEditDraft = ref('')
type TagBrowseMenuState = { kind: 'item' | 'list'; id: string; label: string; confirm: boolean }
const tagBrowseMenu = ref<TagBrowseMenuState | null>(null)
const tagBrowseMenuPos = ref({ top: '0px', right: '8px' })
let tagBrowseMenuAnchor: HTMLElement | null = null
const tagBrowsePreviewByQuery = reactive<
  Record<string, { total: number; samples: TagBrowsePreviewSample[] }>
>({})
let tagBrowsePreviewSeq = 0

const tagBrowseFilteredRows = computed(() => {
  const q = tagBrowseFilter.value.trim().toLowerCase()
  if (!q) return tagBrowseRows.value
  return tagBrowseRows.value.filter((r) => r.name.toLowerCase().includes(q))
})

const tagBrowseSelectedList = computed(() => {
  const id = tagBrowseSelectedListId.value
  if (!id) return null
  return tagBrowseLists.value.find((l) => l.id === id) ?? null
})

function tagInSelectedList(tag: string): boolean {
  const list = tagBrowseSelectedList.value
  if (!list) return false
  const key = tag.trim().toLowerCase()
  return list.tags.some((t) => t.toLowerCase() === key)
}

function clearTagBrowsePreviews() {
  for (const k of Object.keys(tagBrowsePreviewByQuery)) delete tagBrowsePreviewByQuery[k]
}

async function loadTagBrowseItemPreviews(queries: string[], listId?: string | null) {
  const qs = [...new Set(queries.map((q) => q.trim()).filter((q) => q.length >= 2))]
  if (!qs.length) {
    clearTagBrowsePreviews()
    return
  }
  const seq = ++tagBrowsePreviewSeq
  tagBrowsePreviewLoading.value = true
  try {
    const res = await $fetch<{
      rows?: {
        query: string
        total: number
        samples: TagBrowsePreviewSample[]
      }[]
      cached?: boolean
      computed?: number
    }>('/api/library/tag-list-previews', {
      method: 'POST',
        body: {
        queries: qs,
        sample: 6,
        ...(listId ? { listId } : {}),
      },
    })
    if (seq !== tagBrowsePreviewSeq) return
    clearTagBrowsePreviews()
    for (const row of res.rows ?? []) {
      tagBrowsePreviewByQuery[row.query] = {
        total: row.total,
        samples: Array.isArray(row.samples) ? row.samples : [],
      }
    }
  } catch (e: unknown) {
    if (seq !== tagBrowsePreviewSeq) return
    const ex = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    tagBrowseError.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Falha ao montar pré-visualizações.'
  } finally {
    if (seq === tagBrowsePreviewSeq) tagBrowsePreviewLoading.value = false
  }
}

function closeTagBrowseMenu() {
  tagBrowseMenu.value = null
  tagBrowseMenuAnchor = null
}

function isTagBrowseMenuOpen(kind: TagBrowseMenuState['kind'], id: string): boolean {
  const m = tagBrowseMenu.value
  return !!m && m.kind === kind && m.id === id
}

function placeTagBrowseMenu(el: HTMLElement | null) {
  if (!el) return
  const r = el.getBoundingClientRect()
  const estH = tagBrowseMenu.value?.confirm ? 148 : 120
  const estW = 210
  let top = r.bottom + 6
  if (top + estH > window.innerHeight - 8) {
    top = Math.max(8, r.top - estH - 6)
  }
  let right = Math.max(8, window.innerWidth - r.right)
  if (r.right - estW < 8) right = 8
  tagBrowseMenuPos.value = { top: `${top}px`, right: `${right}px` }
}

function toggleTagBrowseMenu(
  kind: TagBrowseMenuState['kind'],
  id: string,
  label: string,
  ev: Event,
) {
  if (tagBrowseListBusy.value) return
  const m = tagBrowseMenu.value
  if (m && m.kind === kind && m.id === id) {
    closeTagBrowseMenu()
    return
  }
  const btn = ev.currentTarget as HTMLElement
  tagBrowseMenuAnchor = btn
  tagBrowseMenu.value = { kind, id, label, confirm: false }
  placeTagBrowseMenu(btn)
}

function askTagBrowseMenuDelete() {
  const m = tagBrowseMenu.value
  if (!m) return
  tagBrowseMenu.value = { ...m, confirm: true }
  nextTick(() => placeTagBrowseMenu(tagBrowseMenuAnchor))
}

function cancelTagBrowseMenuDelete() {
  const m = tagBrowseMenu.value
  if (!m) return
  tagBrowseMenu.value = { ...m, confirm: false }
}

async function confirmTagBrowseMenuDelete() {
  const m = tagBrowseMenu.value
  if (!m) return
  if (m.kind === 'item') await removeTagBrowseItem(m.id, true)
  else await deleteTagBrowseList(m.id, true)
}

function onTagBrowseCardPointerDown(e: PointerEvent) {
  if (!tagBrowseMenu.value) return
  const el = e.target as HTMLElement | null
  if (el?.closest('.tag-browse-overflow-wrap, .tag-browse-overflow--portal')) return
  closeTagBrowseMenu()
}

function selectTagBrowseList(id: string) {
  closeTagBrowseMenu()
  tagBrowseSelectedListId.value = id
  tagBrowseNewItemName.value = ''
  tagBrowsePanel.value = 'lists'
  cancelTagBrowseItemEdit()
  const list = tagBrowseLists.value.find((l) => l.id === id)
  void loadTagBrowseItemPreviews(list?.tags ?? [], id)
  void nextTick(() => {
    document
      .querySelector('.tag-browse-list-item--active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

async function refreshTagBrowseData() {
  tagBrowseLoading.value = true
  tagBrowseError.value = ''
  try {
    const [stats, lists] = await Promise.all([
      $fetch<{ tags?: TagBrowseRow[] }>('/api/library/tag-stats'),
      $fetch<{ lists?: TagBrowseList[] }>('/api/library/tag-lists'),
    ])
    tagBrowseRows.value = Array.isArray(stats.tags) ? stats.tags : []
    tagBrowseLists.value = Array.isArray(lists.lists) ? lists.lists : []
    tagBrowseLoaded.value = true
    if (
      tagBrowseSelectedListId.value &&
      !tagBrowseLists.value.some((l) => l.id === tagBrowseSelectedListId.value)
    ) {
      tagBrowseSelectedListId.value = null
      clearTagBrowsePreviews()
    } else if (tagBrowseSelectedListId.value) {
      const list = tagBrowseLists.value.find((l) => l.id === tagBrowseSelectedListId.value)
      void loadTagBrowseItemPreviews(list?.tags ?? [], tagBrowseSelectedListId.value)
    }
  } catch (e: unknown) {
    const ex = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    tagBrowseError.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Falha ao carregar tags.'
  } finally {
    tagBrowseLoading.value = false
  }
}

async function openTagBrowseDialog() {
  tagBrowseDialogOpen.value = true
  tagBrowseFilter.value = ''
  await refreshTagBrowseData()
  tagBrowsePanel.value = tagBrowseLists.value.length > 0 ? 'lists' : 'tags'
}

function closeTagBrowseDialog() {
  tagBrowseDialogOpen.value = false
  closeTagBrowseMenu()
  cancelTagBrowseItemEdit()
}

function startTagBrowseItemEdit(tag: string) {
  const t = tag.trim()
  if (!t || tagBrowseListBusy.value) return
  closeTagBrowseMenu()
  tagBrowseEditingItem.value = t
  tagBrowseEditDraft.value = t
  void nextTick(() => {
    const el = document.querySelector(
      '.tag-browse-item-edit-input',
    ) as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function cancelTagBrowseItemEdit() {
  tagBrowseEditingItem.value = null
  tagBrowseEditDraft.value = ''
}

async function commitTagBrowseItemRename() {
  const listId = tagBrowseSelectedListId.value
  const from = tagBrowseEditingItem.value
  const to = dedupeListItemWords(tagBrowseEditDraft.value)
  if (!listId || !from || tagBrowseListBusy.value) return
  if (to.length < 2) return
  if (to.toLowerCase() === from.toLowerCase() && to === from) {
    cancelTagBrowseItemEdit()
    return
  }
  const list = tagBrowseLists.value.find((l) => l.id === listId)
  if (
    list?.tags.some((t) => t.toLowerCase() === to.toLowerCase() && t.toLowerCase() !== from.toLowerCase())
  ) {
    tagBrowseError.value = `«${to}» já está nesta lista.`
    return
  }
  tagBrowseListBusy.value = true
  tagBrowseError.value = ''
  try {
    const res = await $fetch<{ lists?: TagBrowseList[] }>('/api/library/tag-lists', {
      method: 'POST',
      body: { action: 'rename-tag', id: listId, from, to },
    })
    tagBrowseLists.value = Array.isArray(res.lists) ? res.lists : []
    cancelTagBrowseItemEdit()
    const list = tagBrowseLists.value.find((l) => l.id === listId)
    void loadTagBrowseItemPreviews(list?.tags ?? [], listId)
  } catch (e: unknown) {
    const ex = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    tagBrowseError.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Falha ao renomear item.'
  } finally {
    tagBrowseListBusy.value = false
  }
}

async function removeTagBrowseItem(tag: string, confirmed = false) {
  const t = tag.trim()
  if (!t || tagBrowseListBusy.value) return
  if (!confirmed) return
  closeTagBrowseMenu()
  if (tagBrowseEditingItem.value === t) cancelTagBrowseItemEdit()
  await toggleTagInSelectedList(t, false)
}

async function searchFromTagBrowse(tag: string) {
  const t = tag.trim()
  if (!t) return
  closeTagBrowseDialog()
  searchSessionMode.value = 'tags'
  searchSessionInput.value = t
  await runSearchSession()
}

async function createTagBrowseList() {
  const name = tagBrowseNewListName.value.trim()
  if (!name || tagBrowseListBusy.value) return
  tagBrowseListBusy.value = true
  tagBrowseError.value = ''
  try {
    const res = await $fetch<{ lists?: TagBrowseList[] }>('/api/library/tag-lists', {
      method: 'POST',
      body: { action: 'create', name },
    })
    tagBrowseLists.value = Array.isArray(res.lists) ? res.lists : []
    tagBrowseNewListName.value = ''
    const created = tagBrowseLists.value.find(
      (l) => l.name.toLowerCase() === name.toLowerCase(),
    )
    if (created) selectTagBrowseList(created.id)
  } catch (e: unknown) {
    const ex = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    tagBrowseError.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Falha ao criar lista.'
  } finally {
    tagBrowseListBusy.value = false
  }
}

function dedupeListItemWords(raw: string): string {
  const parts = raw.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.join(' ')
}

async function addItemToSelectedList() {
  const raw = dedupeListItemWords(tagBrowseNewItemName.value)
  if (raw.length < 2 || tagBrowseListBusy.value) return
  const list = tagBrowseSelectedList.value
  if (list?.tags.some((t) => t.toLowerCase() === raw.toLowerCase())) {
    tagBrowseError.value = `«${raw}» já está nesta lista.`
    return
  }
  tagBrowseNewItemName.value = raw
  await toggleTagInSelectedList(raw, true)
  if (!tagBrowseError.value) {
    tagBrowseNewItemName.value = ''
    const next = tagBrowseSelectedList.value
    void loadTagBrowseItemPreviews(next?.tags ?? [], next?.id)
  }
}

async function deleteTagBrowseList(id: string, confirmed = false) {
  if (!id || tagBrowseListBusy.value) return
  if (!confirmed) return
  closeTagBrowseMenu()
  tagBrowseListBusy.value = true
  tagBrowseError.value = ''
  try {
    const res = await $fetch<{ lists?: TagBrowseList[] }>('/api/library/tag-lists', {
      method: 'POST',
      body: { action: 'delete', id },
    })
    tagBrowseLists.value = Array.isArray(res.lists) ? res.lists : []
    if (tagBrowseSelectedListId.value === id) {
      tagBrowseSelectedListId.value = null
      clearTagBrowsePreviews()
    }
  } catch (e: unknown) {
    const ex = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    tagBrowseError.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Falha ao apagar lista.'
  } finally {
    tagBrowseListBusy.value = false
  }
}

async function toggleTagInSelectedList(tag: string, wantIn?: boolean) {
  const listId = tagBrowseSelectedListId.value
  if (!listId || tagBrowseListBusy.value) return
  tagBrowseListBusy.value = true
  tagBrowseError.value = ''
  try {
    const body: { action: string; id: string; tag: string; inList?: boolean } = {
      action: 'toggle-tag',
      id: listId,
      tag,
    }
    if (wantIn !== undefined) body.inList = wantIn
    const res = await $fetch<{ lists?: TagBrowseList[] }>('/api/library/tag-lists', {
      method: 'POST',
      body,
    })
    tagBrowseLists.value = Array.isArray(res.lists) ? res.lists : []
    const list = tagBrowseLists.value.find((l) => l.id === listId)
    void loadTagBrowseItemPreviews(list?.tags ?? [], listId)
  } catch (e: unknown) {
    const ex = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    tagBrowseError.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Falha ao actualizar lista.'
  } finally {
    tagBrowseListBusy.value = false
  }
}

watch(searchSessionActive, (on) => {
  if (on && !tagBrowseLoaded.value) void refreshTagBrowseData()
})


let suppressCatalogPrefsPersist = false

function snapshotCatalogSessionPrefs(): CatalogSessionPrefs {
  return {
    tagFilter: catalogTagFilter.value,
    originFilter: catalogOriginFilter.value,
    folderFilterInput: folderFilterInput.value,
    folderFilterMode: folderFilterMode.value,
    showOnlyWatched: showOnlyWatched.value,
    favoriteFilter: favoriteCatalogFilter.value,
    destaquesFilter: destaquesCatalogFilter.value,
    sortKey: catalogSortKey.value,
    sortDir: catalogSortDir.value,
    searchInput: searchSessionInput.value,
    searchQuery: searchSessionQuery.value,
    searchMode: searchSessionMode.value,
    searchMatch: searchSessionMatch.value,
  }
}

function restoreCatalogSessionPrefsFor(sessionId: number) {
  suppressCatalogPrefsPersist = true
  try {
    const stored = readCatalogSessionPrefs(sessionId)
    if (stored) {
      catalogTagFilter.value = stored.tagFilter
      catalogOriginFilter.value = stored.originFilter
      folderFilterInput.value = stored.folderFilterInput
      folderFilterMode.value = stored.folderFilterMode
      showOnlyWatched.value = stored.showOnlyWatched
      favoriteCatalogFilter.value = stored.favoriteFilter
      destaquesCatalogFilter.value = stored.destaquesFilter
      catalogSortKey.value = stored.sortKey
      catalogSortDir.value = stored.sortDir
      searchSessionInput.value = stored.searchInput
      searchSessionQuery.value = stored.searchQuery
      searchSessionMode.value = stored.searchMode
      searchSessionMatch.value =
        stored.searchMatch === 'all'
          ? 'all'
          : stored.searchMatch === 'approx'
            ? 'approx'
            : 'any'
      return
    }
    catalogTagFilter.value = null
    catalogOriginFilter.value = null
    folderFilterInput.value = ''
    folderFilterMode.value = 'tags'
    showOnlyWatched.value = false
    favoriteCatalogFilter.value = 'all'
    destaquesCatalogFilter.value = 'all'
    searchSessionInput.value = ''
    searchSessionQuery.value = ''
    searchSessionMode.value = 'tags'
    searchSessionMatch.value = 'any'
    if (sessionId === RECENTS_SESSION_ID || sessionId === LAST_VIEWED_SESSION_ID) {
      applyDestaquesCatalogSortDefaults()
    } else if (sessionId >= 0) {
      applyFolderCatalogSortDefaults()
    }
  } finally {
    suppressCatalogPrefsPersist = false
  }
}

watch(
  [
    catalogTagFilter,
    catalogOriginFilter,
    folderFilterInput,
    folderFilterMode,
    showOnlyWatched,
    favoriteCatalogFilter,
    destaquesCatalogFilter,
    catalogSortKey,
    catalogSortDir,
    searchSessionInput,
    searchSessionQuery,
    searchSessionMode,
    searchSessionMatch,
  ],
  () => {
    if (suppressCatalogPrefsPersist || !catalogPrefsEnabled.value) return
    writeCatalogSessionPrefs(sessionIndex.value, snapshotCatalogSessionPrefs())
  },
)

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
  () => isWideDesktopUi.value && !isTvLayout.value && !catalogGridCollapsed.value,
)

const mainStackGridStyle = computed((): Record<string, string> => {
  if (!import.meta.client || !isWideDesktopUi.value) return {}

  if (theaterMode.value && !isTvLayout.value) {
    return {
      gridTemplateColumns: 'minmax(0, 1fr)',
      columnGap: '0',
    }
  }

  if (catalogGridCollapsed.value) {
    return {
      gridTemplateColumns: 'minmax(0, 1fr) 3.35rem',
      columnGap: '0.45rem',
    }
  }

  if (isTvLayout.value) {
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
  const e = entries.value[i]
  if (!e?.previewRel && !e?.trailerRel) return
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
  const { prevFocusedRel, wasFullRel } = captureCatalogFilterFocusSnapshot()
  catalogOriginFilter.value = null
  catalogTagFilter.value = catalogTagFilter.value === tag ? null : tag
  sessionMenuOpen.value = false
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

async function reloadRecentsAfterOriginFilterChange() {
  teardownRecentsLoadObserver()
  playerUrl.value = null
  activeIndex.value = null
  previewUrl.value = null
  focusedIndex.value = null
  syncRecentsOriginApiFilter()
  recentsCatalog.setPaginationEnabled(false)
  if (isTvLayout.value) {
    await loadRecentsTrailers()
    return
  }
  await loadTrailers()
}

async function onOriginTagPick(tag: string) {
  if (!tag) return
  if (loading.value) return
  catalogTagFilter.value = null
  catalogOriginFilter.value = catalogOriginFilter.value === tag ? null : tag
  sessionMenuOpen.value = false
  if (sessionIndex.value === RECENTS_SESSION_ID) {
    await reloadRecentsAfterOriginFilterChange()
    return
  }
  const { prevFocusedRel, wasFullRel } = captureCatalogFilterFocusSnapshot()
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

async function clearCatalogOriginFilter() {
  if (!catalogOriginFilter.value) return
  if (loading.value) return
  catalogOriginFilter.value = null
  if (sessionIndex.value === RECENTS_SESSION_ID) {
    await reloadRecentsAfterOriginFilterChange()
    return
  }
  const { prevFocusedRel, wasFullRel } = captureCatalogFilterFocusSnapshot()
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
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
  if (!entries.value[i]?.previewRel && !entries.value[i]?.trailerRel) return
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

/** Um card do rail TV (altura + gap). */
function tvMinimalRailStepPx(): number {
  const root = tvMinimalRailScroll.value
  if (!root) return 80
  const thumb = root.querySelector('.tv-minimal-thumb')
  if (thumb instanceof HTMLElement) {
    const gap = 6
    return Math.max(48, thumb.offsetHeight + gap)
  }
  return 80
}

/** ▲▼ no rail lateral do modo TV minimal. */
function scrollTvMinimalRail(dir: 1 | -1) {
  const root = tvMinimalRailScroll.value
  if (!root || !entries.value.length) return
  const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight)
  if (maxScroll <= 0) return
  const step = tvMinimalRailStepPx()
  const dest = Math.min(maxScroll, Math.max(0, root.scrollTop + dir * step))
  if (dest === root.scrollTop) return
  root.scrollTo({ top: dest, behavior: 'auto' })
  if (
    dir === 1 &&
    sessionIndex.value === RECENTS_SESSION_ID &&
    recentsPaginationEnabled.value &&
    recentsHasMore.value &&
    dest >= maxScroll - step
  ) {
    void tryLoadRecentsMore('scroll')
  }
}

/** Botões ▲▼ no catálogo (Silk): não dependem da barra nativa nem das teclas de volume. */
function scrollCatalogByDirection(dir: 1 | -1) {
  if (isTvLayout.value) {
    scrollTvMinimalRail(dir)
    return
  }
  if (!entries.value.length) return
  const wasCollapsed = catalogGridCollapsed.value
  if (wasCollapsed) catalogGridCollapsed.value = false
  if (wasCollapsed) {
    nextTick(() => scrollCatalogApplyStep(dir))
  } else {
    scrollCatalogApplyStep(dir)
  }
  if (dir === 1 && sessionIndex.value === RECENTS_SESSION_ID && isTvLayout.value) {
    const fi = focusedIndex.value
    const n = entries.value.length
    if (
      fi !== null &&
      n &&
      recentsPaginationEnabled.value &&
      recentsHasMore.value &&
      fi >= n - 2
    ) {
      void tryLoadRecentsMore('scroll')
    }
  }
}

/**
 * TV / comando: tentar rolar o catálogo com teclas que alguns browsers expõem.
 * Nota: Volume+/− são muitas vezes consumidos pelo SO e **nunca chegam** à página — use os botões ▲▼ ou FF/RW nos títulos.
 */
function handleCatalogRemoteScrollKeys(e: KeyboardEvent): boolean {
  if (documentTargetIsFormField(e.target)) return false
  if (!entries.value.length) return false

  if (!manualTvAssist.value) return false

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

  if (isTvLayout.value) {
    if (!documentTargetIsFormField(e.target)) {
      const k = e.key
      if (k === 'ArrowRight' || k === 'ArrowDown') {
        if (entries.value.length) {
          e.preventDefault()
          tvMinimalNext()
          return
        }
      } else if (k === 'ArrowLeft' || k === 'ArrowUp') {
        if (entries.value.length) {
          e.preventDefault()
          tvMinimalPrev()
          return
        }
      } else if (k === 'MediaFastForward' || k === 'MediaTrackNext') {
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
    if (sessionMenuOpen.value) {
      sessionMenuOpen.value = false
      return
    }
    if (theaterMode.value) {
      theaterMode.value = false
      return
    }
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

watch([previewUrl, playerUrl], ([p, pl]) => {
  if (!p && !pl) theaterMode.value = false
})

const selectedEntry = computed(() => {
  if (previewUrl.value || playerUrl.value) {
    const playback = resolvePlaybackEntryFromUrls()
    if (playback) return playback
  }
  const i = focusedIndex.value
  if (i !== null) {
    const e = entries.value[i]
    if (e) return e
  }
  return null
})

/** Diretório relativo à raiz da sessão (vazio se o completo está na raiz). */
function parentRelDir(mainRel: string): string {
  const n = mainRel.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = n.lastIndexOf('/')
  return i > 0 ? n.slice(0, i) : ''
}

/** Pasta de origem = rótulo da biblioteca no menu esquerdo (sem subpastas). */
function entryOriginTags(entry: TrailerListEntry): string[] {
  const label = libraryFolderLabel(libSession(entry)).trim()
  return label ? [label] : []
}

/** Tags do utilizador, sem duplicar as de origem já mostradas em «ORIGEM». */
function entryUserTags(entry: TrailerListEntry): string[] {
  const originKeys = new Set(entryOriginTags(entry).map((t) => t.toLowerCase()))
  return (entry.tags ?? []).filter((t) => !originKeys.has(t.trim().toLowerCase()))
}

/** Pasta no topo do cartão: biblioteca (menu) e, se aplicável, subpasta do `mainRel`. */
const playbackFolderCaption = computed(() => {
  const entry = selectedEntry.value
  if (!entry) return ''
  const lib = sessions.value.find((s) => s.id === libSession(entry))?.label?.trim() ?? ''
  const sub = parentRelDir(entry.mainRel)
  const si = sessionIndex.value
  if (si === SURPRESA_SESSION_ID || si === LAST_VIEWED_SESSION_ID) {
    const aggTag = aggregatedListTagForSession(si)
    const prefix = lib ? `${aggTag} · ${lib}` : aggTag
    if (sub && prefix) return `${prefix} · ${sub.replace(/\//g, ' / ')}`
    return prefix || aggTag || '—'
  }
  if (sub && lib) return `${lib} · ${sub.replace(/\//g, ' / ')}`
  if (sub) return sub.replace(/\//g, ' / ')
  return lib || '—'
})

/** Título cujo vídeo completo está no palco (URL de reprodução; índice só se coincidir). */
const mainVideoEntry = computed(() => {
  if (!playerUrl.value) return null
  const parsed = parseApiVideoUrl(playerUrl.value)
  if (!parsed) return null
  const norm = (r: string) => r.replace(/\\/g, '/').replace(/^\/+/, '')
  const want = norm(parsed.rel)
  const fromUrl =
    fullEntries.value.find((e) => norm(e.mainRel) === want && libSession(e) === parsed.session) ?? null
  if (fromUrl) return fromUrl
  const i = activeIndex.value
  if (i !== null) {
    const fromIdx = entries.value[i]
    if (fromIdx) return fromIdx
  }
  return null
})

/** Título activo na barra (trailer ou vídeo completo) — olho Destaques usa isto. */
const destaqueToolbarEntry = computed(() => {
  if (playerUrl.value && mainVideoEntry.value) return mainVideoEntry.value
  return selectedEntry.value
})

const destaqueToolbarActive = computed(() => {
  void recentPlaybackKeyList.value
  return isPlaybackTitleInRecentList(destaqueToolbarEntry.value)
})

/** Olho na barra: adiciona ou remove o título activo de «Destaques» (SQLite). */
async function toggleCurrentTitleRecents() {
  if (recentsMutationBusy.value) return
  const e = destaqueToolbarEntry.value
  if (!e?.trailerRel?.trim()) {
    showToast('Selecciona um trailer ou vídeo antes de adicionar a Destaques.', 'error')
    return
  }
  const ls = libSession(e)
  const trailerRel = e.trailerRel
  const inList = isPlaybackTitleInRecentList(e)
  recentsMutationBusy.value = true
  try {
    if (inList) {
      const res = await $fetch<{ trailerRel?: string }>('/api/library/recent-remove', {
        method: 'POST',
        body: { session: ls, trailerRel },
      })
      const canonical =
        typeof res.trailerRel === 'string' ? res.trailerRel : trailerRel
      if (typeof res.trailerRel === 'string') {
        applyDestaqueTrailerRelLocal(ls, trailerRel, res.trailerRel)
      }
      syncRecentPlaybackKey(ls, canonical, false)
      showToast('Removido de Destaques.', 'success')
      const removeIdx = entries.value.findIndex(
        (x) => libSession(x) === ls && trailerRelMatchesFocus(x.trailerRel, trailerRel),
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
      const res = await $fetch<{ trailerRel?: string }>('/api/library/recent-play', {
        method: 'POST',
        body: { session: ls, trailerRel },
      })
      const canonical =
        typeof res.trailerRel === 'string' ? res.trailerRel : trailerRel
      if (typeof res.trailerRel === 'string') {
        applyDestaqueTrailerRelLocal(ls, trailerRel, res.trailerRel)
      }
      syncRecentPlaybackKey(ls, canonical, true)
      showToast('Adicionado a Destaques.', 'success')
      await refreshRecentPlaybackKeys()
      syncCatalogIndicesToPlayback()
      if (sessionIndex.value === RECENTS_SESSION_ID) {
        await loadTrailers({ preserveFocusTrailerRel: canonical })
      }
    }
  } catch (err: unknown) {
    showToast(destaqueFetchErrorMessage(err, 'Não foi possível adicionar a Destaques.'), 'error')
  } finally {
    recentsMutationBusy.value = false
  }
}

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
    const ex = err as { data?: { message?: string; statusMessage?: string }; message?: string }
    errorMsg.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Não foi possível abrir a pasta no servidor.'
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
  if (isTvLayout.value && playerUrl.value) {
    const next = i !== null ? entries.value[i] : null
    const playing = resolvePlaybackEntryFromUrls()
    if (
      playing &&
      next &&
      trailerRelMatchesFocus(playing.trailerRel, next.trailerRel) &&
      libSession(playing) === libSession(next)
    ) {
      return
    }
    playerUrl.value = null
    activeIndex.value = null
  }
  if (isTvLayout.value) {
    releaseVideoElement(tvMinimalVideoRef.value)
    releaseVideoElement(tvStageVideoRef.value)
  }
  previewUrl.value = null
  if (i === null || !entries.value[i]) return
  const e = entries.value[i]
  if (!e.trailerRel) return
  previewUrl.value = apiVideoUrl(e.trailerRel, libSession(e))
}

let lastViewedRecordedKey: string | null = null

function recordTrailerLastViewed(entry: TrailerListEntry | null | undefined) {
  if (!entry?.trailerRel?.trim()) return
  if (sessionIndex.value === LAST_VIEWED_SESSION_ID) return
  const ls = libSession(entry)
  const rel = normalizeTrailerRelForRecentKey(entry.trailerRel)
  if (!rel.toLowerCase().startsWith('trailers/')) return
  const key = playbackRecentKey(ls, rel)
  if (lastViewedRecordedKey === key) return
  lastViewedRecordedKey = key
  void $fetch('/api/library/trailer-view', {
    method: 'POST',
    body: { session: ls, trailerRel: entry.trailerRel },
  }).catch(() => {
    if (lastViewedRecordedKey === key) lastViewedRecordedKey = null
  })
}

function setTrailerIndex(i: number) {
  gridInlinePreviewIndex.value = null
  trailerTagPanelOpen.value = false
  focusedIndex.value = i
  const next = entries.value[i]
  const playing = resolvePlaybackEntryFromUrls()
  if (
    playerUrl.value &&
    playing &&
    next &&
    trailerRelMatchesFocus(playing.trailerRel, next.trailerRel) &&
    libSession(playing) === libSession(next)
  ) {
    void nextTick(() => {
      requestAnimationFrame(() => {
        if (isTvLayout.value) {
          const root = tvMinimalRailScroll.value
          const btn = root?.querySelectorAll<HTMLElement>('.tv-minimal-thumb')[i]
          btn?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
          return
        }
        if (next.trailerRel) scrollCatalogGridToTrailerRel(next.trailerRel)
      })
    })
    return
  }
  setPreviewForIndex(i)
  void nextTick(() => {
    requestAnimationFrame(() => {
      if (isTvLayout.value) {
        const root = tvMinimalRailScroll.value
        const btn = root?.querySelectorAll<HTMLElement>('.tv-minimal-thumb')[i]
        btn?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
        applyTvMinimalVideoSrc(tvMinimalVideoSrc.value)
        return
      }
      const rel = entries.value[i]?.trailerRel
      if (rel) scrollCatalogGridToTrailerRel(rel)
    })
  })
}

function onPreviewLoaded() {
  errorMsg.value = ''
  const el = previewStageVideoEl()
  if (el) {
    el.playbackRate = playbackRate.value
    el.play().catch(() => {})
  }
}

function onPreviewPlay() {
  recordTrailerLastViewed(selectedEntry.value)
}

function onPreviewTimeUpdate() {
  if (playerUrl.value) return
  recordTrailerLastViewed(selectedEntry.value)
}

function onTvStageLoadedData() {
  if (!isTvLayout.value) return
  if (playerUrl.value) return
  onPreviewLoaded()
}

function onTvStagePlay() {
  syncMainVideoPausedForUi()
  if (!playerUrl.value) recordTrailerLastViewed(selectedEntry.value)
}

function onTvStageLoadedMetadata() {
  if (!isTvLayout.value || !playerUrl.value) return
  onMainVideoLoadedMetadata()
}

function onTvStageTimeUpdate() {
  if (!isTvLayout.value) return
  if (!playerUrl.value) {
    recordTrailerLastViewed(selectedEntry.value)
    return
  }
  onMainVideoTimeUpdate()
}

function onTvStageSeeked() {
  if (!isTvLayout.value || !playerUrl.value) return
  onMainVideoSeeked()
}

function onTvStageSurfaceClick() {
  if (!isTvLayout.value) return
  if (playerUrl.value) onMainVideoSurfaceClick()
}

function onTvStageEnded() {
  if (!isTvLayout.value) return
  if (playerUrl.value) onMainVideoEnded()
  else onPreviewEnded()
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

/** Próximo título na fila Surpresa antes de remover o actual (índice circular). */
function surpriseNextTrailerRelAfterCurrent(): string | null {
  const i = focusedIndex.value
  const list = entries.value
  const n = list.length
  if (i === null || n < 2) return null
  const nextIdx = i + 1 < n ? i + 1 : 0
  return list[nextIdx]?.trailerRel ?? null
}

/** Fim do preview: marca trailer-visto e avança (Surpresa recarrega mantendo o próximo). */
async function advanceAfterTrailerEnded() {
  const onSurprise = sessionIndex.value === SURPRESA_SESSION_ID
  const nextRel = onSurprise ? surpriseNextTrailerRelAfterCurrent() : null
  await markCurrentTrailerWatchedFireAndForget({ surpriseFocusNextRel: nextRel })
  if (!onSurprise) goToNextTrailer()
}

/** Avança para o próximo trailer quando o atual termina (lista circular). */
function onPreviewEnded() {
  void advanceAfterTrailerEnded()
}

/**
 * Marca como `trailer-visto` o trailer actualmente em foco (que acabou de chegar ao fim do preview).
 * Atualiza a tag localmente para o badge azul aparecer já no próximo render — não afecta sort/random.
 */
async function markCurrentTrailerWatchedFireAndForget(opts?: {
  surpriseFocusNextRel?: string | null
}) {
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
    if (sessionIndex.value === SURPRESA_SESSION_ID) {
      const nextRel =
        typeof opts?.surpriseFocusNextRel === 'string'
          ? opts.surpriseFocusNextRel
          : surpriseNextTrailerRelAfterCurrent()
      await loadTrailers(
        typeof nextRel === 'string'
          ? { preserveFocusTrailerRel: nextRel }
          : {},
      )
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
  if (isTvLayout.value) return tvMinimalVideoRef.value
  return stageVideoEl()
}

/** Alvo do fullscreen automático em landscape: trailer → contentor com botões; vídeo completo → elemento vídeo. */
function fullscreenTargetForAutorient(): HTMLElement | null {
  if (isTvLayout.value) {
    if (playerUrl.value) return tvMinimalVideoRef.value ?? tvStageVideoRef.value
    return tvMinimalVideoRef.value ?? previewFullscreenWrapRef.value ?? tvStageVideoRef.value
  }
  if (playerUrl.value) return mainVideoRef.value
  return previewFullscreenWrapRef.value ?? previewVideoRef.value
}

async function tryEnterFullscreen(
  el: HTMLElement | null,
  opts?: { allowDescendantVideoFullscreen?: boolean },
) {
  if (!el) return
  const allowDescendantVideoFs = opts?.allowDescendantVideoFullscreen !== false
  const innerVideo =
    el instanceof HTMLVideoElement ? el : (el.querySelector('video') as HTMLVideoElement | null)

  /** Primeiro: contentor (overlay); se falhar, opcionalmente o elemento vídeo (mobile). */
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

  if (!allowDescendantVideoFs) {
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
  await tryEnterFullscreen(el, { allowDescendantVideoFullscreen: true })
}

function docFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null
  return (
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ??
    null
  )
}

function syncTrailerStageFullscreenFlag() {
  if (!import.meta.client || typeof document === 'undefined') return
  const fe = docFullscreenElement()
  const wrap = previewFullscreenWrapRef.value
  const previewVid = isTvLayout.value ? tvStageVideoRef.value : previewVideoRef.value

  trailerStageFullscreen.value = !!(wrap && fe === wrap)

  trailerPreviewVideoFullscreen.value = Boolean(
    !playerUrl.value &&
      previewUrl.value &&
      wrap &&
      previewVid &&
      fe === previewVid &&
      wrap.contains(previewVid),
  )
}

function onDocumentFullscreenChange() {
  syncTrailerStageFullscreenFlag()
}

function exitFullscreenIfMainVideo() {
  if (!import.meta.client || typeof document === 'undefined') return
  const v = mainStageVideoEl()
  if (!v) return
  const fe = docFullscreenElement()
  if (fe !== v) return
  document.exitFullscreen?.().catch(() => {})
}

function onLandscapeOrientationChange() {
  if (!shouldAutoFullscreenOnLandscape()) return
  const landscape = window.matchMedia('(orientation: landscape)').matches
  if (landscape) {
    const attempt = () => {
      const el = fullscreenTargetForAutorient()
      if (!el) return Promise.resolve()
      const wrap = previewFullscreenWrapRef.value
      let previewTrailerContainerTarget =
        !playerUrl.value && !!previewUrl.value && !!wrap && el === wrap
      if (previewTrailerContainerTarget && typeof window !== 'undefined') {
        try {
          if (window.matchMedia('(pointer: coarse)').matches) {
            previewTrailerContainerTarget = false
          }
        } catch {
          /* */
        }
      }
      return tryEnterFullscreen(el, {
        allowDescendantVideoFullscreen: !previewTrailerContainerTarget,
      })
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
  playerUrl.value = null
  activeIndex.value = null
  setTrailerIndex(i)
}

/** Sai do vídeo completo e mostra outra vez só o trailer (previewUrl mantém-se) */
async function closeFullVideo() {
  stopFastPlay(false)
  await flushMainProgressIfAny()
  if (isTvLayout.value) releaseVideoElement(tvMinimalVideoRef.value)
  playerUrl.value = null
  activeIndex.value = null
}

function openFullFromPreview() {
  const fromPlayback = selectedEntry.value ?? resolvePlaybackEntryFromUrls()
  if (fromPlayback) {
    void openVideoFromEntry(fromPlayback)
    return
  }
  const i = focusedIndex.value
  if (i === null) return
  void openVideo(i)
}

async function openVideo(i: number) {
  const entry = entries.value[i]
  if (!entry) {
    activeIndex.value = null
    return
  }
  await openVideoFromEntry(entry)
}

async function openVideoFromEntry(entry: TrailerListEntry) {
  stopFastPlay(false)
  clearPinnedTrailers()
  gridInlinePreviewIndex.value = null
  catalogGalleryIndex.value = null
  sessionMenuOpen.value = false
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
  const gridIdx = findEntryIndexInEntries(entry.trailerRel, libSession(entry))
  activeIndex.value = gridIdx >= 0 ? gridIdx : null
  if (isTvLayout.value) releaseVideoElement(tvMinimalVideoRef.value)
  playerUrl.value = apiVideoUrl(entry.mainRel, libSession(entry))
  nextTick(() => {
    const v = mainStageVideoEl()
    if (v) {
      v.playbackRate = playbackRate.value
      v.play().catch(() => {})
    }
  })
}

function mainProgressStorageRel(): string | null {
  if (mainVideoEntry.value?.mainRel) return mainVideoEntry.value.mainRel
  const i = activeIndex.value
  if (i === null || !entries.value[i]) return null
  return entries.value[i].mainRel
}

async function persistMainProgress(force: boolean) {
  if (!playerUrl.value) return
  const v = mainStageVideoEl()
  const mainRel = mainProgressStorageRel()
  if (!v || !mainRel || !Number.isFinite(v.currentTime)) return
  const now = Date.now()
  if (!force && now - lastMainProgressSave < MAIN_PROGRESS_SAVE_MS) return
  lastMainProgressSave = now
  const seconds = v.currentTime
  const duration = Number.isFinite(v.duration) ? v.duration : undefined
  const ent = mainVideoEntry.value ?? (activeIndex.value !== null ? entries.value[activeIndex.value] : undefined)
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
  const v = mainStageVideoEl()
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
  syncMainVideoPausedForUi()
}

function onMainVideoTimeUpdate() {
  applyFastPlayStepIfNeeded()
  void persistMainProgress(false)
}

/** Seek manual na barra: mantém FAST e repõe a janela de tempo por segmento. */
function onMainVideoSeeked() {
  if (!fastPlayEnabled.value) return
  if (fastPlayProgrammaticSeek) return
  const v = mainStageVideoEl()
  if (!v) return
  fastPlaySegmentStartAt = Number.isFinite(v.currentTime) ? v.currentTime : 0
}

/** Com controlos nativos ocultos (FAST em touch), toque no vídeo = pausar / continuar. */
function onMainVideoSurfaceClick() {
  if (mainVideoNativeControls.value) return
  const v = mainStageVideoEl()
  if (!v) return
  if (v.paused) void v.play().catch(() => {})
  else v.pause()
}

function stopFastPlay(keepEnabled: boolean) {
  const v = mainStageVideoEl()
  if (v && Number.isFinite(playbackRate.value)) {
    v.playbackRate = playbackRate.value
  }
  fastPlayProgrammaticSeek = false
  fastPlaySegmentStartAt = 0
  if (!keepEnabled) {
    fastPlayEnabled.value = false
    exitFullscreenIfMainVideo()
  }
  syncMainVideoPausedForUi()
}

function toggleFastPlay() {
  fastPlayEnabled.value = !fastPlayEnabled.value
  const v = mainStageVideoEl()
  if (!fastPlayEnabled.value || !v) {
    if (!fastPlayEnabled.value) stopFastPlay(false)
    return
  }
  v.playbackRate = fastPlayRate.value
  fastPlaySegmentStartAt = Number.isFinite(v.currentTime) ? v.currentTime : 0
  if (v.paused) v.play().catch(() => {})
  void nextTick(() => {
    syncMainVideoPausedForUi()
    const el = mainStageVideoEl()
    if (el && fastPlayEnabled.value && fastPlayFullscreenOn.value)
      tryEnterVideoFullscreen(el).catch(() => {})
  })
}

function applyFastPlayStepIfNeeded() {
  if (!fastPlayEnabled.value || fastPlayProgrammaticSeek) return
  const v = mainStageVideoEl()
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

function findFullEntryIndex(trailerRel: string, libS: number): number {
  return fullEntries.value.findIndex((x) => x.trailerRel === trailerRel && libSession(x) === libS)
}

function findEntryIndexInEntries(trailerRel: string, libS?: number): number {
  return entries.value.findIndex((e) => {
    if (libS !== undefined && libSession(e) !== libS) return false
    return trailerRelMatchesFocus(e.trailerRel, trailerRel)
  })
}

/** Título em reprodução mas filtrado da grelha (ex.: favorito com «sem favoritos»). */
function resolvePlaybackEntryFromUrls(): TrailerListEntry | null {
  if (playerUrl.value) {
    const parsed = parseApiVideoUrl(playerUrl.value)
    if (parsed) {
      const norm = (r: string) => r.replace(/\\/g, '/').replace(/^\/+/, '')
      const wantMain = norm(parsed.rel)
      return (
        fullEntries.value.find(
          (e) => norm(e.mainRel) === wantMain && libSession(e) === parsed.session,
        ) ?? null
      )
    }
  }
  if (previewUrl.value) {
    const parsed = parseApiVideoUrl(previewUrl.value)
    if (parsed) {
      return (
        fullEntries.value.find(
          (e) =>
            trailerRelMatchesFocus(e.trailerRel, parsed.rel) && libSession(e) === parsed.session,
        ) ?? null
      )
    }
  }
  return null
}

/** Alvo de acções na barra: vídeo em reprodução; na grelha: cartão clicado (`grid: true`). */
function resolveCatalogActionEntry(
  i: number | null,
  opts?: { grid?: boolean },
): TrailerListEntry | null {
  const playback = resolvePlaybackEntryFromUrls()
  const hasPlayback = !!(previewUrl.value || playerUrl.value)
  if (opts?.grid && i !== null) return entries.value[i] ?? null
  if (hasPlayback && playback) return playback
  if (i !== null) return entries.value[i] ?? null
  return playback ?? selectedEntry.value ?? null
}

/** Reajusta índices da grelha se a lista mudou mas o vídeo em reprodução continua visível. */
function syncCatalogIndicesToPlayback() {
  if (loading.value) return
  if (!previewUrl.value && !playerUrl.value) return
  const playback = resolvePlaybackEntryFromUrls()
  if (!playback) return
  const playbackIdx = findEntryIndexInEntries(playback.trailerRel, libSession(playback))
  const entryMatchesPlayback = (entry: TrailerListEntry | undefined) =>
    !!entry &&
    trailerRelMatchesFocus(entry.trailerRel, playback.trailerRel) &&
    libSession(entry) === libSession(playback)

  const fi = focusedIndex.value
  if (fi !== null) {
    if (!entryMatchesPlayback(entries.value[fi])) {
      focusedIndex.value = playbackIdx >= 0 ? playbackIdx : null
    }
  } else if (playbackIdx >= 0) {
    focusedIndex.value = playbackIdx
  }

  if (playerUrl.value) {
    const ai = activeIndex.value
    if (ai !== null) {
      if (!entryMatchesPlayback(entries.value[ai])) {
        activeIndex.value = playbackIdx >= 0 ? playbackIdx : null
      }
    } else if (playbackIdx >= 0) {
      activeIndex.value = playbackIdx
    }
  }
}

function sortTags(tags: string[]): string[] {
  return [...tags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

function applyEntryTagsLocal(trailerRel: string, libS: number, tags: string[]): void {
  const idx = fullEntries.value.findIndex(
    (x) => trailerRelMatchesFocus(x.trailerRel, trailerRel) && libSession(x) === libS,
  )
  if (idx < 0) return
  const cur = fullEntries.value[idx]!
  let next = sortTags(tags)
  const folderPair = cur.folderPairTag?.trim()
  if (folderPair) {
    const low = folderPair.toLowerCase()
    if (!next.some((t) => t.trim().toLowerCase() === low)) {
      next = sortTags([...next, folderPair])
    }
  }
  fullEntries.value[idx] = { ...cur, tags: next }
}

function mergeTagSuggestions(...names: string[]): void {
  if (!names.length) return
  const set = new Set(tagSuggestions.value)
  let added = false
  for (const n of names) {
    if (!set.has(n)) {
      set.add(n)
      added = true
    }
  }
  if (added) tagSuggestions.value = sortTags([...set])
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
  const { prevFocusedRel, wasFullRel } = captureCatalogFilterFocusSnapshot()
  catalogTagFilter.value = null
  void refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
}

async function refocusAfterTagFilterChange(prevFocusedRel: string | null, wasFullRel: string | null) {
  await nextTick()
  const list = entries.value

  if (isTvLayout.value) {
    if (!list.length) {
      ensureTvMinimalPlayback(0)
      return
    }
    if (wasFullRel) {
      const ni = findEntryIndexInEntries(wasFullRel)
      ensureTvMinimalPlayback(ni >= 0 ? ni : 0)
      return
    }
    if (prevFocusedRel) {
      const ni = findEntryIndexInEntries(prevFocusedRel)
      if (ni >= 0) {
        ensureTvMinimalPlayback(ni)
        return
      }
    }
    ensureTvMinimalPlayback(0)
    return
  }

  if (!list.length) {
    if (playerUrl.value || previewUrl.value) {
      focusedIndex.value = null
      activeIndex.value = null
      return
    }
    await closeFullVideo()
    focusedIndex.value = null
    previewUrl.value = null
    return
  }

  if (playerUrl.value && wasFullRel) {
    const ni = findEntryIndexInEntries(wasFullRel)
    if (ni >= 0) {
      activeIndex.value = ni
      focusedIndex.value = ni
    } else {
      activeIndex.value = null
      focusedIndex.value = null
    }
    return
  }

  if (playerUrl.value) return

  if (prevFocusedRel) {
    const ni = findEntryIndexInEntries(prevFocusedRel)
    if (ni >= 0) {
      setTrailerIndex(ni)
      return
    }
    if (previewUrl.value) {
      focusedIndex.value = null
      return
    }
  }
  setTrailerIndex(0)
}

async function addTagFromInput() {
  const e = resolveCatalogActionEntry(null)
  if (!e) return
  const parts = [...new Set(splitTagInputToParts(newTagInput.value))]
  if (!parts.length) return
  const trailerRel = e.trailerRel
  const ls = libSession(e)
  const idx = findFullEntryIndex(trailerRel, ls)
  const prevTags = idx >= 0 ? [...(fullEntries.value[idx].tags ?? [])] : [...(e.tags ?? [])]

  applyEntryTagsLocal(trailerRel, ls, [...new Set([...prevTags, ...parts])])
  mergeTagSuggestions(...parts)
  newTagInput.value = ''
  const keepRel = trailerRel

  try {
    let serverTags = prevTags
    for (const name of parts) {
      const res = await $fetch<{ tags?: string[]; trailerRel?: string }>('/api/library/tags', {
        method: 'POST',
        body: { session: ls, trailerRel, name },
      })
      if (Array.isArray(res.tags)) serverTags = res.tags
    }
    applyEntryTagsLocal(trailerRel, ls, serverTags)
    const ni = findEntryIndexInEntries(keepRel, ls)
    if (ni >= 0) focusedIndex.value = ni
    errorMsg.value = ''
  } catch (err: unknown) {
    applyEntryTagsLocal(trailerRel, ls, prevTags)
    const ex = err as { data?: { message?: string; statusMessage?: string }; message?: string }
    const msg =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Não foi possível gravar a tag (servidor).'
    errorMsg.value = msg
    showToast(msg, 'error')
  }
}

async function removeTagFromEntry(trailerRel: string, tagName: string, libS: number) {
  const idx = findFullEntryIndex(trailerRel, libS)
  const prevTags = idx >= 0 ? [...(fullEntries.value[idx].tags ?? [])] : []
  const tagLower = tagName.trim().toLowerCase()

  if (idx >= 0) {
    applyEntryTagsLocal(
      trailerRel,
      libS,
      prevTags.filter((t) => t.trim().toLowerCase() !== tagLower),
    )
  }

  try {
    const res = await $fetch<{ tags?: string[] }>(
      `/api/library/tags?session=${libS}&trailerRel=${encodeURIComponent(trailerRel)}&name=${encodeURIComponent(tagName)}`,
      { method: 'DELETE' },
    )
    if (Array.isArray(res.tags)) applyEntryTagsLocal(trailerRel, libS, res.tags)
    errorMsg.value = ''
  } catch (err: unknown) {
    applyEntryTagsLocal(trailerRel, libS, prevTags)
    const ex = err as { data?: { message?: string; statusMessage?: string }; message?: string }
    errorMsg.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Não foi possível remover a tag (servidor).'
  }
}

function entryLeavesCatalogAfterFavoriteChange(nextFavorite: boolean): boolean {
  if (favoriteCatalogFilter.value === 'exclude' && nextFavorite) return true
  if (favoriteCatalogFilter.value === 'only' && !nextFavorite) return true
  return false
}

async function toggleFavoriteAtIndex(i: number | null, opts?: { grid?: boolean }) {
  const playbackBefore = resolvePlaybackEntryFromUrls()
  const e = resolveCatalogActionEntry(i, opts)
  if (!e) return
  const trailerRel = e.trailerRel
  const ls = libSession(e)
  const idx = findFullEntryIndex(trailerRel, ls)
  const prevFav = e.isFavorite === true
  const prevAt = e.favoritedAtMs
  const next = !prevFav
  const prevFocusedRel = trailerRel
  const wasFullRel = playerUrl.value ? (playbackBefore?.trailerRel ?? trailerRel) : null
  const keepsPlayback =
    !!(previewUrl.value || playerUrl.value) &&
    playbackBefore !== null &&
    trailerRelMatchesFocus(playbackBefore.trailerRel, trailerRel) &&
    libSession(playbackBefore) === ls

  if (idx >= 0) {
    fullEntries.value[idx].isFavorite = next
    fullEntries.value[idx].favoritedAtMs = next ? Date.now() : undefined
  }

  if (keepsPlayback && entryLeavesCatalogAfterFavoriteChange(next)) {
    if (playerUrl.value) activeIndex.value = null
    focusedIndex.value = null
  }

  try {
    const res = await $fetch<{ isFavorite?: boolean; favoritedAt?: string | null }>('/api/library/favorite', {
      method: 'POST',
      body: { session: ls, trailerRel },
    })
    if (idx >= 0 && typeof res.isFavorite === 'boolean') {
      fullEntries.value[idx].isFavorite = res.isFavorite
      const atMs = res.favoritedAt ? Date.parse(res.favoritedAt) : NaN
      fullEntries.value[idx].favoritedAtMs = res.isFavorite && Number.isFinite(atMs) ? atMs : undefined
    }
    errorMsg.value = ''
    if (keepsPlayback && entryLeavesCatalogAfterFavoriteChange(res.isFavorite ?? next)) {
      if (playerUrl.value) activeIndex.value = null
      focusedIndex.value = null
    } else {
      await refocusAfterTagFilterChange(prevFocusedRel, wasFullRel)
    }
  } catch (err: unknown) {
    if (idx >= 0) {
      fullEntries.value[idx].isFavorite = prevFav
      fullEntries.value[idx].favoritedAtMs = prevAt
    }
    const ex = err as { data?: { message?: string; statusMessage?: string }; message?: string }
    errorMsg.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Não foi possível gravar o favorito (servidor).'
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
async function toggleMemorableAtIndex(i: number | null, opts?: { grid?: boolean }) {
  const e = resolveCatalogActionEntry(i, opts)
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
    const ex = err as { data?: { message?: string; statusMessage?: string }; message?: string }
    errorMsg.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Não foi possível gravar a marca «memorável».'
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

  const focusAfterDeleteRel =
    entries.value[i + 1]?.trailerRel ?? entries.value[i - 1]?.trailerRel ?? null

  const L = entries.value.length
  const focusSlotAfterDelete = L > 0 ? (i < L - 1 ? i : Math.max(0, i - 1)) : 0

  if (playerUrl.value && activeIndex.value === i) {
    await closeFullVideo()
  }

  try {
    await $fetch('/api/library/delete-title', {
      method: 'POST',
      body: { session: libSession(e), trailerRel: e.trailerRel },
    })
    errorMsg.value = ''
    await loadTrailers({
      preserveFocusTrailerRel: focusAfterDeleteRel,
      focusSlotAfterDelete,
    })
  } catch (err: unknown) {
    const ex = err as { data?: { message?: string; statusMessage?: string }; message?: string }
    errorMsg.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Não foi possível mover os ficheiros para a Lixeira.'
  }
}

function openCurrentVideoInEditor() {
  const entry = editorOpenEntry.value
  if (!entry?.hasMain) return
  // URLSearchParams garante %2F na subpasta (ex.: Pasta/[tag]/filme.mp4) —
  // sem isso a barra pode ser comida e o editor recebe "Pasta.[tag].filme.mp4".
  const q = new URLSearchParams()
  q.set('session', String(libSession(entry)))
  q.set('file', entry.mainRel.replace(/\\/g, '/'))
  q.set('useVideo', '1')
  void navigateTo(`/editor?${q.toString()}`)
}

function applyTrailerQueueState(state: TrailerQueueServerState) {
  trailerQueue.value = Array.isArray(state.items)
    ? state.items.map((i) => ({
        id: i.id,
        session: i.session,
        mainRel: i.mainRel,
        trailerRel: i.trailerRel,
        label: i.label,
        params: i.params as unknown as ShrinkInPlaceParams,
        status: i.status,
        error: i.error,
        jobId: i.jobId,
      }))
    : []
  trailerReprocessBusy.value = Boolean(state.busy)
  const running = trailerQueue.value.find((i) => i.status === 'running')
  if (running) {
    if (running.id !== trailerQueueLastRunningId) {
      trailerQueueLastRunningId = running.id
    }
  } else {
    trailerQueueLastRunningId = null
  }
}

function stopTrailerQueueMonitor() {
  trailerQueueMonitorWanted = false
  if (trailerQueueEs) {
    try {
      trailerQueueEs.close()
    } catch {
      /* */
    }
    trailerQueueEs = null
  }
}

function ensureTrailerQueueMonitor() {
  if (!import.meta.client) return
  trailerQueueMonitorWanted = true
  if (trailerQueueEs) return
  const es = new EventSource('/api/admin/trailer-reprocess-queue-stream')
  trailerQueueEs = es
  es.addEventListener('queue', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as TrailerQueueServerState
      applyTrailerQueueState(data)
      if (!data.busy && trailerQueueMonitorWanted) {
        window.setTimeout(() => {
          if (!trailerReprocessBusy.value) stopTrailerQueueMonitor()
        }, 2000)
      }
    } catch {
      /* */
    }
  })
  es.addEventListener('job-status', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as {
        itemId?: string
        status?: string
        error?: string | null
      }
      const item = trailerQueue.value.find((i) => i.id === data.itemId)
      if (data.status === 'done') {
        showToast(item ? `Trailer OK — ${item.label}` : 'Trailer reprocessado.', 'success')
        void softReloadCatalogKeepFocus()
      } else if (data.status === 'failed') {
        const msg =
          (typeof data.error === 'string' && data.error.trim()) ||
          'Falha ao reprocessar o trailer.'
        errorMsg.value = msg
        showToast(msg, 'error')
      }
    } catch {
      /* */
    }
  })
  es.onerror = () => {
    if (!trailerQueueMonitorWanted) return
    try {
      es.close()
    } catch {
      /* */
    }
    if (trailerQueueEs === es) trailerQueueEs = null
    window.setTimeout(() => {
      if (trailerQueueMonitorWanted && trailerReprocessBusy.value) ensureTrailerQueueMonitor()
    }, 1500)
  }
}

async function restoreTrailerQueueFromServer() {
  if (!import.meta.client) return
  try {
    const state = await $fetch<TrailerQueueServerState>('/api/admin/trailer-reprocess-queue')
    applyTrailerQueueState(state)
    if (state.busy || state.items.some((i) => i.status === 'pending' || i.status === 'running')) {
      ensureTrailerQueueMonitor()
    }
  } catch {
    /* */
  }
}

async function enqueueCurrentTrailerReprocess() {
  const entry = editorOpenEntry.value
  if (!entry?.hasMain) return
  if (serverPlatform.value.toLowerCase() !== 'win32') {
    errorMsg.value = 'Reprocessar trailer só funciona com o servidor em Windows.'
    return
  }
  if (!canEnqueueCurrentTrailer.value) {
    showToast('Este vídeo já está na fila de trailers.', 'error')
    return
  }
  const trailerParams = normalizeTrailerBatParams(trailerParamsForm.value)
  trailerParamsForm.value = trailerParams
  saveTrailerParamsToStorage(trailerParams)
  try {
    const state = await $fetch<TrailerQueueServerState>('/api/admin/trailer-reprocess-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        action: 'enqueue',
        session: libSession(entry),
        mainRel: entry.mainRel,
        trailerRel: entry.trailerRel,
        label: entry.mainFilename || entry.mainRel,
        params: trailerParams,
      },
    })
    applyTrailerQueueState(state)
    const n = state.items.filter((i) => i.status === 'pending' || i.status === 'running').length
    showToast(`Trailer na fila (${n} activo(s)).`, 'success')
    ensureTrailerQueueMonitor()
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string; message?: string }; message?: string }
    const msg =
      ex?.data?.message ||
      ex?.data?.statusMessage ||
      ex?.message ||
      'Não foi possível adicionar à fila de trailers.'
    showToast(msg, 'error')
    errorMsg.value = msg
  }
}

async function removeTrailerQueueItem(id: string) {
  try {
    const state = await $fetch<TrailerQueueServerState>('/api/admin/trailer-reprocess-queue', {
      method: 'POST',
      body: { action: 'remove', id },
    })
    applyTrailerQueueState(state)
  } catch {
    showToast('Não foi possível tirar da fila.', 'error')
  }
}

async function clearPendingTrailerQueue() {
  try {
    const state = await $fetch<TrailerQueueServerState>('/api/admin/trailer-reprocess-queue', {
      method: 'POST',
      body: { action: 'clear-pending' },
    })
    applyTrailerQueueState(state)
  } catch {
    showToast('Não foi possível limpar a fila.', 'error')
  }
}

async function clearFinishedTrailerQueue() {
  try {
    const state = await $fetch<TrailerQueueServerState>('/api/admin/trailer-reprocess-queue', {
      method: 'POST',
      body: { action: 'clear-finished' },
    })
    applyTrailerQueueState(state)
  } catch {
    showToast('Não foi possível limpar os processados.', 'error')
  }
}

function openTrailerReprocessDialog() {
  if (!editorOpenEntry.value?.hasMain) return
  trailerParamsForm.value = loadTrailerParamsFromStorage()
  trailerReprocessDialogOpen.value = true
  void restoreTrailerQueueFromServer()
  void applyTrailerSpeedIfShrunk()
}

function resetTrailerParamsForm() {
  trailerParamsForm.value = { ...TRAILER_BAT_PARAMS_DEFAULT }
  if (shrinkAlreadyDone.value) trailerParamsForm.value.speed = 1
}

function applyShrinkQueueState(state: ShrinkQueueServerState) {
  shrinkQueue.value = Array.isArray(state.items) ? state.items.map((i) => ({ ...i })) : []
  shrinkInPlaceBusy.value = Boolean(state.busy)
  const running = shrinkQueue.value.find((i) => i.status === 'running')
  if (running) {
    if (typeof window !== 'undefined' && shrinkPanelDismissTimer != null) {
      window.clearTimeout(shrinkPanelDismissTimer)
      shrinkPanelDismissTimer = null
    }
    if (running.id !== shrinkQueueLastRunningId) {
      shrinkQueueLastRunningId = running.id
      resetShrinkInPlaceProgressUi(running.label)
      ingestShrinkLogLine(
        `[UI] fila ${shrinkQueueDoneCount.value + 1}/${shrinkQueue.value.length} · ${running.label} · ${running.params.speed}x · ${running.params.height}px · ${running.params.codec}`,
      )
    }
    shrinkInPlaceFileLabel.value = running.label
    shrinkInPlaceLastStatus.value = `Shrink fila ${shrinkQueueDoneCount.value + 1}/${shrinkQueue.value.length}`
  } else {
    shrinkQueueLastRunningId = null
    if (!state.busy) {
      const fail = shrinkQueue.value.filter((i) => i.status === 'failed').length
      const ok = shrinkQueue.value.filter((i) => i.status === 'done').length
      if (ok + fail > 0) {
        if (fail === 0) {
          shrinkInPlaceFailed.value = false
          shrinkInPlaceLastStatus.value = `Fila concluída (${ok})`
          shrinkInPlaceLatestLine.value = `Fila concluída (${ok})`
        } else {
          shrinkInPlaceFailed.value = true
          shrinkInPlaceLastStatus.value = `Fila: ${ok} ok · ${fail} falhou`
          shrinkInPlaceLatestLine.value = `Fila: ${ok} ok · ${fail} falhou`
        }
        scheduleShrinkPanelDismiss()
      } else if (!shrinkQueue.value.some((i) => i.status === 'pending' || i.status === 'running')) {
        scheduleShrinkPanelDismiss()
      }
    }
  }
}

let shrinkPanelDismissTimer: number | null = null
function scheduleShrinkPanelDismiss() {
  if (typeof window === 'undefined') return
  if (shrinkPanelDismissTimer != null) {
    window.clearTimeout(shrinkPanelDismissTimer)
    shrinkPanelDismissTimer = null
  }
  shrinkPanelDismissTimer = window.setTimeout(() => {
    shrinkPanelDismissTimer = null
    if (shrinkInPlaceBusy.value) return
    if (shrinkQueue.value.some((i) => i.status === 'pending' || i.status === 'running')) return
    resetShrinkInPlaceProgressUi()
  }, 2800)
}

function stopShrinkQueueMonitor() {
  shrinkQueueMonitorWanted = false
  if (shrinkQueueEs) {
    try {
      shrinkQueueEs.close()
    } catch {
      /* */
    }
    shrinkQueueEs = null
  }
}

function ensureShrinkQueueMonitor() {
  if (!import.meta.client) return
  shrinkQueueMonitorWanted = true
  if (shrinkQueueEs) return
  const es = new EventSource('/api/admin/shrink-in-place-queue-stream')
  shrinkQueueEs = es
  es.addEventListener('queue', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as ShrinkQueueServerState
      applyShrinkQueueState(data)
      if (!data.busy && shrinkQueueMonitorWanted) {
        window.setTimeout(() => {
          if (!shrinkInPlaceBusy.value) stopShrinkQueueMonitor()
        }, 2000)
      }
    } catch {
      /* */
    }
  })
  es.addEventListener('line', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as {
        text?: string
        seq?: number
        itemId?: string
      }
      if (typeof data.text === 'string') ingestShrinkLogLine(data.text, data.seq)
    } catch {
      /* */
    }
  })
  es.addEventListener('job-status', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as {
        itemId?: string
        status?: string
        error?: string | null
      }
      const item = shrinkQueue.value.find((i) => i.id === data.itemId)
      if (data.status === 'done') {
        shrinkInPlacePct.value = 100
        shrinkInPlaceFailed.value = false
        shrinkInPlaceLatestLine.value = item ? `OK — ${item.label}` : 'Shrink concluído'
        ingestShrinkLogLine(item ? `[OK] fila: ${item.label}` : '[OK] shrink')
        void softReloadCatalogKeepFocus()
      } else if (data.status === 'failed') {
        shrinkInPlaceFailed.value = true
        shrinkInPlaceLastStatus.value = 'Shrink falhou'
        const msg =
          (typeof data.error === 'string' && data.error.trim()) ||
          shrinkInPlaceLatestLine.value ||
          'Falha no shrink — o original não foi alterado.'
        shrinkInPlaceErrorSummary.value = msg
        errorMsg.value = msg
        ingestShrinkLogLine(`[ERRO] ${msg}`)
      }
    } catch {
      /* */
    }
  })
  es.onerror = () => {
    if (!shrinkQueueMonitorWanted) return
    try {
      es.close()
    } catch {
      /* */
    }
    if (shrinkQueueEs === es) shrinkQueueEs = null
    window.setTimeout(() => {
      if (shrinkQueueMonitorWanted && shrinkInPlaceBusy.value) ensureShrinkQueueMonitor()
    }, 1500)
  }
}

async function restoreShrinkQueueFromServer() {
  if (!import.meta.client) return
  try {
    const state = await $fetch<ShrinkQueueServerState>('/api/admin/shrink-in-place-queue')
    const running = state.items.find((i) => i.status === 'running')
    if (running) shrinkQueueLastRunningId = running.id
    applyShrinkQueueState(state)
    if (state.busy || state.items.some((i) => i.status === 'pending' || i.status === 'running')) {
      ensureShrinkQueueMonitor()
    }
  } catch {
    /* */
  }
}

async function enqueueCurrentShrinkInPlace() {
  const entry = editorOpenEntry.value
  if (!entry?.hasMain) return
  if (serverPlatform.value.toLowerCase() !== 'win32') {
    errorMsg.value = 'Shrink in-place só funciona com o servidor em Windows.'
    return
  }
  if (!canEnqueueCurrentShrink.value) {
    showToast('Este vídeo já está na fila.', 'error')
    return
  }
  await refreshShrinkAlreadyDoneHint()
  if (shrinkAlreadyDone.value) {
    const when = shrinkAlreadyDoneAt.value
      ? new Date(shrinkAlreadyDoneAt.value).toLocaleString()
      : null
    const msg1 = when
      ? `Este vídeo já foi shrinkado pelo grid (${when}).\n\nEnfileirar outra vez? O ficheiro actual será processado e substituído de novo.`
      : `Este vídeo já foi shrinkado pelo grid.\n\nEnfileirar outra vez? O ficheiro actual será processado e substituído de novo.`
    if (!confirm(msg1)) return
    if (
      !confirm(
        'Confirma outra vez: este vídeo já tem histórico de shrink.\n\nTens a certeza que queres enfileirar e substituir o ficheiro de novo?',
      )
    ) {
      return
    }
  }
  const params = normalizeShrinkInPlaceParams(shrinkInPlaceForm.value)
  shrinkInPlaceForm.value = params
  saveShrinkInPlaceParamsToStorage(params)
  try {
    if (playerUrl.value) await closeFullVideo()
    const state = await $fetch<ShrinkQueueServerState>('/api/admin/shrink-in-place-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        action: 'enqueue',
        session: libSession(entry),
        mainRel: entry.mainRel,
        trailerRel: entry.trailerRel,
        label: entry.mainFilename || entry.mainRel,
        params,
      },
    })
    applyShrinkQueueState(state)
    const pending = state.items.filter((i) => i.status === 'pending' || i.status === 'running').length
    showToast(`Na fila (${pending} activo(s)).`, 'success')
    const running = state.items.find((i) => i.status === 'running')
    if (running && !shrinkInPlaceLogLines.value.length) {
      resetShrinkInPlaceProgressUi(running.label)
    }
    ensureShrinkQueueMonitor()
  } catch (err: unknown) {
    const ex = err as { data?: { statusMessage?: string; message?: string }; message?: string }
    const msg =
      ex?.data?.message ||
      ex?.data?.statusMessage ||
      ex?.message ||
      'Não foi possível adicionar à fila.'
    showToast(msg, 'error')
    errorMsg.value = msg
  }
}

async function removeShrinkQueueItem(id: string) {
  try {
    const state = await $fetch<ShrinkQueueServerState>('/api/admin/shrink-in-place-queue', {
      method: 'POST',
      body: { action: 'remove', id },
    })
    applyShrinkQueueState(state)
  } catch {
    showToast('Não foi possível tirar da fila.', 'error')
  }
}

async function clearPendingShrinkQueue() {
  try {
    const state = await $fetch<ShrinkQueueServerState>('/api/admin/shrink-in-place-queue', {
      method: 'POST',
      body: { action: 'clear-pending' },
    })
    applyShrinkQueueState(state)
  } catch {
    showToast('Não foi possível limpar a fila.', 'error')
  }
}

async function clearFinishedShrinkQueue() {
  try {
    const state = await $fetch<ShrinkQueueServerState>('/api/admin/shrink-in-place-queue', {
      method: 'POST',
      body: { action: 'clear-finished' },
    })
    applyShrinkQueueState(state)
  } catch {
    showToast('Não foi possível limpar os processados.', 'error')
  }
}

const shrinkAlreadyDoneAt = ref<number | null>(null)
const shrinkAlreadyDone = ref(false)
const trailerShrunkNotice = computed(() => {
  if (!shrinkAlreadyDone.value) return ''
  let when = ''
  if (shrinkAlreadyDoneAt.value) {
    try {
      when = ` em ${new Date(shrinkAlreadyDoneAt.value).toLocaleString()}`
    } catch {
      /* */
    }
  }
  if (trailerParamsForm.value.speed === 1) {
    return `Este vídeo já foi shrinkado${when}. Velocidade do trailer em 1× para não acelerar outra vez.`
  }
  return `Este vídeo já foi shrinkado${when}.`
})
const shrinkAlreadyDoneHint = computed(() => {
  if (!shrinkAlreadyDone.value) return ''
  if (shrinkAlreadyDoneAt.value) {
    try {
      return `Histórico: shrink pelo grid em ${new Date(shrinkAlreadyDoneAt.value).toLocaleString()}. Enfileirar outra vez substitui o ficheiro de novo — vais precisar de confirmar duas vezes.`
    } catch {
      /* */
    }
  }
  return 'Histórico: este vídeo já foi shrinkado pelo grid. Enfileirar outra vez substitui o ficheiro de novo — vais precisar de confirmar duas vezes.'
})

async function refreshShrinkAlreadyDoneHint() {
  shrinkAlreadyDoneAt.value = null
  shrinkAlreadyDone.value = false
  const entry = editorOpenEntry.value
  if (!entry?.hasMain || !import.meta.client) return
  const session = libSession(entry)
  const mainRel = entry.mainRel
  const mainBase = mainRel.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || ''
  const fromQueue = shrinkQueue.value.some(
    (i) =>
      i.status === 'done' &&
      i.session === session &&
      (i.mainRel === mainRel ||
        i.mainRel.replace(/\\/g, '/').split('/').pop()?.toLowerCase() === mainBase),
  )
  if (fromQueue) shrinkAlreadyDone.value = true
  try {
    const res = await $fetch<{
      alreadyShrunk?: boolean
      entry?: { endedAt?: number } | null
    }>('/api/admin/process-job-history', {
      query: {
        kind: 'shrink',
        session,
        mainRel,
      },
    })
    if (res.alreadyShrunk) {
      shrinkAlreadyDone.value = true
      if (res.entry?.endedAt) shrinkAlreadyDoneAt.value = res.entry.endedAt
    }
  } catch {
    /* */
  }
}

async function applyTrailerSpeedIfShrunk() {
  const entry = editorOpenEntry.value
  const session = entry ? libSession(entry) : -1
  const mainRel = entry?.mainRel ?? ''
  await refreshShrinkAlreadyDoneHint()
  if (!trailerReprocessDialogOpen.value) return
  const now = editorOpenEntry.value
  if (!now || libSession(now) !== session || now.mainRel !== mainRel) return
  if (shrinkAlreadyDone.value) trailerParamsForm.value.speed = 1
}

function openShrinkInPlaceDialog() {
  if (!editorOpenEntry.value?.hasMain) return
  shrinkInPlaceForm.value = loadShrinkInPlaceParamsFromStorage()
  shrinkInPlaceDialogOpen.value = true
  void restoreShrinkQueueFromServer()
  void refreshShrinkAlreadyDoneHint()
}

function resetShrinkInPlaceForm() {
  shrinkInPlaceForm.value = { ...SHRINK_IN_PLACE_PARAMS_DEFAULT }
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
    const ex = err as { data?: { message?: string; statusMessage?: string }; message?: string }
    moveTitleError.value =
      (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Não foi possível mover os ficheiros.'
  } finally {
    moveTitleBusy.value = false
  }
}

function applyPlaybackRateToAllVideos(rate: number) {
  if (isTvLayout.value) {
    const minimal = tvMinimalVideoRef.value
    if (minimal && Math.abs(minimal.playbackRate - rate) > 0.001) {
      minimal.playbackRate = rate
    }
    const stage = tvStageVideoRef.value
    if (stage && stage !== minimal && Math.abs(stage.playbackRate - rate) > 0.001) {
      stage.playbackRate = rate
    }
    return
  }
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
  // No modo TV minimal, o select de velocidade só existe no completo — não sincronizar a partir do trailer.
  if (isTvLayout.value && !playerUrl.value) return
  const v = stageVideoEl()
  if (v && Number.isFinite(v.playbackRate)) {
    if (Math.abs(v.playbackRate - playbackRate.value) < 0.001) return
    setPlaybackRate(v.playbackRate)
  }
}

let sessionsBootstrapped = false

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

    if (routeSession !== null && sessions.value.some((s) => s.id === routeSession)) {
      sessionIndex.value = routeSession
      sessionsBootstrapped = true
      return
    }

    if (!sessionsBootstrapped) {
      sessionIndex.value = defaultSessionId
      sessionsBootstrapped = true
      return
    }

    if (!sessions.value.some((s) => s.id === sessionIndex.value)) {
      sessionIndex.value = defaultSessionId
    }
    sessionsBootstrapped = true
  } catch (e: unknown) {
    sessions.value = []
    const err = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    errorMsg.value =
      (err?.data?.message || err?.data?.statusMessage) || err?.message || 'Não foi possível carregar as sessões (VIDEO_ROOT).'
  }
}

/**
 * Refaz `loadSessions` + `loadTrailers` preservando o foco/full em curso.
 * Usado pelo canal `BroadcastChannel` quando a admin pede para recarregar
 * (depois de gerar trailers/previews ou editar o menu de pastas no Admin).
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
  const prevSession = sessionIndex.value
  if (prevSession === SURPRESA_SESSION_ID && id !== SURPRESA_SESSION_ID) {
    void $fetch('/api/trailers/surprise-viewed', { method: 'POST' }).catch(() => {})
  }
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
  if (!catalogPrefsEnabled.value) {
    catalogTagFilter.value = null
    folderFilterInput.value = ''
  }
  trailerTagPanelOpen.value = false
  shuffleForwardEnabled.value = false
  sequentialForwardOnceAfterPrev.value = false
  sessionIndex.value = id
  playerUrl.value = null
  activeIndex.value = null
  previewUrl.value = null
  await loadTrailers(opts)
}

/** Índice inicial do catálogo: primeiro da lista já ordenada (ex. mais recente com Data ↓). */
function fallbackCatalogStartIndex(_len: number): number {
  return 0
}

type CatalogLoadOpts = {
  preserveFocusTrailerRel?: string | null
  focusSlotAfterDelete?: number | null
}

function applyServerCatalogPayload(data: {
  serverPlatform?: string
  catalogMode?: 'trailers' | 'main-only'
  fastPlay?: {
    rate?: number
    stepSeconds?: number
    windowSeconds?: number
    lastMinuteSeconds?: number
    fullscreenOnFastPlay?: boolean
  }
}) {
  serverPlatform.value =
    typeof data.serverPlatform === 'string' ? data.serverPlatform : ''
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
    const fsOn = data.fastPlay.fullscreenOnFastPlay
    fastPlayFullscreenOn.value = typeof fsOn === 'boolean' ? fsOn : true
  }
  catalogMode.value = data.catalogMode === 'main-only' ? 'main-only' : 'trailers'
}

async function applyCatalogFocusAfterLoad(
  list: TrailerListEntry[],
  opts: CatalogLoadOpts | undefined,
  keepPlaybackAcrossReload: boolean,
  preserveRel: string | null,
) {
  const qSessionFromRoute = parseShareSessionQuery(route.query.session)
  const pending = peekPendingCatalogOpen()
  const shareRelForThisSession =
    !preserveRel &&
    (qSessionFromRoute === null || qSessionFromRoute === sessionIndex.value)
      ? pending.rel
      : ''
  const shareFileForThisSession =
    !preserveRel &&
    (qSessionFromRoute === null || qSessionFromRoute === sessionIndex.value)
      ? pending.file
      : ''

  if (list.length) {
    if (preserveRel) {
      const ni = list.findIndex((e) => entryMatchesShareRel(e, preserveRel))
      if (ni >= 0) {
        focusedIndex.value = ni
      } else if (keepPlaybackAcrossReload) {
        focusedIndex.value = null
      } else {
        const slotRaw = opts?.focusSlotAfterDelete
        const slot =
          typeof slotRaw === 'number' && Number.isFinite(slotRaw)
            ? Math.min(Math.max(0, Math.trunc(slotRaw)), list.length - 1)
            : 0
        focusedIndex.value = slot
      }
    } else if (shareRelForThisSession || shareFileForThisSession) {
      const findIx = (lst: TrailerListEntry[]) =>
        lst.findIndex(
          (e) =>
            (shareRelForThisSession && entryMatchesShareRel(e, shareRelForThisSession)) ||
            (shareFileForThisSession && entryMatchesMainRel(e, shareFileForThisSession)),
        )
      let ei = findIx(list)
      if (ei < 0) {
        const inFull = fullEntries.value.some(
          (e) =>
            (shareRelForThisSession && entryMatchesShareRel(e, shareRelForThisSession)) ||
            (shareFileForThisSession && entryMatchesMainRel(e, shareFileForThisSession)),
        )
        if (inFull) {
          clearCatalogFiltersForShareFocus()
          ei = findIx(entries.value)
        }
      }
      const len = ei >= 0 ? entries.value.length || list.length : list.length
      focusedIndex.value = ei >= 0 ? ei : fallbackCatalogStartIndex(len)
    } else {
      focusedIndex.value = fallbackCatalogStartIndex(list.length)
    }
  } else {
    focusedIndex.value = null
  }

  if (keepPlaybackAcrossReload && preserveRel) {
    const niFull = list.findIndex((e) => entryMatchesShareRel(e, preserveRel))
    if (niFull >= 0) {
      activeIndex.value = niFull
      focusedIndex.value = niFull
    } else {
      activeIndex.value = null
      focusedIndex.value = null
    }
  } else {
    activeIndex.value = null
    playerUrl.value = null
    setPreviewForIndex(focusedIndex.value)
  }

  if (isTvLayout.value) {
    if (list.length) {
      if (keepPlaybackAcrossReload && playerUrl.value) {
        void nextTick(() => applyTvMinimalVideoSrc(tvMinimalVideoSrc.value))
      } else {
        ensureTvMinimalPlayback(focusedIndex.value ?? 0)
      }
    }
    return
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
}

function teardownRecentsLoadObserver() {
  recentsLoadObserver?.disconnect()
  recentsLoadObserver = null
}

function setupRecentsLoadObserver() {
  teardownRecentsLoadObserver()
  if (
    !recentsPaginationEnabled.value ||
    !isTvLayout.value ||
    sessionIndex.value !== RECENTS_SESSION_ID ||
    !recentsHasMore.value
  ) {
    return
  }
  if (!import.meta.client) return
  const root = isTvLayout.value
    ? tvMinimalRailScroll.value
    : document.querySelector('.trailer-grid-scroll')
  const sentinel = recentsLoadSentinel.value
  if (!root || !sentinel) return
  recentsLoadObserver = new IntersectionObserver(
    (observed) => {
      if (observed.some((e) => e.isIntersecting)) void tryLoadRecentsMore('sentinel')
    },
    { root, rootMargin: '160px 0px', threshold: 0 },
  )
  recentsLoadObserver.observe(sentinel)
}

async function tryLoadRecentsMore(trigger: 'sentinel' | 'focus' | 'scroll') {
  if (!recentsPaginationEnabled.value) return
  if (loading.value || recentsLoadingMore.value) return
  if (!isTvLayout.value || sessionIndex.value !== RECENTS_SESSION_ID) return
  const playback = resolvePlaybackEntryFromUrls()
  const preserveFocusRel =
    playback?.trailerRel ??
    (focusedIndex.value !== null ? captureEntryRel(focusedIndex.value) : null)
  const preserveFocusLib = playback
    ? libSession(playback)
    : focusedIndex.value !== null && entries.value[focusedIndex.value]
      ? libSession(entries.value[focusedIndex.value]!)
      : undefined
  const preserveActiveRel = playerUrl.value ? captureEntryRel(activeIndex.value) : null
  const preserveActiveLib =
    activeIndex.value !== null && entries.value[activeIndex.value]
      ? libSession(entries.value[activeIndex.value]!)
      : undefined
  const result = await recentsCatalog.loadMore(trigger)
  if (!result) return
  if (preserveFocusRel) {
    const ni = findEntryIndexInEntries(preserveFocusRel, preserveFocusLib)
    if (ni >= 0) focusedIndex.value = ni
  }
  if (preserveActiveRel) {
    const na = findEntryIndexInEntries(preserveActiveRel, preserveActiveLib)
    if (na >= 0) activeIndex.value = na
  }
  syncCatalogIndicesToPlayback()
  await nextTick()
  if (focusedIndex.value !== null && isTvLayout.value) {
    const root = tvMinimalRailScroll.value
    const btn = root?.querySelectorAll<HTMLElement>('.tv-minimal-thumb')[focusedIndex.value]
    btn?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }
  setupRecentsLoadObserver()
}

async function loadRecentsTrailers(opts?: CatalogLoadOpts) {
  const myToken = ++catalogLoadToken
  syncRecentsOriginApiFilter()
  teardownRecentsLoadObserver()
  errorMsg.value = ''
  searchSessionError.value = ''
  loading.value = true
  gridInlinePreviewIndex.value = null
  catalogGalleryIndex.value = null
  const preserveRel =
    typeof opts?.preserveFocusTrailerRel === 'string' ? opts.preserveFocusTrailerRel : null
  const playingTrailerRel = resolvePlaybackEntryFromUrls()?.trailerRel ?? null
  const keepPlaybackAcrossReload = Boolean(
    preserveRel &&
      playingTrailerRel &&
      trailerRelMatchesFocus(playingTrailerRel, preserveRel),
  )
  try {
    const data = recentsPaginationEnabled.value
      ? await recentsCatalog.loadInitial()
      : await recentsCatalog.loadFull()
    if (myToken !== catalogLoadToken) return
    applyServerCatalogPayload(data)
    tagSuggestions.value = Array.isArray(data.tagSuggestions) ? data.tagSuggestions : []
    await nextTick()
    await applyCatalogFocusAfterLoad(
      entries.value,
      opts,
      keepPlaybackAcrossReload,
      preserveRel,
    )
    await refreshRecentPlaybackKeys()
    await nextTick()
    if (recentsPaginationEnabled.value) {
      setupRecentsLoadObserver()
    } else {
      teardownRecentsLoadObserver()
    }
  } catch (e: unknown) {
    if (myToken !== catalogLoadToken) return
    const err = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    fullEntries.value = []
    tagSuggestions.value = []
    recentsCatalog.reset()
    errorMsg.value =
      (err?.data?.message || err?.data?.statusMessage) || err?.message || 'Não foi possível carregar Destaques.'
  } finally {
    if (myToken === catalogLoadToken) loading.value = false
  }
}

async function loadTrailers(opts?: {
  preserveFocusTrailerRel?: string | null
  /** Após apagar: se preserveFocusTrailerRel não existir na nova lista, focar este índice (clamp), em vez de aleatório. */
  focusSlotAfterDelete?: number | null
}) {
  if (!sessions.value.length) {
    fullEntries.value = []
    tagSuggestions.value = []
    focusedIndex.value = null
    gridInlinePreviewIndex.value = null
    catalogGalleryIndex.value = null
    serverPlatform.value = ''
    catalogMode.value = 'trailers'
    recentPlaybackKeyList.value = []
    return
  }
  const myToken = ++catalogLoadToken
  errorMsg.value = ''
  searchSessionError.value = ''
  loading.value = true
  gridInlinePreviewIndex.value = null
  catalogGalleryIndex.value = null
  const preserveRel =
    typeof opts?.preserveFocusTrailerRel === 'string' ? opts.preserveFocusTrailerRel : null
  const playingTrailerRel = resolvePlaybackEntryFromUrls()?.trailerRel ?? null
  const keepPlaybackAcrossReload = Boolean(
    preserveRel &&
      playingTrailerRel &&
      trailerRelMatchesFocus(playingTrailerRel, preserveRel),
  )
  if (sessionIndex.value === RECENTS_SESSION_ID) {
    if (isTvLayout.value && !catalogOriginFilter.value) {
      recentsCatalog.setPaginationEnabled(true)
    } else {
      recentsCatalog.setPaginationEnabled(false)
    }
    await loadRecentsTrailers(opts)
    return
  }

  const isSearchSession = sessionIndex.value === SEARCH_SESSION_ID
  const searchQ = searchSessionQuery.value.trim()
  const trailerUrl = isSearchSession
    ? searchQ.length >= 2
      ? `/api/library/search?q=${encodeURIComponent(searchQ)}&mode=${encodeURIComponent(searchSessionMode.value)}&match=${encodeURIComponent(searchSessionMatch.value)}`
      : ''
    : sessionIndex.value === SURPRESA_SESSION_ID
      ? '/api/trailers/surprise'
      : sessionIndex.value === LAST_VIEWED_SESSION_ID
        ? '/api/trailers/last-viewed'
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
      originCounts?: { session: number; tag: string; count: number }[]
      tagSuggestions?: string[]
      serverPlatform?: string
      catalogMode?: 'trailers' | 'main-only'
      fastPlay?: {
        rate?: number
        stepSeconds?: number
        windowSeconds?: number
        lastMinuteSeconds?: number
        fullscreenOnFastPlay?: boolean
      }
    }>(trailerUrl)
    if (myToken !== catalogLoadToken) return
    applyServerCatalogPayload(data)
    if (sessionIndex.value === RECENTS_SESSION_ID) {
      recentsCatalog.applyOriginCounts(data.originCounts)
    }
    catalogMode.value =
      !isSearchSession && data.catalogMode === 'main-only' ? 'main-only' : 'trailers'
    fullEntries.value = data.items.map((e) => ({
      ...e,
      mainSizeBytes: e.mainSizeBytes ?? 0,
      mainSortTimeMs: e.mainSortTimeMs ?? 0,
      highlightedAtMs: e.highlightedAtMs,
    }))
    tagSuggestions.value = Array.isArray(data.tagSuggestions) ? data.tagSuggestions : []
    await nextTick()
    await applyCatalogFocusAfterLoad(
      entries.value,
      opts,
      keepPlaybackAcrossReload,
      preserveRel,
    )
    await refreshRecentPlaybackKeys()
  } catch (e: unknown) {
    if (myToken !== catalogLoadToken) return
    const err = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    fullEntries.value = []
    tagSuggestions.value = []
    if (isSearchSession) {
      searchSessionError.value =
        (err?.data?.message || err?.data?.statusMessage) || err?.message || 'Não foi possível executar a busca global.'
    } else {
      errorMsg.value =
        (err?.data?.message || err?.data?.statusMessage) || err?.message || 'Não foi possível carregar a lista de trailers.'
    }
  } finally {
    if (myToken === catalogLoadToken) loading.value = false
  }
}

function routeQueryString(q: unknown): string {
  if (q === undefined || q === null) return ''
  if (Array.isArray(q)) return q[0] != null ? String(q[0]) : ''
  return String(q)
}

function parseCatalogTriFilterQuery(raw: unknown): CatalogTriFilter | null {
  const s = routeQueryString(raw).trim().toLowerCase()
  if (s === '') return null
  if (s === 'all' || s === 'only' || s === 'exclude') return s
  return null
}

function normalizeShareRelQuery(raw: unknown): string {
  let t = routeQueryString(raw).trim().replace(/\\/g, '/')
  if (!t) return ''
  if (/%[0-9a-fA-F]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t)
    } catch {
      /* keep raw */
    }
  }
  t = t.replace(/\+/g, ' ').trim().replace(/\\/g, '/')
  if (!t || t.includes('..')) return ''
  return t
}

function readShareFileFromRoute(): string {
  return (
    normalizeShareRelQuery(route.query.file) ||
    normalizeShareRelQuery(route.query.main) ||
    ''
  )
}

const pendingCatalogOpen = ref<{ rel: string; file: string; session: number | null } | null>(null)

function capturePendingCatalogOpenFromRoute() {
  const rel = normalizeShareRelQuery(route.query.rel)
  const file = readShareFileFromRoute()
  const session = parseShareSessionQuery(route.query.session)
  if (!rel && !file && session === null) {
    pendingCatalogOpen.value = null
    return
  }
  pendingCatalogOpen.value = { rel, file, session }
}

function peekPendingCatalogOpen(): { rel: string; file: string } {
  const p = pendingCatalogOpen.value
  if (!p) {
    return {
      rel: normalizeShareRelQuery(route.query.rel),
      file: readShareFileFromRoute(),
    }
  }
  return {
    rel: p.rel || normalizeShareRelQuery(route.query.rel),
    file: p.file || readShareFileFromRoute(),
  }
}

function clearPendingCatalogOpen() {
  pendingCatalogOpen.value = null
}

function parseShareSessionQuery(raw: unknown): number | null {
  const s = routeQueryString(raw)
  if (s === '') return null
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n)) return null
  if (n === SEARCH_SESSION_ID) return n
  if (n === RECENTS_SESSION_ID) return n
  if (n === SURPRESA_SESSION_ID) return n
  if (n === LAST_VIEWED_SESSION_ID) return n
  if (n < 0) return null
  return n
}

function focusEntryByTrailerRel(trailerRel: string): boolean {
  return focusEntryByShareTarget({ rel: trailerRel })
}

function shareRouteQueryMatchesDesired(desired: Record<string, string>): boolean {
  const curS = routeQueryString(route.query.session)
  const curR = normalizeShareRelQuery(route.query.rel)
  const curM = readShareFileFromRoute()
  const curFav = routeQueryString(route.query.fav).trim().toLowerCase()
  const curDst = routeQueryString(route.query.dst).trim().toLowerCase()
  const wantS = desired.session ?? ''
  const wantR = desired.rel ? normalizeShareRelQuery(desired.rel) : ''
  const wantM = desired.file
    ? normalizeShareRelQuery(desired.file)
    : desired.main
      ? normalizeShareRelQuery(desired.main)
      : ''
  const wantFav = (desired.fav ?? '').trim().toLowerCase()
  const wantDst = (desired.dst ?? '').trim().toLowerCase()
  return (
    curS === wantS &&
    curR === wantR &&
    curM === wantM &&
    curFav === wantFav &&
    curDst === wantDst
  )
}

/**
 * Query desejada: `session` sempre que há biblioteca.
 * `rel` não é imposto ao abrir o completo (evita router.replace / reload no Silk).
 * Em trailer, `rel` só se o URL já o trouxer e coincidir com o focado (link partilhado).
 * Ao sair do completo (`justClosedFull`), só `session`.
 */
function buildDesiredShareQuery(justClosedFull: boolean): Record<string, string> {
  if (!sessions.value.length) return {}
  const sessionStr = String(sessionIndex.value)
  const isFull = Boolean(playerUrl.value && activeIndex.value !== null)

  const fav = favoriteCatalogFilter.value
  const dst = destaquesCatalogFilter.value
  const filterQuery: Record<string, string> = {}
  if (fav !== 'all') filterQuery.fav = fav
  if (dst !== 'all') filterQuery.dst = dst

  if (isFull) {
    const out: Record<string, string> = { session: sessionStr, ...filterQuery }
    const existingRel = normalizeShareRelQuery(route.query.rel)
    if (existingRel) out.rel = existingRel
    if (fromDuplicatesLite.value) out.dup = '1'
    return out
  }

  if (justClosedFull) {
    const closed: Record<string, string> = { session: sessionStr, ...filterQuery }
    if (fromDuplicatesLite.value) closed.dup = '1'
    return closed
  }

  const out: Record<string, string> = { session: sessionStr, ...filterQuery }
  if (fromDuplicatesLite.value) out.dup = '1'
  const pending = peekPendingCatalogOpen()
  const rr = pending.rel || normalizeShareRelQuery(route.query.rel)
  const mm = pending.file || readShareFileFromRoute()
  const focused = focusedIndex.value !== null ? entries.value[focusedIndex.value] : null
  if (focused) {
    if (rr && entryMatchesShareRel(focused, rr)) out.rel = focused.trailerRel || rr
    if (mm && entryMatchesMainRel(focused, mm)) out.file = focused.mainRel || mm
  } else if (pendingCatalogOpen.value) {
    if (rr) out.rel = rr
    if (mm) out.file = mm
  }
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
    .catch(() => {})
    .finally(() => {
      void nextTick(() => {
        requestAnimationFrame(() => {
          ignoreNextRouteQueryWatch = false
        })
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
  return isTvLayout.value
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
    behavior: isTvLayout.value ? 'auto' : 'smooth',
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
  const pending = peekPendingCatalogOpen()
  const rel = pending.rel
  const main = pending.file
  const qFav = parseCatalogTriFilterQuery(route.query.fav)
  const qDst = parseCatalogTriFilterQuery(route.query.dst)
  if (rel === '' && main === '' && qSession === null && qFav === null && qDst === null) return

  suppressShareUrlSync = true
  try {
    if (qFav !== null) favoriteCatalogFilter.value = qFav
    else favoriteCatalogFilter.value = 'all'
    if (qDst !== null) destaquesCatalogFilter.value = qDst
    else destaquesCatalogFilter.value = 'all'

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

    if (rel || main) {
      const playingEntry =
        playerUrl.value && activeIndex.value !== null
          ? entries.value[activeIndex.value]
          : null
      const playingMatches =
        !!playingEntry &&
        ((rel && entryMatchesShareRel(playingEntry, rel)) ||
          (main && entryMatchesMainRel(playingEntry, main)))
      if (playerUrl.value && playingEntry && !playingMatches) {
        await closeFullVideo()
      }

      const cur = focusedIndex.value !== null ? entries.value[focusedIndex.value] : null
      const curMatches =
        !!cur &&
        ((rel && entryMatchesShareRel(cur, rel)) || (main && entryMatchesMainRel(cur, main)))
      if (!curMatches) {
        if (playerUrl.value && playingMatches) {
          const ix = entries.value.findIndex(
            (e) =>
              (rel && entryMatchesShareRel(e, rel)) || (main && entryMatchesMainRel(e, main)),
          )
          if (ix >= 0) {
            focusedIndex.value = ix
            clearPendingCatalogOpen()
          }
        } else if (focusEntryByShareTarget({ rel, main })) {
          clearPendingCatalogOpen()
        } else {
          errorMsg.value = `Título não encontrado nesta biblioteca: ${main || rel}`
        }
      } else {
        clearPendingCatalogOpen()
      }
    }

    if ((rel || main) && focusedIndex.value !== null) {
      const focused = entries.value[focusedIndex.value]
      const ok =
        !!focused &&
        ((rel && entryMatchesShareRel(focused, rel)) ||
          (main && entryMatchesMainRel(focused, main)))
      if (ok && focused?.trailerRel) {
        await nextTick()
        requestAnimationFrame(() => {
          scrollCatalogGridToTrailerRel(focused.trailerRel)
        })
      }
    }
  } finally {
    suppressShareUrlSync = false
  }
}

watch(
  () => [route.query.session, route.query.rel, route.query.file, route.query.main, route.query.fav, route.query.dst],
  async () => {
    if (ignoreNextRouteQueryWatch) return
    if (!sessions.value.length) return
    capturePendingCatalogOpenFromRoute()
    await applyShareQueryFromRoute()
  },
)

watch(entries, () => {
  syncCatalogIndicesToPlayback()
}, { flush: 'post' })

watch(focusedIndex, (fi) => {
  if (!isTvLayout.value || sessionIndex.value !== RECENTS_SESSION_ID || fi === null) return
  if (!recentsPaginationEnabled.value) return
  const n = entries.value.length
  if (n && recentsHasMore.value && fi >= n - 2) void tryLoadRecentsMore('focus')
})

watch([entries, recentsHasMore, recentsPaginationEnabled, catalogGridCollapsed, isTvLayout], () => {
  if (!isTvLayout.value || sessionIndex.value !== RECENTS_SESSION_ID) return
  if (!recentsPaginationEnabled.value) {
    teardownRecentsLoadObserver()
    return
  }
  void nextTick(() => setupRecentsLoadObserver())
})

watch([sessionIndex, focusedIndex, activeIndex, playerUrl, favoriteCatalogFilter, destaquesCatalogFilter], () => {
  syncShareUrlFromState()
}, { flush: 'post' })

watch(sessionIndex, (si, prevSi) => {
  lastViewedRecordedKey = null
  if (catalogPrefsEnabled.value) {
    restoreCatalogSessionPrefsFor(si)
    if (si === RECENTS_SESSION_ID && catalogOriginFilter.value) {
      syncRecentsOriginApiFilter()
    }
  } else if (si === RECENTS_SESSION_ID) {
    applyDestaquesCatalogSortDefaults()
  } else {
    catalogOriginFilter.value = null
    if (si >= 0 && prevSi !== undefined && prevSi !== si) applyFolderCatalogSortDefaults()
  }
  if (prevSi !== undefined) {
    if (si === RECENTS_SESSION_ID) {
      if (prevSi !== RECENTS_SESSION_ID) {
        recentsCatalog.setPaginationEnabled(true)
      }
    } else {
      teardownRecentsLoadObserver()
      recentsCatalog.reset()
    }
  }
}, { immediate: true })

watch(
  manualTvAssist,
  (on) => {
    if (!import.meta.client) return
    document.documentElement.classList.toggle('video-player-tv-catalog-assist', on)
  },
  { immediate: true },
)

const CATALOG_TAB_UNLOCK_KEY = 'vp_catalog_tab_ok'

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
    /* ignore */
  }
}

onMounted(async () => {
  catalogGateChecking.value = true
  const tvQueryOn = (() => {
    const v = route.query.tv
    if (v === undefined || v === null) return false
    const raw = Array.isArray(v) ? v[0] : v
    const n = String(raw).toLowerCase()
    return n === '1' || n === 'true' || n === 'yes'
  })()
  const tvLaunch = tvQueryOn || manualTvAssist.value || isTvLayout.value

  try {
    if (tvLaunch) {
      await $fetch('/api/catalog-lock?tv=1', { credentials: 'include' })
      catalogGateRequired.value = false
      catalogUnlocked.value = true
    } else {
      const tabOk = readCatalogTabUnlocked()
      const lockUrl = tabOk ? '/api/catalog-lock' : '/api/catalog-lock?fresh=1'
      const lock = await $fetch<{ required: boolean; unlocked: boolean; tvBypass?: boolean }>(
        lockUrl,
        { credentials: 'include' },
      )
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
    }
  } catch {
    catalogGateRequired.value = false
    catalogUnlocked.value = true
  } finally {
    catalogGateChecking.value = false
  }

  if (!tvLaunch && catalogGateRequired.value && !catalogUnlocked.value) {
    await nextTick()
    catalogGateInputRef.value?.focus()
    return
  }

  await bootstrapPlayerChrome()
})

async function bootstrapCatalogAfterUnlock() {
  capturePendingCatalogOpenFromRoute()
  await loadSessions()
  if (sessions.value.length) {
    await loadTrailers()
    await applyShareQueryFromRoute()
    await nextTick()
    if (isTvLayout.value) ensureTvMinimalPlayback(focusedIndex.value ?? 0)
    syncShareUrlFromState()
  }
}

async function bootstrapPlayerChrome() {
  await bootstrapCatalogAfterUnlock()
  void restoreShrinkQueueFromServer()
  void restoreTrailerQueueFromServer()
  if (typeof window === 'undefined') return
  try {
    catalogGridCollapsed.value = sessionStorage.getItem(CATALOG_GRID_COLLAPSED_KEY) === '1'
  } catch {
    /* ignore */
  }
  trailerControlsCollapsed.value =
    readSessionFlag(UI_CHROME_CONTROLS_COLLAPSED_KEY) || readSessionFlag(UI_CHROME_NAME_HIDDEN_KEY)
  trailerTagsHidden.value = readSessionFlag(UI_CHROME_TAGS_HIDDEN_KEY)
  catalogChromeHidden.value = readSessionFlag(UI_CHROME_CATALOG_HIDDEN_KEY)
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
  document.addEventListener('webkitfullscreenchange', onDocumentFullscreenChange as EventListener)
  void nextTick(() => {
    syncTrailerStageFullscreenFlag()
  })
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      libraryRefreshChannel = new BroadcastChannel('video-player-library')
      libraryRefreshChannel.addEventListener('message', onLibraryRefreshMessage)
    } catch {
      libraryRefreshChannel = null
    }
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
    await bootstrapPlayerChrome()
  } catch (e: unknown) {
    const ex = e as { data?: { message?: string; statusMessage?: string }; message?: string }
    catalogGateError.value = (ex?.data?.message || ex?.data?.statusMessage) || ex?.message || 'Senha incorrecta.'
    catalogUnlocked.value = false
    writeCatalogTabUnlocked(false)
  } finally {
    catalogGateBusy.value = false
  }
}

onUnmounted(() => {
  stopShrinkQueueMonitor()
  stopTrailerQueueMonitor()
  teardownRecentsLoadObserver()
  releaseVideoElement(tvMinimalVideoRef.value)
  stopFastPlay(false)
  void flushMainProgressIfAny()
  if (gridChromeLongTimer) {
    clearTimeout(gridChromeLongTimer)
    gridChromeLongTimer = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onGlobalDocumentKeydown)
    document.removeEventListener('fullscreenchange', onDocumentFullscreenChange)
    document.removeEventListener('webkitfullscreenchange', onDocumentFullscreenChange as EventListener)
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

/* Modo cinema: palco + barra inferior (sem topo, nome, tags; catálogo escondido só fora do layout TV). */
.layout--theater .media-card-top {
  display: none !important;
}

.layout--theater:not(.layout--tv-silk) .catalog-pane-splitter,
.layout--theater:not(.layout--tv-silk) .sidebar {
  display: none !important;
}

.layout--theater .media-card-playback-name-row,
.layout--theater .toolbar-tags-panel,
.layout--theater .toolbar-full-tags {
  display: none !important;
}

@media (min-width: 960px) {
  .layout--theater:not(.layout--tv-silk) .main-stack {
    grid-template-columns: minmax(0, 1fr) !important;
    column-gap: 0 !important;
  }

  .layout--theater:not(.layout--tv-silk) .media-card {
    grid-column: 1 / -1 !important;
  }
}

.layout--theater .media-card {
  flex: 1 1 auto;
  min-height: 0;
}

.layout--theater .video-shell {
  flex: 1 1 auto;
  min-height: 0;
}

.layout--theater .video-shell:not(.video-shell--with-pins) {
  max-height: min(calc(100dvh - 7rem), 88dvh, 1080px);
}

.layout--theater .video-shell--with-pins {
  max-height: min(calc(100dvh - 6.5rem), 90dvh, 1100px);
}

.layout--theater .video-shell-main {
  max-height: min(calc(100dvh - 8rem), 82dvh, 960px);
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
    overflow-x: hidden;
    overflow-y: auto;
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
  .sidebar--catalog-collapsed .watched-filter-toggle--fav,
  .sidebar--catalog-collapsed .watched-filter-toggle--destaques {
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
  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) {
    height: 100dvh;
    max-height: 100dvh;
    overflow: hidden;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .main-stack {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .media-card {
    display: contents;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .media-card-pin {
    position: sticky;
    top: 0;
    z-index: 45;
    order: 1;
    max-height: min(78dvh, 100%);
    overflow: hidden;
    background: #0d0e10;
    border: 1px solid #2d333b;
    border-radius: 12px;
    padding: clamp(0.45rem, 1.2vw, 0.7rem) clamp(0.45rem, 1.4vw, 0.85rem) 0.55rem;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.45);
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .media-card-chrome {
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .media-card-chrome:empty {
    display: none;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .toolbar--full,
  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .toolbar--full-main,
  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .toolbar-full-main-row,
  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .toolbar-chrome-persist,
  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .toolbar-chrome-persist .rate-block {
    background: transparent !important;
    box-shadow: none !important;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .toolbar--full {
    border: none;
    border-radius: 0;
    padding: 0;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .toolbar-full-main-row {
    overflow: visible;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .toolbar-full-icons-main {
    overflow-x: auto;
    min-width: 0;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .catalog-pane-splitter {
    display: none;
  }

  .layout:not(.layout--tv-silk):not(.layout--tv-minimal) .sidebar {
    order: 2;
    position: relative;
    z-index: 1;
    min-height: clamp(220px, 38vh, 520px);
    max-height: none;
  }

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

.catalog-head-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  width: 100%;
  min-width: 0;
}

.catalog-head-title-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.catalog-head--chrome-hidden {
  padding-bottom: 0.35rem;
}

.catalog-chrome-toggle {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

.catalog-chrome-toggle:hover {
  background: #2d333b;
  border-color: #5f6368;
}

.catalog-chrome-toggle--on {
  border-color: #5f9dee;
  background: #2a3f5f;
}

.catalog-chrome-toggle-svg {
  width: 18px;
  height: 18px;
}

.sidebar--catalog-collapsed .catalog-head-title-row {
  flex-direction: column;
  align-items: center;
}

.sidebar--catalog-collapsed .catalog-head-title-actions {
  flex-direction: column;
}

.catalog-search-row {
  width: 100%;
  display: flex;
  gap: 0.4rem;
}

.catalog-search-row--folder .catalog-search-mode,
.catalog-search-row--folder .catalog-search-input {
  border-color: #3c4a3f;
  background: #132018;
  color: #e8f5ec;
}

.catalog-search-row--folder .catalog-search-btn {
  border-color: #4a7a58;
  background: #1e3d28;
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

.catalog-search-match {
  min-width: 7.4rem;
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

.catalog-tag-browse {
  width: 100%;
  display: flex;
  align-items: center;
  margin-top: 0.15rem;
}

.catalog-tag-browse-btn {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  border: 1px solid #2d3a4a;
  background: #151a22;
  color: #c5ddf5;
  border-radius: 8px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.4rem 0.7rem;
  cursor: pointer;
}

.catalog-tag-browse-btn:hover {
  border-color: #5f9dee;
  background: #1a2433;
}

.catalog-tag-browse-label {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #7aa9e8;
  font-size: 0.72rem;
}

.catalog-tag-browse-meta {
  color: #9aa0a6;
  font-weight: 500;
  font-size: 0.78rem;
}

.tag-browse-dialog {
  position: fixed;
  inset: 0;
  z-index: 244;
  display: flex;
  flex-direction: column;
  padding: 0;
  pointer-events: none;
}

.tag-browse-dialog-card {
  pointer-events: auto;
  width: 100%;
  height: 100%;
  height: 100dvh;
  max-width: none;
  max-height: none;
  min-height: 100%;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #1a1d22;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
  padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0)
    env(safe-area-inset-left, 0);
}

.tag-browse-dialog-card .session-menu-head {
  flex-shrink: 0;
  padding: 0.65rem clamp(0.75rem, 2vw, 1.25rem);
}

.tag-browse-dialog-card .session-menu-title {
  font-size: 1.05rem;
}

.tag-browse-hint {
  margin: 0;
  padding: 0 clamp(0.75rem, 2vw, 1.25rem) 0.35rem;
  font-size: 0.82rem;
  line-height: 1.35;
  color: #9aa0a6;
  flex-shrink: 0;
}

.tag-browse-hint--desk {
  display: block;
}

.tag-browse-hint--mobile {
  display: none;
}

.tag-browse-err {
  margin: 0 0.85rem 0.45rem;
  font-size: 0.95rem;
  color: #f8b4b0;
  flex-shrink: 0;
}

.tag-browse-tabs {
  display: flex;
  margin: 0 clamp(0.65rem, 2vw, 1.1rem) 0.35rem;
  padding: 0.2rem;
  gap: 0.25rem;
  border-radius: 12px;
  background: #12161c;
  border: 1px solid #2d333b;
  flex-shrink: 0;
  max-width: 28rem;
}

.tag-browse-tab {
  flex: 1;
  min-height: 2.65rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #9aa0a6;
  font: inherit;
  font-size: 1.05rem;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tag-browse-tab--active {
  background: #234c7c;
  color: #e8f3ff;
}

.tag-browse-tab-meta {
  font-size: 0.88rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.tag-browse-active-list {
  display: flex;
  margin: 0 0.75rem 0.45rem;
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
  background: #1e2a3d;
  border: 1px solid #2d3a4a;
  color: #c5ddf5;
  font-size: 0.95rem;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.tag-browse-active-list-go {
  margin-left: auto;
  border: 1px solid #5f9dee;
  background: #151a22;
  color: #c5ddf5;
  border-radius: 999px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.4rem 0.8rem;
  min-height: 2.35rem;
  cursor: pointer;
}

.tag-browse-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  min-width: 0;
  min-height: 0;
  flex: 1;
  border-top: 1px solid #2d333b;
  overflow: hidden;
}

.tag-browse-layout--panel-tags .tag-browse-col--lists,
.tag-browse-layout--panel-lists .tag-browse-col--tags {
  display: none;
}

.tag-browse-col {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.65rem clamp(0.75rem, 2vw, 1.25rem) 0.85rem;
  overflow: hidden;
}

.tag-browse-col--tags {
  border-right: 0;
}

.tag-browse-col--lists {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.tag-browse-col-title {
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7aa9e8;
}

.tag-browse-toolbar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.45rem;
  flex-shrink: 0;
}

.tag-browse-filter {
  flex: 1;
  min-width: 0;
  border: 1px solid #2d333b;
  background: #12161c;
  color: #e8eaed;
  border-radius: 8px;
  font: inherit;
  font-size: 1rem;
  padding: 0.45rem 0.6rem;
}

.tag-browse-count {
  flex: 0 0 auto;
  font-size: 0.85rem;
  color: #9aa0a6;
}

.tag-browse-empty {
  font-size: 0.95rem;
  color: #9aa0a6;
  padding: 0.35rem 0;
}

.tag-browse-empty--pick-list {
  margin: auto 0;
  padding: 1.5rem 0.5rem;
  text-align: center;
  max-width: 28rem;
}

.tag-browse-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 148px), 1fr));
  gap: clamp(0.4rem, 1.2vw, 0.75rem);
  align-content: start;
}

.tag-browse-row {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 0;
  min-height: 2.85rem;
  border: 1px solid #2d333b;
  border-radius: 10px;
  background: #15171c;
  overflow: hidden;
}

.tag-browse-row:hover {
  border-color: #3d4550;
  background: #1a1e24;
}

.tag-browse-tag {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  border: 0;
  background: transparent;
  color: #e8eaed;
  font: inherit;
  font-size: 0.95rem;
  padding: 0.45rem 0.55rem;
  cursor: pointer;
  text-align: left;
}

.tag-browse-row:has(.tag-browse-toggle) .tag-browse-tag {
  padding-right: 2.15rem;
}

.tag-browse-tag:hover {
  background: #1a222e;
}

.tag-browse-tag-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-browse-tag-count {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: #fdd663;
  font-size: 0.82rem;
  font-weight: 700;
  background: #2a2410;
  border: 1px solid #5c4a1a;
  border-radius: 999px;
  padding: 0.12rem 0.45rem;
  line-height: 1.2;
}

.tag-browse-toggle {
  position: absolute;
  top: 0.35rem;
  right: 0.35rem;
  width: 1.85rem;
  height: 1.85rem;
  flex: 0 0 auto;
  border: 1px solid #2d333b;
  background: #151a22;
  color: #9aa0a6;
  border-radius: 7px;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.tag-browse-toggle--on {
  border-color: #5f9dee;
  background: #1e2a3d;
  color: #8ab4f8;
}

.tag-browse-create {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.55rem;
  flex-shrink: 0;
}

.tag-browse-create-btn {
  flex: 0 0 auto;
  border: 1px solid #2d3a4a;
  background: #234c7c;
  color: #e8f3ff;
  border-radius: 8px;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  padding: 0.45rem 0.75rem;
  cursor: pointer;
}

.tag-browse-create-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.tag-browse-lists-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  flex-shrink: 0;
}

.tag-browse-lists-pane--compact {
  flex: 0 0 auto;
  min-height: 5.5rem;
  max-height: min(32vh, 18rem);
  overflow: auto;
}

.tag-browse-selected-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow: hidden;
}

.tag-browse-selected-pane--empty {
  flex: 0 0 auto;
}

.tag-browse-lists {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 168px), 1fr));
  gap: 0.5rem;
  overflow: auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  flex: 1;
  align-content: start;
}

.tag-browse-list-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  border-radius: 10px;
  border: 1px solid #2d333b;
  background: #15171c;
  min-height: 3.35rem;
  overflow: hidden;
  transition:
    background 0.12s,
    border-color 0.12s;
}

.tag-browse-list-item--active {
  background: #1e2a3d;
  border-color: #5f9dee;
}

.tag-browse-list-pick {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  color: #e8eaed;
  font: inherit;
  font-size: 0.98rem;
  font-weight: 600;
  padding: 0.65rem 2.5rem 0.65rem 0.7rem;
  min-height: 3.25rem;
  cursor: pointer;
  text-align: left;
  border-radius: 0;
  -webkit-tap-highlight-color: transparent;
}

.tag-browse-list-pick:hover {
  background: #1a222e;
}

.tag-browse-list-item--active .tag-browse-list-pick:hover {
  background: #243247;
}

.tag-browse-list-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.tag-browse-list-qty {
  flex: 0 0 auto;
  font-size: 0.82rem;
  font-weight: 700;
  color: #fdd663;
  font-variant-numeric: tabular-nums;
  background: #2a2410;
  border: 1px solid #5c4a1a;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  line-height: 1.2;
}

.tag-browse-list-item--menu {
  z-index: 4;
  overflow: visible;
  content-visibility: visible;
}

.tag-browse-item-card--menu {
  z-index: 4;
  overflow: hidden;
  content-visibility: visible;
}

.tag-browse-overflow-wrap {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  z-index: 3;
}

.tag-browse-item-card-head .tag-browse-overflow-wrap {
  position: relative;
  top: auto;
  right: auto;
  margin-left: 0;
  flex: 0 0 auto;
}

.tag-browse-hamburger {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  width: 2.15rem;
  height: 2.15rem;
  padding: 0;
  border: 1px solid #2d333b;
  border-radius: 8px;
  background: #151a22;
  cursor: pointer;
}

.tag-browse-hamburger span {
  display: block;
  width: 0.95rem;
  height: 2px;
  border-radius: 1px;
  background: #c5cdd8;
}

.tag-browse-hamburger:hover:not(:disabled) {
  border-color: #5f9dee;
  background: #1e2a3d;
}

.tag-browse-hamburger:disabled {
  opacity: 0.45;
  cursor: default;
}

.tag-browse-overflow {
  position: absolute;
  top: calc(100% + 0.28rem);
  right: 0;
  min-width: 11.5rem;
  padding: 0.3rem;
  border: 1px solid #3d4550;
  border-radius: 10px;
  background: #1a1e24;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
}

.tag-browse-overflow--portal {
  position: fixed;
  z-index: 260;
  top: 0;
  right: 8px;
  pointer-events: auto;
}

.tag-browse-overflow-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #e8eaed;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  padding: 0.55rem 0.6rem;
  cursor: pointer;
  text-align: left;
}

.tag-browse-overflow-item svg {
  width: 1.05rem;
  height: 1.05rem;
  flex: 0 0 auto;
}

.tag-browse-overflow-item:hover:not(:disabled) {
  background: #243247;
}

.tag-browse-overflow-item--danger {
  color: #f8b4b0;
}

.tag-browse-overflow-item--danger:hover:not(:disabled) {
  background: #2a1a1a;
}

.tag-browse-overflow-item:disabled {
  opacity: 0.45;
  cursor: default;
}

.tag-browse-overflow-confirm {
  padding: 0.25rem 0.2rem 0.15rem;
}

.tag-browse-overflow-confirm p {
  margin: 0 0.35rem 0.45rem;
  font-size: 0.88rem;
  line-height: 1.35;
  color: #e8eaed;
}

.tag-browse-overflow-confirm-actions {
  display: flex;
  gap: 0.3rem;
}

.tag-browse-overflow-confirm-actions .tag-browse-overflow-item {
  justify-content: center;
}

.tag-browse-selected {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
  min-height: 0;
  overflow: hidden;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.tag-browse-selected-head {
  margin: 0 0 0.4rem;
  font-size: 0.95rem;
  color: #c5ddf5;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.tag-browse-item-cards {
  list-style: none;
  margin: 0.45rem 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 148px), 1fr));
  grid-auto-rows: max-content;
  gap: clamp(0.5rem, 1.4vw, 0.85rem);
  align-content: start;
  align-items: stretch;
  overflow: auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  flex: 1;
}

.tag-browse-item-card {
  position: relative;
  z-index: 0;
  border: 1px solid #2d333b;
  border-radius: 10px;
  background: #15171c;
  padding: 0.4rem;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  isolation: isolate;
  contain: layout paint;
}

.tag-browse-item-card:hover {
  border-color: #3d4550;
  background: #1a1e24;
}

.tag-browse-item-card-head {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.4rem;
  min-width: 0;
  flex-shrink: 0;
}

.tag-browse-item-name {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  color: #e8eaed;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.3;
  text-align: left;
  padding: 0.15rem 0.1rem;
  min-height: 1.7rem;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-browse-item-name:hover {
  color: #c5ddf5;
}

.tag-browse-item-card-head .tag-browse-chip {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: 1px solid #2d3a4a;
  border-radius: 999px;
  background: #151a22;
  padding: 0.28rem 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
}

.tag-browse-item-card-head .tag-browse-chip:hover {
  border-color: #5f9dee;
  background: #1e2a3d;
}

.tag-browse-item-total {
  flex: 0 0 auto;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  color: #fdd663;
  font-weight: 600;
}

.tag-browse-item-edit {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex: 1;
  min-width: 0;
}

.tag-browse-item-edit-input {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.tag-browse-item-icon-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  padding: 0;
  border: 1px solid #2d333b;
  border-radius: 6px;
  background: #151a22;
  color: #9aa0a6;
  cursor: pointer;
}

.tag-browse-item-icon-btn svg {
  width: 0.95rem;
  height: 0.95rem;
}

.tag-browse-item-icon-btn:hover:not(:disabled) {
  color: #e8eaed;
  border-color: #5f9dee;
  background: #1e2a3d;
}

.tag-browse-item-icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.tag-browse-item-icon-btn--ok:hover:not(:disabled) {
  color: #b7f0c4;
  border-color: #3d8f55;
  background: #15241a;
}

.tag-browse-item-icon-btn--danger:hover:not(:disabled) {
  color: #f8b4b0;
  border-color: #8b3a3a;
  background: #2a1a1a;
}

.tag-browse-mosaic-wrap {
  position: relative;
  z-index: 0;
  width: 100%;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 8px;
  background: #050608;
  contain: layout paint;
}

.tag-browse-empty--inline {
  margin: 0 0 0.35rem;
  padding: 0.2rem 0;
  font-size: 0.82rem;
}

.tag-browse-empty--tiny {
  margin: 0;
  padding: 0.15rem 0 0;
  font-size: 0.88rem;
}

.tag-browse-empty--mosaic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 0;
  padding: 0.4rem;
  border-radius: 8px;
  background: #12161c;
  border: 1px dashed #2d333b;
  text-align: center;
}

.tag-browse-chip {
  border: 0;
  background: transparent;
  color: #e8eaed;
  font: inherit;
  font-size: 0.95rem;
  padding: 0.28rem 0.5rem 0.28rem 0.6rem;
  cursor: pointer;
}

.tag-browse-chip-x {
  border: 0;
  border-left: 1px solid #2d3a4a;
  background: transparent;
  color: #9aa0a6;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.18rem 0.4rem;
  cursor: pointer;
}

.tag-browse-chip-x:hover {
  color: #f8b4b0;
  background: #2a1a1a;
}

@media (min-width: 480px) {
  .tag-browse-list {
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  }

  .tag-browse-item-cards {
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  }

  .tag-browse-lists {
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  }
}

@media (min-width: 768px) {
  .tag-browse-list {
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 0.75rem;
  }

  .tag-browse-item-cards {
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 0.75rem;
  }

  .tag-browse-lists {
    grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  }
}

@media (min-width: 960px) {
  .tag-browse-list {
    grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
    gap: 0.8rem;
  }

  .tag-browse-item-cards {
    grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
    gap: 0.8rem;
  }

  .tag-browse-lists {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
}

@media (min-width: 1400px) {
  .tag-browse-list {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  }

  .tag-browse-item-cards {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 0.9rem;
  }
}

@media (min-width: 1800px) {
  .tag-browse-list {
    grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
  }

  .tag-browse-item-cards {
    grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
    gap: 1rem;
  }
}

@media (max-width: 820px) {
  .tag-browse-hint--desk {
    display: none;
  }

  .tag-browse-hint--mobile {
    display: block;
    padding: 0 0.85rem 0.4rem;
    font-size: 0.78rem;
  }

  .tag-browse-tabs .tag-browse-tab {
    min-height: 2.85rem;
    font-size: 1.08rem;
  }

  .tag-browse-col {
    padding: 0.45rem 0.75rem 1rem;
  }

  .tag-browse-filter {
    font-size: 1rem;
    padding: 0.65rem 0.75rem;
    border-radius: 10px;
    min-height: 2.75rem;
  }

  .tag-browse-tag {
    font-size: 1.08rem;
    padding: 0.75rem 0.8rem 0.7rem;
  }

  .tag-browse-hamburger {
    width: 2.5rem;
    height: 2.5rem;
  }

  .tag-browse-toggle {
    width: 2.15rem;
    height: 2.15rem;
    font-size: 1.1rem;
    border-radius: 10px;
  }

  .tag-browse-row:has(.tag-browse-toggle) .tag-browse-tag {
    padding-right: 2.45rem;
  }

  .tag-browse-create {
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .tag-browse-create-btn {
    min-height: 2.75rem;
    padding: 0.55rem 1rem;
    font-size: 0.92rem;
    border-radius: 10px;
  }

  .tag-browse-lists-pane {
    flex: 0 0 auto;
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #2d333b;
    max-height: none;
  }

  .tag-browse-lists-pane--compact {
    flex: 0 0 auto;
    min-height: 5.5rem;
    max-height: min(38vh, 20rem);
    overflow: auto;
  }

  .tag-browse-lists {
    max-height: none;
  }

  .tag-browse-selected-pane {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .tag-browse-empty--pick-list {
    display: none;
  }

  .tag-browse-item-name {
    min-height: 2.2rem;
    font-size: 0.92rem;
    padding: 0.2rem 0.15rem;
  }

  .tag-browse-item-icon-btn {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 10px;
  }

  .tag-browse-item-icon-btn svg {
    width: 1.15rem;
    height: 1.15rem;
  }
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

.catalog-top-tags--origin .catalog-top-tags-title {
  color: #c9a86a;
}

.catalog-top-tag--origin {
  border-color: #6b5a38;
  background: #2a2418;
  color: #e8d4a8;
}

.catalog-top-tag--origin.catalog-top-tag--active {
  border-color: #c9a86a;
  background: #3d3420;
  color: #fff6e0;
}

.catalog-top-tag-count {
  margin-left: 0.28rem;
  font-size: 0.68rem;
  opacity: 0.75;
}

.tag-filter-clear--origin {
  border-color: #6b5a38;
  background: #2a2418;
  color: #e8d4a8;
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

.watched-filter-toggle--exclude {
  background: #2a1a1a;
  border-color: #8a4a4a;
  color: #f0b8b0;
}

.watched-filter-toggle--exclude:hover:not(:disabled) {
  background: #3a2222;
  color: #ffd4cc;
}

.watched-filter-toggle--fav.watched-filter-toggle--exclude {
  background: #2a1f28;
  border-color: #7a5a6a;
  color: #e8c8d4;
}

.watched-filter-toggle--destaques.watched-filter-toggle--on {
  background: #1a2838;
  border-color: #5a8ec8;
  color: #b8d8ff;
}

.watched-filter-toggle--destaques.watched-filter-toggle--on:hover:not(:disabled) {
  background: #223548;
  color: #d4e8ff;
}

.watched-filter-toggle--destaques.watched-filter-toggle--exclude {
  background: #2a1a1a;
  border-color: #8a4a4a;
  color: #f0b8b0;
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

.tv-grid-spacer {
  grid-column: 1 / -1;
  width: 100%;
  pointer-events: none;
}

.grid-tile-thumb--tv-placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  min-height: 4.5rem;
  background: linear-gradient(135deg, #12141a 0%, #1a1d24 50%, #12141a 100%);
}

.recents-load-sentinel {
  grid-column: 1 / -1;
  width: 100%;
  height: 2px;
  pointer-events: none;
}

.recents-load-hint {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.35rem 0.5rem;
  font-size: 0.78rem;
  color: #8ab4f8;
  text-align: center;
}

.recents-load-hint--status {
  color: #b8d4a0;
  font-size: 0.72rem;
  line-height: 1.35;
  word-break: break-word;
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

.grid-folder-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.45rem;
  padding: 0.1rem 0.05rem 0.05rem;
}

.grid-folder-header:first-child {
  margin-top: 0;
}

.grid-folder-header-label {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #9aa3b2;
}

.grid-folder-header-line {
  flex: 1;
  min-width: 2rem;
  height: 1px;
  background: linear-gradient(90deg, rgba(138, 180, 248, 0.42), rgba(138, 180, 248, 0.08) 72%, transparent);
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

.grid-tile-destaques-eye {
  position: absolute;
  top: 2.5rem;
  right: 0.3rem;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.6rem;
  padding: 0.2rem;
  border-radius: 8px;
  border: 1px solid rgba(120, 170, 240, 0.45);
  background: rgba(22, 32, 48, 0.92);
  color: #8eb8ff;
  pointer-events: none;
}

.grid-tile-destaques-eye-svg {
  width: 1.05rem;
  height: 1.05rem;
  display: block;
}

.grid-tile--in-destaques {
  border-color: color-mix(in srgb, #6b9ae8 32%, #2d333b);
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

.grid-tile-tags-origin {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.12rem;
  margin-top: 0.2rem;
  max-width: 100%;
}

.grid-tile-tags-origin-label {
  font-size: 0.52rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #9aa0a6;
  line-height: 1;
}

.grid-tile-tags--origin-chips {
  margin-top: 0;
}

.grid-tile-tag--origin {
  background: #1e2a22;
  color: #9fd4a8;
  border-color: #3d5c44;
}

.tag-chip-list--origin {
  margin-top: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px solid #2d333b;
}

.tag-chip-list-label {
  flex: 0 0 100%;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #9aa0a6;
  margin-bottom: 0.1rem;
}

.tag-chip--origin {
  cursor: default;
  background: #1e2a22;
  color: #b8e0bf;
  border-color: #3d5c44;
}

.tag-chip--origin:hover {
  background: #243328;
  border-color: #4a7354;
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

.media-card-pin {
  display: flex;
  flex-direction: column;
  gap: clamp(0.5rem, 1.2vw, 0.75rem);
  flex-shrink: 0;
  min-width: 0;
}

.media-card-chrome {
  display: flex;
  flex-direction: column;
  gap: clamp(0.5rem, 1.2vw, 0.75rem);
  min-width: 0;
  min-height: 0;
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

.trailer-reprocess-dialog {
  position: fixed;
  inset: 0;
  z-index: 244;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  pointer-events: none;
}

.trailer-reprocess-dialog-card {
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

.trailer-reprocess-dialog-body {
  flex: 1;
  overflow: auto;
  padding: 0 0.75rem 0.75rem;
}

.trailer-reprocess-dialog-hint {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  line-height: 1.45;
  color: #9aa0a6;
}

.trailer-reprocess-dialog-file {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  color: #e8eaed;
  word-break: break-all;
}

.shrink-already-warn {
  margin: 0 0 0.85rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  border: 2px solid #e0aa20;
  background: linear-gradient(180deg, #4a3210 0%, #2e1f0a 100%);
  color: #ffe7a3;
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.45;
  box-shadow: 0 0 0 1px rgba(255, 200, 80, 0.25), 0 6px 18px rgba(0, 0, 0, 0.35);
}

.shrink-already-warn-title {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #ffcc66;
}

.trailer-reprocess-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem 0.65rem;
  margin-bottom: 0.65rem;
}

.trailer-reprocess-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.trailer-reprocess-field--full {
  margin-bottom: 0.65rem;
}

.trailer-reprocess-label {
  font-size: 0.75rem;
  color: #9aa0a6;
}

.trailer-reprocess-speed-hint {
  grid-column: 1 / -1;
  margin: 0 0 0.35rem;
  font-size: 0.75rem;
  line-height: 1.4;
  color: #7a8088;
}

.trailer-reprocess-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem;
  padding: 0.65rem 0.75rem 0.75rem;
  border-top: 1px solid #2d333b;
}

.trailer-reprocess-dialog-card .admin-code {
  font-size: 0.8em;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  background: #0c0d10;
  color: #c4c7cc;
}

.trailer-reprocess-dialog-card .admin-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  border: 1px solid #454a53;
  background: #0c0d10;
  color: #e8eaed;
  font: inherit;
  font-size: 0.88rem;
}

.trailer-reprocess-dialog-card .admin-btn {
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

.trailer-reprocess-dialog-card .admin-btn:hover:not(:disabled) {
  background: #2d333b;
}

.trailer-reprocess-dialog-card .admin-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.trailer-reprocess-dialog-card .admin-btn--ghost {
  background: transparent;
}

.trailer-reprocess-dialog-card .admin-btn--primary {
  background: #1a73e8;
  border-color: #1a73e8;
  color: #fff;
}

.trailer-reprocess-check {
  flex-direction: row;
  align-items: flex-start;
  gap: 0.45rem;
  margin-top: 0.15rem;
}

.trailer-reprocess-check input {
  margin-top: 0.15rem;
  flex: 0 0 auto;
}

.trailer-reprocess-check span {
  font-size: 0.82rem;
  line-height: 1.35;
  color: #c4c9d0;
}

.shrink-queue {
  margin-top: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px solid #2d333b;
}

.shrink-queue-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 0.65rem;
  margin-bottom: 0.4rem;
}

.shrink-queue-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #c5ddf5;
  letter-spacing: 0.02em;
}

.shrink-queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 11rem;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.shrink-queue-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.45rem;
  padding: 0.32rem 0.45rem;
  border-radius: 8px;
  border: 1px solid #2d333b;
  background: #0c0d10;
  font-size: 0.78rem;
}

.shrink-queue-item--running {
  border-color: #3a5f8a;
  background: #121a24;
}

.shrink-queue-item--done {
  border-color: #2f5a3d;
  color: #a8d7b5;
}

.shrink-queue-item--failed {
  border-color: #8b3a36;
  color: #f8b4b0;
}

.shrink-queue-idx {
  flex: 0 0 auto;
  color: #9aa0a6;
  font-variant-numeric: tabular-nums;
}

.shrink-queue-label {
  flex: 1 1 8rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e8eaed;
}

.shrink-queue-status {
  flex: 0 0 auto;
  font-size: 0.72rem;
  font-weight: 600;
  color: #9aa0a6;
  text-transform: lowercase;
}

.shrink-queue-item--running .shrink-queue-status {
  color: #8ab4f8;
}

.shrink-queue-item--done .shrink-queue-status {
  color: #a8d7b5;
}

.shrink-queue-item--failed .shrink-queue-status {
  color: #f8b4b0;
}

.trailer-reprocess-dialog-card .admin-btn--sm {
  padding: 0.22rem 0.45rem;
  font-size: 0.72rem;
}

.icon-tool--shrink.icon-tool--busy,
.icon-tool--trailer-redo.icon-tool--busy {
  border-color: #8ab4f8;
  color: #c5ddf5;
}

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

@media (max-width: 480px) {
  .trailer-reprocess-grid {
    grid-template-columns: 1fr;
  }
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

.stage-fullscreen-wrap > .stage-video {
  position: relative;
  z-index: 1;
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
  z-index: 20;
  padding: 0.65rem 0.85rem 0.85rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.45rem;
  pointer-events: none;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.72), transparent);
}

/* Fullscreen nativo só no <video> (ex.: mobile): overlay em Teleport — position fixed por cima do vídeo. */
.stage-fullscreen-trailer-actions--body-fs {
  position: fixed;
  z-index: 2147483000;
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

.stage-fullscreen-trailer-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.stage-fullscreen-trailer-btn:hover:not(:disabled) {
  background: rgba(30, 33, 40, 0.95);
  border-color: rgba(95, 157, 238, 0.55);
}

.stage-fullscreen-trailer-btn--primary {
  border-color: rgba(95, 157, 238, 0.55);
  background: rgba(32, 44, 68, 0.92);
}

.stage-fullscreen-trailer-btn--primary:hover:not(:disabled) {
  background: rgba(42, 58, 88, 0.96);
  border-color: rgba(120, 175, 255, 0.65);
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

/* FAST a tocar: esconder UI nativa (evita flash em seek); em pausa deixa a barra para progresso. */
.stage-video--fast-play:not(:paused)::-webkit-media-controls,
.stage-video--fast-play:not(:paused)::-webkit-media-controls-enclosure,
.stage-video--fast-play:not(:paused)::-webkit-media-controls-panel {
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

.toolbar-trailer-icons,
.toolbar-full-main-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 0.35rem;
  width: 100%;
  min-width: 0;
  overflow: visible;
  padding-bottom: 2px;
  background: transparent;
}

.toolbar-trailer-icons > .icon-tool--chrome-toggle,
.toolbar-full-main-row > .icon-tool--chrome-toggle {
  flex: 0 0 auto;
}

.toolbar-trailer-icons-main,
.toolbar-full-icons-main {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.35rem;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.toolbar-chrome-persist {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
  flex: 0 0 auto;
  align-self: center;
  width: fit-content;
  max-width: none;
  margin-left: 0.15rem;
  padding: 0;
  background: none;
  box-shadow: none;
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

.icon-tool--shuffle-on {
  border-color: #2e7d32;
  background: #18321b;
  color: #c8f3d0;
}

.icon-tool--shuffle-on:hover:not(:disabled) {
  border-color: #34a853;
  background: #1c3b20;
  color: #eaffef;
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
  flex-shrink: 0;
  max-height: min(34vh, 15rem);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.toolbar-tags-panel-actions {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.tag-panel-action-btn {
  padding: 0.3rem 0.55rem;
  border: 1px solid #3c4043;
  border-radius: 6px;
  background: #1a1d22;
  color: #e8eaed;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.tag-panel-action-btn:hover {
  background: #252a32;
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
  flex-shrink: 0;
}

.toolbar-full-main-row {
  gap: 0.5rem;
}

/* Silk/Fire TV: evita o bloco de velocidade "escapar" à direita em toolbars muito cheias. */
.layout--tv-silk .toolbar-full-main-row {
  flex-wrap: wrap;
  row-gap: 0.35rem;
  overflow: visible;
}

.layout--tv-silk .toolbar-chrome-persist {
  flex: 0 0 auto;
  margin-left: 0.15rem;
  padding: 0;
  border-top: none;
  background: none;
}

.layout--tv-silk .toolbar-full-main-row .rate-block--inline {
  flex: 0 0 auto;
  width: fit-content;
  max-width: none;
  justify-content: flex-end;
  gap: 0.35rem;
  background: none;
}

.layout--tv-silk .toolbar-chrome-persist .rate-select.rate-select--compact {
  flex: 0 0 auto;
  min-width: 2.6rem;
  width: 2.9rem;
  max-width: 3.2rem;
}

.toolbar-full-tags {
  width: 100%;
  min-width: 0;
  padding-top: 0.35rem;
  border-top: 1px solid #2d333b;
  flex-shrink: 0;
  max-height: min(34vh, 15rem);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.rate-block--inline {
  flex: 0 0 auto;
  width: auto;
  min-width: 0;
  max-width: max-content;
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

.rate-select.rate-select--compact {
  min-height: 32px;
  min-width: 2.85rem;
  width: 3.1rem;
  max-width: 3.4rem;
  padding: 0.12rem 0.2rem;
  font-size: 0.74rem;
  font-weight: 600;
  border-radius: 8px;
}

.toolbar-chrome-persist .rate-select.rate-select--compact {
  min-height: 30px;
  min-width: 2.6rem;
  width: 2.9rem;
  max-width: 3.2rem;
  font-size: 0.72rem;
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
  gap: 0.5rem;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
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
  .toolbar-chrome-persist .rate-block--inline {
    flex: 0 0 auto;
    gap: 0.25rem;
  }

  .toolbar-chrome-persist .rate-select.rate-select--compact {
    flex: 0 0 auto;
    min-width: 2.5rem;
    width: 2.75rem;
    max-width: 3rem;
    min-height: 30px;
    padding: 0.1rem 0.18rem;
    font-size: 0.7rem;
  }

  .icon-tool {
    width: 40px;
    height: 40px;
    min-width: 40px;
  }

  .catalog-head {
    align-items: flex-start;
  }

  .catalog-head-tools {
    flex: 1 1 100%;
    justify-content: flex-start;
    width: 100%;
  }

  .watched-filter-toggle {
    font-size: 0.68rem;
    padding: 0.3rem 0.48rem;
  }
}

@media (min-width: 600px) {
  .rate-select--prominent {
    flex: 0 1 auto;
    max-width: 14rem;
  }
}

/* —— Modo TV minimal (?tv=1): só vídeo + anterior/próximo —— */
.layout--tv-minimal {
  height: 100dvh;
  max-height: 100dvh;
  overflow: hidden;
}

.layout--tv-minimal .error {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  margin: 0;
}

.tv-minimal {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: row;
  background: #000;
}

.tv-minimal-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.tv-minimal-rail {
  --tv-rail-w: 140px;
  flex: 0 0 var(--tv-rail-w);
  width: var(--tv-rail-w);
  min-width: var(--tv-rail-w);
  max-width: var(--tv-rail-w);
  border-left: 1px solid #2d333b;
  background: #121418;
  display: flex;
  flex-direction: column;
}

.tv-minimal-rail-scroll-btn {
  flex: 0 0 auto;
  width: 100%;
  height: 2.25rem;
  margin: 0;
  padding: 0;
  border: none;
  border-top: 1px solid #2d333b;
  border-bottom: 1px solid #2d333b;
  background: #1a1d24;
  color: #e8eaed;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tv-minimal-rail-scroll-btn:first-child {
  border-top: none;
}

.tv-minimal-rail-scroll-btn:last-child {
  border-bottom: none;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.tv-minimal-rail-scroll-btn:active {
  background: #2a5181;
  color: #eff6ff;
}

.tv-minimal-rail-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 6px 5px;
}

/* Caixa fixa 16:9 — não encolhe com flex nem antes da imagem carregar */
.tv-minimal-thumb {
  flex: 0 0 auto;
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: calc((var(--tv-rail-w) - 10px) * 9 / 16);
  min-height: calc((var(--tv-rail-w) - 10px) * 9 / 16);
  margin: 0;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
  background: #0a0a0c;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tv-minimal-thumb--active {
  border-color: #7fb2f3;
  box-shadow: 0 0 0 1px #7fb2f3;
}

.tv-minimal-thumb-img,
.tv-minimal-thumb-ph {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  pointer-events: none;
}

.tv-minimal-thumb-ph {
  background: linear-gradient(135deg, #12141a 0%, #1a1d24 50%, #12141a 100%);
}

.tv-minimal-rail-scroll .recents-load-sentinel {
  flex: 0 0 auto;
  width: 100%;
  height: 4px;
  min-height: 4px;
}

.tv-minimal-rail-hint {
  margin: 0;
  text-align: center;
  font-size: 0.85rem;
  color: #8ab4f8;
}

.tv-minimal-video {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  object-fit: contain;
  background: #000;
}

.tv-minimal-overlay {
  position: absolute;
  inset: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  color: #e8eaed;
  font-size: 1.1rem;
  text-align: center;
  background: #0a0a0c;
  z-index: 2;
  pointer-events: none;
}

.tv-minimal-bar-left {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  flex: 1 1 auto;
}

.tv-minimal-actions {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.tv-minimal-origin {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  flex: 1 1 auto;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 0.15rem;
}

.tv-minimal-origin-label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #c9a86a;
  margin-right: 0.15rem;
}

.tv-minimal-origin-btn {
  font: inherit;
  font-size: 0.72rem;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  border: 1px solid #6b5a38;
  background: #2a2418;
  color: #e8d4a8;
  cursor: pointer;
}

.tv-minimal-origin-btn--active {
  border-color: #c9a86a;
  background: #3d3420;
  color: #fff6e0;
}

.tv-minimal-origin-btn--clear {
  border-color: #5f9dee;
  background: #1d3553;
  color: #cde3ff;
}

.tv-minimal-origin-count {
  margin-left: 0.2rem;
  opacity: 0.75;
  font-size: 0.65rem;
}

.tv-minimal-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom, 0px));
  background: #121418;
  border-top: 1px solid #2d333b;
  z-index: 3;
}

.tv-minimal-meta {
  flex: 0 1 32%;
  min-width: 0;
  margin-left: auto;
  text-align: right;
}

.tv-minimal-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: #e8eaed;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tv-minimal-pos {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: #9aa0a6;
}

.tv-minimal-btn {
  flex: 0 0 auto;
  font: inherit;
  font-size: 1.1rem;
  font-weight: 700;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  border: 2px solid #5f9dee;
  background: #1d3553;
  color: #eff6ff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tv-minimal-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tv-minimal-btn:active:not(:disabled) {
  background: #2a5181;
}

.tv-minimal-btn--primary {
  border-color: #7fb2f3;
  background: #2a5181;
  color: #eff6ff;
  font-size: 0.75rem;
  padding: 0.35rem 0.45rem;
}

.tv-minimal-btn--secondary {
  border-color: #c9a86a;
  background: #3d3420;
  color: #fff6e0;
  font-size: 0.75rem;
  padding: 0.35rem 0.45rem;
}

.tv-minimal-btn--remove-destaques {
  border-color: #c97a7a;
  background: #3d2020;
  color: #ffe8e4;
  font-size: 0.72rem;
  padding: 0.35rem 0.42rem;
}

.tv-minimal-btn--remove-destaques:active:not(:disabled) {
  background: #5a2828;
}

.tv-minimal-rate {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.tv-minimal-rate-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: #9aa0a6;
  white-space: nowrap;
}

.tv-minimal-rate-select {
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  min-width: 2.75rem;
  max-width: 3.25rem;
  padding: 0.32rem 0.25rem;
  border-radius: 8px;
  border: 2px solid #454a53;
  background: #252a32;
  color: #e8eaed;
  cursor: pointer;
}

.tv-minimal-rate-select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tv-minimal-pos--full {
  color: #8ab4f8;
}
</style>
