#!/usr/bin/env node
"use strict"
/**
 * deriveMlbPitcherFip.js — NEW pitcher fielding-independent metrics STAGING ingest (2026-06-18, CB;
 * ingestion #30). Pulls the FanGraphs pitching leaderboard JSON (type=8) for the CURRENT ET season
 * and stages FIP / xFIP / SIERA / xERA / LOB% / HR/9 (+ kwERA) per pitcher.
 *
 * These metrics do NOT exist anywhere in the repo (verified). The LIVE pitcher-stats path
 * (refreshMlbPitcherStats.js → mlbPitcherStats.json: kRate/bbRate/whip/era/k9) is SCORING-CONSUMED
 * (ks/hits/HR engines) and is left UNTOUCHED. This writes a NEW staging file
 * backend/data/mlbPitcherFip.json with ZERO live consumer — wiring into scoring is a separate
 * post-freeze + forward-CLV-gated task. New canonical staging owner (Law 1).
 *
 * SOURCE (CA-verified, JSON): FanGraphs leaders API, stats=pit, type=8, qual=0, pageitems=2000.
 * Response `.data` = array of pitcher objects. EXACT keys parsed (CA-confirmed vs real 2026 rows):
 *   "FIP" "xFIP" "SIERA" "xERA" "LOB%" (decimal, .841=84.1%) "HR/9" "kwERA" "PlayerName".
 * "Name" is HTML containing the FanGraphs playerid (href "...playerid=NNNN...") → parsed for join.
 * Join by canonNameKey(PlayerName) (+ playerId). ANTI-FAB: key absent/null → null, never invented.
 * Season from slateDate.js (ET year) — never hardcoded.
 *
 *   node backend/scripts/deriveMlbPitcherFip.js 2>&1 | tee .scratch/fip_verify.txt
 *   (FanGraphs is allowlist-blocked from the sandbox → run on the operator machine.)
 */
const axios = require("axios")
const fs = require("fs")
const path = require("path")
const normalizeName = require("../utils/normalizeName")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const SEASON = currentSlateDateEt().slice(0, 4)
const OUT = path.join(__dirname, "..", "data", "mlbPitcherFip.json")
const URL = "https://www.fangraphs.com/api/leaders/major-league/data"
const PARAMS = { pos: "all", stats: "pit", lg: "all", qual: 0, season: SEASON, season1: SEASON, month: 0, team: 0, pageitems: 2000, pagenum: 1, ind: 0, type: 8 }

const numOrNull = (x) => (Number.isFinite(Number(x)) ? Number(x) : null)
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000)
function canonNameKey(raw) {
  let n = String(raw || "").trim()
  if (n.includes(",")) { const [last, first] = n.split(/,\s*/); if (first) n = `${first} ${last}` }
  return normalizeName(n)
}
function playerIdFromNameHtml(html) {
  const m = String(html || "").match(/playerid=(\d+)/)
  return m ? m[1] : null
}

/**
 * Parse the FanGraphs `.data` array → { byKey, players, resolved }.
 * resolved = which of the wanted keys were actually present on row 0 (anti-fab visibility).
 * Exported so the parser is provable on a sample without network.
 */
function parseFipData(dataArr) {
  const rows = Array.isArray(dataArr) ? dataArr : []
  const KEYMAP = { fip: "FIP", xfip: "xFIP", siera: "SIERA", xera: "xERA", lobPct: "LOB%", hr9: "HR/9", kwera: "kwERA" }
  const resolved = {}
  if (rows[0]) for (const [field, key] of Object.entries(KEYMAP)) resolved[field] = Object.prototype.hasOwnProperty.call(rows[0], key) ? key : null
  const byKey = {}
  for (const row of rows) {
    const playerName = row?.PlayerName ?? null
    const key = canonNameKey(playerName)
    if (!key) continue
    byKey[key] = {
      playerName,
      playerId: playerIdFromNameHtml(row?.Name),
      fip: numOrNull(row?.["FIP"]),
      xfip: numOrNull(row?.["xFIP"]),
      siera: numOrNull(row?.["SIERA"]),
      xera: numOrNull(row?.["xERA"]),
      lobPct: numOrNull(row?.["LOB%"]),   // decimal (.841 = 84.1%)
      hr9: numOrNull(row?.["HR/9"]),
      kwera: numOrNull(row?.["kwERA"]),
    }
  }
  return { byKey, players: Object.keys(byKey).length, resolved }
}

async function main() {
  console.log("[pitcher-fip] season (ET, from slateDate):", SEASON)
  console.log("[pitcher-fip] URL:", URL, "| params type=8 qual=0 pageitems=2000")
  let data
  try {
    const res = await axios.get(URL, { params: PARAMS, timeout: 30000, validateStatus: () => true, headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36", "Accept": "application/json" } })
    if (res.status !== 200) { console.error(`[pitcher-fip] HTTP ${res.status} — FanGraphs blocked/failed from this host. Run on the operator machine (allowlist).`); process.exit(1) }
    data = res.data?.data ?? res.data
  } catch (e) { console.error("[pitcher-fip] FETCH FAILED:", e.code || e.message, "— run on the operator machine."); process.exit(1) }

  const { byKey, players, resolved } = parseFipData(data)
  if (players === 0) { console.error("[pitcher-fip] parsed 0 pitchers — aborting (no write)"); process.exit(1) }
  const out = {}
  for (const [k, v] of Object.entries(byKey)) out[k] = { ...v, source: "fangraphs_leaders_type8", season: SEASON, derivedAt: new Date().toISOString() }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))

  const names = Object.keys(out)
  const cov = (f) => names.filter((n) => out[n][f] != null).length
  const pct = (n) => names.length ? Math.round((n / names.length) * 100) : 0
  const med = (f) => { const a = names.map((n) => out[n][f]).filter((x) => x != null).sort((x, y) => x - y); return a.length ? r4(a[Math.floor(a.length / 2)]) : null }
  console.log("[pitcher-fip] key mapping (field→FanGraphs key):", JSON.stringify(resolved))
  console.log(`\n[pitcher-fip] pitchers: ${players}`)
  console.log(`[pitcher-fip] coverage — FIP ${cov("fip")} (${pct(cov("fip"))}%) · xFIP ${cov("xfip")} (${pct(cov("xfip"))}%) · SIERA ${cov("siera")} (${pct(cov("siera"))}%) · xERA ${cov("xera")} (${pct(cov("xera"))}%) · LOB% ${cov("lobPct")} (${pct(cov("lobPct"))}%) · HR/9 ${cov("hr9")} (${pct(cov("hr9"))}%)`)
  console.log(`[pitcher-fip] median sanity — FIP ${med("fip")} / xFIP ${med("xfip")} / SIERA ${med("siera")} (expect ~3.5-4.5) · LOB% ${med("lobPct")} (expect ~.70-.75) · HR/9 ${med("hr9")} (expect ~1.0-1.5)`)
  for (const n of names.slice(0, 6)) console.log(`  ${n.padEnd(24)} id=${out[n].playerId} FIP=${out[n].fip} xFIP=${out[n].xfip} SIERA=${out[n].siera} LOB%=${out[n].lobPct} HR/9=${out[n].hr9}`)
  console.log("[pitcher-fip] wrote", OUT, "— STAGING, zero live consumer by design (wire post-freeze)")
  console.log("[pitcher-fip] SUCCESS BAR: FIP/xFIP/SIERA/xERA/LOB%/HR9 ≥80% coverage AND sane medians. Any null mapping → tell CB the real key.")
}

module.exports = { parseFipData, canonNameKey, playerIdFromNameHtml, SEASON }
if (require.main === module) main()
