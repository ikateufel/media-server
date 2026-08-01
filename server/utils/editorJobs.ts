import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createError } from 'h3'
import { readLibraryState, writeLibraryState, fullProgressKey } from './libraryState'
import {
  computeKeepSegments,
  mergeSegments,
  normalizeRemoveSegments,
  type CutSegment,
} from './editorCuts'
import {
  buildChunkExportPlans,
  normalizeSplitTimes,
  type EditorChunkPlan,
} from '#shared/editorSplit'

export type EditorEditMode = 'exclude' | 'keep'

export function normalizeEditMode(raw: unknown): EditorEditMode {
  const s = String(raw ?? 'exclude').trim().toLowerCase()
  return s === 'keep' ? 'keep' : 'exclude'
}
import { runEditorBatForFile, type EditorSpeed } from './runEditorBat'
import { logIfOutputLargerThanSource, oversizedOutputMessage, type OversizedOutputEntry } from './oversizedOutputLog'
import { hasPathTraversal, resolveMediaFileUnderRoot } from './videoPaths'
import { isVideoFileName } from '#shared/videoExtensions'

export type EditorJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface EditorJobLine {
  seq: number
  at: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

export interface EditorJobSnapshot {
  id: string
  status: EditorJobStatus
  sourceRoot: string
  fileRel: string
  filePath: string
  newFileRel: string | null
  session: number | null
  useVideo: boolean
  height: number
  speed: EditorSpeed
  force: boolean
  editMode: EditorEditMode
  splitPoints: number[]
  excludeSegments: CutSegment[]
  keepMarkedSegments: CutSegment[]
  removeSegments: CutSegment[]
  keepSegments: CutSegment[]
  chunkPlans: EditorChunkPlan[]
  duration: number | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  stdoutTail?: string
  stderrTail?: string
  lines: EditorJobLine[]
  totalLines: number
  cancelRequested: boolean
  oversizedOutput: OversizedOutputEntry | null
}

export type EditorJobEvent =
  | { type: 'line'; line: EditorJobLine }
  | { type: 'status'; status: EditorJobStatus }

type Listener = (ev: EditorJobEvent) => void

const LINE_RING_CAP = 800
const STDOUT_TAIL_CAP = 12_000
const JOB_RETENTION_MS = 30 * 60_000

interface InternalJob {
  snapshot: EditorJobSnapshot
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

function emit(job: InternalJob, ev: EditorJobEvent) {
  for (const l of job.listeners) {
    try {
      l(ev)
    } catch {
      /* */
    }
  }
}

function pushLine(job: InternalJob, stream: EditorJobLine['stream'], text: string) {
  const seq = job.snapshot.totalLines + 1
  const line: EditorJobLine = { seq, at: Date.now(), stream, text }
  job.snapshot.totalLines = seq
  job.snapshot.lines.push(line)
  if (job.snapshot.lines.length > LINE_RING_CAP) {
    job.snapshot.lines.splice(0, job.snapshot.lines.length - LINE_RING_CAP)
  }
  emit(job, { type: 'line', line })
}

function setStatus(job: InternalJob, status: EditorJobStatus) {
  if (job.snapshot.status === status) return
  job.snapshot.status = status
  if (status !== 'running') job.snapshot.endedAt = Date.now()
  emit(job, { type: 'status', status })
}

export async function resolveEditorFile(
  sourceRoot: string,
  fileRel: string,
): Promise<{ rel: string; path: string }> {
  const rel = String(fileRel ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!rel || hasPathTraversal(rel)) {
    throw createError({ statusCode: 400, statusMessage: `Caminho inválido: ${fileRel}` })
  }
  if (!isVideoFileName(rel)) {
    throw createError({ statusCode: 400, statusMessage: `Extensão não suportada: ${rel}` })
  }
  const resolved = await resolveMediaFileUnderRoot(sourceRoot, rel)
  return { rel: resolved.rel, path: resolved.path }
}

export function validateEditorSegments(
  duration: number | null,
  mode: EditorEditMode,
  marked: CutSegment[],
): { markedSegments: CutSegment[]; keepSegments: CutSegment[]; editMode: EditorEditMode } {
  const markedSegments = normalizeRemoveSegments(marked)
  if (!markedSegments.length) {
    throw createError({
      statusCode: 400,
      statusMessage:
        mode === 'keep'
          ? 'Marque pelo menos um trecho a recortar.'
          : 'Marque pelo menos um trecho a excluir.',
    })
  }
  if (duration != null && Number.isFinite(duration) && duration > 0) {
    for (const s of markedSegments) {
      if (s.start >= duration || s.end <= 0) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Trecho marcado fora da duração do vídeo.',
        })
      }
    }
    const keepSegments =
      mode === 'keep'
        ? mergeSegments(
            markedSegments.map((s) => ({
              start: Math.max(0, s.start),
              end: Math.min(duration, s.end),
            })),
          )
        : computeKeepSegments(duration, markedSegments)
    if (!keepSegments.length) {
      throw createError({
        statusCode: 400,
        statusMessage:
          mode === 'keep'
            ? 'Nenhum trecho válido para recortar.'
            : 'Excluir estes trechos deixaria o vídeo vazio.',
      })
    }
    return { markedSegments, keepSegments, editMode: mode }
  }
  const keepSegments =
    mode === 'keep'
      ? mergeSegments(markedSegments)
      : computeKeepSegments(Number.MAX_SAFE_INTEGER, markedSegments)
  return { markedSegments, keepSegments, editMode: mode }
}

export interface EditorExportValidation {
  editMode: EditorEditMode
  splitPoints: number[]
  excludeSegments: CutSegment[]
  keepMarkedSegments: CutSegment[]
  markedSegments: CutSegment[]
  keepSegments: CutSegment[]
  chunkPlans: EditorChunkPlan[]
  splitExport: boolean
}

export function validateEditorExport(opts: {
  duration: number | null
  editMode: EditorEditMode
  excludeSegments: CutSegment[]
  keepMarkedSegments: CutSegment[]
  splitPoints: unknown
}): EditorExportValidation {
  const splitPoints = normalizeSplitTimes(opts.splitPoints, opts.duration)
  const excludeSegments = mergeSegments(normalizeRemoveSegments(opts.excludeSegments))
  const keepMarkedSegments = mergeSegments(normalizeRemoveSegments(opts.keepMarkedSegments))
  const splitExport = splitPoints.length > 0

  if (splitExport) {
    if (opts.duration == null || !Number.isFinite(opts.duration) || opts.duration <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Carregue o vídeo no player para obter a duração antes de exportar em partes.',
      })
    }
    const chunkPlans = buildChunkExportPlans(
      opts.duration,
      splitPoints,
      excludeSegments,
      keepMarkedSegments,
    )
    if (!chunkPlans.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nenhuma parte válida para exportar (splits ou marcações deixam pedaços vazios).',
      })
    }
    const keepSegments = chunkPlans.flatMap((p) => p.keepSegments)
    return {
      editMode: opts.editMode,
      splitPoints,
      excludeSegments,
      keepMarkedSegments,
      markedSegments: [...excludeSegments, ...keepMarkedSegments],
      keepSegments,
      chunkPlans,
      splitExport: true,
    }
  }

  const mode = opts.editMode
  const marked = mode === 'keep' ? keepMarkedSegments : excludeSegments
  const { markedSegments, keepSegments } = validateEditorSegments(opts.duration, mode, marked)
  return {
    editMode: mode,
    splitPoints: [],
    excludeSegments,
    keepMarkedSegments,
    markedSegments,
    keepSegments,
    chunkPlans: [],
    splitExport: false,
  }
}

function expectedEditedOutputPath(videoAbsolutePath: string, outputSuffix = ''): string {
  const stem = basename(videoAbsolutePath, extname(videoAbsolutePath))
  return join(dirname(videoAbsolutePath), 'edited', `${stem}${outputSuffix}.mp4`)
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

function expectedEditedBackupPath(originalPath: string): string {
  const dir = dirname(originalPath)
  const ext = extname(originalPath)
  const stem = basename(originalPath, ext)
  const backupDir = join(dir, 'edited_backup')
  let dest = join(backupDir, `${stem}_bak${ext}`)
  if (!existsSync(dest)) return dest
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return join(backupDir, `${stem}_bak_${stamp}${ext}`)
}

async function backupOriginalBeforeReplace(originalPath: string): Promise<string> {
  const dest = expectedEditedBackupPath(originalPath)
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(originalPath, dest)
  return dest
}

async function replaceOriginalWithEdited(opts: {
  originalPath: string
  editedPath: string
}): Promise<{ finalPath: string; backupPath: string }> {
  const backupPath = await backupOriginalBeforeReplace(opts.originalPath)
  const dest = finalMainPath(opts.originalPath)
  const destSameAsOrig =
    resolve(opts.originalPath).toLowerCase() === resolve(dest).toLowerCase()

  if (destSameAsOrig) {
    const tmp = `${dest}.vp-edit-tmp`
    try {
      await unlink(tmp)
    } catch {
      /* */
    }
    await moveReplace(opts.originalPath, tmp)
    try {
      await moveReplace(opts.editedPath, dest)
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
    await moveReplace(opts.editedPath, dest)
    try {
      await unlink(opts.originalPath)
    } catch {
      /* */
    }
  }

  try {
    await rm(dirname(opts.editedPath), { recursive: false })
  } catch {
    /* pasta edited pode ter outros ficheiros */
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

async function applyUseVideoReplace(job: InternalJob, snap: EditorJobSnapshot): Promise<boolean> {
  const editedPath = expectedEditedOutputPath(snap.filePath, '')
  if (!existsSync(editedPath)) {
    pushLine(job, 'meta', '[ERRO] edited\\ não existe — nada substituído.')
    return false
  }
  let outStat
  try {
    outStat = await stat(editedPath)
  } catch {
    outStat = null
  }
  if (!outStat?.isFile() || outStat.size < 1024) {
    pushLine(job, 'meta', '[ERRO] saída edited inválida — nada substituído.')
    return false
  }

  pushLine(job, 'meta', `[REPLACE] a substituir o original por ${basename(editedPath)}…`)
  try {
    const { finalPath, backupPath } = await replaceOriginalWithEdited({
      originalPath: snap.filePath,
      editedPath,
    })
    const newFileRel = toPosixRel(finalPath, snap.sourceRoot)
    if (snap.session != null) {
      await remapProgressMainRel(snap.session, snap.fileRel, newFileRel)
    }
    snap.newFileRel = newFileRel
    snap.filePath = finalPath
    pushLine(job, 'meta', `[BACKUP] original em ${backupPath}`)
    pushLine(job, 'meta', `[OK] vídeo substituído → ${newFileRel}`)
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    pushLine(job, 'stderr', `[FATAL] Falha ao substituir o original: ${msg}`)
    pushLine(job, 'meta', `[ERRO] edited pode ter ficado em: ${editedPath}`)
    return false
  }
}

async function runEditorExport(
  job: InternalJob,
  projectRoot: string,
  snap: EditorJobSnapshot,
  keepSegments: CutSegment[],
  outputSuffix: string,
  label: string,
): Promise<number> {
  pushLine(job, 'meta', `[EXPORT] ${label} · ${keepSegments.length} trecho(s)`)
  const r = await runEditorBatForFile({
    projectRoot,
    videoAbsolutePath: snap.filePath,
    keepSegments,
    height: snap.height,
    speed: snap.speed,
    force: snap.force,
    outputSuffix,
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
    onLine: (stream, text) => pushLine(job, stream, text),
  })
  if (r.exitCode === 0) {
    const logged = await logIfOutputLargerThanSource({
      projectRoot,
      sourcePath: snap.filePath,
      outputSubdir: 'edited',
      tool: 'editor',
      fileRel: `${snap.fileRel}${outputSuffix}.mp4`,
    })
    if (logged) {
      snap.oversizedOutput = logged
      const msg = oversizedOutputMessage(logged)
      pushLine(job, 'meta', `[OVERSIZED] ${msg}`)
      pushLine(job, 'stderr', `[AVISO] ${msg}`)
    }
  }
  return r.exitCode
}

async function runJob(job: InternalJob, projectRoot: string) {
  const snap = job.snapshot
  try {
    if (job.cancelRequested) {
      pushLine(job, 'meta', '[ABORTAR] exportação cancelada.')
      setStatus(job, 'cancelled')
      return
    }

    const splitExport = snap.chunkPlans.length > 0
    pushLine(
      job,
      'meta',
      splitExport
        ? `[INICIO] ${snap.fileRel} · split ${snap.chunkPlans.length} parte(s) · ${snap.speed}x · ${snap.height}px`
        : snap.useVideo
          ? `[INICIO] ${snap.fileRel} · modo ${snap.editMode === 'keep' ? 'recortar' : 'excluir'} · ${snap.keepSegments.length} trecho(s) · ${snap.speed}x · ${snap.height}px · usar vídeo`
          : `[INICIO] ${snap.fileRel} · modo ${snap.editMode === 'keep' ? 'recortar' : 'excluir'} · ${snap.keepSegments.length} trecho(s) · ${snap.speed}x · ${snap.height}px`,
    )

    let lastExit = 0
    let okCount = 0

    if (splitExport) {
      for (const plan of snap.chunkPlans) {
        if (job.cancelRequested) {
          setStatus(job, 'cancelled')
          return
        }
        const code = await runEditorExport(
          job,
          projectRoot,
          snap,
          plan.keepSegments,
          `_${plan.label}`,
          `${plan.label} (${plan.keepSegments.length} trecho(s) em ${formatChunkRange(plan.chunk)})`,
        )
        lastExit = code
        if (code === 0) okCount++
        else pushLine(job, 'stderr', `[ERRO] ${plan.label} exit ${code}`)
      }
      snap.exitCode = lastExit
      if (job.cancelRequested) {
        setStatus(job, 'cancelled')
        return
      }
      if (okCount === 0) {
        setStatus(job, 'failed')
      } else if (okCount < snap.chunkPlans.length) {
        pushLine(job, 'meta', `[AVISO] ${okCount}/${snap.chunkPlans.length} parte(s) OK`)
        setStatus(job, okCount > 0 ? 'done' : 'failed')
      } else {
        setStatus(job, 'done')
      }
      return
    }

    lastExit = await runEditorExport(job, projectRoot, snap, snap.keepSegments, '', snap.fileRel)
    snap.exitCode = lastExit

    if (job.cancelRequested) {
      setStatus(job, 'cancelled')
      return
    }

    if (lastExit === 0) {
      if (snap.useVideo) {
        const replaced = await applyUseVideoReplace(job, snap)
        setStatus(job, replaced ? 'done' : 'failed')
      } else {
        setStatus(job, 'done')
      }
    } else {
      pushLine(job, 'stderr', `[ERRO] exit code ${lastExit}`)
      setStatus(job, 'failed')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    pushLine(job, 'stderr', `[FATAL] ${msg}`)
    setStatus(job, 'failed')
  } finally {
    job.currentPid = null
  }
}

function formatChunkRange(chunk: CutSegment): string {
  return `${chunk.start.toFixed(1)}s–${chunk.end.toFixed(1)}s`
}

export interface CreateEditorJobOpts {
  projectRoot: string
  sourceRoot: string
  file: { rel: string; path: string }
  session: number | null
  useVideo: boolean
  height: number
  speed: EditorSpeed
  force: boolean
  validation: EditorExportValidation
  duration: number | null
}

export function createEditorJob(opts: CreateEditorJobOpts): EditorJobSnapshot {
  pruneOldJobs()
  const id = randomUUID()
  const v = opts.validation
  const splitExport = v.splitExport
  const useVideo = opts.useVideo && !splitExport
  const snapshot: EditorJobSnapshot = {
    id,
    status: 'running',
    sourceRoot: opts.sourceRoot,
    fileRel: opts.file.rel,
    filePath: opts.file.path,
    newFileRel: null,
    session: opts.session,
    useVideo,
    height: opts.height,
    speed: opts.speed,
    force: opts.force || useVideo,
    editMode: v.editMode,
    splitPoints: v.splitPoints,
    excludeSegments: v.excludeSegments,
    keepMarkedSegments: v.keepMarkedSegments,
    removeSegments: v.markedSegments,
    keepSegments: v.keepSegments,
    chunkPlans: v.chunkPlans,
    duration: opts.duration,
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    lines: [],
    totalLines: 0,
    cancelRequested: false,
    oversizedOutput: null,
  }
  const internal: InternalJob = {
    snapshot,
    listeners: new Set(),
    currentPid: null,
    cancelRequested: false,
  }
  jobs.set(id, internal)
  void runJob(internal, opts.projectRoot)
  return snapshot
}

export function getEditorJobSnapshot(id: string): EditorJobSnapshot | null {
  const j = jobs.get(id)
  return j ? { ...j.snapshot, cancelRequested: j.cancelRequested } : null
}

export function subscribeEditorJob(id: string, listener: Listener): (() => void) | null {
  const j = jobs.get(id)
  if (!j) return null
  j.listeners.add(listener)
  return () => {
    j.listeners.delete(listener)
  }
}

export function cancelEditorJob(id: string): boolean {
  const j = jobs.get(id)
  if (!j) return false
  if (j.snapshot.status !== 'running') return false
  j.cancelRequested = true
  j.snapshot.cancelRequested = true
  pushLine(j, 'meta', '[CANCELAR] pedido recebido.')
  if (j.currentPid != null) {
    try {
      process.kill(j.currentPid)
    } catch {
      /* */
    }
  }
  return true
}

export function getRunningEditorJobSnapshot(): EditorJobSnapshot | null {
  pruneOldJobs()
  let best: InternalJob | null = null
  for (const j of jobs.values()) {
    if (j.snapshot.status !== 'running') continue
    if (!best || j.snapshot.startedAt > best.snapshot.startedAt) best = j
  }
  return best ? { ...best.snapshot, cancelRequested: best.cancelRequested } : null
}
