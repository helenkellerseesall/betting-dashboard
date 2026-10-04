# G2-L2 Walk-Forward Validation Report — 2026-10-04

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-09-27) + 74 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 1.0pp | 0.08658 | 867832 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (135849 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 30583 | 1.0% | 0.6% | 0.3pp | yes |
| 2-5% | 19747 | 3.2% | 2.5% | 0.7pp | yes |
| 5-10% | 18153 | 7.3% | 6.1% | 1.1pp | yes |
| 10-20% | 16973 | 14.7% | 14.5% | 0.3pp | yes |
| 20-35% | 17810 | 26.1% | 25.1% | 1.0pp | yes |
| 35-50% | 9971 | 43.5% | 46.4% | 2.9pp | yes |
| 50-100% | 22612 | 59.9% | 60.9% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=1595 gap 0.4pp · 2-5% n=940 gap 1.1pp · 5-10% n=921 gap 1.7pp · 10-20% n=694 gap 5.3pp · 20-35% n=877 gap 1.8pp · 35-50% n=456 gap 3.0pp · 50-100% n=1048 gap 1.3pp

### totalBases — **PASS** (253891 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 50230 | 1.1% | 1.3% | 0.2pp | yes |
| 2-5% | 48993 | 3.3% | 3.7% | 0.4pp | yes |
| 5-10% | 37638 | 7.2% | 8.5% | 1.3pp | yes |
| 10-20% | 37964 | 14.4% | 16.1% | 1.7pp | yes |
| 20-35% | 31017 | 26.7% | 26.6% | 0.1pp | yes |
| 35-50% | 20697 | 42.0% | 40.1% | 1.9pp | yes |
| 50-100% | 27352 | 62.9% | 58.4% | 4.5pp | yes |

Last-30d slice (reporting only): 0-2% n=2705 gap 0.2pp · 2-5% n=2299 gap 0.6pp · 5-10% n=1716 gap 0.6pp · 10-20% n=1718 gap 0.9pp · 20-35% n=1390 gap 2.7pp · 35-50% n=1006 gap 2.1pp · 50-100% n=1229 gap 4.7pp

### rbis — **PASS_WITH_CORRECTION** (142436 walk-forward pairs)
raw curve STOP (1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 50-100% gap 19.2pp n=377) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 49178 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 26632 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 20083 | 7.2% | 8.2% | 0.9pp | yes |
| 10-20% | 18085 | 14.0% | 14.5% | 0.5pp | yes |
| 20-35% | 19784 | 27.5% | 26.7% | 0.8pp | yes |
| 35-50% | 8297 | 39.9% | 31.9% | 7.9pp | yes |
| 50-100% | 377 | 53.2% | 34.0% | 19.2pp | yes |

Last-30d slice (reporting only): 0-2% n=2491 gap 0.0pp · 2-5% n=1222 gap 0.8pp · 5-10% n=803 gap 0.3pp · 10-20% n=824 gap 0.1pp · 20-35% n=988 gap 1.3pp · 35-50% n=308 gap 4.3pp · 50-100% n=3 gap 17.7pp

### runs — **PASS** (113464 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 36882 | 0.8% | 0.7% | 0.1pp | yes |
| 2-5% | 16567 | 3.3% | 2.9% | 0.4pp | yes |
| 5-10% | 15953 | 7.3% | 6.7% | 0.5pp | yes |
| 10-20% | 12156 | 13.7% | 13.5% | 0.2pp | yes |
| 20-35% | 15791 | 28.4% | 30.8% | 2.4pp | yes |
| 35-50% | 14493 | 41.3% | 39.8% | 1.5pp | yes |
| 50-100% | 1622 | 53.5% | 45.9% | 7.6pp | yes |

Last-30d slice (reporting only): 0-2% n=1918 gap 0.2pp · 2-5% n=669 gap 1.0pp · 5-10% n=780 gap 0.1pp · 10-20% n=568 gap 1.2pp · 20-35% n=640 gap 0.4pp · 35-50% n=775 gap 1.5pp · 50-100% n=46 gap 10.3pp

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

### stolenBases — **STOP** (64774 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.3pp n=1473

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 39963 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 9983 | 3.5% | 3.4% | 0.1pp | yes |
| 5-10% | 7154 | 7.3% | 6.7% | 0.6pp | yes |
| 10-20% | 6163 | 13.9% | 11.9% | 2.1pp | yes |
| 20-35% | 1473 | 24.6% | 18.3% | 6.3pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=1971 gap 0.3pp · 2-5% n=466 gap 1.1pp · 5-10% n=321 gap 1.3pp · 10-20% n=268 gap 2.4pp · 20-35% n=54 gap 2.2pp

### doubles — **STOP** (81200 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.3pp n=7300; 20-35% gap 7.6pp n=4674

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 38766 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 10439 | 3.1% | 2.7% | 0.3pp | yes |
| 5-10% | 7300 | 7.8% | 11.0% | 3.3pp | yes |
| 10-20% | 19967 | 14.8% | 14.9% | 0.1pp | yes |
| 20-35% | 4674 | 23.0% | 15.4% | 7.6pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=1955 gap 0.0pp · 2-5% n=373 gap 0.2pp · 5-10% n=360 gap 2.0pp · 10-20% n=991 gap 0.8pp · 20-35% n=101 gap 8.9pp

### triples — **STOP** (48415 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.8pp n=7074; 5-10% gap 4.2pp n=1407

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 39829 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 7074 | 3.4% | 1.5% | 1.8pp | yes |
| 5-10% | 1407 | 6.6% | 2.4% | 4.2pp | yes |
| 10-20% | 105 | 11.9% | 4.8% | 7.2pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=1926 gap 0.3pp · 2-5% n=357 gap 1.6pp · 5-10% n=13 gap 6.4pp

## Axis B — market-ladder scoreboard

2160863 captured rung rows across 74 file(s) → 300480 joined to curves · **173194 settled / 127286 pending** · 104707 disagreements scored (our Brier 0.1483 vs market 0.1462).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
