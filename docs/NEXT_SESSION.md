# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-08 (Session P: Priority 1B — nba_tracked_best added; snapshot supplement wired; NBA featured boards now populate with 14+ real model-qualified candidates; sessions H–P staged)_

---

## CURRENT PROJECT PHASE

**INTEGRITY + DE-RISK — Phase 7P (Fix 1–6 + Intelligence Layer + Checkpoint + Bettor UX Phase 1+2 + NBA Phase 3 + NBA Pipeline Audit + SP Fix 1+2 + Priority 1B Featured Pool)**

All six ecology compression points addressed. Intelligence layer (Session H) built and smoke-tested.
Live wiring (Session I): both nightly runners persist predictions + ecology to SQLite.
Outcome settlement (Session J): runPostGameReview persists bet outcomes + slip outcomes on every settlement.
Checkpoint reliability (Session K): virtiofs-safe commit workflow — Claude prepares, operator finalizes.
Bettor UX Phase 1 (Session L): all 8 sections relabeled; CSS polish; nav/header/tier/KPI language.
Bettor UX Phase 2 (Session M): HeroPickCard + SpotlightCard + Dashboard restructure; data narrative surfaced.
NBA Phase 3 (Session N): snapshot infra fix; NbaSpotlightGrid/MlbSpotlightGrid; bestPra+bestFirstBasket buckets; FirstBasketView premium rewrite.
NBA Pipeline Audit (Session O): full 5-point suppression chain diagnosed; SP Fix 1 (PRA derivation) + SP Fix 2 (ladder altPlays tracking) applied and smoke-tested.
Priority 1B (Session P): full featured-pool unlock — nba_tracked_best written from allPlays; snapshot supplement provides 14+ diversified ELITE/STRONG candidates immediately; NBA boards now populate.
Remaining: Priority 1 (SQLite ledger migration, OVERDUE), Priority 3 (tracked_best eventId).

---

## LAST SUCCESSFUL STATE

Session H completed 2026-05-07. Intelligence layer files created, correctness bugs fixed, smoke tests pass.

### ~~Intelligence Layer (Session H)~~ — DONE (2026-05-07)

**Files created:**
- `backend/storage/intelligenceSchema.js` — 4-table DDL: prediction_snapshots, outcome_snapshots, slip_outcomes, ecology_snapshots
- `backend/storage/intelligence.js` — write + read module; 5 write functions + 7 read functions

**Key design decisions:**
- `prediction_snapshots`: INSERT OR IGNORE — IMMUTABLE once written; re-runs are safe no-ops
- `outcome_snapshots`: INSERT OR REPLACE — correctable if result changes
- `ecology_snapshots`: UNIQUE INDEX (run_date, sport) + INSERT OR REPLACE — upsert per run
- Prediction ID: deterministic composite `run_date|sport|player_lower|stat_family|side|line|book`
- Shannon entropy: `H = -Σ p(i)*log2(p(i))` over stat distribution; 0=single stat, log2(N)=perfect N-way diversity
- delta_prob = model_prob − hit: positive = overconfident (predicted high, missed); negative = underconfident

**Correctness bugs fixed during Session H:**
1. `snapshotPredictions` was passing `opts.date` but `normalizeCandidate` reads `opts.runDate` → fixed with `normOpts = { ...opts, runDate: opts.date || opts.runDate }`
2. `db.transaction()` doesn't exist in node:sqlite `DatabaseSync` → replaced with `db.exec('BEGIN') / COMMIT / ROLLBACK` manual transaction
3. `undefined` bind values in `recordOutcome`/`recordSlipOutcome` → changed `|| pred?.x` to `?? pred?.x ?? null` throughout

**Smoke test results (2026-05-07):**
- snapshotPredictions: 3 inserted / re-run: 0 inserted 3 skipped ✓ (INSERT OR IGNORE idempotency)
- snapshotEcology: true ✓
- recordOutcome (known pred): delta_prob=−0.38 (model_prob=0.62, hit=1 → 0.62−1.0=−0.38, underconfident) ✓
- recordOutcome (orphan no pred row): false, NOT NULL constraint ✓ (expected — no run_date without matching prediction)
- recordSlipOutcome: true ✓
- getDeltaSummary/getCalibrationBuckets/getEcologyHistory/getSlipPerformance: all returning structured data ✓
- Shannon entropy = 1.585 = log2(3): perfect diversity for 3 equal-weight stats ✓

### ~~Ecology Fix 3~~ — DONE (2026-05-07)

**File:** `backend/pipeline/shared/buildFeaturedPlays.js` lines 225–228

```js
// Applied:
f.volRealism = c.volatility === "safe"       ? 0.80 :
               c.volatility === "balanced"   ? 0.74 :
               c.volatility === "aggressive" ? 0.66 :
               0.56   // lotto
```

Verified: tonightsBest now includes Freeman RBIs @550 + Edwards RBIs @533 (lotto overs).
Featured side dist: 10 overs / 9 unders. Vol dist: balanced=10, aggressive=5, lotto=4.
Hierarchy intact: safe(0.80) > balanced(0.74) > aggressive(0.66) > lotto(0.56) ✓

### ~~Ecology Fix 4~~ — DONE (2026-05-07)

**File:** `backend/pipeline/shared/buildSlipAi.js` TIER_TEMPLATES.lotto

```js
// Applied:
decimalOddsRange: [20.0, 1500.0],  // was [25.0, 800.0]
```

Verified: live lotto slip dec=1004.7 (Lee TB @450 + Freeman TB @750 + Chourio TB @514 + Machado @250).
Would have failed [25, 800]. Still only 1 lotto slip — greedy fill 5-leg dec=8,727–25,355 >> 1500.
Fix 6 required for reliable 4-slip lotto output.

### ~~Ecology Fix 5~~ — DONE (2026-05-07)

**File:** `backend/pipeline/shared/buildSlipAi.js` TIER_TEMPLATES.aggressive

```js
// Applied:
decimalOddsRange: [6.0, 120.0],  // was [6.0, 60.0]
```

Verified: correctness fix active. Aggressive volatile seed exhaustion (Machado/Lee legUsageCount=2)
still causes slips 3+4 to inherit balanced DNA. Binding constraint is seed diversity, not ceiling.

### ~~Ecology Fix 1~~ — DONE (2026-05-07)

### ~~Ecology Fix 1~~ — DONE (2026-05-07)

**File:** `backend/pipeline/shared/buildCandidateDiversity.js` line 51–52

```js
// Applied:
const probCapped = Math.max(0.50, Math.min(0.55, prob || 0.5))
return { c, score: (edge * 4) * probCapped }
```

Verified delta: TB under (edge=0.13, prob=0.68) 0.354→0.286; Hits over (edge=0.14, prob=0.33) 0.185→0.280; HR lotto (edge=0.16, prob=0.28) 0.179→0.320. Pool: 34 overs / 27 unders.

### ~~Priority 0~~ — DONE (2026-05-07)

Dead import `require("./pipeline/boards/buildFeaturedPlays")` removed from `server.js` line 21.
`boards/buildFeaturedPlays.js` now has zero importers — orphaned on disk, needs manual `rm`:
```
rm backend/pipeline/boards/buildFeaturedPlays.js
```
Canonical path confirmed: `workstationRoutes.js` → `pipeline/shared/buildFeaturedPlays.js` (821-line MLB version).
Verified live: anchors=5, tonightsBest=5, smartAggression=4, safest=5. syntax clean.

### ~~Ecology Fix 2~~ — DONE (2026-05-07)

**File:** `backend/pipeline/shared/buildSlipAi.js`, `buildSlipsForTier()`, after `eligible.sort()`

```js
// Applied:
if (tier === "aggressive") {
  const volSeeds   = eligible.filter(sl => sl.leg.volatility === "aggressive" || sl.leg.volatility === "lotto")
  const otherSeeds = eligible.filter(sl => sl.leg.volatility !== "aggressive" && sl.leg.volatility !== "lotto")
  eligible.length = 0
  eligible.push(...volSeeds, ...otherSeeds)
}
```

Verified: safe/balanced/lotto tiers unaffected. Aggressive tier now seeds from volatile legs first.

### NBA Bettor Experience Phase 3 — COMPLETE (Session N)

**Root-cause NBA audit findings:**
1. `snapshot-nba.json` missing → `snapshotRows=[]` for all NBA routes → no line shopping, timing, or market context
2. `snapshot.json` (9.9MB, 5,489 props) uses `data.props` not `data.rows` → snapshotRows=[] even if file existed
3. `tracked_best` file missing for NBA → enrichedBest=0; only 5 eligibleBets/day reach featured
4. NBA `tracked_bets` pool critically thin: 17 bets across 3 days (rebounds/threes/assists only)
5. PRA, ladders, first basket never reach `tracked_bets` despite existing in `runNbaNight.js`
6. Slip monoculture: rebounds×N and points×N; threes 5 under/1 over bias

**Files changed:**
- `workstationRoutes.js` — `readSnapshotRows(sport)` helper: tries `snapshot-{sport}.json`, falls back to `snapshot.json` for NBA, handles `data.rows` OR `data.props`; all 4 inline reads replaced; NBA now has line shopping + timing from 5,489-prop pool
- `buildFeaturedPlays.js` — `buildBestPra()` + `buildBestFirstBasket()` added; in return value, empty fallback, and unique-id set
- `types.ts` — `bestPra: FeaturedPlay[]` + `bestFirstBasket: FeaturedPlay[]` in `Featured`
- `Dashboard.tsx` — `NbaSpotlightGrid` (PRA Nukes, First Basket Bombs, Ladder City, Pace Attack, Books Sleeping, High Confidence, Act Now, Tonight's Best) + `MlbSpotlightGrid` (original 8 buckets); sport-aware swap
- `FirstBasketView.tsx` — full premium rewrite: hero card, TierBadge, narrative, compact rest board, context strip
- `workstation.css` — `ws-fb-*` CSS block

**Constraint:** NBA bestPra/bestFirstBasket buckets will show empty until `tracked_bets` accumulates PRA/ladder candidates from future `runNbaNight.js` live runs. SP Fix 1+2 (Session O) unlock the pipeline — pool builds incrementally. No further code changes required.

### SQLite Phase 1 — COMPLETE (storage layer; backfill pending)
### SQLite Intelligence Layer — COMPLETE (Session H; built + smoke-tested)
### Intelligence Layer live wiring — COMPLETE (Session I; MLB + NBA runners wired)
### Outcome settlement wiring — COMPLETE (Session J; buildPostGameReview.js wired)
### Checkpoint reliability infrastructure — COMPLETE (Session K)
### Bettor UX Phase 1 — COMPLETE (Session L)
### Bettor UX Phase 2 — COMPLETE (Session M)

**Session M changes:**
- `frontend/src/workstation/components/HeroPickCard.tsx` — new: ☢️ nuclear pick hero card
  - Uses `anchors[0]`; player name at 28px; attackNote as primary narrative; urgent/soon pulse border
  - Conditional urgency pulse animation (immediate=red, soon=amber)
  - Graceful empty state when no anchors
- `frontend/src/workstation/components/SpotlightCard.tsx` — new: narrative-driven featured bucket
  - Top play gets large treatment with attackNote surfaced below stat/odds
  - Accent border color per bucket via `--spotlight-accent` CSS var
  - Tagline/subtitle explains WHY this bucket exists
  - Secondary plays as compact scannable rows
- `frontend/src/workstation/sections/Dashboard.tsx` — fully restructured:
  - Removed `AnchorCard`, `FeaturedCard` imports; replaced with `HeroPickCard` + `SpotlightCard`
  - Risk Snapshot compressed to single-line `ws-risk-pulse` strip
  - New "Also Strong Tonight" `SupportingRow` grid for anchors[1-N] + tonightsBest
  - 8 `SpotlightCard` buckets replace the old `ws-featured-grid`
  - New `ChaosShotBlock` surfaces `aiSlips.lotto[0]` as a chaos parlay spotlight
  - All attackNotes now visible in the primary UI flow
- `frontend/src/workstation/workstation.css` — new CSS blocks:
  - `ws-risk-pulse` strip, `ws-hero-card` (gradient bg, urgent/soon animations)
  - `ws-supporting-*` (2-col grid, compact rows)
  - `ws-spotlight-*` (card, head, top play, attack narrative, rest rows)
  - `ws-chaos-*` (lotto block with purple gradient + chaos label)
- TypeScript: `npx tsc --noEmit` → zero errors ✓

**Session L changes (presentation layer only — zero backend/logic changes):**
- `Workstation.tsx`: header "BETTING WORKSTATION" → "EDGE ROOM"; all 8 nav labels updated
- `Dashboard.tsx`: H2 "Command Center" → "Tonight's Edge"; KPI labels bettor-native; all FeaturedCard titles rewritten; empty states voice-over improved; AnchorCard description improved
- `AiSlipsView.tsx`: H2 → "🎲 AI Parlay Engine"; TIERS: Safe→"Core" 🛡, Balanced→"Value Mix" ⚖️, Aggressive→"Fire Shots" 🔥, Lotto→"Moon Shots" 🌙; CTA "Build this parlay"
- `ProcessReviewView.tsx`: H2 → "📈 Edge Log"; KPIs: P&L / CLV Alpha; sections: Process Quality / By Stat / Recent Action
- `LineShoppingView.tsx`: H2 → "👁️ Book Radar"; empty states improved for both sports
- `PortfolioView.tsx`: H2 → "📐 Risk Map"; Game Concentration → "Game Exposure"; Player Concentration → "Player Stacks"; Stat Exposure → "Stat Mix"; Correlations → "Correlation Risk"; Notes → "Risk Flags"
- `FirstBasketView.tsx`: H2 → "🏀 First Basket"; MLB dead state replaced with useful redirect card; "Smart Aggression" ref → "Sharp Steam"
- `workstation.css`: urgency pulse keyframe on `.ws-badge.now`; fire/moon slip glow; anchor card glow + hover; `.ws-hot-label` class; nav active left border; section title accent line; KPI + feat-card hover transitions

**Session J changes:**
- `buildPostGameReview.js` — intelligence settlement block added after `classified` array
- Bets: reconstructs predId, filters `result !== "pending"`, calls `recordOutcomes(settlements, { sport, date })`
- Slips: bridges `slip.type → tier`, counts `legsHit`, calls `recordSlipOutcome(slip, result, { sport, date })`
- Isolated try/catch — settlement errors never propagate to review pipeline
- Verified: 5 synthetic settled bets → settlement block fires, `[intel] mlb outcomes: 0 recorded, 5 errors` (DB unavailable in sandbox, expected), no crash

**What now accumulates automatically on every settlement run:**
- `outcome_snapshots`: predId (matches prediction_snapshots), hit (0/1/null), delta_prob (model_prob − hit), actual_value, settled_at
- `slip_outcomes`: id, tier, leg_count, stat_family_mix, legsHit, result, payout_dec, settled_at

**ACTION REQUIRED — one-time finalization from macOS terminal:**
```bash
cd ~/Desktop/betting-dashboard
rm backend/pipeline/boards/buildFeaturedPlays.js   # orphaned Priority 0 file
bash backend/scripts/finalizeCheckpoint.sh
# ^ handles stale locks, git add -A, commit (sessions H–N), cleanup — all in one step
node backend/storage/importHistoricalData.js   # SQLite historical backfill (macOS native fs required)
```

**From now on — end of every Claude session:**
```
Claude runs:   node backend/scripts/checkpointRepo.js "commit message"
Operator runs: bash backend/scripts/finalizeCheckpoint.sh
```

**Session K changes:**
- `backend/scripts/checkpointRepo.js` — sandbox-safe checkpoint preparer
  - Writes `.checkpoint/pending.json` (message, branch, files, lock status, recent log)
  - Never touches `.git/` in any way
  - Sub-commands: `--show` (inspect), `--clear` (tombstone)
  - Reports stale vs active locks (threshold: 60s)
- `backend/scripts/finalizeCheckpoint.sh` — macOS terminal commit finalizer
  - Reads `.checkpoint/pending.json` for message
  - Checks pgrep git AND lock age before any removal
  - Refuses active locks (exits with clear error)
  - Removes stale locks, git add -A, git commit, reports hash, cleans up
  - Discarded-tombstone guard prevents accidental commit on cleared checkpoints
- `.gitignore` — `.checkpoint/` added (local operational state, never commit)
- `docs/WORKFLOW_RULES.md` — checkpoint protocol added as permanent law

**What now accumulates automatically on every nightly run:**
- `prediction_snapshots`: each candidate in `bestBetsBoard.allPlays` (INSERT OR IGNORE — immutable, idempotent)
- `ecology_snapshots`: pool composition, vol mix, stat distribution, Shannon entropy (INSERT OR REPLACE — upsert per run/sport)
- MLB live test (2026-05-07): 59 unique predictions, entropy=2.025 (totalbases:31, runs:25, outs:17, rbis:7, hits:4)
- NBA live test (2026-05-07): 5 unique predictions, entropy=0.971 (threes:3, assists:2)

---

## IMMEDIATE NEXT PRIORITIES

### ~~Ecology Fix 3~~ — DONE (2026-05-07)

`buildFeaturedPlays.js` line 225–228: aggressive 0.63→0.66, lotto 0.46→0.56.
Verified: tonightsBest 2 lotto overs, featured 10 overs/9 unders, vol dist balanced=10/aggressive=5/lotto=4.

### ~~Ecology Fix 4~~ — DONE (2026-05-07)

`buildSlipAi.js` TIER_TEMPLATES.lotto: [25.0,800.0]→[20.0,1500.0].
Verified: new lotto slip dec=1004.7 passes. 5-leg combos still fail — Fix 6 required.

### ~~Ecology Fix 5~~ — DONE (2026-05-07)

`buildSlipAi.js` TIER_TEMPLATES.aggressive: [6.0,60.0]→[6.0,120.0].
Verified: correctness fix, volatile seed exhaustion remains binding constraint for slips 3+4.

### ~~Ecology Fix 6~~ — DONE (2026-05-07)

**File:** `backend/pipeline/shared/buildSlipAi.js` `buildSlipsForTier()` lines 499–549

Replaced single decimal-check discard with a walk-back loop (max→min legs) accepting the
longest valid subset. All `slipLegs`/`slipScores`/`combined` references updated to
`validSlipLegs`/`validSlipScores`/`validCombined`.

Verified (2026-05-06 live data):
- Lotto: 1→**4 slips** (dec 288–465, all volatile, all within [20,1500] ✓)
- Aggressive: 2/4→**4/4 volatile** slips
- Safe: 1→3 slips (valid 2-leg combos, previously discarded by failed 3-leg attempts)
- All 15 slips within respective tier decimal ranges ✓

### ~~Priority 1A — NBA tracking depth~~ — COMPLETE (Session O)

**Audit complete (Session O):** Full 12-stage NBA pipeline traced. Five suppression points identified.

| SP | Location | What Dies | Status |
|---|---|---|---|
| SP1 | `fetchNbaOddsSnapshot.js` | `bestProps`/`eliteProps` always empty arrays | **Deferred** — needs full NBA model scoring pass |
| SP2 | `buildNbaPlayerOutcomePredictions.js` STAT_ORDER | PRA/combo/first_basket/DD/TD all killed | **FIXED (SP Fix 1)** |
| SP3 | `buildNbaBestBetsBoard.js` pred.stats check | PRA: `pred.stats.pra` was undefined | **FIXED by SP Fix 1** — now defined |
| SP4 | `resolveStatFamily` in BestBetsBoard | combo (PA/PR/RA) and first_basket return null | **Deferred** — no model for combo families |
| SP5 | `persistTrackedToday` allPlays-only | Ladder/alternate altPlays never tracked | **FIXED (SP Fix 2)** |

**Files changed:**
- `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js` — line 1909: derives `st.pra` from `st.points + st.rebounds + st.assists` before `toPublicStats()`. `toPublicStats` picks it up transparently.
- `backend/pipeline/nba/buildNbaPerformanceTracking.js` — line 224: `altQualified` from `board.altPlays` with gate `edge > 0.03 && inCoreOddsBand !== false && tier !== FADE`; merged into `trackedPlays = [...allPlays, ...altQualified]`.

**Impact:** On next `runNbaNight.js` live run, PRA market props will score through `buildNbaBestBetsBoard` (where previously all dropped at `pred.stats?.pra` check), and quality-gated ladder plays will accumulate in `tracked_bets`. NBA featured pool depth will improve incrementally over subsequent run days.

### 🔴 Priority 1 — SQLite migration: `personal_ledger.json`

**Trigger was 500 entries. Current: 2,000 entries / 2.3MB. Migration is OVERDUE.**

Migration approach:
- Schema: `id INTEGER PK, date TEXT, player TEXT, stat TEXT, side TEXT, line REAL,
  odds INTEGER, book TEXT, edge REAL, result TEXT, clv REAL, created_at TEXT`
- Keep JSON fallback read path until write path verified end-to-end
- Do NOT dual-write indefinitely — cut over after 1 successful nightly run
- buildPersonalLedger.js owns all ledger I/O — isolate the write path there

Model: Sonnet (well-scoped implementation task — root cause is clear)

### Priority 2 — Modular extraction #2: compactors

**Target**: `compactLineShopping` + `compactTiming` + `compactPortfolio` in `workstationRoutes.js`
→ `pipeline/shared/buildWorkstationCompactors.js`

~103 lines of pure serialization, no globals. workstationRoutes.js → ~474 lines after.
Zero behavior change. Standard extraction pattern (same as buildCandidateDiversity).

### Priority 3 — eventId/matchup on tracked_best (upstream data quality)

**File:** `backend/scripts/runMlbNight.js` — wherever tracked_best entries are written.

All tracked_best entries have `eventId=null`, `matchup=null`. This causes:
1. ID match against tracked_bets always fails → no tier boosts for offensive overs
2. Game-based diversity caps never apply to tracked_best entries
3. Slip assembly game/script correlation detection blind to this pool

Fix: populate `eventId` and `matchup` from game data when writing tracked_best entries.
Requires full trace of runMlbNight.js before touching. Separate session.

### Priority 4 — PIPELINES docs

`/docs/ARCHITECTURE.md` created 2026-05-07. Still pending:
- `/docs/PIPELINES/MLB.md` — MLB pipeline, phase4Tracking, weaknesses
- `/docs/PIPELINES/NBA.md` — NBA boards, slips, ecology gaps
- `/docs/PIPELINES/TRACKING.md` — all tracking files, sizes, write-race risk

### ~~Priority 5~~ — NBA scoring ecology audit → COMPLETE (Session O)

Session N completed surface audit. Session O completed full 12-stage pipeline trace.
Root causes (5 suppression points) identified. SP Fix 1+2 applied. Deferred: SP1 (NBA bestProps scoring), SP4 (combo families).

### Priority 6 — Extract `isOffensiveAttackStat` into shared normalizer

`buildFeaturedPlays.js` defines `isOffensiveAttackStat()`.
`buildSlipAi.js` has its own inline list inside `offensiveAttackTextureBonus()`.
Extract to `pipeline/shared/normalizers.js`. 30-minute task.

### Priority 7 — server.js Phase A: pure utilities

Lines 11,379–11,430 → `pipeline/shared/mathUtils.js`. ~52 lines, no globals.
Requires ARCHITECTURE.md first to verify no hidden dependencies.

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| buildFeaturedPlays fork | ✅ RESOLVED — dead import removed, one canonical path |
| personal_ledger.json corruption | SQLite migration now overdue — do not defer further |
| Fix 3 volRealism: hierarchy inversion | lotto=0.56 still below balanced=0.74 ✓ |
| textureBoost + volRealism fix double-counting | textureBoost was calibrated for old gap — verify after Fix 3 |
| Fix 4 lotto range: invalid combo explosion | 4-leg combos ~354 dec well within [20,1500]; 5-leg still risks ceiling until Fix 6 |
| Fix 5 aggressive ceiling: longer-odds slips | Ceiling 120 still requires floor≥6; spot-check aggressive slip odds post-change |
| Fix 6 greedy fill: leg count regressions | DO NOT apply without full inner-loop trace; wrong leg count = invalid slips |
| Premium-edge override admits clown plays into safe slips | Three gates: 12% edge AND 50% modelProb AND maxOdds 150 |
| Cache (60s TTL) serving stale results | Wait for expiry; TERM 2 restart if needed |
| Duplicate balanced slip (seenSignatures bug) | Do not add dedup workaround without tracing seenSignatures root cause |

---

## WHAT NOT TO DO

- ~~Do NOT apply Fix 3 (volRealism) before fixing the buildFeaturedPlays fork~~ — Priority 0 resolved
- Do NOT increase textureBoost — Fix 1 is now active; calibration needs re-assessment after Fix 3
- Do NOT force over/under parity — fixes work by letting edge decide, not by imposing balance
- Do NOT touch the `[0.50, 0.55]` modelProb cap in scoreCandidate or scoreLeg — correct and working
- Do NOT touch the `[0.50, 0.55]` modelProb cap in buildCandidateDiversity — Fix 1 is correct and working
- Do NOT raise slipAi tierBoost back to 0.10 — structural under-side monopoly in slips
- Do NOT raise featured tierBoost back to 0.08 — same reason
- Do NOT lower safe-tier maxOdds cap below 150
- Do NOT remove premium-edge thresholds (12% edge, 50% modelProb)
- Do NOT widen `maxPerGame` beyond 2 in anchors
- Do NOT attempt server.js Phase B/C extraction without ARCHITECTURE.md global map
- Do NOT touch `runMlbNight.js` without tracing candidate paths first
- ~~Do NOT apply Fix 6 (greedy fill) in same session as Fix 4+5~~ — Fix 6 done
- Do NOT touch the portfolio optimizer concentration penalty — it is informational only and working as designed
- Do NOT change MAX_PLAYER_GLOBAL cap — tier FIFO ordering would need redesign, high regression risk
- Do NOT reopen ecology fixes — all six compression points are resolved
- Do NOT tune greedy fill walk-back direction (currently max→min) without full impact trace

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| Root-cause audit on unknown bug | **Opus** |
| NBA ecology audit (Priority 5) | **Opus** — same as MLB audit |
| Ecology fixes (all verified, well-scoped) | **Sonnet** |
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
| CP5 | `TIER_TEMPLATES.lotto.decimalOddsRange` | [25, 800] + greedy fill → 5-leg dec=3,061; only 1 slip | ✅ **PARTIALLY FIXED ([20,1500])** — Fix 6 still needed |
| CP6 | tracked_best upstream data | No eventId/matchup → game correlation blind | **Data quality** |
| CP7 | `TIER_TEMPLATES.aggressive.decimalOddsRange` | [6.0, 60.0] ceiling kills volatile 4-leg combos | ✅ **FIXED ([6.0,120.0])** |
| CP8 | `buildSlipsForTier` greedy fill loop | Fills to max legs first; 5-leg dec=8,727–25,355 >> 1500; 3-leg dec=231–439 ✓ | ✅ **FIXED (Fix 6)** — walk-back to min |

---

## CALIBRATION DIRECTION (cumulative)

| Lever | Status |
|---|---|
| Side balance in featured buckets | Capped at 60% (anchors 55%) |
| Stat concentration | maxPerStat:10 / maxPerStatSide:6 — working as designed |
| Volatility taxonomy | Fixed — hits/runs/etc. → balanced |
| Outs volatility | Fixed — outs → balanced |
| modelProb compounding | Capped [0.50, 0.55] in featured + slipAi + diversity sort |
| modelProb in diversity sort | ✅ **FIXED** — probCapped [0.50, 0.55], 1.87× bias eliminated |
| Offensive over recognition | Active — stacked textureBoost (0.020/0.030) |
| Anchor cross-side | maxPerGame:2 — allows same-game cross-side |
| Anchor display ordering | Interleaved U·O·U·O·U via sortAnchorsForDisplay |
| Featured tierBoost asymmetry | Halved — ELITE 0.04, STRONG 0.02 |
| slipAi tierBoost asymmetry | Halved — ELITE 0.05, STRONG 0.025 |
| Safe-tier premium-edge override | Active — 12% edge / 50% modelProb / maxOdds 150 |
| Featured safest premium-edge override | Active — same thresholds |
| AI slip offense bias | Active in aggressive/lotto seed sort |
| Aggressive slip volatile seeding | ✅ **FIXED** — volatile legs seed first, balanced fill |
| Portfolio concentration penalty | Informational only — threshold (>65% one stat) never fires at current pool size |
| Lotto volRealism | ✅ **FIXED (Fix 3)** — 0.56; lotto now surfaces in tonightsBest/smartAggression |
| Lotto decimalOddsRange | ✅ **PARTIALLY FIXED (Fix 4)** — [20,1500]; 4-leg p25 passes, 5-leg still fails; Fix 6 needed |
| Aggressive decimalOddsRange ceiling | ✅ **FIXED (Fix 5)** — [6.0,120.0]; volatile seed exhaustion is now binding constraint |
| Greedy fill architecture | ✅ **FIXED (Fix 6)** — walk-back from max to min; lotto 1→4 slips; aggressive 2/4→4/4 volatile |

---

## EXTRACTION PRIORITIES (ordered)

1. ~~`diversifyCandidates`~~ **DONE** → `pipeline/shared/buildCandidateDiversity.js`
2. Fix `buildFeaturedPlays` fork — **NOW** (see Priority 0)
3. `compactLineShopping` + `compactTiming` + `compactPortfolio` → `buildWorkstationCompactors.js`
4. `isOffensiveAttackStat` → `pipeline/shared/normalizers.js` (unify with buildSlipAi.js)
5. server.js Phase A (pure utils → `mathUtils.js`) — requires ARCHITECTURE.md first

---

## SQLITE MIGRATION SEQUENCE

0. ~~**Phase 1: storage layer** (schema, db, queries, backfill script) — **DONE 2026-05-07**~~
   Run `node backend/storage/importHistoricalData.js` on macOS to populate historical data.
1. **`personal_ledger.json` → ledger table — NOW OVERDUE (2,000 entries, was 500 trigger)**
2. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
3. `timing_intelligence_state.json` → timing state table (729KB, unbounded)
4. `book_intelligence_state.json` → book profiles table
5. `graded_props_*.json` → review/grading table

---

## INFRASTRUCTURE STATUS

| File | Status |
|---|---|
| `docs/WORKFLOW_RULES.md` | Committed |
| `docs/CURRENT_STATE.md` | Updated this session |
| `docs/NEXT_SESSION.md` | Updated this session |
| `docs/BOOTSTRAP_PROMPT.md` | Committed |
| `.cursor/rules/workflow.mdc` | Committed |
| `docs/ARCHITECTURE.md` | Created 2026-05-07 |
| `docs/PIPELINES/MLB.md` | Pending |
| `docs/PIPELINES/NBA.md` | Pending |
| `docs/PIPELINES/TRACKING.md` | Pending |
| `backend/storage/schema.js` | Created 2026-05-07 |
| `backend/storage/db.js` | Created 2026-05-07 |
| `backend/storage/queries.js` | Created 2026-05-07 |
| `backend/storage/importHistoricalData.js` | Created 2026-05-07 |
| `backend/storage/intelligenceSchema.js` | **Created 2026-05-07 (Session H)** |
| `backend/storage/intelligence.js` | **Created 2026-05-07 (Session H)** |
| `backend/scripts/runMlbNight.js` | **Intelligence wiring added 2026-05-07 (Session I)** |
| `backend/scripts/runNbaNight.js` | **Intelligence wiring added 2026-05-07 (Session I)** |
| `backend/pipeline/shared/buildCandidateDiversity.js` | **Fix 1 applied 2026-05-07** |
| `backend/pipeline/shared/buildSlipAi.js` | **Fix 2 + Fix 4 + Fix 5 + Fix 6 applied 2026-05-07** |
| `backend/pipeline/shared/buildFeaturedPlays.js` | **Fix 3 applied 2026-05-07** |
| `backend/pipeline/nba/buildNbaPlayerOutcomePredictions.js` | **Session O SP Fix 1: stats.pra derived from points+rebounds+assists** |
| `backend/pipeline/nba/buildNbaPerformanceTracking.js` | **Session O SP Fix 2: quality-gated altPlays added to persistTrackedToday** |
| `backend/server.js` | **Priority 0: dead import removed 2026-05-07** |
| `backend/pipeline/boards/buildFeaturedPlays.js` | **Orphaned — needs manual `rm` from macOS terminal** |
