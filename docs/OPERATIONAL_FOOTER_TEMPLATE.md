# OPERATIONAL_FOOTER_TEMPLATE.md — mandatory assistant response footer

Every assistant response that touches code or docs MUST end with this
footer. Operator should never wonder what's next.

**OO-2 (2026-05-19): structured-checkpoint footer is canonical.** The
short footer remains for trivial responses; the structured-checkpoint
footer is REQUIRED whenever a slice ships, a checkpoint is sealed, a
lane handoff occurs, or any bettor-visible mutation lands.

---

## Short footer (minor edits only)

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

---

## Structured-checkpoint footer (canonical — REQUIRED for slice closure, checkpoint, lane handoff, bettor-visible mutation)

```
---
**OPERATIONAL CHECKPOINT**

REPO STATE
- branch:               <git branch>
- commit:               <git SHA or "none (uncommitted)">
- tag:                  <git tag or "none">
- working-tree:         <clean | dirty (N files)>
- active-slice:         <slice id from EXECUTION_BACKLOG>
- active-lane:          <lane from EXECUTION_BACKLOG>
- v5:                   <PASS/FAIL ratio>
- fe-typecheck:         <PASS/FAIL>
- live-runtime:         <fresh (<24h) | stale (>24h) | not-run>

TERM 1 — read-only health introspection
- when:                 every fresh chat, before any mutation
- command:              (cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:term1)
- expected:             prints active slice, lane, v5 status, last checkpoint tag
- on-fail:              do NOT proceed; route to FULL SYSTEM AUDIT

TERM 2 — pre-phase ritual (slate + market + brain + runtime regression + helper-unit + probe matrix + Verification Telemetry V1)
- when:                 before opening any new slice OR before checkpoint
- command:              (cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:term2)
- expected:             full historical Term 2 chain passes; no orchestration-depth regression
- on-fail:              halt slice; route to INFRA / GOVERNANCE; open R-NNN-N risk

TERM 3 — checkpoint seal (ops:term2 + checkpointRepo + finalizeCheckpoint + git push + brain:checkpoint)
- when:                 immediately after slice ships and v5 passes
- command:              (cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:checkpoint)
- expected:             tag pushed, .checkpoint/operational_state_<tag>.json written, brain checkpoint sealed
- on-fail:              do NOT advance EXECUTION_BACKLOG status to shipped; reopen slice

GROUPED TERM BLOCK (copy-paste-safe from any cwd — repo root, backend/, frontend/, or any subdir)
```
(cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:term1) && \
(cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:term2) && \
(cd "$(git rev-parse --show-toplevel)/backend" && npm run ops:checkpoint)
```
Generate live with: `node backend/scripts/ops/runtime.js grouped-term`

NEXT
- next-lane:            <one of six lanes from docs/LANE_INDEX.md>
- next-action:          <single-sentence next action; ≤ 20 words>
- next-command:         <exact shell command; MUST resolve in scripts/ops/runtime.js registry>
- next-slice:           <next slice id from EXECUTION_BACKLOG.md Slice queue, or "same slice" if continuing>

FE VALIDATION
- target:               <exact URL or component path; e.g. http://localhost:5174/discover or frontend/src/components/FeaturedCard.tsx>
- expected-render:      <what the bettor sees if this slice succeeded; concrete, observable, ≤ 30 words>
- screenshot-path:      <relative path under docs/screenshots/ or "pending live regen">

BETTOR-VISIBLE EXPECTED RESULT
- surface:              <Discover | Featured | Curated Slip Tray | other named surface>
- outcome:              <exact bettor-observable change; e.g. "every curated slip leg renders a sportsbook badge" >
- counterfactual:       <what the bettor saw BEFORE this slice; what would prove regression>

UNRESOLVED BLOCKERS
- risks-open:           <R-NNN-N, ... or "none">
- backlog-open:         <BBL-NNNN OPEN/IN-SLICE entries or "none">
- live-empirical-gap:   <named gap or "none"; e.g. "Cluster C live-regen pending">

BACKLOG REFS
- closes:               <BBL-NNNN, ... or "none">
- touches:              <BBL-NNNN, ... or "none">
```

---

## Rules

1. EVERY field mandatory. If a field is N/A, write "none" — never omit.
2. `lane` and `active-lane` MUST match an entry in `docs/LANE_INDEX.md` exactly.
3. `slice` / `active-slice` / `next-slice` MUST match a row in `docs/EXECUTION_BACKLOG.md`.
4. `next-command` MUST be a single shell command AND MUST resolve to a name
   or `cmd` in `backend/scripts/ops/runtime.js`. Free-form commands are
   forbidden — extend the registry instead.
5. `next-step` / `next-action` is the human-readable next action. ≤ 20 words.
6. `risks-open` lists every unresolved risk ID from `docs/OPEN_RISKS.md`
   that has NOT been closed by this commit.
7. The footer is the LAST thing in the response. Nothing after it.
8. **Ambiguity ban (OO-2):** a structured footer with any field reading
   "tbd", "later", "see above", or empty is a verifier failure. Replace
   with a concrete value or `none`.
9. **Cwd-grouping rule (Runtime-Context-Hardening-1A):** every command in
   `next-command`, `TERM 1`, `TERM 2`, `TERM 3`, or a GROUPED TERM block
   MUST be either (a) an `anywhere`-cwd command, or (b) wrapped in a
   `(cd "$(git rev-parse --show-toplevel)/<target>" && ...)` subshell.
   Bare `cd backend && ...` is forbidden in the footer — it fails the
   moment the operator is already inside `backend/`. Use
   `node backend/scripts/ops/runtime.js safe <name>` or
   `... grouped-term` to generate the safe form.

## Verifier enforcement

`verifyOperationalOrchestration.js` asserts:

- A4 — this template file exists.
- G1 — template declares the structured-checkpoint section.
- G2 — TERM 1, TERM 2, TERM 3 sections are all present.
- G3 — FE VALIDATION, BETTOR-VISIBLE EXPECTED RESULT, UNRESOLVED BLOCKERS
  sections are all present.
- G4 — the ambiguity-ban rule is declared.
- G6 — TERM 1/2/3 command lines use the cwd-safe subshell form
  `(cd "$(git rev-parse --show-toplevel)/backend" && ...)`. Bare
  `cd backend && ...` in the template is a verifier failure.
- G7 — GROUPED TERM BLOCK section is present and well-formed.
- G8 — cwd-grouping rule is declared in `## Rules`.

The verifier cannot parse live conversation history but it can assert
the template, the lane index, the backlog files, the open-risks ledger,
and the runtime registry exist with the correct shape.
