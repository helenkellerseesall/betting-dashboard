#!/usr/bin/env node
"use strict"

/**
 * BRAIN BOOTSTRAP — read this FIRST at the start of any session.
 *
 *   node backend/scripts/brain/loadBrainContext.js
 *   npm run brain:bootstrap
 *
 * Surfaces (without doing any work or modifying state):
 *   - Current project phase (from MASTER_BRAIN.md)
 *   - Current priorities
 *   - Open + watch incidents (from ACTIVE_INCIDENTS.md)
 *   - 17 architecture laws (titles only, from ARCHITECTURE_LAWS.md)
 *   - DO-NOT-REINTRODUCE list
 *   - Last 5 evolution entries (from MODEL_EVOLUTION_LOG.md)
 *   - Pointers to which doc to read for which question
 *
 * Output is operator-readable plaintext. No side effects.
 */

const lib = require("./_brainLib")

function section(title) {
  console.log("\n" + "─".repeat(70))
  console.log(title)
  console.log("─".repeat(70))
}

function bullet(s) {
  console.log("  • " + s)
}

function run() {
  const master   = lib.readBrainFile("MASTER_BRAIN.md")
  const laws     = lib.readBrainFile("ARCHITECTURE_LAWS.md")
  const incs     = lib.readBrainFile("ACTIVE_INCIDENTS.md")
  const evol     = lib.readBrainFile("MODEL_EVOLUTION_LOG.md")
  const operator = lib.readBrainFile("OPERATOR_PROTOCOL.md")

  console.log("╔" + "═".repeat(68) + "╗")
  console.log("║  REPO BRAIN BOOTSTRAP — operational continuity anchor             ║")
  console.log("║  backend/runtime/brain/                                            ║")
  console.log("╚" + "═".repeat(68) + "╝")

  // CURRENT PHASE
  section("CURRENT PROJECT PHASE")
  const phase = lib.extractCurrentProjectPhase(master)
  if (phase) console.log(phase.split("\n").slice(0, 6).join("\n"))
  else       console.log("(MASTER_BRAIN.md missing or malformed)")

  // CURRENT PRIORITIES
  section("CURRENT PRIORITIES")
  const priorities = lib.extractCurrentPriorities(master)
  if (priorities.length) priorities.forEach((p) => console.log("  " + p))
  else                   console.log("  (none listed)")

  // OPEN INCIDENTS
  section("OPEN / WATCH INCIDENTS (read backend/runtime/brain/ACTIVE_INCIDENTS.md for full detail)")
  const openIncs = lib.extractOpenIncidents(incs)
  if (!openIncs.length) {
    console.log("  (none — all clear)")
  } else {
    openIncs.forEach((i) => {
      const status = i.status ? `[${i.status}]` : ""
      console.log(`  ${i.id} ${status} — ${i.title}`)
    })
  }

  // ARCHITECTURE LAWS (titles only)
  section("ARCHITECTURE LAWS (17 non-negotiable — read backend/runtime/brain/ARCHITECTURE_LAWS.md before patching)")
  const lawList = lib.extractArchitectureLaws(laws)
  if (!lawList.length) {
    console.log("  (ARCHITECTURE_LAWS.md missing or malformed)")
  } else {
    lawList.forEach((l) => console.log(`  Law ${String(l.n).padStart(2, " ")} — ${l.title}`))
  }

  // DO NOT REINTRODUCE
  section("DO NOT REINTRODUCE")
  const dnr = lib.extractDoNotReintroduce(master)
  if (!dnr.length) console.log("  (none listed)")
  else             dnr.slice(0, 12).forEach((s) => bullet(s))
  if (dnr.length > 12) console.log(`  … and ${dnr.length - 12} more in MASTER_BRAIN.md`)

  // OPERATOR PROTOCOL highlights
  section("OPERATOR PROTOCOL (response style + workflow — read backend/runtime/brain/OPERATOR_PROTOCOL.md in full)")
  if (!operator) {
    console.log("  (OPERATOR_PROTOCOL.md missing — recover canonical operator doctrine)")
  } else {
    const styleLines = (lib.extractSection(operator, "RESPONSE STYLE") || "").split("\n")
      .filter((l) => /^\d+\./.test(l.trim()))
      .slice(0, 7)
    console.log("  Response style:")
    styleLines.forEach((l) => console.log("    " + l.trim()))
    console.log("")
    console.log("  Per-patch ceremony: bootstrap → patch → fixture → matrix → memory docs → checkpoint → operator report")
    console.log("  Per-patch report must state: files touched, lines changed, verification output,")
    console.log("                                TERM 1 restart (YES/NO), TERM 2 verify command,")
    console.log("                                checkpoint recommendation (YES/NO).")
  }

  // RECENT EVOLUTION ENTRIES
  section("RECENT ARCHITECTURE EVOLUTION (latest 5 — read MODEL_EVOLUTION_LOG.md for full history)")
  const entries = lib.extractRecentEvolutionEntries(evol, 5)
  if (!entries.length) console.log("  (none)")
  else                 entries.forEach((e) => console.log(`  ${e.date}  ${e.title}`))

  // POINTERS
  section("READ-ORDER POINTERS")
  console.log("  Architecture / debug questions      → MASTER_BRAIN.md")
  console.log("  How to behave / respond / sequence  → OPERATOR_PROTOCOL.md")
  console.log("  Live runtime state                  → CURRENT_RUNTIME_STATE.md")
  console.log("  Open risks / unresolved issues      → ACTIVE_INCIDENTS.md")
  console.log("  Which module owns subsystem X       → PIPELINE_AUTHORITY_MAP.md")
  console.log("  Vendor API contracts                → SPORTSBOOK_CONTRACTS.md")
  console.log("  Why we did X / chronological why    → MODEL_EVOLUTION_LOG.md")
  console.log("  Non-negotiable rules                → ARCHITECTURE_LAWS.md")
  console.log("  Pending operator actions / curls    → ../../../NEXT_SESSION.md")
  console.log("  Granular session log                → ../../../CURRENT_STATE.md")

  // CONTINUITY-RECEIPT WRITE — the central act of "this session bootstrapped"
  // is persisted to .brain_bootstrap_state.json so subsequent commands can
  // detect drift / staleness. (Autonomous continuity enforcement layer.)
  const nowIso = new Date().toISOString()
  const sessionId = require("crypto").randomBytes(6).toString("hex")
  const receipt = lib.writeBootstrapReceipt({
    lastBootstrapAt: nowIso,
    lastBootstrapSessionId: sessionId,
    brainDocHashAtBootstrap:   lib.hashBrainDocs(),
    runtimeCodeHashAtBootstrap: lib.hashRuntimeCode(),
  })

  section("CONTINUITY RECEIPT WRITTEN")
  console.log("  lastBootstrapAt        : " + receipt.lastBootstrapAt)
  console.log("  lastBootstrapSessionId : " + receipt.lastBootstrapSessionId)
  console.log("  brain doc hash         : " + receipt.brainDocHashAtBootstrap.slice(0, 22) + "…")
  console.log("  runtime code hash      : " + receipt.runtimeCodeHashAtBootstrap.slice(0, 22) + "…")
  console.log("  file                   : " + lib.BOOTSTRAP_RECEIPT_PATH.replace(lib.REPO_ROOT + "/", ""))

  section("NEXT")
  console.log("  • Patch following ARCHITECTURE_LAWS.md Law 15 (read before patch).")
  console.log("  • Run `npm run brain:status`     for a quick freshness snapshot.")
  console.log("  • Run `npm run brain:continuity` to inspect bootstrap-receipt drift.")
  console.log("  • Run `npm run brain:verify`     before declaring work done.")
  console.log("  • Run `npm run brain:checkpoint` at end-of-session to enforce update discipline.")
  console.log("")
}

run()
