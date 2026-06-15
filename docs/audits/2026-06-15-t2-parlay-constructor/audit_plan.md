# T2 Step 3 — Parlay Constructor + EV Gate — Audit + Phase-1 Design

**Author:** Claude-B [Cowork, Opus 4.8]
**Date:** 2026-06-14 ~22:22 ET (clock-checked)
**Mode:** AUDIT-FIRST, read-only. No code. FREEZE-SAFE — shadow/design only; EV outputs are only trustworthy once calibration is LIVE (post-freeze ~06-25), so v1 = framework + validation, NO betting surface, NO live wire.
**Reference:** docs/research/2026-06-11-parlay-ladder-playbook.md §1 (correlation), §2 (where EV is), build-order item 3.

---

## 0. Headline — what's computable, honestly

- The constructor's three inputs all exist as callable shadow/PRESERVED modules (§1). The math is buildable now.
- **The binding limit is book parlay prices: we have NONE.** The Odds API returns `parlays: null / dualParlays: null` (`fetchNbaOddsSnapshot.js:762-763`); there is no SGP price feed. So:
  - **CROSS-GAME parlays ARE EV-computable** — a standard cross-game parlay pays the **product of the single-leg decimal odds** (no correlation tax), which we have per leg. EV = trueJoint × payout − 1.
  - **SAME-GAME parlays are NOT EV-computable** — the book's SGP price is a proprietary correlation-adjusted number we can't see. The constructor can compute the *true* correlated joint (copula) for insight, but **cannot EV-gate it**. It must say so, never fake a number.
- So the realistic v1 +EV path is **cross-game compounds of calibrated +EV singles**. And it only yields +EV combos if (a) calibration is live AND (b) +EV single legs exist. In an efficient market it correctly outputs **"none."** This is the machine that exploits an edge IF one exists — it does not manufacture winners.

---

## 1. Inputs map (all present)

| Input | Source (file:line) | Notes |
|---|---|---|
| **Calibrated leg prob** | `backend/pipeline/mlb/mlbMarginalCalibration.js:81` `calibrateModelProb(modelProb, family, {oddsAmerican})` | MUST use this, NOT raw modelProb (raw is +16pp overconfident → fake +EV). Shadow; kill-switch `MLB_MARGINAL_CALIB`. |
| **Single-leg de-vig (fair prob)** | `backend/pipeline/shared/vigStripping.js:48` `stripVigTwoWay(overOdds, underOdds)` / `:89` `fairProbFromAmericanPair` (PRESERVED, `Object.freeze`) | For the leg-quality gate "calibrated > no-vig fair" (playbook §2.1). NEEDS the two-way market (over+under odds) — see §2 gap. |
| **Correlated joint (same-game)** | `backend/pipeline/mlb/mlbCorrelationEngine.js:88` `jointForPair(legA, legB, {p1, p2})` | Sign-enforced copula; feed CALIBRATED p1/p2. Kill-switch `MLB_CORRELATION`. |
| **Book offered odds (payout)** | tracked leg `oddsAmerican` (+ `impliedProb`, `eventId`, `player`, `statFamily`, `side`, `line`, `sportsbook`) | American→decimal = the cross-game parlay payout factor per leg. |

EV identity (cross-game): a parlay is +EV iff `∏(calibratedᵢ × decimalᵢ) > 1`, i.e. iff the product of single-leg EV-multipliers exceeds 1. So a cross-game parlay is +EV essentially iff its legs are individually +EV on calibrated prob vs the offered price — compounding +EV singles (playbook §2 "compounding only helps if each leg is already +EV").

---

## 2. Candidate legs + book prices

- **Leg universe:** live = the slate board (the per-slate candidate rows that carry `modelProb`/`oddsAmerican`/`eventId`/family/side/line — same shape as the tracked rows); validation = `mlb_tracked_bets_<slate>.json` (graded, has `result`). The constructor takes a **list of candidate legs** + each leg's calibrated prob + offered odds.
- **Book PARLAY prices: NONE** (Odds API `parlays:null`/`dualParlays:null`). Cross-game payout we COMPUTE (product of single-leg decimals); same-game SGP price we CANNOT get. `sportsbookTopology.js:132` already models `supportsCrossGameSGP` as a *constructability* flag, not a price.
- **De-vig input gap (honest):** `stripVigTwoWay` needs BOTH sides' odds; the tracked/ledger row stores only the bet side. For the live path, read both sides from the board/snapshot (it carries the two-way market); for validation, fall back to the offered-odds EV test (`calibrated × decimal > 1`, i.e. vs the vigged break-even) and note the de-vig refinement is forward (needs board capture).
- **Existing parlay surface (Law 1):** `backend/upside/builders.js` `buildMoneyMakerPortfolio` (live, `server.js:26`) builds heuristic parlays — `parlayDecimalFromLegs` (product of odds) + `roughTrueProbabilityFromLegs` (hand-tuned 0.55/0.65 regression + same-game penalty). It has **no calibration, no copula, no de-vig, no EV gate, no +EV filter** — same "heuristic v0" relationship as nbaCorrelationEngine → the copula. The new EV-gated constructor is the principled layer; v1 is a separate **shadow** module (not a live parallel authority). The eventual live reconciliation (EV gate feeding/replacing the Money Maker heuristic) is post-freeze + a Law-1 decision — flagged, not done.

---

## 3. Design — the constructor

**Placement:** NEW `backend/pipeline/mlb/mlbParlayConstructor.js` (MLB sibling, mirrors mlbCorrelationEngine/mlbMarginalCalibration). Pure, marginal-agnostic. Kill-switch `MLB_PARLAY` (MLB_NB_LADDER pattern). SHADOW-only — returns a structure; feeds nothing live, no FE/betting surface.

**`buildParlays(legs, opts)` → { singles, parlays, rejected }:**
1. **Per-leg prep:** for each leg compute `cal = calibrateModelProb(modelProb, family, {oddsAmerican})`, `dec = americanToDecimal(oddsAmerican)`, `evSingle = cal·dec − 1`, and (if two-way odds present) `fair = stripVigTwoWay(...)`, `beatsFair = cal > fair`. Mark each leg `+EVsingle = evSingle > 0` (and `qualified = beatsFair` when fair is available).
2. **Enumerate candidate 2-leg combos** from qualified legs (cap N for tractability).
3. **Joint:**
   - same `eventId` → `jointForPair(a, b, {p1:calA, p2:calB})` (copula, sign-enforced) → `joint`, `rho`, `structuralType`.
   - different `eventId` → `joint = calA · calB` (independent).
4. **EV:**
   - cross-game → `payout = decA · decB`; `evParlay = joint · payout − 1`.
   - same-game → `evParlay = null` (no SGP price) + `note: "SGP price unavailable — correlation shown, EV not computable"`.
5. **NEVER-AUTO-BUNDLE gate (the hard rule):** default recommendation = **bet the qualified legs as SINGLES**. A parlay is surfaced ONLY if `evParlay > 0` (cross-game) AND both legs are +EVsingle; and it is ALWAYS shown with `evIfBetAsSingles` (sum of single EVs at unit stake) so the operator sees the playbook's 7×-singles tradeoff. Same-game combos are never "recommended" (no EV) — only listed as correlation insight. No bundling without the model.
6. **Rank** surfaced cross-game parlays by `evParlay` desc; tag each with leg ids, joint, payout, evParlay, evIfBetAsSingles, and `contingent: { calibrationLive: bool }`.

**Output is contingent + honest:** if calibration is OFF or no +EV legs exist → `parlays: []` with `reason`. Never implies winners.

---

## 4. Validation (contingent on calibration-live)

`backend/scripts/probeParlayConstructorValidation.js` over the graded ledger:
- Build the +EV-gated cross-game parlay set from settled legs using **calibrated** marginals + offered-odds EV gate; compute realized ROI = Σ(parlay won? payout : −1) / count. Expect **few or zero** qualifying parlays on 14 efficient-market days — and that is the correct, honest result (the gate refuses to bundle without a real edge).
- **7×-singles discipline check:** for the qualified legs, compare realized EV/ROI of betting them as separate singles vs as parlays — reproduce the playbook's "singles capture more EV" result; assert the constructor's default (singles) matches.
- **Sanity (machine-correctness, not winners):** on a synthetic pair of known +EV legs, assert evParlay computes to the hand-derived value and the gate surfaces it; on −EV legs, assert it's rejected; on same-game, assert evParlay is null + correlation present.
- Honest limits: cross-game only EV-gated; thin window; forward-validation post-calibration-live. Right file `mlb_tracked_bets_<slate>` (graded); slate 4 AM ET; verify local not tunnel.

---

## 5. Scope (v1)

**IN:** MLB, 2-leg, SHADOW framework + validation. Cross-game = EV-gated; same-game = correlation insight only (no EV). Never-auto-bundle gate. Calibrated marginals only.
**OUT:** fractional-Kelly staking (step 4); NBA; FE / betting surface / live wire; 3+ legs; same-game EV (no book SGP price); any scoring change; touching `upside/builders.js` or PRESERVED.

---

## 6. Phase-1 plan + kill-switch + fixture + freeze-guard

**Build (after operator approval — NOT this pass):**
1. `backend/pipeline/mlb/mlbParlayConstructor.js` — `buildParlays(legs, opts)` + `americanToDecimal` helper; consumes mlbMarginalCalibration + mlbCorrelationEngine + (where two-way present) vigStripping. Kill-switch `MLB_PARLAY` (`[MLB-PARLAY-BOOT]`). Pure, shadow.
2. `backend/scripts/verifyParlayConstructor.js` fixture → SUITES (**18 → 19**): cross-game EV math vs hand-derived; same-game EV=null + correlation present; never-auto-bundle (−EV combo rejected, default=singles); uses CALIBRATED not raw (assert a raw-overconfident leg that's +EV raw but −EV calibrated is REJECTED — the anti-fake-EV guard); kill-switch OFF → empty; **FREEZE GUARD** (buildMlbPropClusters / phase4Tracking / scoring reference nothing in the constructor; constructor reads calibration+correlation but writes nothing live).
3. `backend/scripts/probeParlayConstructorValidation.js` — §4 → `.scratch/last.txt`.
4. Brain docs (Law 12): MODEL_EVOLUTION_LOG, PIPELINE_AUTHORITY_MAP (new MLB parlay-constructor authority + note upside/builders is the heuristic sibling to reconcile post-freeze), MASTER_BRAIN, RUNTIME_FACTS (kill-switch).

**Freeze/kill-safety:** shadow-only; OFF ⇒ empty; nothing live reads it; `runtime:verify` stays green (R2 + NB-ladder + correlation + marginal-calib untouched). Deploy: standalone module + probe → no live reload; verify via probe real output.

**The honest through-line:** Step 1 (NB ladders) gives per-leg survival probs; Step 2 (correlation) gives the sign-correct joint; Track 1 (calibration) makes the marginals honest; **Step 3 (this) is the machine that turns honest legs + correct joints into a +EV/none verdict and refuses to auto-bundle.** None of it is +EV-productive until calibration goes live (post-freeze) and a real edge exists — at which point this is the surface that finds it.

---

## 7. Build results (2026-06-14 — operator approved: shadow build)

Built: `backend/pipeline/mlb/mlbParlayConstructor.js` (`buildParlays` + `americanToDecimal`, kill-switch `MLB_PARLAY`), fixture `verifyParlayConstructor.js` (24/24; matrix 18→19, full `runtime:verify` **19/19**), validation `probeParlayConstructorValidation.js`.

**Machine-correctness (verified):** cross-game EV = hand-derived `joint·payout−1`; same-game `evParlay=null` + correlation present; never-auto-bundle (+EV × −EV not bundled); kill-switch OFF→null; freeze guard (scoring references nothing). **ANTI-FAKE-EV proven:** an hr leg that is +EV on RAW (0.40 @ +300 → raw EV +0.60) is −EV on CALIBRATED (→0.178, EV −0.287) and is correctly rejected.

**Validation on the graded ledger (12 dates, in-sample; `.scratch/last.txt`) — the honest, sobering result:**
- **+EV-gated CROSS-GAME parlays: 26,867 surfaced, realized ROI −42.1%.**
- **+EV single legs: 772, realized ROI −17.0%.**
- Same-game correlation-insight combos: 155,810 (no EV, by design).

**What this means (no spin):** the constructor's *machinery* is correct, but the legs it flags +EV currently **realize negative** — singles −17%, parlays −42%. The +EV gate (`calibrated > offered-implied`) selects the model's most optimistic legs relative to price, and family/bucket-level calibration corrects the *aggregate* but not the per-leg overconfidence *at that selection margin* (a winner's-curse / selection effect). Parlays compound it (−42% < −17%), which also empirically reproduces the playbook's "singles bleed less than parlays" discipline. **So: this does NOT produce winners on current data — it proves the edge isn't there yet AND that the marginal still isn't trustworthy where the gate bites.**

**Caveats (honest):** in-sample (maps fit on this window) and still negative — that's the load-bearing point; leg dedup keeps an arbitrary book's odds (a real bettor line-shops best odds — would change which legs qualify); the gate used offered-odds EV (vigged breakeven), not the stricter no-vig de-vig (ledger lacks two-way odds — forward work, needs board capture).

**Implication for the roadmap:** reinforces that the LIVE calibration wiring (post-freeze) must go further than family/bucket isotonic — it needs to be honest *at the +EV selection margin* (finer granularity or per-leg shrinkage), validated FORWARD, before any EV output is trustworthy. The constructor is the correct surface to exploit an edge; it currently, correctly, reports there isn't one.
