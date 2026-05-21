# MLB BETTOR REALISM AUDIT — PHASE 1 (PENDING MCR ROUTING)

**Date:** 2026-05-20
**Lane:** FULL SYSTEM AUDIT (sub-domain: MLB bettor cognition)
**Scope:** evaluation from bettor-realism perspective — sharp / DFS grinder / tape watcher / commentator / sportsbook trader / MLB prop bettor. NOT pure probability ranking.
**Mode:** Observational. Zero patches. Zero canonical creation.
**Lineage note for MCR:** sibling artifact to `FULL_SYSTEM_AUDIT_2026-05-17_PENDING_MCR.md` (governance/topology). This one is execution-oriented MLB cognition. Both await MCR filing decision.

**Operator framing honored throughout:** operational stability ≠ MLB cognition completeness. The infrastructure layers (orchestration / grouped runtime / sportsbook topology / same-book constructability / backlog persistence / archetype v1) are stable; the MLB cognition layer is early-stage and the audit reflects that.

**Empirical anchor for this audit:** `backend/runtime/tracking/mlb_tracked_bets_2026-05-19.json` (178 picks · 169 UNDER / 9 OVER · 172 DraftKings / 6 FanDuel / 0 elsewhere · 65% hits-under-0.5 + 21% TB-under-1.5 · all 8 ELITE picks identical 0.680 modelProb under-TB-1.5 including Vladimir Guerrero Jr / Bobby Witt Jr / Byron Buxton / Jackson Chourio · Aaron Judge surfacing 3x — all UNDER).

---

## 1 — EXACT CURRENT MLB REALISM STRENGTHS

| # | Strength | Evidence |
|---|---|---|
| S1 | **Correlation cognition shipped, intra-slip** | MLB-COV-1/2/3 wired into `buildSlipAi.canAddLeg` (`buildSlipAi.js`: same-game OVER+OVER script_correlation, hitter-counting UNDER same-game ecological suppression, pitcher-K-OVER vs opposing hitter-counting-OVER role-aware gate). Closes the prior Coors-anchor disaster (Section 5 of MLB_CORRELATION_AUDIT). |
| S2 | **Anti-fabrication discipline is real** | Every contextual deriver (bullpen / handedness / weather / park / lineup / pitcher-env) returns truthful nulls when data absent. `bullpenByTeam` explicitly stub-only: "the project explicitly forbids fabricating data." No invented signals. |
| S3 | **Archetype v1 (Item-0009, today 2026-05-20)** addresses no-name overload | `archetypeWeighting.computeArchetypeWeight` returns archetypeTier ∈ {superstar / proven / role-player / bench / no-name}, weight ∈ [0.5, 1.4], composes role-legitimacy × prop-family-legitimacy × feelsFakeScore. Multiplicative on `compositePreArchetype` at `buildFeaturedPlays.js:1287`. Verifier `verifyItem0009ArchetypeWeighting.js`. Floor protects rare-but-robust deep-cut paths (≥ 0.9 weight when ladder-survivors corroborate). |
| S4 | **Lineup spot precision** | `deriveMlbLineupContext` produces PA proxy (4.61 → 3.81 per spot), runEnv/rbiEnv tables per spot, depth = top/middle/back. Solid bones. |
| S5 | **Confirmed-lineup state cognition** | `deriveMlbConfirmedLineupState` derives confirmedForRow / lineupSpotChanged / scratched / lateSwap with truthful nulls. Detection of late-scratched players is real. |
| S6 | **HR ecosystem depth** | `buildMlbHrPredictionCandidates` + `buildMlbHrSlips` + `buildMlbHrStacks` + `gradeMlbHrProps` + `gradeMlbHrSlips` — substantial HR-specific engine stack. (Note: surfaces to separate `hr_predictions_*` / `hr_slips_*` ledgers; cognition strength is real but **surface integration into Featured/AI-Slips needs verification**.) |
| S7 | **Probability honesty** | `probabilityHonesty.js` null-instead-of-0.5 doctrine. `buildMlbPitcherKsProbabilityEngine` returns null where prior code would have silently coerced. Calibration-honesty hardening shipped per commit log. |
| S8 | **Sportsbook governance authority** | `sportsbookAllowlist.js` (Phase Item 0002 Slice 1.5) Object-frozen 7-book allowlist + `sportsbookTopology.js` (Phase Item 0003 Slice 1) per-book capability map. Verifier `verifySportsbookConstructability.js`. |
| S9 | **Offensive ecology shipped (OE-1A/1B)** | offensivePressureIndex + hrCarryEnvironment + correlatedRunProduction + explosiveEnvironmentTag + ladderSurvivabilityFactor + stackReinforcementScore. Real signals computed. |
| S10 | **BC-1A + BC-8 realism gates** | playerLegitimacyFactor + bettorRealismScore advisory + believable-upside bucket + ladder slot 8. Layered, deterministic. |

---

## 2 — EXACT REMAINING MLB REALISM FAILURES

| # | Failure | Evidence |
|---|---|---|
| F1 | **94.9% under-bias structural** | 169/178 picks UNDER on May 19. `TIER_TEMPLATES.balanced.allowedSides: ["under"]` still cemented at `buildSlipAi.js:545`. OE-14 deferred until OE-1A/1B observation window confirms. **Structural symptom of the model itself** — not just tier templates. |
| F2 | **ELITE tier is a flat-coefficient cluster** | All 8 ELITE picks May 19 = identical modelProb 0.680 UNDER TB 1.5. That's not curated edge; that's "model thinks every superstar has 68% chance of under 2 TB at this line magnitude" — a calibration coefficient hitting a book line systematically. |
| F3 | **Contextual signals are TAGGED but NOT CONSUMED in scoring** | `composeMlbContextualSignal.js` literally self-declares: *"Phase 1 is OBSERVATIONAL ONLY — `mlbContextualShift` is attached to rows but downstream `hydrateMlbProbabilityLayer` does not yet consume it."* Wind / park / handedness / lineup / pitcher-env / bullpen tag rows but **do not move modelProb or score**. The model proudly displays "WIND_OUT_TO_CF · HR_FRIENDLY_PARK" then ignores those tags when picking. |
| F4 | **scoreMlbProp is 50 lines, naïve** | Score = (edge × 3.0) + (signalScore × 1.5) + (modelDelta × 2.0). No archetype-at-score-time, no per-family weights, no contextual fusion. Archetype hits *Featured composite*, but base scoring is thin. |
| F5 | **Implausible edge magnitudes** | +0.10 to +0.16 edges across 178 picks on a single night. From a sportsbook-trader perspective: if those edges were real, DK's risk desk would have moved the lines. Real explanation: implied prob is computed from raw American odds (not vig-stripped) and modelProb is over-confident on under side. |
| F6 | **Three overlapping legitimacy layers, unaudited composition** | BC-2 `playerLegitimacyFactor` + BC-8 `bettorRealismScore` + PCE-1A `playerConvictionEngine` (hitter-overs only) + Item-0009 `archetypeWeighting`. Four legitimacy/realism layers. No verifier checks for reinforcement vs neutralization of each other; composition behavior not characterized. |
| F7 | **Archetype is directionally symmetric** | A Vlad Jr OVER and Vlad Jr UNDER get the same archetypeWeight. The engine prevents no-name overrepresentation but does not detect "superstar UNDER is itself a feels-fake surface for a sharp bettor." That's the actual May 19 ELITE pattern. |
| F8 | **Bullpen ecology dormant** | `deriveMlbBullpenContext` is a shape stub. `bullpenByTeam` absent. OE-13 NEUTRAL. No leverage cognition, no setup/closer fatigue, no fragility tracking. |
| F9 | **No game-script / late-game cognition** | No starter pull detection, no blowout awareness, no pinch-hit / pinch-run risk, no rest-day inference, no first-inning vs late-inning prop differentiation. Game flow is opaque. |
| F10 | **No lineup sequence cognition** | `deriveMlbLineupContext` comment: "we never invent who hits behind whom in Phase 1 (would require live lineup card with sequence); that is a deferred enrichment." Protection-batter awareness, on-base setup, who-drives-Judge-home — absent. |
| F11 | **Calibration corpus frozen** | `FAMILY_CALIBRATION_COEFFICIENTS` unrefreshed across 20+ phases. Settlement-Orchestration-1A auto-chain shipped but adaptive refresh blocked on persisted verdict outcomes + per-bucket ROI surface. |

---

## 3 — EXACT "STILL FEELS FAKE" SURFACES

| # | Surface | Why it feels fake to a bettor |
|---|---|---|
| FF1 | **The ELITE tier on May 19** | "Tonight's elite picks: 8 superstar UNDERS at identical 0.680 modelProb." Sharp bettor / DFS grinder / commentator IMMEDIATELY reads this as model artifact, not real edge. |
| FF2 | **Aaron Judge surfacing 3x all UNDER** | UNDER runs 0.5 / UNDER TB 1.5 / UNDER RBI 0.5. Three lines on the league's premier power hitter, all UNDER. A tape-watcher would expect at least one OVER somewhere — none. |
| FF3 | **HeroPickCard on a down night** | Hero = composite-max. When the surface is dominated by under-stack, hero often becomes a contrarian superstar fade with no narrative explaining why. Reads operator-grade, not bettor-grade. |
| FF4 | **Edge magnitudes** | +10–16% edges across the board. A sportsbook trader's first read: "this model is broken or the implied prob is from stale lines." |
| FF5 | **Tag chips without consequence** | Row shows "WIND_OUT_TO_CF · HR_FRIENDLY_PARK · LINEUP_HEART" but the modelProb wasn't shifted by them. Bettor sees decorations; trader sees no actual signal use. |
| FF6 | **Same prop family / same line repetition** | 38 different players, every one TB UNDER 1.5, every one modelProb 0.680. Lacks the variety of actual MLB props (1.5 / 2.5 TB lines, alt-1.5, longshot 2+ HR, etc.). |
| FF7 | **DK monopoly on "best book"** | "Book Radar" / line-shopping intelligence with 97% DK inventory = no real comparison. Bettor opens Book Radar and sees one book. |
| FF8 | **PortfolioWarning labels** | Still operator-shaped (per A-3). "high_correlation:script_risk_high:scriptCluster_NYY_BOS_3legs" — bettor unreadable. |
| FF9 | **"Edge Log" / "Risk Map" / "Book Radar" tab names** | Analyst-vocabulary; bettor-vocab BNSB-1B-11 re-tone deferred. |
| FF10 | **NBA First Basket tab visible in MLB context** | Domain leak; reduces trust in surface curation. |
| FF11 | **Calibration honesty in pitcher Ks** | Engine returns null appropriately (good), but when null the row gets `predSafe=0.5` historically OR is dropped silently — verify whether honest-null appears on the surface or just hidden. |

---

## 4 — EXACT PROP FAMILIES STILL UNDERDEVELOPED

| Family | Engine | Surface coverage May 19 | Underdevelopment |
|---|---|---|---|
| **Home Runs** | DEEP (HrPredictionCandidates / HrSlips / HrStacks / gradeMlbHrProps / gradeMlbHrSlips / analyzeMlbHrResults) | 0 in mlb_tracked_bets (separate ledger) | HR ecosystem ships to `hr_predictions_*` / `hr_slips_*` parallel surface. **Integration into Featured/AI-Slips/Discover unclear** — needs verification of whether HR picks compete in the unified workstation surface or remain a parallel product. |
| **Total Bases** | implicit (engine-less, family-handled in scoring + ladder) | 38 picks (21%) | All clustering at UNDER 1.5 modelProb 0.680. **No 2.5 / 3.5 alt-line surfacing, no longshot 3+ TB exposure.** Family handled superficially. |
| **Hits** | `buildMlbHitsProbabilityEngine` (Poisson λ from hit-1-plus) | 116 picks (65%) | All at line 0.5 UNDER. **No 1.5 / 2.5 hit overs for elite contact bats; no multi-hit longshots.** Family monopolized by hitless-game market. |
| **RBI** | `buildMlbRbiProbabilityEngine` (Poisson) | 1 pick | Engine exists, **surface absent**. Aaron Judge UNDER 0.5 RBI is the lone entry. No RBI OVER ladders, no power-hitter RBI exposure. |
| **Runs Scored** | implicit | 7 picks | All UNDER 0.5 runs. No OVER 1.5 leadoff/top-of-order exposure. |
| **Pitcher Strikeouts (Ks)** | `buildMlbPitcherKsProbabilityEngine` | 1 pick | Engine exists, **surface absent**. Aces vs weak offenses (the prime K-over market) not surfacing. |
| **Pitcher Outs / IP** | implicit | 13 picks | Most active pitcher family. Reasonable surface. |
| **Pitcher Walks (BB)** | implicit | 1 pick | Thin. No "high-walk-rate pitcher UNDER 2.5 walks" exposure. |
| **Singles / Doubles / Triples (1B / 2B / 3B)** | absent | 0 | Family unbuilt. Doubles props are real markets at DK/FD. |
| **Stolen Bases (SB)** | absent (archetype lists it; no `buildMlbSbProbabilityEngine`) | 0 | Family unbuilt. Lead-off speedster props absent. |
| **HBP** | absent | 0 | Family unbuilt. |
| **First-inning runs (YRFI / NRFI)** | absent | 0 | Family unbuilt. Substantial market with sharp action. |
| **First-5-innings team total** | absent | 0 | Family unbuilt. Important for starting-pitcher-driven slates. |
| **Team Totals / Game Totals** | absent | 0 | Family unbuilt. Bettor cannot get team-total exposure through this surface. |
| **Pitcher OVER WHIP / hits allowed / earned runs** | absent | 0 | Family unbuilt beyond Ks/outs. |

---

## 5 — EXACT GAMEFLOW COGNITION GAPS

| # | Gap | Impact |
|---|---|---|
| GF1 | **Starter pull detection absent** | When the SP comes out (blowout / fatigue / leverage matchup), the model can't see it. Pitcher Ks/Outs cognition pretends 9-inning game by default. |
| GF2 | **Blowout awareness absent** | High-implied-team-total → blowout → late-game effort drops → late-inning hitter props collapse. Not modeled. |
| GF3 | **Pinch-hit / pinch-run risk absent** | Bench RBI/run-scored opportunity from pinch-running is invisible. |
| GF4 | **Rest-day inference absent** | "Cole is on regular rest" vs "Cole is on short rest" — no surface. |
| GF5 | **First-inning vs late-inning differentiation absent** | All "outs" treated as fungible; YRFI/NRFI/F5 props don't exist. |
| GF6 | **Same-team OVER stack rationale (not just suppression)** | MLB-COV-1 suppresses bad correlation; OE-1B `stackReinforcementScore` rewards good correlation. But no "this offense vs this bullpen with this leverage profile" stack rationale surfaced to bettor. |
| GF7 | **Game-script over/under conviction asymmetry** | Same-game OVER+OVER gated to ≤3 legs (script_correlation); AGGRESSIVE/LOTTO bypasses. Inconsistent enforcement of script realism by tier. |
| GF8 | **Reliever-leverage cognition absent** | High-leverage 8th inning vs garbage-time 8th inning — invisible. Setup/closer entry cognition zero. |
| GF9 | **Weather mid-game progression absent** | Wind/temp at first pitch ≠ wind/temp in 8th inning. Static-snapshot weather is the only signal. |
| GF10 | **Park-specific late-game effects absent** | Coors at altitude affects late-game pitcher fatigue differently than sea-level; not modeled. |

---

## 6 — EXACT LINEUP-ROLE COGNITION GAPS

| # | Gap | Impact |
|---|---|---|
| LR1 | **Sequence awareness absent** | Who hits BEFORE Judge (sets him up for RBI) and AFTER Judge (drives him home for runs scored). Static spot tables ignore actual sequence. |
| LR2 | **Lineup-card hover absent on FE** | BNDS-1C hover cards deferred (A-2 bottleneck). Bettor can't see "tonight's lineup card" without leaving the surface. |
| LR3 | **Confirmed-lineup state surfaced in FE?** | `deriveMlbConfirmedLineupState` produces lateSwap / scratched signals. Verification needed: are these surfaced as bettor-visible badges? If not, bettor can bet on a scratched player. |
| LR4 | **Platoon split per-batter absent** | `deriveMlbHandednessContext` produces `batterPlatoonShift` (observational-only). Sharp bettor wants "X vs LHP last 14 days" — not surfaced. |
| LR5 | **Lineup-spot change ripple absent** | If a 7-hole bench bat moves to cleanup tonight (injury fill), all his props should shift dramatically. Detected (`lineupSpotChanged`) but not amplified into modelProb. |
| LR6 | **Plate-appearance proxy too static** | PA_BY_SPOT is league-average; doesn't adjust for game-script (extra innings vs called-early) or matchup-specific velocity. |
| LR7 | **No "rest of order" cognition for stacks** | Stacking 2-3 from the same lineup needs to consider the order they hit in (consecutive batters > scattered). MLB-COV addresses opposing-pitcher correlation but not intra-lineup sequence. |
| LR8 | **Role legitimacy is static** | archetypeWeighting role table is fixed; doesn't update from observed in-season role drift (e.g., bench player promoted to regular). |

---

## 7 — EXACT SPORTSBOOK REALISM GAPS

| # | Gap | Impact |
|---|---|---|
| SB1 | **Ingest covers 2 of 7 allowed books** | 96.6% DK, 3.4% FanDuel, 0% other 5. Line-shopping intelligence is functionally a no-op. |
| SB2 | **`sportsbookTopology.js` Slice 2 not wired** | Per self-comment: "Consumers (Slice 2 — not yet wired): buildSlipAi + buildFeaturedPlays compactPlay book selection." Topology authority exists; emit-path consumption pending. |
| SB3 | **Alt-line availability not verified** | Model emits "UNDER 1.5 TB at +159" without checking whether DK actually offers UNDER 1.5 TB on this player tonight or only UNDER 2.5. Sharp bettor's first check; model can't answer. |
| SB4 | **SGP-specific construction rules absent** | DK SGP doesn't allow all leg combinations; treating all DK legs as SGP-buildable is over-assertion. |
| SB5 | **Vig stripping in implied prob** | `impliedProb` field uses raw American odds. The bookmaker overround isn't normalized out. Edge calc compares modelProb to NON-vig-stripped impliedProb → inflated edges. |
| SB6 | **Line movement not surfaced per row** | `deriveMlbLineMovementState` exists in `pipeline/mlb/live/`; not visible in tracked_bets row. No "this line moved 0.5 against your side in last 15 min" annotation. |
| SB7 | **Cross-book disagreement degenerate** | Market-Ecology-1A's consensusConfidence + cross-book disagreement intelligence needs ≥2 books; with one-book-monopoly inventory, consensus = self. |
| SB8 | **Steam / sharp-money detection absent** | No "sharp action" surface; no reverse-line-movement detection beyond what stale-line gives. |
| SB9 | **Player prop withdrawal awareness absent** | When DK takes a prop down (injury news, late scratch), there's no signal. Surface stays live with phantom inventory. |
| SB10 | **Book bias awareness absent** | Some books are softer on overs (FD historically); some hold heavier on alt-lines (DK SGPs). No per-book bias modeling. |

---

## 8 — EXACT FE WORKFLOW FRICTION

| # | Friction | Impact |
|---|---|---|
| FE1 | **NBA "First Basket" tab visible in MLB context** | Domain leak in nav. |
| FE2 | **"Edge Log" / "Risk Map" / "Book Radar"** | Analyst-vocab tabs; BNSB-1B-11 re-tone deferred. |
| FE3 | **PortfolioWarning labels operator-shaped (A-3)** | Risk Map renders `script_risk_high:scriptCluster_NYY_BOS_3legs` — bettor unreadable. |
| FE4 | **Diagnostics CLI never reaches FE (A-4)** | grading/calibration/lineage status invisible to workstation. |
| FE5 | **No per-event hover cards (A-2)** | GameCard doesn't surface pitcher matchup / lineup / weather on hover. |
| FE6 | **No survivability sort (A-5)** | Discover lenses sort by avgImpliedTeamTotal; no ladderSurvivabilityFactor or bettorRealismScore option. |
| FE7 | **Slip narrative chip-dump (A-1)** | BNSB-1C `composeSlipNarrative` deferred. SlipCard reads as chip-dump, not story. |
| FE8 | **9-vs-7 ladder slot rendering** | Dashboard.tsx comment says 7 slots; backend has 9 (BC-6 slot 8 + OE-7 slot 9). Either dynamic render works (per BNSB-1A claim) or FE comment is stale and 8/9 dropped. Needs runtime verification. |
| FE9 | **Dashboard density** | 8 visual sections per render. Comprehension cost meaningful. |
| FE10 | **No "tonight's bomb ticket" hero** | bestExplosiveUpside is slot 9 — buried below safer slots. Per strategic audit §6.3: hero treatment for upside doesn't exist. |
| FE11 | **No archetype-aware filter / sort in FE** | Item-0009 archetypeTier ships today; FE doesn't yet expose "show me only superstar / proven / role-player" filters. |
| FE12 | **Lineup confirmation badge unverified** | If a player is scratched, does the surface visually demote/hide them? Need verification. |

---

## 9 — EXACT NEXT MLB COGNITION PRIORITIES

The cognition gaps cluster into 5 architectural families. Listed by leverage, not by sequence (sequence in §10).

| Family | Priority items |
|---|---|
| **P1. Contextual signal → score consumption** (closes F3) | Wire `mlbContextualShift` from `composeMlbContextualSignal` into modelProb / score. End the "Phase 1 OBSERVATIONAL ONLY" status. Bounded fusion (±10% as already declared) so the existing observability test envelope stays intact. |
| **P2. Directional-credibility archetype gate** (closes F7) | Extend `archetypeWeighting` to be directionally aware: superstar UNDER vs superstar OVER receive different feelsFakeScore. Decide via per-tier / per-prop-family / per-side credibility table. |
| **P3. Vig-stripped EV + edge magnitude calibration** (closes F5, SB5) | Add canonical vig-stripping helper. Recompute `impliedProb` post-overround. Recalibrate edge magnitudes. |
| **P4. Prop-family completion** (closes section 4) | Build SB / 1B-2B-3B / first-inning runs / F5 team total / team total / HBP / pitcher walks-over / pitcher hits-allowed families. Each is its own probability engine. |
| **P5. Cross-book ingest expansion** (closes SB1, SB7) | Activate ingest paths for Caesars / BetMGM / Fanatics / Hard Rock / BetRivers. Until done, line-shopping intelligence cannot prove its own value. |
| **P6. Lineup sequence cognition** (closes LR1, LR5, LR7) | Add live-lineup-sequence enrichment. Compute protection-batter awareness, on-base-setup, RBI sequence. |
| **P7. Bullpen ingest activation** (closes F8) | Build the bullpen ingest path. Activate `deriveMlbBullpenContext`. Wire OE-13 from NEUTRAL to live signal. |
| **P8. Gameflow / late-game cognition** (closes GF1-10) | Detect starter pull risk, blowout late-effort drop, pinch-hit risk, rest-day inference. Each is small per-row enrichment with downstream score consumption. |
| **P9. Narrative compression (BNSB-1C)** (closes FF3, FE7, A-1) | Ship `composeSlipNarrative` — narrative-form slip reasoning from canonical signals. Bettor-emotional payoff. |
| **P10. Diagnostics aggregator + tab (Operational-1B)** (closes FE4, A-4) | NEW `/api/ws/diagnostics` + FE Diagnostics tab. |
| **P11. Legitimacy-layer composition audit** (closes F6) | Characterize BC-2 + BC-8 + PCE-1A + Item-0009 composition behavior. Verify reinforcement, identify neutralization, declare composition order. |
| **P12. Confirmed-lineup FE surfacing** (closes LR3, FE12) | If `confirmedForRow=false` or `scratched=true`, visual demote/hide on FE. |

---

## 10 — EXACT RECOMMENDED EXECUTION ORDER

Order optimizes for: (a) **load-bearing fix first**, (b) **each phase observably visible to bettor**, (c) **earlier phases enable later phases**.

| # | Phase candidate | Closes | Why this slot |
|---|---|---|---|
| **1** | **MLB-Cognition-Honesty-1A (vig-stripping + edge recalibration)** | F5, SB5 | The +10–16% edge magnitudes are the single biggest "model is fake" surface. Until vig-stripping exists, every other improvement happens on top of inflated edge numbers. Tiny lever, immediately bettor-visible. Probability-honesty pattern. |
| **2** | **MLB-Cognition-1A (contextual signal → score consumption)** | F3 | The deepest hidden capability — wind/park/lineup/handedness/pitcher-env/bullpen all derived and tagged but never used. Activating consumption is the single highest-leverage cognition unlock. Pairs naturally with the recently-shipped archetype layer for composite. |
| **3** | **MLB-Cognition-1B (directional-credibility archetype)** | F7, FF1, FF2 | Closes the May-19 ELITE-superstar-UNDER pattern. Item-0009 ships today; extending it for directional credibility is the natural next slice. Bettor-visible (superstar UNDER picks demoted, superstar OVER picks elevated). |
| **4** | **BNSB-1C narrative compression** | FF3, FE7, A-1 | After phases 1-3, the cognition is real; phase 4 makes it READABLE. `composeSlipNarrative` per the named candidate. |
| **5** | **MLB-Cross-Book-Ingest-1A** | SB1, SB7 | Activates the line-shopping intelligence that the engine already supports. Smallest engineering scope: extend existing odds-fetch to cover the other 5 allowed books. |
| **6** | **MLB-Prop-Family-1A (RBI + Ks surfacing)** | Section 4 partial | RBI and Ks engines already exist; their surface is empty. Smallest prop-family unlock. Adds OVER-side variety (counteracts F1 under-bias). |
| **7** | **MLB-Lineup-Sequence-1A** | LR1, LR5, LR7 | Builds on confirmed-lineup state. Adds protection-batter + RBI-sequence cognition. Sharp / DFS-grinder leverage. |
| **8** | **MLB-Bullpen-Ingest-1A** | F8, GF8 | Activates dormant bullpen layer + OE-13. Required prerequisite for high-leverage / late-game cognition. |
| **9** | **MLB-Gameflow-1A (starter-pull + blowout + pinch-hit risk)** | GF1, GF2, GF3 | Layers on bullpen + lineup confirmation already in place. Late-game cognition unlock. |
| **10** | **MLB-Prop-Family-1B (SB + 1B-2B-3B + YRFI/NRFI + F5 + Team Totals)** | Section 4 majority | The big prop-family expansion. Each family is its own engine. Spreadable into 1B-1, 1B-2, 1B-3 sub-phases at MCR discretion. |
| **11** | **MLB-Legitimacy-Composition-Audit-1A** | F6 | Once cognition is real (phases 1-3, 8), audit the layered composition of BC-2 + BC-8 + PCE + Item-0009. Pure observational; no patches in the audit phase. |
| **12** | **FE-Confirmed-Lineup-Surface-1A** | LR3, FE12 | Small bettor-visible safety. Verify confirmedForRow / scratched / lateSwap surfaced. |
| **13** | **Operational-1B Diagnostics tab** | FE4, A-4 | Per CURRENT_PROBLEMS A-4. Lower priority for MLB-realism; matters for trust. |
| **14** | **BNDS-1C hover cards + survivability lens** | A-2, A-5 | Closes remaining bottleneck UX gaps. |

**Single most leverage-dense recommendation: PHASES 1–3.** Vig-stripping + contextual-signal consumption + directional-credibility archetype are three tight phases that together flip the model from "tags-decorate-but-don't-drive" to "every signal flows into score" and from "superstar-UNDER-feels-fake" to "directional credibility weighted." If only one bundle ships next, it is this bundle.

---

## NOTES FOR MCR

- **This audit is NOT a canonical doc.** `_PENDING_MCR` suffix is intentional. MCR decides filing location and lineage reconciliation with the prior FULL_SYSTEM_AUDIT artifact.
- **No invariants violated.** Read-only throughout. No patches, deprecations, or new canonicals.
- **Sibling artifact** exists: `FULL_SYSTEM_AUDIT_2026-05-17_PENDING_MCR.md` (governance/topology); this one (MLB cognition) is execution-oriented.
- **Lane recommendation after MCR sequences this queue:** ACTIVE EXECUTION for phases 1–3 (the leverage-dense bundle), with INFRA / GOVERNANCE handling phase 11's audit-only composition characterization in parallel.

— end of audit deliverables —
