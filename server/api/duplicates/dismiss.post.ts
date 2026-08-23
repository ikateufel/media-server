import { createError, readBody } from 'h3'
import {
  readStoredDuplicateScan,
  writeStoredDuplicateScan,
} from '../../utils/duplicateCandidates'

type DismissItem = { session: number; trailerRel: string }

function parseItem(sessionRaw: unknown, trailerRelRaw: unknown): DismissItem | null {
  const session = typeof sessionRaw === 'number' ? sessionRaw : Number(sessionRaw)
  const trailerRel =
    typeof trailerRelRaw === 'string' ? trailerRelRaw.trim().replace(/\\/g, '/') : ''
  if (!Number.isFinite(session) || session < 0 || !trailerRel) return null
  return { session: Math.floor(session), trailerRel }
}

/** POST /api/duplicates/dismiss — remove um ou mais títulos da lista gravada. */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as {
    session?: unknown
    trailerRel?: unknown
    items?: unknown
  } | null

  const items: DismissItem[] = []
  if (Array.isArray(body?.items)) {
    for (const raw of body.items) {
      if (!raw || typeof raw !== 'object') continue
      const o = raw as { session?: unknown; trailerRel?: unknown }
      const it = parseItem(o.session, o.trailerRel)
      if (it) items.push(it)
    }
  }
  const single = parseItem(body?.session, body?.trailerRel)
  if (single) items.push(single)

  if (!items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'session/trailerRel ou items[] são obrigatórios.',
    })
  }

  const keys = new Set(items.map((it) => `${it.session}\0${it.trailerRel}`))
  const stored = readStoredDuplicateScan()
  if (!stored) {
    return { ok: true, stored: false, groups: [] }
  }

  const groups = stored.groups
    .map((g) => {
      const videos = g.videos.filter((v) => !keys.has(`${v.session}\0${v.trailerRel}`))
      const pairs = g.pairs.filter(
        (p) =>
          !keys.has(`${p.a.session}\0${p.a.trailerRel}`) &&
          !keys.has(`${p.b.session}\0${p.b.trailerRel}`),
      )
      return { ...g, videos, pairs }
    })
    .filter((g) => g.videos.length >= 2)
    .map((g, i) => ({ ...g, id: i + 1 }))

  const next = writeStoredDuplicateScan(
    {
      ...stored,
      groups,
      matchedPairs: groups.reduce((n, g) => n + g.pairs.length, 0),
    },
    stored.options,
  )
  return { ok: true, stored: true, ...next }
})
