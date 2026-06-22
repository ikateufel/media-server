export interface CutSegment {
  start: number
  end: number
}

export function mergeSegments(segments: CutSegment[]): CutSegment[] {
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

/** Trechos a manter = complemento dos trechos a remover. */
export function computeKeepSegments(duration: number, remove: CutSegment[]): CutSegment[] {
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

export function normalizeRemoveSegments(raw: unknown): CutSegment[] {
  if (!Array.isArray(raw)) return []
  const out: CutSegment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const start = Number((item as { start?: unknown }).start)
    const end = Number((item as { end?: unknown }).end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    out.push({ start, end })
  }
  return mergeSegments(out)
}

/** Formato: inicio_segundos duracao_segundos (por linha). */
export function formatCutsFile(keep: CutSegment[]): string {
  return (
    keep
      .map((s) => `${s.start.toFixed(3)} ${Math.max(0.05, s.end - s.start).toFixed(3)}`)
      .join('\n') + '\n'
  )
}
