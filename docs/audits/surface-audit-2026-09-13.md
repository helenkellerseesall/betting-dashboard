# Weekly Surface Audit — 2026-09-13

**4 MISMATCH(ES)** — the record and its surfaces disagree:

| surface | status | detail |
|---|---|---|
| MY BETS | **MISMATCH** | 16 realMoney row(s) ABSENT from the served lens: placed_parlay_1780174312711, placed_parlay_1780176713939, pl_4753b351 |
| TOP PICKS | OK | 0 served picks all trace to the record |
| DAILY 3 | **MISMATCH** | 2026-09-08 Luis Arraez: card win vs twin loss |
| LADDER LAB | **MISMATCH** | endpoint failed to serve |
| /status | **MISMATCH** | health payload MISSING |

## Graduation board (caged → bettable)

**⚠ STALLED: fam_sb, fam_doubles, fam_triples, rung_gate, cure_A, cure_B, cure_C, parlay_gate** — exam counters flat; named rows need a human.

| status | surface | nights | decided | paper units (in-sample) | trend | unlock |
|---|---|---|---|---|---|---|
| **STALLED** | stolenBases exam | 1/1 | 62043/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | doubles exam | 1/1 | 77813/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | triples exam | 1/1 | 46387/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| caged | totalBases exam | 1/1 | 243172/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | rbis exam | 1/1 | 136541/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| **STALLED** | NB ladder / rung-scan gate | 47/14 | 9127/300 | -1048.77u | +0u vs 7 slates ago | 14 nights · 300 decided · pooled gap ≤1.5pp · ≥0u · split-half agreement |
| **STALLED** | scanner cure A (market-blend) | 43/14 | 12012/300 | -1196.38u | +0u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| **STALLED** | scanner cure B (consensus-margin) | 42/14 | 7495/300 | -869.6u | +0u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| **STALLED** | scanner cure C (opposition-cond) | 22/14 | 1790/300 | -279.41u | +0u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| **STALLED** | parlay pricer paper gate | 37/14 | 5859/100 | -5814u | +0u vs 7 slates ago | 14 nights · 100 settled · ≤3pp price error · ≥0u · operator approval |
| caged | market-prob-as-prior (SHADOW logging) | 7/14 | 22304 | — | shadow logging — zero served-surface effect | 3 bars, conjunctive (spec §4): shadow Brier(p_final) ≤ Brier(p_market) AND ≤ Brier(p_model) AND CLV-positive share ≥ current selection — operator makes the flip call with the numbers in hand |

## Daily 3 receipts

chain ✓ INTACT · 35 link(s) on file.

Doctrine: the operator stops being the QA department by design, not luck — mismatches here are critic-grade findings and get root-caused, never hand-fixed.
