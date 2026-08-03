# G2-L2 Walk-Forward Validation Report — 2026-08-03

Read-only over season gamelog caches (529 batters, 246 pitchers, newest game 2026-08-01) + 17 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 1.1pp | 0.08847 | 660825 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (103662 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 22594 | 1.0% | 0.7% | 0.3pp | yes |
| 2-5% | 15159 | 3.2% | 2.5% | 0.7pp | yes |
| 5-10% | 13900 | 7.2% | 6.2% | 1.0pp | yes |
| 10-20% | 13169 | 14.7% | 14.8% | 0.1pp | yes |
| 20-35% | 13751 | 26.0% | 25.4% | 0.7pp | yes |
| 35-50% | 7665 | 43.6% | 47.3% | 3.7pp | yes |
| 50-100% | 17424 | 59.8% | 61.2% | 1.3pp | yes |

Last-30d slice (reporting only): 0-2% n=7759 gap 0.3pp · 2-5% n=4303 gap 0.8pp · 5-10% n=3942 gap 1.6pp · 10-20% n=3699 gap 0.6pp · 20-35% n=3992 gap 1.1pp · 35-50% n=2079 gap 2.1pp · 50-100% n=5030 gap 0.9pp

### totalBases — **PASS_WITH_CORRECTION** (193192 walk-forward pairs)
raw curve STOP (1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 1.5pp n=28932) but the bucket-corrected re-fit PASSES on the held-out half (all 7 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 36708 | 1.2% | 1.5% | 0.3pp | yes |
| 2-5% | 37583 | 3.3% | 3.9% | 0.6pp | yes |
| 5-10% | 28932 | 7.2% | 8.8% | 1.5pp | yes |
| 10-20% | 29153 | 14.4% | 16.5% | 2.1pp | yes |
| 20-35% | 23892 | 26.7% | 27.3% | 0.5pp | yes |
| 35-50% | 15688 | 42.0% | 40.9% | 1.1pp | yes |
| 50-100% | 21236 | 62.9% | 58.7% | 4.2pp | yes |

Last-30d slice (reporting only): 0-2% n=12482 gap 0.1pp · 2-5% n=11227 gap 0.2pp · 5-10% n=8583 gap 0.7pp · 10-20% n=8401 gap 1.2pp · 20-35% n=7017 gap 0.8pp · 35-50% n=4674 gap 1.5pp · 50-100% n=6017 gap 4.7pp

### rbis — **PASS_WITH_CORRECTION** (108662 walk-forward pairs)
raw curve STOP (1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 50-100% gap 19.2pp n=353) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 36626 | 1.0% | 1.4% | 0.4pp | yes |
| 2-5% | 20556 | 3.3% | 3.9% | 0.6pp | yes |
| 5-10% | 15438 | 7.2% | 8.3% | 1.1pp | yes |
| 10-20% | 14099 | 14.1% | 14.9% | 0.8pp | yes |
| 20-35% | 14934 | 27.5% | 26.9% | 0.6pp | yes |
| 35-50% | 6656 | 39.9% | 31.9% | 7.9pp | yes |
| 50-100% | 353 | 53.2% | 34.0% | 19.2pp | yes |

Last-30d slice (reporting only): 0-2% n=11832 gap 0.3pp · 2-5% n=6020 gap 0.2pp · 5-10% n=4557 gap 0.7pp · 10-20% n=4023 gap 0.3pp · 20-35% n=4415 gap 1.3pp · 35-50% n=1837 gap 7.8pp · 50-100% n=30 gap 18.2pp

### runs — **PASS** (86712 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 27565 | 0.8% | 0.8% | 0.0pp | yes |
| 2-5% | 12853 | 3.3% | 3.1% | 0.2pp | yes |
| 5-10% | 12278 | 7.2% | 6.8% | 0.5pp | yes |
| 10-20% | 9449 | 13.8% | 13.8% | 0.0pp | yes |
| 20-35% | 12238 | 28.4% | 31.3% | 2.9pp | yes |
| 35-50% | 10937 | 41.3% | 40.2% | 1.2pp | yes |
| 50-100% | 1392 | 53.6% | 45.3% | 8.3pp | yes |

Last-30d slice (reporting only): 0-2% n=8930 gap 0.2pp · 2-5% n=3667 gap 0.5pp · 5-10% n=3462 gap 0.8pp · 10-20% n=2683 gap 1.1pp · 20-35% n=3509 gap 1.3pp · 35-50% n=3335 gap 1.4pp · 50-100% n=258 gap 8.5pp

### ks — **PASS** (20365 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 512 | 1.4% | 1.6% | 0.2pp | yes |
| 2-5% | 1465 | 3.5% | 4.0% | 0.5pp | yes |
| 5-10% | 2108 | 7.4% | 7.5% | 0.2pp | yes |
| 10-20% | 2637 | 14.5% | 14.8% | 0.3pp | yes |
| 20-35% | 2602 | 27.1% | 29.8% | 2.7pp | yes |
| 35-50% | 2016 | 42.2% | 43.2% | 1.0pp | yes |
| 50-100% | 9025 | 81.4% | 82.5% | 1.1pp | yes |

Last-30d slice (reporting only): 0-2% n=264 gap 0.6pp · 2-5% n=675 gap 0.6pp · 5-10% n=799 gap 0.4pp · 10-20% n=976 gap 0.1pp · 20-35% n=948 gap 2.6pp · 35-50% n=763 gap 1.2pp · 50-100% n=3350 gap 0.5pp

### stolenBases — **STOP** (49190 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.1pp n=1183

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 29979 | 0.4% | 1.0% | 0.6pp | yes |
| 2-5% | 7630 | 3.4% | 3.4% | 0.1pp | yes |
| 5-10% | 5549 | 7.3% | 6.5% | 0.7pp | yes |
| 10-20% | 4811 | 14.1% | 12.0% | 2.0pp | yes |
| 20-35% | 1183 | 24.5% | 18.4% | 6.1pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=9356 gap 0.5pp · 2-5% n=2245 gap 0.5pp · 5-10% n=1584 gap 0.5pp · 10-20% n=1187 gap 0.8pp · 20-35% n=280 gap 4.0pp

### doubles — **STOP** (62331 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.4pp n=5632; 20-35% gap 7.9pp n=3865

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 29381 | 0.7% | 0.8% | 0.1pp | yes |
| 2-5% | 8283 | 3.1% | 2.8% | 0.2pp | yes |
| 5-10% | 5632 | 7.7% | 11.2% | 3.4pp | yes |
| 10-20% | 15116 | 14.8% | 15.2% | 0.3pp | yes |
| 20-35% | 3865 | 23.1% | 15.1% | 7.9pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=8951 gap 0.2pp · 2-5% n=2185 gap 0.4pp · 5-10% n=1569 gap 2.1pp · 10-20% n=4443 gap 0.4pp · 20-35% n=1059 gap 7.5pp · 35-50% n=1 gap 37.3pp

### triples — **STOP** (36711 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.8pp n=5444; 5-10% gap 4.0pp n=1118

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 30055 | 0.2% | 0.8% | 0.6pp | yes |
| 2-5% | 5444 | 3.3% | 1.6% | 1.8pp | yes |
| 5-10% | 1118 | 6.5% | 2.5% | 4.0pp | yes |
| 10-20% | 94 | 12.0% | 4.3% | 7.8pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=9294 gap 0.3pp · 2-5% n=1522 gap 1.2pp · 5-10% n=291 gap 4.1pp · 10-20% n=8 gap 1.4pp

## Axis B — market-ladder scoreboard

522578 captured rung rows across 17 file(s) → 73054 joined to curves · **61546 settled / 11508 pending** · 37835 disagreements scored (our Brier 0.1478 vs market 0.1464).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
