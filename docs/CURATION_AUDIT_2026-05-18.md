# CURATION AUDIT — 2026-05-18 (CA-1)

**Lane:** FULL SYSTEM AUDIT (observational + classificatory, read-only)
**Phase:** CA-1 (Curation Audit Phase 1) — Stage A inventory + Stage B objective-function reconstruction
**Mode:** read-only. Zero patches. Zero reconciliation proposals. The goal is not to find a bug. The goal is to **understand what the intelligence stack is ACTUALLY optimizing for.**
**Operator-cemented bounds:** no premature calibration fixes · no compensating weights · no "just boost star players" shortcuts · no battlefield sterilization · no curated-surface hacks.
**Invariants preserved:** additive-only · canonical authority · replay safety · governance continuity · ecology integrity · survivability trust · bettor-native UX goals.

---

## STAGE A — INTELLIGENCE STACK INVENTORY

The intelligence stack spans ~80 files across `backend/pipeline/{shared,mlb,nba,edge,filters,selection,boards,markets,review,signals,decision}` + `backend/config/modelConfig.js` + `backend/ml/` + `backend/routes/workstationRoutes.js`. The inventory below captures every file that **influences scoring, curation, survivability, ecology, calibration, ranking, payout, or discovery routing.** For each: path · declared purpose · canonical signals consumed · surfaces emitted · optimization target.

### A.1 — Per-prop scoring layer (entry point to composite)

| File | Declared purpose | Signals consumed | Surface emitted | Optimization target |
|---|---|---|---|---|
| `backend/config/modelConfig.js` | Global model config | (constants) | `filters {minModelProb:0.10, minEdge:-0.02, maxPerGame:1}` · `weights {score:0.5, edge:0.3, recentForm:0.2}` | Permissive pool entry: NEGATIVE edge accepted, 10% modelProb accepted. |
| `backend/pipeline/mlb/scoreMlbProp.js` | Phase-3 MLB row-level prop score | `edgeProbability`, `signalScore`, `predictedProbability`, `impliedProbability`, `odds`, `propType` | `{ score, confidence: HIGH/MED/LOW, category }` | `score = edge×3 + signal×1.5 + (predP − impP)×2`. Post-score adjustments: −0.5 if odds < −200 (heavy-favorite penalty); −0.5 if signalScore is null. Confidence thresholds: >2 HIGH, >1 MED, else LOW. |

### A.2 — Curated-edge composite (the dominant scoring surface)

| File | Declared purpose | Signals consumed | Surface emitted | Optimization target |
|---|---|---|---|---|
| `backend/pipeline/shared/buildFeaturedPlays.js — scoreCandidate(c, ctx)` | Multi-factor 0..1 composite for curated featured pool | `edge`, `modelProb`, stat-family ROI (`ledgerStats.statFamilyRoi`), stat-family CLV (`ledgerStats.statFamilyClv`), `timing.urgency/state`, `bookState.books[*].avgClv`, `marketDispersion`, `bookCount`, `volatility`, `tier`, BC-2 `playerLegitimacyFactor(c)` (depth × impliedTeamTotal), OE-2 `offensivePressureIndex(c)` (runEnv × teamTotal × carryShift), OE-3 `hrCarryEnvironment(c)` (wind-out + carryShift + HR_FRIENDLY + temp≥75), OE-4 `correlatedRunProduction(c)` (lineupSpot 1-4 + runEnv/rbiEnv ≥ 0.55), OE-13 `bullpenFragilityContext(c)`, PCE `computePlayerConviction(c).factor` and `.additive` (lineupSpot × PA × stat-side coherence × model-trust) | `{ composite ∈ [0,1], factors, timingClass, lineShop }` | Weighted-mean of 10 lenses (Σ weight = 1.02) + signed additive boosts + signed soft demotes. Edge contribution capped at 0.25 lens; probability factor neutralized to [0.50, 0.55] band. |
| `backend/pipeline/shared/playerConvictionEngine.js` | PCE-1A pure-function conviction composite | `lineupSpot` (1-9), `plateAppearancesProxy`, `modelProb`, `edge`, `statFamily`, `side`, `impliedTeamTotal`, `hrEnvironmentTag` | `{ factor ∈ [0,1], additive ∈ [-0.04, +0.05], phrase, reasonTag, gated, debug }` | Hitter-overs-only sustainability. Bypasses pitcher/under. Max boost +0.05; max penalty −0.04; PCE_NEUTRAL = 0.50 for absent signals (anti-fabrication). Never zeros out longshots. |
| `backend/pipeline/shared/bettorLanguage.js` | Bettor-language phrase library (VBI-1A) | `SIGNAL_IDS`, `SIGNAL_PHRASES` | `renderVerdictPhrases`, `composeVerdictSummary` | Deterministic phrase library; NO LLM. 14 canonical signal ids. |
| `backend/pipeline/shared/probabilityHonesty.js` | Calibration-honest null preservation | `modelProb` | (returns null when unknown, never 0.5 synthesis) | Anti-fabrication: never synthesize a 0.5 default. |

### A.3 — Slip composition (AI slips)

| File | Declared purpose | Signals consumed | Surface emitted | Optimization target |
|---|---|---|---|---|
| `backend/pipeline/shared/buildSlipAi.js — scoreLeg(leg, ctx)` | Multi-factor leg score for slip assembly | `edge`, `modelProb`, `clv`, `timing.urgency/state`, `bookState.books[*].avgClv`, `archetype` + `archetypeRoi`, `line`, exposure (player/game/stat), `tier` | `{ composite ∈ [0,1], factors }` | Weighted-mean of 8 lenses (Σ = 1.00): projection 0.30 (`edge × 5 × probFactor`; probFactor capped [0.50, 0.55]); clv 0.15; timing 0.10; book 0.10; volatility 0.10 (hardcoded 0.5 neutral placeholder); archetype 0.05; ladder 0.05; diversification 0.05. Plus tierBoost (ELITE +0.05, STRONG +0.025, LOTTO −0.05, FADE −0.30). |
| `buildSlipAi.js — TIER_TEMPLATES` | Slip-tier constraint templates | (config) | Per-tier `{ legCountRange, minModelProb, maxOdds, decimalOddsRange, allowedVolatility, forbidVolatility, allowedSides, maxPerGame, maxPerStat, maxFb }` | **SAFE:** 2-3 legs, modelProb≥0.55, maxOdds≤+150, dec[1.8–4.0], allowed=safe+balanced, forbid=lotto, maxPerGame:1.<br>**BALANCED (MLB):** under-only (!!), 2-3 legs, modelProb≥0.45, dec[3.0–8.0], allowed=safe+balanced+aggressive.<br>**AGGRESSIVE:** 2-4 legs, modelProb≥0.20, maxOdds≤+600, dec[6.0–120.0], allowed=balanced+aggressive+lotto.<br>**LOTTO:** 3-5 legs, modelProb≥0.10, maxOdds≤+2000, dec[20.0–1500.0], allowed=aggressive+lotto. |
| `buildSlipAi.js — applyNbaTierOverrides(tpl, tier)` | NBA-specific tier loosening | (config) | NBA SAFE: minModelProb 0.50, maxOdds 200, dec[1.8–7.5], forbid=lotto+aggressive, maxPerGame 2, maxPerStat 1, skipScriptCorrelation:true.<br>NBA BALANCED: drops under-only, allowed=safe+balanced (revert from aggressive). NBA AGGRESSIVE/LOTTO: maxPerGame 3/4, skipScriptCorrelation:true. | NBA correlation handled at composition layer by `nbaCorrelationEngine`, not by MLB script-correlation heuristic. |
| `buildSlipAi.js — canAddLeg(slipLegs, candidate, tpl)` | Leg admission check during assembly | `candidate.player/game/statFamily/side/volatility`, `tpl.{maxPerGame, maxPerStat, maxFb, forbidVolatility, skipScriptCorrelation}` | `{ ok, reason }` | Diversification + script-correlation block (MLB) + MLB-COV-1/2/3 (pitcher-K vs opposing hitter-OVER; same-game hitter-UNDER ecological suppression). |
| `buildSlipAi.js — offensiveAttackTextureBonus(leg, timingMap)` | Aggressive/Lotto tie-break bonus | `side`, `statFamily`, `edge`, `volatility`, timing | bonus ∈ [0, 0.07] | Offensive over + edge>3.5% → +0.016 (was 0.032 pre Realism-Ecology-1A); aggressive/lotto + edge>4% → +0.022; steam/immediate → +0.014. Total capped 0.07. |
| `buildSlipAi.js — combineLegs(legs, opts)` | Joint-probability composition | per-leg `odds`, `modelProb`, `statFamily`, OE-11 `stackReinforcementScore` (optional injected) | `{ combinedDecimalOdds, combinedAmericanOdds, combinedModelProb (reinforced), rawCombinedModelProb, calibratedCombinedModelProb, oe11ReinforcementBoost, combinedImpliedProb, edge, ev }` | Calibrated joint-prob via FAMILY_CALIBRATION_COEFFICIENTS (default 0.85; rbis/outs excluded from slips entirely); optional OE-11 stack-reinforcement boost cap +0.03. |
| `buildSlipAi.js — FAMILY_CALIBRATION_COEFFICIENTS` | Per-family slip-prob downweight | (constants) | per-family coefficient | Default 0.85 (15% discount); excluded families (rbis/outs) cannot enter slips at all. |

### A.4 — Curation orchestration + survivability + ecology (within buildFeaturedPlays)

| Constant / function | Purpose | Magnitude / behavior |
|---|---|---|
| `BC2_LEGITIMACY_WEIGHT` | BC-2 lens weight inside scoreCandidate weighted mean | 0.07 (7%) |
| `BC4_SOFT_DEMOTE` | BC-4 hostile-env sort-time demote | −0.05 effective composite; activates on `hrEnvironmentTag = HR_SUPPRESSING` OR `impliedTeamTotal < 3.5` (combined demote bounded at 2×BC4 = −0.10) |
| `OE2_PRESSURE_WEIGHT` | OE-2 lens weight | 0.05 |
| `OE3_HR_BOOST_CAP` | OE-3 additive composite boost on HR overs | +0.03 (gates: wind-out + carryShift>0 + HR_FRIENDLY + temp≥75) |
| `OE4_RUN_BOOST_CAP` | OE-4 additive on runs/RBIs top-of-order | +0.03 (gates: lineupSpot ∈ [1,4] + runEnv ≥ 0.55 OR rbiEnv ≥ 0.55) |
| `OE8_LADDER_DEMOTE_CAP` | OE-8 sort-time soft demote on low-survivability ladders | −0.04 when `ladderSurvivabilityFactor < 0.40`; factor = `ladderHeightFactor × paFactor × runEnvFactor × hrCarryFactor` |
| `OE11_PAIR_BOOST_CAP` / `OE11_TOTAL_BOOST_CAP` | OE-11 per-pair / aggregate stack-reinforcement boost on joint probability | +0.02 per pair / +0.03 aggregate |
| `OE12_TURNOVER_BOOST_CAP` | OE-12 lineup-turnover boost (aggressive/lotto only) | +0.02 |
| `OE13_BULLPEN_BOOST_CAP` | OE-13 bullpen-fragility additive composite boost | +0.02 (gates: bullpen fragility score > 0.55) |
| `PCE_WEIGHT` | PCE lens weight | 0.05 |
| `PCE_MAX_BOOST` / `PCE_MAX_PENALTY` | PCE additive (signed) | +0.05 / −0.04; net ∈ [−0.04, +0.05] |
| `tierBoost` | Tier-driven additive in scoreCandidate | ELITE +0.04, STRONG +0.02, LOTTO −0.05, FADE −0.30 |
| `textureBoost` | Aggressive/lotto offensive-over preference inside scoreCandidate | aggressive/lotto + edge>4.5% offensive-over → +0.030 · aggressive/lotto + edge>4.5% other → +0.018 · offensive-over (any vol) + edge>5% → +0.020 |
| `f.edge = clamp(0,1, edge×4 × probFactor)` | Edge lens with neutralized prob factor | probFactor clamped to [0.50, 0.55] band — neutralizes probability magnitude; edge × 4 saturates at edge=25% |
| `f.volRealism` | Volatility-class lens (the only lens explicitly favoring safe over volatile) | safe 0.80 · balanced 0.74 · aggressive 0.66 · lotto 0.65 · fallthrough 0.56. Weight 0.10. |
| `f.archetype` / `f.clv` | Stat-family ROI / CLV history lenses | Both default to 0.55 NEUTRAL when no history → INERT in cold-start / new-family contexts. Weights 0.10 / 0.12. |

### A.5 — Selection, filtering, board layers

| File | Purpose | Notes |
|---|---|---|
| `backend/pipeline/filters/fragile.js` | NBA fragility flag (`isFragileLeg`) | Demote conditions: `avgMin < 22`, `minFloor < 10`, `minStd ≥ 9`, `valueStd ≥ 11`, `trendRisk = "high"`. Force-includes watched players bypass. |
| `backend/pipeline/selection/bestProps.js` | Diversified best-props selection | Consumes scored candidate pool; applies `maxPerPlayer/maxPerGame/maxPerStat` thresholds. |
| `backend/pipeline/selection/flexProps.js` | Flex-tier selection | Looser caps for board variety. |
| `backend/pipeline/boards/buildBestLadders.js` | Ladder construction; applies OE-8 ladder demote at sort time | Output: 9-slot recommendationLadder shape. |
| `backend/pipeline/boards/buildBestSpecials.js` | Specials / longshots / specialty buckets | Output: bestHr, bestPra, bestFirstBasket, smartAggression, etc. |
| `backend/pipeline/boards/buildCuratedLayer2Buckets.js` | Curated layer-2 buckets (bestBalanced/Aggressive/Unders/AltLadders/DisagreementEdges/StaleLine/TrapLadders/InflatedSuperstarSpots) | Outputs Operator-Experience-1A surfaces. |
| `backend/pipeline/markets/boardClassification.js` + `classification.js` + `mlbClassification.js` | Market classification (volatility, tier) | Where `volatility` and `tier` enter rows. |
| `backend/pipeline/shared/buildPortfolioOptimizer.js` | Portfolio classification + balance | Comment in scoreCandidate: "classification fixed in buildPortfolioOptimizer" — volatility classification authority. |

### A.6 — Edge subsystem (Phase-2 spec)

| File | Purpose |
|---|---|
| `backend/pipeline/edge/scoreContextEdge.js` | Context edge scoring (lineupSpot/env/depth) |
| `backend/pipeline/edge/scoreMarketEdge.js` | Market edge (consensus disagreement, stale line) |
| `backend/pipeline/edge/scoreRiskEdge.js` | Risk-side edge (availability, status) |
| `backend/pipeline/edge/buildDecisionLayer.js` | Decision-layer composition (`avoidReason`, `playDecision`) |
| `backend/pipeline/edge/buildExternalEdgeOverlay.js` | External edge overlay (RotoWire signals) |
| `backend/pipeline/edge/normalizeExternalSignals.js` | Signal normalization |
| `backend/pipeline/edge/sourceConfig.js` | Source registry |
| `backend/pipeline/edge/PHASE2_EDGE_SPEC.md` | Doctrine spec for the edge subsystem |

### A.7 — Routing / discovery / payload assembly

| File | Purpose | Notes |
|---|---|---|
| `backend/routes/workstationRoutes.js` | `/api/ws/state` payload assembly | Builds `state.candidates` (elite, tight caps: maxPerPlayer:3 / maxPerGame:7-12 / maxPerStat:10 / maxPerStatSide:6) and `state.discoveryCandidates` (battlefield, looser caps: maxPerPlayer:8 / maxPerGame:60 / maxPerStat:60 / maxPerStatSide:35) from the SAME canonical-validated source. Both pools share `diversifyCandidates` scoring + ordering; the difference is threshold magnitude. |
| `backend/pipeline/shared/buildCandidateDiversity.js` | Diversification picker | Consumed by both candidate pools. |

### A.8 — Sport-specific scoring + intelligence

**MLB:**
- `buildMlbBootstrapSnapshot.js` (env scaffolding) · `buildMlbPlayerDataset.js` · context derivers (lineup / handedness / park / bullpen / pitcher env / weather) · `buildMlbBetSelector.js` · `buildMlbBestProps.js` · `buildMlbOpportunityBoard.js` · `buildMlbCorrelationEngine.js` (`pairCorrelationScore` — -1.0 opposing-team pitcher-K vs hitter-counting OVER; -0.5 same-team or any UNDER; 0; +0.5 same-team hitter OVER) · per-stat probability engines (HitsProbability / PitcherKsProbability / RbiProbability) · ML-side `scoreMlbProp` (per A.1).

**NBA:**
- `buildNbaBestBetsBoard.js` · `nbaCorrelationEngine.js` (pairwiseStackBoost / jointProbabilityWithCorrelation) · `nbaAiStatFamilyRank.js` · `buildNbaAiPicks.js` · `buildNbaAiSlips.js` · `buildNbaSlipComposer.js` · `nbaSlipLegConstraints.js` · `nbaAvailabilityCache.js` (out/doubtful/questionable/probable/active/unknown taxonomy) · `nbaExtendedOpportunityPools.js` · `applyNbaRowEdge.js`.

### A.9 — ML scorer

| File | Purpose |
|---|---|
| `backend/ml/scorer.js` | JS-side ML scoring helper |
| `backend/ml/model.json` | Persisted model artifacts |
| `backend/ml/train.py` / `train_simple.py` / `backtest.py` | Training + backtest harnesses (off-line) |

### A.10 — Review / calibration / ledger

| File | Purpose |
|---|---|
| `backend/pipeline/review/buildCalibrationMetrics.js` | Per-family calibration metrics |
| `backend/pipeline/review/buildEcologyGrader.js` | Ecology-side grading |
| `backend/pipeline/review/buildOffensiveEruptionAnalysis.js` | Eruption / explosive review |
| `backend/pipeline/review/buildProcessClassifier.js` | Process classifier |
| `backend/pipeline/review/buildVolatilityReview.js` | Volatility review |
| `backend/pipeline/shared/buildPersonalLedger.js` | Personal bet ledger (separate from CALIBRATION) |

---

## STAGE B — RECONSTRUCTED OBJECTIVE FUNCTION

This section reconstructs, from artifacts only, what the intelligence stack is actually optimizing for at every load-bearing step. No proposals. No reconciliation. Pure description.

### B.1 — The composite formula (curated path)

For each candidate `c`, `buildFeaturedPlays.scoreCandidate` produces:

```
weighted_mean = Σᵢ (lensᵢ(c) · weightᵢ) / Σᵢ weightᵢ

composite = clamp(0, 1, weighted_mean
                  + tierBoost(c)              // ∈ {−0.30, −0.05, 0, +0.02, +0.04}
                  + textureBoost(c)           // ∈ {0, +0.018, +0.020, +0.030}
                  + oeAdditive(c)             // OE-3 + OE-4 + OE-13 ≤ +0.08
                  + pceAdditive(c))           // ∈ [−0.04, +0.05]
```

Where the **10 lenses** (Σ weight = 1.02) are:

| Lens | Weight | Function of |
|---|---|---|
| `f.edge`        | 0.25 | `clamp(0, 1, edge × 4 × probFactor)` where `probFactor = clamp(0.50, 0.55, modelProb)` |
| `f.archetype`   | 0.10 | stat-family rolling ROI bucket (0.30 / 0.55 / 0.75 / 0.95; **default 0.55 NEUTRAL when no history**) |
| `f.clv`         | 0.12 | stat-family CLV history bucket (0.25–0.90; **default 0.55 NEUTRAL when no history**) |
| `f.timing`      | 0.10 | urgency bucket (0.15–0.95) + stale/steam adjusters |
| `f.book`        | 0.08 | book avgClv bucket (0.30–0.90) |
| `f.market`      | 0.10 | market dispersion + bookCount (0.55–0.90) |
| `f.volRealism`  | 0.10 | volatility class: **safe 0.80 · balanced 0.74 · aggressive 0.66 · lotto 0.65 · fallthrough 0.56** |
| `f.legitimacy`  | 0.07 | BC-2 `playerLegitimacyFactor(c)` (depth × impliedTeamTotal ramp) |
| `f.pressure`    | 0.05 | OE-2 `offensivePressureIndex(c)` (runEnv × teamTotal × carryShift) |
| `f.pceFactor`   | 0.05 | PCE `computePlayerConviction(c).factor` (lineupSpot × PA × stat-side coherence × model-trust) |

And the **additives** (each can swing the final composite outside the weighted mean):

| Additive | Magnitude | Gates |
|---|---|---|
| `tierBoost`     | −0.30 / −0.05 / 0 / +0.02 / +0.04 | FADE / LOTTO-tier-tag / PLAYABLE / STRONG / ELITE |
| `textureBoost`  | 0 / +0.018 / +0.020 / +0.030 | (aggressive/lotto AND edge>4.5%): +0.018 (or +0.030 if also offensive-over). Or (any vol AND offensive-over AND edge>5%): +0.020. |
| `oeAdditive`    | 0 to +0.08 | OE-3 HR carry (≤+0.03) + OE-4 run prod (≤+0.03) + OE-13 bullpen (≤+0.02) |
| `pceAdditive`   | −0.04 to +0.05 | hitter-overs only; pitcher/under bypass; gated on canonical lineupSpot + PA + side-coherence + model-trust |

And the **sort-time soft demotes** (applied at curated-output time, never mutating composite):

| Demote | Magnitude | Gates |
|---|---|---|
| BC-4 hostile env | −0.05 (combined ≤ −0.10) | `hrEnvironmentTag = HR_SUPPRESSING` OR `impliedTeamTotal < 3.5` |
| OE-8 ladder survivability | −0.04 | `ladderSurvivabilityFactor < 0.40` |

### B.2 — The slip-leg formula (slip path)

`buildSlipAi.scoreLeg` produces (Σ weight = 1.00):

| Lens | Weight |
|---|---|
| projection (`edge × 5 × probFactor`; probFactor clamped [0.50, 0.55]) | 0.30 |
| clv | 0.15 |
| timing | 0.10 |
| book | 0.10 |
| volatility | 0.10 (**hardcoded 0.5 neutral placeholder**, modulated externally per tier) |
| archetype | 0.05 |
| ladder height | 0.05 (penalty for line ≥ 3.5; FB inherently 0.50) |
| diversification | 0.05 |

Plus `tierBoost` (+0.05 / +0.025 / −0.05 / −0.30). Plus `offensiveAttackTextureBonus(leg, timingMap)` capped at 0.07: offensive over with edge>3.5% → +0.016 (halved from 0.032 in Realism-Ecology-1A); aggressive/lotto with edge>4% → +0.022; steam/immediate → +0.014.

**The slip-leg formula does NOT include BC-2, OE-2/3/4/8, or PCE.** The slip path is decoupled from the curation-layer ecology + conviction signals. Slip composition relies on `edge × probFactor`, CLV, timing, book quality, exposure, and tier — plus the offensive-attack texture bonus.

### B.3 — Per-prop scorer (upstream entry; raw edge dominance)

`scoreMlbProp` is the entry-point quality signal that informs tier/confidence assignment:

```
score = edge × 3 + signal × 1.5 + (predP − impP) × 2
post-adjust: −0.5 if odds < −200; −0.5 if signal is null
confidence: HIGH if score>2; MED if score>1; else LOW
```

Edge dominates raw scoring at 3× weight. The favorite penalty (−0.5 for odds < −200) actively suppresses recognizable heavy favorites.

### B.4 — Dominant terms (ranked by composite influence)

1. **`f.edge`** at 0.25 weight is the dominant single lens. At edge=25%, the lens saturates at 1.0 → contributes 0.25 to composite. At edge=5%, contributes 0.0275.
2. **`f.clv` (0.12) + `f.archetype` (0.10)** at total 0.22 weight, but **both default to 0.55 NEUTRAL** — effectively inert without persistent ROI/CLV history. In cold-start or thin-family contexts they neither distinguish candidates nor allow recognizable bettor ecosystems to be promoted from history.
3. **`f.volRealism`** at 0.10 weight is the only lens explicitly favoring safe over volatile. Safe over lotto swing: (0.80 − 0.65) × 0.10 = **+0.015** composite advantage. Bounded; small.
4. **`f.market` (0.10) + `f.timing` (0.10) + `f.book` (0.08)** at total 0.28 weight are bettor-realizable quality lenses (market consensus, urgency, book quality). They favor what the bettor can actually access cleanly.
5. **`f.legitimacy` (0.07) + `f.pressure` (0.05) + `f.pceFactor` (0.05)** at total 0.17 weight are the env/ecology/conviction lenses. They DO favor environmentally-supported plays — but they apply only to hitter overs in OE/PCE and pitcher/under legs bypass entirely.

**Sum of strict-lens weight = 1.02.** Each lens individually capped to its weight band.

### B.5 — Additive payout asymmetry (the structural offensive-over bias)

The **additives are where the optimization breaks symmetry**. They are applied OUTSIDE the weighted mean and explicitly favor a particular candidate shape:

- **`textureBoost +0.030` for aggressive/lotto offensive overs with edge>4.5%.** This is a deliberate Realism-Ecology-1A injection. Its purpose, per the comment: "high-edge aggressive/lotto legs keep oxygen in curated pools — does NOT inject overs; only lifts proven volatile edges."
- **OE-3 +0.03 (HR carry) + OE-4 +0.03 (run prod) + OE-13 +0.02 (bullpen fragility) + PCE +0.05 (earned upside).** Combined cap ~+0.13 for hitter overs in favorable env at top-of-order. Pitcher unders / under bets / hitter unders all get NONE of this stack.
- **BC-4 −0.05 + OE-8 −0.04 demotes** apply only to hostile-env hitters / low-survivability ladders. Combined max −0.09. Pitcher unders bypass BC-4 and OE-8.
- **The `−0.5` favorite penalty in scoreMlbProp** (odds < −200) is an additional structural suppression of recognizable heavy favorites at the per-prop scoring layer (upstream of the composite).

**Net asymmetry:** a hitter over in favorable env (top-of-order, HR_FRIENDLY, high impliedTeamTotal, OE-13 bullpen gate) can earn up to **+0.13 above the weighted mean**. The mirror image (heavy-favorite recognizable play in standard env) gets nothing from this stack and may incur the `−0.5` per-prop penalty if odds < −200.

### B.6 — Missing terms (what the objective does NOT optimize for)

1. **Bettor recognition / familiarity.** No lens scores "is this a player a recreational bettor would know without research." Operator-cemented prohibition on celebrity weighting (per `DEFERRED_PHASES.md`) — but the *absence* is also why recognizable ecosystems aren't promoted by name; they're only promoted by ecology signals that often miss obvious stars in unfavorable env.
2. **Payout believability.** A 25% edge at −120 odds gets the same edge-lens contribution as a 25% edge at +800. The edge lens saturates without distinguishing payout price. No "would the bettor actually take this bet" term exists.
3. **Bettor-recognizable env surfacing.** Env signals are CONSUMED by BC-2/OE-2/3/4/8/PCE but do NOT emit a canonical FE Discover sort key. The BNDS-1C "survivability lens" was the planned env-as-sort-key surface; still deferred. The ConvictionNote helper (P1A-T3/T1) is the closest bettor-visible env signal but renders only when canonical FeaturedPlay overlap exists.
4. **Sustainable-curation budget.** No cap on % of curated output that is longshot/exotic vs household-name. The diversifying picker enforces player/game/stat caps, not "shape of payout distribution" caps.
5. **Cross-tier completability.** Specifically: high-edge offensive overs (textureBoost beneficiaries) are structurally pushed to AGGRESSIVE/LOTTO volatility. SAFE tier forbids both aggressive and lotto volatility (Session AN). The `isPremiumEdgeForSafe` override (edge≥0.12 AND modelProb≥0.50) is the only narrow window for high-edge offensive overs to enter SAFE; MLB BALANCED is under-only and rejects them entirely.
6. **Calibration-honest single-leg scoring.** Family calibration coefficients (FAMILY_CALIBRATION_COEFFICIENTS, default 0.85; rbis/outs excluded from slips entirely) apply only to slip JOINT probability in `combineLegs`. The single-leg composite `scoreCandidate` does NOT downweight per-family modelProb. Families known to be over-calibrated still produce high-composite plays that surface in Discover and elite.
7. **Reachability gate.** No lens penalizes plays only available at a single book or at deep-priced shops. The `f.market` lens rewards multi-book consensus but doesn't lower-bound the floor.
8. **Personalized history.** Archetype ROI is GLOBAL across the ledger, not personal to the bettor. No term favors stat families the bettor has historically interacted with.

### B.7 — Survivability influence

Survivability is expressed in TWO places, both as soft demotes outside the weighted mean:

- **OE-8 ladderSurvivabilityFactor** = `ladderHeightFactor × paFactor × runEnvFactor × hrCarryFactor`. When this product falls below 0.40, a −0.04 soft demote applies at sort time inside `buildBestLadders`. Capped magnitude.
- **BC-4 believableUpsideDemote** = −0.05 for `hrEnvironmentTag = HR_SUPPRESSING` OR `impliedTeamTotal < 3.5`. Combined with itself bounded at −0.10.

**Survivability never enters the FE Discover sort.** It is suppress-only at curated-output time. The Discover pool sees candidates ranked by the raw composite (lenses + additives) with survivability's effect visible only after curation.

### B.8 — Environmental weighting

Environmental signals (`runEnvironment`, `rbiEnvironment`, `impliedTeamTotal`, `gameTotal`, `hrEnvironmentTag`, `carryShift`, `hrFactor`, `temperatureF`, `lineupSpot`, `plateAppearancesProxy`, `windDirectionTag`, `depth`) flow into:

- BC-2 lens (depth × impliedTeamTotal ramp): 0.07 weight
- OE-2 lens (runEnv × teamTotal × carryShift): 0.05 weight
- OE-3 additive (wind + carry + HR-friendly + temp): ≤+0.03
- OE-4 additive (lineupSpot 1-4 + runEnv ≥ 0.55): ≤+0.03
- OE-8 demote (ladder survivability): ≤−0.04
- OE-13 additive (bullpen fragility): ≤+0.02
- PCE lens + additive (lineupSpot + PA + stat-side coherence): 0.05 weight, ≤+0.05 / ≥−0.04
- BC-4 demote (HR_SUPPRESSING / dead totals): ≤−0.05

**Combined environmental swing on a hitter-over candidate is approximately ±0.20 composite** (the sum of the boosts/demotes above). This is significant but applies almost entirely to hitter overs; pitcher props and under bets are environmentally INERT in the current objective.

### B.9 — Curation-selection priorities (FE pool assembly)

`workstationRoutes.js` builds TWO pools from the SAME canonical-validated `supplementedCandidates`:

- **Elite (`state.candidates`):** maxPerPlayer:3 / maxPerGame:7-12 / maxPerStat:10 / maxPerStatSide:6. Highest-composite plays diversified across players/games/stats.
- **Discovery (`state.discoveryCandidates`):** maxPerPlayer:8 / maxPerGame:60 / maxPerStat:60 / maxPerStatSide:35. Same composite scoring; just looser thresholds.

Both pools use identical scoring + ordering — the difference is threshold magnitude, not selection priority. **Whatever the composite ranks highest dominates BOTH pools.**

### B.10 — Points where optimization collapses toward raw edge magnitude

1. **`scoreMlbProp.score`**: dominant term `edge × 3` at the per-prop layer.
2. **`scoreCandidate.f.edge` at 0.25 weight**: 25% of the composite is `edge × 4 × probFactor` clamped to [0, 1]. probFactor is neutralized to [0.50, 0.55] band.
3. **`scoreLeg.projection` at 0.30 weight**: same shape (`edge × 5 × probFactor`) but heavier weight in the slip-leg composite.
4. **`modelConfig.filters.minEdge: −0.02`**: the pool entry point accepts NEGATIVE edge. The downstream optimization is responsible for filtering. There is no hard edge-quality floor.
5. **`modelConfig.filters.minModelProb: 0.10`**: 10% modelProb accepted. Very permissive.

### B.11 — Where bettor-realizable edge is absent

1. **No payout-believability term.** A 25% edge at +800 odds and a 25% edge at −120 odds are scored identically on the edge lens.
2. **No "reasonable single-leg" preference.** SAFE tier exists at the slip layer, but its constraints (modelProb≥0.55 AND maxOdds≤+150 AND forbid=lotto+aggressive) actively REJECT the candidates the composite ranks highest (high-edge offensive overs with aggressive volatility). The composite optimizes for one shape; SAFE rejects that shape.
3. **No personalized history weighting.** Archetype ROI is global. A bettor whose ledger history is rich on standard hits-overs / runs-overs cannot bias curation toward those.
4. **No "is this play in 2+ books at reachable prices" floor.** Multi-book bonus exists (`f.market` 0.10 weight) but no minimum-book reachability gate.
5. **No bettor-recognition lens.** Operator-forbidden by celebrity-weighting prohibition. The absence is acknowledged.

---

## STAGE B — EMPIRICAL EXPLANATIONS OF THE 5 PHENOMENA

The reconstructed objective function above explains the operator-observed phenomena empirically and mechanically.

### Phenomenon 1: "Obscure longshot ecosystems dominate curation"

**Mechanism (composite-level):**
- `probFactor` is clamped to the [0.50, 0.55] band. A +110 favorite with modelProb=0.65 receives the same probFactor (0.55) as a +500 longshot with modelProb=0.22 (after clamp). The probability advantage of recognizable plays is neutralized.
- `f.edge` saturates at edge=25%. Recognizable favorites with edge 4-8% contribute 0.022–0.044 to the edge lens; longshots with edge 12-25% contribute 0.066–0.138. The edge lens already favors higher-edge candidates, which skew longshot.
- `textureBoost +0.030` is applied to aggressive/lotto **offensive overs** with edge>4.5%. Recognizable favorites in BALANCED volatility get nothing here.
- `OE-3 +0.03 + OE-4 +0.03 + OE-13 +0.02 + PCE +0.05` stack to **+0.13** for a hitter over with lineup + park + bullpen gates passing. Obscure but ecologically-supported offensive overs at the top of a friendly lineup score this full additive cascade.
- `BC-4 −0.05 + OE-8 −0.04` further suppress recognizable favorites in hostile env / low-survivability ladders.
- The `−0.5` scoreMlbProp penalty for `odds < −200` suppresses recognizable heavy favorites at the upstream per-prop layer (before composite even runs).

**Result:** the composite **structurally rewards exactly the obscure-longshot-in-favorable-env profile** the operator describes. Recognizable favorites and heavy-favorite plays receive no comparable additive stack and are demoted at multiple layers.

### Phenomenon 2: "SAFE slips collapse"

**Mechanism (slip-tier-level):**
- SAFE TIER_TEMPLATE: `minModelProb 0.55, maxOdds 150, decimalOddsRange [1.8, 4.0], allowedVolatility [safe, balanced], forbidVolatility [lotto], maxPerGame 1, maxPerStat 2`. NBA SAFE adds `forbidVolatility [lotto, aggressive]` per Session AN.
- The composite scoring system actively **promotes high-edge offensive overs into AGGRESSIVE/LOTTO volatility classifications** (via textureBoost + OE additive stack).
- These high-quality plays then **cannot enter SAFE** — they are filtered out by `forbidVolatility` AND by `minModelProb 0.55` (probFactor clamp means few high-edge plays naturally surface with modelProb > 0.55).
- The `isPremiumEdgeForSafe` override is narrow (edge ≥ 0.12 AND modelProb ≥ 0.50) — most curated plays don't reach this threshold.
- MLB BALANCED is `allowedSides: ["under"]` — overflow over-side high-quality plays cannot fall through to BALANCED either.
- The two-leg same-game suppression-pair gate (`MLB-COV-2 shared_game_suppression_exposure`) further blocks same-game hitter-UNDER pairs — narrowing what SAFE can compose.

**Result:** SAFE tier draws from a pool stripped of the high-edge offensive overs (promoted to aggressive/lotto) AND the same-game suppression pairs (blocked by MLB-COV-2). What remains is thin: low-edge favorite-side plays + pitcher unders + the narrow `isPremiumEdgeForSafe` window. The audit's prior-recorded "MLB BALANCED 2.7% historical hit rate" suggests SAFE's even-tighter shape collapses on most slates because the pool of compatible legs is too small.

### Phenomenon 3: "Recognizable bettor ecosystems under-surface"

**Mechanism (asymmetric additive stack):**
- The composite has no term for bettor recognition.
- Recognizable stars in **unfavorable env** (low impliedTeamTotal, HR_SUPPRESSING park, mid/deep lineup spot) receive BC-2/OE-2/3/4/PCE NEUTRAL fallbacks AND may incur the BC-4 −0.05 demote (if HR_SUPPRESSING or teamTotal < 3.5) AND the OE-8 −0.04 demote (if ladderSurvivabilityFactor < 0.40).
- Obscure players in **favorable env** (top-of-order, HR_FRIENDLY, high impliedTeamTotal, lineupSpot 1-4, plateAppearancesProxy ≥ 4.2) receive the full +0.05 PCE additive + +0.03 OE-3 + +0.03 OE-4 + +0.02 OE-13.
- Net swing: **+0.22 composite** in favor of the obscure-but-favorable-env play.
- The diversifying picker (`maxPerPlayer` caps) further redistributes top-composite picks across players; recognizable stars who would naturally stack multiple props receive no stacking allowance.
- `f.archetype` and `f.clv` defaults of 0.55 NEUTRAL mean cold-start / new-family contexts neutralize the only history-based lens that could promote recognizable ecosystems via persistent ROI.

**Result:** recognizable bettor ecosystems are not actively suppressed by name — but they receive the asymmetric additive stack only when also satisfying the env gates. When they don't, the obscure-but-env-favorable competitor outranks them by up to 0.22 composite.

### Phenomenon 4: "Environmental lenses feel weak/empty"

**Mechanism (env-not-surfaced):**
- Env signals (`runEnvironment`, `rbiEnvironment`, `impliedTeamTotal`, `hrEnvironmentTag`, `carryShift`, `hrFactor`, `temperatureF`, `lineupSpot`, `plateAppearancesProxy`, `windDirectionTag`) are consumed by the composite (BC-2/OE-2/3/4/8/PCE) but **NOT exposed as a canonical FE Discover sort key.**
- OE-8 `ladderSurvivabilityFactor` exists but is currently a sort-time DEMOTE on ladders only, not a Discover sort key. **BNDS-1C "survivability lens" was the planned FE surface — still deferred per `/DEFERRED_PHASES.md`.**
- The `ConvictionNote` helper (P1A-T3 extraction + T1 propagation) is the only bettor-visible env-derived signal. It renders only when canonical FeaturedPlay overlap exists AND only for hitter-overs that pass PCE gates. Pitcher props, under bets, and battlefield rows without overlap render NO env signal.
- The `attackNote` / `processNote` / `reasoning` text fields surface some env context inside the curated card body — but those are component-specific (FeaturedCard / RecommendationLadder), not a sortable lens across Discover.

**Result:** env signals do operate inside the composite, but their bettor-visible expression is currently limited to ~1 surface (ConvictionNote on FeaturedCard + Discover overlap rows). On the broader battlefield, env "feels empty" because env data simply doesn't render. The lens is doing work; it's just not bettor-visible at the surface where the operator scans for it.

### Phenomenon 5: "Mathematically exotic props overpower believable bettor ecosystems"

**Mechanism (saturation + tie-break asymmetry):**
- `f.edge` saturates at edge=25%. Two plays — a +1100 longshot at 25% edge and a recognizable +200 play at 25% edge — produce IDENTICAL `f.edge` contributions.
- The other lenses then break ties. Among tie-breakers, `textureBoost`, OE-3/4/13 additives, and PCE additive all favor offensive-over candidates in favorable env. Mathematically exotic props (first basket, total bases on a hot bat, runs+RBIs+walks combos) often satisfy these conditions.
- `modelConfig.filters.minEdge: −0.02` admits negative-edge plays. The pool entry point is permissive.
- `FAMILY_CALIBRATION_COEFFICIENTS` (slip-side only) downweights some families to 0.85 default — but this applies to slip JOINT probability, not to single-leg composite or Discover surfacing. **A family whose modelProb is structurally over-confident still produces high-composite single-leg plays.**
- Believable bettor ecosystems (recognizable star's standard hits-over, runs-over, etc.) often present modelProb 0.50–0.55 with edge 3-8%. Their `f.edge` contribution: 0.022–0.044. Without env-additive support, their composite trails high-edge exotic plays that hit the +0.030 textureBoost AND the +0.08 OE-additive stack AND the +0.05 PCE additive.

**Result:** the optimization treats `edge × probFactor` + env-fit as the dominant signal. Exotic props that score well on env-fit can outrank believable plays that score lower on env-fit, even when the bettor would clearly prefer the latter. There is no countervailing lens for "is this a play a bettor would actually take."

---

## STAGE B — SUMMARY: WHAT THE STACK IS ACTUALLY OPTIMIZING FOR

In one sentence:

> **The intelligence stack is currently optimizing for high-edge offensive-over candidates whose lineup-and-environment ecology gates pass — with `edge × probFactor` capped + neutralized to prevent under-side probability dominance, and an asymmetric ~+0.13-magnitude additive stack (textureBoost + OE-3/4/13 + PCE) that rewards exactly the obscure-longshot-in-favorable-env profile.**

In more nuance:

1. **Edge magnitude is the primary signal**, but capped (saturation at 25%) and probability-neutralized (probFactor clamp [0.50, 0.55]). The neutralization prevents under-side probability compression from dominating but also prevents recognizable favorites' probability advantage from compounding.
2. **Volatility, archetype ROI, CLV history, market consensus, timing, book quality** are quality-of-execution lenses summing to ~0.50 of the composite. They favor multi-book consensus + good timing + reputable book + stable archetype.
3. **Env + ecology lenses** (BC-2 / OE-2 / PCE) sum to 0.17 of the composite, biasing toward hitter-overs in favorable env. Pitcher props and unders are environmentally inert in this 0.17.
4. **Additive boosts** (textureBoost + OE-3/4/13 + PCE additive) layer **outside** the weighted mean and can compound up to **+0.13** for the right offensive-over profile.
5. **Soft demotes** (BC-4 −0.05 + OE-8 −0.04) apply at curated-output time only, suppressing hostile-env hitters / low-survivability ladders by up to −0.09.
6. **The slip layer is decoupled** from the curation-layer ecology: scoreLeg uses a different formula (Σ weight = 1.00, no BC-2/OE/PCE), and tier templates (SAFE/BALANCED/AGGRESSIVE/LOTTO) impose constraint shapes that **systematically exclude the composite's highest-ranked offensive overs from SAFE** (forbidden volatility) and from MLB BALANCED (under-only).
7. **No bettor-recognition lens exists.** Recognizable ecosystems are promoted only via env gates; when env doesn't favor them, they fall below obscure-but-env-favorable competitors.
8. **No env-as-FE-sort-key surface exists.** Env signals influence the composite but the bettor cannot scan a battlefield surface ranked by env strength. The conviction render (ConvictionNote on FeaturedCard + Discover overlap rows) is the only bettor-visible env-derived signal.

The five phenomena the operator named are **structurally consistent** with this objective:

- **Obscure longshot dominance:** asymmetric +0.13 additive stack rewards the obscure-favorable-env profile; favorite-side recognizable plays get nothing.
- **SAFE collapse:** composite promotes high-edge offensive overs into AGGRESSIVE/LOTTO volatility; SAFE tier forbids those; SAFE's pool is structurally depleted.
- **Recognizable under-surface:** no bettor-recognition lens; recognizable stars in unfavorable env score 0.22 composite below obscure stars in favorable env.
- **Weak env lenses:** env signals influence the composite but render in only ~1 bettor-visible FE surface (ConvictionNote on overlap rows); the env "lens" the bettor expects to scan doesn't exist as a Discover sort key (BNDS-1C still deferred).
- **Exotic > believable:** edge saturation + asymmetric additive stack + no payout-believability lens lets exotic env-favorable plays outrank believable bettor plays that lack env-additive support.

---

## OBSERVATIONAL NOTES (NOT FIXES)

This audit is observational. The five phenomena above are NOT framed as bugs — they are framed as **emergent properties of the current objective function.** They are consistent with what the stack is optimizing for. Whether what the stack is currently optimizing for matches what the operator WANTS it to optimize for is a separate question — one that requires explicit operator + MCR judgment, not a CA-1 patch.

Specifically out of scope for CA-1 (per operator's cemented bounds):
- No premature calibration fixes.
- No compensating weights.
- No "just boost star players" shortcuts.
- No battlefield sterilization.
- No curated-surface hacks.

What CA-1 has produced:
- An exhaustive inventory of the intelligence-stack files and constants (Stage A).
- A reconstructed objective function reading every load-bearing weight, lens, additive, and demote from the artifacts (Stage B).
- Empirical, mechanical explanations of each named phenomenon, traced back to specific files and lines.

What CA-1 has explicitly NOT produced:
- Any patch.
- Any reconciliation proposal.
- Any new term, weight adjustment, or doctrine addition.
- Any reclassification of the existing terms as "wrong."

---

## HANDOFF

**Next routing options (MCR decision; CA-1 does not propose):**

1. **CA-2 — operator-truth reconciliation.** Compare the reconstructed objective function (this doc) against the operator's stated intent for the curation product (per `/PRODUCT_IDENTITY.md` and the five named phenomena above). Identify the load-bearing mismatches without proposing fixes; reserve fix design for a subsequent phase under explicit operator + MCR approval.
2. **CA-3 — bettor-validation-driven gap analysis.** Run the post-slice BETTOR VALIDATION workflow against current curated output specifically scoped to surface GAP/CONCERN findings against the five named phenomena. The ledger entries become canonical empirical data for any future fix design.
3. **Hold.** Carry the audit into operator + MCR review without immediate next action; let the reconstructed objective sit as a reference doc for future phase scoping.

INFRA / GOVERNANCE makes no recommendation among these three. CA-1's purpose is observational truth; selecting the next phase is MCR's truth-disposition.

— end of CA-1 audit —

---

## STAGE C — OPERATOR-AUTHORITATIVE TRANSITION FRAMEWORK + CA-3a/b/c PLANNING (2026-05-18)

**Stage scope:** observational planning addendum. The operator confirmed 2026-05-18 the architectural shift from `score maximization` to `bettor-realizable opportunity qualification`. This Stage C captures the operator-authoritative transition framework, plans CA-3a (reconciliation) / CA-3b (function-shape) / CA-3c (implementation inventory), and aligns R3 ecology-authority work to the new doctrine. **Zero implementation. Zero patches. Zero commitments.** Observational planning only.

**Codified canonical surfaces (in-place evolution, 2026-05-18):**
- `/PRODUCT_IDENTITY.md` § Opportunity-qualification architecture — full doctrinal frame, eight-dimension structure, explainability requirement, what the shift does and does NOT mean.
- `/backend/runtime/brain/ARCHITECTURE_LAWS.md` Law 22 (opportunity qualification before edge maximization), Law 23 (hard-gate-then-tune architecture), Law 24 (output explainability in dimension terms). ARCHITECTURE_LAWS extended 21 → 24 laws in place.
- `/docs/OPERATOR_RUNBOOK.md` § OPPORTUNITY QUALIFICATION DOCTRINE — operational consequences, planning-lane definitions, R3 alignment, lane ownership.

### C.1 — The eight-dimension architecture (operator-authoritative)

The architecture is structured around eight co-equal dimensions. They are co-equal in legitimacy; they differ in sequencing priority.

**Six canonical explainability dimensions** (operator-stated, foreground for curation output explainability):

| # | Dimension | Role in architecture | Existing infrastructure substrate |
|---|---|---|---|
| 1 | **Role ownership** | Structural-dependency layer (gate). Does this player own this opportunity? | `lineupSpot`, `plateAppearancesProxy`, `depth`, `archetype`, NBA `usage` / `nbaRoleContextDeriver` |
| 2 | **Game-flow activation** | Structural-dependency layer (gate). Does tonight's game state activate this opportunity? | `runEnvironment`, `rbiEnvironment`, `impliedTeamTotal`, `gameTotal`, `gameContextWeight`, `nbaGameContextWeight` |
| 3 | **Ecosystem legitimacy** | Coherence (likely gate-and-tuner). Is supporting ecology coherent with the opportunity? | BC-2 `playerLegitimacyFactor`, OE-2 `offensivePressureIndex`, OE-3/4 boosts, MLB-COV-1/2/3 correlation gates |
| 4 | **Survivability** | Coherence (gate-and-tuner). Does the opportunity survive realistic in-game friction? | OE-8 `ladderSurvivabilityFactor`, OE-12 `lineupTurnoverPotential`, OE-13 `bullpenFragilityContext`, `nbaVolatilityResolver` |
| 5 | **Bettor-trust** | Cross-cutting gate. Is every signal traceable to canonical authority? | Anti-fabrication doctrine; `bettorLanguage.js` (deterministic phrase library); Laws 6 / 16 / 19; `verifyOrphanAuthorityHardening.js` |
| 6 | **Market psychology** | Tuner (likely; CA-3b confirms). Is the line shape consistent with the opportunity? | `marketSupportFor`, `consensusConfidence`, `marketDispersion`, line-movement signals, EXPL-1 / EXPL-4 |

**Two additional dimensions** — operator-authoritative, pending explicit enumeration at the codification-confirmation pass. Likely candidates (informational, NOT prescriptive — operator confirms):
- **Statistical edge / mathematical asymmetry** (the previously-dominant signal; in the new architecture, a tuner — `f.edge`, `scoreLeg.projection`, `scoreMlbProp.score`).
- **Payout realizability / bettor-realizable believability** (was MISSING in the as-found objective per CA-1 Stage B; the operator-authoritative new dimension that closes the bettor-realizable-edge gap).

### C.2 — Sequencing principles (codified into Law 22 + Law 23)

1. **Opportunity qualification before edge maximization.** Edge is a tuner among qualified opportunities, not the entry-gate. (Law 22.)
2. **Role + game-flow are structural dependency layers; sequenced first.** Candidates that fail role/game-flow do not enter the qualified set, regardless of mathematical edge. (Law 22.)
3. **Hard-gate-then-tune.** Gates fire first and are binary (admit/reject); tuners modulate ordering among the qualified set. (Law 23.)
4. **Co-equal legitimacy.** No dimension is permitted to dominate the others' admission rights. Sequencing priority is about WHEN dimensions fire; co-equality is about WHETHER they can override each other. (Law 23.)
5. **Output explainability.** Curated outputs explain in dimension terms, not score terms. (Law 24.)

### C.3 — CA-3a: reconciliation planning

**Purpose:** map the as-found objective (Stage B) onto the opportunity-qualification frame. Identify load-bearing mismatches; quantify magnitudes; surface conflicts. No fixes proposed.

**Reconciliation map (per-dimension overlay vs as-found mechanism):**

| Dimension | As-found mechanism | Reconciliation classification |
|---|---|---|
| Role ownership | Distributed across `lineupSpot` / `plateAppearancesProxy` / `depth` ingestion + PCE-1A (`PCE_LINEUP_SPOT_CONVICTION` + `pcePaConviction`) + BC-2 (depth × teamTotal). No gate; appears as a tuner contribution capped at `PCE_WEIGHT 0.05 + PCE_ADDITIVE +0.05` lens-side influence. | **MISMATCH (tuner-where-gate-required).** Role ownership currently modulates score among a pool that is admitted via edge magnitude; it does not gate admission. Magnitude: a candidate failing all role-ownership predicates (`lineupSpot 9 + low PA + back-of-order depth`) can still surface if edge is high enough — PCE's max penalty (−0.04) cannot zero out a strong edge. |
| Game-flow activation | OE-2 `offensivePressureIndex` (runEnv × teamTotal × carryShift) at 0.05 lens weight + OE-3 +0.03 + OE-4 +0.03 additives. No gate; tuner-only. | **MISMATCH (tuner-where-gate-required).** Game-flow currently boosts qualified flow candidates by up to +0.11 composite but does not exclude candidates whose game-flow is inactive. A pitcher-favoring game (low impliedTeamTotal, defensive matchup) can still surface high-edge hitter overs that the game flow does not actually activate. |
| Ecosystem legitimacy | BC-2 lens 0.07 + OE-2 lens 0.05 + soft demotes BC-4 −0.05 + OE-8 −0.04. Partial gating via `BC-4 hostile env` demote, but demote is bounded and never excludes. | **PARTIAL MATCH (gate-and-tuner hybrid).** Closest existing infrastructure to a gate. MLB-COV-1/2/3 correlation gates ARE binary admit/reject (admit-with-penalty / reject-with-`shared_game_suppression_exposure`). These are the precedent pattern for hard gates. |
| Survivability | OE-8 `ladderSurvivabilityFactor` sort-time demote (−0.04) on ladders only. Does NOT enter Discover or single-leg sort. | **MISMATCH (locality-bound).** Survivability is currently scoped to ladder construction; not applied as a single-leg gate or Discover sort. R3 ecology-authority sweep reframes OE-8 against this dimension. |
| Bettor-trust | Cross-cutting; expressed through anti-fabrication doctrine + canonical-authority discipline + Law 6 / 16 / 19. Operates as a meta-gate at the doctrine level, not at scoring time. | **MATCH (meta-gate, doctrine-enforced).** Bettor-trust is already operating as a meta-gate; the doctrine surface prevents fabricated signals from entering the composite at all. The new architecture inherits this intact. |
| Market psychology | `f.market` lens 0.10 weight + `f.timing` 0.10 + `f.book` 0.08. EXPL-1 / EXPL-4 hard gates on stale-line / hard-drop availability. | **PARTIAL MATCH (tuner-with-hard-gate-precedent).** EXPL-1 / EXPL-4 are the existing hard-gate precedent for market dimension; the tuner contribution is layered. |
| Statistical edge (tuner) | `f.edge` 0.25 weight lens (`edge × 4 × probFactor`, probFactor clamped [0.50, 0.55]). Capped at saturation. | **OVERSCOPED (currently entry-gate-by-default).** Edge magnitude is currently the dominant single-lens contributor. The new architecture demotes edge to a tuner among qualified opportunities — the largest single architectural shift. |
| Payout realizability (tuner) | **ABSENT.** No lens, no additive, no gate. A 25% edge at +800 is scored identically to a 25% edge at −120 on the edge lens. | **GAP (dimension absent from as-found objective).** The new architecture adds payout realizability as a co-equal tuner. CA-1 Stage B Section B.6 documented this absence; the new architecture closes the gap as the canonical eighth dimension (subject to operator-authoritative confirmation). |

**Magnitude estimates:**
- Role ownership + game-flow currently contribute ~0.12 composite influence (lens + additive). In the new architecture they would be entry gates — admit/reject binary, no fractional contribution. The 0.12 fractional contribution is reabsorbed; the gate is qualitative.
- Edge magnitude (`f.edge` 0.25 weight) becomes a tuner; its contribution shape is preserved but its admission role is removed.
- Payout realizability is a NEW tuner; its weight is operator-authoritative and unknown today.
- Soft demotes BC-4 / OE-8 may become gates or remain tuners depending on CA-3b shape choice.

**Conflicts surfaced (no fixes proposed):**
1. The current composite would re-rank disqualified candidates back into the qualified set if any tuner-class dimension is permitted to override gate disqualification. Law 23's "co-equality with sequencing priority" doctrine must be enforced at the gate-evaluation step.
2. The `isPremiumEdgeForSafe` override in `buildSlipAi.js` (edge ≥ 0.12 AND modelProb ≥ 0.50) is a tuner-overrides-gate pattern at the slip-tier layer. Under Law 23, this override is itself a gate redefinition, not a tuner — but its current implementation is edge-based, which conflicts with role/game-flow precedence. CA-3b function-shape evaluation surfaces whether the SAFE-tier admission is restructured around qualifying gates or remains tier-template based.
3. BALANCED MLB's `allowedSides: ["under"]` constraint is a side-based gate. Under the new architecture, the gate would express in dimension terms (e.g., "game-flow activates over-side"; "ecosystem-legitimacy coherent with over"), not in raw side-side terms. The constraint may be restructured or absorbed into the dimension gates.

### C.4 — CA-3b: function-shape evaluation

**Purpose:** evaluate candidate shapes for the qualified-then-tuned objective. Multiple shapes considered; trade-offs surfaced; **no shape committed to**. Operator + MCR confirm shape choice at a subsequent codification-confirmation pass.

**Candidate function shapes** (observational; not exhaustive; not prescriptive):

**Shape α — Cascade gates, then weighted-mean tuners.**
- Stage 1: sequential gate evaluation. Role gate → game-flow gate → ecosystem-legitimacy gate → survivability gate → bettor-trust meta-gate → market-psychology gate. Each gate is binary; failure rejects the candidate.
- Stage 2: among the qualified set, score via a tuner weighted-mean over statistical edge + payout realizability + (optionally) tuner-side contributions from gates that are gate-and-tuner.
- Strengths: minimal architectural change to existing tuner machinery (the current composite becomes the tuner; gates are added in front). Preserves the score sort surface.
- Weaknesses: cascade ordering matters; if any gate is too strict the qualified set collapses (SAFE-tier collapse problem at a system-wide level).

**Shape β — Parallel gate evaluation with majority-pass, then weighted-mean tuners.**
- Stage 1: all gates evaluate in parallel; admission requires N-of-M passes (operator chooses N).
- Stage 2: tuner-side weighted-mean among admitted.
- Strengths: less brittle to any single gate being too strict; tolerates one dimension's signal being absent.
- Weaknesses: less explainable ("which gates fired"); harder to surface a clean dimension narrative; can re-admit candidates that fail role/game-flow if other gates compensate (potentially violates Law 22's sequencing principle).

**Shape γ — Hard gates for role + game-flow + bettor-trust; gate-and-tuner for ecosystem-legitimacy + survivability + market-psychology; pure tuners for edge + payout-realizability.**
- Stage 1: structural-dependency gates (role + game-flow + bettor-trust) evaluated as hard binary admit/reject.
- Stage 2: ecology / survivability / market dimensions evaluated as gate-and-tuner (binary admission predicate AND continuous ordering contribution).
- Stage 3: pure tuners (edge + payout realizability) modulate final ordering.
- Strengths: explicit sequencing matches Law 22's "role + game-flow first" rule; closest to the explainability target shape (each dimension carries a named contribution in the explanation).
- Weaknesses: more architectural change required; more verifier surface needed; gate-and-tuner pattern needs its own canonical structure.

**Shape δ — Multi-tier admission ladder.**
- Replace the current SAFE / BALANCED / AGGRESSIVE / LOTTO tier templates with a single ladder where the tier is determined by which dimensions a candidate qualifies on.
- A candidate that passes all six explainability gates becomes "elite-qualified." Passing 4-5 → "balanced-qualified." Passing 2-3 → "aggressive-qualified." Passing role + bettor-trust only → "lotto-qualified."
- Strengths: collapses the tier templates into a single dimension-driven structure; explainable by which gates the candidate fired.
- Weaknesses: largest behavioral shift; deepest architectural change; deepest risk surface for unintended ecosystem effects.

**Trade-off table (observational):**

| Shape | Architectural change | Explainability | Risk to existing curation | Existing-substrate reuse |
|---|---|---|---|---|
| α | Small | Medium | Low | High |
| β | Small | Low | Low | High |
| γ | Medium | High | Medium | High |
| δ | Large | Very High | High | Medium |

**No shape selected.** Selection is operator + MCR truth-disposition at a subsequent confirmation pass.

### C.5 — CA-3c: implementation inventory planning

**Purpose:** enumerate the per-file impact of each CA-3b candidate shape. **Observational; no commitment to any shape; no implementation in this pass.**

**Shape γ implementation inventory** (illustrative — the shape closest to the explicit doctrinal target):

| File | Current role | Hypothetical change kind under Shape γ | Invariants preserved |
|---|---|---|---|
| `backend/pipeline/shared/buildFeaturedPlays.js scoreCandidate` | 10-lens weighted-mean composite | Add hard-gate pre-check (role / game-flow / bettor-trust) BEFORE composite scoring; composite scores ONLY among qualified set | Additive: gates added in front; composite untouched. |
| `backend/pipeline/shared/playerConvictionEngine.js` | Tuner-only conviction signal | Add gate predicate exposing role-ownership qualification boolean; preserve tuner additive | Additive: new export, existing additive preserved. |
| (NEW) `backend/pipeline/shared/roleOwnershipQualifier.js` | (does not exist) | New pure helper exposing the role-ownership gate predicate over canonical signals | Six-element canonical-helper-doctrine header; deterministic; no LLM; no fabrication. |
| (NEW) `backend/pipeline/shared/gameFlowActivator.js` | (does not exist) | New pure helper exposing the game-flow gate predicate | Same doctrine pattern. |
| `backend/pipeline/shared/buildSlipAi.js scoreLeg` | 8-lens weighted-mean | Add same gate-pre-check; same shape as scoreCandidate evolution | Additive. |
| `backend/pipeline/shared/buildSlipAi.js TIER_TEMPLATES` | Per-tier constraint templates | Restructure SAFE / BALANCED admission around dimension-gate qualification (Shape δ extension) or preserve as-is with gate-pre-check in front (Shape γ) | Conservative: preserve templates; add gate-pre-check upstream. |
| `frontend/src/workstation/components/ConvictionNote.tsx` | Canonical conviction-render helper (PCE-1A) | Pattern precedent for new dimension renderers; no change to ConvictionNote itself | Laws 19 / 20 / 21 preserved. |
| (NEW) `frontend/src/workstation/components/RoleOwnership.tsx` | (does not exist) | New canonical dimension-render helper for role ownership | Six-element canonical-helper-doctrine header. |
| (NEW) `frontend/src/workstation/components/GameFlowActivation.tsx` | (does not exist) | New canonical dimension-render helper for game-flow activation | Same doctrine. |
| (NEW) `frontend/src/workstation/components/SurvivabilityIndicator.tsx` | (does not exist; previously scoped for OE-8 propagation under Law 20) | New canonical dimension-render helper for survivability | Same doctrine. |
| (NEW) `frontend/src/workstation/components/MarketPsychology.tsx` | (does not exist) | New canonical dimension-render helper for market psychology | Same doctrine. |
| `frontend/src/workstation/canonicalOverlap.ts` | Single canonical overlap helper (P1A-T1) | Extend `FeaturedOverlapEntry` interface (per Law 21 Invariant 3) with dimension-gate flags and per-dimension qualifier signal | Additive interface extension; Law 21 narrow-interface doctrine preserved. |
| `backend/pipeline/shared/bettorLanguage.js` | Deterministic phrase library | Extend with per-dimension phrase libraries (`ROLE_*`, `FLOW_*`, `ECOSYSTEM_*`, `SURVIVABILITY_*`, `MARKET_*`) | Additive; deterministic; no LLM. |
| R4 verifier scope | 12 candidate verifiers | Add verifiers enforcing Laws 22 / 23 / 24: `verifyOpportunityQualificationOrdering`, `verifyHardGateThenTune`, `verifyDimensionExplainability` | Additive; brings R4 scope to 15 candidates. |

**Non-target files (informational — these stay intact regardless of shape):**
- `backend/config/modelConfig.js` (entry filters preserved).
- `backend/pipeline/mlb/scoreMlbProp.js` (per-prop scoring preserved as upstream).
- `backend/pipeline/mlb/buildMlbCorrelationEngine.js` (correlation engine canonical, already used as MLB-COV gate precedent).
- `backend/pipeline/nba/nbaCorrelationEngine.js` (NBA correlation canonical).
- ML scorer files (off-line; no online change).
- Brain checkpoint mechanics (preserved).

### C.6 — R3 ecology-authority alignment

R3 was previously framed as a doctrine-surface reconciliation for ecology (OE-8 + OE-11 / 12 / 13 / 14 / 15 cross-surface authority). Under the new architecture, R3's deliverable shape now includes:

| R3 sub-finding | New dimension alignment |
|---|---|
| OE-8 `ladderSurvivabilityFactor` (ladder-locality sort-time demote) | **Survivability dimension.** R3 reconciles whether OE-8 is reframed as a survivability gate predicate (or gate-and-tuner) instead of a ladder-locality demote. The canonical signal is preserved; the application scope changes. |
| OE-11 stack-reinforcement pair-boost | **Ecosystem legitimacy + game-flow activation.** Pair-correlation is an ecology-coherence signal. |
| OE-12 lineup-turnover-potential | **Game-flow activation.** Lineup turnover is a game-flow predicate. |
| OE-13 bullpen-fragility | **Survivability + game-flow.** Bullpen fragility predicts late-game opportunity activation. |
| OE-14 under-flip structural drop | **Ecosystem legitimacy** (deferred; awaits R3 + opportunity-qualification design). |
| OE-15 best-overs symmetry | **Ecosystem legitimacy** (deferred; awaits R3 + opportunity-qualification design). |
| BC-2 `playerLegitimacyFactor` | **Role ownership + ecosystem legitimacy.** Depth × teamTotal is a role-supported flow signal. |
| BC-4 `believableUpsideDemote` | **Ecosystem legitimacy** (the current soft demote is a partial gate; under Shape γ it becomes a hard gate predicate over the same canonical signals). |
| MLB-COV-1 / 2 / 3 correlation gates | **Ecosystem legitimacy** (the existing hard-gate precedent — admit/reject binary over canonical correlation signals). The new architecture inherits this gate pattern. |
| PCE-1A | **Role ownership + ecosystem legitimacy.** PCE_LINEUP_SPOT_CONVICTION + plateAppearancesProxy floor + stat-side coherence are role-supported predicates. PCE additive currently functions as a tuner; under Shape γ the predicates may also feed the role gate. |

**R3 still ships NO implementation.** R3 is an observational substrate audit. Its deliverable becomes: per-OE-module dimension mapping table + authority-boundary check against canonical-overlap-helper architecture (Laws 18 / 20 / 21) + substrate-readiness assessment for the eventual hard-gate-then-tune implementation.

### C.7 — What CA-3a/b/c does NOT do

Re-emphasized (operator-cemented bounds):

- **No premature calibration fixes.** CA-3a/b/c surfaces the as-found / target gap; does not adjust calibration coefficients.
- **No compensating weights.** No tuner-side workaround for what should be a gate.
- **No "boost star players" shortcuts.** Role ownership is structural (depth, lineupSpot, usage), not celebrity.
- **No battlefield sterilization.** Battlefield breadth (Layer 1 Discover) remains operator-cemented.
- **No curated-surface hacks.** No hard-coded "tonight's pick" path.
- **No implementation commitment.** CA-3b function-shape evaluation enumerates options; selection is MCR truth-disposition at a subsequent confirmation pass.
- **No new canonical doc.** All Stage C content lives in this CA-1 audit's Stage C addendum.

### C.8 — Closure handoff to MCR

**Codification status: COMPLETE (in-place across PRODUCT_IDENTITY + ARCHITECTURE_LAWS + OPERATOR_RUNBOOK + this CA-1 audit's Stage C).**

**Planning status: COMPLETE (CA-3a / CA-3b / CA-3c observational planning + R3 ecology-authority alignment).**

**Open items for MCR truth-disposition:**

1. **Explicit enumeration of the eighth + ninth dimension** (operator-authoritative). The six explainability dimensions are codified; the seventh and eighth are pending operator confirmation. Likely candidates per Stage C.1: statistical edge (already in as-found) and payout realizability (the gap closed by the new architecture).
2. **Selection of CA-3b function-shape** (α / β / γ / δ or operator-specified). Selection is MCR truth-disposition.
3. **Sequencing of R3 ecology-authority sweep** with respect to the dimension-mapping deliverable. R3 may now run alongside or before CA-3b shape selection — MCR sequences.
4. **Authorization decision for any subsequent implementation phase.** CA-3a/b/c surfaces options; implementation requires explicit operator + MCR approval at each step.

**Recommended next routing (no MCR pre-selection):**
- For dimension enumeration + shape selection: **MASTER CONTROL ROOM** (truth-disposition).
- For R3 ecology-authority sweep under the dimension-mapping deliverable: **FULL SYSTEM AUDIT** in reconciliatory mode.
- For any implementation phase (when authorized): **ACTIVE EXECUTION** under explicit scope lock.
- For future doctrine-codification confirmation passes: **INFRA / GOVERNANCE**.

— end of Stage C addendum (operator-authoritative transition + CA-3a/b/c planning + R3 alignment) —

---

## STAGE C CONTINUATION — SHAPE γ FINALIZATION + CA-3a/c DEPTH + CA-3d PREPARATION + R4 PLANNING (2026-05-18)

**Stage scope:** continuation of Stage C after MCR truth-disposition confirmed Shape γ as the canonical function-shape. This section finalizes Shape γ-specific reconciliation depth, the implementation inventory, and prepares CA-3d (reconciliation queue construction) + R4 verifier-extension scope. **Zero implementation. Zero patches. Zero commitments to specific changes. Observational planning + canonicalization only.**

**Newly codified canonical surfaces (in-place evolution, 2026-05-18 Phase 1B):**
- `/PRODUCT_IDENTITY.md` § Opportunity-qualification architecture — Shape γ confirmation block + battlefield/curated as bettor operating modes block.
- `/backend/runtime/brain/ARCHITECTURE_LAWS.md` Laws 25–30 — Shape γ canonical structure; volatility ≠ fragility; class-not-identity; sport-agnostic taxonomy; prop-family-aware thresholds; four-dimensional explanation schema.
- `/docs/OPERATOR_RUNBOOK.md` § SHAPE γ CANONICAL FUNCTION-SHAPE + DOCTRINE FINALIZATION — operator-confirmed 12-doctrine list, future implementation discipline, forbidden patterns, next operator focus.

### C.9 — CA-3a continuation: per-dimension reconciliation depth

CA-3a Stage C.3 surfaced the dimension-by-dimension reconciliation map. Under Shape γ canonicalization, each dimension now has a defined gate-class assignment (hard gate / gate-and-tuner / pure tuner) and its reconciliation depth can be sharpened.

| Dimension | Shape γ class | As-found mechanism | Reconciliation depth (observational) |
|---|---|---|---|
| **Role ownership** | Hard gate (sequenced first) | Distributed across PCE-1A `PCE_LINEUP_SPOT_CONVICTION` + `pcePaConviction` + BC-2 (depth × teamTotal). Tuner-only, capped ~0.10 composite influence. | New canonical `roleOwnershipGate(c, sport)` helper required. MLB: predicate over `lineupSpot ∈ {1..6}` AND `plateAppearancesProxy ≥ 3.5` AND `depth ∈ {top, middle}`. NBA: predicate over `usage ≥ threshold` AND `playerStatus ∈ {active, probable}` (TBD CA-3c). |
| **Game-flow activation** | Hard gate (sequenced first) | OE-2 `offensivePressureIndex` (0.05 lens) + OE-3/OE-4 additives (+0.06 stack). Tuner-only. | New canonical `gameFlowActivationGate(c, sport)` helper required. MLB: predicate over `runEnvironment ≥ family-threshold` AND `impliedTeamTotal ≥ family-threshold` AND favorable park/weather tag (per Law 29 family-aware). NBA: predicate over `nbaGameContextWeight` AND `pace ≥ family-threshold`. |
| **Bettor-trust** | Hard gate (meta) | Cross-cutting; expressed at doctrine layer via anti-fabrication + canonical-authority + Laws 6 / 16 / 19. Already operates as meta-gate. | NO new helper required. The existing doctrine-layer enforcement IS the gate. CA-3c records this as "preserved as-is." |
| **Market-integrity** | Hard pre-gate (Law 25) | EXPL-1 (consensus-support gate) + EXPL-4 (hard-drop availability gate) — already binary admit/reject. | EXISTING precedent fits cleanly. Market-integrity pre-gate inherits EXPL-1 + EXPL-4 + extension: cross-book stale-line consistency, dispersion floor, no-single-book admission rule. CA-3c documents per-rule predicate. |
| **Ecosystem legitimacy** | Gate-and-tuner | BC-2 lens 0.07 + OE-2 lens 0.05 + BC-4 −0.05 demote + MLB-COV-1/2/3 hard gates. Mixed: tuner contribution + hard correlation gates. | Gate-side: extend MLB-COV gates pattern to general ecosystem-coherence checks (e.g., hostile-env hard reject when fragility floor breached, currently soft-demote). Tuner-side: existing BC-2 + OE-2 lens contributions preserved as tuners. |
| **Survivability** | Gate-and-tuner | OE-8 `ladderSurvivabilityFactor` sort-time demote (ladder-locality). Currently locality-bound. | Gate-side: extend OE-8 predicate to single-leg + Discover scope (Law 28 — sport-aware; Law 29 — family-aware thresholds). Tuner-side: continuous-ordering contribution among the survivability-qualified set. Volatility ≠ fragility (Law 26) — keep volatility-class tuner distinct. |
| **Market psychology** | Gate-and-tuner | `f.market` lens 0.10 + `f.timing` 0.10 + `f.book` 0.08. Tuner-side only. | Gate-side: minimum-book reachability floor (e.g., ≥2 books at reachable prices); rejects single-book deep-priced anomalies. Tuner-side: existing lens contributions preserved. Market-integrity pre-gate (above) fires before market-psychology gate-and-tuner — separation enforced. |
| **Statistical edge** | Pure tuner | `f.edge` 0.25 weight (`edge × 4 × probFactor`, capped + neutralized). Currently dominant single-lens contributor — Law 22 demotes it to tuner. | Behavior preserved as a tuner; lens contribution preserved. The shift is that edge no longer admits — it orders among the gate-qualified set. |
| **Payout realizability** | Pure tuner (NEW) | **ABSENT** in as-found objective (Stage B § B.6 gap). | NEW canonical predicate. Likely shape: bettor-reachable price floor + payout-ratio sanity vs single-leg probability. CA-3c enumerates candidate predicates; operator-authoritative final shape. |

**Magnitude reconciliation (observational):**
- The current 10-lens weighted-mean composite (Σ = 1.02) remains intact as the tuner-side mechanism for the qualified set; weights are preserved as-is in this codification pass.
- Gates apply BEFORE composite scoring. The composite no longer determines admission; it determines ordering.
- The asymmetric +0.13 additive stack (textureBoost + OE-3/4/13 + PCE) remains tuner-side. Under Shape γ it loses its de-facto admission role (since admission is now gate-driven) but retains its ordering contribution among the qualified set. CA-3d will queue the question of whether tuner-side asymmetry should be re-balanced — but this is operator + MCR decision, NOT a CA-3c implementation step.
- Soft demotes (BC-4 −0.05 + OE-8 −0.04) get re-roled: BC-4 may become an ecosystem-legitimacy gate predicate; OE-8 may become a survivability gate predicate (per Laws 28 + 29 sport-and-family-aware threshold structure). The current sort-time demote behavior is preserved during the transition; gate-promotion is a sequenced subsequent step.

### C.10 — CA-3c continuation: Shape γ canonical implementation inventory

CA-3c Stage C.5 sketched an illustrative Shape γ inventory. Under Shape γ canonicalization, the inventory becomes the canonical per-file impact map. **Still observational; no implementation commitment.**

#### C.10.A — New canonical helpers (NEW files; gate predicates)

| Path | Dimension | Sport | Carries |
|---|---|---|---|
| `backend/pipeline/shared/roleOwnershipGate.js` | Role ownership | sport-aware dispatcher | Six-element canonical-helper-doctrine header; `roleOwnershipGate(c, sport): { admit: boolean, predicate: string, signals: {...} }` |
| `backend/pipeline/mlb/mlbRoleOwnershipGate.js` | Role ownership | MLB | Predicate over `lineupSpot` / `plateAppearancesProxy` / `depth`; family-aware thresholds per Law 29 |
| `backend/pipeline/nba/nbaRoleOwnershipGate.js` | Role ownership | NBA | Predicate over `usage` / `playerStatus` / `nbaRoleContextDeriver`; family-aware thresholds per Law 29 |
| `backend/pipeline/shared/gameFlowActivationGate.js` | Game-flow activation | sport-aware dispatcher | Same shape as roleOwnershipGate |
| `backend/pipeline/mlb/mlbGameFlowGate.js` | Game-flow activation | MLB | Predicate over `runEnvironment` / `impliedTeamTotal` / park / weather / carryShift / bullpen |
| `backend/pipeline/nba/nbaGameFlowGate.js` | Game-flow activation | NBA | Predicate over `nbaGameContextWeight` / `pace` / pace-correlation signals |
| `backend/pipeline/shared/marketIntegrityGate.js` | Market-integrity pre-gate | sport-invariant | Extension of EXPL-1 + EXPL-4 + minimum-book reachability + dispersion floor + stale-line consistency. NO sport-specific dispatcher — market integrity is sport-invariant. |
| `backend/pipeline/shared/ecosystemLegitimacyGate.js` | Ecosystem legitimacy | sport-aware dispatcher | Gate-and-tuner; gate predicate calls existing MLB-COV-1/2/3 + extension; tuner contribution surfaces BC-2 + OE-2 |
| `backend/pipeline/shared/survivabilityGate.js` | Survivability | sport-aware dispatcher + family-aware thresholds | Gate-and-tuner; predicate extends OE-8 pattern to single-leg + Discover scope; family floors per Law 29 |
| `backend/pipeline/shared/marketPsychologyGate.js` | Market psychology | sport-invariant | Gate-and-tuner; gate-side minimum-book reachability + dispersion floor; tuner-side preserves `f.market` / `f.timing` / `f.book` |
| `backend/pipeline/shared/payoutRealizabilityTuner.js` | Payout realizability | sport-invariant | Pure tuner; canonical predicate over bettor-reachable price + payout-ratio sanity (CA-3d enumerates final shape under operator confirmation) |

#### C.10.B — Existing files re-roled under Shape γ (observational)

| Path | Current role | Under Shape γ |
|---|---|---|
| `backend/pipeline/shared/buildFeaturedPlays.js scoreCandidate` | 10-lens weighted-mean composite | TUNER among gate-qualified set. The scoreCandidate function continues to exist; its outputs feed the diversification picker; what changes is that candidates entering scoreCandidate have ALREADY passed gates. |
| `backend/pipeline/shared/playerConvictionEngine.js` | Conviction tuner additive | Re-roled: predicate-exposing helper for the role-ownership gate (`pceMeetsRoleGate(c)`) AND tuner-side contribution preserved. PCE-1A canonical preserved; gate predicate added. |
| `backend/pipeline/shared/buildSlipAi.js scoreLeg` | 8-lens weighted-mean leg score | TUNER among gate-qualified legs. Same pattern: gates pre-filter; scoreLeg orders among the qualified set. |
| `backend/pipeline/shared/buildSlipAi.js TIER_TEMPLATES` | Per-tier admission constraints | Preserved as-is in this codification pass. CA-3d queues the question of whether tier templates re-structure around dimension-gate-qualification under Shape δ-extension or remain as orthogonal volatility-class constraints. **No change in this codification pass.** |
| `backend/pipeline/shared/buildSlipAi.js canAddLeg + MLB-COV-1/2/3` | Slip-time hard-correlation gates | Re-roled: the existing MLB-COV hard-gate pattern is the canonical precedent the new dimension gates inherit. No change to MLB-COV behavior. |
| `backend/pipeline/mlb/buildMlbCorrelationEngine.js` | MLB correlation engine | Preserved. New ecosystem-legitimacy gate consumes its canonical predicates. |
| `backend/pipeline/nba/nbaCorrelationEngine.js` | NBA correlation engine | Preserved. Same pattern. |
| `backend/pipeline/filters/fragile.js` | NBA fragility filter | Re-roled: fragility predicate becomes part of NBA survivability gate. The existing avgMin / minFloor / minStd / valueStd / trendRisk predicates become the canonical NBA-survivability-gate inputs (Law 26 — fragility ≠ volatility; Law 28 — sport-specific implementation). |
| `backend/routes/workstationRoutes.js` | `/api/ws/state` payload assembly + elite/discovery pool diversification | Re-roled: pool assembly applies Shape γ gate pipeline. Battlefield = looser gate selectivity (Law 23 selective-gating); Curated = tight gate selectivity. Same canonical-source pool; different gate thresholds per operating mode. |
| `backend/pipeline/shared/bettorLanguage.js` | Deterministic phrase library | Extended with per-dimension phrase libraries (`ROLE_PHRASES`, `FLOW_PHRASES`, `ECOSYSTEM_PHRASES`, `SURVIVABILITY_PHRASES`, `MARKET_PHRASES`, `EDGE_PHRASES`, `PAYOUT_PHRASES`) per Law 30 four-question schema. The `bettorTrust` phrase set is implicit (the act of citing canonical authority IS the bettor-trust evidence). |

#### C.10.C — New FE canonical dimension renderers (NEW files; under canonical-helper-doctrine pattern)

| Path | Dimension | Pattern |
|---|---|---|
| `frontend/src/workstation/components/RoleOwnership.tsx` | Role ownership | Six-element canonical-helper-doctrine header; consumes overlap-entry role-ownership fields; renders deterministic phrase from ROLE_PHRASES |
| `frontend/src/workstation/components/GameFlowActivation.tsx` | Game-flow activation | Same |
| `frontend/src/workstation/components/EcosystemLegitimacy.tsx` | Ecosystem legitimacy | Same |
| `frontend/src/workstation/components/SurvivabilityIndicator.tsx` | Survivability | Same (precedent inherited from `ConvictionNote.tsx` P1A-T3 + the survivability-helper scope from Law 20 future curated-layer propagation doctrine) |
| `frontend/src/workstation/components/MarketPsychology.tsx` | Market psychology | Same |
| `frontend/src/workstation/components/PayoutRealizability.tsx` | Payout realizability | Same |
| `frontend/src/workstation/canonicalOverlap.ts` | Single canonical overlap helper (Laws 20 + 21) | Extended `FeaturedOverlapEntry` interface with per-dimension predicate flags and per-dimension phrase signal-tags (additive extension; Law 21 narrow-interface doctrine preserved) |

#### C.10.D — Verifier scope expansion (R4)

R4 candidate verifiers now total 18 (12 prior + 3 Shape γ + 3 from this canonicalization pass):

| # | Verifier | Enforces | Phase that surfaced it |
|---|---|---|---|
| 13 | `verifyOpportunityQualificationOrdering.js` | Gates evaluated BEFORE tuners; Law 22 sequencing principle | Phase 1A |
| 14 | `verifyHardGateThenTune.js` | Gate predicates are binary (no fractional admission); Law 23 | Phase 1A |
| 15 | `verifyDimensionExplainability.js` | Each curated candidate carries `explanation: { who, when, survives, marketEdge }` provenance; Law 24 + Law 30 | Phase 1A |
| 16 | `verifyShapeGammaStructure.js` | Hard-gate / gate-and-tuner / pure-tuner classification per Law 25; selective-gating configuration is operator-cemented | Phase 1B |
| 17 | `verifyVolatilityFragilityDistinction.js` | Volatility-class predicates and survivability predicates do not share canonical signals; Law 26 | Phase 1B |
| 18 | `verifyClassNotIdentity.js` | No per-player override hooks in any pipeline module; no celebrity / popularity weighting; Law 27 | Phase 1B |
| 19 | `verifySportAgnosticTaxonomy.js` | Each dimension carries sport-aware dispatchers; no top-level sport-specific dimensions; Law 28 | Phase 1B |
| 20 | `verifyPropFamilyAwareThresholds.js` | Per-family thresholds live as named canonicals in gate-predicate modules; no universal-threshold drift; Law 29 | Phase 1B |
| 21 | `verifyFourQuestionSchema.js` | Curated candidate explanations answer all four canonical questions (Who · When · How does it survive · Where is the market wrong); Law 30 | Phase 1B |

Plus prior R4 candidates from R1 (`verifyShadowCanonicalDrift` · `verifyPhaseDocCoherence` · `verifyForbiddenListConsistency` · `verifyOrphanBrainLayer` · `verifyProbeMatrixCanonicalization` · `verifyCanonicalHelperDoctrine` · `verifyTypeWideningDiscipline` · `verifyLayerTypeSeparation` · `verifyOverlapHelperCanonicality` · `verifyNoFeOverlapReDerivation` · `verifyOverlapIdParity` · `verifyFeaturedBucketRegistration`).

**Total R4 verifier scope: 21 candidates.** Authoring belongs to a scheduled INFRA / GOVERNANCE phase; not blocking codification.

### C.11 — CA-3d preparation: reconciliation queue construction

**Purpose:** define the structure, governance, and entry template for the reconciliation queue. The queue is the actionable list of work items needed to transition the as-found objective toward Shape γ. **Preparation only — no queue items filled in this pass.** Items are populated under explicit operator + MCR direction at subsequent passes.

#### C.11.A — Queue placement

**Canonical placement: extend `docs/CURATION_AUDIT_2026-05-18.md` Stage C.12 with the reconciliation queue itself.** NO new doc forked. The audit doc remains the single canonical home for the CA series.

Rationale: the queue is a derivative of CA-3a (reconciliation map) + CA-3c (implementation inventory). It is not a new canonical authority — it is the actionable expression of canonicals that already exist (Laws 22–30 + PRODUCT_IDENTITY § Opportunity-qualification + the doctrine sections in OPERATOR_RUNBOOK).

#### C.11.B — Queue governance

- **Append-only.** Items are appended; never deleted. Completed items remain in the queue with status flipped (recorded with completion lineage).
- **Operator + MCR authorize each item entry.** Items are not autonomously added by INFRA; entries require explicit operator + MCR direction. INFRA / GOVERNANCE drafts; MCR approves; ACTIVE EXECUTION implements (when authorized).
- **One item, one dimension target.** Items address one named dimension primarily; cross-dimension items split into multiple queue entries.
- **Dependency-tracked.** Items declare `dependsOn` queue IDs explicitly; cycles forbidden.
- **Bettor-validation triggered.** Every item declares its bettor-validation surface (which FE surface to validate after the item ships).
- **Sport scope + prop-family scope declared.** Items state their sport coverage (MLB / NBA / both / future) and prop-family scope (specific families or all).
- **Risk-class declared.** Items state risk-class (low / medium / high) based on canonical-authority disruption, replay-safety surface, and bettor-trust exposure.
- **Lineage cross-referenced.** Items cite the law(s) they realize, the CA-3a finding(s) they address, and the CA-3c inventory entries they touch.

#### C.11.C — Queue entry template

```
### Item NNNN — <short title> — <YYYY-MM-DD> — <draft / pending-mcr / approved / in-flight / completed>

- **Dimension target:** <named dimension>
- **Sport scope:** <MLB | NBA | both | future>
- **Prop-family scope:** <specific families | all>
- **Risk class:** <low | medium | high>
- **Lineage:**
  - Realizes: <Law N(s)>
  - Addresses: <CA-3a finding(s)>
  - Touches: <CA-3c inventory entries / file paths>
- **Depends on:** <queue IDs; "none" if independent>
- **Change kind:** <gate insertion | predicate extension | family-threshold codification | dimension renderer | tuner re-roling | verifier authoring | etc.>
- **Specifically does NOT:** <named forbidden patterns explicitly excluded — no hidden weighting patches / no mystery-score regressions / no celebrity inflation / no battlefield sterilization / no calibration drift>
- **Bettor-validation trigger:** <FE surface(s) to validate after; expected dimension fingerprint(s) in the ledger entry>
- **Invariants preserved:** <named invariants from Laws 1-30 the item must not violate>
- **Implementation lane:** <INFRA / GOVERNANCE codification | ACTIVE EXECUTION implementation | FRONTEND / UX LAB rendering | FULL SYSTEM AUDIT substrate audit>
- **MCR sign-off recorded:** <YYYY-MM-DD by reviewer, or "pending">

#### Drafted scope (operator + MCR confirm)

<one-paragraph description of what the item does>

#### Explicit non-scope

<one-paragraph description of what the item does NOT do>
```

#### C.11.D — Sample-shape queue items (illustrative; NOT entered into the queue)

The following ARE NOT items in the queue. They are sample-shape illustrations of what valid items would look like. The actual queue is populated under operator + MCR direction.

**Illustrative sample 1** (illustrative; not an entry):
```
Item 0001 — Codify mlbRoleOwnershipGate predicate — draft
- Dimension: Role ownership
- Sport: MLB
- Prop-family: hitter overs (initial); pitcher props (subsequent item)
- Risk: medium
- Realizes Law 22 + 25 + 28
- Depends on: none
- Change kind: gate insertion (new helper)
- Does NOT: change scoreCandidate; reweight composite; touch ConvictionNote; alter PCE-1A behavior
- Validation trigger: Discover + RecommendationLadder under MLB slate
- Invariants: additive-only · canonical authority · anti-fabrication · Law 27 class-not-identity
- Lane: ACTIVE EXECUTION (when authorized)
```

**Illustrative sample 2** (illustrative; not an entry):
```
Item 0002 — Codify per-family survivability floor constants — draft
- Dimension: Survivability
- Sport: both
- Prop-family: per-family (HR / Hits / RBIs / Ks / Points / Rebounds / Assists / Threes)
- Risk: low
- Realizes Law 29
- Depends on: 0001 (and the parallel game-flow item) — survivability gate operates on output of upstream gates
- Change kind: family-threshold codification (named constants alongside survivabilityGate)
- Does NOT: change OE-8 sort-time demote behavior on ladders; touch ladder construction
- Validation trigger: Discover + ladder surfaces
- Invariants: additive-only · Law 26 volatility ≠ fragility
- Lane: ACTIVE EXECUTION (when authorized)
```

These two illustrations clarify the queue ITEM SHAPE; they are not entered into the actual queue. The queue itself opens when operator + MCR authorize CA-3d item population.

#### C.11.E — Queue close criterion

The reconciliation queue closes when:
1. All items are completed (status = completed) OR explicitly closed (e.g., absorbed into a different item).
2. The bettor-validation ledger (`docs/BETTOR_VALIDATION_LEDGER.md`) records empirical findings against the live-slate output of the Shape γ pipeline that the operator + MCR accept as sufficient.
3. The five operator-named phenomena from CA-1 Stage B (obscure longshot dominance / SAFE collapse / recognizable under-surface / weak environmental lenses / exotic > believable) each receive a closure disposition: either VALIDATED (the new architecture resolves the phenomenon) or NEUTRAL (the phenomenon is reframed as intended doctrine behavior under Shape γ).
4. MCR truth-disposition declares the reconciliation queue closed.

Queue closure does not retire the Shape γ doctrine — Laws 22–30 remain canonical. Closure marks the end of the active reconciliation phase. Subsequent doctrine evolution operates under the additive-only canonical-authority pattern; new items in subsequent transitions open a new queue.

### C.12 — Reconciliation queue (open; first entry doctrine-pilot)

Queue opened 2026-05-18 under explicit operator + MCR direction (post-first-wave-reconciliation-prioritization review). First entry below serves as the canonical doctrine-pilot — subsequent entries inherit its structural metadata pattern; deviations require explicit MCR justification.

Queue governance applies per Stage C.11.B (append-only · operator + MCR authorize each item · one dimension target per item · dependency-tracked · sport/prop-family-scoped · risk-classed · lineage-cross-referenced · bettor-validation triggered).

#### Item 0001 — Survivability reinterpretation alignment — 2026-05-18 — DRAFT (doctrine-pilot)

**Doctrine-pilot designation:** YES. This is the canonical first queue entry. Subsequent CA-3d entries inherit this entry's structural pattern: metadata foregrounded, drafted scope + explicit non-scope explicitly stated, 7-axis bettor-validation closure criteria fully enumerated, ACTIVE EXECUTION authorization packet attached. Variation from this pattern in subsequent entries requires explicit MCR sign-off.

##### Canonical metadata

- **Dimension target:** Survivability (gate-and-tuner under Law 25)
- **Sport scope:** sport-agnostic taxonomy first; MLB-first sport-specific gate implementation; NBA implementation queued for subsequent item
- **Prop-family scope:** all prop families (per-family thresholds per Law 29)
- **Risk class:** medium (canonical-authority extension; new gate added; existing demotes preserved; no composite reweighting)
- **Lineage:**
  - **Realizes laws:** 25 (Shape γ gate-and-tuner classification of survivability) · 26 (volatility ≠ fragility — foundational contradiction this item resolves) · 28 (sport-agnostic taxonomy with sport-specific gate implementations) · 29 (prop-family-aware gate thresholds) · 30 (four-question explanation schema — populates "How does it survive?" question)
  - **Addresses CA-3a findings:** Survivability dimension reconciliation row (Stage C.9) — survivability currently locality-bound to OE-8 ladder sort-time demote (−0.04); not evaluated at single-leg or Discover scope; conflated with volatility via `f.volRealism` lens (safe 0.80 / balanced 0.74 / aggressive 0.66 / lotto 0.65 — texture/risk class assigned survivability semantics it does not carry). This is the operator-identified foundational contradiction.
  - **Touches CA-3c inventory entries:** new `backend/pipeline/shared/survivabilityGate.js` (sport-aware dispatcher helper) · new `backend/pipeline/mlb/mlbSurvivabilityGate.js` (MLB sport-specific gate predicate) · `backend/pipeline/shared/bettorLanguage.js` (extend with `SURVIVABILITY_PHRASES` library) · new `frontend/src/workstation/components/SurvivabilityIndicator.tsx` (canonical dimension renderer) · `frontend/src/workstation/canonicalOverlap.ts` (narrow-interface extension per Law 21 Invariant 3 — add `survivabilityFlag` + `survivabilityReasonTag` to `FeaturedOverlapEntry`) · `backend/pipeline/filters/fragile.js` (NBA fragility predicate re-roling — subsequent item; not in Item 0001 scope)
- **Depends on:** none (first reconciliation slice; no upstream dependencies)
- **Blocks (subsequent items that depend on this one):** NBA survivability gate implementation · per-prop-family threshold tuning items · any item requiring survivability dimension to fire at single-leg or Discover scope
- **Change kind:** gate insertion (new canonical helper at workstation scope) + dimension renderer (new FE canonical helper following P1A-T3 ConvictionNote precedent) + narrow-interface extension on canonicalOverlap (per Law 21) + phrase library extension on bettorLanguage
- **Implementation lane:** ACTIVE EXECUTION (when MCR authorizes via the authorization packet below)
- **MCR sign-off recorded:** pending — operator + MCR review of this doctrine-pilot entry

##### Drafted scope (operator + MCR confirm)

Item 0001 introduces the canonical Survivability gate as a structurally distinct dimension from volatility. The drafted work shape:

1. **Sport-agnostic survivability taxonomy** — codified as a deterministic predicate over canonical signals that distinguishes **structurally-robust volatility** from **structurally-fragile volatility**. A rare-but-structurally-robust opportunity (e.g., a +700 HR over from a top-of-order hitter in an HR_FRIENDLY park with a fragile-bullpen setup, top-of-lineup turnover risk minimal, in a windy carry-supportive game) is structurally robust — it admits. A structurally-fragile-volatility opportunity (e.g., the same +700 HR price but from spot 8-9 in a dead-environment game with a 3.2 implied team total) gates out.
2. **MLB sport-specific gate predicate** — predicate over canonical signals already lifted by `deriveMlbLineupContext` / `deriveMlbBullpenContext` / `deriveMlbParkContext` / `deriveMlbWeatherContext` / `pcePaConviction` (existing PCE substrate). MLB predicate inputs: `lineupSpot`, `plateAppearancesProxy`, `depth`, `impliedTeamTotal`, `gameTotal`, `runEnvironment`, `hrEnvironmentTag`, `carryShift`, `temperatureF`, bullpen fragility context. Per-prop-family thresholds (Law 29): HR over has different gate floor than Hits over; Total Bases differs from RBIs; etc. Initial thresholds are operator-approved canonicals living alongside the gate predicate module.
3. **Canonical helper structure** — six-element canonical-helper-doctrine header (phase lineage · extraction phase · forbidden list · absence policy · anti-fabrication clause · indexed-access type binding). The `survivabilityGate(c, sport)` returns `{ admit: boolean, predicate: string, signals: { ... }, reasonTag: string, phrase: string }`. Phrase is read from `SURVIVABILITY_PHRASES` in `bettorLanguage.js` (deterministic; no LLM).
4. **Gate-and-tuner duality (per Law 25)** — the gate output is binary (admit/reject for the survivability gate predicate); the tuner output is the existing OE-8 sort-time demote behavior, preserved verbatim. A candidate that PASSES the gate but has a low survivability factor still gets the OE-8 −0.04 demote at ladder sort time (additive-only doctrine: existing demote behavior preserved; gate is a new evaluation layer on top).
5. **Battlefield-visible disqualification** — when a candidate fails the survivability gate, it remains on the canonical-validated battlefield pool (Discover, `state.discoveryCandidates`) but is rendered with an explicit `SurvivabilityIndicator` showing the disqualification reason ("Fragile late-inning role · bullpen suppresses HR opportunity"). The bettor sees the disqualification, not its absence. This is the **anti-sterilization guard in action**: battlefield breadth preserved; the gate's effect is bettor-visible.
6. **Curated promotion** — within the qualified set, the existing composite continues to order. Survivability-passing candidates are ordered by the existing 10-lens weighted-mean (untouched). Survivability-failing candidates do NOT enter the curated set (`state.candidates` / `state.featured`); the gate fires before composite scoring orders the curated pool.
7. **canonicalOverlap.ts interface extension** — under Law 21 Invariant 3 (narrow-interface, extension is the canonical evolution path), `FeaturedOverlapEntry` is extended with `survivabilityFlag?: "passes" | "fails"` and `survivabilityReasonTag?: string`. The extension is additive, type-bound, and surfaces to the FE renderers without permitting off-interface reads.
8. **SurvivabilityIndicator.tsx** — new canonical FE dimension renderer following ConvictionNote.tsx pattern (P1A-T3). Helper-owned absence policy (Law 19). Renders ONLY when `survivabilityFlag` is present on the overlap entry. Deterministic phrase from `SURVIVABILITY_PHRASES`. Color authority maps `passes` → positive · `fails` → warn-color · absent → no render (honest absence per Law 19 + Law 30).
9. **Four-question explanation contribution (Law 30)** — Item 0001 populates the "How does it survive?" question of the four-question schema. The other three questions (Who · When · Where is the market wrong) remain populated by their existing precedents (PCE-1A `ConvictionNote` covers role-supported "Who"; existing reasoning/processNote covers transitional "When"; existing market/CLV lenses cover transitional "Where is the market wrong"). Subsequent CA-3d items will codify dedicated dimension renderers for the other three questions.

##### Explicit non-scope (operator-cemented)

Item 0001 specifically does **NOT**:

- **Change PCE-1A behavior or any PCE_* constant.** PCE_LINEUP_SPOT_CONVICTION, pcePaConviction, pceModelTrust, pceStatSideCoherence, PCE_WEIGHT, PCE_MAX_BOOST, PCE_MAX_PENALTY all preserved verbatim. PCE-1A behavior preserved through this item.
- **Change OE-8 `ladderSurvivabilityFactor` ladder-locality demote.** OE-8's −0.04 sort-time demote on ladders continues to fire as today; the new survivability gate is an additive evaluation layer at single-leg + Discover scope, NOT a replacement of OE-8.
- **Change `f.edge` lens or any composite weight in `scoreCandidate` / `scoreLeg`.** First-wave mathematical-edge weighting protection (operator-cemented) — composite weights untouched.
- **Change BC-2 / OE-2 / OE-3 / OE-4 / OE-11 / OE-12 / OE-13 / PCE magnitudes or thresholds.** Existing ecology stack preserved.
- **Touch TIER_TEMPLATES (safe / balanced / aggressive / lotto) or applyNbaTierOverrides.** Tier-template restructuring is a subsequent CA-3d item (and possibly a Shape δ-extension question); not Item 0001.
- **Change `buildMlbCorrelationEngine` / `nbaCorrelationEngine` / MLB-COV-1 / 2 / 3.** Correlation engines preserved canonical.
- **Touch the diversifying picker (`diversifyCandidates` / `buildCandidateDiversity`).** Diversification machinery preserved.
- **Inject identity hooks** (Law 27 enforced; no per-player overrides; no celebrity weighting; no popularity bias).
- **Add LLM-synthesized phrases.** All `SURVIVABILITY_PHRASES` are deterministic, operator-approved phrase library entries.
- **Sterilize the battlefield.** Battlefield breadth preserved verbatim; survivability-failed candidates remain on `state.discoveryCandidates` with explicit `SurvivabilityIndicator` disqualification. Anti-sterilization guard upheld.
- **"Make longshots weaker."** This is the operator's foreground emphasis. The survivability gate does NOT penalize longshots by price. A +900 HR over from a top-of-order hitter in HR_FRIENDLY park with bullpen meltdown setup admits cleanly. A +900 HR over from spot-9 in dead env gates — not because it is a longshot, but because it is **structurally fragile**. The distinction is the entire point of Item 0001.
- **Change the as-found composite formula.** The composite continues to function; gates apply BEFORE composite orders the qualified set, per Law 22 + Law 25.
- **Reweight or re-balance any existing additive boost or demote** (textureBoost, OE-additives, BC-4, tierBoost). All preserved verbatim.

##### Bettor-validation closure criteria (per 7 measurement axes)

The 7 operator-emphasized axes (recognizable ecosystem emergence · SAFE viability emergence · curated compression magnitude · battlefield breadth preservation · prop-family diversity preservation · role-fit realism · activation realism) become the standard measurement library for ALL CA-3d items. For Item 0001 specifically:

| # | Axis | VALIDATED definition | NEUTRAL definition | GAP definition | CONCERN definition |
|---|---|---|---|---|---|
| 1 | **Recognizable ecosystem emergence** | Bettor cold-reads Discover/Curated and observes recognizable star players surfacing in role-fit games at a noticeably higher rate than the as-found baseline, with NO identity hooks (Law 27 preserved). Signal: classes fire on canonical predicates, not names. | Bettor observes no meaningful change in recognizable surfacing. | Recognizable players still under-surface despite their canonical class predicates clearly firing (role-ownership + survivability passes; opportunity exists; not surfaced). | Identity-driven promotion patterns appearing in surfaces, OR recognizable players being suppressed in ways that violate role-fit reasoning (Law 27 violation, OR survivability gate over-aggressive). |
| 2 | **SAFE viability emergence** | SAFE tier composes non-empty slips on typical slates, drawing from candidates that pass survivability gates. SAFE legs are structurally robust (volatility ≠ fragility distinction respected; Law 26). | SAFE composability unchanged from as-found baseline. | SAFE still collapses on most slates (the survivability gate hasn't unblocked SAFE-class candidates; subsequent items required). | SAFE composes but with structurally-fragile candidates that masked survivability failure (Law 23 hard-gate violation), OR SAFE's `isPremiumEdgeForSafe` override unexpectedly admitting survivability-failing candidates. |
| 3 | **Curated compression magnitude** | Curated edge surface (Layer 2 — `state.featured`) shows fewer rows than as-found, with each row carrying a stronger dimensional fingerprint: more dimension flags firing per candidate (role + game-flow + survivability all explicit). | Compression magnitude unchanged. | Compression hasn't tightened; same diffuse curated surface as as-found. | Compression sterilized — curated surface too small to satisfy Layer 2 product role; bettor experiences "5 props on a dark screen" (PRODUCT_IDENTITY anti-pattern). |
| 4 | **Battlefield breadth preservation** | Discover (Layer 1 — `state.discoveryCandidates`) shows the same or greater number of canonical-validated rows as as-found, with explicit battlefield-visible disqualification markers (`SurvivabilityIndicator` rendering "fails" reason) on survivability-failed rows. Bettor sees the disqualification, not its absence. | Battlefield breadth unchanged in row count; disqualification markers absent or unclear. | Battlefield breadth measurably narrowed (row count down) — partial sterilization. | Battlefield sterilization detected (significant battlefield row reduction; anti-sterilization guard violated; PRODUCT_IDENTITY Layer 1 doctrine broken). |
| 5 | **Prop-family diversity preservation** | Curated output spans the same or greater number of prop families (HR / Hits / TB / RBIs / Ks / Points / Rebounds / Assists / Threes / First Basket / etc.) as as-found baseline. Per-family thresholds (Law 29) calibrated correctly — no family systematically over-gated or under-gated. | Prop-family count unchanged. | Specific families systematically under-survive the new gate (e.g., HR overs disproportionately rejected; Hits overs disproportionately admitted) — family-threshold calibration off. | Prop-family monoculture emerged (e.g., curated surface dominated by single family) — gate calibration severely off OR Law 29 family-aware threshold not implemented. |
| 6 | **Role-fit realism** | Surfaced candidates' role classification (per canonical role-ownership signals) matches bettor cold-read expectation. Top-of-order hitters in HR-friendly games surface as HR-over candidates; primary creators in pace-up games surface as PRA-over candidates; etc. The role-fit feels structurally honest. | Role-fit unchanged from as-found baseline. | Candidates surface in role-mismatched contexts (back-of-order hitter in HR-suppressing park surfacing as HR-over; non-creator player surfacing as assists-over) — role-ownership dimension under-applied. | Systematic role-mismatch patterns indicating the survivability gate is using volatility-class predicates instead of role-ownership predicates (Law 26 conflation re-emergence). |
| 7 | **Activation realism** | Surfaced candidates' game-flow signals match bettor cold-read expectation. High-pace + high-total games surface offensive overs; defensive matchups surface pitcher/defensive unders; weather/park amplifiers surface HR / power props. Activation feels structurally honest. | Activation realism unchanged. | Candidates surface in unactivated game-flow contexts (pitcher's duel game surfacing high-total offensive overs; HR-suppressing weather surfacing HR overs) — game-flow dimension under-applied at the gate. | Systematic activation-mismatch patterns indicating the survivability gate has absorbed game-flow predicates into its own signal — dimension boundary violation (Laws 22 + 25 dimension separation). |

**Closure rule:** Item 0001 is considered CLOSED when:
1. Bettor-validation ledger entry recorded against all 7 axes for at least 1 MLB slate (sport-first sequencing per operator emphasis).
2. Of the 7 axes, **at minimum** axes 4 (battlefield breadth preservation), 6 (role-fit realism), and 7 (activation realism) must come back **NEUTRAL or VALIDATED** — these are the hard floor (any GAP/CONCERN on these axes blocks closure).
3. Axes 1 (recognizable ecosystem emergence) and 5 (prop-family diversity) may come back GAP — those gaps scope into subsequent CA-3d items, NOT into Item 0001 patches.
4. Axis 2 (SAFE viability) is expected to be GAP after Item 0001 alone — SAFE viability emerges structurally only after multiple dimension gates land; a NEUTRAL result on axis 2 is acceptable closure.
5. Axis 3 (curated compression magnitude) may come back NEUTRAL or VALIDATED; CONCERN on axis 3 (sterilization) blocks closure.
6. MCR truth-disposition reviews the ledger entry and signs off closure per the BETTOR VALIDATION TRUTH DOCTRINE (`docs/OPERATOR_RUNBOOK.md` § BETTOR VALIDATION TRUTH DOCTRINE).

##### ACTIVE EXECUTION authorization packet (DRAFT — pending MCR sign-off to activate)

**This packet is what ACTIVE EXECUTION receives when MCR authorizes Item 0001 implementation. It is the canonical handoff document.**

**Authorization status:** DRAFT. Implementation does NOT begin until MCR explicitly signs off and routes ACTIVE EXECUTION.

**Scope contract:**
- ACTIVE EXECUTION ships exactly the drafted scope (items 1–9 above). Deviations require pre-implementation MCR sign-off (codification confirmation pass).
- ACTIVE EXECUTION does NOT ship anything in the explicit non-scope list above. Forbidden patterns are absolute.

**Artifact shape (expected files produced):**
- NEW: `backend/pipeline/shared/survivabilityGate.js` — sport-aware dispatcher; six-element canonical-helper-doctrine header; exports `survivabilityGate(c, sport)`.
- NEW: `backend/pipeline/mlb/mlbSurvivabilityGate.js` — MLB-specific gate predicate; per-prop-family threshold constants; six-element header; consumes canonical lineupSpot + plateAppearancesProxy + depth + impliedTeamTotal + gameTotal + runEnvironment + hrEnvironmentTag + carryShift + temperatureF + bullpen-fragility signals.
- MODIFIED: `backend/pipeline/shared/bettorLanguage.js` — extended with `SURVIVABILITY_PHRASES` library (deterministic; operator-approved phrase set; additive); existing SIGNAL_PHRASES preserved verbatim.
- MODIFIED: `frontend/src/workstation/canonicalOverlap.ts` — `FeaturedOverlapEntry` interface extended with `survivabilityFlag?: "passes" | "fails"` and `survivabilityReasonTag?: string` (Law 21 Invariant 3 narrow-interface extension; backward-compatible; indexed-access type binding from a hypothetical canonical `Survivability` enum or string-literal union).
- MODIFIED: `backend/pipeline/shared/buildFeaturedPlays.js` — wire the survivability gate evaluation AT THE QUALIFIED-SET ADMISSION POINT (before composite scoring orders the qualified set). NO composite weight change. Existing scoreCandidate function preserved.
- MODIFIED: `backend/routes/workstationRoutes.js` — surface `survivabilityFlag` + `survivabilityReasonTag` to overlap index emission for both `state.featured` and `state.discoveryCandidates`.
- NEW: `frontend/src/workstation/components/SurvivabilityIndicator.tsx` — canonical dimension renderer (six-element header; helper-owned absence policy per Law 19; renders `◆ {phrase}` pattern inherited from `ConvictionNote.tsx`; color authority maps passes/fails/absent to good/warn/null).
- MODIFIED: `frontend/src/workstation/sections/GameDiscoveryView.tsx` — invoke `SurvivabilityIndicator` on overlap entries (join-absence guard pattern per Law 21; signal-absence handled by helper).
- MODIFIED: `frontend/src/workstation/components/FeaturedCard.tsx` + `RecommendationLadder.tsx` — invoke `SurvivabilityIndicator` alongside `ConvictionNote` where applicable.

**Verification gates (canonical 5-stage chain per OPERATOR_RUNBOOK § POST-PHASE CHECKPOINT DISCIPLINE):**
1. **checkpoint** — Law 12 reconciliation across required-on-patch brain docs + repo-root continuity set. INFRA / GOVERNANCE verifies.
2. **term1** — runtime up; TERM 1 server reloaded the patched code path. ACTIVE EXECUTION + FRONTEND / UX LAB verify.
3. **term2** — `npm run ops:verify` + `npm run brain:checkpoint`. INFRA / GOVERNANCE verifies. Expected: 37/37 PASS with the new SurvivabilityGate path exercised; no regression. (Note: the 37-suite verifier matrix may not yet include a verifier for the new gate; that's R4 Tier 3 territory and lands in a subsequent item.)
4. **FE inspection** — visual + interaction inspection of the Discover + Curated surfaces with the new `SurvivabilityIndicator` rendering. FRONTEND / UX LAB verifies.
5. **BETTOR VALIDATION** — first-wave bettor-validation ledger entry per the 7-axis closure criteria above. FRONTEND / UX LAB executes; INFRA / GOVERNANCE owns ledger write; MASTER CONTROL ROOM holds truth-disposition.

**Pre-conditions (must be satisfied before ACTIVE EXECUTION can begin):**
- MCR sign-off on this authorization packet (explicit; recorded in this entry's "MCR sign-off recorded" field).
- Operator confirmation of the initial per-prop-family threshold constants for MLB (Law 29 — thresholds are operator-approved canonicals; ACTIVE EXECUTION does not invent them).
- No competing in-flight phase work on the same files (avoid merge conflict).

**Post-conditions (must be true at seal claim):**
- All artifacts produced match the artifact shape spec.
- All explicit non-scope items remain untouched (verifiable via git diff).
- 5-stage chain cleared.
- Bettor-validation ledger entry written.
- Closure criteria (axes 4, 6, 7 NEUTRAL or VALIDATED; CONCERN on axis 3 absent) satisfied.

**Forbidden patterns (re-emphasized for foreground):**
- No hidden weighting patches.
- No mystery-score regressions.
- No celebrity inflation.
- No battlefield sterilization.
- No "make longshots weaker" — the gate distinguishes structurally-robust volatility from structurally-fragile volatility; price alone is never the gate predicate.
- No premature calibration fixes.
- No compensating weights.
- No curated-surface hacks.
- No LLM / GPT synthesis.

**Handoff back to MCR:**
- ACTIVE EXECUTION reports completion against this packet.
- INFRA / GOVERNANCE verdicts structural inspection (T3-pattern + T1-close-pattern).
- FRONTEND / UX LAB executes the 5th-stage bettor-validation run with ledger entry recorded.
- MASTER CONTROL ROOM holds truth-disposition; signs Item 0001 CLOSED or routes follow-up items if axes 4/6/7 surface GAP/CONCERN.

##### Subsequent items unlocked by Item 0001 closure

When Item 0001 closes, the following queue items become eligible for authorization (still requiring explicit MCR direction):
- **Item 0002** (illustrative) — NBA survivability gate implementation (sport-extension of Item 0001's MLB-first pattern; Law 28 sport-specific implementation).
- **Item 0003** (illustrative) — Role-ownership dimension gate (sport-aware; Laws 22 / 25 / 28; companion structural-dependency gate to survivability).
- **Item 0004** (illustrative) — Game-flow activation dimension gate (sport-aware; Laws 22 / 25 / 28; companion structural-dependency gate).
- **Item 0005+** (illustrative) — additional CA-3d items as MCR sequences.

Items 0002–0005+ are NOT entered into the queue yet. They are listed here to clarify the unlocking dependency chain. Actual entry requires MCR direction at the appropriate codification-confirmation pass.

— end of Item 0001 doctrine-pilot entry —

### C.13 — R4 verifier-extension planning summary

R4 candidate scope: **21 verifiers** (12 from R1 + 9 from opportunity-qualification codification).

Authoring sequence (proposed; INFRA / GOVERNANCE scheduling pending):

**Tier 1 — Doctrine-surface stability** (high priority; protect what's already codified):
- `verifyShadowCanonicalDrift` · `verifyPhaseDocCoherence` · `verifyForbiddenListConsistency` · `verifyOrphanBrainLayer` · `verifyProbeMatrixCanonicalization`

**Tier 2 — Architectural-helper invariants** (high priority; protect the overlap helper + canonical helpers + type discipline):
- `verifyCanonicalHelperDoctrine` · `verifyTypeWideningDiscipline` · `verifyLayerTypeSeparation` · `verifyOverlapHelperCanonicality` · `verifyNoFeOverlapReDerivation` · `verifyOverlapIdParity` · `verifyFeaturedBucketRegistration`

**Tier 3 — Shape γ structural invariants** (medium priority; activated as Shape γ implementation lands):
- `verifyOpportunityQualificationOrdering` · `verifyHardGateThenTune` · `verifyDimensionExplainability` · `verifyShapeGammaStructure` · `verifyFourQuestionSchema`

**Tier 4 — Cross-cutting bettor-trust invariants** (medium priority; activated as Shape γ implementation lands):
- `verifyClassNotIdentity` · `verifySportAgnosticTaxonomy` · `verifyPropFamilyAwareThresholds` · `verifyVolatilityFragilityDistinction`

Tiers 1 + 2 can author independently of Shape γ implementation (they protect the existing doctrine surfaces). Tiers 3 + 4 author alongside or after Shape γ implementation lands; until then, they protect doctrine that is not yet actively exercised at runtime.

**Authoring discipline (operator-cemented):**
- Each verifier is a pure-observation script; canonical-authority pattern; six-element header (when applicable to FE-side helpers); deterministic; no LLM; no synthesis.
- Verifiers wire into `runAllVerifiers.js` matrix; matrix size grows from 31 → 31+N as verifiers author.
- Brain-checkpoint reconciliation tracks each verifier addition.
- Authoring lane: INFRA / GOVERNANCE.

### C.14 — Closure handoff to MCR (Phase 1B)

**Phase 1B canonicalization status: COMPLETE.**
- Shape γ canonicalized into Law 25.
- 6 operator-named doctrines codified as Laws 26–30 (Law 26 volatility ≠ fragility; Law 27 class-not-identity; Law 28 sport-agnostic taxonomy; Law 29 prop-family-aware thresholds; Law 30 four-dimensional explanation schema; plus market-integrity / selective-gating / inspectability folded into Laws 25 + 24).
- Battlefield/curated as bettor operating modes codified into PRODUCT_IDENTITY.
- CA-3a continuation: per-dimension reconciliation depth landed (Stage C.9).
- CA-3c continuation: Shape γ canonical implementation inventory landed (Stage C.10).
- CA-3d preparation: queue structure + governance + entry template + closure criterion landed (Stage C.11 + C.12).
- R4 verifier-extension planning: 21-candidate scope + 4-tier authoring sequence (Stage C.13).
- Memory: opportunity-qualification doctrine memory updated; new doctrine principles cross-referenced.

**Open items for MCR truth-disposition:**

1. **Authorization to open the reconciliation queue (CA-3d items).** The structure is ready; the queue itself remains empty until MCR authorizes the first item entries. INFRA / GOVERNANCE drafts items under explicit operator direction; MCR approves; ACTIVE EXECUTION implements.
2. **R4 verifier-authoring scheduling.** Tier 1 + Tier 2 verifiers can author independently of Shape γ implementation. MCR sequences the authoring phases.
3. **Implementation lane sequencing.** As CA-3d items begin populating, ACTIVE EXECUTION authorization happens per-item under explicit scope locks (the pattern established for P1A-T1 → T3 → T-close).
4. **Bettor-validation cadence.** Per the operator emphasis, empirical bettor-validation against live outputs becomes the primary operator focus once CA-3d is constructible. Bettor-validation runs happen per-slice as items land; the 5th-stage workflow is the canonical mechanism (`docs/BETTOR_VALIDATION_LEDGER.md`).

**Recommended next routing (no MCR pre-selection):**
- For CA-3d item authorization: **MASTER CONTROL ROOM**.
- For R4 verifier authoring: **INFRA / GOVERNANCE** when scheduled.
- For Shape γ implementation phases: **ACTIVE EXECUTION** when authorized per item.
- For bettor-validation runs against live outputs: **FRONTEND / UX LAB** executing; **INFRA / GOVERNANCE** owning ledger write quality.

— end of Stage C continuation (Shape γ finalization + CA-3a/c depth + CA-3d preparation + R4 planning) —
