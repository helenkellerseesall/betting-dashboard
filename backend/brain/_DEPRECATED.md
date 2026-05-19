# `backend/brain/` — ORPHAN LAYER DEPRECATION REGISTRY

**Stamped:** 2026-05-17 by Authority-Reconciliation-Sweep R1-PASS-2 (item R-6).
**Audit reference:** [`/FULL_SYSTEM_AUDIT_2026-05-17_PENDING_MCR.md`](../../FULL_SYSTEM_AUDIT_2026-05-17_PENDING_MCR.md) — section R1.B classification + R1.D step 11.
**Canonical successor:** [`/backend/runtime/brain/`](../runtime/brain/) (MASTER_BRAIN.md + OPERATOR_PROTOCOL.md + ARCHITECTURE_LAWS.md + PIPELINE_AUTHORITY_MAP.md + SPORTSBOOK_CONTRACTS.md + CURRENT_RUNTIME_STATE.md + ACTIVE_INCIDENTS.md + MODEL_EVOLUTION_LOG.md).

## Status of this directory

This directory is the **pre-Continuity-OS Cursor/ChatGPT-era brain layer**. It has been confirmed to have **0 live JS/TS consumers** (verified by `grep -rEn "backend/brain/(control|execution|memory|phase_map|recovery|rules|state|validation|chat_control)" backend/**/*.{js,ts}` excluding `runtime/` and `brain/` — zero matches as of 2026-05-17).

Files are **preserved verbatim** under additive-only doctrine. No file is deleted. This registry is the explicit deprecation marker for the entire layer; per-file marker requirement (R-6) is satisfied at directory granularity since the JSON files cannot carry markdown headers.

## Per-file classification

| File | Status | Reason | Canonical successor |
|---|---|---|---|
| `control.json` | **DEPRECATE** | Hard-coded `phase: 3` / `task: "stabilize_phase3"` — moot 28 phases later. | None — operational control is now distributed across `ops:*` scripts + `OPERATOR_PROTOCOL.md`. |
| `execution.json` | **DEPRECATE** | Cursor-era "ONE fix per cycle" loop discipline. | [`OPERATOR_PROTOCOL.md`](../runtime/brain/OPERATOR_PROTOCOL.md) (canonical AI-agent loop discipline). |
| `memory.json` | **ARCHIVE** | "criticalPatterns / knownBugs / fixHistory" — has lineage value documenting how the board-population fix was reasoned about. | [`MODEL_EVOLUTION_LOG.md`](../runtime/brain/MODEL_EVOLUTION_LOG.md) (canonical chronological history). |
| `phase_map.json` | **ARCHIVE** | Pre-canonical phase taxonomy (phase1–phase6). The repo's actual phase nomenclature evolved completely beyond this. | [`/docs/OPERATOR_RUNBOOK.md`](../../docs/OPERATOR_RUNBOOK.md) (canonical per-phase ledger). |
| `recovery.json` | **DEPRECATE** | Generic recovery discipline. | [`OPERATOR_PROTOCOL.md`](../runtime/brain/OPERATOR_PROTOCOL.md) + [`ARCHITECTURE_LAWS.md`](../runtime/brain/ARCHITECTURE_LAWS.md) (17 non-negotiable laws) + brain checkpoint discipline. |
| `rules.json` | **DEPRECATE** | Cursor-era `hardRules` / `chatBehavior`. | [`OPERATOR_PROTOCOL.md`](../runtime/brain/OPERATOR_PROTOCOL.md) + root [`OPERATIONAL_FLOW.md`](../../OPERATIONAL_FLOW.md) + invariants doctrine in [`PRODUCT_IDENTITY.md`](../../PRODUCT_IDENTITY.md). |
| `state.json` | **ARCHIVE** | Frozen at `phase3_to_bestProps_handoff` / `mlb_phase3_clusters_verified` — historical snapshot of a fix-in-progress state. | [`CURRENT_RUNTIME_STATE.md`](../runtime/brain/CURRENT_RUNTIME_STATE.md) (canonical live snapshot) + root [`CURRENT_STATE.md`](../../CURRENT_STATE.md) (canonical session ledger). |
| `validation.json` | **DEPRECATE** | Generic validation thresholds (`clusters >= 10`, `bestProps length > 0`). | [`verifyOrphanAuthorityHardening.js`](../scripts/verifyOrphanAuthorityHardening.js) + [`verifyOperationalParity.js`](../scripts/verifyOperationalParity.js) (canonical verifier-enforced operational flows). |
| `chat_control.md` | **DEPRECATE** | Cursor/ChatGPT-era protocol; carries explicit supersession header per R-6. | [`OPERATOR_PROTOCOL.md`](../runtime/brain/OPERATOR_PROTOCOL.md) (canonical AI-agent behavioral). |

## Disposition counts

- **DEPRECATE:** 6 (`control.json`, `execution.json`, `recovery.json`, `rules.json`, `validation.json`, `chat_control.md`)
- **ARCHIVE:** 3 (`memory.json`, `phase_map.json`, `state.json`)
- **RE-ANCHOR:** 0 (no orphan content rises to canonical worth)

## Doctrine

- **Additive-only doctrine respected:** zero files deleted, zero original bytes modified in the 8 JSON files. `chat_control.md` carries an in-place markdown supersession header (prepended, original content byte-identical below).
- **Anti-fabrication respected:** no synthetic state injected to make the layer "look canonical."
- **Replay safety respected:** any historical replay that touches these files will read the original Cursor-era content unchanged, with this registry as the explicit disposition reference.

## Verifier hook (deferred to R-7)

A proposed `verifyOrphanBrainLayer.js` (recommended in audit section R1.E) would:
1. Assert 0 live JS/TS references to `backend/brain/{control,execution,memory,phase_map,recovery,rules,state,validation,chat_control}.*`.
2. Read this registry and assert every file in `backend/brain/` (excluding this registry) carries either a DEPRECATE or ARCHIVE classification.
3. Fail if any file is added without explicit classification (re-anchor / archive / deprecate).

The verifier itself is NOT shipped in R1-PASS-2 — verifier authoring belongs in a subsequent R-7 governance-extension phase.

— end of registry —
