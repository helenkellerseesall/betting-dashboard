# OPERATOR RUNBOOK
**Single source-of-truth for daily repo operation. Phase Operator-Operations-1 (2026-05-14). Phase Realism-Ecology-1A appended 2026-05-14. Phase Market-Exploitation-1A appended 2026-05-16. Phase MLB-Correlation-Engine-1A appended 2026-05-16. Phase Visual-Betting-Intelligence-1A appended 2026-05-16. Phase Bettor-Curation-Intelligence-1A appended 2026-05-17. Phase Offensive-Ecology-Intelligence-1A appended 2026-05-17. Phase Offensive-Ecology-Intelligence-1B appended 2026-05-17. Phase Bettor-Native-Surface-Bridge-1A appended 2026-05-17. Phase Bettor-Native-Surface-Bridge-1B appended 2026-05-17.**

> If you remember nothing else: every operational verb is now an `npm run X` command. Run them from `backend/`. They print what they're about to do before doing it. No magic, no hidden state.

---

## BETTOR-NATIVE INTERACTION ARCHITECTURE DOCTRINE (Phase Bettor-Native-Surface-Bridge-1B, 2026-05-17)

**The FE workstation talks to the bettor like a smart friend who's already read the canonical signals — never like a build server. Every visible string traces to a canonical source. Every interaction path produces a backend-valid shape. The FE never makes promises the backend can't deliver.**

After BNSB-1A satisfied the strategic-audit DATA BRIDGE recommendation (every backend canonical field has a FE consumer), BNSB-1B addresses the INTERACTION ARCHITECTURE gap identified in `docs/BNSB_1A_POSTSHIP_REVIEW.md` and `docs/BETTOR_NATIVE_INTERACTION_AUDIT_2026-05-17.md`. The phase is pure FE — ZERO backend touched, ZERO new intelligence, ZERO ecology / calibration expansion.

| Lever | Doctrine | Source authority |
|---|---|---|
| **BNSB-1B-1 — PathPicker landing** | 4 entry cards (🛠 Build → routes to existing Bet Builder / 🔁 Borrow tonight's slip / 📋 Paste JSON / 🎯 Try a sample) replace the BNSB-1A JSON-textarea-as-default-landing pattern. The Build card honestly routes to the existing Bet Builder tab (BNSB-1B-5 build-leg-by-leg flow is operator-deferred — we do not fabricate a build flow that doesn't exist). | NEW `PathPicker` + `PickerCard` subcomponents in `frontend/src/workstation/sections/AnalyzeSlipView.tsx`. |
| **BNSB-1B-2 — rawText fabrication removed** | The BNSB-1A `body.slip = { rawText: raw }` JSON-parse fallback was a fabricated UX promise — `backend/pipeline/screenshots/normalizeIngestedSlip.js:260` only accepts shapes with `.player \|\| .statFamily \|\| .propText`. The fallback has been REMOVED; Paste path is honestly JSON-only with explicit recovery guidance. | `AnalyzeSlipView.tsx` Paste path. |
| **BNSB-1B-3 — Borrow tonight's slip** | NEW `BorrowTonight` subcomponent consumes existing `state.aiSlips.{safe/balanced/aggressive/lotto}` (ZERO new fetches); NEW `aiSlipToIngestShape(slip)` projects AI slip legs into canonical normalizeLeg field aliases; 1-click `🔍 Check this` per row. | `AnalyzeSlipView.tsx` BorrowTonight + BorrowRow + aiSlipToIngestShape. |
| **BNSB-1B-4 — Sample starter tickets** | NEW `frontend/src/workstation/sampleSlips.ts` exports 4 operator-approved canonical fixture slips — coherent HR stack / fake-safe UNDER / pitcher-hitter contradiction / explosive environment. Each shape backend-valid for `normalizeIngestedSlip`; 1-click loads + auto-analyzes; serves as VBI engine showcase + onboarding demo. | NEW `sampleSlips.ts` + NEW `SampleStarters` subcomponent in `AnalyzeSlipView.tsx`. |
| **BNSB-1B-6 — VerdictCard hero re-shape** | NEW `CoherenceRing` SVG donut (canonical ecologicalCoherence as visual 0-100 ring with tone-color); big `verdictSummary` headline; NEW "biggest takeaway" line surfaces top-priority `bettorLanguageSummary` phrase; compact `HeroLegLine` for strongest/weakest; `SummaryChip` row consolidates 7 derived chips with hover tooltips. Full 12-section forensic detail PRESERVED VERBATIM as collapsible drill-down (default closed; toggle "▸ Show the full breakdown" / "▾ Hide full breakdown"). Operator forensic capability not destroyed — only de-emphasized. | `VerdictCard.tsx` hero re-shape; CoherenceRing/HeroLegLine/SummaryChip subcomponents. |
| **BNSB-1B-7 — Intelligence sentence** | NEW `frontend/src/workstation/intelligenceSentence.ts` pure deterministic `composeIntelligenceSentence(stats)` helper composes one bettor-readable sentence ("Tonight: 3 explosive games tagged · 1 same-team stack reinforced · 1 fake-safe pair blocked.") from 14 canonical counter sources. Anti-fabrication: ONLY mentions counters > 0; returns null when no counter fires. Dashboard IntelligenceStrip refactored — sentence visible as primary; 13-chip strip collapsible (`[show details]` / `[hide details]`). | NEW `intelligenceSentence.ts` + refactored `IntelligenceStripBody` in `Dashboard.tsx`. |
| **BNSB-1B-8 — Cross-section "Analyze this"** | NEW `🔍 Analyze this` button on `AiSlipsView.SlipCard` dispatches `ws:analyze-slip` CustomEvent; `Workstation.tsx` listens via window event + captures `pendingAnalyzeSlip` state + routes to `section: "analyze"` + passes pending slip via `pendingSlip` prop + `onPendingConsumed` callback. AnalyzeSlipView auto-submits on receipt. Window-event pattern preserves component-tree shape — no new context provider; no architectural redesign. | `AiSlipsView.tsx` SlipCard + `Workstation.tsx` event listener + `AnalyzeSlipView.tsx` pendingSlip consumption. |
| **BNSB-1B-9 — Taxonomy stripped** | `ResultBlock` default header changed from `Slip #1 · ss_a1b2c3d4e5f6 · MLB · 3 legs · 🟢 sharp signal` to `Your slip · MLB · 3-leg · 🟢 sharp construction`. Raw `ss_*` submission hash + archetype taxonomy + composite score PRESERVED in tooltip only (hidden, not destroyed). Sharp/bait re-toned "construction". | `AnalyzeSlipView.tsx` ResultBlock. |
| **BNSB-1B-10 — Bettor-native tone** | Loading: "Reading your slip…". Network error: "The analysis service is offline right now. Try again in a moment." Parse error: "That isn't valid JSON. Try the Borrow path…". Empty: "I couldn't read that one. Try the Borrow or Sample path for a known-good shape." Engineer detail kept in `console.warn` only. | `AnalyzeSlipView.tsx` ResultPanel + submit error handler. |

**Operator-deferred (NOT shipped this phase, NOT future-blocking):**
- **BNSB-1B-5** — Build-leg-by-leg 4-tap flow (the Build path currently routes to existing Bet Builder tab; future phase may add a 4-tap flow inside AnalyzeSlipView).
- **BNSB-1B-11** — NAV label re-tone (analyst-vocabulary on the 8 prior tabs; cosmetic only).
- **BNSB-1B-12** — Explicit forensic-toggle on VerdictCard (existing tooltip + collapsible already provide forensic access).

**Operator-cemented DO-NOT-SHIP (anti-fabrication boundary, perpetual):**
- ❌ OCR / image upload infrastructure — backend dependencies (multer / formidable / tesseract / sharp / vision APIs) don't exist; FE must not pretend they do.
- ❌ LLM parsing / GPT narration — anti-fabrication doctrine violation.
- ❌ Adaptive AI styling / opaque ML — fabricated visual hierarchy.
- ❌ Mobile redesign — operator-deferred to future scoped phase.
- ❌ Persisted slip history — operator-deferred (BNSB-1C-class).

**Verify the bridge on demand:**
```bash
node backend/scripts/verifyBnsb1B.js
# Expected: 84 / 84 assertions PASS

cd frontend && npx tsc --noEmit
# Expected: clean (no output)
```

**Anti-fabrication checklist (operator-enforced throughout BNSB-1B):**
1. Every FE entry point produces a backend-valid shape — never `{rawText}` or any other fabricated payload.
2. The `composeIntelligenceSentence` helper mentions ONLY counters > 0; returns null on empty (caller renders honest "Tonight: no canonical-signal events surfaced" copy).
3. VerdictCard renders `verdict = null` honestly ("The analyzer didn't return a verdict for this slip…") — never synthesized.
4. Empty-state copy is bettor-spoken first-person ("I couldn't read that one"), never engineer-speak ("verify the slip payload shape").
5. Internal IDs (submission hash + archetype) accessible via tooltip ONLY — never default-rendered.
6. Network errors abstract URLs + status codes ("The analysis service is offline right now") — never `String(e?.message)`.
7. Sample slips use canonical field aliases only — never invented fields.
8. Cross-section nav is window-event-only — no new context provider; no architectural drift.

**Bettor-language for new surfaces (operator-approved phrasings, BNSB-1B-cemented):**
- "Check My Slip" (section title — bettor-native verb)
- "How do you want to check a slip?" (PathPicker prompt)
- "Reading your slip…" (loading)
- "The biggest takeaway:" (VerdictCard hero phrase prefix)
- "Show the full breakdown" / "Hide full breakdown" (forensic toggle)
- "show details" / "hide details" (IntelligenceStrip chip toggle)
- "Your slip" (ResultBlock label)
- "sharp construction" / "bait construction" (re-toned from sharp/bait "signal")
- "Tonight: N {events/boosts/stacks/...}." (intelligence sentence template)

---

## BETTOR-NATIVE SURFACE BRIDGE DOCTRINE (Phase Bettor-Native-Surface-Bridge-1A, 2026-05-17)

**FE workstation must surface every canonical signal the backend already produces — never re-derive, never synthesize, never invent. When backend ships intelligence, the FE bridges it; the FE never "fills in" missing values.**

After 20 backend-side phases established the intelligence substrate (BC-1A realism / OE-1A offensive ecology / OE-1B reinforcement / MLB-COV-1A covariance / VBI-1A canonical verdict resolver), `docs/STRATEGIC_PRODUCT_AUDIT_2026-05-17.md` identified the next-leverage gap as the FE workstation surface, not new backend capability. BNSB-1A is the pure FE-bridge phase that closes that gap.

| Lever | Doctrine | Source authority |
|---|---|---|
| **BNSB-1 — RecommendationLadder slots 8+9** | 9-slot fixed-cardinality ladder; 💡 BELIEVABLE UPSIDE (canonical `bestBelievableUpside` from BC-6) + 💥 EXPLOSIVE UPSIDE (canonical `bestExplosiveUpside` from OE-7). Honest "(no qualifying X tonight)" on empty — never fabricated. | `frontend/src/workstation/components/RecommendationLadder.tsx` POSITIVE_SLOTS extension. |
| **BNSB-2 — bettorRealismScore advisory pill** | 🧠 mood-pill rendering BC-8 score 0-100 with full canonical sub-component tooltip; tone class derived from canonical score (≥70 good / ≥40 neutral / else watch). Pure observational; FE never recomputes. | `IntelligenceStrip` in `frontend/src/workstation/sections/Dashboard.tsx`; consumes `state.aiSlipsSummary.bettorRealismScore`. |
| **BNSB-3 — bettorLanguageSummary chips** | 💬 chip row on SlipCard; renders only when backend supplies non-empty array (Array.isArray + length > 0). | `frontend/src/workstation/sections/AiSlipsView.tsx` SlipCard. |
| **BNSB-4 — Intelligence accounting strip** | 13 counter chips across 5 phases (OE-1A 5 + OE-1B 4 + BC-1A 2 + OE-11 2 + MLB-COV-1A 2); truthy > 0 guard suppresses zero counters; fully-empty payload → single dimmed advisory line. | Same `IntelligenceStrip` component. |
| **BNSB-5 — Reinforcement transparency ladder** | raw → calibrated → ✚ reinforced → final on SlipCard; gated on `Number.isFinite` per canonical field; OE-11 boost ✚ green when > 0, italic dim "no pairwise reinforcement applied" when explicitly 0. | `frontend/src/workstation/sections/AiSlipsView.tsx` SlipCard. |
| **BNSB-6 — AnalyzeSlipView + VerdictCard** | Operator pastes JSON or free text → `POST /api/ws/screenshots/ingest` pure passthrough; backend computes verdict; VerdictCard renders canonical 12-field VBI shape. FE does ZERO slip parsing (free text passes as `{ rawText }` for backend OCR-style parse). | NEW `frontend/src/workstation/sections/AnalyzeSlipView.tsx` + NEW `frontend/src/workstation/components/VerdictCard.tsx`. |
| **BNSB-7 — Analyze Slip nav tab** | "📸 Analyze Slip" tab in Workstation NAV + SectionId union extension + section router gate. | `frontend/src/workstation/Workstation.tsx`. |

**Supporting backend payload propagation (distinct from "backend logic change which is forbidden"):**
- FE-VBI-1 (`backend/pipeline/screenshots/screenshotRoutes.js`): returns `verdict` + `legsParsed` per ingest result. Anti-fabrication: `verdict = null` on resolver failure — never synthesized.
- FE-VBI-2 (`backend/pipeline/shared/bettorLanguage.js`): NEW `SHORT_SIGNAL_PHRASES` frozen sibling map (14 canonical SIGNAL_IDS → ≤50-char chip labels; cardinality matches `SIGNAL_PHRASES` exactly).
- `backend/pipeline/shared/buildSlipAi.js`: slip payload propagates `calibratedCombinedModelProb` + `oe11ReinforcementBoost` + `rawCombinedModelProb`.
- `backend/routes/workstationRoutes.js`: `aiSlipsSummary` extended with `bettorRealismScore` + `oe11SlipStats` + `mlbCovStats`.

**Verify the bridge on demand:**
```bash
node backend/scripts/verifyBnsb1A.js
# Expected: 131 / 131 assertions PASS

cd frontend && npx tsc --noEmit
# Expected: clean (no output)
```

**Anti-fabrication checklist (operator-enforced throughout):**
1. FE NEVER synthesizes a verdict, score, or counter. Every value derives from a backend canonical field rendered verbatim.
2. Counter chips render only when value > 0 (each chip's presence is itself the signal). Zero-valued counters never render.
3. Reinforcement ladder steps render only when `Number.isFinite` passes on the underlying canonical field. Absent fields skip the step.
4. `bettorLanguageSummary` chip row renders only when backend supplies a non-empty array.
5. VerdictCard renders "(none surfaced)" for every absent section. Never invents a stack, conflict, or signal.
6. AnalyzeSlipView free-text path falls through as `{ rawText }` — FE never parses player names, prop types, sides, or lines.
7. `verdict = null` from backend renders as "No verdict returned for this slip" — never synthesized.

**Future BNSB phases (operator-deferred, NOT shipped here):**
- BNSB-FE-VBI-screenshot-OCR — pasting an image (PNG/JPG) instead of JSON.
- BNSB-VBI-verdict-persistence — verdict outcomes for longitudinal grading.
- BNSB-personal-history-bridge — surface operator's settled-slip history alongside the verdict.

---

## OFFENSIVE-REINFORCEMENT DOCTRINE (Phase Offensive-Ecology-Intelligence-1B, 2026-05-17)

**Positive offensive REINFORCEMENT: canonical same-team hitter-OVER pairs in EXPLOSIVE environments earn small joint-prob boosts in `combineLegs`. Lineup-turnover-prone games softly elevate aggressive/lotto/explosive surfaces. Bullpen fragility softly boosts hitter overs late-game. ALL CAPS VERY TIGHT.**

After OE-1A taught the curator AWARENESS-LEVEL boost of favorable environments, OE-1B closes the gap on REINFORCEMENT. The canonical `pairCorrelationScore = +0.5` for same-team hitter OVERS (Phase MLB-Correlation-Engine-1A canonical truth) is finally consumed in slip composition — but VERY tightly capped.

| Lever | Doctrine | Source authority |
|---|---|---|
| **OE-11 — stackReinforcementScore (cap 0.03 aggregate)** | 7-gate AND: same-event + same-team + both OVER + isOffensiveAttackStat + pressureIndex>0.60 + EXPLOSIVE env per-leg + canonical pairCorrelationScore===+0.5. Per-pair cap 0.02; aggregate cap 0.03 in `combineLegs(legs, {stackReinforcementScore})`. Joint probability multiplied by `(1 + totalBoost)`. Auditable `calibratedCombinedModelProb` + `oe11ReinforcementBoost` exposed on slip return. Back-compat preserved (legacy callers without opts → 0 boost). | NEW `stackReinforcementScore` in `buildFeaturedPlays.js`; dependency-injected into `combineLegs` in `buildSlipAi.js` via `ctx.stackReinforcementScore`. |
| **OE-12 — lineupTurnoverPotential (cap 0.02 boost)** | Per-event aggregator: 0.35 depth fraction + 0.30 avg teamTotal/5.0 + 0.35 avg runEnv + 0.20 explosive upgrade. NEUTRAL 0.50 when no canonical signals. Sort-time additive boost cap 0.02 in `buildBestAggressive` + `buildSmartAggression` + `buildExplosiveUpsideTickets` ONLY. | NEW `lineupTurnoverPotential` + `buildLineupTurnoverIndex` + `lineupTurnoverBoost` in `buildFeaturedPlays.js`. |
| **OE-13 — bullpenFragilityContext (cap 0.02)** | Hitter OVERS only. Composes canonical bullpen fragility (when `bullpenDataAvailable === true`) AND late-game offensive support (`runEnvironment >= 0.55` AND `impliedTeamTotal >= 4.5`). Anti-fabrication: NEUTRAL `OE13_NEUTRAL_FRAGILITY=0.50` when bullpen feed dormant. | NEW `bullpenFragilityContext` in `buildFeaturedPlays.js`; integrated into `scoreCandidate` as additive boost alongside OE-3 + OE-4. |

**Operator-visible logs (rate-limited, one per run):**
```
[OE-1B] offensive reinforcement: N high-turnover event(s) · M pair-reinforcement boost(s) · K turnover-sort boost(s) · L bullpen-fragility boost(s)
[OE-1B] slip reinforcement: N slip(s) earned a same-team-hitter-OVER pair reinforcement (total boost magnitude X; per-slip cap 0.03)
```

**Verify the gates on demand:**
```bash
node backend/scripts/verifyOffensiveEcology1B.js
# Expected: 61 / 61 assertions PASS
```

**Anti-fabrication checklist (operator-enforced throughout):**
1. NO opaque ML / GPT scores / fake explosion narratives / momentum AI / invented confidence / hard-forcing overs / destroying hidden-value unders.
2. NO exponential boosts. NO parlay payout chasing. NO blanket same-team bonuses. NO fake SGP inflation.
3. Per-pair AND aggregate caps throughout (OE-11 per-pair 0.02 / aggregate 0.03; OE-12 0.02; OE-13 0.02).
4. NEUTRAL fallbacks when canonical signals absent (OE-12: 0.50; OE-13 bullpen: 0.50).
5. MLB-COV-2/3 hard blocks PRESERVED — OE-11 only fires on canonical +0.5 case the hard blocks DO NOT touch.
6. Hidden-value unders UNTOUCHED — all OE-1B helpers require `side === "over"`.
7. OE-14 (BALANCED `allowedSides: ["under"]` override drop) + OE-15 (`buildBestOvers`) explicitly DEFERRED.

**Doctrine in five lines:**
1. **Positive reinforcement** — canonical +0.5 same-team hitter-OVER score finally consumed in slip composition (cap 0.03 aggregate).
2. **Lineup turnover** — per-event aggregation drives aggressive/lotto/explosive surfaces (cap 0.02).
3. **Bullpen survivability** — anti-fabrication when feed dormant; only activates when fragility + late-game support align.
4. **Anti-fake-correlation** — per-pair AND aggregate caps; MLB-COV hard blocks preserved.
5. **Offensive chain-reaction** — small boost rewards coherent same-team-OVER stacks; never inflates aggressively.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1B** | OE-11 (stackReinforcementScore + combineLegs) + OE-12 (lineupTurnover + bucket consumption) + OE-13 (bullpenFragilityContext + scoreCandidate) + OE-1B field lift + verifyOffensiveEcology1B.js | 2026-05-17 | ✅ SHIPPED |
| 1C | OE-12 expansion — operator-tunable turnover-boost cap | — | Held |
| 1D | OE-13 expansion — bullpen feed activation (depends on upstream bullpen ingest) | — | Held |
| 1E | Longitudinal `[OE-1B]` counter persistence + retrospective ROI tracking | — | Held |
| 1F | Operator-tunable OE-11/12/13 caps via observation window | — | Held |
| 1G | OE-14 — drop / invert `TIER_TEMPLATES.balanced.allowedSides: ["under"]` MLB override | — | Held (structural; needs OE-1B behavior validated first) |
| 1H | OE-15 — `buildBestOvers` symmetric to `buildBestUnders` | — | Held |

**Discipline for every Offensive-Ecology-Intelligence-1B+ phase:**
1. Read `docs/OFFENSIVE_ECOLOGY_AUDIT_2026-05-17.md` Section 13 before approving the next lever.
2. Run full verification matrix (5/5 probes + 14/14 verify + helper unit + `brain:checkpoint`).
3. Never relax OE-11/12/13 caps without explicit operator-approval gate.
4. Anti-fabrication: never invent canonical fields; missing field → neutral fallback.
5. Pure observational / pure additive only — no new ML, no new persistence, no new fetches per phase unless explicitly approved.

---

## OFFENSIVE-ECOLOGY DOCTRINE (Phase Offensive-Ecology-Intelligence-1A, 2026-05-17)

**Positive symmetry to BC-4 hostile-environment soft-demote: REWARD believable upside environments rather than only PUNISH hostile ones. The curator narrows toward offensively explosive + believable + survivable rather than only suppressing chaos.**

Empirical anchor (audit-grade): 657 multi-leg slips in 10 days of `runtime/tracking/mlb_tracked_slips_*.json` → 338 (51.4%) all-UNDER vs 228 (34.7%) all-OVER (1.48× under-composition skew); settled subset 209 all-under graded at 21.1% win rate (calibration mismatch). Canonical-bridge gap: BC-4 (shipped) only soft-demoted hostile environments; nothing positive-boosted favorable ones. OE-1A is the canonical-bridge response.

| Lever | Doctrine | Source authority |
|---|---|---|
| **OE-1 — Canonical Realism+Env Lift** | Both `normalizeCandidate` paths preserve `runEnvironment`/`rbiEnvironment`/`windDirectionTag`/`carryShift`/`hrFactor`/`temperatureF`. Anti-fabrication: undefined when upstream absent. | `deriveMlbLineupContext.js` + `deriveMlbWeatherContext.js` + `deriveMlbParkContext.js`. |
| **OE-2 — offensivePressureIndex (5% weight)** | Composes `runEnvironment × oe2TeamTotalMultiplier(impliedTeamTotal) × oe2CarryShiftBonus(carryShift)` for HITTER OVERS ONLY. Neutral `OE2_NEUTRAL_PRESSURE=0.50` when canonical absent. NO celebrity scoring. NO ML. | NEW `offensivePressureIndex` in `backend/pipeline/shared/buildFeaturedPlays.js`. |
| **OE-3 — hrCarryEnvironment (+0.03 cap)** | HR OVERS only. 4-gate AND: wind-out + carryShift>0 + HR_FRIENDLY + temp≥75. Zero when any absent. Positive symmetry to BC-4 HR_SUPPRESSING soft-demote. | NEW `hrCarryEnvironment` in `buildFeaturedPlays.js`. |
| **OE-4 — correlatedRunProduction (+0.03 cap)** | Runs/RBIs OVERS at top-of-order (lineupSpot 1-4) + runEnv OR rbiEnv ≥0.55. Zero when canonical absent. | NEW `correlatedRunProduction` in `buildFeaturedPlays.js`. |
| **OE-5 — explosiveEnvironmentTag** | Per-event aggregator. Gates: `gameTotal≥9.5` AND `avg(impliedTeamTotal)≥4.5` AND `windDirectionTag ∈ wind-out set` AND no `HR_SUPPRESSING`. Returns `Map<eventId, true>`. Pure observational. | NEW `buildExplosiveEnvironmentIndex` in `buildFeaturedPlays.js`. |
| **OE-6 — buildExplosiveUpsideTickets** | Surfaces top-5 hitter-OVER candidates from EXPLOSIVE-tagged events. Auto-empty when no qualifying event. Mirrors BC-5 doctrine. | NEW bucket in `buildFeaturedPlays.js`. |
| **OE-7 — Recommendation Ladder Slot 9** | NEW `bestExplosiveUpside` (9 slots total). `pickFirstUnique` dedup walk. Existing 8 slots preserved verbatim. | `buildRecommendationLadder` in `buildFeaturedPlays.js`. |
| **OE-8 — ladderSurvivabilityFactor + soft-demote** | Composes `ladderHeightFactor × paFactor × runEnvFactor × hrCarryFactor`. Soft demote -0.04 cap when factor < 0.4. Applied sort-time inside `buildBestLadders` (additive on top of BC-4 demote; never mutates composite). | NEW `ladderSurvivabilityFactor` + `ladderSurvivabilityDemote` in `buildFeaturedPlays.js`. |
| **OE-9 — Operator-Visible Ecology Log** | 5-dimension `_oe1aStats` counter (explosiveEventsTagged / pressureBoostsApplied / hrCarryBoostsApplied / runProductionBoostsApplied / survivabilityDemotesApplied). Per-run reset + emit when any fires. | `resetOe1aStats` / `getOe1aStats` in `buildFeaturedPlays.js`. |

**Operator-visible log (rate-limited, one per `buildFeaturedPlays` run):**
```
[OE-1A] offensive ecology: N explosive event(s) tagged · M pressure boost(s) · K HR-carry boost(s) · L run-production boost(s) · P ladder-survivability demote(s)
```

**Verify the gates on demand:**
```bash
node backend/scripts/verifyOffensiveEcology1A.js
# Expected: 101 / 101 assertions PASS
```

**Anti-fabrication checklist (operator-enforced throughout):**
1. NO opaque ML / GPT-generated scores / fake explosion narratives / celebrity weighting / unsupported momentum AI / invented confidence.
2. Every boost derives from canonical signal already populated on row context by existing context enrichers.
3. Small caps throughout (OE-2 5%; OE-3 +0.03; OE-4 +0.03; OE-8 -0.04).
4. Neutral fallbacks when canonical absent (OE-2: 0.50; OE-3/4: 0; OE-5: empty Map; OE-6: empty bucket; OE-8: factor=1.00 neutral).
5. Under-side legs UNTOUCHED by OE-2/3/4 (preserves hidden-value unders).
6. OE-11 (joint-prob inflation in `combineLegs`), OE-12 (lineupTurnover), OE-13 (bullpen activation), OE-14 (BALANCED under-only override drop), OE-15 (`buildBestOvers`) are explicitly DEFERRED. 1A is observational + small-cap additive ONLY.

**Doctrine in seven lines:**
1. **Offensive ecology** — favorable environments earn additive boosts symmetric to BC-4 hostile-soft-demote.
2. **Explosive-environment** — per-event aggregation tags games likely to detonate; deterministic from canonical fields; observational only.
3. **Ladder survivability** — ladder targets respect PA proxy + run environment + HR carry.
4. **Believable upside** — every boost has neutral fallback; small caps; existing factors UNCHANGED.
5. **Anti-chaos ticket** — under-dominance addressed by REWARDING upside (not by hard-forcing overs or destroying unders).
6. **Observational-only OE-1A** — joint-prob inflation deferred; never compounds prob math.
7. **Canonical-authority-first** — same bridge pattern as MLB-COV / VBI / BC; every weight from canonical signal already populated on rows.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | OE-1 (lift) + OE-2 (pressure 5%) + OE-3 (HR-carry +0.03) + OE-4 (run-prod +0.03) + OE-5 (per-event tag) + OE-6 (bucket) + OE-7 (ladder slot 9) + OE-8 (survivability -0.04) + OE-9 (log) + OE-10 (fixture) | 2026-05-17 | ✅ SHIPPED |
| 1B | OE-11 — `stackReinforcementScore` in `combineLegs` (joint-prob adjustment for canonical +0.5 same-team OVER pairs) | — | Held |
| 1C | OE-12 — `lineupTurnoverPotential` targeted at top-of-order same-team pairs | — | Held |
| 1D | OE-13 — `bullpenFragilityContext` activation (depends on upstream bullpen feed wiring) | — | Held |
| 1E | Longitudinal `[OE-1A]` counter persistence + retrospective ROI tracking | — | Held |
| 1F | Operator-tunable OE-1 / OE-4 / OE-8 weights via observation window | — | Held |
| 1G | OE-14 — drop / invert `TIER_TEMPLATES.balanced.allowedSides: ["under"]` MLB override | — | Held (structural; needs OE-1A behavior validated first) |
| 1H | OE-15 — `buildBestOvers` symmetric to `buildBestUnders` | — | Held (observe whether OE-6 fills it) |

**Discipline for every Offensive-Ecology-Intelligence phase:**
1. Read `docs/OFFENSIVE_ECOLOGY_AUDIT_2026-05-17.md` Section 13 before approving the next lever.
2. Capture pre/post snapshots in `backend/runtime/operator/baseline_snapshots/` when env-weighting evolution is involved.
3. Run full verification matrix (5/5 probes + 14/14 verify + helper unit + `brain:checkpoint`).
4. Never relax OE-2 / OE-3 / OE-4 / OE-8 caps without explicit operator-approval gate.
5. Anti-fabrication: never invent canonical fields; missing field → neutral fallback.
6. Pure observational / pure additive only — no new ML, no new persistence, no new fetches per phase unless explicitly approved.

---

## BETTOR-CURATION DOCTRINE (Phase Bettor-Curation-Intelligence-1A, 2026-05-17)

**Realism-weighted curation: the curator NARROWS rather than ENUMERATES. Every realism weight derives from canonical signal already populated on MLB rows by existing context enrichers. NO celebrity scoring. NO ML. NO narrative AI.**

Backup-level / replacement-tier hitters were structurally out-promoting top-of-order stars because `bestDisagreementEdges` sorted purely by `|delta|` with no player-legitimacy weighting, `scoreCandidate` consulted ZERO canonical role/lineup/PA/environment signals, and both `normalizeCandidate` functions dropped the canonical fields on the floor. Phase Bettor-Curation-Intelligence-1A bridges these canonical signals into the curator via 8 deterministic additive levers.

| Lever | Doctrine | Source authority |
|---|---|---|
| **BC-1 — Canonical Realism-Field Lift** | Both `normalizeCandidate` paths preserve `lineupSpot`/`depth`/`plateAppearancesProxy`/`impliedTeamTotal`/`gameTotal`/`hrEnvironmentTag`/`contextualTags`. Anti-fabrication: undefined when upstream absent. | `pipeline/mlb/context/deriveMlbLineupContext.js` + `deriveMlbParkContext.js` + `composeMlbContextualSignal.js`. |
| **BC-2 — playerLegitimacyFactor (7% weight)** | Depth × teamTotal ramp; neutral 0.70 fallback when canonical absent. NO celebrity scoring. NO fabricated confidence. | NEW `playerLegitimacyFactor` in `backend/pipeline/shared/buildFeaturedPlays.js`. |
| **BC-4 — Believable-Upside Soft-Demote** | Sort-time -0.05 effective composite when `hrEnvironmentTag === "HR_SUPPRESSING"` OR `impliedTeamTotal < 3.5`. Never mutates `x.score.composite`. Soft gate; never hard-rejects hidden value. | NEW `believableUpsideDemote` applied inside `buildBestHr` / `buildBestLadders` / `buildBestAggressive`. |
| **BC-5 — buildBelievableUpsideTickets** | Pure observational bucket. Gates: `depth ∈ {top, middle}` AND `impliedTeamTotal >= 4.5` AND `hrEnvironmentTag !== "HR_SUPPRESSING"`. Auto-empty when canonical signals absent. | NEW bucket in `buildFeaturedPlays.js`. |
| **BC-6 — Recommendation Ladder Slot 8** | NEW `bestBelievableUpside` slot (8 slots total). `pickFirstUnique` dedup walk. Null when bucket empty/dedup-exhausted. Existing 7 slots preserved verbatim. | `buildRecommendationLadder` in `buildFeaturedPlays.js`. |
| **BC-7 — Anti-Replacement Anchor Corroborator** | 7th corroborator inside `buildAnchors` strict gate: `depth ∈ {top, middle}` OR `impliedTeamTotal >= 4.5`. ADDITIVE — never removes any existing corroborator; never blocks an anchor that would clear on existing 6 alone. | NEW `isAntiReplacementCorroborator` in `buildFeaturedPlays.js`. |
| **BC-8 — bettorRealismScore (advisory)** | Per-`buildAiSlips`-run aggregate. Sub-weights: 0.40 depth-coverage + 0.30 avg-teamTotal/5.0 + 0.15 gameTotal-favorability + 0.15 hrEnv-favorability (sum = 1.0). Null on empty pool. Never blocks. | NEW `computeBettorRealismScore` in `backend/pipeline/shared/buildSlipAi.js`. |
| **BC-9 — Operator-Visible Realism Log** | `[BC-1A] realism gate: soft-demoted N HR-suppressing-park + M desert-team-total candidate(s)` emitted once per `buildFeaturedPlays` run when any demote fired. Counters reset per run. | `_bc9Stats` + `resetBc1aStats` / `getBc1aStats` in `buildFeaturedPlays.js`. |

**Verify the gates on demand:**
```bash
node backend/scripts/verifyBettorCuration1A.js
# Expected: 83 / 83 assertions PASS
```

**Anti-fabrication checklist (operator-enforced throughout):**
1. NO new "star scores" / celebrity weighting / narrative AI / invented confidence.
2. Every demotion / promotion derives from canonical signal already populated on row context.
3. Soft gates throughout (BC-2 7% weight; BC-4 -0.05; BC-7 additive corrob; BC-8 advisory; BC-9 observability) — NEVER hard-rejects.
4. Neutral fallbacks when canonical signals absent (BC-2: 0.70; BC-4: 0 demote; BC-5: empty bucket; BC-7: false; BC-8: null score).
5. BC-3 (back-of-order disagreement edge demote) is DEFERRED to 1B — operator wants observation-window data first before tightening disagreement.

**Doctrine in six lines:**
1. **Bettor-curation** — the curator NARROWS, never ENUMERATES.
2. **Bettor-realism** — legitimate offense gently promoted; replacement gently demoted; absent signals → neutral fallback.
3. **Believable-upside philosophy** — NEW observational bucket surfaces depth + teamTotal + park-environment alignment; never blocks existing surfaces.
4. **Anti-overenumeration** — soft gates suppress noise; never hard-rejects hidden value.
5. **Realism-weighted curation philosophy** — every realism signal reuses existing canonical authority; curator composes, never duplicates.
6. **Canonical-authority-first** — same bridge pattern as MLB-Correlation-Engine-1A + Visual-Betting-Intelligence-1A.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | BC-1 (lift) + BC-2 (legitimacy 7%) + BC-4 (soft-demote 0.05) + BC-5 (bucket) + BC-6 (ladder slot 8) + BC-7 (corroborator) + BC-8 (realism score) + BC-9 (log) | 2026-05-17 | ✅ SHIPPED |
| 1B | BC-3 — back-of-order disagreement edge demote (observe BC-1A real-slate behavior first) | — | Held |
| 1C | BC-11 — `npm run curation:status` operator CLI | — | Held |
| 1D | BC-10 — cashout-pressure scoring | — | Held (out-of-scope per operator) |
| 1E | Per-bucket retrospective ROI tracker for empirical legitimacy validation | — | Held |
| 1F | Operator-tunable BC-2 weight (5% / 7.5% / 10%) via observation-window calibration | — | Held |
| 1G | Per-stat-family legitimacy curves (hits/TB/runs respond differently to depth) | — | Held |

**Discipline for every Bettor-Curation-Intelligence phase:**
1. Read `docs/BETTOR_CURATION_AUDIT_2026-05-17.md` Section 10 before approving the next lever.
2. Capture pre/post snapshots in `backend/runtime/operator/baseline_snapshots/` (when ranking-shape evolution is involved).
3. Run full verification matrix (5/5 probes + 14/14 verify + helper unit + `brain:checkpoint`).
4. Never relax BC-2 / BC-4 / BC-5 thresholds without explicit operator-approval gate.
5. Anti-fabrication: never invent canonical fields; missing field → neutral fallback (smallest-safe-step: better to neutral than to fabricate).
6. Pure observational / pure additive only — no new ML, no new persistence, no new fetches per phase unless explicitly approved.

---

## VISUAL-BETTING-INTELLIGENCE DOCTRINE (Phase Visual-Betting-Intelligence-1A, 2026-05-16)

**Bettor uploads a slip → deterministic canonical-signal-backed analysis. The repo never responds like ChatGPT.**

The screenshot ingestion infrastructure already existed (`/api/ws/screenshots/*` routes; 5-table schema; pure-function normalizer + classifier). Phase Visual-Betting-Intelligence-1A bridges that infrastructure to the canonical repo intelligence shipped in the last three phases (MLB-COV + EXPL + market-supported disagreement).

| Module | Doctrine | Source authority |
|---|---|---|
| **VBI-2 — Canonical Prediction Resolver** | Every screenshot leg deterministically maps to canonical `predictionId` via `intelligence.predictionId()`. Anti-fabrication: explicit `UNRESOLVED_REASONS` taxonomy. | NEW `backend/pipeline/shared/resolveSlipLegToPrediction.js`. |
| **VBI-3 — Slip Analysis Engine** | Pure composition of canonical engines: `pairCorrelationScore` (MLB-COV-1/3) + role predicates (MLB-COV-2) + `marketSupportFor` (EXPL-1) + `candidateIsHardDropAvailability` (EXPL-4). No new math. | NEW `backend/pipeline/shared/buildSlipAnalysis.js`. |
| **VBI-4 — Bettor-Language Library** | 14 canonical signal IDs → operator-approved phrases. **NO LLM. NO GPT. ZERO opaque prose.** Unknown ids silently dropped (anti-fabrication). | NEW `backend/pipeline/shared/bettorLanguage.js`. |
| **VBI-8 — Canonical Verdict Payload Shape** | 12-field frozen `VERDICT_PAYLOAD_SHAPE` constant — single source of truth for FE / persistence / CLI consumers. | Exported from `resolveSlipLegToPrediction.js`. |
| **VBI-6 — Verification Fixture** | 76 deterministic assertions across 4 canonical operator-named fixture slips: coherent stack / Coors fake-safe UNDER / pitcher-K vs hitter contradiction / unsupported disagreement bait. | NEW `backend/scripts/verifyVisualBettingIntelligence1A.js`. |

**Deterministic ecologicalCoherence formula** (in `buildSlipAnalysis.js`):
```
score = 1.0
     - 0.50 × contradictionFlags.length
     - 0.10 × unresolvedLegs.length
     - 0.05 × exploit_unsupportedSolo.length
     - 0.25 × avail_hardDropOut.length
     + 0.05 × positiveStacks.length
clamp(0, 1, score)
```

**Sample bettor-language phrases (operator-approved, deterministic):**
- `shared_game_suppression_exposure` → "This ticket dies together if the game stays quiet — both legs ride the same pitcher/game environment."
- `mlb_pitcher_hitter_conflict` → "Structural contradiction: pitcher-strikeout over and opposing hitter over bet against each other."
- `positive_offensive_stack` → "This stack reinforces itself offensively — same-team hitter overs benefit from the same opposing pitcher."
- `market_supported_disagreement` → "Multiple books agree this is a real edge — peer consensus backs the disagreement."
- `fake_safe_same_game_exposure` → "Fake-safe construction: this looks like multiple independent safety paths but is really one ecological event."

**Verify on demand:**
```bash
node backend/scripts/verifyVisualBettingIntelligence1A.js
# Expected: 76 / 76 assertions PASS
```

**Doctrine in five lines:**
1. **Visual betting intelligence** — bettor uploads slip → deterministic repo-native predictive analysis. Never ChatGPT.
2. **Screenshot interpretation philosophy** — every conclusion is a pure function of canonical signals; no LLM, no fabricated probabilities, no invented player mappings.
3. **Deterministic bettor-language doctrine** — every bettor-facing phrase traces to a canonical signal ID; operator-approved phrasings only.
4. **Canonical screenshot authority** — `intelligence.predictionId` + `pairCorrelationScore` + `marketSupportFor` + `candidateIsHardDropAvailability` + `bettorLanguage` form the complete authority chain.
5. **Anti-fabrication screenshot doctrine** — unresolved legs annotated via `UNRESOLVED_REASONS`; missing context emits canonical `*_unavailable` signal; unknown signal IDs silently dropped; NEVER invents fields, probabilities, or phrases.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | VBI-2 (resolver) + VBI-3 (analysis engine) + VBI-4 (bettor-language) + VBI-6 (fixture) + VBI-8 (verdict shape) | 2026-05-16 | ✅ SHIPPED |
| 1B | VBI-1 — JSON-paste FE bless / docs surface | — | Held |
| 1C | VBI-5 — persist `verdict_json` to `parsed_slips` via `ALTER TABLE` | — | Held |
| 1D | VBI-7 — minimal FE upload card | — | Held |
| 1E | VBI-9 — `bettor_profiles` longitudinal accumulation | — | Held |
| 1F | VBI-10 — multipart upload + Tesseract OCR | — | Held |
| 1G | VBI-11 — social-ticket clustering | — | Held |
| 1H | VBI-12 — longitudinal screenshot ROI learning | — | Held |

---

## MLB-CORRELATION DOCTRINE (Phase MLB-Correlation-Engine-1A, 2026-05-16)

**Deterministic same-game ecological covariance gates wired into the canonical workstation slip composer. Reuses EXISTING canonical correlation engine; no new math.**

The slip composer (`backend/pipeline/shared/buildSlipAi.js`) was historically independent-leg intelligence for MLB. The canonical `backend/pipeline/mlb/buildMlbCorrelationEngine.js:117-128` already encoded pitcher-K vs hitter-counting anti-correlation as `-1.0` for the cluster path; Phase MLB-Correlation-Engine-1A bridges that knowledge into `canAddLeg()`.

| Gate | Doctrine | Source authority |
|---|---|---|
| **MLB-COV-1 — Canonical Engine Bridge** | `buildSlipAi.js` consumes the SAME canonical truth that the MLB cluster engine uses. Anti-duplication: never redefine MLB correlation math in the slip composer. | NEW lazy `getMlbCorr()` in `buildSlipAi.js`; additive exports `isOverSide` / `isUnderSide` / `isHitterCountingProp` / `isPitcherKProp` / `isHomeRunsProp` from `buildMlbCorrelationEngine.js`. |
| **MLB-COV-2 — Shared-Game Suppression** | A single ecological event (pitcher dominance day, park run environment) must not masquerade as multiple independent safety paths. Empirical anchor: the 2026-05-15 ARI@COL Vargas+Goodman both-UNDER-1.5-hits SAFE 2-leg loss at Coors. | NEW gate in `canAddLeg()` — when candidate is hitter-counting UNDER + any same-game slipLeg is also hitter-counting UNDER → BLOCK with canonical reason `shared_game_suppression_exposure`. |
| **MLB-COV-3 — Role-Aware Pitcher↔Hitter Conflict** | Pitcher-K-OVER and opposing hitter-counting-OVER bet on the SAME uncertain outcome (opposing pitcher's K rate). They cannot both be right unless the model is using strictly different information. | NEW gate in `canAddLeg()` — when canonical `pairCorrelationScore(a, b) ≤ -0.99` (opposing teams; both sides OVER) → BLOCK with canonical reason `mlb_pitcher_hitter_conflict`. |

**Where the gates live (canonical authority):**

| Surface | Function | Authority |
|---|---|---|
| `backend/pipeline/mlb/buildMlbCorrelationEngine.js` | `pairCorrelationScore(a, b)` | Returns -1.0 / -0.5 / 0 / +0.5. Single source for MLB pair-cov truth. |
| `backend/pipeline/mlb/buildMlbCorrelationEngine.js` | `isOverSide` / `isUnderSide` / `isHitterCountingProp` / `isPitcherKProp` / `isHomeRunsProp` | Role predicates — same definitions used by cluster engine. |
| `backend/pipeline/shared/buildSlipAi.js` | `getMlbCorr()` | Lazy MLB-correlation loader (mirrors NBA pattern at lines 78-81). |
| same file | `canAddLeg(slipLegs, candidate, tpl)` | MLB-COV-2/3 gates fire here, AFTER `script_correlation`, gated by `!tpl.skipScriptCorrelation`. |
| same file | `MLB_COV_REASON_SHARED_GAME_SUPPRESSION` / `MLB_COV_REASON_PITCHER_HITTER_CONFLICT` | Canonical reason constants returned in `{ ok: false, reason }`. |
| same file | `resetMlbCovStats()` / `getMlbCovStats()` | Per-invocation counter helpers. `mlbCovStats` returned on `buildAiSlips()` payload. |

**Sport-gating discipline:** all three gates sit inside `if (gk && !tpl.skipScriptCorrelation)` — NBA tier templates set `skipScriptCorrelation: true` (lines 474 / 483) and bypass the entire MLB block. **NBA correlation path UNCHANGED.**

**Smallest-safe-step boundaries:**
- Same-team pitcher-K + hitter pair (canonical -0.5 score) NOT blocked yet — future phase may tighten.
- Pitcher-K-UNDER + opposing hitter-OVER scope deferred — future phase.
- Cross-game UNDER pairs NOT blocked — gates are same-game only.
- Same-team hitter-OVER stacks (canonical +0.5 positive cov) PRESERVED — legitimate offensive amplification untouched.

**Operator-visible warning emitted at end of each `buildAiSlips()` invocation when any gate fired:**
```
[MLB-COV-1A] suppressed N shared_game_suppression_exposure + M mlb_pitcher_hitter_conflict during slip composition
```

**Verify the gate logic on demand:**
```bash
node backend/scripts/verifyMlbCorrelationEngine1A.js
# Expected: 37 / 37 assertions PASS
```

**Doctrine in six lines:**
1. **Deterministic covariance intelligence** — every block is a pure function of canonical fields + the canonical engine score. No ML. No black box.
2. **Same-game ecological suppression** — a single ecological event must not masquerade as multiple independent safety paths.
3. **Role-aware anti-correlation suppression** — pitcher↔opposing-hitter overs hard-block at `canAddLeg`; never soft-warn.
4. **Parlay survivability philosophy** — improving 2-3 leg survivability comes from eliminating toxic same-game exposure, not from broader leg admission.
5. **Canonical-authority-first** — `buildMlbCorrelationEngine.js` is single source for MLB pair-cov truth; predicates are exported, never duplicated in `buildSlipAi.js`.
6. **Smallest-safe-step** — only the strict operator-named subsets ship in 1A; everything else is queued.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | MLB-COV-1 (canonical bridge) + MLB-COV-2 (shared-game UNDER suppression) + MLB-COV-3 (role-aware pitcher-hitter conflict) | 2026-05-16 | ✅ SHIPPED |
| 1B | MLB-COV-4 — high-game-total HR clustering boost | — | Held |
| 1C | MLB-COV-5 — `hrEnvironmentTag` lift + park-aware UNDER-stack penalty | — | Held |
| 1D | MLB-COV-6 — bullpen-collapse ecology (gated on Phase 1B bullpen activation) | — | Held |
| 1E | MLB-COV-7 — weather covariance weighting (wind-out + game-total amplification) | — | Held |
| 1F | MLB-COV-8 — longitudinal covariance ROI learning (persisted block-log → 30-day retrospective) | — | Held |
| 1G | MLB-COV-9 — extract shared `pipeline/shared/mlbCorrelationEngine.js` consulted by both cluster + slip paths | — | Held |

**Discipline for every MLB-Correlation-Engine phase:**
1. Read `docs/MLB_CORRELATION_AUDIT_2026-05-16.md` Section 11 before approving the next lever.
2. Capture pre/post snapshots in `backend/runtime/operator/baseline_snapshots/` (when slip-shape evolution is involved).
3. Run full verification matrix (5/5 probes + 14/14 verify + helper unit + `brain:checkpoint`).
4. Never relax MLB-COV-2/3 thresholds without an explicit operator-approval gate.
5. Anti-fabrication: never invent canonical fields; missing field → no false block (smallest-safe-step: better to allow than to fabricate).
6. Pure observational — no new scoring, no new ML, no new persistence, no new API calls per phase unless approved.
7. NBA correlation path stays untouched (skipScriptCorrelation gate is the architectural seal).

---

## MARKET-EXPLOITATION DOCTRINE (Phase Market-Exploitation-1A, 2026-05-16)

**Fake-edge suppression at the canonical featured-play ingest: consensus-support gate (EXPL-1) + availability hard-filter (EXPL-4).**

The recommendation ladder no longer consumes disagreement / stale-line signals symmetrically. Two deterministic gates run BEFORE the existing |delta| / odds-magnitude sort semantics:

| Gate | Doctrine | Source authority |
|---|---|---|
| **EXPL-1 — Consensus-Support Gate** | A disagreement edge surfaces ONLY when BOTH `bookCount >= 3` AND `consensusConfidence >= 0.6`. Single-book outliers and split-market noise are suppressed. Surviving plays receive canonical `processNote` `"market-supported disagreement"` (soft_line side) or `"market-supported overprice"` (stale_line / AVOID side) appended via ` · ` separator. | `shopMap` byProp entries' canonical `bookCount` + `consensusConfidence` fields (`buildLineShoppingIntelligence.js:188 + :214`). |
| **EXPL-4 — Availability Hard-Filter** | Candidates with canonical `playerStatus === "out"` are dropped at the `buildFeaturedPlays` main-entry choke point AND from the staleRows source. The availability index is built from the PRE-filter normalized list so staleRows for the same OUT player are gated symmetrically. MLB candidates carry no canonical `playerStatus` → filter is honest no-op (anti-fabrication). | `pipeline/nba/nbaAvailabilityCache.enrichRowWithAvailability` canonical taxonomy: `out / doubtful / questionable / probable / active / unknown`. |

**Where the gates live (canonical authority):**

| Surface | Function | Authority |
|---|---|---|
| `backend/pipeline/shared/buildFeaturedPlays.js` | `marketSupportFor(staleRow, shopMap)` | EXPL-1 deterministic eligibility resolver. |
| same file | `staleRowLookupKey(staleRow)` | EXPL-1 shopMap key constructor (player + normFam(propType) + side + line). |
| same file | `candidateIsHardDropAvailability(c)` | EXPL-4 canonical-OUT detector (case-insensitive Set lookup). |
| same file | `staleRowIsHardDropAvailability(s, idx)` | EXPL-4 staleRow-side OUT gate. |
| same file | `buildAvailabilityIndex(normalized)` | EXPL-4 player→status index builder (first-seen wins; status omission → exclusion). |
| same file | Constants `EXPL1_MIN_BOOK_COUNT=3`, `EXPL1_MIN_CONSENSUS_CONFIDENCE=0.6`, `EXPL4_HARD_DROP_STATUSES=Set("out")` | Operator-tunable in future phase (held). |

**Operator-visible warnings emitted on every run that drops:**
- `[EXPL-4] dropped N candidate(s) at featured-play ingest — canonical playerStatus="out" (anti-stale-player doctrine)`
- `[EXPL-4] dropped N staleRow(s) — canonical playerStatus="out" (stale availability invalidation)`
- `[EXPL-1] suppressed X soft + Y stale candidates lacking market-support floor (bookCount>=3 & consensusConfidence>=0.6)`

**Verify the gate logic on demand:**
```bash
node backend/scripts/verifyMarketExploitation1A.js
# Expected: 40 / 40 assertions PASS
```

**Doctrine in five lines:**
1. **Market-supported disagreement** — peer-book corroboration is a prerequisite for any disagreement edge surfacing.
2. **Availability authority is single-sourced** — `pipeline/nba/nbaAvailabilityCache` owns the canonical taxonomy; filters consult it; never duplicate it.
3. **Anti-fabrication on unknown** — a player absent from the availability cache is "no signal", NOT "active by default".
4. **Exploitability gates compose with sort** — filters fire BEFORE the existing sort, preserving operator-visible bucket-shape contracts.
5. **Operator-visible suppression accounting** — every drop is logged so the operator can quantify nightly noise suppression.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | EXPL-1 (consensus-support gate on 3 staleRow buckets) + EXPL-4 (availability hard-filter at ingest + staleRow layer) | 2026-05-16 | ✅ SHIPPED |
| 1B | EXPL-2 — refresh `FAMILY_CALIBRATION_COEFFICIENTS` from rolling `calibration_records` window | — | Held |
| 1C | EXPL-3 — disagreement-edge ROI persistence (`recommendation_ladder_outcomes.jsonl`) | — | Held |
| 1D | EXPL-5 — per-(book × stat-family) ROI elevated into ranking | — | Held |
| 1E | EXPL-6 — trap-detection track record via Bayesian confidence band | — | Held |
| 1F | EXPL-7 — MLB correlation engine | — | Held |
| 1G | EXPL-8 — portfolio optimization across slots | — | Held |
| 1H | EXPL-9 — slot historical ROI tracking + adaptive priority weights | — | Held |

**Discipline for every Market-Exploitation phase:**
1. Read `docs/MARKET_EXPLOITATION_AUDIT_2026-05-16.md` Section 9 before approving the next lever.
2. Capture pre/post snapshots in `backend/runtime/operator/baseline_snapshots/`.
3. Run full verification matrix (5/5 probes + 14/14 verify + helper unit + `brain:checkpoint`).
4. Never relax EXPL-1 or EXPL-4 thresholds without an explicit operator-approval gate.
5. Anti-fabrication: never invent canonical fields; missing field → ineligible.
6. Pure observational — no new scoring, no new ML, no new persistence, no new API calls per phase unless approved.

---

## OPERATIONAL GOVERNANCE DOCTRINE (Phase Operational-Governance-1A, 2026-05-16)

**`brain:checkpoint` is now the authoritative reconciliation gate across six artifacts.** Every code-touching phase must update them symmetrically; the checkpoint hard-FAILs when any half is stale.

**Required-on-patch surface (hard-enforced):**

| Layer | Doc | Resolution |
|---|---|---|
| Backend brain | `MASTER_BRAIN.md` | `backend/runtime/brain/` |
| Backend brain | `CURRENT_RUNTIME_STATE.md` | `backend/runtime/brain/` |
| Backend brain | `MODEL_EVOLUTION_LOG.md` | `backend/runtime/brain/` |
| Repo-root operator | `CURRENT_STATE.md` | `<REPO_ROOT>/` |
| Repo-root operator | `NEXT_SESSION.md` | `<REPO_ROOT>/` |
| Repo-root operator | `docs/OPERATOR_RUNBOOK.md` | `<REPO_ROOT>/docs/` |

**Runtime-code coverage:** backend (`http`, `pipeline`, `routes`, `storage`, `server.js`) **and** frontend (`frontend/src`). A frontend-only phase triggers the required-on-patch gate exactly like a backend-only phase.

**Probe matrix (hard-enforced at every `brain:checkpoint`):**

| Probe | Asserts |
|---|---|
| `probe_grading_backfill_v1.js` | Grading integrity (42 assertions) |
| `probe_lineage_v1.js` | Lineage integrity (24 assertions) |
| `probe_epoch_authority_v1.js` | Epoch authority integrity (48 assertions) |
| `probe_persistence_idempotency_v1.js` | Persistence idempotency (subset of 22) |
| `probe_ledger_mirror_v1.js` | Ledger mirror integrity (remaining 22 assertions) |

Each probe must report `RESULT: PASS`. A missing probe script is itself a FAIL — anti-fabrication: the checkpoint never silently skips a probe.

**Receipt as memory ledger (`backend/runtime/brain/.brain_bootstrap_state.json`):**

Four cryptographic hashes carry operational memory forward across sessions:

| Field | What it hashes | Doctrine |
|---|---|---|
| `brainDocHashAtCheckpoint` | All 9 brain docs in `BRAIN_FILES` | Detect brain-doc drift |
| `runtimeCodeHashAtCheckpoint` | Backend + frontend runtime code | Detect code drift |
| `probeMatrixHashAtCheckpoint` | All 5 canonical probe scripts | Detect probe-script drift |
| `lastBootstrapAt` / `lastCheckpointAt` | Timestamps | Detect bootstrap / checkpoint age |

**Doctrine:**
1. **Symmetric enforcement.** Backend brain continuity and repo-root operator continuity are equal halves of the patch contract. Either side stale → checkpoint FAILs.
2. **Frontend continuity.** Frontend changes participate in `runtimeCodeHashAtCheckpoint` exactly like backend changes — no asymmetry, no special-casing.
3. **Probe integrity.** The five canonical probes run at every checkpoint. Their bytes are hashed into the receipt so future sessions detect drift.
4. **Receipt-as-memory-ledger.** The repo's `.brain_bootstrap_state.json` is the canonical operational memory. Conversations are ephemeral; the repo preserves state across chats, models, and sessions.
5. **Anti-friction.** Zero new operator commands. The existing 5-command brain interface (`bootstrap | status | verify | continuity | checkpoint`) absorbs the new enforcement without surface change.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | GOV-1 (repo-root required-on-patch) + GOV-2 (frontend in `RUNTIME_CODE_DIRS`) + GOV-3 (probe matrix in checkpoint) + GOV-4 (`probeMatrixHashAtCheckpoint` in receipt) | 2026-05-16 | ✅ SHIPPED |
| 1B | GOV-5 — `tsc --noEmit -p frontend` integrated into `brain:checkpoint` | — | Held |
| 1B | GOV-6 — operator snapshot lifecycle enforcement | — | Held |
| 1C | GOV-7 — opt-in git pre-commit hook (`brain:continuity`) | — | Held |
| 1C | GOV-8 — opt-in git pre-push hook (`brain:checkpoint --skip-matrix`) | — | Held |
| 1D | GOV-9 — phase-tag verification (`// Phase X-Y` comments match `MODEL_EVOLUTION_LOG`) | — | Held |
| 1E | GOV-10 — `brain:guard` wrapper chaining bootstrap → continuity → verify → checkpoint | — | Held |

---

## NIGHTLYREVIEW HYDRATION DOCTRINE (Phase NightlyReview-Hydration-1A, 2026-05-16)

**Alias-before-render: producers emit canonical names alongside legacy aliases; consumers read canonical first with deterministic fallback chains.**

The CLI nightly review previously printed `proj:undefined actual:undefined Δ+5.5` because the producer (`buildPostGameReview.js`) emitted rows with `line` / `actualStat` keys while the consumer (`scripts/nightlyReview.js`) read `projected` / `actual`. Field-name drift across producer/consumer surfaces is now structurally mitigated by emitting BOTH canonical and legacy field names on the producer side AND reading via fallback chains on the consumer side.

**Producer side** (`buildPostGameReview.js:330-364` row construction):
- Legacy keys preserved verbatim: `line`, `actualStat`, `delta`, `result`, `why`, `sign`.
- New canonical aliases: `projected` (= `num(b.line)`), `actual` (= `num(b.actualValue) ?? num(b.actualStat) ?? null`).
- Stale-alias repair: `actualStat` now sources from `num(b.actualValue)` first (the canonical writer in `gradeTrackedBets`).

**Consumer side** (`scripts/nightlyReview.js:141-156` printer):
- Reads with deterministic fallback chain:
  ```js
  const proj = p.projected ?? p.line ?? "?"
  const act  = p.actual    ?? p.actualStat ?? p.actualValue ?? "?"
  ```
- Display layer NEVER renders `undefined`, `[object Object]`, or `NaN`. Honest absence sentinel is `"?"`.

**Doctrine:**
1. **Alias-before-render.** Producers must emit the canonical name AND preserve legacy aliases for backward compatibility.
2. **Display-tier fallback discipline.** Consumers read canonical first, fall back through legacy aliases, end at an explicit `"?"` sentinel.
3. **Anti-fabrication primacy.** NULL on producer = "no observation"; `"?"` on display = "no canonical value to render." Never fabricated numbers.
4. **Canonical authority.** `actualValue` is the canonical realized-stat field (written by `gradeTrackedBets`). `actualStat` remains a legacy alias for backward compatibility — never a separate source of truth.
5. **Interpretation integrity.** Display-tier hoist mirrors persistence-tier hoist (Phase SQLite-Persistence-Hygiene-1A): producer emits canonical at one level; consumer reads canonical at that same level.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | HYDRATE-1 (producer canonical aliases + actualStat repair) + HYDRATE-2 (consumer fallback chains) | 2026-05-16 | ✅ SHIPPED |
| 1B | HYDRATE-3 — delta formatting guard for fully-empty rows | — | Held |
| 1B | HYDRATE-4 — persisted nightly_review_{date}.json schema lift | — | Held |
| 1C | HYDRATE-5 — wider display-tier sweep (CLV / archetype / eruption) | — | Held |
| 1D | HYDRATE-6 — regression probe `probe_review_display_shapes_v1.js` | — | Held |

---

## SQLITE PERSISTENCE HYGIENE DOCTRINE (Phase SQLite-Persistence-Hygiene-1A, 2026-05-16)

**Every SQLite parameter binding is primitive-or-NULL. No exceptions.**

better-sqlite3 only accepts `string | number | bigint | null | Buffer` as parameter binding types. **Both `undefined` AND JavaScript booleans (`true`/`false`)** are rejected with the same generic `Provided value cannot be bound to SQLite parameter N`. The Phase 1A patches in `backend/pipeline/review/buildDailyIntelligenceReview.js` establish three structural guards:

1. **Hoist before persist.** Every persist function reads fields at the level they live. The outer `report` object hoists `totalBets / settledCount / hitCount / missCount / hitRate` from `report.answers.*` (HYGIENE-1) so the SQLite writer never reads `undefined`. Pure structural lift — no new computation.
2. **Defensive coercion at every binding.** Every primitive parameter ends in `?? null` (measurement) or `?? 0` (canonical count). Every nested payload uses `JSON.stringify(x ?? null)` because `JSON.stringify(undefined)` returns the JS value `undefined` (not the string "undefined") and triggers the same binding error. Anti-fabrication: NULL means "no observation," never a synthesized default.
3. **Boolean-safe `bindBool` helper.** New pure helper at the top of the file:
   ```js
   bindBool(v, { ifNull = null } = {})
   //  null/undefined → ifNull
   //  true  → 1
   //  false → 0
   //  any other primitive passes through unchanged
   ```
   Applied at every boolean-shaped binding across the 6 daily-intel INSERTs (`c.hit`, 5 × `c.flags.*`, 7 × `event.*` count/bool fields, 5 × `eco.hr.*` count fields).

**Doctrine in one line:** *every SQLite parameter is `string | number | bigint | null | Buffer`. Booleans and `undefined` both signal a binding bug.*

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | HYGIENE-1 (hoist) + HYGIENE-2 (defensive coercion + bindBool) + HYGIENE-4 (portfolio warnings display) | 2026-05-16 | ✅ SHIPPED |
| 1B | HYGIENE-3 — per-table savepoints for granular failure observability | — | Held |
| 1B | HYGIENE-5 — settlement verification semantic rewrite (unique-predId parity) | — | Held |
| 1C | HYGIENE-6 — central `runStmt(table, params)` helper | — | Held |
| 1D | HYGIENE-7 — `probe_persist_param_shapes_v1.js` regression-prevention probe | — | Held |
| 1E | HYGIENE-8 — proactive postgame hoisting | — | Held |

---

## SETTLEMENT INGESTION DOCTRINE (Phase Settlement-Ingestion-Window-1A, 2026-05-15)

**Bare `npm run settlement:run` now sweeps the last 2 days by default — yesterday + today.**

Root cause of the previous "newest completed slates frozen at 0 outcomes" symptom: `settlement:run` defaulted to `todayKey()`, so games that completed yesterday were never picked up by today's bare invocation. Phase AUTO-3 introduces a deterministic rolling window.

| Invocation | Window resolved | Behavior |
|---|---|---|
| `npm run settlement:run` | `[today-1, today]` (N=2 default) | NEW — sweeps yesterday + today |
| `npm run settlement:run -- --window=4` | `[today-3, today-2, today-1, today]` | NEW — operator-tunable window |
| `npm run settlement:run -- --date=2026-05-12` | `[2026-05-12]` | UNCHANGED — explicit `--date` preserves single-date semantics |
| `npm run settlement:run -- --check` | iterates window in CHECK mode | NEW — preview which pairs the EXECUTE path would visit |

**Mandatory operator log on every invocation:**
```
processing settlement window: [YYYY-MM-DD ... YYYY-MM-DD]
```

**Doctrine:**
1. **Bare invocation always sweeps a window.** Default N=2 absorbs the operator-observed yesterday/today gap.
2. **Explicit `--date=` always wins.** Window N is ignored (with clear `(ignored — --date explicit)` log).
3. **Existing lifecycle preserved verbatim.** Each per-date pair flows through the **EXISTING** `executePair` helper → existing grading → AUTO-1 chain → nightlyReview → outcome_snapshots.
4. **INSERT OR REPLACE idempotency preserved.** Re-running the sweep is a no-op for already-settled pairs.
5. **`skipped_no_tracked_bets` semantics preserved.** When a date has no tracked_bets file, `executePair` emits `skipped` honestly — never fabricates.
6. **Anti-fabrication.** `buildWindowDates(today, N)` falls back to `[today]` when `N < 1` or input is malformed — never synthesizes a placeholder date.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | AUTO-3 (`--window=N` default 2 in `settlementRun.js`) | 2026-05-15 | ✅ SHIPPED |
| 1B | AUTO-4 — `settlement:run --backfill` delegation to `runHistoricalGrade --backfill` | — | Held |
| 1C | AUTO-5 — `grading:run` defaults to `--backfill` when no flags | — | Held |
| 1D | AUTO-6 — daily-ceremony runbook rewrite to `settlement:run` as canonical | — | Held |
| 1E | AUTO-7 — `settlement:status` per-date pending/settled rollup | — | Held |
| 1F | AUTO-8 — completion watchdog (auto-invoke on game-window close) | — | Held |
| 1G | AUTO-9 — workstation "Run settlement" button + status pill | — | Held |
| 1H | AUTO-10 — cron/systemd unit | — | Held |

---

## RECOMMENDATION HIERARCHY DOCTRINE (Phase Recommendation-Hierarchy-1A, 2026-05-15)

**The workstation now surfaces a deterministic 7-slot decision ladder ABOVE the HeroPickCard.**

The ladder is a pure observational layer over the canonical featured-bucket arrays. It is the operator's decision-grade scan-line; the hero card retains emotional emphasis on the single highest-composite anchor.

**Slot order (priority — first claim wins):**

| Slot | Icon | Source bucket | Empty doctrine |
|---|---|---|---|
| `bestOverall` | 🔥 | `anchors[0]` (with id-dedup walk) | `(no qualifying best play tonight)` |
| `safestPlay` | 🛡 | `safest[0]` | `(no qualifying safe play tonight)` |
| `bestDisagreement` | ⚡ | `bestDisagreementEdges[0]` | `(no qualifying disagreement edge tonight)` |
| `bestUpsidePlay` | 🚀 | cascade `bestAggressive` → `bestPra` → `bestHr` → `bestFirstBasket` | `(no qualifying upside play tonight)` |
| `bestBalancedPlay` | 🎯 | `bestBalanced[0]` | `(no qualifying balanced play tonight)` |
| `mostOverpricedAvoid` | ⚠ | `inflatedSuperstarSpots[0]` | `(no overpriced spots flagged tonight)` |
| `highestTrapRiskAvoid` | ⚠ | `trapLadders[0]` | `(no trap-shaped ladders flagged tonight)` |

**Doctrine:**
1. **Pure observational layer.** No new scoring. No new ranking math. No new heuristics.
2. **Canonical bucket authority.** Slot rules cite buckets BY NAME. When a bucket evolves, the ladder follows automatically.
3. **Dedup walk.** A play already claimed by an earlier-priority slot is skipped; the ladder walks down the bucket until a unique id is found OR the bucket is exhausted (slot becomes `null`).
4. **Empty doctrine.** Every empty slot renders an HONEST `(no qualifying X tonight)` italic line. The ladder **NEVER** manufactures a fallback play.
5. **Replay/grading safety.** Ladder consumes already-immutable `featured` payload; no upstream mutation; no API call; no persistence.
6. **Frontend authority.** `frontend/src/workstation/components/RecommendationLadder.tsx` is the single render owner. All annotations re-use `tooltips.ts` helpers — no parallel translation layer.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | HIER-1 (backend builder) + HIER-2 (FE interface) + HIER-3 (FE component) + HIER-4 (Dashboard wiring) | 2026-05-15 | ✅ SHIPPED |
| 1B | HIER-5 — operator-customizable slot priority weights | — | Held |
| 1C | HIER-6 — "what changed since last refresh" delta surface | — | Held |
| 1D | HIER-7 — per-slot explainability expansion | — | Held |
| 1E | HIER-8 — slot historical ROI tracking | — | Held |
| 1F | HIER-9 — slot persistence / longitudinal stability | — | Held |

---

## CANONICAL PAYLOAD DOCTRINE (Phase Canonical-Shape-Hardening-1A, 2026-05-15)

**Every observability/diagnostic surface that reads a payload MUST consume `backend/pipeline/shared/responseShapeResolvers.js`. No exceptions.**

The canonical helper module is the architectural seam that prevents future INC-016 / INC-017-style drift events. Two consecutive incidents shared one root cause — duplicated inline payload readers drifting from canonical API shapes — and Phase Canonical-Shape-Hardening-1A introduces the structural fix.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | HARDEN-1 (NEW `responseShapeResolvers.js` — 5 deterministic helpers) + HARDEN-2 (slateMlb.js migration) | 2026-05-15 | ✅ SHIPPED |
| 1B | HARDEN-3 — migrate `slateNba.js` onto canonical helpers | — | Held |
| 1C | HARDEN-4 — migrate `marketStatus.js` + `buildIntelligencePresentation.js` snapshot-row readers | — | Held |
| 1D | HARDEN-5 — `probe_response_shape_v1.js` regression-prevention probe | — | Held |
| 1E | HARDEN-6 — `buildMlbWeather.js:49` consolidation | — | Held |
| 1F | HARDEN-7 — `aiSlips` shape disambiguation | — | Held |
| 1G | HARDEN-8 — FE `types.ts` contract cross-validation | — | Held |

**Canonical helpers exported from `responseShapeResolvers.js`:**

| Helper | Use case | Authority |
|---|---|---|
| `resolveSnapshotRows(snap)` | On-disk snapshot rows array (NBA `data.props` OR MLB `data.rows`) | `workstationRoutes.js:135 + :190` |
| `resolveFeaturedCount(state)` | `/api/ws/state` featured plays count | `workstationRoutes.js:~705` |
| `resolveAiSlipCount(state)` | Sum of 4 tier-array lengths from `state.aiSlips` | `workstationRoutes.js:~703` |
| `resolveCandidateCount(state)` | Candidate-pool size from `state.counts.candidates` or `state.candidates` | `workstationRoutes.js:~640 + :~698` |
| `resolveBestAvailableCount(payload, sport)` | Sport-aware best-pick count | `nbaIsolatedRoutes.js:~1477` (NBA) + `mlbIsolatedRoutes.js:~103-612` (MLB) |

**Doctrine:**
1. Route files own response shapes; helpers must conform, never redefine.
2. No observability surface may fork resolution logic.
3. Anti-fabrication: undefined canonical field → `"n/a"` or `[]`. Never synthesize a default.
4. Anti-duplication: helper updates once; consumers rebase automatically.
5. When a future phase evolves an API shape, the helper updates first; every consumer rebases via a single migration commit (Phase 1B style).

---

## INTELLIGENCE-SHAPING DOCTRINE (Phase Intelligence-Shaping-1A, 2026-05-15)

**Diagnostic/observability surfaces are reader-side; they must consult the canonical API authority files, not assume.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | SHAPE-1 (`scripts/slateNba.js` — 4 key-path corrections matching `nbaIsolatedRoutes.js` + `workstationRoutes.js` canonical response shapes) | 2026-05-15 | ✅ SHIPPED — INC-017 RESOLVED |
| 1B | SHAPE-2 — consolidate count-resolution into shared `resolveSlateNbaCounts()` helper | — | Held |
| 1C | SHAPE-3 — populate or remove vestigial `eliteProps`/`strongProps`/`playableProps`/`flexProps` arrays | — | Held |
| 1D | SHAPE-4 — persist `modelProb` + `edge` on every raw `data.props[]` row | — | Held |
| 1E | SHAPE-5 — operator-facing `intel:status` command surfacing structural shape | — | Held |

**Doctrine (mirrors Snapshot-Authority doctrine pattern):**
1. **Canonical response-shape authority is single-sourced** — the route files (`nbaIsolatedRoutes.js` for `/api/best-available`; `workstationRoutes.js` for `/api/ws/state`) own response shapes.
2. **Reader-side carry-forward verification mandatory** whenever upstream API surface evolves. Two consecutive phases (Snapshot-Authority-1A INC-016, Intelligence-Shaping-1A INC-017) caught the same diagnostic-reader-drift anti-pattern.
3. **Anti-fabrication**: when a reader key is undefined, surface `n/a` deterministically; never silently substitute a default.
4. **Anti-duplication for future readers**: Phase 1B (SHAPE-2) will consolidate the count-resolution.

**Canonical API response shapes (operator-facing reference):**

`GET /api/best-available?sport=basketball_nba`:
```js
{
  bestAvailable: { best, elite, strong, ladders, firstBasket,
                   aiSlips, featured, wsCandidates },
  nbaOpportunityBoard, nbaInsightBoard, nbaCacheDiagnostics
}
```

`GET /api/ws/state?sport=nba`:
```js
{
  sport, date,
  counts: { candidates, urgent, propsWithMultiBook, steam, stale },
  candidates: [...],
  featured: [...],
  aiSlips: { safe, balanced, aggressive, lotto },
  lineShopping, timing, portfolio, snapshotFreshness, ...
}
```

---

## SNAPSHOT AUTHORITY DOCTRINE (Phase Snapshot-Authority-1A, 2026-05-15)

**Writer-side authority is canonical and never disturbed by observability or presentation code.**

| Sport | Fetcher | Writer | On-disk file | Canonical row key |
|---|---|---|---|---|
| NBA | `pipeline/nba/fetchNbaOddsSnapshot.js` | `saveNbaSnapshotToDisk` (sync) | `backend/snapshot.json` | `data.props` |
| MLB | `pipeline/mlb/buildMlbBootstrapSnapshot.js` | `saveMlbReplaySnapshotToDisk` (async) | `backend/snapshot-mlb.json` | `data.rows` (also has `data.props`) |

**Reader-side rule (mandatory for every snapshot consumer):**

```js
const rows = snap?.data?.rows || snap?.data?.props || snap?.rows || []
```

The canonical reference implementation lives in `backend/routes/workstationRoutes.js:135 + :190` (`readSnapshotRows`, `readSnapshotRowsWithFreshness`). Every future observability or presentation surface that reads a snapshot file MUST use this exact fallback chain (or its forthcoming `AUTH-3` consolidated helper). The rule is anti-duplication: do not fork the resolution logic.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | AUTH-1 (`marketStatus.js:72` fallback) + AUTH-2 (`buildIntelligencePresentation.js:732` fallback) — both mirror the canonical workstation reader pattern | 2026-05-15 | ✅ SHIPPED — INC-016 RESOLVED |
| 1B | AUTH-3 — consolidate into single shared helper + probe asserts both shapes resolve | — | Held |
| 1C | AUTH-4 — close `ENABLE_DISK_SNAPSHOT_LOAD=false` boot-load gap | — | Held |
| 1D | AUTH-5 — rename `snapshot.json` → `snapshot-nba.json` (symmetric naming) | — | Held |
| 1E | AUTH-6 — NBA writer aliases `data.props` as `data.rows` (belt-and-suspenders) | — | Held |

**Doctrine for every Snapshot-Authority phase:**
1. Writer-side authority is canonical; never touched by observability/presentation code.
2. Reader-side fallback consistency: every consumer uses `data.rows || data.props || rows`.
3. Anti-duplication: future readers consult the canonical resolver; do not fork.
4. Anti-fabrication: no reader inserts synthetic rows to mask a count mismatch.
5. Pre/post snapshots mandatory in `backend/runtime/operator/baseline_snapshots/`.

---

## SETTLEMENT ORCHESTRATION DOCTRINE (Phase Settlement-Orchestration-1A, 2026-05-15)

**Completed games must deterministically settle into outcome_snapshots WITHOUT requiring multiple manual operator commands.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | AUTO-1 (post-grading chain hook in `runHistoricalGrade.js`) + AUTO-2 (`npm run settlement:run` canonical entry) | 2026-05-15 | ✅ SHIPPED |
| 1B | AUTO-3 — foreground `npm run settlement:watch` watchdog | — | Held |
| 1C | AUTO-4 — in-process background scheduler (opt-in via env var) | — | Held |
| 1D | AUTO-5 — committed cron/systemd unit files | — | Held |
| 1E | AUTO-6 — workstation Dashboard "Settle Tonight's Slate" button | — | Held |

**Daily ceremony post-Phase-1A:**

```bash
# 1. Pre-slate (unchanged)
npm run engine:restart
npm run slate:refresh

# 2. Post-slate (NEW canonical command — replaces 3-command ceremony)
npm run settlement:run

# 3. Verification (unchanged)
npm run grading:status
npm run calibration:status
npm run lineage:status
npm run market:status
npm run brain:checkpoint
```

**`settlement:run` flags:**
- `--sport=mlb|nba|all` — default: all
- `--date=YYYY-MM-DD` — default: today's date
- `--check` — detect-only mode (no writes; calls `nightlyReview.js --check`)
- `--clear-locks` — pre-flight stale-lock sweep (Phase 1F+1G)
- `--no-orchestrate` — grade only; suppress AUTO-1 chain
- `--verbose` — pass through to grading

**Doctrine for every Settlement-Orchestration phase:**
1. Deterministic CLI chains, not heuristic schedulers.
2. Replay-safe — `INSERT OR REPLACE` on outcome_snapshots.
3. Lockfile-protected via existing Phase 1F+1G acquireLock.
4. API-conscious — same total stat-API fetch count.
5. Operator-visible logging at every state transition.
6. Loud failure — non-zero exit when settled rows exist but outcome_snapshots empty.
7. Pre/post snapshots mandatory in `backend/runtime/operator/baseline_snapshots/`.
8. No autonomous schedulers without explicit operator approval gate.

---

## READABLE INTELLIGENCE DOCTRINE (Phase Operator-Experience-1B-1, 2026-05-15)

**Reduce translation cost between sportsbook-native intelligence and operator-native understanding — deterministically.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1B-1** | NEW `frontend/src/workstation/tooltips.ts` (25 deterministic helpers); 82 title= attributes across 7 surfaces; `(2b)` → `(2 books)` abbreviation cleanup | 2026-05-15 | ✅ SHIPPED |
| 1B-2 | 1-line plain-English summary at every card top; SOFT/STALE pill captions | — | Held |
| 1B-3 | PortfolioView band-guide chip; remove phase-tag pollution; nav-label tooltips | — | Held |
| 1B-4 | Operator-toggleable 25-term glossary page | — | Held |
| 1B-5 | Per-pick "why this pick / why this may fail" two-paragraph summary card | — | Held |

**Doctrine for every Operator-Experience-1B phase**:
1. Deterministic translation only — every visible/hoverable string is f(backend fields).
2. Anti-fabrication — undefined input → empty string → caller omits the rendering.
3. Single source of truth — all tooltip / plain-English strings live in `frontend/src/workstation/tooltips.ts`.
4. Cross-reference header — module cites every backend rule (file + line) for audit traceability.
5. Hover-discoverable, never displacement — tooltips expand visible content; never replace it.
6. Zero backend touch per phase unless approved.

---

## ACTIONABLE INTELLIGENCE DOCTRINE (Phase Operator-Experience-1A, 2026-05-14)

**Transform intelligence exhaust into actionable betting intelligence WITHOUT disturbing the underlying intelligence substrate.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | 8 actionable buckets in buildFeaturedPlays (`bestBalanced`, `bestAggressive`, `bestUnders`, `bestAltLadders`, `bestDisagreementEdges`, `staleLineOpportunities`, `trapLadders`, `inflatedSuperstarSpots`) + 3 Phase Market-1A fields lifted onto every compactPlay (`consensusConfidence`/`marketDispersion`/`bestImpDelta`) + ActionableBucketsGrid Dashboard component + inline `conf=X (Nb) volatility:X Δ±X¢` annotations on HeroPickCard / SpotlightCard / FeaturedCard + processNote/avoidReason lifted from tooltips | 2026-05-14 | ✅ SHIPPED |
| 1B | whyQualifies + whyAvoid + tier text labels + mobile @media + keyboard shortcuts + copy-to-clipboard | — | Held |
| 1C | Operator-customizable priority weights + delta surface + drill-down | — | Held |
| 1D | Calibration-coefficient impact surfacing + Phase 1A filter-applied indicators | — | Held |
| 1E | Refined TRAP / INFLATED detection — depends on Market 1B+ | — | Held |

**Discipline for every Operator-Experience phase**:
1. Pre/post snapshots mandatory — `backend/runtime/operator/baseline_snapshots/`.
2. Every visible field must trace to a deterministic backend value (anti-fabrication).
3. New surfaces must declare a top-N cap and auto-hide when empty (anti-clutter).
4. Calibration/market-informed buckets render BEFORE raw exhaust.
5. Zero replay/grading/persistence/market-pipeline path modifications per phase.
6. tsc clean on frontend AND full 150/150 probe matrix unchanged.

---

## MARKET OBSERVABILITY DOCTRINE (Phase Market-Ecology-1A, 2026-05-14)

**Understand sportsbook behavior truthfully BEFORE attempting to exploit sportsbook behavior algorithmically.**

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | OBS-1 (`npm run market:status`) + OBS-2 (`consensusConfidence` field on buildLineShopping) + OBS-3 (`apiCallLogger.js` wrapping NBA + MLB Odds-API axios calls) | 2026-05-14 | ✅ SHIPPED — observation window open |
| 1B | STALE-1 + CONS-1 + CONS-2 — pending operator gate | — | Held |
| 1C | DISAG-1 + DISAG-2 + ALT-DISAG-1 — pending operator gate | — | Held |
| 1D | INFLATE-1 + ANCHOR-1 — pending operator gate | — | Held |

**Discipline for every Market-Ecology phase**:
1. Read the prior phase's audit document before approving the next gate.
2. Capture `pre_market_*.txt` snapshot in `backend/runtime/market/baseline_snapshots/` BEFORE patching.
3. Run full verification matrix (probes + 14-suite + brain:checkpoint).
4. Open observation window: read `npm run market:status` output across multiple days.
5. Zero new network calls per phase unless explicitly approved by operator.
6. Never auto-trust a "sharp" book or auto-distrust a "soft" book until explicit ANCHOR-1 gate.

**`npm run market:status`** — five sections of canonical market observability:
1. **SNAPSHOT FRESHNESS** — savedAt + total rows + per-book counts per sport snapshot.
2. **CONSENSUS CONFIDENCE DISTRIBUTION** — p10/p50/p90 of `consensusConfidence`; bookCount distribution; top-N multi-book disagreements.
3. **TOP STALE ROWS** — books diverging from consensus by ±2.5¢, tagged `soft_line` (bettor value) or `stale_line` (book overprices).
4. **PER-BOOK HISTORICAL CLV** — 60-day rolling bets / settled / ROI / avgCLV per book.
5. **API-CALL BURN** — rolling 24h / 7d / 30d call counters per sport, per endpoint, with p50/p90/p99 duration.

---

## REALISM ECOLOGY DOCTRINE (Phase Realism-Ecology-1A, 2026-05-14)

**Evolve betting ecology INCREMENTALLY** with measurable longitudinal observation windows. Never stack multiple realism interventions in a single gate — calibration attribution requires single-variable changes.

| Phase | Levers shipped | Date | Observation status |
|---|---|---|---|
| **1A** | AGG-2 (`AGGRESSIVE.maxPerGame: 2→1`) + TEXT-1 (`offensiveAttackTextureBonus` over-side `0.032→0.016`) | 2026-05-14 | ✅ SHIPPED — forward observation window open |
| 1B | ALT-1 + PORT-1 — pending operator gate | — | Held |
| 1C | CORR-1 + VOL-1 — pending operator gate | — | Held |
| 1D | AGG-1 + AGG-3 + MLB-AGGRESSIVE-under-only — pending operator gate | — | Held |

**Discipline for every Realism-Ecology phase**:
1. Read the prior phase's audit document before approving the next gate.
2. Capture `pre_realism_*.txt` snapshot in `backend/runtime/calibration_snapshots/` BEFORE patching.
3. Capture `post_realism_*.txt` snapshot AFTER patching.
4. Run full verification matrix (probes + 14-suite + brain:checkpoint).
5. Open observation window: track per-tier hit-rates via `npm run calibration:status` weekly.
6. Effect sizes are DIRECTIONAL until corpus exceeds the INC-012 ceiling.
7. Never hard-disable AGGRESSIVE, LOTTO, or ladders. Never hardcode under-forcing. Never punish specific players.

---

## QUICK REFERENCE — DAILY CEREMONY

```bash
cd ~/Desktop/betting-dashboard/backend

# TERM 1 — start the backend (or restart if already running)
npm run engine:restart                    # safe; kills+starts; echoes every step

# TERM 2 — pre-slate
npm run engine:status                     # is backend up? brain green?
npm run slate:nba                         # NBA hard-reset refresh + diagnostics summary
npm run slate:mlb                         # MLB refresh + diagnostics summary

# TERM 2 — post-slate (after games settle)
npm run grading:run                       # grade today, all sports
npm run grading:review                    # daily intelligence review

# TERM 2 — health verification (anytime)
npm run runtime:verify                    # 14-suite regression matrix
npm run persistence:status                # SQLite vs JSON parity
npm run epoch:status                      # epoch authority diagnostics
npm run persistence:probe                 # idempotency + mirror probes
npm run brain:checkpoint                  # end-of-session brain seal
```

---

## TWO-TERMINAL MODEL (unchanged from prior workflow)

**TERM 1** is the running backend. It blocks on a Node server boot log.
**TERM 2** is everything else — refreshes, grading, verification, brain ceremony.

```
TERM 1 (blocking — backend boot log)        TERM 2 (operator workspace)
─────────────────────────────────────       ─────────────────────────────────────
$ cd ~/Desktop/betting-dashboard/backend    $ cd ~/Desktop/betting-dashboard/backend
$ npm run engine:restart                    $ npm run engine:status
                                            $ npm run slate:nba
[engine:restart] === Phase 1: identify ==── $ npm run slate:mlb
[engine:restart] killing: 12345             $ npm run grading:run
[engine:restart] port 4000: confirmed clear $ npm run runtime:verify
[engine:restart] launching node server.js   $ npm run brain:checkpoint
[SERVER-BOOT-DB-INIT] { ok: true, ... }
[DB-BOOT] { ... }
ACTIVE: nbaIsolatedRoutes.js
ACTIVE: buildNbaOpportunityBoard.js
...
Backend listening on http://localhost:4000
```

---

## CANONICAL COMMAND MAP

### Brain commands (continuity discipline — pre-existing)

| Command | Purpose |
|---|---|
| `npm run brain:bootstrap`  | Surfaces phase / priorities / incidents / 17 laws / do-not-reintroduce. Writes `.brain_bootstrap_state.json`. **First thing every session.** |
| `npm run brain:status`     | Quick freshness snapshot. |
| `npm run brain:verify`     | 11-section freshness audit. |
| `npm run brain:continuity` | Drift detector. Exits non-zero on stale bootstrap / runtime-changed-without-reconcile. |
| `npm run brain:checkpoint` | End-of-session enforcement. Required brain-doc reconciliation + continuity + 14-suite matrix. **Last thing every session.** |

### Engine commands (TERM 1 lifecycle — Phase Operator-Operations-1, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run engine:start`   | Start backend on port 4000. Refuses to start if port is occupied — points you to engine:restart. |
| `npm run engine:restart` | Kill PIDs on port 4000 (with explicit echo of every PID before killing) then start. Replaces the embedded `(lsof -ti tcp:4000 | xargs -r kill -9; sleep 2; ...); node backend/server.js` shell snippet. |
| `npm run engine:status`  | Pure observability — port 4000 occupancy + `/snapshot/status` probe + brain freshness summary + continuity result. Exits 0 even when backend is down (informational). |

### Slate commands (TERM 2 day-of operation — Phase Operator-Operations-1, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run slate:refresh`                  | `GET /refresh-snapshot` — generic refresh. Accepts `-- --sport=nba|mlb` to pass-through. |
| `npm run slate:nba`                      | NBA full ceremony: `GET /refresh-snapshot/hard-reset` → best-available diagnostics → workstation state. Surfaces bestProps count, cache lifecycle, F6.3 match strategy, epoch authority counters. *(Phase Operator-Operations-1A 2026-05-14: route corrected from phantom `POST /api/nba/refresh-snapshot/hard-reset` to canonical `GET /refresh-snapshot/hard-reset`.)* |
| `npm run slate:mlb`                      | MLB full ceremony: refresh → best-available → workstation state. Surfaces row count, snapshot freshness, slate diagnostics. |

### Grading commands (post-slate — Phase Operator-Operations-1, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run grading:run`        | Run historical grading (Tier 1+2 — JSON in-place). Default `--sport=all`. Override with `-- --sport=nba` / `-- --sport=mlb` / `-- --date=YYYY-MM-DD` / `-- --backfill` / `-- --retry-unresolved`. |
| `npm run grading:review`     | Run daily intelligence review. Default `--sport=all`. Override with `-- --sport=...` / `-- --date=...` / `-- --verbose` / `-- --dry-run` / `-- --json` / `-- --summary`. |

### Grading-Calibration commands (Phase Grading-Calibration-Operations-1B/1D/1F/1G, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run grading:backfill`     | Run the canonical `scripts/nightlyReview.js` for one `(sport, date)`. Invokes the full 6-step orchestrator (apply results → post-game review → ledger import → ledger settle → CLV → reports). Writes `outcome_snapshots` + `slip_outcomes` (Tier 3). Pass-through args: `-- --sport=mlb --date=2026-05-08 [--force] [--dry] [--check]`. |
| `npm run grading:backfill-all` | Backfill every `(sport, date)` where JSON tracked_bets is settled but SQLite outcome rows are missing. Iterates dates, calls the canonical CLI per date. Echoes per-date decisions (RUN / SKIP / FAIL). Operator args: `-- --sport=mlb` / `-- --dry` / `-- --force` / `-- --verbose` / **`-- --clear-locks`** (Phase 1F+1G). Idempotent on re-run. |
| `npm run grading:backfill-all -- --clear-locks` | **Phase 1F (INC-014) + Phase 1G (INC-015)** — pre-flight stale-lock sweep. Scans `runtime/tracking/.nightly_lock_*`, probes each recorded pid with `process.kill(pid, 0)`, reports + reclaims dead pids (`reclaimed-dead`), reports + reclaims alive-pid-but-stale (>10 min old) entries (`reclaimed-stale` — pid reuse), leaves alive+fresh alone (`alive`). Combine with `--dry` for scan-only preview. |

**Lock state machine (Phase 1F + 1G combined)** — `acquireLock` decision tree per existing lockfile:

| Lock age | PID probe | Outcome |
|---|---|---|
| 0–10 min | alive | Honor (legitimate concurrent run) |
| 0–10 min | dead (ESRCH) | Reclaim |
| 10–30 min | alive | Reclaim with `[acquire-lock][INC-015]` console warning (pid reuse) |
| 10–30 min | dead | Reclaim |
| >30 min | any | Reclaim (hard TTL) |

Watch for `[acquire-lock][INC-015] Reclaiming ...` warnings — those are pid-reuse events the orchestrator now self-heals.

| `npm run grading:status`       | Per-date parity inspector. Per-`(sport, date)`: JSON tracked_bets total + settled count vs SQLite `outcome_snapshots` row count + **JOIN-success count (Phase 1D)** + slip parity. Surfaces lag/gap (Δ). Includes personal-ledger settlement state. |
| `npm run calibration:status`   | Calibration corpus health: per-tier hit rate + delta_prob, per-volatility, per-side, per-stat-family (top 10), Session W table population, global Brier score. **Phase 1D adds**: JOIN-restricted coverage diagnostics + sample-size warnings + classification-health check (replaces the misleading "see prediction_id_aliases" hint). |
| `npm run lineage:status`       | **Phase 1D** — canonical lineage-health inspector. Global totals (predictions / outcomes / JOIN matches / orphans both sides). Per-date breakdown with coverage status (HEALTHY ≥80% / PARTIAL 50–80% / LOW <50% / PRE-CORPUS 100%-orphan). Classification health (hit IS NOT NULL fraction). Sample orphan ids per side. Canonical byte-parity regression-guard. |

### Runtime verification (Phase Operator-Operations-1, 2026-05-14)

| Command | Purpose |
|---|---|
| `npm run runtime:verify` | 14-suite regression matrix with operator-friendly summary. Single PASS/FAIL verdict at end + per-suite timing. Same suites brain:checkpoint runs. |

### Persistence commands (Phase Persistence-1B, 2026-05-14 — pre-existing)

| Command | Purpose |
|---|---|
| `npm run persistence:status`            | SQLite row counts vs JSON inventory + ledger parity + divergence log + alias summary. |
| `npm run persistence:probe`             | Idempotency + ledger-mirror probes (22+22 = 44 checks). |
| `npm run persistence:import`            | One-time idempotent backfill of dormant SQLite tables from JSON. |
| `npm run persistence:backfill-aliases`  | Populate `prediction_id_aliases` for composite-key forward compatibility. |

### Epoch command (Phase Longitudinal-Integrity-1B, 2026-05-14 — pre-existing)

| Command | Purpose |
|---|---|
| `npm run epoch:status` | `prediction_epochs` row counts grouped by formula prefix, sport, source. Most-recent 5 per sport. Canonical helper diagnostics. |

---

## PRE-SLATE CEREMONY (typical day)

```bash
cd ~/Desktop/betting-dashboard/backend

# 1. Session start — load operator memory + verify continuity
npm run brain:bootstrap
npm run brain:continuity        # must PASS

# 2. Verify backend is up + brain is green
npm run engine:status

# 3. If backend is down, start it (TERM 1)
#    npm run engine:restart      # or engine:start if port is clear

# 4. Refresh slates
npm run slate:nba
npm run slate:mlb

# 5. Quick health check
npm run runtime:verify          # 14/14 PASS expected
npm run persistence:status      # parity check
npm run epoch:status            # epoch authority state
```

---

## POST-SLATE CEREMONY (after games settle)

```bash
cd ~/Desktop/betting-dashboard/backend

# 1. Tier 1+2 — Grade today's bets + slips in JSON (in-place result fields)
npm run grading:run -- --date=$(date +%Y-%m-%d)

# 2. Tier 3 — Orchestrator: writes SQLite outcome_snapshots + slip_outcomes,
#             updates personal_ledger, runs Session W daily review (Phase
#             Grading-Calibration-Operations-1B, 2026-05-14)
npm run grading:backfill -- --sport=mlb --date=$(date +%Y-%m-%d)
npm run grading:backfill -- --sport=nba --date=$(date +%Y-%m-%d)
# OR (one shot) backfill every settled date that's still missing in SQLite:
#   npm run grading:backfill-all

# 3. Verify grading + calibration health
npm run grading:status                 # JSON-vs-SQLite parity (Δ should be 0); JOIN column shows lineage match per date
npm run lineage:status                 # orphan accounting + coverage status per date (Phase 1D)
npm run calibration:status             # per-tier hit rate, delta_prob, Brier — JOIN-restricted (Phase 1D)

# 4. (Optional) Tier 4 — separately runnable: daily intelligence review
#                       (already invoked as Step 9 inside `grading:backfill`)
npm run grading:review -- --date=$(date +%Y-%m-%d) --verbose

# 5. Verify persistence integrity
npm run persistence:status
npm run epoch:status

# 6. Seal brain receipt + run regression matrix
npm run brain:checkpoint
```

---

## FAILURE RECOVERY WORKFLOW

### Backend unresponsive / port 4000 stuck

```bash
npm run engine:status           # confirm symptoms
npm run engine:restart          # kills + restarts; echoes every PID it kills
```

The `engine:restart` script will print every PID before killing it. If the kill fails or the port stays occupied, it exits non-zero with a clear error.

### Refresh blocked by stuck mutex

If `[REFRESH-MUTEX-STUCK]` appears in TERM 1 log (Phase Race-1 watchdog from 2026-05-14), the mutex has been held > 5 minutes. Resolution:

```bash
npm run engine:restart          # the canonical recovery
```

The watchdog is observability-only — it does NOT auto-release the mutex. Operator restart is the recovery path.

### 14-suite regression fails

```bash
npm run runtime:verify          # see which suite(s) failed
# Inspect failed suite output:
node backend/scripts/verify<NameOfFailedSuite>.js
```

The runtime:verify summary prints `stderr tail` for each failure.

### Ledger divergence detected at boot

If `[LEDGER-DIVERGENCE-DETECTED]` fires (Phase Persistence-1B), JSON and SQLite ledger row counts diverge:

```bash
npm run persistence:status      # shows the delta
npm run persistence:import      # idempotent backfill — fills SQLite from JSON
npm run persistence:status      # verify parity
```

### Brain continuity FAIL

```bash
npm run brain:continuity        # see which threshold tripped
# Common case: runtime code changed without checkpoint
npm run brain:checkpoint        # reconciles receipt hashes
```

---

## ORDERING RULES (the only ceremony rules that matter)

1. **`brain:bootstrap` FIRST** every session. Loads operator memory + writes receipt.
2. **`brain:checkpoint` LAST** every session. Reconciles receipt + runs regression matrix.
3. **`engine:start` / `engine:restart` BLOCKS** TERM 1. Don't run from TERM 2.
4. **`engine:status` is read-only.** Safe to run anytime.
5. **`slate:*` requires the backend to be up.** Run `engine:status` first if unsure.
6. **`grading:*` does NOT require the backend.** Operates on JSON tracking files directly.
7. **`runtime:verify` is idempotent.** Safe to re-run as often as you like.
8. **`persistence:probe` uses `/tmp`.** Does NOT touch production `betting.db`.

---

## SAFETY GUARANTEES (Phase Operator-Operations-1 design contract)

This phase establishes operational standardization. It does NOT:

- ❌ Auto-kill processes silently — `engine:restart` echoes every PID before killing.
- ❌ Hide failures — every script prints HTTP status, exit code, error messages.
- ❌ Modify runtime authority — these scripts only invoke existing endpoints/CLIs.
- ❌ Change replay / freeze / grading / snapshot / mutex behavior.
- ❌ Reduce observability — every script is verbose-by-default.
- ❌ Wrap dangerous operations behind innocuous names — naming follows operator vocabulary.

Every new operational command is:

- ✅ Transparent — echoes what it's about to do before doing it.
- ✅ Additive — does not remove or rename any existing command.
- ✅ Continuity-aware — works alongside brain:* discipline.
- ✅ Replay-safe — never touches snapshot.json or freeze tables directly.
- ✅ Grading-safe — defers to existing grading CLIs.

---

## REFERENCE — what each new script actually does

| npm command | Script | What it actually runs |
|---|---|---|
| `engine:start`   | `backend/scripts/engineStart.sh`   | Check port 4000 clear → `exec node server.js` |
| `engine:restart` | `backend/scripts/engineRestart.sh` | `lsof -ti tcp:4000` → echo PIDs → `kill -9` → verify clear → `exec node server.js` |
| `engine:status`  | `backend/scripts/engineStatus.js`  | `lsof -i tcp:4000` + HTTP GET `/snapshot/status` + spawnSync `brain:status` + spawnSync `brain:continuity` |
| `slate:refresh`  | `backend/scripts/slateRefresh.js`  | HTTP GET `/refresh-snapshot[?sport=...]` |
| `slate:nba`      | `backend/scripts/slateNba.js`      | GET `/refresh-snapshot/hard-reset` → GET `/api/best-available?sport=basketball_nba` → GET `/api/ws/state?sport=nba`  *(canonical hard-reset endpoint; server.js:19471 — Phase Operator-Operations-1A 2026-05-14)* |
| `slate:mlb`      | `backend/scripts/slateMlb.js`      | GET `/refresh-snapshot?sport=baseball_mlb` → GET `/api/best-available?sport=baseball_mlb` → GET `/api/ws/state?sport=mlb` |
| `runtime:verify` | `backend/scripts/runtimeVerify.js` | spawnSync each `verify*.js` in turn; aggregate verdict |
| `grading:run`    | `backend/scripts/gradingRun.js`    | spawnSync `runHistoricalGrade.js` with operator args (defaults `--sport=all` if absent) |
| `grading:review` | `backend/scripts/gradingReview.js` | spawnSync `runDailyReview.js` with operator args (defaults `--sport=all` if absent) |

---

_Phase Operator-Operations-1 — 2026-05-14. Additive only; no existing command modified._
