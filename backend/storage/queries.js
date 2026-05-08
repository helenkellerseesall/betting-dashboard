"use strict"

/**
 * SQLite insert helpers — Phase 1
 *
 * All inserts use INSERT OR IGNORE — safe to call multiple times on same data.
 * These functions accept the raw JSON shapes from tracking files directly.
 *
 * Every function accepts a DatabaseSync instance as first argument so callers
 * can batch multiple inserts in a single connection call.
 *
 * JSON runtime remains canonical. These are write-through mirrors.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function safeNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function safeStr(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

/** Infer run_date from a row — falls back to today if absent. */
function inferDate(row) {
  const d = row.date || row.slateDate || row.run_date || row.runDate
  if (d) return String(d).slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

/** Infer sport from file context or row fields. */
function inferSport(row, hintSport) {
  if (hintSport) return String(hintSport).toLowerCase()
  if (row.sport) return String(row.sport).toLowerCase()
  return "mlb"
}

// ─────────────────────────────────────────────────────────────────────────────
// insertTrackedProp(db, row, hintSport)
//
// Inserts one row from mlb_tracked_bets_*.json or nba_tracked_bets_*.json.
// Returns true on insert, false if already present (INSERT OR IGNORE).
// ─────────────────────────────────────────────────────────────────────────────
function insertTrackedProp(db, row, hintSport) {
  if (!row || !row.id) return false

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tracked_props (
      id, run_date, sport, player, event_id, matchup,
      stat_family, side, line, odds, sportsbook,
      model_prob, implied_prob, edge, confidence, tier,
      result, settled_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    safeStr(row.id),
    inferDate(row),
    inferSport(row, hintSport),
    safeStr(row.player),
    safeStr(row.eventId),
    safeStr(row.matchup),
    safeStr(row.statFamily || row.propType),
    safeStr(row.side),
    safeNum(row.line),
    safeNum(row.oddsAmerican || row.odds),
    safeStr(row.sportsbook || row.book),
    safeNum(row.modelProb || row.predictedProbability),
    safeNum(row.impliedProb),
    safeNum(row.edge || row.edgeProbability),
    safeNum(row.confidence),
    safeStr(row.tier),
    safeStr(row.result) || "pending",
    safeStr(row.settledAt),
    JSON.stringify(row)
  )

  return result.changes > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// insertManyTrackedProps(db, rows, hintSport)
//
// Batch insert array of tracked prop rows.
// Wraps in a transaction for performance.
// Returns { inserted, skipped } counts.
// ─────────────────────────────────────────────────────────────────────────────
function insertManyTrackedProps(db, rows, hintSport) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0, skipped: 0 }

  let inserted = 0
  let skipped  = 0

  db.exec("BEGIN")
  try {
    for (const row of rows) {
      const ok = insertTrackedProp(db, row, hintSport)
      if (ok) inserted++
      else skipped++
    }
    db.exec("COMMIT")
  } catch (err) {
    try { db.exec("ROLLBACK") } catch (_) {}
    console.warn("[queries] insertManyTrackedProps error:", err.message)
  }

  return { inserted, skipped }
}

// ─────────────────────────────────────────────────────────────────────────────
// insertHrPrediction(db, row, runDate)
//
// Inserts one row from tracked_props_*.json or graded_props_*.json.
// These files use the HR prediction format (hrScore, powerScore, tag, result).
// ─────────────────────────────────────────────────────────────────────────────
function insertHrPrediction(db, row, runDate) {
  if (!row || !row.player) return false

  // Synthetic stable ID: date|player|eventId
  const id = [
    runDate || inferDate(row),
    String(row.player || "").toLowerCase().trim(),
    String(row.eventId || "").trim()
  ].join("|")

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO hr_predictions (
      id, run_date, player, team, event_id,
      odds, hr_score, power_score, weather_adj, park_factor,
      tag, result, timestamp, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    id,
    runDate || inferDate(row),
    safeStr(row.player),
    safeStr(row.team),
    safeStr(row.eventId),
    safeNum(row.odds),
    safeNum(row.hrScore),
    safeNum(row.powerScore),
    safeNum(row.weather),
    safeNum(row.park),
    safeStr(row.tag),
    safeStr(row.result) || "pending",
    safeStr(row.timestamp),
    JSON.stringify(row)
  )

  return result.changes > 0
}

function insertManyHrPredictions(db, rows, runDate) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0, skipped: 0 }

  let inserted = 0
  let skipped  = 0

  db.exec("BEGIN")
  try {
    for (const row of rows) {
      const ok = insertHrPrediction(db, row, runDate)
      if (ok) inserted++
      else skipped++
    }
    db.exec("COMMIT")
  } catch (err) {
    try { db.exec("ROLLBACK") } catch (_) {}
    console.warn("[queries] insertManyHrPredictions error:", err.message)
  }

  return { inserted, skipped }
}

// ─────────────────────────────────────────────────────────────────────────────
// insertSlip(db, row, hintSport)
//
// Inserts one slip from mlb_tracked_slips_*.json or nba_tracked_slips_*.json.
// ─────────────────────────────────────────────────────────────────────────────
function insertSlip(db, row, hintSport) {
  if (!row || !row.id) return false

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO slip_catalog (
      id, run_date, sport, tier, leg_count, legs_json,
      combined_odds, combined_model_prob, combined_implied,
      edge, ev, result, settled_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    safeStr(row.id),
    inferDate(row),
    inferSport(row, hintSport),
    safeStr(row.type || row.tier),
    safeNum(row.legCount),
    JSON.stringify(row.legs || []),
    safeNum(row.combinedAmericanOdds),
    safeNum(row.combinedModelProb),
    safeNum(row.combinedImpliedProb),
    safeNum(row.edge),
    safeNum(row.ev),
    safeStr(row.result) || "pending",
    safeStr(row.settledAt),
    JSON.stringify(row)
  )

  return result.changes > 0
}

function insertManySlips(db, rows, hintSport) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0, skipped: 0 }

  let inserted = 0
  let skipped  = 0

  db.exec("BEGIN")
  try {
    for (const row of rows) {
      const ok = insertSlip(db, row, hintSport)
      if (ok) inserted++
      else skipped++
    }
    db.exec("COMMIT")
  } catch (err) {
    try { db.exec("ROLLBACK") } catch (_) {}
    console.warn("[queries] insertManySlips error:", err.message)
  }

  return { inserted, skipped }
}

// ─────────────────────────────────────────────────────────────────────────────
// recordNightlyRun(db, opts)
//
// Upsert a nightly_runs row.
// Uses INSERT OR REPLACE so repeated imports update counts.
// ─────────────────────────────────────────────────────────────────────────────
function recordNightlyRun(db, opts = {}) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO nightly_runs
      (run_date, sport, run_type, candidate_count, slip_count, best_count, hr_count, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    safeStr(opts.runDate),
    safeStr(opts.sport),
    safeStr(opts.runType) || "import",
    safeNum(opts.candidateCount) || 0,
    safeNum(opts.slipCount)      || 0,
    safeNum(opts.bestCount)      || 0,
    safeNum(opts.hrCount)        || 0,
    safeStr(opts.notes)
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple query helpers (read-only)
// ─────────────────────────────────────────────────────────────────────────────

/** All runs for a given date. */
function getRunsForDate(db, runDate) {
  return db.prepare("SELECT * FROM nightly_runs WHERE run_date = ? ORDER BY created_at").all(runDate)
}

/** All tracked props for a player across all dates. */
function getPropsForPlayer(db, player) {
  return db.prepare(
    "SELECT * FROM tracked_props WHERE lower(player) = lower(?) ORDER BY run_date DESC"
  ).all(player)
}

/** Aggregate stats: hit rate + avg edge by stat family for a sport/date range. */
function getStatFamilyStats(db, sport, fromDate, toDate) {
  return db.prepare(`
    SELECT
      stat_family,
      COUNT(*)                                   AS total,
      SUM(CASE WHEN result = 'win'  THEN 1 END)  AS wins,
      SUM(CASE WHEN result = 'loss' THEN 1 END)  AS losses,
      ROUND(AVG(edge), 4)                        AS avg_edge,
      ROUND(AVG(model_prob), 4)                  AS avg_model_prob
    FROM tracked_props
    WHERE sport     = ?
      AND run_date >= ?
      AND run_date <= ?
    GROUP BY stat_family
    ORDER BY total DESC
  `).all(sport, fromDate, toDate)
}

/** Slip performance by tier. */
function getSlipStatsByTier(db, sport, fromDate, toDate) {
  return db.prepare(`
    SELECT
      tier,
      COUNT(*)                                   AS total,
      SUM(CASE WHEN result = 'win'  THEN 1 END)  AS wins,
      SUM(CASE WHEN result = 'loss' THEN 1 END)  AS losses,
      ROUND(AVG(ev), 4)                          AS avg_ev,
      ROUND(AVG(edge), 4)                        AS avg_edge
    FROM slip_catalog
    WHERE sport     = ?
      AND run_date >= ?
      AND run_date <= ?
    GROUP BY tier
    ORDER BY total DESC
  `).all(sport, fromDate, toDate)
}

// ─────────────────────────────────────────────────────────────────────────────
// upsertLedgerBet(db, bet)
//
// INSERT OR REPLACE one personal_ledger bet row from a normalized bet object.
// Used by buildPersonalLedger.js on every saveLedger() call (write-through).
// Also used by importHistoricalData.js for the one-time backfill pass.
//
// Returns true on insert/replace, false on error.
// ─────────────────────────────────────────────────────────────────────────────
function upsertLedgerBet(db, bet) {
  if (!bet || !bet.id) return false

  const clvSnap = bet.clvSnapshot || {}
  const clvScore   = safeNum(clvSnap.clv?.clvScore)
  const clvQuality = safeStr(clvSnap.clv?.quality)

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO personal_ledger (
      id, date, sport, sportsbook, bet_type,
      player, team, event_id, matchup, opponent,
      stat_family, prop, side, line, odds,
      stake, to_win, implied_prob,
      model_line, model_odds, model_prob, model_tier,
      decision_type, aggression_delta, confidence_tier,
      actual_stat, result, payout, cashout, settled_at,
      note, clv_score, clv_quality, integrity_valid, raw_json
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `)

  try {
    stmt.run(
      safeStr(bet.id),
      safeStr(bet.date),
      safeStr(bet.sport),
      safeStr(bet.sportsbook),
      safeStr(bet.betType) || "single",
      safeStr(bet.player),
      safeStr(bet.team),
      safeStr(bet.eventId),
      safeStr(bet.matchup),
      safeStr(bet.opponent),
      safeStr(bet.statFamily),
      safeStr(bet.prop),
      safeStr(bet.side),
      safeNum(bet.line),
      safeNum(bet.odds),
      safeNum(bet.stake),
      safeNum(bet.toWin),
      safeNum(bet.impliedProb),
      safeNum(bet.modelLine),
      safeNum(bet.modelOdds),
      safeNum(bet.modelProb),
      safeStr(bet.modelTier),
      safeStr(bet.decisionType),
      safeNum(bet.aggressionDelta),
      safeStr(bet.confidenceTier),
      safeNum(bet.actualStat),
      safeStr(bet.result) || "pending",
      safeNum(bet.payout),
      safeNum(bet.cashout),
      safeStr(bet.settledAt),
      safeStr(bet.note),
      clvScore,
      clvQuality,
      bet.integrity?.valid === false ? 0 : 1,
      JSON.stringify(bet)
    )
    return true
  } catch (err) {
    console.warn("[queries] upsertLedgerBet error:", err.message)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// upsertManyLedgerBets(db, bets)
//
// Batch upsert an array of ledger bets inside a single transaction.
// Returns { upserted, errors } counts.
// ─────────────────────────────────────────────────────────────────────────────
function upsertManyLedgerBets(db, bets) {
  if (!Array.isArray(bets) || bets.length === 0) return { upserted: 0, errors: 0 }

  let upserted = 0
  let errors   = 0

  // node:sqlite uses exec("BEGIN/COMMIT") — no db.transaction() method
  db.exec("BEGIN")
  try {
    for (const bet of bets) {
      const ok = upsertLedgerBet(db, bet)
      if (ok) upserted++
      else errors++
    }
    db.exec("COMMIT")
  } catch (err) {
    try { db.exec("ROLLBACK") } catch (_) {}
    console.warn("[queries] upsertManyLedgerBets transaction error:", err.message)
  }

  return { upserted, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// getLedgerBets(db, opts)
//
// Simple read helper — returns bets matching optional filters.
// Primarily used for verification; runtime reads still use JSON.
// ─────────────────────────────────────────────────────────────────────────────
function getLedgerBets(db, opts = {}) {
  const conditions = []
  const params     = []

  if (opts.sport)  { conditions.push("sport = ?");  params.push(opts.sport) }
  if (opts.result) { conditions.push("result = ?"); params.push(opts.result) }
  if (opts.fromDate) { conditions.push("date >= ?"); params.push(opts.fromDate) }
  if (opts.toDate)   { conditions.push("date <= ?"); params.push(opts.toDate) }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : ""
  const limit = opts.limit ? `LIMIT ${parseInt(opts.limit, 10)}` : ""

  return db.prepare(
    `SELECT id, date, sport, player, stat_family, side, line, odds, result, clv_score
     FROM personal_ledger ${where} ORDER BY date DESC ${limit}`
  ).all(...params)
}

module.exports = {
  insertTrackedProp,
  insertManyTrackedProps,
  insertHrPrediction,
  insertManyHrPredictions,
  insertSlip,
  insertManySlips,
  recordNightlyRun,
  getRunsForDate,
  getPropsForPlayer,
  getStatFamilyStats,
  getSlipStatsByTier,
  upsertLedgerBet,
  upsertManyLedgerBets,
  getLedgerBets,
}
