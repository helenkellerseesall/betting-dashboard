"use strict"

/**
 * verificationSchema.js — Session AK
 *
 * Deterministic verification checks for NBA/MLB runtime payloads.
 * Pure functions — receive parsed /api/ws/state response, return a check result.
 * No I/O, no server deps, no side effects.
 *
 * Used by:
 *   backend/scripts/runVerification.js  (CLI runner)
 *
 * Adding a new check:
 *   1. Add an entry to NBA_CHECKS or MLB_CHECKS
 *   2. Set severity: "error" (fails overall) or "warn" (advisory only)
 *   3. Implement run(payload) → checkResult(...)
 */

// ── Result builder ────────────────────────────────────────────────────────────

function checkResult(id, pass, value, expected, message) {
  return {
    id,
    pass: Boolean(pass),
    value,
    expected,
    message: message || (pass ? "ok" : "failed"),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function allSlips(payload) {
  return Object.values(payload?.aiSlips || {}).flat()
}

function allLegs(payload) {
  return allSlips(payload).flatMap(s => s.legs || [])
}

// ── NBA checks ────────────────────────────────────────────────────────────────

const NBA_CHECKS = [
  {
    id: "candidates_populated",
    description: "NBA candidate pool > 0",
    severity: "error",
    run(p) {
      const v = p?.counts?.candidates ?? 0
      return checkResult(this.id, v > 0, v, "> 0", `${v} candidates`)
    },
  },

  {
    id: "ai_slips_generated",
    description: "Total aiSlips across all tiers > 0",
    severity: "error",
    run(p) {
      const v = allSlips(p).length
      return checkResult(this.id, v > 0, v, "> 0", `${v} total slips`)
    },
  },

  {
    id: "correlation_score_fields",
    description: "All NBA slips carry correlationScore field (NBA-2.C wiring)",
    severity: "error",
    run(p) {
      const slips = allSlips(p)
      if (slips.length === 0) return checkResult(this.id, false, 0, "> 0", "no slips to inspect")
      const withField = slips.filter(s => "correlationScore" in s).length
      const pass = withField === slips.length
      return checkResult(this.id, pass, withField, `${slips.length} (all)`,
        `${withField}/${slips.length} slips carry correlationScore field`)
    },
  },

  {
    id: "featured_anchors_present",
    description: "Featured anchors populated",
    severity: "warn",
    run(p) {
      const v = p?.featured?.anchors?.length ?? 0
      return checkResult(this.id, v > 0, v, "> 0", `${v} featured anchors`)
    },
  },

  {
    id: "safe_lane_present",
    description: "SAFE tier slips generated",
    severity: "warn",
    run(p) {
      const v = (p?.aiSlips?.safe || []).length
      return checkResult(this.id, v > 0, v, "> 0", `${v} safe slips`)
    },
  },

  {
    id: "aggressive_lane_present",
    description: "AGGRESSIVE tier slips generated",
    severity: "warn",
    run(p) {
      const v = (p?.aiSlips?.aggressive || []).length
      return checkResult(this.id, v > 0, v, "> 0", `${v} aggressive slips`)
    },
  },

  {
    id: "lotto_lane_present",
    description: "LOTTO tier slips generated",
    severity: "warn",
    run(p) {
      const v = (p?.aiSlips?.lotto || []).length
      return checkResult(this.id, v > 0, v, "> 0", `${v} lotto slips`)
    },
  },

  {
    id: "alt_line_volatility_valid",
    description: "Alt-line legs carry aggressive or lotto volatility only — never balanced/safe (NBA-3)",
    severity: "error",
    run(p) {
      const altLegs = allLegs(p).filter(l => l.isAltLine === true)
      if (altLegs.length === 0) {
        return checkResult(this.id, true, 0, "all valid or 0",
          "no alt-line legs in slips (acceptable if snapshot has no eligible alts today)")
      }
      const invalid = altLegs.filter(l => l.volatility === "balanced" || l.volatility === "safe")
      const pass = invalid.length === 0
      return checkResult(this.id, pass, altLegs.length - invalid.length, `${altLegs.length} all aggressive/lotto`,
        `${invalid.length} invalid-volatility alt legs; ${altLegs.length} total alt legs`)
    },
  },

  {
    id: "no_ineligible_family_alt_legs",
    description: "No rebounds/assists/first_basket alt-line legs survive — NBA-3 family gate",
    severity: "error",
    run(p) {
      const altLegs = allLegs(p).filter(l => l.isAltLine === true)
      const illegal = altLegs.filter(l =>
        ["rebounds", "assists", "first_basket"].includes(l.statFamily))
      return checkResult(this.id, illegal.length === 0, illegal.length, "0",
        `${illegal.length} illegal-family alt legs detected`)
    },
  },

  {
    id: "safe_lane_no_alt_contamination",
    description: "SAFE tier contains zero alt-line legs — NBA-3 SAFE lane protection",
    severity: "error",
    run(p) {
      const safeLegs = (p?.aiSlips?.safe || []).flatMap(s => s.legs || [])
      const altInSafe = safeLegs.filter(l => l.isAltLine === true).length
      return checkResult(this.id, altInSafe === 0, altInSafe, "0",
        `${altInSafe} alt-line legs found in SAFE tier`)
    },
  },
]

// ── MLB checks ────────────────────────────────────────────────────────────────

const MLB_CHECKS = [
  {
    id: "mlb_slips_generated",
    description: "MLB aiSlips total > 0",
    severity: "error",
    run(p) {
      const v = allSlips(p).length
      return checkResult(this.id, v > 0, v, "> 0", `${v} mlb slips`)
    },
  },

  {
    id: "mlb_lotto_lane_present",
    description: "MLB LOTTO tier slips generated",
    severity: "warn",
    run(p) {
      const v = (p?.aiSlips?.lotto || []).length
      return checkResult(this.id, v > 0, v, "> 0", `${v} lotto slips`)
    },
  },

  {
    id: "mlb_featured_anchors",
    description: "MLB featured anchors populated",
    severity: "warn",
    run(p) {
      const v = p?.featured?.anchors?.length ?? 0
      return checkResult(this.id, v > 0, v, "> 0", `${v} featured anchors`)
    },
  },

  {
    id: "mlb_no_correlation_score",
    description: "MLB slips do NOT carry correlationScore (MLB path isolation — must stay null/absent)",
    severity: "error",
    run(p) {
      const slips = allSlips(p)
      if (slips.length === 0) return checkResult(this.id, true, 0, "0", "no slips to check")
      const withNonNull = slips.filter(s => "correlationScore" in s && s.correlationScore !== null).length
      return checkResult(this.id, withNonNull === 0, withNonNull, "0",
        `${withNonNull} mlb slips have non-null correlationScore (isolation breach)`)
    },
  },
]

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { NBA_CHECKS, MLB_CHECKS, checkResult, allSlips, allLegs }
