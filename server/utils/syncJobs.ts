import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { getVideoMenuItems } from './videoMenu'
import { runLibraryBatForLibrary, tailText, type LibraryBatKind } from './runLibraryBat'
import { writeSyncFailuresLog } from './syncFailuresLog'

export type SyncJobStatus = 'running' | 'done' | 'failed' | 'cancelled'
/** `'both'` = trailers para todas as sessões e depois previews para todas as sessões (em série). */
export type SyncJobKind = LibraryBatKind | 'both'

export interface SyncJobLine {
  /** Sequencial dentro do job; permite ao cliente filtrar `lines` já vistas. */
  seq: number
  at: number
  /** -1 = mensagens do orquestrador (ex.: "sessão N/M iniciada"); >=0 = sessão concreta. */
  session: number
  /** Em jobs `both`, identifica a fase (trailers/previews) a que pertence; -1 para meta agregadas. */
  phase: LibraryBatKind | 'meta'
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

export interface SyncJobSessionResult {
  /** Bat que correu para esta linha — em jobs `both` haverá duas linhas por sessão. */
  kind: LibraryBatKind
  session: number
  title: string
  path: string
  /** `null` enquanto a sessão está a correr ou ainda não começou. */
  exitCode: number | null
  startedCount: number
  okCount: number
  errCount: number
  error?: string
  /** stdout/stderr completos (com cap), gravados no fim — para inspecção retro. */
  stdoutTail?: string
  stderrTail?: string
  startedAt?: number
  endedAt?: number
  /** Ficheiros com linha `[ERRO]` nos .bat (último `[PROCESSANDO]` / `[PREVIEW]` antes do erro). */
  failedItems?: { file: string; message: string }[]
}

export interface SyncJobSnapshot {
  id: string
  /** Pedido pelo cliente: `'trailers'`, `'previews'` ou `'both'` (mistura de ambos). */
  kind: SyncJobKind
  all: boolean
  status: SyncJobStatus
  startedAt: number
  endedAt: number | null
  /** Número total de invocações de `.bat` (em jobs `both` é `2 * sessões`). */
  totalSessions: number
  currentSessionIndex: number
  totals: { started: number; ok: number; err: number }
  results: SyncJobSessionResult[]
  /** Últimas N linhas (cap = `LINE_RING_CAP`). Use `seq` para deduplicar. */
  lines: SyncJobLine[]
  /** Total de linhas alguma vez emitidas (>= lines.length se houve corte). */
  totalLines: number
  cancelRequested: boolean
}

export type JobEvent =
  | { type: 'line'; line: SyncJobLine }
  | { type: 'progress'; totals: SyncJobSnapshot['totals']; currentSessionIndex: number }
  | { type: 'session-start'; session: number; title: string; path: string }
  | { type: 'session-end'; session: number; result: SyncJobSessionResult }
  | { type: 'status'; status: SyncJobStatus }

type Listener = (ev: JobEvent) => void

const LINE_RING_CAP = 800
const STDOUT_TAIL_CAP = 12_000
const JOB_RETENTION_MS = 30 * 60_000

interface InternalJob {
  snapshot: SyncJobSnapshot
  listeners: Set<Listener>
  /** PID do `cmd.exe` da sessão actualmente a correr; `null` entre sessões. */
  currentPid: number | null
  /** Chamado pelo runner para verificar se deve abortar antes de avançar para a próxima sessão. */
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

function emit(job: InternalJob, ev: JobEvent) {
  for (const l of job.listeners) {
    try {
      l(ev)
    } catch {
      /* listener falhou — ignoramos para não derrubar o job */
    }
  }
}

function pushLine(
  job: InternalJob,
  session: number,
  phase: LibraryBatKind | 'meta',
  stream: SyncJobLine['stream'],
  text: string,
) {
  const seq = job.snapshot.totalLines + 1
  const line: SyncJobLine = { seq, at: Date.now(), session, phase, stream, text }
  job.snapshot.totalLines = seq
  job.snapshot.lines.push(line)
  if (job.snapshot.lines.length > LINE_RING_CAP) {
    job.snapshot.lines.splice(0, job.snapshot.lines.length - LINE_RING_CAP)
  }
  emit(job, { type: 'line', line })
}

function classifyTrailerLine(text: string): 'started' | 'ok' | 'err' | null {
  const t = text.trimStart()
  if (t.startsWith('[PROCESSANDO]')) return 'started'
  if (t.startsWith('[OK]')) return 'ok'
  if (t.startsWith('[ERRO]')) return 'err'
  return null
}

function setStatus(job: InternalJob, status: SyncJobStatus) {
  if (job.snapshot.status === status) return
  job.snapshot.status = status
  if (status !== 'running') {
    job.snapshot.endedAt = Date.now()
  }
  emit(job, { type: 'status', status })
}

function pushFailedItem(slot: SyncJobSessionResult, file: string, message: string) {
  if (!slot.failedItems) slot.failedItems = []
  slot.failedItems.push({ file: file.trim() || '(sem ficheiro)', message: message.trim() })
}

/** Captura `[PROCESSANDO] "f.ext"` / `[PREVIEW] "f.ext"` e associa a `[ERRO]` seguinte. */
function parseStdoutForSyncHints(
  text: string,
  slot: SyncJobSessionResult,
  stdoutSourceHintRef: { current: string },
) {
  const t = text.trimStart()
  const proc = /^\[(?:PROCESSANDO|PREVIEW)\]\s+"([^"]+)"/.exec(t)
  if (proc?.[1]) {
    stdoutSourceHintRef.current = proc[1]
    return
  }
  if (t.startsWith('[OK]')) {
    stdoutSourceHintRef.current = ''
    return
  }
  if (t.startsWith('[ERRO]')) {
    pushFailedItem(slot, stdoutSourceHintRef.current, t)
    stdoutSourceHintRef.current = ''
  }
}

async function persistSyncFailuresFile(job: InternalJob, projectRoot: string) {
  const items: {
    sessionIndex: number
    libraryTitle: string
    libraryPath: string
    phase: LibraryBatKind
    sourceFile: string
    detail: string
  }[] = []
  for (const r of job.snapshot.results) {
    if (!r.failedItems?.length) continue
    for (const fi of r.failedItems) {
      items.push({
        sessionIndex: r.session,
        libraryTitle: r.title,
        libraryPath: r.path,
        phase: r.kind,
        sourceFile: fi.file,
        detail: fi.message,
      })
    }
  }
  try {
    await writeSyncFailuresLog(projectRoot, {
      savedAt: new Date().toISOString(),
      jobId: job.snapshot.id,
      jobStatus: job.snapshot.status,
      items,
    })
  } catch {
    /* não impedir fecho do job */
  }
}

async function runJob(job: InternalJob, projectRoot: string) {
  try {
    const steps = job.snapshot.results
    for (let i = 0; i < steps.length; i++) {
      if (job.cancelRequested) {
        pushLine(job, -1, 'meta', 'meta', '[ABORTAR] sincronização cancelada pelo utilizador.')
        setStatus(job, 'cancelled')
        return
      }
      const stdoutSourceHintRef = { current: '' }
      const slot = steps[i]!
      if (slot.exitCode !== null) {
        // Já marcado como erro de validação (ex.: pasta não autorizada) — só faz progress.
        job.snapshot.currentSessionIndex = i
        emit(job, {
          type: 'progress',
          totals: { ...job.snapshot.totals },
          currentSessionIndex: i,
        })
        continue
      }
      job.snapshot.currentSessionIndex = i
      slot.startedAt = Date.now()
      emit(job, { type: 'session-start', session: slot.session, title: slot.title, path: slot.path })
      pushLine(
        job,
        -1,
        'meta',
        'meta',
        `[PASSO ${i + 1}/${steps.length}] ${slot.kind} · ${slot.title} → ${slot.path}`,
      )
      emit(job, {
        type: 'progress',
        totals: { ...job.snapshot.totals },
        currentSessionIndex: i,
      })

      try {
        const r = await runLibraryBatForLibrary({
          projectRoot,
          libraryRoot: slot.path,
          kind: slot.kind,
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
            pushLine(job, slot.session, slot.kind, stream, text)
            if (stream === 'stdout') {
              parseStdoutForSyncHints(text, slot, stdoutSourceHintRef)
              const cls = classifyTrailerLine(text)
              if (cls === 'started') {
                slot.startedCount++
                job.snapshot.totals.started++
                emit(job, {
                  type: 'progress',
                  totals: { ...job.snapshot.totals },
                  currentSessionIndex: i,
                })
              } else if (cls === 'ok') {
                slot.okCount++
                job.snapshot.totals.ok++
                emit(job, {
                  type: 'progress',
                  totals: { ...job.snapshot.totals },
                  currentSessionIndex: i,
                })
              } else if (cls === 'err') {
                slot.errCount++
                job.snapshot.totals.err++
                emit(job, {
                  type: 'progress',
                  totals: { ...job.snapshot.totals },
                  currentSessionIndex: i,
                })
              }
            }
          },
        })
        slot.exitCode = r.exitCode
        slot.stdoutTail = tailText(r.stdout, STDOUT_TAIL_CAP)
        slot.stderrTail = tailText(r.stderr, STDOUT_TAIL_CAP)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        slot.exitCode = -1
        slot.error = msg
        pushFailedItem(slot, '(excepção servidor)', `[FATAL] ${msg}`)
        pushLine(job, slot.session, slot.kind, 'stderr', `[FATAL] ${msg}`)
      } finally {
        slot.endedAt = Date.now()
        job.currentPid = null
        emit(job, { type: 'session-end', session: slot.session, result: { ...slot } })
        pushLine(
          job,
          -1,
          'meta',
          'meta',
          `[PASSO ${i + 1}/${steps.length}] ${slot.kind} terminou exitCode=${slot.exitCode} (ok=${slot.okCount}, err=${slot.errCount})`,
        )
      }
    }

    if (job.cancelRequested) {
      setStatus(job, 'cancelled')
      return
    }
    const anyOk = job.snapshot.results.some((r) => r.exitCode === 0)
    setStatus(job, anyOk ? 'done' : 'failed')
  } finally {
    await persistSyncFailuresFile(job, projectRoot)
  }
}

export interface CreateSyncJobOpts {
  kind: SyncJobKind
  projectRoot: string
  /** Sessões a sincronizar (índices). Em jobs `both`, cada sessão gera dois passos (trailer + preview). */
  sessions: number[]
  all: boolean
  /** Catálogo de bibliotecas (mesmo `getVideoMenuItems(config)`). */
  menu: ReturnType<typeof getVideoMenuItems>
}

export function createSyncJob(opts: CreateSyncJobOpts): SyncJobSnapshot {
  pruneOldJobs()
  const id = randomUUID()
  const allowed = new Set(opts.menu.map((e) => resolve(e.path.trim())))
  // Em `both`, corre primeiro TODOS os trailers e só depois TODOS os previews
  // (mesma ordem das sessões em ambas as fases).
  const phaseKinds: LibraryBatKind[] =
    opts.kind === 'both' ? ['trailers', 'previews'] : [opts.kind]
  const results: SyncJobSessionResult[] = []
  for (const phaseKind of phaseKinds) {
    for (const sIdx of opts.sessions) {
      const row = opts.menu[sIdx]
      if (!row) {
        results.push({
          kind: phaseKind,
          session: sIdx,
          title: '',
          path: '',
          exitCode: -1,
          startedCount: 0,
          okCount: 0,
          errCount: 0,
          error: 'Índice de sessão inválido.',
        })
        continue
      }
      const root = resolve(row.path.trim())
      if (!allowed.has(root)) {
        results.push({
          kind: phaseKind,
          session: sIdx,
          title: row.title,
          path: row.path,
          exitCode: -1,
          startedCount: 0,
          okCount: 0,
          errCount: 0,
          error: 'Pasta não autorizada.',
        })
        continue
      }
      results.push({
        kind: phaseKind,
        session: sIdx,
        title: row.title,
        path: row.path,
        exitCode: null,
        startedCount: 0,
        okCount: 0,
        errCount: 0,
      })
    }
  }
  const snapshot: SyncJobSnapshot = {
    id,
    kind: opts.kind,
    all: opts.all,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    totalSessions: results.length,
    currentSessionIndex: -1,
    totals: { started: 0, ok: 0, err: 0 },
    results,
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
  const scopeLabel = opts.all ? '(todas)' : `(sessão ${opts.sessions[0]})`
  const phaseLabel =
    opts.kind === 'both'
      ? `trailers + previews ${scopeLabel} – ${opts.sessions.length} biblioteca(s) × 2 fases (${results.length} passos)`
      : `${opts.kind} ${scopeLabel} – ${opts.sessions.length} biblioteca(s)`
  pushLine(internal, -1, 'meta', 'meta', `[INICIO] ${phaseLabel}`)
  // Dispara o runner em background — devolvemos imediatamente.
  void runJob(internal, opts.projectRoot).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    pushLine(internal, -1, 'meta', 'stderr', `[FATAL-RUNNER] ${msg}`)
    setStatus(internal, 'failed')
  })
  return snapshot
}

export function getJobSnapshot(id: string): SyncJobSnapshot | null {
  const j = jobs.get(id)
  return j ? { ...j.snapshot, cancelRequested: j.cancelRequested } : null
}

export function subscribeJob(id: string, listener: Listener): (() => void) | null {
  const j = jobs.get(id)
  if (!j) return null
  j.listeners.add(listener)
  return () => {
    j.listeners.delete(listener)
  }
}

export function cancelJob(id: string): boolean {
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

export function listRecentJobs(): SyncJobSnapshot[] {
  pruneOldJobs()
  return [...jobs.values()].map((j) => ({ ...j.snapshot }))
}

/** Job ainda em `running` neste processo Node (há no máximo um na prática). */
export function getRunningSyncJobSnapshot(): SyncJobSnapshot | null {
  pruneOldJobs()
  let best: InternalJob | null = null
  for (const j of jobs.values()) {
    if (j.snapshot.status !== 'running') continue
    if (!best || j.snapshot.startedAt > best.snapshot.startedAt) best = j
  }
  return best ? { ...best.snapshot, cancelRequested: best.cancelRequested } : null
}
