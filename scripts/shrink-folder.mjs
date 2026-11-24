// Enfileira trailer + shrink in-place (sem backup) de todos os vídeos de uma pasta.
// Uso: node scripts/shrink-folder.mjs "H:\temp\note_h\downloaded\Reina Ohara" [--no-trailer] [--height 1080] [--speed 1.5]
// Requer o servidor a correr (NITRO_PORT, por defeito 3000) e a pasta dentro de uma biblioteca do menu.
import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const folder = args.find((a, i) => !a.startsWith('--') && !['--height', '--speed'].includes(args[i - 1]))
if (!folder) {
  console.error('Uso: node scripts/shrink-folder.mjs "<pasta>" [--no-trailer] [--height 1080] [--speed 1.5]')
  process.exit(1)
}

const base = `http://localhost:${process.env.NITRO_PORT || 3000}/api/admin`
const abs = resolve(folder)
const db = new DatabaseSync(join(import.meta.dirname, '..', 'data', 'library-tags.sqlite'), { readOnly: true })
const roots = db.prepare('SELECT sort_order, path FROM video_menu_items ORDER BY sort_order').all()
const lc = (s) => s.toLowerCase()
const root = roots
  .filter((r) => lc(abs) === lc(resolve(r.path)) || lc(abs).startsWith(lc(resolve(r.path)) + sep))
  .sort((a, b) => b.path.length - a.path.length)[0]
if (!root) {
  console.error('Pasta fora de qualquer biblioteca do menu.')
  process.exit(1)
}

const SKIP = new Set(['trailers', 'preview', 'shrinked', 'edited', '.thumb_cache'])
const EXT = /\.(mp4|mkv|avi|mov|wmv|m4v|webm|ts|flv|3gp)$/i
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? SKIP.has(e.name.toLowerCase()) || e.name.startsWith('.') ? [] : walk(join(dir, e.name))
      : EXT.test(e.name) ? [join(dir, e.name)] : [],
  )
}

const params = { height: Number(opt('--height', 1080)), speed: Number(opt('--speed', 1.5)), codec: 'h264_nvenc', prioritizeSize: true }
const post = async (path, body) => {
  const r = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return r.status
}

const files = walk(abs)
console.log(`${files.length} vídeos, biblioteca ${root.sort_order} (${root.path})`)
for (const f of files) {
  const rel = relative(resolve(root.path), f).split(sep).join('/')
  const item = { action: 'enqueue', session: root.sort_order, mainRel: rel, label: rel.split('/').pop() }
  const trailerRel = rel.includes('/') ? rel.replace(/(^|\/)([^/]+)$/, '$1trailers/$2') : 'trailers/' + rel
  if (!flag('--no-trailer')) console.log('trailer', await post('trailer-reprocess-queue', { ...item, trailerRel }), rel)
  console.log('shrink ', await post('shrink-in-place-queue', { ...item, trailerRel, params }), rel)
}
