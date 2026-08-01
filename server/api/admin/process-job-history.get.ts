import { getQuery } from 'h3'
import {
  findSuccessfulShrinkHistory,
  readProcessJobHistory,
  type ProcessJobKind,
} from '../../utils/processJobHistory'

/** Histórico permanente de shrink + reprocessar trailer (não apaga ao limpar filas). */
export default defineEventHandler(async (event) => {
  const q = getQuery(event) as Record<string, unknown>
  const kindRaw = String(q.kind ?? 'all').trim().toLowerCase()
  const kind: ProcessJobKind | 'all' =
    kindRaw === 'shrink' || kindRaw === 'trailer' ? kindRaw : 'all'
  const session = Number(q.session ?? NaN)
  const mainRel = typeof q.mainRel === 'string' ? q.mainRel.trim() : ''

  if (kind === 'shrink' && Number.isFinite(session) && session >= 0 && mainRel) {
    const entry = await findSuccessfulShrinkHistory(Math.floor(session), mainRel)
    return {
      alreadyShrunk: Boolean(entry),
      entry,
      items: entry ? [entry] : [],
      total: entry ? 1 : 0,
      kind,
    }
  }

  const limit = Number(q.limit ?? 200)
  const items = await readProcessJobHistory({ kind, limit })
  return { items, total: items.length, kind, alreadyShrunk: false, entry: null }
})
