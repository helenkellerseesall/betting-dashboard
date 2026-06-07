# NBA-CLV-Capture-Repair — Audit Synthesis

**Date:** 2026-06-07. **Status:** AUDIT complete (read-only). No code until operator approves the fix design.
**Method:** per-step pipeline trace on real data (captureClosingLines.js + runtime/tracking/*.json + snapshot.json). Evidence: `.scratch/probe_nbaclv_trace.txt`.
**Question:** the P2 audit flagged NBA CLV 0% stamped (0 of 4521) while MLB stamps ~33%. The `captureClosingLines` loop runs both sports — so why does NBA never land a close stamp?

---

## Headline

**Root cause = a date/file-key mismatch in `captureClosingLines.resolveActiveDate` (captureClosingLines.js:67-80).** The close loop reads only **today/yesterday** `<sport>_tracked_bets_<date>.json`. But NBA bets are filed under a date **1-2 days before** the game's actual ET slate date (Finals bets surface days ahead, written under the build date). So at an NBA game's tipoff, the loop reads a file that doesn't contain that game's bets → 0 eligible → 0 capture. MLB works because its files are same-day-aligned. **The snapshot, the bets, and the join are all healthy — only file selection is broken.**

---

## Per-step trace (each handoff probed on real data)

| Step | Component | Status | Evidence |
|---|---|---|---|
| 1 | NBA snapshot (`loadSnapshotRawProps`→snapshot.json) | ✅ healthy | 5481 rawProps, 1 event (tonight's game), updatedAt 19:11 |
| 2 | NBA tracked_bets + OPEN capture | ✅ healthy | 887 bets, openOdds 887/887 (100%) |
| 3 | CLOSE capture (the symptom) | ❌ 0% | closeOdds=0 / clv=0 on every NBA file (06-01..06-06) |
| 4 | Join (bet→snapshot, `buildPropIndex`/`matchKeyForBet`) | ✅ 95% | 845/887 hit on the current snapshot; 42 misses are alt-lines |
| 5 | File selection (`resolveActiveDate`) | ❌ **root cause** | NBA files dated 1-2d before game slate date; loop reads today/yesterday only |

OPEN works but CLOSE doesn't is the key tell: open is stamped at write-time (same file, same cycle); close requires re-finding the bet near tipoff by date — and the date doesn't line up for NBA.

---

## Root cause detail + the MLB contrast

`resolveActiveDate(sport)` (captureClosingLines.js:67) returns `today` or `yesterday` (slate date), and `runOnceForSport` (L251) reads exactly one file: `${sport}_tracked_bets_${resolvedDate}.json`.

**NBA file-date vs game ET-slate-date (offset by 1-2 days; no file named for the game date):**
- file `2026-06-01` → games `2026-06-03`
- file `2026-06-02` → games `2026-06-03`
- file `2026-06-03` → games `2026-06-05`
- file `2026-06-04` → games `2026-06-05`
- file `2026-06-06` → games `2026-06-08`
- (`2026-06-05` file = 0 bets; no 06-07/08/09 files exist)

**MLB file-date vs game ET-slate-date (aligned → capture works):**
- file `2026-06-07` → games `2026-06-07` (closeStamped 955/2544)
- file `2026-06-06` → games `2026-06-06/07` (535)
- file `2026-06-05` → games `2026-06-05/06` (293)

So at the NBA `06-08` game's tipoff, `resolveActiveDate(today=06-08)` reads `nba_tracked_bets_2026-06-08.json` (absent) → `yesterday=06-07` (absent) → `readJsonSafe` returns `[]` → `skip_no_file` → 0 captured. The game's bets are in `nba_tracked_bets_2026-06-06.json`, which the loop never reads. This repeats every NBA slate.

The loop itself runs (server.js:19939 embeds `startBackgroundLoop`; MLB stamps through the same loop) — the defect is purely **which file** NBA reads.

**Root-cause class:** wrong-key / wrong-filter — file selected by today/yesterday slate date instead of the **game's** slate date. NBA-specific because NBA Finals bets are filed 1-2 days ahead (lean-bet) while MLB is a same-day daily slate.

---

## Secondary finding (lower priority)

42/887 (5%) join misses are **alt-line** markets: a bet like "points UNDER 1.5 `player_points_alternate`" has no matching odds in a snapshot that only carries the main `player_points` market. Even after the date fix, alt-line bets won't stamp unless the snapshot carries alt markets. Separate, minor — 95% would stamp once the file selection is fixed.

---

## Fix design (for the build phase — operator approval first)

**Site:** `captureClosingLines.js` — `resolveActiveDate` (L67) + its caller `runOnceForSport` (L251).
**Change:** make close-capture **game-date-driven**, not today/yesterday. Cleanest: load bets from a **window** of recent files and let `captureEligibility(in_window by gameTime)` pick the bets actually tipping now — decoupling capture from file naming entirely.
- Replace the single-file read with: union of `${sport}_tracked_bets_${d}.json` for `d` in `[today .. today-N]` (N≈5 covers the 1-2 day NBA offset with margin), dedup by bet `id`.
- `captureEligibility` already filters to in-window-by-gameTime, so widening the file set adds no false captures — only bets whose game is actually near tipoff get stamped.
- Keep MLB behavior identical (the window includes today, so MLB still captures same-day).

**Effort:** moderate, ~10-30 lines, one file. **Risk:** low (additive file union + the existing eligibility gate is the real filter). Optional follow: a one-time backfill for recent past NBA games (close odds for already-tipped games can't be recovered live — only future NBA slates will stamp going forward; backfill would need historical odds we may not have).

**Verification (build phase, bettor-fetch binding rule):**
- pre-edit: confirm `captureClosingLines:nba` reads the empty/wrong file (`skip_no_file`) for a slate whose bets are in an older file.
- post-edit: run capture against a real NBA slate window → non-zero NBA closeOdds stamped on the in-window bets; then `/api/ws/grades-health` NBA `clvStamped > 0` and the `/m` GRADES NBA card flips from "CLV capture pending" to a real "BEATING THE MARKET %". That FE flip is the gate-must-act-at-render proof.
- regression: MLB capture unchanged (same-day still stamps); runtime:verify 13/13.

---

*Audit complete, no code changed. The honest "CLV capture pending" label P2a shipped stays accurate until this build lands and NBA close odds actually stamp.*
