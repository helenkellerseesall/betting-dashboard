# NBA ECOLOGY CONSTITUTION AUDIT
**Session Z — Full NBA Intelligence Architecture Audit**
_Generated: 2026-05-09 | Scope: All 5 NBA slip builders, prediction engine, ranking systems, volatility routing, shared path integration_
_Model: claude-sonnet-4-6 | Adaptive Thinking: ON_

---

## EXECUTIVE SUMMARY

NBA outputs feel emotionally dead, ladders are weak, role spikes fail to surface, and aggressive lanes feel safe because **the NBA system has two disconnected execution paths that were never reconciled**. The workstation (what bettors see) uses a shared MLB-calibrated slip builder on NBA candidates that have been scored by a realismScore-dominant model that is 70% opportunity-weighted. The NBA-specific slip builders — with correlation stacks, aiRange resolution, and eruption logic — run in the nightly pipeline and write to files, but they are architecturally disconnected from the live workstation rendering. The result is a system where the sophisticated NBA intelligence never reaches the bettor surface.

---

## 1. NBA ECOLOGY HEALTH SCORE

| Dimension | Score | Rationale |
|---|---|---|
| **Candidate scoring philosophy** | 4.0 / 10 | realismScore = 70% of finalWeight. Stars dominate. Edge is 10%. Role spikes can't break through. |
| **Slip architecture** | 3.5 / 10 | 5 builders with no designated canonical path. Workstation uses shared MLB builder. NBA-specific builders produce orphan output. |
| **Volatility classification** | 4.5 / 10 | PRA always aggressive (wrong). Lotto structurally empty. No offensive eruption tier. NBA threes trap issue known. |
| **Ladder system** | 5.0 / 10 | aiRange logic is sophisticated but requires alt lines. Workstation gates alt lines out. Resolution silently degrades. |
| **Role-spike detection** | 2.5 / 10 | Form/usage adjustments ±14-25% max but star realismScore advantage is ~33%. Spikes can't surface. |
| **Correlation logic** | 2.0 / 10 | Exists only in DynamicSlipEngine. Workstation uses shared builder with zero correlation. |
| **Ecology tier separation** | 2.0 / 10 | No NBA equivalent of ELITE/STRONG tier from MLB buildMlbPropClusters. Stars inherit ELITE by usage, not edge. |
| **Offensive eruption detection** | 1.5 / 10 | No equivalent to HR candidate ecosystem. contextScore = 5% of finalWeight. No eruption environment tier. |
| **First basket ecosystem** | 2.0 / 10 | Routes built but workstation disconnected. Shared slip builder has no first basket routing. |
| **Emotional/bettor-realistic upside** | 2.5 / 10 | Ceiling resolution degrades to base lines when alt lines absent. DynamicSlipEngine ceiling ≠ true bettor upside. |

**Overall NBA Ecology Health: 2.9 / 10**

This is not a calibration problem. This is a philosophical architecture problem. The NBA system was built by layering intelligence on top of a star-biased opportunity model without building the ecology separation layer that makes MLB work.

---

## 2. TOP NBA ECOLOGY FAILURES

### FAILURE 1 — The Two-Path Disconnect (CRITICAL)

**What happens**: NBA has two completely separate execution paths that never share output.

**Path A — Nightly Pipeline** (produces `nba_tracked_bets_*.json`):
```
fetchNbaOddsSnapshot
→ nbaOpportunityCandidates.ladderCandidateFromRow()
→ buildNbaOpportunityBoard (coreCandidates / ladderCandidates / praCandidates / comboCandidates)
→ buildNbaAiPicks() → elite / strong / fades
→ buildNbaAiSlips() → SAFE / BALANCED / AGGRESSIVE / LOTTO (via aiRange)
→ buildNbaDynamicSlipEngine() → SAFE_CLUSTER / EV_CLUSTER / UPSIDE_CLUSTER / CASHOUT_CLUSTER
→ buildNbaSlipComposer() → safe / balanced / aggressive / lotto (via bestBetsBoard)
→ buildNbaSlipEngine() → 4-6-leg random-weighted bundles
→ writes: nba_tracked_bets_*.json + nba_tracked_slips_*.json
```

**Path B — Workstation** (what bettors see):
```
workstationRoutes.js reads nba_tracked_bets_*.json
→ diversifyCandidates()
→ normalizeCandidate() [buildFeaturedPlays.js]  ← SHARED, MLB-calibrated
→ scoreCandidate() [buildFeaturedPlays.js]       ← edge × modelProb compounding (MLB model)
→ buildFeaturedPlays()                           ← anchors / tonight's best
→ buildAiSlips() [buildSlipAi.js]                ← SHARED slip builder, VOLATILITY_RULES
```

**The disconnect**: All NBA-specific intelligence (aiRange, correlation stacks, lane separation, elite/strong tiers, archetype awareness) is in Path A. The workstation shows Path A *candidates* re-processed by a Path B *shared system* that was calibrated for MLB. The sophisticated NBA builders are orphaned from the bettor surface.

---

### FAILURE 2 — realismScore Dominates at 70% (CRITICAL)

In `nbaOpportunityCandidates.js → computeFinalWeight()`:
```javascript
w = (realismScore * 0.70) + (probability * 0.15) + (edge * 0.10) + (contextScore * 0.05)
```

`realismScore` is computed from minutes + usage + ceiling ceiling interaction:
```javascript
realismScore = 0.30 + (1.20 * minutesN) + (0.85 * usageN) + (0.55 * starterN) + (0.70 * ceilingN)
```

**Result**: A star (34 min / 29% usage) scores `realismScore ≈ 2.20`. A role-spike backup (27 min / 24% usage today due to injury) scores `realismScore ≈ 1.62`. Even if the backup has 3× the edge, their finalWeight is crushed:

- Star: `2.20×0.70 + 0.52×0.15 + 0.04×0.10 = 1.62`
- Backup (3× edge): `1.62×0.70 + 0.52×0.15 + 0.12×0.10 = 1.25`

The star wins by 30% despite the backup having genuinely superior edge. **This is the root cause of same-player monoculture.**

---

### FAILURE 3 — No NBA Ecology Tier Layer

MLB has `buildMlbPropClusters.js` which stamps ELITE/STRONG/PLAYABLE/VALUE/BASE tiers based on ecology-qualified scoring. These tiers then drive:
- Which plays surface in featured plays (ELITE/STRONG only for anchors)
- Which plays qualify for slip tiers
- How much textureBoost they receive

**NBA has no equivalent layer.** The `tier` field on NBA tracked_bets comes from whatever `nbaIsolatedRoutes.js` stamps during snapshot scoring. It is NOT derived from a dedicated ecology pass. This means:

- The `tierBoost` in `scoreCandidate()` (ELITE: +0.04, STRONG: +0.02) fires on NBA candidates, but based on tiers that weren't set by an ecology-qualified process
- Stars get ELITE by usage/opportunity, not by edge quality
- The ecology feedback loop (HR eruption miss detection in MLB) has no NBA equivalent

---

### FAILURE 4 — Alt Lines Gated Out of Workstation

From CURRENT_STATE.md: workstation NBA candidate gates include `propVariant !== "base"`.

**Consequence**: All alternate/ladder lines are excluded from the workstation NBA pool.

This kills two things simultaneously:
1. `buildNbaAiSlips.js` relies on `resolveLegFromAiRange()` to find alt line candidates in the pool for floor/median/ceiling resolution. No alt lines → resolution silently degrades to base line.
2. The `bestLadders` featured bucket (intended to surface alt-line EV plays) has nothing NBA to show.

**The system was designed to use ladders for NBA upside. The gate removes all of them.**

---

### FAILURE 5 — The 5-Builder Orphan Problem

All 5 NBA slip builders produce output but it's unclear which output the workstation renders to the bettor:

| Builder | Output Shape | Compatible with workstation? |
|---|---|---|
| `buildNbaAiSlips` | `{ safe, balanced, aggressive, lotto }` | Only if `nba_tracked_slips_*.json` is surfaced |
| `buildNbaAiPicks` | `{ elite, strong, eliteCore, strongCore, ... }` | Only in nba_tracked_slips format |
| `buildNbaDynamicSlipEngine` | `{ clusters, slipVariations, SAFE/EV/UPSIDE/CASHOUT }` | Not directly — different tier names |
| `buildNbaSlipComposer` | `{ slips: { safe, balanced, aggressive, lotto } }` | Field naming mismatch with candidates |
| `buildNbaSlipEngine` | `{ slips: [ { style, legs } ] }` | No tier structure at all |

**The workstation doesn't use any of these.** It uses `buildSlipAi.js` (shared). The 5 NBA builders produce output into `nba_tracked_slips_*.json`, which the workstation reads and displays as-is in `AiSlipsView.tsx` — but they're NOT the featured plays, anchors, or smartAggression. Those are re-generated by `buildFeaturedPlays.js` + `buildSlipAi.js` from `nba_tracked_bets_*.json` every request.

---

## 3. SAME-PLAYER MONOCULTURE FINDINGS

**Root Causes (in order of impact):**

**Cause 1 — realismScore star bias**: Every scoring function downstream of finalWeight propagates the star bias. `compositeScore()` in buildNbaAiSlips uses the same formula. `rankScoreForAiPicks()` in buildNbaAiPicks adds lane-adjusted statScore on top. Both compound the star advantage.

**Cause 2 — diversifyCandidates allows 3 per player**: Stars get 3 slots (points, assists, PRA) before any slip building. They appear in 3 different families, making them harder to avoid via single-stat diversification.

**Cause 3 — No volume archetype breakout**: `inferVolumeArchetype()` in nbaAiStatFamilyRank correctly identifies HIGH_USAGE_SCORER, but the multiplier (1.14× for points/PRA) amplifies the star signal further rather than creating space for non-stars. It was designed to route stars to their primary family, which is correct, but has the side effect of making non-stars even harder to surface.

**Cause 4 — Elite tier gate requires both high edge AND high finalWeight**: `passesEliteTierGate()` requires `e >= 0.048 AND nearTopFw`. On a slate where a star has edge 0.06 and finalWeight 1.95, a backup with edge 0.08 and finalWeight 1.40 fails `nearTopFw` (< 94% of top fw × 0.92). The edge advantage of the backup doesn't matter.

**Cause 5 — `diversityRank()` is binary**: In `buildNbaAiSlips.js`, the diversity signal is `1 if player used, else 0`. This is correct but binary — once a player appears in one slip, they get a +1 penalty, not a graduated decay. Strong repeat players only pay the binary cost.

**Specific Monoculture Pattern**: Jalen Brunson (NYK), Donovan Mitchell (CLE), Ja Morant (MEM), Anthony Davis (LAL) appear in multiple slip tiers because they maximally satisfy: high minutes, high usage, strong realismScore. There is no mechanism to break this without explicit hard caps.

---

## 4. SAFE-LANE DNA FINDINGS

**The shared `buildSlipAi.js` safe tier gates:**
```javascript
safe tier: allowedVolatility = ['safe', 'balanced'], minModelProb = 0.55, maxOdds = 150
```

**NBA VOLATILITY_RULES output for typical plays:**
- Points over: → `balanced`
- Rebounds over: → `balanced`
- Assists over: → `balanced`
- Threes < 3.5: → `balanced`
- PRA: → `aggressive`

**Result**: The NBA safe tier is populated with `balanced`-volatility candidates that pass modelProb >= 0.55. Since NBA modelProb is market-anchored (shrunk toward implied probability via `alpha`), a prop at -150 implied 60% might get modelProb 0.57 — just barely qualifying.

**Safe-lane DNA leak into aggressive**:
- The aggressive tier allows `any` volatility. NBA aggressive slots fill with the same `balanced` candidates as the safe tier (because `balanced` passes the `any` gate too), just re-selected with a lower modelProb floor (0.45).
- The aggressive tier is supposed to represent upside, ceiling plays, long-shot opportunity. It instead shows medium-probability props at slightly looser gates — same players, slightly different thresholds.

**Why aggressive feels safe**: There is no mechanism to enforce that aggressive legs represent genuinely different scenarios. A Brunson points over at 28.5 appearing in both safe and aggressive slots is not aggressive — it's safe content with an aggressive label.

---

## 5. VOLATILITY SUPPRESSION FINDINGS

### Suppression Point 1 — PRA always classified `aggressive`

`VOLATILITY_RULES`: `combo` and `pra` → `aggressive`.

Consequence in the workstation:
- PRA is excluded from the safe tier (`allowedVolatility: safe, balanced`)
- PRA is excluded from the balanced tier (`allowedVolatility: safe, balanced, aggressive` — wait, this does include aggressive)

Actually, PRA as `aggressive` DOES qualify for balanced and aggressive tiers. But:
- It gets `classifyVolatility = 'aggressive'` which affects its `volatilityFit` score in `buildFeaturedPlays.scoreCandidate()`
- The `volatilityFit` score penalizes aggressive plays in the "safest" featured bucket (where it looks for `safe`/`balanced` volatility fit)
- A PRA play at -120 with edge 0.05 and modelProb 0.55 gets excluded from the safest bucket even though it's genuinely a well-calibrated, moderate-volatility play

**The classification is philosophically wrong**: PRA at -120 is not more volatile than a points prop at -120. PRA has three components, which statistically makes it MORE stable by averaging (law of large numbers), not less. The current classification inverts the volatility logic for NBA combo stats.

### Suppression Point 2 — Lotto structurally empty

NBA lotto slip population path (via shared `buildSlipAi.js`):
1. `allowedVolatility: any`
2. `minModelProb: 0.40`
3. `maxOdds: 600`

NBA lotto slip population path (via `buildNbaAiSlips.js`):
1. Uses `resolveLottoLegAboveCeiling()` which requires super-ceiling alt lines
2. Falls back to `findHighestHighLadderForPlayer()` requiring `isLottoCeilingLeg()` = ladder tier high
3. Falls back to aggressive pool copy

**Neither path reliably fills lotto** because:
- Alt lines are gated out of workstation (kills path 1 resolution)
- Alt lines may not exist at extreme rungs in the nightly pipeline (kills path 2)
- Shared builder can't find NBA plays at +350 or above (most NBA base props are -120 to +150)

### Suppression Point 3 — `textureBoost` not NBA-calibrated

In `buildFeaturedPlays.js`, offensive attack texture boost applies to NBA overs:
- `+0.018` for offensive attack stats (points, assists, rebounds, etc.) on the over
- `+0.020` for timing advantage

These values were calibrated for MLB where the offensive ecology is pitcher-suppression vs. HR eruption. For NBA, every single over is essentially an "offensive attack" (points, rebounds, assists are all offensive production stats). The textureBoost doesn't differentiate NBA stars from NBA role players — it just adds +0.018 to all NBA overs uniformly.

### Suppression Point 4 — `tierBoost` fires on unqualified NBA tiers

The `tierBoost` (ELITE: +0.04, STRONG: +0.02) in `scoreCandidate()` fires based on the `tier` field on NBA candidates. But this tier comes from whatever `nbaIsolatedRoutes.js` stamped, not from a qualified ecology pass. If all NBA candidates are stamped ELITE (by opportunity/usage, not by edge), every candidate gets +0.04 and diversity is lost. If none are stamped correctly, the boost is wasted.

---

## 6. ROLE-SPIKE FAILURES

### Failure 1 — Dynamic multipliers can't overcome realismScore gap

The system has role-spike signals:
- `dynamicFormMultiplier()`: range 0.75–1.25 (form vs baseline)
- `dynamicUsageShiftMultiplier()`: range 0.85–1.18 (usage spike)
- `dynamicMatchupMultiplier()`: range 0.80–1.20

Even at maximum combined effect (1.25 × 1.18 × 1.20 = 1.77), a backup (realismScore 1.2) reaches `finalWeight ≈ 1.2 × 1.77 × 0.70 ≈ 1.49`. A healthy star at baseline (realismScore 2.0) reaches `finalWeight ≈ 2.0 × 0.70 ≈ 1.40`. The spike player barely beats the star — and only in extreme multi-factor scenarios (hot form + usage spike + great matchup simultaneously).

### Failure 2 — Injury context not reflected in projected minutes

The `minutes` field is read from the odds snapshot. Sportsbook props are set with pre-game minutes assumptions. When Player X is ruled out mid-afternoon, the backup's snapshot minutes might still reflect their baseline (22 min) not the new projected 32 min. The dynamic adjustments can shift this by 18% max, not the true 45% increase needed.

There is no injury-aware minutes correction mechanism in the NBA scoring pipeline.

### Failure 3 — passesAiPickScoredFloor eliminates role spikes

In `buildNbaAiPicks.js`:
```javascript
if (e < 0.018) return false
if (fw < fwMed - 0.065) return false
```

A role-spike backup player who has genuinely good edge (0.05+) but lower finalWeight than the field median (`fwMed`) can fail the `fw < fwMed - 0.065` gate. The gate was designed to filter out bad candidates, but `fwMed` is pulled up by the stars. Role spikes are disproportionately eliminated.

### Failure 4 — No "role spike" candidate tag

MLB has HR candidate tagging — a distinct signal that this player is a HR environment candidate. NBA has no equivalent "role spike candidate" tag. There is no mechanism to say "this backup is starting today due to injury, apply a role-spike multiplier and surface them regardless of raw realismScore."

---

## 7. LADDER SYSTEM FAILURES

### Failure 1 — aiRange resolution degrades when alt lines absent

`buildNbaAiSlips.js` resolves floor/median/ceiling legs by calling `resolveLegFromAiRange(pick, pool, slot)`. This function searches the pool for a candidate matching the target rung.

**If no alt lines are in the pool, the resolution fails and the function returns null.**

For the workstation path (alt lines gated out), this means: every `resolveLegFromAiRange()` call fails silently. The fallback is to use the base line directly. The SAFE slip becomes "base lines only" — not laddered. The AGGRESSIVE slip becomes "base lines at ceiling target that resolves to base." There is no genuine ladder play in the workstation output.

### Failure 2 — Floor/ceiling ranges are model-generated, not market-validated

`computeOutcomeRange()` in `nbaAiOutcomeRange.js` generates floor/median/ceiling rungs from player projections and volatility estimates. These are the model's opinion about outcome distribution, NOT validated against available market lines.

When the model says "ceiling = 32+ for Brunson" but the market only offers 28+ alt line, the resolution system tries to match "32+" in the pool, fails, and either falls back to 28+ or fails entirely. The ceiling concept is aspirational, not market-anchored.

### Failure 3 — `ladderTierHigh()` is too restrictive

For a play to qualify as a "high tier" lotto ladder leg, `ladderTierHigh()` requires:
- Points line >= 29.5 OR rung >= 30
- PRA line >= 28.5 OR rung >= 30
- Threes line >= 2.5 (any three-point ladder qualifies — this is the one loose gate)
- Rebounds line >= 11.5
- Assists line >= 8.5

These thresholds are reasonable for star players but essentially exclude every non-star. On a 6-game slate with 60 NBA players, maybe 4-6 players have point lines >= 29.5. The lotto candidate pool is structurally tiny.

### Failure 4 — `buildNbaSlipEngine.js` produces flat non-ladder slips

`buildNbaSlipEngine.js` (the random-weighted universe picker) doesn't use aiRange at all. Its "ladders" are identified by `isLadderLike()` (propVariant includes "alt"). Without alt lines in the universe, it produces straight base-line slips with probabilistic weighting. The slip style knobs (ladder-lean, edge-heavy, etc.) don't meaningfully differentiate from each other when the input pool is uniform base lines.

---

## 8. OFFENSIVE ERUPTION FAILURES

### No NBA Eruption Environment Concept

MLB has a conceptual "eruption environment": high pace + favorable pitcher matchup + park factors → HR candidate ecosystem. The ecology review engine detects when these environments were missed.

**NBA has none of this architecture:**

1. **contextScore = 5% of finalWeight**: Pace, game total, spread, DVP contribute only 5% to the primary scoring signal. A high-pace, high-total game doesn't meaningfully boost candidates from that game.

2. **No "game environment" candidate tier**: There is no pool called `eruptionCandidates` or `paceExplosionCandidates`. Candidates from high-pace games compete equally with candidates from low-pace games.

3. **paceAdj and blowoutAdj capped at ±7.5% combined**: `clamp(-0.075, 0.065, paceAdj + blowoutAdj)` ensures game context doesn't significantly change a player's rank. A 105-pace game where both teams score efficiently doesn't surface stars from that game above stars from a 97-pace game.

4. **The DynamicSlipEngine's `isHighEnvRow()`**: 
   ```javascript
   pace >= 102 AND total >= 228
   ```
   This allows up to 2 same-game legs for high-environment rows. But this only applies within `buildNbaAiSlips.js`, not in the workstation's `buildFeaturedPlays.js`.

5. **No offensive eruption miss detection**: The `buildEcologyGrader.js` in the review pipeline has no NBA equivalent of `hrEruptionMiss`. If a high-pace game produces multiple player explosions that the system missed, there's no detection mechanism.

---

## 9. AGGRESSION-TIER FAILURES

### The Aggression Paradox

NBA aggressive slip is supposed to represent: high-ceiling, high-variance, bettor-exciting upside plays. What it actually produces:

**Via `buildNbaAiSlips.js`**:
- Takes elite + strong candidates
- Resolves to `ceiling` slot of aiRange
- `ceiling` is the model's upper outcome distribution estimate

The "ceiling" for a Brunson points line at 28.5 might be 32+. But the market already prices 32+ at -140 to +110 (it's a standard alt line). This is not aggressive in any meaningful bettor sense — it's a standard moderate-ceiling play.

**Real aggression would require:**
- Asymmetric upside: props where the over probability is underestimated by the market
- Correlation stacks: same-game players in offensive environments where co-occurrence is underpriced
- Tail event plays: situations where low-probability outcomes (30+ points for a player projected at 22) have positive expected value

The current system has none of this. Its "ceiling" is mathematical, not ecological.

### EV_CLUSTER vs SAFE_CLUSTER in DynamicSlipEngine

The DynamicSlipEngine's `EV_CLUSTER` is the closest thing to true aggression — it sorts by `evScore = probability × (1 + clamp(-0.12, 0.35, edge))`. This correctly weights upside. But:
- It uses the same candidate pool as every other cluster
- The candidate pool is dominated by star players
- EV cluster produces a "high-EV star play" which is identical to the safe cluster in player composition

The cluster differentiation works in principle but collapses in practice because the input pool isn't diverse enough.

### Aggressive ≠ Lotto

In `buildNbaAiSlips.js` line 552-554:
```javascript
if ((!lotto.legs || !lotto.legs.length) && aggressive.legs && aggressive.legs.length) {
  lotto.legs = aggressive.legs.map((L) => ({ ...L, slipLottoStructuralFallback: true }))
  lotto.note = "lotto_mirrors_aggressive_pool_thin"
}
```

When lotto can't fill (which is most nights), it **copies the aggressive slip**. This is a structural fallback that produces two identical slips labeled differently. The lotto slip is not emotionally exciting — it's the same as the aggressive slip with a flag.

---

## 10. FIRST-BASKET ECOSYSTEM FINDINGS

### Current Architecture

`buildNbaFirstBasketEngine.js` and `buildNbaFirstBasketIntelligence.js` exist (402 + 510 lines). They build a first-basket board from:
- Player first-basket historical rates
- Tip-off win probability
- Team first-possession rate
- Usage + minutes signal

This output is NOT wired to the workstation. `FirstBasketView.tsx` is permanently dark.

### Volatility Classification Issue

`VOLATILITY_RULES`: `firstbasket` → `lotto`.

In `buildSlipAi.js` lotto tier: `maxOdds: 600`. First basket odds: typically +300 to +700.

Mathematically, first basket CAN qualify for lotto tier at +350+ odds. But:
1. The workstation doesn't have first basket data (not in `nba_tracked_bets_*.json`)
2. The shared `buildSlipAi.js` doesn't explicitly route first basket
3. `buildNbaAiPicks.js` does route first basket to `specialCandidates` → `eliteSpecialRaw` — but this is in the NBA-specific path, not the workstation

### What Should Happen

First basket is fundamentally a lotto/emotional play:
- Small probability (~10–25% per player)
- High payout
- Early-cashout potential (hits in the first 2 minutes of the game)
- Creates immediate emotional engagement with the slip

The DynamicSlipEngine explicitly models this with `isFastCashoutLeg()` and `ensureFastLegsLead()`. The CASHOUT_CLUSTER prioritizes first-basket legs at the front of slips. This is the right design. But it's orphaned from the workstation.

---

## 11. THREE-POINT VOLATILITY FINDINGS

### Correct Elements

- `statStabilityWeight("threes") = 0.81` — correctly identifies threes as high-variance
- `probabilityBandForFamily("threes") = { min: 0.28, max: 0.71 }` — wider band allows threes to have more model differentiation
- `threePA / 3PA volume` proxy in `buildNbaSlipEngine.js` — correctly suppresses non-shooter threes props
- `legVolatility()` in buildNbaAiSlips: `threes → 1.18` — correctly adds higher volatility to slip composition

### Incorrect Elements

**The trapped threes problem**:
- `VOLATILITY_RULES`: threes >= 3.5 → `lotto`
- `buildSlipAi.js` lotto tier: `maxOdds: 600`
- A threes over 3.5 for a volume shooter (Mitchell, Curry, Lillard) at +100 to +150 is classified `lotto` volatility but its odds make it unable to qualify for any lotto slip (lotto requires maxOdds: 600 minimum)
- It also can't go in aggressive (allowedVolatility: any — it passes, but aggressive maxOdds is 350, so +100 threes 3.5 CAN enter aggressive)
- This works accidentally, but the classification is philosophically wrong: a threes 3.5 at +120 is an aggressive play, not a lotto play

**Threes suppression in high-usage scorers**:
`highUsagePrimaryScoringFilter()` in buildNbaAiPicks removes threes from HIGH_USAGE_SCORER rankings unless volume-backed. This is correct (LeBron threes don't deserve elite treatment) but the threshold (`baseline >= 2.15 OR finalWeight >= 1.92`) may be too strict for legitimate volume shooters who happen to also have high usage.

**Threes lotto slip cap**:
`buildNbaAiSlips.js` limits threes to max 1 leg per lotto slip:
```javascript
if (/three|3pt/.test(t) && threes >= 1 && legs.length >= 1) continue
```
This is correct behavior but means the lotto slip can never be a "threes explosion" slip even if the environment strongly supports it.

---

## 12. PRA ECOSYSTEM FINDINGS

### What Works Correctly

- `COMBO_LANES.has("pra")` in buildNbaAiPicks — correctly routes PRA to combo lane
- `laneStatScoreMultiplier(combo) = 0.92` — correctly discounts combo vs pure stat
- `legVolatility("pra") = 1.08` in buildNbaAiSlips — correctly identifies higher combo variance
- `passesEliteTierGate` for COMBO_LANES uses lower thresholds (edge >= 0.024 vs 0.048 for core)

### What's Wrong

**PRA as aggressive is philosophically incorrect**:
PRA (Points + Rebounds + Assists) at a standard line is:
- 3 correlated statistics (all go up when usage goes up)
- Typically -110 to -130 pricing (not aggressive pricing)
- Statistically more stable than individual stats (sum reduces variance)

Classifying PRA as `aggressive` means:
1. PRA can't appear in the workstation `safe` tier
2. PRA gets `volatilityFit` penalty in the safest featured bucket
3. Safe and balanced slips in the workstation are depleted of a high-quality, reliable NBA prop type

**The correct classification**: Standard PRA lines should be `balanced`. High-line PRA (requiring ceiling performance) should be `aggressive`. This is the same framework MLB applies to HR tiers.

**No PRA eruption detection**: There's no "PRA environment" concept — no check for whether this game and player combination supports an exceptional PRA total (high pace + weak interior defense + deep player usage + absence of teammates). MLB detects HR environments. NBA should detect PRA explosion environments.

---

## 13. CORRELATION LOGIC FINDINGS

### Where Correlation Exists

`buildNbaDynamicSlipEngine.js` has the most sophisticated correlation:
```javascript
pairwiseStackBoost():
- Same team, points + assists: +0.14
- points + threes (any game): +0.10
- High pace (≥102) + points/threes same game: +0.07
- High usage (≥27) + high total (≥228) + PRA: +0.09
- Linked stat families (general): +0.05
```

This is the right framework. Points + assists correlation on the same team is real (when the ball handler scores, the distributor assists; when the scorer gets to the line, the passer gets credit). Points + threes same-game correlation is real (fast-paced games with lots of three-point attempts produce correlated outcomes).

### Where Correlation Is Missing

**The workstation uses `buildSlipAi.js` (shared) which has ZERO correlation logic.** Each leg is selected independently. A 3-leg workstation NBA slip has no awareness of whether legs cohere:
- Brunson points over + Brunson assists over (same player — actually filtered by diversifyCandidates, but only if they share the same tier)
- KAT points over + Brunson assists over (same game, same team, positive correlation — not boosted)
- Fast-pace game player overs (pace context not used in shared slip building)

The shared builder has `textureBoost` for offensive attack stats (additive +0.018/0.020/0.030), but this is a scoring adjustment on individual candidates, not a slip-level correlation model.

### Correlation Design Gap

No NBA slip builder checks for **negative correlation** (betting both teams' overs in a low-pace game is internally incoherent). The DynamicSlipEngine's `eventShareOk()` limits same-game exposure by count, not by logic.

---

## 14. CANDIDATE THINNING FINDINGS

### Workstation NBA Gates (from CURRENT_STATE.md)

```
- core odds (-200..+200) only
- no alternate/ladder keys (propVariant !== "base")
- known stat family
- mp ≥ 0.35
- edge ≥ 0.03
- Top 150 by edge
```

### Critical Problems

**Gate 1 — `odds (-200..+200)` eliminates deep favorites**: An NBA line at -210 (heavily favored — likely a star's points line in a fast game vs weak defense) is gated out. These are often the highest-quality props with the most predictive signal. The odds gate removes conviction plays.

**Gate 2 — `propVariant !== "base"` eliminates all ladders**: As analyzed above, this makes the workstation ladder-blind. The `bestLadders` featured bucket has no NBA content to surface.

**Gate 3 — `edge >= 0.03` may eliminate ~50% of valid NBA candidates**: NBA modelProb is market-anchored with `alpha` between 0.82–0.92. The model barely diverges from the market. An NBA prop at -130 (implied 56.5%) might get modelProb 0.575 → edge = 0.575 - 0.565 = 0.01. Legitimate, well-calibrated plays are eliminated.

**Gate 4 — Top 150 by edge**: After gating, the top 150 by edge might all be the same 3-4 players' props that happen to pass the edge floor. The diversity of the pool is not checked.

**Missing gate — No minimum realistic probability**: A prop with edge 0.04 at modelProb 0.42 (very uncertain) passes all gates. A prop with edge 0.04 at modelProb 0.58 (high confidence) also passes. They're treated equally by the gate system.

---

## 15. PHILOSOPHICAL CONFLICTS

### Conflict 1 — Opportunity Model vs Edge Model

`nbaOpportunityCandidates.js` is fundamentally an **opportunity-ranking model** (who has the most realistic production floor). `nbaModelSignals.js` is fundamentally an **edge model** (where does the market misprice probability).

These are different questions with different answers. A star player may be the best opportunity (high minutes/usage) but have zero edge (the market correctly prices their line). A backup player may have significant edge (market prices them at -105 when they're +EV at -150 given injury context) but poor opportunity score.

The current system combines them in a weighted average that rewards opportunity >> edge. This produces props with realistic baselines but no informational advantage.

**The MLB system is edge-first**: `f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)`. Edge is the primary signal, compounded by probability.

**The NBA system is opportunity-first**: `finalWeight = realismScore × 0.70 + probability × 0.15 + edge × 0.10`. Opportunity dominates.

### Conflict 2 — Market-Anchored ModelProb vs Role-Spike Detection

`nbaRowModelProbability()` shrinks toward the market: `alpha = 0.82-0.92`. This means the model's probability signal is 8-18% independent, 82-92% market-following.

This makes sense for well-calibrated markets (NBA base lines are typically efficient). But it destroys role-spike signal: when a backup is getting 32 minutes due to injury, the sportsbook doesn't immediately reprice their prop line. The model should diverge from market here — but with alpha = 0.82+, it can't diverge enough to signal the role spike.

### Conflict 3 — aiRange Philosophy vs Shared Slip Builder

`buildNbaAiSlips.js` requires `aiRange` (floor/median/ceiling) on every pick to function. This architecture requires:
1. Outcome range computation upstream
2. Alt lines in the pool for resolution
3. Valid `aiRangeResolved` fields on candidates

The shared `buildSlipAi.js` requires none of this. It works on `modelProb`, `edge`, `volatility` fields.

These are architecturally incompatible. The workstation is forced to use the shared builder because the NBA candidates don't have `aiRange` attached (that's computed by `buildNbaPlayerOutcomePredictions.js` which runs in the nightly pipeline, not in workstationRoutes).

### Conflict 4 — Static VOLATILITY_RULES vs Dynamic Model Signal

As documented in the Architecture Audit and NEXT_SESSION.md (Path A fix): `VOLATILITY_RULES` is static. NBA model has a `volatility` field. The static rules override the model's own volatility signal.

This is the PRA/lotto issue: the model might compute low volatility for a PRA at -130, but VOLATILITY_RULES stamps it `aggressive` regardless. The static rules were calibrated for MLB and never recalibrated for NBA stat characteristics.

### Conflict 5 — Two Separate Slip Construction Philosophies Running in Parallel

`buildNbaAiSlips.js`: deterministic, aiRange-based, exposure-tracked, requires elite/strong tier
`buildNbaSlipEngine.js`: probabilistic (uses `Math.random()`), universe-weighted, works without aiRange

A system that produces deterministic-quality output (aiRange slips) and random-output (weighted random slips) in the same pipeline and displays both to the operator is philosophically incoherent. Which slip should the operator trust?

---

## 16. REQUIRED ARCHITECTURE CHANGES

### Priority 1 — Designate Canonical NBA Slip Path

**Decision required**: Pick ONE canonical NBA slip path for the workstation. Recommended: `buildNbaAiSlips.js` (via `buildNbaAiPicks.js`), because it's the most architecturally sophisticated and has the aiRange framework.

**Required changes**:
1. `workstationRoutes.js` should read `nba_tracked_slips_*.json` (the nightly output of `buildNbaAiSlips.js`) as the primary slip source — NOT re-generate slips via `buildSlipAi.js` on every request
2. The workstation-path `buildSlipAi.js` call for NBA should be replaced by reading the pre-generated NBA slips
3. The `nba_tracked_slips_*.json` format must be verified to contain the output of `buildNbaAiSlips.js`

### Priority 2 — Fix the Volatility Classification for NBA

```javascript
// Current (wrong for NBA):
{ bucket: "aggressive", test: (b) => normFam(b.statFamily||b.propType).includes("combo") || normFam(b.statFamily||b.propType) === "pra" }

// Required (NBA-aware):
{ bucket: "aggressive", test: (b) => normFam(b.statFamily||b.propType) === "pra" && (num(b.odds || b.oddsAmerican) ?? 0) >= 150 }
{ bucket: "balanced",   test: (b) => normFam(b.statFamily||b.propType) === "pra" } // standard PRA at -130 to +130
```

Or better: implement Path A (NEXT_SESSION.md) — use snapshot-sourced `volatility` field directly for snapshot-originated NBA bets.

### Priority 3 — Reduce realismScore Weight, Increase Edge Weight

Current: `realismScore×0.70 + probability×0.15 + edge×0.10 + contextScore×0.05`
Proposed: `realismScore×0.45 + probability×0.20 + edge×0.25 + contextScore×0.10`

This change allows edge signal (including role spikes) to break through the star monopoly without removing the realism grounding. The realismScore should still prevent bench scrub spam, but stars with zero edge should no longer dominate over high-edge role players.

**Risk**: Must re-verify that this doesn't create bench scrub spam. Requires smoke test on a full slate before deploying.

### Priority 4 — Build NBA Ecology Tier Layer

Create `pipeline/nba/buildNbaEcologyLayer.js` modeled on `buildMlbPropClusters.js`:

```
Input: raw nba_tracked_bets candidates
Output: candidates with ELITE/STRONG/PLAYABLE/VALUE/BASE tier stamps

ELITE: edge >= 0.055 AND finalWeight >= top 15% AND matchupAdj > 0 AND recentForm positive
STRONG: edge >= 0.035 AND finalWeight >= top 35% AND not negative matchup
PLAYABLE: edge >= 0.02
VALUE: edge >= 0.01
BASE: everything else
```

This layer should run BEFORE the workstation candidate pool is built, providing the same ecology qualification that MLB gets from buildMlbPropClusters.

### Priority 5 — Remove `propVariant !== "base"` Gate for NBA Alt Lines

Or selectively allow alt lines through for the `bestLadders` featured bucket. Alt lines are essential for aiRange resolution and for surfacing genuine high-ceiling NBA plays. The current gate was added to prevent low-quality alt line spam — replace it with a minimum-edge filter (`edge >= 0.05`) on alt lines rather than excluding them entirely.

### Priority 6 — Wire Alt Lines into Range Resolution

The workstation NBA candidate pool must include alt lines for `resolveLegFromAiRange()` to work. Without this, aiRange resolution silently degrades. The nightly pipeline already has alt lines — the issue is purely the workstation gate.

### Priority 7 — Build NBA Eruption Environment Detection

In `nbaOpportunityCandidates.js`, add an eruption score:
```javascript
function computeEruptionScore(row) {
  const pace = eventPace >= 104 ? 1 : eventPace >= 102 ? 0.6 : 0
  const total = gameTotal >= 235 ? 1 : gameTotal >= 228 ? 0.5 : 0
  const matchup = matchupAdj > 0.02 ? 1 : matchupAdj > 0 ? 0.5 : 0
  const usageHighToday = usageRate >= 28 ? 1 : 0
  return (pace × 0.3 + total × 0.25 + matchup × 0.25 + usageHighToday × 0.20)
}
```

Tag candidates with `eruptionCandidate: true` when eruptionScore >= 0.65. Surface these in a new `offensiveEruption` featured bucket.

### Priority 8 — Deprecate buildNbaSlipEngine.js and buildNbaSlipComposer.js

- `buildNbaSlipEngine.js`: Non-deterministic (uses Math.random()), no aiRange, no tier awareness. Superseded by `buildNbaAiSlips.js`.
- `buildNbaSlipComposer.js`: Uses `bestBetsBoard` field naming that doesn't match current candidate format. Superseded by `buildNbaAiSlips.js`.

After designating `buildNbaAiSlips.js` as canonical (Priority 1), mark these for deprecation.

---

## 17. SAFE EVOLUTION ROADMAP

### Phase NBA-1 — Fix Volatility (0 regression risk)

**Goal**: Stop PRA from being classified `aggressive`. Fix lotto starvation.
**Method**: Implement Path A (NEXT_SESSION.md) — use `bet.snapshotSourced` flag to pass through model's own `volatility` field for NBA candidates.
**Files**: `buildSlipAi.js` `normalizeCandidate()`, `buildFeaturedPlays.js` `normalizeCandidate()`
**Risk**: Low — additive gate, doesn't change existing behavior for non-snapshot bets.
**Prerequisite**: Audit `classifyVolatility` override chain first (as NEXT_SESSION.md specifies).

### Phase NBA-2 — Designate Canonical Slip Path (low regression risk)

**Goal**: Stop the 5-builder confusion. The workstation should use NBA-specific slips.
**Method**: Verify `nba_tracked_slips_*.json` contains `buildNbaAiSlips.js` output. In workstationRoutes, serve those slips directly instead of re-running `buildSlipAi.js`.
**Risk**: Medium — requires tracing exact format of `nba_tracked_slips_*.json` and ensuring it matches what the frontend expects.

### Phase NBA-3 — Allow Alt Lines Through (medium risk)

**Goal**: Enable aiRange resolution to work in the workstation.
**Method**: Change `propVariant !== "base"` gate to `edge >= 0.04 OR propVariant === "base"` — include quality alt lines.
**Risk**: Medium — may introduce alt line spam if edge threshold is wrong. Must cap per-player alt line count.

### Phase NBA-4 — Build NBA Ecology Layer (medium work)

**Goal**: Give NBA the ELITE/STRONG ecology tier that MLB has.
**Method**: Create `pipeline/nba/buildNbaEcologyLayer.js`, wire into nightly pipeline before candidate tracking write.
**Risk**: Medium — new scoring pass. Must verify doesn't break existing tier logic downstream.

### Phase NBA-5 — Reduce realismScore Weight (high risk, requires full slate testing)

**Goal**: Allow role spikes and edge to break through star monopoly.
**Method**: Change `computeFinalWeight()` weight allocation.
**Risk**: High — affects every NBA candidate score. Could introduce bench scrub spam or destroy calibration. Requires full slate testing with before/after comparison.

### Phase NBA-6 — Eruption Environment Detection (new capability)

**Goal**: Surface offensive eruption candidates.
**Method**: Add `eruptionScore` computation and `eruptionCandidates` pool to buildNbaOpportunityBoard.
**Risk**: Low (additive) — new pool doesn't replace existing ones.

### Phase NBA-7 — Wire First Basket (new capability)

**Goal**: Populate FirstBasketView and include first basket in slip building.
**Method**: Wire `buildNbaFirstBasketEngine.js` output into workstation response. Add first basket to CASHOUT_CLUSTER or lotto slip logic.
**Risk**: Low (additive) — but requires verifying first basket data is available in snapshot.

---

## 18. WHAT SHOULD NEVER CHANGE

### 1. The aiRange Architecture (buildNbaAiSlips.js + buildNbaAiPicks.js)

This is the most sophisticated part of the NBA system. The floor/median/ceiling/lotto leg framework is architecturally correct. It should be preserved, expanded, and made the canonical path — not replaced.

### 2. The Lane Separation in buildNbaAiPicks.js

Core lanes vs combo lanes vs special lanes is the right model. Points/threes/assists/rebounds are pure stats with direct projection paths. PRA/PR/PA/RA are combo stats with correlated components. First basket / DD / TD are special events with probability-based, not volume-based, projection. This taxonomy is correct and should be preserved.

### 3. The pairwiseStackBoost Logic in buildNbaDynamicSlipEngine.js

The correlation model (points+assists same team, points+threes same game) is the right framework for NBA slip construction. This logic should be extracted and used in the canonical slip path, not discarded.

### 4. The realismScore Architecture (with lower weight)

The realismScore concept — that a player's minutes/usage/opportunity should inform prop qualification — is correct. Bench warmers shouldn't dominate NBA slips. The architecture should stay; only the weight (70% → 45%) should change.

### 5. The statStabilityWeight System in nbaAiStatFamilyRank.js

The tier-aware stat scoring with role-based bumps and stability weights is sophisticated and correct. BIG players should get rebounds bumps, GUARD players should get assists bumps. The role-stat alignment is the right philosophy.

### 6. The nbaModelSignals.js Market-Anchored Probability

Market-anchored probability with family-specific alpha is correct for NBA base props where the market is generally efficient. The problem is not the anchoring — it's the 10% edge weight downstream. Keep the market-anchored model; increase the weight on its output.

### 7. All diversifyCandidates Caps

The `maxPerPlayer: 3`, `maxPerGame: 12`, `maxPerStat: 10`, `maxPerStatSide: 6` caps are correct guardrails. They should stay unchanged.

### 8. The buildNbaAiPicks Elite Gate Structure

The `passesEliteTierGate()` with its composite checks (edge + finalWeight + form + matchup) is the right ecology gate — it's just calibrated too strictly for current pool characteristics. The gate structure is correct; the specific thresholds may need re-tuning after Phase NBA-5 (realismScore reweight).

---

## 19. WHAT MUST EVENTUALLY DIE

### Must Die (After NBA Ecology Audit Determines Canonical Path)

1. **`buildNbaSlipEngine.js`** — Non-deterministic (Math.random()), no aiRange, no tier system. Philosophically incompatible with intelligence-based bettor surface. Superseded by `buildNbaAiSlips.js`.

2. **`buildNbaSlipComposer.js`** — Wrong field naming for current candidate format. Requires `bestBetsBoard` with `modelProb`, `confidence`, `tier` fields that candidates don't produce in current form. The slip composition architecture it implements (greedy from scored pool) is already superseded by `buildNbaAiSlips.js`.

3. **`buildNbaBankrollPlan.js`** — 480 lines. 1 importer. Purpose overlaps with `buildPortfolioOptimizer.js`. After NBA ecology audit confirms overlap, deprecate.

4. **`buildNbaBestBetsBoard.js`** — 440 lines. Feeds `buildNbaSlipComposer.js`. When Composer dies, the board has no consumer. The `buildFeaturedPlays.js` (shared, canonical) replaces this function.

5. **The dual-path `buildSlipAi.js` usage for NBA** — The shared slip builder was calibrated for MLB. Once the canonical NBA slip path is designated, NBA should not flow through `buildSlipAi.js` in the workstation.

### Must Die (Long-Term, After Server.js Extractions)

6. **`pipeline/boards/buildSpecialtyOutputs.js`** — Server.js-era builder. When server.js Phase B/C extractions complete, this path retires.

7. **Legacy `tracked_props_*.json` format** — After SQLite migration. The NBA has its own tracked format; legacy pre-Phase4 files should be archived.

---

## 20. PRIORITY ORDER FOR NBA EVOLUTION

| Priority | Task | Phase | Risk | ETA |
|---|---|---|---|---|
| **1** | Fix PRA volatility / lotto starvation (Path A) | NBA-1 | Low | 1 session |
| **2** | Trace and verify canonical NBA slip output path | Pre-NBA-2 | Low (audit) | 0.5 session |
| **3** | Designate buildNbaAiSlips as canonical, wire to workstation | NBA-2 | Medium | 1 session |
| **4** | Allow quality alt lines through workstation gate | NBA-3 | Medium | 0.5 session |
| **5** | Build NBA Ecology Tier Layer (ELITE/STRONG stamps) | NBA-4 | Medium | 1 session |
| **6** | Reduce realismScore weight (0.70 → 0.45) | NBA-5 | High | 1 session + testing |
| **7** | Add eruption environment detection | NBA-6 | Low (additive) | 0.5 session |
| **8** | Wire first basket to workstation | NBA-7 | Low | 0.5 session |
| **9** | Deprecate buildNbaSlipEngine + buildNbaSlipComposer | Post-NBA-2 | Low | 1 session |
| **10** | Extract correlation logic to canonical slip path | Post-NBA-3 | Medium | 1 session |

**Total estimated sessions: ~8 focused NBA evolution sessions.**

---

## QUICK REFERENCE: NBA DIAGNOSTIC FINGERPRINTS

When you observe the following symptoms, trace to these causes:

| Symptom | Root Cause | Fix |
|---|---|---|
| Brunson in every slip | realismScore 70% dominance | Phase NBA-5 (reweight) |
| Lotto slip is empty | Alt lines gated out + lotto odds floor | Phase NBA-1 + NBA-3 |
| Lotto mirrors aggressive | `lotto_mirrors_aggressive_pool_thin` fallback | Fix lotto population (NBA-3 + NBA-5) |
| PRA not in safe/balanced | VOLATILITY_RULES stamps aggressive | Phase NBA-1 (Path A) |
| Ladders feel fake | aiRange resolves to base line (no alt lines) | Phase NBA-3 |
| No role spike detection | realismScore star gap too large | Phase NBA-5 |
| Aggressive feels safe | Ceiling = same players as safe | Phase NBA-5 + correlation extraction |
| First basket dark | WorkstationView not wired | Phase NBA-7 |
| Emotionally flat slips | No correlation, no eruption, no ladder | Phases NBA-3 + NBA-6 + correlation |
| Dead NBA lotto from shared builder | `buildSlipAi.js` used instead of NBA-specific | Phase NBA-2 |

---

_NBA Ecology Constitution Audit completed: 2026-05-09_
_Next audit trigger: After NBA-1 through NBA-4 implemented, run full slate ecology review_
_Required reading before any NBA change: This file + ARCHITECTURE.md + CURRENT_STATE.md + NEXT_SESSION.md_
