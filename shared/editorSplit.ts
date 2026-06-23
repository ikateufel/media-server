import type { CutSegment } from './editorSegmentTypes'

export type { CutSegment }

export interface EditorChunkPlan {
  index: number
  label: string
  chunk: CutSegment
  keepSegments: CutSegment[]
}

const MIN_CHUNK_SEC = 0.25
const MIN_SPLIT_GAP = 0.5

export function normalizeSplitTimes(raw: unknown, duration: number | null): number[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: number[] = []
  for (const item of raw) {
    const t = Number(item)
    if (!Number.isFinite(t)) continue
    if (duration != null && duration > 0) {
      if (t <= MIN_SPLIT_GAP || t >= duration - MIN_SPLIT_GAP) continue
    } else if (t <= 0) {
      continue
    }
    const key = t.toFixed(3)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  out.sort((a, b) => a - b)
  const merged: number[] = []
  for (const t of out) {
    const last = merged[merged.length - 1]
    if (last != null && t - last < MIN_SPLIT_GAP) continue
    merged.push(t)
  }
  return merged
}

/** Limites de cada parte (c1, c2, …) a partir dos pontos de split. */
export function computeChunksFromSplits(duration: number, splitTimes: number[]): CutSegment[] {
  if (!Number.isFinite(duration) || duration <= MIN_CHUNK_SEC) return []
  const points = normalizeSplitTimes(splitTimes, duration)
  const chunks: CutSegment[] = []
  let start = 0
  for (const p of points) {
    if (p - start >= MIN_CHUNK_SEC) {
      chunks.push({ start, end: p })
    }
    start = p
  }
  if (duration - start >= MIN_CHUNK_SEC) {
    chunks.push({ start, end: duration })
  }
  return chunks
}

function mergeSegments(segments: CutSegment[]): CutSegment[] {
  const sorted = [...segments]
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start)
  const merged: CutSegment[] = []
  for (const seg of sorted) {
    const last = merged[merged.length - 1]
    if (last && seg.start <= last.end + 0.01) {
      last.end = Math.max(last.end, seg.end)
    } else {
      merged.push({ start: seg.start, end: seg.end })
    }
  }
  return merged
}

function computeKeepFromExclude(duration: number, remove: CutSegment[]): CutSegment[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const merged = mergeSegments(
    remove.map((s) => ({
      start: Math.max(0, s.start),
      end: Math.min(duration, s.end),
    })),
  )
  const keep: CutSegment[] = []
  let prev = 0
  for (const r of merged) {
    if (r.start > prev + 0.05) {
      keep.push({ start: prev, end: r.start })
    }
    prev = Math.max(prev, r.end)
  }
  if (prev < duration - 0.05) {
    keep.push({ start: prev, end: duration })
  }
  return keep
}

/** Trechos finais a exportar dentro de um pedaço (exclusões têm prioridade sobre recortes). */
export function keepSegmentsForChunk(
  chunk: CutSegment,
  excludeMarks: CutSegment[],
  keepMarks: CutSegment[],
): CutSegment[] {
  const chunkDur = chunk.end - chunk.start
  if (chunkDur < MIN_CHUNK_SEC) return []

  const excludeIn = excludeMarks
    .filter((m) => m.end > chunk.start + 0.05 && m.start < chunk.end - 0.05)
    .map((m) => ({
      start: Math.max(0, m.start - chunk.start),
      end: Math.min(chunkDur, m.end - chunk.start),
    }))

  const keepIn = keepMarks
    .filter((m) => m.end > chunk.start + 0.05 && m.start < chunk.end - 0.05)
    .map((m) => ({
      start: Math.max(chunk.start, m.start),
      end: Math.min(chunk.end, m.end),
    }))

  if (excludeIn.length > 0) {
    return computeKeepFromExclude(chunkDur, excludeIn).map((s) => ({
      start: s.start + chunk.start,
      end: s.end + chunk.start,
    }))
  }

  if (keepIn.length > 0) {
    return mergeSegments(keepIn)
  }

  return [chunk]
}

export function buildChunkExportPlans(
  duration: number,
  splitTimes: number[],
  excludeMarks: CutSegment[],
  keepMarks: CutSegment[],
): EditorChunkPlan[] {
  const chunks = computeChunksFromSplits(duration, splitTimes)
  return chunks
    .map((chunk, i) => {
      const keepSegments = keepSegmentsForChunk(chunk, excludeMarks, keepMarks)
      return {
        index: i + 1,
        label: `c${i + 1}`,
        chunk,
        keepSegments,
      }
    })
    .filter((p) => p.keepSegments.length > 0)
}
