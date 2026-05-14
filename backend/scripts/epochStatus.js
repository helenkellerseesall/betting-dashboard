#!/usr/bin/env node
"use strict"

/**
 * epochStatus.js — Phase Longitudinal-Integrity-1B (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/epochStatus.js
 *     npm run epoch:status
 *
 * Canonical read-only inspector for the prediction-epoch authority surface.
 * Shows:
 *   - prediction_epochs row counts grouped by formula prefix
 *     (snapshot / live / manual)
 *   - row counts by sport
 *   - row counts by source ('workstation_state' / 'snapshot_bestprops' /
 *     'snapshot_bestprops_replay' / 'live_refresh' / 'nightly' / etc.)
 *   - most recent 5 epoch_ids per sport
 *   - in-process canonical helper diagnostics
 *     (epochsDerived, formulaVariantsObserved, collisionsDetected, etc.)
 *
 * Pure observability. Read-only. Never mutates anything.
 *
 * Note: the in-process counter section is interesting only if this script
 * runs INSIDE a long-lived process that has been deriving epochs. When run
 * standalone (as `npm run epoch:status` does), the counters reset every
 * invocation — they reflect just this single inspection, not the server's
 * cumulative state. The server's cumulative state is observable via
 * /api/best-available.nbaCacheDiagnostics.epochAuthority.
 */

const path = require("path")

function main() {
  const t0 = Date.now()
  console.log("=== epochStatus — Phase Longitudinal-Integrity-1B ===")

  const { tryGetDb, dbPath } = require("../storage/db")
  const { getEpochAuthorityDiagnostics } = require("../storage/intelligence")

  const db = tryGetDb()
  if (!db) {
    console.error("FATAL: SQLite unavailable.")
    process.exit(1)
  }

  console.log(`DB: ${dbPath()}`)
  console.log("")

  // ── prediction_epochs row counts ─────────────────────────────────────────
  let totalEpochs = 0
  try {
    totalEpochs = db.prepare("SELECT COUNT(*) AS n FROM prediction_epochs").get().n
  } catch (_) { /* table missing — fresh repo */ }

  console.log(`── prediction_epochs total rows: ${totalEpochs} ──`)
  console.log("")

  if (totalEpochs === 0) {
    console.log("(no prediction_epochs rows yet — freeze pipelines have not produced any data, or sandbox SQLite unavailable)")
  } else {
    // Group by formula prefix
    const allRows = db
      .prepare("SELECT epoch_id, sport, source, slate_date, captured_at FROM prediction_epochs ORDER BY captured_at DESC")
      .all()

    const byPrefix = { snapshot: 0, live: 0, manual: 0, unknown: 0 }
    for (const r of allRows) {
      if (r.epoch_id?.startsWith("LIVE|"))        byPrefix.live++
      else if (r.epoch_id?.startsWith("MANUAL|")) byPrefix.manual++
      else if (r.epoch_id)                        byPrefix.snapshot++
      else                                        byPrefix.unknown++
    }
    console.log("by formula prefix (parsed from stored epoch_id bytes):")
    console.log(`  snapshot (no prefix) : ${byPrefix.snapshot}`)
    console.log(`  live     (LIVE|...)  : ${byPrefix.live}`)
    console.log(`  manual   (MANUAL|...): ${byPrefix.manual}`)
    if (byPrefix.unknown > 0) console.log(`  (unparseable)        : ${byPrefix.unknown}`)
    console.log("")

    // Group by sport
    const bySport = db
      .prepare("SELECT sport, COUNT(*) AS n FROM prediction_epochs GROUP BY sport ORDER BY n DESC")
      .all()
    console.log("by sport:")
    for (const r of bySport) console.log(`  ${(r.sport || "null").padEnd(8)}: ${r.n}`)
    console.log("")

    // Group by source
    const bySource = db
      .prepare("SELECT source, COUNT(*) AS n FROM prediction_epochs GROUP BY source ORDER BY n DESC")
      .all()
    console.log("by source:")
    for (const r of bySource) console.log(`  ${(r.source || "null").padEnd(36)}: ${r.n}`)
    console.log("")

    // Recent epoch_ids by sport
    const sports = bySport.map((r) => r.sport).filter(Boolean)
    if (sports.length > 0) {
      console.log("most-recent 5 epoch_ids per sport:")
      for (const s of sports) {
        const recent = db
          .prepare("SELECT epoch_id, captured_at, source FROM prediction_epochs WHERE sport = ? ORDER BY captured_at DESC LIMIT 5")
          .all(s)
        console.log(`  ${s}:`)
        for (const r of recent) {
          const id = r.epoch_id || ""
          const truncated = id.length > 80 ? id.slice(0, 77) + "..." : id
          console.log(`    ${r.captured_at}  ${(r.source || "-").padEnd(28)}  ${truncated}`)
        }
      }
      console.log("")
    }
  }

  // ── frozen_contextual_states row counts (linked via epoch_id) ────────────
  let fcsTotal = 0
  try {
    fcsTotal = db.prepare("SELECT COUNT(*) AS n FROM frozen_contextual_states").get().n
  } catch (_) {}
  let distinctEpochsInFcs = 0
  try {
    distinctEpochsInFcs = db
      .prepare("SELECT COUNT(DISTINCT epoch_id) AS n FROM frozen_contextual_states")
      .get().n
  } catch (_) {}
  console.log(`── frozen_contextual_states ──`)
  console.log(`  total rows                : ${fcsTotal}`)
  console.log(`  distinct epoch_ids        : ${distinctEpochsInFcs}`)
  console.log("")

  // ── prediction_id_aliases linkage (Phase Persistence-1B) ─────────────────
  let aliasCount = 0
  try {
    aliasCount = db.prepare("SELECT COUNT(*) AS n FROM prediction_id_aliases").get().n
  } catch (_) {}
  console.log(`── prediction_id_aliases    : ${aliasCount}  (composite-key forward-only bridge — Phase Persistence-1B)`)
  console.log("")

  // ── In-process canonical helper diagnostics ──────────────────────────────
  // These will be empty when this script runs standalone — counters are
  // process-scoped. The server-side cumulative state lives behind
  // /api/best-available.nbaCacheDiagnostics.epochAuthority.
  const inProcessDiag = getEpochAuthorityDiagnostics()
  console.log("── canonical helper diagnostics (this process — standalone scripts will show empty) ──")
  console.log(`  epochsDerived             : ${inProcessDiag.epochsDerived}`)
  console.log(`  rejectionsOnMissingTs     : ${inProcessDiag.rejectionsOnMissingTs}`)
  console.log(`  fallbacksUsed             : ${inProcessDiag.fallbacksUsed}`)
  console.log(`  collisionsDetected        : ${inProcessDiag.collisionsDetected}`)
  console.log(`  epochWriterMapSize        : ${inProcessDiag.epochWriterMapSize}`)
  if (Object.keys(inProcessDiag.formulaVariantsObserved).length > 0) {
    console.log("  formulaVariantsObserved:")
    for (const [k, n] of Object.entries(inProcessDiag.formulaVariantsObserved)) {
      console.log(`    ${k.padEnd(20)}: ${n}`)
    }
  }
  if (inProcessDiag.firstCollisionSample) {
    console.log(`  firstCollisionSample      : ${JSON.stringify(inProcessDiag.firstCollisionSample)}`)
  }
  if (inProcessDiag.firstFallbackSample) {
    console.log(`  firstFallbackSample       : ${JSON.stringify(inProcessDiag.firstFallbackSample)}`)
  }
  if (inProcessDiag.firstRejectionSample) {
    console.log(`  firstRejectionSample      : ${JSON.stringify(inProcessDiag.firstRejectionSample)}`)
  }
  console.log("")
  console.log("(server-side cumulative state observable via /api/best-available.nbaCacheDiagnostics.epochAuthority)")
  console.log("")

  // ── Phase 1A audit cross-reference ───────────────────────────────────────
  console.log("── Phase Longitudinal-Integrity-1A reference ──")
  console.log("  Five derivation sites mapped in docs/EPOCH_AUTHORITY_AUDIT_2026-05-14.md")
  console.log("  Canonical helper: backend/storage/intelligence.js:derivePredictionEpochId")
  console.log("  Phase 1B status: helper introduced ALONGSIDE existing functions; no migration yet.")
  console.log("  Phase 1C will migrate 5 sites to thin wrappers; Phase 1D removes wrappers.")
  console.log("")

  const elapsedMs = Date.now() - t0
  console.log(`Inspection completed in ${elapsedMs}ms`)
}

main()
