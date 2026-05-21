# CURRENT PROBLEMS
**Live bottleneck tracker. Read BEFORE proposing any new phase. Prevents re-solving solved problems and ignoring active ones.**

**Status legend:**
- 🟢 SOLVED — fixed in a shipped phase (linked); do not re-solve
- 🟡 ACTIVE — currently a bottleneck; candidate for next phase
- 🔵 DEFERRED — known, operator-approved-to-wait, prerequisite-blocked (see `DEFERRED_PHASES.md`)
- 🔴 DANGEROUS — explicitly forbidden direction; do not propose
- ⚪ FUTURE — likely real but not actively analyzed yet

---

## 🟡 ACTIVE BOTTLENECKS (candidates for next phase)

| # | Problem | Notes |
|---|---|---|
| A-1 | **Slips still emotionally weak.** Even with BNSB-1B reinforcement ladder + bettorLanguage chips, multi-leg parlays don't yet feel "holy shit." | Likely needs narrative compression on the parlay card (story-form reasoning, not just per-factor chip dump). NOT a backend change. |
| A-2 | **Game hub depth thin on small slates.** NBA 1-game playoff slate shows 40 props (BNDS-1B win) but the GameCard could expose richer per-event meta (pitcher matchup card / lineup card / weather card on hover). | Pure FE; no backend touch required. Canonical fields already on candidates. |
| A-3 | **Portfolio concentration warnings unclear.** Risk Map surfaces concentration clusters but the explanations are operator-shaped, not bettor-shaped. | FE bettor-language pass on `PortfolioView.tsx`. |
| A-4 | **Bookkeeping CLI invisible to FE.** `npm run grading:status` / `calibration:status` / `lineage:status` show rich state but never reach the workstation. | NEW Diagnostics tab or fold into Risk Map. |
| A-5 | **Discovery sort options unsorted by survivability.** Discover lenses sort by avgImpliedTeamTotal but never by `ladderSurvivabilityFactor` or `bettorRealismScore` per-game aggregates. | Pure FE — extend `DISCOVERY_LENSES`. |

---

## 🟢 SOLVED (do not re-solve)

| # | Problem | Resolved by |
|---|---|---|
| S-1 | Recommendation ladder only showed 7 slots, BC-6 + OE-7 added slots 8 + 9 but FE silently dropped them | BNSB-1A (BNSB-1) |
| S-2 | bettorRealismScore (BC-8) computed but invisible to operator | BNSB-1A (BNSB-2 + BNSB-4) |
| S-3 | `oe11ReinforcementBoost` / `calibratedCombinedModelProb` / `rawCombinedModelProb` dropped at route boundary | BNSB-1A (backend payload propagation) |
| S-4 | Screenshot ingest had no FE consumer | BNSB-1A (BNSB-6 AnalyzeSlipView + VerdictCard) |
| S-5 | AnalyzeSlipView was a JSON textarea dev tool | BNSB-1B (BNSB-1B-1 PathPicker) |
| S-6 | Fabricated `{rawText: raw}` payload (backend has no rawText handler) | BNSB-1B (BNSB-1B-2 — removed) |
| S-7 | Internal `ss_*` hashes + archetype taxonomy leaking to bettor view | BNSB-1B (BNSB-1B-9 stripped) |
| S-8 | VerdictCard was flat 12-section encyclopedia | BNSB-1B (BNSB-1B-6 hero re-shape) |
| S-9 | Dashboard IntelligenceStrip was 13-chip counter dump | BNSB-1B (BNSB-1B-7 sentence + collapsible drill-down) |
| S-10 | No cross-section "Analyze this" affordance | BNSB-1B (BNSB-1B-8 ws:analyze-slip CustomEvent) |
| S-11 | FE had no game-first discovery surface | BNDS-1A (NEW Discover tab + GameCard + PropRails + LadderExplorer) |
| S-12 | No `composeExplosiveSentence` env compression | BNDS-1A (BNDS-1A-4) |
| S-13 | No `ScreenshotIntake` foundation (cmd+v + drag/drop) | BNDS-1A (BNDS-1A-7 — honest foundation, no OCR) |
| S-14 | FE Discover felt empty — narrow canonical pool | BNDS-1B (additive `discoveryCandidates` field, +166% MLB / +233% NBA) |
| S-15 | New chats drift catastrophically because reconstruction surface is 15,000+ lines | Continuity-OS-1A (this phase — 6 anchor files, ~700 lines) |
| S-16 | MLB pitcher-K + opposing hitter contradiction unblocked | MLB-COV-1A (MLB-COV-3) |
| S-17 | Same-game UNDER stack unblocked | MLB-COV-1A (MLB-COV-2) |
| S-18 | Screenshot intelligence engine disconnected from canonical resolvers | VBI-1A (VBI-2/3/4/6/8) |
| S-19 | Backup-tier hitters out-promoted top-of-order stars | BC-1A (BC-2 playerLegitimacyFactor + BC-1 field lift) |
| S-20 | Hostile parks (HR_SUPPRESSING) didn't soft-demote believable upside | BC-1A (BC-4) |
| S-21 | Explosive offensive environments had no positive boost | OE-1A (OE-2/3/4/5/6/7/8) |
| S-22 | Same-team hitter-OVER pairs scored as independent in combineLegs | OE-1B (OE-11 stackReinforcementScore + joint-prob adjustment) |
| S-23 | Single-book outliers surfaced symmetrically with multi-book consensus | EXPL-1A (EXPL-1 consensus-support gate) |
| S-24 | OUT-player props surfaced silently | EXPL-1A (EXPL-4 availability hard-filter) |
| S-25 | brain:checkpoint didn't enforce operator-facing docs | Operational-Governance-1A (GOV-1 + GOV-3 5-probe matrix) |
| S-26 | NBA snapshot supplement starved on nights without nightly run | Snapshot-Authority-1A (FIX Q1) |
| S-27 | Settlement window stuck at todayKey() — yesterday's slates never graded | Settlement-Ingestion-Window-1A (AUTO-3 rolling window) |

---

## 🔵 DEFERRED (see `DEFERRED_PHASES.md` for full why)

| # | Problem | Prerequisite |
|---|---|---|
| D-1 | OCR / image-upload parsing | Operator-deferred indefinitely. Foundation shipped (BNDS-1A-7); pipeline never to be built unless explicit lever approved. |
| D-2 | NBA parity ecology (MLB-COV / BC-1A / OE-1A equivalents for NBA) | NBA-specific ecology audit (NOT MLB clone — needs pace/usage/depth signals). |
| D-3 | Longitudinal adaptive calibration (`FAMILY_CALIBRATION_COEFFICIENTS` refresh) | Per-bucket / per-signal ROI retrospective surface (BNSB-1C class). |
| D-4 | Bullpen ingest activation (OE-13 fires NEUTRAL because `bullpenDataAvailable !== true`) | Upstream `deriveMlbBullpenContext.js` populator (Phase 1B-class effort). |
| D-5 | OE-14 structural under-flip (drop `TIER_TEMPLATES.balanced.allowedSides: ["under"]`) | Observation window of OE-1A/1B reward behavior. |
| D-6 | OE-15 `buildBestOvers` symmetry bucket | Validate whether OE-6 explosive-upside organically fills the symmetry first. |
| D-7 | BNSB-1B-5 build-leg-by-leg 4-tap flow in AnalyzeSlipView | Build path currently routes to existing Bet Builder. |
| D-8 | BNSB-1B-11 NAV label re-tone (Tonight's Edge / Risk Map / etc.) | Cosmetic only; never blocks. |
| D-9 | Mobile-optimized layout | Operator-deferred. |
| D-10 | Persisted slip history / re-analyze feature | BNSB-1C-class per VBI-FE-Upload audit Section 9. |
| D-11 | Cross-sport correlation engine extraction (MLB-COV-9) | Architectural cleanup; not bettor-visible value. |

---

## 🔴 DANGEROUS (do NOT propose; will be rejected)

| # | Direction | Why forbidden |
|---|---|---|
| X-1 | LLM / GPT narration for any FE-visible string | Violates anti-fabrication invariant. `bettorLanguage` library is the canonical replacement. |
| X-2 | Celebrity / star-power weighting | Fabricated value (BC + OE phase prompts explicitly forbid). |
| X-3 | Dynamic sportsbook-behavior simulation | Fabricated counter-models. |
| X-4 | Adaptive payout shaping / fake SGP inflation | MLB-COV / OE-11 explicitly forbid. |
| X-5 | Recursive explosion logic | Uncontrolled inflation; cap-and-stop is doctrine. |
| X-6 | Hardcoded "tonight's lock" surface | Hidden-value preservation forbids. |
| X-7 | Auto-bet placement / sportsbook API integration | Out of scope (advisory, not executor). |
| X-8 | Synthetic shadow predictions / fabricated calibration corpus | Grading-Calibration-Operations-1D explicitly forbade. |
| X-9 | Raw sportsbook flooding on any FE surface (bypassing eligibleBets gate) | Anti-bypass discipline (BNDS-1B cemented). |
| X-10 | Vision API / tesseract / multer / formidable on any FE upload | Anti-fake-OCR doctrine (BNDS-1A cemented). |
| X-11 | Hard-filtering props upstream so the lens applies before rails render | Soft-lens doctrine violated (BNDS-1A cemented). |
| X-12 | Adaptive AI styling on VerdictCard / SlipCard | BNSB-1B explicitly forbade. |

---

## ⚪ FUTURE (acknowledged but not actively analyzed)

| # | Problem | Status |
|---|---|---|
| F-1 | First-pitch in-play overlays | Not in scope today. |
| F-2 | Live-game prop adjustments | Out of scope today. |
| F-3 | NFL / NHL / soccer expansion | Out of scope today. |
| F-4 | Multi-operator / shared workstation | Out of scope today. |
| F-5 | Mobile-first redesign | Operator-deferred. |
| F-6 | Public-facing bettor end-user surface | Out of scope today. |
| F-7 | Persisted slip history / longitudinal verdict tracking | BNSB-1C-class (deferred). |

---

## RULE FOR ADDING / MOVING ITEMS

1. SOLVED → must link the shipped phase that resolved it.
2. ACTIVE → must be a concrete bottleneck, not a vague "could be better."
3. DEFERRED → must have a prerequisite OR explicit operator deferral.
4. DANGEROUS → must cite the anti-fabrication / operator-forbidden basis.
5. FUTURE → only add when surfaced; don't speculate.

When a new chat reads this file: **active items are the candidates for the next phase**. Dangerous items will be rejected if proposed. Deferred items require prerequisite clearance.
