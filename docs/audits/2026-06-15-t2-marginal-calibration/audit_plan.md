# T2 — Shadow Marginal Calibration (Track 1) — Audit + Phase-1 Plan

**Author:** Claude-B [Cowork, Opus 4.8]
**Date:** 2026-06-14 ~17:10 ET (clock-checked `TZ='America/New_York' date`)
**Mode:** AUDIT-FIRST — read-only. No production code changed. One discovery probe in `.scratch/` (informational).
**Goal:** make `modelProb` honest (it is ~16pp overconfident). FREEZE-SAFE shadow layer; live ship only post-freeze (~06-25) + operator approval. The PRESERVED dampener is NOT modified in v1.

---

## 0. Headline — the dampener is dormant on every value path

The brief's premise was "the dampener already dampens modelProb yet it's still overconfident." The audit shows something sharper and more actionable: **the calibration dampener is computed but never applied to the `modelProb` that feeds edge / tier / persistence / corpus.** It is wired into exactly one place — `backend/routes/workstationRoutes.js:67-68` — and there it only sets a *display label* (`c.calibrationStatus = "calibrated"/"calibrated_shown_raw"/"uncalibrated"`) by checking whether the dampener *would* move the value. It never replaces `modelProb` with the dampened number.

So `modelProb` is overconfident for two compounding reasons:
1. **It is never calibrated on the path that matters** — the scoring `modelProb` (edge → tier → tracked_bets → corpus) is raw (only a fixed `0.65` shrink-toward-0.5, `buildMlbPropClusters.js:651`).
2. **Even if the dampener were wired in, it could not fix the shape** — it is a single **clamped linear multiplier** (`dampenModelProb = mp × multiplier`, `calibrationDampener.js:569`, multiplier ∈ [0.40, 1.10] line-aware / [0.20, 1.10] id-join). A linear scale cannot correct a nonlinear reliability curve, and the floor caps dampening on the most-overconfident buckets.

This unifies all three proofs (R2 anti-predictive tiers, inverted ladder, correlation Brier losing to naive): they all measure the **raw** `modelProb`, which the calibration layer never touches.

---

## 1. What the dampener does (and why residual remains)

`backend/pipeline/shared/calibrationDampener.js` (700 lines, PRESERVED, Phase Calibration-Dampener-1B):
- **Method:** `multiplier = realized_hit_rate / avg_stated_model_prob`, clamped `_clampMultiplier` to [`MULTIPLIER_FLOOR`, `MULTIPLIER_CEILING`] = [0.20, 1.10] (`:81-82`), or floor 0.40 line-aware (`:92`). `dampenModelProb(mp,…) = mp × multiplier` (`:569`).
- **Corpus:** SQLite `prediction_snapshots × outcome_snapshots` joined on id (`_queryCorpus :204`, `AVG(model_prob) AS stated, AVG(os.hit) AS realized`, `GROUP BY sport, stat_family, side` `:241`); line-aware variant adds `line` (`_queryCorpusLineAware :359`). 5-min cache.
- **Granularity:** per (sport, family, side[, lineBucket]); MIN_SAMPLE 20 (side) / 30 (family) / 25 (line) → thin buckets **no-op (multiplier 1 = no dampening)**.
- **CALIB_LINEAWARE** (`:103`): `"0"` → id-join path (line-agnostic, floor 0.20); else line-aware (floor 0.40). Read once at load; `[CALIB-BOOT]` log.
- **Why residual (3 reasons):** (a) **not wired** onto the scoring/persistence/corpus `modelProb` (§0); (b) **linear-only** — one multiplier can't remap a nonlinear curve (see §2 deciles); (c) **floor clamp + thin-bucket no-ops** — the worst buckets are under-corrected or untouched.

The corpus stores RAW `model_prob` (`intelligence.js:671/694`), so the dampener's own `stated` = raw avg — it *measures* the overconfidence but its result is discarded.

---

## 2. Residual overconfidence quantified (`.scratch/probe_marginal_reliability.js`, 14 days, 13,351 settled)

**OVERALL: stated mean modelProb 0.281 vs realized 0.121 → +16.1pp overconfident.**

Reliability is **nonlinear** (a linear multiplier cannot fix this):

| modelProb bin | n | stated | realized | gap |
|---|---|---|---|---|
| 0.0–0.1 | 216 | 0.011 | 0.056 | **−4.5** (under) |
| 0.1–0.2 | 3946 | 0.184 | 0.050 | +13.4 |
| 0.2–0.3 | 6441 | 0.232 | 0.063 | +16.9 |
| 0.3–0.4 | 330 | 0.336 | 0.091 | +24.5 |
| 0.4–0.5 | 392 | 0.451 | 0.334 | +11.7 |
| 0.5–0.6 | 832 | 0.553 | 0.357 | +19.6 |
| 0.6–0.7 | 1194 | 0.661 | 0.451 | +20.9 |

**Per family** (gap, n): outs +29.8 (201) · ks +25.0 (938) · runs +16.4 (1292) · rbis +16.1 (2243) · hits +16.0 (3592) · totalBases +14.9 (4518) · **hr +3.7 (552, ~calibrated)**. Pitcher families are worst; HR is near-honest (matches R2). → calibration must be **per-family**.

**Per odds bucket** (gap): mod_fav +22.8 · mod_dog +16.7 · longshot +15.6 · heavy_fav +8.9. → bucket matters too (mod_fav worst = R2's toxic mid-fav).

**Honest sample sizes:** dense in the low region (0.1–0.3 = 10k rows); thin in the high region (0.3–0.5 ≈ 720). Per-family fits are well-supported (≥500 except outs 201); per-(family×bucket) will be thin for some cells → needs a fallback ladder + shrinkage.

---

## 3. Method — shadow recalibration

**Recommendation: isotonic regression (PAVA) per family**, with a sample-fallback ladder and shrinkage toward identity on thin bins.

- **Isotonic (Pool-Adjacent-Violators)** — nonparametric monotone map raw→calibrated. Handles the nonlinear curve (§2), and **monotone ⇒ preserves ranking** (won't scramble relative edges). Pure JS, no scipy.
- vs **Platt** (logistic fit): parametric/smoother on thin data but assumes a sigmoid; our curve isn't cleanly sigmoidal (low bin is under-confident). vs **binned reliability remap**: crude, noisy at bin edges. → isotonic is the cleanest defensible v1; Platt is the thin-data fallback if a family's isotonic is too steppy.
- **Fallback ladder:** (family × odds-bucket) if n≥MIN, else family, else global. Shrink toward identity when a bin's n is small (`calibrated = w·iso + (1−w)·raw`, w from n) so thin cells don't overcorrect.

**Composition with the dampener (the Law 1 question):** because the dampener is NOT on the scoring path (§0), the shadow calibrator does not "sit on top of" it — it remaps the RAW `modelProb` directly. The dampener is the **canonical calibration authority**, so the EVENTUAL LIVE change (post-freeze) should **EXTEND it**: replace its clamped-linear multiplier with the isotonic remap AND wire the result onto the cluster `modelProb` (`modelProbForSide` consumers). v1 does NOT touch the PRESERVED file — it builds the method as a shadow module and proves it; the reconciliation INTO the dampener is a separate, operator-approved, post-freeze phase. (Flagged so we don't leave a permanent parallel calibrator — Law 1.)

---

## 4. Shadow plug-in (freeze-safe)

- **NEW `backend/pipeline/shared/isotonicCalibration.js`** — pure PAVA `fitIsotonic(points)` + `predict(map, x)` (monotone step + linear interp). Sport-agnostic primitive (reusable, like gaussianCopula.js). No IO/state.
- **NEW `backend/config/mlbMarginalCalibration.json`** — committed per-family (and per-bucket where n allows) isotonic maps + sample sizes + caveat, derived by a script from the corpus/ledger (like `mlbCorrelationPriors.json`).
- **NEW `backend/pipeline/mlb/mlbMarginalCalibration.js`** — `calibrateModelProb(modelProb, family, side?, bucket?)` → calibrated prob via the fallback ladder. Kill-switch `MLB_MARGINAL_CALIB` (MLB_NB_LADDER pattern, default ON, `"0"`=off, `[MLB-MARGINAL-CALIB-BOOT]`). Marginal-agnostic consumer; **computes `modelProbCalibrated` alongside; feeds NOTHING live.**
- **PRESERVED/freeze check:** all NEW files; `calibrationDampener.js` NOT modified; `buildMlbPropClusters` / `modelProbForSide` / edge / tier / `phase4Tracking` untouched. R2 + T2-L1 + correlation shadow intact.

---

## 5. Validation (two cross-checks)

`backend/scripts/probeMarginalCalibrationValidation.js`:
- **(a) Calibrated beats raw** — refit isotonic on train days, predict held-out: held-out **Brier** + **reliability gap** (|stated−realized|) for calibrated vs raw `modelProb`. Expect calibrated ≪ raw on gap, lower Brier.
- **(b) THE through-line** — re-run the correlation validation with **calibrated marginals**: feed `calibrateModelProb(modelProb,…)` as `p1/p2` into the copula and recompute Brier(copula) vs Brier(naive product). **If the copula now beats naive, calibration has unlocked the parlay layer** — the direct proof that Track 1 is the keystone for Step 3. (Recall: with raw modelProb, copula lost to naive purely because the marginal was overconfident — §correlation audit.)
- Honest limits: 14 days, thin high-modelProb region; forward-validation accrues post-ship. Right file `mlb_tracked_bets_<slate>` (graded), 4 AM ET slate boundary, `closeOdds`.

---

## 6. Scope (v1)

**IN:** MLB `modelProb` SHADOW calibration (isotonic per-family/bucket) + validation. **OUT:** any live dampener change or scoring wire (post-freeze + approval); NBA; parlay constructor/EV/Kelly; touching the PRESERVED dampener.

---

## 7. Phase-1 plan + kill-switch + fixture + matrix

**Build (after operator approval — NOT this pass):**
1. `backend/pipeline/shared/isotonicCalibration.js` — pure PAVA fit/predict + inline self-tests.
2. `backend/scripts/deriveMlbMarginalCalibration.js` → `backend/config/mlbMarginalCalibration.json` (per-family/bucket maps from the corpus; caveat in `_doc`).
3. `backend/pipeline/mlb/mlbMarginalCalibration.js` — `calibrateModelProb` + fallback ladder + kill-switch `MLB_MARGINAL_CALIB`.
4. `backend/scripts/verifyMarginalCalibration.js` fixture → SUITES (**17 → 18**): isotonic monotonicity; calibrated reliability-gap < raw on a known overconfident synthetic curve; fallback ladder; kill-switch OFF; **FREEZE GUARD** (buildMlbPropClusters / modelProbForSide / phase4Tracking / calibrationDampener reference nothing in the new module; scoring byte-identical).
5. `backend/scripts/probeMarginalCalibrationValidation.js` — (a) + (b) above → `.scratch/last.txt`.
6. Brain docs (Law 12): MODEL_EVOLUTION_LOG, PIPELINE_AUTHORITY_MAP (new shadow marginal-calibration authority + the **flag** that live integration extends the dampener), MASTER_BRAIN, RUNTIME_FACTS (kill-switch).

**Freeze/kill-safety:** shadow-only; OFF ⇒ no calibrated field; nothing live reads it; `runtime:verify` stays green (R2 + NB-ladder + correlation + seasonGate untouched). **Deploy:** standalone module + probe → no live reload needed; verify via probe real output.

**Flagged for later (operator-approved, post-freeze):** wire the calibrated `modelProb` onto the scoring path AND reconcile the method into the canonical dampener (replace clamped-linear multiplier with isotonic; apply on cluster path). That is the change that actually fixes edge/tier — and it is a SCORING change, gated by the freeze.

---

## 8. Build results (2026-06-14 — operator approved: shadow build)

Built: `backend/pipeline/shared/isotonicCalibration.js` (PAVA + Platt, self-test 8/8), `backend/pipeline/mlb/mlbMarginalCalibration.js` (kill-switch `MLB_MARGINAL_CALIB`, fallback ladder + shrink-to-identity), `backend/config/mlbMarginalCalibration.json` (global + 7 families + bucket sub-maps, from `deriveMlbMarginalCalibration.js`), fixture `verifyMarginalCalibration.js` (12/12; matrix 17→18, full `runtime:verify` **18/18**), validation `probeMarginalCalibrationValidation.js`.

**Validation (real output, `.scratch/last.txt`, held-out: train 9d / test 5d, maps refit on TRAIN only):**
- **(a) Calibrated decisively beats raw** — held-out Brier **0.111 → 0.088**; reliability gap collapses from **15.8pp** (stated 0.291 vs realized 0.133) to **0.26pp** (stated 0.135 vs realized 0.133). The marginal is now honest out-of-sample. ✅
- **(b) Through-line — brought to PARITY, not a clean unlock** — correlation joint Brier on held-out pairs: under RAW marginals copula 0.010516 vs naive 0.009353 (copula +12% worse); under CALIBRATED marginals copula 0.007268 vs naive 0.007249 (copula +0.3% — a dead heat), with BOTH absolute Briers down ~22%. So calibration is clearly the prerequisite and nearly closes the gap, but the copula does NOT yet beat naive on this thin window.
- **Why (b) isn't a clean win yet (honest):** the pair population is dominated by weakly-correlated same-team pairs (ρ_Z≈+0.12) where copula≈naive; the strongly-correlated same-hitter pairs are a minority; the ρ_Z priors are from the full window (mild in-sample leak); ~14 days is thin and within-game-clustered. Refitting ρ_Z consistently with calibrated marginals + weighting the strong-correlation pairs + more data are the path to crossing.

**Honest conclusion:** marginal calibration is the keystone and works decisively on its own (a); it brings the parlay layer to parity (b) but does not by itself make the copula beat naive yet. SHADOW-only; the live fix (wire calibrated modelProb onto edge/tier + fold into the dampener) is a scoring change gated by the R2 freeze. R2 + T2-L1 + correlation freeze intact (verify 18/18; scoring/PRESERVED reference nothing in the shadow).
