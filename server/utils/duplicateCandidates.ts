import {
  COMPLETED_TAG_NAME,
  MEMORABLE_TAG_NAME,
  TRAILER_WATCHED_TAG_NAME,
  filterTaggedVideosExistingOnDisk,
  getVideoTagsDb,
  listTaggedVideosForDuplicateScan,
  purgeOrphanVideoTags,
  runVideoTagsTxn,
  type TaggedVideoRow,
} from './videoTagsDb'
import { getVideoMenuRowsForCli } from './videoMenu'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const RELEASE_JUNK =
  /\b(xxx|1080p|720p|540p|480p|2160p|4k|uhd|fhd|hd|web-?dl|webrip|bluray|bdrip|brrip|hdtv|x264|x265|h264|h265|hevc|avc|aac|ac3|dts|mp4|mkv|avi|mov|wmv|wrb|p2p|split|scenes|repack|proper|internal|uncensored|full|hq)\b/gi

const DATE_DOT = /\b\d{2}\.\d{2}\.\d{2}\b/g
const BRACKETS = /\[[^\]]*\]|\([^)]*\)/g

const MONTH_NUM: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function toYmd(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (year < 1990 || year > 2038) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (month === 2 && day > 29) return null
  if ([4, 6, 9, 11].includes(month) && day > 30) return null
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/**
 * Datas explícitas no nome (formatos comuns no catálogo).
 * Normaliza para YYYY-MM-DD. Se ambos os lados tiverem datas e nenhuma coincidir → não é o mesmo título.
 */
export function extractDatesFromVideoName(raw: string): Set<string> {
  const s = String(raw || '')
  const out = new Set<string>()

  for (const m of s.matchAll(/\((\d{2})\.(\d{2})\.(\d{4})\)/g)) {
    const d = toYmd(Number(m[3]), Number(m[2]), Number(m[1]))
    if (d) out.add(d)
  }
  for (const m of s.matchAll(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g)) {
    const d = toYmd(Number(m[3]), Number(m[2]), Number(m[1]))
    if (d) out.add(d)
  }
  for (const m of s.matchAll(/(?:^|[.\s_\-])(\d{2})\.(\d{2})\.(\d{2})(?=[.\s_\-]|$)/g)) {
    const yy = Number(m[1])
    const mm = Number(m[2])
    const dd = Number(m[3])
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue
    const year = yy >= 90 ? 1900 + yy : 2000 + yy
    const d = toYmd(year, mm, dd)
    if (d) out.add(d)
  }
  for (const m of s.matchAll(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})\b/gi,
  )) {
    const monKey = m[1]!.toLowerCase().slice(0, 3)
    const mon = MONTH_NUM[monKey]
    if (!mon) continue
    const d = toYmd(Number(m[3]), mon, Number(m[2]))
    if (d) out.add(d)
  }
  for (const m of s.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const d = toYmd(Number(m[1]), Number(m[2]), Number(m[3]))
    if (d) out.add(d)
  }
  return out
}

/** Ambos têm pelo menos uma data e nenhuma em comum → títulos diferentes. */
export function videoDatesConflict(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false
  for (const d of a) {
    if (b.has(d)) return false
  }
  return true
}

export type DuplicateScanVideo = {
  session: number
  trailerRel: string
  displayName: string
  stem: string
  tags: string[]
}

export type DuplicatePair = {
  score: number
  nameScore: number
  tagJaccard: number
  sharedTags: string[]
  a: DuplicateScanVideo
  b: DuplicateScanVideo
}

export type DuplicateGroup = {
  id: number
  maxScore: number
  videos: DuplicateScanVideo[]
  pairs: DuplicatePair[]
}

export type DuplicateScanOptions = {
  minScore?: number
  minSharedTags?: number
  session?: number | null
  maxGroups?: number
}

export type DuplicateScanResult = {
  scannedVideos: number
  candidatePairs: number
  matchedPairs: number
  groups: DuplicateGroup[]
  minScore: number
  minSharedTags: number
  ms: number
  savedAt?: string
}

const LEGACY_STORE_FILE = 'duplicate-candidates.json'
const LEGACY_VERDICTS_FILE = 'duplicate-verdicts.json'

export type DuplicateVideoRef = {
  session: number
  trailerRel: string
}

export type DuplicateVerdictReason = 'not_duplicate' | 'resolved'

export type DuplicateVerdict = {
  key: string
  a: DuplicateVideoRef
  b: DuplicateVideoRef
  reason: DuplicateVerdictReason
  at: string
}

export type StoredDuplicateScan = DuplicateScanResult & {
  savedAt: string
  options: {
    minScore: number
    minSharedTags: number
    session: number | null
    maxGroups: number
  }
}

function legacyStorePath() {
  return join(process.cwd(), 'data', LEGACY_STORE_FILE)
}

function legacyVerdictsPath() {
  return join(process.cwd(), 'data', LEGACY_VERDICTS_FILE)
}

export function videoRefKey(v: DuplicateVideoRef): string {
  return `${Math.floor(v.session)}::${String(v.trailerRel || '').trim().replace(/\\/g, '/')}`
}

export function duplicatePairKey(a: DuplicateVideoRef, b: DuplicateVideoRef): string {
  const ka = videoRefKey(a)
  const kb = videoRefKey(b)
  return ka <= kb ? `${ka}\n${kb}` : `${kb}\n${ka}`
}

function parseVideoRef(raw: unknown): DuplicateVideoRef | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { session?: unknown; trailerRel?: unknown }
  const session = typeof o.session === 'number' ? o.session : Number(o.session)
  const trailerRel =
    typeof o.trailerRel === 'string' ? o.trailerRel.trim().replace(/\\/g, '/') : ''
  if (!Number.isFinite(session) || session < 0 || !trailerRel) return null
  return { session: Math.floor(session), trailerRel }
}

function tryUnlink(path: string) {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* */
  }
}

let legacyDupMigrated = false

function migrateLegacyDuplicateJsonOnce(): void {
  if (legacyDupMigrated) return
  legacyDupMigrated = true
  const d = getVideoTagsDb()

  const verdictCnt = d.prepare('SELECT COUNT(*) AS c FROM duplicate_verdicts').get() as { c: number }
  if (verdictCnt.c === 0) {
    const path = legacyVerdictsPath()
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf8')
        const j = JSON.parse(raw) as { pairs?: unknown }
        if (j && typeof j === 'object' && Array.isArray(j.pairs) && j.pairs.length) {
          const ins = d.prepare(
            `INSERT OR REPLACE INTO duplicate_verdicts
              (pair_key, a_session, a_trailer_rel, b_session, b_trailer_rel, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          runVideoTagsTxn(d, () => {
            for (const row of j.pairs!) {
              if (!row || typeof row !== 'object') continue
              const o = row as {
                a?: unknown
                b?: unknown
                reason?: unknown
                at?: unknown
                key?: unknown
              }
              const a = parseVideoRef(o.a)
              const b = parseVideoRef(o.b)
              if (!a || !b) continue
              const reason = o.reason === 'resolved' ? 'resolved' : 'not_duplicate'
              const key = typeof o.key === 'string' && o.key ? o.key : duplicatePairKey(a, b)
              const at = typeof o.at === 'string' && o.at ? o.at : new Date().toISOString()
              ins.run(key, a.session, a.trailerRel, b.session, b.trailerRel, reason, at)
            }
          })
        }
        tryUnlink(path)
      } catch {
        /* */
      }
    }
  }

  const scanRow = d.prepare('SELECT id, groups_json FROM duplicate_scan WHERE id = 1').get() as
    | { id: number; groups_json: string }
    | undefined
  const scanEmpty =
    !scanRow ||
    !scanRow.groups_json ||
    scanRow.groups_json === '[]' ||
    scanRow.groups_json === 'null'
  if (scanEmpty) {
    const path = legacyStorePath()
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf8')
        const j = JSON.parse(raw) as StoredDuplicateScan
        if (j && typeof j === 'object' && Array.isArray(j.groups) && j.groups.length) {
          writeStoredDuplicateScan(
            {
              scannedVideos: j.scannedVideos ?? 0,
              candidatePairs: j.candidatePairs ?? 0,
              matchedPairs: j.matchedPairs ?? 0,
              groups: j.groups,
              minScore: j.minScore ?? j.options?.minScore ?? 0.75,
              minSharedTags: j.minSharedTags ?? j.options?.minSharedTags ?? 1,
              ms: j.ms ?? 0,
              savedAt: typeof j.savedAt === 'string' ? j.savedAt : undefined,
            },
            j.options ?? {
              minScore: j.minScore ?? 0.75,
              minSharedTags: j.minSharedTags ?? 1,
              session: null,
              maxGroups: 100,
            },
          )
          tryUnlink(path)
        }
      } catch {
        /* */
      }
    }
  }
}

export function readDuplicateVerdicts(): DuplicateVerdict[] {
  migrateLegacyDuplicateJsonOnce()
  repairDuplicateVerdictKeysOnce()
  const d = getVideoTagsDb()
  const rows = d
    .prepare(
      `SELECT pair_key, a_session, a_trailer_rel, b_session, b_trailer_rel, reason, created_at
       FROM duplicate_verdicts
       ORDER BY created_at ASC`,
    )
    .all() as {
    pair_key: string
    a_session: number
    a_trailer_rel: string
    b_session: number
    b_trailer_rel: string
    reason: string
    created_at: string
  }[]
  return rows.map((r) => {
    const a = { session: r.a_session, trailerRel: r.a_trailer_rel }
    const b = { session: r.b_session, trailerRel: r.b_trailer_rel }
    return {
      key: duplicatePairKey(a, b),
      a,
      b,
      reason: r.reason === 'resolved' ? 'resolved' : 'not_duplicate',
      at: r.created_at,
    }
  })
}

export function readDuplicateVerdictKeySet(): Set<string> {
  migrateLegacyDuplicateJsonOnce()
  repairDuplicateVerdictKeysOnce()
  const d = getVideoTagsDb()
  const rows = d
    .prepare('SELECT a_session, a_trailer_rel, b_session, b_trailer_rel FROM duplicate_verdicts')
    .all() as {
    a_session: number
    a_trailer_rel: string
    b_session: number
    b_trailer_rel: string
  }[]
  return new Set(
    rows.map((r) =>
      duplicatePairKey(
        { session: r.a_session, trailerRel: r.a_trailer_rel },
        { session: r.b_session, trailerRel: r.b_trailer_rel },
      ),
    ),
  )
}

let verdictKeysRepaired = false

/** pair_key antigo usava \\0 e o SQLite cortava a string — regenera a partir das colunas a/b. */
function repairDuplicateVerdictKeysOnce(): void {
  if (verdictKeysRepaired) return
  verdictKeysRepaired = true
  const d = getVideoTagsDb()
  const rows = d
    .prepare(
      `SELECT pair_key, a_session, a_trailer_rel, b_session, b_trailer_rel, reason, created_at
       FROM duplicate_verdicts`,
    )
    .all() as {
    pair_key: string
    a_session: number
    a_trailer_rel: string
    b_session: number
    b_trailer_rel: string
    reason: string
    created_at: string
  }[]
  if (!rows.length) return

  const needRepair = rows.some((r) => {
    const expected = duplicatePairKey(
      { session: r.a_session, trailerRel: r.a_trailer_rel },
      { session: r.b_session, trailerRel: r.b_trailer_rel },
    )
    return r.pair_key !== expected
  })
  if (!needRepair) return

  const del = d.prepare('DELETE FROM duplicate_verdicts')
  const ins = d.prepare(
    `INSERT OR REPLACE INTO duplicate_verdicts
      (pair_key, a_session, a_trailer_rel, b_session, b_trailer_rel, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  runVideoTagsTxn(d, () => {
    del.run()
    for (const r of rows) {
      const a = { session: r.a_session, trailerRel: r.a_trailer_rel }
      const b = { session: r.b_session, trailerRel: r.b_trailer_rel }
      const key = duplicatePairKey(a, b)
      const reason = r.reason === 'resolved' ? 'resolved' : 'not_duplicate'
      ins.run(key, a.session, a.trailerRel, b.session, b.trailerRel, reason, r.created_at)
    }
  })
}

export function addDuplicateVerdict(
  a: DuplicateVideoRef,
  b: DuplicateVideoRef,
  reason: DuplicateVerdictReason,
): DuplicateVerdict {
  migrateLegacyDuplicateJsonOnce()
  const key = duplicatePairKey(a, b)
  const at = new Date().toISOString()
  const next: DuplicateVerdict = {
    key,
    a: { session: a.session, trailerRel: a.trailerRel },
    b: { session: b.session, trailerRel: b.trailerRel },
    reason,
    at,
  }
  const d = getVideoTagsDb()
  d.prepare(
    `INSERT OR REPLACE INTO duplicate_verdicts
      (pair_key, a_session, a_trailer_rel, b_session, b_trailer_rel, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(key, a.session, a.trailerRel, b.session, b.trailerRel, reason, at)
  tryUnlink(legacyVerdictsPath())
  return next
}

/** Grava veredicto para todos os pares entre os vídeos do grupo. */
export function addDuplicateVerdictsForVideos(
  videos: DuplicateVideoRef[],
  reason: DuplicateVerdictReason,
): DuplicateVerdict[] {
  migrateLegacyDuplicateJsonOnce()
  const uniq = new Map<string, DuplicateVideoRef>()
  for (const v of videos) {
    const session = Math.floor(Number(v.session))
    const trailerRel = String(v.trailerRel || '').trim().replace(/\\/g, '/')
    if (!Number.isFinite(session) || session < 0 || !trailerRel) continue
    const ref = { session, trailerRel }
    uniq.set(videoRefKey(ref), ref)
  }
  const refs = [...uniq.values()]
  if (refs.length < 2) return []

  const at = new Date().toISOString()
  const out: DuplicateVerdict[] = []
  const d = getVideoTagsDb()
  const ins = d.prepare(
    `INSERT OR REPLACE INTO duplicate_verdicts
      (pair_key, a_session, a_trailer_rel, b_session, b_trailer_rel, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  runVideoTagsTxn(d, () => {
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const a = refs[i]!
        const b = refs[j]!
        const key = duplicatePairKey(a, b)
        ins.run(key, a.session, a.trailerRel, b.session, b.trailerRel, reason, at)
        out.push({
          key,
          a: { ...a },
          b: { ...b },
          reason,
          at,
        })
      }
    }
  })
  tryUnlink(legacyVerdictsPath())
  return out
}

class UnionFind {
  parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    let x = i
    while (this.parent[x] !== x) x = this.parent[x]
    let y = i
    while (y !== x) {
      const p = this.parent[y]
      this.parent[y] = x
      y = p
    }
    return x
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[rb] = ra
  }
}

function rebuildGroupsFromPairs(pairs: DuplicatePair[], maxGroups = 500): DuplicateGroup[] {
  const keyOf = (v: DuplicateScanVideo) => videoRefKey(v)
  const nodeKeys: string[] = []
  const nodeMap = new Map<string, number>()
  const ensure = (v: DuplicateScanVideo) => {
    const k = keyOf(v)
    let idx = nodeMap.get(k)
    if (idx !== undefined) return idx
    idx = nodeKeys.length
    nodeKeys.push(k)
    nodeMap.set(k, idx)
    return idx
  }
  const videoByKey = new Map<string, DuplicateScanVideo>()
  for (const p of pairs) {
    videoByKey.set(keyOf(p.a), p.a)
    videoByKey.set(keyOf(p.b), p.b)
    ensure(p.a)
    ensure(p.b)
  }
  const uf = new UnionFind(nodeKeys.length)
  for (const p of pairs) uf.union(ensure(p.a), ensure(p.b))

  const bucket = new Map<number, { videos: DuplicateScanVideo[]; pairs: DuplicatePair[]; maxScore: number }>()
  for (const p of pairs) {
    const root = uf.find(ensure(p.a))
    let g = bucket.get(root)
    if (!g) {
      g = { videos: [], pairs: [], maxScore: 0 }
      bucket.set(root, g)
    }
    g.pairs.push(p)
    if (p.score > g.maxScore) g.maxScore = p.score
  }
  for (const [root, g] of bucket) {
    const vids: DuplicateScanVideo[] = []
    const seen = new Set<string>()
    for (let i = 0; i < nodeKeys.length; i++) {
      if (uf.find(i) !== root) continue
      const k = nodeKeys[i]
      if (seen.has(k)) continue
      seen.add(k)
      const v = videoByKey.get(k)
      if (v) vids.push(v)
    }
    vids.sort((a, b) => a.session - b.session || a.displayName.localeCompare(b.displayName))
    g.videos = vids
  }

  return [...bucket.values()]
    .filter((g) => g.videos.length >= 2 && g.pairs.length >= 1)
    .sort((a, b) => b.maxScore - a.maxScore)
    .slice(0, maxGroups)
    .map((g, i) => ({
      id: i + 1,
      maxScore: g.maxScore,
      videos: g.videos,
      pairs: g.pairs.sort((x, y) => y.score - x.score),
    }))
}

/** Remove o par da lista gravada (mantém outros pares do grupo). */
export function removePairFromStoredDuplicateScan(
  a: DuplicateVideoRef,
  b: DuplicateVideoRef,
): StoredDuplicateScan | null {
  return removePairsAmongVideosFromStored([a, b])
}

/** Remove da lista gravada todos os pares entre estes vídeos (grupo inteiro). */
export function removePairsAmongVideosFromStored(
  videos: DuplicateVideoRef[],
): StoredDuplicateScan | null {
  const stored = readStoredDuplicateScan()
  if (!stored) return null
  const videoKeys = new Set(
    videos
      .map((v) => {
        const session = Math.floor(Number(v.session))
        const trailerRel = String(v.trailerRel || '').trim().replace(/\\/g, '/')
        if (!Number.isFinite(session) || session < 0 || !trailerRel) return ''
        return videoRefKey({ session, trailerRel })
      })
      .filter(Boolean),
  )
  if (videoKeys.size < 2) return stored

  const kept: DuplicatePair[] = []
  for (const g of stored.groups) {
    for (const p of g.pairs) {
      const ka = videoRefKey(p.a)
      const kb = videoRefKey(p.b)
      if (videoKeys.has(ka) && videoKeys.has(kb)) continue
      kept.push(p)
    }
  }
  const groups = rebuildGroupsFromPairs(kept, stored.options.maxGroups)
  return writeStoredDuplicateScan(
    {
      ...stored,
      groups,
      matchedPairs: groups.reduce((n, g) => n + g.pairs.length, 0),
    },
    stored.options,
  )
}

let scanInFlight: Promise<StoredDuplicateScan> | null = null

function parseGroupsJson(raw: string): DuplicateGroup[] {
  try {
    const groups = JSON.parse(raw) as unknown
    return Array.isArray(groups) ? (groups as DuplicateGroup[]) : []
  } catch {
    return []
  }
}

export function readStoredDuplicateScan(): StoredDuplicateScan | null {
  migrateLegacyDuplicateJsonOnce()
  const d = getVideoTagsDb()
  const row = d.prepare('SELECT * FROM duplicate_scan WHERE id = 1').get() as
    | {
        saved_at: string
        scanned_videos: number
        candidate_pairs: number
        matched_pairs: number
        min_score: number
        min_shared_tags: number
        ms: number
        opt_min_score: number
        opt_min_shared_tags: number
        opt_session: number | null
        opt_max_groups: number
        groups_json: string
      }
    | undefined
  if (!row) return null
  return {
    savedAt: row.saved_at,
    scannedVideos: row.scanned_videos,
    candidatePairs: row.candidate_pairs,
    matchedPairs: row.matched_pairs,
    minScore: row.min_score,
    minSharedTags: row.min_shared_tags,
    ms: row.ms,
    groups: parseGroupsJson(row.groups_json),
    options: {
      minScore: row.opt_min_score,
      minSharedTags: row.opt_min_shared_tags,
      session: row.opt_session == null ? null : Number(row.opt_session),
      maxGroups: row.opt_max_groups,
    },
  }
}

export function writeStoredDuplicateScan(
  result: DuplicateScanResult,
  options: StoredDuplicateScan['options'],
): StoredDuplicateScan {
  migrateLegacyDuplicateJsonOnce()
  const savedAt = result.savedAt || new Date().toISOString()
  const stored: StoredDuplicateScan = {
    ...result,
    savedAt,
    options,
  }
  const d = getVideoTagsDb()
  d.prepare(
    `INSERT INTO duplicate_scan (
      id, saved_at, scanned_videos, candidate_pairs, matched_pairs,
      min_score, min_shared_tags, ms,
      opt_min_score, opt_min_shared_tags, opt_session, opt_max_groups, groups_json
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      saved_at = excluded.saved_at,
      scanned_videos = excluded.scanned_videos,
      candidate_pairs = excluded.candidate_pairs,
      matched_pairs = excluded.matched_pairs,
      min_score = excluded.min_score,
      min_shared_tags = excluded.min_shared_tags,
      ms = excluded.ms,
      opt_min_score = excluded.opt_min_score,
      opt_min_shared_tags = excluded.opt_min_shared_tags,
      opt_session = excluded.opt_session,
      opt_max_groups = excluded.opt_max_groups,
      groups_json = excluded.groups_json`,
  ).run(
    savedAt,
    result.scannedVideos,
    result.candidatePairs,
    result.matchedPairs,
    result.minScore,
    result.minSharedTags,
    result.ms,
    options.minScore,
    options.minSharedTags,
    options.session,
    options.maxGroups,
    JSON.stringify(result.groups ?? []),
  )
  tryUnlink(legacyStorePath())
  return stored
}

export async function runAndStoreDuplicateScan(
  opts: DuplicateScanOptions = {},
  onProgress?: (p: DuplicateScanProgress) => void,
): Promise<StoredDuplicateScan> {
  if (scanInFlight) return scanInFlight
  scanInFlight = (async () => {
    const minScore = Math.max(0.4, Math.min(0.99, opts.minScore ?? 0.75))
    const minSharedTags = Math.max(1, Math.min(10, Math.floor(opts.minSharedTags ?? 1)))
    const maxGroups = Math.max(1, Math.min(500, Math.floor(opts.maxGroups ?? 100)))
    const session =
      typeof opts.session === 'number' && Number.isFinite(opts.session) && opts.session >= 0
        ? Math.floor(opts.session)
        : null
    const result = await scanDuplicateCandidates(
      {
        minScore,
        minSharedTags,
        session,
        maxGroups,
      },
      onProgress,
    )
    onProgress?.({
      phase: 'save',
      pct: 97,
      message: 'A gravar no SQLite…',
      scanned: result.scannedVideos,
      candidatePairs: result.candidatePairs,
      matchedPairs: result.matchedPairs,
    })
    return writeStoredDuplicateScan(result, {
      minScore: result.minScore,
      minSharedTags: result.minSharedTags,
      session,
      maxGroups,
    })
  })()
  try {
    return await scanInFlight
  } finally {
    scanInFlight = null
  }
}

export type DuplicateScanProgress = {
  phase: 'load' | 'index' | 'compare' | 'group' | 'save' | 'done' | 'error'
  pct: number
  message: string
  scanned?: number
  candidatePairs?: number
  matchedPairs?: number
  current?: number
  total?: number
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function isSystemTag(name: string): boolean {
  const n = name.trim().toLowerCase()
  return (
    n === COMPLETED_TAG_NAME ||
    n === TRAILER_WATCHED_TAG_NAME ||
    n === MEMORABLE_TAG_NAME
  )
}

export function displayNameFromTrailerRel(trailerRel: string): string {
  const base = trailerRel.replace(/\\/g, '/').split('/').pop() || trailerRel
  return base.replace(/\.[^.]+$/i, '') || base
}

export function normalizeNameForSimilarity(raw: string): { stem: string; tokens: Set<string> } {
  let s = String(raw || '').toLowerCase()
  s = s.replace(/\.[a-z0-9]{2,5}$/i, '')
  s = s.replace(BRACKETS, ' ')
  s = s.replace(DATE_DOT, ' ')
  s = s.replace(RELEASE_JUNK, ' ')
  s = s.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
  const tokens = new Set(
    s
      .split(' ')
      .map((t) => t.trim())
      .filter((t) => t.length > 1),
  )
  return { stem: s, tokens }
}

export function jaccardTokens(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) {
    if (b.has(t)) inter++
  }
  const uni = a.size + b.size - inter
  return uni > 0 ? inter / uni : 0
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatches = new Array<boolean>(a.length).fill(false)
  const bMatches = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let k = 0
  let transpositions = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const m = matches
  const jaro =
    (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3
  let prefix = 0
  const maxPrefix = Math.min(4, a.length, b.length)
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

function contentTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim()).filter((t) => t && !isSystemTag(t)))]
}

function tagSetLower(tags: string[]): Set<string> {
  return new Set(tags.map((t) => t.toLowerCase()))
}

function sharedTagNames(a: string[], b: string[]): string[] {
  const bSet = tagSetLower(b)
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of a) {
    const k = t.toLowerCase()
    if (!bSet.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  out.sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }))
  return out
}

type IndexedVideo = DuplicateScanVideo & {
  tokens: Set<string>
  tagKeys: Set<string>
  contentTagList: string[]
  dates: Set<string>
}

function toIndexed(row: TaggedVideoRow): IndexedVideo | null {
  const contentTagList = contentTags(row.tags)
  if (!contentTagList.length) return null
  const displayName = displayNameFromTrailerRel(row.trailerRel)
  const { stem, tokens } = normalizeNameForSimilarity(displayName)
  if (!stem && !tokens.size) return null
  return {
    session: row.session,
    trailerRel: row.trailerRel,
    displayName,
    stem,
    tags: row.tags,
    tokens,
    tagKeys: tagSetLower(contentTagList),
    contentTagList,
    dates: extractDatesFromVideoName(displayName),
  }
}

function nameScore(a: IndexedVideo, b: IndexedVideo): number {
  const jac = jaccardTokens(a.tokens, b.tokens)
  const jw = jaroWinkler(a.stem, b.stem)
  return 0.55 * jac + 0.45 * jw
}

function pairScore(a: IndexedVideo, b: IndexedVideo): DuplicatePair {
  const shared = sharedTagNames(a.contentTagList, b.contentTagList)
  const tagJac = jaccardTokens(a.tagKeys, b.tagKeys)
  const nScore = nameScore(a, b)
  const score = Math.min(1, 0.75 * nScore + 0.25 * tagJac)
  const pub = (v: IndexedVideo): DuplicateScanVideo => ({
    session: v.session,
    trailerRel: v.trailerRel,
    displayName: v.displayName,
    stem: v.stem,
    tags: v.contentTagList,
  })
  return {
    score,
    nameScore: nScore,
    tagJaccard: tagJac,
    sharedTags: shared,
    a: pub(a),
    b: pub(b),
  }
}

export async function scanDuplicateCandidates(
  opts: DuplicateScanOptions = {},
  onProgress?: (p: DuplicateScanProgress) => void,
): Promise<DuplicateScanResult> {
  const t0 = Date.now()
  const minScore = Math.max(0.4, Math.min(0.99, opts.minScore ?? 0.75))
  const minSharedTags = Math.max(1, Math.min(10, Math.floor(opts.minSharedTags ?? 1)))
  const maxGroups = Math.max(1, Math.min(500, Math.floor(opts.maxGroups ?? 100)))

  onProgress?.({ phase: 'load', pct: 2, message: 'A ler tags do SQLite…' })
  await yieldEventLoop()

  const roots = getVideoMenuRowsForCli().map((e) => e.path)
  const orphan = purgeOrphanVideoTags(roots)
  if (orphan.purged > 0) {
    onProgress?.({
      phase: 'load',
      pct: 5,
      message: `Removidas ${orphan.purged} tags órfãs (sem ficheiro)…`,
    })
    await yieldEventLoop()
  }

  const rows = filterTaggedVideosExistingOnDisk(listTaggedVideosForDuplicateScan(opts.session), roots)
  onProgress?.({
    phase: 'index',
    pct: 8,
    message: `A indexar ${rows.length} vídeos…`,
    scanned: rows.length,
    total: rows.length,
  })
  await yieldEventLoop()

  const indexed: IndexedVideo[] = []
  for (let r = 0; r < rows.length; r++) {
    const v = toIndexed(rows[r]!)
    if (v) indexed.push(v)
    if (r > 0 && r % 400 === 0) {
      onProgress?.({
        phase: 'index',
        pct: 8 + Math.floor((r / Math.max(1, rows.length)) * 12),
        message: `A indexar… ${r}/${rows.length}`,
        scanned: rows.length,
        current: r,
        total: rows.length,
      })
      await yieldEventLoop()
    }
  }

  const tagIndex = new Map<string, number[]>()
  for (let i = 0; i < indexed.length; i++) {
    for (const tag of indexed[i]!.tagKeys) {
      const arr = tagIndex.get(tag)
      if (arr) arr.push(i)
      else tagIndex.set(tag, [i])
    }
  }

  const maxTagFanout = Math.max(40, Math.floor(indexed.length * 0.04))
  for (const [tag, peers] of [...tagIndex.entries()]) {
    if (peers.length > maxTagFanout) tagIndex.delete(tag)
  }

  onProgress?.({
    phase: 'compare',
    pct: 22,
    message: `A comparar nomes (${indexed.length} vídeos)…`,
    scanned: indexed.length,
    total: indexed.length,
  })
  await yieldEventLoop()

  const considered = new Set<string>()
  const matched: DuplicatePair[] = []
  let candidatePairs = 0
  let lastYield = Date.now()

  for (let i = 0; i < indexed.length; i++) {
    const a = indexed[i]!
    const cand = new Map<number, number>()
    for (const tag of a.tagKeys) {
      const peers = tagIndex.get(tag)
      if (!peers) continue
      for (const j of peers) {
        if (j <= i) continue
        cand.set(j, (cand.get(j) ?? 0) + 1)
      }
    }
    for (const [j, sharedCount] of cand) {
      if (sharedCount < minSharedTags) continue
      const key = `${i}:${j}`
      if (considered.has(key)) continue
      considered.add(key)
      candidatePairs++
      const b = indexed[j]!
      if (videoDatesConflict(a.dates, b.dates)) continue
      const pair = pairScore(a, b)
      if (pair.sharedTags.length < minSharedTags) continue
      if (pair.nameScore < minScore) continue
      matched.push(pair)
    }

    const now = Date.now()
    if (i > 0 && (i % 80 === 0 || now - lastYield > 250)) {
      lastYield = now
      const pct = 22 + Math.floor((i / Math.max(1, indexed.length)) * 68)
      onProgress?.({
        phase: 'compare',
        pct: Math.min(90, pct),
        message: `A comparar… ${i}/${indexed.length} · ${matched.length} pares`,
        scanned: indexed.length,
        current: i,
        total: indexed.length,
        candidatePairs,
        matchedPairs: matched.length,
      })
      await yieldEventLoop()
    }
  }

  onProgress?.({
    phase: 'group',
    pct: 92,
    message: `A agrupar ${matched.length} pares…`,
    scanned: indexed.length,
    candidatePairs,
    matchedPairs: matched.length,
  })
  await yieldEventLoop()

  matched.sort((x, y) => y.score - x.score || y.nameScore - x.nameScore)

  const verdictKeys = readDuplicateVerdictKeySet()
  const active =
    verdictKeys.size > 0
      ? matched.filter((p) => !verdictKeys.has(duplicatePairKey(p.a, p.b)))
      : matched

  const groups = rebuildGroupsFromPairs(active, maxGroups)

  return {
    scannedVideos: indexed.length,
    candidatePairs,
    matchedPairs: active.length,
    groups,
    minScore,
    minSharedTags,
    ms: Date.now() - t0,
  }
}
