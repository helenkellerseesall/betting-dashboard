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



// ---- Best-bets / slip tracking (daily JSON; complements Phase 4 mlb_tracked_best) ----
/**
 * MLB Performance Tracking + Lightweight Model Feedback.
 *
 *   - ALWAYS records bets/slips to disk (fire-and-forget, never blocks pipeline)
 *   - Reads only the last N days of tracking files to build a summary
 *   - Produces non-binding `confidenceAdjustments` (small multipliers 0.90–1.10)
 *
 * The bet/slip files are written to:
 *
 *   backend/runtime/tracking/mlb_tracked_bets_YYYY-MM-DD.json
 *   backend/runtime/tracking/mlb_tracked_slips_YYYY-MM-DD.json
 *   backend/runtime/tracking/mlb_tracking_summary_YYYY-MM-DD.json
 *
 * Existing legacy `tracked_props_*` and `tracking_summary_*` filenames (used by
 * the slate snapshot system) are NOT touched, by design.
 *
 * Performance constraints:
 *   - Disk writes are async + non-awaited (pipeline never blocks)
 *   - Summary scan reads at most `windowDays` files (default 14)
 *   - Summary compute is O(totalBets in window)
 *   - Pruning runs async after summary
 *
 * Tracked fields (intentionally minimal — no projection objects, no raw rows):
 *   bet:  { id, date, player, eventId, prop, statFamily, side, line,
 *           oddsAmerican, sportsbook, modelProb, edge, confidence, tier,
 *           result }
 *   slip: { id, date, type, legs[{player,statFamily,side,line,oddsAmerican,result}],
 *           combinedAmericanOdds, combinedDecimalOdds, combinedModelProb, edge,
 *           result }
 */


const BETS_PREFIX = "mlb_tracked_bets_"
const SLIPS_PREFIX = "mlb_tracked_slips_"
const SUMMARY_PREFIX = "mlb_tracking_summary_"

const DEFAULT_WINDOW_DAYS = 14
const DEFAULT_PRUNE_KEEP_DAYS = 14

function fileFor(prefix, date) {
  return path.join(runtimeTrackingDir(), `${prefix}${date}.json`)
}

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback
    const s = fs.readFileSync(p, "utf8")
    if (!s) return fallback
    return JSON.parse(s)
  } catch (_) {
    return fallback
  }
}

/**
 * Atomic-ish write: write to .tmp then rename. Async, never throws into caller.
 */
function writeJsonAsync(p, obj) {
  try {
    ensureDirSync(runtimeTrackingDir())
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
    const data = JSON.stringify(obj, null, 0)
    fs.writeFile(tmp, data, "utf8", (err) => {
      if (err) return // swallow
      fs.rename(tmp, p, () => {
        // swallow rename error
      })
    })
  } catch (_) {
    // never throw from tracking
  }
}

/**
 * Synchronous, atomic-ish write. Used ONLY for the small daily bets/slips
 * files that the immediate-next summary read depends on. Files are <100KB,
 * so the cost is sub-millisecond and does not violate the "never slow the
 * pipeline" rule.
 *
 * Wrapped in try/catch — any disk error becomes a no-op so tracking failures
 * cannot break the live pipeline.
 */
function writeJsonSync(p, obj) {
  try {
    ensureDirSync(runtimeTrackingDir())
    const data = JSON.stringify(obj, null, 0)
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, data, "utf8")
    fs.renameSync(tmp, p)
  } catch (_) {
    // never throw from tracking
  }
}

/**
 * Stable id for a bet/leg so result ingestion can match without ordering.
 * Includes date so the same prop on different days is distinct.
 */
function idForBet(date, bet) {
  return [
    date,
    String(bet?.player || "").toLowerCase(),
    String(bet?.eventId || "").toLowerCase(),
    String(bet?.statFamily || "").toLowerCase(),
    String(bet?.side || "").toLowerCase(),
    Number(bet?.line),
    Number(bet?.oddsAmerican),
    String(bet?.sportsbook || "").toLowerCase(),
  ].join("|")
}

function idForSlipLeg(date, slipId, leg) {
  return [
    slipId,
    String(leg?.player || "").toLowerCase(),
    String(leg?.statFamily || "").toLowerCase(),
    String(leg?.side || "").toLowerCase(),
    Number(leg?.line),
  ].join("|")
}

function idForSlip(date, slip) {
  // Stable: type + sorted legs (player|stat|side|line)
  const legs = Array.isArray(slip?.legs) ? slip.legs : []
  const sig = legs
    .map((l) =>
      [
        String(l?.player || "").toLowerCase(),
        String(l?.statFamily || "").toLowerCase(),
        String(l?.side || "").toLowerCase(),
        Number(l?.line),
      ].join("|")
    )
    .sort()
    .join("__")
  return [date, String(slip?.type || ""), sig].join("##")
}

/**
 * Convert a bestBetsBoard play into the lean tracked-bet record.
 * Strips projection / range / reasoning to keep the file small.
 */
function leanBet(play, date) {
  return {
    id: idForBet(date, play),
    date,
    player: play.player,
    eventId: play.eventId || null,
    matchup: play.matchup || null,
    prop: `${play.statFamily} ${play.side} ${play.line}`,
    statFamily: play.statFamily,
    side: play.side,
    line: play.line,
    oddsAmerican: play.oddsAmerican,
    sportsbook: play.sportsbook || null,
    modelProb: play.modelProb,
    impliedProb: play.impliedProb,
    edge: play.edge,
    confidence: play.confidence,
    tier: play.tier,
    result: "pending",
    settledAt: null,
  }
}

function leanSlip(slip, date) {
  const id = idForSlip(date, slip)
  const legs = (slip.legs || []).map((l) => ({
    id: idForSlipLeg(date, id, l),
    player: l.player,
    statFamily: l.statFamily,
    side: l.side,
    line: l.line,
    oddsAmerican: l.oddsAmerican,
    result: "pending",
  }))
  return {
    id,
    date,
    type: slip.type,
    legCount: slip.legCount,
    legs,
    combinedDecimalOdds: slip.combinedDecimalOdds,
    combinedAmericanOdds: slip.combinedAmericanOdds,
    combinedModelProb: slip.combinedModelProb,
    combinedImpliedProb: slip.combinedImpliedProb,
    edge: slip.edge,
    ev: slip.ev,
    result: "pending",
    settledAt: null,
  }
}

/**
 * Public — fire-and-forget save of today's bets + slips. Never blocks.
 *
 * If a file already exists for today, merges by `id` keeping the existing
 * `result` for already-settled rows (so re-running the pipeline same day
 * doesn't reset graded results).
 */
function persistTrackedToday({ bestBetsBoard, date = dateKeyFromNow() } = {}) {
  if (!bestBetsBoard) return
  const board = bestBetsBoard
  const allPlays = Array.isArray(board.allPlays) ? board.allPlays : []

  // -------- Bets --------
  const newBets = allPlays.map((p) => leanBet(p, date))
  const betsPath = fileFor(BETS_PREFIX, date)
  const existingBets = Array.isArray(readJsonSafe(betsPath, [])) ? readJsonSafe(betsPath, []) : []
  const mergedBetsById = new Map()
  for (const b of existingBets) mergedBetsById.set(b.id, b)
  for (const b of newBets) {
    const prev = mergedBetsById.get(b.id)
    if (prev && prev.result && prev.result !== "pending") {
      // Preserve graded result.
      mergedBetsById.set(b.id, { ...b, result: prev.result, settledAt: prev.settledAt })
    } else {
      mergedBetsById.set(b.id, b)
    }
  }
  writeJsonSync(betsPath, Array.from(mergedBetsById.values()))

  // -------- Slips --------
  const slips = board.slips || {}
  const slipBucket = []
  for (const t of ["safe", "balanced", "aggressive", "lotto"]) {
    for (const s of Array.isArray(slips[t]) ? slips[t] : []) {
      slipBucket.push({ ...s, type: s.type || t.toUpperCase() })
    }
  }
  const newSlips = slipBucket.map((s) => leanSlip(s, date))
  const slipsPath = fileFor(SLIPS_PREFIX, date)
  const existingSlips = Array.isArray(readJsonSafe(slipsPath, []))
    ? readJsonSafe(slipsPath, [])
    : []
  const mergedSlipsById = new Map()
  for (const s of existingSlips) mergedSlipsById.set(s.id, s)
  for (const s of newSlips) {
    const prev = mergedSlipsById.get(s.id)
    if (prev && prev.result && prev.result !== "pending") {
      mergedSlipsById.set(s.id, { ...s, result: prev.result, settledAt: prev.settledAt, legs: prev.legs })
    } else {
      mergedSlipsById.set(s.id, s)
    }
  }
  writeJsonSync(slipsPath, Array.from(mergedSlipsById.values()))
}

/**
 * Apply a results map to today's tracked file. Used by the result-ingestion CLI.
 *
 * resultsByBetId: { [id]: "win" | "loss" | "void" | "push" }
 * resultsByLegId: { [legId]: "win" | "loss" | "void" | "push" }   (slips)
 *
 * Slip result derives automatically from legs:
 *   - any "loss" leg → slip "loss"
 *   - all "win" → slip "win"
 *   - else → "pending" (or "void" if any void w/ rest unsettled)
 *
 * Synchronous — this runs from a CLI/admin tool, NOT in the live pipeline.
 */
function applyResults({ date = dateKeyFromNow(), bets = {}, legs = {} } = {}) {
  const now = new Date().toISOString()
  const betsPath = fileFor(BETS_PREFIX, date)
  const slipsPath = fileFor(SLIPS_PREFIX, date)

  const trackedBets = readJsonSafe(betsPath, [])
  if (Array.isArray(trackedBets)) {
    for (const b of trackedBets) {
      const r = bets[b.id]
      if (r && b.result !== r) {
        b.result = r
        b.settledAt = now
      }
    }
    writeJsonSync(betsPath, trackedBets)
  }

  const trackedSlips = readJsonSafe(slipsPath, [])
  if (Array.isArray(trackedSlips)) {
    for (const slip of trackedSlips) {
      let anyLoss = false
      let allWin = true
      let anyPending = false
      for (const leg of slip.legs || []) {
        const lr = legs[leg.id]
        if (lr && leg.result !== lr) {
          leg.result = lr
        }
        if (leg.result === "loss") anyLoss = true
        if (leg.result !== "win") allWin = false
        if (!leg.result || leg.result === "pending") anyPending = true
      }
      if (anyLoss) {
        slip.result = "loss"
        slip.settledAt = now
      } else if (allWin) {
        slip.result = "win"
        slip.settledAt = now
      } else if (anyPending) {
        slip.result = "pending"
      } else {
        slip.result = "void"
        slip.settledAt = now
      }
    }
    writeJsonSync(slipsPath, trackedSlips)
  }

  return {
    date,
    betsUpdated: trackedBets.length,
    slipsUpdated: trackedSlips.length,
  }
}

/**
 * List YYYY-MM-DD strings for the last `windowDays` days, today inclusive.
 */
function recentDateKeys(windowDays = DEFAULT_WINDOW_DAYS) {
  const out = []
  const today = new Date()
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * Compute hit-rate metrics from settled bets.
 *
 *   hitRate = wins / (wins + losses)         (push/void excluded)
 *   roi     = sum(returnPerUnitStaked) / settledCount
 *
 * For ROI we approximate per-unit return using American odds:
 *   win:  decimalOdds - 1
 *   loss: -1
 *   void/push: 0
 */
function trAmericanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n > 0) return 1 + n / 100
  return 1 + 100 / Math.abs(n)
}

function computeHitRoi(records, oddsKey = "oddsAmerican") {
  let wins = 0
  let losses = 0
  let pushes = 0
  let voids = 0
  let pending = 0
  let returnSum = 0
  let staked = 0
  for (const r of records || []) {
    const res = String(r.result || "pending").toLowerCase()
    if (res === "win") {
      wins += 1
      const d = trAmericanToDecimal(r[oddsKey])
      if (Number.isFinite(d)) returnSum += d - 1
      staked += 1
    } else if (res === "loss") {
      losses += 1
      returnSum -= 1
      staked += 1
    } else if (res === "push") {
      pushes += 1
    } else if (res === "void") {
      voids += 1
    } else {
      pending += 1
    }
  }
  const settled = wins + losses
  return {
    total: records.length,
    wins,
    losses,
    pushes,
    voids,
    pending,
    settled,
    hitRate: settled > 0 ? wins / settled : null,
    roi: staked > 0 ? returnSum / staked : null,
  }
}

/**
 * Compute confidence adjustment multiplier from observed vs expected.
 *
 * For a group with N settled bets:
 *   expectedHitRate = mean(modelProb of settled bets)
 *   observedHitRate = wins / settled
 *
 *   ratio = observed / expected
 *   multiplier = clamp(0.90, 1.10, 1 + (ratio - 1) * smoothing)
 *
 * `smoothing` shrinks the adjustment toward 1.0 when sample is small.
 */
function adjustmentFromGroup(records, settledStats) {
  if (!settledStats || settledStats.settled < 8) {
    return { multiplier: 1.0, reason: "insufficient sample (<8 settled)" }
  }
  const settled = records.filter((r) => {
    const v = String(r.result || "").toLowerCase()
    return v === "win" || v === "loss"
  })
  const expected =
    settled.reduce((a, r) => a + Number(r.modelProb || 0), 0) / Math.max(1, settled.length)
  const observed = settledStats.hitRate
  if (!Number.isFinite(observed) || !Number.isFinite(expected) || expected <= 0) {
    return { multiplier: 1.0, reason: "no valid expectation" }
  }
  const ratio = observed / expected
  // Smoothing scales with sample size; >=40 bets → full effect, <8 → ~0.
  const smoothing = Math.min(1, settledStats.settled / 40)
  const raw = 1 + (ratio - 1) * smoothing
  const multiplier = Math.max(0.9, Math.min(1.1, raw))
  return {
    multiplier: Math.round(multiplier * 1000) / 1000,
    expected: Math.round(expected * 10000) / 10000,
    observed: Math.round(observed * 10000) / 10000,
    sample: settledStats.settled,
    reason:
      ratio > 1.05
        ? "underconfident — model lower than reality, multiplier > 1"
        : ratio < 0.95
        ? "overconfident — model higher than reality, multiplier < 1"
        : "calibrated within ±5%",
  }
}

/**
 * Build the rolling summary across the last `windowDays` days.
 *
 * Output is intentionally compact:
 *   {
 *     window: { days, dates },
 *     bets:   { hit, roi, byStat: { points, threes, ... }, byTier: { ELITE, ... } },
 *     slips:  { hit, roi, byType: { SAFE, BALANCED, ... } },
 *     confidenceAdjustments: { byStat, byTier, byBoard },
 *   }
 */
function buildMlbTrackingSummary({ windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const generatedAt = new Date().toISOString()
  const dates = recentDateKeys(windowDays)
  const bets = []
  const slips = []
  for (const d of dates) {
    const b = readJsonSafe(fileFor(BETS_PREFIX, d), [])
    if (Array.isArray(b)) for (const r of b) bets.push(r)
    const s = readJsonSafe(fileFor(SLIPS_PREFIX, d), [])
    if (Array.isArray(s)) for (const r of s) slips.push(r)
  }

  // Overall.
  const betsAll = computeHitRoi(bets)

  // By stat family.
  const families = [
    "hits",
    "totalbases",
    "hr",
    "rbis",
    "runs",
    "batterks",
    "ks",
    "outs",
    "hitsallowed",
    "earnedruns",
    "walks",
  ]
  const byStat = {}
  for (const f of families) {
    const subset = bets.filter((r) => String(r.statFamily || "").toLowerCase() === f)
    const stats = computeHitRoi(subset)
    byStat[f] = {
      ...stats,
      adjustment: adjustmentFromGroup(subset, stats),
    }
  }

  // By tier.
  const tiers = ["ELITE", "STRONG", "PLAYABLE", "LONGSHOT"]
  const byTier = {}
  for (const t of tiers) {
    const subset = bets.filter((r) => String(r.tier || "").toUpperCase() === t)
    const stats = computeHitRoi(subset)
    byTier[t] = {
      ...stats,
      adjustment: adjustmentFromGroup(subset, stats),
    }
  }

  // Slips.
  const slipsAll = computeHitRoi(slips, "combinedAmericanOdds")
  const slipTypes = ["SAFE", "BALANCED", "AGGRESSIVE", "LOTTO"]
  const byType = {}
  for (const t of slipTypes) {
    const subset = slips.filter((r) => String(r.type || "").toUpperCase() === t)
    byType[t] = computeHitRoi(subset, "combinedAmericanOdds")
  }

  // Build the consolidated `confidenceAdjustments` block.
  const confidenceAdjustments = {
    byStat: Object.fromEntries(Object.entries(byStat).map(([k, v]) => [k, v.adjustment])),
    byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, v.adjustment])),
  }

  // Persist today's summary file (fire-and-forget).
  const today = dateKeyFromNow()
  const summaryPayload = {
    metadata: {
      date: today,
      generatedAt,
      windowDays,
      version: "mlb-tracking-v1",
    },
    window: { days: windowDays, dates },
    bets: {
      ...betsAll,
      byStat,
      byTier,
    },
    slips: {
      ...slipsAll,
      byType,
    },
    confidenceAdjustments,
  }
  writeJsonAsync(fileFor(SUMMARY_PREFIX, today), summaryPayload)

  return summaryPayload
}

/**
 * Async, fire-and-forget pruning. Removes any mlb_tracked_bets_, mlb_tracked_slips_
 * or mlb_tracking_summary_ file older than `keepDays`. Other files in the
 * directory (legacy systems) are left untouched.
 */
function pruneOldTrackingFilesAsync({ keepDays = DEFAULT_PRUNE_KEEP_DAYS } = {}) {
  setImmediate(() => {
    try {
      ensureDirSync(runtimeTrackingDir())
      const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
      const files = fs.readdirSync(runtimeTrackingDir())
      for (const f of files) {
        if (
          !f.startsWith(BETS_PREFIX) &&
          !f.startsWith(SLIPS_PREFIX) &&
          !f.startsWith(SUMMARY_PREFIX)
        ) {
          continue
        }
        // Filename ends with YYYY-MM-DD.json — parse the date.
        const m = f.match(/(\d{4}-\d{2}-\d{2})\.json$/)
        if (!m) continue
        const t = Date.parse(m[1])
        if (!Number.isFinite(t)) continue
        if (t < cutoff) {
          fs.unlink(path.join(runtimeTrackingDir(), f), () => {})
        }
      }
    } catch (_) {
      // never throw
    }
  })
}
module.exports = {
  readMlbTrackedBestSnapshot,
  recordMlbBestProps,
  evaluateMlbPerformance,
  recordMlbDailyPicks,
  evaluateMlbPicks,
  persistTrackedToday,
  applyResults,
  buildMlbTrackingSummary,
  pruneOldTrackingFilesAsync,
}
