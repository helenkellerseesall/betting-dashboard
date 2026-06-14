# T2 Step 2 — Correlation Engine — Audit + Phase-1 Plan

**Author:** Claude-B [Cowork, Opus 4.8]
**Date:** 2026-06-14 ~15:51 ET (clock-checked `TZ='America/New_York' date`)
**Mode:** AUDIT-FIRST — read-only. No production code changed. One discovery probe written to `.scratch/` (informational only).
**Reference:** docs/research/2026-06-11-parlay-ladder-playbook.md §1 (method) + §7 (build order, item 2).
**Freeze posture:** additive/shadow ON TOP of existing per-leg probabilities. Does NOT change single-prop modelProb/edge/tier. R2 MLB scoring freeze (until ~2026-06-25) and T2-L1 NB shadow remain intact — same posture as the NB ladder.

---

## 0. Headline

The thesis is **empirically confirmed from our own graded ledger** (probe `.scratch/probe_t2_correlation_discovery.js`, 14 days, 13,351 settled legs, 114 settled games):

- **Positive correlation is real and strong for same-hitter family pairs** — e.g. same hitter HR-over × TB-over: realized joint **5.0%** vs naive product **0.7%** (lift ×6.9, φ **+0.554**); hits-over × TB-over φ **+0.496**; HR × RBIs φ **+0.408**.
- **Negative correlation is real for the classic trap** — pitcher-Ks-over × OPPOSING-hitter-over: realized joint **0.5%** vs product **1.1%** (lift **0.48**, φ **−0.061**). Parlaying them is strictly worse than independence — exactly the sign the engine must enforce.
- **Mild positive for same-team two-hitter overs** (φ +0.039).

So a naive product is wrong in BOTH directions, and our ledger recovers the sign. v1 should be the simplest engine that prices a correctly-correlated, **sign-enforced**, validated 2-leg joint probability — as a shadow layer.

**Law 1 flag (important — the brief assumed greenfield, it is not):** a correlation/joint-probability subsystem ALREADY exists — `backend/pipeline/nba/nbaCorrelationEngine.js` (`jointProbabilityWithCorrelation`), wired into `buildSlipAi.js`. But it is (a) NBA-only (explicitly gated `sport==="nba"`), (b) a **heuristic positive-only boost** `joint = product·(1 + 0.22·avgBoost)` with hand-tuned constants — it can only RAISE joint, never lower it (no sign enforcement), and (c) a sort tie-breaker capped 0.04, not a calibrated EV input. It is NOT a copula and NOT data-driven. See §4 for the placement recommendation that respects Law 1 + Law 28 rather than spawning a parallel authority.

---

## 1. Leg-prob inputs (the marginals)

Every settled leg in `mlb_tracked_bets_<slate>.json` already carries its marginal(s). Confirmed fields on real rows:

| Source | Field | Where produced | Per-family fit | Note |
|---|---|---|---|---|
| Single-prop model prob | `modelProb` | `backend/pipeline/mlb/buildMlbPropClusters.js:585` `modelProbOver` / `:603` `modelProbForSide` (FROZEN — read-only cite) | all families | The canonical scored, de-vigged marginal. Present on **every** leg. **Default engine marginal.** |
| NB shadow ladder | `nbProbOver` (+ `nbFit`) | ride-along at `buildMlbPropClusters.js:1169` (T2-L1), fitted survival `negBinomLadder.survival` | totalBases only | Principled fitted P(X≥ceil(line)); preferred TB marginal once its own 14-day validation passes. |
| Per-player history | `getPlayerPropHistory()` | `backend/pipeline/shared/playerPropHistory.js:86` (MIN_GAMES=10) | countable box stats | Realized "k of n games" rate; returns null when thin. Useful as a marginal cross-check, not the primary. |

**Recommendation:** the engine is **marginal-agnostic** — it accepts `p1, p2` from the caller and only injects dependence. v1 default marginal = `modelProb` (universal, already on every leg); `nbProbOver` substitutable for totalBases legs. Critically, the engine **never recomputes or alters modelProb** → freeze-safe by construction.

---

## 2. Correlation data + the unit of correlation

Probe over 14 graded days (`.scratch/probe_t2_correlation_discovery.js`):

- **Named pairs are far too thin.** 118,073 distinct co-occurring named leg-pairs; **median co-occurrence = 1**, max = 11, only **1.3%** seen ≥5 times. Named-pair ρ is hopeless.
- **Structural pooling has workable n.** Pooling by leg-TYPE pair (real numbers, over×over, settled):

| Structural pair type | n (pairs) | p_x | p_y | P(both) | product | lift | φ |
|---|---|---|---|---|---|---|---|
| SAMEhitter HR + TB | 399 | .063 | .115 | .050 | .007 | 6.94 | **+0.554** |
| SAMEhitter hits + TB | 1238 | .063 | .065 | .034 | .004 | 8.23 | **+0.496** |
| SAMEhitter HR + RBIs | 221 | .090 | .145 | .054 | .013 | 4.14 | **+0.408** |
| SAMEhitter HR + runs | 209 | .057 | .105 | .024 | .006 | 3.96 | +0.250 |
| SAMEhitter hits + RBIs | 593 | .073 | .091 | .022 | .007 | 3.32 | +0.205 |
| SAMEteam 2 hitters over×over | 50,000 | .060 | .084 | .008 | .005 | 1.51 | **+0.039** |
| OPPteam 2 hitters over×over | 55,828 | .060 | .080 | .006 | .005 | 1.30 | +0.022 |
| **pitcherK over × OPP hitter over** | 6,166 | .152 | .071 | .005 | .011 | **0.48** | **−0.061** |
| pitcher × hitter (other) | 6,375 | .313 | .237 | .060 | .074 | 0.80 | −0.074 |

**Recommendation: STRUCTURAL leg-type pairs are the unit of correlation** (named pairs impossible; structural pools have signal + n).

**Honest sample-size caveat (must hold onto):** the `n` above counts *pairs*, not independent games — 114 games × ~48 legs/game produce ~1,100 pairs/game, so pairs within a game are themselves clustered. **Effective independent sample ≈ 114 games.** Consequence: the **sign is robust** (consistent across types + matches mechanism), but the ρ **magnitudes have wide error bars**. Treat the v1 ρ table as **priors** to be refined as graded days accrue — not precise constants. Marginals here are low (longshot-heavy overs, ~12% base win rate), which amplifies rare-event lift; φ is the steadier read.

---

## 3. Method

Per playbook §1 + §7-item-2, v1 = **Gaussian copula with an empirical correlation pooled structurally, sign-enforced.** For exactly 2 legs the copula is a **bivariate-normal CDF** — no Cholesky, no Monte Carlo needed:

```
joint(p1, p2 | type) = Φ₂( Φ⁻¹(p1), Φ⁻¹(p2) ; ρ_Z[type] )
```

- `Φ⁻¹` (inverse normal CDF) via Acklam/`erfinv` rational approximation (pure JS).
- `Φ₂` (bivariate-normal CDF) via Drezner–Wesolowsky / Gauss–Legendre quadrature (pure JS, no scipy).
- `ρ_Z[type]` (the latent copula correlation per structural type) is fit ONCE from the ledger: find ρ s.t. `Φ₂(Φ⁻¹(p_x), Φ⁻¹(p_y); ρ) = P(both)` at the historical marginals (monotonic in ρ → bisection). Stored as a small committed prior table.

**Why copula over the alternatives** (playbook §1): empirical-frequency (b) throws away our calibrated marginals and is data-hungry per-combo (named-pair thinness kills it); full MC box-score sim (c) is the eventual graduation but heavy for v1. The copula **keeps our marginals** (modelProb/nbProbOver) and only injects the structural dependence — minimal, defensible, and it makes the sign explicit (ρ_Z<0 ⇒ joint<product). Closed-form anchor for the fixture: `Φ₂(0,0;ρ) = ¼ + arcsin(ρ)/(2π)` (exact) — directly proves the sign at the median.

---

## 4. Plug-in (shadow / additive) + Law-1 placement

**Recommended placement (respects Law 1 + Law 28 — sport-invariant method, sport-specific implementation):**

1. **NEW `backend/pipeline/shared/gaussianCopula.js`** — pure, sport-agnostic MATH primitive: `invNormalCdf(p)`, `biNormalCdf(a, b, rho)`, `copulaJoint(p1, p2, rhoZ)`, `fitRhoZ(px, py, pBoth)`. No IO, no state. This is the reusable method the NBA engine can later graduate onto (its heuristic boost → real copula), so we add the method ONCE.
2. **NEW `backend/pipeline/mlb/mlbCorrelationEngine.js`** — the MLB sibling of `nbaCorrelationEngine.js` (same per-sport placement pattern). Classifies a leg PAIR into a structural type, looks up `ρ_Z[type]` from the prior table, calls `copulaJoint`, returns `{ joint, rawProduct, rho, structuralType, lift, sign }`. Pure.
3. **NEW `backend/config/mlbCorrelationPriors.json`** — committed `ρ_Z` per structural type, derived from the ledger probe (real data; sample-size caveat in `_doc`). Inspectable + updatable like `seasonsActive.json`.

**Why NOT a single shared `correlationEngine.js` (the brief's tentative name):** that would create a second `jointProbabilityWithCorrelation`-class function competing with the NBA one for the same concern — the Law 1 "parallel authority" smell. Splitting into (shared math primitive) + (per-sport engine) keeps ONE method authority (`gaussianCopula.js`) and mirrors the existing `pipeline/<sport>/` structure. **Operator decides** if they'd rather a single shared engine; I recommend the split.

- **Kill-switch:** `MLB_CORRELATION` env, read-once at module load (mirrors `MLB_NB_LADDER` / `MLB_BUCKET_TIER_POLICY`); default ON, `"0"` = OFF. Off ⇒ engine returns nothing / callers see no correlation field.
- **Shadow-only:** v1 is a standalone module + a probe demonstrating it on real same-game pairs. It feeds **nothing** in scoring. No tracked-row write in v1 (unlike NB ladder, which rode along) — keep it a pure callable + probe first; ride-along onto tracked_bets is a later, separately-approved step.
- **PRESERVED / freeze check:** `gaussianCopula.js`, `mlbCorrelationEngine.js`, `mlbCorrelationPriors.json` are NEW — none on PRESERVED.md. `nbaCorrelationEngine.js` is NOT modified. buildMlbPropClusters / modelProb / tierForPlay / makePlay / ladderNB untouched. Freeze intact.

---

## 5. Validation

A probe (`backend/scripts/` or `.scratch/`) over the graded ledger:

1. **Beats naive product?** On co-occurring SETTLED pairs, compare predicted joint (copula) vs predicted joint (naive product) against the realized 0/1 both-hit outcome — **Brier score** + a calibration table (predicted-joint bucket vs realized). Copula should lower Brier vs product on correlated types.
2. **Sign-correctness (explicit):** assert realized `P(both) > product` for positive types (same-hitter family pairs, same-team hitters) and `P(both) < product` for the negative type (pitcherK × opp hitter) — already TRUE in the §2 table; the validation re-checks it on a held-out / forward window.
3. **Honest limits:** forward-validation accrues from ship (like NB ladder); the 14-day backtest is the initial read, sample-size-caveated (§2). Right file = `mlb_tracked_bets_<slate>` (graded ledger), slate date on the 4 AM ET boundary, closing field `closeOdds`.

---

## 6. Scope guard (v1)

**IN:** MLB, same-game, **2-leg**, **over×over**, structural-pool correlation → sign-enforced joint probability, shadow-only, validated vs naive product. Three structural classes with the clearest ledger signal: (1) same-hitter family pairs (strong +), (2) same-team two hitters (mild +), (3) pitcher-K × opposing hitter (−, the trap).

**OUT:** parlay constructor / EV gate (step 3); fractional-Kelly (step 4); NBA (off-season + its own engine); 3+ legs (needs full ρ matrix + Cholesky/MC); under×over mixed sides (sign-flip handling — later); ride-along onto tracked_bets; any scoring change. Smallest piece that proves a correctly-correlated, sign-enforced, validated 2-leg joint probability.

---

## 7. Phase-1 plan + kill-switch + fixture + matrix

**Build (after operator approval — NOT done in this pass):**
1. `backend/pipeline/shared/gaussianCopula.js` — pure `invNormalCdf` / `biNormalCdf` / `copulaJoint` / `fitRhoZ`, inline self-tests.
2. `backend/config/mlbCorrelationPriors.json` — `ρ_Z` per structural type from the ledger probe (real data + caveat in `_doc`).
3. `backend/pipeline/mlb/mlbCorrelationEngine.js` — `classifyPair(legA, legB)` + `jointForPair(legA, legB, {p1, p2})` → `{ joint, rawProduct, rho, structuralType, sign }`. Kill-switch `MLB_CORRELATION` (read-once, `[MLB-CORRELATION-BOOT]`).
4. `backend/scripts/probeCorrelationValidation.js` — Brier + calibration + sign check vs naive product over the graded ledger → `.scratch/last.txt`.
5. `backend/scripts/verifyCorrelationEngine.js` fixture → add to `runtimeVerify.js` SUITES (**16 → 17**):
   - `Φ⁻¹` / `Φ₂` against known values (`Φ₂(0,0;0)=0.25`; `Φ₂(0,0;ρ)=¼+asin(ρ)/2π` exact).
   - **SIGN BOTH WAYS (the whole point):** ρ_Z>0 ⇒ `joint > p1·p2`; ρ_Z<0 ⇒ `joint < p1·p2`; ρ_Z=0 ⇒ `joint ≈ p1·p2` (tol).
   - `classifyPair` maps the three structural classes correctly (same-hitter / same-team / pitcherK×opp).
   - FREEZE GUARD (negative assertion): `buildMlbPropClusters` scoring fns (`modelProbForSide`/`tierForPlay`/`makePlay`) contain NO reference to the correlation engine; `nbaCorrelationEngine.js` unchanged.
6. Brain docs (Law 12): MODEL_EVOLUTION_LOG, PIPELINE_AUTHORITY_MAP (new "MLB correlation" authority + note NBA engine is the NBA-side sibling), MASTER_BRAIN, RUNTIME_FACTS (kill-switch).

**Kill-safety / freeze:** OFF ⇒ no correlation output; nothing in scoring reads it; OFF = byte-identical. ALWAYS sign-checked both ways before "done." `runtime:verify` must stay green (R2 + NB-ladder fixtures untouched).

**Deploy:** module-load kill-switch ⇒ backend `launchctl kickstart -k gui/$(id -u)/com.motel666.backend` to pick it up IF v1 ever wires into a live route; v1 is standalone + probe, so the first ship needs no live reload (verify via the probe's real output). Verify backend version LOCAL (127.0.0.1:4000), not the cached tunnel.

**Two operator decisions before build:** (a) placement — shared-math-primitive + MLB-sibling engine (recommended) vs one shared `correlationEngine.js`; (b) confirm v1 stays a pure module + probe (no tracked_bets ride-along yet).

---

## 8. Build results (2026-06-14 — operator approved: split placement + pure module/probe)

Built: `backend/pipeline/shared/gaussianCopula.js` (pure math, self-test 10/10), `backend/pipeline/mlb/mlbCorrelationEngine.js` (kill-switch `MLB_CORRELATION`), `backend/config/mlbCorrelationPriors.json` (12 structural types, ρ_Z fit from the ledger by `backend/scripts/deriveMlbCorrelationPriors.js`), fixture `backend/scripts/verifyCorrelation.js` (26/26; matrix 16→17, full `runtime:verify` 17/17), validation `backend/scripts/probeCorrelationValidation.js`.

**Validation (real output, `.scratch/last.txt`, in-sample 14 days / 119 settled games):**
- **SIGN: 12/12 structural types correct** — positives lift>1 (e.g. same-hitter HR+TB lift 7.22; same-team 2-hitters 1.44), the trap negative (pitcherK×opp lift 0.46). The engine's core job — correctly-signed dependence — is validated.
- **Brier with `modelProb` marginals: copula does NOT beat naive** — in-sample 0.01228 vs 0.01110; held-out (refit on 9d, test 5d) 0.01055 vs 0.00936. HONEST: `modelProb` is overconfident (the known calibration gap), so the dependence correction amplifies the marginal error. This is a MARGINAL problem, not a dependence problem — and is exactly why the engine is SHADOW-only and not fed into EV/scoring.
- **Brier isolating the dependence (held-out, type-level, same marginals both sides): DEPENDENCE BETTER** — 0.007196 vs 0.007236. With marginal miscalibration removed, modeling dependence beats assuming independence out-of-sample.

**Honest conclusion:** the correlation engine produces a correctly-signed, dependence-calibrated 2-leg joint. It is NOT yet a Brier win on the production marginal (`modelProb`) because that marginal is overconfident; it must stay shadow-only until marginals are calibrated and forward data accrues. ρ_Z are priors (effective n ≈ 119 games) — re-run `deriveMlbCorrelationPriors.js` to refine. R2 + T2-L1 freeze intact (verifyMlbTierPolicyR2 + verifyNbLadderStep1 green; scoring references nothing in the engine).
