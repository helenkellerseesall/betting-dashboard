#!/usr/bin/env node
"use strict"

/**
 * probeEspnInjuriesRaw — fetch one team's injury endpoint and print raw response.
 *
 * Tells us whether ESPN's endpoint actually has data we're missing, or is
 * genuinely empty. No parsing, no normalization — just the response body so
 * we can see the structure.
 *
 * Usage:
 *   node backend/scripts/probeEspnInjuriesRaw.js          # defaults to OKC (id=25)
 *   node backend/scripts/probeEspnInjuriesRaw.js 24       # SAS
 *   node backend/scripts/probeEspnInjuriesRaw.js 18       # NYK
 */

const axios = require("axios")

const teamId = String(process.argv[2] || "25")
const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/injuries`

async function main() {
  console.log("GET", url)
  try {
    const r = await axios.get(url, { timeout: 15000 })
    console.log("status:", r.status)
    console.log("top-level keys:", Object.keys(r.data || {}))
    console.log()
    console.log("--- raw response (truncated to 8KB) ---")
    const raw = JSON.stringify(r.data, null, 2)
    console.log(raw.slice(0, 8000))
    if (raw.length > 8000) console.log(`...[truncated ${raw.length - 8000} more bytes]`)
  } catch (e) {
    console.error("FAILED:", e?.response?.status, e?.message)
    if (e?.response?.data) console.error(JSON.stringify(e.response.data, null, 2))
    process.exit(1)
  }
}

main()
