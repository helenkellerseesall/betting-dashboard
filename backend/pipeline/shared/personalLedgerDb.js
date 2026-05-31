"use strict"

/**
 * personalLedgerDb.js — SQLite shadow of personal_ledger.json.
 *
 * Phase 1 of the JSON → SQLite migration (per ARCHITECTURAL_REVIEW Q1).
 * In Phase 1, JSON is canonical. SQLite is dual-written on every bet write
 * so we can verify parity for 48 hours before flipping reads (Phase 2).
 *
 * Safety:
 *   • All write methods are wrapped in try/catch in the caller; this module
 *     throws on errors so the dual-write site can decide what to do (log and
 *     continue, not fail the JSON write).
 *   • `SQLITE_DUAL_WRITE=0` env var disables dual-write entirely (rollback).
 *   • Schema is idempotent — safe to call ensureSchema() repeatedly.
 *
 * Schema design:
 *   bets table has every field a JSON entry could carry. Indexes target the
 *   queries we expect:
 *     - by id (primary key — addOrUpdateBet checks for existing)
 *     - by date (yesterday's bets, range queries)
 *     - by sport (NBA vs MLB filters)
 *     - by (decisionType, realMoney) (placed-bet lookup — the one that bit us)
 *
 *   `legs` and `clvSnapshot` and `modelSnapshot` are TEXT (JSON-serialized).
 *   We could normalize to a legs table but the join cost on a small ledger
 *   isn't worth it; TEXT-JSON is fine for our access patterns.
 */

const fs = require("fs")
const path = require("path")

let _db = null
let _ensured = false

const DB_PATH = path.join(__dirname, "..", "..", "runtime", "tracking", "personal_ledger.db")

function isEnabled() {
  return process.env.SQLITE_DUAL_WRITE !== "0"
}

function _open() {
  if (_db) return _db
  if (!isEnabled()) return null
  try {
    // Lazy require so this module can be loaded even when better-sqlite3 is missing.
    // The dual-write site catches the load failure and falls through gracefully.
    const Database = require("better-sqlite3")
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    _db = new Database(DB_PATH)
    _db.pragma("journal_mode = WAL")    // concurrent reads safe; one writer
    _db.pragma("synchronous = NORMAL")  // safe + 2-3x faster than FULL
    return _db
  } catch (e) {
    // Caller decides what to do — log and skip dual-write usually
    throw new Error(`personalLedgerDb open failed: ${e.message}`)
  }
}

function ensureSchema() {
  if (_ensured) return
  const db = _open()
  if (!db) return  // disabled
  db.exec(`
    CREATE TABLE IF NOT EXISTS bets (
      id              TEXT    PRIMARY KEY,
      date            TEXT,
      sport           TEXT,
      sportsbook      TEXT,
      betType         TEXT,
      player          TEXT,
      team            TEXT,
      eventId         TEXT,
      matchup         TEXT,
      statFamily      TEXT,
      prop            TEXT,
      side            TEXT,
      line            REAL,
      odds            REAL,
      oddsAmerican    REAL,
      stake           REAL,
      toWin           REAL,
      payout          REAL,
      modelProb       REAL,
      impliedProb     REAL,
      edge            REAL,
      confidence      REAL,
      tier            TEXT,
      result          TEXT,
      actualStat      REAL,
      settledAt       TEXT,
      placedAt        TEXT,
      decisionType    TEXT,
      realMoney       INTEGER,       -- SQLite: 0/1 instead of bool
      legs            TEXT,          -- JSON-serialized array
      modelSnapshot   TEXT,          -- JSON
      clvSnapshot     TEXT,          -- JSON
      notes           TEXT,
      restoredFrom    TEXT,
      raw             TEXT,          -- full JSON for fields not enumerated above (forward-compat)
      _updatedAt      TEXT NOT NULL  -- ISO timestamp of last write
    );
    CREATE INDEX IF NOT EXISTS idx_bets_date          ON bets (date);
    CREATE INDEX IF NOT EXISTS idx_bets_sport         ON bets (sport);
    CREATE INDEX IF NOT EXISTS idx_bets_placed        ON bets (decisionType, realMoney);
    CREATE INDEX IF NOT EXISTS idx_bets_sport_date    ON bets (sport, date);
    CREATE INDEX IF NOT EXISTS idx_bets_result        ON bets (result);
  `)
  _ensured = true
}

/**
 * Upsert a bet entry. The input is the canonical JSON-shape bet from
 * buildPersonalLedger.normalizeBet(). We flatten known fields onto columns
 * and stash the full object in `raw` for fields we don't enumerate.
 */
function upsertBet(bet) {
  const db = _open()
  if (!db) return  // disabled
  ensureSchema()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO bets (
      id, date, sport, sportsbook, betType, player, team, eventId, matchup,
      statFamily, prop, side, line, odds, oddsAmerican, stake, toWin, payout,
      modelProb, impliedProb, edge, confidence, tier, result, actualStat,
      settledAt, placedAt, decisionType, realMoney, legs, modelSnapshot,
      clvSnapshot, notes, restoredFrom, raw, _updatedAt
    ) VALUES (
      @id, @date, @sport, @sportsbook, @betType, @player, @team, @eventId, @matchup,
      @statFamily, @prop, @side, @line, @odds, @oddsAmerican, @stake, @toWin, @payout,
      @modelProb, @impliedProb, @edge, @confidence, @tier, @result, @actualStat,
      @settledAt, @placedAt, @decisionType, @realMoney, @legs, @modelSnapshot,
      @clvSnapshot, @notes, @restoredFrom, @raw, @_updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      date          = excluded.date,
      sport         = excluded.sport,
      sportsbook    = excluded.sportsbook,
      betType       = excluded.betType,
      player        = excluded.player,
      team          = excluded.team,
      eventId       = excluded.eventId,
      matchup       = excluded.matchup,
      statFamily    = excluded.statFamily,
      prop          = excluded.prop,
      side          = excluded.side,
      line          = excluded.line,
      odds          = excluded.odds,
      oddsAmerican  = excluded.oddsAmerican,
      stake         = excluded.stake,
      toWin         = excluded.toWin,
      payout        = excluded.payout,
      modelProb     = excluded.modelProb,
      impliedProb   = excluded.impliedProb,
      edge          = excluded.edge,
      confidence    = excluded.confidence,
      tier          = excluded.tier,
      result        = excluded.result,
      actualStat    = excluded.actualStat,
      settledAt     = excluded.settledAt,
      placedAt      = excluded.placedAt,
      decisionType  = excluded.decisionType,
      realMoney     = excluded.realMoney,
      legs          = excluded.legs,
      modelSnapshot = excluded.modelSnapshot,
      clvSnapshot   = excluded.clvSnapshot,
      notes         = excluded.notes,
      restoredFrom  = excluded.restoredFrom,
      raw           = excluded.raw,
      _updatedAt    = excluded._updatedAt
  `)
  const row = {
    id:           bet.id,
    date:         bet.date || null,
    sport:        bet.sport || null,
    sportsbook:   bet.sportsbook || null,
    betType:      bet.betType || null,
    player:       bet.player || null,
    team:         bet.team || null,
    eventId:      bet.eventId || null,
    matchup:      bet.matchup || null,
    statFamily:   bet.statFamily || null,
    prop:         bet.prop || null,
    side:         bet.side || null,
    line:         bet.line != null ? Number(bet.line) : null,
    odds:         bet.odds != null ? Number(bet.odds) : null,
    oddsAmerican: bet.oddsAmerican != null ? Number(bet.oddsAmerican) : null,
    stake:        bet.stake != null ? Number(bet.stake) : null,
    toWin:        bet.toWin != null ? Number(bet.toWin) : null,
    payout:       bet.payout != null ? Number(bet.payout) : null,
    modelProb:    bet.modelProb != null ? Number(bet.modelProb) : null,
    impliedProb:  bet.impliedProb != null ? Number(bet.impliedProb) : null,
    edge:         bet.edge != null ? Number(bet.edge) : null,
    confidence:   bet.confidence != null ? Number(bet.confidence) : null,
    tier:         bet.tier || null,
    result:       bet.result || null,
    actualStat:   bet.actualStat != null ? Number(bet.actualStat) : null,
    settledAt:    bet.settledAt || null,
    placedAt:     bet.placedAt || null,
    decisionType: bet.decisionType || null,
    realMoney:    bet.realMoney === true ? 1 : 0,
    legs:         bet.legs ? JSON.stringify(bet.legs) : null,
    modelSnapshot:bet.modelSnapshot ? JSON.stringify(bet.modelSnapshot) : null,
    clvSnapshot:  bet.clvSnapshot ? JSON.stringify(bet.clvSnapshot) : null,
    notes:        bet.notes || bet.note || null,
    restoredFrom: bet.restoredFrom || null,
    raw:          JSON.stringify(bet),
    _updatedAt:   now,
  }
  stmt.run(row)
}

/** Bulk upsert via a transaction — used by an optional sync/backfill. */
function upsertManyBets(bets) {
  const db = _open()
  if (!db || !Array.isArray(bets)) return 0
  ensureSchema()
  const insert = db.transaction((rows) => {
    for (const b of rows) upsertBet(b)
  })
  insert(bets)
  return bets.length
}

function getBetCount() {
  const db = _open()
  if (!db) return null
  ensureSchema()
  return db.prepare("SELECT COUNT(*) as n FROM bets").get().n
}

function getPlacedBets() {
  const db = _open()
  if (!db) return []
  ensureSchema()
  return db.prepare("SELECT * FROM bets WHERE decisionType = 'placed' OR realMoney = 1").all()
}

function getDbPath() { return DB_PATH }

function close() {
  if (_db) { try { _db.close() } catch {} ; _db = null; _ensured = false }
}

module.exports = {
  upsertBet,
  upsertManyBets,
  getBetCount,
  getPlacedBets,
  ensureSchema,
  getDbPath,
  close,
  isEnabled,
  DB_PATH,
}
