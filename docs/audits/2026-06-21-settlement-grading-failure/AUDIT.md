# Audit — Settlement & Grading Nightly Failures (read-only)

**Date:** 2026-06-21 (~17:40 ET) · **Author:** Claude-B · **Backend at audit:** 7b65662
**Scope:** read-only. NO code changed. Proposals below require operator GO.
**Freeze-safety:** all proposed targets are settlement/grading **operations** (ungated — Law-7 freeze blocks scoring/selection, not grading/settlement). The one PRESERVED file in this area (`buildNightlyOrchestrator.js`) is **NOT** touched by any proposal.

---

## TL;DR

Two **separate** nightly failures, both **false-alarm classes** (the system is doing the right work; the pass/fail verdicts are wrong). Neither corrupts data.

- **Settlement `RESULT: FAIL (exit 1)` every night** — caused by counting status `partial` as a failure. `partial` fires whenever `outcome_snapshots` count < `tracked_bets.settled` count, which is the **structurally normal** state (one outcome row serves many bets). Recurring nightly since ≥ 2026-06-05.
- **Grading `grading:backfill-all FAIL (exit 1)`, one date/night** — caused by a **double-run race**: two `grading:backfill-all` processes start ~15s apart at 04:00 (the `grading-nightly` LaunchAgent **and** the scheduler daemon), collide on a per-date lock, and the loser fast-fails (`already_running`, ~47ms) on whatever date they overlap. A different date "fails" each night.

**Correction to the reported framing:** the report said grading had "3 of 26 dates fail." The log shows **1 of 26** failed (`mlb/2026-06-09`). The "3" is the settlement number (3 MLB `partial` pairs). The settlement "3 pairs failed" are the **MLB partials**, NOT the NBA off-season skips — those skips are correctly excluded from the failure tally.

---

## ISSUE A — Settlement reports FAIL every night

### What actually happens
`settlement:run --window=3` (fired by `scheduler.sh:445` at 03:45 ET) processes the last 3 dates × {mlb, nba} = 6 pairs. Last night (2026-06-21):

| pair | tracked_bets settled/total | outcome_snapshots | status |
|---|---|---|---|
| mlb 06-18 | 890/1033 | 771 | **partial** |
| nba 06-18 | 0/0 (no file) | n/a | skipped_no_tracked_bets |
| mlb 06-19 | 1866/2025 | 1221 | **partial** |
| nba 06-19 | 0/0 (no file) | n/a | skipped_no_tracked_bets |
| mlb 06-20 | 2531/3144 | 1491 | **partial** |
| nba 06-20 | 0/0 (no file) | n/a | skipped_no_tracked_bets |

`RESULT: FAIL (3 pairs failed)` → exit 1.

### Root cause
`exitVerdict()` (`backend/scripts/settlementRun.js:281`) counts a pair as failed when:
```
status === "grading_failed" || "orchestration_INCOMPLETE" || "partial"
```
`partial` is assigned (`settlementRun.js:255`) when **`outcome_snapshots count < tracked_bets.settled count`** (and outcomeCount > 0).

But these two counts are **not 1:1 and never will be**:
- `tracked_bets.settled` counts **individual bets** (every book × line × side is a row).
- `outcome_snapshots` is keyed by `id = predictionId` (PRIMARY KEY, `intelligenceSchema.js:94`) and a row is only written where a matching prediction exists/joins (`intelligence.js:908`, `INSERT OR REPLACE`). Many bets collapse onto one outcome; bets without a joined prediction produce none.

**Proof of the collapse:** for mlb 06-18 the grading pass logged `[intel] mlb outcomes: 890 recorded` but the table holds **771** rows for that date — 890 writes → 771 distinct rows. The ratio is consistently ~0.55–0.75 across every populated date. It only reaches equality (→ `settled_verified`) at tiny counts (e.g., 29/29, 58/58) where there are no collisions.

So `outcomeCount >= settled` (the only "verified" gate) **cannot pass on a normal multi-book slate**. Settlement therefore reports FAIL + exit 1 every night, even though grading completed cleanly.

### Is the work actually failing? No.
Last night's grading inside settlement reported `0 unresolved` for every MLB date (e.g. `gradeTrackedBets mlb 2026-06-20: 2531 graded, 0 unresolved, 613 pending`). `unresolved` = should-have-graded-but-couldn't (a real problem). `pending` = awaiting/ungradeable outcome (DNP, scratch, future game, prop with no stat line) — a normal residual that never reaches zero. Zero unresolved = the grading did everything it could.

### One-off vs recurring
**Recurring every night.** `settlement:run FAILED (exit 1)` appears on every date in the log from 2026-06-05 through 2026-06-21. Never a real data loss — the corpus keeps filling (3-night window re-sweeps each date until it stabilizes).

### Proposed fix (freeze-safe; `settlementRun.js`, not PRESERVED) — needs GO
Stop treating a healthy `partial` as a hard failure. Two equivalent options:
- **A1 (preferred):** in `executePair`, when grading succeeded and outcomes were recorded but `outcomeCount < settled`, assign a new benign status `settled_with_residual` instead of `partial`, and exclude it from `exitVerdict`'s failing set. Keep `orchestration_INCOMPLETE` (settled > 0 **and** outcomeCount === 0) as a real failure.
- **A2 (smaller):** change the verified gate from `outcomeCount >= settled` to `outcomeCount > 0` (with `orchestration_INCOMPLETE` already catching the 0 case).

Either makes settlement exit 0 on a healthy night while still red-flagging a genuine zero-outcome orchestration break.

---

## ISSUE B — Grading fails on one (rotating) date each night

### What actually happens
`grading:backfill-all` considers 26 dates. Last night: `ran=20, skipped=5, failed=1`. The only failed date: **`mlb/2026-06-09 → FAIL (exit=1, 47ms)`**. Real per-date runs take 3,000–35,000 ms; 47 ms is a pre-DB-boot abort. No `stderr` was captured.

### Root cause: a double-run race
**Two** `grading:backfill-all` invocations fire at 04:00, ~15 s apart:
- `04:00:05` — `AUTOPILOT grading-nightly` (LaunchAgent `com.motel666.grading-nightly` → `grading-nightly.sh` → `npm run grading:backfill-all`).
- `04:00:20` — `grading:backfill-all starting (Phase Autonomous-Orchestrator-1A)` (the always-on scheduler daemon → `scheduler.sh:464-475` → `npm run grading:backfill-all`).

Both iterate the same 26 dates and spawn per-date `nightlyReview.js`, which acquires a per-date lock. `acquireLock` (`buildNightlyOrchestrator.js:167`) honors a lock whose owning pid is alive **and** age < 10 min, returning `{ok:false, reason:"already_running"}` (`:198/:205/:210`). `runNightlyReview` (`:512-514`) turns that into `{ok:false, error:"Already running…"}` **before** DB-boot, with no `deferred` flag → `nightlyReview.js:334` sets exit 1, and the reason prints to **stdout** (`printSummary`, `console.log`). `runGradingBackfillAll` only surfaces `stderr`, so the reason is invisible in the log.

Because the two runs are offset ~15 s and per-date durations vary, they overlap on **one** date per night — the loser fast-fails on it. This explains every observed symptom: 47 ms, empty stderr, exactly one failed date, and a **different date every night**.

**Recurrence proof (rotating date):** failed date per night — 06-02, 06-01, 05-31, 05-30, 06-05, 06-02, 06-04, 06-08, 06-05, 06-11, 06-08, 06-09. `mlb/2026-06-09` itself failed only twice, non-consecutively. This is transient contention, not date-specific data corruption.

**Stale-lock residue confirms locks aren't always released:** `.nightly_lock_mlb_2026-05-08` and `.nightly_lock_mlb_2026-06-19` are present right now.

This is also a **Law-1 parallel-authority** issue: two schedulers own the same nightly job. `scheduler.sh`'s own comment says Phase Autonomous-Orchestrator-1A was added "to close INC-010 (orchestrator dormant)," apparently unaware the `grading-nightly` LaunchAgent already fires it.

### Why `--clear-locks` alone does NOT fix it
The stale-lock sweep only reclaims locks that are dead-pid **or** alive-pid-but-older-than-10-min. In the race, the contending lock is ~seconds old with a live pid → correctly honored, not swept. The fix must remove the duplicate trigger.

### Proposed fix (freeze-safe; no PRESERVED file) — needs GO
- **B1 (primary):** eliminate the double-run — keep exactly **one** 04:00 grading trigger. Recommend keeping the **`com.motel666.grading-nightly` LaunchAgent** (it's the canonical scheduled autopilot per RUNTIME_FACTS / project instructions, runs isolated, has its own log) and **removing the `scheduler.sh:464-475` grading block**. (Operator's call on which to keep — but not both.) This ends the race → no more rotating single-date failures.
- **B2 (diagnostic, do alongside):** in `runGradingBackfillAll.js`, also print the spawned child's **stdout** tail on failure (today only stderr is shown), so the actual reason (`Already running…`, `DEFERRED`, etc.) is visible in the nightly log. This would have made this audit a one-minute read.
- **B3 (cosmetic):** `grading-nightly.sh` logs `FAILED (exit 0)` because `$(ts)` in the echo resets `$?` before it's read. Capture `rc=$?` immediately after the `npm run` so the log shows the true exit code.

---

## Cascade note (the wrapper line "grading will skip them")
Settlement's exit-1 prints "bets may stay pending; grading will skip them." In practice grading still ran at 04:00 and graded everything gradeable (`0 unresolved`). The cascade message is misleading: the settlement exit-1 is the false `partial` verdict, not a real blocker for grading. Fixing Issue A removes the scary line.

## Files referenced (read-only)
- `backend/scripts/settlementRun.js` (`executePair` :207, status assignment :240-260, `exitVerdict` :281)
- `backend/scripts/runGradingBackfillAll.js` (spawn + fail print :260-272; clearStaleLocks :77-152)
- `backend/scripts/scheduler.sh` (settlement :445; grading :464-475)
- `backend/scripts/autopilots/grading-nightly.sh` + `com.motel666.grading-nightly.plist`
- `backend/pipeline/shared/buildNightlyOrchestrator.js` **(PRESERVED — not modified)** (`acquireLock` :167, lock-held returns :198/205/210, call site :512)
- `backend/storage/intelligenceSchema.js:93` (outcome_snapshots PK = predictionId) · `backend/storage/intelligence.js:908` (INSERT OR REPLACE)

## STOP
No code change made. Awaiting operator GO on Issue A (A1 preferred) and Issue B (B1 + B2, B3 optional).
