"use strict"

/**
 * SQLite schema — Phase 1 + Screenshot Intelligence Layer (Phase U)
 *
 * Tables mirror the flat JSON tracking files in backend/runtime/tracking/.
 * JSON files remain CANONICAL. SQLite is additive — analytics + history only.
 *
 * Table map (Phase 1):
 *   tracked_props   ← mlb_tracked_bets_*.json + nba_tracked_bets_*.json
 *   hr_predictions  ← tracked_props_*.json + graded_props_*.json
 *   slip_catalog    ← mlb_tracked_slips_*.json + nba_tracked_slips_*.json
 *   nightly_runs    ← populated by importHistoricalData.js, future: nightly runners
 *   personal_ledger ← personal_ledger.json (added Session S)
 *
 * Table map (Screenshot Intelligence — Phase U):
 *   screenshot_submissions ← screenshot ingestion events
 *   parsed_slips           ← normalized slip extraction
 *   slip_classifications   ← 10-dimension scored output + archetypes
 *   bettor_profiles        ← longitudinal bettor model
 *   outcome_links          ← per-leg grading linkage
 *
 * applySchema() calls applyScreenshotSchema() automatically — both schemas
 * are applied together whenever the DB is initialized.
 */

const { applyScreenshotSchema } = require("./screenshotSchema")

const DDL = `

-- ─────────────────────────────────────────────────────────────────────────────
-- tracked_props
-- Source: mlb_tracked_bets_*.json, nba_tracked_bets_*.json
-- Shape:  one row per scored prop candidate per nightly run
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_props (
  id              TEXT    PRIMARY KEY,   -- from JSON .id field (stable composite key)
  run_date        TEXT    NOT NULL,      -- YYYY-MM-DD
  sport           TEXT    NOT NULL,      -- 'mlb' or 'nba'
  player          TEXT,
  event_id        TEXT,
  matchup         TEXT,
  stat_family     TEXT,
  side            TEXT,                  -- 'over' or 'under'
  line            REAL,
  odds            INTEGER,               -- American odds
  sportsbook      TEXT,
  model_prob      REAL,                  -- model-predicted probability
  implied_prob    REAL,                  -- market-implied probability
  edge            REAL,                  -- model_prob - implied_prob
  confidence      REAL,
  tier            TEXT,                  -- ELITE / STRONG / PLAYABLE / VALUE / BASE
  result          TEXT    DEFAULT 'pending',  -- pending / win / loss / push / void
  settled_at      TEXT,                  -- ISO timestamp when settled
  raw_json        TEXT,                  -- full source row as JSON (forward compat)
  imported_at     TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tp_run_date   ON tracked_props (run_date);
CREATE INDEX IF NOT EXISTS idx_tp_player     ON tracked_props (player);
CREATE INDEX IF NOT EXISTS idx_tp_sport      ON tracked_props (sport);
CREATE INDEX IF NOT EXISTS idx_tp_stat       ON tracked_props (stat_family);
CREATE INDEX IF NOT EXISTS idx_tp_tier       ON tracked_props (tier);
CREATE INDEX IF NOT EXISTS idx_tp_result     ON tracked_props (result);
CREATE INDEX IF NOT EXISTS idx_tp_edge       ON tracked_props (edge);


-- ─────────────────────────────────────────────────────────────────────────────
-- hr_predictions
-- Source: tracked_props_*.json, graded_props_*.json
-- Shape:  HR/TB/RBI prediction candidates with scoring signals + results
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_predictions (
  id              TEXT    PRIMARY KEY,   -- synthetic: run_date|player|eventId
  run_date        TEXT    NOT NULL,      -- YYYY-MM-DD
  player          TEXT,
  team            TEXT,
  event_id        TEXT,
  odds            INTEGER,               -- American odds
  hr_score        REAL,                  -- composite HR model score
  power_score     REAL,                  -- power component
  weather_adj     REAL,                  -- weather adjustment
  park_factor     REAL,                  -- ballpark factor
  tag             TEXT,                  -- ELITE / STRONG / VALUE
  result          TEXT,                  -- HIT / MISS / pending
  timestamp       TEXT,                  -- source ISO timestamp
  raw_json        TEXT,
  imported_at     TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hr_run_date   ON hr_predictions (run_date);
CREATE INDEX IF NOT EXISTS idx_hr_player     ON hr_predictions (player);
CREATE INDEX IF NOT EXISTS idx_hr_tag        ON hr_predictions (tag);
CREATE INDEX IF NOT EXISTS idx_hr_result     ON hr_predictions (result);


-- ─────────────────────────────────────────────────────────────────────────────
-- slip_catalog
-- Source: mlb_tracked_slips_*.json, nba_tracked_slips_*.json
-- Shape:  one row per AI-generated slip per nightly run
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slip_catalog (
  id                  TEXT  PRIMARY KEY, -- from JSON .id field
  run_date            TEXT  NOT NULL,
  sport               TEXT  NOT NULL,    -- 'mlb' or 'nba'
  tier                TEXT  NOT NULL,    -- SAFE / BALANCED / AGGRESSIVE / LOTTO
  leg_count           INTEGER,
  legs_json           TEXT,              -- JSON array of leg objects
  combined_odds       INTEGER,           -- American odds
  combined_model_prob REAL,
  combined_implied    REAL,
  edge                REAL,
  ev                  REAL,
  result              TEXT  DEFAULT 'pending',
  settled_at          TEXT,
  raw_json            TEXT,
  imported_at         TEXT  DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sc_run_date   ON slip_catalog (run_date);
CREATE INDEX IF NOT EXISTS idx_sc_sport      ON slip_catalog (sport);
CREATE INDEX IF NOT EXISTS idx_sc_tier       ON slip_catalog (tier);
CREATE INDEX IF NOT EXISTS idx_sc_result     ON slip_catalog (result);
CREATE INDEX IF NOT EXISTS idx_sc_ev         ON slip_catalog (ev);


-- ─────────────────────────────────────────────────────────────────────────────
-- nightly_runs
-- Source: populated by importHistoricalData.js + future nightly runner hooks
-- Shape:  one row per pipeline execution (for run-level analytics)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nightly_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date        TEXT    NOT NULL,
  sport           TEXT    NOT NULL,      -- 'mlb' or 'nba'
  run_type        TEXT    NOT NULL,      -- 'mlb_night' / 'nba_night' / 'import' / 'backfill'
  candidate_count INTEGER DEFAULT 0,
  slip_count      INTEGER DEFAULT 0,
  best_count      INTEGER DEFAULT 0,
  hr_count        INTEGER DEFAULT 0,
  notes           TEXT,
  created_at      TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nr_run_date   ON nightly_runs (run_date);
CREATE INDEX IF NOT EXISTS idx_nr_sport      ON nightly_runs (sport);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nr_unique ON nightly_runs (run_date, sport, run_type);


-- ─────────────────────────────────────────────────────────────────────────────
-- personal_ledger
-- Source: backend/runtime/tracking/personal_ledger.json → bets[]
-- Shape:  one row per personal bet (mirror of the JSON bets array)
--
-- JSON remains CANONICAL for reads. This table is:
--   (a) a durable write-through mirror — written atomically on every saveLedger()
--   (b) the future primary store once one nightly run verifies end-to-end
--
-- Concurrency note: SQLite WAL mode + single-writer (Node process) is safe.
-- The JSON file uses atomic rename; the DB write is transactional — both
-- operations succeed or both are skipped.
--
-- ID: from personal bet stableId() — deterministic composite hash + timestamp suffix.
--     INSERT OR REPLACE used so re-imports and updates are idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal_ledger (
  id                TEXT    PRIMARY KEY,
  date              TEXT    NOT NULL,      -- YYYY-MM-DD
  sport             TEXT,                  -- mlb / nba / nfl / nhl
  sportsbook        TEXT,
  bet_type          TEXT    DEFAULT 'single',  -- single | slip
  player            TEXT,
  team              TEXT,
  event_id          TEXT,
  matchup           TEXT,
  opponent          TEXT,
  stat_family       TEXT,
  prop              TEXT,
  side              TEXT,                  -- over / under
  line              REAL,
  odds              INTEGER,               -- American odds
  stake             REAL,
  to_win            REAL,
  implied_prob      REAL,
  model_line        REAL,
  model_odds        INTEGER,
  model_prob        REAL,
  model_tier        TEXT,
  decision_type     TEXT,                  -- followed / modified / ignored / custom
  aggression_delta  REAL,
  confidence_tier   TEXT,
  actual_stat       REAL,
  result            TEXT    DEFAULT 'pending',  -- pending / win / loss / push / void
  payout            REAL,
  cashout           REAL,
  settled_at        TEXT,
  note              TEXT,
  clv_score         REAL,                  -- from clvSnapshot.clv.clvScore (null until close set)
  clv_quality       TEXT,                  -- from clvSnapshot.clv.quality
  integrity_valid   INTEGER DEFAULT 1,     -- 1 = passed integrity gate
  raw_json          TEXT,                  -- full bet object as JSON (forward compat)
  imported_at       TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pl_date       ON personal_ledger (date);
CREATE INDEX IF NOT EXISTS idx_pl_sport      ON personal_ledger (sport);
CREATE INDEX IF NOT EXISTS idx_pl_player     ON personal_ledger (player);
CREATE INDEX IF NOT EXISTS idx_pl_stat       ON personal_ledger (stat_family);
CREATE INDEX IF NOT EXISTS idx_pl_result     ON personal_ledger (result);
CREATE INDEX IF NOT EXISTS idx_pl_decision   ON personal_ledger (decision_type);
CREATE INDEX IF NOT EXISTS idx_pl_sportsbook ON personal_ledger (sportsbook);
CREATE INDEX IF NOT EXISTS idx_pl_tier       ON personal_ledger (confidence_tier);

`

/**
 * Apply schema to an open DatabaseSync instance.
 * Safe to call multiple times — all statements use CREATE IF NOT EXISTS.
 * Also applies the Screenshot Intelligence schema (Phase U tables).
 *
 * @param {DatabaseSync} db
 */
function applySchema(db) {
  db.exec(DDL)
  applyScreenshotSchema(db)
}

module.exports = { applySchema, DDL }
