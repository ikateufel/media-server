import type { Ref } from 'vue'

/** Liberta buffers de decode no Silk / Fire TV antes de trocar `src`. */
export function releaseVideoElement(v: HTMLVideoElement | null | undefined) {
  if (!v) return
  try {
    v.pause()
    v.removeAttribute('src')
    const sources = v.querySelectorAll('source')
    sources.forEach((s) => s.remove())
    v.load()
  } catch {
    /* ignore */
  }
}

export function useTvStageVideo(
  tvMode: Ref<boolean>,
  previewUrl: Ref<string | null>,
  playerUrl: Ref<string | null>,
) {
  const tvStageVideoRef = ref<HTMLVideoElement | null>(null)

  const tvStageVideoSrc = computed(() => {
    if (!tvMode.value) return null
    if (playerUrl.value) return playerUrl.value
    if (previewUrl.value) return previewUrl.value
    return null
  })

  const tvStageIsMain = computed(() => tvMode.value && !!playerUrl.value)

  function applyTvStageVideoSrc(url: string | null) {
    const v = tvStageVideoRef.value
    if (!v) return
    releaseVideoElement(v)
    if (!url) return
    v.src = url
    v.load()
  }

  watch(
    tvStageVideoSrc,
    (url) => {
      if (!tvMode.value) return
      void nextTick(() => applyTvStageVideoSrc(url))
    },
    { flush: 'post' },
  )

  watch(tvMode, (on) => {
    if (on) return
    releaseVideoElement(tvStageVideoRef.value)
  })

  return {
    tvStageVideoRef,
    tvStageVideoSrc,
    tvStageIsMain,
    applyTvStageVideoSrc,
    releaseVideoElement,
  }
}
