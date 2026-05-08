import { createError, readBody } from 'h3'
import { moveTitleBetweenVideoRoots } from '../../utils/moveTitleBetweenRoots'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

/**
 * Move um título completo (ficheiro na raiz + trailer + preview + JPEGs em `.thumb_cache/`)
 * para outra pasta VIDEO_ROOT / biblioteca.
 *
 * Body: `{ session: number, targetSession: number, trailerRel: string }`
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const body = (await readBody(event)) as {
    session?: unknown
    targetSession?: unknown
    trailerRel?: unknown
  }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const targetSession =
    typeof body.targetSession === 'number' ? body.targetSession : Number(body.targetSession)
  const trailerRelRaw = typeof body.trailerRel === 'string' ? body.trailerRel.trim() : ''

  if (!Number.isFinite(session) || !Number.isFinite(targetSession) || !trailerRelRaw) {
    throw createError({
      statusCode: 400,
      statusMessage: 'session, targetSession e trailerRel são obrigatórios.',
    })
  }

  try {
    const out = await moveTitleBetweenVideoRoots({
      roots,
      fromSession: session,
      toSession: targetSession,
      trailerRelRaw,
    })
    return { ok: true, ...out }
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'statusCode' in e) throw e
    const msg = e instanceof Error ? e.message : String(e)
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
