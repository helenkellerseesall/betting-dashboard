# lineupSpot Wiring Fix · PHASE 1 (build record)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** build (operator GO, fix direction nodded). PART A of the lock-down-the-data batch.
**Companion:** `lineupSpot_rootcause_phase0.md` (the trace).

---

## Build stage chosen (reported per the handoff)

The lineup join runs upstream in `buildMlbBootstrapSnapshot` but doesn't reach the rows that become tracked_best (no `playerIdExternal`, no `lineupPosition`). The fix lives at the **tracked_best serializer (`phase4Tracking.js`)** as a **back-fill against the fresh lineup cache** — chosen because it runs every hourly slate build (cache persists + grows as lineups post), and because it's **post-scoring** so today's edges/tiers/selection stay byte-identical.

## What shipped (3 code files, no PRESERVED edit)

- **NEW** `backend/pipeline/mlb/backfillMlbLineupSpot.js` — `makeLineupBackfiller()` loads the current-slate lineup cache once and resolves `lineupPosition` per row, **reusing the canonical join** (`buildExternalLineupIndexForEvent` + `resolveLineupPositionFromExternal`) so the join logic isn't duplicated. Omit-not-fabricate: null when the game has no posted lineup or the player isn't matched, or the spot is out of 1..9.
- `backend/pipeline/mlb/enrichment/mergeMlbExternalContext.js` — exported the three resolve helpers (additive; single source of truth for the id/name join + the battingOrder→1-9 normalization).
- `backend/pipeline/mlb/phase4Tracking.js` — both record loops (`toTrackedMlbBestEntry` @334, `toTrackedMlbPick` @542) now call `backfillRowLineup(row, backfiller)` before serializing: it sets only **null** `row.lineupPosition` + re-derives `lineupContextV2` (so `lineupSpot` + depth + PA proxy + run/rbi env all back-fill). Both serializers also now **preserve `playerIdExternal`** so future id-joins are reliable.

## Verification (this side — all ran)

- `node --check` clean on all three.
- **Per-confirmed-game reach gate** (the right gate — NOT slate-wide %), run against tonight's real tracked_best rows + the fresh cache (6 confirmed-lineup games):
  - **Confirmed-game picks: 26 → lineupSpot resolved 9** (was **1**). The 9 are the confirmed-side hitters; the other 17 are on the unconfirmed side of half-confirmed games (their lineup isn't posted) → correctly null.
  - **Unconfirmed-game picks: 80 → resolved 0** — omit-not-fabricate holds; zero fabrication for unposted games.
- **Byte-identical:** `backfillRowLineup` sets only previously-null fields (lineupPosition + lineupContextV2) and the serializers gain `playerIdExternal`; no scoring field (edge/tier/predictedProbability/side/line/odds) is touched. Selection happens upstream, before serialization.

## Honest scope notes

- **Today's improvement is display + survivability-input back-fill on the output rows.** The scoring benefit of better lineup data accrues **next slate**, when the upstream join is reliable (the handoff flagged this).
- **`playerIdExternal` is currently absent on the rows** (0/106), so today's resolution is via the **name-fallback** (9 of the ~10 confirmed-side hitters). Preserving `playerIdExternal` is the durable fix — once the upstream carries it to phase4Tracking, the reliable id-join fires and name-fallback misses (accents, Jr./Sr.) stop mattering. If 9/10 name-coverage proves insufficient over more slates, the follow-up is to carry `playerIdExternal` from the snapshot through scoring to phase4Tracking.

## Verify live (operator + Claude-A)

The back-fill runs at the next `slate:mlb` build (tracked_best/tracked_bets write time). After the operator reloads the backend (and `/api/ws/version == HEAD` per the stale-code discipline) and the next slate build fires, Claude-A confirms: lineupSpot lands on the confirmed-side hitters in the 6 confirmed games (≈9, was 1); unconfirmed games stay null; sysAudit's lineupSpot RED reflects per-confirmed-game reach, not the slate-wide %.

---

**PART B (sibling-populator hardening — refreshMlbBatterGameLogs / PitcherGameLogs / BullpenWorkload / PitcherStats, the proven batter-stats retry+merge pattern × 4 + merge-gate each) is the next build**, taken separately for focused execution per the trust bar on data-integrity code.
