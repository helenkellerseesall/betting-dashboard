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

function normLc(v) {
  return norm(v).toLowerCase()
}

function toNumOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function inc(map, key, by = 1) {
  const k = norm(key || "unknown") || "unknown"
  map[k] = (map[k] || 0) + by
}

function americanToDecimal(odds) {
  const o = toNumOrNull(odds)
  if (o == null || o === 0) return null
  if (o > 0) return 1 + o / 100
  return 1 + 100 / Math.abs(o)
}

function isHrRow(r) {
  const pt = normLc(r?.propType)
  const mk = normLc(r?.marketKey)
  return pt.includes("home run") || pt.includes("homerun") || mk.includes("home_run") || mk.includes("to_hit_home_run")
}

async function ensureRuntimeDir() {
  await fs.mkdir(RUNTIME_DIR, { recursive: true })
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function pickRowsFromTrackedOrGraded(json) {
  if (!json || typeof json !== "object") return []
  if (Array.isArray(json.gradedProps)) return json.gradedProps
  if (Array.isArray(json.allTrackedProps)) return json.allTrackedProps
  return []
}

function buildHrSummary(rows) {
  const hrRows = rows.filter(isHrRow)
  if (!hrRows.length) return null

  const winningHr = hrRows.filter((r) => String(r?.status) === "settled" && String(r?.result) === "win")
  const settledHr = hrRows.filter((r) => String(r?.status) === "settled")
  const recommendedHr = hrRows.filter((r) => r?.recommended === true)

  const bestWinningSingles = winningHr
    .map((r) => ({
      player: r?.player ?? null,
      team: r?.team ?? null,
      book: r?.book ?? null,
      odds: r?.odds ?? null,
      eventId: r?.eventId ?? null
    }))
    .slice(0, 8)

  const combos = []
  const winRows = winningHr.slice(0, 40) // keep bounded
  for (let i = 0; i < winRows.length; i++) {
    for (let j = i + 1; j < winRows.length; j++) {
      const a = winRows[i]
      const b = winRows[j]
      const decA = americanToDecimal(a?.odds)
      const decB = americanToDecimal(b?.odds)
      if (decA == null || decB == null) continue
      const combined = decA * decB
      combos.push({
        combinedDecimal: Number(combined.toFixed(4)),
        legs: [
          { player: a?.player ?? null, team: a?.team ?? null, book: a?.book ?? null, odds: a?.odds ?? null },
          { player: b?.player ?? null, team: b?.team ?? null, book: b?.book ?? null, odds: b?.odds ?? null }
        ]
      })
    }
  }

  combos.sort((x, y) => (y.combinedDecimal || 0) - (x.combinedDecimal || 0))

  return {
    trackedHRCount: hrRows.length,
    recommendedHRCount: recommendedHr.length,
    settledHRCount: settledHr.length,
    winningHRCount: winningHr.length,
    bestWinningSingles,
    bestWinningPairs: combos.slice(0, 12)
  }
}

async function buildTrackedSlateSummary({ date }) {
  const slateDate = toDateKey(date)
  await ensureRuntimeDir()

  const trackedPath = path.join(RUNTIME_DIR, `tracked_props_${slateDate}.json`)
  const gradedPath = path.join(RUNTIME_DIR, `graded_props_${slateDate}.json`)
  const summaryPath = path.join(RUNTIME_DIR, `tracking_summary_${slateDate}.json`)

  const graded = await readJsonIfExists(gradedPath)
  const tracked = graded ? null : await readJsonIfExists(trackedPath)

  const rows = pickRowsFromTrackedOrGraded(graded || tracked)

  const bySport = {}
  const byPropType = {}
  const byBook = {}
  const byBoardOrBucket = {}

  let totalRecommended = 0
  let settledCount = 0
  let unsettledCount = 0
  let wins = 0
  let losses = 0
  let pushes = 0
  let voids = 0

  const recommendedRows = []
  const allRows = Array.isArray(rows) ? rows : []
  for (const r of allRows) {
    inc(bySport, r?.sport || "unknown")
    inc(byPropType, r?.propType || "unknown")
    inc(byBook, r?.book || "unknown")

    const surfaced = Array.isArray(r?.surfacedIn) ? r.surfacedIn : []
    const bucket = norm(r?.bucket) || (surfaced.length ? surfaced[0] : "unknown")
    inc(byBoardOrBucket, bucket || "unknown")

    const recommended = r?.recommended === true
    if (recommended) {
      totalRecommended += 1
      recommendedRows.push(r)
    }

    const status = String(r?.status || "unknown")
    const result = String(r?.result || "unknown")
    if (status === "settled") {
      settledCount += 1
      if (result === "win") wins += 1
      else if (result === "loss") losses += 1
      else if (result === "push") pushes += 1
      else if (result === "void") voids += 1
    } else {
      unsettledCount += 1
    }
  }

  const hrSummary = buildHrSummary(allRows)

  const summary = {
    date: slateDate,
    totalTracked: allRows.length,
    totalRecommended,
    settledCount,
    unsettledCount,
    wins,
    losses,
    pushes,
    voids,
    bySport,
    byPropType,
    byBook,
    byBoardOrBucket,
    recommendedVsAll: {
      recommendedCount: totalRecommended,
      allCount: allRows.length
    },
    hrSummary: hrSummary || undefined
  }

  const payload = {
    metadata: {
      date: slateDate,
      generatedAt: new Date().toISOString(),
      source: graded ? "graded" : tracked ? "tracked" : "missing",
      trackedPath,
      gradedPath,
      version: "tracking-phase-1"
    },
    summary
  }

  await fs.writeFile(summaryPath, JSON.stringify(payload, null, 2), "utf8")
  return { ok: true, path: summaryPath, payload }
}

module.exports = { buildTrackedSlateSummary }

