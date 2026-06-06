# Cold-start recovery procedure

**For a fresh Claude (operator-side OR build-side) starting with no chat context.** Created 2026-06-06 to harden against simultaneous-compaction drift. Read this BEFORE responding to operator.

**Why this file exists in the repo (not just memory):** memory loading is reliable but not infallible. A repo-root file is the most durable surface — `git clone` reproduces it. If memory doesn't load, this file is the recovery anchor.

---

## Step 1 — read memory first if available

Memory entries that orient you (canonical state):

- `MEMORY.md` — index of all memory entries
- `market-coverage-map.md` — what the engine generates today + strategic gaps
- `project-pick-origin-architecture.md` — HOW picks actually get scored (band-scorer architecture)
- `project-signal-unlocks-backlog.md` — ranked data unlocks Tier 1-5
- `feedback-conversation-continuity-log.md` — the binding rule to read OPERATOR_SESSION_LOG.md first
- `feedback-audit-before-patches.md` — the binding rule for discovery-before-edit discipline
- `operator-status-dashboard.md` + `status-clv-three-state-and-snapshot-paths.md` — /status surface details

If memory loaded, skip to Step 2.

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

## Step 3 — read the active audit + design docs

The current active operational work is captured at:

```
ls -la docs/audits/2026-06-06-signal-inputs/
```

Read each:
- `synthesis.md` — per-family signal gap map + recommendation (signal-fill-first)
- `signal_fill_1a_design.md` — active wave plan with per-fix worked numbers
- `audit_signal_nba_factual.md` + `audit_signal_mlb_factual.md` — raw forensic maps

## Step 4 — check what shipped vs what's in design

```
git --no-pager log --oneline -20
```

Recent commit shas tell you what's actually in production vs what's only in a design doc.

Key recent ships as of 2026-06-06:
- `7351e81` — Signal-Fill-1A FIX 1 (walks bbRate wire) — shipped + verified
- `46eea74` — Signal-Fill-1A design doc (read-only)
- `415567d` — Status-CLV-Display-Honesty-1A (three-state CLV card + control gate)
- `40121d7` — Settlement-PredictionSource-1A (corpus plumbing safe half)

## Step 5 — check active task state

If task tools are available, run TaskList to see what's `in_progress` vs `pending`.

Current strategic state as of 2026-06-06:
- **Phase Signal-Fill-1A** (task #93) — IN PROGRESS. FIX 1 shipped. FIX 2 next (outs, downstream probe required first).
- **Phase Calibration-LineAware-1A** (task #91) — BLOCKED behind Signal-Fill-1A completion.
- **Wave 1 A2 mlScorer** (task #86) — UNBLOCKS after Calibration-LineAware-1A.

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

## Pointers to canonical authority

- `PLAYBOOK.md` — runtime commands, three-speed cycles, CLV health check
- `RUNTIME_FACTS.md` — canonical runtime values (backend port 4000, LaunchAgent names, tunnel hostname)
- `PRESERVED.md` — tier-1 cognition modules
- `SLATE_DATE_DOCTRINE.md` — slate-date semantics (ET, 4 AM boundary)
- `OPERATOR_SESSION_LOG.md` — running session continuity log

---

**Update this file when:** the active audit phase changes (Signal-Fill-1A → Calibration-LineAware-1A → next phase). The "Key recent ships" + "Current strategic state" sections need refresh. The discipline rules section is stable.
