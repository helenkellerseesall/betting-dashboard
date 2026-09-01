# Weekly Critic — 2026-08-30 (makeup run 2026-08-30)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+10751.4u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| longshot_tier | 887 |
| non_preferred_book | 97 |
| dedupe_lost_to_better_price | 86 |
| repointed_served | 58 |
| unpurchasable_under | 15 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-7396.2u across 18819 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 5163 | 4.8% | +2827.1 | **-2085.9u** |
| hits | 4295 | 3.7% | +1904.0 | **-2232.0u** |
| runs | 3414 | 5.4% | +2049.5 | **-1180.5u** |
| rbis | 3243 | 5.6% | +2197.5 | **-865.5u** |
| hr | 2179 | 4.8% | +1444.5 | **-630.5u** |
| ks | 525 | 1.9% | +113.2 | **-401.8u** |

Watch segments (audit §3 — refused rows; epoch 12 artifact nights on disk):
- hr × market-toward: cumulative n=87, wins=8 (9.2%), NET +17.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.62 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=507, wins=22 (4.3%), NET -228.1u · bar [n≥600: not met · NET>0: not met · Poisson LB90 0.39 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 32/901 outcomes (3.6%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-08-29: shown -5.2u/27 vs pool -1243.4u/2409 · 2026-08-28: shown -4.7u/32 vs pool -1453.7u/4043 · 2026-08-27: shown 6.4u/18 vs pool -933.5u/2653 · 2026-08-26: shown -7u/36 vs pool -970.9u/3555 · 2026-08-24: shown 0.6u/1 vs pool -330.7u/675 · 2026-08-23: shown -7.6u/61 vs pool -2626.2u/6275

Line-freshness at serve: 53 price_drift · 10 suspended. Moved-line serves re-measured on graded twins: 0 measured (0 unmeasurable) → **+0.0u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
