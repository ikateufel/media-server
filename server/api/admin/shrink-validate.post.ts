import { createError, readBody } from 'h3'
import { resolve } from 'node:path'
import { getVideoMenuItems } from '../../utils/videoMenu'
import { requireAdminToken } from '../../utils/requireAdmin'
import {
  assertAllowedSourceRoot,
  validateShrinkFilesReport,
} from '../../utils/shrinkJobs'

/**
 * Valida ficheiros relativos à pasta de origem antes de processar.
 * Body: { sourceRoot: string, files: string[] }
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as {
    sourceRoot?: unknown
    files?: unknown
  } | null

  const allowed = getVideoMenuItems(config).map((e) => resolve(e.path.trim()))
  if (!allowed.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nenhuma biblioteca configurada (menu ou VIDEO_ROOT).',
    })
  }

  const sourceRootRaw = String(body?.sourceRoot ?? '').trim()
  if (!sourceRootRaw) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "sourceRoot" obrigatório.' })
  }
  const sourceRoot = assertAllowedSourceRoot(sourceRootRaw, allowed)

  const filesRaw = body?.files
  if (!Array.isArray(filesRaw) || !filesRaw.length) {
    throw createError({ statusCode: 400, statusMessage: 'Campo "files" (array) obrigatório.' })
  }
  const files = filesRaw.map((f) => String(f ?? '').trim()).filter(Boolean)

  const report = await validateShrinkFilesReport(sourceRoot, files)
  return {
    sourceRoot,
    count: report.ok.length,
    items: report.ok,
    failed: report.failed,
    failedCount: report.failed.length,
  }
})
