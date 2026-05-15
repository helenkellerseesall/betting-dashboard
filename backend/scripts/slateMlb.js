#!/usr/bin/env node
"use strict"

/**
 * slateMlb.js — Phase Operator-Operations-1 (2026-05-14)
 *                + Phase Canonical-Shape-Hardening-1A (HARDEN-2) (2026-05-15)
 *
 *   Usage:
 *     node backend/scripts/slateMlb.js
 *     npm run slate:mlb
 *
 * Canonical operator entrypoint to trigger MLB slate refresh + summary.
 *
 * Sequence:
 *   1. GET /refresh-snapshot?sport=baseball_mlb      (MLB-specific refresh)
 *   2. GET /api/best-available?sport=baseball_mlb    (slate snapshot)
 *   3. GET /api/ws/state?sport=mlb                   (workstation hydration)
 */

const http = require("http")
// Phase Canonical-Shape-Hardening-1A (HARDEN-2): canonical resolver helpers.
// Replaces the prior inline `j3.featuredPlays` / `j3.aiSlips?.slips.length`
// drift sites with the single canonical source of truth in
// backend/pipeline/shared/responseShapeResolvers.js. The canonical
// /api/ws/state shape is owned by backend/routes/workstationRoutes.js.
const {
  resolveFeaturedCount,
  resolveAiSlipCount,
} = require("../pipeline/shared/responseShapeResolvers")

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
  console.log("=== slate:mlb — Phase Operator-Operations-1 ===")

  // 1. MLB refresh
  const r1 = await step("Step 1: MLB snapshot refresh", "GET", "/refresh-snapshot?sport=baseball_mlb")
  const j1 = safeJson(r1.res.body)
  if (j1) {
    const summary = {
      ok:       j1.ok,
      skipped:  j1.skipped,
      reason:   j1.reason,
      sport:    j1.sport,
      events:   j1.events,
      props:    j1.props,
      rows:     j1.rows,
    }
    console.log(`  ${JSON.stringify(summary)}`)
  } else if (r1.res.body) {
    console.log(`  ${r1.res.body.slice(0, 400)}`)
  }

  // 2. Best-available diagnostics
  const r2 = await step("Step 2: best-available", "GET", "/api/best-available?sport=baseball_mlb")
  const j2 = safeJson(r2.res.body)
  if (j2) {
    const rows  = Array.isArray(j2.rows) ? j2.rows.length : (Array.isArray(j2.props) ? j2.props.length : "n/a")
    const fresh = j2.snapshotMeta?.snapshotFreshness || j2.snapshotFreshness || null
    console.log("  rows count                :", rows)
    if (fresh) {
      console.log("  ── snapshotFreshness ──")
      console.log("    label                  :", fresh.label || fresh.freshness)
      console.log("    ageMs                  :", fresh.ageMs)
      console.log("    isStale                :", fresh.isStale)
    }
    if (j2.diagnostics) {
      console.log("  ── diagnostics ──")
      console.log("    bootstrapPhase         :", j2.diagnostics.bootstrapPhase || "n/a")
    }
  } else if (r2.res.body) {
    console.log(`  ${r2.res.body.slice(0, 400)}`)
  }

  // 3. Workstation state
  const r3 = await step("Step 3: workstation state", "GET", "/api/ws/state?sport=mlb")
  const j3 = safeJson(r3.res.body)
  if (j3) {
    // Phase Canonical-Shape-Hardening-1A (HARDEN-2): canonical resolver helpers
    // replace prior drift sites at the same line numbers. The previous reads
    // `j3.featuredPlays` and `j3.aiSlips?.slips.length` consulted keys the
    // canonical /api/ws/state response (workstationRoutes.js:~693-712) never
    // emits — same INC-017 anti-pattern that affected the NBA equivalent
    // before Phase Intelligence-Shaping-1A. The canonical authority lives in
    // backend/pipeline/shared/responseShapeResolvers.js; this script now reads
    // through it so future API-shape evolution updates one file, not N.
    console.log("  featured plays count       :", resolveFeaturedCount(j3))
    console.log("  ai slips count             :", resolveAiSlipCount(j3))
  } else if (r3.res.body) {
    console.log(`  ${r3.res.body.slice(0, 200)}`)
  }

  const totalMs = Date.now() - t0
  console.log("")
  console.log(`slate:mlb completed in ${totalMs}ms`)
}

main().catch((e) => {
  console.error("slate:mlb fatal:", e?.message || e)
  process.exit(1)
})
