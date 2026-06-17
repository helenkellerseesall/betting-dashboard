# POST-FREEZE GRADUATION PLAN — shadow → live scoring

**Owner:** Claude-B + operator. **Written:** 2026-06-15. **Status:** PLAN (no graduation has occurred).
**Read-order:** anchored in `backend/runtime/brain/MASTER_BRAIN.md` (CURRENT PROJECT PHASE) + `PRESERVED.md` §"SANCTIONED SHADOW STACK". This is the route off "trash picks / zero edge" — **it must not live only in chat.**

**Companion spec (the SELECTION re-point, gated behind G1):** `docs/POST_FREEZE_SELECTION_REPOINT_SPEC.md` — execution-ready, per-file (buildMlbBootstrapSnapshot signalScore proxies · buildMlbInspectionBoard eligibility gates · buildMlbPropClusters tierForPlay) plan to re-point selection from longshot ceilings to the OOS-confirmed obtainable CLV+ rungs. Depends on G1 graduating first (re-point ranks on calibrated modelProb). Execute after G1.

## Why this exists

The R2 MLB scoring freeze (started 2026-06-11 ~16:36 ET, ~14 days → **lifts ~2026-06-25**) froze the picks so the base is measurable. During the freeze we built four kill-switched **shadow** engines (see PRESERVED.md): NegBinom ladders, Gaussian-copula correlation, isotonic marginal calibration, EV-gated parlay constructor. They feed nothing live. Graduation = turning them on in the live scoring path, **one at a time, each behind a forward-validation gate**, after the freeze.

**The load-bearing finding that sets the order:** the parlay constructor validation (docs/audits/2026-06-15-t2-parlay-constructor) showed the +EV-gated set realized **−17% (singles) / −42% (parlays)** — because `modelProb` is overconfident *at the +EV selection margin*. So **calibration is the keystone**: nothing downstream is trustworthy until the marginal is honest where the gate bites. Calibration graduates first; everything else is gated behind it.

## Invariants for EVERY graduation step (non-negotiable)

1. **Freeze must be lifted** (≥ 2026-06-25) AND **operator approves the specific step**. No graduation during the freeze.
2. **Forward-validation gate** — the shadow must beat the incumbent on **held-out / forward** data (not in-sample) on the named metric below, before it touches a live number.
3. **Kill-switch + version stamp preserved** — graduation flips the default, never removes the switch; tracked rows carry a version tag (R2 `tierPolicy` pattern) so the change is measurable and reversible.
4. **Extend the canonical owner, never fork** (Law 1) — esp. calibration EXTENDS `calibrationDampener.js` (PRESERVED); do not leave a permanent parallel.
5. **runtime:verify green** (incl. `verifyShadowStackIntact`) + a NEW post-graduation fixture asserting the live wiring.
6. **Operator-visible close** (CB addendum) — a `/status` diagnostic line or a probe the operator runs/reads; state plainly what changed on `/m`. A code-diff + fixtures alone is NOT the close.
7. **One step at a time** — graduate, watch ≥1 week of live + CLV, then the next. Never bundle.

## Ordered graduation steps

### Step G1 — Marginal calibration → live (THE keystone; do first)
- **Shadow:** `mlbMarginalCalibration.js` (`MLB_MARGINAL_CALIB`) + `isotonicCalibration.js` + `mlbMarginalCalibration.json`.
- **Action:** EXTEND `backend/pipeline/shared/calibrationDampener.js` (PRESERVED — operator-approved edit) so its multiplier becomes the isotonic remap, AND wire the calibrated `modelProb` onto the cluster scoring path (`buildMlbPropClusters` modelProb → edge → tier). This is a SCORING change.
- **Pre-req refinement (from the −17%/−42% finding):** calibration must be honest **at the +EV selection margin** — add finer granularity (per family×bucket where n allows) and/or per-leg shrinkage; re-derive `mlbMarginalCalibration.json` on the full accrued window.
- **Forward gate:** on ≥14 days of FORWARD graded data, calibrated `modelProb` beats raw on **reliability gap** (|stated−realized| → near 0) AND **Brier**, AND the +EV-selected legs no longer realize materially negative (the −17% must move toward ≥0). Probe: extend `probeMarginalCalibrationValidation.js` to read forward-only rows.
- **Close:** /status reliability-gap card (raw vs calibrated) + the version stamp on tracked rows.

### Step G2 — NegBinom ladder → live (totalBases marginal)
- **Shadow:** `negBinomLadder.js` (`MLB_NB_LADDER`).
- **Action:** replace the heuristic totalBases ladder in projection with the fitted NB survival, consumed by `modelProbForSide` (SCORING change).
- **Forward gate:** ≥14 days forward — NB beats the heuristic ladder on calibration + Brier for totalBases (probe: `probe_t2_nbladder_validation`). Only after G1 (NB feeds the marginal calibration consumes).
- **Close:** /status totalBases reliability card + version stamp.

### Step G3 — Correlation → live (feeds the parlay joint)
- **Shadow:** `mlbCorrelationEngine.js` (`MLB_CORRELATION`) + `gaussianCopula.js` + `mlbCorrelationPriors.json`.
- **Action:** let the parlay constructor's same-game joint consume the copula (still not a bettor surface yet).
- **Forward gate:** with G1-calibrated marginals, held-out copula joint beats naive product on Brier for co-occurring settled pairs (it was at parity on raw marginals — re-test post-calibration). Re-fit `ρ_Z` consistently with calibrated marginals.
- **Close:** probe dump (copula vs naive Brier, calibrated marginals) the operator reads.

### Step G4 — Parlay constructor → live surface (last)
- **Shadow:** `mlbParlayConstructor.js` (`MLB_PARLAY`).
- **Action:** surface +EV cross-game parlays (never auto-bundle; default singles; same-game = correlation insight only, no SGP price). Wire onto the bettor surface (depends on FE location — see capability map).
- **Forward gate:** the +EV-gated set realizes **≥0 ROI on forward data** (the in-sample −42% must invert), with calibration (G1) live. Until then it stays shadow and correctly reports "no edge."
- **Close:** operator-visible parlay card with the EV + the "bet as singles" comparison (the 7×-singles discipline).

## What graduation is NOT
- Not a flip of all four at once. Not during the freeze. Not on in-sample numbers. Not a deletion of the kill-switches. Not a parallel calibrator (extend the dampener).

## If a fresh chat reads this
Order is **G1 → G2 → G3 → G4**, each gated by forward validation + operator approval, freeze lifted. Calibration first because the parlay −17%/−42% proved the marginal is the bottleneck. The shadow files are in PRESERVED.md §"SANCTIONED SHADOW STACK" and guarded by `verifyShadowStackIntact`.
