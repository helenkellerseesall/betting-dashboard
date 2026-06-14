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
// Phase Season-Switch-1A — canonical season gate (backend/config/seasonsActive.json).
const { isSportEnabled } = require("../pipeline/shared/seasonGate")

function request(method, pathname, timeoutMs = 180_000) {
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

  // Phase Season-Switch-1A — authoritative entry gate. Covers every fire path
  // (scheduler.sh, autopilot wrappers, manual `npm run slate:mlb`). OFF → make
  // no API calls and no file writes; exit clean (0). Existing data untouched.
  if (!isSportEnabled("mlb")) {
    console.log("slate:mlb SKIPPED — MLB season OFF (backend/config/seasonsActive.json). No calls made, no files written.")
    return
  }

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
    // for the two fields the resolver module owns. Additive 2026-05-21:
    // surface more of the canonical /api/ws/state shape so the operator sees
    // ALL the populated counts (not just featured + aiSlips), and annotate
    // featured=n/a as "may be still building" (the featured-plays builder
    // runs asynchronously after refresh — first ws/state hit can land before
    // it completes; a re-query usually finds featured populated).
    const featured = resolveFeaturedCount(j3)
    const slips    = resolveAiSlipCount(j3)
    const cands    = j3?.counts?.candidates ?? "n/a"
    const urgent   = j3?.counts?.urgent ?? "n/a"
    const multi    = j3?.counts?.propsWithMultiBook ?? "n/a"
    const steam    = j3?.counts?.steam ?? "n/a"
    const stale    = j3?.counts?.stale ?? "n/a"
    const discov   = Array.isArray(j3?.discoveryCandidates) ? j3.discoveryCandidates.length : "n/a"
    const freshLbl = j3?.snapshotFreshness?.label || j3?.snapshotFreshness?.status || j3?.snapshotFreshness?.freshness || "n/a"
    const freshAge = j3?.snapshotFreshness?.snapshotAgeMinutes ?? "n/a"
    const degraded = j3?.degraded ?? "n/a"

    const featuredAnnotation = featured === "n/a" ? " (may be still building — re-run to recheck)" : ""
    const freshAgeAnnotation = freshAge !== "n/a" ? ` (${freshAge}min old)` : ""

    console.log("  featured plays count       :", featured + featuredAnnotation)
    console.log("  ai slips count             :", slips)
    console.log("  candidates (counts field)  :", cands)
    console.log("  discovery candidates       :", discov)
    console.log("  urgent plays               :", urgent)
    console.log("  multi-book props           :", multi)
    console.log("  steam / stale counts       :", steam, "/", stale)
    console.log("  snapshot freshness         :", freshLbl + freshAgeAnnotation)
    console.log("  degraded                   :", degraded)
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
