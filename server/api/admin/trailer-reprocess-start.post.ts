import { createError, readBody } from 'h3'
import { startTrailerReprocessFromConfig } from '../../utils/trailerReprocessJobs'
import { normalizeTrailerBatParams } from '#shared/trailerParams'

/** Reprocessa o trailer de um vídeo completo (trailer.bat com force). */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)

  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Reprocessar trailer só está disponível quando o servidor corre em Windows.',
    })
  }

  const body = (await readBody(event).catch(() => null)) as {
    session?: unknown
    mainRel?: unknown
    params?: unknown
  } | null

  const session = Number(body?.session ?? NaN)
  const mainRel = String(body?.mainRel ?? '').trim()
  if (!Number.isFinite(session) || session < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "session" inválido.' })
  }
  if (!mainRel) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "mainRel" obrigatório.' })
  }

  const trailerParams = normalizeTrailerBatParams(
    body?.params && typeof body.params === 'object' && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : undefined,
  )

  const snap = startTrailerReprocessFromConfig(config, {
    session: Math.floor(session),
    mainRel,
    projectRoot: process.cwd(),
    trailerParams,
  })

  return {
    jobId: snap.id,
    session: snap.session,
    mainRel: snap.mainRel,
    status: snap.status,
    startedAt: snap.startedAt,
    params: trailerParams,
  }
})
