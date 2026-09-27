# Weekly Critic — 2026-09-27 (makeup run 2026-09-27)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+19029.6u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| longshot_tier | 1586 |
| non_preferred_book | 136 |
| dedupe_lost_to_better_price | 116 |
| repointed_served | 72 |
| unpurchasable_under | 28 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-8911.0u across 29201 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 7410 | 5.7% | +4817.3 | **-2170.7u** |
| hits | 6823 | 5.7% | +4772.6 | **-1658.4u** |
| rbis | 5733 | 4.1% | +2714.1 | **-2784.9u** |
| runs | 4826 | 5.6% | +2992.0 | **-1563.0u** |
| hr | 3620 | 4.9% | +2407.0 | **-1034.0u** |
| ks | 789 | 11.2% | +1001.0 | **+300.0u** |

Watch segments (audit §3 — refused rows; epoch 40 artifact nights on disk):
- hr × market-toward: cumulative n=87, wins=8 (9.2%), NET +17.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.62 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=4193, wins=278 (6.6%), NET -671.1u · bar [n≥600: MET · NET>0: not met · Poisson LB90 0.77 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 5/39 outcomes (12.8%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-09-26: shown 5u/26 vs pool -736.4u/4093 · 2026-09-25: shown -8.8u/26 vs pool -697.1u/4851 · 2026-09-24: shown -8.9u/32 vs pool -1463.9u/4060 · 2026-09-23: shown 2.4u/32 vs pool -2291.4u/5707 · 2026-09-22: shown -11.7u/49 vs pool -1747.3u/5209 · 2026-09-21: shown 1.7u/8 vs pool 182.6u/1225 · 2026-09-20: shown -6.4u/46 vs pool -2243.8u/5012

Line-freshness at serve: 54 price_drift · 3 suspended. Moved-line serves re-measured on graded twins: 0 measured (0 unmeasurable) → **+0.0u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
