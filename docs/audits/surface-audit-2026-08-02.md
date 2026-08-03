# Weekly Surface Audit — 2026-08-02

**2 MISMATCH(ES)** — the record and its surfaces disagree:

| surface | status | detail |
|---|---|---|
| MY BETS | **MISMATCH** | 11 realMoney row(s) ABSENT from the served lens: placed_parlay_1780174312711, placed_parlay_1780176713939, pl_4753b351 |
| TOP PICKS | OK | 0 served picks all trace to the record |
| DAILY 3 | OK | 7 recent cards consistent with their twins |
| LADDER LAB | OK | serves (642 rungs, shadow=true) |
| /status | **MISMATCH** | health payload MISSING |

## Graduation board (caged → bettable)

**⚠ STALLED: fam_sb, fam_doubles, fam_triples, repoint_tb, repoint_rbis** — exam counters flat; named rows need a human.

| status | surface | nights | decided | paper units (in-sample) | trend | unlock |
|---|---|---|---|---|---|---|
| **STALLED** | stolenBases exam | 0/1 | 0/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | doubles exam | 0/1 | 0/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | triples exam | 0/1 | 0/150 | — | refit artifact — advances when the exam re-runs | exam PASS — all eligible buckets within max(1.5pp, 20% relative), n≥150/bucket |
| **STALLED** | totalBases exam | 1/1 | 157093/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| **STALLED** | rbis exam | 1/1 | 88461/150 | — | refit artifact — advances when the exam re-runs | PASS_WITH_CORRECTION maps + the gated runbook re-point + operator approval |
| caged | NB ladder / rung-scan gate | 15/14 | 3017/300 | -257.71u | +3.96u vs 7 slates ago | 14 nights · 300 decided · pooled gap ≤1.5pp · ≥0u · split-half agreement |
| caged | scanner cure columns A/B/C | 15/14 | A:3813 B:1919 C:0/per-column | A:-482.04u B:-146.28u C:0u | -262.28u vs 7 slates ago | per-column gate + counterfactual kill bar (G3-L3) |
| caged | parlay pricer paper gate | 10/14 | 1603/100 | -1603u | -913u vs 7 slates ago | 14 nights · 100 settled · ≤3pp price error · ≥0u · operator approval |
| queued | market-prob-as-prior | — | — | — | n/a | QUEUED — CA spec after gates read green (docket d94d5c9); the board refuses to fake progress on an unstarted experiment |

## Daily 3 receipts

chain ✓ INTACT · 4 link(s) on file.

Doctrine: the operator stops being the QA department by design, not luck — mismatches here are critic-grade findings and get root-caused, never hand-fixed.
