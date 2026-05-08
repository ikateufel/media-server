import { createError, readBody } from 'h3'
import { clearFullProgress, setFullProgress } from '../../utils/libraryState'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as {
    session?: unknown
    mainRel?: unknown
    seconds?: unknown
    duration?: unknown
  }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const mainRel = typeof body.mainRel === 'string' ? body.mainRel : ''
  const seconds = typeof body.seconds === 'number' ? body.seconds : Number(body.seconds)
  const duration =
    body.duration === undefined || body.duration === null
      ? undefined
      : typeof body.duration === 'number'
        ? body.duration
        : Number(body.duration)

  if (!Number.isFinite(session) || session < 0 || !mainRel) {
    throw createError({ statusCode: 400, statusMessage: 'session e mainRel são obrigatórios.' })
  }
  if (!Number.isFinite(seconds)) {
    throw createError({ statusCode: 400, statusMessage: 'seconds inválido.' })
  }

  const dur = duration !== undefined && Number.isFinite(duration) ? duration : undefined
  if (dur !== undefined && seconds >= dur - 2) {
    await clearFullProgress(session, mainRel)
    return { ok: true, cleared: true }
  }

  await setFullProgress(session, mainRel, seconds, dur)
  return { ok: true, cleared: false }
})
