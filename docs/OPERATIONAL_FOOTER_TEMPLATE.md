# OPERATIONAL_FOOTER_TEMPLATE.md — mandatory assistant response footer

Every assistant response that touches code or docs MUST end with this
footer. Operator should never wonder what's next.

## Template (copy-paste skeleton)

```
---
**OPERATIONAL FOOTER**
- lane:           <one of six from docs/LANE_INDEX.md>
- slice:          <active slice id from docs/EXECUTION_BACKLOG.md>
- commit:         <git SHA or "none">
- tag:            <git tag or "none">
- v5:             <PASS/FAIL ratio>  e.g. 47/45 PASS (2 expected-FAIL live-runtime stale)
- backlog-refs:   <BBL-NNNN, ...>
- next-command:   <single canonical shell command from scripts/ops/runtime.js or "none">
- next-step:      <single-sentence next action; what the operator must do or what the assistant will do next>
- risks-open:     <R-NNN-N, ... or "none">
```

## Rules

1. EVERY field mandatory. If a field is N/A, write "none" — never omit.
2. `lane` MUST match an entry in `docs/LANE_INDEX.md` exactly.
3. `slice` MUST match an active row in `docs/EXECUTION_BACKLOG.md`.
4. `next-command` MUST be a single shell command. If the next step is
   operator-action (read screen, run regen runbook on live machine),
   write the literal command (e.g. `cd backend && npm run ops:verify`).
5. `next-step` is the human-readable next action. Keep ≤ 20 words.
6. `risks-open` lists every unresolved risk ID from prior checkpoints
   that has NOT been closed by this commit.
7. The footer is the LAST thing in the response. Nothing after it.

## Verifier enforcement

`verifyOperationalOrchestration.js` parses the prior assistant response
when running locally (informational) and asserts the footer template
exists at `docs/OPERATIONAL_FOOTER_TEMPLATE.md`. The verifier cannot
parse live conversation history but it can assert the template, the
lane index, and the backlog files exist with the correct shape.
