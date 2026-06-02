# Betting Dashboard — Operator Playbook

Canonical runtime reference. The repo is the continuity layer, not chat.
When commands change, this file changes. When this file disagrees with
chat-history, this file wins.

Last updated: 2026-05-27 (Lane A6 + CLV plumbing live)

---

## TL;DR — three things you do

1. **Restart backend** (TERM 1) when code changes
2. **Trigger NBA slate** (TERM 2) to exercise new code
3. **Commit + push** (TERM 2) when verified

Everything else in this file is "how to do those three things right" + diagnostics for when they're not working.

---

## Terminal layout (binding)

- **TERM 1 = backend ONLY.** Runs `npm run engine:restart` and stays alive. Never paste anything else here — slate:nba, curl, node scripts — they kill the running backend.
- **TERM 2 = git + ad-hoc.** Commits, pushes, slate:nba, node verification, scratch dumps. Anything that's a one-off command.
- **TERM 3 = Cloudflare tunnel.** Stays running. Never touch unless it crashed.
- **TERM 4 doesn't exist** — if you need a 4th window, open it ad-hoc and close it.

If TERM 1 dies, restart it first. If you accidentally type slate:nba in TERM 1, the server is now off — restart TERM 1.

---

## Branch + push

- Branch: `stable-nba-engine`
- Always: `git push origin stable-nba-engine` — NEVER bare `git push`
- Commits in TERM 2 use line-separated commands inside the fence:

```
cd /Users/andrewmoore/Projects/betting-dashboard
git add <specific files>
git commit -m "<message>"
git push origin stable-nba-engine
```

Never `git add -A` or `git add .` — specific files only. Runtime data (mlbGameWeather.json, mlbPitcherStats.json, livestate jsonl) drifts constantly; don't commit it.

---

## Three-speed cycles

When code changes, pick the right cycle to verify the change. Picking wrong wastes 5 minutes or worse — wrong code stays in memory because backend wasn't restarted.

**ULTRA-FAST (~2 sec)** — format-only changes (FE strings, tag wording, CSS):

```
cd /Users/andrewmoore/Projects/betting-dashboard/backend
node scripts/rebuildDisplayBundlesOnly.js
```

No backend restart. Just regenerates display bundles. iPhone reload shows new strings.

**MEDIUM (~30 sec)** — cognition changes (model math, gates, classifier logic) — backend restart required:

```
cd /Users/andrewmoore/Projects/betting-dashboard/backend
npm run engine:restart
```

Wait for boot markers (below). Backend now runs new code with cached snapshot.

**SLOW (~5 min)** — fresh odds + full cycle (snapshot refresh + all engines + tracked_bets):

```
cd /Users/andrewmoore/Projects/betting-dashboard/backend
npm run slate:nba
```

Calls the backend's `/refresh-snapshot/hard-reset` + `/api/best-available` + `/api/ws/state`. New odds from The Odds API, full board build, persistTrackedToday writes. Run this when you want bettor-visible delta in tracked_bets after a cognition change.

---

## Backend restart (TERM 1)

Canonical:

```
cd /Users/andrewmoore/Projects/betting-dashboard/backend
npm run engine:restart
```

With log capture (preferred when verifying a change):

```
cd /Users/andrewmoore/Projects/betting-dashboard/backend
npm run engine:restart 2>&1 | tee /Users/andrewmoore/Projects/betting-dashboard/.scratch/backend.log
```

**Wait for ALL THREE boot markers before declaring ready**:

- `ACTIVE: .../backend/pipeline/nba/buildNbaOpportunityBoard.js` (and other ACTIVE lines)
- `Backend listening on http://localhost:4000`
- `[BOOT] CLV capture loop started (5min interval)`

If you see `port 4000 in use` — kill the old process first or use engine:restart (which handles the kill).

---

## Slate refresh (TERM 2 after backend up)

```
cd /Users/andrewmoore/Projects/betting-dashboard/backend
npm run slate:nba 2>&1 | tee /Users/andrewmoore/Projects/betting-dashboard/.scratch/slate-nba.log
```

Returns in 30s-2min. Look for `slate:nba completed in XXXXms`. After it returns, tracked_bets file has been rewritten.

MLB equivalent: `npm run slate:mlb`

---

## Nightly audit (Lane C v0.1) — RUN EVERY MORNING

Single command. Grades all pending tracked_bets, then writes a dated audit report.

```
cd /Users/andrewmoore/Projects/betting-dashboard/backend
npm run audit:nightly
```

What it does:
1. Runs `grading:run --sport=all --backfill` to settle pending bets across NBA + MLB
2. Reads last 7 days of tracked_bets files
3. Computes per-day, per-sport, per-family stats (total / settled / won / lost / CLV captured)
4. Surfaces anomalies (grading lag, CLV gaps, missing NBA families)
5. Writes a markdown report to `backend/runtime/audits/YYYY-MM-DD-audit.md`
6. Prints summary to stdout

Run this once per day, typically after midnight ET (last night's games settled). The output file is scrollable on iPhone via GitHub repo browser, and future-Claude can read it to recover operational state.

Flags:
- `npm run audit:nightly -- --no-grade` — skip grading, audit only
- `npm run audit:nightly -- --days=14` — widen window from default 7 days

**Critical**: 2026-05-27 baseline showed 5 days of pending tracked_bets with ZERO graded — grading wasn't running. The audit catches that gap immediately and runs the backfill itself.

---

## CLV health check (run anytime)

The CLV capture loop populates `closeOdds + clv + clvQuality` on tracked_bets entries within 30 min of each tipoff. If backend stays up, this happens automatically. To verify it's actually working:

```
node -e "const fs=require('fs');const dir='/Users/andrewmoore/Projects/betting-dashboard/backend/runtime/tracking/';const f=fs.readdirSync(dir).filter(x=>x.startsWith('nba_tracked_bets_')).sort().slice(-1)[0];const b=JSON.parse(fs.readFileSync(dir+f,'utf8'));const total=b.length;const captured=b.filter(x=>x.closeOdds!=null).length;const open=b.filter(x=>x.openOdds!=null).length;console.log(f+': total='+total+' openStamped='+open+' closeStamped='+captured+' clvHealthy='+(captured/total>0.3?'YES':'NO (low capture rate)'));"
```

**Healthy state (1+ day after first game tipped)**:
- `openStamped` close to `total` (every tracked bet should have open-side stamp at write time)
- `closeStamped` should be 30%+ of total for slates whose games have already tipped
- `clvHealthy` reports YES

**Broken state**:
- `closeStamped: 0` on a slate that already tipped → CLV loop is dead. Check `[captureClosingLines]` lines in backend.log. Most likely: backend restarted recently and slate had no in-window games during this process's lifetime. Fix: backend must stay up THROUGH a game tipoff for CLV to capture.

---

## Tracked_bets family count (run anytime)

See what families landed in tracked_bets today:

```
node -e "const fs=require('fs');const dir='/Users/andrewmoore/Projects/betting-dashboard/backend/runtime/tracking/';const f=fs.readdirSync(dir).filter(x=>x.startsWith('nba_tracked_bets_')).sort().slice(-1)[0];const b=JSON.parse(fs.readFileSync(dir+f,'utf8'));const by={};for(const x of b)by[x.statFamily]=(by[x.statFamily]||0)+1;console.log(f+' ('+b.length+' bets)');for(const k of Object.keys(by).sort())console.log('  '+k.padEnd(20)+' '+by[k]);"
```

**Expected NBA families (as of Lane A6)** — 8 active:
- assists, blocks, double_double, points, pra, rebounds, steals, threes

**Inactive today (mechanism intact, no qualifying picks)**:
- first_basket (refinement-killed), triple_double (rare), turnovers (API gap until ~Oct 2026)

---

## Scratch file workflow

Diagnostic output flows through `.scratch/last.txt`. Claude reads it directly — no file uploads, no TextEdit locks.

Pattern: TERM 2 writes diagnostic output to `.scratch/last.txt` with `>` (overwrite) or `>>` (append). Operator says `check` in chat. Claude reads via Read tool.

`.scratch/` is git-ignored (added 2026-05-26). Never commit anything from there.

---

## When something looks broken

Single command to dump the operational truth to scratch for Claude to read:

```
node -e "const fs=require('fs');const dir='/Users/andrewmoore/Projects/betting-dashboard/backend/runtime/tracking/';const f=fs.readdirSync(dir).filter(x=>x.startsWith('nba_tracked_bets_')).sort().slice(-1)[0];const b=JSON.parse(fs.readFileSync(dir+f,'utf8'));const by={};for(const x of b)by[x.statFamily]=(by[x.statFamily]||0)+1;console.log(f+' total='+b.length);for(const k of Object.keys(by).sort())console.log('  '+k.padEnd(20)+' '+by[k]);" > /Users/andrewmoore/Projects/betting-dashboard/.scratch/last.txt
tail -50 /Users/andrewmoore/Projects/betting-dashboard/.scratch/backend.log >> /Users/andrewmoore/Projects/betting-dashboard/.scratch/last.txt
git -C /Users/andrewmoore/Projects/betting-dashboard log --oneline -5 >> /Users/andrewmoore/Projects/betting-dashboard/.scratch/last.txt
```

Then say `check` in chat.

---

## NBA prop family coverage (Lane A1-A6 + B Phase 1 shipped)

| Family | Ingestion | Modeling | Tracked_bets | CLV |
|---|---|---|---|---|
| points | ✅ | predictions + workstation | ✅ | ⏳ awaits tip |
| threes | ✅ | predictions + workstation | ✅ | ⏳ awaits tip |
| rebounds | ✅ | predictions + workstation | ✅ | ⏳ awaits tip |
| assists | ✅ | predictions + workstation | ✅ | ⏳ awaits tip |
| pra | ✅ | workstation (Lane A3 bridge) | ✅ | ⏳ awaits tip |
| steals | ✅ | workstation + defensive engine | ✅ | ⏳ awaits tip |
| blocks | ✅ | workstation + defensive engine | ✅ | ⏳ awaits tip |
| double_double | ✅ | workstation hit-rate | ✅ | ⏳ awaits tip |
| triple_double | ✅ | workstation hit-rate | 0 today (rare) | n/a |
| first_basket | ✅ | dedicated engine | 0 today (refinement-killed) | n/a |
| turnovers | ❌ API gap | n/a | n/a | re-probe Oct 2026 |

Two cognition paths feed tracked_bets:
1. **Predictions module** (buildNbaPlayerOutcomePredictions) — handles points/threes/rebounds/assists with deep math (form-anchoring, threes-attempt analysis, archetype priors). STAT_ORDER = these 4.
2. **Workstation module** (nbaModelSignals + classifyNbaTier) — handles everything else via row-level cognition. Bridges into tracked_bets via Lane A3 (buildNbaSnapshotCandidates → allPlays).

This is intentional. Predictions module is purpose-built and deep; workstation is broad. Lane A4 would have merged them and created shadow authority — explicitly skipped.

---

## Session-start checklist (for future Claude or operator)

Run this before any new lane to make sure runtime state matches doctrine:

```
git -C /Users/andrewmoore/Projects/betting-dashboard log --oneline -3
git -C /Users/andrewmoore/Projects/betting-dashboard status --short
node -e "const fs=require('fs');const dir='/Users/andrewmoore/Projects/betting-dashboard/backend/runtime/tracking/';const f=fs.readdirSync(dir).filter(x=>x.startsWith('nba_tracked_bets_')).sort().slice(-1)[0];const b=JSON.parse(fs.readFileSync(dir+f,'utf8'));const captured=b.filter(x=>x.closeOdds!=null).length;console.log(f+': bets='+b.length+' clvCaptured='+captured);"
```

Confirms: latest commits visible, no surprise uncommitted code, CLV state visible.

---

## NOT canonical

- BUILD_LOG.md — historical narrative, not commands
- COGNITION_AUDIT.md — point-in-time analysis, not runtime ops
- PRESERVED.md — cognition module preserve list, not commands
- PRODUCT_IDENTITY.md / PRODUCT_VISION.md — direction, not ops
- ARCHITECTURE.md — structure, not how-to-run

Those exist for context; this file exists for operation.

---

## Memory crossreference

Memory files at `~/Library/Application Support/Claude/local-agent-mode-sessions/.../memory/`:

- `operator_term_layout.md` — TERM 1/2/3 rules (formal spec)
- `feedback_term1_is_sacred_for_backend.md` — never put slate:nba in TERM 1
- `operator_three_speed_cycles.md` — when to use ULTRA-FAST / MEDIUM / SLOW
- `workflow_scratch_file.md` — `.scratch/last.txt` pattern
- `workflow_trace_before_commit.md` — restart → trace → confirm → commit
- `project_nba_turnovers_api_unavailable.md` — turnovers API gap (re-probe Oct 2026)
- `nba_tier_classifier_call_pattern.md` — classifyNbaTier call signature gotcha

If memory contradicts this file, fix the contradiction immediately (binding doctrine: single source of truth).

---

## When this file is wrong

If something doesn't work and the command in this file looks right but fails, the doctrine is: **verify against current code state first** (file exists? command in package.json? backend listening on expected port?). Don't trust this file blindly — it's a snapshot. The repo + runtime are authoritative.

Then update this file to match reality. PLAYBOOK is a living artifact.
