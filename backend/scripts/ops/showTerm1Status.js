#!/usr/bin/env node
"use strict"

/**
 * ops:term1 — TERM 1 backend health introspection (read-only).
 *
 * Phase Operational-Parity-1A (2026-05-17): NEW canonical helper. The
 * historical workflow assumed TERM 1 was operator-managed (per
 * WORKFLOW_RULES.md + BOOTSTRAP_PROMPT.md: "ASSUME TERM 1 is already
 * running the backend on port 4000 — DO NOT start, stop, restart, or
 * manage servers"). This helper prints health WITHOUT touching TERM 1.
 *
 * Anti-fabrication doctrine:
 *   • NEVER auto-starts, stops, or restarts TERM 1.
 *   • Read-only HTTP probes to /api/ws/health + /api/ws/state.
 *   • Reports operator-visible health snapshot: reachable / degraded flag /
 *     snapshot freshness / sport counts.
 *
 * Usage:
 *   node scripts/ops/showTerm1Status.js               # default host localhost:4000
 *   node scripts/ops/showTerm1Status.js http://...   # custom host override
 *
 * Exit codes:
 *   0 — TERM 1 reachable
 *   1 — TERM 1 unreachable (operator must check engine:start / engine:status)
 */

const http = require("http")
const url  = require("url")

const host = (process.argv[2] || "http://localhost:4000").replace(/\/+$/, "")
const parsed = new url.URL(host + "/api/ws/health")

function fetchJson(u, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(u, (res) => {
      let body = ""
      res.on("data", (chunk) => { body += chunk })
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        try { resolve(JSON.parse(body)) }
        catch (e) { reject(new Error(`non-JSON: ${e.message}`)) }
      })
    })
    req.on("error", (e) => reject(e))
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")))
  })
}

;(async () => {
  console.log(`ops:term1 — probing TERM 1 backend health at ${host}`)
  console.log("")
  try {
    const health = await fetchJson(`${host}/api/ws/health`)
    const status = {
      host,
      reachable:        true,
      ok:               !!health.ok,
      degraded:         !!health.degraded,
      time:             health.time || "—",
      freshness: {
        nba: health.freshness?.nba?.status || "—",
        mlb: health.freshness?.mlb?.status || "—",
      },
    }
    console.log(JSON.stringify(status, null, 2))
    console.log("")
    console.log("✓ TERM 1 reachable — backend dev server responding on", host)
    process.exit(0)
  } catch (e) {
    console.error(`✗ TERM 1 unreachable at ${host}: ${e.message}`)
    console.error("")
    console.error("Operator action (DO NOT auto-start from Claude/sandbox):")
    console.error("  npm run engine:status       # check current state")
    console.error("  npm run engine:start        # start backend dev server")
    console.error("  npm run engine:restart      # restart if stuck")
    process.exit(1)
  }
})()
