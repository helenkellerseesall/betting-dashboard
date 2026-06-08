# Step-1 Trust Proof — vig-aware realized hit% by family × tier

**Date:** 2026-06-08 ET · **Author:** Claude-B (4.8) · **Type:** read-only, no code, zero bettor delta
**Operator question (Step-1):** "can I believe every top pick is bettable?" — answered as realized-hit-rate-vs-vig-stripped-fair, sliced by tier, on the families actually surfaced.
**Method:** canonical F1.1 read (`.scratch/probe_f11_deduped_vig.js` lineage) via PRESERVED `vigStripping.js`. Dedup key `player|family|side|line|slateDate` (book excluded). Corpus: `mlb_tracked_bets_*.json`, 10 slate-days (2026-05-28 → 06-07), 8,870 settled rows → 3,835 deduped graded picks, 0 outcome-collisions. Probe: `.scratch/probe_step1_trust.js/.txt`.

**Two caveats up front (honest):**
1. **Vig recovery 0.4%** (16/3,835 keys have both sides in corpus). The other 99.6% use raw-implied (with-vig) fallback. Direction (F1.1): raw-implied > fair, so the edges below are **PESSIMISTIC** — true vig-stripped edges are **≈1–3pp LESS negative** than shown.
2. This proves **calibration** (does realized ≈ stated/priced), not future edge. 10-day window is short.

---

## PHASE A — the board's "top picks" (surfaced batter families)

| family | tier | n(graded) | hit% | fair-impl% | edge(pp) | note |
|---|---|---|---|---|---|---|
| hits | ELITE | **1** | 100.0 | 55.3 | +44.7 | INSUFFICIENT-N |
| hits | STRONG | **8** | 12.5 | 48.7 | −36.2 | INSUFFICIENT-N |
| hits | PLAYABLE | 138 | 46.4 | 45.9 | **+0.5** | ✅ sufficient |
| hits | LONGSHOT | 881 | 5.0 | 6.9 | −1.9 | milestone rungs |
| total_bases | ELITE | **16** | 56.3 | 55.9 | +0.4 | INSUFFICIENT-N |
| total_bases | STRONG | **26** | 53.8 | 57.3 | −3.5 | INSUFFICIENT-N |
| total_bases | PLAYABLE | 74 | 54.1 | 51.8 | **+2.2** | ✅ sufficient |
| total_bases | LONGSHOT | 1154 | 4.7 | 7.7 | −3.0 | milestone rungs |
| rbis | PLAYABLE | 28 | 21.4 | 33.8 | −12.3 | INSUFFICIENT-N |
| rbis | LONGSHOT | 575 | 3.7 | 7.5 | −3.8 | milestone rungs |
| hr | ELITE | **13** | 7.7 | 11.8 | −4.1 | INSUFFICIENT-N |
| hr | STRONG | 102 | 9.8 | 14.4 | **−4.6** | ✅ sufficient |
| hr | PLAYABLE | 41 | 17.1 | 16.8 | +0.2 | ✅ sufficient |
| hr | LONGSHOT | 114 | 2.6 | 8.0 | −5.3 | milestone rungs |

**What this says about Step-1 (honest):**

- **The anchor tiers — ELITE and STRONG, the labels that mean "top pick" — are almost all too thin to certify.** hits ELITE n=1, STRONG n=8; total_bases ELITE n=16, STRONG n=26; hr ELITE n=13; rbis has NO ELITE/STRONG picks at all. Only **hr STRONG (n=102)** clears n≥30 among anchor tiers, and it's **−4.6pp** (≈−2 to −4pp after the vig caveat) — i.e. mildly losing.
- **The only clearly trustworthy (sufficient-n, positive) cells are PLAYABLE hits (+0.5 → ~+2–3 true) and PLAYABLE total_bases (+2.2 → ~+4–5 true).** Those are the cells the operator can lean on today.
- **The board's VOLUME is LONGSHOT milestone rungs** (881 + 1154 + 575 + 114 = 2,724 of 3,835 = 71%), and every LONGSHOT cell is negative (−1.9 to −5.3pp, ≈−0 to −3pp after caveat). They roughly pay out the vig — fine as milestone-ladder lottery rungs, not as "edges."
- **rbis is the weak family**: no anchor-tier picks, PLAYABLE −12.3pp, LONGSHOT −3.8pp.

**Step-1 verdict (PHASE A): NOT YET PROVABLE as written.** The board cannot today certify that its "top picks" beat the vig, because the ELITE/STRONG labels rest on <30 graded samples each (except hr STRONG, which is mildly negative). The genuinely trustworthy core is narrow: **PLAYABLE hits + total_bases**. This is not a failure — it's the honest state at a 10-day sample. It says trust should currently be placed in those two cells, and the high-tier badges need more graded volume before they mean "proven."

---

## PHASE B — pitcher strikeouts: surfacing verdict

| family | tier | n(graded) | hit% | fair-impl% | edge(pp) | note |
|---|---|---|---|---|---|---|
| ks | ELITE | **8** | 12.5 | 52.2 | −39.7 | INSUFFICIENT-N |
| ks | STRONG | **18** | 38.9 | 54.0 | −15.1 | INSUFFICIENT-N |
| ks | PLAYABLE | 37 | 37.8 | 46.8 | **−9.0** | ✅ sufficient |
| ks | LONGSHOT | 93 | 3.2 | 7.3 | −4.1 | milestone rungs |

**Comparison at the only commensurable sufficient tier (PLAYABLE):** ks **−9.0pp** vs hits **+0.5pp** / total_bases **+2.2pp**. Even after the +1–3pp vig caveat (ks → ~−6 to −8pp), strikeouts are **clearly negative and clearly worse than the surfaced batter families.** The ks anchor tiers (ELITE n=8 −39.7, STRONG n=18 −15.1) are both INSUFFICIENT-N **and** deeply negative in the small sample.

**VERDICT: FORK (b) — HOLD. Do NOT surface pitcher strikeouts on the board.** Ks underperform the batter families at every commensurable tier and are negative across the board. Surfacing them now would add a mildly −EV market to the "top picks" surface, violating "every top pick believable." `mlb_ks_board_surface_scope.md` (Option B) stays **PARKED** — built-ready behind the kill-switch, but not shipped. Re-run this read after ~14 more graded days; if ks PLAYABLE/STRONG climb to parity with batter PLAYABLE, revisit.

(The vig-aware read EARNED its place here: the raw instinct was to surface Ks; the data says hold.)

---

## PHASE C — approved defect batch (next ships, NOT this turn)

Operator approved these as the next batch after this read; named here so they're not lost (each a SEPARATE regression-gated ship):

1. **Dead `sportConfig.nba`** — no live NBA path reads it (drift trap; editing it no-ops). Confirm + propose remove-or-guard.
2. **`batter_stolen_bases` classification drop** — `resolveStatFamily` → null; returns 115 rows/slate but never classified. Enable the family.
3. **`nrfi`/`yrfi` wrong vendor key** — stripped as "invalid markets" every slate; find the correct Odds API first-inning-run market key (investigate, don't assume).

---

## Bottom line for the operator (plain)

Right now the only MLB picks the data can vouch for as beating the juice are **PLAYABLE-tier hits and total bases**. The flashy ELITE/STRONG badges don't yet have enough settled picks behind them to prove anything, and the bulk of the board is longshot milestone rungs that just pay back the vig. **Pitcher strikeouts: hold** — they're measurably worse than the batter picks, so we're not putting them on your board. Best lever for real Step-1 trust: accumulate more graded slates so the high-tier cells get provable, and keep weighting toward the two cells that already check out.
