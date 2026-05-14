# PHASE Persistence-1A — PERSISTENCE TOPOLOGY AUDIT
**Phase A deliverable: persistence-topology map, schema proposal, phased cutover plan**
**NO code patches in this phase. Operator review required before Phase B (dual-write activation).**

_Generated: 2026-05-14 | Updates and corrects findings in: `docs/FULL_SYSTEMS_AUDIT_2026-05-14.md`_

---

## EXECUTIVE SUMMARY (5 sentences)

The May 14 systems audit treated SQLite ledger cutover as "Phase Persistence-1 — not yet started." Live source inspection shows the migration infrastructure is **fully wired but largely dormant**: the schema layer chains four DDL files, the personal-ledger write mirror is implemented with silent-failure lazy init, `importHistoricalData.js` is a complete idempotent backfill CLI, and the longitudinal layer (`prediction_snapshots`, `prediction_epochs`, `frozen_contextual_states`) is **actively populating in production today** (607 / 29 / 843 rows). But the daily-rolling tables (`tracked_props`, `slip_catalog`, `hr_predictions`) are at **0 rows** despite 60+ matching JSON files on disk, the personal-ledger table is at **0 rows** despite 2,000 bets in JSON, and `outcome_snapshots` is at **0 rows** — meaning the grading layer is not yet feeding the calibration loop that the schema was designed for. The single highest-leverage move is therefore not "write new SQLite code" — it is **activate the dormant infrastructure**: (1) run `importHistoricalData.js`, (2) wire grading-result writes into `outcome_snapshots`, (3) verify the personal-ledger write-mirror is firing on actual operator usage, (4) add retention policy on the longitudinal tables before they grow unbounded.

---

## 1. AUDIT-STALE-SOURCE CORRECTIONS (carry-forward from Race-1)

Per the postscript added to `FULL_SYSTEMS_AUDIT_2026-05-14.md`: **re-verify each finding against current source before patching.** Today's investigation confirms three more findings that need correction:

| May 14 audit claim | Reality on 2026-05-14 |
|---|---|
| "All persistence is flat JSON. No atomic writes." | `buildPersonalLedger.js:112-128` already does atomic .tmp + rename. `tracker/betTracker.js:41-45` does the same. Other writers (state files) do not — this is the residual risk. |
| "`applyAllSchemas(db)` would close this hole permanently." | `applySchema()` in `storage/schema.js:225-230` ALREADY chains `applyScreenshotSchema` + `applyReviewSchema` + `applyIntelligenceSchema`. The chain exists. The single-entry-point hole is closed. |
| "Personal-ledger write mirror is done, read path uncutover." | Code is correct. Mirror is wired and lazy. But `personal_ledger` table has **0 rows** in production, so the "dual-write" is operationally a "single-write JSON only" because the mirror has never had data to mirror. |
| "Longitudinal tables on track to be largest in system within 90 days." | Already actively populating. Need retention policy NOW, not in 90 days. |
| "`importHistoricalData.js` may NOT have ingested April legacy data." | Confirmed — `importHistoricalData.js` has never been run. Every count-table at 0 rows. The script is correct and idempotent; it just hasn't been executed. |

The remaining May 14 findings (NBA two-path, `workstationRoutes.js` NBA imports, dead inlined NBA files, `timing_intelligence_state.json` size, `propVariant` gate) are still unverified for staleness and remain Phase-2 candidates.

---

## 2. PERSISTENCE TOPOLOGY MAP

### 2.1 SQLite — `backend/storage/betting.db` (2.15 MB, 23 tables)

```
┌─ TABLE ─────────────────────────┬─ ROWS ─┬─ STATUS ──────────────────────────────────────────────┐
│ ACTIVE (writing in production)  │        │                                                       │
│ ─────────────────────────────── │        │                                                       │
│ prediction_snapshots            │   607  │ Session BD/AZ writes — snapshot + workstation freeze  │
│ prediction_epochs               │    29  │ Session AZ + BD — composite PK on (sport,slate,epoch) │
│ frozen_contextual_states        │   843  │ Session AZ writes — composite PK (pred_id, epoch_id)  │
│ ecology_snapshots               │    12  │ Sessions AT/AW — concentration diagnostics            │
│ sqlite_sequence                 │     1  │ SQLite internal                                        │
│                                 │        │                                                       │
│ WIRED BUT DORMANT (schema       │        │                                                       │
│ exists, writers exist, but no   │        │                                                       │
│ rows produced in prod yet)      │        │                                                       │
│ ─────────────────────────────── │        │                                                       │
│ tracked_props                   │     0  │ Schema OK; importHistoricalData backfill not run      │
│ slip_catalog                    │     0  │ Schema OK; importHistoricalData backfill not run      │
│ hr_predictions                  │     0  │ Schema OK; importHistoricalData backfill not run      │
│ personal_ledger                 │     0  │ Write-mirror wired in saveLedger; operator hasn't     │
│                                 │        │ exercised /api/ws/ledger writes? Or lazy-init failing │
│                                 │        │ silently? Needs probe.                                │
│ nightly_runs                    │     0  │ recordNightlyRun() wired but only inside import CLI   │
│ outcome_snapshots               │     0  │ Schema OK; NO writer wired from grading layer yet     │
│ slip_outcomes                   │     0  │ Schema OK; NO writer wired from grading layer yet     │
│ outcome_links                   │     0  │ Schema OK; NO writer wired                            │
│ bettor_profiles                 │     0  │ Phase U screenshot intelligence; screenshot ingest    │
│                                 │        │ not yet operator-active                                │
│ parsed_slips                    │     0  │ Phase U — not active                                  │
│ slip_classifications            │     0  │ Phase U — not active                                  │
│ screenshot_submissions          │     0  │ Phase U — not active                                  │
│ daily_intelligence_reports      │     0  │ Session W review engine — not running in prod         │
│ ecology_grades                  │     0  │ Session W — not running                                │
│ eruption_events                 │     0  │ Session W — not running                                │
│ calibration_records             │     0  │ Session W — depends on outcome_snapshots being fed    │
│ process_classifications         │     0  │ Session W — not running                                │
│ volatility_realizations         │     0  │ Session W — not running                                │
└─────────────────────────────────┴────────┴───────────────────────────────────────────────────────┘
```

**Conclusion**: 5 of 23 tables are doing real work (the longitudinal-prediction layer + ecology). 18 tables are wired infrastructure waiting for: (a) import CLI run, (b) grading outcome wiring, (c) Phase W review engine activation, (d) operator interaction (Phase U screenshots), (e) operator interaction (personal ledger).

### 2.2 JSON — `backend/runtime/tracking/` (144 files, ~30 MB total)

```
DAILY ROLLING (replay-safe by date — natural retention via filename)
──────────────────────────────────────────────────────────────────────
  mlb_tracked_bets_YYYY-MM-DD.json       (9 files)   141 KB avg  ← canonical MLB candidates
  nba_tracked_bets_YYYY-MM-DD.json       (8 files)     5 KB avg  ← canonical NBA candidates
  mlb_tracked_best_YYYY-MM-DD.json      (17 files)  139 KB avg  ← MLB attack board
  nba_tracked_best_YYYY-MM-DD.json       (4 files)              ← NBA attack board
  mlb_tracked_slips_YYYY-MM-DD.json      (8 files)  187 KB avg  ← MLB AI slips
  nba_tracked_slips_YYYY-MM-DD.json      (8 files)              ← NBA AI slips
  mlb_picks_YYYY-MM-DD.json             (17 files)  varies      ← legacy MLB picks
  hr_slips_YYYY-MM-DD.json              (14 files)   21 KB avg  ← HR-specific slips
  graded_props_YYYY-MM-DD.json           (2 files)              ← grading output
  grading_summary_mlb_YYYY-MM-DD.json    (5 files)              ← grading summaries
  grading_summary_nba_YYYY-MM-DD.json    (5 files)              ← grading summaries
  mlb_tracking_summary_YYYY-MM-DD.json   (8 files)              ← tracking summaries
  nba_tracking_summary_YYYY-MM-DD.json   (8 files)              ← tracking summaries
  tracked_props_YYYY-MM-DD.json         (18 files)  legacy Apr  ← pre-Phase4 HR format
  hr_props_YYYY-MM-DD.json                            (legacy)  ← HR-specific
  tracking_summary_YYYY-MM-DD.json       (2 files)              ← legacy

UNBOUNDED ROLLING STATE (NOT replay-safe — overwritten on every write)
──────────────────────────────────────────────────────────────────────
  personal_ledger.json                  (1 file)   2.375 MB    ← 2000-bet ring buffer (capped)
  timing_intelligence_state.json        (1 file)     729 KB    ← UNBOUNDED — no pruning
  post_game_review_state_mlb.json       (1 file)     375 KB    ← UNBOUNDED — no pruning
  post_game_review_state_nba.json       (1 file)       3 KB    ← growing
  book_intelligence_state.json          (1 file)       1 KB    ← bounded by book count
  post_game_review_mlb_YYYY-MM-DD.json   (1 file)              ← daily output, retained
  post_game_review_nba_YYYY-MM-DD.json   (1 file)              ← daily output, retained
  nightly_review_YYYY-MM-DD.json         (1 file)              ← daily review output

ORPHAN / DEBUG
──────────────────────────────────────────────────────────────────────
  mlb_tracking_summary_2026-05-05.json.tmp.98415  ← partial-write orphan (delete)
  betting_test.db                       (0 bytes)  ← test stub
  betting_test.db-journal               (512 bytes) ← test journal stub
```

### 2.3 Parallel tracker

```
backend/tracker/betTracker.js → backend/tracker/betStorage.json
                                Routes: /api/bets, /api/bets/metrics (server.js:19642, 19651)
                                Shape:  flat array, dedupeKey = date|player|propType
                                Atomic writes: YES (tmp + rename, line 41-45)
                                Consumers:    server.js routes only
                                Relationship to personal_ledger: NONE — totally disconnected
```

### 2.4 Cache / process-bridging files (not historical ledger data)

```
backend/api-sports-cache.json          ← Owner-B canonical, F-series gated
backend/snapshot.json                  ← replay-source for /refresh-snapshot?replay=disk
backend/data/mlb*.json                  ← MLB external context (pitcher, weather, bullpen, park)
backend/data/nba*.json                  ← NBA external context (injury, gamelogs)
backend/pipeline/mlb/external/         ← MLB identity cache + external context cache
backend/pipeline/nba/nba*Cache.js      ← NBA recent form, availability cache
```

These are runtime caches — NOT ledger persistence. Out of scope for Phase Persistence-1.

---

## 3. AUTHORITATIVE WRITE OWNERS

For each persistence target, the single canonical writer.

| Persistence target | Canonical writer | Authority style |
|---|---|---|
| `prediction_snapshots` | `backend/storage/intelligence.js` via `snapshotPredictions()` | INSERT OR IGNORE (immutable) |
| `prediction_epochs` | `backend/storage/intelligence.js` via freeze helpers | INSERT OR IGNORE (immutable) |
| `frozen_contextual_states` | `backend/storage/intelligence.js` via freeze helpers | INSERT OR IGNORE (immutable, composite PK) |
| `ecology_snapshots` | `backend/storage/intelligence.js` via concentration diagnostics writer | INSERT OR REPLACE per run_date+sport |
| `outcome_snapshots` | **NO WRITER YET** — schema defines `INSERT OR REPLACE` (intended) | UNWIRED |
| `slip_outcomes` | **NO WRITER YET** | UNWIRED |
| `tracked_props` | `backend/storage/queries.js:insertManyTrackedProps` | INSERT OR IGNORE |
| `slip_catalog` | `backend/storage/queries.js:insertManySlips` | INSERT OR IGNORE |
| `hr_predictions` | `backend/storage/queries.js:insertManyHrPredictions` | INSERT OR IGNORE |
| `personal_ledger` | `backend/pipeline/shared/buildPersonalLedger.js:_mirrorAllBetsToSqlite` | INSERT OR REPLACE via `upsertManyLedgerBets` |
| `nightly_runs` | `backend/storage/queries.js:recordNightlyRun` | INSERT OR REPLACE on (run_date, sport, run_type) |
| All Session-U / Session-W tables | Wired in respective build modules; not exercised in prod | various |
| `backend/runtime/tracking/personal_ledger.json` | `buildPersonalLedger.js:saveLedger` (atomic .tmp + rename) | overwrite |
| `backend/runtime/tracking/timing_intelligence_state.json` | `buildMarketTimingIntelligence.js:saveTimingState` | overwrite (NO atomicity) |
| `backend/runtime/tracking/book_intelligence_state.json` | `buildLineShoppingIntelligence.js:saveBookState` | overwrite (NO atomicity) |
| `backend/runtime/tracking/post_game_review_state_<sport>.json` | `buildPostGameReview.js` | overwrite (NO atomicity) |
| `backend/runtime/tracking/mlb_tracked_bets_*.json` | `pipeline/mlb/phase4Tracking.js` | per-date overwrite (date-bounded) |
| `backend/runtime/tracking/nba_tracked_bets_*.json` | `pipeline/nba/buildNbaPerformanceTracking.js` | per-date overwrite (date-bounded) |
| `backend/runtime/tracking/mlb_tracked_slips_*.json` | `pipeline/mlb/phase4Tracking.js` | per-date overwrite |
| `backend/runtime/tracking/nba_tracked_slips_*.json` | `pipeline/nba/*` | per-date overwrite |
| `backend/runtime/tracking/hr_slips_*.json` | `pipeline/mlb/trackMlbHrSlips.js` | per-date overwrite |
| `backend/runtime/tracking/graded_props_*.json` | `pipeline/mlb/gradeMlbHrProps.js` + `pipeline/grading/*` | per-date overwrite |
| `backend/tracker/betStorage.json` | `tracker/betTracker.js:saveBets` (atomic .tmp + rename) | overwrite |

**Findings:**
- Every SQLite table has exactly one canonical writer (or no writer at all). **No parallel SQLite writers exist.**
- JSON-side, every daily-rolling file has exactly one canonical writer. **Atomic writes are inconsistent — only `personal_ledger.json` and `betStorage.json` use the .tmp+rename pattern. Other writers (state files, daily tracking files) write directly. Partial-write orphans are possible.**
- The grading layer (`fetchMlbGameResults`, `fetchNbaGameResults`, `gradeTrackedSlips`, `gradeTrackedBets`, `buildGradingSummary`) writes to `graded_props_*.json` and `grading_summary_*.json` JSON files but does **NOT** populate `outcome_snapshots` or `slip_outcomes` in SQLite. **This is the load-bearing gap in the longitudinal loop.**

---

## 4. DUPLICATE WRITER RISKS

| Domain | Writer A | Writer B | Severity |
|---|---|---|---|
| Bet tracking | `pipeline/shared/buildPersonalLedger.js → personal_ledger.json + SQLite mirror` | `tracker/betTracker.js → betStorage.json` (NO SQLite) | **HIGH** — two completely disconnected systems. If both are used, ledger truth fragments across two stores. Exposed via different routes (`/api/ws/ledger` vs `/api/bets`). |
| Snapshot freeze | `nbaIsolatedRoutes.js:_lazyFreezePredictionEpoch` (snapshot path, Session BD) | `workstationRoutes.js:freezePredictionEpoch` (workstation path, Session AZ) | **MEDIUM** — both intentionally coexist via composite PK `(prediction_id, epoch_id)`. Risk: epoch_id derivation drift between the two writers. |
| HR prediction tracking | `pipeline/mlb/trackMlbHrProps.js → tracked_props_*.json` (legacy April format) | `pipeline/mlb/phase4Tracking.js → mlb_tracked_bets_*.json` (current canonical) | **LOW** — temporal split. Legacy stopped writing 2026-04-28. New writer is canonical going forward. SQLite `hr_predictions` is the unification target. |
| Grading writes | `pipeline/mlb/gradeMlbHrProps.js → graded_props_*.json` (HR-specific) | `pipeline/grading/gradeTrackedBets.js` (general) + `pipeline/grading/gradeTrackedSlips.js` (slips) | **MEDIUM** — three grading paths, none of which write to `outcome_snapshots` yet. Risk: when SQLite grading is added, multiple writers could double-count. |
| Schema bootstrap | `db.js:initializeAtBoot` (Session BC eager init) | `screenshotRoutes.js` lazy init on first request | **LOW** — both call `applySchema` which is idempotent. Eager wins; lazy is fallback. |

---

## 5. JSON FRAGMENTATION RISKS

| Risk | Files | Severity | Mitigation path |
|---|---|---|---|
| **Unbounded growth without pruning** | `timing_intelligence_state.json` (729 KB, no eviction); `post_game_review_state_mlb.json` (375 KB) | HIGH — multi-MB JSON parsed per request at scale | Either: (a) add date-indexed eviction to `saveTimingState` / `savePostGameReviewState`, OR (b) migrate to SQLite table with retention on write. Phase B candidate. |
| **Ring-buffer truncation loses history** | `personal_ledger.json` (capped at MAX_BETS=2000) | MEDIUM — once full, oldest bets are dropped silently | SQLite mirror eliminates this — table has no cap. Once mirror confirmed populating, JSON can shrink to "recent 200 cache" + SQLite carries full history. |
| **Non-atomic writes** | `timing_intelligence_state.json`, `book_intelligence_state.json`, `post_game_review_state_*.json`, `mlb_tracked_bets_*.json`, `nba_tracked_bets_*.json`, `mlb_tracked_slips_*.json`, etc. | MEDIUM — partial-write on crash → orphan `.tmp` or corrupt JSON | Unify on `writeJsonSync` (atomic .tmp+rename) — extract from `buildPersonalLedger.js:112` into `pipeline/shared/atomicWrite.js`. |
| **Partial-write orphans on disk** | `mlb_tracking_summary_2026-05-05.json.tmp.98415` (confirmed orphan) | LOW (one-off) | Delete on cleanup pass; prevent via atomic-write unification. |
| **Legacy format coexistence** | `tracked_props_*.json` (18 files, April pre-Phase4) coexisting with `mlb_tracked_bets_*.json` | LOW | `importHistoricalData.js` routes legacy files to `hr_predictions` table; archive originals after import verified. |
| **`mlb_picks_*.json` unbounded directory** | 17 files, 27 KB–1.5 MB each, no pruning policy | LOW — date-bounded, but accumulates indefinitely | Add 90-day archive job; SQLite is not the right target (these are dense per-day artifacts). |
| **State files cross-cutting unbounded** | `book_intelligence_state.json` — actually low growth (book count is bounded) | LOW | Acceptable as-is; revisit only if cardinality grows. |
| **Personal-ledger SQLite mirror cold** | `personal_ledger` table at 0 rows despite mirror code wired | MEDIUM (diagnostic gap) | Probe whether `saveLedger` is called in operator usage; if not, run `importHistoricalData.js` once to backfill. |

---

## 6. SQLITE SCHEMA PROPOSAL

The current schema is **comprehensive and largely correct**. The proposal is minimal additions, not a redesign.

### 6.1 What already exists and is correct

All 23 tables have been audited. Schema design is sound:
- Composite PKs on immutable tables (`frozen_contextual_states`, `prediction_epochs`).
- `INSERT OR IGNORE` semantics on immutable history.
- `INSERT OR REPLACE` only on `outcome_snapshots` (corrections expected) and `personal_ledger` (user edits expected).
- `raw_json` column on every table for forward-compat.
- `sport` column on every cross-sport table (sport-agnostic by design).
- Indexes on every column used in actual queries.

### 6.2 Proposed additions (additive only — no migration of existing rows)

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- prediction_id_aliases (Phase Persistence-1B — composite-key forward-only fix)
--
-- The Phase E1 composite-key normalization (normPlayer/normFam/canonicalBook)
-- is forward-only. Historical predictions persist under pre-fix IDs.
-- This table maps pre-fix → post-fix IDs so cohort analysis spanning the E1
-- boundary doesn't double-count diacritic/casing/alias variants.
--
-- Populated by a one-time backfill: for every prediction_snapshots.id whose
-- normalized form differs from raw, insert (raw_id, normalized_id).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_id_aliases (
  raw_id          TEXT    PRIMARY KEY,
  canonical_id    TEXT    NOT NULL,
  detected_at     TEXT    DEFAULT (datetime('now')),
  norm_diff_type  TEXT,           -- 'player' / 'family' / 'book' / 'composite'
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_pia_canonical ON prediction_id_aliases (canonical_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ledger_divergence_log (Phase Persistence-1C — operational watchdog)
--
-- Records observed JSON-vs-SQLite ledger row-count divergence at startup.
-- Empty by design; one row per divergence detection. Cleared when divergence
-- resolves. Surfaced via /api/ws/state diagnostic.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_divergence_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at     TEXT    DEFAULT (datetime('now')),
  json_bet_count  INTEGER,
  sqlite_bet_count INTEGER,
  divergence      INTEGER,        -- json - sqlite
  notes           TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- longitudinal_retention (Phase Persistence-1D — retention authority)
--
-- Single-row policy table. Documents the retention contract so cohort queries
-- can reference it. Cuts ambiguity about what is and isn't archived.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS longitudinal_retention (
  table_name              TEXT    PRIMARY KEY,
  retention_days          INTEGER NOT NULL,
  archive_target          TEXT,   -- 'jsonl_gzip' / 'delete_only' / null = retain_forever
  last_archived_at        TEXT,
  last_archived_through   TEXT,
  notes                   TEXT
);
-- Seed:
--   prediction_snapshots         365  jsonl_gzip
--   frozen_contextual_states     365  jsonl_gzip
--   prediction_epochs            inf  retain_forever
--   outcome_snapshots            inf  retain_forever   (calibration corpus)
--   slip_outcomes                inf  retain_forever
--   ecology_snapshots            365  jsonl_gzip
--   tracked_props                 90  delete_only      (raw daily — replaceable from JSON)
--   slip_catalog                  90  delete_only
--   hr_predictions               180  delete_only
--   nightly_runs                 inf  retain_forever
--   personal_ledger              inf  retain_forever   (operational truth)
```

### 6.3 What NOT to add

- **No second ledger table.** `personal_ledger` is canonical.
- **No second outcome table.** `outcome_snapshots` is the outcome authority; `slip_outcomes` is the slip-level layer on top.
- **No new schemas for state files.** `timing_intelligence_state.json`, `post_game_review_state_*.json`, `book_intelligence_state.json` should migrate to **existing tables** (`ecology_snapshots`, future `post_game_review` table, future `book_state` table) — but those are Phase B/C decisions, not schema additions today.

---

## 7. MIGRATION STRATEGY

Six discrete sub-phases. Each is independently revertable. Each is operator-gated.

### Phase Persistence-1A — Topology audit (THIS PHASE — ship today)
- ✅ This document
- ✅ Brain doc updates
- Output: operator-facing roadmap. **No code change.**

### Phase Persistence-1B — Activation (next session, low risk)
**Goal**: get the dormant infrastructure actually producing rows.

1. **Run `node backend/storage/importHistoricalData.js` once.** Should produce:
   - `tracked_props`: ~thousands of rows
   - `slip_catalog`: ~hundreds of rows
   - `hr_predictions`: ~thousands of rows (legacy + current)
   - `personal_ledger`: 2,000 rows (one-time backfill from JSON)
   - `nightly_runs`: ~24 rows
2. **Probe `personal_ledger` write-mirror** in a probe script: call `logBet` against a test bet; verify SQLite row written; verify mirror failure is silent if SQLite unavailable.
3. **Add startup integrity check** in `db.js:initializeAtBoot`: if `personal_ledger` JSON exists, compare `bets.length` vs SQLite row count; log `[LEDGER-DIVERGENCE-DETECTED]` once with the delta. Write a row to `ledger_divergence_log`.
4. **Document idempotency**: verify re-running `importHistoricalData` is a no-op (INSERT OR IGNORE confirmed in code).

**Risk**: Near-zero. Reads are unchanged. The mirror is already silent-failure. The integrity check is observation only.

**Verification**: re-run `node backend/storage/importHistoricalData.js`, second run should report `0 inserted, N already present` for every category.

### Phase Persistence-1C — Outcome wiring (next session, controlled risk)
**Goal**: close the longitudinal loop.

The schema designed `outcome_snapshots` and `slip_outcomes` to be the calibration corpus. Today they are empty. The grading layer writes JSON only.

1. **Add SQLite writers in `pipeline/grading/`**:
   - `fetchMlbGameResults.js` and `fetchNbaGameResults.js` should, after writing `graded_props_*.json`, also call a new `intelligence.recordOutcome({...})` that inserts `outcome_snapshots` rows (INSERT OR REPLACE per id).
   - `gradeTrackedSlips.js` should similarly write `slip_outcomes` rows.
2. **Linkage**: `outcome_snapshots.id` must match `prediction_snapshots.id` (already the schema design). No new ID derivation — reuse the deterministic composite.
3. **Backfill**: a one-time script that reads existing `graded_props_*.json` files and writes them into `outcome_snapshots`.
4. **Calibration**: `outcome_snapshots.delta_prob = model_prob - hit` populates the calibration metric. Verify via a small query: `AVG(delta_prob) GROUP BY tier` should approach 0 for well-calibrated tiers.

**Risk**: Medium. New writers in the grading hot path. Wrap in try/catch (silent-failure pattern), JSON remains canonical.

**Verification**: probe — grade a known historical date, assert outcome_snapshots row count matches graded_props_*.json entry count.

### Phase Persistence-1D — State-file migration (one phase per state file, low risk each)
**Goal**: move unbounded JSON state into SQLite with retention.

In priority order:

1. **`timing_intelligence_state.json` → new `timing_state` table.** 729 KB and growing. Date-indexed. Read via `loadTimingState`, write via `saveTimingState`. Cut over: dual-write for one nightly cycle, verify SQLite matches JSON shape, then cut reads.
2. **`post_game_review_state_<sport>.json` → new `post_game_review_state` table.** 375 KB MLB. Same pattern.
3. **`book_intelligence_state.json` → new `book_state` table.** Small but stylistically same.

Each file: 1 session of work. **Atomic .tmp+rename should be added to the JSON writers FIRST** as a precondition — extract `writeJsonSync` from `buildPersonalLedger.js` into `pipeline/shared/atomicWrite.js`, replace all `writeFileSync` on state files with this helper. This is independently valuable as a hygiene phase.

### Phase Persistence-1E — Retention activation (one session)
**Goal**: prevent unbounded growth on the now-populating longitudinal tables.

1. Seed `longitudinal_retention` table with the policy from §6.2.
2. Add `scripts/pruneLongitudinalState.js` — reads retention rows, archives or deletes accordingly.
3. Wire into `brain:checkpoint` as a weekly cadence (or operator-invoked via `npm run prune:longitudinal`).
4. Verify on a copy of `betting.db` before running on production.

### Phase Persistence-1F — Parallel-tracker consolidation (deferred)
**Goal**: retire `tracker/betTracker.js` + `/api/bets`.

The parallel tracker (`tracker/betStorage.json`) is a fully separate system. Before retiring:
1. Audit whether anything actually calls `/api/bets` or `/api/bets/metrics`.
2. If yes, deprecate-and-redirect to `/api/ws/ledger`.
3. If no, delete the routes + the tracker module.

This is independent of the main SQLite cutover and can happen in any session.

---

## 8. PARITY VALIDATION PLAN

For each cutover step in §7, the corresponding parity check:

| Cutover | Pre-cut assertion | Post-cut assertion |
|---|---|---|
| `importHistoricalData.js` first run | All counts at 0 | `tracked_props` count ≥ N1, `slip_catalog` ≥ N2, `personal_ledger` = 2000 |
| `importHistoricalData.js` second run | Counts unchanged from first run | Counts unchanged (idempotency) |
| Personal-ledger write-mirror probe | Test bet not in either store | After `logBet`: JSON `bets[0]` present; SQLite `personal_ledger` row present with same `id` |
| Personal-ledger startup integrity check | Both stores at last-known state | `[LEDGER-DIVERGENCE-DETECTED]` emits IFF JSON.bets.length ≠ SQLite COUNT(*) |
| Outcome-snapshot wiring | `outcome_snapshots` at 0 | After grading run: row count = number of graded rows; AVG(delta_prob) finite |
| Backfill of historical outcomes | `outcome_snapshots` at N (post-wiring) | After backfill: row count = sum of graded_props_*.json entries; no double-count if re-run |
| Timing-state migration | JSON at 729 KB | SQLite `timing_state` row count = N timing entries; JSON read returns identical shape |
| Retention activation on `prediction_snapshots` | Row count = X (e.g. 607 today, will grow) | After prune: rows with `created_at < now-365d` archived; gzip artifact present; count = X' < X |

**Probe scripts to add** (each ~100 lines, follows the existing `probe_*.js` pattern in repo root):
- `probe_persistence_idempotency.js` — runs import twice, asserts second run is no-op.
- `probe_ledger_mirror.js` — logs a test bet, asserts both stores updated, asserts mirror failure is silent.
- `probe_outcome_wiring.js` — runs a grading cycle on a fixture, asserts outcome_snapshots populated.
- `probe_retention_dryrun.js` — runs retention with `--dry-run`, asserts archive set is correct.

---

## 9. REPLAY SAFETY ANALYSIS

The replay system (`/refresh-snapshot?replay=disk`) reads `backend/snapshot.json` and re-runs the snapshot pipeline. Replay writes `[NBA-SNAPSHOT-FREEZE-REPLAY]` to `prediction_snapshots` / `prediction_epochs` / `frozen_contextual_states`.

**Replay-safety guarantees that must be preserved through Phase Persistence-1**:

1. **No replay-path reads from JSON tracking files.** Replay reads ONLY `snapshot.json` plus the SQLite tables. Verified by grep — no replay code path touches `mlb_tracked_bets_*` or `personal_ledger.json`.
2. **Replay writes use INSERT OR IGNORE.** Re-replaying the same snapshot is a no-op against `prediction_snapshots`/`prediction_epochs`/`frozen_contextual_states`. Preserved.
3. **Replay-test fixture in `probe_snapshot_freeze_v1.js` (Session BD) verifies this.** 29/29 checks. Must remain green through Phase B/C/D.

**Phase B effect on replay**: adding outcome writers in `pipeline/grading/` does **NOT** touch replay — grading is a separate pipeline. Replay does not trigger grading. Safe.

**Phase C effect on replay**: state-file migration does **NOT** touch replay — state files are read by `/api/ws/state` (workstation path), not by snapshot ingestion or freeze. Safe.

**Phase D effect on replay**: retention pruning **could** affect replay if it deleted rows for a snapshot updatedAt that is currently in `backend/snapshot.json`. Mitigation: retention only prunes `created_at < now - 365d`; `snapshot.json` is always current. Safe by design, but the retention script should assert this explicitly.

**Verdict**: replay is **safe through all Phase Persistence-1 sub-phases**.

---

## 10. GRADING SAFETY ANALYSIS

Current grading path:

```
runtime/tracking/mlb_tracked_bets_YYYY-MM-DD.json (input)
  ↓
backend/pipeline/grading/fetchMlbGameResults.js   ← fetches result data
backend/pipeline/grading/gradeTrackedBets.js      ← computes hit/miss
backend/pipeline/grading/gradeTrackedSlips.js     ← grades slips from results
backend/pipeline/grading/buildGradingSummary.js   ← aggregates
  ↓
runtime/tracking/graded_props_YYYY-MM-DD.json     ← grading output
runtime/tracking/grading_summary_<sport>_*.json   ← summary output
```

**Current SQLite participation**: ZERO. Grading is JSON-only.

**Phase Persistence-1C wires SQLite outcome writers** at the point where `graded_props_*.json` is written. Each row written to JSON is also UPSERTed into `outcome_snapshots` via `intelligence.recordOutcome`. The `id` matches `prediction_snapshots.id` (same composite key — Phase E1 normalization).

**Grading-safety guarantees that must be preserved**:

1. **JSON canonical**. The `graded_props_*.json` file remains the operator-readable artifact. SQLite is additive.
2. **Idempotent re-grading**. If grading is re-run for the same date, both JSON (overwritten) and SQLite (INSERT OR REPLACE) converge on the new result. No double-count.
3. **Per-leg attribution**. Each prediction maps to exactly one outcome row via shared id. The composite-key forward-only nature means historical predictions stay attached to outcomes even after E1 normalization changed canonical IDs.
4. **Settlement correction**. If a result needs correction (e.g. stat-correction by league), `outcome_snapshots` uses `INSERT OR REPLACE` so the correction propagates. `prediction_snapshots` is immutable — corrections only modify the outcome side.

**Hidden risk in current state**: `prediction_id` in `outcome_snapshots` references composite-key IDs that, if generated pre-E1, may have casing/diacritic variants. Phase Persistence-1B's `prediction_id_aliases` table addresses this. Without it, ~5% of pre-E1 outcomes may not join cleanly against post-E1 predictions.

**Verdict**: grading-safety is preserved through Phase 1C **IF** the alias table is populated before back-filling historical outcomes.

---

## 11. LONGITUDINAL INTEGRITY RISKS

| Risk | Impact | Mitigation in this plan |
|---|---|---|
| `prediction_snapshots` and `frozen_contextual_states` grow unbounded | Multi-million rows at MLB nightly cadence within 12 months | Phase Persistence-1E retention with `jsonl_gzip` archive |
| `outcome_snapshots` never gets populated → calibration loop stays empty forever | Repo's most sophisticated learning loop is dead architecture | Phase Persistence-1C wires outcome writers |
| `personal_ledger` SQLite at 0 rows despite mirror code → cold mirror produces false confidence | Operator believes dual-write is working when it isn't | Phase Persistence-1B startup integrity check |
| Dual-freeze writers compute `epoch_id` independently | First time the two derivations drift, INSERT OR IGNORE silently drops the richer (workstation) row | Unify epoch_id derivation in `pipeline/memory/deriveEpochId.js` shared helper (Phase Longitudinal-Integrity-1 in May 14 audit) |
| Composite-key forward-only migration creates "two histories" | Cohort analysis across E1 boundary double-counts diacritic/alias variants | Phase Persistence-1B `prediction_id_aliases` table |
| Atomic-write inconsistency across writers | Crash mid-write → orphan `.tmp` file (one already observed) → silent state corruption | Phase Persistence-1D atomic-write hygiene phase (extract `writeJsonSync` to shared) |
| `mlb_picks_*.json` unbounded directory accumulation | 1.5 MB/day, 17 files already | Phase Persistence-1E retention also covers JSON directories (90-day archive pass) |
| Tracker fragmentation (`/api/bets` vs `/api/ws/ledger`) | Bet logs split across two stores, no reconciliation | Phase Persistence-1F deferred consolidation |
| Schema chain has 4 entry points (`schema.js`, `screenshotSchema.js`, `reviewSchema.js`, `intelligenceSchema.js`) | Future schema addition could be silently missed | Already mitigated — `applySchema` chains all four. Document this explicitly in PIPELINE_AUTHORITY_MAP.md so future contributors don't break the chain. |

---

## 12. PHASED CUTOVER PLAN

Sequenced. Each phase is independently revertable. Each is operator-gated.

| Phase | Title | Risk | Sessions | Reversibility |
|---|---|---|---|---|
| **1A** | Topology audit + brain docs (THIS PHASE) | None | 1 (today) | Trivial — docs only |
| **1B** | Activation: run import CLI + startup integrity check + `prediction_id_aliases` | Low | 1 | Revert: drop new table, remove integrity check, revert import |
| **1C** | Outcome wiring: SQLite writers in grading + backfill | Medium | 1 | Revert: remove `intelligence.recordOutcome` calls; JSON remains canonical |
| **1D** | State-file migration (timing → SQLite; post-game review → SQLite; atomic-write hygiene) | Medium per file | 1 per file (3-4 sessions) | Revert per file: keep JSON read fallback during cutover |
| **1E** | Retention activation: longitudinal_retention table + prune script | Medium | 1 | Revert: drop table, delete script, no rows deleted yet |
| **1F** | Parallel-tracker consolidation: retire `tracker/betTracker.js` + `/api/bets` | Low (after deprecation audit) | 1 | Revert: routes can be re-added; JSON file can stay |

**Sequencing rules**:
- 1A → 1B mandatory order (audit before activation).
- 1B → 1C mandatory order (`prediction_id_aliases` must exist before backfilling historical outcomes).
- 1D order between files is flexible; recommend `timing_intelligence_state` first (largest, most-touched).
- 1E only after 1B + 1C (otherwise retention is meaningless — nothing to retain).
- 1F is independent of the SQLite path; can happen anytime.

**Estimated total work**: 6-8 sessions to complete 1B through 1F. Phase 1B alone delivers ~70% of the operational value (turning on the dormant infrastructure).

---

## 13. WHAT THIS PHASE DOES NOT TOUCH

To preserve clarity about scope:

- ❌ **No grading-logic changes.** Grading rules unchanged. We only add a SQLite writer alongside the existing JSON writer (Phase 1C).
- ❌ **No freeze-pipeline changes.** Snapshot freeze + workstation freeze stay as Session BD/AZ shipped.
- ❌ **No snapshot-ingestion changes.** Odds API path is untouched.
- ❌ **No replay-path changes.** Replay continues to read snapshot.json + SQLite.
- ❌ **No `/api/ws/*` contract changes.** Workstation routes serve the same shapes.
- ❌ **No NBA-specific logic.** NBA ecology audit findings (May 14 audit) remain Phase-2.
- ❌ **No `server.js` extractions.** Monolith stays as it is.

---

## 14. RECOMMENDED NEXT SESSION SCOPE

**Phase Persistence-1B — Activation** is the highest-leverage next move.

Operator decision required:

1. **Approve running `node backend/storage/importHistoricalData.js`?** (One-time idempotent backfill. Expected runtime <30 seconds on current data volume.)
2. **Approve adding `prediction_id_aliases` table + boot-time backfill?** (DDL + one CLI script, ~100 lines.)
3. **Approve startup integrity check + `[LEDGER-DIVERGENCE-DETECTED]` observability?** (~30 lines in `db.js:initializeAtBoot`.)
4. **Approve probe scripts** `probe_persistence_idempotency.js`, `probe_ledger_mirror.js`?

If all four are approved, Phase 1B is one session, ~200 lines net additive, zero deletions, fully revertable.

---

_Audit completed: 2026-05-14_
_Author: Claude (Cowork mode, opus-class audit, fed by direct source inspection of buildPersonalLedger.js, queries.js, importHistoricalData.js, schema.js, intelligenceSchema.js, tracker/betTracker.js, plus live SQLite row counts and filesystem inventory)_
_Sequenced under: ARCHITECTURE_LAWS.md Law 12 (memory docs are part of the patch), Law 4 (preserve replay/freeze/grading), Law 16 (no silent fallbacks)_
_Stale-source review: corrected three more findings from `FULL_SYSTEMS_AUDIT_2026-05-14.md` per the "re-verify before patching" rule encoded in that doc's postscript_
