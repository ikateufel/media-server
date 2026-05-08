import { createError, getQuery } from 'h3'
import { getFullProgress } from '../../utils/libraryState'

export default defineEventHandler(async (event) => {
  const q = getQuery(event) as Record<string, unknown>
  const session = Number(q.session)
  const mainRel = typeof q.mainRel === 'string' ? q.mainRel : ''
  if (!Number.isFinite(session) || session < 0 || !mainRel) {
    throw createError({ statusCode: 400, statusMessage: 'session e mainRel são obrigatórios.' })
  }
  const row = await getFullProgress(session, mainRel)
  if (!row) return { seconds: null as number | null, duration: null as number | null }
  return { seconds: row.seconds, duration: row.duration ?? null }
})
