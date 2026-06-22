export interface CutSegment {
  start: number
  end: number
}

export interface RemoveSegment extends CutSegment {
  id: string
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

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
  }
  return `${m}:${String(s).padStart(2, '0')}.${ms}`
}

export function parseTimeInput(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  const parts = t.split(':').map((p) => p.trim())
  if (parts.length === 2) {
    const m = Number(parts[0])
    const s = Number(parts[1])
    if (Number.isFinite(m) && Number.isFinite(s)) return m * 60 + s
  }
  if (parts.length === 3) {
    const h = Number(parts[0])
    const m = Number(parts[1])
    const s = Number(parts[2])
    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) return h * 3600 + m * 60 + s
  }
  return null
}
