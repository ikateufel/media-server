import { randomUUID } from 'node:crypto'
import {
  runAndStoreDuplicateScan,
  type DuplicateScanOptions,
  type DuplicateScanProgress,
  type StoredDuplicateScan,
} from './duplicateCandidates'

export type DupScanJobStatus = 'running' | 'done' | 'failed'

export type DupScanJobSnapshot = {
  id: string
  status: DupScanJobStatus
  startedAt: number
  endedAt: number | null
  progress: DuplicateScanProgress
  result: StoredDuplicateScan | null
  error: string | null
}

type InternalJob = {
  snap: DupScanJobSnapshot
}

const jobs = new Map<string, InternalJob>()
let activeJobId: string | null = null
const RETENTION_MS = 30 * 60_000

function pruneOldJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (job.snap.status === 'running') continue
    if (job.snap.endedAt && now - job.snap.endedAt > RETENTION_MS) jobs.delete(id)
  }
}

export function getDuplicateScanJob(jobId: string): DupScanJobSnapshot | null {
  pruneOldJobs()
  return jobs.get(jobId)?.snap ?? null
}

export function getActiveDuplicateScanJob(): DupScanJobSnapshot | null {
  if (!activeJobId) return null
  return jobs.get(activeJobId)?.snap ?? null
}

export function startDuplicateScanJob(opts: DuplicateScanOptions = {}): DupScanJobSnapshot {
  pruneOldJobs()
  if (activeJobId) {
    const cur = jobs.get(activeJobId)
    if (cur?.snap.status === 'running') return cur.snap
  }

  const id = randomUUID()
  const snap: DupScanJobSnapshot = {
    id,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    progress: { phase: 'load', pct: 0, message: 'A iniciar…' },
    result: null,
    error: null,
  }
  jobs.set(id, { snap })
  activeJobId = id

  void (async () => {
    try {
      const result = await runAndStoreDuplicateScan(opts, (progress) => {
        const job = jobs.get(id)
        if (!job || job.snap.status !== 'running') return
        job.snap.progress = progress
      })
      const job = jobs.get(id)
      if (!job) return
      job.snap.progress = {
        phase: 'done',
        pct: 100,
        message: `Concluído · ${result.groups.length} grupos · ${result.matchedPairs} pares`,
        scanned: result.scannedVideos,
        candidatePairs: result.candidatePairs,
        matchedPairs: result.matchedPairs,
      }
      job.snap.result = result
      job.snap.status = 'done'
      job.snap.endedAt = Date.now()
    } catch (e: unknown) {
      const job = jobs.get(id)
      if (!job) return
      const msg = e instanceof Error ? e.message : String(e)
      job.snap.status = 'failed'
      job.snap.error = msg
      job.snap.progress = { phase: 'error', pct: job.snap.progress.pct, message: msg }
      job.snap.endedAt = Date.now()
    } finally {
      if (activeJobId === id) activeJobId = null
    }
  })()

  return snap
}
