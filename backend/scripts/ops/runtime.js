#!/usr/bin/env node
"use strict"

/**
 * runtime.js — canonical runtime command registry.
 *
 * Single source of truth for every named operator-runnable shell command.
 * Operator should NEVER guess a command; assistant should ALWAYS cite a
 * name from this registry in the operational footer's `next-command`.
 *
 * Usage:
 *   node backend/scripts/ops/runtime.js list
 *   node backend/scripts/ops/runtime.js show <name>
 *   node backend/scripts/ops/runtime.js run  <name>     # echos command
 *
 * Phase OO-1 (Operational Orchestration Slice 1, 2026-05-19).
 */

const COMMANDS = Object.freeze({
  // ── verification ──────────────────────────────────────────────────────
  "v5": {
    desc: "Run the full V5 verifier matrix (47-check runner).",
    cmd:  "cd backend && npm run ops:verify",
    lane: "INFRA / GOVERNANCE",
  },
  "v5-fe": {
    desc: "FE typecheck (frontend tsc --noEmit).",
    cmd:  "cd frontend && npx tsc --noEmit",
    lane: "FRONTEND / UX LAB",
  },
  "v6": {
    desc: "Brain checkpoint (continuity + brain freshness + checkpoint chain).",
    cmd:  "cd backend && npm run brain:checkpoint",
    lane: "INFRA / GOVERNANCE",
  },
  "verify-sportsbook": {
    desc: "Run the 4 sportsbook-governance verifiers.",
    cmd:  "node backend/scripts/verifySportsbookTopologyShape.js && " +
          "node backend/scripts/verifySameBookConstructability.js && " +
          "node backend/scripts/verifySportsbookConstructability.js && " +
          "node backend/scripts/verifyProcedureDrift.js",
    lane: "INFRA / GOVERNANCE",
  },
  "verify-orchestration": {
    desc: "Run the operational-orchestration verifier (backlog + lanes + footer template).",
    cmd:  "node backend/scripts/verifyOperationalOrchestration.js",
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
    lane: "ACTIVE EXECUTION",
  },
  "regen-state": {
    desc: "Fire /api/ws/state?sport=mlb to refresh workstation /state cache (60s TTL).",
    cmd:  "curl -s 'http://localhost:4000/api/ws/state?sport=mlb' | head -c 200",
    lane: "ACTIVE EXECUTION",
  },

  // ── live introspection ────────────────────────────────────────────────
  "inspect-tracked-best": {
    desc: "Print today's mlb_tracked_best_<today>.json hydration coverage.",
    cmd:  "node -e \"const fs=require('fs');const t=new Date().toISOString().slice(0,10);const p='backend/runtime/tracking/mlb_tracked_best_'+t+'.json';if(!fs.existsSync(p)){console.log('not-yet-written: '+p);process.exit(0);}const e=JSON.parse(fs.readFileSync(p,'utf8')).entries;const cnt=(pred)=>e.filter(pred).length;console.log({entries:e.length,eventId:cnt(x=>!!x.eventId),impliedTeamTotal:cnt(x=>Number.isFinite(Number(x.impliedTeamTotal))),gameTotal:cnt(x=>Number.isFinite(Number(x.gameTotal))),hrEnvironmentTag:cnt(x=>x.hrEnvironmentTag!=null),lineupSpot:cnt(x=>x.lineupSpot!=null),depth:cnt(x=>x.depth!=null)});\"",
    lane: "INFRA / GOVERNANCE",
  },
  "inspect-tracked-slips": {
    desc: "Print today's mlb_tracked_slips_<today>.json book-hydration summary.",
    cmd:  "node -e \"const fs=require('fs');const t=new Date().toISOString().slice(0,10);const p='backend/runtime/tracking/mlb_tracked_slips_'+t+'.json';if(!fs.existsSync(p)){console.log('not-yet-written: '+p);process.exit(0);}const slips=JSON.parse(fs.readFileSync(p,'utf8'));const s={total:slips.length,withSlipBook:0,withLegBooks:0,mixedBook:0,unauthorized:0};for(const x of slips){if(x.book)s.withSlipBook++;const bs=new Set();for(const l of x.legs||[]){if(l.book){s.withLegBooks++;bs.add(l.book);}}if(bs.size>1)s.mixedBook++;}console.log(s);\"",
    lane: "INFRA / GOVERNANCE",
  },
  "inspect-state-payload": {
    desc: "Print discoveryCandidates hydration summary from live /api/ws/state.",
    cmd:  "curl -s 'http://localhost:4000/api/ws/state?sport=mlb' | node -e \"let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);const dc=j.discoveryCandidates||[];console.log({pool:dc.length,withEventId:dc.filter(x=>!!x.eventId).length,distinctGames:new Set(dc.map(x=>x.eventId).filter(Boolean)).size,realismScore:j.aiSlipsSummary?.bettorRealismScore?.score??null});});\"",
    lane: "INFRA / GOVERNANCE",
  },

  // ── orchestration management ──────────────────────────────────────────
  "backlog-list": {
    desc: "List all OPEN + IN-SLICE backlog entries.",
    cmd:  "node backend/scripts/ops/backlogList.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "backlog-add": {
    desc: "Append a new backlog entry. Usage: backlog-add <lane> <title>",
    cmd:  "node backend/scripts/ops/backlogAdd.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "next-step": {
    desc: "Print the active slice's next-command from EXECUTION_BACKLOG.md.",
    cmd:  "node backend/scripts/ops/nextStep.js",
    lane: "OPERATOR PLAYBOOK",
  },

  // ── OO-2 enforcement layer ────────────────────────────────────────────
  "risk-add": {
    desc: "Append a new R-NNN-N entry to docs/OPEN_RISKS.md. Usage: risk-add <lane> <title> [slice]",
    cmd:  "node backend/scripts/ops/riskAdd.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "risk-list": {
    desc: "List OPEN + MITIGATED risks. Use --ids for comma-separated id list (footer carry-forward).",
    cmd:  "node backend/scripts/ops/riskList.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "lane-sync": {
    desc: "Atomic lane handoff: mutates EXECUTION_BACKLOG Active-slice lane + appends Lane log + appends linked BBL statusLog. Usage: lane-sync <new-lane> <reason>",
    cmd:  "node backend/scripts/ops/laneSync.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "playbook-sync": {
    desc: "Slice-close trigger: appends OPERATOR_RUNBOOK phase ledger line + asserts 4-surface continuity propagation. Usage: playbook-sync <slice-id> <summary> [commit]",
    cmd:  "node backend/scripts/ops/playbookSync.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "checkpoint-persist": {
    desc: "Writes .checkpoint/operational_state_<tag>.json snapshot (active slice + lane + open risks + open backlog + term commands). Inline-called by ops:checkpoint.",
    cmd:  "node backend/scripts/ops/checkpointPersist.js",
    lane: "OPERATOR PLAYBOOK",
  },

  // ── BC-1 bettor-cognition ingestion ──────────────────────────────────
  "cognition-add": {
    desc: "Append a BBL-NNNN cognition entry with full BC-1 schema (cognitionCategory + severity + priority + screenshots + linkedRisks + feelsFakeFlag + realismScore). Usage: cognition-add --lane L --title T --cognition C --severity S [--sportsbook|--ux|--risks|--screenshots|--feelsfake|--realism|--body]",
    cmd:  "node backend/scripts/ops/cognitionAdd.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "cognition-rank": {
    desc: "Rank OPEN + IN-SLICE cognition entries by composite score (priority + severity + cognition-weight + feelsFakeFlag + linkedRisks + screenshots + realism inverse).",
    cmd:  "node backend/scripts/ops/cognitionRank.js",
    lane: "OPERATOR PLAYBOOK",
  },
  "cognition-next": {
    desc: "Surface the next cognition execution slice candidate (top-ranked OPEN entry + recommended slice family + recommended lane).",
    cmd:  "node backend/scripts/ops/cognitionNext.js",
    lane: "OPERATOR PLAYBOOK",
  },
})

function list() {
  console.log("")
  console.log("Canonical runtime commands (use these in next-command footer field):")
  console.log("")
  for (const [name, def] of Object.entries(COMMANDS)) {
    console.log("  " + name.padEnd(28) + def.lane.padEnd(22) + " — " + def.desc)
  }
  console.log("")
  console.log("Show one: node backend/scripts/ops/runtime.js show <name>")
  console.log("")
}

function show(name) {
  const def = COMMANDS[name]
  if (!def) { console.error("unknown command: " + name); process.exit(1) }
  console.log(JSON.stringify({ name, ...def }, null, 2))
}

function emit(name) {
  const def = COMMANDS[name]
  if (!def) { console.error("unknown command: " + name); process.exit(1) }
  console.log(def.cmd)
}

if (require.main === module) {
  const [, , verb, name] = process.argv
  if (!verb || verb === "list") list()
  else if (verb === "show" && name)  show(name)
  else if (verb === "run"  && name)  emit(name)
  else { console.error("usage: runtime.js list | show <name> | run <name>"); process.exit(1) }
}

module.exports = { COMMANDS }
