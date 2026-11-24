import {
  normalizeShrinkInPlaceParams,
  SHRINK_IN_PLACE_PARAMS_DEFAULT,
  type ShrinkInPlaceParams,
} from './shrinkInPlaceParams'
import {
  normalizeTrailerBatParams,
  TRAILER_BAT_PARAMS_DEFAULT,
  type TrailerBatParams,
} from './trailerParams'

export const INBOX_WORKER_DEFAULT_WATCH_PATH = 'H:\\temp\\note_h\\downloaded'

/** 700 MiB */
export const INBOX_WORKER_DEFAULT_SHRINK_MIN_BYTES = 700 * 1024 * 1024

export interface InboxWorkerSettings {
  enabled: boolean
  watchPath: string
  intervalMinutes: number
  runAutoTags: boolean
  runTrailer: boolean
  runShrink: boolean
  shrinkMinBytes: number
  shrinkParams: ShrinkInPlaceParams
  trailerParams: TrailerBatParams
}

export const INBOX_WORKER_SETTINGS_DEFAULT: InboxWorkerSettings = {
  enabled: false,
  watchPath: INBOX_WORKER_DEFAULT_WATCH_PATH,
  intervalMinutes: 15,
  runAutoTags: true,
  runTrailer: true,
  runShrink: true,
  shrinkMinBytes: INBOX_WORKER_DEFAULT_SHRINK_MIN_BYTES,
  shrinkParams: { ...SHRINK_IN_PLACE_PARAMS_DEFAULT },
  trailerParams: { ...TRAILER_BAT_PARAMS_DEFAULT },
}

export interface InboxWorkerLedgerEntry {
  size: number
  mtimeMs: number
  seenAt: number
  trailerEnqueued: boolean
  shrinkEnqueued: boolean
}

export interface InboxWorkerRunSummary {
  scanned: number
  newFiles: number
  trailersEnqueued: number
  shrinksEnqueued: number
  autoTagsRan: boolean
  autoTagsOk: boolean | null
}

export interface InboxWorkerState {
  files: Record<string, InboxWorkerLedgerEntry>
  lastRunAt: number | null
  lastError: string | null
  lastSummary: InboxWorkerRunSummary | null
}

export const INBOX_WORKER_STATE_DEFAULT: InboxWorkerState = {
  files: {},
  lastRunAt: null,
  lastError: null,
  lastSummary: null,
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase()
    if (t === '0' || t === 'false' || t === 'no' || t === 'off') return false
    if (t === '1' || t === 'true' || t === 'yes' || t === 'on') return true
  }
  return fallback
}

export function normalizeInboxWorkerSettings(
  raw?: Partial<InboxWorkerSettings> | Record<string, unknown> | null,
): InboxWorkerSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = INBOX_WORKER_SETTINGS_DEFAULT
  const watchPath =
    typeof src.watchPath === 'string' && src.watchPath.trim()
      ? src.watchPath.trim()
      : d.watchPath
  const shrinkMinMb =
    src.shrinkMinMb !== undefined && src.shrinkMinMb !== null
      ? clampNumber(src.shrinkMinMb, 1, 100_000, d.shrinkMinBytes / (1024 * 1024))
      : null
  const shrinkMinBytes =
    shrinkMinMb !== null
      ? Math.round(shrinkMinMb * 1024 * 1024)
      : Math.round(
          clampNumber(src.shrinkMinBytes, 1, 1024 * 1024 * 1024 * 100, d.shrinkMinBytes),
        )
  return {
    enabled: normalizeBoolean(src.enabled, d.enabled),
    watchPath,
    intervalMinutes: Math.round(clampNumber(src.intervalMinutes, 1, 1440, d.intervalMinutes)),
    runAutoTags: normalizeBoolean(src.runAutoTags, d.runAutoTags),
    runTrailer: normalizeBoolean(src.runTrailer, d.runTrailer),
    runShrink: normalizeBoolean(src.runShrink, d.runShrink),
    shrinkMinBytes,
    shrinkParams: normalizeShrinkInPlaceParams(
      (src.shrinkParams as Partial<ShrinkInPlaceParams>) ?? null,
    ),
    trailerParams: normalizeTrailerBatParams(
      (src.trailerParams as Partial<TrailerBatParams>) ?? null,
    ),
  }
}

export function normalizeInboxWorkerLedgerEntry(raw: unknown): InboxWorkerLedgerEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const size = Number(o.size)
  const mtimeMs = Number(o.mtimeMs)
  const seenAt = Number(o.seenAt)
  if (!Number.isFinite(size) || size < 0) return null
  if (!Number.isFinite(mtimeMs)) return null
  return {
    size,
    mtimeMs,
    seenAt: Number.isFinite(seenAt) ? seenAt : Date.now(),
    trailerEnqueued: normalizeBoolean(o.trailerEnqueued, false),
    shrinkEnqueued: normalizeBoolean(o.shrinkEnqueued, false),
  }
}

export function normalizeInboxWorkerRunSummary(raw: unknown): InboxWorkerRunSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    scanned: Math.max(0, Math.floor(Number(o.scanned) || 0)),
    newFiles: Math.max(0, Math.floor(Number(o.newFiles) || 0)),
    trailersEnqueued: Math.max(0, Math.floor(Number(o.trailersEnqueued) || 0)),
    shrinksEnqueued: Math.max(0, Math.floor(Number(o.shrinksEnqueued) || 0)),
    autoTagsRan: normalizeBoolean(o.autoTagsRan, false),
    autoTagsOk:
      o.autoTagsOk === null || o.autoTagsOk === undefined
        ? null
        : normalizeBoolean(o.autoTagsOk, false),
  }
}

export function normalizeInboxWorkerState(raw?: unknown): InboxWorkerState {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const filesRaw =
    src.files && typeof src.files === 'object' ? (src.files as Record<string, unknown>) : {}
  const files: Record<string, InboxWorkerLedgerEntry> = {}
  for (const [k, v] of Object.entries(filesRaw)) {
    const key = String(k ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!key) continue
    const entry = normalizeInboxWorkerLedgerEntry(v)
    if (entry) files[key] = entry
  }
  const lastRunAtRaw = Number(src.lastRunAt)
  return {
    files,
    lastRunAt: Number.isFinite(lastRunAtRaw) && lastRunAtRaw > 0 ? lastRunAtRaw : null,
    lastError: typeof src.lastError === 'string' && src.lastError.trim() ? src.lastError.trim() : null,
    lastSummary: normalizeInboxWorkerRunSummary(src.lastSummary),
  }
}
