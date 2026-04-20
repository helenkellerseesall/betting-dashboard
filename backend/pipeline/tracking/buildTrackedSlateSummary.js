"use strict"

const fs = require("fs/promises")
const path = require("path")

const {
  isHomeRunProp,
  isSpecial,
  classifyPropCategory,
  build2LegCombos
} = require("./buildTrackedCombos")

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

async function ensureRuntimeDir(runtimeTrackingDir) {
  await fs.mkdir(runtimeTrackingDir, { recursive: true })
}

async function readJsonIfExists(p) {
  const fs = require("fs/promises");
  const fsSync = require("fs");

  try {
    if (!fsSync.existsSync(p)) return null;

    const raw = await fs.readFile(p, "utf8");  // IMPORTANT: utf8 encoding
    return JSON.parse(raw);
  } catch (err) {
    console.error("[TRACKING-READ-ERROR]", p, err.message);
    return null;
  }
}

function buildHrSummary(rows) {
  const hrRows = rows.filter(isHomeRunProp)
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

  // Must match saveTrackedSlateSnapshot / gradeTrackedSlateSnapshot / server tracking routes:
  // __dirname is backend/pipeline/tracking → ../../runtime/tracking === backend/runtime/tracking.
  // process.cwd()-based paths break when the server is started with cwd=backend/ (wrong: backend/backend/...).
  const runtimeTrackingDir = path.join(__dirname, "..", "..", "runtime", "tracking")

  const trackedPath = path.join(runtimeTrackingDir, `tracked_props_${slateDate}.json`)
  const gradedPath = path.join(runtimeTrackingDir, `graded_props_${slateDate}.json`)
  const summaryPath = path.join(runtimeTrackingDir, `tracking_summary_${slateDate}.json`)

  await ensureRuntimeDir(runtimeTrackingDir)

  const trackedData = await readJsonIfExists(trackedPath)

  const allTracked = Array.isArray(trackedData?.allTrackedProps)
    ? trackedData.allTrackedProps
    : []

  const recommended = Array.isArray(trackedData?.recommendedProps)
    ? trackedData.recommendedProps
    : []

  const graded = await readJsonIfExists(gradedPath)

  const outcomeRows = Array.isArray(graded?.gradedProps) ? graded.gradedProps : allTracked

  const bySport = {}
  const byPropType = {}
  const byBook = {}
  const byBoardOrBucket = {}

  const totalRecommended = recommended.length
  let settledCount = 0
  let unsettledCount = 0
  let wins = 0
  let losses = 0
  let pushes = 0
  let voids = 0

  for (const r of allTracked) {
    inc(bySport, r?.sport || "unknown")
    inc(byPropType, r?.propType || "unknown")
    inc(byBook, r?.book || "unknown")

    const surfaced = Array.isArray(r?.surfacedIn) ? r.surfacedIn : []
    const bucket = norm(r?.bucket) || (surfaced.length ? surfaced[0] : "unknown")
    inc(byBoardOrBucket, bucket || "unknown")
  }

  for (const r of outcomeRows) {
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

  const hrSummary = buildHrSummary(allTracked)

  const propCategoryBreakdown = { core: 0, ladder: 0, special: 0, hr: 0 }
  for (const r of allTracked) {
    const cat = classifyPropCategory(r)
    if (propCategoryBreakdown[cat] != null) propCategoryBreakdown[cat] += 1
  }

  const winningRows = outcomeRows.filter(
    (r) => String(r?.status) === "settled" && String(r?.result) === "win"
  )
  const allWinningProps = winningRows
  const recommendedWinningProps = winningRows.filter((r) => r?.recommended === true)
  const winningHRProps = winningRows.filter(isHomeRunProp)
  const winningSpecialProps = winningRows.filter(isSpecial)

  const comboSummary = {
    bestOverallPairs: build2LegCombos(allWinningProps, { maxResults: 20, maxInputRows: 50 }),
    bestRecommendedPairs: build2LegCombos(recommendedWinningProps, { maxResults: 20, maxInputRows: 50 }),
    bestHRPairs: build2LegCombos(winningHRProps, { maxResults: 20, maxInputRows: 50 }),
    bestSpecialPairs: build2LegCombos(winningSpecialProps, { maxResults: 20, maxInputRows: 50 })
  }

  const summary = {
    date: slateDate,
    totalTracked: allTracked.length,
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
      allCount: allTracked.length
    },
    hrSummary: hrSummary || undefined,
    propCategoryBreakdown,
    comboSummary
  }

  const payload = {
    metadata: {
      date: slateDate,
      generatedAt: new Date().toISOString(),
      source: graded ? "graded" : trackedData ? "tracked" : "missing",
      trackedPath,
      gradedPath,
      version: "tracking-phase-2"
    },
    summary
  }

  await fs.writeFile(summaryPath, JSON.stringify(payload, null, 2), "utf8")
  return { ok: true, path: summaryPath, payload }
}

module.exports = { buildTrackedSlateSummary }

