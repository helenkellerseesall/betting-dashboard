# G2-L2 Walk-Forward Validation Report — 2026-08-23

Read-only over season gamelog caches (571 batters, 270 pitchers, newest game 2026-08-22) + 38 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 1.0pp | 0.08706 | 815495 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (127337 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 28507 | 1.0% | 0.7% | 0.3pp | yes |
| 2-5% | 18512 | 3.2% | 2.5% | 0.7pp | yes |
| 5-10% | 16976 | 7.2% | 6.2% | 1.1pp | yes |
| 10-20% | 16039 | 14.7% | 14.6% | 0.1pp | yes |
| 20-35% | 16675 | 26.0% | 25.2% | 0.9pp | yes |
| 35-50% | 9389 | 43.5% | 46.7% | 3.2pp | yes |
| 50-100% | 21239 | 59.8% | 60.8% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=8675 gap 0.5pp · 2-5% n=4805 gap 0.7pp · 5-10% n=4420 gap 1.5pp · 10-20% n=4130 gap 0.6pp · 20-35% n=4272 gap 1.5pp · 35-50% n=2434 gap 0.6pp · 50-100% n=5553 gap 0.2pp

### totalBases — **PASS** (238098 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 46700 | 1.1% | 1.4% | 0.2pp | yes |
| 2-5% | 45982 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 35407 | 7.2% | 8.6% | 1.4pp | yes |
| 10-20% | 35682 | 14.4% | 16.2% | 1.8pp | yes |
| 20-35% | 29180 | 26.7% | 26.8% | 0.1pp | yes |
| 35-50% | 19403 | 42.0% | 40.2% | 1.8pp | yes |
| 50-100% | 25744 | 62.9% | 58.4% | 4.4pp | yes |

Last-30d slice (reporting only): 0-2% n=14366 gap 0.3pp · 2-5% n=12238 gap 0.2pp · 5-10% n=9380 gap 0.2pp · 10-20% n=9389 gap 0.5pp · 20-35% n=7702 gap 1.7pp · 35-50% n=5308 gap 4.1pp · 50-100% n=6614 gap 5.8pp

### rbis — **PASS_WITH_CORRECTION** (133725 walk-forward pairs)
raw curve STOP (1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 50-100% gap 19.5pp n=371) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 45900 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 25044 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 18993 | 7.2% | 8.2% | 1.0pp | yes |
| 10-20% | 17030 | 14.1% | 14.6% | 0.5pp | yes |
| 20-35% | 18490 | 27.5% | 26.7% | 0.8pp | yes |
| 35-50% | 7897 | 39.9% | 31.9% | 7.9pp | yes |
| 50-100% | 371 | 53.2% | 33.7% | 19.5pp | yes |

Last-30d slice (reporting only): 0-2% n=13372 gap 0.0pp · 2-5% n=6589 gap 0.1pp · 5-10% n=5154 gap 0.5pp · 10-20% n=4253 gap 1.2pp · 20-35% n=5088 gap 1.6pp · 35-50% n=1873 gap 7.7pp · 50-100% n=24 gap 27.7pp

### runs — **PASS** (106429 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 34405 | 0.8% | 0.8% | 0.1pp | yes |
| 2-5% | 15674 | 3.3% | 2.9% | 0.3pp | yes |
| 5-10% | 14918 | 7.2% | 6.7% | 0.6pp | yes |
| 10-20% | 11432 | 13.7% | 13.6% | 0.1pp | yes |
| 20-35% | 14945 | 28.3% | 30.9% | 2.5pp | yes |
| 35-50% | 13498 | 41.3% | 39.8% | 1.5pp | yes |
| 50-100% | 1557 | 53.6% | 45.5% | 8.0pp | yes |

Last-30d slice (reporting only): 0-2% n=9988 gap 0.3pp · 2-5% n=4050 gap 1.3pp · 5-10% n=3868 gap 1.3pp · 10-20% n=2883 gap 1.0pp · 20-35% n=3909 gap 0.3pp · 35-50% n=3686 gap 2.9pp · 50-100% n=259 gap 5.5pp

### ks — **PASS** (27482 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 842 | 1.3% | 1.3% | 0.0pp | yes |
| 2-5% | 2167 | 3.5% | 3.4% | 0.1pp | yes |
| 5-10% | 2863 | 7.3% | 7.3% | 0.1pp | yes |
| 10-20% | 3587 | 14.5% | 14.3% | 0.2pp | yes |
| 20-35% | 3428 | 27.2% | 28.6% | 1.5pp | yes |
| 35-50% | 2682 | 42.1% | 41.8% | 0.3pp | yes |
| 50-100% | 11913 | 81.2% | 81.5% | 0.2pp | yes |

Last-30d slice (reporting only): 0-2% n=406 gap 0.3pp · 2-5% n=850 gap 0.5pp · 5-10% n=936 gap 0.5pp · 10-20% n=1173 gap 0.3pp · 20-35% n=1061 gap 0.0pp · 35-50% n=858 gap 1.9pp · 50-100% n=3857 gap 1.0pp

### stolenBases — **STOP** (60751 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.5pp n=1402

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 37400 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 9372 | 3.5% | 3.4% | 0.1pp | yes |
| 5-10% | 6728 | 7.3% | 6.6% | 0.7pp | yes |
| 10-20% | 5811 | 14.0% | 12.0% | 2.0pp | yes |
| 20-35% | 1402 | 24.5% | 18.0% | 6.5pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10769 gap 0.4pp · 2-5% n=2467 gap 0.1pp · 5-10% n=1738 gap 0.3pp · 10-20% n=1407 gap 1.8pp · 20-35% n=306 gap 6.8pp

### doubles — **STOP** (76271 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.3pp n=6833; 20-35% gap 7.5pp n=4534

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 36242 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 9941 | 3.1% | 2.7% | 0.3pp | yes |
| 5-10% | 6833 | 7.8% | 11.1% | 3.3pp | yes |
| 10-20% | 18667 | 14.8% | 14.9% | 0.1pp | yes |
| 20-35% | 4534 | 23.1% | 15.5% | 7.5pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=9972 gap 0.1pp · 2-5% n=2436 gap 0.7pp · 5-10% n=1727 gap 2.6pp · 10-20% n=5046 gap 0.3pp · 20-35% n=1034 gap 6.4pp

### triples — **STOP** (45402 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.9pp n=6617; 5-10% gap 4.1pp n=1381

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 37300 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 6617 | 3.4% | 1.5% | 1.9pp | yes |
| 5-10% | 1381 | 6.6% | 2.5% | 4.1pp | yes |
| 10-20% | 104 | 11.9% | 3.8% | 8.1pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=10495 gap 0.3pp · 2-5% n=1628 gap 1.9pp · 5-10% n=384 gap 3.7pp · 10-20% n=17 gap 5.4pp

## Axis B — market-ladder scoreboard

1169183 captured rung rows across 38 file(s) → 160799 joined to curves · **145868 settled / 14931 pending** · 88346 disagreements scored (our Brier 0.1491 vs market 0.1468).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
