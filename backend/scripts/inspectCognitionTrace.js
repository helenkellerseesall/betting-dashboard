#!/usr/bin/env node
"use strict"

/**
 * inspectCognitionTrace — reads backend/runtime/cognition_trace.jsonl
 * (written by nbaModelSignals.js when NBA_TRACE=1) and produces a per-pick
 * decomposition table for the 5 Lane-5 contradiction cases or any
 * (player, family, side, line) tuples the operator names.
 *
 * Usage:
 *   node backend/scripts/inspectCognitionTrace.js             # default 5 picks
 *   node backend/scripts/inspectCognitionTrace.js --player="James Harden"
 *   node backend/scripts/inspectCognitionTrace.js --summary   # aggregate by signal presence
 */

const fs   = require("fs")
const path = require("path")

const TRACE_PATH = path.join(__dirname, "..", "runtime", "cognition_trace.jsonl")

const DEFAULT_PICKS = [
  { player: "Jalen Brunson",     family: "points", side: "under", line: 20.5 },
  { player: "Donovan Mitchell",  family: "points", side: "under", line: 21.5 },
  { player: "Dennis Schroder",   family: "points", side: "under", line: 2.5 },
  { player: "Max Strus",         family: "points", side: "over",  line: 13.5 },
  { player: "James Harden",      family: "points", side: "under", line: 13.5 },
]

function parseArgs() {
  const out = { picks: [], summary: false }
  let cur = null
  for (const a of process.argv.slice(2)) {
    if (a === "--summary") out.summary = true
    else if (a.startsWith("--player=")) { cur = cur || {}; cur.player = a.slice(9) }
    else if (a.startsWith("--family=")) { cur = cur || {}; cur.family = a.slice(9) }
    else if (a.startsWith("--side="))   { cur = cur || {}; cur.side = a.slice(7) }
    else if (a.startsWith("--line="))   { cur = cur || {}; cur.line = Number(a.slice(7)) }
  }
  if (cur) out.picks.push(cur)
  if (!out.picks.length) out.picks = DEFAULT_PICKS
  return out
}

function readTrace() {
  if (!fs.existsSync(TRACE_PATH)) {
    console.error(`[inspect-trace] no trace file at ${TRACE_PATH}`)
    console.error("[inspect-trace] start backend with: NBA_TRACE=1 npm run engine:start")
    process.exit(1)
  }
  const lines = fs.readFileSync(TRACE_PATH, "utf8").split("\n").filter(Boolean)
  return lines.map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
}

function norm(s) { return String(s || "").toLowerCase().trim() }

function matchesPick(entry, pick) {
  if (!entry?.id) return false
  if (pick.player && norm(entry.id.player) !== norm(pick.player)) return false
  if (pick.family && norm(entry.id.family) !== norm(pick.family)) return false
  if (pick.side   && norm(entry.id.side)   !== norm(pick.side))   return false
  if (pick.line != null && Number(entry.id.line) !== Number(pick.line)) return false
  return true
}

function pct(n, d = 1) { return n == null ? "—" : `${(n * 100).toFixed(d)}%` }
function num(n, d = 3) { return n == null || !Number.isFinite(n) ? "—" : Number(n).toFixed(d) }

function presentCount(o) {
  if (!o) return 0
  return Object.values(o).filter((v) => v != null && Number.isFinite(v)).length
}

function dumpPick(picks, baseEntries, wrapperEntries) {
  for (const p of picks) {
    const base = baseEntries.filter((e) => matchesPick(e, p))
    const wrap = wrapperEntries.filter((e) => matchesPick(e, p))
    console.log()
    console.log("═".repeat(74))
    console.log(`PICK: ${p.player} · ${(p.side||"").toUpperCase()} ${p.line ?? "?"} ${p.family || "?"}`)
    console.log("─".repeat(74))
    if (!base.length && !wrap.length) {
      console.log("  ⚠  no trace entries for this pick — was the row processed in this run?")
      continue
    }
    // Use most-recent
    const b = base[base.length - 1]
    const w = wrap[wrap.length - 1]
    if (b) {
      console.log("BASE layer (signals + Z-scores + score path):")
      console.log("  raw signals present:")
      const rs = b.rawSignals || {}
      const rsFired = Object.entries(rs).filter(([_, v]) => v != null && Number.isFinite(v))
      console.log(`    ${rsFired.length}/${Object.keys(rs).length} signals have real values`)
      console.log(`    ${rsFired.map(([k, v]) => `${k}=${num(v, 2)}`).join("  ") || "(none)"}`)
      const zs = b.zScores || {}
      const zsFired = Object.entries(zs).filter(([_, v]) => v != null && Number.isFinite(v))
      console.log(`  Z-scores firing: ${zsFired.length}/${Object.keys(zs).length}`)
      console.log(`    ${zsFired.map(([k, v]) => `${k}=${num(v, 2)}`).join("  ") || "(none)"}`)
      console.log(`  primaryBundle: score=${num(b.bundle?.primaryScore, 3)} present=${b.bundle?.primarySignalsPresent || 0}/${b.bundle?.primarySignalsTotal || 6}`)
      console.log(`  score pre-invert: ${num(b.scoreSteps?.beforeSideInversion, 3)}    post-invert: ${num(b.scoreSteps?.afterSideInversion, 3)}`)
      console.log(`  baseFinal modelProb: ${pct(b.baseProbSteps?.baseFinal)}`)
    } else {
      console.log("BASE layer: NO ENTRY (cognition didn't run for this pick this session?)")
    }
    if (w) {
      console.log("WRAPPER layer (market shrink + shifts):")
      const en = w.enriched || {}
      console.log(`  enrichments present:`)
      console.log(`    recentForm:  ${en.recentForm ? `last5=${en.recentForm.last5_avg ?? "—"}` : "null"}`)
      console.log(`    starter:     ${en.starterFlag ?? "null"}    minutes: ${en.projectedMinutes ?? "null"}    ceiling: ${en.ceilingScore ?? "null"}`)
      console.log(`    opponent:    ${en.opponent ?? "null"}    status:  ${en.playerStatus ?? "null"}`)
      console.log(`    pre-stamped shifts: teammate=${num(en.teammateRedistShift, 4)}  market=${num(en.marketShift, 4)}  availability=${num(en.availabilityShift, 4)}`)
      const pr = w.probs || {}
      console.log(`  prob flow: implied=${pct(pr.implied)}  base=${pct(pr.baseModel)}  afterShrink=${pct(pr.afterMarketShrink)}  afterShifts=${pct(pr.afterShifts)}  FINAL=${pct(pr.final)}`)
      const sh = w.shifts || {}
      console.log(`  shifts:    matchup=${num(sh.matchup, 4)}  teammate=${num(sh.teammate, 4)}  market=${num(sh.market, 4)}  availability=${num(sh.availability, 4)}`)
      console.log(`  alpha:     ${num(w.alpha, 2)}  (pulls ${((1 - (w.alpha || 0)) * 100).toFixed(0)}% toward market)`)
    } else {
      console.log("WRAPPER layer: NO ENTRY")
    }
    console.log("═".repeat(74))
  }
}

function summary(baseEntries) {
  console.log("\nSUMMARY — signal presence across all traced rows")
  console.log("─".repeat(70))
  const SIGNAL_KEYS = ["usage", "shots", "astRate", "rebRate", "minutes", "role", "pace", "total", "spread", "oppDef", "recent"]
  const counts = Object.fromEntries(SIGNAL_KEYS.map((k) => [k, 0]))
  let total = 0
  for (const e of baseEntries) {
    const rs = e.rawSignals || {}
    for (const k of SIGNAL_KEYS) {
      if (rs[k] != null && Number.isFinite(rs[k])) counts[k]++
    }
    total++
  }
  console.log(`Total base-layer entries: ${total}`)
  for (const k of SIGNAL_KEYS) {
    const pct = total > 0 ? (counts[k] / total * 100).toFixed(1) : "0"
    console.log(`  ${k.padEnd(12)} present in ${counts[k]}/${total} (${pct}%)`)
  }
}

function main() {
  const opts = parseArgs()
  const all = readTrace()
  const base = all.filter((e) => e.__layer === "base")
  const wrap = all.filter((e) => !e.__layer)
  console.log(`[inspect-trace] loaded ${all.length} entries (${base.length} base, ${wrap.length} wrapper)`)
  if (opts.summary) {
    summary(base)
    return
  }
  dumpPick(opts.picks, base, wrap)
}

if (require.main === module) main()
