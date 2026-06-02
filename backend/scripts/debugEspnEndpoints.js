#!/usr/bin/env node
"use strict"

/**
 * debugEspnEndpoints — one-shot dumper for ESPN endpoints we want to parse.
 *
 * Usage:
 *   node backend/scripts/debugEspnEndpoints.js
 *
 * Prints two payloads we need to write correct parsers against:
 *   1. /teams/{BOS}/statistics — the response we hit for team stats
 *   2. /summary?event={recent_game} — athlete-level stats array for box scores
 *
 * Output is structured for easy paste-back. Each section shows:
 *   - the URL hit
 *   - the response status
 *   - the relevant slice of the JSON (we trim to ~6000 chars per section)
 *   - the LABELS array (column names) when present — this is the key thing
 *     for parsing athlete stats correctly
 */

const axios = require("axios")
const { slateDateForTimestamp } = require("../pipeline/shared/slateDate")

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
const TIMEOUT_MS = 15000

async function fetchJson(url) {
  try {
    const r = await axios.get(url, { timeout: TIMEOUT_MS })
    return { ok: true, status: r.status, data: r.data }
  } catch (err) {
    return { ok: false, status: err?.response?.status || null, error: err?.message }
  }
}

function trim(obj, max = 6000) {
  const s = JSON.stringify(obj, null, 2)
  if (s.length <= max) return s
  return s.slice(0, max) + "\n... [truncated " + (s.length - max) + " more chars]"
}

async function main() {
  console.log("=".repeat(74))
  console.log("ESPN ENDPOINT DEBUG — paste this entire output back to me")
  console.log("=".repeat(74))

  // ── 1. Team list to find a valid team id ─────────────────────────────────
  const teamsUrl = `${ESPN_BASE}/teams`
  console.log("\n--- 1. TEAMS LIST ---")
  console.log("URL:", teamsUrl)
  const tr = await fetchJson(teamsUrl)
  if (!tr.ok) { console.log("ERROR status=" + tr.status + " " + tr.error); return }
  const teamsList = tr.data?.sports?.[0]?.leagues?.[0]?.teams || []
  const bos = teamsList.find((x) => x.team?.abbreviation === "BOS")
  console.log("Found", teamsList.length, "teams. BOS id =", bos?.team?.id)

  // ── 2. Team statistics (BOS) ─────────────────────────────────────────────
  if (bos?.team?.id) {
    const teamStatsUrl = `${ESPN_BASE}/teams/${bos.team.id}/statistics`
    console.log("\n--- 2. TEAM STATISTICS (BOS) ---")
    console.log("URL:", teamStatsUrl)
    const r = await fetchJson(teamStatsUrl)
    console.log("status:", r.status)
    if (r.ok) console.log("RAW (first ~6000 chars):\n" + trim(r.data))
    else console.log("ERROR:", r.error)
  }

  // ── 3. Recent scoreboard to find a valid game id ─────────────────────────
  // Try yesterday
  const d = new Date()
  d.setDate(d.getDate() - 1)
  // Phase Date-Doctrine-1B — ET slate date, packed YYYYMMDD for ESPN URL
  const dateStr = slateDateForTimestamp(d.getTime()).replace(/-/g, "")
  const scoreboardUrl = `${ESPN_BASE}/scoreboard?dates=${dateStr}`
  console.log("\n--- 3. SCOREBOARD (yesterday) ---")
  console.log("URL:", scoreboardUrl)
  const sr = await fetchJson(scoreboardUrl)
  console.log("status:", sr.status)
  const events = sr.data?.events || []
  console.log("events:", events.length)
  const gameId = events?.[0]?.id

  // ── 4. Game summary (with athlete stats array) ───────────────────────────
  if (gameId) {
    const summaryUrl = `${ESPN_BASE}/summary?event=${gameId}`
    console.log("\n--- 4. GAME SUMMARY (game " + gameId + ") ---")
    console.log("URL:", summaryUrl)
    const r = await fetchJson(summaryUrl)
    console.log("status:", r.status)
    if (r.ok) {
      // We specifically want the labels + athletes[0].stats structure
      const teamGroups = r.data?.boxscore?.players || []
      console.log("\nNumber of team groups:", teamGroups.length)
      if (teamGroups[0]) {
        const sg = teamGroups[0].statistics?.[0]
        if (sg) {
          console.log("\nFirst team's first stat group keys:")
          console.log("  labels:", JSON.stringify(sg.labels))
          console.log("  names: ", JSON.stringify(sg.names))
          console.log("  keys:  ", JSON.stringify(sg.keys))
          console.log("  descriptions:", JSON.stringify(sg.descriptions))
          const ath = sg.athletes?.[0]
          if (ath) {
            console.log("\nFirst athlete sample:")
            console.log("  name:", ath.athlete?.displayName)
            console.log("  stats:", JSON.stringify(ath.stats))
            console.log("  didNotPlay:", ath.didNotPlay)
            console.log("  starter:", ath.starter)
          }
        }
      }
    } else {
      console.log("ERROR:", r.error)
    }
  }
  console.log("\n" + "=".repeat(74))
  console.log("DONE — paste the entire output above back to me.")
  console.log("=".repeat(74))
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[debug] fatal:", err)
    process.exit(1)
  })
}
