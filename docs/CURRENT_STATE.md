# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-06 (late evening — scoring ecology pass)_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | `194a127` — Add CURRENT_STATE.md and NEXT_SESSION.md |
| Repo health | Stable. Syntax clean on all touched files. |

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

Candidate diversification (`workstationRoutes.js → diversifyCandidates`):
- `maxPerPlayer: 3` · `maxPerGame: 7` · `maxPerStat: 10` · `maxPerStatSide: 6`

Featured side-balance (`buildFeaturedPlays.js → pickDiversified`):
- `maxSideFraction: 0.60` (anchors: 0.55) — fill pass relaxes side cap if short
- Anchors `maxPerGame: 2` (was 1) — allows cross-side picks in same game

Volatility classification (`buildPortfolioOptimizer.js → VOLATILITY_RULES`):
- `hits`, `runs`, `points`, `rebounds`, `steals`, `blocks`, `doubles`, `triples`, `stolenbases` → `balanced`
- `pitcher Ks`, `outs`, `strikeouts` → `balanced`
- Fixed prior session — was falling to `safe`, inflating volRealism

Composite scoring (this session):
- `f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)` — caps modelProb compounding
- `textureBoost`: aggressive/lotto + edge>0.045 → 0.018; offensive over + edge>0.05 → 0.020; aggressive offensive over → 0.030
- AI slip `projectionScore` uses same modelProb cap

---

## CURRENT PHASE

**Phase: CURATION + TRUST + OPERATOR-QUALITY refinement (Phase 4 — scoring ecology)**

Completed this session:
- Volatility taxonomy fix — `hits`/`runs`/`points`/`rebounds` etc. → `balanced`
- Side-balance caps in `pickDiversified` (`maxSideFraction`)
- Global stat+side orchestration (`maxPerStat` / `maxPerStatSide`)
- Offensive texture bias in aggressive/lotto slip seeds (`offensiveAttackTextureBonus`)
- `AnchorCard` premium display + `attackNote` field
- Line shopping re-ranked by implied spread, novelty longshots filtered
- AI slip dead fix in `runMlbNight.js`
- Featured anchors vs strong supports two-tier system
- **NEW: Scoring ecology fix #1** — modelProb compounding capped at [0.50, 0.55]
  in `scoreCandidate` (featured) and `scoreLeg` (slip AI) — neutralizes structural
  suppression-side advantage from probability compression on shorter under lines
- **NEW: Scoring ecology fix #2** — `isOffensiveAttackStat` recognition with stacked
  textureBoost (0.020 balanced offensive overs · 0.030 aggressive offensive overs)
  surfaces real hitter offense over pitcher-dominance "overs"
- **NEW: Anchor diversity fix** — `maxPerGame: 2` in `buildAnchors`, allowing
  cross-side picks (e.g. Trout runs over + Montgomery TB under) when same game
  has both genuine attack and suppression edges

---

## ACTIVE BOTTLENECK

**Suppression-heavy raw candidate pool (mitigated, not eliminated):**

Today's pool: 294 bets — 243 under (83%) / 51 over (17%)
Top raw stats: totalbases 98, hits 84, runs 57, outs 39

Raw-pool source imbalance: MLB projections naturally produce more high-edge unders
because shorter lines compress modelProb upward. This is a projection-engine-level
behavior — **DO NOT touch projection** to fix balance. We mitigate at curation.

**Verified mitigation impact (today's slate, post-fix):**
- Anchors: 3 under / 2 over — Mike Trout's 22% edge runs over now surfaces
- Tonight's Best: 3 under / 2 over
- Best Ladders: 3 under / 2 over
- Smart Aggression: 4 overs (Trout, "No HR", Schanuel, Machado — real attack)
- Lotto AI slip: 5 overs (pure offensive attack lotto)
- Aggressive AI slip #1: 3 under + 1 over (cross-side texture)

---

## KNOWN WEAKNESSES

1. **Under-heavy raw pool**: ~83% unders today. Curation surfaces real overs when they exist with edge >0.05; cannot fully overcome a projection-level 5:1 source skew on suppression-leaning slates.
2. **NBA line shopping thin**: Multi-book NBA data sparse; shopping view often empty for NBA.
3. **First basket section disconnected**: Renders but lacks real candidate data integration outside FB-specific props.
4. **No SQLite yet**: All persistence is flat JSON. `personal_ledger.json` grows unbounded.
5. **`buildIntelligencePresentation.js` oversized**: Inline functions should be extracted to shared modules.
6. **Anchor strict gate inert without ledger data**: Strict pool requires composite≥0.55 + corroboration; without populated ledger CLV/archetype data, fallback to composite≥0.50 always fires. Not a bug, but means strict tier rarely activates today.

---

## INFRASTRUCTURE STATE

| Item | State |
|---|---|
| `/docs/WORKFLOW_RULES.md` | Committed |
| `/docs/CURRENT_STATE.md` | Updated this session |
| `/docs/NEXT_SESSION.md` | Updated this session |
| `/docs/BOOTSTRAP_PROMPT.md` | Committed |
| `.cursor/rules/workflow.mdc` | Committed — `alwaysApply: true` |
| `/docs/ARCHITECTURE.md` | Not yet created |
| `/docs/PIPELINES/NBA.md` | Not yet created |
| `/docs/PIPELINES/MLB.md` | Not yet created |
| `/docs/PIPELINES/TRACKING.md` | Not yet created |
