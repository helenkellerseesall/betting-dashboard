# NBA Prop-Family Signal Wiring — FACTUAL MAP (sub-agent pass, READ-ONLY)

Phase Signal-Inputs-Audit-1A · 2026-06-06. Forensic map of what the NBA pick code actually reads vs what is
wired-but-unused. file:line + snippets. UNVERIFIED items flagged. No judgment layer here (see synthesis.md).
Four linchpin claims independently spot-checked by hand against current code and confirmed.

## STEP 1 — Pick-origin finding

Persisted picks (`tracked_bets` / `nba_tracked_best`) come from `board.allPlays`, assembled in
`buildNbaOpportunityBoard.js` as the union of THREE independently-scored origins, each reading a different field set:

- **Origin A — `buildNbaBestBetsBoard`** (buildNbaBestBetsBoard.js:403). Projection-band scorer. Reads ONLY
  `pred.stats[family]` = {floor, mostLikely, ceiling, bestBet} plus market line/side/oddsAmerican/statFamily.
  Its probability math (`modelProbForSide`, buildNbaBestBetsBoard.js:187) consumes NO contextual row fields —
  only the three band numbers + line + a per-family calibration factor. Families: points, threes, rebounds,
  assists, pra, points_rebounds, points_assists, rebounds_assists.
- **Origin B — `buildNbaSnapshotCandidates`** (buildNbaSnapshotCandidates.js:60), merged into allPlays at
  buildNbaOpportunityBoard.js:314-324 (Lane A3). Row z-score scorer → `nbaRowModelProbability`
  (nbaModelSignals.js:860) DOES read the rich enrichment fields. Covers ALL families incl DD/TD/steals/blocks/
  turnovers/combos.
- **Origin C — `buildNbaFirstBasketEngine` + `buildNbaDefensiveProps`**, merged at buildNbaOpportunityBoard.js:
  355-432 (Lane A5). Dedicated bottom-up engines. Cover first_basket, steals, blocks.

The `pred.stats` band Origin A consumes is built upstream in `buildNbaPlayerOutcomePredictions.js`, then
everything except {floor, mostLikely, ceiling, bestBet} is stripped by `toPublicStats`
(buildNbaPlayerOutcomePredictions.js:1319/:2031). So for Origin A every context field is consumed (or not)
inside the projection builder, NOT in the board scorer. Most `nbaModelSignals.js` rich-field reads are reachable
only via Origin B + the projection-builder's own `weightedLineCore` (buildNbaPlayerOutcomePredictions.js:1134).
`leanBestEntry` (buildNbaPerformanceTracking.js ~315-390) PERSISTS opponent/oppDef/pace/shots/astRate/rebRate/
recentForm/roleContext/restContext/homeAwaySplit/gameContext for FE+audit — independent of whether any scorer read them.

## STEP 2 — Field-setter reference (what gets wired onto rows)

- `row.recentForm{last5_avg,last10_avg,baseline,sample_count,days_since_last_game,source}`, `row.last5Avg`,
  `row.last10Avg` — nbaRecentFormCache.js:337-348
- `row.dd/tdHitRateL5/L10/Season`, `row.dd/tdSampleL5/L10` — nbaRecentFormCache.js:430-439
- `row.starterFlag`, `row.projectedMinutes`, `row.restMinutesAdjustment`, `row.gameContextMinutesAdjustment`,
  `row.roleContext` — nbaRoleContextDeriver.js:219-220,251,264,282,286
- `row.teammateContext`, `row.teammateRedistShift` — nbaTeammateContextDeriver.js:339,382,384
- `row.marketContext`, `row.marketShift` — nbaMarketContextDeriver.js:206,220,221
- `row.playerStatus`, `row.availabilityContext`, `row.availabilityShift` — nbaAvailabilityCache.js:126,127,149
- `row.restContext{daysSinceLastGame,isBackToBack,lastGameDate,...}` — nbaRestCache.js:115
- `row.homeAwaySplit`, `row.homeAwayMultiplier` — nbaHomeAwaySplits.js:122,123
- `row.gameContext` (+ minutes multiplier consumed in roleContext) — nbaGameContextCache.enrichRowWithGameContext
  (called buildNbaSnapshotCandidates.js:173); weight logic nbaGameContextWeight.js
- `row.opponentDvP`, `opponentDvPForRole`, `opponentThreePAAllowedForRole`, `opponentThreePAMultiplier`,
  `opponentReboundsAllowedForRole`, `opponentReboundsMultiplier`, `opponentStealsAllowedForRole`,
  `opponentStealsMultiplier`, `opponentBlocksAllowedForRole`, `opponentBlocksMultiplier`, `oppDef`, `pace`,
  `opponentStats{pointsAllowed,reboundsAllowed,assistsAllowed,threePAAllowed,threePMAllowed,defensiveRating,
  pace,fgPct,threePointPct}` — nbaTeamStatsCache.js:133-150,164-196,217,221,232,238,241-251
- `row.shots,astRate,rebRate,usage,turnovers,toRate,playerSeasonStats`, (combo) recentForm —
  nbaPlayerSeasonStatsCache.js:208,219-224,227
- `row.team,opponent,opponentTeam,eventPace,pace,gameTotal,spread,gameSpread,moneylineHomeOdds,
  moneylineAwayOdds,vsGlass,vsPerimeter` — nbaEventTeamResolve.js:299-303,310-317,400-417,458-468,583-602
- `matchupAdj` (computed, consumed at nbaModelSignals.js:700) — nbaMatchupIntelligence.computeMatchupAdjustmentFromRow

## STEP 3 — Per-family (USED / WIRED-BUT-NOT-CONSUMED)

Families generated (nbaPropLanes.js:5-9 + classifiers + engines): points, threes, rebounds, assists, pra,
points_rebounds, points_assists, rebounds_assists, double_double, triple_double, steals, blocks, turnovers,
first_basket (first_team_basket lane key exists, no engine).

### NBA points
USED (Origin A band): pred.stats.points.{mostLikely,floor,ceiling} (buildNbaBestBetsBoard.js:449,167-168);
mp.line/side/oddsAmerican (:439-441); per-family calibration (:472). Band built from: recentForm via
predictedMedianOutcome (nbaAiOutcomeRange.js:129-139, consumed buildNbaPlayerOutcomePredictions.js:1342);
usageRate/projectedMinutes (:1339-1351, `raw += (usage-22)*0.35 + (minutes-28)*0.12`); homeAwayMultiplier
(:1354-1355); dynamic usage/minutes multipliers folding form/matchupAdj/oppDef/pace/total/spread (:1790-1793).
USED (Origin B): usage,shots,astRate,rebRate,minutes,role (nbaModelSignals.js:243-248); recentForm formZ w0.50
(:344-385,511); pace,total,spread,oppDef ctx (:258-264,538-545); familySpecificOppZ null for points → generic
oppDef PPG (:321-322,522); shifts teammateRedist/market/availability + matchupAdj (:663,675,684,700).
WIRED-NOT-USED: opponentThreePA/Rebounds/Steals/BlocksMultiplier (nbaTeamStatsCache.js:150,165,180,196 — points
applies none); restContext/gameContext/homeAwaySplit OBJECTS (consumed only as a minutes multiplier inside
roleContext; objects persisted-only); playerSeasonStats/opponentStats blocks (only leaves read; opponentStats
only via familySpecificOppZ = null for points). NOTE: Origin A points O/U prob is BLIND to all context.

### NBA threes
USED (band, richest): threePA (buildNbaPlayerOutcomePredictions.js:383,1157), 3P% (:388-401,1160),
**opponentThreePAMultiplier** (:1169-1171, `raw = pa*pct*minutesFactor*oppShotVolMul`), recentForm anchor
(:1190-1193), usage/minutes/archetype/position (:1153-1158,456-464). Origin B: threes usage0.24/shots0.30
(nbaModelSignals.js:389); familySpecificOppZ reads opponentStats.threePMAllowed (:293-298).
WIRED-NOT-USED: rebounds/steals/blocks opp multipliers (nbaTeamStatsCache.js:165,180,196); restContext/
gameContext/homeAwaySplit objects. NOTE: threes band does NOT apply homeAwayMultiplier (projectThreesFromAttempts,
no hAwayMul). Only continuous family whose band consumes a per-stat opp multiplier.

### NBA rebounds
USED (band): recentForm anchor (buildNbaPlayerOutcomePredictions.js:1367-1370), **opponentReboundsMultiplier**
(:1378-1379 `raw *= oppRebMul`), homeAwayMultiplier (:1381-1382), usage/minutes/archetype/position+market blend
for bigs (:1369-1374). Origin B: rebRate0.16/form0.55 (nbaModelSignals.js:386,529); familySpecificOppZ reads
opponentStats.reboundsAllowed (:299-304).
WIRED-NOT-USED: opponentThreePA/Steals/BlocksMultiplier; restContext/gameContext objects.

### NBA assists
USED (band): recentForm anchor (buildNbaPlayerOutcomePredictions.js:1391-1394), homeAwayMultiplier (:1400-1401),
usage/minutes/archetype+market blend (:1396-1398). Origin B: astRate0.18/form0.55 (nbaModelSignals.js:387,508,
530); familySpecificOppZ reads opponentStats.assistsAllowed (:305-310).
WIRED-NOT-USED: **NO opponentAssistsMultiplier is wired at all** (none exists in code); restContext/gameContext
objects; opponentReb/ThreePA/Stl/Blk multipliers (unused for assists).

### NBA pra + points_rebounds / points_assists / rebounds_assists
USED (band): composite = SUM of component bands (buildNbaPlayerOutcomePredictions.js:1998-2028, `praMostLikely =
points.mostLikely + rebounds.mostLikely + assists.mostLikely`); board reads summed band+line (buildNbaBestBetsBoard.js:449);
composite sigma/zScale/shrink (:76-78,95-97,119-121,158-160). Inherits component consumption. Origin B: routes to
"pra" usage0.20/form0.24 (nbaModelSignals.js:388); familySpecificOppZ blends reboundsAllowed+assistsAllowed
(:311-320). NOTE: the three 2-stat composites are collapsed to "pra" by classifyPropFamily in Origin B
(nbaModelSignals.js:142-145); distinct handling exists ONLY in Origin A; base scorer's lineAnchorByFamily notes
them "unreachable" there (:210-215).
WIRED-NOT-USED: opponentThreePA/Steals/Blocks multipliers; restContext/gameContext objects.

### NBA double_double / triple_double
USED: **binary hit-rate branch ONLY** — ddHitRateL5/L10/Season (or td*) blended 0.55/0.30/0.15
(nbaModelSignals.js:454-456,467-469); pace, gameTotal/total, gameSpread/spread minor adj ±0.05 (:478-486); side
yes/no inversion (:490-491). Hit rates set nbaRecentFormCache.js:430-439. No Origin-A band (dropped at
buildNbaBestBetsBoard.js:450, `if (!stat) continue`).
WIRED-NOT-USED: EVERYTHING else (usage/shots/astRate/rebRate/minutes/recentForm/oppDef/opponentStats/roleContext/
teammateRedistShift/marketShift/availabilityShift) — binary branch early-returns (nbaModelSignals.js:453-496)
before the z-score/shift machinery; all enrichment from buildNbaSnapshotCandidates.js:155-207 computed+persisted,
never read for DD/TD prob. Post-base shifts at :709 DO still apply to the binary result (UNVERIFIED whether they
meaningfully move a binary prob). specialsFromProjections (buildNbaPlayerOutcomePredictions.js:1514) computes
DD/TD flags into pred.specials notes only — NOT a tracked pick.

### NBA steals / blocks
USED (Origin C engine + Origin B): per-stat L5 getRecentForm(player,"steals"/"blocks") last5_avg/sample_count
(buildNbaDefensiveProps.js:247-266); position/archetype, projectedMinutes/minutes, usageRate, eventPace/pace
(:226-231); **opponentStealsMultiplier/opponentBlocksMultiplier** (:275-281); market line/odds/side (:349-360).
Origin B: bands [0.10,0.85], anchors steals1.0/blocks0.6 (nbaModelSignals.js:190-196,222-223); familySpecificOppZ
has NO steals/blocks branch → generic oppDef (:286-322).
WIRED-NOT-USED: opponentThreePA/Rebounds multipliers; restContext/gameContext/homeAwaySplit objects. NOTE: market
player_steals/blocks rows are usually absent from ingest, so Origin C often produces 0 plays; these mostly reach
allPlays via Origin B (generic oppDef).

### NBA turnovers
USED: Origin B only — classifyPropFamily→"turnovers" (nbaModelSignals.js:133), band [0.10,0.85] anchor2.0
(:190-196,223), generic z-score (usage/shots/form/minutes/ctx).
WIRED-NOT-USED / NOT-CONSUMED: row.turnovers/toRate SET (nbaPlayerSeasonStatsCache.js:223-224) but **scorer has
no turnovers rate-wire** (rateZ only branches reb/ast/pra — nbaModelSignals.js:528-535) → own turnover rate
unconsumed; no turnovers branch in familySpecificOppZ → opponent-TO-forced unused. UNVERIFIED that toRate was
intended as the turnovers rate signal (no code path reads it as such).

### NBA first_basket
USED: Origin C engine — pred.stats.points.mostLikely + minutes per-possession (buildNbaFirstBasketEngine.js:
129-140); usageRate/playerUsage, projectedMinutes/minutes, position, team/opponent, gameSpread/spread (:250-277);
market first-basket oddsAmerican/odds (:325-331).
WIRED-NOT-USED: virtually all enrichment (recentForm/oppDef/opponentStats/astRate/rebRate/pace[uses spread only]/
roleContext/all opponent multipliers/restContext/gameContext/homeAwaySplit). NOTE: Origin A lists first_basket
in STAT_FAMILIES (buildNbaBestBetsBoard.js:35) only to PRESERVE market rows; the board never produces a
first_basket pick (no pred.stats.first_basket band).

## Cross-cutting (factual)
1. Three parallel scorers, near-disjoint inputs; Origin A ignores ALL row context in its O/U math.
2. Per-stat opp multipliers consumed unevenly: threes(band:1169), rebounds(band:1378), steals/blocks(engine:
   276,281). NO opponentAssistsMultiplier and NO opponentTurnoversMultiplier exist.
3. homeAwayMultiplier consumed only by projectStat (points/reb/ast bands:1354,1381,1400). NOT threes, NOT
   pra/composites except transitively, NOT Origin B.
4. restContext/gameContext/homeAwaySplit objects consumed only as a minutes multiplier in nbaRoleContextDeriver
   (:257-284 → projectedMinutes). Objects persisted (buildNbaPerformanceTracking.js:376-386), never read by any
   probability scorer.
5. DD/TD/first_basket have no Origin-A band (kept in STAT_FAMILIES only to preserve market rows).
6. DD/TD bypass the entire z-score/enrichment apparatus (early-return binary branch).
7. teammateRedistShift/marketShift/availabilityShift/matchupAdj consumed only in the Origin-B wrapper
   (nbaModelSignals.js:663-709). Origin A + engines never apply them.

UNVERIFIED: (a) whether the post-base shift wrapper meaningfully moves a DD/TD binary probability; (b) whether
row.toRate was intended as the turnovers rate signal.
