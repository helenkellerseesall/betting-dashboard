# STRATEGIC PRODUCT / ARCHITECTURE AUDIT — 2026-05-17

**Type:** TOP-DOWN strategic audit · NO patches · NO implementation · NO feature ship · NO micro-fixes.
**Audit date:** 2026-05-17
**Substrate state:** 20 phases shipped · 20 verify scripts PASS · 5/5 probe matrix PASS (158 assertions) · brain checkpoint sealed at 2026-05-17T05:16:22Z.

> Operator framing: "the repo is no longer a raw ingestion/math project; it is now a betting-product architecture problem." Operator stated concern: "getting lost in the weeds." This audit is correct to be wary of that concern. The audit's job is to identify the SINGLE highest-leverage next direction — not enumerate 15 simultaneous phases.

---

## EXECUTIVE FINDING (the audit's bottom line, stated FIRST)

The repo has built deep, deterministic, anti-fabrication-disciplined betting intelligence across 20 phases. **Every one of the last 4 phases (MLB-Correlation-Engine-1A, Visual-Betting-Intelligence-1A, Bettor-Curation-Intelligence-1A, Offensive-Ecology-Intelligence-1A/1B) is a canonical-bridge phase — they bridged existing canonical signals into existing canonical engines.** That bridge work is essentially complete on the backend.

The next bottleneck is structurally clear and unambiguous:

> **The bettor cannot SEE what the repo computes.**

The backend now produces a 12-field VBI verdict payload, a 14-id bettorLanguage phrase library, a 9-slot recommendation ladder, BC-1A realism gates + OE-1A/1B/MLB-COV/EXPL counters on every result payload, the `bettorRealismScore` advisory, the `[OE-1B] offensive reinforcement` operator log line, and several thousand lines of context derivations — but the FE workstation is functionally unchanged across 7 phases of backend evolution. **Every backend phase doubles the surface tension. The next backend phase (longitudinal learning, NBA parity, OE-14 structural under-flip) widens the gap further.**

**Single recommended next phase: "Bettor-Native Surface Bridge" (BNSB-1A)** — surface existing canonical signals into the existing 8-tab workstation without redesigning anything, mirroring the same canonical-bridge doctrine that's worked four consecutive times (MLB-COV → VBI → BC → OE). This is "expose existing betting intelligence cleanly" — the operator's exact framing from the VBI-FE-Upload audit. NO new intelligence. NO new ML. NO new persistence. NO new fetches. NO redesign. Just bridge what exists.

The rest of this document supports that finding with evidence.

---

## SECTION 1 — CURRENT PRODUCT STATE

| Layer | Maturity | Visible to bettor? |
|---|---|---|
| Grading + settlement | Production-stable | No (CLI-only) |
| Calibration honesty | Production-stable | No |
| Operational governance (brain checkpoint, 6-doc enforcement, 158-assertion probe matrix) | Production-stable | No |
| Market-supported disagreement (EXPL-1) + availability hard-filter (EXPL-4) | Shipped | Partial — gates ranking; phrase not shown |
| MLB covariance suppression (MLB-COV-1/2/3) | Shipped | No — gates exist; reasons never surface to bettor |
| Screenshot intelligence engine (VBI-2/3/4/6/8) — analyzeSlip + 12-field verdict + bettorLanguage | Shipped | **No FE consumer at all** |
| Bettor-curation realism weighting (BC-1A) — playerLegitimacyFactor + believable-upside bucket + ladder slot 8 + bettorRealismScore | Shipped | **No FE consumer** |
| Offensive ecology awareness (OE-1A) — offensivePressureIndex + hrCarryEnvironment + correlatedRunProduction + explosiveEnvironmentTag + explosive-upside bucket + ladder slot 9 + ladderSurvivabilityFactor | Shipped | **No FE consumer** |
| Offensive reinforcement (OE-1B) — stackReinforcementScore in combineLegs + lineupTurnoverPotential + bullpenFragilityContext | Shipped | **No FE consumer** |
| FE workstation (8 tabs · Dashboard · AiSlipsView · SlateBrowser · LineShopping · Portfolio · BetBuilder · FirstBasket · ProcessReview) | Unchanged across 7 phases | Yes |

**Functional asymmetry:** the backend has 20 phases of intelligence; the FE has 0 phases consuming any of the last 4 phases' output. Every backend phase produces fields that travel back to the FE on result payloads and are silently ignored. The operator-visible result is a 8-tab workstation that looks identical to how it looked before MLB-COV-1A shipped on 2026-05-16.

---

## SECTION 2 — BIGGEST PRODUCT STRENGTHS

1. **Deterministic anti-fabrication doctrine.** Every signal traces to a canonical source. No LLM, no GPT, no fabricated confidence. This is operator-enforced and probe-matrix-verified.
2. **Canonical-authority-first composition pattern.** Same architectural shape across 4 consecutive phases. New phases compose existing signals; never duplicate; never invent. This pattern has zero observed failure modes.
3. **Governance integrity.** 6-doc reconciliation at every checkpoint. 158-assertion probe matrix. 20 verify scripts. Continuity / freshness / receipt-as-memory-ledger. No drift across 20 phases.
4. **Hidden-value preservation.** Every demote / suppress gate is soft. No hard-rejects of legitimate value. Under-side legs UNTOUCHED by 4 phases of offensive-overs work. Operator's "do not destroy hidden value blindly" constraint honored throughout.
5. **MLB intelligence depth.** Same-game suppression + pitcher-K↔hitter conflict + believable-upside + explosive-environment-tag + lineup-turnover + bullpen-fragility (all canonical, all anti-fabrication). MLB is the deepest sport surface.

---

## SECTION 3 — BIGGEST PRODUCT WEAKNESSES

1. **FE INVISIBILITY.** This is THE bottleneck. 9-slot recommendation ladder builds correctly, returns on payload, never renders. bettorLanguage phrases compute, never display in workstation. OE-1A/1B logs fire only to backend stdout. The bettor — who is the actual customer — sees none of it.
2. **No screenshot upload surface.** VBI-2/3/4/6/8 shipped 36 hours ago; FE-VBI-1 through FE-VBI-8 audited and approved at lever-menu but never built. The screenshot intelligence engine is functionally a dead utility until FE-VBI ships.
3. **Quant-terminal feel persists.** The 8 tabs are: Tonight's Edge / Full Slate / AI Parlays / Book Radar / Risk Map / Bet Builder / First Basket / Edge Log. Every tab name is analyst-vocabulary. None say "Upload My Ticket" or "Analyze My Slip" or "Why This Parlay."
4. **Under-dominance baked structurally.** `TIER_TEMPLATES.balanced.allowedSides: ["under"]` (OE-14 deferred). Empirical 21.1% all-under win rate over 209 settled multi-leg slips. The audit observed this is structural — OE-1A/1B added positive boosts symmetrically, but the under-override is still in place.
5. **NBA is mathematically present, ecologically absent.** NBA has `nbaCorrelationEngine` + `playerStatus` filter (EXPL-4 active). NBA has NO equivalent of BC-1A / OE-1A / OE-1B. NBA candidates flow through the same `scoreCandidate` and pick up BC-2 / OE-2 / OE-3 / OE-4 at neutral values (anti-fabrication: no canonical MLB-shape signals → neutral). The 11th-factor `playerLegitimacyFactor` returns 0.70 neutral for every NBA candidate. NBA has gained nothing from the last 4 phases.

---

## SECTION 4 — MOST HIDDEN INTELLIGENCE

In rough priority order — highest-impact-if-surfaced first:

| Intelligence | Currently lives in | Operator-visibility today |
|---|---|---|
| 12-field VBI verdict payload (verdictSummary, strongestLeg, weakestLeg, contradictionFlags, ecologicalCoherence, covarianceProfile, exploitabilityProfile, fakeSafeRisk, bettorLanguageSummary) | `buildSlipAnalysis.analyzeSlip()` returns it; nothing reads it | NONE |
| bettorLanguage 14 canonical phrases ("This ticket dies together…", "Multiple books agree this is a real edge…", "Fake-safe construction…") | `bettorLanguage.SIGNAL_PHRASES` exported; nothing renders it in workstation | NONE |
| 9-slot recommendation ladder (bestOverall / safestPlay / bestUpsidePlay / bestBalancedPlay / bestDisagreement / bestBelievableUpside / bestExplosiveUpside / mostOverpricedAvoid / highestTrapRiskAvoid) | `buildRecommendationLadder()` returns it on payload | The frontend's existing `RecommendationLadder.tsx` component (from Phase Recommendation-Hierarchy-1A) renders 7 slots. Slots 8 + 9 are silently dropped. |
| `bettorRealismScore` advisory (0-1) + 4 sub-components on `buildAiSlips` result | `computeBettorRealismScore()` returns it on result | NONE |
| `oe1aStats` + `oe1bStats` + `bc1aStats` + `mlbCovStats` per-run accounting | All four returned on `buildFeaturedPlays` / `buildAiSlips` result | NONE (only backend stdout `[BC-1A] / [OE-1A] / [OE-1B]` logs) |
| `contextualTags` per row (LINEUP_HEART / PARK_HR_FRIENDLY / WIND_OUT / PITCHER_K_HEAVY) | Lifted in normalizeCandidate via BC-1 / OE-1 | NONE |
| Per-slip auditable `calibratedCombinedModelProb` + `oe11ReinforcementBoost` | Returned on every multi-leg slip in `combineLegs` | NONE |
| `bookProfile.byStat` per-book historical CLV per stat family | Computed in line-shopping intelligence | Partial (displayed via tooltips only) |

**Pattern**: every one of these is a payload-field that's returned on existing API responses and silently dropped by the FE. The FE never had to "fetch new data" — the data IS there. The FE just doesn't render the new fields.

---

## SECTION 5 — MOST IMPORTANT TRUST GAPS

1. **The bettor can't see WHY.** The repo computes `processNote: "market-supported disagreement"` on every surviving EXPL-1 gated play. It never renders. The bettor sees a number; not a reason.
2. **The bettor can't see CONTRADICTIONS.** MLB-COV-2 hard-blocks pitcher-K + opposing hitter pairs at `canAddLeg`. Reasoning: a 2-leg slip never SURFACES with that combination. The bettor never sees that the system rejected it for them. Trust is built from visible vetting, not silent suppression.
3. **The bettor can't see SURVIVABILITY.** `bettorRealismScore`, `ecologicalCoherence`, `ladderSurvivabilityFactor` all compute. None render. The bettor sees combined-modelProb but doesn't see the calibrated-vs-raw-vs-reinforced ladder of probability adjustments.
4. **The bettor can't UPLOAD their own slip and ask "is this smart?"** The VBI-FE audit identified this as the bettor-native pivot. 36 hours later: no FE upload surface, no verdict card, no API client method.
5. **The bettor can't read EXPLOSIVE ENVIRONMENT alerts.** `explosiveEnvironmentTag` aggregator runs every refresh. It computes per-event "this game is set up to detonate." Nothing surfaces that signal to the bettor.

---

## SECTION 6 — WHY SLIPS STILL FEEL WEAK

Operator's question: "Why do slips still not feel 'holy shit' enough?" The honest answer has three parts:

1. **The "holy shit" reaction is a function of NARRATIVE plus EDGE, not edge alone.** The repo now produces both (`bettorLanguageSummary` phrases + canonical signal IDs + calibrated joint-prob with OE-11 reinforcement disclosure). But the slip-card render is unchanged: combined odds, EV%, model prob%, slip.reasoning (the FE's existing field), leg rows. The new ecology / reinforcement / explosive narrative is computed but never read into the card render.
2. **Under-stack dominance.** Empirical 51.4% all-UNDER composition. Even when OE-6 produces a coherent explosive offensive bucket, it competes for ladder slot 9 against 8 prior slots; the bettor doesn't see "tonight's bomb ticket" prominently.
3. **No "tonight's smart upside" hero.** The Dashboard's HeroPickCard surfaces the highest-composite anchor — which is composite-driven (frequently a high-modelProb under). The new `bestExplosiveUpside` slot 9 exists but is buried 9 positions down the ladder. There's no surfacing of "the believable explosive ticket we built tonight."

The fix is not more backend intelligence. The fix is the FE bridge that finally shows the existing intelligence to the bettor.

---

## SECTION 7 — FE / UX ANALYSIS

`frontend/src/workstation/Workstation.tsx` defines 8 nav buttons: dashboard / slate / slips / shopping / portfolio / builder / fb / review. The structure is well-organized but analyst-vocabulary throughout ("Tonight's Edge", "Book Radar", "Risk Map", "Edge Log").

| FE Surface | What it shows today | What it COULD show with existing payloads |
|---|---|---|
| Dashboard | RecommendationLadder (7 slots) + HeroPickCard + ActionableBucketsGrid + KpiCards | All 9 ladder slots (slots 8 + 9 are payload fields silently dropped) · bestBelievableUpside hero · bestExplosiveUpside hero · `bettorRealismScore` badge · `[OE-1B]` accounting strip ("tonight: 2 explosive events tagged · 1 pair-reinforcement boost") |
| AiSlipsView | SlipCard per tier · combined odds · ev · prob · reasoning | Plus: `oe11ReinforcementBoost` badge ("+0.018 same-team-OVER reinforcement") · `calibratedCombinedModelProb` vs `combinedModelProb` reconciliation · `bettorLanguageSummary` phrases as the slip narrative |
| (no surface) | (nothing) | Upload Slip → renders VBI verdict card (Section 4 of `VBI_FE_UPLOAD_SURFACE_AUDIT_2026-05-17.md` already specs the layout) |

**The FE is not BROKEN. The FE is THIN.** A bettor opening the workstation today sees roughly the same screen they saw a week ago. The five most recent backend phases are FE-invisible.

---

## SECTION 8 — VBI / SCREENSHOT READINESS ANALYSIS

Per `docs/VBI_FE_UPLOAD_SURFACE_AUDIT_2026-05-17.md` Section 10, the audit identified 12 levers (FE-VBI-1 through FE-VBI-12). 36 hours later the count of FE-VBI levers shipped: **0**. The recommended smallest-safe-step combination (FE-VBI-1 through FE-VBI-8) was sized to ship in one session.

Status check on each FE-VBI lever (per audit):
- FE-VBI-1: backend wire `analyzeSlip()` into `/ingest` response → NOT SHIPPED
- FE-VBI-2: bettorLanguage `SHORT_SIGNAL_PHRASES` for chip labels → NOT SHIPPED
- FE-VBI-3: canonical TypeScript types for VBI verdict → NOT SHIPPED
- FE-VBI-4: `api.ts` `screenshotsAnalyze()` method → NOT SHIPPED
- FE-VBI-5: NEW `AnalyzeSlipView.tsx` section → NOT SHIPPED
- FE-VBI-6: NEW `VerdictCard.tsx` component → NOT SHIPPED
- FE-VBI-7: `Workstation.tsx` adds 📸 nav tab → NOT SHIPPED
- FE-VBI-8: helper unit `verifyVbiFeUploadSurface1A.js` → NOT SHIPPED

**VBI is server-side-complete and FE-side-zero.** This is the largest visible product gap: every paragraph of operator framing has named "bettor uploads screenshot → repo responds with deterministic predictive analysis" as the canonical Cowork-of-betting promise. The promise is technically deliverable today; the path from API to UI is unbuilt.

---

## SECTION 9 — MLB MATURITY ANALYSIS

MLB is mature in CURATION + REINFORCEMENT semantics but immature in two areas:

1. **Structural under-dominance still baked in.** `TIER_TEMPLATES.balanced.allowedSides: ["under"]` (line 519 of `buildSlipAi.js`). OE-14 was named in the offensive-ecology audit and explicitly deferred until OE-1A/1B behavior is observation-validated. The empirical 21.1% under-stack win rate is the symptom; the override is the cause. OE-1A/1B addressed by REWARDING upside (not by dropping the override). Long-run question: when does observation justify dropping the override?
2. **Bullpen feed dormant.** OE-13 ships with NEUTRAL fallback for `bullpenDataAvailable !== true`. The upstream `deriveMlbBullpenContext.js` is shape-stable but never populates real fragility data. Activating the bullpen feed is a Phase 1D-class effort that requires upstream ingest work.

For Phase BNSB-1A purposes: MLB is READY to surface. The current depth produces meaningful per-slip differentials (the OE-1B 61/61 integration smoke showed Boom Bat + Boom HR surfacing in explosive bucket with measurable reinforcement). MLB does not need more backend phases before the FE bridges; MLB needs the bridge first.

---

## SECTION 10 — NBA READINESS ANALYSIS

NBA has:
- `nbaCorrelationEngine` (pre-existing) — joint-prob adjustment + linkedStatFamilies + pace/total per-event meta
- `nbaAvailabilityCache` (canonical) — playerStatus taxonomy used by EXPL-4
- BC-2 `playerLegitimacyFactor` neutral fallback (0.70) — no MLB depth/teamTotal signals → neutral
- OE-2/3/4 neutral on NBA — no MLB run/team-total/wind/HR-tag signals → 0 boost
- OE-5/6/7 auto-empty on NBA — no MLB game-total/wind tags
- OE-8 ladderSurvivabilityFactor — partially functional (uses ladder height + PA proxy fields, but PA proxy is MLB-specific)

**NBA expansion is premature.** Why:
- The bridge work pattern (MLB-COV / VBI / BC / OE / OE-1B) is now a known canonical pattern, but NBA does NOT have the per-game ecological signals (windDirectionTag / hrEnvironmentTag / runEnvironment / impliedTeamTotal in MLB form) that those bridges depend on.
- NBA expansion needs an NBA-specific ecology audit ("what is the NBA equivalent of EXPLOSIVE — high-pace + high-total + high-usage stars?") — separate from MLB.
- Shipping NBA-parity now without the FE bridge in place means the operator can't even SEE whether NBA parity is working.

NBA can wait until after BNSB-1A. The FE bridge is the precondition for evaluating ANY future intelligence phase honestly.

---

## SECTION 11 — LONGITUDINAL LEARNING READINESS

Status: **NOT READY, but tantalizingly close.** Components present:
- `FAMILY_CALIBRATION_COEFFICIENTS` frozen May 5-9 (still — not refreshed across 20 phases)
- `runtime/tracking/mlb_tracked_slips_*.json` — 10 days, 657 multi-leg slips already tracked with `result` field
- `outcome_snapshots` SQLite table — Phase Persistence-1B operationalized
- `parsed_slips` + `slip_classifications` tables — 5-table Phase U schema applied; never populated by an operator upload (because no FE upload)
- `bettor_profiles` table — exists; never populated (no upload feed)
- `mlbCovStats` / `bc1aStats` / `oe1aStats` / `oe1bStats` / `oe11SlipStats` — per-run counters but no persistence

**The longitudinal learning question is moot until the FE bridges.** Without operator-visible per-slip / per-ladder-slot ROI feedback, there's no surface to validate adaptive coefficient refreshes. Shipping `FAMILY_CALIBRATION_COEFFICIENTS` refresh before the FE shows operator the calibration impact would be premature.

The right sequence: FE bridge first (BNSB-1A), then per-bucket / per-signal ROI retrospective surface (BNSB-1B class), then adaptive calibration (longitudinal class).

---

## SECTION 12 — TOP 5 ARCHITECTURAL BOTTLENECKS

In priority order:

1. **FE / backend surface asymmetry.** 20 backend phases vs 0 FE phases (since Phase Recommendation-Hierarchy-1A 2 weeks ago). Every backend phase widens the gap. Every payload field added is FE-ignored.
2. **No bettor-language consumer at the workstation level.** The 14-id phrase library + composeVerdictSummary live behind `analyzeSlip`; the daily slip cards render `slip.reasoning` (a pre-VBI field). The bettor-native voice that the VBI doctrine cemented exists for screenshot uploads only.
3. **No persisted longitudinal learning surface.** Per-run counters reset on every `buildFeaturedPlays`. No `mlbCovStats_history` / `bc1aStats_history` / `oe1bStats_history`. Operator can't ask "across last 30 days, how often did `mlb_pitcher_hitter_conflict` actually fire?" without grepping logs.
4. **Recommendation ladder grew to 9 slots; FE renders 7.** `RecommendationLadder.tsx` was shipped Phase Recommendation-Hierarchy-1A (7 slots). BC-6 added slot 8 (`bestBelievableUpside`). OE-7 added slot 9 (`bestExplosiveUpside`). The component was never extended. Slots 8 + 9 are payload-only.
5. **Under-dominance structural override.** `TIER_TEMPLATES.balanced.allowedSides: ["under"]`. OE-14 deferred. Not architecturally urgent given OE-1A/1B positive boost path, but the empirical 21.1% under-stack win-rate calibration mismatch is unresolved.

---

## SECTION 13 — MOST IMPORTANT NEXT PHASE

**Phase Bettor-Native Surface Bridge — BNSB-1A.**

**One phase. One purpose. One pattern (the same canonical-bridge pattern that's worked 4 consecutive times).**

The scope of BNSB-1A is purely additive FE work that consumes already-shipped backend payloads. Smallest-safe scope:

| BNSB-1A lever | Scope | Effort |
|---|---|---|
| Surface ladder slots 8 + 9 in `RecommendationLadder.tsx` | Component (~10 lines added) | TRIVIAL |
| Surface `bettorRealismScore` badge on Dashboard | Component + simple badge | SMALL |
| Surface `bettorLanguageSummary` phrases inside each SlipCard | `AiSlipsView.tsx` (~15 lines) | SMALL |
| Surface `[OE-1A] / [OE-1B] / [BC-1A]` per-run accounting as a Dashboard strip ("tonight's intelligence: 1 explosive event · 2 pressure boosts · 1 HR-carry boost") | NEW component or in existing KpiCards row | SMALL |
| Surface `oe11ReinforcementBoost` + `calibratedCombinedModelProb` on slip cards (audit-friendly reconciliation) | `SlipCard` extension | SMALL |
| **Upload Slip nav tab + AnalyzeSlipView + VerdictCard** (the entire FE-VBI-1 through FE-VBI-8 bundle from the prior audit) | 2 NEW files + 1 wired backend response field + nav tab entry | MEDIUM |

**Why this is the SINGLE highest-leverage direction:**

1. **Pattern proven 4× in a row.** MLB-COV-1A, VBI-1A, BC-1A, OE-1A all used the same "canonical engine exists; bridge to consumer surface is missing" gap pattern. BNSB-1A is the same pattern at the FE layer. No new architecture invented.
2. **Operator's stated concern is "getting lost in the weeds."** Every prior phase has been backend-tuning. Continuing produces compounding backend depth invisible to the bettor. The next phase MUST be the FE bridge or "in the weeds" becomes structural.
3. **Bettor-native promise.** The repo's stated identity ("show me if this ticket is smart" NOT "inspect backend diagnostics" per Visual-Betting-Intelligence doctrine) requires a bettor-facing surface. The screenshot uploader was audited, lever-menu approved, and never built. Build it.
4. **Validation precondition.** Longitudinal learning + NBA parity + bullpen activation + OE-14 structural under-flip all need operator-visible behavior to validate against. Without the FE bridge, every future phase ships blind.
5. **Zero new intelligence required.** Every signal BNSB-1A would surface is already on backend payloads. No new fetches. No new ML. No new persistence. No new schema. Just rendering.

---

## SECTION 14 — PHASE PRIORITY ORDER (next 5 sessions, opinionated)

This is opinionated. Honest. Sequential — not parallel.

1. **BNSB-1A** — FE bridge (this audit's recommendation). Lever bundle described in Section 13. Ship as ONE phase.
2. **BNSB-1B** — Per-bucket / per-ladder-slot ROI retrospective surface. Once BNSB-1A surfaces the canonical signals, the operator can start asking "which surfaces actually win?" This is the precondition for any future adaptive calibration.
3. **Bullpen ingest activation** (the canonical Phase 1B work referenced in `deriveMlbBullpenContext.js` line 28). Activating real bullpen data lets OE-13 finally fire with non-neutral fragility. Cleanest single-lever backend phase available.
4. **OE-14 observation gate** — operate the BALANCED `allowedSides: ["under"]` override under OE-1B telemetry. Decide: keep / drop / partial-flip. Data-driven decision once observation window is sufficient.
5. **NBA-specific ecology audit** — NBA needs its own audit. NOT MLB-cloned. Different signals (pace, usage, foul trouble, depth-chart minutes). Honest scoping.

What this list deliberately AVOIDS:
- Longitudinal calibration adaptive refresh (FAMILY_CALIBRATION_COEFFICIENTS) — premature without #2.
- NBA parity by cloning MLB phases — wrong shape; NBA needs its own audit, not MLB clones.
- Operator CLI tools (`curation:status` etc.) — until FE surfaces exist, CLI tools don't relieve the visibility bottleneck.
- Market psychology / dynamic sportsbook simulation / recursive explosion modeling — all out-of-scope per current operator framing.

---

## SECTION 15 — WHAT SHOULD WAIT

These directions are NOT wrong; they are WRONG-NOW:

| Direction | Why it should wait |
|---|---|
| NBA-parity ecology phases | Need NBA-specific signals + audit; cloning MLB is wrong shape. |
| Longitudinal adaptive calibration | Premature until per-signal ROI tracking exists (BNSB-1B precondition). |
| OE-14 structural under-flip | Premature without observation window of OE-1A/1B reward behavior. |
| OE-15 `buildBestOvers` symmetry | Wait to see if OE-6 explosive-upside bucket organically fills the symmetry. |
| Market-psychology / sportsbook-behavior modeling | Operator explicitly out-of-scope. Don't propose. |
| Per-stat-family legitimacy curves (BC-1F-class) | Premature without per-bucket ROI surface. |
| Bullpen ingest activation | Wait until BNSB-1A ships so the operator can SEE the bullpen signal differential. |
| Operator-tunable cap weights | Premature without observation window. |
| Cross-sport correlation engine extraction (MLB-COV-9) | Architectural cleanup; not bettor-visible value yet. |

---

## SECTION 16 — WHAT SHOULD NEVER BE BUILT

These are explicitly NOT bettor-native-betting-intelligence-operating-system directions:

1. **LLM / GPT narration for slip cards.** The bettorLanguage library is the canonical replacement. Adding GPT narration would violate every anti-fabrication invariant cemented across 20 phases.
2. **Celebrity / star-power weighting.** Operator explicitly forbidden in BC + OE phase prompts. Any "famous player gets a boost" logic is fabricated value.
3. **Dynamic sportsbook-behavior simulation.** Adaptive market-psychology modeling implies fabricated counter-models. The repo's edge comes from canonical signal composition, not from modeling opaque counterparty behavior.
4. **Adaptive payout shaping.** "Inflate joint probability to chase parlay payout" — explicitly forbidden across MLB-COV / OE-11. Fake SGP math is the anti-pattern.
5. **Recursive explosion logic.** Multi-level reinforcement loops produce uncontrolled inflation. Cap-and-stop is the doctrine; recursion is the anti-pattern.
6. **Hardcoded "tonight's lock" surface.** Hidden-value preservation forbids any "always-promoted" path. Every ranking is signal-derived, not fabricated.
7. **Auto-bet placement / sportsbook integration.** Out of scope per the operator's "betting intelligence" framing (advisory, not executor).
8. **Synthetic shadow predictions / fabricated calibration corpus.** Phase Grading-Calibration-Operations-1D explicitly forbade this.

---

## SECTION 17 — LONG-TERM PRODUCT IDENTITY

The repo is best described as:

> **A deterministic, anti-fabrication-disciplined, bettor-native intelligent betting operating system.**

The four words that matter most:
- **Deterministic** — every conclusion traces to canonical signals. Replay-safe. Auditable.
- **Anti-fabrication** — never invents probabilities, narratives, star scores, or confidence.
- **Bettor-native** — speaks the bettor's language. The customer is the operator at the workstation (and eventually their bettor end-user).
- **Operating system** — not a model. Not a slip generator. A system that takes raw markets + canonical context + bettor inputs and produces deterministic operator-readable intelligence.

This identity has been earned across 20 phases. The next phase (BNSB-1A) is the FE expression of this identity. Without it, the repo is a powerful backend pipeline that nobody can see.

---

## SECTION 18 — AUDIT INVARIANTS

- ✓ ZERO code patched in this audit.
- ✓ ZERO schema mutation proposed.
- ✓ ZERO scoring redesign proposed.
- ✓ ZERO 15-simultaneous-phase plan.
- ✓ ZERO LLM / GPT / opaque-ML recommendation.
- ✓ ONE recommended next phase (BNSB-1A); 4 follow-on phases sequenced honestly.
- ✓ Receipt + checkpoint state unaffected (audit is read-only).

---

## STATUS

Strategic audit complete. The recommendation is unambiguous: **Phase Bettor-Native Surface Bridge (BNSB-1A) — surface existing canonical signals into the existing 8-tab workstation. Same canonical-bridge pattern that worked four consecutive times. No new intelligence. No redesign. The FE catches up to what the backend already produces.**

Every alternative direction is either premature (longitudinal learning, NBA parity, bullpen activation), structural (OE-14), out-of-scope (market psychology), or actively forbidden by operator anti-fabrication doctrine (LLM narration, celebrity weighting, adaptive payout shaping).

The honest one-line answer to the operator's question — *"what should the repo become next?"*:

> **The repo should become VISIBLE to the bettor.**
