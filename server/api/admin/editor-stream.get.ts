import { createError, getQuery, setResponseHeader } from 'h3'
import { requireAdminTokenAllowQuery } from '../../utils/requireAdmin'
import {
  getEditorJobSnapshot,
  subscribeEditorJob,
  type EditorJobEvent,
} from '../../utils/editorJobs'

export default defineEventHandler(async (event) => {
  requireAdminTokenAllowQuery(event)

  const q = getQuery(event) as Record<string, unknown>
  const jobId = typeof q.jobId === 'string' ? q.jobId.trim() : ''
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'Query "jobId" obrigatória.' })
  }
  const initial = getEditorJobSnapshot(jobId)
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
  const writeRaw = (chunk: string) => {
    if (res.writableEnded) return
    res.write(chunk)
  }

  await new Promise<void>((resolveStream) => {
    let unsubscribe: (() => void) | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let endTimer: ReturnType<typeof setTimeout> | null = null

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

    write('snapshot', initial)

    const onEvent = (ev: EditorJobEvent) => {
      try {
        if (ev.type === 'line') write('line', ev.line)
        else if (ev.type === 'status') {
          write('status', { status: ev.status })
          if (ev.status !== 'running') {
            const fin = getEditorJobSnapshot(jobId)
            write('end', fin ?? { id: jobId, status: ev.status })
            endTimer = setTimeout(cleanup, 250)
          }
        }
      } catch {
        cleanup()
      }
    }

    unsubscribe = subscribeEditorJob(jobId, onEvent)
    if (!unsubscribe) {
      cleanup()
      return
    }

    if (initial.status !== 'running') {
      write('end', getEditorJobSnapshot(jobId) ?? initial)
      endTimer = setTimeout(cleanup, 250)
      return
    }

    pingTimer = setInterval(() => {
      writeRaw(`: ping ${Date.now()}\n\n`)
    }, 15_000)
  })
})
