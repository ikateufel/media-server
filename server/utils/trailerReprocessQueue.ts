import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  normalizeTrailerBatParams,
  type TrailerBatParams,
} from '#shared/trailerParams'
import {
  getTrailerReprocessSnapshot,
  startTrailerReprocessFromConfig,
  subscribeTrailerReprocessJob,
  type TrailerReprocessEvent,
  type TrailerReprocessLine,
} from './trailerReprocessJobs'

export type TrailerReprocessQueueItemStatus = 'pending' | 'running' | 'done' | 'failed'

export interface TrailerReprocessQueueItem {
  id: string
  session: number
  mainRel: string
  trailerRel: string
  label: string
  params: TrailerBatParams
  status: TrailerReprocessQueueItemStatus
  error?: string
  jobId?: string | null
  createdAt: number
  startedAt?: number | null
  endedAt?: number | null
}

export interface TrailerReprocessQueueState {
  items: TrailerReprocessQueueItem[]
  updatedAt: number
  busy: boolean
  currentJobId: string | null
  currentItemId: string | null
}

export type TrailerReprocessQueueEvent =
  | { type: 'queue'; state: TrailerReprocessQueueState }
  | { type: 'line'; line: TrailerReprocessLine; itemId: string; jobId: string }
  | {
      type: 'job-status'
      itemId: string
      jobId: string
      status: 'done' | 'failed'
      error?: string | null
    }

type QueueListener = (ev: TrailerReprocessQueueEvent) => void

const QUEUE_FILE = () => join(process.cwd(), 'data', 'trailer-reprocess-queue.json')
const FINISHED_KEEP_MS = 2 * 60 * 60_000
const FINISHED_KEEP_MAX = 40

interface QueueFileShape {
  items?: unknown
  updatedAt?: unknown
}

interface QueueRuntime {
  items: TrailerReprocessQueueItem[]
  updatedAt: number
  pumpActive: boolean
  listeners: Set<QueueListener>
  loaded: boolean
  loadPromise: Promise<void> | null
}

const g = globalThis as typeof globalThis & { __vpTrailerReprocessQueue?: QueueRuntime }

function runtime(): QueueRuntime {
  if (!g.__vpTrailerReprocessQueue) {
    g.__vpTrailerReprocessQueue = {
      items: [],
      updatedAt: Date.now(),
      pumpActive: false,
      listeners: new Set(),
      loaded: false,
      loadPromise: null,
    }
  }
  return g.__vpTrailerReprocessQueue
}

function publicState(): TrailerReprocessQueueState {
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

function emit(ev: TrailerReprocessQueueEvent) {
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

function pruneFinished(items: TrailerReprocessQueueItem[]): TrailerReprocessQueueItem[] {
  const now = Date.now()
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

function parseItem(raw: unknown): TrailerReprocessQueueItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const session = Number(o.session)
  const mainRel = typeof o.mainRel === 'string' ? o.mainRel.trim() : ''
  const trailerRel = typeof o.trailerRel === 'string' ? o.trailerRel.trim() : ''
  const label = typeof o.label === 'string' ? o.label.trim() : mainRel
  if (!id || !Number.isFinite(session) || session < 0 || !mainRel) return null
  let status = String(o.status ?? 'pending') as TrailerReprocessQueueItemStatus
  if (status !== 'pending' && status !== 'running' && status !== 'done' && status !== 'failed') {
    status = 'pending'
  }
  const createdAt = Number(o.createdAt)
  const item: TrailerReprocessQueueItem = {
    id,
    session: Math.floor(session),
    mainRel,
    trailerRel: trailerRel || mainRel,
    label: label || mainRel,
    params: normalizeTrailerBatParams(
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
  await mkdir(join(process.cwd(), 'data'), { recursive: true })
  await writeFile(QUEUE_FILE(), JSON.stringify(payload, null, 2), 'utf8')
}

/** Itens `running` sem job vivo (HMR/crash) bloqueavam a bomba — voltam a pending. */
function recoverOrphanedRunning(): boolean {
  const rt = runtime()
  let changed = false
  for (const item of rt.items) {
    if (item.status !== 'running') continue
    const live = item.jobId ? getTrailerReprocessSnapshot(item.jobId) : null
    if (live && live.status === 'running') continue
    item.status = 'pending'
    item.jobId = null
    item.startedAt = null
    item.endedAt = null
    item.error = undefined
    changed = true
  }
  return changed
}

/** Após HMR o async da bomba morre mas `pumpActive` fica true no globalThis. */
function recoverStuckPumpFlag(): boolean {
  const rt = runtime()
  if (!rt.pumpActive) return false
  const hasLiveJob = rt.items.some((i) => {
    if (i.status !== 'running' || !i.jobId) return false
    const live = getTrailerReprocessSnapshot(i.jobId)
    return Boolean(live && live.status === 'running')
  })
  if (hasLiveJob) return false
  rt.pumpActive = false
  return true
}

function recoverQueueRuntime(): boolean {
  const a = recoverOrphanedRunning()
  const b = recoverStuckPumpFlag()
  return a || b
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
      const items: TrailerReprocessQueueItem[] = []
      for (const row of rows) {
        const item = parseItem(row)
        if (!item) continue
        items.push(item)
      }
      rt.items = pruneFinished(items)
      recoverQueueRuntime()
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
    const snap = getTrailerReprocessSnapshot(jobId)
    if (!snap) {
      resolve('failed')
      return
    }
    if (snap.status === 'done' || snap.status === 'failed') {
      resolve(snap.status)
      return
    }
    const unsub = subscribeTrailerReprocessJob(jobId, (ev: TrailerReprocessEvent) => {
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
      if (recoverQueueRuntime()) {
        await persist()
        emitQueue()
      }
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
          typeof startTrailerReprocessFromConfig
        >[0]
        const snap = startTrailerReprocessFromConfig(config, {
          session: next.session,
          mainRel: next.mainRel,
          trailerRel: next.trailerRel,
          projectRoot: process.cwd(),
          trailerParams: next.params,
        })
        jobId = snap.id
        next.jobId = jobId
        await persist()
        emitQueue()

        const live = getTrailerReprocessSnapshot(jobId)
        if (live?.lines?.length) {
          for (const line of live.lines) {
            emit({ type: 'line', line, itemId: next.id, jobId })
          }
        }

        const result = await waitForJob(jobId)
        const after = getTrailerReprocessSnapshot(jobId)
        next.status = result
        next.endedAt = Date.now()
        if (result === 'failed') {
          next.error = after?.error?.trim() || 'Reprocessar trailer falhou.'
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

export async function getTrailerReprocessQueueState(): Promise<TrailerReprocessQueueState> {
  await ensureLoaded()
  if (recoverQueueRuntime()) {
    await persist()
    emitQueue()
  }
  kickPump()
  return publicState()
}

export function subscribeTrailerReprocessQueue(listener: QueueListener): () => void {
  const rt = runtime()
  rt.listeners.add(listener)
  return () => {
    rt.listeners.delete(listener)
  }
}

export async function enqueueTrailerReprocessQueueItem(input: {
  session: number
  mainRel: string
  trailerRel?: string
  label?: string
  params?: Partial<TrailerBatParams> | Record<string, unknown> | null
}): Promise<TrailerReprocessQueueState> {
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
    throw new Error('Este vídeo já está na fila de trailers.')
  }
  const item: TrailerReprocessQueueItem = {
    id: randomUUID(),
    session,
    mainRel,
    trailerRel: String(input.trailerRel ?? mainRel).trim() || mainRel,
    label: String(input.label ?? mainRel).trim() || mainRel,
    params: normalizeTrailerBatParams(input.params),
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

export async function removeTrailerReprocessQueueItem(
  id: string,
): Promise<TrailerReprocessQueueState> {
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

export async function clearPendingTrailerReprocessQueue(): Promise<TrailerReprocessQueueState> {
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

export async function clearFinishedTrailerReprocessQueue(): Promise<TrailerReprocessQueueState> {
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
