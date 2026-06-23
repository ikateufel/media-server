import { randomUUID } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { createError } from 'h3'
import { runShrinkBatForFile, type ShrinkCodec, type ShrinkSpeed } from './runShrinkBat'
import { logIfOutputLargerThanSource, oversizedOutputMessage, type OversizedOutputEntry } from './oversizedOutputLog'
import { tailText } from './runLibraryBat'
import { hasPathTraversal, resolveMediaFileUnderRoot } from './videoPaths'
import { isVideoFileName } from '#shared/videoExtensions'

export type ShrinkJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface ShrinkJobLine {
  seq: number
  at: number
  fileIndex: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

export interface ShrinkJobFileResult {
  rel: string
  path: string
  exitCode: number | null
  okCount: number
  errCount: number
  skipCount: number
  error?: string
  stdoutTail?: string
  stderrTail?: string
  startedAt?: number
  endedAt?: number
  failedItems?: { file: string; message: string }[]
  oversizedOutput?: OversizedOutputEntry
}

export interface ShrinkJobSnapshot {
  id: string
  status: ShrinkJobStatus
  sourceRoot: string
  height: number
  speed: ShrinkSpeed
  codec: ShrinkCodec
  force: boolean
  prioritizeSize: boolean
  startedAt: number
  endedAt: number | null
  totalFiles: number
  currentFileIndex: number
  totals: { ok: number; err: number; skip: number }
  results: ShrinkJobFileResult[]
  lines: ShrinkJobLine[]
  totalLines: number
  cancelRequested: boolean
  oversizedOutputs: OversizedOutputEntry[]
}

export type ShrinkJobEvent =
  | { type: 'line'; line: ShrinkJobLine }
  | { type: 'progress'; totals: ShrinkJobSnapshot['totals']; currentFileIndex: number }
  | { type: 'file-start'; fileIndex: number; rel: string; path: string }
  | { type: 'file-end'; fileIndex: number; result: ShrinkJobFileResult }
  | { type: 'status'; status: ShrinkJobStatus }

type Listener = (ev: ShrinkJobEvent) => void

const LINE_RING_CAP = 800
const STDOUT_TAIL_CAP = 12_000
const JOB_RETENTION_MS = 30 * 60_000

interface InternalJob {
  snapshot: ShrinkJobSnapshot
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

function emit(job: InternalJob, ev: ShrinkJobEvent) {
  for (const l of job.listeners) {
    try {
      l(ev)
    } catch {
      /* */
    }
  }
}

function pushLine(
  job: InternalJob,
  fileIndex: number,
  stream: ShrinkJobLine['stream'],
  text: string,
) {
  const seq = job.snapshot.totalLines + 1
  const line: ShrinkJobLine = { seq, at: Date.now(), fileIndex, stream, text }
  job.snapshot.totalLines = seq
  job.snapshot.lines.push(line)
  if (job.snapshot.lines.length > LINE_RING_CAP) {
    job.snapshot.lines.splice(0, job.snapshot.lines.length - LINE_RING_CAP)
  }
  emit(job, { type: 'line', line })
}

function setStatus(job: InternalJob, status: ShrinkJobStatus) {
  if (job.snapshot.status === status) return
  job.snapshot.status = status
  if (status !== 'running') job.snapshot.endedAt = Date.now()
  emit(job, { type: 'status', status })
}

function classifyShrinkLine(text: string): 'ok' | 'err' | 'skip' | null {
  const t = text.trimStart()
  if (t.startsWith('[OK]')) return 'ok'
  if (t.startsWith('[ERRO]')) return 'err'
  if (t.startsWith('[SKIP]')) return 'skip'
  return null
}

function extractShrinkErrorHint(stdout: string, stderr: string): string | null {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/)
  const parts: string[] = []
  let captureFfmpeg = false
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('[ERRO]')) {
      parts.push(t)
      captureFfmpeg = false
      continue
    }
    if (t.startsWith('[DET]')) {
      captureFfmpeg = true
      continue
    }
    if (captureFfmpeg && parts.length < 12) {
      parts.push(t)
    }
  }
  if (parts.length) return parts.slice(0, 10).join(' | ')
  const tail = (stderr || stdout).trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' | ')
  return tail || null
}

function pushFailedItem(slot: ShrinkJobFileResult, file: string, message: string) {
  if (!slot.failedItems) slot.failedItems = []
  slot.failedItems.push({ file: file.trim() || '(sem ficheiro)', message: message.trim() })
}

function parseStdoutHints(text: string, slot: ShrinkJobFileResult, hintRef: { current: string }) {
  const t = text.trimStart()
  const proc = /^\[PROCESSANDO\]\s+(.+)$/.exec(t)
  if (proc?.[1]) {
    hintRef.current = proc[1].trim()
    return
  }
  if (t.startsWith('[OK]') || t.startsWith('[SKIP]')) {
    hintRef.current = ''
    return
  }
  if (t.startsWith('[ERRO]')) {
    pushFailedItem(slot, hintRef.current || slot.rel, t)
    hintRef.current = ''
  }
}

export function normalizeShrinkSpeed(raw: unknown): ShrinkSpeed | null {
  const n = Number(raw)
  if (n === 1.25 || n === 1.5 || n === 2) return n
  return null
}

export function assertAllowedSourceRoot(sourceRoot: string, allowedRoots: string[]): string {
  const resolved = resolve(sourceRoot.trim())
  for (const root of allowedRoots) {
    const r = resolve(root.trim())
    if (resolved === r || resolved.startsWith(r + sep)) return resolved
  }
  throw createError({
    statusCode: 403,
    statusMessage: 'Pasta de origem fora das bibliotecas configuradas.',
  })
}

export async function resolveShrinkFiles(
  sourceRoot: string,
  files: string[],
): Promise<{ rel: string; path: string }[]> {
  const out: { rel: string; path: string }[] = []
  const seen = new Set<string>()
  for (const raw of files) {
    const rel = String(raw ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!rel || hasPathTraversal(rel)) {
      throw createError({ statusCode: 400, statusMessage: `Caminho inválido: ${raw}` })
    }
    if (!isVideoFileName(rel)) {
      throw createError({ statusCode: 400, statusMessage: `Extensão não suportada: ${rel}` })
    }
    const key = rel.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const resolved = await resolveMediaFileUnderRoot(sourceRoot, rel)
    out.push({ rel: resolved.rel, path: resolved.path })
  }
  if (!out.length) {
    throw createError({ statusCode: 400, statusMessage: 'Lista de ficheiros vazia.' })
  }
  return out
}

export async function validateShrinkFilesReport(
  sourceRoot: string,
  files: string[],
): Promise<{
  ok: { rel: string; path: string }[]
  failed: { rel: string; message: string }[]
}> {
  const ok: { rel: string; path: string }[] = []
  const failed: { rel: string; message: string }[] = []
  const seen = new Set<string>()

  for (const raw of files) {
    const rel = String(raw ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!rel) continue
    const key = rel.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    if (hasPathTraversal(rel)) {
      failed.push({ rel, message: 'Caminho inválido.' })
      continue
    }
    if (!isVideoFileName(rel)) {
      failed.push({ rel, message: 'Extensão não suportada.' })
      continue
    }

    try {
      const resolved = await resolveMediaFileUnderRoot(sourceRoot, rel)
      ok.push({ rel: resolved.rel, path: resolved.path })
    } catch (e: unknown) {
      const ex = e as { statusMessage?: string; message?: string }
      failed.push({
        rel,
        message: ex?.statusMessage || ex?.message || 'Ficheiro não encontrado.',
      })
    }
  }

  return { ok, failed }
}

async function runJob(job: InternalJob, projectRoot: string) {
  try {
    const steps = job.snapshot.results
    for (let i = 0; i < steps.length; i++) {
      if (job.cancelRequested) {
        pushLine(job, -1, 'meta', '[ABORTAR] shrink cancelado pelo utilizador.')
        setStatus(job, 'cancelled')
        return
      }

      const slot = steps[i]!
      if (slot.exitCode !== null) {
        job.snapshot.currentFileIndex = i
        emit(job, {
          type: 'progress',
          totals: { ...job.snapshot.totals },
          currentFileIndex: i,
        })
        continue
      }

      job.snapshot.currentFileIndex = i
      slot.startedAt = Date.now()
      emit(job, { type: 'file-start', fileIndex: i, rel: slot.rel, path: slot.path })
      pushLine(
        job,
        i,
        'meta',
        `[FICHEIRO ${i + 1}/${steps.length}] ${slot.rel}`,
      )
      emit(job, {
        type: 'progress',
        totals: { ...job.snapshot.totals },
        currentFileIndex: i,
      })

      const hintRef = { current: '' }
      try {
        const r = await runShrinkBatForFile({
          projectRoot,
          videoAbsolutePath: slot.path,
          height: job.snapshot.height,
          speed: job.snapshot.speed,
          codec: job.snapshot.codec,
          force: job.snapshot.force,
          prioritizeSize: job.snapshot.prioritizeSize,
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
          onLine: (stream, text) => {
            pushLine(job, i, stream, text)
            parseStdoutHints(text, slot, hintRef)
            const cls = classifyShrinkLine(text)
            if (cls === 'ok') {
              slot.okCount = 1
              job.snapshot.totals.ok++
            } else if (cls === 'err') {
              slot.errCount = 1
              job.snapshot.totals.err++
            } else if (cls === 'skip') {
              slot.skipCount = 1
              job.snapshot.totals.skip++
            }
            if (cls) {
              emit(job, {
                type: 'progress',
                totals: { ...job.snapshot.totals },
                currentFileIndex: i,
              })
            }
          },
        })
        slot.exitCode = r.exitCode
        slot.stdoutTail = tailText(r.stdout, STDOUT_TAIL_CAP)
        slot.stderrTail = tailText(r.stderr, STDOUT_TAIL_CAP)
        if (r.exitCode === 0 && slot.skipCount === 0) {
          const logged = await logIfOutputLargerThanSource({
            projectRoot,
            sourcePath: slot.path,
            outputSubdir: 'shrinked',
            tool: 'shrink',
            fileRel: slot.rel,
          })
          if (logged) {
            slot.oversizedOutput = logged
            job.snapshot.oversizedOutputs.push(logged)
            const msg = oversizedOutputMessage(logged)
            pushLine(job, i, 'meta', `[OVERSIZED] ${slot.rel} — ${msg}`)
            pushLine(job, i, 'stderr', `[AVISO] ${msg}`)
          }
        }
        if (slot.okCount === 0 && slot.errCount === 0 && slot.skipCount === 0) {
          if (r.exitCode === 0) {
            slot.okCount = 1
            job.snapshot.totals.ok++
          } else {
            slot.errCount = 1
            job.snapshot.totals.err++
            const errHint = extractShrinkErrorHint(r.stdout, r.stderr)
            pushFailedItem(slot, slot.rel, errHint || `[exit ${r.exitCode}]`)
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        slot.exitCode = -1
        slot.error = msg
        slot.errCount = 1
        job.snapshot.totals.err++
        pushFailedItem(slot, slot.rel, `[FATAL] ${msg}`)
        pushLine(job, i, 'stderr', `[FATAL] ${msg}`)
      } finally {
        slot.endedAt = Date.now()
        job.currentPid = null
        emit(job, { type: 'file-end', fileIndex: i, result: { ...slot } })
        pushLine(
          job,
          -1,
          'meta',
          `[FICHEIRO ${i + 1}/${steps.length}] terminou exitCode=${slot.exitCode} (ok=${slot.okCount}, skip=${slot.skipCount}, err=${slot.errCount})`,
        )
      }
    }

    if (job.cancelRequested) {
      setStatus(job, 'cancelled')
      return
    }
    const anyOk = job.snapshot.results.some((r) => r.exitCode === 0 || r.skipCount > 0)
    setStatus(job, anyOk ? 'done' : 'failed')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    pushLine(job, -1, 'stderr', `[FATAL-RUNNER] ${msg}`)
    setStatus(job, 'failed')
  }
}

export interface CreateShrinkJobOpts {
  projectRoot: string
  sourceRoot: string
  files: { rel: string; path: string }[]
  height: number
  speed: ShrinkSpeed
  codec: ShrinkCodec
  force: boolean
  prioritizeSize: boolean
}

export function createShrinkJob(opts: CreateShrinkJobOpts): ShrinkJobSnapshot {
  pruneOldJobs()
  const id = randomUUID()
  const results: ShrinkJobFileResult[] = opts.files.map((f) => ({
    rel: f.rel,
    path: f.path,
    exitCode: null,
    okCount: 0,
    errCount: 0,
    skipCount: 0,
  }))
  const snapshot: ShrinkJobSnapshot = {
    id,
    status: 'running',
    sourceRoot: opts.sourceRoot,
    height: opts.height,
    speed: opts.speed,
    codec: opts.codec,
    force: opts.force,
    prioritizeSize: opts.prioritizeSize,
    startedAt: Date.now(),
    endedAt: null,
    totalFiles: results.length,
    currentFileIndex: -1,
    totals: { ok: 0, err: 0, skip: 0 },
    results,
    lines: [],
    totalLines: 0,
    cancelRequested: false,
    oversizedOutputs: [],
  }
  const internal: InternalJob = {
    snapshot,
    listeners: new Set(),
    currentPid: null,
    cancelRequested: false,
  }
  jobs.set(id, internal)
  pushLine(
    internal,
    -1,
    'meta',
    `[INICIO] shrink ${results.length} ficheiro(s) · ${opts.speed}x · altura ${opts.height}px · codec ${opts.codec}${opts.prioritizeSize ? ' · priorizar tamanho' : ''} · origem ${opts.sourceRoot}`,
  )
  void runJob(internal, opts.projectRoot)
  return snapshot
}

export function getShrinkJobSnapshot(id: string): ShrinkJobSnapshot | null {
  const j = jobs.get(id)
  return j ? { ...j.snapshot, cancelRequested: j.cancelRequested } : null
}

export function subscribeShrinkJob(id: string, listener: Listener): (() => void) | null {
  const j = jobs.get(id)
  if (!j) return null
  j.listeners.add(listener)
  return () => {
    j.listeners.delete(listener)
  }
}

export function cancelShrinkJob(id: string): boolean {
  const j = jobs.get(id)
  if (!j) return false
  if (j.snapshot.status !== 'running') return false
  j.cancelRequested = true
  j.snapshot.cancelRequested = true
  pushLine(j, -1, 'meta', '[CANCELAR] pedido recebido — a tentar matar processo actual.')
  if (j.currentPid != null) {
    try {
      process.kill(j.currentPid)
    } catch {
      /* */
    }
  }
  return true
}

export function listRecentShrinkJobs(): ShrinkJobSnapshot[] {
  pruneOldJobs()
  return [...jobs.values()].map((j) => ({ ...j.snapshot }))
}

export function getRunningShrinkJobSnapshot(): ShrinkJobSnapshot | null {
  pruneOldJobs()
  let best: InternalJob | null = null
  for (const j of jobs.values()) {
    if (j.snapshot.status !== 'running') continue
    if (!best || j.snapshot.startedAt > best.snapshot.startedAt) best = j
  }
  return best ? { ...best.snapshot, cancelRequested: best.cancelRequested } : null
}
