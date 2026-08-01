export type ShrinkInPlaceSpeed = 1.25 | 1.5 | 2
export type ShrinkInPlaceCodec = 'auto' | 'h264_nvenc' | 'libx264' | 'hevc_nvenc' | 'libx265'

export interface ShrinkInPlaceParams {
  height: number
  speed: ShrinkInPlaceSpeed
  codec: ShrinkInPlaceCodec
  prioritizeSize: boolean
}

export const SHRINK_IN_PLACE_PARAMS_DEFAULT: ShrinkInPlaceParams = {
  height: 1080,
  speed: 1.5,
  codec: 'h264_nvenc',
  prioritizeSize: false,
}

export const SHRINK_IN_PLACE_SPEED_OPTIONS: ShrinkInPlaceSpeed[] = [1.25, 1.5, 2]

export const SHRINK_IN_PLACE_HEIGHT_OPTIONS: number[] = [480, 720, 1080, 1440]

export const SHRINK_IN_PLACE_HEIGHT_LABELS: Record<number, string> = {
  480: '480p',
  720: '720p',
  1080: '1080p',
  1440: '1440p (2K)',
}

export const SHRINK_IN_PLACE_CODEC_OPTIONS: { value: ShrinkInPlaceCodec; label: string }[] = [
  { value: 'auto', label: 'Auto (escolhe encoder)' },
  { value: 'h264_nvenc', label: 'H.264 NVENC (NVIDIA)' },
  { value: 'libx264', label: 'H.264 CPU (libx264)' },
  { value: 'hevc_nvenc', label: 'H.265 NVENC (NVIDIA)' },
  { value: 'libx265', label: 'H.265 CPU (libx265)' },
]

function normalizeSpeed(raw: unknown): ShrinkInPlaceSpeed {
  const n = Number(raw)
  if (n === 1.25 || n === 1.5 || n === 2) return n
  return SHRINK_IN_PLACE_PARAMS_DEFAULT.speed
}

function normalizeCodec(raw: unknown): ShrinkInPlaceCodec {
  const s = String(raw ?? '').trim().toLowerCase()
  if (
    s === 'auto' ||
    s === 'h264_nvenc' ||
    s === 'libx264' ||
    s === 'hevc_nvenc' ||
    s === 'libx265'
  ) {
    return s
  }
  return SHRINK_IN_PLACE_PARAMS_DEFAULT.codec
}

function normalizeHeight(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return SHRINK_IN_PLACE_PARAMS_DEFAULT.height
  const h = Math.floor(n)
  if (SHRINK_IN_PLACE_HEIGHT_OPTIONS.includes(h)) return h
  let best = SHRINK_IN_PLACE_HEIGHT_OPTIONS[0]!
  let bestDist = Math.abs(h - best)
  for (const opt of SHRINK_IN_PLACE_HEIGHT_OPTIONS) {
    const d = Math.abs(h - opt)
    if (d < bestDist) {
      best = opt
      bestDist = d
    }
  }
  return best
}

export function normalizeShrinkInPlaceParams(
  raw?: Partial<ShrinkInPlaceParams> | Record<string, unknown> | null,
): ShrinkInPlaceParams {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    height: normalizeHeight((src as { height?: unknown }).height),
    speed: normalizeSpeed((src as { speed?: unknown }).speed),
    codec: normalizeCodec((src as { codec?: unknown }).codec),
    prioritizeSize: Boolean((src as { prioritizeSize?: unknown }).prioritizeSize),
  }
}
