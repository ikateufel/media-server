import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  INBOX_WORKER_SETTINGS_DEFAULT,
  normalizeInboxWorkerSettings,
  normalizeInboxWorkerState,
  type InboxWorkerSettings,
  type InboxWorkerState,
} from '#shared/inboxWorkerSettings'

const SETTINGS_FILE = () => join(process.cwd(), 'data', 'inbox-worker-settings.json')
const STATE_FILE = () => join(process.cwd(), 'data', 'inbox-worker-state.json')

let settingsCache: InboxWorkerSettings | null = null
let stateCache: InboxWorkerState | null = null
let settingsLoadPromise: Promise<InboxWorkerSettings> | null = null
let stateLoadPromise: Promise<InboxWorkerState> | null = null

async function ensureDataDir(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true })
}

export async function loadInboxWorkerSettings(): Promise<InboxWorkerSettings> {
  if (settingsCache) return settingsCache
  if (settingsLoadPromise) return settingsLoadPromise
  settingsLoadPromise = (async () => {
    try {
      const raw = await readFile(SETTINGS_FILE(), 'utf8')
      settingsCache = normalizeInboxWorkerSettings(JSON.parse(raw) as Record<string, unknown>)
    } catch {
      settingsCache = { ...INBOX_WORKER_SETTINGS_DEFAULT }
    } finally {
      settingsLoadPromise = null
    }
    return settingsCache!
  })()
  return settingsLoadPromise
}

export async function saveInboxWorkerSettings(
  raw: Partial<InboxWorkerSettings> | Record<string, unknown> | null,
): Promise<InboxWorkerSettings> {
  const next = normalizeInboxWorkerSettings(raw)
  await ensureDataDir(SETTINGS_FILE())
  await writeFile(SETTINGS_FILE(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  settingsCache = next
  return next
}

export function getInboxWorkerSettingsCached(): InboxWorkerSettings {
  return settingsCache ?? { ...INBOX_WORKER_SETTINGS_DEFAULT }
}

export async function loadInboxWorkerState(): Promise<InboxWorkerState> {
  if (stateCache) return stateCache
  if (stateLoadPromise) return stateLoadPromise
  stateLoadPromise = (async () => {
    try {
      const raw = await readFile(STATE_FILE(), 'utf8')
      stateCache = normalizeInboxWorkerState(JSON.parse(raw))
    } catch {
      stateCache = {
        files: {},
        lastRunAt: null,
        lastError: null,
        lastSummary: null,
      }
    } finally {
      stateLoadPromise = null
    }
    return stateCache!
  })()
  return stateLoadPromise
}

export async function saveInboxWorkerState(state: InboxWorkerState): Promise<InboxWorkerState> {
  const next = normalizeInboxWorkerState(state)
  await ensureDataDir(STATE_FILE())
  await writeFile(STATE_FILE(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  stateCache = next
  return next
}

export function getInboxWorkerStateCached(): InboxWorkerState {
  return (
    stateCache ?? {
      files: {},
      lastRunAt: null,
      lastError: null,
      lastSummary: null,
    }
  )
}

/** Invalida cache de settings (após save externo). */
export function invalidateInboxWorkerSettingsCache() {
  settingsCache = null
}
