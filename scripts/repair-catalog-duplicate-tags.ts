/**
 * Repara `data/library-tags.sqlite`: une tags/favoritos/recentes de vários `trailer_rel`
 * que apontam ao mesmo vídeo completo (ex.: `trailers/Filme.mkv` + `trailers/zz_Filme_acelerado.mp4`).
 *
 * Uso: npx tsx scripts/repair-catalog-duplicate-tags.ts
 *      npm run repair-catalog-duplicates
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repairSessionTrailerRelDuplicates } from '../server/utils/catalogTagRepair'
import { getVideoMenuRowsForCli } from '../server/utils/videoMenu'

function loadDotenv() {
  const p = join(process.cwd(), '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

async function main() {
  loadDotenv()

  const menu = getVideoMenuRowsForCli()
  if (!menu.length) {
    console.error('Sem bibliotecas (video-menu.json ou VIDEO_ROOT).')
    process.exit(1)
  }

  let totalGroups = 0
  let totalAliases = 0
  for (let session = 0; session < menu.length; session++) {
    const root = menu[session]!.path.trim()
    if (!root) continue
    const { groupsMerged, aliasesRemoved } = await repairSessionTrailerRelDuplicates(session, root)
    if (groupsMerged > 0) {
      console.log(
        `[${session}] ${menu[session]!.title || root}: ${groupsMerged} grupo(s), ${aliasesRemoved} alias removido(s)`,
      )
    }
    totalGroups += groupsMerged
    totalAliases += aliasesRemoved
  }

  console.log(`Concluído: ${totalGroups} grupos unificados, ${totalAliases} trailer_rel alias fundidos.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
