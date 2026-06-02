# Slate Date Doctrine

**Binding from 2026-06-01 22:30 ET onward. Canonical authority for any date-touching code in this repo.**

## The rule

1. **Slate date = ET calendar day** (`America/New_York` timezone). Never UTC. Never sandbox-local. Never inferred from `new Date().toISOString()`.

2. **Slate day boundary = 04:00 AM ET.**
   - All major NBA games end before this (latest West Coast game finishes ~02:30 ET).
   - 04:00 ET is when the `grading:backfill-all` autopilot fires — natural cycle boundary.
   - Rule: timestamp between 04:00 ET on date X and 03:59:59 ET on date X+1 belongs to slate X.
   - Practical: at 11 PM ET on 2026-06-01, slate date is "2026-06-01". At 2 AM ET on 2026-06-02, slate date is STILL "2026-06-01" (late west-coast game hasn't settled yet). At 4 AM ET on 2026-06-02, slate date becomes "2026-06-02".

3. **Display labels = ET always.** No UTC strings shown to operator anywhere — neither in dashboard, FE cards, scheduler log preview, audit reports, brain doc timestamps.

4. **ONE canonical helper module**: `backend/pipeline/shared/slateDate.js`. Every date-touching call site routes through it.

## Why this doctrine exists

Operator caught the regression 2026-06-01 22:00 ET:

> "the repo as a whole needs common knowledge forever to always use the same time and time zone.... we need defined rules for showing slates or what?"

The bug: `nba_tracked_best_2026-06-02.json` was being written at 20:00 ET June 1 (= 00:00 UTC June 2) because the writer used `new Date().toISOString().slice(0,10)`. Same-ET-day evening slate split across two filenames. The downstream FE then served different "today" content depending on which file it picked up first.

Patches to individual call sites couldn't survive without the doctrine — the next reviewer would write `toISOString().slice(0,10)` again because the rule wasn't written down anywhere. This file is the rule, written down.

## How to use the helper

```js
const {
  currentSlateDateEt,      // → "2026-06-01" (right now, using rule)
  slateDateForTimestamp,   // → "YYYY-MM-DD" for any past/future ms
  slateWindowEt,           // → { startMs, endMs } for filtering
  isInSlate,               // → boolean
  formatEt,                // → "YYYY-MM-DD HH:MM:SS ET" for display
} = require("../pipeline/shared/slateDate")

// Common patterns:
const today = currentSlateDateEt()                          // slate-today
const filename = `nba_tracked_best_${today}.json`            // safe filename
const isToday = isInSlate(Date.now(), today)                 // bool
const displayTs = formatEt(Date.now())                       // operator-visible

// Filter entries to a slate window:
const window = slateWindowEt(today)
const entries = allEntries.filter(e => isInSlate(e.timestamp, today))
```

## What NOT to do (ever)

```js
// ❌ NEVER — UTC date, drifts at 20:00 ET (8 PM)
const date = new Date().toISOString().slice(0, 10)

// ❌ NEVER — server-local, works on operator's mac but fails in CI/sandbox
const date = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`

// ❌ NEVER — toLocaleDateString without explicit timeZone
const date = new Date().toLocaleDateString()
```

If you find yourself wanting any of those, use the helper instead. If the helper doesn't cover your need, extend the helper — don't add another inline implementation.

## Migration status (per Phase Date-Doctrine-1A, commit pending)

**Migrated** (4 highest-impact call sites — the slate file writers + main route defaulting):
- `backend/pipeline/nba/buildNbaPerformanceTracking.js` — `todayKey()` writer
- `backend/pipeline/mlb/phase4Tracking.js` — `dateKeyFromNow()` writer
- `backend/routes/workstationRoutes.js:1229` — `modelProbLookup` date default
- `backend/routes/workstationRoutes.js:2348` — `/api/ws/top-picks` date default

**Pending migration** (Phase Date-Doctrine-1B):
- `backend/scripts/scheduler.sh` — log timestamps (uses `TZ='America/New_York' date` which is approximately correct, but should use a node-helper-emitted equivalent for cross-tool consistency)
- `backend/scripts/populate*.js` — populator filename keys
- `backend/scripts/derive*.js` — derived cache file timestamps
- `frontend/mobile/index.html` — FE renderer date defaults (less critical since FE receives dates from backend)
- `backend/runtime/audits/*.md` — audit report date keys
- Brain doc generation timestamps

**Enforcement (optional, queued)**:
- Lint rule or pre-commit hook that grep-bans `toISOString().slice(0,10)` and `new Date().toLocaleDateString` outside `slateDate.js` itself.

## Verification

Self-tests inside the helper module:

```bash
node backend/pipeline/shared/slateDate.js
```

Verifies the boundary conditions + the exact regression case ("20:00 ET June 1 → 2026-06-01" not "2026-06-02"). Should print `=== 10 passed, 0 failed ===`.
