import { stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { resolveCatalogRelAbsoluteCandidates } from './trailerNames'

/** `preview/foo.mkv` ou `preview/Sub/foo.mkv` conforme o trailer. */
function previewRelFromTrailerRelative(trailerRelative: string): string {
  return `preview/${trailerRelative}`.replace(/\\/g, '/')
}

/**
 * Extensões de vídeo em `preview/` a tentar com o mesmo stem que o trailer.
 * Slideshow legado em `preview/` (geração descontinuada; preview.bat gera só `.thumb_cache/`).
 * Por defeito devolve `trailers/…` para miniaturas e reprodução do trailer.
 */
const PREVIEW_VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.avi'] as const

function orderedPreviewExts(trailerExt: string): string[] {
  const e = trailerExt.toLowerCase()
  const rest = PREVIEW_VIDEO_EXTS.filter((x) => x !== e)
  return [e, ...rest]
}

/**
 * Vídeo de catálogo em `preview/`: mesmo stem que o trailer em `trailers/`
 * (ex. `trailers/Filme.mkv` → `preview/Filme.mp4` gerado pelo preview.bat).
 *
 * Legado em `trailers/`: `preview.{stem}`, `preview_{stem}`, `{stem}.preview`,
 * `{stem}_preview` (várias extensões, como em `preview/`).
 *
 * Se não houver cópia em `preview/`, usa-se o próprio ficheiro em `trailers/` (mesmo `rel` para thumbs).
 */
export async function resolvePreviewTrailerRel(
  root: string,
  trailerFileName: string,
): Promise<string | null> {
  const norm = trailerFileName.replace(/\\/g, '/')
  const rawExt = extname(norm)
  const stem = basename(norm, rawExt)
  const extLower = rawExt.toLowerCase()
  const relDir = norm.includes('/') ? norm.slice(0, Math.max(0, norm.lastIndexOf('/'))) : ''

  // Miniaturas e palco: fonte principal é o trailer (não depende de preview/ no disco).
  const trailersDir = join(root, 'trailers')
  const trailerSelf = join(trailersDir, norm)
  try {
    const st = await stat(trailerSelf)
    if (st.isFile()) return `trailers/${norm}`.replace(/\\/g, '/')
  } catch {
    /* */
  }
  const trailerCatalogRel = `trailers/${norm}`.replace(/\\/g, '/')
  for (const cand of resolveCatalogRelAbsoluteCandidates(root, trailerCatalogRel)) {
    try {
      const st = await stat(cand)
      if (st.isFile()) return trailerCatalogRel
    } catch {
      /* */
    }
  }

  const inPreviewDir = join(root, 'preview', norm)
  try {
    const st = await stat(inPreviewDir)
    if (st.isFile()) return previewRelFromTrailerRelative(norm)
  } catch {
    /* não existe */
  }

  for (const pext of orderedPreviewExts(extLower)) {
    const name = stem + pext
    const relPath = relDir ? `${relDir}/${name}` : name
    if (relPath === norm) continue
    const full = join(root, 'preview', relPath)
    try {
      const st = await stat(full)
      if (st.isFile()) return previewRelFromTrailerRelative(relPath)
    } catch {
      /* */
    }
  }

  for (const pext of orderedPreviewExts(extLower)) {
    const legacyNames = [
      `preview.${stem}${pext}`,
      `preview_${stem}${pext}`,
      `${stem}.preview${pext}`,
      `${stem}_preview${pext}`,
    ]
    for (const name of legacyNames) {
      const full = join(trailersDir, name)
      try {
        const st = await stat(full)
        if (st.isFile()) return `trailers/${name}`.replace(/\\/g, '/')
      } catch {
        /* */
      }
    }
  }

  // Compat legado: ficheiros guardados em "<sub>/preview/<file>".
  const previewCatalogRel = `preview/${norm}`.replace(/\\/g, '/')
  for (const cand of resolveCatalogRelAbsoluteCandidates(root, previewCatalogRel)) {
    try {
      const st = await stat(cand)
      if (st.isFile()) return previewCatalogRel
    } catch {
      /* */
    }
  }

  return null
}
