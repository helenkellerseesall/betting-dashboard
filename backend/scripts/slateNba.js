#!/usr/bin/env node
"use strict"

/**
 * slateNba.js — Phase Operator-Operations-1 (2026-05-14)
 *                Operator-Operations-1A route fix (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/slateNba.js
 *     npm run slate:nba
 *
 * Canonical operator entrypoint to trigger NBA slate refresh + summary.
 *
 * Sequence:
 *   1. GET /refresh-snapshot/hard-reset                   (canonical NBA hard-reset; server.js:19471)
 *   2. GET /api/best-available?sport=basketball_nba       (diagnostics + epochAuthority)
 *   3. GET /api/ws/state?sport=nba                        (board hydration)
 *
 * Each request is logged BEFORE issuing so the operator sees what's about
 * to happen. Response summaries print bestProps count, epochAuthority
 * counters, ledger divergence state. Replaces the inline curl ceremony
 * from NEXT_SESSION.md.
 *
 * ROUTE AUTHORITY NOTE (Phase Operator-Operations-1A, 2026-05-14):
 *   The original implementation used POST /api/nba/refresh-snapshot/hard-reset,
 *   which returned 404 (no such route registered). Verified by repo-wide grep:
 *   the canonical hard-reset endpoint is server.js:19471 — `GET /refresh-snapshot/hard-reset`.
 *   Internally that handler delegates to `handleNbaRefreshSnapshotAfterMlbBranch`
 *   (the same handler the working /refresh-snapshot route uses), with the added
 *   benefit of clearing in-memory caches + the optional api-sports-cache.json.
 *   The fix preserves hard-reset semantics + mutex behavior + replay safety.
 */

const http = require("http")

function request(method, pathname, timeoutMs = 90_000) {
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

function safeJson(body) {
  try { return JSON.parse(body) } catch (_) { return null }
}

async function step(label, method, pathname) {
  console.log(`\n── ${label} ──`)
  console.log(`HTTP ${method} http://localhost:4000${pathname}`)
  const t0 = Date.now()
  let res
  try {
    res = await request(method, pathname)
  } catch (e) {
    console.error(`  ERROR: ${e.message || e}`)
    console.error(`  Backend likely not running. Run: npm run engine:status`)
    process.exit(1)
  }
  const ms = Date.now() - t0
  console.log(`HTTP ${res.status}  (${ms}ms)`)
  return { res, ms }
}

async function main() {
  const t0 = Date.now()
  console.log("=== slate:nba — Phase Operator-Operations-1 ===")

  // 1. Hard refresh — canonical NBA hard-reset endpoint (server.js:19471).
  //    Per Phase Operator-Operations-1A: GET /refresh-snapshot/hard-reset is
  //    the canonical route; there is no /api/nba/refresh-snapshot/hard-reset.
  const r1 = await step("Step 1: NBA hard-reset refresh", "GET", "/refresh-snapshot/hard-reset")
  const j1 = safeJson(r1.res.body)
  if (j1) {
    const summary = {
      ok:       j1.ok,
      sport:    j1.sport,
      replay:   j1.replay,
      updatedAt: j1.updatedAt,
      events:   j1.events,
      props:    j1.props,
      rawProps: j1.rawProps,
    }
    console.log(`  ${JSON.stringify(summary)}`)
  } else if (r1.res.body) {
    console.log(`  ${r1.res.body.slice(0, 400)}`)
  }

  // 2. Best-available diagnostics
  const r2 = await step("Step 2: best-available diagnostics", "GET", "/api/best-available?sport=basketball_nba")
  const j2 = safeJson(r2.res.body)
  if (j2) {
    const nbaCache = j2.nbaCacheDiagnostics || {}
    const epoch    = nbaCache.epochAuthority || {}
    const apiResp  = nbaCache.apiSportsResponseDiagnostics || {}
    console.log("  bestProps count            :", Array.isArray(j2.bestProps) ? j2.bestProps.length : "n/a")
    console.log("  ── cache lifecycle ──")
    console.log("    cacheWriteSuccessesPlayerId :", nbaCache.cacheWriteSuccessesPlayerId)
    console.log("    memoryPlayerIdCount         :", nbaCache.memoryPlayerIdCount)
    console.log("    diskPlayerIdCount           :", nbaCache.diskPlayerIdCount)
    console.log("    teamRosterCacheSize         :", nbaCache.teamRosterCacheSize)
    console.log("  ── F6.3 match strategy ──")
    console.log("    lastPlayerIdMatchStrategy   :", apiResp.lastPlayerIdMatchStrategy)
    console.log("    lastPlayerIdResolvedTeamAbbr:", apiResp.lastPlayerIdResolvedTeamAbbr)
    console.log("    lastPlayerIdResolvedApiTeamId:", apiResp.lastPlayerIdResolvedApiTeamId)
    console.log("  ── Phase Longitudinal-Integrity-1B (epoch authority) ──")
    console.log("    epochsDerived               :", epoch.epochsDerived)
    console.log("    rejectionsOnMissingTs       :", epoch.rejectionsOnMissingTs)
    console.log("    fallbacksUsed               :", epoch.fallbacksUsed)
    console.log("    collisionsDetected          :", epoch.collisionsDetected)
    if (epoch.formulaVariantsObserved && Object.keys(epoch.formulaVariantsObserved).length) {
      console.log("    formulaVariantsObserved     :", JSON.stringify(epoch.formulaVariantsObserved))
    }
  } else if (r2.res.body) {
    console.log(`  ${r2.res.body.slice(0, 400)}`)
  }

  // 3. Workstation state (triggers Session AZ rich freeze)
  const r3 = await step("Step 3: workstation state (triggers contextual freeze)", "GET", "/api/ws/state?sport=nba")
  const j3 = safeJson(r3.res.body)
  if (j3) {
    console.log("  featured plays count        :", Array.isArray(j3.featuredPlays) ? j3.featuredPlays.length : "n/a")
    console.log("  ai slips count              :", Array.isArray(j3.aiSlips?.slips) ? j3.aiSlips.slips.length : "n/a")
    console.log("  candidates total            :", j3.candidatesTotal || j3.pool?.length || "n/a")
  } else if (r3.res.body) {
    console.log(`  ${r3.res.body.slice(0, 200)}`)
  }

  const totalMs = Date.now() - t0
  console.log("")
  console.log(`slate:nba completed in ${totalMs}ms`)
}

main().catch((e) => {
  console.error("slate:nba fatal:", e?.message || e)
  process.exit(1)
})
