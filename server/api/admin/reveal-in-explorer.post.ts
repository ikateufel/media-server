import { stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { normalize } from 'node:path'
import { createError, readBody } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'
import { parseSessionQuery } from '../../utils/videoSession'
import { resolveSafeUnderRoot } from '../../utils/videoPaths'

/**
 * Abre o Explorador com o ficheiro seleccionado.
 *
 * Evita `execFile` a aguardar exit code: no Windows o `explorer.exe` frequentemente termina
 * com código ≠ 0 (ex. 1) mesmo quando a janela abre, e o Node devolve "Command failed".
 *
 * Caminho como **2.º argumento** (`/select,` + path) — sem uma única string entre aspas —
 * comporta-se bem com espaços, `'` no nome, parênteses, etc.
 */
function spawnExplorerSelect(absolutePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('explorer.exe', ['/select,', absolutePath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export default defineEventHandler(async (event) => {
  if (process.platform !== 'win32') {
    throw createError({
      statusCode: 501,
      statusMessage: 'Abrir no Explorador só está disponível quando o servidor corre em Windows.',
    })
  }

  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const roots = getVideoRootsFromRuntime(config)
  if (!roots.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).',
    })
  }

  const raw = (await readBody(event).catch(() => null)) as {
    session?: unknown
    target?: unknown
    rel?: unknown
  } | null

  const session = parseSessionQuery(
    { session: raw?.session },
    roots.length,
  )

  const target = String(raw?.target ?? '')
    .trim()
    .toLowerCase()
  if (target !== 'main' && target !== 'trailer' && target !== 'preview') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Campo "target" inválido: use "main", "trailer" ou "preview".',
    })
  }

  const rel = String(raw?.rel ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!rel || rel.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "rel" inválido.' })
  }

  if (target === 'trailer' && !rel.startsWith('trailers/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Para trailer, "rel" deve começar por trailers/',
    })
  }
  if (target === 'preview' && !rel.startsWith('preview/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Para preview, "rel" deve começar por preview/',
    })
  }

  const root = roots[session]!.trim()
  let absPath: string
  try {
    absPath = resolveSafeUnderRoot(root, rel)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Caminho não autorizado para esta biblioteca.' })
  }

  try {
    await stat(absPath)
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: 'Ficheiro não encontrado na pasta da biblioteca.',
    })
  }

  const normalized = normalize(absPath)

  try {
    await spawnExplorerSelect(normalized)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw createError({
      statusCode: 500,
      statusMessage: `Não foi possível abrir o Explorador: ${msg}`,
    })
  }

  return { ok: true as const }
})
