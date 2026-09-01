# G2-L2 Walk-Forward Validation Report — 2026-08-26

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-08-25) + 39 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 1.0pp | 0.08699 | 825016 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (128823 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 28881 | 1.0% | 0.6% | 0.3pp | yes |
| 2-5% | 18722 | 3.2% | 2.5% | 0.7pp | yes |
| 5-10% | 17179 | 7.2% | 6.2% | 1.1pp | yes |
| 10-20% | 16208 | 14.7% | 14.7% | 0.1pp | yes |
| 20-35% | 16875 | 26.1% | 25.1% | 0.9pp | yes |
| 35-50% | 9479 | 43.5% | 46.7% | 3.2pp | yes |
| 50-100% | 21479 | 59.8% | 60.8% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=8258 gap 0.5pp · 2-5% n=4590 gap 0.7pp · 5-10% n=4229 gap 1.4pp · 10-20% n=3926 gap 0.5pp · 20-35% n=4079 gap 1.6pp · 35-50% n=2321 gap 0.8pp · 50-100% n=5307 gap 0.2pp

### totalBases — **PASS** (240900 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 47316 | 1.1% | 1.4% | 0.2pp | yes |
| 2-5% | 46519 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 35800 | 7.2% | 8.6% | 1.4pp | yes |
| 10-20% | 36108 | 14.4% | 16.2% | 1.8pp | yes |
| 20-35% | 29514 | 26.7% | 26.8% | 0.1pp | yes |
| 35-50% | 19627 | 42.0% | 40.1% | 1.9pp | yes |
| 50-100% | 26016 | 62.9% | 58.5% | 4.4pp | yes |

Last-30d slice (reporting only): 0-2% n=13730 gap 0.2pp · 2-5% n=11655 gap 0.1pp · 5-10% n=8915 gap 0.4pp · 10-20% n=8994 gap 0.7pp · 20-35% n=7334 gap 1.6pp · 35-50% n=5072 gap 3.8pp · 50-100% n=6307 gap 5.4pp

### rbis — **PASS_WITH_CORRECTION** (135298 walk-forward pairs)
raw curve STOP (2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 35-50% gap 8.0pp n=7963; 50-100% gap 19.2pp n=374) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 46491 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 25332 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 19211 | 7.2% | 8.2% | 0.9pp | yes |
| 10-20% | 17212 | 14.1% | 14.6% | 0.5pp | yes |
| 20-35% | 18715 | 27.5% | 26.7% | 0.8pp | yes |
| 35-50% | 7963 | 39.9% | 31.9% | 8.0pp | yes |
| 50-100% | 374 | 53.2% | 34.0% | 19.2pp | yes |

Last-30d slice (reporting only): 0-2% n=12791 gap 0.0pp · 2-5% n=6290 gap 0.0pp · 5-10% n=4903 gap 0.5pp · 10-20% n=4037 gap 0.8pp · 20-35% n=4885 gap 1.5pp · 35-50% n=1766 gap 7.7pp · 50-100% n=25 gap 20.6pp

### runs — **PASS** (107669 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 34835 | 0.8% | 0.8% | 0.1pp | yes |
| 2-5% | 15847 | 3.3% | 2.9% | 0.3pp | yes |
| 5-10% | 15106 | 7.2% | 6.7% | 0.6pp | yes |
| 10-20% | 11552 | 13.7% | 13.6% | 0.1pp | yes |
| 20-35% | 15103 | 28.3% | 30.9% | 2.5pp | yes |
| 35-50% | 13658 | 41.3% | 39.8% | 1.5pp | yes |
| 50-100% | 1568 | 53.5% | 45.5% | 8.0pp | yes |

Last-30d slice (reporting only): 0-2% n=9527 gap 0.2pp · 2-5% n=3880 gap 1.2pp · 5-10% n=3684 gap 1.0pp · 10-20% n=2757 gap 0.6pp · 20-35% n=3714 gap 0.5pp · 35-50% n=3528 gap 2.4pp · 50-100% n=246 gap 5.0pp

### ks — **PASS** (27803 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 853 | 1.3% | 1.3% | 0.0pp | yes |
| 2-5% | 2202 | 3.5% | 3.4% | 0.1pp | yes |
| 5-10% | 2900 | 7.3% | 7.3% | 0.0pp | yes |
| 10-20% | 3627 | 14.5% | 14.3% | 0.3pp | yes |
| 20-35% | 3475 | 27.2% | 28.6% | 1.4pp | yes |
| 35-50% | 2714 | 42.1% | 41.8% | 0.3pp | yes |
| 50-100% | 12032 | 81.2% | 81.5% | 0.3pp | yes |

Last-30d slice (reporting only): 0-2% n=386 gap 0.2pp · 2-5% n=818 gap 0.5pp · 5-10% n=893 gap 0.2pp · 10-20% n=1110 gap 0.3pp · 20-35% n=1017 gap 0.8pp · 35-50% n=811 gap 3.1pp · 50-100% n=3637 gap 1.1pp

### stolenBases — **STOP** (61455 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.5pp n=1415

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 37850 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 9473 | 3.5% | 3.4% | 0.0pp | yes |
| 5-10% | 6809 | 7.3% | 6.6% | 0.7pp | yes |
| 10-20% | 5870 | 14.0% | 11.9% | 2.0pp | yes |
| 20-35% | 1415 | 24.5% | 18.0% | 6.5pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10267 gap 0.4pp · 2-5% n=2375 gap 0.1pp · 5-10% n=1663 gap 0.5pp · 10-20% n=1347 gap 1.6pp · 20-35% n=297 gap 7.0pp

### doubles — **STOP** (77136 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.3pp n=6913; 20-35% gap 7.5pp n=4563

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 36668 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 10037 | 3.1% | 2.7% | 0.3pp | yes |
| 5-10% | 6913 | 7.7% | 11.1% | 3.3pp | yes |
| 10-20% | 18901 | 14.8% | 14.9% | 0.1pp | yes |
| 20-35% | 4563 | 23.1% | 15.5% | 7.5pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=9523 gap 0.1pp · 2-5% n=2318 gap 0.8pp · 5-10% n=1653 gap 2.6pp · 10-20% n=4835 gap 0.2pp · 20-35% n=967 gap 6.2pp

### triples — **STOP** (45932 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.9pp n=6686; 5-10% gap 4.2pp n=1391

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 37750 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 6686 | 3.4% | 1.5% | 1.9pp | yes |
| 5-10% | 1391 | 6.6% | 2.4% | 4.2pp | yes |
| 10-20% | 105 | 11.9% | 4.8% | 7.2pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10021 gap 0.3pp · 2-5% n=1560 gap 1.7pp · 5-10% n=360 gap 4.0pp · 10-20% n=15 gap 4.6pp

## Axis B — market-ladder scoreboard

1194796 captured rung rows across 39 file(s) → 165836 joined to curves · **150454 settled / 15382 pending** · 91206 disagreements scored (our Brier 0.1491 vs market 0.1466).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
