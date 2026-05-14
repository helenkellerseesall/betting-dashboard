#!/usr/bin/env node
"use strict"

/**
 * backfillPredictionIdAliases.js — Phase Persistence-1B (2026-05-14)
 *
 *   Usage:
 *     node backend/scripts/backfillPredictionIdAliases.js
 *     npm run persistence:backfill-aliases
 *
 * Purpose: populate prediction_id_aliases for every prediction_snapshots row
 * whose stored id (raw_id) differs from the canonical id it would produce
 * under current normalizers (normPlayer / normFam / normBook).
 *
 * Idempotent. Re-running is a no-op (INSERT OR IGNORE on raw_id PK).
 *
 * Why this matters: Phase E1 added composite-key normalization backstops.
 * Rows persisted before that change carry their pre-canonical IDs. Without
 * a bridge, outcome_snapshots (Phase 1C) and longitudinal joins across the
 * E1 boundary risk double-counting diacritic/casing/alias variants.
 *
 * This script is analytics-only — NEVER rewrites prediction_snapshots,
 * NEVER touches grading hot paths, NEVER on the freeze/replay path.
 */

const path = require("path")

// Defer requires so import errors surface cleanly.
function main() {
  const t0 = Date.now()
  console.log("=== backfillPredictionIdAliases — Phase Persistence-1B ===")

  const { tryGetDb, dbPath } = require("../storage/db")
  const { applySchema } = require("../storage/schema")
  const { predictionId } = require("../storage/intelligence")

  const db = tryGetDb()
  if (!db) {
    console.error("FATAL: SQLite unavailable. Cannot run backfill.")
    process.exit(1)
  }

  // Ensure schema is current (idempotent — also ensures prediction_id_aliases exists).
  applySchema(db)

  console.log(`DB: ${dbPath()}`)
  console.log("")

  // ── Scan prediction_snapshots ─────────────────────────────────────────────
  const totalRow = db.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots").get()
  const total = totalRow?.n || 0
  console.log(`prediction_snapshots rows to scan: ${total}`)

  if (total === 0) {
    console.log("No predictions to alias. Done.")
    return
  }

  // Read every row's id + raw_json. Stream-style: for 607-row scale this is fine.
  const rows = db.prepare("SELECT id, raw_json FROM prediction_snapshots").all()

  let scanned     = 0
  let parsed      = 0
  let unparseable = 0
  let altered     = 0
  let unchanged   = 0
  let insertedAlias = 0
  let skippedAlias  = 0
  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO prediction_id_aliases (raw_id, canonical_id, norm_diff_type, notes) VALUES (?, ?, ?, ?)"
  )

  // Wrap in a single transaction for performance + atomicity.
  db.exec("BEGIN")
  try {
    for (const r of rows) {
      scanned++
      let raw
      try {
        raw = JSON.parse(r.raw_json || "{}")
      } catch (_) {
        unparseable++
        continue
      }
      parsed++

      // Source fields — same shape buildPersonalLedger / normalizeCandidate use.
      const player     = raw.player ?? raw.playerName ?? null
      const statFamily = raw.statFamily ?? raw.propType ?? raw.prop ?? null
      const side       = raw.side ?? null
      const line       = raw.line ?? null
      const book       = raw.book ?? raw.sportsbook ?? null
      const runDate    = raw.date ?? raw.slateDate ?? raw.run_date ?? null
      const sport      = raw.sport ?? null

      if (!player || !statFamily || !runDate || !sport) {
        // Missing fields → cannot recompute. Treat as unchanged.
        unchanged++
        continue
      }

      const canonical = predictionId(runDate, sport, player, statFamily, side, line, book)

      if (canonical === r.id) {
        unchanged++
        continue
      }

      altered++

      // Detect WHICH normalizer caused the diff. Inexpensive — re-compute
      // each component pre/post and compare. We do this only on altered rows.
      const diffs = []
      const preFixPlayer = String(player || "").toLowerCase().trim()
      const canPlayer    = String(player || "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .trim()
      if (preFixPlayer !== canPlayer) diffs.push("player")

      const preFixFamily = String(statFamily || "").toLowerCase().replace(/\s+/g, "")
      const canFamily    = String(statFamily || "").toLowerCase().replace(/[\s_]+/g, "")
      if (preFixFamily !== canFamily) diffs.push("family")

      // Book diff: compare lowercase-trimmed raw vs canonicalBook→lowercase-trimmed.
      // We don't need to import canonicalBook here — predictionId already used it.
      // If player/family don't account for the whole diff, label as 'book' or 'composite'.
      const idParts = String(r.id).split("|")
      const canParts = String(canonical).split("|")
      // id shape: runDate|sport|player|family|side|line|book
      if (idParts.length === 7 && canParts.length === 7) {
        if (idParts[6] !== canParts[6]) diffs.push("book")
      }

      const diffType = diffs.length === 0 ? "composite"
                     : diffs.length === 1 ? diffs[0]
                     : "composite"

      const result = insertStmt.run(
        r.id,
        canonical,
        diffType,
        `backfill scan (Phase Persistence-1B): ${diffs.join(",") || "id-bytes-differ"}`
      )
      if (result.changes > 0) insertedAlias++
      else skippedAlias++
    }
    db.exec("COMMIT")
  } catch (err) {
    try { db.exec("ROLLBACK") } catch (_) {}
    console.error("FATAL during backfill transaction:", err.message)
    process.exit(2)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const aliasTotalRow = db.prepare("SELECT COUNT(*) AS n FROM prediction_id_aliases").get()
  const aliasTotal = aliasTotalRow?.n || 0

  const byType = db
    .prepare(
      "SELECT norm_diff_type, COUNT(*) AS n FROM prediction_id_aliases GROUP BY norm_diff_type ORDER BY n DESC"
    )
    .all()

  console.log("")
  console.log("── Scan results ──")
  console.log(`  scanned             : ${scanned}`)
  console.log(`  parsed              : ${parsed}`)
  console.log(`  unparseable raw_json: ${unparseable}`)
  console.log(`  unchanged           : ${unchanged}`)
  console.log(`  altered             : ${altered}`)
  console.log(`    inserted alias    : ${insertedAlias}  (new rows in prediction_id_aliases)`)
  console.log(`    skipped (already) : ${skippedAlias}   (alias already present, idempotent)`)
  console.log("")
  console.log(`prediction_id_aliases total rows: ${aliasTotal}`)
  if (byType.length > 0) {
    console.log("  by norm_diff_type:")
    for (const r of byType) {
      console.log(`    ${(r.norm_diff_type || "null").padEnd(12)}: ${r.n}`)
    }
  }

  const elapsedMs = Date.now() - t0
  console.log("")
  console.log(`Done in ${(elapsedMs / 1000).toFixed(2)}s`)
  console.log("prediction_snapshots unchanged — aliases are analytics-only, additive.")
}

main()
