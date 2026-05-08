# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-08 (Session R: NBA payload wiring audit — Fix R1: `handleNbaBestAvailableGet` now returns `bestAvailable` wrapper with `best/elite/strong/ladders/firstBasket/aiSlips/featured/wsCandidates`; smoke test 24 candidates / 22 featured / 11 slips confirmed; TERM 1 restart required for both Session Q + R)_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | e076871 (Session I) — Sessions H–R staged, pending finalization via finalizeCheckpoint.sh |
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
| **NBA aiCandidates supplement** | **Fixed (Session Q Fix Q1) — snapshot wired into aiCandidates + featured/slip pools** | **`routes/workstationRoutes.js`** |
| **`/api/best-available` NBA payload** | **Fixed (Session R Fix R1) — `bestAvailable` wrapper + workstation pipeline added to `handleNbaBestAvailableGet`** | **`http/nbaIsolatedRoutes.js`** |
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

## RUNTIME TRACKING FILES (today: 2026-05-08)

| File | Contents |
|---|---|
| `mlb_tracked_bets_2026-05-08.json` | MLB bets |
| `mlb_tracked_best_2026-05-08.json` | HR/TB/RBI overs attack board |
| `mlb_tracked_slips_2026-05-08.json` | AI-generated slip catalog |
| `nba_tracked_bets_2026-05-08.json` | 2 bets (rebounds only — thin; SP Fix 1+2 accumulate nightly) |
| `personal_ledger.json` | Flat JSON personal bet ledger (~2,000 entries — SQLite migration OVERDUE) |
| `book_intelligence_state.json` | Sportsbook CLV/profile rolling state |
| `snapshot.json` | 9.47MB, 5,209 rows (876 base non-alt NBA props, 4,333 alt/ladder) |

---

## CURRENT ORCHESTRATION

Candidate diversification (`buildCandidateDiversity.js → diversifyCandidates`):
- `maxPerPlayer: 3` · `maxPerGame: 7 (MLB) / 12 (NBA)` · `maxPerStat: 10` · `maxPerStatSide: 6`
- **Fix Q3**: NBA playoff slates get `nbaPerGame = 12` vs MLB's `7` — lifts hard 14-candidate ceiling to 24+
- **Fix 1 (Session L)**: modelProb capped at [0.50, 0.55] in diversity sort — eliminates 1.87× TB-under structural advantage

Featured side-balance (`buildFeaturedPlays.js → pickDiversified`):
- `maxSideFraction: 0.60` (anchors: 0.55) — fill pass relaxes side cap if short
- Anchors `maxPerGame: 2` — allows cross-side picks in same game

Volatility classification (`buildPortfolioOptimizer.js → VOLATILITY_RULES`):
- `threes < 3.5 → balanced`, `threes >= 3.5 → lotto`, `PRA/combo → aggressive`, `odds >= 350 → lotto`
- **NOTE**: `classifyVolatility(raw)` in `normalizeCandidate` overrides snapshot-set `volatility` field.
  PRA snapshot volatility `"lotto"` (Fix Q4) → overridden to `"aggressive"` by classifyVolatility.
  Effect: PRA still qualifies for lotto slips (allowedVolatility includes "aggressive"), but can't form [20,1500] combos at base odds (dec ~5–9 for 3-leg PRA). Lotto slips remain empty for NBA.

NBA snapshot candidate pipeline (`workstationRoutes.js → buildNbaSnapshotCandidates`):
- Gates: core odds (-200..+200), no alternate/ladder market keys, known stat family, mp≥0.35, edge≥0.03
- **Fix Q2**: Deduplicates by (player|statFamily|side) keeping best-edge entry per triple
- Top 150 by edge (was 100)
- **Fix Q1**: Supplement cached once (`snapSupplement`), wired into BOTH `supplementedCandidates` (portfolio) AND `aiCandidatesRaw` (featured/slips) — this was the root fix

Composite scoring (`buildFeaturedPlays.js → scoreCandidate`):
- `f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)` — caps modelProb compounding
- `tierBoost`: ELITE 0.04 / STRONG 0.02
- `textureBoost`: aggressive/lotto edge>0.045 → 0.018; offensive over edge>0.05 → 0.020; aggressive offensive over → 0.030
- `volRealism (Fix 3)`: safe=0.80, balanced=0.74, aggressive=0.66, lotto=0.56

AI slip scoring (`buildSlipAi.js → scoreLeg`):
- Same modelProb cap [0.50, 0.55] as featured
- `tierBoost` halved: ELITE 0.05 / STRONG 0.025
- `TIER_TEMPLATES (Fix 4+5)`: aggressive decimalOddsRange [6.0,120.0]; lotto decimalOddsRange [20.0,1500.0]

AI slip seeding (`buildSlipAi.js → buildSlipsForTier`):
- Aggressive tier volatile-first seeding — aggressive/lotto legs seed first
- Min-first greedy fill — tries longest valid subset (max→min legs)

---

## CURRENT PHASE

**Phase: INTEGRITY + DE-RISK — Phase 7R (Fix 1–6 + Intelligence Layer + Checkpoint + Bettor UX Phase 1+2+3 + NBA Pipeline Audit + SP Fix 1+2 + Priority 1B + Session Q NBA Density + Session R Payload Wiring)**

### Session R fix (2026-05-08) — `http/nbaIsolatedRoutes.js`:

| Fix | Description | Impact |
|---|---|---|
| **Fix R1** | `handleNbaBestAvailableGet` previously returned `{ nbaOpportunityBoard, nbaInsightBoard }` with no `bestAvailable` wrapper. App.tsx `payload?.bestAvailable` was always `undefined`. Added: `buildNbaBestAvailableWsCandidates()` helper to convert `slices.corePropsBoard` rows → Candidate format; called `diversifyCandidates`, `buildFeaturedPlays`, `buildAiSlips` inside handler; reshaped `res.json` to include `bestAvailable: { best, elite, strong, ladders, firstBasket, aiSlips, featured, wsCandidates }` | `/api/best-available?sport=nba` now returns populated payload |

**Session R verified results (smoke test, 2026-05-08, correct snapshot path):**

| Metric | Value |
|---|---|
| corePropsBoard rows | 260 |
| qualified raw | 107 |
| deduped candidates | 65 |
| wsCandidates (diversified) | 24 |
| Featured anchors | 4 |
| Featured tonightsBest | 4 |
| Featured bestPra | 4 |
| Featured bestLadders | 4 |
| Featured smartAggression | 2 |
| Featured safest | 4 |
| AI slips (safe) | 3 |
| AI slips (balanced) | 4 |
| AI slips (aggressive) | 4 |
| AI slips (lotto) | 0 |
| **Total featured** | **22** |
| **Total slips** | **11** |

**⚠️ TERM 1 restart required** — both Session Q (`workstationRoutes.js`) and Session R (`nbaIsolatedRoutes.js`) changes are on disk but the running server has old cached modules. Restart TERM 1 to activate.

### Session Q fixes (2026-05-08) — all in `workstationRoutes.js`:

| Fix | Description | Impact |
|---|---|---|
| **Fix Q1** | Cached `snapSupplement = buildNbaSnapshotCandidates(snapshotRows)` once; wired into `aiCandidatesRaw` (featured + slip pools). Previous sessions only wired into portfolio path. | Root fix — aiCandidates 2→24 |
| **Fix Q2** | `buildNbaSnapshotCandidates` deduplicates by (player\|statFamily\|side), keeps best-edge triple. 187 raw qualified → 83 unique combos. | Maximizes distinct positions for diversity algo |
| **Fix Q3** | `nbaPerGame = sport === "nba" ? 12 : 7` — NBA playoff slates use 12/game ceiling vs MLB's 7. | Lifts hard cap from 14 to 24 candidates |
| **Fix Q4** | Snapshot rows: PRA → `volatility:"lotto"`, threes/first_basket → `"aggressive"`, others → `"balanced"` | Affects diversity sort; overridden by classifyVolatility in slip/featured normalization |

### Session Q verified results (smoke tests, 2026-05-08):

| Metric | Before | After |
|---|---|---|
| aiCandidates | 2–4 | 24 |
| Candidate families | rebounds×2 | threes:10, assists:3, rebounds:4, pra:3, points:4 |
| Candidate tiers | — | ELITE:14, STRONG:10 |
| Featured anchors | 0 | 4 |
| Featured tonightsBest | 0 | 4 |
| Featured PRA Nukes ☢️ | 0 | 3 |
| Featured Ladder City 📈 | 0 | 4 |
| Featured smartAggression | 0 | 3 |
| Featured safest | 0 | 4 |
| **Total featured plays** | **0** | **22** |
| AI slips (safe) | 0 | 3 |
| AI slips (balanced) | 0 | 4 |
| AI slips (aggressive) | 0 | 4 |
| AI slips (lotto) | 0 | 0 (bottleneck — see below) |
| **Total AI slips** | **0** | **11** |

---

## ACTIVE BOTTLENECK

**NBA lotto slips remain empty.** PRA at base odds (typically -120 to +150) forms 3-leg combos at dec ~5–9, below lotto tier's [20, 1500] minimum. classifyVolatility maps PRA → `aggressive` (not `lotto`), so lotto slip `allowedVolatility: ["aggressive","lotto"]` accepts PRA legs but dec range kills them. Only solvable by: (a) wiring higher-odds NBA alt-line or combo markets into the pool, or (b) allowing PRA-heavy 4-leg combos to clear dec≥20.

**First basket bucket empty.** `first_basket` family not present in base snapshot props (all are alternate markets). Requires `altPlays` accumulation from `runNbaNight.js` live runs over future days.

**All MLB ecology compression points resolved (Fix 1–6).**

---

## KNOWN WEAKNESSES

1. **Under-heavy raw NBA pool**: ~67% unders in snapshot-qualified candidates. Hash-based model produces higher edges for unders (systematic under-bias). Source imbalance only addressable in projection engine.
2. **NBA lotto slips empty** — PRA base-odds dec ~5–9 < lotto minimum [20,1500]. New Priority.
3. **NBA first basket bucket empty** — no `first_basket` family in base snapshot props; needs alt market accumulation.
4. **NBA smartAggression limited** — only PRA gets `aggressive` classification (classifyVolatility); threes → `balanced`. Only 3 candidates for smartAggression bucket.
5. **NBA tracked_bets pool thin** — 2 bets today. SP Fix 1+2 (Session O) accumulate PRA+ladder nightly. Pool richness grows incrementally.
6. **NBA SP4 (combo PA/PR/RA) still dropped** — `resolveStatFamily` returns null for combo markets. Deferred.
7. **NBA SP1 (bestProps empty)** — `fetchNbaOddsSnapshot.js` hardcodes empty `bestProps`/`eliteProps`. Deferred.
8. **`pipeline/boards/buildFeaturedPlays.js` orphaned on disk** — needs manual `rm` from macOS terminal. Not a runtime risk.
9. **`personal_ledger.json` at ~2,000 entries — PAST SQLite migration trigger.** Write-race orphan `.tmp` file observed. Migration is OVERDUE.
10. **tracked_best missing eventId/matchup** — enrichBestEntry ID match always fails → zero tier boosts for offensive overs.
11. **Duplicate balanced slip issue (seenSignatures)** — functional dedup of same player at slightly different odds undesirable.
12. **`timing_intelligence_state.json` at 729KB, unbounded growth.** No pruning mechanism.
13. **`isOffensiveAttackStat` duplicated** between `buildFeaturedPlays.js` and `buildSlipAi.js`. Drift risk.
14. **Under-heavy raw MLB pool**: ~83% unders in tracked_bets. Source imbalance only addressable in projection engine.

---

## INFRASTRUCTURE STATE

| Item | State |
|---|---|
| `/docs/WORKFLOW_RULES.md` | Committed |
| `/docs/CURRENT_STATE.md` | **Updated this session (Session Q)** |
| `/docs/NEXT_SESSION.md` | **Updated this session (Session Q)** |
| `/docs/BOOTSTRAP_PROMPT.md` | Committed |
| `.cursor/rules/workflow.mdc` | Committed — `alwaysApply: true` |
| `/docs/ARCHITECTURE.md` | Created 2026-05-07 |
| `backend/storage/schema.js` | Created 2026-05-07 |
| `backend/storage/db.js` | Created 2026-05-07 |
| `backend/storage/queries.js` | Created 2026-05-07 |
| `backend/storage/importHistoricalData.js` | Created 2026-05-07 |
| `backend/storage/intelligenceSchema.js` | Created 2026-05-07 (Session H) |
| `backend/storage/intelligence.js` | Created 2026-05-07 (Session H) |
| `backend/scripts/runMlbNight.js` | Intelligence wiring added 2026-05-07 (Session I) |
| `backend/scripts/runNbaNight.js` | Intelligence wiring added 2026-05-07 (Session I) |
| `backend/pipeline/shared/buildPostGameReview.js` | Outcome settlement wired 2026-05-07 (Session J) |
| `backend/scripts/checkpointRepo.js` | Created 2026-05-07 (Session K) |
| `backend/scripts/finalizeCheckpoint.sh` | Created 2026-05-07 (Session K) |
| `backend/pipeline/shared/buildCandidateDiversity.js` | Fix 1 applied 2026-05-07 |
| `backend/pipeline/shared/buildSlipAi.js` | Fix 2 + Fix 4 + Fix 5 + Fix 6 applied 2026-05-07 |
| `backend/pipeline/shared/buildFeaturedPlays.js` | Fix 3 applied 2026-05-07 · Session N: bestPra + bestFirstBasket |
| `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js` | Session O SP Fix 1: stats.pra derived |
| `backend/pipeline/nba/buildNbaPerformanceTracking.js` | Session O SP Fix 2: altPlays gate · Session P Fix 1B-B: persistNbaTrackedBest |
| `backend/routes/workstationRoutes.js` | Session N: readSnapshotRows · Session P Fix 1B-C: buildNbaSnapshotCandidates · **Session Q Fix Q1–Q4: aiCandidates supplement + dedup + nbaPerGame:12 + PRA volatility** |
| `backend/http/nbaIsolatedRoutes.js` | **Session R Fix R1: `bestAvailable` wrapper + workstation pipeline (candidates/featured/slips) added to `handleNbaBestAvailableGet`** |
| `frontend/src/workstation/types.ts` | Session N: bestPra + bestFirstBasket |
| `frontend/src/workstation/sections/Dashboard.tsx` | Session N: NbaSpotlightGrid + MlbSpotlightGrid |
| `frontend/src/workstation/sections/FirstBasketView.tsx` | Session N: full premium rewrite |
| `frontend/src/workstation/workstation.css` | Sessions L+M+N: full bettor UX CSS |
| `backend/pipeline/boards/buildFeaturedPlays.js` | **Orphaned — needs manual `rm` from macOS terminal** |
