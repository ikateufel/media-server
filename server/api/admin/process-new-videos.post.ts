import { createError, readBody } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import { getVideoMenuRowsForCli } from '../../utils/videoMenu'
import {
  getProcessNewVideosPublicStatus,
  startProcessNewVideos,
} from '../../utils/processNewVideos'

/**
 * Body: { session: number }
 * Arranca a pipeline «novos»: sem trailer (excl. já shrinkados) → trailer → auto-tags → shrink ≥600MB sem backup.
 */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)

  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Pipeline «novos» só está disponível quando o servidor corre em Windows.',
    })
  }

  const body = (await readBody(event).catch(() => null)) as { session?: unknown } | null
  const session = Number(body?.session ?? NaN)
  const items = getVideoMenuRowsForCli()
  if (!items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).',
    })
  }
  if (!Number.isFinite(session) || session < 0 || session >= items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Campo "session" obrigatório (0..${items.length - 1}).`,
    })
  }

  const current = getProcessNewVideosPublicStatus()
  if (current.busy) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Já há uma pipeline «novos» a correr.',
    })
  }

  try {
    return await startProcessNewVideos(Math.floor(session))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    throw createError({
      statusCode: 400,
      statusMessage: msg,
    })
  }
})
