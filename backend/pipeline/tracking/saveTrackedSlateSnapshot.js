"use strict"

const fs = require("fs/promises")
const path = require("path")

const RUNTIME_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

function toDateKey(dateLike) {
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike
  return new Date().toISOString().slice(0, 10)
}

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function toNumOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function stableRowKey(row) {
  const ev = norm(row?.eventId ?? row?.__src?.eventId ?? row?.gameId ?? row?.__src?.gameId)
  const player = norm(row?.player)
  const book = norm(row?.book)
  const propType = norm(row?.propType)
  const side = norm(row?.side ?? row?.__src?.side)
  const line = toNumOrNull(row?.line)
  return [ev || "no_event", player || "no_player", book || "no_book", propType || "no_prop", side || "no_side", line == null ? "no_line" : String(line)].join("|")
}

function coerceSport(value, fallback) {
  const s = String(value || "").toLowerCase().trim()
  if (s === "mlb" || s === "nba") return s
  const fb = String(fallback || "").toLowerCase().trim()
  if (fb === "mlb" || fb === "nba") return fb
  return null
}

function trackedRowFromSourceRow({ row, slateDate, sport, source, recommended }) {
  // Preserve what we already have; do not invent values.
  const gameTime = row?.gameTime ?? row?.commence_time ?? row?.__src?.gameTime ?? row?.__src?.commence_time ?? null
  const matchup = row?.matchup ?? row?.matchupLabel ?? row?.__src?.matchup ?? null

  return {
    slateDate: slateDate || null,
    sport: coerceSport(row?.sport, sport),
    eventId: row?.eventId ?? row?.__src?.eventId ?? row?.gameId ?? row?.__src?.gameId ?? null,
    matchup: typeof matchup === "string" ? matchup : null,
    gameTime: gameTime ?? null,
    awayTeam: row?.awayTeam ?? row?.__src?.awayTeam ?? null,
    homeTeam: row?.homeTeam ?? row?.__src?.homeTeam ?? null,
    player: row?.player ?? null,
    team: row?.team ?? null,
    book: row?.book ?? null,
    propType: row?.propType ?? null,
    side: row?.side ?? row?.__src?.side ?? null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,
    openingLine: row?.openingLine ?? null,
    openingOdds: row?.openingOdds ?? null,
    lineMove: row?.lineMove ?? null,
    oddsMove: row?.oddsMove ?? null,
    marketMovementTag: row?.marketMovementTag ?? null,
    predictedProbability: row?.predictedProbability ?? null,
    edgeProbability: row?.edgeProbability ?? null,
    decisionScore: row?.decisionScore ?? null,
    modelScore: row?.modelScore ?? row?.compositeScore ?? row?.score ?? null,
    bucket: row?.bucket ?? row?.lane ?? row?.boardSource ?? source ?? null,
    recommended: Boolean(recommended),
    surfacedIn: source ? [source] : [],
    status: "open",
    result: "pending",
    actualValue: row?.actualValue ?? null
  }
}

function mergeSurfacing(existing, { source, recommended }) {
  if (source) {
    const prev = Array.isArray(existing.surfacedIn) ? existing.surfacedIn : []
    if (!prev.includes(source)) existing.surfacedIn = [...prev, source]
  }
  if (recommended) existing.recommended = true
  return existing
}

async function ensureRuntimeDir() {
  await fs.mkdir(RUNTIME_DIR, { recursive: true })
}

/**
 * Save a tracked slate snapshot to JSON runtime file.
 *
 * Input contract (minimal):
 * - date: YYYY-MM-DD (optional)
 * - collections: [{ sport, source, rows, recommended }]
 *
 * allTrackedProps is the union of all collection rows (deduped) with surfacedIn aggregated.
 * recommendedProps is subset view: recommended === true.
 */
async function saveTrackedSlateSnapshot({ date, collections }) {
  const slateDate = toDateKey(date)
  const generatedAt = new Date().toISOString()

  const safeCollections = Array.isArray(collections) ? collections : []
  const trackedByKey = new Map()

  const diagnostics = {
    slateDate,
    generatedAt,
    collectionsIn: safeCollections.length,
    rowsSeen: 0,
    rowsKeyed: 0,
    deduped: 0
  }

  for (const c of safeCollections) {
    const sport = coerceSport(c?.sport, null)
    const source = norm(c?.source) || null
    const recommended = Boolean(c?.recommended)
    const rows = Array.isArray(c?.rows) ? c.rows : []

    for (const row of rows) {
      diagnostics.rowsSeen += 1
      if (!row || typeof row !== "object") continue
      if (!norm(row?.player)) continue
      if (!norm(row?.propType)) continue

      const k = stableRowKey(row)
      if (!k) continue

      diagnostics.rowsKeyed += 1
      if (!trackedByKey.has(k)) {
        trackedByKey.set(
          k,
          trackedRowFromSourceRow({ row, slateDate, sport, source, recommended })
        )
      } else {
        diagnostics.deduped += 1
        mergeSurfacing(trackedByKey.get(k), { source, recommended })
      }
    }
  }

  const allTrackedProps = [...trackedByKey.values()]
  const recommendedProps = allTrackedProps.filter((r) => r?.recommended === true)

  await ensureRuntimeDir()
  const outPath = path.join(RUNTIME_DIR, `tracked_props_${slateDate}.json`)

  const payload = {
    metadata: {
      slateDate,
      generatedAt,
      version: "tracking-phase-1"
    },
    allTrackedProps,
    recommendedProps,
    diagnostics: {
      ...diagnostics,
      totalTracked: allTrackedProps.length,
      totalRecommended: recommendedProps.length
    }
  }

  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8")
  return { ok: true, path: outPath, metadata: payload.metadata, diagnostics: payload.diagnostics }
}

module.exports = { saveTrackedSlateSnapshot }

