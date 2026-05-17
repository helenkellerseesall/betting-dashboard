# ACTIVE PHASE
**Single source of truth for "what are we doing RIGHT NOW?" — answer in 30 seconds.**
**Overwrite at the START of every approved phase. Overwrite again at SEAL time.**

---

## CURRENT PHASE

| Field | Value |
|---|---|
| **Phase name** | Continuity-OS-1B (COS-1B) |
| **Phase number** | 26th approved phase |
| **Status** | SHIPPED + SEALED |
| **Sealed at** | 2026-05-17 (this session) |
| **Type** | Infrastructure — portable single-file cross-chat reconstruction artifact |

---

## ONE-LINE OBJECTIVE

Consolidate the COS-1A 6-anchor chain (~775 lines across 6 files) into a SINGLE portable artifact (`GPT_RECONSTRUCTION_BOOTSTRAP.md`, ~550 lines) so a fresh GPT chat can reconstruct full operating state by uploading ONE file.

---

## BOTTLENECK BEING SOLVED

New chats (Claude or GPT) drift catastrophically because canonical continuity reconstruction is incomplete:
- BOOTSTRAP_PROMPT.md points at long-form docs (CURRENT_STATE.md 6999 lines, MASTER_BRAIN.md 480 lines, OPERATOR_RUNBOOK.md 1200+ lines).
- New chat has to consume ALL of them + emotional context dumping just to know "what are we shipping today?"
- Result: chat re-solves solved problems / drifts into deprecated directions / forgets anti-fabrication boundaries.

---

## APPROVED LEVERS (COS-1B scope)

| Lever | File | Purpose |
|---|---|---|
| COS-1B-1 | `GPT_RECONSTRUCTION_BOOTSTRAP.md` | Single portable artifact consolidating the 6-anchor chain (~550 lines, 10 required sections) |
| COS-1B-2 | `verifyContinuityOs1B.js` | Asserts the artifact exists + 10 required sections + line budget + cross-consistent with 6 anchors + active-phase synced + forbidden directions preserved |
| COS-1B-3 | `OPERATIONAL_FLOW.md` extension | Anchor-file reconciliation ritual EXTENDED to include `GPT_RECONSTRUCTION_BOOTSTRAP.md` — REGENERATE on every phase seal; brain:checkpoint FAILs if drift |
| COS-1B-4 | `BOOTSTRAP_PROMPT.md` update | NEW "⚡ FASTEST PATH" entry block instructing fresh GPT chats to upload the ONE file |

Prior COS-1A scope (still shipped, 6 anchor files at repo root):
- ACTIVE_PHASE / PRODUCT_IDENTITY / CURRENT_PROBLEMS / NEXT_PHASE / OPERATIONAL_FLOW / DEFERRED_PHASES

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

## SUCCESS RIGHT NOW (COS-1B specific)

- ✅ `GPT_RECONSTRUCTION_BOOTSTRAP.md` exists at repo root (~550 lines, 10 sections)
- ✅ `verifyContinuityOs1B.js` passes (artifact + sections + line budget + cross-consistency)
- ✅ `OPERATIONAL_FLOW.md` anchor-file reconciliation extended to include this file
- ✅ `BOOTSTRAP_PROMPT.md` "FASTEST PATH" block prepended for fresh GPT chats
- ✅ 26/26 verify\*.js PASS · 14/14 runtime:verify · 5/5 probes
- ✅ `brain:checkpoint` PASS

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
