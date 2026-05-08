import { statSync } from 'node:fs'
import { stat as statAsync } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, extname, join } from 'node:path'

/**
 * Caminho dentro de `trailers/` com no máximo uma subpasta (`f.mp4` ou `Sub/f.mp4`).
 * Usado para vídeos em `trailers/<pasta>/` sem recursão mais profunda.
 */
export function parseTrailersDirRelativePath(trailerRelWithinTrailers: string): {
  subfolder: string | null
  fileName: string
} | null {
  const n = trailerRelWithinTrailers.replace(/\\/g, '/').trim()
  if (!n || n.includes('..')) return null
  const parts = n.split('/').filter(Boolean)
  if (parts.length === 1) return { subfolder: null, fileName: parts[0]! }
  if (parts.length === 2) return { subfolder: parts[0]!, fileName: parts[1]! }
  return null
}

/** Duas primeiras “palavras” do nome da pasta (separadores espaço ou ponto), como uma única etiqueta. */
export function folderPairWordsTag(folderName: string): string {
  const parts = folderName.trim().split(/[\s.]+/).filter(Boolean)
  if (!parts.length) return ''
  return parts.slice(0, Math.min(2, parts.length)).join(' ')
}

/** Rótulo na grelha para trailer dentro de subpasta: «Nome Pasta-01» (preserva casing das palavras escolhidas). */
export function gridLabelForTrailersSubfolder(folderName: string, videoFileName: string): string {
  const parts = folderName.trim().split(/[\s.]+/).filter(Boolean)
  const head = parts.slice(0, Math.min(2, parts.length)).join(' ')
  const stem = basename(videoFileName, extname(videoFileName))
  return `${head}-${stem}`
}

/** `trailers/<isto>` com no máximo uma subpasta e ficheiro de trailer reconhecido. */
export function isCatalogTrailerRelSuffix(s: string): boolean {
  const parsed = parseTrailersDirRelativePath(s)
  if (!parsed) return false
  return !!trailerToMainFilename(parsed.fileName)
}

/**
 * Mapeia rel de catálogo para caminhos reais suportando legado:
 * - padrão: trailers/<sub>/f.mp4 e preview/<sub>/f.mp4
 * - legado misto: <sub>/trailers/f.mp4 e <sub>/preview/f.mp4
 */
export function resolveCatalogRelAbsoluteCandidates(root: string, rel: string): string[] {
  const norm = rel.replace(/\\/g, '/').trim()
  if (!norm || norm.includes('..')) return []
  const base = [join(root, ...norm.split('/'))]

  const parts = norm.split('/').filter(Boolean)
  if (parts.length !== 3) return base
  const [kind, sub, file] = parts
  if ((kind === 'trailers' || kind === 'preview') && sub && file) {
    base.push(join(root, sub, kind, file))
  }
  return base
}

/** Extensões tratadas como trailer em `trailers/` (nome “plano” = mesmo stem que o filme + ext). */
const TRAILER_VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.m4v', '.mov', '.avi'])

/**
 * `zz_{nome}_acelerado.ext` → `{nome}.ext` (legado dos .bat antigos).
 * Devolve `null` se o nome não seguir esse padrão.
 */
export function legacyTrailerBasenameToFlat(trailerFileName: string): string | null {
  const ext = extname(trailerFileName).toLowerCase()
  const base = basename(trailerFileName, ext)
  if (!base.startsWith('zz_') || !base.endsWith('_acelerado')) return null
  const core = base.slice(3, base.length - '_acelerado'.length)
  if (!core.length) return null
  return core + ext
}

/**
 * Ficheiro em `trailers/` tipo `preview.zz_*_acelerado.ext` → nome final em `preview/` (`{nome}.ext`).
 */
export function legacyPreviewInTrailersToFlat(filename: string): string | null {
  if (!filename.toLowerCase().startsWith('preview.')) return null
  const ext = extname(filename).toLowerCase()
  const rest = basename(filename, ext).slice('preview.'.length)
  return legacyTrailerBasenameToFlat(rest + ext)
}

/**
 * `trailers/{nome}.ext` (novo) ou `trailers/zz_{nome}_acelerado.ext` (legado) → `{nome}.ext` na raiz da sessão.
 * Ignora ficheiros cujo nome começa por `preview.` (previews antigos dentro de `trailers/`).
 */
export function trailerToMainFilename(trailerName: string): string | null {
  const ext = extname(trailerName).toLowerCase()
  const base = basename(trailerName, ext)

  if (base.toLowerCase().startsWith('preview.') || base.startsWith('.')) return null

  const legacy = legacyTrailerBasenameToFlat(trailerName)
  if (legacy) return legacy

  if (TRAILER_VIDEO_EXT.has(ext)) return base + ext

  return null
}

/** Completo na raiz: mesmo stem que o trailer; provar extensões (trailer pode ser .mp4 e o filme .mkv). */
export const MAIN_COMPLETE_TRY_EXTS = ['.mp4', '.mkv', '.m4v', '.webm', '.mov', '.avi'] as const

function orderedMainExtensionsForTrailer(trailerName: string): readonly string[] {
  const guessed = trailerToMainFilename(trailerName)
  if (!guessed) return MAIN_COMPLETE_TRY_EXTS
  const ex = extname(guessed).toLowerCase()
  const rest = MAIN_COMPLETE_TRY_EXTS.filter((e) => e !== ex)
  return [ex, ...rest]
}

/** Stem do ficheiro completo esperado na raiz (ex. `Filme` para `trailers/Filme.mp4`). */
export function getMainStemFromTrailerName(trailerName: string): string | null {
  const guessed = trailerToMainFilename(trailerName)
  if (!guessed) return null
  return basename(guessed, extname(guessed))
}

/**
 * Localiza o vídeo completo na raiz da sessão: mesmo stem que o trailer, várias extensões.
 * Tenta primeiro a extensão “óbvia” a partir do nome do trailer, depois as restantes.
 */
export async function findMainFileInSessionRoot(
  root: string,
  trailerName: string,
): Promise<{ mainFilename: string; stat: Stats } | null> {
  const parsed = parseTrailersDirRelativePath(trailerName)
  const fileName = parsed?.fileName ?? trailerName
  const stem = getMainStemFromTrailerName(fileName)
  if (!stem) return null
  const r = root.trim()
  const candidatePrefixes =
    parsed?.subfolder && !parsed.subfolder.includes('/') ? ['', parsed.subfolder] : ['']
  for (const ext of orderedMainExtensionsForTrailer(trailerName)) {
    for (const prefix of candidatePrefixes) {
      const baseName = stem + ext
      const mainFilename = prefix ? `${prefix}/${baseName}` : baseName
      const mainPath = join(r, ...mainFilename.split('/'))
      try {
        const st = await statAsync(mainPath)
        if (st.isFile()) return { mainFilename, stat: st }
      } catch {
        /* */
      }
    }
  }
  return null
}

export function findMainFileInSessionRootSync(
  root: string,
  trailerName: string,
): { mainFilename: string; stat: Stats } | null {
  const parsed = parseTrailersDirRelativePath(trailerName)
  const fileName = parsed?.fileName ?? trailerName
  const stem = getMainStemFromTrailerName(fileName)
  if (!stem) return null
  const r = root.trim()
  const candidatePrefixes =
    parsed?.subfolder && !parsed.subfolder.includes('/') ? ['', parsed.subfolder] : ['']
  for (const ext of orderedMainExtensionsForTrailer(trailerName)) {
    for (const prefix of candidatePrefixes) {
      const baseName = stem + ext
      const mainFilename = prefix ? `${prefix}/${baseName}` : baseName
      const mainPath = join(r, ...mainFilename.split('/'))
      try {
        const st = statSync(mainPath)
        if (st.isFile()) return { mainFilename, stat: st }
      } catch {
        /* */
      }
    }
  }
  return null
}
