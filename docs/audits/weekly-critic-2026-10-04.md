# Weekly Critic — 2026-10-04 (makeup run 2026-10-04)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+2374.0u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| longshot_tier | 201 |
| non_preferred_book | 28 |
| dedupe_lost_to_better_price | 20 |
| repointed_served | 14 |
| unpurchasable_under | 3 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-4228.0u across 6739 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 1747 | 3.3% | +679.4 | **-1009.6u** |
| hits | 1555 | 1.7% | +327.5 | **-1200.5u** |
| rbis | 1346 | 2.4% | +354.1 | **-959.9u** |
| runs | 1143 | 4.5% | +567.8 | **-523.2u** |
| hr | 795 | 3.8% | +362.5 | **-402.5u** |
| ks | 153 | 1.3% | +18.7 | **-132.3u** |

Watch segments (audit §3 — refused rows; epoch 45 artifact nights on disk):
- hr × market-toward: cumulative n=87, wins=8 (9.2%), NET +17.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.62 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=4346, wins=280 (6.4%), NET -803.4u · bar [n≥600: MET · NET>0: not met · Poisson LB90 0.75 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 0/0 outcomes (—%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-10-03: shown -3.2u/18 vs pool -1869.3u/2122 · 2026-10-01: shown -3u/3 vs pool -558.2u/709 · 2026-09-30: shown 0u/2 vs pool -177.9u/195 · 2026-09-29: shown 2.4u/4 vs pool -303.2u/1212 · 2026-09-27: shown -2.6u/29 vs pool -1334.8u/2695

Line-freshness at serve: 57 price_drift · 12 suspended. Moved-line serves re-measured on graded twins: 0 measured (0 unmeasurable) → **+0.0u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
