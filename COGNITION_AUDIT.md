# COGNITION AUDIT — 2026-05-22

**Operator-demanded full audit.** Why the repo isn't picking winners yet, what's actually wired vs scaffold vs orphan, and the prioritized rebuild order.

This is a **live-path audit** — trace request → response, name every cognition junction, assess. Not a 205-module spreadsheet.

---

## The honest top-line finding

**The repo is an edge-finder, not a winner-predictor.**

The NBA/MLB pipelines are architected around one question: *"where does my model disagree with the sportsbook?"* High-edge plays surface, fair-priced plays get dropped. Stars on chalk odds always get dropped because the book prices them efficiently and the model agrees.

What the operator wants is a *winner-predictor*: *"who is most likely to hit tonight, and what's their realistic range?"* That's a different question and the current cognition doesn't answer it.

This explains every recurring complaint:
- **"6 picks for a NBA playoff game?? insane"** — the edge filter rejects ~95% of the snapshot; only longshots survive.
- **"no stars is asinine"** — stars are filtered by the modelProb≥0.35 OR edge≥0.03 rules. Chalk star plays fail edge.
- **"MLB lotto still shows 3x hits"** — the pool is structurally biased toward variance plays where edge is mathematically inflated against tiny implied probabilities.
- **"i need to see his true potential for each game in terms of o/u, ladder, real predicted ceilings"** — we have model probability (single number P(over_line)) but no RANGE prediction.

---

## NBA live path — what actually runs on /api/ws/state?sport=nba

```
GET /api/ws/state?sport=nba
  ↓
buildCandidatePool(nba, date)  ← reads tracked_bets file from disk
  • returns: { trackedBets, trackedBest, enrichedBest, eligibleBets }
  • filter: edge > 0.04 AND modelProb > 0.20  ← FIRST edge gate
  ↓
applyTeamFallbackFromProjections (v0.1.6 fix — 31/55 candidates get team)
  ↓
readSnapshotRowsWithFreshness("nba")  ← loads full snapshot.json (2750 rows)
  ↓
buildNbaSnapshotCandidates(snapshotRows)  ← per-row enrichment + scoring
  • enrichNbaRowStatLayerInputs    (pace/total/minutes/usage)
  • enrichNbaRowWithRecentForm     (last5/last10 from ESPN cache)
  • enrichNbaRowWithRoleContext    (starter rate, minutes trend)
  • enrichNbaRowWithTeammateContext (absent-teammate redistribution, ±0.030 shift)
  • enrichNbaRowWithMarketContext   (consensus, dispersion, market signal)
  • enrichNbaRowWithAvailability    (player status, availability shift)
  • mp = nbaRowModelProbability(row)
  • REJECT IF mp < 0.35              ← gate #2
  • edge = nbaRowEdge(row)
  • REJECT IF edge < 0.03            ← gate #3
  • Alt-lines: REJECT IF mp < 0.42 OR edge < 0.06  ← gate #4
  • Push survivors to rawQualified
  ↓
dedupe + sort by edge desc, slice top 150
  ↓
supplementedCandidates = [trackedBets ∪ snapSupplement.novel]
  ↓
diversifyCandidates  ← cap 3 per player, 12 per game, 10 per stat, 6 per stat-side
  ↓
buildFeaturedPlays  ← bucket into "tonightsBest / bestHr / smartAggression / safest / lotto"
  ↓
returns: { candidates, featured, aiSlips, discoveryCandidates, ... }
```

**Why 6 NBA picks tonight:** at the gate-#2/#3 thresholds, ~2700 snapshot rows collapse to ~7 survivors. Then diversification keeps it that way. Wemby's lines pass gate #2 (mp ≥ 0.35) but fail gate #3 (edge usually zero on chalk).

---

## NBA cognition modules — status + value

| Module | Status | Value 1-5 | Notes |
|---|---|---|---|
| `nbaModelSignals.nbaRowModelProbability` | ✅ wired | 3 | Produces single P(over_line). Inputs are real. **Output is not a range.** |
| `nbaRecentFormCache` | ✅ wired | 4 | Last5/Last10 from ESPN game logs. Real predictive signal. |
| `nbaRoleContextDeriver` | ✅ wired | 4 | Minutes trend, starter rate, DNPs. Real. |
| `nbaTeammateContextDeriver` | ✅ wired | 3 | Absent-teammate usage redistribution. Capped at ±0.030 prob — small effect. |
| `nbaMarketContextDeriver` | ✅ wired | 3 | Consensus + dispersion. Capped ±0.020 shift. |
| `nbaAvailabilityCache` | ✅ wired | 3 | Player status injection. Honest "unknown" handling. |
| `nbaEventTeamResolve.applyTeamFallbackFromProjections` | ✅ wired | 2 | Reads stale `nbaPlayerProjections.json` (May 1, missing ~24 current players). |
| `nbaMatchupIntelligence.computeMatchupAdjustmentFromRow` | ⚠️ partial | 4 | Opponent adjustment, but matchup data thin. Big potential. |
| `nbaOpportunityCandidates` | ✅ wired | 3 | Building the "rolled" cache, separate path. |
| `nbaSlipComposer` | ✅ wired | 3 | Builds slip combinations. |
| `nbaInsightBoard`, `nbaPerformanceTracking`, etc. | partial | 2 | Many modules in pipeline/nba/ exist but unclear if all wired. |

**API-SPORTS NBA adapter: DOES NOT EXIST.** (Audit memo from Session N+1 flagged this — only MLB has one.) Means we don't ingest live NBA data from API-SPORTS at all. ESPN game logs cover recent form; injuries, advanced stats, defensive splits — NOT consumed.

---

## MLB live path — what actually runs

```
GET /api/ws/state?sport=mlb
  ↓
buildCandidatePool(mlb, date)  ← reads tracked_bets (built by nightly runMlbNight.js)
  ↓
[no snapshot-supplement for MLB — only NBA gets buildNbaSnapshotCandidates]
  ↓
diversifyCandidates → buildFeaturedPlays → ...
```

**MLB has a richer overnight cognition** (`buildMlbBootstrapSnapshot`, `buildMlbPlayerDataset`, `scoreMlbProp`, `buildMlbHitsProbabilityEngine`, `buildMlbRbiProbabilityEngine`, `buildMlbHrPredictionCandidates`, `buildMlbDecisionBoard`, `buildMlbBetSelector`, `buildMlbSlipEngine`, `buildMlbOomphEngine`, `buildMlbSpikeEngine`, `buildMlbPropClusters`, `playerConvictionEngine` PCE-1A, `mlbCorrelationEngine`) that already runs at refresh time. But it ALSO bottoms out at the edge gate (edge > 0.04 default).

MLB live state pipeline reactivated this session (`MLB_LIVE_STATE_ENABLED=1`) but the lineup matching still 0/7701 because the data source is roster-fallback when lineups aren't yet posted — known timing issue, real fix is auto-refresh in the lineup window.

---

## Modules that exist but appear orphaned (not in live request path)

These ran in earlier eras and may produce useful data sitting unused:

- `buildMlbInspectionBoard` — board diagnostic, unclear if wired
- `buildMlbAutoTickets` — auto-ticket generation, NOT in /state
- `buildMlbParlays` — separate parlay path
- `buildMlbOomphEngine`, `buildMlbSpikeEngine` — eruption candidates, partial wiring
- `buildSpecialtyOutputs` — specialty markets, partial
- `buildCeilingRoleSpikeSignals` — CEILING signals (this could be a HUGE find for range prediction — investigate next)
- `buildLineupRoleContextSignals` — exists but separate from nbaRoleContextDeriver
- `buildMarketContextSignals` — exists separately too
- 4-anchor brain layer (`brain/loadBrainContext`, `brain/assessContinuity`, `brain/verifyBrainFreshness`, `brain/enforceBrainCheckpoint`) — governance, OK to ignore

**`buildCeilingRoleSpikeSignals` should be investigated** — the name suggests it was attempting CEILING prediction, which is exactly the "predicted range upper bound" we need. May already have the cognition we keep saying we don't have.

---

## The PRODUCT gap (what's missing for predictive picks)

What we have:
- ✅ Live odds (Odds API)
- ✅ Recent form (ESPN cache, last5/last10)
- ✅ Minutes/role projections (NBA roleContext, MLB lineupSpot when enabled)
- ✅ Team-level data (partial)
- ✅ Single-number model probability per prop

What we DON'T have (in priority order):
1. **Per-player RANGE prediction** — "Wemby: 24-38 pts tonight (80% confidence)". Current `modelProb` is P(over a specific line); not a range over the full distribution.
2. **Ladder-aware optimization** — given the predicted range, which alt line is smartest. We surface alt lines as candidates but don't compute "Wemby Over 27.5 is the sweet spot."
3. **Opponent matchup intelligence at usable depth** — `nbaMatchupIntelligence` exists but its data is thin. Defensive ratings per position, pace, projected game-script — not surfaced.
4. **Star/starter surfacing INDEPENDENT of edge** — current default surface filters out fair-priced star plays.
5. **No-3x-hit enforcement** — operator has explicitly rejected Hits 2.5+; lotto-room quarantine is too weak, should drop entirely.
6. **Recommendation logging** — every surfaced play should be logged so we can grade and learn.
7. **Next-morning grading + CLV** — yesterday's picks vs actuals.
8. **Learning loop** — patterns from graded picks should adjust the model.

---

## Prioritized rebuild order

Based on operator priorities ("sure money on stars, real predicted ceilings, no 3x hits, recorded and graded"):

### Phase A — IMMEDIATE (this session or next)

**A1. Hard-ban Hits 2.5+ from surface.** Operator explicitly rejected. Filter at the candidate pool BEFORE display. Same for any prop with implied probability < 8% (extreme longshots).

**A2. Star-default surface (game-first).** Default NBA/MLB tabs surface tonight's starters from full snapshot, not the edge-filtered pool. Edge plays become a secondary "Sharp Plays" view.

**A3. Investigate `buildCeilingRoleSpikeSignals`.** If it produces ceiling estimates, wire its output into a "Predicted Range" surface on each player card.

### Phase B — REAL COGNITION (multi-session)

**B1. Build NBA API-SPORTS adapter** (parity with MLB scaffold). Unlocks injuries, splits, advanced stats — already paid for, not consumed. Audit memo from Session N+1 flagged this.

**B2. Per-player range prediction cognition.** New module: takes player + recent form + role + opponent + matchup → returns `{ floor, expected, ceiling, confidence }`. Range over the full stat distribution, not just P(over X).

**B3. Ladder-aware sweet-spot finder.** Given predicted range, identify which alt lines are mispriced. Surface as "best ladder line."

**B4. Opponent matchup deep wire.** Defensive ratings per position, pace, projected game-script. Use API-SPORTS team statistics endpoints we already pay for.

### Phase C — FEEDBACK LOOP

**C1. Recommendation logging.** Every surfaced play (and every operator-built parlay) gets persisted with full context. Foundation for grading.

**C2. Next-morning grading.** Pull actuals (game stats), grade each logged play W/L, compute CLV.

**C3. Per-segment hit-rate tracking.** Aggregate W/L by prop type, archetype, book, tier, time-window. Surfaces what's actually working.

**C4. Cognition feedback.** Use C3 data to retune the model — what the system gets right, where it overestimates.

### Phase D — VIRAL LEARNING

**D1. Screenshot upload + analysis** (mostly DONE — slip analyzer works).
**D2. Pattern mining across winning slips** — Flow B from task #21.

---

## What I propose for the NEXT session

**Phase A1 + A2 + A3 in one session.** Concretely:

1. Filter Hits 2.5+ and implied-prob<8% at candidate-pool source (not just lotto quarantine).
2. Add "Tonight's Games" mode that defaults the NBA/MLB tab to a roster-view of all starters + their primary props (built from full snapshot, no edge filter).
3. Investigate `buildCeilingRoleSpikeSignals` — if it has ceiling estimates, surface them.

That's an honest 3-deliverable session that moves the meter on the operator's "stars + ranges + no 3x hits" demand.

After that ships and you've validated, **Phase B1 (NBA API-SPORTS adapter) is the highest-leverage cognition build** because it's the data unlock for everything else.

---

## What I'm telling you in plain English

**Yes, the repo is far from your vision.** I've been polishing surfaces. The cognition layer underneath is an edge-finder when you need a winner-predictor. They're different products. The work to convert is real (Phase B is multi-session), but Phase A is achievable as the immediate next move and addresses the most-visible operator complaints.

If you want, the next session is "Phase A: hard-ban 3x hits + game-first starter surface + investigate ceiling signals." Tell me and I'll execute.
