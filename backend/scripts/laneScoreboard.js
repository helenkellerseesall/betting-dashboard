#!/usr/bin/env node
"use strict"

/**
 * laneScoreboard.js — per-prop calibration scorecard
 *
 * Reads every mlb_tracked_bets_*.json + nba_tracked_bets_*.json in a window
 * and produces an honest scorecard PER STAT FAMILY (lane):
 *   - count (total / settled / pending / unresolved)
 *   - avg modelProb        (what the model said)
 *   - avg impliedProb      (what the market said)
 *   - hit rate             (actual rate over settled)
 *   - calibration delta    (modelAvg − hitRate); positive = overconfident
 *   - brier score          (lower = better; baseline ~0.25 for 50/50)
 *   - ROI @ 1u flat stake  (using oddsAmerican)
 *
 * Pure read. No mutations to tracked_bets, no new tables, no new endpoints.
 * Writes one markdown report under `scorecards/lane_scorecard_<today>.md`.
 *
 * Usage:
 *   node backend/scripts/laneScoreboard.js                 # last 30 days, both sports
 *   node backend/scripts/laneScoreboard.js --days=60
 *   node backend/scripts/laneScoreboard.js --sport=mlb
 *   node backend/scripts/laneScoreboard.js --json          # stdout JSON instead of markdown
 *
 * Doctrine: this is a measurement instrument, not a feature. It does not
 * change any model behavior. It only TELLS YOU WHAT THE MODEL IS WORTH on
 * each prop. The lane work that follows depends entirely on these numbers
 * being honest — so the script must never silently smooth, impute, or
 * fabricate. Missing data is reported as missing.
 */

const fs   = require("fs")
const path = require("path")

const TRACKING_DIR  = path.join(__dirname, "..", "runtime", "tracking")
const SCORECARDS_DIR = path.join(__dirname, "..", "..", "scorecards")

// The 7 lanes the operator committed to 2026-05-23. Mapped to the statFamily
// keys the tracked_bets files actually use (lowercase, no spaces).
const LANES = [
  { id: "mlb_home_runs",      label: "MLB — Home Runs",            sport: "mlb", aliases: ["homeruns", "home_runs", "hr"] },
  { id: "nba_threes",         label: "NBA — 3-Pointers Made",      sport: "nba", aliases: ["threes", "three_pointers_made", "3pm", "threespointersmade"] },
  { id: "mlb_pitcher_ks",     label: "MLB — Pitcher Strikeouts",   sport: "mlb", aliases: ["ks", "pitcher_strikeouts", "strikeouts", "pitcherks"] },
  { id: "mlb_batter_hits",    label: "MLB — Batter Hits",          sport: "mlb", aliases: ["hits", "batter_hits"] },
  { id: "nba_points",         label: "NBA — Player Points",        sport: "nba", aliases: ["points", "player_points"] },
  { id: "nba_pra",            label: "NBA — PRA",                  sport: "nba", aliases: ["pra", "player_points_rebounds_assists", "points_rebounds_assists"] },
  { id: "nba_first_basket",   label: "NBA — First Basket",         sport: "nba", aliases: ["firstbasket", "first_basket", "first_team_basket"] },
]

// Also tally these for completeness, even though they're not "lanes."
// Operator can decide whether to elevate any of these later.
const SECONDARY = [
  { id: "mlb_total_bases",    label: "MLB — Total Bases",          sport: "mlb", aliases: ["totalbases", "total_bases"] },
  { id: "mlb_runs",           label: "MLB — Runs Scored",          sport: "mlb", aliases: ["runs", "runs_scored", "batter_runs_scored"] },
  { id: "mlb_rbis",           label: "MLB — RBIs",                 sport: "mlb", aliases: ["rbis", "rbi", "batter_rbis"] },
  { id: "mlb_pitcher_outs",   label: "MLB — Pitcher Outs",         sport: "mlb", aliases: ["outs", "pitcher_outs"] },
  { id: "mlb_pitcher_walks",  label: "MLB — Pitcher Walks",        sport: "mlb", aliases: ["walks", "pitcher_walks"] },
  { id: "mlb_earned_runs",    label: "MLB — Earned Runs",          sport: "mlb", aliases: ["earnedruns", "earned_runs"] },
  { id: "nba_rebounds",       label: "NBA — Rebounds",             sport: "nba", aliases: ["rebounds", "player_rebounds"] },
  { id: "nba_assists",        label: "NBA — Assists",              sport: "nba", aliases: ["assists", "player_assists"] },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const out = { days: 30, sport: null, json: false }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--days="))  out.days = Math.max(1, Number(a.slice(7)) || 30)
    else if (a.startsWith("--sport=")) out.sport = a.slice(8).toLowerCase()
    else if (a === "--json")      out.json = true
  }
  return out
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function readJsonSafe(p, fb = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return fb }
}

function normFamily(s) {
  return String(s || "").toLowerCase().replace(/[\s_\-]+/g, "")
}

function matchLane(family, lane) {
  const f = normFamily(family)
  return lane.aliases.some((a) => normFamily(a) === f)
}

function americanToDecimal(odds) {
  const a = Number(odds)
  if (!Number.isFinite(a) || a === 0) return null
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a)
}

function impliedFromAmerican(odds) {
  const a = Number(odds)
  if (!Number.isFinite(a) || a === 0) return null
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100)
}

function avg(arr) {
  if (!arr.length) return null
  const s = arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  return s / arr.length
}

function pct(n, d = 1) { return n == null ? "—" : `${(n * 100).toFixed(d)}%` }
function num(n, d = 3) { return n == null || !Number.isFinite(n) ? "—" : Number(n).toFixed(d) }

// ─── core computation ───────────────────────────────────────────────────────

function loadAllBetsInWindow(days, sportFilter) {
  if (!fs.existsSync(TRACKING_DIR)) return []
  const files = fs.readdirSync(TRACKING_DIR)
    .filter((f) => /^(mlb|nba)_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f))
  const cutoff = isoDaysAgo(days)
  const out = []
  for (const f of files) {
    const m = f.match(/^(mlb|nba)_tracked_bets_(\d{4}-\d{2}-\d{2})\.json$/)
    if (!m) continue
    const sport = m[1]
    const date = m[2]
    if (sportFilter && sport !== sportFilter) continue
    if (date < cutoff) continue
    const raw = readJsonSafe(path.join(TRACKING_DIR, f), null)
    if (!raw) continue
    const rows = Array.isArray(raw) ? raw : (raw.bets || raw.entries || [])
    for (const b of rows) out.push({ ...b, _sport: sport, _date: date })
  }
  return out
}

function computeLaneCard(lane, bets) {
  const laneBets = bets.filter((b) => b._sport === lane.sport && matchLane(b.statFamily, lane))
  const settled = laneBets.filter((b) => ["win", "loss", "push"].includes(String(b.result || "").toLowerCase()))
  const wins    = settled.filter((b) => String(b.result).toLowerCase() === "win")
  const losses  = settled.filter((b) => String(b.result).toLowerCase() === "loss")
  const pushes  = settled.filter((b) => String(b.result).toLowerCase() === "push")
  const pending = laneBets.filter((b) => String(b.result || "pending").toLowerCase() === "pending")
  const unresolved = laneBets.filter((b) => String(b.result || "").toLowerCase() === "unresolved")

  // Effective settled excludes pushes for hit-rate computation
  const decided = settled.filter((b) => ["win", "loss"].includes(String(b.result).toLowerCase()))

  const modelProbs = laneBets.map((b) => Number(b.modelProb)).filter(Number.isFinite)
  const implied   = laneBets.map((b) => {
    const ip = Number(b.impliedProb)
    return Number.isFinite(ip) ? ip : impliedFromAmerican(b.oddsAmerican)
  }).filter(Number.isFinite)
  const edges     = laneBets.map((b) => Number(b.edge)).filter(Number.isFinite)

  const hitRate = decided.length
    ? wins.length / decided.length
    : null

  // Brier score: mean of (modelProb − outcome)^2 over decided
  let brier = null
  if (decided.length) {
    let sum = 0, n = 0
    for (const b of decided) {
      const p = Number(b.modelProb)
      if (!Number.isFinite(p)) continue
      const o = String(b.result).toLowerCase() === "win" ? 1 : 0
      sum += (p - o) * (p - o)
      n++
    }
    brier = n > 0 ? sum / n : null
  }

  // ROI @ 1u flat — pushes return stake (profit 0).
  let totalStaked = 0, totalProfit = 0, profitCounted = 0
  for (const b of settled) {
    const dec = americanToDecimal(b.oddsAmerican)
    if (!Number.isFinite(dec)) continue
    totalStaked += 1
    const r = String(b.result).toLowerCase()
    if (r === "win")      { totalProfit += dec - 1; profitCounted++ }
    else if (r === "loss") { totalProfit += -1;     profitCounted++ }
    else if (r === "push") { /* 0 */                profitCounted++ }
  }
  const roi = profitCounted > 0 ? totalProfit / profitCounted : null

  const modelAvg   = avg(modelProbs)
  const impliedAvg = avg(implied)
  const edgeAvg    = avg(edges)
  const calibrationDelta = (modelAvg != null && hitRate != null) ? (modelAvg - hitRate) : null

  return {
    laneId:        lane.id,
    label:         lane.label,
    sport:         lane.sport,
    rowCounts: {
      total:        laneBets.length,
      decided:      decided.length,
      settled:      settled.length,
      pushes:       pushes.length,
      pending:      pending.length,
      unresolved:   unresolved.length,
    },
    averages: {
      modelProb:   modelAvg,
      impliedProb: impliedAvg,
      edge:        edgeAvg,
    },
    performance: {
      hitRate,
      calibrationDelta,
      brier,
      roiAt1u: roi,
      wins:    wins.length,
      losses:  losses.length,
    },
    diagnostics: {
      hasData:           laneBets.length > 0,
      hasSettled:        settled.length > 0,
      hasDecided:        decided.length > 0,
      sufficientForCal:  decided.length >= 30,        // Minimum sample for calibration claims
      sufficientForBrier: decided.length >= 50,
    },
  }
}

// ─── rendering ──────────────────────────────────────────────────────────────

function renderMarkdown(cards, secondaryCards, opts) {
  const lines = []
  lines.push(`# Lane Scoreboard — ${todayKey()}`)
  lines.push("")
  lines.push(`Window: last ${opts.days} days` + (opts.sport ? ` · sport=${opts.sport}` : ""))
  lines.push("")
  lines.push("**What this measures.** For each prop the model has surfaced into `tracked_bets`, this scorecard answers: did the model's probability prediction match the actual hit rate?")
  lines.push("")
  lines.push("- **modelAvg**: average model probability across all surfaced rows")
  lines.push("- **hitRate**: actual win rate among decided (settled, non-push) bets")
  lines.push("- **calibrationDelta** = modelAvg − hitRate. Positive = model overconfident. Negative = underconfident. Near zero = calibrated.")
  lines.push("- **Brier**: mean squared error of probability vs outcome. Lower is better. Coin flip ≈ 0.25, perfect ≈ 0.")
  lines.push("- **ROI @ 1u**: hypothetical return on a 1-unit flat stake on every surfaced row. Positive = +EV in practice.")
  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push("## The 7 lanes")
  lines.push("")
  for (const c of cards) lines.push(renderCardMarkdown(c))
  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push("## Secondary props (not committed lanes, tracked for context)")
  lines.push("")
  for (const c of secondaryCards) lines.push(renderCardMarkdown(c))
  lines.push("")
  return lines.join("\n")
}

function renderCardMarkdown(c) {
  const lines = []
  lines.push(`### ${c.label}`)
  if (!c.diagnostics.hasData) {
    lines.push("")
    lines.push("**NO DATA.** The pipeline is not currently writing predictions for this prop into `tracked_bets`. This lane is blocked until the capture path is fixed.")
    lines.push("")
    return lines.join("\n")
  }
  const rc = c.rowCounts
  const av = c.averages
  const pf = c.performance
  lines.push("")
  lines.push(`- Rows: **${rc.total}** total · ${rc.decided} decided · ${rc.pushes} push · ${rc.pending} pending · ${rc.unresolved} unresolved`)
  lines.push(`- Model avg: **${pct(av.modelProb)}** · Implied avg: ${pct(av.impliedProb)} · Edge avg: ${pct(av.edge, 2)}`)
  if (pf.hitRate == null) {
    lines.push(`- **No decided bets yet** — predictions exist but none have been graded. Calibration unknown.`)
  } else {
    const overUnder = pf.calibrationDelta == null ? "—"
                    : pf.calibrationDelta > 0.02 ? `overconfident by ${(pf.calibrationDelta*100).toFixed(1)}pp`
                    : pf.calibrationDelta < -0.02 ? `underconfident by ${(-pf.calibrationDelta*100).toFixed(1)}pp`
                    : "calibrated (within 2pp)"
    lines.push(`- Hit rate: **${pct(pf.hitRate)}** (${pf.wins}W/${pf.losses}L) · Model said ${pct(av.modelProb)} → ${overUnder}`)
    lines.push(`- Brier: ${num(pf.brier, 4)} · ROI @ 1u: **${pf.roiAt1u == null ? "—" : (pf.roiAt1u >= 0 ? "+" : "") + (pf.roiAt1u * 100).toFixed(1) + "%"}**`)
    if (!c.diagnostics.sufficientForCal) {
      lines.push(`- ⚠️  Sample size: ${rc.decided} decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.`)
    }
  }
  lines.push("")
  return lines.join("\n")
}

// ─── main ───────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs()
  const bets = loadAllBetsInWindow(opts.days, opts.sport)

  const lanes = opts.sport ? LANES.filter((l) => l.sport === opts.sport) : LANES
  const secondary = opts.sport ? SECONDARY.filter((l) => l.sport === opts.sport) : SECONDARY

  const cards = lanes.map((l) => computeLaneCard(l, bets))
  const secondaryCards = secondary.map((l) => computeLaneCard(l, bets))

  if (opts.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), windowDays: opts.days, sport: opts.sport, lanes: cards, secondary: secondaryCards }, null, 2))
    return
  }

  const md = renderMarkdown(cards, secondaryCards, opts)
  console.log(md)

  // Persist alongside the scorecards/ directory at repo root
  try {
    if (!fs.existsSync(SCORECARDS_DIR)) fs.mkdirSync(SCORECARDS_DIR, { recursive: true })
    const outPath = path.join(SCORECARDS_DIR, `lane_scorecard_${todayKey()}.md`)
    fs.writeFileSync(outPath, md, "utf8")
    console.error(`\n[laneScoreboard] wrote ${outPath}`)
  } catch (err) {
    console.error(`[laneScoreboard] failed to write scorecard file: ${err.message}`)
  }
}

if (require.main === module) main()
module.exports = { computeLaneCard, loadAllBetsInWindow, LANES, SECONDARY }
