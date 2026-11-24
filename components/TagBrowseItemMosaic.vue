<script setup lang="ts">
import { catalogPreviewFrameUrl } from '~/composables/useVideoFolder'

export interface ItemCoverRef {
  session: number
  rel: string
  slot: number
}

const props = defineProps<{
  samples: {
    session: number
    trailerRel: string
    previewRel: string
    label: string
  }[]
  itemLabel: string
  /** Pré-visualização ainda não chegou do servidor para este item. */
  pending?: boolean
  /** Fotos escolhidas pelo utilizador (até 2); substituem as automáticas. */
  covers?: ItemCoverRef[]
  /** Item em modo de edição: clicar na foto abre o escolhedor. */
  editing?: boolean
}>()

const emit = defineEmits<{
  open: []
  pick: []
}>()

function frameUrl(rel: string, session: number, slot: number) {
  return catalogPreviewFrameUrl(rel.replace(/\\/g, '/'), session, slot)
}

/**
 * Até 2 fotos: primeiro as escolhidas pelo utilizador; se faltar, completa com fotos
 * automáticas de vídeos diferentes do item (ou duas frames do único vídeo).
 */
const frames = computed(() => {
  const out: string[] = []
  const chosen = (props.covers ?? []).slice(0, 2)
  for (const c of chosen) out.push(frameUrl(c.rel, c.session, c.slot))

  const vids = props.samples
    .map((s) => ({ session: s.session, rel: (s.previewRel || s.trailerRel || '').replace(/\\/g, '/') }))
    .filter((s) => s.rel)
  const usedRels = new Set(chosen.map((c) => `${c.session}|${c.rel.replace(/\\/g, '/')}`))
  for (const v of vids) {
    if (out.length >= 2) break
    if (usedRels.has(`${v.session}|${v.rel}`)) continue
    out.push(frameUrl(v.rel, v.session, 0))
  }
  if (!chosen.length && out.length === 1 && vids.length === 1) {
    out.push(frameUrl(vids[0]!.rel, vids[0]!.session, 2))
  }
  return out.slice(0, 2)
})

const statusText = computed(() => {
  if (frames.value.length) return ''
  return props.pending ? 'A carregar…' : 'Sem imagem'
})

function onClick() {
  if (props.editing) emit('pick')
  else emit('open')
}
</script>

<template>
  <button
    type="button"
    class="item-photos"
    :class="{ 'item-photos--empty': !frames.length, 'item-photos--editing': editing }"
    :title="editing ? 'Escolher fotos do item' : samples[0]?.label || itemLabel"
    :aria-label="editing ? `Escolher fotos de «${itemLabel}»` : `Fotos de «${itemLabel}»`"
    @click="onClick"
  >
    <template v-if="frames.length">
      <img
        v-for="(src, i) in frames"
        :key="i"
        class="item-photos-img"
        :src="src"
        alt=""
        loading="lazy"
        decoding="async"
      />
    </template>
    <span v-else class="item-photos-status">{{ statusText }}</span>
  </button>
</template>

<style scoped>
.item-photos {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 0;
  padding: 0;
  border: 1px solid #2d333b;
  border-radius: 8px;
  overflow: hidden;
  background: #050608;
  cursor: pointer;
}

.item-photos:hover {
  outline: 1px solid #5f9dee;
  outline-offset: -1px;
}

.item-photos--editing {
  outline: 1px dashed #f5b942;
  outline-offset: -1px;
}

.item-photos--empty {
  grid-template-columns: 1fr;
  cursor: default;
}

.item-photos-img {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  object-fit: cover;
  background: #050608;
}

.item-photos-status {
  align-self: center;
  justify-self: center;
  font-size: 0.78rem;
  color: #9aa0a6;
}
</style>
