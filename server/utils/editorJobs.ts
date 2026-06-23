import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createError } from 'h3'
import {
  computeKeepSegments,
  mergeSegments,
  normalizeRemoveSegments,
  type CutSegment,
} from './editorCuts'

export type EditorEditMode = 'exclude' | 'keep'

export function normalizeEditMode(raw: unknown): EditorEditMode {
  const s = String(raw ?? 'exclude').trim().toLowerCase()
  return s === 'keep' ? 'keep' : 'exclude'
}
import { runEditorBatForFile, type EditorSpeed } from './runEditorBat'
import { logIfOutputLargerThanSource, oversizedOutputMessage, type OversizedOutputEntry } from './oversizedOutputLog'
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
  editMode: EditorEditMode
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
  oversizedOutput: OversizedOutputEntry | null
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
  mode: EditorEditMode,
  marked: CutSegment[],
): { markedSegments: CutSegment[]; keepSegments: CutSegment[]; editMode: EditorEditMode } {
  const markedSegments = normalizeRemoveSegments(marked)
  if (!markedSegments.length) {
    throw createError({
      statusCode: 400,
      statusMessage:
        mode === 'keep'
          ? 'Marque pelo menos um trecho a recortar.'
          : 'Marque pelo menos um trecho a excluir.',
    })
  }
  if (duration != null && Number.isFinite(duration) && duration > 0) {
    for (const s of markedSegments) {
      if (s.start >= duration || s.end <= 0) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Trecho marcado fora da duração do vídeo.',
        })
      }
    }
    const keepSegments =
      mode === 'keep'
        ? mergeSegments(
            markedSegments.map((s) => ({
              start: Math.max(0, s.start),
              end: Math.min(duration, s.end),
            })),
          )
        : computeKeepSegments(duration, markedSegments)
    if (!keepSegments.length) {
      throw createError({
        statusCode: 400,
        statusMessage:
          mode === 'keep'
            ? 'Nenhum trecho válido para recortar.'
            : 'Excluir estes trechos deixaria o vídeo vazio.',
      })
    }
    return { markedSegments, keepSegments, editMode: mode }
  }
  const keepSegments =
    mode === 'keep'
      ? mergeSegments(markedSegments)
      : computeKeepSegments(Number.MAX_SAFE_INTEGER, markedSegments)
  return { markedSegments, keepSegments, editMode: mode }
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
      `[INICIO] ${snap.fileRel} · modo ${snap.editMode === 'keep' ? 'recortar' : 'excluir'} · ${snap.keepSegments.length} trecho(s) a exportar · ${snap.speed}x · ${snap.height}px`,
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
      const logged = await logIfOutputLargerThanSource({
        projectRoot,
        sourcePath: snap.filePath,
        outputSubdir: 'edited',
        tool: 'editor',
        fileRel: snap.fileRel,
      })
      if (logged) {
        snap.oversizedOutput = logged
        const msg = oversizedOutputMessage(logged)
        pushLine(job, 'meta', `[OVERSIZED] ${msg}`)
        pushLine(job, 'stderr', `[AVISO] ${msg}`)
      }
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
  editMode: EditorEditMode
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
    editMode: opts.editMode,
    removeSegments: opts.removeSegments,
    keepSegments: opts.keepSegments,
    duration: opts.duration,
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    lines: [],
    totalLines: 0,
    cancelRequested: false,
    oversizedOutput: null,
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
