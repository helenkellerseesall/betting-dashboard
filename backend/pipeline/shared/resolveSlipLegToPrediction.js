"use strict"

/**
 * Phase Visual-Betting-Intelligence-1A — resolveSlipLegToPrediction (VBI-2 + VBI-8).
 *
 * Pure function — no I/O, no side-effects, no network, no SQLite.
 *
 * Deterministic mapping from a parsed screenshot leg (the canonical
 * `parsed_slip.legs_json[i]` shape produced by `normalizeIngestedSlip.js`)
 * into the repo's canonical prediction intelligence:
 *
 *   1. canonical `predictionId` (via `intelligence.predictionId()`).
 *   2. canonical-engine-friendly "row" object that the existing MLB
 *      correlation engine + EXPL helpers can consume verbatim
 *      (carries `propType` as a substring-friendly string so
 *      `isHitterCountingProp` / `isPitcherKProp` fire correctly).
 *   3. an EXPLICIT `unresolvedReason` annotation when canonical
 *      mapping cannot complete — anti-fabrication: never invent
 *      fields the upstream parser did not provide.
 *
 * Reuses EXISTING canonical authorities ONLY:
 *   - `backend/storage/intelligence.js:predictionId()` — canonical
 *      lineage join formula.
 *   - `backend/storage/intelligence.js:normPlayer / normFam / normBook`.
 *   - `backend/pipeline/shared/buildLineShoppingIntelligence.js:canonicalBook()`
 *      (transitively via `normBook`).
 *
 * Doctrine:
 *   - NO fuzzy hallucinated mappings.
 *   - NO fabricated confidence.
 *   - NO LLM inference.
 *   - Every output field is a pure function of the input + canonical helpers.
 *   - When fields are insufficient, returns `{ resolved: false, unresolvedReason }`
 *     with a CANONICAL reason from `UNRESOLVED_REASONS`.
 *
 * Also exports the canonical Phase 1A verdict payload SHAPE constant
 * (`VERDICT_PAYLOAD_SHAPE`) so downstream consumers can validate against
 * a single source of truth — VBI-8 canonical screenshot verdict surface.
 */

const { predictionId, normPlayer, normFam, normBook } = require("../../storage/intelligence")

// ── Phase Visual-Betting-Intelligence-1A canonical constants ────────────────

/**
 * Translation from screenshot-normalized `statFamily` (canonical camelCase
 * produced by `normalizeIngestedSlip.normalizeStatFamily`) → a substring-
 * friendly `propType` string the canonical MLB role predicates
 * (`isHitterCountingProp` / `isPitcherKProp` / `isHomeRunsProp`) will match.
 *
 * Why: those predicates use `.includes("total bases")` / `.includes("home run")`
 * / `.includes("strikeouts")` against `propType.toLowerCase()`. Without this
 * translation, `"totalBases"` lowercased is `"totalbases"` which does NOT
 * include the literal substring `"total bases"` (space mismatch). Same for
 * `"hr"` → `"home runs"` and `"ks"` → `"strikeouts"`.
 *
 * Canonical-authority-first: when the screenshot leg ALREADY carries `propRaw`
 * (the original sportsbook text, e.g. "Total Bases"), that string is preferred
 * verbatim — it almost always matches the substring predicates as-is and
 * preserves the bettor's source text.
 */
const STAT_FAMILY_TO_CANONICAL_PROPTYPE = {
  hits:       "hits",
  totalBases: "total bases",
  runs:       "runs",
  rbis:       "rbis",         // .includes("rbi") matches "rbis"
  hr:         "home runs",
  ks:         "strikeouts",
  outs:       "outs",
  walks:      "walks",
  // NBA passthrough (no MLB role predicate applies anyway)
  points:     "points",
  rebounds:   "rebounds",
  assists:    "assists",
  threes:     "threes",
  pra:        "pra",
}

/** Canonical unresolved-leg reason taxonomy. Operator-readable. */
const UNRESOLVED_REASONS = Object.freeze({
  MISSING_PLAYER:      "missing_player",
  MISSING_STAT_FAMILY: "missing_stat_family",
  MISSING_SIDE:        "missing_side",
  MISSING_LINE:        "missing_line",
  MISSING_SPORT:       "missing_sport",
  MISSING_SLATE_DATE:  "missing_slate_date",
  UNKNOWN_STAT_FAMILY: "unknown_stat_family",
})

/**
 * Canonical Phase 1A verdict payload shape (VBI-8). Constant doc-shape
 * exported as a frozen object so consumers (FE renderer, CLI, future
 * persistence migrations) can validate against a single source of truth.
 *
 * Every field is computed deterministically from canonical signals by
 * `buildSlipAnalysis.analyzeSlip()`. No field is fabricated.
 */
const VERDICT_PAYLOAD_SHAPE = Object.freeze({
  verdictSummary:         "string — one-line operator-readable summary",
  strongestLeg:           "{ legIndex, reason } | null",
  weakestLeg:             "{ legIndex, reason } | null",
  contradictionFlags:     "Array<{ legA, legB, reason }>",
  ecologicalCoherence:    "number ∈ [0, 1]",
  covarianceProfile: {
    positiveStacks:         "Array<{ legA, legB, score }>",
    pitcherHitterConflicts: "Array<{ legA, legB }>",
    sharedGameSuppression:  "Array<{ legA, legB }>",
  },
  exploitabilityProfile: {
    marketSupported:      "Array<{ legIndex, bookCount, consensusConfidence }>",
    unsupportedSoloEdge:  "Array<{ legIndex, reason }>",
  },
  availabilityProfile: {
    hardDropOut:          "Array<{ legIndex, player }>",
  },
  fakeSafeRisk:           "{ detected: boolean, reasons: Array<string> }",
  unresolvedLegs:         "Array<{ legIndex, unresolvedReason }>",
  signals:                "Array<{ id, scope: 'leg'|'pair'|'slip', payload }>",
  bettorLanguageSummary:  "Array<string> — rendered phrases from bettorLanguage.js",
})

// ── helpers ──────────────────────────────────────────────────────────────────

function nonEmptyStr(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function num(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── canonical resolver ──────────────────────────────────────────────────────

/**
 * Resolve a single parsed screenshot leg to canonical prediction intelligence.
 *
 * @param {object} leg            — a canonical parsed_slip leg from `normalizeIngestedSlip`
 * @param {object} opts
 * @param {string} opts.sport     — "mlb" | "nba" (required for canonical predictionId)
 * @param {string} opts.slateDate — YYYY-MM-DD (required for canonical predictionId)
 * @returns {{
 *   resolved: boolean,
 *   predictionId: string | null,
 *   normalized: { player, statFamily, side, line, book } | null,
 *   canonicalRow: object | null,
 *   unresolvedReason: string | null,
 * }}
 */
function resolveSlipLegToPrediction(leg, opts = {}) {
  const sport     = nonEmptyStr(opts.sport)
  const slateDate = nonEmptyStr(opts.slateDate)

  // Anti-fabrication: never resolve when sport/date envelope absent.
  if (!sport)     return _unresolved(UNRESOLVED_REASONS.MISSING_SPORT, leg)
  if (!slateDate) return _unresolved(UNRESOLVED_REASONS.MISSING_SLATE_DATE, leg)

  if (!leg || typeof leg !== "object") {
    return _unresolved(UNRESOLVED_REASONS.MISSING_PLAYER, null)
  }

  const player     = nonEmptyStr(leg.player)
  const statFamily = nonEmptyStr(leg.statFamily)
  const side       = nonEmptyStr(leg.side)
  const line       = num(leg.line)

  // Anti-fabrication: every field must be present or we drop with explicit reason.
  if (!player)     return _unresolved(UNRESOLVED_REASONS.MISSING_PLAYER,      leg)
  if (!statFamily) return _unresolved(UNRESOLVED_REASONS.MISSING_STAT_FAMILY, leg)
  if (!side)       return _unresolved(UNRESOLVED_REASONS.MISSING_SIDE,        leg)
  if (line == null) return _unresolved(UNRESOLVED_REASONS.MISSING_LINE,       leg)

  const book = nonEmptyStr(leg.sportsbook)  // optional — anti-fabrication: null is honest

  // Canonical predictionId via existing canonical helper. The function tolerates
  // null book (joins with empty string) — see intelligence.js:243.
  const pid = predictionId(slateDate, sport, player, statFamily, side, line, book)

  // Build a canonical-engine-friendly row. Preserves the bettor's `propRaw` if
  // present (almost always matches the MLB role predicates' substring checks
  // verbatim); otherwise synthesizes from the STAT_FAMILY_TO_CANONICAL_PROPTYPE
  // table. Anti-fabrication: never invent team / eventId values.
  const propType = nonEmptyStr(leg.propRaw)
    || STAT_FAMILY_TO_CANONICAL_PROPTYPE[statFamily]
    || statFamily   // last-ditch passthrough; predicates may not match but
                     // we never fabricate a known stat family.

  const canonicalRow = {
    player,
    team:        nonEmptyStr(leg.team),
    eventId:     nonEmptyStr(leg.eventId),
    matchup:     nonEmptyStr(leg.game),
    statFamily,         // camelCase canonical from normalizeIngestedSlip
    propType,           // substring-friendly for MLB role predicates
    side,
    line,
    odds:        num(leg.odds),
    sportsbook:  book,
    book,               // alias preserved (some helpers read either)
  }

  return {
    resolved: true,
    predictionId: pid,
    normalized: {
      player:     normPlayer(player),
      statFamily: normFam(statFamily),
      side:       String(side).toLowerCase(),
      line,
      book:       normBook(book),
    },
    canonicalRow,
    unresolvedReason: null,
  }
}

function _unresolved(reason, _legHint) {
  return {
    resolved: false,
    predictionId: null,
    normalized: null,
    canonicalRow: null,
    unresolvedReason: reason,
  }
}

/**
 * Batch helper — resolves an array of parsed legs in order, returning the
 * resolved objects (one per input leg) with their original indices preserved.
 *
 * Pure function. Idempotent.
 */
function resolveSlipLegs(legs, opts = {}) {
  if (!Array.isArray(legs)) return []
  return legs.map((leg, i) => ({
    legIndex: i,
    ...resolveSlipLegToPrediction(leg, opts),
  }))
}

module.exports = {
  resolveSlipLegToPrediction,
  resolveSlipLegs,
  STAT_FAMILY_TO_CANONICAL_PROPTYPE,
  UNRESOLVED_REASONS,
  VERDICT_PAYLOAD_SHAPE,
}
