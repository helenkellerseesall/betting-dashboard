#!/usr/bin/env node
"use strict"
/**
 * clvCaptureFunnel.js — read-only CLV closing-line CAPTURE FUNNEL + forward tracker.
 *
 * Created 2026-06-17 (CB, Docket #2). Quantifies WHERE settled picks lose their
 * closing line, so the operator can watch capture rate forward and confirm any
 * ops fix. READ-ONLY (no scoring, no writes to tracked data). Analytics only —
 * closeOdds/clv are post-bet and feed grading/CLV, NOT the frozen scoring path
 * (verified: no scoring file references closeOdds/clv/clvQuality).
 *
 *   node backend/scripts/clvCaptureFunnel.js            # all-history funnel
 *   node backend/scripts/clvCaptureFunnel.js --days=3   # last N day-files only
 *   node backend/scripts/clvCaptureFunnel.js --sport=mlb (default mlb; nba supported)
 *
 * Stages: settled → openOdds stamped → gameTime present → closeOdds/clvQuality
 * stamped. Plus capture rate by ET first-pitch hour (the 6am–3pm sleep-window
 * test), by book (match-quality signal), and capture RECENCY (minutes before tip
 * the recorded "close" was actually observed — window-edge = stale close).
 */
const fs = require("fs"), path = require("path")
const TRK = path.join(__dirname, "..", "runtime", "tracking")
const args = process.argv.slice(2)
const sport = (args.find(a => a.startsWith("--sport=")) || "--sport=mlb").split("=")[1]
const daysArg = (args.find(a => a.startsWith("--days=")) || "").split("=")[1]
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + "%" : "—"
const etHour = (iso) => { try { return parseInt(new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }), 10) } catch (_) { return null } }

let files = fs.readdirSync(TRK).filter(f => new RegExp(`^${sport}_tracked_bets_\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f)).sort()
if (daysArg && Number.isFinite(Number(daysArg))) files = files.slice(-Number(daysArg))
const rows = []
for (const f of files) {
  let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRK, f), "utf8")); a = Array.isArray(j) ? j : Object.values(j) } catch (_) { continue }
  for (const r of a) {
    if (!r || (r.result !== "win" && r.result !== "loss")) continue
    rows.push(r)
  }
}
const N = rows.length
const open = rows.filter(r => r.openOdds != null)
const openGT = open.filter(r => !!r.gameTime)
const closed = rows.filter(r => r.clvQuality != null)
const openGTClosed = openGT.filter(r => r.clvQuality != null)

const L = []
const log = (s) => L.push(s)
log(`=== CLV CAPTURE FUNNEL — ${sport.toUpperCase()} settled picks (READ-ONLY) ===`)
log(`generated ${new Date().toISOString()} | ${files.length} day-files${daysArg ? ` (last ${daysArg})` : ""} | settled ${N}`)
log("")
log("FUNNEL:")
log(`  settled                         ${N}`)
log(`  openOdds stamped                ${open.length}  (${pct(open.length, N)})`)
log(`  + gameTime present              ${openGT.length}  (${pct(openGT.length, N)})`)
log(`  + closeOdds/clvQuality stamped  ${openGTClosed.length}  (${pct(openGTClosed.length, N)})  ← CLV coverage`)
log("")
log("DROP-OUT:")
log(`  no openOdds:                ${N - open.length} (${pct(N - open.length, N)})`)
log(`  openOdds, no gameTime:      ${open.length - openGT.length} (${pct(open.length - openGT.length, N)})`)
log(`  open+gameTime, no close:    ${openGT.length - openGTClosed.length} (${pct(openGT.length - openGTClosed.length, N)})  ← loop-not-running / window-miss / match-fail`)

// capture rate by ET first-pitch hour
log("\nCAPTURE RATE by ET first-pitch hour (sleep window 06–14 ET flagged):")
const byHour = new Map()
for (const r of openGT) { const h = etHour(r.gameTime); if (h == null) continue; if (!byHour.has(h)) byHour.set(h, { n: 0, c: 0 }); const o = byHour.get(h); o.n++; if (r.clvQuality != null) o.c++ }
for (const h of [...byHour.keys()].sort((a, b) => a - b)) { const o = byHour.get(h); log(`  ${String(h).padStart(2, "0")}:00 ET  n=${String(o.n).padStart(5)}  capture ${pct(o.c, o.n).padStart(6)}${(h >= 6 && h < 15) ? "  ← sleep window" : ""}`) }

// when capture SUCCEEDS (closeObservedAt) + recency (min before tip)
const cap = rows.filter(r => r.clvQuality != null && r.closeObservedAt)
const byObs = new Map(); const lags = []
for (const r of cap) {
  const h = etHour(r.closeObservedAt); byObs.set(h, (byObs.get(h) || 0) + 1)
  if (r.gameTime) { const lag = (new Date(r.gameTime).getTime() - new Date(r.closeObservedAt).getTime()) / 60000; if (Number.isFinite(lag)) lags.push(lag) }
}
log("\nWHEN CAPTURE SUCCEEDS (closeObservedAt ET hour):")
for (const h of [...byObs.keys()].sort((a, b) => a - b)) log(`  ${String(h).padStart(2, "0")}:00 ET  ${byObs.get(h)}`)
lags.sort((a, b) => a - b)
if (lags.length) { const q = (p) => lags[Math.floor(p * lags.length)]; log(`\nRECENCY (min before tip the "close" was observed; window edge=${180}=stale): p10=${q(.1)?.toFixed(0)} p50=${q(.5)?.toFixed(0)} p90=${q(.9)?.toFixed(0)} (lower = closer to true close)`) }

// by book
log("\nCAPTURE RATE by book (match-quality signal):")
const byBook = new Map()
for (const r of openGT) { const b = String(r.sportsbook || "?"); if (!byBook.has(b)) byBook.set(b, { n: 0, c: 0 }); const o = byBook.get(b); o.n++; if (r.clvQuality != null) o.c++ }
for (const [b, o] of [...byBook.entries()].sort((x, y) => y[1].n - x[1].n)) log(`  ${b.padEnd(16)} n=${String(o.n).padStart(5)}  capture ${pct(o.c, o.n)}`)

const text = L.join("\n") + "\n"
process.stdout.write(text)
