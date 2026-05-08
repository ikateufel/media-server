import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, relative } from 'node:path'
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
  }
  return m[extname(filePath).toLowerCase()] || 'application/octet-stream'
}

/** Junta `rel` (posix) à raiz e garante que o resultado fica dentro de `root`. */
export function resolveSafeUnderRoot(root: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || cleaned.includes('..')) {
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
