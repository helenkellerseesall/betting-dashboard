# MLB CONSTRUCTION TRACE V1
**Read-only audit. No code changes in this session.**
_Authored: 2026-05-09 (Session AD) — Sonnet_
_Data: mlb_tracked_best_2026-05-09.json (115 entries) + live buildSlipAi.js + buildFeaturedPlays.js + VOLATILITY_RULES_

---

## 1. MLB CONSTRUCTION HEALTH SCORE

**Overall: 3.2 / 10**

| Dimension | Score | Verdict |
|---|---|---|
| Candidate pipeline integrity | 5.0/10 | enrichBestEntry functional but volatility-blind at input |
| Tier accessibility (SAFE) | 0/10 | Structurally dead for MLB offensive attack — zero eligible |
| Tier accessibility (BALANCED) | 0.5/10 | Dead for tracked_best pool; thin eligibility on low-odds RBI/Hits only |
| Tier accessibility (AGGRESSIVE) | 4.0/10 | HR can enter via 2-leg cross-game combos; single legs fail dec 6.0 floor |
| Tier accessibility (LOTTO) | 6.5/10 | Mathematically open for 3–5 leg HR parlays; maxPerStat=3 limits HR depth |
| Ecosystem diversity | 1.5/10 | 115 candidates: 100% overs, 100% high-odds, 97% lotto-classified |
| Model signal expression | 2.5/10 | Prob cap at 0.50 erases distinction between HR at 0.12 and 0.35 probability |
| Featured play coverage | 2.0/10 | Safe-lane monoculture in featured anchors; no MLB offensive attack anchoring |
| Offense-as-ecology | 2.0/10 | No ELITE/STRONG stamps for MLB; no eruption detection; no HR-specific cadence |
| Construction health overall | **3.2/10** | One functional tier (lotto), three dead tiers, zero ecology diversity |

**Summary:** The MLB construction pipeline produces a 1-lane ecosystem. SAFE and BALANCED are unreachable for any tracked_best entry. AGGRESSIVE is partially accessible via 2-leg cross-game combinations, but filtered by the dec 6.0 floor and the modelProb ≥ 0.20 gate. LOTTO is the only genuinely open lane, accepting 3–5 HR leg parlays with combined decimals of 91–216. The fundamental problem is not a single broken gate — it is a structural misalignment between what the MLB tracked_best pool contains (all high-odds overs, nearly all lotto-classified) and what the tier architecture was designed to serve (diverse volatility bands from safe to lotto).

---

## 2. OFFENSIVE ECOSYSTEM TRACE

**Full pipeline: tracked_best → enrichBestEntry → diversifyCandidates → buildSlipAi → tier assembly**

### Step 1 — Candidate production (nightly, `buildMlbPropClusters.js`)
- Produces 4 clusters: `hrCluster`, `tbCluster`, `rbiCluster`, `hitsCluster`
- All clusters filter overs only (`isUnderSide` entries discarded at cluster level)
- HR hard quality floor: `predictedProbability >= 0.12 OR edge >= 0.08`
- HR scoring: `pred * 0.5 + edge * 0.3 + min(odds/1000, 1) * 0.2`
- Output written to `mlb_tracked_best_{date}.json` as `entries[]`

**What leaves the nightly pipe:**
```
115 entries — ALL overs, ALL odds > +250
  HR:   37 entries (~+300 to +600)
  TB:   30 entries (~+300 to +500)
  RBI:  27 entries (~+250 to +450)
  Hits: 21 entries (~+250 to +400)
```
Zero safe bets, zero balanced bets, zero unders — entire output is the high-odds attack board.

### Step 2 — enrichBestEntry (`workstationRoutes.js:123`)
Maps tracked_best fields to normalized candidate shape:
```javascript
edge:        e.edgeProbability,
modelProb:   e.predictedProbability,
statFamily:  String(e.propType || "").toLowerCase().replace(/\s+/g, ""), // → "homeruns", "totalbases", "rbis", "hits"
odds:        e.odds,      // ← American odds passed through directly
oddsAmerican: e.odds,
```
**Critical gap 1:** No `volatility` field set. All 115 candidates arrive at `normalizeCandidate()` without volatility — they receive it for the first time from `classifyVolatility(raw)`.

**Critical gap 2:** No `snapshotSourced` field set. The NBA-2.B resolver's preservation path is permanently inactive for MLB. All 115 always reach the VOLATILITY_RULES fallback.

**Critical gap 3:** No ELITE / STRONG / tier stamps from the nightly pipe survive into the workstation candidate shape. `confidenceTier = e.bucket?.split(".").pop()?.toUpperCase() || "PLAYABLE"` — the bucket field format in tracked_best does not contain ELITE or STRONG in practice (these stamps don't exist in the MLB nightly pipeline). All 115 candidates enter as "PLAYABLE" tier, meaning the 5% tier boost in `scoreLeg()` never fires positively for any MLB offensive candidate.

### Step 3 — VOLATILITY_RULES classification (inside `normalizeCandidate`)
Rules fire in order for each candidate:
```
Rule 1: odds >= 350 → lotto
Rule 6: statFamily in ["homeruns","hr","homers"] → aggressive (catches HR with odds < 350 AND line < 1.5)
Rule 7: odds >= 200 → aggressive
Rule 10: totalbases/hits/runs... → balanced
Rule 11: → safe (default)
```
**Resulting classification for tracked_best pool:**
```
safe:       0   (no candidate has odds < +150 AND safe-tier stat family)
balanced:   0   (no candidate has odds < +200 after Rule 1/6/7 sweep)
aggressive: 4   (RBI at +250–+349 — hit Rule 7 before Rule 1)
lotto:     111  (HR at +350+, TB at +350+, RBI at +350+, Hits at +350+)
```

### Step 4 — diversifyCandidates (`buildCandidateDiversity.js`)
Sort key: `(edge * 4) * clamp(0.50, 0.55, modelProb)`

All 115 MLB candidates have modelProb 0.12–0.35, ALL capped to 0.50. Score = `edge * 4 * 0.50 = edge * 2`.
- HR at prob=0.26, edge=0.09: score = 0.18
- HR at prob=0.15, edge=0.09: score = 0.18 — **identical**

The `[0.50, 0.55]` cap was correct to prevent suppression-side distortion. But its side effect on MLB offensive candidates: all probability signal is erased. The system cannot express that a 0.26-probability HR is 73% more likely to hit than a 0.15-probability HR — they rank equally.

Caps applied after sort: `maxPerPlayer=3, maxPerGame=7, maxPerStat=10, maxPerStatSide=6`. With 30 MLB games and 115 entries, most games have 2–5 candidates, under the per-game cap. All 115 likely survive diversification.

### Step 5 — buildAiSlips tier routing
`aiCandidates = [...pool.eligibleBets, ...pool.enrichedBest]`
- `eligibleBets`: tracked_bets filtered by `edge > 0.04 AND modelProb > 0.20`
- `enrichedBest`: all 115 tracked_best entries

MLB never uses snapshot supplement (NBA-only path). The full 115 candidates enter slip assembly.

---

## 3. HR SUPPRESSION TRACE

**Home runs: 37 candidates, odds +350–+600, modelProb 0.12–0.26, line 0.5**

### VOLATILITY_RULES path for HR
Rule 1: `odds >= 350` → **lotto** (fires for ~90% of HR candidates; most HR are +350+)
Rule 6: `statFamily in ["homeruns","hr","homers"]` → **aggressive** (catches HR at +200–+349 — rare; maybe 0–3 entries)

### SAFE tier — blocked on 3 simultaneous failures:
1. `allowedVolatility: ["safe","balanced"]` — "lotto" excluded → **BLOCKED**
2. `minModelProb: 0.55` — HR prob 0.12–0.26 → **BLOCKED**
3. `maxOdds: 150` — HR at +350–+600 → **BLOCKED**

The premium-edge override (`isPremiumEdgeForSafe`) requires `modelProb >= 0.50 AND edge >= 0.12`. HR modelProb 0.12–0.26 never reaches 0.50 → override dead. Safe tier: **0 HR eligible, 0 HR in any safe slip.**

### BALANCED tier — blocked:
- `allowedVolatility: ["safe","balanced","aggressive"]` — "lotto" excluded → **BLOCKED** for the 111 lotto-classified HR
- The 0–3 HR classified as "aggressive" (rare low-odds HR) theoretically pass volatility. But:
  - `minModelProb: 0.45` — HR at 0.12–0.26 → **BLOCKED**
  - `maxOdds: 250` — HR at +200–+249 only; most HR at +350+ → **BLOCKED**
  - `decimalOddsRange: [3.0, 8.0]` — 2-leg HR combo: dec 3.0*3.0=9, above max → **BLOCKED**

**Balanced tier: 0 HR eligible in any realistic scenario.**

### AGGRESSIVE tier — partially accessible:
- `allowedVolatility: ["balanced","aggressive","lotto"]` — "lotto" included → **PASS** for all 111
- `minModelProb: 0.20` — HR at 0.20–0.26: PASS (~30% of HR candidates); HR at 0.12–0.19: BLOCKED
- `maxOdds: 600` — HR at +350–+599: PASS; HR at +600: blocked (1–2 entries at edge)
- `decimalOddsRange: [6.0, 120.0]`:
  - 1 HR leg at +400 = dec 5.0 → **below 6.0 floor → single-leg aggressive not viable**
  - 2 HR legs at +400+400 = dec 25.0 → within [6, 120] → **PASS** (if from different games)
  - 2 HR legs from same game: allowed (maxPerGame=2 for aggressive) — script correlation guard does NOT fire (legCountRange[1]=4 > 3)

**Aggressive tier: HR enters via 2-leg cross-game combinations only, limited to the subset with modelProb ≥ 0.20 (~11–13 entries). Single HR legs cannot form the minimum viable aggressive slip.**

### LOTTO tier — open:
- `allowedVolatility: ["aggressive","lotto"]` — "lotto" included → **PASS**
- `minModelProb: 0.10` — all HR at 0.12–0.26 → **PASS**
- `maxOdds: 2000` — all HR → **PASS**
- `decimalOddsRange: [20.0, 1500.0]`:
  - 3 HR at +350 each = dec 4.5³ = 91.1 → within [20, 1500] → **PASS**
  - 3 HR at +500 each = dec 6³ = 216 → within [20, 1500] → **PASS**
  - 5 HR at +400 each = dec 5⁵ = 3125 → above 1500 → **trimmed to 4 legs** (dec 625 — OK)
- `maxPerStat: 3` → max 3 HR legs in one lotto slip
- `maxPerGame: 2` → max 2 from same game

**Lotto tier: HR can form valid 3–5 leg slips (max 3 HR legs). This is the only functional pathway.**

### Root cause of HR suppression:
HR is a binary-outcome, high-odds bet. Its structural characteristics (low probability, high reward, odds typically +350–+600) land it almost entirely in the "lotto" volatility bucket. The architecture has three safe/balanced tiers that together cover the majority of bettor-facing slip real estate, but ALL THREE are structurally impassable for HR. HR exists only in the lotto tier — which requires combining 3+ legs from different players and often different games. This means HR as a standalone single-game attack is invisible in the construction output. A bettor who wants to play Judge HR tonight in a compelling single can only see it if the system happens to combine it in a lotto parlay.

---

## 4. RBI-CHAIN TRACE

**RBIs: 27 candidates. Mixed odds (+250–+450). modelProb range 0.15–0.32.**

RBI classification via VOLATILITY_RULES:
```
Rule 1: odds >= 350 → lotto    (~18 of 27, those at +350+)
Rule 7: odds >= 200 → aggressive (~9 of 27, those at +250–+349; this is where the 4 aggressive entries live)
Rules 10+: balanced / safe (would require odds < 200 — none in tracked_best)
```

### RBI in BALANCED tier:
- The 4–9 aggressive-classified RBI props pass `allowedVolatility: ["safe","balanced","aggressive"]`
- `minModelProb: 0.45` — RBI at 0.20–0.32 → **BLOCKED for most** (~2–3 might clear if predictedProbability is 0.25+, but edge-case)
- `maxOdds: 250` — RBI at +250 = exactly at limit; +251 fails
- `decimalOddsRange: [3.0, 8.0]` — 2-leg RBI combo at +250+250 = dec 3.5*3.5 = 12.25 → **above max 8.0**

RBI effectively blocked from BALANCED slips due to the combined odds range gate. Even a 2-leg RBI combo from different games exceeds dec 8.0 at any meaningful odds.

### RBI in AGGRESSIVE tier:
- Aggressive-classified RBI (4–9 entries) + lotto-classified RBI (18 entries) both eligible
- `minModelProb: 0.20` — RBI at 0.20+: pass; below 0.20: filtered
- 2-leg RBI cross-game: dec 3.5*3.5 = 12.25 → within [6, 120] ✓
- This is the most viable offensive attack lane in the current ecosystem

**RBI is the most accessible offensive family** because some RBI props have odds in the +250–+349 range (aggressive, not lotto) and can form valid 2-leg aggressive slips. This is the thin thread connecting the MLB offensive pool to a mid-tier construction lane.

### RBI chain suppression:
The chain (Hits → RBI → Scoring → Win) is structurally broken because the tiers fire independently. A player hitting (Hits family) and scoring (RBI family) in the same game are natural correlated events, but the construction layer has no concept of "chain" logic. The portfolio optimizer flags `sameScript warn=4 critical=6` which limits how many overs from same-script context can accumulate, but the chain relationship is never used to BOOST correlated candidates — only to penalize concentrations.

---

## 5. SAFE-LANE DNA TRACE

**Safe tier: `minModelProb=0.55, maxOdds=150, allowedVolatility=["safe","balanced"]`**

MLB offensive candidates are structurally incompatible with every safe-tier gate simultaneously:

| Gate | Requirement | MLB Tracked_Best Reality | Verdict |
|---|---|---|---|
| `allowedVolatility` | safe or balanced | 0/115 candidates qualify | DEAD |
| `minModelProb` | ≥ 0.55 | All 115 at 0.12–0.35 | DEAD |
| `maxOdds` | ≤ +150 | All 115 at +250+ | DEAD |
| `decimalOddsRange` | [1.8, 4.0] | Single HR at +350 = dec 4.5 | DEAD |
| `premiumEdgeOverride` | modelProb ≥ 0.50 AND edge ≥ 0.12 | modelProb 0.12–0.35 | DEAD |

The safe lane, by design, serves confirmed-probable, low-juice, well-contained props (think: a superstar to record ≥1 hit at -125). MLB tracked_best contains none of these. The safe lane correctly excludes the entire attack board — this is not a bug.

**The problem is architectural:** MLB has no separate safe-lane candidate pipeline. The nightly pipe produces ONE candidate pool (the attack board of high-odds overs). Safe-lane MLB content would require:
1. Tracking confirmed-probable low-odds MLB props (e.g., Shohei over 0.5 hits at -140) separately
2. Or adding a "safe" cluster type to `buildMlbPropClusters.js` with different quality gates

Neither exists. The MLB safe lane is permanently empty because there's no data source that could feed it.

---

## 6. PORTFOLIO OPTIMIZER TRACE

**`buildPortfolioOptimizer.js` — VOLATILITY_RULES + CORRELATION_THRESHOLDS**

### VOLATILITY_RULES — confirmed rule order (critical for MLB):
```javascript
Rule 1:  odds >= 350        → lotto      // fires for ~80% of tracked_best
Rule 2:  firstbasket        → lotto
Rule 3:  ["homeruns","hr","homers"] AND line >= 1.5 → lotto  // line=0.5 → NEVER fires
Rule 4:  totalbases AND line >= 3.5 → lotto   // TB over 1.5/2.5 → fires if TB line ≥ 3.5
Rule 5:  threes AND line >= 3.5     → lotto   // NBA-specific
Rule 6:  ["homeruns","hr","homers"] → aggressive   // all HR with odds < 350 land here
Rule 7:  odds >= 200        → aggressive    // catches RBI/Hits at +200–+349
Rule 8:  xbh               → aggressive
Rule 9:  combo / pra        → aggressive
Rule 10: totalbases/hits/runs/points/rebounds/assists → balanced
Rule 11: → safe (default)
```

**Rule 3 failure for standard HR:** The lotto-by-line rule requires `line >= 1.5`. The standard HR prop is "HR Over 0.5" (hit at least one). `0.5 >= 1.5` is false. Rule 3 never fires. HR is lotto because Rule 1 (odds ≥ 350) fires first — NOT because the VOLATILITY_RULES have MLB-specific HR knowledge. This is accidental correctness.

**Implication:** If a prop book offers HR Over 0.5 at +290 (e.g., a confirmed strong hitter vs a weak righty), Rule 1 fails (+290 < 350), Rule 3 fails (line 0.5 < 1.5), Rule 6 fires → **aggressive**. This is the right bucket. But Rule 7 also fires for any prop at +200–+349, meaning RBI and Hits props in that range are also "aggressive" — correct behavior.

### CORRELATION_THRESHOLDS:
```
sameGame: warn=5, critical=8
samePlayer: warn=5, critical=8
sameStat: warn=8, critical=14
sameScript: warn=4, critical=6
hrConcentration: warn=5, critical=8
```
These thresholds are checked at the portfolio level (single bets), not during slip assembly. The slip assembly has its own per-tier caps (`maxPerGame`, `maxPerStat`). The portfolio-level HR concentration warning (`hrCount >= 5`) is a dashboard advisory, not a construction gate.

**Optimizer conclusion:** The portfolio optimizer is sport-agnostic and correctly classifies MLB props via VOLATILITY_RULES. The rules are not the primary bottleneck. The bottleneck is that the MLB tracked_best pool is structurally concentrated in the high-odds range that makes all candidates lotto or aggressive — and the tier templates then restrict those tiers from reaching most bettor-facing surfaces.

---

## 7. SAME-GAME PENALTY TRACE

**Script correlation guard (`canAddLeg()`, line 382–387):**
```javascript
if (gk && candidate.side === "over") {
  const overSameGame = slipLegs.filter((l) => gameKey(l) === gk && l.side === "over").length
  if (overSameGame >= 1 && tpl.legCountRange[1] <= 3) {
    return { ok: false, reason: "script_correlation" }
  }
}
```

**The guard fires only when `tpl.legCountRange[1] <= 3`:**
- SAFE (max 3 legs): **fires** → after 1 over from a game, no more overs from that game
- BALANCED (max 3 legs): **fires** → same effect
- AGGRESSIVE (max 4 legs): **does NOT fire** → multiple overs from same game allowed
- LOTTO (max 5 legs): **does NOT fire** → multiple overs from same game allowed

For SAFE and BALANCED this rule is irrelevant since MLB offensive candidates can't enter those tiers anyway.

For AGGRESSIVE and LOTTO, the rule is inactive. Same-game correlation for overs is managed only by `maxPerGame`:
- AGGRESSIVE: `maxPerGame=2` — at most 2 candidates from same game in an aggressive slip
- LOTTO: `maxPerGame=2` — same

**Same-game penalty reality for MLB:** The script correlation guard has near-zero impact on MLB offensive construction because the tiers where it matters (safe/balanced) already exclude MLB candidates on other grounds. The tiers where MLB candidates can land (aggressive/lotto) have maxPerGame=2 as the operative limit, which is permissive enough to allow genuine stacking (e.g., same-game RBI + HR parlay).

However, the `maxPerStat` cap (lotto: 3) IS meaningful: a 5-leg lotto slip can contain at most 3 HR legs. The remaining 2 legs must come from a different stat family. This forces stat diversity in lotto slips, preventing an all-HR parlay longer than 3 legs.

---

## 8. DIVERSIFICATION TRACE

**`diversifyCandidates` sort key: `(edge * 4) * clamp(0.50, 0.55, modelProb)`**

### Probability cap effect on MLB:
All 115 MLB tracked_best entries have `predictedProbability` in [0.12, 0.35]. After the clamp to [0.50, 0.55], ALL receive `probFactor = 0.50`.

Result: The sort order is determined entirely by `edge`. A HR with edge=0.09 ranks above TB with edge=0.07, regardless of model probability. A HR at prob=0.26 and edge=0.09 ranks identically to HR at prob=0.14 and edge=0.09.

**This is a deliberate design (added to prevent suppression-side probability distortion from short-line compression). But for MLB offensive candidates it erases what little model conviction exists between a 26%-likely HR and a 14%-likely HR.** The 26% HR is almost 2x more likely to hit — that signal is completely invisible in the diversification ranking.

### Per-game and per-stat caps:
```
maxPerPlayer: 3     (at most 3 candidates from same player)
maxPerGame:   7     (MLB default — 7 candidates from one game can enter pool)
maxPerStat:   10    (at most 10 from same stat family)
maxPerStatSide: 6   (at most 6 overs for any stat family)
```
With 115 candidates spread across 30 games (~4 per game average) and 4 stat families (~29 per family), all caps are slack. The diversification step passes essentially all 115 candidates through to slip assembly. The real concentration control happens inside `buildSlipsForTier`.

---

## 9. AGGRESSIVE-LANE CONTAMINATION TRACE

**Aggressive tier: `allowedVolatility: ["balanced","aggressive","lotto"]`**

All 111 lotto-classified candidates plus all 4 aggressive-classified candidates are eligible for aggressive slip construction. This is correct by design — the aggressive tier is specifically built to accommodate the volatile end of the pool.

### Single-leg minimum failure:
The aggressive tier's minimum viable slip is 2 legs (legCountRange=[2,4]). With decimalOddsRange=[6.0, 120.0]:
- 1 HR at +350 = dec 4.5 → below floor → cannot form a 1-leg "aggressive" slip (technically no tier allows 1 leg anyway)
- 2 HR at +350 each = dec 4.5*4.5 = 20.25 → within [6, 120] ✓
- 2 HR at +500 each = dec 6*6 = 36 → within [6, 120] ✓
- BUT: 2-leg slip requires from different players and at most 2 per game

### modelProb gate elimination:
`minModelProb: 0.20` filters ~40–60% of HR candidates (those at prob=0.12–0.19). Only HR with predictedProbability ≥ 0.20 survive into aggressive scoring. Rough estimate: ~15–22 of 37 HR candidates pass.

### "Contamination" framing:
The question was whether lotto candidates "contaminate" the aggressive tier. The short answer: no. The aggressive tier is designed for lotto-volatility content. The seed-ordering logic (`volSeeds` first) actually prefers lotto/aggressive volatility legs as the slip starter. The aggressive tier is functioning correctly. The issue is not contamination — it is that the tier has a hard minimum combined-odds floor (dec 6.0) that a single +400 leg cannot clear alone, forcing 2+ leg constructions.

---

## 10. LOTTO-LANE TRACE

**Lotto tier: `legCountRange=[3,5], minModelProb=0.10, maxOdds=2000, decimalOddsRange=[20.0, 1500.0]`**

### Eligibility check for MLB tracked_best:
- `allowedVolatility: ["aggressive","lotto"]` → 115/115 candidates eligible ✓
- `minModelProb: 0.10` → 115/115 pass (all at 0.12+) ✓
- `maxOdds: 2000` → 115/115 pass (max is +600) ✓

### Minimum viable combination:
3-leg lotto slip, minimum odds requirement is dec ≥ 20:
```
3 HR at +250 each: dec 3.5³ = 42.9 ✓ (though +250 HR are rare)
3 HR at +350 each: dec 4.5³ = 91.1 ✓
3 HR at +500 each: dec 6³ = 216 ✓
3 RBI at +300: dec 4³ = 64 ✓
```
**The lotto tier is the one open lane for MLB offensive attack.** Three-leg HR parlays are mathematically valid and should be producing output.

### Structural limits inside lotto:
- `maxPerStat: 3` → at most 3 HR legs per slip (correct — avoids all-HR parlay)
- `maxPerGame: 2` → at most 2 candidates from same game
- `seenSignatures` dedupe → prevents identical slips from repeating

### Lotto output quality concern:
The lotto slip scores are driven by `scoreLeg()` composite (30% edge, 15% CLV, 10% timing, 10% book, 10% volatility, 5% archetype, 5% ladder, 5% diversification). Key issues for MLB lotto:
- CLV: most MLB candidates have no closing-odds data (`leg.clv` undefined) → defaults to `statFamilyClv` which may also be empty → defaults to 0.5
- Timing: no timing intelligence match for HR props (eventId=null) → defaults to 0.5
- Archetype: ledgerStats archetype ROI empty for new data → defaults to 0.5
- Tier hint: "PLAYABLE" tier → no boost/penalty → 0

**Result:** All 115 MLB lotto candidates score approximately the same composite (~0.65) because every context signal defaults to 0.5 and only edge differentiates them. The lotto slips that build are effectively sorted by edge only — which is better than nothing, but lacks the multi-factor richness the system was designed to express.

### Critical finding: The LOTTO tier produces valid MLB slips, but they carry no multi-dimensional intelligence beyond raw edge. Every contextual signal (CLV, timing, book profile, archetype trust) is defaulting to neutral because MLB candidates lack the contextual metadata that would feed those signals.

---

## 11. REALISMSCORE INFLUENCE TRACE

**`buildFeaturedPlays.js` — `f.volRealism` assignment:**
```javascript
f.volRealism = c.volatility === "safe"       ? 0.80 :
               c.volatility === "balanced"   ? 0.74 :
               c.volatility === "aggressive" ? 0.66 :
               c.volatility === "lotto"      ? 0.65 :
               0.56
```

**volRealism weight in `scoreCandidate()`:** 15% (as `f.volRealism * 0.15` contribution)

### Effect on MLB candidates:
- 111 lotto candidates receive `volRealism = 0.65`
- 4 aggressive candidates receive `volRealism = 0.66`
- 0 balanced/safe candidates exist

**Featured play consequence:** `scoreCandidate()` in `buildFeaturedPlays.js` ranks all featured candidates using a multi-factor composite. With lotto volRealism at 0.65, MLB offensive candidates score at the lower end of the volRealism dimension. They can still win ranking via edge (25% weight) but their volRealism score is 19% below safe (0.80) and 12% below balanced (0.74).

**The real problem in featured plays:** Featured play anchors are from the SAFE archetype (`allowedVolatility: ["safe","balanced"]`). Aggressive and lotto candidates cannot be featured anchors. The "supports" section has broader tolerance, but even there the composite ordering tends to favor lower-volatility candidates due to volRealism weight. MLB offensive attack props (100% lotto classified) are structurally anchored at the bottom of the volRealism dimension and excluded from featured anchors entirely.

---

## 12. CONSTRUCTION BOTTLENECK RANKINGS

Ranked by suppression severity (most damaging first):

### 1. No safe-lane data source for MLB (CRITICAL)
**Severity: 10/10**
The MLB nightly pipeline produces only high-odds attack candidates. There is no separate pipeline for confirmed-probable, low-juice MLB props. The safe tier is permanently empty for MLB because the data doesn't exist in any runtime file. Fixing this requires a separate safe-candidate pipeline, not a gate adjustment.

### 2. SAFE and BALANCED tier gates permanently exclude MLB attack board (CRITICAL)
**Severity: 9/10**
All three gates simultaneously fail for every tracked_best entry: volatility, modelProb, and maxOdds. The architecture was calibrated for a diverse NBA pool. MLB offensive candidates are structurally incompatible with the top two tiers.

### 3. No ELITE/STRONG ecology stamps for MLB (HIGH)
**Severity: 8/10**
MLB has no equivalent of `buildMlbPropClusters`' ELITE/STRONG stamps feeding into workstation scoring. All 115 candidates are "PLAYABLE" → tier boost in `scoreLeg()` never fires positively. A 5% boost on ELITE might not seem large, but it's the only signal that can lift a candidate above edge peers when all context signals default to 0.5.

### 4. Probability cap erases MLB model signal (HIGH)
**Severity: 7.5/10**
`clamp(0.50, 0.55, modelProb)` was correct for suppression-side parity but eliminates meaningful distinction between HR at 0.14 probability and HR at 0.28 probability. For NBA, where candidates range 0.35–0.75, the cap affects only the tail. For MLB, the cap eliminates ~all real signal since the entire attack board lives at 0.12–0.35.

### 5. Missing contextual metadata on enrichBestEntry candidates (HIGH)
**Severity: 7/10**
CLV, timing intelligence, book profile, and archetype trust all default to neutral (0.5) for MLB candidates because:
- `leg.clv` not populated (closing odds not in tracked_best)
- `eventId` is null on tracked_best (known weakness #15 in CURRENT_STATE)
- Timing map cannot match on null eventId
- Archetype ROI empty until results are entered

The composite score for ALL MLB candidates is approximately `0.65 ± 0.05`. No candidate can differentiate. Slips built are edge-sorted parlays with no multi-signal intelligence.

### 6. eventId=null on tracked_best (HIGH)
**Severity: 6.5/10**
Both `gameKey()` in slip assembly and timing lookups rely on eventId or matchup. With eventId=null and matchup=null on all tracked_best entries, the `gameKey()` function returns null. This means:
- `maxPerGame` cap cannot be applied (returns null → no game key → game checks skipped)
- Same-game-over script correlation guard cannot fire (gk is null → entire block skips)
- Timing map lookups cannot match

With null gameKeys, multiple HR props from the same game can freely appear in any slip tier without the per-game limits applying. This is both a missed diversity opportunity AND a missed protection — 5 HR from the same stadium could appear in a 5-leg lotto slip.

### 7. Single-leg aggressive minimum floor (MEDIUM)
**Severity: 5/10**
HR at +350 = dec 4.5, below the aggressive tier minimum of dec 6.0. Single HR legs cannot anchor aggressive slips. This forces 2-leg combinations as the minimum viable entry into aggressive slips. Not catastrophic but reduces the solution space.

### 8. maxPerStat=3 in lotto (LOW-MEDIUM)
**Severity: 3/10**
Correctly limits HR concentration in lotto slips. The design is sound. A 5-leg all-HR parlay would have extreme same-ecosystem correlation. The cap is right, though it means HR can never be the sole stat family in a lotto slip.

---

## 13. EXACT OFFENSIVE FAILURE CHAIN

The complete suppression chain from tracked_best to construction output:

```
mlb_tracked_best_2026-05-09.json (115 entries)
  │
  ├── ALL are overs (unders discarded at cluster level — buildMlbPropClusters.js)
  ├── ALL are at odds > +250 (high-odds attack board only)
  ├── NO volatility stamp at this point
  │
  └── enrichBestEntry() → normalized candidate
        ├── odds field SET (passes to classifyVolatility)
        ├── volatility NOT set (no snapshotSourced, no pre-classification)
        ├── eventId: null (gameKey returns null everywhere downstream)
        └── confidenceTier: "PLAYABLE" (no ELITE/STRONG in ML nightly)

  └── classifyVolatility(raw) via VOLATILITY_RULES
        ├── Rule 1: odds >= 350 → lotto   → 111 candidates
        └── Rule 7: odds >= 200 → aggressive → 4 candidates
        Result: {safe:0, balanced:0, aggressive:4, lotto:111}

  └── SAFE tier filter
        ├── allowedVolatility check → FAILS for all 115 (lotto/aggressive not in ["safe","balanced"])
        ├── premiumEdgeOverride check → FAILS (modelProb 0.12–0.35, need >= 0.50)
        └── 0 candidates enter SAFE slip assembly

  └── BALANCED tier filter
        ├── 4 aggressive candidates pass volatility (aggressive in ["safe","balanced","aggressive"])
        ├── minModelProb: 0.45 → all 4 at 0.20–0.32 → BLOCKED
        └── 0 candidates enter BALANCED slip assembly

  └── AGGRESSIVE tier filter
        ├── All 115 pass volatility (lotto/aggressive both allowed)
        ├── minModelProb: 0.20 → ~50 candidates blocked (prob < 0.20)
        ├── maxOdds: 600 → 1–3 candidates blocked (odds at +600)
        ├── Remaining: ~60 candidates eligible for aggressive scoring
        ├── decimalOddsRange: [6.0, 120.0] (checked during trimming)
        │     Single legs fail dec 6.0 floor → minimum 2-leg construction required
        ├── gameKey = null → maxPerGame cap cannot apply → unbounded per-game
        └── AGGRESSIVE SLIPS: BUILD (2+ leg cross-player combinations)

  └── LOTTO tier filter
        ├── All 115 pass (both gates are permissive: minModelProb=0.10, maxOdds=2000)
        ├── decimalOddsRange: [20.0, 1500.0] — 3+ legs required (dec^3 >= 20)
        ├── maxPerStat: 3 → max 3 HR legs
        ├── gameKey = null → maxPerGame cap cannot apply
        └── LOTTO SLIPS: BUILD (3–5 leg cross-player HR/TB/RBI parlays)

  └── FEATURED PLAYS (buildFeaturedPlays.js)
        ├── Anchors: allowedVolatility=["safe","balanced"] → 0 MLB candidates
        ├── Supports: broader tolerance but volRealism=0.65 (lotto) drags composite
        └── Featured plays: ALL anchors are safe/balanced (NBA or empty for MLB)
```

**Net result:** MLB offensive ecosystem is a 1-lane system (lotto only, aggressive partially). Safe and balanced are structurally empty. Featured anchors contain zero MLB offensive candidates. The bettor sees either: (a) HR/TB/RBI parlays in the lotto slip section, or (b) nothing from the MLB attack board in featured anchors.

---

## 14. WHAT SHOULD STAY

These elements are working correctly and must not be changed:

### enrichBestEntry field mapping
The `edge = e.edgeProbability`, `modelProb = e.predictedProbability` mapping is correct. The `odds` passthrough is correct. No change required.

### VOLATILITY_RULES odds-based classification
The `odds >= 350 → lotto` and `odds >= 200 → aggressive` rules correctly classify the MLB attack board. These rules are calibrated right. HR correctly lands in lotto (primarily via odds gate, secondarily via stat family).

### The `[0.50, 0.55]` probability cap
Correct fix for suppression-side distortion. The side effect on MLB is real but removing the cap would break NBA parity. The MLB signal gap requires a different fix (MLB-specific ecology tier stamps), not removing the cap.

### LOTTO tier templates
decimalOddsRange [20, 1500], legCountRange [3,5], maxPerStat=3 — these are correctly tuned for high-odds parlays. MLB HR 3-leg combinations produce valid, meaningful lotto parlays.

### AGGRESSIVE tier templates  
decimalOddsRange [6, 120], maxPerGame=2, minModelProb=0.20 — correct constraints. The 2-leg minimum for MLB offensive candidates is a reasonable structural outcome given that the MLB attack pool is all high-odds single props.

### Script correlation guard firing threshold
`legCountRange[1] <= 3` for the correlation guard is correct. Allowing aggressive and lotto tiers to accumulate same-game overs (up to maxPerGame) reflects the real product — these are high-risk slips where same-game stacking is acceptable.

### buildMlbPropClusters quality gates
HR `pred >= 0.12 OR edge >= 0.08` is the correct filter for getting useful signal. Do not loosen this.

---

## 15. WHAT SHOULD EVENTUALLY DIE

### 1. Implicit assumption that MLB uses the same volatility architecture as NBA
The tier templates were designed for NBA's natural probability distribution (0.35–0.75 modelProb). MLB offensive attack (0.12–0.35) doesn't fit. The architecture should eventually have MLB-specific probability floor thresholds, or a sport-aware tier template override mechanism.

### 2. "PLAYABLE" as the default confidenceTier for all MLB candidates
The nightly pipeline produces `hrCluster`, `tbCluster` etc. with scoring buckets, but the workstation doesn't translate those into ELITE/STRONG stamps. Enriching tracked_best entries with real quality tiers would unlock the tier boost in `scoreLeg()`.

### 3. Null eventId on all tracked_best entries
This is a known weakness. Until fixed, game-based per-game caps and script correlation guards are blind to game identity for the MLB attack board. This is a fixable plumbing problem (Priority 15 in NEXT_SESSION.md).

### 4. The "one size fits all" probability cap for both sports
The `[0.50, 0.55]` cap was added to fix an NBA-specific distortion (under-heavy snapshot with structurally compressed probability). For MLB, the effect is to eliminate all model signal differentiation. Eventually this should be sport-specific: NBA uses `[0.50, 0.55]`, MLB offensive uses `[0.35, 0.45]` or similar.

### 5. Absence of any safe-candidate MLB pipeline
The MLB construction will always be lotto-dominant as long as the only data source is the high-odds attack board. A safe/balanced MLB candidate pipeline (tracking -110 to +150 props for confirmed-probable outcomes) would fill the two dead tiers and produce a genuinely diverse MLB slip output.

---

## 16. LOWEST-RISK NEXT PATCH TARGET

### Fix: eventId/matchup null on tracked_best entries

**Risk: LOW. Impact: HIGH.**

This is a pure plumbing fix in `phase4Tracking.js` and/or `buildMlbPropClusters.js`. When nightly tracking writes `tracked_best.entries`, the `eventId` and `matchup` fields should be populated from the cluster source data.

**Why this is lowest-risk:**
- No scoring logic changes
- No tier template changes
- No volatility architecture changes
- Purely additive field population
- The downstream code already expects and uses eventId/matchup correctly — it simply receives null today

**Impact when fixed:**
- `gameKey()` returns real values → `maxPerGame` cap becomes operative
- Script correlation guard (if ever triggered) can fire correctly
- Timing map lookups gain match candidates
- Same-game concentration tracking becomes accurate

**This is Priority 15 in NEXT_SESSION.md. Elevate to Priority 1A (MLB) after NBA-2.D is complete.**

---

## 17. MOST DANGEROUS PATCH TARGET

### Do NOT touch: VOLATILITY_RULES for MLB-specific HR/TB changes

**Risk if touched: CRITICAL. MLB + NBA regression guaranteed.**

VOLATILITY_RULES is shared between NBA and MLB. Any change to make HR "less lotto" (e.g., lowering the odds threshold from 350 to 200) would affect NBA HR props too, opening them into aggressive slips where they don't belong. The rules are sport-agnostic by design.

**Equally dangerous:** Changing the `[0.50, 0.55]` probability cap to benefit MLB without understanding its NBA impact. The cap was added specifically to fix an NBA under-heavy suppression problem. Removing it creates a new NBA distortion.

**Also dangerous:** Adding MLB-specific code directly to `buildSlipAi.js` or `buildFeaturedPlays.js`. The shared modules cannot carry sport-specific decision trees. Follow the nbaVolatilityResolver pattern — any MLB-specific adaptation must live in a dedicated `mlb/` adapter.

**Also dangerous:** Adjusting the tier templates (minModelProb, maxOdds, decimalOddsRange) to let MLB through. These thresholds define safe slip identity. Lowering minModelProb=0.55 to 0.35 to admit HR into safe slips fundamentally changes what "safe" means for every sport.

---

## 18. RECOMMENDED MLB EVOLUTION ORDER

**This is a sequenced plan. No phase should begin before its prerequisite is verified.**

---

### Phase MLB-1: Fix eventId/matchup null (IMMEDIATE — LOW RISK)
**Prerequisite:** None. Can begin now.
**Files:** `pipeline/mlb/phase4Tracking.js`, `pipeline/mlb/buildMlbPropClusters.js`
**Scope:** Trace where eventId and matchup should be populated during nightly processing. Wire the fields through so tracked_best entries carry real game identifiers.
**Model:** Sonnet — plumbing fix, pure additive.
**TERM 1 restart:** NO (nightly script change only).

---

### Phase MLB-2: Add ELITE/STRONG ecology stamps to MLB nightly pipeline
**Prerequisite:** MLB-1 (eventId must be correct so game-level stamp assignment is possible).
**Files:** `pipeline/mlb/buildMlbPropClusters.js`, `pipeline/mlb/phase4Tracking.js`
**Scope:** Add ecology tier stamps to cluster entries:
- HR: edge ≥ 0.10 AND pred ≥ 0.20 → STRONG; edge ≥ 0.14 AND pred ≥ 0.24 → ELITE
- TB: edge ≥ 0.08 AND pred ≥ 0.25 → STRONG; edge ≥ 0.12 AND pred ≥ 0.30 → ELITE
- RBI: edge ≥ 0.07 AND pred ≥ 0.28 → STRONG; edge ≥ 0.10 AND pred ≥ 0.32 → ELITE
- Hits: same pattern

Persist stamps into tracked_best entries as `bucket`. Update `enrichBestEntry` to read the stamp and set `confidenceTier` correctly.
**Model:** Sonnet — additive stamping, no tier gate changes.
**TERM 1 restart:** NO (nightly only, no server change).

---

### Phase MLB-3: MLB-specific probability floor in diversifyCandidates
**Prerequisite:** MLB-2 (stamps must exist to enable meaningful signal).
**Scope:** Make `clamp(lo, hi, modelProb)` sport-aware. For MLB offensive candidates:
```javascript
// MLB offensive attack: probability range is 0.12–0.35
// Use [0.35, 0.45] floor instead of [0.50, 0.55] to restore model signal
const probFactor = sport === "mlb" && isOffensiveAttackStat(leg.statFamily)
  ? clamp(0.35, 0.45, conf)
  : clamp(0.50, 0.55, conf)
```
This restores signal: a 0.26-prob HR now sorts above a 0.14-prob HR.
**Risk:** Low for MLB. NBA unchanged. Must verify no suppression-side regression for MLB unders.
**Model:** Sonnet — surgical 2-file change (diversifyCandidates + scoreLeg in buildSlipAi).
**TERM 1 restart:** YES.

---

### Phase MLB-4: MLB safe-candidate pipeline (NEW DATA SOURCE)
**Prerequisite:** MLB-1, MLB-2, MLB-3 stable for ≥5 nightly cycles.
**Scope:** Build a separate "mlb_safe_candidates" tracking pipeline for props at -200 to +150 (confirmed-probable outputs like Shohei 1+ hit, Freeman 1+ RBI). This is a new cluster type in `buildMlbPropClusters.js` with separate quality gates:
- `predictedProbability >= 0.45`
- `edge >= 0.03`
- `Math.abs(odds) <= 150`

These candidates would be safe/balanced-classified by VOLATILITY_RULES (odds < 200 → safe/balanced fallthrough). They would populate the dead safe and balanced tiers for MLB.
**Risk:** Medium — new pipeline, new file reads, new tracking files. Additive but involves new nightly output.
**Model:** Sonnet for implementation; Opus for design review.
**TERM 1 restart:** YES.

---

### Phase MLB-5: Sport-specific tier template overrides (LONG-TERM)
**Prerequisite:** MLB-4 stable, at least one full month of reviewed data.
**Scope:** Allow `buildAiSlips()` to receive sport-specific tier overrides. For MLB:
```javascript
// MLB aggressive: lower minModelProb to 0.15 to unlock more HR/TB candidates
// MLB aggressive: raise decimalOddsRange floor from 6.0 to 4.0 to allow single +300 legs
const tierOverrides = sport === "mlb" ? {
  aggressive: { minModelProb: 0.15, decimalOddsRange: [4.0, 120.0] }
} : {}
```
This is the last phase — requires full trace of downstream effects and calibration data to validate.
**Risk:** HIGH — touches tier templates. Requires Opus audit + multi-slate testing.
**Model:** Opus audit first; Sonnet implementation.

---

## SUMMARY TABLE

| Phase | Target | Risk | Prerequisite |
|---|---|---|---|
| MLB-1 | Fix eventId/matchup null | LOW | None |
| MLB-2 | ELITE/STRONG stamps in nightly | LOW | MLB-1 |
| MLB-3 | Sport-specific prob floor | LOW-MEDIUM | MLB-2 |
| MLB-4 | Safe-candidate pipeline (new data) | MEDIUM | MLB-3 stable |
| MLB-5 | Sport-specific tier templates | HIGH | MLB-4 + calibration data |

**Do not skip phases. Do not combine MLB-1 with MLB-3. Do not attempt MLB-5 before calibration data exists.**

---

## APPENDIX: KEY NUMBERS FROM LIVE DATA

```
Tracked_best pool (2026-05-09):   115 entries
  Stat distribution:  HR=37, TB=30, RBI=27, Hits=21
  Side:               100% overs (0 unders)
  Odds range:         +250 to +600 (all high-odds)
  predictedProbability range:  0.12–0.35

Volatility classification (via VOLATILITY_RULES):
  safe:       0
  balanced:   0
  aggressive: 4  (RBI at +250–+349)
  lotto:     111  (HR/TB/high-odds RBI/Hits)

Tier eligibility (candidates passing initial filters):
  SAFE:       0  (fails volatility + modelProb + maxOdds simultaneously)
  BALANCED:   0  (4 aggressive pass volatility but fail modelProb ≥ 0.45)
  AGGRESSIVE: ~60  (pass volatility + maxOdds; fail: ~50 on modelProb < 0.20)
  LOTTO:     115  (all pass; minimum 3-leg construction required)

SAFE tier premium-edge override:
  Requires modelProb ≥ 0.50 AND edge ≥ 0.12
  MLB tracked_best: max modelProb ~0.35 → override dead

decimalOddsRange checks during assembly:
  AGGRESSIVE [6.0, 120.0]:  single HR at +400 = dec 5.0 → below floor
                             2-leg HR at +400×+400 = dec 25 → PASS
  LOTTO [20.0, 1500.0]:     3-leg HR at +350×+350×+350 = dec 91 → PASS
                             5-leg HR at +400×+400×+400×+400×+400 = dec 3125 → trimmed to 4

eventId null rate:    115/115 (100%) — all tracked_best game keys are null
```

---
_End of MLB Construction Trace V1. Session AD — read-only. No code changes. No patches._
