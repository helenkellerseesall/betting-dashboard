# G2-L2 Walk-Forward Validation Report — 2026-10-11

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-09-27) + 79 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 0.9pp | 0.08640 | 887717 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (139055 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 31486 | 1.0% | 0.6% | 0.3pp | yes |
| 2-5% | 20177 | 3.2% | 2.5% | 0.7pp | yes |
| 5-10% | 18536 | 7.3% | 6.1% | 1.1pp | yes |
| 10-20% | 17425 | 14.8% | 14.5% | 0.3pp | yes |
| 20-35% | 18095 | 26.0% | 25.1% | 0.9pp | yes |
| 35-50% | 10307 | 43.5% | 46.4% | 2.9pp | yes |
| 50-100% | 23029 | 59.8% | 60.8% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=2409 gap 0.5pp · 2-5% n=1330 gap 0.8pp · 5-10% n=1269 gap 1.8pp · 10-20% n=1105 gap 2.9pp · 20-35% n=1142 gap 1.3pp · 35-50% n=770 gap 1.1pp · 50-100% n=1418 gap 1.2pp

### totalBases — **PASS** (260156 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 51742 | 1.1% | 1.3% | 0.2pp | yes |
| 2-5% | 50222 | 3.3% | 3.7% | 0.4pp | yes |
| 5-10% | 38586 | 7.2% | 8.6% | 1.3pp | yes |
| 10-20% | 38855 | 14.4% | 16.1% | 1.7pp | yes |
| 20-35% | 31778 | 26.7% | 26.6% | 0.1pp | yes |
| 35-50% | 21103 | 42.0% | 40.1% | 1.9pp | yes |
| 50-100% | 27870 | 62.8% | 58.4% | 4.4pp | yes |

Last-30d slice (reporting only): 0-2% n=4078 gap 0.1pp · 2-5% n=3417 gap 0.7pp · 5-10% n=2578 gap 1.0pp · 10-20% n=2527 gap 1.0pp · 20-35% n=2075 gap 1.7pp · 35-50% n=1389 gap 1.7pp · 50-100% n=1697 gap 4.0pp

### rbis — **PASS_WITH_CORRECTION** (145745 walk-forward pairs)
raw curve STOP (2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 35-50% gap 8.0pp n=8450; 50-100% gap 19.5pp n=383) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 50350 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 27242 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 20540 | 7.2% | 8.2% | 0.9pp | yes |
| 10-20% | 18553 | 14.0% | 14.5% | 0.5pp | yes |
| 20-35% | 20227 | 27.5% | 26.8% | 0.7pp | yes |
| 35-50% | 8450 | 39.8% | 31.9% | 8.0pp | yes |
| 50-100% | 383 | 53.2% | 33.7% | 19.5pp | yes |

Last-30d slice (reporting only): 0-2% n=3543 gap 0.1pp · 2-5% n=1779 gap 0.5pp · 5-10% n=1215 gap 0.4pp · 10-20% n=1255 gap 0.3pp · 20-35% n=1386 gap 0.1pp · 35-50% n=453 gap 6.0pp · 50-100% n=9 gap 29.5pp

### runs — **PASS** (116116 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 37924 | 0.8% | 0.7% | 0.1pp | yes |
| 2-5% | 16833 | 3.3% | 2.9% | 0.3pp | yes |
| 5-10% | 16453 | 7.3% | 6.8% | 0.5pp | yes |
| 10-20% | 12262 | 13.7% | 13.6% | 0.1pp | yes |
| 20-35% | 16299 | 28.4% | 30.8% | 2.5pp | yes |
| 35-50% | 14713 | 41.3% | 39.8% | 1.5pp | yes |
| 50-100% | 1632 | 53.5% | 45.8% | 7.7pp | yes |

Last-30d slice (reporting only): 0-2% n=2858 gap 0.2pp · 2-5% n=916 gap 0.4pp · 5-10% n=1228 gap 0.0pp · 10-20% n=669 gap 1.1pp · 20-35% n=1094 gap 1.4pp · 35-50% n=981 gap 1.5pp · 50-100% n=56 gap 5.9pp

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

### stolenBases — **STOP** (66258 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.3pp n=1480

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 40980 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 10187 | 3.5% | 3.3% | 0.1pp | yes |
| 5-10% | 7273 | 7.3% | 6.7% | 0.6pp | yes |
| 10-20% | 6300 | 13.9% | 11.9% | 2.0pp | yes |
| 20-35% | 1480 | 24.6% | 18.2% | 6.3pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=2900 gap 0.4pp · 2-5% n=658 gap 1.1pp · 5-10% n=434 gap 0.2pp · 10-20% n=382 gap 2.0pp · 20-35% n=61 gap 0.4pp

### doubles — **STOP** (83062 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.1pp n=7601; 20-35% gap 7.6pp n=4701

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 39752 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 10557 | 3.1% | 2.8% | 0.3pp | yes |
| 5-10% | 7601 | 7.8% | 10.9% | 3.1pp | yes |
| 10-20% | 20397 | 14.8% | 14.8% | 0.1pp | yes |
| 20-35% | 4701 | 23.0% | 15.4% | 7.6pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=2856 gap 0.1pp · 2-5% n=476 gap 0.5pp · 5-10% n=637 gap 0.9pp · 10-20% n=1381 gap 0.7pp · 20-35% n=125 gap 9.1pp

### triples — **STOP** (49522 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.9pp n=7236; 5-10% gap 4.2pp n=1430

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 40751 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 7236 | 3.4% | 1.5% | 1.9pp | yes |
| 5-10% | 1430 | 6.6% | 2.4% | 4.2pp | yes |
| 10-20% | 105 | 11.9% | 4.8% | 7.2pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=2772 gap 0.3pp · 2-5% n=507 gap 1.8pp · 5-10% n=30 gap 6.0pp

## Axis B — market-ladder scoreboard

2197028 captured rung rows across 79 file(s) → 305886 joined to curves · **182566 settled / 123320 pending** · 110314 disagreements scored (our Brier 0.1484 vs market 0.1463).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
