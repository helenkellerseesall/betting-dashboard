# G2-L2 Walk-Forward Validation Report — 2026-07-16

Read-only over season gamelog caches (506 batters, 220 pitchers, newest game 2026-07-12) + 1 captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.

## Half-life bake-off (out-of-sample tail calibration)

| config | pooled n-weighted \|gap\| | pooled Brier | pairs |
|---|---|---|---|
| hl10 | 1.4pp | 0.10626 | 415833 |
| hl20 | 1.2pp | 0.10561 | 415833 |
| hl40 | 1.2pp | 0.10545 | 415833 |
| none **← FROZEN v1** | 1.2pp | 0.10543 | 415833 |

**Frozen v1 constant: halfLife = none (unweighted)** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).

## Per-family verdicts (at the frozen config)

PASS bar: every bucket with n≥150 must have |stated−realized| ≤ max(1.5pp, 20% relative).

### hits — **PASS** (84568 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 17718 | 1.0% | 0.7% | 0.3pp | yes |
| 2-5% | 12535 | 3.2% | 2.5% | 0.8pp | yes |
| 5-10% | 11446 | 7.2% | 6.4% | 0.8pp | yes |
| 10-20% | 10888 | 14.7% | 14.9% | 0.2pp | yes |
| 20-35% | 11280 | 26.1% | 25.5% | 0.6pp | yes |
| 35-50% | 6384 | 43.6% | 48.1% | 4.4pp | yes |
| 50-100% | 14317 | 59.9% | 61.2% | 1.3pp | yes |

Last-30d slice (reporting only): 0-2% n=7964 gap 0.3pp · 2-5% n=4826 gap 1.0pp · 5-10% n=4324 gap 1.0pp · 10-20% n=4015 gap 0.7pp · 20-35% n=4336 gap 0.4pp · 35-50% n=2385 gap 4.4pp · 50-100% n=5393 gap 1.2pp

### totalBases — **STOP** (157093 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 5-10% gap 1.9pp n=23648

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 28967 | 1.2% | 1.6% | 0.5pp | yes |
| 2-5% | 30592 | 3.3% | 4.1% | 0.8pp | yes |
| 5-10% | 23648 | 7.2% | 9.1% | 1.9pp | yes |
| 10-20% | 23992 | 14.4% | 16.8% | 2.4pp | yes |
| 20-35% | 19571 | 26.8% | 27.6% | 0.8pp | yes |
| 35-50% | 12784 | 42.0% | 41.1% | 1.0pp | yes |
| 50-100% | 17539 | 62.9% | 58.8% | 4.1pp | yes |

Last-30d slice (reporting only): 0-2% n=13381 gap 0.3pp · 2-5% n=12137 gap 0.7pp · 5-10% n=9148 gap 1.8pp · 10-20% n=9194 gap 2.6pp · 20-35% n=7567 gap 0.8pp · 35-50% n=4926 gap 1.5pp · 50-100% n=6575 gap 3.6pp

### rbis — **STOP** (88461 walk-forward pairs)
1 bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): 50-100% gap 19.5pp n=338

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 29333 | 1.0% | 1.5% | 0.5pp | yes |
| 2-5% | 16822 | 3.3% | 4.0% | 0.7pp | yes |
| 5-10% | 12557 | 7.2% | 8.5% | 1.3pp | yes |
| 10-20% | 11696 | 14.1% | 15.3% | 1.2pp | yes |
| 20-35% | 12120 | 27.6% | 27.2% | 0.4pp | yes |
| 35-50% | 5595 | 39.9% | 31.9% | 8.0pp | yes |
| 50-100% | 338 | 53.3% | 33.7% | 19.5pp | yes |

Last-30d slice (reporting only): 0-2% n=12767 gap 0.5pp · 2-5% n=6429 gap 0.9pp · 5-10% n=4739 gap 1.2pp · 10-20% n=4482 gap 0.9pp · 20-35% n=4679 gap 0.9pp · 35-50% n=2043 gap 6.8pp · 50-100% n=48 gap 17.7pp

### runs — **PASS** (70760 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 22030 | 0.8% | 0.9% | 0.0pp | yes |
| 2-5% | 10652 | 3.3% | 3.3% | 0.0pp | yes |
| 5-10% | 10081 | 7.2% | 7.0% | 0.3pp | yes |
| 10-20% | 7805 | 13.9% | 14.1% | 0.2pp | yes |
| 20-35% | 10068 | 28.3% | 31.8% | 3.5pp | yes |
| 35-50% | 8892 | 41.4% | 40.5% | 1.0pp | yes |
| 50-100% | 1232 | 53.7% | 45.5% | 8.2pp | yes |

Last-30d slice (reporting only): 0-2% n=9619 gap 0.0pp · 2-5% n=4138 gap 0.1pp · 5-10% n=3643 gap 0.1pp · 10-20% n=2942 gap 0.8pp · 20-35% n=3800 gap 3.7pp · 35-50% n=3576 gap 0.7pp · 50-100% n=308 gap 8.4pp

### ks — **PASS** (14951 walk-forward pairs)
all 7 eligible buckets within the bar

| stated bucket | n | stated | realized | gap | in verdict |
|---|---|---|---|---|---|
| 0-2% | 311 | 1.4% | 2.3% | 0.9pp | yes |
| 2-5% | 966 | 3.5% | 4.5% | 0.9pp | yes |
| 5-10% | 1533 | 7.4% | 7.8% | 0.4pp | yes |
| 10-20% | 1936 | 14.6% | 15.0% | 0.5pp | yes |
| 20-35% | 1930 | 27.1% | 29.6% | 2.5pp | yes |
| 35-50% | 1475 | 42.3% | 43.0% | 0.7pp | yes |
| 50-100% | 6800 | 81.6% | 82.4% | 0.8pp | yes |

Last-30d slice (reporting only): 0-2% n=219 gap 1.4pp · 2-5% n=584 gap 0.8pp · 5-10% n=842 gap 1.2pp · 10-20% n=993 gap 2.1pp · 20-35% n=996 gap 4.5pp · 35-50% n=770 gap 2.3pp · 50-100% n=3579 gap 0.5pp

## Axis B — market-ladder scoreboard

820 captured rung rows across 1 file(s) → 283 joined to curves · **0 settled / 283 pending** · 0 disagreements scored.

HONEST STATUS: the ladder store is night-one thin — no settled rungs yet. The scoreboard is SEEDED and accumulates 3 passes/day; it becomes decision-grade with settled volume, and the L3 gate already requires it.

## Honest caveats

- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.
- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.
- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).
