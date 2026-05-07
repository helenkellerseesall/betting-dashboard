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
Update:
- /docs/CURRENT_STATE.md  (overwrite with current live state)
- /docs/NEXT_SESSION.md   (overwrite with exact next priorities)
```
These are live operational state — not journals. Overwrite, don't append.

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
- [ ] `node --check` on all modified `.js` files
- [ ] No new lint errors in modified `.tsx/.ts` files
- [ ] No endpoint shape changes without frontend type update
- [ ] No new files created unless explicitly required
- [ ] `CURRENT_STATE.md` updated
- [ ] `NEXT_SESSION.md` updated

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
