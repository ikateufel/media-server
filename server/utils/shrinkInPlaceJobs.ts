import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { getVideoMenuItems } from './videoMenu'
import { runShrinkBatForFile } from './runShrinkBat'
import { resolveTrailerReprocessVideo } from './trailerReprocessJobs'
import { tailText } from './runLibraryBat'
import { readLibraryState, writeLibraryState, fullProgressKey } from './libraryState'
import {
  normalizeShrinkInPlaceParams,
  type ShrinkInPlaceParams,
} from '#shared/shrinkInPlaceParams'

export type { ShrinkInPlaceParams }
export { normalizeShrinkInPlaceParams }
export type ShrinkInPlaceStatus = 'running' | 'done' | 'failed'

export interface ShrinkInPlaceLine {
  seq: number
  at: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

export interface ShrinkInPlaceSnapshot {
  id: string
  status: ShrinkInPlaceStatus
  session: number
  mainRel: string
  trailerRel?: string
  newMainRel: string | null
  title: string
  params: ShrinkInPlaceParams
  exitCode: number | null
  startedAt: number
  endedAt: number | null
  lines: ShrinkInPlaceLine[]
  totalLines: number
  error?: string
}

export type ShrinkInPlaceEvent =
  | { type: 'line'; line: ShrinkInPlaceLine }
  | {
      type: 'status'
      status: ShrinkInPlaceStatus
      exitCode?: number | null
      newMainRel?: string | null
      error?: string | null
    }

type Listener = (ev: ShrinkInPlaceEvent) => void

const LINE_RING_CAP = 400
const JOB_RETENTION_MS = 30 * 60_000

interface InternalJob {
  snapshot: ShrinkInPlaceSnapshot
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

function emit(job: InternalJob, ev: ShrinkInPlaceEvent) {
  for (const l of job.listeners) {
    try {
      l(ev)
    } catch {
      /* */
    }
  }
}

function pushLine(job: InternalJob, stream: ShrinkInPlaceLine['stream'], text: string) {
  const seq = job.snapshot.totalLines + 1
  const elapsedSec = ((Date.now() - job.snapshot.startedAt) / 1000).toFixed(1)
  const stamped =
    stream === 'meta' || text.startsWith('[')
      ? `+${elapsedSec}s ${text}`
      : text
  const line: ShrinkInPlaceLine = { seq, at: Date.now(), stream, text: stamped }
  job.snapshot.totalLines = seq
  job.snapshot.lines.push(line)
  if (job.snapshot.lines.length > LINE_RING_CAP) {
    job.snapshot.lines.splice(0, job.snapshot.lines.length - LINE_RING_CAP)
  }
  emit(job, { type: 'line', line })
}

function setStatus(
  job: InternalJob,
  status: ShrinkInPlaceStatus,
  exitCode?: number | null,
  newMainRel?: string | null,
) {
  job.snapshot.status = status
  if (status !== 'running') job.snapshot.endedAt = Date.now()
  if (exitCode !== undefined) job.snapshot.exitCode = exitCode
  if (newMainRel !== undefined) job.snapshot.newMainRel = newMainRel
  emit(job, {
    type: 'status',
    status,
    exitCode,
    newMainRel: job.snapshot.newMainRel,
    error: job.snapshot.error ?? null,
  })
  if (status === 'done' || status === 'failed') {
    void import('./processJobHistory')
      .then(({ appendProcessJobHistory, truncateProcessJobLog }) => {
        const log = truncateProcessJobLog(job.snapshot.lines.map((l) => l.text))
        return appendProcessJobHistory({
          kind: 'shrink',
          status,
          session: job.snapshot.session,
          mainRel: job.snapshot.newMainRel || job.snapshot.mainRel,
          ...(job.snapshot.trailerRel ? { trailerRel: job.snapshot.trailerRel } : {}),
          label: job.snapshot.title || job.snapshot.mainRel,
          startedAt: job.snapshot.startedAt,
          endedAt: job.snapshot.endedAt ?? Date.now(),
          jobId: job.snapshot.id,
          ...(job.snapshot.error ? { error: job.snapshot.error } : {}),
          ...(log ? { log } : {}),
        })
      })
      .catch(() => {})
  }
}

function pushTextBlock(job: InternalJob, stream: ShrinkInPlaceLine['stream'], block: string, prefix = '') {
  const raw = String(block ?? '').replace(/\r/g, '')
  const lines = raw.split('\n')
  let dumped = 0
  for (const line of lines) {
    const t = line.trimEnd()
    if (!t.trim()) continue
    pushLine(job, stream, prefix ? `${prefix}${t}` : t)
    dumped++
    if (dumped >= 80) {
      pushLine(job, 'meta', '[LOG] … (truncado — demasiadas linhas)')
      break
    }
  }
}

function summarizeBatOutput(stdout: string, stderr: string): string {
  const combined = `${stdout || ''}\n${stderr || ''}`
  const interesting = combined
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) =>
      /\[(ERRO|SKIP|OVERSIZED|PROCESSANDO|META|OK|REPLACE|DET|RETRY|PHASE|FATAL|INICIO|INSUFFICIENT)/i.test(
        l,
      ),
    )
  if (interesting.length) return interesting.slice(-12).join(' | ')
  return tailText(stderr || stdout, 600).trim()
}

function expectedShrinkedOutputPath(videoAbsolutePath: string): string {
  const stem = basename(videoAbsolutePath, extname(videoAbsolutePath))
  return join(dirname(videoAbsolutePath), 'shrinked', `${stem}.mp4`)
}

function finalMainPath(videoAbsolutePath: string): string {
  const stem = basename(videoAbsolutePath, extname(videoAbsolutePath))
  return join(dirname(videoAbsolutePath), `${stem}.mp4`)
}

function toPosixRel(absUnderRoot: string, root: string): string {
  const r = resolve(root).replace(/\\/g, '/').replace(/\/+$/, '')
  const a = resolve(absUnderRoot).replace(/\\/g, '/')
  const prefix = r.endsWith('/') ? r : `${r}/`
  if (a.toLowerCase().startsWith(prefix.toLowerCase())) {
    return a.slice(prefix.length)
  }
  return basename(a)
}

async function moveReplace(src: string, dest: string) {
  try {
    await rename(src, dest)
  } catch {
    await copyFile(src, dest)
    await unlink(src)
  }
}

function expectedBackupPath(originalPath: string): string {
  const dir = dirname(originalPath)
  const ext = extname(originalPath)
  const stem = basename(originalPath, ext)
  const backupDir = join(dir, 'shrinked_backup')
  let dest = join(backupDir, `${stem}_bak${ext}`)
  if (!existsSync(dest)) return dest
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return join(backupDir, `${stem}_bak_${stamp}${ext}`)
}

async function backupOriginalBeforeReplace(originalPath: string): Promise<string> {
  const dest = expectedBackupPath(originalPath)
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(originalPath, dest)
  return dest
}

async function replaceOriginalWithShrinked(opts: {
  originalPath: string
  shrinkedPath: string
}): Promise<{ finalPath: string; backupPath: string }> {
  const backupPath = await backupOriginalBeforeReplace(opts.originalPath)

  const dest = finalMainPath(opts.originalPath)
  const destSameAsOrig =
    resolve(opts.originalPath).toLowerCase() === resolve(dest).toLowerCase()

  if (destSameAsOrig) {
    const tmp = `${dest}.vp-shrink-tmp`
    try {
      await unlink(tmp)
    } catch {
      /* */
    }
    await moveReplace(opts.originalPath, tmp)
    try {
      await moveReplace(opts.shrinkedPath, dest)
    } catch (e) {
      try {
        await moveReplace(tmp, opts.originalPath)
      } catch {
        /* */
      }
      throw e
    }
    try {
      await unlink(tmp)
    } catch {
      /* */
    }
  } else {
    try {
      await unlink(dest)
    } catch {
      /* */
    }
    await moveReplace(opts.shrinkedPath, dest)
    try {
      await unlink(opts.originalPath)
    } catch {
      /* */
    }
  }

  try {
    await rm(dirname(opts.shrinkedPath), { recursive: false })
  } catch {
    /* pasta shrinked pode ter outros ficheiros */
  }

  return { finalPath: dest, backupPath }
}

async function remapProgressMainRel(session: number, fromRel: string, toRel: string) {
  if (fromRel === toRel) return
  const state = await readLibraryState()
  const oldPk = fullProgressKey(session, fromRel)
  const newPk = fullProgressKey(session, toRel)
  const prog = state.fullProgress[oldPk]
  if (!prog) return
  delete state.fullProgress[oldPk]
  state.fullProgress[newPk] = prog
  await writeLibraryState(state)
}

async function runJob(
  job: InternalJob,
  projectRoot: string,
  videoPath: string,
  libraryRoot: string,
  params: ShrinkInPlaceParams,
) {
  try {
    pushLine(job, 'meta', `[INICIO] ficheiro: ${videoPath}`)
    pushLine(
      job,
      'meta',
      `[INICIO] params: ${params.speed}x · ${params.height}px · ${params.codec}${params.prioritizeSize ? ' · priorizar tamanho' : ''} · force`,
    )
    pushLine(job, 'meta', `[INICIO] mainRel=${job.snapshot.mainRel} · session=${job.snapshot.session}`)
    const shrinkedPath = expectedShrinkedOutputPath(videoPath)
    pushLine(job, 'meta', `[INICIO] saída esperada: ${shrinkedPath}`)
    const r = await runShrinkBatForFile({
      projectRoot,
      videoAbsolutePath: videoPath,
      height: params.height,
      speed: params.speed,
      codec: params.codec,
      force: true,
      prioritizeSize: params.prioritizeSize,
      onLine: (stream, text) => pushLine(job, stream, text),
    })
    job.snapshot.exitCode = r.exitCode
    pushLine(job, 'meta', `[BAT] terminou exitCode=${r.exitCode}`)
    if (r.exitCode !== 0) {
      pushLine(job, 'meta', '[ERRO] shrink_video.bat falhou — dump stdout/stderr:')
      if (r.stdout?.trim()) pushTextBlock(job, 'stdout', r.stdout)
      if (r.stderr?.trim()) pushTextBlock(job, 'stderr', r.stderr)
      const summary = summarizeBatOutput(r.stdout, r.stderr)
      job.snapshot.error =
        summary || `shrink_video.bat exit ${r.exitCode}`
      pushLine(job, 'meta', `[ERRO] resumo: ${job.snapshot.error}`)
      setStatus(job, 'failed', r.exitCode)
      return
    }
    if (!existsSync(shrinkedPath)) {
      pushLine(job, 'meta', '[ERRO] saída shrinked\\ não existe após exit 0')
      pushLine(job, 'meta', '[ERRO] normalmente SKIP / OVERSIZED / já shrinkado — dump do bat:')
      if (r.stdout?.trim()) pushTextBlock(job, 'stdout', r.stdout)
      if (r.stderr?.trim()) pushTextBlock(job, 'stderr', r.stderr)
      const summary = summarizeBatOutput(r.stdout, r.stderr)
      const msg =
        summary ||
        'Shrink terminou sem criar saída em shrinked\\ (SKIP/OVERSIZED ou já processado). Nada foi substituído.'
      job.snapshot.error = msg
      pushLine(job, 'meta', `[ERRO] ${msg}`)
      setStatus(job, 'failed', r.exitCode)
      return
    }
    let outStat
    try {
      outStat = await stat(shrinkedPath)
    } catch (e) {
      outStat = null
      pushLine(job, 'meta', `[ERRO] stat falhou em ${shrinkedPath}: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!outStat || !outStat.isFile() || outStat.size < 1024) {
      const msg = `Saída shrinked inválida ou demasiado pequena (${outStat?.size ?? 0} bytes).`
      job.snapshot.error = msg
      pushLine(job, 'meta', `[ERRO] ${msg}`)
      setStatus(job, 'failed', 1)
      return
    }
    pushLine(
      job,
      'meta',
      `[OK] shrinked criado: ${basename(shrinkedPath)} (${Math.round(outStat.size / 1024 / 1024)} MB)`,
    )

    let origBytes = 0
    try {
      origBytes = (await stat(videoPath)).size
    } catch {
      origBytes = 0
    }
    if (origBytes > 0) {
      const maxKeepBytes = Math.floor(origBytes * 0.7)
      const pct = Math.round((outStat.size * 100) / origBytes)
      pushLine(
        job,
        'meta',
        `[META] tamanho: origem ${Math.round(origBytes / 1024 / 1024)} MB → shrinked ${Math.round(outStat.size / 1024 / 1024)} MB (${pct}% do original)`,
      )
      if (outStat.size > maxKeepBytes) {
        const msg = `Redução insuficiente (${pct}% do original — precisa ≤70%, ≥30% de corte). Original mantido; shrinked apagado.`
        job.snapshot.error = msg
        pushLine(job, 'meta', `[SKIP] ${msg}`)
        try {
          await unlink(shrinkedPath)
        } catch {
          /* */
        }
        setStatus(job, 'failed', 0)
        return
      }
    }

    pushLine(job, 'meta', `[REPLACE] a substituir o original por ${basename(shrinkedPath)}…`)
    try {
      const { finalPath, backupPath } = await replaceOriginalWithShrinked({
        originalPath: videoPath,
        shrinkedPath,
      })
      const newMainRel = toPosixRel(finalPath, libraryRoot)
      await remapProgressMainRel(job.snapshot.session, job.snapshot.mainRel, newMainRel)
      pushLine(job, 'meta', `[BACKUP] original em ${backupPath}`)
      pushLine(job, 'meta', `[OK] vídeo substituído → ${newMainRel}`)
      setStatus(job, 'done', 0, newMainRel)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      job.snapshot.error = `Falha ao substituir o original: ${msg}`
      pushLine(job, 'stderr', `[FATAL] ${job.snapshot.error}`)
      pushLine(job, 'meta', `[ERRO] shrinked pode ter ficado em: ${shrinkedPath}`)
      setStatus(job, 'failed', null)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    job.snapshot.error = msg
    pushLine(job, 'stderr', `[FATAL] ${msg}`)
    setStatus(job, 'failed', null)
  }
}

export function createShrinkInPlaceJob(opts: {
  projectRoot: string
  session: number
  mainRel: string
  trailerRel?: string
  path: string
  libraryRoot: string
  title: string
  params: ShrinkInPlaceParams
}): ShrinkInPlaceSnapshot {
  pruneOldJobs()
  const id = randomUUID()
  const snapshot: ShrinkInPlaceSnapshot = {
    id,
    status: 'running',
    session: opts.session,
    mainRel: opts.mainRel,
    ...(opts.trailerRel ? { trailerRel: opts.trailerRel } : {}),
    newMainRel: null,
    title: opts.title,
    params: opts.params,
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    lines: [],
    totalLines: 0,
  }
  const internal: InternalJob = { snapshot, listeners: new Set() }
  jobs.set(id, internal)
  void runJob(internal, opts.projectRoot, opts.path, opts.libraryRoot, opts.params)
  return snapshot
}

export function getShrinkInPlaceSnapshot(id: string): ShrinkInPlaceSnapshot | null {
  const j = jobs.get(id)
  return j ? { ...j.snapshot, lines: [...j.snapshot.lines], params: { ...j.snapshot.params } } : null
}

export function subscribeShrinkInPlaceJob(id: string, listener: Listener): (() => void) | null {
  const j = jobs.get(id)
  if (!j) return null
  j.listeners.add(listener)
  return () => {
    j.listeners.delete(listener)
  }
}

export function startShrinkInPlaceFromConfig(
  config: Parameters<typeof getVideoMenuItems>[0],
  opts: {
    session: number
    mainRel: string
    trailerRel?: string
    projectRoot: string
    params?: Partial<ShrinkInPlaceParams> | Record<string, unknown> | null
  },
): ShrinkInPlaceSnapshot {
  const menu = getVideoMenuItems(config)
  const resolved = resolveTrailerReprocessVideo(menu, opts.session, opts.mainRel)
  const params = normalizeShrinkInPlaceParams(opts.params)
  const libraryRoot = resolve(menu[resolved.session]!.path.trim())
  return createShrinkInPlaceJob({
    projectRoot: opts.projectRoot,
    session: resolved.session,
    mainRel: resolved.mainRel,
    ...(opts.trailerRel ? { trailerRel: opts.trailerRel } : {}),
    path: resolved.path,
    libraryRoot,
    title: resolved.title,
    params,
  })
}
