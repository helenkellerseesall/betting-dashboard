# G2-L2 Walk-Forward Validation Report — 2026-11-08

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-09-27) + 79 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 0.9pp | 0.08570 | 908122 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (141803 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 32349 | 0.9% | 0.6% | 0.3pp | yes |
| 2-5% | 20724 | 3.2% | 2.4% | 0.8pp | yes |
| 5-10% | 18968 | 7.3% | 6.0% | 1.3pp | yes |
| 10-20% | 17433 | 14.7% | 14.2% | 0.6pp | yes |
| 20-35% | 18706 | 26.2% | 25.5% | 0.7pp | yes |
| 35-50% | 10143 | 43.2% | 45.5% | 2.3pp | yes |
| 50-100% | 23480 | 60.0% | 60.7% | 0.8pp | yes |

Last-30d slice (reporting only): 0-2% n=8606 gap 0.4pp · 2-5% n=5056 gap 0.9pp · 5-10% n=4487 gap 1.6pp · 10-20% n=4170 gap 0.9pp · 20-35% n=4345 gap 0.6pp · 35-50% n=2500 gap 0.2pp · 50-100% n=5461 gap 1.0pp

### totalBases — **PASS** (266745 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 52512 | 1.1% | 1.2% | 0.1pp | yes |
| 2-5% | 52065 | 3.3% | 3.5% | 0.2pp | yes |
| 5-10% | 39678 | 7.2% | 8.2% | 1.0pp | yes |
| 10-20% | 39871 | 14.4% | 15.8% | 1.5pp | yes |
| 20-35% | 32589 | 26.6% | 26.2% | 0.4pp | yes |
| 35-50% | 21886 | 42.1% | 40.1% | 2.0pp | yes |
| 50-100% | 28144 | 63.1% | 58.4% | 4.7pp | yes |

Last-30d slice (reporting only): 0-2% n=14759 gap 0.0pp · 2-5% n=12479 gap 0.3pp · 5-10% n=9474 gap 1.0pp · 10-20% n=9586 gap 1.1pp · 20-35% n=7626 gap 0.5pp · 35-50% n=5209 gap 2.3pp · 50-100% n=6452 gap 4.5pp

### rbis — **PASS_WITH_CORRECTION** (148764 walk-forward pairs)
raw curve STOP (1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 50-100% gap 21.7pp n=317) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 51502 | 0.9% | 1.2% | 0.3pp | yes |
| 2-5% | 27924 | 3.3% | 3.6% | 0.3pp | yes |
| 5-10% | 21463 | 7.2% | 8.0% | 0.8pp | yes |
| 10-20% | 18636 | 14.1% | 14.3% | 0.2pp | yes |
| 20-35% | 20546 | 27.5% | 27.0% | 0.5pp | yes |
| 35-50% | 8376 | 39.9% | 32.2% | 7.6pp | yes |
| 50-100% | 317 | 52.6% | 30.9% | 21.7pp | yes |

Last-30d slice (reporting only): 0-2% n=13750 gap 0.1pp · 2-5% n=6595 gap 0.2pp · 5-10% n=5006 gap 0.7pp · 10-20% n=4357 gap 0.1pp · 20-35% n=5008 gap 0.3pp · 35-50% n=1792 gap 6.4pp · 50-100% n=58 gap 14.2pp

### runs — **PASS** (117968 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 38515 | 0.8% | 0.7% | 0.1pp | yes |
| 2-5% | 17477 | 3.3% | 2.8% | 0.4pp | yes |
| 5-10% | 16218 | 7.3% | 6.8% | 0.5pp | yes |
| 10-20% | 13003 | 13.6% | 12.9% | 0.7pp | yes |
| 20-35% | 16127 | 28.4% | 31.0% | 2.6pp | yes |
| 35-50% | 15165 | 41.2% | 39.7% | 1.5pp | yes |
| 50-100% | 1463 | 53.3% | 44.7% | 8.6pp | yes |

Last-30d slice (reporting only): 0-2% n=10020 gap 0.2pp · 2-5% n=3757 gap 0.4pp · 5-10% n=4142 gap 0.2pp · 10-20% n=2765 gap 1.6pp · 20-35% n=3988 gap 2.1pp · 35-50% n=3537 gap 1.1pp · 50-100% n=318 gap 3.2pp

### ks — **PASS** (30744 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 1022 | 1.2% | 1.3% | 0.1pp | yes |
| 2-5% | 2613 | 3.4% | 2.9% | 0.5pp | yes |
| 5-10% | 3122 | 7.3% | 7.1% | 0.2pp | yes |
| 10-20% | 3957 | 14.4% | 13.7% | 0.7pp | yes |
| 20-35% | 3827 | 27.0% | 27.9% | 0.9pp | yes |
| 35-50% | 3014 | 42.3% | 41.8% | 0.5pp | yes |
| 50-100% | 13189 | 81.4% | 80.2% | 1.2pp | yes |

Last-30d slice (reporting only): 0-2% n=424 gap 0.4pp · 2-5% n=892 gap 1.1pp · 5-10% n=967 gap 1.1pp · 10-20% n=1134 gap 1.6pp · 20-35% n=1100 gap 0.6pp · 35-50% n=870 gap 3.7pp · 50-100% n=3880 gap 4.2pp

### stolenBases — **STOP** (67445 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 5.3pp n=1542

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 41662 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 10488 | 3.4% | 3.4% | 0.0pp | yes |
| 5-10% | 7660 | 7.3% | 7.0% | 0.4pp | yes |
| 10-20% | 6073 | 13.7% | 11.9% | 1.8pp | yes |
| 20-35% | 1542 | 24.2% | 18.9% | 5.3pp | yes |
| 35-50% | 20 | 38.2% | 30.0% | 8.2pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10686 gap 0.2pp · 2-5% n=2565 gap 0.5pp · 5-10% n=1855 gap 1.0pp · 10-20% n=1390 gap 1.2pp · 20-35% n=381 gap 3.6pp

### doubles — **STOP** (83670 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.3pp n=7506; 20-35% gap 7.3pp n=4766

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 39750 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 11014 | 3.1% | 2.9% | 0.2pp | yes |
| 5-10% | 7506 | 7.8% | 11.0% | 3.3pp | yes |
| 10-20% | 20613 | 14.7% | 14.7% | 0.1pp | yes |
| 20-35% | 4766 | 23.1% | 15.8% | 7.3pp | yes |
| 35-50% | 21 | 37.3% | 19.0% | 18.2pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10040 gap 0.1pp · 2-5% n=2405 gap 0.2pp · 5-10% n=1877 gap 2.2pp · 10-20% n=5148 gap 0.7pp · 20-35% n=847 gap 7.0pp · 35-50% n=1 gap 35.4pp

### triples — **STOP** (50983 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.6pp n=7567; 5-10% gap 4.1pp n=1726

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 41583 | 0.3% | 0.7% | 0.4pp | yes |
| 2-5% | 7567 | 3.5% | 1.9% | 1.6pp | yes |
| 5-10% | 1726 | 6.5% | 2.5% | 4.1pp | yes |
| 10-20% | 107 | 11.4% | 2.8% | 8.6pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10769 gap 0.3pp · 2-5% n=1525 gap 1.5pp · 5-10% n=262 gap 1.7pp · 10-20% n=21 gap 11.0pp

## Axis B — market-ladder scoreboard

2197028 captured rung rows across 79 file(s) → 306168 joined to curves · **274513 settled / 31655 pending** · 165585 disagreements scored (our Brier 0.1496 vs market 0.1470).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
