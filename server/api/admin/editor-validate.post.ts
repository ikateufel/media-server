import { createError, readBody } from 'h3'
import { resolve } from 'node:path'
import { getVideoMenuItems } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'
import {
  resolveEditorFile,
  validateEditorSegments,
} from '../../utils/editorJobs'
import { assertAllowedSourceRoot } from '../../utils/shrinkJobs'

/**
 * Valida ficheiro e trechos a remover antes de exportar.
 * Body: { sourceRoot, file, removeSegments[], duration? }
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as {
    sourceRoot?: unknown
    file?: unknown
    removeSegments?: unknown
    duration?: unknown
  } | null

  const allowed = getVideoMenuItems(config).map((e) => resolve(e.path.trim()))
  if (!allowed.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).',
    })
  }

  const sourceRootRaw = String(body?.sourceRoot ?? '').trim()
  if (!sourceRootRaw) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "sourceRoot" obrigatório.' })
  }
  const sourceRoot = assertAllowedSourceRoot(sourceRootRaw, allowed)

  const fileRel = String(body?.file ?? '').trim()
  if (!fileRel) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "file" obrigatório.' })
  }
  const file = await resolveEditorFile(sourceRoot, fileRel)

  const durationRaw = Number(body?.duration)
  const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null
  const { removeSegments, keepSegments } = validateEditorSegments(
    duration,
    Array.isArray(body?.removeSegments) ? body!.removeSegments : [],
  )

  return {
    sourceRoot,
    file: file.rel,
    path: file.path,
    removeSegments,
    keepSegments,
    keepCount: keepSegments.length,
    removeCount: removeSegments.length,
  }
})
