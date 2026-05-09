# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-09 (Session AI: NBA-3 Alt-Line Liberation complete — quality alt-line gate in buildNbaSnapshotCandidates; 15/15 smoke tests pass; Class D; pending TERM 1 restart + TERM 2 verification before finalizing checkpoint.)_

---

## CURRENT PROJECT PHASE

**DUAL TRACK: NBA-2.C + MLB-1 (parallel, independent)**

Session AD delivered three outputs: (1) WORKFLOW_RULES.md operational output protocol (permanent law); (2) NBA-2.B nbaVolatilityResolver.js creation + guard replacement in both shared modules; (3) MLB Construction Trace V1 — 18-section read-only audit, MLB health 3.2/10, 5-phase evolution plan.

| Phase | Status | Summary |
|---|---|---|
| Architecture Cleanup Phase 0 | ✅ DONE | 11,185 lines + 9 files + 4 empty dirs deleted |
| Architecture Cleanup Phase 1 | ✅ DONE | root docs synced to docs/ |
| Architecture Cleanup Phase 2 | ✅ DONE | normalizers.js, buildWorkstationCompactors.js, mutex unified |
| NBA Ecology Audit (Session Z) | ✅ DONE | 20-section audit; health 2.9/10; roadmap defined |
| NBA-1 — PRA volatility fix | ✅ DONE | snapshotSourced guard + lotto volRealism 0.65 |
| NBA-2 — Canonical path audit | ✅ DONE | health 4.6/10; canonical designations; 9-phase migration plan |
| **NBA-2.A — ARCHITECTURE.md + types.ts** | ✅ DONE (folded into AD) | doc-only; canonical designations marked |
| **NBA-2.B — nbaVolatilityResolver** | ✅ DONE (Session AD) | `pipeline/nba/nbaVolatilityResolver.js` created; guards replaced in buildFeaturedPlays + buildSlipAi |
| **NBA-2.C — Correlation Intelligence Restoration** | ✅ DONE (Session AE) | `nbaCorrelationEngine.js` created; `buildSlipAi.js` wired; corrBonusMap tiebreaker, cashout ordering, correlationScore field — 10/10 pass |
| **NBA-2.C.2 — Team enrichment on snapshot candidates** | ✅ DONE (Session AG) | `applyTeamFallbackFromProjections` wired in `buildNbaSnapshotCandidates`; 18/24 candidates carry team; 4 sameTeam boost pairs activate — 8/8 pass |
| **NBA-3 — Alt-Line Liberation** | ✅ DONE (Session AI) | quality alt-line gate in buildNbaSnapshotCandidates; threes/pra/points survive mp>=0.42/edge>=0.06; 15/15 pass |
| **NBA-2.C.3 — buildNbaSnapshotCandidates extraction** | 🔴 NEXT (NBA track) | move from `workstationRoutes.js` → `pipeline/nba/buildNbaSnapshotCandidates.js` |
| **MLB-1 — Fix eventId/matchup null** | 🔴 NEXT (MLB track) | trace + fix in phase4Tracking.js / buildMlbPropClusters.js |
| **NBA-2.D — nbaSlipUtils extraction + buildNbaAiSlips quarantine** | ⬜ AFTER 2.C | move helper trio; deprecate function shim |
| **NBA-2.E — Dead-orphan deletion sweep** | ⬜ AFTER 2.D smoke | delete buildNbaSlipEngine.js; delete orphan function bodies |
| **MLB-2 — ELITE/STRONG stamps in nightly** | ⬜ AFTER MLB-1 | buildMlbPropClusters.js stamp logic; enrichBestEntry reads stamp |
| **MLB-3 — Sport-specific prob floor** | ⬜ AFTER MLB-2 | diversifyCandidates + scoreLeg: MLB offensive → [0.35, 0.45] |
| **NBA-2.F — Volatility resolver to nightly** | ⬜ AFTER 2.E | audit + wire bestBetsBoard.allPlays.volatility |
| **NBA-2.G — Correlation absorption (full cluster logic)** | ⬜ AFTER 2.F | SAFE_CLUSTER / EV_CLUSTER / UPSIDE_CLUSTER / CASHOUT_CLUSTER / greedyClusterCorrelated — requires aiRange-resolved pick format, not workstation format |
| **NBA-2.H — buildNbaDynamicSlipEngine deletion** | ⬜ AFTER 2.G stable | Correlation core absorbed in NBA-2.C; cluster logic absorption is NBA-2.G scope |
| **NBA-2.I — aiRange wiring (Opus)** | ⬜ AFTER 2.H + NBA-3 | |
| NBA-3 — Alt line gate (NBA-only) | ✅ DONE (Session AI) | quality gate in buildNbaSnapshotCandidates; extraction into pipeline/nba/ is NBA-2.C.3 scope |
| NBA-4 — Ecology tier layer | ⬜ BLOCKED on NBA-3 | |
| NBA-5 — realismScore rebalance | ⬜ BLOCKED on NBA-4 | Opus audit required |
| NBA-6 — Eruption environment | ⬜ BLOCKED on NBA-5 | |
| NBA-7 — First basket ecosystem | ⬜ BLOCKED on NBA-6 | |
| **MLB-4 — Safe-candidate pipeline** | ⬜ AFTER MLB-3 stable | new data source, MEDIUM risk |
| **MLB-5 — Sport-specific tier templates** | ⬜ AFTER MLB-4 + calibration data | HIGH risk, Opus required |

**Repo health: 7.2/10** structural. NBA intelligence: **3.6/10** (sameTeam boosts active). NBA routing: **4.6/10**. **MLB construction: 3.2/10** (Session AD). NBA-2.B ✅. NBA-2.C ✅. NBA-2.C.2 ✅. Primary levers: **NBA-2.C.3** snapshot extraction (Sonnet, near-zero risk — prereq for NBA-3) + **MLB-1** (Sonnet, low risk, parallel).

---

## PENDING OPERATOR ACTIONS (macOS terminal — DO THESE IN ORDER)

**Step 1 — Restart TERM 1 (workstationRoutes.js modified — NBA-3 gate):**
```bash
cd ~/Desktop/betting-dashboard && node backend/server.js
```

**Step 2 — Wait ~5s for server ready, then verify NBA-3 alt-line flow:**
```bash
curl -s "http://localhost:4000/api/ws/state?sport=nba" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); const slips=Object.values(p.aiSlips||{}).flat(); const altLegs=slips.flatMap(s=>s.legs||[]).filter(l=>l.isAltLine); console.log('candidates:', p.counts?.candidates, 'slips:', slips.length, 'altLegs:', altLegs.length, 'altFamilies:', [...new Set(altLegs.map(l=>l.statFamily))].join(','), 'corrFields:', slips.filter(s=>'correlationScore' in s).length)"
```

**Expected output after TERM 1 restart:**
- `candidates`: > 24 (alt-lines add to pool — expect 30–60 depending on snapshot coverage)
- `altLegs`: > 0 (at least some quality alt-lines in aggressive/lotto slips)
- `altFamilies`: threes, pra, and/or points (never rebounds/assists/first_basket)
- `corrFields`: > 0 (correlation still wired)

**Step 3 — ONLY after Step 2 confirms expected output, finalize checkpoint:**
```bash
cd ~/Desktop/betting-dashboard && bash backend/scripts/finalizeCheckpoint.sh
```

**CRITICAL:**
- `sport=basketball_nba` causes `isNba=false` — always use `sport=nba`
- If `altLegs: 0` — this is expected if today's snapshot has no quality alt-lines meeting mp>=0.42/edge>=0.06. Check `candidates` count for whether alt candidates are entering the pool pre-diversification.
- Sessions H–AI are all staged in the checkpoint. finalizeCheckpoint.sh commits everything in one shot.

---

## IMMEDIATE NEXT PRIORITIES

---

### ✅ NBA-1 — PRA Volatility Guard (COMPLETE — Session AA)

**What was done**: Added snapshotSourced "lotto" guard to `normalizeCandidate()` in both `buildFeaturedPlays.js` and `buildSlipAi.js`. Added explicit `lotto: 0.65` volRealism slot in `scoreCandidate()`. Guard: `(raw.snapshotSourced === true && raw.volatility === "lotto") ? "lotto" : classifyVolatility(raw)`.

**Remaining lotto gap** (NBA-3 scope): base odds dec ~5–9 per leg; 5-leg combo ~22–26 is borderline [20, 1500] gate. Alt lines required for robust lotto seeding.

---

### ✅ NBA-2 — Canonical Path Constitution Audit (COMPLETE — Session AB)

**What was done**: Read-only Opus audit. Full importer trace. Constitutional designations made. 20-section deliverable: `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`. Zero code changes.

---

### ✅ NBA-2.A — ARCHITECTURE.md + types.ts updates (COMPLETE — Session AD)
Folded into Session AD doc updates.

---

### ✅ NBA-2.B — nbaVolatilityResolver extraction (COMPLETE — Session AD)

**What was done**: Created `backend/pipeline/nba/nbaVolatilityResolver.js` (95 lines). Imports `classifyVolatility` from buildPortfolioOptimizer. Resolution priority: (1) snapshotSourced + valid stamp → preserve ALL valid stamps (not just "lotto" as NBA-1 did); (2) role-spike hook [NBA-6, no-op]; (3) VOLATILITY_RULES fallback. Both `buildFeaturedPlays.js` and `buildSlipAi.js` updated to import `resolveNbaVolatility`. 20/20 tests pass, 0 MLB regressions.

**TERM 1 restart: YES** — still required if not yet done since Session AD patched both shared modules.

---

### ✅ MLB Construction Trace V1 (COMPLETE — Session AD)

**What was done**: 18-section read-only audit. MLB construction health: 3.2/10. See `docs/MLB_CONSTRUCTION_TRACE_2026-05-09.md`.

**Key findings:**
- SAFE + BALANCED tiers: structurally dead for entire MLB attack board (fails all gates simultaneously)
- AGGRESSIVE: ~60 candidates eligible, but single HR legs fail dec 6.0 floor; 2-leg cross-game works
- LOTTO: 115/115 eligible; only functional lane; 3-leg HR parlays produce dec 91–216 ✓
- eventId=null on all tracked_best → gameKey blind → maxPerGame caps never apply
- Prob cap [0.50, 0.55] erases all MLB model signal (all candidates at 0.12–0.35 → all cap to 0.50)
- No ELITE/STRONG stamps → tier boost never fires for any MLB candidate
- 5-phase evolution plan: MLB-1 (eventId fix) → MLB-2 (stamps) → MLB-3 (prob floor) → MLB-4 (safe pipeline) → MLB-5 (tier overrides)

---

### ✅ NBA-2.C — Correlation Intelligence Restoration (COMPLETE — Session AE)

**What was done**: Created `backend/pipeline/nba/nbaCorrelationEngine.js` (272 lines, 7 pure exports). Wired into `buildSlipAi.js` with 4 minimal changes: (1) lazy require + `getNbaCorr()` guard; (2) `isNba` gate + `buildEventMetaMap` in `buildAiSlips`; (3) `corrBonusMap` precomputation + `textureRank` update in `buildSlipsForTier`; (4) `orderLegsWithCashoutFirst` post-assembly + `correlationScore` field on all NBA slips.

**Orphan functions absorbed from `buildNbaDynamicSlipEngine.js`**: `pairwiseStackBoost`, `buildEventMetaMap`, `jointProbabilityWithCorrelation`, `isFastCashoutLeg`, `ensureFastLegsLead`/`orderCashoutFirst`, `correlationScoreForLeg`/`linkedStatFamilies`.

**Verification**: 10/10 pass — same-game spam blocked, diversification preserved, pts+ast boost fires (0.19), cross-game boost=0, MLB correlationScore=null.

**TERM 1 restart**: YES — `buildSlipAi.js` modified.

---

### ✅ NBA-2.C.2 — Team Enrichment on Snapshot Candidates (COMPLETE — Session AG)

**What was done**: Added `applyTeamFallbackFromProjections` wrapping `enrichNbaRowStatLayerInputs` in `buildNbaSnapshotCandidates` in `workstationRoutes.js`. Added import of `applyTeamFallbackFromProjections` from `nbaEventTeamResolve`.

**Effect**: 18/24 diversified candidates now carry team field. 4 sameTeam boost pairs now activate:
- Cade Cunningham/points + Ausar Thompson/assists (Detroit Pistons): +0.19
- Jaxson Hayes/points + Rui Hachimura/assists (Lakers): +0.19
- Tobias Harris/threes + Cade Cunningham/points (Detroit Pistons): +0.15
- Jaxson Hayes/points + Deandre Ayton/rebounds (Lakers): +0.05

**Coverage gap**: 6/24 candidates (Alex Caruso ×3, Cason Wallace ×2, Ajay Mitchell) not in `nbaPlayerProjections.json` — team=null, sameTeam boosts don't fire for them. Safe degradation. Fix: add OKC/Chicago players to projections.json when slate data is available.

**TERM 1 restart**: YES — workstationRoutes.js modified.

---

### ✅ NBA-3 — Alt-Line Liberation (COMPLETE — Session AI)

**What was done**: Replaced the hard alt-line kill in `buildNbaSnapshotCandidates` (workstationRoutes.js) with an intelligent quality gate.

**Gate design**:
- `isAltLine` detection moved before odds gate (mk/pv checked first)
- Family pre-check: threes/pra/points eligible; rebounds/assists/first_basket remain hard-killed
- Odds gate widened for alts: -200..+800 American (dec ~9.0) vs base -200..+200
- Stricter alt-line quality: mp >= 0.42, edge >= 0.06 (vs base mp >= 0.35, edge >= 0.03)
- These thresholds apply POST ladder-penalty in nbaIndependentBaseModelProbability
- Volatility: points alt → aggressive; threes alt + pra alt → lotto (never balanced/safe)
- Dedup: base and alt deduplicate separately → max 1 base + 1 alt per (player|stat|side)
- `isAltLine: true` field on alt candidates for downstream auditing

**Smoke test**: 15/15 pass (gate logic + volatility + dedup)
**Files modified**: `backend/routes/workstationRoutes.js` only
**TERM 1 restart**: YES (pending operator action)

**What was NOT changed** (intentional):
- nbaModelSignals.js ladderPenalty/ladderSeverity — still applies to surviving alt-lines ✓
- buildSlipAi.js ladderScore penalty (5% for line >= 4.5) — still applies ✓
- probFactor cap [0.50, 0.55] — still applies ✓
- SAFE lane — unchanged, no alt contamination possible (aggressive/lotto only) ✓
- MLB path — untouched, zero regressions ✓

---

### 🔴 Priority 1 (NBA TRACK) — NBA-2.C.3: buildNbaSnapshotCandidates extraction

**Scope**: Move the now ~100-line `buildNbaSnapshotCandidates()` function (includes NBA-3 gate) out of `workstationRoutes.js` into a new sport-specific module.

**Create** `backend/pipeline/nba/buildNbaSnapshotCandidates.js` with:
- Identical export shape
- Imports from `nbaModelSignals`, `nbaEventTeamResolve` move with it
- `NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD` and `NBA_SNAPSHOT_TOP_N` constants move with it (export both)

**Update** `backend/routes/workstationRoutes.js`:
- Remove inline function + top-of-file imports `nbaRowModelProbability`/`nbaRowEdge`, `enrichNbaRowStatLayerInputs`, `applyTeamFallbackFromProjections`
- Add: `const { buildNbaSnapshotCandidates, NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD } = require("../pipeline/nba/buildNbaSnapshotCandidates")`

**Risk**: Near-zero. Pure refactor.
**Model: Sonnet** — 2-file change.
**TERM 1 restart**: YES.

---

### 🔴 Priority 1A (MLB TRACK) — MLB-1: Fix eventId/matchup null on tracked_best

**Scope**: Trace where eventId and matchup are set (or lost) during nightly MLB processing. Wire them through so all tracked_best entries carry real game identifiers.

**Why first**: Low risk, no prerequisite, immediately unlocks: (1) maxPerGame caps in slip assembly, (2) timing map lookups, (3) script correlation guard correctness, (4) correct same-game concentration tracking.

**Files to investigate**:
- `pipeline/mlb/buildMlbPropClusters.js` — where do cluster entries get their eventId?
- `pipeline/mlb/phase4Tracking.js` — does it pass eventId through to tracked_best entries?

**Verification**: After fix, `node -e` smoke test reading tracked_best and checking eventId populated rate.

**Risk**: LOW — plumbing only.
**Model: Sonnet** — read then patch.
**TERM 1 restart**: NO (nightly script only, not server).

---

### 🔴 Priority 4 — NBA-2.D: nbaSlipUtils + buildNbaAiSlips quarantine

**Scope**: Move helper trio out of buildNbaAiSlips and add a deprecation shim.

**Create** `backend/pipeline/nba/nbaSlipUtils.js` containing:
- `collectFullPool(opp)` (current location: buildNbaAiSlips.js:99)
- `filterSlipLegs(legs)` (current: buildNbaAiSlips.js:56)
- `formatLeg(c)` (current: buildNbaAiSlips.js:157)
- All micro-helpers they require (`pk`, `eid`, `propBlob`, `toNum`, `slipLegPassesReality`)

**Update importers**:
- `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js:9` → import from `./nbaSlipUtils`
- `backend/pipeline/nba/buildNbaDynamicSlipEngine.js:13` → import from `./nbaSlipUtils`

**Convert `buildNbaAiSlips.js` to deprecation shim**:
- Keep file in place
- Re-export the helpers from `./nbaSlipUtils` (so any sneaky importer still works)
- Add `console.warn("[deprecated] buildNbaAiSlips: function deprecated, helpers moved to nbaSlipUtils")` at module load
- DO NOT YET delete the orphan function bodies (Phase 2.E does that)

**Verify**:
- `node --check` clean on all 4 files
- Smoke test: `curl /api/ws/state?sport=basketball_nba` returns intact aiSlips + slipBets

**Risk**: Low.
**Model: Sonnet** — 4-file change (1 new + 3 modified).
**TERM 1 restart**: YES.

---

### 🔴 Priority 5 — NBA-2.E: Dead orphan deletion sweep

**Scope**: After Phase 2.D smoke-tests clean across one nightly + one workstation cycle.

**Delete**:
- `backend/pipeline/nba/buildNbaSlipEngine.js` (601 lines)
- The orphan function bodies in `backend/pipeline/nba/buildNbaAiSlips.js`:
  - `buildSafeSlip`, `buildBalancedSlip`, `buildAggressiveSlip`, `buildLottoSlip`, `buildNbaAiSlips` (the function)
  - `lottoSeedScore`, `isLottoCeilingLeg`, `findHighestHighLadderForPlayer`, etc.
- Delete the comment in `backend/pipeline/nba/nbaAiStatFamilyRank.js:20` ("Align with buildNbaSlipEngine heuristics")

**Keep in `buildNbaAiSlips.js`**:
- The deprecation shim re-export from Phase 2.D

**Risk**: Low. Importer trace already proves zero dependencies on the deleted symbols.
**Model: Sonnet** — pure deletion.
**TERM 1 restart**: YES.

---

### 🟡 Priority 6 — NBA-2.F: Volatility resolver propagation to nightly

**Scope**: Audit `buildNbaBestBetsBoard.js` — read it (out of Session AB scope) — and confirm where `play.volatility` is set on `bestBetsBoard.allPlays`. Wire `nbaVolatilityResolve` there. Then audit `buildNbaSlipComposer.js` to verify it consumes `play.volatility` correctly.

**Pre-flight read required**: full `buildNbaBestBetsBoard.js` (440 lines).

**Risk**: Medium (depends on read findings).
**Model: Sonnet** — surgical wiring once read complete.
**TERM 1 restart**: YES.

---

### 🟡 Priority 7 — NBA-2.G: Correlation absorption (Opus)

**Scope**: Lift correlation logic from orphan `buildNbaDynamicSlipEngine.js` into a new shared module, then wire into both engines.

**Create** `backend/pipeline/nba/nbaCorrelation.js` with:
- `pairwiseStackBoost(a, b, eventMeta)` (DynamicSlipEngine line 87)
- `jointProbabilityWithCorrelation(legs, eventMeta)` (DynamicSlipEngine line 130)
- `buildEventMetaMap(pool)` (DynamicSlipEngine line 112)
- `isFastCashoutLeg(L)` (DynamicSlipEngine line 61)
- `ensureFastLegsLead(legs)` + `orderCashoutFirst(legs)` (DynamicSlipEngine line 267-284)

**Wire into `buildSlipAi.js`** (NBA-only branch via sport check):
- Compute `eventMeta` once per build call
- Add small correlation lift to slip composite scoring (cap at +0.05)
- Apply `ensureFastLegsLead` to NBA slip legs only

**Wire into `buildNbaSlipComposer.js`** (final-pass score adjust):
- Add correlation tag during slip composition
- Surface `correlationScore` in slipSummary output

**Risk**: Medium-high. Slip composition logic change. Requires full slate testing with before/after diff.
**Model: Opus** — full audit + slate test required.
**TERM 1 restart**: YES.

---

### 🟡 Priority 8 — NBA-2.H: buildNbaDynamicSlipEngine deletion

**Scope**: After Phase 2.G smoke-tests clean.

**Delete**:
- `backend/pipeline/nba/buildNbaDynamicSlipEngine.js` (843 lines)
- Comment at `backend/pipeline/nba/nbaSlipLegConstraints.js:5`

**Risk**: Low (correlation already absorbed).
**Model: Sonnet** — pure deletion.
**TERM 1 restart**: YES.

---

### 🟢 Priority 9 — NBA-3: Alt line gate (NBA-only) — parallelizable with 2.F

**Pre-requisite**: Phase 2.E complete (so `buildNbaSnapshotCandidates` exists at the new path).

**Scope**: Inside extracted `pipeline/nba/buildNbaSnapshotCandidates.js`, replace `propVariant !== "base"` blanket exclusion with NBA-aware predicate:
```javascript
function passesNbaAltLineGate(row, basePropVariant = "base") {
  const pv = String(row?.propVariant || "").toLowerCase()
  if (pv === "" || pv === "base" || pv === "default") return true
  // Allow alt lines within ±1.5 of base, max 1 per (player|stat|side)
  // Implementation TBD — see NBA-3 priority 9 in this file.
  return false
}
```

**MLB unchanged**: shared modules never call this NBA-specific gate.

**Cap alt-line spam**: per (player|stat|side), max 2 admitted (base + 1 alt).

**Risk**: Medium. May introduce noise if cap is too generous.
**Model: Sonnet** — surgical.
**TERM 1 restart**: YES.

---

### 🟡 Priority 10 — NBA-2.I: aiRange wiring into buildSlipAi (Opus)

**Pre-requisite**: NBA-3 (alt lines flow into pool).

**Scope**: NBA-only branch in `buildSlipAi.js`:
- `normalizeCandidate` preserves `aiRange` and `aiRangeResolved` if present
- New per-tier path: when sport === "nba" AND candidate has `aiRangeResolved`, prefer median rung for safe/balanced, ceiling rung for aggressive/lotto
- MLB behavior unchanged (no aiRange field on MLB candidates)

**Risk**: High. Touches shared slip builder. Feature-flagged + slate-tested before deploy.
**Model: Opus**.
**TERM 1 restart**: YES.

---

### 🟡 Priority 11 — Wire actuals into daily review (first real intelligence cycle)

**Prerequisite**: Results entered for any past date. Calibration = 0 until this happens.

```bash
node backend/scripts/updateMlbResults.js --date=2026-05-08
node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08 --verbose
```

---

### 🟡 Priority 12 — Wire steam/book data into daily review

Currently `steam_summary_json` and Q11-Q14 (book sharpness, steam signals) are placeholders. 30-minute additive pass.

---

### 🟡 Priority 13 — SQLite ledger read cutover (Phase S+1)

After ≥1 verified nightly run with rows accumulating in `personal_ledger` table, proceed to Phase S+1 (cut read path to SQLite).

---

### Priority 14 — Review frontend integration

The daily intelligence review produces rich JSON. Build `sections/IntelligenceReviewView.tsx` once Priority 11 is complete and real data is flowing.

---

### Priority 15 — eventId/matchup on tracked_best

All `tracked_best` entries have `eventId=null`, `matchup=null`. Tier boosts always fail. Full trace of `runMlbNight.js` → `buildMlbPropClusters.js` → `phase4Tracking.js` required.

---

### Priority 16 — Prune timing_intelligence_state.json

At 729KB with no pruning mechanism. Add max-age eviction or size cap.

---

### 🟡 Priority 3 — Wire actuals into daily review (first real intelligence cycle)

**Prerequisite**: Results entered for any past date. Calibration = 0 until this happens.

```bash
# Enter results:
node backend/scripts/updateMlbResults.js --date=2026-05-08

# Run daily review:
node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08 --verbose

# Verify SQLite tables populated:
node -e "
const { tryGetDb } = require('./backend/storage/db');
const db = tryGetDb();
const dir = db.prepare('SELECT id, overall_grade, ecology_grade, calibration_grade, hit_rate, brier_score FROM daily_intelligence_reports').all();
console.log('daily_intelligence_reports:', JSON.stringify(dir, null, 2));
const cr = db.prepare('SELECT id, brier_score, ece, sample_count FROM calibration_records').all();
console.log('calibration_records:', JSON.stringify(cr, null, 2));
const ee = db.prepare('SELECT id, eruption_type, was_missed, hr_eruption_miss FROM eruption_events').all();
console.log('eruption_events:', JSON.stringify(ee, null, 2));
"
```

---

### 🟡 Priority 4 — Wire steam/book data into daily review

Currently `steam_summary_json` and Q11-Q14 (book sharpness, steam signals) are placeholders.

**Path:** Add `opts.lineShoppingResult` parameter to `runDailyIntelligenceReview()`. Pass through to `buildDailyAnswers()`. Extract steam signals from `lineShopping.steamSignals`.

This is a 30-minute additive pass — do NOT rebuild line shopping.

---

### 🟡 Priority 5 — SQLite ledger read cutover (Phase S+1)

After ≥1 verified nightly run with rows accumulating in `personal_ledger` table:

```bash
node -e "
const { tryGetDb } = require('./backend/storage/db');
const db = tryGetDb();
const cnt = db.prepare('SELECT COUNT(*) AS n FROM personal_ledger').get();
const recent = db.prepare('SELECT date, COUNT(*) AS n FROM personal_ledger GROUP BY date ORDER BY date DESC LIMIT 5').all();
console.log('total rows:', cnt.n);
console.log('by date:', JSON.stringify(recent));
"
```

If rows accumulating: proceed to Phase S+1 (cut read path to SQLite).

---

### Priority 6 — Review frontend integration

The daily intelligence review produces rich JSON. A lightweight frontend panel to surface:
- Daily grade badges (A-F)
- Major findings alert bar
- HR eruption miss alerts
- Suppressed winners list
- Process archetype donut chart

**Path**: New `sections/IntelligenceReviewView.tsx` fed by `GET /api/ws/review/daily`.
Add route in `workstationRoutes.js` serving `daily_intelligence_review_<sport>_<date>.json`.

**Do NOT build until Priority 3 is complete and real data is flowing.**

---

### Priority 7 — eventId/matchup on tracked_best

All `tracked_best` entries have `eventId=null`, `matchup=null`. Tier boosts always fail.
Full trace of `runMlbNight.js` → `buildMlbPropClusters.js` → `phase4Tracking.js` required.

---

### Priority 8 — Prune timing_intelligence_state.json

At 729KB with no pruning mechanism. Add max-age eviction or size cap.
**File**: `pipeline/shared/buildMarketTimingIntelligence.js` — state persistence section.

---

### Priority 17 — NBA-4: Build NBA Ecology Tier Layer

**Context**: NBA has no equivalent of MLB's ELITE/STRONG stamps from `buildMlbPropClusters.js`. Current workstation path uses compositeScore ranking without tier gates. buildNbaAiPicks.js has `passesEliteTierGate()` and `passesAiPickScoredFloor()` — these need to stamp candidates, not just filter.

**Path**: Add `nbaEcologyStamp(candidate, picks)` in a new `pipeline/nba/buildNbaEcologyTiers.js`. Stamps: ELITE (top 15% by compositeScore + fw + edge), STRONG (next 25%), OPPORTUNITY (rest that pass floor). Feed stamps into `buildNbaAiSlips.collectFullPool()`.

**Model: Sonnet** — additive new file, no existing file modifications except import wiring.

---

### Priority 18 — ARCHITECTURE.md update (rolled into NBA-2.A above)

Line counts stale, http/ section no longer accurate:
- `server.js` listed as 21,025 — still accurate (mutex fix only removed ~4 lines)
- `workstationRoutes.js` listed as 577 — now 620 (was 721 before Session Y)
- `http/` section no longer lists only 2 files accurately
- `pipeline/shared/` section missing `normalizers.js` and `buildWorkstationCompactors.js`
- `docs/` section missing `NBA_ECOLOGY_AUDIT_2026-05-09.md` and `NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`
- "5 NBA slip modules" claim → corrected to "1 active nightly + 1 utility + 2 dead orphans"
- Add canonical-nightly / canonical-workstation labels in module ownership table

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| HR ecology suppression | ✅ RESOLVED (Session T) — 5 fixes in buildMlbPropClusters.js |
| MLB team field omission (leanBet) | ✅ RESOLVED (Session V) — team/teamCode/awayTeam/homeTeam now persisted through full chain |
| MLB identity cache stale-team accumulation | ✅ RESOLVED (Session V) — 30d eviction + slate-aware sort + lastSeenAt tracking |
| personal_ledger.json corruption | ✅ RESOLVED (Session S) — atomic write |
| isOffensiveAttackStat divergence | ✅ RESOLVED (Session Y) — unified in normalizers.js |
| __refreshInProgress dual-mutex race | ✅ RESOLVED (Session Y) — module-level only |
| Compactors not in shared module | ✅ RESOLVED (Session Y) — buildWorkstationCompactors.js |
| Screenshot routes startup crash | Schema bootstrap runs inside first request — graceful 503 if SQLite down |
| Daily review throws + kills orchestrator | stepDailyIntelligenceReview() wrapped in try/catch — always degrades gracefully |
| Daily review overwrites past data | Uses INSERT OR REPLACE — idempotent, safe to re-run |
| Review schema breaks existing tables | applyReviewSchema uses CREATE IF NOT EXISTS everywhere — additive only |
| SQLite mirror unavailable | Graceful degradation — JSON write always succeeds first |
| betting.db journal lock (virtiofs) | macOS TERM 1 unaffected; sandbox writes degrade silently |
| NBA lotto slip starvation — classification layer | ✅ RESOLVED (Session AA) — snapshotSourced guard in both normalizeCandidate() instances. PRA now seeds as "lotto". Remaining: odds gate (NBA-3 scope). |
| NBA lotto slip starvation — odds gate | ✅ RESOLVED (Session AI — NBA-3) — quality alt-lines (threes/pra/points) now flow through with mp>=0.42/edge>=0.06/odds<= +800; volatility forced aggressive/lotto; base legs + alt legs combine for genuine lotto-range dec odds. |
| NBA alt-line contamination — SAFE lane | ✅ DESIGNED SAFE (Session AI) — alt-lines stamped aggressive/lotto only; SAFE tier allowedVolatility does not include "aggressive" or "lotto"; zero contamination by design. |
| NBA alt-line contamination — rebounds/assists | ✅ DESIGNED SAFE (Session AI) — family pre-check hard-kills rebounds/assists/first_basket alt-lines before scoring. |
| classifyVolatility affecting MLB | VOLATILITY_RULES NOT modified. Guard is snapshotSourced-gated — MLB candidates never set snapshotSourced. Verified 0 MLB regressions. |
| NBA two-path disconnect | Workstation uses buildSlipAi.js (MLB-calibrated, canonical-workstation per Session AB). Nightly uses buildNbaSlipComposer (canonical-nightly per Session AB). Do NOT attempt to merge surfaces in NBA-2 phases — they serve different bettor needs. |
| realismScore monoculture | Do NOT touch 0.70 weight until NBA-4 ecology tier layer exists. Weight rebalance (NBA-5) requires tier stamps to be in place first. |
| aiRange resolution failure | NBA-3 ✅ — alt-lines now flow into pool. NBA-2.I wires aiRange into buildSlipAi NBA branch. |
| buildNbaSlipEngine.js | Do NOT modify. DEAD orphan (zero importers). Schedule for deletion in Phase 2.E. |
| buildNbaDynamicSlipEngine.js | Do NOT modify or delete. DEAD orphan but holds ALL NBA correlation logic. Phase 2.G must absorb pairwiseStackBoost + jointProbabilityWithCorrelation + isFastCashoutLeg + ensureFastLegsLead BEFORE Phase 2.H deletion. |
| buildNbaAiSlips.js function body | Do NOT add new logic to the orphan `buildNbaAiSlips()` function or its tier builders (`buildSafeSlip`, `buildBalancedSlip`, `buildAggressiveSlip`, `buildLottoSlip`). The function is unreached at runtime. Schedule for deletion in Phase 2.E. |
| Inline NBA logic in shared modules | Do NOT add NBA-specific code directly to `buildSlipAi.js` or `buildFeaturedPlays.js`. Use thin adapters (nbaVolatilityResolver, future nbaCorrelation). Phase 2.B replaces inline NBA-1 guards with the resolver pattern. |

---

## WHAT NOT TO DO

- Do NOT increase textureBoost
- Do NOT blindly buff NBA overs — no uniform boosts, no fake star inflation
- Do NOT inject fake ladders — aiRange must be driven by real alt lines in pool
- Do NOT inflate random volatility — lotto requires genuine lotto-odds candidates
- Do NOT modify `VOLATILITY_RULES` for NBA lotto fix — guard only (Path A: snapshotSourced field)
- Do NOT consolidate NBA slip builders blindly — Phase 2.G must absorb correlation BEFORE 2.H deletion
- Do NOT touch `buildNbaSlipEngine.js` — DEAD orphan, deletion only (Phase 2.E)
- Do NOT touch `buildNbaDynamicSlipEngine.js` — DEAD orphan with valuable logic, absorb-then-delete (Phases 2.G + 2.H)
- Do NOT rebalance `realismScore` weight (NBA-5) until NBA-4 ecology tier layer is live
- Do NOT relax `propVariant !== "base"` gate globally — NBA-3 bypass must be NBA-specific
- Do NOT add NBA-specific code inline to `buildSlipAi.js` / `buildFeaturedPlays.js` — use the nbaVolatilityResolver pattern (Phase 2.B)
- Do NOT force over/under parity
- Do NOT touch the `[0.50, 0.55]` modelProb cap
- Do NOT raise slipAi or featured tierBoost
- Do NOT lower safe-tier maxOdds below 150
- Do NOT remove premium-edge thresholds
- Do NOT widen `maxPerGame` beyond 2 in anchors
- Do NOT attempt server.js Phase B/C without ARCHITECTURE.md global map
- Do NOT touch `runMlbNight.js` without tracing candidate paths first
- Do NOT reopen ecology fixes
- Do NOT modify `VOLATILITY_RULES` for NBA lotto without full Opus audit (Path A preferred)
- Do NOT loosen the NBA-3 alt-line gate (mp/edge thresholds, family set, odds ceiling) without a full data audit — the current thresholds are calibrated for eruption signals post ladder-penalty
- Do NOT cut ledger read path to SQLite until ≥1 verified nightly run confirms rows accumulating
- Do NOT build a review frontend until real data is flowing through the review engine
- Do NOT consolidate NBA slip builders without Opus ecology audit first

---

## SQLITE MIGRATION SEQUENCE (updated)

0. ~~**Phase 1: storage layer** — DONE 2026-05-07~~
1. ~~**`personal_ledger.json` → ledger table — DONE (Session S)**~~
   - **Phase S+1**: Cut read path after ≥1 verified nightly run
2. ~~**Intelligence review tables — DONE (Session W)**~~
   - `daily_intelligence_reports`, `calibration_records`, `process_classifications`
   - `ecology_grades`, `volatility_realizations`, `eruption_events`
3. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
4. `timing_intelligence_state.json` → timing state table (729KB, unbounded)
5. `book_intelligence_state.json` → book profiles table
6. `graded_props_*.json` → review/grading table

---

## DAILY REVIEW CLI REFERENCE

```bash
# Run daily review for MLB today:
node backend/scripts/runDailyReview.js --sport=mlb

# Run for specific date:
node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08

# Run both sports:
node backend/scripts/runDailyReview.js --sport=all

# Dry run (no SQLite writes, no JSON file):
node backend/scripts/runDailyReview.js --sport=mlb --dry-run --verbose

# Output full JSON to stdout (for piping):
node backend/scripts/runDailyReview.js --sport=mlb --json > review.json

# Automatic (already wired): runs as Step 9 of nightly orchestrator
# Triggered by: node backend/scripts/runMlbNight.js (and nba)
```

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| NBA-2.A: ARCHITECTURE.md + types.ts updates | **Sonnet or Auto** |
| NBA-2.B: nbaVolatilityResolver extraction | **Sonnet** |
| NBA-2.C: buildNbaSnapshotCandidates extraction | **Sonnet** |
| NBA-2.D: nbaSlipUtils extraction + AiSlips quarantine | **Sonnet** |
| NBA-2.E: Dead orphan deletion sweep | **Sonnet** |
| NBA-2.F: bestBetsBoard volatility flow audit + wire | **Sonnet** |
| NBA-2.G: Correlation absorption (full slate test) | **Opus** |
| NBA-2.H: buildNbaDynamicSlipEngine deletion | **Sonnet** |
| NBA-2.I: aiRange wiring into buildSlipAi (full slate test) | **Opus** |
| NBA-3: Alt line gate bypass (NBA-specific, surgical) | **Sonnet** |
| NBA-4: Ecology tier layer (new file, additive) | **Sonnet** |
| NBA-5: realismScore weight rebalance (requires NBA-4 live) | **Opus** |
| NBA-6: Eruption environment detection | **Sonnet** |
| NBA-7: First basket ecosystem wiring | **Sonnet** |
| Root-cause audit on unknown bug | **Opus** |
| Wire steam/book data into daily review | **Sonnet** |
| SQLite migration / Phase S+1 read cutover | **Sonnet** |
| Review frontend panel | **Sonnet** |
| Doc creation / doc updates | **Sonnet or Auto** |
| Trivial edits | **Auto** |

---

## TERM1 / TERM2 WORKFLOW

```
TERM 1: backend always running on port 4000 — NEVER touch
TERM 2: operator-controlled manual verification

After any patch:
  → State: "TERM 1 restart: YES/NO"
  → State: "TERM 2 verification: [exact curl or browser command]"
  → Wait for operator confirm before evaluating
```

**Session AB: TERM 1 restart: NO** (read-only audit; only doc edits)

**Session AA: TERM 1 restart: YES** ← still required if not yet done
- `buildFeaturedPlays.js` modified (lotto guard + volRealism slot)
- `buildSlipAi.js` modified (lotto guard)
- Also pending from Session Y (if not yet restarted): `server.js` (mutex), `workstationRoutes.js` (compactor import)

**Session Z: TERM 1 restart: NO** (read-only, no change)

TERM 2 verification (Session Y — after TERM 1 restart, if not yet verified):
```bash
# 1. Verify workstation state loads (compactors must import correctly):
curl -s "http://localhost:4000/api/ws/state?sport=baseball_mlb" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); \
  console.log('lineShopping groups:', p.lineShopping?.groups?.length, 'timing:', p.timing?.classifications?.length)"

# 2. Verify mutex: trigger two concurrent refresh-snapshot calls — second should 429:
curl -s -X POST http://localhost:4000/api/refresh-snapshot &
curl -s -X POST http://localhost:4000/api/refresh-snapshot
# Expected: one 200 (or 429 "already in progress"), not two concurrent refreshes
```
