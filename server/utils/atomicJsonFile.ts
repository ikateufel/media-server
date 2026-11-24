import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Erros transitórios tipicos no Windows (AV, Explorer, rename sobre ficheiro aberto). */
export function isRetryableFsError(e: unknown): boolean {
  const err = e as NodeJS.ErrnoException & { message?: string }
  const code = String(err?.code ?? '')
  if (
    code === 'EBUSY' ||
    code === 'EPERM' ||
    code === 'EACCES' ||
    code === 'EAGAIN' ||
    code === 'EEXIST' ||
    code === 'ENOENT' ||
    code === 'UNKNOWN' ||
    code === 'EUNKNOWN'
  ) {
    return true
  }
  const msg = String(err?.message ?? e)
  return /unknown error,\s*open/i.test(msg) || /resource busy|being used by another process/i.test(msg)
}

/**
 * Escreve JSON via ficheiro temporário + rename, com retries.
 * Evita `UNKNOWN: unknown error, open` em escritas concorrentes no Windows.
 */
export async function writeJsonFileAtomic(
  path: string,
  data: unknown,
  opts?: { retries?: number; pretty?: boolean },
): Promise<void> {
  const retries = opts?.retries ?? 10
  const body = opts?.pretty === false ? JSON.stringify(data) : JSON.stringify(data, null, 2)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  let lastErr: unknown

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await writeFile(tmp, body, 'utf8')
      try {
        await rename(tmp, path)
      } catch (renameErr) {
        if (!isRetryableFsError(renameErr)) throw renameErr
        try {
          await unlink(path)
        } catch {
          /* destino pode não existir */
        }
        await rename(tmp, path)
      }
      return
    } catch (e) {
      lastErr = e
      try {
        await unlink(tmp)
      } catch {
        /* */
      }
      if (!isRetryableFsError(e) || attempt === retries - 1) break
      await sleep(35 + attempt * 55 + Math.floor(Math.random() * 40))
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Encadeia escritas para o mesmo recurso (evita writeFile concorrente). */
export function createPersistGate() {
  let chain: Promise<void> = Promise.resolve()
  return function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn)
    chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}
