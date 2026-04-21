"use strict"

const fs = require("fs")
const path = require("path")

const MLB_TRACKED_BEST_PREFIX = "mlb_tracked_best_"
const LEGACY_TRACKED_PREFIX = "tracked_props_"

function dateKeyFromNow(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

function runtimeTrackingDir() {
  return path.join(__dirname, "..", "..", "runtime", "tracking")
}

function mlbTrackedBestPath(slateDate) {
  return path.join(runtimeTrackingDir(), `${MLB_TRACKED_BEST_PREFIX}${slateDate}.json`)
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
  const hitRate = decided > 0 ? wins / decided : null

  const oddsVals = mlb.map((e) => Number(e?.odds)).filter((n) => Number.isFinite(n))
  const avgOdds = oddsVals.length ? oddsVals.reduce((a, b) => a + b, 0) / oddsVals.length : null

  const edgeVals = mlb.map((e) => Number(e?.edgeProbability)).filter((n) => Number.isFinite(n))
  const avgEdge = edgeVals.length ? edgeVals.reduce((a, b) => a + b, 0) / edgeVals.length : null

  return {
    ok: true,
    date,
    source,
    totalBets,
    wins,
    losses,
    hitRate,
    avgOdds,
    avgEdge,
  }
}

module.exports = {
  readMlbTrackedBestSnapshot,
  recordMlbBestProps,
  evaluateMlbPerformance,
}
