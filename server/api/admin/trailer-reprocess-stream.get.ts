import { createError, getQuery, setResponseHeader } from 'h3'
import {
  getTrailerReprocessSnapshot,
  subscribeTrailerReprocessJob,
  type TrailerReprocessEvent,
} from '../../utils/trailerReprocessJobs'

export default defineEventHandler(async (event) => {
  const q = getQuery(event) as Record<string, unknown>
  const jobId = typeof q.jobId === 'string' ? q.jobId.trim() : ''
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'Query "jobId" obrigatória.' })
  }
  const initial = getTrailerReprocessSnapshot(jobId)
  if (!initial) {
    throw createError({ statusCode: 404, statusMessage: 'Job não encontrado ou expirado.' })
  }

  setResponseHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setResponseHeader(event, 'Connection', 'keep-alive')
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  const res = event.node.res
  res.flushHeaders?.()

  const write = (eventName: string, data: unknown) => {
    if (res.writableEnded) return
    res.write(`event: ${eventName}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  await new Promise<void>((resolveStream) => {
    let unsubscribe: (() => void) | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null

    const cleanup = () => {
      if (pingTimer) {
        clearInterval(pingTimer)
        pingTimer = null
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

    write('snapshot', initial)

    const onEvent = (ev: TrailerReprocessEvent) => {
      try {
        if (ev.type === 'line') write('line', ev.line)
        else if (ev.type === 'status') {
          write('status', ev)
          if (ev.status === 'done' || ev.status === 'failed') {
            setTimeout(cleanup, 200)
          }
        }
      } catch {
        cleanup()
      }
    }

    unsubscribe = subscribeTrailerReprocessJob(jobId, onEvent) ?? null
    if (!unsubscribe) {
      cleanup()
      return
    }

    pingTimer = setInterval(() => {
      if (res.writableEnded) return
      res.write(': ping\n\n')
    }, 25_000)

    if (initial.status !== 'running') {
      setTimeout(cleanup, 200)
    }
  })
})
