import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createError } from 'h3'
import {
  computeKeepSegments,
  normalizeRemoveSegments,
  type CutSegment,
} from './editorCuts'
import { runEditorBatForFile, type EditorSpeed } from './runEditorBat'
import { tailText } from './runLibraryBat'
import { hasPathTraversal, resolveMediaFileUnderRoot } from './videoPaths'
import { isVideoFileName } from '#shared/videoExtensions'

export type EditorJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface EditorJobLine {
  seq: number
  at: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

export interface EditorJobSnapshot {
  id: string
  status: EditorJobStatus
  sourceRoot: string
  fileRel: string
  filePath: string
  height: number
  speed: EditorSpeed
  force: boolean
  removeSegments: CutSegment[]
  keepSegments: CutSegment[]
  duration: number | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  stdoutTail?: string
  stderrTail?: string
  lines: EditorJobLine[]
  totalLines: number
  cancelRequested: boolean
}

export type EditorJobEvent =
  | { type: 'line'; line: EditorJobLine }
  | { type: 'status'; status: EditorJobStatus }

type Listener = (ev: EditorJobEvent) => void

const LINE_RING_CAP = 800
const STDOUT_TAIL_CAP = 12_000
const JOB_RETENTION_MS = 30 * 60_000

interface InternalJob {
  snapshot: EditorJobSnapshot
  listeners: Set<Listener>
  currentPid: number | null
  cancelRequested: boolean
}

const jobs = new Map<string, InternalJob>()

function pruneOldJobs() {
  const now = Date.now()
  for (const [id, j] of jobs) {
    if (j.snapshot.status === 'running') continue
    if (j.snapshot.endedAt && now - j.snapshot.endedAt > JOB_RETENTION_MS) {
      jobs.delete(id)
    }
  }
}

function emit(job: InternalJob, ev: EditorJobEvent) {
  for (const l of job.listeners) {
    try {
      l(ev)
    } catch {
      /* */
    }
  }
}

function pushLine(job: InternalJob, stream: EditorJobLine['stream'], text: string) {
  const seq = job.snapshot.totalLines + 1
  const line: EditorJobLine = { seq, at: Date.now(), stream, text }
  job.snapshot.totalLines = seq
  job.snapshot.lines.push(line)
  if (job.snapshot.lines.length > LINE_RING_CAP) {
    job.snapshot.lines.splice(0, job.snapshot.lines.length - LINE_RING_CAP)
  }
  emit(job, { type: 'line', line })
}

function setStatus(job: InternalJob, status: EditorJobStatus) {
  if (job.snapshot.status === status) return
  job.snapshot.status = status
  if (status !== 'running') job.snapshot.endedAt = Date.now()
  emit(job, { type: 'status', status })
}

export async function resolveEditorFile(
  sourceRoot: string,
  fileRel: string,
): Promise<{ rel: string; path: string }> {
  const rel = String(fileRel ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!rel || hasPathTraversal(rel)) {
    throw createError({ statusCode: 400, statusMessage: `Caminho inválido: ${fileRel}` })
  }
  if (!isVideoFileName(rel)) {
    throw createError({ statusCode: 400, statusMessage: `Extensão não suportada: ${rel}` })
  }
  const resolved = await resolveMediaFileUnderRoot(sourceRoot, rel)
  return { rel: resolved.rel, path: resolved.path }
}

export function validateEditorSegments(
  duration: number | null,
  remove: CutSegment[],
): { removeSegments: CutSegment[]; keepSegments: CutSegment[] } {
  const removeSegments = normalizeRemoveSegments(remove)
  if (!removeSegments.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Marque pelo menos um trecho a remover.',
    })
  }
  if (duration != null && Number.isFinite(duration) && duration > 0) {
    for (const s of removeSegments) {
      if (s.start >= duration || s.end <= 0) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Trecho marcado fora da duração do vídeo.',
        })
      }
    }
    const keepSegments = computeKeepSegments(duration, removeSegments)
    if (!keepSegments.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Remover estes trechos deixaria o vídeo vazio.',
      })
    }
    return { removeSegments, keepSegments }
  }
  const keepSegments = computeKeepSegments(Number.MAX_SAFE_INTEGER, removeSegments)
  return { removeSegments, keepSegments }
}

async function runJob(job: InternalJob, projectRoot: string) {
  const snap = job.snapshot
  try {
    if (job.cancelRequested) {
      pushLine(job, 'meta', '[ABORTAR] exportação cancelada.')
      setStatus(job, 'cancelled')
      return
    }

    pushLine(
      job,
      'meta',
      `[INICIO] ${snap.fileRel} · ${snap.keepSegments.length} trecho(s) a manter · ${snap.speed}x · ${snap.height}px`,
    )

    const r = await runEditorBatForFile({
      projectRoot,
      videoAbsolutePath: snap.filePath,
      keepSegments: snap.keepSegments,
      height: snap.height,
      speed: snap.speed,
      force: snap.force,
      onSpawn: (pid) => {
        job.currentPid = pid
        if (job.cancelRequested && pid != null) {
          try {
            process.kill(pid)
          } catch {
            /* */
          }
        }
      },
      onLine: (stream, text) => pushLine(job, stream, text),
    })

    snap.exitCode = r.exitCode
    snap.stdoutTail = tailText(r.stdout, STDOUT_TAIL_CAP)
    snap.stderrTail = tailText(r.stderr, STDOUT_TAIL_CAP)

    if (job.cancelRequested) {
      setStatus(job, 'cancelled')
      return
    }

    if (r.exitCode === 0) {
      setStatus(job, 'done')
    } else {
      pushLine(job, 'stderr', `[ERRO] exit code ${r.exitCode}`)
      setStatus(job, 'failed')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    pushLine(job, 'stderr', `[FATAL] ${msg}`)
    setStatus(job, 'failed')
  } finally {
    job.currentPid = null
  }
}

export interface CreateEditorJobOpts {
  projectRoot: string
  sourceRoot: string
  file: { rel: string; path: string }
  height: number
  speed: EditorSpeed
  force: boolean
  removeSegments: CutSegment[]
  keepSegments: CutSegment[]
  duration: number | null
}

export function createEditorJob(opts: CreateEditorJobOpts): EditorJobSnapshot {
  pruneOldJobs()
  const id = randomUUID()
  const snapshot: EditorJobSnapshot = {
    id,
    status: 'running',
    sourceRoot: opts.sourceRoot,
    fileRel: opts.file.rel,
    filePath: opts.file.path,
    height: opts.height,
    speed: opts.speed,
    force: opts.force,
    removeSegments: opts.removeSegments,
    keepSegments: opts.keepSegments,
    duration: opts.duration,
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    lines: [],
    totalLines: 0,
    cancelRequested: false,
  }
  const internal: InternalJob = {
    snapshot,
    listeners: new Set(),
    currentPid: null,
    cancelRequested: false,
  }
  jobs.set(id, internal)
  void runJob(internal, opts.projectRoot)
  return snapshot
}

export function getEditorJobSnapshot(id: string): EditorJobSnapshot | null {
  const j = jobs.get(id)
  return j ? { ...j.snapshot, cancelRequested: j.cancelRequested } : null
}

export function subscribeEditorJob(id: string, listener: Listener): (() => void) | null {
  const j = jobs.get(id)
  if (!j) return null
  j.listeners.add(listener)
  return () => {
    j.listeners.delete(listener)
  }
}

export function cancelEditorJob(id: string): boolean {
  const j = jobs.get(id)
  if (!j) return false
  if (j.snapshot.status !== 'running') return false
  j.cancelRequested = true
  j.snapshot.cancelRequested = true
  pushLine(j, 'meta', '[CANCELAR] pedido recebido.')
  if (j.currentPid != null) {
    try {
      process.kill(j.currentPid)
    } catch {
      /* */
    }
  }
  return true
}

export function getRunningEditorJobSnapshot(): EditorJobSnapshot | null {
  pruneOldJobs()
  let best: InternalJob | null = null
  for (const j of jobs.values()) {
    if (j.snapshot.status !== 'running') continue
    if (!best || j.snapshot.startedAt > best.snapshot.startedAt) best = j
  }
  return best ? { ...best.snapshot, cancelRequested: best.cancelRequested } : null
}
