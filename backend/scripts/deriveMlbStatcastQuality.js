#!/usr/bin/env node
"use strict"
/**
 * deriveMlbStatcastQuality.js — Baseball Savant SEASON-AGGREGATE quality-metrics STAGING ingest
 * (2026-06-18, CB; v2 — switched from statcast_search EVENT search to the LEADERBOARD CSVs).
 *
 * WHY v2: statcast_search returns raw batted-ball EVENTS (truncated, ~1-2 rows/player) → 0 coverage.
 * The LEADERBOARD CSVs return ONE ROW PER QUALIFIED PLAYER with real season aggregates:
 *   • /leaderboard/expected_statistics → xwOBA, xBA, xSLG (+ wOBA)   [base = qualified players]
 *   • /leaderboard/statcast (Exit Velocity & Barrels) → barrel% (brl_percent), hard-hit%
 *     (ev95percent), avg EV (avg_hit_speed), batted balls (attempts)   [v3: was exit_velocity_barrels
 *     which returned empty — CA-verified the correct slug is /leaderboard/statcast]
 * statcast joined onto the expected base by canonNameKey. Parsed by headers.indexOf with CANDIDATE-NAME lists (Savant column names
 * vary); ANTI-FABRICATION: a metric whose column is absent → null, NEVER invented. The script PRINTS
 * each real CSV header so the operator's live run confirms/reveals the true column names.
 *
 * Units (as Savant reports them — pure ingest, no transform): hardHitPct & barrelPct in PERCENT
 * (0–100); xwoba/xba/xslg/woba in decimal; avgExitVelocity in mph.
 *
 * Season from slateDate.js (ET slate-date year) — never hardcoded, never toISOString().slice.
 * STAGING ONLY: writes backend/data/mlbStatcastQuality.json with ZERO live consumer BY DESIGN
 * (wire post-freeze + forward-CLV-gated). Orphan (buildMlbStatcastPower.js) + live deriver
 * (deriveMlbStatcastPower.js) UNTOUCHED. New canonical staging owner (Law 1).
 *
 *   node backend/scripts/deriveMlbStatcastQuality.js > .scratch/last.txt 2>&1
 */
const axios = require("axios")
const fs = require("fs")
const path = require("path")
const normalizeName = require("../utils/normalizeName")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const SEASON = currentSlateDateEt().slice(0, 4)   // ET slate-date year (canonical; not toISOString)
const OUT = path.join(__dirname, "..", "data", "mlbStatcastQuality.json")
// expected_statistics min = qualified PA → the base set + full-season x-stats (CA-verified 254/254).
const MIN_EXPECTED = "q"
// statcast (exit-velo & barrels) leaderboard min = min BATTED BALLS; "1" includes everyone so every
// qualified batter joins. Full-season totals come from year= (same convention expected_statistics
// uses to return full-season PA). The attempts diagnostic below confirms it's full-season.
const MIN_STATCAST = "1"

// Savant leaderboard CSV endpoints (csv=true → one row per player). v3: barrels/exit-velo source is
// /leaderboard/statcast (CA-verified; the /exit_velocity_barrels slug returned empty).
const URL_EXPECTED = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${SEASON}&position=&team=&filterType=bip&min=${MIN_EXPECTED}&csv=true`
const URL_STATCAST = `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${SEASON}&position=&team=&min=${MIN_STATCAST}&csv=true`

// Candidate column names per metric (first present wins). Savant naming drifts → list known aliases.
const EXPECTED_COLS = {
  xba:   ["est_ba", "xba", "expected_ba"],
  xslg:  ["est_slg", "xslg", "expected_slg"],
  xwoba: ["est_woba", "xwoba", "expected_woba"],
  woba:  ["woba"],
  pa:    ["pa"],
}
const EV_COLS = {
  avgExitVelocity: ["avg_hit_speed", "avg_best_speed", "exit_velocity_avg"],
  hardHitPct:      ["ev95percent", "hard_hit_percent", "hardhit_percent", "hard_hit_pct"],
  barrelPct:       ["brl_percent", "barrel_batted_rate"],      // barrels per batted ball (the "barrel%")
  battedBalls:     ["attempts", "batted_balls", "bbe"],
}

const r3 = (x) => Math.round(x * 1000) / 1000

// Quote-aware CSV line split (Savant name fields can contain a comma).
function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c } else if (c === ",") { out.push(cur); cur = "" } else if (c === '"') { q = true } else cur += c
  }
  out.push(cur); return out
}

// "Last, First" → "First Last" → normalizeName, matching the HR engine's normalizeName(row.player).
function canonNameKey(raw) {
  let n = String(raw || "").trim()
  if (n.includes(",")) { const [last, first] = n.split(/,\s*/); if (first) n = `${first} ${last}` }
  return normalizeName(n)
}

// Resolve the player name from a row given the header, handling Savant's name-column variants.
function nameKeyFromRow(cols, H) {
  const iCombined = H.indexOf("last_name, first_name")
  if (iCombined >= 0) return canonNameKey(cols[iCombined])
  const iFirst = H.indexOf("first_name"), iLast = H.indexOf("last_name")
  if (iFirst >= 0 && iLast >= 0) return canonNameKey(`${cols[iLast]}, ${cols[iFirst]}`)
  const iPlayer = H.indexOf("player_name"); if (iPlayer >= 0) return canonNameKey(cols[iPlayer])
  const iName = H.indexOf("name"); if (iName >= 0) return canonNameKey(cols[iName])
  return ""
}

/**
 * Parse a leaderboard CSV into { byKey, header, resolved, players }.
 *   wantedCols: { outField: [candidate column names] }
 *   resolved: { outField: actualColumnName|null } — so the caller can see what mapped (anti-fab).
 * Exported for sample-based testing without network.
 */
function parseLeaderboardCsv(csv, wantedCols) {
  const lines = csv.split("\n").filter((l) => l.length)
  const H = parseCsvLine(lines[0]).map((h) => h.trim())
  const resolved = {}
  for (const [field, cands] of Object.entries(wantedCols)) {
    resolved[field] = cands.find((c) => H.indexOf(c) >= 0) || null
  }
  const byKey = {}
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r])
    const key = nameKeyFromRow(cols, H)
    if (!key) continue
    const rec = {}
    for (const [field, col] of Object.entries(resolved)) {
      if (!col) { rec[field] = null; continue }
      const v = parseFloat(cols[H.indexOf(col)])
      rec[field] = Number.isFinite(v) ? v : null
    }
    byKey[key] = rec
  }
  return { byKey, header: H, resolved, players: Object.keys(byKey).length }
}

async function fetchCsv(url) {
  try {
    const res = await axios.get(url, { timeout: 60000, maxContentLength: 5e8, maxBodyLength: 5e8, responseType: "text", validateStatus: () => true })
    return { ok: res.status === 200 && typeof res.data === "string" && res.data.length > 200, status: res.status, csv: res.data }
  } catch (e) { return { ok: false, status: null, err: e.code || e.message } }
}

async function main() {
  console.log("[statcast-quality] season (ET, from slateDate.currentSlateDateEt):", SEASON, "| min exp:", MIN_EXPECTED, "| min statcast:", MIN_STATCAST)
  console.log("[statcast-quality] EXPECTED url:", URL_EXPECTED)
  console.log("[statcast-quality] STATCAST url:", URL_STATCAST)

  const exp = await fetchCsv(URL_EXPECTED)
  const sc = await fetchCsv(URL_STATCAST)
  if (!exp.ok && !sc.ok) {
    console.error(`[statcast-quality] BOTH leaderboards failed (expected: ${exp.status || exp.err}, statcast: ${sc.status || sc.err}).`)
    console.error("[statcast-quality] If 403 'network allowlist', run on the operator machine (Savant blocked from sandbox).")
    process.exit(1)
  }
  const expP = exp.ok ? parseLeaderboardCsv(exp.csv, EXPECTED_COLS) : { byKey: {}, header: [], resolved: {}, players: 0 }
  const scP = sc.ok ? parseLeaderboardCsv(sc.csv, EV_COLS) : { byKey: {}, header: [], resolved: {}, players: 0 }

  console.log("\n[statcast-quality] EXPECTED header:", JSON.stringify(expP.header))
  console.log("[statcast-quality] EXPECTED column mapping (field→actual col):", JSON.stringify(expP.resolved))
  console.log("[statcast-quality] STATCAST header:", JSON.stringify(scP.header))
  console.log("[statcast-quality] STATCAST column mapping (field→actual col):", JSON.stringify(scP.resolved))

  // Base = expected_statistics (qualified) players; attach statcast (barrel/hardHit/avgEV) by
  // canonNameKey. Keying on the qualified base makes coverage = "of qualified players, how many got
  // each metric" — the success bar. (Statcast-only non-qualified players are not the target.)
  const keys = Object.keys(expP.byKey)
  const out = {}
  for (const k of keys) {
    const e = expP.byKey[k] || {}, v = scP.byKey[k] || {}
    out[k] = {
      barrelPct: v.barrelPct ?? null,            // percent (0–100), per batted ball  ← brl_percent
      hardHitPct: v.hardHitPct ?? null,          // percent (0–100)                   ← ev95percent
      avgExitVelocity: v.avgExitVelocity ?? null, // mph                               ← avg_hit_speed
      xwoba: e.xwoba ?? null,                     // decimal                           ← est_woba
      xba: e.xba ?? null,
      xslg: e.xslg ?? null,
      woba: e.woba ?? null,
      pa: e.pa ?? null,
      battedBalls: v.battedBalls ?? null,        //                                    ← attempts
      source: "baseball_savant_leaderboard(expected_statistics+statcast)",
      season: SEASON,
      derivedAt: new Date().toISOString(),
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))

  const names = Object.keys(out)
  const cov = (f) => names.filter((n) => out[n][f] != null).length
  const vals = (f) => names.map((n) => out[n][f]).filter((x) => x != null)
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return r3(s[Math.floor(s.length / 2)]) }
  console.log(`\n[statcast-quality] players (qualified base): ${names.length}  | expected rows: ${expP.players}  statcast rows: ${scP.players}`)
  const pct = (n) => names.length ? Math.round((n / names.length) * 100) : 0
  console.log(`[statcast-quality] coverage — barrelPct ${cov("barrelPct")}/${names.length} (${pct(cov("barrelPct"))}%) · hardHitPct ${cov("hardHitPct")}/${names.length} (${pct(cov("hardHitPct"))}%) · xwoba ${cov("xwoba")}/${names.length} (${pct(cov("xwoba"))}%) · xslg ${cov("xslg")}/${names.length} · xba ${cov("xba")}/${names.length} · avgEV ${cov("avgExitVelocity")}/${names.length}`)
  console.log(`[statcast-quality] median sanity — hardHitPct ${med(vals("hardHitPct"))} (expect ~30-55) · barrelPct ${med(vals("barrelPct"))} (expect ~3-20) · xwoba ${med(vals("xwoba"))} (expect ~.250-.450)`)
  // FULL-SEASON CHECK: attempts (batted balls) should be season-scale for qualified hitters, not a
  // recent-window sliver. Tiny max/median here = the statcast leaderboard returned a default window.
  const att = vals("battedBalls")
  console.log(`[statcast-quality] FULL-SEASON check — attempts(battedBalls): max ${att.length ? Math.max(...att) : "n/a"} · median ${med(att)} (mid-season qualified ≈ 120-300; tiny = window bug — fix year/date param before declaring success)`)
  for (const n of names.slice(0, 8)) console.log(`  ${n.padEnd(26)} bbe=${out[n].battedBalls} barrel%=${out[n].barrelPct} hardHit%=${out[n].hardHitPct} xwoba=${out[n].xwoba} avgEV=${out[n].avgExitVelocity}`)
  console.log("[statcast-quality] wrote", OUT, "— STAGING, zero live consumer by design (wire post-freeze)")
  console.log("[statcast-quality] SUCCESS BAR: barrelPct + hardHitPct + xwoba ≥80% coverage AND sane medians AND full-season attempts. If any column mapped to null above, tell CB the real header name to add as an alias.")
}

module.exports = { parseLeaderboardCsv, parseCsvLine, canonNameKey, nameKeyFromRow, SEASON, EXPECTED_COLS, EV_COLS }
if (require.main === module) main()
