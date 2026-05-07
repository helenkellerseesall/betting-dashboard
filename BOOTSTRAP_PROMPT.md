# BOOTSTRAP PROMPT
**Canonical repo rehydration entrypoint. Paste at the top of every new chat or session.**

---

## COPY-PASTE BLOCK

```
FIRST — read these before doing anything else:
- /docs/WORKFLOW_RULES.md
- /docs/CURRENT_STATE.md
- /docs/NEXT_SESSION.md

If any file does not exist, state that explicitly and continue safely.

LAST STEP BEFORE FINISHING:
Update:
- /docs/CURRENT_STATE.md  (overwrite with current live state)
- /docs/NEXT_SESSION.md   (overwrite with exact next priorities)
```

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
