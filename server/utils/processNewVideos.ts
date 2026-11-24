import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { isVideoFileName } from '#shared/videoExtensions'
import { SHRINK_IN_PLACE_PARAMS_DEFAULT } from '#shared/shrinkInPlaceParams'
import { TRAILER_BAT_PARAMS_DEFAULT } from '#shared/trailerParams'
import {
  NEW_VIDEOS_SHRINK_MIN_BYTES,
  type ProcessNewVideosCandidate,
  type ProcessNewVideosPhase,
  type ProcessNewVideosPublicStatus,
  type ProcessNewVideosSkipped,
  type ProcessNewVideosSummary,
} from '#shared/processNewVideos'
import { runAutoTagsPipeline } from './autoTagsPipeline'
import { findSuccessfulShrinkHistory } from './processJobHistory'
import {
  enqueueShrinkInPlaceQueueItem,
  getShrinkInPlaceQueueState,
} from './shrinkInPlaceQueue'
import {
  enqueueTrailerReprocessQueueItem,
  getTrailerReprocessQueueState,
} from './trailerReprocessQueue'
import { getVideoMenuRowsForCli } from './videoMenu'

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

type RuntimeState = {
  busy: boolean
  phase: ProcessNewVideosPhase
  session: number | null
  sessionTitle: string | null
  startedAt: number | null
  endedAt: number | null
  lastError: string | null
  candidates: ProcessNewVideosCandidate[]
  skipped: ProcessNewVideosSkipped[]
  summary: ProcessNewVideosSummary | null
}

const g = globalThis as typeof globalThis & { __vpProcessNewVideos?: RuntimeState }

function runtime(): RuntimeState {
  if (!g.__vpProcessNewVideos) {
    g.__vpProcessNewVideos = {
      busy: false,
      phase: 'idle',
      session: null,
      sessionTitle: null,
      startedAt: null,
      endedAt: null,
      lastError: null,
      candidates: [],
      skipped: [],
      summary: null,
    }
  }
  return g.__vpProcessNewVideos
}

function normalizeMainRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '')
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
  out: { mainRel: string; abs: string; size: number }[],
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
      out.push({ mainRel, abs, size: st.size })
    } catch {
      /* */
    }
  }
}

export function catalogTrailerRelForMain(mainRel: string): string {
  const norm = normalizeMainRel(mainRel)
  const stem = basename(norm, extname(norm))
  const parent = dirname(norm).replace(/\\/g, '/')
  if (!parent || parent === '.') return `trailers/${stem}.mp4`
  return `trailers/${parent}/${stem}.mp4`
}

export function trailerExistsForVideo(rootAbs: string, videoAbs: string, mainRel: string): boolean {
  const stem = basename(videoAbs, extname(videoAbs))
  const beside = join(dirname(videoAbs), 'trailers', `${stem}.mp4`)
  if (existsSync(beside)) return true
  const catalog = join(rootAbs, ...catalogTrailerRelForMain(mainRel).split('/'))
  if (existsSync(catalog)) return true
  const rootFlat = join(rootAbs, 'trailers', `${stem}.mp4`)
  return existsSync(rootFlat)
}

function emptySummary(): ProcessNewVideosSummary {
  return {
    scanned: 0,
    candidates: 0,
    skippedAlreadyShrunk: 0,
    trailersEnqueued: 0,
    shrinksEnqueued: 0,
    autoTagsRan: false,
    autoTagsOk: null,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForQueueItemsIdle(
  kind: 'trailer' | 'shrink',
  opts: { itemIds: Set<string>; session: number; mainRels: Set<string> },
  timeoutMs = 6 * 60 * 60_000,
): Promise<void> {
  if (!opts.itemIds.size && !opts.mainRels.size) return
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const state =
      kind === 'trailer' ? await getTrailerReprocessQueueState() : await getShrinkInPlaceQueueState()
    const stillActive = state.items.some((i) => {
      if (i.status !== 'pending' && i.status !== 'running') return false
      if (opts.itemIds.has(i.id)) return true
      return i.session === opts.session && opts.mainRels.has(i.mainRel)
    })
    if (!stillActive) return
    await sleep(1500)
  }
  throw new Error(
    kind === 'trailer'
      ? 'Timeout à espera da fila de trailers.'
      : 'Timeout à espera da fila de shrink.',
  )
}

export function getProcessNewVideosPublicStatus(): ProcessNewVideosPublicStatus {
  const rt = runtime()
  return {
    busy: rt.busy,
    phase: rt.phase,
    session: rt.session,
    sessionTitle: rt.sessionTitle,
    startedAt: rt.startedAt,
    endedAt: rt.endedAt,
    lastError: rt.lastError,
    candidates: rt.candidates.map((c) => ({ ...c })),
    skipped: rt.skipped.map((s) => ({ ...s })),
    summary: rt.summary ? { ...rt.summary } : null,
    platform: process.platform,
    windowsOnly: true,
  }
}

/**
 * Pipeline: lista (sem trailer, excl. já shrinkados) → trailers → auto-tags --new-only → shrink ≥600MB sem backup.
 */
export async function startProcessNewVideos(session: number): Promise<ProcessNewVideosPublicStatus> {
  const rt = runtime()
  if (rt.busy) {
    return getProcessNewVideosPublicStatus()
  }

  const menu = getVideoMenuRowsForCli()
  const sess = Math.floor(session)
  if (!Number.isFinite(sess) || sess < 0 || sess >= menu.length) {
    throw new Error(`Sessão inválida (0..${Math.max(0, menu.length - 1)}).`)
  }
  if (process.platform !== 'win32') {
    throw new Error('Pipeline «novos» só corre em Windows (trailer.bat / shrink).')
  }

  const item = menu[sess]!
  const rootAbs = resolve(item.path.trim())
  if (!existsSync(rootAbs)) {
    throw new Error(`Pasta da biblioteca inexistente: ${rootAbs}`)
  }

  rt.busy = true
  rt.phase = 'scanning'
  rt.session = sess
  rt.sessionTitle = item.title
  rt.startedAt = Date.now()
  rt.endedAt = null
  rt.lastError = null
  rt.candidates = []
  rt.skipped = []
  rt.summary = emptySummary()

  void runPipeline(sess, rootAbs, item.title).finally(() => {
    const r = runtime()
    r.busy = false
    if (r.phase !== 'failed') r.phase = 'done'
    r.endedAt = Date.now()
  })

  return getProcessNewVideosPublicStatus()
}

async function runPipeline(session: number, rootAbs: string, _sessionTitle: string): Promise<void> {
  const rt = runtime()
  const summary = emptySummary()

  try {
    const found: { mainRel: string; abs: string; size: number }[] = []
    await scanVideosRecursive(rootAbs, rootAbs, found)
    summary.scanned = found.length

    const candidates: ProcessNewVideosCandidate[] = []
    const skipped: ProcessNewVideosSkipped[] = []

    for (const file of found) {
      if (trailerExistsForVideo(rootAbs, file.abs, file.mainRel)) continue

      const hist = await findSuccessfulShrinkHistory(session, file.mainRel)
      if (hist) {
        skipped.push({
          mainRel: file.mainRel,
          label: basename(file.mainRel),
          reason: 'already_shrunk',
        })
        continue
      }

      candidates.push({
        mainRel: file.mainRel,
        label: basename(file.mainRel),
        size: file.size,
        willShrink: file.size >= NEW_VIDEOS_SHRINK_MIN_BYTES,
      })
    }

    summary.candidates = candidates.length
    summary.skippedAlreadyShrunk = skipped.length
    rt.candidates = candidates
    rt.skipped = skipped
    rt.summary = { ...summary }

    if (!candidates.length) {
      rt.phase = 'done'
      rt.summary = summary
      return
    }

    rt.phase = 'trailers'
    const trailerIds = new Set<string>()
    const trailerMainRels = new Set(candidates.map((c) => c.mainRel))
    for (const c of candidates) {
      try {
        const after = await enqueueTrailerReprocessQueueItem({
          session,
          mainRel: c.mainRel,
          trailerRel: catalogTrailerRelForMain(c.mainRel),
          label: c.label,
          params: TRAILER_BAT_PARAMS_DEFAULT,
        })
        for (const i of after.items) {
          if (
            i.session === session &&
            i.mainRel === c.mainRel &&
            (i.status === 'pending' || i.status === 'running')
          ) {
            trailerIds.add(i.id)
          }
        }
        summary.trailersEnqueued++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/já está na fila/i.test(msg)) {
          summary.trailersEnqueued++
          const st = await getTrailerReprocessQueueState()
          for (const i of st.items) {
            if (
              i.session === session &&
              i.mainRel === c.mainRel &&
              (i.status === 'pending' || i.status === 'running')
            ) {
              trailerIds.add(i.id)
            }
          }
        } else {
          throw new Error(`Trailer ${c.mainRel}: ${msg}`)
        }
      }
      rt.summary = { ...summary }
    }

    await waitForQueueItemsIdle('trailer', {
      itemIds: trailerIds,
      session,
      mainRels: trailerMainRels,
    })

    rt.phase = 'auto-tags'
    summary.autoTagsRan = true
    rt.summary = { ...summary }
    try {
      const result = await runAutoTagsPipeline(process.cwd(), [
        '--new-only',
        `--session=${session}`,
      ])
      summary.autoTagsOk = result.exitCode === 0
      if (result.exitCode !== 0) {
        const tail = (result.stderr || result.stdout).trim().slice(-800)
        throw new Error(`auto-tags exit ${result.exitCode}${tail ? `: ${tail}` : ''}`)
      }
    } catch (e: unknown) {
      summary.autoTagsOk = false
      throw e instanceof Error ? e : new Error(String(e))
    }
    rt.summary = { ...summary }

    const toShrink = candidates.filter((c) => c.willShrink)
    if (toShrink.length) {
      rt.phase = 'shrink'
      const shrinkIds = new Set<string>()
      const shrinkMainRels = new Set(toShrink.map((c) => c.mainRel))
      for (const c of toShrink) {
        try {
          const after = await enqueueShrinkInPlaceQueueItem({
            session,
            mainRel: c.mainRel,
            trailerRel: catalogTrailerRelForMain(c.mainRel),
            label: c.label,
            params: SHRINK_IN_PLACE_PARAMS_DEFAULT,
            skipBackup: true,
          })
          for (const i of after.items) {
            if (
              i.session === session &&
              i.mainRel === c.mainRel &&
              (i.status === 'pending' || i.status === 'running')
            ) {
              shrinkIds.add(i.id)
            }
          }
          summary.shrinksEnqueued++
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          if (/já está na fila/i.test(msg)) {
            summary.shrinksEnqueued++
            const st = await getShrinkInPlaceQueueState()
            for (const i of st.items) {
              if (
                i.session === session &&
                i.mainRel === c.mainRel &&
                (i.status === 'pending' || i.status === 'running')
              ) {
                shrinkIds.add(i.id)
              }
            }
          } else {
            throw new Error(`Shrink ${c.mainRel}: ${msg}`)
          }
        }
        rt.summary = { ...summary }
      }
      await waitForQueueItemsIdle('shrink', {
        itemIds: shrinkIds,
        session,
        mainRels: shrinkMainRels,
      })
    }

    rt.phase = 'done'
    rt.summary = summary
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    rt.phase = 'failed'
    rt.lastError = msg
    rt.summary = summary
  }
}
