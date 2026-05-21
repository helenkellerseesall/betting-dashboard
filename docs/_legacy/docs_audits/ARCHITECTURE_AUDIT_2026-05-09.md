# FULL REPOSITORY CONSTITUTION + ARCHITECTURE AUDIT
**Session X — Architectural Truth Discovery**
_Generated: 2026-05-09 | Based on: live codebase scan, all continuity docs, structural analysis_
_Scope: 21,024-line server.js · 160+ backend modules · 8 frontend sections · 4 SQLite schemas · 101 runtime tracking files_

---

## 1. REPO HEALTH SCORE

| Dimension | Score | Rationale |
|---|---|---|
| **Backend structure** | 5.5 / 10 | Monolith still dominant. Shared pipeline maturing but surrounded by legacy debris. |
| **Frontend structure** | 8.0 / 10 | Clean, well-scoped, calls only `/api/ws/*`. Minimal coupling to backend internals. |
| **Persistence integrity** | 5.0 / 10 | SQLite migration 40% done. Personal ledger has write mirror but read not cut over. Timing state unbounded. Legacy `tracked_props_*` coexisting with `mlb_tracked_bets_*`. |
| **Intelligence pipeline** | 7.5 / 10 | MLB shared pipeline is well-audited. NBA unaudited. Review engine (Session W) is strong. |
| **Dead code / debris** | 4.0 / 10 | 11,185 lines of confirmed-dead inlined NBA files. 4 empty stub directories. 1+ orphaned modules. Docs version split. |
| **Operational safety** | 6.5 / 10 | Graceful degradation on most paths. `__refreshInProgress` dual-mutex bug is a latent operational risk. |
| **Cross-sport abstraction** | 6.0 / 10 | MLB well-modeled. NBA has 5 overlapping slip builders, no ecology audit. Shared adapters are correct but shallow. |
| **Long-term scalability** | 6.0 / 10 | Architecture can absorb NFL/NHL if shared pipeline pattern holds. Server.js monolith is the ceiling. |

**Overall Repo Health: 6.1 / 10**

The system works operationally. The intelligence pipeline is legitimately sophisticated. But the repo has meaningful structural debt that will compound if not addressed in phases. This is not a crisis — it is an evolutionary inflection point.

---

## 2. TOP ARCHITECTURAL RISKS

### RISK 1 — The `__refreshInProgress` Dual-Mutex Bug ⚠️ LATENT CRITICAL

`server.js` has TWO separate `__refreshInProgress` variables that do not share state:

```javascript
// LINE 10091 — module-level variable
let __refreshInProgress = false

// LINE 19052 — separate local variable reading from global namespace
let __refreshInProgress = global.__refreshInProgress || false
global.__refreshInProgress = true   // line 19065
global.__refreshInProgress = false  // line 19144
```

These are in completely different scopes. The MLB refresh path reads/writes the **module-level** variable at lines 10127/10130. The NBA refresh path reads/writes **`global.__refreshInProgress`** — a completely different object. This means:

- An MLB refresh does NOT block a concurrent NBA refresh
- An NBA refresh does NOT block a concurrent MLB refresh  
- Both can run simultaneously, both writing to `oddsSnapshot` globals
- If either crashes mid-execution, only its own flag gets stuck
- The NBA path's mutex is set on `global`, not the module closure — if the module reloads, the guard resets

**Failure mode**: Concurrent MLB + NBA refreshes corrupt shared global state. Currently survivable because refreshes are manually triggered and slow. Under load or scheduled triggering, this becomes a race condition.

**Fix**: Unify both paths to read/write the same mutex. Either both use the module-level variable or both use `global`. Module-level is safer.

---

### RISK 2 — Dead Code Mass (11,185 Lines) ⚠️ HIGH CONFUSION RISK

`http/nbaBestAvailable.inlined.js` (6,867 lines) and `http/nbaRefreshSnapshot.inlined.js` (4,318 lines) are explicitly excluded by the file that replaced them. `nbaIsolatedRoutes.js` line 1 says: _"no `new Function`, no eval, no compiled `nbaRefreshSnapshot.inlined.js`"_.

These files exist on disk, are not imported anywhere, consume mental namespace, and represent the old NBA pipeline generation approach. Any future developer reading the `http/` directory will spend real time understanding these files before realizing they're dead.

**Risk**: Future AI session or developer accidentally modifies or re-imports one of these files believing it to be active. At 11K lines, auditing it to confirm dead status costs significant time each session.

---

### RISK 3 — NBA Slip Module Explosion ⚠️ HIGH SCORING BIAS RISK

Five overlapping NBA slip/pick construction modules totaling ~3,500+ lines:

| Module | Lines | Importers | Status |
|---|---|---|---|
| `buildNbaAiSlips.js` | 574 | 3 | Active — supplies `collectFullPool` to others |
| `buildNbaAiPicks.js` | 1,082 | 3 | Active — called by buildNbaOpportunityBoard |
| `buildNbaSlipComposer.js` | 480 | 1 (buildNbaOpportunityBoard) | Active |
| `buildNbaDynamicSlipEngine.js` | 843 | 1 (buildNbaOpportunityBoard) | Parallel path — unclear if active |
| `buildNbaSlipEngine.js` | 601 | 1 (unknown) | Unknown canonical status |

The canonical path appears to be: `buildNbaOpportunityBoard → buildNbaAiPicks + buildNbaSlipComposer → both call buildNbaAiSlips.collectFullPool`. But `buildNbaDynamicSlipEngine` also calls `buildNbaAiSlips` independently. The result: unknown scoring heuristics running in parallel with unknown reconciliation logic.

**Risk**: Until this is audited, NBA slip quality is structurally unverified. The ecology bugs MLB spent Sessions T–V fixing could exist identically in the NBA path, unknown.

---

### RISK 4 — Docs Version Split ⚠️ SESSION CONTINUITY RISK

Root-level docs (`/CURRENT_STATE.md`, `/NEXT_SESSION.md`) and `docs/` versions have diverged:

- Root `CURRENT_STATE.md` = Session W (current)
- `docs/CURRENT_STATE.md` = Session R (4 sessions behind)
- Root `NEXT_SESSION.md` = Session W  
- `docs/NEXT_SESSION.md` = Session R (4 sessions behind)

`ARCHITECTURE.md` says "Always update `docs/` first, then sync root." This has been reversed — root has been updated but `docs/` has fallen behind. Any session reading from `docs/` gets a stale state picture.

**Risk**: Future AI session that reads `docs/` first (as specified in the protocol) will have a 4-session-old worldview. Could re-implement already-fixed bugs or miss current priorities.

---

### RISK 5 — Persistence Layer Partially Migrated / Partially Frozen ⚠️ MEDIUM

The SQLite migration sequence is:
- ✅ Phase 1 schema — done
- ✅ Personal ledger write mirror — done (Session S)
- ❌ Personal ledger **read** path NOT cut over (Phase S+1 pending)
- ❌ `timing_intelligence_state.json` — 729KB, frozen at May 6, no pruning, growing unbounded
- ❌ `post_game_review_state_mlb.json` — 375KB, frozen May 6
- ❌ `tracked_bets_*.json` → rolling SQLite table — not done
- ❌ `tracked_props_*.json` legacy files coexisting with `mlb_tracked_bets_*` new format

The system is in a dual-write limbo: personal ledger writes to both JSON and SQLite but reads only JSON. Once the JSON read path is cut, the dual-write setup becomes a time bomb if divergence occurs.

---

## 3. LONG-TERM SCALING RISKS

### NFL/NHL Expansion Risk

The current design assumes two sports with similar pipeline shapes. Adding NFL/NHL exposes:

1. **`pipeline/sports/sportConfig.js`** and `bestAvailableSportDispatch.js` exist (correct) but `workstationRoutes.js` still has sport-conditional logic inline (NBA-specific `enrichNbaRowStatLayerInputs`, NBA-specific `nbaRowModelProbability`/`nbaRowEdge` imports at the top). This is leaking NBA specialization into the supposedly sport-agnostic workstation layer.

2. **The nightly script pattern** (`runMlbNight.js`, `runNbaNight.js`) duplicates the entire orchestration per sport. A third sport means a third 1,300-line nightly runner unless `buildNightlyOrchestrator.js` becomes the canonical entry point for all sports.

3. **The `pipeline/shared/adapters/` pattern** (mlbAdapter.js, nbaAdapter.js) is correct long-term. But it's only used by `buildPostGameReview`. The rest of the shared pipeline has no adapter pattern — it passes raw bet objects that have sport-specific field names. This will create silent field-miss bugs for a new sport.

4. **SQLite schema has no sport sharding**. `tracked_props` has a `sport` column (correct) but `ecology_snapshots` and review tables will accumulate mixed-sport rows with no partitioning. Analytics queries will need explicit sport filtering everywhere.

### 10,000-User Social Growth Risk

If this system grows to serve multiple bettors (not just the operator):

1. **Personal ledger is a single flat JSON** with 2,000 entries. It has no concept of user identity. The SQLite mirror has a `personal_ledger` table with no `user_id` column. It is architecturally single-tenant.

2. **Screenshot intelligence** (`screenshotSchema.js`) has a `bettor_profiles` table — this is the only multi-user-aware table in the system. Good foundation but isolated.

3. **All runtime tracking files are single-process writes** with no locking. Multiple concurrent users writing to the same date files would corrupt them silently.

4. **The workstation is single-operator UX** — no authentication, no session management, single API context. Correct for current use. Would need fundamental restructuring for multi-user.

### Historical Intelligence Depth Risk

The daily review engine (Session W) is powerful, but it only activates when results are entered. Currently all 2,000 personal_ledger entries are "pending" — the calibration system has zero training data. Without a results-entry workflow, the intelligence layer becomes archaeology rather than learning.

---

## 4. SERVER.JS SURVIVAL DNA FINDINGS

`backend/server.js` is 21,024 lines written during a survival-development era. These patterns still persist:

### Still-Active Survival DNA

**1. Module-Level Globals as Shared State (lines 152–230, 10,091–10,477)**
The entire pipeline runs through 12+ mutable module-level variables: `oddsSnapshot`, `mlbSnapshot`, `mlbPicks`, `mlbSlips`, `mlbOomphSlips`, `mlbSpikePlayers`, `mlbCorrelationClusters`, `mlbUpsideClusters`, `mlbOpeningOddsByLegKey`, `playerIdCache`, `playerStatsCache`, `playerLookupMissCache`. Every function implicitly closes over these. This is why extraction is hard — you can't move a function without threading all its state as parameters.

**2. Config Constants Defined at Runtime, Not Module Load (lines 10,473–10,477)**
```javascript
const SNAPSHOT_COOLDOWN_MS = 60 * 1000       // line 10,473
const ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH = ... // line 10,474
const NBA_REPLAY_SNAPSHOT_PATH = ...          // line 10,477
```
These constants are defined 10,000 lines into the file, mixed in with runtime code. This is pure survival-era — configuration should live in `config/` and be imported at the top.

**3. Lazy Requires Inside Route Handlers (line 10,295)**
```javascript
const gradeMlbHrSlips = require('./pipeline/mlb/gradeMlbHrSlips');
const fetchMlbHrResults = require('./pipeline/mlb/fetchMlbHrResults');
```
These are require calls mid-function inside a route handler. Node.js caches them after first call, so this is harmless but signals "I added this quickly and couldn't find the right import location." It is the fingerprint of emergency patching.

**4. `SLIP_SEED_PROP_TYPES` Defined at Line 734**
Prop type configuration buried deep in the file, not in `config/`. Anyone wanting to understand what stats the NBA slip seeder uses has to know to look at line 734 in a 21K-line file.

**5. 41 Routes, Most Undocumented**
Routes registered across lines 10,095 and 17,815–20,886 with no consistent structure. Some routes are 3 lines, some delegate to isolated handlers, some contain 200 lines of inline logic. `/props/*`, `/picks/today`, `/parlays/*` are legacy endpoints with unknown active consumer status.

**6. The `buildLiveDualBestAvailablePayload` Mega-Function (line 6,169, ~433 lines)**
This is the deepest survival-era DNA still operational. It closes over every global, performs MLB and NBA pipeline assembly inline, and has no testable surface. Changing any scoring heuristic anywhere in the system eventually flows through this function in ways that are difficult to predict.

---

## 5. DEAD CODE / STALE SYSTEMS

### Confirmed Dead — Delete Immediately

| File | Lines | Why Dead | Risk to Delete |
|---|---|---|---|
| `http/nbaBestAvailable.inlined.js` | 6,867 | Explicitly excluded by nbaIsolatedRoutes.js. 0 importers. Old pipeline generation approach. | Zero — nothing imports it |
| `http/nbaRefreshSnapshot.inlined.js` | 4,318 | Same. nbaIsolatedRoutes.js says directly it does NOT use this. | Zero — nothing imports it |
| `pipeline/enrich/index.js` | 0 | Empty stub. 0 importers. | Zero — empty file |
| `pipeline/normalize/index.js` | 0 | Empty stub. 0 importers. | Zero — empty file |
| `pipeline/validation/rows.js` | 0 | Empty stub. 0 importers. | Zero — empty file |
| `pipeline/snapshot/buildSnapshot.js` | 0 | Empty stub. 0 importers. | Zero — empty file |
| `storage/betting2.db` | — | Orphan test database. Empty. 512-byte stale journal. | Zero — test artifact |
| `storage/test.txt` | 0 | Empty test artifact. | Zero |
| `backend/utils/normalizeName.js` | — | Need to verify — only used by buildMlbStatcastPower which has 0 active importers |

### Confirmed Dead — Delete After Operator Verification

| File | Lines | Status | Action |
|---|---|---|---|
| `pipeline/mlb/buildMlbStatcastPower.js` | 71 | Fetches from Baseball Savant. 0 importers. No callers. Dead data fetcher. | Verify not called via dynamic require, then delete |
| `offline/evaluateEmittedPicks.js` | 352 | CLI tool for evaluating emitted picks vs outcomes. No integration with current pipeline. Predates the review engine (Session W). | Evaluate if review engine supersedes it — likely yes |
| `runtime/tracking/tracked_props_*.json` | — | Legacy tracking format (14 files, April 18–28). `phase4Tracking.js` still seeds from these as one-time carryover but new bets use `mlb_tracked_bets_*`. | Move to `archive/` after confirming no active queries |
| `runtime/tracking/*.tmp` (1 file) | — | `mlb_tracking_summary_2026-05-05.json.tmp.98415` — partial-write orphan | Delete immediately |
| `scripts/nbaPipelineSelfCheck.js` + `nbaPipelineHardAudit.js` | — | Audit scripts. Active for developer use but not wired into any workflow. | Keep — document as manual-use tools |

### Status Unknown — Audit Required

| File | Lines | Concern |
|---|---|---|
| `pipeline/mlb/buildMlbAutoTickets.js` | 783 | 1 importer. What is it generating and who consumes output? |
| `pipeline/nba/buildNbaBankrollPlan.js` | 480 | 1 importer (`buildNbaOpportunityBoard`). Is this in the live path? |
| `pipeline/nba/buildNbaBestBetsBoard.js` | 440 | 1 importer. Relationship to shared `buildFeaturedPlays`? |
| `pipeline/nba/nbaGameContextWeight.js` | — | 1 importer. Is this applied in the live scoring path? |
| `pipeline/nba/nbaStatIntelligence.js` | — | 1 importer. What does it provide that `nbaModelSignals` doesn't? |
| `tracker/betTracker.js` + `betMetrics.js` | 138 | Used by `/api/bets` and `/api/bets/metrics` in server.js. Is this a parallel bet tracking system to personal_ledger? If so, which is authoritative? |

---

## 6. DUPLICATED LOGIC AREAS

### Duplication 1 — `isOffensiveAttackStat` (ACTIVE SILENT DIVERGENCE RISK)

`buildFeaturedPlays.js` line 61: Defines `isOffensiveAttackStat(fam)` as a named, exported-style function.

`buildSlipAi.js` line 263: Defines `offensiveAttackTextureBonus(leg, timingMap)` which reimplements the same offensive stat family check inline, without calling the shared function.

If the definition of "offensive attack stat" ever changes in one file (e.g., a new stat family is added), the other will silently diverge. Featured plays scoring and AI slip scoring will produce different results for the same candidate. This is the kind of bug that manifests as "the featured board and the AI slips have different takes on the same play" with no obvious root cause.

**Fix**: Extract `isOffensiveAttackStat()` to `pipeline/shared/normalizers.js`. Import in both. ~15 lines.

### Duplication 2 — Compactors Inline in `workstationRoutes.js`

`compactLineShopping` (lines 618+), `compactTiming` (lines 690+), `compactPortfolio` (lines 707+) are defined inside the route file rather than being imported from a shared module. These are called on every `/api/ws/state` request. If line shopping or portfolio shape changes, these compactors are in a non-obvious location.

**Fix**: Extract to `pipeline/shared/buildWorkstationCompactors.js`. ~103 lines.

### Duplication 3 — Two MLB Cluster Systems

`buildMlbClusters.js` (72 lines): Phase 3 approach — simple stat-bucket sorting (hits/hr/tb/rbi), feeds `buildMlbBestProps`. Still called directly by server.js line 3565 and via `buildMlbBestProps`.

`buildMlbPropClusters.js` (1,146 lines): Current canonical approach — full ecology scoring, HR tier assignment, Session T fixes, multi-dimensional ranking. Used by the workstation path.

These serve different purposes (basic display clustering vs. full ecology-aware scoring), but the similar names create confusion about which is "the" clustering system. `buildMlbClusters` feeds a server.js-era board path. `buildMlbPropClusters` feeds the modern workstation path.

**Long-term**: When server.js Phase B/C extractions happen, evaluate whether `buildMlbClusters` can be retired in favor of a slice of `buildMlbPropClusters`.

### Duplication 4 — `normalizePlayerName` Lives in Two Places

`server.js` line 11,379+: Pure math/string utilities (`avg`, `stddev`, `normalizePlayerName`) defined inside the monolith.

`backend/utils/normalizeName.js`: A separate utility module.

Whether these are identical or have diverged is unknown. The ARCHITECTURE.md flags server.js lines 11,379–11,430 as Phase A extraction target. The `utils/normalizeName.js` may already be the canonical version, or may be an older/different implementation.

### Duplication 5 — Two Parallel Bet Tracking Systems

`tracker/betTracker.js` + `tracker/betMetrics.js`: Old system. Reads/writes an unknown JSON file. Exposed via `/api/bets` and `/api/bets/metrics` routes in server.js.

`pipeline/shared/buildPersonalLedger.js` (1,253 lines): Current canonical system. Reads/writes `personal_ledger.json` + SQLite mirror. Exposed via `/api/ws/ledger`.

These are parallel systems with no reconciliation. If anyone has been logging bets via `/api/bets`, that data is not in the personal ledger. If bets were logged via the ledger, they're not in the old betTracker. The systems serve the same conceptual purpose.

---

## 7. CONFLICTING ECOLOGY SYSTEMS

### Conflict 1 — NBA Has No Ecology Filter At All

The MLB workstation path runs candidates through `buildMlbPropClusters` ecology scoring (Session T fixes: HR tiering, suppression calibration, textureBoost corrections). This is the layer that converts raw model output into ELITE/STRONG/PLAYABLE/VALUE/BASE tiers.

The NBA workstation path (`workstationRoutes.js → /api/ws/state?sport=nba`) reads `nba_tracked_bets_*` and passes them through `diversifyCandidates()` then directly into `buildFeaturedPlays()`. It does NOT run through `buildNbaOpportunityBoard`'s scoring. It uses `nbaRowModelProbability` and `nbaRowEdge` from `nbaModelSignals.js` as the signal source.

This means NBA candidates are **not** ecology-qualified the same way MLB candidates are. The `tier` field on NBA bets comes from whatever nbaIsolatedRoutes stamped during snapshot scoring — not from a dedicated NBA ecology pass equivalent to `buildMlbPropClusters`.

**Implication**: The trust surface (anchors, tonight's best, etc.) for NBA is less guarded than for MLB. NBA slip quality is systemically unverified.

### Conflict 2 — Volatility Rules Have a `threes` Mismatch

`buildPortfolioOptimizer.js → VOLATILITY_RULES`:
```
threes < 3.5 → balanced
threes >= 3.5 → lotto
```

`buildSlipAi.js` slip tier gates:
```
lotto tier: allowedVolatility = any, minModelProb = 0.40, maxOdds = 600
```

The `threes` stat routes into `lotto` based purely on the line value, not on the actual odds. A `threes 3.5 over at -130` gets classified as `lotto` volatility, then gets assigned to the lotto tier... but at -130 odds it cannot qualify for the lotto tier's `maxOdds = 600` gate. This creates a case where a candidate has `lotto` volatility but no tier will accept it because the odds aren't long enough for lotto and the volatility is too high for safe/balanced/aggressive.

**Implication**: Some valid threes props may be silently dropped from all slip tiers.

### Conflict 3 — `PRA combo → aggressive` Volatility Override

All PRA combos are classified as `aggressive` by `VOLATILITY_RULES` regardless of their actual odds. This is what's causing NBA lotto slips to be empty (known bottleneck). But it also means a PRA at +450 (legitimately high variance) still only enters the `aggressive` tier, not `lotto`. The volatility classification is disconnected from actual market price.

The fix (Path A, NEXT_SESSION.md) is to use the snapshot-sourced `volatility` field directly when `bet.snapshotSourced === true`. This is the correct approach — trust the model's own volatility signal over a static rule for snapshot-sourced data.

### Conflict 4 — Two Featured Play Builders in the Codebase

`pipeline/shared/buildFeaturedPlays.js` (841 lines): CANONICAL — modern workstation path, ecology-qualified, trust-surface builder.

`pipeline/boards/buildSpecialtyOutputs.js` (28,062 bytes): Server.js-era specialty output builder that generates its own "featured"-style outputs (first basket board, specialty plays, curated layer 2 buckets). This system is active in server.js but its outputs are NOT consumed by the workstation frontend — they go into the old `/api/best-available` response shape.

The two systems have different selection logic, different ecology filters, and produce different output shapes. They coexist without cross-referencing. The frontend only ever sees the canonical `buildFeaturedPlays` output.

---

## 8. PERSISTENCE RISKS

### Risk 1 — `timing_intelligence_state.json` Is Frozen and Unbounded

At 729KB (May 6) with no pruning. Has not grown since May 6 — this could mean it stopped being written (possible if nightly runs after May 6 didn't trigger timing state updates) or it grew but hasn't been updated in the test environment. Either way, 729KB is already past reasonable size for a flat JSON state file that gets fully deserialized on every timing request.

**Failure mode at scale**: When this hits 2–3MB, every `/api/ws/timing` request will parse multi-megabyte JSON synchronously in the request path. Express is single-threaded. This creates a latency spike on all workstation routes.

### Risk 2 — `personal_ledger.json` Read Path Not Cut Over

The write mirror to SQLite is done (Session S). But `buildPersonalLedger.js` still reads from JSON. If any writes go to SQLite only (e.g., a bug in the dual-write path), the JSON read will silently return stale data. The two stores can diverge with no detection mechanism.

The safest path: add an integrity check on startup that compares ledger row counts in JSON vs SQLite and logs divergence.

### Risk 3 — `tracked_props_*.json` Legacy Format Coexisting with `mlb_tracked_bets_*`

Fourteen files in the legacy format (April 18–28) still live in `runtime/tracking/`. `phase4Tracking.js` has backward compat seeding code. The SQLite `schema.js` comment says these map to `tracked_props` table. But the `importHistoricalData.js` maps `mlb_tracked_bets_*` (not `tracked_props_*`) to the table.

**Implication**: The April historical data may NOT be in SQLite. Any calibration or historical analytics query that needs pre-May-5 data will silently miss 2.5 weeks of results.

### Risk 4 — SQLite Schema Chaining is Growing Fragile

There are now 4 schema files that chain into each other:
```
applySchema() → calls applyScreenshotSchema() + applyReviewSchema()
```

`intelligenceSchema.js` is applied separately (not wired into applySchema). This means schema application is no longer atomic — a startup that calls `applySchema()` applies 3 of the 4 schema layers. `intelligenceSchema` requires a separate explicit call. As more schema files are added, this chain becomes hard to trace and easy to break.

**Fix**: Create a single `applyAllSchemas(db)` function that calls all schema layers in dependency order. One entry point. No chains.

### Risk 5 — No Tracking File Pruning for Pre-Phase4 Data

Daily rolling files (`mlb_tracked_bets_*`, `nba_tracked_bets_*`, etc.) have a pruning mechanism in `phase4Tracking.js` (line 1,046: async fire-and-forget pruning). But `mlb_picks_*.json` files have no pruning — they range from 57KB to 1.5MB per day. With 15+ daily files already present and no cleanup, this directory accumulates indefinitely.

---

## 9. CROSS-SPORT DESIGN RISKS

### The NBA/MLB Asymmetry Problem

MLB has a clearly audited, well-understood pipeline:
```
buildMlbBootstrapSnapshot → buildMlbInspectionBoard → buildMlbOpportunityBoard
→ buildMlbInsightBoard → buildMlbPropClusters [ecology scoring]
→ phase4Tracking → tracked_bets_*.json
→ workstationRoutes reads files → diversifyCandidates → buildFeaturedPlays
```

NBA has a fractured pipeline with multiple active paths:
```
fetchNbaOddsSnapshot → buildNbaBoardSlicesFromSnapshot
→ buildNbaOpportunityBoard [via buildNbaAiPicks + buildNbaSlipComposer + buildNbaDynamicSlipEngine(?)]
→ nbaIsolatedRoutes → nba_tracked_bets_*.json (?)
→ workstationRoutes reads files → but also calls nbaRowModelProbability live
```

The NBA path has LIVE scoring in workstationRoutes (calling `nbaRowModelProbability` and `nbaRowEdge` on every state request) while the MLB path reads pre-scored data from files. This is an asymmetric execution model that means:

- NBA scores are computed on every workstation request (runtime cost)
- MLB scores are computed once during nightly run (stored)
- A slow NBA scoring function would directly impact workstation response time
- MLB scoring bugs affect only the nightly run; NBA scoring bugs affect live requests

### Sport-Agnostic Abstractions That Aren't

`workstationRoutes.js` imports at the top:
```javascript
const { nbaRowModelProbability, nbaRowEdge } = require("../pipeline/nba/nbaModelSignals")
const { enrichNbaRowStatLayerInputs } = require("../pipeline/nba/nbaEventTeamResolve")
```

These are NBA-specific imports in a supposedly sport-agnostic route file. When MLB requests come in, these imports are loaded but not used. When a new sport is added, the route file will need to grow new sport-specific imports rather than dispatching through a sport adapter.

The correct design: sport-specific row scoring should be resolved via `pipeline/sports/sportConfig.js` dispatch, not imported directly.

### The `buildSlateEvents` / `buildMlbSlateEvents` Split

`pipeline/schedule/buildSlateEvents.js` (5 importers — sport-agnostic): General slate event builder.
`pipeline/schedule/buildMlbSlateEvents.js` (2 importers): MLB-specific variant.

Two files serving what should be one parameterized function. Long-term this pattern (sport-agnostic + sport-specific variant) should be: one function with a sport parameter dispatched through sportConfig.

---

## 10. FRONTEND / BACKEND BOUNDARY ISSUES

### Strength: The `/api/ws/*` Contract Is Clean

The frontend (`api.ts`) calls exactly 9 endpoints, all under `/api/ws/`. It never calls legacy server.js routes directly. The types in `types.ts` define the contract. This is the right design and should be preserved absolutely.

### Issue 1 — `FirstBasketView.tsx` Is Permanently Disconnected

`sections/FirstBasketView.tsx` exists as a full section in the workstation. It calls `api.firstBasket()`. But `workstationRoutes.js` serves `first-basket` data that has `supported: false` for NBA and no data source for MLB first-basket markets.

The `pipeline/nba/buildNbaFirstBasketEngine.js` and `buildNbaFirstBasketIntelligence.js` exist but their output is not wired into the workstation response. The frontend section is permanently dark. This is a UX dead-end that misleads the operator.

**Fix options**: Remove the section from navigation until data is wired, OR show an explicit "Not yet available for this date" state rather than empty content.

### Issue 2 — `IntelligenceReviewView` Is Missing

The daily review engine (Session W) generates rich, actionable intelligence: grades A-F, major findings, HR eruption misses, suppressed winners, process archetypes. None of this is surfaced in the frontend. The operator has to run a CLI command to see review results.

This is the most asymmetric gap in the system: the most sophisticated new intelligence layer (Session W) is invisible to the UI.

### Issue 3 — `HeroPickCard.tsx` and `SpotlightCard.tsx` Exist But Are Not in ARCHITECTURE.md

Two frontend components (`HeroPickCard.tsx`, `SpotlightCard.tsx`) exist in `components/` but are not documented in ARCHITECTURE.md. Whether they are used, where they are used, and whether they are connected to real data paths is unclear.

### Issue 4 — No Error Boundary Pattern in Frontend

The frontend makes 9+ API calls. There is no documented error boundary strategy. If `/api/ws/state` fails (e.g., tracking file missing for today's date), the workstation silently shows stale data or empty state with no visible indication of the failure mode. For an operator making real-money decisions, silent data failure is operationally dangerous.

---

## 11. NIGHTLY WORKFLOW RISKS

### Risk 1 — Nightly Scripts Hit Server.js Over HTTP

Both `runMlbNight.js` and `runNbaNight.js` make HTTP requests to `localhost:4000` to trigger pipeline execution:
```javascript
await fetch("http://localhost:4000/refresh-snapshot?force=1")
await fetch("http://localhost:4000/api/best-available?sport=baseball_mlb")
```

This means:
- TERM 1 (server.js) must be running for nightly scripts to work
- If server.js crashes mid-nightly-run, the script gets a connection refused error
- The nightly run has no retry logic — it fails fast
- Network-level errors (ECONNREFUSED, timeout) are treated the same as data errors

The risk is operational fragility on a time-sensitive workflow. A 10-minute server.js crash during a game-day nightly window means no tracking data for that day.

### Risk 2 — `buildNightlyOrchestrator.js` Is Not the Canonical Entry Point for Scripts

`runMlbNight.js` (556 lines) and `runNbaNight.js` (1,327 lines) both have significant inline orchestration logic OUTSIDE of `buildNightlyOrchestrator.js`. The nightly orchestrator coordinates post-game steps (Steps 1–9), but the nightly scripts handle the pre-game pipeline (snapshot refresh, candidate generation, tracking file writes) independently.

This means there are two orchestration contexts that must stay in sync manually. Adding a new nightly step (as was done in Session W for Step 9) requires touching the orchestrator AND potentially both nightly scripts.

### Risk 3 — No Idempotency Guarantee on Nightly Runs

If `runMlbNight.js` is run twice on the same date (e.g., operator error, or re-run after a fix), it writes new tracking files that overwrite the existing ones. This is fine for `mlb_tracked_bets_*` (they're rebuilt from scratch). But the personal ledger's `importFromTrackedBets` path in `buildPersonalLedger.js` may double-import if run twice against the same date.

---

## 12. AI SLIP SYSTEM RISKS

### Risk 1 — Lotto Tier Is Structurally Empty for NBA (Known)

PRA at base odds → decimal odds ~5–9, below lotto minimum [20, 1500]. `classifyVolatility` maps PRA → `aggressive` regardless of odds. There is no path for a low-odds PRA prop to become a lotto leg even if the model says it should be high-variance.

Path A (NEXT_SESSION.md) is the correct fix: use snapshot-sourced `volatility` field directly for snapshot-originated bets.

### Risk 2 — Lotto Tier Is Structurally Empty for MLB Too (Undiagnosed)

The known issue focuses on NBA. But `VOLATILITY_RULES` maps HR/homerun/totalbases/rbi/saves to `aggressive`, NOT `lotto`. A HR prop at +350 or higher can become lotto (there's an `odds >= 350 → lotto` override). But many HR props at reasonable odds (e.g., +200) are classified `aggressive` only.

This means the MLB lotto tier is also likely thin. The fix should be cross-sport: lotto tier should be driven by actual market odds, not just the `aggressive + long odds` combination.

### Risk 3 — `seenSignatures` Deduplication for Balanced Slips (Known Deferred)

Duplicate balanced slips can appear due to collision in signature generation. Deferred since Session N. This is cosmetic but creates a degraded operator experience when reviewing the AI slip catalog.

### Risk 4 — AI Slip Construction Calls `offensiveAttackTextureBonus` For Aggressive/Lotto Only

```javascript
sl.composite + ((tier === "aggressive" || tier === "lotto") ? offensiveAttackTextureBonus(...) : 0)
```

Offensive attack texture is only applied at aggressive and lotto tiers. A safe or balanced leg with HR over doesn't get the texture boost even though an offensive environment is just as relevant at those tiers. This may be intentional conservatism, but if it's not, it's silently deprioritizing offensive overs in the safest tiers.

---

## 13. VOLATILITY / AGGRESSION CONFLICTS

### The Core Conflict: Static Rules vs Model Signal

The entire volatility system (`VOLATILITY_RULES` in `buildPortfolioOptimizer.js`) is a static lookup table: stat family → volatility category. This table was well-calibrated for MLB (Sessions T–V) but represents a philosophical tension:

**The system should trust its own model signals, not a static table.**

When `buildNbaPlayerOutcomePredictions.js` calculates a modelProb and an edge, it has better information about the expected variance of that specific prop than any static rule about what stat family it belongs to. The snapshot sometimes carries a `volatility` field directly from the prediction engine. The NEXT_SESSION.md Path A fix acknowledges this — use the snapshot volatility field for snapshot-sourced bets.

**Long-term constitutional position**: `VOLATILITY_RULES` should be a fallback/default for non-snapshot-sourced bets. For any bet where the model's own volatility signal is available, that signal should take precedence. This is a philosophical evolution, not just a bug fix.

### The `outs` Stat Reclassification

ARCHITECTURE.md notes: `outs` fixed from `safe` to `balanced` (2026-05-07). This shows the VOLATILITY_RULES table needs periodic recalibration as new markets appear. There is no mechanism to detect when a static rule is producing incorrect tier assignments — it requires human discovery. The daily review engine (Session W) now generates the data needed to detect this automatically (tier hit rates, VRS by tier), but the feedback loop back to VOLATILITY_RULES is manual.

**Constitutional recommendation**: Add a quarterly VOLATILITY_RULES review step to the workflow, driven by `buildVolatilityReview.js` findings.

---

## 14. OFFENSIVE SUPPRESSION FINDINGS

### What Is Working Correctly

Session T's five fixes to `buildMlbPropClusters.js` resolved the primary HR suppression bug: HR overs were stacked with suppression penalties that drove all HR candidates to PLAYABLE. The fixes introduced HR-appropriate scoring that allows STRONG/ELITE HR tiers to surface.

The `isOffensiveAttackStat()` in `buildFeaturedPlays.js` and the texture bonus system in `buildSlipAi.js` both apply positive adjustments for offensive attack stats on the over side, which is correct directionally.

### Structural Weakness: Suppression Is Applied at Multiple Layers Without Coordination

Offensive suppression is applied in at least 3 places:
1. `buildMlbPropClusters.js` — tier assignment based on ecology signals
2. `buildFeaturedPlays.js` — `isOffensiveAttackStat` texture boost 
3. `buildSlipAi.js` — `offensiveAttackTextureBonus` (parallel implementation)

These three layers have no shared state and no explicit coordination. A prop can be mildly suppressed at tier assignment, then partially recovered by textureBoost, then further boosted by the slip builder — or the sequence could go the other way. The net effect on a specific candidate is hard to trace.

**Constitutional recommendation**: Offensive suppression/amplification adjustments should flow through a single normalization pass before any tier assignment. The tier should reflect the final adjusted score, not be partially post-corrected by downstream boosts.

### The HR Eruption Miss Detection (Session W) Is the Right Design

`buildEcologyGrader.js` detecting `hrEruptionMiss` (30 candidates / 0 slips / multiple hits → MAJOR FINDING) is exactly the right long-term feedback loop. This surfaces when the suppression system is producing false negatives — real HR games that the model had candidates for but didn't surface in slips. **This is the constitutional mechanism for catching suppression overcorrection.**

The feedback loop from `hrEruptionMiss` findings back to `buildMlbPropClusters.js` threshold adjustments is currently manual. Long-term, this should be semi-automated: if `hrEruptionMiss` triggers on 3+ consecutive dates, a threshold review is automatically queued.

---

## 15. MODULE OWNERSHIP RECOMMENDATIONS

### Canonical — Protect These, Never Duplicate

| Domain | Canonical Owner | Status |
|---|---|---|
| Featured plays + trust surfaces | `pipeline/shared/buildFeaturedPlays.js` | ✅ Clean |
| AI slip construction | `pipeline/shared/buildSlipAi.js` | ✅ Clean — pending `isOffensiveAttackStat` extraction |
| Portfolio + volatility | `pipeline/shared/buildPortfolioOptimizer.js` | ✅ Clean — needs PRA/snapshot volatility fix |
| Candidate diversification | `pipeline/shared/buildCandidateDiversity.js` | ✅ Clean |
| Line shopping | `pipeline/shared/buildLineShoppingIntelligence.js` | ✅ Clean |
| Market timing | `pipeline/shared/buildMarketTimingIntelligence.js` | ⚠️ Growing unbounded — needs pruning |
| Personal ledger | `pipeline/shared/buildPersonalLedger.js` | ⚠️ Write mirror done, read cutover pending |
| CLV computation | `pipeline/shared/buildClv.js` | ✅ Clean |
| Post-game review | `pipeline/shared/buildPostGameReview.js` | ✅ Clean |
| Daily intelligence review | `pipeline/review/` (6 modules) | ✅ Clean — new canonical layer |
| Screenshot intelligence | `pipeline/screenshots/` (3 modules) | ✅ Clean |
| MLB ecology scoring | `pipeline/mlb/buildMlbPropClusters.js` | ✅ Canonical for MLB |
| NBA prediction model | `pipeline/nba/buildNbaPlayerOutcomePredictions.js` | ⚠️ Ecology audit pending |
| Sport adapters | `pipeline/shared/adapters/mlbAdapter.js` + `nbaAdapter.js` | ✅ Clean — underused |

### Ownership Clarifications Needed

| Domain | Confused Owners | Resolution Needed |
|---|---|---|
| NBA slip construction | 5 modules (see §3) | Audit → designate canonical path → deprecate the rest |
| MLB simple clustering | `buildMlbClusters` vs `buildMlbPropClusters` | Clarify: Clusters = board display; PropClusters = ecology scoring |
| Bet tracking | `tracker/betTracker.js` vs `buildPersonalLedger.js` | betTracker is legacy — designate personal_ledger as sole canonical |
| Nightly orchestration | `buildNightlyOrchestrator.js` vs inline nightly scripts | Orchestrator should absorb script logic in phases |
| Offensive stat definition | `buildFeaturedPlays.isOffensiveAttackStat` vs `buildSlipAi.offensiveAttackTextureBonus` | Extract to `normalizers.js` |

---

## 16. CANONICAL LONG-TERM ARCHITECTURE

### The Target Architecture (Evolutionary, Not Greenfield)

```
┌─────────────────────────────────────────────────────────────────────┐
│  server.js — STABLE SHELL ONLY                                      │
│    Express setup, route mounting, global snapshot management        │
│    Target: < 5,000 lines (from 21,024)                              │
│    Phase A→C extractions over multiple sessions                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌──────────────┐    ┌────────────────────┐    ┌──────────────────┐
│ http/         │    │ routes/             │    │ pipeline/         │
│ mlbIsolated  │    │ workstationRoutes  │    │ shared/ (CANON)  │
│ nbaIsolated  │    │ (sport-agnostic)   │    │ review/ (NEW)    │
│ [new sport]  │    │                    │    │ screenshots/     │
└──────────────┘    └────────────────────┘    └──────────────────┘
        │                      │                      │
        ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  pipeline/mlb/     pipeline/nba/     pipeline/[sport]/             │
│  ECOLOGY LAYER:    ECOLOGY LAYER:    (future: NFL, NHL)             │
│  buildMlbPropClusters  [to be built]                               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  storage/ — SQLite CANONICAL                                        │
│  betting.db — single canonical DB                                   │
│  One applyAllSchemas() entry point                                  │
│  JSON files: daily rolling only (bounded by date)                  │
│  Growing state files: all in SQLite with pruning                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Constitutional Principles for This System

1. **The shared pipeline is the intelligence nucleus.** `pipeline/shared/` is where all scoring, ecology, and trust logic lives. Never duplicate it outside this directory.

2. **Workstation routes are pure aggregators.** They read files, call shared modules, compact for transit. No business logic. No sport-specific imports.

3. **Sport isolation is through adapters, not inline conditionals.** Any sport-specific logic belongs in `pipeline/[sport]/` accessed via `pipeline/sports/sportConfig.js` or `pipeline/shared/adapters/`.

4. **SQLite is for growing/queryable state. JSON is for bounded daily files.** Daily rolling files naturally prune (date-bounded). Growing state (ledger, timing, reviews) belongs in SQLite.

5. **The daily review engine is the learning loop.** Every major behavioral assumption (volatility rules, tier thresholds, ecology filters) must eventually be evaluated by `pipeline/review/`. The review modules are how the system learns it's wrong.

6. **Dead code is deleted, not commented out or archived in-place.** 11,185 lines of inlined NBA code is not documentation — it's confusion. Delete confirmed-dead files.

---

## 17. DEPRECATION RECOMMENDATIONS

### Deprecate Immediately (Zero Risk)

1. `http/nbaBestAvailable.inlined.js` — Delete. 6,867 lines of dead code.
2. `http/nbaRefreshSnapshot.inlined.js` — Delete. 4,318 lines of dead code.
3. `pipeline/enrich/index.js` — Delete. Empty stub.
4. `pipeline/normalize/index.js` — Delete. Empty stub.
5. `pipeline/validation/rows.js` — Delete. Empty stub.
6. `pipeline/snapshot/buildSnapshot.js` — Delete. Empty stub.
7. `storage/betting2.db` + `betting2.db-journal` — Delete. Test artifacts.
8. `storage/test.txt` — Delete. Test artifact.
9. `runtime/tracking/*.tmp` — Delete. Partial-write orphan.

### Deprecate After Verification (Low Risk)

10. `pipeline/mlb/buildMlbStatcastPower.js` — Verify no dynamic require calls it, then delete. It fetches from Baseball Savant but is uncalled.
11. `offline/evaluateEmittedPicks.js` — Review engine (Session W) is the canonical replacement. If this tool's use case is fully superseded, delete.
12. `tracker/betTracker.js` + `tracker/betMetrics.js` — Designate personal_ledger as canonical. Remove `/api/bets` and `/api/bets/metrics` routes from server.js. Then delete the tracker files.
13. `runtime/tracking/tracked_props_*.json` (14 files) — Move to `archive/historical-pre-phase4/` after confirming importHistoricalData.js has ingested them into SQLite.

### Deprecate After NBA Ecology Audit (Medium Work)

14. `pipeline/nba/buildNbaDynamicSlipEngine.js` — Likely superseded by canonical NBA path through buildNbaAiPicks + buildNbaSlipComposer. Verify in audit.
15. `pipeline/nba/buildNbaSlipEngine.js` — Same. May be the pre-canonical implementation.
16. `pipeline/nba/buildNbaBestBetsBoard.js` — Likely superseded by `buildFeaturedPlays.js` canonical path.
17. `pipeline/nba/buildNbaBankrollPlan.js` — Evaluate overlap with `buildPortfolioOptimizer.js`. If fully superseded, deprecate.

### Retire When server.js Extractions Complete (Long-Term)

18. `pipeline/boards/buildSpecialtyOutputs.js` (28KB) — Server.js-era board builder. Retire when `buildFeaturedPlays.js` fully replaces it in the live path.
19. `pipeline/boards/buildCuratedLayer2Buckets.js` — Same.
20. `pipeline/boards/buildBestSpecials.js` — Same.
21. Legacy server.js board routes (`/props/*`, `/picks/today`, `/parlays/*`) once no live consumers confirmed.

---

## 18. SAFE MIGRATION ROADMAP

### Phase 0 — Dead Code Deletion (1 session, zero risk)

All items from §17 "Deprecate Immediately." Pure deletion. `node --check` the remaining files before and after. No behavior change.

**Files to delete**:
- `http/nbaBestAvailable.inlined.js` (6,867 lines)
- `http/nbaRefreshSnapshot.inlined.js` (4,318 lines)
- `pipeline/enrich/index.js`, `pipeline/normalize/index.js`, `pipeline/validation/rows.js`, `pipeline/snapshot/buildSnapshot.js` (4 empty stubs)
- `storage/betting2.db`, `storage/betting2.db-journal`, `storage/test.txt`
- `runtime/tracking/*.tmp` (1 orphan file)

**Gain**: Remove 11,185 lines of dead code. Clean mental map.

### Phase 1 — Docs Sync Fix (15 minutes)

Copy root `CURRENT_STATE.md` and `NEXT_SESSION.md` to `docs/`. Decide canonical location. Update BOOTSTRAP_PROMPT.md to point to exactly one location. This is a session continuity reliability fix.

### Phase 2 — Tactical Extractions (1 session)

In priority order:
1. Extract `isOffensiveAttackStat()` to `pipeline/shared/normalizers.js`. Import in both buildFeaturedPlays + buildSlipAi. Verify behavior unchanged with smoke test.
2. Extract `compactLineShopping`, `compactTiming`, `compactPortfolio` from `workstationRoutes.js` to `pipeline/shared/buildWorkstationCompactors.js`.
3. Fix `__refreshInProgress` dual-mutex: pick one scope (module-level), remove `global.*` references. Single line change.

### Phase 3 — Persistence Cut-Overs (1 session each)

In dependency order:
1. **Phase S+1**: Cut personal ledger READ to SQLite. Verify ledger row count matches JSON. Keep JSON as cold backup for 30 days then archive.
2. **Timing state to SQLite**: Add max-age eviction (90 days) to `timing_intelligence_state.json` OR migrate to SQLite table with date-indexed rows and automatic 90-day pruning on write.
3. **`tracked_props_*.json` → SQLite import**: Run `importHistoricalData.js` with explicit pass for legacy format. Verify row counts. Then archive the 14 legacy files.
4. **Unify `applyAllSchemas(db)`**: Create single entry point in `storage/schema.js` that chains all 4 schema files. No behavior change — just clean entry point.

### Phase 4 — NBA Ecology Audit (1 dedicated session, Opus model)

Single-focus session: audit `buildNbaPlayerOutcomePredictions.js` and the 5 NBA slip modules against the same lens used for MLB ecology audit (Sessions T–V).

Deliverables:
- Designate canonical NBA slip path (expected: buildNbaAiPicks + buildNbaSlipComposer)
- Apply same `edge × modelProb` compounding audit
- Check tierBoost asymmetry on NBA slate
- Check volRealism gaps across NBA stat families
- Fix NBA lotto slip starvation (Path A: snapshot-sourced volatility field)
- Mark deprecated NBA slip modules for Phase 5 deletion

### Phase 5 — Server.js Phase A Extraction (1 session)

Extract pure math utilities (server.js lines 11,379–11,430) to `pipeline/shared/mathUtils.js`. Verify against `utils/normalizeName.js` — consolidate if duplicate. ~52 lines, zero globals.

### Phase 6 — Intelligence Review Frontend (1 session)

Only after real data flows through the review engine. Build `sections/IntelligenceReviewView.tsx` fed by `GET /api/ws/review/daily`. Surface grades, major findings, HR eruption misses, suppressed winners.

### Phase 7 — NBA Workstation Scoring Symmetry (1 session)

Move NBA row scoring out of the live workstation request path. Make NBA follow the same pattern as MLB: nightly run scores and stamps tiers into `nba_tracked_bets_*` files; workstationRoutes reads pre-scored data. This eliminates sport-specific imports from `workstationRoutes.js` and makes the request path symmetric.

---

## 19. PHASED CLEANUP PLAN

### Session X+1 (Next Session) — Recommended Focus: Phase 0 + Phase 1 + Phase 2

These three phases combined are one session of work with zero regression risk:

```
1. Delete dead files (11 files, 11,000+ lines gone)
2. Sync docs/ with root docs (15 minutes)
3. Extract isOffensiveAttackStat() to normalizers.js
4. Extract compactors to buildWorkstationCompactors.js
5. Fix __refreshInProgress dual-mutex
6. node --check all modified files
7. TERM 1 restart + smoke test
```

Expected outcome: Repo drops 11K lines, 5 known structural debts resolved, operational safety improved.

### Session X+2 — Phase S+1 (Ledger Read Cutover)

Confirm SQLite ledger row count ≥ JSON count. Cut read path. Archive JSON. Verify one full nightly run with clean reads from SQLite.

### Session X+3 — Timing State Pruning

Add date-indexed pruning to `buildMarketTimingIntelligence.js`. Cap at 90 days rolling. Run test that timing state drops from 729KB to bounded size.

### Session X+4 — NBA Ecology Audit (Opus)

Single-session dedicated NBA audit. Block all other work until complete.

### Session X+5 — Intelligence Review Frontend

Wire review engine outputs to UI. First real data visualization of the learning system.

---

## 20. WHAT MUST NEVER BE TOUCHED

### Calibrated Values — Do Not Move

These values were arrived at through specific debugging sessions (Sessions E, F, H, T). They are correct for current slate characteristics. Changing them requires a full ecology audit, not a tweak.

```javascript
// buildFeaturedPlays.js — scoring formula
f.edge = (edge × 4) × clamp(modelProb, 0.50, 0.55)   // compounding cap
tierBoost: ELITE +0.04, STRONG +0.02                   // halved from original
textureBoost: +0.018 / +0.020 / +0.030                // calibrated
maxSideFraction: 0.60 (anchors: 0.55)                  // side-balance cap

// buildSlipAi.js — tier gates
safe tier: minModelProb 0.55, maxOdds 150
lotto tier: minModelProb 0.40, maxOdds 600             // do not widen
premium-edge override: edge≥0.12 + modelProb≥0.50      // keep this exact

// buildMlbPropClusters.js — HR ecology fixes (Session T)
// All five T1–T5 fixes are load-bearing. Do not remove any.
```

### Architecture Decisions — Irreversible Until Phase B/C Done

1. The separation of Path 1 (live nightly → server.js) and Path 2 (workstation → files) must remain until server.js extractions complete. Do not attempt to merge these paths.

2. `personal_ledger.json` must remain as cold backup until Phase S+1 read cutover is confirmed clean over at least 3 nightly runs.

3. `pipeline/shared/` modules are canonical. Never add sport-specific logic to them. All sport-specific behavior goes through adapters.

4. The workstation frontend calls ONLY `/api/ws/*`. Never add direct calls to legacy server.js routes.

5. `buildNightlyOrchestrator.js` Step 9 (dailyIntelligenceReview) must remain try/catch wrapped. Never let a review failure kill the nightly run.

### Never Do Without Full Audit

- Do not modify `VOLATILITY_RULES` without running buildVolatilityReview output first
- Do not touch `buildMlbPropClusters.js` HR scoring (T1–T5 fixes) without re-running full MLB ecology pass
- Do not widen `propVariant !== "base"` gate without controlled alt-line audit
- Do not merge `tracking_props_*.json` format code paths without confirming SQLite import success
- Do not attempt server.js Phase B/C before Phase A extraction is stable and ARCHITECTURE.md is confirmed current

---

## SUMMARY: WHAT SHOULD STAY, WHAT SHOULD EVOLVE, WHAT SHOULD DIE

### STAY (Protect Forever)
- `pipeline/shared/` — the intelligence nucleus
- `pipeline/review/` — the learning loop
- `pipeline/screenshots/` — bettor intelligence layer
- `storage/` SQLite layer (keep growing it)
- Frontend `/api/ws/*` contract
- `docs/WORKFLOW_RULES.md` permanent law
- All Session T–W calibration values

### EVOLVE (Intentionally, with Audits)
- `server.js` → shrink to shell via Phase A→C extractions
- `workstationRoutes.js` → become sport-agnostic (remove NBA-specific imports)
- `buildNightlyOrchestrator.js` → absorb more of nightly script logic
- Persistence → all growing state moves to SQLite
- `VOLATILITY_RULES` → review quarterly with Session W data
- NBA pipeline → ecology audit → canonical slip path designated
- `pipeline/shared/adapters/` → expand to cover more of the shared pipeline

### DIE (Delete in Phases)
- `http/nbaBestAvailable.inlined.js` + `nbaRefreshSnapshot.inlined.js` — delete immediately
- 4 empty stub directories — delete immediately
- `tracker/betTracker.js` — retire after personal_ledger read cutover confirmed
- `pipeline/nba/buildNbaDynamicSlipEngine.js` + `buildNbaSlipEngine.js` — retire after NBA audit
- `pipeline/boards/` board builders — retire when server.js extractions complete
- Legacy `tracked_props_*.json` files — archive after SQLite import confirmed
- `offline/evaluateEmittedPicks.js` — retire, review engine is its successor

---

_Architecture Audit completed: 2026-05-09_
_Next audit trigger: NFL expansion decision, OR server.js Phase B initiation, OR NBA ecology audit completion_
_Required reading before any structural change: this file + ARCHITECTURE.md + CURRENT_STATE.md_
