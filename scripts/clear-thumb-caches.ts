/**
 * Apaga caches de miniaturas do catálogo:
 * - `data/preview-frame-cache/` (legado no projecto)
 * - `<cada VIDEO_ROOT>/.thumb_cache/` (cache actual por biblioteca)
 *
 * Lê raízes como o warm: `data/video-menu.json` ou `VIDEO_ROOT` no `.env`.
 *
 * Uso: npx tsx scripts/clear-thumb-caches.ts
 *      npm run clear-thumb-caches
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PREVIEW_THUMB_CACHE_DIR } from '../server/utils/previewFrameCache'
import { getVideoRootsForCli } from '../server/utils/videoMenu'

function loadDotenv() {
  const p = join(process.cwd(), '.env')
  if (!existsSync(p)) return
  const text = readFileSync(p, 'utf-8')
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

function emptyDir(dir: string) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    rmSync(join(dir, name), { recursive: true, force: true })
  }
}

function main() {
  loadDotenv()
  const legacy = join(process.cwd(), 'data', 'preview-frame-cache')
  console.log('[clear] Esvaziar:', legacy)
  emptyDir(legacy)
  mkdirSync(legacy, { recursive: true })

  const roots = getVideoRootsForCli()
  if (!roots.length) {
    console.warn('[clear] Sem raízes (video-menu.json ou VIDEO_ROOT). Só legacy foi limpo.')
    return
  }
  for (const root of roots) {
    const r = root.trim()
    if (!r) continue
    const thumb = join(r, PREVIEW_THUMB_CACHE_DIR)
    if (existsSync(thumb)) {
      console.log('[clear] Remover:', thumb)
      rmSync(thumb, { recursive: true, force: true })
    }
  }
  console.log('[clear] Concluído. Correr `npm run warm-preview-cache` para regenerar JPEGs.')
}

try {
  main()
} catch (e) {
  console.error(e)
  process.exit(1)
}
