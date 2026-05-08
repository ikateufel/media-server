import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolvePreviewTrailerRel } from './previewTrailer'
import { resolveCatalogRelAbsoluteCandidates, trailerToMainFilename } from './trailerNames'
import { resolveSafeUnderRoot } from './videoPaths'

const execFileAsync = promisify(execFile)

/** Número de miniaturas JPEG por título (grelha / preview-frame). */
export const PREVIEW_FRAME_SLOT_COUNT = 4

/** Fracções da duração para cada slot (igual à API `preview-frame`). */
export const PREVIEW_FRAME_SLOT_FRACS = [0.2, 0.38, 0.55, 0.72] as const

/** Extensões de vídeo aceites como fonte de miniaturas (preview/ ou trailer “plano”). */
const PREVIEW_FRAME_SOURCE_EXTS = ['.mp4', '.webm', '.mkv', '.m4v', '.mov', '.avi'] as const

function relEndsWithVideoExt(n: string): boolean {
  return PREVIEW_FRAME_SOURCE_EXTS.some((ext) => n.endsWith(ext))
}

export function isPreviewCatalogRel(rel: string): boolean {
  const n = rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  if (n.startsWith('preview/') && relEndsWithVideoExt(n)) return true
  if (n.startsWith('trailers/') && relEndsWithVideoExt(n)) return true
  return n.startsWith('trailers/') && n.includes('preview')
}

/** Pasta oculta na raiz de cada VIDEO_ROOT com JPEGs do catálogo (API `preview-frame`). */
export const PREVIEW_THUMB_CACHE_DIR = '.thumb_cache'

export function previewFrameCacheFilePath(
  videoRoot: string,
  rel: string,
  slot: number,
  mtimeMs: number,
): string {
  const relN = rel.replace(/\\/g, '/')
  const h = createHash('sha256')
    .update(`${relN}\0${slot}\0${mtimeMs}`)
    .digest('hex')
    .slice(0, 48)
  return join(videoRoot, PREVIEW_THUMB_CACHE_DIR, `${h}.jpg`)
}

async function ffprobeDurationSec(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { windowsHide: true, maxBuffer: 1 << 20 },
    )
    const n = Number(String(stdout).trim())
    return Number.isFinite(n) && n > 0.2 ? n : null
  } catch {
    return null
  }
}

async function ffmpegExtractJpeg(videoPath: string, sec: number, outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true })
  const tmp = `${outPath}.${process.pid}.${Date.now()}.tmp.jpg`
  const s = String(sec)

  /** `-ss` antes de `-i` é rápido; alguns MKV falham — tentar depois de `-i` (mais robusto). */
  const argVariants: string[][] = [
    ['-hide_banner', '-loglevel', 'error', '-ss', s, '-i', videoPath, '-frames:v', '1', '-q:v', '4', '-y', tmp],
    ['-hide_banner', '-loglevel', 'error', '-i', videoPath, '-ss', s, '-frames:v', '1', '-q:v', '4', '-y', tmp],
  ]

  let lastErr: unknown
  for (const args of argVariants) {
    await unlink(tmp).catch(() => {})
    try {
      await execFileAsync('ffmpeg', args, { windowsHide: true, maxBuffer: 16 << 20 })
    } catch (e) {
      lastErr = e
      continue
    }
    const st = await stat(tmp).catch(() => null)
    if (!st || st.size < 80) {
      lastErr = new Error('empty frame')
      await unlink(tmp).catch(() => {})
      continue
    }
    try {
      await rename(tmp, outPath)
    } catch {
      await unlink(tmp).catch(() => {})
      await stat(outPath)
    }
    return
  }
  await unlink(tmp).catch(() => {})
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export type EnsurePreviewFrameStatus = 'hit' | 'built' | 'missing' | 'bad-rel' | 'ffprobe-fail' | 'ffmpeg-fail'

export async function ensurePreviewFrameCached(opts: {
  root: string
  rel: string
  slot: number
  force?: boolean
}): Promise<EnsurePreviewFrameStatus> {
  const { root, rel, slot, force } = opts
  if (!isPreviewCatalogRel(rel)) return 'bad-rel'

  let full: string
  try {
    full = resolveSafeUnderRoot(root, rel)
  } catch {
    return 'bad-rel'
  }

  let st: Awaited<ReturnType<typeof stat>> | null = null
  const candidates = resolveCatalogRelAbsoluteCandidates(root, rel)
  for (const p of candidates.length ? candidates : [full]) {
    try {
      const s = await stat(p)
      if (!s.isFile()) continue
      full = p
      st = s
      break
    } catch {
      /* try next */
    }
  }
  if (!st) return 'missing'

  const mtimeMs = st.mtimeMs
  const cachedPath = previewFrameCacheFilePath(root, rel, slot, mtimeMs)

  if (!force) {
    try {
      await stat(cachedPath)
      return 'hit'
    } catch {
      /* gerar */
    }
  } else {
    await unlink(cachedPath).catch(() => {})
  }

  const dur = await ffprobeDurationSec(full)
  if (dur === null) return 'ffprobe-fail'

  const frac = PREVIEW_FRAME_SLOT_FRACS[Math.min(3, Math.max(0, slot))] ?? PREVIEW_FRAME_SLOT_FRACS[0]
  const sec = Math.min(Math.max(dur * frac, 0.1), Math.max(0.15, dur - 0.1))
  try {
    await ffmpegExtractJpeg(full, sec, cachedPath)
  } catch {
    return 'ffmpeg-fail'
  }
  return 'built'
}

/** `previewRel` distintos com ficheiro existente (para pré-aquecer cache sem API). */
export async function listPreviewRelsForVideoRoot(root: string): Promise<string[]> {
  const trailersDir = join(root, 'trailers')
  const out = new Set<string>()

  async function considerCatalogTrailer(trailerPathWithinTrailers: string): Promise<void> {
    const mainFilename = trailerToMainFilename(trailerPathWithinTrailers)
    if (!mainFilename) return
    const trailerRel = `trailers/${trailerPathWithinTrailers}`.replace(/\\/g, '/')
    const trailerCandidates = resolveCatalogRelAbsoluteCandidates(root, trailerRel)
    let trailerExists = false
    for (const p of trailerCandidates) {
      try {
        const s = await stat(p)
        if (!s.isFile()) continue
        trailerExists = true
        break
      } catch {
        /* */
      }
    }
    if (!trailerExists) return
    const previewRel = await resolvePreviewTrailerRel(root, trailerPathWithinTrailers)
    if (!previewRel) return
    try {
      const previewCandidates = resolveCatalogRelAbsoluteCandidates(root, previewRel)
      for (const p of previewCandidates) {
        const s = await stat(p).catch(() => null)
        if (!s || !s.isFile()) continue
        out.add(previewRel.replace(/\\/g, '/'))
        break
      }
    } catch {
      /* sem preview no disco */
    }
  }

  let dirents
  try {
    dirents = await readdir(trailersDir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const d of dirents) {
    if (d.isFile()) {
      await considerCatalogTrailer(d.name)
      continue
    }
    if (!d.isDirectory() || d.name.startsWith('.')) continue
    let sub: Awaited<ReturnType<typeof readdir>>
    try {
      sub = await readdir(join(trailersDir, d.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const f of sub) {
      if (!f.isFile()) continue
      await considerCatalogTrailer(`${d.name}/${f.name}`)
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
