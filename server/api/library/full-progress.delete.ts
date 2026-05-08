import { createError, getQuery } from 'h3'
import { clearFullProgress } from '../../utils/libraryState'

export default defineEventHandler(async (event) => {
  const q = getQuery(event) as Record<string, unknown>
  const session = Number(q.session)
  const mainRel = typeof q.mainRel === 'string' ? q.mainRel : ''
  if (!Number.isFinite(session) || session < 0 || !mainRel) {
    throw createError({ statusCode: 400, statusMessage: 'session e mainRel são obrigatórios.' })
  }
  await clearFullProgress(session, mainRel)
  return { ok: true }
})
