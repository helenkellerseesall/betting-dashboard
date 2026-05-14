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


-- ─────────────────────────────────────────────────────────────────────────────
-- prediction_epochs (Session AZ — Frozen Prediction + Grading Architecture V1)
--
-- One row per snapshot-capture event. Groups together all prediction_snapshots
-- and frozen_contextual_states that were generated from the same coherent
-- snapshot lifecycle (i.e. between two successive replaceOddsSnapshot calls).
--
-- An epoch is the answer to the question:
--   "What did the system think at this moment in time?"
--
-- epoch_id is deterministic: snapshot_updated_at|sport|slate_date.
-- Re-deriving the same snapshot (same updatedAt) is idempotent — INSERT OR
-- IGNORE prevents duplicate epochs. New snapshot updatedAt → new epoch.
--
-- source distinguishes capture origin:
--   'workstation_state' = captured from /api/ws/state cache-miss (interactive)
--   'nightly'           = captured from runMlbNight.js / runNbaNight.js (batch)
--   'manual'            = test / probe / operator-driven freeze
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_epochs (
  epoch_id            TEXT    PRIMARY KEY,
  captured_at         TEXT    DEFAULT (datetime('now')),
  snapshot_updated_at TEXT,                    -- from oddsSnapshot.updatedAt (ISO)
  slate_date          TEXT    NOT NULL,        -- YYYY-MM-DD (Detroit-keyed)
  sport               TEXT    NOT NULL,        -- mlb / nba / etc
  source              TEXT,                    -- 'workstation_state' / 'nightly' / 'manual'
  prediction_count    INTEGER DEFAULT 0,       -- how many predictions in this epoch
  contextual_count    INTEGER DEFAULT 0,       -- how many had non-null contextual data
  slip_count          INTEGER DEFAULT 0,       -- how many slips associated with this epoch
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_pe_slate_date ON prediction_epochs (slate_date);
CREATE INDEX IF NOT EXISTS idx_pe_sport      ON prediction_epochs (sport);
CREATE INDEX IF NOT EXISTS idx_pe_captured   ON prediction_epochs (captured_at);
CREATE INDEX IF NOT EXISTS idx_pe_source     ON prediction_epochs (source);


-- ─────────────────────────────────────────────────────────────────────────────
-- frozen_contextual_states (Session AZ)
--
-- One row per prediction. Captures the full contextual reasoning state at the
-- moment that prediction was surfaced. Linked to prediction_snapshots via
-- prediction_id (PK), and to prediction_epochs via epoch_id.
--
-- Why a separate table:
--   prediction_snapshots was designed pre-AO/AP/AR/AS/AT/AV — it has columns
--   for tier/volatility/archetype but NOT for the contextual layers added in
--   Sessions AO–AV (matchup, recent_form, role, teammate, market, availability).
--   Adding 14 new columns to prediction_snapshots would risk breaking the
--   existing 241-row dataset and the 4 modules that read it. A side-table
--   keeps the existing schema untouched (additive architecture rule) while
--   making contextual state queryable.
--
-- raw_context_json carries forward-compat for any future contextual layer.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS frozen_contextual_states (
  -- Composite PK (defined at end of column list per SQLite syntax):
  -- same prediction observed in N epochs → N rows. This is the immutability
  -- guarantee: each epoch's contextual snapshot is preserved separately even
  -- if the underlying prediction (same line/book) was re-surfaced in a later
  -- epoch with a different context.
  prediction_id              TEXT    NOT NULL,      -- = prediction_snapshots.id
  epoch_id                   TEXT    NOT NULL,      -- = prediction_epochs.epoch_id
  -- Session AO — Matchup Intelligence
  matchup_score              REAL,
  matchup_shift              REAL,
  -- Session AP — Recent Form V1
  recent_form_z              REAL,
  recent_form_sample         INTEGER,
  recent_form_shift          REAL,
  -- Session AR — Role + Minutes
  starter_flag               INTEGER,               -- 0 / 1 / null
  projected_minutes          REAL,
  -- Session AS — Teammate Absence + Redistribution
  teammate_absent_count      INTEGER,
  teammate_redist_shift      REAL,
  -- Session AT — Market + News Adaptation
  market_consensus_implied   REAL,
  market_dispersion          REAL,
  market_book_count          INTEGER,
  market_shift               REAL,
  -- Session AV — Live Injury + Availability
  player_status              TEXT,                  -- active / questionable / out / etc
  availability_shift         REAL,
  -- Final composed model output (post-shift)
  final_model_prob           REAL,
  final_edge                 REAL,
  -- Forward-compat
  raw_context_json           TEXT,
  created_at                 TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (prediction_id, epoch_id)
);

CREATE INDEX IF NOT EXISTS idx_fcs_prediction     ON frozen_contextual_states (prediction_id);
CREATE INDEX IF NOT EXISTS idx_fcs_epoch          ON frozen_contextual_states (epoch_id);
CREATE INDEX IF NOT EXISTS idx_fcs_starter        ON frozen_contextual_states (starter_flag);
CREATE INDEX IF NOT EXISTS idx_fcs_status         ON frozen_contextual_states (player_status);
CREATE INDEX IF NOT EXISTS idx_fcs_market_shift   ON frozen_contextual_states (market_shift);
CREATE INDEX IF NOT EXISTS idx_fcs_avail_shift    ON frozen_contextual_states (availability_shift);


-- ─────────────────────────────────────────────────────────────────────────────
-- prediction_id_aliases (Phase Persistence-1B — 2026-05-14)
--
-- Composite-key forward-only bridge. Phase E1 introduced
-- normPlayer / normFam / canonicalBook backstops so prediction IDs are
-- byte-stable regardless of source-side spelling variations (diacritics,
-- sportsbook aliases, stat-family separators). Pre-E1 rows in
-- prediction_snapshots still carry their raw (pre-canonical) IDs because
-- historical writes were never rewritten (replay safety: Law 4).
--
-- This table maps a raw_id (as stored) to the canonical_id it would produce
-- if its raw_json source fields were re-run through current normalizers.
-- Rows are only written when raw_id != canonical_id — most predictions need
-- no alias and are absent from this table.
--
-- Use cases:
--   1. Grading reconciliation. When outcome_snapshots writers (Phase 1C)
--      backfill historical outcomes, they can join via aliases so post-E1
--      outcome IDs find pre-E1 predictions.
--   2. Longitudinal joins. Cohort queries across the E1 boundary can
--      LEFT JOIN prediction_id_aliases to dedupe diacritic/casing variants.
--   3. Replay safety. Replay never references this table directly — replay
--      paths use prediction_snapshots.id as source of truth. This table is
--      analytics-only, never on the freeze/grade hot path.
--
-- norm_diff_type captures which canonicalizer changed the bytes:
--   'player' / 'family' / 'book' / 'composite' (multiple categories)
--
-- Population:
--   Backfilled once via "npm run persistence:backfill-aliases"
--   (backend/scripts/backfillPredictionIdAliases.js). Idempotent -
--   re-running is a no-op (INSERT OR IGNORE on raw_id PK).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_id_aliases (
  raw_id          TEXT    PRIMARY KEY,        -- as stored in prediction_snapshots
  canonical_id    TEXT    NOT NULL,           -- what it would be under current normalizers
  detected_at     TEXT    DEFAULT (datetime('now')),
  norm_diff_type  TEXT,                       -- 'player' / 'family' / 'book' / 'composite'
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_pia_canonical ON prediction_id_aliases (canonical_id);
CREATE INDEX IF NOT EXISTS idx_pia_diff_type ON prediction_id_aliases (norm_diff_type);

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

/**
 * Session BB — Longitudinal Memory Completion Audit.
 *
 * Self-healing migration for the Session AZ tables only. Used by:
 *   - db.js getDb() boot diagnostic, when it observes the AZ tables missing
 *     after applySchema (defensive against module-cache staleness, partial
 *     DDL execution, or any future regression in the larger DDL string)
 *   - scripts/migrateLongitudinalMemory.js (one-shot operator script)
 *
 * Kept as an ISOLATED, self-contained DDL fragment intentionally:
 *   - It must not depend on any earlier statement in the main DDL succeeding
 *   - It must be cheap to call repeatedly (CREATE TABLE IF NOT EXISTS is a
 *     no-op when the table already exists)
 *   - It is a literal duplicate of the AZ-table portion of the main DDL —
 *     this duplication is INTENTIONAL: it ensures the AZ migration runs
 *     even if the main DDL string is somehow stale in a long-lived process
 */
const AZ_DDL = `
CREATE TABLE IF NOT EXISTS prediction_epochs (
  epoch_id            TEXT    PRIMARY KEY,
  captured_at         TEXT    DEFAULT (datetime('now')),
  snapshot_updated_at TEXT,
  slate_date          TEXT    NOT NULL,
  sport               TEXT    NOT NULL,
  source              TEXT,
  prediction_count    INTEGER DEFAULT 0,
  contextual_count    INTEGER DEFAULT 0,
  slip_count          INTEGER DEFAULT 0,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_pe_slate_date ON prediction_epochs (slate_date);
CREATE INDEX IF NOT EXISTS idx_pe_sport      ON prediction_epochs (sport);
CREATE INDEX IF NOT EXISTS idx_pe_captured   ON prediction_epochs (captured_at);
CREATE INDEX IF NOT EXISTS idx_pe_source     ON prediction_epochs (source);

CREATE TABLE IF NOT EXISTS frozen_contextual_states (
  prediction_id              TEXT    NOT NULL,
  epoch_id                   TEXT    NOT NULL,
  matchup_score              REAL,
  matchup_shift              REAL,
  recent_form_z              REAL,
  recent_form_sample         INTEGER,
  recent_form_shift          REAL,
  starter_flag               INTEGER,
  projected_minutes          REAL,
  teammate_absent_count      INTEGER,
  teammate_redist_shift      REAL,
  market_consensus_implied   REAL,
  market_dispersion          REAL,
  market_book_count          INTEGER,
  market_shift               REAL,
  player_status              TEXT,
  availability_shift         REAL,
  final_model_prob           REAL,
  final_edge                 REAL,
  raw_context_json           TEXT,
  created_at                 TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (prediction_id, epoch_id)
);

CREATE INDEX IF NOT EXISTS idx_fcs_prediction     ON frozen_contextual_states (prediction_id);
CREATE INDEX IF NOT EXISTS idx_fcs_epoch          ON frozen_contextual_states (epoch_id);
CREATE INDEX IF NOT EXISTS idx_fcs_starter        ON frozen_contextual_states (starter_flag);
CREATE INDEX IF NOT EXISTS idx_fcs_status         ON frozen_contextual_states (player_status);
CREATE INDEX IF NOT EXISTS idx_fcs_market_shift   ON frozen_contextual_states (market_shift);
CREATE INDEX IF NOT EXISTS idx_fcs_avail_shift    ON frozen_contextual_states (availability_shift);
`

/**
 * Idempotent self-healing migration that creates the Session AZ tables if
 * they are missing. Returns { created: string[], alreadyPresent: string[] }.
 * Never throws — returns { error } on failure.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function migrateAZTables(db) {
  try {
    const before = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    )
    const az = ["prediction_epochs", "frozen_contextual_states"]
    const alreadyPresent = az.filter(t => before.has(t))
    db.exec(AZ_DDL)
    const after = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    )
    const created = az.filter(t => !before.has(t) && after.has(t))
    return { created, alreadyPresent, error: null }
  } catch (err) {
    return { created: [], alreadyPresent: [], error: err?.message || String(err) }
  }
}

module.exports = { applyIntelligenceSchema, migrateAZTables, DDL, AZ_DDL }
