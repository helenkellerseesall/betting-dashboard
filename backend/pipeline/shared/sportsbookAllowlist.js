"use strict"

/**
 * sportsbookAllowlist.js — canonical authority for the four operator-approved
 * U.S. retail sportsbooks. Everything else excluded by default until the
 * operator explicitly authorizes additional books via this file.
 *
 * Phase Item 0002 Slice 1.5 — verifier supplement (sportsbook governance).
 *
 * Consumers:
 *   - backend/scripts/verifySportsbookConstructability.js (single-book + book ∈ allowlist)
 *   - future: buildFeaturedPlays + buildSlipAi curated emission filters
 *   - future: FE PropRail render guards (battlefield rows from non-allowed
 *             books may still surface in Discover battlefield by design —
 *             anti-sterilization invariant — but curated slips never
 *             reference a non-allowed book)
 *
 * Doctrine:
 *   - ONE canonical allowlist. No parallel definitions.
 *   - Object.frozen at module load. Mutation requires explicit operator
 *     approval + commit-by-phase via this file.
 *   - Canonical name matching is case-insensitive on input but always
 *     returns the canonical Title-Case form on output.
 *   - Anti-fabrication: callers receive `null` from canonicalBookName(input)
 *     when the input is unrecognized — never substitute a default book.
 *
 * Initial allowlist (operator-authorized 2026-05-19):
 *   - DraftKings
 *   - FanDuel
 *   - BetMGM
 *   - Caesars
 */

const ALLOWED_SPORTSBOOKS = Object.freeze([
  "DraftKings",
  "FanDuel",
  "BetMGM",
  "Caesars",
])

const ALLOWED_SET = Object.freeze(new Set(ALLOWED_SPORTSBOOKS.map(s => s.toLowerCase())))

const SPORTSBOOK_ALIASES = Object.freeze({
  // DraftKings
  "draftkings":   "DraftKings",
  "draft kings":  "DraftKings",
  "dk":           "DraftKings",
  // FanDuel
  "fanduel":      "FanDuel",
  "fan duel":     "FanDuel",
  "fd":           "FanDuel",
  // BetMGM
  "betmgm":       "BetMGM",
  "bet mgm":      "BetMGM",
  "mgm":          "BetMGM",
  // Caesars
  "caesars":      "Caesars",
  "caesar":       "Caesars",
  "czr":          "Caesars",
})

/**
 * Canonicalize an arbitrary sportsbook string to its canonical Title-Case
 * form, or null if the input is unrecognized.
 *
 * @param {string|null|undefined} input
 * @returns {string|null} canonical book name from ALLOWED_SPORTSBOOKS or null
 */
function canonicalBookName(input) {
  if (input == null) return null
  const norm = String(input).trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ")
  if (!norm) return null
  // Direct allowlist hit (already canonical)
  if (ALLOWED_SET.has(norm)) {
    return ALLOWED_SPORTSBOOKS.find(s => s.toLowerCase() === norm) || null
  }
  // Alias resolution
  return SPORTSBOOK_ALIASES[norm] || null
}

/**
 * @param {string|null|undefined} input
 * @returns {boolean}
 */
function isAllowedBook(input) {
  return canonicalBookName(input) !== null
}

/**
 * Strict single-book slip check. Returns the canonical book name when every
 * leg's `book` (or `sportsbook`) is the same allowed book; returns null
 * otherwise (mixed-book OR any leg references a non-allowed book).
 *
 * @param {Array<{book?: string|null, sportsbook?: string|null}>} legs
 * @returns {string|null}
 */
function resolveSingleBookForSlip(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return null
  let canonical = null
  for (const leg of legs) {
    const raw = leg?.book ?? leg?.sportsbook
    const book = canonicalBookName(raw)
    if (!book) return null            // unrecognized book → not allowed
    if (canonical == null) canonical = book
    else if (canonical !== book) return null  // mixed-book → not single-book
  }
  return canonical
}

module.exports = Object.freeze({
  ALLOWED_SPORTSBOOKS,
  SPORTSBOOK_ALIASES,
  canonicalBookName,
  isAllowedBook,
  resolveSingleBookForSlip,
})
