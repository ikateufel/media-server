<template>
  <Teleport to="body">
    <div v-if="open" class="move-title-backdrop" @click="close" />
    <div
      v-if="open"
      class="trailer-reprocess-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trailer-reprocess-dialog-title"
    >
      <div class="trailer-reprocess-dialog-card">
        <div class="session-menu-head">
          <span id="trailer-reprocess-dialog-title" class="session-menu-title">Trailer — fila</span>
          <button type="button" class="session-menu-close" aria-label="Fechar" @click="close">×</button>
        </div>
        <div class="trailer-reprocess-dialog-body">
          <p class="trailer-reprocess-dialog-hint">
            Adiciona à fila; processam-se em sequência no servidor (sobrevive a refresh).
            Histórico permanente em
            <NuxtLink to="/historico" class="empty-hint-link">/historico</NuxtLink>
            — limpar a fila não apaga o histórico.
          </p>
          <p v-if="fileLabel" class="trailer-reprocess-dialog-file">Actual: {{ fileLabel }}</p>
          <p v-if="shrunkNotice" class="shrink-already-warn" role="status">
            <span class="shrink-already-warn-title">Já foi shrinkado</span>
            {{ shrunkNotice }}
          </p>

          <label class="trailer-reprocess-field trailer-reprocess-field--full">
            <span class="trailer-reprocess-label">Modo de coleta</span>
            <select v-model="form.collect" class="admin-input">
              <option v-for="(label, mode) in TRAILER_COLLECT_LABELS" :key="mode" :value="mode">
                {{ label }}
              </option>
            </select>
          </label>

          <div v-if="isLegado" class="trailer-reprocess-grid">
            <label class="trailer-reprocess-field">
              <span class="trailer-reprocess-label">Duração do corte (s)</span>
              <input
                v-model.number="form.legacySegSec"
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
                v-model.number="form.legacyStepSec"
                type="number"
                min="1"
                max="3600"
                step="1"
                class="admin-input"
              />
            </label>
          </div>

          <div v-if="isPadrao" class="trailer-reprocess-grid">
            <label class="trailer-reprocess-field">
              <span class="trailer-reprocess-label">Corte (s)</span>
              <input
                v-model.number="form.pctSeg"
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
                v-model.number="form.pctStep"
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
                v-model.number="form.longMinSec"
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
                v-model.number="form.longStepSec"
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
                v-model.number="form.tailSec"
                type="number"
                min="1"
                max="600"
                step="1"
                class="admin-input"
              />
            </label>
          </div>

          <label v-if="!isPadrao" class="trailer-reprocess-field trailer-reprocess-field--full">
            <span class="trailer-reprocess-label">Duração máx. saída legado (s)</span>
            <input
              v-model.number="form.maxOutSec"
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
              <select v-model.number="form.speed" class="admin-input">
                <option v-for="s in TRAILER_SPEED_OPTIONS" :key="s" :value="s">
                  {{ s === 1 ? '1× (normal)' : `${s}×` }}
                </option>
              </select>
            </label>
            <p class="trailer-reprocess-speed-hint">
              <template v-if="alreadyShrunk && form.speed === 1">
                1× porque o vídeo já foi shrinkado — não acelera outra vez.
              </template>
              <template v-else-if="form.speed === 1">1× = mesma velocidade do original.</template>
              <template v-else>
                Áudio e vídeo a {{ form.speed }}× — duração de cada frame:
                <strong>{{ formatTrailerFrameFactor(form.speed) }}</strong>
                (ajustado automaticamente).
              </template>
            </p>
            <label class="trailer-reprocess-field">
              <span class="trailer-reprocess-label">Altura máx. (px)</span>
              <input
                v-model.number="form.heightPx"
                type="number"
                min="144"
                max="2160"
                step="1"
                class="admin-input"
              />
            </label>
            <label class="trailer-reprocess-field">
              <span class="trailer-reprocess-label">Encoder</span>
              <select v-model="form.useNvenc" class="admin-input">
                <option value="auto">Auto (NVENC se disponível)</option>
                <option value="cpu">CPU (libx264)</option>
                <option value="nvenc">NVENC (NVIDIA)</option>
              </select>
            </label>
            <label v-if="form.useNvenc !== 'cpu'" class="trailer-reprocess-field">
              <span class="trailer-reprocess-label">Preset NVENC</span>
              <select v-model="form.nvencPreset" class="admin-input">
                <option v-for="p in NVENC_PRESETS" :key="p" :value="p">{{ p }}</option>
              </select>
            </label>
          </div>
        </div>

        <div v-if="queue.length" class="shrink-queue">
          <div class="shrink-queue-head">
            <span class="shrink-queue-title">
              Fila {{ queueDoneCount }}/{{ queue.length }}
              <template v-if="busy"> · a processar</template>
            </span>
            <button
              v-if="queueDoneCount"
              type="button"
              class="admin-btn admin-btn--ghost admin-btn--sm"
              title="Tira da lista os já concluídos ou falhados (não apaga /historico)"
              @click="emit('clear-finished')"
            >
              Limpar processados
            </button>
            <button
              v-if="queuePendingCount"
              type="button"
              class="admin-btn admin-btn--ghost admin-btn--sm"
              @click="emit('clear-pending')"
            >
              Limpar pendentes
            </button>
          </div>
          <ul class="shrink-queue-list">
            <li
              v-for="(item, qi) in queue"
              :key="item.id"
              class="shrink-queue-item"
              :class="`shrink-queue-item--${item.status}`"
            >
              <span class="shrink-queue-idx">{{ qi + 1 }}.</span>
              <span class="shrink-queue-label" :title="item.mainRel">{{ item.label }}</span>
              <span class="shrink-queue-status">{{ statusLabel(item.status) }}</span>
              <button
                v-if="item.status === 'pending'"
                type="button"
                class="admin-btn admin-btn--ghost admin-btn--sm"
                @click="emit('remove', item.id)"
              >
                Tirar
              </button>
            </li>
          </ul>
        </div>

        <div class="trailer-reprocess-dialog-actions">
          <button type="button" class="admin-btn admin-btn--ghost" @click="resetForm">
            Restaurar padrões
          </button>
          <button type="button" class="admin-btn admin-btn--ghost" @click="close">Fechar</button>
          <button
            type="button"
            class="admin-btn admin-btn--primary"
            :disabled="!canEnqueue"
            @click="emit('enqueue', { ...form })"
          >
            Adicionar na fila
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  TRAILER_BAT_PARAMS_DEFAULT,
  TRAILER_COLLECT_LABELS,
  TRAILER_SPEED_OPTIONS,
  formatTrailerFrameFactor,
  type TrailerBatParams,
} from '#shared/trailerParams'
import type { QueueItemStatus, QueueListItem } from '~/components/player/ShrinkInPlaceDialog.vue'

const NVENC_PRESETS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'] as const

const props = defineProps<{
  open: boolean
  fileLabel: string
  shrunkNotice: string
  alreadyShrunk: boolean
  busy: boolean
  canEnqueue: boolean
  queue: QueueListItem[]
  queuePendingCount: number
  queueDoneCount: number
  initialForm: TrailerBatParams
}>()

const emit = defineEmits<{
  close: []
  enqueue: [params: TrailerBatParams]
  remove: [id: string]
  'clear-pending': []
  'clear-finished': []
}>()

const form = reactive<TrailerBatParams>({ ...TRAILER_BAT_PARAMS_DEFAULT })
const isPadrao = computed(() => form.collect === 'padrao')
const isLegado = computed(() => form.collect === 'legado')

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) Object.assign(form, props.initialForm)
  },
)

watch(
  () => props.alreadyShrunk,
  (shrunk) => {
    if (props.open && shrunk) form.speed = 1
  },
)

function close() {
  emit('close')
}

function resetForm() {
  Object.assign(form, { ...TRAILER_BAT_PARAMS_DEFAULT })
  if (props.alreadyShrunk) form.speed = 1
}

function statusLabel(s: QueueItemStatus): string {
  if (s === 'pending') return 'na fila'
  if (s === 'running') return 'a correr'
  if (s === 'done') return 'ok'
  return 'falhou'
}

/** Permite o pai forçar speed=1 após detectar shrink. */
function applySpeedIfShrunk() {
  if (props.alreadyShrunk) form.speed = 1
}

defineExpose({ applySpeedIfShrunk, getForm: () => ({ ...form }) })
</script>

<style src="~/assets/css/player-job-dialogs.css"></style>
