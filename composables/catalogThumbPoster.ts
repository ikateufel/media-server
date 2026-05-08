/**
 * Escolhe um frame do vídeo de preview da grelha com mais variedade de cor
 * (entropia do histograma RGB quantizado) e define `video.poster`.
 *
 * A grelha usa `<video src="/api/video?rel=…">` para o MP4 em `preview/` (ou legado em `trailers/`),
 * gerado pelo preview.bat. Sem `poster`, o browser
 * mostra o frame em currentTime (souvente 0). Com esta rotina, analisamos
 * instantes à volta do meio do ficheiro (evita o início) e fixamos JPEG em `poster`.
 */

const doneKeys = new Set<string>()
const inFlight = new Set<string>()

export function clearCatalogThumbPosterCache() {
  doneKeys.clear()
  inFlight.clear()
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const dur = video.duration
    if (!Number.isFinite(dur) || dur <= 0) {
      resolve()
      return
    }
    const clamped = Math.min(Math.max(0, t), Math.max(0, dur - 0.05))
    const timer = window.setTimeout(() => {
      cleanup()
      resolve()
    }, 2200)
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onErr)
    }
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      resolve()
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onErr, { once: true })
    try {
      video.currentTime = clamped
    } catch {
      cleanup()
      resolve()
    }
  })
}

/** Entropia de Shannon (bits) no histograma 5+5+5 por pixel. Mais alto = mais variedade. */
function frameColorEntropy(imageData: ImageData): number {
  const { data } = imageData
  const n = data.length >> 2
  if (!n) return 0
  const hist = new Map<number, number>()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! >> 3
    const g = data[i + 1]! >> 3
    const b = data[i + 2]! >> 3
    const key = (r << 10) | (g << 5) | b
    hist.set(key, (hist.get(key) ?? 0) + 1)
  }
  let H = 0
  for (const c of hist.values()) {
    const p = c / n
    H -= p * Math.log2(p + 1e-15)
  }
  return H
}

const SAMPLE_W = 56
const SAMPLE_H = 32

function sampleEntropyAtCurrentFrame(video: HTMLVideoElement): number {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return 0
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_W
  canvas.height = SAMPLE_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H)
  let id: ImageData
  try {
    id = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)
  } catch {
    return 0
  }
  return frameColorEntropy(id)
}

function capturePosterDataUrl(video: HTMLVideoElement, quality = 0.72): string | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const canvas = document.createElement('canvas')
  const maxW = 480
  const scale = Math.min(1, maxW / vw)
  canvas.width = Math.max(1, Math.round(vw * scale))
  canvas.height = Math.max(1, Math.round(vh * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  try {
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return null
  }
}

/** Instantâneos à volta do meio (evita o início do clip, muitas vezes fade/preto). */
function candidateTimes(dur: number): number[] {
  if (!Number.isFinite(dur) || dur <= 0.2) return [Math.max(0, dur * 0.5)]
  const mid = dur * 0.5
  const t = [
    mid,
    dur * 0.38,
    dur * 0.62,
    dur * 0.28,
    dur * 0.72,
    Math.max(0.1 * dur, dur - 0.14),
  ]
  const seen = new Set<number>()
  const out: number[] = []
  for (const x of t) {
    const c = Math.min(Math.max(0.06 * dur, x), dur - 0.04)
    const k = Math.round(c * 1000)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(c)
    }
  }
  return out
}

function scheduleIdle(fn: () => void) {
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }
  ).requestIdleCallback
  if (typeof ric === 'function') {
    ric(fn, { timeout: 1800 })
  } else {
    window.setTimeout(fn, 1)
  }
}

/**
 * @param doneKey chave estável, ex. `${session}:${trailerRel}`.
 */
export function maybeSetSmartCatalogPoster(video: HTMLVideoElement, doneKey: string): void {
  if (!doneKey || doneKeys.has(doneKey) || inFlight.has(doneKey)) return
  inFlight.add(doneKey)

  scheduleIdle(() => {
    void (async () => {
      try {
        const dur = video.duration
        if (!Number.isFinite(dur) || dur <= 0) return

        if (!video.paused) {
          doneKeys.add(doneKey)
          return
        }

        if (!video.videoWidth || !video.videoHeight) {
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(() => resolve(), 1000)
            const onData = () => {
              window.clearTimeout(timer)
              video.removeEventListener('loadeddata', onData)
              resolve()
            }
            video.addEventListener('loadeddata', onData, { once: true })
          })
        }

        let bestT = 0
        let bestScore = -1
        const times = candidateTimes(dur)

        for (const t of times) {
          await seekTo(video, t)
          const score = sampleEntropyAtCurrentFrame(video)
          if (score > bestScore) {
            bestScore = score
            bestT = t
          }
        }

        await seekTo(video, bestT)
        const dataUrl = capturePosterDataUrl(video)
        if (dataUrl) {
          video.poster = dataUrl
        }

        doneKeys.add(doneKey)
      } finally {
        inFlight.delete(doneKey)
      }
    })()
  })
}
