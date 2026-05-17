# VBI-FE-UPLOAD-SURFACE-1A AUDIT — BETTOR-NATIVE UPLOAD ACCESSIBILITY

**Date:** 2026-05-17
**Phase under audit:** VBI-FE-Upload-Surface-1A (NEXT phase — not yet shipped)
**Audit type:** READ-ONLY — no patches, no schema mutation, no scoring redesign.
**Author / process:** post-bootstrap FE-upload-surface trace following the seventeen-phase governance substrate (Visual-Betting-Intelligence-1A retroactively sealed at 2026-05-17T02:37:03Z; checkpoint PASS, 0 failures, 17/17 verify + 5/5 probes).

> Doctrine: this document inventories WHAT IS, with file-path + line-number citations. It proposes ZERO patches. The next session selects operator-approved lever(s) from Section 10 and ships them as Phase VBI-FE-Upload-Surface-1A under the established additive / replay-safe / grading-safe / calibration-safe / anti-fabrication / bettor-native-UX doctrine.

---

## EXECUTIVE FINDING

Phase Visual-Betting-Intelligence-1A built the deterministic canonical-signal-backed slip-analysis engine (`buildSlipAnalysis.analyzeSlip()`), the bettor-language phrase library (`bettorLanguage.renderVerdictPhrases()`), the canonical prediction resolver (`resolveSlipLegToPrediction()`), and the 12-field canonical verdict payload shape (`VERDICT_PAYLOAD_SHAPE`). It also confirmed the existing screenshot ingestion infrastructure (`screenshotRoutes.js` mounted at `/api/ws/screenshots/*`; normalizer + classifier; 5-table schema). 76/76 helper unit assertions PASS.

But the bettor cannot see any of it. The product gap is in the LAST MILE:

1. **Backend**: `POST /api/ws/screenshots/ingest` (`screenshotRoutes.js:104-276`) currently runs `normalizeIngestedSlip` + `classifyIngestedSlip` but DOES NOT invoke `analyzeSlip()`. The response payload (`screenshotRoutes.js:265-270`) carries `{ ok, submissionId, slipsIngested, results[{ index, ok, slipId, legs, sport, archetype, compositeScore, sharpSignal, baitSignal }] }` — the canonical VBI verdict (strongestLeg / weakestLeg / contradictionFlags / ecologicalCoherence / bettorLanguageSummary) is computable but never computed at request time.
2. **Frontend API client** (`frontend/src/workstation/api.ts`): 9 endpoint wrappers today (state, aiSlips, lineShopping, timing, portfolio, ledger, firstBasket, featured, builderPreview). ZERO for `/api/ws/screenshots/*`. No `screenshotsAnalyze` / `screenshotsIngest` method.
3. **Frontend workstation** (`frontend/src/workstation/Workstation.tsx:17-26`): 8-tab sidebar (Tonight's Edge / Full Slate / AI Parlays / Book Radar / Risk Map / Bet Builder / First Basket / Edge Log). ZERO upload affordance. No "Analyze Slip" tab. `AiSlipsView.tsx` displays AI-built slips but does not accept uploads.
4. **Types** (`frontend/src/workstation/types.ts`): no canonical VBI verdict type definitions.

**The fix is purely additive and small**: backend wires `analyzeSlip()` into ingest response; FE adds one new section component + one new API method + one new nav tab + canonical TypeScript types mirroring `VERDICT_PAYLOAD_SHAPE`. No backend route renamed, no schema migration, no OCR, no styling overhaul.

---

## SECTION 1 — FE-UPLOAD-SURFACE AUDIT (WHAT EXISTS TODAY)

| Surface | Status | File |
|---|---|---|
| Backend `POST /api/ws/screenshots/ingest` | LIVE; persists; classifies; does NOT analyze | `backend/pipeline/screenshots/screenshotRoutes.js:104-276` |
| Backend `GET /api/ws/screenshots/list` | LIVE | same file `:293+` |
| Backend `GET /api/ws/screenshots/submission/:id` + `:id` | LIVE | same file |
| Backend `analyzeSlip()` pure engine | LIVE; not called by any route | `backend/pipeline/shared/buildSlipAnalysis.js` |
| Backend `renderVerdictPhrases()` | LIVE; not called by any route | `backend/pipeline/shared/bettorLanguage.js` |
| FE `api.ts` screenshots wrapper | **NOT FOUND** | `frontend/src/workstation/api.ts:26-65` (no entry) |
| FE upload section | **NOT FOUND** | `frontend/src/workstation/sections/` (8 sections, none for upload) |
| FE nav tab for upload | **NOT FOUND** | `Workstation.tsx:17-26` (8 tabs, no upload) |
| FE TypeScript types for VBI verdict | **NOT FOUND** | `frontend/src/workstation/types.ts` |
| Multipart middleware (multer / formidable) | **NOT FOUND** (intentional — OCR deferred) | `backend/package.json` |

**Anti-fabrication note:** the audit explicitly does NOT claim OCR is needed. Phase VBI-FE-Upload-Surface-1A is a JSON-paste path (matches the backend's current JSON-only contract). OCR is held per the VBI-10 lever queued in MASTER_BRAIN.

---

## SECTION 2 — WORKSTATION-INSERTION ANALYSIS

`frontend/src/workstation/Workstation.tsx:17-26` defines an 8-button vertical sidebar:

```
⚡ Tonight's Edge     (dashboard)
🎯 Full Slate         (slate)
🎲 AI Parlays         (slips)
👁️  Book Radar         (shopping)
📐 Risk Map           (portfolio)
🛠️  Bet Builder        (builder)
🏀 First Basket       (fb)
📈 Edge Log           (review)
```

**Two viable insertion points, both additive:**

| Insertion point | Pros | Cons |
|---|---|---|
| **NEW 9th nav tab "📸 Analyze Slip" (recommended)** | Permanent home; mirrors existing pattern (1-line addition to NAV array + 1 section route in render switch); discoverable on every visit; consistent with the "obvious" requirement | Small sidebar real-estate cost (already 8 tabs) |
| **Hero card at top of Dashboard** | Visible immediately at app open; aligns with "first thing the bettor sees" | Crowds the existing Dashboard hero hierarchy (RecommendationLadder + HeroPickCard sit there); cannot show full verdict + paste box in one card |

**Recommendation:** ship BOTH — the nav tab is the canonical home; a small Dashboard hero tile is a one-line link/CTA into the tab. The new tab is where the actual upload + verdict experience lives. The Dashboard tile is just the discovery affordance.

`Workstation.tsx:97-109` is the section gate (`{section === "dashboard" && <Dashboard ... />}` etc.). Adding the new section is exactly 1 line + 1 import.

---

## SECTION 3 — SCREENSHOT-RENDER ANALYSIS (TODAY)

There is no screenshot render today. The closest precedent is `AiSlipsView.tsx:29-63` — the `SlipCard` component:

```
<div className="ws-slip tier-{tier}">
  <div className="ws-slip-head">
    <span className="ws-slip-odds">+450</span>
    <span className="ws-mono ws-pos" title="...">EV +12%</span>
    <span className="ws-mono ws-dim" title="...">prob 41%</span>
    <span className="ws-slip-reason">{slip.reasoning}</span>
  </div>
  <div>{slip.legs.map((l) => <SlipLegRow .../>)}</div>
  ...
  <button className="ws-btn ws-btn-primary">➜ Build this parlay</button>
</div>
```

This is the canonical visual density: header strip (3-4 mono badges + free-text reasoning) + structured leg rows + 1 primary action. The verdict card should mirror this density.

**Existing CSS tokens to reuse (from `workstation.css`):**
- `--ws-positive: #22c55e` (green) — for `market_supported_disagreement`, `positive_offensive_stack`, high ecologicalCoherence
- `--ws-negative: #ef4444` (red) — for `mlb_pitcher_hitter_conflict`, `structural_contradiction`, `hard_drop_out_player`
- `--ws-warn: #f59e0b` (amber) — for `shared_game_suppression_exposure`, `fake_safe_same_game_exposure`, `unsupported_solo_book_edge`
- `--ws-info: #06b6d4` (cyan) — for `*_unavailable` context signals, neutral metadata
- `--ws-dim`, `--ws-text-strong` — text hierarchy
- `.ws-card`, `.ws-pill`, `.ws-btn`, `.ws-mono` — building blocks

**No new CSS class definitions required.** Verdict rendering composes existing tokens — preserves the design system and avoids "styling perfection phase" scope creep per operator constraint.

---

## SECTION 4 — BETTOR-UX ANALYSIS

The operator framing — "show me if this ticket is smart" NOT "inspect backend diagnostics" — drives five concrete UX constraints:

1. **One-action entry point.** A textarea + a submit button. No multi-step wizard. No file picker (OCR is deferred). The bettor pastes JSON copied from their sportsbook history / Twitter / Discord and clicks Analyze.
2. **Verdict-first render.** The `verdictSummary` (single canonical bettor-language phrase) renders LARGE and centered. The `ecologicalCoherence` score renders as a visual badge (color-coded green/amber/red), NOT a raw number with 5 decimal places.
3. **Bettor-language summary as the primary narrative.** The 1-5 rendered phrases from `bettorLanguageSummary` are the body of the card. No raw `signals` array dump. No `verdict.signals[*].payload.bookCount = 4` debug strings.
4. **Strongest / weakest leg as referenced legs, not legIndex integers.** The verdict carries `strongestLeg.legIndex` and `weakestLeg.legIndex` — the FE must resolve these to "Aaron Judge OVER 1.5 Total Bases" not "leg 0".
5. **Contradiction flags as warning chips, not arrays.** Each `contradictionFlags[i] = { legA, legB, reason }` renders as a warning chip pairing two named legs. The canonical reason is rendered via the bettor-language library; never as the raw signal id.

**Anti-fabrication carry-over from VBI-1A:** when a leg is unresolved or context is missing, the FE shows the canonical bettor-language phrase ("Could not map this leg to canonical repo intelligence — analysis skipped for this leg.") — never invents a placeholder.

---

## SECTION 5 — VERDICT-CARD PLAN

The verdict card is a single `.ws-card` mirroring the `SlipCard` density. Proposed layout (composition; no new CSS):

```
┌─────────────────────────────────────────────────────────────────┐
│  📸  ANALYSIS                          ecology: ●●○○○  (0.40)   │
├─────────────────────────────────────────────────────────────────┤
│  ► "This ticket dies together if the game stays quiet —         │  ← verdictSummary (large)
│     both legs ride the same pitcher/game environment."          │
├─────────────────────────────────────────────────────────────────┤
│  STRONGEST LEG     —  Aaron Judge OVER 1.5 Total Bases          │  ← strongestLeg (resolved)
│                      Multiple books agree this is a real edge.  │
│  WEAKEST LEG       —  Ildemaro Vargas UNDER 1.5 Hits            │  ← weakestLeg (resolved)
│                      Structurally contradictory (shared game).  │
├─────────────────────────────────────────────────────────────────┤
│  ⚠  CONTRADICTIONS                                              │
│    • Vargas + Goodman — shared-game suppression                 │  ← contradictionFlags (each chip)
├─────────────────────────────────────────────────────────────────┤
│  WHY                                                            │  ← bettorLanguageSummary
│    • Fake-safe construction: looks like multiple safety paths…  │
│    • This ticket dies together if the game stays quiet…         │
└─────────────────────────────────────────────────────────────────┘
```

**Field bindings (1:1 with `VERDICT_PAYLOAD_SHAPE`):**
- Header line: `📸 ANALYSIS` static + ecologicalCoherence pip indicator + numeric badge
- Headline: `verdict.verdictSummary` (rendered via `composeVerdictSummary` server-side; FE reads as-is)
- Strongest line: `verdict.strongestLeg` resolved against original legs array
- Weakest line: `verdict.weakestLeg` resolved against original legs array
- Contradictions: `verdict.contradictionFlags` map each to a chip with player names
- Why: `verdict.bettorLanguageSummary` (already rendered by `renderVerdictPhrases` server-side; FE iterates)

**Anti-fabrication:** every field reads from the verdict payload verbatim. Zero client-side scoring. Zero client-side phrase synthesis.

---

## SECTION 6 — CONTRADICTION-RENDER PLAN

For each `contradictionFlags[i] = { legA: <int>, legB: <int>, reason: <canonical signal id> }`:

1. Resolve `legA` / `legB` → player names via the original `legs` array (passed alongside verdict in the analyze response).
2. Look up the canonical reason via `bettorLanguageSummary` (already contains the rendered phrase).
3. Render as a single-line chip: `⚠ {playerA} + {playerB} — {short canonical phrase}`.

**Short phrase mapping (additive — operator-approvable in the patch):**
- `mlb_pitcher_hitter_conflict` → "pitcher-K vs hitter-OVER conflict"
- `shared_game_suppression_exposure` → "shared-game suppression"

These short phrases are NEW operator-approved strings; the patch will add them to `bettorLanguage.js` as a sibling `SHORT_SIGNAL_PHRASES` table (additive — no logic change). The full phrase remains in `SIGNAL_PHRASES` and renders in the "WHY" section.

---

## SECTION 7 — STRONGEST / WEAKEST-LEG PLAN

The verdict carries `strongestLeg = { legIndex, reason } | null` and `weakestLeg = { legIndex, reason } | null`. Anti-fabrication: when no canonical signal fires, both are `null`.

**Render rules:**
- When `strongestLeg === null`: render `"STRONGEST LEG — (none clearly stand out)"` in dim text. Never invent a "default strongest".
- When `weakestLeg === null`: render `"WEAKEST LEG — (none clearly stand out)"` in dim text. Never invent a "default weakest".
- When non-null: resolve `legIndex` → `legs[legIndex]` (the originally-uploaded leg). Render as `"{player} {side} {line} {statFamily} — {reason via bettorLanguage}"`.
- The `reason` field IS a canonical signal id (e.g. `market_supported_disagreement`, `hard_drop_out_player`). The FE looks it up in `bettorLanguageSummary` or via an additive `bettorLanguage.SHORT_SIGNAL_PHRASES` table.

---

## SECTION 8 — VISUAL-BETTING-INTELLIGENCE FE PLAN

**Backend additive (1 file modified):**
- `screenshotRoutes.js:265-270` ingest response gains a `verdict` field per result. `analyzeSlip()` is invoked once per normalized slip; result shape per VERDICT_PAYLOAD_SHAPE. Response field is additive — existing FE consumers (currently zero) are unaffected.

**Backend additive (1 file modified):**
- `bettorLanguage.js` — add `SHORT_SIGNAL_PHRASES` frozen sibling map (additive export). Used by the FE for chip labels. NO LLM, NO new logic.

**Frontend additive (4 files modified, 2 created):**
- `frontend/src/workstation/types.ts` — NEW canonical TypeScript types: `VbiVerdict`, `VbiSignal`, `VbiLegRef`, `VbiCovarianceProfile`, `VbiExploitabilityProfile`, `VbiAvailabilityProfile`, `VbiFakeSafeRisk`, `VbiUnresolvedLeg`. 1:1 with `VERDICT_PAYLOAD_SHAPE`.
- `frontend/src/workstation/api.ts` — NEW method `screenshotsAnalyze({ slip, sport, slateDate, sourceType?, sourceLabel? })` → POSTs to `/api/ws/screenshots/ingest`; returns the result (with new `verdict` field).
- `frontend/src/workstation/Workstation.tsx` — 1 entry in `NAV` array (`{ id: "analyze", label: "Analyze Slip", icon: "📸" }`), 1 section route (`{section === "analyze" && <AnalyzeSlipView />}`), 1 import.
- `frontend/src/workstation/sections/AnalyzeSlipView.tsx` — NEW section component. Header + textarea + Submit button + sport/date controls + verdict card render.
- `frontend/src/workstation/components/VerdictCard.tsx` — NEW component. Reads `VbiVerdict` props + the original legs array, renders the Section-5 layout. Pure presentational.

**Zero CSS file changes** (composes existing `--ws-*` tokens + utility classes).

---

## SECTION 9 — LONGITUDINAL BETTOR-UX STRATEGY

Phase VBI-FE-Upload-Surface-1A ships the JSON-paste-to-verdict loop. Future phases:

| Phase | Lever | Effort | Operator value |
|---|---|---|---|
| 1B | Dashboard hero CTA tile ("📸 Analyze a Bet Slip") with one-click jump to the Analyze tab. | Small | Discovery — bettor sees the upload affordance at app open. |
| 1C | "Recent uploads" list inside the Analyze tab — calls `GET /api/ws/screenshots/list`. | Small | Longitudinal — bettor sees their analyzed history. |
| 1D | "Re-analyze" affordance — re-runs `analyzeSlip` on a stored `parsed_slip` (useful when canonical engine evolves). | Small | Demonstrates that the engine is deterministic + canonical. |
| 1E | Optional multipart upload (`<input type="file">`) + Tesseract OCR backend. | LARGE | Real screenshot upload (VBI-10 / VBI-1F lever from prior audit). |
| 1F | Bettor-language phrase priority: SHORT vs FULL render, operator-tunable. | Small | Operator dial for compact vs verbose mode. |
| 1G | Mobile-optimized verdict card (full-bleed). | Medium | Phone-first audience. |
| 1H | Persist verdict_json (VBI-5 lever from prior audit) → enables longitudinal verdict tracking. | Medium | Cross-session intelligence. |

---

## SECTION 10 — CANDIDATE LEVERS (operator-approvable Phase VBI-FE-Upload-Surface-1A scope)

Every lever is deterministic, additive, anti-fabrication-respecting, and reuses existing canonical authorities. NO OCR. NO new persistence. NO new ML. NO new CSS files.

| Lever | Surface | Risk | Smallest-safe |
|---|---|---|---|
| **FE-VBI-1** — `screenshotRoutes.js` ingest response gains additive `verdict` field per result, populated by `analyzeSlip()`. Backward-compatible. | `backend/pipeline/screenshots/screenshotRoutes.js` | LOW | ★ smallest. Pure composition. |
| **FE-VBI-2** — `bettorLanguage.js` additive `SHORT_SIGNAL_PHRASES` map for chip labels. | `backend/pipeline/shared/bettorLanguage.js` | TRIVIAL | ★ smallest. Pure dictionary entry. |
| **FE-VBI-3** — Canonical TypeScript types for VBI verdict in `types.ts`. 1:1 with `VERDICT_PAYLOAD_SHAPE`. | `frontend/src/workstation/types.ts` | TRIVIAL | ★ smallest. Pure type definitions. |
| **FE-VBI-4** — `api.ts` new `screenshotsAnalyze()` method. | `frontend/src/workstation/api.ts` | TRIVIAL | ★ smallest. Mirrors existing wrappers. |
| **FE-VBI-5** — NEW `AnalyzeSlipView.tsx` section component. JSON-paste textarea + Submit + sport/date selectors + verdict card render. Anti-fabrication: empty state shows guidance, never invents a verdict. | `frontend/src/workstation/sections/AnalyzeSlipView.tsx` | LOW | Visible bettor surface. |
| **FE-VBI-6** — NEW `VerdictCard.tsx` presentational component. Reads VbiVerdict + legs; renders Section-5 layout. Pure presentational; no fetch. | `frontend/src/workstation/components/VerdictCard.tsx` | LOW | Pure UI. |
| **FE-VBI-7** — `Workstation.tsx` adds "📸 Analyze Slip" nav tab + section route. 3-line addition. | `frontend/src/workstation/Workstation.tsx` | LOW | Discoverability. |
| **FE-VBI-8** — `verifyVbiFeUploadSurface1A.js` helper unit. Asserts `analyzeSlip` is invoked inside `/ingest` path (response carries `verdict.verdictSummary` and `verdict.bettorLanguageSummary`); asserts canonical TypeScript types align with VERDICT_PAYLOAD_SHAPE; asserts FE module imports resolve. | `backend/scripts/verifyVbiFeUploadSurface1A.js` | LOW | Required for governance probe matrix. |
| **FE-VBI-9** — Dashboard hero CTA tile linking to Analyze tab. | `frontend/src/workstation/sections/Dashboard.tsx` | LOW | Discovery — held for 1B. |
| **FE-VBI-10** — "Recent uploads" list inside Analyze tab. | `AnalyzeSlipView.tsx` | LOW | Longitudinal — held for 1C. |
| **FE-VBI-11** — Multipart upload + Tesseract OCR. | `screenshotRoutes.js` + `package.json` | HIGH | **HELD** per operator: "not OCR research phase". |
| **FE-VBI-12** — Mobile-optimized verdict card. | `workstation.css` + `VerdictCard.tsx` | MEDIUM | HELD per operator: "not mobile optimization phase". |

**Recommended smallest-safe combination:** FE-VBI-1 + FE-VBI-2 + FE-VBI-3 + FE-VBI-4 + FE-VBI-5 + FE-VBI-6 + FE-VBI-7 + FE-VBI-8 ship together. These form the complete end-to-end FE upload + verdict-render experience. FE-VBI-9 (Dashboard CTA), FE-VBI-10 (recent uploads), FE-VBI-11 (OCR), FE-VBI-12 (mobile) are deferred to future phases per the operator's "not X phase" constraints.

---

## SECTION 11 — AUDIT CITATIONS (REPRODUCIBILITY)

| Citation | Verified by |
|---|---|
| `Workstation.tsx:17-26` (8-tab NAV array), `:97-109` (section gate) | Direct Read this session. |
| `api.ts:26-65` (9 fetch wrappers; no screenshots endpoint) | Direct Read this session. |
| `AiSlipsView.tsx:29-63` (`SlipCard` density template) | Direct Read this session. |
| `workstation.css` color tokens (`--ws-positive`, `--ws-negative`, `--ws-warn`, `--ws-info`, etc.) | Direct grep this session. |
| `screenshotRoutes.js:104-276` (ingest endpoint; response shape lines 265-270) | Direct Read this session. |
| `buildSlipAnalysis.js` `analyzeSlip()` exported pure function | Confirmed via prior phase patches (Visual-Betting-Intelligence-1A). |
| `bettorLanguage.js` `SIGNAL_IDS` + `SIGNAL_PHRASES` + `renderVerdictPhrases` + `composeVerdictSummary` | Confirmed via prior phase patches. |
| `resolveSlipLegToPrediction.js` `VERDICT_PAYLOAD_SHAPE` frozen constant | Confirmed via prior phase patches. |
| `verifyVisualBettingIntelligence1A.js` 76/76 PASS at sealed checkpoint 2026-05-17T02:37:03Z | Direct `brain:checkpoint` this session. |

---

## ARCHITECTURE PRESERVATION INVARIANTS (THIS AUDIT)

- ✓ ZERO code patched.
- ✓ ZERO schema mutation.
- ✓ ZERO scoring redesign.
- ✓ ZERO grading / replay / lineage / persistence / orchestrator / recommendation-hierarchy / MLB-COV / EXPL / NBA-correlation touch.
- ✓ ZERO existing screenshot pipeline file logic change planned (the patch wires `analyzeSlip` into ingest response — purely additive).
- ✓ Receipt + checkpoint state unaffected (audit is read-only; brain:checkpoint still required at end of next code-touching session).

---

## STATUS

Phase VBI-FE-Upload-Surface-1A AUDIT complete. Recommended next action: operator selects lever(s) from Section 10 (smallest-safe-step combination: FE-VBI-1 through FE-VBI-8 — complete CLI-verifiable + FE-visible upload-to-verdict loop using existing canonical authorities). Phase ships under the established additive / probe-matrix-clean / 14-suite-regression-clean / governance-PASS discipline.

Doctrine to be cemented when shipping:
- **Bettor-native FE doctrine** — the upload feature must FEEL obvious, simple, visual; never quant-terminal-like; never dev-tool-like.
- **Screenshot upload philosophy** — JSON-paste path first (matches backend's existing JSON-only contract); OCR is a future phase.
- **Visual betting intelligence FE doctrine** — every visual element binds 1:1 to a canonical verdict-payload field; zero client-side scoring; zero client-side phrase synthesis.
- **Low-friction bettor UX philosophy** — one entry point, one action, one verdict. No multi-step wizards. Empty state shows guidance, never invents a verdict.
- **Predictive screenshot accessibility doctrine** — the analysis surface is permanently discoverable via a sidebar nav tab + optional Dashboard CTA; never buried behind a CLI or admin route.
- **Anti-fabrication FE doctrine** — strongest/weakest = null when no signal fires (render "none clearly stand out"); contradiction chips use canonical phrasings; raw signal IDs and integer legIndex values never reach the user.
