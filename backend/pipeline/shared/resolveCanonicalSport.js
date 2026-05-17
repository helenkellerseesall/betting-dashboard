"use strict"

/**
 * resolveCanonicalSport — Phase Sport-Identity-Integrity-1A (2026-05-17).
 *
 * ONE canonical sport-identity resolver. All entry points across the
 * workstation routes / verifiers / orchestrators / snapshot reads MUST
 * converge here. Aliases (mlb / baseball_mlb / MLB / nba / basketball_nba /
 * etc.) are mapped to the SAME canonical runtime authority ("mlb" or "nba").
 *
 * Operator-cemented rule:
 *   "There must be ONE canonical sport identity resolution path. Aliases
 *    may exist, BUT all layers must converge onto the SAME canonical
 *    runtime authority."
 *
 * Anti-fabrication doctrine:
 *   • Pure deterministic function. No I/O. No side-effects.
 *   • Frozen alias map — additive only (operator approval required to add).
 *   • Unknown aliases return null (or fallback when provided); never
 *     invent a sport identity.
 *   • Canonical identities ("mlb" / "nba") are the ONLY values the rest of
 *     the runtime uses (file paths, snapshot keys, cache keys, etc.).
 *
 * Usage:
 *   const { resolveCanonicalSport, CANONICAL_SPORTS, SPORT_ALIAS_MAP } =
 *     require("./resolveCanonicalSport")
 *
 *   resolveCanonicalSport("baseball_mlb")  // → "mlb"
 *   resolveCanonicalSport("MLB")           // → "mlb"
 *   resolveCanonicalSport("basketball_nba")// → "nba"
 *   resolveCanonicalSport("NBA")           // → "nba"
 *   resolveCanonicalSport(undefined, { fallback: "mlb" })  // → "mlb"
 *   resolveCanonicalSport("nfl")           // → null  (no fallback)
 *
 * Verifier-enforced by:
 *   backend/scripts/verifySportIdentityParity.js
 */

const CANONICAL_SPORTS = Object.freeze(["mlb", "nba"])

/**
 * Alias map. Every key (left) is normalized (lowercase + trim) BEFORE
 * lookup. Every value (right) is one of CANONICAL_SPORTS.
 *
 * Adding a new alias is purely additive. Renaming or removing an alias is
 * an operator-approval-required change (continuity break).
 */
const SPORT_ALIAS_MAP = Object.freeze({
  // MLB family
  "mlb":            "mlb",
  "baseball_mlb":   "mlb",
  "baseball-mlb":   "mlb",
  "baseball mlb":   "mlb",
  "baseball":       "mlb",
  // NBA family
  "nba":            "nba",
  "basketball_nba": "nba",
  "basketball-nba": "nba",
  "basketball nba": "nba",
  "basketball":     "nba",
})

/**
 * Resolve any sport alias to its canonical runtime identity.
 *
 * @param {string|undefined|null} input — alias input (e.g. "MLB",
 *   "baseball_mlb", "NBA", "basketball_nba", or canonical "mlb"/"nba").
 * @param {object} [opts]
 * @param {"mlb"|"nba"|null} [opts.fallback=null] — value to return when
 *   input is missing or unrecognized. Pass `"mlb"` to preserve the
 *   pre-Sport-Identity-Integrity-1A workstation default. Defaults to
 *   null so callers can explicitly handle unknown sport.
 * @returns {"mlb"|"nba"|null}
 */
function resolveCanonicalSport(input, opts = {}) {
  const fallback = opts.fallback ?? null
  if (input == null) return fallback
  const key = String(input).toLowerCase().trim()
  if (!key) return fallback
  const mapped = SPORT_ALIAS_MAP[key]
  if (mapped) return mapped
  return fallback
}

/**
 * True iff input is a recognized alias of a canonical sport.
 * Useful for early validation in route handlers.
 */
function isKnownSportAlias(input) {
  return resolveCanonicalSport(input) !== null
}

module.exports = {
  CANONICAL_SPORTS,
  SPORT_ALIAS_MAP,
  resolveCanonicalSport,
  isKnownSportAlias,
}
