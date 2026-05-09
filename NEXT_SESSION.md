# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-09 (Session AA: NBA-1 PRA Volatility Guard — complete; snapshotSourced lotto guard in buildFeaturedPlays.js + buildSlipAi.js; volRealism lotto 0.65; TERM 1 restart required; NBA-2 now unblocked)_

---

## CURRENT PROJECT PHASE

**NBA ECOLOGY EVOLUTION — Phase NBA-1 Next**

Session Z completed the full NBA Ecology Constitution Audit (read-only). NBA intelligence health: 2.9/10. Seven-phase evolution roadmap defined. See `docs/NBA_ECOLOGY_AUDIT_2026-05-09.md`.

| Phase | Status | Summary |
|---|---|---|
| Architecture Cleanup Phase 0 | ✅ DONE | 11,185 lines + 9 files + 4 empty dirs deleted |
| Architecture Cleanup Phase 1 | ✅ DONE | root docs synced to docs/ |
| Architecture Cleanup Phase 2 | ✅ DONE | normalizers.js, buildWorkstationCompactors.js, mutex unified |
| NBA Ecology Audit (Session Z) | ✅ DONE | 20-section audit; health 2.9/10; roadmap defined |
| **NBA-1 — PRA volatility fix** | ✅ DONE | snapshotSourced guard in buildFeaturedPlays + buildSlipAi; lotto volRealism 0.65 |
| **NBA-2 — Canonical path designation** | ⬜ NEXT | designate buildNbaAiSlips as workstation canonical; **Opus audit required** |
| NBA-3 — Alt line gate | ⬜ BLOCKED on NBA-2 | allow quality alt lines through workstation |
| NBA-4 — Ecology tier layer | ⬜ BLOCKED on NBA-3 | NBA ELITE/STRONG stamps |
| NBA-5 — realismScore rebalance | ⬜ BLOCKED on NBA-4 | 0.70→0.45; requires Opus audit |
| NBA-6 — Eruption environment | ⬜ BLOCKED on NBA-5 | role-spike, blowout-risk, pace detection |
| NBA-7 — First basket ecosystem | ⬜ BLOCKED on NBA-6 | alt market accumulation |

**Repo health: 7.2/10** structural. NBA intelligence health: **2.9/10** (audited). NBA-1 ✅ complete. Primary evolution lever: **NBA-2** (canonical path designation).

---

## PENDING OPERATOR ACTIONS (macOS terminal — DO THESE FIRST)

```bash
cd ~/Desktop/betting-dashboard

# 1. Finalize checkpoint — commits Sessions H–AA
bash scripts/finalizeCheckpoint.sh
# → Report the commit hash

# 2. REQUIRED: Restart TERM 1
#    buildFeaturedPlays.js + buildSlipAi.js both modified (NBA-1 guard)
#    Also: server.js (mutex fix) + workstationRoutes.js (compactor import) from Session Y
#    Ctrl-C the running node process, then:
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

**What was done**: Added snapshotSourced "lotto" guard to `normalizeCandidate()` in both `buildFeaturedPlays.js` and `buildSlipAi.js`. Added explicit `lotto: 0.65` volRealism slot in `scoreCandidate()` (was 0.56 fallthrough, a scoring regression vs aggressive 0.66). Guard: `(raw.snapshotSourced === true && raw.volatility === "lotto") ? "lotto" : classifyVolatility(raw)`. VOLATILITY_RULES NOT modified. MLB untouched.

**What NBA-2 inherits**:
- `buildNbaAiSlips.js` has its own `normalizeCandidate()` — Opus audit must check whether it also overwrites volatility stamps or whether they flow through its pool inputs intact
- The `snapshotSourced: true` sentinel is the critical field — NBA-2 workstation wiring must preserve this on all candidates piped into buildNbaAiSlips
- volRealism lotto slot (0.65) is in buildFeaturedPlays.js only — NBA-2 slip scoring path must be audited separately

**Remaining lotto gap** (NBA-3 scope): base odds dec ~5–9 per leg; 5-leg combo ~22–26 is borderline [20, 1500] gate. Alt lines required for robust lotto seeding.

---

### 🔴 Priority 1 — NBA-2: Designate buildNbaAiSlips as canonical workstation path

**Context from Session Z audit**: Workstation currently uses `buildSlipAi.js` (shared, MLB-calibrated) to regenerate NBA slips from `nba_tracked_bets_*.json` on every request. The 5 NBA-specific slip builders (correlation, aiRange, lane-aware tier gates) run nightly but their output is orphaned — not used for workstation featured plays or anchors.

**Canonical path**: `buildNbaAiSlips.js` (574 lines) — 4 archetypes (SAFE/BALANCED/AGGRESSIVE/LOTTO), aiRange resolution, maxSameGame constraints, elite/strong/opportunity pool inputs from `buildNbaAiPicks.js`.

**Required Opus audit before wiring**:
- Trace `buildNbaAiPicks.js` output shape → confirm it matches `buildNbaAiSlips.js` `{ elite, strong, opportunityBoard }` input
- Trace how workstation currently calls `buildSlipAi.js` in `workstationRoutes.js`
- Confirm `buildNbaAiSlips.js` can receive workstation candidate pool (or nightly snapshot output)
- Identify what currently breaks if `propVariant !== "base"` gate is relaxed for NBA only

**Critical constraint**: Do NOT relax the alt line gate globally. NBA-3 (alt line gate) is a separate phase.

**Model: Opus** — full trace required. This is the highest-impact structural fix.

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

### Priority 9 — NBA-3: Allow quality alt lines through workstation gate

**Prerequisite**: NBA-2 (canonical path) must be complete first.

**Context**: `propVariant !== "base"` gate in workstationRoutes.js kills aiRange resolution entirely. No alt lines → no floor/median/ceiling/lotto leg resolution → BALANCED and AGGRESSIVE slips degrade, LOTTO structurally fails.

**Path**: Add NBA-specific gate bypass: allow `propVariant` ∈ `["alt", "alternate"]` when sport is NBA AND line is within ±1.5 of base line (prevents wide-ladder noise). Validate that MLB base-only gate is unchanged.

**Model: Sonnet** — surgical gate modification only.

---

### Priority 10 — NBA-4: Build NBA Ecology Tier Layer

**Context**: NBA has no equivalent of MLB's ELITE/STRONG stamps from `buildMlbPropClusters.js`. Current workstation path uses compositeScore ranking without tier gates. buildNbaAiPicks.js has `passesEliteTierGate()` and `passesAiPickScoredFloor()` — these need to stamp candidates, not just filter.

**Path**: Add `nbaEcologyStamp(candidate, picks)` in a new `pipeline/nba/buildNbaEcologyTiers.js`. Stamps: ELITE (top 15% by compositeScore + fw + edge), STRONG (next 25%), OPPORTUNITY (rest that pass floor). Feed stamps into `buildNbaAiSlips.collectFullPool()`.

**Model: Sonnet** — additive new file, no existing file modifications except import wiring.

---

### Priority 11 — ARCHITECTURE.md update

Line counts stale, http/ section no longer accurate:
- `server.js` listed as 21,025 — still accurate (mutex fix only removed ~4 lines)
- `workstationRoutes.js` listed as 577 — now 620 (was 721 before Session Y)
- `http/` section no longer lists only 2 files accurately
- `pipeline/shared/` section missing `normalizers.js` and `buildWorkstationCompactors.js`
- `docs/` section missing `NBA_ECOLOGY_AUDIT_2026-05-09.md`

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
| NBA two-path disconnect | Workstation uses buildSlipAi.js (MLB-calibrated). Do NOT wire buildNbaAiSlips without Opus trace of input shape compatibility. |
| realismScore monoculture | Do NOT touch 0.70 weight until NBA-4 ecology tier layer exists. Weight rebalance (NBA-5) requires tier stamps to be in place first. |
| aiRange resolution failure | alt line gate kills floor/median/ceiling. NBA-3 gate bypass must be NBA-specific only. Never relax globally. |
| buildNbaSlipEngine.js | Do NOT modify. Deprecated path. Do NOT inject random improvements. Schedule for removal post-NBA-2. |

---

## WHAT NOT TO DO

- Do NOT increase textureBoost
- Do NOT blindly buff NBA overs — no uniform boosts, no fake star inflation
- Do NOT inject fake ladders — aiRange must be driven by real alt lines in pool
- Do NOT inflate random volatility — lotto requires genuine lotto-odds candidates
- Do NOT modify `VOLATILITY_RULES` for NBA lotto fix — guard only (Path A: snapshotSourced field)
- Do NOT consolidate NBA slip builders without completing NBA-2 Opus audit first
- Do NOT touch `buildNbaSlipEngine.js` — deprecated, schedule removal post-NBA-2
- Do NOT rebalance `realismScore` weight (NBA-5) until NBA-4 ecology tier layer is live
- Do NOT relax `propVariant !== "base"` gate globally — NBA-3 bypass must be NBA-specific
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
| NBA-1: PRA volatility Path A (classifyVolatility audit) | **Opus** |
| NBA-2: Canonical path designation (input shape trace) | **Opus** |
| NBA-5: realismScore weight rebalance (requires NBA-4 live) | **Opus** |
| Root-cause audit on unknown bug | **Opus** |
| NBA-3: Alt line gate bypass (NBA-specific, surgical) | **Sonnet** |
| NBA-4: Ecology tier layer (new file, additive) | **Sonnet** |
| NBA-6: Eruption environment detection | **Sonnet** |
| NBA-7: First basket ecosystem wiring | **Sonnet** |
| Wire steam/book data into daily review | **Sonnet** |
| SQLite migration / Phase S+1 read cutover | **Sonnet** |
| Review frontend panel | **Sonnet** |
| ARCHITECTURE.md update | **Sonnet** |
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

**Session AA: TERM 1 restart: YES** ← required
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
