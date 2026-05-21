# OPERATIONAL RECONCILIATION AUDIT — 2026-05-17

**Phase under audit:** Continuity-OS-1C (COS-1C) — operational reconciliation
**Audit type:** READ-ONLY. ZERO patches. ZERO backend logic touched. ZERO ecology / calibration / grading / settlement change.
**Substrate state:** 26 phases shipped · 26 verify\*.js PASS · 5/5 probe matrix · brain checkpoint sealed at 2026-05-17T11:14:31Z.

---

## EXECUTIVE FINDING

The repo currently exposes **operational rituals across three competing surfaces**:

1. **Canonical brain layer** (`backend/package.json scripts`): `brain:bootstrap` / `brain:continuity` / `brain:verify` / `brain:checkpoint`. Stable. Discoverable via `npm run`.
2. **Status helpers** (same package.json): `grading:status` / `calibration:status` / `lineage:status` / `market:status` / `epoch:status` / `engine:status` / `persistence:status` / `brain:status`. Stable. Read-only.
3. **Inline chains documented in continuity docs**: `for f in backend/scripts/verify*.js; do node "$f" | tail -1; done` / `for p in probe_*.js; do ...; done` / `npm run brain:bootstrap && npm run brain:continuity && npm run brain:verify && npm run brain:checkpoint` / `curl -s "http://localhost:4000/api/ws/state?sport=mlb" | jq ...`. **NOT discoverable. NOT consolidated. Drifts independently across docs.**

Plus one legacy: `backend/scripts/finalizeCheckpoint.sh` (Session K — manual git commit wrapper from before brain:checkpoint shipped).

**The doctrine gap:** every new chat (Claude OR GPT) reconstructs the inline chains from the docs. They are correct but inconsistent across BOOTSTRAP_PROMPT.md / OPERATIONAL_FLOW.md / GPT_RECONSTRUCTION_BOOTSTRAP.md / per-phase audit docs / per-phase ship reports. Drift is inevitable when the operational surface is documented but not codified.

**Recommendation:** ship a single canonical **`ops:*` abstraction layer** in `backend/package.json` + supporting orchestrator scripts under `backend/scripts/ops/`. Update all continuity docs to reference ONLY `npm run ops:*` commands. Verify-enforced: `verifyOperationalContinuity.js` asserts no inline chained-command resurrection in canonical docs.

---

## SECTION 1 — INVENTORY OF CURRENT FLOWS

### 1.1 — Canonical brain layer (KEEP — already canonical)

| Command | What it does | Doc references |
|---|---|---|
| `npm run brain:bootstrap` | Bootstraps receipt + brain doc hash | All continuity docs |
| `npm run brain:continuity` | Asserts no drift since last checkpoint | All continuity docs |
| `npm run brain:verify` | Asserts brain doc freshness | All continuity docs |
| `npm run brain:checkpoint` | Full checkpoint seal (3+3 doc + 14 verify + 5 probes) | All continuity docs |
| `npm run brain:status` | Quick brain freshness snapshot | OPERATOR_RUNBOOK |
| `npm run runtime:verify` | 14-suite runtime regression | OPERATIONAL_FLOW / GPT_RECONSTRUCTION_BOOTSTRAP |

### 1.2 — Status helpers (KEEP — read-only, single-purpose)

| Command | What it does |
|---|---|
| `npm run grading:status` | Grading pipeline state |
| `npm run calibration:status` | Calibration honesty state |
| `npm run lineage:status` | Prediction lineage state |
| `npm run market:status` | Line shopping market state |
| `npm run epoch:status` | Epoch authority state |
| `npm run engine:status` | Runtime engine state |
| `npm run persistence:status` | SQLite persistence state |

### 1.3 — Action helpers (KEEP — single-purpose actions)

| Command | What it does |
|---|---|
| `npm run grading:run` | One grading cycle |
| `npm run grading:review` | Post-graded review |
| `npm run grading:backfill` | Single-date backfill |
| `npm run grading:backfill-all` | All-date backfill |
| `npm run settlement:run` | Rolling settlement window |
| `npm run slate:refresh` | Force snapshot refresh |
| `npm run slate:nba` / `slate:mlb` | Sport-specific refresh |
| `npm run engine:start` / `engine:restart` | Manage Term 1 backend |
| `npm run persistence:probe` | Run 5 persistence probes |
| `npm run persistence:import` | Import historical data |
| `npm run persistence:backfill-aliases` | Backfill prediction aliases |

### 1.4 — Inline chains DOCUMENTED but NOT CODIFIED (DEPRECATE — replace with ops:*)

| Pattern | Where it appears | Replacement |
|---|---|---|
| `for f in backend/scripts/verify*.js; do node "$f" \| tail -1; done` | OPERATIONAL_FLOW.md / GPT_RECONSTRUCTION_BOOTSTRAP.md / BOOTSTRAP_PROMPT.md / per-phase ship reports | `npm run ops:verify` |
| `for p in probe_*_v1.js; do node "$p" \| tail -2; done` | OPERATIONAL_FLOW.md / GPT_RECONSTRUCTION_BOOTSTRAP.md / per-phase ship reports | `npm run ops:verify` (runs probes as part of full matrix) |
| `npm run brain:bootstrap && continuity && verify && checkpoint` (4-step chain) | OPERATIONAL_FLOW.md / GPT_RECONSTRUCTION_BOOTSTRAP.md / per-phase ship reports | `npm run ops:checkpoint` |
| `npm run brain:bootstrap && continuity && verify` (3-step pre-phase chain) | OPERATIONAL_FLOW.md / GPT_RECONSTRUCTION_BOOTSTRAP.md | `npm run ops:term2` (pre-phase ritual) |
| `curl -s "http://localhost:4000/api/ws/state?sport=mlb" \| jq ...` | OPERATIONAL_FLOW.md / GPT_RECONSTRUCTION_BOOTSTRAP.md | `npm run ops:state -- mlb` |
| `grading:run` → `grading:status` → `calibration:status` → `lineage:status` chain | Implicit in nightly review | `npm run ops:nightly` |
| `cd frontend && npx tsc --noEmit` | Multiple docs | KEEP as-is (already canonical; `ops:tsc` would just rename) |

### 1.5 — Legacy script (PRESERVED for git-commit muscle memory but NOT canonical)

| Script | Status |
|---|---|
| `backend/scripts/finalizeCheckpoint.sh` | Session K — manual git commit wrapper. Predates brain:checkpoint. Still works but not the canonical seal path. Keep for operator git muscle memory; `ops:checkpoint` is the canonical session seal (and does NOT auto-commit per existing operator preference). |

---

## SECTION 2 — COMPETING-FLOW DRIFT EVIDENCE

### 2.1 — Same ritual documented 3+ ways

The "pre-phase ritual" (`bootstrap → continuity → verify`) appears in:
- `BOOTSTRAP_PROMPT.md` (twice: once in the FASTEST PATH block, once in the legacy 7-file chain block)
- `OPERATIONAL_FLOW.md` § PRE-PHASE RITUAL (as a 3-line code block)
- `GPT_RECONSTRUCTION_BOOTSTRAP.md` § 7 (as a 3-line code block)
- Per-phase ship reports (inline in each phase's CURRENT_STATE.md narrative)

Each instance is correct today but drifts independently when a chat regenerates one and forgets the others.

### 2.2 — Regression matrix documented 4+ ways

The "regression matrix ritual" appears in:
- `OPERATIONAL_FLOW.md` § REGRESSION MATRIX RITUAL (3 sub-blocks: helper unit, runtime:verify, for-loop verifier scan, 5-probe scan, tsc)
- `GPT_RECONSTRUCTION_BOOTSTRAP.md` § 7 (same 3 sub-blocks)
- `BOOTSTRAP_PROMPT.md` legacy mandatory rules
- Every per-phase ship report (variant per phase)

The for-loop syntax is verbose and error-prone for a fresh chat to regenerate from memory.

### 2.3 — Curl + jq inline samples drift across docs

The "live state inspection" curl appears in:
- `OPERATIONAL_FLOW.md` § RUNTIME INSPECTION FLOW
- `GPT_RECONSTRUCTION_BOOTSTRAP.md` § 7
- Per-phase ship reports

Three near-identical curl+jq commands; one source of truth would be cleaner.

### 2.4 — Checkpoint seal documented 5+ ways

The "finalize / checkpoint ritual" appears in:
- `BOOTSTRAP_PROMPT.md` MANDATORY RULES
- `OPERATIONAL_FLOW.md` § FINALIZE / CHECKPOINT RITUAL
- `GPT_RECONSTRUCTION_BOOTSTRAP.md` § 7
- Per-phase ship reports (every phase's "Term 2 verify commands")
- `backend/scripts/finalizeCheckpoint.sh` (legacy git wrapper, conflicting role)

---

## SECTION 3 — CANONICAL OPS LAYER (proposed — operator-approvable lever menu)

Six canonical `ops:*` scripts in `backend/package.json` covering the four most-drifted rituals + two convenience aliases. All wrap existing canonical commands (no behavior change; just consolidation).

| Lever | Command | What it wraps | Replaces these inline chains |
|---|---|---|---|
| **COS-1C-2a** | `npm run ops:term2` | `brain:bootstrap && brain:continuity && brain:verify` | "pre-phase ritual" 3-step chain everywhere |
| **COS-1C-2b** | `npm run ops:continuity` | `brain:continuity` (alias for muscle memory) | One-liner alias |
| **COS-1C-2c** | `npm run ops:verify` | `node scripts/ops/runAllVerifiers.js` (NEW orchestrator: runtime:verify + every verify\*.js + 5 probes + summary) | The for-loop regression matrix everywhere |
| **COS-1C-3** | `npm run ops:checkpoint` | `brain:bootstrap && brain:continuity && brain:verify && brain:checkpoint` | The 4-step finalize chain everywhere |
| **COS-1C-2d** | `npm run ops:state` | `node scripts/ops/showState.js [sport]` (NEW orchestrator: curls /api/ws/state, pretty-prints summary) | The curl + jq one-liner |
| **COS-1C-2e** | `npm run ops:nightly` | `node scripts/ops/runNightlyReview.js` (NEW orchestrator: grading:status + calibration:status + lineage:status + settlement:run summary) | The implicit nightly chain |

**Operator-approvable bundle:** all 6 levers + 1 verifier (COS-1C-5) + doctrine docs update (COS-1C-4 + 6) ship together.

---

## SECTION 4 — DOCTRINE LOCK PROPOSAL (COS-1C-4 + 6)

Every continuity doc that currently shows an inline chained command MUST be updated to reference the canonical `ops:*` command instead:

| Doc | Current pattern | New pattern |
|---|---|---|
| `OPERATIONAL_FLOW.md` § PRE-PHASE RITUAL | 3-line bootstrap+continuity+verify block | `npm run ops:term2` |
| `OPERATIONAL_FLOW.md` § REGRESSION MATRIX RITUAL | 4-block for-loop + probes + tsc | `npm run ops:verify` + `cd frontend && npx tsc --noEmit` |
| `OPERATIONAL_FLOW.md` § FINALIZE / CHECKPOINT RITUAL | 4-line bootstrap+continuity+verify+checkpoint | `npm run ops:checkpoint` |
| `OPERATIONAL_FLOW.md` § RUNTIME INSPECTION FLOW | curl + jq one-liner | `npm run ops:state mlb` |
| `GPT_RECONSTRUCTION_BOOTSTRAP.md` § 7 | Same chains | Same canonical references |
| `BOOTSTRAP_PROMPT.md` | Same chains | Same canonical references |
| `ACTIVE_PHASE.md` SUCCESS section | Per-phase verifier count | Reference `npm run ops:verify` |
| Per-phase ship reports going forward | Custom inline chains | `npm run ops:verify` / `npm run ops:checkpoint` |

**Explicit prohibition** added to all 3 continuity docs:
> ⚠️ DO NOT regenerate legacy inline chained commands (for-loop verifier scans, curl+jq inspectors, multi-step bootstrap+checkpoint chains). The canonical operational layer is `npm run ops:*`. Fresh chats that regenerate inline chains are drifting. Use the canonical commands.

---

## SECTION 5 — LEGACY FLOW DETECTION (COS-1C-5)

NEW `backend/scripts/verifyOperationalContinuity.js` asserts:

1. All 6 canonical `ops:*` scripts present in `backend/package.json`.
2. `OPERATIONAL_FLOW.md` references `npm run ops:term2` / `ops:verify` / `ops:checkpoint` / `ops:state`.
3. `GPT_RECONSTRUCTION_BOOTSTRAP.md` § 7 references the canonical ops commands.
4. `BOOTSTRAP_PROMPT.md` references the canonical ops commands.
5. **No giant inline chained command resurrection** in canonical docs:
   - Forbids `for f in backend/scripts/verify` outside the audit doc + verifier source (the orchestrator legitimately uses it internally)
   - Forbids `for p in probe_` in canonical docs (orchestrator owns it)
   - Forbids the 4-step `brain:bootstrap && brain:continuity && brain:verify && brain:checkpoint` chain in canonical docs (only `ops:checkpoint`)
6. **No curl flows** in canonical docs (only `ops:state` reference). The legacy/historical audit docs in `docs/*_AUDIT_*.md` are exempt (frozen historical record).
7. Anchor file size discipline preserved (verifyContinuityOs1A and verifyContinuityOs1B still PASS).
8. `GPT_RECONSTRUCTION_BOOTSTRAP.md` § 7 OPERATIONAL FLOW documents the canonical `ops:*` layer explicitly + adds the explicit prohibition string.

---

## SECTION 6 — WHAT MUST NOT CHANGE (operator-cemented)

- ❌ NO removal or renaming of existing `brain:*` commands (`ops:checkpoint` wraps them; underlying calls preserved).
- ❌ NO removal of status helpers (`grading:status` etc.) — they remain single-purpose and discoverable.
- ❌ NO removal of action helpers (`grading:run` / `settlement:run` etc.) — they remain canonical single-purpose actions.
- ❌ NO modification of any verifier (`verify*.js`) — the orchestrator iterates them; their behavior preserved verbatim.
- ❌ NO modification of any probe (`probe_*_v1.js`) — orchestrator iterates them; their behavior preserved.
- ❌ NO removal of `backend/scripts/finalizeCheckpoint.sh` — preserved for operator git muscle memory; just no longer the canonical seal path (`ops:checkpoint` is).
- ❌ NO touching grading / settlement / ecology / calibration / persistence / replay / lineage logic.

---

## SECTION 7 — RECONSTRUCTION FLOW (target end-state)

After COS-1C ships, a fresh chat should reconstruct operating state by reading `GPT_RECONSTRUCTION_BOOTSTRAP.md` + see in § 7 OPERATIONAL FLOW:

```
PRE-PHASE RITUAL:
  cd backend && npm run ops:term2

REGRESSION MATRIX:
  cd backend && npm run ops:verify
  cd frontend && npx tsc --noEmit

LIVE STATE INSPECTION (requires TERM 1):
  cd backend && npm run ops:state mlb

FINALIZE / CHECKPOINT SEAL:
  cd backend && npm run ops:checkpoint

NIGHTLY REVIEW:
  cd backend && npm run ops:nightly
```

That's 5 commands replacing the prior ~15 inline chained variants. Fresh chats will produce these canonical commands by default because the docs they read only show these.

---

## STATUS

Operational reconciliation audit complete. Recommendation: ship lever bundle COS-1C-1 through COS-1C-6 + verifyOperationalContinuity.js together. Doctrine cemented: ONE canonical operational layer (`ops:*`) — legacy inline chains explicitly forbidden in canonical continuity docs going forward.
