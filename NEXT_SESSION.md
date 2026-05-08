# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-08 (Session V: MLB Roster Integrity Audit — 4 files fixed; team/teamCode/awayTeam/homeTeam now carried through full pred→makePlay→leanBet chain; identity cache eviction + slate-aware sorting added; 10-point verification 10/10; sessions H–V staged)_

---

## CURRENT PROJECT PHASE

**MLB ROSTER INTEGRITY — Phase 9 (Complete)**

Session V fixed the systemic team-field omission that caused all `mlb_tracked_bets_*.json` entries to lack team data. The fix is end-to-end:

- `buildMlbPlayerDataset.js` — metaIdx now stores `teamCode`/`awayTeam`/`homeTeam` from snapshot rows; both hitter and pitcher pred objects carry all 3 new fields
- `buildMlbPropClusters.js` — `makePlay()` now passes `teamCode`/`awayTeam`/`homeTeam` from pred through to play object
- `phase4Tracking.js` — `leanBet()` now persists `team`/`teamCode`/`awayTeam`/`homeTeam`; `leanSlip()` legs now persist `team`/`teamCode`/`eventId`/`matchup`
- `mlbPlayerIdentityCache.js` — added 30-day hard eviction + 7-day soft-stale sort + current-slate eventId priority + `lastSeenAt` update on duplicate merge

10-point verification: all 10 checks passed. 134/134 bets will have team field after next pipeline run. 0 integrity violations. Myles Straw → TOR confirmed.

MLB HR ecology (Session T) + SQLite ledger mirror (Session S) + Screenshot intelligence (Session U) still pending operator verification via nightly runs.

---

## LAST SUCCESSFUL STATE

### ~~Session V — MLB Roster Integrity Audit~~ — DONE (2026-05-08)

**Root problem**: `leanBet()` in `phase4Tracking.js` stripped `team` before persisting to `mlb_tracked_bets_*.json`. All downstream consumers (correlation, ecology, slip construction) got `team: undefined`. Secondary problem: `mlbPlayerIdentityCache` had no time-based eviction — stale-team entries accumulated indefinitely.

**Four-file fix:**

| File | Change |
|---|---|
| `backend/pipeline/mlb/phase4Tracking.js` | `leanBet()` adds `team`/`teamCode`/`awayTeam`/`homeTeam`; `leanSlip()` legs add `team`/`teamCode`/`eventId`/`matchup` |
| `backend/pipeline/mlb/buildMlbPlayerDataset.js` | `metaIdx` stores `teamCode`/`awayTeam`/`homeTeam`; hitter + pitcher preds carry all 3 |
| `backend/pipeline/mlb/buildMlbPropClusters.js` | `makePlay()` passes `teamCode`/`awayTeam`/`homeTeam` from pred |
| `backend/pipeline/mlb/external/mlbPlayerIdentityCache.js` | 30d hard eviction, 7d soft-stale sort, current-slate eventId priority, `lastSeenAt` per-entry |

**10-point verification (134 bets, 2026-05-08):** All 10 passed. 122 via teamResolved, 12 via awayTeam/homeTeam fallback (pitchers). 0 mismatches. Straw=TOR ✓.

**⚠️ TERM 1 restart required** — 3 cached pipeline modules changed.

---

### ~~Session U — Screenshot Intelligence Architecture~~ — DONE (2026-05-08)

**Goal**: Build safe additive foundation for bettor psychology + screenshot intelligence. JSON-first ingestion (no OCR/image upload this phase).

**Six-file deliverable:**

| File | Description |
|---|---|
| `backend/storage/screenshotSchema.js` | 5 tables: screenshot_submissions, parsed_slips, slip_classifications, bettor_profiles, outcome_links |
| `backend/pipeline/screenshots/normalizeIngestedSlip.js` | Source-agnostic normalizer: 7 input shapes → canonical parsed_slip; 32 stat family aliases; SHA-256 IDs |
| `backend/pipeline/screenshots/classifyIngestedSlip.js` | 10-dimension classifier; COMPOSITE_WEIGHTS (emotional_bait inverted -0.15); 7 archetypes; ecology tags |
| `backend/pipeline/screenshots/screenshotRoutes.js` | Express router: POST /ingest, GET /list, GET /submission/:id, GET /:id |
| `backend/storage/schema.js` | **Modified**: calls applyScreenshotSchema() inside applySchema() |
| `backend/routes/workstationRoutes.js` | **Modified**: router.use("/screenshots", screenshotRoutes) |

**Smoke test results:**
- Internal MLB 2-legger: archetype=sharp_aggressive, composite=0.965, sharp_signal=1 ✓
- Viral guru 3-legger (@GlizzyGuru99): archetype=guru_bait, bait_signal=1 ✓
- Personal NBA single: archetype=safe_grind, composite=0.818 ✓
- `node --check` all 6 files: clean ✓

**⚠️ TERM 1 restart required** — workstationRoutes.js changed.

---

### ~~Session T — MLB Offensive Ecology Recalibration~~ — DONE (2026-05-08)

**Root problem**: Five stacked scoring/tiering penalties in `buildMlbPropClusters.js` systematically prevented all HR candidates from reaching STRONG or ELITE tier regardless of edge quality. A 0.23-edge HR over with +300 odds (EV ~0.92) consistently scored as PLAYABLE.

**Five-part fix (T1–T5):**

| Part | Change | Impact |
|---|---|---|
| **T1** | `scorePlay`: HR familyWeight 0.85→1.0 | HR scores 18% higher; competes on equal composite footing with hits/runs |
| **T2** | `tierForPlay`: HR-specific conf thresholds (STRONG: old 0.42→0.22, ELITE: 0.45→0.30) | HR conf ~0.26–0.30 now clears STRONG gate (previously never did) |
| **T3** | `calibrateMlbConfidence`: HR mult 0.68→0.72 | Slightly higher calibrated conf → 0.24 → 0.29 typical |
| **T4** | `modelProbForSide`: HR maxP 0.48→0.52 | HR overs no longer structurally capped below 50%; improves EV calculation |
| **T5** | Vol-gate: `isHrProp` exemption from `vol>0.65 && edge<0.06` drop | HR vol is intrinsically high (0.7–1.0); was dropping most HR candidates pre-scoring |

**Smoke test results:**
- HR +300 edge=0.23: PLAYABLE → **STRONG**, score 69.6 → 91.7 ✓
- HR +220 edge=0.17: PLAYABLE → **STRONG**, score 44.7 → 60.4 ✓
- HR +140 edge=0.063: PLAYABLE → PLAYABLE (correct, marginal edge) ✓
- Hits under (control): PLAYABLE → PLAYABLE (unchanged) ✓
- TB under (control): ELITE → ELITE (unchanged) ✓
- HR vol-gate: dropped → passed to scoring ✓
- `node --check` all files: clean ✓

**⚠️ TERM 1 restart required** — buildMlbPropClusters.js is cached.

---

### ~~Session S — SQLite Persistence Migration~~ — DONE (2026-05-08)

**Root problem**: `writeJsonSync` used bare `writeFileSync` on a 2.3MB file — any interrupt mid-write could corrupt the ledger. No atomic guarantee. `.tmp` orphan already observed in prior session.

**Secondary finding**: All three `insertMany*` batch helpers in `queries.js` used `db.transaction()` — a better-sqlite3 API that does not exist in `node:sqlite` (`DatabaseSync`). This was a latent bug that would have broken `importHistoricalData.js` on first real run. Fixed to `db.exec("BEGIN/COMMIT/ROLLBACK")` pattern.

**Files changed**: `backend/storage/schema.js`, `backend/storage/queries.js`, `backend/storage/importHistoricalData.js`, `backend/pipeline/shared/buildPersonalLedger.js`

**Four-part fix:**

| Part | Change | Impact |
|---|---|---|
| **S1** | `schema.js`: added `personal_ledger` table (36 columns, 8 indexes) | SQLite can now store personal bet history |
| **S2** | `queries.js`: added `upsertLedgerBet`, `upsertManyLedgerBets`, `getLedgerBets`; **fixed `db.transaction()` latent bug** in all 3 existing batch helpers | Batch inserts now work correctly with node:sqlite |
| **S3** | `buildPersonalLedger.js`: `writeJsonSync` → atomic write (tmp+rename); `saveLedger()` calls `_mirrorAllBetsToSqlite()` after JSON write; added `_tryGetLedgerDb()`, `_mirrorBetToSqlite()`, `_mirrorAllBetsToSqlite()` lazy helpers | No .tmp orphans; every save auto-mirrors to SQLite |
| **S4** | `importHistoricalData.js`: `importPersonalLedger()` pass added; `applySchema()` called in `main()` | Historical backfill ready to run |

**Smoke test results (2026-05-08, /tmp copy of betting.db):**
- `personal_ledger` table: 36 columns ✓
- `upsertManyLedgerBets(2000 bets)`: 2000 upserted / 0 errors ✓
- Idempotent re-run: 2000 rows, count unchanged ✓
- `prediction_snapshots` (110 rows) preserved ✓
- `saveLedger()` atomic write: .tmp orphan = false, JSON readable ✓
- `saveLedger()` SQLite mirror: 2000 rows ✓
- `node --check` all 4 modified files: clean ✓

**⚠️ betting.db has stale virtiofs journal** — sandbox cannot rm it (same virtiofs PermissionError as git locks). macOS TERM 1 opens betting.db fine. Journal clears on next server restart. SQLite mirror degrades silently if db unavailable.

---

## IMMEDIATE NEXT PRIORITIES

### 🔴 Priority 0 — Operator actions (macOS terminal) — DO FIRST

```bash
cd ~/Desktop/betting-dashboard

# 1. Commit Sessions H–V
bash scripts/finalizeCheckpoint.sh

# 2. Restart TERM 1 (activates Sessions Q + R + S + T + U + V changes)
#    Session V changed: phase4Tracking.js, buildMlbPropClusters.js, buildMlbPlayerDataset.js
#    Ctrl-C the running node process, then:
node backend/server.js

# 3. Verify /api/best-available NBA payload
curl -s "http://localhost:4000/api/best-available?sport=basketball_nba" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); \
  console.log('best:', p.bestAvailable?.best?.length, 'featured:', p.bestAvailable?.featured?.anchors?.length, \
  'slips safe:', p.bestAvailable?.aiSlips?.safe?.length)"

# 4. Run historical backfill (applies personal_ledger schema + imports all data)
node backend/storage/importHistoricalData.js

# 5. Remove orphaned dead file (virtiofs blocks sandbox rm)
rm backend/pipeline/boards/buildFeaturedPlays.js

# 6. Verify screenshot routes are live after restart:
curl -s -X POST http://localhost:4000/api/ws/screenshots/ingest \
  -H "Content-Type: application/json" \
  -d '{"sourceType":"internal","slip":{"legs":[{"player":"Shohei Ohtani","statFamily":"hits","side":"over","line":0.5,"odds":-145}]}}' | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const r=JSON.parse(d);console.log('ok:',r.ok,'slipsIngested:',r.slipsIngested,'archetype:',r.results?.[0]?.archetype)"

# 7. After next runMlbNight.js run — verify team field now persisted in tracked bets:
node -e "
const fs = require('fs');
const bets = JSON.parse(fs.readFileSync('backend/runtime/tracking/mlb_tracked_bets_\$(date +%Y-%m-%d).json','utf8'));
const withTeam = bets.filter(b => b.team !== undefined && b.team !== null);
const noTeam = bets.filter(b => b.team === undefined || b.team === null);
console.log('Total bets:', bets.length);
console.log('With team:', withTeam.length, '(expected: all)');
console.log('Missing team:', noTeam.length, '(expected: 0)');
const straw = bets.find(b => (b.player||'').toLowerCase().includes('straw'));
if (straw) console.log('Straw team:', straw.team, '| expected: Toronto Blue Jays');
"

# 8. After next runMlbNight.js run — verify HR candidates now tier as STRONG/ELITE:
node -e "
const fs = require('fs');
const bets = JSON.parse(fs.readFileSync('backend/runtime/tracking/mlb_tracked_bets_\$(date +%Y-%m-%d).json','utf8'));
const hr = bets.filter(b => (b.statFamily||'').match(/hr/i));
console.log('HR bets:', hr.length);
hr.forEach(b => console.log(b.player, b.statFamily, b.side, 'edge:', b.edge?.toFixed(4), 'tier:', b.tier));
"
```

---

### 🟡 Priority 1 — Verify SQLite ledger mirror after nightly run

After the next nightly `runMlbNight.js` or `runNbaNight.js` execution:

```bash
# Verify personal_ledger rows are being written
node -e "
const { tryGetDb } = require('./backend/storage/db');
const db = tryGetDb();
const cnt = db.prepare('SELECT COUNT(*) AS n FROM personal_ledger').get();
const recent = db.prepare('SELECT date, COUNT(*) AS n FROM personal_ledger GROUP BY date ORDER BY date DESC LIMIT 5').all();
console.log('total rows:', cnt.n);
console.log('by date:', JSON.stringify(recent));
"
```

If rows are accumulating correctly: proceed to Phase S+1 (cut read path to SQLite).

**Phase S+1 checklist (only after ≥1 verified nightly run):**
- `loadLedger()` reads from `personal_ledger` table instead of JSON file
- `saveLedger()` continues to write JSON (fallback) + SQLite (primary)
- After 2nd verified run: remove JSON write path from `saveLedger()`

---

### 🟡 Priority 2 — NBA lotto slip bottleneck

**Problem**: PRA at base odds forms 3-leg combos at dec ~5–9, below lotto tier's [20, 1500] minimum. classifyVolatility maps PRA → `aggressive` regardless of snapshot-set `volatility:"lotto"` field.

**Path A (preferred)**: Add `snapshotSourced` guard in `buildFeaturedPlays.normalizeCandidate` / `buildSlipAi.normalizeCandidate` — use snapshot-set `volatility` field directly when `bet.snapshotSourced === true`. Minimal change, no VOLATILITY_RULES modification.

**Path B**: Qualify higher-odds NBA alt-line PRA candidates into snapshot pool via `altPraRows` supplement pass. Requires loosening `propVariant !== "base"` gate carefully.

Model: **Opus** (audit classifyVolatility override chain before touching; verify MLB ecology unchanged)

---

### 🟡 Priority 3 — eventId/matchup on tracked_best

All tracked_best entries have `eventId=null`, `matchup=null`. Tier boosts always fail. Requires full trace of `runMlbNight.js` before touching.

---

### Priority 4 — Modular extraction #2: compactors

`compactLineShopping` + `compactTiming` + `compactPortfolio` in `workstationRoutes.js`
→ `pipeline/shared/buildWorkstationCompactors.js`
~103 lines, zero behavior change.

---

### Priority 5 — PIPELINES docs

- `/docs/PIPELINES/MLB.md`
- `/docs/PIPELINES/NBA.md`
- `/docs/PIPELINES/TRACKING.md`

---

### Priority 6 — Extract `isOffensiveAttackStat` into shared normalizer

Both `buildFeaturedPlays.js` and `buildSlipAi.js` define this independently. Extract to `pipeline/shared/normalizers.js`. 30-minute task.

---

### Priority 7 — Prune timing_intelligence_state.json

At 729KB with no pruning mechanism. Add max-age eviction or size cap.

---

## PENDING OPERATOR ACTIONS (macOS terminal)

```bash
cd ~/Desktop/betting-dashboard

# 1. Commit Sessions H–V
bash scripts/finalizeCheckpoint.sh

# 2. REQUIRED: Restart TERM 1 (activates Q + R + S + T + U + V changes)
node backend/server.js

# 3. Verify NBA payload
curl -s "http://localhost:4000/api/best-available?sport=basketball_nba" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); \
  console.log('best:', p.bestAvailable?.best?.length, 'featured anchors:', p.bestAvailable?.featured?.anchors?.length)"

# 4. Run historical backfill (includes new personal_ledger pass)
node backend/storage/importHistoricalData.js

# 5. Remove orphaned dead file
rm backend/pipeline/boards/buildFeaturedPlays.js
```

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| buildFeaturedPlays fork | ✅ RESOLVED — dead import removed |
| HR ecology suppression | ✅ RESOLVED (Session T) — 5 fixes in buildMlbPropClusters.js |
| MLB team field omission (leanBet) | ✅ RESOLVED (Session V) — team/teamCode/awayTeam/homeTeam now persisted through full chain |
| MLB identity cache stale-team accumulation | ✅ RESOLVED (Session V) — 30d eviction + slate-aware sort + lastSeenAt tracking |
| personal_ledger.json corruption | ✅ RESOLVED (Session S) — atomic write |
| Screenshot routes startup crash | schema bootstrap runs inside first request — graceful 503 if SQLite down |
| Screenshot normalizer throwing | normalizeIngestedSlip never throws; unknown fields degrade to null silently |
| SQLite mirror unavailable | Graceful degradation — JSON write always succeeds first |
| betting.db journal lock (virtiofs) | macOS TERM 1 unaffected; sandbox writes degrade silently |
| NBA lotto slip starvation | classifyVolatility override chain — audit before touching normalizeCandidate |
| NBA smartAggression thin | Do NOT widen without tracing |
| classifyVolatility affecting MLB | Any VOLATILITY_RULES change must verify MLB ecology unchanged |
| Fix 3 volRealism hierarchy | lotto=0.56 still below balanced=0.74 ✓ |
| Fix 6 greedy fill leg count | DO NOT touch max→min walk-back direction |
| Premium-edge override | Three gates: 12% edge AND 50% modelProb AND maxOdds 150 |
| NBA under bias (67%) | Do NOT impose artificial side balance |

---

## WHAT NOT TO DO

- Do NOT increase textureBoost
- Do NOT force over/under parity
- Do NOT touch the `[0.50, 0.55]` modelProb cap
- Do NOT raise slipAi or featured tierBoost
- Do NOT lower safe-tier maxOdds below 150
- Do NOT remove premium-edge thresholds
- Do NOT widen `maxPerGame` beyond 2 in anchors
- Do NOT attempt server.js Phase B/C without ARCHITECTURE.md global map
- Do NOT touch `runMlbNight.js` without tracing candidate paths first
- Do NOT reopen ecology fixes
- Do NOT modify `VOLATILITY_RULES` for NBA lotto without MLB ecology audit (Path A preferred)
- Do NOT loosen `propVariant !== "base"` gate without controlled alt-line audit
- Do NOT cut ledger read path to SQLite until ≥1 verified nightly run confirms rows accumulating

---

## SQLITE MIGRATION SEQUENCE (updated)

0. ~~**Phase 1: storage layer** — DONE 2026-05-07~~
1. ~~**`personal_ledger.json` → ledger table — DONE (Session S)**~~
   - **Phase S+1**: Cut read path after ≥1 verified nightly run
2. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
3. `timing_intelligence_state.json` → timing state table (729KB, unbounded)
4. `book_intelligence_state.json` → book profiles table
5. `graded_props_*.json` → review/grading table

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| NBA lotto audit (classifyVolatility override chain) | **Opus** |
| Root-cause audit on unknown bug | **Opus** |
| Ecology fixes (verified, well-scoped) | **Sonnet** |
| SQLite migration / Phase S+1 read cutover | **Sonnet** |
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

Session S: **TERM 1 restart: YES** (buildPersonalLedger.js changed — server caches old module)
Session T: **TERM 1 restart: YES** (buildMlbPropClusters.js changed — server caches old module)
Session U: **TERM 1 restart: YES** (workstationRoutes.js changed — new screenshotRoutes import)
Session V: **TERM 1 restart: YES** (phase4Tracking.js + buildMlbPropClusters.js + buildMlbPlayerDataset.js changed)
TERM 2 verification (Session U):
```bash
# Verify screenshot routes are wired after restart:
curl -s -X POST http://localhost:4000/api/ws/screenshots/ingest \
  -H "Content-Type: application/json" \
  -d '{"sourceType":"internal","slip":{"legs":[{"player":"Shohei Ohtani","statFamily":"hits","side":"over","line":0.5,"odds":-145}]}}' | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const r=JSON.parse(d);console.log('ok:',r.ok,'archetype:',r.results?.[0]?.archetype,'composite:',r.results?.[0]?.compositeScore)"
# Expected: ok: true  archetype: safe_grind or sharp_aggressive  composite: 0.8xx
```
TERM 2 verification (Session T):
```bash
# After runMlbNight.js next run:
node -e "
const fs=require('fs');
const bets=JSON.parse(fs.readFileSync('backend/runtime/tracking/mlb_tracked_bets_\$(date +%Y-%m-%d).json','utf8'));
const hr=bets.filter(b=>(b.statFamily||'').match(/hr/i));
console.log('HR bets:', hr.length, '/ expected ≥1 STRONG or ELITE');
hr.forEach(b=>console.log(b.player,b.side,'edge:',b.edge?.toFixed(4),'tier:',b.tier));
"
```
