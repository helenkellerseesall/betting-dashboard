# Weekly Surface Audit — 2026-08-23

**4 MISMATCH(ES)** — the record and its surfaces disagree:

| surface | status | detail |
|---|---|---|
| MY BETS | **MISMATCH** | 16 realMoney row(s) ABSENT from the served lens: placed_parlay_1780174312711, placed_parlay_1780176713939, pl_4753b351 |
| TOP PICKS | OK | 0 served picks all trace to the record |
| DAILY 3 | **MISMATCH** | 2026-08-20 Henry Bolte: card win vs twin loss |
| LADDER LAB | **MISMATCH** | endpoint failed to serve |
| /status | **MISMATCH** | health payload MISSING |

## Graduation board (caged → bettable)

All caged surfaces advancing.

| status | surface | nights | decided | paper units (in-sample) | trend | unlock |
|---|---|---|---|---|---|---|
| caged | stolenBases exam | 1/1 | 60751/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| caged | doubles exam | 1/1 | 76271/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| caged | triples exam | 1/1 | 45402/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| caged | totalBases exam | 1/1 | 238098/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | rbis exam | 1/1 | 133725/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | NB ladder / rung-scan gate | 36/14 | 8304/300 | -965.45u | -280.03u vs 7 slates ago | 14 nights · 300 decided · pooled gap ≤1.5pp · ≥0u · split-half agreement |
| caged | scanner cure A (market-blend) | 31/14 | 10894/300 | -1025.28u | -91u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | scanner cure B (consensus-margin) | 31/14 | 6755/300 | -787.98u | -228.67u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | scanner cure C (opposition-cond) | 11/14 | 1362/300 | -217.83u | -106.75u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | parlay pricer paper gate | 31/14 | 5542/100 | -5497u | -1338u vs 7 slates ago | 14 nights · 100 settled · ≤3pp price error · ≥0u · operator approval |
| caged | market-prob-as-prior (SHADOW logging) | 5/14 | 6993 | — | shadow logging — zero served-surface effect | 3 bars, conjunctive (spec §4): shadow Brier(p_final) ≤ Brier(p_market) AND ≤ Brier(p_model) AND CLV-positive share ≥ current selection — operator makes the flip call with the numbers in hand |

## Daily 3 receipts

chain ✓ INTACT · 23 link(s) on file.

Doctrine: the operator stops being the QA department by design, not luck — mismatches here are critic-grade findings and get root-caused, never hand-fixed.
