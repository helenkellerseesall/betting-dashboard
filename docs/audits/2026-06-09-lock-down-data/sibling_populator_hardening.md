# Sibling-Populator Hardening (PART B build record)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** build (operator GO). Applies the proven batter-stats pattern (35fab13) to the 4 sibling populators.
**Handoff:** lock-down-the-data PART B.

---

## What shipped (5 code files)

A shared util + the 4 siblings, each gaining **withRetry + merge-not-overwrite + meta sidecar** — the same fragility the batter-stats fix already closed (single run, fail-open, overwrite-no-merge → recurring partial coverage on flaky-API nights).

- **NEW** `backend/pipeline/mlb/ingest/mlbIngestHardening.js` — shared primitives extracted from the batter-stats fix: `withRetry` (bounded retry + linear backoff), `loadJsonSafe`, `mergeNoShrink` (fresh overwrites, prior kept, **never shrinks** — returns a `shrank` flag the caller refuses to persist on), `writeMeta`.
- `refreshMlbPitcherStats.js` (flat map `mlbPitcherStats.json`) — retry on schedule + per-pitcher fetch; merge-not-overwrite; `mlbPitcherStats.meta.json`.
- `refreshMlbBullpenWorkload.js` (flat map `mlbBullpenWorkload.json`) — retry on schedule + boxscore + teams; merge; `mlbBullpenWorkload.meta.json`.
- `refreshMlbBatterGameLogs.js` (wrapped `{...players}` `mlbBatterGameLogs.json`) — retry on the gameLog batch; merge the **inner players** map; `mlbBatterGameLogs.meta.json`.
- `refreshMlbPitcherGameLogs.js` (wrapped `{...players}` `mlbPitcherGameLogs.json`) — retry on the gameLog batch; merge the inner players map; `mlbPitcherGameLogs.meta.json`.

Each now keeps prior data on a partial/failed run and returns the **merged** (superset) map. No PRESERVED file edited.

## Verification (this side — all ran)

- `node --check` clean on all 5; all 5 modules `require`-load with expected exports.
- **Merge-gate (the shared primitive every sibling funnels through):** all cases pass —
  - partial run: fresh overwrites, prior kept, new added (retained correct);
  - **TOTAL FAILURE (empty run): all prior retained, never shrinks** — the exact failure that was dropping teams;
  - fresh start + null/corrupt prior handled (honest empty);
  - wrapped inner-`players` merge retains prior pitchers/batters.
- `date` confirmed in scope where the meta write references it.

## Operator runs each once (real statsapi fetch + merge)

The actual fetch + write happen on the operator host. No backend reload needed — the populators run as separate processes (runner scripts / next `slate:mlb` build picks up the new code). Run commands in the fence: `populateMlbPitcherStats` / `populateMlbBullpenWorkload` / `populateMlbBatterGameLogs` / `populateMlbPitcherGameLogs`. Each prints its merged/retained counts; a partial night now keeps prior coverage instead of wiping it.

## Fast follow-up (noted, not this turn)

Each sibling now writes a `*.meta.json` coverage sidecar, but the **/status cards** for the 4 siblings aren't added yet — the batter-cache coverage card + `sectionBatterCacheCoverage` pattern (commit 35fab13) is the template. Adding 4 small mirror cards is a fast follow-up so the siblings' coverage is visible on /status like the batter cache.
