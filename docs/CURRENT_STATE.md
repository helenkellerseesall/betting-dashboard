# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-07 (Session E: Portfolio concentration + volRealism audit complete — Fix 3/4/5/6 root causes proven)_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | Priority 0 buildFeaturedPlays fork + Fix 1 + Fix 2 (pending — lock file + manual file deletion required) |
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
| Line shopping (implied spread ranking) | Working | `routes/workstationRoutes.js` |
| Portfolio optimizer | Working | `pipeline/shared/buildPortfolioOptimizer.js` |
| Market timing intelligence | Working | `pipeline/shared/buildMarketTimingIntelligence.js` |
| CLV tracking | Working | `pipeline/shared/buildClv.js` |
| Personal ledger | Working | `pipeline/shared/buildPersonalLedger.js` |
| Post-game review engine | Working | `pipeline/shared/buildPostGameReview.js` |
| Nightly orchestrator | Working | `pipeline/shared/buildNightlyOrchestrator.js` |
| Workstation frontend | Working | `frontend/src/workstation/` |

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
| First basket | `sections/FirstBasketView.tsx` |

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
- Anchor display: `sortAnchorsForDisplay()` interleaves sides (U·O·U·O·U pattern)

AI slip scoring (`buildSlipAi.js → scoreLeg`):
- Same modelProb cap [0.50, 0.55] as featured
- `tierBoost` halved: ELITE 0.05 / STRONG 0.025

AI slip seeding (`buildSlipAi.js → buildSlipsForTier`):
- **NEW (Fix 2): aggressive tier volatile-first seeding** — aggressive/lotto volatility legs seed before balanced/safe fill. Composite ordering preserved within each subgroup. Safe/balanced/lotto tiers unaffected.
- Premium-edge override: legs with `modelProb >= 0.50 AND edge >= 0.12` bypass `allowedVolatility` and `minModelProb` gates (safe tier). `maxOdds 150` cap still applies.

Featured `buildSafest`:
- Premium-edge override: balanced/aggressive plays with `modelProb >= 0.50 AND edge >= 0.12` qualify alongside standard safe-volatility + 0.55 modelProb gate.

---

## CURRENT PHASE

**Phase: INTEGRITY + DE-RISK — Phase 7D (Priority 0 done; Fix 3 + Fix 4 unblocked)**

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
- **NEW: Priority 0 — buildFeaturedPlays fork resolved.**
  Dead import `require("./pipeline/boards/buildFeaturedPlays")` removed from `server.js` line 21.
  `boards/buildFeaturedPlays.js` (407-line NBA-era version) orphaned — zero importers remaining.
  File needs manual deletion (virtiofs blocks sandbox `rm`). Canonical path is now unambiguous:
  `workstationRoutes.js` → `pipeline/shared/buildFeaturedPlays.js` (821-line MLB version).
  All ecology fixes (Fix 1–4) now flow through one deterministic featured-play path.
  Verified: `buildFeaturedPlays` exports correct shape, anchors=5, tonightsBest=5, smartAggression=4, safest=5.
- **NEW: Ecology Fix 1** — modelProb cap [0.50, 0.55] in `diversifyCandidates` sort
  (`buildCandidateDiversity.js` line 51). Eliminates 1.87× TB-under structural advantage.
  Verified: TB under score −0.068, hits over score +0.095, HR lotto +0.141.
  Diversified pool now 34 overs / 27 unders (was under-dominated). Trout runs over at #3.
- **NEW: Ecology Fix 2** — aggressive tier volatile-first seeding in `buildSlipAi.js`
  (`buildSlipsForTier()`, after eligible sort, before seed loop). Aggressive/lotto volatility
  legs seed first; balanced fill afterward. Composite ordering preserved within subgroups.
  Safe/balanced/lotto tiers: zero impact (guard: `if (tier === "aggressive")`).
  Effect: aggressive slips now seed from HR/hits/RBI overs, not TB unders.

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

**Remaining ecology compression points (Fix 3 + Fix 4 + Fix 5 + Fix 6 pending — all root causes proven):**

CP3: `buildFeaturedPlays.js` volRealism — lotto=0.46, textureBoost (+0.030) can't cover the gap. Fix: raise lotto→0.56, aggressive→0.66.
CP4: `buildSlipAi.js` lotto decimalOddsRange [25,800] — greedy fill to 5 legs produces combined decimal ~3,061; only 1 slip survives. Fix: widen to [20,1500].
CP5: tracked_best missing eventId — zero tier boosts for offensive overs (upstream data quality).
**NEW CP7: `buildSlipAi.js` aggressive decimalOddsRange [6.0, 60.0] ceiling** — 4-leg volatile combos blow past 60.0; volatile-seeded slips 3+4 default to balanced unders even after Fix 2. Fix: widen ceiling to 120.0.
**NEW CP8: Greedy fill architecture in `buildSlipsForTier`** — fills to legCountRange[1] max legs before checking combined decimal range. Causes near-total lotto slip failure. Fix: try min legs first, work up to max.

Fix 1 + Fix 2 address the two highest-impact compression points. Remaining under-heaviness in the raw pool (83% unders) is a projection-engine artifact, not addressable at the curation layer.

**Live slip audit (2026-05-06, 9 slips: safe:1, balanced:3, aggr:4, lotto:1):**
- Safe: Corbin outs over(balanced) + Buxton rbis under(balanced)
- Balanced: 3 slips — all unders except Urena ks over; slips 2+3 are DUPLICATES (seenSignatures bug)
- Aggressive: slips 1+2 have volatile seeds (Machado/Lee runs overs); slips 3+4 are 100% balanced unders (legUsageCount cap exhausts Machado/Lee by slip 2)
- Lotto: only 1 slip (Freeman TB + Chourio TB + Machado runs + Lee runs) — 5-leg combos all fail decimal ceiling

---

## KNOWN WEAKNESSES

1. **Under-heavy raw pool**: ~83% unders in tracked_bets. Source imbalance only addressable in projection engine (out of scope).
2. **`pipeline/boards/buildFeaturedPlays.js` orphaned on disk** — dead import removed from `server.js`, zero remaining importers, needs manual `rm` from macOS terminal. Not a runtime risk (not loaded).
3. **`personal_ledger.json` at 2,000 entries / 2.3MB — PAST SQLite migration trigger.** Write-race orphan `.tmp` file observed. Migration is overdue.
4. **lotto volRealism=0.46** — textureBoost (+0.030) can't compensate the 0.028 weighted gap vs balanced. Fix 3 pending.
5. **lotto decimalOddsRange [25,800] + greedy fill to max legs** — combined decimal ~3,061 on natural 5-leg build; only 1 of ~455 3-leg combos survives. Fix 4 + Fix 6 pending.
6. **aggressive decimalOddsRange [6.0, 60.0] ceiling** — 4-leg volatile combos exceed 60.0; Fix 2 seeds volatile first but can't survive ceiling. Fix 5 pending.
7. **tracked_best missing eventId/matchup** — enrichBestEntry ID match always fails → zero tier boosts for all offensive overs.
8. **Duplicate balanced slip bug (seenSignatures)** — balanced slips 2+3 are identical despite unique IDs. seenSignatures not deduplicating correctly. Root cause: likely normalization quirk producing different IDs for same logical bet.
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
| `backend/pipeline/shared/buildCandidateDiversity.js` | **Fix 1 applied 2026-05-07** |
| `backend/pipeline/shared/buildSlipAi.js` | **Fix 2 applied 2026-05-07** |
