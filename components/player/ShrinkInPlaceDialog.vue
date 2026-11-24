<template>
  <Teleport to="body">
    <div v-if="open" class="move-title-backdrop" @click="close" />
    <div
      v-if="open"
      class="trailer-reprocess-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shrink-in-place-dialog-title"
    >
      <div class="trailer-reprocess-dialog-card">
        <div class="session-menu-head">
          <span id="shrink-in-place-dialog-title" class="session-menu-title">Shrink — fila</span>
          <button type="button" class="session-menu-close" aria-label="Fechar" @click="close">×</button>
        </div>
        <div class="trailer-reprocess-dialog-body">
          <p class="trailer-reprocess-dialog-hint">
            Adiciona vídeos à fila; processam-se em sequência no servidor (um de cada vez).
            A fila fica guardada em disco — podes dar refresh e continuar a acompanhar.
            Histórico em <NuxtLink to="/historico" class="empty-hint-link">/historico</NuxtLink>.
            Cada um cria <code class="admin-code">shrinked\</code> e <strong>substitui o original</strong>
            (sem backup).
            Podes fechar este diálogo sem cancelar a fila.
          </p>
          <p v-if="fileLabel" class="trailer-reprocess-dialog-file">Actual: {{ fileLabel }}</p>
          <p v-if="alreadyDoneHint" class="shrink-already-warn" role="alert">
            <span class="shrink-already-warn-title">Já foi shrinkado</span>
            {{ alreadyDoneHint }}
          </p>

          <div class="trailer-reprocess-grid">
            <label class="trailer-reprocess-field">
              <span class="trailer-reprocess-label">Resolução (altura)</span>
              <select v-model.number="form.height" class="admin-input">
                <option v-for="h in SHRINK_IN_PLACE_HEIGHT_OPTIONS" :key="h" :value="h">
                  {{ SHRINK_IN_PLACE_HEIGHT_LABELS[h] ?? `${h}p` }}
                </option>
              </select>
            </label>
            <label class="trailer-reprocess-field">
              <span class="trailer-reprocess-label">Velocidade (×)</span>
              <select v-model.number="form.speed" class="admin-input">
                <option v-for="s in SHRINK_IN_PLACE_SPEED_OPTIONS" :key="s" :value="s">{{ s }}×</option>
              </select>
            </label>
            <label class="trailer-reprocess-field trailer-reprocess-field--full">
              <span class="trailer-reprocess-label">Codec de vídeo</span>
              <select v-model="form.codec" class="admin-input">
                <option v-for="c in SHRINK_IN_PLACE_CODEC_OPTIONS" :key="c.value" :value="c.value">
                  {{ c.label }}
                </option>
              </select>
            </label>
            <label class="trailer-reprocess-field trailer-reprocess-field--full trailer-reprocess-check">
              <input v-model="form.prioritizeSize" type="checkbox" />
              <span>Priorizar tamanho (2ª passagem qualidade se a saída ficar grande)</span>
            </label>
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
  SHRINK_IN_PLACE_CODEC_OPTIONS,
  SHRINK_IN_PLACE_HEIGHT_LABELS,
  SHRINK_IN_PLACE_HEIGHT_OPTIONS,
  SHRINK_IN_PLACE_PARAMS_DEFAULT,
  SHRINK_IN_PLACE_SPEED_OPTIONS,
  type ShrinkInPlaceParams,
} from '#shared/shrinkInPlaceParams'

export type QueueItemStatus = 'pending' | 'running' | 'done' | 'failed'

export interface QueueListItem {
  id: string
  mainRel: string
  label: string
  status: QueueItemStatus
}

const props = defineProps<{
  open: boolean
  fileLabel: string
  alreadyDoneHint: string
  busy: boolean
  canEnqueue: boolean
  queue: QueueListItem[]
  queuePendingCount: number
  queueDoneCount: number
  initialForm: ShrinkInPlaceParams
}>()

const emit = defineEmits<{
  close: []
  enqueue: [params: ShrinkInPlaceParams]
  remove: [id: string]
  'clear-pending': []
  'clear-finished': []
}>()

const form = reactive<ShrinkInPlaceParams>({ ...SHRINK_IN_PLACE_PARAMS_DEFAULT })

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) Object.assign(form, props.initialForm)
  },
)

function close() {
  emit('close')
}

function resetForm() {
  Object.assign(form, { ...SHRINK_IN_PLACE_PARAMS_DEFAULT })
}

function statusLabel(s: QueueItemStatus): string {
  if (s === 'pending') return 'na fila'
  if (s === 'running') return 'a correr'
  if (s === 'done') return 'ok'
  return 'falhou'
}
</script>

<style src="~/assets/css/player-job-dialogs.css"></style>
