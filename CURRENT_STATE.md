# CURRENT STATE
**Live operational repo state. Overwrite every session. Never append.**
_Last updated: 2026-05-08 (Session V: MLB Roster Integrity Audit — 4 files fixed; team field now persisted through full leanBet/leanSlip chain; identity cache eviction added; 10-point verification passed; all syntax-clean; TERM 1 restart required)_

---

## REPO / BRANCH

| Item | Value |
|---|---|
| Active branch | `stable-nba-engine` |
| Base branch | `main` |
| Last commit | e076871 (Session I) — Sessions H–T staged, pending finalization via finalizeCheckpoint.sh |
| Repo health | Stable. All syntax checks clean. |

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
| **MLB roster integrity — team field** | **Fixed (Session V) — team/teamCode/awayTeam/homeTeam now persisted in leanBet/leanSlip; identity cache eviction added** | **`pipeline/mlb/phase4Tracking.js`, `buildMlbPropClusters.js`, `buildMlbPlayerDataset.js`, `external/mlbPlayerIdentityCache.js`** |
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
| Nightly orchestrator | Working | `pipeline/shared/buildNightlyOrchestrator.js` |
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

## RUNTIME TRACKING FILES (today: 2026-05-08)

| File | Contents |
|---|---|
| `mlb_tracked_bets_2026-05-08.json` | MLB bets |
| `mlb_tracked_best_2026-05-08.json` | HR/TB/RBI overs attack board |
| `mlb_tracked_slips_2026-05-08.json` | AI-generated slip catalog |
| `nba_tracked_bets_2026-05-08.json` | 2 bets (rebounds only — thin; SP Fix 1+2 accumulate nightly) |
| `personal_ledger.json` | **2,000 entries / 2.3MB — now atomic JSON write + SQLite mirror** |
| `book_intelligence_state.json` | Sportsbook CLV/profile rolling state |
| `snapshot.json` | 9.47MB, 5,209 rows (876 base non-alt NBA props, 4,333 alt/ladder) |

---

## SQLITE STATE

| File | Status |
|---|---|
| `backend/storage/betting.db` | 364KB — has `prediction_snapshots` (110 rows), `ecology_snapshots` (4 rows); other tables empty. `personal_ledger` table **added this session (Session S schema migration)**. |
| `backend/storage/betting.db-journal` | **Stale virtiofs rollback journal — blocks sandbox access.** macOS TERM 1 can open betting.db normally. Journal resolves on next server restart. |
| `backend/storage/betting2.db` | Orphan test db from Session H — stale journal also present. Not used. |

**⚠️ betting.db is inaccessible from sandbox** due to stale virtiofs journal. This does NOT affect TERM 1 (macOS native process opens it fine). The `_mirrorAllBetsToSqlite()` call in `saveLedger()` degrades silently if db is unavailable — JSON write succeeds regardless.

**Operator action required after TERM 1 restart:**
```bash
node backend/storage/importHistoricalData.js
```
This will: apply new schema (create `personal_ledger` table), backfill all 2,000 ledger bets + tracked_bets/slips/hr_predictions into SQLite.

---

## SESSION S — SQLite Persistence Migration

### Files modified (Session S):

| File | Change |
|---|---|
| `backend/storage/schema.js` | Added `personal_ledger` table DDL + 8 indexes |
| `backend/storage/queries.js` | Added `upsertLedgerBet`, `upsertManyLedgerBets`, `getLedgerBets`; **fixed latent `db.transaction()` bug** in `insertManyTrackedProps`, `insertManyHrPredictions`, `insertManySlips` (node:sqlite has no `.transaction()` method — fixed to `exec("BEGIN/COMMIT")`) |
| `backend/pipeline/shared/buildPersonalLedger.js` | `writeJsonSync` → atomic write (write-to-tmp, rename); `saveLedger()` now also calls `_mirrorAllBetsToSqlite()`; added `_tryGetLedgerDb()` lazy init, `_mirrorBetToSqlite()`, `_mirrorAllBetsToSqlite()` internal helpers |
| `backend/storage/importHistoricalData.js` | Added `importPersonalLedger()` pass; wires `applySchema()` call in `main()` to ensure `personal_ledger` table is created; added `personal_ledger` to verification report |

### Session S smoke test results (2026-05-08, /tmp copy of betting.db):

| Test | Result |
|---|---|
| `personal_ledger` table created by `applySchema()` | ✓ 36 columns |
| `upsertManyLedgerBets` on 2,000 bets | ✓ 2000 upserted, 0 errors |
| Idempotent re-run | ✓ 2000 rows, no duplicates |
| `prediction_snapshots` preserved (110 rows) | ✓ intact |
| `saveLedger()` atomic write | ✓ no .tmp orphan, JSON readable |
| `saveLedger()` SQLite mirror | ✓ 2000 rows in personal_ledger |
| `node --check` all 4 modified files | ✓ clean |
| `node --check` server.js | ✓ clean |

### Migration strategy (current phase):

```
Phase S (current):
  JSON is CANONICAL write target (atomic rename — no .tmp orphans)
  SQLite is WRITE-THROUGH mirror (best-effort — never blocks JSON write)
  Reads still come from JSON (loadLedger reads LEDGER_FILE)

Phase S+1 (next session after ≥1 verified nightly run):
  Cut read path to SQLite (loadLedger reads from personal_ledger table)
  Deprecate JSON write path
  Remove JSON fallback after 2nd verified run
```

**TERM 1 restart required** — Session Q (workstationRoutes.js), Session R (nbaIsolatedRoutes.js), Session S (buildPersonalLedger.js), Session T (buildMlbPropClusters.js) are all on disk but the running server has old cached modules.

---

## SESSION V — MLB Roster Integrity Audit

### Root causes identified (2026-05-08):

**Root Cause 1 (Primary — confirmed active):** `leanBet()` in `phase4Tracking.js` omitted the `team` field when serializing play objects to `mlb_tracked_bets_*.json`. All 134 today's bets had `team: undefined`. Every downstream consumer (correlation grouping, ecology grouping, portfolio diversification, slip construction team gates) received no team data and fell back to matchup-string parsing or failed team checks entirely.

**Root Cause 2 (Latent — cache file currently missing, would activate if created):** `mlbPlayerIdentityCache.mergeMlbPlayerIdentityCache()` accumulated team assignments without time-based eviction or current-slate prioritization. When a player changes teams, old entries persisted at head of candidate array indefinitely. Event-team-mismatch guard in `resolveMlbIdentityForRow()` protects against this only when `eventTeams.length > 0` — if empty, stale candidate wins with confidence 0.66.

**Additional gap found:** 9 of 80 players matched across bets+snapshot had `teamResolved: null` but valid `awayTeam`/`homeTeam`. These players (pitchers: Dylan Cease, Max Fried, Jacob Misiorowski etc.) had no team assignment flowing through the pred chain because `metaIdx` didn't store `awayTeam`/`homeTeam`.

### Files modified (Session V):

| File | Change |
|---|---|
| `backend/pipeline/mlb/phase4Tracking.js` | `leanBet()`: added `team`, `teamCode`, `awayTeam`, `homeTeam` fields from play object. `leanSlip()` legs: added `team`, `teamCode`, `eventId`, `matchup`. |
| `backend/pipeline/mlb/buildMlbPlayerDataset.js` | `metaIdx`: now stores `teamCode`, `awayTeam`, `homeTeam` from snapshot rows. Hitter pred block: added `teamCode`, `awayTeam`, `homeTeam` derivation + push. Pitcher pred block: added same 3 fields. |
| `backend/pipeline/mlb/buildMlbPropClusters.js` | `makePlay()` return: added `teamCode: pred.teamCode`, `awayTeam: pred.awayTeam`, `homeTeam: pred.homeTeam` |
| `backend/pipeline/mlb/external/mlbPlayerIdentityCache.js` | `toCandidate()`: added `firstSeenAt`, `lastSeenAt`. Added `evictStaleEntries()` (30d cutoff). Added `sortCandidatesByFreshness()` (current-slate eventId match → pos 0; soft-stale 7d → pos 1; legacy → pos 2). `mergeMlbPlayerIdentityCache()`: dedup now updates `lastSeenAt` + merges eventIds on existing entry; new entries get `firstSeenAt`/`lastSeenAt`; eviction + sort applied before write. Accepts optional `currentEventIds` param for slate-aware sorting. |

### Session V 10-point verification results (2026-05-08, 134 MLB bets today):

| Check | Result |
|---|---|
| V1 — Team field present in leanBet output | 134/134 ✓ |
| V2 — Team from teamResolved (priority 1) | 122/134 ✓ |
| V3 — Team from snapshot.team (priority 2) | 0 (teamResolved always set when team is set) |
| V4 — Team from awayTeam/homeTeam (fallback for null) | 12/134 (pitchers) ✓ |
| V5 — Team unresolvable (null) | 0 ✓ |
| V6 — Team consistent with matchup | 122/122 (all non-null) ✓ |
| V7 — Team mismatches matchup (integrity violation) | 0 ✓ |
| V8 — Myles Straw resolves to TOR | true (Toronto Blue Jays / TOR) ✓ |
| V9 — CLE in TOR game slots | 0 ✓ |
| V10 — All bets have matchup | 134/134 ✓ |

**TERM 1 restart required** — `phase4Tracking.js`, `buildMlbPropClusters.js`, `buildMlbPlayerDataset.js` all cached by running server.

---

## SESSION T — MLB Offensive Ecology Recalibration

### Root cause confirmed (2026-05-08):
Source pool today: 62 bets, 52 unders (84%), 10 overs (all pitcher-outs or 1 RBI). HR candidates: 0 hitter HR overs. Yesterday: 3 HR bets — all "No Home Run" game props, all capped at PLAYABLE despite 0.17–0.23 edge.

Three stacked penalties suppressed all HR candidates into PLAYABLE:
1. `modelProbForSide` HR maxP = 0.48 — hard cap below fair-coin; HR overs structurally < 50% modelProb
2. `calibrateMlbConfidence` HR mult = 0.68 — calibrated conf ~0.26, far below any STRONG/ELITE threshold
3. `scorePlay` HR familyWeight = 0.85 — additional 15% composite penalty on top of conf penalty
4. `tierForPlay` HR conf thresholds = 0.45/0.42 — calibrated for hits/TB, not HR range (0.22–0.30)
5. `vol > 0.65 && edge < 0.06` gate — HR is intrinsically high-variance (vol 0.7–1.0), dropped most HR candidates before scoring

### Files modified (Session T):

| File | Change |
|---|---|
| `backend/pipeline/mlb/buildMlbPropClusters.js` | T1: HR familyWeight 0.85→1.0 in `scorePlay`; T2: HR-specific `tierForPlay` conf thresholds (ELITE: 0.45→0.30, STRONG: new 0.22); T3: HR conf mult 0.68→0.72 in `calibrateMlbConfidence`; T4: HR maxP 0.48→0.52 in `modelProbForSide`; T5: `isHrProp` exemption in vol-gate |

### Session T smoke test results (2026-05-08):

| Candidate | Before | After |
|---|---|---|
| HR +300, edge=0.23 | PLAYABLE, score 69.6 | **STRONG**, score 91.7 |
| HR +220, edge=0.17 | PLAYABLE, score 44.7 | **STRONG**, score 60.4 |
| HR +140, edge=0.063 | PLAYABLE, score 16.3 | PLAYABLE, score 25.1 (marginal, correct) |
| Hits under (edge=0.08) control | PLAYABLE | PLAYABLE (unchanged ✓) |
| TB under (edge=0.16) control | ELITE | ELITE (unchanged ✓) |
| HR vol=0.8, edge=0.05 vol-gate | **dropped** | passed to scoring ✓ |

**TERM 1 restart required** — buildMlbPropClusters.js is cached in the running server.

---

## SESSION U — Screenshot Intelligence Architecture

### Scope (2026-05-08):
Foundation for bettor psychology + screenshot intelligence. JSON-first ingestion pipeline only (no image/OCR this phase). Pure function pipeline: normalizer → classifier → SQLite storage. Source-agnostic — works for internal AI slips, personal bets, Twitter parlays, Discord tips, viral longshots, guru picks, sportsbook promos.

### Files created (Session U):

| File | Change |
|---|---|
| `backend/storage/screenshotSchema.js` | 5-table SQLite DDL: `screenshot_submissions`, `parsed_slips`, `slip_classifications`, `bettor_profiles`, `outcome_links`; 10-dimension classification schema; 7 archetype enum |
| `backend/pipeline/screenshots/normalizeIngestedSlip.js` | Pure function normalizer; handles 7 input shapes (internal AI slip, personal ledger, pasted text, OCR JSON, array of legs, single leg, sportsbook promo); source-agnostic stat family + side + odds normalization; 32 stat family aliases; SHA-256 stable IDs |
| `backend/pipeline/screenshots/classifyIngestedSlip.js` | Pure function classifier; 10 scored dimensions (0–1); COMPOSITE_WEIGHTS with emotional_bait negative weight; 7 archetype detection; ecology tags; secondary archetype tags; rationale builder |
| `backend/pipeline/screenshots/screenshotRoutes.js` | Express router at `/api/ws/screenshots`; POST `/ingest`, GET `/list` (paginated, 8 filters), GET `/submission/:id`, GET `/:id`; schema bootstrap on first request; SQLite unavailability returns 503 |

### Files modified (Session U):

| File | Change |
|---|---|
| `backend/storage/schema.js` | Imports + calls `applyScreenshotSchema(db)` inside `applySchema()` — Phase U tables created automatically on every DB init |
| `backend/routes/workstationRoutes.js` | `router.use("/screenshots", screenshotRoutes)` mounted |

### Session U smoke test results (2026-05-08):

| Test | Result |
|---|---|
| Internal MLB 2-leg (Ohtani hits + Judge HR) | normalized sport=mlb ✓ | archetype=sharp_aggressive, composite=0.965, sharp_signal=1 ✓ |
| Viral guru 3-leg ("1+ hits", "total bases", "long ball") | normalized sport=mlb, attribution=@GlizzyGuru99 ✓ | archetype=guru_bait, bait_signal=1 ✓ |
| Personal NBA single leg (LeBron points over) | normalized sport=nba ✓ | archetype=safe_grind, composite=0.818 ✓ |
| `node --check` all 6 files | ✓ clean |

**TERM 1 restart required** — workstationRoutes.js changed (new import + route mount).

**Routes now available (after restart):**
```
POST /api/ws/screenshots/ingest
GET  /api/ws/screenshots/list
GET  /api/ws/screenshots/submission/:id
GET  /api/ws/screenshots/:id
```

---

## CURRENT ORCHESTRATION

Candidate diversification (`buildCandidateDiversity.js → diversifyCandidates`):
- `maxPerPlayer: 3` · `maxPerGame: 7 (MLB) / 12 (NBA)` · `maxPerStat: 10` · `maxPerStatSide: 6`
- Fix Q3: NBA playoff slates get `nbaPerGame = 12` vs MLB's `7`
- Fix 1 (Session L): modelProb capped at [0.50, 0.55] in diversity sort

Featured side-balance (`buildFeaturedPlays.js → pickDiversified`):
- `maxSideFraction: 0.60` (anchors: 0.55)
- Anchors `maxPerGame: 2`

Volatility classification (`buildPortfolioOptimizer.js → VOLATILITY_RULES`):
- `threes < 3.5 → balanced`, `threes >= 3.5 → lotto`, `PRA/combo → aggressive`, `odds >= 350 → lotto`
- **NOTE**: classifyVolatility overrides snapshot `volatility` field. PRA → `aggressive` (not `lotto`).

NBA snapshot candidate pipeline (`workstationRoutes.js → buildNbaSnapshotCandidates`):
- Gates: core odds (-200..+200), no alternate/ladder keys, known stat family, mp≥0.35, edge≥0.03
- Fix Q2: deduplicates by (player|statFamily|side)
- Top 150 by edge
- Fix Q1: wired into BOTH supplementedCandidates AND aiCandidatesRaw

---

## ACTIVE BOTTLENECKS

**NBA lotto slips remain empty.** PRA at base odds dec ~5–9 < lotto [20, 1500] minimum. classifyVolatility maps PRA → `aggressive` regardless of snapshot `volatility` field. Path A (snapshotSourced guard) preferred.

**First basket bucket empty.** `first_basket` family absent from base snapshot — alt markets only, accumulates via runNbaNight.js live runs.

**MLB HR ecology recalibrated (Session T).** HR STRONG/ELITE tier now reachable. Hitter HR overs with 0.17+ edge will surface after next nightly run. Source pool imbalance (84% unders) remains upstream (projection engine) — unchanged by design.

---

## KNOWN WEAKNESSES

1. **NBA lotto slips empty** — Priority 2
2. **NBA first basket bucket empty** — needs alt market accumulation
3. **NBA smartAggression limited** — only PRA gets `aggressive`
4. **NBA tracked_bets pool thin** — 2 bets today
5. **NBA SP4 (combo PA/PR/RA)** — resolveStatFamily returns null. Deferred.
6. **NBA SP1 (bestProps empty)** — hardcoded empty. Deferred.
7. **`pipeline/boards/buildFeaturedPlays.js` orphaned** — needs manual `rm` from macOS terminal
8. **`personal_ledger.json` all 2,000 entries pending** — bets are importFromTrackedBets calls never settled; ring buffer full
15. **MLB hitter HR overs still absent today** — Session T fixes take effect on next nightly run (buildMlbBestBetsBoard re-runs with updated scoring)
9. **tracked_best missing eventId/matchup** — tier boosts always fail; Priority 3
10. **Duplicate balanced slip issue (seenSignatures)** — deferred
11. **`timing_intelligence_state.json` at 729KB, unbounded growth** — no pruning
12. **`isOffensiveAttackStat` duplicated** between buildFeaturedPlays.js and buildSlipAi.js
13. **Under-heavy raw NBA pool (~67% unders)** — source imbalance, projection engine only
14. **Under-heavy raw MLB pool (~83% unders)** — same

---

## INFRASTRUCTURE STATE

| File | Status |
|---|---|
| `docs/WORKFLOW_RULES.md` | Committed |
| `docs/CURRENT_STATE.md` | **Updated this session (Session U)** |
| `docs/NEXT_SESSION.md` | **Updated this session (Session U)** |
| `docs/BOOTSTRAP_PROMPT.md` | Committed |
| `.cursor/rules/workflow.mdc` | Committed |
| `docs/ARCHITECTURE.md` | Created 2026-05-07 |
| `backend/storage/schema.js` | **Session U: applyScreenshotSchema() wired into applySchema(); Phase U tables auto-applied on DB init** |
| `backend/storage/queries.js` | **Session S: upsertLedgerBet/upsertManyLedgerBets/getLedgerBets added; db.transaction() latent bug fixed** |
| `backend/storage/db.js` | Unchanged |
| `backend/storage/importHistoricalData.js` | **Session S: importPersonalLedger() pass added** |
| `backend/storage/intelligenceSchema.js` | Unchanged |
| `backend/storage/intelligence.js` | Unchanged |
| `backend/pipeline/shared/buildPersonalLedger.js` | **Session S: atomic saveLedger() + SQLite mirror** |
| `backend/routes/workstationRoutes.js` | **Session U: screenshotRoutes mounted at /api/ws/screenshots** |
| `backend/http/nbaIsolatedRoutes.js` | Session R Fix R1 |
| `backend/pipeline/mlb/buildMlbPropClusters.js` | **Session T: HR scoring recalibrated (T1–T5); Session V: awayTeam/homeTeam/teamCode added to makePlay() return** |
| `backend/pipeline/mlb/buildMlbPlayerDataset.js` | **Session V: metaIdx now stores awayTeam/homeTeam/teamCode; hitter + pitcher pred objects carry all 3 new fields** |
| `backend/pipeline/mlb/phase4Tracking.js` | **Session V: leanBet() now persists team/teamCode/awayTeam/homeTeam; leanSlip() legs now persist team/teamCode/eventId/matchup** |
| `backend/pipeline/mlb/external/mlbPlayerIdentityCache.js` | **Session V: toCandidate() adds firstSeenAt/lastSeenAt; mergeMlbPlayerIdentityCache() evicts >30d entries, sorts by current-slate freshness, merges eventIds on duplicate candidates** |
| `backend/pipeline/boards/buildFeaturedPlays.js` | **Orphaned — needs manual `rm` from macOS terminal** |
| `backend/storage/screenshotSchema.js` | **NEW (Session U) — 5-table screenshot intelligence DDL** |
| `backend/pipeline/screenshots/normalizeIngestedSlip.js` | **NEW (Session U) — pure function slip normalizer, 7 input shapes** |
| `backend/pipeline/screenshots/classifyIngestedSlip.js` | **NEW (Session U) — pure function classifier, 10 dimensions, 7 archetypes** |
| `backend/pipeline/screenshots/screenshotRoutes.js` | **NEW (Session U) — Express router: POST /ingest, GET /list, GET /:id** |
