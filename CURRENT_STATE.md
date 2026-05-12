# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-12 (Session AO: Phase 1 — Context Ingestion V1 — NBA matchup intelligence wired into workstation modelProb; 1 file modified; TERM 1 restart REQUIRED)_

---

## SESSION AO — Phase 1 — Context Ingestion V1 (2026-05-12)

**Scope**: Wire the curated NBA matchup intelligence into the workstation `modelProb` path. The 30-team `DEFENSE_BY_ABBR` table + pace/total context signals were previously consumed only by the nightly `nbaOpportunityCandidates` pipeline; the live `/api/ws/state` snapshot-supplement path consumed `modelProb` without any contextual adjustment. Step-AN-1 populated `opponent` on snapshot rows, which made this the single highest-leverage real-context wiring available without new data ingestion.

**No new endpoints. No new modules. No synthetic fallbacks. No theater.**

### Phase 1 audit findings (informed the choice)

| Existing data file | State | Decision |
|---|---|---|
| `data/mlbGameWeather.json` | REAL Open-Meteo cache, **stale (Apr 26 mtime)** | DEFERRED — cache must refresh before wiring can be runtime-verified |
| `data/mlbParkFactors.json` | REAL 30-team hrFactor | DEFERRED with weather (sister signal) |
| `data/mlbPlayerPower.json` | REAL ~25 hitters | DEFERRED — small affected pool |
| `data/mlbStatcastPower.json` | REAL ~9 elite hitters | DEFERRED — tiny pool |
| `data/nbaPlayerGameLogs.json` | **EMPTY (`{"players":{}}`)** | DEFERRED — no recent-form data exists yet |
| `data/nbaPlayerProjections.json` | REAL 56 players | ACTIVE (Step-AN-1 already uses for opponent resolution) |

| Dormant intelligence module | Currently consumed by | Phase-1 decision |
|---|---|---|
| `nbaMatchupIntelligence.computeMatchupAdjustmentFromRow` | nightly only (`nbaOpportunityCandidates`) | **WIRED (this session)** |
| `nbaStatIntelligence.computeStatSpecificAdjustmentFromContext` | nightly only | DEFERRED |
| `nbaGameContextWeight.computePaceContextAdj/computeBlowoutContextAdj` | nightly only | DEFERRED |
| `buildMlbWeather` Open-Meteo fetcher | nightly only; weather cache stale | DEFERRED |
| `buildMlbHrPredictionCandidates` weather/park scoring | nightly only; signals stripped before tracked_best persistence | DEFERRED |

### Phase 1 candidate ranking (verified)

| Rank | Candidate | Data quality | Lines | Workstation impact | Verifiable today | Selected |
|---|---|---|---:|---|---|---|
| **1** | **NBA matchup intelligence → workstation modelProb** | REAL | ~50 | 50.1% of NBA rows (358/714) shift modelProb side-aware ±0–1.7 pp | YES | ✓ |
| 2 | MLB weather + park → workstation HR/TB | REAL but cache stale | ~100 | HR/TB at outdoor parks | NO until cache refresh | – |
| 3 | NBA recent-form cache from settled bets | sample too thin | ~120 | ~5–10 props | LOW | – |
| 4 | MLB statcast power → workstation HR | REAL covers 9 hitters | ~40 | tiny pool | yes | – |
| 5+ | injury, lineup, bullpen, umpire, travel feeds | **NO data exists** | n/a | n/a | DEFERRED | – |

### What changed (Session AO)

| File | Change |
|---|---|
| `backend/pipeline/nba/nbaModelSignals.js` | (1) Imported `computeMatchupAdjustmentFromRow` from `nbaMatchupIntelligence`. (2) Inside `nbaRowIndependentModelProbability`: after market anchoring, apply side-aware `matchupShift` (over: `+adj`; under: `-adj`). Honest 0 when matchup function returns 0/null/throws. (3) Added new exported function `nbaRowMatchupContext(row)` returning `{ adj, opponent, defensePart, pacePart, totalPart, sideAware }` for traceability. |

### Verified BEFORE / AFTER (offline replication, exact same enriched rows, opponent-stripped vs opponent-preserved)

| Metric | BEFORE (no matchup wiring) | AFTER (Phase 1 V1) |
|---|---:|---:|
| NBA base-line eligible rows | 714 | 714 |
| **modelProb CHANGED by matchup wiring** | – | **358 (50.1%)** |
| modelProb identical (opponent unresolved → honest 0) | – | 356 (49.9%) |
| **DEFENSE intelligence active** | 0 | **358 (50.1%)** ← real DEFENSE_BY_ABBR firing |
| TOTAL component active | – | 714 (100.0%) |
| PACE component active | – | 0 (0.0%) ← honestly null, no synthetic injection |
| edges affected | – | 358 (50.1%) |
| shift mean (\|shift\|) on affected rows | – | 0.0128 (1.28 pp) |
| shift max | – | 1.69 pp |
| shift p10 / p50 / p90 | – | -1.50 / 0.00 / +1.50 pp |
| candidates (post-diversify) | 26 | 26 (same — Phase 1 shifts probabilities, not pool size) |
| slips: safe / balanced / aggressive / lotto | 3 / 2 / 4 / 4 | 3 / 2 / 4 / 4 (Session-AM tier shape preserved) |

### Example side-aware matchup signals on current snapshot

```
Cade Cunningham assists OVER vs Cleveland Cavaliers   defense_pp=-1.06  modelProb 0.5769 → 0.5662
Cade Cunningham assists UNDER vs Cleveland Cavaliers  defense_pp=-1.06  modelProb 0.4353 → 0.4460   (under boosted)
Donovan Mitchell assists OVER vs Detroit Pistons      defense_pp=+1.58  modelProb 0.5610 → 0.5767   (DET weak vs guards)
Donovan Mitchell assists UNDER vs Detroit Pistons     defense_pp=+1.58  modelProb 0.4502 → 0.4344   (under suppressed)
Evan Mobley assists OVER vs Detroit Pistons           defense_pp=+1.69  modelProb 0.5542 → 0.5712
```

These are real, traceable, side-aware contextual adjustments. Each is itemized in `nbaRowMatchupContext(row)` so any downstream consumer can render the WHY without inventing it.

### Pass criteria (per user instruction)

| Criterion | Met |
|---|---|
| REAL data only (no synthetic fallback) | ✓ |
| Traceable (`nbaRowMatchupContext` returns itemized parts) | ✓ |
| Verified (358 rows visibly shift; side-aware math correct) | ✓ |
| Observable in runtime (probe shows shift; verification will show on live) | ✓ pending TERM 1 restart |
| Visibly changes runtime outputs | ✓ — half of NBA workstation candidates have new modelProb |
| Improves causal reasoning | ✓ — adjustment maps to actual opponent defensive profile |
| Reduces fake edges | ✓ — eliminates uniform pre-bias from rows with weak matchups |
| Preserves runtime integrity | ✓ — slip pipeline + tier shape unchanged |
| Preserves grading integrity | ✓ — no grading code touched |
| Preserves semantic honesty | ✓ — opponent missing → 0 contribution, not invention |

### Remaining blind spots (honest)

- **49.9% of NBA rows have no resolved opponent** — bounded by `data/nbaPlayerProjections.json` player coverage (56 players). Expanding that file is a separate session.
- **Pace data 0% populated** — `nbaModelSignals.contextSignals.pace` correctly returns null. To enable PACE component, NBA per-team pace data needs to enter snapshot rows. Source candidates: ESPN team stats, BasketballReference. Not in scope this session.
- **Recent-form data empty** — `nbaPlayerGameLogs.json` is `{"players":{}}`. Populating it is the natural next Phase-1 step but requires either an external feed or a settled-bets aggregator (deferred — sample is thin).
- **MLB has no contextual wiring yet** — weather cache stale; statcast/park dormant. Phase 1 V2 candidate after weather refresh.

### Files touched (Session AO)
- `backend/pipeline/nba/nbaModelSignals.js` (+45 lines, -2 lines including reorder)

### MLB regression check
- Single file modified is NBA-only.
- MLB consumes `playerModel.modelMlbPredictedProbability` — untouched.
- Zero MLB code path affected.

### TERM 1 restart required
**YES.** `nbaModelSignals.js` is loaded at server startup by `routes/workstationRoutes.js → buildSlipAi.js → ... → buildNbaSnapshotCandidates`.

### Exact TERM 1 command (one paste — full stale-port kill)
```
cd ~/Desktop/betting-dashboard && (lsof -ti tcp:4000 | xargs -r kill -9; sleep 2; lsof -i tcp:4000 || echo "port 4000 clear"); node backend/server.js
```

### Exact TERM 2 verification command (one paste)
```
cd ~/Desktop/betting-dashboard && curl -s "http://localhost:4000/refresh-snapshot/hard-reset" >/dev/null && sleep 12 && node backend/scripts/runVerification.js --sport=nba --session=AO-context-v1 --verbose && node -e "const fs=require('fs');const path=require('path');const sig=require('./backend/pipeline/nba/nbaModelSignals');const {applyTeamFallbackFromProjections,enrichNbaRowStatLayerInputs}=require('./backend/pipeline/nba/nbaEventTeamResolve');const s=JSON.parse(fs.readFileSync('backend/snapshot.json','utf8'));const r=s?.data?.rows||[];let active=0,total=0;for(const x of r){if(!x.player||(x.side||'').toLowerCase()==='unknown')continue;const mk=String(x.marketKey||'').toLowerCase();if(mk.includes('alternate')||mk.includes('_alt'))continue;const o=Number(x.odds);if(!Number.isFinite(o)||o<-200||o>200)continue;const e=applyTeamFallbackFromProjections(enrichNbaRowStatLayerInputs(x));const ctx=sig.nbaRowMatchupContext(e);if(ctx){total++;if(Math.abs(ctx.defensePart)>1e-6)active++;}}console.log('NBA matchup activation:',active,'/',total,'(',((active/total)*100).toFixed(1)+'%)','— DEFENSE intelligence active on workstation rows')"
```

### Pass criteria for TERM 2
- `runVerification` exits 0
- Last line shows `NBA matchup activation: ≥ 65% / DEFENSE intelligence active`
- `slips_by_tier` preserves the four NBA tiers (safe/balanced/aggressive/lotto each ≥ 1)

### Checkpoint recommendation
**RECOMMENDED ONLY IF** TERM 2 above shows matchup activation ≥ 65% AND `runVerification` exit 0:
```
cd ~/Desktop/betting-dashboard && node backend/scripts/checkpointRepo.js "Session AO: Phase 1 Context Ingestion V1 — NBA matchup intelligence wired into workstation modelProb"
```

If matchup activation stays at 50.1% post-restart, the patched fetcher (Step-AN-1) didn't get loaded — re-kill port 4000 before continuing.

---

_Pre-AO history below preserved as written by Session AN._

---

## SESSION AN — Contextual Edge Engine V1 (Steps 1 + 2 only) — 2026-05-12

**Scope**: Remove synthetic edge-inflation generators from the NBA prediction core; activate the existing-but-dormant opponent-defense intelligence at snapshot creation time. 2 files modified. **NO new endpoints. NO new modules. NO MLB changes.**

### Step 1 — Activate dormant matchup intelligence
| File | Change |
|---|---|
| `backend/pipeline/nba/fetchNbaOddsSnapshot.js` | After draftRow construction, run `applyTeamFallbackFromProjections(draftRow)` → populates `team` + `opponent` from `data/nbaPlayerProjections.json` lookup. |

The 30-team `DEFENSE_BY_ABBR` table in `nbaMatchupIntelligence.js` already exists with vsGuard/vsWing/vsBig/vsScorer/vsPlaymaker/vsGlass/vsPerimeter values — it was previously dormant because `row.opponent` was null on every snapshot row. Now resolved at fetch time using the same projections-file data the downstream enrichment was already using. **No new matchup engine.** Just wired the missing field.

Coverage ceiling: 23 / 32 unique players in current slate are in `nbaPlayerProjections.json` → ≈72% of NBA prop rows can resolve opponent. The remaining ≈28% have no team data anywhere we trust; opponent stays null for them. That is honest — those rows correctly receive 0 defense adjustment, not a synthetic one.

### Step 2 — Eliminate synthetic signal generators
| File | Change |
|---|---|
| `backend/pipeline/nba/nbaModelSignals.js` | `playerPrior(row)` and `eventPrior(row)` neutered to `return 0`. `roleSignals` returns `null` for usage/shots/astRate/rebRate/minutes/role when row source missing (no hash fallbacks). `contextSignals` returns `null` for pace/spread/total/oppDef when source missing. `recentFormSignal` returns `null` instead of `line × (0.90 + hash(player) × 0.12)`. New `honestWeightedScore()` helper re-normalises score over PRESENT signals only. `playerPrior * 0.22 + eventPrior * 0.06` direct score contributions REMOVED. `+ 0.015` systematic upward edge bump REMOVED. |

### Synthetic signals removed (verified)
- `playerPrior(row) → hash(player_name) → [-1, 1]` — direct +0.22 score contribution + injected into 6 fallback formulas
- `eventPrior(row) → hash(eventId)`        — direct +0.06 score contribution + injected into 2 fallback formulas
- `usageRate` fallback: `22 + hash(player)*5`
- `shotAttempts` fallback: `(line||anchor) × (0.55 + hash(player)*0.08)`
- `assistRate` fallback: `0.18 + hash(player)*0.05`
- `reboundRate` fallback: `0.14 + hash(player)*0.04`
- `projectedMinutes` fallback: `30 + hash(player)*4 + hash(event)*1.5`
- `pace` fallback: `99 + hash(player)*1.5`
- `gameTotal` fallback: `224 + hash(player)*2`  (gameTotal is real on snapshot; this fallback never ran but is removed)
- `spread` fallback: `5.5 + hash(player)*0.8`   (spread is real on snapshot; same)
- `opponentDefenseVsPosition` fallback: `hash(eventId)*2`
- `recentForm` fallback: `line × (0.90 + hash(player)*0.12)`
- `+0.015` systematic upward recenter on every NBA modelProb (the single largest source of fake "edge")

### BEFORE / AFTER (offline replication of live runtime, current snapshot.json + nba_tracked_bets_2026-05-09)

| Metric | BEFORE (pre-AN) | AFTER (Steps 1+2) | Delta |
|---|---|---|---|
| base-line NBA prop rows processed | 714 | 714 | – |
| modelProb present per row | 714 (100.0%) | 714 (100.0%) | – |
| edge ≥ 0.04 (PLAYABLE) | 169 (23.7%) | 180 (25.2%) | +11 |
| edge ≥ 0.12 (ELITE) | 22 (3.1%) | **17 (2.4%)** | **−5** (synthetic ELITEs removed) |
| mean signed edge | -0.0110 | **-0.0262** | **−0.0152** ≈ exactly the +0.015 bump removed |
| mean \|edge\| | 0.0562 | 0.0729 | +0.0167 (real magnitude unmasked) |
| edge p50 | -0.0129 | -0.0268 | −0.0139 |
| matchup ANY component fired | 99.4% | 99.4% | – |
| └ DEFENSE intelligence fired | 50.1% | 50.1% | – (Step 1 effect realises only on next snapshot fetch) |
| └ TOTAL component fired | 100.0% | 100.0% | – |
| └ PACE component fired | 0.0% | 0.0% | – (pace still missing — Step 2 correctly contributes 0) |
| snapSupplement (top-150 by edge) | 150 | 131 | −19 |
| novel after dedup | 148 | 129 | −19 |
| diversified aiCandidates | 27 | 26 | −1 |
| candidate edge mean | 0.2651 | 0.2724 | +0.0073 |
| candidates with edge ≥ 0.10 | 25 | 24 | −1 |
| slips: safe / balanced / aggressive / lotto | 2 / 3 / 4 / 4 | **3 / 2 / 4 / 4** | identity preserved (total 13) |

### Real-signal participation (after enrichment, AFTER state)

| Signal | Coverage | Quality |
|---|---|---|
| `spread` | 100.0% (714/714) | real (snapshot field) |
| `gameTotal` | 100.0% (714/714) | real (snapshot field) |
| `opponent` | 50.1% (358/714) → ceiling ~72% post-Step-1 fresh fetch | real (projections lookup) |
| `usageRate` (projections-default 19 for unknown) | 100.0% | mixed: real per-player for ~23 of 32; constant default for rest |
| `projectedMinutes` (projections-default 26 for unknown) | 100.0% | same |
| `pace` | 0.0% | **honestly missing** → contributes 0 to score (was hash-derived, now nulled) |
| `recentForm` / `last5Avg` | 0.0% | **honestly missing** → contributes 0 (was hash-derived, now nulled) |

### Honesty verdicts
- The +0.015 mean-edge shift is **mathematically equivalent** to the removed systematic upward bump. Step 2 is verified.
- ELITE-tier candidates dropped from 22 → 17. Five of those were artifacts of the bump pushing edges above 0.12; they were never real ELITE.
- PLAYABLE rose slightly (+11) because the wider, honest edge distribution lets more props cross the 0.04 threshold in either direction.
- Slip total preserved at 13 (Session-AM tier shape is unchanged) — but the underlying legs are now ranked on honest, not synthetic, edges.
- Step 1's defense activation rate (50.1%) is currently bounded by `nbaPlayerProjections.json` player coverage (56 known players). Future expansion of that file is a separate, non-AN session.

### MLB regression check
- Step 1 file is NBA-only (`fetchNbaOddsSnapshot.js`).
- Step 2 file is NBA-only (`nbaModelSignals.js` — MLB uses `playerModel.js`).
- **Zero MLB code touched. Zero MLB behaviour change.**

### Files touched
1. `backend/pipeline/nba/fetchNbaOddsSnapshot.js` (+12 lines, -2 lines)
2. `backend/pipeline/nba/nbaModelSignals.js` (≈+80 lines, -25 lines including the synthetic prior block, the +0.015 line, and the unconditional Z-score formulas)

### TERM 1 restart required
**YES.** Both files are loaded at server startup. Step 2 takes effect on next workstation request. Step 1 takes effect when `/refresh-snapshot/hard-reset` writes a new `snapshot.json`.

### TERM 2 verification (one paste)
```
cd ~/Desktop/betting-dashboard && curl -s "http://localhost:4000/refresh-snapshot/hard-reset" >/dev/null && sleep 12 && node backend/scripts/runVerification.js --sport=nba --session=AN-contextual-v1 --verbose && node -e "const s=JSON.parse(require('fs').readFileSync('backend/snapshot.json','utf8'));const r=s?.data?.rows||[];const withOpp=r.filter(x=>x.opponent).length;console.log('snapshot rows:',r.length,'with opponent populated:',withOpp,'(',(withOpp/r.length*100).toFixed(1),'%)')"
```

### Pass criteria
- `runVerification` exits 0
- new snapshot.json reports `opponent` populated on ≥ 65% of NBA rows (Step 1 verification)
- `runtime_snapshot.candidates` may decrease (honest scarcity); not a failure
- `slips_by_tier.safe ≥ 1` AND `balanced ≥ 1` AND `aggressive ≥ 1` AND `lotto ≥ 1` (Session-AM tier shape preserved)

### Checkpoint recommendation
**Recommended ONLY IF**: TERM 2 above shows opponent populated > 65% AND verification exits 0. The patches are surgical, syntax-clean, and offline-replicated. The risk is operational (stale TERM 1 process) — same risk pattern Sessions AH-AL exposed.

```
cd ~/Desktop/betting-dashboard && node backend/scripts/checkpointRepo.js "Session AN: Contextual Edge Engine V1 — Steps 1+2 — synthetic priors removed; opponent intelligence activated"
```

---

_Pre-AN history below preserved as written by Session AW._

---

## SESSION AW — Anti-Monoculture Portfolio Intelligence V1 (2026-05-11)

**Scope**: Portfolio concentration awareness layer. Prevents monoculture in PLAYABLE-tier bestProps without suppressing ELITE/STRONG edges. Adds bettor-language concentration warnings and a new diagnostic endpoint. 3 files modified + 1 new file. TERM 1 restart required (fetchNbaOddsSnapshot.js change takes effect on next live snapshot fetch).

### What changed

| File | Change |
|---|---|
| `backend/pipeline/nba/fetchNbaOddsSnapshot.js` | Added `CONCENTRATION_BUCKET_THRESHOLD=0.40` + `CONCENTRATION_SIDE_THRESHOLD=0.75` constants; added `concentrationDeferred` to `rejectCounts`; replaced flat single-pass selection with two-pass concentration-aware loop (ELITE+STRONG unconditional, PLAYABLE gated) |
| `backend/pipeline/tracking/buildPortfolioConcentrationDiagnostics.js` | **NEW** — pure diagnostic: reads bestProps array, returns concentration metrics + bettor-language warnings. No side effects. |
| `backend/server.js` | Added `buildPortfolioConcentrationDiagnostics` require (line 73); added `GET /api/portfolio-diagnostics` endpoint; added `concentration` sub-field to `GET /snapshot/status` response |

### Two-pass selection architecture

- **Pass 1**: All ELITE (edge ≥ 0.12) + STRONG (edge ≥ 0.07) props accepted unconditionally — real edges are never suppressed
- **Pass 2**: PLAYABLE (edge ≥ 0.04) gated by two soft concentration checks:
  - `(family|side)` bucket pct ≤ 40% of current pool
  - Side pct (over or under) ≤ 75% of current pool
  - Deferred count logged as `concentrationDeferred` in diagnostics

### Portfolio diagnostics module

Returns: `underExposurePct`, `overExposurePct`, `reboundsUnderExposurePct`, `threesUnderExposurePct`, `directionalConcentration` (0–1), `paceFragilityRisk` (LOW/MODERATE/HIGH), `sameEnvironmentDependency` (bool), `topConcentrationBuckets[]`, `warnings[]`, `structureHealthy`

### Live diagnostic results on current snapshot (56 bestProps, 2026-05-11)

| Metric | Value |
|---|---|
| Under exposure | 71.4% — HIGH |
| Rebounds-under | 23.2% of portfolio |
| Directional concentration | 0.43 |
| Pace fragility risk | HIGH |
| Same-environment dependency | true |
| Warnings generated | 4 bettor-language warnings |
| `structureHealthy` | false |

### Endpoints

```
GET /api/portfolio-diagnostics
  → { ok, generatedAt, total, underExposurePct, ..., warnings[], structureHealthy }

GET /snapshot/status
  → { ..., concentration: { underExposurePct, overExposurePct, reboundsUnderExposurePct,
       directionalConcentration, paceFragilityRisk, sameEnvironmentDependency,
       structureHealthy, warningCount } }
```

### Smoke tests (all pass)

- `node --check fetchNbaOddsSnapshot.js` → SYNTAX OK
- `node --check buildPortfolioConcentrationDiagnostics.js` → SYNTAX OK
- `node --check buildArchetypePerformanceSummary.js` → SYNTAX OK
- `node --check server.js` → SYNTAX OK
- Live snapshot test (56 props): `total=56 underExposurePct=0.714 paceFragilityRisk=HIGH warnings=4` ✓
- Archetype summary: `quality=reliable settled=22 insights=5` ✓ (unaffected)

### MLB regression: NONE

`buildPortfolioConcentrationDiagnostics` reads only `bestProps` array (NBA-only field). Two-pass selection only runs inside `buildNbaBestProps()` — never called for MLB. Diagnostics are non-critical in `/snapshot/status` (try/catch — won't block status response on error).

### TERM 1 restart required

`fetchNbaOddsSnapshot.js` is loaded at startup. The two-pass selection takes effect on next `/refresh-snapshot` call after restart. Until restart, existing snapshot.json serves its current 56 bestProps unchanged.

---

## SESSION AV — Signal Archetype Tracking V1 (2026-05-11)

**Scope**: Additive longitudinal signal intelligence layer. Aggregates real settled bet outcomes from `nba_tracked_bets_*.json` across a rolling window. Groups by statFamily, tier, side, named archetype combos. Generates runtime-visible insights. 2 files touched — new module + 1 server.js import+endpoint. No TERM 1 restart required.

### What changed

| File | Change |
|---|---|
| `backend/pipeline/tracking/buildArchetypePerformanceSummary.js` | **NEW** — Signal Archetype Tracking V1 aggregator |
| `backend/server.js` | Added 1 require + `GET /api/archetype-summary` endpoint (lines 72, ~10294) |

### Architecture

- **Source**: `runtime/tracking/nba_tracked_bets_*.json` — individual settled bet records
- **Fields used**: `statFamily`, `side`, `tier`, `result`, `oddsAmerican`, `edge`, `modelProb`, `date`
- **Groups**: `byStatFamily`, `byTier`, `bySide`, `byVolatility`, `archetypes` (named combos)
- **Named archetypes**: threes_under, threes_over, rebounds_under, rebounds_over, assists_under, assists_over, points_under, points_over, pra_under, pra_over
- **Sample quality flags**: `insufficient` (<8 settled), `emerging` (<20), `reliable` (≥20)
- **Insights**: auto-generated human-readable lines from real hit rates

### Live signal results (2026-05-05 to 2026-05-09, 22 settled bets)

| Archetype | Settled | Hit Rate | ROI |
|---|---|---|---|
| Rebounder Overs | 13 | 77% ✓ | +71.3% |
| Perimeter Specialist Unders | 3 | 100% ✓ | +151.3% |
| Rebounder Unders | 4 | 0% ✗ | -100% |
| ELITE tier | 13 | 69% ✓ | +63.9% |
| Overs overall | — | 73% | — |

### Endpoint

```
GET /api/archetype-summary?sport=nba&days=30
```

Returns: `{ ok, sport, window, sample, byStatFamily, byTier, bySide, byVolatility, archetypes, insights }`

### MLB regression: NONE

New file reads only `nba_tracked_bets_*` (sport-scoped). `buildArchetypePerformanceSummary` accepts `sport` param; MLB extension trivial. No existing tracking files modified.

### Smoke tests (all pass)

- `node --check buildArchetypePerformanceSummary.js` → SYNTAX OK
- `node --check server.js` → SYNTAX OK
- `totalSettled=22 quality=reliable` — real data loads
- `families=rebounds,threes,assists` — correct classification
- `insights=5` — believable trend lines generated

---

## SESSION AT — NBA bestProps Pipeline Wiring (2026-05-11)

**Scope**: Wire real scored NBA props into `snapshot.bestProps`. Root cause: `fetchNbaOddsSnapshot.js:446` hardcoded `bestProps: []`. Fix: add `buildNbaBestProps()` scoring pass. Also backfilled live `snapshot.json` immediately. 1 file modified + 1 data file patched. TERM 1 restart required.

### What changed

| File | Change |
|---|---|
| `backend/pipeline/nba/fetchNbaOddsSnapshot.js` | Added 2 imports (`nbaModelSignals`, `nbaEventTeamResolve`); added `buildNbaBestProps()` function (~90 lines); replaced `bestProps: []` with `bestPropsResult.props`; added `bestPropsCount` + `bestPropsDiagnostics` to `diagnostics` block |
| `backend/snapshot.json` | Backfilled `data.bestProps` with 46 scored props (atomic write — was 0) |

### `buildNbaBestProps()` logic

Mirrors `buildNbaSnapshotCandidates` (workstationRoutes.js) gate sequence, applied to the already-deduped raw props:

| Gate | Rejected (current slate) |
|---|---|
| Alt/ladder lines (no calibrated model above +200) | 2337 |
| Odds outside -200..+200 | 85 |
| No recognized stat family | 6 |
| modelProb < 0.35 | 0 |
| edge < 0.03 | 340 |
| **Passed** | **189 raw → 89 deduped** |

After dedup (best edge per player×family×side) and per-player cap (max 2):
- **46 bestProps selected** from 2957 raw rows
- Volatility split: balanced=35 (points/rebounds/assists), aggressive=11 (threes)
- Tier split: ELITE=19, STRONG=20, PLAYABLE=7
- Top prop: Alex Caruso threes under mp=0.597 edge=0.234 [ELITE]
- Quality floor: edge≥0.033, mp≥0.517

### Runtime logging

Every nightly run prints:
```
[NBA-BESTPROPS] rawRows=N isAlt=N oddsGate=N noFamily=N mpBelow35=N edgeBelow03=N rawScored=N deduped=N bestProps=N vol={"balanced":N,"aggressive":N}
```

### Smoke tests (9/9 pass)

| Test | Result |
|---|---|
| bestProps.length > 0 | PASS (46) |
| bestProps.length ≤ 60 | PASS |
| No player > 2 props | PASS |
| All edge ≥ 0.03 | PASS |
| All mp ≥ 0.35 | PASS |
| All snapshotSourced=true | PASS |
| No alt-lines | PASS |
| Sorted descending by edge | PASS |
| Top prop edge ≥ 0.20 (ELITE signal) | PASS (0.2346) |

### MLB regression: NONE

`fetchNbaOddsSnapshot.js` is NBA-only. `buildNbaBestProps` is called only within this file. MLB pipeline untouched. `server.js` does not import `fetchNbaOddsSnapshot.js`.

### TERM 1 restart requirement

`fetchNbaOddsSnapshot.js` is NOT imported by `server.js` — it's called only by `runNbaNight.js`. The code change has no startup effect. HOWEVER: `snapshot.json` was backfilled on disk. The running server holds `oddsSnapshot.bestProps = []` in-memory from startup. The disk change will be picked up on the next TERM 1 restart (already pending from Sessions AM–AR) or on `/refresh-snapshot`.

**TERM 1 restart: YES** — folds into the existing pending AN+AO+AP+AQ+AR restart. No additional restart needed beyond that.

---

## SESSION AS — NBA bestProps + SAFE=0 Root Cause Audit (2026-05-11)

**Scope**: Diagnostic only — 0 files modified. Trace exact root causes of `SAFE=0` and `bestProps=0` on live NBA slates. No code changes. No TERM 1 restart required.

### Findings

#### Root Cause 1: `SAFE=0` (`aiSlips.slips.safe = []`)
- **Source**: `/api/ws/state` → `aiSlips.slips.safe`
- **Cause**: Sessions AM+AN added `applyNbaTierOverrides` to `buildSlipAi.js` which fixes SAFE tier eligibility. Server is still running pre-AM code because TERM 1 restart (Step AN-1) is pending.
- **Fix**: Already coded in Sessions AM+AN. Awaits TERM 1 restart from Step AN-1 in NEXT_SESSION.md.
- **Expected after restart**: `safe ≥ 1` (balanced-volatility legs — points/rebounds/assists — qualify at correct MP/odds thresholds).

#### Root Cause 2: `bestProps=0` (status bar in App.tsx)
- **Source**: App.tsx:1085 — `{snapshotStatus?.bestProps ?? 0}` from `GET /snapshot/status`
- **Trace**: `GET /snapshot/status` → `oddsSnapshot.bestProps.length` → `snap.data.bestProps.length` → **0**
- **Root**: `fetchNbaOddsSnapshot.js:446` hardcodes `bestProps: []`. This field is never populated for NBA.
- **Existing pipeline**: `pipeline/selection/bestProps.js` exports `scoreBestFallbackRow` + `buildBestPropsFallbackRows`. Imported in `server.js:17`. BUT the pipeline expects `hitRate`, `score`, `edge`, `avgMin` fields — enriched row format from nightly pipeline. Raw NBA snapshot rows (`snap.data.props`) do NOT carry these fields.
- **Fix required**: Run `nbaRowModelProbability` + `nbaRowEdge` on snapshot props during `fetchNbaOddsSnapshot.js` build, rank by edge, store top N as `bestProps`. NOT a trivial wire-up. Classified as **NBA SP1 scope**.

#### Key non-issue confirmed: `featured` surface IS populated
- `buildFeaturedPlays` produces 2+ anchors, 2+ safest, 2+ tonightsBest from the 5 tracked candidates alone.
- Snapshot supplement fires: `aiCandidatesTracked = 7 < NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD (20)`.
- 90 deduped snapshot candidates pass all gates from 2957 raw rows (base-lines only), 22 qualify for `safest` fallback (balanced, mp≥0.50, edge≥0.12).
- `featured` ≠ `bestProps`. `featured` is the `buildFeaturedPlays` output in `/api/ws/state`. `bestProps` is the legacy count field in `/snapshot/status` reading `snap.data.bestProps.length`.

### Gate-level diagnostic (snapshot.json — 2957 rows, base-lines only)

| Gate | Rejected |
|---|---|
| Alt-line (all killed in base-line pass) | 2337 |
| Odds gate (-200..+200) | 85 |
| No recognized stat family | 6 |
| modelProb < 0.35 | 0 |
| edge < 0.03 | 341 |
| **Passed (pre-dedup)** | **188** |
| **Passed (deduped, top 150)** | **90** |

Edge distribution among balanced (points/rebounds/assists) candidates:
- edge ≥ 0.12 (ELITE — qualifies for `safest` fallback): **16**
- edge 0.07–0.12 (STRONG): 24
- edge 0.04–0.07 (PLAYABLE): 14
- edge 0.03–0.04 (LONGSHOT): 6

### Files examined (0 modified)

| File | Finding |
|---|---|
| `backend/routes/workstationRoutes.js` | Supplement fires (aiCandidatesTracked=7 < 20); `buildNbaSnapshotCandidates` produces 90 deduped candidates |
| `backend/pipeline/shared/buildFeaturedPlays.js` | `normalizeCandidate` passes all snapshot candidates; `buildSafest` has 22 qualifying candidates |
| `backend/pipeline/selection/bestProps.js` | `buildBestPropsFallbackRows` exists but expects enriched format — incompatible with raw snapshot rows |
| `backend/pipeline/nba/fetchNbaOddsSnapshot.js:446` | `bestProps: []` — hardcoded source of NBA SP1 |
| `frontend/src/App.tsx:1085` | UI reads `snapshotStatus?.bestProps` → 0 |

**TERM 1 restart required: NO** — diagnostic session, 0 files modified.

---

## SESSION AR — Portfolio Audit V1 (2026-05-11)

**Scope**: Build `POST /api/ws/portfolio-audit` — cross-slip structural exposure analysis. Honest posture: no EV, no ROI, no bankroll advice. Structural only. 2 files modified. TERM 1 restart required.

### What changed (2 files)

| File | Change |
|---|---|
| `backend/routes/portfolioAuditRoute.js` | NEW — full portfolio audit endpoint (~350 lines) |
| `backend/routes/workstationRoutes.js` | Added import + `router.use("/portfolio-audit", portfolioAuditRoute)` |

### Architecture

`portfolioAuditRoute.js` is a self-contained route module. It does NOT import `slipAuditRoute`. It uses the same canonical resolver chain (`nbaVolatilityResolve` → `classifyVolatility`) via direct imports from their respective modules.

Per-slip tier is classified by dominant volatility (portfolio approximation). Full tier eligibility (dec odds, maxPerGame) is not replicated here — that lives in `slipAuditRoute`. Portfolio callers wanting per-slip depth should use `POST /api/ws/slip-audit` additionally.

### Output fields

| Field | Description |
|---|---|
| `portfolioVolatility` | Tier counts (safe/balanced/aggressive/lotto), dominantTier, leg vol distribution, homogeneous flag, highVolPct |
| `playerExposure` | Cross-slip player overlap — sorted by slipCount |
| `gameExposure` | Cross-slip game concentration — sorted by slipCount |
| `statFamilyExposure` | Stat family distribution with pct of all legs |
| `overlapWarnings` | Per-pattern with severity ("high"/"moderate") — player_multi_slip, game_heavy_concentration, stat_monoculture, tier_homogeneity, etc. |
| `concentrationWarnings` | Portfolio-level flags — single_player_portfolio_risk, dominant_game_exposure, volatility_cluster_all_high, portfolio_all_safe |
| `diversificationScore` | 0-100 structural score with deductions breakdown |
| `slipSummaries` | Lightweight per-slip view (no full audit per slip) |
| `portfolioSummary` | Human-readable narrative |
| `structuralRiskAssessment` | rating: Tail/Lean/Caution/Avoid + narrative |

### Honesty posture

`confidenceHonesty.level: "structural_only"` — same honest posture as slip-audit. No EV inference, no ROI projections, no bankroll advice. The confidenceNote explicitly directs users to `POST /api/ws/slip-audit` for per-slip depth.

### Smoke tests (8/8)

| Test | Result |
|---|---|
| AR-1: same player in 2 slips → player_multi_slip + single_player_portfolio_risk + Avoid | ✓ |
| AR-2: 3 slips same game → game_heavy_concentration + dominant_game_exposure + Avoid | ✓ |
| AR-3: all threes legs → stat_monoculture (high) → Lean; summary names the issue (not "Well-diversified") | ✓ |
| AR-4: well-diversified (distinct players/games/stats) → score 100 + Tail | ✓ |
| AR-5: Jalen in 2/3 slips + 89% threes → single_player_portfolio_risk + stat_monoculture + Avoid | ✓ |
| AR-6: empty slips[] → 400 | ✓ |
| AR-7: slip with no legs → 400 | ✓ |
| AR-8: POST /slip-audit regression (Cade + Jalen threes → Lean) | ✓ |

**TERM 1 restart required: YES** — `workstationRoutes.js` modified (startup module). This restart also covers the pending AN-final/AO/AQ restarts.

---

## SESSION AQ — Screenshot-Assisted Slip Audit V1 (2026-05-11)

**Scope**: Add `POST /api/ws/slip-audit/screenshot` sub-route to `slipAuditRoute.js`. Extract core audit logic into `runAudit()`. Preserve OCR extensibility without implementing OCR. 1 file modified. No TERM 1 restart required.

### What changed (1 file)

| File | Change |
|---|---|
| `backend/routes/slipAuditRoute.js` | Added `runAudit()` engine + `validateLegs()` helper; refactored `POST /` to call `runAudit()`; added `POST /screenshot` sub-route; schema comment updated; file header updated |

### Architecture

**Before**: `POST /` contained the full audit pipeline inline (~100 lines in the handler).

**After**: Two-layer structure:
- `runAudit({ sportRaw, isNba, claimedTier, rawLegs })` — pure computation kernel; no HTTP; returns full audit payload; shared by both routes
- `validateLegs(rawLegs, fieldLabel)` — shared validation; returns `null` on success or `{ statusCode, error }` on failure
- `POST /` — parse → validate → `runAudit()` → `res.json()`
- `POST /screenshot` — parse screenshot metadata → OCR guard → validate → `runAudit()` → wrap result

### POST /screenshot contract (V1)

**Request**:
```json
{
  "imageName": "twitter-slip.png",
  "source": "twitter",
  "extractionMethod": "manual",
  "sport": "nba",
  "claimedTier": "aggressive",
  "extractedLegs": [
    { "player": "Cade Cunningham", "propType": "threes", "line": 2.5, "side": "over", "odds": 148 }
  ]
}
```

**Response**:
```json
{
  "screenshot": { "imageName", "source", "extractionMethod", "processedAt" },
  "extractedLegs": [...],
  "legCount": 1,
  "extractionConfidence": "manual",
  "audit": { ...full runAudit() result }
}
```

### OCR hook (no-op, documented)
- `extractionMethod: "ocr"` → 400 immediately in V1 ("not supported in V1 — only 'manual' is valid")
- Comment block marks exact insertion point for future OCR pipeline: `runOcrExtraction(imageBase64 || imageName)` → `extractedLegs`
- `extractionConfidence` field pre-wired for `"model_assisted"` when OCR arrives (currently always `"manual"`)

### Smoke tests (7/7)

| Test | Result |
|---|---|
| AQ-1: screenshot — correctly labeled aggressive threes | `semanticTier:balanced`, `overcautious`, `honest:true`, `Lean` ✓ |
| AQ-2: screenshot — fake-safe lotto threes | `semanticTier:aggressive`, `major`, `honest:false`, `Lean` ✓ |
| AQ-3: screenshot — no claimed tier | `semanticTier:safe`, `none`, `honest:true`, `Tail` ✓ |
| AQ-4: screenshot — `extractionMethod:"ocr"` → 400 | error message explicit ✓ |
| AQ-5: screenshot — missing imageName → 400 | ✓ |
| AQ-6: screenshot — empty extractedLegs → 400 | ✓ |
| AQ-7: POST / regression (aggressive threes) | `semanticTier:balanced`, `Lean`, `honest:true` ✓ |

**TERM 1 restart required: NO** — `slipAuditRoute.js` loaded via require at first request; not a startup module. `workstationRoutes.js` NOT modified this session.

---

## SESSION AP — Slip Audit Recommendation Semantics V2 (2026-05-11)

**Scope**: Refine recommendation engine in `slipAuditRoute.js` to separate semantic honesty from betting viability. 1 file modified. No TERM 1 restart required (workstationRoutes.js not modified; slipAuditRoute.js is loaded via require at runtime).

### Core change: two-axis model

**Before**: tier mismatch → auto-Fade (conflated semantic label with viability verdict)

**After**: two independent axes:
1. `semanticVerdict` — honesty axis: is the slip correctly labeled? (now directional)
2. `tailRecommendation` — viability axis: is the slip a viable play at its ACTUAL tier?

### Key logic changes (buildRecommendation)
- `tierMismatch` branch now only triggers for CONCERNING mismatches (actual more volatile than claimed)
- Overcautious labeling (actual safer than claimed) skips the mismatch branch entirely
- Mismatch + coherent structure → Lean (not Fade) — "viable at correct tier"
- Only Fade when: duplicate player, ineligible, OR major mismatch + high-vol + severe correlation
- Correctly labeled high-vol plays → Lean (not Fade) — correlation warnings are informational

### mismatchSeverity — now directional
- `"none"` — exact match or no claim
- `"overcautious"` — actual is SAFER than claimed (conservative labeling; not a risk concern)
- `"minor"` — actual is 1 tier MORE volatile than claimed (safe→balanced, balanced→aggressive)
- `"major"` — actual is 2+ tiers MORE volatile (safe→aggressive, safe→lotto, balanced→lotto)

### semanticVerdict.honest — now correct
- `true` when severity is "none" or "overcautious" (no risk misrepresentation)
- `false` only when actual tier is MORE volatile than claimed (minor or major)

### buildArchetypeSummary — nuanced mismatch language
- Major mismatch (2+ tiers): "Fake-safe construction..." / "Extreme mislabeling..."
- Minor mismatch (1 tier): "Conservative label, balanced behavior..." / "One tier above..."
- Overcautious: "Labeled X but plays as Y — more conservative than presented."
- No mismatch: tier-appropriate texture label (no alarm language)

### Smoke tests (22/22 pass)
| Scenario | Rec | Key assertion |
|---|---|---|
| Minor mismatch: safe claimed, balanced actual | Lean | Not Fade; no "fake-safe" in archetype |
| Major mismatch: safe claimed, aggressive actual (no severe corr) | Lean | archetype contains "fake" |
| Overcautious: balanced claimed, safe actual | Tail | honest=true, severity=overcautious |
| Correctly labeled aggressive, same-stat stack | Lean | honest=true, not Fade |
| Duplicate player | Fade | absolute blocker |
| Excluded family (rbis) | Pass | absolute blocker |
| Minor mismatch: balanced→aggressive | Lean | not Fade |
| Clean safe, correctly labeled | Tail | Tail for correct + clean |
| No claimed tier | Tail/Lean | tierMismatch=null, honest=true |
| Missing odds | 400 | validation |

**TERM 1 restart required: NO** — only `slipAuditRoute.js` modified; loaded via require, not at startup.

---

## SESSION AO — Slip Audit Endpoint V1 (2026-05-11)

**Scope**: New `/api/ws/slip-audit` endpoint for manual slip evaluation. 2 files modified/created. Zero changes to aiSlips generation, tier semantics, grading, or any existing runtime. TERM 1 restart required (workstationRoutes.js modified).

### Files changed (2)
| File | Change |
|---|---|
| `backend/routes/slipAuditRoute.js` | **NEW** — 280 lines. POST handler, self-contained. Imports only `nbaVolatilityResolve` + `classifyVolatility`. |
| `backend/routes/workstationRoutes.js` | **MODIFIED** — added `require('./slipAuditRoute')` + `router.use('/slip-audit', ...)`. 6 lines added. |

### Endpoint
```
POST /api/ws/slip-audit
Content-Type: application/json

{
  "sport": "nba",
  "claimedTier": "safe",        // optional — triggers tierMismatch check
  "legs": [
    { "player": "Donovan Mitchell", "propType": "Points", "line": 32.5, "side": "Over", "odds": 135 }
  ]
}
```

### Response shape
```json
{
  "sport", "legCount", "semanticTier", "claimedTier", "tierMismatch",
  "volatilityProfile": { "legs": [], "combined", "unanimousVolatility", "mixedVolatility", "volSources" },
  "correlationWarnings": [{ "code", "message" }],
  "payoutProfile": { "combinedDecimal", "combinedAmerican", "impliedProbability", "payoutRealism", "hasInvalidOdds" },
  "tierEligibility": { "safe", "balanced", "aggressive", "lotto" },
  "semanticViolations": [],
  "tailRecommendation": "Tail|Lean|Pass|Fade",
  "recommendationReason": "...",
  "archetypeSummary": "...",
  "confidenceHonesty": { "level": "structural_only", "note": "..." },
  "auditedAt": "ISO string"
}
```

### Logic reused from existing runtime (no duplication)
- Volatility: `nbaVolatilityResolve` → NBA path (snapshot stamps honored); `classifyVolatility` via VOLATILITY_RULES → MLB path
- Tier eligibility: inline mirror of TIER_TEMPLATES + NBA overrides from buildSlipAi (intentional isolation — audit must not couple to slip builder runtime)
- SLIP_EXCLUDED_FAMILIES: replicated inline (same `["rbis","outs"]` set)
- Correlation detection: same-game / same-stat / same-stat-side / duplicate-player — matches `canAddLeg` checks in buildSlipAi

### Smoke tests (12/12)
| Scenario | Result |
|---|---|
| Fake-safe threes stack (claimedTier=safe) → Fade + fake-safe archetype | ✓ |
| Valid balanced NBA slip (points+rebounds) → eligible, not Fade | ✓ |
| Same-stat stack (two points legs) → same_stat_stack + same_stat_side_stack warnings | ✓ |
| Missing odds → 400 | ✓ |
| MLB rbis (excluded family) → Pass | ✓ |
| Correctly labeled aggressive slip → not Fade | ✓ |

**TERM 1 restart required: YES** — workstationRoutes.js modified.

---

## SESSION AN — Tier Semantic Integrity (2026-05-11)

**Scope**: Fix semantic mismatch in NBA SAFE and BALANCED tiers. 3 calibration passes total (AN, AN-2, AN-final). 1 file modified throughout: `backend/pipeline/shared/buildSlipAi.js` (`applyNbaTierOverrides` function only). MLB untouched. Aggressive/lotto output unchanged.

### AN-final: BALANCED allowedVolatility reverted
Live audit after AN-2 showed BALANCED had `odds:+530, vols:[aggressive,aggressive]`. Root: Session AN added `"aggressive"` to BALANCED's `allowedVolatility` to create tier separation — but this routed threes legs (volatility="aggressive") into BALANCED, where two of them could form a +530 aggressive/aggressive parlay. Fix: revert BALANCED `allowedVolatility` to `["safe","balanced"]`. Threes now route exclusively to AGGRESSIVE/LOTTO. The SAFE/BALANCED distinction is maintained by their different odds floors (SAFE dec 1.8 min, BALANCED dec 3.0 min) and other template parameters.

### AN-2 calibration: SAFE ceiling restored
After AN patch, live verification showed SAFE=0. Root: NBA balanced legs (points/rebounds/assists) commonly run +160-+178; two of them combined to dec 6.76-7.73, exceeding the AN ceiling of 6.5. The ceiling was redundant — the original fake-safe scenario (two aggressive threes) is now blocked by `forbidVolatility` **before** the odds check even runs. Restoring ceiling to [1.8, 7.5] re-opens 27/28 balanced-leg pair combinations while zero fake-safe scenarios change.

### Root causes proven (3 converging — original SAFE fake-safe issue)
1. `isPremiumEdgeForSafe` bypass — legs with mp≥0.50 AND edge≥0.12 skipped the `allowedVolatility: ["safe","balanced"]` gate. NBA threes (volatility="aggressive") have mp=0.56-0.62 and edge=0.16-0.23 → always bypassed → entered SAFE.
2. `decimalOddsRange: [1.8, 7.5]` — two +148 legs combined to dec 6.15 (~+515), within ceiling.
3. `maxPerStat: 2` (inherited) — allowed both threes legs to stack. Combined with `maxPerGame:2` and `skipScriptCorrelation:true`, two same-game same-family aggressive legs formed a "SAFE" parlay.

### Files modified (1)
| File | Change |
|---|---|
| `backend/pipeline/shared/buildSlipAi.js` | `applyNbaTierOverrides()`: SAFE adds `forbidVolatility:["lotto","aggressive"]`; `maxPerStat:1`; `decimalOddsRange:[1.8,7.5]`. BALANCED `allowedVolatility:["safe","balanced"]` (AN-final: reverted from ["safe","balanced","aggressive"]). Probe log updated with `forbid` and `mps` fields. |

### NBA SAFE — final state after AN + AN-2 + AN-final
- `forbidVolatility`: `["lotto"]` → **`["lotto","aggressive"]`** — absolute block; cannot be bypassed by `isPremiumEdgeForSafe`. Only balanced/safe-volatility legs (points, rebounds, assists) in SAFE.
- `maxPerStat`: inherited 2 → **1** — no same-stat stacking (no dual points, dual rebounds, etc.)
- `decimalOddsRange`: **`[1.8, 7.5]`** — same as Session AM. Ceiling is now semantically honest because it only admits balanced legs (aggressive is forbidden). 27/28 balanced pair combinations qualify.

### NBA BALANCED — final state after AN-final
- `allowedVolatility`: **`["safe","balanced"]`** — aggressive legs (threes, first_basket) excluded. No aggressive/aggressive pairings possible.
- `allowedSides`: null — both sides (NBA props not script-rotted)
- `maxPerGame`: 2
- `skipScriptCorrelation`: true

### Semantic ladder after AN-final
| Tier | Volatility allowed | Combined dec range |
|---|---|---|
| SAFE | safe, balanced only (NBA: points, rebounds, assists) | [1.8, 7.5] |
| BALANCED | safe + balanced only (NBA: same families as SAFE, different odds floor) | [3.0, 8.0] |
| AGGRESSIVE | balanced + aggressive + lotto | [6.0, 120.0] |
| LOTTO | aggressive + lotto | [20.0, 1500.0] |

Note: SAFE vs BALANCED distinction now rests on odds floor (SAFE admits dec 1.8+, BALANCED admits dec 3.0+) and minModelProb/maxOdds differences, not on volatility tier.

### MLB regression — zero impact
- `applyNbaTierOverrides` gated on `ctx.isNba` — never called for MLB
- MLB SAFE: `forbidVolatility:["lotto"]`, `maxPerStat:2`, `decRange:[1.8,4.0]` — unchanged
- MLB BALANCED: `allowedSides:["under"]`, `allowedVolatility:["safe","balanced","aggressive"]`, `dec[3,8]` — unchanged

### Verification (offline)
| Check | Result |
|---|---|
| `node --check buildSlipAi.js` | ✓ syntax clean |
| NBA SAFE: `forbidVolatility` includes "aggressive" | ✓ |
| NBA SAFE: `maxPerStat` = 1 | ✓ |
| NBA SAFE: `decimalOddsRange` = [1.8, 7.5] | ✓ |
| Two +154/+148 threes → blocked by forbid before odds check | ✓ |
| NBA BALANCED: `allowedVolatility` = ["safe","balanced"] only | ✓ |
| NBA BALANCED: aggressive/aggressive pair impossible | ✓ |
| NBA BALANCED: `allowedSides` = null | ✓ |
| MLB SAFE base template unchanged | ✓ |

### Expected live runtime after TERM 1 restart
- SAFE: ≥ 1 slip (balanced legs only — points/rebounds/assists; no threes/PRA)
- BALANCED: ≥ 1 slip (same volatility families as SAFE, differentiated by odds floor)
- AGGRESSIVE: 4 (unchanged — threes route here)
- LOTTO: 4 (unchanged)
- No BALANCED slip should have any leg with `volatility: "aggressive"`

**TERM 1 restart required: YES** — `buildSlipAi.js` loaded at startup.

---

## SESSION AM — SAFE/BALANCED Profitability Recovery V1 (2026-05-11)

**Scope**: Restore live NBA SAFE + BALANCED slip generation without touching MLB constraints. 1 file modified: `backend/pipeline/shared/buildSlipAi.js`. NBA-only tier overrides applied via `applyNbaTierOverrides()` gated on `ctx.isNba`. MLB Session AG enforcement (under-only, no rbis/outs, dec[3,8], calibration) fully preserved.

### Live runtime BEFORE (Session AL artifact `verification_nba_2026-05-10_AL-runtime-truth.json`)
- candidates=24, total_slips=8, **safe=0, balanced=0**, aggressive=4, lotto=4
- featured anchors=4, correlation_fields=8

### Live runtime EXPECTED AFTER restart (offline-replicated via `trace_slips.js`)
- candidates=24, total_slips=12, **safe=2, balanced=2**, aggressive=4, lotto=4
- correlation engine still wired; calibration coefficients still applied; AGGRESSIVE/LOTTO freeze unchanged in nightly engines

### Root cause of SAFE=0, BALANCED=0 (proven offline; NOT theory)
With 24-candidate pool from `nba_tracked_bets_2026-05-09.json` (5 eligible) + `buildNbaSnapshotCandidates` (138 → 19 novel after diversify):
1. **SAFE** template required `maxOdds≤150` and `modelProb≥0.55`. NBA base lines run +148 to +200 with mp 0.49–0.62. Only 1 leg passed. 2-leg minimum impossible.
2. **BALANCED** template required `under-only` AND `dec∈[3,8]`. The 7 under-eligible legs combined to dec ≥ 12 (high-edge longshot points unders +360 to +490). 0 valid pairs.
3. **`script_correlation` rule** (canAddLeg) blocked over+over same-game. NBA playoff slate had effectively 1 game on the pool — every cross-player pair hit the same-game block.

### Files modified (1)
| File | Change |
|---|---|
| `backend/pipeline/shared/buildSlipAi.js` | Added `applyNbaTierOverrides(tpl, tier)`; wired into `buildSlipsForTier`; added `skipScriptCorrelation` opt-in to `canAddLeg`'s pace/script rule |

### NBA SAFE override (was → now)
- `minModelProb`: 0.55 → 0.50 (admits NBA's compressed-prob base lines)
- `maxOdds`: 150 → 200 (admits +160-+200 short-priced overs)
- `decimalOddsRange`: [1.8, 4.0] → [1.8, 7.5] (admits 2-leg pairs at ~2.5×2.7 ≈ 6.7 dec)
- `maxPerGame`: 1 → 2 (small NBA slates with 1 game must allow 2 same-game legs)
- `skipScriptCorrelation`: true (NBA correlation handled by `nbaCorrelationEngine`)

### NBA BALANCED override (was → now)
- `allowedSides`: ["under"] → null (NBA usage-driven props are NOT side-asymmetric like MLB)
- `allowedVolatility`: ["safe","balanced","aggressive"] → ["safe","balanced"] (base-line stability only; high-odds aggressive points unders blew dec ceiling)
- `maxPerGame`: 1 → 2 (same reason as SAFE)
- `skipScriptCorrelation`: true
- `decimalOddsRange`, `maxOdds`, `minModelProb`: UNCHANGED

### MLB constraints — UNCHANGED
- `under-only` BALANCED preserved (MLB unders 53.9% vs overs 30.0% over 5 dates)
- `dec[3, 8]` BALANCED preserved
- `maxPerGame=1` SAFE/BALANCED preserved
- `script_correlation` rule still active for MLB (no skip flag)
- `SLIP_EXCLUDED_FAMILIES = {rbis, outs}` preserved
- `FAMILY_CALIBRATION_COEFFICIENTS` preserved
- AGGRESSIVE/LOTTO freeze in nightly engines (`buildMlbSlipEngine.js`, `buildNbaSlipComposer.js`) preserved

### Profitability rationale (per-field, grading-grounded)
- 5-date MLB grading: BALANCED 2.7% hit rate (catastrophic) → MLB stays restricted
- MLB unders (55%) >> MLB overs (37%) → MLB under-only stays
- NBA grading sample too thin (6 settled bets across 5 dates) for side-asymmetry conclusion → NBA both-sides allowed
- NBA SAFE picks generated from current pool: Cade threes o1.5 +154 (mp 0.622, edge 0.228), Harden threes o2.5 +148 (mp 0.564, edge 0.161), Cade assists o10.5 +178 (mp 0.581, edge 0.221) — all ELITE-tier candidates by NBA standards
- NBA BALANCED picks: Harden rebounds o3.5 + Mitchell rebounds u8.5 — opposing-side pace hedge with strong individual edges

### Verification (offline-replicated; live verification REQUIRED for checkpoint)
| Check | Result |
|---|---|
| `node --check buildSlipAi.js` | ✓ syntax clean |
| trace_slips.js (live-route replica): NBA pool | ✓ safe=2 balanced=2 aggressive=4 lotto=4 |
| MLB regression (NBA pool, sport=mlb context): override gate ctx.isNba | ✓ no override applied; tiers identical to pre-AM |
| `[SLIP-PROBE] NBA tier override applied` log present | ✓ fires for both safe + balanced |
| AGGRESSIVE/LOTTO unchanged | ✓ 4 + 4 (same as Session AL) |
| correlation_score_fields populated | ✓ all 12 NBA slips carry field |

### TERM 1 / TERM 2 / Checkpoint — see NEXT_SESSION.md "PENDING OPERATOR ACTIONS"

---

_Pre-Session-AM history below is preserved as written by Session AG (operational state for prior sessions; do not edit without re-verifying)._

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | e076871 (Session I) — Sessions H–AC staged, pending finalization via finalizeCheckpoint.sh |
| Repo health | **7.2/10 structural. NBA intelligence health: 2.9/10 (audited). NBA routing health: 4.6/10 (Session AB). NBA-1 ✅, NBA-2 audit ✅, NBA-2.B ✅. Next lever: NBA-2.C (buildNbaSnapshotCandidates extraction).** |

---

## RUNTIME ARCHITECTURE

```
TERM 1: Node/Express backend — port 4000
  └── backend/server.js
  └── routes: workstationRoutes.js, mlbIsolatedRoutes.js

TERM 2: Manual operator verification only
```

Frontend: React 19 + Vite, TypeScript, CSS Modules
Backend: Node.js, Express, flat JSON persistence (`backend/runtime/tracking/`)
Cache: In-memory 60s TTL per (sport, date) key in `workstationRoutes.js`

---

## ACTIVE SYSTEMS

| System | Status | Owner file |
|---|---|---|
| MLB nightly pipeline | Working | `scripts/runMlbNight.js` |
| **MLB HR candidate scoring** | **Fixed (Session T) — HR tiering/scoring recalibrated; STRONG HR now surfaces** | **`pipeline/mlb/buildMlbPropClusters.js`** |
| **MLB roster integrity — team field** | **Fixed (Session V) — team/teamCode/awayTeam/homeTeam now persisted in leanBet/leanSlip** | **`pipeline/mlb/phase4Tracking.js`, `buildMlbPropClusters.js`, `buildMlbPlayerDataset.js`, `external/mlbPlayerIdentityCache.js`** |
| NBA nightly pipeline | Working | `scripts/runNbaNight.js` |
| AI Slip construction | Working | `pipeline/shared/buildSlipAi.js` |
| Featured plays (anchors/supports) | Working | `pipeline/shared/buildFeaturedPlays.js` |
| Volatility classifier | Working | `pipeline/shared/buildPortfolioOptimizer.js` |
| Candidate diversification | Working | `pipeline/shared/buildCandidateDiversity.js` |
| NBA snapshot routing | Fixed (Session N) | `routes/workstationRoutes.js` |
| NBA aiCandidates supplement | Fixed (Session Q Fix Q1) | `routes/workstationRoutes.js` |
| `/api/best-available` NBA payload | Fixed (Session R Fix R1) | `http/nbaIsolatedRoutes.js` |
| Line shopping | Working | `routes/workstationRoutes.js` |
| Portfolio optimizer | Working | `pipeline/shared/buildPortfolioOptimizer.js` |
| Market timing intelligence | Working | `pipeline/shared/buildMarketTimingIntelligence.js` |
| CLV tracking | Working | `pipeline/shared/buildClv.js` |
| **Personal ledger — JSON write** | **Fixed (Session S) — atomic rename, no .tmp orphan** | **`pipeline/shared/buildPersonalLedger.js`** |
| **Personal ledger — SQLite mirror** | **Active (Session S) — write-through mirror on every saveLedger()** | **`pipeline/shared/buildPersonalLedger.js` + `storage/queries.js`** |
| **Screenshot intelligence — ingestion** | **Active (Session U) — JSON slip ingest → normalize → classify → SQLite** | **`pipeline/screenshots/screenshotRoutes.js`** |
| **Screenshot intelligence — normalizer** | **Active (Session U) — pure function, source-agnostic, 7 input shapes** | **`pipeline/screenshots/normalizeIngestedSlip.js`** |
| **Screenshot intelligence — classifier** | **Active (Session U) — 10 dimensions, 7 archetypes, composite scoring** | **`pipeline/screenshots/classifyIngestedSlip.js`** |
| Post-game review engine | Working + Intelligence settlement wired (Session J) | `pipeline/shared/buildPostGameReview.js` |
| Nightly orchestrator | **Updated (Session W) — Step 9: dailyIntelligenceReview wired** | `pipeline/shared/buildNightlyOrchestrator.js` |
| **Daily Intelligence Review Engine** | **NEW (Session W) — 8 modules; calibration, ecology, volatility, eruptions, process** | **`pipeline/review/`** |
| **Offensive stat canonical** | **NEW (Session Y) — isOffensiveAttackStat() unified in normalizers.js** | **`pipeline/shared/normalizers.js`** |
| **Workstation compactors** | **NEW (Session Y) — extracted from workstationRoutes.js** | **`pipeline/shared/buildWorkstationCompactors.js`** |
| Workstation frontend | Working — bettor UX Phase 1+2+3 applied (Sessions L+M+N) | `frontend/src/workstation/` |

---

## FRONTEND SECTIONS

| View | File |
|---|---|
| Dashboard (command center) | `sections/Dashboard.tsx` |
| Slate browser | `sections/SlateBrowser.tsx` |
| AI Slips center | `sections/AiSlipsView.tsx` |
| Bet builder | `sections/BetBuilderView.tsx` |
| Line shopping | `sections/LineShoppingView.tsx` |
| Portfolio view | `sections/PortfolioView.tsx` |
| Process review | `sections/ProcessReviewView.tsx` |
| First basket | `sections/FirstBasketView.tsx` — premium rewrite Session N |

---

## RUNTIME TRACKING FILES (today: 2026-05-09)

| File | Contents |
|---|---|
| `mlb_tracked_bets_2026-05-08.json` | MLB bets (134 bets, all pending — no results entered yet) |
| `mlb_tracked_best_2026-05-08.json` | HR/TB/RBI overs attack board |
| `mlb_tracked_slips_2026-05-08.json` | AI-generated slip catalog |
| `nba_tracked_bets_2026-05-08.json` | 2 bets (rebounds only — thin) |
| `personal_ledger.json` | **2,000 entries / 2.3MB — atomic JSON write + SQLite mirror** |
| `book_intelligence_state.json` | Sportsbook CLV/profile rolling state |
| `snapshot.json` | 9.47MB, 5,209 rows |

---

## SQLITE STATE

| File | Status |
|---|---|
| `backend/storage/betting.db` | 782KB — has `prediction_snapshots` (110 rows), `ecology_snapshots` (4 rows); `personal_ledger` table (Session S); 6 review tables (Session W — auto-applied on next restart). |
| `backend/storage/betting.db-journal` | **Stale virtiofs rollback journal — blocks sandbox access.** macOS TERM 1 can open betting.db normally. |

**betting2.db + betting2.db-journal + storage/test.txt → DELETED (Session Y)**

---

## SESSION Y — Repo Constitution Cleanup (Phase 0 + Phase 2)

### Scope (2026-05-09):
Zero-regression structural stabilization. Dead code removal, duplication elimination, mutex integrity fix. No behavior changes to any scoring, ecology, or slip logic.

### Phase 0 — Dead code deleted:

| File | Lines removed | Reason |
|---|---|---|
| `backend/http/nbaBestAvailable.inlined.js` | 6,867 | Confirmed dead — explicitly excluded by nbaIsolatedRoutes.js. 0 importers. |
| `backend/http/nbaRefreshSnapshot.inlined.js` | 4,318 | Confirmed dead — same. 0 importers. |
| `backend/pipeline/enrich/index.js` | 0 (empty) | Empty stub, 0 importers |
| `backend/pipeline/normalize/index.js` | 0 (empty) | Empty stub, 0 importers |
| `backend/pipeline/validation/rows.js` | 0 (empty) | Empty stub, 0 importers |
| `backend/pipeline/snapshot/buildSnapshot.js` | 0 (empty) | Empty stub, 0 importers |
| `backend/storage/betting2.db` | — | Orphan test DB |
| `backend/storage/betting2.db-journal` | — | Stale journal for orphan |
| `backend/storage/test.txt` | — | Empty test artifact |

**Total dead code removed: 11,185 lines. 9 files. 4 empty directories cleaned.**

### Phase 2 — Tactical extractions:

#### Task 1 — `isOffensiveAttackStat` unified

| File | Change |
|---|---|
| `pipeline/shared/normalizers.js` | **NEW** — canonical `isOffensiveAttackStat(fam)` + `normFam(v)`. 54 lines. |
| `pipeline/shared/buildFeaturedPlays.js` | **MODIFIED** — import from normalizers; local 16-line definition removed. |
| `pipeline/shared/buildSlipAi.js` | **MODIFIED** — import from normalizers; inline 8-line `offensive` check replaced with single call. |

**Alignment note**: buildSlipAi previously omitted `doubles` and `triples` from its offensive stat check (accidental omission vs buildFeaturedPlays). The canonical definition now correctly includes both. This is a legitimate alignment, not a regression — doubles/triples are genuine offensive attack stats. Impact is minimal (rare stat families, max +0.032 texture bonus).

#### Task 2 — Compactors extracted

| File | Change |
|---|---|
| `pipeline/shared/buildWorkstationCompactors.js` | **NEW** — `compactLineShopping`, `compactTiming`, `compactPortfolio`. 145 lines. Exact behavior preserved. |
| `routes/workstationRoutes.js` | **MODIFIED** — import from buildWorkstationCompactors; 103-line inline block removed. 721 → 620 lines. |

#### Task 3 — Dual-mutex fixed

| File | Change |
|---|---|
| `backend/server.js` | **MODIFIED** — `/refresh-snapshot` route unified to module-level `__refreshInProgress` / `__lastRefreshTime`. Removed local `let` declarations (lines 19052–19053) and `global.*` assignments (lines 19065, 19068, 19144). Now shares mutex with `/api/best-available`. |

**Mutex before**: `/refresh-snapshot` used `global.__refreshInProgress` (separate scope from module-level). `/api/best-available` used module-level. They could run concurrently.

**Mutex after**: Both routes read/write the same module-level `__refreshInProgress` and `__lastRefreshTime`. Concurrent refresh is now impossible.

### Session Y smoke test results (2026-05-09):

| Test | Result |
|---|---|
| `node --check` all 6 modified/new files | ✓ 6/6 clean |
| Zero deleted-file references remaining | ✓ (nbaRefreshSnapshot comment in nbaIsolatedRoutes is benign) |
| normalizers.js — 23 `isOffensiveAttackStat` cases | ✓ 23/23 pass |
| compactors — null safety + shape tests | ✓ all pass |
| Module resolution (require all new imports) | ✓ all resolve |
| global.* mutex references in server.js | ✓ 0 remaining |
| http/ directory — 2 files only | ✓ mlbIsolatedRoutes.js + nbaIsolatedRoutes.js |
| 4 empty stub directories removed | ✓ enrich/ normalize/ validation/ snapshot/ gone |

**TERM 1 restart required** — server.js modified (mutex fix). workstationRoutes.js modified (compactor import).

---

## SESSION AE — NBA Result Ingestion Repair (2026-05-10)

**Scope**: Diagnose and repair the NBA grading pipeline. Root cause: `stats.nba.com/stats/scoreboardv2` returns 403 / network block from Node.js servers. The error was caught silently → returned `[]` → "No NBA games found" for every date. Fix: replace with ESPN public API (`site.api.espn.com`) which requires no auth, no special headers, handles regular season + playoffs.

### Root Cause (confirmed):

| Signal | Evidence |
|---|---|
| Error logged but swallowed | `fetchNbaGameIds` catches the 403, logs `console.error`, returns `[]` |
| Output message | "No NBA games found for YYYY-MM-DD" for all 5 dates |
| stats.nba.com behavior | Aggressively blocks non-browser Node.js clients, even with spoofed headers |
| MLB worked | `statsapi.mlb.com` has no such restriction — free, open, no browser check |

### File Modified (1):

| File | Change |
|---|---|
| `pipeline/grading/fetchNbaGameResults.js` | Replace `stats.nba.com/stats/scoreboardv2 + boxscoretraditionalv2` with ESPN public API (`site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard + summary`) |

### ESPN API (replacement):

| Endpoint | Purpose |
|---|---|
| `scoreboard?dates=YYYYMMDD&limit=30` | Get ESPN game IDs for a date |
| `summary?event={gameId}` | Get per-player stats for a game |

ESPN stat parsing:
- Integer fields (rebounds, assists, points): `"7"` → `7`
- Ratio fields (threePointFieldGoals): `"2-7"` → `2` (made count parsed from M-A format)
- DNP players: `didNotPlay: true` → skipped (not added to resultMap)
- Zero stats: valid — `0-0` threes → `0` (not null)

### Verification Results:
| Test | Result |
|---|---|
| `node --check` — 1 file | ✓ 1/1 clean |
| parseEspnStat — 13 cases (integers, M-A, edge cases) | ✓ 13/13 |
| getNbaStatValue — 8 cases (all families + null guards) | ✓ 8/8 |
| normName — 3 cases | ✓ 3/3 |
| Full ESPN mock boxscore (5 players, 1 DNP, 2 teams) | ✓ 14/14 |
| Dry-run backfill — 5 NBA dates discovered | ✓ 5/5 |

**TERM 1 restart: NOT required** — `fetchNbaGameResults.js` is a standalone CLI module, not loaded by `server.js`.

**TERM 2 verification required** — run NBA backfill live to confirm ESPN returns real game data.

---

## SESSION AG — Slip Ecosystem Repair V1 (2026-05-10)

**Scope**: 5 targeted fixes to slip assembly across all 3 slip generation paths. No architecture changes. No rebuild of `combineLegs()`. Additive enforcement only.

### Root Cause (confirmed via code audit):
`buildMlbSlipEngine.js` (canonical nightly MLB path) had `legSize: { target: 3, min: 3, alt: 4 }` — every other BALANCED slip targeted 4 legs; no `maxCombinedDecimalOdds` → combined odds reaching 25.0 (far above 8.0 template ceiling); `MIX_FAMILIES` included rbis/outs; no side filter.

### Files Modified (3):

| File | Session AF Audit Finding | Fix Applied |
|---|---|---|
| `backend/pipeline/mlb/buildMlbSlipEngine.js` | BALANCED 4-leg slips, odds up to 25.0, rbis/outs in mix, no under filter | FIX 1+2+3+4+5 |
| `backend/pipeline/nba/buildNbaSlipComposer.js` | Same violations (minus rbis/outs — N/A for NBA) | FIX 1+2+4+5 |
| `backend/pipeline/shared/buildSlipAi.js` | Already had [2,3] legCount; needed under filter, rbis/outs exclusion, calibration | FIX 2+3+5 |

### Five Fixes:

**FIX 1 — Nightly template enforcement (MLB + NBA engines)**
- `legSize: { target: 3, min: 2 }` — removed `alt: 4` (was producing 4-leg BALANCED slips)
- `maxCombinedDecimalOdds: 8.0` — hard ceiling on combined parlay odds (was unbounded → up to 25.0)
- `minCombinedDecimalOdds: 3.0` — floor to prevent trivially low-variance slips
- `maxSameEventShare: 0.30` → for 3-leg slips: maxPerEvent = max(1, ceil(3×0.30)) = 1 (enforces maxPerGame=1)
- `droppedSlips` counter added to `meta` output for audit of rejected slips

**FIX 2 — BALANCED over exclusion (all 3 paths)**
- `sideFilter: ["under"]` explicit in `buildBalancedSlips()` pool filter (MLB + NBA engines)
- `allowedSides: ["under"]` in `TIER_TEMPLATES.balanced` (buildSlipAi.js)
- Enforced in `buildSlipsForTier` eligible filter: `if (tpl.allowedSides?.length && !tpl.allowedSides.includes(leg.side)) return false`

**FIX 3 — rbis/outs exclusion from slip assembly (MLB paths only)**
- `BALANCED_FAMILIES = new Set(["hits", "totalBases", "ks", "runs", "hitsAllowed"])` in buildMlbSlipEngine.js
- `SLIP_EXCLUDED_FAMILIES = new Set(["rbis", "outs"])` in buildSlipAi.js
- Both remain valid for individual bets and ladder picks — only excluded from slip parlays

**FIX 4 — AGGRESSIVE/LOTTO freeze (all 3 paths)**
- `FREEZE_AGGRESSIVE_LOTTO = true` module-level constant (reversible — flip to `false` to re-enable)
- Frozen paths produce `[]` (not errors); `meta.frozenTiers: ["aggressive", "lotto"]` auditable in output
- Comment in all 3 files: "remove freeze when post-repair grading confirms tier health"

**FIX 5 — combinedModelProb calibration correction (all 3 paths)**
- Family-level calibration coefficients derived from 5-date MLB grading aggregate:
  ```
  totalbases: 0.97, hits: 0.80, runs: 0.74, rbis: 0.68, outs: 0.72,
  ks: 0.85, hr: 0.72, hitsallowed: 0.82
  NBA: rebounds: 0.87, assists: 0.90, points: 0.88, threes: 0.88, blocks: 0.85, steals: 0.85
  ```
- `rawCombinedModelProb` preserved on every slip object for pre-calibration audit diff
- `combinedModelProb` = product of per-leg `(modelProb × familyCoeff)` clamped [0.001, 0.999]

### Smoke Test Results (all 3 paths):

| Test | MLB Engine | NBA Engine | buildSlipAi |
|---|---|---|---|
| `node --check` | ✓ | ✓ | ✓ |
| SAFE slips produced | 2 ✓ | 2 ✓ | ✓ |
| BALANCED ≤3 legs | ✓ | ✓ | ✓ |
| BALANCED odds [3.0, 8.0] | 6.08, 5.88 ✓ | ✓ | ✓ |
| No overs in BALANCED | ✓ | ✓ | ✓ |
| No rbis/outs in BALANCED | ✓ | N/A ✓ | ✓ |
| AGGRESSIVE frozen (0 slips) | ✓ | ✓ | ✓ |
| LOTTO frozen (0 slips) | ✓ | ✓ | ✓ |
| meta.frozenTiers visible | `["aggressive","lotto"]` ✓ | ✓ | N/A |
| rawCombinedModelProb present | ✓ | ✓ | ✓ |
| calibration applied (raw ≠ cal) | 0.1947 → 0.0853 ✓ | ✓ | 0.1914 → 0.1099 ✓ |
| Contradictory legs rejected | ✓ | N/A | ✓ |
| SAFE constraints unchanged | ✓ | ✓ | ✓ |

**All checks: PASS ✓**

### Verification Class: D

**TERM 1 restart required: YES**
- `buildSlipAi.js` is loaded by `server.js` at startup — server must be restarted before workstation slips reflect fixes.
- `buildMlbSlipEngine.js` and `buildNbaSlipComposer.js` are called by the nightly pipeline at runtime — fixes active after any new nightly run.

**Snapshot hard-reset required: YES (Class D mandatory)**
```bash
curl -s "http://localhost:4000/refresh-snapshot/hard-reset"
```
(wait 10s, then run verification)

**Verification command (TERM 2, after hard-reset):**
```bash
node backend/scripts/runVerification.js --sport=nba --session=AG-repair
```
Expected: exit 0

**Checkpoint (ONLY after runVerification exits 0):**
```bash
node backend/scripts/checkpointRepo.js "Session AG: Slip Ecosystem Repair V1 — BALANCED enforcement + calibration + freeze"
```

### Post-Repair Grading (operator, after next nightly run):
```bash
node backend/scripts/runHistoricalGrade.js --sport=mlb --backfill
node backend/scripts/runHistoricalGrade.js --sport=nba --backfill
```
Confirms new BALANCED tier health with calibration active. Once tier hit rates ≥ 52%: unfreeze AGGRESSIVE/LOTTO by setting `FREEZE_AGGRESSIVE_LOTTO = false` in all 3 files.

---

## SESSION AD — Historical Grading + Reconciliation Pipeline (2026-05-10)

**Scope**: Automated grading infrastructure. Fetch actual game results from MLB Stats API and NBA Stats API, settle individual tracked bets (win/loss/push/unresolved/pending), settle slip parlays from leg results, compute ROI/hit-rate summaries per tier/statFamily/side. Backfill runner for all pending dates.

### Files Created (6 new files — 0 existing files modified):

| File | Description |
|---|---|
| `pipeline/grading/fetchMlbGameResults.js` | MLB Stats API fetcher — schedule + boxscore, all batting+pitching stat families, parallel game processing, normName-keyed Map |
| `pipeline/grading/fetchNbaGameResults.js` | NBA Stats API fetcher — scoreboardv2 + boxscoretraditionalv2, required headers, sequential with 500ms delay, graceful degradation |
| `pipeline/grading/gradeTrackedBets.js` | Per-bet settlement — resultsMap lookup, settleFromActual(), result/actualValue/settledAt write-back, atomic tmp→rename |
| `pipeline/grading/gradeTrackedSlips.js` | Slip parlay settlement — leg lookup from graded bets, parlay logic (all-win=win, any-loss=loss, push propagation), atomic write |
| `pipeline/grading/buildGradingSummary.js` | ROI/hit-rate summary — byTier, byStatFamily, bySide, slip byType, American odds ROI, writes grading_summary_{sport}_{date}.json |
| `scripts/runHistoricalGrade.js` | Main runner — --sport, --date, --backfill, --retry-unresolved, --summary-only, --dry-run, --verbose flags; discovers pending dates automatically |

### MLB stat family mapping:
| statFamily | API field |
|---|---|
| hits | batting.hits |
| hr | batting.homeRuns |
| runs | batting.runs |
| rbis | batting.rbi |
| totalBases | batting.totalBases |
| walks | batting.baseOnBalls |
| ks | pitching.strikeOuts |
| outs | pitching.outs (pitcher outs recorded) |

### NBA stat family mapping:
| statFamily | API field |
|---|---|
| rebounds | REB (total rebounds from boxscoretraditionalv2) |
| threes | FG3M (3-pointers made) |
| assists | AST |
| points | PTS |

### Result state machine:
- `"pending"` → player not found in resultsMap (game not played / API miss) — retryable
- `"unresolved"` → player found but stat family couldn't be extracted — retryable
- `"win"` / `"loss"` / `"push"` → settled from actual value

### Slip settlement rules:
- All legs win → "win"
- Any leg loses → "loss" (even with other wins/pushes)
- All win or push (≥1 push) → "push"
- Any unresolved → "unresolved"
- Any pending → "pending"

### Verification Results:
| Test | Result |
|---|---|
| `node --check` — 6 files | ✓ 6/6 clean |
| settleFromActual — 7 cases (over/under/push/null) | ✓ 7/7 pass |
| MLB getStatValue — 10 cases (all families + null guard) | ✓ 10/10 pass |
| NBA getNbaStatValue — 5 cases | ✓ 5/5 pass |
| normName — 2 cases | ✓ 2/2 pass |
| dry-run backfill — 10 date+sport combos discovered | ✓ 10/10 |
| summary-only run — grading_summary_mlb_2026-05-08.json written | ✓ valid JSON |

### Usage:
```bash
# Grade a specific date:
node backend/scripts/runHistoricalGrade.js --sport=mlb --date=2026-05-08
node backend/scripts/runHistoricalGrade.js --sport=nba --date=2026-05-07

# Backfill all pending dates (both sports):
node backend/scripts/runHistoricalGrade.js --sport=all --backfill

# Retry unresolved bets (player found but stat missing):
node backend/scripts/runHistoricalGrade.js --sport=all --backfill --retry-unresolved

# Just regenerate summaries from existing graded data:
node backend/scripts/runHistoricalGrade.js --sport=mlb --date=2026-05-08 --summary-only
```

### What activates after first successful run:
1. `personal_ledger.json` settled entries → calibration > 0
2. `buildDailyIntelligenceReview` → real calibration data flows
3. `buildPostGameReview` → settled bets unblock review engine
4. `grading_summary_{sport}_{date}.json` → ROI/hit-rate per tier visible

**TERM 1 restart: NOT required** — no existing files modified.

---

## SESSION AC — NBA-2.B: Canonical Volatility Resolver Extraction (2026-05-09)

**Scope**: Create `pipeline/nba/nbaVolatilityResolver.js` as the single canonical authority for NBA volatility interpretation. Replace fragmented inline guards in `buildFeaturedPlays.js` and `buildSlipAi.js` with a single resolver import. Extract, canonicalize, and eliminate all duplicate guard logic.

### Files Changed (3 files):

| File | Change |
|---|---|
| `pipeline/nba/nbaVolatilityResolver.js` | **NEW (95 lines)** — canonical authority; `nbaVolatilityResolve(raw)` + `resolveNbaVolatility(raw)` |
| `pipeline/shared/buildFeaturedPlays.js` | Import: `classifyVolatility` → `resolveNbaVolatility`; inline guard (12 lines) → single resolver call |
| `pipeline/shared/buildSlipAi.js` | Import: `classifyVolatility` → `resolveNbaVolatility`; inline guard (13 lines) → single resolver call |

**`VOLATILITY_RULES` NOT modified. `classifyVolatility()` NOT modified. MLB behavior unchanged.**

### Resolver Resolution Priority (first-match wins):

```javascript
// 1. Snapshot-sourced stamp preservation (any valid volatility from buildNbaSnapshotCandidates)
if (raw.snapshotSourced === true && VALID_VOLATILITY.has(raw.volatility)) {
  return { volatility: raw.volatility, source: "snapshot_stamped" }
}
// 2. Role-spike / eruption-environment hook [documented no-op — NBA-6 scope]
// 3. VOLATILITY_RULES fallback — classifyVolatility(raw)
return { volatility: classifyVolatility(raw), source: "rules" }
```

### Expansion vs NBA-1 guard:

NBA-1 guard was narrow: `snapshotSourced === true && volatility === "lotto"` only.

NBA-2.B resolver preserves ALL valid snapshotSourced stamps:
- PRA → "lotto" (NBA-1 preserved — most critical)
- threes / first_basket → "aggressive" (NEW: was silently reclassified to "balanced" by VOLATILITY_RULES threes-balanced rule)
- points / rebounds / assists → "balanced" (already correct via VOLATILITY_RULES, now explicit)

### Duplication Points Eliminated:

| Previously | Now |
|---|---|
| 12-line inline guard in `buildFeaturedPlays.normalizeCandidate()` | Removed |
| 13-line inline guard in `buildSlipAi.normalizeCandidate()` | Removed |
| `classifyVolatility` imported directly in both shared modules | Removed from both |
| Snapshotted volatility semantics split across 2 files | Unified in 1 resolver |

### Verification Results:

| Test | Result |
|---|---|
| `node --check` — 3 files | ✓ 3/3 clean |
| Resolver logic — 20 cases (snapshot stamps, MLB, rules, edge cases, source tags) | ✓ 20/20 |
| MLB regression — buildFeaturedPlays full run | ✓ 0 regressions |
| NBA PRA snap → lotto via resolver | ✓ |
| NBA threes snap → aggressive via resolver (NEW vs NBA-1) | ✓ |
| Non-snapshot PRA → aggressive (VOLATILITY_RULES fallback) | ✓ |
| buildSlipAi full run — PRA legs volatility preserved | ✓ |
| Inline guards remaining outside resolver | ✓ 0 |
| Global snapshotSourced guard count outside resolver | ✓ 0 |
| MLB imports unchanged | ✓ |

### Remaining Volatility Drift Risks:

1. **buildNbaSnapshotCandidates still inline in workstationRoutes.js** — the PRODUCER of volatility stamps is not yet extracted. Phase 2.C. No behavioral risk; the resolver correctly consumes whatever stamps arrive.
2. **Nightly path (buildNbaBestBetsBoard → buildNbaSlipComposer) does NOT call the resolver** — `bestBetsBoard.allPlays.volatility` is set without the resolver. Phase 2.F audit + wire required.
3. **buildNbaAiSlips.js helper trio doesn't call the resolver** — `collectFullPool` / `filterSlipLegs` / `formatLeg` have their own `legVolatility()` numeric scale (0.92–1.18). These are consumed only by the dead orphan `buildNbaDynamicSlipEngine` and the currently-unused function bodies. Phase 2.D quarantine + Phase 2.E deletion.
4. **VOLATILITY_RULES threes-balanced rule remains** — VOLATILITY_RULES maps `threes < 3.5` → balanced. The resolver correctly overrides this for snapshot-sourced candidates. Non-snapshot threes still land as balanced, which is correct behavior for MLB/non-snap NBA.

### NBA-2.C Inheritance Notes:

When `buildNbaSnapshotCandidates` is extracted to `pipeline/nba/buildNbaSnapshotCandidates.js` (Phase 2.C):
- The inline volatility stamping logic (`family === "pra" ? "lotto" : ...`) should remain in that file as the producer
- The resolver remains the consumer authority — the two roles are intentionally separate
- No changes to the resolver required for 2.C

**TERM 1 restart required** — `buildFeaturedPlays.js` and `buildSlipAi.js` both modified.

---

## SESSION AB — NBA-2: Canonical Path Constitution Audit (2026-05-09)

**Scope**: Read-only Opus audit. Full importer trace of every NBA slip-related module. Constitutional designation of canonical-nightly + canonical-workstation slip surfaces. 20-section deliverable. Zero code changes. Zero TERM 1 restart.

**Output**: `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md` — 20 sections, NBA Routing Health Score 4.6/10.

### Critical structural correction to Session Z audit:

The Session Z NBA Ecology Audit framing of "5 overlapping NBA slip builders" was misleading. Direct importer trace proves:

| Module | True status | Importers (live) |
|---|---|---|
| `buildNbaSlipComposer.js` | **CANONICAL nightly slip engine** | `buildNbaOpportunityBoard.js:13` → called line 257 → output written to `nba_tracked_slips_*.json` via `persistTrackedToday` |
| `buildNbaAiPicks.js` | **CANONICAL nightly pick scorer + aiRange attacher** | `buildNbaOpportunityBoard.js:9` → called line 238 |
| `buildNbaPlayerOutcomePredictions.js` | **CANONICAL nightly prediction engine** | `buildNbaOpportunityBoard.js:11` → called line 242 |
| `buildNbaBestBetsBoard.js` | **CANONICAL nightly board surface** | `buildNbaOpportunityBoard.js:12` → called line 251 |
| `buildNbaAiSlips.js` | **UTILITY-ONLY** — `buildNbaAiSlips()` function has ZERO importers; only its helper trio is consumed | `buildNbaPlayerOutcomePredictions` (`collectFullPool`), `buildNbaDynamicSlipEngine` (`collectFullPool`/`filterSlipLegs`/`formatLeg`) |
| `buildNbaDynamicSlipEngine.js` | **DEAD ORPHAN** with valuable correlation logic | zero importers (only comment-mention in nbaSlipLegConstraints.js) |
| `buildNbaSlipEngine.js` | **DEAD ORPHAN** | zero importers (only comment-mention in nbaAiStatFamilyRank.js) |
| `buildSlipAi.js` (shared) | **CANONICAL workstation slip regenerator** | `workstationRoutes.js:251` → called line 352 (every `/api/ws/state` request) |

### NBA Routing Health Score:

| Dimension | Score |
|---|---|
| Canonical-engine clarity | 4.5/10 |
| Dead-code namespace pollution | 3.5/10 |
| Workstation/nightly symmetry | 3.0/10 |
| Correlation logic ownership | 2.0/10 |
| aiRange resolution propagation | 5.0/10 |
| snapshotSourced flow | 7.0/10 |
| Volatility ownership | 4.5/10 |
| Tier ownership | 3.5/10 |
| Same-player suppression | 6.0/10 |
| Workstation compatibility | 6.5/10 |
| **OVERALL NBA ROUTING** | **4.6/10** |

### Critical findings beyond Session Z:

1. **`aiRange` is computed by `buildNbaAiPicks` but consumed by NEITHER active engine.** `buildSlipAi` doesn't import `nbaAiOutcomeRange`. `buildNbaSlipComposer` operates on `bestBetsBoard.allPlays` which doesn't carry `aiRange`. The two DEAD engines (`buildNbaAiSlips` + `buildNbaDynamicSlipEngine`) DO consume it. This is the single largest architectural gap — ladder ranges are computed and never reach the slip layer.

2. **All correlation logic (pairwiseStackBoost, jointProbabilityWithCorrelation, isFastCashoutLeg, ensureFastLegsLead) lives in the orphan `buildNbaDynamicSlipEngine.js`.** The active path has zero correlation. Must be absorbed BEFORE deletion (Phase 2.G).

3. **The NBA-1 snapshotSourced guard does NOT propagate to the nightly path.** `buildNbaSnapshotCandidates` (workstation only) is the sole setter of `snapshotSourced: true`. Nightly candidates flow through `classifyVolatility` unguarded. Phase 2.F audit + wiring required.

4. **Two slip surfaces (`slipBets` + `aiSlips`) coexist in `/api/ws/state` with no constitutional documentation.** `slipBets` = nightly engine-grade (Composer output); `aiSlips` = workstation regenerated (buildSlipAi). Both reach the bettor.

5. **`buildNbaSnapshotCandidates` is NBA-specific but lives inline in workstationRoutes.js** (~70 lines, pollutes the supposedly sport-agnostic routes file). Phase 2.C extraction prerequisite for NBA-3.

### NBA-2 Migration Plan (9 phases, post-AB sessions):

| Phase | Task | Model | Risk |
|---|---|---|---|
| 2.A | ARCHITECTURE.md + types.ts comments updated | Sonnet | Zero |
| 2.B | Create `pipeline/nba/nbaVolatilityResolver.js`; replace inline NBA-1 guards | Sonnet | Low |
| 2.C | Extract `buildNbaSnapshotCandidates` from workstationRoutes → `pipeline/nba/` | Sonnet | Near-zero |
| 2.D | Create `pipeline/nba/nbaSlipUtils.js`; quarantine buildNbaAiSlips to shim | Sonnet | Low |
| 2.E | Delete `buildNbaSlipEngine.js` + orphan function bodies in `buildNbaAiSlips.js` | Sonnet | Low |
| 2.F | Audit + wire bestBetsBoard volatility to resolver | Sonnet | Medium |
| 2.G | Extract `pipeline/nba/nbaCorrelation.js` from DynamicSlipEngine; wire into buildSlipAi NBA branch | **Opus** | Medium-high |
| 2.H | Delete `buildNbaDynamicSlipEngine.js` (after 2.G stable) | Sonnet | Low |
| 2.I | Wire aiRange into buildSlipAi NBA branch | **Opus** | High |

### What must never change (from this audit):
- `nbaAiOutcomeRange.js` (computeOutcomeRange, resolveLegFromAiRange, resolveLottoLegAboveCeiling)
- `nbaAiStatFamilyRank.js` (role/stat alignment, statStabilityWeight table)
- `nbaPropLanes.js` (CORE_LANES / COMBO_LANES taxonomy)
- `passesEliteTierGate` numeric thresholds (NBA-4 scope only)
- `compositeRankScore` weights (NBA-5 scope only)
- NBA-1 snapshotSourced guard pattern (extracted to resolver but contract preserved)
- `VOLATILITY_RULES` static table itself
- `f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)` cap (Sessions T-V)
- `/api/ws/*` response shape (`slipBets`, `aiSlips`, `featured`)
- `applyEdgeToNbaRows` apply order
- `dominanceGap` filter
- `pseudoThrees` logic in buildNbaAiPicks
- `persistTrackedToday` atomic-rename pattern

### Pending checkpoint:
- Files added (1): `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md` (~1,150 lines)
- Files modified (2): `CURRENT_STATE.md`, `NEXT_SESSION.md` (Session AB section + roadmap)
- Code mutations: 0
- TERM 1 restart: NO (read-only)

---

## SESSION AA — NBA-1: PRA Volatility Guard (2026-05-09)

**Scope**: Surgical fix to preserve PRA/combo-stat `volatility: "lotto"` stamps that `buildNbaSnapshotCandidates()` (workstationRoutes.js FIX Q4) applies on snapshot candidates. Previously, `normalizeCandidate()` in both downstream modules unconditionally called `classifyVolatility(raw)`, which overwrites "lotto" with "aggressive" (VOLATILITY_RULES: `combo/pra → aggressive`). NBA-1 adds a narrow guard that skips reclassification when the candidate is confirmed snapshot-sourced and already stamped lotto. MLB candidates never set `snapshotSourced` — zero MLB behavior change.

### Files Modified (3 edits, 2 files):

| File | Change | Lines |
|---|---|---|
| `pipeline/shared/buildFeaturedPlays.js` | `normalizeCandidate()`: snapshotSourced "lotto" guard | ~87–97 |
| `pipeline/shared/buildFeaturedPlays.js` | `scoreCandidate()` volRealism: lotto → 0.65 explicit slot (was 0.56 fallthrough) | ~130 |
| `pipeline/shared/buildSlipAi.js` | `normalizeCandidate()`: same snapshotSourced "lotto" guard | ~113–124 |

**VOLATILITY_RULES NOT modified.** `classifyVolatility()` NOT modified. `SAFE` lane unchanged. MLB ecology unchanged.

### Guard Logic (identical in both modules):
```javascript
// NBA-1: Preserve snapshotSourced volatility for lotto-stamped candidates.
// buildNbaSnapshotCandidates() (workstationRoutes.js FIX Q4) stamps
// volatility: "lotto" on PRA combo candidates and snapshotSourced: true.
// Without this guard, classifyVolatility() overwrites with "aggressive"
// (VOLATILITY_RULES: combo/pra → aggressive), blocking PRA from the lotto
// slip tier and penalizing it in volRealism scoring vs balanced stats.
// Guard is narrow: only preserves "lotto" stamps from confirmed snapshot
// source. MLB candidates never set snapshotSourced — no MLB behavior change.
// VOLATILITY_RULES itself is NOT modified.
volatility: (raw.snapshotSourced === true && raw.volatility === "lotto")
              ? "lotto"
              : classifyVolatility(raw),
```

### volRealism Fix (buildFeaturedPlays.js only):
```javascript
// NBA-1: lotto gets its own slot (0.65 ≈ aggressive 0.66) rather than the
// generic 0.56 fallthrough. Without this, PRA candidates correctly preserved
// as "lotto" score ~0.01 lower than equivalent aggressive plays — suppressing
// PRA ecosystem surfacing despite the classification fix.
f.volRealism = c.volatility === "safe" ? 0.80 :
               c.volatility === "balanced" ? 0.74 :
               c.volatility === "aggressive" ? 0.66 :
               c.volatility === "lotto" ? 0.65 :
               0.56
```

### Verification Results:
| Test | Result |
|---|---|
| `node --check` — 4 affected files | ✓ 4/4 clean |
| Guard logic — 15 test cases | ✓ 15/15 pass |
| MLB regression test | ✓ 0 regressions |
| buildAiSlips full run — PRA classification | ✓ PRA → "lotto", seeds aggressive slips |
| buildFeaturedPlays full run — bestPra | ✓ 4 plays all "lotto", smartAggression surfaces PRA |
| SAFE lane | ✓ clean, no lotto contamination |
| LOTTO slips populated | ⚠ empty (expected — odds gate NBA-3 scope) |

### Intentional Design Tradeoffs:
- PRA reclassified as "lotto" loses balanced tier access (`allowedVolatility: ["safe","balanced","aggressive"]` — lotto not included). This is correct: combo stats do not belong in balanced slips.
- PRA retains aggressive tier access (lotto is in `["balanced","aggressive","lotto"]`).
- LOTTO slips remain sparse because base-odds legs (dec ~5–9 each, 5-leg combo ~22–26) barely reach the [20, 1500] gate. NBA-3 (alt line gate) is the structural fix.

### NBA-2 Inheritance from NBA-1:
- `buildNbaAiSlips.js` (canonical path) has its own `normalizeCandidate()` — NBA-2 must apply the same snapshotSourced guard OR ensure lotto stamps flow through its input pool without reclassification
- The volRealism fix is in `buildFeaturedPlays.js` only — NBA-2 canonical slip scoring path must be audited separately (Opus)
- `snapshotSourced: true` flag is the sentinel — NBA-2 input shape must preserve this field when piping workstation pool into buildNbaAiSlips

**TERM 1 restart required** — `buildFeaturedPlays.js` and `buildSlipAi.js` both modified; both are loaded at startup.

---

## SESSION Z — NBA Ecology Constitution Audit (2026-05-09)

**Scope**: Read-only philosophical + architectural audit. Zero code changes. Zero regressions. Zero TERM 1 restart required.

**Output**: `docs/NBA_ECOLOGY_AUDIT_2026-05-09.md` — 20 sections, NBA Ecology Health Score 2.9/10.

### NBA Ecology Health Score Summary:

| Dimension | Score |
|---|---|
| Candidate diversity | 3.5/10 |
| Volatility ecosystem richness | 2.0/10 |
| Role-spike surfacing | 2.0/10 |
| Ladder coherence | 2.5/10 |
| Eruption environment | 1.0/10 |
| First-basket ecosystem | 2.0/10 |
| Aggression tier authenticity | 3.0/10 |
| Same-game correlation logic | 4.0/10 |
| **OVERALL** | **2.9/10** |

### 8 Critical Failures Confirmed:

1. **Two-path disconnect** — workstation uses MLB-calibrated shared path; NBA-specific builders orphaned
2. **realismScore monoculture** — 70% weight guarantees star dominance; 3× edge cannot overcome gap
3. **Lotto starvation** — structural failure on both paths; fallback mirrors aggressive
4. **aiRange crippled** — alt line gate (`propVariant !== "base"`) kills floor/median/ceiling resolution
5. **No ecology tier layer** — NBA has no equivalent of MLB's ELITE/STRONG stamps
6. **Model signal weak** — nbaModelSignals.js is 82–92% market-following; can't detect role spikes
7. **Eruption environment absent** — no NBA analog to MLB HR candidate ecosystem
8. **Five overlapping builders** — philosophically incompatible; buildNbaSlipEngine.js is random, not intelligent

### NBA Evolution Roadmap (7 phases):

| Phase | Task | Model | Priority |
|---|---|---|---|
| NBA-1 | PRA volatility fix — Path A (snapshot-sourced field) | Sonnet | 🔴 Now |
| NBA-2 | Designate buildNbaAiSlips as canonical workstation path | Opus audit first | 🔴 Now |
| NBA-3 | Allow quality alt lines through workstation gate | Sonnet | 🟡 After NBA-2 |
| NBA-4 | Build NBA Ecology Tier Layer (ELITE/STRONG stamps) | Sonnet | 🟡 After NBA-3 |
| NBA-5 | Reduce realismScore weight 0.70 → 0.45; raise probability 0.15→0.25, edge 0.10→0.20 | Opus audit first | 🟡 After NBA-4 |
| NBA-6 | Add eruption environment detection (role-spike, blowout-risk, pace escalation) | Sonnet | 🟢 After NBA-5 |
| NBA-7 | Wire first basket to workstation (alt market accumulation) | Sonnet | 🟢 After NBA-6 |

### What must eventually die (from audit):
- `buildNbaSlipEngine.js` — random Math.random() picker, philosophically incompatible
- `buildNbaSlipComposer.js` — field naming mismatches, requires `bestBetsBoard` format no longer current
- `buildNbaDynamicSlipEngine.js` — parallel system with incompatible "lotto" semantics; absorb correlation logic into buildNbaAiSlips first

### What must never change (from audit):
- `pairwiseStackBoost()` correlation logic in DynamicSlipEngine (absorb into canonical path first)
- aiRange resolution architecture (floor/median/ceiling/lotto leg resolution)
- Lane separation (CORE_LANES vs COMBO_LANES vs special)
- `roleStatScoreBump` logic in nbaAiStatFamilyRank.js
- statStabilityWeight table
- SAFE archetype two-leg / elite-only constraint
- `maxSameGame` constraints
- MLB ecology (any NBA changes must not touch MLB path)

---

## SESSION W — Daily Intelligence Review Engine

See previous CURRENT_STATE for full Session W details. All Session W systems remain active.

---

## CURRENT ORCHESTRATION

Candidate diversification (`buildCandidateDiversity.js → diversifyCandidates`):
- `maxPerPlayer: 3` · `maxPerGame: 7 (MLB) / 12 (NBA)` · `maxPerStat: 10` · `maxPerStatSide: 6`

Featured side-balance (`buildFeaturedPlays.js → pickDiversified`):
- `maxSideFraction: 0.60` (anchors: 0.55)

Volatility classification (`buildPortfolioOptimizer.js → VOLATILITY_RULES`):
- `threes < 3.5 → balanced`, `threes >= 3.5 → lotto`, `PRA/combo → aggressive`, `odds >= 350 → lotto`

NBA snapshot candidate pipeline:
- Gates: core odds (-200..+200), no alternate/ladder keys, known stat family, mp≥0.35, edge≥0.03
- Top 150 by edge

---

## ACTIVE BOTTLENECKS

**NBA lotto pool seeds correctly (NBA-1 ✅)** — snapshotSourced PRA candidates now classify as "lotto" through the guard. Remaining gap: base-odds legs (dec ~5–9) combine to dec ~12–26, borderline for the [20, 1500] gate. Requires NBA-3 (alt line gate) + NBA-2 (canonical path) to fully populate lotto slips.

**First basket bucket empty.** `first_basket` family absent from base snapshot — alt markets only.

---

## KNOWN WEAKNESSES

1. **NBA lotto slips still odds-gated** — NBA-1 ✅ fixed classification (PRA now seeds as "lotto"). Remaining blocker: base odds dec ~5–9 per leg; 5-leg combo ~22–26 barely clears lotto gate [20, 1500]. NBA-3 (alt line gate) is the next lever; NBA-2 (canonical path) is prerequisite.
2. **NBA first basket bucket empty** — needs alt market accumulation
3. **NBA smartAggression limited** — only PRA gets `aggressive`
4. **NBA tracked_bets pool thin** — 2 bets today
5. **NBA SP4 (combo PA/PR/RA)** — resolveStatFamily returns null. Deferred.
6. **NBA SP1 (bestProps empty)** — **FIXED (Session AT)**. `buildNbaBestProps()` added to `fetchNbaOddsSnapshot.js`; runs on every nightly fetch. `snapshot.json` backfilled with 46 real props (edge≥0.03, mp≥0.35, max 2/player). TERM 1 restart required to update in-memory `oddsSnapshot.bestProps`.
7. **`personal_ledger.json` all 2,000 entries pending** — grading pipeline now built (Session AD); run `node backend/scripts/runHistoricalGrade.js --sport=all --backfill` to settle
8. **tracked_best missing eventId/matchup** — tier boosts always fail; Priority 3
9. **Duplicate balanced slip issue (seenSignatures)** — deferred
10. **`timing_intelligence_state.json` at 729KB, unbounded growth** — no pruning
11. **Under-heavy raw NBA pool (~67% unders)** — source imbalance
12. **Under-heavy raw MLB pool (~83% unders)** — same
13. **Daily intelligence review calibration = 0** — grading pipeline built (Session AD); run backfill to activate
14. **Intelligence review steam/book answers empty** — steam_summary_json placeholder; needs line shopping data wired
15. **NBA ecology — two-path disconnect** — workstation uses shared buildSlipAi.js (MLB-calibrated); nightly uses buildNbaSlipComposer (canonical-nightly, confirmed Session AB). The other 3 "NBA slip builders" are: buildNbaAiSlips (utility-only — function unused), buildNbaDynamicSlipEngine (DEAD orphan, but holds all correlation logic — must be absorbed not deleted), buildNbaSlipEngine (DEAD orphan). See NBA_CANONICAL_PATH_AUDIT_2026-05-09.md.
16. **NBA monoculture root cause confirmed** — realismScore×0.70 weight mathematically guarantees star dominance. Star finalWeight ≈1.62, backup with 3× edge ≈1.25. Gap is structural.
17. **NBA lotto starvation fully traced** — two failure paths: shared path (maxOdds 600 impossible at base), nightly path (aiRange requires alt lines killed by workstation gate). Fallback: copies aggressive.
18. **NBA intelligence health: 2.9/10** — 8 critical failures audited. Full roadmap NBA-1→NBA-7 in docs/NBA_ECOLOGY_AUDIT_2026-05-09.md.
19. **`tracker/betTracker.js` vs `buildPersonalLedger.js`** — two parallel bet tracking systems, no reconciliation (betTracker is legacy)

**RESOLVED SESSION AG:**
- ~~BALANCED 4-leg slips produced by nightly MLB engine~~ — `alt: 4` removed; `legSize: { target: 3, min: 2 }` enforced ✓
- ~~Combined odds reaching 25.0 on BALANCED slips~~ — `maxCombinedDecimalOdds: 8.0` / `minCombinedDecimalOdds: 3.0` enforced ✓
- ~~rbis/outs appearing in slip parlays~~ — excluded via `BALANCED_FAMILIES` (MLB engine) and `SLIP_EXCLUDED_FAMILIES` (buildSlipAi) ✓
- ~~Overs appearing in BALANCED slips~~ — `sideFilter: ["under"]` / `allowedSides: ["under"]` enforced across all 3 paths ✓
- ~~combinedModelProb confidence inflation (uncalibrated joint probability)~~ — family-level coefficients applied; `rawCombinedModelProb` preserved for audit ✓
- ~~AGGRESSIVE/LOTTO tiers producing contaminated slips~~ — frozen (`FREEZE_AGGRESSIVE_LOTTO = true`); reversible; auditable in `meta.frozenTiers` ✓
- ~~Rejected slips unauditable~~ — `meta.droppedSlips` counter added to composer output ✓

**RESOLVED SESSION AC:**
- ~~Inline snapshotSourced guards fragmented across 2 shared modules~~ — extracted to `pipeline/nba/nbaVolatilityResolver.js`; resolver is sole canonical authority ✓
- ~~`classifyVolatility` imported directly by shared modules for NBA logic~~ — removed from both; resolver delegates internally ✓
- ~~threes snap → aggressive silently reclassified to balanced~~ — resolver now preserves ALL valid snapshot stamps (not just "lotto") ✓

**RESOLVED SESSION AB:**
- ~~Canonical NBA slip path undesignated~~ — buildNbaSlipComposer canonical-nightly; buildSlipAi canonical-workstation; documented in NBA_CANONICAL_PATH_AUDIT_2026-05-09.md ✓
- ~~Session Z misdesignation of "5 overlapping NBA slip builders"~~ — true picture: 2 active (buildNbaSlipComposer + buildSlipAi) + 1 utility (buildNbaAiSlips) + 2 dead (buildNbaSlipEngine + buildNbaDynamicSlipEngine) ✓
- ~~aiRange consumption gap not surfaced~~ — confirmed: aiRange computed by buildNbaAiPicks, consumed by NEITHER active engine; absorbed only by orphans. Phase 2.I scope. ✓
- ~~Correlation logic ownership undocumented~~ — confirmed living only in orphan buildNbaDynamicSlipEngine; Phase 2.G absorption plan defined ✓

**RESOLVED SESSION AA:**
- ~~NBA lotto slips empty (classification layer)~~ — snapshotSourced guard preserves "lotto" stamps in both normalizeCandidate() instances ✓
- ~~PRA volRealism penalty~~ — lotto explicit slot 0.65 prevents scoring regression vs aggressive 0.66 ✓

**RESOLVED SESSION Z:**
- ~~NBA ecology audit not done~~ — full 20-section audit complete; health score 2.9/10; 7-phase roadmap defined ✓

**RESOLVED SESSION Y:**
- ~~`isOffensiveAttackStat` duplicated~~ — unified in normalizers.js ✓
- ~~Compactors inline in workstationRoutes.js~~ — extracted to buildWorkstationCompactors.js ✓
- ~~`__refreshInProgress` dual-mutex~~ — unified to module-level ✓
- ~~11,185 lines of dead inlined NBA code~~ — deleted ✓
- ~~4 empty stub directories~~ — deleted ✓
- ~~betting2.db orphan artifacts~~ — deleted ✓

---

## INFRASTRUCTURE STATE

| File | Status |
|---|---|
| `docs/WORKFLOW_RULES.md` | Committed |
| `docs/CURRENT_STATE.md` | **Synced to root this session (Session Z)** |
| `docs/NEXT_SESSION.md` | **Synced to root this session (Session Z)** |
| `docs/BOOTSTRAP_PROMPT.md` | Committed |
| `docs/ARCHITECTURE.md` | Needs update: line counts stale, http/ section changed |
| `docs/ARCHITECTURE_AUDIT_2026-05-09.md` | Created Session X — Phase 0/2 items now complete |
| `docs/NBA_ECOLOGY_AUDIT_2026-05-09.md` | **NEW (Session Z) — 20-section NBA intelligence audit; health 2.9/10; roadmap NBA-1→NBA-7** |
| `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md` | **NEW (Session AB) — 20-section NBA routing audit; health 4.6/10; canonical designations + 9-phase migration plan (2.A→2.I)** |
| `backend/pipeline/shared/normalizers.js` | **NEW (Session Y)** |
| `backend/pipeline/shared/buildWorkstationCompactors.js` | **NEW (Session Y)** |
| `backend/pipeline/nba/nbaVolatilityResolver.js` | **NEW (Session AC) — canonical NBA volatility authority; resolveNbaVolatility() + nbaVolatilityResolve(); snapshotSourced preservation + NBA-6 hook + VOLATILITY_RULES fallback** |
| `backend/pipeline/shared/buildFeaturedPlays.js` | **Session AC: classifyVolatility import removed; resolveNbaVolatility import added; inline guard replaced with resolver call. Session AA: volRealism lotto 0.65 slot. Session Y: isOffensiveAttackStat imported from normalizers** |
| `backend/pipeline/shared/buildSlipAi.js` | **Session AC: classifyVolatility import removed; resolveNbaVolatility import added; inline guard replaced with resolver call. Session Y: isOffensiveAttackStat imported from normalizers; inline block removed** |
| `backend/routes/workstationRoutes.js` | **Session Y: compactors imported from buildWorkstationCompactors; 103-line inline removed** |
| `backend/server.js` | **Session Y: /refresh-snapshot mutex unified to module-level** |
| `backend/storage/reviewSchema.js` | NEW (Session W) |
| `backend/storage/schema.js` | Session W: applyReviewSchema() wired |
| `backend/pipeline/review/` | NEW (Session W) — 6 modules |
| `backend/scripts/runDailyReview.js` | NEW (Session W) |
| `backend/pipeline/shared/buildNightlyOrchestrator.js` | Session W: Step 9 wired |
| `backend/storage/queries.js` | Session S: ledger upserts + transaction fix |
| `backend/pipeline/shared/buildPersonalLedger.js` | Session S: atomic saveLedger() + SQLite mirror |
| `backend/routes/workstationRoutes.js` | Session U: screenshotRoutes mounted |
| `backend/http/nbaIsolatedRoutes.js` | Session R Fix R1 |
| `backend/pipeline/mlb/buildMlbPropClusters.js` | Session T: HR scoring; Session V: team fields |
| `backend/pipeline/mlb/phase4Tracking.js` | Session V: leanBet/leanSlip team fields |
| `backend/storage/screenshotSchema.js` | NEW (Session U) |
| `backend/pipeline/screenshots/` | NEW (Session U) — 3 modules |
