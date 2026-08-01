import { createError, getMethod, readBody } from 'h3'
import {
  clearFinishedShrinkInPlaceQueue,
  clearPendingShrinkInPlaceQueue,
  enqueueShrinkInPlaceQueueItem,
  getShrinkInPlaceQueueState,
  removeShrinkInPlaceQueueItem,
} from '../../utils/shrinkInPlaceQueue'

/** Estado da fila de shrink in-place (persistida em data/shrink-in-place-queue.json). */
export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'GET') {
    return await getShrinkInPlaceQueueState()
  }

  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Shrink in-place só está disponível quando o servidor corre em Windows.',
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
      return await removeShrinkInPlaceQueueItem(id)
    }

    if (action === 'clear-pending') {
      return await clearPendingShrinkInPlaceQueue()
    }

    if (action === 'clear-finished') {
      return await clearFinishedShrinkInPlaceQueue()
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
      return await enqueueShrinkInPlaceQueueItem({
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
