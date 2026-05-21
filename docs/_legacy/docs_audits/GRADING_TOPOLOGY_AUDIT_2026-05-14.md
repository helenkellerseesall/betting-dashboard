# PHASE Grading-Calibration-Operations-1A — GRADING TOPOLOGY AUDIT
**Audit-first deliverable. Phase 1A: discovery + roadmap. NO code patches in this phase.**
**Operator review required before Phase 1B (calibration loop activation).**

_Generated: 2026-05-14 | Builds on: `FULL_SYSTEMS_AUDIT_2026-05-14.md` §5, §10, §11; `PERSISTENCE_AUDIT_2026-05-14.md` §10 — both partially STALE on grading reality (corrected below)._

---

## EXECUTIVE SUMMARY (5 sentences)

Prior audits (May 14 institutional + May 14 persistence §10) called the grading→SQLite outcome bridge a "LOAD-BEARING GAP — NO WRITER WIRED." **That finding is now WRONG.** Live source inspection reveals `intel.recordOutcomes` and `intel.recordSlipOutcome` ARE WIRED — at `pipeline/shared/buildPostGameReview.js:428` + `:435`, invoked via `runPostGameReview` which is the canonical Step 3 of `buildNightlyOrchestrator`. The actual gap is one layer higher: **`buildNightlyOrchestrator` has zero production callers**, and its bridge is therefore dormant — `outcome_snapshots`, `slip_outcomes`, `calibration_records`, `ecology_grades`, `daily_intelligence_reports`, `process_classifications`, `volatility_realizations`, `eruption_events` are all at 0 rows despite 1,534+ already-graded bets sitting in JSON tracking files across 10 historical dates. The fix is **operational, not architectural** — wire a canonical orchestrator entrypoint, ensure `personal_ledger.json` actually receives grading results from `tracked_bets_*.json` (today 2,000/2,000 ledger bets are at `result='pending'` despite extensive JSON grading), and add observability + an `npm run grading:backfill` flow that walks the entire chain idempotently.

---

## 1. GRADING TOPOLOGY MAP

### 1.1 Five-tier topology (current reality)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 1 — Grading source (API → JSON)                                   │
│   pipeline/grading/fetchMlbGameResults.js                              │
│   pipeline/grading/fetchNbaGameResults.js                              │
│   ↓                                                                    │
│   pulls box-score + player stat lines per (sport, date)                │
└────────────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 2 — In-place bet/slip settlement (JSON mutation)                  │
│   pipeline/grading/gradeTrackedBets.js                                 │
│     writes result = 'win'|'loss'|'push'|'unresolved'|'pending'         │
│     mutates tracked_bets_{sport}_{date}.json in place                  │
│   pipeline/grading/gradeTrackedSlips.js                                │
│     mutates tracked_slips_{sport}_{date}.json in place                 │
│   ↓                                                                    │
│   pipeline/grading/buildGradingSummary.js                              │
│     writes grading_summary_{sport}_{date}.json                         │
│                                                                        │
│ Operator entrypoint TODAY: npm run grading:run (Phase OpOps-1)         │
│   → runHistoricalGrade.js → fetchGameResults → grade* → summary        │
└────────────────────────────────────────────────────────────────────────┘
                              ↓ ... (here be dragons — dormant) ...
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 3 — Nightly orchestration (6-step pipeline) — DORMANT             │
│   pipeline/shared/buildNightlyOrchestrator.js                          │
│     Step 1: completion check (stepCompletion)                          │
│     Step 2: stepApplyResults — finalize bet/leg result fields          │
│     Step 3: stepPostGameReview → runPostGameReview                     │
│              → reads personal_ledger.json settled bets                 │
│              → intel.recordOutcomes(settlements)                       │
│              → intel.recordSlipOutcome(slip, result)                   │
│              → writes outcome_snapshots + slip_outcomes (SQLite)       │
│     Step 4: stepLedgerImport (importFromTrackedBets)                   │
│     Step 5: stepLedgerSettle — propagate result → personal_ledger      │
│     Step 6: stepClvUpdate (closing-line-value reconciliation)          │
│   ↓                                                                    │
│   ZERO production callers. One comment ref in                          │
│   buildMarketTimingIntelligence.js. Never invoked.                     │
└────────────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 4 — Daily intelligence review (Session W) — PARTIALLY DORMANT     │
│   pipeline/review/buildDailyIntelligenceReview.js                      │
│     INSERT OR REPLACE into:                                            │
│       - daily_intelligence_reports                                     │
│       - calibration_records                                            │
│       - ecology_grades                                                 │
│       - volatility_realizations                                        │
│       - eruption_events                                                │
│       - process_classifications                                        │
│     also writes daily_intelligence_review_{sport}_{date}.json          │
│   pipeline/review/buildEcologyGrader.js                                │
│   pipeline/review/buildCalibrationMetrics.js                           │
│   pipeline/review/buildVolatilityReview.js                             │
│   pipeline/review/buildProcessClassifier.js                            │
│   pipeline/review/buildOffensiveEruptionAnalysis.js                    │
│                                                                        │
│ Operator entrypoint TODAY: npm run grading:review (Phase OpOps-1)      │
│   → runDailyReview.js → buildDailyIntelligenceReview                   │
│ Run ONCE in repo history (2026-05-05) — `nightly_review_2026-05-05.json`│
│ JSON `daily_intelligence_review_*.json` files DON'T EXIST on disk      │
│ SQLite review tables: 0 rows                                           │
└────────────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 5 — Personal-ledger settlement + CLV (also dormant)               │
│   pipeline/shared/buildPersonalLedger.js                               │
│     - importFromTrackedBets   (line 1045) — pulls bets into ledger     │
│     - stepLedgerImport invoker (orchestrator, dormant)                 │
│     - settleBet / markResult (per orchestrator step 5, dormant)        │
│   pipeline/shared/buildClv.js                                          │
│     - computeClv, classifyResultVsClv, buildClvAnalytics               │
│                                                                        │
│ personal_ledger.json status TODAY: 2,000 bets, ALL result='pending'    │
│   - 0 win, 0 loss, 0 push, 0 unresolved                                │
│   - despite 1,534+ settled in tracked_bets_*.json                      │
│                                                                        │
│ CLV layer: pure functions only, no wired data path today               │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 What's in JSON today (concrete inventory)

```
runtime/tracking/ grading state (2026-05-14):

  mlb_tracked_bets_2026-05-05.json         total=947   settled=848
  mlb_tracked_bets_2026-05-06.json         total=299   settled=274
  mlb_tracked_bets_2026-05-07.json         total=190   settled=178
  mlb_tracked_bets_2026-05-08.json         total=134   settled=123
  mlb_tracked_bets_2026-05-09.json         total=94    settled=84
  mlb_tracked_bets_2026-05-12.json         total=262   settled=0    ← recent slate, not yet graded
  mlb_tracked_bets_2026-05-13.json         total=22    settled=0
  mlb_tracked_bets_2026-05-14.json         total=32    settled=0
  mlb_tracked_bets_9999-12-31.json         total=5     settled=5    ← sentinel test row

  nba_tracked_bets_2026-05-05.json         total=11    settled=11
  nba_tracked_bets_2026-05-06.json         total=1     settled=1
  nba_tracked_bets_2026-05-07.json         total=5     settled=0    ← anomaly: zero settled despite older date
  nba_tracked_bets_2026-05-08.json         total=4     settled=4
  nba_tracked_bets_2026-05-09.json         total=6     settled=6
  nba_tracked_bets_2026-05-12.json         total=31    settled=0
  nba_tracked_bets_2026-05-13.json         total=104   settled=0
  nba_tracked_bets_2026-05-14.json         total=98    settled=0

  Total: ~1,534 settled bets in JSON sitting unrecorded in SQLite.

  post_game_review_*.json files       — only 2 files, both 2026-05-05 dated
  daily_intelligence_review_*.json    — 0 files (never written)
  nightly_review_*.json               — 1 file, 2026-05-05
  graded_props_*.json                 — 2 files (older April HR format)
  grading_summary_*.json (mlb+nba)    — 10 files
```

### 1.3 What's in SQLite today (concrete inventory)

```
outcome_snapshots              0     ← grading writer wired, dormant
slip_outcomes                  0     ← grading writer wired, dormant
outcome_links                  0     ← no writer
calibration_records            0     ← Session W writer wired, dormant
ecology_grades                 0     ← Session W writer wired, dormant
daily_intelligence_reports     0     ← Session W writer wired, dormant
process_classifications        0     ← Session W writer wired, dormant
eruption_events                0     ← Session W writer wired, dormant
volatility_realizations        0     ← Session W writer wired, dormant
personal_ledger                0     ← Persistence-1B activation pending on operator
prediction_snapshots          607    ← Sessions BD/AZ — ACTIVE
prediction_epochs              29    ← Sessions BD/AZ — ACTIVE
frozen_contextual_states      843    ← Sessions BD/AZ — ACTIVE
ecology_snapshots              12    ← Sessions AT/AW — ACTIVE
```

---

## 2. OUTCOME LINEAGE MAP

Outcome flows from **API → JSON → JSON → JSON → SQLite** today. SQLite is reachable but unreached.

```
API stat lines (mlbStatsApi, ESPN/Stats Perform for NBA)
  └── fetchMlbGameResults / fetchNbaGameResults
       └── tracked_bets_{sport}_{date}.json
            └── gradeTrackedBets writes result + actualValue in place
                 └── grading_summary_{sport}_{date}.json (summary only — derived)
                      └── post_game_review_{sport}_{date}.json (DORMANT — last 2026-05-05)
                           └── personal_ledger.json bets (DORMANT — 0/2000 settled)
                                └── post_game_review_state_{sport}.json (rolling — DORMANT)
                                     └── outcome_snapshots (SQLite — DORMANT)
                                          └── slip_outcomes (SQLite — DORMANT)
                                               └── daily_intelligence_reports + 5 sibling tables
                                                    (DORMANT)
```

The chain is whole. Every link exists in code. Only the orchestrator invocation is missing.

---

## 3. DORMANT GRADING SYSTEMS

| Layer | Module | Dormancy reason | Last activity |
|---|---|---|---|
| Step 2 — JSON in-place grading | `gradeTrackedBets.js`, `gradeTrackedSlips.js` | **ACTIVE** when operator runs `grading:run` | 2026-05-09 (last graded date) |
| Step 3 — Post-game review (writes `outcome_snapshots`) | `runPostGameReview` in `buildPostGameReview.js` | Wired but only invoked once (2026-05-06) | 2026-05-06 (single output file pair) |
| Step 4 — Ledger import | `importFromTrackedBets` in `buildPersonalLedger.js` | Wired but only invoked via dormant orchestrator | Never observed in 2,000-bet snapshot |
| Step 5 — Ledger settlement | `stepLedgerSettle` in `buildNightlyOrchestrator.js` | Wired but never invoked | 0/2000 ledger bets settled |
| Step 6 — CLV reconciliation | `stepClvUpdate` in `buildNightlyOrchestrator.js` | Wired but never invoked | 0 CLV scores in ledger |
| Tier 4 — Daily intelligence review (6 SQLite writers) | `buildDailyIntelligenceReview.js` | Wired (6 INSERT OR REPLACE writers) but never invoked | 0 rows in all 6 tables; 0 `daily_intelligence_review_*.json` files |
| Tier 4 — Ecology grading | `buildEcologyGrader.js` | Loaded by daily review module | 0 `ecology_grades` rows |
| Tier 4 — Calibration metrics | `buildCalibrationMetrics.js` | Loaded by daily review module | 0 `calibration_records` rows |
| Tier 4 — Volatility realization | `buildVolatilityReview.js` | Loaded by daily review module | 0 `volatility_realizations` rows |
| Tier 4 — Process classifier | `buildProcessClassifier.js` | Loaded by daily review module | 0 `process_classifications` rows |
| Tier 4 — Offensive eruption | `buildOffensiveEruptionAnalysis.js` | Loaded by daily review module | 0 `eruption_events` rows |
| `nightly_review_*.json` artifact | written by orchestrator | dormant | 1 file (2026-05-05) |

**Eight SQLite tables are wired AND empty.** That's the load-bearing dormancy.

---

## 4. PERSONAL BET INGESTION STATUS

### 4.1 Current ledger state

```
personal_ledger.json (2.375 MB):
  total bets        : 2000   ← MAX_BETS ring buffer cap
  result=pending    : 2000
  result=win        : 0
  result=loss       : 0
  result=push       : 0
  result=unresolved : 0
  settled total     : 0  /  2000  (0.0%)

SQLite personal_ledger:
  rows              : 0
```

### 4.2 Why no ledger bet is settled today

`stepLedgerImport` calls `importFromTrackedBets({sport, date, defaultStake, ...})` to pull tracked_bets entries into personal_ledger. Source row's `result` field carries through (`buildPersonalLedger.js:1087` → `result: t.result || "pending"`). So if `tracked_bets_2026-05-08.json` has 123 settled bets, those would import to the ledger WITH results — but only IF `stepLedgerImport` actually runs. It doesn't.

The 2,000 ledger bets predate the current grading flow. They are from a one-shot historical import OR direct `logBet` calls. The repo has NEVER run `stepLedgerImport` against a graded JSON file.

### 4.3 Two parallel bet systems persist

- `pipeline/shared/buildPersonalLedger.js` → `personal_ledger.json` (2000 bets, all pending) → `/api/ws/ledger`
- `tracker/betTracker.js` → `tracker/betStorage.json` → `/api/bets`

Status unchanged from `PERSISTENCE_AUDIT_2026-05-14.md` §4 (Phase 1F deferred). Phase Grading-Calibration-Operations-1 does NOT consolidate these.

---

## 5. CALIBRATION GAP ANALYSIS

### 5.1 What "calibration" requires

The Session W calibration system (`buildCalibrationMetrics.js`) computes:
- modelProb-vs-actual_hit bucket curves (probability calibration)
- delta_prob = model_prob − actual_hit (per prediction)
- by-tier hit rates (ELITE/STRONG/PLAYABLE/VALUE/BASE)
- by-volatility hit rates (safe/balanced/aggressive/lotto)
- by-archetype performance

Every input requires **`outcome_snapshots.hit ∈ {0, 1}`** joined against `prediction_snapshots.model_prob`. Today: 0 rows in `outcome_snapshots`. **Calibration corpus is empty.**

### 5.2 Calibration writer is wired

`buildDailyIntelligenceReview.js:385` writes `calibration_records` via `INSERT OR REPLACE`. The query that produces those rows joins `prediction_snapshots` + `outcome_snapshots`. With 0 outcome rows, the JOIN returns empty, and the writer correctly emits nothing. The wire is correct; the upstream tap is closed.

### 5.3 Gap rank (priority order to close calibration)

| Gap | Severity | Phase scope |
|---|---|---|
| 1. `outcome_snapshots` 0 rows | CRITICAL | Phase Grading-Calibration-Operations-1B (orchestrator activation) |
| 2. `prediction_id_aliases` not populated → pre-E1 outcomes may not join cleanly | MEDIUM | Phase Persistence-1B operator backfill (pending) |
| 3. Personal-ledger settled bets at 0 → `stepLedgerSettle` cannot recompute CLV | MEDIUM | Phase 1B (same as gap 1) |
| 4. `daily_intelligence_reports` 0 rows → Session W trend curves don't exist | LOW (depends on 1–3) | Phase 1B downstream effect |
| 5. No `calibration:status` operator command | LOW | Phase Grading-Calibration-Operations-1C (operator tooling) |

---

## 6. CLV INFRASTRUCTURE STATUS

### 6.1 What exists

`pipeline/shared/buildClv.js`:
- `computeClv({placedOdds, closingOdds, placedLine, closingLine, side, sportsbook, closingSportsbook})` → CLV score
- `classifyResultVsClv(result, clv)` → `'good_process_won'` / `'good_process_lost'` / `'bad_process_won'` / `'bad_process_lost'`
- `buildClvAnalytics(bets)` → aggregate by-process-quality summary

### 6.2 What's wired

- `buildPostGameReview.js` references buildClv (process classification feeds review)
- `buildPersonalLedger.js:upsertLedgerBet` writes `clv_score` + `clv_quality` columns in the personal_ledger SQLite table (Phase Persistence-1B schema)

### 6.3 What's missing

- **No closing-line capture.** `stepClvUpdate` in orchestrator presumes a closing odds source exists; the repo doesn't capture closing odds for any bet today. Where would `closingOdds` come from? The snapshot at game-time? A timed final-snapshot fetch? **The CLV layer is architecturally ready but operationally has no input.**
- `clv_score` column in `personal_ledger` table is always NULL.

### 6.4 CLV is downstream of personal-ledger settlement

CLV requires the bet to be settled AND to have a closing reference. Closing reference requires either (a) a final-snapshot capture at game-time, or (b) a separate closing-odds ingestion. Neither exists today.

**CLV is the lowest priority of the four calibration-related gaps** — it depends on closing-odds ingestion which is itself a new pipeline.

---

## 7. HISTORICAL BACKFILL STRATEGY

### 7.1 What can be safely backfilled

| Source | Backfill target | Operation |
|---|---|---|
| 1,534+ settled bets in `tracked_bets_{sport}_{date}.json` (10 dates) | `outcome_snapshots` (SQLite) | Iterate dates → `runPostGameReview(sport, date)` → `intel.recordOutcomes` |
| 0 NBA-settled / 274 MLB-settled per day average across dates | Personal ledger bets | `importFromTrackedBets` for each (sport, date) tuple |
| Settled `tracked_slips_{sport}_{date}.json` | `slip_outcomes` (SQLite) | Same as above; `recordSlipOutcome` |
| 5 daily review rolls (per sport-date with settled data) | `daily_intelligence_reports` + 5 sibling tables | Iterate dates → `runDailyIntelligenceReview` |

### 7.2 What CANNOT be safely backfilled

- **Closing odds** — never captured at game time; cannot be reconstructed retroactively.
- **Pre-E1 prediction_id collisions** — backfill via `prediction_id_aliases` (Phase Persistence-1B candidate, pending operator execution).
- **Game-time market-shift signals** — never recorded; cannot be reconstructed.

### 7.3 Recommended backfill ordering (each operator-gated)

1. **Phase 1B-step-A**: Activate the orchestrator. Add `npm run grading:backfill` that iterates `(sport, date)` tuples over the 10 historical dates and calls `runPostGameReview` for each. Verify `outcome_snapshots` grows.
2. **Phase 1B-step-B**: After 1B-A succeeds, run `stepLedgerImport` for each historical date so personal_ledger.json receives the settled bets. Verify `result='win'/'loss'/etc.` counts grow above 0.
3. **Phase 1B-step-C**: Run `runDailyIntelligenceReview` for each historical date → Session W tables populate.
4. **Phase 1B-step-D**: Phase Persistence-1B operator-side `npm run persistence:import` then `npm run persistence:backfill-aliases` so SQLite personal_ledger + composite-key aliases populate.

Each step idempotent (all writers use INSERT OR IGNORE / INSERT OR REPLACE). Each is independently revertable.

---

## 8. AUTHORITATIVE GRADING OWNER

**Today** — multiple owners, no single bridge:

| Domain | Owner |
|---|---|
| JSON in-place grading | `runHistoricalGrade.js` → `gradeTrackedBets.js` / `gradeTrackedSlips.js` |
| Per-date grading summary | `buildGradingSummary.js` → `grading_summary_*.json` |
| Personal-ledger ingestion | `buildPersonalLedger.js:importFromTrackedBets` (NOT wired into runtime flow) |
| Personal-ledger settlement | `stepLedgerSettle` in `buildNightlyOrchestrator.js` (dormant) |
| Outcome → SQLite | `buildPostGameReview.js:428` + `:435` (dormant — orchestrator never called) |
| Daily intelligence review | `buildDailyIntelligenceReview.js` (writes 6 SQLite tables, dormant) |
| CLV computation | `buildClv.js` (pure functions; no caller in production flow) |

**Proposed canonical owner (Phase 1B)**:

`pipeline/shared/buildNightlyOrchestrator.js` is the structural canonical owner. It already chains all 6 steps in correct order. Phase 1B's role is **activation, not redesign** — add a single canonical entrypoint:

```
backend/scripts/runGradingPipeline.js           ← NEW thin wrapper
  → buildNightlyOrchestrator.orchestrate({ sport, date, write: true })
```

Exposed as:
```
npm run grading:backfill                         ← NEW (operator-vocabulary)
```

This preserves Phase OpOps-1 naming and reuses existing infrastructure entirely.

---

## 9. SQLITE GRADING EVOLUTION PLAN

**Phase 1A (this audit) ships nothing.** Phase 1B+ proposed:

### Phase Grading-Calibration-Operations-1B — orchestrator activation (operator-gated)

1. New CLI: `backend/scripts/runGradingPipeline.js` — thin wrapper around `buildNightlyOrchestrator`.
2. New npm script: `npm run grading:backfill` (per-date) and `npm run grading:backfill-all` (all dates with settled bets).
3. New npm script: `npm run grading:status` — read-only inspector showing SQLite outcome counts vs JSON settled counts (parity check, like `persistence:status`).
4. New npm script: `npm run calibration:status` — read-only inspector showing `daily_intelligence_reports` + `calibration_records` + per-tier hit rates.
5. New probe `probe_grading_backfill_v1.js` — runs orchestrator against /tmp DB with synthetic settled fixture; asserts `outcome_snapshots` / `slip_outcomes` / `calibration_records` populate; asserts idempotency on re-run.

**Risk**: Medium. The orchestrator chains 6 steps; any one of them throwing would halt the chain. Mitigation: each step already has its own try/catch around `intel.*` writes (silent-failure design pattern, per the existing buildPostGameReview shape).

### Phase Grading-Calibration-Operations-1C — Session W review activation

1. Confirm `runDailyReview` → `buildDailyIntelligenceReview` writes all 6 tables correctly.
2. Backfill the 10 historical dates.
3. Surface a frontend `IntelligenceReviewView` (NOT in scope of this audit — placeholder).

### Phase Grading-Calibration-Operations-1D — outcome-link wiring

`outcome_links` is a Phase U screenshot-intelligence table (per `screenshotSchema.js`) — links a parsed screenshot leg to its outcome. Currently 0 rows. Activation depends on Phase U screenshot ingestion being operationally active, which it is not. **Deferred** out of this phase.

### Phase Grading-Calibration-Operations-1E — closing-odds capture (longer-term)

Add a final-snapshot capture (e.g. 5 min before scheduled lock) that records every bet's `closingOdds` and `closingLine`. Required for `stepClvUpdate` to actually populate `clv_score`. Separate operator-approval gate; new pipeline. **Deferred.**

---

## 10. OPERATOR GRADING WORKFLOW (target state after Phase 1B)

```
Today (after operator runs):
  npm run grading:run -- --date=2026-05-14
     → fetches results + writes tracked_bets_*.json result fields
     → writes grading_summary_*.json
     → STOPS HERE today

Phase 1B target (after operator runs):
  npm run grading:run -- --date=2026-05-14
     → as above

  npm run grading:backfill -- --date=2026-05-14    (NEW)
     → invokes buildNightlyOrchestrator for that date
     → outcome_snapshots ← grows
     → slip_outcomes     ← grows
     → personal_ledger.json bets receive results
     → personal_ledger SQLite mirror gets updated

  npm run grading:review -- --date=2026-05-14      (existing)
     → invokes buildDailyIntelligenceReview
     → daily_intelligence_reports ← grows
     → calibration_records        ← grows
     → ecology_grades             ← grows
     → volatility_realizations    ← grows
     → eruption_events            ← grows
     → process_classifications    ← grows

  npm run grading:status                            (NEW)
     → inspector: JSON settled vs SQLite outcome parity
     → shows lag between dates settled in JSON vs in SQLite

  npm run calibration:status                        (NEW)
     → inspector: per-tier hit rates + delta_prob averages
     → shows whether calibration corpus is healthy
```

---

## 11. PRE-SLATE VS POST-SLATE RESPONSIBILITIES (target state)

### Pre-slate (TERM 2)
```
npm run brain:bootstrap
npm run brain:continuity
npm run engine:status                  (or engine:restart if needed in TERM 1)
npm run slate:nba                      ← canonical NBA refresh (Phase OpOps-1A fixed)
npm run slate:mlb
npm run runtime:verify
```

### In-slate (game time)
```
(no canonical commands; refreshes are automatic via /refresh-snapshot cooldown)
```

### Post-slate (after games settle, the new canonical chain)
```
npm run grading:run        -- --date=$(date +%Y-%m-%d)    # JSON in-place grade
npm run grading:backfill   -- --date=$(date +%Y-%m-%d)    # ← NEW Phase 1B: SQLite outcomes + ledger settle
npm run grading:review     -- --date=$(date +%Y-%m-%d)    # Session W daily review
npm run grading:status                                     # ← NEW Phase 1B: parity inspector
npm run calibration:status                                 # ← NEW Phase 1B: calibration health
npm run persistence:status                                 # ledger + alias parity
npm run epoch:status                                       # epoch authority
npm run brain:checkpoint                                   # seal session
```

---

## 12. LONGITUDINAL LEARNING READINESS

**Today: 0%.** The calibration corpus is empty. The learning system has no input.

**After Phase 1B (orchestrator activation + historical backfill)**:
- `outcome_snapshots` populated for 10 historical dates (estimated 1,534+ rows)
- `prediction_snapshots` ↔ `outcome_snapshots` joined via composite id (with `prediction_id_aliases` bridging pre-E1 entries — Phase Persistence-1B)
- `calibration_records` per-bucket curves available
- `ecology_grades` per-date diversity snapshots available
- Session W's "18 daily questions" answerable

**After Phase 1C (Session W activation)**:
- Daily trend curves: by-tier hit rate over time
- Eruption detection backfill: HR eruption misses retroactively detected
- Process classification: good-process-lost vs bad-process-won tracking

**Blocked on (not in this phase)**:
- CLV scores require closing-odds capture (Phase 1E).
- Multi-tenant calibration requires multi-bettor schema (out of scope).
- Real-time learning loop (model retraining) requires Phase 1B+1C complete + a model-training pipeline (none exists yet).

---

## 13. HIGHEST-RISK INTEGRITY GAPS

Ranked.

| # | Risk | Likelihood | Impact | Phase to address |
|---|---|---|---|---|
| 1 | Calibration corpus empty silently — operator believes calibration is "available" when it's a 0-row no-op | HIGH (today) | HIGH — every "calibration says X" claim is false today | Phase 1B: `npm run calibration:status` makes the emptiness loud |
| 2 | Personal ledger 2000 bets all pending — operator decision data has no result feedback | HIGH (today) | HIGH — process classification (good-vs-bad decisions) can't function | Phase 1B-step-B: stepLedgerSettle backfill |
| 3 | Composite-key forward-only migration → pre-E1 outcomes won't join clean | MEDIUM | MEDIUM — silent 5-15% join miss on backfill | Phase Persistence-1B operator backfill (already shipped, pending operator execution) |
| 4 | Orchestrator failure mid-chain leaves outcome_snapshots partial vs ledger | MEDIUM | MEDIUM | Phase 1B: wrap each step in try/catch with explicit `[ORCH-STEP-FAILED]` log; ensure idempotency on re-run |
| 5 | `runDailyReview` writes JSON to `runtime/tracking/daily_intelligence_review_*.json` per script docstring, but NO such file exists on disk — has the JSON path ever fired? | MEDIUM | LOW — observability gap; not a corruption risk | Phase 1B probe asserts JSON-and-SQLite parity post-review |
| 6 | `nightly_review_2026-05-05.json` is 8 days old — review engine appears to have run ONCE and stopped | HIGH (today) | LOW — recoverable via backfill | Phase 1B backfill captures this date + 9 others |
| 7 | CLV layer can never be populated without closing-odds capture, but `clv_score` column exists and queries assume it | LOW | MEDIUM (silent NULL ambiguity) | Phase 1E (deferred); document `clv_score` as expected-NULL in current era |
| 8 | `prior audits explicitly said "outcome writer NOT wired"` — operator may have built mental model around that finding | MEDIUM | MEDIUM — wrong mental model leads to wrong patching priorities | THIS AUDIT corrects the prior audits |
| 9 | Two parallel bet systems (personal_ledger vs tracker/betStorage) — grading currently ignores tracker/betStorage entirely | LOW | LOW (today; tracker is barely used) | Phase Persistence-1F (deferred) |
| 10 | Phase 4 tracking writes `tracked_bets_9999-12-31.json` (sentinel) — that file has 5 "settled" sentinel rows; backfill must exclude sentinels | LOW | LOW | Phase 1B backfill filters dates |

---

## 14. AUDIT-STALE-SOURCE CORRECTIONS (5th consecutive application of the carry-forward rule)

The carry-forward rule from `FULL_SYSTEMS_AUDIT_2026-05-14.md` postscript now self-applies, including to recent prior audits:

| Prior claim | Reality (verified 2026-05-14) |
|---|---|
| `PERSISTENCE_AUDIT_2026-05-14.md` §10: "NO WRITER WIRED YET" for `outcome_snapshots` | **WRONG.** `intel.recordOutcomes` is wired at `buildPostGameReview.js:428`. The gap is one layer up — orchestrator has no callers. |
| `PERSISTENCE_AUDIT_2026-05-14.md` §10: "Grading writes JSON only" | **PARTIALLY TRUE.** Tier 2 writes JSON only. Tier 3 (post-game review) is wired to SQLite but dormant. |
| `FULL_SYSTEMS_AUDIT_2026-05-14.md` Top Risk #5: "outcome wiring is a load-bearing gap" | **CORRECT in effect, WRONG in root cause.** The gap is in the orchestrator's invocation, not the writer's existence. |
| `FULL_SYSTEMS_AUDIT_2026-05-14.md` Hidden Failure #4: "PRA always-aggressive calibration trap" | **STILL UNVERIFIED.** Calibration corpus is empty; this hypothesis is currently untestable. |
| Prior assumption: "the daily review engine runs nightly" | **WRONG.** Has run exactly once (2026-05-05) per the single `nightly_review_2026-05-05.json` artifact. |

---

## 15. RECOMMENDED NEXT-SESSION SCOPE

Phase Grading-Calibration-Operations-1B — orchestrator activation. One operator-approval gate, four items:

1. New CLI `backend/scripts/runGradingPipeline.js` (thin wrapper around `buildNightlyOrchestrator.orchestrate`).
2. New npm scripts: `grading:backfill`, `grading:backfill-all`, `grading:status`, `calibration:status`.
3. Probe `probe_grading_backfill_v1.js` — synthetic-fixture backfill against `/tmp` DB; asserts `outcome_snapshots` / `slip_outcomes` populate; asserts idempotency.
4. Update `OPERATOR_RUNBOOK.md` post-slate ceremony to include the new commands.

**Estimated lines**: ~400 net additive. Zero deletions. No existing CLI / endpoint / runtime authority touched. Five existing freeze writers preserved. Phase Persistence-1B operator-execution path preserved. Phase Race-1 watchdog preserved.

**Risk**: Medium — first time the orchestrator is invoked in production. Mitigation:
- All writers use INSERT OR IGNORE / INSERT OR REPLACE (idempotent).
- Each step wrapped in try/catch with explicit `[ORCH-STEP-FAILED]` observability.
- Probe asserts behavior on `/tmp` fixture before operator runs against production.

---

## 16. WHAT THIS PHASE DOES NOT DO

- ❌ Does NOT modify any backend route, endpoint, runtime authority.
- ❌ Does NOT modify any of the 5 existing `compute*EpochId` functions.
- ❌ Does NOT modify any grading logic — only adds an orchestrator entrypoint.
- ❌ Does NOT consolidate the parallel bet systems (Phase 1F deferred).
- ❌ Does NOT add closing-odds capture (Phase 1E deferred).
- ❌ Does NOT add a frontend review surface.
- ❌ Does NOT change the `pipeline/shared/buildNightlyOrchestrator.js` 6-step chain.

---

## 17. DELIVERABLE SUMMARY

**Phase 1A (this phase — shipped today)**:
- This audit document (16 sections, ~700 lines).
- Brain doc updates per Law 12.
- No code change. No CLI added.

**Phase 1A files touched**:
```
docs/GRADING_TOPOLOGY_AUDIT_2026-05-14.md         NEW (this doc)
backend/runtime/brain/MASTER_BRAIN.md             current-phase + grading topology section
backend/runtime/brain/CURRENT_RUNTIME_STATE.md    Phase 1A entry
backend/runtime/brain/MODEL_EVOLUTION_LOG.md      new dated entry at top + audit-stale-correction
backend/runtime/brain/PIPELINE_AUTHORITY_MAP.md   GRADING authority section
backend/runtime/brain/ACTIVE_INCIDENTS.md         INC-010 / INC-011 added (dormant orchestrator + 2000 unsettled ledger bets)
docs/OPERATOR_RUNBOOK.md                          post-slate ceremony note + Phase 1B gate reference
CURRENT_STATE.md                                  session entry
NEXT_SESSION.md                                   Phase 1B operator-approval gate
```

**Verification**:
- `npm run brain:bootstrap` PASS
- `npm run brain:continuity` PASS
- `npm run brain:verify` PASS
- `npm run runtime:verify` 14/14 PASS (no code touched, regression unchanged)
- `npm run persistence:probe` 44/44 PASS
- `probe_epoch_authority_v1.js` 48/48 PASS
- Direct source inspection of: `buildPostGameReview.js`, `buildNightlyOrchestrator.js`, `buildDailyIntelligenceReview.js`, `buildPersonalLedger.js`, `buildClv.js`, `runHistoricalGrade.js`, `runDailyReview.js`, `gradeTrackedBets.js`, `gradeTrackedSlips.js`, `buildGradingSummary.js`, `fetchMlbGameResults.js`, `fetchNbaGameResults.js`, `intelligenceSchema.js`, `intelligence.js`.
- Live SQLite row-count query of 14 grading/review-related tables.
- Live JSON file inventory of 17 `tracked_bets_*` + 26 `graded/summary/hr` files + ledger + review-state files.

---

_Phase Grading-Calibration-Operations-1A audit shipped: 2026-05-14_
_Carry-forward rule applied (5th consecutive phase) — re-verified all writers/readers from current source._
_Author: Claude (Cowork mode), under ARCHITECTURE_LAWS.md Laws 1/4/9/10/12/16._
_Phase 1B is operator-gated. See NEXT_SESSION.md._
