# Weekly Critic — 2026-10-11 (makeup run 2026-10-11)

MONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **+2056.7u of winning rows never reached the served board.**

| gate | winners dropped |
|---|---|
| longshot_tier | 172 |
| dedupe_lost_to_better_price | 31 |
| non_preferred_book | 28 |
| repointed_served | 13 |
| unpurchasable_under | 3 |

Whole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **-2979.0u across 5132 refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.

| refused segment | n | win% | gross winner units | NET |
|---|---|---|---|---|
| totalBases | 1283 | 2.9% | +413.1 | **-832.9u** |
| hits | 1090 | 2.4% | +316.6 | **-747.4u** |
| runs | 1051 | 4.5% | +513.0 | **-491.0u** |
| rbis | 1022 | 3.8% | +453.8 | **-529.2u** |
| hr | 526 | 4.4% | +284.5 | **-218.5u** |
| ks | 160 | 0.0% | +0.0 | **-160.0u** |

Watch segments (audit §3 — refused rows; epoch 51 artifact nights on disk):
- hr × market-toward: cumulative n=87, wins=8 (9.2%), NET +17.0u · bar [n≥600: not met · NET>0: MET · Poisson LB90 0.62 ≥1.0: not met] → CLOSED (no gate change)
- ks × market-away: cumulative n=4506, wins=280 (6.2%), NET -963.4u · bar [n≥600: MET · NET>0: not met · Poisson LB90 0.72 ≥1.0: not met] → CLOSED (no gate change)

Ceiling audit: 0/0 outcomes (—%) exceeded the curves' 95th percentile — bar ≤7%.

Shown-vs-pool per night: 2026-10-10: shown 0u/0 vs pool -214u/239 · 2026-10-08: shown 0.4u/4 vs pool -182.4u/505 · 2026-10-07: shown -8.9u/18 vs pool -1565.8u/1974 · 2026-10-06: shown 1.6u/6 vs pool -320.7u/974 · 2026-10-05: shown -0.5u/9 vs pool -498.6u/958 · 2026-10-04: shown 0.4u/10 vs pool -261.7u/737

Line-freshness at serve: 197 price_drift · 71 suspended. Moved-line serves re-measured on graded twins: 0 measured (0 unmeasurable) → **+0.0u saved** vs serving the dead original line.

HONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.
