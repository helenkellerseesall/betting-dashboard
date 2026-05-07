# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-07 (Priority 0 done — buildFeaturedPlays fork resolved; Fix 3 + Fix 4 unblocked)_

---

## CURRENT PROJECT PHASE

**INTEGRITY + DE-RISK — Phase 7D (Fix 1 + Fix 2 + Priority 0 done; Fix 3 + Fix 4 now unblocked)**

Fix 1, Fix 2, and Priority 0 all applied 2026-05-07. One canonical featured-play path confirmed.
Fix 3 (volRealism) and Fix 4 (lotto decimalOddsRange) are now unblocked.

---

## LAST SUCCESSFUL STATE

Session completed 2026-05-07. Fix 1 + Fix 2 applied, syntax-checked, smoke-tested, docs updated.

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

### SQLite Phase 1 — COMPLETE (storage layer; backfill pending)

**ACTION REQUIRED on next TERM 2 session:**
```
rm .git/index.lock   (if lock file exists from sandbox git ops)
git add -A && git commit -m "Ecology Fix 1 + Fix 2: diversity sort cap + aggressive volatile seeding"
node backend/storage/importHistoricalData.js   (macOS native fs required)
```

---

## IMMEDIATE NEXT PRIORITIES

### 🟡 Ecology Fix 3 — Raise lotto/aggressive volRealism *(NOW UNBLOCKED)*

**File:** `backend/pipeline/shared/buildFeaturedPlays.js` ~line 226

```js
// BEFORE
f.volRealism = c.volatility === "safe"       ? 0.80 :
               c.volatility === "balanced"   ? 0.74 :
               c.volatility === "aggressive" ? 0.63 :
               0.46   // lotto

// AFTER
f.volRealism = c.volatility === "safe"       ? 0.80 :
               c.volatility === "balanced"   ? 0.74 :
               c.volatility === "aggressive" ? 0.66 :
               0.56   // lotto
```

Narrows the lotto penalty so textureBoost (+0.030) can actually compensate for it.
Current gap (balanced-lotto) = 0.028 weighted. With fix: 0.018 weighted.
Combined with Fix 1, lotto-volatility offensive edges can now naturally compete in
tonightsBest and smartAggression when edge justifies it.

TERM 1 restart: YES
TERM 2 verification: lotto entries should appear more often in tonightsBest / smartAggression.
WARNING: verify textureBoost calibration still holds after this change — it was calibrated vs old gap.

### 🟡 Ecology Fix 4 — Widen lotto decimalOddsRange *(LOW-MEDIUM VALUE)*

**File:** `backend/pipeline/shared/buildSlipAi.js` `TIER_TEMPLATES.lotto`

```js
// BEFORE
decimalOddsRange: [25.0, 800.0],

// AFTER
decimalOddsRange: [20.0, 1500.0],
```

Current range allows 63 valid 4-leg combinations from the lotto pool.
New range allows 393 (6× more). Allows lotto to reliably fill maxPerTier=4.

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

### Priority 5 — NBA scoring ecology audit

Apply same lens as MLB audit:
- `edge × modelProb` compounding in NBA tracked_bets
- Tier distribution by side (ELITE/STRONG under-assigned on NBA too?)
- volRealism gaps across NBA stat families
Model: Opus — root cause audit first

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
| Fix 4 lotto range: invalid combo explosion | 393 combos well within feasible range |
| Premium-edge override admits clown plays into safe slips | Three gates: 12% edge AND 50% modelProb AND maxOdds 150 |
| Cache (60s TTL) serving stale results | Wait for expiry; TERM 2 restart if needed |

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
| CP3 | `buildFeaturedPlays.js` volRealism | lotto=0.46; textureBoost (+0.030) can't cover the gap | **PENDING** |
| CP4 | `enrichBestEntry` ID match | tracked_best has no eventId → zero tier boosts | **PENDING** |
| CP5 | `TIER_TEMPLATES.lotto.decimalOddsRange` | [25, 800] → only 63 valid 4-leg combos | **PENDING** |
| CP6 | tracked_best upstream data | No eventId/matchup → game correlation blind | **Data quality** |

---

## CALIBRATION DIRECTION (cumulative)

| Lever | Status |
|---|---|
| Side balance in featured buckets | Capped at 60% (anchors 55%) |
| Stat concentration | maxPerStat:10 / maxPerStatSide:6 |
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
| Lotto volRealism | **PENDING FIX** — 0.46 too low, textureBoost can't compensate |
| Lotto decimalOddsRange | **PENDING FIX** — [25,800] caps 4-leg combos at +400-500 odds |

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
| `backend/pipeline/shared/buildCandidateDiversity.js` | **Fix 1 applied 2026-05-07** |
| `backend/pipeline/shared/buildSlipAi.js` | **Fix 2 applied 2026-05-07** |
| `backend/server.js` | **Priority 0: dead import removed 2026-05-07** |
| `backend/pipeline/boards/buildFeaturedPlays.js` | **Orphaned — needs manual `rm` from macOS terminal** |
