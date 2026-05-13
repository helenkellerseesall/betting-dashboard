"use strict"

/**
 * Betting Intelligence Layer
 *
 * Longitudinal prediction-vs-reality tracking across all sports.
 * Provides:
 *   - snapshotPredictions   — persist model predictions at generation time
 *   - snapshotEcology       — persist pool composition per nightly run
 *   - recordOutcomes        — settle predictions against actual results
 *   - recordSlipOutcome     — settle a slip with per-leg breakdown
 *   - getDeltaSummary       — calibration analysis (model vs reality)
 *   - getCalibrationBuckets — model_prob buckets vs actual hit rates
 *   - getArchetypePerf      — performance grouped by volatility + tier
 *   - getStatFamilyMisses   — which stats are systematically over/under-predicted
 *   - getEcologyHistory     — pool diversity trends over time
 *   - getSlipPerformance    — slip outcome analysis by tier/structure
 *
 * Architecture principles:
 *   - All writes are INSERT OR IGNORE (predictions) / INSERT OR REPLACE (outcomes)
 *     — safe to call multiple times, never corrupts existing data
 *   - All functions gracefully degrade: return null if SQLite unavailable
 *   - Cross-sport: sport column everywhere, no sport-specific branching here
 *   - JSON runtime files remain canonical; this layer is analytics-only
 *
 * Usage:
 *   const intel = require('../storage/intelligence')
 *   intel.snapshotPredictions(candidates, { sport: 'mlb', date: '2026-05-07' })
 *   intel.snapshotEcology(candidates, slipsByTier, { sport: 'mlb', date: '2026-05-07' })
 */

const { tryGetDb }              = require("./db")
const { applyIntelligenceSchema } = require("./intelligenceSchema")
const { classifyVolatility }    = require("../pipeline/shared/buildPortfolioOptimizer")
// Phase E1 — Composite-key integrity hardening.
// Sportsbook alias canonicalization shares the BOOK_ALIASES map with the rest
// of the pipeline (single source of truth). `canonicalBook()` accepts any of
// "DK" / "draftkings" / "DraftKings" / "Draft Kings" and returns the canonical
// form "DraftKings". We post-process with lowercase+trim inside predictionId
// so the composite-key bytes are deterministic regardless of which form the
// caller supplied.
const { canonicalBook }         = require("../pipeline/shared/buildLineShoppingIntelligence")

// ── Schema init ───────────────────────────────────────────────────────────────

let _schemaApplied = false

function ensureSchema() {
  if (_schemaApplied) return
  const db = tryGetDb()
  if (!db) return
  applyIntelligenceSchema(db)
  _schemaApplied = true
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function safeNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function safeStr(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase E1 — Composite-key integrity hardening
// ─────────────────────────────────────────────────────────────────────────────
//
// These three normalizers are the CANONICAL BACKSTOP for composite prediction
// IDs. Upstream snapshot rows are produced by various normalizers
// (normalizeMlbPlayerKey, normalizeMlbText, etc.) which may strip diacritics
// differently or carry different separator conventions. To prevent silent
// grading-join failures where prediction_snapshots.id ≠ outcome_snapshots.id
// for the same logical prop, these helpers enforce a single canonical form:
//
//   normPlayer  — Unicode NFD + combining-mark strip + lowercase + trim
//   normFam     — lowercase + collapse all whitespace AND underscores
//   normBook    — canonicalBook() (alias lookup) + lowercase + trim
//
// All three are DETERMINISTIC, REPLAY-SAFE, and BYTE-STABLE: the same input
// always produces the same output, independent of process / locale / time.
//
// Historical compatibility:
//   - Rows already persisted under PRE-FIX IDs remain queryable by their
//     stored id (this layer never rewrites historical records).
//   - Going forward, new predictions and their outcomes both go through these
//     normalizers, so the join is consistent.
//   - The asymmetry between pre-fix and post-fix IDs for the same logical
//     prediction is the cost of the upgrade. For MLB this is moot (the
//     prior db.transaction bug meant no MLB epoch was actually persisted).
//
// Diagnostics:
//   - Rate-limited collision probes emit one log line per canonicalization
//     class on the FIRST input that would have differed pre-fix. Counters
//     accumulate across the process lifetime and are exposed via
//     `getCanonicalizationDiagnostics()` / `resetCanonicalizationDiagnostics()`.
// ─────────────────────────────────────────────────────────────────────────────

// In-module collision diagnostic state. Counters accumulate; first sample of
// each class is captured for later inspection. One stdout probe per class.
const __canonDiag = {
  predictionIdsBuilt:               0,
  playerInputsCanonicalized:        0,
  statFamilyInputsCanonicalized:    0,
  bookInputsCanonicalized:          0,
  predictionIdsBytewiseAltered:     0,
  firstPlayerCollision:             null,
  firstStatFamilyCollision:         null,
  firstBookCollision:               null,
  firstPredictionIdCollision:       null,
  _loggedPlayer:                    false,
  _loggedStatFamily:                false,
  _loggedBook:                      false,
  _loggedPredictionId:              false,
}

function _maybeLog(kind, payload) {
  const flagKey = `_logged${kind}`
  if (__canonDiag[flagKey]) return
  __canonDiag[flagKey] = true
  console.log("[CANONICALIZATION-COLLISION-DETECTED]", JSON.stringify({
    kind: kind.charAt(0).toLowerCase() + kind.slice(1),
    ...payload,
    note: "pre-fix composite-key bytes would have differed from canonical form; first occurrence per kind logged once per process",
  }))
}

/**
 * Canonical backstop for stat-family bytes.
 *
 * Collapses three known variants to one:
 *   "Total Bases" → "totalbases"
 *   "total_bases" → "totalbases"
 *   "totalbases"  → "totalbases"
 *
 * This is the same byte-collapse rule applied at the producer side via
 * `classifyMlbPropFamilyKey` (which emits underscored forms) and at the
 * surface side (which often carries Title Case strings from the Odds API).
 */
function normFam(s) {
  if (s == null) return ""
  const raw = String(s)
  const canonical = raw.toLowerCase().replace(/[\s_]+/g, "")
  // Pre-fix form only collapsed whitespace; underscores survived.
  const preFix = raw.toLowerCase().replace(/\s+/g, "")
  if (canonical !== preFix) {
    __canonDiag.statFamilyInputsCanonicalized += 1
    if (!__canonDiag.firstStatFamilyCollision) {
      __canonDiag.firstStatFamilyCollision = { raw, preFix, canonical }
    }
    _maybeLog("StatFamily", { raw, preFix, canonical })
  }
  return canonical
}

/**
 * Canonical backstop for player-identity bytes.
 *
 * Applies Unicode NFD decomposition + combining-mark strip, then lowercases
 * and trims. Examples:
 *   "Ronald Acuña Jr."    → "ronald acuna jr."
 *   "Ronald Acuna Jr."    → "ronald acuna jr."
 *   "ACUÑA JR"            → "acuna jr"
 *   "Luka Dončić"         → "luka doncic"
 *   "JOSÉ RAMÍREZ"        → "jose ramirez"
 *
 * DOES NOT strip suffixes (Jr/Sr/II/III) — these are part of the identity
 * and are preserved consistently here and upstream in `normalizeMlbText`.
 *
 * DOES NOT strip apostrophes or hyphens — preserved as ASCII so names like
 * "O'Neill" / "Smith-Jones" / "D'Angelo" remain disambiguable.
 */
function normPlayer(s) {
  if (s == null) return ""
  const raw = String(s)
  const canonical = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
  // Pre-fix form: lowercase + trim only — diacritics preserved.
  const preFix = raw.toLowerCase().trim()
  if (canonical !== preFix) {
    __canonDiag.playerInputsCanonicalized += 1
    if (!__canonDiag.firstPlayerCollision) {
      __canonDiag.firstPlayerCollision = { raw, preFix, canonical }
    }
    _maybeLog("Player", { raw, preFix, canonical })
  }
  return canonical
}

/**
 * Canonical backstop for sportsbook-identity bytes.
 *
 * Delegates to `canonicalBook()` (the project-canonical alias map) and then
 * lowercases + trims so the composite-key form is deterministic regardless
 * of whether `canonicalBook()` returned a known mapped form or the trimmed
 * raw input.
 *
 *   "DK"           → canonicalBook → "DraftKings"  → "draftkings"
 *   "DraftKings"   → canonicalBook → "DraftKings"  → "draftkings"
 *   "draftkings"   → canonicalBook → "DraftKings"  → "draftkings"
 *   "Draft Kings"  → canonicalBook → "DraftKings"  → "draftkings"
 *   "Hard Rock"    → canonicalBook → "Hard Rock"   → "hard rock"
 *   "MyNewBook"    → canonicalBook → "MyNewBook"   → "mynewbook"  (unknown but stable)
 */
function normBook(s) {
  if (s == null) return ""
  const raw = String(s)
  let canonicalAlias = null
  try {
    canonicalAlias = canonicalBook(raw)
  } catch (_) { /* defensive */ }
  const canonical = canonicalAlias == null
    ? raw.toLowerCase().trim()
    : String(canonicalAlias).toLowerCase().trim()
  // Pre-fix form: normPlayer() applied to book, i.e. just lowercase + trim.
  const preFix = raw.toLowerCase().trim()
  if (canonical !== preFix) {
    __canonDiag.bookInputsCanonicalized += 1
    if (!__canonDiag.firstBookCollision) {
      __canonDiag.firstBookCollision = { raw, preFix, canonical }
    }
    _maybeLog("Book", { raw, preFix, canonical })
  }
  return canonical
}

/**
 * Build a deterministic, collision-resistant prediction ID.
 * Stable across repeated pipeline runs for the same candidate.
 *
 * Composite-key inputs are all routed through canonical backstops above so
 * the same LOGICAL prediction always produces the same bytes regardless of
 * source-side spelling variations (diacritics, suffixes, sportsbook aliases,
 * stat-family separators).
 */
function predictionId(runDate, sport, player, statFamily, side, line, book) {
  const player_n     = normPlayer(player)
  const statFamily_n = normFam(statFamily)
  const side_n       = String(side || "").toLowerCase()
  const line_n       = String(safeNum(line) ?? "")
  const book_n       = normBook(book)
  const id = [
    String(runDate).slice(0, 10),
    String(sport).toLowerCase(),
    player_n,
    statFamily_n,
    side_n,
    line_n,
    book_n,
  ].join("|")
  __canonDiag.predictionIdsBuilt += 1
  // Detect whether the composite ID would have differed under pre-fix rules.
  // Pre-fix used: lowercase+trim for player, lowercase+strip-whitespace for
  // family, lowercase+trim for book.
  const preFixPlayer = String(player || "").toLowerCase().trim()
  const preFixFamily = String(statFamily || "").toLowerCase().replace(/\s+/g, "")
  const preFixBook   = String(book || "").toLowerCase().trim()
  if (preFixPlayer !== player_n || preFixFamily !== statFamily_n || preFixBook !== book_n) {
    __canonDiag.predictionIdsBytewiseAltered += 1
    if (!__canonDiag.firstPredictionIdCollision) {
      __canonDiag.firstPredictionIdCollision = {
        canonicalId: id,
        preFixId: [
          String(runDate).slice(0, 10),
          String(sport).toLowerCase(),
          preFixPlayer,
          preFixFamily,
          side_n,
          line_n,
          preFixBook,
        ].join("|"),
        deltas: {
          player: preFixPlayer !== player_n ? { pre: preFixPlayer, canonical: player_n } : null,
          statFamily: preFixFamily !== statFamily_n ? { pre: preFixFamily, canonical: statFamily_n } : null,
          book: preFixBook !== book_n ? { pre: preFixBook, canonical: book_n } : null,
        },
      }
    }
    _maybeLog("PredictionId", {
      example: id,
      message: "first composite-key whose bytes differ from pre-fix form; future grading/freeze joins now align canonically",
    })
  }
  return id
}

/**
 * Read-only snapshot of the canonicalization-collision diagnostics. Used by
 * verification fixtures and by snapshot diagnostics consumers.
 */
function getCanonicalizationDiagnostics() {
  return {
    predictionIdsBuilt:            __canonDiag.predictionIdsBuilt,
    playerInputsCanonicalized:     __canonDiag.playerInputsCanonicalized,
    statFamilyInputsCanonicalized: __canonDiag.statFamilyInputsCanonicalized,
    bookInputsCanonicalized:       __canonDiag.bookInputsCanonicalized,
    predictionIdsBytewiseAltered:  __canonDiag.predictionIdsBytewiseAltered,
    firstPlayerCollision:          __canonDiag.firstPlayerCollision,
    firstStatFamilyCollision:      __canonDiag.firstStatFamilyCollision,
    firstBookCollision:            __canonDiag.firstBookCollision,
    firstPredictionIdCollision:    __canonDiag.firstPredictionIdCollision,
  }
}

/**
 * Reset the canonicalization-collision counters. Used by tests; production
 * code should never call this (counters are intended to accumulate across
 * the process lifetime so operators can see cumulative impact).
 */
function resetCanonicalizationDiagnostics() {
  __canonDiag.predictionIdsBuilt = 0
  __canonDiag.playerInputsCanonicalized = 0
  __canonDiag.statFamilyInputsCanonicalized = 0
  __canonDiag.bookInputsCanonicalized = 0
  __canonDiag.predictionIdsBytewiseAltered = 0
  __canonDiag.firstPlayerCollision = null
  __canonDiag.firstStatFamilyCollision = null
  __canonDiag.firstBookCollision = null
  __canonDiag.firstPredictionIdCollision = null
  __canonDiag._loggedPlayer = false
  __canonDiag._loggedStatFamily = false
  __canonDiag._loggedBook = false
  __canonDiag._loggedPredictionId = false
}

/**
 * Shannon entropy over a frequency distribution.
 * H = -Σ p(i) * log2(p(i))
 * Returns 0 for empty or single-element distributions.
 * Perfect diversity for N categories = log2(N).
 */
function shannonEntropy(freqMap) {
  const total = Object.values(freqMap).reduce((s, v) => s + v, 0)
  if (total === 0) return 0
  return Object.values(freqMap).reduce((h, count) => {
    if (count <= 0) return h
    const p = count / total
    return h - p * Math.log2(p)
  }, 0)
}

/**
 * Build a frequency distribution object from an array of values.
 * { "totalbases": 10, "hits": 8, ... }
 */
function freqDist(arr) {
  const dist = {}
  for (const v of arr) {
    if (v == null) continue
    const k = String(v)
    dist[k] = (dist[k] || 0) + 1
  }
  return dist
}

/**
 * Normalize a candidate to the shape expected by prediction_snapshots.
 * Accepts both tracked_bets rows and tracked_best (enriched) rows.
 */
function normalizeCandidate(raw, opts = {}) {
  const { runDate, sport, ecologyBucket, slipTiers } = opts

  const player     = raw.player || raw.playerName
  const statFamily = normFam(raw.statFamily || raw.propType || raw.prop || "")
  const side       = String(raw.side || "").toLowerCase()
  const line       = safeNum(raw.line)
  const book       = raw.book || raw.sportsbook
  const date       = runDate || raw.date || raw.slateDate || String(raw.run_date || "").slice(0, 10)
  const sportStr   = sport || raw.sport || "mlb"

  if (!player || !statFamily || !date) return null

  const odds       = safeNum(raw.odds ?? raw.oddsAmerican)
  const modelProb  = safeNum(raw.modelProb ?? raw.predictedProbability ?? raw.calibratedConfidence)
  const impliedProb = safeNum(raw.impliedProb)
  const edge       = safeNum(raw.edge ?? raw.edgeProbability)
  const volatility = classifyVolatility(raw)

  return {
    id:             predictionId(date, sportStr, player, statFamily, side, line, book),
    run_date:       date,
    sport:          sportStr,
    player:         safeStr(player),
    team:           safeStr(raw.team || raw.teamCode),
    event_id:       safeStr(raw.eventId),
    matchup:        safeStr(raw.matchup),
    stat_family:    statFamily,
    side,
    line,
    odds,
    model_prob:     modelProb,
    implied_prob:   impliedProb,
    edge,
    confidence:     safeNum(raw.confidence || raw.calibratedConfidence),
    tier:           safeStr(raw.tier || raw.confidenceTier || raw.bucket),
    volatility,
    ecology_bucket: safeStr(ecologyBucket || null),
    sportsbook:     safeStr(book),
    archetype:      safeStr(raw.archetype || raw.archetypeTag),
    composite_score: safeNum(raw.compositeScore || raw.mlbPhase3Score),
    slip_tiers:     slipTiers ? JSON.stringify(slipTiers) : null,
    raw_json:       JSON.stringify(raw),
  }
}

// ── Write: predictions ────────────────────────────────────────────────────────

/**
 * Persist a batch of prediction snapshots.
 *
 * @param {object[]} candidates  — raw candidate rows (tracked_bets or tracked_best shape)
 * @param {object}   opts
 * @param {string}   opts.sport  — 'mlb' | 'nba' | 'nfl' | 'nhl'
 * @param {string}   opts.date   — 'YYYY-MM-DD'
 * @param {string}   [opts.ecologyBucket]  — which featured bucket surfaced these candidates
 * @param {string[]} [opts.slipTiers]      — which slip tiers these appeared in
 *
 * @returns {{ inserted: number, skipped: number } | null}
 */
function snapshotPredictions(candidates, opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db || !Array.isArray(candidates) || candidates.length === 0) return null

    const normOpts = { ...opts, runDate: opts.runDate || opts.date }
    const normalized = candidates
      .map(c => normalizeCandidate(c, normOpts))
      .filter(Boolean)

    if (normalized.length === 0) return { inserted: 0, skipped: 0 }

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO prediction_snapshots (
        id, run_date, sport, player, team, event_id, matchup,
        stat_family, side, line, odds, model_prob, implied_prob, edge,
        confidence, tier, volatility, ecology_bucket, sportsbook,
        archetype, composite_score, slip_tiers, raw_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `)

    let inserted = 0, skipped = 0

    db.exec("BEGIN")
    try {
      for (const r of normalized) {
        const res = stmt.run(
          r.id, r.run_date, r.sport, r.player, r.team, r.event_id, r.matchup,
          r.stat_family, r.side, r.line, r.odds, r.model_prob, r.implied_prob, r.edge,
          r.confidence, r.tier, r.volatility, r.ecology_bucket, r.sportsbook,
          r.archetype, r.composite_score, r.slip_tiers, r.raw_json
        )
        if (res.changes > 0) inserted++
        else skipped++
      }
      db.exec("COMMIT")
    } catch (txErr) {
      db.exec("ROLLBACK")
      throw txErr
    }
    return { inserted, skipped }
  } catch (err) {
    console.warn("[intelligence] snapshotPredictions error:", err.message)
    return null
  }
}

// ── Write: ecology ────────────────────────────────────────────────────────────

/**
 * Persist a pool ecology snapshot for a nightly run.
 *
 * @param {object[]} candidates   — diversified candidate pool
 * @param {object}   slipsByTier  — { safe: [], balanced: [], aggressive: [], lotto: [] }
 * @param {object}   opts
 * @param {string}   opts.sport
 * @param {string}   opts.date
 * @param {string}   [opts.notes]
 *
 * @returns {boolean} true on success
 */
function snapshotEcology(candidates, slipsByTier, opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db || !Array.isArray(candidates)) return false

    const sport   = safeStr(opts.sport) || "mlb"
    const runDate = safeStr(opts.date)  || new Date().toISOString().slice(0, 10)

    // Pool composition
    const overs   = candidates.filter(c => String(c.side || "").toLowerCase() === "over").length
    const unders  = candidates.filter(c => String(c.side || "").toLowerCase() === "under").length

    const volCounts = { safe: 0, balanced: 0, aggressive: 0, lotto: 0 }
    for (const c of candidates) {
      const v = classifyVolatility(c)
      if (v in volCounts) volCounts[v]++
    }

    // Stat distribution for entropy
    const statArr = candidates.map(c => normFam(c.statFamily || c.propType || ""))
    const statDist = freqDist(statArr)
    const entropy  = shannonEntropy(statDist)

    // Sportsbook distribution
    const bookArr  = candidates.map(c => safeStr(c.book || c.sportsbook) || "unknown")
    const bookDist = freqDist(bookArr)

    // Tier distribution (confidence tier)
    const tierArr  = candidates.map(c => safeStr(c.tier || c.confidenceTier || c.bucket) || "unknown")
    const tierDist = freqDist(tierArr)

    // Slip counts
    const tiers = ["safe", "balanced", "aggressive", "lotto"]
    const slipCounts = {}
    let totalSlips = 0
    for (const t of tiers) {
      const n = (slipsByTier?.[t] || []).length
      slipCounts[t] = n
      totalSlips   += n
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO ecology_snapshots (
        run_date, sport,
        candidate_count, over_count, under_count,
        safe_count, balanced_count, aggressive_count, lotto_count,
        stat_dist, sportsbook_dist, tier_dist,
        slip_count, slip_by_tier, entropy, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      runDate, sport,
      candidates.length, overs, unders,
      volCounts.safe, volCounts.balanced, volCounts.aggressive, volCounts.lotto,
      JSON.stringify(statDist), JSON.stringify(bookDist), JSON.stringify(tierDist),
      totalSlips, JSON.stringify(slipCounts), entropy,
      safeStr(opts.notes)
    )

    return true
  } catch (err) {
    console.warn("[intelligence] snapshotEcology error:", err.message)
    return false
  }
}

// ── Write: outcomes ───────────────────────────────────────────────────────────

/**
 * Record an outcome for a single prediction.
 *
 * @param {string} predId      — prediction_snapshots.id
 * @param {object} outcome
 * @param {number|null} outcome.hit          — 1=win, 0=loss, null=push/void
 * @param {number|null} outcome.actualValue  — actual stat result (e.g. 2.0 hits)
 * @param {number|null} outcome.clv          — closing line value
 * @param {number|null} outcome.closingOdds  — American odds at close
 * @param {string|null} outcome.settledAt    — ISO timestamp
 * @param {string|null} outcome.notes        — e.g. "player scratched"
 * @param {object} opts
 * @param {string} opts.sport
 * @param {string} opts.date
 *
 * @returns {boolean}
 */
function recordOutcome(predId, outcome, opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db || !predId) return false

    // Fetch the original prediction to carry forward metadata
    const pred = db.prepare("SELECT * FROM prediction_snapshots WHERE id = ?").get(predId)

    const hit     = outcome.hit != null ? safeNum(outcome.hit) : null
    const modelP  = safeNum(pred?.model_prob)
    // delta_prob: positive = model was overconfident (predicted high, missed)
    const delta   = (modelP != null && hit != null) ? modelP - hit : null

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO outcome_snapshots (
        id, run_date, sport, player, stat_family, side, line,
        model_prob, implied_prob, edge, tier, volatility, ecology_bucket,
        actual_value, hit, delta_prob, clv, closing_odds,
        settled_at, notes, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      predId,
      safeStr(opts.date) ?? pred?.run_date ?? null,
      safeStr(opts.sport) ?? pred?.sport ?? null,
      pred?.player ?? null,
      pred?.stat_family ?? null,
      pred?.side ?? null,
      pred?.line ?? null,
      modelP,
      safeNum(pred?.implied_prob),
      safeNum(pred?.edge),
      pred?.tier ?? null,
      pred?.volatility ?? null,
      pred?.ecology_bucket ?? null,
      safeNum(outcome.actualValue),
      hit,
      delta,
      safeNum(outcome.clv),
      safeNum(outcome.closingOdds),
      safeStr(outcome.settledAt),
      safeStr(outcome.notes),
      JSON.stringify(outcome)
    )

    return true
  } catch (err) {
    console.warn("[intelligence] recordOutcome error:", err.message)
    return false
  }
}

/**
 * Batch record outcomes for many predictions.
 *
 * @param {Array<{ id: string, hit: number|null, actualValue?: number, clv?: number,
 *                 closingOdds?: number, settledAt?: string, notes?: string }>} settlements
 * @param {object} opts — { sport, date }
 *
 * @returns {{ recorded: number, errors: number } | null}
 */
function recordOutcomes(settlements, opts = {}) {
  if (!Array.isArray(settlements) || settlements.length === 0) return null
  let recorded = 0, errors = 0
  for (const s of settlements) {
    const ok = recordOutcome(s.id, s, opts)
    if (ok) recorded++
    else errors++
  }
  return { recorded, errors }
}

// ── Write: slip outcomes ──────────────────────────────────────────────────────

/**
 * Record the outcome of a single slip.
 *
 * @param {object} slip     — from slip_catalog shape (must have .id, .legs, .tier, etc.)
 * @param {object} result
 * @param {number} result.legsHit      — how many legs won
 * @param {string} result.result       — win / loss / partial / void
 * @param {number} [result.payoutDec]  — decimal payout (combined_dec if win, 0 if loss)
 * @param {string} [result.settledAt]
 * @param {Array}  [result.legResults] — per-leg outcome detail
 * @param {object} opts — { sport, date }
 *
 * @returns {boolean}
 */
function recordSlipOutcome(slip, result, opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db || !slip?.id) return false

    const legs = slip.legs || []

    // Build ecology metadata from leg composition
    const statFamilyMix = freqDist(legs.map(l => normFam(l.statFamily || l.propType || "")))
    const volatilityMix = freqDist(legs.map(l => classifyVolatility(l)))
    const sideMix       = freqDist(legs.map(l => String(l.side || "").toLowerCase()))
    const gameIds       = new Set(legs.map(l => l.eventId || l.matchup).filter(Boolean))

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO slip_outcomes (
        id, run_date, sport, tier, leg_count,
        stat_family_mix, volatility_mix, side_mix, game_count,
        combined_dec, combined_model,
        legs_hit, result, payout_dec, settled_at,
        leg_results_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      safeStr(slip.id),
      safeStr(opts.date) ?? slip.run_date ?? null,
      safeStr(opts.sport) ?? slip.sport ?? null,
      safeStr(slip.tier),
      legs.length,
      JSON.stringify(statFamilyMix),
      JSON.stringify(volatilityMix),
      JSON.stringify(sideMix),
      gameIds.size,
      safeNum(slip.combinedDecimalOdds),
      safeNum(slip.combinedModelProb),
      safeNum(result.legsHit),
      safeStr(result.result) || "pending",
      safeNum(result.payoutDec),
      safeStr(result.settledAt),
      result.legResults ? JSON.stringify(result.legResults) : null,
      JSON.stringify(slip)
    )

    return true
  } catch (err) {
    console.warn("[intelligence] recordSlipOutcome error:", err.message)
    return false
  }
}

// ── Read: delta / calibration analysis ───────────────────────────────────────

/**
 * Delta summary: aggregate calibration error grouped by a dimension.
 *
 * Returns rows of: { group_key, total, hits, misses, hit_rate, avg_model_prob,
 *                    avg_delta_prob, avg_edge, avg_clv }
 *
 * avg_delta_prob near 0 = well-calibrated.
 * avg_delta_prob > 0   = systematically overconfident (model predicts higher than reality).
 * avg_delta_prob < 0   = systematically underconfident.
 *
 * @param {object} opts
 * @param {string} opts.sport
 * @param {string} opts.fromDate  — YYYY-MM-DD
 * @param {string} opts.toDate    — YYYY-MM-DD
 * @param {string} [opts.groupBy] — 'stat_family' | 'volatility' | 'tier' | 'ecology_bucket' | 'side' (default: stat_family)
 *
 * @returns {object[] | null}
 */
function getDeltaSummary(opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db) return null

    const groupBy  = opts.groupBy || "stat_family"
    const allowed  = ["stat_family", "volatility", "tier", "ecology_bucket", "side", "player"]
    const col      = allowed.includes(groupBy) ? groupBy : "stat_family"

    return db.prepare(`
      SELECT
        ${col}                                               AS group_key,
        COUNT(*)                                             AS total,
        SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)            AS hits,
        SUM(CASE WHEN hit = 0 THEN 1 ELSE 0 END)            AS misses,
        ROUND(
          1.0 * SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)
               / NULLIF(SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END), 0),
          4
        )                                                    AS hit_rate,
        ROUND(AVG(model_prob), 4)                            AS avg_model_prob,
        ROUND(AVG(delta_prob), 4)                            AS avg_delta_prob,
        ROUND(AVG(edge), 4)                                  AS avg_edge,
        ROUND(AVG(clv), 4)                                   AS avg_clv
      FROM outcome_snapshots
      WHERE sport    = ?
        AND run_date >= ?
        AND run_date <= ?
        AND hit IS NOT NULL
      GROUP BY ${col}
      ORDER BY total DESC
    `).all(opts.sport || "mlb", opts.fromDate || "2020-01-01", opts.toDate || "2099-12-31")
  } catch (err) {
    console.warn("[intelligence] getDeltaSummary error:", err.message)
    return null
  }
}

/**
 * Calibration buckets: model_prob deciles vs actual hit rates.
 * Reveals whether model confidence tracks actual win rates.
 *
 * Ideal calibration: each bucket's hit_rate ≈ its avg_model_prob.
 * Over-prediction bucket: hit_rate < avg_model_prob (model too confident).
 * Under-prediction bucket: hit_rate > avg_model_prob (model too conservative).
 *
 * @param {object} opts — { sport, fromDate, toDate }
 * @returns {object[] | null}  rows: { bucket, avg_model_prob, hit_rate, total }
 */
function getCalibrationBuckets(opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db) return null

    return db.prepare(`
      SELECT
        CAST(ROUND(model_prob * 10) AS INTEGER) AS bucket,
        ROUND(AVG(model_prob), 4)               AS avg_model_prob,
        ROUND(
          1.0 * SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)
               / NULLIF(COUNT(*), 0),
          4
        )                                       AS hit_rate,
        COUNT(*)                                AS total
      FROM outcome_snapshots
      WHERE sport    = ?
        AND run_date >= ?
        AND run_date <= ?
        AND hit IS NOT NULL
        AND model_prob IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `).all(opts.sport || "mlb", opts.fromDate || "2020-01-01", opts.toDate || "2099-12-31")
  } catch (err) {
    console.warn("[intelligence] getCalibrationBuckets error:", err.message)
    return null
  }
}

/**
 * Archetype performance: group by (volatility, tier) cross-tab.
 *
 * Answers: do ELITE lotto plays actually outperform PLAYABLE balanced plays?
 * Which volatility+tier combinations have the best calibrated returns?
 *
 * @param {object} opts — { sport, fromDate, toDate }
 * @returns {object[] | null}
 */
function getArchetypePerf(opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db) return null

    return db.prepare(`
      SELECT
        volatility,
        tier,
        COUNT(*)                                              AS total,
        SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)             AS hits,
        ROUND(
          1.0 * SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)
               / NULLIF(SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END), 0),
          4
        )                                                     AS hit_rate,
        ROUND(AVG(model_prob), 4)                             AS avg_model_prob,
        ROUND(AVG(delta_prob), 4)                             AS avg_delta_prob,
        ROUND(AVG(edge), 4)                                   AS avg_edge,
        ROUND(AVG(clv), 4)                                    AS avg_clv
      FROM outcome_snapshots
      WHERE sport    = ?
        AND run_date >= ?
        AND run_date <= ?
        AND hit IS NOT NULL
      GROUP BY volatility, tier
      ORDER BY total DESC
    `).all(opts.sport || "mlb", opts.fromDate || "2020-01-01", opts.toDate || "2099-12-31")
  } catch (err) {
    console.warn("[intelligence] getArchetypePerf error:", err.message)
    return null
  }
}

/**
 * Stat family miss analysis.
 *
 * Identifies which prop types the model systematically over- or under-predicts.
 * Sorted by avg_delta_prob descending — most overconfident stats first.
 *
 * Answers: "why did total bases unders keep hitting when the model was
 *           predicting balanced probabilities?"
 *
 * @param {object} opts — { sport, fromDate, toDate, minSamples }
 * @returns {object[] | null}
 */
function getStatFamilyMisses(opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db) return null

    const minSamples = safeNum(opts.minSamples) || 10

    return db.prepare(`
      SELECT
        stat_family,
        side,
        COUNT(*)                                              AS total,
        SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)             AS hits,
        ROUND(
          1.0 * SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)
               / NULLIF(SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END), 0),
          4
        )                                                     AS hit_rate,
        ROUND(AVG(model_prob), 4)                             AS avg_model_prob,
        ROUND(AVG(delta_prob), 4)                             AS avg_delta_prob,
        ROUND(AVG(edge), 4)                                   AS avg_edge
      FROM outcome_snapshots
      WHERE sport    = ?
        AND run_date >= ?
        AND run_date <= ?
        AND hit IS NOT NULL
      GROUP BY stat_family, side
      HAVING total >= ?
      ORDER BY avg_delta_prob DESC
    `).all(
      opts.sport || "mlb",
      opts.fromDate || "2020-01-01",
      opts.toDate   || "2099-12-31",
      minSamples
    )
  } catch (err) {
    console.warn("[intelligence] getStatFamilyMisses error:", err.message)
    return null
  }
}

/**
 * Ecology history: pool diversity trends over time.
 *
 * Shows how the candidate pool composition evolves across dates.
 * Useful for detecting if ecology fixes are holding or drifting.
 *
 * @param {object} opts — { sport, fromDate, toDate }
 * @returns {object[] | null}
 */
function getEcologyHistory(opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db) return null

    return db.prepare(`
      SELECT
        run_date,
        sport,
        candidate_count,
        over_count,
        under_count,
        ROUND(1.0 * over_count / NULLIF(candidate_count, 0), 3) AS over_fraction,
        safe_count,
        balanced_count,
        aggressive_count,
        lotto_count,
        slip_count,
        slip_by_tier,
        ROUND(entropy, 4)                                        AS entropy
      FROM ecology_snapshots
      WHERE sport    = ?
        AND run_date >= ?
        AND run_date <= ?
      ORDER BY run_date ASC
    `).all(opts.sport || "mlb", opts.fromDate || "2020-01-01", opts.toDate || "2099-12-31")
  } catch (err) {
    console.warn("[intelligence] getEcologyHistory error:", err.message)
    return null
  }
}

/**
 * Slip performance by tier and structure.
 *
 * Groups by tier + leg_count to reveal which slip architectures perform best.
 * E.g. "do 3-leg lotto slips outperform 4-leg lotto slips long-term?"
 *
 * @param {object} opts — { sport, fromDate, toDate }
 * @returns {object[] | null}
 */
function getSlipPerformance(opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db) return null

    return db.prepare(`
      SELECT
        tier,
        leg_count,
        COUNT(*)                                              AS total,
        SUM(CASE WHEN result = 'win'  THEN 1 ELSE 0 END)     AS wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END)     AS losses,
        ROUND(
          1.0 * SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END)
               / NULLIF(SUM(CASE WHEN result != 'pending' THEN 1 ELSE 0 END), 0),
          4
        )                                                     AS win_rate,
        ROUND(AVG(combined_dec), 2)                          AS avg_dec_odds,
        ROUND(AVG(combined_model), 4)                        AS avg_model_prob,
        ROUND(AVG(game_count), 2)                            AS avg_games
      FROM slip_outcomes
      WHERE sport    = ?
        AND run_date >= ?
        AND run_date <= ?
        AND result != 'pending'
      GROUP BY tier, leg_count
      ORDER BY tier, leg_count
    `).all(opts.sport || "mlb", opts.fromDate || "2020-01-01", opts.toDate || "2099-12-31")
  } catch (err) {
    console.warn("[intelligence] getSlipPerformance error:", err.message)
    return null
  }
}

/**
 * Player-level intelligence: how a specific player's props perform over time.
 *
 * Answers: "Is Ohtani runs-under a consistently reliable prop?
 *           Does the model systematically underestimate Trout?"
 *
 * @param {object} opts — { player, sport, fromDate, toDate }
 * @returns {object[] | null}
 */
function getPlayerIntelligence(opts = {}) {
  try {
    ensureSchema()
    const db = tryGetDb()
    if (!db || !opts.player) return null

    return db.prepare(`
      SELECT
        stat_family,
        side,
        COUNT(*)                                              AS total,
        SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)             AS hits,
        ROUND(
          1.0 * SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END)
               / NULLIF(SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END), 0),
          4
        )                                                     AS hit_rate,
        ROUND(AVG(model_prob), 4)                             AS avg_model_prob,
        ROUND(AVG(delta_prob), 4)                             AS avg_delta_prob,
        ROUND(AVG(edge), 4)                                   AS avg_edge,
        ROUND(AVG(clv), 4)                                    AS avg_clv
      FROM outcome_snapshots
      WHERE lower(player) = lower(?)
        AND sport    = ?
        AND run_date >= ?
        AND run_date <= ?
        AND hit IS NOT NULL
      GROUP BY stat_family, side
      ORDER BY total DESC
    `).all(
      opts.player,
      opts.sport    || "mlb",
      opts.fromDate || "2020-01-01",
      opts.toDate   || "2099-12-31"
    )
  } catch (err) {
    console.warn("[intelligence] getPlayerIntelligence error:", err.message)
    return null
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Write
  snapshotPredictions,
  snapshotEcology,
  recordOutcome,
  recordOutcomes,
  recordSlipOutcome,

  // Read / Analysis
  getDeltaSummary,
  getCalibrationBuckets,
  getArchetypePerf,
  getStatFamilyMisses,
  getEcologyHistory,
  getSlipPerformance,
  getPlayerIntelligence,

  // Utilities (exported for testing / external use)
  predictionId,
  shannonEntropy,
  normalizeCandidate,
  // Phase E1 — composite-key canonicalization helpers (exported for fixture)
  normPlayer,
  normFam,
  normBook,
  getCanonicalizationDiagnostics,
  resetCanonicalizationDiagnostics,
}
