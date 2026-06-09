# Batter-Stats Populator Hardening (build record)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** build (operator approved full hardening). Root cause of the 16/30-teams coverage.
**Handoff:** OPERATOR_SESSION_LOG.md 2026-06-09 18:37 ET — Claude-A.

---

## Root cause (confirmed in code)

`refreshMlbBatterStats.js` fetches from the FREE `statsapi.mlb.com` (not the dropped API-Sports key). But: (1) `fetchTeamRoster` / `fetchBatchSeasonStats` had **no retry** — a transient timeout silently dropped a team for the night (`collectBatters` skips `__error` rows; the batch loop did `failed += chunk.length; continue`); (2) `persistMap` wrote **only this run's map → overwrite, no merge** — a partial run wiped prior coverage with no fallback. Result: any flaky-API morning = partial coverage, recurring by design.

## What shipped (3 code files)

- `backend/pipeline/mlb/ingest/refreshMlbBatterStats.js`:
  - **Retry:** `withRetry(fn, {attempts:3, backoff})` wraps the schedule, roster, and people-batch axios calls. A transient failure retries instead of dropping a team.
  - **Merge-not-overwrite:** before persist, `loadPriorMap()` reads the existing `mlbBatterStats.json` and writes `{...prior, ...thisRun}` — fresh entries update, un-fetched players keep prior (season stats are day-stable). A defensive guard refuses to persist if `merged < prior` (never shrink coverage).
  - **Coverage check + targeted re-fetch:** after the main pass, any slate team with `< MIN_BATTERS_PER_TEAM (5)` cached triggers ONE targeted re-fetch of just those teams, then re-merge.
  - **Diagnostics + meta sidecar:** `diagnostics` gains `teamsOnSlate / teamsCaptured / missingTeams / coverageComplete / priorEntriesRetained`; a sidecar `mlbBatterStats.meta.json` is written for /status.
- `backend/scripts/populateMlbBatterStats.js`: prints a one-line coverage summary + a STILL-MISSING / COMPLETE line.
- `backend/routes/statusRoute.js`: `sectionBatterCacheCoverage()` reads the sidecar (`teamsCaptured/teamsOnSlate/missingTeams`, mtime age); surfaced in the payload (`out.batterCacheCoverage`) AND as a **yellow Open Issue** when a slate team is missing — so a partial populate is VISIBLE, not silent. Anti-fabrication: missing/corrupt meta is its own finding, never defaulted healthy.

**Not display-only** (flagged): newly-covered teams' batters get real season stats next slate (vs defaults) — desirable; today's already-generated picks unchanged. No PRESERVED file edited.

## Verification (this side — offline merge gate)

An offline mock-axios regression (temp `_merge_gate_test.js`, backs up + restores the real file) simulated a **partial run** (4 slate teams, one team's roster fails after retries) against the real 208-entry prior. Results — the merge gate holds:

- merged count **209 ≥ prior 208** (never shrinks). ✓
- **all 208 prior players retained** after the partial run (the core gate — a partial fetch does not wipe prior). ✓
- the failed team is reported in `missingTeams`; the targeted re-fetch was attempted. ✓
- meta sidecar written with `teamsCaptured/teamsOnSlate`; no-shrink guard not tripped; persisted. ✓
- real `mlbBatterStats.json` confirmed intact (208) after restore. ✓

(One assertion — "fresh fixture team added" — failed because the synthetic names `Test P901_0` collapse to one key under `normalizeName`; real player names don't. Production logic is correct.)

`node --check` clean on all three files; `statusRoute` + the route module load.

## Operator runs the real populate

The actual `statsapi.mlb.com` fetch + file write happen on the operator host. The commit fence runs `node backend/scripts/populateMlbBatterStats.js` — merge fills tonight's missing ~14 teams while the existing 16 stay. Claude-A screenshot-verifies a previously-omitted batter card (e.g. a Dodgers hitter) now shows stat backing, and `/status` shows full coverage.

## Queued follow-up

The sibling populators (`refreshMlbBatterGameLogs`, `refreshMlbPitcherGameLogs`, `refreshMlbBullpenWorkload`, `refreshMlbPitcherStats`) share the same overwrite/fail-open pattern — apply the same retry + merge hardening to each (separate task, not this turn).
