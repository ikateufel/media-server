/**
 * Pré-gera os JPEG em `<VIDEO_ROOT>/.thumb_cache/` (mesma lógica que GET /api/library/preview-frame),
 * sem abrir o browser — útil após migração de ficheiros ou num servidor headless.
 *
 * Requer ffmpeg/ffprobe no PATH. Lê raízes como o Nuxt: video-menu.json ou VIDEO_ROOT no .env.
 *
 * Uso (na raiz do projecto):
 *   npx tsx scripts/warm-preview-frame-cache.ts
 *   npx tsx scripts/warm-preview-frame-cache.ts --force
 *   npx tsx scripts/warm-preview-frame-cache.ts --session=0
 *   npm run warm-preview-cache
 */
import { existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ensurePreviewFrameCached,
  listPreviewRelsForVideoRoot,
  PREVIEW_FRAME_SLOT_COUNT,
  PREVIEW_THUMB_CACHE_DIR,
} from '../server/utils/previewFrameCache'
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

function parseArgs(argv: string[]) {
  let force = false
  let onlySession: number | null = null
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Gera cache de miniaturas (4 slots por preview) em <VIDEO_ROOT>/${PREVIEW_THUMB_CACHE_DIR}/.

  --force       Regenera mesmo que o JPEG ja exista (mesmo mtime)
  --session=N   So a sessao N (indice do menu / VIDEO_ROOT)
`)
      process.exit(0)
    }
    if (a === '--force') force = true
    const m = a.match(/^--session=(\d+)$/)
    if (m) onlySession = Number(m[1])
  }
  return { force, onlySession }
}

async function main() {
  loadDotenv()
  const { force, onlySession } = parseArgs(process.argv.slice(2))
  const roots = getVideoRootsForCli()
  if (!roots.length) {
    console.error('Sem raizes: defina VIDEO_ROOT no .env ou data/video-menu.json.')
    process.exit(1)
  }

  let hits = 0
  let built = 0
  let errors = 0

  for (let s = 0; s < roots.length; s++) {
    if (onlySession !== null && s !== onlySession) continue
    const root = roots[s]!.trim()
    try {
      await stat(root)
    } catch {
      console.warn(`[sessao ${s}] Raiz inexistente: ${root}`)
      continue
    }

    const rels = await listPreviewRelsForVideoRoot(root)
    console.log(`\n[sessao ${s}] ${root}`)
    console.log(`  previews com ficheiro: ${rels.length}`)
    for (const rel of rels) {
      for (let slot = 0; slot < PREVIEW_FRAME_SLOT_COUNT; slot++) {
        const st = await ensurePreviewFrameCached({ root, rel, slot, force })
        if (st === 'hit') hits++
        else if (st === 'built') built++
        else {
          errors++
          console.warn(`  [${slot}] ${rel} -> ${st}`)
        }
      }
    }
  }

  console.log(
    `\nResumo: ${built} gerados, ${hits} ja em cache${force ? ' (--force: entradas antigas apagadas antes de gerar)' : ''}${errors ? `, ${errors} falhas` : ''}.`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
