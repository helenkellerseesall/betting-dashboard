# G1 / STEP 1 EXECUTION BRIEF — wire marginal calibration LIVE

**Written by Claude-A · 2026-07-01 · for a FRESH CB chat to execute cold and unhurried.**
This is the keystone flip. It supplements `docs/POST_FREEZE_25TH_RUNBOOK.md` §STEP 1 (the authority) with the *verified* file map + the verification caveat the runbook one-liner hides. Read the runbook §STEP 1 + GLOBAL INVARIANTS first, then this.

## STATUS: UNBLOCKED — the gate PASSES
- `probeCalibrationForward.js` on the live DB (2026-07-01): **14/14 forward days** (06-16..06-29, 14,293 OOS rows), overall **|gap| 15.6pp → 0.2pp**, **Brier 0.102 → 0.079**, **11/12 family cells better** → prints `G1 GATE: PASS`.
- Pre-flight green: `g1ReadinessCheck.js` = READY (15/14 forward), `npm run runtime:verify` = 22/22.
- Nothing expires. The gate stays READY until executed.

## THE TASK
Wire the validated MLB marginal (isotonic) calibration into the LIVE scoring path, behind a NEW default-OFF switch `MLB_CALIB_LIVE`. OFF ⇒ byte-identical to today. ON ⇒ live edge/tier derive from calibrated modelProb.

## VERIFIED FILE MAP (paths confirmed 2026-07-01 — the runbook's shorthand is imprecise; use THIS)
- **EXTEND (PRESERVED — operator pre-approved for the G1 extension only):** `backend/pipeline/shared/calibrationDampener.js`. When `MLB_CALIB_LIVE` is ON, the multiplier becomes the isotonic remap.
- **The isotonic remap logic lives in:** `backend/pipeline/shared/isotonicCalibration.js` (NOT inside a single `mlbMarginalCalibration.js` as the runbook implies).
- **The fitted maps (per family × side, PAVA, trainThrough window):** `backend/config/mlbMarginalCalibration.json`.
- **The existing shadow module / MLB_MARGINAL_CALIB gate (exists, at):** `backend/pipeline/mlb/mlbMarginalCalibration.js` — reconcile how it composes with the dampener; do NOT env-flip `MLB_MARGINAL_CALIB` (it is unwired to scoring — a no-op).
- **Wire calibrated modelProb into scoring here:** `backend/pipeline/mlb/buildMlbPropClusters.js` (modelProb → edge → tier).
- **Also present in the dampener:** multiple calibration paths (id-join, line-aware ladder, `_load`/`_loadLineAware`, `CALIB_LINEAWARE` default-ON). Map how the new isotonic multiplier composes with the already-live line-aware path BEFORE editing — this is the intricate part.

## THE SWITCH
`const CALIB_LIVE = String(process.env.MLB_CALIB_LIVE ?? "0") === "1"` (the `CALIB_LINEAWARE` pattern). Never delete a switch. Stamp `selectionPolicy` / calib-version on tracked rows so the change is filterable in the 14-day verify.

## CRITICAL VERIFICATION CAVEAT (why this can't be rushed — CB's correct insight)
The default-OFF byte-identical proof only proves the OFF path (= today's behavior). It does **NOT** exercise the ON-path calibration logic, which stays dormant until flipped. So a subtle error in the ON wiring would be invisible until the flip, then silently corrupt calibration. **Both halves are required before "done":**
1. **OFF proof:** land with `MLB_CALIB_LIVE` unset → `runtime:verify` green + pick output byte-identical to pre-edit.
2. **ON proof (operator-gated):** flip `MLB_CALIB_LIVE=1` + kickstart → re-run `probeCalibrationForward` → confirm live edge/tier now derive from calibrated prob → `/status` reliability-gap card (raw vs calibrated) shows the change → pick-count unchanged.

## EXECUTION SEQUENCE
1. Read-first (git log, newest OPERATOR_SESSION_LOG.md blocks, runbook §STEP 1 + invariants, this brief).
2. Pre-flight: `cd backend && node scripts/g1ReadinessCheck.js && npm run runtime:verify` (must be green).
3. Study the dampener's calibration paths + how the isotonic remap (isotonicCalibration.js + the JSON maps) composes with `CALIB_LINEAWARE`. Map the exact edit before writing.
4. Write the change behind `MLB_CALIB_LIVE` (default OFF). **STOP. Show the operator the full diff.**
5. Prove OFF: `runtime:verify` green + pick output unchanged.
6. **Operator approves → flip `MLB_CALIB_LIVE=1` + kickstart → run the ON proof (above).**
7. Commit + push + append a `## Claude-B` block. Watch ≥1 week live + CLV before N1.

## DISCIPLINE
One step only (do NOT touch N1/G2/G3/G4). PRESERVED file → diff shown before landing. Verification = non-zero probe output, never code-diff alone. Rollback = unset `MLB_CALIB_LIVE` (=0) + `launchctl kickstart -k gui/$(id -u)/com.motel666.backend` → byte-identical.
