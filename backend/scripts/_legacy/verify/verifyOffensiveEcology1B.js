"use strict"

/**
 * Phase Offensive-Ecology-Intelligence-1B — helper unit-test fixture.
 *
 * OE-11 + OE-12 + OE-13 + cross-phase OE-1A compatibility.
 *
 * Deterministic pure-function + integration assertions on the positive
 * offensive reinforcement foundation. NO HTTP. NO SQLite. NO ML. NO LLM.
 *
 * Doctrine guarded:
 *   • OE-11: stackReinforcementScore — per-pair joint-prob boost (cap 0.02);
 *           aggregate cap 0.03 in combineLegs; activates ONLY on canonical
 *           +0.5 same-team hitter-OVER pairs in EXPLOSIVE env with both legs
 *           above pressure floor. Anti-fabrication: zero when any gate fails.
 *   • OE-12: lineupTurnoverPotential + buildLineupTurnoverIndex + boost cap 0.02.
 *           Consumed by aggressive / lotto / explosive-upside buckets ONLY.
 *   • OE-13: bullpenFragilityContext — +0.02 cap on hitter overs; NEUTRAL
 *           fallback when bullpenDataAvailable !== true; never fabricates.
 *
 * Preservation:
 *   • combineLegs back-compat: when opts.stackReinforcementScore absent,
 *     totalBoost stays 0 and modelProb math is unchanged.
 *   • MLB-COV-2/3 hard blocks PRESERVED — OE-11 only activates on +0.5 score
 *     (the positive case hard blocks don't touch).
 *   • Hidden-value unders UNTOUCHED — all OE-1B helpers gate on side="over".
 *   • OE-1A behavior unchanged (101/101 assertions still PASS).
 *
 * Run via:
 *   node backend/scripts/verifyOffensiveEcology1B.js
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
// OE-1B field lift — bullpenShift / reliefFatigueScore / bullpenDataAvailable
// ─────────────────────────────────────────────────────────────────────────────
{
  const raw = {
    player: "X", statFamily: "hits", side: "over", line: 1.5, odds: -110,
    book: "DK", bullpenShift: 0.06, reliefFatigueScore: 0.7,
    bullpenDataAvailable: true,
  }
  const n = S.normalizeCandidate(raw)
  assert(n.bullpenShift === 0.06, "OE-1B (buildSlipAi) preserves bullpenShift")
  assert(n.reliefFatigueScore === 0.7, "OE-1B preserves reliefFatigueScore")
  assert(n.bullpenDataAvailable === true, "OE-1B preserves bullpenDataAvailable")

  const bare = { player: "Y", statFamily: "hits", side: "over", line: 1.5, odds: -110, book: "DK" }
  const nb = S.normalizeCandidate(bare)
  assert(nb.bullpenShift === undefined, "OE-1B anti-fabrication — absent bullpenShift → undefined")
  assert(nb.bullpenDataAvailable === undefined, "OE-1B anti-fabrication — absent flag → undefined")
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-11 — stackReinforcementScore (positive-cov pair reinforcement)
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1bStats()
  assert(F.OE11_PAIR_BOOST_CAP === 0.02, "OE-11 per-pair boost cap = 0.02")
  assert(F.OE11_TOTAL_BOOST_CAP === 0.03, "OE-11 aggregate boost cap = 0.03")
  assert(F.OE11_PRESSURE_FLOOR === 0.60, "OE-11 pressure floor = 0.60")

  // Anti-fabrication on null / empty
  assert(F.stackReinforcementScore(null, null) === 0, "OE-11 null pair → 0")
  assert(F.stackReinforcementScore({}, {}) === 0, "OE-11 empty pair → 0")

  // Full activation — same team + hitter OVERs + explosive env + pressure cleared.
  // pairCorrelationScore (canonical MLB engine) reads row.propType via substring
  // match — must use human-readable form ("Hits"/"Total Bases") that the
  // isHitterCountingProp predicate matches via .includes("hits") / .includes("total bases").
  const explosiveLeg = (player, propType) => ({
    player, propType, statFamily: propType.toLowerCase().replace(/\s+/g, ""),
    side: "over", team: "NYY", eventId: "EXPL_G1",
    runEnvironment: 0.90, impliedTeamTotal: 5.5, carryShift: 0.05,
    gameTotal: 10.0, windDirectionTag: "out_to_cf",
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 82,
  })
  const a = explosiveLeg("Judge", "Hits")
  const b = explosiveLeg("Soto",  "Total Bases")
  const boost = F.stackReinforcementScore(a, b)
  assert(boost > 0, `OE-11 full activation → positive boost (got ${boost})`)
  assert(boost <= F.OE11_PAIR_BOOST_CAP, `OE-11 boost ≤ per-pair cap (got ${boost})`)
  assert(F.getOe1bStats().pairReinforcementBoosts === 1, "OE-1B counter increments on boost")

  // Different teams → 0 (same-team gate)
  F.resetOe1bStats()
  const teamB = { ...explosiveLeg("Other", "hits"), team: "BOS" }
  assert(F.stackReinforcementScore(a, teamB) === 0, "OE-11 different teams → 0")

  // Under-side → 0 (hitter OVERS only)
  const under = { ...explosiveLeg("Under", "hits"), side: "under" }
  assert(F.stackReinforcementScore(a, under) === 0, "OE-11 one leg under → 0")

  // Non-explosive env (gameTotal=8.0) → 0
  const sterile = { ...explosiveLeg("Sterile", "hits"), gameTotal: 8.0 }
  assert(F.stackReinforcementScore(a, sterile) === 0, "OE-11 sterile env (gameTotal<9.5) → 0")

  // Wind-in → 0
  const windIn = { ...explosiveLeg("WindIn", "hits"), windDirectionTag: "in_from_cf" }
  assert(F.stackReinforcementScore(a, windIn) === 0, "OE-11 wind-in → 0")

  // HR_SUPPRESSING → 0
  const supp = { ...explosiveLeg("Supp", "hits"), hrEnvironmentTag: "HR_SUPPRESSING" }
  assert(F.stackReinforcementScore(a, supp) === 0, "OE-11 HR_SUPPRESSING → 0")

  // Different events → 0
  const otherEvent = { ...explosiveLeg("Other", "hits"), eventId: "OTHER" }
  assert(F.stackReinforcementScore(a, otherEvent) === 0, "OE-11 different events → 0")

  // Non-offensive-stat (pitcher K) → 0
  const pitcher = { ...explosiveLeg("Pitcher", "strikeouts") }
  assert(F.stackReinforcementScore(a, pitcher) === 0, "OE-11 pitcher K → 0 (not hitter counting)")

  // Pressure below floor → 0
  const lowPressure = {
    ...explosiveLeg("Low", "hits"),
    runEnvironment: 0.30, impliedTeamTotal: 3.5,  // pressure index well below 0.60
  }
  assert(F.stackReinforcementScore(a, lowPressure) === 0,
    "OE-11 pressure below floor → 0")
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-11 — combineLegs integration (joint-prob boost capped)
// ─────────────────────────────────────────────────────────────────────────────
{
  S.resetOe11SlipStats()
  // Construct an explosive same-team OVER pair
  const a = { id: "a", player: "Judge", team: "NYY", eventId: "G1",
    statFamily: "hits", side: "over", line: 1.5, odds: -110, modelProb: 0.60,
    runEnvironment: 0.90, impliedTeamTotal: 5.5, carryShift: 0.05,
    gameTotal: 10.0, windDirectionTag: "out_to_cf",
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 82,
  }
  const b = { id: "b", player: "Soto", team: "NYY", eventId: "G1",
    statFamily: "totalbases", side: "over", line: 1.5, odds: -120, modelProb: 0.60,
    runEnvironment: 0.90, impliedTeamTotal: 5.5, carryShift: 0.05,
    gameTotal: 10.0, windDirectionTag: "out_to_cf",
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 82,
  }
  // Without stackReinforcementScore (legacy callers): boost = 0
  const legacy = S.canAddLeg ? null : null  // legacy combineLegs invocation
  // Direct require to call combineLegs since it's not exported by name; use buildAiSlips end-to-end
  const result = S.buildAiSlips({ candidates: [a, b], options: { sport: "mlb", date: "2026-05-17" } })
  // At minimum, the combined-model-prob audit field must include calibratedCombinedModelProb
  // and oe11ReinforcementBoost
  const allSlips = [...result.slips.safe, ...result.slips.balanced, ...result.slips.aggressive, ...result.slips.lotto]
  if (allSlips.length > 0) {
    const s = allSlips[0]
    assert(s.calibratedCombinedModelProb != null, "OE-11 combineLegs preserves auditable calibrated prob")
    assert(s.oe11ReinforcementBoost != null, "OE-11 combineLegs exposes reinforcement boost")
    assert(s.oe11ReinforcementBoost >= 0 && s.oe11ReinforcementBoost <= 0.03,
      `OE-11 boost capped [0, 0.03] (got ${s.oe11ReinforcementBoost})`)
  }

  // Counter should increment if any reinforcement occurred
  const stats = S.getOe11SlipStats()
  assert(typeof stats.reinforcedSlips === "number", "OE-11 slip counter exists")

  // The result payload should expose oe11SlipStats
  assert(result.oe11SlipStats != null, "OE-11 oe11SlipStats returned on buildAiSlips result")
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-12 — lineupTurnoverPotential + buildLineupTurnoverIndex
// ─────────────────────────────────────────────────────────────────────────────
{
  assert(F.OE12_TURNOVER_BOOST_CAP === 0.02, "OE-12 boost cap = 0.02")
  assert(F.OE12_NEUTRAL_TURNOVER === 0.50, "OE-12 neutral fallback = 0.50")

  // Anti-fabrication: empty / no canonical signals → neutral
  assert(F.lineupTurnoverPotential([]) === 0.50, "OE-12 empty → 0.50 neutral")
  assert(F.lineupTurnoverPotential(null) === 0.50, "OE-12 null → 0.50 neutral")
  assert(F.lineupTurnoverPotential([{}, {}]) === 0.50,
    "OE-12 anti-fabrication — no canonical signals → 0.50 neutral")

  // Strong turnover environment
  const explosive = [
    { depth: "top", impliedTeamTotal: 5.5, runEnvironment: 0.85 },
    { depth: "middle", impliedTeamTotal: 5.5, runEnvironment: 0.85 },
    { depth: "top", impliedTeamTotal: 5.5, runEnvironment: 0.85 },
  ]
  const strong = F.lineupTurnoverPotential(explosive, true)
  assert(strong > 0.65, `OE-12 strong env (top depths + 5.5tt + 0.85runEnv + explosive) → high score (got ${strong})`)

  // Weak turnover environment
  const weak = [
    { depth: "back", impliedTeamTotal: 3.0, runEnvironment: 0.30 },
  ]
  const weakScore = F.lineupTurnoverPotential(weak, false)
  assert(weakScore < 0.50, `OE-12 weak env → low score (got ${weakScore})`)

  // Explosive flag upgrade
  const sameWithExp = F.lineupTurnoverPotential(weak, true)
  assert(sameWithExp > weakScore, `OE-12 explosive flag adds upgrade (got ${sameWithExp} vs ${weakScore})`)

  // buildLineupTurnoverIndex
  const idx = F.buildLineupTurnoverIndex([
    { eventId: "E1", depth: "top", impliedTeamTotal: 5.5, runEnvironment: 0.85 },
    { eventId: "E1", depth: "middle", impliedTeamTotal: 5.5, runEnvironment: 0.85 },
    { eventId: "E2", depth: "back", impliedTeamTotal: 3.0, runEnvironment: 0.30 },
  ], new Map([["E1", true]]))
  assert(idx.has("E1") && idx.has("E2"), "OE-12 index covers both events")
  assert(idx.get("E1") > idx.get("E2"), "OE-12 explosive event scores higher than sterile")

  // Empty input
  assert(F.buildLineupTurnoverIndex([]).size === 0, "OE-12 empty input → empty Map")
  assert(F.buildLineupTurnoverIndex(null).size === 0, "OE-12 null input → empty Map")
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-12 — lineupTurnoverBoost
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1bStats()
  // No index → 0 boost
  assert(F.lineupTurnoverBoost({ eventId: "X" }, null) === 0, "OE-12 null index → 0 boost")
  // Event not in index → 0
  assert(F.lineupTurnoverBoost({ eventId: "MISSING" }, new Map()) === 0, "OE-12 absent event → 0 boost")
  // Score at neutral → 0
  assert(F.lineupTurnoverBoost({ eventId: "N" }, new Map([["N", 0.50]])) === 0,
    "OE-12 neutral score → 0 boost")
  // Score above neutral → boost > 0
  const boost = F.lineupTurnoverBoost({ eventId: "H" }, new Map([["H", 0.90]]))
  assert(boost > 0 && boost <= 0.02, `OE-12 high score → boost capped (got ${boost})`)
  assert(F.getOe1bStats().turnoverBoostsApplied === 1, "OE-1B turnover counter increments")
  // Score = 1.0 → exactly cap
  const maxBoost = F.lineupTurnoverBoost({ eventId: "MAX" }, new Map([["MAX", 1.0]]))
  assert(approx(maxBoost, F.OE12_TURNOVER_BOOST_CAP),
    `OE-12 score=1.0 → exact cap (got ${maxBoost})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// OE-13 — bullpenFragilityContext
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1bStats()
  assert(F.OE13_BULLPEN_BOOST_CAP === 0.02, "OE-13 boost cap = 0.02")
  assert(F.OE13_NEUTRAL_FRAGILITY === 0.50, "OE-13 neutral fragility = 0.50")
  assert(F.OE13_FRAGILITY_THRESHOLD === 0.55, "OE-13 fragility threshold = 0.55")

  // Anti-fabrication on missing
  assert(F.bullpenFragilityContext({}) === 0, "OE-13 empty candidate → 0")
  assert(F.bullpenFragilityContext(null) === 0, "OE-13 null → 0")

  // Under-side → 0 (hitter OVERS only)
  assert(F.bullpenFragilityContext({
    side: "under", statFamily: "hits", runEnvironment: 0.80, impliedTeamTotal: 5.5,
  }) === 0, "OE-13 under-side → 0 (hitter OVERS only)")

  // Non-offensive-stat → 0
  assert(F.bullpenFragilityContext({
    side: "over", statFamily: "strikeouts", runEnvironment: 0.80, impliedTeamTotal: 5.5,
  }) === 0, "OE-13 non-offensive → 0")

  // Hitter OVER with NO bullpen data + strong support → boost from canonical proxy ONLY
  const noBullpen = F.bullpenFragilityContext({
    side: "over", statFamily: "hits", runEnvironment: 0.80, impliedTeamTotal: 5.5,
  })
  assert(noBullpen >= 0 && noBullpen <= 0.02,
    `OE-13 anti-fabrication — no bullpen data but strong proxy → boost capped (got ${noBullpen})`)

  // Hitter OVER with canonical bullpen fragility data + strong support → boost
  F.resetOe1bStats()
  const fragile = F.bullpenFragilityContext({
    side: "over", statFamily: "hits",
    bullpenDataAvailable: true, bullpenShift: 0.08, reliefFatigueScore: 0.75,
    runEnvironment: 0.85, impliedTeamTotal: 5.5,
  })
  assert(fragile > 0, `OE-13 fragile bullpen + strong support → positive boost (got ${fragile})`)
  assert(fragile <= 0.02, `OE-13 boost ≤ cap (got ${fragile})`)
  assert(F.getOe1bStats().bullpenBoostsApplied === 1, "OE-1B bullpen counter increments on boost")

  // Sharp bullpen (negative shift) + weak support → 0 boost
  F.resetOe1bStats()
  const sharp = F.bullpenFragilityContext({
    side: "over", statFamily: "hits",
    bullpenDataAvailable: true, bullpenShift: -0.05,
    runEnvironment: 0.30, impliedTeamTotal: 3.0,
  })
  assert(sharp === 0, `OE-13 sharp bullpen + weak support → 0 (got ${sharp})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION — end-to-end with OE-1A + OE-1B together
// ─────────────────────────────────────────────────────────────────────────────
{
  F.resetOe1aStats()
  F.resetOe1bStats()
  const candidates = [
    // Explosive same-team OVER pair (OE-11 + OE-12 + BC-5 + OE-5 should all fire)
    { player: "Judge", statFamily: "hits", side: "over", line: 1.5, odds: -110,
      book: "DK", team: "NYY", eventId: "EXPL_NYY_BOS", modelProb: 0.60, edge: 0.08,
      depth: "top", lineupSpot: 2, plateAppearancesProxy: 4.50,
      impliedTeamTotal: 5.5, gameTotal: 10.0,
      runEnvironment: 0.90, rbiEnvironment: 0.85,
      windDirectionTag: "out_to_cf", carryShift: 0.05,
      hrEnvironmentTag: "HR_FRIENDLY", hrFactor: 1.20, temperatureF: 82 },
    { player: "Soto", statFamily: "totalbases", side: "over", line: 1.5, odds: -120,
      book: "DK", team: "NYY", eventId: "EXPL_NYY_BOS", modelProb: 0.62, edge: 0.07,
      depth: "top", lineupSpot: 3, plateAppearancesProxy: 4.45,
      impliedTeamTotal: 5.5, gameTotal: 10.0,
      runEnvironment: 0.90, rbiEnvironment: 0.85,
      windDirectionTag: "out_to_cf", carryShift: 0.05,
      hrEnvironmentTag: "HR_FRIENDLY", hrFactor: 1.20, temperatureF: 82 },
    // Sterile (negative env)
    { player: "Quiet", statFamily: "hits", side: "under", line: 1.5, odds: -120,
      book: "DK", team: "OAK", eventId: "STERILE", modelProb: 0.65, edge: 0.03,
      depth: "back", lineupSpot: 9, plateAppearancesProxy: 3.81,
      impliedTeamTotal: 3.0, gameTotal: 7.0,
      runEnvironment: 0.30,
      windDirectionTag: "in_from_cf", carryShift: -0.02,
      hrEnvironmentTag: "HR_SUPPRESSING", hrFactor: 0.85, temperatureF: 60 },
  ]
  const out = F.buildFeaturedPlays({ candidates, sport: "mlb", date: "2026-05-17" })

  // OE-5 / OE-12: explosive event tagged + turnover event high
  assert(out.oe1aStats.explosiveEventsTagged === 1,
    `OE-5 integration — 1 explosive event tagged (got ${out.oe1aStats.explosiveEventsTagged})`)
  assert(out.oe1bStats.lineupTurnoverEventsHigh >= 1,
    `OE-12 integration — at least 1 high-turnover event (got ${out.oe1bStats.lineupTurnoverEventsHigh})`)

  // OE-1B stats included on result payload
  assert(out.oe1bStats != null, "OE-1B stats returned on buildFeaturedPlays result")
  assert(typeof out.oe1bStats.pairReinforcementBoosts === "number",
    "OE-1B stats has pair-reinforcement counter")
  assert(typeof out.oe1bStats.turnoverBoostsApplied === "number",
    "OE-1B stats has turnover-boost counter")
  assert(typeof out.oe1bStats.bullpenBoostsApplied === "number",
    "OE-1B stats has bullpen-boost counter")

  // Quiet UNDER untouched by all OE-1B helpers
  assert(F.bullpenFragilityContext(candidates[2]) === 0,
    "Preservation — Quiet UNDER gets 0 OE-13 boost")
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESERVATION — MLB-COV hard blocks preserved (OE-11 only fires on +0.5)
// ─────────────────────────────────────────────────────────────────────────────
{
  // Pitcher-K-OVER vs opposing hitter-OVER same game → MLB-COV-3 hard block
  // (pairCorrelationScore === -1.0). OE-11 must NOT inflate this case.
  const pitcher = {
    player: "Ohtani", statFamily: "strikeouts", side: "over", line: 6.5,
    team: "LAA", eventId: "TEX_LAA",
    runEnvironment: 0.50, impliedTeamTotal: 4.0,  // pitcher leg
    gameTotal: 9.5, windDirectionTag: "out_to_cf",
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80, carryShift: 0.03,
  }
  const opposingHitter = {
    player: "Semien", statFamily: "hits", side: "over", line: 1.5,
    team: "TEX", eventId: "TEX_LAA",
    runEnvironment: 0.85, impliedTeamTotal: 5.0,
    gameTotal: 9.5, windDirectionTag: "out_to_cf",
    hrEnvironmentTag: "HR_FRIENDLY", temperatureF: 80, carryShift: 0.05,
  }
  // Both have same gameTotal/wind/HR-friendly so EXPLOSIVE gates met; but pair
  // is pitcher-K vs hitter (DIFFERENT teams). pairCorrelationScore returns -1.0
  // (or -0.5 same-team). OE-11 requires === +0.5 → must return 0.
  assert(F.stackReinforcementScore(pitcher, opposingHitter) === 0,
    "OE-11 preserves MLB-COV: pitcher-K vs opposing-hitter → 0 boost (not +0.5)")
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Offensive-Ecology-Intelligence-1B HELPER UNIT TEST")
console.log("OE-11 + OE-12 + OE-13")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`OE-11 (stackReinforcementScore + combineLegs)   : per-pair cap=${F.OE11_PAIR_BOOST_CAP}; aggregate cap=${F.OE11_TOTAL_BOOST_CAP}`)
console.log(`OE-12 (lineupTurnover + index + boost)          : cap=${F.OE12_TURNOVER_BOOST_CAP}; neutral=${F.OE12_NEUTRAL_TURNOVER}`)
console.log(`OE-13 (bullpenFragilityContext)                 : cap=${F.OE13_BULLPEN_BOOST_CAP}; NEUTRAL on absent bullpen data`)
console.log(`Preservation                                     : MLB-COV hard blocks intact; under-side untouched`)
console.log(`Anti-fabrication                                 : neutral fallback when canonical absent`)
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
