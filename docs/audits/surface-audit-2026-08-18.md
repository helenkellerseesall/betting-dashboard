# Weekly Surface Audit — 2026-08-18

**3 MISMATCH(ES)** — the record and its surfaces disagree:

| surface | status | detail |
|---|---|---|
| MY BETS | **MISMATCH** | 16 realMoney row(s) ABSENT from the served lens: placed_parlay_1780174312711, placed_parlay_1780176713939, pl_4753b351 |
| TOP PICKS | OK | 0 served picks all trace to the record |
| DAILY 3 | OK | 7 recent cards consistent with their twins |
| LADDER LAB | **MISMATCH** | endpoint failed to serve |
| /status | **MISMATCH** | health payload MISSING |

## Graduation board (caged → bettable)

**⚠ STALLED: fam_sb, fam_doubles, fam_triples** — exam counters flat; named rows need a human.

| status | surface | nights | decided | paper units (in-sample) | trend | unlock |
|---|---|---|---|---|---|---|
| **STALLED** | stolenBases exam | 1/1 | 49190/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | doubles exam | 1/1 | 62331/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | triples exam | 1/1 | 36711/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| caged | totalBases exam | 1/1 | 193192/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | rbis exam | 1/1 | 108662/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | NB ladder / rung-scan gate | 32/14 | 7119/300 | -750.67u | -228.7u vs 7 slates ago | 14 nights · 300 decided · pooled gap ≤1.5pp · ≥0u · split-half agreement |
| caged | scanner cure A (market-blend) | 27/14 | 9036/300 | -897.33u | -240.23u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | scanner cure B (consensus-margin) | 27/14 | 5651/300 | -593.39u | -199.98u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | scanner cure C (opposition-cond) | 7/14 | 796/300 | -124.6u | -124.6u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | parlay pricer paper gate | 27/14 | 4658/100 | -4613u | -1220u vs 7 slates ago | 14 nights · 100 settled · ≤3pp price error · ≥0u · operator approval |
| caged | market-prob-as-prior (SHADOW logging) | 1/14 | 2236 | — | shadow logging — zero served-surface effect | 3 bars, conjunctive (spec §4): shadow Brier(p_final) ≤ Brier(p_market) AND ≤ Brier(p_model) AND CLV-positive share ≥ current selection — operator makes the flip call with the numbers in hand |

## Daily 3 receipts

chain ✓ INTACT · 19 link(s) on file.

Doctrine: the operator stops being the QA department by design, not luck — mismatches here are critic-grade findings and get root-caused, never hand-fixed.
