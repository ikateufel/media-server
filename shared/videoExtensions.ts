/** Extensões de vídeo aceites em shrink, editor, catálogo e scripts .bat (ffmpeg). */
export const VIDEO_FILE_EXTS = ['.mp4', '.mkv', '.m4v', '.avi', '.mov', '.webm', '.wmv'] as const

export const VIDEO_EXT_RE = /\.(mp4|mkv|m4v|avi|mov|webm|wmv)$/i

export function isVideoFileName(name: string): boolean {
  return VIDEO_EXT_RE.test(name.trim())
}

/** Atributo `accept` em `<input type="file">`. */
export const VIDEO_FILE_INPUT_ACCEPT = 'video/*,.mp4,.mkv,.m4v,.avi,.mov,.webm,.wmv'

export const VIDEO_EXT_LABEL = 'mp4, mkv, m4v, avi, mov, webm, wmv'
