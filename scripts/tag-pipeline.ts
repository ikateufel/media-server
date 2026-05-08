/**
 * Pipeline completo de tags automáticas:
 * 1. Limpa tags automáticas na SQLite (preserva manuais; use --all para apagar tudo).
 * 2. Exporta CSV de nomes na raiz de cada sessão (data/file-lists/<título>.csv).
 * 3. Gera data/file-lists/tags_<rótulo>.csv via tag-from-names.py (trailers/).
 * 4. Importa tags_* para data/library-tags.sqlite.
 *
 * Ver scripts/tag-INDEX.txt.
 * Uso: npm run auto-tags
 *      npm run auto-tags -- --dry-run
 *      npm run auto-tags -- --session=0
 *      npm run auto-tags -- --all
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

function resolveTsxCliAndArgs(script: string, scriptArgs: string[]): { command: string; argv: string[] } {
  const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (existsSync(tsxCli)) {
    /** `node …/cli.mjs` — evita spawn de `tsx.cmd` no Windows com `shell:false` (falha frequente, status 1 sem saída). */
    return { command: process.execPath, argv: [tsxCli, script, ...scriptArgs] }
  }
  /** Fallback: shim .bin (no Windows pode precisar de shell; aqui mantém-se só se cli.mjs não existir). */
  const shim = join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
  return { command: existsSync(shim) ? shim : 'tsx', argv: [script, ...scriptArgs] }
}

function runStep(title: string, scriptRel: string, args: string[]): void {
  console.error(`\n=== ${title} ===\n`)
  const script = join(projectRoot, scriptRel)
  const { command, argv } = resolveTsxCliAndArgs(script, args)
  const r = spawnSync(command, argv, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })
  if (r.error) {
    console.error('\n[auto-tags] Falha ao executar o subprocesso:', r.error.message)
    process.exit(1)
  }
  const code = r.signal != null ? 1 : (r.status ?? 1)
  if (code !== 0) {
    console.error(`\n[auto-tags] Parou em «${title}» (código ${code}).`)
    process.exit(code)
  }
}

function parsePipelineArgs(argv: string[]) {
  let dryRun = false
  const clearExtra: string[] = []
  const exportExtra: string[] = []
  const importExtra: string[] = []

  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`
npm run auto-tags — pipeline: limpar auto → CSV nomes → CSV tags (Python) → SQLite

Flags (reencaminhadas):
  --dry-run, -n     Não grava na base; não executa o passo «limpar» (simula import).
  --all             Limpar TUDO na SQLite, incluindo tags manuais (passado ao clear-tags).
  --session=N       Só essa sessão no export de nomes (passado a tag-export-root-filenames.ts).
  --out=DIR         Pasta dos CSV de nomes (default do script; passado ao export).
  --dir=DIR         Pasta dos tags_*.csv a importar (default data/file-lists).

Também podes correr cada passo à mão:
  npm run clear-tags
  npm run export-files-csv
  npx tsx scripts/tag-run-from-names-all.ts
  npm run import-tags-filelists
`)
      process.exit(0)
    }
    if (a === '--dry-run' || a === '-n') {
      dryRun = true
      importExtra.push(a)
      continue
    }
    if (a === '--all') {
      clearExtra.push(a)
      continue
    }
    const mo = a.match(/^--out=(.+)$/)
    if (mo) {
      exportExtra.push(a)
      continue
    }
    const ms = a.match(/^--session=(\d+)$/)
    if (ms) {
      exportExtra.push(a)
      continue
    }
    const md = a.match(/^--dir=(.+)$/)
    if (md) {
      importExtra.push(a)
      continue
    }
    console.error(`Flag desconhecida (ignorada): ${a}`)
  }

  return { dryRun, clearExtra, exportExtra, importExtra }
}

function main() {
  const argv = process.argv.slice(2)
  const { dryRun, clearExtra, exportExtra, importExtra } = parsePipelineArgs(argv)

  if (!dryRun) {
    runStep('1/4 Limpar tags automáticas na SQLite', 'scripts/tag-clear-sqlite.ts', clearExtra)
  } else {
    console.error('\n=== 1/4 Limpar tags — omitido (--dry-run) ===\n')
  }

  runStep('2/4 Exportar CSV de nomes (raiz de cada sessão)', 'scripts/tag-export-root-filenames.ts', exportExtra)
  runStep('3/4 Gerar tags_*.csv a partir dos nomes em trailers/', 'scripts/tag-run-from-names-all.ts', [])
  runStep('4/4 Importar tags_* para SQLite', 'scripts/tag-import-file-lists.ts', importExtra)

  console.error('\n[auto-tags] Pipeline concluído.')
}

main()
