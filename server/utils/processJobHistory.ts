import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ProcessJobKind = 'shrink' | 'trailer'
export type ProcessJobHistoryStatus = 'done' | 'failed'

export interface ProcessJobHistoryEntry {
  id: string
  kind: ProcessJobKind
  status: ProcessJobHistoryStatus
  session: number
  mainRel: string
  trailerRel?: string
  label: string
  error?: string
  startedAt: number
  endedAt: number
  jobId?: string
  log?: string
}

const HISTORY_FILE = () => join(process.cwd(), 'data', 'process-job-history.json')
const HISTORY_MAX = 500
const HISTORY_LOG_MAX_CHARS = 48_000
const HISTORY_LOG_MAX_LINES = 150

export function truncateProcessJobLog(raw: string | string[] | null | undefined): string | undefined {
  if (raw == null) return undefined
  const text = Array.isArray(raw)
    ? raw.map((l) => String(l ?? '').trimEnd()).filter(Boolean).join('\n')
    : String(raw)
  if (!text.trim()) return undefined
  let lines = text.replace(/\r/g, '').split('\n')
  if (lines.length > HISTORY_LOG_MAX_LINES) {
    lines = lines.slice(-HISTORY_LOG_MAX_LINES)
  }
  let out = lines.join('\n')
  if (out.length > HISTORY_LOG_MAX_CHARS) {
    out = out.slice(-HISTORY_LOG_MAX_CHARS)
  }
  return out.trim() || undefined
}

interface HistoryFileShape {
  items?: unknown
}

function parseEntry(raw: unknown): ProcessJobHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const kind = o.kind === 'shrink' || o.kind === 'trailer' ? o.kind : null
  const status = o.status === 'done' || o.status === 'failed' ? o.status : null
  const session = Number(o.session)
  const mainRel = typeof o.mainRel === 'string' ? o.mainRel.trim() : ''
  const label = typeof o.label === 'string' ? o.label.trim() : mainRel
  const startedAt = Number(o.startedAt)
  const endedAt = Number(o.endedAt)
  if (!id || !kind || !status || !mainRel) return null
  if (!Number.isFinite(session) || session < 0) return null
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null
  const entry: ProcessJobHistoryEntry = {
    id,
    kind,
    status,
    session: Math.floor(session),
    mainRel,
    label: label || mainRel,
    startedAt,
    endedAt,
  }
  const trailerRel = typeof o.trailerRel === 'string' ? o.trailerRel.trim().replace(/\\/g, '/') : ''
  if (trailerRel) entry.trailerRel = trailerRel
  if (typeof o.error === 'string' && o.error.trim()) entry.error = o.error.trim()
  if (typeof o.jobId === 'string' && o.jobId.trim()) entry.jobId = o.jobId.trim()
  const log = truncateProcessJobLog(typeof o.log === 'string' ? o.log : undefined)
  if (log) entry.log = log
  return entry
}

async function readAll(): Promise<ProcessJobHistoryEntry[]> {
  try {
    const raw = await readFile(HISTORY_FILE(), 'utf8')
    const parsed = JSON.parse(raw) as HistoryFileShape
    const rows = Array.isArray(parsed.items) ? parsed.items : []
    const out: ProcessJobHistoryEntry[] = []
    for (const row of rows) {
      const e = parseEntry(row)
      if (e) out.push(e)
    }
    return out
  } catch {
    return []
  }
}

async function writeAll(items: ProcessJobHistoryEntry[]) {
  await mkdir(join(process.cwd(), 'data'), { recursive: true })
  const capped = items
    .slice()
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, HISTORY_MAX)
  await writeFile(HISTORY_FILE(), JSON.stringify({ items: capped }, null, 2), 'utf8')
}

export async function appendProcessJobHistory(
  entry: Omit<ProcessJobHistoryEntry, 'id'> & { id?: string },
): Promise<void> {
  const items = await readAll()
  const id =
    typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : `${entry.kind}-${entry.endedAt}-${Math.random().toString(36).slice(2, 9)}`
  if (items.some((i) => i.id === id || (i.jobId && entry.jobId && i.jobId === entry.jobId))) {
    return
  }
  items.unshift({
    id,
    kind: entry.kind,
    status: entry.status,
    session: entry.session,
    mainRel: entry.mainRel,
    label: entry.label,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    ...(entry.trailerRel ? { trailerRel: entry.trailerRel } : {}),
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.jobId ? { jobId: entry.jobId } : {}),
    ...(() => {
      const log = truncateProcessJobLog(entry.log)
      return log ? { log } : {}
    })(),
  })
  await writeAll(items)
}

export async function readProcessJobHistory(opts?: {
  kind?: ProcessJobKind | 'all'
  limit?: number
}): Promise<ProcessJobHistoryEntry[]> {
  const kind = opts?.kind ?? 'all'
  const limitRaw = Number(opts?.limit ?? 200)
  const limit = Number.isFinite(limitRaw)
    ? Math.min(HISTORY_MAX, Math.max(1, Math.floor(limitRaw)))
    : 200
  let items = await readAll()
  if (kind === 'shrink' || kind === 'trailer') {
    items = items.filter((i) => i.kind === kind)
  }
  return items.slice(0, limit)
}

function normRel(rel: string): string {
  return String(rel ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .toLowerCase()
}

function baseName(rel: string): string {
  const n = normRel(rel)
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(i + 1) : n
}

/** Último shrink in-place com sucesso para este título (histórico permanente). */
export async function findSuccessfulShrinkHistory(
  session: number,
  mainRel: string,
): Promise<ProcessJobHistoryEntry | null> {
  const s = Math.floor(session)
  if (!Number.isFinite(s) || s < 0) return null
  const want = normRel(mainRel)
  if (!want) return null
  const wantBase = baseName(want)
  const items = await readProcessJobHistory({ kind: 'shrink', limit: HISTORY_MAX })
  for (const e of items) {
    if (e.status !== 'done' || e.session !== s) continue
    const got = normRel(e.mainRel)
    if (got === want || baseName(got) === wantBase) return e
  }
  return null
}
