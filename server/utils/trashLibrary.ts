import { basename, resolve } from 'node:path'
import type { VideoMenuItem } from './videoMenu'

const TRASH_LABELS = new Set(['lixo', 'lixeira', 'trash', 'recycle', 'reciclavel', 'reciclável'])

function normalizeTrashToken(raw: string): string {
  return raw.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/** Biblioteca de «lixo» no menu (por título ou nome da pasta). */
export function isTrashLibraryMenuItem(item: VideoMenuItem | undefined | null): boolean {
  if (!item) return false
  const title = normalizeTrashToken(item.title)
  if (TRASH_LABELS.has(title)) return true
  const base = normalizeTrashToken(basename(resolve(item.path)))
  return TRASH_LABELS.has(base)
}

export function isTrashLibrarySession(session: number, menu: VideoMenuItem[]): boolean {
  if (!Number.isFinite(session) || session < 0 || session >= menu.length) return false
  return isTrashLibraryMenuItem(menu[session])
}
