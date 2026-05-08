import { stat } from 'node:fs/promises'
import { createError, getQuery } from 'h3'
import { streamVideoFile, resolveSafeUnderRoot } from '../utils/videoPaths'
import { resolveCatalogRelAbsoluteCandidates } from '../utils/trailerNames'
import { getVideoRootsFromRuntime } from '../utils/videoMenu'
import { parseSessionQuery } from '../utils/videoSession'

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
  const full = resolveSafeUnderRoot(root, relStr)
  const candidates = relStr.startsWith('trailers/') || relStr.startsWith('preview/')
    ? resolveCatalogRelAbsoluteCandidates(root, relStr)
    : [full]

  let resolved: string | null = null
  for (const p of candidates) {
    let st
    try {
      st = await stat(p)
    } catch {
      continue
    }
    if (st.isFile()) {
      resolved = p
      break
    }
  }
  if (!resolved) {
    throw createError({ statusCode: 404, statusMessage: 'Ficheiro não encontrado' })
  }

  return streamVideoFile(event, resolved)
})
