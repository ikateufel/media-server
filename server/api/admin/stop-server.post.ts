import { requireAdminToken } from '../../utils/requireAdmin'

/**
 * Encerra o processo Node atual após responder ao cliente.
 * Endpoint protegido por token admin.
 */
export default defineEventHandler((event) => {
  requireAdminToken(event)

  // Devolve confirmação imediata e encerra no ciclo seguinte,
  // permitindo ao cliente receber resposta HTTP 200.
  setTimeout(() => {
    process.exit(0)
  }, 120)

  return { ok: true, stopping: true }
})
