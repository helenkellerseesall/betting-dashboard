# Weekly Critic — 2026-09-06 (makeup run 2026-09-06)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+20278.0u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| longshot_tier | 1706 |
| non_preferred_book | 201 |
| dedupe_lost_to_better_price | 179 |
| repointed_served | 115 |
| unpurchasable_under | 25 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-9695.4u across 31230 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 8107 | 5.4% | +4975.4 | **-2693.6u** |
| hits | 7423 | 5.5% | +4695.4 | **-2322.6u** |
| rbis | 5833 | 5.0% | +3424.8 | **-2119.2u** |
| runs | 5041 | 7.2% | +4026.3 | **-652.7u** |
| hr | 3811 | 4.4% | +2216.5 | **-1425.5u** |
| ks | 1015 | 4.2% | +490.2 | **-481.8u** |

Watch segments (audit §3 — refused rows; epoch 19 artifact nights on disk):
- hr × market-toward: cumulative n=87, wins=8 (9.2%), NET +17.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.62 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=1479, wins=65 (4.4%), NET -666.9u · bar [n≥600: MET · NET>0: not met · Poisson LB90 0.46 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 2/88 outcomes (2.3%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-09-05: shown 2u/47 vs pool -2369.8u/4848 · 2026-09-04: shown 3.2u/41 vs pool -1786.5u/6068 · 2026-09-03: shown -10.7u/36 vs pool -2712.8u/4262 · 2026-09-02: shown 11.8u/62 vs pool -632.6u/5034 · 2026-09-01: shown 1.5u/45 vs pool -355.1u/5965 · 2026-08-31: shown -1.7u/29 vs pool -853.2u/3680 · 2026-08-30: shown 0.6u/21 vs pool -959.4u/2604

Line-freshness at serve: 84 price_drift · 2 suspended · 20 line_moved. Moved-line serves re-measured on graded twins: 0 measured (20 unmeasurable) → **+0.0u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
