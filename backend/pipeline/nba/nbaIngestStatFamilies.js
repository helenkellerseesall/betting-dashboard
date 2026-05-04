"use strict"

/**
 * Canonical ingest buckets for NBA pipeline audits (snapshot raw rows).
 * Order-sensitive: combo / multi-stat keys before bare player_points.
 */

function inferIngestStatFamily(row) {
  if (!row || typeof row !== "object") return "other"
  const mk = String(row.marketKey || "").toLowerCase()
  const canon = String(row.canonicalPropType || "").toLowerCase()

  if (canon.includes("first_basket") || mk.includes("first_basket") || mk.includes("first_team_basket")) {
    return "first_basket"
  }
  if (mk.includes("triple_double") || canon.includes("triple_double")) return "triple_double"
  if (mk.includes("double_double") || canon.includes("double_double")) return "double_double"

  if (
    mk.includes("points_rebounds_assists") ||
    mk.includes("player_pra") ||
    /\bpra\b/.test(canon)
  ) {
    return "combos"
  }
  if (mk.includes("player_points_assists") || mk.includes("player_points_assists_alternate")) return "combos"
  if (mk.includes("player_rebounds_assists") || mk.includes("player_rebounds_assists_alternate")) return "combos"
  if (mk.includes("player_points_rebounds") && !mk.includes("assists")) return "combos"

  if (mk.includes("player_threes") || mk.includes("player_three")) return "threes"
  if (mk.includes("player_assists")) return "assists"
  if (mk.includes("player_rebounds")) return "rebounds"
  if (mk.includes("player_points")) return "points"

  return "other"
}

function countIngestStatFamilies(rows = []) {
  const out = {
    points: 0,
    rebounds: 0,
    assists: 0,
    threes: 0,
    combos: 0,
    first_basket: 0,
    double_double: 0,
    triple_double: 0,
    other: 0,
  }
  for (const r of Array.isArray(rows) ? rows : []) {
    const fam = inferIngestStatFamily(r)
    if (out[fam] != null) out[fam]++
    else out.other++
  }
  return out
}

/** Core + combo must be non-zero for a healthy slate (HARD audit). */
const HARD_REQUIRED_INGEST_FAMILIES = ["points", "rebounds", "assists", "threes", "combos"]

function ingestHardFailures(counts) {
  const c = counts && typeof counts === "object" ? counts : {}
  return HARD_REQUIRED_INGEST_FAMILIES.filter((k) => (Number(c[k]) || 0) === 0)
}

function uniqueMarketKeysFromRows(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => String(r?.marketKey || "").trim()).filter(Boolean))].sort()
}

module.exports = {
  inferIngestStatFamily,
  countIngestStatFamilies,
  ingestHardFailures,
  uniqueMarketKeysFromRows,
  HARD_REQUIRED_INGEST_FAMILIES,
}
