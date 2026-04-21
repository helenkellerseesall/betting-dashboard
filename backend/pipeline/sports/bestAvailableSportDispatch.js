"use strict"

/**
 * Central sport-key routing for best-available style endpoints.
 * Add future leagues (e.g. americanfootball_nfl) here without touching NBA/MLB pipelines.
 */

const DEFAULT_BEST_AVAILABLE_SPORT_KEY = "basketball_nba"
const ALLOWED_BEST_AVAILABLE_SPORT_KEYS = new Set(["basketball_nba", "baseball_mlb"])

function normalizeBestAvailableSportKey(raw) {
  const s = String(raw == null ? "" : raw).trim()
  if (ALLOWED_BEST_AVAILABLE_SPORT_KEYS.has(s)) return s
  return DEFAULT_BEST_AVAILABLE_SPORT_KEY
}

function isMlbBestAvailableSportKey(key) {
  return key === "baseball_mlb"
}

function isNbaBestAvailableSportKey(key) {
  return key === "basketball_nba"
}

module.exports = {
  DEFAULT_BEST_AVAILABLE_SPORT_KEY,
  ALLOWED_BEST_AVAILABLE_SPORT_KEYS,
  normalizeBestAvailableSportKey,
  isMlbBestAvailableSportKey,
  isNbaBestAvailableSportKey,
}
