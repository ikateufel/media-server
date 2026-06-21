import { createError, readBody } from 'h3'
import { resolve } from 'node:path'
import { getVideoMenuItems } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'
import {
  assertAllowedSourceRoot,
  createShrinkJob,
  normalizeShrinkSpeed,
  resolveShrinkFiles,
} from '../../utils/shrinkJobs'

/**
 * Inicia job de shrink (shrink_video.bat por ficheiro).
 * Body: { sourceRoot, files[], height?, speed?, force? }
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Shrink só está disponível quando o servidor corre em Windows.',
    })
  }

  const body = (await readBody(event).catch(() => null)) as {
    sourceRoot?: unknown
    files?: unknown
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

  const filesRaw = body?.files
  if (!Array.isArray(filesRaw) || !filesRaw.length) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "files" (array) obrigatório.' })
  }
  const files = filesRaw.map((f) => String(f ?? '').trim()).filter(Boolean)
  const resolved = await resolveShrinkFiles(sourceRoot, files)

  const heightRaw = Number(body?.height ?? 540)
  const height = Number.isFinite(heightRaw) ? Math.floor(heightRaw) : 540
  if (height < 144 || height > 4320) {
    throw createError({ statusCode: 400, statusMessage: 'Altura inválida (144–4320).' })
  }

  const speed = normalizeShrinkSpeed(body?.speed ?? 1.5)
  if (!speed) {
    throw createError({ statusCode: 400, statusMessage: 'Velocidade inválida: use 1.25, 1.5 ou 2.' })
  }

  const force = body?.force === true || body?.force === 'true' || body?.force === 1

  const snap = createShrinkJob({
    projectRoot: process.cwd(),
    sourceRoot,
    files: resolved,
    height,
    speed,
    force,
  })

  return {
    jobId: snap.id,
    totalFiles: snap.totalFiles,
    sourceRoot: snap.sourceRoot,
    height: snap.height,
    speed: snap.speed,
    force: snap.force,
    startedAt: snap.startedAt,
  }
})
