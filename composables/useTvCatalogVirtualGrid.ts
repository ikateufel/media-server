import type { Ref } from 'vue'
import type { TrailerListEntry } from '~/composables/useVideoFolder'

/** Tiles montados de cada lado do foco (total máx. 2*R+1 = 7). */
export const TV_GRID_WINDOW_RADIUS = 3

/** Altura estimada por linha da grelha (thumb 16:9 + label) para spacers de scroll. */
export const TV_GRID_TILE_ESTIMATE_PX = 218

export type CatalogGridRow = { entry: TrailerListEntry; index: number }

export function useTvCatalogVirtualGrid(
  tvMode: Ref<boolean>,
  entries: Ref<TrailerListEntry[]>,
  focusedIndex: Ref<number | null>,
) {
  const catalogGridRenderItems = computed((): CatalogGridRow[] => {
    const list = entries.value
    const n = list.length
    if (!n) return []
    if (!tvMode.value) {
      return list.map((entry, index) => ({ entry, index }))
    }
    const fi = Math.max(0, Math.min(focusedIndex.value ?? 0, n - 1))
    const start = Math.max(0, fi - TV_GRID_WINDOW_RADIUS)
    const end = Math.min(n, fi + TV_GRID_WINDOW_RADIUS + 1)
    const out: CatalogGridRow[] = []
    for (let index = start; index < end; index++) {
      out.push({ entry: list[index]!, index })
    }
    return out
  })

  const tvGridPaddingTopPx = computed(() => {
    if (!tvMode.value) return 0
    const n = entries.value.length
    if (!n) return 0
    const fi = Math.max(0, Math.min(focusedIndex.value ?? 0, n - 1))
    const start = Math.max(0, fi - TV_GRID_WINDOW_RADIUS)
    return start * TV_GRID_TILE_ESTIMATE_PX
  })

  const tvGridPaddingBottomPx = computed(() => {
    if (!tvMode.value) return 0
    const n = entries.value.length
    if (!n) return 0
    const fi = Math.max(0, Math.min(focusedIndex.value ?? 0, n - 1))
    const end = Math.min(n, fi + TV_GRID_WINDOW_RADIUS + 1)
    return (n - end) * TV_GRID_TILE_ESTIMATE_PX
  })

  return {
    catalogGridRenderItems,
    tvGridPaddingTopPx,
    tvGridPaddingBottomPx,
  }
}
