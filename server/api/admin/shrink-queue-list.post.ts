import { createError, readBody } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import { assertAllowedSourceRoot } from '../../utils/shrinkJobs'
import { writeShrinkQueueList } from '../../utils/shrinkQueueList'
import { isVideoFileName } from '#shared/videoExtensions'

/** Grava data\shrink-queue.txt a partir da fila actual na UI. */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as {
    sourceRoot?: unknown
    files?: unknown
  } | null

  const sourceRootRaw = String(body?.sourceRoot ?? '').trim()
  if (!sourceRootRaw) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "sourceRoot" obrigatório.' })
  }
  const sourceRoot = await assertAllowedSourceRoot(sourceRootRaw)

  const filesRaw = body?.files
  if (!Array.isArray(filesRaw) || !filesRaw.length) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "files" (array) obrigatório.' })
  }

  const files: string[] = []
  const seen = new Set<string>()
  for (const raw of filesRaw) {
    const rel = String(raw ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!rel) continue
    if (!isVideoFileName(rel)) {
      throw createError({ statusCode: 400, statusMessage: `Extensão não suportada: ${rel}` })
    }
    const key = rel.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    files.push(rel)
  }
  if (!files.length) {
    throw createError({ statusCode: 400, statusMessage: 'Nenhum ficheiro válido na fila.' })
  }

  const saved = await writeShrinkQueueList(process.cwd(), sourceRoot, files)
  return {
    sourceRoot,
    count: saved.count,
    listPath: saved.listPath,
    message: `${saved.count} ficheiro(s) guardado(s) em ${saved.listPath}.`,
  }
})
