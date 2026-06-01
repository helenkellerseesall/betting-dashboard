# REPO_INVENTORY.md

Generated 2026-06-01T01:03:01.131Z by `backend/scripts/discoveryAudit.js`.

This is the canonical map of what's actually in this repo. Built in response to operator's "verify everything" ask after I missed an entire `backend/storage/` SQLite subsystem with 25 tables. Re-run discoveryAudit anytime; this file regenerates.

## Top-Level Layout

```
.gitignore               0 .js       1 total   2.3 KB
ARCHITECTURAL_REVIEW.md     0 .js       1 total   10.5 KB
ARCHITECTURE.md          0 .js       1 total   33.6 KB
BUILD_LOG.md             0 .js       1 total   44.4 KB
CHEAT_SHEET.md           0 .js       1 total   3.5 KB
COGNITION_AUDIT.md       0 .js       1 total   11.8 KB
PLAYBOOK.md              0 .js       1 total   12.2 KB
PRESERVED.md             0 .js       1 total   9.9 KB
PRODUCT_IDENTITY.md      0 .js       1 total   18.0 KB
PRODUCT_VISION.md        0 .js       1 total   3.1 KB
REPO_INVENTORY.md        0 .js       1 total   8.8 KB
RUNTIME_FACTS.md         0 .js       1 total   3.4 KB
backend                414 .js     890 total   1284765.4 KB
docs                     0 .js      53 total   2078.9 KB
frontend                 1 .js      49 total   725.3 KB
lanes                    0 .js       2 total   19.6 KB
scorecards               0 .js       2 total   19.6 KB
scripts                 33 .js      34 total   316.4 KB
```

## Backend Subsystems (depth 2)

```
backend/1~                         0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/brain                      0 .js      10 total  ← UNINSPECTED (operator's call-out)
backend/cockpit                    4 .js       5 total  ← UNINSPECTED (operator's call-out)
backend/config                     1 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/data                       0 .js      51 total
backend/debug.log                  0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/docs                       0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/http                       3 .js       3 total  ← UNINSPECTED (operator's call-out)
backend/latest.json                0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/manual-outcomes.json       0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/ml                         1 .js       6 total
backend/mlb-external-cache.json     0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/offline                    1 .js       2 total  ← UNINSPECTED (operator's call-out)
backend/package-lock.json          0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/package.json               0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/pipeline                 219 .js     220 total
backend/routes                     4 .js       4 total
backend/runtime                    6 .js     380 total
backend/runtime_inputs             0 .js       2 total  ← UNINSPECTED (operator's call-out)
backend/scripts                  159 .js     175 total
backend/server.js                  1 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/server.js.bak              0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/server.log                 0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/snapshot-fixture.json      0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/snapshot-mlb.json          0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/snapshot.json              0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/storage                    8 .js       9 total
backend/tests                      1 .js       1 total
backend/tracker                    2 .js       3 total  ← UNINSPECTED (operator's call-out)
backend/upside                     3 .js       3 total  ← UNINSPECTED (operator's call-out)
backend/utils                      1 .js       1 total  ← UNINSPECTED (operator's call-out)
```

## SQLite Databases

- `backend/data/intelligence.db` — 0.0 KB
- `backend/runtime/tracking/betting_test.db` — 0.0 KB
- `backend/storage/betting.db` — 647380.0 KB

## Files using SQLite (subsystems with persistent state beyond JSON)

- `backend/pipeline/grading/calibrationFeedback.js`
- `backend/pipeline/memory/freezePredictionEpoch.js`
- `backend/pipeline/memory/readFrozenEpoch.js`
- `backend/pipeline/mlb/context/freezeMlbContextualEpoch.js`
- `backend/pipeline/mlb/live/freezeMlbLiveStateEpoch.js`
- `backend/pipeline/review/buildDailyIntelligenceReview.js`
- `backend/pipeline/screenshots/screenshotRoutes.js`
- `backend/pipeline/shared/buildPersonalLedger.js`
- `backend/scripts/backfillPredictionIdAliases.js`
- `backend/scripts/calibrationStatus.js`
- `backend/scripts/discoveryAudit.js`
- `backend/scripts/epochStatus.js`
- `backend/scripts/gradingStatus.js`
- `backend/scripts/lineageStatus.js`
- `backend/scripts/persistenceStatus.js`
- `backend/scripts/runGradingBackfillAll.js`
- `backend/scripts/settlementRun.js`
- `backend/scripts/verifyMlbImmutabilityHardening.js`
- `backend/server.js`
- `backend/storage/db.js`
- `backend/storage/importHistoricalData.js`
- `backend/storage/intelligence.js`
- `backend/storage/schema.js`
- `scripts/probes/probe_eager_init_v1.js`
- `scripts/probes/probe_frozen_epoch_v1.js`
- `scripts/probes/probe_grading_backfill_v1.js`
- `scripts/probes/probe_ledger_mirror_v1.js`
- `scripts/probes/probe_lineage_v1.js`
- `scripts/probes/probe_longitudinal_completion_v1.js`
- `scripts/probes/probe_outcome_completion_v1.js`
- `scripts/probes/probe_persistence_idempotency_v1.js`
- `scripts/probes/probe_snapshot_freeze_v1.js`

## Recent Activity — Top 20 most-recently-modified .js

| Age (h) | File |
|---|---|
| 1.2 | `backend/scripts/discoveryAudit.js` |
| 1.3 | `backend/pipeline/shared/buildPersonalLedger.js` |
| 5.0 | `backend/scripts/deepAudit.js` |
| 5.3 | `backend/scripts/auditDeltaCheck.js` |
| 5.3 | `backend/scripts/sysAudit.js` |
| 6.6 | `backend/scripts/restoreLostPlacedBets.js` |
| 17.7 | `backend/scripts/probeFeV2Round2.js` |
| 17.7 | `backend/routes/workstationRoutes.js` |
| 17.9 | `backend/pipeline/schedule/buildSlateEvents.js` |
| 18.1 | `backend/pipeline/shared/calibrationDampener.js` |
| 21.5 | `backend/pipeline/nba/nbaRoleContextDeriver.js` |
| 21.6 | `backend/pipeline/nba/buildNbaSnapshotCandidates.js` |
| 21.6 | `backend/pipeline/nba/nbaGameContextCache.js` |
| 22.1 | `backend/scripts/traceMyBets.js` |
| 25.2 | `backend/pipeline/mlb/ingest/refreshMlbBullpenWorkload.js` |
| 25.2 | `backend/scripts/auditNightly.js` |
| 25.2 | `backend/scripts/populateMlbBullpenWorkload.js` |
| 25.4 | `backend/scripts/probeParkFactorsExtended.js` |
| 25.4 | `backend/pipeline/mlb/buildMlbHitsProbabilityEngine.js` |
| 25.4 | `backend/pipeline/mlb/buildMlbHrPredictionCandidates.js` |

## Long Files (top-15, refactor candidates)

| Lines | File |
|---|---|
| 20029 | `backend/server.js` |
| 2727 | `backend/pipeline/shared/buildFeaturedPlays.js` |
| 2701 | `backend/routes/workstationRoutes.js` |
| 2064 | `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js` |
| 1865 | `backend/pipeline/mlb/buildMlbInspectionBoard.js` |
| 1580 | `backend/http/nbaIsolatedRoutes.js` |
| 1522 | `backend/pipeline/shared/buildSlipAi.js` |
| 1495 | `backend/pipeline/mlb/buildMlbBootstrapSnapshot.js` |
| 1437 | `backend/pipeline/shared/buildPersonalLedger.js` |
| 1380 | `backend/storage/intelligence.js` |
| 1339 | `backend/scripts/runNbaNight.js` |
| 1305 | `backend/pipeline/mlb/phase4Tracking.js` |
| 1196 | `backend/pipeline/mlb/buildMlbPropClusters.js` |
| 1083 | `backend/pipeline/nba/buildNbaAiPicks.js` |
| 1045 | `backend/pipeline/mlb/buildMlbInsightBoard.js` |

## Potential Orphans (0 reverse-imports, not entry points)

17 candidates. Top 30:

- `backend/cockpit/server.js`
- `backend/http/_revert_target.js`
- `backend/offline/evaluateEmittedPicks.js`
- `backend/pipeline/memory/readFrozenEpoch.js`
- `backend/pipeline/props/buildDraftKingsRows.js`
- `backend/pipeline/selection/flexProps.js`
- `backend/storage/importHistoricalData.js`
- `backend/tests/nightly-board-smoke.js`
- `frontend/eslint.config.js`
- `scripts/board.js`
- `scripts/ledger.js`
- `scripts/nightlyReview.js`
- `scripts/probes/trace_slips.js`
- `scripts/runMlbNight.js`
- `scripts/runNbaNight.js`
- `scripts/updateMlbResults.js`
- `scripts/updateNbaResults.js`

## How to use this inventory

- **Before** claiming "I've verified the repo" or "I've inspected all subsystems," re-read the Backend Subsystems list above. If anything is marked UNINSPECTED, I haven't actually looked at it.
- **Before** writing a new helper, grep for the function name first (binding rule per `feedback_verbatim_corrections.md`).
- **When** adding a new subsystem, re-run `node backend/scripts/discoveryAudit.js` to confirm the inventory updated.
- **Pre-commit hook** is queued (#69 self-awareness layer) to fire this on every commit and refuse to merge if previously-known files vanish unexpectedly.
