# RUNTIME_SUPERVISOR_STATE_SCHEMA.md — canonical supervisor state schema

Phase A (verifier-first, 2026-05-20). NO daemon implementation yet — this
document declares the canonical schema + invariants the future supervisor
daemon MUST conform to. `verifySupervisorStateIntegrity.js` enforces.

## Canonical paths (frozen)

```
backend/runtime/supervisor/state.json        canonical state (atomic write target)
backend/runtime/supervisor/events.log.jsonl  append-only event log
backend/runtime/supervisor/state.lock        single-instance advisory lock
docs/RUNTIME_SUPERVISOR_STATE_SCHEMA.md      this doc (single source of schema)
```

## state.json schema (mandatory fields)

```yaml
schemaVersion:      "supervisor-state-v1"           # frozen identifier
instanceId:         UUID-v4 string                  # unique per supervisor process boot
pid:                number                           # OS pid that owns this state
host:               string                           # hostname
startedAt:          ISO-8601                         # UTC timestamp of supervisor start
heartbeatAt:        ISO-8601                         # UTC of last write
heartbeatSeq:       monotonically-increasing integer # never decreases between writes
contentHash:        SHA-256 hex                      # over canonical subset (excludes heartbeatAt/Seq/contentHash itself)
activeSlice:        string                           # mirrors EXECUTION_BACKLOG.md Active slice
activeLane:         "MCR" | "ACTIVE EXECUTION" | "FULL SYSTEM AUDIT" | "FRONTEND / UX LAB" | "INFRA / GOVERNANCE" | "OPERATOR PLAYBOOK"
operatorOverride:   { active: boolean, reason: string | null, sinceAt: ISO-8601 | null }
v5LastResult:       { totalChecks: number, pass: number, fail: number, ranAt: ISO-8601, commit: string }
v6LastResult:       { result: "PASS" | "FAIL", ranAt: ISO-8601, commit: string }
runtimeFreshness:   { mlbTrackedBestPath: string | null, mlbTrackedBestAgeMs: number | null }
openRisks:          [R-NNN-N, ...]                  # mirror of OPEN_RISKS.md open + mitigated
openBacklog:        [BBL-NNNN, ...]                 # OPEN + IN-SLICE BETTOR_BACKLOG entries
```

## events.log.jsonl schema (append-only)

Each line is one JSON object — strict JSONL. No multi-line entries. Never
delete or edit historical lines. New events ALWAYS append at EOF.

```yaml
ts:           ISO-8601 UTC
seq:          monotonically-increasing integer (matches heartbeatSeq at write time)
instanceId:   UUID-v4 of writing supervisor instance
eventType:    "boot" | "heartbeat" | "slice-open" | "slice-close" |
              "lane-handoff" | "risk-open" | "risk-close" | "backlog-add" |
              "backlog-close" | "v5-run" | "v6-run" | "regen-run" |
              "override-set" | "override-clear" | "supervisor-shutdown"
payload:      object (event-type-specific; never null)
prevHash:     SHA-256 hex of prior line's full JSON (or null on first line)
hash:         SHA-256 hex of this line's full JSON
```

`prevHash` + `hash` form a tamper-evident chain. Future enforcement: any
edit to a historical line breaks the chain at the next line.

## state.lock schema

Plain-text file containing the active instanceId. Future-supervisor advisory:
do NOT boot a second supervisor while state.lock matches a running pid.

## INVARIANTS (verifier-enforced)

1. `state.json` MUST conform to schemaVersion `supervisor-state-v1`.
2. `heartbeatSeq` MUST be monotonically non-decreasing between successive writes.
3. `contentHash` MUST equal SHA-256 over the canonical subset (excludes
   heartbeatAt, heartbeatSeq, contentHash itself).
4. `events.log.jsonl` MUST be strict JSONL — every non-empty line is parseable JSON.
5. Each event line MUST have `ts`, `seq`, `instanceId`, `eventType`, `payload`,
   `prevHash`, `hash` fields. No optional schema fields.
6. `seq` in events.log MUST be monotonically increasing.
7. `prevHash` of line N MUST equal the recomputed hash of line N-1 (chain integrity).
8. `activeLane` MUST be one of the six canonical lanes from `docs/LANE_INDEX.md`.
9. `operatorOverride.active === true` IMPLIES the supervisor MUST treat the
   operator as the canonical authority — no autonomous mutations during override.
10. Append-only discipline: no in-place edits of historical event lines.
    Append-only test: verifier compares line count + line hashes pre-/post-run
    when DAEMON-RUN-CHECK is gated on (Phase B).

## REPLAY / LIVE PARITY

Supervisor state is a SNAPSHOT — same inputs (same git SHA + same
EXECUTION_BACKLOG + same OPEN_RISKS) yield the same canonical content hash.
The supervisor MUST be deterministic — no Math.random, no per-process clock
drift in canonical fields beyond heartbeatAt.

## OPERATOR OVERRIDE — ABSOLUTE

When `operatorOverride.active === true`:
- supervisor pauses all autonomous slice-routing / risk-promotion / backlog-claim
- supervisor continues heartbeat writes + events.log appends (visibility preserved)
- supervisor surfaces a single-line "OVERRIDE ACTIVE" banner in TERM 1 output

Operator can clear via `node backend/scripts/ops/runtime.js run supervisor-override-clear`
(Phase B implementation; verifier asserts the command path is reserved today).

## PHASE A SCOPE-LOCK

This phase ships:
- canonical schema doc (this file)
- empty/template state.json + events.log.jsonl placeholders
- verifySupervisorStateIntegrity.js with PRE-CONDITION + POST-IMPL + drift assertions

This phase does NOT ship:
- daemon process / process supervision
- file watcher / inotify / fs.watch
- HTTP/WebSocket monitoring surfaces
- FE supervisor dashboards
- autonomous slice routing
- autonomous risk promotion
- autonomous backlog claiming

Verifier Cluster H asserts the scope-lock — failing the verifier when a
daemon-shaped file appears under `backend/runtime/supervisor/`.
