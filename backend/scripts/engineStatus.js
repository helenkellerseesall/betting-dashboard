#!/usr/bin/env node
"use strict"

/**
 * engineStatus.js — Phase Operator-Operations-1 (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/engineStatus.js
 *     npm run engine:status
 *
 * Canonical operator entrypoint to inspect backend liveness + brain state.
 *
 * Output sections:
 *   1. port 4000 occupancy (lsof-based; informational)
 *   2. /snapshot/status HTTP probe (if backend is up)
 *   3. brain doc freshness summary
 *   4. continuity receipt summary
 *
 * Pure observability. Never mutates. Exits 0 even when backend is down —
 * "status" is informational, not a health-gate.
 */

const http = require("http")
const { spawnSync } = require("child_process")

function pingHttp(pathname, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "localhost", port: 4000, path: pathname, timeout: timeoutMs },
      (res) => {
        let body = ""
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve({ ok: true, status: res.statusCode, body }))
      }
    )
    req.on("error", (e) => resolve({ ok: false, error: e.code || e.message }))
    req.on("timeout", () => {
      req.destroy()
      resolve({ ok: false, error: "timeout" })
    })
  })
}

function lsofPort4000() {
  try {
    const r = spawnSync("lsof", ["-i", "tcp:4000", "-P", "-n"], { encoding: "utf8" })
    if (r.status === 0 && r.stdout) return r.stdout.trim()
    return null
  } catch (_) {
    return null
  }
}

async function main() {
  const t0 = Date.now()
  console.log("=== engine:status — Phase Operator-Operations-1 ===\n")

  // ── 1. port 4000 occupancy ──────────────────────────────────────────────
  console.log("── port 4000 occupancy ──")
  const lsof = lsofPort4000()
  if (lsof) {
    console.log(lsof)
  } else {
    console.log("  (no process on port 4000 — or lsof unavailable)")
  }
  console.log("")

  // ── 2. /snapshot/status HTTP probe ──────────────────────────────────────
  console.log("── /snapshot/status (HTTP) ──")
  const probe = await pingHttp("/snapshot/status")
  if (probe.ok) {
    console.log(`  HTTP ${probe.status}`)
    try {
      const j = JSON.parse(probe.body)
      console.log(`  ${JSON.stringify(j, null, 2).split("\n").slice(0, 30).join("\n  ")}`)
    } catch (_) {
      console.log(`  ${probe.body.slice(0, 400)}`)
    }
  } else {
    console.log(`  unreachable (${probe.error}) — backend likely not running`)
    console.log(`  Run: npm run engine:start  (or engine:restart)`)
  }
  console.log("")

  // ── 3. brain doc freshness ──────────────────────────────────────────────
  console.log("── brain freshness (delegating to brain:status) ──")
  const brainStatus = spawnSync("node", [require("path").join(__dirname, "brain", "brainSyncSummary.js")], {
    encoding: "utf8",
  })
  if (brainStatus.status === 0 && brainStatus.stdout) {
    // Print just the summary sections — trim verbose header.
    const out = brainStatus.stdout.split("\n")
    const summaryStart = out.findIndex((line) => /CURRENT PHASE/i.test(line))
    const trimmed = summaryStart >= 0 ? out.slice(summaryStart).join("\n") : brainStatus.stdout
    console.log(trimmed.split("\n").slice(0, 30).join("\n"))
  } else {
    console.log("  (brain:status unavailable)")
  }
  console.log("")

  // ── 4. continuity receipt ───────────────────────────────────────────────
  console.log("── continuity receipt (npm run brain:continuity) ──")
  const cont = spawnSync("node", [require("path").join(__dirname, "brain", "assessContinuity.js")], {
    encoding: "utf8",
  })
  if (cont.stdout) {
    const lines = cont.stdout.split("\n")
    const resultIdx = lines.findIndex((l) => /^RESULT:/.test(l))
    if (resultIdx >= 0) {
      console.log("  " + lines.slice(Math.max(0, resultIdx - 4), resultIdx + 2).join("\n  "))
    } else {
      console.log("  " + lines.slice(-10).join("\n  "))
    }
  }
  console.log("")

  const elapsedMs = Date.now() - t0
  console.log(`engine:status completed in ${elapsedMs}ms`)
}

main().catch((e) => {
  console.error("engine:status fatal:", e?.message || e)
  process.exit(1)
})
