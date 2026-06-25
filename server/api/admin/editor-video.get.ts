import { createError, getQuery } from 'h3'
import { requireAdminTokenAllowQuery } from '../../utils/requireAdmin'
import { resolveEditorFile } from '../../utils/editorJobs'
import { assertAllowedSourceRoot } from '../../utils/shrinkJobs'
import { streamVideoFile } from '../../utils/videoPaths'

/**
 * Stream de preview para o editor — usa `sourceRoot` + `rel` (mesma resolução que a exportação).
 * Query: sourceRoot, rel, token (SSE-style; o `<video>` não envia Authorization).
 */
export default defineEventHandler(async (event) => {
  requireAdminTokenAllowQuery(event)

  const q = getQuery(event) as Record<string, unknown>
  const sourceRootRaw = typeof q.sourceRoot === 'string' ? q.sourceRoot.trim() : ''
  const fileRel = typeof q.rel === 'string' ? q.rel.trim() : ''

  if (!sourceRootRaw) {
    throw createError({ statusCode: 400, statusMessage: 'Query "sourceRoot" obrigatória.' })
  }
  if (!fileRel) {
    throw createError({ statusCode: 400, statusMessage: 'Query "rel" obrigatório.' })
  }

  const sourceRoot = await assertAllowedSourceRoot(sourceRootRaw)
  const file = await resolveEditorFile(sourceRoot, fileRel)
  return streamVideoFile(event, file.path)
})
