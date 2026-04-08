function normalizeTeamDebugText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function getTeamNameByAbbr(abbr) {
  const map = {
    ATL: "Atlanta Hawks",
    BOS: "Boston Celtics",
    BKN: "Brooklyn Nets",
    CHA: "Charlotte Hornets",
    CHI: "Chicago Bulls",
    CLE: "Cleveland Cavaliers",
    DAL: "Dallas Mavericks",
    DEN: "Denver Nuggets",
    DET: "Detroit Pistons",
    GSW: "Golden State Warriors",
    HOU: "Houston Rockets",
    IND: "Indiana Pacers",
    LAC: "Los Angeles Clippers",
    LAL: "Los Angeles Lakers",
    MEM: "Memphis Grizzlies",
    MIA: "Miami Heat",
    MIL: "Milwaukee Bucks",
    MIN: "Minnesota Timberwolves",
    NOP: "New Orleans Pelicans",
    NYK: "New York Knicks",
    OKC: "Oklahoma City Thunder",
    ORL: "Orlando Magic",
    PHI: "Philadelphia 76ers",
    PHX: "Phoenix Suns",
    POR: "Portland Trail Blazers",
    SAC: "Sacramento Kings",
    SAS: "San Antonio Spurs",
    TOR: "Toronto Raptors",
    UTA: "Utah Jazz",
    WAS: "Washington Wizards"
  }
  return map[String(abbr || "").toUpperCase().trim()] || ""
}

function getTeamTokenSet(teamValue, teamAbbrResolver) {
  const raw = String(teamValue || "").trim()
  const tokens = new Set()
  if (!raw) return tokens

  const add = (value) => {
    const normalized = normalizeTeamDebugText(value)
    if (normalized) tokens.add(normalized)
  }

  add(raw)

  const abbr = String((typeof teamAbbrResolver === "function" ? teamAbbrResolver(raw) : raw) || raw).toUpperCase().trim()
  if (abbr) {
    add(abbr)
    const fullName = getTeamNameByAbbr(abbr)
    if (fullName) {
      add(fullName)
      const nameParts = normalizeTeamDebugText(fullName).split(" ").filter(Boolean)
      if (nameParts.length) add(nameParts[nameParts.length - 1])
    }
  }

  return tokens
}

function parseMatchupTeams(matchupValue) {
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

function rowTeamMatchesMatchup(row, teamAbbrResolver) {
  if (!row) return true

  const team = String(row?.team || "").trim()
  if (!team) return true

  const parsedMatchup = parseMatchupTeams(row?.matchup)
  const awayTeam = String(row?.awayTeam || parsedMatchup.away || "").trim()
  const homeTeam = String(row?.homeTeam || parsedMatchup.home || "").trim()

  const awayTokens = getTeamTokenSet(awayTeam, teamAbbrResolver)
  const homeTokens = getTeamTokenSet(homeTeam, teamAbbrResolver)
  const teamTokens = getTeamTokenSet(team, teamAbbrResolver)

  if (!awayTokens.size && !homeTokens.size) return true

  for (const token of teamTokens) {
    if (awayTokens.has(token) || homeTokens.has(token)) return true
  }

  return false
}

function getBadTeamAssignmentRows(rows, limit = 25, teamAbbrResolver) {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxRows = Number.isFinite(limit) ? Math.max(0, Number(limit)) : 25
  return safeRows
    .filter((row) => !rowTeamMatchesMatchup(row, teamAbbrResolver))
    .slice(0, maxRows)
    .map((row) => ({
      player: row?.player,
      team: row?.team,
      matchup: row?.matchup,
      awayTeam: row?.awayTeam,
      homeTeam: row?.homeTeam,
      book: row?.book,
      propType: row?.propType,
      line: row?.line,
      odds: row?.odds,
      eventId: row?.eventId
    }))
}

function buildSpecialtyPlayerTeamIndex(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const canonicalCountsByPlayer = new Map()
  const fallbackCountsByPlayer = new Map()

  const getRowWeight = (row) => {
    const marketFamily = String(row?.marketFamily || "").toLowerCase()
    const marketKey = String(row?.marketKey || "").toLowerCase()
    const isSpecialFamily = marketFamily === "special"
    const isSpecialMarketKey =
      marketKey === "player_first_basket" ||
      marketKey === "player_first_team_basket" ||
      marketKey === "player_double_double" ||
      marketKey === "player_triple_double"
    // Favor canonical non-special rows when choosing a player's team.
    return (isSpecialFamily || isSpecialMarketKey) ? 1 : 3
  }

  for (const row of safeRows) {
    const playerKey = String(row?.player || "").trim().toLowerCase()
    const team = String(row?.playerTeam || row?.team || "").trim()
    if (!playerKey || !team) continue
    if (!rowTeamMatchesMatchup(row)) continue
    const marketFamily = String(row?.marketFamily || "").toLowerCase()
    const marketKey = String(row?.marketKey || "").toLowerCase()
    const isSpecialFamily = marketFamily === "special"
    const isSpecialMarketKey =
      marketKey === "player_first_basket" ||
      marketKey === "player_first_team_basket" ||
      marketKey === "player_double_double" ||
      marketKey === "player_triple_double"
    const bucket = (isSpecialFamily || isSpecialMarketKey)
      ? fallbackCountsByPlayer
      : canonicalCountsByPlayer

    if (!bucket.has(playerKey)) bucket.set(playerKey, new Map())
    const teamCounts = bucket.get(playerKey)
    const weight = getRowWeight(row)
    teamCounts.set(team, (teamCounts.get(team) || 0) + weight)
  }

  const output = {}
  const allPlayerKeys = new Set([
    ...canonicalCountsByPlayer.keys(),
    ...fallbackCountsByPlayer.keys()
  ])

  for (const playerKey of allPlayerKeys) {
    const teamCounts = canonicalCountsByPlayer.get(playerKey) || fallbackCountsByPlayer.get(playerKey)
    if (!teamCounts) continue
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
  rowTeamMatchesMatchup,
  getBadTeamAssignmentRows,
  buildSpecialtyPlayerTeamIndex
}
