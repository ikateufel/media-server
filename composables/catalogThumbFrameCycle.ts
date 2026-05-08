/**
 * Ciclo nos vídeos de preview da grelha: em pausa, a cada 1–4 s (aleatório)
 * avança ~um frame no tempo e volta ao início no fim do clip.
 * Durante `play()` o ciclo para (compatível com sequência / “todas a tocar”).
 *
 * Desactivado por omissão (evita seeks + relayout durante a rolagem virtual).
 */
export const CATALOG_THUMB_FRAME_CYCLE_ENABLED = false

const timeouts = new WeakMap<HTMLVideoElement, ReturnType<typeof setTimeout>>()

export function clearCatalogThumbFrameCycle(video: HTMLVideoElement) {
  const t = timeouts.get(video)
  if (t !== undefined) {
    clearTimeout(t)
    timeouts.delete(video)
  }
}

function randomDelayMs(): number {
  return 1000 + Math.random() * 3000
}

/** ~1 frame a 24 fps; ajusta se quiseres passo maior. */
const FRAME_STEP_SEC = 1 / 24

function bumpFrame(video: HTMLVideoElement) {
  const dur = video.duration
  if (!Number.isFinite(dur) || dur <= 0.05) return
  try {
    let t = video.currentTime + FRAME_STEP_SEC
    if (t >= dur - 0.04) t = 0
    video.currentTime = t
  } catch {
    /* */
  }
}

function tick(video: HTMLVideoElement) {
  if (!CATALOG_THUMB_FRAME_CYCLE_ENABLED) return
  timeouts.delete(video)
  if (!video.isConnected || !video.paused) return
  bumpFrame(video)
  scheduleCatalogThumbFrameCycle(video)
}

export function scheduleCatalogThumbFrameCycle(video: HTMLVideoElement) {
  clearCatalogThumbFrameCycle(video)
  if (!CATALOG_THUMB_FRAME_CYCLE_ENABLED) return
  if (!video.isConnected || !video.paused) return
  const dur = video.duration
  if (!Number.isFinite(dur) || dur <= 0.05) return

  const id = setTimeout(() => tick(video), randomDelayMs())
  timeouts.set(video, id)
}

export function onCatalogThumbPlayStopFrameCycle(ev: Event) {
  const v = ev.target
  if (v instanceof HTMLVideoElement) clearCatalogThumbFrameCycle(v)
}

export function onCatalogThumbPauseStartFrameCycle(ev: Event) {
  if (!CATALOG_THUMB_FRAME_CYCLE_ENABLED) return
  const v = ev.target
  if (v instanceof HTMLVideoElement) scheduleCatalogThumbFrameCycle(v)
}
