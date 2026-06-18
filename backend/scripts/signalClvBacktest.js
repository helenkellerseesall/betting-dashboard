#!/usr/bin/env node
"use strict"
/**
 * signalClvBacktest.js — signal-vs-CLV backtest harness (2026-06-18, CB; #31).
 *
 * TWO sections, both READ-ONLY, output → .scratch/signal_clv_backtest.txt:
 *   FORWARD (trustworthy, no lookahead): joins SETTLED bets to their AS-OF-BET signal values captured
 *     by captureSignalSnapshot.js (signal_capture_<slate>.json), tertiles each signal × family,
 *     reports meanCLV/hitRate/n. Thin until forward captures accrue + grade — that's expected/honest.
 *   RETROSPECTIVE SCREEN (directional ONLY, heavily caveated): joins TODAY's season aggregates onto
 *     PAST bets — SLOW-MOVING signals only (pitcher FIP/SIERA on pitcher props; Statcast xwoba/barrel/
 *     hardHit on batter props). EXCLUDES air-density + opposing-pitcher (unreconstructable past).
 *     LOOKAHEAD-BIASED by construction → verdict capped at "directional / needs-fwd", cell floor n≥50.
 *
 * Reuses forwardClvSliceTracker.sliceStats + loadLedger (Law 1 — no parallel CLV analyzer).
 * Nothing wired. NEVER declares an edge from a tiny or lookahead cell.
 */
const fs = require("fs"), path = require("path")
const normalizeName = require("../utils/normalizeName")
const { sliceStats, loadLedger } = require("./forwardClvSliceTracker")

const DATA = path.join(__dirname, "..", "data")
const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const OUT = path.join(__dirname, "..", "..", ".scratch", "signal_clv_backtest.txt")
const MIN_CELL = 50
const BATTER_FAMS = new Set(["hits", "totalBases", "hr", "rbis", "runs"])
const PITCHER_FAMS = new Set(["ks", "outs", "earnedRuns"])
const key = (n) => normalizeName(String(n || ""))
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null } }
const out = []; const log = (s) => out.push(s)

// Tertile-bin rows (each {row, val}) by val, return [{bucket,n,range,stats}] using sliceStats.
function tertiles(pairs) {
  const valid = pairs.filter((p) => Number.isFinite(p.val)).sort((a, b) => a.val - b.val)
  if (valid.length < 3) return null
  const t = Math.floor(valid.length / 3)
  const groups = [valid.slice(0, t), valid.slice(t, 2 * t), valid.slice(2 * t)]
  const labels = ["low", "mid", "high"]
  return groups.map((g, i) => ({
    bucket: labels[i],
    range: g.length ? `${g[0].val.toFixed(3)}..${g[g.length - 1].val.toFixed(3)}` : "—",
    stats: sliceStats(g.map((p) => p.row)),
  }))
}

function fmtCell(s) { return `n=${String(s.n).padStart(4)} clv=${s.meanClv == null ? "  —  " : (s.meanClv >= 0 ? "+" : "") + s.meanClv} hit=${s.hitRatePct == null ? "—" : s.hitRatePct + "%"}` }

function main() {
  const all = loadLedger()   // every ledger row tagged with _slate (clv/clvQuality/result present where graded)
  log("=== SIGNAL-vs-CLV BACKTEST ===")
  log("generated " + new Date().toISOString())
  log(`ledger rows: ${all.length}\n`)

  // ── FORWARD (no lookahead) ──
  log("################ FORWARD (as-of-bet capture — TRUSTWORTHY, no lookahead) ################")
  const capFiles = fs.existsSync(TRACKING) ? fs.readdirSync(TRACKING).filter((f) => /^signal_capture_\d{4}-\d{2}-\d{2}\.json$/.test(f)) : []
  const cap = {}
  for (const f of capFiles) { const j = readJson(path.join(TRACKING, f)) || {}; for (const [id, e] of Object.entries(j)) cap[id] = e }
  log(`forward capture files: ${capFiles.length} (${capFiles.join(", ") || "none"}) · captured bets: ${Object.keys(cap).length}`)
  const byId = new Map(all.map((r) => [r.id, r]))
  // forward signal extractors: [label, betFilter, valueFn]
  const fwdSignals = [
    ["pitcherFip.fip (pitcher props)", (r, e) => PITCHER_FAMS.has(r.statFamily) && e.signals?.pitcherFip, (e) => e.signals.pitcherFip.fip],
    ["pitcherFip.siera (pitcher props)", (r, e) => PITCHER_FAMS.has(r.statFamily) && e.signals?.pitcherFip, (e) => e.signals.pitcherFip.siera],
    ["oppPitcherFip.fip (batter props)", (r, e) => BATTER_FAMS.has(r.statFamily) && e.signals?.opposingPitcherFip, (e) => e.signals.opposingPitcherFip.fip],
    ["statcast.xwoba (batter props)", (r, e) => BATTER_FAMS.has(r.statFamily) && e.signals?.statcastQuality, (e) => e.signals.statcastQuality.xwoba],
    ["statcast.barrelPct (batter props)", (r, e) => BATTER_FAMS.has(r.statFamily) && e.signals?.statcastQuality, (e) => e.signals.statcastQuality.barrelPct],
    ["airDensity (hr/totalBases)", (r, e) => (r.statFamily === "hr" || r.statFamily === "totalBases") && e.signals?.airDensity, (e) => e.signals.airDensity.airDensity],
  ]
  let fwdAny = false
  for (const [label, filt, vf] of fwdSignals) {
    const pairs = []
    for (const [id, e] of Object.entries(cap)) { const r = byId.get(id); if (r && filt(r, e)) pairs.push({ row: r, val: Number(vf(e)) }) }
    const graded = pairs.filter((p) => byId.get(p.row.id) && p.row.clvQuality != null).length
    log(`\n${label}: joined ${pairs.length} bets, ${graded} clv-stamped`)
    const t = tertiles(pairs)
    if (!t) { log("  (insufficient forward data — accrues as daily captures + grading land)"); continue }
    fwdAny = true
    for (const b of t) log(`  ${b.bucket.padEnd(5)} [${b.range}]  ${fmtCell(b.stats)}`)
  }
  if (!fwdAny) log("\n→ FORWARD is empty/thin today (captures just started; bets not graded). This is the clean clock — re-run as days accrue.")

  // ── RETROSPECTIVE SCREEN (directional ONLY — lookahead-biased) ──
  log("\n\n################ RETROSPECTIVE SCREEN (DIRECTIONAL ONLY — LOOKAHEAD-BIASED) ################")
  log("CAVEAT: today's season aggregates joined onto PAST bets = LOOKAHEAD (the aggregate includes")
  log("games after the bet). Slow-moving signals only; air-density + opposing-pitcher EXCLUDED. Cell")
  log("floor n>=" + MIN_CELL + " (smaller suppressed). Verdict CAPPED at 'directional/needs-fwd' — NEVER wire off this.")
  const statcast = readJson(path.join(DATA, "mlbStatcastQuality.json")) || {}
  const fip = readJson(path.join(DATA, "mlbPitcherFip.json")) || {}
  log(`(staging: statcast ${Object.keys(statcast).length} batters, fip ${Object.keys(fip).length} pitchers)`)

  const retro = [
    ["pitcher FIP", PITCHER_FAMS, (r) => fip[key(r.player)]?.fip],
    ["pitcher SIERA", PITCHER_FAMS, (r) => fip[key(r.player)]?.siera],
    ["batter xwoba", BATTER_FAMS, (r) => statcast[key(r.player)]?.xwoba],
    ["batter barrelPct", BATTER_FAMS, (r) => statcast[key(r.player)]?.barrelPct],
    ["batter hardHitPct", BATTER_FAMS, (r) => statcast[key(r.player)]?.hardHitPct],
  ]
  for (const [label, fams, vf] of retro) {
    // pool across the families this signal applies to (also show per-family if rich enough)
    const famList = [...fams].filter((f) => all.some((r) => r.statFamily === f && r.clvQuality != null && Number.isFinite(Number(vf(r)))))
    for (const fam of famList) {
      const pairs = all.filter((r) => r.statFamily === fam && r.clvQuality != null).map((r) => ({ row: r, val: Number(vf(r)) })).filter((p) => Number.isFinite(p.val))
      if (pairs.length < MIN_CELL * 3) { log(`\n${label} × ${fam}: pool n=${pairs.length} — too small for tertiles (need ${MIN_CELL * 3}); SUPPRESSED`); continue }
      const t = tertiles(pairs)
      log(`\n${label} × ${fam}: pool n=${pairs.length} → tertiles (directional/needs-fwd):`)
      for (const b of t) {
        if (b.stats.n < MIN_CELL) { log(`  ${b.bucket.padEnd(5)} [${b.range}]  n=${b.stats.n} — SUPPRESSED (n<${MIN_CELL})`); continue }
        log(`  ${b.bucket.padEnd(5)} [${b.range}]  ${fmtCell(b.stats)}   directional/needs-fwd`)
      }
    }
  }
  log("\nVERDICT KEY: forward = trustworthy (no lookahead); retrospective = directional screen ONLY, never a wiring basis. Always read n.")
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, out.join("\n") + "\n")
  process.stdout.write(out.join("\n") + "\n")
}
main()
