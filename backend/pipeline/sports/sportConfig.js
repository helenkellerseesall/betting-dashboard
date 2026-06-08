/**
 * Sport Configuration Registry
 *
 * Central registry of sport keys and their pipeline configuration.
 * All entries are used as static config — no live routing happens from this file.
 *
 * Phase 0: scaffolding only. MLB entry is a placeholder.
 *           NBA entry mirrors existing runtime constants for documentation
 *           purposes but does not alter any existing NBA code paths.
 *           This file is not imported by server.js or any NBA module.
 *
 * Phase 1 will wire the MLB entry into a parallel /mlb/board endpoint.
 */

"use strict"

const SPORT_CONFIG = {
  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ ⚠️  DEAD CONFIG — DO NOT EDIT TO CHANGE WHAT NBA REQUESTS.            │
  // │ No live NBA code path reads this `nba` block (verified 2026-06-08:    │
  // │ the only `getSportConfig()` callers are MLB-only — buildMlbBootstrap  │
  // │ Snapshot.js + fetchMlbExternalSnapshot.js, both literal "mlb").       │
  // │ The ACTUAL NBA request authority is the hardcoded arrays +           │
  // │ NBA_BOOKMAKERS_CSV in backend/pipeline/nba/fetchNbaOddsSnapshot.js.   │
  // │ Editing activeBooks / baseMarkets / extraMarkets HERE does NOTHING —  │
  // │ change fetchNbaOddsSnapshot.js instead. Kept (not deleted) as the     │
  // │ forward-scaffold for the planned Phase-1 sportConfig-driven NBA wire; │
  // │ until that wire lands, this is documentation only. (Prop-Ingestion    │
  // │ Truth Audit v2 §1, SHIP 1.)                                           │
  // └──────────────────────────────────────────────────────────────────────┘
  nba: {
    sportKey: "basketball_nba",
    label: "NBA",
    // DEAD (see block banner above) — Operator's 7-book vision (audit 2026-05-22).
    // Odds-API keys (lowercase). NOT the live NBA book list; that is
    // NBA_BOOKMAKERS_CSV in fetchNbaOddsSnapshot.js.
    activeBooks: ["draftkings", "fanduel", "fanatics", "caesars", "betmgm", "betrivers", "hardrockbet", "bet365"],
    // DEAD (see block banner) — live NBA markets are NBA_BASE_MARKETS /
    // NBA_DK_EXTRA_MARKETS / NBA_DEFENSIVE_MARKETS in fetchNbaOddsSnapshot.js.
    baseMarkets: [
      "player_points",
      "player_rebounds",
      "player_assists",
      "player_threes",
      "player_points_rebounds_assists",
      "player_points_rebounds",
      "player_points_assists",
      "player_rebounds_assists",
    ],
    extraMarkets: [
      "player_first_basket",
      "player_first_team_basket",
      "player_double_double",
      "player_triple_double",
      "player_points_alternate",
      "player_rebounds_alternate",
      "player_assists_alternate",
      "player_threes_alternate",
      "player_points_rebounds_assists_alternate",
      "player_points_rebounds_alternate",
      "player_points_assists_alternate",
      "player_rebounds_assists_alternate",
    ],
    specialMarketKeys: new Set([
      "player_first_basket",
      "player_first_team_basket",
      "player_double_double",
      "player_triple_double"
    ]),
    classificationModule: "../markets/classification",
    boardClassificationModule: "../markets/boardClassification",
    teamResolutionModule: "../resolution/playerTeamResolution",
    scheduleModule: "../schedule/buildSlateEvents",
    injurySources: [
      "nba_official_injury_report",
      "rotowire",
      "rotogrinders"
    ],
    fragileRules: {
      avgMinThreshold: 22,
      minFloorThreshold: 10,
      minStdThreshold: 9,
      valueStdThreshold: 11
    }
  },

  mlb: {
    sportKey: "baseball_mlb",
    label: "MLB",
    // Operator's 7-book vision (audit 2026-05-22). Odds-API keys (lowercase).
    // Same as NBA — empty returns silent if a book doesn't carry MLB markets
    // in operator's API tier. Pre-fix: 190 HR rows leaked through a no-book
    // fallback path; now we request these books explicitly.
    activeBooks: ["draftkings", "fanduel", "fanatics", "caesars", "betmgm", "betrivers", "hardrockbet", "bet365"],
    baseMarkets: [
      // GAME LINES (some books only publish these reliably)
      "h2h",
      "spreads",
      "totals",

      // PITCHERS (exact keys)
      "pitcher_strikeouts",
      "pitcher_outs",
      "pitcher_earned_runs",
      "pitcher_walks",

      // HITTERS (exact keys)
      "batter_hits",
      "batter_total_bases",
      "batter_rbis",
      "batter_runs_scored",

      // SPECIALS (exact keys)
      "batter_stolen_bases",

      // Retain working HR market (explicitly requested)
      "batter_home_runs",

      // Odds API variant keys (some endpoints/accounts expose player_* naming)
      "player_hits",
      "player_total_bases",
      "player_home_runs",
      "player_rbis",
      "player_runs_scored",
      "player_strikeouts",
      "player_pitcher_strikeouts"
    ],
    extraMarkets: [
      // ALT / LADDER MARKETS (exact keys)
      "batter_hits_alternate",
      "batter_total_bases_alternate",
      "batter_rbis_alternate",
      "batter_runs_scored_alternate",
      "pitcher_strikeouts_alternate",

      // Keep existing special if available (already wired elsewhere)
      "batter_first_home_run",

      // Odds API variant keys (alternates / ladders)
      "player_hits_alternate",
      "player_total_bases_alternate",
      "player_rbis_alternate",
      "player_runs_scored_alternate",
      "player_strikeouts_alternate",

      // Innings specials
      "nrfi",
      "yrfi"
    ],
    specialMarketKeys: new Set([
      "batter_first_home_run",
      "nrfi",
      "yrfi"
    ]),
    // Modules created/planned in Phase 0; wired in Phase 1
    classificationModule: "../markets/mlbClassification",
    boardClassificationModule: null, // Phase 1: ../markets/mlbBoardClassification
    teamResolutionModule: "../resolution/mlbTeamResolution",
    scheduleModule: "../schedule/buildMlbSlateEvents",
    injurySources: [
      "mlb_official_injury_report",
      "rotowire_mlb"
    ],
    externalData: {
      preferredSource: "mlb_api_sports",
      enableLiveFetch: true,
      enableLineupOverlay: true,
      lineupOverlaySource: "mlb_official_lineups",
      cacheKey: "mlb_external_snapshot",
      cacheTtlMs: 900000
    },
    // MLB fragile rules differ: no avgMin concept; use PA/IP thresholds instead
    fragileRules: {
      // Batter: fewer than 2 plate appearances projected → fragile
      minBatterPAThreshold: 2,
      // Pitcher: fewer than 80 pitches projected / < 4 IP → fragile
      minPitcherIPThreshold: 4,
      // Batting order position 8 or 9 → apply penalty (not hard removal)
      lowBattingOrderPenaltyPositions: [8, 9],
      valueStdThreshold: 11
    }
  }
}

/**
 * Get the config for a given sport key.
 * @param {"nba"|"mlb"} sportKey
 * @returns {object|null}
 */
function getSportConfig(sportKey) {
  return SPORT_CONFIG[String(sportKey || "").toLowerCase()] || null
}

/**
 * Get all registered sport keys.
 * @returns {string[]}
 */
function getAllSportKeys() {
  return Object.keys(SPORT_CONFIG)
}

/**
 * Check whether a sport key is registered.
 * @param {string} sportKey
 * @returns {boolean}
 */
function isSupportedSport(sportKey) {
  return Object.prototype.hasOwnProperty.call(SPORT_CONFIG, String(sportKey || "").toLowerCase())
}

module.exports = {
  SPORT_CONFIG,
  getSportConfig,
  getAllSportKeys,
  isSupportedSport
}
