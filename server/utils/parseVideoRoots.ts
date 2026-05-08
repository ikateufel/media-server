/**
 * VIDEO_ROOT pode ser:
 * - uma pasta (caminho absoluto na máquina do servidor)
 * - várias separadas por `|`
 * - JSON array de strings (`["path1","path2"]`)
 */
export function parseVideoRootsFromEnv(raw: string): string[] {
  const t = raw?.trim()
  if (!t) return []
  if (t.startsWith('[')) {
    try {
      const parsed = JSON.parse(t) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean)
      }
    } catch {
      /* cair para uma entrada */
    }
  }
  if (t.includes('|')) {
    return t.split('|').map((s) => s.trim()).filter(Boolean)
  }
  return [t]
}
