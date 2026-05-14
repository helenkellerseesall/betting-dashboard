# PHASE Operator-Operations-1 — OPERATIONAL COMMAND AUDIT + STANDARDIZATION
**Audit + implementation deliverable per operator brief. 2026-05-14.**

> **Companion file**: `docs/OPERATOR_RUNBOOK.md` — single-page daily ceremony reference. Read that for usage; this doc explains what changed and why.

---

## 1. OPERATIONAL COMMAND AUDIT (pre-Phase Operator-Operations-1 state)

### 1.1 Existing npm scripts in `backend/package.json` (11 total)

```
test                            (placeholder)
brain:bootstrap                 node scripts/brain/loadBrainContext.js
brain:status                    node scripts/brain/brainSyncSummary.js
brain:verify                    node scripts/brain/verifyBrainFreshness.js
brain:continuity                node scripts/brain/assessContinuity.js
brain:checkpoint                node scripts/brain/enforceBrainCheckpoint.js
persistence:status              node scripts/persistenceStatus.js          (Phase Persistence-1B)
persistence:probe               node scripts/runPersistenceProbes.js       (Phase Persistence-1B)
persistence:import              node storage/importHistoricalData.js
persistence:backfill-aliases    node scripts/backfillPredictionIdAliases.js
epoch:status                    node scripts/epochStatus.js                (Phase Longitudinal-Integrity-1B)
```

**Coverage analysis**: brain discipline + persistence + epoch authority well covered. **No canonical commands for**: engine lifecycle (start/restart/status), slate refresh, grading, runtime verification.

### 1.2 Embedded shell commands in operator docs (the ad-hoc surface)

Inventoried from `NEXT_SESSION.md`, `CURRENT_STATE.md`, and the brain doc set. **Each is a memory-based command operators have been running by recall or copy-paste.**

| Pattern | Frequency observed | Risk if mistyped |
|---|---|---|
| `(lsof -ti tcp:4000 | xargs -r kill -9; sleep 2; lsof -i tcp:4000 || echo "port 4000 clear"); node backend/server.js` | High — every TERM 1 restart | High — silent kill if operator forgets `lsof` confirmation |
| `curl -sS -X POST http://localhost:4000/api/nba/refresh-snapshot/hard-reset > /dev/null` | High — every NBA refresh | Low (idempotent) but loses response body |
| `curl -sS "http://localhost:4000/api/ws/state?sport=nba" > /dev/null` | High | Low |
| `curl -s "http://localhost:4000/api/ws/state?sport=baseball_mlb" | node -e ...` | Medium | Medium — shell quoting / cwd-sensitive |
| `node backend/scripts/runHistoricalGrade.js --sport=mlb --backfill` | Daily | Low |
| `node backend/scripts/runDailyReview.js --sport=mlb --date=...` | Daily | Low |
| `for f in verifyMlbContextualPhase1 ... ; do node "backend/scripts/${f}.js" 2>&1 | tail -1; done` | Per session | High — bash loop drift, prone to typos |
| `node backend/scripts/checkpointRepo.js "<commit message>"` | Per checkpoint | Medium |
| `node -e "const {DatabaseSync} = require('node:sqlite'); ..."` | Frequent | High — wrong cwd creates 0-byte sqlite file |

**Total memory-resident operational verbs**: ~9 categories, dozens of variants across sessions.

### 1.3 Existing CLI scripts in `backend/scripts/` (operational, not brain-related)

```
runMlbNight.js              (21 KB)  — MLB nightly pipeline
runNbaNight.js              (53 KB)  — NBA nightly pipeline
runDailyReview.js                    — daily intelligence review CLI
runHistoricalGrade.js                — historical grading + reconciliation CLI
runMlbGrade.js                       — MLB-specific grading
runVerification.js                   — verification artifact writer
refreshMlbLiveState.js               — MLB live state refresh (Phase 2)
checkpointRepo.js                    — git commit ceremony
finalizeCheckpoint.sh                — shell wrapper
populateNbaGameLogs.js               — NBA game log backfill
populateNbaInjuryReport.js           — NBA injury report ingest
migrateLongitudinalMemory.js         — longitudinal table migration
nbaPipelineHardAudit.js              — manual audit tool
nbaPipelineSelfCheck.js              — manual audit tool
verify*.js (14)                      — regression matrix
```

**Coverage analysis**: rich CLI surface, but no canonical operator entrypoints to invoke them. Every invocation requires correct `cwd` + correct `--flag` knowledge + correct path.

---

## 2. CANONICAL COMMAND MAP (Phase Operator-Operations-1 — 2026-05-14)

Nine new canonical entrypoints. All additive. All transparent.

| Verb | Command | Implementation | Replaces (memory verb) |
|---|---|---|---|
| Start backend | `npm run engine:start`   | `bash scripts/engineStart.sh`   | `node backend/server.js` |
| Restart backend | `npm run engine:restart` | `bash scripts/engineRestart.sh` | `(lsof -ti tcp:4000 \| xargs -r kill -9; sleep 2; ...); node backend/server.js` |
| Check backend status | `npm run engine:status`  | `node scripts/engineStatus.js`  | `lsof -i tcp:4000` + `curl ... | head` |
| Generic refresh | `npm run slate:refresh`  | `node scripts/slateRefresh.js`  | `curl -s http://localhost:4000/refresh-snapshot` |
| NBA slate refresh ceremony | `npm run slate:nba`      | `node scripts/slateNba.js`      | 3 chained curls + bash JSON parsing |
| MLB slate refresh ceremony | `npm run slate:mlb`      | `node scripts/slateMlb.js`      | 3 chained curls + bash JSON parsing |
| Runtime verification | `npm run runtime:verify` | `node scripts/runtimeVerify.js` | `for f in verify... ; do ... ; done` shell loop |
| Historical grading | `npm run grading:run`    | `node scripts/gradingRun.js`    | `node backend/scripts/runHistoricalGrade.js --sport=...` (with default) |
| Daily intelligence review | `npm run grading:review` | `node scripts/gradingReview.js` | `node backend/scripts/runDailyReview.js --sport=...` (with default) |

### Naming convention adopted

- `engine:*` → backend lifecycle (start/restart/status)
- `slate:*`  → per-slate operations (refresh, sport-specific ceremonies)
- `grading:*` → post-slate settlement (run, review)
- `runtime:*` → repo health (verify)
- `brain:*` → continuity (pre-existing)
- `persistence:*` → SQLite layer (pre-existing Phase Persistence-1B)
- `epoch:*` → temporal lineage (pre-existing Phase Longitudinal-Integrity-1B)

Vocabulary is consistent with operator's stated intent in the Phase Operator-Operations-1 brief.

---

## 3. DUPLICATE COMMAND RISKS

### 3.1 Before Phase Operator-Operations-1

| Risk | Severity | Description |
|---|---|---|
| Multiple shell variants of "restart" | HIGH | Different sessions used slightly different forms of `pkill -f node`, `lsof | xargs kill`, sleep durations, etc. No canonical form. |
| Refresh curls scattered across docs | MEDIUM | NBA hard-reset / generic refresh / MLB refresh all use different endpoints + flag styles. Operator memory had to disambiguate. |
| 14-suite regression loop forms | MEDIUM | Bash `for f in ...` loop appeared in at least 3 docs with slightly different lists. |
| Grading CLI invocations | LOW | Both `runHistoricalGrade` and `runDailyReview` were docs-referenced but inconsistent in flag defaults. |

### 3.2 After Phase Operator-Operations-1

| Risk | Status |
|---|---|
| Restart variant drift | **RESOLVED** — `engine:restart` is now the only correct ceremony; docs point to it. |
| Refresh curl drift | **RESOLVED** — `slate:refresh` / `slate:nba` / `slate:mlb` are canonical. |
| Regression matrix shell loop drift | **RESOLVED** — `runtime:verify` invokes one canonical list. |
| Grading invocation drift | **RESOLVED** — `grading:run` / `grading:review` thin wrappers with explicit args echo. |

**Note on additive discipline**: no existing CLI was deleted or renamed. `node backend/scripts/runHistoricalGrade.js --sport=mlb` still works exactly as before. Operators who prefer the explicit form can keep using it; the canonical npm verbs are the recommended path going forward.

---

## 4. STARTUP FLOW STANDARDIZATION

### 4.1 The canonical startup flow (TERM 1)

```bash
npm run engine:start             # if you're sure port 4000 is clear
# OR
npm run engine:restart           # the safe default — handles both states
```

**Both variants**:
1. Check port 4000 occupancy via `lsof -ti tcp:4000`.
2. If occupied (only relevant to `engine:restart`):
   - Print every PID + its `ps` info (operator can confirm before kill).
   - `kill -9` each PID.
   - Sleep 2s.
   - Re-verify port clear or abort with explicit error.
3. `cd` into `backend/` and `exec node server.js`.
4. Boot log streams to TERM 1 (the operator's terminal).

### 4.2 What the boot log MUST show (per existing brain doctrine)

```
[SERVER-BOOT-DB-INIT] { ok: true, dbPath: '.../betting.db', criticalTablesOk: true, ledgerIntegrity: {...} }
[DB-BOOT] { canonicalPath: '.../betting.db', tablesPresent: ≥25, criticalTables: {... ✓ ...}, azRepairApplied: null }
[storage/db] (no SQLite-unavailable warning)
ACTIVE: nbaIsolatedRoutes.js
ACTIVE: <other isolated routes>
Backend listening on http://localhost:4000
```

### 4.3 Absent-on-boot signals (acceptable on healthy boot)

These should NOT appear on a healthy boot:

- `[DB-BOOT-REPAIR]`  — only fires when AZ tables had to be self-healed (acceptable as fallback)
- `[DB-BOOT-CRITICAL]` — would indicate missing critical tables — investigate
- `[LEDGER-DIVERGENCE-DETECTED]` — Phase Persistence-1B; fires only when SQLite is missing rows JSON has. If it fires, run `npm run persistence:import`.
- `[REFRESH-MUTEX-STUCK]` — Phase Race-1; fires only mid-operation, not at boot.

---

## 5. RESTART FLOW STANDARDIZATION

### 5.1 The canonical restart flow

```bash
npm run engine:restart
```

That's it.

### 5.2 What engine:restart prints (verbatim)

```
[engine:restart] === Phase Operator-Operations-1 ===
[engine:restart] backend dir : /Users/.../betting-dashboard/backend

[engine:restart] === Phase 1: identify process(es) on port 4000 ===
[engine:restart] found PID(s) on port 4000:
  PID USER     ELAPSED COMMAND
12345 andrewm  01:23   node server.js

[engine:restart] === Phase 2: kill -9 PID(s) ===
[engine:restart] killing: 12345

[engine:restart] === Phase 3: verify port clear ===
[engine:restart] port 4000: confirmed clear

[engine:restart] === Phase 4: launch backend ===
[engine:restart] launching: node /.../backend/server.js
[engine:restart] (boot log follows; Ctrl-C to stop)

[SERVER-BOOT-DB-INIT] { ok: true, ... }
...
```

### 5.3 What engine:restart does NOT do (anti-magic guarantees)

- ❌ Does NOT kill silently — every PID is echoed first.
- ❌ Does NOT use `pkill -f node` (which would kill other unrelated Node processes).
- ❌ Does NOT retry on failure — if the kill fails or port stays stuck, it exits non-zero with a clear error.
- ❌ Does NOT detach into background — boot log streams to your terminal so you see what's happening.
- ❌ Does NOT modify any files — pure process control.

---

## 6. HEALTH-CHECK STRATEGY

### 6.1 The canonical health-check flow

```bash
npm run engine:status            # backend liveness + brain summary
npm run runtime:verify           # 14-suite regression (PASS/FAIL verdict)
npm run persistence:status       # SQLite vs JSON parity
npm run epoch:status             # epoch authority diagnostics
```

### 6.2 What each surfaces

| Command | What it tells you |
|---|---|
| `engine:status`     | Is the backend running? What's on port 4000? Brain freshness? Continuity intact? |
| `runtime:verify`    | Are the 14 regression suites still PASS? Where did the failure happen if not? |
| `persistence:status`| Are SQLite tables populated? Is the ledger mirror cold? Any divergence events? |
| `epoch:status`      | How many prediction_epochs? Broken down by formula prefix / sport / source. Most-recent IDs. |

### 6.3 Composite recommended cadence

| Cadence | Commands |
|---|---|
| Session start | `brain:bootstrap`, `brain:continuity`, `engine:status` |
| Pre-slate | `slate:nba`, `slate:mlb` |
| Mid-session sanity | `runtime:verify`, `persistence:status`, `epoch:status` |
| Post-slate | `grading:run`, `grading:review` |
| Session end | `brain:checkpoint` (runs verify + reconciles receipt) |

---

## 7. GRADING OPERATION STRATEGY

### 7.1 The canonical grading flow

```bash
# Grade today's bets across sports
npm run grading:run

# Grade a specific date
npm run grading:run -- --date=2026-05-13

# Grade only NBA
npm run grading:run -- --sport=nba

# Backfill all pending dates
npm run grading:run -- --sport=all --backfill --retry-unresolved

# Then run the daily review
npm run grading:review -- --date=2026-05-13 --verbose
```

### 7.2 Argument pass-through contract

`grading:run` and `grading:review` are thin wrappers — they pass through any operator args to the underlying CLI. The wrapper's only role is:
1. Default `--sport=all` if no `--sport=` is provided.
2. Echo the resolved command before exec.

Every other flag from `runHistoricalGrade.js` and `runDailyReview.js` is preserved.

### 7.3 Grading paths (unchanged behavior)

```
runHistoricalGrade.js (called by grading:run)
  → fetchGameResults     (per sport)
  → gradeTrackedBets     (per date, per sport)
  → gradeTrackedSlips    (per date, per sport)
  → buildGradingSummary  (writes grading_summary_<sport>_<date>.json)
```

```
runDailyReview.js (called by grading:review)
  → daily intelligence review pipeline
  → writes daily_intelligence_review_<sport>_<date>.json
  → updates SQLite review tables (when wired — Phase Persistence-1C scope)
```

Neither wrapper modifies grading logic. Both preserve `--dry-run` semantics.

---

## 8. DAILY OPERATION CEREMONY

See `docs/OPERATOR_RUNBOOK.md` for the single-page operator reference. Summary:

```
Morning:
  brain:bootstrap → brain:continuity → engine:status
  engine:restart (if needed)
  slate:nba → slate:mlb
  runtime:verify (sanity)

Evening (after games settle):
  grading:run -- --date=$(date +%Y-%m-%d)
  grading:review -- --date=$(date +%Y-%m-%d) --verbose
  persistence:status (verify)
  brain:checkpoint
```

---

## 9. PRE-SLATE CEREMONY (detailed)

```bash
# 1. Load operator memory
npm run brain:bootstrap

# 2. Verify continuity (should PASS clean before changing anything)
npm run brain:continuity

# 3. Inspect backend liveness
npm run engine:status

# 4. If backend is down OR if F6.3/Race-1/Persistence-1B-pending restart is needed:
npm run engine:restart        # in TERM 1

# 5. Refresh slates
npm run slate:nba
npm run slate:mlb

# 6. Verify the refresh produced expected diagnostics
#    (slate:nba and slate:mlb scripts print summaries inline)

# 7. Optional: quick regression sanity
npm run runtime:verify
```

Expected slate:nba diagnostic output (after operator-driven boot):

```
cacheWriteSuccessesPlayerId : > 0
memoryPlayerIdCount         : > 0
diskPlayerIdCount           : > 0
lastPlayerIdMatchStrategy   : roster_match_exact | roster_cache_hit | roster_match_lastname
collisionsDetected (epoch)  : 0
formulaVariantsObserved     : { "snapshot|nba": > 0 }
```

---

## 10. POST-SLATE CEREMONY (detailed)

```bash
# 1. Grade today's bets + slips
npm run grading:run -- --date=$(date +%Y-%m-%d)
# OR backfill if multiple dates pending:
npm run grading:run -- --sport=all --backfill

# 2. Run the daily intelligence review
npm run grading:review -- --date=$(date +%Y-%m-%d) --verbose

# 3. Verify persistence parity didn't drift
npm run persistence:status
npm run epoch:status

# 4. Run the regression matrix (matches the brain:checkpoint matrix)
npm run runtime:verify

# 5. Seal brain receipt — required end-of-session per OPERATOR_PROTOCOL.md
npm run brain:checkpoint
```

---

## 11. FAILURE-RECOVERY WORKFLOW

| Symptom | First diagnostic | Recovery action |
|---|---|---|
| Backend unresponsive on port 4000 | `npm run engine:status` | `npm run engine:restart` |
| `[REFRESH-MUTEX-STUCK]` in TERM 1 | Read message; mutex held > 5 min | `npm run engine:restart` (only recovery path) |
| `[LEDGER-DIVERGENCE-DETECTED]` at boot | `npm run persistence:status` | `npm run persistence:import` then re-verify |
| `[EPOCH-ID-COLLISION-DETECTED]` in TERM 1 | Phase 1B probe (dual-freeze risk surface) | Check Phase Longitudinal-Integrity-1E audit recommendation; coordinate with operator |
| 14-suite regression fails | `npm run runtime:verify` (prints stderr tail) | Run the failing suite standalone for full output |
| Brain continuity FAIL | `npm run brain:continuity` (prints reason) | Usually `npm run brain:checkpoint` reconciles |
| Stale snapshot served | `curl /snapshot/status` shows `isStale: true` | `npm run slate:refresh` |
| Persistence probe FAIL | `npm run persistence:probe` | Inspect probe output; usually env/SQLite issue |

---

## 12. FUTURE AUTOMATION OPPORTUNITIES

Listed but explicitly NOT in scope for Phase Operator-Operations-1 (the operator brief says "lightweight, additive, no magic"):

| Candidate | Reason to defer |
|---|---|
| Cron / systemd unit for engine | Adds platform-specific config; current model is operator-driven. Revisit only if operator explicitly requests it. |
| Pre-commit hook running `brain:checkpoint --skip-matrix` | Already noted in INC-009 (ACTIVE_INCIDENTS); discipline-driven for now. |
| CI workflow (GitHub Actions) | Repository is single-operator; no PR review surface today. Revisit if multi-contributor model emerges. |
| Slack/email notifications on `brain:checkpoint` FAIL | Adds external dependency; current observability is terminal-based by design. |
| `npm run nightly` orchestration of slate:nba + grading:run + brain:checkpoint | Tempting but couples too much — operator brief explicitly warned against "magic orchestration." Keep verbs explicit. |
| `npm run engine:logs` to tail TERM 1 log into TERM 2 | Would require log redirection; operator's two-terminal model already gives this view. |
| `npm run slate:status` showing both sports + timing + line-shopping in one summary | Useful but additive; can ship in Phase Operator-Operations-2 if requested. |
| `npm run grading:status` showing pending/settled counts per date | Currently surfaced by persistence:status; can split out if it grows noisy. |

**Phase Operator-Operations-2 candidate scope** (operator-gated, future session):
- Optional `engine:logs` tail helper.
- `slate:status` cross-sport summary view.
- `grading:status` settled-count inspector.
- Pre-commit hook for `brain:checkpoint`.

---

## DELIVERABLE SUMMARY

**Files added**:
```
backend/scripts/engineStart.sh                                NEW, ~30 lines, chmod +x
backend/scripts/engineRestart.sh                              NEW, ~70 lines, chmod +x
backend/scripts/engineStatus.js                               NEW, ~95 lines
backend/scripts/slateRefresh.js                               NEW, ~75 lines
backend/scripts/slateNba.js                                   NEW, ~115 lines
backend/scripts/slateMlb.js                                   NEW, ~90 lines
backend/scripts/runtimeVerify.js                              NEW, ~75 lines
backend/scripts/gradingRun.js                                 NEW, ~35 lines
backend/scripts/gradingReview.js                              NEW, ~35 lines
docs/OPERATOR_RUNBOOK.md                                      NEW, ~170 lines
docs/OPERATIONS_AUDIT_2026-05-14.md                           NEW (this doc)
```

**Files modified**:
```
backend/package.json                                          +9 npm scripts
backend/runtime/brain/MASTER_BRAIN.md                         current-phase + canonical commands
backend/runtime/brain/CURRENT_RUNTIME_STATE.md                Phase Operator-Operations-1 entry
backend/runtime/brain/MODEL_EVOLUTION_LOG.md                  new dated entry at top
backend/runtime/brain/OPERATOR_PROTOCOL.md                    canonical command map + ceremony
backend/runtime/brain/PIPELINE_AUTHORITY_MAP.md               OPERATIONS section
backend/runtime/brain/ACTIVE_INCIDENTS.md                     R-035 resolved
CURRENT_STATE.md                                              session entry
NEXT_SESSION.md                                               Phase Operator-Operations-2 candidate gate
```

**Net additive only.** No deletions. No existing command modified. Five existing freeze writers, every existing CLI, every existing endpoint — all preserved unchanged.

---

_Phase Operator-Operations-1 audit + implementation completed: 2026-05-14_
_Verified: 14-suite regression matrix 14/14 PASS; persistence probes 44/44 PASS; epoch probe 48/48 PASS; brain checkpoint reconciled._
