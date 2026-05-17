# OPERATIONAL PARITY AUDIT — 2026-05-17

**Phase under audit:** Operational-Parity-1A
**Audit type:** Behavior parity restoration. NO ecology / scoring / grading / settlement / FE touched.
**Trigger:** Operator observed `npm run ops:term2` completing in ~5s vs historical Term 2 ~60s+ — confirmed COS-1C wrappers were under-wired vs the historical canonical workflow.

---

## EXECUTIVE FINDING

COS-1C shipped `ops:*` as one-line `&&` chains of brain commands. That preserved **bootstrap+continuity+verify+checkpoint** but **dropped 3 historical authoritative subsystems** that the original Term 2 + checkpoint workflows included:

1. **Verification Telemetry V1** (`runVerification.js`, Session AK) — live TERM 1 backend probe + JSON artifact + deterministic NBA+MLB check matrix.
2. **Slate / market / lineage / calibration status helpers** — historically chained before runtime verify so operators saw context before running tests.
3. **Git checkpoint stages** (`checkpointRepo.js`/`finalizeCheckpoint.sh`/`git push origin stable-nba-engine`) — Session K sandbox-safe git workflow that's been preserved in scripts but never invoked by the ops layer.

This phase restores all three subsystems under the same canonical `ops:*` names — the previous `ops:term2` and `ops:checkpoint` are now backed by deeper orchestrators that chain the historical depth in canonical order. Behavior parity is enforced by NEW `verifyOperationalParity.js` (runs in the 28-verifier matrix).

---

## SECTION 1 — HISTORICAL TERM 2 INVENTORY

Per docs/WORKFLOW_RULES.md / docs/CURRENT_STATE.md / docs/VERIFICATION_TELEMETRY.md / docs/OPERATIONS_AUDIT_2026-05-14.md, the historical canonical Term 2 chain included:

| # | Step | Source | Read-only? |
|---|---|---|---|
| 1 | `slate:refresh` | `backend/scripts/slateRefresh.js` | Network read (odds API) |
| 2 | `slate:nba` | `backend/scripts/slateNba.js` | Network read |
| 3 | `slate:mlb` | `backend/scripts/slateMlb.js` | Network read |
| 4 | `market:status` | `backend/scripts/marketStatus.js` | Read-only |
| 5 | `calibration:status` | `backend/scripts/calibrationStatus.js` | Read-only |
| 6 | `lineage:status` | `backend/scripts/lineageStatus.js` | Read-only |
| 7 | `epoch:status` | `backend/scripts/epochStatus.js` | Read-only |
| 8 | `brain:bootstrap` | `backend/scripts/brain/loadBrainContext.js` | Receipt write only |
| 9 | `brain:continuity` | `backend/scripts/brain/assessContinuity.js` | Read-only |
| 10 | `brain:verify` | `backend/scripts/brain/verifyBrainFreshness.js` | Read-only |
| 11 | `runtime:verify` (14-suite regression) | `backend/scripts/runtimeVerify.js` | Read-only |
| 12 | Every `verify*.js` helper unit | `backend/scripts/verify*.js` | Read-only |
| 13 | 5-probe canonical integrity matrix | `probe_*_v1.js` (repo root) | Read-only |
| 14 | Verification Telemetry V1 against live TERM 1 | `backend/scripts/runVerification.js --sport=all` | Read-only HTTP probe + JSON artifact write |

COS-1C's `ops:term2` only covered steps 8-10. Steps 1-7, 11-14 were absent.

---

## SECTION 2 — HISTORICAL CHECKPOINT INVENTORY

Per Session K (`checkpointRepo.js` + `finalizeCheckpoint.sh`) + operator OP1A spec, the historical canonical checkpoint seal chain was:

| Stage | Command | Source | Notes |
|---|---|---|---|
| 1 | Full Term 2 verification | (everything in Section 1) | Required PASS before sealing |
| 2 | `node backend/scripts/checkpointRepo.js "<commit message>"` | `backend/scripts/checkpointRepo.js` (Session K) | Sandbox-safe; writes `.checkpoint/pending.json`; NEVER touches `.git/` |
| 3 | `bash backend/scripts/finalizeCheckpoint.sh` | `backend/scripts/finalizeCheckpoint.sh` (Session K) | Operator-finalized git commit using pending manifest; requires macOS terminal (sandbox lacks `.git/` write access) |
| 4 | `git push origin stable-nba-engine` | Direct git invocation | Pushes the sealed commit |
| 5 | `npm run brain:checkpoint` | `backend/scripts/brain/enforceBrainCheckpoint.js` | Brain continuity seal (3+3 doc + 14 verify + 5 probes; stamps receipt hash chain) |

COS-1C's `ops:checkpoint` only covered stage 5 (with steps 8-10 from Term 2 as pre-seal). Stages 1 (full Term 2), 2-4 (git stages) were absent.

---

## SECTION 3 — PARITY RESTORATION

Operational-Parity-1A restores full historical orchestration depth under the same canonical `ops:*` names by introducing **3 NEW orchestrators** under `backend/scripts/ops/`:

| Orchestrator | Replaces shallow wrapper | Chains historical depth |
|---|---|---|
| `runTerm2Workflow.js` | Inline `brain:bootstrap && brain:continuity && brain:verify` chain | All 14 Section 1 steps in canonical order with required/optional classification |
| `runCheckpointSeal.js` | Inline `brain:bootstrap && brain:continuity && brain:verify && brain:checkpoint` chain | All 5 Section 2 stages in canonical order |
| `showTerm1Status.js` | (no prior wrapper) | Read-only TERM 1 health probe; NEVER auto-starts/restarts (operator-cemented invariant from WORKFLOW_RULES + BOOTSTRAP_PROMPT) |

### Required vs Optional classification

The orchestrators distinguish REQUIRED (must PASS) from OPTIONAL (graceful degradation):

| Step | Class | Reason |
|---|---|---|
| brain governance (8-10) | **Required** | Continuity / governance invariants |
| runtime:verify (11) | **Required** | Regression matrix |
| ops:verify (helper-unit + probe matrix, 12-13) | **Required** | Zero-regression invariant |
| Slate / market / status helpers (1-7) | **Optional** | Network-bound (odds API); operator may run offline |
| Verification Telemetry V1 (14) | **Optional** (default) / **Required** with `--strict` | TERM 1 must be reachable; sandbox/offline environments don't have backend running |
| Git stages (Stage 2-4 in checkpoint) | **Optional** (default) / **Required** with `--strict` | Sandbox cannot write to `.git/` (virtiofs); operator running from macOS terminal gets full chain |
| brain:checkpoint (Stage 5) | **Required** | Continuity seal authority |

Use `--strict` flag to fail on any optional step (operator running locally with TERM 1 up + git access).

---

## SECTION 4 — DOCTRINE LOCK

Three continuity docs explicitly cement the "wrappers MUST preserve historical orchestration depth" doctrine:

1. **`OPERATIONAL_FLOW.md`** — adds Operational-Parity-1A doctrine block to the canonical ops layer section.
2. **`GPT_RECONSTRUCTION_BOOTSTRAP.md`** — § 7 OPERATIONAL FLOW table updated; ops:term2 and ops:checkpoint descriptions now read "wraps the full historical Term 2 / seal chain — preserves orchestration depth, never simplifies."
3. **`docs/OPERATOR_RUNBOOK.md`** — NEW Operational-Parity-1A doctrine section explicitly stating "Canonical ops commands are WRAPPERS around historical authoritative workflows. Behavior parity is mandatory. Operational compression must NEVER reduce orchestration depth."

---

## SECTION 5 — PARITY VERIFICATION (automated)

**NEW `verifyOperationalParity.js`** runs in the 28-verifier matrix on every `ops:verify` / `ops:checkpoint`. Asserts:

- All 6 canonical ops:* scripts present + invoke expected orchestrators.
- `runTerm2Workflow.js` chains every historical Term 2 step (14 commands grep-asserted in source).
- `runCheckpointSeal.js` chains every historical seal stage (5 stages grep-asserted in source).
- `showTerm1Status.js` NEVER calls `engine:start` / `engine:restart` (operator-cemented invariant).
- Doctrine docs cite Operational-Parity-1A + "historical orchestration depth" + "WRAPPERS" terminology.
- Historical authoritative scripts (`checkpointRepo.js` / `finalizeCheckpoint.sh` / `runVerification.js`) preserved verbatim with their canonical headers.

If any verification fails, `ops:checkpoint` will FAIL at brain:checkpoint stage (since verifyOperationalParity runs in the matrix).

---

## SECTION 6 — ZERO REGRESSION

This phase TOUCHES ONLY:
- `backend/package.json` (3 ops:* targets re-pointed to orchestrators; 1 NEW ops:term1)
- `backend/scripts/ops/` (3 NEW orchestrators; existing runAllVerifiers / showState / runNightlyReview UNCHANGED)
- `backend/scripts/verifyOperationalContinuity.js` (1 assertion relaxed to accept orchestrator invocation)
- 6 continuity docs (additive doctrine sections)

ZERO touches to:
- Any backend logic / route handler / pipeline module
- Any FE component / type / API client
- Any grading / settlement / ecology / calibration / persistence / replay / lineage
- Any helper unit verifier (`verify*.js` — except 1 assertion relaxation noted above)
- Any probe script
- The historical authoritative scripts (`checkpointRepo.js` / `finalizeCheckpoint.sh` / `runVerification.js`) preserved verbatim

---

## STATUS

Operational parity restored. The canonical `npm run ops:*` layer now invokes the FULL historical authoritative workflow. `verifyOperationalParity.js` enforces the invariant permanently — any future drift (someone simplifying away a historical step) fails `ops:checkpoint`.

The honest one-line: **canonical ops commands are wrappers, never replacements.**
