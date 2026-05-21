# LANE_INDEX.md — canonical operational lane registry

Six lanes. Exact spelling enforced by `verifyOperationalOrchestration.js`.
Every backlog entry, slice, and operational footer MUST cite one lane
from this list. Lane evolution requires operator approval + commit
through this file.

## The six lanes

| lane                    | scope                                                          | owner |
|-------------------------|----------------------------------------------------------------|-------|
| MCR                     | roadmap, blockers, audits, current phase, operational routing  | operator |
| ACTIVE EXECUTION        | current implementation phase only                              | assistant |
| FULL SYSTEM AUDIT       | repo-wide audits, authority reconciliation, archaeology        | assistant |
| FRONTEND / UX LAB       | bettor-native UX, FE density, screenshots, comparison          | assistant |
| INFRA / GOVERNANCE      | ops, verifiers, continuity, checkpointing, governance enforcement | assistant |
| OPERATOR PLAYBOOK       | OPERATOR_RUNBOOK doctrine sync, runbook commands, footer template | assistant |

## Lane-routing rules (binding)

1. **Never** navigate work by recents. Always navigate by lane.
2. Operator can switch lanes mid-conversation; assistant must explicitly cite
   the new lane in the operational footer before executing.
3. Cross-lane handoffs MUST be logged as a backlog entry transition.
4. INFRA / GOVERNANCE owns this file + the verifier matrix.
5. MCR owns the sequencing of slices in `docs/EXECUTION_BACKLOG.md`.
6. ACTIVE EXECUTION runs slices but cannot re-sequence them.
7. FE / UX LAB captures screenshots + bettor validation evidence; cannot
   land closure on its own without ACTIVE EXECUTION + MCR.

## Footer requirement

Every assistant response that involves any code or doc mutation MUST
end with an operational footer (see `docs/OPERATIONAL_FOOTER_TEMPLATE.md`).
The footer cites the current lane, next-command, and next-step. The
operator should never have to ask "what's next" after reading a footer.
