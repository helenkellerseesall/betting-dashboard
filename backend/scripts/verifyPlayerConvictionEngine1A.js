"use strict"

/**
 * Phase Player-Conviction-Engine-1A (PCE-1A) — verifyPlayerConvictionEngine1A.js
 *
 * PCE DRIFT + DOCTRINE INTEGRITY DETECTOR.
 *
 * Operator-cemented constraints (verified as assertions):
 *   - PCE is ADDITIVE (NEW module file under pipeline/shared/)
 *   - PCE is PURE deterministic (NO LLM / NO ML / NO RNG / NO IO)
 *   - PCE consumes ONLY canonical hitter signals already lifted via BC-1/OE-1
 *   - PCE weight is small-cap (PCE_WEIGHT ≤ 0.07)
 *   - PCE additive bounded in [-0.04, +0.05] (longshot preservation)
 *   - PCE is hitter-overs-only (pitcher / under bypasses cleanly)
 *   - PCE wired into scoreCandidate alongside BC-2 + OE-2 + OE-3 + OE-13
 *   - PCE counters wired into per-run reset + end-of-run operator log
 *   - PCE record exposed on compactPlay output (convictionNote / convictionReasonTag)
 *   - PCE signals registered in canonical bettorLanguage SIGNAL_IDS taxonomy
 *   - longshot-preserving behavior verified empirically (high-odds candidate
 *     with earned profile still produces positive PCE additive)
 *   - random-spam behavior verified empirically (back-of-order longshot + dead
 *     env produces a SMALL penalty, NOT zero composite — survives)
 *
 * Pure deterministic source-text + helper-function execution.
 * NO HTTP. NO SQLite. NO ML. NO LLM.
 *
 * Run via:
 *   node backend/scripts/verifyPlayerConvictionEngine1A.js
 *
 * Or via canonical ops layer:
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const pceModulePath           = path.join(BACKEND, "pipeline", "shared", "playerConvictionEngine.js")
const buildFeaturedPlaysPath  = path.join(BACKEND, "pipeline", "shared", "buildFeaturedPlays.js")
const bettorLanguagePath      = path.join(BACKEND, "pipeline", "shared", "bettorLanguage.js")

let passed = 0
let failed = 0
const failures = []

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  failures.push(label)
  console.error(`  ✗ ${label}`)
}
function contains(src, needle, label) {
  assert(src.indexOf(needle) !== -1, `${label} — contains "${needle.slice(0, 70)}${needle.length > 70 ? "…" : ""}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MODULE FILE EXISTS (additive)
// ─────────────────────────────────────────────────────────────────────────────
assert(fs.existsSync(pceModulePath),
  "playerConvictionEngine.js exists as NEW additive module under pipeline/shared/")

const pceSrc = fs.readFileSync(pceModulePath, "utf8")

// 2. NO LLM / NO ML / NO IO (anti-fabrication doctrine)
{
  assert(!/require\(['"](fs|axios|node-fetch|undici|http|https|sqlite|child_process)['"]\)/.test(pceSrc),
    "playerConvictionEngine.js has NO IO requires (fs/axios/fetch/http/sqlite/child_process)")
  assert(pceSrc.indexOf("Math.random") === -1,
    "playerConvictionEngine.js has NO Math.random (replay-safe / deterministic)")
  assert(pceSrc.indexOf("Date.now") === -1,
    "playerConvictionEngine.js has NO Date.now (replay-safe / deterministic)")
  // Anti-fabrication: no IMPORTS of LLM SDKs (negation comments in doctrine
  // text are explicitly allowed — they DOCUMENT the forbidden surfaces).
  assert(!/require\(['"]@?(openai|anthropic|google-ai|cohere|langchain)['"]?/i.test(pceSrc),
    "playerConvictionEngine.js imports NO LLM SDK packages (openai/anthropic/google-ai/cohere/langchain)")
}

// 3. CANONICAL EXPORTS (operator gate)
{
  contains(pceSrc, "computePlayerConviction",     "PCE exports computePlayerConviction()")
  contains(pceSrc, "PCE_WEIGHT",                  "PCE exports PCE_WEIGHT constant")
  contains(pceSrc, "PCE_MAX_BOOST",               "PCE exports PCE_MAX_BOOST constant")
  contains(pceSrc, "PCE_MAX_PENALTY",             "PCE exports PCE_MAX_PENALTY constant")
  contains(pceSrc, "resetPceStats",               "PCE exports resetPceStats() per-run discipline")
  contains(pceSrc, "getPceStats",                 "PCE exports getPceStats() observability")
  contains(pceSrc, "pceModelTrust",               "PCE exports pceModelTrust helper (composable)")
  contains(pceSrc, "pceStatSideCoherence",        "PCE exports pceStatSideCoherence helper (composable)")
}

// 4. CANONICAL-ONLY FIELD ACCESS (anti-fabrication)
{
  // Only canonical fields lifted via BC-1 + OE-1 may be consumed
  contains(pceSrc, "lineupSpot",                  "PCE consumes canonical lineupSpot")
  contains(pceSrc, "plateAppearancesProxy",       "PCE consumes canonical plateAppearancesProxy")
  contains(pceSrc, "impliedTeamTotal",            "PCE consumes canonical impliedTeamTotal")
  contains(pceSrc, "modelProb",                   "PCE consumes canonical modelProb")
  contains(pceSrc, "statFamily",                  "PCE consumes canonical statFamily")
  // NEGATIVE: PCE must NOT invent fabricated season-history fields (those
  // fields don't exist in canonical pipeline — referencing them would be
  // fabrication). This is the anti-fabrication anchor for PCE.
  assert(!/barrelRate|hardHit|xSLG|seasonHR\s*[:=]|isolatedPower|pullPercent/.test(pceSrc),
    "PCE does NOT reference non-canonical sabermetric fields (barrelRate/hardHit/xSLG/seasonHR/ISO/pull% — these don't exist in canonical pipeline; using them would be fabrication)")
}

// 5. WEIGHT + BOUND GATES (operator-approved bands)
{
  // PCE_WEIGHT must be small (≤ 0.07 band per BC-2 precedent)
  const wMatch = pceSrc.match(/const\s+PCE_WEIGHT\s*=\s*([\d.]+)/)
  assert(wMatch && Number(wMatch[1]) > 0 && Number(wMatch[1]) <= 0.07,
    `PCE_WEIGHT in operator-approved small-cap band 0 < w ≤ 0.07 (found: ${wMatch ? wMatch[1] : "absent"})`)
  // PCE_MAX_BOOST must be small (≤ 0.06)
  const bMatch = pceSrc.match(/const\s+PCE_MAX_BOOST\s*=\s*([\d.]+)/)
  assert(bMatch && Number(bMatch[1]) > 0 && Number(bMatch[1]) <= 0.06,
    `PCE_MAX_BOOST in operator-approved small-cap band 0 < b ≤ 0.06 (found: ${bMatch ? bMatch[1] : "absent"})`)
  // PCE_MAX_PENALTY must be small (≤ 0.06) — preserves longshots
  const pMatch = pceSrc.match(/const\s+PCE_MAX_PENALTY\s*=\s*([\d.]+)/)
  assert(pMatch && Number(pMatch[1]) > 0 && Number(pMatch[1]) <= 0.06,
    `PCE_MAX_PENALTY in operator-approved small-cap band 0 < p ≤ 0.06 — longshot-preserving (found: ${pMatch ? pMatch[1] : "absent"})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. WIRING — scoreCandidate integration in buildFeaturedPlays.js
// ─────────────────────────────────────────────────────────────────────────────
const featSrc = fs.readFileSync(buildFeaturedPlaysPath, "utf8")
{
  contains(featSrc, "playerConvictionEngine",
    "buildFeaturedPlays.js imports from playerConvictionEngine (Phase PCE-1A)")
  contains(featSrc, "computePlayerConviction(c)",
    "buildFeaturedPlays.scoreCandidate invokes computePlayerConviction(c)")
  contains(featSrc, "recordPceStat(pceRecord)",
    "buildFeaturedPlays.scoreCandidate records PCE stats via recordPceStat()")
  contains(featSrc, "resetPceStats()",
    "buildFeaturedPlays main entry resets PCE stats per run (BC-9 / OE-9 mirror)")
  contains(featSrc, "[PCE-1A] conviction engine:",
    "buildFeaturedPlays emits operator-visible [PCE-1A] accounting log at end of run")
  contains(featSrc, "pceStats,",
    "buildFeaturedPlays return payload includes pceStats observability")
  // compactPlay surfaces convictionNote + convictionReasonTag for FE consumption
  contains(featSrc, "convictionNote:",
    "compactPlay output surfaces convictionNote (bettor-readable phrase)")
  contains(featSrc, "convictionReasonTag:",
    "compactPlay output surfaces convictionReasonTag (deterministic canonical id)")
  // Additive composition: PCE additive must layer ON TOP OF existing oeAdditive
  contains(featSrc, "+ pceAdditive",
    "scoreCandidate composite layers pceAdditive ON TOP OF existing tier+texture+oe additives (additive doctrine)")
  // Preserved trust layers — BC-2 and OE-2 still wired
  contains(featSrc, "playerLegitimacyFactor(c)",
    "BC-2 playerLegitimacyFactor still wired in scoreCandidate (trust layer preserved)")
  contains(featSrc, "offensivePressureIndex(c)",
    "OE-2 offensivePressureIndex still wired in scoreCandidate (trust layer preserved)")
  contains(featSrc, "bullpenFragilityContext(c)",
    "OE-13 bullpenFragilityContext still wired in scoreCandidate (trust layer preserved)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. BETTORLANGUAGE TAXONOMY EXTENSION (canonical signal-id discipline)
// ─────────────────────────────────────────────────────────────────────────────
const blSrc = fs.readFileSync(bettorLanguagePath, "utf8")
{
  contains(blSrc, "PCE_EARNED_UPSIDE_PROFILE",         "bettorLanguage SIGNAL_IDS registers PCE_EARNED_UPSIDE_PROFILE")
  contains(blSrc, "PCE_LINEUP_SUPPORTED_EDGE",         "bettorLanguage SIGNAL_IDS registers PCE_LINEUP_SUPPORTED_EDGE")
  contains(blSrc, "PCE_MODEST_LINEUP_CONVICTION",      "bettorLanguage SIGNAL_IDS registers PCE_MODEST_LINEUP_CONVICTION")
  contains(blSrc, "PCE_ECOLOGY_LIGHT_SPOT",            "bettorLanguage SIGNAL_IDS registers PCE_ECOLOGY_LIGHT_SPOT")
  contains(blSrc, "PCE_THIN_PROCESS_LONGSHOT",         "bettorLanguage SIGNAL_IDS registers PCE_THIN_PROCESS_LONGSHOT")
  contains(blSrc, "pce_earned_upside_profile",         "bettorLanguage SIGNAL_PHRASES + PRIORITY_ORDER include earned upside")
  contains(blSrc, "pceReasonTagToSignalId",            "bettorLanguage exports pceReasonTagToSignalId() mapping helper")
  contains(blSrc, "PCE_REASON_TAG_TO_SIGNAL_ID",       "bettorLanguage exposes canonical PCE reasonTag → signal-id map")
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. EMPIRICAL — pure-function behavioral assertions
// ─────────────────────────────────────────────────────────────────────────────
const {
  computePlayerConviction,
  PCE_MAX_BOOST,
  PCE_MAX_PENALTY,
  resetPceStats,
  recordPceStat,
  getPceStats,
} = require(pceModulePath)

resetPceStats()

// A) Earned upside profile → max positive additive
const earned = computePlayerConviction({
  side: "over", statFamily: "home_runs",
  lineupSpot: 3, plateAppearancesProxy: 4.2, modelProb: 0.24, edge: 0.07,
  impliedTeamTotal: 4.9, hrEnvironmentTag: "HR_FRIENDLY",
})
assert(earned.gated && earned.additive >= PCE_MAX_BOOST * 0.8,
  `EARNED profile (spot=3, PA=4.2, modelProb=0.24) produces near-max boost (got ${earned.additive}, expected ≥ ${(PCE_MAX_BOOST * 0.8).toFixed(3)})`)
assert(earned.phrase === "earned upside profile" && earned.reasonTag === "PCE:earned",
  `EARNED profile emits canonical phrase + reasonTag (got phrase="${earned.phrase}", tag="${earned.reasonTag}")`)
recordPceStat(earned)

// B) +700 longshot WITH earned profile still gets boost (longshot preservation)
const earnedLongshot = computePlayerConviction({
  side: "over", statFamily: "home_runs",
  lineupSpot: 4, plateAppearancesProxy: 4.0, modelProb: 0.18, edge: 0.06,
  impliedTeamTotal: 4.9, hrEnvironmentTag: "HR_FRIENDLY",
})
assert(earnedLongshot.gated && earnedLongshot.additive > 0,
  `EARNED LONGSHOT (+700-class price, top-of-order, modelProb=0.18) keeps a positive additive — longshot preservation honored (got ${earnedLongshot.additive})`)

// C) Random spam (back-of-order HR + dead env + tiny modelProb) → SMALL penalty
const spam = computePlayerConviction({
  side: "over", statFamily: "home_runs",
  lineupSpot: 9, plateAppearancesProxy: 2.4, modelProb: 0.07, edge: 0.10,
  impliedTeamTotal: 3.0,
})
assert(spam.gated && spam.additive < 0,
  `RANDOM SPAM (spot=9, modelProb=0.07, dead env) produces negative additive (got ${spam.additive})`)
assert(spam.additive >= -PCE_MAX_PENALTY,
  `RANDOM SPAM penalty BOUNDED by PCE_MAX_PENALTY=${PCE_MAX_PENALTY} — never zeros longshot (got ${spam.additive})`)
recordPceStat(spam)

// D) Pitcher prop bypasses cleanly (PCE has NO opinion on pitcher dominance)
const pitcher = computePlayerConviction({
  side: "over", statFamily: "strikeouts",
  lineupSpot: null, modelProb: 0.55, edge: 0.05,
})
assert(!pitcher.gated && pitcher.additive === 0,
  "PITCHER prop bypasses PCE cleanly (gated=false, additive=0)")
recordPceStat(pitcher)

// E) Under-side bypasses cleanly (PCE is hitter-overs-only)
const under = computePlayerConviction({
  side: "under", statFamily: "hits", lineupSpot: 1, modelProb: 0.55,
})
assert(!under.gated && under.additive === 0,
  "UNDER side bypasses PCE cleanly (gated=false, additive=0)")
recordPceStat(under)

// F) Empty (no canonical signals) → neutral, no surfacing (anti-fabrication)
const empty = computePlayerConviction({ side: "over", statFamily: "home_runs" })
assert(!empty.gated && empty.additive === 0 && empty.phrase === null,
  "EMPTY (no canonical signals) → neutral, no surfacing (anti-fabrication)")
recordPceStat(empty)

// G) Counters accumulated correctly
const stats = getPceStats()
assert(stats.candidatesScored === 5,
  `recordPceStat accumulated correct candidatesScored count (got ${stats.candidatesScored}, expected 5)`)
assert(stats.earnedBoostsApplied >= 1,
  `recordPceStat accumulated earned boost(s) (got ${stats.earnedBoostsApplied})`)

// H) Determinism (replay-safe)
const a = computePlayerConviction({ side: "over", statFamily: "home_runs", lineupSpot: 3, plateAppearancesProxy: 4.2, modelProb: 0.24, edge: 0.07, impliedTeamTotal: 4.9 })
const b = computePlayerConviction({ side: "over", statFamily: "home_runs", lineupSpot: 3, plateAppearancesProxy: 4.2, modelProb: 0.24, edge: 0.07, impliedTeamTotal: 4.9 })
assert(a.factor === b.factor && a.additive === b.additive && a.phrase === b.phrase,
  "computePlayerConviction is DETERMINISTIC (same input → byte-equal output)")

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Player-Conviction-Engine-1A — PCE DRIFT + INTEGRITY DETECTOR")
console.log("Sustainable hitter legitimacy · additive small-cap · longshot-preserving")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`assertions: ${passed}/${total} PASS`)
if (failed > 0) {
  console.log("")
  console.log("FAILURES:")
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log("✓ Phase PCE-1A canonical doctrine intact")
console.log("RESULT: PASS")
process.exit(0)
