/** 600 MiB — limiar de shrink só para a pipeline «novos» do admin. */
export const NEW_VIDEOS_SHRINK_MIN_BYTES = 600 * 1024 * 1024

export type ProcessNewVideosPhase =
  | 'idle'
  | 'scanning'
  | 'trailers'
  | 'auto-tags'
  | 'shrink'
  | 'done'
  | 'failed'

export interface ProcessNewVideosCandidate {
  mainRel: string
  label: string
  size: number
  willShrink: boolean
}

export interface ProcessNewVideosSkipped {
  mainRel: string
  label: string
  reason: 'already_shrunk'
}

export interface ProcessNewVideosSummary {
  scanned: number
  candidates: number
  skippedAlreadyShrunk: number
  trailersEnqueued: number
  shrinksEnqueued: number
  autoTagsRan: boolean
  autoTagsOk: boolean | null
}

export interface ProcessNewVideosPublicStatus {
  busy: boolean
  phase: ProcessNewVideosPhase
  session: number | null
  sessionTitle: string | null
  startedAt: number | null
  endedAt: number | null
  lastError: string | null
  candidates: ProcessNewVideosCandidate[]
  skipped: ProcessNewVideosSkipped[]
  summary: ProcessNewVideosSummary | null
  platform: string
  windowsOnly: boolean
}
