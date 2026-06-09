# lineupSpot ~4% Reach — Root Cause (PART A, read-only audit)

**Date:** 2026-06-09 ET · **Author:** Claude-B (4.8) · **Type:** read-only trace, report-before-fix. The fix is non-trivial wiring → STOP for operator/Claude-A nod.
**Handoff:** OPERATOR_SESSION_LOG.md 2026-06-09 (lock-down-the-data, PART A). Symptom: lineupSpot ~4% populated (sysAudit hourly; Claude-A 4/106).

---

## The flow

External lineup adapters (`fetchMlbStatsApiLineups` / `fetchMlbOfficialLineupsSnapshot`) → cache `data/mlbLineupCache.json` → `mergeMlbExternalContext.resolveLineupPositionFromExternal` sets `row.lineupPosition` → `deriveMlbLineupContext` (reads `row.lineupPosition ?? row.battingOrderIndex`, rejects spot <1 or >9) → onto the pick row.

The `battingOrder` 100/200/300… → 1/2/3 conversion IS handled (`mergeMlbExternalContext.js:155`, `raw > 20 ? Math.floor(raw/100)`), so that's not the bug.

## What the data says (live probe, tonight 2026-06-09)

- **Cache is NOT empty.** `mlbLineupCache.json` (written 15:00 ET) holds **63 players across 6 of tonight's 15 games**, plus a `lineupConfirmationByEventId` map (some games home-confirmed only). EventId format **matches** tracked_best exactly (6/6 cache events overlap).
- **tracked_best built 19:00 ET — AFTER the 15:00 cache**, so the cache was available at build time. (The cache's `writtenAt` is UTC: `19:00:38Z` = 15:00 ET — earlier confusion was a TZ artifact.)
- **Of 106 picks: only 4 have lineupPosition.** Breaking it down by game:
  - **80 picks are in the 9 games with NO posted lineup** → correctly null (lineups not out yet). **This is omit-not-fabricate working — do NOT "fix" these.**
  - **26 picks are in the 6 CONFIRMED-lineup games** → only **1** received lineupPosition.
- Within those 26: **0 carry a `playerIdExternal`** (the reliable id-join key), and **10 have a player name that matches a cache lineup name for their event** — yet only 1 of those 10 actually got lineupSpot. (The other 16 of 26 are on the unconfirmed side of a half-confirmed game — name not in cache — correctly null.)

## Root cause = a JOIN/WIRING gap (b), not cache-empty (a) and only partly timing (c)

The cache HAS the lineups, the eventIds match, the names are present — but the lineup enrichment isn't landing on the rows that become tracked_best:

1. **`playerIdExternal` is absent on the pick rows (0/26).** `resolveLineupPositionFromExternal` tries the id-join first (`mergeMlbExternalContext.js:176-187`); with no external id it can never fire, forcing the lossy name-fallback.
2. **The name-fallback isn't reaching these rows either.** 10 of 26 picks are name-matchable against the confirmed cache, but 9 of those 10 still have null lineupSpot — so the resolver either isn't being CALLED on the tracked_best build path, or its `isNameMatch` is stricter than the eventId+normalized-name match these 10 satisfy.

So the dominant fixable failure is **~9 picks in confirmed games that should have lineupSpot and don't** — a wiring/resolution gap, not missing data. (The headline "4%" is mostly the legitimate 80/106 unconfirmed-game nulls; the actual bug is the 1/10 join rate inside confirmed games.)

## Fix direction (for operator/Claude-A to approve — non-trivial)

1. **Re-join lineup at the tracked_best build, against the fresh cache** — ensure `resolveLineupPositionFromExternal` runs on the row set that becomes tracked_best (the symptom is consistent with the lineup resolution running earlier/elsewhere and not on these rows). Since the slate rebuilds hourly and the cache persists, a build-time re-join would back-fill lineupSpot as lineups post.
2. **Preserve `playerIdExternal` onto the rows** so the reliable id-join fires (the name-fallback is lossy — accents, Jr./Sr., nicknames). This is the durable fix; name-matching alone will keep missing ~half.
3. **Keep null when lineups truly aren't posted** (the 80 unconfirmed-game picks) — omit-not-fabricate; never force a spot.

This needs a decision about WHERE to wire the re-join (which build stage owns it) + the id-preservation, so I'm stopping here for a nod rather than editing the enrichment path blind.

## Note for the verifier

Re-checking this later: lineupSpot reach should be judged **per confirmed game**, not slate-wide — a healthy state is "≈100% of picks in confirmed-lineup games have lineupSpot; picks in unconfirmed games are null." Slate-wide % will always look low early in the day when most lineups aren't out.

---

**PART B (sibling-populator hardening) is queued as the next build** — apply the proven batter-stats retry+merge pattern to `refreshMlbBatterGameLogs` / `refreshMlbPitcherGameLogs` / `refreshMlbBullpenWorkload` / `refreshMlbPitcherStats`, with a merge-gate proof per sibling. Held so PART A's wiring decision lands first and PART B gets focused execution.
