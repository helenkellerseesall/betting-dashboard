# REPO_INVENTORY.md

Generated 2026-06-04T01:12:28.793Z by `backend/scripts/discoveryAudit.js`.

This is the canonical map of what's actually in this repo. Built in response to operator's "verify everything" ask after I missed an entire `backend/storage/` SQLite subsystem with 25 tables. Re-run discoveryAudit anytime; this file regenerates.

## Top-Level Layout

```
.gitignore               0 .js       1 total   2.4 KB
ARCHITECTURAL_REVIEW.md     0 .js       1 total   10.5 KB
ARCHITECTURE.md          0 .js       1 total   33.6 KB
BUILD_LOG.md             0 .js       1 total   44.4 KB
CHEAT_SHEET.md           0 .js       1 total   3.5 KB
COGNITION_AUDIT.md       0 .js       1 total   11.8 KB
OPERATOR_SESSION_LOG.md     0 .js       1 total   70.9 KB
OPERATOR_TRUTH_AUDIT.md     0 .js       1 total   18.8 KB
PLAYBOOK.md              0 .js       1 total   12.2 KB
PRESERVED.md             0 .js       1 total   9.9 KB
PRODUCT_IDENTITY.md      0 .js       1 total   18.0 KB
PRODUCT_VISION.md        0 .js       1 total   3.1 KB
REPO_INVENTORY.md        0 .js       1 total   8.8 KB
RUNTIME_FACTS.md         0 .js       1 total   3.4 KB
SLATE_DATE_DOCTRINE.md     0 .js       1 total   4.7 KB
backend                424 .js     941 total   1538142.1 KB
docs                     0 .js      53 total   2078.9 KB
frontend                 1 .js      50 total   798.2 KB
lanes                    0 .js       2 total   19.6 KB
scorecards               0 .js       2 total   19.6 KB
scripts                 29 .js      30 total   304.8 KB
```

## Backend Subsystems (depth 2)

```
backend/brain                      0 .js      10 total  ← UNINSPECTED (operator's call-out)
backend/cockpit                    4 .js       5 total  ← UNINSPECTED (operator's call-out)
backend/config                     1 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/data                       0 .js      59 total
backend/docs                       0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/http                       2 .js       2 total  ← UNINSPECTED (operator's call-out)
backend/ml                         1 .js       6 total
backend/mlb-external-cache.json     0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/offline                    1 .js       2 total  ← UNINSPECTED (operator's call-out)
backend/package-lock.json          0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/package.json               0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/pipeline                 225 .js     226 total
backend/routes                     7 .js       7 total
backend/runtime                    6 .js     407 total
backend/scripts                  162 .js     193 total
backend/server.js                  1 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/snapshot-mlb.json          0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/snapshot.json              0 .js       1 total  ← UNINSPECTED (operator's call-out)
backend/storage                    8 .js       9 total
backend/tracker                    2 .js       3 total  ← UNINSPECTED (operator's call-out)
backend/upside                     3 .js       3 total  ← UNINSPECTED (operator's call-out)
backend/utils                      1 .js       1 total  ← UNINSPECTED (operator's call-out)
```

## SQLite Databases

- `backend/storage/betting.db` — 731560.0 KB

## Files using SQLite (subsystems with persistent state beyond JSON)

- `backend/pipeline/grading/calibrationFeedback.js`
- `backend/pipeline/memory/freezePredictionEpoch.js`
- `backend/pipeline/memory/readFrozenEpoch.js`
- `backend/pipeline/mlb/context/freezeMlbContextualEpoch.js`
- `backend/pipeline/mlb/live/freezeMlbLiveStateEpoch.js`
- `backend/pipeline/review/buildDailyIntelligenceReview.js`
- `backend/pipeline/screenshots/screenshotRoutes.js`
- `backend/pipeline/shared/archetypeHistoryLookup.js`
- `backend/pipeline/shared/buildPersonalLedger.js`
- `backend/pipeline/shared/buildSlipAi.js`
- `backend/pipeline/shared/calibrationDampener.js`
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
| 4.7 | `backend/routes/trueScheduleRoute.js` |
| 16.9 | `backend/server.js` |
| 17.6 | `backend/pipeline/screenshots/classifyIngestedSlip.js` |
| 18.1 | `backend/routes/statusRoute.js` |
| 21.9 | `backend/routes/coverageRoute.js` |
| 40.0 | `backend/pipeline/screenshots/screenshotRoutes.js` |
| 41.1 | `backend/pipeline/screenshots/bettorTasteSignal.js` |
| 41.1 | `backend/pipeline/shared/buildSlipAi.js` |
| 41.2 | `backend/pipeline/screenshots/outcomeLinksPopulator.js` |
| 41.2 | `backend/pipeline/screenshots/bettorProfilesUpdater.js` |
| 43.2 | `backend/pipeline/mlb/enrichment/mergeMlbExternalContext.js` |
| 43.2 | `backend/pipeline/mlb/external/adapters/fetchMlbApiSportsScaffold.js` |
| 43.2 | `backend/pipeline/mlb/cache/mlbLineupCache.js` |
| 43.6 | `backend/pipeline/mlb/phase4Tracking.js` |
| 43.6 | `backend/pipeline/nba/buildNbaPerformanceTracking.js` |
| 44.2 | `backend/pipeline/shared/slateDate.js` |
| 44.7 | `backend/pipeline/schedule/buildSlateEvents.js` |
| 44.7 | `backend/scripts/sysAudit.js` |
| 44.7 | `backend/scripts/deepAudit.js` |
| 46.1 | `backend/scripts/ops/runtime.js` |

## Long Files (top-15, refactor candidates)

| Lines | File |
|---|---|
| 20067 | `backend/server.js` |
| 2748 | `backend/routes/workstationRoutes.js` |
| 2727 | `backend/pipeline/shared/buildFeaturedPlays.js` |
| 2064 | `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js` |
| 1865 | `backend/pipeline/mlb/buildMlbInspectionBoard.js` |
| 1623 | `backend/http/nbaIsolatedRoutes.js` |
| 1549 | `backend/pipeline/shared/buildSlipAi.js` |
| 1495 | `backend/pipeline/mlb/buildMlbBootstrapSnapshot.js` |
| 1448 | `backend/pipeline/shared/buildPersonalLedger.js` |
| 1382 | `backend/storage/intelligence.js` |
| 1349 | `backend/pipeline/mlb/phase4Tracking.js` |
| 1341 | `backend/scripts/runNbaNight.js` |
| 1310 | `backend/routes/statusRoute.js` |
| 1196 | `backend/pipeline/mlb/buildMlbPropClusters.js` |
| 1083 | `backend/pipeline/nba/buildNbaAiPicks.js` |

## Potential Orphans (0 reverse-imports, not entry points)

11 candidates. Top 30:

- `backend/cockpit/server.js`
- `backend/offline/evaluateEmittedPicks.js`
- `backend/pipeline/memory/readFrozenEpoch.js`
- `backend/pipeline/screenshots/outcomeLinksPopulator.js`
- `backend/pipeline/selection/flexProps.js`
- `backend/storage/importHistoricalData.js`
- `frontend/eslint.config.js`
- `scripts/board.js`
- `scripts/ledger.js`
- `scripts/nightlyReview.js`
- `scripts/probes/trace_slips.js`

## How to use this inventory

- **Before** claiming "I've verified the repo" or "I've inspected all subsystems," re-read the Backend Subsystems list above. If anything is marked UNINSPECTED, I haven't actually looked at it.
- **Before** writing a new helper, grep for the function name first (binding rule per `feedback_verbatim_corrections.md`).
- **When** adding a new subsystem, re-run `node backend/scripts/discoveryAudit.js` to confirm the inventory updated.
- **Pre-commit hook** is queued (#69 self-awareness layer) to fire this on every commit and refuse to merge if previously-known files vanish unexpectedly.
