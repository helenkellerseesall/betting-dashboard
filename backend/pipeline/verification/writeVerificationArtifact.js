"use strict"

/**
 * writeVerificationArtifact.js — Session AK
 *
 * Canonical artifact writer for verification telemetry.
 * Writes compact JSON artifacts to backend/runtime/verifications/.
 *
 * Features:
 *   - Atomic write (tmp → rename) — runtime-safe, no partial files
 *   - Deterministic filename: verification_<sport>_<date>_<session>.json
 *   - Compact runtime snapshot (counts only, not full payload)
 *   - Schema version field for future migration
 *   - GitHub portable (pure Node stdlib, no external deps)
 */

const fs = require("fs")
const path = require("path")

// Resolved relative to this file: backend/pipeline/verification/ → backend/runtime/verifications/
const VERIFICATIONS_DIR = path.resolve(__dirname, "../../runtime/verifications")

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function todayKey() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-")
}

// ── Writer ────────────────────────────────────────────────────────────────────

/**
 * writeVerificationArtifact({ sport, session, checks, payload, options })
 *
 * @param {string}   sport    — "nba" | "mlb"
 * @param {string}   session  — e.g. "AK"
 * @param {Array}    checks   — array of check results from verificationSchema.js
 * @param {object}   payload  — raw /api/ws/state response (for runtime snapshot extraction)
 * @param {object}   options  — arbitrary metadata to embed (host, flags, etc.)
 *
 * @returns {{ outPath, filename, artifact }}
 */
function writeVerificationArtifact({ sport, session, checks, payload, options = {} }) {
  ensureDir(VERIFICATIONS_DIR)

  const date = todayKey()
  const timestamp = new Date().toISOString()
  const passed  = checks.filter(c => c.pass).length
  const failed  = checks.filter(c => !c.pass && c.severity === "error").length
  const warned  = checks.filter(c => !c.pass && c.severity === "warn").length
  const overall = failed === 0 ? "PASS" : "FAIL"

  // Compact runtime snapshot — counts only, never embed the full payload
  const allSlips  = Object.values(payload?.aiSlips || {}).flat()
  const altLegs   = allSlips.flatMap(s => s.legs || []).filter(l => l.isAltLine === true)
  const runtimeSnapshot = {
    sport_param_used:   sport,
    candidates:         payload?.counts?.candidates ?? null,
    total_slips:        allSlips.length,
    slips_by_tier: {
      safe:             (payload?.aiSlips?.safe       || []).length,
      balanced:         (payload?.aiSlips?.balanced   || []).length,
      aggressive:       (payload?.aiSlips?.aggressive || []).length,
      lotto:            (payload?.aiSlips?.lotto      || []).length,
    },
    alt_line_legs_in_slips:  altLegs.length,
    alt_line_families:       [...new Set(altLegs.map(l => l.statFamily))].sort(),
    featured_anchors:        payload?.featured?.anchors?.length ?? null,
    correlation_fields:      allSlips.filter(s => "correlationScore" in s).length,
    non_zero_correlation:    allSlips.filter(s => s.correlationScore > 0).length,
  }

  const artifact = {
    schema_version: "1",
    session:        session || "unknown",
    timestamp,
    date,
    sport,
    overall,
    summary: { total: checks.length, passed, failed, warned },
    checks,
    runtime_snapshot: runtimeSnapshot,
    options,
  }

  const filename = `verification_${sport}_${date}_${session || "nosession"}.json`
  const outPath  = path.join(VERIFICATIONS_DIR, filename)

  // Atomic write: .tmp → rename (prevents partial reads on crash)
  const tmpPath = outPath + ".tmp"
  fs.writeFileSync(tmpPath, JSON.stringify(artifact, null, 2), "utf8")
  fs.renameSync(tmpPath, outPath)

  return { outPath, filename, artifact }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { writeVerificationArtifact, VERIFICATIONS_DIR }
