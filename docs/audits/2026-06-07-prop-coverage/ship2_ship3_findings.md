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

### PHASE 0 ADDENDUM (deeper trace, 2026-06-08 — corrects the scope above to 3 files + 1 modeling refinement)

A deeper pre-build trace found the enablement is bigger than "2 files / additive key," and surfaced a modeling pitfall. Both are within the approved "Poisson capped SB family" design — but they're real implementation facts the operator should see:

1. **3 files, not 2 — the SB rate isn't plumbed to the projection layer yet.** `projectHitterStats` reads `playerObj.batterStats`, but the blob built in `applyMlbContextualLayers.js:140-154` carries avg/obp/slg/… and **NOT** `stolenBases`/`gamesPlayed`. So a third file (`applyMlbContextualLayers.js`, the context layer — not PRESERVED Tier-1) needs two additive fields so the rate is available. Touch sites: `applyMlbContextualLayers.js` (blob +2 fields) · `buildMlbPlayerDataset.js` (HITTER_STATS += stolenBases; projectHitterStats SB band) · `buildMlbPropClusters.js` (STAT_FAMILIES; resolveStatFamily branch; **modelProbForSide bypass**; tierForPlay cap; kill-switch).

2. **Modeling refinement — SB needs a no-shrink prob bypass (or it manufactures fake edge).** `modelProbForSide` applies a 0.65 ladder-shrink that pulls every probability toward 0.50. For a low-rate stat like SB (most batters P(SB≥1) ≈ 1–15%), the shrink would inflate a real 6% to ~21% — erasing the steal-rate signal and creating uniform fake positive edge on every SB-over. SB must use a dedicated **no-shrink Poisson bypass** (mirroring the existing HR bypass), returning the raw `P(SB≥1)=1−e^(−λ)` capped, so edge reflects the real rate vs the line. Without this, SB picks would be dishonestly +EV-looking — a Step-1/trust violation.

**Poisson math verified on real data** (`data/mlbBatterStats.json`, 390/390 batters have SB+GP): Bobby Witt Jr λ=0.348 → P(SB≥1)=29.4% (competitive vs a typical +250 SB-over); median base-stealer ≈1.6%; 135 zero-SB batters → P=0 → no edge → no pick; null rate → no pick (probabilityHonesty). So the model is well-grounded and honest at the tails.

**Why this gets its own focused build turn:** it's a 6-site cognition change across the context + projection + prob-model + tier layers. The capped-tier + kill-switch + "existing-families byte-identical" gate fully contain the risk, but the verification (9 existing families byte-identical pre/post, OFF byte-identical, SB capped, null-rate no-pick, grader settles a synthetic SB pick end-to-end) deserves rigor, not a rushed same-turn cram after SHIP 3. Design unchanged; only the implementation footprint + the no-shrink honesty fix are new. Build executes next turn.

---

## SHIP 3 — `nrfi`/`yrfi` correct vendor key: INVESTIGATED → STOP for operator decision

**Confirmed:** `nrfi`/`yrfi` are **not valid Odds API market keys** — they're in the 12 markets stripped from every MLB request (probe: `marketsRequested` excludes both, all 8 events). So the config keys are simply wrong names.

**The correct markets are first-inning PERIOD markets**, not player props. The Odds API supports "innings odds" ([betting-markets reference](https://the-odds-api.com/sports-odds-data/betting-markets.html)); by its documented `<market>_<period>` convention the first-inning keys are **`totals_1st_1_innings`** (1st-inning over/under — **under 0.5 ≈ NRFI**), `h2h_1st_1_innings`, `spreads_1st_1_innings`. Exact strings should be confirmed against that reference page or ONE probe event before wiring (the page timed out on fetch this turn; not worth quota to brute-force).

**Architectural flag (important):** these are **GAME-LEVEL period markets, not player props.** Per the repo design (v2 §2), game markets (`h2h`/`spreads`/`totals`) are requested for CONTEXT and **never scored as picks**. So NRFI/YRFI is a **NEW MARKET CLASS** — a game-period bet that the current player-prop scoring/surfacing pipeline doesn't handle. Wiring it as a bettable pick is a deliberate build, not a key fix.

**Recommendation (operator decides):**
- **Cheap hygiene now (separable, ~SHIP 1 class):** remove the dead `nrfi`/`yrfi` from `sportConfig.mlb.extraMarkets` so the request surface is honest (they're rejected every slate anyway). Zero behavior change.
- **If you want NRFI/YRFI as a bet:** scope it as its own new-market-class build (request `totals_1st_1_innings`, add 1st-inning game-period scoring + surfacing). Bigger than this batch. Hold unless you want it.

No quota spent. No code written.
