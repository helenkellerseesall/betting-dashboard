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
  nba: {
    sportKey: "basketball_nba",
    label: "NBA",
    activeBooks: ["DraftKings", "FanDuel"],
    baseMarkets: [
      "player_points",
      "player_rebounds",
      "player_assists",
      "player_threes",
      "player_points_rebounds_assists"
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
      "player_points_rebounds_assists_alternate"
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
    activeBooks: ["DraftKings", "FanDuel"],
    baseMarkets: [
      "batter_hits",
      "batter_total_bases",
      "batter_home_runs",
      "batter_rbis",
      "batter_walks",
      "pitcher_strikeouts",
      "pitcher_hits_allowed",
      "pitcher_earned_runs",
      "pitcher_outs"
    ],
    extraMarkets: [
      "batter_hits_alternate",
      "batter_total_bases_alternate",
      "pitcher_strikeouts_alternate",
      "batter_runs_scored",
      "batter_strikeouts",
      "pitcher_walks",
      "batter_first_home_run"
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
      enableLiveFetch: false,
      cacheKey: "mlb_external_snapshot"
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
