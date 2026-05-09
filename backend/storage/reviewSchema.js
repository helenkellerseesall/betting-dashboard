"use strict"

/**
 * SQLite schema — Daily Intelligence Review Layer (Session W)
 *
 * Additive to intelligenceSchema.js + schema.js. Never modifies existing tables.
 * Apply via applyReviewSchema(db) — safe to call multiple times.
 *
 * Purpose: power the Daily Intelligence Review Engine.
 * Answers: what did we get right, what did we get wrong, WHY.
 *
 * Table map:
 *   daily_intelligence_reports  — top-level daily grading per (sport, date)
 *   calibration_records         — Brier score, ECE, confidence vs reality
 *   process_classifications     — per-bet process archetype (10 types)
 *   ecology_grades              — ecosystem hit rates, HR conversion, suppression
 *   volatility_realizations     — volatility assumption vs actual variance
 *   eruption_events             — offensive eruption detection per game
 *
 * Design:
 *   - INSERT OR REPLACE everywhere — idempotent, re-runs overwrite prior result
 *   - raw_json column on every table for schema-agnostic forward compat
 *   - No sport-specific columns — sport TEXT column everywhere
 */

const DDL = `

-- ─────────────────────────────────────────────────────────────────────────────
-- daily_intelligence_reports
-- One row per (sport, date). Top-level daily review: grades + findings.
-- Answers the 18 daily intelligence questions in structured form.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_intelligence_reports (
  id                        TEXT PRIMARY KEY,  -- "{sport}_{date}"
  sport                     TEXT NOT NULL,
  run_date                  TEXT NOT NULL,
  generated_at              TEXT,

  -- Prediction vs reality summary
  total_candidates          INTEGER DEFAULT 0,
  settled_count             INTEGER DEFAULT 0,
  hit_count                 INTEGER DEFAULT 0,
  miss_count                INTEGER DEFAULT 0,
  hit_rate                  REAL,

  -- Calibration headline numbers
  brier_score               REAL,
  expected_cal_error        REAL,
  avg_confidence            REAL,
  avg_edge                  REAL,

  -- Grades (A/B/C/D/F)
  model_grade               TEXT,
  ecology_grade             TEXT,
  calibration_grade         TEXT,
  volatility_grade          TEXT,
  overall_grade             TEXT,

  -- Structured findings (JSON arrays / objects)
  ecology_grades_json       TEXT,   -- { anchors: {hitRate,count}, tonightsBest:{...}, ... }
  process_counts_json       TEXT,   -- { good_process_bad_variance:3, suppressed_winner:2, ... }
  volatility_summary_json   TEXT,   -- { safe:{hitRate,vrs}, balanced:{...}, ... }
  eruption_summary_json     TEXT,   -- { eruptionCount, missedEruptions, hrConversion, ... }
  steam_summary_json        TEXT,   -- { sharpSignals, fakeTraps, staleLineWins, staleLineLosses }

  -- Top findings (JSON arrays)
  suppressed_winners_json   TEXT,   -- candidates suppressed that should have survived
  overconfident_misses_json TEXT,   -- high-confidence bets that lost big
  top_process_wins_json     TEXT,   -- best process quality wins
  major_findings_json       TEXT,   -- ALERT-level intelligence findings

  raw_json                  TEXT,
  created_at                TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dir_date  ON daily_intelligence_reports (run_date);
CREATE INDEX IF NOT EXISTS idx_dir_sport ON daily_intelligence_reports (sport);


-- ─────────────────────────────────────────────────────────────────────────────
-- calibration_records
-- One row per (sport, date). Probabilistic scoring metrics.
-- Brier Score + ECE are the primary calibration health signals.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calibration_records (
  id               TEXT PRIMARY KEY,  -- "{sport}_{date}"
  sport            TEXT NOT NULL,
  run_date         TEXT NOT NULL,

  sample_count     INTEGER DEFAULT 0,
  brier_score      REAL,
  brier_skill      REAL,   -- 1 - BS/BS_ref; positive = better than baseline
  ece              REAL,   -- Expected Calibration Error
  mce              REAL,   -- Maximum Calibration Error (worst bin)

  avg_confidence   REAL,
  avg_hit_rate     REAL,
  sharpness        REAL,   -- avg(conf) - 0.5; positive = model is decisive
  resolution       REAL,   -- variance of confidence values

  -- Calibration by confidence bin (JSON array)
  -- [{bin_low, bin_high, count, avg_conf, hit_rate, error, overconfident}]
  reliability_json TEXT,

  -- Calibration by stat family (JSON object)
  -- { hits: {count, brierScore, hitRate, avgConf}, hr: {...}, ... }
  by_stat_json     TEXT,

  -- Calibration by tier (JSON object)
  -- { ELITE: {count, brierScore, hitRate, avgConf}, STRONG: {...}, ... }
  by_tier_json     TEXT,

  calibration_grade TEXT,

  raw_json         TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cr_date  ON calibration_records (run_date);
CREATE INDEX IF NOT EXISTS idx_cr_sport ON calibration_records (sport);


-- ─────────────────────────────────────────────────────────────────────────────
-- process_classifications
-- One row per bet after settlement. Core intelligence evolution record.
-- Classifies bet outcome by process quality, not just win/loss.
--
-- 10 process archetypes:
--   good_process_bad_variance   — right process, narrow miss due to variance
--   bad_process_lucky_hit       — bad process, won anyway
--   suppressed_winner           — good-edge candidate filtered pre-slip, hit
--   fake_sharp_trap             — followed steam that was fake
--   offensive_eruption_miss     — environment erupted, zero slip coverage
--   overconfident_suppression   — high-conf UNDER, OVER blew out
--   hidden_sharpness            — low-profile candidate, high actual result
--   correlated_success          — same-game cluster all hit
--   correlated_failure          — same-game cluster all missed
--   stale_line_exploitation     — exploited stale line (success or failure)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS process_classifications (
  id                TEXT PRIMARY KEY,  -- same as prediction_snapshots.id or bet.id
  sport             TEXT NOT NULL,
  run_date          TEXT NOT NULL,
  player            TEXT,
  stat_family       TEXT,
  side              TEXT,
  line              REAL,
  model_prob        REAL,
  edge              REAL,
  tier              TEXT,
  volatility        TEXT,
  ecology_bucket    TEXT,

  -- Outcome
  hit               INTEGER,   -- 1/0/NULL
  actual_value      REAL,
  delta             REAL,      -- actual - line (raw, unsigned)
  signed_delta      REAL,      -- delta normalized to bettor perspective (positive = in our favor)

  -- Process classification
  process_primary   TEXT,
  process_secondary TEXT,
  process_score     REAL,      -- 0-1 quality score (1 = best process)

  -- Flags
  is_suppressed_winner  INTEGER DEFAULT 0,
  is_eruption_miss      INTEGER DEFAULT 0,
  is_fake_sharp         INTEGER DEFAULT 0,
  is_stale_line         INTEGER DEFAULT 0,
  is_correlated         INTEGER DEFAULT 0,

  rationale         TEXT,
  raw_json          TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pc_date    ON process_classifications (run_date);
CREATE INDEX IF NOT EXISTS idx_pc_sport   ON process_classifications (sport);
CREATE INDEX IF NOT EXISTS idx_pc_process ON process_classifications (process_primary);
CREATE INDEX IF NOT EXISTS idx_pc_player  ON process_classifications (player);
CREATE INDEX IF NOT EXISTS idx_pc_hit     ON process_classifications (hit);
CREATE INDEX IF NOT EXISTS idx_pc_suppressed ON process_classifications (is_suppressed_winner);


-- ─────────────────────────────────────────────────────────────────────────────
-- ecology_grades
-- One row per (sport, date). Ecosystem performance grading.
-- Answers: which ecology buckets over/underperformed?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecology_grades (
  id                    TEXT PRIMARY KEY,  -- "{sport}_{date}"
  sport                 TEXT NOT NULL,
  run_date              TEXT NOT NULL,

  -- Per-bucket hit rates
  anchors_hit_rate      REAL,
  anchors_count         INTEGER DEFAULT 0,
  tonight_best_hit_rate REAL,
  tonight_best_count    INTEGER DEFAULT 0,
  smart_aggr_hit_rate   REAL,
  smart_aggr_count      INTEGER DEFAULT 0,
  safest_hit_rate       REAL,
  safest_count          INTEGER DEFAULT 0,
  ai_slip_hit_rate      REAL,
  ai_slip_count         INTEGER DEFAULT 0,
  pool_hit_rate         REAL,
  pool_count            INTEGER DEFAULT 0,

  -- HR ecology (the critical suppression check)
  hr_candidates         INTEGER DEFAULT 0,   -- HR candidates in pool
  hr_in_slips           INTEGER DEFAULT 0,   -- HR legs that made it into slips
  hr_hits               INTEGER DEFAULT 0,   -- HR overs that actually hit
  hr_conversion_rate    REAL,                -- hr_in_slips / hr_candidates
  hr_suppressed_winners INTEGER DEFAULT 0,   -- HR hits from pool candidates not slipped
  hr_eruption_miss      INTEGER DEFAULT 0,   -- 1 = had candidates, 0 slips, multiple hits

  -- Ladder ecology
  ladder_candidates     INTEGER DEFAULT 0,
  ladder_hits           INTEGER DEFAULT 0,
  ladder_hit_rate       REAL,

  -- RBI chain ecology
  rbi_chain_candidates  INTEGER DEFAULT 0,
  rbi_chain_hits        INTEGER DEFAULT 0,
  rbi_chain_rate        REAL,

  -- Suppression analysis
  suppressed_winners    INTEGER DEFAULT 0,
  suppressed_total      INTEGER DEFAULT 0,
  suppression_miss_rate REAL,

  -- Grade + findings (JSON array of strings)
  ecology_grade         TEXT,
  major_findings_json   TEXT,
  grade_rationale       TEXT,

  raw_json              TEXT,
  created_at            TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eg_date  ON ecology_grades (run_date);
CREATE INDEX IF NOT EXISTS idx_eg_sport ON ecology_grades (sport);


-- ─────────────────────────────────────────────────────────────────────────────
-- volatility_realizations
-- One row per (sport, date). Volatility assumption vs actual outcomes.
-- Key metric: Volatility Realization Score (VRS) — did tier labels predict variance?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS volatility_realizations (
  id                    TEXT PRIMARY KEY,  -- "{sport}_{date}"
  sport                 TEXT NOT NULL,
  run_date              TEXT NOT NULL,

  -- Per-tier stats (JSON objects per tier)
  safe_json             TEXT,        -- { count, settled, hits, hitRate, avgAbsDelta, deltaVariance }
  balanced_json         TEXT,
  aggressive_json       TEXT,
  lotto_json            TEXT,

  -- Volatility Realization Score (0-1)
  -- Did lotto produce more variance than aggressive, aggressive > balanced, etc.?
  vrs                   REAL,

  -- Implied vs actual divergence
  avg_implied_prob      REAL,
  avg_model_prob        REAL,
  avg_actual_rate       REAL,
  implied_vs_actual     REAL,        -- positive = market overpriced
  model_vs_actual       REAL,        -- positive = model overconfident

  -- Grade
  volatility_grade      TEXT,
  grade_rationale       TEXT,

  raw_json              TEXT,
  created_at            TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vr_date  ON volatility_realizations (run_date);
CREATE INDEX IF NOT EXISTS idx_vr_sport ON volatility_realizations (sport);


-- ─────────────────────────────────────────────────────────────────────────────
-- eruption_events
-- One row per detected offensive eruption event per (game, date).
-- An eruption = multiple overs hit in same game, or HR cascade / RBI chain.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eruption_events (
  id                TEXT PRIMARY KEY,  -- "{sport}_{date}_{event_key}"
  sport             TEXT NOT NULL,
  run_date          TEXT NOT NULL,
  event_id          TEXT,
  matchup           TEXT,

  -- Eruption magnitude
  total_over_bets   INTEGER DEFAULT 0,  -- total over bets we had in this game
  settling_overs    INTEGER DEFAULT 0,  -- settled over bets
  hitting_overs     INTEGER DEFAULT 0,  -- over bets that hit
  eruption_score    REAL,               -- 0-1 magnitude

  -- HR eruption details
  hr_eruption       INTEGER DEFAULT 0,  -- 1 = HR erupted this game
  hr_in_pool        INTEGER DEFAULT 0,  -- how many HR candidates in pool for this game
  hr_in_slips       INTEGER DEFAULT 0,  -- how many HR legs slipped for this game
  hr_eruption_miss  INTEGER DEFAULT 0,  -- 1 = eruption happened, we had candidates but 0 slips

  -- Environment
  implied_team_total REAL,
  park_factor        REAL,
  wind_out           INTEGER DEFAULT 0,

  -- Classification
  eruption_type     TEXT,   -- hr_cascade / rbi_chain / offensive_blowout / general_over_surge
  was_predicted     INTEGER DEFAULT 0,  -- 1 = we had slip coverage
  was_missed        INTEGER DEFAULT 0,  -- 1 = eruption, zero coverage

  -- Eruptors (JSON: [{player, statFamily, line, actualStat}])
  eruptors_json     TEXT,

  raw_json          TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ee_date    ON eruption_events (run_date);
CREATE INDEX IF NOT EXISTS idx_ee_sport   ON eruption_events (sport);
CREATE INDEX IF NOT EXISTS idx_ee_type    ON eruption_events (eruption_type);
CREATE INDEX IF NOT EXISTS idx_ee_missed  ON eruption_events (was_missed);

`

/**
 * Apply the review schema to an open DatabaseSync instance.
 * Safe to call multiple times — all statements use CREATE IF NOT EXISTS.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function applyReviewSchema(db) {
  db.exec(DDL)
}

module.exports = { applyReviewSchema, DDL }
