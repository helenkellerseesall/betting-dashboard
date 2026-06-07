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
| 4B | **NBA pace → points band** | model | **SHIP CLEAN** | `row.pace` is populated + read, but the pace `matchupAdj` only fires for DD/TD; the continuous points path ignores it (matches the "pace 0% reaching base" trace). Cheap fold, model-anchored. |
| 5 | **NBA assists opp-allowed multiplier** | model | **SHIP CLEAN** | Established pattern (3PA/reb/steals/blocks already derived); per-role assists-allowed is already in `nbaDvP.json`. Add the multiplier + consume it. Model-anchored. |
| 7c | **MLB pitcher restDays** | model | **SHIP w/ CAVEAT** | Real gap: `restDays` null (season endpoint omits it); gamelog cache holds only 4 pitchers. Needs the gamelog populator expanded to all starters + restDays **computed** from last-game date (~half-day). Do before claiming live. |
| 2 | **MLB opp-team K-rate (pitcher Ks)** | **market** | **BUMP** | Pitcher Ks engine is market-anchored (`marketLambda` = Poisson fit to the book line). Books already price lineup K-tendency into the Ks line → adding it double-counts. Same failure mode as FIX 7a. No team K% cache exists either. |
| 3c | **MLB pitcher FB% (HR)** | model | **NEEDS NEW FEED** | Engine already wired to consume it; no FB% source anywhere. Requires a new Baseball Savant batted-ball populator. Group with other Savant needs or defer to 1C. |
| 4A | **NBA points PvD (player-vs-defender)** | n/a | **BUMP TO 1C+** | No public defender-assignment/tracking source. Materially bigger lift than the rest of 1B; needs its own phase + a data decision. Team DvP already approximates at role level. |

## Suggested ship order (operator decides)

**1B core = 4 clean wiring/derivation fixes + 1 caveated populator item.** Order by confidence × cheapness:

1. **FIX 3 batterKs** — highest-confidence wiring; thread `pitcherEnvironmentContext.k9` → `playerObj.opposingPitcherKper9`.
2. **4B NBA pace → points band** — cheap model fold.
3. **FIX 4 HR/9** — derive from existing fields + wire into HR candidate.
4. **NBA assists opp multiplier** — mirror the existing opp-allowed pattern.
5. **FIX 7c restDays** — last, because it needs the gamelog populator expansion first (the only data work in the core).

**Out of 1B:** probe 2 (BUMP — double-count), probe 3c (NEW FEED — 1C/Savant), probe 4A (BUMP — own phase).

Each core item ships as its own bisectable commit, regression-gate-first, runtime:verify 13/13, per the 1A rhythm.
Each is model-anchored (Trap-5 clean); the one market-anchored candidate (probe 2) is correctly bumped.

## Effort (rough)
FIX 3 ~1–2h · 4B ~1–2h · FIX 4 HR/9 ~1–2h · assists multiplier ~half-day · restDays ~half-day (populator).
Bumped: FB% feed ~1+ day (new Savant ingest) · PvD = own phase.
