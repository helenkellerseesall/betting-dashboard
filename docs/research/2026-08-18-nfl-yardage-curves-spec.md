# NFL YARDAGE CURVES — Design Spec (the "one new modeling piece")

**Date:** 2026-08-18 · **Author:** Claude-C (research, Fable 5) · **For:** CA triage → CB build (~2.5 weeks to Week 1). Design only, no code.
**Scope:** continuous yardage families — `player_pass_yds`, `player_rush_yds`, `player_reception_yds` (+ their `_alternate` ladders). Count families (receptions, TDs) need NO new math — they ride `fitPlayerFamilyCurve` as-is [REPO: negBinomLadder.js:214].
**Tags:** [REPO]/[AUTH]/[PRAC]; grades REAL/SPECULATIVE/FANTASY.

---

## 1. What transfers verbatim from the MLB machinery (build on, don't rebuild)

`backend/pipeline/mlb/negBinomLadder.js` already supplies the exact skeleton [REPO, read this session]:
- **`fitPlayerFamilyCurve(games, family, {minN, halfLife, maxGames})`** — pulls a stat key from game logs, sorts ASC, windows the last `maxGames`, fits, returns `{family, ladder, supportCap, meta}`. The yardage build is a **sibling module with the same signature and return shape**, so every downstream consumer (ladder EV scan, serve join, G2 validator, Lab leg pricer) works unchanged.
- **Method-selection-by-evidence, already precedent:** the MLB fitter picks negbinom vs Poisson at fit time from the data (`variance > mean` ⇒ negbinom, else Poisson) rather than asserting a family [REPO: :201-207]. **This spec extends that precedent — the yardage family is chosen by a bakeoff, not by my prior (§2).**
- **`fitCountsMoMWeighted` half-life decay + `nEff`** — the recency-weighting mechanic transfers directly (§3).
- **`supportCap = maxObserved + 1`, rungs never priced beyond it** [REPO: :224-227] — the G2 lesson, already enforced in code. §5 adapts it to continuous space.
- **Config-driven output caps as a predict-time backstop** — `mlbMarginalCalibration.js` OUTPUT_CAP clamps even a bad future map [REPO: :46-52, 96]. Same backstop belongs on yardage probabilities.
- **`marketPrior.js`** — forward-only grid fit of `w` per family×band, 300-decided-row segment floor, `w=1` (pure market) stamped when below support [REPO: :45,127,129]. §4 plugs yardage in as new segments with no mechanic change.

**Grade: REAL** — roughly 70% of this build is parameterization of shipped, fixture-covered machinery.

---

## 2. Distribution family — decided by bakeoff, with a documented default

**The shape of the data (why counts math fails):** yardage is continuous, right-skewed, and **has a real point mass at zero** — a WR3 or a backup RB can post exactly 0. That is a *hurdle* (a.k.a. two-part) structure: `P(0)` plus a positive-continuous density. This is the documented family for zero-heavy continuous outcomes ([JSDA — zero-inflated vs hurdle comparison](https://jsdajournal.springeropen.com/articles/10.1186/s40488-021-00121-4) [AUTH]; [gamma-hurdle formulation](https://towardsdatascience.com/the-gamma-hurdle-distribution/), [hurdle-lognormal practice](https://www.andrewheiss.com/blog/2022/05/09/hurdle-lognormal-gaussian-brms/) [PRAC]). Current NFL play-level research uses generalized-gamma for pass and skew-t for run conditional densities [AUTH: arXiv NFL modeling lit], which corroborates "right-skewed continuous, family not obvious."

**Spec: `P(yards ≥ L) = (1 − π₀) × S_pos(L)`** where π₀ = P(zero/no-appearance) and `S_pos` is the survival function of the positive part.

**Candidates for `S_pos`, to be run as a bakeoff on our own nflverse history (the deciding evidence):**

| Candidate | Grade | Note |
|---|---|---|
| **Log-normal** (fit μ, σ on log-yards) | **REAL — the default** | Two parameters, stable at small n, closed-form survival, standard for yardage. Recommended as the fallback when the bakeoff is inconclusive. |
| **Gamma** (MoM shape/scale, mirrors the existing MoM idiom) | **REAL — co-favorite** | Same 2-param cost; often better in the mid-body; MoM keeps it in the repo's existing fitting style. |
| **Empirical + smoothed tail** | **SPECULATIVE at NFL n** | With ≤50 games, empirical quantiles are lumpy and give nothing beyond `maxObserved`; useful only as a bakeoff *reference*, not a server. |
| Skew-t / generalized gamma (3+ params) | **FANTASY at our n** | Research-grade families need play-level volume we don't fit per player; parameter variance would swamp the gain. |

**Selection rule (this is the spec, not the guess):** fit all three candidates on a train window, score **out-of-sample log-loss on the actual rungs the market offers** (not on raw yards — we're pricing over/unders, so scoring must be at the decision boundary). Pick per FAMILY (not per player — n forbids it), freeze the choice in config with a version stamp, and re-run the bakeoff annually. If candidates tie within noise, **take log-normal** (fewest failure modes at small n). Bakeoff is a CB build item and must run BEFORE Week 1 on 2023–2025 nflverse data, which exists today [PRIOR: NFL doc §2].

**π₀ (the hurdle) must not be modeled naively:** a zero from "played 40 snaps, wasn't targeted" and a zero from "inactive/injured" are different events. Spec: **π₀ is conditioned on expected participation** (snap-share from the role layer), and rows where the player did not play are **EXCLUDED from the fit, not counted as zeros** — otherwise injuries silently deflate every curve. Grade REAL, and this is the single easiest way to get the whole build wrong.

---

## 3. Fitting windows, floors, and multi-season priors (17-game reality)

MLB fits off `maxGames: 60` with `minN: 15` [REPO]. NFL cannot: a full season is 17 games.

**Spec:**
- **Window:** trailing **24 games max**, crossing season boundaries (≈1.5 seasons) — enough for 2-param stability, recent enough to track role.
- **Hard floor: `minN = 6` in-season games for a *player* fit.** Below that the player has **no own curve** — the system falls back (below), never invents one.
- **Recency decay:** reuse the existing half-life weighting [REPO: `fitCountsMoMWeighted`], with a **shorter half-life than MLB — spec ~8 games** — because NFL role changes are discrete and fast (a rookie takes the WR2 job in one week). SPECULATIVE on the exact value; the bakeoff should tune it over {6, 8, 12} the same way it picks the family.
- **Cross-season decay, stated honestly:** prior seasons enter the SAME window with an additional flat discount (spec: prior-season games weighted ×0.5 on top of half-life) — a player is a different asset after a scheme/team change. **Honesty rules, binding:** (a) any curve using >50% prior-season weight is **stamped** as such and the stamp reaches the serve layer; (b) a **team change or documented role change inside the window resets the fit to in-season-only** — if that drops the player below `minN=6`, they get no curve (see fallback), never a stale one; (c) offseason-only fits (Weeks 1–5) are **explicitly labeled prior-dominant** on every surface, because they are.
- **Fallback ladder when a player fails `minN`** (mirrors the MLB ladder fallback pattern): **role-archetype pooled curve** (e.g. "WR1-tier target share, 8–11 targets/g") × the player's expected participation — pooled, not personal, and **stamped `pooled`**. Grade REAL; this is what makes Weeks 1–3 servable at all without lying about precision.

**The blunt consequence, stated for the operator:** for the first ~4 weeks of the season, most NFL yardage curves will be prior-dominant or pooled. That is not a defect to hide — it is a label to print, and §4 is what keeps those weeks honest.

---

## 4. Market-prior shrinkage integration (the landed mechanic, no changes)

`p_final = w · p_market + (1 − w) · p_model`, `w` fit forward-only per **family × odds-band**, segments below the decided-row floor running **`w = 1` (pure market), stamped** [REPO: marketPrior.js:45,127,129].

**Spec for NFL:**
- New segments keyed `nfl_pass_yds`, `nfl_rush_yds`, `nfl_reception_yds` × existing bands. **No mechanic change** — this is configuration plus a segment-name extension.
- **Week 1 starts at `w = 1` by construction** (zero decided NFL rows ⇒ below the floor ⇒ pure market, stamped). This is the design working exactly as intended: **the model earns weight only as it accumulates graded evidence**, and until then the served number is the market's, honestly labeled. It also means NFL launch cannot ship a phantom edge.
- **Interaction with §3 that must be explicit:** prior-dominant/pooled curves and pure-market weighting will co-occur in Weeks 1–5. The serve stamp must carry BOTH facts (`curve: pooled|prior_dominant|player`, `w`, `p_model`, `p_market`) so a later audit can separate "our curve was wrong" from "we were serving the market anyway."
- MLB's live fit already shows the mechanic behaves sanely at the extremes (hr longshots `w=1`, heavy-fav ks `w=0`) [REPO: 2e837b5] — evidence the shrinkage won't fight a good model or protect a bad one. Grade: **REAL**.

---

## 5. Tail-support caps in continuous space (the G2 lesson, adapted)

MLB: `supportCap = maxObserved + 1`, rungs beyond it never priced [REPO]. Continuous yardage needs the same discipline expressed in yards:

- **Support ceiling = `maxObserved` within the fit window, plus one "rung step"** — where the step is the market's own alternate-ladder granularity for that family (yardage alts commonly move in 5–10 yard increments), not an arbitrary number.
- **Above the ceiling: refuse to serve a probability.** Not "serve a tiny number" — REFUSE, and let the row abstain [REPO: the abstain-visible doctrine from the cure-C class]. A curve fit on 12 games has no business pricing a 150-yard rung it has never seen.
- **Predict-time backstop, config-driven:** a hard probability cap mirroring `OUTPUT_CAP` [REPO: mlbMarginalCalibration.js:46-52] so no future bad fit can serve a ~100% or ~0% yardage claim. Spec: cap at the max well-sampled realized rate, same derivation as MLB's 0.85.
- **Abstain accounting is mandatory:** every refusal tallies by reason (`below_minN`, `above_support`, `no_participation_estimate`, `role_change_reset`) and surfaces in the nightly artifact — the cure-C lesson: **a silently abstaining column must never be able to hide again** [REPO: cureGates.C precedent].

Grade: **REAL**, and cheap — the pattern is already fixture-proven in two places.

---

## 6. The validation gate an NFL curve must pass before serving

MLB's G2 bar: every bucket with **n ≥ 150** decided must have `|stated − realized| ≤ max(1.5pp, 20% relative)`; bakeoff floor n ≥ 50; chronological half-split re-fit [REPO: validateG2Curves.js:62-63,131,319]. **NFL cannot reach n=150 per bucket inside a season** — 16 games/week × a handful of qualifying players per family is hundreds of rows/week *pooled*, but per-bucket depth is thin and one-directional.

**Spec — walk-forward gate for tiny n (three changes, everything else identical):**
1. **Pool the buckets, keep the bar.** Judge at **family × odds-band** (not family × narrow prob-bucket), floor **n ≥ 60 decided** per judged cell, and require ≥ 3 distinct game-weeks in the cell — so one freak Sunday can't pass or fail a family.
2. **Score with an interval, not a point.** At these n, a point gap is noise. Bar: **the realized-vs-stated gap's 90% lower bound must not exceed the MLB-equivalent tolerance** — i.e. reuse the Poisson/binomial lower-bound idiom already adopted for the fade-tier watch segments [REPO: 1bc76a5 `LB90 = (W − 1.2816·√W)/E ≥ 1.0`]. Same statistical grammar, already in the codebase.
3. **Walk forward weekly, never re-fit backward.** Train on weeks ≤ k, judge week k+1, accumulate. **Curves serve in shadow until a family clears the gate** — Week-1 through gate-clearance, NFL yardage rows are captured, priced, and paper-graded but the served number is market-dominant by §4 anyway. Expect clearance no earlier than **~Week 6–8** for the deepest family (receiving yards); passing yards may take longer (fewer qualifying players per week).

**Non-negotiables carried from MLB:** raw-axis era rule on any re-fit (never fit calibration on calibrated output) [REPO: d6b17d1 doctrine]; version-stamped configs; settled rows immutable; forward-only. **The gate's honest default is REFUSE — an NFL family that never clears simply never serves its own number, and the market prior carries it. That is an acceptable season outcome, and saying so now prevents a Week-9 rationalization.**

---

## 7. For CA triage (ranked; all pre-season)

1. **Distribution bakeoff on 2023–25 nflverse data** (log-normal vs gamma vs empirical; half-life {6,8,12}; scored OOS at market rungs) → freezes the family + decay in versioned config. **Must precede the fitter build.** [CB, M]
2. **`nflYardageLadder.js`** — sibling of `negBinomLadder` with identical signature: hurdle + chosen family, window 24 / minN 6, participation-conditioned π₀, support ceiling + abstain tally. [CB, M]
3. **Pooled role-archetype fallback curves** (makes Weeks 1–3 servable honestly). [CB, S-M]
4. **Market-prior segment extension** for the three NFL families (config + naming; mechanic untouched). [CB, S]
5. **NFL G2 gate variant** (pooled cells, LB90 bar, weekly walk-forward) + shadow-until-clear wiring. [CB, S-M]

**Sequencing note:** items 1–4 must land before Week 1 (Sep 3) for capture-and-price; item 5 can land by Week 3 since nothing serves its own number before then anyway.

---

**Sources:** [REPO] negBinomLadder.js (fitPlayerFamilyCurve, MoM/half-life, supportCap) · marketPrior.js (w fit, 300-row floor, w=1 stamp) · validateG2Curves.js (bars) · mlbMarginalCalibration.js (OUTPUT_CAP) · commits 2e837b5, 1bc76a5, d6b17d1, cure-C abstain precedent · [JSDA zero-inflated vs hurdle](https://jsdajournal.springeropen.com/articles/10.1186/s40488-021-00121-4) [AUTH] · [gamma hurdle](https://towardsdatascience.com/the-gamma-hurdle-distribution/) · [hurdle-lognormal practice](https://www.andrewheiss.com/blog/2022/05/09/hurdle-lognormal-gaussian-brms/) [PRAC] · NFL conditional-density research (generalized gamma / skew-t) via arXiv NFL modeling lit [AUTH] · [nflverse data schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html) [AUTH] · prior: docs/research/2026-08-11-nfl-prop-support.md §4.
