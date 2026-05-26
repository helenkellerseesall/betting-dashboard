#!/usr/bin/env node
"use strict"

/**
 * traceWilliamsThrees — read-only inspector for a single suspect pick.
 *
 * Loads the live snapshot from disk, finds Jalen Williams threes rows,
 * runs them through _ensureEnriched (which is what the model calls), and
 * prints exactly what the scorer sees: opp-allowed signals, L5/L10,
 * form-contradiction status, and the final family-specific oppZ.
 *
 * No HTTP. No mutations. Just a print.
 */

const path = require("path")
const fs = require("fs")

const snapPath = path.join(__dirname, "..", "snapshot.json")
const wrap = JSON.parse(fs.readFileSync(snapPath, "utf8"))
const snap = wrap.data || wrap
const rawProps = Array.isArray(snap.rawProps) ? snap.rawProps : []

// Find Williams threes rows
const matches = rawProps.filter((r) => {
  const player = String(r?.player || "").toLowerCase()
  const propT  = String(r?.propType || r?.marketKey || "").toLowerCase()
  return player.includes("jalen williams") && (propT.includes("threes") || propT.includes("three") || propT.includes("3pt"))
})

console.log(`Found ${matches.length} Williams threes rows in snapshot.\n`)

if (!matches.length) {
  console.log("no rows — exit")
  process.exit(0)
}

// Pull the modeling stack
const { enrichRowWithTeamStats } = require("../pipeline/nba/nbaTeamStatsCache")
const { enrichRowWithRecentForm } = require("../pipeline/nba/nbaRecentFormCache")
const { enrichRowWithPlayerSeasonStats } = require("../pipeline/nba/nbaPlayerSeasonStatsCache")
const { nbaRowModelProbability, nbaRowEdge } = require("../pipeline/nba/nbaModelSignals")
const { classifyNbaTier } = require("../pipeline/nba/nbaTierClassifier")

// Pick the OVER 1.5 specifically (or any if not found)
const target =
  matches.find((r) => String(r.side).toLowerCase() === "over" && Number(r.line) === 1.5) ||
  matches[0]

// Clone so we don't mutate snapshot
const row = JSON.parse(JSON.stringify(target))
row.statFamily = "threes"  // make sure family is stamped

console.log("=== RAW SNAPSHOT ROW ===")
console.log(JSON.stringify({
  player: row.player,
  team: row.team,
  opponent: row.opponent || row.opponentTeam,
  matchup: row.matchup,
  propType: row.propType,
  marketKey: row.marketKey,
  line: row.line,
  side: row.side,
  odds: row.odds,
  book: row.book,
}, null, 2))

console.log("\n=== ENRICHMENT STEPS ===")
enrichRowWithTeamStats(row)
console.log("after teamStats — row.opponentStats =", JSON.stringify(row.opponentStats, null, 2))
console.log("  row.oppDef =", row.oppDef, "  row.pace =", row.pace)

enrichRowWithRecentForm(row)
console.log("after recentForm — row.recentForm =", JSON.stringify(row.recentForm, null, 2))
console.log("  row.last5Avg =", row.last5Avg, "  row.last10Avg =", row.last10Avg)

enrichRowWithPlayerSeasonStats(row)
console.log("after seasonStats — row.usage =", row.usage, "row.shots =", row.shots,
            "row.rebRate =", row.rebRate, "row.astRate =", row.astRate)

console.log("\n=== MODEL OUTPUT ===")
const prob = nbaRowModelProbability(row)
console.log("modelProb =", prob)
const edge = nbaRowEdge({ ...row, probability: prob, odds: row.odds })
console.log("edge =", edge)

console.log("\n=== TIER ===")
const tier = classifyNbaTier({
  edge,
  modelProb: prob,
  side: row.side,
  line: row.line,
  l5Avg: row.recentForm?.last5_avg ?? row.last5Avg,
  projMostLikely: Number(row?.range?.mostLikely) ?? Number(row?.projection?.mostLikely) ?? null,
})
console.log("classified tier =", tier)

console.log("\n=== INTERPRETATION ===")
console.log("If tier=ELITE despite L5=0.5 < line=1.5, the form-contradiction gate did NOT fire.")
console.log("Check: l5Avg passed to classifyNbaTier:", row.recentForm?.last5_avg ?? row.last5Avg)
console.log("Check: opp threePMAllowed:", row.opponentStats?.threePMAllowed)
console.log("If threePMAllowed is high (>13), new family-specific oppZ is boosting the OVER.")
