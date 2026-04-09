"use strict"

/**
 * MLB Team Resolution
 *
 * Mirrors the style and API of pipeline/resolution/playerTeamResolution.js
 * for MLB teams. Used by the Phase 1 MLB board path only.
 * This file is not imported by any existing NBA code path.
 *
 * All 30 MLB franchises are mapped. Common variant abbreviations are included
 * (e.g., TB / TBR / TBD, MIA / FLA, WAS / WSH) because The Odds API and
 * RotoWire can use different short forms.
 */

// ---------------------------------------------------------------------------
// Abbreviation → full team name map (canonical + common variants)
// ---------------------------------------------------------------------------

const MLB_TEAM_ABBR_MAP = {
  // American League East
  BAL: "Baltimore Orioles",
  BOS: "Boston Red Sox",
  NYY: "New York Yankees",
  TB: "Tampa Bay Rays",
  TBR: "Tampa Bay Rays",
  TBD: "Tampa Bay Rays",
  TOR: "Toronto Blue Jays",

  // American League Central
  CHW: "Chicago White Sox",
  CWS: "Chicago White Sox",
  CLE: "Cleveland Guardians",
  CLG: "Cleveland Guardians",
  DET: "Detroit Tigers",
  KC: "Kansas City Royals",
  KCR: "Kansas City Royals",
  MIN: "Minnesota Twins",

  // American League West
  HOU: "Houston Astros",
  LAA: "Los Angeles Angels",
  ANA: "Los Angeles Angels",
  OAK: "Oakland Athletics",
  ATH: "Oakland Athletics", // Las Vegas Athletics transition name used in some APIs
  SEA: "Seattle Mariners",
  TEX: "Texas Rangers",

  // National League East
  ATL: "Atlanta Braves",
  MIA: "Miami Marlins",
  FLA: "Miami Marlins", // legacy abbreviation still seen in older feeds
  NYM: "New York Mets",
  PHI: "Philadelphia Phillies",
  WAS: "Washington Nationals",
  WSH: "Washington Nationals",
  WSN: "Washington Nationals",

  // National League Central
  CHC: "Chicago Cubs",
  CIN: "Cincinnati Reds",
  MIL: "Milwaukee Brewers",
  PIT: "Pittsburgh Pirates",
  STL: "St. Louis Cardinals",

  // National League West
  ARI: "Arizona Diamondbacks",
  ARZ: "Arizona Diamondbacks",
  COL: "Colorado Rockies",
  LAD: "Los Angeles Dodgers",
  SD: "San Diego Padres",
  SDP: "San Diego Padres",
  SF: "San Francisco Giants",
  SFG: "San Francisco Giants"
}

// ---------------------------------------------------------------------------
// Private helpers (same pattern as playerTeamResolution.js)
// ---------------------------------------------------------------------------

function normalizeTeamText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/**
 * Resolve an MLB team abbreviation to its canonical full name.
 * Returns empty string when the abbreviation is not recognized.
 * @param {string} abbr
 * @returns {string}
 */
function getMlbTeamNameByAbbr(abbr) {
  return MLB_TEAM_ABBR_MAP[String(abbr || "").toUpperCase().trim()] || ""
}

/**
 * Build a token set for matching a team value against matchup strings.
 * Includes the raw value, the abbreviation, the full name, and the city/nickname.
 * @param {string} teamValue
 * @returns {Set<string>}
 */
function getMlbTeamTokenSet(teamValue) {
  const raw = String(teamValue || "").trim()
  const tokens = new Set()
  if (!raw) return tokens

  const add = (value) => {
    const normalized = normalizeTeamText(value)
    if (normalized) tokens.add(normalized)
  }

  add(raw)

  // Try raw as an abbreviation first
  const upperRaw = raw.toUpperCase().trim()
  const fullNameFromAbbr = getMlbTeamNameByAbbr(upperRaw)
  if (fullNameFromAbbr) {
    add(fullNameFromAbbr)
    const parts = normalizeTeamText(fullNameFromAbbr).split(" ").filter(Boolean)
    // Add nickname (last word: "Yankees", "Dodgers", etc.)
    if (parts.length) add(parts[parts.length - 1])
    // Add city (first word: "New", "Los", etc.) — less useful but harmless
    if (parts.length > 1) add(parts[0])
  }

  // Also try reverse: raw might already be a full name
  for (const [abbr, fullName] of Object.entries(MLB_TEAM_ABBR_MAP)) {
    if (normalizeTeamText(fullName) === normalizeTeamText(raw)) {
      tokens.add(normalizeTeamText(abbr))
      const parts = normalizeTeamText(fullName).split(" ").filter(Boolean)
      if (parts.length) add(parts[parts.length - 1])
      break
    }
  }

  return tokens
}

/**
 * Parse "Away @ Home" or "Away vs Home" matchup strings into team parts.
 * Same logic as playerTeamResolution.js parseMatchupTeams.
 * @param {string} matchupValue
 * @returns {{ away: string, home: string }}
 */
function parseMlbMatchupTeams(matchupValue) {
  const matchup = String(matchupValue || "").trim()
  if (!matchup) return { away: "", home: "" }
  const normalized = matchup.replace(/\s+vs\.?\s+/i, " @ ")
  const parts = normalized.split("@").map((part) => String(part || "").trim()).filter(Boolean)
  if (parts.length >= 2) {
    return {
      away: parts[0],
      home: parts[1]
    }
  }
  return { away: "", home: "" }
}

// ---------------------------------------------------------------------------
// Exported resolution helpers
// ---------------------------------------------------------------------------

/**
 * Check that a row's team field is consistent with its matchup string.
 * Returns true when:
 *   - row has no team field (no mis-assignment possible)
 *   - matchup has no parseable teams (can't validate)
 *   - team tokens intersect with away or home team tokens
 *
 * @param {object} row - row with { team, matchup, awayTeam?, homeTeam? }
 * @returns {boolean}
 */
function mlbRowTeamMatchesMatchup(row) {
  if (!row) return true

  const team = String(row?.team || "").trim()
  if (!team) return true

  const parsedMatchup = parseMlbMatchupTeams(row?.matchup)
  const awayTeam = String(row?.awayTeam || parsedMatchup.away || "").trim()
  const homeTeam = String(row?.homeTeam || parsedMatchup.home || "").trim()

  const awayTokens = getMlbTeamTokenSet(awayTeam)
  const homeTokens = getMlbTeamTokenSet(homeTeam)
  const teamTokens = getMlbTeamTokenSet(team)

  if (!awayTokens.size && !homeTokens.size) return true

  for (const token of teamTokens) {
    if (awayTokens.has(token) || homeTokens.has(token)) return true
  }

  return false
}

/**
 * Return rows whose team field does not match their matchup.
 * Mirrors getBadTeamAssignmentRows from playerTeamResolution.js.
 * @param {object[]} rows
 * @param {number} [limit=25]
 * @returns {object[]}
 */
function getMlbBadTeamAssignmentRows(rows, limit = 25) {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxRows = Number.isFinite(limit) ? Math.max(0, Number(limit)) : 25
  return safeRows
    .filter((row) => !mlbRowTeamMatchesMatchup(row))
    .slice(0, maxRows)
    .map((row) => ({
      player: row?.player,
      team: row?.team,
      matchup: row?.matchup,
      awayTeam: row?.awayTeam,
      homeTeam: row?.homeTeam,
      propType: row?.propType,
      marketKey: row?.marketKey
    }))
}

/**
 * Build a canonical player → team index from an array of MLB rows.
 * Highest-frequency team assignment per player wins.
 * Mirrors buildSpecialtyPlayerTeamIndex from playerTeamResolution.js.
 * @param {object[]} rows
 * @returns {Record<string, string>}
 */
function buildMlbPlayerTeamIndex(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const countsByPlayer = new Map()

  for (const row of safeRows) {
    const playerKey = normalizeTeamText(row?.player || "")
    const team = String(row?.playerTeam || row?.team || "").trim()
    if (!playerKey || !team) continue
    if (!mlbRowTeamMatchesMatchup(row)) continue

    if (!countsByPlayer.has(playerKey)) countsByPlayer.set(playerKey, new Map())
    const teamCounts = countsByPlayer.get(playerKey)
    teamCounts.set(team, (teamCounts.get(team) || 0) + 1)
  }

  const output = {}
  for (const [playerKey, teamCounts] of countsByPlayer.entries()) {
    let bestTeam = null
    let bestCount = -1
    for (const [team, count] of teamCounts.entries()) {
      if (count > bestCount) {
        bestTeam = team
        bestCount = count
      }
    }
    if (bestTeam) output[playerKey] = bestTeam
  }

  return output
}

module.exports = {
  MLB_TEAM_ABBR_MAP,
  getMlbTeamNameByAbbr,
  getMlbTeamTokenSet,
  parseMlbMatchupTeams,
  mlbRowTeamMatchesMatchup,
  getMlbBadTeamAssignmentRows,
  buildMlbPlayerTeamIndex
}
