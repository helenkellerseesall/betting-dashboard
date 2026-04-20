"use strict"

function norm(v) {
  return String(v == null ? "" : v).trim()
}

function normLc(v) {
  return norm(v).toLowerCase()
}

function toNumOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** propType includes "Home Runs" OR HR as a token (avoid "Threes" substring false positives). */
function isHomeRunProp(row) {
  const raw = norm(row?.propType)
  if (!raw) return false
  if (raw.includes("Home Runs")) return true
  const lc = raw.toLowerCase()
  if (lc.includes("home runs") || lc.includes("home run") || lc.includes("homerun")) return true
  return /(?:^|[^a-z])hr(?:$|[^a-z])/i.test(raw)
}

function isFirstBasket(row) {
  const pt = norm(row?.propType)
  return pt.includes("First Basket")
}

function isSpecial(row) {
  const pt = norm(row?.propType)
  const mk = norm(row?.marketKey)
  const checks = [
    "First Basket",
    "First Team Basket",
    "Triple Double",
    "Double Double"
  ]
  if (checks.some((s) => pt.includes(s))) return true
  const hay = `${pt} ${mk}`.toLowerCase()
  return (
    hay.includes("first basket") ||
    hay.includes("first team basket") ||
    hay.includes("triple double") ||
    hay.includes("double double")
  )
}

function isCore(row) {
  const pt = normLc(row?.propType)
  const mk = normLc(row?.marketKey)
  const coreTokens = [
    "points",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "threes",
    "three pointers",
    "pra",
    "points + rebounds",
    "points + assists",
    "rebounds + assists"
  ]
  if (coreTokens.some((t) => pt.includes(t) || mk.includes(t.replace(/\s/g, "")))) return true
  if (mk.includes("player_points") || mk.includes("player_rebounds") || mk.includes("player_assists") || mk.includes("player_threes")) {
    return true
  }
  return false
}

function isLadderProp(row) {
  const pt = normLc(row?.propType)
  const mk = normLc(row?.marketKey)
  const mf = normLc(row?.marketFamily)
  if (mf.includes("ladder")) return true
  if (mk.includes("milestone") || mk.includes("ladder")) return true
  if (pt.includes("quarter") || pt.includes("1st half") || pt.includes("first half") || pt.includes("half ")) return true
  return false
}

/**
 * @returns {"core"|"ladder"|"special"|"hr"}
 */
function classifyPropCategory(row) {
  if (isHomeRunProp(row)) return "hr"
  if (isSpecial(row)) return "special"
  if (isLadderProp(row)) return "ladder"
  if (isCore(row)) return "core"
  return "ladder"
}

function americanToDecimal(odds) {
  const o = toNumOrNull(odds)
  if (o == null || o === 0) return null
  if (o > 0) return 1 + o / 100
  return 1 + 100 / Math.abs(o)
}

function playerKey(row) {
  return normLc(row?.player)
}

/**
 * All 2-leg combos from rows; skips same-player legs; sorted by highest combined decimal odds.
 * @param {object[]} rows
 * @param {{ maxResults?: number, maxInputRows?: number }} [opts]
 */
function build2LegCombos(rows, opts = {}) {
  const maxResults = Number.isFinite(Number(opts.maxResults)) ? Math.max(1, Number(opts.maxResults)) : 20
  const maxInputRows = Number.isFinite(Number(opts.maxInputRows)) ? Math.max(2, Number(opts.maxInputRows)) : 50

  const list = (Array.isArray(rows) ? rows : []).filter(Boolean).slice(0, maxInputRows)
  const out = []

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const pkA = playerKey(a)
      const pkB = playerKey(b)
      if (pkA && pkB && pkA === pkB) continue

      const decA = americanToDecimal(a?.odds)
      const decB = americanToDecimal(b?.odds)
      if (decA == null || decB == null) continue

      const combinedOdds = decA * decB
      const catA = classifyPropCategory(a)
      const catB = classifyPropCategory(b)

      out.push({
        players: [a?.player ?? null, b?.player ?? null],
        teams: [a?.team ?? null, b?.team ?? null],
        odds: [a?.odds ?? null, b?.odds ?? null],
        combinedOdds: Number(combinedOdds.toFixed(4)),
        books: [a?.book ?? null, b?.book ?? null],
        propTypes: [a?.propType ?? null, b?.propType ?? null],
        propCategories: [catA, catB]
      })
    }
  }

  out.sort((x, y) => (y.combinedOdds || 0) - (x.combinedOdds || 0))
  return out.slice(0, maxResults)
}

module.exports = {
  isHomeRunProp,
  isFirstBasket,
  isSpecial,
  isCore,
  isLadderProp,
  classifyPropCategory,
  build2LegCombos
}
