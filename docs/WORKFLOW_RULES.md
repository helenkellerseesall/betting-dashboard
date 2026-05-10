# WORKFLOW RULES
**Permanent operational law. Read first. Update last. Never skip.**

---

## MANDATORY SESSION PROTOCOL

### START OF EVERY SESSION
```
FIRST:
Read:
- /docs/WORKFLOW_RULES.md
- /docs/CURRENT_STATE.md
- /docs/NEXT_SESSION.md
```
If any file is missing → state that explicitly and continue safely.
Never proceed blind into a patch without reading current state.

### END OF EVERY SUCCESSFUL SESSION
```
LAST STEP BEFORE FINISHING:
1. State verification class (A / B / C / D) for work done this session
2. If Class C/D: confirm TERM 1 restart required
3. Provide TERM 2 verification command (exactly one copy block)
4. Run: node backend/scripts/checkpointRepo.js "Session XX: summary"
5. Update:
   - /docs/CURRENT_STATE.md  (overwrite with current live state)
   - /docs/NEXT_SESSION.md   (overwrite with exact next priorities)
```
These are live operational state — not journals. Overwrite, don't append.

### IMPLEMENTATION SESSION DECLARATION TEMPLATE

Every implementation session must state at the start of the output section:

```
Verification class: [A / B / C / D]
TERM 1 restart required: [YES / NO]
Snapshot refresh required: [YES — Class D mandatory / NO — Class A/B/C only, state why]
Payload verification required: [YES / NO]
```

RULES on snapshot refresh declaration:
- Class D: MUST declare "YES — Class D mandatory". Any other declaration is an error.
- Class C: MUST declare "NO — Class C (TERM 1 restart sufficient)".
- Class A/B: MUST declare "NO — doc/frontend only".
- NEVER declare "NO" for Class D for any reason.

---

## CORE PRINCIPLES

### Verify before patching
- Trace the real execution path first
- Reproduce the problem before touching code
- Never assume — read the actual file

### No speculative rewrites
- Only fix verified root causes
- No refactors on the side
- No "while I'm in here" changes

### One strong prompt at a time
- Isolate one problem per session
- Fully verify before moving to the next
- Scope creep = regression risk

### Preserve architecture
- No new frameworks
- No parallel systems
- No endpoint changes unless explicitly required
- No runtime workflow changes

### No terminal hijacking
- DO NOT start, stop, or restart servers
- ASSUME TERM 1 is already running the backend
- ASSUME TERM 2 is operator-controlled for manual verification

---

## AI MODEL DISCIPLINE

| Task type | Model |
|---|---|
| Deep audit, root-cause diagnosis, architecture decisions | **Opus** |
| Implementation of a verified fix, curation logic, light refactor | **Sonnet** |
| Trivial edits, doc updates, small isolated patches | **Auto** |

Rules:
- Never use Auto for anything touching scoring, pipeline logic, or orchestration
- Never use Sonnet for initial audits on unfamiliar or complex bugs
- One model per task — don't switch mid-session unless blocked

---

## TERMINAL WORKFLOW

```
TERM 1 — backend server (always assumed running, never touch)
TERM 2 — manual operator verification only
```

After a patch:
- State: "TERM 1 restart: YES or NO"
- State: "TERM 2 verification: [exact command to run]"
- Wait for operator to confirm before evaluating result

---

## OPERATIONAL OUTPUT REQUIREMENTS (permanent law)

All terminal commands output by Claude must be:
- Single-line only
- Directly runnable as written
- Copy/paste safe with no edits required
- No multiline commit message bodies
- No wrapped or escaped quotes that break shell parsing
- No partial command fragments

Output structure rules:
- TERM 1 commands → exactly one copy block
- TERM 2 commands → exactly one copy block
- Checkpoint command → exactly one copy block
- Git commit messages → short single-line strings only, no multiline bodies

If TERM 1 restart is required, state explicitly:
```
TERM 1 restart: YES — YOU must manually restart TERM 1
```

If checkpointing is required, provide exactly:
```
node backend/scripts/checkpointRepo.js "session-label: one-line summary"
```

Never output a multiline git commit body. Never output wrapped quotes.
All operator commands must be optimized for: one paste → one execution.

---

## VERIFICATION CLASSIFICATION SYSTEM (permanent law)

Every session MUST explicitly declare its verification class before stating TERM 2 or checkpoint commands.

### CLASS A — Docs / config only
**Examples**: WORKFLOW_RULES.md, CURRENT_STATE.md, NEXT_SESSION.md, ARCHITECTURE.md, comments only  
**Rebuild required**: NO  
**TERM 1 restart**: NO  
**Snapshot refresh**: NO  
**Payload verification**: NO — doc read sufficient  
**Checkpoint**: immediate after doc update

### CLASS B — Frontend / view only
**Examples**: `.tsx`, `.ts`, `.css` UI components, presentation helpers  
**Rebuild required**: frontend rebuild only  
**TERM 1 restart**: NO (unless backend touched)  
**Snapshot refresh**: NO  
**Payload verification**: visual inspection sufficient  
**Checkpoint**: after visual confirmation

### CLASS C — Runtime-sensitive (server-loaded modules)
**Examples**: `buildSlipAi.js`, `buildFeaturedPlays.js`, `buildPortfolioOptimizer.js`, `normalizers.js`, any `pipeline/shared/` module  
**Rebuild required**: YES — TERM 1 restart required  
**Snapshot refresh**: NO (existing snapshot sufficient)  
**Payload verification**: YES — inspect live `/api/ws/state?sport=nba` response  
**Checkpoint**: ONLY after TERM 2 payload confirms expected output

### CLASS D — Architecture / runtime generation / propagation
**Examples**: `workstationRoutes.js`, candidate builders, snapshot enrichment, ecology routing, aiSlips generation, normalization pipeline, `nbaCorrelationEngine.js`, volatility resolvers, alt-line gates, candidate filtering, candidate shaping, correlation propagation, volatility propagation  
**Rebuild required**: YES — FULL rebuild mandatory, ALL steps, NO exceptions:  
  1. TERM 1 restart  
  2. Snapshot hard-reset — `curl -s "http://localhost:4000/refresh-snapshot/hard-reset"` — ALWAYS, unconditionally  
  3. Wait ~10s for snapshot to load  
  4. THEN inspect live runtime payloads  
**Payload verification**: YES — must confirm specific fields in live response  
**Checkpoint**: ONLY after payload verification confirms expected output  
**NEVER inspect stale cached payload as proof of correctness**  
**NEVER declare "snapshot refresh not required" for Class D — this phrase is operationally INVALID**

### VERIFICATION SEQUENCING LAW (Class C + D)

```
CORRECT sequence for Class C:
  1. Patch code
  2. node --check all modified files
  3. Run offline smoke test (node -e)
  4. TERM 1 restart
  5. Wait ~5s for server ready
  6. Hit /api/ws/state?sport=nba (or mlb) via curl
  7. Confirm specific fields in response
  8. THEN checkpoint

CORRECT sequence for Class D (ALL STEPS MANDATORY — NO SKIPPING):
  1. Patch code
  2. node --check all modified files
  3. Run offline smoke test (node -e)
  4. TERM 1 restart
  5. Wait ~5s for server ready
  6. ALWAYS: curl -s "http://localhost:4000/refresh-snapshot/hard-reset"
     (no exceptions — snapshot MUST be rebuilt against new code)
  7. Wait ~10s for snapshot to load
  8. Hit /api/ws/state?sport=nba (or mlb) via curl
  9. Confirm specific fields in response
  10. ONLY THEN checkpoint

WRONG (produces false failures or false passes):
  - Inspect endpoint BEFORE TERM 1 restart
  - Inspect endpoint with wrong sport string (sport=basketball_nba ≠ sport=nba)
  - Accept stale 60s cache response as ground truth
  - Skip TERM 1 restart and assume memory module reloaded
  - Skip snapshot refresh for Class D and call it "not required"
  - Distinguish "READ" from "FILTERED" to justify skipping snapshot refresh
```

### SPORT STRING LAW
The workstation API requires `sport=nba` (not `sport=basketball_nba`).  
Using `sport=basketball_nba` causes:
- `isNba = false` → correlation engine never fires
- `readSnapshotRows("basketball_nba")` → 0 rows (no NBA fallback)
- All snapshot supplement paths blocked
- aiSlips empty, featured empty, correlationScore null
- **Produces false failure conclusions**

Canonical TERM 2 command for NBA verification:
```
curl -s "http://localhost:4000/api/ws/state?sport=nba" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); const slips=Object.values(p.aiSlips||{}).flat(); console.log('candidates:', p.counts?.candidates, 'slips:', slips.length, 'corrFields:', slips.filter(s=>'correlationScore' in s).length, 'nonZeroCorr:', slips.filter(s=>s.correlationScore>0).length, 'anchors:', p.featured?.anchors?.length)"
```

---

## SCRIPT EXISTENCE GOVERNANCE (permanent law)

Claude MUST NOT reference any operational script path unless:
- The path was verified with `ls` or `find` in the CURRENT SESSION, OR
- The path is listed in this section as permanently verified

### Permanently verified script paths (as of Session AH):

| Script | Verified path | Purpose |
|---|---|---|
| `checkpointRepo.js` | `backend/scripts/checkpointRepo.js` | Writes `.checkpoint/pending.json` |
| `finalizeCheckpoint.sh` | `backend/scripts/finalizeCheckpoint.sh` | Commits staged checkpoint |
| `runNbaNight.js` | `backend/scripts/runNbaNight.js` | NBA nightly pipeline |
| `runMlbNight.js` | `backend/scripts/runMlbNight.js` | MLB nightly pipeline |
| `runDailyReview.js` | `backend/scripts/runDailyReview.js` | Daily intelligence review |

**CRITICAL**: `scripts/` (repo root) does NOT exist. All scripts live in `backend/scripts/`. Any reference to `scripts/checkpointRepo.js` or `scripts/finalizeCheckpoint.sh` is WRONG.

---

## CHECKPOINT PROTOCOL (Session K — permanent)

The Claude sandbox cannot unlink `.git/*.lock` files (virtiofs PermissionError).
This protocol replaces the broken `git add / git commit` flow.

### Claude's job (end of every session):

```
1. node backend/scripts/checkpointRepo.js "commit message here"
   — writes .checkpoint/pending.json
   — NEVER touches .git/
   — reports lock status + changed files

2. Update CURRENT_STATE.md + NEXT_SESSION.md
```

### Operator's job (macOS terminal, once per session):

```bash
cd ~/Desktop/betting-dashboard && bash backend/scripts/finalizeCheckpoint.sh
```

This script:
- Reads .checkpoint/pending.json for commit message
- Detects stale locks (> 60s old AND no active git process)
- Removes stale locks safely
- Refuses to remove active locks (exits with clear error)
- git add -A + git commit
- Reports commit hash
- Cleans up .checkpoint/pending.json

### Rules:
- Claude NEVER runs git add or git commit directly
- Claude ALWAYS ends sessions with checkpointRepo.js (from backend/scripts/)
- finalizeCheckpoint.sh is the ONLY thing that touches .git/ locks
- Manual override: operator can always inspect .checkpoint/pending.json first
- If no pending checkpoint: script exits with clear error (nothing to finalize)
- Checkpoint is ONLY run after TERM 2 verification confirms expected output (Class C/D patches)

---

## ARCHITECTURE PRESERVATION

### Never create:
- Duplicate pipelines
- Per-sport parallel systems
- New scoring engines alongside existing ones
- Always-on daemons or polling loops

### Always extend through:
- Shared pipeline modules under `backend/pipeline/shared/`
- Sport-specific adapters only where divergence is real
- Existing route handlers in `backend/routes/workstationRoutes.js`

### Extraction direction (long-term):
- Move large inline functions from `buildIntelligencePresentation.js` into dedicated shared modules
- Extract sport-specific projection logic into `pipeline/adapters/`
- Keep `workstationRoutes.js` as a thin orchestrator, not a logic host

---

## SQLITE MIGRATION DIRECTION

Current state: all persistence is flat JSON files in `backend/runtime/tracking/`.

Migration targets (when scope opens):
1. `personal_ledger.json` → SQLite ledger table (first priority)
2. `tracked_bets_YYYY-MM-DD.json` → rolling SQLite bets table
3. `book_intelligence_state.json` → SQLite book state table
4. `graded_props_*.json` → SQLite review/grading table

Rules:
- Do NOT migrate until explicitly tasked
- Do NOT dual-write during migration without explicit approval
- JSON fallback must remain until SQLite path is verified end-to-end

---

## VALIDATION-FIRST PHILOSOPHY

Before any patch:
1. Reproduce the problem with a real data trace (`node -e` smoke test preferred)
2. Confirm the root cause in the actual file
3. Apply the minimal fix
4. Re-run the smoke test
5. Confirm no adjacent regressions

Never patch based on theory. Only patch based on observed data.

---

## ANTI-REGRESSION CHECKLIST

Before finishing any session:
- [ ] State verification class (A / B / C / D) explicitly
- [ ] `node --check` on all modified `.js` files
- [ ] Run offline smoke test (`node -e`) on modified logic
- [ ] No new lint errors in modified `.tsx/.ts` files
- [ ] No endpoint shape changes without frontend type update
- [ ] No new files created unless explicitly required
- [ ] `CURRENT_STATE.md` updated
- [ ] `NEXT_SESSION.md` updated
- [ ] If Class C/D: TERM 1 restart confirmed before TERM 2 curl
- [ ] If Class C/D: TERM 2 curl uses `sport=nba` (NOT `sport=basketball_nba`)
- [ ] If Class D: snapshot hard-reset confirmed — `curl -s "http://localhost:4000/refresh-snapshot/hard-reset"` — BEFORE TERM 2 curl
- [ ] If Class D: snapshot refresh declared "YES — Class D mandatory" in session declaration header
- [ ] Checkpoint run ONLY after TERM 2 confirms expected output

## RUNTIME REBUILD LAW (permanent)

The repo is runtime-generated, propagation-sensitive, snapshot-driven, and multi-stage.
Endpoint inspection of a running server with old code IS NOT VERIFICATION.

### The 60s cache trap
`workstationRoutes.js` caches `/api/ws/state` responses for 60 seconds.
A TERM 2 curl immediately after a patch — without TERM 1 restart — will hit the cache
and return the pre-patch payload. This produces false passes AND false failures.

### Mandatory sequence for Class C/D patches:

```
Step 1: Patch + node --check + offline smoke test
Step 2: TERM 1 restart (operator runs: cd ~/Desktop/betting-dashboard && node backend/server.js)
Step 3: Wait ~5s for server ready
Step 4: curl -s "http://localhost:4000/api/ws/state?sport=nba" [full verification command]
Step 5: Confirm specific fields in response match expected values
Step 6: ONLY THEN run checkpoint
```

### When snapshot refresh is required

**For Class D: ALWAYS. No exceptions. No reasoning overrides this.**

The prior distinction between "READ" vs "FILTERED" vs "SCORED" vs "ASSEMBLED" is ABOLISHED.
This distinction produced false "snapshot refresh not required" declarations in Sessions AI and earlier.
The repo is runtime-generated and propagation-sensitive — the entire candidate pipeline is snapshot-dependent.
Any Class D patch modifies how the runtime constructs payloads from snapshot data.
Running new code against old in-memory snapshot state = undefined behavior.

The correct hard-reset endpoint (bypasses cooldown, full rebuild):
```
curl -s "http://localhost:4000/refresh-snapshot/hard-reset"
```

**For Class C: NO** — server-loaded modules are in-memory; TERM 1 restart reloads them; existing snapshot data is sufficient.

**For Class A/B: NO** — no runtime code changed.

---

## STALE RUNTIME PREVENTION LAW (permanent — Session AJ)

The following phrases are **operationally INVALID** for Class D patches. Any session that uses them has produced an incorrect verification declaration:

| Invalid phrase | Why it's wrong |
|---|---|
| "snapshot refresh not required" | Class D always requires it |
| "existing snapshot sufficient" | Old snapshot + new filter code = undefined behavior |
| "patch does not change snapshot reading" | All candidate shaping is snapshot-dependent |
| "no snapshot-reading code changed" | "reading" is not the only dependency — filtering, shaping, enriching, routing all require fresh snapshot |
| "snapshot refresh: NO — patch changes FILTERED not READ" | The READ/FILTERED distinction is abolished for Class D |

**The repo is:**
- Runtime-generated: payloads are built fresh on each `/api/ws/state` request
- Snapshot-driven: all NBA candidate data flows from `oddsSnapshot` populated by `/refresh-snapshot`
- Propagation-sensitive: a change to candidate filtering changes which rows enter every downstream stage
- Multi-stage: new code + old snapshot = only some stages get the patch; others see stale state

**Therefore:** Class D patches require BOTH new code (TERM 1 restart) AND fresh data (snapshot hard-reset) to produce a valid verification payload. Neither alone is sufficient.

---

## RUNTIME REBUILD DEPENDENCY LAW (permanent — Session AJ)

Each step in the Class D sequence is required for a specific reason. Skipping any step breaks verification:

| Step | Command | Why mandatory |
|---|---|---|
| TERM 1 restart | `node backend/server.js` | Loads new JS module code into Node cache. Without this, old code runs regardless of snapshot state. |
| Snapshot hard-reset | `curl -s "http://localhost:4000/refresh-snapshot/hard-reset"` | Rebuilds `oddsSnapshot` in-memory from live data. After TERM 1 restart, in-memory snapshot is cleared. Without this, new code runs against empty or stale oddsSnapshot. |
| Wait ~10s | (implicit) | Snapshot rebuild is async. Inspecting `/api/ws/state` before rebuild completes returns empty candidate pool. |
| Payload inspection | `curl -s "http://localhost:4000/api/ws/state?sport=nba"` | Verifies new code + fresh data produce expected runtime output. |
| Checkpoint | `node backend/scripts/checkpointRepo.js "..."` | Stages the commit. Run ONLY after payload inspection confirms. |

**Skipping TERM 1 restart:** Old code, old snapshot. Nothing changed. False pass.  
**Skipping snapshot hard-reset:** New code, empty/stale snapshot. Candidate pool empty or stale. False failure.  
**Skipping wait:** New code, partial snapshot. Race condition. Unreliable result.  
**Skipping payload inspection:** No verification at all. Unknown state. Never checkpoint in this condition.

---

## CLASS D REGENERATION PROTOCOL (mandatory — Session AJ)

This is the canonical operator sequence for all Class D patches. No steps may be skipped or reordered.

**STEP 1 — Restart TERM 1 (load new code):**
```
cd ~/Desktop/betting-dashboard && node backend/server.js
```

**STEP 2 — Wait 5s for server ready, then force snapshot hard-reset:**
```
curl -s "http://localhost:4000/refresh-snapshot/hard-reset"
```

**STEP 3 — Wait 10s for snapshot rebuild, then verify live payload (NBA):**
```
curl -s "http://localhost:4000/api/ws/state?sport=nba" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); const slips=Object.values(p.aiSlips||{}).flat(); console.log('candidates:', p.counts?.candidates, 'slips:', slips.length, 'corrFields:', slips.filter(s=>'correlationScore' in s).length, 'nonZeroCorr:', slips.filter(s=>s.correlationScore>0).length, 'anchors:', p.featured?.anchors?.length)"
```

**STEP 4 — ONLY after Step 3 confirms expected output, run checkpoint:**
```
node backend/scripts/checkpointRepo.js "Session XX: one-line summary"
```

**STEP 5 — Finalize checkpoint (macOS terminal):**
```
cd ~/Desktop/betting-dashboard && bash backend/scripts/finalizeCheckpoint.sh
```

**CRITICAL:**
- Never run Step 4 before Step 3 confirms.
- Never run Step 3 before Step 2 completes.
- Never skip Step 2 regardless of what the patch "touched".
- `sport=basketball_nba` causes `isNba=false` — always use `sport=nba`.

---

## WHAT THESE DOCS ARE

| File | Purpose |
|---|---|
| `WORKFLOW_RULES.md` | Permanent law — never changes except to strengthen rules |
| `CURRENT_STATE.md` | Live system state — overwritten every session |
| `NEXT_SESSION.md` | Exact resumption point — overwritten every session |
| `ARCHITECTURE.md` | Structural reference — updated when architecture evolves |
| `PIPELINES/*.md` | Per-pipeline state — updated when pipeline changes |

These are **repo RAM**, not documentation.
They exist so any new chat can rehydrate the full operational context in 60 seconds.
