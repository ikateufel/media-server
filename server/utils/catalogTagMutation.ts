import type { H3Event } from 'h3'
import {
  ensureSessionCatalogTagRepair,
  resolveCanonicalTrailerRelFromDisk,
} from './catalogTagRepair'
import { getVideoRootsFromRuntime } from './videoMenu'

/** Normaliza `trailerRel` para a chave canónica (repara SQLite na 1.ª vez por sessão). */
export async function resolveTrailerRelForTagMutation(
  event: H3Event,
  session: number,
  trailerRel: string,
): Promise<string> {
  const config = useRuntimeConfig(event)
  const roots = getVideoRootsFromRuntime(config)
  const root = roots[Math.max(0, Math.floor(session))]?.trim() ?? ''
  const rel = trailerRel.replace(/\\/g, '/').trim()
  if (!root) return rel
  await ensureSessionCatalogTagRepair(session, root)
  return resolveCanonicalTrailerRelFromDisk(session, root, rel)
}
