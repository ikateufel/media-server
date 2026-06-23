import { createError, readBody } from 'h3'
import { resolve } from 'node:path'
import { getVideoMenuItems } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'
import {
  createEditorJob,
  normalizeEditMode,
  resolveEditorFile,
  validateEditorSegments,
} from '../../utils/editorJobs'
import { normalizeEditorSpeed } from '../../utils/runEditorBat'
import { assertAllowedSourceRoot } from '../../utils/shrinkJobs'

/**
 * Inicia exportação de vídeo editado (edit_video.bat).
 * Body: { sourceRoot, file, editMode?, markedSegments[] | removeSegments[], duration?, height?, speed?, force? }
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Editor só está disponível quando o servidor corre em Windows.',
    })
  }

  const body = (await readBody(event).catch(() => null)) as {
    sourceRoot?: unknown
    file?: unknown
    editMode?: unknown
    markedSegments?: unknown
    removeSegments?: unknown
    duration?: unknown
    height?: unknown
    speed?: unknown
    force?: unknown
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
  const markedRaw = Array.isArray(body?.markedSegments)
    ? body!.markedSegments
    : Array.isArray(body?.removeSegments)
      ? body!.removeSegments
      : []
  const { markedSegments, keepSegments } = validateEditorSegments(duration, editMode, markedRaw)

  const heightRaw = Number(body?.height ?? 1080)
  const height = Number.isFinite(heightRaw) ? Math.floor(heightRaw) : 1080
  if (height < 144 || height > 4320) {
    throw createError({ statusCode: 400, statusMessage: 'Altura inválida (144–4320).' })
  }

  const speed = normalizeEditorSpeed(body?.speed ?? 1)
  if (!speed) {
    throw createError({ statusCode: 400, statusMessage: 'Velocidade inválida: use 1, 1.25, 1.5 ou 2.' })
  }

  const force = body?.force === true || body?.force === 'true' || body?.force === 1

  const snap = createEditorJob({
    projectRoot: process.cwd(),
    sourceRoot,
    file,
    height,
    speed,
    force,
    editMode,
    removeSegments: markedSegments,
    keepSegments,
    duration,
  })

  return {
    jobId: snap.id,
    sourceRoot: snap.sourceRoot,
    file: snap.fileRel,
    height: snap.height,
    speed: snap.speed,
    force: snap.force,
    editMode: snap.editMode,
    keepCount: snap.keepSegments.length,
    markedCount: snap.removeSegments.length,
    startedAt: snap.startedAt,
  }
})
