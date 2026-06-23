# POST-FREEZE 25TH EXECUTION RUNBOOK

**Status:** PRE-STAGE (no live change made). **Author:** Claude-B · 2026-06-21.
**Read-order:** `MASTER_BRAIN` → `OPERATOR_PROTOCOL` → `ACTIVE_INCIDENTS` → `PIPELINE_AUTHORITY_MAP` → `ARCHITECTURE_LAWS` → `POST_FREEZE_GRADUATION_PLAN.md` → `POST_FREEZE_SELECTION_REPOINT_SPEC.md` → this runbook.
**Purpose:** make the 06-25 graduation a calm, gated EXECUTE — follow the steps; do not design under pressure.

---

## 0. AUDIT CONFIRMATION (freeze-safety — verified read-only 2026-06-21)

- **All four shadow switches default ON, but the shadow files are UNWIRED into live scoring** — so the live path is byte-identical today. Proof: `MLB_MARGINAL_CALIB`/`MLB_NB_LADDER`/`MLB_CORRELATION`/`MLB_PARLAY` all `?? "1"` (default ON), but `buildMlbPropClusters.js` / `buildSlipAi.js` contain **zero** references to the shadow modules; `verifyShadowStackIntact` + `verifyMarginalCalibration`/`verifyNbLadderStep1`/`verifyCorrelation`/`verifyParlayConstructor` all assert scoring never reads them (all four PASS exit 0, run 2026-06-21).
- **CONSEQUENCE for graduation:** each "apply" is a **wiring code-edit behind a NEW default-OFF switch** (the `CALIB_LINEAWARE` / `MLB_BUCKET_TIER_POLICY` pattern: `String(process.env.X ?? "0") === "1"`), **not** an env flip of the existing switch. Flipping an existing switch does nothing to live scoring (nothing consumes the output). OFF ⇒ byte-identical; ON ⇒ the new wiring.
- **mean→median:** the NB survival ladder exists for **totalBases only** (`buildMlbPlayerDataset.js:314-328`, behind `MLB_NB_LADDER`). hits/rbis/runs have no survival distribution → the true-median fix is **TB-first**; the other families need NB ladders first (composes with extending G2).
- **`buildMlbInspectionBoard.js` has NO env gate** — the re-point there (File B) must ADD a new default-OFF switch.
- **PRESERVED:** `calibrationDampener.js`, `vigStripping.js`, etc. untouched except the operator-approved G1 extension of `calibrationDampener.js`. The four re-point files are NOT in PRESERVED but ARE scoring/selection → kill-switched + version-stamped.
- **Nothing in this runbook changes a live number until a switch flips on/after 06-25 with operator approval.**

**Pre-flight (run first on the 25th):**
```
cd ~/Projects/betting-dashboard/backend && node scripts/g1ReadinessCheck.js && npm run runtime:verify
```
G1 readiness must show **>=14 clean nights** and runtime:verify must be green before ANY flip.

---

## GLOBAL INVARIANTS (every step)
1. Freeze lifted (>=06-25) AND operator approves THIS step. 2. Forward gate PASS on >=14 forward days (not in-sample). 3. New default-OFF switch + version stamp; never delete a switch. 4. One step at a time, watch >=1 week live + CLV, then the next. 5. runtime:verify green after each. 6. Operator-visible close (/status line or a probe they read). 7. Rollback = flip the switch OFF (byte-identical restore) + backend kickstart.

---

## STEP 1 — G1: marginal calibration → live  (THE keystone; do first)

- **Probe (forward gate):**
  ```
  node backend/scripts/probeCalibrationForward.js > .scratch/g1_gate.txt && cat .scratch/g1_gate.txt
  ```
  (For an OOS demo before 14 days accrue: `--retro=<date>`.)
- **PASS criteria (the script prints `G1 GATE: PASS/FAIL`):** forward-days>=14 AND calibrated overall |gap| < raw AND calibrated overall Brier < raw. (Dry-run 2026-06-21, retro cutoff 06-17, 3 fwd days: |gap| 14.4pp→0.9pp, Brier 0.118→0.098, 11/12 cells lower Brier — quality confirmed; gate FAIL only on day-count, exactly as designed.)
- **Apply IF PASS (behind new default-OFF switch `MLB_CALIB_LIVE`):** EXTEND `backend/pipeline/shared/calibrationDampener.js` (PRESERVED, operator-approved) so the multiplier becomes the isotonic remap from `mlbMarginalCalibration.js`, AND wire calibrated `modelProb` into `buildMlbPropClusters` modelProb→edge→tier. Gate the wiring: `const CALIB_LIVE = String(process.env.MLB_CALIB_LIVE ?? "0") === "1"`. OFF ⇒ raw modelProb (today's behavior). Stamp `selectionPolicy`/calib-version on tracked rows.
- **Post-apply verify:** `runtime:verify` green; with switch ON, re-run the probe → confirm live edge/tier now derive from calibrated prob; /status reliability-gap card (raw vs calibrated) shows the change; pick-count unchanged.
- **Rollback:** `MLB_CALIB_LIVE=0` (unset) + backend kickstart → byte-identical.

---

## STEP 2 — N1: mean→median band center  (rank alongside G1; TB-first)

- **Probe (dry-run, real rows):**
  ```
  node backend/scripts/dryrunMeanMedian.js > .scratch/mean_median.txt && cat .scratch/mean_median.txt
  ```
  (Proven 2026-06-21 on 341 real players: current mean-center is ABOVE the true median for **89.4%** (avg +0.552 TB) → over-bets the OVER.) Forward gate: median-centered modelProb must beat mean-centered on reliability gap + Brier on forward days (extend `probeCalibrationForward` to compare centers, or a sibling probe).
- **PASS criteria:** median-centered beats mean-centered on |gap| AND Brier on >=14 forward TB days.
- **Apply IF PASS (behind new default-OFF switch `MLB_MEDIAN_CENTER`):** in `buildMlbPlayerDataset.js:221-222`, when the switch is ON and `_tbNB` exists, set `tbMedian` = the true median read from the NB survival (smallest k where `1 - survival(fit,k+1) >= 0.5`) instead of `round1(eTB)`. OFF ⇒ `round1(eTB)` (today). **TB only** until hits/rbis/runs get NB ladders.
- **Post-apply verify:** runtime:verify green; diff band centers OFF vs ON (TB shifts down for the 89% biased players, hits/rbis/runs unchanged); modelProbForSide OVER probs drop on the biased TB rungs.
- **Rollback:** `MLB_MEDIAN_CENTER=0` + kickstart.
- **Sequence note:** G1 and N1 both touch the cluster scoring path — apply each independently (own switch), measure separately, do NOT bundle.

---

## STEP 3 — G2: NegBinom ladder → live  (totalBases marginal; after G1)

- **Probe (forward gate, BUILT):**
  ```
  node backend/scripts/probeMarginalCalibrationValidation.js > .scratch/g2_gate.txt && cat .scratch/g2_gate.txt
  ```
  Forward by default (train ≤ freeze, validate on days > freeze); `--trainThrough=YYYY-MM-DD` overrides. Prints `G2 GATE: PASS/FAIL`. (Dry-run 2026-06-22: calibrated Brier<raw + |gap| smaller already ok; GATE FAIL only on forward-days=11<14 — re-run once 14 forward days exist.)
- **PASS criteria:** >=14 forward days; NB beats the heuristic ladder on calibration gap + Brier for totalBases.
- **Apply IF PASS (new default-OFF switch `MLB_NB_LADDER_LIVE`):** wire the fitted NB survival into `modelProbForSide` for totalBases (the field `ladderNB` already emits when `MLB_NB_LADDER` is ON; the new switch consumes it in scoring). OFF ⇒ heuristic ladder (today). Module isolation already PASS (verifyNbLadderStep1, exit 0).
- **Post-apply verify:** runtime:verify; TB reliability card; version stamp.
- **Rollback:** `MLB_NB_LADDER_LIVE=0` + kickstart.

---

## STEP 4 — G3: correlation → parlay joint  (after G1; not a bettor surface yet)

- **Probe (forward gate, BUILT):**
  ```
  node backend/scripts/probeCorrelationValidation.js > .scratch/g3_gate.txt && cat .scratch/g3_gate.txt
  ```
  Forward by default; `--trainThrough` overrides. Held-out copula joint Brier vs naive on forward pairs; prints `G3 GATE: PASS/FAIL`. NOTE: this probe uses **RAW** marginals — the FULL gate needs **G1-calibrated** marginals (re-run post-G1, or read the calibrated through-line in `probeMarginalCalibrationValidation` section (b), which already computes copula-with-calibrated).
- **PASS criteria:** >=14 forward days; copula joint beats naive product on Brier with calibrated marginals.
- **Apply IF PASS (new default-OFF switch `MLB_CORRELATION_LIVE`):** let the parlay constructor's same-game joint consume the copula (`jointForPair`). OFF ⇒ product fallback (today; `workstationRoutes` already falls back). Re-fit `ρ_Z` consistent with calibrated marginals.
- **Post-apply verify:** probe dump (copula vs naive Brier) the operator reads; runtime:verify (verifyCorrelation still PASS).
- **Rollback:** `MLB_CORRELATION_LIVE=0` + kickstart.

---

## STEP 5 — G4: parlay constructor → surface  (last; after G1 + G3)

- **Probe (forward gate, BUILT):**
  ```
  node backend/scripts/probeParlayConstructorValidation.js > .scratch/g4_gate.txt && cat .scratch/g4_gate.txt
  ```
  Forward by default; `--trainThrough` overrides. +EV-gated parlay realized ROI on forward dates; prints `G4 GATE: PASS/FAIL/N-A` (N/A = 0 +EV legs surfaced = honest no-edge on an efficient window). Requires **G1 calibration LIVE first** (pre-G1 the in-sample was −42%; the inversion to ≥0 is the gate).
- **PASS criteria:** >=14 forward days; +EV-gated parlays realize >=0 ROI; "bet as singles" comparison shown.
- **Apply IF PASS (new default-OFF switch `MLB_PARLAY_LIVE`):** surface +EV cross-game parlays (never auto-bundle; default singles; same-game = correlation insight only, no SGP price). Wire onto the bettor surface (FE location per capability map).
- **Post-apply verify:** operator-visible parlay card with EV + 7x-singles discipline; runtime:verify.
- **Rollback:** `MLB_PARLAY_LIVE=0` + kickstart. Until PASS it stays shadow and correctly reports "no edge."

---

## STEP 6 — SELECTION RE-POINT  (after G1; per POST_FREEZE_SELECTION_REPOINT_SPEC.md)

Re-points selection from longshot ceilings to the OOS-confirmed obtainable CLV+ rungs, ranked on **G1-calibrated** modelProb. One file at a time, each own switch + version stamp, watch >=1 wk.

- **Probe (dry-run + forward, BUILT):**
  ```
  node backend/scripts/dryrunRepointRescore.js > .scratch/repoint_rescore.txt && cat .scratch/repoint_rescore.txt
  node backend/scripts/forwardClvSliceTracker.js
  ```
  `dryrunRepointRescore.js` (READ-ONLY, real rows) recomputes the spec's signalScore bands and confirms the floor-vs-ceiling FLIP — proven 2026-06-22: CURRENT floor 0.703 < ceiling 0.914 (the bug) → RE-POINT floor 0.900 > ceiling 0.466 (goal). Then `forwardClvSliceTracker.js` (already forward, `FORWARD_CLV_CUTOFF` env) + the edge-hunt OOS probe grouped by line-tier/odds/confidence. Pass = board now surfaces obtainable rungs AND those rungs stay CLV+ on NEW forward days.
- **6A — File A `buildMlbBootstrapSnapshot.js` (signalScore):** behind new default-OFF `MLB_REPOINT_SIGNAL`, invert `computeMlbOverCountingProxyScore.lineSignal` toward the obtainable floor (hits/rbis/runs over0.5 → top score; ceilings demoted) + re-band `payoutSignal` to peak at mod-dog (+100..199); flip `computeMlbHrPathProxyScore.marketShape` for total_bases (o1.5 >= o2.5). **Do NOT invert HR** (HR calibration honest; §6 guardrail).
- **6B — File B `buildMlbInspectionBoard.js` (eligibility):** behind new default-OFF `MLB_REPOINT_ELIGIBILITY` (this file has NO existing gate — add one), remove/invert the `batter_hits over<=0.5 → 0.20` penalty (`:425`); stop hard-excluding obtainable alt-overs (`:486-491`) → route to a floor tier gated by calibrated modelProb + CLV slice; widen safe/upside implied bands for the floor prices. Keep UNDER penalties + absurd-chalk/longshot excludes.
- **6C — File C `buildMlbPropClusters.js` `tierForPlay` v2:** the lever is the INPUT — feed **calibrated** edge/ev (from G1). Minimal predicate change; bump tier stamp `mlb-r2-v1 -> mlb-r2-v2` (`:1163`). modelProb is already threaded-but-unused (`:755`) — wire it only to prefer obtainable CLV+ cells.
- **Order:** G1 graduated → 6A → 6B → 6C. Integrity guardrail: exclude single-actor micro-markets / low-limit two-way props from any newly-surfaced floor set.
- **Rollback:** each switch OFF (byte-identical) + kickstart; revert any flip whose forward CLV does not hold.

---

## STEP 7 — N2 (optional, low priority): graduate devigAnalytics into LIVE analytics (additive, never scoring)
Wire FanDuel-weighted Power consensus as an ADDITIVE line-shop field beside the canonical consensus; never replaces `vigStripping.js`, never feeds scoring. Pre-req: pair over/under groups in `buildLineShoppingIntelligence.js`. Freeze-safe anytime post-freeze; trust/correctness, not a large edge.

---

## ROLLBACK SUMMARY (any step)
Every "apply" is behind a default-OFF switch. To revert: unset the switch (or `=0`) + `launchctl kickstart -k gui/$(id -u)/com.motel666.backend`. OFF = byte-identical to pre-graduation. runtime:verify must be green after revert. Each version stamp makes the change filterable + measurable in the 14d verify.

## WHAT'S PROVEN NOW vs WHAT RUNS ON THE 25TH
- PROVEN now (real output): G1 gate (probeCalibrationForward, retro OOS |gap| 14.4→0.9pp, Brier .118→.098); mean→median bias (89.4% of 341 players); G1–G4 module isolation (verify* exit 0, OFF byte-identical); runtime:verify 22/22.
- ALL FORWARD GATES BUILT + RUN (2026-06-22, honest current state — every one FAILs only on forward-days<14): G2 `probeMarginalCalibrationValidation` (calibrated beats raw ok; 11 fwd days); G3 `probeCorrelationValidation` (copula vs naive, raw marginals; 11 fwd days); G4 `probeParlayConstructorValidation` (ROI on 9 fwd days; needs G1 live); re-point `dryrunRepointRescore` (FLIP confirmed: floor 0.703<0.914 → 0.900>0.466).
- RUNS ON THE 25TH (this runbook): each forward gate on >=14 real forward days → PASS/FAIL → the gated apply (each apply behind a NEW default-OFF switch).
- REMAINING (minor, do at N1 time): the median-CENTER forward comparison (extend `probeCalibrationForward` to compare median- vs mean-centered modelProb on reliability gap + Brier) — N1's own gate. Not needed before G1.
