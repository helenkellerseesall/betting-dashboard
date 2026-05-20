# OPEN_RISKS.md — canonical unresolved-risk ledger

Single source of truth for unresolved operational risks. Every risk has
an R-NNN-N id and is carried forward in the structured-checkpoint footer
under `risks-open` until explicitly closed.

**Append-only.** Never edit historical entries. Status mutations are
appended as new dated lines on the same entry.

## How to add / list

```
node backend/scripts/ops/riskAdd.js  <lane> "<title>"   # appends a new R-NNN-N
node backend/scripts/ops/riskList.js                    # prints open risks
```

## Entry schema (mandatory fields)

```yaml
id:          R-NNN-N             # zero-padded; monotonically increasing
openedAt:    YYYY-MM-DD
openedBy:    operator | assistant
lane:        MCR | ACTIVE EXECUTION | FULL SYSTEM AUDIT | FRONTEND/UX LAB | INFRA | OPERATOR PLAYBOOK
slice:       <slice id from EXECUTION_BACKLOG.md when known, else "none">
title:       < 80 char summary
state:       OPEN | MITIGATED | CLOSED
body: |
  Multiline description. What's at risk. What would close it.
  Concrete observable test for closure.
statusLog:
  - YYYY-MM-DD <state>: <reason>
```

## Carry-forward rule

A risk in state OPEN or MITIGATED MUST appear in the
`UNRESOLVED BLOCKERS → risks-open` field of every structured-checkpoint
footer until it transitions to CLOSED. Closure requires:

1. Append a `statusLog` line with state CLOSED and a commit-SHA reason.
2. Append the commit-SHA to the entry's `body` or `statusLog`.
3. Re-run `verifyOperationalOrchestration.js`; H-cluster must PASS.

## Entries

```yaml
---
id:          R-001-1
openedAt:    2026-05-19
openedBy:    assistant
lane:        ACTIVE EXECUTION
slice:       item-0003-slice-3-nba-topology
title:       NBA sportsbookTopology.json not yet extended; buildSlipAi still sport-gated
state:       OPEN
body: |
  After Item 0003 Slice 2 ships, NBA slip emission still falls back through
  the sport-gate in buildSlipAi because sportsbookTopology.json only carries
  MLB market keys. Slice 3 extends topology and removes the gate.
  Closure: NBA tracked_slips_<date>.json emits with hydrated book on every
  leg AND Cluster C empirical flips to all-PASS for NBA.
statusLog:
  - 2026-05-19 OPEN: surfaced by EXECUTION_BACKLOG row item-0003-slice-3
---
id:          R-002-1
openedAt:    2026-05-19
openedBy:    assistant
lane:        ACTIVE EXECUTION
slice:       item-0004-slip-bookhydration-livecheck
title:       Post-Slice-2 leanSlip hydration awaits live regeneration empirical
state:       OPEN
body: |
  Structural wiring for leg.book + slip.book is shipped (BBL-0002 CLOSED),
  but live regeneration on the operator machine is required to flip
  verifySportsbookConstructability Cluster C from structural-PASS to
  empirical-PASS. Live ops:checkpoint cycle pending.
  Closure: live mlb_tracked_slips_<today>.json shows withSlipBook ===
  total AND withLegBooks === sum(legs).
statusLog:
  - 2026-05-19 OPEN: surfaced by EXECUTION_BACKLOG row item-0004
---
id:          R-003-1
openedAt:    2026-05-19
openedBy:    assistant
lane:        INFRA / GOVERNANCE
slice:       item-0005-depth-feed-fallback
title:       toTrackedMlbBestEntry depthOf fallback not yet shipped (R-EXEC-2)
state:       OPEN
body: |
  Lineage probe surfaced that depthOf(lineupPosition) is unset on a subset
  of tracked-best entries. Slice 0005 ships the fallback.
  Closure: probe_lineage_v1.js shows depth field hydrated on 100% of
  current-day MLB tracked_best entries AND verifyLineageContinuity PASS.
statusLog:
  - 2026-05-19 OPEN: carried forward from prior session
---
id:          R-004-1
openedAt:    2026-05-19
openedBy:    operator
lane:        OPERATOR PLAYBOOK
slice:       runtime-context-hardening-1a
title:       Grouped-runtime cwd collision — `cd backend && ...` fails when operator already in backend/
state:       OPEN
body: |
  Empirical failure during Item-0009 execution: when the operator runs a
  grouped TERM block (or any registry command with cmd prefix
  `cd backend && ...`) while already inside backend/, the shell emits:
    sh: line 1: cd: backend: No such file or directory
  Root cause: COMMANDS entries baked relative-cd prefix into the `cmd`
  field without cwd-awareness. Grouped chains amplified the failure mode.
  Closure (binding):
    1. Every COMMANDS entry declares cwd ∈ {repoRoot, backend, frontend,
       anywhere} + body (cd-stripped).
    2. safeCmd(name) emits subshell-wrapped form anchored at
       `$(git rev-parse --show-toplevel)` — paste-from-any-cwd safe.
    3. runtime.js exposes `safe`, `grouped`, `grouped-term`, `cwd-detect`
       verbs.
    4. OPERATIONAL_FOOTER_TEMPLATE TERM 1/2/3 cite safe form; GROUPED
       TERM BLOCK section added; cwd-grouping rule binds.
    5. verifyOperationalOrchestration.js Cluster K PASS.
    6. Empirical: from backend/, `node scripts/ops/runtime.js safe v5`
       emits a subshell form that runs without cwd error.
statusLog:
  - 2026-05-19 OPEN: empirical drift surfaced during Item-0009 execution
---
```

## Closure rules

- Closure requires a commit SHA cited in `statusLog`.
- `verifyOperationalOrchestration.js` Cluster H enforces schema + carry-forward.
- A risk may NOT be silently deleted. Use state CLOSED with a CLOSED `statusLog`
  line.
