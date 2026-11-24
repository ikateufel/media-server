import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_CAP_CHARS = 400_000

export type AutoTagsPipelineResult = {
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
}

/** Evita spawn em `.cmd` no Windows (EINVAL com shell:false); usa o entrypoint .mjs do pacote. */
export function resolveTsxCommand(projectRoot: string): { command: string; argvPrefix: string[] } {
  const cliMjs = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (existsSync(cliMjs)) {
    return { command: process.execPath, argvPrefix: [cliMjs] }
  }
  if (process.platform !== 'win32') {
    const bin = join(projectRoot, 'node_modules', '.bin', 'tsx')
    if (existsSync(bin)) {
      return { command: bin, argvPrefix: [] }
    }
  }
  return { command: 'tsx', argvPrefix: [] }
}

/**
 * Executa `scripts/tag-pipeline.ts` (mesmo que `npm run auto-tags`).
 */
export function runAutoTagsPipeline(
  projectRoot: string,
  pipelineArgs: string[],
): Promise<AutoTagsPipelineResult> {
  return new Promise((resolve, reject) => {
    const { command, argvPrefix } = resolveTsxCommand(projectRoot)
    const script = join(projectRoot, 'scripts', 'tag-pipeline.ts')
    const child = spawn(command, [...argvPrefix, script, ...pipelineArgs], {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let stdoutTrunc = false
    let stderrTrunc = false

    const append = (target: 'out' | 'err', chunk: string) => {
      if (target === 'out') {
        const next = stdout + chunk
        if (next.length > OUTPUT_CAP_CHARS) {
          stdout = next.slice(-OUTPUT_CAP_CHARS)
          stdoutTrunc = true
        } else {
          stdout = next
        }
      } else {
        const next = stderr + chunk
        if (next.length > OUTPUT_CAP_CHARS) {
          stderr = next.slice(-OUTPUT_CAP_CHARS)
          stderrTrunc = true
        } else {
          stderr = next
        }
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => append('out', c))
    child.stderr?.on('data', (c: string) => append('err', c))
    child.on('error', reject)
    child.on('close', (code) =>
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        truncated: stdoutTrunc || stderrTrunc,
      }),
    )
  })
}
