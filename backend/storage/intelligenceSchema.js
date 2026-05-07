"use strict"

/**
 * SQLite schema — Intelligence Layer
 *
 * Additive to Phase 1 schema (schema.js). Never modifies existing tables.
 * Apply via applyIntelligenceSchema(db) — safe to call multiple times.
 *
 * Purpose: longitudinal prediction-vs-reality tracking across all sports.
 * JSON files in backend/runtime/tracking/ remain canonical for runtime.
 * This layer is analytics + postmortem intelligence only.
 *
 * Table map:
 *   prediction_snapshots  — immutable record of what the model predicted
 *   outcome_snapshots     — actual results + delta vs prediction
 *   slip_outcomes         — enriched slip result tracking
 *   ecology_snapshots     — pool composition per nightly run
 *
 * Cross-sport: all tables carry a `sport` column. No sport-specific branching.
 * Forward-compat: every table carries `raw_json` for schema-agnostic evolution.
 */

const DDL = `

-- ─────────────────────────────────────────────────────────────────────────────
-- prediction_snapshots
--
-- One row per candidate at generation time. IMMUTABLE after write.
-- Records the full model view at the moment the system decided to surface
-- this candidate — odds, edge, modelProb, volatility, tier, ecology bucket.
--
-- This is the "left side" of prediction-vs-reality. outcome_snapshots is
-- the "right side". Delta analysis joins across them on id.
--
-- ID is a deterministic composite: run_date|sport|player_lower|stat_family|side|line|book
-- INSERT OR IGNORE — re-running a pipeline never overwrites a prior snapshot.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id               TEXT    PRIMARY KEY,
  run_date         TEXT    NOT NULL,      -- YYYY-MM-DD
  sport            TEXT    NOT NULL,      -- mlb / nba / nfl / nhl (future)
  player           TEXT,
  team             TEXT,
  event_id         TEXT,
  matchup          TEXT,
  stat_family      TEXT,                  -- normalized family: totalbases, hits, runs, threes, etc.
  side             TEXT,                  -- over / under
  line             REAL,
  odds             INTEGER,               -- American odds at generation time
  model_prob       REAL,                  -- predicted probability at generation time
  implied_prob     REAL,                  -- market-implied probability at generation time
  edge             REAL,                  -- model_prob - implied_prob
  confidence       REAL,                  -- calibrated confidence (if present)
  tier             TEXT,                  -- ELITE / STRONG / PLAYABLE / VALUE / BASE
  volatility       TEXT,                  -- safe / balanced / aggressive / lotto
  ecology_bucket   TEXT,                  -- anchors / tonightsBest / smartAggression / safest / aiSlip / pool
  sportsbook       TEXT,
  archetype        TEXT,                  -- archetype tag (offensive_over, etc.) if present
  composite_score  REAL,                  -- featured composite score at generation time
  slip_tiers       TEXT,                  -- JSON array: which slip tiers this leg appeared in
  raw_json         TEXT,                  -- full source candidate as JSON
  created_at       TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ps_run_date   ON prediction_snapshots (run_date);
CREATE INDEX IF NOT EXISTS idx_ps_sport      ON prediction_snapshots (sport);
CREATE INDEX IF NOT EXISTS idx_ps_player     ON prediction_snapshots (player);
CREATE INDEX IF NOT EXISTS idx_ps_stat       ON prediction_snapshots (stat_family);
CREATE INDEX IF NOT EXISTS idx_ps_tier       ON prediction_snapshots (tier);
CREATE INDEX IF NOT EXISTS idx_ps_volatility ON prediction_snapshots (volatility);
CREATE INDEX IF NOT EXISTS idx_ps_side       ON prediction_snapshots (side);
CREATE INDEX IF NOT EXISTS idx_ps_ecology    ON prediction_snapshots (ecology_bucket);


-- ─────────────────────────────────────────────────────────────────────────────
-- outcome_snapshots
--
-- One row per settled prediction. Links to prediction_snapshots via id.
-- Captures actual result + delta vs model prediction.
--
-- delta_prob = model_prob - actual_hit (1.0 or 0.0)
--   Positive delta → model overconfident (predicted too high, result missed)
--   Negative delta → model underconfident (predicted too low, result hit)
--   Avg delta near 0 across many predictions → well-calibrated model
--
-- clv (closing line value) = signed value of beating the closing market:
--   Positive CLV = bet was at better odds than closing line (process edge)
--   Negative CLV = bet was at worse odds than closing line (market moved away)
--
-- Populated by buildPostGameReview.js or a settlement integration.
-- Uses INSERT OR REPLACE so outcome can be corrected if result changes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outcome_snapshots (
  id               TEXT    PRIMARY KEY,   -- same as prediction_snapshots.id
  run_date         TEXT    NOT NULL,
  sport            TEXT    NOT NULL,
  player           TEXT,
  stat_family      TEXT,
  side             TEXT,
  line             REAL,
  model_prob       REAL,                  -- from prediction_snapshots
  implied_prob     REAL,                  -- from prediction_snapshots
  edge             REAL,                  -- from prediction_snapshots
  tier             TEXT,
  volatility       TEXT,
  ecology_bucket   TEXT,
  actual_value     REAL,                  -- actual stat result (e.g. 2.0 hits, 1 HR, 22 points)
  hit              INTEGER,               -- 1 = won, 0 = lost, NULL = pending / void / push
  delta_prob       REAL,                  -- model_prob - hit (calibration error for this prediction)
  clv              REAL,                  -- closing line value (positive = beat the close)
  closing_odds     INTEGER,               -- American odds at market close
  settled_at       TEXT,                  -- ISO timestamp of settlement
  notes            TEXT,                  -- e.g. "player scratched", "game cancelled"
  raw_json         TEXT,
  created_at       TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_os_run_date   ON outcome_snapshots (run_date);
CREATE INDEX IF NOT EXISTS idx_os_sport      ON outcome_snapshots (sport);
CREATE INDEX IF NOT EXISTS idx_os_player     ON outcome_snapshots (player);
CREATE INDEX IF NOT EXISTS idx_os_stat       ON outcome_snapshots (stat_family);
CREATE INDEX IF NOT EXISTS idx_os_tier       ON outcome_snapshots (tier);
CREATE INDEX IF NOT EXISTS idx_os_volatility ON outcome_snapshots (volatility);
CREATE INDEX IF NOT EXISTS idx_os_hit        ON outcome_snapshots (hit);


-- ─────────────────────────────────────────────────────────────────────────────
-- slip_outcomes
--
-- One row per AI-generated slip after settlement.
-- Enriched beyond slip_catalog: captures ecology metadata (stat-family mix,
-- volatility mix, side mix, game concentration) for slip-structure analysis.
--
-- Answers: which slip architectures survive long-term?
-- Which volatility mixes produce positive EV?
-- Do lotto slips with 3+ offensive overs outperform balanced 4-leggers?
--
-- leg_results_json: JSON array of { legId, player, stat, side, hit: 0|1 }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slip_outcomes (
  id               TEXT    PRIMARY KEY,   -- from slip_catalog.id
  run_date         TEXT    NOT NULL,
  sport            TEXT    NOT NULL,
  tier             TEXT,                  -- SAFE / BALANCED / AGGRESSIVE / LOTTO
  leg_count        INTEGER,
  stat_family_mix  TEXT,                  -- JSON: { "totalbases": 2, "runs": 1, "homeruns": 1 }
  volatility_mix   TEXT,                  -- JSON: { "balanced": 1, "lotto": 2 }
  side_mix         TEXT,                  -- JSON: { "over": 3, "under": 1 }
  game_count       INTEGER,               -- distinct games in this slip
  combined_dec     REAL,                  -- combined decimal odds
  combined_model   REAL,                  -- product of model probs (combined parlay probability)
  legs_hit         INTEGER,               -- how many legs won (NULL if pending)
  result           TEXT    DEFAULT 'pending',  -- win / loss / partial / pending / void
  payout_dec       REAL,                  -- combined_dec if win, 0 if loss
  settled_at       TEXT,
  leg_results_json TEXT,                  -- JSON array of per-leg outcomes
  raw_json         TEXT,
  created_at       TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_so_run_date   ON slip_outcomes (run_date);
CREATE INDEX IF NOT EXISTS idx_so_sport      ON slip_outcomes (sport);
CREATE INDEX IF NOT EXISTS idx_so_tier       ON slip_outcomes (tier);
CREATE INDEX IF NOT EXISTS idx_so_result     ON slip_outcomes (result);


-- ─────────────────────────────────────────────────────────────────────────────
-- ecology_snapshots
--
-- One row per nightly run. Captures pool composition at generation time.
-- Answers: how did the candidate pool change over time?
-- Are we consistently over-exposed to a single stat? A single team?
-- Is portfolio entropy improving after ecology fixes?
--
-- entropy: Shannon entropy H = -Σ p(i)*log2(p(i)) over the stat distribution.
-- Higher entropy = more diverse, lower = more concentrated.
-- Perfect entropy for N stats = log2(N). Near-zero = one stat dominates.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecology_snapshots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date         TEXT    NOT NULL,
  sport            TEXT    NOT NULL,
  candidate_count  INTEGER DEFAULT 0,
  over_count       INTEGER DEFAULT 0,
  under_count      INTEGER DEFAULT 0,
  safe_count       INTEGER DEFAULT 0,
  balanced_count   INTEGER DEFAULT 0,
  aggressive_count INTEGER DEFAULT 0,
  lotto_count      INTEGER DEFAULT 0,
  stat_dist        TEXT,                  -- JSON: { "totalbases": 10, "hits": 8, ... }
  sportsbook_dist  TEXT,                  -- JSON: { "DraftKings": 25, "FanDuel": 18, ... }
  tier_dist        TEXT,                  -- JSON: { "ELITE": 5, "STRONG": 12, "PLAYABLE": 30 }
  slip_count       INTEGER DEFAULT 0,
  slip_by_tier     TEXT,                  -- JSON: { "safe": 3, "balanced": 4, "aggressive": 4, "lotto": 4 }
  entropy          REAL,                  -- Shannon entropy over stat distribution
  notes            TEXT,
  created_at       TEXT    DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eco_run  ON ecology_snapshots (run_date, sport);
CREATE        INDEX IF NOT EXISTS idx_eco_date ON ecology_snapshots (run_date);
CREATE        INDEX IF NOT EXISTS idx_eco_sport ON ecology_snapshots (sport);

`

/**
 * Apply the intelligence schema to an open DatabaseSync instance.
 * Safe to call multiple times — all statements use CREATE IF NOT EXISTS.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function applyIntelligenceSchema(db) {
  db.exec(DDL)
}

module.exports = { applyIntelligenceSchema, DDL }
