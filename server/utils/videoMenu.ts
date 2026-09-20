import { basename, resolve } from 'node:path'
import { parseVideoRootsFromEnv } from './parseVideoRoots'
import { buildSessionFolderLabels, getVideoRootsFromConfig, type RootsConfig } from './videoSession'
import { getVideoTagsDb, runVideoTagsTxn } from './videoTagsDb'

export interface VideoMenuItem {
  path: string
  title: string
}

export interface FastPlaySettings {
  rate: number
  stepSeconds: number
  windowSeconds: number
  lastMinuteSeconds: number
  /** Se verdadeiro, activar FAST no vídeo completo entra em ecrã inteiro no elemento de vídeo. */
  fullscreenOnFastPlay: boolean
}

export const DEFAULT_FAST_PLAY_SETTINGS: FastPlaySettings = {
  rate: 2,
  stepSeconds: 60,
  windowSeconds: 10,
  lastMinuteSeconds: 60,
  fullscreenOnFastPlay: true,
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase()
    if (t === '0' || t === 'false' || t === 'no' || t === 'off') return false
    if (t === '1' || t === 'true' || t === 'yes' || t === 'on') return true
  }
  return fallback
}

function normalizeFastPlaySettings(raw: unknown): FastPlaySettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    rate: clampNumber(obj.rate, 0.5, 4, DEFAULT_FAST_PLAY_SETTINGS.rate),
    stepSeconds: Math.round(
      clampNumber(obj.stepSeconds, 10, 600, DEFAULT_FAST_PLAY_SETTINGS.stepSeconds),
    ),
    windowSeconds: Math.round(
      clampNumber(obj.windowSeconds, 2, 120, DEFAULT_FAST_PLAY_SETTINGS.windowSeconds),
    ),
    lastMinuteSeconds: Math.round(
      clampNumber(obj.lastMinuteSeconds, 10, 600, DEFAULT_FAST_PLAY_SETTINGS.lastMinuteSeconds),
    ),
    fullscreenOnFastPlay: normalizeBoolean(
      obj.fullscreenOnFastPlay,
      DEFAULT_FAST_PLAY_SETTINGS.fullscreenOnFastPlay,
    ),
  }
}

function readMenuDocumentFromDb(): {
  items: VideoMenuItem[] | null
  fastPlay: FastPlaySettings
  catalogPassword: string
} {
  try {
    const d = getVideoTagsDb()
    const rows = d
      .prepare('SELECT path, title FROM video_menu_items ORDER BY sort_order ASC')
      .all() as { path: string; title: string }[]
    const items: VideoMenuItem[] = []
    for (const row of rows) {
      const path = String(row.path ?? '').trim()
      if (!path) continue
      let title = String(row.title ?? '').trim()
      if (!title) title = basename(resolve(path))
      items.push({ path, title })
    }
    const meta = d
      .prepare('SELECT fast_play_json, catalog_password FROM video_menu_meta WHERE id = 1')
      .get() as { fast_play_json?: string; catalog_password?: string } | undefined
    let fastPlayRaw: unknown = null
    if (meta?.fast_play_json) {
      try {
        fastPlayRaw = JSON.parse(meta.fast_play_json)
      } catch {
        fastPlayRaw = null
      }
    }
    return {
      items: items.length ? items : null,
      fastPlay: normalizeFastPlaySettings(fastPlayRaw),
      catalogPassword: typeof meta?.catalog_password === 'string' ? meta.catalog_password.trim() : '',
    }
  } catch {
    return {
      items: null,
      fastPlay: { ...DEFAULT_FAST_PLAY_SETTINGS },
      catalogPassword: '',
    }
  }
}

/**
 * Lê o menu de pastas em SQLite (`video_menu_items`).
 * Se vazio/inválido, devolve `null` para usar o fallback do `.env`.
 */
export function tryLoadVideoMenuFromDisk(): VideoMenuItem[] | null {
  return readMenuDocumentFromDb().items
}

export function getFastPlaySettingsFromDisk(): FastPlaySettings {
  return readMenuDocumentFromDb().fastPlay
}

/** Senha do catálogo (vazia = desligada). */
export function getCatalogPasswordFromDisk(): string {
  return readMenuDocumentFromDb().catalogPassword
}

export function normalizeCatalogPassword(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().slice(0, 200)
}

/** Ordem e rótulos do menu; se não houver menu na DB, usa `runtimeConfig` + rótulos por pasta. */
export function getVideoMenuItems(config: RootsConfig): VideoMenuItem[] {
  const fromDb = tryLoadVideoMenuFromDisk()
  if (fromDb?.length) return fromDb
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
 * Ordem igual ao servidor: SQLite se válido, senão `VIDEO_ROOT` / `VIDEO_ROOTS`.
 */
export function getVideoRootsForCli(): string[] {
  return getVideoMenuRowsForCli().map((e) => e.path)
}

/**
 * Grava o menu em SQLite (`video_menu_items` + `video_menu_meta`).
 * Valida caminhos e títulos antes de escrever.
 */
export async function writeVideoMenuToDisk(
  items: VideoMenuItem[],
  fastPlayRaw?: unknown,
  catalogPasswordRaw?: unknown,
): Promise<void> {
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

  const current = readMenuDocumentFromDb()
  const fastPlay = normalizeFastPlaySettings(
    fastPlayRaw === undefined ? current.fastPlay : fastPlayRaw,
  )
  const catalogPassword =
    catalogPasswordRaw === undefined
      ? current.catalogPassword
      : normalizeCatalogPassword(catalogPasswordRaw)

  const d = getVideoTagsDb()
  runVideoTagsTxn(d, () => {
    d.exec('DELETE FROM video_menu_items')
    const ins = d.prepare(
      'INSERT INTO video_menu_items (sort_order, path, title) VALUES (?, ?, ?)',
    )
    normalized.forEach((it, i) => ins.run(i, it.path, it.title))
    d.prepare(
      'INSERT OR REPLACE INTO video_menu_meta (id, fast_play_json, catalog_password) VALUES (1, ?, ?)',
    ).run(JSON.stringify(fastPlay), catalogPassword)
  })
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
