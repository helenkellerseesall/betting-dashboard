#!/usr/bin/env node
"use strict"

/**
 * inspectNbaPick — Lane 5 (NBA Player Points) decomposition tool.
 *
 * Given a (player, family, side, line) tuple — or a list of them — this
 * script reproduces the NBA modelProb pipeline and dumps every intermediate
 * value so we can identify what's driving the +13.4pp overconfidence found
 * in the lane scorecard (362 decided bets, model 48.5% vs actual 35.1%).
 *
 * Per lanes/nba_points_audit.md, the candidate root causes are:
 *   1. matchup adjustment too aggressive (cap ±6pp may be saturating)
 *   2. form weight too small (formZ contribution buried by other signals)
 *   3. market shrinkage masking the form signal
 *   4. recentForm not actually populating into `recent`
 *
 * This script is the diagnostic that distinguishes between them. NO MODEL
 * CODE IS CHANGED. The script is pure observation.
 *
 * Usage:
 *   node backend/scripts/inspectNbaPick.js                 # runs default 5 contradiction cases
 *   node backend/scripts/inspectNbaPick.js --player="James Harden" --family=points --side=under --line=13.5
 *   node backend/scripts/inspectNbaPick.js --date=2026-05-21
 *
 * Output format: per-pick decomposition table.
 */

const fs   = require("fs")
const path = require("path")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")

// ─── load cognition ──────────────────────────────────────────────────────────
const {
  nbaRowImpliedProbability,
  nbaRowIndependentModelProbability,
  nbaIndependentBaseModelProbability,
  nbaRowMatchupContext,
  _diag,
} = require("../pipeline/nba/nbaModelSignals")

const {
  classifyPropFamily,
  lineAnchorByFamily,
  roleSignals,
  contextSignals,
  recentFormSignal,
  honestWeightedScore,
  familyScoreWeights,
  logistic,
  compressAroundMid,
  probabilityBandForFamily,
  ladderSeverity,
} = _diag

// Enrichments (same ones workstationRoutes uses)
const { applyTeamFallbackFromProjections } = require("../pipeline/nba/nbaEventTeamResolve")
const { enrichRowWithRecentForm } = require("../pipeline/nba/nbaRecentFormCache")
const { enrichRowWithRoleContext } = require("../pipeline/nba/nbaRoleContextDeriver")
const {
  buildSlateContextFromSnapshot: buildTeammateSlateContext,
  enrichRowWithTeammateContext,
} = require("../pipeline/nba/nbaTeammateContextDeriver")
const {
  buildSlateMarketContext,
  enrichRowWithMarketContext,
} = require("../pipeline/nba/nbaMarketContextDeriver")
const { enrichRowWithAvailability } = require("../pipeline/nba/nbaAvailabilityCache")

// ─── helpers ────────────────────────────────────────────────────────────────

function readJsonSafe(p, fb = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return fb }
}

function normName(s) {
  return String(s || "").toLowerCase().trim()
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function parseArgs() {
  const args = { picks: [], date: null }
  let single = null
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--date="))   args.date = a.slice(7)
    else if (a.startsWith("--player=")) { single = single || {}; single.player = a.slice(9) }
    else if (a.startsWith("--family=")) { single = single || {}; single.family = a.slice(9) }
    else if (a.startsWith("--side="))   { single = single || {}; single.side = a.slice(7) }
    else if (a.startsWith("--line="))   { single = single || {}; single.line = Number(a.slice(7)) }
  }
  if (single) args.picks.push(single)
  if (args.picks.length === 0) {
    // Default — the 5 contradiction cases identified 2026-05-23
    args.picks = [
      { player: "Jalen Brunson",     family: "points", side: "under", line: 20.5 },
      { player: "Donovan Mitchell",  family: "points", side: "under", line: 21.5 },
      { player: "Dennis Schroder",   family: "points", side: "under", line: 2.5 },
      { player: "Max Strus",         family: "points", side: "over",  line: 13.5 },
      { player: "James Harden",      family: "points", side: "under", line: 13.5 },
    ]
  }
  return args
}

// Load snapshot rows for a date and find the matching row for a pick
function loadSnapshotRows(date) {
  const fname = `nba_snapshot_${date}.json`
  // Snapshot may live at backend/runtime/cache/ or similar — search common paths
  const candidates = [
    path.join(__dirname, "..", "runtime", "cache", fname),
    path.join(__dirname, "..", "runtime", fname),
    path.join(__dirname, "..", "runtime", "tracking", `nba_snapshot_rows_${date}.json`),
  ]
  for (const p of candidates) {
    const data = readJsonSafe(p)
    if (Array.isArray(data) && data.length) return { rows: data, path: p }
    if (data && Array.isArray(data.rows)) return { rows: data.rows, path: p }
  }
  return { rows: [], path: null }
}

// Load tracked_bets to find the cognition-stamped row matching our query
function findTrackedBetRow(date, query) {
  const fname = `nba_tracked_bets_${date}.json`
  const data = readJsonSafe(path.join(TRACKING_DIR, fname))
  const rows = Array.isArray(data) ? data : (data?.bets || [])
  return rows.find((b) =>
    normName(b.player) === normName(query.player) &&
    String(b.statFamily || "").toLowerCase() === String(query.family).toLowerCase() &&
    String(b.side || "").toLowerCase() === String(query.side).toLowerCase() &&
    Number(b.line) === Number(query.line)
  )
}

// ─── core: decompose one pick ───────────────────────────────────────────────

function decompose(row, opts = {}) {
  if (!row) return null
  const out = {}
  out.input = {
    player:     row.player,
    family:     classifyPropFamily(row),
    side:       String(row.side || "").toLowerCase(),
    line:       Number(row.line),
    oddsAmerican: row.oddsAmerican ?? row.odds,
    sportsbook: row.sportsbook,
  }

  // Step 0 — market implied
  out.market = {
    impliedProb: nbaRowImpliedProbability(row),
  }

  // Step 1 — base score signals
  const family = out.input.family
  const anchor = lineAnchorByFamily(family)
  const { usage, shots, astRate, rebRate, minutes, role } = roleSignals(row, family, out.input.line, anchor)
  const { pace, total, spread, blowoutRisk, oppDef } = contextSignals(row)
  const recent = recentFormSignal(row, out.input.line, anchor)

  out.rawSignals = { usage, shots, astRate, rebRate, minutes, role, pace, total, spread, blowoutRisk, oppDef, recent, anchor }

  // Z-scores (replicate the math in nbaIndependentBaseModelProbability)
  const usageZ   = Number.isFinite(usage)   ? (usage - 22) / 9 : null
  const minutesZ = Number.isFinite(minutes) ? (minutes - 30) / 6 : null
  const shotsZ   = Number.isFinite(shots) && Number.isFinite(out.input.line || anchor)
                     ? (shots - (out.input.line || anchor) * 0.5) / Math.max(4, anchor * 0.35) : null
  const astZ     = Number.isFinite(astRate) ? (astRate - 0.18) / 0.08 : null
  const rebZ     = Number.isFinite(rebRate) ? (rebRate - 0.14) / 0.08 : null
  const formBase = Number.isFinite(out.input.line) ? out.input.line : anchor
  const formZ    = Number.isFinite(recent) && Number.isFinite(formBase)
                     ? (recent - formBase) / Math.max(2.5, anchor * 0.28) : null
  const paceZ    = Number.isFinite(pace)    ? (pace - 100) / 8 : null
  const totalZ   = Number.isFinite(total)   ? (total - 224) / 20 : null
  const spreadZ  = Number.isFinite(spread)  ? (5.5 - spread) / 8 : null
  const oppZ     = Number.isFinite(oppDef)  ? -oppDef / 10 : null
  const roleZ    = Number.isFinite(role)    ? (role - 1) / 2 : null

  out.zScores = { usageZ, shotsZ, astZ, rebZ, formZ, minutesZ, paceZ, totalZ, spreadZ, oppZ, roleZ }

  const w = familyScoreWeights(family)
  const rateZ =
    family === "rebounds" ? rebZ :
    family === "assists"  ? astZ :
    family === "pra"      ? (Number.isFinite(astZ) && Number.isFinite(rebZ) ? (astZ + rebZ) / 2
                              : Number.isFinite(astZ) ? astZ
                              : Number.isFinite(rebZ) ? rebZ : null)
    : null

  const ctxBundle = honestWeightedScore([
    [paceZ, 0.45], [totalZ, 0.35], [spreadZ, 0.20], [oppZ, 0.35],
    [Number.isFinite(blowoutRisk) ? -blowoutRisk : null, 0.35],
    [roleZ, 0.15],
  ])
  const ctxZ = ctxBundle.signals_present > 0 ? ctxBundle.score : null

  const primaryBundle = honestWeightedScore([
    [usageZ,   w.usage],
    [shotsZ,   w.shots],
    [rateZ,    w.rate],
    [formZ,    w.form],
    [minutesZ, 0.26],
    [ctxZ,     w.ctx],
  ])
  out.weights = w
  out.bundle = {
    ctxZ,
    ctxSignalsPresent: ctxBundle.signals_present,
    primaryScore: primaryBundle.score,
    primarySignalsPresent: primaryBundle.signals_present,
    primarySignalsTotal: primaryBundle.signals_total,
  }

  // Ladder penalty
  let score = primaryBundle.score
  const ladderZ = ladderSeverity(row, family, anchor)
  let ladderPenalty = 0
  if (ladderZ > 0) {
    const lp = family === "threes" ? 0.36 : family === "pra" ? 0.44 : 0.48
    ladderPenalty = ladderZ * lp
    score -= ladderPenalty
  }
  out.ladder = { severity: ladderZ, penalty: ladderPenalty }

  if (family === "special") score = score * 0.55 - 0.95

  // Side inversion
  const scoreBeforeInv = score
  if (out.input.side === "under") score *= -1
  out.scoreSteps = {
    beforeSideInversion: scoreBeforeInv,
    afterSideInversion: score,
  }

  const p = logistic(score)
  const compressed = compressAroundMid(p, family)
  const band = probabilityBandForFamily(family, row)
  const baseModelProb = Math.max(band.min, Math.min(band.max, compressed))
  out.baseModelProb = {
    logisticOfScore: p,
    afterCompression: compressed,
    band,
    final: baseModelProb,
  }

  // Step 2 — market shrinkage
  const alpha = family === "threes" ? 0.92
              : family === "pra"    ? 0.88
              : family === "points" ? 0.84
              : family === "rebounds" || family === "assists" ? 0.82
              : 0.80
  const impliedProb = out.market.impliedProb
  const compressedToMarket = Number.isFinite(impliedProb)
    ? impliedProb + (baseModelProb - impliedProb) * alpha
    : baseModelProb
  out.marketShrink = {
    alpha,
    pulledFromBase: baseModelProb,
    pulledToward:   impliedProb,
    after:          compressedToMarket,
    netDeltaFromBase: compressedToMarket - baseModelProb,
  }

  // Step 3 — shifts
  const teammateShift     = Number.isFinite(row.teammateRedistShift) ? row.teammateRedistShift : 0
  const marketShift       = Number.isFinite(row.marketShift)         ? row.marketShift         : 0
  const availabilityShift = Number.isFinite(row.availabilityShift)   ? row.availabilityShift   : 0
  let matchupShift = 0
  let matchupContext = nbaRowMatchupContext(row)
  if (matchupContext && Number.isFinite(matchupContext.adj)) {
    matchupShift = out.input.side === "under" ? -matchupContext.adj : matchupContext.adj
  }
  out.shifts = {
    matchupShift,
    matchupContext,                  // {adj, opponent, defensePart, pacePart, totalPart}
    teammateShift,
    marketShift,
    availabilityShift,
    cumulative: matchupShift + teammateShift + marketShift + availabilityShift,
  }

  const withMatchup = compressedToMarket + matchupShift + teammateShift + marketShift + availabilityShift
  const finalProb = Math.max(0, Math.min(1, Math.max(band.min, Math.min(band.max, withMatchup))))
  out.final = {
    afterShifts: withMatchup,
    afterClamp:  finalProb,
    edge:        Number.isFinite(impliedProb) ? finalProb - impliedProb : null,
  }

  // Sanity: stamped values on the row (from tracked_bets if it ran through cognition already)
  out.stampedOnRow = {
    modelProb: row.modelProb,
    edge:      row.edge,
    impliedProb: row.impliedProb,
  }

  return out
}

// ─── presentation ───────────────────────────────────────────────────────────

function pct(n, d = 1) {
  return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"
}
function num(n, d = 3) {
  return Number.isFinite(n) ? Number(n).toFixed(d) : "—"
}

function print(decomp) {
  if (!decomp) {
    console.log("  ⚠  NO ROW FOUND")
    return
  }
  const i = decomp.input
  console.log()
  console.log("═".repeat(72))
  console.log(`PICK: ${i.player} · ${i.side.toUpperCase()} ${i.line} ${i.family} @ ${i.oddsAmerican} (${i.sportsbook || "?"})`)
  console.log("─".repeat(72))

  console.log("MARKET:")
  console.log(`  impliedProb (book):                    ${pct(decomp.market.impliedProb)}`)

  console.log("RAW SIGNALS (from row enrichment):")
  const r = decomp.rawSignals
  console.log(`  usage:   ${num(r.usage, 2)}    shots:    ${num(r.shots, 2)}    astRate: ${num(r.astRate, 3)}`)
  console.log(`  rebRate: ${num(r.rebRate, 3)}    minutes:  ${num(r.minutes, 2)}    role:    ${num(r.role, 2)}`)
  console.log(`  pace:    ${num(r.pace, 2)}    total:    ${num(r.total, 2)}    spread:  ${num(r.spread, 2)}`)
  console.log(`  oppDef:  ${num(r.oppDef, 2)}    blowout:  ${num(r.blowoutRisk, 2)}    recent:  ${num(r.recent, 2)}`)
  console.log(`  anchor:  ${num(r.anchor, 2)}    line:     ${num(decomp.input.line, 1)}`)

  console.log("Z-SCORES (normalized signals):")
  const z = decomp.zScores
  console.log(`  usageZ:   ${num(z.usageZ, 3)}    shotsZ:    ${num(z.shotsZ, 3)}    formZ:    ${num(z.formZ, 3)}`)
  console.log(`  minutesZ: ${num(z.minutesZ, 3)}    rebZ:      ${num(z.rebZ, 3)}    astZ:     ${num(z.astZ, 3)}`)
  console.log(`  paceZ:    ${num(z.paceZ, 3)}    totalZ:    ${num(z.totalZ, 3)}    oppZ:     ${num(z.oppZ, 3)}`)

  console.log("WEIGHTS (familyScoreWeights):")
  const w = decomp.weights
  console.log(`  usage=${num(w.usage, 2)}  shots=${num(w.shots, 2)}  rate=${num(w.rate, 2)}  form=${num(w.form, 2)}  ctx=${num(w.ctx, 2)}`)
  console.log(`  → form weight is ${(w.form * 100).toFixed(0)}% of total`)

  console.log("BUNDLE (weighted score):")
  const b = decomp.bundle
  console.log(`  ctxZ rolled:        ${num(b.ctxZ, 3)} (signals_present=${b.ctxSignalsPresent})`)
  console.log(`  primary score:      ${num(b.primaryScore, 3)} (present=${b.primarySignalsPresent}/${b.primarySignalsTotal})`)

  console.log("LADDER + SIDE INVERSION:")
  console.log(`  ladder penalty:     ${num(decomp.ladder.penalty, 3)} (severity=${num(decomp.ladder.severity, 2)})`)
  console.log(`  score pre-invert:   ${num(decomp.scoreSteps.beforeSideInversion, 3)}`)
  console.log(`  score post-invert:  ${num(decomp.scoreSteps.afterSideInversion, 3)} ${decomp.input.side === "under" ? "(side=under → ×−1)" : ""}`)

  console.log("BASE MODEL PROB (after logistic + compress + band):")
  const bm = decomp.baseModelProb
  console.log(`  logistic(score):    ${pct(bm.logisticOfScore)}`)
  console.log(`  after compression:  ${pct(bm.afterCompression)}`)
  console.log(`  band [${num(bm.band.min, 2)}, ${num(bm.band.max, 2)}]`)
  console.log(`  base modelProb:     ${pct(bm.final)}  ← INDEPENDENT MODEL'S RAW PREDICTION`)

  console.log("MARKET SHRINKAGE:")
  const ms = decomp.marketShrink
  console.log(`  alpha:              ${num(ms.alpha, 2)}  (pulls ${(100 * (1 - ms.alpha)).toFixed(0)}% toward market)`)
  console.log(`  from base ${pct(ms.pulledFromBase)} toward market ${pct(ms.pulledToward)}`)
  console.log(`  after shrinkage:    ${pct(ms.after)}  (Δ from base: ${ms.netDeltaFromBase >= 0 ? "+" : ""}${(ms.netDeltaFromBase * 100).toFixed(1)}pp)`)

  console.log("SHIFTS:")
  const s = decomp.shifts
  console.log(`  matchupShift:       ${s.matchupShift >= 0 ? "+" : ""}${(s.matchupShift * 100).toFixed(2)}pp`)
  if (s.matchupContext) {
    console.log(`     opp=${s.matchupContext.opponent}  def=${num(s.matchupContext.defensePart, 4)}  pace=${num(s.matchupContext.pacePart, 4)}  total=${num(s.matchupContext.totalPart, 4)}  side-aware adj=${num(s.matchupContext.sideAware, 4)}`)
  }
  console.log(`  teammateShift:      ${s.teammateShift >= 0 ? "+" : ""}${(s.teammateShift * 100).toFixed(2)}pp`)
  console.log(`  marketShift:        ${s.marketShift >= 0 ? "+" : ""}${(s.marketShift * 100).toFixed(2)}pp`)
  console.log(`  availabilityShift:  ${s.availabilityShift >= 0 ? "+" : ""}${(s.availabilityShift * 100).toFixed(2)}pp`)
  console.log(`  cumulative shift:   ${s.cumulative >= 0 ? "+" : ""}${(s.cumulative * 100).toFixed(2)}pp`)

  console.log("FINAL:")
  const f = decomp.final
  console.log(`  modelProb (final):  ${pct(f.afterClamp)}`)
  console.log(`  edge vs market:     ${f.edge >= 0 ? "+" : ""}${(f.edge * 100).toFixed(1)}pp`)

  console.log("SANITY (stamped on tracked_bets row):")
  const st = decomp.stampedOnRow
  console.log(`  modelProb: ${num(st.modelProb, 4)}    edge: ${num(st.edge, 4)}    implied: ${num(st.impliedProb, 4)}`)
  console.log("═".repeat(72))
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs()
  // Default date: walk back from today looking for tracked_bets files that have these picks
  const today = todayKey()
  const dates = []
  if (opts.date) dates.push(opts.date)
  else {
    // Search last 14 days for matching rows
    for (let i = 0; i < 14; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)
    }
  }

  for (const pick of opts.picks) {
    let foundRow = null
    let foundDate = null
    for (const d of dates) {
      const r = findTrackedBetRow(d, pick)
      if (r) { foundRow = r; foundDate = d; break }
    }
    if (!foundRow) {
      console.log()
      console.log("═".repeat(72))
      console.log(`PICK: ${pick.player} · ${pick.side.toUpperCase()} ${pick.line} ${pick.family}`)
      console.log("  ⚠  NO TRACKED BET ROW FOUND in last 14 days. Skipping.")
      continue
    }
    console.log(`\n[inspectNbaPick] matched row in nba_tracked_bets_${foundDate}.json`)
    print(decompose(foundRow))
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[inspectNbaPick] fatal:", err)
    process.exit(1)
  })
}

module.exports = { decompose, findTrackedBetRow }
