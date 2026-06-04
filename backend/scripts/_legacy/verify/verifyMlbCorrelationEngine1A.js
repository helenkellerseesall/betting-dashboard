"use strict"

/**
 * Phase MLB-Correlation-Engine-1A — helper unit-test fixture (MLB-COV-1/2/3).
 *
 * Verifies the three deterministic same-game ecological covariance gates wired
 * into `backend/pipeline/shared/buildSlipAi.js:canAddLeg`. All assertions are
 * pure-function exercises of the canonical engine + the slip-composer
 * `canAddLeg` rule — no DB, no HTTP, no fixture filesystem. Run via:
 *   node backend/scripts/verifyMlbCorrelationEngine1A.js
 *
 * Doctrine guarded:
 *   • MLB-COV-1 — bridge canonical pairCorrelationScore semantics into the
 *                  slip composer (anti-duplication: same predicates used by
 *                  cluster engine + workstation slip path).
 *   • MLB-COV-2 — same-game hitter-counting UNDER ecological suppression
 *                  (single ecological event must not masquerade as multiple
 *                  independent safety paths).
 *   • MLB-COV-3 — role-aware pitcher-K-OVER vs opposing hitter-counting-OVER
 *                  hard block (the strict subset of the canonical -1.0
 *                  doctrine; opposing teams; both OVER).
 *
 * Preservation guarantees verified:
 *   • NBA correlation path untouched (skipScriptCorrelation=true bypasses all
 *     three gates).
 *   • Legitimate same-team hitter-OVER stacks NOT blocked by these gates
 *     (positive +0.5 cov preserved).
 *   • Cross-game UNDER pairs NOT blocked (gates are same-game only).
 *   • Anti-fabrication: unknown sport / unknown propType → no false block.
 */

const path = require("path")
const {
  canAddLeg,
  getMlbCovStats,
  resetMlbCovStats,
  MLB_COV_REASON_SHARED_GAME_SUPPRESSION,
  MLB_COV_REASON_PITCHER_HITTER_CONFLICT,
} = require(path.join(__dirname, "..", "pipeline", "shared", "buildSlipAi.js"))
const {
  pairCorrelationScore,
  isOverSide,
  isUnderSide,
  isHitterCountingProp,
  isPitcherKProp,
} = require(path.join(__dirname, "..", "pipeline", "mlb", "buildMlbCorrelationEngine.js"))

let passed = 0
let failed = 0
const failures = []

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}

// MLB-shaped tier templates (NBA bypass is via skipScriptCorrelation=true).
const MLB_SAFE_TPL = {
  maxPerGame: 2, maxPerStat: 2, maxFb: 1, legCountRange: [2, 3],
  skipScriptCorrelation: false, allowedSides: ["under"],
}
const MLB_LOTTO_TPL = {
  maxPerGame: 2, maxPerStat: 2, maxFb: 1, legCountRange: [3, 5],
  skipScriptCorrelation: false,
}
const NBA_TPL = {
  maxPerGame: 2, maxPerStat: 2, maxFb: 1, legCountRange: [2, 3],
  skipScriptCorrelation: true,    // NBA explicitly bypasses MLB gates
}

function makeLeg(p) {
  return {
    id: `${p.player}|${p.propType}|${p.side}|${p.line}|${p.book || "dk"}`,
    player: p.player,
    team:   p.team || null,
    eventId: p.eventId || "EVT_X",
    matchup: p.matchup || null,
    statFamily: p.statFamily || p.propType,
    propType:   p.propType,
    side:       p.side,
    line:       p.line,
    odds:       p.odds || 110,
    book:       p.book || "dk",
    modelProb:  p.modelProb || 0.55,
    volatility: p.volatility || "safe",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL PREDICATE EXPORTS (additive surface)
// ─────────────────────────────────────────────────────────────────────────────
{
  assert(typeof isOverSide === "function",         "Canonical export — isOverSide is a function")
  assert(typeof isUnderSide === "function",        "Canonical export — isUnderSide is a function")
  assert(typeof isHitterCountingProp === "function", "Canonical export — isHitterCountingProp is a function")
  assert(typeof isPitcherKProp === "function",     "Canonical export — isPitcherKProp is a function")
  assert(typeof pairCorrelationScore === "function","Canonical export — pairCorrelationScore preserved")

  assert(isOverSide({ side: "over" })  === true,  "isOverSide — \"over\" → true")
  assert(isUnderSide({ side: "under" }) === true, "isUnderSide — \"under\" → true")
  assert(isHitterCountingProp({ propType: "hits" }) === true, "isHitterCountingProp — hits → true")
  assert(isHitterCountingProp({ propType: "total bases" }) === true, "isHitterCountingProp — total bases → true")
  assert(isHitterCountingProp({ propType: "runs" }) === true, "isHitterCountingProp — runs → true")
  assert(isPitcherKProp({ propType: "strikeouts" }) === true, "isPitcherKProp — strikeouts → true")
  assert(isHitterCountingProp({ propType: "points" }) === false, "isHitterCountingProp — NBA points → false (sport-shape inertness)")
  assert(isPitcherKProp({ propType: "threes" }) === false, "isPitcherKProp — NBA threes → false")
}

// ─────────────────────────────────────────────────────────────────────────────
// MLB-COV-2 — same-game hitter-counting UNDER ecological suppression
// (anchor: 2026-05-15 ARI@COL Vargas+Goodman SAFE 2-leg both-UNDER loss)
// ─────────────────────────────────────────────────────────────────────────────
{
  resetMlbCovStats()
  const vargas = makeLeg({ player: "Ildemaro Vargas", team: "ARI", eventId: "ARICOL", propType: "hits", side: "under", line: 1.5 })
  const goodman = makeLeg({ player: "Hunter Goodman", team: "COL", eventId: "ARICOL", propType: "hits", side: "under", line: 1.5 })

  // First leg added → ok.
  const r1 = canAddLeg([], vargas, MLB_SAFE_TPL)
  assert(r1.ok === true, "MLB-COV-2 first hitter-UNDER alone — ok")

  // Second same-game hitter-UNDER → blocked.
  const r2 = canAddLeg([vargas], goodman, MLB_SAFE_TPL)
  assert(r2.ok === false, "MLB-COV-2 same-game 2nd hitter-UNDER — blocked")
  assert(r2.reason === MLB_COV_REASON_SHARED_GAME_SUPPRESSION, "MLB-COV-2 — canonical reason emitted")
  assert(getMlbCovStats().blockedSharedGameSuppression === 1, "MLB-COV-2 — counter incremented")
}

// Cross-game UNDER pair — NOT blocked (gate is same-game only)
{
  resetMlbCovStats()
  const a = makeLeg({ player: "A", team: "TEX", eventId: "TEX_LAA", propType: "hits", side: "under", line: 1.5 })
  const b = makeLeg({ player: "B", team: "NYY", eventId: "NYY_BOS", propType: "hits", side: "under", line: 1.5 })
  const r = canAddLeg([a], b, MLB_SAFE_TPL)
  assert(r.ok === true, "MLB-COV-2 cross-game hitter-UNDER pair — allowed (gate is same-game only)")
  assert(getMlbCovStats().blockedSharedGameSuppression === 0, "MLB-COV-2 cross-game — counter stays 0")
}

// Same-game UNDER + non-hitter (pitcher strikeouts UNDER) — NOT blocked by MLB-COV-2
{
  resetMlbCovStats()
  const hitterUnder = makeLeg({ player: "Hitter", team: "TEX", eventId: "TEX_LAA", propType: "hits", side: "under", line: 1.5 })
  const pitcherUnder = makeLeg({ player: "Pitcher", team: "LAA", eventId: "TEX_LAA", propType: "strikeouts", side: "under", line: 5.5 })
  const r = canAddLeg([hitterUnder], pitcherUnder, MLB_SAFE_TPL)
  assert(r.ok === true, "MLB-COV-2 hitter-UNDER + pitcher-K-UNDER same game — allowed (MLB-COV-2 hitter-only scope)")
}

// MLB-COV-2 fires regardless of same-team / opposing-team (Coors example was opposing teams)
{
  resetMlbCovStats()
  const a = makeLeg({ player: "A", team: "ARI", eventId: "ARICOL", propType: "total bases", side: "under", line: 1.5 })
  const b = makeLeg({ player: "B", team: "ARI", eventId: "ARICOL", propType: "hits", side: "under", line: 1.5 })
  const r = canAddLeg([a], b, MLB_SAFE_TPL)
  assert(r.ok === false && r.reason === MLB_COV_REASON_SHARED_GAME_SUPPRESSION,
    "MLB-COV-2 same-team 2 hitter-UNDERs same game — blocked")
}

// ─────────────────────────────────────────────────────────────────────────────
// MLB-COV-1 + MLB-COV-3 — pitcher-K-OVER + opposing hitter-counting-OVER block
// ─────────────────────────────────────────────────────────────────────────────
{
  resetMlbCovStats()
  // Pitcher K OVER (LAA) + opposing-team (TEX) hitter OVER hits, same game.
  // pairCorrelationScore returns -1.0 (opposing teams, both rules hit).
  const pitcherKOver = makeLeg({ player: "Shohei Ohtani", team: "LAA", eventId: "TEX_LAA", propType: "strikeouts", side: "over", line: 6.5 })
  const opposingHitterOver = makeLeg({ player: "Texas Hitter", team: "TEX", eventId: "TEX_LAA", propType: "hits", side: "over", line: 1.5 })

  const score = pairCorrelationScore(pitcherKOver, opposingHitterOver)
  assert(score <= -0.99, `Canonical pairCorrelationScore — opposing teams pitcher-K vs hitter overs → -1.0 (got ${score})`)

  const r = canAddLeg([pitcherKOver], opposingHitterOver, MLB_LOTTO_TPL)
  assert(r.ok === false, "MLB-COV-3 opposing-team pitcher-K-OVER + hitter-OVER same game — blocked (even in LOTTO)")
  assert(r.reason === MLB_COV_REASON_PITCHER_HITTER_CONFLICT, "MLB-COV-3 — canonical reason emitted")
  assert(getMlbCovStats().blockedPitcherHitterConflict === 1, "MLB-COV-3 — counter incremented")
}

// Symmetric direction — hitter-OVER added first then pitcher-K-OVER (must also block)
{
  resetMlbCovStats()
  const hitterOver = makeLeg({ player: "Texas Hitter", team: "TEX", eventId: "TEX_LAA", propType: "total bases", side: "over", line: 1.5 })
  const pitcherKOver = makeLeg({ player: "Ohtani", team: "LAA", eventId: "TEX_LAA", propType: "strikeouts", side: "over", line: 6.5 })
  const r = canAddLeg([hitterOver], pitcherKOver, MLB_LOTTO_TPL)
  assert(r.ok === false && r.reason === MLB_COV_REASON_PITCHER_HITTER_CONFLICT,
    "MLB-COV-3 reverse-add-order — still blocked (commutative)")
}

// MLB-COV-3 NOT a problem when pitcher-K is UNDER (smallest-safe-step preserves
// existing behavior — future phase may tighten).
{
  resetMlbCovStats()
  const pitcherKUnder = makeLeg({ player: "Ohtani", team: "LAA", eventId: "TEX_LAA", propType: "strikeouts", side: "under", line: 6.5 })
  const hitterOver = makeLeg({ player: "Texas Hitter", team: "TEX", eventId: "TEX_LAA", propType: "hits", side: "over", line: 1.5 })
  const r = canAddLeg([pitcherKUnder], hitterOver, MLB_LOTTO_TPL)
  // Should NOT trip MLB-COV-3 because candidate.side !== "over" check on the previous-leg side requires both OVER
  // Actually the rule is: candidate.side === "over" AND existing leg.side === "over". Here pitcher under, hitter over,
  // adding hitter (over) to slip with pitcher under → existing leg side is "under" → no block.
  assert(r.ok === true, "MLB-COV-3 pitcher-K-UNDER + hitter-OVER same game — NOT blocked (out of strict scope; future phase)")
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESERVATION GUARANTEES
// ─────────────────────────────────────────────────────────────────────────────

// (a) NBA path unchanged — skipScriptCorrelation=true bypasses all MLB gates.
{
  resetMlbCovStats()
  // NBA-shape legs that LOOK like MLB pitcher/hitter (but they're NBA).
  // skipScriptCorrelation: true means MLB block never fires.
  const a = makeLeg({ player: "Player A", team: "LAL", eventId: "LAL_GSW", propType: "points", side: "over", line: 22.5 })
  const b = makeLeg({ player: "Player B", team: "GSW", eventId: "LAL_GSW", propType: "assists", side: "over", line: 5.5 })
  const r = canAddLeg([a], b, NBA_TPL)
  assert(r.ok === true, "NBA skipScriptCorrelation=true — MLB gates bypassed (preservation)")
  assert(getMlbCovStats().blockedSharedGameSuppression === 0, "NBA path — counter untouched")
}

// (b) Legitimate same-team hitter-OVER stack preserved (positive +0.5 cov).
{
  resetMlbCovStats()
  const a = makeLeg({ player: "Hitter1", team: "ARI", eventId: "ARICOL", propType: "hits", side: "over", line: 1.5 })
  const b = makeLeg({ player: "Hitter2", team: "ARI", eventId: "ARICOL", propType: "total bases", side: "over", line: 1.5 })
  // The script_correlation rule (line 522) would block this in SAFE/BALANCED/AGGRESSIVE
  // (2-3 leg cap). But MLB-COV-1/2/3 themselves should NOT block it — verified via LOTTO tpl
  // (5-leg, bypasses script_correlation).
  const r = canAddLeg([a], b, MLB_LOTTO_TPL)
  assert(r.ok === true, "Preservation — same-team hitter-OVER stack NOT blocked by MLB-COV-1/2/3 (LOTTO context)")
  // Verify positive cov score from canonical engine
  const score = pairCorrelationScore(a, b)
  assert(score === 0.5, `Canonical engine — same-team hitter-OVER stack → +0.5 (got ${score})`)
}

// (c) Anti-fabrication: unknown propType / missing fields → no false block.
{
  resetMlbCovStats()
  const a = makeLeg({ player: "A", team: "X", eventId: "GAME1", propType: "mystery_prop", side: "under", line: 1.5 })
  const b = makeLeg({ player: "B", team: "X", eventId: "GAME1", propType: "mystery_prop", side: "under", line: 1.5 })
  const r = canAddLeg([a], b, MLB_SAFE_TPL)
  assert(r.ok === true, "Anti-fabrication — unknown propType same-game UNDER pair NOT blocked by MLB-COV-2")
  // Existing script_correlation rule would not fire (both unders); duplicate_player also fine
}

// (d) Single-leg slip — gates never fire (no peer leg to pair with).
{
  resetMlbCovStats()
  const sole = makeLeg({ player: "Solo", team: "TEX", eventId: "TEX_LAA", propType: "hits", side: "under", line: 1.5 })
  const r = canAddLeg([], sole, MLB_SAFE_TPL)
  assert(r.ok === true, "Single-leg slip — gates never fire")
  assert(getMlbCovStats().blockedSharedGameSuppression === 0, "Single-leg — counter stays 0")
}

// (e) Stats reset on every buildAiSlips invocation (via resetMlbCovStats).
{
  // Build up some state
  const a = makeLeg({ player: "A", team: "X", eventId: "G", propType: "hits", side: "under", line: 1.5 })
  const b = makeLeg({ player: "B", team: "X", eventId: "G", propType: "hits", side: "under", line: 1.5 })
  canAddLeg([a], b, MLB_SAFE_TPL)
  assert(getMlbCovStats().blockedSharedGameSuppression >= 1, "Counter accumulated before reset")
  resetMlbCovStats()
  assert(getMlbCovStats().blockedSharedGameSuppression === 0, "Counter reset to 0")
  assert(getMlbCovStats().blockedPitcherHitterConflict === 0, "Counter reset to 0 (both fields)")
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE MLB-Correlation-Engine-1A HELPER UNIT TEST (MLB-COV-1/2/3)")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`MLB-COV-1  (canonical engine bridge)         : reused pairCorrelationScore + role predicates`)
console.log(`MLB-COV-2  (shared-game suppression)         : reason="${MLB_COV_REASON_SHARED_GAME_SUPPRESSION}"`)
console.log(`MLB-COV-3  (pitcher-hitter conflict)         : reason="${MLB_COV_REASON_PITCHER_HITTER_CONFLICT}"`)
console.log(`Preservation                                  : NBA path bypassed; +0.5 same-team OVER stacks preserved`)
console.log(`Anti-fabrication                              : unknown propType / single-leg slip → no false block`)
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
