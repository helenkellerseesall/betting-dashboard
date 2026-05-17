# ACTIVE PHASE
**Single source of truth for "what are we doing RIGHT NOW?" — answer in 30 seconds.**
**Overwrite at the START of every approved phase. Overwrite again at SEAL time.**

---

## CURRENT PHASE

| Field | Value |
|---|---|
| **Phase name** | Operational-Parity-1A (OP1A) |
| **Phase number** | 28th approved phase |
| **Status** | SHIPPED + SEALED |
| **Sealed at** | 2026-05-17 (this session) |
| **Type** | Infrastructure — canonical ops:* wrappers restored to FULL historical orchestration depth + parity enforcer |

---

## ONE-LINE OBJECTIVE

Consolidate the multiple competing operational flows (4 inline chain variants documented across 3+ continuity docs) into a SINGLE canonical `npm run ops:*` abstraction layer (6 commands + 3 NEW orchestrators) so fresh chats produce canonical commands instead of regenerating drift-prone inline chains.

---

## BOTTLENECK BEING SOLVED

New chats (Claude or GPT) drift catastrophically because canonical continuity reconstruction is incomplete:
- BOOTSTRAP_PROMPT.md points at long-form docs (CURRENT_STATE.md 6999 lines, MASTER_BRAIN.md 480 lines, OPERATOR_RUNBOOK.md 1200+ lines).
- New chat has to consume ALL of them + emotional context dumping just to know "what are we shipping today?"
- Result: chat re-solves solved problems / drifts into deprecated directions / forgets anti-fabrication boundaries.

---

## APPROVED LEVERS (COS-1C scope)

| Lever | File | Purpose |
|---|---|---|
| COS-1C-1 | `docs/OPERATIONAL_RECONCILIATION_AUDIT.md` | Audit map of competing flows + canonical layer proposal + doctrine lock plan |
| COS-1C-2 | `backend/package.json` + 3 NEW orchestrators | `ops:term2` / `ops:continuity` / `ops:verify` / `ops:checkpoint` / `ops:state` / `ops:nightly` (6 canonical commands) |
| COS-1C-3 | Checkpoint compression | `ops:checkpoint` = bootstrap + continuity + verify + brain:checkpoint in ONE command |
| COS-1C-4 | OPERATIONAL_FLOW + GPT_RECONSTRUCTION_BOOTSTRAP + BOOTSTRAP_PROMPT updates | Canonical ops layer section + explicit "DO NOT regenerate legacy inline chains" prohibition |
| COS-1C-5 | `verifyOperationalContinuity.js` (NEW) | 92 assertions: canonical scripts present + orchestrators exist + canonical docs reference ops:* + drift detection (no raw curl / no 4-step brain:* chain) + back-compat (brain:* / status / action commands preserved) |
| COS-1C-6 | Bootstrap operational compression | Fresh GPT reconstruction always restores canonical ops:* layer (asserted by verifier) |

Prior COS-1A/1B scope (still shipped):
- 6 anchor files at repo root + `GPT_RECONSTRUCTION_BOOTSTRAP.md` portable artifact

---

## DEFERRED LEVERS

None — operator approved full 6-file bundle.

---

## DO NOT TOUCH (operator-cemented, all 24 prior phases)

- ❌ Backend scoring redesign / ecology expansion / calibration changes
- ❌ Grading / settlement / replay / lineage / persistence pipelines
- ❌ FE component logic outside docs-pointer wiring
- ❌ Anti-fabrication invariants
- ❌ OCR / tesseract / multer / formidable / vision APIs / LLM parsing / adaptive AI styling

---

## CURRENT FE DIRECTION

| Surface | State | Pool |
|---|---|---|
| `🗺 Discover` | Layer 1 Battlefield | `state.discoveryCandidates` (broad canonical pool, ~85 MLB / ~40 NBA) |
| `⚡ Tonight's Edge` (Dashboard) | Layer 2 Curated Edge | `state.featured` (elite curation) |
| `📸 Check My Slip` (AnalyzeSlipView) | Layer 3 Compression | `/api/ws/screenshots/ingest` canonical VBI verdict |
| `🎲 AI Parlays` (AiSlipsView) | Layer 3 Compression | `state.aiSlips` |
| All other tabs | Unchanged | Elite `state.candidates` |

---

## CURRENT BACKEND DOCTRINE

- All FE surfaces consume `/api/ws/state` (single canonical entry-point).
- Discovery pool: same canonical source + same scoring helper + looser caps (`maxPerPlayer:8 / maxPerGame:60 / maxPerStat:60 / maxPerStatSide:35`).
- Elite pool: tight caps (`maxPerPlayer:3 / maxPerGame:7-12 / maxPerStat:10 / maxPerStatSide:6`). Portfolio / featured / aiSlips unchanged.
- ALL props canonical-validated (eligibleBets edge>0.04 + modelProb>0.20).
- ALL anti-fabrication doctrine cemented across 24 phases preserved.

---

## SUCCESS RIGHT NOW (COS-1C specific)

- ✅ 6 canonical `ops:*` scripts exist in `backend/package.json`
- ✅ 3 NEW orchestrators under `backend/scripts/ops/` (runAllVerifiers / showState / runNightlyReview)
- ✅ All 3 canonical continuity docs reference `ops:*` + explicit "DO NOT regenerate" prohibition
- ✅ `verifyOperationalContinuity.js` passes (92/92 assertions: scripts + orchestrators + canonical docs + drift detection + back-compat)
- ✅ `npm run ops:verify`: **33/33 PASS** (1 runtime + 27 verify\*.js + 5 probes)
- ✅ `cd frontend && npx tsc --noEmit` clean
- ✅ `npm run ops:checkpoint` PASS

---

## WHERE TO LOOK FOR DETAIL

| Question | File |
|---|---|
| What is the repo? | `PRODUCT_IDENTITY.md` |
| What are the bottlenecks? | `CURRENT_PROBLEMS.md` |
| What ships next? | `NEXT_PHASE.md` |
| How do I run/verify/checkpoint? | `OPERATIONAL_FLOW.md` |
| Why is X deferred? | `DEFERRED_PHASES.md` |
| Full session-by-session history | `CURRENT_STATE.md` + `backend/runtime/brain/MODEL_EVOLUTION_LOG.md` |
| Architecture blueprint | `ARCHITECTURE.md` |
| Operational rituals (full detail) | `docs/OPERATOR_RUNBOOK.md` |

---

## RECONSTRUCTION RULE FOR NEW CHATS

**Fastest path (Continuity-OS-1B)**: a fresh GPT or Claude chat reads ONE file:
- `GPT_RECONSTRUCTION_BOOTSTRAP.md` (~550 lines)

That single artifact contains 10 required sections covering identity / active phase / product state / bottlenecks / forbidden / FE direction / operational flow / deferred / next-phase options / instructions.

**Legacy 7-file chain (also works — preserved from COS-1A)**:
1. `BOOTSTRAP_PROMPT.md` → 2. `ACTIVE_PHASE.md` → 3. `PRODUCT_IDENTITY.md` → 4. `CURRENT_PROBLEMS.md` → 5. `NEXT_PHASE.md` → 6. `OPERATIONAL_FLOW.md` → 7. `DEFERRED_PHASES.md` (~775 lines total).

Reconstruction surface evolution:
- **Pre-COS-1A**: ~15,000 lines (CURRENT_STATE + MASTER_BRAIN + OPERATOR_RUNBOOK + MODEL_EVOLUTION_LOG + ARCHITECTURE + WORKFLOW_RULES).
- **After COS-1A**: ~775 lines (7-file anchor chain).
- **After COS-1B**: ~550 lines (single portable artifact).
- **Estimated drift reduction**: ~96%.
