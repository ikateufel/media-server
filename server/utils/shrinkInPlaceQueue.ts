import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  normalizeShrinkInPlaceParams,
  type ShrinkInPlaceParams,
} from '#shared/shrinkInPlaceParams'
import {
  getShrinkInPlaceSnapshot,
  startShrinkInPlaceFromConfig,
  subscribeShrinkInPlaceJob,
  type ShrinkInPlaceEvent,
  type ShrinkInPlaceLine,
} from './shrinkInPlaceJobs'

export type ShrinkInPlaceQueueItemStatus = 'pending' | 'running' | 'done' | 'failed'

export interface ShrinkInPlaceQueueItem {
  id: string
  session: number
  mainRel: string
  trailerRel: string
  label: string
  params: ShrinkInPlaceParams
  status: ShrinkInPlaceQueueItemStatus
  error?: string
  jobId?: string | null
  createdAt: number
  startedAt?: number | null
  endedAt?: number | null
}

export interface ShrinkInPlaceQueueState {
  items: ShrinkInPlaceQueueItem[]
  updatedAt: number
  busy: boolean
  currentJobId: string | null
  currentItemId: string | null
}

export type ShrinkInPlaceQueueEvent =
  | { type: 'queue'; state: ShrinkInPlaceQueueState }
  | { type: 'line'; line: ShrinkInPlaceLine; itemId: string; jobId: string }
  | {
      type: 'job-status'
      itemId: string
      jobId: string
      status: 'done' | 'failed'
      error?: string | null
    }

type QueueListener = (ev: ShrinkInPlaceQueueEvent) => void

const QUEUE_FILE = () => join(process.cwd(), 'data', 'shrink-in-place-queue.json')
const FINISHED_KEEP_MS = 2 * 60 * 60_000
const FINISHED_KEEP_MAX = 40

interface QueueFileShape {
  items?: unknown
  updatedAt?: unknown
}

interface QueueRuntime {
  items: ShrinkInPlaceQueueItem[]
  updatedAt: number
  pumpActive: boolean
  listeners: Set<QueueListener>
  loaded: boolean
  loadPromise: Promise<void> | null
}

const g = globalThis as typeof globalThis & { __vpShrinkInPlaceQueue?: QueueRuntime }

function runtime(): QueueRuntime {
  if (!g.__vpShrinkInPlaceQueue) {
    g.__vpShrinkInPlaceQueue = {
      items: [],
      updatedAt: Date.now(),
      pumpActive: false,
      listeners: new Set(),
      loaded: false,
      loadPromise: null,
    }
  }
  return g.__vpShrinkInPlaceQueue
}

function publicState(): ShrinkInPlaceQueueState {
  const rt = runtime()
  const running = rt.items.find((i) => i.status === 'running')
  return {
    items: rt.items.map((i) => ({
      ...i,
      params: { ...i.params },
    })),
    updatedAt: rt.updatedAt,
    busy: rt.pumpActive || rt.items.some((i) => i.status === 'pending' || i.status === 'running'),
    currentJobId: running?.jobId ?? null,
    currentItemId: running?.id ?? null,
  }
}

function emit(ev: ShrinkInPlaceQueueEvent) {
  const rt = runtime()
  for (const l of rt.listeners) {
    try {
      l(ev)
    } catch {
      /* */
    }
  }
}

function emitQueue() {
  emit({ type: 'queue', state: publicState() })
}

function pruneFinished(items: ShrinkInPlaceQueueItem[]): ShrinkInPlaceQueueItem[] {
  const now = Date.now()
  const active = items.filter((i) => i.status === 'pending' || i.status === 'running')
  const finished = items
    .filter((i) => i.status === 'done' || i.status === 'failed')
    .filter((i) => {
      const ended = i.endedAt ?? i.startedAt ?? i.createdAt
      return now - ended <= FINISHED_KEEP_MS
    })
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, FINISHED_KEEP_MAX)
  const finishedIds = new Set(finished.map((i) => i.id))
  return items.filter(
    (i) => i.status === 'pending' || i.status === 'running' || finishedIds.has(i.id),
  )
}

function parseItem(raw: unknown): ShrinkInPlaceQueueItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const session = Number(o.session)
  const mainRel = typeof o.mainRel === 'string' ? o.mainRel.trim() : ''
  const trailerRel = typeof o.trailerRel === 'string' ? o.trailerRel.trim() : ''
  const label = typeof o.label === 'string' ? o.label.trim() : mainRel
  if (!id || !Number.isFinite(session) || session < 0 || !mainRel) return null
  let status = String(o.status ?? 'pending') as ShrinkInPlaceQueueItemStatus
  if (status !== 'pending' && status !== 'running' && status !== 'done' && status !== 'failed') {
    status = 'pending'
  }
  const createdAt = Number(o.createdAt)
  const item: ShrinkInPlaceQueueItem = {
    id,
    session: Math.floor(session),
    mainRel,
    trailerRel: trailerRel || mainRel,
    label: label || mainRel,
    params: normalizeShrinkInPlaceParams(
      o.params && typeof o.params === 'object' ? (o.params as Record<string, unknown>) : undefined,
    ),
    status,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  }
  if (typeof o.error === 'string' && o.error.trim()) item.error = o.error.trim()
  if (typeof o.jobId === 'string' && o.jobId.trim()) item.jobId = o.jobId.trim()
  else item.jobId = null
  const startedAt = Number(o.startedAt)
  item.startedAt = Number.isFinite(startedAt) ? startedAt : null
  const endedAt = Number(o.endedAt)
  item.endedAt = Number.isFinite(endedAt) ? endedAt : null
  return item
}

async function persist() {
  const rt = runtime()
  rt.items = pruneFinished(rt.items)
  rt.updatedAt = Date.now()
  const payload: QueueFileShape = { items: rt.items, updatedAt: rt.updatedAt }
  const path = QUEUE_FILE()
  await mkdir(join(process.cwd(), 'data'), { recursive: true })
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8')
}

async function ensureLoaded() {
  const rt = runtime()
  if (rt.loaded) return
  if (rt.loadPromise) {
    await rt.loadPromise
    return
  }
  rt.loadPromise = (async () => {
    try {
      const raw = await readFile(QUEUE_FILE(), 'utf8')
      const parsed = JSON.parse(raw) as QueueFileShape
      const rows = Array.isArray(parsed.items) ? parsed.items : []
      const items: ShrinkInPlaceQueueItem[] = []
      for (const row of rows) {
        const item = parseItem(row)
        if (!item) continue
        if (item.status === 'running') {
          const live = item.jobId ? getShrinkInPlaceSnapshot(item.jobId) : null
          if (!live || live.status !== 'running') {
            item.status = 'pending'
            item.jobId = null
            item.startedAt = null
            item.error = undefined
          }
        }
        items.push(item)
      }
      rt.items = pruneFinished(items)
      rt.updatedAt =
        typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : Date.now()
    } catch {
      rt.items = []
      rt.updatedAt = Date.now()
    } finally {
      rt.loaded = true
      rt.loadPromise = null
    }
  })()
  await rt.loadPromise
  void kickPump()
}

function waitForJob(jobId: string): Promise<'done' | 'failed'> {
  return new Promise((resolve) => {
    const snap = getShrinkInPlaceSnapshot(jobId)
    if (!snap) {
      resolve('failed')
      return
    }
    if (snap.status === 'done' || snap.status === 'failed') {
      resolve(snap.status)
      return
    }
    const unsub = subscribeShrinkInPlaceJob(jobId, (ev: ShrinkInPlaceEvent) => {
      if (ev.type === 'line') {
        const item = runtime().items.find((i) => i.jobId === jobId)
        if (item) {
          emit({ type: 'line', line: ev.line, itemId: item.id, jobId })
        }
      } else if (ev.type === 'status' && (ev.status === 'done' || ev.status === 'failed')) {
        try {
          unsub?.()
        } catch {
          /* */
        }
        resolve(ev.status)
      }
    })
    if (!unsub) resolve('failed')
  })
}

async function runPump() {
  const rt = runtime()
  if (rt.pumpActive) return
  rt.pumpActive = true
  emitQueue()
  try {
    while (true) {
      await ensureLoaded()
      const next = rt.items.find((i) => i.status === 'pending')
      if (!next) break

      next.status = 'running'
      next.startedAt = Date.now()
      next.endedAt = null
      next.error = undefined
      next.jobId = null
      await persist()
      emitQueue()

      let jobId = ''
      try {
        const config = useRuntimeConfig() as unknown as Parameters<
          typeof startShrinkInPlaceFromConfig
        >[0]
        const snap = startShrinkInPlaceFromConfig(config, {
          session: next.session,
          mainRel: next.mainRel,
          trailerRel: next.trailerRel,
          projectRoot: process.cwd(),
          params: next.params,
        })
        jobId = snap.id
        next.jobId = jobId
        await persist()
        emitQueue()

        const live = getShrinkInPlaceSnapshot(jobId)
        if (live?.lines?.length) {
          for (const line of live.lines) {
            emit({ type: 'line', line, itemId: next.id, jobId })
          }
        }

        const result = await waitForJob(jobId)
        const after = getShrinkInPlaceSnapshot(jobId)
        next.status = result
        next.endedAt = Date.now()
        if (result === 'failed') {
          next.error = after?.error?.trim() || 'Shrink falhou.'
        } else {
          next.error = undefined
        }
        emit({
          type: 'job-status',
          itemId: next.id,
          jobId,
          status: result,
          error: next.error ?? null,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        next.status = 'failed'
        next.endedAt = Date.now()
        next.error = msg
        emit({
          type: 'job-status',
          itemId: next.id,
          jobId: jobId || next.jobId || '',
          status: 'failed',
          error: msg,
        })
      }
      await persist()
      emitQueue()
    }
  } finally {
    rt.pumpActive = false
    emitQueue()
  }
}

function kickPump() {
  void runPump()
}

export async function getShrinkInPlaceQueueState(): Promise<ShrinkInPlaceQueueState> {
  await ensureLoaded()
  return publicState()
}

export function subscribeShrinkInPlaceQueue(listener: QueueListener): () => void {
  const rt = runtime()
  rt.listeners.add(listener)
  return () => {
    rt.listeners.delete(listener)
  }
}

export async function enqueueShrinkInPlaceQueueItem(input: {
  session: number
  mainRel: string
  trailerRel?: string
  label?: string
  params?: Partial<ShrinkInPlaceParams> | Record<string, unknown> | null
}): Promise<ShrinkInPlaceQueueState> {
  await ensureLoaded()
  const rt = runtime()
  const session = Math.floor(input.session)
  const mainRel = String(input.mainRel ?? '').trim()
  if (!Number.isFinite(session) || session < 0 || !mainRel) {
    throw new Error('session/mainRel inválidos')
  }
  const dup = rt.items.some(
    (i) =>
      (i.status === 'pending' || i.status === 'running') &&
      i.session === session &&
      i.mainRel === mainRel,
  )
  if (dup) {
    throw new Error('Este vídeo já está na fila.')
  }
  const item: ShrinkInPlaceQueueItem = {
    id: randomUUID(),
    session,
    mainRel,
    trailerRel: String(input.trailerRel ?? mainRel).trim() || mainRel,
    label: String(input.label ?? mainRel).trim() || mainRel,
    params: normalizeShrinkInPlaceParams(input.params),
    status: 'pending',
    jobId: null,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
  }
  rt.items.push(item)
  await persist()
  emitQueue()
  kickPump()
  return publicState()
}

export async function removeShrinkInPlaceQueueItem(id: string): Promise<ShrinkInPlaceQueueState> {
  await ensureLoaded()
  const rt = runtime()
  const before = rt.items.length
  rt.items = rt.items.filter((i) => !(i.id === id && i.status === 'pending'))
  if (rt.items.length !== before) {
    await persist()
    emitQueue()
  }
  return publicState()
}

export async function clearPendingShrinkInPlaceQueue(): Promise<ShrinkInPlaceQueueState> {
  await ensureLoaded()
  const rt = runtime()
  const before = rt.items.length
  rt.items = rt.items.filter((i) => i.status !== 'pending')
  if (rt.items.length !== before) {
    await persist()
    emitQueue()
  }
  return publicState()
}

/** Remove só done/failed da fila activa (não mexe no histórico permanente). */
export async function clearFinishedShrinkInPlaceQueue(): Promise<ShrinkInPlaceQueueState> {
  await ensureLoaded()
  const rt = runtime()
  const before = rt.items.length
  rt.items = rt.items.filter((i) => i.status === 'pending' || i.status === 'running')
  if (rt.items.length !== before) {
    await persist()
    emitQueue()
  }
  return publicState()
}
