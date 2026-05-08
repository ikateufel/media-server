<!-- SVG em assets/icons/trailer-random.svg (é esse o ficheiro que deves editar) -->
<script setup lang="ts">
import trailerRandomSvg from '~/assets/icons/trailer-random.svg?raw'
</script>

<template>
  <span class="icon-trailer-random icon-svg" v-html="trailerRandomSvg" />
</template>

<style scoped>
.icon-trailer-random {
  color: inherit;
}

.icon-trailer-random :deep(svg) {
  display: block;
  width: 20px;
  height: 20px;
  fill: currentColor;
}

.icon-trailer-random :deep(path) {
  fill: currentColor;
}
</style>
