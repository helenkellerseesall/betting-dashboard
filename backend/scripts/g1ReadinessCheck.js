#!/usr/bin/env node
/**
 * g1ReadinessCheck.js — READ-ONLY morning print of G1 corpus readiness.
 * Thin CLI over the shared computation (backend/pipeline/shared/g1Readiness.js) — the SAME
 * logic the /status "G1 readiness" card uses (Law 1: one source of truth). Writes nothing,
 * grades nothing, no scoring. Run after the 4 AM grade:
 *   node backend/scripts/g1ReadinessCheck.js
 */
const { computeG1Readiness } = require("../pipeline/shared/g1Readiness")

const r = computeG1Readiness()

console.log("================ G1 READINESS — MORNING CHECK ================")
if (!r.ok) { console.log("Cannot read the corpus: " + r.error); process.exit(0) }
console.log(`(read-only · ${r.asOfEt} ET · forward since ${r.freeze} · need ${r.need} clean days by ${r.target})\n`)

const last = r.lastCompleted
if (!last) console.log("No completed forward slates yet.")
else if (last.state === "clean") console.log(`✓ Last night graded CLEAN — ${last.day}: ${last.gradeable.toLocaleString()} bets graded.`)
else if (last.state === "gap") console.log(`⚠ GAP — ${last.day} had ${last.total.toLocaleString()} bets but only ${last.gradeable} graded (under ${r.floor}). That night did NOT count toward G1.`)
else console.log(`• ${last.day}: no real MLB slate (${last.total} rows) — benign, did not add a clean day.`)

console.log(`\nClean forward days so far: ${r.cleanCount} of ${r.need}.`)
if (r.gapDays.length) console.log(`Grading gaps (did not count): ${r.gapDays.map(d => `${d.day} (${d.gradeable}/${d.total})`).join(", ")}`)
if (r.noSlateDays.length) console.log(`No-slate days (benign): ${r.noSlateDays.join(", ")}`)

const icon = r.verdict === "ready" ? "✅" : r.verdict === "on_track" ? "🟢" : r.verdict === "slipped" ? "🟡" : "•"
console.log(`\nVERDICT: ${icon} ${r.verdictText}`)
console.log(`(slates still to grade by ${r.target}: ${r.remainingToTarget})`)
console.log("\nPer-day (forward): " + r.perDay.map(d => `${d.day.slice(5)}=${d.gradeable == null ? "?" : d.gradeable}`).join("  "))
console.log("=============================================================")
