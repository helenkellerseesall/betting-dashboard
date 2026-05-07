# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-06 (late night — trust-curation hierarchy pass)_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | `0675cd0` — Fix scoring ecology: cap modelProb compounding |
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
- `hits`, `runs`, `points`, `rebounds`, `steals` etc. → `balanced` (fixed prior session)

Composite scoring (`buildFeaturedPlays.js → scoreCandidate`):
- `f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)` — caps modelProb compounding
- `tierBoost`: ELITE 0.04 / STRONG 0.02 (halved this session — was 0.08/0.04)
- `textureBoost`: aggressive/lotto edge>0.045 → 0.018; offensive over edge>0.05 → 0.020; aggressive offensive over → 0.030
- Anchor display: `sortAnchorsForDisplay()` interleaves sides (U·O·U·O·U pattern)

---

## CURRENT PHASE

**Phase: CURATION + TRUST + OPERATOR-QUALITY refinement (Phase 5 — hierarchy curation)**

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
- **NEW: Trust-curation fix #1** — tierBoost halved (ELITE 0.08→0.04, STRONG 0.04→0.02)
  Tier assignment is modelProb-driven → under-biased. Full 0.08 was inflating low-edge ELITE
  unders above higher-edge PLAYABLE overs. ELITE/STRONG tier 100% assigned to unders on MLB.
- **NEW: Trust-curation fix #2** — `sortAnchorsForDisplay()` interleave sort
  Anchor display now alternates sides: U·O·U·O·U. Trout's 22% edge offensive over moves from
  anchor #4 to anchor #2 in the dashboard display.

---

## VERIFIED LIVE RESULTS (today's slate, 48 diversified candidates)

| Bucket | Composition | Notes |
|---|---|---|
| Anchors (display order) | **U·O·U·O·U** | Trout runs over at #2, No HR at #4 |
| Tonight's Best | 3U / 2O | Strong high-edge unders + pitcher-depth overs |
| Best Ladders | 3U / 2O | TB/hits unders + pitcher outs overs |
| Smart Aggression | **4 overs** | Trout, No HR, Schanuel, Machado — real attack board |
| Safest | 3 overs | Pitcher depth overs (lowest variance on slate) |
| AI Lotto Slip #1 | **5 overs** | Pure offensive attack |
| AI Aggressive Slip #1 | 3U / 1O | Cross-side texture |
| AI Balanced Slip #1 | 3U | Strong high-edge under core |
| Total AI slips | 12 | safe:2 balanced:3 aggr:4 lotto:3 |

---

## ACTIVE BOTTLENECK

**Remaining structural under-heaviness (acceptable):**

Raw pool: 294 bets — 83% unders. This is a real projection-level artifact.
At the SURFACING layer, all major measures now working:
- Anchors interleaved, offensive overs at positions #2/#4
- Smart Aggression = 4 real overs
- Lotto AI slips = 5 real overs
- Side caps prevent sweep

Remaining feel: Tonight's Best #4/#5 are pitcher-depth overs (outs over 15.5).
These feel "suppression-adjacent" because "outs" sounds like a batting stat.
These are legitimate low-variance edges — the naming/label is the residual perception issue,
not the surfacing logic. NOT a scoring fix — a potential label fix in future.

---

## KNOWN WEAKNESSES

1. **Under-heavy raw pool**: ~83% unders. Mitigation is at the max working level at the curation layer. Source imbalance cannot be fully overcome without projection engine changes (out of scope).
2. **"outs" stat sounds suppression even as an over**: Pitcher depth overs (Joey Cantillo outs over 15.5) legitimately appear in Tonight's Best / Safest but feel sterile. Future: label as "pitcher depth" or "K-load" in UI.
3. **NBA line shopping thin**: Multi-book NBA data sparse.
4. **First basket section disconnected**: Renders but lacks real candidate data integration.
5. **No SQLite yet**: Flat JSON persistence, `personal_ledger.json` grows unbounded.
6. **`buildIntelligencePresentation.js` oversized**: Should be extracted.
7. **Strict anchor gate inert without ledger data**: Falls back to composite≥0.50 always; not a regression but means strict corroboration tier rarely activates.

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
