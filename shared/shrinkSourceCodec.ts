export type ShrinkSourceCodecFamily = 'h264' | 'hevc' | 'other'

export interface ShrinkSourceCodecAssessment {
  ok: boolean
  family: ShrinkSourceCodecFamily
  codec: string
  message: string
}

/** Codecs que não são vídeo comprimido útil para shrink. */
const BLOCKED = new Set([
  '',
  'mjpeg',
  'png',
  'bmp',
  'gif',
  'rawvideo',
  'webp',
  'tiff',
  'jpeg2000',
])

/** Codecs que decodam mas raramente encolhem o suficiente / são muito lentos no nosso fluxo. */
const UNLIKELY = new Set([
  'vp9',
  'av1',
  'vp8',
  'prores',
  'dnxhd',
  'ffv1',
  'utvideo',
  'v210',
  'r210',
])

/** Outros codecs que o FFmpeg costuma transcodificar para H.264/HEVC NVENC. */
const ALLOW_OTHER = new Set([
  'mpeg4',
  'msmpeg4v2',
  'msmpeg4v3',
  'mpeg2video',
  'mpeg1video',
  'wmv3',
  'wmv2',
  'wmv1',
  'vc1',
  'flv1',
  'rv40',
  'rv30',
  'h263',
  'theora',
])

export function shrinkSourceCodecFamily(codec: string | null | undefined): ShrinkSourceCodecFamily {
  const c = String(codec ?? '')
    .trim()
    .toLowerCase()
  if (!c) return 'other'
  if (c === 'hevc' || c === 'h265') return 'hevc'
  if (c === 'h264' || c.startsWith('avc')) return 'h264'
  return 'other'
}

export function assessShrinkSourceCodec(codec: string | null | undefined): ShrinkSourceCodecAssessment {
  const raw = String(codec ?? '').trim()
  const c = raw.toLowerCase()
  const family = shrinkSourceCodecFamily(c)

  if (!c) {
    return {
      ok: false,
      family: 'other',
      codec: raw,
      message: 'Codec de vídeo desconhecido (ffprobe não devolveu codec_name).',
    }
  }

  if (BLOCKED.has(c)) {
    return {
      ok: false,
      family,
      codec: raw,
      message: `Codec «${raw}» não é vídeo comprimido — ignorado para shrink.`,
    }
  }

  if (UNLIKELY.has(c)) {
    return {
      ok: false,
      family,
      codec: raw,
      message: `Codec «${raw}» — shrink improvável (muito lento ou quase sem redução). Converta antes ou use outra ferramenta.`,
    }
  }

  if (family === 'h264' || family === 'hevc') {
    return {
      ok: true,
      family,
      codec: raw,
      message: `Codec ${raw} — OK para shrink (GPU NVENC).`,
    }
  }

  if (ALLOW_OTHER.has(c)) {
    return {
      ok: true,
      family,
      codec: raw,
      message: `Codec ${raw} — fora de H.264/HEVC; pode ser mais lento.`,
    }
  }

  return {
    ok: false,
    family,
    codec: raw,
    message: `Codec «${raw}» não suportado para shrink automático.`,
  }
}
