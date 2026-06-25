import { requireAdminToken } from '../../utils/requireAdmin'
import { readShrinkQueueList } from '../../utils/shrinkQueueList'

/** Le data\shrink-queue.txt (fila guardada na UI). */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)
  const payload = await readShrinkQueueList(process.cwd())
  if (!payload.count) {
    return {
      ...payload,
      empty: true,
      message: 'Nenhuma fila guardada. Use «Guardar fila» na pagina Shrink.',
    }
  }
  return { ...payload, empty: false }
})
