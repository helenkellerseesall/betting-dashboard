# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-09 (Session AB: NBA-2 Canonical Path Constitution Audit — complete; canonical designations made; 9-phase migration plan; zero code changes; zero TERM 1 restart; Phase 2.A→2.D execution NEXT)_

---

## CURRENT PROJECT PHASE

**NBA ROUTING CONSTITUTIONALIZATION — Phase 2.A→2.D Next**

Session AB completed the NBA-2 Canonical Path Constitution Audit (read-only Opus). NBA routing health: 4.6/10. **Canonical designations made.** 9-phase migration plan (2.A→2.I) defined. See `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`.

**Critical correction to Session Z:** The "5 overlapping NBA slip builders" framing was structurally misleading. True picture: 2 active engines + 1 utility-only + 2 dead orphans. `buildNbaSlipComposer.js` is the canonical-nightly slip producer (not `buildNbaAiSlips.js`). `buildSlipAi.js` (shared) is the canonical-workstation slip regenerator.

| Phase | Status | Summary |
|---|---|---|
| Architecture Cleanup Phase 0 | ✅ DONE | 11,185 lines + 9 files + 4 empty dirs deleted |
| Architecture Cleanup Phase 1 | ✅ DONE | root docs synced to docs/ |
| Architecture Cleanup Phase 2 | ✅ DONE | normalizers.js, buildWorkstationCompactors.js, mutex unified |
| NBA Ecology Audit (Session Z) | ✅ DONE | 20-section audit; health 2.9/10; roadmap defined |
| **NBA-1 — PRA volatility fix** | ✅ DONE | snapshotSourced guard in buildFeaturedPlays + buildSlipAi; lotto volRealism 0.65 |
| **NBA-2 — Canonical path constitution audit** | ✅ DONE | health 4.6/10; canonical-nightly = buildNbaSlipComposer; canonical-workstation = buildSlipAi; 9-phase migration plan |
| **NBA-2.A — ARCHITECTURE.md + types.ts** | ⬜ NEXT | doc-only; mark canonical designations + dead orphans + line-count corrections |
| **NBA-2.B — nbaVolatilityResolver extraction** | ⬜ AFTER 2.A | create `pipeline/nba/nbaVolatilityResolver.js`; replace inline NBA-1 guards |
| **NBA-2.C — buildNbaSnapshotCandidates extraction** | ⬜ AFTER 2.B | move from `workstationRoutes.js` → `pipeline/nba/buildNbaSnapshotCandidates.js` |
| **NBA-2.D — nbaSlipUtils extraction + buildNbaAiSlips quarantine** | ⬜ AFTER 2.C | move helper trio; deprecate function shim |
| **NBA-2.E — Dead-orphan deletion sweep** | ⬜ AFTER 2.D smoke | delete `buildNbaSlipEngine.js`; delete orphan function bodies in `buildNbaAiSlips.js` |
| **NBA-2.F — Volatility resolver propagation to nightly** | ⬜ AFTER 2.E | audit + wire `bestBetsBoard.allPlays.volatility` flow |
| **NBA-2.G — Correlation absorption (Opus)** | ⬜ AFTER 2.F | extract `nbaCorrelation.js` from DynamicSlipEngine; wire into buildSlipAi NBA branch |
| **NBA-2.H — buildNbaDynamicSlipEngine deletion** | ⬜ AFTER 2.G stable | delete after correlation absorption verified |
| **NBA-2.I — aiRange wiring (Opus)** | ⬜ AFTER 2.H + NBA-3 | wire aiRangeResolved into buildSlipAi NBA branch |
| NBA-3 — Alt line gate (NBA-only) | ⬜ AFTER 2.E (parallelizable with 2.F) | allow quality alt lines through workstation; uses extracted buildNbaSnapshotCandidates |
| NBA-4 — Ecology tier layer | ⬜ BLOCKED on NBA-3 | NBA ELITE/STRONG stamps; unifies 3-source tier-stamping |
| NBA-5 — realismScore rebalance | ⬜ BLOCKED on NBA-4 | 0.70→0.45; requires Opus audit |
| NBA-6 — Eruption environment | ⬜ BLOCKED on NBA-5 | role-spike, blowout-risk, pace detection |
| NBA-7 — First basket ecosystem | ⬜ BLOCKED on NBA-6 | alt market accumulation; wires FirstBasketView |

**Repo health: 7.2/10** structural. NBA intelligence health: **2.9/10** (Session Z). NBA routing health: **4.6/10** (Session AB). NBA-1 ✅, NBA-2 audit ✅. Primary evolution lever: **NBA-2.A→2.D execution** (Sonnet, surgical).

---

## PENDING OPERATOR ACTIONS (macOS terminal — DO THESE FIRST)

```bash
cd ~/Desktop/betting-dashboard

# 1. Finalize checkpoint — commits Sessions H–AB
#    Session AB is read-only audit + 3 doc edits (NBA_CANONICAL_PATH_AUDIT,
#    CURRENT_STATE.md, NEXT_SESSION.md). No code mutations.
bash scripts/finalizeCheckpoint.sh
# → Report the commit hash

# 2. TERM 1 restart: NOT required for Session AB (read-only).
#    BUT if you have not yet restarted since Session AA (NBA-1 guard),
#    that restart is still pending — buildFeaturedPlays.js + buildSlipAi.js
#    were modified in Session AA. Check `ps aux | grep server.js` start time.
#    If start time pre-dates 2026-05-09 ~16:00:
node backend/server.js

# 3. Verify backend started cleanly (no require errors):
curl -s http://localhost:4000/api/best-available?sport=basketball_nba | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); \
  console.log('best:', p.bestAvailable?.best?.length, 'featured anchors:', p.bestAvailable?.featured?.anchors?.length)"

# 4. Remove orphaned dead file (boards/ is separate from pipeline/shared/)
rm backend/pipeline/boards/buildFeaturedPlays.js

# 5. Run historical backfill (if not already done post-Session S):
node backend/storage/importHistoricalData.js

# 6. After entering results for any settled date — first real review cycle:
node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08 --verbose
```

---

## IMMEDIATE NEXT PRIORITIES

---

### ✅ NBA-1 — PRA Volatility Guard (COMPLETE — Session AA)

**What was done**: Added snapshotSourced "lotto" guard to `normalizeCandidate()` in both `buildFeaturedPlays.js` and `buildSlipAi.js`. Added explicit `lotto: 0.65` volRealism slot in `scoreCandidate()`. Guard: `(raw.snapshotSourced === true && raw.volatility === "lotto") ? "lotto" : classifyVolatility(raw)`.

**Remaining lotto gap** (NBA-3 scope): base odds dec ~5–9 per leg; 5-leg combo ~22–26 is borderline [20, 1500] gate. Alt lines required for robust lotto seeding.

---

### ✅ NBA-2 — Canonical Path Constitution Audit (COMPLETE — Session AB)

**What was done**: Read-only Opus audit. Full importer trace of every NBA slip-related module. Constitutional designations made. 20-section deliverable: `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md`. Zero code changes.

**Canonical designations established**:
- `buildNbaSlipComposer.js` = canonical-nightly slip engine (writes nba_tracked_slips_*.json)
- `buildSlipAi.js` (shared) = canonical-workstation slip regenerator
- `buildNbaAiPicks.js` + `buildNbaPlayerOutcomePredictions.js` + `buildNbaBestBetsBoard.js` = canonical nightly board chain
- `nbaAiOutcomeRange.js` = canonical aiRange math (NEVER replace)
- `buildNbaAiSlips.js` = utility-only; main function deprecated
- `buildNbaDynamicSlipEngine.js` = dead orphan with valuable correlation logic (absorb-then-delete)
- `buildNbaSlipEngine.js` = dead orphan (delete in 2.E)

**Critical findings beyond Session Z**:
1. `aiRange` is computed by `buildNbaAiPicks` but consumed by NEITHER active slip engine. Phase 2.I scope.
2. All correlation logic lives only in the orphan `buildNbaDynamicSlipEngine.js`. Phase 2.G absorption required.
3. NBA-1 guard does NOT propagate to nightly path — `snapshotSourced` is workstation-only. Phase 2.F audit.
4. Two slip surfaces (`slipBets` + `aiSlips`) coexist with no constitutional documentation.
5. `buildNbaSnapshotCandidates` is NBA-specific but lives inline in workstationRoutes.js. Phase 2.C extraction.

---

### 🔴 Priority 1 — NBA-2.A: ARCHITECTURE.md + types.ts updates

**Scope**: Doc-only updates to reflect Session AB designations.

**Files to update**:
- `docs/ARCHITECTURE.md`:
  - "5 overlapping NBA slip builders" claim → corrected to "1 active nightly + 1 utility + 2 dead"
  - Update line counts (workstationRoutes.js: 620, buildFeaturedPlays.js: 848, buildSlipAi.js: 844)
  - Add canonical-nightly / canonical-workstation labels in module ownership table
  - Add `pipeline/shared/normalizers.js` and `pipeline/shared/buildWorkstationCompactors.js` to map
  - Add `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md` to docs index
- `frontend/src/workstation/types.ts`:
  - JSDoc comment on `slipBets` → "Engine-grade slips from nightly buildNbaSlipComposer"
  - JSDoc comment on `aiSlips` → "Workstation-regenerated slips from shared buildSlipAi"
  - No type shape changes

**Model: Sonnet or Auto** — pure doc edits, no logic.
**Risk**: Zero. **TERM 1 restart**: NO.

---

### 🔴 Priority 2 — NBA-2.B: nbaVolatilityResolver extraction

**Scope**: Replace inline NBA-1 guards with single canonical resolver function.

**Create** `backend/pipeline/nba/nbaVolatilityResolver.js`:
```javascript
const { classifyVolatility } = require("../shared/buildPortfolioOptimizer")
function nbaVolatilityResolve(row) {
  if (row.snapshotSourced === true && row.volatility === "lotto") {
    return { volatility: "lotto", source: "snapshot" }
  }
  return { volatility: classifyVolatility(row), source: "rules" }
}
module.exports = { nbaVolatilityResolve }
```

**Replace inline guards** in:
- `backend/pipeline/shared/buildSlipAi.js` line 121-123 → `volatility: nbaVolatilityResolve(raw).volatility`
- `backend/pipeline/shared/buildFeaturedPlays.js` line 95-97 → same

**Verify**:
- 15 NBA-1 guard test cases still pass
- MLB candidates flow through unchanged (`snapshotSourced` undefined)
- No new imports leak into shared modules (resolver imports classifyVolatility from shared, but the shared modules import the NBA resolver — acceptable since the resolver is a thin wrapper)

**Risk**: Low (additive resolver, narrow contract).
**Model: Sonnet** — surgical 3-file change.
**TERM 1 restart**: YES.

---

### 🔴 Priority 3 — NBA-2.C: buildNbaSnapshotCandidates extraction

**Scope**: Move the 70-line `buildNbaSnapshotCandidates()` function out of `workstationRoutes.js` (lines 155-226) into a new sport-specific module.

**Create** `backend/pipeline/nba/buildNbaSnapshotCandidates.js` with:
- Identical export shape (the function returns the same array)
- Imports from `nbaModelSignals` and `nbaEventTeamResolve` move with it
- The `NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD` and `NBA_SNAPSHOT_TOP_N` constants move with it (export both)

**Update** `backend/routes/workstationRoutes.js`:
- Remove the inline function + the two top-of-file imports `nbaRowModelProbability`/`nbaRowEdge` and `enrichNbaRowStatLayerInputs` (now encapsulated in the extracted module)
- Add: `const { buildNbaSnapshotCandidates, NBA_SNAPSHOT_SUPPLEMENT_THRESHOLD } = require("../pipeline/nba/buildNbaSnapshotCandidates")`

**Risk**: Near-zero. Pure refactor.
**Model: Sonnet** — 2-file change.
**TERM 1 restart**: YES.
**Why**: Prerequisite for NBA-3 (alt line gate is inside this function).

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
| NBA lotto slip starvation — odds gate | LOTTO tier gate [20, 1500] dec odds. Base legs dec ~5–9; 5-leg combo ~22–26 barely qualifies. Alt lines required. NBA-3. |
| classifyVolatility affecting MLB | VOLATILITY_RULES NOT modified. Guard is snapshotSourced-gated — MLB candidates never set snapshotSourced. Verified 0 MLB regressions. |
| NBA two-path disconnect | Workstation uses buildSlipAi.js (MLB-calibrated, canonical-workstation per Session AB). Nightly uses buildNbaSlipComposer (canonical-nightly per Session AB). Do NOT attempt to merge surfaces in NBA-2 phases — they serve different bettor needs. |
| realismScore monoculture | Do NOT touch 0.70 weight until NBA-4 ecology tier layer exists. Weight rebalance (NBA-5) requires tier stamps to be in place first. |
| aiRange resolution failure | alt line gate kills floor/median/ceiling. NBA-3 gate bypass must be NBA-specific only. Never relax globally. NBA-2.I wires aiRange into buildSlipAi NBA branch only after alt lines flow. |
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
- Do NOT loosen `propVariant !== "base"` gate without controlled alt-line audit
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
