# T2 Step 1 — Real Per-Player Probability Ladders · AUDIT + PHASE-1 PLAN (read-only)

**Date:** 2026-06-12 ET · **Author:** Claude-B (Fable 5) · **Type:** read-only discovery + plan. NO code edited. Reference: `docs/research/2026-06-11-parlay-ladder-playbook.md` §6/§7 (NegBinom over Poisson; ladder = survival function P(X≥k); one sport/one family first).

---

## 1. What `pred.stats[family].ladder` IS today

**Writer (sole):** `projectHitterStats` in `backend/pipeline/mlb/buildMlbPlayerDataset.js:155-279` (hitters) + the pitcher block at `:336-345` (ks ladder from the pitcher-Ks engine, "pre-calibrated" k5–k8 rungs).

Per-family reality — **heuristic blends, NOT fitted count distributions**, with one exception:

| Family | Ladder today | Source line | Nature |
|---|---|---|---|
| hits | `{0.5:h1, 1.5:h2, 2.5:h3}` | `:171` | passthrough of hits-engine `hit1plus/2plus/3plus` probabilities |
| totalBases | `{0.5:h1, 1.5:tb2, 2.5:tb3, 3.5:tb4}` | `:180-187` | **pure heuristic**: `tb2 = clamp01((h2·0.62 + hrProb·0.25 + h1·0.13 + powerNorm·0.05)·dfMul)` etc. — linear weighted blends of other model probabilities, park-scaled |
| hr | `{0.5:hrProb, 1.5:hrProb², 2.5:hrProb³}` | `:193-197` | naive independence powers |
| rbis / runs | 2-rung heuristics | `:204` / `:223` | input passthrough / Bernoulli-ish prior |
| stolenBases | `{0.5: 1−e^−λ, 1.5: …}` | `:257-267` | **TRUE fitted Poisson** (λ = seasonSB/gp, SHIP 2) — the in-file precedent for a distribution-backed ladder |

**Consumer (scoring-affecting):** `modelProbForSide` at `backend/pipeline/mlb/buildMlbPropClusters.js:603` (via `modelProbOver` `:604`) reads `stat.ladder` → `modelProb` (call site `:904`) → edge/EV → tier. **The ladder IS the model probability source. Changing it changes scoring.**

## 2. What data exists to FIT a per-player count distribution (real probes, this audit)

- **`backend/data/mlbBatterGameLogs.json`** — 397 batters, **21-day rolling window** (meta: slateDate 2026-06-11, windowDays 21). Games/player: p25 **11**, median **16**, max 20. Per-game `stats` carries **`totalBases` directly** (plus hits, homeRuns, rbi, runs, strikeOuts, stolenBases).
- **Overdispersion confirmed on OUR data** (NegBinom justification, not just literature): of **317 batters with n≥10 TB games**, avg mean TB/game **1.327**, avg variance **2.843** → **avg var/mean = 2.14**; **292/317 (92%)** individually show var > mean. Poisson (var=mean) is wrong for TB; NegBinom is right.
- **`mlbPitcherGameLogs.json`** — 104 pitchers, but median **3 starts** in the window (max 5). **NOT per-player fittable.**
- **`nbaPlayerGameLogs.json`** — 125 players, median **6 games** (Finals-window only). **NOT fittable until next season.**
- **`pipeline/shared/playerPropHistory.js`** — per-player over/under counts vs a line; `MIN_GAMES = 10` is the established honest n-floor precedent (below → null, caller falls back labeled).
- **Honest limitation:** the gamelog caches are rolling 21-day windows — there is **no as-of historical snapshot**, so a retro backtest by refitting "what the NB ladder would have said last month" is impossible from current data. **Validation is forward-only from ship.**

**n floor: 10 games** (playerPropHistory precedent). Below floor (80/397 batters today): **no `ladderNB` emitted** — the existing heuristic ladder remains the only ladder (probabilityHonesty doctrine: absent, never fabricated).

## 3. Prototype recommendation: **MLB totalBases**

Data decides it: batters are the only population with fittable depth (median 16 games); TB is directly in the logs; TB's current ladder is the most heuristic of all families (§1); the playbook names TB the widest-dispersion line-shop family (§5); MLB is the more provable sport (§6, + operator doctrine). NBA threes fails on data today (median 6 games); pitcher Ks fails (median 3 starts).

## 4. Where the fitted NegBinom survival fn plugs in — and the FREEZE conflict

- **Natural home:** `projectHitterStats` (writer) → consumed by `modelProbForSide` (scoring). But replacing `ladder` now **changes modelProb → edge → tier → violates the MLB scoring freeze (active since 2026-06-11 16:36:52 ET, R2)**.
- **Resolution: SHADOW FIELD.** v1 writes `stats.totalBases.ladderNB` (full survival rungs + fit meta `{n, mean, variance, r, p, method}`) ADDITIVELY next to the untouched `ladder`. **Nothing consumes `ladderNB` for scoring in v1** — picks/edges/tiers byte-identical. The freeze window becomes the validation window. After freeze + validation gate, a separate governed phase swaps NB in as the scoring ladder (version-bumped, same doctrine as tierPolicy).
- **PRESERVED check: CLEAN.** `buildMlbPlayerDataset.js` and `buildMlbPropClusters.js` are NOT on PRESERVED.md (Tier 1 is `pipeline/shared/` cognition: vigStripping, allowlist, topology, archetypeWeighting, survivabilityGate, PCE, probabilityHonesty, normalizers, buildClv). No stop required. probabilityHonesty's *doctrine* (null over synthesis) is honored by the n-floor.

## 5. Phase-1 plan (build pending operator approval)

1. **NEW pure module `backend/pipeline/mlb/negBinomLadder.js`** — no IO, no deps, plain JS (no scipy):
   - `fitCountsMoM(counts)` — method-of-moments: `mean`, `var`; if `var > mean`: NB with `r = mean²/(var−mean)`, `p = mean/var`; else Poisson-limit fallback (λ = mean). Returns null for n < 10.
   - NB PMF via stable recurrence (no gamma fn): `P(0) = p^r`; `P(k+1) = P(k)·(r+k)/(k+1)·(1−p)`. Survival `P(X≥k) = 1 − Σ_{i<k} P(i)`. Poisson recurrence analogously.
   - `ladderFromLogs(games, statKey, rungs=[0.5,1.5,2.5,3.5,4.5])` → `{rung: P(X ≥ ceil(rung))}` + fit meta.
   - Inline self-tests (hand-computed reference values + Poisson degenerate case + monotone-decreasing rungs).
2. **Wire (shadow, kill-switched):** `MLB_NB_LADDER` env (read-once, unset/"1" ON, exact "0" OFF, boot log `[NB-LADDER-BOOT]` — exact `MLB_BUCKET_TIER_POLICY` pattern). ON + batter has ≥10 TB games in `mlbBatterGameLogs` ⇒ `projectHitterStats` emits `totalBases.ladderNB` + meta. OFF or thin ⇒ key ABSENT (byte-identical).
3. **Persistence for validation:** `ladderNB` rung-prob for the pick's line rides the play additively (same conditional-spread pattern as `tierPolicy`) into `mlb_tracked_bets`, so grading can score it. Field absent when OFF.
4. **Validation probe** (.scratch, forward-only): on graded TB picks with both probabilities present, compare heuristic-ladder prob vs `ladderNB` prob vs realized outcome — calibration by rung + Brier. **Gate before ANY scoring swap:** ≥14d of forward graded TB picks AND NB beats the heuristic on calibration, operator reviews the table.
5. **Fixture `verifyNbLadderStep1.js`** (added to runtime:verify → 15 suites): math self-tests vs reference values; OFF ⇒ no `ladderNB` key anywhere; thin-sample ⇒ null; **negative assertion: `modelProbOver`/`modelProbForSide` do NOT read `ladderNB`** (the freeze guard, verifier-enforced); stamp/persistence conditional-spread assertions.
6. **Explicitly NOT in Step 1:** no scoring swap, no parlay math, no correlation engine, no NBA, no pitcher families, no FE display. One sport, one family, shadow + validate.

**Honest framing:** Step 1 produces a *measurably testable* per-player P(X≥k) surface and proves it against reality before it's allowed to touch a pick. It does not improve tonight's picks and is not claimed to.
