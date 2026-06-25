import { requireAdminToken } from '../../utils/requireAdmin'
import { readShrinkReprocessList } from '../../utils/shrinkReprocessList'

/** Le data\shrink-reprocess.txt (1.ª linha = pasta, resto = fila). */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)
  const payload = await readShrinkReprocessList(process.cwd())
  if (!payload.count) {
    return {
      ...payload,
      empty: true,
      message: 'Lista vazia. Execute scripts\\shrink-compare.bat ou processe sem Priorizar tamanho (falhas vão para shrink-multipass.txt).',
    }
  }
  return { ...payload, empty: false }
})
