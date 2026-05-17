# BOOTSTRAP PROMPT
**Canonical repo rehydration entrypoint. Paste at the top of every new chat or session.**
**Optimized for both Claude and fresh GPT chats (Continuity-OS-1A + 1B, 2026-05-17).**

---

## ⚡ FASTEST PATH — FRESH GPT CHAT (Continuity-OS-1B, recommended)

```
Upload (or paste) this ONE file into the fresh chat:
  /GPT_RECONSTRUCTION_BOOTSTRAP.md   (~550 lines, ~96% drift reduction vs prior 15000-line surface)

That single file contains:
  § 1  REPO IDENTITY
  § 2  CURRENT ACTIVE PHASE
  § 3  CURRENT PRODUCT STATE (working / weak / absent)
  § 4  CURRENT BOTTLENECKS (🟢🟡🔵🔴⚪ tracker)
  § 5  FORBIDDEN DIRECTIONS (12 cemented)
  § 6  CURRENT FE DIRECTION (game-first discovery + bettor-native interaction doctrine)
  § 7  OPERATIONAL FLOW (terminals + audit-first + regression + reconciliation + checkpoint)
  § 8  DEFERRED SYSTEMS (why X is not built)
  § 9  CURRENT NEXT-PHASE OPTIONS (5 candidates)
  § 10 RECONSTRUCTION INSTRUCTIONS (top + bottom of file)

After upload, the fresh chat will know within 30 seconds:
  - what we are doing right now
  - what is forbidden
  - what is deferred
  - what ships next
  - how the operational rituals work

⚠️ CANONICAL OPS LAYER (Continuity-OS-1C, 2026-05-17):
The repo exposes ONE approved operational abstraction layer. Fresh chats
MUST use these `npm run ops:*` commands; DO NOT regenerate legacy inline
chains (for-loop verifier scans / curl+jq inspectors / 4-step
bootstrap-continuity-verify-checkpoint chains). Inline-chain resurrection
= drift. The verifyOperationalContinuity.js helper unit asserts that
canonical docs reference only ops:* commands.

  cd backend && npm run ops:term2         # pre-phase ritual
  cd backend && npm run ops:verify        # full regression matrix
  cd backend && npm run ops:checkpoint    # finalize / seal phase
  cd backend && npm run ops:state mlb     # live state inspection (requires TERM 1)
  cd backend && npm run ops:nightly       # nightly review chain
```

---

## COPY-PASTE BLOCK — NEW CHAT START HERE (legacy 7-file chain — also works)

```
FIRST — read these 7 canonical reconstruction anchor files IN ORDER before doing anything else:

1. /BOOTSTRAP_PROMPT.md          (this file — entry pointer)
2. /ACTIVE_PHASE.md              (what we are doing RIGHT NOW — answer in 30 seconds)
3. /PRODUCT_IDENTITY.md          (what the repo IS + must NEVER become — anti-drift anchor)
4. /CURRENT_PROBLEMS.md          (live bottleneck tracker — solved/active/deferred/dangerous/future)
5. /NEXT_PHASE.md                (single canonical next-step authority — replaces giant bootstrap prompts)
6. /OPERATIONAL_FLOW.md          (rituals — bootstrap, ship, regression, checkpoint, terminal conventions)
7. /DEFERRED_PHASES.md           (why X is deferred — prevents resurrecting dangerous ideas)

Total: ~700 lines across 7 files. Reconstructs full operating state.
Estimated drift reduction vs prior 15,000+ line surface: 70-90%.

If any file does not exist, state that explicitly and continue safely.

AFTER reconstruction, before any code touch:
  cd backend
  npm run brain:bootstrap
  npm run brain:continuity         # expect: PASS (0 issue, 0 warn)
  npm run brain:verify             # expect: PASS (0 FAIL)

LAST STEP BEFORE FINISHING — anchor-file + brain-doc reconciliation:
  Update /ACTIVE_PHASE.md          (reflect what was shipped)
  Update /CURRENT_PROBLEMS.md      (move shipped lever 🟡 → 🟢; add new 🟡 if surfaced)
  Update /NEXT_PHASE.md            (next phase or "awaiting operator selection")
  Update /CURRENT_STATE.md         (long-form session record)
  Update /NEXT_SESSION.md          (long-form next priorities)
  Update /backend/runtime/brain/{MASTER_BRAIN,CURRENT_RUNTIME_STATE,MODEL_EVOLUTION_LOG}.md
  Update /docs/OPERATOR_RUNBOOK.md (phase doctrine)
  cd backend && npm run brain:checkpoint   # expect: PASS (0 failure(s))
```

---

## ALTERNATE LEGACY ENTRY (for older chats / pre-Continuity-OS-1A muscle memory)

The prior entrypoint pattern is preserved for back-compat:

```
FIRST — read these before doing anything else:
- /WORKFLOW_RULES.md
- /CURRENT_STATE.md
- /NEXT_SESSION.md
```

Both entries lead to the same operating state. The 7-file anchor chain above is the deterministic-reconstruction-optimal path; the legacy 3-file chain works but requires more context-window consumption.

---

## MANDATORY RULES (always active)

### Session discipline
- Read CURRENT_STATE.md and NEXT_SESSION.md before any code analysis
- Never proceed blind — current state contains active bottlenecks and regression risks
- Update both docs at end of every successful session

### Terminal discipline
- DO NOT start, stop, restart, or manage servers
- ASSUME TERM 1 is already running the backend on port 4000
- ASSUME TERM 2 is controlled manually by the operator
- After any patch: state "TERM 1 restart: YES/NO" and "TERM 2 verification: [command]"

### Architecture discipline
- No new frameworks, no parallel systems, no new endpoints without explicit approval
- Extend through `backend/pipeline/shared/` — never alongside it
- All workstation data flows through `/api/ws/state` — don't add routes without explicit task

### Patch discipline
- Verify before patching: reproduce the problem with a real data trace first
- `node -e` smoke tests preferred for backend verification
- `node --check` on all modified `.js` files before finishing
- No lint errors on modified `.tsx/.ts` files

### Model discipline
| Task | Model |
|---|---|
| Root-cause audit on unknown bug | **Opus** |
| Implementing a verified fix | **Sonnet** |
| Doc updates, trivial edits | **Auto** |

Never use Auto for scoring, pipeline, or orchestration logic.

---

## WHAT THIS REPO IS

An intelligence-driven MLB/NBA betting workstation.

**Backend** (`backend/`):
- `pipeline/shared/` — all intelligence modules (featured plays, AI slips, portfolio, CLV, timing, line shopping, ledger, review)
- `pipeline/shared/adapters/` — sport-specific adapters (`mlbAdapter.js`, `nbaAdapter.js`)
- `routes/workstationRoutes.js` — main API, candidate diversification, featured/slip/portfolio orchestration
- `scripts/runMlbNight.js`, `scripts/runNbaNight.js` — nightly pipeline runners
- `runtime/tracking/` — flat JSON persistence (tracked bets, slips, ledger, graded props)

**Frontend** (`frontend/src/workstation/`):
- `sections/Dashboard.tsx` — command center (anchors, portfolio, featured grid)
- `sections/AiSlipsView.tsx`, `SlateBrowser.tsx`, `LineShoppingView.tsx`, `PortfolioView.tsx`, `BetBuilderView.tsx`, `ProcessReviewView.tsx`, `FirstBasketView.tsx`
- `types.ts` — all shared TypeScript interfaces
- `workstation.css` — single dark-theme stylesheet

---

## WHAT NOT TO DO (ever)

- Do NOT rebuild projection engines to fix balance — fix ecology at the surfacing layer
- Do NOT hard-force over/under percentages — preserve genuine edge candidates, don't inject fake ones
- Do NOT widen scope into SQL migration during active curation work
- Do NOT touch `runMlbNight.js` or `runNbaNight.js` without tracing exact candidate paths first
- Do NOT duplicate any existing intelligence module
- Do NOT add always-on daemons, polling loops, or background workers

---

## FUTURE DIRECTIONS (do not execute without explicit task)

**Extraction** (when scope opens):
- `diversifyCandidates` → `pipeline/shared/buildCandidateDiversity.js`
- `compactLineShopping` → `pipeline/shared/buildLineShoppingCompact.js`
- Inline helpers from `buildIntelligencePresentation.js` → dedicated shared modules

**SQLite migration** (when explicitly tasked):
1. `personal_ledger.json` first
2. `tracked_bets_*.json` second
3. `book_intelligence_state.json` third
4. `graded_props_*.json` fourth

---

## DOCS THAT MUST STAY CURRENT

| File | Update frequency |
|---|---|
| `CURRENT_STATE.md` | Every session — overwrite |
| `NEXT_SESSION.md` | Every session — overwrite |
| `WORKFLOW_RULES.md` | Only when rules change |
| `ARCHITECTURE.md` | When structural changes occur |
| `PIPELINES/*.md` | When pipeline behavior changes |
