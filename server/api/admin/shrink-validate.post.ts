import { createError, readBody } from 'h3'
import { requireAdminToken } from '../../utils/requireAdmin'
import {
  assertAllowedSourceRoot,
  minSizeMbToBytes,
  normalizeMinSizeMb,
  validateShrinkFilesReport,
} from '../../utils/shrinkJobs'

/**
 * Valida ficheiros relativos à pasta de origem antes de processar.
 * Body: { sourceRoot: string, files: string[], minSizeMb?: number }
 */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as {
    sourceRoot?: unknown
    files?: unknown
    minSizeMb?: unknown
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
  const files = filesRaw.map((f) => String(f ?? '').trim()).filter(Boolean)
  const minSizeMb = normalizeMinSizeMb(body?.minSizeMb ?? 0)
  const minSizeBytes = minSizeMbToBytes(minSizeMb)

  const report = await validateShrinkFilesReport(sourceRoot, files, minSizeBytes)
  return {
    sourceRoot,
    minSizeMb,
    count: report.ok.length,
    items: report.ok,
    failed: report.failed,
    failedCount: report.failed.length,
    skipped: report.skipped,
    skippedCount: report.skipped.length,
  }
})
