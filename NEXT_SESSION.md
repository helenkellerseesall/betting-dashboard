# NEXT SESSION
**Exact operational resumption state. Overwrite every session. Never append.**
_Last updated: 2026-05-07 (ARCHITECTURE.md created — documentation pass)_

---

## CURRENT PROJECT PHASE

**INTEGRITY + DE-RISK — Phase 7 (pre-requisite infrastructure before returning to daily curation)**

The scoring ecology is correct. Trust-qualification gates are working.
A repo-scale audit (2026-05-07) identified three blocking issues that must be resolved
before further calibration work is safe and reliable:
1. Active `buildFeaturedPlays` fork — scoring fixes only apply on workstation path, not server.js
2. `personal_ledger.json` 4× past SQLite migration trigger — data integrity risk
3. `ARCHITECTURE.md` missing — server.js is too large to work on safely without it

---

## LAST SUCCESSFUL STATE

Session completed 2026-05-06 (overnight). All patches verified clean (`node --check`).

### Patches applied this session (trust-qualification audit):

1. **`buildSlipAi.js`** — `scoreLeg.tierBoost` halved:
   - ELITE: 0.10 → 0.05
   - STRONG: 0.05 → 0.025
   - Root cause: same modelProb-driven tier-assignment under-bias the featured layer had.
     ELITE/STRONG tiers are 100% under-assigned on MLB slates; full +0.10 phantom-promoted
     low-edge unders above higher-edge overs in slip composite ranking.

2. **`buildSlipAi.js`** — safe-tier eligibility premium-edge override:
   - Legs with `modelProb >= 0.50 AND edge >= 0.12` bypass the standard `allowedVolatility`
     list (`["safe","balanced"]`) AND the `minModelProb: 0.55` gate.
   - `maxOdds: 150` cap **still applies** — preserves safe identity, prevents +220 plays.
   - Without this override, modelProb compression structurally excludes ALL offensive overs
     from safe tier (today: 0 of 18 offensive overs cleared 0.55 modelProb).

3. **`buildPortfolioOptimizer.js`** — `outs` → `balanced` volatility:
   - Pitcher outs was falling through to safe (default fallback).
   - Outs is structurally suppression-flavored AND predictably volatile (pitcher hooks,
     leaves games, BPIP). Treating as safe inflated volRealism (0.80) and caused outs overs
     to monopolize Safest / Best Ladders on every MLB slate.
   - Reclassifying as balanced gives correct realism (0.74) and frees the trust surface
     for genuinely lower-variance plays.

4. **`buildFeaturedPlays.js`** — `buildSafest` premium-edge override:
   - Mirror of slip-side override. Balanced/aggressive plays with `modelProb >= 0.50 AND
     edge >= 0.12` qualify alongside the standard safe-volatility + 0.55 modelProb gate.
   - Premium offensive ecosystems (Trout 22%-edge runs over) now graduate into the SAFEST
     featured trust surface — without forcing offense or destroying realism.

### Verification (today's slate, 48 diversified candidates):
- **Safest now contains Mike Trout runs over** (was 100% pitcher outs / unders)
- Tonight's Best now contains Schanuel hits over (was Schultz outs at #4)
- Smart Aggression: 4 hitter overs (Trout, No HR, Schanuel, Machado)
- AI Aggressive #1: Trout cross-side seed
- AI Lotto: 5 pure offensive overs
- All buckets populated, no regressions, slip count 13 (was 12)
- 43 of 43 outs bets reclassified to balanced volatility ✓

---

## IMMEDIATE NEXT PRIORITIES

### 🔴 Priority 0 — Fix `buildFeaturedPlays` fork (BEFORE any other scoring work)
**This is a live divergence. All trust-qualification fixes are NOT active on server.js routes.**

`server.js` line 21 imports `./pipeline/boards/buildFeaturedPlays` (407-line OLD version).
`workstationRoutes.js` line 142 imports `../pipeline/shared/buildFeaturedPlays` (821-line CURRENT version).

Fix:
1. Confirm both files export `{ buildFeaturedPlays }` — they do.
2. In `server.js` line 21, change import path from `./pipeline/boards/buildFeaturedPlays`
   to `./pipeline/shared/buildFeaturedPlays`.
3. `node --check backend/server.js`
4. Consider deleting `pipeline/boards/buildFeaturedPlays.js` (407 lines) to prevent future confusion.
   First grep for any other imports of that path.

TERM 1 restart: YES (server.js modified)
TERM 2 verification: `curl localhost:4000/api/ws/state?sport=mlb` — confirm featured plays populate

### 🔴 Priority 1 — SQLite migration: `personal_ledger.json`
**Trigger was 500 entries. Current: 2,000 entries / 2.3MB. Migration is OVERDUE.**
Observed write-race orphan: `mlb_tracking_summary_2026-05-05.json.tmp.98415...` in tracking dir.

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

### Priority 3 — PIPELINES docs (ARCHITECTURE.md now done)
`/docs/ARCHITECTURE.md` created 2026-05-07. server.js work is now unblocked.

Still pending:
- `/docs/PIPELINES/MLB.md` — MLB-specific systems, HR/TB/RBI pipeline, phase4Tracking, weaknesses
- `/docs/PIPELINES/NBA.md` — NBA boards, slips, 5-module overlap map, ecology gaps
- `/docs/PIPELINES/TRACKING.md` — all tracking files, sizes, write-race risk, SQLite targets

These are lower urgency than Priority 0/1/2. Create during a documentation pass or before
any work that touches MLB/NBA pipeline internals.

### Priority 4 — Audit `http/nbaBestAvailable.inlined.js` + `nbaRefreshSnapshot.inlined.js`
These are 6,867 + 4,318 = 11,185 lines. `nbaIsolatedRoutes.js` comments say they are NOT used.
If dead code: delete. If live: document in ARCHITECTURE.md.
Grep all `require()` references to both files before touching anything.

### Priority 5 — NBA scoring ecology audit
Apply same lens as MLB trust-qualification audit:
- `edge × modelProb` compounding in NBA tracked_bets
- Tier distribution by side (are ELITE/STRONG under-assigned on NBA too?)
- volRealism gaps across NBA stat families
- Offensive over recognition through NBA slip + featured paths
Source: `nba_tracked_bets_2026-05-06.json`
Model: Opus — root cause audit first

### Priority 6 — Extract `isOffensiveAttackStat` into shared normalizer
`buildFeaturedPlays.js` defines `isOffensiveAttackStat()`.
`buildSlipAi.js` defines its own inline offensive list inside `offensiveAttackTextureBonus()`.
These can diverge silently. Extract canonical version to `pipeline/shared/normalizers.js`,
import in both. 30-minute task.

### Priority 7 — server.js Phase A: pure utilities
Lines 11,379–11,430: `avg`, `stddev`, `minVal`, `maxVal`, `parseHitRate`, `normalizePlayerName`
→ `pipeline/shared/mathUtils.js`
~52 lines, no globals, zero coupling. Safe today. Requires ARCHITECTURE.md first to verify
no hidden dependencies. Do NOT attempt Phase B or C until global map is documented.

### Priority 8 — "Outs" label perception (optional cosmetic)
In `compactStat()` or `buildReason()`: rename "outs" → "pitcher depth" in pitcher context.
Not a scoring change. Low priority until above infrastructure is resolved.

---

## ACTIVE RISKS / REGRESSIONS TO AVOID

| Risk | Avoidance |
|---|---|
| buildFeaturedPlays fork causing scoring divergence | Fix Priority 0 before any scoring work |
| personal_ledger.json corruption | SQLite migration now overdue — do not defer further |
| Premium-edge override admits clown plays into safe slips | Three gates: 12% edge AND 50% modelProb AND maxOdds 150 |
| Halved slipAi tierBoost makes ELITE tier signal too weak | ELITE still +0.05 — sufficient signal |
| Outs reclassification removes outs from Safest entirely | Outs still in Best Ladders — correct behavior |
| server.js context-drift patch | Do not touch server.js without ARCHITECTURE.md existing first |
| Cache (60s TTL) serving stale results | Wait for expiry; TERM 2 restart if needed |

---

## WHAT NOT TO DO

- Do NOT do any further scoring work before fixing the buildFeaturedPlays fork
- Do NOT defer the ledger SQLite migration — it is past threshold and has shown write races
- Do NOT raise slipAi tierBoost back to 0.10 — structural under-side monopoly in slips
- Do NOT raise featured tierBoost back to 0.08 — same reason
- Do NOT lower safe-tier maxOdds cap below 150
- Do NOT remove premium-edge thresholds (12% edge, 50% modelProb)
- Do NOT touch the projection engine to force over/under parity
- Do NOT widen `maxPerGame` beyond 2 in anchors
- Do NOT remove modelProb cap [0.50, 0.55]
- Do NOT attempt server.js Phase B/C extraction without ARCHITECTURE.md global map
- Do NOT touch `runMlbNight.js` / `runNbaNight.js` without tracing candidate paths first

---

## MODEL USAGE DISCIPLINE

| Task | Model |
|---|---|
| Root-cause audit on unknown bug | **Opus** |
| NBA ecology audit (Priority 5) | **Opus** — same as MLB audit |
| Implementing a verified fix | **Sonnet** |
| SQLite migration (well-scoped) | **Sonnet** |
| Doc creation (ARCHITECTURE.md etc.) | **Sonnet or Auto** |
| Trivial edits, doc updates | **Auto** |

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

## CALIBRATION DIRECTION (cumulative — move to ARCHITECTURE.md when created)

| Lever | Status |
|---|---|
| Side balance in featured buckets | Capped at 60% (anchors 55%) |
| Stat concentration | maxPerStat:10 / maxPerStatSide:6 |
| Volatility taxonomy | Fixed — hits/runs/etc. → balanced |
| Outs volatility | Fixed — outs → balanced (was safe by default) |
| modelProb compounding | Capped [0.50, 0.55] in featured + slipAi |
| Offensive over recognition | Active — stacked textureBoost (0.020/0.030) |
| Anchor cross-side | maxPerGame:2 — allows same-game cross-side |
| Anchor display ordering | Interleaved U·O·U·O·U via sortAnchorsForDisplay |
| Featured tierBoost asymmetry | Halved — ELITE 0.04, STRONG 0.02 |
| slipAi tierBoost asymmetry | Halved — ELITE 0.05, STRONG 0.025 |
| Safe-tier premium-edge override | Active — 12% edge / 50% modelProb / maxOdds 150 |
| Featured safest premium-edge override | Active — same thresholds |
| AI slip offense bias | Active in aggressive/lotto seed sort |

---

## EXTRACTION PRIORITIES (ordered)

1. ~~`diversifyCandidates`~~ **DONE** → `pipeline/shared/buildCandidateDiversity.js`
2. Fix `buildFeaturedPlays` fork — **NOW** (see Priority 0)
3. `compactLineShopping` + `compactTiming` + `compactPortfolio` → `buildWorkstationCompactors.js`
4. `isOffensiveAttackStat` → `pipeline/shared/normalizers.js` (unify with buildSlipAi.js)
5. `sortAnchorsForDisplay` → shared display utility if needed elsewhere
6. server.js Phase A (pure utils → `mathUtils.js`) — requires ARCHITECTURE.md first
7. Inline helpers from `buildIntelligencePresentation.js` → dedicated shared modules

---

## SQLITE MIGRATION SEQUENCE

1. **`personal_ledger.json` → ledger table — NOW OVERDUE (2,000 entries, was 500 trigger)**
2. `tracked_bets_YYYY-MM-DD.json` → rolling bets table
3. `timing_intelligence_state.json` → timing state table (729KB, unbounded — add to plan)
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
| `docs/ARCHITECTURE.md` | **Created 2026-05-07** |
| `docs/PIPELINES/MLB.md` | Pending |
| `docs/PIPELINES/NBA.md` | Pending |
| `docs/PIPELINES/TRACKING.md` | Pending |
