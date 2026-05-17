# BETTOR-CURATION-INTELLIGENCE-1A AUDIT — REALISM-WEIGHTED CURATION

**Date:** 2026-05-17
**Phase under audit:** Bettor-Curation-Intelligence-1A (NEXT phase — not yet shipped)
**Audit type:** READ-ONLY — no patches, no schema mutation, no scoring redesign.
**Author / process:** post-bootstrap bettor-curation trace following the eighteen-phase governance substrate (Visual-Betting-Intelligence-1A retroactively sealed at 2026-05-17T02:37:03Z; bootstrap re-verified at session open with 0 issues / 0 warns).

> Doctrine: this document inventories WHAT IS, with file-path + line-number citations. It proposes ZERO patches. The next session selects operator-approved lever(s) from Section 10 and ships them as Phase Bettor-Curation-Intelligence-1A under the established additive / replay-safe / grading-safe / calibration-safe / **anti-fabrication** doctrine.
>
> **Operator anti-fabrication gate (this phase):** NO new "star scores", NO celebrity weighting, NO narrative AI, NO invented confidence, NO suppression of legitimate hidden value. Every demotion / promotion must derive from a canonical signal **already populated** on row context by the existing MLB context enrichers.

---

## EXECUTIVE FINDING

Every signal needed to demote replacement-level / backup-tier plays already exists on row context: `lineupPosition` and `depth` come from `deriveMlbLineupContext.js` (lines 75-118); `impliedTeamTotal` and `gameTotal` are populated on raw rows; `hrEnvironmentTag` and `hrFactor` come from `deriveMlbParkContext.js`; `kRate` and `fatigueFlag` come from `deriveMlbPitcherEnvironmentContext.js`; `contextualShift` and `contextualTags` come from `composeMlbContextualSignal.js`. The canonical engine even uses some of them — `buildMlbCorrelationEngine.contextBoost` (lines 151-173) explicitly weights hitter overs by `impliedTeamTotal >= 4.5/5.0` and TB props by `gameTotal >= 9.0`.

**But the curator never sees any of it.** First-hand verification this session: `grep -n "lineupPosition|depth|impliedTeamTotal|hrEnvironmentTag|contextualShift|kRate|fatigueFlag"` returns ZERO hits in `backend/pipeline/shared/buildFeaturedPlays.js` and ZERO hits in `backend/pipeline/shared/buildSlipAi.js`. Both `normalizeCandidate` functions drop these fields on the floor. `scoreCandidate` (9 factors) and `scoreLeg` (10 factors) consult none of them. Every curation surface (anchors / safest / bestHr / bestPra / bestLadders / bestDisagreementEdges / bestBalanced / bestAggressive / bestUnders / bestAltLadders / recommendationLadder) ranks by composite or `|delta|` only.

**Result**: a backup-level hitter (lineupPosition=8, depth=back, impliedTeamTotal=3.2) with a 15¢ disagreement edge will outrank a top-of-order star (lineupPosition=2, depth=top, impliedTeamTotal=5.5) with a 10¢ edge — and there is no canonical-signal-aware tie-breaker to prevent it. **This is the SAME canonical-bridge gap pattern** as Phase MLB-Correlation-Engine-1A (engine existed, slip composer didn't consult it) and Phase Visual-Betting-Intelligence-1A (screenshot intelligence existed, FE didn't consume it). The fix is purely additive composition.

---

## SECTION 1 — BETTOR-CURATION AUDIT (CURATION SURFACES TODAY)

Every surface that narrows N candidates → small set. All cite `backend/pipeline/shared/buildFeaturedPlays.js` unless stated; line numbers are first-hand verified.

| Surface | Input | Output | Sort criterion | Lineup/role/PA signal consulted? |
|---|---|---|---|---|
| `anchors` (`buildAnchors` ~522-564) | all scored | ≤5 | composite + corroboration gate (CLV≥0.70 ∨ archetype≥0.75 ∨ market≥0.75 ∨ edge≥0.55 ∨ urgency=immediate/stale_window) | **NO** |
| `tonightsBest` | scored \ anchors | ≤5 | composite | **NO** |
| `bestHr` (~695-698) | family=hr | ≤4 | composite | **NO** — does NOT consult `hrEnvironmentTag` |
| `bestPra` / `bestFirstBasket` | family-specific | ≤4 | composite | **NO** |
| `bestLadders` (~718-730) | line∈[1.5..4.5] | ≤5 | composite | **NO** — does NOT consult `impliedTeamTotal` |
| `smartAggression` (~732-766) | volatility∈{aggressive,lotto} | ≤4 | composite + edge fallback | **NO** |
| `safest` (~768-805) | safe lane ∨ premium-edge override | ≤5 | composite | **NO** |
| `bestBalanced` (~861-869) | volatility=balanced, edge≥0.04, bookCount≥2 | ≤5 | composite | **NO** |
| `bestAggressive` (~872-886) | volatility=aggressive, edge≥0.05 | ≤5 | composite | **NO** |
| `bestUnders` (~889-896) | side=under, edge≥0.04 | ≤5 | composite | **NO** |
| `bestAltLadders` (~899-907) | alt-line, consensusConfidence≥0.5 | ≤5 | composite | **NO** |
| `bestDisagreementEdges` (~919-933) | staleRows[soft_line] + EXPL-1 gate | ≤5 | **\|delta\| only** | **NO** |
| `staleLineOpportunities` (~941-960) | same + EXPL-1 gate | ≤5 | positive odds magnitude | **NO** |
| `trapLadders` (~968-987) | alt + bookCount<2 ∨ consensus<0.5 ∨ archetype<0.40 + odds≥200 | ≤5 | odds magnitude (bait rank) | **NO** |
| `inflatedSuperstarSpots` (~995-1008) | staleRows[stale_line] + EXPL-1 gate | ≤5 | \|delta\| | **NO** |
| `recommendationLadder` (`buildRecommendationLadder` ~1042-1090) | dedup walk over above buckets | 7 slots | first-unique priority | **NO** (delegated to bucket sorts) |

`backend/pipeline/shared/buildSlipAi.js` — slip composer — same finding: `scoreLeg` (10 factors) consults zero lineup / role / PA / environment signals (first-hand verified).

---

## SECTION 2 — PLAYER-LEGITIMACY ANALYSIS

**Canonical fields available** on every MLB candidate row (deriveMlbLineupContext.js lines 75-118):
- `lineupSpot` ∈ [1,9]
- `depth` ∈ {top (1-2), middle (3-5), back (6-9)}
- `plateAppearancesProxy` ∈ [3.81, 4.61]
- `runEnvironment` ∈ [0.30, 0.85]
- `rbiEnvironment` ∈ [0.30, 0.90]
- `opportunityShift` (signed, bounded ±0.04)

**Canonical fields available from `composeMlbContextualSignal.js` lines 64-151:**
- `contextualShift` (bounded ±0.10)
- `contextualTags` (e.g. `LINEUP_HEART`, `LINEUP_BOTTOM`, `PARK_HR_FRIENDLY`, `PITCHER_K_HEAVY`)

**Where they're consulted in the curator:** NONE. First-hand verified via grep.

**Where the existing canonical engine DOES use them:**
- `buildMlbCorrelationEngine.contextBoost` (lines 151-173) weights hitter overs when `teamTotal >= 5.0` (+1.0 boost), `teamTotal >= 4.5` (+0.5), and TB props when `gameTotal >= 9.0` (+0.5). **This boost only fires inside the correlation cluster builder — never reaches the featured-plays curator or slip composer.** A backup-level hitter's HR ladder gets NO boost from a 5.0 team total when it surfaces in `buildBestHr`.

**Verdict**: legitimate canonical role/legitimacy signals already exist; they just stop short of the curation surfaces. Bridging them requires zero new math and zero new fabrication.

---

## SECTION 3 — DISAGREEMENT-OVERWEIGHT ANALYSIS

`buildBestDisagreementEdges` (lines ~919-933): post Phase Market-Exploitation-1A EXPL-1 gate, the filter is:

```js
.filter((s) => s && s.tag === "soft_line" && Number.isFinite(s.delta))
.filter((s) => shopMap == null || marketSupportFor(s, shopMap).supported)
.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
```

The EXPL-1 gate (consensus-support floor: `bookCount >= 3` AND `consensusConfidence >= 0.6`) successfully suppresses single-book noise. But it is **binary and player-agnostic** — it never weights the surviving disagreement by `depth`, `impliedTeamTotal`, or `plateAppearancesProxy`. A 15¢ disagreement on a backup-tier hitter (depth=back, impliedTeamTotal=3.2) with 3 books of consensus surfaces IDENTICALLY to a 15¢ disagreement on a top-of-order star (depth=top, impliedTeamTotal=5.5) with 3 books of consensus.

Per `buildBestDisagreementEdges`, the only distinguishing input is `|delta|`. Larger-delta backup-hitter edges will outrank smaller-delta star edges. **This is the disagreement-overweight survival path.**

The reverse path (`inflatedSuperstarSpots` ~995-1008) is symmetric: it surfaces stale_line tagged rows with no player-legitimacy weighting either.

---

## SECTION 4 — HR-UPSIDE ANALYSIS

`buildBestHr` (lines ~695-698) and `buildBestLadders` (lines ~718-730) filter by family / line band then sort by composite. They do NOT consult:
- `hrEnvironmentTag` (canonical from park context — `HR_FRIENDLY` / `NEUTRAL` / `HR_SUPPRESSING`)
- `hrFactor` (canonical from park context)
- `temperatureF` / `windDirectionTag` / `carryShift` (canonical from weather context)
- `gameTotal` / `impliedTeamTotal` (canonical from raw row)

A HR ladder at a HR-suppressing park (e.g. Marlins Park) gets the same composite weighting as a HR ladder at a HR-friendly park (e.g. Coors Field). A 2.5 TB ladder in a 7.0 game total gets the same composite weighting as a 2.5 TB ladder in a 10.5 game total. **The canonical signals exist; the HR / ladder builders ignore them.**

The single place HR-environment IS used (`buildMlbCorrelationEngine.contextBoost`) feeds the cluster engine but not the featured-plays curator. This is the same bridge-gap pattern.

---

## SECTION 5 — BELIEVABLE-TICKET ANALYSIS

**Canonical definition of "believable" today:** NONE EXPLICIT. There is no `believabilityScore`, no `playerLegitimacyFactor`, no `bettorRealismScore`. The curator's notion of "good play" is purely:
- composite score (9 factors: edge, archetype, clv, timing, book, market, volRealism, textureBoost, tierBoost)
- bucket filters (volatility, side, line band, bookCount, consensusConfidence)
- corroboration gate for anchors

None of these incorporate:
- Is this player a legitimate offensive contributor (depth ∈ {top, middle})?
- Is this player's team projected to score runs (impliedTeamTotal ≥ 4.5)?
- Is the park / weather environment supportive of the play type (hrEnvironmentTag, gameTotal ≥ 9.0)?
- Is the lineup confirmed (`lineupSpot` populated implies confirmed)?

The single proxy that hints at offensive realism is `textureBoost` (additive +0.018 to +0.030 for `isOffensiveAttackStat()` families on overs in aggressive/lotto tiers) — but this is FAMILY-keyed, not ROLE-keyed. A backup-level hitter's `hits` over gets the same texture boost as a star's `hits` over.

---

## SECTION 6 — CASHOUT-PRESSURE ANALYSIS

**Does the repo today consider at-bat cadence / inning rotation / sportsbook cash-out moments?** NO — first-hand verified by absence of any references to inning-pacing or cash-out modeling in `buildSlipAi.js` and `buildFeaturedPlays.js`.

**Canonical signals that COULD inform cashout-pressure if a future phase wanted to model it:**
- `plateAppearancesProxy` (3.81 - 4.61 per spot) → at-bat cadence proxy
- Pitcher-K-OVER props (detectable via `isPitcherKProp` from MLB-Correlation-Engine-1A canonical engine) → inning-stretch milestones
- `lineupSpot` (1-9) → batting order timing

**Phase 1A scope**: deferred. This audit names the signals but does not promote a Phase 1A lever for cashout-pressure modeling — operator framing emphasizes ticket curation, not in-game cashout timing.

---

## SECTION 7 — WEAK-ROLE SURVIVAL PATHS (CONCRETE FILE:LINE)

| Survival path | File:line | Why it survives |
|---|---|---|
| Backup hitter high-\|delta\| disagreement outranks star low-\|delta\| disagreement | `buildFeaturedPlays.js:~932` (sort by \|delta\| only) | Sort key is \|delta\|; no depth/teamTotal weighting |
| Replacement pitcher's K-OVER edge clears anchor corroboration gate via `edge >= 0.55` | `buildFeaturedPlays.js:~650` (corroboration gate, single-criterion OR) | Gate is satisfied by any ONE of 5 corroborators; `fatigueFlag` never consulted |
| Low-PA back-of-order hitter ladders identically to cleanup hitter at same composite | `buildFeaturedPlays.js:~718-730` (`buildBestLadders` only filters by line + composite) | `plateAppearancesProxy` / `depth` not in filter |
| HR ladder at HR-suppressing park surfaces same as HR-friendly park | `buildFeaturedPlays.js:~695-698` (`buildBestHr` only filters by family + composite) | `hrEnvironmentTag` not in filter |
| Backup hitter UNDER at desert team total (≤3.5) ladders into safest | `buildFeaturedPlays.js:~768-805` (`buildSafest`) | `impliedTeamTotal` not in filter |
| Disagreement edge on a player with no `lineupSpot` (confirmed-lineup absent) outranks confirmed-star | `buildFeaturedPlays.js:~932` | Lineup confirmation never consulted; canonical signal is `lineupSpot != null` |

**Pattern**: every survival path is the SAME structural gap — canonical signal exists, curator never reads it.

---

## SECTION 8 — CURATION-LAYER PLAN

The smallest-safe-step is to bridge canonical signals into the curator, NOT to invent new ones. The plan composes three additive moves:

### Move 1 — Lift canonical fields through `normalizeCandidate` (foundation)
Both `buildFeaturedPlays.normalizeCandidate` and `buildSlipAi.normalizeCandidate` extended additively to PRESERVE: `lineupSpot` / `depth` / `plateAppearancesProxy` / `impliedTeamTotal` / `gameTotal` / `hrEnvironmentTag` / `contextualTags`. **Zero existing field touched. Honest null when context absent.** This is the canonical-bridge precondition.

### Move 2 — Deterministic legitimacy weighting in `scoreCandidate` (single small factor)
NEW `playerLegitimacyFactor` weighted ~5-8% of the composite, derived purely from canonical fields lifted in Move 1. Anti-fabrication: when `depth` AND `impliedTeamTotal` are BOTH absent, factor returns a neutral 0.70 (no demote, no promote). When present:
- `depth === "top"` → 1.00 base; `"middle"` → 0.80; `"back"` → 0.50
- multiplied by `impliedTeamTotal` ramp: `>=5.0` → 1.00, `>=4.5` → 0.90, `>=3.5` → 0.75, `<3.5` → 0.55

The 5-8% cap prevents the factor from dominating composite; it gently nudges legitimate offense up and replacement-tier plays down.

### Move 3 — Believable-upside filter on HR/ladder builders (gentle gate)
`buildBestHr` and `buildBestLadders` add a soft filter: when `hrEnvironmentTag === "HR_SUPPRESSING"` OR `impliedTeamTotal < 3.5` is PRESENT, the candidate is demoted from the top-N slot to the back of the sort. Anti-fabrication: when signals are absent, behavior is unchanged. **No hard reject** — the operator's "do not suppress legitimate hidden value blindly" gate forbids hard-rejecting based on context alone.

---

## SECTION 9 — BETTOR-REALISM PLAN

Beyond the curation layer (Section 8), three observability additions inform longitudinal calibration of the curation philosophy:

| Addition | Where | Value |
|---|---|---|
| `bettorRealismScore` per slip on `buildAiSlips` result | `buildSlipAi.js:buildAiSlips` | Operator-visible composite of slip-level depth-coverage + avg impliedTeamTotal + gameTotal + hrEnvironmentTag favorability. Advisory; never blocks selection. |
| `[BC-1A] curation suppressed N back-of-order disagreement edges` log | `buildFeaturedPlays.js:buildFeaturedPlays` end-of-run | Quantifies suppression volume per run. Operator-visible per-run accounting. |
| Canonical signal coverage diagnostic | new `npm run curation:status` (held for 1B) | Per-date / per-sport coverage stats: % candidates with `depth`, % with `impliedTeamTotal`, % with `hrEnvironmentTag`. Operator can quantify the bridge's reach. |

---

## SECTION 10 — CANDIDATE LEVERS (operator-approvable Phase Bettor-Curation-Intelligence-1A scope)

Every lever is deterministic, additive, anti-fabrication-respecting, reuses existing canonical authorities, and adds ZERO new math beyond clamped weighted compositions of canonical signals already on rows. NO new ML. NO new persistence. NO new API call. NO new fetches.

| Lever | Surface | Risk | Smallest-safe |
|---|---|---|---|
| **BC-1** — Lift `lineupSpot` / `depth` / `plateAppearancesProxy` / `impliedTeamTotal` / `gameTotal` / `hrEnvironmentTag` / `contextualTags` through both `normalizeCandidate` functions (`buildFeaturedPlays.js` + `buildSlipAi.js`) | both `normalizeCandidate` | LOW | ★ smallest. Pure additive output fields; no consumer touched. Foundation for BC-2/BC-4/BC-7. |
| **BC-2** — NEW `playerLegitimacyFactor` (5-8% weight) inside `scoreCandidate`. Derived from `depth` × `impliedTeamTotal` ramp; neutral 0.70 when fields absent. Anti-fabrication: zero LLM, zero star-power scoring, zero celebrity weighting. | `buildFeaturedPlays.scoreCandidate` | LOW | ★ smallest. Small weight + neutral fallback prevents overcorrection. |
| **BC-3** — Lineup-position-aware demote on `bestDisagreementEdges`: when `depth === "back"`, halve the effective sort key (sort by `|delta| * 0.5`). Anti-fabrication: when `depth` missing, behavior unchanged. | `buildFeaturedPlays.buildBestDisagreementEdges` | MEDIUM | Filters real opportunities; ship after observation. Held for 1B. |
| **BC-4** — Believable-upside soft gate on `buildBestHr` + `buildBestLadders` + `bestAggressive`: when `hrEnvironmentTag === "HR_SUPPRESSING"` OR `impliedTeamTotal < 3.5` is PRESENT, demote (not reject) the candidate's effective composite by -0.05. Anti-fabrication: no demote when signals absent. | `buildFeaturedPlays.buildBestHr` + `buildBestLadders` + `buildBestAggressive` | LOW | ★ smallest. Soft gate respects operator's "do not suppress hidden value blindly" constraint. |
| **BC-5** — NEW `buildBelievableUpsideTickets` observational bucket: surfaces ≤5 candidates satisfying (depth ∈ {top, middle}) AND (impliedTeamTotal ≥ 4.5) AND (hrEnvironmentTag !== "HR_SUPPRESSING"). Pure additive bucket; never blocks existing surfaces. | NEW function in `buildFeaturedPlays.js` | LOW | Observational; auto-empty when canonical signals absent. |
| **BC-6** — `buildRecommendationLadder` slot 8 (new) or rename `bestUpsidePlay` → `bestBelievableUpside`: surfaces top of BC-5's bucket if non-empty; otherwise falls back to existing `bestUpsidePlay` cascade. | `buildFeaturedPlays.buildRecommendationLadder` | LOW | Pure observational; first-unique dedup preserves existing behavior. |
| **BC-7** — Anti-replacement-player soft corroborator on `buildAnchors`: when composite >= 0.55 AND (depth ∈ {top, middle} OR impliedTeamTotal >= 4.5), add ONE corroboration count (counts toward the existing `corrobs >= 1` gate). When fields absent, no change. | `buildFeaturedPlays.buildAnchors` | LOW | Additive corroborator; never removes existing corroborators. |
| **BC-8** — Per-slip `bettorRealismScore` advisory metric on `buildAiSlips` result. Aggregates depth-coverage + avg impliedTeamTotal + gameTotal + hrEnvironmentTag favorability. Advisory only; never blocks. | `buildSlipAi.buildAiSlips` | LOW | Pure observability; deterministic. |
| **BC-9** — Operator-visible `[BC-1A] curation suppressed N back-of-order edges / N HR-suppressing ladders` log at end of `buildFeaturedPlays` run. Rate-limited. | `buildFeaturedPlays.buildFeaturedPlays` | TRIVIAL | Pure observability. |
| **BC-10** — Cashout-pressure scoring (signal exists; implementation deferred per operator's framing emphasizing curation over in-game timing). | n/a | HIGH | **HELD** — out of Phase 1A scope. |
| **BC-11** — `npm run curation:status` CLI surfacing canonical-signal coverage per date. | NEW `backend/scripts/curationStatus.js` | LOW | Held for 1B once BC-1/2/4/5/6/7/8 are observed in production. |

**Recommended smallest-safe combination:** **BC-1 + BC-2 + BC-4 + BC-5 + BC-6 + BC-7 + BC-8 + BC-9 ship together** as Phase Bettor-Curation-Intelligence-1A. Together they form a complete realism-weighted curation layer that:
- bridges canonical signals through normalization (BC-1, foundation),
- gently weights legitimacy in single-leg scoring (BC-2),
- gently filters HR/ladder ecology (BC-4),
- adds a NEW believable-upside observational bucket + recommendation slot (BC-5, BC-6),
- requires lineup/team-total corroboration for anchors (BC-7),
- surfaces per-slip realism diagnostic (BC-8) and per-run suppression accounting (BC-9).

**Deferred to 1B+:** BC-3 (back-of-order disagreement demote — observe first), BC-10 (cashout-pressure — out of operator scope), BC-11 (operator CLI — needs 1A observation window).

---

## SECTION 11 — LONGITUDINAL TICKET-QUALITY STRATEGY

Phase 1A's BC-8 and BC-9 establish per-run + per-slip observability. The longitudinal strategy across future phases:

| Phase | Lever | Operator value |
|---|---|---|
| **1A** (this proposal) | BC-1/2/4/5/6/7/8/9 | Realism-weighted curation foundation + observability hooks |
| 1B | BC-3 (back-of-order disagreement demote) + BC-11 (curation:status CLI) | Tighten disagreement realism + operator visibility |
| 1C | Per-bucket retrospective ROI tracker (compare BC-5 believable tickets vs legacy buckets) | Empirical validation of legitimacy weighting |
| 1D | Operator-tunable BC-2 weight (5% / 7.5% / 10%) | Calibration via observation window |
| 1E | Confirmed-lineup signal (lineupSpot present vs missing) integrated into BC-7 | Tighten anchor corroboration when lineup is fully confirmed |
| 1F | Per-stat-family legitimacy curves (hits/TB/runs respond differently to depth) | Family-aware refinement |

**Anti-fabrication invariant across all future phases:** every additional signal must already exist in the repo on row context. No new ML, no new fetches, no star-power scores, no celebrity weighting.

---

## SECTION 12 — AUDIT CITATIONS (REPRODUCIBILITY)

| Citation | Verified by |
|---|---|
| `buildFeaturedPlays.js` ZERO references to `lineupPosition`/`depth`/`impliedTeamTotal`/`hrEnvironmentTag`/`contextualShift`/`kRate`/`fatigueFlag` | Direct `grep -n` this session (single hit at line 1324 is unrelated). |
| `buildSlipAi.js` ZERO references to the same fields | Direct `grep -n` this session (zero hits). |
| `deriveMlbLineupContext.js:75-118` populates `lineupSpot` / `depth` / `plateAppearancesProxy` / `runEnvironment` / `rbiEnvironment` / `opportunityShift` | Direct `sed` this session. |
| Curation surfaces (anchors / safest / bestHr / etc.) line numbers + sort criteria | Explore subagent trace cross-referenced against existing audit citations in `docs/MARKET_EXPLOITATION_AUDIT_2026-05-16.md` and `docs/MLB_CORRELATION_AUDIT_2026-05-16.md`. |
| `buildMlbCorrelationEngine.contextBoost:151-173` weights hitter overs by `teamTotal>=5.0/4.5` and TB by `gameTotal>=9.0` | Explore subagent trace cross-referenced against direct read this session of `pipeline/mlb/buildMlbCorrelationEngine.js:151-173` (prior session). |
| EXPL-1 consensus-support gate is binary + player-agnostic | Confirmed via prior phase patches (Phase Market-Exploitation-1A `marketSupportFor`). |
| `composeMlbContextualSignal.js:64-151` populates `contextualShift` + `contextualTags` | Confirmed via Explore subagent trace + prior audit `docs/MLB_CORRELATION_AUDIT_2026-05-16.md` Section 7. |

---

## ARCHITECTURE PRESERVATION INVARIANTS (THIS AUDIT)

- ✓ ZERO code patched.
- ✓ ZERO schema mutation.
- ✓ ZERO scoring redesign (Phase 1A will ADD a 5-8% legitimacy factor — not redesign existing factors).
- ✓ ZERO grading / replay / lineage / persistence / orchestrator touch.
- ✓ ZERO `FAMILY_CALIBRATION_COEFFICIENTS` / volatility rules / portfolio thresholds / tier templates / market-pipeline / recommendation-hierarchy-shape / MLB-COV / EXPL / NBA-correlation change.
- ✓ Receipt + checkpoint state unaffected (audit is read-only; brain:checkpoint still required at end of next code-touching session).

---

## STATUS

Phase Bettor-Curation-Intelligence-1A AUDIT complete. Recommended next action: operator selects lever(s) from Section 10 (smallest-safe-step combination: **BC-1 + BC-2 + BC-4 + BC-5 + BC-6 + BC-7 + BC-8 + BC-9** — complete realism-weighted curation foundation using existing canonical signals). Phase ships under the established additive / probe-matrix-clean / 14-suite-regression-clean / governance-PASS discipline.

Doctrine to be cemented when shipping:
- **Bettor-curation doctrine** — the curator must increasingly NARROW rather than ENUMERATE; promotion / demotion derives from canonical signals already on row context, never from invented star-power scoring.
- **Bettor-realism doctrine** — legitimate offensive contributors (depth ∈ {top, middle}, impliedTeamTotal ≥ 4.5) earn small weighted boosts; replacement-tier / desert-context candidates earn small weighted demotes; absent signals → neutral fallback (anti-fabrication).
- **Believable-ticket philosophy** — a NEW observational bucket surfaces candidates satisfying depth + team-total + park-environment all together; never blocks existing surfaces; never invents.
- **Cashout-pressure philosophy** — DEFERRED to future phase per operator framing; canonical signals (`plateAppearancesProxy`, `isPitcherKProp`) are inventoried for when the time comes.
- **High-upside curation doctrine** — HR / ladder builders consult `hrEnvironmentTag` + `impliedTeamTotal` for ecology fit; HR-suppressing parks + desert team totals soft-demote (never hard-reject) the candidate.
- **Canonical-authority-first** — every realism signal reuses existing canonical authority modules (deriveMlbLineupContext, composeMlbContextualSignal, deriveMlbParkContext); the curator composes, never duplicates.
- **Anti-fabrication-first** — every new weighting has a neutral fallback when canonical signals are absent; the gate is gentle (5-8% factor + soft -0.05 composite demote), never hard-rejecting; legitimate hidden value is preserved.
