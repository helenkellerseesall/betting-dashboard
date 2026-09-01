# Weekly Critic — 2026-08-23 (makeup run 2026-08-26)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+24950.8u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| longshot_tier | 2101 |
| non_preferred_book | 243 |
| dedupe_lost_to_better_price | 221 |
| repointed_served | 145 |
| unpurchasable_under | 58 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-13574.5u across 40067 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 11177 | 5.5% | +6911.3 | **-3650.7u** |
| hits | 9158 | 5.7% | +6277.9 | **-2358.1u** |
| rbis | 7266 | 4.6% | +3898.6 | **-3031.4u** |
| runs | 7137 | 5.2% | +4015.6 | **-2753.4u** |
| hr | 4050 | 4.3% | +2319.5 | **-1555.5u** |
| ks | 1279 | 6.6% | +968.6 | **-225.4u** |

Watch segments (audit §3 — refused rows; epoch 8 artifact nights on disk):
- hr × market-toward: cumulative n=81, wins=7 (8.6%), NET +10.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.55 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=259, wins=14 (5.4%), NET -82.1u · bar [n≥600: not met · NET>0: not met · Poisson LB90 0.43 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 150/5188 outcomes (2.9%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-08-22: shown -7.1u/57 vs pool -2523u/7346 · 2026-08-21: shown -7.7u/48 vs pool -3067.5u/8097 · 2026-08-20: shown -4.9u/26 vs pool -823.8u/4173 · 2026-08-19: shown -6.2u/39 vs pool -2714.4u/7538 · 2026-08-18: shown -21u/41 vs pool -2767.2u/7621 · 2026-08-17: shown -14.8u/38 vs pool -1403.9u/4983 · 2026-08-16: shown 1.3u/18 vs pool -541.8u/2009

Line-freshness at serve: 51 suspended · 252 price_drift · 3 line_moved. Moved-line serves re-measured on graded twins: 0 measured (3 unmeasurable) → **+0.0u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
