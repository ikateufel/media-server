import { createError, getQuery } from 'h3'
import { resolveEditorFile } from '../../utils/editorJobs'
import { assertAllowedSourceRoot } from '../../utils/shrinkJobs'
import { streamVideoFile } from '../../utils/videoPaths'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'
import { parseSessionQuery } from '../../utils/videoSession'

/**
 * Stream de preview para o editor — sem unlock do catálogo.
 * Query: `rel` + (`session` OU `sourceRoot`)
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event) as Record<string, unknown>
  const fileRel = typeof q.rel === 'string' ? q.rel.trim() : ''
  if (!fileRel) {
    throw createError({ statusCode: 400, message: 'Query "rel" obrigatório.' })
  }

  const sourceRootRaw = typeof q.sourceRoot === 'string' ? q.sourceRoot.trim() : ''
  let sourceRoot: string

  if (sourceRootRaw) {
    sourceRoot = await assertAllowedSourceRoot(sourceRootRaw)
  } else if (q.session !== undefined && q.session !== null && String(q.session).trim() !== '') {
    const config = useRuntimeConfig(event)
    const roots = getVideoRootsFromRuntime(config)
    if (!roots.length) {
      throw createError({ statusCode: 503, message: 'Nenhuma biblioteca configurada.' })
    }
    const session = parseSessionQuery(q, roots.length)
    sourceRoot = roots[session]!.trim()
  } else {
    throw createError({
      statusCode: 400,
      message: 'Indique "session" (biblioteca) ou "sourceRoot" (pasta).',
    })
  }

  const file = await resolveEditorFile(sourceRoot, fileRel)
  // Sem cache: um Range de diagnóstico de 1 byte na mesma URL partia o <video> no browser.
  return streamVideoFile(event, file.path, { cacheControl: 'no-store' })
})
