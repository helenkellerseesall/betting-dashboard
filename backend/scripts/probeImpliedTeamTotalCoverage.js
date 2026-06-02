"use strict"

/**
 * Probe coverage of row.impliedTeamTotal across MLB tracked_bets for today.
 * Shows before/after counts for the fallback wire.
 *
 *   node backend/scripts/probeImpliedTeamTotalCoverage.js > .scratch/last.txt 2>&1
 */

const fs = require("fs")
const path = require("path")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

// Phase Date-Doctrine-1B — canonical ET slate date (4 AM boundary)
const today = currentSlateDateEt()
const file = path.join(__dirname, "..", "runtime", "tracking", `mlb_tracked_bets_${today}.json`)

if (!fs.existsSync(file)) {
	console.error(`[probe] file not found: ${file}`)
	process.exit(1)
}

const bets = JSON.parse(fs.readFileSync(file, "utf8"))
console.log(`MLB tracked_bets ${today}: ${bets.length} total entries`)

// Count batter-side rows (RBI/Runs/Hits/TB/HR engines all need impliedTeamTotal)
let batterRows = 0
let withItt = 0
let withGameTotal = 0
let withBoth = 0
let neitherCount = 0
const byFamily = {}
for (const b of bets) {
	const fam = String(b.statFamily || "").toLowerCase()
	if (fam.startsWith("pitcher") || fam === "ks" || fam === "outs") continue
	batterRows += 1
	const hasItt = b.impliedTeamTotal != null && Number.isFinite(Number(b.impliedTeamTotal))
	const hasGt = b.gameTotal != null && Number.isFinite(Number(b.gameTotal))
	if (hasItt) withItt += 1
	if (hasGt) withGameTotal += 1
	if (hasItt && hasGt) withBoth += 1
	if (!hasItt && !hasGt) neitherCount += 1
	const slot = byFamily[fam] || { total: 0, withItt: 0 }
	slot.total += 1
	if (hasItt) slot.withItt += 1
	byFamily[fam] = slot
}

console.log(`\nBatter-side rows: ${batterRows}`)
console.log(`  with impliedTeamTotal:    ${withItt} (${((withItt / batterRows) * 100).toFixed(1)}%)`)
console.log(`  with gameTotal:           ${withGameTotal} (${((withGameTotal / batterRows) * 100).toFixed(1)}%)`)
console.log(`  with BOTH:                ${withBoth} (${((withBoth / batterRows) * 100).toFixed(1)}%)`)
console.log(`  with NEITHER:             ${neitherCount} (${((neitherCount / batterRows) * 100).toFixed(1)}%)`)

console.log(`\nBackfill projection:`)
console.log(`  Rows needing backfill (have gameTotal but missing impliedTeamTotal): ${withGameTotal - withBoth}`)
const afterCoverage = withItt + (withGameTotal - withBoth)
console.log(`  Post-backfill impliedTeamTotal coverage: ${afterCoverage} (${((afterCoverage / batterRows) * 100).toFixed(1)}%)`)
console.log(`  Still missing (no gameTotal at all): ${neitherCount}`)

console.log(`\nPer-family breakdown:`)
for (const [fam, s] of Object.entries(byFamily).sort((a, b) => b[1].total - a[1].total)) {
	const pct = ((s.withItt / s.total) * 100).toFixed(0)
	console.log(`  ${fam.padEnd(20)} ${s.total.toString().padStart(5)} rows · ${s.withItt} with itt (${pct}%)`)
}
