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

- Rows: **11** total · 0 decided · 0 push · 11 pending · 0 unresolved
- Model avg: **48.9%** · Implied avg: 32.8% · Edge avg: 16.07%
- **No decided bets yet** — predictions exist but none have been graded. Calibration unknown.

### MLB — Pitcher Strikeouts

- Rows: **27** total · 11 decided · 0 push · 16 pending · 0 unresolved
- Model avg: **50.4%** · Implied avg: 44.3% · Edge avg: 6.11%
- Hit rate: **27.3%** (3W/8L) · Model said 50.4% → overconfident by 23.2pp
- Brier: 0.2564 · ROI @ 1u: **-37.1%**
- ⚠️  Sample size: 11 decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.

### MLB — Batter Hits

- Rows: **385** total · 65 decided · 0 push · 320 pending · 0 unresolved
- Model avg: **54.9%** · Implied avg: 45.8% · Edge avg: 9.06%
- Hit rate: **58.5%** (38W/27L) · Model said 54.9% → underconfident by 3.6pp
- Brier: 0.2398 · ROI @ 1u: **+22.2%**

### NBA — Player Points

- Rows: **547** total · 122 decided · 0 push · 425 pending · 0 unresolved
- Model avg: **48.5%** · Implied avg: 35.0% · Edge avg: 13.54%
- Hit rate: **40.2%** (49W/73L) · Model said 48.5% → overconfident by 8.3pp
- Brier: 0.2451 · ROI @ 1u: **+15.5%**

### NBA — PRA

- Rows: **42** total · 0 decided · 0 push · 30 pending · 12 unresolved
- Model avg: **48.8%** · Implied avg: 33.6% · Edge avg: 15.26%
- **No decided bets yet** — predictions exist but none have been graded. Calibration unknown.

### NBA — First Basket

**NO DATA.** The pipeline is not currently writing predictions for this prop into `tracked_bets`. This lane is blocked until the capture path is fixed.


---

## Secondary props (not committed lanes, tracked for context)

### MLB — Total Bases

- Rows: **470** total · 159 decided · 0 push · 311 pending · 0 unresolved
- Model avg: **67.9%** · Implied avg: 56.3% · Edge avg: 11.52%
- Hit rate: **66.0%** (105W/54L) · Model said 67.9% → calibrated (within 2pp)
- Brier: 0.2244 · ROI @ 1u: **+16.7%**

### MLB — Runs Scored

- Rows: **186** total · 68 decided · 0 push · 118 pending · 0 unresolved
- Model avg: **60.6%** · Implied avg: 51.2% · Edge avg: 9.35%
- Hit rate: **64.7%** (44W/24L) · Model said 60.6% → underconfident by 4.1pp
- Brier: 0.2260 · ROI @ 1u: **+23.2%**

### MLB — RBIs

- Rows: **61** total · 32 decided · 0 push · 29 pending · 0 unresolved
- Model avg: **53.0%** · Implied avg: 45.9% · Edge avg: 7.09%
- Hit rate: **59.4%** (19W/13L) · Model said 53.0% → underconfident by 6.4pp
- Brier: 0.1743 · ROI @ 1u: **+20.2%**

### MLB — Pitcher Outs

- Rows: **148** total · 39 decided · 0 push · 109 pending · 0 unresolved
- Model avg: **54.8%** · Implied avg: 46.7% · Edge avg: 8.08%
- Hit rate: **15.4%** (6W/33L) · Model said 54.8% → overconfident by 39.4pp
- Brier: 0.2737 · ROI @ 1u: **-67.4%**

### MLB — Pitcher Walks

- Rows: **34** total · 0 decided · 0 push · 23 pending · 11 unresolved
- Model avg: **50.5%** · Implied avg: 41.4% · Edge avg: 9.11%
- **No decided bets yet** — predictions exist but none have been graded. Calibration unknown.

### MLB — Earned Runs

- Rows: **1** total · 0 decided · 0 push · 1 pending · 0 unresolved
- Model avg: **53.6%** · Implied avg: 47.4% · Edge avg: 6.18%
- **No decided bets yet** — predictions exist but none have been graded. Calibration unknown.

### NBA — Rebounds

- Rows: **88** total · 11 decided · 0 push · 77 pending · 0 unresolved
- Model avg: **48.9%** · Implied avg: 34.3% · Edge avg: 14.59%
- Hit rate: **27.3%** (3W/8L) · Model said 48.9% → overconfident by 21.6pp
- Brier: 0.2448 · ROI @ 1u: **-14.1%**
- ⚠️  Sample size: 11 decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.

### NBA — Assists

- Rows: **57** total · 7 decided · 0 push · 50 pending · 0 unresolved
- Model avg: **50.8%** · Implied avg: 37.1% · Edge avg: 13.68%
- Hit rate: **14.3%** (1W/6L) · Model said 50.8% → overconfident by 36.5pp
- Brier: 0.2642 · ROI @ 1u: **-64.6%**
- ⚠️  Sample size: 7 decided bets. Need ≥30 for trustworthy calibration claims, ≥50 for Brier comparisons.

