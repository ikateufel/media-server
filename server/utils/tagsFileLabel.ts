/**
 * Convenção de nomes para data/file-lists/tags_<rótulo>.csv:
 * árvore relativa (ex. zz_checking\\chica) → rótulo com segmentos unidos por ponto: zz_checking.chica
 * → ficheiro tags_zz_checking.chica.csv
 *
 * O title no video-menu.json da sessão folha deve coincidir com esse rótulo (import-tags-filelists).
 */
const BAD = '<>:"/\\|?*'

export function safeTagsLabelSegment(seg: string): string {
  let out = ''
  for (const c of seg.trim()) {
    out += BAD.includes(c) ? '_' : c
  }
  return out.trim()
}

/** Partes separadas por \\ ou / ; cada parte sanitizada; junta com "." */
export function relativeTreePathToTagsFileLabel(relPath: string): string {
  const parts = relPath
    .split(/[/\\]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(safeTagsLabelSegment)
    .filter(Boolean)
  return parts.length ? parts.join('.') : 'Tags_Automaticas'
}
