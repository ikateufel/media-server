/**
 * Verifica vídeos na pasta indicada (por defeito: diretório actual).
 * Por defeito usa **ffmpeg** (descodifica o ficheiro todo → apanha corrupção no meio).
 * Modo `--quick` só usa **ffprobe** (mais rápido, menos rigoroso).
 *
 * `--delete` ou o token **`delete`** nas flags: após o scan, envia os corruptos para a **lixeira**
 * (`trash`); se falhar, tenta apagar directamente (`unlink`).
 *
 * Requer ffmpeg/ffprobe no PATH (ou FFMPEG_DIR no ambiente apontando para …/bin).
 *
 * Uso:
 *   npx tsx scripts/check-videos-integrity.ts
 *   npx tsx scripts/check-videos-integrity.ts --file="H:\pastas\filme.mp4"
 *   npx tsx scripts/check-videos-integrity.ts --dir="H:\videos"
 *   npx tsx scripts/check-videos-integrity.ts -r delete
 *   npx tsx scripts/check-videos-integrity.ts delete --quick
 *
 * Depois de `delete`, os ficheiros problemáticos deixam de existir na pasta — uma nova corrida
 * deve mostrar «0 com problema» (comportamento esperado). Use sempre as mesmas opções (-r, --dir).
 * Saída: uma linha por ficheiro **inválido/corrupto** no stdout; resumo no stderr.
 * Exit code 1 se houver falhas (ou falha ao apagar); 2 se ffmpeg não existir.
 */
import { existsSync } from 'node:fs'
import { stat, unlink, readdir } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { spawnSync } from 'node:child_process'

const VIDEO_EXT = new Set([
  '.mp4',
  '.m4v',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
  '.wmv',
  '.flv',
  '.mpeg',
  '.mpg',
  '.ts',
  '.m2ts',
  '.mts',
  '.ogv',
  '.3gp',
  '.asf',
])

function isVideoFile(path: string): boolean {
  return VIDEO_EXT.has(extname(path).toLowerCase())
}

function resolveFfmpegBin(): string | null {
  const dir = process.env.FFMPEG_DIR?.trim()
  const candidates = ['ffmpeg.exe', 'ffmpeg']
  if (dir) {
    for (const name of candidates) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  for (const name of candidates) {
    const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    })
    if (r.status === 0 && r.stdout?.trim()) {
      const line = r.stdout.trim().split(/\r?\n/)[0]!.trim()
      if (line && existsSync(line)) return line
    }
  }
  return null
}

function resolveFfprobeBin(): string | null {
  const dir = process.env.FFMPEG_DIR?.trim()
  const candidates = ['ffprobe.exe', 'ffprobe']
  if (dir) {
    for (const name of candidates) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  for (const name of candidates) {
    const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    })
    if (r.status === 0 && r.stdout?.trim()) {
      const line = r.stdout.trim().split(/\r?\n/)[0]!.trim()
      if (line && existsSync(line)) return line
    }
  }
  return null
}

async function collectVideoFiles(root: string, recursive: boolean): Promise<string[]> {
  const abs = resolve(root)

  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await stat(abs)
  } catch {
    console.error(`Caminho não existe ou sem permissão: ${abs}`)
    process.exit(2)
  }

  if (st.isFile()) {
    if (!isVideoFile(abs)) {
      console.error(`Extensão não tratada como vídeo: ${abs}`)
      console.error(`Usadas: ${[...VIDEO_EXT].join(', ')}`)
      process.exit(2)
    }
    return [abs]
  }

  if (!st.isDirectory()) {
    console.error(`Não é ficheiro nem pasta: ${abs}`)
    process.exit(2)
  }

  const out: string[] = []

  if (!recursive) {
    const entries = await readdir(abs, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile()) continue
      const p = join(abs, e.name)
      if (isVideoFile(p)) out.push(p)
    }
    return out.sort((a, b) => a.localeCompare(b))
  }

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile() && isVideoFile(p)) out.push(p)
    }
  }

  await walk(abs)
  return out.sort((a, b) => a.localeCompare(b))
}

function checkQuick(ffprobe: string, file: string): { ok: boolean; detail: string } {
  const r = spawnSync(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 },
  )
  const err = (r.stderr || '').trim()
  if (r.status !== 0) return { ok: false, detail: err || `exit ${r.status}` }
  const dur = (r.stdout || '').trim()
  if (!dur || dur === 'N/A' || !Number.isFinite(Number.parseFloat(dur))) {
    return { ok: false, detail: err || 'duração inválida ou ausente' }
  }
  return { ok: true, detail: '' }
}

function checkFull(ffmpeg: string, file: string): { ok: boolean; detail: string } {
  const r = spawnSync(
    ffmpeg,
    ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'],
    {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const err = (r.stderr || '').trim()
  if (r.status !== 0) return { ok: false, detail: err || `exit ${r.status}` }
  return { ok: true, detail: '' }
}

function pullDeleteFlag(argv: string[]): { argv: string[]; deleteBad: boolean } {
  const out: string[] = []
  let deleteBad = false
  for (const a of argv) {
    if (a === '--delete' || /^delete$/i.test(a)) {
      deleteBad = true
      continue
    }
    out.push(a)
  }
  return { argv: out, deleteBad }
}

function parseArgs(argv: string[]) {
  let dir = process.cwd()
  let recursive = false
  let quick = false

  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
Verifica vídeos na pasta (integridade por defeito via ffmpeg).

  --dir=<pasta ou vídeo>  Pasta OU caminho completo de UM ficheiro (.mp4, .mkv, …)
  --file=<vídeo>          Igual a --dir quando é só um ficheiro (aspas se tiver espaços)
  -r, --recursive        Subpastas (ignorado se --dir/--file for um ficheiro)
  --quick                Só ffprobe (rápido; não descodifica o ficheiro todo)
  delete, --delete        Após o scan, remove os corruptos (lixeira; fallback: apagar)

Um vídeo só (para colar o resultado noutro sítio):
  npx tsx scripts/check-videos-integrity.ts --file=".\\videos\\nome.mp4"

Directo no ffmpeg (mesmo teste «completo»):
  ffmpeg -hide_banner -nostdin -v error -xerror -i "CAMINHO.mp4" -f null -

Variável FFMPEG_DIR: pasta bin do FFmpeg no Windows se não estiver no PATH.
`)
      process.exit(0)
    }
    if (a === '-r' || a === '--recursive') recursive = true
    if (a === '--quick') quick = true
    const mDir = a.match(/^--dir=(.+)$/)
    if (mDir) dir = mDir[1]!.replace(/^["']|["']$/g, '')
    const mFile = a.match(/^--file=(.+)$/)
    if (mFile) dir = mFile[1]!.replace(/^["']|["']$/g, '')
  }

  return { dir: resolve(dir), recursive, quick }
}

async function deleteCorruptedFiles(paths: string[]): Promise<number> {
  let failed = 0
  const { default: trash } = await import('trash')
  for (const p of paths) {
    try {
      await trash(p, { glob: false })
      console.error(`[lixeira] ${p}`)
    } catch {
      try {
        await unlink(p)
        console.error(`[apagado] ${p} (sem lixeira — pacote trash falhou)`)
      } catch (e) {
        console.error(`[FALHOU] ${p}`, e instanceof Error ? e.message : e)
        failed++
      }
    }
  }
  return failed
}

async function main() {
  const raw = process.argv.slice(2)
  const { argv, deleteBad } = pullDeleteFlag(raw)
  const { dir, recursive, quick } = parseArgs(argv)

  const ffmpeg = resolveFfmpegBin()
  const ffprobe = resolveFfprobeBin()

  if (quick) {
    if (!ffprobe) {
      console.error('ffprobe não encontrado no PATH (ou defina FFMPEG_DIR para …/bin).')
      process.exit(2)
    }
  } else {
    if (!ffmpeg) {
      console.error('ffmpeg não encontrado no PATH (ou defina FFMPEG_DIR para …/bin).')
      process.exit(2)
    }
  }

  const files = await collectVideoFiles(dir, recursive)
  const singleArgFile =
    files.length === 1 && resolve(files[0]!) === resolve(dir)
  const scope = singleArgFile
    ? `Um ficheiro: ${files[0]}`
    : `Pasta: ${dir}${recursive ? ' (recursivo)' : ''}`
  console.error(`${scope} — modo: ${quick ? 'quick (ffprobe)' : 'completo (ffmpeg)'}`)
  console.error(`Ficheiros de vídeo encontrados: ${files.length}`)
  if (singleArgFile && recursive) {
    console.error('(Opção -r irrelevante: caminho é um só ficheiro.)')
  }
  if (deleteBad) console.error('Modo delete: corruptos serão enviados para a lixeira após o scan.')

  const badPaths: string[] = []
  let bad = 0
  for (const file of files) {
    const r = quick ? checkQuick(ffprobe!, file) : checkFull(ffmpeg!, file)
    if (!r.ok) {
      bad++
      badPaths.push(file)
      console.log(file)
      if (r.detail) {
        if (singleArgFile) {
          console.error('stderr ffmpeg/ffprobe (completo):')
          console.error(r.detail)
        } else {
          console.error(`  └─ ${r.detail.split(/\r?\n/).slice(0, 5).join(' | ')}`)
        }
      }
    }
  }

  const ok = files.length - bad
  console.error('---')
  console.error(`Resumo: ${ok} vídeo(s) OK, ${bad} com problema(s) (${files.length} ficheiro(s) verificado(s)).`)

  if (bad === 0) {
    console.error('Nenhum problema detectado.')
    if (!recursive && files.length > 0 && !singleArgFile) {
      console.error(
        'Nota: só esta pasta (sem subpastas). Para incluir subpastas use -r ou --recursive.',
      )
    }
    if (deleteBad) {
      console.error('Modo delete activo — não havia nada a remover.')
    }
    process.exit(0)
  }

  console.error(`${bad} caminho(s) com problema listados em stdout.`)

  if (!deleteBad) {
    console.error(
      'Para enviar estes ficheiros para a lixeira depois do scan: acrescente delete ou --delete à linha de comandos.',
    )
    process.exit(1)
  }

  console.error(`A remover ${badPaths.length} ficheiro(s) para a lixeira (ou apagar directamente se falhar)…`)
  const delFailed = await deleteCorruptedFiles(badPaths)
  if (delFailed > 0) {
    console.error(`${delFailed} remoção(ões) falharam.`)
    process.exit(1)
  }
  console.error('Remoção concluída.')
  console.error(
    'Estes caminhos já não existem nesta pasta — voltar a correr o script deve mostrar «0 com problema», salvo novos vídeos corruptos.',
  )
  process.exit(0)
}

void main()
