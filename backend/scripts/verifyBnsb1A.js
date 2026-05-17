"use strict"

/**
 * Phase Bettor-Native Surface Bridge — BNSB-1A — helper unit-test fixture.
 *
 * BNSB-1 through BNSB-7 + supporting backend payload propagation
 * (FE-VBI-1 / FE-VBI-2).
 *
 * Pure deterministic contract assertions on the canonical bridge surfaces.
 * NO HTTP. NO SQLite. NO ML. NO LLM. NO mutation of existing engines.
 *
 * Doctrine guarded:
 *   • BNSB-1: RecommendationLadder.tsx surfaces slot 8 (bestBelievableUpside)
 *     and slot 9 (bestExplosiveUpside) — already canonical in backend ladder.
 *   • BNSB-2: bettorRealismScore (BC-8) reaches FE inside aiSlipsSummary.
 *   • BNSB-3: bettorLanguageSummary (optional, present-only) renders on
 *             SlipCard when backend supplies it.
 *   • BNSB-4: oe1aStats / oe1bStats / bc1aStats / oe11SlipStats / mlbCovStats
 *             surface on Dashboard via IntelligenceStrip — non-zero only.
 *   • BNSB-5: reinforcement transparency ladder uses all three canonical
 *             fields: rawCombinedModelProb, calibratedCombinedModelProb,
 *             oe11ReinforcementBoost. Anti-fabrication: each renders only
 *             when backend supplies it.
 *   • BNSB-6 / FE-VBI-1..8: AnalyzeSlipView + VerdictCard render the
 *             canonical 12-field VBI verdict payload. Screenshot ingest
 *             response carries verdict + legsParsed.
 *   • BNSB-7: "Analyze Slip" nav tab wired in Workstation NAV array and
 *             section gate.
 *
 * FE-VBI-2: SHORT_SIGNAL_PHRASES sibling map exported from bettorLanguage.js,
 *           frozen, keyed by SIGNAL_IDS, with concise (≤ 50 char) phrases.
 *
 * Anti-fabrication preservation:
 *   • combineLegs slip payload back-compat: all four reinforcement fields
 *     remain on the slip object; FE renders only when Number.isFinite.
 *   • Workstation route shape additive only: existing fields preserved,
 *     aiSlipsSummary.bettorRealismScore / oe11SlipStats / mlbCovStats added.
 *   • Screenshot ingest response additive only: existing keys preserved;
 *     verdict + legsParsed added per result.
 *
 * Run via:
 *   node backend/scripts/verifyBnsb1A.js
 */

const fs   = require("fs")
const path = require("path")

const REPO       = path.join(__dirname, "..", "..")
const BACKEND    = path.join(REPO, "backend")
const FRONTEND   = path.join(REPO, "frontend", "src", "workstation")

const buildSlipAiPath        = path.join(BACKEND, "pipeline", "shared", "buildSlipAi.js")
const workstationRoutesPath  = path.join(BACKEND, "routes", "workstationRoutes.js")
const screenshotRoutesPath   = path.join(BACKEND, "pipeline", "screenshots", "screenshotRoutes.js")
const bettorLanguagePath     = path.join(BACKEND, "pipeline", "shared", "bettorLanguage.js")

const feTypesPath              = path.join(FRONTEND, "types.ts")
const feApiPath                = path.join(FRONTEND, "api.ts")
const feRecommendationLadderPath = path.join(FRONTEND, "components", "RecommendationLadder.tsx")
const feDashboardPath          = path.join(FRONTEND, "sections", "Dashboard.tsx")
const feAiSlipsViewPath        = path.join(FRONTEND, "sections", "AiSlipsView.tsx")
const feWorkstationPath        = path.join(FRONTEND, "Workstation.tsx")
const feAnalyzeSlipViewPath    = path.join(FRONTEND, "sections", "AnalyzeSlipView.tsx")
const feVerdictCardPath        = path.join(FRONTEND, "components", "VerdictCard.tsx")

const buildSlipAiSrc        = fs.readFileSync(buildSlipAiPath, "utf8")
const workstationRoutesSrc  = fs.readFileSync(workstationRoutesPath, "utf8")
const screenshotRoutesSrc   = fs.readFileSync(screenshotRoutesPath, "utf8")

const feTypesSrc                = fs.readFileSync(feTypesPath, "utf8")
const feApiSrc                  = fs.readFileSync(feApiPath, "utf8")
const feRecommendationLadderSrc = fs.readFileSync(feRecommendationLadderPath, "utf8")
const feDashboardSrc            = fs.readFileSync(feDashboardPath, "utf8")
const feAiSlipsViewSrc          = fs.readFileSync(feAiSlipsViewPath, "utf8")
const feWorkstationSrc          = fs.readFileSync(feWorkstationPath, "utf8")
const feAnalyzeSlipViewSrc      = fs.readFileSync(feAnalyzeSlipViewPath, "utf8")
const feVerdictCardSrc          = fs.readFileSync(feVerdictCardPath, "utf8")

const bettorLanguage = require(bettorLanguagePath)

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
  assert(src.indexOf(needle) !== -1, `${label} — contains "${needle.slice(0, 60)}${needle.length > 60 ? "…" : ""}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// FE-VBI-2 — SHORT_SIGNAL_PHRASES canonical sibling map
// ─────────────────────────────────────────────────────────────────────────────
{
  const { SIGNAL_IDS, SIGNAL_PHRASES, SHORT_SIGNAL_PHRASES } = bettorLanguage
  assert(SHORT_SIGNAL_PHRASES && typeof SHORT_SIGNAL_PHRASES === "object",
    "FE-VBI-2 SHORT_SIGNAL_PHRASES exported from bettorLanguage.js")
  assert(Object.isFrozen(SHORT_SIGNAL_PHRASES),
    "FE-VBI-2 SHORT_SIGNAL_PHRASES is Object.frozen (anti-mutation)")

  const allIds       = Object.values(SIGNAL_IDS)
  const shortKeys    = Object.keys(SHORT_SIGNAL_PHRASES)
  const fullKeys     = Object.keys(SIGNAL_PHRASES)
  assert(shortKeys.length === fullKeys.length,
    `FE-VBI-2 SHORT_SIGNAL_PHRASES has same cardinality as SIGNAL_PHRASES (got ${shortKeys.length}, expected ${fullKeys.length})`)
  assert(shortKeys.length === allIds.length,
    `FE-VBI-2 SHORT_SIGNAL_PHRASES covers every SIGNAL_IDS entry (got ${shortKeys.length}, expected ${allIds.length})`)

  // Every key must be a known SIGNAL_IDS value (anti-fabrication)
  const idSet = new Set(allIds)
  for (const k of shortKeys) {
    assert(idSet.has(k), `FE-VBI-2 SHORT_SIGNAL_PHRASES key ${k} traces to canonical SIGNAL_IDS`)
  }
  // Every value must be a concise non-empty string (≤ 50 chars, sibling to full sentence)
  for (const k of shortKeys) {
    const v = SHORT_SIGNAL_PHRASES[k]
    assert(typeof v === "string" && v.length > 0, `FE-VBI-2 SHORT_SIGNAL_PHRASES[${k}] is non-empty string`)
    assert(typeof v === "string" && v.length <= 50,
      `FE-VBI-2 SHORT_SIGNAL_PHRASES[${k}] ≤ 50 chars (got ${typeof v === "string" ? v.length : "n/a"})`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-5 backend — slip payload propagates reinforcement triple
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(buildSlipAiSrc,
    "rawCombinedModelProb: validCombined.rawCombinedModelProb",
    "BNSB-5 buildSlipAi propagates rawCombinedModelProb")
  contains(buildSlipAiSrc,
    "calibratedCombinedModelProb: validCombined.calibratedCombinedModelProb",
    "BNSB-5 buildSlipAi propagates calibratedCombinedModelProb")
  contains(buildSlipAiSrc,
    "oe11ReinforcementBoost:      validCombined.oe11ReinforcementBoost",
    "BNSB-5 buildSlipAi propagates oe11ReinforcementBoost")
  // combineLegs internal contract — three reinforcement fields exposed
  contains(buildSlipAiSrc,
    "calibratedCombinedModelProb: r4(calibratedModelProb)",
    "BNSB-5 combineLegs emits calibratedCombinedModelProb on result")
  contains(buildSlipAiSrc,
    "oe11ReinforcementBoost:  r4(totalBoost)",
    "BNSB-5 combineLegs emits oe11ReinforcementBoost on result")
  contains(buildSlipAiSrc,
    "rawCombinedModelProb:    r4(rawModelProb)",
    "BNSB-5 combineLegs emits rawCombinedModelProb on result")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-2 + BNSB-4 backend — aiSlipsSummary expansion
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(workstationRoutesSrc, "aiSlipsSummary: {",
    "BNSB-2/4 workstationRoutes still emits aiSlipsSummary object")
  contains(workstationRoutesSrc, "bettorRealismScore: aiSlips.bettorRealismScore",
    "BNSB-2 aiSlipsSummary carries bettorRealismScore")
  contains(workstationRoutesSrc, "oe11SlipStats: aiSlips.oe11SlipStats",
    "BNSB-4 aiSlipsSummary carries oe11SlipStats")
  contains(workstationRoutesSrc, "mlbCovStats: aiSlips.mlbCovStats",
    "BNSB-4 aiSlipsSummary carries mlbCovStats")
  contains(workstationRoutesSrc, "summary: aiSlips.summary",
    "BNSB-2/4 aiSlipsSummary preserves canonical summary (back-compat)")
  contains(workstationRoutesSrc, "warnings: aiSlips.warnings",
    "BNSB-2/4 aiSlipsSummary preserves canonical warnings (back-compat)")
}

// ─────────────────────────────────────────────────────────────────────────────
// FE-VBI-1 backend — screenshot ingest response carries verdict + legsParsed
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(screenshotRoutesSrc,
    `const { analyzeSlip }                                   = require("../shared/buildSlipAnalysis")`,
    "FE-VBI-1 screenshotRoutes imports analyzeSlip from buildSlipAnalysis")
  contains(screenshotRoutesSrc, "verdict = analyzeSlip(normalized",
    "FE-VBI-1 screenshotRoutes computes verdict via analyzeSlip")
  contains(screenshotRoutesSrc, "verdict = null",
    "FE-VBI-1 screenshotRoutes anti-fabrication — verdict=null on resolver failure")
  contains(screenshotRoutesSrc, "legsParsed:     normalized._legs",
    "FE-VBI-1 screenshotRoutes returns legsParsed for FE legIndex resolution")
  contains(screenshotRoutesSrc, "verdict,                                  // Phase BNSB-1A",
    "FE-VBI-1 screenshotRoutes returns verdict on each result")
}

// ─────────────────────────────────────────────────────────────────────────────
// FE — types.ts BNSB type additions
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feTypesSrc, "export interface Bc1aStats",
    "FE types — Bc1aStats interface")
  contains(feTypesSrc, "export interface Oe1aStats",
    "FE types — Oe1aStats interface")
  contains(feTypesSrc, "export interface Oe1bStats",
    "FE types — Oe1bStats interface")
  contains(feTypesSrc, "export interface Oe11SlipStats",
    "FE types — Oe11SlipStats interface")
  contains(feTypesSrc, "export interface MlbCovStats",
    "FE types — MlbCovStats interface")
  contains(feTypesSrc, "export interface BettorRealismScore",
    "FE types — BettorRealismScore interface")
  contains(feTypesSrc, "export interface VbiVerdict",
    "FE types — VbiVerdict canonical 12-field shape")
  contains(feTypesSrc, "export interface VbiSignal",
    "FE types — VbiSignal interface")
  contains(feTypesSrc, "export interface VbiLegRef",
    "FE types — VbiLegRef interface")
  contains(feTypesSrc, "export interface ScreenshotIngestResponse",
    "FE types — ScreenshotIngestResponse")
  contains(feTypesSrc, "export interface ScreenshotIngestResult",
    "FE types — ScreenshotIngestResult")
  contains(feTypesSrc, "calibratedCombinedModelProb?: number",
    "FE types — AiSlip.calibratedCombinedModelProb optional")
  contains(feTypesSrc, "rawCombinedModelProb?: number",
    "FE types — AiSlip.rawCombinedModelProb optional")
  contains(feTypesSrc, "oe11ReinforcementBoost?: number",
    "FE types — AiSlip.oe11ReinforcementBoost optional")
  contains(feTypesSrc, "bettorLanguageSummary?: string[]",
    "FE types — AiSlip.bettorLanguageSummary optional")
  contains(feTypesSrc, "bestBelievableUpside?: FeaturedPlay | null",
    "FE types — RecommendationLadder slot 8 (bestBelievableUpside)")
  contains(feTypesSrc, "bestExplosiveUpside?:  FeaturedPlay | null",
    "FE types — RecommendationLadder slot 9 (bestExplosiveUpside)")
  contains(feTypesSrc, "bettorRealismScore?: BettorRealismScore | null",
    "FE types — SportState.aiSlipsSummary.bettorRealismScore")
  contains(feTypesSrc, "oe11SlipStats?: Oe11SlipStats",
    "FE types — SportState.aiSlipsSummary.oe11SlipStats")
  contains(feTypesSrc, "mlbCovStats?: MlbCovStats",
    "FE types — SportState.aiSlipsSummary.mlbCovStats")
  contains(feTypesSrc, "bc1aStats?: Bc1aStats",
    "FE types — Featured.bc1aStats")
  contains(feTypesSrc, "oe1aStats?: Oe1aStats",
    "FE types — Featured.oe1aStats")
  contains(feTypesSrc, "oe1bStats?: Oe1bStats",
    "FE types — Featured.oe1bStats")
}

// ─────────────────────────────────────────────────────────────────────────────
// FE — api.ts screenshotsAnalyze method
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feApiSrc, "screenshotsAnalyze:",
    "FE api — screenshotsAnalyze method")
  contains(feApiSrc, "/api/ws/screenshots/ingest",
    "FE api — screenshotsAnalyze targets canonical ingest route")
  contains(feApiSrc, "ScreenshotIngestResponse",
    "FE api — screenshotsAnalyze returns canonical ScreenshotIngestResponse type")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1 — RecommendationLadder slot 8 + 9
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feRecommendationLadderSrc, "bestBelievableUpside",
    "BNSB-1 RecommendationLadder consumes bestBelievableUpside")
  contains(feRecommendationLadderSrc, "bestExplosiveUpside",
    "BNSB-1 RecommendationLadder consumes bestExplosiveUpside")
  contains(feRecommendationLadderSrc, "BELIEVABLE UPSIDE",
    "BNSB-1 RecommendationLadder labels slot 8 BELIEVABLE UPSIDE")
  contains(feRecommendationLadderSrc, "EXPLOSIVE UPSIDE",
    "BNSB-1 RecommendationLadder labels slot 9 EXPLOSIVE UPSIDE")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-2 + BNSB-4 — Dashboard IntelligenceStrip
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feDashboardSrc, "function IntelligenceStrip",
    "BNSB-2/4 Dashboard defines IntelligenceStrip component")
  contains(feDashboardSrc, "<IntelligenceStrip",
    "BNSB-2/4 Dashboard renders IntelligenceStrip in main layout")
  contains(feDashboardSrc, "bettorRealismScore={state.aiSlipsSummary?.bettorRealismScore",
    "BNSB-2 IntelligenceStrip receives bettorRealismScore prop")
  contains(feDashboardSrc, "bc1aStats={featured?.bc1aStats}",
    "BNSB-4 IntelligenceStrip receives bc1aStats prop")
  contains(feDashboardSrc, "oe1aStats={featured?.oe1aStats}",
    "BNSB-4 IntelligenceStrip receives oe1aStats prop")
  contains(feDashboardSrc, "oe1bStats={featured?.oe1bStats}",
    "BNSB-4 IntelligenceStrip receives oe1bStats prop")
  contains(feDashboardSrc, "oe11SlipStats={state.aiSlipsSummary?.oe11SlipStats}",
    "BNSB-4 IntelligenceStrip receives oe11SlipStats prop")
  contains(feDashboardSrc, "mlbCovStats={state.aiSlipsSummary?.mlbCovStats}",
    "BNSB-4 IntelligenceStrip receives mlbCovStats prop")
  // Anti-fabrication: counter chips only render when value > 0 (truthy guard)
  contains(feDashboardSrc, "if (oe1aStats?.explosiveEventsTagged)",
    "BNSB-4 IntelligenceStrip only renders explosive-events chip when > 0")
  contains(feDashboardSrc, "if (mlbCovStats?.blockedSharedGameSuppression)",
    "BNSB-4 IntelligenceStrip only renders shared-game-blocks chip when > 0")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-3 + BNSB-5 — AiSlipsView SlipCard extensions
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feAiSlipsViewSrc, "bettorLanguageSummary",
    "BNSB-3 AiSlipsView surfaces bettorLanguageSummary")
  contains(feAiSlipsViewSrc, "hasReinforcement",
    "BNSB-5 AiSlipsView gates reinforcement ladder rendering")
  contains(feAiSlipsViewSrc, "calibratedCombinedModelProb",
    "BNSB-5 AiSlipsView surfaces calibratedCombinedModelProb")
  contains(feAiSlipsViewSrc, "oe11ReinforcementBoost",
    "BNSB-5 AiSlipsView surfaces oe11ReinforcementBoost")
  contains(feAiSlipsViewSrc, "rawCombinedModelProb",
    "BNSB-5 AiSlipsView surfaces rawCombinedModelProb")
  contains(feAiSlipsViewSrc, "Number.isFinite",
    "BNSB-5 AiSlipsView guards reinforcement render with Number.isFinite (anti-fabrication)")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-6 + BNSB-7 — AnalyzeSlipView + VerdictCard + nav wiring
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feAnalyzeSlipViewSrc, "export function AnalyzeSlipView",
    "BNSB-6 AnalyzeSlipView component exists")
  contains(feAnalyzeSlipViewSrc, `import { VerdictCard } from "../components/VerdictCard"`,
    "BNSB-6 AnalyzeSlipView imports VerdictCard")
  contains(feAnalyzeSlipViewSrc, "api.screenshotsAnalyze",
    "BNSB-6 AnalyzeSlipView calls api.screenshotsAnalyze (pure pass-through)")
  // Anti-fabrication: frontend does no slip parsing — defers to backend resolver
  contains(feAnalyzeSlipViewSrc, "rawText: raw",
    "BNSB-6 AnalyzeSlipView free-text path defers to backend (rawText only, no FE parsing)")

  contains(feVerdictCardSrc, "export function VerdictCard",
    "BNSB-6 VerdictCard component exists")
  // Anti-fabrication: each canonical field gated on presence
  contains(feVerdictCardSrc, "verdict.verdictSummary",
    "BNSB-6 VerdictCard renders canonical verdictSummary")
  contains(feVerdictCardSrc, "verdict.ecologicalCoherence",
    "BNSB-6 VerdictCard renders canonical ecologicalCoherence")
  contains(feVerdictCardSrc, "verdict.strongestLeg",
    "BNSB-6 VerdictCard renders canonical strongestLeg")
  contains(feVerdictCardSrc, "verdict.weakestLeg",
    "BNSB-6 VerdictCard renders canonical weakestLeg")
  contains(feVerdictCardSrc, "covarianceProfile",
    "BNSB-6 VerdictCard renders canonical covarianceProfile")
  contains(feVerdictCardSrc, "exploitabilityProfile",
    "BNSB-6 VerdictCard renders canonical exploitabilityProfile")
  contains(feVerdictCardSrc, "availabilityProfile",
    "BNSB-6 VerdictCard renders canonical availabilityProfile")
  contains(feVerdictCardSrc, "fakeSafeRisk",
    "BNSB-6 VerdictCard renders canonical fakeSafeRisk")
  contains(feVerdictCardSrc, "unresolvedLegs",
    "BNSB-6 VerdictCard renders canonical unresolvedLegs (anti-fabrication transparency)")
  contains(feVerdictCardSrc, "bettorLanguageSummary",
    "BNSB-6 VerdictCard renders canonical bettorLanguageSummary phrases")
  contains(feVerdictCardSrc, "contradictionFlags",
    "BNSB-6 VerdictCard renders canonical contradictionFlags")
  contains(feVerdictCardSrc, "verdict.signals",
    "BNSB-6 VerdictCard renders canonical raw signals strip")
  contains(feVerdictCardSrc, "(none surfaced)",
    "BNSB-6 VerdictCard uses honest empty-state copy (never fabricated)")

  contains(feWorkstationSrc, `import { AnalyzeSlipView } from "./sections/AnalyzeSlipView"`,
    "BNSB-7 Workstation imports AnalyzeSlipView")
  // Note: Phase BNDS-1A renamed the NAV label "Analyze Slip" → "Check My Slip"
  //       for consistency with the section header (h2 said "Check My Slip"
  //       since BNSB-1B-1). The tab routing key ("analyze") + icon (📸) are
  //       preserved verbatim; only the display string evolved.
  contains(feWorkstationSrc, `{ id: "analyze",   label: "Check My Slip",    icon: "📸" }`,
    "BNSB-7 Workstation NAV array includes Analyze tab (BNDS-1A re-toned label 'Check My Slip')")
  // Note: BNSB-1B (BNSB-1B-8) expanded the section gate to multi-line JSX so it
  //       can pass pendingSlip / onPendingConsumed / onNavigate props. The gate
  //       still renders AnalyzeSlipView when section === "analyze".
  contains(feWorkstationSrc, `section === "analyze"`,
    "BNSB-7 Workstation section router still gates on section === 'analyze'")
  contains(feWorkstationSrc, "<AnalyzeSlipView",
    "BNSB-7 Workstation still renders <AnalyzeSlipView /> in the analyze gate (BNSB-1B expanded to multi-line)")
  // SectionId union includes 'analyze' — anti-regression on type safety
  contains(feWorkstationSrc, `| "analyze"`,
    "BNSB-7 Workstation SectionId union includes 'analyze'")
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-fabrication sentinels — frontend never invents a verdict / score
// ─────────────────────────────────────────────────────────────────────────────
{
  // BNSB-1B re-toned the anti-fabrication empty-state copy from engineer-speak
  // to bettor-native phrasing. The invariant ("honestly reports absent X — no
  // synthesis") is preserved; the literal strings evolved per BNSB-1B-10.
  contains(feVerdictCardSrc, "didn't return a verdict for this slip",
    "Anti-fabrication: VerdictCard honestly reports absent verdict (BNSB-1B re-toned bettor-native)")
  contains(feDashboardSrc, "no canonical-signal events surfaced",
    "Anti-fabrication: IntelligenceStrip honestly reports empty payload (BNSB-1B re-toned to bettor-native sentence)")
  contains(feAnalyzeSlipViewSrc, "I couldn't read that one",
    "Anti-fabrication: AnalyzeSlipView honestly reports absent results (BNSB-1B-10 bettor-native first-person copy)")
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Bettor-Native Surface Bridge — BNSB-1A HELPER UNIT TEST")
console.log("BNSB-1 + BNSB-2 + BNSB-3 + BNSB-4 + BNSB-5 + BNSB-6 + BNSB-7")
console.log("Supporting backend: FE-VBI-1 (screenshot ingest) + FE-VBI-2 (SHORT_SIGNAL_PHRASES)")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`BNSB-1 (RecommendationLadder slots 8+9) : canonical bridge to bestBelievableUpside/bestExplosiveUpside`)
console.log(`BNSB-2 (bettorRealismScore badge)       : BC-8 surfaced as Dashboard advisory pill`)
console.log(`BNSB-3 (bettorLanguageSummary)          : optional VBI phrases on SlipCard`)
console.log(`BNSB-4 (intelligence accounting strip)  : oe1a/oe1b/bc1a/oe11/mlb-cov counters`)
console.log(`BNSB-5 (reinforcement transparency)     : raw → calibrated → reinforced ladder on SlipCard`)
console.log(`BNSB-6 (AnalyzeSlipView + VerdictCard)  : 12-field canonical verdict render; pure passthrough`)
console.log(`BNSB-7 (Analyze Slip nav tab)           : Workstation NAV + section gate`)
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
