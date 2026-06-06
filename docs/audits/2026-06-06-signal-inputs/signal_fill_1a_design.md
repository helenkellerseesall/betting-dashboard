# Phase Signal-Fill-1A — DESIGN DOC (read-only, no code yet)

Date: 2026-06-06. Operator approved signal-fill-before-line-aware. This doc specifies each fix in the 1A wave.
Calibration-LineAware-1A (#91 / task #17) is blocked behind this wave. No calibration changes here — wiring only.
predictionId untouched. One fence per fix. Operator approves THIS doc before any edit.

Source-data existence VERIFIED by re-reading caches on disk (2026-06-06):
- mlbPitcherStats.json (29 entries) has: inningsPitched, gamesStarted, battersFaced, strikeOuts, walks, hits,
  earnedRuns, homeRunsAllowed, kRate, bbRate, k9, whip, era, restDays. (Sample: Keider Montero — IP 66, GS 12,
  BF 264, HR-allowed 8, walks 16.)
- mlbParkFactors.json (30 parks) has: hrFactor, hrFactorByHand, hitsFactor, runsFactor, kFactor, doublesFactor.
- mlbBullpenWorkload.json (20 teams) has: fatigueScore, recentInnings, highLeverageUses, closerCandidate, ...

## STRUCTURAL REALITY (governs every fix)

Tracked picks are scored by the projection-BAND scorer (`buildMlbBestBetsBoard`), which reads only
`stats[family].{floor,mostLikely,ceiling,ladder}`. So a signal fix must land in the ENGINE/PROJECTION that
builds the band — NOT on the row (the scorer never reads the row). The band-building functions are:
- `projectHitterStats({playerObj,hrProb,salt})` (buildMlbPlayerDataset.js:144) — reads the batter `playerMap` obj.
- `projectPitcherStats({pitcherObj,salt})` (buildMlbPlayerDataset.js:219) — reads the `pitcherKsToday.topPitchers` entry.
The batter obj is finalized by the per-stat engines (hits engine `playerMap.set` at buildMlbHitsProbabilityEngine.js:376).
The pitcher entry is built by `buildPitcherRowFromPropRow` (buildMlbPitcherKsProbabilityEngine.js:~205-239) and
does NOT currently carry pitcherStats — so pitcher fixes need a pass-through added to that entry first.

**GATED vs UNGATED** (critical for rollout): "own-pitcher" stats (a pitcher prop's own pitcher) are always on
`r.pitcherStats` (the Ks engine already reads `r.pitcherStats.kRate` at :156) → UNGATED. "Opposing-pitcher"
stats (for a batter prop) are on `row.pitcherStats`/`pitcherEnvironmentContext` only when the opposing starter
RESOLVED (external path, mergeMlbExternalContext.js:304) — coverage UNVERIFIED at runtime → GATED. batterKs and
HR/9 are gated; walks and outs are ungated.

---

## FIX 1 — MLB walks (pitcher) · UNGATED · ~30 min  [ROLLOUT #1, proof-of-pattern]

1. FILES: buildMlbPitcherKsProbabilityEngine.js (entry build ~205-239, add pass-through) + buildMlbPlayerDataset.js:257 (formula).
2. FIELD: add `bbRate: toNum(r?.pitcherStats?.bbRate)` + `battersFaced: toNum(r?.pitcherStats?.battersFaced)` to
   the topPitchers entry. Source VERIFIED: mlbPitcherStats.json.bbRate (Montero 16/264 = 0.061). Then replace
   buildMlbPlayerDataset.js:257 `walksMedian = clamp(0.5,4, 1.8 + (salt-0.5)*1.0)` with
   `bbRate != null ? clamp(0.5,4, bbRate * expectedBF) : <current fallback>` where expectedBF ≈ ipExpected*4.3
   (or constant ~24 BF/start until outs lands).
3. PRE-EDIT PROBE: `node -e` over topPitchers → show walks projection for 3 pitchers is the SAME ~1.8±jitter
   (constant). → .scratch/last.txt.
4. POST-EDIT EXPECTATION (worked): Montero bbRate 0.061 × 24 BF = **1.46 walks** (was 1.8 const). A wild arm
   (bbRate 0.11) → 2.64. Projection now SEPARATES control pitchers from wild ones.
5. VERIFY: re-run the probe → walks projection now VARIES per pitcher + matches bbRate×BF. Non-zero spread across
   pitchers = wire fired (not just node started).
6. DEEP-DIVE downstream: walks salt-formula not read elsewhere (grep clean). bbRate add to entry is additive.
7. FENCE: own commit. Files: the two above.

## FIX 2 — MLB outs (pitcher) · UNGATED · ~30 min  [ROLLOUT #2]

1. FILES: buildMlbPitcherKsProbabilityEngine.js (entry ~205-239) + buildMlbPlayerDataset.js:241-244.
2. FIELD: add `inningsPitched`/`gamesStarted` (or precompute `ipPerStart = IP/GS`) to the topPitchers entry from
   `r.pitcherStats`. Source VERIFIED (Montero IP 66 / GS 12 = 5.5 IP/start). Then buildMlbPlayerDataset.js:241
   `ipExpected = num(pitcherObj?.ipExpected) ?? num(pitcherObj?.expectedInnings) ?? (ipPerStart from entry) ?? null`.
3. PRE-EDIT PROBE: show outs projection = **17 for every pitcher** (constant). → .scratch/last.txt.
4. POST-EDIT EXPECTATION (worked): Montero 5.5 IP/start → outsMedian = **16.5** (was 17). A 6.2-IP workhorse →
   18.6; a 4.8-IP short starter → 14.4. Projections now diverge per pitcher.
5. VERIFY: probe shows outsMedian VARIES per pitcher = wire fired.
6. DEEP-DIVE downstream — **FLAG**: `expectedInnings`/`ipExpected` is ALSO read at buildMlbPitcherCandidates.js:16
   (`row.expectedInnings || 5`). If I populate it on the row/entry, that path changes too. VERIFY buildMlbPitcherCandidates
   is not on the tracked-pick path (it's a 41-line helper) and that the change is an improvement (real IP vs default 5),
   not a regression, before commit. If risky, scope the new field to the topPitchers entry only (not row).
7. FENCE: own commit.

## FIX 3 — MLB batterKs (batter) · GATED · ~1h (field + FORMULA)  [ROLLOUT #3, run coverage probe first]

1. FILES: buildMlbHitsProbabilityEngine.js (obj write ~336-376, populate the field) + buildMlbPlayerDataset.js:202-203 (formula).
2. FIELD + FORMULA: the obj currently never sets `opposingPitcherKper9` → projectHitterStats:202 defaults 8.5 →
   `(8.5/9)*4.2 = 3.97` → clamp(0.4,2.0) → **2.0 for EVERY batter** (degenerate, AND the formula is miscalibrated —
   per-9 ÷9 ×4.2 is dimensionally wrong). FIX: set `obj.opposingPitcherKRate = toNum(r?.pitcherStats?.kRate) ??
   toNum(r?.pitcherEnvironmentContext?.kRate)` (per-PA K%, the right unit), then rewrite :203 to
   `eBatterKs = clamp(0.2, 2.2, expectedPA * oppKRate)` with expectedPA≈4.1. Source VERIFIED: pitcherStats.kRate.
   NOTE: use kRate (per-PA), NOT k9 — the old field name opposingPitcherKper9 was per-9 and is why the formula clamped.
3. PRE-EDIT PROBE: show batterKs = **2.0 for all batters** (clamped constant). → .scratch/last.txt.
4. POST-EDIT EXPECTATION (worked): batter vs high-K arm (kRate 0.30) → 4.1×0.30 = **1.23 Ks**; vs contact arm
   (kRate 0.18) → 0.74. Now varies by opposing pitcher (was flat 2.0).
5. VERIFY: probe shows batterKs VARIES by opposing pitcher; ALSO a COVERAGE probe — % of batter rows with
   resolved opposingPitcher (pitcherStats present). If coverage is low, the fix fires only for resolved rows
   (rest fall back) — report the % honestly.
6. DEEP-DIVE downstream: opposingPitcherKper9/opposingKsPer9 read ONLY at projectHitterStats:202 (grep confirmed)
   → safe to repurpose. GATING caveat: gated on opposing-pitcher resolution.
7. FENCE: own commit. **Pre-req**: run the coverage probe; if ~0% resolved, this fix is inert → move to 1B with
   the opposing-pitcher-resolution work.

## FIX 4 — MLB HR/9 (pitcher vulnerability) · GATED · ~30-60 min IF reachable  [ROLLOUT #4, verify reachability first]

1. FILES: buildMlbHrPredictionCandidates.js:338 (compute before the `??=` default).
2. FIELD: before `row.pitcherHrPer9 ??= 1.2`, compute `if (row.pitcherStats?.inningsPitched > 0) row.pitcherHrPer9 =
   (row.pitcherStats.homeRunsAllowed / row.pitcherStats.inningsPitched) * 9`. Source VERIFIED (Montero 8/66*9 = 1.09).
   Same for fly-ball if a GB/FB field exists (it does NOT in the cache → leave flyBall constant or defer).
3. PRE-EDIT PROBE: show row.pitcherHrPer9 = **1.2 for every HR row** + the matchup score contribution = +0 always.
4. POST-EDIT EXPECTATION (worked): vs Montero (HR/9 1.09 < 1.4 threshold) → +0 (control-ish). vs a homer-prone
   arm (HR/9 1.8 > 1.4) → +1 matchup point → HR projection rises ~5-8%; vs an ace (HR/9 0.7) → stays low. Homer-prone
   pitchers now rate HIGHER, aces LOWER (the operator's stated bettor-visible delta).
5. VERIFY: probe shows row.pitcherHrPer9 VARIES across HR rows + the matchup-score branch fires for homer-prone arms.
6. DEEP-DIVE / **REACHABILITY VERIFY FIRST**: buildMlbHrPredictionCandidates reads `input.rows` (snapshot HR rows);
   it currently reads row.pitcherHand but NOT row.pitcherStats. MUST verify the HR rows actually carry
   row.pitcherStats (opposing starter, gated on resolution). Probe: count HR rows with row.pitcherStats present.
   If absent (HR rows pre-context or opp unresolved) → HR/9 moves to 1B. flyBall has NO cache source → stays constant
   (note honestly; not fixable in 1A).
7. FENCE: own commit (only if reachability probe passes).

## FIX 5 — MLB runs OBP (batter) · UNGATED · ~half-day  [ROLLOUT #5]

1. FILES: buildMlbHitsProbabilityEngine.js (obj write, populate obj.obp) + buildMlbPlayerDataset.js:191-194 (runs prior).
2. FIELD: `obj.obp = toNum(r?.batterStats?.obp)` (own batter stat, on the row). Then :194 add an OBP term:
   `p1run = clamp(0.15,0.55, 0.3 + (teamRunsImplied-4.4)*0.04 + lineupBoost + (obp-0.32)*0.5)`. Source VERIFIED:
   batterStats.obp (applyMlbContextualLayers:137-154). Optional stretch: table-setter correlation (OBP of order
   spots ahead) — DEFER to 1B (needs lineup-aware modeling per operator).
3. PRE-EDIT PROBE: show runs prior uses ONLY team-total + lineup spot (two batters with same spot+total get the same p1run).
4. POST-EDIT EXPECTATION (worked): a .380-OBP leadoff hitter → +0.03 to p1run vs a .300-OBP hitter in the same spot.
5. VERIFY: probe shows p1run differs for two same-spot/same-total batters with different OBP.
6. DEEP-DIVE: runs prior not read elsewhere; obp add is additive.
7. FENCE: own commit.

## FIX 6 — NBA turnovers own-rate · UNGATED · ~1h  [ROLLOUT #6 · CORE FILE caution]

1. FILES: nbaModelSignals.js (rateZ family branch ~528-535).
2. FIELD: add a turnovers branch to rateZ reading `row.toRate` (set by nbaPlayerSeasonStatsCache.js:223). Currently
   rateZ only branches reb/ast/pra → turnovers rateZ is null → own TO-rate unconsumed.
3. PRE-EDIT PROBE: show turnovers prob ignores row.toRate (two players, same usage/form, different toRate → same prob).
4. POST-EDIT EXPECTATION: a high-TO player (toRate 3.5) projects higher TO than a low-TO player (1.2) at equal usage.
5. VERIFY: probe shows turnovers prob now responds to toRate.
6. DEEP-DIVE: nbaModelSignals.js is core cognition (not in PRESERVED.md tier-1, but load-bearing). The rateZ change
   is family-scoped (only the turnovers branch) — verify reb/ast/pra rateZ outputs UNCHANGED (regression probe on
   those families). predictionId untouched.
7. FENCE: own commit.

## FIX 7 — Unconsumed Tier-3 data  [ROLLOUT #7-9, smallest first]
- 7a PARK kFactor → MLB Ks (~1h): buildMlbPitcherKsProbabilityEngine apply `parkFactors[homeTeam].kFactor` to
  expectedKs. Source VERIFIED (mlbParkFactors.kFactor). Need homeTeam on the Ks row (has team/opponent/isHome).
- 7b PARK doublesFactor → MLB TB (~1h): projectHitterStats TB ladder, apply doublesFactor to tb2/tb3. Need homeTeam
  on the batter obj.
- 7c PITCHER rest → MLB outs/Ks (~1-2h): thread `r.pitcherStats.restDays` onto the topPitchers entry (like IP),
  apply a small fatigue adjustment (short rest → fewer outs/Ks). Source VERIFIED (pitcherStats.restDays).
- 7d BULLPEN workload → **DEFER to 1B** (recommend): bullpenContext is set but consuming it needs a design decision
  (which family — late-inning Ks? team runs? — and magnitude). Not a clean wire; treat as its own scoped sub-phase.
  (mlbBullpenWorkload.json has fatigueScore/recentInnings/closerCandidate per team — real data, just no obvious
  single read site.) Each of 7a/7b/7c its own fence.

---

## ROLLOUT ORDER (with reasoning)

Lead with UNGATED own-stat fixes (guaranteed to fire on the probe = cleanest proof-of-pattern + most bisectable),
then GATED opposing-pitcher fixes (need a coverage probe to confirm they fire), then heavier/fuzzier:

1. **walks** (ungated, cleanest, own bbRate always present) — proof-of-pattern.
2. **outs** (ungated, own IP) — but verify the buildMlbPitcherCandidates:16 downstream reader first.
3. **batterKs** (gated + formula fix) — run coverage probe; if ~0% opp-resolved, bump to 1B.
4. **HR/9** (gated + reachability verify) — run the pitcherStats-on-HR-rows probe; if absent, bump to 1B.
5. **runs OBP** (ungated own stat).
6. **NBA turnovers** (core file — regression-probe reb/ast/pra unchanged).
7. **park kFactor → Ks**, 8. **park doublesFactor → TB**, 9. **pitcher rest → outs/Ks**.
(BULLPEN → recommend 1B.)

Why ungated first: the operator wanted batterKs+walks as the proof pair, but batterKs is gated on opposing-pitcher
resolution AND needs a formula fix, so its probe might show "no change" if coverage is low — a noisy first signal.
walks/outs are own-pitcher stats always present in the cache, so their probes will show a crisp constant→varies
delta every time. Lead with those; batterKs/HR-9 follow once their coverage/reachability probes confirm they fire.

## DISCIPLINE (every fix)
- One fence per fix (bisectable). Plain triple-backtick, no language tag, no `!`. Specific files in git add, no -A.
  Hook on, no --no-verify. Probe → .scratch/last.txt + cat.
- Each fence: pre-edit probe captured → edit → post-edit probe in the SAME fence proving constant→varies → commit.
- Update OPERATOR_SESSION_LOG after each fix ships (fresh post-compaction anchor).
- DEEP-DIVE before each: confirmed downstream readers above (opposingPitcherKper9 single-reader OK; ipExpected has
  a 2nd reader at buildMlbPitcherCandidates:16 — verify; rateZ change family-scoped — regression-probe siblings).
- PRESERVED.md tier-1 untouched. nbaModelSignals.js is load-bearing — flag, regression-probe siblings.

## BETTOR-VISIBLE DELTAS to flag in each post-ship recap (operator spot-checks dashboard)
- After outs: pitcher-outs picks DIVERGE per pitcher (no longer all ~17).
- After walks: pitcher-walks picks reflect real control (low-bbRate arms project fewer).
- After batterKs: batter-K picks factor the opposing pitcher's real K%.
- After HR/9: HR picks vs homer-prone pitchers rate HIGHER, vs aces LOWER.

## OUT OF SCOPE (→ Signal-Fill-1B, need new data derivation)
NBA points PvD + pace (#4), MLB Ks opposing-lineup K-rate (#5), NBA assists opp signal (#7), bullpen consumption
(7d), HR fly-ball rate (no cache source), batterKs/HR-9 if coverage probes show opp-pitcher unresolved.

NO CODE CHANGED. Operator approves this doc → ship FIX 1 (walks) first with pre/post probe in one fence.
