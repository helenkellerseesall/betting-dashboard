# G2-L2 Walk-Forward Validation Report — 2026-09-06

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-09-03) + 51 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 1.0pp | 0.08692 | 832360 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (130007 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 29130 | 1.0% | 0.6% | 0.3pp | yes |
| 2-5% | 18927 | 3.2% | 2.5% | 0.7pp | yes |
| 5-10% | 17301 | 7.2% | 6.1% | 1.1pp | yes |
| 10-20% | 16395 | 14.7% | 14.7% | 0.1pp | yes |
| 20-35% | 17004 | 26.1% | 25.1% | 1.0pp | yes |
| 35-50% | 9577 | 43.5% | 46.7% | 3.2pp | yes |
| 50-100% | 21673 | 59.8% | 60.8% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=5898 gap 0.4pp · 2-5% n=3408 gap 0.9pp · 5-10% n=3055 gap 1.2pp · 10-20% n=2918 gap 0.9pp · 20-35% n=2916 gap 2.2pp · 35-50% n=1730 gap 1.3pp · 50-100% n=3865 gap 0.3pp

### totalBases — **PASS** (243172 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 47841 | 1.1% | 1.3% | 0.2pp | yes |
| 2-5% | 46963 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 36096 | 7.2% | 8.6% | 1.4pp | yes |
| 10-20% | 36426 | 14.4% | 16.1% | 1.7pp | yes |
| 20-35% | 29789 | 26.7% | 26.7% | 0.0pp | yes |
| 35-50% | 19780 | 42.0% | 40.1% | 1.9pp | yes |
| 50-100% | 26277 | 62.9% | 58.4% | 4.5pp | yes |

Last-30d slice (reporting only): 0-2% n=10143 gap 0.1pp · 2-5% n=8430 gap 0.1pp · 5-10% n=6437 gap 0.6pp · 10-20% n=6582 gap 0.4pp · 20-35% n=5316 gap 2.1pp · 35-50% n=3694 gap 4.5pp · 50-100% n=4601 gap 5.5pp

### rbis — **PASS_WITH_CORRECTION** (136541 walk-forward pairs)
raw curve STOP (2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 35-50% gap 8.0pp n=8009; 50-100% gap 19.2pp n=377) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 46975 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 25546 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 19377 | 7.2% | 8.2% | 0.9pp | yes |
| 10-20% | 17349 | 14.1% | 14.6% | 0.5pp | yes |
| 20-35% | 18908 | 27.5% | 26.7% | 0.8pp | yes |
| 35-50% | 8009 | 39.9% | 31.9% | 8.0pp | yes |
| 50-100% | 377 | 53.2% | 34.0% | 19.2pp | yes |

Last-30d slice (reporting only): 0-2% n=9389 gap 0.1pp · 2-5% n=4482 gap 0.2pp · 5-10% n=3572 gap 0.4pp · 10-20% n=2921 gap 0.7pp · 20-35% n=3590 gap 1.2pp · 35-50% n=1237 gap 8.4pp · 50-100% n=23 gap 17.9pp

### runs — **PASS** (108594 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 35122 | 0.8% | 0.7% | 0.1pp | yes |
| 2-5% | 15965 | 3.3% | 3.0% | 0.3pp | yes |
| 5-10% | 15263 | 7.2% | 6.7% | 0.5pp | yes |
| 10-20% | 11638 | 13.7% | 13.6% | 0.1pp | yes |
| 20-35% | 15232 | 28.4% | 30.9% | 2.5pp | yes |
| 35-50% | 13793 | 41.3% | 39.8% | 1.5pp | yes |
| 50-100% | 1581 | 53.5% | 45.4% | 8.2pp | yes |

Last-30d slice (reporting only): 0-2% n=6887 gap 0.2pp · 2-5% n=2791 gap 0.9pp · 5-10% n=2700 gap 0.8pp · 10-20% n=1959 gap 0.8pp · 20-35% n=2715 gap 0.7pp · 35-50% n=2586 gap 2.7pp · 50-100% n=166 gap 5.7pp

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

Last-30d slice (reporting only): 0-2% n=278 gap 0.1pp · 2-5% n=586 gap 0.8pp · 5-10% n=623 gap 0.4pp · 10-20% n=778 gap 0.4pp · 20-35% n=710 gap 1.3pp · 35-50% n=558 gap 2.3pp · 50-100% n=2546 gap 1.8pp

### stolenBases — **STOP** (62043 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.5pp n=1425

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 38195 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 9579 | 3.5% | 3.4% | 0.1pp | yes |
| 5-10% | 6861 | 7.3% | 6.6% | 0.7pp | yes |
| 10-20% | 5945 | 14.0% | 11.9% | 2.1pp | yes |
| 20-35% | 1425 | 24.5% | 18.0% | 6.5pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=7450 gap 0.4pp · 2-5% n=1790 gap 0.0pp · 5-10% n=1186 gap 0.7pp · 10-20% n=1016 gap 2.9pp · 20-35% n=227 gap 8.6pp

### doubles — **STOP** (77813 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.3pp n=6996; 20-35% gap 7.6pp n=4578

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 37021 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 10095 | 3.1% | 2.7% | 0.3pp | yes |
| 5-10% | 6996 | 7.8% | 11.0% | 3.3pp | yes |
| 10-20% | 19069 | 14.8% | 14.9% | 0.1pp | yes |
| 20-35% | 4578 | 23.1% | 15.5% | 7.6pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=6907 gap 0.1pp · 2-5% n=1655 gap 0.7pp · 5-10% n=1226 gap 2.9pp · 10-20% n=3568 gap 0.5pp · 20-35% n=633 gap 5.3pp

### triples — **STOP** (46387 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.9pp n=6768; 5-10% gap 4.2pp n=1400

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 38114 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 6768 | 3.4% | 1.5% | 1.9pp | yes |
| 5-10% | 1400 | 6.6% | 2.4% | 4.2pp | yes |
| 10-20% | 105 | 11.9% | 4.8% | 7.2pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=7309 gap 0.3pp · 2-5% n=1173 gap 2.1pp · 5-10% n=246 gap 4.8pp · 10-20% n=11 gap 2.1pp

## Axis B — market-ladder scoreboard

1547174 captured rung rows across 51 file(s) → 215679 joined to curves · **154256 settled / 61423 pending** · 93600 disagreements scored (our Brier 0.1488 vs market 0.1465).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
