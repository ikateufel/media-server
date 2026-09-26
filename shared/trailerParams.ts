export type TrailerCollectMode = 'padrao' | 'legado' | 'sparse'

export type TrailerNvencMode = 'auto' | 'cpu' | 'nvenc'

export interface TrailerBatParams {
  collect: TrailerCollectMode
  /** Duração de cada corte (modo padrão), segundos. */
  pctSeg: number
  /** Intervalo em % do filme (filmes ≤ longMinSec). */
  pctStep: number
  /** Acima disto usa longStepSec em vez de pctStep. */
  longMinSec: number
  /** Intervalo entre cortes em filmes longos, segundos. */
  longStepSec: number
  /** Bloco final único no fim do filme, segundos. */
  tailSec: number
  /** Teto de duração de saída (modos legado), segundos. */
  maxOutSec: number
  /** Duração de cada corte no modo legado, segundos. */
  legacySegSec: number
  /** Intervalo entre inícios dos cortes no modo legado, segundos. */
  legacyStepSec: number
  /** Velocidade final áudio + vídeo: 1 = normal, 2 = 2×, 3 = 3×, … */
  speed: number
  /** Altura máxima do trailer (px). */
  heightPx: number
  useNvenc: TrailerNvencMode
  nvencPreset: string
}

/**
 * Padrão ~2 min a 1,5×.
 * Até 2 h: 15 s a cada 10 % (10 cortes) + 30 s finais = 180 s de origem / 1,5 ≈ 120 s.
 * Acima de 2 h: 15 s a cada 15 min, ainda perto de 2 min.
 */
export const TRAILER_BAT_PARAMS_DEFAULT: TrailerBatParams = {
  collect: 'padrao',
  pctSeg: 15,
  pctStep: 10,
  longMinSec: 7200,
  longStepSec: 900,
  tailSec: 30,
  maxOutSec: 120,
  legacySegSec: 15,
  legacyStepSec: 60,
  speed: 1.5,
  heightPx: 720,
  useNvenc: 'auto',
  nvencPreset: 'p4',
}

export const TRAILER_SPEED_OPTIONS = [1, 1.25, 1.5, 2, 2.5, 3] as const

const COLLECT_MODES = new Set<TrailerCollectMode>(['padrao', 'legado', 'sparse'])

const NVENC_MODES = new Set<TrailerNvencMode>(['auto', 'cpu', 'nvenc'])

const NVENC_PRESETS = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

function clampFloat(n: number, min: number, max: number, decimals = 2): number {
  if (!Number.isFinite(n)) return min
  const v = Math.min(max, Math.max(min, n))
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/** `minuto10/15/20` antigos passam a ser o modo `legado` (duração vinha no nome). */
function legacySegFromOldCollect(raw: unknown): number | undefined {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'minuto10') return 10
  if (s === 'minuto15') return 15
  if (s === 'minuto20') return 20
  return undefined
}

function pickCollect(raw: unknown): TrailerCollectMode {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'minuto10' || s === 'minuto15' || s === 'minuto20') return 'legado'
  if (COLLECT_MODES.has(s as TrailerCollectMode)) return s as TrailerCollectMode
  return TRAILER_BAT_PARAMS_DEFAULT.collect
}

function pickNvenc(raw: unknown): TrailerNvencMode {
  const s = String(raw ?? '').trim().toLowerCase()
  if (NVENC_MODES.has(s as TrailerNvencMode)) return s as TrailerNvencMode
  return TRAILER_BAT_PARAMS_DEFAULT.useNvenc
}

function pickPreset(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase()
  if (NVENC_PRESETS.has(s)) return s
  return TRAILER_BAT_PARAMS_DEFAULT.nvencPreset
}

/** Lê velocidade guardada (campo novo `speed` ou legado `vel`). */
function readSpeedFromInput(src: Partial<Record<string, unknown>>, fallback: number): number {
  if (src.speed !== undefined && src.speed !== null && src.speed !== '') {
    return Number(src.speed)
  }
  if (src.vel !== undefined && src.vel !== null && src.vel !== '') {
    return Number(src.vel)
  }
  return fallback
}

/**
 * Converte velocidade do utilizador em parâmetros do ffmpeg:
 * speed 1 → atempo 1, frames 1
 * speed 2 → atempo 2, frames 0,5
 * speed 3 → atempo 3, frames 0,333…
 */
export function trailerSpeedToVelPts(speed: number): { vel: number; pts: number } {
  let vel = clampFloat(speed, 0.5, 4)
  if (!(TRAILER_SPEED_OPTIONS as readonly number[]).includes(vel)) {
    let best = TRAILER_SPEED_OPTIONS[0]!
    let bestDist = Math.abs(vel - best)
    for (const opt of TRAILER_SPEED_OPTIONS) {
      const d = Math.abs(vel - opt)
      if (d < bestDist) {
        best = opt
        bestDist = d
      }
    }
    vel = best
  }
  const pts = clampFloat(1 / vel, 0.25, 2, 4)
  return { vel, pts }
}

/** Fator de duração por frame (1/speed) — só para mostrar na UI. */
export function trailerFrameFactorFromSpeed(speed: number): number {
  return trailerSpeedToVelPts(speed).pts
}

export function formatTrailerFrameFactor(speed: number): string {
  const pts = trailerFrameFactorFromSpeed(speed)
  return pts.toLocaleString('pt-PT', { maximumFractionDigits: 4 })
}

/** Normaliza parcial (API / localStorage) para valores seguros. */
export function normalizeTrailerBatParams(
  input: Partial<Record<keyof TrailerBatParams, unknown>> | null | undefined,
): TrailerBatParams {
  const d = TRAILER_BAT_PARAMS_DEFAULT
  const src = input ?? {}
  const { vel: speed } = trailerSpeedToVelPts(readSpeedFromInput(src, d.speed))
  const legacySegFallback = legacySegFromOldCollect(src.collect) ?? d.legacySegSec
  return {
    collect: pickCollect(src.collect),
    pctSeg: clampInt(Number(src.pctSeg ?? d.pctSeg), 1, 120),
    pctStep: clampInt(Number(src.pctStep ?? d.pctStep), 1, 50),
    longMinSec: clampInt(Number(src.longMinSec ?? d.longMinSec), 60, 86_400),
    longStepSec: clampInt(Number(src.longStepSec ?? d.longStepSec), 30, 3600),
    tailSec: clampInt(Number(src.tailSec ?? d.tailSec), 1, 600),
    maxOutSec: clampInt(Number(src.maxOutSec ?? d.maxOutSec), 30, 900),
    legacySegSec: clampInt(Number(src.legacySegSec ?? legacySegFallback), 1, 120),
    legacyStepSec: clampInt(Number(src.legacyStepSec ?? d.legacyStepSec), 1, 3600),
    speed,
    heightPx: clampInt(Number(src.heightPx ?? d.heightPx), 144, 2160),
    useNvenc: pickNvenc(src.useNvenc),
    nvencPreset: pickPreset(src.nvencPreset),
  }
}

/** Variáveis de ambiente para `scripts/trailer.bat`. */
export function trailerBatParamsToProcessEnv(p: TrailerBatParams): Record<string, string> {
  const { vel, pts } = trailerSpeedToVelPts(p.speed)
  const useNvenc =
    p.useNvenc === 'cpu' ? '0' : p.useNvenc === 'nvenc' ? '1' : 'auto'
  return {
    TRAILER_COLLECT: p.collect,
    TRAILER_PCT_SEG: String(p.pctSeg),
    TRAILER_PCT_STEP: String(p.pctStep),
    TRAILER_LONG_MIN_SEC: String(p.longMinSec),
    TRAILER_LONG_STEP_SEC: String(p.longStepSec),
    TRAILER_TAIL_SEC: String(p.tailSec),
    TRAILER_MAX_OUT_SEC: String(p.maxOutSec),
    TRAILER_LEGACY_SEG: String(p.legacySegSec),
    TRAILER_LEGACY_STEP: String(p.legacyStepSec),
    vel: String(vel),
    pts: String(pts),
    H_TRAILER: String(p.heightPx),
    USE_NVENC: useNvenc,
    TRAILER_NVENC_PRESET: p.nvencPreset,
  }
}

export const TRAILER_PARAMS_STORAGE_KEY = 'video_player_trailer_reprocess_params'
const TRAILER_PARAMS_REV_KEY = 'video_player_trailer_reprocess_params_rev'
/** Sobe quando o padrão do formulário muda e o localStorage antigo deve ser substituído. */
const TRAILER_PARAMS_REV = '2'

/** Lê o formulário do trailer. Revisão nova descarta valores guardados e aplica o padrão atual. */
export function trailerParamsFromStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
): TrailerBatParams {
  if (!storage) return { ...TRAILER_BAT_PARAMS_DEFAULT }
  try {
    if (storage.getItem(TRAILER_PARAMS_REV_KEY) !== TRAILER_PARAMS_REV) {
      const fresh = { ...TRAILER_BAT_PARAMS_DEFAULT }
      storage.setItem(TRAILER_PARAMS_STORAGE_KEY, JSON.stringify(fresh))
      storage.setItem(TRAILER_PARAMS_REV_KEY, TRAILER_PARAMS_REV)
      return fresh
    }
    const raw = storage.getItem(TRAILER_PARAMS_STORAGE_KEY)
    if (!raw) return { ...TRAILER_BAT_PARAMS_DEFAULT }
    return normalizeTrailerBatParams(JSON.parse(raw) as Record<string, unknown>)
  } catch {
    return { ...TRAILER_BAT_PARAMS_DEFAULT }
  }
}

export const TRAILER_COLLECT_LABELS: Record<TrailerCollectMode, string> = {
  padrao: 'Padrão (% + bloco final)',
  legado: 'Legado — duração e intervalo',
  sparse: 'Legado — sparse (25 s / 90 s)',
}
