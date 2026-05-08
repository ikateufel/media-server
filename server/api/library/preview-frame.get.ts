import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createError, getQuery, sendStream, setHeader } from 'h3'
import {
  ensurePreviewFrameCached,
  isPreviewCatalogRel,
  previewFrameCacheFilePath,
} from '../../utils/previewFrameCache'
import { resolveSafeUnderRoot } from '../../utils/videoPaths'
import { resolveCatalogRelAbsoluteCandidates } from '../../utils/trailerNames'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'
import { parseSessionQuery } from '../../utils/videoSession'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const q = getQuery(event) as Record<string, unknown>
  const session = parseSessionQuery(q, roots.length)
  const root = roots[session].trim()
  const rel = q.rel
  if (!rel || Array.isArray(rel)) {
    throw createError({ statusCode: 400, statusMessage: 'Parâmetro rel em falta' })
  }
  const relStr = typeof rel === 'string' ? rel : String(rel)
  if (!isPreviewCatalogRel(relStr)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'rel tem de ser um ficheiro de preview (preview/ ou trailers/*preview*)',
    })
  }

  const rawSlot = q.slot
  const slotRaw = Array.isArray(rawSlot) ? rawSlot[0] : rawSlot
  const slotN = Number(slotRaw ?? 0)
  const slot = Number.isFinite(slotN) ? Math.min(3, Math.max(0, Math.floor(slotN))) : 0

  const full = resolveSafeUnderRoot(root, relStr)
  const candidates = resolveCatalogRelAbsoluteCandidates(root, relStr)
  let resolved: string | null = null
  let st: Awaited<ReturnType<typeof stat>> | null = null
  for (const p of candidates.length ? candidates : [full]) {
    try {
      const s = await stat(p)
      if (!s.isFile()) continue
      resolved = p
      st = s
      break
    } catch {
      /* try next */
    }
  }
  if (!resolved || !st) {
    throw createError({ statusCode: 404, statusMessage: 'Ficheiro não encontrado' })
  }

  const mtimeMs = st.mtimeMs
  const status = await ensurePreviewFrameCached({
    root,
    rel: relStr,
    slot,
    force: false,
  })
  if (status === 'ffprobe-fail') {
    throw createError({
      statusCode: 503,
      statusMessage: 'ffprobe não disponível ou vídeo sem duração válida',
    })
  }
  if (status === 'ffmpeg-fail') {
    throw createError({
      statusCode: 503,
      statusMessage: 'ffmpeg falhou ao extrair frame (instala ffmpeg no PATH?)',
    })
  }
  if (status === 'missing' || status === 'bad-rel') {
    throw createError({ statusCode: 404, statusMessage: 'Ficheiro não encontrado' })
  }

  const cachedPath = previewFrameCacheFilePath(root, relStr, slot, mtimeMs)

  setHeader(event, 'Content-Type', 'image/jpeg')
  setHeader(event, 'Cache-Control', 'public, max-age=604800')
  return sendStream(event, createReadStream(cachedPath))
})
