# MLB-CORRELATION-ENGINE-1A AUDIT — DETERMINISTIC COVARIANCE INTELLIGENCE

**Date:** 2026-05-16
**Phase under audit:** MLB-Correlation-Engine-1A (NEXT phase — not yet shipped)
**Audit type:** READ-ONLY — no patches, no schema mutation, no scoring redesign.
**Author / process:** post-bootstrap MLB correlation trace following the fifteen-phase governance substrate (Market-Exploitation-1A checkpoint sealed at 2026-05-16T08:58:40Z; bootstrap PASS at 09:02:45Z with 0 issues / 0 warns).

> Doctrine: this document inventories WHAT IS, with file-path + line-number citations and one real graded losing parlay as empirical anchor. It proposes ZERO patches. The next session selects operator-approved lever(s) from Section 11 and ships them as Phase MLB-Correlation-Engine-1A under the established additive / replay-safe / grading-safe / calibration-safe doctrine.

---

## EXECUTIVE FINDING

MLB multi-leg construction is structurally INDEPENDENT-LEG intelligence. The slip composer (`backend/pipeline/shared/buildSlipAi.js`) lazy-loads `nbaCorrelationEngine` for NBA only; for MLB it multiplies leg `modelProb`s and applies a static `FAMILY_CALIBRATION_COEFFICIENTS` table — no game-script awareness, no shared-pitcher awareness, no weather amplification at composition time, no linked-stat-family penalty. The one MLB anti-correlation guard that exists (`canAddLeg()` script_correlation rule at line 522-527) fires on `side === "over"` same-game pairs in 2-3 leg slips only — it does NOT distinguish pitcher legs from hitter legs, allows the symmetric case (pitcher UNDER K + opposing hitter OVER hits — strong negative correlation) through unblocked, and is bypassed by LOTTO (5-leg) tier.

Most damaging: **the authors already encoded MLB correlation knowledge** in `backend/pipeline/mlb/buildMlbCorrelationEngine.js:117-128` (pitcher-K vs hitter-counting opposing-team scored at -1.0; same-team at -0.5). That engine fires inside the cluster/HR-stack path, NOT inside the workstation slip composer. The intelligence exists in the repo and is unused at the surface that matters most for operator-visible parlay survivability.

**Empirical anchor (real graded loss):** `runtime/tracking/mlb_tracked_slips_2026-05-15.json` contains a SAFE-tier 2-leg slip with `ev=+0.7086, edge=+0.1804` (the model genuinely liked it) that lost: Vargas UNDER 1.5 hits + Goodman UNDER 1.5 hits, both ARI@COL — at Coors Field, one of the highest-run environments in MLB. Two same-game UNDER-hits legs treated as independent when they share a single ecological event (the opposing pitcher's day). Both legs busted together. Section 5 details the gap.

---

## SECTION 1 — MLB CANDIDATE SHAPE TODAY

**Canonical owner of normalization:** `backend/pipeline/shared/buildSlipAi.js:122-166` (`normalizeCandidate`).

| Field today | Source | Useful for correlation? |
|---|---|---|
| `eventId`, `matchup` | `buildMlbBootstrapSnapshot.js` rows | YES — primary game key |
| `team` | row | YES — same-team / opposing-team logic |
| `statFamily`, `side`, `line`, `odds`, `book` | row | YES — combination semantics |
| `modelProb`, `confidence`, `tier`, `volatility` | scorers + tier classifier | NO direct cov; influences independent-leg score only |
| `playerStatus`, `availabilityContext` | NEW (Phase Market-Exploitation-1A) | Not correlation-relevant |

**Fields populated on raw rows by MLB context layers BUT NOT carried into `normalizeCandidate`:**

| Field | Where it lives today | Why it matters |
|---|---|---|
| `opposingPitcher` (id + name) | `pipeline/mlb/context/deriveMlbPitcherEnvironmentContext.js:88-95` | Required for pitcher-K vs hitter-hits antagonism |
| `gameTotal`, `impliedTeamTotal` | `buildMlbBootstrapSnapshot.js:152-153` (raw row) | HR clustering trigger; bullpen-collapse ecology |
| `temperatureF`, `windSpeedMph`, `windDirectionTag`, `carryShift` | `pipeline/mlb/context/deriveMlbWeatherContext.js` | HR amplification |
| `parkName`, `hrFactor`, `hrEnvironmentTag` | `deriveMlbParkContext.js:53-78` | Coors / Yankee / Camden HR factor |
| `lineupPosition`, `depth` ("top"/"middle"/"back"), `rbiEnvironment` | `deriveMlbLineupContext.js:75-116` | Top-of-order stack penalty cascade |
| `bullpenShift`, `reliefFatigueScore` | `deriveMlbBullpenContext.js` (Phase 1B; dormant) | Bullpen-collapse positive cov |
| `mlbContextualShift`, `contextualTags`, `contextualSignal` | `composeMlbContextualSignal.js:64-151` | Composed observability — not consumed by slip composer |

**Verdict:** Every signal the audit needs to reason about correlation is ALREADY populated upstream on rows. The choke point is `buildSlipAi.js:122-166 normalizeCandidate` — additive lifts of these fields would unlock all six levers in Section 11 with zero new fetches.

---

## SECTION 2 — SAME-GAME HANDLING TODAY (canAddLeg)

Canonical owner: `backend/pipeline/shared/buildSlipAi.js:491-529`.

Exact predicate (lines 522-527):

```js
if (gk && candidate.side === "over" && !tpl.skipScriptCorrelation) {
  const overSameGame = slipLegs.filter((l) => gameKey(l) === gk && l.side === "over").length
  if (overSameGame >= 1 && tpl.legCountRange[1] <= 3) {
    return { ok: false, reason: "script_correlation" }
  }
}
```

**What this BLOCKS:**
- 2nd OVER leg from the same game when slip max-legs ≤ 3 (SAFE / BALANCED / AGGRESSIVE).
- Only when `candidate.side === "over"`.
- Only when `skipScriptCorrelation` is NOT set on the tier template (NBA sets it true; MLB tiers do not).

**What this FAILS to block:**

1. **LOTTO tier (5-leg) — bypass.** `legCountRange[1] <= 3` is false, so the rule short-circuits. `TIER_TEMPLATES.lotto.maxPerGame = 2` allows two same-game OVERs without script-correlation enforcement.
2. **Pitcher UNDER K + opposing hitter OVER hits (same game).** Pitcher leg is `side === "under"`. Rule looks for `overSameGame >= 1` in already-added legs — the pitcher UNDER doesn't count. Hitter OVER passes. NEGATIVE covariance (weak pitcher → more hits across the board) ignored.
3. **Pitcher OVER K + opposing hitter UNDER hits (same game).** Symmetric of #2 — both legs benefit from the same ecological event (pitcher dominance), POSITIVE covariance, but the rule does not surface it as a positive reinforcement nor a stack penalty.
4. **Same-team multi-batter UNDER stack (same game).** All legs are `side === "under"`, rule does not match. Three Diamondbacks batters UNDER hits at Coors → allowed as if independent (the very pattern that lost the 2026-05-15 graded slip).
5. **Two HR-or-more legs same game.** AGGRESSIVE `maxPerGame=1` blocks (good for naive cases), but LOTTO `maxPerGame=2` allows. Even in the allowed case, no high-game-total weighting is applied — HR clustering in a 9.5+ total game is real positive cov.
6. **Same player + linked-stat-family pair.** Hits OVER + Total Bases OVER on the same batter. Different `statFamily`, so `maxPerStat` is satisfied. `combineLegs()` multiplies as if independent. TB is a superset of hits — the true joint is much closer to `min(p_hits, p_tb)` than `p_hits × p_tb`.

---

## SECTION 3 — CORRELATION ENGINE SHAPE (NBA AS TEMPLATE)

Canonical owner: `backend/pipeline/nba/nbaCorrelationEngine.js`.

| Export | Returns | Doctrine |
|---|---|---|
| `linkedStatFamilies(fa, fb)` | bool | Hardcoded NBA links: points↔assists, points↔threes, PRA-family co-movement. |
| `buildEventMetaMap(candidates)` | `Map<eventId, { pace, total, maxUsage }>` | One pass over candidate pool aggregating per-event metadata. |
| `pairwiseStackBoost(legA, legB, eventMeta)` | `[0, 0.38]` | Same-game / same-team / linked-stat / pace / total boost. Outer cap 0.38. |
| `jointProbabilityWithCorrelation(legs, eventMeta)` | `{ joint, pairBoostAvg, rawProduct }` | `joint = rawProduct × (1 + 0.22 × pairBoostAvg)`. |
| `nbaCorrelationSortBonus(leg, peerLegs, eventMeta)` | `[0, 0.04]` | Tie-breaker only; capped tiny. |

**Design guardrail (`nbaCorrelationEngine.js:18-22`):**

> Correlation boost is a TIE-BREAKER only … existing diversification hard limits (maxPerGame, maxPerStat, maxPerPlayer, canAddLeg) are NOT relaxed by this module. Same-game spam cannot result from correlation scoring alone.

**Boost components (`pairwiseStackBoost` lines 158-169):** same-team points+assists (+0.14), points+threes (+0.10), PRA-high-usage (+0.09), pace ≥ 102 (+0.07), generic linked family (+0.05), outer cap 0.38.

**For Phase MLB-Correlation-Engine-1A this is the SHAPE template** — NOT the values. NBA pace/usage/PRA semantics do not transfer to MLB. The MLB engine must use MLB-native concepts (game total, opposing pitcher, lineup depth, park HR factor, wind direction). The reusable architecture is: pure module, eventMeta one-pass aggregator, pairwise scoring function, joint-probability multiplier with outer cap, anti-fabrication on missing fields, "tie-breaker only — never relax canAddLeg" doctrine.

---

## SECTION 4 — WHERE COVARIANCE IS MISSED (FIVE CONCRETE MLB CASES)

Each case below describes legs that pass `canAddLeg()` today + `combineLegs()` treats as independent today. Citations to the exact line where independence is assumed.

### 4.1 — Same-team same-game hitter OVER stack (positive cov)

- **Pattern:** Player A OVER 1.5 hits + Player B OVER 1.5 hits, same team, same game, opposing pitcher ERA 5.5+.
- **Truth:** Single ecological event (pitcher meltdown). Both legs share the same outcome driver.
- **Today:** `script_correlation` rule (line 522-527) fires for 2-3 leg slips (good). LOTTO 5-leg bypasses (gap). Even in 2-3 leg slips, there is no POSITIVE recognition that the legs reinforce each other beneficially (the right move is "stack here is GOOD because pitcher is bad, NOT independent").
- **File:line:** `buildSlipAi.js:522-527`, `:409` (LOTTO template).

### 4.2 — Pitcher OVER K + opposing hitter UNDER hits (positive cov — reinforcement)

- **Pattern:** Pitcher dominant K day → fewer balls in play → opposing hitters under their counting totals.
- **Truth:** Positive co-movement; both legs are bets on the same pitcher dominance event.
- **Today:** Rule operates on `side === "over"` only. Pitcher OVER + hitter UNDER — different sides — never even evaluated.
- **File:line:** `buildSlipAi.js:522`. `normalizeCandidate` doesn't carry `opposingPitcher` (proof: lines 122-166 contain no opposingPitcher reference; field exists on raw rows per `deriveMlbPitcherEnvironmentContext.js:88-95`).

### 4.3 — Hits + Total Bases same player (already-linked stat families)

- **Pattern:** Same batter OVER 1.5 hits + OVER 2.5 total bases.
- **Truth:** TB ⊇ hits (every hit is ≥1 TB). True joint is closer to `min(p, p)` than `p × p`.
- **Today:** `canAddLeg` line 504-505 (`maxPerStat`) allows the pair. `combineLegs` line 546 multiplies `modelProb × familyCoeff` per leg independently. No linked-stat-family map exists for MLB.
- **File:line:** `buildSlipAi.js:504-505, 546`. Static coefficients live at `:54-72` (`FAMILY_CALIBRATION_COEFFICIENTS`).

### 4.4 — Two HR-or-more legs in high-total game (positive cov, HR clustering)

- **Pattern:** Player A HR or More + Player B HR or More, same game, `gameTotal ≥ 9.5`.
- **Truth:** HR clustering in run-heavy games is well-documented; weather (carry wind), park HR factor, opposing pitcher fragility all drive multi-HR games.
- **Today:** `normalizeCandidate` doesn't carry `gameTotal` (field exists on raw rows per `buildMlbBootstrapSnapshot.js:152-153` — never lifted). LOTTO tier `maxPerGame=2` allows the pair without environment-amplified weighting.
- **File:line:** `buildSlipAi.js:122-166 normalizeCandidate`; `buildMlbBootstrapSnapshot.js:152-153`.

### 4.5 — Pitcher UNDER K + opposing hitter OVER hits (NEGATIVE cov — anti-correlation)

- **Pattern:** Pitcher weak K day → more contact → more hits for opposing hitters.
- **Truth:** Both legs depend on opposite predictions of the same event (pitcher quality). They cannot both be right unless the model is extracting strictly different information.
- **Today:** Rule at line 522 does not block — pitcher leg is UNDER, doesn't satisfy `side === "over"`. Both legs allowed. `combineLegs` multiplies independently.
- **File:line:** `buildSlipAi.js:522-527, 533-562`.

**Critical adjacent finding:** `backend/pipeline/mlb/buildMlbCorrelationEngine.js:117-128` already implements this exact rule for CLUSTERS (scoring `-1.0` for opposing-team pitcher-K vs hitter-counting overs, `-0.5` same-team). The authors KNOW. The engine is not consulted by `buildSlipAi.js`.

---

## SECTION 5 — EMPIRICAL ANCHOR (REAL GRADED LOSING PARLAY)

`runtime/tracking/mlb_tracked_slips_2026-05-15.json` — one SAFE-tier 2-leg same-game loss:

```
type: SAFE  legCount: 2  result: loss  ev: +0.7086  edge: +0.1804
  leg 1: Ildemaro Vargas under 1.5  (ARI @ COL)  result: loss
  leg 2: Hunter Goodman under 1.5   (ARI @ COL)  result: loss
```

**Why the model loved it independently:** each leg presumably had a defensible single-leg modelProb (batter projections suggest both under 1.5 hits).

**Why both lost together (the gap MLB-Correlation-Engine-1A must close):** Coors Field. One of the highest-run environments in MLB. The two UNDER-hits legs depend on the same ecological event (a quiet game at Coors — rare). They are NOT independent. The graded outcome confirms: both went OVER 1.5 hits.

**Today's defense against this slip:** none. `script_correlation` (line 522-527) does not fire because both legs are `side === "under"`. `maxPerGame` allows 1+ legs/game in SAFE tier. No park/weather/run-environment awareness reaches the composer.

**Population sweep:** of the last 5 mlb_tracked_slips files (10 files total, 129 slips, 29 losses), only this one slip is a clean ≥2-leg single-game loss with full leg detail under the current tracking schema. This is a small empirical sample — the proper longitudinal test is "after MLB-COV-5 ships, does the same-team-UNDER-stack loss rate drop?" (Section 12).

---

## SECTION 6 — HR-CLUSTER ANALYSIS

Search of `buildSlipAi.js` for `hr_cluster`, `gameTotal`, `runEnv`, `weatherAmplification`: **NOT FOUND**.

Available but unused:
- `buildMlbBootstrapSnapshot.js:152-153` — `gameTotal` on raw rows.
- `buildMlbCorrelationEngine.js:114-173` — `pairCorrelationScore()` consults `gameTotal` and `impliedTeamTotal` for cluster-side hitter stacks; applies `contextBoost()` when `gameTotal >= 9.0` for TB overs. **Cluster path only — not slip path.**
- `composeMlbContextualSignal.js:25-30` — HR-prop weighting table prefers weather (0.45) + park (0.40). Affects single-leg `mlbContextualShift`; not consulted in `buildSlipAi.combineLegs()`.

**Verdict:** Same-game high-total HR clustering is unrecognized inside the slip composer. The intelligence exists in the cluster engine; it is not bridged.

---

## SECTION 7 — PITCHER / HITTER CONFLICT ANALYSIS

Today's behavior (verified from earlier in this section):
- `canAddLeg()` has NO role-awareness. It does not distinguish a pitcher prop from a hitter prop.
- It does not know that pitcher K and opposing-team hits are bets on the same opposing-pitcher's-day variable.
- The script_correlation rule's `side === "over"` predicate captures the most-toxic symmetric case (both overs same game in 2-3 leg slip) — but misses both asymmetric anti-correlations (pitcher UNDER + hitter OVER; pitcher OVER + hitter UNDER) and misses LOTTO entirely.

The audit's grep confirms `buildMlbCorrelationEngine.js:117-128` is the only file in the repo that already encodes pitcher-K vs hitter-counting anti-correlation. It needs to be either (a) extracted into a shared helper that `buildSlipAi.canAddLeg` can consult, or (b) mirrored as a smaller hard-block rule in `canAddLeg` itself. The smallest-safe-step is (b) — see MLB-COV-2 in Section 11.

---

## SECTION 8 — WEATHER / VOLATILITY ANALYSIS

Where weather lives today:
- `pipeline/mlb/context/deriveMlbWeatherContext.js` populates `temperatureF`, `windSpeedMph`, `windDirectionTag` ("out_to_cf" / "in_from_cf"), `carryShift` on raw rows.
- `composeMlbContextualSignal.js:64-151` produces a bounded `mlbContextualShift` (±0.10) + `contextualTags` (e.g. `WIND_OUT`).

Where weather is CONSULTED today:
- Single-leg modelProb path inside MLB scorers (composed shift applied at row level).
- Volatility tier classification (indirectly via shifts impacting confidence).

Where weather is NOT consulted today:
- `buildSlipAi.js:173-290 scoreLeg()` — the nine listed factors are projection / CLV / timing / book / volatility / archetype / ladder / diversification / tier-boost. No weather.
- `buildSlipAi.js:491-529 canAddLeg()` — no weather predicate.
- `buildSlipAi.js:533-562 combineLegs()` — pure odds×modelProb math.

**Verdict:** Weather is a single-leg signal today; it never reinforces a multi-leg combination. A wind-out + 9.5-total game does not boost two same-game HR legs in MLB; the same fact pattern boosts each leg independently and then they are multiplied as if uncorrelated.

---

## SECTION 9 — ANTI-CORRELATION SURVIVAL PATHS

Three concrete code paths where today's MLB slip will surface anti-correlated legs:

1. **Pitcher UNDER strikeouts + opposing hitter OVER hits (same game).** `buildSlipAi.js:522` — rule only fires for `side === "over"`.
2. **Pitcher OVER strikeouts + opposing hitter UNDER hits (same game).** Symmetric. The pair is actually POSITIVE cov (both bet on pitcher dominance), so the failure mode is missed reinforcement rather than missed antagonism — but the symmetric mishandling proves the rule's role-blindness.
3. **Two batter UNDER legs same team same game at HR-friendly park.** `script_correlation` rule predicate fails (both unders); `maxPerGame` allows it; no park-amplification awareness. The 2026-05-15 Coors loss above is exactly this path.

---

## SECTION 10 — COVARIANCE STRUCTURES THE REPO SHOULD REWARD

Symmetric inventory — positive cov that today is left on the table:

1. **Pitcher OVER K + opposing hitter UNDER hits (same game).** Both legs bet on the same pitcher's dominant day. Joint prob should be ABOVE the naive product. Today: multiplied independently.
2. **Same-team multi-batter OVER hits when opposing pitcher's ERA ≥ 5.5 (same game).** The pitcher meltdown is one event; the lineup as a whole benefits. Joint prob above naive product. Today: blocked entirely by script_correlation in 2-3 leg tiers; allowed in LOTTO with no amplification.
3. **Two HR legs same game when game total ≥ 9.5 AND wind-out AND HR-friendly park.** Composite environment that historically clusters HRs. Joint prob above naive product. Today: gameTotal/weather not carried; no amplification.
4. **High-leverage late-inning hitter OVERs when opposing bullpen is fatigued.** `bullpenShift`/`reliefFatigueScore` is the canonical field (Phase 1B, dormant). When live, a same-game stack against a fatigued bullpen is positive cov.
5. **Top-of-order hitter OVERs same team same game (lineup-depth stack).** Top-of-order accumulates more PAs; if pitcher is bad, the top of the order especially benefits. `lineupPosition` / `depth=top` is canonical (`deriveMlbLineupContext.js:75-116`).

---

## SECTION 11 — COVARIANCE-HARDENING LEVER MENU (operator-approvable Phase MLB-Correlation-Engine-1A candidates)

The audit ends here. The next session selects ONE OR MORE levers from this list and ships them under the additive / replay-safe / grading-safe / calibration-safe doctrine.

| Lever | Surface touched | Risk profile | Smallest-safe |
|---|---|---|---|
| **MLB-COV-1** — Same-game same-team hitter OVER stack: hard-block when 2+ legs exist; positive cov flag when allowed | `buildSlipAi.js:122-166 normalizeCandidate` (lift team + eventId — already there) + `buildSlipAi.js:522 canAddLeg` | LOW | ★ smallest. Pure rule extension; reuses existing fields. |
| **MLB-COV-2** — Pitcher-K ↔ hitter-counting hard block (mirror `buildMlbCorrelationEngine.js:117-128` into `canAddLeg`) | `normalizeCandidate` (lift `opposingPitcher` from raw — `deriveMlbPitcherEnvironmentContext.js:88-95`) + new `canAddLeg` rule `pitcher_hitter_conflict` | LOW | ★ smallest. Authors already encoded the rule; we are bridging it. |
| **MLB-COV-3** — Linked-stat-family penalty (same player; hits ↔ total_bases, runs ↔ RBIs) | NEW canonical map at top of `buildSlipAi.js` (mirrors `nbaCorrelationEngine.linkedStatFamilies` pattern) + `combineLegs:546` multiplier reduction | LOW | ★ smallest. No new fetches. |
| **MLB-COV-4** — High-game-total HR clustering boost (gameTotal ≥ 9.5 + same-game HR pair → small capped joint-prob boost) | `normalizeCandidate` (lift `gameTotal`) + `combineLegs` adjustment | MEDIUM | Requires gameTotal lift + new boost path. |
| **MLB-COV-5** — Same-team multi-batter UNDER stack penalty (at HR-friendly park, block 2+ batter-UNDERs same game) | `normalizeCandidate` (lift `hrEnvironmentTag` from `deriveMlbParkContext`) + `canAddLeg` rule | MEDIUM | Directly closes the 2026-05-15 Coors loss path. |
| **MLB-COV-6** — Weather + gameTotal HR amplification (wind-out + gameTotal ≥ 9.5 + same-game HR pair → exception to `maxPerGame` AND boost) | `normalizeCandidate` (lift weather) + `combineLegs` | MEDIUM | Requires careful interaction with existing `maxPerGame` cap. |
| **MLB-COV-7** — Bullpen-collapse cluster (high-leverage late-inning OVERs when opposing bullpen fatigued) | Requires Phase 1B bullpen activation first | HIGH | Held until bullpen state is non-dormant. |
| **MLB-COV-8** — Top-of-order lineup-depth stack recognition | `normalizeCandidate` (lift `lineupPosition`/`depth`) + `combineLegs` | MEDIUM | Useful but lower priority than COV-1/2/5. |
| **MLB-COV-9** — Extract `buildMlbCorrelationEngine` into shared helper consulted by both cluster + slip paths | `pipeline/shared/mlbCorrelationEngine.js` (NEW) + refactor `buildSlipAi.js` + cluster callers | HIGH | Architecturally clean but multi-file; defer until 2-3 specific rules prove value. |

**Recommended smallest-safe combination:** MLB-COV-1 + MLB-COV-2 + MLB-COV-3 ship together as Phase MLB-Correlation-Engine-1A. All three are pure-rule additions, reuse existing canonical fields, require only lifting `opposingPitcher` through `normalizeCandidate`, and close the three highest-survival fake-edge paths surfaced above. MLB-COV-5 (the Coors UNDER-stack path) is a one-rule addition once `hrEnvironmentTag` lifts, but requires one more field plumbing — second-priority. MLB-COV-4/6 require gameTotal + weather plumbing — third priority. MLB-COV-7 is gated on Phase 1B bullpen activation. MLB-COV-9 is architecturally appealing but premature — ship rules first, refactor when 2+ phases demonstrate value.

---

## SECTION 12 — LONGITUDINAL MLB-INTELLIGENCE STRATEGY

The audit's empirical anchor is one (1) graded loss because the historical tracking schema does not yet record correlation-relevant per-slip features. Phase MLB-Correlation-Engine-1A should ship with a forward-looking observability hook so the operator can track how often each new rule fires and how often blocked-slip patterns would have lost.

| Observation lever | Effort | Operator value |
|---|---|---|
| `[MLB-COV-1] blocked N same-team hitter-OVER stacks` (per-run counter, rate-limited log) | Trivial | Quantifies suppression volume. |
| `[MLB-COV-2] blocked N pitcher_hitter_conflict pairs` | Trivial | Same. |
| Persist `correlation_block_log.jsonl` (date, rule, blocked-slip-id, leg-shapes) | Small | Enables 30-day retrospective: "would these blocked slips have won?" |
| Add per-rule counter to `npm run market:status` or new `npm run correlation:status` | Small | Surfaces nightly rule activity. |

**None of these require new code in this audit phase.** They are listed so the post-patch session can include them as part of the ship.

---

## SECTION 13 — AUDIT CITATIONS (REPRODUCIBILITY)

Every file:line in this document was read directly from the repo. Reproducibility command sequence for next session:

| Citation | Verified by |
|---|---|
| `buildSlipAi.js:54-72, 78-80, 122-166, 173-290, 384-411, 491-529, 522-527, 533-562, 564-629` | Explore subagent — 2026-05-16 session. |
| `nbaCorrelationEngine.js:18-22, 90-98, 107-123, 143-198, 158-169` | Same. |
| `buildMlbCorrelationEngine.js:114-173 (esp. 117-128)` | Same. Verified file exists at `backend/pipeline/mlb/buildMlbCorrelationEngine.js`. |
| `buildMlbBootstrapSnapshot.js:21-30, 95, 152-153, 164` | Same. |
| `deriveMlbPitcherEnvironmentContext.js:88-95, 88-144` | Same. |
| `deriveMlbWeatherContext.js:94-180, 164-181` | Same. |
| `deriveMlbParkContext.js:53-78` | Same. |
| `deriveMlbLineupContext.js:75-116` | Same. |
| `composeMlbContextualSignal.js:25-30, 64-151` | Same. |
| `runtime/tracking/mlb_tracked_slips_2026-05-15.json` | Direct read this session — ARI@COL same-game UNDER-stack loss confirmed. |

---

## ARCHITECTURE PRESERVATION INVARIANTS (THIS AUDIT)

- ✓ ZERO code patched.
- ✓ ZERO schema mutation.
- ✓ ZERO scoring redesign.
- ✓ ZERO grading / replay / lineage / persistence / orchestrator touch.
- ✓ ZERO FAMILY_CALIBRATION_COEFFICIENTS / volatility rules / portfolio thresholds / tier templates / market-pipeline change.
- ✓ ZERO recommendation hierarchy touch (Phase Recommendation-Hierarchy-1A doctrine intact).
- ✓ ZERO MLB pipeline touch (all canonical authorities cited only).
- ✓ Receipt + checkpoint state unaffected (audit is read-only; brain:checkpoint still required at end of next code-touching session).

---

## STATUS

Phase MLB-Correlation-Engine-1A AUDIT complete. Recommended next action: operator selects lever(s) from Section 11 (smallest-safe-step doctrine: MLB-COV-1 + MLB-COV-2 + MLB-COV-3 together are the lowest-risk additive triple that closes the three highest-survival MLB-parlay-failure paths). Phase ships under the established additive / probe-matrix-clean / 14-suite-regression-clean / 158-assertion-PASS discipline.

Doctrine to be cemented when shipping:
- **Deterministic covariance intelligence** — every cov boost / cov penalty is a pure function of canonical fields. No ML. No black box.
- **Same-game exposure philosophy** — same-game is the strongest correlation prior; rules fire BEFORE the slip composer multiplies leg probabilities.
- **Anti-correlation suppression** — pitcher↔opposing-hitter conflicts hard-block; never soft-warn.
- **Positive covariance reward** — capped boost (mirroring NBA's `+0.04` tie-breaker cap); never relaxes diversification limits.
- **Parlay survivability philosophy** — improving 2-3 leg survivability comes from eliminating toxic same-game exposure, not from broader leg admission.
- **Canonical authority first** — `buildMlbCorrelationEngine.js:117-128` proves the platform already knows pitcher-K↔hitter-hits is toxic; Phase MLB-Correlation-Engine-1A bridges that knowledge into the workstation slip path.
