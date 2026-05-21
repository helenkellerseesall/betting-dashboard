# GSBL.md — GPT Session Bootstrap Layer

Phase A + B (skeleton; verifier-first; 2026-05-20).

**Purpose:** deterministic session reconstruction from canonical authority
files. POINTER, NOT CONTENT. Verifier-enforced compression cap.

**Compression cap:** 300 lines. Enforced by `verifyGSBLCompression.js`.

---

## Canonical authority pointers (single source of truth)

| domain                          | canonical path                                       |
|---------------------------------|------------------------------------------------------|
| six operational lanes           | `docs/LANE_INDEX.md`                                 |
| active slice + queue + risks    | `docs/EXECUTION_BACKLOG.md`                          |
| unresolved-risk ledger          | `docs/OPEN_RISKS.md`                                 |
| operator-submitted backlog      | `docs/BETTOR_BACKLOG.md`                             |
| operational footer template     | `docs/OPERATIONAL_FOOTER_TEMPLATE.md`                |
| operator runbook + doctrine     | `docs/OPERATOR_RUNBOOK.md`                           |
| product identity + invariants   | `PRODUCT_IDENTITY.md`                                |
| architecture laws (1–31)        | `backend/runtime/brain/ARCHITECTURE_LAWS.md`         |
| supervisor schema               | `docs/RUNTIME_SUPERVISOR_STATE_SCHEMA.md`            |
| supervisor live state           | `backend/runtime/supervisor/state.json`              |
| supervisor event chain          | `backend/runtime/supervisor/events.log.jsonl`        |
| canonical runtime commands      | `backend/scripts/ops/runtime.js`                     |
| cockpit (read-only port 4001)   | `backend/cockpit/server.js`                          |
| sportsbook allowlist            | `backend/pipeline/shared/sportsbookAllowlist.js`     |
| sportsbook topology             | `backend/pipeline/shared/sportsbookTopology.js`      |
| vig stripping                   | `backend/pipeline/shared/vigStripping.js`            |
| archetype weighting             | `backend/pipeline/shared/archetypeWeighting.js`      |
| survivability gate              | `backend/pipeline/shared/survivabilityGate.js`       |

---

## Startup sequence shell

A new session reconstructs canonical state by reading these files IN ORDER.
No content is duplicated here — pointers only.

```
1. read   docs/LANE_INDEX.md
2. read   docs/EXECUTION_BACKLOG.md           (Active slice + queue)
3. read   docs/OPEN_RISKS.md                  (carry-forward to footer)
4. read   docs/BETTOR_BACKLOG.md              (OPEN + IN-SLICE entries)
5. read   docs/OPERATIONAL_FOOTER_TEMPLATE.md (footer rules)
6. cat    backend/runtime/supervisor/state.json   (supervisor heartbeat)
7. run    node backend/scripts/verifyOperationalOrchestration.js
8. run    cd backend && npm run ops:verify    (full V5 matrix)
9. run    node backend/scripts/ops/groupedTerm.js --status
10. open  http://127.0.0.1:4001/cockpit       (if supervisor + cockpit running)
```

---

## Canonical commands

All operator-visible commands are registered in
`backend/scripts/ops/runtime.js`. Never invent or guess commands.

```
node backend/scripts/ops/runtime.js list           # all registered commands
node backend/scripts/ops/runtime.js show <name>    # one command + lane
node backend/scripts/ops/runtime.js run <name>     # emit literal shell
```

Common names: `v5`, `v5-fe`, `v6`, `regen-mlb`, `inspect-tracked-best`,
`inspect-tracked-slips`, `inspect-state-payload`, `next-step`, `backlog-list`,
`backlog-add`, `cognition-add`, `cognition-rank`, `cognition-next`,
`verify-sportsbook`, `verify-vig-stripping`, `verify-archetype`,
`verify-role-archetype`, `verify-supervisor-state`, `verify-cockpit`,
`verify-orchestration`, `verify-procedure-drift`, `supervisor-start`,
`supervisor-shutdown`, `supervisor-override-set`, `supervisor-override-clear`,
`cockpit-start`, `grouped-term`, `risk-add`, `risk-list`, `lane-sync`,
`playbook-sync`, `checkpoint-persist`.

---

## Operator interaction canon (placeholder)

Reserved section. Phase C will add canonical operator-interaction rules
(when implementation lands; not before).

For now: operator interaction follows
`docs/OPERATIONAL_FOOTER_TEMPLATE.md` Rules 1–9 (lane match · slice match ·
next-command from runtime registry · ambiguity ban · cwd-grouping rule).

---

## Forbidden in this file (enforced by verifier)

- ≤ 300 lines (hard cap)
- no long-form essay prose; pointer tables + bulleted lists only
- no roleplay markers; no character framing; no greeting boilerplate
- no recap of prior phase work — point at the EXECUTION_BACKLOG shipped table
- no references to prior chat sessions as authority
- no duplicated content from canonical files — cite the path
- no fenced JS code that performs runtime actions
- no claims that this file remembers state across sessions; state lives in
  canonical files cited above

---

## Rollback boundary

```
pre-gsbl-phase-a-baseline   → commit before this file existed
gsbl-phase-a-b              → commit that ships this skeleton + verifier

Rollback:
  git revert <gsbl-phase-a-b commit>
  → removes GSBL.md + verifier; canonical authority unchanged
```

---

## Phase C readiness criteria (NOT yet authorized)

- Phase A verifier (verifyGSBLCompression.js) at all-PASS for 7+ days
- Operator confirms session-reconstruction empirically deterministic
  across at least 3 fresh-chat boots
- No drift in canonical-authority-pointer table (every path resolves)
- No bloat creep — verifier line-count remains ≤ 300

Phase C scope (DEFERRED): dynamic ingestion hooks — supervisor state +
cockpit summary embedded inline at session boot, with explicit
freshness band; still pointer-not-content for everything else.

---

_Phase GSBL-A-B — 2026-05-20. Static structural skeleton. No runtime
ingestion. No regeneration daemon. POINTER, NOT CONTENT._
