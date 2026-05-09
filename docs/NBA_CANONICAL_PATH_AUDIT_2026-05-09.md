# NBA-2 — CANONICAL PATH CONSTITUTION AUDIT
**Session AB — NBA Routing Constitutionalization**
_Generated: 2026-05-09 | Read-only audit, zero code mutations | Model: claude-opus-4-7 | Adaptive Thinking: ON_
_Scope: All 5 NBA slip / pick construction modules · workstation routing surface · nightly orchestration · shared MLB-calibrated path · payload shape compatibility_

---

## EXECUTIVE SUMMARY

The Session Z NBA Ecology Audit was directionally correct on philosophical conflicts but **structurally wrong** about which NBA slip module is the canonical engine. A direct importer trace of every NBA slip-related file proves that:

- **`buildNbaSlipComposer.js`** is the only NBA-specific slip module that is **actually invoked in the live runtime path**. It is called by `buildNbaOpportunityBoard.js` line 257, consumes `bestBetsBoard.allPlays`, and produces the slips that `persistTrackedToday()` writes to `nba_tracked_slips_*.json` (which the workstation surfaces as `slipBets`).
- **`buildNbaAiSlips.js`** is **utility-only**. Its `buildNbaAiSlips()` function has zero callers anywhere in the repo. Only its helpers (`collectFullPool`, `filterSlipLegs`, `formatLeg`) are imported — by `buildNbaPlayerOutcomePredictions.js` (only `collectFullPool`) and `buildNbaDynamicSlipEngine.js`.
- **`buildNbaDynamicSlipEngine.js`** is a **dead orphan**: it has zero importers in active code despite being a 843-line module with the most sophisticated correlation logic in the repo (`pairwiseStackBoost`, joint-probability with correlation, cluster profiles, RR generation).
- **`buildNbaSlipEngine.js`** is a **dead orphan**: zero importers; the only file that mentions it is `nbaAiStatFamilyRank.js` in a code comment.
- **`buildSlipAi.js`** (shared, MLB-calibrated) is invoked at every workstation request and produces a parallel, regenerated `aiSlips` payload alongside the nightly `slipBets` from `buildNbaSlipComposer`. The frontend currently sees BOTH.

This means the "5 overlapping NBA slip builders" framing in the Session Z audit and ARCHITECTURE.md is misleading. The truth is **2 active paths (one canonical-nightly, one regenerated-workstation) and 3 dormant modules** — two truly dead, one architecturally orphaned despite quality logic.

The NBA routing constitutionalization that NBA-2 must perform is therefore narrower and safer than the audit doc implied:

1. **Designate `buildNbaSlipComposer` as canonical-nightly** for the engine-grade slip surface.
2. **Designate `buildSlipAi.js` as canonical-workstation** for the bettor-rich on-demand slip regeneration, with NBA-specific configuration (tier templates, volatility allowance) pulled into a thin `pipeline/sports/nbaConfig.js` adapter rather than living in `buildSlipAi.js`.
3. **Quarantine `buildNbaAiSlips` to wrapper-only** (export the three helpers; remove the unused `buildNbaAiSlips()` function path eventually).
4. **Schedule `buildNbaSlipEngine.js` for deletion** (zero importers; survival-era random picker; semantically incompatible).
5. **Schedule `buildNbaDynamicSlipEngine.js` for absorption-then-deletion** — its `pairwiseStackBoost`, `jointProbabilityWithCorrelation`, `isFastCashoutLeg`, `buildEventMetaMap` are the **only correlation logic in the repo for NBA** and must be lifted into the canonical path BEFORE deletion.
6. **Preserve aiRange resolution** — the `resolveLegFromAiRange` / `resolveLottoLegAboveCeiling` / `computeOutcomeRange` framework in `nbaAiOutcomeRange.js` and `buildNbaAiPicks.js` is the most sophisticated NBA intelligence in the repo and must remain canonical for ladder rendering even if `buildNbaAiSlips` itself is decommissioned.

NBA-2 is therefore not a slip-engine swap; it is a **constitutional designation** plus a **correlation absorption plan** plus a **wrapper quarantine plan**.

---

## 1. NBA ROUTING HEALTH SCORE

| Dimension | Score | Rationale |
|---|---|---|
| **Canonical-engine clarity** | 4.5 / 10 | One nightly canonical (`buildNbaSlipComposer`), one workstation canonical (`buildSlipAi.js` shared). Both undocumented as canonical. |
| **Dead-code namespace pollution** | 3.5 / 10 | 1,924 lines of orphan slip modules (`buildNbaSlipEngine` 601 + `buildNbaDynamicSlipEngine` 843 + the unused `buildNbaAiSlips()` function ~480 lines of the 574-line file). Importer trace contradicts the Session Z audit's claim that these run nightly. |
| **Workstation/nightly symmetry** | 3.0 / 10 | Workstation regenerates slips via `buildSlipAi` on every request; nightly runs `buildNbaSlipComposer`. Two slip surfaces (`aiSlips` + `slipBets`) are returned to the frontend with no reconciliation rule. |
| **Correlation logic ownership** | 2.0 / 10 | Lives ONLY in `buildNbaDynamicSlipEngine.js` (orphan). The active path (`buildNbaSlipComposer` + `buildSlipAi`) has only `eventShareOk` count caps and same-script gates — no pairwise boosts, no joint probability with correlation, no cashout-front logic. |
| **aiRange resolution propagation** | 5.0 / 10 | `nbaAiOutcomeRange.js` is solid. `buildNbaAiPicks` correctly attaches `aiRangeResolved` to elite/strong picks. But the workstation's `buildSlipAi.js` does not consume `aiRange` — every workstation slip is built from `c.line` directly. Floor/median/ceiling only flow into `nba_tracked_slips_*.json` via `buildNbaSlipComposer` → no, wait: even `buildNbaSlipComposer` operates on `bestBetsBoard.allPlays` which doesn't carry `aiRange` either. **aiRange is resolved by `buildNbaAiPicks` for headline display only — it does NOT flow into either active slip engine.** |
| **snapshotSourced flow** | 7.0 / 10 | NBA-1 guard in `buildSlipAi.js` and `buildFeaturedPlays.js` correctly preserves `volatility:"lotto"` for snapshot-stamped PRA. But the snapshotSourced field is set ONLY by `buildNbaSnapshotCandidates()` in workstationRoutes — nightly path candidates (`buildNbaSlipComposer` consumers) never see this flag. The guard is workstation-only. |
| **Volatility ownership** | 4.5 / 10 | Three independent volatility regimes coexist: (1) workstation `buildNbaSnapshotCandidates` stamps `volatility: "lotto"|"aggressive"|"balanced"` on snapshot rows; (2) shared `VOLATILITY_RULES` re-classifies via `classifyVolatility()` unless NBA-1 guard fires; (3) `legVolatility()` in `buildNbaAiSlips` and `buildNbaDynamicSlipEngine` use a totally different numeric scale (0.92–1.18). No single source of truth. |
| **Tier ownership** | 3.5 / 10 | `tier` field set by: (a) `nbaIsolatedRoutes` snapshot-scoring, (b) `buildNbaSnapshotCandidates` workstation supplement (line 202: `edge >= 0.12 → ELITE`, etc.), (c) `buildNbaAiPicks` (`aiTier: "elite"|"strong"|"fade"`), (d) `bestBetsBoard.allPlays` has its own `tier`. None of these are reconciled. |
| **Same-player suppression** | 6.0 / 10 | Multiple uncoordinated caps: workstation `diversifyCandidates` `maxPerPlayer:3`; `buildSlipAi` cross-tier `MAX_PLAYER_GLOBAL = 3`; `buildNbaAiSlips` exposure cap = 2; `buildNbaSlipComposer` uses `playerUseCounts` with `diversityPenaltyPerUse` decay. Correct directionally but each engine cards its own caps. |
| **Workstation compatibility** | 6.5 / 10 | `slipBets` (nightly) and `aiSlips` (regenerated) coexist in the `/state` payload. Frontend likely renders both side by side; consumer behavior unaudited. The "what is THE slip" answer is currently "depends on which view you're in." |
| **OVERALL** | **4.6 / 10** | Active runtime is functional but constitutional ownership is undefined. Dead/orphan modules pollute the namespace. Correlation logic is in the wrong file. NBA-2 must establish ownership without breaking either path. |

---

## 2. CANONICAL ENGINE RECOMMENDATION

### Canonical Designation (single sentence each)

| Layer | Canonical owner | Status |
|---|---|---|
| **NBA candidate enrichment (nightly)** | `buildNbaPlayerOutcomePredictions.js` | Stable — outcome distributions feed bestBetsBoard. |
| **NBA scored picks (elite/strong/fades)** | `buildNbaAiPicks.js` | Stable — produces `aiPicksRankedPool`, attaches `aiRangeResolved` for headline display. |
| **NBA outcome range / ladder math** | `nbaAiOutcomeRange.js` | Stable — `computeOutcomeRange`, `resolveLegFromAiRange`, `resolveLottoLegAboveCeiling`. NEVER replace. |
| **NBA bestBetsBoard composition** | `buildNbaBestBetsBoard.js` | Stable — converts predictions × marketProps into `allPlays`, `corePlays`, `altPlays`. |
| **NBA nightly slip engine** | **`buildNbaSlipComposer.js`** | **CANONICAL — produces `nba_tracked_slips_*.json`. Sole live nightly slip producer.** |
| **NBA workstation slip surface** | **`buildSlipAi.js`** (shared, sport-agnostic) | **CANONICAL workstation regenerator. Should remain shared but receive NBA-specific config via adapter.** |
| **NBA workstation featured plays** | **`buildFeaturedPlays.js`** (shared) | **CANONICAL.** |
| **NBA workstation candidate diversification** | `buildCandidateDiversity.js` (shared) | Stable. |
| **NBA snapshot candidate enrichment (live)** | `buildNbaSnapshotCandidates()` in `workstationRoutes.js` | **Stable — but should be extracted to `pipeline/nba/buildNbaSnapshotCandidates.js` as a sport-specific module.** Currently inline in routes file. |
| **NBA correlation logic** | `buildNbaDynamicSlipEngine.js` (CURRENTLY DEAD) | **MUST BE ABSORBED into canonical path before deletion.** |
| **NBA first basket nightly engine** | `buildNbaFirstBasketEngine.js` | Active, attached to `bestBetsBoard.firstBasket`. Workstation does not surface it (`FirstBasketView` permanently dark). |

### Why `buildNbaSlipComposer` is Canonical-Nightly (not `buildNbaAiSlips`)

The Session Z audit assumed `buildNbaAiSlips` was the canonical NBA slip engine. The codebase says otherwise:

```
$ grep -r "buildNbaAiSlips\b" backend --include="*.js" | grep -v "from buildNbaAiSlips"
backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js:9:
  const { collectFullPool } = require("./buildNbaAiSlips")
backend/pipeline/nba/buildNbaDynamicSlipEngine.js:13:
  const { collectFullPool, filterSlipLegs, formatLeg } = require("./buildNbaAiSlips")
backend/pipeline/nba/nbaSlipLegConstraints.js:5:
  // (comment-only mention, no import)
backend/pipeline/nba/buildNbaAiSlips.js:495:
  function buildNbaAiSlips(input) { ... }   // <-- exported but NEVER imported as buildNbaAiSlips
```

`buildNbaAiSlips()` (the function) has **zero importers**. The file's role is to provide the helper trio. The 480 lines that implement `buildSafeSlip` / `buildBalancedSlip` / `buildAggressiveSlip` / `buildLottoSlip` / `buildNbaAiSlips` are unreached code paths.

By contrast:
```
backend/pipeline/nba/buildNbaOpportunityBoard.js:13:
  const { buildNbaSlipComposer } = require("./buildNbaSlipComposer")
backend/pipeline/nba/buildNbaOpportunityBoard.js:257:
  const slipPack = buildNbaSlipComposer({ bestBetsBoard: boardPayload.bestBetsBoard })
backend/pipeline/nba/buildNbaOpportunityBoard.js:270:
  boardPayload.bestBetsBoard.slips = slipPack.slips
backend/pipeline/nba/buildNbaPerformanceTracking.js:335-357:
  const slips = board.slips || {}
  ...for ("safe", "balanced", "aggressive", "lotto") ... newSlips.push(leanSlip(s, date))
  writeJsonSync(slipsPath, ...)   // writes nba_tracked_slips_<date>.json
```

The slips file the workstation reads at `slipBets: readJsonSafe(fileFor(sport, "tracked_slips", date))` (workstationRoutes line 397) is unambiguously the output of `buildNbaSlipComposer` after `leanSlip()` projection in `buildNbaPerformanceTracking.js`.

### Why `buildSlipAi.js` Stays Canonical-Workstation

The workstation needs to **regenerate** slips in response to a refreshed candidate pool (snapshot supplement, ledger updates, timing changes). That pool is computed at request time from live data; it is not the same pool the nightly run saw. Reusing `buildNbaSlipComposer` at request time would require:

- Computing `bestBetsBoard.allPlays` at request time → requires `buildNbaPlayerOutcomePredictions` → requires the full `completeUniverse` snapshot path → 60-second response cost.
- Or persisting the full bestBetsBoard nightly and regenerating slips from it on filter changes → adds a new persisted state.

`buildSlipAi.js` is intentionally lightweight: it takes already-normalized candidates and assembles four tiers in milliseconds. That is correct workstation behavior. The bug is not the architecture; the bug is that `buildSlipAi.js` was MLB-calibrated and never received an NBA-specific configuration adapter.

---

## 3. LEGACY ENGINE FINDINGS

### `buildNbaSlipEngine.js` — DEAD ORPHAN (601 lines)

**Importers:** zero.
**Comment-only references:** `nbaAiStatFamilyRank.js:20` ("Align with buildNbaSlipEngine heuristics").
**Behavior:** Random-weighted universe picker with `Math.random()`-based slip styles, no aiRange awareness, no tier system.
**Disposition:** Schedule for deletion in NBA-2 cleanup phase. Zero risk — nothing imports it. The comment in `nbaAiStatFamilyRank.js` should be deleted alongside.

### `buildNbaDynamicSlipEngine.js` — DEAD ORPHAN with VALUABLE LOGIC (843 lines)

**Importers:** zero in live runtime.
**Comment-only references:** `nbaSlipLegConstraints.js:5` ("Used by buildNbaDynamicSlipEngine and buildNbaAiSlips").
**Internal imports it makes:** `buildNbaAiSlips` (helpers), `nbaAiOutcomeRange`, `nbaSlipLegConstraints`, `nbaAiStatFamilyRank`.
**Behavior:** The most sophisticated NBA slip logic in the repo. `pairwiseStackBoost` applies +0.14 same-team points+assists, +0.10 points+threes any game, +0.07 high-pace correlated points/threes, +0.09 high-usage+high-total PRA. `jointProbabilityWithCorrelation` computes joint prob with `0.22 × pairBoostAvg` lift. Cluster profiles SAFE/EV/UPSIDE/CASHOUT with confidence-sized leg counts. RR (round-robin) 2-leg + 3-leg. `isFastCashoutLeg` first-basket / threes / low-points-line detection. `ensureFastLegsLead` cashout ordering.
**Disposition:** **Absorb correlation + cashout logic into canonical path FIRST, then delete.** The comment at `buildNbaDynamicSlipEngine.js:8` (`Env: NBA_DYNAMIC_SLIP_ENGINE=0 → legacy buildNbaAiSlips`) suggests an unfinished feature flag — the env switch was never wired into `buildNbaOpportunityBoard.js`. This is a half-shipped migration.

### `buildNbaAiSlips.js` — UTILITY-ONLY (574 lines, ~95 lines used)

**Importers (function-only):** `buildNbaPlayerOutcomePredictions.js` (only `collectFullPool`); `buildNbaDynamicSlipEngine.js` (only `collectFullPool`, `filterSlipLegs`, `formatLeg`).
**Importers (full `buildNbaAiSlips()` function):** zero.
**Behavior:** The SAFE/BALANCED/AGGRESSIVE/LOTTO archetype builders, aiRange leg resolution, exposure tracking, lotto-mirror-aggressive fallback. Architecturally elegant; never reached at runtime.
**Disposition:** **Quarantine to wrapper-only.** Move `collectFullPool`, `filterSlipLegs`, `formatLeg` into a new `nbaSlipUtils.js`. Delete the orphaned `buildSafeSlip` / `buildBalancedSlip` / `buildAggressiveSlip` / `buildLottoSlip` / `buildNbaAiSlips` functions. NBA-1 invested in adding the snapshotSourced volatility guard to `buildSlipAi.js` (correctly) — not to `buildNbaAiSlips.js` because the latter is unreached.

### `buildNbaSlipComposer.js` — ACTIVE CANONICAL (480 lines)

**Importer:** `buildNbaOpportunityBoard.js:13`, called line 257.
**Behavior:** Greedy leg picker per tier (SAFE / BALANCED / AGGRESSIVE / LOTTO) with player-use diversity penalty, hard correlation rules (no opposing sides, no same-player same-event), event-share cap derived from target leg count. Operates on `bestBetsBoard.allPlays`.
**Disposition:** **Canonical-nightly. Receives correlation lift via NBA-2-Phase-2 (absorb DynamicSlipEngine logic).**

### `buildNbaPlayerOutcomePredictions.js` — ACTIVE CANONICAL (1,943 lines)

**Importer:** `buildNbaOpportunityBoard.js:11`, called line 242. **Stable.**

### `buildNbaAiPicks.js` — ACTIVE CANONICAL (1,082 lines)

**Importer:** `buildNbaOpportunityBoard.js:9`, called line 238. **Stable. Owns ELITE/STRONG/FADE tier stamps for nightly. Owns aiRange resolution attachment via `attachAiPickRangeResolution()`.**

---

## 4. DUPLICATED RESPONSIBILITY FINDINGS

| Responsibility | Active duplications | Recommendation |
|---|---|---|
| Slip assembly (NBA tiers) | `buildSlipAi.js` (workstation regeneration) + `buildNbaSlipComposer.js` (nightly file) | Designate boundary: workstation = lightweight regen; nightly = full ecology composition. Make explicit, document the contract. |
| Volatility classification | `VOLATILITY_RULES` (shared) + `buildNbaSnapshotCandidates` inline classifier (workstationRoutes:206) + `legVolatility()` (buildNbaAiSlips, dead) + `legVolatility()` (buildNbaDynamicSlipEngine, dead) + `confidence`/`volatility` numeric on bestBetsBoard plays | Single source of truth: shared `VOLATILITY_RULES` plus the NBA-1 `snapshotSourced` guard. The two dead `legVolatility()` functions can die with their files. |
| Tier stamping | snapshot scoring (nbaIsolatedRoutes) + workstation snapshot supplement (line 202) + `buildNbaAiPicks` aiTier + `bestBetsBoard.allPlays.tier` | Pre-NBA-4: must reconcile. NBA-4 (Ecology Tier Layer) is the right home — tier stamps should live in one canonical pass. |
| `collectFullPool` | `buildNbaAiSlips.js` (canonical export) + `buildNbaPlayerOutcomePredictions` (re-imports it) + `buildNbaDynamicSlipEngine` (re-imports it) | Move to `nbaSlipUtils.js` (new). Keep one export. |
| `filterSlipLegs` / `formatLeg` | `buildNbaAiSlips.js` (canonical export) + `buildNbaDynamicSlipEngine.js` (re-imports) | Same. |
| Same-game caps | `eventShareOk` (Composer) + `maxPerGame` (Composer cfg) + `maxPerGame` (`buildSlipAi.canAddLeg`) + `effectiveMaxSameGame` (AiSlips, dead) + `maxSameGame` (DynamicSlipEngine, dead) | Each engine carries its own; correct given the engines are independent. NBA-2 should NOT consolidate these — they belong with their host engine. |
| Player exposure | `playerUseCounts` (Composer) + `globalPlayerCount` (`buildSlipAi`) + `exposure` Map (AiSlips, dead) + `globalPlayerPenalty` (DynamicSlipEngine, dead) | Same — keep with hosts. |
| `pk()` / `eid()` / `propBlob()` micro-helpers | Reimplemented identically in `buildNbaAiSlips.js`, `buildNbaDynamicSlipEngine.js`, `buildNbaSlipComposer.js` | Low-priority extraction. Acceptable duplication for autonomous engine modules. |

---

## 5. ECOLOGY OWNERSHIP FINDINGS

### Who owns what part of the NBA ecology?

| Ecology dimension | Active owner | Risk |
|---|---|---|
| Edge per row | `nbaModelSignals.js` `nbaRowEdge` (workstation snapshot supplement) + nightly `applyEdgeToNbaRows` (opportunity board input) | Two compute paths. Same formula? Unverified. **Audit risk.** |
| modelProb per row | `nbaModelSignals.js` `nbaRowModelProbability` + `nbaRowModelProbabilityCore` | Two functions used in different contexts. Documented in nbaModelSignals.js but unaudited for divergence. |
| Stat family classification | `statFamilyKey` (nbaAiOutcomeRange) + `inferPropLaneKey` (nbaPropLanes) + ad-hoc `family =` blocks in workstationRoutes:172 + `normalizePropTypeKey` (buildNbaSlipEngine, dead) + `isOffensiveAttackStat` (shared normalizers) | Five ad-hoc classifiers. Pragmatic but fragile. Consolidation can wait until NBA-4. |
| Volatility | See §4. | Single SoT pending NBA-1 guard expansion to nightly path. |
| ELITE/STRONG tier | `buildNbaAiPicks.passesEliteTierGate` + `buildNbaSnapshotCandidates` `edge >= 0.12 → ELITE` + `bestBetsBoard.allPlays.tier` (set inside `buildNbaBestBetsBoard`) | Three independent tier-stamping rules. NBA-4 is the correct home for unification. |
| Fades | `buildNbaAiPicks.fades` (nightly only) | Workstation does not surface fades. Acceptable for now. |
| First basket | `buildNbaFirstBasketEngine` (nightly) | Disconnected from workstation (FirstBasketView dark). NBA-7. |
| Defensive props (steals/blocks) | `buildNbaDefensiveProps` | Disconnected from workstation. Out of scope for NBA-2. |
| Bankroll plan | `buildNbaBankrollPlan` | Conditional on `input.bankroll`. Currently unsupplied → null. Out of scope. |
| Correlation | `buildNbaDynamicSlipEngine.pairwiseStackBoost` (orphan) | **Critical gap. The active path has none. NBA-2-Phase-2 absorption is required.** |

---

## 6. VOLATILITY PROPAGATION FINDINGS

The NBA-1 guard solves the workstation classification problem for snapshot-sourced PRA (volatility:"lotto"). It does NOT propagate to:

1. **Nightly `nba_tracked_bets_*.json`** — `buildNbaSlipComposer` operates on `bestBetsBoard.allPlays` whose `volatility` field comes from `buildNbaBestBetsBoard`'s mapping (verify via read; not yet audited in this session). The `snapshotSourced: true` flag is set ONLY in `workstationRoutes.js:210`. Nightly candidates do not have it. Therefore the NBA-1 guard never fires for the nightly slip engine. PRA tier assignment in `nba_tracked_slips_*.json` is governed by whatever `buildNbaSlipComposer` does with `p.volatility`.

2. **Featured plays for non-snapshot-sourced NBA candidates** — when the workstation reads `nba_tracked_bets_*.json` (which lacks `snapshotSourced`), `classifyVolatility` runs and `combo/pra → aggressive`. The guard only protects snapshot-supplemented candidates.

**Implication for NBA-2:** Tier templating in `buildNbaSlipComposer` and the volatility flow into `bestBetsBoard.allPlays` must be audited as a Phase 2.5 step BEFORE NBA-3 (alt line gate) or NBA-5 (realismScore rebalance). Otherwise the NBA-2 designation is incomplete.

**Recommendation:** Extend the NBA-1 guard pattern by introducing a `nbaVolatilityResolve(row)` function in a new `pipeline/nba/nbaVolatilityResolver.js`. It takes a row and returns `{ volatility, source: "snapshot"|"rules"|"alt-line-derived" }`. Wire it into:
- `buildNbaSnapshotCandidates` (currently inline at workstationRoutes:206)
- `buildNbaBestBetsBoard` (where nightly `volatility` is currently set)
- `buildSlipAi.normalizeCandidate` (replace the inline guard)
- `buildFeaturedPlays.normalizeCandidate` (replace the inline guard)

Single source of truth without modifying VOLATILITY_RULES or the static MLB regime.

---

## 7. SNAPSHOTSOURCED FLOW FINDINGS

`snapshotSourced: true` is set in exactly one place: `workstationRoutes.js:210` inside `buildNbaSnapshotCandidates`. It flows:

```
buildNbaSnapshotCandidates → snapSupplement[] (snapshotSourced:true)
  → mixed into rawCandidates / aiCandidatesRaw
  → diversifyCandidates (preserves the flag — passes through unchanged)
  → buildSlipAi.normalizeCandidate (NBA-1 guard reads the flag)
  → buildFeaturedPlays.normalizeCandidate (NBA-1 guard reads the flag)
  → portfolio optimizer (does not read the flag)
```

The flag does NOT exist on:
- Tracked-best entries enriched via `enrichBestEntry` (line 123) — unless the original tracked_best had it, which it doesn't (nightly never writes it).
- Tracked-bets read directly — never had it.
- bestBetsBoard plays — never had it.

**Implication:** NBA-2 candidate piping into the canonical path must propagate `snapshotSourced` if the canonical path is to honor model-stamped volatility. If `buildNbaSlipComposer` becomes the workstation slip producer in some future phase, it must learn to read the flag.

For NBA-2 the design constraint is: **do not break the existing flag-on-snapshot-only contract**. The flag must remain a positive sentinel — its absence must be safe. Confirmed: NBA-1 guard treats absence as "fall through to classifyVolatility", which is correct.

---

## 8. AI RANGE OWNERSHIP FINDINGS

`aiRange` (floor/median/ceiling/lotto rungs) is computed by `nbaAiOutcomeRange.js → computeOutcomeRange(c, rankedPool)`. It is attached to picks via `buildNbaAiPicks.attachAiPickRangeResolution(row, rankedCandidatePool)` which calls `resolveLegFromAiRange(pick, pool, slot)` for each of floor/median/ceiling and `resolveLottoLegAboveCeiling(pick, pool)` for the lotto rung.

After attachment, an elite/strong pick has:
- `row.aiRange = { floor, median, ceiling, lotto }` (computed)
- `row.aiRangeResolved = { floor: leg|null, median: leg|null, ceiling: leg|null }` (resolved against pool — null if no matching alt line in pool)
- `row.aiRangeLottoLeg = leg|null`
- `row.line / row.ladder / row.propVariant` rebound to median if resolved

**Where aiRange flows next:**

| Consumer | Uses aiRange? |
|---|---|
| `buildNbaAiPicks` formatHeadline | YES — for "Range: rf / rm / rc" rendering. |
| `buildNbaPlayerOutcomePredictions` | NO. |
| `buildNbaBestBetsBoard` | Verified: it operates on predictions+marketProps. Does it propagate `aiRange` into allPlays? **Not in this read window.** Audit scope risk: if `bestBetsBoard.allPlays` does not carry `aiRange`, then `buildNbaSlipComposer` can never render ladder-resolved legs, and the nightly slip output is base-line-only despite the upstream computation. |
| `buildNbaSlipComposer` | The 100-line read window does not show `aiRange` consumption. The composer operates on play-level fields (`oddsAmerican`, `modelProb`, `volatility`, `score`, `tier`). |
| `buildNbaAiSlips` (DEAD) | YES — `resolveLegFromAiRange(c, pool, "floor"|"median"|"ceiling")` per tier. |
| `buildNbaDynamicSlipEngine` (DEAD) | YES — `buildResolvedCandidates(picks, pool)` resolves floor/median/ceiling for every pick. |
| `buildSlipAi` (workstation) | NO — does not import `nbaAiOutcomeRange` at all. |
| `buildFeaturedPlays` | NO — does not import. |

**Critical finding:** The two ACTIVE engines (`buildSlipAi`, `buildNbaSlipComposer`) **do not consume `aiRange`**. The two DEAD engines do. The `aiRange` computation runs nightly, attaches to elite/strong picks for headline rendering, and then is structurally orphaned at the slip-construction stage.

**This is the single largest architectural gap in NBA's bettor-rich UX.** Ladder ranges are computed; they don't reach the slip layer. NBA-3 (alt line gate) is necessary but insufficient — even with alt lines in the pool, the active slip engines have no aiRange consumption code.

**NBA-2 implication:** Either (a) absorb aiRange consumption into `buildSlipAi.js` (NBA-aware path), or (b) absorb it into `buildNbaSlipComposer` and then make the nightly output the workstation surface. Path (a) is lower-risk; Path (b) is higher-leverage but blocks workstation responsiveness.

---

## 9. AGGRESSION ROUTING FINDINGS

The "aggressive" tier is currently produced by:

**Workstation path (`buildSlipAi.js`):** TIER_TEMPLATES.aggressive: `legCountRange [2,4]`, `minModelProb 0.20`, `maxOdds 600`, `decimalOddsRange [6, 120]`, `allowedVolatility ["balanced","aggressive","lotto"]`, `maxPerGame 2`, `maxFb 1`. Sort prefers `aggressive`/`lotto` volatility seeds; balanced backfill. `offensiveAttackTextureBonus` applied for tie-break ordering.

**Nightly path (`buildNbaSlipComposer.js`):** AGGRESSIVE filter (line 292+): merges core-pool `edge >= 0.04` plays + alt-pool `edge >= 0.04` non-FADE plays, per-leg odds capped +250, target 4-6 legs.

**Aggression routing problems:**

1. **Two semantics for "aggressive":** Workstation = volatility-class aggressive (PRA, threes ≥3.5, etc.); Nightly = edge-threshold aggressive plus alt lines. Same word, different meaning.

2. **The nightly aggressive tier is structurally the closer match to "bettor upside":** It admits alt lines, requires real edge, caps per-leg odds. But it never reaches the workstation as `aiSlips` — it lands in `slipBets`.

3. **The workstation aggressive tier collapses to the same plays as balanced:** Because workstation snapshot supplements only stamp `volatility:"aggressive"` for `threes` and `first_basket`, and most NBA candidates classify as `balanced`, the aggressive tier draws from the same pool with looser gates. Identical seed players.

4. **No "aggression archetype":** Neither active engine has a "this is genuinely a high-ceiling longshot play" signal. The DynamicSlipEngine's UPSIDE_CLUSTER does (sorts by `ceilingScore`), but it is dead.

**Recommendation:** Once Phase NBA-2 designates the canonical path, NBA-2.5 should add a thin `nbaAggressionRoute(candidate)` function that returns `{ tier: "safe"|"balanced"|"aggressive"|"lotto", aggressionType: "ceiling"|"edge"|"correlation"|"pace" }` and consume it in `buildSlipAi.js` for the NBA sport branch only. This is the smallest change that gives aggression real semantics.

---

## 10. WORKSTATION COMPATIBILITY FINDINGS

### What the workstation currently returns for NBA `/state`:

```javascript
{
  candidates,        // diversified pool (from buildNbaSnapshotCandidates + tracked)
  slipBets,          // nba_tracked_slips_*.json (buildNbaSlipComposer output, leanSlip projected)
  aiSlips,           // buildSlipAi.buildAiSlips re-built on-demand (4 tiers × 4 max each = 16)
  aiSlipsSummary,    // warnings + summary string
  featured,          // buildFeaturedPlays output (anchors, bestPra, bestLadders, etc.)
  lineShopping,
  timing,
  portfolio,
  bankrollInfo,
  counts
}
```

### Compatibility constraints

1. **Frontend types.ts must already have shapes for both `slipBets` and `aiSlips`.** Removing either is a breaking change. NBA-2 must not remove either.

2. **NBA `aiSlips.lotto` is currently empty (NBA-1 RESOLVED classification, but odds gate blocks 5-leg combos at base lines).** This is documented in CURRENT_STATE.md known weaknesses #1. NBA-3 (alt line gate) is the unblock.

3. **`slipBets` carries a different shape from `aiSlips`:** `slipBets` is an array of `{ id, type, legCount, legs[{...legSummary}], combinedDecimalOdds, ..., reasoning }` from `legSummary` in buildNbaSlipComposer (line 132). `aiSlips` is `{ safe:[...], balanced:[...], aggressive:[...], lotto:[...] }` of slip objects from `buildSlipAi.serializeLeg` (line 670). The legs themselves differ: Composer carries `volatility`, `tier`, `propType`, `reasoning`; SlipAi carries the same plus `id`, `team`, `eventId`, `matchup`, `book`, `modelProb`, `edge`. Reconcilable but not identical.

4. **Cache invalidation:** Both surfaces are cached for 60s in workstationRoutes. NBA-2 changes that affect candidate normalization will invalidate cache on TERM 1 restart.

### NBA-2 can canonicalize without breaking compatibility by:

- **Not changing the response shape.** Both `slipBets` and `aiSlips` keep their current keys.
- **Not removing buildSlipAi from the workstation path for NBA.**
- **Adding documentation in ARCHITECTURE.md and types.ts that explicitly says: `slipBets` is the engine-grade nightly output (canonical-engine), `aiSlips` is the workstation-regenerated bettor-rich on-demand surface (canonical-workstation).**

---

## 11. SAME-PLAYER SUPPRESSION FINDINGS

Active suppression layers (in execution order on the NBA workstation path):

1. `diversifyCandidates({ maxPerPlayer: 3 })` — workstation pool intake.
2. `buildSlipAi.canAddLeg` — `if (slipLegs.some(l => same player)) return duplicate_player`.
3. `buildSlipAi` cross-tier `MAX_PLAYER_GLOBAL = 3` — single player can appear in at most 3 slips across all four tiers.
4. `buildFeaturedPlays.pickDiversified({ maxPerPlayer: 1 })` — featured buckets.

Active suppression layers on the nightly path:

1. `dedupeByLegKey` in Composer — same leg different books → keep best price.
2. `playerEventTaken` — same player + same event → forbidden in slip.
3. `conflictingSide` — same player + same stat + opposite side → forbidden.
4. `playerUseCounts` + `diversityPenaltyPerUse: 0.18` — soft penalty across slip set.

**Findings:**

1. **Workstation suppression is binary (in slip / not in slip), nightly is graduated.** The Composer's diversity penalty allows a star to repeat across slips at a score cost; SlipAi enforces a hard 3-slip cap.

2. **There is no shared "popular player" signal across the workstation path.** A player at 3 slips in `aiSlips` and 4 slips in `slipBets` produces 7 user-visible appearances — uncorrelated.

3. **No graduated diversity in `buildSlipAi.js`.** The audit doc Z called this out. NBA-2 should not change it (out of scope) but document it as NBA-5 / NBA-6 follow-up.

**Recommendation:** Out of scope for NBA-2. Same-player suppression is correctly per-engine; the user-perceived issue is that two engines coexist on the page.

---

## 12. PORTFOLIO OPTIMIZER OWNERSHIP FINDINGS

`buildPortfolioOptimizer.js` (shared) is the canonical owner of:
- `VOLATILITY_RULES` (static lookup)
- `classifyVolatility(row)`
- `optimizePortfolio({ bets, slipBets, ... })`
- `buildExposureMap`

Active call sites for NBA:
- `workstationRoutes.js:327` — `optimizePortfolio({ bets: candidates, slipBets: [], timingResult, bookState })` for `/state` route's `portfolio` payload.
- `workstationRoutes.js:519` — same for `/portfolio` route.

Issues:
1. **slipBets intentionally omitted from portfolio** (line 326 comment). Correct because the AI slip pool would inflate exposure 3-5×.
2. **`classifyVolatility` is the source of the PRA → aggressive default** that NBA-1 guards against. Without modifying VOLATILITY_RULES, the guard is the right design.
3. **NBA never has its own `optimizePortfolio` variant.** The shared one is correct. No conflict here.

**Recommendation:** Portfolio ownership is clean. No NBA-2 change required.

---

## 13. PHILOSOPHICAL CONFLICT FINDINGS

| Conflict | Active vs canonical resolution |
|---|---|
| **Realism vs edge** | Nightly path (opportunity model, realismScore × 0.70) prioritizes who-can-produce. Workstation path (`buildSlipAi.js`, edge × probFactor) prioritizes where-the-market-is-wrong. **Different epistemologies. Surfaced together.** Resolution: NBA-5 weight rebalance, but the deeper resolution is to designate one path canonical for the bettor surface (recommend: workstation = bettor-rich, nightly = engine-grade). |
| **Static rules vs model signal** | `VOLATILITY_RULES` is static; model emits `volatility` field (snapshot-sourced). NBA-1 guard prefers model signal when sentinel is set; otherwise rules. **Resolution complete for snapshot path; gap remains for nightly path** (see §6). |
| **Determinism vs exploration** | DEAD modules (`buildNbaSlipEngine`, `buildNbaDynamicSlipEngine`) had stochastic / cluster-variation logic. ACTIVE modules are deterministic (greedy + sort). **No conflict in active path; the dead paths represented a road-not-taken.** Acceptable. |
| **Workstation regeneration vs nightly persistence** | Two slip surfaces reach the bettor. **Acceptable** if labeled clearly: engine-grade (slipBets) vs bettor-rich (aiSlips). NOT acceptable if the bettor is confused about which to bet. |
| **aiRange vs base lines** | aiRange computed nightly, consumed nowhere active. Slips at base lines only. **Critical gap. NBA-2 must define how aiRange flows into the canonical-workstation slip surface.** |
| **Correlation vs independence** | DynamicSlipEngine had `pairwiseStackBoost`. ACTIVE path treats legs independently. **Bettor-rich UX requires correlation. Absorption into canonical path is required.** |
| **Tier-as-stamp vs tier-as-classifier** | Multiple tier sources (snapshot scoring, snapshot supplement, aiPicks). **Confusing. NBA-4 ecology layer is the resolution.** |
| **Sport-agnostic vs sport-specific** | `buildSlipAi.js` is shared; was MLB-calibrated; NBA-1 added inline NBA awareness via `snapshotSourced` guard. **Drift risk: each future NBA-aware patch in shared modules pollutes them.** Resolution: extract NBA-specific config into a thin `pipeline/sports/nbaConfig.js` adapter. |

---

## 14. REQUIRED MIGRATION PLAN

### NBA-2 SCOPE (this session's design output, not yet implemented)

NBA-2 is a **constitutional designation + safe absorption planning + wrapper quarantine PLAN**. It performs no slip-engine swap. It performs no scoring change. It does not delete code in this session.

#### Phase 2.A — Designation (this audit + doc updates only, zero code)

1. Update ARCHITECTURE.md (next session — Sonnet):
   - Mark `buildNbaSlipComposer` as canonical-nightly NBA slip producer.
   - Mark `buildSlipAi.js` as canonical-workstation slip regenerator (sport-agnostic).
   - Mark `buildNbaAiSlips.js` as utility-only (helper exports), main function deprecated.
   - Mark `buildNbaSlipEngine.js` as dead orphan, scheduled for deletion.
   - Mark `buildNbaDynamicSlipEngine.js` as dead orphan with valuable correlation logic, scheduled for absorption-then-deletion.
   - Update the "5 NBA slip modules" claim — true picture is 2 active + 3 inactive (1 utility + 2 dead).

2. Update `frontend/src/workstation/types.ts` documentation comments (next session):
   - Document that `slipBets` are nightly engine-grade slips.
   - Document that `aiSlips` are workstation-regenerated bettor-rich slips.
   - No type shape changes.

#### Phase 2.B — Volatility Resolver Extraction (Sonnet, surgical)

Create `pipeline/nba/nbaVolatilityResolver.js`:
```javascript
function nbaVolatilityResolve(row) {
  // 1. Snapshot-stamped wins (NBA-1 sentinel)
  if (row.snapshotSourced === true && row.volatility) {
    return { volatility: row.volatility, source: "snapshot" }
  }
  // 2. Existing classifier as fallback
  return { volatility: classifyVolatility(row), source: "rules" }
}
```

Wire into `buildSlipAi.normalizeCandidate` and `buildFeaturedPlays.normalizeCandidate` (replace the inline NBA-1 guards). No behavior change for snapshot-sourced candidates. Net effect: single audit-friendly resolver, no inline duplication.

**Risk:** Low. NBA-1 cases all preserved. MLB candidates unchanged.

#### Phase 2.C — Snapshot-Candidate Module Extraction (Sonnet, additive)

Move `buildNbaSnapshotCandidates()` (currently inline in `workstationRoutes.js`) to `pipeline/nba/buildNbaSnapshotCandidates.js`. Pure refactor. workstationRoutes imports it.

**Risk:** Near-zero. Pure file move with stable export shape.

**Why:** It's a 70-line NBA-specific function buried inside the supposedly sport-agnostic routes file (Risk 1 from architecture audit §9). Extracting it makes future NFL/NHL parity cleaner, and is a prerequisite for absorbing correlation logic later.

#### Phase 2.D — Helper Trio Quarantine (Sonnet, surgical)

Create `pipeline/nba/nbaSlipUtils.js`:
- Move `collectFullPool`, `filterSlipLegs`, `formatLeg` from `buildNbaAiSlips.js`.
- Update both importers (`buildNbaPlayerOutcomePredictions.js`, `buildNbaDynamicSlipEngine.js`) to import from new location.
- Leave `buildNbaAiSlips.js` in place WITH a `console.warn("[deprecated]")` and a re-export of the helpers from the new location, so any sneaky importer doesn't break.

**Risk:** Low. Pure file move + re-export shim.

**Why:** Wraps `buildNbaAiSlips.js` in a clearly orphan shape. The deprecated function path remains until NBA-2.E.

#### Phase 2.E — Hard Deprecation (Sonnet, deletion)

After Phase 2.D smoke-tests clean across one full nightly + one workstation cycle:

- Delete `buildNbaSlipEngine.js` (601 lines, zero importers).
- Delete the orphan function bodies in `buildNbaAiSlips.js` (`buildSafeSlip`, `buildBalancedSlip`, `buildAggressiveSlip`, `buildLottoSlip`, `buildNbaAiSlips`, `lottoSeedScore`, `buildSafeSlip`, etc.). Leave only the re-export shim.
- Delete the comment in `nbaAiStatFamilyRank.js:20` that mentions buildNbaSlipEngine.

**Risk:** Low. Importer trace already proves zero dependencies.

**DO NOT** delete `buildNbaDynamicSlipEngine.js` in Phase 2.E. Its correlation logic must be absorbed first (Phase 2.G).

#### Phase 2.F — Volatility Resolver Propagation to Nightly (Sonnet, additive)

Audit `buildNbaBestBetsBoard` and confirm where `play.volatility` is set in `bestBetsBoard.allPlays`. Wire `nbaVolatilityResolve` there. This requires READ of `buildNbaBestBetsBoard` (out of this audit's read window). Document as a Phase 2.F prerequisite read.

**Risk:** Medium until the read is done. If `bestBetsBoard.allPlays.volatility` flows through `classifyVolatility` directly, the wiring is one line. If it has its own logic, this is bigger.

#### Phase 2.G — Correlation Absorption (Opus, structural)

After Phase 2.F is stable:
- Lift `pairwiseStackBoost`, `jointProbabilityWithCorrelation`, `buildEventMetaMap`, `isFastCashoutLeg`, `ensureFastLegsLead` from `buildNbaDynamicSlipEngine.js` into `pipeline/nba/nbaCorrelation.js`.
- Wire `nbaCorrelation.scoreSlipCorrelation(legs, eventMeta)` into `buildSlipAi.js` for the NBA sport branch (sport === "nba" check at the top of `buildSlipsForTier`). For non-NBA: no behavior change.
- Wire same into `buildNbaSlipComposer.js` as an optional final-pass score adjustment.

**Risk:** Medium-high. Slip composition logic change. Requires full slate testing.

#### Phase 2.H — `buildNbaDynamicSlipEngine.js` Final Deletion

After Phase 2.G smoke-tests clean: delete the file.

#### Phase 2.I — aiRange Wiring into Workstation Slips (Opus, structural)

Pre-requisite: NBA-3 (alt line gate bypass for NBA-only).

- Make `buildSlipAi.normalizeCandidate` preserve `aiRange` and `aiRangeResolved` if present.
- Add an NBA-only path inside `buildSlipsForTier` that, when sport === "nba" AND a candidate has `aiRangeResolved`, prefers the median rung for safe/balanced and the ceiling rung for aggressive/lotto. Preserves shared module's MLB behavior.
- This is the highest-leverage NBA-2 dependency.

**Risk:** High. Touches the shared slip builder. Must be feature-flagged and slate-tested.

---

## 15. SAFE CANONICALIZATION PLAN

### Order of operations (next 1-3 sessions)

| Step | Phase | Deliverable | Model | Risk | TERM 1 restart |
|---|---|---|---|---|---|
| 1 | 2.A | ARCHITECTURE.md updated; types.ts comments updated; this audit committed | Sonnet | Zero | NO |
| 2 | 2.B | nbaVolatilityResolver.js created; inline guards replaced | Sonnet | Low | YES |
| 3 | 2.C | buildNbaSnapshotCandidates.js extracted | Sonnet | Near-zero | YES |
| 4 | 2.D | nbaSlipUtils.js created; importers updated; AiSlips becomes shim | Sonnet | Low | YES |
| 5 | 2.E | buildNbaSlipEngine.js deleted; AiSlips orphan bodies deleted | Sonnet | Low | YES |
| 6 | 2.F | bestBetsBoard volatility flow audited & wired to resolver | Sonnet | Medium | YES |
| 7 | 2.G | nbaCorrelation.js extracted; wired into buildSlipAi (NBA branch) | **Opus** | Medium-high | YES |
| 8 | 2.H | buildNbaDynamicSlipEngine.js deleted | Sonnet | Low | YES |
| — | NBA-3 | Alt line gate bypass (separate phase) | Sonnet | Medium | YES |
| — | 2.I | aiRange wiring into buildSlipAi NBA branch | **Opus** | High | YES |

### What this audit (Session AB) actually delivers

This session is read-only constitutional truth-discovery. It produces:

1. **This document** (`docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`).
2. **Updated CURRENT_STATE.md and NEXT_SESSION.md** documenting NBA-2 audit completion and Phase 2.A → 2.I migration plan.
3. **Pending checkpoint instructions** (operator runs `bash scripts/finalizeCheckpoint.sh`).

It performs zero code changes. Zero TERM 1 restart needed for Session AB.

---

## 16. WHAT SHOULD NEVER CHANGE

### Hard Don't-Touch List (NBA)

1. **`nbaAiOutcomeRange.js`** — `computeOutcomeRange`, `resolveLegFromAiRange`, `resolveLottoLegAboveCeiling`, `overRungFromLine`, `isSpecialStatFamily`. The most sophisticated NBA logic in the repo.
2. **`nbaAiStatFamilyRank.js`** — role/stat alignment system, `statScoreRow`, `statFamilyKey`, `playerEventFamilyKey`, `roleStatScoreBump`, `statStabilityWeight` table. Any NBA-2 phase that requires touching this is out of scope.
3. **`nbaPropLanes.js`** — CORE_LANES / COMBO_LANES classification. Lane separation is a constitutional concept; do not flatten.
4. **`buildNbaAiPicks.passesEliteTierGate` numeric thresholds** — tuned over multiple sessions; recalibration is NBA-4 scope only.
5. **`compositeRankScore` formula in `buildNbaAiSlips.js` and `buildNbaAiPicks.js`** — `fw + 3.2*e + 1.15*m + 0.85*p + 0.45*b + 0.35*s + formN` weights. Recalibration is NBA-5 scope only.
6. **NBA-1 snapshotSourced guard pattern** — `(raw.snapshotSourced === true && raw.volatility === "lotto") ? "lotto" : classifyVolatility(raw)`. The guard's narrow positive-sentinel contract must be preserved when extracted to `nbaVolatilityResolver`.
7. **VOLATILITY_RULES static table itself** — do not modify. It is correct for MLB and a known-quantity fallback for NBA non-snapshot rows.
8. **`maxSideFraction: 0.55` in featured anchors, `0.60` elsewhere** — calibrated, do not move.
9. **`f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)` compounding cap** — Sessions T-V calibration. Do not move.
10. **The `/api/ws/*` response shape** — `slipBets`, `aiSlips`, `featured` keys. Frontend types depend on them.

### NBA-Specific Soft Don't-Touch List

11. `applyEdgeToNbaRows` — apply order matters; do not reorder ladderBoard / corePropsBoard / completeUniverse.
12. The `dominanceGap` filter — `applyDominanceGapToOpportunityBoard`. Tuned to prevent runaway elite stamps.
13. The `pseudoThrees` logic in buildNbaAiPicks — special-case for thin slates.
14. `persistTrackedToday` atomic-rename pattern — preserves graded results across re-runs.

---

## 17. WHAT SHOULD EVENTUALLY DIE

| Module | Lines | Death plan | Why |
|---|---|---|---|
| `buildNbaSlipEngine.js` | 601 | **Phase 2.E** (after 2.D quarantine smoke-test) | Zero importers. Random `Math.random()` picker. Philosophically incompatible with intelligence-driven UX. Survival-era artifact. |
| Orphan function bodies in `buildNbaAiSlips.js` | ~480 of 574 | **Phase 2.E** | `buildNbaAiSlips()` function and its tier builders are unreached. Helper trio remains via shim. |
| `buildNbaDynamicSlipEngine.js` | 843 | **Phase 2.H** (after 2.G correlation absorption) | Zero importers. Valuable logic — must be lifted FIRST. Then deletion is safe. |
| `pipeline/boards/buildSpecialtyOutputs.js` | ~700 (28KB) | Long-term, after server.js Phase B/C extractions | Server.js-era specialty output builder. Workstation does not consume. Deferred until server.js shrinks. |
| `pipeline/boards/buildBestSpecials.js` | unknown | Same | Same. |
| `pipeline/boards/buildCuratedLayer2Buckets.js` | unknown | Same | Same. |
| `tracker/betTracker.js` + `betMetrics.js` | 138 | After personal_ledger read cutover (Phase S+1) | Parallel bet tracking system, no reconciliation. |
| `pipeline/nba/buildNbaBankrollPlan.js` | 480 | NBA-7+ | Conditional on `input.bankroll`; currently always null. Evaluate overlap with `buildPortfolioOptimizer`. |
| `pipeline/nba/buildNbaBestBetsBoard.js` | 440 | NEVER under NBA-2 | Active in nightly. Out of scope. |
| comment at `nbaAiStatFamilyRank.js:20` | 1 | Phase 2.E | References `buildNbaSlipEngine` heuristics. Becomes a dangling reference. |
| comment at `nbaSlipLegConstraints.js:5` | 1 | Phase 2.H | References `buildNbaDynamicSlipEngine`. Becomes dangling. |

---

## 18. EXACT NBA-2 IMPLEMENTATION PLAN

**Session AB (this session, complete):** Read-only audit. Doc creation. CURRENT_STATE / NEXT_SESSION updates. Zero code changes. Zero TERM 1 restart.

**Session AC (next):** Phase 2.A + 2.B + 2.C + 2.D combined. Sonnet, narrow surgical edits.

```
1. ARCHITECTURE.md update — line counts, true canonical map, deprecation list
2. types.ts — JSDoc comments on slipBets and aiSlips contract
3. Create pipeline/nba/nbaVolatilityResolver.js (~30 lines)
4. Replace inline NBA-1 guards in buildSlipAi + buildFeaturedPlays with resolver call
5. Create pipeline/nba/buildNbaSnapshotCandidates.js (extract from workstationRoutes ~70 lines)
6. Create pipeline/nba/nbaSlipUtils.js (move 3 helpers ~30 lines)
7. Update buildNbaPlayerOutcomePredictions.js + buildNbaDynamicSlipEngine.js imports
8. Add deprecation shim re-export in buildNbaAiSlips.js
9. node --check all modified files
10. TERM 1 restart + smoke test (curl /api/ws/state?sport=basketball_nba)
```

**Session AD:** Phase 2.E deletion sweep + Phase 2.F volatility flow audit & wiring.
**Session AE:** Phase 2.G correlation absorption (Opus). Slate testing.
**Session AF:** Phase 2.H + NBA-3 (alt line gate). Sonnet.
**Session AG:** Phase 2.I aiRange wiring (Opus). Slate testing.

### Session AC pre-flight checks (operator must verify before approval)

1. NBA-1 guard test cases (15/15) still pass with resolver replacement.
2. MLB candidates have `snapshotSourced` undefined throughout, never read by resolver.
3. `buildNbaSnapshotCandidates` extracted with identical export shape (no field renames).
4. `nbaSlipUtils` `formatLeg` output identical char-by-char to current `buildNbaAiSlips.formatLeg`.
5. `node --check` clean on all 6 affected files.

---

## 19. NBA-3 INHERITANCE REQUIREMENTS

NBA-3 (alt line gate) inherits from NBA-2:

1. **`nbaVolatilityResolver.js` MUST exist before NBA-3 ships.** Alt lines stamped with `volatility:"lotto"` from `buildNbaSnapshotCandidates` need the resolver to flow through unchanged. Without the resolver, the inline guard pattern would have to be added to a third place.

2. **`buildNbaSnapshotCandidates.js` MUST be extracted before NBA-3.** NBA-3 modifies the alt-line gate (`propVariant !== "base"`) which lives inside `buildNbaSnapshotCandidates`. Extracting first prevents NBA-3 from being a workstationRoutes.js edit.

3. **NBA-3 MUST be NBA-only.** The shared `propVariant` gate (if any) for MLB must be untouched. Recommended: add an NBA-specific `passesNbaAltLineGate(row)` predicate inside the extracted `buildNbaSnapshotCandidates.js`.

4. **NBA-3 MUST cap alt-line spam.** Recommendation: per-player max 2 alt rungs admitted (base + 1 alt) at any given line distance ≤ ±1.5 from base.

5. **`buildNbaSlipComposer` already operates on `bestBetsBoard.allPlays + altPlays` (gated by edge ≥ 0.03 and not FADE).** NBA-3 changes apply to the workstation supplement only; nightly path is unchanged.

NBA-4 (Ecology Tier Layer) inherits from NBA-2:

6. **The tier-stamping triple-source problem must be acknowledged.** NBA-4 is the canonical tier owner. NBA-2 does not unify tier stamping (out of scope) but documents the three current sources so NBA-4 has a clean slate.

---

## 20. LONG-TERM NBA ARCHITECTURE TARGET

```
┌──────────────────────────────────────────────────────────────────────┐
│  NIGHTLY PIPELINE (sport-specific, per-sport orchestrator)          │
│                                                                      │
│  fetchNbaOddsSnapshot                                                │
│    → buildNbaInsightBoard, buildNbaOpportunityBoard                  │
│    → buildNbaAiPicks (elite/strong/fades, aiRange resolution)        │
│    → buildNbaPlayerOutcomePredictions                                │
│    → buildNbaBestBetsBoard (with nbaVolatilityResolver applied)      │
│    → buildNbaSlipComposer (with nbaCorrelation applied) ★            │
│    → buildNbaFirstBasketEngine, buildNbaDefensiveProps               │
│    → persistTrackedToday → nba_tracked_*.json                        │
│                                                                      │
│  ★ canonical-nightly NBA slip surface                                │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼ (writes JSON files)
┌──────────────────────────────────────────────────────────────────────┐
│  WORKSTATION (sport-agnostic with sport adapters)                    │
│                                                                      │
│  GET /api/ws/state?sport=nba                                         │
│    → buildCandidatePool (reads tracked_*)                            │
│    → buildNbaSnapshotCandidates (extracted, NBA-3 alt-gate aware)    │
│    → diversifyCandidates                                             │
│    → buildSlipAi.buildAiSlips (sport-agnostic + nbaCorrelation +     │
│                                aiRange-aware NBA branch) ★★          │
│    → buildFeaturedPlays                                              │
│    → /api/ws/state response = { slipBets, aiSlips, featured, ... }   │
│                                                                      │
│  ★★ canonical-workstation NBA slip surface (regenerated on demand)   │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND  (single contract: /api/ws/*)                              │
│                                                                      │
│  AiSlipsView           — renders BOTH slipBets (engine) + aiSlips    │
│                          (regen) with a clear label distinguishing   │
│                          "Tonight's engine slips" vs "Tonight's      │
│                          on-demand bettor slips"                     │
│                                                                      │
│  Dashboard / Featured  — renders featured.* buckets                  │
│  ProcessReviewView     — renders ledger + CLV                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Constitutional Principles for the Final Architecture

1. **Two slip surfaces is correct.** Engine-grade (nightly persisted) and bettor-rich (workstation regenerated) serve different bettor needs. The mistake is leaving them undocumented; the fix is constitutional designation.

2. **`buildSlipAi.js` stays sport-agnostic, with NBA awareness via thin adapters** (`nbaVolatilityResolver`, `nbaCorrelation`, future `nbaAggressionRoute`). Never let NBA-specific code live inside the shared module.

3. **`buildNbaSlipComposer.js` is the only NBA-specific slip engine** in the repo after Phase 2.H. The other four NBA slip files either delete or quarantine to utility.

4. **`aiRange` flows into BOTH paths** (nightly via Composer absorbing aiRange awareness; workstation via buildSlipAi NBA branch reading aiRangeResolved). The current state where aiRange is computed but never consumed at the slip layer is a bug.

5. **Correlation lives with the slip engine, not the prediction engine.** `nbaCorrelation` extracted to its own module; both Composer and SlipAi import it. Single source of truth.

6. **Volatility lives in the resolver, not the engine.** `nbaVolatilityResolver` is the SoT; engines query it.

7. **Tier lives in NBA-4 (future).** Not NBA-2 scope. Acknowledged debt.

---

## SUMMARY: NBA-2 CONSTITUTIONAL DESIGNATION

| System | Constitutional role |
|---|---|
| `buildNbaSlipComposer.js` | **CANONICAL — nightly slip engine. Receives correlation absorption (Phase 2.G).** |
| `buildSlipAi.js` (shared) | **CANONICAL — workstation slip regenerator. Sport-agnostic with NBA adapters.** |
| `buildFeaturedPlays.js` (shared) | **CANONICAL — workstation featured plays.** |
| `buildNbaAiPicks.js` | **CANONICAL — nightly pick scorer + aiRange attacher.** |
| `buildNbaPlayerOutcomePredictions.js` | **CANONICAL — nightly prediction engine.** |
| `buildNbaBestBetsBoard.js` | **CANONICAL — nightly bestBets + slips + firstBasket + defensiveProps composer surface.** |
| `nbaAiOutcomeRange.js` | **CANONICAL — aiRange math. Never replace.** |
| `nbaAiStatFamilyRank.js` | **CANONICAL — role-aware stat scoring.** |
| `nbaPropLanes.js` | **CANONICAL — lane taxonomy.** |
| `buildPortfolioOptimizer.js` | **CANONICAL — portfolio + VOLATILITY_RULES (don't modify).** |
| `buildCandidateDiversity.js` | **CANONICAL — diversification.** |
| `buildNbaFirstBasketEngine.js` | **CANONICAL — nightly first-basket engine. Workstation wiring is NBA-7.** |
| `buildNbaDefensiveProps.js` | **CANONICAL — nightly defensive props.** |
| `buildNbaSnapshotCandidates` (currently inline) | **CANONICAL — but must extract to `pipeline/nba/buildNbaSnapshotCandidates.js` in Phase 2.C.** |
| `nbaVolatilityResolver` (does not yet exist) | **WILL BE CANONICAL — Phase 2.B creates it.** |
| `nbaSlipUtils` (does not yet exist) | **WILL BE CANONICAL — Phase 2.D creates it.** |
| `nbaCorrelation` (does not yet exist) | **WILL BE CANONICAL — Phase 2.G creates it via absorption.** |
| `buildNbaAiSlips.js` | **WRAPPER-ONLY post-2.D. Helper trio only. Function body deleted in Phase 2.E.** |
| `buildNbaDynamicSlipEngine.js` | **DEAD ORPHAN. Absorbed in 2.G; deleted in 2.H. Until then, do not modify.** |
| `buildNbaSlipEngine.js` | **DEAD ORPHAN. Deleted in Phase 2.E. Do not modify.** |

---

_NBA-2 Canonical Path Constitution Audit completed: 2026-05-09 (Session AB)_
_Required reading for Session AC (Phase 2.A–2.D execution)._
_Required reading before any NBA-3, NBA-4, NBA-5 phase planning._
_Next audit trigger: After Phase 2.G correlation absorption — slate-test full ecology pass with correlation in active path._
