# Cold-start recovery procedure

**For a fresh Claude (operator-side OR build-side) starting with no chat context.** Created 2026-06-06 to harden against simultaneous-compaction drift. Read this BEFORE responding to operator.

**Why this file exists in the repo (not just memory):** memory loading is reliable but not infallible. A repo-root file is the most durable surface — `git clone` reproduces it. If memory doesn't load, this file is the recovery anchor.

**This file is SELF-MAINTAINING by design.** It does not bake in commit hashes, phase names, or fix counts — those go stale every ship. Instead it points at surfaces that ARE always current. The procedure steps are stable; the data they read is live.

---

## Step 1 — read memory first if available

Memory entries that orient you (canonical state):

- `MEMORY.md` — index of all memory entries
- `market-coverage-map.md` — **CURRENT WAVE STATE** (per-family ship status with commit hashes, last-updated stamp, what's shipped vs queued vs bumped vs skipped). This is the canonical "where are we" answer.
- `project-pick-origin-architecture.md` — HOW picks actually get scored (band-scorer architecture) + 5 binding traps (incl. Trap 5: market-anchored vs model-anchored double-count detector)
- `project-signal-unlocks-backlog.md` — ranked data unlocks Tier 1-5
- `feedback-conversation-continuity-log.md` — the binding rule to read OPERATOR_SESSION_LOG.md first
- `feedback-audit-before-patches.md` — the binding rule for discovery-before-edit discipline
- `feedback-commit-durable-artifacts-same-turn.md` — any new file under `docs/`, `docs/audits/`, OPERATOR_SESSION_LOG, RECOVERY_PROCEDURE, or memory-bridge files gets committed in the SAME turn it's written
- `operator-status-dashboard.md` + `status-clv-three-state-and-snapshot-paths.md` — /status surface details

If memory loaded, the `Last-updated:` field of `market-coverage-map.md` tells you the current wave state without reading anything else. Skip to Step 2.

If memory did NOT load (cold start, fresh install, fresh Claude with no auto-memory): read this whole file, then Step 3.

## Step 2 — read the session continuity log

```
cat OPERATOR_SESSION_LOG.md | tail -200
```

Latest entries tell you:
- Last shipped commit + phase tag
- Active phase (in flight)
- Operator's most recent decisions
- Any drift-recovery notes

This log auto-updates every ship per discipline rule 12 + the same-turn-commit binding rule, so the tail is always current.

## Step 3 — read the active audit + design docs

The current active operational work is captured under `docs/audits/`. Don't assume which directory — list and read what's there:

```
ls -la docs/audits/
ls -la docs/audits/$(ls docs/audits/ | sort | tail -1)/
```

The newest dated subdirectory holds the active wave. Read its `synthesis.md` and any `*_design.md` files there to see the current scope.

## Step 4 — check what shipped vs what's in design

```
git --no-pager log --oneline -20
```

Recent commit shas tell you what's actually in production vs what's only in a design doc. Cross-reference against the `Last-updated:` field of `[[market-coverage-map]]` — if the memory's most recent commit hash matches the git head, you're current. If not, read OPERATOR_SESSION_LOG tail for the gap.

## Step 5 — check active task state

If task tools are available, run TaskList and look for `in_progress` tasks. That tells you the active phase tag. Pending tasks tell you the queue order. Completed tasks tell you the history.

If task tools aren't available, the `[[market-coverage-map]]` Last-updated field + OPERATOR_SESSION_LOG tail are the substitute.

## Step 6 — check runtime health

```
curl -s https://edge.motel666.com/api/ws/status | head -50
```

If backend is healthy, you'll see `"healthy": true` with the current commit hash and LaunchAgent states.

Or open https://edge.motel666.com/status in a browser for the rendered version.

## Step 7 — ONLY NOW respond to operator

Do not reconstruct context from operator chat history. Do not assume prior conversational continuity. The repo IS the continuity layer per project doctrine.

If the operator's first message is unclear:
- Read OPERATOR_SESSION_LOG again
- Ask one clarifying question if and only if the active phase is genuinely ambiguous from the above

If the operator's first message is operational ("ship X", "verify Y"):
- Confirm you read the active phase docs above
- Execute per the design doc patterns (one fence per fix, plain backticks, no `!`, specific files in git add, hook on, probe to stable filename)

---

## Discipline rules (binding, survive compaction)

These rules apply to every operation. They're in memory but persisted here as the durable backup:

1. **Audit before patches.** Discovery phases are read-only. No code changes during audit.
2. **Always verify with non-zero probe output.** A probe returning 0/null/empty = blocker, not a signal to advance.
3. **Deep-dive existing system before editing.** Check ALL consumers of a field before modifying it.
4. **Verify downstream after editing.** Other LaunchAgents healthy, scheduler firing, logs clean, related routes rendering.
5. **One fence per operation.** Edit + commit + push + reload + probe in ONE single-terminal fence chained with `&&`. Never split ship and verify.
6. **Plain triple-backtick fences.** NEVER ```bash / ```sh / ```zsh. Default monochrome.
7. **No `!` in fences** — operator's zsh history-expands `!` even in double quotes; `echo "MISSING(!)"` fails at PARSE time.
8. **Specific files in `git add`, never `-A`.** Bisectable commits.
9. **Probe to stable filename**, NOT `.scratch/last.txt`. The autoticker rewrites `.scratch/last.txt` every 5 min — your probe will be clobbered. Use `.scratch/probe_<phase>_<fix>.txt`.
10. **Hook on, no `--no-verify`.** Gate-3 runtime:verify must pass on every commit.
11. **PRESERVED.md tier-1 modules untouched** without operator approval (includes `predictionId`, `intelligence.js` cross-cuts, `calibrationDampener.js` public API).
12. **Update OPERATOR_SESSION_LOG after every fix** ships. Fresh post-compaction anchor.
13. **Never tell the operator to sleep / rest / take a break.** They work daily; answer "what now" with the next phase.
14. **Never fabricate** props, enrichment, OCR, runtime state, verifier passes, bettor-visible deltas, operational continuity.
15. **Same-turn commit for durable artifacts.** Any new file under `docs/`, `docs/audits/`, OPERATOR_SESSION_LOG, RECOVERY_PROCEDURE, or memory-bridge files gets a commit+push fence in the SAME turn it's written. `.scratch/` probes and memory files outside the repo are exempt (not repo-tracked). Untracked durable artifacts = durability hole. Caught when 3 audit files needed backfill commit 11c27d9.
16. **Market-anchored vs model-anchored check (Trap 5).** Before wiring any environment factor (park, weather, hand-vs-hand) into a per-family projection, identify whether the source projection is market-anchored (`marketLambda` Poisson fit) or model-anchored (bottom-up skill + context). Adding env factors to market-anchored projections double-counts what the book already prices in → manufactures false edges. Caught FIX 7a (park kFactor on Ks SKIPPED).

## Pointers to canonical authority

- `PLAYBOOK.md` — runtime commands, three-speed cycles, CLV health check
- `RUNTIME_FACTS.md` — canonical runtime values (backend port 4000, LaunchAgent names, tunnel hostname, kill-switch env flags like `CALIB_LINEAWARE` when Calibration-LineAware-1A step 5.3 ships)
- `PRESERVED.md` — tier-1 cognition modules
- `SLATE_DATE_DOCTRINE.md` — slate-date semantics (ET, 4 AM boundary)
- `OPERATOR_SESSION_LOG.md` — running session continuity log (auto-updated per ship via rule 12 + rule 15)

---

**Update this file when:** the PROCEDURE itself changes (new step added, new discipline rule, new canonical surface). The procedure does NOT need updating per ship — the data sources it points at (memory `market-coverage-map.md`, OPERATOR_SESSION_LOG, git log, task list) are the auto-updating layer. If you find yourself updating this file because a fix shipped, you're probably duplicating state that lives elsewhere; check first.
