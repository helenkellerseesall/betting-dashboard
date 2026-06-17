# POST-FREEZE SELECTION RE-POINT SPEC (MLB)

**Status:** PRE-FREEZE SPEC — execute, don't design, on/after the R2 freeze lift (~2026-06-25).
**Author:** Claude-B (CB) · 2026-06-17 · read-only planning turn (no code changed).
**Read-order anchor:** sits UNDER `docs/POST_FREEZE_GRADUATION_PLAN.md`. This re-point is a
SCORING/SELECTION change → frozen until the R2 window lifts AND G1 calibration has graduated
(see §3 Sequence). Brain read-order: MASTER_BRAIN → OPERATOR_PROTOCOL → ACTIVE_INCIDENTS →
PIPELINE_AUTHORITY_MAP → ARCHITECTURE_LAWS → this spec via the graduation plan.

---

## 0. WHY (the evidence base — already gathered)

The selection engine bets the **longshot ceiling**, not the obtainable rungs. Confirmed:
- 79% of all tracked picks are LONGSHOT tier; capture-by-line shows the engine surfaces
  high-line ceilings (e.g. totalBases o4.5, rbis o1.5+) and barely the floors (o0.5/≥1).
- Edge-hunt + pre-registered OOS forward-confirmation (`.scratch/selection_edge_oos.txt`,
  `[[project-selection-edge-target]]`): the CLV+ signal sits on the **obtainable LOW rungs**
  and **mod-dog odds**, and it **held OOS** (held-out days): rbis LOW +0.34→**+0.23pp**,
  hits LOW +0.24→**+0.12pp**, mod-dog (+100..199) +0.24→**+0.15pp**, low-confidence (<0.2)
  +0.25→**+0.13pp**, line-shop +0.61→**+0.59pp** — 5/5 held. The ceilings the engine bets
  are flat/fairly-priced. CLV→ROI monotonicity did NOT replicate (variance) → select for the
  CLV+ slices, do NOT promise the ROI magnitude.
- G4 capstone: the model's own +EV picks still realize model>market>reality on the current
  (ceiling) population. So the re-point MUST be paired with G1-calibrated modelProb, or it
  just re-weights a still-overconfident signal.

**Target after re-point:** surface obtainable LOW/obtainable rungs (rbis/hits ≥1, i.e.
over0.5; totalBases o1.5; runs o0.5), mod-dog-priced legs (+100..199), and lower-confidence
legs that carry +CLV — ranked on **G1-calibrated** modelProb so honest floors out-rank
fake-edge longshots. Line-shop edge is already baked (docket #1, surfaced on /m).

---

## 1. FILE A — `backend/pipeline/mlb/buildMlbBootstrapSnapshot.js` (NOT frozen; signalScore feeder)

### 1A. How it currently biases to high-line longshots (cites)
Two proxy scorers feed `signalScore` (the row-ranking signal that decides what surfaces):

- **`computeMlbHrPathProxyScore`** (`:150-190`), weight 0.18 (`:305`):
  - `payoutSignal` (`:160-166`) **rewards longshot odds**: +450..+1200 → **1.0**, +300..449 →
    0.82, +200..299 → 0.54, else 0.2. The fattest reward band is the longshot band.
  - `marketShape` (`:171-179`) **rewards high TB lines**: total_bases line **≥2.5 → 0.90**,
    **≥1.5 → 0.74**, **<0.5 → 0.55** (floors scored LOWEST). HR (`:173`) line≤0.5 → 0.95.
  - `extremeLongshotPenalty` only at **odds>1700** (`:181`) — so +450..+1700 is unpenalized.
- **`computeMlbOverCountingProxyScore`** (`:192-238`), weight 0.20 (`:308`) — THE direct
  obtainable-vs-ceiling lever for hits/rbis/runs:
  - `payoutSignal` (`:203-208`) rewards plus-odds (+140..260 → 0.95).
  - `lineSignal` (`:210-227`) **demotes obtainable lows**:
    - hits: ≥2.5 → **0.92**, ≥1.5 → 0.78, ≥0.5 → 0.62, <0.5 → **0.45**
    - rbis: ≥1.5 → **0.90**, ≥0.5 → **0.72**, <0.5 → 0.48
    - runs: ≥1.5 → **0.90**, ≥0.5 → **0.72**, <0.5 → 0.48
  - i.e. the OOS-confirmed CLV+ rung (rbis/hits over0.5) is scored ~0.62–0.72 while the
    fairly-priced ceiling (≥1.5/≥2.5) is scored ~0.90 → ceiling out-ranks floor.

### 1B. Precise re-point (spec — do not code yet)
- **Invert `lineSignal` toward the obtainable floor** in `computeMlbOverCountingProxyScore`:
  give the obtainable rung the TOP score and the ceiling the lowest. Concretely:
  - hits: over0.5 (≥1) → **0.90**, ≥1.5 → 0.65, ≥2.5 → **0.45**
  - rbis: over0.5 (≥1) → **0.90**, ≥1.5 → **0.50**
  - runs: over0.5 (≥1) → **0.90**, ≥1.5 → **0.50**
- **Re-band `payoutSignal`** to favor mod-dog (+100..199), the OOS-confirmed CLV+ price band,
  over deep longshots: peak the reward at +100..199 (→1.0), taper above +260.
- **`computeMlbHrPathProxyScore`**: flip `marketShape` for total_bases so o1.5 ≥ o2.5/o3.5
  (do NOT invert HR — HR is genuinely a ceiling prop and HR calibration is honest, see §5).
  Lower the longshot `payoutSignal` band so +450..1200 no longer scores 1.0.
- **Net intent:** the floors out-rank the ceilings in `signalScore`, so the board surfaces
  the obtainable rungs. Pair with §3 (calibrated modelProb) so the signal is honest.

---

## 2. FILE B — `backend/pipeline/mlb/buildMlbInspectionBoard.js` (NOT frozen; eligibility/penalty gates)

### 2A. How it currently excludes/penalizes the obtainable rungs (cites)
- **`computeNegativeDirectionalPropPenalty`** (`:418-449`): `batter_hits over ≤0.5 → 0.20`
  penalty (`:425`) — directly penalizes the obtainable "get any hit" (≥1 hit) rung the
  edge-hunt found CLV+. (Other entries here correctly penalize UNDER/bad-outcome shapes —
  leave those.)
- **`classifyRowTier`** (`:469-506`): **hard-excludes** (returns null → not eligible for
  safe OR upside) the trivially-easy alt-overs (`:486-491`):
  - `batter_hits` alt line ≤0.5 → null (`:488`)
  - `pitcher_strikeouts` alt line ≤2.5 → null (`:489`)
  - `total_bases` alt line ≤1.5 → null (`:490`)
  - Tier bands: safe = implied 52–78% (`:496`), upside = implied 38–62% (`:502`).
- **`computeLowInformationPenalty`** (`:273-298`): note it penalizes total_bases ≥1.5
  (`:294`, 0.08) — a mild counter-pressure; leave or fold into the re-band.

### 2B. Precise re-point (spec)
- **Remove / invert the `batter_hits over ≤0.5 → 0.20` penalty** (`:425`): the obtainable
  ≥1-hit rung is the CLV+ target, not a "trivially weak" filler. Keep the UNDER penalties.
- **Stop hard-excluding obtainable alt-overs** in `classifyRowTier` (`:486-491`): the floors
  (hits alt ≤0.5, total_bases alt ≤1.5) should be ELIGIBLE (route to a new "floor/obtainable"
  classification or into `upside`), GATED by **calibrated modelProb + +CLV slice membership**
  rather than line-triviality. Keep the absurd-chalk/absurd-longshot hard excludes
  (`:483-484`).
- **Widen the safe/upside implied bands** so obtainable floors at -150..-250 (≥1 hit/rbi
  prices) are admissible to a floor tier (they realize ~CLV+; they were being shut out by the
  "trivially easy" rule, not by price).

---

## 3. FILE C — `backend/pipeline/mlb/buildMlbPropClusters.js` `tierForPlay` (R2-FROZEN; badge/tier)

### 3A. Current logic (cites)
`tierForPlay(edge, ev, conf, family, oddsAmerican, modelProb)` (`:751-800`):
- Gates: `ev<=0 → FADE` (`:760`), `edge<0.04 → FADE` (`:761`).
- R2 caps → PLAYABLE max: mid-fav non-HR, `ks`, `totalBases` (`:779-782, :798`).
- ELITE: `edge≥0.10 && ev≥0.05 && conf≥0.56` (`:784`); STRONG (non-HR): `edge≥0.075 &&
  ev≥0.032 && conf≥0.42` (`:798`).
- **`modelProb` is threaded but PLUMBED-UNUSED in v1** (`:755-756`) — "kept ready for a
  governed v2; NO v1 predicate reads it." `edge`/`ev` are computed upstream from RAW
  modelProb today.

### 3B. Precise re-point (spec — this is the governed **v2**, version-bumped)
- **The actual lever is the INPUT, not tierForPlay's predicates:** `edge`/`ev` must be
  recomputed from **G1-calibrated** modelProb (graduated first — see §3 Sequence). Once edge
  is honest, the fake-edge longshot ceilings fall to `ev<=0 → FADE` (`:760`) on their own, and
  the obtainable floors (genuinely +edge after calibration) clear the gates. **Minimal
  tierForPlay change** — most of the re-point happens upstream (Files A/B + calibrated input).
- If a v2 predicate IS added, use the now-live `modelProb` (`:755`) only to **prefer the
  obtainable CLV+ cells** (e.g. do not demote rbis/hits floors that the calibrated prob +
  CLV scoreboard support). Keep ks/totalBases/mid-fav caps unless OOS CLV says otherwise.
- **Version bump:** any change here bumps the tier policy stamp from `mlb-r2-v1` →
  `mlb-r2-v2` (`:1163` stamp site) per the frozen-base doctrine (§4, §5).

---

## 4. SEQUENCE / DEPENDENCY (binding order)

1. **G1 calibration graduates FIRST** (per `docs/POST_FREEZE_GRADUATION_PLAN.md`). The
   re-point relies on calibrated modelProb feeding `edge`/`ev`; re-pointing on RAW modelProb
   would just re-rank a still-overconfident signal (G4 lesson). G1 forward-validation gate +
   operator approval precede this.
2. **Then Files A → B** (un-frozen signalScore + eligibility) so the board SURFACES the floors.
3. **Then File C v2** (tierForPlay input swap to calibrated edge/ev) — version-bumped.
4. One file at a time, each behind its own flip + ≥1 week live watch (§5). Do NOT bundle.

---

## 5. VALIDATION PLAN (how we confirm + keep it reversible)

- **VERSION STAMP** (R2 `tierPolicy` pattern, `:1163`): stamp a `selectionPolicy` /
  `mlb-r2-v2` version on every surfaced + tracked row so the new selection is filterable,
  measurable, and reversible. The 14d verify + edge-hunt filter on the stamp.
- **KILL-SWITCH** per file (env, read-once, default-OFF-until-graduated; `MLB_NB_LADDER`
  pattern): OFF ⇒ byte-identical to pre-re-point. Each flip is independently revertible.
- **FORWARD CLV per slice:** after each flip, re-run `node backend/scripts/clvCaptureFunnel.js`
  + the edge-hunt OOS probe grouped by line-tier/odds/confidence. Confirm (a) the board now
  surfaces the obtainable rungs (line distribution shifts from ceiling→floor), and (b) those
  rungs stay CLV+ on the NEW forward days (not just the historical in/OOS sample).
- **Watch ≥1 week live** before scaling stakes; the OOS confirmation was one date-split with
  small cells — magnitude unproven (CLV→ROI did not replicate). Select for the signal; prove
  the dollars forward.
- **Regression gate:** runtime:verify green; tiers/scores diff-checked OFF vs ON (OFF
  byte-identical); pick-count + grading unchanged.

---

## 6. GUARDRAILS (do not break these)

- **HR exemption:** HR calibration is only +3pp off (nearly honest) and HR IS a legit ceiling
  prop. Do NOT invert HR line-shape or HR caps. (Files A `:173`, C `:794-797` HR-specific.)
- **Line-shop edge already baked** (docket #1): best-price + book + gap surfaced on /m
  Discover + pick cards. The re-point is additive to it, not a replacement.
- **Integrity guardrails** (`[[betting-integrity-manipulation-reality]]`): exclude single-actor
  micro-markets / low-limit two-way props from any newly-surfaced obtainable set; treat
  anomalous line moves as a RED flag (suppress, never promote). The floors we surface must be
  role-floored STAR props, not manipulation-prone micro-markets.
- **Calibrated-only:** never surface/rank on RAW modelProb post-flip (G4: raw inverts edge).
- **PRESERVED + frozen:** do NOT edit `makePlay`/scoring math beyond the governed,
  version-bumped tierForPlay input swap; Files A/B are un-frozen but still SCORING/SELECTION
  → only post-freeze, kill-switched, version-stamped.

---

## 7. EXECUTE-DAY CHECKLIST (the 25th)

1. Confirm G1 graduated + forward-validated (gate in graduation plan).
2. Flip File A (signalScore re-point) behind kill-switch + stamp → watch line-distribution
   shift + forward CLV ≥1 wk.
3. Flip File B (inspection eligibility) → watch obtainable rungs become eligible + CLV holds.
4. Flip File C v2 (calibrated edge/ev into tierForPlay, version bump mlb-r2-v2) → watch tiers.
5. Re-run edge-hunt + funnel after each; revert any flip whose forward CLV does NOT hold.
6. Only scale stakes after ≥1 week of forward CLV+ on the obtainable rungs.
