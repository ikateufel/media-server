import { basename, resolve } from 'node:path'

export type RootsConfig = { videoRoots?: unknown; videoRoot?: string }

/**
 * Rótulo da pasta no menu: último segmento do caminho; se repetido, "Nome (2)", "Nome (3)"…
 * @see server/api/sessions.get.ts
 */
export function buildSessionFolderLabels(roots: string[]): string[] {
  const count = new Map<string, number>()
  return roots.map((root) => {
    const base = basename(resolve(root.trim()))
    const k = count.get(base) ?? 0
    count.set(base, k + 1)
    return k === 0 ? base : `${base} (${k + 1})`
  })
}

export function getVideoRootsFromConfig(config: RootsConfig): string[] {
  const arr = config.videoRoots
  if (Array.isArray(arr) && arr.length) {
    const out = arr.map((x) => String(x).trim()).filter(Boolean)
    if (out.length) return out
  }
  const single = (config.videoRoot as string)?.trim()
  return single ? [single] : []
}

export function parseSessionQuery(
  query: Record<string, unknown> | undefined | null,
  numRoots: number
): number {
  if (numRoots <= 0) return 0
  const raw = query?.session ?? query?.sess
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n < 0 || n >= numRoots) return 0
  return Math.floor(n)
}
