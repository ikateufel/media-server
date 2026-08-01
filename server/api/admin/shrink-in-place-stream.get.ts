import { createError, getQuery, setResponseHeader } from 'h3'
import {
  getShrinkInPlaceSnapshot,
  subscribeShrinkInPlaceJob,
  type ShrinkInPlaceEvent,
} from '../../utils/shrinkInPlaceJobs'

export default defineEventHandler(async (event) => {
  const q = getQuery(event) as Record<string, unknown>
  const jobId = typeof q.jobId === 'string' ? q.jobId.trim() : ''
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'Query "jobId" obrigatória.' })
  }
  const initial = getShrinkInPlaceSnapshot(jobId)
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

    let lastSeq = 0
    let statusSent = false

    const sendStatus = (ev: Extract<ShrinkInPlaceEvent, { type: 'status' }>) => {
      if (statusSent) return
      statusSent = true
      write('status', ev)
      if (ev.status === 'done' || ev.status === 'failed') {
        setTimeout(cleanup, 200)
      }
    }

    const onEvent = (ev: ShrinkInPlaceEvent) => {
      try {
        if (ev.type === 'line') {
          if (ev.line.seq <= lastSeq) return
          lastSeq = ev.line.seq
          write('line', ev.line)
        } else if (ev.type === 'status') {
          sendStatus(ev)
        }
      } catch {
        cleanup()
      }
    }

    unsubscribe = subscribeShrinkInPlaceJob(jobId, onEvent) ?? null
    if (!unsubscribe) {
      cleanup()
      return
    }

    const snap = getShrinkInPlaceSnapshot(jobId) ?? initial
    for (const line of snap.lines) {
      if (line.seq <= lastSeq) continue
      lastSeq = line.seq
      write('line', line)
    }
    write('snapshot', {
      id: snap.id,
      status: snap.status,
      exitCode: snap.exitCode,
      error: snap.error ?? null,
      newMainRel: snap.newMainRel,
      totalLines: snap.totalLines,
      params: snap.params,
      mainRel: snap.mainRel,
      title: snap.title,
    })

    if (snap.status !== 'running') {
      sendStatus({
        type: 'status',
        status: snap.status,
        exitCode: snap.exitCode,
        newMainRel: snap.newMainRel,
        error: snap.error ?? null,
      })
    }

    pingTimer = setInterval(() => {
      if (res.writableEnded) return
      res.write(': ping\n\n')
    }, 25_000)
  })
})
