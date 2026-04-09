#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")

const LANE_ORDER = [
  "firstBasket",
  "specials",
  "bestUpside",
  "bestValue",
  "mostLikelyToHit"
]

const SCORE_BANDS = {
  specialtyRankScore: [
    { label: "<0.40", min: Number.NEGATIVE_INFINITY, max: 0.4 },
    { label: "0.40-0.55", min: 0.4, max: 0.55 },
    { label: "0.55-0.70", min: 0.55, max: 0.7 },
    { label: ">=0.70", min: 0.7, max: Number.POSITIVE_INFINITY }
  ],
  lineupContextScore: [
    { label: "<0.20", min: Number.NEGATIVE_INFINITY, max: 0.2 },
    { label: "0.20-0.35", min: 0.2, max: 0.35 },
    { label: "0.35-0.50", min: 0.35, max: 0.5 },
    { label: ">=0.50", min: 0.5, max: Number.POSITIVE_INFINITY }
  ],
  opportunitySpikeScore: [
    { label: "<0.20", min: Number.NEGATIVE_INFINITY, max: 0.2 },
    { label: "0.20-0.35", min: 0.2, max: 0.35 },
    { label: "0.35-0.50", min: 0.35, max: 0.5 },
    { label: ">=0.50", min: 0.5, max: Number.POSITIVE_INFINITY }
  ]
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function readJsonFile(filePath) {
  const absolute = path.resolve(filePath)
  const raw = fs.readFileSync(absolute, "utf8")
  return JSON.parse(raw)
}

function normalizeString(value) {
  return String(value || "").trim().toLowerCase()
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeOutcomeValue(outcomeValue) {
  const raw = String(outcomeValue == null ? "" : outcomeValue).trim().toLowerCase()
  if (raw === "") return "unknown"
  if (raw === "1" || raw === "win" || raw === "w" || raw === "true") return "win"
  if (raw === "0" || raw === "loss" || raw === "l" || raw === "false") return "loss"
  if (raw === "push" || raw === "void" || raw === "half" || raw === "0.5") return "push"
  return "unknown"
}

function classifySpecialtyType(row) {
  const marketKey = normalizeString(row.marketKey)
  const propType = normalizeString(row.propType)
  if (marketKey === "player_first_basket" || propType.includes("first basket")) return "firstBasket"
  if (marketKey === "player_first_team_basket" || propType.includes("first team basket")) return "firstTeamBasket"
  if (marketKey === "player_double_double" || propType.includes("double double")) return "doubleDouble"
  if (marketKey === "player_triple_double" || propType.includes("triple double")) return "tripleDouble"
  const isSpecialText = [marketKey, propType, normalizeString(row.sourceLane), normalizeString(row.mustPlayBetType)]
    .join(" ")
    .includes("special")
  return isSpecialText ? "otherSpecials" : "nonSpecial"
}

function isSpecialLane(lane, row) {
  if (lane === "firstBasket" || lane === "specials") return true
  return classifySpecialtyType(row) !== "nonSpecial"
}

function extractPickRows(inputJson) {
  const source = inputJson && typeof inputJson === "object" && inputJson.bestAvailable
    ? inputJson.bestAvailable
    : inputJson

  if (Array.isArray(source)) {
    return source.map((row) => ({ ...row, lane: normalizeString(row.lane || row.sourceLane || "unknown") || "unknown" }))
  }

  const laneSources = [
    { lane: "firstBasket", rows: source?.firstBasket },
    { lane: "specials", rows: source?.specials },
    { lane: "specials", rows: source?.tonightsPlays?.bestSpecials },
    { lane: "bestUpside", rows: source?.bestUpside },
    { lane: "bestValue", rows: source?.bestValue },
    { lane: "mostLikelyToHit", rows: source?.mostLikelyToHit }
  ]

  const seen = new Set()
  const picks = []

  for (const laneSource of laneSources) {
    const rows = Array.isArray(laneSource.rows) ? laneSource.rows : []
    for (const row of rows) {
      const lineNumber = toNumber(row.line)
      const dedupeKey = [
        normalizeString(row.eventId),
        normalizeString(row.matchup),
        normalizeString(row.player),
        normalizeString(row.propType),
        normalizeString(row.side),
        lineNumber == null ? "" : lineNumber.toFixed(2),
        normalizeString(row.book),
        laneSource.lane
      ].join("|")
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      picks.push({ ...row, lane: laneSource.lane })
    }
  }

  return picks
}

function normalizeOutcomeRows(inputJson) {
  const rows = Array.isArray(inputJson)
    ? inputJson
    : (Array.isArray(inputJson?.outcomes) ? inputJson.outcomes : [])

  return rows
    .map((row) => ({
      eventId: normalizeString(row.eventId),
      matchup: normalizeString(row.matchup),
      player: normalizeString(row.player),
      propType: normalizeString(row.propType),
      side: normalizeString(row.side),
      book: normalizeString(row.book),
      line: toNumber(row.line),
      outcome: normalizeOutcomeValue(row.outcome),
      recordedAt: row.recordedAt || null
    }))
    .filter((row) => row.player && row.propType && row.side)
}

function buildOutcomeIndexes(outcomes) {
  const strict = new Map()
  const relaxed = new Map()

  for (const row of outcomes) {
    const lineKey = row.line == null ? "" : row.line.toFixed(2)
    const strictKey = [row.eventId, row.player, row.propType, row.side, row.book, lineKey].join("|")
    strict.set(strictKey, row)

    const relaxedKey = [row.eventId, row.player, row.propType, row.side, row.book].join("|")
    if (!relaxed.has(relaxedKey)) relaxed.set(relaxedKey, [])
    relaxed.get(relaxedKey).push(row)
  }

  return { strict, relaxed }
}

function matchOutcomeForPick(pick, indexes) {
  const eventId = normalizeString(pick.eventId)
  const player = normalizeString(pick.player)
  const propType = normalizeString(pick.propType)
  const side = normalizeString(pick.side)
  const book = normalizeString(pick.book)
  const line = toNumber(pick.line)
  const lineKey = line == null ? "" : line.toFixed(2)

  const strictKey = [eventId, player, propType, side, book, lineKey].join("|")
  if (indexes.strict.has(strictKey)) return indexes.strict.get(strictKey)

  const relaxedKey = [eventId, player, propType, side, book].join("|")
  const candidates = indexes.relaxed.get(relaxedKey) || []
  if (!candidates.length) return null

  if (line == null) return candidates[0]

  let best = null
  let minDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate.line == null) continue
    const distance = Math.abs(candidate.line - line)
    if (distance < minDistance) {
      minDistance = distance
      best = candidate
    }
  }

  return minDistance <= 0.25 ? best : null
}

function getBandLabel(metricName, value) {
  const numeric = toNumber(value)
  if (numeric == null) return "missing"
  const bands = SCORE_BANDS[metricName] || []
  for (const band of bands) {
    if (numeric >= band.min && numeric < band.max) return band.label
  }
  return "missing"
}

function updateCounter(target, key, outcome) {
  if (!target[key]) {
    target[key] = { picks: 0, matched: 0, win: 0, loss: 0, push: 0, unknown: 0 }
  }
  target[key].picks += 1
  if (outcome == null) return
  target[key].matched += 1
  target[key][outcome] = (target[key][outcome] || 0) + 1
}

function finalizeCounters(counterMap) {
  const entries = Object.entries(counterMap)
  const output = {}
  for (const [key, value] of entries) {
    const winRate = value.matched > 0 ? Number((value.win / value.matched).toFixed(3)) : null
    output[key] = { ...value, winRate }
  }
  return output
}

function evaluatePicks(picks, outcomes) {
  const indexes = buildOutcomeIndexes(outcomes)
  const perLane = {}
  const perSpecialtyType = {}
  const byConfidenceTier = {}
  const bySpecialtyRankBand = {}
  const byLineupContextBand = {}
  const byOpportunityBand = {}

  let matchedCount = 0
  let unmatchedCount = 0

  for (const pick of picks) {
    const matchedOutcomeRow = matchOutcomeForPick(pick, indexes)
    const outcome = matchedOutcomeRow ? matchedOutcomeRow.outcome : null

    if (matchedOutcomeRow) matchedCount += 1
    else unmatchedCount += 1

    const lane = pick.lane || "unknown"
    const specialtyType = classifySpecialtyType(pick)
    const confidenceTier = String(pick.confidenceTier || "unknown").trim() || "unknown"

    updateCounter(perLane, lane, outcome)
    updateCounter(perSpecialtyType, specialtyType, outcome)
    updateCounter(byConfidenceTier, confidenceTier, outcome)

    updateCounter(bySpecialtyRankBand, getBandLabel("specialtyRankScore", pick.specialtyRankScore), outcome)
    updateCounter(byLineupContextBand, getBandLabel("lineupContextScore", pick.lineupContextScore), outcome)
    updateCounter(byOpportunityBand, getBandLabel("opportunitySpikeScore", pick.opportunitySpikeScore), outcome)
  }

  const lanes = finalizeCounters(perLane)
  const laneOutput = {}
  for (const lane of LANE_ORDER) {
    if (lanes[lane]) laneOutput[lane] = lanes[lane]
  }
  for (const lane of Object.keys(lanes)) {
    if (!laneOutput[lane]) laneOutput[lane] = lanes[lane]
  }

  return {
    totals: {
      picks: picks.length,
      matched: matchedCount,
      unmatched: unmatchedCount
    },
    perLane: laneOutput,
    perSpecialtyType: finalizeCounters(perSpecialtyType),
    byConfidenceTier: finalizeCounters(byConfidenceTier),
    bySpecialtyRankBand: finalizeCounters(bySpecialtyRankBand),
    byLineupContextBand: finalizeCounters(byLineupContextBand),
    byOpportunitySpikeBand: finalizeCounters(byOpportunityBand)
  }
}

function printSummary(report) {
  console.log("\n=== Offline Pick Evaluation ===")
  console.log(`Total picks: ${report.totals.picks}`)
  console.log(`Matched outcomes: ${report.totals.matched}`)
  console.log(`Unmatched outcomes: ${report.totals.unmatched}`)

  const printSection = (title, section) => {
    console.log(`\n${title}`)
    console.log("-".repeat(title.length))
    for (const [key, value] of Object.entries(section)) {
      const winRateText = value.winRate == null ? "n/a" : `${(value.winRate * 100).toFixed(1)}%`
      console.log(
        `${key}: picks=${value.picks}, matched=${value.matched}, win=${value.win}, loss=${value.loss}, push=${value.push}, winRate=${winRateText}`
      )
    }
  }

  printSection("Per Lane", report.perLane)
  printSection("Per Specialty Type", report.perSpecialtyType)
  printSection("By Confidence Tier", report.byConfidenceTier)
  printSection("By specialtyRankScore Band", report.bySpecialtyRankBand)
  printSection("By lineupContextScore Band", report.byLineupContextBand)
  printSection("By opportunitySpikeScore Band", report.byOpportunitySpikeBand)
}

function runCli() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.picks || !args.outcomes) {
    console.log("Usage: node backend/offline/evaluateEmittedPicks.js --picks <picks.json> --outcomes <outcomes.json> [--output <report.json>]")
    process.exit(args.help ? 0 : 1)
  }

  const picksJson = readJsonFile(args.picks)
  const outcomesJson = readJsonFile(args.outcomes)
  const picks = extractPickRows(picksJson)
  const outcomes = normalizeOutcomeRows(outcomesJson)
  const report = evaluatePicks(picks, outcomes)

  printSummary(report)

  if (args.output) {
    const outputPath = path.resolve(args.output)
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8")
    console.log(`\nSaved report: ${outputPath}`)
  }
}

if (require.main === module) {
  runCli()
}

module.exports = {
  extractPickRows,
  normalizeOutcomeRows,
  evaluatePicks,
  classifySpecialtyType,
  getBandLabel
}
