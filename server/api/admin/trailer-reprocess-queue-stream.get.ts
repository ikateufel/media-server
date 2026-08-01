import { setResponseHeader } from 'h3'
import {
  getTrailerReprocessQueueState,
  subscribeTrailerReprocessQueue,
  type TrailerReprocessQueueEvent,
} from '../../utils/trailerReprocessQueue'
import { getTrailerReprocessSnapshot } from '../../utils/trailerReprocessJobs'

/** SSE: fila de reprocessar trailer + linhas do job actual. */
export default defineEventHandler(async (event) => {
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
    let idleCloseTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (pingTimer) {
        clearInterval(pingTimer)
        pingTimer = null
      }
      if (idleCloseTimer) {
        clearTimeout(idleCloseTimer)
        idleCloseTimer = null
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

    const scheduleIdleClose = (busy: boolean) => {
      if (idleCloseTimer) {
        clearTimeout(idleCloseTimer)
        idleCloseTimer = null
      }
      if (busy) return
      idleCloseTimer = setTimeout(cleanup, 1500)
    }

    event.node.req.on('close', cleanup)
    event.node.req.on('aborted', cleanup)

    void (async () => {
      const initial = await getTrailerReprocessQueueState()
      write('queue', initial)

      const running = initial.items.find((i) => i.status === 'running' && i.jobId)
      if (running?.jobId) {
        const snap = getTrailerReprocessSnapshot(running.jobId)
        if (snap?.lines?.length) {
          for (const line of snap.lines) {
            write('line', { ...line, itemId: running.id, jobId: running.jobId })
          }
        }
      }

      scheduleIdleClose(initial.busy)

      unsubscribe = subscribeTrailerReprocessQueue((ev: TrailerReprocessQueueEvent) => {
        try {
          if (ev.type === 'queue') {
            write('queue', ev.state)
            scheduleIdleClose(ev.state.busy)
          } else if (ev.type === 'line') {
            write('line', {
              ...ev.line,
              itemId: ev.itemId,
              jobId: ev.jobId,
            })
          } else if (ev.type === 'job-status') {
            write('job-status', {
              itemId: ev.itemId,
              jobId: ev.jobId,
              status: ev.status,
              error: ev.error ?? null,
            })
          }
        } catch {
          cleanup()
        }
      })

      pingTimer = setInterval(() => {
        if (res.writableEnded) {
          cleanup()
          return
        }
        try {
          res.write(`: ping\n\n`)
        } catch {
          cleanup()
        }
      }, 15000)
    })()
  })
})
