# BETTOR_BACKLOG.md — canonical operator-submitted backlog

Single source of truth for operator-submitted backlog entries (bug reports,
cognition gaps, FE inconsistencies, sportsbook governance requests, doctrine
proposals). **Append-only.** Never edit historical entries. Always add at the
bottom. Status mutations are appended as new dated lines on the same entry.

## How to submit

Operator (or assistant on operator's behalf) appends an entry using the
`scripts/ops/backlogAdd.js` helper (or hand-writes one using the schema
below). Every entry MUST carry the schema fields. Missing fields fail
`verifyOperationalOrchestration.js`.

## Entry schema (mandatory fields)

Phase BC-1 (Bettor Cognition Backlog Ingestion, 2026-05-19) extended the
schema additively. The 9 original fields remain mandatory; the new
cognition-ingestion fields are mandatory for every entry submitted via
`cognitionAdd.js` (post-BC-1), optional for legacy entries.

```yaml
id:                BBL-NNNN              # zero-padded; monotonically increasing
submittedAt:       YYYY-MM-DD            # operator submission date
submitter:         operator | assistant  # who created the entry
lane:              MCR | INFRA | ACTIVE EXECUTION | FRONTEND/UX LAB | FULL SYSTEM AUDIT | OPERATOR PLAYBOOK
title:             < 80 char summary
state:             OPEN | IN-SLICE | DEFERRED | CLOSED
linkedSlice:       item-NNNN-slice-N | bc-N | oo-N | none
evidence:          < commit SHA or screenshot path or "live empirical" or "none" >
body: |
  Multiline operator description. What was observed. What the bettor sees.
  Why it matters. What outcome would close the entry.
statusLog:
  - YYYY-MM-DD <state>: <reason>

# ── Phase BC-1 (2026-05-19) — bettor cognition fields ─────────────────────
cognitionCategory: role-archetype | sportsbook | market-psychology | timing |
                   gameflow | cashout | no-name-overload | superstar-gravity |
                   ladder-realism | deep-cut-prop-ecology | fe-workflow |
                   operational-friction | mobile-sportsbook-os |
                   feels-fake | realism | none
sportsbookCategory: DraftKings | FanDuel | Fanatics | Caesars | BetMGM |
                    Hard Rock | BetRivers | cross-book | none
uxTag:             discover | featured | curated-slip-tray | bet-builder |
                   recommendation-ladder | dashboard | none
severity:          critical | high | medium | low
                   # critical = bettor-trust-breaking or revenue-blocking
                   # high     = bettor frustration or misleading display
                   # medium   = workflow friction; not blocking
                   # low      = polish / nice-to-have
priority:          P0 | P1 | P2 | P3
                   # P0 = next execution slice candidate
                   # P1 = current sprint
                   # P2 = backlog; sequenced
                   # P3 = deferred
linkedRisks:       [R-NNN-N, ...] | []
                   # cross-link to docs/OPEN_RISKS.md entries
screenshots:       [docs/screenshots/BBL-NNNN-<slug>-<n>.png, ...] | []
                   # FE-pain evidence; convention enforced by verifier
feelsFakeFlag:     true | false
                   # operator-flag for "this surface feels fake / synthetic"
realismScore:      0-100 | null
                   # bettor-visible realism scoring; null when not yet rated
```

## Entries

```yaml
---
id:           BBL-0001
submittedAt:  2026-05-19
submitter:    assistant
lane:         INFRA
title:        Live FE Discover empty despite probe restoration of hydration
state:        CLOSED
linkedSlice:  item-0002-slice-1
evidence:     commit e8b4c7d + commit 737f06b + tag item-0002-slice-1.5-verifier-supplement
body: |
  Replay probe showed eventId+BC-1 restoration, but live FE Discover tab
  still rendered empty. Root cause: persistence-write path in
  phase4Tracking.toTrackedMlbBestEntry stripped eventId + BC-1 fields.
  Whitelist widening shipped + verifier supplement enforces live-runtime
  closure (no replay-only). Live regeneration on 2026-05-19 produced
  mlb_tracked_best_2026-05-19.json with 100% eventId / impliedTeamTotal /
  gameTotal / hrEnvironmentTag.
statusLog:
  - 2026-05-19 OPEN: operator-surfaced after Item 0001 BETTOR VALIDATION cycle
  - 2026-05-19 IN-SLICE: claimed by Item 0002 Slice 1
  - 2026-05-19 CLOSED: live regeneration verified (36/36 hydration)
---
id:           BBL-0002
submittedAt:  2026-05-19
submitter:    assistant
lane:         FRONTEND/UX LAB
title:        Curated slips emit with no book field on any leg
state:        CLOSED
linkedSlice:  item-0003-slice-2
evidence:     commit 0bae822 + verifySameBookConstructability B5/B6/B7 PASS
body: |
  Persisted mlb_tracked_slips_<date>.json emitted 8-14 slips with book:null
  on every leg. Root cause: phase4Tracking.leanSlip whitelist dropped book.
  Slice 2 leanSlip lift adds book/sportsbook on every leg + slip.book +
  slip.alternativeBooks. buildSlipAi emit boundary now enforces same-book
  via bestBookForSlip. FE FeaturedCard renders canonical book badge.
statusLog:
  - 2026-05-19 OPEN: surfaced by verifySportsbookConstructability Cluster C
  - 2026-05-19 IN-SLICE: claimed by Item 0003 Slice 2
  - 2026-05-19 CLOSED: structural wiring complete; awaiting live regeneration to flip Cluster C empirical
---
id:           BBL-0003
submittedAt:  2026-05-19
submitter:    operator
lane:         MCR
title:        Operator never again wonders what to run / what lane / what changed
state:        CLOSED
linkedSlice:  oo-1-orchestration
evidence:     oo-1-orchestration foundation files shipped; OO-2 enforcement extends
body: |
  Cross-lane orchestration drift caused operator to repeatedly ask
  "what's the next command?" and "which lane?" after every checkpoint.
  Required: rolling canonical backlog, lane sync enforcement, mandatory
  operational footer, playbook auto-sync, runtime command registry.
statusLog:
  - 2026-05-19 OPEN: operator instruction
  - 2026-05-19 IN-SLICE: claimed by OO-1
  - 2026-05-19 CLOSED: OO-1 foundation shipped (lane index + backlogs + footer template + verifier); enforcement carried into BBL-0004 / oo-2-enforcement
---
id:           BBL-0004
submittedAt:  2026-05-19
submitter:    operator
lane:         OPERATOR PLAYBOOK
title:        Prove orchestration behavior actually changed (Slice 2 enforcement)
state:        IN-SLICE
linkedSlice:  oo-2-enforcement
evidence:     this commit
body: |
  Slice 1 shipped the foundation (lane index + backlogs + footer template
  + verifier + 3 helper scripts). Slice 2 must enforce the behavior live.
  Required deliverables:
    1. structured-checkpoint footer with TERM 1/2/3, FE-validation target,
       bettor-visible expected result, unresolved blockers (ambiguity ban)
    2. canonical OPEN_RISKS.md ledger + R-NNN-N carry-forward to footer
    3. lane-sync helper that propagates lane handoff to all 3 surfaces
    4. playbook-sync helper that fires on slice close and asserts
       4-surface continuity propagation
    5. checkpoint-persist helper writing .checkpoint/operational_state_<tag>.json
    6. backlog-ingestion workflow via runtime registry (backlog-add /
       risk-add) — operator never hand-writes YAML
    7. unresolved-risk persistence via Risk references in EXECUTION_BACKLOG
       + structured footer carry-forward
    8. verifyOperationalOrchestration.js Clusters G/H/I/J enforcing all
       of the above
  Closure: verifyOperationalOrchestration.js PASS with G/H/I/J all green +
  one operator-driven dry-run of lane-sync / playbook-sync / checkpoint-persist
  + structured-checkpoint footer cited by ≥1 subsequent assistant response.
statusLog:
  - 2026-05-19 OPEN: operator instruction (operational orchestration slice 2)
  - 2026-05-19 IN-SLICE: claimed by oo-2-enforcement
---
```

## Closure rules

- Entry transitions to **CLOSED** only when `evidence` field cites a real
  commit SHA / tag / screenshot path AND `verifyOperationalOrchestration.js`
  recognizes the linked slice.
- **Never** retroactively edit a closed entry. Re-open by appending a new
  entry that references the prior id.
- The `lane` field MUST be one of the six canonical lanes (see
  `docs/LANE_INDEX.md`).

---
id:                BBL-0005
submittedAt:       2026-05-20
submitter:         operator
lane:              FRONTEND/UX LAB
title:             Discover surfaces too many no-name longshots; feels synthetic
state:             OPEN
linkedSlice:       none
evidence:          none
body: |
  Bettor sees lots of obscure no-name longshot pitchers dominating the Discover view; HR ladders feel synthetic.
statusLog:
  - 2026-05-20 OPEN: appended by cognitionAdd.js
cognitionCategory: no-name-overload
sportsbookCategory: DraftKings
uxTag:             discover
severity:          high
priority:          P1
linkedRisks:       []
screenshots:       []
feelsFakeFlag:     true
realismScore:      35
---
