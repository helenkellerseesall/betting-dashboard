#!/usr/bin/env node
"use strict"

/**
 * traceMyBets.js
 *
 * For every placed bet in personal_ledger.json (decisionType="placed" OR
 * realMoney=true):
 *   1. Pull live/final per-player stats from ESPN box scores
 *   2. Compare each leg's actual vs line/side → verdict (HIT/MISS/PENDING)
 *   3. Look up the pre-game tracked_best entry to surface WHICH signals fired
 *      and which were most wrong (this is the start of the learning loop)
 *   4. Print an operator-friendly summary to stdout (lands in .scratch/last.txt)
 *   5. Append a structured entry to backend/runtime/operator/lessons.json so
 *      losses accumulate over time and can inform calibration
 *
 * Built 2026-05-31 in response to Game 7 placed bets — operator's literal ask:
 *   "i need to see verifiable proof that we are learning from this on a daily basis"
 *
 * Usage:
 *   node backend/scripts/traceMyBets.js              # all placed bets
 *   node backend/scripts/traceMyBets.js --id=ID...   # single bet
 *   node backend/scripts/traceMyBets.js --date=YYYY-MM-DD
 */

const fs   = require("fs")
const path = require("path")

const REPO = path.join(__dirname, "..", "..")
const LEDGER = path.join(REPO, "backend", "runtime", "tracking", "personal_ledger.json")
const TRACKING = path.join(REPO, "backend", "runtime", "tracking")
const LESSONS  = path.join(REPO, "backend", "runtime", "operator", "lessons.json")

const { fetchNbaGameResults, getNbaStatValue, normName } = require(
  path.join(REPO, "backend", "pipeline", "grading", "fetchNbaGameResults.js")
)

// ── helpers ───────────────────────────────────────────────────────────────

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return fallback }
}
function _round(n, p = 1) {
  if (n == null || !isFinite(n)) return null
  const m = Math.pow(10, p)
  return Math.round(Number(n) * m) / m
}
function _argVal(name) {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : null
}

/**
 * Given a leg with side/line and the actual stat value, compute verdict.
 *   returns { verdict, diff }  where verdict ∈ {HIT, MISS, PUSH, PENDING}
 *   diff is signed: positive = actual exceeded line, negative = fell short
 */
function verdictForLeg(leg, actual) {
  if (actual == null) return { verdict: "PENDING", diff: null }
  const line = Number(leg.line)
  const side = String(leg.side || "").toLowerCase()
  const diff = actual - line
  if (actual === line) return { verdict: "PUSH", diff: 0 }
  if (side === "over" || side === "yes") {
    return { verdict: actual > line ? "HIT" : "MISS", diff }
  }
  if (side === "under" || side === "no") {
    return { verdict: actual < line ? "HIT" : "MISS", diff }
  }
  return { verdict: "PENDING", diff: null }
}

/**
 * Find the tracked_best entry that matched this leg pre-game. Used to surface
 * what the model SAW when it picked this prop — so we can name the most-wrong
 * signal post-game.
 */
function findPreGameEntry(sport, date, leg) {
  const file = path.join(TRACKING, `${sport}_tracked_best_${date}.json`)
  const blob = readJsonSafe(file, null)
  if (!blob?.entries) return null
  const ln = (v) => String(v || "").toLowerCase()
  for (const e of blob.entries) {
    if (ln(e.player) !== ln(leg.player)) continue
    if (ln(e.side) !== ln(leg.side)) continue
    if (Number(e.line) !== Number(leg.line)) continue
    return e
  }
  return null
}

/**
 * Name the signal that was most wrong given a missed leg + the pre-game entry.
 * Returns a short string for the lessons file + operator summary.
 */
function diagnoseMissedSignal(leg, actual, preGame) {
  if (!preGame) return "(no pre-game entry found to compare against)"
  const recent = preGame.recentForm || {}
  const role   = preGame.roleContext || {}
  const reasons = []

  // L5 vs actual gap
  if (recent.last5_avg != null) {
    const l5gap = Math.abs(actual - recent.last5_avg)
    if (l5gap >= 3) reasons.push(`L5 avg was ${_round(recent.last5_avg)} but actual was ${actual} (gap ${_round(l5gap)})`)
  }

  // Minutes projection
  if (role.minutes_avg_recent != null) {
    reasons.push(`Model projected ~${_round(role.minutes_avg_recent)} min (trend: ${role.minutes_trend || "stable"})`)
  }
  if (role.role_change && role.role_change !== "stable") {
    reasons.push(`role flagged as ${role.role_change}`)
  }
  if (preGame.displayBundle?.tags?.includes("MINS ↓") || preGame.displayBundle?.tags?.includes("MINS ↓")) {
    reasons.push(`displayBundle tag MINS ↓ — model expected reduced minutes; check if game context (elimination/closeout/blowout) made the trend irrelevant`)
  }

  // Opponent stats blind spot
  const oppStats = preGame.opponentStats || {}
  const allNull = Object.values(oppStats).every((v) => v == null)
  if (allNull) reasons.push("opponentStats were ALL null pre-game — model had no opp matchup signal")

  if (!reasons.length) reasons.push("no obvious single-signal failure — model was just wrong on this one")
  return reasons.join(" · ")
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  const ledger = readJsonSafe(LEDGER, { bets: [] })
  const all = ledger.bets || []
  const placed = all.filter((b) => b.decisionType === "placed" || b.realMoney === true)

  const filterId   = _argVal("id")
  const filterDate = _argVal("date")
  const targets = placed.filter((b) => {
    if (filterId && b.id !== filterId) return false
    if (filterDate && b.date !== filterDate) return false
    return true
  })

  console.log(`=== traceMyBets — ${new Date().toISOString()} ===`)
  console.log(`personal_ledger.json: ${all.length} total bets · ${placed.length} placed · ${targets.length} matching this run\n`)
  if (!targets.length) {
    console.log("No placed bets to trace. Place one via backend/scripts/addPlacedBet.js first.")
    return
  }

  // Group by (sport, date) so we fetch each ESPN slate once
  const slates = new Map() // key=`${sport}|${date}` → resultMap
  for (const b of targets) {
    const key = `${b.sport}|${b.date}`
    if (!slates.has(key)) slates.set(key, null)
  }
  for (const key of slates.keys()) {
    const [sport, date] = key.split("|")
    if (sport === "nba") {
      console.log(`Fetching NBA box scores for ${date}…`)
      const m = await fetchNbaGameResults(date)
      slates.set(key, m)
      console.log(`  → ${m.size} players resolved\n`)
    } else {
      console.log(`Sport ${sport} not yet supported by traceMyBets — skipping ${date}\n`)
      slates.set(key, new Map())
    }
  }

  const lessons = readJsonSafe(LESSONS, { generatedAt: null, entries: [] })

  for (const bet of targets) {
    const slateKey = `${bet.sport}|${bet.date}`
    const resultMap = slates.get(slateKey) || new Map()
    console.log(`──────────────────────────────────────────────────────────────`)
    console.log(`Bet: ${bet.id}`)
    console.log(`  ${bet.sport.toUpperCase()} ${bet.betType} · ${bet.sportsbook} · $${bet.stake} @ ${bet.odds > 0 ? "+" + bet.odds : bet.odds}`)
    console.log(`  Matchup: ${bet.matchup || (bet.legs && bet.legs[0]?.matchup) || "?"}`)

    let hits = 0, misses = 0, pending = 0
    const legSummaries = []
    for (const leg of (bet.legs || [])) {
      const actual = bet.sport === "nba"
        ? getNbaStatValue(resultMap.get(normName(leg.player)), leg.statFamily)
        : null
      const { verdict, diff } = verdictForLeg(leg, actual)
      if (verdict === "HIT") hits++
      else if (verdict === "MISS") misses++
      else pending++

      const sideLabel = String(leg.side || "").toUpperCase()
      const verdictColor = verdict === "HIT" ? "✓" : verdict === "MISS" ? "✗" : verdict === "PUSH" ? "=" : "·"
      console.log(`  ${verdictColor} ${leg.player} ${leg.statFamily} ${sideLabel} ${leg.line} → actual ${actual ?? "—"} (${verdict}${diff != null ? ` ${diff > 0 ? "+" : ""}${_round(diff, 1)}` : ""})`)

      const preGame = findPreGameEntry(bet.sport, bet.date, leg)
      const diagnosis = verdict === "MISS" ? diagnoseMissedSignal(leg, actual, preGame) : null
      if (diagnosis) console.log(`      WHY: ${diagnosis}`)

      legSummaries.push({
        player: leg.player, statFamily: leg.statFamily, side: leg.side, line: leg.line,
        actual, verdict, diff,
        preGame: preGame ? {
          modelProb: preGame.predictedProbability,
          edge: preGame.edgeProbability,
          tier: preGame.tier,
          l5: preGame.recentForm?.last5_avg,
          baseline: preGame.recentForm?.baseline,
          minutesAvg: preGame.roleContext?.minutes_avg_recent,
          minutesTrend: preGame.roleContext?.minutes_trend,
          tags: preGame.displayBundle?.tags || null,
          opponentStats: preGame.opponentStats || null,
        } : null,
        diagnosis,
      })
    }

    // Parlay outcome: any MISS = whole parlay LOSS once settled
    const overallVerdict = misses > 0 ? "LOST" : (pending > 0 ? "PENDING" : "WON")
    console.log(`  PARLAY: ${overallVerdict} (${hits}H · ${misses}M${pending ? ` · ${pending}P` : ""})`)

    // Persist a lesson entry — for losses, this is the calibration signal.
    const lessonEntry = {
      betId: bet.id,
      tracedAt: new Date().toISOString(),
      sport: bet.sport, date: bet.date,
      sportsbook: bet.sportsbook, betType: bet.betType,
      stake: bet.stake, odds: bet.odds,
      overallVerdict,
      hits, misses, pending,
      legs: legSummaries,
    }
    // Replace any prior lesson for the same betId so we always have the latest trace
    lessons.entries = (lessons.entries || []).filter((e) => e.betId !== bet.id)
    lessons.entries.push(lessonEntry)
  }

  lessons.generatedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(LESSONS), { recursive: true })
  fs.writeFileSync(LESSONS, JSON.stringify(lessons, null, 2))
  console.log(`\n=== lessons.json updated — ${lessons.entries.length} total entries ===`)
  console.log(`    Path: ${LESSONS}`)
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
