import { createError, readBody } from 'h3'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import {
  addDuplicateVerdict,
  addDuplicateVerdictsForVideos,
  removePairFromStoredDuplicateScan,
  removePairsAmongVideosFromStored,
  type DuplicateVerdictReason,
  type DuplicateVideoRef,
} from '../../utils/duplicateCandidates'

function parseRef(raw: unknown): DuplicateVideoRef | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { session?: unknown; trailerRel?: unknown }
  const session = typeof o.session === 'number' ? o.session : Number(o.session)
  const trailerRel =
    typeof o.trailerRel === 'string' ? o.trailerRel.trim().replace(/\\/g, '/') : ''
  if (!Number.isFinite(session) || session < 0 || !trailerRel) return null
  return { session: Math.floor(session), trailerRel }
}

/**
 * POST /api/duplicates/verdict
 * - par: { reason, a, b }
 * - grupo: { reason, videos: [{ session, trailerRel }, ...] }  (≥2)
 */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const body = (await readBody(event).catch(() => null)) as {
    reason?: unknown
    a?: unknown
    b?: unknown
    videos?: unknown
  } | null

  const reasonRaw = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const reason: DuplicateVerdictReason | null =
    reasonRaw === 'not_duplicate' || reasonRaw === 'resolved' ? reasonRaw : null
  if (!reason) {
    throw createError({
      statusCode: 400,
      statusMessage: 'reason (not_duplicate|resolved) é obrigatório.',
    })
  }

  const fromList: DuplicateVideoRef[] = []
  if (Array.isArray(body?.videos)) {
    for (const raw of body.videos) {
      const ref = parseRef(raw)
      if (ref) fromList.push(ref)
    }
  }

  if (fromList.length >= 2) {
    const verdicts = addDuplicateVerdictsForVideos(fromList, reason)
    const stored = removePairsAmongVideosFromStored(fromList)
    return {
      ok: true,
      count: verdicts.length,
      verdicts,
      stored: !!stored,
      ...(stored ?? { groups: [], matchedPairs: 0 }),
    }
  }

  const a = parseRef(body?.a)
  const b = parseRef(body?.b)
  if (!a || !b) {
    throw createError({
      statusCode: 400,
      statusMessage: 'videos[] (≥2) ou a+b são obrigatórios.',
    })
  }
  if (a.session === b.session && a.trailerRel === b.trailerRel) {
    throw createError({ statusCode: 400, statusMessage: 'Os dois lados têm de ser títulos diferentes.' })
  }

  const verdict = addDuplicateVerdict(a, b, reason)
  const stored = removePairFromStoredDuplicateScan(a, b)

  return {
    ok: true,
    count: 1,
    verdict,
    stored: !!stored,
    ...(stored ?? { groups: [], matchedPairs: 0 }),
  }
})
