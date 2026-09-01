# Weekly Surface Audit — 2026-08-30

**4 MISMATCH(ES)** — the record and its surfaces disagree:

| surface | status | detail |
|---|---|---|
| MY BETS | **MISMATCH** | 16 realMoney row(s) ABSENT from the served lens: placed_parlay_1780174312711, placed_parlay_1780176713939, pl_4753b351 |
| TOP PICKS | OK | 0 served picks all trace to the record |
| DAILY 3 | **MISMATCH** | 2026-08-20 Henry Bolte: card win vs twin loss |
| LADDER LAB | **MISMATCH** | endpoint failed to serve |
| /status | **MISMATCH** | health payload MISSING |

## Graduation board (caged → bettable)

**⚠ STALLED: fam_sb, fam_doubles, fam_triples, rung_gate, cure_A, cure_B, cure_C, parlay_gate** — exam counters flat; named rows need a human.

| status | surface | nights | decided | paper units (in-sample) | trend | unlock |
|---|---|---|---|---|---|---|
| **STALLED** | stolenBases exam | 1/1 | 61455/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | doubles exam | 1/1 | 77136/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | triples exam | 1/1 | 45932/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| caged | totalBases exam | 1/1 | 240900/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | rbis exam | 1/1 | 135298/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| **STALLED** | NB ladder / rung-scan gate | 39/14 | 8901/300 | -1027.69u | -139.89u vs 7 slates ago | 14 nights · 300 decided · pooled gap ≤1.5pp · ≥0u · split-half agreement |
| **STALLED** | scanner cure A (market-blend) | 34/14 | 11700/300 | -1156.94u | -255.33u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| **STALLED** | scanner cure B (consensus-margin) | 34/14 | 7280/300 | -852.99u | -139.21u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| **STALLED** | scanner cure C (opposition-cond) | 14/14 | 1653/300 | -227.13u | -43.1u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| **STALLED** | parlay pricer paper gate | 33/14 | 5847/100 | -5802u | -642u vs 7 slates ago | 14 nights · 100 settled · ≤3pp price error · ≥0u · operator approval |
| caged | market-prob-as-prior (SHADOW logging) | 7/14 | 9719 | — | shadow logging — zero served-surface effect | 3 bars, conjunctive (spec §4): shadow Brier(p_final) ≤ Brier(p_market) AND ≤ Brier(p_model) AND CLV-positive share ≥ current selection — operator makes the flip call with the numbers in hand |

## Daily 3 receipts

chain ✓ INTACT · 25 link(s) on file.

Doctrine: the operator stops being the QA department by design, not luck — mismatches here are critic-grade findings and get root-caused, never hand-fixed.
