#!/usr/bin/env node
"use strict"

/**
 * runtime.js — canonical runtime command registry.
 *
 * Single source of truth for every named operator-runnable shell command.
 * Operator should NEVER guess a command; assistant should ALWAYS cite a
 * name from this registry in the operational footer's `next-command`.
 *
 * Phase OO-1 (Operational Orchestration Slice 1, 2026-05-19).
 * Phase OO-2 (Slice 2 enforcement, 2026-05-19) — added risk/lane/playbook/
 *   checkpoint commands.
 * Phase Runtime-Context-Hardening-1A (item-0009 corrective, 2026-05-19) —
 *   added cwd-aware `safe` form + `grouped-term` + `cwd-detect` so
 *   operator can copy-paste any command regardless of current cwd.
 *
 * Usage:
 *   node backend/scripts/ops/runtime.js list                # all registered commands
 *   node backend/scripts/ops/runtime.js show  <name>        # show one
 *   node backend/scripts/ops/runtime.js run   <name>        # echo legacy cmd
 *   node backend/scripts/ops/runtime.js safe  <name>        # echo cwd-safe subshell form
 *   node backend/scripts/ops/runtime.js grouped-term        # echo TERM 1+2+3 grouped block (cwd-safe)
 *   node backend/scripts/ops/runtime.js grouped <name> ...  # echo arbitrary grouped chain (cwd-safe)
 *   node backend/scripts/ops/runtime.js cwd-detect          # introspect current cwd context
 */

const fs   = require("fs")
const path = require("path")
const cp   = require("child_process")

// ── cwd buckets ─────────────────────────────────────────────────────────
// Every COMMANDS entry declares one of these. `safeCmd()` reads it to
// decide which subshell anchor to emit.
const CWD = Object.freeze({
  REPO_ROOT: "repoRoot",
  BACKEND:   "backend",
  FRONTEND:  "frontend",
  ANYWHERE:  "anywhere",   // pure side-effect commands (curl, pkill)
})

const COMMANDS = Object.freeze({
  // ── verification ──────────────────────────────────────────────────────
  "v5": {
    desc: "Run the full V5 verifier matrix (47-check runner).",
    cmd:  "cd backend && npm run ops:verify",
    cwd:  CWD.BACKEND,
    body: "npm run ops:verify",
    lane: "INFRA / GOVERNANCE",
  },
  "v5-fe": {
    desc: "FE typecheck (frontend tsc --noEmit).",
    cmd:  "cd frontend && npx tsc --noEmit",
    cwd:  CWD.FRONTEND,
    body: "npx tsc --noEmit",
    lane: "FRONTEND / UX LAB",
  },
  "v6": {
    desc: "Brain checkpoint (continuity + brain freshness + checkpoint chain).",
    cmd:  "cd backend && npm run brain:checkpoint",
    cwd:  CWD.BACKEND,
    body: "npm run brain:checkpoint",
    lane: "INFRA / GOVERNANCE",
  },
  "verify-sportsbook": {
    desc: "Run the 4 sportsbook-governance verifiers.",
    cmd:  "node backend/scripts/verifySportsbookTopologyShape.js && " +
          "node backend/scripts/verifySameBookConstructability.js && " +
          "node backend/scripts/verifySportsbookConstructability.js && " +
          "node backend/scripts/verifyProcedureDrift.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/verifySportsbookTopologyShape.js && " +
          "node backend/scripts/verifySameBookConstructability.js && " +
          "node backend/scripts/verifySportsbookConstructability.js && " +
          "node backend/scripts/verifyProcedureDrift.js",
    lane: "INFRA / GOVERNANCE",
  },
  "verify-orchestration": {
    desc: "Run the operational-orchestration verifier (backlog + lanes + footer template + cwd-safety).",
    cmd:  "node backend/scripts/verifyOperationalOrchestration.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/verifyOperationalOrchestration.js",
    lane: "INFRA / GOVERNANCE",
  },

  // ── canonical TERM commands (named so footer can cite them directly) ──
  "term1": {
    desc: "TERM 1 — read-only health introspection.",
    cmd:  "cd backend && npm run ops:term1",
    cwd:  CWD.BACKEND,
    body: "npm run ops:term1",
    lane: "INFRA / GOVERNANCE",
  },
  "term2": {
    desc: "TERM 2 — pre-phase ritual (full historical depth: slate + market + brain + runtime regression + helper-unit + probe matrix).",
    cmd:  "cd backend && npm run ops:term2",
    cwd:  CWD.BACKEND,
    body: "npm run ops:term2",
    lane: "INFRA / GOVERNANCE",
  },
  "term3": {
    desc: "TERM 3 — checkpoint seal (ops:term2 + checkpointRepo + finalizeCheckpoint + git push + brain:checkpoint).",
    cmd:  "cd backend && npm run ops:checkpoint",
    cwd:  CWD.BACKEND,
    body: "npm run ops:checkpoint",
    lane: "INFRA / GOVERNANCE",
  },

  // ── live regeneration ─────────────────────────────────────────────────
  "regen-mlb": {
    desc: "Full LIVE REGENERATION cycle for MLB: kill server, restart, refresh snapshot, fire best-available (writes tracked_best + tracked_slips + picks).",
    cmd:  "pkill -f 'node.*server.js' 2>/dev/null; sleep 1; " +
          "cd backend && node server.js > /tmp/mlb-server.log 2>&1 & sleep 4; " +
          "curl -s 'http://localhost:4000/refresh-snapshot?sport=baseball_mlb' > /dev/null; " +
          "curl -s 'http://localhost:4000/api/best-available?sport=baseball_mlb' > /dev/null; " +
          "echo 'live regen complete; tail /tmp/mlb-server.log to confirm'",
    cwd:  CWD.REPO_ROOT,
    body: "pkill -f 'node.*server.js' 2>/dev/null; sleep 1; " +
          "(cd backend && node server.js > /tmp/mlb-server.log 2>&1 &) && sleep 4 && " +
          "curl -s 'http://localhost:4000/refresh-snapshot?sport=baseball_mlb' > /dev/null && " +
          "curl -s 'http://localhost:4000/api/best-available?sport=baseball_mlb' > /dev/null && " +
          "echo 'live regen complete; tail /tmp/mlb-server.log to confirm'",
    lane: "ACTIVE EXECUTION",
  },
  "regen-state": {
    desc: "Fire /api/ws/state?sport=mlb to refresh workstation /state cache (60s TTL).",
    cmd:  "curl -s 'http://localhost:4000/api/ws/state?sport=mlb' | head -c 200",
    cwd:  CWD.ANYWHERE,
    body: "curl -s 'http://localhost:4000/api/ws/state?sport=mlb' | head -c 200",
    lane: "ACTIVE EXECUTION",
  },

  // ── live introspection ────────────────────────────────────────────────
  "inspect-tracked-best": {
    desc: "Print today's mlb_tracked_best_<today>.json hydration coverage.",
    cmd:  "node -e \"const fs=require('fs');const t=new Date().toISOString().slice(0,10);const p='backend/runtime/tracking/mlb_tracked_best_'+t+'.json';if(!fs.existsSync(p)){console.log('not-yet-written: '+p);process.exit(0);}const e=JSON.parse(fs.readFileSync(p,'utf8')).entries;const cnt=(pred)=>e.filter(pred).length;console.log({entries:e.length,eventId:cnt(x=>!!x.eventId),impliedTeamTotal:cnt(x=>Number.isFinite(Number(x.impliedTeamTotal))),gameTotal:cnt(x=>Number.isFinite(Number(x.gameTotal))),hrEnvironmentTag:cnt(x=>x.hrEnvironmentTag!=null),lineupSpot:cnt(x=>x.lineupSpot!=null),depth:cnt(x=>x.depth!=null)});\"",
    cwd:  CWD.REPO_ROOT,
    body: "node -e \"const fs=require('fs');const t=new Date().toISOString().slice(0,10);const p='backend/runtime/tracking/mlb_tracked_best_'+t+'.json';if(!fs.existsSync(p)){console.log('not-yet-written: '+p);process.exit(0);}const e=JSON.parse(fs.readFileSync(p,'utf8')).entries;const cnt=(pred)=>e.filter(pred).length;console.log({entries:e.length,eventId:cnt(x=>!!x.eventId),impliedTeamTotal:cnt(x=>Number.isFinite(Number(x.impliedTeamTotal))),gameTotal:cnt(x=>Number.isFinite(Number(x.gameTotal))),hrEnvironmentTag:cnt(x=>x.hrEnvironmentTag!=null),lineupSpot:cnt(x=>x.lineupSpot!=null),depth:cnt(x=>x.depth!=null)});\"",
    lane: "INFRA / GOVERNANCE",
  },
  "inspect-tracked-slips": {
    desc: "Print today's mlb_tracked_slips_<today>.json book-hydration summary.",
    cmd:  "node -e \"const fs=require('fs');const t=new Date().toISOString().slice(0,10);const p='backend/runtime/tracking/mlb_tracked_slips_'+t+'.json';if(!fs.existsSync(p)){console.log('not-yet-written: '+p);process.exit(0);}const slips=JSON.parse(fs.readFileSync(p,'utf8'));const s={total:slips.length,withSlipBook:0,withLegBooks:0,mixedBook:0,unauthorized:0};for(const x of slips){if(x.book)s.withSlipBook++;const bs=new Set();for(const l of x.legs||[]){if(l.book){s.withLegBooks++;bs.add(l.book);}}if(bs.size>1)s.mixedBook++;}console.log(s);\"",
    cwd:  CWD.REPO_ROOT,
    body: "node -e \"const fs=require('fs');const t=new Date().toISOString().slice(0,10);const p='backend/runtime/tracking/mlb_tracked_slips_'+t+'.json';if(!fs.existsSync(p)){console.log('not-yet-written: '+p);process.exit(0);}const slips=JSON.parse(fs.readFileSync(p,'utf8'));const s={total:slips.length,withSlipBook:0,withLegBooks:0,mixedBook:0,unauthorized:0};for(const x of slips){if(x.book)s.withSlipBook++;const bs=new Set();for(const l of x.legs||[]){if(l.book){s.withLegBooks++;bs.add(l.book);}}if(bs.size>1)s.mixedBook++;}console.log(s);\"",
    lane: "INFRA / GOVERNANCE",
  },
  "inspect-state-payload": {
    desc: "Print discoveryCandidates hydration summary from live /api/ws/state.",
    cmd:  "curl -s 'http://localhost:4000/api/ws/state?sport=mlb' | node -e \"let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);const dc=j.discoveryCandidates||[];console.log({pool:dc.length,withEventId:dc.filter(x=>!!x.eventId).length,distinctGames:new Set(dc.map(x=>x.eventId).filter(Boolean)).size,realismScore:j.aiSlipsSummary?.bettorRealismScore?.score??null});});\"",
    cwd:  CWD.ANYWHERE,
    body: "curl -s 'http://localhost:4000/api/ws/state?sport=mlb' | node -e \"let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);const dc=j.discoveryCandidates||[];console.log({pool:dc.length,withEventId:dc.filter(x=>!!x.eventId).length,distinctGames:new Set(dc.map(x=>x.eventId).filter(Boolean)).size,realismScore:j.aiSlipsSummary?.bettorRealismScore?.score??null});});\"",
    lane: "INFRA / GOVERNANCE",
  },

  // ── orchestration management ──────────────────────────────────────────
  "backlog-list": {
    desc: "List all OPEN + IN-SLICE backlog entries.",
    cmd:  "node backend/scripts/ops/backlogList.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/backlogList.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "backlog-add": {
    desc: "Append a new backlog entry. Usage: backlog-add <lane> <title>",
    cmd:  "node backend/scripts/ops/backlogAdd.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/backlogAdd.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "next-step": {
    desc: "Print the active slice's next-command from EXECUTION_BACKLOG.md.",
    cmd:  "node backend/scripts/ops/nextStep.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/nextStep.js",
    lane: "OPERATOR PLAYBOOK",
  },

  // ── OO-2 enforcement layer ────────────────────────────────────────────
  "risk-add": {
    desc: "Append a new R-NNN-N entry to docs/OPEN_RISKS.md. Usage: risk-add <lane> <title> [slice]",
    cmd:  "node backend/scripts/ops/riskAdd.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/riskAdd.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "risk-list": {
    desc: "List OPEN + MITIGATED risks. Use --ids for comma-separated id list (footer carry-forward).",
    cmd:  "node backend/scripts/ops/riskList.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/riskList.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "lane-sync": {
    desc: "Atomic lane handoff: mutates EXECUTION_BACKLOG Active-slice lane + appends Lane log + appends linked BBL statusLog. Usage: lane-sync <new-lane> <reason>",
    cmd:  "node backend/scripts/ops/laneSync.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/laneSync.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "playbook-sync": {
    desc: "Slice-close trigger: appends OPERATOR_RUNBOOK phase ledger line + asserts 4-surface continuity propagation. Usage: playbook-sync <slice-id> <summary> [commit]",
    cmd:  "node backend/scripts/ops/playbookSync.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/playbookSync.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "checkpoint-persist": {
    desc: "Writes .checkpoint/operational_state_<tag>.json snapshot (active slice + lane + open risks + open backlog + term commands). Inline-called by ops:checkpoint.",
    cmd:  "node backend/scripts/ops/checkpointPersist.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/checkpointPersist.js",
    lane: "OPERATOR PLAYBOOK",
  },

  // ── BC-1 bettor-cognition ingestion ───────────────────────────────────
  "cognition-add": {
    desc: "Append BC-1 cognition entry to BETTOR_BACKLOG with full schema. Usage: cognition-add --lane <L> --title <T> --cognition <C> --sportsbook <S> --ux <U> --severity <V> --priority <P>",
    cmd:  "node backend/scripts/ops/cognitionAdd.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/cognitionAdd.js",
    lane: "FRONTEND / UX LAB",
  },
  "cognition-rank": {
    desc: "Print BETTOR_BACKLOG entries ranked by composite cognition priority (deterministic).",
    cmd:  "node backend/scripts/ops/cognitionRank.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/cognitionRank.js",
    lane: "FRONTEND / UX LAB",
  },
  "cognition-next": {
    desc: "Print the next cognition-driven execution slice candidate based on cognitionRank top entry.",
    cmd:  "node backend/scripts/ops/cognitionNext.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/cognitionNext.js",
    lane: "FRONTEND / UX LAB",
  },

  // ── Item-0009 archetype weighting (restored — verifier expects this name) ─
  "verify-archetype": {
    desc: "Run the Item-0009 archetype-weighting verifier (anti-suppression + cleanup-gravity + sharp-sleeper preservation).",
    cmd:  "node backend/scripts/verifyItem0009ArchetypeWeighting.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/verifyItem0009ArchetypeWeighting.js",
    lane: "INFRA / GOVERNANCE",
  },

  // ── Item 0003 Vig Stripping (Increment 1 — verifier-first) ───────────
  "verify-vig-stripping": {
    desc: "Run the Item 0003 vig-stripping verifier. PRE-CONDITION assertions today; flips to POST-IMPL automatically when Increment 2 ships vigStripping.js. Set ITEM_0003_VIG_DRIFT_SELF_TEST=1 for drift-detection self-test.",
    cmd:  "node backend/scripts/verifyVigStripping.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/verifyVigStripping.js",
    lane: "INFRA / GOVERNANCE",
  },

  // ── Runtime Supervisor Phase A (verifier-first; no daemon yet) ───────
  "verify-supervisor-state": {
    desc: "Run the Runtime-Supervisor Phase A verifier: schema validation + append-only events.log + content-hash + replay/live parity + scope-lock (no daemon). Set SUPERVISOR_DRIFT_SELF_TEST=1 for drift-detection self-test.",
    cmd:  "node backend/scripts/verifySupervisorStateIntegrity.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/verifySupervisorStateIntegrity.js",
    lane: "INFRA / GOVERNANCE",
  },
  "inspect-supervisor-state": {
    desc: "Print canonical supervisor state from backend/runtime/supervisor/state.json.",
    cmd:  "cat backend/runtime/supervisor/state.json",
    cwd:  CWD.REPO_ROOT,
    body: "cat backend/runtime/supervisor/state.json",
    lane: "INFRA / GOVERNANCE",
  },

  // ── Runtime Supervisor Phase B daemon commands ───────────────────────
  "supervisor-start": {
    desc: "Boot the supervisor daemon (foreground heartbeat loop; SIGINT to stop). Set SUPERVISOR_HEARTBEAT_MS to override 5000ms cadence.",
    cmd:  "node backend/scripts/ops/supervisorStart.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/supervisorStart.js",
    lane: "INFRA / GOVERNANCE",
  },
  "supervisor-shutdown": {
    desc: "Send SIGTERM to running supervisor and clear stale lock.",
    cmd:  "node backend/scripts/ops/supervisorShutdown.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/supervisorShutdown.js",
    lane: "INFRA / GOVERNANCE",
  },
  "supervisor-override-set": {
    desc: "Set operatorOverride.active=true (pauses autonomous mutations). Usage: supervisor-override-set 'reason text'",
    cmd:  "node backend/scripts/ops/supervisorOverrideSet.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/supervisorOverrideSet.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "supervisor-override-clear": {
    desc: "Set operatorOverride.active=false (resume autonomous behaviour).",
    cmd:  "node backend/scripts/ops/supervisorOverrideClear.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/supervisorOverrideClear.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "grouped-term": {
    desc: "Emit the cwd-safe TERM 1/2/3 block, augmented with live supervisor banner when daemon running. Add --status for JSON state summary.",
    cmd:  "node backend/scripts/ops/groupedTerm.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/ops/groupedTerm.js",
    lane: "INFRA / GOVERNANCE",
  },

  // ── Operator Cockpit Phase 1 (read-only) ──────────────────────────────
  "cockpit-start": {
    desc: "Boot the read-only operator cockpit (port 4001; standalone http server; no mutation routes). View at http://127.0.0.1:4001/cockpit.",
    cmd:  "node backend/cockpit/server.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/cockpit/server.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "verify-cockpit": {
    desc: "Run the Operator Cockpit Phase 1 verifier (read-only enforcement + anti-shadow + canonical-source-only + FE isolation + hydration proof).",
    cmd:  "node backend/scripts/verifyCockpitReadOnly.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/verifyCockpitReadOnly.js",
    lane: "INFRA / GOVERNANCE",
  },

  // ── BRH-1.2.A role/archetype qualification (Increment 1 — verifier-first) ─
  "verify-role-archetype": {
    desc: "Run the BRH-1.2.A role/archetype qualification verifier. PRE-IMPL assertions today; flips to POST-IMPL automatically when Increment 2 ships roleArchetypeQualification.js. Set BRH_1_2_A_DRIFT_SELF_TEST=1 for drift-detection self-test.",
    cmd:  "node backend/scripts/verifyRoleArchetypeQualification.js",
    cwd:  CWD.REPO_ROOT,
    body: "node backend/scripts/verifyRoleArchetypeQualification.js",
    lane: "INFRA / GOVERNANCE",
  },
})

// ── cwd-safe emission ───────────────────────────────────────────────────
// Single anchor pattern: every safe command starts by re-anchoring to the
// repo root via `git rev-parse --show-toplevel`. From there we cd into the
// declared bucket (or stay put for anywhere/repoRoot). This is robust to
// the operator being in repo root, backend/, frontend/, or any subdir.
const ANCHOR = '$(git rev-parse --show-toplevel)'

function targetForCwd(c) {
  if (c === CWD.BACKEND)  return `"${ANCHOR}/backend"`
  if (c === CWD.FRONTEND) return `"${ANCHOR}/frontend"`
  if (c === CWD.REPO_ROOT) return `"${ANCHOR}"`
  return null  // anywhere
}

function safeCmd(name) {
  const def = COMMANDS[name]
  if (!def) throw new Error("unknown command: " + name)
  const tgt = targetForCwd(def.cwd)
  if (tgt === null) return def.body  // anywhere
  return `(cd ${tgt} && ${def.body})`
}

function groupedRun(names) {
  // Emit a chained sequence in copy-paste-safe subshell form. All commands
  // are wrapped so the operator can paste from any cwd. Chained with &&
  // so failure halts the chain.
  return names.map(n => safeCmd(n)).join(" && \\\n  ")
}

function groupedTerm() {
  // Canonical TERM 1 + TERM 2 + TERM 3 chain. Single copy-paste block.
  return groupedRun(["term1", "term2", "term3"])
}

// ── cwd detection (introspection) ───────────────────────────────────────
function detectCwd() {
  const cwd = process.cwd()
  let repoRoot = null
  try {
    repoRoot = cp.execFileSync("git", ["rev-parse","--show-toplevel"], { cwd, encoding: "utf8" }).trim()
  } catch (_) { /* not in a git checkout */ }

  const context = (() => {
    if (!repoRoot) return "non-git"
    if (cwd === repoRoot) return CWD.REPO_ROOT
    if (cwd === path.join(repoRoot, "backend"))  return CWD.BACKEND
    if (cwd === path.join(repoRoot, "frontend")) return CWD.FRONTEND
    if (cwd.startsWith(repoRoot + path.sep)) return "repo-subdir"
    return "outside-repo"
  })()

  return { cwd, repoRoot, context }
}

// ── CLI ─────────────────────────────────────────────────────────────────
function list() {
  console.log("")
  console.log("Canonical runtime commands (use these in next-command footer field):")
  console.log("")
  for (const [name, def] of Object.entries(COMMANDS)) {
    console.log("  " + name.padEnd(28) + def.lane.padEnd(22) + def.cwd.padEnd(10) + " — " + def.desc)
  }
  console.log("")
  console.log("Show one:        node backend/scripts/ops/runtime.js show <name>")
  console.log("Cwd-safe form:   node backend/scripts/ops/runtime.js safe <name>")
  console.log("Grouped TERM:    node backend/scripts/ops/runtime.js grouped-term")
  console.log("Detect cwd:      node backend/scripts/ops/runtime.js cwd-detect")
  console.log("")
}

function show(name) {
  const def = COMMANDS[name]
  if (!def) { console.error("unknown command: " + name); process.exit(1) }
  console.log(JSON.stringify({ name, ...def, safe: safeCmd(name) }, null, 2))
}

function emit(name) {
  const def = COMMANDS[name]
  if (!def) { console.error("unknown command: " + name); process.exit(1) }
  console.log(def.cmd)
}

function emitSafe(name) {
  console.log(safeCmd(name))
}

function emitGroupedTerm() {
  console.log(groupedTerm())
}

function emitGrouped(names) {
  if (!names || names.length === 0) {
    console.error("usage: runtime.js grouped <name> [<name> ...]")
    process.exit(1)
  }
  console.log(groupedRun(names))
}

function emitCwdDetect() {
  const r = detectCwd()
  console.log("")
  console.log("  cwd:        " + r.cwd)
  console.log("  repoRoot:   " + (r.repoRoot || "(no git checkout)"))
  console.log("  context:    " + r.context)
  console.log("")
  if (r.context === CWD.REPO_ROOT) console.log("  → from here you can paste any command form (legacy `cmd` and `safe` both work).")
  else if (r.context === CWD.BACKEND)  console.log("  → legacy `cd backend && ...` will FAIL. Use `safe` or `grouped-term` form.")
  else if (r.context === CWD.FRONTEND) console.log("  → legacy `cd frontend && ...` will FAIL. Use `safe` form.")
  else if (r.context === "repo-subdir") console.log("  → legacy `cd X && ...` may FAIL depending on subdir. Use `safe` or `grouped-term` form.")
  else if (r.context === "outside-repo") console.log("  → you are outside the repo. cd back in first.")
  else console.log("  → not in a git checkout. Anchor commands manually.")
  console.log("")
}

if (require.main === module) {
  const [, , verb, ...rest] = process.argv
  if (!verb || verb === "list") list()
  else if (verb === "show" && rest[0])         show(rest[0])
  else if (verb === "run"  && rest[0])         emit(rest[0])
  else if (verb === "safe" && rest[0])         emitSafe(rest[0])
  else if (verb === "grouped-term")            emitGroupedTerm()
  else if (verb === "grouped")                 emitGrouped(rest)
  else if (verb === "cwd-detect")              emitCwdDetect()
  else { console.error("usage: runtime.js list | show <name> | run <name> | safe <name> | grouped-term | grouped <name>... | cwd-detect"); process.exit(1) }
}

module.exports = { COMMANDS, CWD, safeCmd, groupedRun, groupedTerm, detectCwd, ANCHOR }
