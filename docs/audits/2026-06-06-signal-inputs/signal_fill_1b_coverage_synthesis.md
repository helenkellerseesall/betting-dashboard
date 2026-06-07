# Signal-Fill-1B — Coverage Probe Synthesis (read-only audit)

Date: 2026-06-06. Five batched coverage probes, no code touched. Audit-before-patches. Per-item detail in
`.scratch/probe_1b_*.txt`. Operator reviews, picks order, then per-item build plans ship one at a time.

## Headline reframes (the audit changed the assumed scope)

1. **The pitcher cache does NOT need "expansion."** The populator (`refreshMlbPitcherStats.js`) already fetches
   every probable starter on the slate via `/schedule?hydrate=probablePitcher`. Tonight's 3 games → 6 opposing
   starters, all 6 cached (0 missing). The "30 vs 96" was a misframe — 30 is accumulated history, not a deficit.
   So FIX 3 and FIX 4 are **wiring**, not cache work. Only **restDays (7c)** is a real data gap.
2. **The HR engine already consumes `row.pitcherFlyBallRate`** — it's just never fed. So probe 3 is a feed, not a
   wiring problem.

## Per-item verdicts

| # | Item | Anchor | Verdict | Why |
|---|------|--------|---------|-----|
| 3a | **FIX 3 batterKs ← opposing pitcher k9** | model | **SHIP CLEAN** | `buildMlbPlayerDataset.js:215` defaults to the `8.5` constant; the real opp k9 already exists on the row via `pitcherEnvironmentContext` — just thread it in. Model-anchored → legit. |
| 3b | **FIX 4 HR/9** | model | **SHIP CLEAN** | `homeRunsAllowed` + `inningsPitched` already cached → derive `HR/9`; wire into the model-anchored HR candidate score. No new data. |
| 4B | **NBA pace → points band** | model | **~~SHIP CLEAN~~ → CORRECTED 2026-06-06 → BUMP (already wired)** | Pre-build empirical check overturned this. Pace IS folded into the continuous points score: `pace → paceZ (nbaModelSignals.js:522) → ctxBundle [paceZ, 0.45] → ctxZ → primaryBundle [ctxZ, w.ctx=0.18 for points]`. Drove the real `nbaRowIndependentModelProbability` (else-identical points row): pace 95→0.5277, 100→0.5373, 105→0.5468 (monotonic, ~+2pp across the NBA range). Two read-depth errors in the original probe: (a) misread the L439 "pace 0% reaching base" comment — it describes a *fixed* 2026-05-24 enrichment-bypass bug (`_ensureEnriched` on L442), not current behavior; (b) stopped reading at ~L514, before the `ctxBundle` at L548 where pace is used. NO dead wire → nothing to build. Only lever is weight-tuning (calibration-driven, deferred — NOT 1B). |
| 5 | **NBA assists opp-allowed multiplier** | model | **~~SHIP CLEAN~~ → CORRECTED 2026-06-06 → BUMP (already wired)** | Pre-build empirical check overturned this. Assists already responds to opponent assists-allowed: `familySpecificOppZ` (nbaModelSignals.js:**305-309**) reads `opponentStats.assistsAllowed`, set by nbaTeamStatsCache:244 from `assistsAllowedPerGame` (deriveNbaTeamDefensive:177), populated for the 8 active playoff teams. Drove the real `nbaRowIndependentModelProbability` (assists): assistsAllowed 20→0.45 / 25→0.53 / 30→0.61. The bettor prob path (`nbaRowModelProbability`) uses this scorer. Synthesis read-depth error: missed the assists branch in `familySpecificOppZ`. Also: the per-role pattern it cited is mostly dead — only `opponentThreePAMultiplier` is consumed (buildNbaPlayerOutcomePredictions:1169); reb/steals/blocks per-role are read only by legacy probes (→ task #95 hygiene). No dead wire. Per-role enhancement deferred (new signal, calibration-backed). |
| 7c | **MLB pitcher restDays** | model | **~~SHIP w/ CAVEAT~~ → CORRECTED 2026-06-06 → BUMP/DEFER (no scoring consumer)** | restDays IS null (real data gap) — but the consumer-sweep found it has NO scoring consumer. Chain: restDays → `fatigueFlag` (deriveMlbPitcherEnvironmentContext:107, ALSO gated on null `recentWorkloadPitches`) → `PITCHER_FATIGUED` **display tag only** (composeMlbContextualSignal:111). The scored `pitcherEnvShift` is `kEnvironmentShift` alone (composeMlbContextualSignal:75) — fatigueFlag is NOT in it. So even fully populated, restDays moves no probability/projection — a cosmetic non-fix worse than the other bumps (real infra work, zero impact). The REAL rest signal is a 3-part future phase → **task #96 MLB-Rest-Signal-1A**: (1) gamelog populator expansion (restDays + recentPitches), (2) NEW model-anchored rest term on the OUTS engine — NOT the Ks engine (market-anchored, Trap-5 double-count, FIX 7a precedent), (3) calibration that rest is an edge post-market. Not a 1B fill. |
| 2 | **MLB opp-team K-rate (pitcher Ks)** | **market** | **BUMP** | Pitcher Ks engine is market-anchored (`marketLambda` = Poisson fit to the book line). Books already price lineup K-tendency into the Ks line → adding it double-counts. Same failure mode as FIX 7a. No team K% cache exists either. |
| 3c | **MLB pitcher FB% (HR)** | model | **NEEDS NEW FEED** | Engine already wired to consume it; no FB% source anywhere. Requires a new Baseball Savant batted-ball populator. Group with other Savant needs or defer to 1C. |
| 4A | **NBA points PvD (player-vs-defender)** | n/a | **BUMP TO 1C+** | No public defender-assignment/tracking source. Materially bigger lift than the rest of 1B; needs its own phase + a data decision. Team DvP already approximates at role level. |

## Suggested ship order (operator decides)

**1B core after empirical pre-checks = 2 SHIPPED + 2 BUMPED + 1 remaining** (was "4 build + 1"):

1. **FIX 3 batterKs** — SHIPPED 2026-06-06 (code 102c091). `pitcherEnvironmentContext.kRate` → `obj.opposingPitcherKRate`; `eKs = kRate × 4.2`. (Plan said k9×9 — unit error corrected.)
2. ~~**4B NBA pace → points**~~ — **BUMPED** (already wired via ctxBundle paceZ).
3. **FIX 4 HR/9** — SHIPPED 2026-06-06 (code dc9dc4c, 2-file). Consumer-sweep caught the bettor-path site mlbIsolatedRoutes:381 (TEMP 1.2 hard-set) — the 1-file scope would have been a non-fix.
4. ~~**NBA assists opp multiplier**~~ — **BUMPED** (already wired via familySpecificOppZ:305 team-level assists-allowed).
5. **FIX 7c restDays** — REMAINING; the only genuine data-gap item (needs the gamelog populator expanded). NEXT, empirical pre-check first.

**Out of 1B:** probe 2 (BUMP — double-count), probe 3c (NEW FEED — 1C/Savant), probe 4A (BUMP — own phase),
4B pace (BUMP — already wired), probe 5 assists (BUMP — already wired). Hygiene → task #95 (dead per-role multipliers).

**NEW DISCIPLINE (binding, from the 4B + probe-5 misses):** a claim that a wire is DEAD must be empirically verified
by driving the REAL engine (vary the input, watch the output move) BEFORE building the fix. Scorecard: FIX 3 real
dead wire (shipped); FIX 4 real dead wire on the bettor path (shipped, 2-file via consumer-sweep); pace + assists
both already live (bumped). 2 of 5 synthesis "builds" were already wired — the pre-check earned its keep twice.

Each build item ships as its own bisectable commit, regression-gate-first, runtime:verify 13/13, per the 1A rhythm.
Each is model-anchored (Trap-5 clean); the market-anchored candidate (probe 2) is correctly bumped.

## Effort (rough)
FIX 3 ~1–2h · 4B ~1–2h · FIX 4 HR/9 ~1–2h · assists multiplier ~half-day · restDays ~half-day (populator).
Bumped: FB% feed ~1+ day (new Savant ingest) · PvD = own phase.

## FINAL SCORECARD — Signal-Fill-1B COMPLETE (2026-06-06)
- **2 SHIPPED (real-fix builds):** FIX 3 batterKs `102c091` · FIX 4 HR/9 `dc9dc4c` (2-file, bettor-path site caught by consumer-sweep).
- **3 BUMPED-FOR-CAUSE (synthesis corrected):** 4B pace (already wired, ctxBundle paceZ) · probe 5 assists (already wired, familySpecificOppZ:305) · 7c restDays (no scoring consumer — display tag only).
- **3 PERMANENTLY OUT-OF-SCOPE (original triage):** probe 2 opp-team K-rate (Trap-5 market-anchored double-count) · probe 3c FB% (needs Baseball Savant feed → 1C) · probe 4A PvD (no public defender-tracking source).
- **Discipline outcome:** empirical-pre-check + consumer-sweep flipped 3 of 5 "build" candidates and caught 1 scope expansion (HR/9 → 2-file) — **zero wasted commits**, zero non-fixes shipped.
- **New backlog surfaced:** task #95 NBA-DvP-Multiplier-Cleanup-1A (dead per-role multipliers) · task #96 MLB-Rest-Signal-1A (the real restDays: populator + outs-engine wire + calibration).
- **Downstream:** Wave 1 A2 / mlScorer (#86) unblocks ~7 days as the Calibration-LineAware-1A corpus accumulates.
