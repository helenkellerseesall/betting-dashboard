"use strict"

/**
 * sportsbookTopology.js — Phase Item 0003 Slice 1.
 *
 * Canonical authority for per-book capabilities + per-slip best-book
 * selection. Reads the frozen topology JSON at module load. Pure
 * deterministic functions; no network calls; no live fetches.
 *
 * Consumers (Slice 2 — not yet wired):
 *   - backend/pipeline/shared/buildSlipAi.js    (curated slip emit-path)
 *   - backend/pipeline/shared/buildFeaturedPlays.js  (compactPlay book selection)
 *
 * Doctrine:
 *   - ONE canonical topology. No parallel definitions in any other source file.
 *   - Object.frozen at module load. Mutation requires explicit operator
 *     approval via the JSON file + commit-by-phase.
 *   - Anti-fabrication: bestBookForSlip returns null when no allowed book
 *     can construct every leg; never substitutes a default.
 *   - Best-CONSTRUCTABLE-ECOSYSTEM, NOT per-leg best-odds fragmentation:
 *     bestBookForSlip selects ONE book per slip that constructs ALL legs;
 *     it does not split legs across books.
 */

const fs   = require("fs")
const path = require("path")

const { ALLOWED_SPORTSBOOKS, canonicalBookName, isAllowedBook } =
  require("./sportsbookAllowlist")

const TOPOLOGY_PATH = path.join(__dirname, "..", "..", "data", "sportsbookTopology.json")

function loadTopology() {
  const raw = fs.readFileSync(TOPOLOGY_PATH, "utf8")
  const parsed = JSON.parse(raw)
  const books = parsed?.books || {}
  // Verify every allowed book has a topology entry; never fabricate a missing one.
  for (const book of ALLOWED_SPORTSBOOKS) {
    if (!books[book]) {
      throw new Error(
        `sportsbookTopology: missing topology entry for allowed book "${book}". ` +
        `Add an entry to backend/data/sportsbookTopology.json or remove the book from sportsbookAllowlist.js.`
      )
    }
  }
  return Object.freeze(parsed)
}

const TOPOLOGY = loadTopology()
const BOOK_TOPOLOGY = TOPOLOGY.books
const MARKET_KEY_ALIASES = TOPOLOGY.marketKeyAliases || {}

function canonicalMarketKey(input) {
  if (input == null) return null
  // Two-pass normalization: (1) space-form for alias-map lookup, (2) underscore-form
  // for direct comparison against topology marketKeys (which are underscore_form).
  const spaceForm = String(input).trim().toLowerCase().replace(/[\s._-]+/g, " ").replace(/\s+/g, " ")
  if (!spaceForm) return null
  // Alias resolution (matches MARKET_KEY_ALIASES space-form keys)
  const aliasHit = MARKET_KEY_ALIASES[spaceForm]
  if (aliasHit) return aliasHit
  // Underscore-form for canonical comparison (matches topology marketKeys)
  const underscoreForm = spaceForm.replace(/\s+/g, "_")
  return underscoreForm
}

function bookCapabilitiesFor(book) {
  const canonical = canonicalBookName(book)
  if (!canonical) return null
  return BOOK_TOPOLOGY[canonical] || null
}

function canConstructLegOn(book, leg) {
  const caps = bookCapabilitiesFor(book)
  if (!caps) return false
  const mkRaw = leg?.marketKey || leg?.market || leg?.propType
  const mk = canonicalMarketKey(mkRaw)
  if (!mk) return false
  // Direct market key hit, or normalized propType resolves to a supported family.
  if (Array.isArray(caps.marketKeys) && caps.marketKeys.includes(mk)) return true
  // Pitcher / batter family aliasing — fall back through alias map.
  return false
}

function distinctEventIds(legs) {
  const s = new Set()
  for (const l of legs) {
    const id = String(l?.eventId || "").trim()
    if (id) s.add(id)
  }
  return s.size
}

/**
 * Score a book for a given slip on three deterministic axes:
 *   1. constructability   — all legs supported by the book's market list (binary; 1.0 or 0)
 *   2. leg-capacity       — legs.length ≤ caps.maxLegsPerSlip (binary)
 *   3. cross-game SGP     — required when distinct eventIds > 1 (binary)
 *
 * Score = 1.0 when all three pass; 0 otherwise. (Slice-1 deterministic
 * gate; Slice-2 will introduce odds-quality + parlay-boost weighting.)
 *
 * @param {string} book canonical name
 * @param {Array} legs slip legs
 * @returns {{ canonicalBook: string|null, score: number, constructable: boolean, reasons: string[] }}
 */
function scoreBookForSlip(book, legs) {
  const canonical = canonicalBookName(book)
  const caps = canonical ? BOOK_TOPOLOGY[canonical] : null
  const reasons = []
  if (!caps) {
    reasons.push("book-not-in-topology")
    return { canonicalBook: null, score: 0, constructable: false, reasons }
  }
  if (!Array.isArray(legs) || legs.length === 0) {
    reasons.push("no-legs")
    return { canonicalBook: canonical, score: 0, constructable: false, reasons }
  }
  // Leg-by-leg market-key constructability
  for (const leg of legs) {
    if (!canConstructLegOn(canonical, leg)) {
      reasons.push("leg-market-unsupported:" + canonicalMarketKey(leg?.marketKey || leg?.propType))
      return { canonicalBook: canonical, score: 0, constructable: false, reasons }
    }
  }
  // Capacity
  if (legs.length > (caps.maxLegsPerSlip || 0)) {
    reasons.push("over-leg-cap:" + legs.length + ">" + caps.maxLegsPerSlip)
    return { canonicalBook: canonical, score: 0, constructable: false, reasons }
  }
  // Cross-game SGP
  if (distinctEventIds(legs) > 1 && !caps.supportsCrossGameSGP) {
    reasons.push("cross-game-sgp-unsupported")
    return { canonicalBook: canonical, score: 0, constructable: false, reasons }
  }
  return { canonicalBook: canonical, score: 1.0, constructable: true, reasons: [] }
}

/**
 * Select the single best-constructable book for a slip. Returns the
 * canonical book name when at least one allowed book can construct ALL
 * legs; returns null otherwise (slip is unconstructable as same-book).
 *
 * Best-constructable-ecosystem doctrine (operator-cemented 2026-05-19):
 *   - NO per-leg best-odds fragmentation. Selection is per-slip.
 *   - Ordering preference: ALLOWED_SPORTSBOOKS array order (DraftKings →
 *     FanDuel → Fanatics → Caesars → BetMGM → Hard Rock → BetRivers).
 *   - This ordering acts as a tie-breaker only; constructability is the
 *     gate. Slice-2 will introduce odds-quality scoring above this gate.
 *
 * @param {Array} legs slip legs (must have marketKey or propType + eventId)
 * @returns {{ canonicalBook: string|null, score: number, alternativeBooks: string[] }}
 */
function bestBookForSlip(legs) {
  const candidates = []
  for (const book of ALLOWED_SPORTSBOOKS) {
    const r = scoreBookForSlip(book, legs)
    if (r.constructable) candidates.push(book)
  }
  if (candidates.length === 0) {
    return { canonicalBook: null, score: 0, alternativeBooks: [] }
  }
  return {
    canonicalBook:    candidates[0],
    score:            1.0,
    alternativeBooks: candidates.slice(1),
  }
}

/**
 * For a single leg, rank allowed books by constructability (Slice-1
 * deterministic gate). Slice-2 will rank by odds-quality on top.
 *
 * @param {object} leg
 * @returns {Array<{ canonicalBook: string, score: number }>}
 */
function rankBooksForLeg(leg) {
  const out = []
  for (const book of ALLOWED_SPORTSBOOKS) {
    if (canConstructLegOn(book, leg)) out.push({ canonicalBook: book, score: 1.0 })
  }
  return out
}

function listAllowedBooks() {
  return [...ALLOWED_SPORTSBOOKS]
}

module.exports = Object.freeze({
  TOPOLOGY,
  BOOK_TOPOLOGY,
  MARKET_KEY_ALIASES,
  canonicalMarketKey,
  bookCapabilitiesFor,
  canConstructLegOn,
  scoreBookForSlip,
  bestBookForSlip,
  rankBooksForLeg,
  listAllowedBooks,
})
