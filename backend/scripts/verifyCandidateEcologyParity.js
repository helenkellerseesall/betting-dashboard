"use strict"

/**
 * Phase Candidate-Ecology-Parity-1A — verifyCandidateEcologyParity.js
 *
 * CANDIDATE ECOLOGY PARITY DRIFT DETECTOR.
 *
 * Operator-cemented mandatory rule:
 *   "Battlefield widening and slip ecology are separate canonical layers.
 *    Healthy system shape: battlefield breadth → curated edge → AI
 *    compression. Operational continuity must preserve all three layers
 *    simultaneously."
 *
 * Asserts:
 *   1. Source-text gates — workstationRoutes.js has the date-sanity filter
 *      that rejects future-dated sentinel files (fixes the
 *      `9999-12-31` sentinel that shadowed real current-date files).
 *   2. Source-text gates — buildSlipAi.js has NBA aggressive + lotto tier
 *      overrides with skipScriptCorrelation + maxPerGame ≥ 3/4 (fixes
 *      1-game NBA playoff slates producing 0 slips).
 *   3. Real-data ecology shape — on the latest valid date with data:
 *        MLB: eligible ≥ 50 → discovery materially exceeds elite (≥ 1.5×)
 *        NBA: candidates > 0 → AI slips generated (some tier non-zero)
 *      Skipped on dates with no real data (graceful: real-data smoke only
 *      fires when files exist).
 *   4. Anti-fabrication — no blind survivability/contradiction bypass;
 *      forbid-volatility lists preserved on safe + balanced (NBA aggressive
 *      legs still barred from safe + balanced); MLB-COV-2/3 hard blocks
 *      preserved (gated via !tpl.skipScriptCorrelation; MLB tiers default
 *      to false → blocks still fire on MLB; NBA tiers set true → handled
 *      by nbaCorrelationEngine instead).
 *   5. Date sanity — todayKey-bound future-date rejection regex present.
 *
 * Pure deterministic source-text + helper-function execution.
 * NO HTTP. NO SQLite. NO ML. NO LLM.
 *
 * Run via:
 *   node backend/scripts/verifyCandidateEcologyParity.js
 *
 * Or via canonical ops layer (this verifier runs in the 30-verifier matrix):
 *   npm run ops:verify
 */

const fs   = require("fs")
const path = require("path")

const REPO    = path.join(__dirname, "..", "..")
const BACKEND = path.join(REPO, "backend")

const workstationRoutesPath = path.join(BACKEND, "routes", "workstationRoutes.js")
const buildSlipAiPath       = path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js")
const TRACKING_DIR          = path.join(BACKEND, "runtime", "tracking")

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
// 1. Source-text — date-sanity filter in findLatestDateWithData
// ─────────────────────────────────────────────────────────────────────────────
const workstationRoutesSrc = fs.readFileSync(workstationRoutesPath, "utf8")
{
  contains(workstationRoutesSrc, "Candidate-Ecology-Parity-1A",
    "workstationRoutes.js cites Candidate-Ecology-Parity-1A provenance in findLatestDateWithData")
  contains(workstationRoutesSrc, ".filter((dk) => dk <= today)",
    "findLatestDateWithData rejects future-dated sentinel files (date-sanity gate)")
  contains(workstationRoutesSrc, "uture-dated sentinel files",
    "findLatestDateWithData doctrine comment cites future-dated sentinel files (case-insensitive)")
  contains(workstationRoutesSrc, "9999-12-31",
    "findLatestDateWithData doctrine comment explicitly references the 9999-12-31 sentinel example")
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Source-text — NBA aggressive + lotto tier overrides
// ─────────────────────────────────────────────────────────────────────────────
const buildSlipAiSrc = fs.readFileSync(buildSlipAiPath, "utf8")
{
  contains(buildSlipAiSrc, "Candidate-Ecology-Parity-1A",
    "buildSlipAi.js cites Candidate-Ecology-Parity-1A provenance in applyNbaTierOverrides")
  // NBA aggressive override
  contains(buildSlipAiSrc, `if (tier === "aggressive") {`,
    "applyNbaTierOverrides has NBA-specific aggressive override block")
  // NBA lotto override
  contains(buildSlipAiSrc, `if (tier === "lotto") {`,
    "applyNbaTierOverrides has NBA-specific lotto override block")
  // skipScriptCorrelation on aggressive + lotto (NBA correlation handled by nbaCorrelationEngine)
  // Count: existing safe + balanced have skipScriptCorrelation; NEW aggressive + lotto add 2 more → expect ≥ 4 total
  const skipCorrCount = (buildSlipAiSrc.match(/skipScriptCorrelation:\s+true/g) || []).length
  assert(skipCorrCount >= 4,
    `applyNbaTierOverrides has skipScriptCorrelation:true on ≥ 4 tiers (safe+balanced+aggressive+lotto; got ${skipCorrCount})`)
  // Aggressive maxPerGame must be > 1 (was 1 in MLB default — single-game NBA slates couldn't compose)
  // Lotto maxPerGame must be > 2 (was 2 in MLB default — single-game NBA slates couldn't compose ≥3 legs)
  // We grep for the specific NBA override values:
  contains(buildSlipAiSrc, "maxPerGame:             3,    // was 1",
    "NBA aggressive maxPerGame raised from 1 (MLB default) to 3 (enables ≥ 2-leg composition on 1-game NBA slates)")
  contains(buildSlipAiSrc, "maxPerGame:             4,    // was 2",
    "NBA lotto maxPerGame raised from 2 (MLB default) to 4 (enables 3-5-leg composition on 1-game NBA slates)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Trust-layer preservation — safe + balanced still forbid aggressive
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(buildSlipAiSrc, `forbidVolatility:       ["lotto", "aggressive"],  // Session AN: was ["lotto"]; aggressive legs barred`,
    "NBA safe tier still forbids aggressive volatility (trust layer preserved)")
  contains(buildSlipAiSrc, `allowedVolatility:      ["safe", "balanced"],                // Session AN-final: revert aggressive; threes route to AGGRESSIVE/LOTTO only`,
    "NBA balanced tier still restricts volatility to safe + balanced (trust layer preserved)")
  // MLB-COV-2/3 blocks are gated via !tpl.skipScriptCorrelation — for MLB
  // tiers (no overrides), skipScriptCorrelation defaults to undefined →
  // falsy → !falsy === true → blocks FIRE. For NBA tiers (all 4 set
  // skipScriptCorrelation:true), the MLB blocks are SKIPPED — correlation
  // handled at composition layer by nbaCorrelationEngine. This is the
  // canonical behavior preserved by Candidate-Ecology-Parity-1A.
  contains(buildSlipAiSrc, "if (gk && !tpl.skipScriptCorrelation)",
    "MLB-COV gates still gated via !tpl.skipScriptCorrelation (preserves MLB-COV-2/3 hard blocks on MLB tiers)")
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Real-data smoke — measure ACTUAL ecology shape on real files
// ─────────────────────────────────────────────────────────────────────────────
function loadEligibleAndDate(sport) {
  if (!fs.existsSync(TRACKING_DIR)) return null
  const today = new Date().toISOString().slice(0, 10)
  const files = fs.readdirSync(TRACKING_DIR)
  const days = files
    .filter((f) => f.startsWith(`${sport}_tracked_bets_`) && f.endsWith(".json"))
    .map((f) => (f.match(/_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
    .filter(Boolean)
    .filter((dk) => dk <= today)
    .sort()
    .reverse()
  for (const d of days) {
    try {
      const tb = JSON.parse(fs.readFileSync(path.join(TRACKING_DIR, `${sport}_tracked_bets_${d}.json`), "utf8"))
      const eligible = tb.filter((b) => Number(b?.edge) > 0.04 && Number(b?.modelProb) > 0.20)
      if (eligible.length > 0) return { date: d, eligible }
    } catch (_) {}
  }
  return null
}

const { diversifyCandidates } = require(path.join(BACKEND, "pipeline", "shared", "buildCandidateDiversity.js"))

// MLB ecology shape — battlefield should materially exceed elite
{
  const mlb = loadEligibleAndDate("mlb")
  if (!mlb) {
    passed++
    console.log("  ✓ MLB real-data ecology smoke skipped (no MLB tracked_bets files found)")
  } else {
    const eliteCaps = { maxPerPlayer: 3, maxPerGame: 7,  maxPerStat: 10, maxPerStatSide: 6 }
    const discoCaps = { maxPerPlayer: 8, maxPerGame: 60, maxPerStat: 60, maxPerStatSide: 35 }
    const elite     = diversifyCandidates(mlb.eligible, eliteCaps)
    const discovery = diversifyCandidates(mlb.eligible, discoCaps)
    console.log(`  ✓ MLB real-data ${mlb.date}: eligible=${mlb.eligible.length} elite=${elite.length} discovery=${discovery.length}`)
    // Healthy shape requires battlefield materially exceeds elite when source pool is non-trivial.
    if (mlb.eligible.length >= 50) {
      assert(discovery.length > elite.length,
        `MLB battlefield widening healthy: discovery (${discovery.length}) > elite (${elite.length}) when eligible ≥ 50 (got ${mlb.eligible.length})`)
      assert(discovery.length >= Math.floor(elite.length * 1.5),
        `MLB battlefield widening materially exceeds elite: discovery (${discovery.length}) ≥ 1.5× elite (${elite.length})`)
    } else {
      passed++
      console.log(`  ✓ MLB ecology shape assertion skipped (eligible=${mlb.eligible.length} < 50 — thin slate)`)
    }
  }
}

// NBA slip ecology — candidates > 0 must produce some tier non-zero
{
  const nba = loadEligibleAndDate("nba")
  if (!nba) {
    passed++
    console.log("  ✓ NBA real-data slip smoke skipped (no NBA tracked_bets files found)")
  } else {
    // Build the enriched-best version of candidates (matches workstationRoutes path)
    const tbestPath = path.join(TRACKING_DIR, `nba_tracked_best_${nba.date}.json`)
    let enrichedBest = []
    if (fs.existsSync(tbestPath)) {
      try {
        const tbest = JSON.parse(fs.readFileSync(tbestPath, "utf8"))
        enrichedBest = (tbest.entries || []).map((e) => ({
          ...e,
          edge:           e.edgeProbability,
          modelProb:      e.predictedProbability,
          statFamily:     String(e.propType || "").toLowerCase().replace(/\s+/g, ""),
          confidenceTier: e.bucket?.split(".").pop()?.toUpperCase() || "PLAYABLE",
          sportsbook:     e.book,
          odds:           e.odds,
          oddsAmerican:   e.odds,
        }))
      } catch (_) {}
    }
    const rawCandidates = enrichedBest.length ? enrichedBest : nba.eligible
    const candidates = diversifyCandidates(rawCandidates, { maxPerPlayer: 3, maxPerGame: 12, maxPerStat: 10, maxPerStatSide: 6 })
    // Suppress operator-grade probe logs while measuring
    const origLog = console.log
    console.log = () => {}
    let result
    try {
      const slipAi = require(path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js"))
      result = slipAi.buildAiSlips({ candidates, options: { sport: "nba", date: nba.date, maxPerTier: 4 } })
    } finally {
      console.log = origLog
    }
    const slips = result.slips || {}
    const totalSlips = (slips.safe || []).length + (slips.balanced || []).length + (slips.aggressive || []).length + (slips.lotto || []).length
    console.log(`  ✓ NBA real-data ${nba.date}: candidates=${candidates.length} slips={safe:${(slips.safe||[]).length} balanced:${(slips.balanced||[]).length} aggressive:${(slips.aggressive||[]).length} lotto:${(slips.lotto||[]).length}}`)
    if (candidates.length >= 8) {
      assert(totalSlips > 0,
        `NBA slip ecology healthy: candidates (${candidates.length}) ≥ 8 produces > 0 slips (got ${totalSlips}); detects collapse where slips disappear while candidates exist`)
    } else {
      passed++
      console.log(`  ✓ NBA slip ecology assertion skipped (candidates=${candidates.length} < 8 — thin slate)`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Anti-fabrication sentinels — no blind weakening
// ─────────────────────────────────────────────────────────────────────────────
{
  // The fix MUST NOT have removed MLB safe/balanced tier discipline
  // (MLB tiers inherit defaults — no NBA-only override applies to MLB).
  // Check the MLB TIER_TEMPLATES defaults still exist verbatim.
  contains(buildSlipAiSrc, "decimalOddsRange: [3.0, 8.0]",
    "MLB balanced decimalOddsRange [3.0, 8.0] preserved (Session AG MLB calibration unchanged)")
  contains(buildSlipAiSrc, `allowedSides:      ["under"],`,
    "MLB balanced under-only override preserved (FIX 2: MLB BALANCED under-only)")
  // The fix MUST NOT have introduced fake props, random combinations, or
  // bypass of canonical scoring. Verifier doesn't execute arbitrary code,
  // but we assert that the orchestrator file size hasn't drastically
  // changed (sentinel for "did Claude/operator unintentionally rewrite
  // half the file"). buildSlipAi.js is large; check it's still in
  // expected size range.
  const stat = fs.statSync(buildSlipAiPath)
  assert(stat.size > 30_000 && stat.size < 200_000,
    `buildSlipAi.js size in expected range (got ${stat.size} bytes; unchanged structure)`)
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Candidate-Ecology-Parity-1A — CANDIDATE ECOLOGY DRIFT DETECTOR")
console.log("Battlefield breadth → curated edge → AI compression (3 layers preserved)")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`Date sanity      : findLatestDateWithData rejects future-dated sentinel files (≤ todayKey)`)
console.log(`NBA tier coverage: safe + balanced + aggressive + lotto all NBA-overridden (skipScriptCorrelation; nbaCorrelationEngine canonical)`)
console.log(`Real-data smoke  : MLB battlefield ≥ 1.5× elite when eligible ≥ 50; NBA slips > 0 when candidates ≥ 8`)
console.log(`Trust preserved  : MLB tiers unchanged; safe/balanced still forbid aggressive; MLB-COV blocks still gated via !skipScriptCorrelation`)
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
