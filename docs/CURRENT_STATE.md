# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-06_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | `f06f435` — Add WORKFLOW_RULES.md |
| Repo health | Stable. No known broken tests or syntax errors. |

---

## RUNTIME ARCHITECTURE

```
TERM 1: Node/Express backend — port 4000
  └── backend/server.js (or app.js)
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
| MLB nightly pipeline | ✅ Working | `scripts/runMlbNight.js` |
| NBA nightly pipeline | ✅ Working | `scripts/runNbaNight.js` |
| AI Slip construction | ✅ Working | `pipeline/shared/buildSlipAi.js` |
| Featured plays (anchors/supports) | ✅ Working | `pipeline/shared/buildFeaturedPlays.js` |
| Line shopping (implied spread ranking) | ✅ Working | `routes/workstationRoutes.js` |
| Portfolio optimizer | ✅ Working | `pipeline/shared/buildPortfolioOptimizer.js` |
| Market timing intelligence | ✅ Working | `pipeline/shared/buildMarketTimingIntelligence.js` |
| CLV tracking | ✅ Working | `pipeline/shared/buildClv.js` |
| Personal ledger | ✅ Working | `pipeline/shared/buildPersonalLedger.js` |
| Post-game review engine | ✅ Working | `pipeline/shared/buildPostGameReview.js` |
| Nightly orchestrator | ✅ Working | `pipeline/shared/buildNightlyOrchestrator.js` |
| Workstation frontend | ✅ Working | `frontend/src/workstation/` |

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
| `mlb_tracked_bets_2026-05-06.json` | 293 bets — 243 under / 50 over (⚠️ see bottleneck) |
| `mlb_tracked_best_2026-05-06.json` | 191 entries — HR/TB/RBI overs attack board |
| `mlb_tracked_slips_2026-05-06.json` | AI-generated slip catalog |
| `nba_tracked_bets_2026-05-06.json` | NBA bets |
| `personal_ledger.json` | Flat JSON personal bet ledger |
| `book_intelligence_state.json` | Sportsbook CLV/profile rolling state |

---

## CURRENT ORCHESTRATION

Candidate diversification (in `workstationRoutes.js` → `diversifyCandidates`):
- `maxPerPlayer: 3` · `maxPerGame: 7` · `maxPerStat: 10` · `maxPerStatSide: 6`

Featured side-balance (`buildFeaturedPlays.js` → `pickDiversified`):
- `maxSideFraction: 0.60` (anchors: 0.55) — fill pass relaxes side cap if short

Volatility classification (`buildPortfolioOptimizer.js` → `VOLATILITY_RULES`):
- `hits`, `runs`, `points`, `rebounds`, `steals` etc. → `balanced` (fixed this session)
- Previous bug: all these fell through to `safe`, inflating volRealism and blocking aggressive slips

---

## CURRENT PHASE

**Phase: CURATION + TRUST + OPERATOR-QUALITY refinement**

Completed this session:
- ✅ Side-balance caps in `pickDiversified` (maxSideFraction)
- ✅ Global stat+side orchestration in `diversifyCandidates` (maxPerStat / maxPerStatSide)
- ✅ Volatility taxonomy fix — hits/runs/points/rebounds → `balanced` not `safe`
- ✅ Offensive texture bias in aggressive/lotto slip seeds (`offensiveAttackTextureBonus`)
- ✅ Anchor card premium display (`AnchorCard` component + `attackNote` field)
- ✅ `buildAttackNote` — sharp one-liner reasons on anchor tier
- ✅ Line shopping re-ranked by implied spread, novelty longshots filtered
- ✅ AI slip dead fix in `runMlbNight.js` (candidate path was wrong)
- ✅ Featured hierarchy: anchors vs strong supports two-tier system

---

## ACTIVE BOTTLENECK

**Suppression-heavy scoring ecology:**

Raw candidate pool (today): 293 bets — **243 under (83%), 50 over (17%)**
Top raw stats: totalbases 98, hits 84, runs 57, outs 39

Root cause: MLB projection engine naturally produces more unders on lower-offense props
because "hitter under 1.5 hits" has a higher raw implied probability than "hitter over 2.5 TB."
Side-balance caps and texture biases are mitigating this at the surfacing layer,
but the projection engine itself still generates an under-heavy candidate pool.

Current mitigation: ✅ Active (side caps + texture boost)
Remaining work: Scoring ecology review for over archetype representation

---

## KNOWN WEAKNESSES

1. **Under-heavy raw pool**: MLB projection outputs ~83% unders. Curation mitigates but can't fully overcome a 5:1 source imbalance.
2. **NBA line shopping thin**: Multi-book NBA data sparse; shopping view often empty for NBA.
3. **First basket section disconnected**: Renders but lacks real candidate data integration outside FB-specific props.
4. **No SQLite yet**: All persistence is flat JSON. `personal_ledger.json` is a single file that grows unbounded.
5. **`buildIntelligencePresentation.js` oversized**: Contains inline functions that should be extracted to shared modules.

---

## INFRASTRUCTURE STATE

| Item | State |
|---|---|
| `/docs/WORKFLOW_RULES.md` | ✅ Exists — committed to `stable-nba-engine` |
| `/docs/CURRENT_STATE.md` | ✅ Being created now |
| `/docs/NEXT_SESSION.md` | ✅ Being created now |
| `/docs/ARCHITECTURE.md` | ❌ Not yet created |
| `/docs/PIPELINES/NBA.md` | ❌ Not yet created |
| `/docs/PIPELINES/MLB.md` | ❌ Not yet created |
| `/docs/PIPELINES/TRACKING.md` | ❌ Not yet created |
