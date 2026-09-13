# Weekly Critic — 2026-09-13 (makeup run 2026-09-13)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+21620.5u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| longshot_tier | 1813 |
| non_preferred_book | 196 |
| dedupe_lost_to_better_price | 144 |
| unpurchasable_under | 63 |
| repointed_served | 62 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-9014.2u across 32024 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 8656 | 5.9% | +5749.1 | **-2399.9u** |
| hits | 7450 | 5.4% | +4970.2 | **-2074.8u** |
| runs | 5646 | 6.4% | +3986.2 | **-1296.8u** |
| rbis | 5109 | 6.0% | +3637.8 | **-1162.2u** |
| hr | 4178 | 4.1% | +2182.0 | **-1825.0u** |
| ks | 985 | 5.9% | +671.5 | **-255.5u** |

Watch segments (audit §3 — refused rows; epoch 26 artifact nights on disk):
- hr × market-toward: cumulative n=87, wins=8 (9.2%), NET +17.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.62 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=2464, wins=123 (5.0%), NET -922.4u · bar [n≥600: MET · NET>0: not met · Poisson LB90 0.56 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 0/0 outcomes (—%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-09-12: shown 0.4u/42 vs pool -147.2u/4604 · 2026-09-11: shown 3.6u/44 vs pool -347.8u/6238 · 2026-09-10: shown -3.3u/23 vs pool -1044.7u/2251 · 2026-09-09: shown 0.3u/45 vs pool -1280.9u/4735 · 2026-09-08: shown -10.1u/45 vs pool -2798.3u/5636 · 2026-09-07: shown -8.5u/24 vs pool -1485u/4731 · 2026-09-06: shown -4.3u/45 vs pool -1968.5u/5022

Line-freshness at serve: 11 suspended · 108 price_drift · 13 line_moved. Moved-line serves re-measured on graded twins: 0 measured (13 unmeasurable) → **+0.0u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
