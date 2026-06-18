#!/usr/bin/env node
"use strict"
/**
 * deriveMlbBullpenQuality.js — NEW relief (bullpen) QUALITY staging ingest (2026-06-18, CB; #29).
 *
 * Pulls the FanGraphs RELIEF leaderboard JSON (stats=rel, type=8) for the CURRENT ET season and
 * builds an IP-WEIGHTED TEAM-BULLPEN aggregate (FIP/xFIP/SIERA/WHIP/ERA/K%/BB%/HR9/LOB%/leverage per
 * ~30 teams) — the natural complement to the existing TEAM-level bullpen FATIGUE context
 * (deriveMlbBullpenContext keys by opponentTeam). Keeps per-reliever rows too.
 *
 * The live bullpen path (deriveMlbBullpenContext.js fatigue/bullpenShift + refreshMlbBullpenWorkload)
 * is SCORING-CONSUMED via buildSlipAi/buildFeaturedPlays (PRESERVED) and is left UNTOUCHED. This
 * writes a NEW staging file backend/data/mlbBullpenQuality.json with ZERO live consumer — wiring is a
 * separate post-freeze + forward-CLV-gated task. New canonical staging owner (Law 1).
 *
 * SOURCE (CA-verified, JSON): FanGraphs leaders, stats=rel, type=8, qual=0, pageitems=2000.
 * Keys parsed (candidate lists; anti-fab: absent→null, never invented): FIP/xFIP/SIERA/WHIP/ERA/
 * "K%"/"BB%"/"HR/9"/"LOB%"/IP/"Relief-IP"/gmLI(or pLI)/TeamNameAbb/PlayerName/playerid(from Name HTML).
 * Team aggregate = IP-weighted mean of each rate over the team's relievers (relievers missing a rate
 * are excluded from THAT rate's weight — never zero-filled). Season from slateDate.js (ET year).
 *
 *   node backend/scripts/deriveMlbBullpenQuality.js 2>&1 | tee .scratch/bullpen_verify.txt
 *   (FanGraphs allowlist-blocked from sandbox → run on the operator machine.)
 */
const axios = require("axios")
const fs = require("fs")
const path = require("path")
const normalizeName = require("../utils/normalizeName")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const SEASON = currentSlateDateEt().slice(0, 4)
const OUT = path.join(__dirname, "..", "data", "mlbBullpenQuality.json")
const URL = "https://www.fangraphs.com/api/leaders/major-league/data"
const PARAMS = { pos: "all", stats: "rel", lg: "all", qual: 0, season: SEASON, season1: SEASON, month: 0, team: 0, pageitems: 2000, pagenum: 1, ind: 0, type: 8 }

// field → candidate FanGraphs keys
const COLS = {
  fip: ["FIP"], xfip: ["xFIP"], siera: ["SIERA"], whip: ["WHIP"], era: ["ERA"],
  kPct: ["K%"], bbPct: ["BB%"], hr9: ["HR/9"], lobPct: ["LOB%"],
  ip: ["IP", "Relief-IP"], leverage: ["gmLI", "pLI"],
}
const numOrNull = (x) => (Number.isFinite(Number(x)) ? Number(x) : null)
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000)
const key = (n) => normalizeName(String(n || ""))
function playerIdFromNameHtml(html) { const m = String(html || "").match(/playerid=(\d+)/); return m ? m[1] : null }
function resolveCol(row, cands) { for (const c of cands) if (row && Object.prototype.hasOwnProperty.call(row, c)) return c; return null }

// IP-weighted mean of `field` over relievers (those with finite field AND finite ip). null if none.
function ipWeighted(relievers, field) {
  let ws = 0, w = 0
  for (const r of relievers) { const v = r[field], ip = r.ip; if (v != null && ip != null && ip > 0) { ws += v * ip; w += ip } }
  return w > 0 ? ws / w : null
}

/**
 * Parse the FanGraphs relief `.data` array → { byTeam, byReliever, resolved }.
 * Exported for sample-based testing without network.
 */
function parseBullpen(dataArr) {
  const rows = Array.isArray(dataArr) ? dataArr : []
  const resolved = {}
  if (rows[0]) for (const [field, cands] of Object.entries(COLS)) resolved[field] = resolveCol(rows[0], cands)
  const get = (row, field) => (resolved[field] ? numOrNull(row[resolved[field]]) : null)
  const teamColRow0 = rows[0] ? (["TeamNameAbb", "Team", "teamid"].find((c) => Object.prototype.hasOwnProperty.call(rows[0], c)) || null) : null

  const byReliever = {}
  const teamGroups = {}
  for (const row of rows) {
    const pname = row?.PlayerName ?? null
    const k = key(pname)
    if (!k) continue
    const teamAbb = teamColRow0 ? String(row[teamColRow0] ?? "").toUpperCase() : null
    const rec = {
      playerName: pname, playerId: playerIdFromNameHtml(row?.Name), teamAbb,
      ip: get(row, "ip"),
      fip: get(row, "fip"), xfip: get(row, "xfip"), siera: get(row, "siera"), whip: get(row, "whip"), era: get(row, "era"),
      kPct: get(row, "kPct"), bbPct: get(row, "bbPct"), hr9: get(row, "hr9"), lobPct: get(row, "lobPct"),
      leverage: get(row, "leverage"),
    }
    byReliever[k] = rec
    if (teamAbb) (teamGroups[teamAbb] = teamGroups[teamAbb] || []).push(rec)
  }

  const byTeam = {}
  for (const [team, relievers] of Object.entries(teamGroups)) {
    byTeam[team] = {
      teamBullpenFip: r4(ipWeighted(relievers, "fip")),
      teamBullpenXfip: r4(ipWeighted(relievers, "xfip")),
      teamBullpenSiera: r4(ipWeighted(relievers, "siera")),
      teamBullpenWhip: r4(ipWeighted(relievers, "whip")),
      teamBullpenEra: r4(ipWeighted(relievers, "era")),
      teamBullpenKPct: r4(ipWeighted(relievers, "kPct")),
      teamBullpenBbPct: r4(ipWeighted(relievers, "bbPct")),
      teamBullpenHr9: r4(ipWeighted(relievers, "hr9")),
      teamBullpenLobPct: r4(ipWeighted(relievers, "lobPct")),
      teamBullpenLeverage: r4(ipWeighted(relievers, "leverage")),
      totalReliefIp: r4(relievers.reduce((s, r) => s + (r.ip || 0), 0)),
      nRelievers: relievers.length,
    }
  }
  return { byTeam, byReliever, resolved, teamCol: teamColRow0 }
}

async function main() {
  console.log("[bullpen-quality] season (ET, from slateDate):", SEASON, "| stats=rel type=8 qual=0 pageitems=2000")
  let data
  try {
    const res = await axios.get(URL, { params: PARAMS, timeout: 30000, validateStatus: () => true, headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36", "Accept": "application/json" } })
    if (res.status !== 200) { console.error(`[bullpen-quality] HTTP ${res.status} — FanGraphs blocked/failed from this host. Run on the operator machine (allowlist).`); process.exit(1) }
    data = res.data?.data ?? res.data
  } catch (e) { console.error("[bullpen-quality] FETCH FAILED:", e.code || e.message, "— run on operator machine."); process.exit(1) }

  const { byTeam, byReliever, resolved, teamCol } = parseBullpen(data)
  const teams = Object.keys(byTeam)
  if (teams.length === 0) { console.error("[bullpen-quality] 0 teams aggregated — aborting (no write)"); process.exit(1) }
  const payload = { season: SEASON, derivedAt: new Date().toISOString(), source: "fangraphs_leaders_stats=rel_type8", teamColUsed: teamCol, byTeam, byReliever }
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2))

  const cov = (f) => teams.filter((t) => byTeam[t][f] != null).length
  const med = (f) => { const a = teams.map((t) => byTeam[t][f]).filter((x) => x != null).sort((x, y) => x - y); return a.length ? r4(a[Math.floor(a.length / 2)]) : null }
  console.log("[bullpen-quality] key mapping (field→FanGraphs key):", JSON.stringify(resolved), "| team col:", teamCol)
  console.log(`\n[bullpen-quality] relievers: ${Object.keys(byReliever).length} | teams: ${teams.length}`)
  console.log(`[bullpen-quality] team coverage — FIP ${cov("teamBullpenFip")}/${teams.length} · xFIP ${cov("teamBullpenXfip")} · WHIP ${cov("teamBullpenWhip")} · SIERA ${cov("teamBullpenSiera")}`)
  console.log(`[bullpen-quality] median sanity — team FIP ${med("teamBullpenFip")} (expect ~3.0-5.0) · WHIP ${med("teamBullpenWhip")} (expect ~1.1-1.5) · xFIP ${med("teamBullpenXfip")}`)
  for (const t of teams.sort((a, b) => (byTeam[a].teamBullpenFip ?? 99) - (byTeam[b].teamBullpenFip ?? 99)).slice(0, 6)) {
    const v = byTeam[t]; console.log(`  ${t.padEnd(5)} FIP=${v.teamBullpenFip} xFIP=${v.teamBullpenXfip} WHIP=${v.teamBullpenWhip} SIERA=${v.teamBullpenSiera} reliefIP=${v.totalReliefIp} n=${v.nRelievers}`)
  }
  console.log("[bullpen-quality] wrote", OUT, "— STAGING, zero live consumer by design (wire post-freeze)")
  console.log("[bullpen-quality] SUCCESS BAR: team FIP/xFIP/WHIP for ~30 teams, sane (FIP ~3.0-5.0, WHIP ~1.1-1.5). Any null mapping → tell CB the real key.")
}

module.exports = { parseBullpen, ipWeighted, playerIdFromNameHtml, SEASON, COLS }
if (require.main === module) main()
