#!/usr/bin/env node
"use strict"
/**
 * deriveMlbHandednessSplits.js — NEW per-player vsLHP/vsRHP split STAGING ingest (2026-06-18, CB).
 *
 * Pulls REAL per-batter platoon splits (wOBA / K% / ISO / AVG / OPS / BB% / PA vs LHP and vs RHP)
 * and writes a NEW staging file backend/data/mlbHandednessSplits.json with ZERO live consumer.
 * This is the data that should eventually REPLACE the flat ±0.022/0.012/−0.020 heuristic in
 * deriveMlbHandednessContext.js — but that heuristic is LIVE + SCORING-CONSUMED
 * (composeMlbContextualSignal.batterPlatoonShift + buildMlbPropClusters.isPlatoonAdvantage, the
 * R2-frozen scorer), so it is FROZEN and stays UNTOUCHED. Wiring these splits in is a separate
 * post-freeze + forward-CLV-gated task. New canonical staging owner (Law 1).
 *
 * SOURCE IS PENDING CA VERIFICATION. We do NOT guess a Savant/FanGraphs/pybaseball URL and make the
 * operator run it (the Statcast v1→v3 lesson: source shape/columns are source-specific). The parser
 * core below is GENERIC (header.indexOf + candidate column names + anti-fab) and supports both likely
 * shapes; main() REFUSES to run until SOURCE is filled with CA's verified URL(s) + split layout.
 *
 * Season from slateDate.js (ET year) — never hardcoded. ANTI-FAB: present→parse, absent→null.
 *
 *   node backend/scripts/deriveMlbHandednessSplits.js > .scratch/last.txt 2>&1   (errors until SOURCE set)
 */
const axios = require("axios")
const fs = require("fs")
const path = require("path")
const normalizeName = require("../utils/normalizeName")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const SEASON = currentSlateDateEt().slice(0, 4)   // ET slate-date year (canonical; not toISOString)
const OUT = path.join(__dirname, "..", "data", "mlbHandednessSplits.json")

// ── PENDING CA-verified source (do NOT guess) ──────────────────────────────────────────────────
// When CA posts the verified splits source, set ONE of:
//   mode "two-csv": urlVsL + urlVsR (one row per player each), OR
//   mode "one-csv-split-col": urlOneCsv (two rows per player, distinguished by a split column).
// URLs may use ${SEASON}. Leave null = not runnable (refuses, no guessed pull).
const SOURCE = {
  mode: null,        // "two-csv" | "one-csv-split-col"
  urlVsL: null,
  urlVsR: null,
  urlOneCsv: null,
}

// Generic metric column candidates (FanGraphs + Savant + pybaseball naming variants). header.indexOf.
const SPLIT_COLS = {
  woba: ["wOBA", "woba", "est_woba", "xwoba"],
  kPct: ["K%", "k_percent", "strikeout_rate", "so_pct", "k_pct"],
  bbPct: ["BB%", "bb_percent", "walk_rate", "bb_pct"],
  iso: ["ISO", "iso"],
  avg: ["AVG", "avg", "ba", "batting_avg"],
  ops: ["OPS", "ops"],
  pa: ["PA", "pa", "plate_appearances"],
}
// Split-indicator column (Shape A) + its value→side mapping.
const SPLIT_COL_CANDS = ["split", "Split", "split_type", "vs", "Vs", "platoon", "bat_split"]
function sideFromSplitValue(v) {
  const s = String(v || "").toLowerCase()
  if (/lhp|vs\s*l\b|^l$|left/.test(s)) return "L"
  if (/rhp|vs\s*r\b|^r$|right/.test(s)) return "R"
  return null
}

const r3 = (x) => Math.round(x * 1000) / 1000

function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c } else if (c === ",") { out.push(cur); cur = "" } else if (c === '"') { q = true } else cur += c
  }
  out.push(cur); return out
}
function canonNameKey(raw) {
  let n = String(raw || "").trim()
  if (n.includes(",")) { const [last, first] = n.split(/,\s*/); if (first) n = `${first} ${last}` }
  return normalizeName(n)
}
function nameKeyFromRow(cols, H) {
  const iCombined = H.indexOf("last_name, first_name"); if (iCombined >= 0) return canonNameKey(cols[iCombined])
  const iFirst = H.indexOf("first_name"), iLast = H.indexOf("last_name")
  if (iFirst >= 0 && iLast >= 0) return canonNameKey(`${cols[iLast]}, ${cols[iFirst]}`)
  for (const nm of ["player_name", "Name", "name", "Player"]) { const i = H.indexOf(nm); if (i >= 0) return canonNameKey(cols[i]) }
  return ""
}

// Parse one CSV (assumed single-side OR pre-filtered) → { byKey, resolved, header, players }.
function parseSplitRows(csv, wantedCols) {
  const lines = csv.split("\n").filter((l) => l.length)
  const H = parseCsvLine(lines[0]).map((h) => h.trim())
  const resolved = {}
  for (const [field, cands] of Object.entries(wantedCols)) resolved[field] = cands.find((c) => H.indexOf(c) >= 0) || null
  const byKey = {}
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]); const key = nameKeyFromRow(cols, H); if (!key) continue
    const rec = {}
    for (const [field, col] of Object.entries(resolved)) {
      if (!col) { rec[field] = null; continue }
      const raw = cols[H.indexOf(col)]
      const v = parseFloat(String(raw).replace("%", "")); rec[field] = Number.isFinite(v) ? v : null
    }
    byKey[key] = rec
  }
  return { byKey, resolved, header: H, players: Object.keys(byKey).length }
}

// Shape A: one CSV, two rows/player split by a split column → { L:{byKey}, R:{byKey}, splitCol }.
function partitionBySplitCol(csv, wantedCols) {
  const lines = csv.split("\n").filter((l) => l.length)
  const H = parseCsvLine(lines[0]).map((h) => h.trim())
  const splitCol = SPLIT_COL_CANDS.find((c) => H.indexOf(c) >= 0) || null
  if (!splitCol) return { L: {}, R: {}, splitCol: null, header: H }
  const iSplit = H.indexOf(splitCol)
  const sides = { L: [lines[0]], R: [lines[0]] }
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]); const side = sideFromSplitValue(cols[iSplit])
    if (side === "L") sides.L.push(lines[r]); else if (side === "R") sides.R.push(lines[r])
  }
  return {
    L: parseSplitRows(sides.L.join("\n"), wantedCols).byKey,
    R: parseSplitRows(sides.R.join("\n"), wantedCols).byKey,
    splitCol, header: H,
  }
}

// Merge per-side maps → { key: { vsL:{...}|null, vsR:{...}|null } }.
function mergeSides(Lmap, Rmap) {
  const out = {}
  for (const k of new Set([...Object.keys(Lmap), ...Object.keys(Rmap)])) {
    out[k] = { vsL: Lmap[k] || null, vsR: Rmap[k] || null }
  }
  return out
}

async function fetchCsv(url) {
  try {
    const res = await axios.get(url, { timeout: 60000, maxContentLength: 5e8, maxBodyLength: 5e8, responseType: "text", validateStatus: () => true })
    return { ok: res.status === 200 && typeof res.data === "string" && res.data.length > 200, status: res.status, csv: res.data }
  } catch (e) { return { ok: false, status: null, err: e.code || e.message } }
}

async function main() {
  console.log("[handedness-splits] season (ET, from slateDate):", SEASON)
  if (!SOURCE.mode) {
    console.error("[handedness-splits] SOURCE PENDING — CA has not posted the verified splits URL/columns yet.")
    console.error("[handedness-splits] NOT running a guessed pull (Statcast v1→v3 lesson). Set SOURCE.mode + url(s), then re-run.")
    process.exit(2)
  }
  let merged
  if (SOURCE.mode === "two-csv") {
    const l = await fetchCsv(SOURCE.urlVsL.replace("${SEASON}", SEASON))
    const r = await fetchCsv(SOURCE.urlVsR.replace("${SEASON}", SEASON))
    if (!l.ok || !r.ok) { console.error(`[handedness-splits] fetch failed (vsL ${l.status || l.err}, vsR ${r.status || r.err})`); process.exit(1) }
    const Lp = parseSplitRows(l.csv, SPLIT_COLS), Rp = parseSplitRows(r.csv, SPLIT_COLS)
    console.log("[handedness-splits] vsL header:", JSON.stringify(Lp.header), "| mapping:", JSON.stringify(Lp.resolved))
    console.log("[handedness-splits] vsR header:", JSON.stringify(Rp.header), "| mapping:", JSON.stringify(Rp.resolved))
    merged = mergeSides(Lp.byKey, Rp.byKey)
  } else { // one-csv-split-col
    const c = await fetchCsv(SOURCE.urlOneCsv.replace("${SEASON}", SEASON))
    if (!c.ok) { console.error(`[handedness-splits] fetch failed (${c.status || c.err})`); process.exit(1) }
    const part = partitionBySplitCol(c.csv, SPLIT_COLS)
    console.log("[handedness-splits] header:", JSON.stringify(part.header), "| splitCol:", part.splitCol)
    merged = mergeSides(part.L, part.R)
  }
  const out = {}
  for (const [k, v] of Object.entries(merged)) {
    out[k] = { vsL: v.vsL, vsR: v.vsR, source: `baseball_splits(${SOURCE.mode})`, season: SEASON, derivedAt: new Date().toISOString() }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  const names = Object.keys(out)
  const covSide = (side, f) => names.filter((n) => out[n][side] && out[n][side][f] != null).length
  const medSide = (side, f) => { const a = names.map((n) => out[n][side] && out[n][side][f]).filter((x) => x != null).sort((x, y) => x - y); return a.length ? r3(a[Math.floor(a.length / 2)]) : null }
  const pct = (n) => names.length ? Math.round((n / names.length) * 100) : 0
  console.log(`\n[handedness-splits] players: ${names.length}`)
  console.log(`[handedness-splits] coverage vsL — woba ${covSide("vsL", "woba")} (${pct(covSide("vsL", "woba"))}%) · kPct ${covSide("vsL", "kPct")} · iso ${covSide("vsL", "iso")}`)
  console.log(`[handedness-splits] coverage vsR — woba ${covSide("vsR", "woba")} (${pct(covSide("vsR", "woba"))}%) · kPct ${covSide("vsR", "kPct")} · iso ${covSide("vsR", "iso")}`)
  console.log(`[handedness-splits] median sanity — vsL woba ${medSide("vsL", "woba")} / vsR woba ${medSide("vsR", "woba")} (expect ~.250-.400) · vsL kPct ${medSide("vsL", "kPct")} / vsR kPct ${medSide("vsR", "kPct")} (expect ~15-30)`)
  console.log("[handedness-splits] wrote", OUT, "— STAGING, zero live consumer by design (wire post-freeze)")
  console.log("[handedness-splits] SUCCESS BAR: vsL + vsR woba/kPct/iso ≥80% coverage AND sane medians. Any null mapping → tell CB the real column name.")
}

module.exports = { parseSplitRows, partitionBySplitCol, mergeSides, parseCsvLine, canonNameKey, nameKeyFromRow, sideFromSplitValue, SPLIT_COLS, SEASON }
if (require.main === module) main()
