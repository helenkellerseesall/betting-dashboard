# Weekly Critic — 2026-09-20 (makeup run 2026-09-20)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+21045.9u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| longshot_tier | 1773 |
| non_preferred_book | 157 |
| dedupe_lost_to_better_price | 131 |
| repointed_served | 85 |
| unpurchasable_under | 24 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-9473.7u across 31942 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 8325 | 5.5% | +5154.7 | **-2715.3u** |
| hits | 8020 | 5.2% | +4906.0 | **-2694.0u** |
| runs | 5373 | 6.4% | +3758.5 | **-1270.5u** |
| rbis | 5300 | 5.7% | +3536.3 | **-1462.7u** |
| hr | 3984 | 4.7% | +2515.5 | **-1282.5u** |
| ks | 940 | 7.1% | +824.3 | **-48.7u** |

Watch segments (audit §3 — refused rows; epoch 33 artifact nights on disk):
- hr × market-toward: cumulative n=87, wins=8 (9.2%), NET +17.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.62 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=3404, wins=190 (5.6%), NET -971.1u · bar [n≥600: MET · NET>0: not met · Poisson LB90 0.64 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 0/0 outcomes (—%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-09-19: shown 0.2u/54 vs pool -511.1u/5884 · 2026-09-18: shown -5u/37 vs pool -1357.7u/5954 · 2026-09-17: shown -6.1u/20 vs pool -1323.9u/3024 · 2026-09-16: shown -11.4u/42 vs pool -1946.8u/5121 · 2026-09-15: shown -2.7u/37 vs pool -2060.7u/4968 · 2026-09-14: shown 7.9u/30 vs pool -1587.2u/3741 · 2026-09-13: shown 1.9u/30 vs pool -766.8u/4313

Line-freshness at serve: 145 price_drift · 4 suspended. Moved-line serves re-measured on graded twins: 0 measured (0 unmeasurable) → **+0.0u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
