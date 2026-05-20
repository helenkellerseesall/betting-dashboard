# backend/runtime/supervisor/ — canonical supervisor state directory

Phase A (verifier-first, 2026-05-20). NO daemon yet.

## Files

```
state.json              canonical state snapshot (supervisor-state-v1 schema)
events.log.jsonl        append-only event log (strict JSONL; tamper-evident chain)
state.lock              single-instance advisory lock (created by daemon at boot)
README.md               this file
```

## Read

```sh
node backend/scripts/ops/runtime.js run inspect-supervisor-state
```

## Verify integrity

```sh
node backend/scripts/verifySupervisorStateIntegrity.js
```

## Schema authority

`docs/RUNTIME_SUPERVISOR_STATE_SCHEMA.md` is the single source of schema.
Any field added/removed requires:
1. update to the schema doc
2. update to `state.json` template
3. update to `verifySupervisorStateIntegrity.js` Cluster B
4. commit-by-phase

## Operator override

`state.json -> operatorOverride.active = true` pauses ALL autonomous
supervisor actions. The daemon (Phase B+) MUST honor this absolutely.
Clearing the override is a deliberate operator command.

## Phase A scope-lock

This phase ships ONLY: schema doc + placeholder state.json + empty
events.log.jsonl + verifier. NO process supervision, NO file watcher,
NO HTTP server, NO FE — those are Phase B and beyond.
