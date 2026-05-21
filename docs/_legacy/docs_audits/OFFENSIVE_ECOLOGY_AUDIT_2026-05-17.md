# OFFENSIVE-ECOLOGY-INTELLIGENCE-1A AUDIT — EXPLOSION & UPSIDE INTELLIGENCE

**Date:** 2026-05-17
**Phase under audit:** Offensive-Ecology-Intelligence-1A (NEXT phase — not yet shipped)
**Audit type:** READ-ONLY — no patches, no schema mutation, no scoring redesign.
**Author / process:** post-bootstrap offensive-ecology trace following the nineteen-phase governance substrate (Bettor-Curation-Intelligence-1A sealed at 2026-05-17T03:27:51Z; bootstrap re-verified at session open with 0 issues / 0 warns).

> Doctrine: this document inventories WHAT IS, with file-path + line-number citations and empirical anchors. It proposes ZERO patches. The next session selects operator-approved lever(s) from Section 10 and ships them as Phase Offensive-Ecology-Intelligence-1A under the established additive / replay-safe / grading-safe / calibration-safe / anti-fabrication doctrine.
>
> **Operator anti-fabrication gate (this phase):** NO opaque ML, NO GPT-generated scores, NO fake explosion narratives, NO unsupported momentum AI, NO invented confidence, NO hard-forcing overs, NO destroying hidden-value unders. Every boost / demote / aggregator must derive from canonical signal already populated on row context.
>
> **Operator-approved deterministic concept names (the only new vocabulary allowed):** `offensivePressureIndex` · `lineupTurnoverPotential` · `stackReinforcementScore` · `bullpenFragilityContext` · `hrCarryEnvironment` · `correlatedRunProduction` · `explosiveEnvironmentTag` · `ladderSurvivabilityFactor`.

---

## EXECUTIVE FINDING

The repo's offensive ecology has the SAME structural shape as the four prior canonical-bridge gaps (MLB-Correlation-Engine-1A, Visual-Betting-Intelligence-1A, FE-Upload-Surface, Bettor-Curation-Intelligence-1A): canonical signals exist on rows but the curator only consumes them ASYMMETRICALLY — unfavorable contexts get soft-demoted (BC-4 shipped today), favorable contexts get NO positive boost. Combined with three pre-existing structural under-biases, the curator produces 1.48× more all-under slips than all-over slips, and the canonical `pairCorrelationScore = +0.5` for same-team hitter-over stacks (Phase MLB-Correlation-Engine-1A canonical truth) is never consumed in slip composition — it sits as observational metadata only.

**Empirical anchor (first-hand verified this session)**: across 10 days of graded MLB slips in `runtime/tracking/mlb_tracked_slips_*.json` (657 multi-leg slips total): 338 are ALL-UNDER (51.4%) vs 228 ALL-OVER (34.7%) vs 91 mixed (13.9%). Of the SETTLED subset: 209 all-under slips graded with 21.1% win rate; only 1 all-over slip graded in the same window. The curator is structurally producing under-heavy parlays that are calibration-mismatched (combined modelProb ≈ 35% per typical 2-leg under-under, actual ≈ 21%). The all-over surface is so suppressed by curation that it cannot even produce a meaningful settled sample.

**The fix is purely additive composition.** Eight operator-approved deterministic concepts map cleanly to existing canonical signals (`runEnvironment`, `rbiEnvironment`, `plateAppearancesProxy`, `impliedTeamTotal`, `gameTotal`, `hrEnvironmentTag`, `hrFactor`, `windDirectionTag`, `carryShift`, `temperatureF`, `pairCorrelationScore`). No new ML. No GPT. No celebrity scoring. No new persistence. No new fetches.

---

## SECTION 1 — OFFENSIVE-ECOLOGY AUDIT (CURATION SURFACES + CANONICAL-SIGNAL CONSUMPTION)

| Surface (file:line) | Canonical environment signals consumed | Canonical environment signals NOT consumed |
|---|---|---|
| `buildFeaturedPlays.scoreCandidate` (~277-403) | `depth × impliedTeamTotal` via BC-2 `playerLegitimacyFactor` (shipped today, 7% weight) | `runEnvironment`, `rbiEnvironment`, `plateAppearancesProxy`, `gameTotal`, `hrEnvironmentTag`, `hrFactor`, `windDirectionTag`, `carryShift`, `temperatureF`, `contextualTags`, `bullpenShift` |
| `buildFeaturedPlays.buildBestHr` (~695) | BC-4 soft-demote on `HR_SUPPRESSING` + desert teamTotal (-0.05) | Positive boost for HR_FRIENDLY / wind_out / carryShift / gameTotal ≥ 9.0 — NONE |
| `buildFeaturedPlays.buildBestLadders` (~718) | BC-4 soft-demote (same) | `plateAppearancesProxy`, `runEnvironment`, `rbiEnvironment`, ladder-height-vs-context |
| `buildFeaturedPlays.buildBestAggressive` (~872) | BC-4 soft-demote (same) | All offensive-ecology fields |
| `buildSlipAi.scoreLeg` (~173-290) | NONE (BC-1 lifted; not yet consumed) | All 10 canonical environment fields |
| `buildSlipAi.canAddLeg` (~491-716) | MLB-COV-2/3 anti-correlation blocks (suppression only) | Positive same-team hitter-over reinforcement |
| `buildSlipAi.combineLegs` (~723-751) | NONE | `pairCorrelationScore = +0.5` for same-team OVER pairs (purely observational) |
| `buildSlipAi.TIER_TEMPLATES.balanced` (line 519) | `allowedSides: ["under"]` — **explicitly excludes hitter overs from BALANCED tier** | n/a (intentional MLB-only restriction) |
| `buildMlbHrPredictionCandidates.js` | `impliedTeamTotal`, `gameTotal`, `battingOrder` (top-5 → +1), weatherScore (windOut / temp ≥ 75), parkScore (hrFactor 1.2+ → +2.5) | `bullpenShift` (dormant), `runEnvironment`, `rbiEnvironment` |
| `buildMlbHrStacks.js` | hrScore only | gameTotal, weather, pitcher context, environment clustering |
| `buildMlbHrSlips.js` | modelProb ≥ 0.12 + edge > 0 | environment gates entirely absent |
| `buildMlbCorrelationEngine.contextBoost` (cluster-only) | `impliedTeamTotal >= 5.0/4.5`, `gameTotal >= 9.0` | Feeds cluster path only — never reaches featured-plays curator |

**Verdict (first-hand `grep -n` verified):** `runEnvironment` + `rbiEnvironment` + `bullpenShift` + `buildBestOvers` = ZERO references across both `buildFeaturedPlays.js` and `buildSlipAi.js`. The canonical signals are populated on rows by upstream context enrichers but die at the curator boundary. Same pattern as BC-1A bridged for `depth` + `impliedTeamTotal` — the rest of the canonical ecology vocabulary remains unbridged.

---

## SECTION 2 — HR-ECOLOGY ANALYSIS

`buildMlbHrPredictionCandidates.js` is the deepest HR-ecology consumer today — it explicitly weights `impliedTeamTotal`, `gameTotal`, batting order (top-5), wind direction, temperature, and `hrFactor`. **But its output is capped at `modelProb 0.35`** (line 450-451), suppressing high-upside ecology signals. Meanwhile the downstream curator (`buildBestHr` in `buildFeaturedPlays.js:695`) does NOT re-consult these signals — it accepts the capped modelProb + applies only BC-4 soft-demote, never positive boost.

The asymmetry is the gap: `buildBestHr` knows how to PUNISH HR-suppressing parks (BC-4 fired in 4 events during the BC-1A integration smoke), but it does not REWARD HR-friendly parks + wind-out + high game totals + high carryShift. A HR ladder at Coors with 10.5 game total + wind-out is treated identically to a HR ladder at a neutral park with 8.0 total + wind-in, given equal underlying composite.

`buildMlbHrStacks.js` and `buildMlbHrSlips.js` have NO environment gating at all — they pure-sort by hrScore and edge×0.6+modelProb×0.4 respectively. A HR stack in a sterile environment with high individual scores will outrank a coherent HR stack in an explosive environment.

---

## SECTION 3 — EXPLOSIVE-GAME-SCRIPT ANALYSIS

**Per-event aggregation does NOT exist.** First-hand verified: search for `explosiveEnvironmentTag` / `explosion` / `explod` in the codebase returns ZERO matches. `composeMlbContextualSignal.js` produces per-ROW `contextualShift` + `contextualTags`, but there is no per-EVENT roll-up that identifies "this game is set up to detonate."

The canonical signals to build such a tag already exist on rows:
- `gameTotal` (raw row from `buildMlbBootstrapSnapshot.js`)
- `impliedTeamTotal` (raw row + lifted via BC-1)
- `windDirectionTag` (`deriveMlbWeatherContext.js`)
- `carryShift` (same)
- `hrEnvironmentTag` (`deriveMlbParkContext.js`)
- `temperatureF` (`deriveMlbWeatherContext.js`)

A deterministic per-event aggregator that tags `eventId → "EXPLOSIVE"` when `gameTotal ≥ 9.5 AND avg(impliedTeamTotal across both teams) ≥ 4.5 AND windDirectionTag ∈ {"out_to_cf", "out_to_lf", "out_to_rf"} AND hrEnvironmentTag != "HR_SUPPRESSING"` would be pure-deterministic. NO LLM. NO GPT. Operator-approved concept name: `explosiveEnvironmentTag`.

---

## SECTION 4 — STACK-REINFORCEMENT ANALYSIS

**Status**: canonical `pairCorrelationScore` returns `+0.5` for same-team hitter overs in same game (`buildMlbCorrelationEngine.js:135-146`) — this is the **canonical truth-layer for stack coherence**, established Phase MLB-Correlation-Engine-1A.

**Consumer audit (first-hand verified)**: `pairCorrelationScore` appears in `buildSlipAi.js` ONLY at lines 86 (comment), 698 (MLB-COV-3 hard-block descriptor), 708 (the hard-block check `score <= -0.99`). It is **never consulted for positive (+0.5) values**. Same-team hitter-over stacks combine multiplicatively at `combineLegs` (line ~533-562, also confirmed earlier `combineLegs` reads no covariance signal):

```js
calibratedModelProb *= clamp(0.001, 0.999, rawLegProb * coeff)   // line ~547
```

A same-team hitter-OVER pair in a high-total game gets the SAME combined modelProb as two independent legs from different games. Positive coherence is **purely observational** (surfaces in VBI verdict's `positive_offensive_stack` signal as bettor-language phrase), but never reaches selection / scoring.

Operator-approved concept name: `stackReinforcementScore` — a deterministic wrapper combining canonical `pairCorrelationScore +0.5` with environment boost (`gameTotal` + `hrEnvironmentTag`), applied as small (+0.02 cap) additive joint-prob adjustment in `combineLegs`. Mirrors NBA's `jointProbabilityWithCorrelation` doctrine, additive only.

---

## SECTION 5 — LADDER-SURVIVABILITY ANALYSIS

`buildBestLadders` (line 718-730) filters by family + line band (1.5+ for batter stats); sorts by composite. BC-4 soft-demote on HR_SUPPRESSING + desert teamTotal applies (shipped today). **No POSITIVE survivability factor.**

The canonical signals that determine whether a 3.5-line TB ladder is survivable:
- `plateAppearancesProxy` (top-of-order ≈ 4.4-4.6 PAs vs back-of-order ≈ 3.8 PAs — significant impact on ladder hit probability)
- `runEnvironment` (top-of-order in good run environments ≈ 0.85 vs bottom-of-order in desert ≈ 0.30)
- `hrEnvironmentTag` / `carryShift` (for TB ladders, HR-friendliness materially affects ladder survival because HRs convert to 4 TB)
- `gameTotal` (high-total games create more late-game PA opportunities)

NONE of these are consulted in `buildBestLadders`. A 3.5 TB ladder for a #9 hitter with 3.81 PA proxy in a 7.5-total game gets the same composite as a 3.5 TB ladder for the #2 hitter with 4.50 PA proxy in a 10.0-total HR_FRIENDLY game.

Operator-approved concept name: `ladderSurvivabilityFactor` — deterministic from `ladderHeight × plateAppearancesProxy × runEnvironment × hrCarryEnvironment`. Applied as soft demote (-0.04 cap) when factor < 0.4. Anti-fabrication: neutral fallback when canonical signals absent.

---

## SECTION 6 — UNDER-DOMINANCE ANALYSIS

**Empirical anchor (first-hand verified)**: across `runtime/tracking/mlb_tracked_slips_*.json` (10 files, 657 multi-leg slips):

| Composition | Count | % of multi-leg | Win Rate (settled subset) |
|---|---|---|---|
| All-UNDER | 338 | 51.4% | 21.1% (44/209) |
| All-OVER | 228 | 34.7% | 0% (0/1 settled — n too small to be meaningful) |
| Mixed sides | 91 | 13.9% | (not computed) |

The 1.48× under-composition skew is structural. Five concrete causes, all file:line-cited:

1. **TIER_TEMPLATES.balanced MLB-only override** (`buildSlipAi.js:519`): `allowedSides: ["under"]`. BALANCED tier — the most-served operator surface — accepts ONLY under-side legs on MLB. NBA explicitly drops this (`buildSlipAi.js:620`: `allowedSides: null`). Over-side balanced candidates are rejected at `canAddLeg:803`.
2. **modelProb structural compression** (`buildSlipAi.scoreLeg` / `buildFeaturedPlays.scoreCandidate`): `probFactor = clamp(0.50, 0.55, conf)`. Under bets (shorter lines) naturally achieve modelProb 0.60-0.75; hitter overs (longer lines) compress to 0.45-0.55 by LINE SHAPE alone, not by confidence weakness. The compression structurally inflates under-side edge scores beyond equal-math peers.
3. **`textureBoost` magnitude insufficient** (`buildFeaturedPlays.scoreCandidate:373-379` post-BC-2 numbering): caps at 0.030 for aggressive/lotto offensive overs. A 10% edge under at modelProb 0.65 scores baseline ~0.065 edge contribution; a 10% edge aggressive offensive over gets +0.030 textureBoost but still loses the volRealism penalty (0.66 vs 0.74 weighted at 10% = -0.008 composite). Under typically still wins composite race despite equal underlying math.
4. **`buildBestUnders` exists; `buildBestOvers` parallel does NOT** (first-hand `grep` verified): a dedicated under-surface is hard-coded; no symmetric over-surface exists. Operator visibility is one-sided.
5. **Fill-pass under default** (`pickDiversified` calls across bucket builders): when offensive overs are suppressed by causes 1-4, the diversity-fill pass defaults to under-side legs to satisfy `maxSideFraction: 0.60` caps. This compounds the under skew bucket-by-bucket.

The empirical 21.1% all-under win rate confirms calibration mismatch: a typical 2-leg all-under at 0.70 × 0.70 × 0.72-0.85 family coeff produces combined modelProb ≈ 30-42% but actual hit rate is 21%. The under stack ecology is over-promoted AND under-calibrated.

Operator-approved concept name: NONE — under-dominance is a SIDE EFFECT of curation; the fix is to add canonical OVER-side boosts (OE-1 + OE-4 + OE-8 below), NOT to add new vocabulary.

---

## SECTION 7 — SAME-GAME-COHERENCE ANALYSIS

MLB-COV-2 / MLB-COV-3 (Phase MLB-Correlation-Engine-1A) hard-block toxic same-game pairs (`buildSlipAi.canAddLeg:680-716`). **But same-game positive coherence has ZERO reward path.**

Canonical truth: `pairCorrelationScore = +0.5` for same-team hitter-over pairs in same game. Consumer: NONE in slip composition. The slip composer treats:
- Star + Star same-game hitter overs (canonical +0.5 cov) — combined as if independent
- Star OVER + Backup OVER different games (canonical 0 cov) — combined as if independent
- Hitter OVER + Pitcher K-OVER opposing teams (canonical -1.0 cov) — HARD BLOCKED via MLB-COV-3

Only the negative case has a consumer. Positive coherence is invisible to selection.

Operator-approved concept names addressing this: `stackReinforcementScore` (general same-team OVER reward) + `lineupTurnoverPotential` (more targeted: same-team top-of-order pair → small joint-prob boost reflecting batting-order cadence).

---

## SECTION 8 — CORRELATED RUN PRODUCTION (RUN/RBI ECOLOGY)

`deriveMlbLineupContext.js` populates per-row `runEnvironment` (0.30-0.85 by spot) and `rbiEnvironment` (0.30-0.90 by spot). **Both signals are unconsumed downstream.** First-hand `grep` verified: ZERO references in `buildFeaturedPlays.js` and `buildSlipAi.js`.

The structural impact: a top-of-order runs OVER bet (lineupSpot 1-2, runEnvironment ≈ 0.80) scores identically to a bottom-of-order runs OVER bet (lineupSpot 8-9, runEnvironment ≈ 0.35) given equal composite. The canonical lineup ecology — leadoff hitters score more runs; cleanup hitters drive more RBIs — is invisible to the curator.

Operator-approved concept name: `correlatedRunProduction` — deterministic boost (~+0.03 cap) for runs/RBIs hitter overs at top-of-order (lineupSpot 1-4) with high `rbiEnvironment` / `runEnvironment`. Applied at scoreCandidate level.

---

## SECTION 9 — BULLPEN-FRAGILITY ANALYSIS

`deriveMlbBullpenContext.js` first-hand verified: shape-stable but DORMANT. Lines 65-66 / 81-82 return `dataAvailable: false / bullpenShift: 0` when `bullpenByTeam` is not populated. The function HAS active code (lines 95-99) that emits `bullpenShift` IF data is wired, but the upstream feed is absent (Phase 1B reserved per file header line 28: "bullpenShift — 0 until data wired").

Operator-approved concept name: `bullpenFragilityContext` — **HELD for Phase Offensive-Ecology-Intelligence-1B** until upstream bullpen feed activates. No 1A consumption path makes sense when the upstream is dormant; consuming a constant-zero signal would just fabricate noise.

---

## SECTION 10 — EMPIRICAL ANCHORS (graded slip evidence)

| Pattern | Count (10-day window) | Win Rate (settled) | Observation |
|---|---|---|---|
| All-UNDER multi-leg slips | 338 | 21.1% (44/209) | Calibration mismatch (model ~35% vs actual 21%); over-served by BALANCED tier under-only template |
| All-OVER multi-leg slips | 228 | 0% (0/1 settled) | Severely under-served by curator; insufficient settled sample |
| Mixed-side multi-leg | 91 | — | Adequate; reflects natural slip mixing |
| Coors UNDER stack loss (anchor cited in MLB-Correlation audit) | 1 (2026-05-15) | 0% — both legs lost | Already addressed by MLB-COV-2 |

**Anti-fabrication note**: the 0/1 all-over settled win rate is NOT meaningful (sample size 1). The decisive metric is the 338 vs 228 composition skew + the 21.1% under-stack hit rate, both of which empirically support the operator's "AI parlays still over-index on unders" observation.

---

## SECTION 11 — OFFENSIVE-ECOLOGY PLAN (smallest-safe-step composition)

The plan composes ten additive moves using only canonical signals and operator-approved concept names. ALL of them have neutral fallbacks when canonical signals are absent (anti-fabrication). NONE introduce ML, GPT, celebrity weighting, or hard-force overs.

### Move 1 — Lift remaining canonical environment fields through normalizeCandidate
BC-1 lifted depth / impliedTeamTotal / gameTotal / hrEnvironmentTag / contextualTags + lineupSpot / plateAppearancesProxy. Still missing: `runEnvironment`, `rbiEnvironment`, `windDirectionTag`, `carryShift`, `hrFactor`, `temperatureF`. **OE foundation requires lifting these through both `normalizeCandidate` functions.**

### Move 2 — Build deterministic `offensivePressureIndex(c)` (OE-1, scoreCandidate)
Pure function combining `runEnvironment × impliedTeamTotal × (1 + carryShift)` for hitter overs only. ~5% additive composite weight. Neutral fallback 0.50 when canonical absent. Anti-fabrication: never invents.

### Move 3 — Build deterministic `hrCarryEnvironment(c)` (OE-4, scoreCandidate)
Pure boolean / scalar combining `windDirectionTag === "out_to_cf"` + `carryShift > 0` + `hrEnvironmentTag === "HR_FRIENDLY"` + `temperatureF >= 75`. Applied additively (~+0.03 cap) to HR-prop composite for HR overs only. Anti-fabrication: zero when any signal absent.

### Move 4 — Build deterministic `correlatedRunProduction(c)` (OE-8, scoreCandidate)
Hitter runs/RBIs overs at top-of-order (lineupSpot 1-4) with high `rbiEnvironment` / `runEnvironment`. Small additive boost (~+0.03 cap). Anti-fabrication: zero when canonical absent.

### Move 5 — Build per-event `explosiveEnvironmentTag` aggregator (OE-2)
Aggregate at `buildFeaturedPlays` ingest: per `eventId`, compute the gate (`gameTotal >= 9.5 AND avg(impliedTeamTotal) >= 4.5 AND windDirectionTag ∈ wind-out set AND hrEnvironmentTag != "HR_SUPPRESSING"`); set `EXPLOSIVE` tag on all candidates sharing the eventId. Pure observational. Anti-fabrication: no tag when canonical fields absent.

### Move 6 — Build `buildExplosiveUpsideTickets` observational bucket (OE-5)
Surface top-3 hitter overs from each EXPLOSIVE-tagged event. Pure additive bucket. Auto-empty when no event qualifies. Mirrors the BC-5 `buildBelievableUpsideTickets` doctrine.

### Move 7 — Recommendation ladder slot 9 surfaces OE-5 top pick (OE-6)
Add 9th slot `bestExplosiveUpside` to `buildRecommendationLadder`. Pure additive. Null when bucket empty.

### Move 8 — Build `ladderSurvivabilityFactor(c)` soft-demote in buildBestLadders (OE-7)
Deterministic `ladderHeight × plateAppearancesProxy × runEnvironment` (and `hrCarryEnvironment` when HR-stat ladder). Soft demote -0.04 cap when factor < 0.4. Anti-fabrication: neutral when canonical absent.

### Move 9 — Build `stackReinforcementScore(legA, legB)` in combineLegs (OE-3)
Wraps canonical `pairCorrelationScore === +0.5` with environment multiplier; applies small (+0.02 cap) additive joint-prob adjustment for same-team hitter OVER pairs in same game. Mirrors NBA's `jointProbabilityWithCorrelation` doctrine. Additive only. Anti-fabrication: zero adjustment when score not +0.5.

### Move 10 — Operator-visible `[OE-1A]` log + counters + helper unit fixture (OE-10/11)
Per-run counter accounting: `EXPLOSIVE` events tagged, HR-carry boosts applied, run-production boosts applied, stack-reinforcement boosts applied, ladder-survivability demotes applied. Helper unit: 80-90 deterministic assertions covering every new pure function + integration with sterile vs explosive fixture differential.

---

## SECTION 12 — LONGITUDINAL EXPLOSION-LEARNING STRATEGY

Phase 1A ships the deterministic foundation. Future-phase strategy:

| Phase | Lever | Operator value |
|---|---|---|
| **1A** (this proposal) | OE-1/2/4/5/6/7/8 + OE-10/11 | Realism-weighted upside foundation + observational explosion tagging |
| 1B | OE-3 — `stackReinforcementScore` in `combineLegs` (joint-prob adjustment) | Reward same-team hitter-OVER coherence in slip composition |
| 1C | OE-9 — `lineupTurnoverPotential` targeted at top-of-order same-team pairs | More precise stack-pair signal |
| 1D | `bullpenFragilityContext` activation — requires upstream bullpen feed wiring | Reward late-inning hitter overs vs fatigued bullpens |
| 1E | Longitudinal `[OE-1A]` counter persistence + retrospective ROI tracking | Empirical validation of upside boosting |
| 1F | Operator-tunable OE-1 / OE-4 / OE-8 weights via observation window | Calibration loop |
| 1G | Drop or invert `TIER_TEMPLATES.balanced.allowedSides: ["under"]` MLB override | Under-dominance structural fix (held until 1A signals demonstrate offensive over surface is healthy) |

**Anti-fabrication invariant across all future phases**: every new signal must already exist on row context. NO new ML. NO new fetches. NO new "explosion narratives." NO celebrity weighting.

---

## SECTION 13 — CANDIDATE LEVERS (operator-approvable Phase Offensive-Ecology-Intelligence-1A scope)

Every lever is deterministic, additive, anti-fabrication-respecting, reuses existing canonical signals + operator-approved concept names only. NO opaque ML. NO GPT scores. NO fake explosion narratives. NO hard-force overs. NO destruction of hidden-value unders. NO new persistence. NO new fetches.

| Lever | Surface | Risk | Smallest-safe |
|---|---|---|---|
| **OE-1** — Lift `runEnvironment` / `rbiEnvironment` / `windDirectionTag` / `carryShift` / `hrFactor` / `temperatureF` through both `normalizeCandidate` functions. Pure additive lift. | both `normalizeCandidate` | LOW | ★ smallest. Foundation for all other OE levers. |
| **OE-2** — NEW `offensivePressureIndex(c)` pure helper + ~5% additive composite weight in `scoreCandidate` for hitter overs only. Neutral fallback 0.50. | `buildFeaturedPlays.scoreCandidate` | LOW | ★ smallest. Bridges canonical `runEnvironment × impliedTeamTotal × carryShift`. |
| **OE-3** — NEW `hrCarryEnvironment(c)` pure helper + ~+0.03 additive composite boost on HR overs in `scoreCandidate`. Boolean AND gate over 4 canonical fields. Zero when any absent. | `buildFeaturedPlays.scoreCandidate` | LOW | ★ smallest. HR-favorable ecology REWARD (symmetric to BC-4 HR-suppressing soft-demote). |
| **OE-4** — NEW `correlatedRunProduction(c)` pure helper + ~+0.03 additive boost for runs/RBIs hitter overs at top-of-order with high run/RBI environment. | `buildFeaturedPlays.scoreCandidate` | LOW | Bridges canonical `runEnvironment` / `rbiEnvironment` (currently dead weight). |
| **OE-5** — NEW per-event `explosiveEnvironmentTag` aggregator at `buildFeaturedPlays` ingest. Deterministic gate; tag every candidate sharing the eventId. Pure observational. | `buildFeaturedPlays.buildFeaturedPlays` | LOW | ★ smallest. Per-event roll-up of canonical fields. |
| **OE-6** — NEW `buildExplosiveUpsideTickets` observational bucket (mirrors BC-5 `buildBelievableUpsideTickets` doctrine). Surfaces top-3 hitter overs from EXPLOSIVE-tagged events. Auto-empty when no events qualify. | `buildFeaturedPlays` | LOW | Pure additive bucket. |
| **OE-7** — NEW recommendation ladder slot 9 `bestExplosiveUpside`. Sourced via `pickFirstUnique` dedup walk from OE-6 bucket. All 8 prior slots preserved verbatim. | `buildRecommendationLadder` | LOW | Pure additive slot. |
| **OE-8** — NEW `ladderSurvivabilityFactor(c)` pure helper + soft demote -0.04 cap inside `buildBestLadders` when factor < 0.4. Anti-fabrication: neutral when canonical absent. | `buildBestLadders` | LOW | Symmetric to BC-4 doctrine for ladder context. |
| **OE-9** — Operator-visible `[OE-1A] explosive-ecology surfaced N events / boosted M HR / boosted K runs / demoted L ladders` log + counters. Rate-limited (one per run). | `buildFeaturedPlays` | TRIVIAL | Pure observability. |
| **OE-10** — NEW `verifyOffensiveEcology1A.js` helper unit fixture: ~80 deterministic + integration assertions; sterile vs explosive environment differential. | `backend/scripts/` | LOW | Required for governance probe matrix. |
| **OE-11** — `stackReinforcementScore` in `combineLegs` joint-prob adjustment. Wraps canonical `pairCorrelationScore +0.5`. | `buildSlipAi.combineLegs` | MEDIUM | **HELD for 1B** — needs 1A observation window before applying joint-prob adjustments. |
| **OE-12** — `lineupTurnoverPotential` for top-of-order same-team pair in canAddLeg/combineLegs. | `buildSlipAi.canAddLeg` | MEDIUM | **HELD for 1C** — depends on OE-11. |
| **OE-13** — `bullpenFragilityContext` consumer wiring. | `buildFeaturedPlays.scoreCandidate` | HIGH | **HELD for 1D** — upstream bullpen feed is dormant; consuming constant-zero would fabricate noise. |
| **OE-14** — Invert / drop `TIER_TEMPLATES.balanced.allowedSides: ["under"]` MLB-only override. | `buildSlipAi.js:519` | HIGH | **HELD for 1G** — observe OE-1A real-slate behavior before structural under-only override change. |
| **OE-15** — Build `buildBestOvers` symmetric to `buildBestUnders`. | `buildFeaturedPlays` | MEDIUM | **HELD for 1B** — observe whether OE-6 explosiveUpsideTickets bucket fills the symmetry first. |

**Recommended smallest-safe combination:** **OE-1 + OE-2 + OE-3 + OE-4 + OE-5 + OE-6 + OE-7 + OE-8 + OE-9 + OE-10 ship together** as Phase Offensive-Ecology-Intelligence-1A. Together they form a complete deterministic offensive-ecology foundation:
- OE-1 lifts remaining canonical signals through normalization (foundation)
- OE-2 + OE-3 + OE-4 add three small additive scoreCandidate boosts (5% + 3% + 3% caps; total ≈ 11% headroom; existing 9 + BC-2 factors UNCHANGED)
- OE-5 + OE-6 + OE-7 add per-event explosive-environment intelligence + new bucket + new ladder slot 9
- OE-8 adds ladder-survivability soft-demote symmetric to BC-4 doctrine
- OE-9 + OE-10 establish per-run accounting + verification

**Deferred to 1B+:** OE-11 (joint-prob adjustment — needs observation window first), OE-12 (lineupTurnoverPotential — depends on OE-11), OE-13 (bullpen — upstream dormant), OE-14 (BALANCED under-only override — structural; needs OE-1A behavior validated first), OE-15 (buildBestOvers — observe whether OE-6 fills the symmetry).

---

## SECTION 14 — AUDIT CITATIONS (REPRODUCIBILITY)

| Citation | Verified by |
|---|---|
| `buildFeaturedPlays.js` / `buildSlipAi.js` ZERO references to `runEnvironment` / `rbiEnvironment` / `bullpenShift` / `buildBestOvers` | First-hand `grep -n` this session. |
| `pairCorrelationScore` in `buildSlipAi.js` ONLY at lines 86 / 698 / 708 (hard-block consumer for ≤ -0.99); never consumed for `+0.5` | First-hand `grep -n` this session. |
| `TIER_TEMPLATES.balanced` MLB override `allowedSides: ["under"]` at `buildSlipAi.js:519` | First-hand `grep -n` + line context this session. |
| NBA-1 `allowedSides: null` at `buildSlipAi.js:620` (NBA explicitly drops under-only) | Same. |
| `deriveMlbBullpenContext.js` returns `dataAvailable: false / bullpenShift: 0` at lines 65-66 / 81-82 | First-hand `grep -n` this session. |
| Empirical 657 multi-leg slips / 338 all-under / 228 all-over / 91 mixed across `runtime/tracking/mlb_tracked_slips_*.json` (10 files) | First-hand `node -e` aggregation this session. |
| All-UNDER settled win rate 21.1% (44/209) vs all-OVER 0% (0/1) | Same. |
| `buildMlbHrPredictionCandidates.js` line numbers + signal consumption | Explore subagent trace + audit cross-reference. |
| `buildMlbCorrelationEngine.contextBoost:151-173` consumes `gameTotal>=9.0` cluster-path only | Prior audit cross-reference (`docs/MLB_CORRELATION_AUDIT_2026-05-16.md` Section 7). |

---

## ARCHITECTURE PRESERVATION INVARIANTS (THIS AUDIT)

- ✓ ZERO code patched.
- ✓ ZERO schema mutation.
- ✓ ZERO scoring redesign (Phase 1A will ADD three small factors — not redesign existing 10).
- ✓ ZERO grading / replay / lineage / persistence / orchestrator touch.
- ✓ ZERO calibration / settlement / market-pipeline / MLB-COV / EXPL / NBA-correlation / existing screenshot / recommendation-hierarchy-architecture-beyond-additive-slot-9 change.
- ✓ Receipt + checkpoint state unaffected (audit is read-only; brain:checkpoint still required at end of next code-touching session).

---

## STATUS

Phase Offensive-Ecology-Intelligence-1A AUDIT complete. Recommended next action: operator selects lever(s) from Section 13 (smallest-safe-step combination: **OE-1 + OE-2 + OE-3 + OE-4 + OE-5 + OE-6 + OE-7 + OE-8 + OE-9 + OE-10** — complete deterministic offensive-ecology foundation using existing canonical signals + 8 operator-approved concept names). Phase ships under the established additive / probe-matrix-clean / 14-suite-regression-clean / governance-PASS discipline.

Doctrine to be cemented when shipping:
- **Offensive ecology doctrine** — favorable environments earn additive boosts symmetric to BC-4's HR-suppressing soft-demote; the curator REWARDS believable upside rather than only PUNISHING hostile environments.
- **Explosive-environment doctrine** — per-event aggregation tags games likely to detonate; tag is deterministic from canonical fields; observational only (never blocks).
- **Ladder survivability doctrine** — ladder targets respect canonical PA proxy + run environment + HR carry; soft demote when survivability factor low.
- **Stack reinforcement philosophy** — canonical `pairCorrelationScore +0.5` for same-team hitter overs is consumed (Phase 1B); positive same-game coherence rewards slip composition.
- **Believable upside doctrine** — every boost has a neutral fallback when canonical absent (anti-fabrication); boosts are small (3-5% caps); existing factors UNCHANGED.
- **Anti-chaos ticket philosophy** — under-dominance is a known structural skew; OE-1A addresses by REWARDING upside (not by hard-forcing overs or destroying unders); structural under-only overrides (TIER_TEMPLATES.balanced) deferred to Phase 1G after observation.
- **Canonical-authority-first** — same bridge pattern as MLB-Correlation-Engine-1A + Visual-Betting-Intelligence-1A + Bettor-Curation-Intelligence-1A; every signal reuses existing canonical authority modules; the curator composes, never duplicates.
- **Anti-fabrication-first** — every new concept maps to operator-approved deterministic vocabulary; no opaque ML; no GPT scores; no fake explosion narratives; no celebrity weighting; no invented confidence.
