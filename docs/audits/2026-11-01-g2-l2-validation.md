# G2-L2 Walk-Forward Validation Report — 2026-11-01

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-09-27) + 79 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 0.9pp | 0.08600 | 921827 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (144509 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 32986 | 0.9% | 0.6% | 0.3pp | yes |
| 2-5% | 20922 | 3.3% | 2.5% | 0.7pp | yes |
| 5-10% | 19225 | 7.3% | 6.1% | 1.2pp | yes |
| 10-20% | 18045 | 14.8% | 14.5% | 0.3pp | yes |
| 20-35% | 18849 | 26.1% | 25.1% | 0.9pp | yes |
| 35-50% | 10466 | 43.4% | 46.1% | 2.7pp | yes |
| 50-100% | 24016 | 59.8% | 60.7% | 0.9pp | yes |

Last-30d slice (reporting only): 0-2% n=4254 gap 0.4pp · 2-5% n=2331 gap 0.7pp · 5-10% n=2107 gap 1.0pp · 10-20% n=1971 gap 1.5pp · 20-35% n=2009 gap 0.6pp · 35-50% n=1183 gap 0.4pp · 50-100% n=2571 gap 0.7pp

### totalBases — **PASS** (270306 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 53928 | 1.1% | 1.3% | 0.2pp | yes |
| 2-5% | 52146 | 3.3% | 3.7% | 0.4pp | yes |
| 5-10% | 40192 | 7.2% | 8.5% | 1.3pp | yes |
| 10-20% | 40317 | 14.4% | 16.1% | 1.6pp | yes |
| 20-35% | 32973 | 26.7% | 26.6% | 0.1pp | yes |
| 35-50% | 21914 | 42.0% | 40.1% | 1.9pp | yes |
| 50-100% | 28836 | 62.9% | 58.3% | 4.6pp | yes |

Last-30d slice (reporting only): 0-2% n=6963 gap 0.1pp · 2-5% n=5918 gap 0.2pp · 5-10% n=4512 gap 1.2pp · 10-20% n=4404 gap 1.4pp · 20-35% n=3606 gap 1.1pp · 35-50% n=2407 gap 1.5pp · 50-100% n=2983 gap 4.5pp

### rbis — **PASS_WITH_CORRECTION** (151996 walk-forward pairs)
raw curve STOP (2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 35-50% gap 8.1pp n=8598; 50-100% gap 21.3pp n=372) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 52884 | 0.9% | 1.2% | 0.3pp | yes |
| 2-5% | 28398 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 21269 | 7.2% | 8.1% | 0.9pp | yes |
| 10-20% | 19252 | 14.0% | 14.4% | 0.4pp | yes |
| 20-35% | 21223 | 27.6% | 26.9% | 0.7pp | yes |
| 35-50% | 8598 | 39.8% | 31.7% | 8.1pp | yes |
| 50-100% | 372 | 53.6% | 32.3% | 21.3pp | yes |

Last-30d slice (reporting only): 0-2% n=6519 gap 0.0pp · 2-5% n=3151 gap 0.5pp · 5-10% n=2240 gap 0.5pp · 10-20% n=2068 gap 0.0pp · 20-35% n=2548 gap 0.1pp · 35-50% n=765 gap 8.0pp · 50-100% n=20 gap 27.1pp

### runs — **PASS** (120526 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 39478 | 0.8% | 0.7% | 0.1pp | yes |
| 2-5% | 17406 | 3.3% | 2.9% | 0.4pp | yes |
| 5-10% | 17067 | 7.2% | 6.7% | 0.5pp | yes |
| 10-20% | 12746 | 13.7% | 13.3% | 0.4pp | yes |
| 20-35% | 16868 | 28.4% | 30.7% | 2.3pp | yes |
| 35-50% | 15240 | 41.3% | 39.6% | 1.7pp | yes |
| 50-100% | 1721 | 53.6% | 45.3% | 8.2pp | yes |

Last-30d slice (reporting only): 0-2% n=4941 gap 0.2pp · 2-5% n=1677 gap 0.3pp · 5-10% n=1989 gap 0.1pp · 10-20% n=1316 gap 1.5pp · 20-35% n=1849 gap 2.0pp · 35-50% n=1668 gap 2.7pp · 50-100% n=147 gap 2.9pp

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

Last-30d slice (reporting only): no pairs

### stolenBases — **STOP** (68966 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 5.9pp n=1570

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 42635 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 10582 | 3.5% | 3.3% | 0.2pp | yes |
| 5-10% | 7591 | 7.3% | 6.7% | 0.7pp | yes |
| 10-20% | 6550 | 13.9% | 11.8% | 2.1pp | yes |
| 20-35% | 1570 | 24.5% | 18.5% | 5.9pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=5037 gap 0.2pp · 2-5% n=1171 gap 1.1pp · 5-10% n=793 gap 0.8pp · 10-20% n=690 gap 2.5pp · 20-35% n=169 gap 2.6pp

### doubles — **STOP** (86211 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.2pp n=7703; 20-35% gap 7.5pp n=4987

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 41289 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 11018 | 3.1% | 2.7% | 0.3pp | yes |
| 5-10% | 7703 | 7.8% | 11.0% | 3.2pp | yes |
| 10-20% | 21172 | 14.8% | 14.7% | 0.0pp | yes |
| 20-35% | 4987 | 23.1% | 15.5% | 7.5pp | yes |
| 35-50% | 42 | 38.0% | 19.0% | 19.0pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=4895 gap 0.1pp · 2-5% n=1023 gap 0.0pp · 5-10% n=1006 gap 2.2pp · 10-20% n=2325 gap 1.0pp · 20-35% n=384 gap 5.9pp

### triples — **STOP** (51510 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.9pp n=7486; 5-10% gap 3.9pp n=1528

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 42376 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 7486 | 3.4% | 1.5% | 1.9pp | yes |
| 5-10% | 1528 | 6.6% | 2.7% | 3.9pp | yes |
| 10-20% | 120 | 11.8% | 4.2% | 7.6pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=4952 gap 0.3pp · 2-5% n=791 gap 1.6pp · 5-10% n=66 gap 0.2pp · 10-20% n=6 gap 11.0pp

## Axis B — market-ladder scoreboard

2197028 captured rung rows across 79 file(s) → 305899 joined to curves · **206773 settled / 99126 pending** · 124598 disagreements scored (our Brier 0.1488 vs market 0.1465).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
