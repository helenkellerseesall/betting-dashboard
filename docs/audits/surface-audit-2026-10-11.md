# Weekly Surface Audit — 2026-10-11

**2 MISMATCH(ES)** — the record and its surfaces disagree:

| surface | status | detail |
|---|---|---|
| MY BETS | **MISMATCH** | 16 realMoney row(s) ABSENT from the served lens: placed_parlay_1780174312711, placed_parlay_1780176713939, pl_4753b351 |
| TOP PICKS | OK | 0 served picks all trace to the record |
| DAILY 3 | OK | 7 recent cards consistent with their twins |
| LADDER LAB | OK | serves (0 rungs, shadow=true) |
| /status | **MISMATCH** | health payload MISSING |

## Graduation board (caged → bettable)

**⚠ STALLED: fam_sb, fam_doubles, fam_triples, parlay_gate** — exam counters flat; named rows need a human.

| status | surface | nights | decided | paper units (in-sample) | trend | unlock |
|---|---|---|---|---|---|---|
| **STALLED** | stolenBases exam | 1/1 | 64774/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | doubles exam | 1/1 | 81200/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | triples exam | 1/1 | 48415/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| caged | totalBases exam | 1/1 | 253891/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | rbis exam | 1/1 | 142436/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | NB ladder / rung-scan gate | 70/14 | 10524/300 | -1221.66u | -35.25u vs 7 slates ago | 14 nights · 300 decided · pooled gap ≤1.5pp · ≥0u · split-half agreement |
| caged | scanner cure A (market-blend) | 65/14 | 14321/300 | -1303.86u | -35u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | scanner cure B (consensus-margin) | 65/14 | 8798/300 | -1015.23u | -51.45u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | scanner cure C (opposition-cond) | 45/14 | 2568/300 | -334.44u | -22.86u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| **STALLED** | parlay pricer paper gate | 50/14 | 5910/100 | -5865u | +0u vs 7 slates ago | 14 nights · 100 settled · ≤3pp price error · ≥0u · operator approval |
| caged | market-prob-as-prior (SHADOW logging) | 18/14 | 38849 | — | shadow logging — zero served-surface effect | 3 bars, conjunctive (spec §4): shadow Brier(p_final) ≤ Brier(p_market) AND ≤ Brier(p_model) AND CLV-positive share ≥ current selection — operator makes the flip call with the numbers in hand |

## Daily 3 receipts

chain ✓ INTACT · 50 link(s) on file.

Doctrine: the operator stops being the QA department by design, not luck — mismatches here are critic-grade findings and get root-caused, never hand-fixed.
