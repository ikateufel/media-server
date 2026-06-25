import { isVideoFileName } from './videoExtensions'

export interface ShrinkListFilePayload {
  sourceRoot: string
  files: string[]
  count: number
  phase2Count: number
  phase3Count: number
  needsPrioritizeSize: boolean
}

function looksLikeWindowsRoot(line: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(line.trim())
}

function parsePhaseLine(raw: string): { phase: 2 | 3 | null; name: string } {
  const t = raw.trim()
  const m = t.match(/^([23])\|(.+)$/)
  if (m) return { phase: Number(m[1]) as 2 | 3, name: m[2]!.trim() }
  return { phase: null, name: t }
}

/** 1.ª linha = pasta origem; resto = nomes (opcional prefixo 2| ou 3|). */
export function parseShrinkListFile(content: string): ShrinkListFilePayload {
  let sourceRoot = ''
  const files: string[] = []
  const seen = new Set<string>()
  let phase2Count = 0
  let phase3Count = 0

  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    if (!sourceRoot && looksLikeWindowsRoot(t)) {
      sourceRoot = t
      continue
    }
    const { phase, name } = parsePhaseLine(t)
    if (!isVideoFileName(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    files.push(name.replace(/\\/g, '/'))
    if (phase === 2) phase2Count++
    if (phase === 3) phase3Count++
  }

  return {
    sourceRoot,
    files,
    count: files.length,
    phase2Count,
    phase3Count,
    needsPrioritizeSize: phase3Count > 0,
  }
}

export function formatShrinkListFile(sourceRoot: string, files: string[]): string {
  const root = sourceRoot.trim()
  const seen = new Set<string>()
  const lines = [root, '# Fila Shrink — 1ª linha = pasta de origem']
  for (const raw of files) {
    const rel = String(raw ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!rel) continue
    const key = rel.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(rel)
  }
  return `${lines.join('\n')}\n`
}

export const SHRINK_LIST_FILE_DEFAULT_NAME = 'shrink-fila.txt'

export const SHRINK_LIST_FILE_PICKER_TYPES = [
  {
    description: 'Lista Shrink',
    accept: { 'text/plain': ['.txt'] },
  },
] as const
