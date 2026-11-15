# G2-L2 Walk-Forward Validation Report — 2026-11-15

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-09-27) + 79 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 0.9pp | 0.08626 | 862317 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (135101 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 30692 | 0.9% | 0.6% | 0.3pp | yes |
| 2-5% | 19829 | 3.2% | 2.5% | 0.8pp | yes |
| 5-10% | 18053 | 7.3% | 6.1% | 1.2pp | yes |
| 10-20% | 16739 | 14.7% | 14.3% | 0.4pp | yes |
| 20-35% | 17828 | 26.3% | 25.7% | 0.5pp | yes |
| 35-50% | 9696 | 43.2% | 45.6% | 2.4pp | yes |
| 50-100% | 22264 | 59.9% | 60.9% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=8576 gap 0.4pp · 2-5% n=5079 gap 0.9pp · 5-10% n=4473 gap 1.7pp · 10-20% n=4174 gap 0.9pp · 20-35% n=4354 gap 0.5pp · 35-50% n=2474 gap 0.3pp · 50-100% n=5463 gap 1.0pp

### totalBases — **PASS** (252830 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 49350 | 1.1% | 1.3% | 0.1pp | yes |
| 2-5% | 49163 | 3.3% | 3.6% | 0.3pp | yes |
| 5-10% | 37887 | 7.2% | 8.3% | 1.1pp | yes |
| 10-20% | 37918 | 14.4% | 16.0% | 1.6pp | yes |
| 20-35% | 30999 | 26.6% | 26.6% | 0.0pp | yes |
| 35-50% | 20717 | 42.0% | 40.0% | 2.0pp | yes |
| 50-100% | 26796 | 63.1% | 58.5% | 4.6pp | yes |

Last-30d slice (reporting only): 0-2% n=14689 gap 0.0pp · 2-5% n=12472 gap 0.2pp · 5-10% n=9468 gap 0.9pp · 10-20% n=9564 gap 1.1pp · 20-35% n=7623 gap 0.5pp · 35-50% n=5234 gap 2.2pp · 50-100% n=6425 gap 4.5pp

### rbis — **PASS_WITH_CORRECTION** (140851 walk-forward pairs)
raw curve STOP (1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 50-100% gap 17.6pp n=367) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 48336 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 26637 | 3.3% | 3.7% | 0.4pp | yes |
| 5-10% | 20266 | 7.2% | 8.0% | 0.8pp | yes |
| 10-20% | 17836 | 14.1% | 14.4% | 0.2pp | yes |
| 20-35% | 19596 | 27.5% | 27.2% | 0.3pp | yes |
| 35-50% | 7813 | 39.9% | 32.0% | 7.9pp | yes |
| 50-100% | 367 | 52.7% | 35.1% | 17.6pp | yes |

Last-30d slice (reporting only): 0-2% n=13708 gap 0.1pp · 2-5% n=6569 gap 0.2pp · 5-10% n=5012 gap 0.7pp · 10-20% n=4335 gap 0.1pp · 20-35% n=5016 gap 0.3pp · 35-50% n=1799 gap 6.4pp · 50-100% n=58 gap 14.2pp

### runs — **PASS** (112260 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 36587 | 0.8% | 0.8% | 0.1pp | yes |
| 2-5% | 16730 | 3.3% | 2.8% | 0.4pp | yes |
| 5-10% | 15479 | 7.3% | 7.0% | 0.3pp | yes |
| 10-20% | 12293 | 13.7% | 13.3% | 0.4pp | yes |
| 20-35% | 15434 | 28.3% | 31.3% | 3.0pp | yes |
| 35-50% | 14241 | 41.2% | 39.6% | 1.6pp | yes |
| 50-100% | 1496 | 53.1% | 45.0% | 8.2pp | yes |

Last-30d slice (reporting only): 0-2% n=9989 gap 0.2pp · 2-5% n=3744 gap 0.4pp · 5-10% n=4162 gap 0.2pp · 10-20% n=2755 gap 1.5pp · 20-35% n=3988 gap 2.1pp · 35-50% n=3533 gap 1.2pp · 50-100% n=324 gap 3.5pp

### ks — **PASS** (28913 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 977 | 1.2% | 0.8% | 0.4pp | yes |
| 2-5% | 2454 | 3.5% | 2.8% | 0.7pp | yes |
| 5-10% | 2912 | 7.4% | 6.9% | 0.4pp | yes |
| 10-20% | 3723 | 14.5% | 14.0% | 0.5pp | yes |
| 20-35% | 3589 | 27.1% | 27.8% | 0.7pp | yes |
| 35-50% | 2817 | 42.3% | 42.4% | 0.1pp | yes |
| 50-100% | 12441 | 81.4% | 79.9% | 1.5pp | yes |

Last-30d slice (reporting only): 0-2% n=441 gap 0.7pp · 2-5% n=877 gap 1.3pp · 5-10% n=942 gap 1.4pp · 10-20% n=1130 gap 1.3pp · 20-35% n=1103 gap 0.6pp · 35-50% n=846 gap 2.0pp · 50-100% n=3882 gap 4.5pp

### stolenBases — **STOP** (64500 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 5.4pp n=1508

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 39702 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 10107 | 3.4% | 3.5% | 0.0pp | yes |
| 5-10% | 7436 | 7.3% | 6.9% | 0.4pp | yes |
| 10-20% | 5743 | 13.7% | 11.6% | 2.1pp | yes |
| 20-35% | 1508 | 24.2% | 18.8% | 5.4pp | yes |
| 35-50% | 4 | 36.9% | 0.0% | 36.9pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10676 gap 0.2pp · 2-5% n=2594 gap 0.5pp · 5-10% n=1833 gap 0.9pp · 10-20% n=1388 gap 1.1pp · 20-35% n=377 gap 3.9pp

### doubles — **STOP** (79511 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.4pp n=7173; 20-35% gap 7.3pp n=4698

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 37632 | 0.7% | 0.8% | 0.1pp | yes |
| 2-5% | 10569 | 3.1% | 2.9% | 0.2pp | yes |
| 5-10% | 7173 | 7.7% | 11.1% | 3.4pp | yes |
| 10-20% | 19424 | 14.8% | 14.6% | 0.1pp | yes |
| 20-35% | 4698 | 23.2% | 15.9% | 7.3pp | yes |
| 35-50% | 15 | 36.8% | 0.0% | 36.8pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10008 gap 0.1pp · 2-5% n=2417 gap 0.2pp · 5-10% n=1884 gap 2.2pp · 10-20% n=5111 gap 0.7pp · 20-35% n=855 gap 7.1pp · 35-50% n=1 gap 35.4pp

### triples — **STOP** (48351 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.6pp n=7071; 5-10% gap 4.0pp n=1677

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 39515 | 0.3% | 0.7% | 0.5pp | yes |
| 2-5% | 7071 | 3.5% | 1.9% | 1.6pp | yes |
| 5-10% | 1677 | 6.6% | 2.6% | 4.0pp | yes |
| 10-20% | 88 | 11.2% | 2.3% | 9.0pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10736 gap 0.3pp · 2-5% n=1531 gap 1.5pp · 5-10% n=274 gap 1.6pp · 10-20% n=21 gap 11.0pp

## Axis B — market-ladder scoreboard

2197028 captured rung rows across 79 file(s) → 304967 joined to curves · **273485 settled / 31482 pending** · 165420 disagreements scored (our Brier 0.1499 vs market 0.1472).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
