"use strict"

const fs = require("fs")
const path = require("path")

function dateKeyFromNow(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
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
 * Appends/merges into backend/runtime/tracking/tracked_props_<date>.json without
 * overwriting existing NBA tracking entries.
 *
 * @param {object[]} bestProps
 * @param {{ now?: number }} options
 * @returns {{ ok: boolean, path: string, added: number, totalMlbBest: number }}
 */
function recordMlbBestProps(bestProps, options = {}) {
  const now = Number.isFinite(options?.now) ? Number(options.now) : Date.now()
  const slateDate = dateKeyFromNow(now)
  const timestamp = new Date(now).toISOString()

  const runtimeDir = path.join(__dirname, "..", "..", "runtime", "tracking")
  ensureDirSync(runtimeDir)
  const filePath = path.join(runtimeDir, `tracked_props_${slateDate}.json`)

  const existing = safeReadJson(filePath)
  const payload = existing && typeof existing === "object"
    ? existing
    : {
        metadata: {
          slateDate,
          generatedAt: timestamp,
          version: "tracking-phase-4-mlb"
        },
        allTrackedProps: []
      }

  if (!payload.metadata || typeof payload.metadata !== "object") {
    payload.metadata = { slateDate, generatedAt: timestamp, version: "tracking-phase-4-mlb" }
  }
  payload.metadata.slateDate = payload.metadata.slateDate || slateDate
  payload.metadata.generatedAt = timestamp
  payload.metadata.version = payload.metadata.version || "tracking-phase-4-mlb"

  if (!Array.isArray(payload.allTrackedProps)) payload.allTrackedProps = []

  const incoming = Array.isArray(bestProps) ? bestProps : []
  const existingMlbBest = payload.allTrackedProps.filter((e) => e?.sport === "mlb" && e?.bucket === "mlb.bestAvailable.best")

  const seen = new Set(existingMlbBest.map((e) => legKey(e)))
  let added = 0

  for (const row of incoming) {
    const key = legKey(row)
    if (!key || key === "|||||") continue
    if (seen.has(key)) continue
    seen.add(key)
    payload.allTrackedProps.push(toTrackedMlbBestEntry(row, { slateDate, timestamp }))
    added += 1
  }

  const ok = safeWriteJson(filePath, payload)
  const totalMlbBestAfter = payload.allTrackedProps.filter((e) => e?.sport === "mlb" && e?.bucket === "mlb.bestAvailable.best").length
  return { ok, path: filePath, added, totalMlbBest: totalMlbBestAfter }
}

/**
 * Evaluate MLB tracked performance (Phase 4).
 * Reads backend/runtime/tracking/tracked_props_<date>.json.
 *
 * @param {{ date?: string, now?: number }} options
 * @returns {{
 *   ok: boolean,
 *   date: string,
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

  const runtimeDir = path.join(__dirname, "..", "..", "runtime", "tracking")
  const filePath = path.join(runtimeDir, `tracked_props_${date}.json`)
  const payload = safeReadJson(filePath)
  const rows = Array.isArray(payload?.allTrackedProps) ? payload.allTrackedProps : []
  const mlb = rows.filter((e) => e?.sport === "mlb" && e?.bucket === "mlb.bestAvailable.best")

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
    totalBets,
    wins,
    losses,
    hitRate,
    avgOdds,
    avgEdge
  }
}

module.exports = {
  recordMlbBestProps,
  evaluateMlbPerformance
}

