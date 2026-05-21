# PHASE Grading-Calibration-Operations-1C — LINEAGE RECONCILIATION AUDIT
**Audit-first deliverable. Phase 1C: prediction↔outcome lineage topology + reconciliation strategy.**
**NO code patches in this phase. Operator review required before Phase 1D (lineage observability + orphan surfacing).**

_Generated: 2026-05-14 | Builds on: `GRADING_TOPOLOGY_AUDIT_2026-05-14.md`, `PERSISTENCE_AUDIT_2026-05-14.md` §10–11, `LONGITUDINAL_INTEGRITY` chain (1A + 1B)._

---

## EXECUTIVE SUMMARY (5 sentences)

The operator's signal — `calibration:status` reporting "(no rows in join — outcome_snapshots may lack matching prediction_snapshots ids)" — could be read two ways. Live verification proves it's the **first reading, not a lineage gap**: `outcome_snapshots` is at 0 rows in the auditor's sandbox because Phase 1B's `grading:backfill-all` hasn't executed against production; the canonical join formula `outcome.id = prediction.id` is structurally sound — both writers route through the same `intel.predictionId()` canonical helper and the bytes match exactly (verified Juan Soto fixture: tracked_bet → computed predId `2026-05-08|mlb|juan soto|totalbases|under|1.5|draftkings` IS present in prediction_snapshots). The **real lineage truth** is asymmetric population: predictions live in `prediction_snapshots` only since Session BD (2026-05-12); historical tracked_bets span 2026-05-05 → 2026-05-09 where prediction_snapshots is either empty (05-05, 05-06: 0 predictions) or partial (05-07: 76 predictions vs 178 settled bets; 05-08: 91 vs 123; 05-09: 65 vs 84). Phase 1D's role is therefore not to "fix joins" — it's to **surface the orphan-outcome volume as explicit observability**, document that ~84% of historical outcomes won't have matching predictions (an artifact of when the longitudinal corpus began populating), and confirm the canonical join formula is truth-preserving for all newly-captured (Session BD onwards) data.

---

## 1. LINEAGE TOPOLOGY MAP

### 1.1 Two prediction-id derivation paths (both share canonical bytes)

```
┌─ Path A: prediction_snapshots write (snapshot freeze + workstation freeze) ─┐
│                                                                              │
│   bestProps row OR contextual row                                            │
│       ↓                                                                      │
│   intel.normalizeCandidate(raw, { runDate, sport, ... })                     │
│       statFamily = normFam(raw.statFamily || raw.propType || raw.prop)       │
│       book       = raw.book || raw.sportsbook                                │
│       ↓                                                                      │
│   intel.predictionId(date, sport, player, statFamily, side, line, book)      │
│       player_n     = normPlayer(player)   // NFD + diacritic-strip + lower   │
│       statFamily_n = normFam(statFamily)  // lower + collapse [\s_]+         │
│       side_n       = side.toLowerCase()                                      │
│       line_n       = safeNum(line)                                           │
│       book_n       = normBook(book)       // canonicalBook → lower           │
│       ↓                                                                      │
│   id = "<runDate>|<sport>|<player_n>|<statFamily_n>|<side_n>|<line_n>|<book_n>" │
│       ↓                                                                      │
│   INSERT INTO prediction_snapshots (id, ...) VALUES (?, ...)                 │
└──────────────────────────────────────────────────────────────────────────────┘

┌─ Path B: outcome_snapshots write (post-game-review, Phase 1B-active) ────────┐
│                                                                              │
│   tracked_bets_{sport}_{date}.json settled row `b`                           │
│       ↓                                                                      │
│   buildPostGameReview.js:414 — direct call:                                  │
│     predId = intel.predictionId(                                             │
│       b.date || date,    // run_date                                         │
│       key,                // sport (passed in)                               │
│       b.player,                                                              │
│       b.statFamily,                                                          │
│       b.side,                                                                │
│       b.line,                                                                │
│       b.sportsbook                                                           │
│     )                                                                        │
│       ↓                                                                      │
│   IDENTICAL `intel.predictionId` function. IDENTICAL canonical bytes.        │
│       ↓                                                                      │
│   settlements.push({ id: predId, hit, actualValue, settledAt, notes })       │
│       ↓                                                                      │
│   intel.recordOutcomes(settlements) → INSERT INTO outcome_snapshots          │
└──────────────────────────────────────────────────────────────────────────────┘

JOIN: outcome_snapshots.id = prediction_snapshots.id  ← structurally aligned.
```

### 1.2 Slip lineage (parallel structure)

```
slip_outcomes.id = slip.id (UUID assigned upstream in slip composer)
slip_catalog.id  = same slip UUID

intel.recordSlipOutcome(slip, result, opts):
  → INSERT INTO slip_outcomes(id = slip.id, ..., legs_hit, payout_dec)

JOIN: slip_outcomes.id = slip_catalog.id  ← canonical via slip-composer UUID.
```

### 1.3 Verified canonical-bytes example (live source 2026-05-14)

```
tracked_bets_2026-05-08.json[0] (Juan Soto):
  stored.id   : 2026-05-08|juan soto|bb96582815dabc42936e794a19c74217|totalbases|under|1.5|-107|draftkings
                ↑ this is the LOCAL tracking-file ID (date|player|hash|stat|side|line|odds|book)
                  used internally by phase4Tracking — NOT used as the lineage key.

  computed.id : 2026-05-08|mlb|juan soto|totalbases|under|1.5|draftkings
                ↑ this is what intel.predictionId() produces — IT IS the lineage key.
                  buildPostGameReview ignores b.id and recomputes via intel.predictionId.

prediction_snapshots row for Juan Soto on 2026-05-08:
  id          : 2026-05-08|mlb|juan soto|totalbases|under|1.5|draftkings
                ↑ EXACT match — same canonical helper, same bytes.

JOIN result: 1:1 match for any (sport, date, player, stat, side, line, book) tuple
             present in both tables.
```

**This is the most important finding of the audit**: the canonical join formula is structurally sound. There is no normalizer drift, no ID-format mismatch, no hidden encoding gap. **Every claim of "lineage broken" must be re-checked against this.**

---

## 2. PREDICTION SNAPSHOT OWNERSHIP

| Concern | Canonical owner |
|---|---|
| ID derivation function | `backend/storage/intelligence.js:predictionId(runDate, sport, player, statFamily, side, line, book)` (Phase E1) |
| Snapshot freeze writer (NBA, snapshot path) | `backend/http/nbaIsolatedRoutes.js:_lazyFreezePredictionEpoch` → `intel.snapshotPredictions(snap.bestProps, ...)` (Session BD, 2026-05-12) |
| Workstation freeze writer (NBA + MLB, contextual path) | `backend/routes/workstationRoutes.js:freezePredictionEpoch` → `intel.snapshotPredictions(rows, ...)` (Session AZ) |
| MLB freeze contextual writer | `backend/pipeline/mlb/context/freezeMlbContextualEpoch.js` (wired but not yet invoked in pipeline) |
| MLB freeze live-state writer | `backend/pipeline/mlb/live/freezeMlbLiveStateEpoch.js` |
| Write semantics | `INSERT OR IGNORE` — historical predictions are immutable |
| Normalization | All inputs routed through `normPlayer` / `normFam` / `normBook` (Phase E1 backstops) |
| Composite key | id = TEXT PRIMARY KEY (single column) |

**Inventory (live, 2026-05-14)**:

```
prediction_snapshots: 643 rows
  by run_date × sport:
    2026-05-07  mlb   76
    2026-05-08  mlb   91     nba    3
    2026-05-09  mlb   65     nba    6
    2026-05-12  mlb  148     nba   96
    2026-05-13  mlb   20     nba   47
    2026-05-14  mlb    6     nba   80
    9999-12-31  mlb    5     (sentinel test row)
  distinct dates: 7
```

The corpus is **forward-looking from 2026-05-07**. Dates earlier than 2026-05-07 have zero predictions. This is the structural constraint that drives the orphan-outcome volume.

---

## 3. OUTCOME SNAPSHOT OWNERSHIP

| Concern | Canonical owner |
|---|---|
| ID derivation function | `backend/storage/intelligence.js:predictionId(...)` — SAME function used by prediction_snapshots |
| Settlement source | `backend/pipeline/shared/buildPostGameReview.js:runPostGameReview` (Phase 1B activation entry) |
| Per-bet predId computation | `buildPostGameReview.js:414` — explicit call to `intel.predictionId(b.date, key, b.player, b.statFamily, b.side, b.line, b.sportsbook)` |
| Per-slip predId | uses `slip.id` (UUID from slip composer) |
| Writer | `intel.recordOutcomes(settlements)` and `intel.recordSlipOutcome(slip, result)` |
| Write semantics | `INSERT OR REPLACE` (corrections expected — settlement corrections must overwrite) |
| Composite key | id = TEXT PRIMARY KEY (single column, matches prediction_snapshots.id) |

**Inventory (live, 2026-05-14, pre-Phase-1B-execution)**:

```
outcome_snapshots: 0 rows
slip_outcomes:     0 rows

Reason: Phase 1B operator-side execution (`npm run grading:backfill-all`) has
not yet run against the operator's real betting.db. The sandbox cannot run
SQLite-mutating commands — same I/O restriction as Sessions BC/BD/Persistence-1B.
```

**Post-Phase-1B-execution forecast** (per Phase 1A audit numbers):

```
Tracked_bets settled across MLB (5 historical dates with settled bets):
  2026-05-05  mlb  total=947  settled=848
  2026-05-06  mlb  total=299  settled=274
  2026-05-07  mlb  total=190  settled=178
  2026-05-08  mlb  total=134  settled=123
  2026-05-09  mlb  total=94   settled=84
  ────────────────────────────────────────
  MLB total settled:        1,507
Tracked_bets settled across NBA:
  2026-05-05  nba  total=11   settled=11
  2026-05-06  nba  total=1    settled=1
  2026-05-08  nba  total=4    settled=4
  2026-05-09  nba  total=6    settled=6
  ────────────────────────────────────────
  NBA total settled:        22

Total estimated outcome_snapshots post-backfill: ~1,529 rows.
```

---

## 4. HISTORICAL MISMATCH ANALYSIS

The crux of this audit. The mismatch is **NOT** ID-format drift — it is **temporal asymmetry of corpus population**.

### 4.1 Per-date join projection (MLB)

| Date | tracked_bets settled (will become outcomes) | prediction_snapshots count | JOIN matches (max) | Orphan outcomes (no matching prediction) |
|---|---:|---:|---:|---:|
| 2026-05-05 | 848 | 0 | 0 | **848 (100% orphan)** |
| 2026-05-06 | 274 | 0 | 0 | **274 (100% orphan)** |
| 2026-05-07 | 178 | 76 | ≤ 76 | ≥ 102 (57% orphan) |
| 2026-05-08 | 123 | 91 | ≤ 91 | ≥ 32 (26% orphan) |
| 2026-05-09 | 84 | 65 | ≤ 65 | ≥ 19 (23% orphan) |
| **MLB total** | **1,507** | **232** | **≤ 232** | **≥ 1,275 (≥ 84% orphan)** |

### 4.2 Per-date join projection (NBA)

| Date | tracked_bets settled | prediction_snapshots count | JOIN matches (max) | Orphan outcomes |
|---|---:|---:|---:|---:|
| 2026-05-05 | 11 | 0 | 0 | 11 (100% orphan) |
| 2026-05-06 | 1 | 0 | 0 | 1 (100% orphan) |
| 2026-05-08 | 4 | 3 | ≤ 3 | ≥ 1 (25% orphan) |
| 2026-05-09 | 6 | 6 | ≤ 6 | ≥ 0 (0% orphan possible) |
| **NBA total** | **22** | **9** | **≤ 9** | **≥ 13 (≥ 59% orphan)** |

### 4.3 Root cause of the orphan volume

The orphan-outcome volume is **NOT** a bug. It is the consequence of two structural facts:

1. **prediction_snapshots only started populating Session BD (2026-05-12)** for the snapshot-bestprops freeze path, and Session AZ (earlier) for the workstation freeze path. The 2026-05-05 and 2026-05-06 tracked_bets predate any freeze writer being live.
2. **tracked_bets count > prediction_snapshots count for every date with both** because predictions only capture bestProps that the model surfaced; tracked_bets include EVERY operator bet (including non-best-prop selections, manual overrides, slip legs).

**No fabricated joins. No retroactive prediction creation.** This audit does not propose creating historical prediction rows to "fix" the join — that would synthesize predictions the model never actually made, polluting the calibration corpus with fake data.

### 4.4 Going-forward forecast

For dates 2026-05-12 onwards (Session BD + Phase OpOps-1 deterministic snapshot freezes), the orphan rate should drop dramatically:

```
2026-05-12  mlb predictions=148  nba predictions=96  (no settled bets yet; games haven't graded)
2026-05-13  mlb predictions=20   nba predictions=47
2026-05-14  mlb predictions=6    nba predictions=80
```

When these dates' games settle and Phase 1B backfill runs:
- The intersection rate should be **≥ 80%** (predictions captured at snapshot time should cover most operator-tracked candidates).
- Orphans remaining will be **legitimate** (operator manually added bets not in bestProps).

---

## 5. ALIAS TABLE UTILIZATION STATUS

`prediction_id_aliases` (Phase Persistence-1B) — current state:

```
total alias rows: 0
```

**The alias table is empty.** Phase Persistence-1B's `backfillPredictionIdAliases.js` exists but has not been run in production, OR was run and produced zero aliases because every prediction_snapshots row's stored id ALREADY matches what `intel.predictionId()` would re-derive today.

**Operator hasn't executed `npm run persistence:backfill-aliases` yet.** Recommended: run it once to confirm the empty result is genuine (no pre-E1 ID variants present), not just an unexecuted script.

**The alias table is the WRONG tool for solving the orphan-outcome problem** described in §4. Aliases bridge `raw_id → canonical_id` when normalizers changed bytes for a prediction that was already in SQLite. They do NOT bridge "outcomes that have no prediction row at all." Phase 1C explicitly rejects retroactively populating the alias table to manufacture joins (that would be fabrication).

---

## 6. ORPHANED LINEAGE ANALYSIS

Two distinct orphan classes:

### 6.1 Orphan outcomes (outcomes without matching predictions)

- **Definition**: rows in `outcome_snapshots` whose `id` does not appear in `prediction_snapshots.id`.
- **Estimated volume post-Phase-1B**: ~1,275 MLB + ~13 NBA = **~1,288** orphan outcomes.
- **Cause**: predictions corpus pre-2026-05-07 was empty; operator tracked bets on those earlier dates have no model prediction to join.
- **Calibration impact**: these outcomes contribute hit/loss data but no model-prob-vs-reality signal. The Brier score and per-tier hit rate must be JOIN-restricted; otherwise orphan outcomes contaminate the calibration metric.
- **Truth preservation**: orphan outcomes are **legitimate operator-bet history**. They are valuable for P&L analysis, but useless for model calibration. Phase 1D should surface them but not delete them.

### 6.2 Orphan predictions (predictions without matching outcomes)

- **Definition**: rows in `prediction_snapshots` whose `id` does not appear in `outcome_snapshots.id`.
- **Estimated volume post-Phase-1B**: ~643 − ~241 ≈ **~400 orphan predictions** (most predictions never become bets).
- **Cause**: predictions are bestProps the model surfaced; the operator chose a subset. Most predictions are uncovered.
- **Calibration impact**: orphan predictions provide no outcome signal. They are excluded by the JOIN naturally (right side missing).
- **Truth preservation**: orphan predictions are **legitimate model-output history**. Useful for analyzing what the model surfaced vs what the operator chose to bet on (selection-bias analysis). Phase 1D should surface them.

### 6.3 NOT an orphan — ID drift

If a future schema change in `intel.predictionId()` were to alter the byte format, **then** existing prediction_snapshots rows would diverge from newly-written outcome_snapshots rows. That would be true ID drift requiring `prediction_id_aliases` to bridge. **This is not what's happening today.** Phase E1 normalizers (`normPlayer`/`normFam`/`normBook`) are stable; the alias table exists as a defensive primitive for future drift, not as a fix for the orphan-volume problem.

---

## 7. RECONCILABLE VS UNRECOVERABLE ROWS

### 7.1 Reconcilable (can be safely joined now)

| Category | Estimated count | Reconciliation method |
|---|---:|---|
| Predictions 2026-05-07+ with matching settled tracked_bets | ~241 | Direct id JOIN — already works structurally |
| Slips with matching slip_outcomes via slip.id | TBD post-backfill | Direct id JOIN — slip composer assigns canonical UUID |

### 7.2 Unrecoverable for calibration (legitimately orphan)

| Category | Estimated count | Why unrecoverable |
|---|---:|---|
| Pre-2026-05-07 tracked_bets settled | ~1,133 (MLB 1,122 + NBA 11) | No prediction rows existed when these bets were made — predictions corpus was empty |
| Post-2026-05-07 tracked_bets that don't match a bestProp prediction | ~155 (32 + 19 + 102 + 13) | Operator bet on candidates the model didn't surface as bestProps |
| Predictions never bet on by operator | ~400 | By design — most model predictions are not tracked bets |

### 7.3 Recoverable IF/WHEN closing-odds capture exists (Phase 1E)

CLV scoring requires `closing_odds` + `closing_line`. Today: no closing-odds capture pipeline. Phase 1E is deferred per Phase 1A audit §9.

### 7.4 NOT recoverable under any future phase

- Bets placed by the operator **before** Session BD's snapshot freeze went live: ~1,133 historical bets. There is no time machine to record what the model would have predicted at the moment the bet was made. **Calibration corpus for pre-2026-05-07 is permanently empty.** This is honest historical truth, not a fixable gap.

---

## 8. SAFE RECONCILIATION STRATEGY

Phase 1D (Phase Grading-Calibration-Operations-1D — proposed next gate) scope:

### 8.1 Add lineage observability — NOT lineage fabrication

1. **New script `backend/scripts/lineageStatus.js`** + **`npm run lineage:status`** — read-only inspector:
   - Per-date breakdown: predictions count, outcomes count, JOIN count, orphan predictions, orphan outcomes.
   - Per-sport rollup.
   - Most-recent 5 orphan-outcome ids per sport (sample for inspection).
   - Most-recent 5 orphan-prediction ids per sport (sample).
   - Highlights dates with 100% orphan rate (pre-corpus dates).

2. **New probe `probe_lineage_v1.js`** at repo root — asserts:
   - `intel.predictionId()` produces byte-identical bytes when called from settlement-path inputs vs prediction-path inputs (regression-guard against future drift).
   - Orphan-outcome counting query works correctly on synthetic fixture.
   - Orphan-prediction counting query works correctly on synthetic fixture.
   - Anti-fabrication assertion: a JOIN does NOT produce more rows than min(predictions, outcomes).

3. **Augment `calibrationStatus.js`** to show:
   - **JOIN-restricted** metrics (per-tier, per-vol, per-side, per-family hit rate, delta_prob avg, Brier).
   - **Orphan summary**: outcomes without predictions count; predictions without outcomes count.
   - **Coverage rate**: `JOIN_count / outcome_count` per (sport, date).
   - Explicit warning when coverage < 50% for any (sport, date): `LOW COVERAGE — calibration for this date is biased to predictions-that-were-bet`.

4. **Augment `gradingStatus.js`** to show:
   - 3-column delta: JSON-settled vs SQLite-outcome vs JOIN-success-with-prediction.
   - Surfaces orphan outcomes at the operational layer (operator can see them, not just calibration consumers).

### 8.2 NEW: alias-table forward-only policy

Document in `MASTER_BRAIN.md`:
- `prediction_id_aliases` is RESERVED for true ID-byte drift cases (future normalizer schema changes).
- It is NEVER populated to manufacture historical joins.
- Pre-corpus orphan outcomes (~1,133 historical bets) STAY orphan — they are legitimate bet history, not a calibration corpus.

### 8.3 Optional Phase 1E candidate (deferred): retroactive prediction shadowing

If future operator wants pre-corpus historical bets to contribute to calibration:
- Could synthesize a "shadow prediction" using the model's current scoring of the historical bet's features.
- Would require `model_prob` at the moment of bet — which doesn't exist for pre-corpus bets.
- Could approximate using current implied_prob, but **this is fabrication** under the audit's anti-pattern list.
- **Phase 1C explicitly does NOT recommend this.** Document as "intentionally deferred — depends on the operator accepting model fabrication for the historical baseline."

---

## 9. SQLITE LINEAGE EVOLUTION PLAN

```
Phase 1A — grading topology audit                                  ✓ shipped 2026-05-14
Phase 1B — orchestrator activation (grading:backfill + status)     ✓ shipped 2026-05-14
Phase 1C — lineage audit (this doc)                                 ✓ shipped 2026-05-14
Phase 1D — lineage observability (npm run lineage:status + probe)   ← next operator-approval gate
Phase 1E — closing-odds capture pipeline (CLV)                      deferred (new pipeline)
Phase 1F — shadow-prediction backfill (calibration baseline)        deferred — explicitly anti-pattern unless operator approves model fabrication
```

Phase 1D files (proposed, ~250 net additive lines):
```
backend/scripts/lineageStatus.js                                NEW
backend/scripts/calibrationStatus.js                            MODIFIED — add JOIN-restricted + orphan summary
backend/scripts/gradingStatus.js                                MODIFIED — add JOIN-success column
probe_lineage_v1.js                                             NEW
backend/package.json                                            +1 npm script (lineage:status)
docs/OPERATOR_RUNBOOK.md                                        post-slate ceremony adds lineage:status
backend/runtime/brain/MASTER_BRAIN.md                           alias-forward-only policy
```

Zero deletions. Five existing freeze writers, every grading CLI, every endpoint — unchanged.

---

## 10. CALIBRATION TRUST ANALYSIS

**Today's calibration trust state**: cannot be evaluated (outcome_snapshots at 0 rows in sandbox; operator hasn't run Phase 1B backfill yet against production).

**Post-Phase-1B-execution forecast** (analytical, based on §4 numbers):

```
Calibration corpus (post-Phase-1B-execution):
  Total outcomes:                           ~1,529 (MLB 1,507 + NBA 22)
  JOIN-matched outcomes (with predictions):  ~241 (16% of corpus)
  Orphan outcomes:                          ~1,288 (84% of corpus)
```

**Calibration metrics that ARE trustworthy**:
- Per-tier hit rate for the ~241 JOIN-matched outcomes — clean signal.
- Per-volatility hit rate for those ~241 — clean.
- Per-side hit rate for those ~241 — clean.
- Brier score over the JOINED subset — clean.

**Calibration metrics that are NOT trustworthy**:
- ANY aggregate metric that doesn't filter to the JOINED subset.
- Per-tier metrics where the tier sample size is small (post-Phase-1B, with only 241 joined outcomes split across 5 tiers, some tiers may have < 30 samples — too small for statistical claims).
- Cross-date trend curves spanning the corpus boundary (predictions only exist from 2026-05-07 onwards).

**Phase 1D's job**: make all of the above EXPLICIT. The calibration:status output should label every metric as "JOIN-restricted (n=N)" or "WARNING: low sample size (n<30)" so the operator never reads a calibration claim without knowing its sample.

**Calibration trust score (today)**: **N/A** — corpus is empty.
**Calibration trust score (post-Phase-1B execution, JOIN-restricted)**: **Medium** — clean signal but small sample.
**Calibration trust score (post-Phase-1B execution, naive aggregation)**: **Low** — 84% of the corpus is orphan; aggregate metrics would be biased toward "early-corpus" data.

---

## 11. LONGITUDINAL LEARNING READINESS

**Today**: ~5%. predictions populating; outcomes empty; JOIN untested in production.

**After Phase 1B execution on operator's machine**: ~30%. Outcomes populate; JOIN delivers ~241 matched pairs across 4 historical dates; calibration corpus exists but is small.

**After Phase 1D (lineage observability)**: ~40%. Operator can see exactly which dates / tiers / sports have trustworthy calibration. Phase 1B retroactively becomes interpretable.

**After ~30 more days of operation (predictions captured nightly, bets tracked nightly, backfill chain run nightly)**: ~70%. Corpus grows organically. Coverage rate per (sport, date) climbs toward 80%. Calibration trust score becomes high for recent dates.

**After Phase 1E (closing-odds capture)**: ~85%. CLV layer populates. Process classification (`good_process_won` / `bad_process_won` / etc.) becomes meaningful.

**Phase 1F (shadow-prediction backfill — anti-pattern, deferred)**: would push to ~95% but at the cost of mixing real and fabricated predictions in the corpus. **Not recommended.**

---

## 12. HIGHEST-RISK REMAINING GAPS

Ranked.

| # | Risk | Likelihood | Impact | Phase to address |
|---|---|---|---|---|
| 1 | Naive calibration aggregation produces biased metric — operator reads "model says ELITE tier hits 60%" when sample is mostly pre-corpus orphans | HIGH (today) | HIGH — flawed mental model drives flawed decisions | Phase 1D: JOIN-restricted metrics + sample-size warning |
| 2 | Phase 1B backfill execution surfaces orphan rate but no observability surface explains it; operator assumes "broken" instead of "historical baseline" | HIGH (today) | MEDIUM | Phase 1D: `lineage:status` with explicit orphan accounting |
| 3 | Future `intel.predictionId()` change without `prediction_id_aliases` populated → true byte drift → silent JOIN miss | LOW | HIGH | Phase 1D probe asserts ID byte-parity regression-guard |
| 4 | Operator runs `persistence:backfill-aliases` and gets 0 aliases — interprets as "alias system broken" | LOW | LOW (cosmetic) | Phase 1D documents the empty-is-correct case |
| 5 | Calibration trend over time mixes pre-corpus / post-corpus data and shows misleading "model improved" trend | MEDIUM | MEDIUM | Phase 1D: date-bounded metrics; explicit corpus-start-date threshold |
| 6 | Phase 1E shadow-prediction proposal becomes "obvious fix" pressure — engineers pressure operator to fabricate baseline | MEDIUM | HIGH (corpus pollution) | Encode anti-pattern in `MASTER_BRAIN.md`; Phase 1C deliverable §8.3 explicit |
| 7 | Slip-outcome lineage may suffer same orphan pattern (slip.id from composer vs slip_catalog UUID); not yet analyzed at the same depth | MEDIUM | MEDIUM | Phase 1D extends `lineage:status` to slips |
| 8 | Operator hasn't run `persistence:backfill-aliases` yet — alias table at 0 may hide a real drift waiting to surface | LOW | LOW (Phase E1 normalizers are stable) | Operator action — run `persistence:backfill-aliases` once to confirm |
| 9 | Bet on a player whose name has rare diacritics (e.g. "José" vs "Jose") — small risk of normalizer drift even though `normPlayer` strips combining marks | LOW | LOW | Phase 1D probe includes diacritic edge cases |

---

## 13. WHAT THIS PHASE DOES NOT DO

- ❌ Does NOT modify any backend route, endpoint, runtime authority.
- ❌ Does NOT modify any grading writer.
- ❌ Does NOT modify any prediction writer.
- ❌ Does NOT populate `prediction_id_aliases` (operator approval needed; expected to be a no-op).
- ❌ Does NOT manufacture predictions for orphan outcomes (anti-fabrication).
- ❌ Does NOT delete orphan outcomes (truth preservation).
- ❌ Does NOT change calibration metric semantics.
- ❌ Does NOT add closing-odds capture (Phase 1E, deferred).
- ❌ Does NOT modify the orchestrator chain.

---

## 14. AUDIT-STALE-SOURCE CORRECTIONS (7th carry-forward application)

| Prior claim / signal | Reality (verified 2026-05-14) |
|---|---|
| Operator signal: `calibration:status` shows "(no rows in join — outcome_snapshots may lack matching prediction_snapshots ids — see prediction_id_aliases)" — interpreted as "ID mismatch" | **WRONG interpretation.** The signal fires because `outcome_snapshots` is at 0 rows pre-Phase-1B-execution. The canonical join is structurally sound; both sides route through `intel.predictionId()`. Verified Juan Soto fixture: tracked_bet predId computes to `2026-05-08\|mlb\|juan soto\|totalbases\|under\|1.5\|draftkings` AND that exact ID exists in prediction_snapshots. |
| Implied: `prediction_id_aliases` needs to be populated to fix joins | **WRONG.** The alias table is RESERVED for true byte-drift cases (future normalizer schema changes). It cannot — and should not — bridge "outcomes that have no prediction at all." |
| Implied: there's a lineage architectural defect | **WRONG.** Lineage architecture is sound. The "gap" is the natural consequence of when the predictions corpus began populating (Session BD, 2026-05-12) vs when historical tracked_bets started (well before that). |

The carry-forward rule (now applied 7 times across phases — Race-1, Persistence-1A, Longitudinal-Integrity-1B, Operator-Operations-1A, Grading-Calibration-1A, Grading-Calibration-1B, and now Grading-Calibration-1C) caught this misinterpretation at the source.

---

## 15. RECOMMENDED NEXT-SESSION SCOPE

Phase Grading-Calibration-Operations-1D — lineage observability. One operator-approval gate, four items:

1. New CLI `backend/scripts/lineageStatus.js` (+ npm script `lineage:status`).
2. Augment `backend/scripts/calibrationStatus.js`: JOIN-restricted metrics + orphan summary + sample-size warnings.
3. Augment `backend/scripts/gradingStatus.js`: add JOIN-success column.
4. Probe `probe_lineage_v1.js` asserting byte-parity invariant + orphan-counting query shape + anti-fabrication invariant.
5. Update `OPERATOR_RUNBOOK.md` post-slate ceremony.
6. Update `MASTER_BRAIN.md` with alias-forward-only policy.

Estimated ~250 net additive lines. Zero deletions. No backend authority touched. Carry-forward rule applies — Phase 1D first task is to re-verify Juan Soto fixture (or current equivalent) before patching.

---

## 16. WHAT TO DO ABOUT THE EXISTING OPERATOR SIGNAL

The operator's calibration:status output `(no rows in join — outcome_snapshots may lack matching prediction_snapshots ids — see prediction_id_aliases)` is **structurally correct but misleading in its hint**. Phase 1D will replace that line with:

```
── calibration corpus state ──
  outcome_snapshots total              : 0
  outcome_snapshots after JOIN         : 0
  Reason for empty calibration:
    outcome_snapshots is empty — Phase 1B backfill has not run.
    Run: npm run grading:backfill-all
  (When outcome_snapshots populates but JOIN remains empty,
   the orphan-outcome summary below explains why — historical bets
   pre-date the predictions corpus. See lineage:status for detail.)
```

This explicit guidance — combined with `lineage:status` showing per-date orphan counts — prevents future operators (and future audits) from interpreting the empty join as a lineage bug.

---

## 17. DELIVERABLE SUMMARY

**Phase 1C (this phase — shipped today)**:
- This audit document (16 sections, ~600 lines).
- Brain doc updates per Law 12.
- No code change. No CLI added.

**Phase 1C files touched**:
```
docs/LINEAGE_RECONCILIATION_AUDIT_2026-05-14.md       NEW (this doc)
backend/runtime/brain/MASTER_BRAIN.md                 current-phase + canonical join formula + alias policy
backend/runtime/brain/CURRENT_RUNTIME_STATE.md        Phase 1C entry
backend/runtime/brain/MODEL_EVOLUTION_LOG.md          new dated entry at top
backend/runtime/brain/PIPELINE_AUTHORITY_MAP.md       LINEAGE section
backend/runtime/brain/ACTIVE_INCIDENTS.md             INC-012 added (orphan-outcome volume)
docs/OPERATOR_RUNBOOK.md                              Phase 1D gate reference
CURRENT_STATE.md, NEXT_SESSION.md                     session entries + Phase 1D operator-approval gate
```

**Verification**:
- `npm run brain:bootstrap` / `continuity` / `verify` — all PASS.
- `npm run runtime:verify` 14/14 PASS (no code touched).
- `npm run persistence:probe` 2/2 probes PASS (44 checks).
- `probe_epoch_authority_v1.js` 48/48 PASS.
- `probe_grading_backfill_v1.js` 32/32 PASS.
- Direct source inspection of 6 files: `buildPostGameReview.js`, `intelligence.js` (predictionId + normalizeCandidate + recordOutcomes + recordSlipOutcome), `buildNightlyOrchestrator.js`, `nbaIsolatedRoutes.js`, `routes/workstationRoutes.js`, `freezePredictionEpoch.js`.
- Live SQLite query: prediction_snapshots row count (643) + distribution across 7 dates + alias table size (0).
- Live fixture verification: Juan Soto tracked_bet → `intel.predictionId(...)` → exact match found in prediction_snapshots.

---

_Phase Grading-Calibration-Operations-1C lineage audit shipped: 2026-05-14_
_Carry-forward rule applied (7th consecutive phase) — re-verified canonical join formula from current source._
_Author: Claude (Cowork mode), under ARCHITECTURE_LAWS.md Laws 1/4/6/9/10/12/16._
_Phase 1D is operator-gated. See NEXT_SESSION.md._
