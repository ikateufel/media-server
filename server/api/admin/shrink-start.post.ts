import { createError, readBody } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import {
  assertAllowedSourceRoot,
  createShrinkJob,
  normalizeMinSizeMb,
  normalizeShrinkSpeed,
  resolveShrinkFiles,
} from '../../utils/shrinkJobs'
import { normalizeShrinkCodec } from '../../utils/runShrinkBat'

/**
 * Inicia job de shrink (shrink_video.bat por ficheiro).
 * Body: { sourceRoot, files[], height?, speed?, codec?, force?, prioritizeSize?, minSizeMb? }
 */
export default defineEventHandler(async (event) => {
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
    codec?: unknown
    force?: unknown
    prioritizeSize?: unknown
    minSizeMb?: unknown
  } | null

  const sourceRootRaw = String(body?.sourceRoot ?? '').trim()
  if (!sourceRootRaw) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "sourceRoot" obrigatório.' })
  }
  const sourceRoot = await assertAllowedSourceRoot(sourceRootRaw)

  const filesRaw = body?.files
  if (!Array.isArray(filesRaw) || !filesRaw.length) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "files" (array) obrigatório.' })
  }
  const files = filesRaw.map((f) => String(f ?? '').trim()).filter(Boolean)
  const resolved = await resolveShrinkFiles(sourceRoot, files)

  const heightRaw = Number(body?.height ?? 1080)
  const height = Number.isFinite(heightRaw) ? Math.floor(heightRaw) : 1080
  if (height < 144 || height > 4320) {
    throw createError({ statusCode: 400, statusMessage: 'Altura inválida (144–4320).' })
  }

  const speed = normalizeShrinkSpeed(body?.speed ?? 1.5)
  if (!speed) {
    throw createError({ statusCode: 400, statusMessage: 'Velocidade inválida: use 1.25, 1.5 ou 2.' })
  }

  const codec = normalizeShrinkCodec(body?.codec ?? 'auto')
  if (!codec) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Codec inválido: use auto, h264_nvenc, libx264, hevc_nvenc ou libx265.',
    })
  }

  const force = body?.force === true || body?.force === 'true' || body?.force === 1
  const prioritizeSize =
    body?.prioritizeSize === true || body?.prioritizeSize === 'true' || body?.prioritizeSize === 1
  const minSizeMb = normalizeMinSizeMb(body?.minSizeMb ?? 0)

  const snap = createShrinkJob({
    projectRoot: process.cwd(),
    sourceRoot,
    files: resolved,
    height,
    speed,
    codec,
    force,
    prioritizeSize,
    minSizeMb,
  })

  return {
    jobId: snap.id,
    totalFiles: snap.totalFiles,
    sourceRoot: snap.sourceRoot,
    height: snap.height,
    speed: snap.speed,
    codec: snap.codec,
    force: snap.force,
    prioritizeSize: snap.prioritizeSize,
    minSizeMb: snap.minSizeMb ?? 0,
    startedAt: snap.startedAt,
  }
})
