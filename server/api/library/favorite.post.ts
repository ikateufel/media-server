import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { createError, readBody } from 'h3'
import { resolveTrailerRelForTagMutation } from '../../utils/catalogTagMutation'
import { setFavorite, toggleFavorite } from '../../utils/libraryState'
import { getVideoRootsFromRuntime } from '../../utils/videoMenu'

export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  const body = (await readBody(event)) as { session?: unknown; trailerRel?: unknown; favorite?: unknown }
  const session = typeof body.session === 'number' ? body.session : Number(body.session)
  const trailerRelRaw = typeof body.trailerRel === 'string' ? body.trailerRel : ''
  if (!Number.isFinite(session) || session < 0 || session >= roots.length || !trailerRelRaw.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'session e trailerRel são obrigatórios.' })
  }
  const trailerRel = await resolveTrailerRelForTagMutation(event, session, trailerRelRaw)
  // `favorite: true|false` = estado desejado (idempotente). Sem o campo, mantém o comportamento antigo (alternar).
  const desired = typeof body.favorite === 'boolean' ? body.favorite : null
  const { isFavorite, favoritedAt } =
    desired === null ? await toggleFavorite(session, trailerRel) : await setFavorite(session, trailerRel, desired)
  // Diagnóstico (temporário): chave recebida x chave gravada, também em data/favorite-debug.log.
  const line = JSON.stringify({ at: new Date().toISOString(), session, received: trailerRelRaw, saved: trailerRel, desired, isFavorite })
  console.log('[favorite]', line)
  try {
    appendFileSync(join(process.cwd(), 'data', 'favorite-debug.log'), `${line}\n`)
  } catch {
    /* só diagnóstico */
  }
  return { isFavorite, favoritedAt }
})
