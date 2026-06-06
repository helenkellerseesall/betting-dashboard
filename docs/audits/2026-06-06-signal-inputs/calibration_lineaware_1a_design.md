# Phase Calibration-LineAware-1A — DESIGN DOC (read-only, no code)

Date: 2026-06-06. Unblocked by Signal-Fill-1A (5 fixes shipped → corpus now has real per-pick variation).
GOAL: un-freeze the MLB dampener AND make it line-aware, so it stops over-suppressing common easy-line picks
with longshot-line data. predictionId untouched (tier-1). calibrationDampener.js + nbaModelSignals.js are
load-bearing. Operator approves this design before any code.

## CURRENT STATE (verified)

- Live dampening path: workstationRoutes.js:2101 → `applyCalibrationDampener(pick)` (calibrationDampener.js:321)
  → `dampenModelProb(raw, sport, fam, side)` → `getCalibrationForFamily(sport, fam, side)` →
  `_queryCorpus()`. `dampenModelProb`/`getCalibrationForFamily` have NO external callers — only
  applyCalibrationDampener. So `line` threads INTERNALLY from the pick; workstationRoutes is unchanged.
- The pick carries `line` (e.g. 2.5), `side` ("Over"), `propType` ("Total Bases"); `statFamily` may be
  undefined → dampener already reads `pick.statFamily || pick.propType`.
- `_queryCorpus` currently uses the id-join (`ps.id = os.id`) + a NOTE that the book-agnostic column join is
  built-but-held pending THIS phase. MLB join frozen (book divergence). Consts: MIN_SAMPLE_SIDE 20,
  MIN_SAMPLE_FAMILY 30, MULTIPLIER_FLOOR 0.20, CEILING 1.10, CACHE_TTL 5min.
- `calibrationFeedback.getCalibrationFactor({sport,statFamily,side})` is a SEPARATE second layer (line-agnostic,
  id-joined) consumed IN-scoring by buildNbaBestBetsBoard.js:274 + buildMlbPropClusters.js:8.

## 1. API SHAPE

`dampenModelProb(modelProb, sport, family, side, line = null)`
- `line`: the numeric prop line (`pick.line`). NULL/undefined allowed → behaves line-agnostic (current
  behavior) for backwards-compat and for non-line markers.
- Non-line markers (moneyline/runline/spread/yes-no specials): line is null or the number is baked into the
  side. Treat these as line-agnostic — they route to the (family, side) bucket, never a line bucket. (firstHR,
  moneyline, runline → line-agnostic.)
- Backwards-compat during rollout: `line` is the LAST positional param and optional. Any caller that doesn't
  pass it gets today's family-side behavior. Only `applyCalibrationDampener` is updated (to pass `pick.line`);
  it's the single consumer, so the blast radius is one internal call. workstationRoutes UNCHANGED.
- `getCalibrationForFamily(sport, family, side, line = null)` — same optional-line contract.

## 2. BUCKETING STRATEGY

Core: per `(sport, family, side, line)`. The line-bias that froze us is REAL and family-shaped:

- LINE-HETEROGENEOUS families — each line is a DIFFERENT difficulty, so lines must NOT be pooled:
  MLB hits (0.5=1+ hit ~65% / 1.5=2+ ~25% / 2.5=3+ ~7%), HR, RBI, TB, batterKs, pitcher Ks rungs. For these,
  pooling lines is exactly what caused the over-suppression (hits|over corpus 95% line-2.5, stated 0.394 vs
  realized 0.068 → a family-side multiplier of ~0.17→floor 0.20 applied to the common 1.5 picks).
- LINE-HOMOGENEOUS families — nearby lines have ~similar hit rates (a 50% over is ~50% at 20.5 or 22.5):
  NBA points/rebounds/assists/pra/threes (continuous). Here a small line RANGE bucket is defensible and
  preserves sample size.

PROPOSAL: a per-family `lineMode` config:
  - `exact`  (MLB rungs): bucket by exact line.
  - `range:N` (NBA continuous): bucket by line rounded to nearest N (e.g. round to integer, so 20.5/21.5 share
    a bucket but 20.5/27.5 don't). Start N=2.
  - `agnostic` (moneyline/specials): no line bucket — family-side only.

FALLBACK LADDER (getCalibrationForFamily):
  1. (sport, family, side, lineBucket) if n ≥ MIN_SAMPLE_LINE  → use it.
  2. If family is line-HOMOGENEOUS: (sport, family, side) family-side if n ≥ MIN_SAMPLE_SIDE → use it.
     If family is line-HETEROGENEOUS: DO NOT fall back to family-side (that's the biased aggregate that froze
     us) → go to step 3.
  3. null → NO dampening (multiplier 1.0). Honest: don't dampen what we can't calibrate per-line.

MIN_SAMPLE_LINE: propose 25 (between the existing 20/30). Per-line buckets are thinner; this trades coverage
for not-calibrating-noise. Tunable. Consequence: initially FEW line buckets dampen (the corpus is thin
per-line even after signal-fill); coverage GROWS as grading accumulates. This is the safe direction —
under-dampening (1.0) never over-suppresses.

## 3. CORPUS JOIN (un-freeze)

`_queryCorpus` flips from the id-join to the BOOK-AGNOSTIC COLUMN join (the held work) AND adds `line`:
  SELECT sport, stat_family, side, line, COUNT(*) n, AVG(model_prob) stated, AVG(hit) realized
  FROM (prediction rows deduped by run_date,sport,player,stat_family,side,line)
  JOIN (outcome rows deduped by run_date,sport,player,stat_family,side,line)  -- book dropped
  GROUP BY sport, stat_family, side, line
This un-freezes MLB (book divergence was the freeze) AND gives per-line buckets in one move. Bucketize into
sports[sport][family][side][lineBucket] = {n, stated, realized, multiplier} + keep a [side] family-side
aggregate ONLY for line-homogeneous families.

## 4. calibrationFeedback.js MIGRATION

It's the SECOND correction layer (in-scoring, capped ±, consumed by buildNbaBestBetsBoard + buildMlbPropClusters).
Same id-join → same MLB freeze. Two questions answered:
- Does it need line-awareness? Its effect is a smaller in-scoring nudge, NOT the final honesty multiplier. The
  line-bias hits it too, but with lower stakes. RECOMMEND: keep getCalibrationFactor LINE-AGNOSTIC for now but
  switch its join to book-agnostic (un-freeze MLB) — a 1-line query change, no call-site changes (still
  family-side). Add line-awareness later only if post-rollout data shows it over/under-correcting.
- Sequence: ship the DAMPENER line-aware FIRST (the primary honesty layer, contained migration). Then, as a
  SEPARATE commit, switch calibrationFeedback to the book-agnostic join (family-side). That keeps each commit
  bisectable and limits blast radius. The 2 call sites (buildNbaBestBetsBoard:274, buildMlbPropClusters:8) are
  UNCHANGED in 1A (getCalibrationFactor signature unchanged).

## 5. ROLLOUT SEQUENCE (each step its own fence, regression-gate-first)

- 5.1  _queryCorpus → book-agnostic column join + `line` in SELECT/GROUP BY + per-line bucketize. VERIFY:
       per-line bucket counts (which (family,side,line) cross MIN_SAMPLE_LINE), MLB join n climbs off 0,
       NBA buckets intact. No behavior change yet (getCalibrationForFamily still family-side) → dampening
       output identical until 5.2. Probe to .scratch/probe_calib_corpus.txt.
- 5.2  getCalibrationForFamily + dampenModelProb gain `line` + the fallback ladder; applyCalibrationDampener
       passes pick.line. VERIFY: the MLB hits-over-1.5 pre/post (§6), NBA family multipliers unchanged or
       sane, no common-line floor-clamp. Probe to .scratch/probe_calib_lineaware.txt.
- 5.3  KILL-SWITCH: env flag `CALIB_LINEAWARE` (default on). When off, getCalibrationForFamily ignores `line`
       (reverts to family-side ladder) WITHOUT a code revert — so if production multipliers over-suppress, the
       operator flips the flag + reloads the backend. Document in RUNTIME_FACTS.
- 5.4  (separate) calibrationFeedback → book-agnostic join (family-side). VERIFY MLB feedback factor un-freezes.
- Between every step: runtime:verify 13/13 + the verifyCalibrationHonesty suite. Each step bisectable.

## 6. PRE/POST — MLB hits-over-1.5 pick (the worked case)

TODAY (line-agnostic family-side, the bug): hits|over corpus is ~95% line-2.5 longshots → stated 0.394,
realized 0.068 → multiplier ≈ 0.068/0.394 = 0.17 → floor-clamped 0.20. A hits-OVER-1.5 pick the model scores
at, say, 0.62 (2+ hits is a real ~25-30% prop, model may be high) gets 0.62 × 0.20 = **0.124** — crushed by
longshot-3+-hit data that has nothing to do with the 1.5 line. FALSE under-confidence.

LINE-AWARE:
  - If hits|over|1.5 bucket has n ≥ 25: it calibrates on REAL 1.5 outcomes (realized ~0.30, stated ~0.40 →
    multiplier ≈ 0.30/0.40 = 0.75). 0.62 × 0.75 = **0.465** — a sensible, line-appropriate correction.
  - If hits|over|1.5 is thin (< 25): heterogeneous family → NO family-side fallback → multiplier 1.0 → 0.62
    UNCHANGED. Honest (we don't have the data to dampen this line yet) and SAFE (no over-suppression).
Either path is strictly better than today's 0.124. (hits|over|2.5 longshots still correctly dampen on their
OWN bucket.)

## 7. BET-AFFECTING RISKS (honest)

1. OVER-SUPPRESSION (today's bug) — FIXED by per-line + heterogeneous→thin→null (no biased family-side fallback).
2. UNDER-CORRECTION — thin line buckets stay at 1.0 until they accumulate ≥ MIN_SAMPLE_LINE, so some genuine
   overconfidence goes uncorrected for a while. SAFE (never over-suppresses) but slower to bite. Mitigates as
   the corpus grows (signal-fill already made it grow).
3. NBA dampening could SHRINK — NBA families currently dampen at family-side (n≥20); per-line they may go thin.
   Mitigation: NBA continuous families are line-HOMOGENEOUS → keep the family-side fallback (step 2 of ladder),
   so NBA dampening is preserved while MLB rungs go strict per-line.
4. CORPUS-COMPOSITION SHIFT — flipping to the book-agnostic join changes WHICH rows feed calibration (more
   matches, curated-only). Multipliers will move. 5.1 verifies the new buckets are sane before 5.2 wires them.
5. MULTIPLIER_FLOOR 0.20 may still be too aggressive even per-line — a genuinely overconfident line could hit
   0.20. RECOMMEND revisiting the floor (e.g. 0.40) as part of 5.2; flag for operator. Not changing it silently.
6. DOUBLE-CORRECTION — dampener + calibrationFeedback both correct. Sequencing them (5.2 then 5.4) + watching
   the /status family-overconfidence alerts limits compounding; if both over-correct, the kill-switch + the
   feedback cap (±, in-scoring) bound it.
7. CACHE_TTL 5min — multipliers refresh every 5 min from the growing corpus; a bad bucket self-heals as data
   lands, but also means a transient thin bucket could flip dampening on/off near the threshold. Acceptable.

## OUT OF SCOPE / OPEN DECISIONS for operator
- lineMode config per family (exact vs range:N vs agnostic) — proposed defaults above; operator confirms.
- MIN_SAMPLE_LINE value (proposed 25) + whether to raise MULTIPLIER_FLOOR (proposed revisit to 0.40).
- Whether calibrationFeedback gets line-awareness in 1A or stays family-side (recommend family-side + book-
  agnostic join only).

NO CODE CHANGED. predictionId untouched. Operator reviews; build is a separate phase per step.
