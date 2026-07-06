# GRADING RULES — locked settlement semantics for the durable bet record

**Status: DRAFT v1 (2026-07-05, CA) — becomes LOCKED on operator approval.**
Once locked, these rules only change by a new versioned revision (v2, v3...) applying to FUTURE bets. Settled rows are never regraded under new rules.

Every rule below was extracted from the actual grading code (gradeTrackedBets.js `settleFromActual`, fetchMlbGameResults.js, buildPersonalLedger.js settle paths) — this documents what the system DOES, with known divergences from book behavior flagged honestly.

## 1. Over/Under settlement (all O/U prop families)
- **over** wins if actual > line · **push** if actual == line · **loss** if actual < line.
- **under** is the mirror: wins if actual < line · push if == · loss if >.
- Half-point lines (e.g. 1.5) can never push. Integer lines can.
- Push = stake returned, P/L 0 (bankroll math applies no delta on push).
This matches standard sportsbook settlement for player props.

## 2. Binary props (HR to-hit style)
- side **yes / to hit / hit** with no line: win if count >= 1, else loss.
- side **no**: inverse.

## 3. Result vocabulary (canonical, closed set)
- **win / loss / push** — settled against official final stats.
- **void** — bet cancelled, stake returned, P/L 0. (See §5 — not yet automated.)
- **pending** — game not played yet, or player not found in results yet.
- **unresolved** — game data arrived but this stat couldn't be matched (retryable; excluded from win% and P/L until resolved).

## 4. Data source + timing
- Official final box scores (MLB StatsAPI via fetchMlbGameResults; NBA equivalent in season).
- Nightly grading at 4:00 AM ET (grading-nightly LaunchAgent); backfill retries cover late/postponed data.
- actualValue (what the player actually did) is written onto the graded row.

## 5. KNOWN DIVERGENCE — DNP / scratch / void (to fix before relying on auto-grade alone)
Books generally VOID a player prop when the player takes no part (pitcher doesn't start; batter gets no plate appearance — exact thresholds vary by book). Our auto-grader currently has NO void path: a scratched player either stays **pending** forever (not in results) or could grade an over as **loss** on a 0-stat appearance where the book refunds.
**Rule for real-money bets: the BOOK's actual settlement is authoritative for your P/L.** Until void detection is automated, any placed bet the book voided must be manually settled as void. (Gap handed to CB: manual settle/void CLI + automated scratch detection.)

## 6. Immutability + durability
- Grading skips already-settled rows (verified: `alreadySettled` guard) — a settled result is never overwritten by re-runs.
- Ledger merges preserve settled results (verified: merge keeps prev result/payout when incoming is pending).
- Placed bets (decisionType="placed" / realMoney=true) are NEVER pruned from the ledger (verified: partition protection).
- All writes are atomic (tmp file → rename).
- Model/selection changes (calibration, N1–G4, consensus rework) touch generation-side code only; they never rewrite settled rows.

## 7. Version stamping (the durability contract)
- Every selection-affecting change ships with a version stamp on new rows (calibVersion, selectionPolicy).
- Absence of a stamp = raw era (pre served-surface calibration). History is interpreted by its stamps, never rewritten.

## 8. CLV record semantics
- **open** = odds at slate build (openOdds, 100% coverage verified 07-04).
- **close** = latest observed pre-tip odds for the EXACT tuple (player+family+side+line+book), captured by a 5-min loop in a 180-min pre-tip window.
- **null close is honest**: market pulled or line moved past exact-tuple match = no close recorded, never fabricated. Current coverage ~42–55% of tracked rows (improvement queued: moved-line fallback with a clvQuality flag).
- CLV computed by canonical clvMath at capture time; mirrored onto the personal ledger (clvSnapshot.placed/close/clv).

## 9. Placement contract (v1, this week)
For a placed bet to auto-settle and auto-CLV, its tuple must MATCH a tracked row exactly:
- `--sport=mlb` explicitly (do NOT rely on the default),
- statFamily one of: **runs, hr, hits, ks, rbis, totalBases** (exact tokens),
- book one of: FanDuel, DraftKings, Fanatics, BetMGM, Hard Rock Bet, BetRivers (case-insensitive),
- same side + line as the board pick.
Bets outside the board (alt lines, other markets) will NOT auto-settle in v1 — manual settle required. Betting the board's picks exactly is the v1 workflow.
