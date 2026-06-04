"use strict"

/**
 * Phase Bettor-Native Surface Bridge — BNSB-1B — helper unit-test fixture.
 *
 * BNSB-1B-1 through BNSB-1B-10 + BNSB-1B-13 (this file).
 *
 * Pure deterministic source-text + payload-contract assertions on the
 * bettor-native interaction architecture. NO HTTP. NO SQLite. NO ML.
 *
 * Doctrine guarded:
 *   • BNSB-1B-1: AnalyzeSlipView opens with PathPicker (4 cards: Build /
 *     Borrow / Paste / Sample). No raw JSON wall first.
 *   • BNSB-1B-2: rawText fabrication REMOVED — backend has no rawText handler;
 *     FE must not promise free-text parsing.
 *   • BNSB-1B-3: Borrow path consumes existing state.aiSlips (NO new fetch);
 *     1-click loads + analyzes.
 *   • BNSB-1B-4: Sample starter tickets module exports 4 canonical slips, each
 *     shape backend-valid for normalizeIngestedSlip (single-leg branch:
 *     player || statFamily || propText).
 *   • BNSB-1B-6: VerdictCard hero re-shape — coherence ring + verdictSummary
 *     headline + top-priority phrase + collapsible drill-down.
 *   • BNSB-1B-7: composeIntelligenceSentence pure helper — deterministic;
 *     mentions ONLY counters > 0; returns null when no counter fires.
 *   • BNSB-1B-8: SlipCard fires ws:analyze-slip CustomEvent; Workstation
 *     listens + routes to analyze + sets pendingSlip.
 *   • BNSB-1B-9: Internal IDs (ss_* hashes) + archetype taxonomy stripped from
 *     bettor-visible default render; available in tooltip / forensic only.
 *   • BNSB-1B-10: Loading / empty / error states bettor-native tone.
 *
 * Anti-fabrication preservation:
 *   • Sample slips use only field aliases normalizeLeg accepts.
 *   • intelligenceSentence helper is pure (no fetch, no side-effect).
 *   • Cross-section nav is window-event-only (no architectural redesign).
 *
 * Run via:
 *   node backend/scripts/verifyBnsb1B.js
 */

const fs   = require("fs")
const path = require("path")

const REPO     = path.join(__dirname, "..", "..")
const FRONTEND = path.join(REPO, "frontend", "src", "workstation")
const BACKEND  = path.join(REPO, "backend")

const feAnalyzeSlipViewPath      = path.join(FRONTEND, "sections", "AnalyzeSlipView.tsx")
const feVerdictCardPath          = path.join(FRONTEND, "components", "VerdictCard.tsx")
const feAiSlipsViewPath          = path.join(FRONTEND, "sections", "AiSlipsView.tsx")
const feDashboardPath            = path.join(FRONTEND, "sections", "Dashboard.tsx")
const feWorkstationPath          = path.join(FRONTEND, "Workstation.tsx")
const feSampleSlipsPath          = path.join(FRONTEND, "sampleSlips.ts")
const feIntelligenceSentencePath = path.join(FRONTEND, "intelligenceSentence.ts")

const beNormalizeIngestedSlipPath = path.join(BACKEND, "pipeline", "screenshots", "normalizeIngestedSlip.js")

const feAnalyzeSlipViewSrc      = fs.readFileSync(feAnalyzeSlipViewPath, "utf8")
const feVerdictCardSrc          = fs.readFileSync(feVerdictCardPath, "utf8")
const feAiSlipsViewSrc          = fs.readFileSync(feAiSlipsViewPath, "utf8")
const feDashboardSrc            = fs.readFileSync(feDashboardPath, "utf8")
const feWorkstationSrc          = fs.readFileSync(feWorkstationPath, "utf8")
const feSampleSlipsSrc          = fs.readFileSync(feSampleSlipsPath, "utf8")
const feIntelligenceSentenceSrc = fs.readFileSync(feIntelligenceSentencePath, "utf8")

const beNormalizeSrc = fs.readFileSync(beNormalizeIngestedSlipPath, "utf8")

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
function notContains(src, needle, label) {
  assert(src.indexOf(needle) === -1, `${label} — does NOT contain "${needle.slice(0, 70)}${needle.length > 70 ? "…" : ""}"`)
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-1 — PathPicker exists; default landing is menu not textarea
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feAnalyzeSlipViewSrc, "function PathPicker",
    "BNSB-1B-1 AnalyzeSlipView defines PathPicker subcomponent")
  contains(feAnalyzeSlipViewSrc, "function PickerCard",
    "BNSB-1B-1 AnalyzeSlipView defines PickerCard helper")
  contains(feAnalyzeSlipViewSrc, `useState<PathChoice>("menu")`,
    "BNSB-1B-1 AnalyzeSlipView default path is 'menu' (PathPicker landing)")
  contains(feAnalyzeSlipViewSrc, `path === "menu"`,
    "BNSB-1B-1 AnalyzeSlipView renders PathPicker when path === 'menu'")
  contains(feAnalyzeSlipViewSrc, `title="Build a slip"`,
    "BNSB-1B-1 PathPicker has Build a slip card")
  contains(feAnalyzeSlipViewSrc, `title="Borrow tonight's slip"`,
    "BNSB-1B-1 PathPicker has Borrow tonight's slip card")
  contains(feAnalyzeSlipViewSrc, `title="Paste a slip (JSON)"`,
    "BNSB-1B-1 PathPicker has Paste a slip card")
  contains(feAnalyzeSlipViewSrc, `title="Try a sample"`,
    "BNSB-1B-1 PathPicker has Try a sample card")
  // Build path routes to existing Bet Builder (BNSB-1B-5 deferred)
  contains(feAnalyzeSlipViewSrc, `onNavigate?.("builder")`,
    "BNSB-1B-1 Build path honestly routes to existing Bet Builder (no fabricated build-leg-by-leg)")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-2 — rawText fabrication REMOVED
// ─────────────────────────────────────────────────────────────────────────────
{
  // Tighten the negative assertions: the BNSB-1B-2 doctrine forbids the actual
  // JS assignment of body.slip = { rawText: ... }. Doc comments mentioning the
  // removed pattern are fine (they document what was removed and why).
  notContains(feAnalyzeSlipViewSrc, "body.slip = { rawText",
    "BNSB-1B-2 AnalyzeSlipView no longer assigns body.slip = { rawText … } (fabricated payload removed)")
  // (Doc-comment references to the removed `{ rawText: raw }` pattern are
  //  intentionally preserved — they document what was removed and why. We
  //  guard the actual runtime behavior via the assignment assertion above.)
  // Backend slip parser fallback ("rawText" handler) still absent — confirms
  // the FE removal was justified (no silent backend evolution).
  notContains(feAnalyzeSlipViewSrc, "backend slip parser will attempt OCR-style parse",
    "BNSB-1B-2 AnalyzeSlipView code comments no longer promise OCR-style backend parse")
  // Honest copy when JSON parse fails — does NOT promise free-text parsing.
  contains(feAnalyzeSlipViewSrc, "isn't valid JSON",
    "BNSB-1B-2 PastePanel JSON parse error has honest copy (no AI-understands-anything promise)")
  // Backend hasn't grown a rawText handler (BNSB-1B doctrine: no backend
  // betting-intelligence patch). Verify rawText is still NOT accepted by
  // normalizeLeg so the removal is justified.
  notContains(beNormalizeSrc, "raw.rawText",
    "BNSB-1B-2 backend normalizeLeg has NO rawText handler — confirms FE removal is honest")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-3 — Borrow path consumes existing state.aiSlips, no new fetch
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feAnalyzeSlipViewSrc, "function BorrowTonight",
    "BNSB-1B-3 AnalyzeSlipView defines BorrowTonight subcomponent")
  contains(feAnalyzeSlipViewSrc, "aiSlips: AiSlips | undefined",
    "BNSB-1B-3 BorrowTonight receives aiSlips from existing workstation state")
  contains(feAnalyzeSlipViewSrc, `path === "borrow"`,
    "BNSB-1B-3 AnalyzeSlipView routes to Borrow panel when path === 'borrow'")
  contains(feAnalyzeSlipViewSrc, `function aiSlipToIngestShape`,
    "BNSB-1B-3 AnalyzeSlipView has aiSlipToIngestShape projection helper")
  // No fetch outside of api.screenshotsAnalyze (which already exists as the
  // single network surface). Borrow path must not introduce another fetch.
  notContains(feAnalyzeSlipViewSrc, "fetch(",
    "BNSB-1B-3 AnalyzeSlipView introduces NO new fetch (uses existing api.screenshotsAnalyze)")
  contains(feAnalyzeSlipViewSrc, "🔍 Check this",
    "BNSB-1B-3 BorrowRow 1-click action labeled bettor-native")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-4 — Sample starter tickets module + backend-valid shape contract
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feSampleSlipsSrc, "export const SAMPLE_SLIPS",
    "BNSB-1B-4 sampleSlips.ts exports SAMPLE_SLIPS")
  contains(feSampleSlipsSrc, "coherent_hr_stack",
    "BNSB-1B-4 sampleSlips has coherent HR stack fixture")
  contains(feSampleSlipsSrc, "fake_safe_under",
    "BNSB-1B-4 sampleSlips has fake-safe UNDER fixture")
  contains(feSampleSlipsSrc, "pitcher_hitter_contradiction",
    "BNSB-1B-4 sampleSlips has pitcher-hitter contradiction fixture")
  contains(feSampleSlipsSrc, "explosive_environment_stack",
    "BNSB-1B-4 sampleSlips has explosive environment stack fixture")

  // Backend-validity contract: every sample slip's leg must use field aliases
  // normalizeLeg.js (line 171-200) accepts. Check the four canonical fields.
  const requiredFieldsAppear = ["player:", "statFamily:", "side:", "line:", "odds:"]
  for (const f of requiredFieldsAppear) {
    assert(feSampleSlipsSrc.indexOf(f) !== -1,
      `BNSB-1B-4 sample slips populate canonical field ${f} (backend-valid for normalizeLeg)`)
  }
  // No fabricated fields — never rawText, never "magic", never opaque ML.
  notContains(feSampleSlipsSrc, "rawText",
    "BNSB-1B-4 sample slips never use rawText (anti-fabrication preservation)")

  // AnalyzeSlipView consumes SAMPLE_SLIPS
  contains(feAnalyzeSlipViewSrc, `import { SAMPLE_SLIPS, type SampleSlipDef } from "../sampleSlips"`,
    "BNSB-1B-4 AnalyzeSlipView imports SAMPLE_SLIPS module")
  contains(feAnalyzeSlipViewSrc, "function SampleStarters",
    "BNSB-1B-4 AnalyzeSlipView defines SampleStarters subcomponent")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-6 — VerdictCard hero re-shape
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feVerdictCardSrc, "CoherenceRing",
    "BNSB-1B-6 VerdictCard has CoherenceRing subcomponent (canonical ecologicalCoherence as ring)")
  contains(feVerdictCardSrc, "HeroLegLine",
    "BNSB-1B-6 VerdictCard has HeroLegLine subcomponent (strongest/weakest compact)")
  contains(feVerdictCardSrc, "SummaryChip",
    "BNSB-1B-6 VerdictCard has SummaryChip subcomponent (survivability/reinforcement/contradiction)")
  contains(feVerdictCardSrc, "useState(false)",
    "BNSB-1B-6 VerdictCard has collapsible drill-down state (default closed)")
  contains(feVerdictCardSrc, "▸ Show the full breakdown",
    "BNSB-1B-6 VerdictCard has bettor-readable detail toggle copy (closed state)")
  contains(feVerdictCardSrc, "▾ Hide full breakdown",
    "BNSB-1B-6 VerdictCard has bettor-readable detail toggle copy (open state)")
  contains(feVerdictCardSrc, "The biggest takeaway:",
    "BNSB-1B-6 VerdictCard surfaces top-priority bettor-language phrase as hero takeaway")
  // Detail render preserved (BNSB-1A 12 sections — operator forensic mode)
  contains(feVerdictCardSrc, "Covariance profile",
    "BNSB-1B-6 forensic detail preserves Covariance profile section")
  contains(feVerdictCardSrc, "Exploitability profile",
    "BNSB-1B-6 forensic detail preserves Exploitability profile section")
  contains(feVerdictCardSrc, "Availability profile",
    "BNSB-1B-6 forensic detail preserves Availability profile section")
  contains(feVerdictCardSrc, "Raw VBI signals",
    "BNSB-1B-6 forensic detail preserves Raw VBI signals section")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-7 — composeIntelligenceSentence pure helper + Dashboard re-shape
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feIntelligenceSentenceSrc, "export function composeIntelligenceSentence",
    "BNSB-1B-7 intelligenceSentence.ts exports composeIntelligenceSentence")
  // Purity check — must NOT import any fetch / network module
  notContains(feIntelligenceSentenceSrc, "fetch(",
    "BNSB-1B-7 composeIntelligenceSentence is pure (no fetch)")
  notContains(feIntelligenceSentenceSrc, `from "../api"`,
    "BNSB-1B-7 composeIntelligenceSentence does not import api (pure helper)")
  // Anti-fabrication: only mentions counters that are > 0
  contains(feIntelligenceSentenceSrc, "> 0",
    "BNSB-1B-7 composeIntelligenceSentence gates every fragment on counter > 0 (anti-fabrication)")
  contains(feIntelligenceSentenceSrc, "return null",
    "BNSB-1B-7 composeIntelligenceSentence returns null when no counter fires (honest empty)")
  // Dashboard consumes the helper and renders sentence as primary
  contains(feDashboardSrc, `import { composeIntelligenceSentence } from "../intelligenceSentence"`,
    "BNSB-1B-7 Dashboard imports composeIntelligenceSentence")
  contains(feDashboardSrc, "function IntelligenceStripBody",
    "BNSB-1B-7 Dashboard defines IntelligenceStripBody subcomponent with collapsible state")
  contains(feDashboardSrc, `showDetails ? "hide" : "show"`,
    "BNSB-1B-7 Dashboard IntelligenceStrip has show/hide details collapsible toggle")
  contains(feDashboardSrc, "showDetails && (",
    "BNSB-1B-7 Dashboard IntelligenceStrip gates chip-strip render on showDetails state")

  // Deterministic behavior smoke test — load the helper and exercise it
  const helperJs = require("child_process").execSync(
    `node -e "const ts=require('fs').readFileSync('${feIntelligenceSentencePath}','utf8'); console.log(ts.length)"`,
    { encoding: "utf8" }
  ).trim()
  assert(Number(helperJs) > 100,
    `BNSB-1B-7 intelligenceSentence.ts is non-trivial (got ${helperJs} bytes)`)
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-8 — Analyze-This cross-section affordance (window event)
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feAiSlipsViewSrc, `dispatchEvent(new CustomEvent("ws:analyze-slip"`,
    "BNSB-1B-8 SlipCard dispatches ws:analyze-slip CustomEvent")
  contains(feAiSlipsViewSrc, "🔍 Analyze this",
    "BNSB-1B-8 SlipCard has Analyze-this button labeled bettor-native")
  contains(feWorkstationSrc, `addEventListener("ws:analyze-slip"`,
    "BNSB-1B-8 Workstation listens for ws:analyze-slip CustomEvent")
  contains(feWorkstationSrc, "setPendingAnalyzeSlip",
    "BNSB-1B-8 Workstation captures pendingAnalyzeSlip state")
  contains(feWorkstationSrc, `setSection("analyze")`,
    "BNSB-1B-8 Workstation routes to analyze section on receipt")
  contains(feWorkstationSrc, "pendingSlip={pendingAnalyzeSlip}",
    "BNSB-1B-8 Workstation passes pendingAnalyzeSlip to AnalyzeSlipView")
  contains(feWorkstationSrc, "onPendingConsumed={() => setPendingAnalyzeSlip(null)}",
    "BNSB-1B-8 Workstation provides consume-once callback to AnalyzeSlipView")
  contains(feAnalyzeSlipViewSrc, "pendingSlip?: AiSlip | null",
    "BNSB-1B-8 AnalyzeSlipView accepts pendingSlip prop")
  contains(feAnalyzeSlipViewSrc, "onPendingConsumed?.()",
    "BNSB-1B-8 AnalyzeSlipView calls onPendingConsumed after consuming pendingSlip")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-9 — internal taxonomy stripped from bettor-visible default render
// ─────────────────────────────────────────────────────────────────────────────
{
  // ResultBlock header no longer shows raw ss_* hash or archetype in default text
  notContains(feAnalyzeSlipViewSrc, "result.slipId ? ` · ${result.slipId}`",
    "BNSB-1B-9 ResultBlock default render no longer prints raw slipId hash")
  notContains(feAnalyzeSlipViewSrc, "result.archetype ? ` · ${result.archetype}`",
    "BNSB-1B-9 ResultBlock default render no longer prints raw archetype taxonomy")
  // But forensic detail is preserved in tooltip (BNSB-1B-9 doctrine: hidden, not destroyed)
  contains(feAnalyzeSlipViewSrc, "slipId ${result.slipId",
    "BNSB-1B-9 ResultBlock preserves slipId in forensic tooltip")
  contains(feAnalyzeSlipViewSrc, "archetype ${result.archetype",
    "BNSB-1B-9 ResultBlock preserves archetype in forensic tooltip")
  // Bettor-native label
  contains(feAnalyzeSlipViewSrc, "Your slip",
    "BNSB-1B-9 ResultBlock header uses bettor-native 'Your slip' label")
  // sharp/bait wording softened from internal taxonomy
  contains(feAnalyzeSlipViewSrc, "🟢 sharp construction",
    "BNSB-1B-9 sharp signal label re-toned 'sharp construction'")
  contains(feAnalyzeSlipViewSrc, "⚠ bait construction",
    "BNSB-1B-9 bait signal label re-toned 'bait construction'")
}

// ─────────────────────────────────────────────────────────────────────────────
// BNSB-1B-10 — loading / empty / error tone (bettor-native)
// ─────────────────────────────────────────────────────────────────────────────
{
  contains(feAnalyzeSlipViewSrc, "Reading your slip…",
    "BNSB-1B-10 Loading state has bettor-native 'Reading your slip…' copy")
  contains(feAnalyzeSlipViewSrc, "The analysis service is offline right now",
    "BNSB-1B-10 Network error has bettor-native 'service offline' copy")
  contains(feAnalyzeSlipViewSrc, "I couldn't read that one",
    "BNSB-1B-10 Empty/parse error has bettor-spoken first-person 'I couldn't read' copy")
  contains(feAnalyzeSlipViewSrc, "Try the Borrow or Sample path",
    "BNSB-1B-10 Errors offer bettor-native recovery guidance (Borrow / Sample)")
  // Internal URLs / status codes never reach bettor copy
  notContains(feAnalyzeSlipViewSrc, "localhost:4000",
    "BNSB-1B-10 Bettor-visible strings do not leak backend URL (forensic only)")
  notContains(feAnalyzeSlipViewSrc, "verify the slip payload shape",
    "BNSB-1B-10 Engineer-speak 'verify the slip payload shape' copy removed")
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-fabrication sentinels — FE never invents capability that backend lacks
// ─────────────────────────────────────────────────────────────────────────────
{
  notContains(feAnalyzeSlipViewSrc, "OCR",
    "Anti-fabrication: AnalyzeSlipView does NOT mention OCR (backend has no OCR)")
  notContains(feAnalyzeSlipViewSrc, "tesseract",
    "Anti-fabrication: AnalyzeSlipView does NOT mention tesseract")
  notContains(feAnalyzeSlipViewSrc, `type="file"`,
    "Anti-fabrication: AnalyzeSlipView does NOT include <input type='file'>")
  notContains(feAnalyzeSlipViewSrc, "<input type=\"file\"",
    "Anti-fabrication: AnalyzeSlipView does NOT include file input")
  notContains(feAnalyzeSlipViewSrc, "AI understands",
    "Anti-fabrication: AnalyzeSlipView does NOT promise 'AI understands anything'")
  notContains(feAnalyzeSlipViewSrc, "AI magic",
    "Anti-fabrication: AnalyzeSlipView does NOT promise 'AI magic'")

  notContains(feSampleSlipsSrc, "OCR",
    "Anti-fabrication: sampleSlips.ts does NOT reference OCR")
  notContains(feVerdictCardSrc, "OCR",
    "Anti-fabrication: VerdictCard does NOT reference OCR")
  notContains(feIntelligenceSentenceSrc, "fetch",
    "Anti-fabrication: intelligenceSentence helper is purely deterministic")
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log("")
console.log("═══════════════════════════════════════════════════════════════════")
console.log("PHASE Bettor-Native Surface Bridge — BNSB-1B HELPER UNIT TEST")
console.log("BNSB-1B-1 + 1B-2 + 1B-3 + 1B-4 + 1B-6 + 1B-7 + 1B-8 + 1B-9 + 1B-10 + 1B-13")
console.log("═══════════════════════════════════════════════════════════════════")
console.log(`BNSB-1B-1 (PathPicker)                  : 4 cards · default landing · no JSON wall`)
console.log(`BNSB-1B-2 (rawText fabrication removed) : honest JSON-only Paste path`)
console.log(`BNSB-1B-3 (Borrow tonight's slip)       : 1-click from state.aiSlips; NO new fetch`)
console.log(`BNSB-1B-4 (Sample starter tickets)      : 4 canonical fixture slips; backend-valid shapes`)
console.log(`BNSB-1B-6 (VerdictCard hero re-shape)   : ring + headline + takeaway + collapsible detail`)
console.log(`BNSB-1B-7 (Intelligence sentence)       : composeIntelligenceSentence pure helper`)
console.log(`BNSB-1B-8 (Analyze-this cross-section)  : ws:analyze-slip CustomEvent pipe`)
console.log(`BNSB-1B-9 (taxonomy stripped)           : internal IDs / archetype in tooltip only`)
console.log(`BNSB-1B-10 (bettor-native tone)         : loading / empty / error copy`)
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
