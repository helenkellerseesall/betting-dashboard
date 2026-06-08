# Defect Batch — SHIP 2 (stolen bases) PHASE 0 + SHIP 3 (first-inning) investigation

**Date:** 2026-06-08 ET · **Author:** Claude-B (4.8) · **Type:** read-only PHASE 0 / investigation — NO code written
**Context:** SHIP 1 (sportConfig.nba guard) is on its own fence. SHIP 2 + SHIP 3 below are paused for operator/Claude-A decision per the discipline (SHIP 2 = a cognition change; SHIP 3 = a new market class).

---

## SHIP 2 — enable `batter_stolen_bases`: PHASE 0 verdict = TRACTABLE ADDITIVE BUILD (needs one modeling decision)

**It is NOT a toggle.** End-to-end enable needs four touch points; I traced each:

1. **Classifier** — `resolveStatFamily` in `buildMlbPropClusters.js` has NO stolen-base branch → returns null → the 115 rows/slate are dropped. Add a branch `→ "stolenBases"`. *(trivial, additive)*
2. **Family registry** — `STAT_FAMILIES` (`buildMlbPropClusters.js:414`) lacks it. Add `"stolenBases"`. *(trivial)*
3. **Projection band** — `modelProbOver` (`:559`) needs `pred.stats.stolenBases.mostLikely`. The per-family band map is a clean object literal in **`buildMlbPlayerDataset.js:232-313`** (hits/tb/hr/rbis/runs/ks/outs/walks…). Adding `stolenBases: { floor, mostLikely, ceiling }` is a **new key — every other family's band is byte-identical**. This is the additive, low-blast-radius part. Plus a `deriveSigma`/`zScale` case for the low-rate stat. *(moderate, additive)*
4. **Tier cap + kill-switch** — capped tier (never ELITE/STRONG, per Step-1 discipline — zero graded SB history) + `MLB_ENABLE_STOLEN_BASES` (default ON to start the grading clock; `"0"` = byte-identical to today). *(small)*

**Grader is ALREADY SB-ready** — strong signal this was a half-finished enablement: `fetchMlbGameResults.js:60` extracts `stolenBases` from the boxscore and `:211` resolves `sb/stolenbases/batterstolenbases → _batting.stolenBases`. So a tracked SB pick **will** settle; the grading clock ticks immediately. *(no change needed)*

**Data exists** — `data/mlbBatterStats.json` carries `stolenBases` per batter (`refreshMlbBatterStats.js:232`), so the projection is **not fabricated** — it's rate-derived.

**THE ONE DECISION (cognition — wants your nod before I build):** how to project SB.
- **Recommended:** Poisson, mirroring the blessed pitcher-K engine. `λ = seasonSB / gamesPlayed`; for the standard 0.5 line, `P(SB ≥ 1) = 1 − e^(−λ)`; band `{floor 0, mostLikely round(λ), ceiling λ+buffer}`. Consistent with existing methodology, uses real SB rate, honest when rate is missing (null → no pick, never a fabricated band).
- **Tier stays capped regardless** of computed edge — we have no proven SB model, so it can never present as a confident pick until ~14 days of grading prove it. Enabling now just **starts the clock**.

**Regression gate when built:** every existing family's band + tier BYTE-IDENTICAL pre/post (additive key only); SB appears only at capped tier; `MLB_ENABLE_STOLEN_BASES=0` ⇒ fully byte-identical; SB picks actually generate AND are gradeable (drive one slate); `runtime:verify` 13/13. Files: `buildMlbPlayerDataset.js` + `buildMlbPropClusters.js` (+ kill-switch). MLB preserved-file shas unchanged except these two (neither is on PRESERVED Tier-1).

---

## SHIP 3 — `nrfi`/`yrfi` correct vendor key: INVESTIGATED → STOP for operator decision

**Confirmed:** `nrfi`/`yrfi` are **not valid Odds API market keys** — they're in the 12 markets stripped from every MLB request (probe: `marketsRequested` excludes both, all 8 events). So the config keys are simply wrong names.

**The correct markets are first-inning PERIOD markets**, not player props. The Odds API supports "innings odds" ([betting-markets reference](https://the-odds-api.com/sports-odds-data/betting-markets.html)); by its documented `<market>_<period>` convention the first-inning keys are **`totals_1st_1_innings`** (1st-inning over/under — **under 0.5 ≈ NRFI**), `h2h_1st_1_innings`, `spreads_1st_1_innings`. Exact strings should be confirmed against that reference page or ONE probe event before wiring (the page timed out on fetch this turn; not worth quota to brute-force).

**Architectural flag (important):** these are **GAME-LEVEL period markets, not player props.** Per the repo design (v2 §2), game markets (`h2h`/`spreads`/`totals`) are requested for CONTEXT and **never scored as picks**. So NRFI/YRFI is a **NEW MARKET CLASS** — a game-period bet that the current player-prop scoring/surfacing pipeline doesn't handle. Wiring it as a bettable pick is a deliberate build, not a key fix.

**Recommendation (operator decides):**
- **Cheap hygiene now (separable, ~SHIP 1 class):** remove the dead `nrfi`/`yrfi` from `sportConfig.mlb.extraMarkets` so the request surface is honest (they're rejected every slate anyway). Zero behavior change.
- **If you want NRFI/YRFI as a bet:** scope it as its own new-market-class build (request `totals_1st_1_innings`, add 1st-inning game-period scoring + surfacing). Bigger than this batch. Hold unless you want it.

No quota spent. No code written.
