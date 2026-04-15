TASK:

Active sport:
[SPORT]

Context:
- Use docs/cursor-master-charter.md as operating rules
- Work only on the active runtime path
- Do not drift from product structure or prediction intent

Problem:
[WHAT IS BROKEN OR NEEDS IMPROVEMENT]

Goal:
[WHAT SUCCESS LOOKS LIKE IN OUTPUT]

Scope:
- Which part of pipeline (ingest / boards / tickets / etc)

Constraints:
- Do not break other lanes
- Do not touch other sports unless required
- No unnecessary API calls
- Use snapshot/runtime first
- Max 1 refresh only if needed

Success criteria:
- [FIELD / BEHAVIOR 1]
- [FIELD / BEHAVIOR 2]
- [FIELD / BEHAVIOR 3]

Verification:
- Must prove using live :4000 output
- Must confirm no regression in:
  - support
  - longshot
  - bomb
  - tickets
