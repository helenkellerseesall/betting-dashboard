# ARCHITECTURE REFERENCE
**Durable repo blueprint. Update when structural changes occur. Not a session log.**
_Created: 2026-05-07 | Based on: full codebase audit_

---

## WHAT THIS SYSTEM IS

An intelligence-driven MLB/NBA sports betting workstation. It ingests live odds, scores
candidates against projection models, qualifies them through multi-layer trust/ecology
filters, assembles curated output surfaces (featured plays, AI slips, portfolio analysis,
line shopping intelligence), and presents them in a dark-mode operator dashboard.

The system has two distinct runtime paths that share no live state but share the same
intelligence pipeline modules and the same flat JSON persistence layer.

---

## RUNTIME ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────┐
│  TERM 1: Node/Express backend — port 4000                           │
│                                                                     │
│  backend/server.js (21,025 lines)                                   │
│    ├── /api/best-available   ← live odds + MLB/NBA board refresh    │
│    ├── /refresh-snapshot     ← force pull from Odds API             │
│    ├── /mlb/board, /mlb/picks, /mlb/slips, ...   ← legacy routes   │
│    ├── /api/ws/*             ← mounted workstationRoutes.js         │
│    └── /  ← all board/props/export/parlays routes                  │
│                                                                     │
│  backend/routes/workstationRoutes.js (577 lines)                    │
│    ├── GET /api/ws/state         ← main workstation hydration       │
│    ├── GET /api/ws/ai-slips      ← slip catalog only                │
│    ├── GET /api/ws/featured      ← featured plays only              │
│    ├── GET /api/ws/line-shopping ← line shopping table              │
│    ├── GET /api/ws/timing        ← market timing signals            │
│    ├── GET /api/ws/portfolio     ← portfolio analysis               │
│    ├── GET /api/ws/ledger        ← personal ledger report           │
│    ├── GET /api/ws/first-basket  ← first basket board               │
│    └── POST /api/ws/bet-builder/preview                             │
│                                                                     │
│  TERM 2: Manual operator verification only — never touch from AI    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND: React 19 + Vite + TypeScript — port 5173 (dev)          │
│  Calls only /api/ws/* endpoints. Never touches server.js routes.    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  NIGHTLY SCRIPTS (run manually from TERM 2)                        │
│  backend/scripts/runMlbNight.js   (20,092 bytes, 539 lines)        │
│  backend/scripts/runNbaNight.js   (52,069 bytes, 1,310 lines)      │
│  These hit live server.js endpoints and write JSON output files.   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## THE TWO EXECUTION PATHS

### Path 1 — Live Online Pipeline (server.js)

Used by nightly scripts and the `/api/best-available` endpoint.

```
Odds API pull  →  /refresh-snapshot  →  oddsSnapshot (global in server.js)
                                               ↓
                               /api/best-available?sport=baseball_mlb
                                               ↓
                           handleMlbBestAvailableGet (http/mlbIsolatedRoutes.js)
                                               ↓
                    buildMlbBootstrapSnapshot → buildMlbInspectionBoard
                    → buildMlbOpportunityBoard → buildMlbInsightBoard
                    → buildLiveDualBestAvailablePayload (server.js line 6169)
                                               ↓
                               JSON response → runMlbNight.js consumes it
                                               ↓
                     writes: mlb_tracked_bets_*.json
                             mlb_tracked_best_*.json
                             mlb_tracked_slips_*.json
                             mlb_tracking_summary_*.json
```

### Path 2 — Workstation Intelligence Path (workstationRoutes.js)

Used by the frontend dashboard. Reads files written by Path 1.

```
GET /api/ws/state?sport=mlb
        ↓
  resolveSportDate()          ← find latest date with data files
  buildCandidatePool()        ← read mlb_tracked_bets_*.json + mlb_tracked_best_*.json
  diversifyCandidates()       ← [extracted] pipeline/shared/buildCandidateDiversity.js
        ↓
  loadSharedModules()         ← lazy-require all intelligence modules
        ↓
  snapshot-mlb.json           ← read for line shopping + timing
  buildLineShopping()         ← pipeline/shared/buildLineShoppingIntelligence.js
  buildMarketTiming()         ← pipeline/shared/buildMarketTimingIntelligence.js
        ↓
  optimizePortfolio()         ← pipeline/shared/buildPortfolioOptimizer.js
  buildAiSlips()              ← pipeline/shared/buildSlipAi.js
  buildFeaturedPlays()        ← pipeline/shared/buildFeaturedPlays.js [CANONICAL]
        ↓
  compactLineShopping()       ← [inline in workstationRoutes.js — extract pending]
  compactTiming()             ← [inline in workstationRoutes.js — extract pending]
  compactPortfolio()          ← [inline in workstationRoutes.js — extract pending]
        ↓
  → JSON response to frontend
```

**The workstation path is self-contained.** It does not depend on live odds state, server.js
globals, or the online pipeline being active. It only requires valid JSON files in
`runtime/tracking/` from a recent nightly run.

---

## REPO DIRECTORY MAP

```
betting-dashboard/
├── backend/
│   ├── server.js                    ← 21,025 lines — THE MONOLITH (see §SERVER.JS)
│   ├── http/
│   │   ├── mlbIsolatedRoutes.js     ← MLB board handler (active, called by server.js)
│   │   ├── nbaIsolatedRoutes.js     ← NBA board handler (active, 667 lines)
│   │   ├── nbaBestAvailable.inlined.js   ← 6,867 lines — STATUS UNKNOWN (may be dead)
│   │   └── nbaRefreshSnapshot.inlined.js ← 4,318 lines — STATUS UNKNOWN (may be dead)
│   ├── routes/
│   │   ├── workstationRoutes.js     ← 577 lines — workstation API layer (canonical)
│   │   └── mlbIsolatedRoutes.js     ← thin redirect (12 lines)
│   ├── pipeline/
│   │   ├── shared/                  ← CANONICAL intelligence modules (see §SHARED MODULES)
│   │   │   ├── adapters/
│   │   │   │   ├── mlbAdapter.js    ← sport-specific bet classifier
│   │   │   │   └── nbaAdapter.js    ← sport-specific bet classifier
│   │   │   ├── buildCandidateDiversity.js    ← extracted, pure, canonical
│   │   │   ├── buildClv.js                   ← CLV computation
│   │   │   ├── buildFeaturedPlays.js         ← 821 lines — CANONICAL featured plays
│   │   │   ├── buildIntelligencePresentation.js ← 846 lines — nightly board formatter
│   │   │   ├── buildLineShoppingIntelligence.js ← 527 lines
│   │   │   ├── buildMarketTimingIntelligence.js ← 518 lines
│   │   │   ├── buildNightlyOrchestrator.js   ← 642 lines — coordinates post-game flow
│   │   │   ├── buildPersonalLedger.js        ← 1,164 lines — ledger I/O + analytics
│   │   │   ├── buildPortfolioOptimizer.js    ← 669 lines — volatility + exposure
│   │   │   ├── buildPostGameReview.js        ← 453 lines
│   │   │   └── buildSlipAi.js                ← 806 lines — AI slip construction
│   │   ├── mlb/                     ← MLB-specific pipeline
│   │   │   ├── buildMlbBootstrapSnapshot.js  ← 1,275 lines — odds ingestion
│   │   │   ├── buildMlbInspectionBoard.js    ← 1,739 lines — prop classification
│   │   │   ├── buildMlbInsightBoard.js       ← 1,044 lines
│   │   │   ├── buildMlbOpportunityBoard.js   ← 893 lines
│   │   │   ├── buildMlbPropClusters.js       ← 1,104 lines
│   │   │   ├── buildMlbSlipEngine.js         ← 582 lines
│   │   │   ├── buildMlbHrPredictionCandidates.js ← 808 lines
│   │   │   ├── buildMlbCorrelationEngine.js  ← 650 lines
│   │   │   ├── buildMlbAutoTickets.js        ← 783 lines
│   │   │   ├── phase4Tracking.js             ← 1,072 lines — MLB tracking write layer
│   │   │   ├── playerModel.js                ← 223 lines — modelProb generation
│   │   │   ├── external/                     ← external data fetch adapters
│   │   │   ├── enrichment/                   ← identity resolution, external context merge
│   │   │   └── lanes/                        ← safe/value/power lane scoring (server.js)
│   │   ├── nba/                     ← NBA-specific pipeline (5 overlapping slip modules)
│   │   │   ├── buildNbaPlayerOutcomePredictions.js ← 1,943 lines — main model
│   │   │   ├── buildNbaAiPicks.js            ← 1,082 lines
│   │   │   ├── buildNbaDynamicSlipEngine.js  ← 843 lines
│   │   │   ├── buildNbaSlipEngine.js         ← 601 lines
│   │   │   ├── buildNbaSlipComposer.js       ← 480 lines
│   │   │   ├── buildNbaAiSlips.js            ← 574 lines
│   │   │   ├── buildNbaPerformanceTracking.js ← 599 lines
│   │   │   ├── buildNbaBestBetsBoard.js       ← 440 lines
│   │   │   ├── buildNbaFirstBasketEngine.js  ← 402 lines
│   │   │   ├── buildNbaFirstBasketIntelligence.js ← 510 lines
│   │   │   ├── buildNbaBankrollPlan.js        ← 480 lines
│   │   │   ├── nbaOpportunityCandidates.js   ← 451 lines
│   │   │   ├── nbaExtendedOpportunityPools.js ← 424 lines
│   │   │   ├── nbaAiStatFamilyRank.js        ← 749 lines
│   │   │   ├── nbaAiOutcomeRange.js          ← 743 lines
│   │   │   ├── nbaModelSignals.js            ← 331 lines
│   │   │   ├── nbaEventTeamResolve.js        ← 565 lines
│   │   │   └── fetchNbaOddsSnapshot.js       ← 493 lines
│   │   ├── boards/                  ← older board construction layer (server.js uses these)
│   │   │   ├── boardHelpers.js      ← shared helpers (active — used by below)
│   │   │   ├── buildBestLadders.js  ← active (server.js)
│   │   │   ├── buildBestSpecials.js ← active (server.js)
│   │   │   ├── buildCuratedLayer2Buckets.js ← active (server.js)
│   │   │   ├── buildFirstBasketBoard.js ← active (server.js)
│   │   │   ├── buildSpecialtyOutputs.js ← active (server.js)
│   │   │   └── buildFeaturedPlays.js ← 407 lines — DEAD (dead import in server.js)
│   │   ├── tracking/                ← slate snapshot save/grade/summarize
│   │   │   ├── saveTrackedSlateSnapshot.js
│   │   │   ├── gradeTrackedSlateSnapshot.js
│   │   │   ├── buildTrackedSlateSummary.js
│   │   │   └── buildTrackedCombos.js
│   │   ├── edge/                    ← external signal ingestion + edge scoring
│   │   │   ├── buildDecisionLayer.js
│   │   │   ├── buildExternalEdgeOverlay.js
│   │   │   ├── buildAvailabilitySignalAdapter.js
│   │   │   ├── ingestNbaOfficialInjuryReport.js
│   │   │   └── ingestRotoWireSignals.js
│   │   ├── markets/                 ← prop classification, board classification
│   │   ├── selection/               ← bestProps selection
│   │   ├── output/                  ← buildSurfaceRow (654 lines)
│   │   ├── resolution/              ← player/team identity resolution
│   │   ├── signals/                 ← predictive signal builders
│   │   ├── context/                 ← pregameContext
│   │   ├── decision/                ← buildBestPairs
│   │   ├── schedule/                ← buildSlateEvents
│   │   ├── filters/                 ← fragile leg filters
│   │   └── utils/                   ← edge computation utilities
│   ├── runtime/
│   │   └── tracking/                ← all flat JSON persistence (see §PERSISTENCE)
│   ├── ml/                          ← ML scorer (loads model.json if present)
│   ├── upside/                      ← buildMoneyMakerPortfolio
│   ├── tracker/                     ← betTracker.js + betMetrics.js
│   └── scripts/
│       ├── runMlbNight.js           ← 539 lines — MLB nightly runner (TERM 2)
│       └── runNbaNight.js           ← 1,310 lines — NBA nightly runner (TERM 2)
├── frontend/src/workstation/
│   ├── Workstation.tsx              ← top-level router/layout
│   ├── api.ts                       ← all /api/ws/* client calls
│   ├── types.ts                     ← all shared TypeScript interfaces
│   ├── workstation.css              ← single dark-theme stylesheet
│   ├── builderContext.tsx           ← bet builder shared state
│   ├── utils.ts
│   ├── components/
│   │   ├── FeaturedCard.tsx         ← anchor + support card
│   │   └── Badges.tsx
│   └── sections/
│       ├── Dashboard.tsx            ← command center (anchors, portfolio, featured grid)
│       ├── AiSlipsView.tsx          ← AI slip catalog
│       ├── SlateBrowser.tsx         ← full candidate slate
│       ├── LineShoppingView.tsx     ← line shopping table
│       ├── PortfolioView.tsx        ← exposure + correlation view
│       ├── BetBuilderView.tsx       ← manual slip builder
│       ├── ProcessReviewView.tsx    ← ledger + CLV review
│       └── FirstBasketView.tsx      ← first basket board [DISCONNECTED — no data]
└── docs/
    ├── BOOTSTRAP_PROMPT.md          ← session rehydration entrypoint
    ├── WORKFLOW_RULES.md            ← permanent operational law
    ├── CURRENT_STATE.md             ← live state — overwrite every session
    ├── NEXT_SESSION.md              ← exact resumption point — overwrite every session
    └── ARCHITECTURE.md              ← this file — update on structural changes
```

---

## CANONICAL SHARED MODULES (`pipeline/shared/`)

These are the authoritative implementations. All workstation intelligence flows through here.
When scoring or curation behavior needs to change, change these files — not duplicates elsewhere.

| Module | Responsibility | Key exports |
|---|---|---|
| `buildCandidateDiversity.js` | Pool diversification — per-player/game/stat caps | `diversifyCandidates` |
| `buildFeaturedPlays.js` | Trust surfaces — anchors, tonight's best, safest, etc. | `buildFeaturedPlays`, `scoreCandidate`, `buildLedgerStats` |
| `buildSlipAi.js` | AI slip construction — 4 tiers (safe/balanced/aggr/lotto) | `buildAiSlips` |
| `buildPortfolioOptimizer.js` | Volatility classification, exposure, correlation | `optimizePortfolio`, `classifyVolatility` |
| `buildLineShoppingIntelligence.js` | Multi-book spread ranking, value alerts | `buildLineShopping`, `loadBookState` |
| `buildMarketTimingIntelligence.js` | Steam detection, stale windows, urgency | `buildMarketTiming`, `loadTimingState` |
| `buildPersonalLedger.js` | Bet ledger I/O, CLV analytics, nightly import | `loadLedger`, `logBet`, `buildNightlyReport` |
| `buildPostGameReview.js` | Post-game result grading and review | `runPostGameReview` |
| `buildNightlyOrchestrator.js` | Coordinates post-game steps, lock/unlock, sync | `stepApplyResults`, `stepPostGameReview`, etc. |
| `buildClv.js` | Closing line value computation | `computeClv`, `buildClvAnalytics` |
| `buildIntelligencePresentation.js` | Console board formatter for nightly output | `buildBoard` |
| `adapters/mlbAdapter.js` | MLB-specific bet environment + archetype classification | `classifyMiss`, `detectArchetypes` |
| `adapters/nbaAdapter.js` | NBA-specific bet environment + archetype classification | `classifyMiss`, `detectArchetypes` |

---

## SERVER.JS — THE MONOLITH

### What It Is

`backend/server.js` is a 21,025-line single-file Express application that predates the
workstation architecture. It was the original complete system and has never been decomposed.
The workstation pipeline was built alongside it, not extracted from it.

### Global State (12+ mutable module-level variables)

```javascript
// Lines 152–230
let oddsSnapshot          // live odds from Odds API — consumed by boards + scoring
let mlbSnapshot           // MLB bootstrap snapshot — populated by handleMlbBestAvailableGet
let mlbPicks              // { safeCore, valueCore, powerCore } — MLB pipeline output
let mlbSlips              // []
let mlbOomphSlips         // oomph slip engine output
let mlbSpikePlayers       // spike detection output
let mlbCorrelationClusters // correlation engine
let mlbUpsideClusters     // upside cluster analysis
const mlbOpeningOddsByLegKey  // Map — line movement tracking (persistent across refreshes)

// Lines 10,092–10,093
let __refreshInProgress   // boolean mutex — FRAGILE (can deadlock on crash)
let __lastRefreshTime     // cooldown timestamp

// Lines 10,383–10,386
let playerIdCache         // Map — API-Sports identity cache
let playerStatsCache      // Map — API-Sports stats cache
let playerLookupMissCache // Set — negative identity cache
let apiSportsEmptySearchStreak  // API failure streak counter
```

**All functions defined after these globals close over them.** This is why extraction
requires parameter-threading, not just moving the function.

### Key Orchestration Functions

| Function | Location | Lines | Risk |
|---|---|---|---|
| `buildLiveDualBestAvailablePayload` | line 6,169 | ~433 | HIGH — closes over everything |
| `buildMlbLiveDualBestAvailablePayload` | inside above | ~200 | HIGH |
| `sanitizeSnapshotRows` | line 97 | ~55 | MEDIUM |
| `scorePropRow` | line ~13,909 | ~249 | HIGH — closes over oddsSnapshot |
| `buildRawCoverage` / `buildStageCounts` | lines 1,507–2,066 | ~559 | MEDIUM |
| `loadApiSportsCachesFromDisk` | line ~10,388 | ~40 | LOW — pure async |

### Routes (41 total)

Registered at lines ~10,095, 17,815–20,886. Some notable groupings:

```
/api/best-available      ← main live pipeline entry — delegates to MLB/NBA handlers
/refresh-snapshot        ← force pulls from Odds API
/snapshot/status         ← snapshot staleness diagnostics
/mlb/refresh             ← MLB snapshot rebuild
/api/ws/*                ← mounted workstationRoutes (NOT server.js logic)
/props/*, /picks/today, /parlays/*  ← older prop query endpoints
/api/bets, /api/bets/metrics        ← bet tracker endpoints
/export/training.*       ← ML training data export
```

### Safe Extraction Targets (Phased)

**Phase A — Safe today (no globals):**
Lines 11,379–11,430 — `avg`, `stddev`, `minVal`, `maxVal`, `parseHitRate`, `normalizePlayerName`
→ Extract to `pipeline/shared/mathUtils.js`
~52 lines, pure functions. Verify no shadowed definitions elsewhere in server.js first.

**Phase B — Future (requires parameter threading first):**
`buildRawCoverage`, `buildStageCounts`, `buildExclusionSummary` (lines 1,507–2,066)
→ Convert `oddsSnapshot` global references to function parameters
→ Extract to `pipeline/shared/buildDiagnostics.js`

**Phase C — Long-term (major threading pass required):**
`scorePropRow` (line ~13,909) — 249 lines, many global deps
`buildLiveDualBestAvailablePayload` (line 6,169) — 433 lines, closes over all MLB state
Do not attempt without full global dependency map documented.

**Do not attempt Phase B or C without ARCHITECTURE.md confirmed current and Phase A done.**

### Refresh Deadlock Risk

`__refreshInProgress` (line 10,092) is a hand-rolled boolean mutex. If a refresh throws
or times out mid-execution, the flag stays `true` and all future `/api/best-available`
calls block silently. The workstation continues serving stale data.
**Recovery requires restarting TERM 1.** There is no automatic recovery path.

---

## PERSISTENCE LAYER

All files live in `backend/runtime/tracking/`. All are flat JSON. No atomic writes.
A partial-write crash produces a `.tmp` orphan (one already observed: `mlb_tracking_summary_2026-05-05.json.tmp.98415`).

### Daily Rolling Files (created by nightly scripts)

| Pattern | Size range | Written by | Read by |
|---|---|---|---|
| `mlb_tracked_bets_YYYY-MM-DD.json` | ~141KB | `runMlbNight.js` | `workstationRoutes.js` |
| `mlb_tracked_best_YYYY-MM-DD.json` | ~139KB | `runMlbNight.js` | `workstationRoutes.js` |
| `mlb_tracked_slips_YYYY-MM-DD.json` | ~187KB | `runMlbNight.js` | `workstationRoutes.js` |
| `mlb_tracking_summary_YYYY-MM-DD.json` | ~5KB | `runMlbNight.js` | human review |
| `mlb_picks_YYYY-MM-DD.json` | 27KB–1.5MB | `runMlbNight.js` | human review |
| `nba_tracked_bets_YYYY-MM-DD.json` | ~5KB | `runNbaNight.js` | `workstationRoutes.js` |
| `nba_tracked_slips_YYYY-MM-DD.json` | ~28–89KB | `runNbaNight.js` | `workstationRoutes.js` |
| `nba_tracking_summary_YYYY-MM-DD.json` | ~3KB | `runNbaNight.js` | human review |
| `hr_slips_YYYY-MM-DD.json` | ~21KB | `runMlbNight.js` | workstation |
| `graded_props_YYYY-MM-DD.json` | 2KB–92KB | grading runner | review pipeline |

### Rolling State Files (unbounded growth risk)

| File | Current size | Written by | Risk |
|---|---|---|---|
| `personal_ledger.json` | **2.3MB — 2,000 entries** | `buildPersonalLedger.js` | **CRITICAL — past SQLite trigger (was 500)** |
| `timing_intelligence_state.json` | **729KB** | `buildMarketTimingIntelligence.js` | HIGH — no pruning |
| `post_game_review_state_mlb.json` | **375KB** | `buildPostGameReview.js` | MEDIUM |
| `post_game_review_state_nba.json` | 3KB | `buildPostGameReview.js` | LOW now |
| `book_intelligence_state.json` | 1.3KB | `buildLineShoppingIntelligence.js` | LOW now |

---

## SQLITE MIGRATION PLAN

**Current state:** All persistence is flat JSON. No atomic writes. No transactions.
**Target:** SQLite for all growing/critical state. Daily rolling files can remain JSON
(bounded by date, naturally pruned by time).

### Migration Order (priority-ranked)

**1 — `personal_ledger.json` → `ledger.db` (NOW OVERDUE)**
- Trigger was 500 entries. Current: 2,000 entries / 2.3MB.
- All write I/O is isolated in `buildPersonalLedger.js` (`loadLedger`, `logBet`, `saveLedger`).
- Schema: `(id TEXT PK, date TEXT, sport TEXT, player TEXT, stat TEXT, side TEXT, line REAL, odds INTEGER, stake REAL, result TEXT, pnl REAL, clv REAL, book TEXT, created_at TEXT)`
- Keep JSON read fallback until one full nightly run verifies write path end-to-end.
- Do NOT dual-write after verification — cut over cleanly.

**2 — `timing_intelligence_state.json` → `timing_state.db`**
- 729KB, grows with every nightly run. No pruning.
- All I/O in `buildMarketTimingIntelligence.js` (`loadTimingState`, state save paths).
- Migrate after ledger is stable.

**3 — `tracked_bets_YYYY-MM-DD.json` files → rolling `bets.db` table**
- Add `date` + `sport` columns. Prune rows older than 30 days on write.
- Allows historical analytics queries that currently require loading every date file.

**4 — `post_game_review_state_mlb.json` → `review_state.db`**
- 375KB, grows with every post-game cycle.
- I/O in `buildPostGameReview.js`.

**5 — `book_intelligence_state.json` + `graded_props_*.json` → SQLite (future)**
- Low urgency. Migrate once above four are stable.

**Rules for all migrations:**
- Migrate one file at a time. Never migrate two simultaneously.
- JSON fallback MUST remain on the read path until one full nightly run is verified.
- Never dual-write after cut-over — it creates state split.
- `node --check` on all modified files. Restart TERM 1. Verify full nightly run.

---

## CALIBRATION ARCHITECTURE

### Scoring Pipeline (workstation path, MLB)

```
raw candidates (tracked_bets)
        ↓
diversifyCandidates()            — caps per player / game / stat / side
        ↓
normalizeCandidate()             — normalize all field names + types
        ↓
scoreCandidate()                 — composite score:
    f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)  ← compounding cap
    + tierBoost (ELITE: +0.04, STRONG: +0.02)            ← halved — was 0.08/0.04
    + textureBoost (offensive over + side conditions)     ← +0.018 / 0.020 / 0.030
        ↓
pickDiversified()                — side-balance caps (maxSideFraction: 0.60, anchors: 0.55)
        ↓
buildAnchors()                   — top 5, maxPerGame: 2, sortAnchorsForDisplay (U·O·U·O·U)
buildTonightsBest()              — top 5 by composite
buildBestLadders()               — top 5 by edge (alt-line plays surface here)
buildSmartAggression()           — top 4 overs with edge > 0.04
buildSafest()                    — safe/balanced volatility + 0.55 modelProb
                                   OR premium-edge override: edge≥0.12 + modelProb≥0.50
```

### Volatility Classification (`buildPortfolioOptimizer.js → VOLATILITY_RULES`)

```
safe:      firstbasket, firstteambasket
balanced:  hits, runs, points, rebounds, assists, steals, stolenbases,
           pitcherk, strikeout, outs  ← outs fixed 2026-05-07 (was safe)
aggressive: hr, homerun, totalbases, rbi, saves, doubledigit
lotto:     (aggressive + long odds)
```

### AI Slip Tier Gates (`buildSlipAi.js`)

| Tier | allowedVolatility | minModelProb | maxOdds | Override |
|---|---|---|---|---|
| safe | safe, balanced | 0.55 | 150 | edge≥0.12 + modelProb≥0.50 bypasses vol + minProb |
| balanced | safe, balanced, aggressive | 0.50 | 220 | — |
| aggressive | any | 0.45 | 350 | — |
| lotto | any | 0.40 | 600 | — |

**tierBoost values (halved 2026-05-07):** ELITE: +0.05 (was 0.10), STRONG: +0.025 (was 0.05)

---

## MODULE OWNERSHIP: WHAT IS CANONICAL AND WHAT IS NOT

### Canonical (use these — do not create alternatives)

| Domain | Canonical location |
|---|---|
| Featured plays + trust surfaces | `pipeline/shared/buildFeaturedPlays.js` |
| AI slip construction | `pipeline/shared/buildSlipAi.js` |
| Portfolio + volatility | `pipeline/shared/buildPortfolioOptimizer.js` |
| Candidate diversification | `pipeline/shared/buildCandidateDiversity.js` |
| Line shopping | `pipeline/shared/buildLineShoppingIntelligence.js` |
| Market timing | `pipeline/shared/buildMarketTimingIntelligence.js` |
| Personal ledger | `pipeline/shared/buildPersonalLedger.js` |
| CLV computation | `pipeline/shared/buildClv.js` |

### Dead or Uncertain (do not rely on, do not extend)

| File | Status |
|---|---|
| `pipeline/boards/buildFeaturedPlays.js` | **DEAD** — only importer was server.js line 21 (dead import). Delete. |
| `http/nbaBestAvailable.inlined.js` | **STATUS UNKNOWN** — nbaIsolatedRoutes.js explicitly excludes it. Likely dead. Audit before touching. |
| `http/nbaRefreshSnapshot.inlined.js` | **STATUS UNKNOWN** — same. 4,318 lines. Audit before touching. |

### Duplication Risks (resolve in order)

| Duplication | Files | Fix |
|---|---|---|
| Offensive stat classification | `buildFeaturedPlays.js:isOffensiveAttackStat()` + `buildSlipAi.js:offensiveAttackTextureBonus()` (inline) | Extract canonical `isOffensiveAttackStat()` to `pipeline/shared/normalizers.js`, import in both |
| `compactLineShopping`, `compactTiming`, `compactPortfolio` | Inline in `workstationRoutes.js` | Extract to `pipeline/shared/buildWorkstationCompactors.js` |

---

## EXTRACTION ROADMAP

### Done

| Extraction | From | To | Date |
|---|---|---|---|
| `diversifyCandidates` | `workstationRoutes.js` | `pipeline/shared/buildCandidateDiversity.js` | 2026-05-07 |

### Pending (ordered by priority)

| # | Target | From | To | Size | Risk |
|---|---|---|---|---|---|
| 1 | Dead import removal | `server.js` line 21 | delete | 1 line | Near-zero |
| 2 | `compactLineShopping` + `compactTiming` + `compactPortfolio` | `workstationRoutes.js` | `buildWorkstationCompactors.js` | ~103 lines | Low |
| 3 | `isOffensiveAttackStat` | `buildFeaturedPlays.js` + `buildSlipAi.js` | `normalizers.js` | ~15 lines | Low |
| 4 | Pure math utils | `server.js` lines 11,379–11,430 | `mathUtils.js` | ~52 lines | Low |
| 5 | Diagnostics functions | `server.js` lines 1,507–2,066 | `buildDiagnostics.js` | ~559 lines | Medium (needs param threading) |
| 6 | `buildIntelligencePresentation.js` section functions | shared module | dedicated presenters | ~400 lines | Medium |

### Do Not Extract Yet

- `scorePropRow` (server.js line ~13,909) — too many global deps
- `buildLiveDualBestAvailablePayload` (server.js line 6,169) — closes over entire MLB/NBA state
- Any of the 5 NBA slip modules until NBA ecology audit determines which is authoritative

---

## AI WORKFLOW ARCHITECTURE

### Role Split

| Role | Responsibility | Scope |
|---|---|---|
| **Claude (this)** | Architecture audits, root-cause diagnosis, calibration analysis, documentation, patch plan generation | Reasoning — does not touch code directly |
| **Cursor** | Executing verified patch plans, syntax verification (`node --check`), git commits, live TERM 1 restart + TERM 2 verification | Execution — implements what Claude specifies |
| **Operator** | TERM 2 manual verification, live slate assessment, gate decisions on scope expansion | Human judgment layer |

### Session Rehydration Protocol

Every session must read in order:
1. `docs/WORKFLOW_RULES.md` — permanent operational law
2. `docs/CURRENT_STATE.md` — live system state
3. `docs/NEXT_SESSION.md` — exact next priorities
4. `docs/ARCHITECTURE.md` (this file) — when touching server.js or pipeline structure

### Repo Memory System

| File | Type | Update frequency |
|---|---|---|
| `WORKFLOW_RULES.md` | Permanent law | Only when rules strengthen |
| `CURRENT_STATE.md` | Live state | Overwrite every session |
| `NEXT_SESSION.md` | Action queue | Overwrite every session |
| `ARCHITECTURE.md` | Structural reference | Update on structural changes |
| `.cursor/rules/workflow.mdc` | alwaysApply Cursor enforcement | Mirror of WORKFLOW_RULES |

**Root-level docs** (`/CURRENT_STATE.md`, `/NEXT_SESSION.md`, etc.) are copies of `docs/`
versions. They exist for legacy compatibility. Always update `docs/` first, then sync root.
Long-term: choose one location and delete the other.

---

## TECHNICAL DEBT RANKING

Priority-ordered by combined urgency × impact:

| Rank | Item | Risk | Impact | Status |
|---|---|---|---|---|
| 1 | `personal_ledger.json` SQLite migration | Data loss on crash | Operational integrity | OVERDUE |
| 2 | Dead `pipeline/boards/buildFeaturedPlays.js` | Scoring confusion | Low once removed | Pending |
| 3 | `timing_intelligence_state.json` pruning/migration | 729KB unbounded | Performance | Near-term |
| 4 | `compactors` extraction from workstationRoutes.js | Maintenance debt | Clean routes layer | Next session |
| 5 | `isOffensiveAttackStat` unification | Silent scoring divergence | Trust surface correctness | Near-term |
| 6 | NBA ecology audit (5 overlapping slip modules) | Unknown scoring bias | NBA slip quality | Priority session |
| 7 | `http/inlined.js` files audit (11K lines) | Dead code or hidden coupling | Codebase clarity | Near-term audit |
| 8 | `__refreshInProgress` deadlock | Silent stale data | Operational reliability | Medium-term |
| 9 | server.js Phase A extraction | Context-drift risk for future AI sessions | Maintainability | After ARCHITECTURE.md |
| 10 | Docs root/`docs/` sync (two copies) | Doc drift | Repo RAM reliability | Low-effort fix |

---

## NBA PIPELINE NOTE

The NBA pipeline has 5 overlapping slip/pick construction modules totaling ~3,500 lines
(`buildNbaDynamicSlipEngine`, `buildNbaSlipEngine`, `buildNbaSlipComposer`, `buildNbaAiSlips`,
`buildNbaAiPicks`) that have NOT received the ecology audit the MLB shared pipeline received.

**Before NBA slips can be considered operator-grade:**
- Apply same `edge × modelProb` compounding lens as MLB audit
- Check tierBoost asymmetry (ELITE/STRONG under-assignment on NBA slates)
- Check volRealism gaps across NBA stat families (points, rebounds, assists, PRA, threes)
- Determine which of the 5 modules is actually the canonical execution path
- Apply trust-qualification overrides if same bias patterns found

Until this audit is done, NBA slip quality is unverified. MLB trust surfaces are correct.

---
_Last updated: 2026-05-07 — initial creation from full codebase audit_
_Next update trigger: any structural change to pipeline/, server.js routes, or persistence layer_
