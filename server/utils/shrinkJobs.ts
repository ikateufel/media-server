import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createError } from 'h3'
import { runShrinkBatForFile, type ShrinkCodec, type ShrinkSpeed } from './runShrinkBat'
import { logIfOutputLargerThanSource, logShrinkBitrateRetry, oversizedOutputMessage, type OversizedOutputEntry } from './oversizedOutputLog'
import { logShrinkPhaseRun } from './shrinkPhaseRunLog'
import { logShrinkMultipassEntry } from './shrinkMultipassLog'
import { assessShrinkSourceFile } from './shrinkSourceProbe'
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
  bitrateRetry?: boolean
  phase2Run?: boolean
  phase3Run?: boolean
  insufficientListed?: boolean
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
  minSizeMb?: number
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

function classifyShrinkLine(text: string): 'ok' | 'err' | 'skip' | 'oversized' | null {
  const t = text.trimStart()
  if (/^\[OK\](\s|$)/.test(t)) return 'ok'
  if (t.startsWith('[ERRO]')) return 'err'
  if (t.startsWith('[SKIP]')) return 'skip'
  if (t.startsWith('[OVERSIZED]')) return 'oversized'
  return null
}

function recomputeShrinkTotals(results: ShrinkJobFileResult[]): ShrinkJobSnapshot['totals'] {
  let ok = 0
  let err = 0
  let skip = 0
  for (const r of results) {
    if (r.okCount > 0) ok++
    else if (r.errCount > 0) err++
    else if (r.skipCount > 0) skip++
  }
  return { ok, err, skip }
}

function applyShrinkLineClass(
  slot: ShrinkJobFileResult,
  cls: 'ok' | 'err' | 'skip' | 'oversized',
): boolean {
  if (cls === 'oversized') {
    if (slot.oversizedOutput) return false
    return true
  }
  if (cls === 'ok') {
    if (slot.okCount > 0 || slot.oversizedOutput) return false
    slot.okCount = 1
    return true
  }
  if (cls === 'err') {
    if (slot.errCount > 0) return false
    slot.errCount = 1
    return true
  }
  if (slot.skipCount > 0) return false
  slot.skipCount = 1
  return true
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

function parseStdoutHints(
  text: string,
  slot: ShrinkJobFileResult,
  hintRef: { current: string },
  ctx?: { projectRoot: string; sourceRoot: string },
) {
  const t = text.trimStart()
  const insList = /^\[INSUFFICIENT-LIST\]\s+([23])\|([^|]+)(?:\|(\d+)\|(\d+)\|(\d+))?\s*$/.exec(t)
  if (insList && ctx && !slot.insufficientListed) {
    slot.insufficientListed = true
    const phase = Number(insList[1]) as 2 | 3
    const fileRel = insList[2]!.trim()
    const sourceBytes = insList[3] ? Number(insList[3]) : undefined
    const outputBytes = insList[4] ? Number(insList[4]) : undefined
    const pctOfOrig = insList[5] ? Number(insList[5]) : undefined
    void logShrinkMultipassEntry({
      projectRoot: ctx.projectRoot,
      sourceRoot: ctx.sourceRoot,
      fileRel,
      phase,
      sourceBytes,
      outputBytes,
      pctOfOrig,
    }).catch(() => {})
    return
  }
  if (t.startsWith('[PHASE2]') || t.startsWith('[RETRY] reducao insuficiente')) {
    if (!slot.phase2Run && ctx) {
      void logShrinkPhaseRun({
        projectRoot: ctx.projectRoot,
        phase: 2,
        sourcePath: slot.path,
        fileRel: slot.rel,
        sourceRoot: ctx.sourceRoot,
        note: t.slice(0, 200),
      }).catch(() => {})
    }
    slot.phase2Run = true
    return
  }
  if (t.startsWith('[PHASE3]') || t.startsWith('[RETRY] saida maior que origem')) {
    if (!slot.phase3Run && ctx) {
      void logShrinkPhaseRun({
        projectRoot: ctx.projectRoot,
        phase: 3,
        sourcePath: slot.path,
        fileRel: slot.rel,
        sourceRoot: ctx.sourceRoot,
        note: t.slice(0, 200),
      }).catch(() => {})
    }
    slot.phase3Run = true
    slot.bitrateRetry = true
    return
  }
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

export function normalizeMinSizeMb(raw: unknown): number {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

export function minSizeMbToBytes(mb: number): number {
  const m = normalizeMinSizeMb(mb)
  if (m <= 0) return 0
  return m * 1024 * 1024
}

export function formatShrinkBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function minSizeSkipMessage(sizeBytes: number, minSizeBytes: number): string {
  return `Abaixo do mínimo (${formatShrinkBytes(sizeBytes)} < ${formatShrinkBytes(minSizeBytes)})`
}

export async function assertAllowedSourceRoot(sourceRoot: string): Promise<string> {
  const raw = sourceRoot.trim()
  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "sourceRoot" obrigatório.' })
  }
  const resolved = resolve(raw)
  let st
  try {
    st = await stat(resolved)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: `Pasta de origem inexistente: ${resolved}`,
    })
  }
  if (!st.isDirectory()) {
    throw createError({
      statusCode: 400,
      statusMessage: `Pasta de origem não é um diretório: ${resolved}`,
    })
  }
  return resolved
}

export async function resolveShrinkFiles(
  sourceRoot: string,
  files: string[],
): Promise<{ rel: string; path: string }[]> {
  const out: { rel: string; path: string }[] = []
  const seenRel = new Set<string>()
  const seenPath = new Set<string>()
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
    const relKey = rel.toLowerCase()
    if (seenRel.has(relKey)) continue
    seenRel.add(relKey)
    const resolved = await resolveMediaFileUnderRoot(sourceRoot, rel)
    const pathKey = resolved.path.toLowerCase()
    if (seenPath.has(pathKey)) continue
    seenPath.add(pathKey)
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
  minSizeBytes = 0,
): Promise<{
  ok: { rel: string; path: string }[]
  failed: { rel: string; message: string }[]
  skipped: { rel: string; message: string }[]
}> {
  const ok: { rel: string; path: string }[] = []
  const failed: { rel: string; message: string }[] = []
  const skipped: { rel: string; message: string }[] = []
  const seenRel = new Set<string>()
  const seenPath = new Set<string>()

  for (const raw of files) {
    const rel = String(raw ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!rel) continue
    const relKey = rel.toLowerCase()
    if (seenRel.has(relKey)) continue
    seenRel.add(relKey)

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
      const pathKey = resolved.path.toLowerCase()
      if (seenPath.has(pathKey)) {
        failed.push({ rel, message: 'Duplicado — mesmo ficheiro que outra entrada na fila.' })
        continue
      }
      seenPath.add(pathKey)
      if (minSizeBytes > 0) {
        const st = await stat(resolved.path)
        if (st.size < minSizeBytes) {
          skipped.push({
            rel: resolved.rel,
            message: minSizeSkipMessage(st.size, minSizeBytes),
          })
          continue
        }
      }
      const codecCheck = await assessShrinkSourceFile(resolved.path)
      if (!codecCheck.ok) {
        failed.push({ rel: resolved.rel, message: codecCheck.message })
        continue
      }
      ok.push({ rel: resolved.rel, path: resolved.path })
    } catch (e: unknown) {
      const ex = e as { statusMessage?: string; message?: string }
      failed.push({
        rel,
        message: ex?.statusMessage || ex?.message || 'Ficheiro não encontrado.',
      })
    }
  }

  return { ok, failed, skipped }
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
        const minBytes = minSizeMbToBytes(job.snapshot.minSizeMb ?? 0)
        if (minBytes > 0) {
          const st = await stat(slot.path)
          if (st.size < minBytes) {
            slot.exitCode = 0
            slot.skipCount = 1
            const skipMsg = minSizeSkipMessage(st.size, minBytes)
            pushLine(job, i, 'stdout', `[SKIP] ${skipMsg}`)
            pushLine(job, i, 'meta', `[SKIP-MINSIZE] ${slot.rel}`)
            slot.endedAt = Date.now()
            job.snapshot.totals = recomputeShrinkTotals(job.snapshot.results)
            emit(job, {
              type: 'progress',
              totals: { ...job.snapshot.totals },
              currentFileIndex: i,
            })
            emit(job, { type: 'file-end', fileIndex: i, result: { ...slot } })
            pushLine(
              job,
              -1,
              'meta',
              `[FICHEIRO ${i + 1}/${steps.length}] terminou exitCode=0 (ok=${slot.okCount}, skip=${slot.skipCount}, err=${slot.errCount})`,
            )
            continue
          }
        }

        const codecCheck = await assessShrinkSourceFile(slot.path)
        if (!codecCheck.ok) {
          slot.exitCode = 0
          slot.skipCount = 1
          pushLine(job, i, 'stdout', `[SKIP] ${codecCheck.message}`)
          pushLine(job, i, 'meta', `[SKIP-CODEC] ${slot.rel} — ${codecCheck.codec || '?'}`)
          slot.endedAt = Date.now()
          job.snapshot.totals = recomputeShrinkTotals(job.snapshot.results)
          emit(job, {
            type: 'progress',
            totals: { ...job.snapshot.totals },
            currentFileIndex: i,
          })
          emit(job, { type: 'file-end', fileIndex: i, result: { ...slot } })
          pushLine(
            job,
            -1,
            'meta',
            `[FICHEIRO ${i + 1}/${steps.length}] terminou exitCode=0 (ok=${slot.okCount}, skip=${slot.skipCount}, err=${slot.errCount})`,
          )
          continue
        }

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
            parseStdoutHints(text, slot, hintRef, { projectRoot, sourceRoot: job.snapshot.sourceRoot })
            const cls = classifyShrinkLine(text)
            if (cls && applyShrinkLineClass(slot, cls)) {
              job.snapshot.totals = recomputeShrinkTotals(job.snapshot.results)
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
        if (slot.phase3Run && r.exitCode === 0) {
          try {
            const [srcSt, outSt] = await Promise.all([
              stat(slot.path),
              stat(join(dirname(slot.path), 'shrinked', `${basename(slot.path, extname(slot.path))}.mp4`)),
            ])
            await logShrinkBitrateRetry({
              projectRoot,
              sourcePath: slot.path,
              fileRel: slot.rel,
              sourceBytes: srcSt.size,
              outputBytes: outSt.size,
            })
            pushLine(job, i, 'meta', `[PHASE3-LIST] ${slot.rel} — data/shrink-phase3-run-*.txt`)
          } catch {
            /* */
          }
        } else if (slot.phase2Run && r.exitCode === 0) {
          pushLine(job, i, 'meta', `[PHASE2-LIST] ${slot.rel} — data/shrink-phase2-run-*.txt`)
        }
        if (r.exitCode === 0 && slot.skipCount === 0 && job.snapshot.prioritizeSize) {
          const logged = await logIfOutputLargerThanSource({
            projectRoot,
            sourcePath: slot.path,
            outputSubdir: 'shrinked',
            tool: 'shrink',
            fileRel: slot.rel,
          })
          if (logged) {
            slot.oversizedOutput = logged
            slot.okCount = 0
            job.snapshot.oversizedOutputs.push(logged)
            const msg = oversizedOutputMessage(logged)
            pushLine(job, i, 'meta', `[OVERSIZED] ${slot.rel} — ${msg}`)
            pushLine(job, i, 'stderr', `[AVISO] ${msg} — registado; a seguir para o próximo.`)
            job.snapshot.totals = recomputeShrinkTotals(job.snapshot.results)
          }
        }
        if (slot.okCount === 0 && slot.errCount === 0 && slot.skipCount === 0 && !slot.oversizedOutput) {
          if (r.exitCode === 0) {
            slot.okCount = 1
          } else {
            slot.errCount = 1
            const errHint = extractShrinkErrorHint(r.stdout, r.stderr)
            pushFailedItem(slot, slot.rel, errHint || `[exit ${r.exitCode}]`)
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        slot.exitCode = -1
        slot.error = msg
        if (slot.errCount === 0) slot.errCount = 1
        pushFailedItem(slot, slot.rel, `[FATAL] ${msg}`)
        pushLine(job, i, 'stderr', `[FATAL] ${msg}`)
      } finally {
        slot.endedAt = Date.now()
        job.currentPid = null
        job.snapshot.totals = recomputeShrinkTotals(job.snapshot.results)
        emit(job, {
          type: 'progress',
          totals: { ...job.snapshot.totals },
          currentFileIndex: i,
        })
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
  minSizeMb?: number
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
    minSizeMb: normalizeMinSizeMb(opts.minSizeMb ?? 0),
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
    `[INICIO] shrink ${results.length} ficheiro(s) · ${opts.speed}x · altura ${opts.height}px · codec ${opts.codec}${opts.prioritizeSize ? ' · priorizar tamanho' : ''}${snapshot.minSizeMb > 0 ? ` · ignorar < ${snapshot.minSizeMb} MB` : ''} · origem ${opts.sourceRoot}`,
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
