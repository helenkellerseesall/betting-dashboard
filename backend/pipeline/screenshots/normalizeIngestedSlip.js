"use strict"

/**
 * normalizeIngestedSlip.js
 *
 * Pure function — no I/O, no side-effects.
 *
 * Converts ANY slip shape (internal AI slip, personal ledger bet, pasted
 * Twitter/Discord text, sportsbook screenshot JSON) into the canonical
 * `parsed_slip` shape stored in the screenshot_submissions pipeline.
 *
 * Design principles:
 *   - Never throws: unknown/malformed fields silently degrade to null
 *   - Idempotent: normalizing an already-normalized slip is safe
 *   - Forward-compatible: raw_json always preserved for re-parsing
 *   - Source-agnostic: all sources produce identical output shape
 *
 * Usage:
 *   const { normalizeIngestedSlip } = require('./normalizeIngestedSlip')
 *   const slip = normalizeIngestedSlip(rawInput, { sourceType: 'twitter' })
 *
 * Returns null if the input is too malformed to produce even one leg.
 */

const crypto = require("crypto")

// ── helpers ───────────────────────────────────────────────────────────────────

function num(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function strLow(v) {
  const s = str(v)
  return s ? s.toLowerCase() : null
}

function americanToDecimal(o) {
  const n = num(o)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)
}

function hashSlip(legs, submissionId) {
  const key = `${submissionId}|${legs.map(l =>
    `${(l.player || "").toLowerCase()}|${l.statFamily || ""}|${l.side || ""}|${l.line ?? ""}`
  ).join("__")}`
  return "ps_" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)
}

// ── stat family normalizer ────────────────────────────────────────────────────

const STAT_FAMILY_ALIASES = {
  // hits / batting
  "hits":            "hits",
  "hit":             "hits",
  "h":               "hits",
  "1+ hits":         "hits",
  "any hits":        "hits",
  // total bases
  "total bases":     "totalBases",
  "totalbases":      "totalBases",
  "tb":              "totalBases",
  "total base":      "totalBases",
  // runs
  "runs":            "runs",
  "runs scored":     "runs",
  "r":               "runs",
  // rbis
  "rbi":             "rbis",
  "rbis":            "rbis",
  "run batted in":   "rbis",
  "runs batted in":  "rbis",
  // home runs
  "hr":              "hr",
  "home run":        "hr",
  "home runs":       "hr",
  "homerun":         "hr",
  "homer":           "hr",
  "long ball":       "hr",
  // strikeouts (pitcher)
  "strikeouts":      "ks",
  "strikeout":       "ks",
  "k":               "ks",
  "ks":              "ks",
  "pitcher strikeouts": "ks",
  "pitcher ks":      "ks",
  // walks
  "walks":           "walks",
  "walk":            "walks",
  "bb":              "walks",
  // outs
  "outs":            "outs",
  "pitcher outs":    "outs",
  "outs recorded":   "outs",
  // nba points
  "points":          "points",
  "pts":             "points",
  // rebounds
  "rebounds":        "rebounds",
  "reb":             "rebounds",
  "rebs":            "rebounds",
  // assists
  "assists":         "assists",
  "ast":             "assists",
  // threes
  "threes":          "threes",
  "three pointers":  "threes",
  "3-pointers":      "threes",
  "3pt":             "threes",
  // combo
  "pra":             "pra",
  "pts+reb+ast":     "pra",
  "points+rebounds+assists": "pra",
  "combo":           "pra",
}

function normalizeStatFamily(raw) {
  if (!raw) return null
  const k = String(raw).toLowerCase().replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim()
  return STAT_FAMILY_ALIASES[k] || null
}

// ── side normalizer ───────────────────────────────────────────────────────────

function normalizeSide(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase().trim()
  if (s === "over" || s === "o" || s === "more" || s === "yes" || s === "hit") return "over"
  if (s === "under" || s === "u" || s === "less" || s === "no" || s === "miss") return "under"
  return null
}

// ── odds normalizer ───────────────────────────────────────────────────────────

function normalizeOdds(raw) {
  if (raw == null) return null
  // Accept American (+150, -110, 150), or decimal (2.5), or string forms
  const s = String(raw).replace(/[^0-9.+\-]/g, "").trim()
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  // If value looks like decimal odds (1.01 – 100): convert to American
  if (n > 1 && n < 100 && !String(raw).includes("+") && !String(raw).includes("-")) {
    // Decimal: 2.5 → +150; 1.5 → -200
    if (n >= 2) return Math.round((n - 1) * 100)
    return -Math.round(100 / (n - 1))
  }
  return Math.round(n)
}

// ── leg normalizer ────────────────────────────────────────────────────────────

/**
 * Normalize a single leg from any source shape.
 * Returns a canonical leg object or null if insufficient data.
 *
 * Input shapes handled:
 *   Internal AI slip leg:  { player, statFamily, side, line, oddsAmerican, ... }
 *   Personal ledger bet:   { player, statFamily, side, line, odds, sportsbook, ... }
 *   Text-parsed leg:       { player, prop, side, line, odds, book, ... }
 *   Screenshot OCR:        { playerName, propText, direction, value, odds, ... }
 */
function normalizeLeg(raw) {
  if (!raw || typeof raw !== "object") return null

  const player = str(raw.player || raw.playerName || raw.playerNameRaw)
  const side   = normalizeSide(raw.side || raw.direction || raw.outcome)
  const line   = num(raw.line ?? raw.point ?? raw.value ?? raw.lineValue)
  const odds   = normalizeOdds(raw.odds ?? raw.oddsAmerican ?? raw.americanOdds ?? raw.price)

  // statFamily: try direct then parse from prop text
  let statFamily = normalizeStatFamily(raw.statFamily || raw.propType || raw.stat)
  if (!statFamily) {
    statFamily = normalizeStatFamily(raw.propText || raw.propRaw || raw.marketName || raw.prop)
  }

  // Must have at least side + (player or statFamily) to be useful
  if (!side && !player && !statFamily) return null

  return {
    player:      player,
    team:        str(raw.team || raw.teamCode || raw.teamAbbr),
    statFamily:  statFamily,
    propRaw:     str(raw.propText || raw.propRaw || raw.prop || raw.marketName),
    side:        side,
    line:        line,
    odds:        odds,
    sportsbook:  str(raw.sportsbook || raw.book || raw.bookName),
    game:        str(raw.game || raw.matchup || raw.gameText),
    eventId:     str(raw.eventId),
  }
}

// ── combined odds computation ─────────────────────────────────────────────────

function computeCombinedDecimal(legs) {
  let dec = 1
  for (const leg of legs) {
    const d = americanToDecimal(leg.odds)
    if (!Number.isFinite(d) || d <= 1) return null
    dec *= d
  }
  return Number.isFinite(dec) ? Math.round(dec * 10000) / 10000 : null
}

function decimalToAmerican(d) {
  const n = Number(d)
  if (!Number.isFinite(n) || n <= 1) return null
  return n >= 2 ? Math.round((n - 1) * 100) : -Math.round(100 / (n - 1))
}

// ── top-level normalizer ──────────────────────────────────────────────────────

/**
 * Normalize any slip input into the canonical parsed_slip shape.
 *
 * @param {object|object[]} raw  — raw slip object or array of raw leg objects
 * @param {object} opts
 * @param {string} opts.submissionId    — ID of the parent screenshot_submission row
 * @param {string} opts.sourceType      — 'internal'|'personal'|'screenshot'|'twitter'|'discord'|'viral'|'guru'|'sportsbook'
 * @param {string} [opts.sourceLabel]   — human label ("@SomeGuru", "my parlay")
 * @param {string} [opts.sport]         — override sport detection
 * @param {string} [opts.slateDate]     — YYYY-MM-DD
 * @param {string} [opts.attribution]   — poster name
 *
 * @returns {object|null}  Canonical parsed_slip or null if no usable legs
 */
function normalizeIngestedSlip(raw, opts = {}) {
  if (!raw) return null

  const {
    submissionId = "unknown",
    sourceType   = "unknown",
    sourceLabel  = null,
    sport        = null,
    slateDate    = null,
    attribution  = null,
  } = opts

  // ── Extract leg array from any shape ────────────────────────────────────────
  let rawLegs = []

  if (Array.isArray(raw)) {
    // Input is already an array of legs
    rawLegs = raw
  } else if (Array.isArray(raw.legs)) {
    // Internal AI slip shape: { legs: [...], tier, combinedAmericanOdds, ... }
    rawLegs = raw.legs
  } else if (Array.isArray(raw.bets)) {
    // Some shapes use .bets
    rawLegs = raw.bets
  } else if (typeof raw === "object" && (raw.player || raw.statFamily || raw.propText)) {
    // Single-leg bet (personal ledger bet, single prop)
    rawLegs = [raw]
  } else {
    return null
  }

  // ── Normalize each leg ───────────────────────────────────────────────────────
  const legs = rawLegs.map(normalizeLeg).filter(Boolean)
  if (legs.length === 0) return null

  // ── Compute combined odds ────────────────────────────────────────────────────
  const allHaveOdds = legs.every(l => l.odds != null)
  const combinedDec = allHaveOdds && legs.length > 1 ? computeCombinedDecimal(legs) : null
  const combinedAmerican = combinedDec ? decimalToAmerican(combinedDec) :
    (legs.length === 1 ? legs[0].odds : null)

  // ── Detect sport from leg stat families if not provided ─────────────────────
  let detectedSport = str(sport) || str(raw.sport)
  if (!detectedSport) {
    const nbaFams = new Set(["points", "rebounds", "assists", "threes", "pra"])
    const mlbFams = new Set(["hits", "totalBases", "hr", "runs", "rbis", "ks", "outs", "walks"])
    const hasNba = legs.some(l => l.statFamily && nbaFams.has(l.statFamily))
    const hasMlb = legs.some(l => l.statFamily && mlbFams.has(l.statFamily))
    if (hasNba && !hasMlb)  detectedSport = "nba"
    else if (hasMlb && !hasNba) detectedSport = "mlb"
    else if (hasNba && hasMlb)  detectedSport = "mixed"
  }

  // ── Extract slip-level fields from raw object (if not an array) ───────────
  const slipSourceLabel  = str(sourceLabel) || str(raw.sourceLabel)
  const slipAttribution  = str(attribution) || str(raw.attribution) || str(raw.poster)
  const slipDate         = str(slateDate)   || str(raw.slateDate) || str(raw.date)
  const slipSportsbook   = str(raw.sportsbook || raw.book) || (legs.length === 1 ? legs[0].sportsbook : null)
  const postedPayout     = num(raw.postedPayout ?? raw.payout ?? raw.potentialPayout ?? raw.winAmount)
  const postedStake      = num(raw.postedStake  ?? raw.stake ?? raw.wager ?? raw.riskAmount)

  // ── Generate stable ID ───────────────────────────────────────────────────────
  const id = hashSlip(legs, submissionId)

  return {
    id,
    submission_id:       submissionId,
    sport:               detectedSport,
    slate_date:          slipDate,
    source_type:         sourceType,
    total_legs:          legs.length,
    legs_json:           JSON.stringify(legs),
    combined_odds:       combinedAmerican,
    combined_dec:        combinedDec,
    potential_payout:    postedPayout,
    stake:               postedStake,
    currency:            str(raw.currency) || "USD",
    sportsbook:          slipSportsbook,
    attribution:         slipAttribution,
    source_label:        slipSourceLabel,
    linked_internal_id:  str(raw.linkedInternalId) || null,
    status:              "pending",
    raw_json:            JSON.stringify(raw),
    // Convenience: parsed legs array (for classifier — not stored directly)
    _legs:               legs,
    _raw:                raw,
  }
}

// ── Batch normalizer ──────────────────────────────────────────────────────────

/**
 * Normalize an array of slips from the same submission.
 * Returns array of normalized slips (nulls filtered out).
 *
 * @param {Array} raws        — array of raw slip objects
 * @param {object} opts       — same as normalizeIngestedSlip opts
 * @returns {Array}
 */
function normalizeIngestedSlips(raws, opts = {}) {
  if (!Array.isArray(raws)) return []
  return raws.map((raw, i) => normalizeIngestedSlip(raw, {
    ...opts,
    submissionId: opts.submissionId ? `${opts.submissionId}_${i}` : `unknown_${i}`,
  })).filter(Boolean)
}

module.exports = { normalizeIngestedSlip, normalizeIngestedSlips, normalizeLeg, normalizeStatFamily, normalizeSide, normalizeOdds }
