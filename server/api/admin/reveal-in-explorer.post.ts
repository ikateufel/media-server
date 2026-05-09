import { stat } from 'node:fs/promises'
import { exec, spawn } from 'node:child_process'
import { dirname, join, normalize } from 'node:path'
import { promisify } from 'node:util'
import { createError, readBody } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'
import { parseSessionQuery } from '../../utils/videoSession'
import { resolveSafeUnderRoot } from '../../utils/videoPaths'
const execAsync = promisify(exec)

const LOG = '[reveal-in-explorer]'

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).trimEnd()
}

function windowsRoot(): string {
  return (process.env.SystemRoot || process.env.windir || 'C:\\Windows').replace(/[/\\]+$/, '')
}

function explorerExecutablePath(): string {
  return join(windowsRoot(), 'explorer.exe')
}

function toWin32ExplorerPath(absolutePath: string): string {
  return normalize(absolutePath).replace(/\//g, '\\')
}

function spawnDetachedOnce(command: string, args: string[], hide = true): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      ...(process.platform === 'win32' ? { windowsHide: hide } : {}),
    })
    const t = setTimeout(() => {
      console.error(LOG, 'spawn: timeout 5s (resolver para não bloquear o pedido HTTP)', { command })
      resolve()
    }, 5000)
    child.once('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
    child.once('spawn', () => {
      clearTimeout(t)
      try {
        child.unref()
      } catch {
        /* */
      }
      resolve()
    })
  })
}

/**
 * Windows: usa exatamente `explorer.exe /select, "<caminho>"`.
 */
async function spawnExplorerSelect(absPath: string): Promise<void> {
  const winPath = toWin32ExplorerPath(absPath)
  const command = `explorer.exe /select, "${winPath}"`
  console.error(LOG, 'windows: exec', { command })
  try {
    await execAsync(command, { windowsHide: true })
  } catch (e: unknown) {
    const ex = e as { code?: unknown; message?: unknown }
    const msg = String(ex?.message ?? '')
    /**
     * `explorer.exe` frequentemente devolve exit code != 0 mesmo abrindo corretamente.
     * Se o padrão for "Command failed", tratamos como sucesso para não mostrar erro falso na UI.
     */
    if (msg.includes('Command failed')) {
      console.error(LOG, 'windows: explorer retornou "Command failed", mas foi ignorado')
      return
    }
    throw e
  }
}

/** macOS: abre a pasta do vídeo no Finder. */
async function revealInMacosFinder(absolutePath: string): Promise<void> {
  const folder = normalize(dirname(absolutePath))
  console.error(LOG, 'darwin: open pasta', { folder })
  try {
    await spawnDetachedOnce('open', [folder], false)
    console.error(LOG, 'darwin: spawn open OK')
  } catch (e) {
    console.error(LOG, 'darwin: spawn open FALHOU', { folder, erro: errMsg(e) })
    throw e
  }
}

/** Linux: abre a pasta do vídeo no gestor por omissão. */
async function revealOnLinux(absolutePath: string): Promise<void> {
  const dir = normalize(dirname(absolutePath))
  const strategies: Array<[string, string[]]> = [
    ['xdg-open', [dir]],
    ['nautilus', [dir]],
    ['dolphin', [dir]],
    ['nemo', [dir]],
  ]
  let lastErr: unknown
  for (let i = 0; i < strategies.length; i++) {
    const [cmd, args] = strategies[i]!
    try {
      console.error(LOG, `linux: tentativa ${i + 1}/${strategies.length}`, { cmd })
      await spawnDetachedOnce(cmd, args, false)
      console.error(LOG, 'linux: spawn OK', { cmd })
      return
    } catch (e) {
      console.error(LOG, 'linux: comando falhou', { cmd, erro: errMsg(e) })
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function revealInOsFileManager(absolutePath: string): Promise<void> {
  const p = process.platform
  console.error(LOG, 'revealInOsFileManager', { platform: p })
  if (p === 'win32') {
    await spawnExplorerSelect(absolutePath)
    return
  }
  if (p === 'darwin') {
    await revealInMacosFinder(absolutePath)
    return
  }
  if (p === 'linux') {
    await revealOnLinux(absolutePath)
    return
  }
  throw new Error(`Plataforma não suportada: ${p}`)
}

export default defineEventHandler(async (event) => {
  const platform = process.platform
  console.error(LOG, 'POST recebido', {
    platform,
    url: event.path,
    temVideoAdminToken: Boolean((process.env.VIDEO_ADMIN_TOKEN ?? '').trim()),
    temNuxtAdminToken: Boolean((process.env.NUXT_ADMIN_TOKEN ?? '').trim()),
  })

  try {
    if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
      console.error(LOG, 'rejeitado: plataforma não suportada', platform)
      throw createError({
        statusCode: 501,
        statusMessage:
          'Abrir pasta no gestor de ficheiros só está disponível com o servidor em Windows, macOS ou Linux.',
      })
    }

    const config = useRuntimeConfig(event)
    requireAdminToken(event)
    console.error(LOG, 'token admin verificado OK')

    const roots = getVideoRootsFromRuntime(config)
    if (!roots.length) {
      console.error(LOG, 'FALHA: sem roots (video-menu / VIDEO_ROOT)')
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

    if (!raw || typeof raw !== 'object') {
      console.error(LOG, 'FALHA: body JSON vazio ou inválido', { rawType: typeof raw })
      throw createError({ statusCode: 400, statusMessage: 'Corpo JSON em falta ou inválido.' })
    }

    const session = parseSessionQuery({ session: raw?.session }, roots.length)

    const target = String(raw?.target ?? '')
      .trim()
      .toLowerCase()
    if (target !== 'main' && target !== 'trailer' && target !== 'preview') {
      console.error(LOG, 'FALHA: target inválido', { target: raw?.target })
      throw createError({
        statusCode: 400,
        statusMessage: 'Campo "target" inválido: use "main", "trailer" ou "preview".',
      })
    }

    const rel = String(raw?.rel ?? '')
      .trim()
      .replace(/\\/g, '/')
    if (!rel || rel.includes('..')) {
      console.error(LOG, 'FALHA: rel inválido', { rel: raw?.rel })
      throw createError({ statusCode: 400, statusMessage: 'Campo "rel" inválido.' })
    }

    if (target === 'trailer' && !rel.startsWith('trailers/')) {
      console.error(LOG, 'FALHA: trailer sem prefixo trailers/')
      throw createError({
        statusCode: 400,
        statusMessage: 'Para trailer, "rel" deve começar por trailers/',
      })
    }
    if (target === 'preview' && !rel.startsWith('preview/')) {
      console.error(LOG, 'FALHA: preview sem prefixo preview/')
      throw createError({
        statusCode: 400,
        statusMessage: 'Para preview, "rel" deve começar por preview/',
      })
    }

    const root = roots[session]!.trim()
    let absPath: string
    try {
      absPath = resolveSafeUnderRoot(root, rel)
    } catch (e) {
      console.error(LOG, 'FALHA: resolveSafeUnderRoot', { root, rel, erro: errMsg(e) })
      throw createError({ statusCode: 400, statusMessage: 'Caminho não autorizado para esta biblioteca.' })
    }

    console.error(LOG, 'caminho resolvido', { session, target, root, rel, absPath })

    try {
      const st = await stat(absPath)
      console.error(LOG, 'stat OK', { size: st.size, isFile: st.isFile() })
    } catch (e) {
      console.error(LOG, 'FALHA: ficheiro não existe no disco', { absPath, erro: errMsg(e) })
      throw createError({
        statusCode: 404,
        statusMessage: 'Ficheiro não encontrado na pasta da biblioteca.',
      })
    }

    try {
      await revealInOsFileManager(absPath)
    } catch (e) {
      console.error(LOG, 'FALHA: spawn gestor de ficheiros', { absPath, erro: errMsg(e) })
      const msg = e instanceof Error ? e.message : String(e)
      throw createError({
        statusCode: 500,
        statusMessage: `Não foi possível abrir o gestor de ficheiros: ${msg}`,
      })
    }

    console.error(LOG, 'SUCESSO — gestor devia ter aberto para', absPath)
    return { ok: true as const }
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as { statusCode?: unknown }).statusCode)
        : undefined
    const sm =
      err && typeof err === 'object' && 'statusMessage' in err
        ? String((err as { statusMessage?: unknown }).statusMessage)
        : ''
    console.error(LOG, 'excepção / resposta de erro', {
      statusCode: status,
      statusMessage: sm || errMsg(err),
    })
    throw err
  }
})
