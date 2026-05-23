"use strict"

/**
 * sportsbookAllowlist.js — canonical authority for the operator's approved
 * U.S. retail sportsbooks. Everything else excluded by default until the
 * operator explicitly authorizes additional books via this file.
 *
 * Consumers:
 *   - backend/scripts/verifySportsbookConstructability.js (single-book + book ∈ allowlist)
 *   - frontend/mobile/index.html (defense-in-depth ALLOWED_BOOKS filter)
 *   - buildFeaturedPlays + buildSlipAi curated emission filters
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
 * Allowlist evolution:
 *   2026-05-19 — initial 4-book set (DraftKings / FanDuel / BetMGM / Caesars).
 *   2026-05-19 — Phase Item 0003 Slice 1: expanded to 7-book set
 *                (added Fanatics / Hard Rock / BetRivers). Operator-authorized.
 *   2026-05-22 — Operator product-vision finalization: Caesars REMOVED,
 *                bet365 ADDED. Final 7-book operator list:
 *                DraftKings, FanDuel, Fanatics, BetRivers, BetMGM, Hard Rock, bet365.
 *                Drops Caesars + BetOnline.ag and any other non-allowed leak.
 */

// 2026-05-22 second pass: audit revealed Odds API feed delivers HR props
// ONLY from Caesars in our current config. Operator's stated 7-book vision
// (DK/FD/Fanatics/BetMGM/HardRock/BetRivers/bet365) is data-feed-aspirational
// — 4 of those books (BetMGM, BetRivers, Hard Rock, bet365) return ZERO rows
// in current feed. Restoring Caesars temporarily so HR markets surface while
// task #15 audits Odds API config / tier to determine whether the other 4
// books can be made to flow.
const ALLOWED_SPORTSBOOKS = Object.freeze([
  "DraftKings",
  "FanDuel",
  "Fanatics",
  "Caesars",
  "BetMGM",
  "Hard Rock",
  "BetRivers",
  "bet365",
])

const ALLOWED_SET = Object.freeze(new Set(ALLOWED_SPORTSBOOKS.map(s => s.toLowerCase())))

const SPORTSBOOK_ALIASES = Object.freeze({
  // DraftKings
  "draftkings":     "DraftKings",
  "draft kings":    "DraftKings",
  "dk":             "DraftKings",
  // FanDuel
  "fanduel":        "FanDuel",
  "fan duel":       "FanDuel",
  "fd":             "FanDuel",
  // Fanatics — Phase Item 0003 Slice 1
  "fanatics":       "Fanatics",
  "fanatics sportsbook": "Fanatics",
  "fanatics betting": "Fanatics",
  // BetMGM
  "betmgm":         "BetMGM",
  "bet mgm":        "BetMGM",
  "mgm":            "BetMGM",
  // Hard Rock — Phase Item 0003 Slice 1
  "hard rock":      "Hard Rock",
  "hardrock":       "Hard Rock",
  "hard rock bet":  "Hard Rock",
  "hardrockbet":    "Hard Rock",
  "hr":             "Hard Rock",
  // BetRivers — Phase Item 0003 Slice 1
  "betrivers":      "BetRivers",
  "bet rivers":     "BetRivers",
  "br":             "BetRivers",
  "rivers":         "BetRivers",
  // Caesars — restored 2026-05-22 second pass because Odds API delivers HR
  // markets exclusively from Caesars in our current feed
  "caesars":        "Caesars",
  "caesar":         "Caesars",
  "czr":            "Caesars",
  // bet365 — added 2026-05-22 (operator product vision target)
  "bet365":         "bet365",
  "bet 365":        "bet365",
  "bet365.com":     "bet365",
  "b365":           "bet365",
  "365":            "bet365",
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
