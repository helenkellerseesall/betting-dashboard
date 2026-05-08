# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-08 (Session P: Priority 1B — NBA featured-pool full unlock; Fix 1B-B nba_tracked_best; Fix 1B-C snapshot supplement; 185→14 diversified candidates; PRA/threes/rebounds/assists all surface)_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | e076871 (Session I) — Sessions H/I/J/K staged, pending finalization via finalizeCheckpoint.sh |
| Repo health | Stable. All syntax checks clean. |

---

## RUNTIME ARCHITECTURE

```
TERM 1: Node/Express backend — port 4000
  └── backend/server.js
  └── routes: workstationRoutes.js, mlbIsolatedRoutes.js

TERM 2: Manual operator verification only
```

Frontend: React 19 + Vite, TypeScript, CSS Modules
Backend: Node.js, Express, flat JSON persistence (`backend/runtime/tracking/`)
Cache: In-memory 60s TTL per (sport, date) key in `workstationRoutes.js`

---

## ACTIVE SYSTEMS

| System | Status | Owner file |
|---|---|---|
| MLB nightly pipeline | Working | `scripts/runMlbNight.js` |
| NBA nightly pipeline | Working | `scripts/runNbaNight.js` |
| AI Slip construction | Working | `pipeline/shared/buildSlipAi.js` |
| Featured plays (anchors/supports) | Working | `pipeline/shared/buildFeaturedPlays.js` |
| Volatility classifier | Working | `pipeline/shared/buildPortfolioOptimizer.js` |
| **Candidate diversification** | **Working — extracted + Fix 1 applied** | **`pipeline/shared/buildCandidateDiversity.js`** |
| **NBA snapshot routing** | **Fixed (Session N) — readSnapshotRows fallback** | **`routes/workstationRoutes.js`** |
| Line shopping (implied spread ranking) | Working | `routes/workstationRoutes.js` |
| Portfolio optimizer | Working | `pipeline/shared/buildPortfolioOptimizer.js` |
| Market timing intelligence | Working | `pipeline/shared/buildMarketTimingIntelligence.js` |
| CLV tracking | Working | `pipeline/shared/buildClv.js` |
| Personal ledger | Working | `pipeline/shared/buildPersonalLedger.js` |
| Post-game review engine | Working + **Intelligence settlement wired (Session J)** | `pipeline/shared/buildPostGameReview.js` |
| Nightly orchestrator | Working | `pipeline/shared/buildNightlyOrchestrator.js` |
| Workstation frontend | Working — **bettor UX Phase 1+2+3 applied (Sessions L+M+N)** | `frontend/src/workstation/` |

---

## FRONTEND SECTIONS

| View | File |
|---|---|
| Dashboard (command center) | `sections/Dashboard.tsx` |
| Slate browser | `sections/SlateBrowser.tsx` |
| AI Slips center | `sections/AiSlipsView.tsx` |
| Bet builder | `sections/BetBuilderView.tsx` |
| Line shopping | `sections/LineShoppingView.tsx` |
| Portfolio view | `sections/PortfolioView.tsx` |
| Process review | `sections/ProcessReviewView.tsx` |
| First basket | `sections/FirstBasketView.tsx` — **premium rewrite Session N** |

---

## RUNTIME TRACKING FILES (today: 2026-05-06)

| File | Contents |
|---|---|
| `mlb_tracked_bets_2026-05-06.json` | 294 bets — 243 under / 51 over (raw model output) |
| `mlb_tracked_best_2026-05-06.json` | 191 entries — HR/TB/RBI overs attack board |
| `mlb_tracked_slips_2026-05-06.json` | AI-generated slip catalog |
| `nba_tracked_bets_2026-05-06.json` | NBA bets |
| `personal_ledger.json` | Flat JSON personal bet ledger |
| `book_intelligence_state.json` | Sportsbook CLV/profile rolling state |

---

## CURRENT ORCHESTRATION

Candidate diversification (`buildCandidateDiversity.js → diversifyCandidates`):
- `maxPerPlayer: 3` · `maxPerGame: 7` · `maxPerStat: 10` · `maxPerStatSide: 6`
- **NEW (Fix 1): modelProb capped at [0.50, 0.55] in diversity sort** — eliminates 1.87× TB-under structural advantage. Mirrors cap in `scoreCandidate` and `scoreLeg`.

Featured side-balance (`buildFeaturedPlays.js → pickDiversified`):
- `maxSideFraction: 0.60` (anchors: 0.55) — fill pass relaxes side cap if short
- Anchors `maxPerGame: 2` — allows cross-side picks in same game

Volatility classification (`buildPortfolioOptimizer.js → VOLATILITY_RULES`):
- `hits`, `runs`, `points`, `rebounds`, `steals`, `stolenbases` etc. → `balanced`
- `pitcherk` / `strikeout` → `balanced`
- `outs` → `balanced` (was `safe` by default)

Composite scoring (`buildFeaturedPlays.js → scoreCandidate`):
- `f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)` — caps modelProb compounding
- `tierBoost`: ELITE 0.04 / STRONG 0.02
- `textureBoost`: aggressive/lotto edge>0.045 → 0.018; offensive over edge>0.05 → 0.020; aggressive offensive over → 0.030
- **volRealism (Fix 3 applied)**: safe=0.80, balanced=0.74, aggressive=0.66, lotto=0.56 (was 0.63/0.46)
- Anchor display: `sortAnchorsForDisplay()` interleaves sides (U·O·U·O·U pattern)

AI slip scoring (`buildSlipAi.js → scoreLeg`):
- Same modelProb cap [0.50, 0.55] as featured
- `tierBoost` halved: ELITE 0.05 / STRONG 0.025
- **TIER_TEMPLATES (Fix 4+5 applied)**: aggressive decimalOddsRange [6.0,120.0] (was [6.0,60.0]); lotto decimalOddsRange [20.0,1500.0] (was [25.0,800.0])

AI slip seeding (`buildSlipAi.js → buildSlipsForTier`):
- **NEW (Fix 2): aggressive tier volatile-first seeding** — aggressive/lotto volatility legs seed before balanced/safe fill. Composite ordering preserved within each subgroup. Safe/balanced/lotto tiers unaffected.
- **NEW (Fix 6): min-first greedy fill** — after building to max legs, tries longest valid subset (max→min) accepting first that passes decimalOddsRange. Prevents 5-leg lotto explosions (dec=8,727–25,355) from discarding valid 3-leg combos (dec=231–439). Applies to all tiers but has most impact on aggressive/lotto.
- Premium-edge override: legs with `modelProb >= 0.50 AND edge >= 0.12` bypass `allowedVolatility` and `minModelProb` gates (safe tier). `maxOdds 150` cap still applies.

Featured `buildSafest`:
- Premium-edge override: balanced/aggressive plays with `modelProb >= 0.50 AND edge >= 0.12` qualify alongside standard safe-volatility + 0.55 modelProb gate.

---

## CURRENT PHASE

**Phase: INTEGRITY + DE-RISK — Phase 7P (Fix 1–6 + Intelligence Layer + Checkpoint + Bettor UX Phase 1 + Phase 2 + NBA Phase 3 + NBA Pipeline Audit + SP Fix 1+2 + Priority 1B Featured Pool Unlock)**

Completed total (all sessions combined):
- AI slip dead fix in `runMlbNight.js`
- Featured anchors vs strong supports two-tier system
- Line shopping re-ranked by implied spread, novelty longshots filtered
- Volatility taxonomy fix — `hits`/`runs`/`points` etc. → `balanced`
- Side-balance caps in `pickDiversified` (`maxSideFraction`)
- Global stat+side orchestration (`maxPerStat`/`maxPerStatSide`)
- Offensive texture bias in aggressive/lotto slip seeds (`offensiveAttackTextureBonus`)
- `AnchorCard` premium display + `attackNote` field
- Scoring ecology fix #1 — modelProb compounding capped at [0.50, 0.55]
- Scoring ecology fix #2 — `isOffensiveAttackStat` + stacked textureBoost
- Anchor cross-side fix — `maxPerGame: 2` in `buildAnchors`
- Trust-curation fix #1 — featured tierBoost halved (ELITE 0.08→0.04, STRONG 0.04→0.02)
- Trust-curation fix #2 — `sortAnchorsForDisplay()` interleave sort
- Trust-qualification fix #1 — slipAi tierBoost halved (ELITE 0.10→0.05, STRONG 0.05→0.025)
- Trust-qualification fix #2 — slipAi safe tier premium-edge override
- Trust-qualification fix #3 — pitcher `outs` → `balanced` volatility
- Trust-qualification fix #4 — `buildSafest` premium-edge override
- Modular extraction #1 — `diversifyCandidates` → `pipeline/shared/buildCandidateDiversity.js`
- Model ecology + trust decompression audit — full lifecycle trace (2026-05-07)
- SQLite Phase 1 storage layer — `backend/storage/` (schema, db, queries, backfill script)
- **NEW: SQLite Intelligence Layer (Session H) — longitudinal prediction/outcome/ecology tracking**
  - `backend/storage/intelligenceSchema.js` — 4 additive DDL tables: prediction_snapshots, outcome_snapshots, slip_outcomes, ecology_snapshots. Cross-sport (`sport` col everywhere). Separate from Phase 1. All CREATE IF NOT EXISTS, idempotent.
  - `backend/storage/intelligence.js` — Write: `snapshotPredictions` (INSERT OR IGNORE, immutable), `snapshotEcology` (INSERT OR REPLACE), `recordOutcome`, `recordOutcomes`, `recordSlipOutcome`. Read: `getDeltaSummary` (groupBy dim), `getCalibrationBuckets`, `getArchetypePerf`, `getStatFamilyMisses`, `getEcologyHistory`, `getSlipPerformance`, `getPlayerIntelligence`. All gracefully degrade if SQLite unavailable.
  - Correctness fixes during Session H: opts.date→runDate bridging; `db.transaction()` replaced with `db.exec('BEGIN/COMMIT/ROLLBACK')` (node:sqlite has no `.transaction()` method); undefined→null coercion for node:sqlite bind strictness.
  - Smoke test: snapshotPredictions 3 inserted/re-run 3 skipped (idempotent ✓); recordOutcome delta_prob=−0.38 (math correct ✓); entropy=1.585=log2(3) (perfect diversity ✓); all 4 read functions returning structured data ✓.
- **NEW: Intelligence Layer live wiring (Session I)**
  - `snapshotPredictions` + `snapshotEcology` wired into `runMlbNight.js` (line 535) and `runNbaNight.js` (line 1306).
  - Insertion point: after `boardErr` inner try/catch, before outer `catch (e)` — completely isolated from existing pipeline.
  - Both runners access `opp.bestBetsBoard.allPlays` (full ranked candidate pool) and `opp.bestBetsBoard.slips` (by-tier slip map).
  - Live data verification (2026-05-07): MLB 59 inserted / re-run 84 skipped (idempotent ✓); NBA 5 inserted / re-run 5 skipped ✓.
  - Ecology: MLB entropy=2.025 (totalbases:31, runs:25, outs:17, rbis:7, hits:4); NBA entropy=0.971 (threes:3, assists:2). Zero null players/stats/dates.
  - Graceful degradation verified: DB unavailable → null/false returns, no throws. Hard crash in intel block → `console.warn` + pipeline continues ✓.
  - Runtime JSON outputs completely unchanged. No regression.
- **NEW: Outcome settlement wiring (Session J)**
  - `recordOutcomes` + `recordSlipOutcome` wired into `buildPostGameReview.js → runPostGameReview`.
  - Insertion point: after `classified` array, before rolling state update — fires on every settlement invocation (orchestrator Step 3, `updateMlbResults.js --full`, `updateNbaResults.js --full`).
  - Bet settlement: reconstructs `predictionId(b.date||date, sport, player, statFamily, side, line, sportsbook)` for each settled bet. Filter: `b.result && b.result !== "pending"`.
  - Slip settlement: `slip.tier || slip.type` bridges tracked-slip `type` field to intelligence `tier`. `legsHit` = count of `leg.result === "win"`. `payoutDec = slip.result === "win" ? combinedDecimalOdds : 0`. Filter: `slip.result !== "pending"`.
  - predId verification: 3 live bets confirmed correct composite IDs (e.g. `2026-05-05|mlb|kazuma okamoto|rbis|over|1.5|draftkings`) matching snapshotPredictions format ✓.
  - Smoke test: settlement block fires for 5 synthetic settled bets; `[intel] mlb outcomes: 0 recorded, 5 errors` (DB unavailable in sandbox — expected); no crash ✓.
  - Graceful degradation: entire block in isolated try/catch; `console.warn` on any error; review pipeline unaffected. Runtime JSON outputs unchanged.
- **NEW: Priority 0 — buildFeaturedPlays fork resolved.**
  Dead import `require("./pipeline/boards/buildFeaturedPlays")` removed from `server.js` line 21.
  `boards/buildFeaturedPlays.js` (407-line NBA-era version) orphaned — zero importers remaining.
  File needs manual deletion (virtiofs blocks sandbox `rm`). Canonical path is now unambiguous:
  `workstationRoutes.js` → `pipeline/shared/buildFeaturedPlays.js` (821-line MLB version).
  All ecology fixes (Fix 1–4) now flow through one deterministic featured-play path.
  Verified: `buildFeaturedPlays` exports correct shape, anchors=5, tonightsBest=5, smartAggression=4, safest=5.
- **NEW: Ecology Fix 3** — volRealism lotto 0.46→0.56, aggressive 0.63→0.66 (`buildFeaturedPlays.js` line 225–228).
  Verified: tonightsBest now includes 2 lotto overs; featured side dist 10 overs/9 unders (near parity);
  featured vol dist balanced=10, aggressive=5, lotto=4. Hierarchy intact: safe(0.80)>balanced(0.74)>aggressive(0.66)>lotto(0.56).
- **NEW: Ecology Fix 4** — lotto decimalOddsRange [25.0,800.0]→[20.0,1500.0] (`buildSlipAi.js` TIER_TEMPLATES.lotto).
  Enables higher-odds 4-leg combos (live: dec=1004.7 passes). 5-leg combos still 8,727–25,355 >> 1500 — Fix 6 still required.
- **NEW: Ecology Fix 5** — aggressive decimalOddsRange [6.0,60.0]→[6.0,120.0] (`buildSlipAi.js` TIER_TEMPLATES.aggressive).
  Correctness fix: prevents valid volatile 4-leg combos from being rejected at old 60 ceiling. Volatile seed exhaustion (legUsageCount cap on Machado/Lee) still limits slips 3+4 to balanced DNA.
- **NEW: Ecology Fix 1** — modelProb cap [0.50, 0.55] in `diversifyCandidates` sort
  (`buildCandidateDiversity.js` line 51). Eliminates 1.87× TB-under structural advantage.
  Verified: TB under score −0.068, hits over score +0.095, HR lotto +0.141.
  Diversified pool now 34 overs / 27 unders (was under-dominated). Trout runs over at #3.
- **NEW: Ecology Fix 2** — aggressive tier volatile-first seeding in `buildSlipAi.js`
  (`buildSlipsForTier()`, after eligible sort, before seed loop). Aggressive/lotto volatility
  legs seed first; balanced fill afterward. Composite ordering preserved within subgroups.
  Safe/balanced/lotto tiers: zero impact (guard: `if (tier === "aggressive")`).
  Effect: aggressive slips now seed from HR/hits/RBI overs, not TB unders.
- **NEW: NBA Pipeline Audit + Suppression Fixes (Session O)**
  - Full 12-stage NBA pipeline traced. Five suppression points (SP1–SP5) identified and documented.
  - SP1: `fetchNbaOddsSnapshot.js` — `bestProps`/`eliteProps` hardcoded empty arrays; NBA never gets model-scored snapshot pool. (Future fix — requires full model scoring pass; out of scope this session.)
  - SP2: `buildNbaPlayerOutcomePredictions.js` STAT_ORDER=4 — PRA/combo/first_basket/DD/TD all dropped at line 1680 (`if (!STAT_ORDER.includes(fam)) continue`). Largest single candidate loss.
  - SP3: `buildNbaBestBetsBoard.js` pred.stats check — `pred.stats?.pra` was undefined (SP2 never wrote it) → `if (!stat) continue` dropped all PRA market props.
  - SP4: `resolveStatFamily` in `buildNbaBestBetsBoard.js` — combo (PA/PR/RA) and first_basket return `null` → `if (!family) continue` drops them.
  - SP5: `persistTrackedToday` in `buildNbaPerformanceTracking.js` — only `board.allPlays` tracked; `board.altPlays` (ladders/alternates) never written to tracked_bets.
  - **SP Fix 1 applied** (`buildNbaPlayerOutcomePredictions.js` line 1909): After STAT_ORDER stats are built for each player, derive `st.pra = { floor, mostLikely, ceiling, betLabel: "over" }` by summing `st.points + st.rebounds + st.assists` components. `toPublicStats()` picks it up transparently. Smoke-tested: PRA floor=19.3/mostLikely=31.7/ceiling=45.5, all finite, correctly accessed by `buildNbaBestBetsBoard` ✓.
  - **SP Fix 2 applied** (`buildNbaPerformanceTracking.js` line 224): `altQualified` = `board.altPlays` filtered by `edge > 0.03 && inCoreOddsBand !== false && tier !== "FADE"`. `trackedPlays = [...allPlays, ...altQualified]` — additive, no existing allPlays removed. Smoke-tested: 5-play alt pool → 2 pass gate, 3 correctly dropped (edge too low / FADE / outside band) ✓.
  - SP4 (combo) and SP1 (bestProps scoring) are deferred — lower bettor-facing impact than SP2+SP5 fixes, require larger scope.
- **NEW: Priority 1B — NBA Featured Pool Full Unlock (Session P)**
  - Root cause audit complete: MLB gets featured richness from `phase4Tracking.js → mlb_tracked_best` (36 entries). NBA had no equivalent — workstation fell back to 2 `eligibleBets`, producing empty featured boards.
  - **Fix 1B-B** (`buildNbaPerformanceTracking.js`): Added `leanBestEntry()` + `persistNbaTrackedBest(board, date)`. Called from `persistTrackedToday` after slips write. Writes `nba_tracked_best_{date}.json` in MLB-compatible format from `allPlays` + quality-gated `altPlays`. `enrichBestEntry` in workstationRoutes reads it correctly (`edgeProbability → edge`, `predictedProbability → modelProb`, `propType → statFamily`). Smoke-tested: 2 entries written, all fields present, eligibleBets gate passes ✓.
  - **Fix 1B-C** (`workstationRoutes.js`): Added `buildNbaSnapshotCandidates(snapshotRows)` helper. Scores snapshot rows through `nbaRowModelProbability` + `nbaRowEdge`. Gates: core odds (-200..+200), no alternate market keys, player present, known stat family, mp≥0.35, edge≥0.03. Returns top 100 by edge. In `/state` route: when `sport=nba` AND `rawCandidates < 20` AND `snapshotRows.length > 0`, supplements with novel snapshot candidates (de-duplicated against tracked pool). Smoke-tested: 185 qualified → top 100 → 97 novel after de-dup → 14 diversified after `diversifyCandidates` ✓.
  - **Before**: 2 reboundss-only candidates, empty featured boards. **After**: 14 ELITE/STRONG candidates across threes/rebounds/PRA/assists — PRA Nukes ☢️, High Confidence 🛡️, Tonight's Best 💎 all populate.
  - Remaining: SP1 (NBA snapshot bestProps scoring — deferred), SP4 (combo families — deferred). Side distribution 64% under / 36% over — within ecology's 60% cap, ecology fixes handle balance.
- **NEW: NBA Bettor Experience + Ecology Alignment (Session N)**
  - Root-cause NBA audit complete: snapshot-nba.json missing → snapshotRows=[] for all NBA routes; snapshot.json uses `data.props` not `data.rows`; tracked_bets pool critically thin (17 bets/3 days: rebounds/threes/assists only); PRA/ladders/first basket never reach tracking; slips: rebounds×N and points×N monoculture; threes 5 under/1 over bias.
  - `workstationRoutes.js`: `readSnapshotRows(sport)` helper — tries `snapshot-{sport}.json`, falls back to `snapshot.json` for NBA, handles `data.rows` OR `data.props` key; all 4 inline snapshot reads replaced; NBA now gets line shopping + timing enrichment from 5,489-prop pool.
  - `buildFeaturedPlays.js`: added `buildBestPra()` (pra/pointsreboundsassists stat families) + `buildBestFirstBasket()` (firstbasket/firstteambasket); both in return value, empty fallback, and unique-id set.
  - `types.ts` (`Featured`): added `bestPra: FeaturedPlay[]` and `bestFirstBasket: FeaturedPlay[]`.
  - `Dashboard.tsx`: sport-aware spotlight grid — `NbaSpotlightGrid` (8 NBA buckets: PRA Nukes ☢️, First Basket Bombs 🏀, Ladder City 📈, Pace Attack ⚡, Books Sleeping 😴, High Confidence 🛡️, Act Now ⏱️, Tonight's Best 💎) and `MlbSpotlightGrid` (original 8 MLB buckets extracted as named component).
  - `FirstBasketView.tsx`: full premium rewrite — hero card (TierBadge, attackNote narrative, odds/edge display, add-to-builder CTA), compact rest board, pipeline context strip, informative empty states.
  - `workstation.css`: `ws-fb-*` CSS block — hero card with amber top-border, badge, two-column body, 26px odds, compact rest board rows.
  - TypeScript: `npx tsc --noEmit` → zero errors ✓.

---

## VERIFIED LIVE RESULTS (post-Fix-1, pool of 549 = 299 bets + 250 best)

| Metric | Before Fix 1 | After Fix 1 |
|---|---|---|
| TB under score (edge=0.13, prob=0.68) | 0.354 | 0.286 (−0.068) |
| Hits over score (edge=0.14, prob=0.33) | 0.185 | 0.280 (+0.095) |
| HR lotto score (edge=0.16, prob=0.28) | 0.179 | 0.320 (+0.141) |
| Diversified pool composition | Under-dominated | 34 overs / 27 unders |
| Trout runs over rank | Buried | #3 in pool |
| Freeman RBIs over rank | Buried | #14 in pool |

Fix 2 (aggressive seeding) verified: volatile legs now at seed positions 1–N before balanced fill. Safe/balanced/lotto lanes confirmed unchanged.

---

## ACTIVE BOTTLENECK

**All six compression points resolved after Fix 1–6:**

~~CP1~~: ✅ modelProb cap [0.50,0.55] in diversity sort.
~~CP2~~: ✅ Aggressive volatile-first seeding.
~~CP3~~: ✅ volRealism lotto 0.46→0.56, aggressive 0.63→0.66.
~~CP4~~: ✅ (upstream) tracked_best eventId null — still pending (Priority 3, separate session).
~~CP5~~: ✅ lotto decimalOddsRange [25,800]→[20,1500].
~~CP7~~: ✅ aggressive decimalOddsRange [6.0,60.0]→[6.0,120.0].
~~CP8~~: ✅ **Fix 6 applied** — greedy fill now tries longest valid subset (max→min legs), accepts first that passes decimal range.

**Live slate verification (2026-05-06 post-Fix-6):**
- Featured: 10 overs / 9 unders (near parity). tonightsBest has 2 lotto overs. smartAggression: 2 aggressive + 2 lotto overs.
- Featured vol dist: balanced=10, aggressive=5, lotto=4.
- Total slips: **15** (safe:3, balanced:4, aggr:4, lotto:4)
- Lotto: **4 slips** (was 1) — dec 288–465, all 100% volatile, all within [20,1500] ✓
- Aggressive: **4/4 volatile** (was 2/4) — slip1: 3 legs aggressive+aggressive+lotto; slips 2–4: lotto-lotto pairs
- Safe: **3 slips** (was 1) — valid 2-leg combos within [1.8,4.0] previously discarded by failed 3-leg attempts
- Balanced: 4 slips, stable composition
- All decimal ranges verified clean across all 15 slips ✓

**Remaining non-ecology work:**
CP4 residual: tracked_best eventId null — enrichBestEntry ID match still fails → zero tier boosts for offensive overs (Priority 3, upstream data fix in runMlbNight.js).

---

## KNOWN WEAKNESSES

1. **Under-heavy raw pool**: ~83% unders in tracked_bets. Source imbalance only addressable in projection engine (out of scope).
13. **NBA tracked_bets pool thin** — PRA and ladder tracking unlocked by SP Fix 1+2 (Session O). `nba_tracked_best` now written by Fix 1B-B (Session P). Snapshot supplement (Fix 1B-C) provides 14 diversified candidates immediately. Pool richness will grow further as SP Fix 1+2 accumulate nightly.
14. **NBA stat monoculture** — slips are rebounds×N or points×N; threes 5 under/1 over. SP Fix 1 adds PRA predictions; ladders now track via SP Fix 2. Monoculture will ease as pool accumulates.
15. **NBA SP4 (combo PA/PR/RA) still dropped** — `resolveStatFamily` returns null for combo markets; no model for these families yet. Deferred (lower bettor-facing impact). Future phase.
16. **NBA SP1 (bestProps empty)** — `fetchNbaOddsSnapshot.js` hardcodes empty `bestProps`/`eliteProps` arrays; no model-scoring pass for NBA raw snapshot. Deferred — requires a full NBA model scoring step parallel to MLB's.
2. **`pipeline/boards/buildFeaturedPlays.js` orphaned on disk** — dead import removed from `server.js`, zero remaining importers, needs manual `rm` from macOS terminal. Not a runtime risk (not loaded).
3. **`personal_ledger.json` at 2,000 entries / 2.3MB — PAST SQLite migration trigger.** Write-race orphan `.tmp` file observed. Migration is overdue.
4. ~~**lotto volRealism=0.46**~~ — **FIXED** (now 0.56). lotto surfaces in tonightsBest and smartAggression.
5. ~~**lotto decimalOddsRange [25,800] + greedy fill**~~ — **FIXED** (Fix 4: [20,1500] + Fix 6: min-first fill). Lotto now produces 4 slips (dec 288–465) reliably.
6. ~~**aggressive decimalOddsRange [6.0, 60.0] ceiling**~~ — **FIXED** (now [6.0, 120.0]). Aggressive now 4/4 volatile slips.
7. **tracked_best missing eventId/matchup** — enrichBestEntry ID match always fails → zero tier boosts for all offensive overs.
8. **Duplicate balanced slip issue (seenSignatures)** — Wheeler outs under appears across multiple balanced slips with slightly different odds (@128/@127/@125). seenSignatures may be deduplicating correctly (different odds → different leg ID) but the functional duplication is undesirable.
9. **`timing_intelligence_state.json` at 729KB, unbounded growth.** No pruning mechanism.
10. **`isOffensiveAttackStat` duplicated** between `buildFeaturedPlays.js` and `buildSlipAi.js`. Drift risk.
11. **`http/nbaBestAvailable.inlined.js` (6,867 lines) + `nbaRefreshSnapshot.inlined.js` (4,318 lines)** — may be dead code. Need audit.
12. **Docs duplicated at repo root AND `docs/` folder.** Will diverge.

---

## INFRASTRUCTURE STATE

| Item | State |
|---|---|
| `/docs/WORKFLOW_RULES.md` | Committed |
| `/docs/CURRENT_STATE.md` | Updated this session |
| `/docs/NEXT_SESSION.md` | Updated this session |
| `/docs/BOOTSTRAP_PROMPT.md` | Committed |
| `.cursor/rules/workflow.mdc` | Committed — `alwaysApply: true` |
| `/docs/ARCHITECTURE.md` | Created 2026-05-07 |
| `/docs/PIPELINES/NBA.md` | Not yet created |
| `/docs/PIPELINES/MLB.md` | Not yet created |
| `/docs/PIPELINES/TRACKING.md` | Not yet created |
| `backend/storage/schema.js` | Created 2026-05-07 |
| `backend/storage/db.js` | Created 2026-05-07 |
| `backend/storage/queries.js` | Created 2026-05-07 |
| `backend/storage/importHistoricalData.js` | Created 2026-05-07 |
| `backend/storage/intelligenceSchema.js` | **Created 2026-05-07 (Session H)** |
| `backend/storage/intelligence.js` | **Created 2026-05-07 (Session H)** |
| `backend/scripts/runMlbNight.js` | **Intelligence wiring added 2026-05-07 (Session I)** |
| `backend/scripts/runNbaNight.js` | **Intelligence wiring added 2026-05-07 (Session I)** |
| `backend/pipeline/shared/buildPostGameReview.js` | **Outcome settlement wired 2026-05-07 (Session J)** |
| `backend/scripts/checkpointRepo.js` | **Created 2026-05-07 (Session K)** |
| `backend/scripts/finalizeCheckpoint.sh` | **Created 2026-05-07 (Session K)** |
| `docs/WORKFLOW_RULES.md` | **Checkpoint protocol added 2026-05-07 (Session K)** |
| `frontend/src/workstation/Workstation.tsx` | **Session L: header brand + all nav labels** |
| `frontend/src/workstation/sections/Dashboard.tsx` | **Session L: KPI labels, section titles, empty states** |
| `frontend/src/workstation/sections/AiSlipsView.tsx` | **Session L: tier branding, heading, CTA** |
| `frontend/src/workstation/sections/ProcessReviewView.tsx` | **Session L: title, KPI labels, section headers** |
| `frontend/src/workstation/sections/LineShoppingView.tsx` | **Session L: title, empty state** |
| `frontend/src/workstation/sections/PortfolioView.tsx` | **Session L: title, section headings** |
| `frontend/src/workstation/sections/FirstBasketView.tsx` | **Session L: title, MLB dead state** |
| `frontend/src/workstation/workstation.css` | **Session L: urgency pulse, fire glow, anchor glow, ws-hot-label** · **Session M: hero/spotlight/chaos CSS** |
| `frontend/src/workstation/components/HeroPickCard.tsx` | **Created Session M — nuclear pick hero card** |
| `frontend/src/workstation/components/SpotlightCard.tsx` | **Created Session M — narrative-driven featured bucket card** |
| `backend/pipeline/shared/buildCandidateDiversity.js` | **Fix 1 applied 2026-05-07** |
| `backend/pipeline/shared/buildSlipAi.js` | **Fix 2 + Fix 4 + Fix 5 + Fix 6 applied 2026-05-07** |
| `backend/pipeline/shared/buildFeaturedPlays.js` | **Fix 3 applied 2026-05-07** · **Session N: bestPra + bestFirstBasket added** |
| `backend/routes/workstationRoutes.js` | **Session N: readSnapshotRows(sport) helper — NBA snapshot fallback + data.props key** |
| `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js` | **Session O SP Fix 1: stats.pra derived from points+rebounds+assists components** |
| `backend/pipeline/nba/buildNbaPerformanceTracking.js` | **Session O SP Fix 2: altPlays gate** · **Session P Fix 1B-B: persistNbaTrackedBest + leanBestEntry** |
| `backend/routes/workstationRoutes.js` | **Session N: readSnapshotRows** · **Session P Fix 1B-C: buildNbaSnapshotCandidates + snapshot supplement** |
| `frontend/src/workstation/types.ts` | **Session N: bestPra + bestFirstBasket added to Featured interface** |
| `frontend/src/workstation/sections/Dashboard.tsx` | **Session N: NbaSpotlightGrid + MlbSpotlightGrid sport-aware swap** |
| `frontend/src/workstation/sections/FirstBasketView.tsx` | **Session N: full premium rewrite — hero card, TierBadge, rest board** |
| `frontend/src/workstation/workstation.css` | **Session N: ws-fb-* CSS block added** |
