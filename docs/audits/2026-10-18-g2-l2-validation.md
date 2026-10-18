# G2-L2 Walk-Forward Validation Report — 2026-10-18

Read-only over season gamelog caches (574 batters, 271 pitchers, newest game 2026-09-27) + 79 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| none **← FROZEN v1** | 0.9pp | 0.08623 | 912226 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (143052 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 32578 | 0.9% | 0.6% | 0.3pp | yes |
| 2-5% | 20732 | 3.3% | 2.5% | 0.7pp | yes |
| 5-10% | 18990 | 7.2% | 6.1% | 1.1pp | yes |
| 10-20% | 17930 | 14.8% | 14.5% | 0.3pp | yes |
| 20-35% | 18563 | 26.0% | 25.1% | 0.9pp | yes |
| 35-50% | 10542 | 43.5% | 46.4% | 2.9pp | yes |
| 50-100% | 23717 | 59.8% | 60.8% | 1.0pp | yes |

Last-30d slice (reporting only): 0-2% n=3400 gap 0.4pp · 2-5% n=1833 gap 0.8pp · 5-10% n=1673 gap 1.4pp · 10-20% n=1566 gap 2.0pp · 20-35% n=1559 gap 1.0pp · 35-50% n=988 gap 0.5pp · 50-100% n=2035 gap 0.6pp

### totalBases — **PASS** (267406 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 53498 | 1.1% | 1.3% | 0.2pp | yes |
| 2-5% | 51590 | 3.3% | 3.7% | 0.4pp | yes |
| 5-10% | 39576 | 7.2% | 8.6% | 1.3pp | yes |
| 10-20% | 39863 | 14.4% | 16.1% | 1.7pp | yes |
| 20-35% | 32633 | 26.7% | 26.6% | 0.1pp | yes |
| 35-50% | 21631 | 42.0% | 40.1% | 1.9pp | yes |
| 50-100% | 28615 | 62.8% | 58.4% | 4.4pp | yes |

Last-30d slice (reporting only): 0-2% n=5654 gap 0.1pp · 2-5% n=4652 gap 0.3pp · 5-10% n=3463 gap 1.1pp · 10-20% n=3430 gap 0.9pp · 20-35% n=2847 gap 1.4pp · 35-50% n=1864 gap 1.9pp · 50-100% n=2367 gap 4.2pp

### rbis — **PASS_WITH_CORRECTION** (149991 walk-forward pairs)
raw curve STOP (2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 35-50% gap 8.1pp n=8575; 50-100% gap 19.5pp n=383) but the bucket-corrected re-fit PASSES on the held-out half (all 6 eligible buckets within the bar); correction map committed — consumption requires the gated runbook re-point

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 52062 | 0.9% | 1.3% | 0.4pp | yes |
| 2-5% | 27967 | 3.3% | 3.8% | 0.5pp | yes |
| 5-10% | 21085 | 7.2% | 8.2% | 0.9pp | yes |
| 10-20% | 19003 | 14.0% | 14.5% | 0.5pp | yes |
| 20-35% | 20916 | 27.5% | 26.9% | 0.7pp | yes |
| 35-50% | 8575 | 39.8% | 31.7% | 8.1pp | yes |
| 50-100% | 383 | 53.2% | 33.7% | 19.5pp | yes |

Last-30d slice (reporting only): 0-2% n=5088 gap 0.1pp · 2-5% n=2435 gap 0.7pp · 5-10% n=1706 gap 0.4pp · 10-20% n=1656 gap 0.1pp · 20-35% n=2015 gap 0.2pp · 35-50% n=561 gap 8.1pp · 50-100% n=9 gap 29.5pp

### runs — **PASS** (119248 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 39031 | 0.8% | 0.8% | 0.1pp | yes |
| 2-5% | 17280 | 3.3% | 2.9% | 0.3pp | yes |
| 5-10% | 16835 | 7.3% | 6.8% | 0.5pp | yes |
| 10-20% | 12580 | 13.7% | 13.5% | 0.2pp | yes |
| 20-35% | 16740 | 28.4% | 30.9% | 2.5pp | yes |
| 35-50% | 15138 | 41.3% | 39.7% | 1.6pp | yes |
| 50-100% | 1644 | 53.5% | 45.7% | 7.8pp | yes |

Last-30d slice (reporting only): 0-2% n=3858 gap 0.1pp · 2-5% n=1307 gap 0.3pp · 5-10% n=1575 gap 0.1pp · 10-20% n=957 gap 1.3pp · 20-35% n=1494 gap 2.2pp · 35-50% n=1361 gap 2.4pp · 50-100% n=65 gap 2.6pp

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

### stolenBases — **STOP** (68270 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 20-35% gap 6.2pp n=1537

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 42236 | 0.4% | 0.9% | 0.5pp | yes |
| 2-5% | 10451 | 3.5% | 3.3% | 0.2pp | yes |
| 5-10% | 7516 | 7.3% | 6.6% | 0.7pp | yes |
| 10-20% | 6492 | 13.9% | 11.8% | 2.1pp | yes |
| 20-35% | 1537 | 24.5% | 18.3% | 6.2pp | yes |
| 35-50% | 38 | 36.5% | 21.1% | 15.4pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=4028 gap 0.2pp · 2-5% n=897 gap 1.1pp · 5-10% n=650 gap 0.4pp · 10-20% n=556 gap 2.2pp · 20-35% n=109 gap 3.9pp

### doubles — **STOP** (85484 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 3.1pp n=7801; 20-35% gap 7.5pp n=4808

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 40969 | 0.7% | 0.7% | 0.0pp | yes |
| 2-5% | 10863 | 3.1% | 2.8% | 0.3pp | yes |
| 5-10% | 7801 | 7.8% | 10.8% | 3.1pp | yes |
| 10-20% | 20989 | 14.8% | 14.8% | 0.1pp | yes |
| 20-35% | 4808 | 23.0% | 15.5% | 7.5pp | yes |
| 35-50% | 54 | 37.8% | 20.4% | 17.5pp | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=3953 gap 0.0pp · 2-5% n=758 gap 0.7pp · 5-10% n=818 gap 1.4pp · 10-20% n=1903 gap 0.6pp · 20-35% n=231 gap 6.4pp

### triples — **STOP** (50972 walk-forward pairs)
2 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 2-5% gap 1.9pp n=7399; 5-10% gap 4.2pp n=1432

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 42036 | 0.3% | 0.8% | 0.5pp | yes |
| 2-5% | 7399 | 3.4% | 1.5% | 1.9pp | yes |
| 5-10% | 1432 | 6.6% | 2.4% | 4.2pp | yes |
| 10-20% | 105 | 11.9% | 4.8% | 7.2pp | thin |
| 20-35% | 0 | — | — | — | thin |
| 35-50% | 0 | — | — | — | thin |
| 50-100% | 0 | — | — | — | thin |

Last-30d slice (reporting only): 0-2% n=3934 gap 0.3pp · 2-5% n=649 gap 2.0pp · 5-10% n=30 gap 6.0pp

## Axis B — market-ladder scoreboard

2197028 captured rung rows across 79 file(s) → 305884 joined to curves · **194861 settled / 111023 pending** · 117662 disagreements scored (our Brier 0.1484 vs market 0.1463).



## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
