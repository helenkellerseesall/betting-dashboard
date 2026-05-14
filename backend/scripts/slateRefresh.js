#!/usr/bin/env node
"use strict"

/**
 * slateRefresh.js — Phase Operator-Operations-1 (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/slateRefresh.js
 *     npm run slate:refresh
 *     npm run slate:refresh -- --sport=nba
 *     npm run slate:refresh -- --sport=mlb
 *
 * Canonical operator entrypoint to trigger a snapshot refresh. Thin HTTP
 * wrapper over GET /refresh-snapshot (the generic refresh endpoint the
 * server already exposes).
 *
 * Observability-first: prints the URL it's hitting BEFORE the request,
 * shows the HTTP status code, dumps the response JSON.
 *
 * For sport-specific commands prefer:
 *   npm run slate:nba   → POST /api/nba/refresh-snapshot/hard-reset
 *   npm run slate:mlb   → GET  /mlb/refresh
 *
 * This script is for the generic /refresh-snapshot path.
 */

const http = require("http")
const { URL } = require("url")

function parseArgs() {
  const out = { sport: null }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--sport=")) out.sport = a.slice("--sport=".length)
  }
  return out
}

function request(method, pathname, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const opts = { host: "localhost", port: 4000, path: pathname, method, timeout: timeoutMs }
    const req = http.request(opts, (res) => {
      let body = ""
      res.on("data", (c) => (body += c))
      res.on("end", () => resolve({ status: res.statusCode, body }))
    })
    req.on("error", (e) => reject(e))
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("timeout"))
    })
    req.end()
  })
}

async function main() {
  const t0 = Date.now()
  const args = parseArgs()

  let pathname = "/refresh-snapshot"
  if (args.sport) {
    pathname += `?sport=${encodeURIComponent(args.sport)}`
  }

  const url = `http://localhost:4000${pathname}`
  console.log("=== slate:refresh — Phase Operator-Operations-1 ===")
  console.log(`HTTP GET ${url}`)
  console.log("")

  let res
  try {
    res = await request("GET", pathname)
  } catch (e) {
    console.error(`ERROR: ${e.message || e}`)
    console.error("Backend likely not running. Run: npm run engine:status")
    process.exit(1)
  }

  console.log(`HTTP ${res.status}`)
  try {
    const j = JSON.parse(res.body)
    console.log(JSON.stringify(j, null, 2))
  } catch (_) {
    console.log(res.body.slice(0, 1200))
  }

  const elapsedMs = Date.now() - t0
  console.log("")
  console.log(`slate:refresh completed in ${elapsedMs}ms (HTTP ${res.status})`)
  if (res.status >= 200 && res.status < 300) process.exit(0)
  process.exit(1)
}

main().catch((e) => {
  console.error("slate:refresh fatal:", e?.message || e)
  process.exit(1)
})
