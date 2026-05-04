"use strict"

const { statFamilyKey } = require("./nbaAiOutcomeRange")

/** @typedef {'points'|'rebounds'|'assists'|'threes'|'pra'|'points_rebounds'|'points_assists'|'rebounds_assists'|'first_basket'|'first_team_basket'|'double_double'|'triple_double'} PropLaneKey */

const CORE_LANES = new Set(["points", "rebounds", "assists", "threes"])
const COMBO_LANES = new Set(["pra", "points_rebounds", "points_assists", "rebounds_assists"])
const SPECIAL_LANES = new Set(["first_basket", "first_team_basket", "double_double", "triple_double"])

/**
 * Stable lane key for AI pick routing (ingest `canonicalPropType` when present; else market/stat inference).
 * @returns {PropLaneKey|null}
 */
function inferPropLaneKey(row) {
  if (!row || typeof row !== "object") return null
  const canon = String(row.canonicalPropType || "").trim().toLowerCase()
  if (CORE_LANES.has(canon) || COMBO_LANES.has(canon) || SPECIAL_LANES.has(canon)) return /** @type {PropLaneKey} */ (canon)

  const mk = String(row.marketKey || "").toLowerCase()
  const pt = String(row.propType || "").toLowerCase()

  if (mk.includes("first_team_basket") || pt.includes("first team basket")) return "first_team_basket"
  if (mk.includes("player_first_basket") || (pt.includes("first basket") && !pt.includes("team"))) return "first_basket"
  if (mk.includes("double_double") || pt.includes("double double")) return "double_double"
  if (mk.includes("triple_double") || pt.includes("triple double")) return "triple_double"

  if (mk.includes("points_rebounds_assists") || statFamilyKey(row) === "pra") return "pra"

  if (statFamilyKey(row) === "combo" || statFamilyKey(row) === "alt_combo") {
    if (mk.includes("points_rebounds_assists")) return "pra"
    if (mk.includes("points_rebounds") && !mk.includes("assists")) return "points_rebounds"
    if (mk.includes("points_assists") && !mk.includes("rebounds")) return "points_assists"
    if (mk.includes("rebounds_assists") && !mk.includes("points")) return "rebounds_assists"
    if (pt.includes("points + rebounds") && !pt.includes("assist")) return "points_rebounds"
    if (pt.includes("points + assists") && !pt.includes("rebound")) return "points_assists"
    if (pt.includes("rebounds + assists") && !pt.includes("point")) return "rebounds_assists"
    return null
  }

  const fam = statFamilyKey(row)
  if (fam === "points") return "points"
  if (fam === "rebounds") return "rebounds"
  if (fam === "assists") return "assists"
  if (fam === "threes") return "threes"
  if (fam === "pra") return "pra"
  if (fam === "first_basket") return "first_basket"
  if (fam === "double_double") return "double_double"
  if (fam === "triple_double") return "triple_double"

  return null
}

function sortByCompositeRankDesc(rows, scoreFn) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => scoreFn(b) - scoreFn(a))
}

/**
 * @param {object[]} rankedCandidatePool
 * @param {(c: object) => number} compositeRankScore
 */
function splitRankedPoolByLane(rankedCandidatePool, compositeRankScore) {
  const core = []
  const combo = []
  const special = []
  const other = []
  for (const c of Array.isArray(rankedCandidatePool) ? rankedCandidatePool : []) {
    const lane = inferPropLaneKey(c)
    if (CORE_LANES.has(lane)) core.push({ ...c, aiPropLane: lane })
    else if (COMBO_LANES.has(lane)) combo.push({ ...c, aiPropLane: lane })
    else if (SPECIAL_LANES.has(lane)) special.push({ ...c, aiPropLane: lane })
    else other.push(c)
  }
  return {
    coreCandidates: sortByCompositeRankDesc(core, compositeRankScore),
    comboCandidates: sortByCompositeRankDesc(combo, compositeRankScore),
    specialCandidates: sortByCompositeRankDesc(special, compositeRankScore),
    otherRows: other,
  }
}

module.exports = {
  CORE_LANES,
  COMBO_LANES,
  SPECIAL_LANES,
  inferPropLaneKey,
  splitRankedPoolByLane,
}
