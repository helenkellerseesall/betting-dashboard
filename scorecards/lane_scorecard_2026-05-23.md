# Lane Scoreboard — 2026-05-23

Window: last 60 days

**What this measures.** For each prop the model has surfaced into `tracked_bets`, this scorecard answers: did the model's probability prediction match the actual hit rate?

- **modelAvg**: average model probability across all surfaced rows
- **hitRate**: actual win rate among decided (settled, non-push) bets
- **calibrationDelta** = modelAvg − hitRate. Positive = model overconfident. Negative = underconfident. Near zero = calibrated.
- **Brier**: mean squared error of probability vs outcome. Lower is better. Coin flip ≈ 0.25, perfect ≈ 0.
- **ROI @ 1u**: hypothetical return on a 1-unit flat stake on every surfaced row. Positive = +EV in practice.

---

## The 7 lanes

### MLB — Home Runs

**NO DATA.** The pipeline is not currently writing predictions for this prop into `tracked_bets`. This lane is blocked until the capture path is fixed.

### NBA — 3-Pointers Made

- Rows: **11** total · 7 decided · 0 push · 4 pending · 0 unresolved
- Model avg: **48.9%** · Implied avg: 32.8% · Edge avg: 16.07%
- Hit rate: **100.0%** (7W/0L) · Model said 48.9% → underconfident by 51.1pp
- Brier: 0.2617 · ROI @ 1u: **+175.9%**
- ⚠️  Sample size: 7 decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.

### MLB — Pitcher Strikeouts

- Rows: **27** total · 25 decided · 0 push · 2 pending · 0 unresolved
- Model avg: **50.4%** · Implied avg: 44.3% · Edge avg: 6.11%
- Hit rate: **40.0%** (10W/15L) · Model said 50.4% → overconfident by 10.4pp
- Brier: 0.2471 · ROI @ 1u: **-10.8%**
- ⚠️  Sample size: 25 decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.

### MLB — Batter Hits

- Rows: **385** total · 350 decided · 0 push · 35 pending · 0 unresolved
- Model avg: **54.9%** · Implied avg: 45.8% · Edge avg: 9.06%
- Hit rate: **49.4%** (173W/177L) · Model said 54.9% → overconfident by 5.4pp
- Brier: 0.2529 · ROI @ 1u: **+8.4%**

### NBA — Player Points

- Rows: **547** total · 362 decided · 0 push · 185 pending · 0 unresolved
- Model avg: **48.5%** · Implied avg: 35.0% · Edge avg: 13.54%
- Hit rate: **35.1%** (127W/235L) · Model said 48.5% → overconfident by 13.4pp
- Brier: 0.2465 · ROI @ 1u: **+2.7%**

### NBA — PRA

- Rows: **42** total · 24 decided · 0 push · 18 pending · 0 unresolved
- Model avg: **48.8%** · Implied avg: 33.6% · Edge avg: 15.26%
- Hit rate: **0.0%** (0W/24L) · Model said 48.8% → overconfident by 48.8pp
- Brier: 0.2386 · ROI @ 1u: **-100.0%**
- ⚠️  Sample size: 24 decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.

### NBA — First Basket

**NO DATA.** The pipeline is not currently writing predictions for this prop into `tracked_bets`. This lane is blocked until the capture path is fixed.


---

## Secondary props (not committed lanes, tracked for context)

### MLB — Total Bases

- Rows: **470** total · 411 decided · 0 push · 59 pending · 0 unresolved
- Model avg: **67.9%** · Implied avg: 56.3% · Edge avg: 11.52%
- Hit rate: **64.2%** (264W/147L) · Model said 67.9% → overconfident by 3.6pp
- Brier: 0.2307 · ROI @ 1u: **+12.8%**

### MLB — Runs Scored

- Rows: **186** total · 166 decided · 0 push · 20 pending · 0 unresolved
- Model avg: **60.6%** · Implied avg: 51.2% · Edge avg: 9.35%
- Hit rate: **48.8%** (81W/85L) · Model said 60.6% → overconfident by 11.8pp
- Brier: 0.2542 · ROI @ 1u: **-5.8%**

### MLB — RBIs

- Rows: **61** total · 56 decided · 0 push · 5 pending · 0 unresolved
- Model avg: **53.0%** · Implied avg: 45.9% · Edge avg: 7.09%
- Hit rate: **41.1%** (23W/33L) · Model said 53.0% → overconfident by 11.9pp
- Brier: 0.2144 · ROI @ 1u: **-19.7%**

### MLB — Pitcher Outs

- Rows: **148** total · 128 decided · 0 push · 20 pending · 0 unresolved
- Model avg: **54.8%** · Implied avg: 46.7% · Edge avg: 8.08%
- Hit rate: **37.5%** (48W/80L) · Model said 54.8% → overconfident by 17.3pp
- Brier: 0.2640 · ROI @ 1u: **-19.3%**

### MLB — Pitcher Walks

- Rows: **34** total · 0 decided · 0 push · 3 pending · 31 unresolved
- Model avg: **50.5%** · Implied avg: 41.4% · Edge avg: 9.11%
- **No decided bets yet** — predictions exist but none have been graded. Calibration unknown.

### MLB — Earned Runs

- Rows: **1** total · 1 decided · 0 push · 0 pending · 0 unresolved
- Model avg: **53.6%** · Implied avg: 47.4% · Edge avg: 6.18%
- Hit rate: **0.0%** (0W/1L) · Model said 53.6% → overconfident by 53.6pp
- Brier: 0.2870 · ROI @ 1u: **-100.0%**
- ⚠️  Sample size: 1 decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.

### NBA — Rebounds

- Rows: **88** total · 62 decided · 0 push · 26 pending · 0 unresolved
- Model avg: **48.9%** · Implied avg: 34.3% · Edge avg: 14.59%
- Hit rate: **21.0%** (13W/49L) · Model said 48.9% → overconfident by 27.9pp
- Brier: 0.2429 · ROI @ 1u: **-37.4%**

### NBA — Assists

- Rows: **57** total · 27 decided · 0 push · 30 pending · 0 unresolved
- Model avg: **50.8%** · Implied avg: 37.1% · Edge avg: 13.68%
- Hit rate: **59.3%** (16W/11L) · Model said 50.8% → underconfident by 8.5pp
- Brier: 0.2428 · ROI @ 1u: **+72.3%**
- ⚠️  Sample size: 27 decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.

