# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-08 (Session R: NBA payload wiring — Fix R1: `handleNbaBestAvailableGet` now returns `bestAvailable` wrapper; 24 candidates / 22 featured / 11 slips confirmed; TERM 1 restart required; sessions H–R staged)_

---

## CURRENT PROJECT PHASE

**INTEGRITY + DE-RISK — Phase 7R (Fix 1–6 + Intelligence Layer + Checkpoint + Bettor UX Phase 1+2+3 + NBA Pipeline Audit + SP Fix 1+2 + Priority 1B + Session Q NBA Density + Session R Payload Wiring)**

All ecology compression points addressed. NBA `/api/best-available` payload now populated. Both `/api/ws/state` and `/api/best-available` require TERM 1 restart to activate. Remaining: Priority 1 (SQLite ledger migration, OVERDUE), lotto slip bottleneck, Priority 3 (tracked_best eventId).

---

## LAST SUCCESSFUL STATE

### ~~Session R — NBA Payload Wiring Audit~~ — DONE (2026-05-08)

**Root cause found**: `handleNbaBestAvailableGet` in `backend/http/nbaIsolatedRoutes.js` returned `{ nbaOpportunityBoard, nbaInsightBoard }` — missing the `bestAvailable` wrapper that App.tsx expects. The old compiled `nbaBestAvailable.inlined.js` had `bestAvailable: { ...bestAvailablePayloadBoardFirst }`. The refactored handler dropped it entirely.

**Secondary finding**: Session Q's `workstationRoutes.js` fixes (`/api/ws/state` path) also require TERM 1 restart — the Session Q notes incorrectly stated "TERM 1 restart: NO". Node module cache means changes don't live until server restart.

**File changed**: `backend/http/nbaIsolatedRoutes.js` only.

**Fix R1 — three-step edit:**
1. Added 4 new requires: `nbaRowModelProbability`, `nbaRowEdge`, `diversifyCandidates`, `buildFeaturedPlays`, `buildAiSlips`
2. Added `buildNbaBestAvailableWsCandidates(corePropsBoard)` helper — filters/scores/deduplicates `slices.corePropsBoard` rows into workstation Candidate format
3. Inside `handleNbaBestAvailableGet`, before the final return: build `wsCandidates` → `wsFeatured` → `wsAiSlips`; map insight rows into `elite`/`strong` buckets; return `{ bestAvailable: { best, elite, strong, ladders, firstBasket, aiSlips, featured, wsCandidates }, nbaOpportunityBoard, nbaInsightBoard }`

**Smoke test results (2026-05-08, backend/snapshot.json path):**
- corePropsBoard: 260 rows → 107 qualified → 65 deduped → 24 diversified
- Featured: anchors:4, tonightsBest:4, bestPra:4, bestLadders:4, smartAggression:2, safest:4 (22 total)
- AI slips: safe:3, balanced:4, aggressive:4, lotto:0 (11 total)
- `node --check` clean on `nbaIsolatedRoutes.js`, `workstationRoutes.js`, `server.js` ✓

---

### ~~Session Q — NBA Candidate Density Expansion~~ — DONE (2026-05-08)

**Root cause found**: Session P's `snapSupplement` was only wired into `supplementedCandidates` (portfolio optimizer path). Both `buildFeaturedPlays` and `buildAiSlips` consumed `aiCandidates` built from `[...pool.eligibleBets, ...pool.enrichedBest]` (2–4 tracked entries) — completely ignoring the snapshot supplement. This starved ALL bettor-facing surfaces.

**File changed**: `backend/routes/workstationRoutes.js` only.

**Four fixes applied:**

| Fix | Change | Impact |
|---|---|---|
| **Q1** | Cache `snapSupplement` once; wire into `aiCandidatesRaw` via new `aiCandidatesTracked` supplement path | Root fix — featured/slip pools now see snapshot candidates |
| **Q2** | `buildNbaSnapshotCandidates`: deduplicate by (player\|statFamily\|side), keep best edge | 187 raw → 83 unique combos; diversity algo gets max distinct positions |
| **Q3** | `nbaPerGame = sport === "nba" ? 12 : 7` — both `diversifyCandidates` calls | Lifts NBA hard cap from 14 to 24 |
| **Q4** | Snapshot volatility: PRA → `"lotto"`, threes/first_basket → `"aggressive"`, others → `"balanced"` | Affects diversity sort order; classifyVolatility overrides in slip/featured normalization |
| **Also** | `NBA_SNAPSHOT_TOP_N` 100 → 150 | More candidates eligible before diversity filter |

**Smoke test results (2026-05-08):**
- aiCandidates: 2 → **24** (threes:10, assists:3, rebounds:4, pra:3, points:4; ELITE:14, STRONG:10)
- Featured plays: 0 → **22** (anchors:4, tonightsBest:4, PRA Nukes:3, Ladders:4, smartAggression:3, safest:4)
- AI slips: 0 → **11** (safe:3, balanced:4, aggressive:4, lotto:0)
- Syntax check: `node --check` clean ✓

**Remaining bottlenecks identified:**
1. **Lotto slips empty** — PRA base odds → dec ~5–9 for 3-leg combo; below lotto [20,1500] minimum. classifyVolatility maps PRA → `aggressive`, not `lotto`.
2. **First basket empty** — `first_basket` family absent from base snapshot props (alt markets only).
3. **Under bias ~67%** — hash-based model systematic under-edge in snapshot candidates.
4. **smartAggression thin** — only PRA gets `aggressive` (classifyVolatility); threes → `balanced` → only 3 aggressive candidates.

---

## IMMEDIATE NEXT PRIORITIES

### 🔴 Priority 1 — SQLite migration: `personal_ledger.json`

**Trigger was 500 entries. Current: ~2,000 entries / 2.3MB. Migration is OVERDUE.**

Migration approach:
- Schema: `id INTEGER PK, date TEXT, player TEXT, stat TEXT, side TEXT, line REAL, odds INTEGER, book TEXT, edge REAL, result TEXT, clv REAL, created_at TEXT`
- Keep JSON fallback read path until write path verified end-to-end
- Do NOT dual-write indefinitely — cut over after 1 successful nightly run
- `buildPersonalLedger.js` owns all ledger I/O — isolate write path there

Model: **Sonnet** (well-scoped implementation task — root cause clear)

---

### 🟡 Priority 2 — NBA lotto slip bottleneck

**Problem**: PRA at base odds forms 3-leg combos at dec ~5–9, below lotto tier's [20, 1500] minimum. classifyVolatility (in `buildPortfolioOptimizer.js VOLATILITY_RULES`) maps PRA → `aggressive` regardless of the `volatility:"lotto"` field set in snapshot candidates.

**Two potential paths** (audit before committing to either):
- **Path A**: Override classifyVolatility for snapshot PRA candidates by adding a `snapshotSourced` guard in `buildFeaturedPlays.normalizeCandidate` / `buildSlipAi.normalizeCandidate` — use snapshot-set `volatility` field directly when `bet.snapshotSourced === true`. Minimal change, no VOLATILITY_RULES modification.
- **Path B**: Qualify higher-odds NBA alt-line PRA candidates (lines like 34.5/37.5 instead of core 30.5) into the snapshot pool via a separate `altPraRows` supplement pass. These naturally produce higher dec combos. Requires loosening the `propVariant !== "base"` gate carefully.

Model: **Opus** (requires audit of classifyVolatility override chain before touching; behavioral impact on MLB pipeline must be verified)

---

### 🟡 Priority 3 — eventId/matchup on tracked_best (upstream data quality)

**File:** `backend/scripts/runMlbNight.js` — wherever tracked_best entries are written.

All tracked_best entries have `eventId=null`, `matchup=null`. This causes:
1. ID match against tracked_bets always fails → no tier boosts for offensive overs
2. Game-based diversity caps never apply to tracked_best entries
3. Slip assembly game/script correlation detection blind to this pool

Fix: populate `eventId` and `matchup` from game data when writing tracked_best entries.
Requires full trace of runMlbNight.js before touching. Separate session.

---

### Priority 4 — Modular extraction #2: compactors

**Target**: `compactLineShopping` + `compactTiming` + `compactPortfolio` in `workstationRoutes.js`
→ `pipeline/shared/buildWorkstationCompactors.js`

~103 lines of pure serialization, no globals. `workstationRoutes.js` → ~474 lines after.
Zero behavior change. Standard extraction pattern.

---

### Priority 5 — PIPELINES docs

`/docs/ARCHITECTURE.md` created 2026-05-07. Still pending:
- `/docs/PIPELINES/MLB.md` — MLB pipeline, phase4Tracking, weaknesses
- `/docs/PIPELINES/NBA.md` — NBA boards, slips, ecology gaps, Session Q findings
- `/docs/PIPELINES/TRACKING.md` — all tracking files, sizes, write-race risk

---

### Priority 6 — Extract `isOffensiveAttackStat` into shared normalizer

`buildFeaturedPlays.js` defines `isOffensiveAttackStat()`.
`buildSlipAi.js` has its own inline list inside `offensiveAttackTextureBonus()`.
Extract to `pipeline/shared/normalizers.js`. 30-minute task.

---

### Priority 7 — server.js Phase A: pure utilities

Lines 11,379–11,430 → `pipeline/shared/mathUtils.js`. ~52 lines, no globals.
Requires ARCHITECTURE.md first to verify no hidden dependencies.

---

## PENDING OPERATOR ACTIONS (macOS terminal)

```bash
cd ~/Desktop/betting-dashboard

# 1. Commit Sessions H–R (includes Session Q + R fixes)
bash scripts/finalizeCheckpoint.sh

# 2. REQUIRED: Restart TERM 1 (backend server) to activate Session Q + R changes
#    Ctrl-C the running node process, then:
node backend/server.js

# 3. Verify /api/best-available now returns populated NBA payload
curl -s "http://localhost:4000/api/best-available?sport=basketball_nba" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); \
  console.log('best:', p.bestAvailable?.best?.length, 'elite:', p.bestAvailable?.elite?.length, \
  'slips safe:', p.bestAvailable?.aiSlips?.safe?.length, \
  'featured anchors:', p.bestAvailable?.featured?.anchors?.length)"

# 4. Remove orphaned dead file (virtiofs blocks sandbox rm)
rm backend/pipeline/boards/buildFeaturedPlays.js

# 5. SQLite historical backfill (macOS native fs required)
node backend/storage/importHistoricalData.js
```

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| buildFeaturedPlays fork | ✅ RESOLVED — dead import removed, one canonical path |
| personal_ledger.json corruption | SQLite migration now overdue — do not defer further |
| NBA lotto slip starvation | classifyVolatility override chain — audit before touching normalizeCandidate |
| NBA smartAggression thin | Only PRA gets aggressive; threes→balanced by classifyVolatility. Do NOT widen without tracing |
| classifyVolatility affecting MLB | Any change to VOLATILITY_RULES or normalizeCandidate must verify MLB ecology unchanged |
| Fix 3 volRealism: hierarchy inversion | lotto=0.56 still below balanced=0.74 ✓ |
| Fix 6 greedy fill: leg count regressions | DO NOT touch max→min walk-back direction without full impact trace |
| Premium-edge override admits clown plays into safe slips | Three gates: 12% edge AND 50% modelProb AND maxOdds 150 |
| Cache (60s TTL) serving stale results | Wait for expiry; TERM 2 restart if needed |
| NBA under bias (67%) | Do NOT impose artificial side balance — ecology caps handle it |
| Duplicate balanced slip (seenSignatures) | Do not add dedup workaround without tracing root cause |

---

## WHAT NOT TO DO

- Do NOT increase textureBoost — Fix 1 is active; calibration needs re-assessment
- Do NOT force over/under parity — let edge decide; side caps already active
- Do NOT touch the `[0.50, 0.55]` modelProb cap anywhere — correct and working
- Do NOT raise slipAi or featured tierBoost back — structural under-side monopoly
- Do NOT lower safe-tier maxOdds cap below 150
- Do NOT remove premium-edge thresholds (12% edge, 50% modelProb)
- Do NOT widen `maxPerGame` beyond 2 in anchors
- Do NOT attempt server.js Phase B/C extraction without ARCHITECTURE.md global map
- Do NOT touch `runMlbNight.js` without tracing candidate paths first
- Do NOT touch the portfolio optimizer concentration penalty
- Do NOT change MAX_PLAYER_GLOBAL cap
- Do NOT reopen ecology fixes — all six compression points are resolved
- Do NOT modify `VOLATILITY_RULES` for NBA lotto without verifying MLB ecology unchanged (Path A preferred over Path B for isolation)
- Do NOT loosen `propVariant !== "base"` gate in snapshot candidates without a controlled alt-line audit

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| NBA lotto audit (classifyVolatility override chain) | **Opus** |
| Root-cause audit on unknown bug | **Opus** |
| Ecology fixes (verified, well-scoped) | **Sonnet** |
| SQLite migration (well-scoped) | **Sonnet** |
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

---

## ECOLOGY COMPRESSION POINTS

| # | Location | Mechanism | Status |
|---|---|---|---|
| CP1 | `buildCandidateDiversity.js:51` | Uncapped `(edge×4)×prob` sort — 1.87× TB-under bias | ✅ **FIXED** |
| CP2 | `buildSlipAi.js` aggressive seeding | Balanced TB unders seed aggressive slips over lotto overs | ✅ **FIXED** |
| CP3 | `buildFeaturedPlays.js` volRealism | lotto=0.46; textureBoost (+0.030) can't cover the gap | ✅ **FIXED (0.56/0.66)** |
| CP4 | `enrichBestEntry` ID match | tracked_best has no eventId → zero tier boosts | **Priority 3** |
| CP5 | `TIER_TEMPLATES.lotto.decimalOddsRange` | [25, 800] + greedy fill | ✅ **FIXED ([20,1500] + Fix 6)** |
| CP6 | tracked_best upstream data | No eventId/matchup → game correlation blind | **Data quality** |
| CP7 | `TIER_TEMPLATES.aggressive.decimalOddsRange` | [6.0, 60.0] ceiling | ✅ **FIXED ([6.0,120.0])** |
| CP8 | `buildSlipsForTier` greedy fill loop | 5-leg dec >> 1500; 3-leg ✓ discarded | ✅ **FIXED (Fix 6)** |
| **CP9** | **NBA aiCandidates pool** | **Snapshot supplement not wired into featured/slip pools** | ✅ **FIXED (Session Q Fix Q1)** |
| **CP10** | **NBA lotto slips** | **PRA base-odds dec ~5–9 < [20,1500]; classifyVolatility PRA→aggressive** | **Priority 2** |

---

## CALIBRATION DIRECTION (cumulative)

| Lever | Status |
|---|---|
| Side balance in featured buckets | Capped at 60% (anchors 55%) |
| Stat concentration | maxPerStat:10 / maxPerStatSide:6 |
| Volatility taxonomy | Fixed — hits/runs/etc. → balanced |
| modelProb compounding | Capped [0.50, 0.55] in featured + slipAi + diversity sort |
| Offensive over recognition | Active — stacked textureBoost (0.020/0.030) |
| Anchor cross-side | maxPerGame:2 |
| Featured tierBoost | Halved — ELITE 0.04, STRONG 0.02 |
| slipAi tierBoost | Halved — ELITE 0.05, STRONG 0.025 |
| Safe-tier premium-edge override | Active — 12% edge / 50% modelProb / maxOdds 150 |
| Featured safest premium-edge override | Active — same thresholds |
| Lotto volRealism | 0.56 — lotto surfaces in tonightsBest/smartAggression |
| Lotto decimalOddsRange | [20,1500] + Fix 6 walk-back |
| Aggressive decimalOddsRange | [6.0,120.0] |
| Greedy fill architecture | Walk-back max→min — lotto 4 slips; aggressive 4/4 volatile |
| **NBA aiCandidates pool** | ✅ **Fixed (Session Q)** — snapshot supplement wired into all bettor-facing surfaces |
| **NBA maxPerGame ceiling** | ✅ **Fixed (Session Q)** — 7→12 for NBA; 2-game playoff slate → 24 candidates |
| **NBA snapshot dedup** | ✅ **Fixed (Session Q)** — 187 raw → 83 unique (player\|stat\|side) combos |

---

## SQLITE MIGRATION SEQUENCE

0. ~~**Phase 1: storage layer** — DONE 2026-05-07~~
   Run `node backend/storage/importHistoricalData.js` on macOS to populate historical data.
1. **`personal_ledger.json` → ledger table — NOW OVERDUE (~2,000 entries)**
2. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
3. `timing_intelligence_state.json` → timing state table (729KB, unbounded)
4. `book_intelligence_state.json` → book profiles table
5. `graded_props_*.json` → review/grading table

---

## INFRASTRUCTURE STATUS

| File | Status |
|---|---|
| `docs/WORKFLOW_RULES.md` | Committed |
| `docs/CURRENT_STATE.md` | **Updated this session (Session R)** |
| `docs/NEXT_SESSION.md` | **Updated this session (Session R)** |
| `docs/BOOTSTRAP_PROMPT.md` | Committed |
| `.cursor/rules/workflow.mdc` | Committed |
| `docs/ARCHITECTURE.md` | Created 2026-05-07 |
| `docs/PIPELINES/NBA.md` | Pending |
| `docs/PIPELINES/MLB.md` | Pending |
| `docs/PIPELINES/TRACKING.md` | Pending |
| `backend/storage/schema.js` | Created 2026-05-07 |
| `backend/storage/db.js` | Created 2026-05-07 |
| `backend/storage/queries.js` | Created 2026-05-07 |
| `backend/storage/importHistoricalData.js` | Created 2026-05-07 |
| `backend/storage/intelligenceSchema.js` | Created 2026-05-07 (Session H) |
| `backend/storage/intelligence.js` | Created 2026-05-07 (Session H) |
| `backend/scripts/runMlbNight.js` | Intelligence wiring 2026-05-07 (Session I) |
| `backend/scripts/runNbaNight.js` | Intelligence wiring 2026-05-07 (Session I) |
| `backend/pipeline/shared/buildPostGameReview.js` | Outcome settlement 2026-05-07 (Session J) |
| `backend/scripts/checkpointRepo.js` | Created 2026-05-07 (Session K) |
| `backend/scripts/finalizeCheckpoint.sh` | Created 2026-05-07 (Session K) |
| `backend/pipeline/shared/buildCandidateDiversity.js` | Fix 1 applied 2026-05-07 |
| `backend/pipeline/shared/buildSlipAi.js` | Fix 2 + Fix 4 + Fix 5 + Fix 6 applied 2026-05-07 |
| `backend/pipeline/shared/buildFeaturedPlays.js` | Fix 3 applied 2026-05-07 · Session N: bestPra + bestFirstBasket |
| `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js` | Session O SP Fix 1: stats.pra derived |
| `backend/pipeline/nba/buildNbaPerformanceTracking.js` | Session O SP Fix 2: altPlays gate · Session P Fix 1B-B: persistNbaTrackedBest |
| `backend/routes/workstationRoutes.js` | Session N: readSnapshotRows · Session P Fix 1B-C: buildNbaSnapshotCandidates · **Session Q Fix Q1–Q4** |
| `backend/http/nbaIsolatedRoutes.js` | **Session R Fix R1: `bestAvailable` wrapper + workstation pipeline added to `handleNbaBestAvailableGet`** |
| `frontend/src/workstation/types.ts` | Session N: bestPra + bestFirstBasket |
| `frontend/src/workstation/sections/Dashboard.tsx` | Session N: NbaSpotlightGrid + MlbSpotlightGrid |
| `frontend/src/workstation/sections/FirstBasketView.tsx` | Session N: full premium rewrite |
| `frontend/src/workstation/workstation.css` | Sessions L+M+N: full bettor UX CSS |
| `backend/pipeline/boards/buildFeaturedPlays.js` | **Orphaned — needs manual `rm` from macOS terminal** |
