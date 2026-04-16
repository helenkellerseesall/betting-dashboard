"use strict"

/**
 * MLB Market Classification
 *
 * Mirrors the API of pipeline/markets/classification.js for MLB markets.
 * Classifies The Odds API market keys into internal types and families.
 *
 * Families:
 *   "standard"  — core over/under batter or pitcher counting stats
 *   "ladder"    — alternate line variants of standard stats
 *   "special"   — game-prop or milestone markets (NRFI, first HR scorer, etc.)
 *   "unknown"   — unrecognized market key
 *
 * Phase 0: rules cover the markets expected from The Odds API baseball_mlb
 * player props endpoint. Additional keys can be appended to MLB_MARKET_TYPE_RULES
 * without touching any other file.
 *
 * This file is NOT imported by any NBA code path.
 */

// ---------------------------------------------------------------------------
// Market type rules table
// ---------------------------------------------------------------------------

const MLB_MARKET_TYPE_RULES = [
  // --- Game lines (used in fallback bootstrap when player markets are sparse) ---
  {
    internalType: "Moneyline",
    family: "game",
    matches: ["h2h", "moneyline", "match winner"]
  },
  {
    internalType: "Run Line",
    family: "game",
    matches: ["spreads", "run line", "runline"]
  },
  {
    internalType: "Game Total",
    family: "game",
    matches: ["totals", "total runs", "game total"]
  },

  // --- Specials / game props ---
  {
    internalType: "NRFI",
    family: "special",
    matches: ["nrfi", "no run first inning", "no_run_first_inning", "no runs first inning"]
  },
  {
    internalType: "YRFI",
    family: "special",
    matches: ["yrfi", "yes run first inning", "yes_run_first_inning", "yes runs first inning"]
  },
  {
    internalType: "First Home Run",
    family: "special",
    matches: [
      "batter_first_home_run",
      "first home run",
      "first_home_run",
      "first hr",
      "first hr scorer"
    ]
  },
  {
    internalType: "First Hit",
    family: "special",
    matches: ["batter_first_hit", "first hit", "first_hit"]
  },

  // --- Pitcher standard ---
  {
    internalType: "Pitcher Strikeouts",
    family: "standard",
    matches: [
      "pitcher_strikeouts",
      "player_pitcher_strikeouts",
      "pitcher strikeouts",
      "pitching strikeouts",
      "starting pitcher strikeouts"
    ]
  },
  {
    internalType: "Pitcher Hits Allowed",
    family: "standard",
    matches: [
      "pitcher_hits_allowed",
      "player_pitcher_hits_allowed",
      "hits allowed",
      "hits_allowed"
    ]
  },
  {
    internalType: "Pitcher Earned Runs",
    family: "standard",
    matches: [
      "pitcher_earned_runs",
      "player_pitcher_earned_runs",
      "earned runs",
      "earned_runs",
      "er allowed"
    ]
  },
  {
    internalType: "Pitcher Outs",
    family: "standard",
    matches: [
      "pitcher_outs",
      "player_pitcher_outs",
      "pitcher outs recorded",
      "outs recorded"
    ]
  },
  {
    internalType: "Pitcher Walks",
    family: "standard",
    matches: [
      "pitcher_walks",
      "player_pitcher_walks",
      "pitcher walks allowed",
      "bb allowed"
    ]
  },

  // --- Pitcher ladders (alternate lines) ---
  {
    internalType: "Pitcher Strikeouts Ladder",
    family: "ladder",
    matches: [
      "pitcher_strikeouts_alternate",
      "player_pitcher_strikeouts_alternate",
      "pitcher strikeouts alternate",
      "alternate pitcher strikeouts"
    ]
  },

  // --- Batter standard ---
  {
    internalType: "Strikeouts",
    family: "standard",
    matches: [
      "player_strikeouts",
      "batter_strikeouts",
      "batter strikeouts",
      "hitter strikeouts"
    ]
  },
  {
    internalType: "Hits",
    family: "standard",
    matches: [
      "player_hits",
      "batter_hits",
      "hits",
      "player hits"
    ]
  },
  {
    internalType: "Total Bases",
    family: "standard",
    matches: [
      "player_total_bases",
      "batter_total_bases",
      "total bases",
      "total_bases"
    ]
  },
  {
    internalType: "Home Runs",
    family: "standard",
    matches: [
      "player_home_runs",
      "batter_home_runs",
      "anytime_home_run",
      "to_hit_home_run",
      "home runs",
      "home_runs",
      "hr"
    ]
  },
  {
    internalType: "RBIs",
    family: "standard",
    matches: [
      "player_rbis",
      "player_runs_batted_in",
      "batter_rbis",
      "batter_rbi",
      "batter_rbi_alternate",
      "batter_rbis_alternate",
      "rbis",
      "runs batted in",
      "rbi"
    ]
  },
  {
    internalType: "Runs Scored",
    family: "standard",
    matches: [
      "player_runs",
      "player_runs_scored",
      "batter_runs",
      "batter_runs_scored",
      "runs scored",
      "runs_scored"
    ]
  },
  {
    internalType: "Walks",
    family: "standard",
    matches: [
      "player_walks",
      "batter_walks",
      "walks",
      "bb",
      "base on balls"
    ]
  },
  {
    internalType: "Singles",
    family: "standard",
    matches: [
      "player_singles",
      "batter_singles",
      "singles"
    ]
  },

  // --- Batter ladders ---
  {
    internalType: "Total Bases Ladder",
    family: "ladder",
    matches: [
      "player_total_bases_alternate",
      "batter_total_bases_alternate",
      "total bases alternate",
      "alternate total bases"
    ]
  },
  {
    internalType: "Hits Ladder",
    family: "ladder",
    matches: [
      "player_hits_alternate",
      "batter_hits_alternate",
      "hits alternate",
      "alternate hits"
    ]
  },
  {
    internalType: "Strikeouts Ladder",
    family: "ladder",
    matches: [
      "player_strikeouts_alternate",
      "batter_strikeouts_alternate",
      "strikeouts alternate",
      "alternate strikeouts"
    ]
  }
]

// ---------------------------------------------------------------------------
// Classification helper
// ---------------------------------------------------------------------------

/**
 * Infer the MLB internal market type and family from an Odds API market key.
 *
 * @param {string} marketKey - Raw market key string from the odds feed.
 * @returns {{ internalType: string|null, family: "standard"|"ladder"|"special"|"game"|"unknown" }}
 */
function inferMlbMarketTypeFromKey(marketKey) {
  const normalized = String(marketKey || "").trim().toLowerCase()
  if (!normalized) return { internalType: null, family: "unknown" }

  for (const rule of MLB_MARKET_TYPE_RULES) {
    if (rule.matches.some((needle) => normalized.includes(String(needle).toLowerCase()))) {
      return {
        internalType: rule.internalType,
        family: rule.family
      }
    }
  }

  return {
    internalType: null,
    family: "unknown"
  }
}

/**
 * Return true when the market key belongs to a pitcher stat (vs. batter).
 * Used to distinguish pitcher rows from batter rows for signal weighting.
 * @param {string} marketKey
 * @returns {boolean}
 */
function isMlbPitcherMarketKey(marketKey) {
  const normalized = String(marketKey || "").trim().toLowerCase()
  return (
    normalized.includes("pitcher_") ||
    normalized.includes("_pitcher") ||
    normalized.includes("earned_runs") ||
    normalized.includes("hits_allowed") ||
    normalized.includes("outs_recorded")
  )
}

/**
 * Return true when the internalType is a batter counting stat suitable
 * for the standard singles/ladder board.
 * @param {string} internalType
 * @returns {boolean}
 */
function isMlbStandardBatterType(internalType) {
  return MLB_STANDARD_BATTER_TYPES.has(String(internalType || ""))
}

// Canonical batter standard types — equivalent of NBA's STANDARD_PROP_TYPES
const MLB_STANDARD_BATTER_TYPES = new Set([
  "Hits",
  "Total Bases",
  "Home Runs",
  "RBIs",
  "Runs Scored",
  "Walks",
  "Strikeouts",
  "Singles"
])

// Canonical pitcher standard types
const MLB_STANDARD_PITCHER_TYPES = new Set([
  "Pitcher Strikeouts",
  "Pitcher Hits Allowed",
  "Pitcher Earned Runs",
  "Pitcher Outs",
  "Pitcher Walks"
])

// Canonical special types
const MLB_SPECIAL_TYPES = new Set([
  "NRFI",
  "YRFI",
  "First Home Run",
  "First Hit"
])

const MLB_GAME_LINE_TYPES = new Set([
  "Moneyline",
  "Run Line",
  "Game Total"
])

module.exports = {
  MLB_MARKET_TYPE_RULES,
  MLB_STANDARD_BATTER_TYPES,
  MLB_STANDARD_PITCHER_TYPES,
  MLB_SPECIAL_TYPES,
  MLB_GAME_LINE_TYPES,
  inferMlbMarketTypeFromKey,
  isMlbPitcherMarketKey,
  isMlbStandardBatterType
}
