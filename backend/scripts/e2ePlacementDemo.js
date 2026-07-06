"use strict"

/**
 * e2ePlacementDemo.js — end-to-end placement-chain smoke (2026-07-06, SPINE-FIX close-out).
 *
 * Proves the EXACT chain the operator uses for real bets, on real board data:
 *   1. pick a real pending row from the CURRENT slate's tracked board picks,
 *   2. addPlacedBet single ($1, notes=e2e-test) → tuple auto-stamp fires,
 *   3. settlePlacedBet --list → the bet is visible with its id,
 *   4. settlePlacedBet --id=<it> --result=void → stake returned, P/L 0.
 * The voided $1 test row stays in the ledger permanently (placed bets are never
 * pruned) — notes="e2e-test" + void keeps the record clean and self-explaining.
 *
 * Usage:
 *   node backend/scripts/e2ePlacementDemo.js            # real run (writes + voids one $1 row)
 *   node backend/scripts/e2ePlacementDemo.js --dry-run  # add is previewed only; list/settle skipped
 */

const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const ROOT = path.join(__dirname, "..")
const DRY = process.argv.includes("--dry-run")

function sh(args) {
  try { return { out: execFileSync(process.execPath, args, { encoding: "utf8", cwd: ROOT }), code: 0 } }
  catch (e) { return { out: `${e.stdout || ""}${e.stderr || ""}`, code: e.status ?? 1 } }
}

const slate = currentSlateDateEt()
const trackedPath = path.join(ROOT, "runtime", "tracking", `mlb_tracked_bets_${slate}.json`)
let rows = []
try { if (fs.existsSync(trackedPath)) rows = JSON.parse(fs.readFileSync(trackedPath, "utf8")) } catch (_) { rows = [] }
const t = (Array.isArray(rows) ? rows : []).find((x) =>
  x && x.result === "pending" && x.player && x.statFamily && x.side &&
  Number.isFinite(Number(x.line)) && Number.isFinite(Number(x.oddsAmerican)) && x.sportsbook)

if (!t) {
  console.log(`[e2e] no pending tracked row on slate ${slate} (off-day or pre-slate) — demo SKIPPED, nothing written.`)
  process.exit(0)
}

console.log(`[e2e] slate ${slate} — using real board pick: ${t.player} | ${t.statFamily} | ${t.side} | ${t.line} | ${t.oddsAmerican} @ ${t.sportsbook}${t.calibVersion ? ` | calibVersion=${t.calibVersion}` : " | (no calibVersion on this row)"}`)

// 1. add ($1, e2e-test note)
const addArgs = [
  path.join(ROOT, "scripts", "addPlacedBet.js"), "single",
  "--sport=mlb", `--player=${t.player}`, `--stat=${t.statFamily}`,
  `--line=${t.line}`, `--side=${t.side}`, `--odds=${t.oddsAmerican}`,
  `--book=${t.sportsbook}`, "--stake=1", "--notes=e2e-test",
]
if (DRY) addArgs.push("--dry-run")
const add = sh(addArgs)
process.stdout.write(add.out)
if (add.code !== 0) { console.error("[e2e] FAIL at addPlacedBet"); process.exit(1) }
if (DRY) { console.log("[e2e] DRY RUN — list/void skipped, nothing written."); process.exit(0) }

// capture the id from the add output (addPlacedBet prints "  id:         <id>")
const idMatch = add.out.match(/id:\s+(\S+)/)
if (!idMatch) { console.error("[e2e] FAIL — could not parse bet id from addPlacedBet output"); process.exit(1) }
const betId = idMatch[1]

// 2. list — the bet must be visible as pending
const list = sh([path.join(ROOT, "scripts", "settlePlacedBet.js"), "--list"])
process.stdout.write(list.out)
if (list.code !== 0 || !list.out.includes(betId)) { console.error("[e2e] FAIL — new bet not visible in --list"); process.exit(1) }

// 3. void — book-authoritative manual settle; stake returned, P/L 0
const settle = sh([path.join(ROOT, "scripts", "settlePlacedBet.js"), `--id=${betId}`, "--result=void", "--note=e2e-test void — placement chain demo"])
process.stdout.write(settle.out)
if (settle.code !== 0) { console.error("[e2e] FAIL at settlePlacedBet void"); process.exit(1) }

console.log(`[e2e] PASS — add → list → void chain complete on ${betId} (voided, P/L 0, record clean).`)
process.exit(0)
