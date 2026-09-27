# G2-L2 Walk-Forward Validation Report — 2026-09-27

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-09-26) + 70 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 1.0pp | 0.08679 | 846221 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (132250 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 29652 | 1.0% | 0.6% | 0.3pp | yes |
| 2-5% | 19255 | 3.2% | 2.5% | 0.8pp | yes |
| 5-10% | 17602 | 7.3% | 6.2% | 1.1pp | yes |
| 10-20% | 16694 | 14.7% | 14.6% | 0.2pp | yes |
| 20-35% | 17251 | 26.1% | 25.1% | 1.0pp | yes |
| 35-50% | 9790 | 43.5% | 46.6% | 3.1pp | yes |
| 50-100% | 22006 | 59.8% | 60.8% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=707 gap 0.5pp · 2-5% n=477 gap 1.4pp · 5-10% n=398 gap 1.3pp · 10-20% n=434 gap 5.1pp · 20-35% n=342 gap 2.2pp · 35-50% n=288 gap 1.4pp · 50-100% n=473 gap 0.4pp

### totalBases — **PASS** (247453 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 48837 | 1.1% | 1.3% | 0.2pp | yes |
| 2-5% | 47774 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 36715 | 7.2% | 8.6% | 1.3pp | yes |
| 10-20% | 37032 | 14.4% | 16.1% | 1.7pp | yes |
| 20-35% | 30271 | 26.7% | 26.7% | 0.0pp | yes |
| 35-50% | 20125 | 42.0% | 40.2% | 1.8pp | yes |
| 50-100% | 26699 | 62.9% | 58.4% | 4.5pp | yes |

Last-30d slice (reporting only): 0-2% n=1380 gap 0.5pp · 2-5% n=1143 gap 0.4pp · 5-10% n=839 gap 0.1pp · 10-20% n=840 gap 0.6pp · 20-35% n=686 gap 2.4pp · 35-50% n=463 gap 0.2pp · 50-100% n=612 gap 8.1pp

### rbis — **PASS_WITH_CORRECTION** (138858 walk-forward pairs)
raw curve STOP (2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 35-50% gap 8.0pp n=8098; 50-100% gap 19.2pp n=377) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 47832 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 25985 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 19681 | 7.2% | 8.1% | 0.9pp | yes |
| 10-20% | 17613 | 14.1% | 14.6% | 0.5pp | yes |
| 20-35% | 19272 | 27.5% | 26.7% | 0.8pp | yes |
| 35-50% | 8098 | 39.9% | 31.9% | 8.0pp | yes |
| 50-100% | 377 | 53.2% | 34.0% | 19.2pp | yes |

Last-30d slice (reporting only): 0-2% n=1215 gap 0.2pp · 2-5% n=603 gap 1.9pp · 5-10% n=427 gap 0.3pp · 10-20% n=370 gap 0.3pp · 20-35% n=506 gap 2.5pp · 35-50% n=120 gap 6.1pp · 50-100% n=3 gap 17.7pp

### runs — **PASS** (110391 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 35749 | 0.8% | 0.7% | 0.1pp | yes |
| 2-5% | 16155 | 3.3% | 2.9% | 0.3pp | yes |
| 5-10% | 15558 | 7.2% | 6.7% | 0.5pp | yes |
| 10-20% | 11810 | 13.7% | 13.6% | 0.1pp | yes |
| 20-35% | 15468 | 28.4% | 30.9% | 2.5pp | yes |
| 35-50% | 14050 | 41.3% | 39.7% | 1.6pp | yes |
| 50-100% | 1601 | 53.5% | 45.7% | 7.9pp | yes |

Last-30d slice (reporting only): 0-2% n=838 gap 0.2pp · 2-5% n=278 gap 0.1pp · 5-10% n=410 gap 0.3pp · 10-20% n=235 gap 1.7pp · 20-35% n=336 gap 1.1pp · 35-50% n=357 gap 5.2pp · 50-100% n=25 gap 11.1pp

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

### stolenBases — **STOP** (63160 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.4pp n=1447

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 38891 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 9753 | 3.5% | 3.4% | 0.1pp | yes |
| 5-10% | 6951 | 7.3% | 6.7% | 0.6pp | yes |
| 10-20% | 6080 | 14.0% | 11.9% | 2.1pp | yes |
| 20-35% | 1447 | 24.6% | 18.2% | 6.4pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=957 gap 0.2pp · 2-5% n=245 gap 2.1pp · 5-10% n=133 gap 5.9pp · 10-20% n=189 gap 3.3pp · 20-35% n=29 gap 1.6pp

### doubles — **STOP** (79076 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.3pp n=7166; 20-35% gap 7.6pp n=4588

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 37683 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 10193 | 3.1% | 2.7% | 0.3pp | yes |
| 5-10% | 7166 | 7.8% | 11.1% | 3.3pp | yes |
| 10-20% | 19392 | 14.8% | 14.9% | 0.1pp | yes |
| 20-35% | 4588 | 23.1% | 15.5% | 7.6pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=927 gap 0.1pp · 2-5% n=140 gap 0.1pp · 5-10% n=231 gap 2.4pp · 10-20% n=449 gap 0.4pp · 20-35% n=17 gap 15.4pp

### triples — **STOP** (47230 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.8pp n=6918; 5-10% gap 4.2pp n=1403

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 38804 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 6918 | 3.4% | 1.5% | 1.8pp | yes |
| 5-10% | 1403 | 6.6% | 2.4% | 4.2pp | yes |
| 10-20% | 105 | 11.9% | 4.8% | 7.2pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=958 gap 0.1pp · 2-5% n=211 gap 0.8pp · 5-10% n=10 gap 6.4pp

## Axis B — market-ladder scoreboard

2133715 captured rung rows across 70 file(s) → 298099 joined to curves · **161612 settled / 136487 pending** · 97873 disagreements scored (our Brier 0.1485 vs market 0.1463).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
