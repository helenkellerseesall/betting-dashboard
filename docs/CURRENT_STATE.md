# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-09 (Session AB: NBA-2 Canonical Path Constitution Audit — read-only Opus audit; full importer trace; 20-section deliverable; canonical designations made; 9-phase migration plan (2.A→2.I); zero code changes; zero TERM 1 restart)_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | e076871 (Session I) — Sessions H–AB staged, pending finalization via finalizeCheckpoint.sh |
| Repo health | **7.2/10 structural. NBA intelligence health: 2.9/10 (audited). NBA routing health: 4.6/10 (Session AB). NBA-1 complete. NBA-2 audit complete. Next lever: Phase 2.A→2.D execution (Sonnet, surgical).** |

---

## RUNTIME ARCHITECTURE

```
TERM 1: Node/Express backend — port 4000
  └── backend/server.js
  └── routes: workstationRoutes.js, mlbIsolatedRoutes.js

TERM 2: Manual operator verification only
```

Frontend: React 19 + Vite, TypeScript, CSS Modules
Backend: Node.js, Express, flat JSON persistence (`backend/runtime/tracking/`)
Cache: In-memory 60s TTL per (sport, date) key in `workstationRoutes.js`

---

## ACTIVE SYSTEMS

| System | Status | Owner file |
|---|---|---|
| MLB nightly pipeline | Working | `scripts/runMlbNight.js` |
| **MLB HR candidate scoring** | **Fixed (Session T) — HR tiering/scoring recalibrated; STRONG HR now surfaces** | **`pipeline/mlb/buildMlbPropClusters.js`** |
| **MLB roster integrity — team field** | **Fixed (Session V) — team/teamCode/awayTeam/homeTeam now persisted in leanBet/leanSlip** | **`pipeline/mlb/phase4Tracking.js`, `buildMlbPropClusters.js`, `buildMlbPlayerDataset.js`, `external/mlbPlayerIdentityCache.js`** |
| NBA nightly pipeline | Working | `scripts/runNbaNight.js` |
| AI Slip construction | Working | `pipeline/shared/buildSlipAi.js` |
| Featured plays (anchors/supports) | Working | `pipeline/shared/buildFeaturedPlays.js` |
| Volatility classifier | Working | `pipeline/shared/buildPortfolioOptimizer.js` |
| Candidate diversification | Working | `pipeline/shared/buildCandidateDiversity.js` |
| NBA snapshot routing | Fixed (Session N) | `routes/workstationRoutes.js` |
| NBA aiCandidates supplement | Fixed (Session Q Fix Q1) | `routes/workstationRoutes.js` |
| `/api/best-available` NBA payload | Fixed (Session R Fix R1) | `http/nbaIsolatedRoutes.js` |
| Line shopping | Working | `routes/workstationRoutes.js` |
| Portfolio optimizer | Working | `pipeline/shared/buildPortfolioOptimizer.js` |
| Market timing intelligence | Working | `pipeline/shared/buildMarketTimingIntelligence.js` |
| CLV tracking | Working | `pipeline/shared/buildClv.js` |
| **Personal ledger — JSON write** | **Fixed (Session S) — atomic rename, no .tmp orphan** | **`pipeline/shared/buildPersonalLedger.js`** |
| **Personal ledger — SQLite mirror** | **Active (Session S) — write-through mirror on every saveLedger()** | **`pipeline/shared/buildPersonalLedger.js` + `storage/queries.js`** |
| **Screenshot intelligence — ingestion** | **Active (Session U) — JSON slip ingest → normalize → classify → SQLite** | **`pipeline/screenshots/screenshotRoutes.js`** |
| **Screenshot intelligence — normalizer** | **Active (Session U) — pure function, source-agnostic, 7 input shapes** | **`pipeline/screenshots/normalizeIngestedSlip.js`** |
| **Screenshot intelligence — classifier** | **Active (Session U) — 10 dimensions, 7 archetypes, composite scoring** | **`pipeline/screenshots/classifyIngestedSlip.js`** |
| Post-game review engine | Working + Intelligence settlement wired (Session J) | `pipeline/shared/buildPostGameReview.js` |
| Nightly orchestrator | **Updated (Session W) — Step 9: dailyIntelligenceReview wired** | `pipeline/shared/buildNightlyOrchestrator.js` |
| **Daily Intelligence Review Engine** | **NEW (Session W) — 8 modules; calibration, ecology, volatility, eruptions, process** | **`pipeline/review/`** |
| **Offensive stat canonical** | **NEW (Session Y) — isOffensiveAttackStat() unified in normalizers.js** | **`pipeline/shared/normalizers.js`** |
| **Workstation compactors** | **NEW (Session Y) — extracted from workstationRoutes.js** | **`pipeline/shared/buildWorkstationCompactors.js`** |
| Workstation frontend | Working — bettor UX Phase 1+2+3 applied (Sessions L+M+N) | `frontend/src/workstation/` |

---

## FRONTEND SECTIONS

| View | File |
|---|---|
| Dashboard (command center) | `sections/Dashboard.tsx` |
| Slate browser | `sections/SlateBrowser.tsx` |
| AI Slips center | `sections/AiSlipsView.tsx` |
| Bet builder | `sections/BetBuilderView.tsx` |
| Line shopping | `sections/LineShoppingView.tsx` |
| Portfolio view | `sections/PortfolioView.tsx` |
| Process review | `sections/ProcessReviewView.tsx` |
| First basket | `sections/FirstBasketView.tsx` — premium rewrite Session N |

---

## RUNTIME TRACKING FILES (today: 2026-05-09)

| File | Contents |
|---|---|
| `mlb_tracked_bets_2026-05-08.json` | MLB bets (134 bets, all pending — no results entered yet) |
| `mlb_tracked_best_2026-05-08.json` | HR/TB/RBI overs attack board |
| `mlb_tracked_slips_2026-05-08.json` | AI-generated slip catalog |
| `nba_tracked_bets_2026-05-08.json` | 2 bets (rebounds only — thin) |
| `personal_ledger.json` | **2,000 entries / 2.3MB — atomic JSON write + SQLite mirror** |
| `book_intelligence_state.json` | Sportsbook CLV/profile rolling state |
| `snapshot.json` | 9.47MB, 5,209 rows |

---

## SQLITE STATE

| File | Status |
|---|---|
| `backend/storage/betting.db` | 782KB — has `prediction_snapshots` (110 rows), `ecology_snapshots` (4 rows); `personal_ledger` table (Session S); 6 review tables (Session W — auto-applied on next restart). |
| `backend/storage/betting.db-journal` | **Stale virtiofs rollback journal — blocks sandbox access.** macOS TERM 1 can open betting.db normally. |

**betting2.db + betting2.db-journal + storage/test.txt → DELETED (Session Y)**

---

## SESSION Y — Repo Constitution Cleanup (Phase 0 + Phase 2)

### Scope (2026-05-09):
Zero-regression structural stabilization. Dead code removal, duplication elimination, mutex integrity fix. No behavior changes to any scoring, ecology, or slip logic.

### Phase 0 — Dead code deleted:

| File | Lines removed | Reason |
|---|---|---|
| `backend/http/nbaBestAvailable.inlined.js` | 6,867 | Confirmed dead — explicitly excluded by nbaIsolatedRoutes.js. 0 importers. |
| `backend/http/nbaRefreshSnapshot.inlined.js` | 4,318 | Confirmed dead — same. 0 importers. |
| `backend/pipeline/enrich/index.js` | 0 (empty) | Empty stub, 0 importers |
| `backend/pipeline/normalize/index.js` | 0 (empty) | Empty stub, 0 importers |
| `backend/pipeline/validation/rows.js` | 0 (empty) | Empty stub, 0 importers |
| `backend/pipeline/snapshot/buildSnapshot.js` | 0 (empty) | Empty stub, 0 importers |
| `backend/storage/betting2.db` | — | Orphan test DB |
| `backend/storage/betting2.db-journal` | — | Stale journal for orphan |
| `backend/storage/test.txt` | — | Empty test artifact |

**Total dead code removed: 11,185 lines. 9 files. 4 empty directories cleaned.**

### Phase 2 — Tactical extractions:

#### Task 1 — `isOffensiveAttackStat` unified

| File | Change |
|---|---|
| `pipeline/shared/normalizers.js` | **NEW** — canonical `isOffensiveAttackStat(fam)` + `normFam(v)`. 54 lines. |
| `pipeline/shared/buildFeaturedPlays.js` | **MODIFIED** — import from normalizers; local 16-line definition removed. |
| `pipeline/shared/buildSlipAi.js` | **MODIFIED** — import from normalizers; inline 8-line `offensive` check replaced with single call. |

**Alignment note**: buildSlipAi previously omitted `doubles` and `triples` from its offensive stat check (accidental omission vs buildFeaturedPlays). The canonical definition now correctly includes both. This is a legitimate alignment, not a regression — doubles/triples are genuine offensive attack stats. Impact is minimal (rare stat families, max +0.032 texture bonus).

#### Task 2 — Compactors extracted

| File | Change |
|---|---|
| `pipeline/shared/buildWorkstationCompactors.js` | **NEW** — `compactLineShopping`, `compactTiming`, `compactPortfolio`. 145 lines. Exact behavior preserved. |
| `routes/workstationRoutes.js` | **MODIFIED** — import from buildWorkstationCompactors; 103-line inline block removed. 721 → 620 lines. |

#### Task 3 — Dual-mutex fixed

| File | Change |
|---|---|
| `backend/server.js` | **MODIFIED** — `/refresh-snapshot` route unified to module-level `__refreshInProgress` / `__lastRefreshTime`. Removed local `let` declarations (lines 19052–19053) and `global.*` assignments (lines 19065, 19068, 19144). Now shares mutex with `/api/best-available`. |

**Mutex before**: `/refresh-snapshot` used `global.__refreshInProgress` (separate scope from module-level). `/api/best-available` used module-level. They could run concurrently.

**Mutex after**: Both routes read/write the same module-level `__refreshInProgress` and `__lastRefreshTime`. Concurrent refresh is now impossible.

### Session Y smoke test results (2026-05-09):

| Test | Result |
|---|---|
| `node --check` all 6 modified/new files | ✓ 6/6 clean |
| Zero deleted-file references remaining | ✓ (nbaRefreshSnapshot comment in nbaIsolatedRoutes is benign) |
| normalizers.js — 23 `isOffensiveAttackStat` cases | ✓ 23/23 pass |
| compactors — null safety + shape tests | ✓ all pass |
| Module resolution (require all new imports) | ✓ all resolve |
| global.* mutex references in server.js | ✓ 0 remaining |
| http/ directory — 2 files only | ✓ mlbIsolatedRoutes.js + nbaIsolatedRoutes.js |
| 4 empty stub directories removed | ✓ enrich/ normalize/ validation/ snapshot/ gone |

**TERM 1 restart required** — server.js modified (mutex fix). workstationRoutes.js modified (compactor import).

---

## SESSION AB — NBA-2: Canonical Path Constitution Audit (2026-05-09)

**Scope**: Read-only Opus audit. Full importer trace of every NBA slip-related module. Constitutional designation of canonical-nightly + canonical-workstation slip surfaces. 20-section deliverable. Zero code changes. Zero TERM 1 restart.

**Output**: `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md` — 20 sections, NBA Routing Health Score 4.6/10.

### Critical structural correction to Session Z audit:

The Session Z NBA Ecology Audit framing of "5 overlapping NBA slip builders" was misleading. Direct importer trace proves:

| Module | True status | Importers (live) |
|---|---|---|
| `buildNbaSlipComposer.js` | **CANONICAL nightly slip engine** | `buildNbaOpportunityBoard.js:13` → called line 257 → output written to `nba_tracked_slips_*.json` via `persistTrackedToday` |
| `buildNbaAiPicks.js` | **CANONICAL nightly pick scorer + aiRange attacher** | `buildNbaOpportunityBoard.js:9` → called line 238 |
| `buildNbaPlayerOutcomePredictions.js` | **CANONICAL nightly prediction engine** | `buildNbaOpportunityBoard.js:11` → called line 242 |
| `buildNbaBestBetsBoard.js` | **CANONICAL nightly board surface** | `buildNbaOpportunityBoard.js:12` → called line 251 |
| `buildNbaAiSlips.js` | **UTILITY-ONLY** — `buildNbaAiSlips()` function has ZERO importers; only its helper trio is consumed | `buildNbaPlayerOutcomePredictions` (`collectFullPool`), `buildNbaDynamicSlipEngine` (`collectFullPool`/`filterSlipLegs`/`formatLeg`) |
| `buildNbaDynamicSlipEngine.js` | **DEAD ORPHAN** with valuable correlation logic | zero importers (only comment-mention in nbaSlipLegConstraints.js) |
| `buildNbaSlipEngine.js` | **DEAD ORPHAN** | zero importers (only comment-mention in nbaAiStatFamilyRank.js) |
| `buildSlipAi.js` (shared) | **CANONICAL workstation slip regenerator** | `workstationRoutes.js:251` → called line 352 (every `/api/ws/state` request) |

### NBA Routing Health Score:

| Dimension | Score |
|---|---|
| Canonical-engine clarity | 4.5/10 |
| Dead-code namespace pollution | 3.5/10 |
| Workstation/nightly symmetry | 3.0/10 |
| Correlation logic ownership | 2.0/10 |
| aiRange resolution propagation | 5.0/10 |
| snapshotSourced flow | 7.0/10 |
| Volatility ownership | 4.5/10 |
| Tier ownership | 3.5/10 |
| Same-player suppression | 6.0/10 |
| Workstation compatibility | 6.5/10 |
| **OVERALL NBA ROUTING** | **4.6/10** |

### Critical findings beyond Session Z:

1. **`aiRange` is computed by `buildNbaAiPicks` but consumed by NEITHER active engine.** `buildSlipAi` doesn't import `nbaAiOutcomeRange`. `buildNbaSlipComposer` operates on `bestBetsBoard.allPlays` which doesn't carry `aiRange`. The two DEAD engines (`buildNbaAiSlips` + `buildNbaDynamicSlipEngine`) DO consume it. This is the single largest architectural gap — ladder ranges are computed and never reach the slip layer.

2. **All correlation logic (pairwiseStackBoost, jointProbabilityWithCorrelation, isFastCashoutLeg, ensureFastLegsLead) lives in the orphan `buildNbaDynamicSlipEngine.js`.** The active path has zero correlation. Must be absorbed BEFORE deletion (Phase 2.G).

3. **The NBA-1 snapshotSourced guard does NOT propagate to the nightly path.** `buildNbaSnapshotCandidates` (workstation only) is the sole setter of `snapshotSourced: true`. Nightly candidates flow through `classifyVolatility` unguarded. Phase 2.F audit + wiring required.

4. **Two slip surfaces (`slipBets` + `aiSlips`) coexist in `/api/ws/state` with no constitutional documentation.** `slipBets` = nightly engine-grade (Composer output); `aiSlips` = workstation regenerated (buildSlipAi). Both reach the bettor.

5. **`buildNbaSnapshotCandidates` is NBA-specific but lives inline in workstationRoutes.js** (~70 lines, pollutes the supposedly sport-agnostic routes file). Phase 2.C extraction prerequisite for NBA-3.

### NBA-2 Migration Plan (9 phases, post-AB sessions):

| Phase | Task | Model | Risk |
|---|---|---|---|
| 2.A | ARCHITECTURE.md + types.ts comments updated | Sonnet | Zero |
| 2.B | Create `pipeline/nba/nbaVolatilityResolver.js`; replace inline NBA-1 guards | Sonnet | Low |
| 2.C | Extract `buildNbaSnapshotCandidates` from workstationRoutes → `pipeline/nba/` | Sonnet | Near-zero |
| 2.D | Create `pipeline/nba/nbaSlipUtils.js`; quarantine buildNbaAiSlips to shim | Sonnet | Low |
| 2.E | Delete `buildNbaSlipEngine.js` + orphan function bodies in `buildNbaAiSlips.js` | Sonnet | Low |
| 2.F | Audit + wire bestBetsBoard volatility to resolver | Sonnet | Medium |
| 2.G | Extract `pipeline/nba/nbaCorrelation.js` from DynamicSlipEngine; wire into buildSlipAi NBA branch | **Opus** | Medium-high |
| 2.H | Delete `buildNbaDynamicSlipEngine.js` (after 2.G stable) | Sonnet | Low |
| 2.I | Wire aiRange into buildSlipAi NBA branch | **Opus** | High |

### What must never change (from this audit):
- `nbaAiOutcomeRange.js` (computeOutcomeRange, resolveLegFromAiRange, resolveLottoLegAboveCeiling)
- `nbaAiStatFamilyRank.js` (role/stat alignment, statStabilityWeight table)
- `nbaPropLanes.js` (CORE_LANES / COMBO_LANES taxonomy)
- `passesEliteTierGate` numeric thresholds (NBA-4 scope only)
- `compositeRankScore` weights (NBA-5 scope only)
- NBA-1 snapshotSourced guard pattern (extracted to resolver but contract preserved)
- `VOLATILITY_RULES` static table itself
- `f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)` cap (Sessions T-V)
- `/api/ws/*` response shape (`slipBets`, `aiSlips`, `featured`)
- `applyEdgeToNbaRows` apply order
- `dominanceGap` filter
- `pseudoThrees` logic in buildNbaAiPicks
- `persistTrackedToday` atomic-rename pattern

### Pending checkpoint:
- Files added (1): `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md` (~1,150 lines)
- Files modified (2): `CURRENT_STATE.md`, `NEXT_SESSION.md` (Session AB section + roadmap)
- Code mutations: 0
- TERM 1 restart: NO (read-only)

---

## SESSION AA — NBA-1: PRA Volatility Guard (2026-05-09)

**Scope**: Surgical fix to preserve PRA/combo-stat `volatility: "lotto"` stamps that `buildNbaSnapshotCandidates()` (workstationRoutes.js FIX Q4) applies on snapshot candidates. Previously, `normalizeCandidate()` in both downstream modules unconditionally called `classifyVolatility(raw)`, which overwrites "lotto" with "aggressive" (VOLATILITY_RULES: `combo/pra → aggressive`). NBA-1 adds a narrow guard that skips reclassification when the candidate is confirmed snapshot-sourced and already stamped lotto. MLB candidates never set `snapshotSourced` — zero MLB behavior change.

### Files Modified (3 edits, 2 files):

| File | Change | Lines |
|---|---|---|
| `pipeline/shared/buildFeaturedPlays.js` | `normalizeCandidate()`: snapshotSourced "lotto" guard | ~87–97 |
| `pipeline/shared/buildFeaturedPlays.js` | `scoreCandidate()` volRealism: lotto → 0.65 explicit slot (was 0.56 fallthrough) | ~130 |
| `pipeline/shared/buildSlipAi.js` | `normalizeCandidate()`: same snapshotSourced "lotto" guard | ~113–124 |

**VOLATILITY_RULES NOT modified.** `classifyVolatility()` NOT modified. `SAFE` lane unchanged. MLB ecology unchanged.

### Guard Logic (identical in both modules):
```javascript
// NBA-1: Preserve snapshotSourced volatility for lotto-stamped candidates.
// buildNbaSnapshotCandidates() (workstationRoutes.js FIX Q4) stamps
// volatility: "lotto" on PRA combo candidates and snapshotSourced: true.
// Without this guard, classifyVolatility() overwrites with "aggressive"
// (VOLATILITY_RULES: combo/pra → aggressive), blocking PRA from the lotto
// slip tier and penalizing it in volRealism scoring vs balanced stats.
// Guard is narrow: only preserves "lotto" stamps from confirmed snapshot
// source. MLB candidates never set snapshotSourced — no MLB behavior change.
// VOLATILITY_RULES itself is NOT modified.
volatility: (raw.snapshotSourced === true && raw.volatility === "lotto")
              ? "lotto"
              : classifyVolatility(raw),
```

### volRealism Fix (buildFeaturedPlays.js only):
```javascript
// NBA-1: lotto gets its own slot (0.65 ≈ aggressive 0.66) rather than the
// generic 0.56 fallthrough. Without this, PRA candidates correctly preserved
// as "lotto" score ~0.01 lower than equivalent aggressive plays — suppressing
// PRA ecosystem surfacing despite the classification fix.
f.volRealism = c.volatility === "safe" ? 0.80 :
               c.volatility === "balanced" ? 0.74 :
               c.volatility === "aggressive" ? 0.66 :
               c.volatility === "lotto" ? 0.65 :
               0.56
```

### Verification Results:
| Test | Result |
|---|---|
| `node --check` — 4 affected files | ✓ 4/4 clean |
| Guard logic — 15 test cases | ✓ 15/15 pass |
| MLB regression test | ✓ 0 regressions |
| buildAiSlips full run — PRA classification | ✓ PRA → "lotto", seeds aggressive slips |
| buildFeaturedPlays full run — bestPra | ✓ 4 plays all "lotto", smartAggression surfaces PRA |
| SAFE lane | ✓ clean, no lotto contamination |
| LOTTO slips populated | ⚠ empty (expected — odds gate NBA-3 scope) |

### Intentional Design Tradeoffs:
- PRA reclassified as "lotto" loses balanced tier access (`allowedVolatility: ["safe","balanced","aggressive"]` — lotto not included). This is correct: combo stats do not belong in balanced slips.
- PRA retains aggressive tier access (lotto is in `["balanced","aggressive","lotto"]`).
- LOTTO slips remain sparse because base-odds legs (dec ~5–9 each, 5-leg combo ~22–26) barely reach the [20, 1500] gate. NBA-3 (alt line gate) is the structural fix.

### NBA-2 Inheritance from NBA-1:
- `buildNbaAiSlips.js` (canonical path) has its own `normalizeCandidate()` — NBA-2 must apply the same snapshotSourced guard OR ensure lotto stamps flow through its input pool without reclassification
- The volRealism fix is in `buildFeaturedPlays.js` only — NBA-2 canonical slip scoring path must be audited separately (Opus)
- `snapshotSourced: true` flag is the sentinel — NBA-2 input shape must preserve this field when piping workstation pool into buildNbaAiSlips

**TERM 1 restart required** — `buildFeaturedPlays.js` and `buildSlipAi.js` both modified; both are loaded at startup.

---

## SESSION Z — NBA Ecology Constitution Audit (2026-05-09)

**Scope**: Read-only philosophical + architectural audit. Zero code changes. Zero regressions. Zero TERM 1 restart required.

**Output**: `docs/NBA_ECOLOGY_AUDIT_2026-05-09.md` — 20 sections, NBA Ecology Health Score 2.9/10.

### NBA Ecology Health Score Summary:

| Dimension | Score |
|---|---|
| Candidate diversity | 3.5/10 |
| Volatility ecosystem richness | 2.0/10 |
| Role-spike surfacing | 2.0/10 |
| Ladder coherence | 2.5/10 |
| Eruption environment | 1.0/10 |
| First-basket ecosystem | 2.0/10 |
| Aggression tier authenticity | 3.0/10 |
| Same-game correlation logic | 4.0/10 |
| **OVERALL** | **2.9/10** |

### 8 Critical Failures Confirmed:

1. **Two-path disconnect** — workstation uses MLB-calibrated shared path; NBA-specific builders orphaned
2. **realismScore monoculture** — 70% weight guarantees star dominance; 3× edge cannot overcome gap
3. **Lotto starvation** — structural failure on both paths; fallback mirrors aggressive
4. **aiRange crippled** — alt line gate (`propVariant !== "base"`) kills floor/median/ceiling resolution
5. **No ecology tier layer** — NBA has no equivalent of MLB's ELITE/STRONG stamps
6. **Model signal weak** — nbaModelSignals.js is 82–92% market-following; can't detect role spikes
7. **Eruption environment absent** — no NBA analog to MLB HR candidate ecosystem
8. **Five overlapping builders** — philosophically incompatible; buildNbaSlipEngine.js is random, not intelligent

### NBA Evolution Roadmap (7 phases):

| Phase | Task | Model | Priority |
|---|---|---|---|
| NBA-1 | PRA volatility fix — Path A (snapshot-sourced field) | Sonnet | 🔴 Now |
| NBA-2 | Designate buildNbaAiSlips as canonical workstation path | Opus audit first | 🔴 Now |
| NBA-3 | Allow quality alt lines through workstation gate | Sonnet | 🟡 After NBA-2 |
| NBA-4 | Build NBA Ecology Tier Layer (ELITE/STRONG stamps) | Sonnet | 🟡 After NBA-3 |
| NBA-5 | Reduce realismScore weight 0.70 → 0.45; raise probability 0.15→0.25, edge 0.10→0.20 | Opus audit first | 🟡 After NBA-4 |
| NBA-6 | Add eruption environment detection (role-spike, blowout-risk, pace escalation) | Sonnet | 🟢 After NBA-5 |
| NBA-7 | Wire first basket to workstation (alt market accumulation) | Sonnet | 🟢 After NBA-6 |

### What must eventually die (from audit):
- `buildNbaSlipEngine.js` — random Math.random() picker, philosophically incompatible
- `buildNbaSlipComposer.js` — field naming mismatches, requires `bestBetsBoard` format no longer current
- `buildNbaDynamicSlipEngine.js` — parallel system with incompatible "lotto" semantics; absorb correlation logic into buildNbaAiSlips first

### What must never change (from audit):
- `pairwiseStackBoost()` correlation logic in DynamicSlipEngine (absorb into canonical path first)
- aiRange resolution architecture (floor/median/ceiling/lotto leg resolution)
- Lane separation (CORE_LANES vs COMBO_LANES vs special)
- `roleStatScoreBump` logic in nbaAiStatFamilyRank.js
- statStabilityWeight table
- SAFE archetype two-leg / elite-only constraint
- `maxSameGame` constraints
- MLB ecology (any NBA changes must not touch MLB path)

---

## SESSION W — Daily Intelligence Review Engine

See previous CURRENT_STATE for full Session W details. All Session W systems remain active.

---

## CURRENT ORCHESTRATION

Candidate diversification (`buildCandidateDiversity.js → diversifyCandidates`):
- `maxPerPlayer: 3` · `maxPerGame: 7 (MLB) / 12 (NBA)` · `maxPerStat: 10` · `maxPerStatSide: 6`

Featured side-balance (`buildFeaturedPlays.js → pickDiversified`):
- `maxSideFraction: 0.60` (anchors: 0.55)

Volatility classification (`buildPortfolioOptimizer.js → VOLATILITY_RULES`):
- `threes < 3.5 → balanced`, `threes >= 3.5 → lotto`, `PRA/combo → aggressive`, `odds >= 350 → lotto`

NBA snapshot candidate pipeline:
- Gates: core odds (-200..+200), no alternate/ladder keys, known stat family, mp≥0.35, edge≥0.03
- Top 150 by edge

---

## ACTIVE BOTTLENECKS

**NBA lotto pool seeds correctly (NBA-1 ✅)** — snapshotSourced PRA candidates now classify as "lotto" through the guard. Remaining gap: base-odds legs (dec ~5–9) combine to dec ~12–26, borderline for the [20, 1500] gate. Requires NBA-3 (alt line gate) + NBA-2 (canonical path) to fully populate lotto slips.

**First basket bucket empty.** `first_basket` family absent from base snapshot — alt markets only.

---

## KNOWN WEAKNESSES

1. **NBA lotto slips still odds-gated** — NBA-1 ✅ fixed classification (PRA now seeds as "lotto"). Remaining blocker: base odds dec ~5–9 per leg; 5-leg combo ~22–26 barely clears lotto gate [20, 1500]. NBA-3 (alt line gate) is the next lever; NBA-2 (canonical path) is prerequisite.
2. **NBA first basket bucket empty** — needs alt market accumulation
3. **NBA smartAggression limited** — only PRA gets `aggressive`
4. **NBA tracked_bets pool thin** — 2 bets today
5. **NBA SP4 (combo PA/PR/RA)** — resolveStatFamily returns null. Deferred.
6. **NBA SP1 (bestProps empty)** — hardcoded empty. Deferred.
7. **`personal_ledger.json` all 2,000 entries pending** — bets are importFromTrackedBets calls never settled
8. **tracked_best missing eventId/matchup** — tier boosts always fail; Priority 3
9. **Duplicate balanced slip issue (seenSignatures)** — deferred
10. **`timing_intelligence_state.json` at 729KB, unbounded growth** — no pruning
11. **Under-heavy raw NBA pool (~67% unders)** — source imbalance
12. **Under-heavy raw MLB pool (~83% unders)** — same
13. **Daily intelligence review calibration = 0** — bets are pending; activates after first results entry
14. **Intelligence review steam/book answers empty** — steam_summary_json placeholder; needs line shopping data wired
15. **NBA ecology — two-path disconnect** — workstation uses shared buildSlipAi.js (MLB-calibrated); nightly uses buildNbaSlipComposer (canonical-nightly, confirmed Session AB). The other 3 "NBA slip builders" are: buildNbaAiSlips (utility-only — function unused), buildNbaDynamicSlipEngine (DEAD orphan, but holds all correlation logic — must be absorbed not deleted), buildNbaSlipEngine (DEAD orphan). See NBA_CANONICAL_PATH_AUDIT_2026-05-09.md.
16. **NBA monoculture root cause confirmed** — realismScore×0.70 weight mathematically guarantees star dominance. Star finalWeight ≈1.62, backup with 3× edge ≈1.25. Gap is structural.
17. **NBA lotto starvation fully traced** — two failure paths: shared path (maxOdds 600 impossible at base), nightly path (aiRange requires alt lines killed by workstation gate). Fallback: copies aggressive.
18. **NBA intelligence health: 2.9/10** — 8 critical failures audited. Full roadmap NBA-1→NBA-7 in docs/NBA_ECOLOGY_AUDIT_2026-05-09.md.
19. **`tracker/betTracker.js` vs `buildPersonalLedger.js`** — two parallel bet tracking systems, no reconciliation (betTracker is legacy)

**RESOLVED SESSION AB:**
- ~~Canonical NBA slip path undesignated~~ — buildNbaSlipComposer canonical-nightly; buildSlipAi canonical-workstation; documented in NBA_CANONICAL_PATH_AUDIT_2026-05-09.md ✓
- ~~Session Z misdesignation of "5 overlapping NBA slip builders"~~ — true picture: 2 active (buildNbaSlipComposer + buildSlipAi) + 1 utility (buildNbaAiSlips) + 2 dead (buildNbaSlipEngine + buildNbaDynamicSlipEngine) ✓
- ~~aiRange consumption gap not surfaced~~ — confirmed: aiRange computed by buildNbaAiPicks, consumed by NEITHER active engine; absorbed only by orphans. Phase 2.I scope. ✓
- ~~Correlation logic ownership undocumented~~ — confirmed living only in orphan buildNbaDynamicSlipEngine; Phase 2.G absorption plan defined ✓

**RESOLVED SESSION AA:**
- ~~NBA lotto slips empty (classification layer)~~ — snapshotSourced guard preserves "lotto" stamps in both normalizeCandidate() instances ✓
- ~~PRA volRealism penalty~~ — lotto explicit slot 0.65 prevents scoring regression vs aggressive 0.66 ✓

**RESOLVED SESSION Z:**
- ~~NBA ecology audit not done~~ — full 20-section audit complete; health score 2.9/10; 7-phase roadmap defined ✓

**RESOLVED SESSION Y:**
- ~~`isOffensiveAttackStat` duplicated~~ — unified in normalizers.js ✓
- ~~Compactors inline in workstationRoutes.js~~ — extracted to buildWorkstationCompactors.js ✓
- ~~`__refreshInProgress` dual-mutex~~ — unified to module-level ✓
- ~~11,185 lines of dead inlined NBA code~~ — deleted ✓
- ~~4 empty stub directories~~ — deleted ✓
- ~~betting2.db orphan artifacts~~ — deleted ✓

---

## INFRASTRUCTURE STATE

| File | Status |
|---|---|
| `docs/WORKFLOW_RULES.md` | Committed |
| `docs/CURRENT_STATE.md` | **Synced to root this session (Session Z)** |
| `docs/NEXT_SESSION.md` | **Synced to root this session (Session Z)** |
| `docs/BOOTSTRAP_PROMPT.md` | Committed |
| `docs/ARCHITECTURE.md` | Needs update: line counts stale, http/ section changed |
| `docs/ARCHITECTURE_AUDIT_2026-05-09.md` | Created Session X — Phase 0/2 items now complete |
| `docs/NBA_ECOLOGY_AUDIT_2026-05-09.md` | **NEW (Session Z) — 20-section NBA intelligence audit; health 2.9/10; roadmap NBA-1→NBA-7** |
| `docs/NBA_CANONICAL_PATH_AUDIT_2026-05-09.md` | **NEW (Session AB) — 20-section NBA routing audit; health 4.6/10; canonical designations + 9-phase migration plan (2.A→2.I)** |
| `backend/pipeline/shared/normalizers.js` | **NEW (Session Y)** |
| `backend/pipeline/shared/buildWorkstationCompactors.js` | **NEW (Session Y)** |
| `backend/pipeline/shared/buildFeaturedPlays.js` | **Session AA: snapshotSourced lotto guard + volRealism lotto 0.65 slot. Session Y: isOffensiveAttackStat imported from normalizers** |
| `backend/pipeline/shared/buildSlipAi.js` | **Session AA: snapshotSourced lotto guard. Session Y: isOffensiveAttackStat imported from normalizers; inline block removed** |
| `backend/routes/workstationRoutes.js` | **Session Y: compactors imported from buildWorkstationCompactors; 103-line inline removed** |
| `backend/server.js` | **Session Y: /refresh-snapshot mutex unified to module-level** |
| `backend/storage/reviewSchema.js` | NEW (Session W) |
| `backend/storage/schema.js` | Session W: applyReviewSchema() wired |
| `backend/pipeline/review/` | NEW (Session W) — 6 modules |
| `backend/scripts/runDailyReview.js` | NEW (Session W) |
| `backend/pipeline/shared/buildNightlyOrchestrator.js` | Session W: Step 9 wired |
| `backend/storage/queries.js` | Session S: ledger upserts + transaction fix |
| `backend/pipeline/shared/buildPersonalLedger.js` | Session S: atomic saveLedger() + SQLite mirror |
| `backend/routes/workstationRoutes.js` | Session U: screenshotRoutes mounted |
| `backend/http/nbaIsolatedRoutes.js` | Session R Fix R1 |
| `backend/pipeline/mlb/buildMlbPropClusters.js` | Session T: HR scoring; Session V: team fields |
| `backend/pipeline/mlb/phase4Tracking.js` | Session V: leanBet/leanSlip team fields |
| `backend/storage/screenshotSchema.js` | NEW (Session U) |
| `backend/pipeline/screenshots/` | NEW (Session U) — 3 modules |
