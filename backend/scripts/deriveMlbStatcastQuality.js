#!/usr/bin/env node
"use strict"
/**
 * deriveMlbStatcastQuality.js — NEW Baseball Savant quality-metrics STAGING ingest (2026-06-18, CB).
 *
 * Pulls the Savant batter statcast_search detail CSV for the CURRENT ET season and derives, per
 * batter, real contact-quality metrics that DON'T exist anywhere in the repo yet:
 *   barrelPct   — barrels ÷ batted balls (barrel column, else launch_speed_angle==6)
 *   hardHitPct  — (launch_speed ≥ 95) ÷ batted balls
 *   xwoba       — mean estimated_woba_using_speedangle over batted balls (xwOBA-on-contact)
 *   xslg, xba   — mean estimated_slg/ba_using_speedangle (where present)
 *
 * Parsed by headers.indexOf(...) so column order is irrelevant. ANTI-FABRICATION: a metric whose
 * source column is absent is written as null — NEVER invented. Season comes from slateDate.js
 * (ET slate-date year) — never hardcoded, never toISOString().slice.
 *
 * STAGING ONLY: writes backend/data/mlbStatcastQuality.json with ZERO live consumer BY DESIGN.
 * Wiring these into HR scoring / the snapshot is a SEPARATE post-freeze + forward-CLV-gated task.
 * Does NOT touch the orphan (buildMlbStatcastPower.js) or the live deriver
 * (deriveMlbStatcastPower.js, iso/hrRate → powerScore). New canonical staging owner (Law 1).
 *
 *   node backend/scripts/deriveMlbStatcastQuality.js > .scratch/last.txt 2>&1
 */
const axios = require("axios")
const fs = require("fs")
const path = require("path")
const normalizeName = require("../utils/normalizeName")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

// Season = ET year from the canonical slate-date authority (currentSlateDateEt() = "YYYY-MM-DD" in
// ET). Slicing the canonical ET string is NOT toISOString().slice (which would be UTC-wrong).
const SEASON = currentSlateDateEt().slice(0, 4)
const OUT = path.join(__dirname, "..", "data", "mlbStatcastQuality.json")
const URL = `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R&player_type=batter&hfSea=${SEASON}`
const HARD_HIT_MPH = 95
const r3 = (x) => Math.round(x * 1000) / 1000

// CSV line splitter that respects quoted fields (Savant player_name is "Last, First" with an
// embedded comma — a naive split(',') would corrupt every column after the name).
function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c } else if (c === ",") { out.push(cur); cur = "" } else if (c === '"') { q = true } else cur += c
  }
  out.push(cur); return out
}

// "Last, First" → "First Last" → normalizeName, so keys match the HR engine's normalizeName(row.player).
function canonNameKey(raw) {
  let n = String(raw || "").trim()
  if (n.includes(",")) { const [last, first] = n.split(/,\s*/); if (first) n = `${first} ${last}` }
  return normalizeName(n)
}

/**
 * Parse a Savant detail CSV string → { out: {key:{metrics}}, have:{col present?}, players, battedBalls }.
 * Exported so the parser can be proven on a saved sample without network.
 */
function parseQuality(csv, season = SEASON) {
  const lines = csv.split("\n")
  const headers = parseCsvLine(lines[0])
  const idx = (name) => headers.indexOf(name)
  const iName = idx("player_name")
  const iLS = idx("launch_speed")
  const iBarrel = idx("barrel")
  const iLSA = idx("launch_speed_angle")
  const iXwoba = idx("estimated_woba_using_speedangle")
  const iXslg = idx("estimated_slg_using_speedangle")
  const iXba = idx("estimated_ba_using_speedangle")
  const have = {
    barrel: iBarrel >= 0 || iLSA >= 0,
    hardHit: iLS >= 0,
    xwoba: iXwoba >= 0,
    xslg: iXslg >= 0,
    xba: iXba >= 0,
  }
  const agg = {}
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r]) continue
    const cols = parseCsvLine(lines[r])
    const rawName = iName >= 0 ? cols[iName] : null
    if (!rawName) continue
    const ls = iLS >= 0 ? parseFloat(cols[iLS]) : NaN
    if (!Number.isFinite(ls)) continue   // batted-ball events only (launch_speed present)
    const key = canonNameKey(rawName)
    if (!key) continue
    const a = agg[key] || (agg[key] = { name: key, bbe: 0, hard: 0, barrels: 0, xwS: 0, xwN: 0, xsS: 0, xsN: 0, xbS: 0, xbN: 0 })
    a.bbe++
    if (ls >= HARD_HIT_MPH) a.hard++
    let isBarrel = null
    if (iBarrel >= 0) { const b = parseInt(cols[iBarrel], 10); isBarrel = Number.isFinite(b) ? b === 1 : null } else if (iLSA >= 0) { const z = parseInt(cols[iLSA], 10); isBarrel = Number.isFinite(z) ? z === 6 : null }
    if (isBarrel === true) a.barrels++
    if (iXwoba >= 0) { const v = parseFloat(cols[iXwoba]); if (Number.isFinite(v)) { a.xwS += v; a.xwN++ } }
    if (iXslg >= 0) { const v = parseFloat(cols[iXslg]); if (Number.isFinite(v)) { a.xsS += v; a.xsN++ } }
    if (iXba >= 0) { const v = parseFloat(cols[iXba]); if (Number.isFinite(v)) { a.xbS += v; a.xbN++ } }
  }
  const out = {}
  for (const [key, a] of Object.entries(agg)) {
    out[key] = {
      battedBalls: a.bbe,
      barrelPct: have.barrel && a.bbe > 0 ? r3(a.barrels / a.bbe) : null,
      hardHitPct: have.hardHit && a.bbe > 0 ? r3(a.hard / a.bbe) : null,
      xwoba: a.xwN > 0 ? r3(a.xwS / a.xwN) : null,
      xslg: a.xsN > 0 ? r3(a.xsS / a.xsN) : null,
      xba: a.xbN > 0 ? r3(a.xbS / a.xbN) : null,
      source: "baseball_savant_statcast_search",
      season,
      derivedAt: new Date().toISOString(),
    }
  }
  return { out, have, players: Object.keys(out).length, battedBalls: Object.values(agg).reduce((s, a) => s + a.bbe, 0) }
}

async function main() {
  console.log("[statcast-quality] season (ET, from slateDate.currentSlateDateEt):", SEASON)
  console.log("[statcast-quality] URL:", URL)
  let csv
  try {
    const res = await axios.get(URL, { timeout: 90000, maxContentLength: 8e8, maxBodyLength: 8e8, responseType: "text" })
    csv = res.data
  } catch (e) {
    console.error("[statcast-quality] FETCH FAILED:", e.code || e.message)
    console.error("[statcast-quality] Baseball Savant is not reachable from this host (network allowlist). Run on the operator machine.")
    process.exit(1)
  }
  if (!csv || csv.length < 1000) { console.error("[statcast-quality] empty/invalid CSV (bytes:", (csv || "").length, ")"); process.exit(1) }
  console.log("[statcast-quality] CSV bytes:", csv.length)
  const { out, have, players } = parseQuality(csv)
  if (players === 0) { console.error("[statcast-quality] parsed 0 players — aborting (no write)"); process.exit(1) }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  const names = Object.keys(out)
  const cov = (f) => names.filter((n) => out[n][f] != null).length
  console.log("[statcast-quality] columns present:", JSON.stringify(have))
  console.log(`[statcast-quality] players: ${players}`)
  console.log(`[statcast-quality] coverage — barrelPct ${cov("barrelPct")}/${players} · hardHitPct ${cov("hardHitPct")}/${players} · xwoba ${cov("xwoba")}/${players} · xslg ${cov("xslg")}/${players} · xba ${cov("xba")}/${players}`)
  for (const n of names.sort((a, b) => out[b].battedBalls - out[a].battedBalls).slice(0, 8)) {
    console.log(`  ${n.padEnd(26)} bbe=${out[n].battedBalls} barrel%=${out[n].barrelPct} hardHit%=${out[n].hardHitPct} xwoba=${out[n].xwoba}`)
  }
  console.log("[statcast-quality] wrote", OUT, "— STAGING, zero live consumer by design (wire post-freeze)")
}

module.exports = { parseQuality, parseCsvLine, canonNameKey, SEASON }
if (require.main === module) main()
