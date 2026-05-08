import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseVideoRootsFromEnv } from './parseVideoRoots'
import { buildSessionFolderLabels, getVideoRootsFromConfig, type RootsConfig } from './videoSession'

export interface VideoMenuItem {
  path: string
  title: string
}

function menuFilePath() {
  return join(process.cwd(), 'data', 'video-menu.json')
}

/**
 * Lê `data/video-menu.json` (array ou `{ items: [...] }`).
 * Cada entrada: `{ "path": "...", "title": "..." }`; `title` omisso → último segmento do `path`.
 * Se o ficheiro não existir, estiver vazio ou inválido, devolve `null` para usar o fallback do `.env`.
 */
export function tryLoadVideoMenuFromDisk(): VideoMenuItem[] | null {
  const file = menuFilePath()
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file, 'utf8').trim()
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const rows: unknown = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && parsed !== null && 'items' in parsed
        ? (parsed as { items: unknown }).items
        : null
    if (!Array.isArray(rows) || !rows.length) return null
    const out: VideoMenuItem[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const path = String((row as { path?: string }).path ?? '').trim()
      if (!path) continue
      let title = String((row as { title?: string }).title ?? '').trim()
      if (!title) title = basename(resolve(path))
      out.push({ path, title })
    }
    return out.length ? out : null
  } catch {
    return null
  }
}

/** Ordem e rótulos do menu; se não houver JSON válido, usa `runtimeConfig` + rótulos por pasta. */
export function getVideoMenuItems(config: RootsConfig): VideoMenuItem[] {
  const fromDisk = tryLoadVideoMenuFromDisk()
  if (fromDisk?.length) return fromDisk
  const roots = getVideoRootsFromConfig(config)
  const labels = buildSessionFolderLabels(roots)
  return roots.map((path, i) => ({ path, title: labels[i] ?? String(i) }))
}

/** Lista de raízes na mesma ordem do menu (para APIs que só precisam dos caminhos). */
export function getVideoRootsFromRuntime(config: RootsConfig): string[] {
  return getVideoMenuItems(config).map((e) => e.path)
}

/**
 * Raízes de vídeo para scripts CLI (process.cwd() + `.env` carregado pelo script).
 * Ordem igual ao servidor: `data/video-menu.json` se válido, senão `VIDEO_ROOT` / `VIDEO_ROOTS`.
 */
export function getVideoRootsForCli(): string[] {
  return getVideoMenuRowsForCli().map((e) => e.path)
}

/**
 * Raízes + rótulo (para CSV, etc.): `video-menu.json` se válido, senão `VIDEO_ROOT` com rótulos como no app.
 */
/**
 * Grava `data/video-menu.json` com `{ "items": [...] }` (UTF-8).
 * Valida caminhos e títulos antes de escrever.
 */
export async function writeVideoMenuToDisk(items: VideoMenuItem[]): Promise<void> {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Lista de pastas vazia.')
  }
  if (items.length > 64) {
    throw new Error('Demasiadas entradas (máx. 64).')
  }
  const normalized: VideoMenuItem[] = []
  for (const row of items) {
    const path = String(row.path ?? '').trim()
    if (!path) continue
    if (path.includes('..')) {
      throw new Error(`Caminho inválido (..): ${path}`)
    }
    const resolved = resolve(path)
    let title = String(row.title ?? '').trim()
    if (!title) title = basename(resolved)
    if (title.length > 200) {
      throw new Error(`Título demasiado longo: ${title.slice(0, 40)}…`)
    }
    normalized.push({ path: resolved, title })
  }
  if (!normalized.length) {
    throw new Error('Nenhuma entrada válida.')
  }
  const file = menuFilePath()
  await mkdir(dirname(file), { recursive: true })
  const payload = `${JSON.stringify({ items: normalized }, null, 2)}\n`
  await writeFile(file, payload, 'utf8')
}

export function getVideoMenuRowsForCli(): VideoMenuItem[] {
  const fromMenu = tryLoadVideoMenuFromDisk()
  if (fromMenu?.length) {
    return fromMenu.map((e) => {
      const path = e.path.trim()
      const title = (e.title || '').trim() || basename(resolve(path))
      return { path, title }
    })
  }
  const roots = parseVideoRootsFromEnv(process.env.VIDEO_ROOT || process.env.VIDEO_ROOTS || '')
  const labels = buildSessionFolderLabels(roots)
  return roots.map((path, i) => ({
    path: path.trim(),
    title: labels[i] ?? String(i),
  }))
}
