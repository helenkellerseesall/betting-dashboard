# Grader Trust Audit — 2026-05-23

**Why:** Operator (2026-05-23) raised the right doubt: "this grader was made between you and gpt i still doubt the actual numbers are legit, i doubt we are pulling all the stats and info and prediction we still need to be on all the players, props, etc for the numbers and stats listed."

This document is the trust check. It does TWO things:

1. **Spot-check sample.** 10 recently-settled bets with their recorded actual values. Operator manually verifies 2-3 against box scores to confirm the numbers are real.
2. **Ingestion gap audit.** What stats the grader fetches vs what stat families exist in `tracked_bets`. Anything we surface that the grader can't settle is a hole — confirmed by the "unresolved" counts in the scoreboard.

---

## Part 1 — Spot-check sample (operator-verifiable)

Pick 2-3 of these and pull up the box score on MLB.com / ESPN. If our recorded `actualValue` matches the real stat, the grader is honest. If not, we have a fetch bug.

### MLB

| Date | Player | Game | Prop | Our verdict | Verify: |
|---|---|---|---|---|---|
| 2026-05-22 | Ketel Marte (ARZ) | COL @ ARZ | totalBases under 1.5 @ -125 (DK), ELITE, model 0.68 +12pp | **LOSS** · actualValue **2** | Marte's total bases on 5/22 should be ≥2 |
| 2026-05-22 | Connor Prielipp (MIN) | MIN @ BOS | outs over 15.5 @ +126 (DK), PLAYABLE, model 0.56 +12pp | **LOSS** · actualValue **12** | Prielipp's outs recorded on 5/22 should be 12 (4 IP) |
| 2026-05-22 | Chandler Simpson (TB) | TB @ NYY | hits under 0.5 @ +183 (DK), PLAYABLE, model 0.42 +7pp | **LOSS** · actualValue **2** | Simpson's hits on 5/22 should be ≥1 (we recorded 2) |
| 2026-05-22 | Fernando Tatis Jr. (SD) | OAK @ SD | runs under 0.5 @ -124 (DK), PLAYABLE, model 0.63 +8pp | **LOSS** · actualValue **2** | Tatis's runs scored on 5/22 should be ≥1 (we recorded 2) |
| 2026-05-21 | Michael Harris II (ATL) | ATL @ MIA | totalBases under 1.5 @ -120 (DK), ELITE, model 0.68 +13pp | **LOSS** · actualValue **8** | Harris's TB on 5/21 should be 8 (HUGE miss — under 1.5, he had 8) |

### NBA

| Date | Player | Prop | Our verdict | Verify: |
|---|---|---|---|---|
| 2026-05-22 | Ajay Mitchell (OKC?) | points over 16.5 @ +168 (FD), ELITE, model 0.48 +11pp | **LOSS** · actualValue **2** | Mitchell's points on 5/22 should be 2 (huge under) |
| 2026-05-21 | James Harden (LAC) | threes under 1.5 @ +188 (FD), ELITE, model 0.49 +14pp | **WIN** · actualValue **0** | Harden's threes made on 5/21 should be 0 or 1 (we recorded 0) |
| 2026-05-21 | Jarrett Allen (CLE) | points under 8.5 @ +225 (FD), ELITE, model 0.49 +18pp | **LOSS** · actualValue **13** | Allen's points on 5/21 should be 13 |
| 2026-05-21 | Max Strus (CLE) | rebounds under 3.5 @ +162 (FD), ELITE, model 0.49 +11pp | **LOSS** · actualValue **4** | Strus's rebounds on 5/21 should be 4 |
| 2026-05-17 | Evan Mobley (CLE) | assists over 4.5 @ +223 (DK), ELITE, model 0.51 +20pp | **WIN** · actualValue **6** | Mobley's assists on 5/17 should be 6 |

### What the sample tells us BEFORE manual verification

Even without verifying, this sample is a signal: **8 of 10 ELITE-tier picks are losses**, almost all on UNDER plays where the player blew past the line. Michael Harris totalBases under 1.5 → actual 8. Jarrett Allen points under 8.5 → actual 13. Ajay Mitchell points over 16.5 → actual 2.

The ELITE tier averaged 64-100% hit rate across the daily backfill output (see scoreboard). But the *most recent* 10 ELITEs sampled here are 2/10. Either: (a) ELITE has degraded recently, (b) my sample picked from worst days, or (c) the model is systematically picking UNDERS at exactly the wrong moments. The daily totals show this isn't yet a clear regime change (May 19 ELITE was 75%) but it's worth watching as more data lands.

This is why the trust audit matters. The aggregate ROI numbers hide what's actually happening in real time.

---

## Part 2 — Ingestion gap audit

### MLB grader (`fetchMlbGameResults.js`)

**Fetches from MLB Stats API boxscore endpoint:**

Batting: hits, hr, runs, rbis, totalBases, walks
Pitching: ks (strikeOuts), outs

**`getStatValue` handles:** ks, outs, hits, hr, runs, rbis, totalbases, walks

**Stat families captured in MLB tracked_bets (from scoreboard):** totalbases, runs, outs, rbis, hits, walks, ks, earnedruns

**GAPS FOUND:**

1. **`pitcher_walks` (31 unresolved)** — the `walks` handler returns `_batting.walks` (BB drawn by batter), but `pitcher_walks` in the markets means "BB allowed by pitcher." `extractPitching` only extracts ks and outs — it does NOT extract `pitching.baseOnBalls`. So 31 pitcher_walks rows can't ever settle until this is fixed.

2. **`pitcher_earned_runs` (1 row, unresolved)** — same shape. `extractPitching` doesn't extract `earnedRuns`.

3. **HR ingestion is functional** but capture-blocked (separate fix shipped earlier today via phase4Tracking.js).

### NBA grader (`fetchNbaGameResults.js`)

**Fetches from ESPN site.api.espn.com summary endpoint:**

rebounds, threes (parsed from "M-A" format), assists, points, blocks, steals

**`getNbaStatValue` handles:** rebounds, threes, assists, points, blocks, steals

**Stat families captured in NBA tracked_bets:** points, threes, assists, rebounds, pra

**GAPS FOUND:**

1. **`pra` (24 unresolved)** — `getNbaStatValue` has no `pra` case. PRA requires composing `points + rebounds + assists`, which the fetch already has. Composer needed in `getNbaStatValue`.

2. **Combo props (`points_rebounds`, `points_assists`, `rebounds_assists`)** — if these ever capture, they'd be unresolved too. No tracked_bets rows yet but the cognition might surface them.

3. **First Basket** — fundamentally different. Box score only knows total points; doesn't know WHO scored first. Requires play-by-play API (different ESPN endpoint). Lane 7 needs its own work.

4. **Double-Double / Triple-Double** — also no handler. Settle by: count categories where stat ≥ 10. Requires composer.

---

## Part 3 — Fixes shipping in this session

1. **MLB pitcher_walks + pitcher_earned_runs grader** — extend `extractPitching` to include `baseOnBalls` + `earnedRuns`, extend `getStatValue` to look them up under family aliases.
2. **NBA pra composer** — `getNbaStatValue` returns `(points + rebounds + assists)` for the "pra" family. Defends against any field being null.
3. **NBA combo props (pts+reb, pts+ast, reb+ast, double-double, triple-double)** — added defensively even though no current data, so future capture doesn't silently produce more unresolved rows.

After shipping, re-run backfill on MLB + NBA. Expected: 31 pitcher_walks + 24 pra unresolved rows convert to graded.

---

## Part 4 — What this audit does NOT verify

- **Model probability accuracy** — separate problem (Lane 5 audit covers NBA points; remaining lanes pending).
- **Player name normalization** — if a player's recorded name and ESPN's `displayName` don't normalize the same way, the player gets dropped at the `resultMap.get(normName(player))` step. We see this manifest as "pending" (player not found) rather than "unresolved" (player found, stat not extractable). Worth a separate audit pass — pick the rows that have been pending for >3 days and check whether the player exists in ESPN's box score under a slightly different name.
- **Two-way / multi-game day edge cases** — Ohtani plays both ways; tonight's grader merges batting + pitching for him. Doubleheaders are rare in current NBA and uncommon in MLB but the merge logic exists. Not tested in this audit.
- **Suspended / postponed games** — if a game is suspended in the 7th inning and resumed next day, the box score may show partial stats. The grader uses the eventual completed box-score so this is usually fine; partial-game grading isn't.

These are followups, not blockers for this ship.
