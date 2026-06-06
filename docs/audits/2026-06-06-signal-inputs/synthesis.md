# Phase Signal-Inputs-Audit-1A — per-prop-family signal inputs (READ-ONLY)

Date: 2026-06-06. No code changed. file:line refs verified against current code (4 linchpin
claims spot-checked by hand; rest from two forensic sub-agent passes over pipeline/nba + pipeline/mlb).
Comparison standard = cognition list in [[product-vision-iphone-pwa]]. Backlog = [[project-signal-unlocks-backlog]].

Three fix-scopes are kept distinct throughout:
- **USED** = the pick scorer (or the projection it scores) reads the field.
- **WIRED-NOT-USED** = a cache/context-layer sets it on the row, but the scorer never reads it for this family.
- **NOT-COLLECTED** / **CONSTANT** = the field is read with a fallback that is never populated → degenerate constant.

---

## THE LOAD-BEARING STRUCTURAL FACT (read this first)

Persisted/tracked picks (the CLV + grading corpus) are scored by a **projection-band scorer**, not by
the rich context layer:

- **NBA**: `buildNbaBestBetsBoard` `modelProbForSide` (buildNbaBestBetsBoard.js:187) reads ONLY
  `pred.stats[family].{floor,mostLikely,ceiling}` + the market line/side/odds. Its O/U math is **blind to
  every context field on the row.** Context only reaches a pick if the *projection builder*
  (`buildNbaPlayerOutcomePredictions`) folded it into that band first. (A second origin, the snapshot
  z-score scorer `nbaModelSignals.js:860`, DOES read the rich fields, and both land in `allPlays` — so the
  same player/family can be double-scored on different inputs.)
- **MLB**: `buildMlbBestBetsBoard` (markets/mlbClassification.js:810) scores `pred.stats[family].{floor,
  mostLikely,ceiling,ladder}` and persists via `buildMlbOpportunityBoard.js:379→400 persistTrackedToday`.
  It reads NO context field directly. Context reaches a pick only if a per-stat ENGINE folded it into the
  projection. (The "only 4 fields" memory — predictedProbability/impliedTeamTotal/lineupPosition/
  isPlatoonAdvantage — describes the SEPARATE `buildMlbPropClusters` DISPLAY board, NOT the tracked-pick
  origin. `project_pick_origin_architecture` memory is stale on this.)

**Consequence:** a signal can be collected, cached, and wired onto the row, and STILL never touch a pick —
because the band scorer doesn't read rows, and the engine that builds the band didn't fold it in. Most of
this audit's gaps are exactly that: shipped-but-unconsumed, or read-from-a-never-populated-field (constant).

---

# NBA

### NBA points
USED: band built from `recentForm.baseline/last5/last10` (nbaAiOutcomeRange.js:129-139), `usageRate`+
`projectedMinutes` (buildNbaPlayerOutcomePredictions.js:1339-1351), `homeAwayMultiplier` (:1354-1355), and
usage/minutes dynamic multipliers folding form/matchupAdj/oppDef/pace/total/spread (:1790-1793). Origin-B
z-scorer reads usage/shots/astRate/rebRate/minutes/recentForm/oppDef (nbaModelSignals.js:243-264,344-385).
WIRED-NOT-USED: `opponentThreePA/Rebounds/Steals/BlocksMultiplier` (nbaTeamStatsCache.js:150-196 — none apply
to points), `restContext`/`gameContext`/`homeAwaySplit` objects (consumed only as a minutes multiplier
inside roleContext, never read as objects), `opponentStats` block (only generic oppDef PPG used for points).
SHOULD MATTER (cognition list): **matchup dynamics — player-vs-defender (PvD)** [operator-flagged]: a guard
scoring on points is gated by the specific defender/scheme, not team PPG-allowed; **pace** [operator-flagged]:
more possessions = more shot attempts = higher points line value; usage, minutes, role, injuries (teammate
out → usage spike), variance/archetype.
GAP: points has **no opponent-matchup multiplier at all** (unlike threes/rebounds which have per-stat opp
multipliers). It uses team-generic `oppDef` only via Origin B; Origin A (the tracked scorer) sees no opponent
signal. No PvD anywhere. Pace enters only indirectly (minutes), not as a possession→attempts scalar on the band.
SOURCE: PvD = derivable from nbaPlayerGameLogs + matchup assignments (hard — needs defender tracking, or a
proxy: opp position-defense + on-ball matchup heuristic). Pace = already on row (`row.pace`/`eventPace`,
nbaTeamStatsCache); just needs folding into the points band. Opp-points-allowed-by-position = extend
deriveNbaTeamDefensive (same pattern as the shipped opp-3PA/reb).
EFFORT: pace-into-points-band ~1-2h. opp-points-allowed-by-position multiplier ~half-day (mirror existing).
True PvD ~days (new matchup model).
BACKLOG: pace + PvD are **NEW to backlog** (operator named both). Opp-points-allowed is adjacent to the
shipped Tier-2 opp-allowed family but points specifically was never given one.

### NBA threes
USED (richest band): `threePA` (buildNbaPlayerOutcomePredictions.js:1157,383), 3P% (:1160), **`opponentThreePAMultiplier`**
(:1169-1171), recentForm anchor (:1190). Origin B reads `opponentStats.threePMAllowed` (nbaModelSignals.js:293-298).
WIRED-NOT-USED: rebounds/steals/blocks opp multipliers; `homeAwayMultiplier` (NOT applied to the threes band —
only points/reb/ast bands get it); rest/gameContext objects.
SHOULD MATTER: opp 3PA-allowed/pace (run-and-gun vs slow) [SHIPPED+USED], matchup (closeout quality), variance
(threes are high-variance → archetype tag).
GAP: home/away not applied to threes (a shooter's road 3P% drop is ignored on this band). Otherwise threes is
the **best-wired NBA family**.
SOURCE: homeAwayMultiplier already on row — fold into projectThreesFromAttempts.
EFFORT: ~30 min.
BACKLOG: Tier-2 #4 opp-3PA = **SHIPPED + CONSUMED**. home/away-on-threes = minor NEW.

### NBA rebounds
USED: recentForm anchor (:1367), **`opponentReboundsMultiplier`** (:1378), `homeAwayMultiplier` (:1381). Origin B
reads `opponentStats.reboundsAllowed` (nbaModelSignals.js:299-304).
WIRED-NOT-USED: other opp multipliers; rest/gameContext objects.
SHOULD MATTER: opp rebounds-allowed by size [SHIPPED+USED], pace (more misses = more boards), minutes, matchup
(opposing bigs out → board spike via injuries).
GAP: opponent-rebound context is team-level, not size/position-resolved on the band (Origin A uses the team
multiplier; the role-resolved `opponentReboundsAllowedForRole` exists but Origin A reads the generic one).
SOURCE: row already carries `opponentReboundsAllowedForRole` — use the role variant in the band.
EFFORT: ~1h.
BACKLOG: Tier-2 #5 = **SHIPPED + CONSUMED** (generic); role-resolved refinement is minor.

### NBA assists
USED: recentForm anchor (:1391), `homeAwayMultiplier` (:1400). Origin B reads `opponentStats.assistsAllowed`
(nbaModelSignals.js:305-310).
WIRED-NOT-USED: all opp multipliers (none apply).
SHOULD MATTER: **opp assists-allowed / defensive scheme**, teammate FG% (assists depend on teammates making
shots → correlation), pace, usage, injuries (primary creator out → assist redistribution).
GAP: **NO `opponentAssistsMultiplier` is wired at all** (the only single-stat family with zero opponent signal
on the band). Teammate-shotmaking correlation absent.
SOURCE: opp-assists-allowed = extend deriveNbaTeamDefensive (same pattern). Teammate FG% = nbaTeammateContext
already exists (teammateRedistShift) but feeds Origin B only.
EFFORT: opp-assists multiplier ~half-day. Teammate-correlation-into-band ~1-2 days.
BACKLOG: opp-assists-allowed = **NEW to backlog** (Tier 2 covered 3PA/reb/stl/blk but skipped assists).

### NBA pra + 2-stat composites (points_rebounds, points_assists, rebounds_assists)
USED: composite band = SUM of component bands (buildNbaPlayerOutcomePredictions.js:1998-2028), so it inherits
whatever points/reb/ast consumed. Composite-specific sigma tuning in Origin A (buildNbaBestBetsBoard.js:76-160).
WIRED-NOT-USED: same as components; in Origin B the three 2-stat composites are **collapsed to "pra"**
(nbaModelSignals.js:142-145) so they lose their distinct weighting there.
SHOULD MATTER: correlation between the summed stats (a high-usage night lifts pts AND ast together — variance
is NOT the sum of independent variances), matchup, minutes.
GAP: composites are modeled as **independent sums** — no joint correlation, so the band's variance is wrong
(too wide or too narrow). This is the Tier-4 #12 backlog item.
SOURCE: derivable from game logs (empirical covariance of the component stats per player/archetype).
EFFORT: ~days (correlation model + sigma adjustment).
BACKLOG: Tier-4 #12 joint-correlation = still valid, still DEFERRED.

### NBA double_double / triple_double
USED: **binary hit-rate branch only** — `ddHitRateL5/L10/Season` (nbaModelSignals.js:454-456) + minor
pace/total/spread adj (:478-486). Early-returns before the z-score machinery.
WIRED-NOT-USED: EVERYTHING else (usage/shots/recentForm/oppDef/opponentStats/roleContext) — the binary branch
bypasses it all (nbaModelSignals.js:453-496). No Origin-A band exists (dropped at buildNbaBestBetsBoard.js:450).
SHOULD MATTER: minutes (a DD needs floor minutes), role, injuries (blowout risk = bench early = no DD), pace.
GAP: DD/TD ignore minutes/role/injury entirely — scored purely on historical DD-rate + tiny game-env nudge.
SOURCE: minutes/role already on row; fold into the binary branch.
EFFORT: ~half-day.
BACKLOG: NEW (not in backlog).

### NBA steals / NBA blocks
USED: dedicated engine `buildNbaDefensiveProps` reads per-stat L5 (getRecentForm, :247-266), minutes/usage/pace
(:226-231), **`opponentStealsMultiplier`/`opponentBlocksMultiplier`** (:275-281). Origin B uses generic oppDef
(no steals/blocks branch in familySpecificOppZ).
WIRED-NOT-USED: irrelevant opp multipliers; rest/gameContext objects.
SHOULD MATTER: opp TOV-rate (steals) / opp rim-attempts (blocks) [SHIPPED+USED], minutes, matchup, variance
(both are very high-variance → archetype).
GAP: small — these are reasonably wired. Note the engine often produces 0 plays because the market rows are
sparse, so they mostly reach picks via Origin B (generic oppDef), losing the per-stat multiplier.
SOURCE: n/a (data shipped).
EFFORT: n/a for signal; the gap is market-row availability, not signal.
BACKLOG: Tier-2 #6/#7 = **SHIPPED + CONSUMED**.

### NBA turnovers
USED: Origin B generic z-score (usage/shots/form/minutes). No Origin-A band.
WIRED-NOT-USED / CONSTANT: `row.toRate`/`row.turnovers` ARE set (nbaPlayerSeasonStatsCache.js:223-224) but the
scorer has **no turnovers rate-wire** (rateZ only branches reb/ast/pra — nbaModelSignals.js:528-535), so the
player's own turnover rate is unconsumed. No opp-turnovers-forced signal.
SHOULD MATTER: usage (high-usage = more TO), opp pressure/TOV-forced, pace.
GAP: turnovers scored on usage+form only; its own TO-rate and opponent pressure both ignored.
SOURCE: toRate already on row (just wire it); opp-TOV-forced = same source as the shipped opp-TOV (#6).
EFFORT: ~1-2h.
BACKLOG: NEW.

### NBA first_basket
USED: dedicated engine — points.mostLikely + minutes + usage + position + spread (buildNbaFirstBasketEngine.js:129-277).
WIRED-NOT-USED: all standard enrichment.
SHOULD MATTER: tip-off/opening-possession role, coaching first-play tendencies, pace.
GAP: large, but operator-flagged LOW priority (market not actively bet — Tier-4 #14).
EFFORT: multi-hour+.
BACKLOG: Tier-4 #14 = still valid, still LOW.

---

# MLB

### MLB hits  (the best-wired MLB family)
USED: predictedProbability λ (buildMlbHitsProbabilityEngine.js:165), impliedTeamTotal (:170), batting-order
(:171), powerScore (:185), `batterStats.avg` (:199), opposing-pitcher kRate (:209, gated on opposingPitcher
resolved), platoon (:215), batterL5/L15 streak (:222), opposingPitcher form (:230), **park hitsFactor** (:255,
direct mlbParkFactors.json), gameTotal (:265).
WIRED-NOT-USED / CONSTANT: `opposingPitcherWhip` / `pitcherEnvironmentContext.whip` (read :204 but never
populated — whip absent from that object's shape), `recentFormScore` (read :190, never assigned).
SHOULD MATTER: opposing pitcher quality (K%, WHIP, contact), park, weather, platoon, lineup spot, form, BABIP-luck.
GAP: opposing-pitcher signals are gated on `row.opposingPitcher`, set ONLY in the external path
(mergeMlbExternalContext.js:304) — UNVERIFIED what % of slate rows carry it; if sparse, the K/WHIP/form factors
silently no-op. The WHIP factor can never fire (field shape mismatch).
SOURCE: opposingPitcher resolution = the external lineup feed (already exists, coverage unknown). WHIP = add to
pitcherEnvironmentContext shape (already in mlbPitcherStats.json).
EFFORT: WHIP-shape fix ~30 min; opposing-pitcher coverage audit ~1-2h.
BACKLOG: batter game logs (Tier-1 #1) = **SHIPPED + CONSUMED** (batterL5/L15). Vegas team total (Tier-1 #2) =
**SHIPPED + CONSUMED**. Park hitsFactor (Tier-3 #9) = **SHIPPED + CONSUMED**.

### MLB rbis
USED: impliedTeamTotal (buildMlbRbiProbabilityEngine.js:87), batting-order (:88), **hard-depends on the hits
projection** (:106-111, returns null without it), powerScore (:116), slg (:125), hrRate (:130), platoon (:141),
batterL5/L15 slg streak (:147).
WIRED-NOT-USED / CONSTANT: opposingPitcherWhip (:136 never populated), recentFormScore (:120 never assigned).
SHOULD MATTER: lineup spot + table-setters' OBP (RBI needs runners on — correlation with teammates ahead in
order), team total, power, opposing pitcher, park.
GAP: **no "runners on base" / table-setter OBP signal** — RBI opportunity is modeled via team-total + order
only, missing the correlation with the on-base skill of the 1-2 hitters ahead.
SOURCE: derivable from lineup + batterStats.obp of preceding order spots (data exists).
EFFORT: ~half-day (lineup-aware RBI opportunity).
BACKLOG: NEW (Tier-1 #2 team-total partially covers it, but the table-setter correlation is unmodeled).

### MLB hr   [operator-flagged: pitcher hand + park + weather]
USED: **batterHand × pitcherHand matchup** (buildMlbHrPredictionCandidates.js:168-222) ✓, powerScore from
Statcast (:349-365), impliedTeamTotal/order/gameTotal, **weather wind/temp** (:400-416, mlbGameWeather.json) ✓,
batterL5/L15 hr streak (:422), **park hrFactorByHand** (:440-468) ✓.
WIRED-NOT-USED / **CONSTANT (the real HR gap)**: `row.pitcherHrPer9 ??= 1.2` and `row.pitcherFlyBallRate
??= 0.35` (buildMlbHrPredictionCandidates.js:338-339) — these are read by the matchup score but **never
populated from real data**, so "fly-ball-prone pitcher" / "high HR/9 pitcher" reasons effectively never fire.
`recentFormScore` (read :494, never assigned).
SHOULD MATTER: pitcher hand [DONE], park [DONE], weather [DONE], **pitcher HR-vulnerability (HR/9, fly-ball/
GB rate, barrel-allowed)** [CONSTANT], batter barrel/power [DONE via Statcast].
GAP: the operator's three named inputs (hand/park/weather) are all **wired and consumed**. The actual hole is
**pitcher contact-quality**: HR/9 and fly-ball rate are hardcoded constants, so the model can't tell a
homer-prone arm from an ace.
SOURCE: HR/9 = derivable from mlbPitcherStats.json (homeRunsAllowed / IP — already cached, just not mapped onto
the row). Fly-ball/GB & barrel-allowed = statsapi or baseballsavant (new-ish feed).
EFFORT: HR/9-from-existing-cache ~1-2h (data is already there). Fly-ball/barrel ~1 day (new fetch).
BACKLOG: pitcher HR/9 = **NEW** (adjacent to Tier-3 #10 pitcher feeds but specifically HR-vulnerability was
never listed).

### MLB total bases
USED: synthetic combiner — hits ladder + HR prob + powerScore (buildMlbPlayerDataset.js:163-170). Inherits
hits-engine + HR-engine signals transitively.
WIRED-NOT-USED: reads no fresh context (no XBH rate, no doubles park factor).
SHOULD MATTER: extra-base power (ISO, doubles rate), park doubles factor, opposing pitcher.
GAP: TB has no `xbhRate`/doubles modeling beyond what hits+HR fold in; park `doublesFactor` (shipped in cfa00a7)
is **not consumed**.
SOURCE: batterStats.iso/xbhRate already cached; doublesFactor already in mlbParkFactors.json.
EFFORT: ~half-day.
BACKLOG: park doublesFactor SHIPPED-as-data but **unconsumed**.

### MLB runs (batter runs scored)
USED: teamImpliedTotal + batting-order lineupBoost ONLY (buildMlbPlayerDataset.js:191-194).
WIRED-NOT-USED: batterStats, form, power, handedness, weather, park, opposing pitcher — ALL ignored.
SHOULD MATTER: on-base skill (OBP — you score after reaching base), table-setter/teammate slugging behind you
(correlation), team total, park, lead-off role.
GAP: runs is a **lineup-spot + team-total heuristic** with no batter OBP and no teammate correlation.
SOURCE: batterStats.obp already cached; lineup already known.
EFFORT: ~half-day.
BACKLOG: Tier-1 #2 (team total) feeds it, but batter OBP + correlation = NEW.

### MLB ks (pitcher strikeouts)   [operator-relevant: opp K-rate, pitcher rest]
USED: market λ + predictedProbability (buildMlbPitcherKsProbabilityEngine.js:107-150), `pitcherStats.kRate`
(:156), `pitcherStats.whip` (:161), weather isIndoor/temp (:167-174), pitcherL3/L5 kRate streak (:181).
WIRED-NOT-USED / NOT-COLLECTED: `pitcherEnvironmentContext.restDays`/`fatigueFlag` (exist but never read by the
Ks engine), `bullpenContext`, park `kFactor` (shipped in cfa00a7, **unconsumed**).
SHOULD MATTER: **opposing-lineup K-propensity** (a high-strikeout offense inflates Ks) [MISSING], pitcher form
[DONE], **pitcher rest / pitch-count** [WIRED-NOT-USED], park, weather [DONE].
GAP: **no opposing-team K-rate input at all** — Ks is modeled purely on the pitcher's own skill/form, ignoring
who he's facing. Pitcher rest is on the row but unread. Park kFactor unread.
SOURCE: opp-team K% = derivable from team batting stats (new small cache or extend an existing team feed).
Rest = pitcherEnvironmentContext.restDays already on row.
EFFORT: opp-K-rate ~half-day (new team-K cache + wire). rest-into-Ks ~1-2h. park kFactor ~30 min.
BACKLOG: pitcher rest (Tier-3 #10) = data partially exists but **unconsumed**; opp-K-rate = **NEW**.

### MLB outs (pitcher outs)   — DEGENERATE CONSTANT
USED: `outsMedian = ipExpected*3 || 17` (buildMlbPlayerDataset.js:241-244) — `ipExpected`/`expectedInnings`
**never populated** → **constant 17 for every pitcher.**
WIRED-NOT-USED: everything.
SHOULD MATTER: expected innings (pitch-count limits, rest, recent IP trend, bullpen state, opponent lineup
length, blowout risk).
GAP: outs is a flat constant — no signal whatsoever. A pick on "over 17.5 outs" is identical for an ace and a
struggling 5-inning starter.
SOURCE: expected-innings = derivable from mlbPitcherGameLogs.json (recent IP trend) + gamesStarted/IP from
mlbPitcherStats.json (both already cached).
EFFORT: ~half-day (compute ipExpected from existing pitcher caches, wire onto row).
BACKLOG: pitcher pitch-count/rest (Tier-3 #10) = the data source for this; **never wired into outs.**

### MLB hitsAllowed / earnedRuns (pitcher) — DERIVED FROM Ks
USED: deterministic inverse of `eKs` (buildMlbPlayerDataset.js:247,252). Only "signal" = whatever fed Ks.
WIRED-NOT-USED: era, whip, hitsPerStart, bullpen, park — none read.
SHOULD MATTER: opponent offense quality, park, pitcher contact-management (WHIP, hard-hit allowed), bullpen
(for ER if pulled early).
GAP: these are formulas off the K projection, not models — no opponent/park/contact signal.
SOURCE: pitcherStats.whip/era + opp team OPS already/derivable.
EFFORT: ~half-day each.
BACKLOG: NEW (low frequency markets).

### MLB walks (pitcher) — DEGENERATE JITTER
USED: `walksMedian = 1.8 + (salt-0.5)*1.0` (buildMlbPlayerDataset.js:257) — pure name-hash jitter.
WIRED-NOT-USED: `pitcherStats.bbRate` + `pitcherL3.bbRate` BOTH exist in cache/form and are **never read.**
GAP: walks ignores the pitcher's actual walk rate (which is cached) in favor of a hash. ~5-minute wire.
SOURCE: pitcherStats.bbRate (already on row).
EFFORT: ~15 min.
BACKLOG: NEW (trivial).

### MLB batterKs (batter strikeouts) — DEGENERATE CONSTANT, wrong field
USED: `eBatterKs` from `opposingPitcherKper9`/`opposingKsPer9` (buildMlbPlayerDataset.js:202) — **never
populated → constant default 8.5** → flat ~1.0 K projection + jitter.
WIRED-NOT-USED: the **real opposing-pitcher K-rate IS on the row** (`pitcherEnvironmentContext.kRate` /
`pitcherStats.kRate`) but the projection reads a *different, never-populated* field name.
GAP: a 5-minute field-name swap would turn a constant into a real opposing-pitcher-K signal. Highest
ROI-per-effort gap in the audit.
SOURCE: already on the row.
EFFORT: ~15-30 min (read the populated field).
BACKLOG: NEW (trivial, high-ROI).

### MLB Singles / Doubles / Stolen Bases / batter Walks — CLASSIFIED BUT DROPPED
`resolveStatFamily` returns null (mlbClassification.js:741-770) → `if (!family) continue`
(mlbClassification.js:849) → never scored, never persisted. Defined in the classifier table only.

---

# CONSOLIDATED

## Top 10 highest-impact gaps  (severity × engine-frequency × 1/effort)

1. **MLB batterKs reads a never-populated field while the real signal sits on the row** — constant→real,
   ~15 min. (degenerate, trivial) — buildMlbPlayerDataset.js:202.
2. **MLB outs = constant 17** (ipExpected never computed) — a whole market is pure noise; data exists in
   pitcher caches. ~half-day. buildMlbPlayerDataset.js:241.
3. **MLB HR pitcher-vulnerability is a constant** (HR/9 & fly-ball hardcoded 1.2/0.35) — HR is high-frequency;
   HR/9 derivable from the cached pitcher stats. ~1-2h. buildMlbHrPredictionCandidates.js:338.
4. **NBA points has no opponent matchup on the tracked band + no pace scalar** (PvD/pace, operator-flagged) —
   highest-frequency NBA family, scored context-blind by Origin A. pace ~1-2h, opp-pts-allowed ~half-day.
5. **MLB pitcher Ks has no opposing-lineup K-rate** — high-frequency pitcher prop modeled only on the pitcher's
   own skill. ~half-day.
6. **MLB walks ignores cached bbRate (name-hash jitter)** — trivial wire, ~15 min. buildMlbPlayerDataset.js:257.
7. **NBA assists has zero opponent signal** (no opponentAssistsMultiplier wired) — ~half-day.
8. **MLB runs = lineup+team-total only** (no batter OBP, no table-setter correlation) — ~half-day.
9. **NBA turnovers ignores its own cached TO-rate** + no opp-pressure — ~1-2h.
10. **Shipped-but-unconsumed Tier-3 data**: park kFactor/doublesFactor, bullpen workload (12KB, real data),
    pitcher rest — all collected and on the row, read by nobody. Wiring-only, ~hours each.

## Backlog reconciliation vs [[project-signal-unlocks-backlog]]

SHIPPED + CONSUMED (verified via git log + agent maps):
- Tier-1 #1 MLB batter game logs (881fde5; batterL5/L15 used by hits/rbi). 
- Tier-1 #2 Vegas team totals on MLB rows (efd4a5b; used by hits/rbi/runs).
- Tier-2 #4 opp-3PA (threes band), #5 opp-rebounds (rebounds band), #6 opp-TOV→steals, #7 opp-rim→blocks
  (c997512 deriveNbaTeamDefensive; multipliers consumed).
- Tier-3 #8 home/away splits (94f8edc) — but consumed ONLY by points/rebounds/assists bands, **NOT threes**
  and NOT Origin B.
- Tier-3 #9 park L/R (cfa00a7) — hrFactorByHand (HR) + hitsFactor (hits) CONSUMED; **kFactor/runsFactor/
  doublesFactor SHIPPED-NOT-CONSUMED.**

SHIPPED-AS-DATA but NOT CONSUMED:
- Tier-3 #11 bullpen workload (3a06935/c6202bd; file is now 12KB real data, was {}) — `bullpenContext` on row,
  read by no scorer.
- Tier-3 #10 pitcher rest/pitch-count — `pitcherEnvironmentContext.restDays/fatigueFlag` on row, read by no
  engine (Ks/outs ignore it).

PARTIAL:
- Tier-1 #3 NBA rest/B2B — `nbaRestCache` ships `restContext`, but it's consumed only as a minutes multiplier
  inside roleContext; the standalone rest signal isn't read by any probability scorer.

STILL DEFERRED (valid): Tier-4 #12 joint correlation (NBA composites + MLB TB/runs all need it), #13 true-3PA-L5,
#14 first-basket.

MISSING FROM BACKLOG ENTIRELY (new, surfaced here): opp-assists-allowed (NBA), pace-into-points-band + PvD (NBA,
operator-flagged), opp-team-K-rate (MLB Ks), pitcher HR/9-vulnerability (MLB HR), batterKs field-swap, walks
bbRate-wire, outs expected-innings, RBI/runs table-setter-OBP correlation, NBA turnovers own-rate wire.

## RECOMMENDATION — signal-fill FIRST, then line-aware calibration (not "depends")

**Ship a focused signal-fill wave before Calibration-LineAware-1A.** Reasoning, concretely:

The dampener is a per-(family[,side,line]) MULTIPLIER on the model's stated probability. It can only scale a
distribution that already has real per-pick variation. Several families currently emit a **constant or near-
constant** stated probability — MLB outs (always 17), batterKs (always ~1.0), walks (name-hash), HR pitcher-
contact (constant), runs (lineup-only). Calibrating a constant is meaningless: line-aware or not, the dampener
can only shift the whole family uniformly, which is just "trust this family less" — it can't separate a good
pick from a bad one *inside* the family because the model gave them the same number. Worse, if you calibrate
now and fix the signal later, the dampener has "learned" a correction against noise that becomes invalid the
moment the signal is real — you pay the calibration cost twice.

The cheapest fixes are also the most degenerate: batterKs (~15 min, real signal already on the row), walks
(~15 min, cached bbRate), HR/9 (~1-2h, cached), outs expected-innings (~half-day, cached). That's roughly **1-2
days** to convert five noise-emitting families into real-signal families using data that is *already collected*
— no new feeds. Do that first.

The rich-signal families (hits, HR park/weather/hand, threes, rebounds) do NOT need to wait — but since
line-aware is a single phase, sequencing the cheap signal-fill ahead of it costs ~2 days and ensures the
un-frozen dampener calibrates against signal that actually varies per pick. **Sequence:** (1) Signal-Fill-1A —
the "already-on-the-row / already-cached" wires (items 1,2,3,6,9 + the unconsumed Tier-3 data), ~2-4 days, zero
new feeds; (2) Calibration-LineAware-1A against the now-complete signal; (3) the deeper NEW-feed gaps (PvD,
opp-K-rate, barrel-allowed) as a later wave. This also de-risks line-aware: you won't be debugging "why is the
dampener doing nothing for outs" when the answer is "outs is a constant."

Counter-consideration (stated honestly): line-aware is independently BLOCKED on the dampener join (#91 /
Calibration-LineAware-1A), and signal-fill does NOT unblock it. If the join work is the long pole, both can run
in parallel — but if sequencing one, signal-fill first is correct because it's cheaper, unblocks itself, and
prevents calibrating noise.

---
NO PATCHES PROPOSED. predictionId untouched. Calibration math untouched. /status untouched. Nothing deleted.
Operator decides: signal-fill wave before line-aware, or line-aware first.
