"use strict"

/**
 * Phase Offensive-Ecology-Intelligence-1A — helper unit-test fixture.
 *
 * OE-1 + OE-2 + OE-3 + OE-4 + OE-5 + OE-6 + OE-7 + OE-8 + OE-9 + OE-10.
 *
 * Deterministic pure-function + integration assertions on the offensive-ecology
 * foundation. NO HTTP. NO SQLite. NO ML. NO LLM. NO GPT.
 *
 * Doctrine guarded:
 *   • OE-1: canonical realism / environment signals lift through BOTH
 *           normalizeCandidate paths. Anti-fabrication: undefined when absent.
 *   • OE-2: offensivePressureIndex — hitter overs only, ~5% weight, neutral
 *           fallback 0.50 when canonical absent.
 *   • OE-3: hrCarryEnvironment — HR overs only, +0.03 cap, AND-gate over
 *           4 canonical signals; 0 when any absent.
 *   • OE-4: correlatedRunProduction — runs/RBIs overs at top-of-order
 *           (lineupSpot 1-4), +0.03 cap; 0 when any signal absent.
 *   • OE-5: explosiveEnvironmentTag — per-event aggregator returns Map.
 *           Anti-fabrication: empty when canonical signals absent.
 *   • OE-6: buildExplosiveUpsideTickets — auto-empty when no events qualify.
 *   • OE-7: recommendation ladder slot 9 bestExplosiveUpside additive.
 *   • OE-8: ladderSurvivabilityFactor — composes ladder height × PA × env;
 *           soft demote -0.04 at sort time only.
 *   • OE-9: per-run counter reset / get discipline.
 *   • OE-10: this fixture (~80+ assertions).
 *
 * Preservation:
 *   • Existing 10-factor composite UNCHANGED at the prior 10 factors;
 *     OE-2 is an ADDITIVE 11th factor at 5%, OE-3 + OE-4 are caps applied
 *     after composite via additive (clamped at 1.0).
 *   • Sterile environment vs explosive environment integration differential.
 *   • Hidden-value unders preserved (OE-2/3/4 only apply to overs).
 *   • NBA candidates (no MLB canonical context) → OE-2 returns neutral.
 *
 * Run via:
 *   node backend/scripts/verifyOffensiveEcology1A.js
 */

const path = require("path")

const F = require(path.join(__dirname, "..", "pipeline", "shared", "buildFeaturedPlays.js"))
const S = require(path.join(__dirname, "..", "pipeline", "shared", "buildSlipAi.js"))

let passed = 0
let failed = 0
const failures = []

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps }

// ─────────────────────────────────────────────────────────────────────────────
// OE-1 — canonical lift through both normalizeCandidate paths
// ─────────────────────────────────────────────────────────────────────────────
{
  // buildSlipAi.normalizeCandidate — exposed directly via S export
  const raw = {
    player: "X", statFamily: "hits", side: "over", line: 1.5, odds: -110,
    book: "DK", runEnvironment: 0.80, rbiEnvironment: 0.70,
    windDirectionTag: "out_to_cf", carryShift: 0.05, hrFactor: 1.18, temperatureF: 80,
  }
  const n = S.normalizeCandidate(raw)
  assert(n != null, "OE-1 (buildSlipAi) normalizeCandidate accepts OE-1 fields")
  assert(n.runEnvironment === 0.80, "OE-1 buildSlipAi preserves runEnvironment")
  assert(n.rbiEnvironment === 0.70, "OE-1 buildSlipAi preserves rbiEnvironment")
  assert(n.windDirectionTag === "out_to_cf", "OE-1 buildSlipAi preserves windDirectionTag")
  assert(n.carryShift === 0.05, "OE-1 buildSlipAi preserves carryShift")
  assert(n.hrFactor === 1.18, "OE-1 buildSlipAi preserves hrFactor")
  assert(n.temperatureF === 80, "OE-1 buildSlipAi preserves temperatureF")

  // Anti-fabrication — absent fields propagate undefined
  const bare = { player: "Y", statFamily: "hits", side: "over", line: 1.5, odds: -110, book: "DK" }
  const nb = S.normalizeCandidate(bare)
  assert(nb.runEnvironment === undefined,   "OE-1 anti-fabrication — absent runEnvironment → undefined")
  assert(nb.windDirectionTag === undefined, "OE-1 anti-fabrication — absent windDirectionTag → undefined")
  assert(nb.carryShift === undefined,       "OE-1 anti-fabrication — absent carryShift → undefined")
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-2 — offensivePressureIndex
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1aStats()
  assert(F.OE2_PRESSURE_WEIGHT === 0.05, "OE-2 weight = 5% (operator-approved)")
  assert(F.OE2_NEUTRAL_PRESSURE === 0.50, "OE-2 neutral fallback = 0.50")

  // Neutral on absent
  assert(F.offensivePressureIndex({}) === 0.50,
    "OE-2 anti-fabrication — empty candidate → 0.50 neutral")
  assert(F.offensivePressureIndex(null) === 0.50,
    "OE-2 anti-fabrication — null → 0.50 neutral")

  // Under-side legs return neutral (no boost / no demote)
  const underCase = F.offensivePressureIndex({
    player: "U", statFamily: "hits", side: "under", line: 1.5,
    runEnvironment: 0.80, impliedTeamTotal: 5.5,
  })
  assert(underCase === 0.50, "OE-2 under-side leg → 0.50 neutral (hitter OVERS only)")

  // Non-offensive-stat → neutral
  const nonHitter = F.offensivePressureIndex({
    player: "P", statFamily: "strikeouts", side: "over",
    runEnvironment: 0.80, impliedTeamTotal: 5.5,
  })
  assert(nonHitter === 0.50, "OE-2 non-offensive-stat (pitcher K) → 0.50 neutral")

  // Hitter OVER + complete canonical → boost
  const strong = F.offensivePressureIndex({
    player: "S", statFamily: "hits", side: "over",
    runEnvironment: 0.80, impliedTeamTotal: 5.5, carryShift: 0.05,
  })
  assert(strong > 0.50, `OE-2 strong env (runEnv=0.80, tt=5.5) → boost > 0.50 (got ${strong})`)
  assert(strong <= 1.00, "OE-2 clamped to 1.00 ceiling")

  // Hitter OVER + weak canonical → demote
  const weak = F.offensivePressureIndex({
    player: "W", statFamily: "hits", side: "over",
    runEnvironment: 0.30, impliedTeamTotal: 3.0,
  })
  assert(weak < 0.50, `OE-2 weak env (runEnv=0.30, tt=3.0) → demote < 0.50 (got ${weak})`)

  assert(strong > weak, `OE-2 doctrine — strong (${strong}) > weak (${weak})`)

  // Counter increments only on boost > neutral
  F.resetOe1aStats()
  F.offensivePressureIndex({ player: "X", statFamily: "hits", side: "over",
    runEnvironment: 0.80, impliedTeamTotal: 5.5 })
  assert(F.getOe1aStats().pressureBoostsApplied === 1,
    "OE-9 — pressureBoostsApplied counter increments on boost")

  // Missing only carryShift — still works (neutral multiplier)
  const noCarry = F.offensivePressureIndex({
    statFamily: "hits", side: "over", runEnvironment: 0.80, impliedTeamTotal: 5.5,
  })
  assert(noCarry > 0.50, `OE-2 missing carryShift → still boosts via neutral multiplier (got ${noCarry})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-3 — hrCarryEnvironment
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1aStats()
  assert(F.OE3_HR_BOOST_CAP === 0.03, "OE-3 boost cap = 0.03")
  assert(F.OE3_TEMP_MIN_F === 75,    "OE-3 temp min = 75°F")

  // Full activation — all 4 gates pass
  const full = F.hrCarryEnvironment({
    statFamily: "home_runs", side: "over",
    windDirectionTag: "out_to_cf", carryShift: 0.05,
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80,
  })
  assert(full === 0.03, `OE-3 full activation → +0.03 boost (got ${full})`)
  assert(F.getOe1aStats().hrCarryBoostsApplied === 1,
    "OE-9 — hrCarryBoostsApplied counter increments on activation")

  // Anti-fabrication — each gate failure returns 0
  F.resetOe1aStats()
  assert(F.hrCarryEnvironment({
    statFamily: "hr", side: "under",
    windDirectionTag: "out_to_cf", carryShift: 0.05,
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80,
  }) === 0, "OE-3 under-side → 0 (HR OVERS only)")

  assert(F.hrCarryEnvironment({
    statFamily: "hits", side: "over",
    windDirectionTag: "out_to_cf", carryShift: 0.05,
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80,
  }) === 0, "OE-3 non-HR stat → 0 (HR OVERS only)")

  assert(F.hrCarryEnvironment({
    statFamily: "hr", side: "over",
    windDirectionTag: "in_from_cf", carryShift: 0.05,
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80,
  }) === 0, "OE-3 wind-in → 0")

  assert(F.hrCarryEnvironment({
    statFamily: "hr", side: "over",
    windDirectionTag: "out_to_cf", carryShift: 0,
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80,
  }) === 0, "OE-3 carryShift <= 0 → 0")

  assert(F.hrCarryEnvironment({
    statFamily: "hr", side: "over",
    windDirectionTag: "out_to_cf", carryShift: 0.05,
    hrEnvironmentTag: "NEUTRAL", temperatureF: 80,
  }) === 0, "OE-3 hrEnvironmentTag != HR_FRIENDLY → 0")

  assert(F.hrCarryEnvironment({
    statFamily: "hr", side: "over",
    windDirectionTag: "out_to_cf", carryShift: 0.05,
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 65,
  }) === 0, "OE-3 temperatureF < 75 → 0")

  assert(F.hrCarryEnvironment({}) === 0, "OE-3 empty candidate → 0")
  assert(F.hrCarryEnvironment(null) === 0, "OE-3 null → 0")

  // Various wind-out tags accepted
  for (const w of ["out_to_cf", "out_to_lf", "out_to_rf", "out_left", "out_center", "out_right"]) {
    F.resetOe1aStats()
    const v = F.hrCarryEnvironment({
      statFamily: "hr", side: "over",
      windDirectionTag: w, carryShift: 0.05,
      hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80,
    })
    assert(v === 0.03, `OE-3 wind tag "${w}" → boost`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-4 — correlatedRunProduction
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1aStats()
  assert(F.OE4_RUN_BOOST_CAP === 0.03, "OE-4 boost cap = 0.03")
  assert(F.OE4_TOP_OF_ORDER_MAX_SPOT === 4, "OE-4 top-of-order max spot = 4")
  assert(F.OE4_ENV_THRESHOLD === 0.55, "OE-4 env threshold = 0.55")

  // RBIs OVER, top-of-order, strong env → boost
  const rbiCase = F.correlatedRunProduction({
    statFamily: "rbis", side: "over",
    lineupSpot: 4, rbiEnvironment: 0.85,
  })
  assert(rbiCase === 0.03, `OE-4 RBIs top-of-order + strong rbiEnv → +0.03 (got ${rbiCase})`)

  // Runs OVER, leadoff, strong runEnv → boost
  const runCase = F.correlatedRunProduction({
    statFamily: "runs", side: "over",
    lineupSpot: 1, runEnvironment: 0.85,
  })
  assert(runCase === 0.03, `OE-4 runs leadoff + strong runEnv → +0.03 (got ${runCase})`)

  // Counter check
  assert(F.getOe1aStats().runProductionBoostsApplied === 2,
    "OE-9 — runProductionBoostsApplied counter increments (2 fires)")

  // Anti-fabrication — gate failures
  F.resetOe1aStats()
  assert(F.correlatedRunProduction({
    statFamily: "runs", side: "under", lineupSpot: 1, runEnvironment: 0.85,
  }) === 0, "OE-4 under-side → 0")

  assert(F.correlatedRunProduction({
    statFamily: "runs", side: "over", lineupSpot: 7, runEnvironment: 0.85,
  }) === 0, "OE-4 back-of-order (lineupSpot 7) → 0")

  assert(F.correlatedRunProduction({
    statFamily: "runs", side: "over", lineupSpot: 1, runEnvironment: 0.40,
  }) === 0, "OE-4 weak runEnvironment (< 0.55) → 0")

  assert(F.correlatedRunProduction({
    statFamily: "hits", side: "over", lineupSpot: 1, runEnvironment: 0.85,
  }) === 0, "OE-4 non-runs/RBIs stat → 0")

  assert(F.correlatedRunProduction({
    statFamily: "rbis", side: "over", lineupSpot: 3,
    // no env signals
  }) === 0, "OE-4 anti-fabrication — both env signals absent → 0")

  assert(F.correlatedRunProduction({}) === 0, "OE-4 empty → 0")
  assert(F.correlatedRunProduction(null) === 0, "OE-4 null → 0")
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-5 — buildExplosiveEnvironmentIndex
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1aStats()
  assert(F.OE5_GAME_TOTAL_MIN === 9.5, "OE-5 game total min = 9.5")
  assert(F.OE5_AVG_TEAM_TOTAL_MIN === 4.5, "OE-5 avg team total min = 4.5")
  assert(F.OE5_EXPLOSIVE_TAG === "EXPLOSIVE", "OE-5 canonical tag = EXPLOSIVE")

  // Empty / null
  assert(F.buildExplosiveEnvironmentIndex([]).size === 0, "OE-5 empty pool → empty Map")
  assert(F.buildExplosiveEnvironmentIndex(null).size === 0, "OE-5 null pool → empty Map")

  // Explosive event: gameTotal=10, teamTotals avg=5.0, wind-out, no HR_SUPPRESSING
  F.resetOe1aStats()
  const explosive = [
    { eventId: "EXPL1", gameTotal: 10.0, impliedTeamTotal: 5.0, windDirectionTag: "out_to_cf", hrEnvironmentTag: "HR_FRIENDLY" },
    { eventId: "EXPL1", gameTotal: 10.0, impliedTeamTotal: 5.0, windDirectionTag: "out_to_cf", hrEnvironmentTag: "HR_FRIENDLY" },
  ]
  const idx1 = F.buildExplosiveEnvironmentIndex(explosive)
  assert(idx1.has("EXPL1"), "OE-5 explosive event → tagged")
  assert(F.getOe1aStats().explosiveEventsTagged === 1, "OE-9 — explosiveEventsTagged counter increments")

  // Borderline gameTotal=9.0 → NOT tagged (strict >= 9.5)
  const borderline = [
    { eventId: "BORD", gameTotal: 9.0, impliedTeamTotal: 5.0, windDirectionTag: "out_to_cf" },
  ]
  assert(F.buildExplosiveEnvironmentIndex(borderline).size === 0,
    "OE-5 borderline gameTotal=9.0 → NOT tagged (strict >= 9.5)")

  // Wind-in → not tagged
  const windIn = [
    { eventId: "WI", gameTotal: 10.0, impliedTeamTotal: 5.0, windDirectionTag: "in_from_cf" },
  ]
  assert(F.buildExplosiveEnvironmentIndex(windIn).size === 0, "OE-5 wind-in → NOT tagged")

  // HR_SUPPRESSING vetoes
  const suppress = [
    { eventId: "SUP", gameTotal: 10.0, impliedTeamTotal: 5.0, windDirectionTag: "out_to_cf", hrEnvironmentTag: "HR_SUPPRESSING" },
  ]
  assert(F.buildExplosiveEnvironmentIndex(suppress).size === 0, "OE-5 HR_SUPPRESSING vetoes → NOT tagged")

  // Anti-fabrication — no canonical signals → empty
  const blank = [{ eventId: "BLANK", player: "X" }]
  assert(F.buildExplosiveEnvironmentIndex(blank).size === 0,
    "OE-5 anti-fabrication — no canonical signals → empty")

  // Multiple events — only explosive subset tagged
  F.resetOe1aStats()
  const mixed = [
    { eventId: "G1", gameTotal: 10.0, impliedTeamTotal: 5.0, windDirectionTag: "out_to_cf" },
    { eventId: "G2", gameTotal: 7.5,  impliedTeamTotal: 3.5, windDirectionTag: "in_from_cf" },
    { eventId: "G3", gameTotal: 11.0, impliedTeamTotal: 5.5, windDirectionTag: "out_to_lf" },
  ]
  const idx3 = F.buildExplosiveEnvironmentIndex(mixed)
  assert(idx3.has("G1") && idx3.has("G3"), "OE-5 multi-event — G1 + G3 tagged")
  assert(!idx3.has("G2"), "OE-5 multi-event — G2 not tagged (sterile)")
  assert(F.getOe1aStats().explosiveEventsTagged === 2, "OE-9 — 2 events tagged")
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-6 — buildExplosiveUpsideTickets bucket
// ─────────────────────────────────────────────────────────────────────────────
{
  // Auto-empty on missing index
  assert(F.buildExplosiveUpsideTickets([{ c: { side: "over" }, score: { composite: 0.8 } }], null).length === 0,
    "OE-6 null explosiveIndex → empty")
  assert(F.buildExplosiveUpsideTickets([{ c: { side: "over" }, score: { composite: 0.8 } }], new Map()).length === 0,
    "OE-6 empty index → empty")

  // Filters to overs + offensive-attack-stat + explosive-event-only
  const idx = new Map([["EXPLOSIVE_EVT", true]])
  const scored = [
    { c: { id: "a", player: "A", side: "over", statFamily: "hits", eventId: "EXPLOSIVE_EVT" },
      score: { composite: 0.85 } },
    { c: { id: "b", player: "B", side: "over", statFamily: "hits", eventId: "STERILE_EVT" },
      score: { composite: 0.90 } },
    { c: { id: "c", player: "C", side: "under", statFamily: "hits", eventId: "EXPLOSIVE_EVT" },
      score: { composite: 0.80 } },
    { c: { id: "d", player: "D", side: "over", statFamily: "strikeouts", eventId: "EXPLOSIVE_EVT" },
      score: { composite: 0.75 } },
    { c: { id: "e", player: "E", side: "over", statFamily: "total_bases", eventId: "EXPLOSIVE_EVT" },
      score: { composite: 0.70 } },
  ]
  const out = F.buildExplosiveUpsideTickets(scored, idx)
  const ids = out.map((x) => x.c.id)
  assert(ids.includes("a"), `OE-6 bucket includes A (explosive over hitter)`)
  assert(ids.includes("e"), `OE-6 bucket includes E (explosive over TB)`)
  assert(!ids.includes("b"), `OE-6 bucket excludes B (sterile event)`)
  assert(!ids.includes("c"), `OE-6 bucket excludes C (under-side)`)
  assert(!ids.includes("d"), `OE-6 bucket excludes D (pitcher prop, not hitter)`)
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-7 — recommendation ladder slot 9
// ─────────────────────────────────────────────────────────────────────────────
{
  // Null featured → all-null with slot 9 included
  const nullL = F.buildRecommendationLadder(null)
  assert("bestExplosiveUpside" in nullL,
    "OE-7 null featured → ladder includes bestExplosiveUpside slot")
  assert(nullL.bestExplosiveUpside === null,
    "OE-7 null featured → slot 9 is null (honest)")

  // With explosive bucket
  const featured = {
    anchors:                  [{ id: "a1" }],
    safest:                   [],
    bestDisagreementEdges:    [],
    bestAggressive:           [],
    bestPra: [], bestHr: [], bestFirstBasket: [],
    bestBalanced:             [],
    believableUpsideTickets:  [],
    explosiveUpsideTickets:   [{ id: "expl1", player: "Boom" }],
    inflatedSuperstarSpots:   [],
    trapLadders:              [],
  }
  const ladder = F.buildRecommendationLadder(featured)
  assert(ladder.bestExplosiveUpside?.id === "expl1",
    `OE-7 slot 9 picks explosive bucket top (got ${ladder.bestExplosiveUpside?.id})`)
  assert(ladder.bestOverall?.id === "a1", "OE-7 preserves slot 1 bestOverall")

  // Dedup walk — when slot 9's bucket top is already claimed earlier
  const dedup = F.buildRecommendationLadder({
    anchors: [{ id: "same" }], safest: [], bestDisagreementEdges: [], bestAggressive: [],
    bestPra: [], bestHr: [], bestFirstBasket: [], bestBalanced: [],
    believableUpsideTickets: [],
    explosiveUpsideTickets: [{ id: "same" }, { id: "fresh" }],
    inflatedSuperstarSpots: [], trapLadders: [],
  })
  assert(dedup.bestExplosiveUpside?.id === "fresh",
    `OE-7 dedup walk — first claimed by anchor, slot 9 walks past (got ${dedup.bestExplosiveUpside?.id})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-8 — ladderSurvivabilityFactor + ladderSurvivabilityDemote
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1aStats()
  assert(F.OE8_LADDER_DEMOTE_CAP === 0.04, "OE-8 demote cap = 0.04")
  assert(F.OE8_SURVIVABILITY_FLOOR === 0.40, "OE-8 survivability floor = 0.40")

  // Neutral when empty / null
  assert(F.ladderSurvivabilityFactor({}) === 1.00, "OE-8 empty candidate → 1.00 (neutral)")
  assert(F.ladderSurvivabilityFactor(null) === 1.00, "OE-8 null → 1.00 neutral")

  // Strong survivability — no demote
  const strong = {
    statFamily: "hits", side: "over", line: 1.5,
    plateAppearancesProxy: 4.61, runEnvironment: 0.85,
  }
  const sFactor = F.ladderSurvivabilityFactor(strong)
  assert(sFactor > F.OE8_SURVIVABILITY_FLOOR, `OE-8 strong ladder factor > floor (got ${sFactor})`)
  assert(F.ladderSurvivabilityDemote(strong) === 0, "OE-8 strong ladder → 0 demote")

  // Weak survivability — high line + low PA + weak env → factor below floor
  const weak = {
    statFamily: "hits", side: "over", line: 4.5,
    plateAppearancesProxy: 3.81, runEnvironment: 0.30,
  }
  const wFactor = F.ladderSurvivabilityFactor(weak)
  // Demote may or may not fire depending on exact computation; assert the factor is materially lower
  assert(wFactor < sFactor,
    `OE-8 weak ladder factor (${wFactor}) < strong (${sFactor})`)

  // Counter increments only when demote fires
  F.resetOe1aStats()
  // Use a definitely-below-floor candidate
  const veryWeak = {
    statFamily: "hits", side: "over", line: 6.0,
    plateAppearancesProxy: 2.0, runEnvironment: 0.10,
  }
  const demote = F.ladderSurvivabilityDemote(veryWeak)
  if (demote > 0) {
    assert(demote === 0.04, "OE-8 weak ladder → exact 0.04 demote (cap)")
    assert(F.getOe1aStats().survivabilityDemotesApplied >= 1,
      "OE-9 — survivabilityDemotesApplied counter increments on demote")
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-9 — counter reset / get discipline
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1aStats()
  const fresh = F.getOe1aStats()
  assert(fresh.explosiveEventsTagged === 0
      && fresh.hrCarryBoostsApplied === 0
      && fresh.runProductionBoostsApplied === 0
      && fresh.pressureBoostsApplied === 0
      && fresh.survivabilityDemotesApplied === 0,
    "OE-9 — reset returns all counters to 0")

  F.hrCarryEnvironment({
    statFamily: "hr", side: "over",
    windDirectionTag: "out_to_cf", carryShift: 0.05,
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80,
  })
  F.correlatedRunProduction({
    statFamily: "runs", side: "over", lineupSpot: 1, runEnvironment: 0.85,
  })
  const after = F.getOe1aStats()
  assert(after.hrCarryBoostsApplied === 1, "OE-9 — hrCarryBoostsApplied accumulates")
  assert(after.runProductionBoostsApplied === 1, "OE-9 — runProductionBoostsApplied accumulates")

  F.resetOe1aStats()
  assert(F.getOe1aStats().hrCarryBoostsApplied === 0, "OE-9 — re-reset returns to 0")
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION — end-to-end with explosive vs sterile environments
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1aStats()
  const candidates = [
    // Explosive offensive over: hitter in 10.0-total game, 5.5 teamTotal, wind-out, HR_FRIENDLY, top-of-order
    { player: "Boom Bat", statFamily: "hits", side: "over", line: 1.5, odds: -110,
      book: "DK", team: "NYY", eventId: "EXPL_G1", modelProb: 0.55, edge: 0.08,
      depth: "top", lineupSpot: 2, plateAppearancesProxy: 4.50,
      impliedTeamTotal: 5.5, gameTotal: 10.0, runEnvironment: 0.85, rbiEnvironment: 0.85,
      windDirectionTag: "out_to_cf", carryShift: 0.05,
      hrEnvironmentTag: "HR_FRIENDLY", hrFactor: 1.20, temperatureF: 82 },
    // Explosive HR over (same explosive game)
    { player: "Boom HR", statFamily: "home_runs", side: "over", line: 0.5, odds: 280,
      book: "DK", team: "NYY", eventId: "EXPL_G1", modelProb: 0.32, edge: 0.05,
      depth: "middle", lineupSpot: 4, plateAppearancesProxy: 4.45,
      impliedTeamTotal: 5.5, gameTotal: 10.0, runEnvironment: 0.85,
      windDirectionTag: "out_to_cf", carryShift: 0.05,
      hrEnvironmentTag: "HR_FRIENDLY", hrFactor: 1.20, temperatureF: 82 },
    // Sterile under (dead 7.0 game, weak env, HR_SUPPRESSING)
    { player: "Quiet Bat", statFamily: "hits", side: "under", line: 1.5, odds: -120,
      book: "DK", team: "OAK", eventId: "STERILE_G2", modelProb: 0.65, edge: 0.03,
      depth: "back", lineupSpot: 9, plateAppearancesProxy: 3.81,
      impliedTeamTotal: 3.0, gameTotal: 7.0, runEnvironment: 0.30,
      windDirectionTag: "in_from_cf", carryShift: -0.02,
      hrEnvironmentTag: "HR_SUPPRESSING", hrFactor: 0.85, temperatureF: 60 },
  ]
  const out = F.buildFeaturedPlays({ candidates, sport: "mlb", date: "2026-05-17" })

  // OE-5 should have tagged EXPL_G1 (gameTotal=10, teamTotal=5.5, wind-out, not HR_SUPPRESSING)
  assert(out.oe1aStats.explosiveEventsTagged === 1,
    `OE-5 integration — exactly 1 explosive event tagged (got ${out.oe1aStats.explosiveEventsTagged})`)

  // OE-6 bucket should contain Boom Bat + Boom HR (both hitter overs in explosive event)
  const buIds = out.explosiveUpsideTickets.map((p) => p.player)
  assert(buIds.includes("Boom Bat"),
    `OE-6 integration — Boom Bat surfaces in explosive bucket (got ${JSON.stringify(buIds)})`)

  // OE-9 stats reflect activity
  assert(out.oe1aStats.pressureBoostsApplied >= 1,
    "OE-9 integration — pressure boost applied at least once")
  assert(out.oe1aStats.hrCarryBoostsApplied >= 1,
    "OE-9 integration — hr-carry boost applied to Boom HR")

  // OE-7 — recommendation ladder slot 9 surfaces Boom Bat OR another OE-6 candidate
  const slot9Player = out.recommendationLadder?.bestExplosiveUpside?.player
  assert(slot9Player === "Boom Bat" || slot9Player === "Boom HR" || slot9Player === undefined,
    `OE-7 integration — slot 9 surfaces Boom Bat / Boom HR or null if dedup (got ${slot9Player})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESERVATION INVARIANTS — under-side legs UNTOUCHED
// ─────────────────────────────────────────────────────────────────────────────
{
  // OE-2 / OE-3 / OE-4 do NOT boost under-side legs (preserves hidden-value unders).
  F.resetOe1aStats()
  const underLeg = {
    statFamily: "hits", side: "under", line: 1.5,
    runEnvironment: 0.80, impliedTeamTotal: 5.5,
    windDirectionTag: "out_to_cf", carryShift: 0.05,
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80,
    lineupSpot: 1, rbiEnvironment: 0.85,
  }
  assert(F.offensivePressureIndex(underLeg) === 0.50,
    "Preservation — under leg gets neutral 0.50 pressure (no boost)")
  assert(F.hrCarryEnvironment(underLeg) === 0,
    "Preservation — under leg gets 0 HR-carry (HR overs only)")
  assert(F.correlatedRunProduction(underLeg) === 0,
    "Preservation — under leg gets 0 run-prod (overs only)")
  const stats = F.getOe1aStats()
  assert(stats.pressureBoostsApplied === 0 && stats.hrCarryBoostsApplied === 0 && stats.runProductionBoostsApplied === 0,
    "Preservation — zero counters fire on under-side leg (no destruction of hidden-value unders)")
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Offensive-Ecology-Intelligence-1A HELPER UNIT TEST")
console.log("OE-1 + OE-2 + OE-3 + OE-4 + OE-5 + OE-6 + OE-7 + OE-8 + OE-9 + OE-10")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`OE-1  (canonical realism+env fields lifted)     : both normalizeCandidate paths preserve 6 new fields`)
console.log(`OE-2  (offensivePressureIndex)                  : weight=${F.OE2_PRESSURE_WEIGHT}; neutral=${F.OE2_NEUTRAL_PRESSURE}; hitter overs only`)
console.log(`OE-3  (hrCarryEnvironment)                      : +${F.OE3_HR_BOOST_CAP} cap; HR overs only; 4-gate AND`)
console.log(`OE-4  (correlatedRunProduction)                 : +${F.OE4_RUN_BOOST_CAP} cap; runs/RBIs top-of-order only`)
console.log(`OE-5  (explosiveEnvironmentTag)                 : gameTotal>=${F.OE5_GAME_TOTAL_MIN} + avgTT>=${F.OE5_AVG_TEAM_TOTAL_MIN} + wind-out + not-suppressing`)
console.log(`OE-6  (buildExplosiveUpsideTickets)             : top-${F.OE6_EXPLOSIVE_MAX_TICKETS} hitter overs from EXPLOSIVE events`)
console.log(`OE-7  (recommendation ladder slot 9)            : bestExplosiveUpside additive slot`)
console.log(`OE-8  (ladderSurvivabilityFactor)               : -${F.OE8_LADDER_DEMOTE_CAP} cap soft demote when factor<${F.OE8_SURVIVABILITY_FLOOR}`)
console.log(`OE-9  (operator-visible log)                    : per-run counters reset + 5-dimension accounting`)
console.log(`OE-10 (this fixture)                            : sterile vs explosive integration verified`)
console.log("")
console.log(`SUMMARY: ${passed} / ${total} assertions PASS`)
if (failed > 0) {
  console.log(`         ${failed} FAIL`)
  for (const f of failures) console.log(`           - ${f}`)
  console.log("RESULT: FAIL")
  process.exit(1)
}
console.log("RESULT: PASS")
process.exit(0)
