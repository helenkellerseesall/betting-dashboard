# EXECUTION_BACKLOG.md — slices in flight + closed lineage

Single source of truth for slice-level execution state. Mirrors the
git-tag lineage. **Append-only by section; status mutations are inline
edits to the slice's row only.**

## Active slice

| field        | value |
|--------------|-------|
| slice        | oo-2-enforcement |
| lane         | INFRA / GOVERNANCE |
| owner        | assistant |
| started      | 2026-05-19 |
| status       | in-progress |
| tag-baseline | oo-1-orchestration |
| backlog-ref  | BBL-0004 |
| next-command | `node backend/scripts/verifyOperationalOrchestration.js` |
| risk-refs    | R-001-1, R-002-1, R-003-1 |

## Slice queue (sequenced; pull from top)

| seq | slice                       | lane                | blockedBy           | expected-outcome |
|-----|-----------------------------|---------------------|---------------------|------------------|
| 1   | oo-2-enforcement            | INFRA               | none                | THIS slice — structured footer + risk ledger + lane sync + playbook sync + checkpoint persistence + verifier G/H/I |
| 2   | item-0003-slice-3-nba-topology | INFRA            | oo-2-enforcement    | extend sportsbookTopology.json with NBA market keys; drop sport-gate in buildSlipAi |
| 3   | item-0004-slip-bookhydration-livecheck | ACTIVE EXECUTION | live regen   | confirm post-Slice-2 leanSlip writes hydrated slips; flip C-cluster empirical to all-PASS |
| 4   | item-0005-depth-feed-fallback | ACTIVE EXECUTION | none             | depthOf(lineupPosition) fallback in toTrackedMlbBestEntry; close R-003-1 |
| 5   | item-0006-nba-persistence-mirror | INFRA          | item-0005           | recordNbaBestProps whitelist parity with MLB Slice-1 lift |
| 6   | item-0007-role-relative-strength | INFRA          | items 0003-0006     | Law 30 axis-1 layer (role/archetype cognition) |

## Lane log

Chronological lane handoffs for the active slice. Append-only. Mutated
exclusively by `backend/scripts/ops/laneSync.js`.

- 2026-05-19 `oo-1-orchestration` — opened in INFRA / GOVERNANCE (Slice 1 foundation)
- 2026-05-19 `oo-1-orchestration` shipped → `oo-2-enforcement` opened in INFRA / GOVERNANCE — Slice 2 begins (enforcement implementation)

## Risk references

Active R-NNN-N IDs that the structured-checkpoint footer MUST carry
forward under `UNRESOLVED BLOCKERS → risks-open`. Source of truth is
`docs/OPEN_RISKS.md`.

- R-001-1 — NBA topology gate (lane: ACTIVE EXECUTION, slice: item-0003-slice-3)
- R-002-1 — Live slip-hydration empirical pending (lane: ACTIVE EXECUTION, slice: item-0004)
- R-003-1 — depthOf fallback unshipped (lane: INFRA / GOVERNANCE, slice: item-0005)

## Shipped slices (commit-lineage mirror)

| tag                                          | commit  | lane    | shipped-at | summary |
|----------------------------------------------|---------|---------|------------|---------|
| pre-item-0001-baseline                       | (parent) | -      | 2026-05-18 | baseline before Item 0001 survivability gate |
| item-0001-survivability (multiple commits)   | e05049c | INFRA  | 2026-05-18 | MLB survivability gate + FE indicator |
| pre-item-0002-baseline                       | (parent) | -      | 2026-05-19 | baseline before Item 0002 |
| item-0002-slice-1-shipped                    | e8b4c7d | INFRA  | 2026-05-19 | persistence whitelist hydration lift |
| item-0002-slice-1.5-verifier-supplement      | 737f06b | INFRA  | 2026-05-19 | verifier supplement + 4-book allowlist + Law 31 |
| pre-item-0003-baseline                       | (parent) | -      | 2026-05-19 | baseline before Item 0003 |
| item-0003-slice-1-topology                   | dc4411e | INFRA  | 2026-05-19 | 7-book allowlist + topology foundation |
| item-0003-slice-2-consumer-wiring            | 0bae822 | INFRA  | 2026-05-19 | curated consumer wiring + FE badge + leanSlip lift |
| oo-1-orchestration                           | TBD     | INFRA  | 2026-05-19 | orchestration infrastructure foundation (lane index + backlogs + footer template + verifier + 3 helper scripts) |
| oo-2-enforcement                             | TBD     | INFRA  | 2026-05-19 | THIS slice — enforcement implementation (structured footer + open-risks ledger + lane/playbook/checkpoint sync + verifier G/H/I) |

## Status legend

- **active** — current focus; only ONE slice may be active at a time
- **queued** — sequenced but not started
- **blocked** — has unresolved blockedBy
- **shipped** — closed with commit tag
- **deferred** — moved out of sequence by operator
