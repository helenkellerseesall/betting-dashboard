# MLB Prop-Family Signal Wiring — FACTUAL MAP (sub-agent pass, READ-ONLY)

Phase Signal-Inputs-Audit-1A · 2026-06-06. Forensic map of what the MLB pick code actually reads vs what is
wired-but-unused. file:line + snippets. UNVERIFIED items flagged. No judgment layer here (see synthesis.md).
HR family + pitcher Ks called out per operator concern (pitcher hand / park / weather). Linchpin claims
(outs=const 17, HR pitcher-contact `??=` constants, pick origin = buildMlbBestBetsBoard) spot-checked by hand.

## STEP 1 — Pick-origin finding (the "only 4 fields" claim is OUTDATED for the tracked corpus)

Persisted/tracked MLB picks do NOT come from `buildMlbPropClusters`. Real chain:
`mlbIsolatedRoutes.js /refresh-snapshot` → `buildMlbOpportunityBoard` (buildMlbOpportunityBoard.js:371-400) →
builds `playerOutcomePredictions = buildMlbPlayerOutcomePredictions(...)` + `marketProps = marketPropsFromMlbRows`
→ **`bestBetsBoard = buildMlbBestBetsBoard({predictions, marketProps})`** (buildMlbOpportunityBoard.js:379-382) →
**`persistTrackedToday({ bestBetsBoard })`** (:400) → leanBet per play (phase4Tracking.js:741-817,872-894) →
writes `mlb_tracked_bets_<date>.json`.

So the tracked-pick scorer is **`buildMlbBestBetsBoard`** (markets/mlbClassification.js:810-1028), scoring
`predictions.players[].stats[family]` = {floor, mostLikely, ceiling, ladder} against the market row. It reads NO
context field directly. The "4 canonical fields" (predictedProbability/impliedTeamTotal/lineupPosition/
isPlatoonAdvantage) describe `buildMlbPropClusters`/computeRbiClusterScore (buildMlbPropClusters.js:79-104,47-68),
a SEPARATE display/legacy board NOT the tracked-pick origin. `project_pick_origin_architecture` memory is stale.

What `buildMlbBestBetsBoard` reads per pick (mlbClassification.js:846-887):
- market row mp: player,eventId,line,side,oddsAmerican,propType,marketKey,ladder,statFamily,isPitcherMarket,
  gameTime (:850-856,1128-1191)
- projection pred.stats[family]: stat.mostLikely/floor/ceiling/ladder via modelProbForSide→modelProbOver→
  ladderProbForOver/deriveSigma (:559-617); volatilityGap reads mostLikely+ceiling (:687-693); projectionConfidence
  reads mostLikely/floor/ceiling (:619-630). Calibration multiplier in calibrateMlbConfidence (:679-682).
Per-family richness lives UPSTREAM in how stat.ladder/mostLikely were built by buildMlbPlayerOutcomePredictions
(buildMlbPlayerDataset.js:144-281), which reads per-stat engine outputs off the shared playerMap. Context fields
set by applyMlbContextualLayers reach a pick ONLY if a per-stat engine folded them into the number first.

## STEP 2 — Fields wired onto rows

applyMlbContextualLayers (pipeline/mlb/context/applyMlbContextualLayers.js) sets per row:
- row.batterHand, row.batterStats{batSide,avg,obp,slg,ops,iso,hrRate,kRate,bbRate,xbhRate,atBats,plateAppearances,
  homeRuns} (:137-154)
- row.pitcherHand, row.pitcherStats{throws,kRate,bbRate,k9,whip,era,inningsPitched,battersFaced,strikeOuts,
  homeRunsAllowed,gamesStarted} (:159-187)
- row.batterL5, row.batterL15 (mlbBatterFormCache.enrichRowWithBatterForm :328)
- row.pitcherL3/L5 or row.opposingPitcherL3/L5 (mlbPitcherFormCache.enrichRowWithPitcherForm :335)
- row.impliedTeamTotal half-total fallback (:346)
- row.weatherContext, parkContext, handednessContext, pitcherEnvironmentContext, bullpenContext, lineupContextV2,
  mlbContextualSignal, mlbContextualShift, mlbContextualTags, isPlatoonAdvantage (:413-425)

Caches on disk: mlbBatterStats.json (290KB), mlbPitcherStats.json (18KB), mlbParkFactors.json, mlbGameWeather.json,
mlbStatcastPower.json (56KB), mlbBatterGameLogs.json (2.8MB), mlbPitcherGameLogs.json (31KB).

NEVER-POPULATED (read-with-fallback only): pitcherHrPer9/pitcherFlyBallRate (only inline defaults 1.2/0.35 at
mlbIsolatedRoutes.js:381-382 + buildMlbHrPredictionCandidates.js:338-339), opponentPitcherHrPer9, opposingPitcherWhip,
opposingPitcherKper9/opposingKsPer9, recentFormScore, ipExpected/expectedInnings, pitcherEnvironmentContext.whip
(not in that object's shape — deriveMlbPitcherEnvironmentContext returns kRate/gbRate/fbRate/velocity/workload/rest
only, :130-143). row.opposingPitcher set ONLY in external path (mergeMlbExternalContext.js:304).

## STEP 3 — Per-family (USED / WIRED-BUT-NOT-CONSUMED)

### MLB hits  (best-wired batter family)
USED: predictedProbability λ (buildMlbHitsProbabilityEngine.js:165,181), impliedTeamTotal (:170,183), battingOrder
(:171,182), powerScore (:185-188), batterStats.avg (:199-203), pitcherEnvironmentContext.kRate (:209-213, gated on
opposingPitcher resolved), handednessContext.platoonRelation (:215-217), batterL5/L15 hitsPerGame streak (:222-224),
opposingPitcherL3/L5 hitsPerStart inverted (:230-234), batterL5.kRate (:239-243), batterL5.hitStreak (:247-251),
mlbParkFactors[homeTeam].hitsFactor (:255-263, direct require), gameTotal (:265-267). Scorer reads
stats.hits.{ladder,mostLikely,floor,ceiling} (buildMlbPlayerDataset.js:160; mlbClassification.js:559-617).
WIRED-NOT-USED / CONSTANT: opposingPitcherWhip / pitcherEnvironmentContext.whip (read :204-208, never populated —
whip absent from shape); recentFormScore (read :190-193, never assigned). weatherContext/parkContext(namespaced)/
bullpenContext/mlbContextualShift/mlbContextualTags/isPlatoonAdvantage(top-level) set but engine uses
handednessContext.platoonRelation + direct JSON requires instead.

### MLB rbis
USED: impliedTeamTotal (buildMlbRbiProbabilityEngine.js:87,93-95), battingOrder (:88,98-103), **hard-depends on
hits projection hit1plus/hit2plus** (:106-111, returns null if missing), powerScore (:116-117), batterStats.slg
(:125-129), batterStats.hrRate (:130-134), platoonRelation (:141-143), batterL5/L15 slg streak (:147-150). Scorer
reads stats.rbis.{ladder={0.5:r1,1.5:r2},...} (buildMlbPlayerDataset.js:187).
WIRED-NOT-USED / CONSTANT: opposingPitcherWhip/pitcherEnvironmentContext.whip (:136-139 never populated);
recentFormScore (:120-121 never assigned); weatherContext/parkContext/pitcherEnvironmentContext.kRate/bullpenContext/
opposingPitcherL3/L5 never read by RBI engine.

### MLB hr  [operator-flagged: pitcher hand + park + weather]
USED: **batterHand × pitcherHand** (buildMlbHrPredictionCandidates.js:168-174 handednessBoost; :200-222
computeMatchupScore `if (pitcherHand !== batterHand) score += 1`); powerScore from mlbStatcastPower.json +
computeFallbackPowerScore (:349-365,380-386); predictedProbability (:376,380); edgeProbability (:224-228);
impliedTeamTotal (:176-188); battingOrder (:146-153); gameTotal (:184-186); **gameWeather[eventId] windOut/windIn/
temperature** (:400-416, direct require mlbGameWeather.json); batterL5/L15 hrPerGame streak (:422-429);
batterL15.hrInWindow burst (:434-438); **parkFactors[homeTeam].hrFactorByHand[L/R]→hrFactor** (:440-468, reads
batterHand). Scorer reads stats.hr.ladder={0.5:hrProb,1.5:hrProb²,2.5:hrProb³} (buildMlbPlayerDataset.js:176-180);
HR caps in modelProbForSide (mlbClassification.js:599,604-606).
WIRED-NOT-USED / **CONSTANT (the real HR gap)**: row.pitcherHrPer9 + row.pitcherFlyBallRate read in
computeMatchupScore/getPitcherHrRate/getPitcherFlyBallRate (:155-166,190-222) but ONLY ever inline defaults
1.2/0.35 (`row.pitcherHrPer9 ??= 1.2; row.pitcherFlyBallRate ??= 0.35` at :338-339) → HR-pitcher-contact signal is
a CONSTANT (1.2<1.4/1.1 thresholds → +0; 0.35<0.38/0.40 → +0), so "fly-ball-prone / high-HR/9 pitcher" reasons
effectively never fire. row.weatherContext/parkContext (namespaced) ignored (engine uses its own direct requires).
pitcherEnvironmentContext/bullpenContext/opposingPitcherL3/L5 never read. recentFormScore (:494,601) never populated.
NOTE: HR reads pitcher hand YES, park HR factor (per-hand) YES, weather YES; pitcherHand defaults "R" if absent (:340).

### MLB ks (pitcher strikeouts)  [operator-relevant: opp K-rate, pitcher rest]
USED: market λ + predictedProbability/impliedProbability/odds (buildMlbPitcherKsProbabilityEngine.js:107-150);
pitcherStats.kRate (:156-160); pitcherStats.whip (:161-165); weatherContext.isIndoor + temperature/temp (:167-174);
pitcherL3/L5.kRate streak (:181-185). Scorer reads stats.ks.ladder={4.5:k5,...,7.5:k8} (buildMlbPlayerDataset.js:262;
sharpest curve mlbClassification.js:454,470,501).
WIRED-NOT-USED / NOT-COLLECTED: pitcherEnvironmentContext (kRate/fbRate/restDays/fatigueFlag) — engine reads
pitcherStats.* instead, so env-context redundant/unused; bullpenContext/parkContext/mlbContextualShift unused.
NOTE: opposing-lineup K-rate = NO (reads only the pitcher's own kRate/whip/form). Pitcher form = YES (L3/L5 kRate).
Pitcher rest = NO (pitcherEnvironmentContext.restDays/fatigueFlag never read by the Ks engine).

### MLB outs (pitcher outs) — DEGENERATE CONSTANT
USED: pitcherObj.ipExpected/expectedInnings (buildMlbPlayerDataset.js:241-244) `outsMedian = ipExpected*3 else
default **17**`. Scorer reads stats.outs.{floor,mostLikely,ceiling} (:272; logistic sigma floor 1.6).
WIRED-NOT-USED: ALL context. ipExpected/expectedInnings NEVER populated → outs is a CONSTANT 17 (band ±5/+4) for
every pitcher. No bullpen/rest/form input.

### MLB hitsAllowed / earnedRuns (pitcher) — DERIVED FROM Ks
USED: deterministic inverse of eKs (buildMlbPlayerDataset.js:247 `hitsAllowedMedian = clamp(2,8,5.4-(eKs-6)*0.18)`;
:252 `erMedian = clamp(0.6,4.5,2.5-(eKs-6)*0.12)`). Only "signal" = whatever fed expectedKs.
WIRED-NOT-USED: pitcherStats.whip/era/hitsPerStart, pitcherL3/L5, weather, park — none read.

### MLB walks (pitcher) — DEGENERATE JITTER
USED: `walksMedian = clamp(0.5,4, 1.8 + (salt-0.5)*1.0)` (buildMlbPlayerDataset.js:257) — pure name-hash jitter.
WIRED-NOT-USED: pitcherStats.bbRate + pitcherL3.bbRate exist in cache/form, NEVER read. (Batter walks resolve to
null family → dropped.)

### MLB runs (batter runs scored)
USED: playerObj.teamImpliedTotal (buildMlbPlayerDataset.js:191-194 `p1run = clamp(.15,.55,.3+(teamRunsImplied-4.4)
*.04 + lineupBoost)`; teamImpliedTotal set from impliedTeamTotal by hits/rbi engines, buildMlbHitsProbabilityEngine.js:371);
battingOrder/lineupPosition (:152-153,192-193). Scorer reads stats.runs.ladder={0.5:p1run,...} (:199).
WIRED-NOT-USED: batterStats, batterL5/L15, powerScore, handedness, weather, park, opposing pitcher — none read.
Runs = lineup-spot + team-total heuristic only.

### MLB totalBases
USED: synthetic combiner in projectHitterStats (buildMlbPlayerDataset.js:163-170) — hrProb + hit1plus/hit2plus/
hit3plus + powerScore. Inherits hits-engine + HR-engine signals transitively; reads no fresh context.
WIRED-NOT-USED: batterStats.iso/xbhRate, park doublesFactor — not read.

### MLB batterKs (batter strikeouts) — DEGENERATE CONSTANT, WRONG FIELD
USED: playerObj.opposingPitcherKper9/opposingKsPer9 (buildMlbPlayerDataset.js:202 `eBatterKs = clamp(.4,2.0,
(oppKper9/9)*4.2)`) — NEVER populated → always default **8.5** → flat ~1.0 K projection + salt jitter (:204). Scorer
reads stats.batterKs.{floor,mostLikely,ceiling} (:215).
WIRED-NOT-USED: the REAL opposing-pitcher K-rate IS on the row (pitcherEnvironmentContext.kRate / pitcherStats.kRate)
but the projection reads a different, never-populated field name. ~15-min field swap would make it real.

### MLB Singles / Doubles / Stolen Bases / batter Walks — CLASSIFIED BUT DROPPED
resolveStatFamily returns null (mlbClassification.js:741-770) → `if (!family) continue` (:849) → never scored,
never persisted. Defined in classifier table only.

## Cross-cutting (UNVERIFIED flagged)
1. Two boards in mlbClassification.js: buildMlbPropClusters (narrow 4-field DISPLAY) vs buildMlbBestBetsBoard
   (projection-band, the PERSISTED scorer). Only the latter feeds tracked_bets.
2. Dead/constant signals on the tracked path: HR pitcher-contact (const 1.2/0.35); outs (const 17); walks
   (name-hash); batterKs (const 8.5); runs (lineup-only); recentFormScore + opposingPitcherWhip/
   pitcherEnvironmentContext.whip factors never fire.
3. Opposing-pitcher batter signals gated on row.opposingPitcher (external path only, mergeMlbExternalContext.js:304).
   UNVERIFIED what fraction of slate rows carry it at runtime.
4. isPlatoonAdvantage wired (applyMlbContextualLayers.js:411) + persisted (leanBet:805) but the tracked SCORER does
   NOT read it — platoon applied earlier inside engines via handednessContext.platoonRelation. It's a corpus/
   calibration tag, not a scorer input.
5. UNVERIFIED: whether mlbStatcastPower.json covers the current slate's batters (memory flags it possibly orphan);
   HR falls back to computeFallbackPowerScore when absent.
