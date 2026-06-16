# Full-Repo Capability Map + Vision Gap Analysis

**Author:** Claude-B [Cowork, Opus 4.8]
**Date:** 2026-06-15 ~18:13 ET (clock-checked)
**Why:** operator (rightly) pushed back — the matchup-intel audit under-surveyed and re-listed things we already have. This is a whole-repo sweep (5 parallel read-only agents + direct verification) mapped against the *real* vision: the knowledgeable-fan, heavy-leg-of-obtainable-props + cash-out, "$5–20 → hundreds" model — NOT a rigid math O/U guideline.

---

## 0. Correction + headline

My matchup-intel audit named one folder (`context/`) and stopped. The truth: **the human/quant blend is already built far more than that — but most of it is SHADOW or invisible because the workstation front-end is not in this repo.** That gap (richness built, not surfaced) is very likely why the product *feels* like rigid math to you even though the engine is not.

Three honest, load-bearing findings:
1. **Cash-out / hedge — your #1 explicit ask — genuinely DOES NOT EXIST** (verified whole-repo grep). The only "cashout" code just *reorders* legs so fast-resolving ones lead (`nbaCorrelationEngine.orderLegsWithCashoutFirst`) — no cash-out value, no book-haircut estimate, no equalizing-hedge stake. This is the biggest concrete miss, and it's pure math (freeze-safe, buildable now).
2. **The React workstation FE is NOT in this repo** — `frontend/` holds only `status/` + `mobile/` HTML; no `frontend/src`, no `.tsx` (and it's not gitignored — it's absent here). Yet the brain docs reference `frontend/src/workstation/*.tsx` (FeaturedCard, AnalyzeSlipView, VerdictCard, RecommendationLadder…). So the PWA either lives in a **separate repo** or isn't committed. **Everything below is served by backend `/api/ws/*` endpoints; if the UI consuming them isn't here, the intelligence is invisible to you.** Need you to confirm where the FE lives — this changes what "build" even means.
3. **There is a whole Phase-2 LIVE-STATE layer I missed** (`backend/pipeline/mlb/live/`): confirmed-lineup + **scratch/late-swap detection**, starter confirmation, **line-movement/steam**, live weather delta, live bullpen. The "fan-knowledge live signals" are substantially built.

---

## 1. What EXISTS and is LIVE (the blend is already here)

**Matchup / contextual intel** (`mlb/context/applyMlbContextualLayers.js`, additive, persists to curated rows):
- Weather (wind dir/speed, temp, carry), Park (HR factor, roof) — LIVE.
- Platoon / handedness (batter vs pitcher hand, platoon advantage) — LIVE.
- Lineup slot / PA volume / run+RBI environment — LIVE.
- Pitcher K-profile (kRate/k9/bbRate) vs batter — LIVE (arsenal/velocity = stub).
- Bullpen fatigue (3-day relief load, fatigue score) — built+ingested, shadow composition.
- Batter form L5/L15 (hot/cold momentum) + Pitcher form L3/L5 — LIVE in projection engines.

**Live-state (Phase 2)** (`mlb/live/`): confirmed lineup, **scratch / late-swap**, starter confirmation, **line-movement + steamFlag**, live weather delta, live bullpen — LIVE.

**Injury / availability**: NBA official injury report + ESPN ingest → `playerStatus` + availabilityShift (−2pp out … +0.5pp probable) — LIVE. MLB confirmed-lineup scratch detection — LIVE.

**Market intelligence**: `buildClv` (CLV, open/close capture), `buildLineShoppingIntelligence` (7-book best price + per-book CLV/ROI/stale), `buildMarketTimingIntelligence` (steam / RLM / drift / "bet now" urgency buckets) — LIVE via `/api/ws/*`.

**Curation / obtainability-adjacent**: `archetypeWeighting` (superstar/proven/role-player/bench/no-name + role-family legitimacy, LIVE multiplier), `archetypes.js` (avoid/anchor/ladder/ceiling), `fragile.js` (minutes/trend/injury hard gate), volatility classifier (safe/balanced/aggressive/lotto), `mlbSurvivabilityGate` (per-family floors, shadow), PCE conviction engine.

**Parlay/slip builders**: `buildMlbParlays` (3-tier), `buildMlbSlipEngine`/`buildSlipAi` (SAFE/BALANCED/AGGRESSIVE/LOTTO tiers), `buildMlbHrStacks`/`buildMlbHrSlips`, recommendation ladder (incl. believable/explosive upside) — LIVE. NBA: `buildNbaBankrollPlan` (Kelly staking — NBA only).

**Screenshot / Twitter ingestion (the "twitter tracks this" workflow) — ~90% wired**: paste slip JSON OR upload a screenshot (`/ocr`, Claude Vision) → 7-class archetype + 10-dimension scoring + a 12-field **verdict** (strongest/weakest leg, contradiction flags, fake-safe risk, ecological coherence) → bettor **taste profile** learning + nightly **outcome grading**. This already does "is this Twitter slip sharp or bait."

**Self-grading loop**: `buildProcessClassifier` (10 outcome archetypes incl. good_process_bad_variance, suppressed_winner, fake_sharp_trap…), daily intelligence review, `buildNightlyOrchestrator`, CLV grading, calibration metrics (Brier/ECE).

**Shadow T2 stack (built this week)**: NB ladders, Gaussian-copula correlation, isotonic marginal calibration, EV-gated parlay constructor — all shadow, kill-switched.

---

## 2. What's SHADOW (built, not feeding anything the operator sees)

`mlbContextualShift` composition · correlation engine · marginal calibration · parlay constructor · survivability gate · bullpen composition · process classifier / daily review (analysis only). All correct, all dark to the operator.

---

## 3. What's actually MISSING vs the vision (the real gaps)

1. **Cash-out / hedge helper** — #1 ask. No value calc, no haircut band (~70–90%), no equalizing-hedge stake, no "3+ leg parlay, 2 legs in, what's my cash-out / what do I hedge." Pure math, freeze-safe. **The single highest-leverage missing piece.**
2. **A surface that assembles the heavy-leg-craft workflow** — browse *obtainable* props → build a 5–15-leg parlay of reasonable legs → see joint prob + cash-out/hedge → the "$5–20 hits hella" model. The *pieces* exist (builders, correlation, calibration, ladders); they are not assembled into one fan-style workflow, and (per §0.2) maybe not surfaced at all here.
3. **First-class "obtainable vs longshot" tag** — adjacent logic exists (archetypes, survivability floors, fragility, role legitimacy) but no single bettor-facing obtainability label. (This is what the matchup-intel build was going to add.)
4. **Usage-redistribution beneficiary naming** — `nbaTeammateContextDeriver` computes ±3pp on teammate absence but does NOT surface "Player X benefits because Star Y is OUT" by name. Research calls this the #1 codifiable edge. Partial.
5. **Anomalous-move SUPPRESS gate** — steam/dispersion detection exists; it is not wired as a candidacy suppressor (integrity rule).
6. **Umpire signal** — the one net-new matchup signal (still true).
7. **Cross-sport parity** — most shadow math (correlation priors, marginal calibration, parlay) is MLB-only; NBA has heuristics, no fitted priors.

---

## 4. Reassessment of your concerns (vision alignment)

- "AI just makes a rigid math O/U guideline" — **the engine itself is not that.** It already models matchup, weather, park, platoon, lineup, bullpen, form (hot/cold), live scratches, line movement/steam, line-shopping, correlation, archetypes, and it already reads Twitter slips for sharp-vs-bait. What's true is: (a) most of it is **shadow**, (b) the explicitly-fan pieces you keep naming — **cash-out, heavy-leg obtainable-parlay craft, an obtainability tag** — aren't assembled, and (c) **I can't see the FE that would make any of this feel like your friend's workflow.** The rigidity you feel is a *surfacing* problem more than a *brains* problem.
- "Heavy leg of obtainable props where a few bucks hits hella" + "3+ HR parlay, take an early cash-out" — directly served by gaps #1 (cash-out) + #2 (craft surface) + #3 (obtainability). These should lead the roadmap, ahead of more shadow math.
- "So many variables, duh we should track X" — most of the research "track-this" menu is already built (§1). The remaining named ones: umpire, beneficiary-naming, anomalous-move suppress, catcher framing (low/decaying), BvP (no clean data).

---

## 5. CB verification addendum (folded in, binding for shadow features)

Per CB: a shadow feature does NOT close on code-diff + fixtures + runtime:verify alone. Because it feeds nothing live, the **close is an OPERATOR-VISIBLE check**: a `/status` diagnostic line OR a probe dump the operator runs and reads, **plainly stating the signal will NOT appear on `/m` until promoted past the freeze.** Applies to the matchup-intel build and every shadow feature. (This also partly answers gap §0.2: shadow outputs need at least a `/status` diagnostic surface to be verifiable, since the workstation FE may not be here.)

---

## 6. Re-prioritized build shortlist (matches the vision, not rigid math)

1. **Cash-out / hedge helper (build first — freeze-safe, pure math, your #1 ask, immediately visible).** Given a parlay's legs (hit/pending) + current odds: fair cash-out value, the book's likely haircut band, and the equalizing-hedge stake on the opposite side. Surface via `/status` diagnostic + probe now; FE card when we know where the FE is.
2. **Confirm the FE location + wire one operator-visible surface.** If the workstation PWA is a separate repo, the highest-value move may be there, not in backend. Decide before building more dark backend.
3. **Obtainability tag + matchup-intel (umpire) as the shadow enrichment** — the originally-approved build, now correctly scoped to *reuse* the rich existing context/live-state layers + add umpire + the obtainability/integrity tag, closed with an operator-visible /status diagnostic (CB rule).
4. **Usage-redistribution beneficiary naming** (extend `nbaTeammateContextDeriver` / MLB lineup-state to name the beneficiary).
5. **Anomalous-move suppress gate** (wire the existing steam/dispersion detection as an integrity suppressor).

**Honest framing:** none of this is "bet X to win big." It's assembling the fan workflow you described and making the intelligence you already paid to build *visible and actionable* — cash-out first, surfacing second, more signals third.
