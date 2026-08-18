# G2-L2 Walk-Forward Validation Report — 2026-08-18

Read-only over season gamelog caches (565 batters, 266 pitchers, newest game 2026-08-17) + 33 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 1.0pp | 0.08741 | 777695 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (121559 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 27069 | 1.0% | 0.7% | 0.3pp | yes |
| 2-5% | 17672 | 3.2% | 2.5% | 0.7pp | yes |
| 5-10% | 16228 | 7.2% | 6.1% | 1.1pp | yes |
| 10-20% | 15342 | 14.7% | 14.7% | 0.1pp | yes |
| 20-35% | 15978 | 26.0% | 25.2% | 0.8pp | yes |
| 35-50% | 8967 | 43.5% | 46.9% | 3.4pp | yes |
| 50-100% | 20303 | 59.8% | 60.9% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=8870 gap 0.4pp · 2-5% n=4868 gap 0.6pp · 5-10% n=4468 gap 1.6pp · 10-20% n=4220 gap 0.5pp · 20-35% n=4389 gap 1.2pp · 35-50% n=2444 gap 1.1pp · 50-100% n=5654 gap 0.4pp

### totalBases — **PASS** (227054 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 44215 | 1.1% | 1.4% | 0.2pp | yes |
| 2-5% | 43886 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 33854 | 7.2% | 8.6% | 1.4pp | yes |
| 10-20% | 34067 | 14.4% | 16.3% | 1.9pp | yes |
| 20-35% | 27881 | 26.7% | 26.9% | 0.2pp | yes |
| 35-50% | 18500 | 42.0% | 40.4% | 1.6pp | yes |
| 50-100% | 24651 | 62.9% | 58.5% | 4.4pp | yes |

Last-30d slice (reporting only): 0-2% n=14459 gap 0.2pp · 2-5% n=12538 gap 0.1pp · 5-10% n=9604 gap 0.4pp · 10-20% n=9498 gap 0.7pp · 20-35% n=7870 gap 1.2pp · 35-50% n=5384 gap 2.7pp · 50-100% n=6751 gap 5.2pp

### rbis — **PASS_WITH_CORRECTION** (127555 walk-forward pairs)
raw curve STOP (1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 50-100% gap 19.1pp n=364) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 43601 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 23961 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 18083 | 7.2% | 8.3% | 1.0pp | yes |
| 10-20% | 16334 | 14.1% | 14.6% | 0.5pp | yes |
| 20-35% | 17599 | 27.5% | 26.8% | 0.7pp | yes |
| 35-50% | 7613 | 39.9% | 32.0% | 7.9pp | yes |
| 50-100% | 364 | 53.2% | 34.1% | 19.1pp | yes |

Last-30d slice (reporting only): 0-2% n=13539 gap 0.1pp · 2-5% n=6750 gap 0.1pp · 5-10% n=5220 gap 0.6pp · 10-20% n=4384 gap 1.1pp · 20-35% n=5147 gap 1.4pp · 35-50% n=1946 gap 7.1pp · 50-100% n=24 gap 19.2pp

### runs — **PASS** (101649 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 32751 | 0.8% | 0.8% | 0.1pp | yes |
| 2-5% | 14975 | 3.3% | 2.9% | 0.3pp | yes |
| 5-10% | 14275 | 7.2% | 6.7% | 0.6pp | yes |
| 10-20% | 10963 | 13.7% | 13.7% | 0.0pp | yes |
| 20-35% | 14276 | 28.3% | 30.9% | 2.6pp | yes |
| 35-50% | 12889 | 41.4% | 39.9% | 1.4pp | yes |
| 50-100% | 1520 | 53.6% | 45.6% | 8.0pp | yes |

Last-30d slice (reporting only): 0-2% n=10176 gap 0.2pp · 2-5% n=4089 gap 1.2pp · 5-10% n=3934 gap 1.3pp · 10-20% n=2979 gap 0.5pp · 20-35% n=3988 gap 0.6pp · 35-50% n=3740 gap 2.1pp · 50-100% n=276 gap 7.6pp

### ks — **PASS** (25809 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 766 | 1.3% | 1.3% | 0.0pp | yes |
| 2-5% | 1999 | 3.5% | 3.5% | 0.0pp | yes |
| 5-10% | 2691 | 7.3% | 7.2% | 0.1pp | yes |
| 10-20% | 3367 | 14.5% | 14.2% | 0.3pp | yes |
| 20-35% | 3248 | 27.2% | 28.8% | 1.6pp | yes |
| 35-50% | 2513 | 42.2% | 42.0% | 0.1pp | yes |
| 50-100% | 11225 | 81.2% | 81.6% | 0.3pp | yes |

Last-30d slice (reporting only): 0-2% n=394 gap 0.5pp · 2-5% n=836 gap 0.4pp · 5-10% n=944 gap 0.0pp · 10-20% n=1177 gap 0.5pp · 20-35% n=1085 gap 0.9pp · 35-50% n=864 gap 2.0pp · 50-100% n=3891 gap 0.2pp

### stolenBases — **STOP** (57938 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.2pp n=1340

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 35606 | 0.4% | 1.0% | 0.5pp | yes |
| 2-5% | 8965 | 3.5% | 3.4% | 0.1pp | yes |
| 5-10% | 6433 | 7.3% | 6.7% | 0.6pp | yes |
| 10-20% | 5556 | 14.0% | 12.0% | 2.0pp | yes |
| 20-35% | 1340 | 24.4% | 18.3% | 6.2pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10889 gap 0.4pp · 2-5% n=2536 gap 0.1pp · 5-10% n=1755 gap 0.3pp · 10-20% n=1405 gap 1.5pp · 20-35% n=299 gap 6.0pp

### doubles — **STOP** (72845 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.4pp n=6521; 20-35% gap 7.6pp n=4376

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 34566 | 0.7% | 0.8% | 0.0pp | yes |
| 2-5% | 9530 | 3.1% | 2.8% | 0.3pp | yes |
| 5-10% | 6521 | 7.8% | 11.1% | 3.4pp | yes |
| 10-20% | 17798 | 14.8% | 14.9% | 0.1pp | yes |
| 20-35% | 4376 | 23.0% | 15.5% | 7.6pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10139 gap 0.2pp · 2-5% n=2473 gap 0.7pp · 5-10% n=1730 gap 2.8pp · 10-20% n=5115 gap 0.2pp · 20-35% n=1104 gap 6.0pp · 35-50% n=1 gap 37.3pp

### triples — **STOP** (43286 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.9pp n=6323; 5-10% gap 4.0pp n=1336

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 35530 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 6323 | 3.4% | 1.5% | 1.9pp | yes |
| 5-10% | 1336 | 6.6% | 2.5% | 4.0pp | yes |
| 10-20% | 97 | 12.0% | 4.1% | 7.9pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10638 gap 0.3pp · 2-5% n=1660 gap 1.6pp · 5-10% n=395 gap 3.5pp · 10-20% n=10 gap 1.4pp

## Axis B — market-ladder scoreboard

1032093 captured rung rows across 33 file(s) → 140750 joined to curves · **124162 settled / 16588 pending** · 75703 disagreements scored (our Brier 0.1488 vs market 0.1467).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
