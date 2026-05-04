/**
 * NBA (and shared) market classification for Odds API `market.key` strings.
 * Order matters: exact multi-stat and alternate keys before any `player_points` substring rule.
 */

const MARKET_TYPE_RULES = [
  {
    internalType: "First Basket",
    family: "special",
    matches: ["player first basket", "player_first_basket", "first basket", "first_basket", "first scorer", "first_score"],
  },
  {
    internalType: "First Team Basket",
    family: "special",
    matches: ["player first team basket", "player_first_team_basket", "first team basket", "first_team_basket"],
  },
  {
    internalType: "Double Double",
    family: "special",
    matches: ["player double double", "player_double_double", "double double", "double_double"],
  },
  {
    internalType: "Triple Double",
    family: "special",
    matches: ["player triple double", "player_triple_double", "triple double", "triple_double"],
  },
  {
    internalType: "PRA Ladder",
    family: "ladder",
    matches: ["player_points_rebounds_assists_alternate"],
  },
  {
    internalType: "Points + Rebounds Ladder",
    family: "ladder",
    matches: ["player_points_rebounds_alternate"],
  },
  {
    internalType: "Points + Assists Ladder",
    family: "ladder",
    matches: ["player_points_assists_alternate"],
  },
  {
    internalType: "Rebounds + Assists Ladder",
    family: "ladder",
    matches: ["player_rebounds_assists_alternate"],
  },
  {
    internalType: "Points Ladder",
    family: "ladder",
    matches: [
      "player_points_alternate",
      "alternate points",
      "alternate_points",
      "player points alt",
      "player_points_alt",
      "25+",
      "30+",
      "35+",
      "40+",
    ],
  },
  {
    internalType: "Rebounds Ladder",
    family: "ladder",
    matches: ["player_rebounds_alternate"],
  },
  {
    internalType: "Assists Ladder",
    family: "ladder",
    matches: ["player_assists_alternate"],
  },
  {
    internalType: "Threes Ladder",
    family: "ladder",
    matches: ["player_threes_alternate", "alternate threes", "alternate_threes", "player threes alt", "player_threes_alt"],
  },
  {
    internalType: "PRA",
    family: "standard",
    matches: ["player_points_rebounds_assists", "player_pra", "points+rebounds+assists"],
  },
  {
    internalType: "Points + Rebounds",
    family: "standard",
    matches: ["player_points_rebounds"],
  },
  {
    internalType: "Points + Assists",
    family: "standard",
    matches: ["player_points_assists"],
  },
  {
    internalType: "Rebounds + Assists",
    family: "standard",
    matches: ["player_rebounds_assists"],
  },
  {
    internalType: "Points",
    family: "standard",
    matches: ["player_points", "points"],
  },
  {
    internalType: "Rebounds",
    family: "standard",
    matches: ["player_rebounds", "rebounds"],
  },
  {
    internalType: "Assists",
    family: "standard",
    matches: ["player_assists", "assists"],
  },
  {
    internalType: "Threes",
    family: "standard",
    matches: ["player_threes", "threes", "3pt", "three pointers"],
  },
]

/** Exact Odds API keys first (avoids `player_points` matching `player_points_rebounds_assists`). */
const NBA_EXACT_MARKET_MAP = [
  ["player_points_rebounds_assists_alternate", { internalType: "PRA Ladder", family: "ladder" }],
  ["player_points_rebounds_alternate", { internalType: "Points + Rebounds Ladder", family: "ladder" }],
  ["player_points_assists_alternate", { internalType: "Points + Assists Ladder", family: "ladder" }],
  ["player_rebounds_assists_alternate", { internalType: "Rebounds + Assists Ladder", family: "ladder" }],
  ["player_points_rebounds_assists", { internalType: "PRA", family: "standard" }],
  ["player_points_rebounds", { internalType: "Points + Rebounds", family: "standard" }],
  ["player_points_assists", { internalType: "Points + Assists", family: "standard" }],
  ["player_rebounds_assists", { internalType: "Rebounds + Assists", family: "standard" }],
  ["player_points_alternate", { internalType: "Points Ladder", family: "ladder" }],
  ["player_rebounds_alternate", { internalType: "Rebounds Ladder", family: "ladder" }],
  ["player_assists_alternate", { internalType: "Assists Ladder", family: "ladder" }],
  ["player_threes_alternate", { internalType: "Threes Ladder", family: "ladder" }],
  ["player_first_team_basket", { internalType: "First Team Basket", family: "special" }],
  ["player_first_basket", { internalType: "First Basket", family: "special" }],
  ["player_double_double", { internalType: "Double Double", family: "special" }],
  ["player_triple_double", { internalType: "Triple Double", family: "special" }],
  ["player_points", { internalType: "Points", family: "standard" }],
  ["player_rebounds", { internalType: "Rebounds", family: "standard" }],
  ["player_assists", { internalType: "Assists", family: "standard" }],
  ["player_threes", { internalType: "Threes", family: "standard" }],
  ["player_three", { internalType: "Threes", family: "standard" }],
]

function inferMarketTypeFromKey(marketKey) {
  const k = String(marketKey || "").trim().toLowerCase()
  if (!k) return { internalType: null, family: "unknown" }

  for (const [exact, res] of NBA_EXACT_MARKET_MAP) {
    if (k === exact) return { ...res }
  }

  // Quarter / derivative markets that share a prefix (e.g. player_points_q1)
  if (k.startsWith("player_points_rebounds_assists")) return { internalType: "PRA", family: "standard" }
  if (k.startsWith("player_points_rebounds") && !k.includes("assists")) {
    return { internalType: "Points + Rebounds", family: "standard" }
  }
  if (k.startsWith("player_points_assists") && !k.includes("rebounds")) {
    return { internalType: "Points + Assists", family: "standard" }
  }
  if (k.startsWith("player_rebounds_assists") && !k.includes("points")) {
    return { internalType: "Rebounds + Assists", family: "standard" }
  }
  if (k.startsWith("player_points") && k !== "player_points" && !k.includes("rebounds") && !k.includes("assists")) {
    return { internalType: "Points", family: "standard" }
  }
  if (k.startsWith("player_threes") || k.startsWith("player_three")) {
    return { internalType: "Threes", family: "standard" }
  }
  if (k.startsWith("player_assists")) return { internalType: "Assists", family: "standard" }
  if (k.startsWith("player_rebounds")) return { internalType: "Rebounds", family: "standard" }

  for (const rule of MARKET_TYPE_RULES) {
    if (rule.matches.some((needle) => k.includes(String(needle).toLowerCase()))) {
      return {
        internalType: rule.internalType,
        family: rule.family,
      }
    }
  }

  return {
    internalType: null,
    family: "unknown",
  }
}

/**
 * Canonical prop bucket for dashboards / pool checks (snake_case).
 * Does not replace `propType` / `marketKey` used by the model.
 */
function canonicalPropTypeFromInferred(internalType, marketKey) {
  const t = String(internalType || "").trim()
  const mk = String(marketKey || "").toLowerCase()

  if (t === "First Basket") return "first_basket"
  if (t === "First Team Basket") return "first_team_basket"
  if (t === "Double Double") return "double_double"
  if (t === "Triple Double") return "triple_double"
  if (t === "PRA" || t === "PRA Ladder") return "pra"
  if (t === "Points + Rebounds" || t === "Points + Rebounds Ladder") return "points_rebounds"
  if (t === "Points + Assists" || t === "Points + Assists Ladder") return "points_assists"
  if (t === "Rebounds + Assists" || t === "Rebounds + Assists Ladder") return "rebounds_assists"
  if (t === "Points" || t === "Points Ladder") return "points"
  if (t === "Rebounds" || t === "Rebounds Ladder") return "rebounds"
  if (t === "Assists" || t === "Assists Ladder") return "assists"
  if (t === "Threes" || t === "Threes Ladder") return "threes"

  if (mk.includes("first_basket") && !mk.includes("team")) return "first_basket"
  if (mk.includes("double_double")) return "double_double"
  if (mk.includes("triple_double")) return "triple_double"
  if (mk.includes("points_rebounds_assists")) return "pra"
  if (mk.includes("points_rebounds") && !mk.includes("assists")) return "points_rebounds"
  if (mk.includes("points_assists") && !mk.includes("rebounds")) return "points_assists"
  if (mk.includes("rebounds_assists") && !mk.includes("points")) return "rebounds_assists"

  return "other"
}

module.exports = {
  MARKET_TYPE_RULES,
  inferMarketTypeFromKey,
  canonicalPropTypeFromInferred,
}
