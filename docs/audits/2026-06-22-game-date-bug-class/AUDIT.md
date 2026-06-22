# Audit — "always a day ahead" grading bug class (read-only)

**Date:** 2026-06-22 ~01:30 ET · **Author:** Claude-B · **No code changed.**
**Verdict up front:** the proposed root-fix (route the grading fetch to the slate's ET date instead of "slate+1") is **WRONG and would regress grading for every slate**. The fetch is the ONE component already doing it right. The real misalignment is **slate-file LABEL vs game DATE**, set at slate generation — not in the fetch. Details + pinned lines below. **STOP for operator+CA decision before any code change.**

---

## What CA got right
- `fetchMlbGameResults(date)` queries `/schedule?date=${date}` for the date handed (innocent) — `fetchMlbGameResults.js:131,137`. ✓
- The symptom is real: slate 06-21 shows "13 games, 0 players resolved → 1,055 pending → 0 graded." ✓
- Grading/settlement should not silently log "OK" on ~0 resolved (#4). ✓ (valid fix, see below)

## What CA got wrong (with evidence)
- **The fetch game-date is NOT computed in `settlementRun.js`.** settlement:run → `runHistoricalGrade.js` → `gameDatesForSlate(sport, slate)` → `fetchMlbGameResults(gd)`. Pinned:
  - `runHistoricalGrade.js:223` `gameDatesForSlate(sport, slateDate)` reads each bet's `gameTime`, converts to ET calendar date via `calendarDateForTimestamp(ms)` (slateDate.js:124 — CANONICAL), collects the distinct set. **It already routes through slateDate.js.**
  - `runHistoricalGrade.js:272-275` fetches each derived game-date and merges.
- **`gameDatesForSlate` is correct — it follows the REAL game times.** Proof (real data, run 2026-06-22):

  | slate file | game-date(s) derived from gameTime | n |
  |---|---|---|
  | 2026-06-11 | [06-12] | 1450 |
  | 2026-06-14 | [06-15] | 686 |
  | 2026-06-16 | [06-17] | 1272 |
  | 2026-06-17 | [06-18] | 888 |
  | 2026-06-18 | [06-19] | 1033 |
  | 2026-06-20 | [06-20, 06-21] | 3144 |
  | 2026-06-21 | [06-22] | 1055 |
  | 2026-06-22 | [06-22] | 5905 |

  Every slate's games are on slate **or slate+1**, never slate−1. The 402/410 "players resolved" in past runs came from these gameTime-derived dates (e.g. slate 06-18 fetched 06-19 → 402 resolved — the players really played 06-19).
- **`gameTime` is REAL** — it is the odds-API `commence_time`, stored at ingestion: `saveTrackedSlateSnapshot.js:44` (`row.gameTime ?? row.commence_time ?? …`). Not a +1 ingestion bug.
- **Therefore CA's fix would regress:** forcing the fetch to the slate's ET date would fetch the day BEFORE the games (slate 06-18 → fetch 06-18 → 0 games, they're 06-19) → 0 resolved for EVERY slate → grading collapses. Do **not** apply it.

---

## The TRUE root (pinned)
The tracked-slate file is **named by `currentSlateDateEt()` at GENERATION time**, while the games it holds are next-day:
- `saveTrackedSlateSnapshot.js:5` import `currentSlateDateEt`; `:12` `toDateKey()` → `currentSlateDateEt()`; `:104` `const slateDate = toDateKey(date)`; `:151` writes `tracked_props_${slateDate}.json` (tracked_bets named the same way).
- So **slate label = "the date the picks were generated"**, NOT "the date the games play." The games are slate+1 (real `commence_time`).

**Consequence:** grading/settlement/readiness assume "slate N's games are final by ~4 AM N+1" and grade slate N then. But slate N's games are on N+1 (evening) → not final until ~4 AM N+2. So the most-recent slate always shows 0-resolved/pending at the 4 AM N+1 run; the **3-night settlement window re-sweep catches it a day late** — which is why all PAST slates (06-11..06-20) ARE graded and only the current one looks "0 graded."

**The current "06-21 → 0 graded" is EXPECTED, not a failure:** at 01:30 ET 06-22 the slate-06-21 games (06-22 evening, gameTime 06-22T22:11Z = 6:11pm ET) are ~17h in the future. Same class as the pending-slate timing already fixed on the readiness card.

---

## Recommended fixes (await operator GO — none applied)

1. **DO NOT** apply the proposed fetch-date re-route. `gameDatesForSlate` stays. (Rejecting a regression.)
2. **#4 A1 masking — SAFE, recommended:** make settlement RED/alert on ~0-of-N resolved **only when the slate's derived game-dates are in the PAST** (games should be final). For the current slate (game-dates today/future) 0 resolved = PENDING, not a failure. Pinned target: settlement summary / the runHistoricalGrade `⚠ No game results fetched` path (`runHistoricalGrade.js:284-285`) + the settlement verdict. Pending/future-aware (the no-games-aware pattern).
3. **#3 recurrence guard — SAFE, recommended:** add a `runtime:verify` check that FAILS if a date-sensitive grading/ingest file derives a YYYY-MM-DD via raw `toISOString().slice(0,10)` or `setDate(+1)` instead of slateDate.js. The canonical grading path is already clean (gameDatesForSlate uses slateDate); the guard prevents FUTURE drift. Scope it to the date-path files (allowlist display formatters).
4. **#2 sweep — audit-then-propose:** the named files (refreshMlbWeatherForSlate / refreshMlbBullpenWorkload / buildMlbWeather / fetchMlbOfficialLineupsSnapshot) are CURRENT-slate INGEST — they enrich today's slate and currentSlateDateEt() is correct for that purpose; need a per-file scan to confirm none does raw +1/UTC. PRESERVED `mlbFutureOnly.js`: audit + propose only, no edit without GO.
5. **#5 lineupSpot 0% RED — SEPARATE family:** it is the MLB official-lineups feed adapter not populating `battingOrder`/`lineupSpot` (noted since 2026-06-01: `fetchMlbStatsApiLineups.js:12`, `fetchMlbApiSportsScaffold.js:732` "0/71 (0%) never populated"). A feed/adapter gap, not the grading game-date offset — though worth confirming the lineups fetch keys off game-date. Recommend a focused separate audit.

## The DEEP decision (operator + CA)
The only thing that fully "kills the class" is resolving the **slate-label = generation-date vs game-date** semantic. Two options, both big:
- (A) Formally accept "slate = generation date" and make grading TIMING game-date-driven (grade slate N after its `gameDatesForSlate` max date is final) — small, since gameDatesForSlate already gives the dates; the window re-sweep already approximates this.
- (B) Rename the slate convention so the file is named by game-date — ripples across EVERY consumer that keys off the file name (high blast radius; not freeze-safe-trivial).
**Recommendation:** (A) + fixes #2–#4. Do NOT do (B) without a deliberate, scoped migration. No re-grade of 06-21 is needed/possible tonight — its games haven't been played (06-22 evening); it will grade after the 4 AM 06-23 run (or the next window sweep), which is correct.
