import { stat } from 'node:fs/promises'
import { createError, readBody } from 'h3'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import { getFavoriteSet } from '../../utils/libraryState'
import { findSuccessfulShrinkHistory } from '../../utils/processJobHistory'
import { isInRecentPlayback } from '../../utils/recentPlaybackDb'
import {
  findMainFileInSessionRoot,
  resolveCatalogRelAbsoluteCandidates,
} from '../../utils/trailerNames'
import { getVideoMenuItems, getVideoRootsFromRuntime } from '../../utils/videoMenu'
import { resolveSafeUnderRoot } from '../../utils/videoPaths'

function asTrimmedString(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim()
  if (raw == null) return ''
  return String(raw).trim()
}

/** POST /api/duplicates/media-info — { session, trailerRel } */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  const menu = getVideoMenuItems(config)
  if (!roots.length) {
    throw createError({ statusCode: 503, statusMessage: 'VIDEO_ROOT não configurado' })
  }

  const body = (await readBody(event).catch(() => null)) as {
    session?: unknown
    trailerRel?: unknown
  } | null

  const sessionRaw = body?.session
  const session =
    typeof sessionRaw === 'number' ? sessionRaw : Number(asTrimmedString(sessionRaw))
  const trailerRel = asTrimmedString(body?.trailerRel).replace(/\\/g, '/')

  if (!trailerRel) {
    throw createError({ statusCode: 400, statusMessage: 'trailerRel em falta.' })
  }
  if (!Number.isFinite(session) || session < 0) {
    throw createError({ statusCode: 400, statusMessage: 'session inválida.' })
  }
  if (session >= roots.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `session ${Math.floor(session)} fora do menu (0..${roots.length - 1}).`,
    })
  }

  const sess = Math.floor(session)
  const root = roots[sess]!.trim()
  const sessionLabel = menu[sess]?.title?.trim() || `Sessão ${sess}`

  let trailerBytes: number | null = null
  const trailerCandidates = trailerRel.startsWith('trailers/')
    ? resolveCatalogRelAbsoluteCandidates(root, trailerRel)
    : [resolveSafeUnderRoot(root, trailerRel)]
  for (const p of trailerCandidates) {
    try {
      const st = await stat(p)
      if (st.isFile()) {
        trailerBytes = st.size
        break
      }
    } catch {
      /* */
    }
  }

  const within = trailerRel.replace(/^trailers\//i, '')
  const main = await findMainFileInSessionRoot(root, within)
  const mainRel = main?.mainFilename ?? null
  const mainBytes = main?.stat.isFile() ? main.stat.size : null

  const favSet = await getFavoriteSet(sess)
  const isFavorite = favSet.has(trailerRel)
  const inDestaques = isInRecentPlayback(sess, trailerRel)

  let alreadyShrunk = false
  let shrinkEndedAt: number | null = null
  if (mainRel) {
    const hist = await findSuccessfulShrinkHistory(sess, mainRel)
    if (hist) {
      alreadyShrunk = true
      shrinkEndedAt = typeof hist.endedAt === 'number' ? hist.endedAt : null
    }
  }

  return {
    session: sess,
    sessionLabel,
    trailerRel,
    trailerBytes,
    mainRel,
    mainBytes,
    isFavorite,
    inDestaques,
    alreadyShrunk,
    shrinkEndedAt,
  }
})
