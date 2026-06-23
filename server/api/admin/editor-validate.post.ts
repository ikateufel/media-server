import { createError, readBody } from 'h3'
import { resolve } from 'node:path'
import { getVideoMenuItems } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'
import {
  normalizeEditMode,
  resolveEditorFile,
  validateEditorExport,
} from '../../utils/editorJobs'
import { normalizeRemoveSegments } from '../../utils/editorCuts'
import { assertAllowedSourceRoot } from '../../utils/shrinkJobs'

/**
 * Valida ficheiro, splits e marcações antes de exportar.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as {
    sourceRoot?: unknown
    file?: unknown
    editMode?: unknown
    splitPoints?: unknown
    excludeSegments?: unknown
    keepMarkedSegments?: unknown
    markedSegments?: unknown
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
  const editMode = normalizeEditMode(body?.editMode)

  const excludeRaw = Array.isArray(body?.excludeSegments)
    ? body!.excludeSegments
    : Array.isArray(body?.removeSegments)
      ? body!.removeSegments
      : []
  const keepRaw = Array.isArray(body?.keepMarkedSegments)
    ? body!.keepMarkedSegments
    : Array.isArray(body?.markedSegments) && editMode === 'keep'
      ? body!.markedSegments
      : []

  const validation = validateEditorExport({
    duration,
    editMode,
    excludeSegments: normalizeRemoveSegments(excludeRaw),
    keepMarkedSegments: normalizeRemoveSegments(keepRaw),
    splitPoints: body?.splitPoints,
  })

  return {
    sourceRoot,
    file: file.rel,
    path: file.path,
    editMode: validation.editMode,
    splitExport: validation.splitExport,
    splitPoints: validation.splitPoints,
    chunkPlans: validation.chunkPlans.map((p) => ({
      label: p.label,
      chunk: p.chunk,
      keepCount: p.keepSegments.length,
      keepSegments: p.keepSegments,
    })),
    keepCount: validation.keepSegments.length,
    markedCount: validation.markedSegments.length,
    excludeCount: validation.excludeSegments.length,
    keepMarkedCount: validation.keepMarkedSegments.length,
  }
})
