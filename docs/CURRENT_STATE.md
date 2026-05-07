# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-06 (overnight — trust-qualification audit pass)_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | (pending — trust-qualification fixes this session) |
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
- Anchors `maxPerGame: 2` — allows cross-side picks in same game

Volatility classification (`buildPortfolioOptimizer.js → VOLATILITY_RULES`):
- `hits`, `runs`, `points`, `rebounds`, `steals`, `stolenbases` etc. → `balanced`
- `pitcherk` / `strikeout` → `balanced`
- **NEW: `outs` → `balanced`** (was `safe` by default — pitcher dominance is volatile, not low-variance)

Composite scoring (`buildFeaturedPlays.js → scoreCandidate`):
- `f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)` — caps modelProb compounding
- `tierBoost`: ELITE 0.04 / STRONG 0.02 (halved earlier this session)
- `textureBoost`: aggressive/lotto edge>0.045 → 0.018; offensive over edge>0.05 → 0.020; aggressive offensive over → 0.030
- Anchor display: `sortAnchorsForDisplay()` interleaves sides (U·O·U·O·U pattern)

AI slip scoring (`buildSlipAi.js → scoreLeg`):
- Same modelProb cap [0.50, 0.55] as featured
- **NEW: `tierBoost` halved**: ELITE 0.05 (was 0.10) / STRONG 0.025 (was 0.05) — mirrors featured fix

AI safe-tier eligibility (`buildSlipAi.js → buildSlipsForTier`):
- **NEW: premium-edge override** — legs with `modelProb >= 0.50 AND edge >= 0.12` bypass `allowedVolatility` and `minModelProb` gates. Admits elite offensive ecosystems whose modelProb is structurally compressed below 0.55. `maxOdds 150` cap still applies (preserves safe identity).

Featured `buildSafest`:
- **NEW: premium-edge override** — balanced/aggressive plays with `modelProb >= 0.50 AND edge >= 0.12` qualify alongside the standard safe-volatility + 0.55 modelProb gate.

---

## CURRENT PHASE

**Phase: CURATION + TRUST + OPERATOR-QUALITY refinement (Phase 6 — trust qualification)**

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
- **NEW: Trust-qualification fix #1** — slipAi tierBoost halved (ELITE 0.10→0.05, STRONG 0.05→0.025).
  Same compounding bias the featured layer had: ELITE/STRONG tiers are 100% under-assigned on
  MLB slates, so the full +0.10 bonus phantom-promoted low-edge unders over higher-edge overs in
  slip composite ranking.
- **NEW: Trust-qualification fix #2** — slipAi safe tier premium-edge override.
  Admits modelProb≥0.50 + edge≥0.12 plays past the 0.55 modelProb gate and the
  allowedVolatility list (`["safe","balanced"]`). MaxOdds 150 cap still applies — preserves
  safe identity while letting elite offensive ecosystems graduate when ladder is reasonable.
- **NEW: Trust-qualification fix #3** — pitcher `outs` → `balanced` volatility.
  Outs was falling through to safe by default fallback. Pitcher outs is a suppression-flavored
  bet that's predictably volatile (pitcher leaves games, hooks, BPIP). Reclassifying as balanced
  drops volRealism 0.80→0.74, which lets real attack-stat overs surface above pitcher outs in
  Tonight's Best / Best Ladders / Safest.
- **NEW: Trust-qualification fix #4** — `buildSafest` premium-edge override.
  Same 0.50 modelProb / 0.12 edge override as slip safe tier. Premium offensive ecosystems
  (Trout 22%-edge runs over) now graduate into the SAFEST featured trust surface alongside
  high-prob unders — without forcing offense or sacrificing realism.

---

## VERIFIED LIVE RESULTS (today's slate, 48 diversified candidates)

| Bucket | Composition | Notes |
|---|---|---|
| Anchors (display order) | **U·O·U·O·U** | Trout runs over at #2, No HR at #4 |
| Tonight's Best | 3U / 2O | **Schanuel hits over now appears (was Schultz outs)** — real hitter offense |
| Best Ladders | 3U / 2O | TB/hits unders + pitcher outs (still surfaces — alt-line legitimate) |
| Smart Aggression | **4 overs** | Trout, No HR, Schanuel, Machado — pure attack board |
| **Safest** | 3U / **2O including Trout runs over** | Premium offensive ecosystem now graduates into safest |
| AI Lotto Slip #1 | 5 overs | Pure offensive attack |
| AI Aggressive Slip #1 | 3U / 1O | Trout cross-side seed |
| AI Balanced Slips | 100% under (correct — no premium ladders qualify today) | Bichette/Wood/Murakami |
| AI Safe Slips | 100% under (correct — today's offensive overs are all +200/+280, fail maxOdds 150) | Buxton/Stowers RBI alts |
| Total AI slips | 13 | safe:2 balanced:4 aggr:4 lotto:3 |

---

## ACTIVE BOTTLENECK

**Remaining structural under-heaviness (acceptable):**

Raw pool: 294 bets — 83% unders. Real projection-level artifact.
At the SURFACING layer, all major trust gates now fair:
- Anchors interleaved, offensive overs at positions #2/#4
- Tonight's Best includes real hitter offense (Schanuel)
- Smart Aggression = 4 real attack overs
- **Safest includes Trout runs over** (premium offensive ecosystem graduated)
- Lotto AI slips = 5 real overs, Aggressive #1 has Trout

AI safe/balanced slips remaining 100% under is **correct behavior** — today's offensive overs all
have odds +200 to +280, which legitimately exceeds the safe tier `maxOdds: 150` cap. Premium
offensive ecosystems with reasonable odds (≤ 150) WOULD now graduate. Today's slate just has
no such play. Identity preservation working as designed.

---

## KNOWN WEAKNESSES

1. **Under-heavy raw pool**: ~83% unders. Mitigation now at the maximum possible curation-layer level. Source imbalance only fully addressable in the projection engine (out of scope).
2. **AI safe slips remain conservative when no offense at the right odds**: Premium offensive overs at +180/+220 don't fit safe-tier identity (maxOdds 150). This is correct behavior — the override admits them when odds qualify; today's slate just lacks such plays.
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
