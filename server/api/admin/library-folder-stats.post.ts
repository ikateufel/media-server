import { createError, readBody } from 'h3'
import { getVideoMenuItems } from '../../utils/videoMenu'
import type { LibraryCountsMode, LibraryFolderStatsResult } from '../../utils/libraryFolderStats'
import { analyzeLibraryFolder } from '../../utils/libraryFolderStats'
import { requireAdminToken } from '../../utils/requireAdmin'

interface BodyItem {
  session?: unknown
  path?: unknown
}

/** Contagens na raiz vs `trailers/` vs `preview/`; modo `pairing` cruza trailers com ficheiros dedicados em `preview/`. */
export default defineEventHandler(async (event) => {
  requireAdminToken(event)

  const body = (await readBody(event).catch(() => null)) as
    | {
        mode?: unknown
        items?: unknown
      }
    | null

  const mode: LibraryCountsMode =
    body?.mode === 'pairing' ? 'pairing' : 'counts'

  let targets: { session: number; path: string }[]

  const rawItems = body?.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const config = useRuntimeConfig(event)
    const menu = getVideoMenuItems(config)
    targets = menu.map((e, i) => ({ session: i, path: e.path }))
    if (!targets.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Sem pastas no menu nem no corpo do pedido.',
      })
    }
  } else {
    targets = (rawItems as BodyItem[]).map((row, i) => {
      const sess =
        typeof row.session === 'number' && Number.isFinite(row.session)
          ? Math.floor(row.session)
          : i
      const path = typeof row.path === 'string' ? row.path.trim() : ''
      return { session: sess, path }
    })
  }

  const results: LibraryFolderStatsResult[] = []
  for (const { session, path } of targets) {
    results.push(await analyzeLibraryFolder(path, session, mode))
  }

  return { mode, results }
})
