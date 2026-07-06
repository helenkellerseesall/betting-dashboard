# CLAUDE BRIDGE PROTOCOL

Cross-Claude communication discipline for this repo. **Both chats run in Cowork — they are distinguished by ROLE, not by app or model.** **Claude-A = the coordinator** (the operator's main chat: scopes work, verifies CB's output by reading the repo/log, writes plain-English summaries + CB handoff prompts; **NEVER commits to the repo**). **Claude-B / CB = the builder** (reads + edits code, runs probes, commits, ships, appends CB turn blocks). **Tie-breaker — if this chat has committed to the repo this session, it is CB; if it only scopes/verifies/summarizes and never commits, it is A.** Do not re-litigate identity with the operator — resolve it by behavior. Both chats read this file at the start of every meaningful turn.

## What this file IS

A protocol document defining the append schema and drift-signal vocabulary used inside `OPERATOR_SESSION_LOG.md`. It is **NOT** memory, **NOT** backlog, **NOT** continuity data.

## What this file IS NOT (anti-shadow-authority)

- NOT a duplicate task list — use the harness task list
- NOT a duplicate memory layer — memory lives in Claude-A's `/spaces/memory/` directory
- NOT a duplicate ship log — use `git log`
- NOT a duplicate continuity store — canonical is (repo state + git log + memory + OPERATOR_SESSION_LOG body + task list)

If this file ever grows beyond protocol — into ship history, audit content, or continuity data — it has become shadow authority and must be pruned back to protocol-only.

## Canonical authority hierarchy (unchanged)

1. Repo state + git log
2. Memory files (`/spaces/memory/`, Claude-A side)
3. `OPERATOR_SESSION_LOG.md` body (verbatim turn log)
4. Task list (harness-maintained backlog)
5. `.scratch/` probes (point-in-time diagnostics)
6. This file (protocol/discipline only)

Conversation context is volatile. This protocol is volatile-resistance discipline, not new authority.

## Turn block schema

Both Claudes append a structured block to `OPERATOR_SESSION_LOG.md` after each meaningful turn. Schema:

```
## YYYY-MM-DD HH:MM ET — Claude-[A|B]   (both run in Cowork; the A/B suffix is the ROLE)

ACTION: [one-line summary — drafted/built/audited/shipped/evaluated]

DRAFT_HANDOFF:
[if Claude-A drafted a handoff prompt for 4.8, paste it inside a fenced code block so 4.8 can read verbatim]

SHIP:
[if Claude-B shipped commits, list hashes + one-line summary each]

AUDIT_OUTCOME:
[if Claude-B ran an audit, summarize result + fork outcome (a/b/c) + key numbers traceable to .scratch/]

DRIFT_WARNING_TO_PEER:
[if peer's prior turn shows fabrication, scope error, premise drift, or rule violation — name it here]

NEXT_EXPECTED_FROM_PEER:
[what should happen on the other side next, including operator-gate]

PROBE_REFS:
[.scratch/ filenames if relevant]
```

Empty fields are omitted. A block ends at the next `## ` header.

## Drift signal vocabulary

Standard prefixes both sides recognize and act on:

- `DRIFT_WARNING_TO_PEER:` — concern about peer's framing/scope/numbers without specific rule break
- `RULE_VIOLATION_FLAG:` — explicit rule break (fabrication, gate-skip, scope creep, dead-wire ship, etc.) — cite the binding rule by name
- `PREMISE_CHECK_NEEDED:` — peer's plan assumes data that hasn't been probed; peer must probe before next edit
- `BLOCKED_ON:` — can't proceed until peer/operator does X (be specific about X)

Either side may flag any of the above. The other side reads them on its next turn and either addresses or contests (do not silently ignore).

## Operator workflow

1. Claude-A appends `## ... Claude-A` block to `OPERATOR_SESSION_LOG.md` (draft handoff + drift signals)
2. Claude-A gives operator a **plain-English summary** in chat of what the block says (NOT the full block — laymen's terms only)
3. Operator approves the summary
4. Operator pastes short pointer to the CB (builder) chat: `"read CLAUDE_BRIDGE_PROTOCOL.md + latest Claude-A block in OPERATOR_SESSION_LOG.md, execute per DRAFT_HANDOFF"`
5. CB reads, executes per its own discipline (regression-gate-first, audit-first, etc.), appends `## ... Claude-B` block (ship + audit + drift signals)
6. Operator pastes short pointer back to Claude-A: `"read latest Claude-B block in OPERATOR_SESSION_LOG.md"`
7. Claude-A reads block, gives operator a **plain-English summary** in chat of what CB did/found (NOT a re-dump — laymen's terms only)
8. Operator approves before Claude-A drafts next turn or proposes any action
9. Loop back to step 1

**Operator remains the execution gate.** No fence runs, no code commits, no edits ship, no next handoff drafts without operator approval. The bridge frees context budget; it does NOT remove the operator from the loop.

**Plain-English summary discipline (binding):**
- Translate technical findings into bettor-mission language ("the curation layer might be picking worse than random in middle odds — audit will tell us why")
- Numbers cited only if they trace to a probe/canonical file/git commit per `feedback_no_fabricated_numbers_in_scope_memos`
- Flag any drift signals from peer in plain terms ("4.8 noticed my framing missed X")
- Recommend a next step + the reasoning, but WAIT for operator approval

## Compaction-survival rule

On compaction, the first canonical authority both Claudes reconstruct from is (git log + memory + OPERATOR_SESSION_LOG tail + task list). This protocol file is part of that reconstruction set and must be re-read post-compaction before drafting any handoff.

## Append discipline

- Append, never edit prior blocks (immutable history)
- Timestamp in operator's local timezone (ET)
- Include code-block fences around any pasted handoff text so peer can copy verbatim
- Numbers in any field MUST trace to a probe/canonical file/git commit per `feedback_no_fabricated_numbers_in_scope_memos`

Related discipline: `feedback_no_fabricated_numbers_in_scope_memos`, `feedback_conversation_continuity_log`, `feedback_commit_durable_artifacts_same_turn`, `betting_dashboard_invariants`.

## TURN-BASED HANDOFF LOOP (2026-07-06, operator-mandated, BINDING)
Every chat turn ends in a concrete handoff artifact — a paste-ready prompt (CA), a commit + log block with a clear ASK when awaiting approval (CB/CC), or an operator fence/checkpoint. Never a dangling "go ahead" without the artifact. The loop: CB/CC act + commit + log block -> operator bounces "check cb/cc" to CA -> CA reads EVERYTHING since its last turn from the repo (git log + new A/B/C blocks + research tail, including any multi-round operator<->CB exchanges) -> CA evals -> CA hands the next artifact (approve/deny/append prompt, CC mandate, or fence). Operator = courier, approver, bettor. CA = show-runner. Approve/deny/append to CB is always a paste-ready prompt, not prose advice.
