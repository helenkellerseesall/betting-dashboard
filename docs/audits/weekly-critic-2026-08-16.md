# Weekly Critic — 2026-08-16 (makeup run 2026-08-17)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+28333.5u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| fade_tier | 1531 |
| longshot_tier | 823 |
| dedupe_lost_to_better_price | 327 |
| non_preferred_book | 324 |
| repointed_served | 244 |
| unpurchasable_under | 27 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-4458.5u across 14906 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 4128 | 5.6% | +2621.1 | **-1276.9u** |
| hits | 3325 | 7.4% | +2992.8 | **-85.2u** |
| rbis | 2763 | 5.1% | +1646.1 | **-975.9u** |
| runs | 2727 | 4.8% | +1395.4 | **-1201.6u** |
| hr | 1461 | 4.0% | +796.0 | **-607.0u** |
| ks | 502 | 3.4% | +173.1 | **-311.9u** |

Watch segments (audit §3 — refused rows; epoch 2 artifact nights on disk):
- hr × market-toward: cumulative n=15, wins=2 (13.3%), NET +9.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.15 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=73, wins=3 (4.1%), NET -40.8u · bar [n≥600: not met · NET>0: not met · Poisson LB90 0.13 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 184/5408 outcomes (3.4%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-08-15: shown -6.4u/57 vs pool -2217.8u/7846 · 2026-08-14: shown -9.6u/63 vs pool -2356.2u/7654 · 2026-08-13: shown -8u/41 vs pool -1284.6u/4569 · 2026-08-12: shown -12.9u/67 vs pool -2895.1u/7638 · 2026-08-11: shown -10.5u/71 vs pool -4667.7u/8363 · 2026-08-10: shown -7.1u/67 vs pool -1525.5u/6050 · 2026-08-09: shown 0.9u/73 vs pool -2313.2u/7135

Line-freshness at serve: 46 suspended · 1124 price_drift · 210 line_moved. Moved-line serves re-measured on graded twins: 6 measured (204 unmeasurable) → **+9.8u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
