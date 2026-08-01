import { createError, readBody } from 'h3'
import { normalizeShrinkInPlaceParams } from '#shared/shrinkInPlaceParams'
import { startShrinkInPlaceFromConfig } from '../../utils/shrinkInPlaceJobs'

/** Shrink do vídeo completo e substitui o ficheiro original automaticamente. */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)

  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Shrink in-place só está disponível quando o servidor corre em Windows.',
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

  const params = normalizeShrinkInPlaceParams(
    body?.params && typeof body.params === 'object' && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : undefined,
  )

  const snap = startShrinkInPlaceFromConfig(config, {
    session: Math.floor(session),
    mainRel,
    projectRoot: process.cwd(),
    params,
  })

  return {
    jobId: snap.id,
    session: snap.session,
    mainRel: snap.mainRel,
    status: snap.status,
    startedAt: snap.startedAt,
    params: snap.params,
  }
})
