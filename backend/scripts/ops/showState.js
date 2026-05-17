#!/usr/bin/env node
"use strict"

/**
 * ops:state — canonical live-state inspector
 *
 * Single-command replacement for the legacy inline curl chain documented
 * across BOOTSTRAP_PROMPT / OPERATIONAL_FLOW / GPT_RECONSTRUCTION_BOOTSTRAP:
 *
 *   curl -s "http://localhost:4000/api/ws/state?sport=mlb" | jq '{
 *     candidates: (.candidates | length),
 *     discoveryCandidates: (.discoveryCandidates | length),
 *     aiSlips: { ... }
 *   }'
 *
 * Replaced with one canonical Node-only invocation that prints a compact
 * summary of the live /api/ws/state response (requires TERM 1 backend).
 *
 * Usage:
 *   node scripts/ops/showState.js [sport] [host]
 *
 *   sport: "mlb" | "nba"  (default "mlb")
 *   host:  override base url (default "http://localhost:4000")
 *
 * Exit codes:
 *   0 — backend responded; summary printed
 *   1 — backend unreachable / non-JSON response / route error
 *
 * Shipped Continuity-OS-1C (2026-05-17) — operator-cemented canonical ops layer.
 */

const http = require("http")
const https = require("https")
const url  = require("url")

const sport = (process.argv[2] || "mlb").toLowerCase()
const host  = (process.argv[3] || "http://localhost:4000").replace(/\/+$/, "")

if (!/^(mlb|nba)$/.test(sport)) {
  console.error(`ops:state — invalid sport "${sport}" (use mlb or nba)`)
  process.exit(1)
}

const endpoint = `${host}/api/ws/state?sport=${sport}`
const parsed   = new url.URL(endpoint)
const lib      = parsed.protocol === "https:" ? https : http

function fetchJson(u) {
  return new Promise((resolve, reject) => {
    const req = lib.get(u, (res) => {
      let body = ""
      res.on("data", (chunk) => { body += chunk })
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${u}`))
        }
        try { resolve(JSON.parse(body)) }
        catch (e) { reject(new Error(`Non-JSON response from ${u}: ${e.message}`)) }
      })
    })
    req.on("error", (e) => reject(e))
    req.setTimeout(5000, () => req.destroy(new Error("timeout (5s)")))
  })
}

;(async () => {
  console.log(`ops:state — querying ${endpoint}`)
  console.log("")
  try {
    const s = await fetchJson(endpoint)
    const ai = s.aiSlips || {}
    const slipCount = (tier) => (Array.isArray(ai[tier]) ? ai[tier].length : 0)
    const featured = s.featured || {}
    const summary = {
      sport:                s.sport,
      date:                 s.date,
      degraded:             !!s.degraded,
      snapshotStatus:       s.snapshotFreshness?.status ?? "—",
      candidates:           Array.isArray(s.candidates) ? s.candidates.length : 0,
      discoveryCandidates:  Array.isArray(s.discoveryCandidates) ? s.discoveryCandidates.length : 0,
      aiSlips: {
        safe:       slipCount("safe"),
        balanced:   slipCount("balanced"),
        aggressive: slipCount("aggressive"),
        lotto:      slipCount("lotto"),
      },
      featuredCounts: {
        anchors:           Array.isArray(featured.anchors) ? featured.anchors.length : 0,
        tonightsBest:      Array.isArray(featured.tonightsBest) ? featured.tonightsBest.length : 0,
        bestBalanced:      Array.isArray(featured.bestBalanced) ? featured.bestBalanced.length : 0,
        believableUpside:  Array.isArray(featured.believableUpsideTickets) ? featured.believableUpsideTickets.length : 0,
        explosiveUpside:   Array.isArray(featured.explosiveUpsideTickets) ? featured.explosiveUpsideTickets.length : 0,
      },
      counts: s.counts || {},
      bettorRealismScore: s.aiSlipsSummary?.bettorRealismScore?.score ?? null,
    }
    console.log(JSON.stringify(summary, null, 2))
    process.exit(0)
  } catch (e) {
    console.error(`ops:state — request failed: ${e.message}`)
    console.error(`(is TERM 1 backend running on ${host}?)`)
    process.exit(1)
  }
})()
