const MARKET_TYPE_RULES = [
  {
    internalType: "First Basket",
    family: "special",
    matches: ["player first basket", "player_first_basket", "first basket", "first_basket", "first scorer", "first_score"]
  },
  {
    internalType: "First Team Basket",
    family: "special",
    matches: ["player first team basket", "player_first_team_basket", "first team basket", "first_team_basket"]
  },
  {
    internalType: "Double Double",
    family: "special",
    matches: ["player double double", "player_double_double", "double double", "double_double"]
  },
  {
    internalType: "Triple Double",
    family: "special",
    matches: ["player triple double", "player_triple_double", "triple double", "triple_double"]
  },
  {
    internalType: "Points Ladder",
    family: "ladder",
    matches: ["player_points_alternate", "alternate points", "alternate_points", "player points alt", "player_points_alt", "25+", "30+", "35+", "40+"]
  },
  {
    internalType: "Rebounds Ladder",
    family: "ladder",
    matches: ["player_rebounds_alternate"]
  },
  {
    internalType: "Assists Ladder",
    family: "ladder",
    matches: ["player_assists_alternate"]
  },
  {
    internalType: "Threes Ladder",
    family: "ladder",
    matches: ["player_threes_alternate", "alternate threes", "alternate_threes", "player threes alt", "player_threes_alt"]
  },
  {
    internalType: "PRA Ladder",
    family: "ladder",
    matches: ["player_points_rebounds_assists_alternate"]
  },
  {
    internalType: "Points",
    family: "standard",
    matches: ["player_points", "points"]
  },
  {
    internalType: "Rebounds",
    family: "standard",
    matches: ["player_rebounds", "rebounds"]
  },
  {
    internalType: "Assists",
    family: "standard",
    matches: ["player_assists", "assists"]
  },
  {
    internalType: "Threes",
    family: "standard",
    matches: ["player_threes", "threes", "3pt", "three pointers"]
  },
  {
    internalType: "PRA",
    family: "standard",
    matches: ["pra", "points+rebounds+assists", "player_pra"]
  }
]

function inferMarketTypeFromKey(marketKey) {
  const normalized = String(marketKey || "").trim().toLowerCase()
  if (!normalized) return { internalType: null, family: "unknown" }

  for (const rule of MARKET_TYPE_RULES) {
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

module.exports = {
  MARKET_TYPE_RULES,
  inferMarketTypeFromKey
}
