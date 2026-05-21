# ACTIVE PHASE
**Single source of truth for "what are we doing RIGHT NOW?" — answer in 30 seconds.**
**Overwrite at the START of every approved phase. Overwrite again at SEAL time.**

---

## CURRENT PHASE

| Field | Value |
|---|---|
| **Phase name** | Player-Conviction-Engine-1A (PCE1A) |
| **Phase number** | 31st approved phase |
| **Status** | SHIPPED + SEALED |
| **Sealed at** | 2026-05-17 (this session) |
| **Type** | Intelligence — NEW additive small-cap composite weight (PCE_WEIGHT 0.05, additive ∈ [-0.04,+0.05]) for sustainable hitter legitimacy, derived from canonical lineupSpot × plateAppearancesProxy × stat-side coherence × model-trust; longshot-preserving (max penalty -0.04 cannot zero out a play); hitter-overs-only (pitcher / under bypass cleanly). NO LLM, NO ML, NO new fetches, NO popularity weighting. |

---

## ONE-LINE OBJECTIVE

Ship the canonical Player-Conviction-Engine-1A composite — an additive small-cap weight (`PCE_WEIGHT 0.05`, additive ∈ [-0.04, +0.05]) that expresses sustainable hitter-overs legitimacy from canonical signals already on the row context, with anti-fabrication and longshot-preservation hard-floored.

---

## BOTTLENECK BEING SOLVED

Hitter-overs with apparent edge but no sustainable conviction surface alongside genuinely-conviction-heavy hitter-overs with no signal to separate them at sort time. The repo had:
- per-stat edge (eligibleBets edge > 0.04) and model probability (> 0.20) as gates,
- ecology lifts (OE-1 through OE-9) for context,
- but no single composite that compresses lineupSpot × plateAppearancesProxy × stat-side coherence × model-trust into a sustainability signal.
Result: longshots with weak conviction surfaced equally with sustainable mid-cap hitters; sort-time ordering did not reflect "who is actually live tonight" the way the canonical ecology already implies.

---

## APPROVED LEVERS (PCE-1A scope — SHIPPED + SEALED)

| Lever | File | Purpose |
|---|---|---|
| PCE-1A-1 | `backend/pipeline/shared/playerConvictionEngine.js` (NEW) | Pure-function composite: lineupSpot × plateAppearancesProxy × stat-side coherence × model-trust → conviction ∈ [-0.04, +0.05]. Hitter-overs-only — pitcher / under bypass cleanly. Neutral fallback when any canonical absent. |
| PCE-1A-2 | `buildFeaturedPlays.js` integration | Additive composite weight `PCE_WEIGHT 0.05` applied at sort time on top of OE-2/3/4/8 ecology lifts. NEVER mutates underlying composite — additive only. |
| PCE-1A-3 | `verifyPlayerConvictionEngine1A.js` (NEW) | Verifier suite: anti-fabrication (no canonical invention), longshot-preservation (max -0.04 cannot zero out), hitter-overs scope (pitcher / under bypass), neutral fallback, additive-only doctrine. |
| PCE-1A-4 | `OPERATOR_RUNBOOK.md` append | PCE-1A entry — 31st sealed phase, doctrine + lever table + caps. Append-only ledger doctrine preserved. |

Prior cross-phase scope (still shipped, untouched):
- All 30 prior approved phases (Continuity-OS-1A/1B/1C, Sport-Identity-Integrity-1A, Candidate-Ecology-Parity-1A, OE-1A bundle, VBI-1A, BNSB-1A/1B, BNDS-1A/1B, Settlement-Orchestration-1A, Market-Ecology-1A, Persistence-1A/1B, etc.)
- 6-anchor repo-root surface + `GPT_RECONSTRUCTION_BOOTSTRAP.md` portable artifact
- Canonical `ops:*` abstraction layer (`ops:term2` / `ops:continuity` / `ops:verify` / `ops:checkpoint` / `ops:state` / `ops:nightly`)

---

## DEFERRED LEVERS (PCE-1A held)

- PCE-1B operator-tunable weight via observation window (held — needs >= 14 days of PCE-tagged outcome telemetry)
- PCE-1C symmetric pitcher-unders conviction composite (held — needs pitcher-side stat-coherence audit first)
- PCE-1D longitudinal `[PCE-1A]` counter persistence + retrospective ROI tracking (held — same dependency as OE-1E)

---

## OPEN BRIDGE GAP (NOT part of PCE-1A backend scope — flagged for FE-Asymmetry P1)

**Conviction-propagation gap (MCR-identified 2026-05-17 during R1-PASS-2):**
PCE-1A composite is computed at sort time inside `buildFeaturedPlays.js` and feeds the canonical `/api/ws/state` payload, but the FE surfaces (`🗺 Discover`, `⚡ Tonight's Edge`, slip cards) do not yet render conviction-tier signal as a bettor-visible cue. This is **plumbing / rendering**, NOT a backend scoring issue. It is **not a defect of PCE-1A** — the backend phase is sealed correctly per the additive-only + anti-fabrication invariants.

Routing: this gap belongs in **FRONTEND / UX LAB** as part of the FE-Asymmetry P1 workstream, alongside bottlenecks A-1 (slip emotional compression), A-2 (per-event hover cards), A-3 (portfolio bettor-language), A-4 (CLI invisible to FE), and A-5 (discovery survivability sort). The FE-Asymmetry P1 work is presentation-layer; it does NOT reopen PCE-1A backend.

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

## SUCCESS RIGHT NOW (PCE-1A specific)

- ✅ `backend/pipeline/shared/playerConvictionEngine.js` exists (pure function, neutral fallback, no fabrication)
- ✅ `PCE_WEIGHT 0.05` applied additively at sort time inside `buildFeaturedPlays.js` (never mutates composite)
- ✅ `verifyPlayerConvictionEngine1A.js` PASS (anti-fabrication + longshot-preservation + hitter-overs scope + additive-only)
- ✅ `npm run ops:verify`: **37/37 PASS** (31 verifiers + 5 canonical probes + 1 runtime suite)
- ✅ Brain checkpoint receipt sealed 2026-05-17T21:09Z PASS (sha256 hash-chain reconciled)
- ✅ `docs/OPERATOR_RUNBOOK.md` appended: PCE-1A as 31st sealed phase (append-only ledger preserved)
- ⚠️ Conviction propagation to FE — **separate FE-Asymmetry P1 workstream** (see OPEN BRIDGE GAP above). Not part of PCE-1A backend success criteria.

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
