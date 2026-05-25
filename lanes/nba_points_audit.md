# Lane 5 — NBA Player Points: Cognition Audit

**Started:** 2026-05-23
**Updated:** 2026-05-24 — Original audit was INCOMPLETE. Found 5 independent NBA tier-stamping paths during operator-caught regression. Consolidated into single canonical classifier (`nbaTierClassifier.js`). Audit gap acknowledged + listed below.

## What the original audit missed (added 2026-05-24)

Operator caught that iPhone Sharp Plays kept showing ELITE ratings even after every "fix" was shipped. Cause: five independent NBA tier-stamping paths existed in the codebase, three of which I had not patched in earlier rounds:

| # | File | Original logic | Status |
|---|---|---|---|
| 1 | `backend/pipeline/nba/buildNbaBestBetsBoard.js:343` | `tierForPlay(edge, ev, conf)` | now → `classifyNbaTier()` |
| 2 | `backend/pipeline/nba/fetchNbaOddsSnapshot.js:117` | inline `edge >= 0.12 ? "ELITE"` | now → `classifyNbaTier()` |
| 3 | `backend/http/nbaIsolatedRoutes.js:1275` | inline `edge >= 0.12 ? "ELITE"` (copy-paste of #2) | now → `classifyNbaTier()` |
| 4 | `backend/routes/workstationRoutes.js:495` | inline `edge >= 0.12 ? "ELITE"` (copy-paste of #2) — **this is what Sharp Plays reads** | now → `classifyNbaTier()` |
| 5 | `backend/pipeline/nba/buildNbaPerformanceTracking.js` | passthrough writes whatever `play.tier` is | n/a — downstream of #1-4 |

**Doctrine violation:** repo-level project doctrine explicitly forbids shadow authority through duplicate runtime systems. This was a clean four-way shadow tier-classification system. Fix: `nbaTierClassifier.js` is now the single canonical source. All callers import and delegate.

**Still potentially-shadow paths (model probability, not tier):**

- `buildNbaBestBetsBoard.js:modelProbForSide` — independent modelProb function with its own shrink + cap (now patched: shrink 0.60, cap 0.85)
- `nbaModelSignals.js:nbaRowIndependentModelProbability` — the workstation /state path's modelProb (now patched: form weight 0.50, band [0.15, 0.85])
- `buildNbaDefensiveProps.js:267` — DEFENSIVE-prop modelProb (separate use case, lower priority)
- `buildNbaPlayerOutcomePredictions.js:1124` — falls back to `nbaRowModelProbability` or 0.5

These produce modelProb in three different ways. Less impactful than the tier-stamping shadow because they all feed INTO tier classification which now goes through the single classifier — but worth noting for the next consolidation pass.

---

---

## Why we are auditing this lane

The lane scorecard (`scorecards/lane_scorecard_2026-05-23.md`) shows NBA points:
- 122 decided bets across 60 days
- Model average prob: **48.5%**
- Actual hit rate: **40.2%**
- Calibration delta: **+8.3pp overconfident**
- ROI @ 1u flat: **+15.5%**

The +ROI looks healthy. But on **2026-05-23** the operator hit the Sharp Plays view and saw something the calibration aggregate hides — every single NBA points pick contradicting the player's L5 average:

| Player | Pick | L5 avg | Direction |
|---|---|---|---|
| Jalen Brunson | UNDER 20.5 (+290) | 26.6 | Model says under by 6 pts |
| Donovan Mitchell | UNDER 21.5 (+265) | 30.8 | Model says under by 9 pts |
| Dennis Schroder | UNDER 2.5 (+280) | 6.6 | Model says under by 4 pts |
| Max Strus | OVER 13.5 (+270) | 9.2 | Model says over by 4 pts |
| James Harden | UNDER 13.5 (+290) | 18.6 | Model says under by 5 pts |

Five out of seven Sharp Plays contradicting the visible recent form by 4-9 points. The model's own context banner is literally listing evidence AGAINST the pick ("every-game starter · minutes trending up · last 5 avg: 26.6") and then making the pick anyway. All five tagged `ELITE` tier.

This is the discoverable pattern: **the NBA points model is reversing recent form at a rate that is not defensible.** The +ROI is happening because the books are even more wrong than the model, not because the model is right.

---

## The cognition path (read 2026-05-23)

NBA points modelProb is produced by `nbaRowIndependentModelProbability(row)` in `backend/pipeline/nba/nbaModelSignals.js`. The flow:

### Step 1 — Base independent probability (`nbaIndependentBaseModelProbability`)

Builds a logistic score over normalized Z-signals. None synthetic — all null when source data is null (Session AN-2 anti-fabrication).

Primary signals (weighted via `honestWeightedScore`, weights from `familyScoreWeights("points")`):
- `usageZ = (usage − 22) / 9`
- `shotsZ = (shots − line*0.5) / max(4, anchor*0.35)`
- `astZ` / `rebZ` (family-relevant rate)
- `formZ = (recent − line) / max(2.5, anchor*0.28)` ← **the L5 signal**
- `minutesZ = (minutes − 30) / 6`
- `ctxZ` (rolled-up context bundle: pace, total, spread, opp defense, blowout risk, role)

Then:
- Ladder penalty for off-anchor alt lines
- `if (side === "under") score *= -1`  (inversion)
- `logistic(score)`
- `compressAroundMid(p, "points")`
- Clamped to `probabilityBandForFamily("points", row)`

### Step 2 — Market shrinkage (`nbaRowIndependentModelProbability`)

```js
compressedToMarket = implied + (modelProb - implied) * alpha  // alpha = 0.84 for points
```

This pulls the raw model prediction 16% of the way back toward the market line. Tighter shrinkage than threes/PRA. **There is no longer a systematic +0.015 upward recenter** (Session AN-2 explicitly removed it as "the single largest source of fake edge"). This is good.

### Step 3 — Four bounded shifts

Applied additively after market shrinkage. All side-aware where appropriate.

| Shift | Cap | Source | Behavior on UNDER side |
|---|---|---|---|
| `matchupShift` | **±6pp** (largest) | `computeMatchupAdjustmentFromRow` — defense / pace / total / opponent | Inverted: `side==="under" ? -m.adj : m.adj` |
| `teammateRedistShift` | ±3pp | `nbaTeammateContextDeriver` — usage redistribution from likely-absent teammates | Set by deriver, side-aware in setter |
| `marketShift` | ±2pp | `nbaMarketContextDeriver` — multi-book consensus delta | Set by deriver, side-aware |
| `availabilityShift` | ±2pp | `nbaAvailabilityCache` — opponent injury status pushing usage | Set by deriver, side-aware |

Max possible cumulative shift: **±13pp**. That is large enough to flip a marginal pick from over→under.

### Final

```js
withMatchup = compressedToMarket + matchupShift + teammateShift + marketShift + availabilityShift
return clamp01(clamp(band.min, band.max, withMatchup))
```

---

## What the contradiction pattern tells us about the bug

For Brunson UNDER 20.5 to come out at modelProb 48.2%, working backwards:

- impliedProb at +290 ≈ 0.256 (market gives him 25.6% chance of UNDER 20.5)
- final modelProb 0.482 ≈ market + 22.6pp edge

For that edge to materialize despite formZ being strongly positive for OVER (L5 26.6 vs line 20.5 = +0.99 Z-score on form), one of these must be true:

1. **formZ weight is too small.** `familyScoreWeights("points").form` may be giving form signal far less weight than it deserves. If weight is 0.15 and other signals (usage, minutes, ctx) collectively pull the score back toward zero, the form contradiction never makes it into the final score.

2. **Step 3 shifts are dominating.** A +6pp matchupShift (inverted to UNDER) plus +3pp teammateShift plus +2pp marketShift = +11pp of "model knows better than form" being added on the UNDER side. Cumulative max shift could push 0.36 (raw under) up to 0.47 — matching the observed 0.482.

3. **Market shrinkage is masking the form signal.** Alpha=0.84 means 16% of the raw model is preserved and 84% is replaced by market. If the market is mispricing Brunson UNDER 20.5 because the book itself doesn't believe his form (sharp adjustment), the shrunk model now agrees with the market by construction, not by analysis.

4. **`recent` signal isn't actually being populated.** `formZ` is null when `recentFormSignal(row, line, anchor)` returns null. If `row.recentForm.last5_avg` isn't being plumbed through to `recent` in the right shape, the form signal silently drops out and the model never sees it.

I cannot tell from a read alone which of these is dominant. **The next concrete step is decomposition: take one contradiction case (Brunson UNDER 20.5 tonight), and dump the actual values of each intermediate quantity:**

- `formZ` (computed value, not null?)
- `primaryBundle.score`, `primaryBundle.signals_present`
- `score` before/after side inversion
- `score` after compression
- `independent base modelProb` (before market shrinkage)
- `compressedToMarket` (after shrinkage)
- `matchupShift` value + decomposition (defensePart / pacePart / totalPart)
- `teammateRedistShift` + sample quality
- `marketShift` + book dispersion
- `availabilityShift` + opponent injury count
- `withMatchup` (final)

Once we see those numbers per case, the dominant pathology is provable. **Until then any "fix" is guesswork.**

---

## Calibration tells us this is system-wide, not isolated

The aggregate 8pp overconfidence over 122 bets is not random noise. It says the model is structurally over-claiming on every points prediction by ~8pp on average. The individual contradictions we see in Sharp Plays are likely the same systematic error compounded by specific cases where the form was particularly contradictable.

This is consistent with theories 2 (shifts dominating) or 3 (market shrinkage by construction).

---

## What I will NOT do without operator approval

- Adjust weights in `familyScoreWeights` (could fix or could break other props)
- Lower shift caps (could throw away real matchup intelligence)
- Disable the market shrinkage (could re-introduce the +0.015 systematic bias)
- Rebuild `nbaIndependentBaseModelProbability` (~few hundred lines of cognition, multiple downstream consumers)

These are all candidates for the rebuild but each one has reach across the rest of the NBA prop system.

---

## Concrete next steps (in order)

1. **Decomposition script.** Write `backend/scripts/inspectNbaPick.js` — takes a `(player, family, side, line)` and dumps every intermediate value in the modelProb pipeline. Run it on the 5 contradiction cases from 2026-05-23. Result: a table showing which signal dominated each pick.

2. **From decomposition, identify the dominant pathology.** Most likely candidates ranked by my prior:
   - matchup adjustment too aggressive
   - form signal weight too low
   - shifts being applied side-incorrectly somewhere
   - recentForm not actually populating into `recent`

3. **Targeted fix.** Surgically change ONE thing in the cognition (the dominant cause). Re-run the lane scorecard against historical tracked_bets to verify the calibration improves without breaking other props.

4. **A/B comparison.** Side-by-side: pre-fix modelProb vs post-fix modelProb for the same 122 historical bets. Brier score must improve. Hit rate vs implied rate must converge.

5. **Promote to live.** Only after step 4 shows improvement on the existing sample.

This is real cognition work. Realistic timeline: 3-5 sessions if the dominant cause is one thing; longer if multiple compounding issues. **No commitment that the rebuild produces +EV on its own — the rebuild's job is to make the model HONEST, not necessarily better than market.** The +ROI today may be a fragile artifact of the books being even more wrong than the model; once the model is honest the ROI may go negative, at which point we know the cognition itself isn't producing edge and we need a different model.

---

## Surface honesty fixes shipped same day (2026-05-23)

While the audit was happening, three FE fixes shipped to make the broken model VISIBLY broken in the operator's iPhone view:

1. **Calibration discount on displayed edge.** Model claims +22pp → FE displays `+14pp est` (= raw − calibration delta). The model can no longer brag past its track record.
2. **Contradiction flag.** Any row where the model's side disagrees with L5 avg by >15% of the line gets a red `vs L5 26.6` tag. Operator instantly sees which picks are contrarian-to-form.
3. **Visible-line guarantee.** Family projection header now references a line that is actually displayed in the ladder (previously it could point to a line outside the top-4/top-3 display window).

These do NOT fix the model. They make the brokenness visible. Operator can choose to bet or skip with eyes open.
