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

```yaml
id:            BBL-NNNN              # zero-padded; monotonically increasing
submittedAt:   YYYY-MM-DD            # operator submission date
submitter:     operator | assistant  # who created the entry
lane:          MCR | INFRA | ACTIVE EXECUTION | FRONTEND/UX LAB | FULL SYSTEM AUDIT | OPERATOR PLAYBOOK
title:         < 80 char summary
state:         OPEN | IN-SLICE | DEFERRED | CLOSED
linkedSlice:   item-NNNN-slice-N | none           # backlink to execution slice when claimed
evidence:      < commit SHA or screenshot path or "live empirical" >
body: |
  Multiline operator description. What was observed. What the bettor sees.
  Why it matters. What outcome would close the entry.
statusLog:
  - YYYY-MM-DD <state>: <reason>
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
state:        IN-SLICE
linkedSlice:  oo-1-orchestration
evidence:     this commit
body: |
  Cross-lane orchestration drift caused operator to repeatedly ask
  "what's the next command?" and "which lane?" after every checkpoint.
  Required: rolling canonical backlog, lane sync enforcement, mandatory
  operational footer, playbook auto-sync, runtime command registry.
statusLog:
  - 2026-05-19 OPEN: operator instruction
  - 2026-05-19 IN-SLICE: claimed by OO-1
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
