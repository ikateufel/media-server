import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createError } from 'h3'
import { getVideoMenuItems } from './videoMenu'
import { runTrailerBatForFile } from './runTrailerBatForFile'
import { resolveSafeUnderRoot } from './videoPaths'
import { tailText } from './runLibraryBat'
import { isVideoFileName } from '#shared/videoExtensions'
import type { TrailerBatParams } from '#shared/trailerParams'
import { normalizeTrailerBatParams } from '#shared/trailerParams'

export type TrailerReprocessStatus = 'running' | 'done' | 'failed'

export interface TrailerReprocessLine {
  seq: number
  at: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

export interface TrailerReprocessSnapshot {
  id: string
  status: TrailerReprocessStatus
  session: number
  mainRel: string
  title: string
  exitCode: number | null
  startedAt: number
  endedAt: number | null
  lines: TrailerReprocessLine[]
  totalLines: number
  error?: string
}

export type TrailerReprocessEvent =
  | { type: 'line'; line: TrailerReprocessLine }
  | { type: 'status'; status: TrailerReprocessStatus; exitCode?: number | null }

type Listener = (ev: TrailerReprocessEvent) => void

const LINE_RING_CAP = 400
const JOB_RETENTION_MS = 30 * 60_000

interface InternalJob {
  snapshot: TrailerReprocessSnapshot
  listeners: Set<Listener>
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

function emit(job: InternalJob, ev: TrailerReprocessEvent) {
  for (const l of job.listeners) {
    try {
      l(ev)
    } catch {
      /* */
    }
  }
}

function pushLine(job: InternalJob, stream: TrailerReprocessLine['stream'], text: string) {
  const seq = job.snapshot.totalLines + 1
  const line: TrailerReprocessLine = { seq, at: Date.now(), stream, text }
  job.snapshot.totalLines = seq
  job.snapshot.lines.push(line)
  if (job.snapshot.lines.length > LINE_RING_CAP) {
    job.snapshot.lines.splice(0, job.snapshot.lines.length - LINE_RING_CAP)
  }
  emit(job, { type: 'line', line })
}

function setStatus(job: InternalJob, status: TrailerReprocessStatus, exitCode?: number | null) {
  job.snapshot.status = status
  if (status !== 'running') job.snapshot.endedAt = Date.now()
  if (exitCode !== undefined) job.snapshot.exitCode = exitCode
  emit(job, { type: 'status', status, exitCode })
}

export function resolveTrailerReprocessVideo(
  menu: { path: string; title: string }[],
  session: number,
  mainRelRaw: string,
): { session: number; mainRel: string; path: string; title: string } {
  if (!menu.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).',
    })
  }
  if (!Number.isFinite(session) || session < 0 || session >= menu.length) {
    throw createError({ statusCode: 400, statusMessage: `Sessão inválida: ${session}` })
  }
  const mainRel = String(mainRelRaw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!mainRel || !isVideoFileName(mainRel)) {
    throw createError({ statusCode: 400, statusMessage: 'Caminho de vídeo inválido.' })
  }
  const root = resolve(menu[session]!.path.trim())
  const path = resolveSafeUnderRoot(root, mainRel)
  return {
    session: Math.floor(session),
    mainRel,
    path,
    title: menu[session]!.title?.trim() || mainRel,
  }
}

function expectedTrailerOutputPath(videoAbsolutePath: string): string {
  const stem = basename(videoAbsolutePath, extname(videoAbsolutePath))
  return join(dirname(videoAbsolutePath), 'trailers', `${stem}.mp4`)
}

async function runJob(job: InternalJob, projectRoot: string, videoPath: string, trailerParams: TrailerBatParams) {
  try {
    pushLine(job, 'meta', `[INICIO] trailer ${job.snapshot.mainRel}`)
    const r = await runTrailerBatForFile({
      projectRoot,
      videoAbsolutePath: videoPath,
      trailerParams,
      onLine: (stream, text) => pushLine(job, stream, text),
    })
    job.snapshot.exitCode = r.exitCode
    if (r.exitCode !== 0) {
      const tail = tailText(r.stderr || r.stdout, 4000)
      job.snapshot.error = tail.trim() || `trailer.bat exit ${r.exitCode}`
      pushLine(job, 'meta', `[ERRO] trailer terminou com exitCode=${r.exitCode}`)
      setStatus(job, 'failed', r.exitCode)
      return
    }
    const trailerOut = expectedTrailerOutputPath(videoPath)
    if (!existsSync(trailerOut)) {
      const msg = `trailer.bat terminou sem criar ${trailerOut}`
      job.snapshot.error = msg
      pushLine(job, 'meta', `[ERRO] ${msg}`)
      setStatus(job, 'failed', r.exitCode)
      return
    }
    pushLine(job, 'meta', '[OK] trailer concluído.')
    setStatus(job, 'done', 0)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    job.snapshot.error = msg
    pushLine(job, 'stderr', `[FATAL] ${msg}`)
    setStatus(job, 'failed', null)
  }
}

export function createTrailerReprocessJob(opts: {
  projectRoot: string
  session: number
  mainRel: string
  path: string
  title: string
  trailerParams: TrailerBatParams
}): TrailerReprocessSnapshot {
  pruneOldJobs()
  const id = randomUUID()
  const snapshot: TrailerReprocessSnapshot = {
    id,
    status: 'running',
    session: opts.session,
    mainRel: opts.mainRel,
    title: opts.title,
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    lines: [],
    totalLines: 0,
  }
  const internal: InternalJob = { snapshot, listeners: new Set() }
  jobs.set(id, internal)
  void runJob(internal, opts.projectRoot, opts.path, opts.trailerParams)
  return snapshot
}

export function getTrailerReprocessSnapshot(id: string): TrailerReprocessSnapshot | null {
  const j = jobs.get(id)
  return j ? { ...j.snapshot, lines: [...j.snapshot.lines] } : null
}

export function subscribeTrailerReprocessJob(id: string, listener: Listener): (() => void) | null {
  const j = jobs.get(id)
  if (!j) return null
  j.listeners.add(listener)
  return () => {
    j.listeners.delete(listener)
  }
}

export function startTrailerReprocessFromConfig(
  config: Parameters<typeof getVideoMenuItems>[0],
  opts: { session: number; mainRel: string; projectRoot: string; trailerParams?: Partial<TrailerBatParams> },
): TrailerReprocessSnapshot {
  const menu = getVideoMenuItems(config)
  const resolved = resolveTrailerReprocessVideo(menu, opts.session, opts.mainRel)
  const trailerParams = normalizeTrailerBatParams(opts.trailerParams)
  return createTrailerReprocessJob({
    projectRoot: opts.projectRoot,
    ...resolved,
    trailerParams,
  })
}
