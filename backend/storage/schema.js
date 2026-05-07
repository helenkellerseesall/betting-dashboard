"use strict"

/**
 * SQLite schema — Phase 1
 *
 * Tables mirror the flat JSON tracking files in backend/runtime/tracking/.
 * JSON files remain CANONICAL. SQLite is additive — analytics + history only.
 *
 * Table map:
 *   tracked_props   ← mlb_tracked_bets_*.json + nba_tracked_bets_*.json
 *   hr_predictions  ← tracked_props_*.json + graded_props_*.json
 *   slip_catalog    ← mlb_tracked_slips_*.json + nba_tracked_slips_*.json
 *   nightly_runs    ← populated by importHistoricalData.js, future: nightly runners
 */

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

`

/**
 * Apply schema to an open DatabaseSync instance.
 * Safe to call multiple times — all statements use CREATE IF NOT EXISTS.
 *
 * @param {DatabaseSync} db
 */
function applySchema(db) {
  db.exec(DDL)
}

module.exports = { applySchema, DDL }
