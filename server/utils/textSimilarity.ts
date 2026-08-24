const RELEASE_JUNK =
  /\b(xxx|1080p|720p|540p|480p|2160p|4k|uhd|fhd|hd|web-?dl|webrip|bluray|bdrip|brrip|hdtv|x264|x265|h264|h265|hevc|avc|aac|ac3|dts|mp4|mkv|avi|mov|wmv|wrb|p2p|split|scenes|repack|proper|internal|uncensored|full|hq)\b/gi

const DATE_DOT = /\b\d{2}\.\d{2}\.\d{2}\b/g
const BRACKETS = /\[[^\]]*\]|\([^)]*\)/g

export function normalizeNameForSimilarity(raw: string): { stem: string; tokens: Set<string> } {
  let s = String(raw || '').toLowerCase()
  s = s.replace(/\.[a-z0-9]{2,5}$/i, '')
  s = s.replace(BRACKETS, ' ')
  s = s.replace(DATE_DOT, ' ')
  s = s.replace(RELEASE_JUNK, ' ')
  s = s.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
  const tokens = new Set(
    s
      .split(' ')
      .map((t) => t.trim())
      .filter((t) => t.length > 1),
  )
  return { stem: s, tokens }
}

export function jaccardTokens(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) {
    if (b.has(t)) inter++
  }
  const uni = a.size + b.size - inter
  return uni > 0 ? inter / uni : 0
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatches = new Array<boolean>(a.length).fill(false)
  const bMatches = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let k = 0
  let transpositions = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const m = matches
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3
  let prefix = 0
  const maxPrefix = Math.min(4, a.length, b.length)
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}
