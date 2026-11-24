import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { isVideoFileName } from '#shared/videoExtensions'
import type {
  InboxWorkerLedgerEntry,
  InboxWorkerRunSummary,
  InboxWorkerSettings,
} from '#shared/inboxWorkerSettings'
import { runAutoTagsPipeline } from './autoTagsPipeline'
import {
  getInboxWorkerSettingsCached,
  getInboxWorkerStateCached,
  loadInboxWorkerSettings,
  loadInboxWorkerState,
  saveInboxWorkerSettings,
  saveInboxWorkerState,
} from './inboxWorkerStore'
import { enqueueShrinkInPlaceQueueItem } from './shrinkInPlaceQueue'
import { enqueueTrailerReprocessQueueItem } from './trailerReprocessQueue'
import { getVideoMenuRowsForCli, type VideoMenuItem } from './videoMenu'

const SKIP_DIR_NAMES = new Set([
  'trailers',
  'preview',
  'shrinked',
  'edited',
  '.thumb_cache',
  'node_modules',
  '$recycle.bin',
  'system volume information',
])

export interface InboxWorkerPublicStatus {
  settings: InboxWorkerSettings
  busy: boolean
  schedulerActive: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  lastError: string | null
  lastSummary: InboxWorkerRunSummary | null
  platform: string
  windowsOnly: boolean
  session: number | null
  sessionTitle: string | null
  ledgerFileCount: number
}

type SchedulerRuntime = {
  timer: ReturnType<typeof setInterval> | null
  nextRunAt: number | null
  tickInFlight: boolean
}

const g = globalThis as typeof globalThis & { __vpInboxWorker?: SchedulerRuntime }

function runtime(): SchedulerRuntime {
  if (!g.__vpInboxWorker) {
    g.__vpInboxWorker = {
      timer: null,
      nextRunAt: null,
      tickInFlight: false,
    }
  }
  return g.__vpInboxWorker
}

function normalizeMainRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '')
}

function pathsEqual(a: string, b: string): boolean {
  return resolve(a.trim()).toLowerCase() === resolve(b.trim()).toLowerCase()
}

export function resolveInboxWorkerSession(
  watchPath: string,
  items?: VideoMenuItem[],
): { session: number; item: VideoMenuItem } {
  const menu = items?.length ? items : getVideoMenuRowsForCli()
  if (!menu.length) {
    throw new Error('Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).')
  }
  const idx = menu.findIndex((it) => pathsEqual(it.path, watchPath))
  if (idx < 0) {
    throw new Error(
      `Pasta de watch não corresponde a nenhuma biblioteca do menu: ${watchPath.trim()}`,
    )
  }
  return { session: idx, item: menu[idx]! }
}

function shouldSkipDirName(name: string): boolean {
  if (name.startsWith('.')) return true
  if (name.toUpperCase().startsWith('._')) return true
  return SKIP_DIR_NAMES.has(name.toLowerCase())
}

function shouldSkipVideoName(name: string): boolean {
  if (name.startsWith('.')) return true
  if (name.toLowerCase().startsWith('zz_')) return true
  return !isVideoFileName(name)
}

async function scanVideosRecursive(
  rootAbs: string,
  dirAbs: string,
  out: { mainRel: string; abs: string; size: number; mtimeMs: number }[],
): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dirAbs, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const name = e.name
    const abs = join(dirAbs, name)
    if (e.isDirectory()) {
      if (shouldSkipDirName(name)) continue
      await scanVideosRecursive(rootAbs, abs, out)
      continue
    }
    if (!e.isFile() || shouldSkipVideoName(name)) continue
    try {
      const st = await stat(abs)
      if (!st.isFile()) continue
      const mainRel = normalizeMainRel(relative(rootAbs, abs))
      if (!mainRel || mainRel.startsWith('..')) continue
      out.push({
        mainRel,
        abs,
        size: st.size,
        mtimeMs: st.mtimeMs,
      })
    } catch {
      /* */
    }
  }
}

function catalogTrailerRel(mainRel: string): string {
  const norm = normalizeMainRel(mainRel)
  const stem = basename(norm, extname(norm))
  const parent = dirname(norm).replace(/\\/g, '/')
  if (!parent || parent === '.') return `trailers/${stem}.mp4`
  return `trailers/${parent}/${stem}.mp4`
}

function trailerExistsForVideo(rootAbs: string, videoAbs: string, mainRel: string): boolean {
  const stem = basename(videoAbs, extname(videoAbs))
  const beside = join(dirname(videoAbs), 'trailers', `${stem}.mp4`)
  if (existsSync(beside)) return true
  const catalog = join(rootAbs, ...catalogTrailerRel(mainRel).split('/'))
  if (existsSync(catalog)) return true
  const rootFlat = join(rootAbs, 'trailers', `${stem}.mp4`)
  return existsSync(rootFlat)
}

function emptySummary(): InboxWorkerRunSummary {
  return {
    scanned: 0,
    newFiles: 0,
    trailersEnqueued: 0,
    shrinksEnqueued: 0,
    autoTagsRan: false,
    autoTagsOk: null,
  }
}

/**
 * Um ciclo do inbox worker. Com `force`, corre mesmo se `enabled` for false (botão Correr agora).
 */
export async function runInboxWorkerTick(opts?: {
  force?: boolean
}): Promise<InboxWorkerPublicStatus> {
  const rt = runtime()
  if (rt.tickInFlight) {
    return getInboxWorkerPublicStatus()
  }
  rt.tickInFlight = true
  const summary = emptySummary()
  let lastError: string | null = null

  try {
    const settings = await loadInboxWorkerSettings()
    if (!opts?.force && !settings.enabled) {
      return getInboxWorkerPublicStatus()
    }
    if (process.platform !== 'win32') {
      lastError = 'Inbox worker só corre em Windows (trailer.bat / shrink).'
      const state = await loadInboxWorkerState()
      state.lastRunAt = Date.now()
      state.lastError = lastError
      state.lastSummary = summary
      await saveInboxWorkerState(state)
      return getInboxWorkerPublicStatus()
    }

    const { session, item } = resolveInboxWorkerSession(settings.watchPath)
    const rootAbs = resolve(item.path.trim())
    if (!existsSync(rootAbs)) {
      throw new Error(`Pasta da biblioteca inexistente: ${rootAbs}`)
    }

    const found: { mainRel: string; abs: string; size: number; mtimeMs: number }[] = []
    await scanVideosRecursive(rootAbs, rootAbs, found)
    summary.scanned = found.length

    const state = await loadInboxWorkerState()
    const now = Date.now()
    let hadBrandNew = false

    for (const file of found) {
      const prev = state.files[file.mainRel]
      const same =
        prev &&
        prev.size === file.size &&
        Math.abs(prev.mtimeMs - file.mtimeMs) < 1
      if (same) continue

      const isBrandNew = !prev
      if (isBrandNew) hadBrandNew = true
      summary.newFiles++

      let trailerEnqueued = Boolean(prev?.trailerEnqueued)
      let shrinkEnqueued = Boolean(prev?.shrinkEnqueued)

      if (settings.runTrailer && !trailerExistsForVideo(rootAbs, file.abs, file.mainRel)) {
        try {
          await enqueueTrailerReprocessQueueItem({
            session,
            mainRel: file.mainRel,
            trailerRel: catalogTrailerRel(file.mainRel),
            label: basename(file.mainRel),
            params: settings.trailerParams,
          })
          trailerEnqueued = true
          summary.trailersEnqueued++
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          if (/já está na fila/i.test(msg)) {
            trailerEnqueued = true
          } else {
            lastError = `Trailer ${file.mainRel}: ${msg}`
          }
        }
      }

      if (
        settings.runShrink &&
        file.size >= settings.shrinkMinBytes &&
        !shrinkEnqueued
      ) {
        try {
          await enqueueShrinkInPlaceQueueItem({
            session,
            mainRel: file.mainRel,
            trailerRel: catalogTrailerRel(file.mainRel),
            label: basename(file.mainRel),
            params: settings.shrinkParams,
          })
          shrinkEnqueued = true
          summary.shrinksEnqueued++
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          if (/já está na fila/i.test(msg)) {
            shrinkEnqueued = true
          } else {
            lastError = `Shrink ${file.mainRel}: ${msg}`
          }
        }
      }

      const entry: InboxWorkerLedgerEntry = {
        size: file.size,
        mtimeMs: file.mtimeMs,
        seenAt: now,
        trailerEnqueued,
        shrinkEnqueued,
      }
      state.files[file.mainRel] = entry
    }

    if (hadBrandNew && settings.runAutoTags) {
      summary.autoTagsRan = true
      try {
        const result = await runAutoTagsPipeline(process.cwd(), [
          '--new-only',
          `--session=${session}`,
        ])
        summary.autoTagsOk = result.exitCode === 0
        if (result.exitCode !== 0) {
          const tail = (result.stderr || result.stdout).trim().slice(-800)
          lastError = `auto-tags exit ${result.exitCode}${tail ? `: ${tail}` : ''}`
        }
      } catch (e: unknown) {
        summary.autoTagsOk = false
        lastError = `auto-tags: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    state.lastRunAt = now
    state.lastError = lastError
    state.lastSummary = summary
    await saveInboxWorkerState(state)
  } catch (e: unknown) {
    lastError = e instanceof Error ? e.message : String(e)
    try {
      const state = await loadInboxWorkerState()
      state.lastRunAt = Date.now()
      state.lastError = lastError
      state.lastSummary = summary
      await saveInboxWorkerState(state)
    } catch {
      /* */
    }
  } finally {
    rt.tickInFlight = false
    const settings = getInboxWorkerSettingsCached()
    if (rt.timer && settings.enabled) {
      rt.nextRunAt = Date.now() + settings.intervalMinutes * 60_000
    }
  }
  return getInboxWorkerPublicStatus()
}

export function getInboxWorkerPublicStatus(): InboxWorkerPublicStatus {
  const rt = runtime()
  const settings = getInboxWorkerSettingsCached()
  const state = getInboxWorkerStateCached()
  let session: number | null = null
  let sessionTitle: string | null = null
  try {
    const resolved = resolveInboxWorkerSession(settings.watchPath)
    session = resolved.session
    sessionTitle = resolved.item.title
  } catch {
    /* pasta ainda não no menu */
  }
  return {
    settings,
    busy: rt.tickInFlight,
    schedulerActive: Boolean(rt.timer),
    nextRunAt: rt.timer ? rt.nextRunAt : null,
    lastRunAt: state.lastRunAt,
    lastError: state.lastError,
    lastSummary: state.lastSummary,
    platform: process.platform,
    windowsOnly: true,
    session,
    sessionTitle,
    ledgerFileCount: Object.keys(state.files).length,
  }
}

export async function updateInboxWorkerSettings(
  raw: Partial<InboxWorkerSettings> | Record<string, unknown> | null,
): Promise<InboxWorkerPublicStatus> {
  await saveInboxWorkerSettings(raw)
  reloadInboxWorkerScheduler()
  return getInboxWorkerPublicStatus()
}

export function stopInboxWorkerScheduler() {
  const rt = runtime()
  if (rt.timer) {
    clearInterval(rt.timer)
    rt.timer = null
  }
  rt.nextRunAt = null
}

export function reloadInboxWorkerScheduler() {
  const rt = runtime()
  stopInboxWorkerScheduler()
  void loadInboxWorkerSettings().then((settings) => {
    if (!settings.enabled) return
    if (process.platform !== 'win32') return
    const ms = Math.max(1, settings.intervalMinutes) * 60_000
    rt.nextRunAt = Date.now() + ms
    rt.timer = setInterval(() => {
      void runInboxWorkerTick()
    }, ms)
    try {
      rt.timer.unref?.()
    } catch {
      /* */
    }
  })
}

/** Boot: carrega settings/state e arranca o timer se enabled. */
export async function startInboxWorkerOnBoot() {
  await loadInboxWorkerSettings()
  await loadInboxWorkerState()
  reloadInboxWorkerScheduler()
}
