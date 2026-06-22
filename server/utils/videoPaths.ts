import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, resolve, relative } from 'node:path'
import type { H3Event } from 'h3'
import { createError, getRequestHeader, sendStream, setHeader, setResponseStatus } from 'h3'

export function mimeForVideoPath(filePath: string): string {
  const m: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.ogv': 'video/ogg',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv',
  }
  return m[extname(filePath).toLowerCase()] || 'application/octet-stream'
}

/** Detecta `..` como segmento de caminho (não confunde com `Lee..MP4`). */
export function hasPathTraversal(rel: string): boolean {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned) return true
  return cleaned.split('/').some((seg) => seg === '..' || seg === '')
}

/** Junta `rel` (posix) à raiz e garante que o resultado fica dentro de `root`. */
export function resolveSafeUnderRoot(root: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || hasPathTraversal(cleaned)) {
    throw createError({ statusCode: 400, statusMessage: 'Caminho inválido' })
  }
  const rootResolved = resolve(root)
  const full = resolve(rootResolved, cleaned)
  const relToRoot = relative(rootResolved, full)
  if (relToRoot.startsWith('..') || relToRoot === '') {
    throw createError({ statusCode: 403, statusMessage: 'Acesso negado' })
  }
  return full
}

/** Variantes de `rel` quando a pasta de origem já inclui um segmento duplicado (ex.: origem `_selected` + rel `_selected/foo.mp4`). */
export function mediaRelCandidates(sourceRoot: string, rel: string): string[] {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || hasPathTraversal(cleaned)) return []

  const out: string[] = []
  const seen = new Set<string>()
  const push = (candidate: string) => {
    const c = candidate.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!c || hasPathTraversal(c)) return
    const key = c.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  push(cleaned)

  const parts = cleaned.split('/')
  const rootName = basename(resolve(sourceRoot.trim())).toLowerCase()
  if (parts.length > 1 && parts[0]!.toLowerCase() === rootName) {
    push(parts.slice(1).join('/'))
  }

  const base = parts[parts.length - 1] ?? ''
  if (base && base !== cleaned) {
    push(base)
  }

  if (parts.length === 1 && rootName !== '_selected') {
    push(`_selected/${base}`)
  }

  return out
}

async function findCaseInsensitiveFile(dir: string, fileName: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  const wanted = fileName.toLowerCase()
  const hit = entries.find((e) => e.toLowerCase() === wanted)
  if (!hit) return null
  const full = resolve(dir, hit)
  try {
    const st = await stat(full)
    return st.isFile() ? full : null
  } catch {
    return null
  }
}

/**
 * Resolve um vídeo relativo a `sourceRoot`, tentando variantes comuns de caminho
 * (prefixo duplicado, só nome, subpasta `_selected/`, case-insensitive no Windows).
 */
export async function resolveMediaFileUnderRoot(
  sourceRoot: string,
  rel: string,
): Promise<{ rel: string; path: string; tried: string[] }> {
  const tried: string[] = []
  const candidates = mediaRelCandidates(sourceRoot, rel)

  for (const candidate of candidates) {
    let full: string
    try {
      full = resolveSafeUnderRoot(sourceRoot, candidate)
    } catch {
      continue
    }
    tried.push(full)
    try {
      const st = await stat(full)
      if (st.isFile()) {
        return { rel: candidate, path: full, tried }
      }
    } catch {
      /* */
    }

    if (process.platform === 'win32') {
      const dir = resolve(sourceRoot.trim(), candidate.split('/').slice(0, -1).join('/'))
      const fileName = candidate.split('/').pop() ?? candidate
      const ci = await findCaseInsensitiveFile(dir, fileName)
      if (ci) {
        tried.push(ci)
        return { rel: relative(resolve(sourceRoot.trim()), ci).replace(/\\/g, '/'), path: ci, tried }
      }
    }
  }

  const last =
    tried[tried.length - 1] ??
    resolve(resolve(sourceRoot.trim()), rel.replace(/\\/g, '/').replace(/^\/+/, ''))
  const rootName = basename(resolve(sourceRoot.trim()))
  let hint = 'Confirme que o ficheiro existe no disco do servidor.'
  if (rel.replace(/\\/g, '/').startsWith('_selected/') && rootName.toLowerCase() !== '_selected') {
    hint =
      'Escolha a biblioteca «_selected» no menu (ou defina a pasta de origem como …\\_selected) e use só o nome do ficheiro na fila.'
  } else if (rel.replace(/\\/g, '/').includes('/') && rootName.toLowerCase() === '_selected') {
    hint = 'A pasta de origem já é «_selected» — na fila use só o nome do ficheiro, sem o prefixo _selected/.'
  }

  throw createError({
    statusCode: 400,
    statusMessage: `Ficheiro não encontrado: ${last}. ${hint}`,
  })
}

/** Interpreta cabeçalho Range para um ficheiro de `size` bytes. */
export function parseBytesRange(
  rangeHeader: string | undefined,
  size: number
): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const rest = rangeHeader.slice('bytes='.length)
  const dash = rest.indexOf('-')
  if (dash < 0) return null
  const startStr = rest.slice(0, dash).trim()
  const endStr = rest.slice(dash + 1).trim()

  if (startStr === '' && endStr !== '') {
    const suffix = Number(endStr)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    const suffixLen = Math.min(suffix, size)
    const start = Math.max(0, size - suffixLen)
    return { start, end: size - 1 }
  }

  const start = Number(startStr)
  if (!Number.isFinite(start) || start < 0) return null
  if (start >= size) return null
  let end = endStr === '' ? size - 1 : Number(endStr)
  if (!Number.isFinite(end)) return null
  end = Math.min(end, size - 1)
  if (start > end) return null
  return { start, end }
}

export async function streamVideoFile(event: H3Event, filePath: string): Promise<void> {
  const { size } = await stat(filePath)
  const mime = mimeForVideoPath(filePath)
  const range = getRequestHeader(event, 'range')
  const parsed = parseBytesRange(range, size)

  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  if (parsed) {
    const { start, end } = parsed
    const chunk = end - start + 1
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Type', mime)
    setHeader(event, 'Content-Length', chunk)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${size}`)
    return sendStream(event, createReadStream(filePath, { start, end }))
  }

  setResponseStatus(event, 200)
  setHeader(event, 'Content-Type', mime)
  setHeader(event, 'Content-Length', size)
  return sendStream(event, createReadStream(filePath))
}
