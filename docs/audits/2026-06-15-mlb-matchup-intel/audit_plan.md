# MLB Matchup-Intel Enrichment Layer — Audit + Build Plan (SHADOW)

**Author:** Claude-B [Cowork, Opus 4.8]
**Date:** 2026-06-15 ~17:55 ET (clock-checked)
**Mode:** AUDIT-FIRST, read-only. NO code. STOP after this for operator approval.
**Goal:** systematize "fan knowledge" (umpire, weather/wind, bullpen fatigue, platoon, order slot) into per-player matchup/obtainability signals — SHADOW, behind `MLB_MATCHUP_INTEL`, feeds NOTHING live. Grounded in docs/research/2026-06-15-prop-parlay-craft-playbook.md (#2 shortlist) + .../parlay-edge-menu-and-integrity.md (Part 4 menu, Part 1 integrity).

---

## 0. Headline — 3 of 4 signals already exist; only UMPIRE is net-new

The repo already has a canonical MLB contextual-enrichment layer: **`backend/pipeline/mlb/context/applyMlbContextualLayers.js`** (the "Phase 1 Contextual Intelligence Coordinator") with derivers for **bullpen, weather+wind, park, handedness/platoon, lineup**. Its own header states it is **purely additive and does NOT feed scoring** ("no probability override … hydrate computes predictedProbability without consuming mlbContextualShift"). So:

- **Bullpen** → `deriveMlbBullpenContext.js`. **Weather/wind** → `deriveMlbWeatherContext.js`. **Park** → `deriveMlbParkContext.js`. **Platoon** → `deriveMlbHandednessContext.js`. **Order slot** → `deriveMlbLineupContext.js`. All already canonical (Law 1 — REUSE, do not duplicate).
- **Umpire strike-zone is the ONLY net-new signal** — no deriver, no field. (Playbook Part 4 MLB #1: HIGH value but *decaying under the ABS challenge era — re-weight down over time*.)
- `buildMlbWeather.js` is **`@orphan`** (its own header: "script-only legacy; superseded" by `ingest/refreshMlbWeatherForSlate.js` + the context deriver). **Do NOT touch it; do NOT add weather code** — weather is owned by `deriveMlbWeatherContext`.

So this build is mostly *composition over existing signals* + one new signal (umpire) + the obtainability/integrity tagging. That is small and freeze-safe.

---

## 1. Where per-player enrichment attaches + the identity join

- **Attach point:** `applyMlbContextualLayers({ rows, events })` enriches the built snapshot rows (per player+event), wired one-line in `backend/http/mlbIsolatedRoutes.js`. The derived signals **persist to the CURATED board rows** (`mlb_tracked_best_<slate>.json` / `/api/best-available`) via `phase4Tracking.js:202-216` as flat fields: `hrFactor, windDirectionTag, temperatureF, hrEnvironmentTag, runEnvironment, rbiEnvironment, isPlatoonAdvantage, lineupSpot, plateAppearancesProxy, contextualTags`.
- **Coverage (real, 2026-06-13/14):** on `mlb_tracked_best` — hrFactor & isPlatoonAdvantage & contextualTags ~100%, windDirectionTag ~65%, lineupSpot ~30%. The **graded ledger `mlb_tracked_bets` carries odds/movement (openOdds/closeOdds) but NOT context** (all 0). → matchup-intel reads context from the **curated board**; the anomalous-line-move guard reads odds from the board/ledger.
- **Identity join:** `backend/storage/intelligence.js:178` `normPlayer` (exported :1393) + `utils/normalizeName` + `eventId` — the canonical join the context layer already uses. Umpire joins by `eventId`/game; player context by normalized name + event.

---

## 2. Signal sources (free) + the umpire honesty caveat

| Signal | Status | Source | Note |
|---|---|---|---|
| Wind dir+speed + park HR/run env | EXISTS | Open-Meteo (free) via `refreshMlbWeatherForSlate` → `deriveMlbWeatherContext`; park via `deriveMlbParkContext` (roof overrides weather) | REUSE row fields `windDirectionTag/hrFactor/hrEnvironmentTag/temperatureF`. |
| Bullpen fatigue (3-day pitch load) | EXISTS | MLB StatsAPI → `deriveMlbBullpenContext` | REUSE bullpen context (`mlbBullpenWorkload.json`). |
| Platoon / handedness | EXISTS | `deriveMlbHandednessContext` | REUSE `isPlatoonAdvantage`. |
| Batting-order slot / PA volume | EXISTS | `deriveMlbLineupContext` | REUSE `lineupSpot` + `plateAppearancesProxy`. |
| **Home-plate umpire zone** | **NEW** | MLB StatsAPI boxscore **officials = ump NAME (free)**; zone SIZE = UmpScorecards (NO clean API) / derivable from Statcast called pitches | v1: capture ump name + join a maintained `umpireZoneTendency.json` (K/BB lean); **null = honest absence** when unknown. Decay weight over time (ABS). |

**Honest umpire limit:** there is no free programmatic umpire-zone feed. v1 ships the *name capture* + a small seed table (may start empty → tags null), never a fabricated zone. This is the one signal that may land as "present but data-thin" initially.

---

## 3. Design (SHADOW, freeze-safe, Law-1-clean)

**NEW `backend/pipeline/mlb/mlbMatchupIntel.js`** — sibling to the existing shadow features (`mlbCorrelationEngine` / `mlbMarginalCalibration` / `mlbParlayConstructor`); kill-switch `MLB_MATCHUP_INTEL` (read-once, `[MLB-MATCHUP-INTEL-BOOT]`). Pure; feeds NOTHING live.

`enrichMatchupIntel(row)` → `{ umpire, reusedContext, obtainability, matchupFavorable, integrity, suppress, tag } | null` (null when OFF):
- **reusedContext:** reads the existing per-row fields (`hrFactor, windDirectionTag, hrEnvironmentTag, isPlatoonAdvantage, lineupSpot, plateAppearancesProxy, runEnvironment, contextualTags`) — REUSE, never re-derive (Law 1).
- **umpire:** join ump name (from event) → `umpireZoneTendency.json` → `{ name, kLean, bbLean } | null` (honest absence). Only informs ks/walks-family tags; decay flag.
- **obtainability tag:** `obtainable` vs `longshot` from role floor — top-of-order (`lineupSpot` 1-5) + adequate `plateAppearancesProxy` + floored stat (hits/totalBases over) = obtainable; deep order (7-9) + ceiling stat (hr) = longshot. (Playbook §"obtainable vs longshot".)
- **matchupFavorable tag:** aligns reused context with the bet side — e.g. wind-out + high hrFactor + over-hr = favorable; platoon advantage + over-hits = favorable; bullpen-fatigue + over-late-runs = favorable; umpire big-zone + over-ks = favorable.
- **integrity guardrails (Part 1 — baked in):**
  1. **Exclude single-actor micro-markets** — our families (totalBases/hits/hr/rbis/runs/ks/outs) are not pitch-level; guard rejects any micro/pitch-level family if it ever appears.
  2. **Down-weight low-limit / deep-bench** — deep `lineupSpot` (7-9) + low PA proxy ⇒ low-obtainability/down-weight (proxy for the two-way/10-day/deep profile).
  3. **Anomalous unexplained line move ⇒ `suppress: true`** — from `openOdds→closeOdds` (or open/close implied): a large move against the side with no lineup/weather cause ⇒ SUPPRESS, never an edge.
- **tag:** one rollup string (`ELITE-MATCHUP / FAVORABLE / NEUTRAL / LONGSHOT / SUPPRESS`).

**Law-1 reconciliation (flagged, not done in v1):** the *eventual* canonical home for umpire is `context/deriveMlbUmpireContext.js` wired into `applyMlbContextualLayers` (the enrichment owner). v1 keeps umpire inside the shadow module to avoid touching the live coordinator **during the R2 freeze**; reconcile post-freeze (same posture as the dampener / upside-builders / nba-correlation notes).

**Freeze/PRESERVED:** `mlbMatchupIntel.js` + `umpireZoneTendency.json` are NEW; `applyMlbContextualLayers` / context derivers / `buildMlbPropClusters` / scoring / PRESERVED untouched. Additive shadow, feeds nothing.

---

## 4. Build plan (after operator approval — NOT now)

1. `backend/pipeline/mlb/mlbMatchupIntel.js` — `enrichMatchupIntel(row)` + kill-switch `MLB_MATCHUP_INTEL`. Pure, shadow.
2. `backend/config/umpireZoneTendency.json` — seed table (name → kLean/bbLean + `_doc` caveat + ABS-decay note); may start minimal → null tags (honest).
3. `backend/scripts/verifyMatchupIntel.js` fixture → SUITES (**19 → 20**): reuses-context-not-rederive (assert it reads row fields, doesn't import weather/bullpen derivers); obtainability logic (top-of-order floored = obtainable; deep+ceiling = longshot); matchup-favorable alignment; integrity guardrails (micro-market reject; deep-lineup down-weight; anomalous-move ⇒ suppress); umpire null-when-unknown (NO fabrication); kill-switch OFF→null; FREEZE GUARD (buildMlbPropClusters / applyMlbContextualLayers / phase4Tracking reference nothing in the shadow; scoring byte-identical).
4. `backend/scripts/probeMatchupIntel.js` — NON-ZERO real output: run `enrichMatchupIntel` over a recent `mlb_tracked_best` slate; print real tags + reusedContext + integrity flags on real players; umpire null where no zone data (honest). → `.scratch/last.txt`.
5. Brain docs (Law 12): MODEL_EVOLUTION_LOG, PIPELINE_AUTHORITY_MAP (new shadow matchup-intel authority + the note that umpire's canonical home is a context/ deriver post-freeze), MASTER_BRAIN, RUNTIME_FACTS (kill-switch).

**Verify discipline:** show diff before editing; NON-ZERO probe (real enrichment on a recent slate) + `runtime:verify` stays green; fixture added; commit fence handed to operator (not run by me). No scoring touched.

**Honest scope note:** this systematizes fan knowledge into a *visible obtainability/matchup tag* and bakes the integrity guardrails — it does NOT change any pick, edge, or score (frozen), and it is not +EV by itself. It's the human/quant blend surfaced as shadow signal, ready to wire into the curated surface post-freeze with operator approval.
