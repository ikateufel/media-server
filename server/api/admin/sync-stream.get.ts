import { createError, getQuery, setResponseHeader } from 'h3'
import { requireAdminTokenAllowQuery } from '../../utils/requireAdmin'
import { getJobSnapshot, subscribeJob, type JobEvent } from '../../utils/syncJobs'

/**
 * Stream SSE (Server-Sent Events) com a evolução de um job de sincronização.
 *
 * Query: `?jobId=<uuid>&token=<VIDEO_ADMIN_TOKEN>`
 *
 * O `EventSource` do browser não permite cabeçalhos custom — por isso aceitamos
 * o token também via query string (variante `requireAdminTokenAllowQuery`).
 *
 * Eventos emitidos (formato SSE: `event: <type>\ndata: <json>\n\n`):
 *  - `snapshot`     → estado completo (enviado uma vez na ligação)
 *  - `line`         → nova linha de stdout/stderr/meta
 *  - `progress`     → contadores actualizados
 *  - `session-start` / `session-end`
 *  - `status`       → mudança de estado
 *  - `end`          → o job terminou; o servidor fecha a ligação a seguir
 *  - `:` (comment)  → ping a cada 15 s para manter a ligação viva
 */
export default defineEventHandler(async (event) => {
  requireAdminTokenAllowQuery(event)

  const q = getQuery(event) as Record<string, unknown>
  const jobId = typeof q.jobId === 'string' ? q.jobId.trim() : ''
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'Query "jobId" obrigatória.' })
  }
  const initial = getJobSnapshot(jobId)
  if (!initial) {
    throw createError({ statusCode: 404, statusMessage: 'Job não encontrado ou expirado.' })
  }

  setResponseHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setResponseHeader(event, 'Connection', 'keep-alive')
  // Desactiva buffering em proxies tipo nginx.
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  const res = event.node.res
  res.flushHeaders?.()

  const write = (eventName: string, data: unknown) => {
    if (res.writableEnded) return
    res.write(`event: ${eventName}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
  const writeRaw = (chunk: string) => {
    if (res.writableEnded) return
    res.write(chunk)
  }

  // 1) Snapshot inicial — assim quem se liga a meio recebe o estado completo.
  write('snapshot', initial)

  // 2) Subscreve eventos subsequentes.
  let unsubscribe: (() => void) | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let endTimer: ReturnType<typeof setTimeout> | null = null

  await new Promise<void>((resolveStream) => {
    const cleanup = () => {
      if (pingTimer) {
        clearInterval(pingTimer)
        pingTimer = null
      }
      if (endTimer) {
        clearTimeout(endTimer)
        endTimer = null
      }
      if (unsubscribe) {
        try {
          unsubscribe()
        } catch {
          /* */
        }
        unsubscribe = null
      }
      try {
        if (!res.writableEnded) res.end()
      } catch {
        /* */
      }
      resolveStream()
    }

    event.node.req.on('close', cleanup)
    event.node.req.on('aborted', cleanup)

    const onEvent = (ev: JobEvent) => {
      try {
        if (ev.type === 'line') write('line', ev.line)
        else if (ev.type === 'progress')
          write('progress', { totals: ev.totals, currentSessionIndex: ev.currentSessionIndex })
        else if (ev.type === 'session-start')
          write('session-start', { session: ev.session, title: ev.title, path: ev.path })
        else if (ev.type === 'session-end')
          write('session-end', { session: ev.session, result: ev.result })
        else if (ev.type === 'status') {
          write('status', { status: ev.status })
          if (ev.status !== 'running') {
            // Manda snapshot final + sinaliza o fim, depois fecha.
            const fin = getJobSnapshot(jobId)
            if (fin) write('end', fin)
            else write('end', { id: jobId, status: ev.status })
            // Pequeno delay para garantir que o cliente recebe o "end" antes do close.
            endTimer = setTimeout(cleanup, 250)
          }
        }
      } catch {
        cleanup()
      }
    }
    unsubscribe = subscribeJob(jobId, onEvent)
    if (!unsubscribe) {
      cleanup()
      return
    }

    // Se o job já terminou entre o snapshot e a subscrição, fecha imediatamente.
    if (initial.status !== 'running') {
      const fin = getJobSnapshot(jobId)
      write('end', fin ?? initial)
      endTimer = setTimeout(cleanup, 250)
      return
    }

    pingTimer = setInterval(() => {
      writeRaw(`: ping ${Date.now()}\n\n`)
    }, 15_000)
  })
})
