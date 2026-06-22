#!/usr/bin/env node
/**
 * g1ReadinessCheck.js — READ-ONLY morning print of G1 corpus readiness.
 * Thin CLI over the shared computation (backend/pipeline/shared/g1Readiness.js) — the SAME
 * logic the /status "calibration corpus" card uses (Law 1: one source of truth). Writes nothing,
 * grades nothing, no scoring. Run after the 4 AM grade:
 *   node backend/scripts/g1ReadinessCheck.js
 */
const { computeG1Readiness } = require("../pipeline/shared/g1Readiness")

const r = computeG1Readiness()

console.log("================ G1 READINESS — MORNING CHECK ================")
if (!r.ok) { console.log("Cannot read the corpus: " + r.error); process.exit(0) }
console.log(`(read-only · current slate ${r.currentSlate} · forward since ${r.freeze} · need ${r.need} clean nights by ${r.target})\n`)

// pending current slate (its 4 AM grade hasn't run yet) — informational, NOT a miss
if (r.pendingDay) {
  console.log(`• Tonight's slate ${r.pendingDay.day}: PENDING grade — grades ~4 AM ET (${Number(r.pendingDay.total).toLocaleString()} bets so far, not yet graded). Not counted as a miss.`)
}

const last = r.lastGraded
if (!last) console.log("No graded nights yet.")
else if (last.state === "clean") console.log(`✓ Last graded night CLEAN — ${last.day}: ${last.gradeable.toLocaleString()} bets graded.`)
else if (last.state === "fell_short") console.log(`⚠ Last graded night FELL SHORT — ${last.day}: ${last.total.toLocaleString()} bets but only ${last.gradeable} graded (under ${r.floor}). Did NOT count.`)
else console.log(`• ${last.day}: no real MLB slate (${last.total} rows) — benign, did not add a clean night.`)

console.log(`\nClean nights so far: ${r.cleanCount} of ${r.need}${r.pendingCount ? ` · ${r.pendingCount} pending tonight` : ""}.`)
if (r.fellShortDays.length) console.log(`Nights that fell short (counted as misses): ${r.fellShortDays.map(d => `${d.day} (${d.gradeable}/${d.total})`).join(", ")}`)
if (r.noSlateDays.length) console.log(`No-slate nights (benign): ${r.noSlateDays.join(", ")}`)

const icon = r.verdict === "ready" ? "✅" : r.verdict === "on_track" ? "🟢" : r.verdict === "slipped" ? "🟡" : "•"
console.log(`\nVERDICT: ${icon} ${r.verdictText}`)
console.log("\nPer-night (forward): " + r.perDay.map(d => `${d.day.slice(5)}=${d.gradeable == null ? "?" : d.gradeable}${d.state === "pending" ? "(pending)" : d.state === "fell_short" ? "(short)" : ""}`).join("  "))
console.log("=============================================================")
