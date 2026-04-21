"use strict"

const fs = require("fs")
const path = require("path")

const MLB_TRACKED_BEST_PREFIX = "mlb_tracked_best_"
const MLB_PICKS_PREFIX = "mlb_picks_"
const LEGACY_TRACKED_PREFIX = "tracked_props_"

function dateKeyFromNow(now = Date.now()) {
  // Use server-local date to avoid UTC midnight drift between write/read.
  const d = new Date(now)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function runtimeTrackingDir() {
  return path.join(__dirname, "..", "..", "runtime", "tracking")
}

function mlbTrackedBestPath(slateDate) {
  return path.join(runtimeTrackingDir(), `${MLB_TRACKED_BEST_PREFIX}${slateDate}.json`)
}

function mlbPicksPath(slateDate) {
  return path.join(runtimeTrackingDir(), `${MLB_PICKS_PREFIX}${slateDate}.json`)
}

function legacyTrackedPropsPath(slateDate) {
  return path.join(runtimeTrackingDir(), `${LEGACY_TRACKED_PREFIX}${slateDate}.json`)
}

function ensureDirSync(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true })
  } catch (_) {
    // ignore
  }
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

function safeWriteJson(filePath, payload) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
    return true
  } catch (_) {
    return false
  }
}

function isMlbBestAvailableEntry(e) {
  return e?.sport === "mlb" && e?.bucket === "mlb.bestAvailable.best"
}

/**
 * Normalize persisted MLB tracking JSON to `{ metadata, entries }`.
 * Accepts legacy shapes that used `allTrackedProps` inside the MLB-only file.
 */
function normalizeMlbTrackedPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return { metadata: {}, entries: [] }
  }
  let entries = []
  if (Array.isArray(raw.entries)) {
    entries = raw.entries.filter(isMlbBestAvailableEntry)
  } else if (Array.isArray(raw.allTrackedProps)) {
    entries = raw.allTrackedProps.filter(isMlbBestAvailableEntry)
  }
  return { metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}, entries }
}

function loadLegacyMlbBestEntries(slateDate) {
  const legacyPath = legacyTrackedPropsPath(slateDate)
  const legacy = safeReadJson(legacyPath)
  const rows = Array.isArray(legacy?.allTrackedProps) ? legacy.allTrackedProps : []
  return rows.filter(isMlbBestAvailableEntry)
}

/**
 * Read MLB best-available tracking for a slate date (dedicated file only).
 * @param {string} slateDate YYYY-MM-DD
 * @returns {{ ok: boolean, path: string, payload: { metadata: object, entries: object[] } }}
 */
function readMlbTrackedBestSnapshot(slateDate) {
  const date =
    typeof slateDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(slateDate)
      ? slateDate
      : dateKeyFromNow()
  const filePath = mlbTrackedBestPath(date)
  const raw = safeReadJson(filePath)
  const { metadata, entries } = normalizeMlbTrackedPayload(raw)
  const meta = {
    sport: "mlb",
    slateDate: date,
    ...metadata,
    slateDate: metadata.slateDate || date
  }
  return {
    ok: Boolean(raw),
    path: filePath,
    payload: { metadata: meta, entries }
  }
}

function legKey(row) {
  return [
    String(row?.player || "").trim().toLowerCase(),
    String(row?.team || "").trim().toLowerCase(),
    String(row?.propType || "").trim(),
    String(row?.side || "").trim(),
    String(row?.line ?? ""),
    String(row?.book || "").trim(),
  ].join("|")
}

function toTrackedMlbPick(row, { slateDate, timestamp }) {
  return {
    slateDate,
    timestamp,

    player: row?.player ?? null,
    team: row?.team ?? null,
    propType: row?.propType ?? null,
    side: row?.side ?? null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,

    predictedProbability: row?.predictedProbability ?? null,
    edge: row?.edgeProbability ?? row?.edge ?? null,

    // Result fields (initially null)
    result: null, // "win" | "loss" | null
    closingLine: null,
    closingOdds: null,
  }
}

function toTrackedMlbBestEntry(row, { slateDate, timestamp }) {
  return {
    slateDate,
    sport: "mlb",
    player: row?.player ?? null,
    team: row?.team ?? null,
    propType: row?.propType ?? null,
    side: row?.side ?? null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,
    predictedProbability: row?.predictedProbability ?? null,
    edgeProbability: row?.edgeProbability ?? null,
    mlbPhase3Score: row?.mlbPhase3Score ?? null,
    timestamp,

    // Phase 4 result fields (initially null)
    result: null, // "win" | "loss" | null
    closingOdds: null,
    clv: null,

    // Traceability (non-breaking, additive)
    book: row?.book ?? null,
    marketKey: row?.marketKey ?? null,
    bucket: "mlb.bestAvailable.best",
  }
}

/**
 * Record MLB best props for Phase 4 tracking.
 * Writes only to `backend/runtime/tracking/mlb_tracked_best_<date>.json` (MLB-only, queryable).
 * On first create, seeds from legacy `tracked_props_<date>.json` MLB rows if present (one-time carryover).
 *
 * @param {object[]} bestProps
 * @param {{ now?: number }} options
 * @returns {{ ok: boolean, path: string, added: number, totalMlbBest: number }}
 */
function recordMlbBestProps(bestProps, options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const slateDate = dateKeyFromNow(now)
  const timestamp = new Date(now).toISOString()

  const runtimeDir = runtimeTrackingDir()
  ensureDirSync(runtimeDir)
  const filePath = mlbTrackedBestPath(slateDate)

  const existingRaw = safeReadJson(filePath)
  let { metadata, entries } = normalizeMlbTrackedPayload(existingRaw)

  if (!existingRaw && entries.length === 0) {
    entries = loadLegacyMlbBestEntries(slateDate)
  }

  const payload = {
    metadata: {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      sport: "mlb",
      slateDate,
      generatedAt: timestamp,
      version: "tracking-phase-4-mlb",
      bucket: "mlb.bestAvailable.best",
      storage: "mlb_tracked_best",
    },
    entries: [...entries],
  }

  const incoming = Array.isArray(bestProps) ? bestProps : []
  const seen = new Set(entries.map((e) => legKey(e)))
  let added = 0

  for (const row of incoming) {
    const key = legKey(row)
    if (!key || key === "|||||") continue
    if (seen.has(key)) continue
    seen.add(key)
    payload.entries.push(toTrackedMlbBestEntry(row, { slateDate, timestamp }))
    added += 1
  }

  const ok = safeWriteJson(filePath, payload)
  const totalMlbBestAfter = payload.entries.length
  return { ok, path: filePath, added, totalMlbBest: totalMlbBestAfter }
}

/**
 * Evaluate MLB tracked performance (Phase 4).
 * Reads `mlb_tracked_best_<date>.json`; falls back to legacy rows inside `tracked_props_<date>.json` if empty.
 *
 * @param {{ date?: string, now?: number }} options
 * @returns {{
 *   ok: boolean,
 *   date: string,
 *   source: string,
 *   totalBets: number,
 *   wins: number,
 *   losses: number,
 *   hitRate: number|null,
 *   avgOdds: number|null,
 *   avgEdge: number|null
 * }}
 */
function evaluateMlbPerformance(options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const date = typeof options?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
    ? options.date
    : dateKeyFromNow(now)

  const snap = readMlbTrackedBestSnapshot(date)
  let mlb = Array.isArray(snap.payload?.entries) ? snap.payload.entries : []
  let source = snap.ok && mlb.length ? "mlb_tracked_best" : "none"

  if (!mlb.length) {
    mlb = loadLegacyMlbBestEntries(date)
    source = mlb.length ? "tracked_props_legacy" : "none"
  }

  const totalBets = mlb.length
  const wins = mlb.filter((e) => e?.result === "win").length
  const losses = mlb.filter((e) => e?.result === "loss").length
  const decided = wins + losses
  const hitRate = decided > 0 ? wins / decided : 0

  const oddsVals = mlb.map((e) => Number(e?.odds)).filter((n) => Number.isFinite(n))
  const avgOdds = oddsVals.length ? oddsVals.reduce((a, b) => a + b, 0) / oddsVals.length : null

  const edgeVals = mlb.map((e) => Number(e?.edgeProbability)).filter((n) => Number.isFinite(n))
  const avgEdge = edgeVals.length ? edgeVals.reduce((a, b) => a + b, 0) / edgeVals.length : null

  const emptyBucket = () => ({ totalBets: 0, wins: 0, losses: 0, hitRate: 0 })

  const normalizePropTypeKey = (pt) => {
    const s = String(pt || "").trim()
    if (!s) return "unknown"
    if (s === "Home Runs") return "HR"
    if (s === "Hits") return "Hits"
    if (s === "Total Bases") return "TB"
    if (s === "RBIs") return "RBI"
    return s
  }

  const edgeBucket = (edge) => {
    const e = Number(edge)
    if (!Number.isFinite(e)) return "unknown"
    if (e < 0.1) return "0-0.1"
    if (e < 0.2) return "0.1-0.2"
    if (e < 0.3) return "0.2-0.3"
    if (e < 0.4) return "0.3-0.4"
    return "0.4+"
  }

  const oddsBucket = (odds) => {
    const o = Number(odds)
    if (!Number.isFinite(o) || o === 0) return "unknown"
    if (o < 0) {
      if (o >= -110) return "fav_-110_to_-101"
      if (o >= -150) return "fav_-150_to_-111"
      if (o >= -250) return "fav_-250_to_-151"
      return "fav_-250+"
    }
    if (o <= 120) return "plus_+1_to_+120"
    if (o <= 200) return "plus_+121_to_+200"
    if (o <= 400) return "plus_+201_to_+400"
    return "plus_+401+"
  }

  const bump = (map, key, entry) => {
    const k = String(key || "unknown")
    if (!map[k]) map[k] = emptyBucket()
    map[k].totalBets += 1
    if (entry?.result === "win") map[k].wins += 1
    if (entry?.result === "loss") map[k].losses += 1
  }

  const finalizeBuckets = (map) => {
    const out = {}
    for (const [k, v] of Object.entries(map)) {
      const d = (v.wins || 0) + (v.losses || 0)
      out[k] = {
        totalBets: v.totalBets,
        wins: v.wins,
        losses: v.losses,
        hitRate: d > 0 ? v.wins / d : 0,
      }
    }
    return out
  }

  const byPropTypeMap = {}
  const byEdgeBucketMap = {}
  const byOddsBucketMap = {}

  for (const e of mlb) {
    bump(byPropTypeMap, normalizePropTypeKey(e?.propType), e)
    bump(byEdgeBucketMap, edgeBucket(e?.edgeProbability), e)
    bump(byOddsBucketMap, oddsBucket(e?.odds), e)
  }

  const learning = {
    byPropType: finalizeBuckets(byPropTypeMap),
    byEdgeBucket: finalizeBuckets(byEdgeBucketMap),
    byOddsBucket: finalizeBuckets(byOddsBucketMap),
  }

  const rankBuckets = (obj, minDecided = 3) => {
    const rows = Object.entries(obj || {}).map(([key, v]) => {
      const decidedLocal = (v.wins || 0) + (v.losses || 0)
      return { key, ...v, decided: decidedLocal }
    })
    const eligible = rows.filter((r) => r.decided >= minDecided)
    const sorted = eligible.slice().sort((a, b) => b.hitRate - a.hitRate)
    return {
      minDecided,
      best: sorted.slice(0, 3).map((r) => ({ key: r.key, hitRate: r.hitRate, wins: r.wins, losses: r.losses, totalBets: r.totalBets })),
      worst: sorted
        .slice()
        .reverse()
        .slice(0, 3)
        .map((r) => ({ key: r.key, hitRate: r.hitRate, wins: r.wins, losses: r.losses, totalBets: r.totalBets })),
    }
  }

  console.log("[MLB LEARNING]", {
    date,
    file: snap?.path || null,
    totals: { totalBets, wins, losses, decided, hitRate },
    byPropType: rankBuckets(learning.byPropType),
    byEdgeBucket: rankBuckets(learning.byEdgeBucket),
    byOddsBucket: rankBuckets(learning.byOddsBucket),
  })

  return {
    ok: true,
    date,
    source,
    file: snap?.path || null,
    count: totalBets,
    totalBets,
    wins,
    losses,
    hitRate,
    avgOdds,
    avgEdge,
    learning,
  }
}

/**
 * Record today's MLB picks (every run; file grows).
 * Writes to `backend/runtime/tracking/mlb_picks_<date>.json`.
 *
 * @param {object[]} bestRows
 * @param {{ now?: number }} options
 * @returns {{ ok: boolean, path: string, added: number, total: number }}
 */
function recordMlbDailyPicks(bestRows, options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const slateDate = dateKeyFromNow(now)
  const timestamp = new Date(now).toISOString()

  const runtimeDir = runtimeTrackingDir()
  ensureDirSync(runtimeDir)
  const filePath = mlbPicksPath(slateDate)

  const existing = safeReadJson(filePath)
  const payload = {
    metadata: {
      sport: "mlb",
      slateDate,
      version: "mlb-picks-v1",
      updatedAt: timestamp,
    },
    picks: Array.isArray(existing?.picks) ? existing.picks : [],
  }

  const incoming = Array.isArray(bestRows) ? bestRows : []
  // Avoid duplicates within a single run only.
  const runSeen = new Set()
  let added = 0
  for (const row of incoming) {
    const key = legKey(row)
    if (!key || key === "|||||") continue
    if (runSeen.has(key)) continue
    runSeen.add(key)
    payload.picks.push(toTrackedMlbPick(row, { slateDate, timestamp }))
    added += 1
  }

  const ok = safeWriteJson(filePath, payload)
  return { ok, path: filePath, added, total: Array.isArray(payload.picks) ? payload.picks.length : 0 }
}

/**
 * Evaluate today's MLB picks.
 * @param {{ date?: string, now?: number }} options
 * @returns {{
 *   ok: boolean,
 *   date: string,
 *   path: string,
 *   totalPicks: number,
 *   decided: number,
 *   wins: number,
 *   losses: number,
 *   hitRate: number,
 *   avgEdge: number,
 *   avgPredictedProbability: number
 * }}
 */
function evaluateMlbPicks(options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const date = typeof options?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
    ? options.date
    : dateKeyFromNow(now)

  const filePath = mlbPicksPath(date)
  const raw = safeReadJson(filePath)
  const picks = Array.isArray(raw?.picks) ? raw.picks : []

  const wins = picks.filter((p) => p?.result === "win").length
  const losses = picks.filter((p) => p?.result === "loss").length
  const decided = wins + losses
  const hitRate = decided > 0 ? wins / decided : 0

  const edgeVals = picks.map((p) => Number(p?.edge)).filter((n) => Number.isFinite(n))
  const avgEdge = edgeVals.length ? edgeVals.reduce((a, b) => a + b, 0) / edgeVals.length : 0

  const predVals = picks.map((p) => Number(p?.predictedProbability)).filter((n) => Number.isFinite(n))
  const avgPredictedProbability = predVals.length ? predVals.reduce((a, b) => a + b, 0) / predVals.length : 0

  return {
    ok: true,
    date,
    path: filePath,
    totalPicks: picks.length,
    decided,
    wins,
    losses,
    hitRate,
    avgEdge,
    avgPredictedProbability,
  }
}

module.exports = {
  readMlbTrackedBestSnapshot,
  recordMlbBestProps,
  evaluateMlbPerformance,
  recordMlbDailyPicks,
  evaluateMlbPicks,
}
