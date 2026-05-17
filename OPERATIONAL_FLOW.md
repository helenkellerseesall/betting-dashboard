# OPERATIONAL FLOW
**Permanent workflow / ritual authority. Stable doc — rarely updated.**
**Cross-references `docs/OPERATOR_RUNBOOK.md` for per-phase doctrine. THIS file is the per-session ritual flow.**

---

## TERMINAL CONVENTIONS

| Terminal | Role |
|---|---|
| **TERM 1** | Backend dev server (`node backend/server.js` on port 4000). **NEVER auto-restarted by chat.** Operator manages manually. |
| **TERM 2** | Verifier / regression / probe runner. Chat invokes commands via tool calls; operator runs them locally. |

**Restart rule:**
- After any patch, chat must state: `TERM 1 restart: YES / NO` (YES iff backend logic / route handler / module export changed).
- After any patch, chat must list the exact `TERM 2 verification: <commands>` operator should run.

---

## PRE-PHASE RITUAL (every new chat / every phase start)

```bash
cd backend
npm run brain:bootstrap         # bootstraps receipt + brain doc hash
npm run brain:continuity        # asserts no drift since last checkpoint
npm run brain:verify            # asserts brain doc freshness (0 FAIL expected)
```

Then chat reads (in this order):
1. `BOOTSTRAP_PROMPT.md` (entry pointer)
2. `ACTIVE_PHASE.md` (what we're doing right now)
3. `PRODUCT_IDENTITY.md` (anti-drift anchor)
4. `CURRENT_PROBLEMS.md` (don't re-solve solved; don't ignore active)
5. `NEXT_PHASE.md` (where we go next)
6. THIS FILE (rituals)
7. `DEFERRED_PHASES.md` (don't resurrect dangerous ideas)

Then chat enters audit-first mode (trace before patch).

---

## AUDIT-FIRST RITUAL (before any patch)

1. Read the existing code path end-to-end (file:line trace).
2. Identify the exact choke point / collapse / missing wire.
3. Measure REAL counts when applicable (use real cache files; never estimate).
4. Write an audit doc at `docs/<PHASE_NAME>_AUDIT_2026-MM-DD.md` with:
   - Executive finding (1-2 sentences)
   - File:line citations
   - Lever menu (operator-approvable subset)
   - Operator-cemented DO-NOT-SHIP list
5. Await operator lever approval. **Never patch without explicit approval.**

---

## SHIP RITUAL (post-approval)

1. Implement approved lever(s) **additively** (NEW files preferred; existing files extended additively).
2. Run `cd frontend && npx tsc --noEmit` after every FE edit batch.
3. Run the new helper unit (`verifyXxx.js`) — must PASS before reconciliation.
4. Run prior verifiers (zero regression expected): `for f in backend/scripts/verify*.js; do node "$f" | tail -1; done`
5. If any prior verifier breaks → it's a legitimate phase evolution requiring assertion update. Update the prior verifier with a comment citing the evolution. **Never delete an assertion silently.**

---

## REGRESSION MATRIX RITUAL (full ceremony)

```bash
# Helper unit for THIS phase
node backend/scripts/verifyXxx.js                # expect: NN / NN assertions PASS

# 14-suite runtime verify
cd backend && npm run runtime:verify             # expect: 14/14 PASS

# Every verifier (zero regression)
for f in backend/scripts/verify*.js; do
  node "$f" | tail -1
done                                              # expect: every line "RESULT: PASS"

# 5-probe canonical integrity matrix
cd /Users/andrewmoore/Desktop/betting-dashboard
for p in probe_grading_backfill_v1.js probe_lineage_v1.js probe_epoch_authority_v1.js probe_persistence_idempotency_v1.js probe_ledger_mirror_v1.js; do
  node "$p" | tail -2
done                                              # expect: every probe "fail: 0"

# FE type-safety
cd frontend && npx tsc --noEmit                  # expect: clean (no output)
```

---

## 6-DOC RECONCILIATION RITUAL (always before checkpoint)

| Doc | What to update |
|---|---|
| `CURRENT_STATE.md` (repo root) | New session-record line at top with full phase narrative (prior records preserved as "Prior session record (Phase X): ..."). |
| `NEXT_SESSION.md` (repo root) | New session-record line at top (same pattern as CURRENT_STATE). |
| `backend/runtime/brain/MASTER_BRAIN.md` | New `_Last updated: ...` line at top + prior record archived below. |
| `backend/runtime/brain/CURRENT_RUNTIME_STATE.md` | Same pattern. |
| `backend/runtime/brain/MODEL_EVOLUTION_LOG.md` | NEW dated entry at top (append-only — never overwrite prior entries). |
| `docs/OPERATOR_RUNBOOK.md` | NEW phase doctrine section at top + filename trailer updated. |

---

## ANCHOR-FILE RECONCILIATION RITUAL (NEW, from Continuity-OS-1A; EXTENDED in 1B)

| Anchor file | Update trigger |
|---|---|
| `ACTIVE_PHASE.md` | Overwrite at start AND seal of every phase. Status field reflects current. |
| `NEXT_PHASE.md` | Overwrite when next phase approved (default state: "awaiting operator selection"). |
| `CURRENT_PROBLEMS.md` | Move shipped lever from 🟡 ACTIVE → 🟢 SOLVED with linked phase. Add NEW 🟡 ACTIVE entries surfaced by operator. |
| `PRODUCT_IDENTITY.md` | RARELY update — change only by explicit operator approval. |
| `OPERATIONAL_FLOW.md` (this file) | RARELY update — change only when a ritual changes. |
| `DEFERRED_PHASES.md` | Add NEW deferral when operator defers. Remove when prerequisite cleared + lever approved. |
| **`GPT_RECONSTRUCTION_BOOTSTRAP.md`** (NEW from Continuity-OS-1B) | **REGENERATE on EVERY phase seal.** Single portable artifact for fresh GPT chat reconstruction (~550 lines). Must stay synced with the 6 anchor files; `verifyContinuityOs1B.js` asserts the sync. `brain:checkpoint` FAILs if this file drifts. |

---

## FINALIZE / CHECKPOINT RITUAL (end of every session)

```bash
cd backend
npm run brain:bootstrap                          # re-stamp receipt if mid-session bootstrap was old
npm run brain:continuity                         # expect: PASS (0 issue, 0 warn after fresh bootstrap)
npm run brain:verify                             # expect: PASS (0 FAIL)
npm run brain:checkpoint                         # expect: CHECKPOINT RESULT: PASS (0 failure(s))
```

`brain:checkpoint` enforces:
- 3 backend brain docs reconciled (MASTER_BRAIN / CURRENT_RUNTIME_STATE / MODEL_EVOLUTION_LOG)
- 3 repo-root docs reconciled (CURRENT_STATE / NEXT_SESSION / docs/OPERATOR_RUNBOOK)
- 14/14 runtime verifiers PASS
- 5/5 probe matrix PASS
- Hash drift reconciled in receipt

If `brain:checkpoint` FAILs → fix the failure before declaring work done. Common failures:
- Stale brain doc → update + re-run
- Stale repo-root doc → update + re-run
- Probe matrix drift → investigate the probe that changed bytes

---

## PUSH FLOW

The repo currently does not auto-push. Operator handles git commit/push manually after `brain:checkpoint` PASS.

---

## FE INSPECTION FLOW (when touching FE)

```bash
# Layout / component structure
ls frontend/src/workstation/sections/
ls frontend/src/workstation/components/

# Types
cat frontend/src/workstation/types.ts | grep "export interface"

# API client
cat frontend/src/workstation/api.ts

# Type-check
cd frontend && npx tsc --noEmit
```

---

## RUNTIME INSPECTION FLOW (when investigating live state)

```bash
# Real candidate counts
node -e "
const tb = JSON.parse(require('fs').readFileSync('backend/runtime/tracking/mlb_tracked_bets_$(date +%Y-%m-%d).json', 'utf8'));
console.log('tracked_bets:', tb.length);
"

# Snapshot freshness
cd backend && npm run brain:status

# Backend probe of state route (requires TERM 1 running)
curl -s "http://localhost:4000/api/ws/state?sport=mlb" | jq '{
  candidates: (.candidates | length),
  discoveryCandidates: (.discoveryCandidates | length),
  aiSlips: { safe: (.aiSlips.safe | length), balanced: (.aiSlips.balanced | length), aggressive: (.aiSlips.aggressive | length), lotto: (.aiSlips.lotto | length) }
}'
```

---

## VERIFIER MATRIX (25 verifiers as of Continuity-OS-1A)

Run via `for f in backend/scripts/verify*.js; do node "$f" | tail -1; done`:

- verifyBettorCuration1A (83 assertions)
- verifyBnds1A (93 assertions)
- verifyBnds1B (35 assertions)
- verifyBnsb1A (132 assertions)
- verifyBnsb1B (84 assertions)
- verifyCalibrationHonesty
- verifyCompositeKeyIntegrity
- verifyContinuityOs1A (this phase)
- verifyLegacyApiSportsCacheGate
- verifyMarketExploitation1A (40 assertions)
- verifyMlbContextualPhase1
- verifyMlbContextualPhase1B
- verifyMlbCorrelationEngine1A (37 assertions)
- verifyMlbFutureOnlyHardening
- verifyMlbImmutabilityHardening
- verifyMlbLiveStatePhase2
- verifyNbaApiSportsContractFix
- verifyNbaCacheObservability
- verifyNbaCacheabilityGate
- verifyOffensiveEcology1A (101 assertions)
- verifyOffensiveEcology1B (61 assertions)
- verifyOrphanAuthorityHardening
- verifyResponseAuthority
- verifySnapshotFreshness
- verifyVisualBettingIntelligence1A (76 assertions)

Plus 14 runtime:verify suites + 5 probes (158 assertions).

---

## DANGER FLAGS (stop and surface to operator)

Stop work and surface to operator if any of these occur:
- A verifier breaks because of legitimate phase evolution → propose assertion update, don't silently delete
- A canonical field changes shape on backend → propose additive new field, don't mutate existing
- An operator-approved lever requires touching a DO-NOT-TOUCH path → propose alternative, don't blow through
- `brain:checkpoint` FAILs after >2 reconciliation attempts → surface the specific failure
- A new pattern emerges that's not covered by any existing doctrine → propose explicit operator-approved doctrine extension first
