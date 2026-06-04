#!/usr/bin/env node
"use strict"

/**
 * probeOddsApiSteals — direct Odds API call with ONLY steals/blocks/turnovers
 * markets to verify whether these are actually returned for tonight's NBA game.
 * No inference, no merging with other markets, no filters. Just the raw response.
 *
 * Operator opened DraftKings 2026-05-26 and confirmed steals + blocks are
 * visible on the bettor app. Our snapshot showed zero rows for these markets.
 * This probe is the deepdive to verify whether:
 *   (a) Odds API doesn't return them at all
 *   (b) Our combined-markets request truncates them silently
 *   (c) Books offer them but our 8-book allowlist excludes the offering book
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") })
const axios = require("axios")
const fs = require("fs")
const path = require("path")

const apiKey = String(process.env.ODDS_API_KEY || "").trim()
if (!apiKey) { console.error("ODDS_API_KEY missing"); process.exit(2) }

async function main() {
  // Step 1 — find the event ID (tonight's NBA game).
  console.log("--- Step 1: fetch events ---")
  const eventsRes = await axios.get(
    "https://api.the-odds-api.com/v4/sports/basketball_nba/events",
    { params: { apiKey }, timeout: 15000 }
  )
  const events = Array.isArray(eventsRes.data) ? eventsRes.data : []
  console.log(`events: ${events.length}`)
  if (!events.length) { console.error("no events"); process.exit(1) }
  const event = events[0]
  console.log(`using: ${event.away_team} @ ${event.home_team} (${event.id})`)

  // Step 2 — focused request: ONLY steals/blocks/turnovers, ALL books
  console.log("\n--- Step 2: focused request (S/B/T only, all books) ---")
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds`
  const params = {
    apiKey,
    regions: "us",
    bookmakers: "draftkings,fanduel,fanatics,caesars,betmgm,betrivers,hardrockbet,bet365",
    markets: "player_steals,player_blocks,player_turnovers",
    oddsFormat: "american",
  }
  console.log(`URL: ${url}`)
  console.log(`params.markets: ${params.markets}`)

  try {
    const r = await axios.get(url, { params, timeout: 20000 })
    console.log(`HTTP ${r.status}`)
    console.log(`response.bookmakers count: ${(r.data?.bookmakers || []).length}`)
    const summary = {}
    for (const bk of (r.data?.bookmakers || [])) {
      summary[bk.key] = (bk.markets || []).map(m => `${m.key}(${(m.outcomes||[]).length} outcomes)`).join(", ") || "EMPTY"
    }
    console.log("per book:")
    for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`)

    // Sample one outcome if any
    let sampleShown = false
    for (const bk of (r.data?.bookmakers || [])) {
      for (const m of (bk.markets || [])) {
        if (m.outcomes && m.outcomes.length && !sampleShown) {
          console.log(`\nsample outcome (${bk.key} / ${m.key}):`)
          console.log(JSON.stringify(m.outcomes[0], null, 2))
          sampleShown = true
        }
      }
    }
    if (!sampleShown) console.log("\nNO outcomes returned in any market for any book")
  } catch (e) {
    console.error("FAILED:", e?.response?.status, e?.message)
    if (e?.response?.data) console.error(JSON.stringify(e.response.data, null, 2))
  }

  // Step 3 — DraftKings only (operator saw it live there)
  console.log("\n--- Step 3: DK only (operator confirmed visible on DK) ---")
  try {
    const r = await axios.get(url, {
      params: { ...params, bookmakers: "draftkings" },
      timeout: 20000,
    })
    console.log(`HTTP ${r.status}`)
    const dk = (r.data?.bookmakers || []).find(b => b.key === "draftkings")
    if (!dk) console.log("DK not in response")
    else {
      console.log(`DK markets: ${dk.markets?.length || 0}`)
      for (const m of (dk.markets || [])) {
        console.log(`  ${m.key}: ${(m.outcomes || []).length} outcomes`)
        if (m.outcomes && m.outcomes.length) {
          console.log(`    first 2: ${JSON.stringify(m.outcomes.slice(0,2))}`)
        }
      }
    }
  } catch (e) {
    console.error("FAILED:", e?.response?.status, e?.message)
  }
}

main().catch(e => { console.error("fatal:", e?.message); process.exit(1) })
