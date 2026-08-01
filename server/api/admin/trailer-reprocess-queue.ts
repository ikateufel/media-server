import { createError, getMethod, readBody } from 'h3'
import {
  clearFinishedTrailerReprocessQueue,
  clearPendingTrailerReprocessQueue,
  enqueueTrailerReprocessQueueItem,
  getTrailerReprocessQueueState,
  removeTrailerReprocessQueueItem,
} from '../../utils/trailerReprocessQueue'

/** Fila de reprocessar trailer (data/trailer-reprocess-queue.json). */
export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'GET') {
    return await getTrailerReprocessQueueState()
  }

  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Reprocessar trailer só está disponível quando o servidor corre em Windows.',
    })
  }

  if (method === 'POST') {
    const body = (await readBody(event).catch(() => null)) as {
      action?: unknown
      id?: unknown
      session?: unknown
      mainRel?: unknown
      trailerRel?: unknown
      label?: unknown
      params?: unknown
    } | null

    const action = String(body?.action ?? 'enqueue').trim().toLowerCase()

    if (action === 'remove') {
      const id = String(body?.id ?? '').trim()
      if (!id) {
        throw createError({ statusCode: 400, statusMessage: 'Campo "id" obrigatório.' })
      }
      return await removeTrailerReprocessQueueItem(id)
    }

    if (action === 'clear-pending') {
      return await clearPendingTrailerReprocessQueue()
    }

    if (action === 'clear-finished') {
      return await clearFinishedTrailerReprocessQueue()
    }

    const session = Number(body?.session ?? NaN)
    const mainRel = String(body?.mainRel ?? '').trim()
    if (!Number.isFinite(session) || session < 0) {
      throw createError({ statusCode: 400, statusMessage: 'Campo "session" inválido.' })
    }
    if (!mainRel) {
      throw createError({ statusCode: 400, statusMessage: 'Campo "mainRel" obrigatório.' })
    }

    try {
      return await enqueueTrailerReprocessQueueItem({
        session: Math.floor(session),
        mainRel,
        trailerRel: typeof body?.trailerRel === 'string' ? body.trailerRel : undefined,
        label: typeof body?.label === 'string' ? body.label : undefined,
        params:
          body?.params && typeof body.params === 'object' && !Array.isArray(body.params)
            ? (body.params as Record<string, unknown>)
            : undefined,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw createError({
        statusCode: msg.includes('já está na fila') ? 409 : 400,
        statusMessage: msg,
      })
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Método não suportado.' })
})
