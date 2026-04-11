"use strict"

function toKey(value, fallback = "unknown") {
  const key = String(value == null ? "" : value).trim()
  return key || fallback
}

function countBy(rows, keyFn) {
  const bucket = {}
  const safeRows = Array.isArray(rows) ? rows : []
  for (const row of safeRows) {
    const key = toKey(keyFn(row))
    bucket[key] = Number(bucket[key] || 0) + 1
  }
  return bucket
}

function sortCountEntries(countMap, limit = 25) {
  return Object.entries(countMap || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Number(limit) || 25))
    .map(([key, count]) => ({ key, count }))
}

function isLikelyMatchupLabel(value) {
  const text = String(value || "").trim()
  if (!text) return false
  const lower = text.toLowerCase()
  return lower.includes("@") || lower.includes(" vs ") || lower.includes(" vs.")
}

function buildPlayerTeamIndex(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const playerTeamCounts = {}

  for (const row of safeRows) {
    const player = String(row?.player || "").trim()
    const team = String(row?.team || row?.teamResolved || row?.teamName || row?.teamCode || "").trim()
    if (!player || !team || isLikelyMatchupLabel(team)) continue

    if (!playerTeamCounts[player]) playerTeamCounts[player] = {}
    playerTeamCounts[player][team] = Number(playerTeamCounts[player][team] || 0) + 1
  }

  const out = {}
  for (const [player, teamCounts] of Object.entries(playerTeamCounts)) {
    const winner = Object.entries(teamCounts).sort((a, b) => b[1] - a[1])[0]
    if (winner?.[0]) out[player] = winner[0]
  }

  return out
}

function inferSurfaceTeamLabel(row, playerTeamIndex = {}) {
  const directCandidates = [row?.team, row?.teamResolved, row?.teamName, row?.teamCode]
  for (const candidate of directCandidates) {
    const directTeam = String(candidate || "").trim()
    if (directTeam && !isLikelyMatchupLabel(directTeam)) return directTeam
  }

  const player = String(row?.player || "").trim()
  if (player && playerTeamIndex[player]) return playerTeamIndex[player]

  return null
}

function compactMlbRow(row, options = {}) {
  const playerTeamIndex = options.playerTeamIndex || {}
  return {
    eventId: row?.eventId || null,
    matchup: row?.matchup || null,
    gameTime: row?.gameTime || null,
    team: inferSurfaceTeamLabel(row, playerTeamIndex),
    awayTeam: row?.awayTeam || null,
    homeTeam: row?.homeTeam || null,
    book: row?.book || null,
    marketKey: row?.marketKey || null,
    marketFamily: row?.marketFamily || null,
    propType: row?.propType || null,
    player: row?.player || null,
    side: row?.side || null,
    line: row?.line,
    odds: row?.odds,
    isPitcherMarket: row?.isPitcherMarket === true,
    teamMatchesMatchup: row?.teamMatchesMatchup !== false
  }
}

function toNumberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function impliedProbabilityFromAmerican(odds) {
  const n = toNumberOrNull(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n > 0) return 100 / (n + 100)
  return Math.abs(n) / (Math.abs(n) + 100)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeMarketShapeSignal(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const line = toNumberOrNull(row?.line)

  if (marketKey === "h2h") return 0.18
  if (marketKey === "spreads") {
    if (!Number.isFinite(line)) return 0.04
    if (Math.abs(line) <= 2.5) return 0.16
    if (Math.abs(line) <= 4.5) return 0.1
    return 0.02
  }
  if (marketKey === "totals") {
    if (!Number.isFinite(line)) return 0.04
    if (line >= 7 && line <= 10.5) return 0.15
    return 0.06
  }

  // For props, small half-line thresholds are generally more stable than long tails.
  if (!Number.isFinite(line)) return 0.03
  if (line <= 1.5) return 0.15
  if (line <= 2.5) return 0.11
  if (line <= 3.5) return 0.08
  return 0.04
}

function isAlternateMarketKey(marketKey) {
  const mk = String(marketKey || "").toLowerCase()
  return mk.includes("alternate") || mk.endsWith("_alt") || mk.endsWith("_alternate")
}

function toMarketBaseKey(marketKey) {
  const mk = String(marketKey || "").toLowerCase().trim()
  if (!mk) return ""
  return mk
    .replace(/_alternate$/g, "")
    .replace(/_alt$/g, "")
    .replace(/alternate/g, "")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function buildPrimaryMarketIndex(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const index = new Set()

  for (const row of safeRows) {
    const marketKey = String(row?.marketKey || "")
    const isAlt = isAlternateMarketKey(marketKey) || String(row?.marketFamily || "") === "ladder"
    if (isAlt) continue

    const player = toKey(row?.player, "")
    const baseKey = toMarketBaseKey(marketKey)
    const side = toKey(row?.side, "")
    if (!player || !baseKey) continue

    index.add([player, baseKey, side].join("|"))
  }

  return index
}

function computeTrivialAlternatePenalty(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const line = toNumberOrNull(row?.line)
  const side = String(row?.side || "").toLowerCase()
  const isAlt = isAlternateMarketKey(marketKey) || String(row?.marketFamily || "") === "ladder"
  if (!isAlt || !Number.isFinite(line)) return 0

  if (marketKey.includes("batter_hits") && side === "over" && line <= 0.5) return 0.24
  if (marketKey.includes("total_bases") && side === "over" && line <= 1.5) return 0.16
  if (marketKey.includes("pitcher_strikeouts") && side === "over" && line <= 2.5) return 0.28
  if (marketKey.includes("pitcher_strikeouts") && side === "over" && line <= 3.5) return 0.18
  if (side === "over" && line <= 0.5) return 0.12

  return 0
}

function computeHeavyFavoritePenalty(odds) {
  const n = toNumberOrNull(odds)
  if (!Number.isFinite(n) || n >= 0) return 0

  const absOdds = Math.abs(n)
  if (absOdds <= 220) return 0
  if (absOdds <= 350) return 0.05
  if (absOdds <= 500) return 0.1
  if (absOdds <= 900) return 0.16
  return 0.22
}

function computeLowInformationPenalty(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const line = toNumberOrNull(row?.line)
  const side = String(row?.side || "").toLowerCase()
  if (!Number.isFinite(line)) return 0

  if (side === "under" && line <= 0.5 && (marketKey.includes("rbis") || marketKey.includes("home_runs"))) {
    return 0.1
  }

  return 0
}

function computePositiveProductionBonus(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const side = String(row?.side || "").toLowerCase()
  const line = toNumberOrNull(row?.line)

  if (!(side === "over" || side === "yes" || side === "to hit" || side === "hit")) return 0

  if (marketKey.includes("home_run") || marketKey.includes("home_runs")) return 0.16
  if (marketKey === "batter_total_bases" && Number.isFinite(line) && line >= 1.5) return 0.08
  if (marketKey.includes("batter_total_bases_alternate") && Number.isFinite(line) && line >= 1.5) return 0.06
  if (marketKey === "batter_rbis" && Number.isFinite(line) && line >= 0.5) return 0.08
  if (marketKey === "batter_runs_scored" && Number.isFinite(line) && line >= 0.5) return 0.08
  if (marketKey.includes("batter_hits_alternate") && Number.isFinite(line) && line >= 1.5) return 0.06

  return 0
}

// Penalise props that represent negative outcomes or near-zero player production.
// These contaminate "best hitter" and "best pitcher" lanes with low-value rows.
function computeNegativeDirectionalPropPenalty(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const side = String(row?.side || "").toLowerCase()
  const line = toNumberOrNull(row?.line)
  const isAlt = isAlternateMarketKey(marketKey) || String(row?.marketFamily || "") === "ladder"

  // Hitter: trivially weak "get any hit" prop (primary standard only; alts already hit by trivialAltPenalty)
  if (marketKey === "batter_hits" && side === "over" && !isAlt && Number.isFinite(line) && line <= 0.5) return 0.20

  // Hitter: betting a player gets NO hits — not a quality hitter pick
  if (marketKey === "batter_hits" && side === "under") return 0.28

  // Hitter: betting zero total-bases production (primary standard)
  if (marketKey === "batter_total_bases" && side === "under" && !isAlt && Number.isFinite(line) && line <= 1.5) return 0.16

  // Hitter: betting a player doesn't walk — low-value direction for a "best hitter" lane
  if (marketKey === "batter_walks" && side === "under") return 0.14

  // Hitter: under-0.5 production markets are weak filler for best hitter lane quality.
  if (marketKey === "batter_runs_scored" && side === "under" && Number.isFinite(line) && line <= 0.5) return 0.24
  if (marketKey === "batter_rbis" && side === "under" && Number.isFinite(line) && line <= 0.5) return 0.22
  if (marketKey.includes("home_runs") && side === "under") return 0.28

  // Pitcher: bad-outcome props — pitcher gives up runs, walks batters, allows hits, or gets pulled early
  if (marketKey.includes("pitcher_earned_runs") && side === "over") return 0.22
  if (marketKey.includes("pitcher_outs") && side === "under") return 0.20
  if (marketKey.includes("pitcher_strikeouts") && side === "under" && !isAlt) return 0.18
  if (marketKey.includes("pitcher_hits_allowed") && side === "over") return 0.16
  if (marketKey.includes("pitcher_walks") && side === "over") return 0.16

  return 0
}

/**
 * Classify a row as "safe" (floor/stable) or "upside" (value/aggressive) or null.
 *
 * Safe:
 *   - Primary standard market (not alternate/ladder)
 *   - Implied probability 52-78% (roughly -110 to -255)
 *   - Odds no worse than -320, no wilder than +150
 *
 * Upside:
 *   - Implied probability 38-62% (roughly -163 to +163)
 *   - Odds between -165 and +380
 *   - Allows alternate/ladder at meaningful (non-trivial) lines
 *   - Also includes primary markets at even/slight-plus prices
 *
 * Hard excludes from both:
 *   - Odds worse than -600 or better than +500
 *   - Trivially easy alt-overs (batter_hits alt <=0.5, pitcher_strikeouts alt <=2.5, total_bases alt <=1.5)
 */
function classifyRowTier(row) {
  const odds = toNumberOrNull(row?.odds)
  if (!Number.isFinite(odds)) return null

  const implied = impliedProbabilityFromAmerican(odds)
  if (implied == null) return null

  const marketKey = String(row?.marketKey || "").toLowerCase()
  const family = String(row?.marketFamily || "")
  const isAlt = isAlternateMarketKey(marketKey) || family === "ladder"
  const line = toNumberOrNull(row?.line)
  const side = String(row?.side || "").toLowerCase()

  // Hard excludes: absurd chalk or absurd longshot
  if (odds < -600) return null
  if (odds > 500) return null

  // Hard exclude trivially easy alt-overs from both tiers
  if (isAlt && side === "over" && Number.isFinite(line)) {
    if (marketKey.includes("batter_hits") && line <= 0.5) return null
    if (marketKey.includes("pitcher_strikeouts") && line <= 2.5) return null
    if (marketKey.includes("total_bases") && line <= 1.5) return null
  }

  // Safe tier: primary standard market at moderate familiar price
  if (!isAlt && family === "standard") {
    const inSafePrice = odds >= -320 && odds <= 150
    const inSafeImplied = implied >= 0.52 && implied <= 0.78
    if (inSafePrice && inSafeImplied) return "safe"
  }

  // Upside tier: value-band pricing; allows alts at meaningful lines or primary at near-even/plus
  const inUpsidePrice = odds >= -165 && odds <= 380
  const inUpsideImplied = implied >= 0.38 && implied <= 0.62
  if (inUpsidePrice && inUpsideImplied) return "upside"

  return null
}

function buildBalancedOverallBoard({ bestHitters, bestPitchers, bestSpecials, bestGameMarkets, maxRows }) {
  const hitters = Array.isArray(bestHitters) ? bestHitters : []
  const pitchers = Array.isArray(bestPitchers) ? bestPitchers : []
  const specials = Array.isArray(bestSpecials) ? bestSpecials : []
  const games = Array.isArray(bestGameMarkets) ? bestGameMarkets : []
  const limit = Math.max(1, Number(maxRows) || 10)

  const minTargets = {
    hitters: Math.min(hitters.length, Math.max(1, Math.floor(limit * 0.25))),
    pitchers: Math.min(pitchers.length, Math.max(1, Math.floor(limit * 0.25))),
    games: Math.min(games.length, Math.max(1, Math.floor(limit * 0.16))),
    specials: Math.min(specials.length, Math.max(1, Math.floor(limit * 0.08)))
  }

  const out = []
  const seen = new Set()

  function pushUnique(rows, count) {
    if (!Array.isArray(rows) || count <= 0) return
    for (const row of rows) {
      if (count <= 0) break
      const key = buildCandidateKey(row)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
      count -= 1
      if (out.length >= limit) break
    }
  }

  pushUnique(hitters, minTargets.hitters)
  pushUnique(pitchers, minTargets.pitchers)
  pushUnique(games, minTargets.games)
  pushUnique(specials, minTargets.specials)

  const remainder = [...hitters, ...pitchers, ...games, ...specials]
    .sort((a, b) => Number(b?.surfaceScore || 0) - Number(a?.surfaceScore || 0))

  for (const row of remainder) {
    if (out.length >= limit) break
    const key = buildCandidateKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }

  return out.slice(0, limit)
}

function getBookStrengthMap(rows) {
  const byBook = countBy(rows, (row) => row?.book)
  const maxCount = Math.max(1, ...Object.values(byBook))
  const out = {}
  for (const [book, count] of Object.entries(byBook)) {
    out[book] = clamp(Number(count || 0) / maxCount, 0.1, 1)
  }
  return out
}

function buildCandidateKey(row) {
  return [
    toKey(row?.player, ""),
    toKey(row?.marketKey, ""),
    toKey(row?.side, ""),
    String(row?.line ?? ""),
    toKey(row?.book, "")
  ].join("|")
}

function rankRows(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxRows = Number.isFinite(options.maxRows) ? Math.max(1, Number(options.maxRows)) : 12
  const groupType = String(options.groupType || "")
  const perMarketKeyMax = Number.isFinite(options.perMarketKeyMax)
    ? Math.max(1, Number(options.perMarketKeyMax))
    : (
      groupType === "pitchers" ? 2 :
      groupType === "overall" ? 2 :
      groupType === "hitters" ? 2 :
      groupType === "specials" ? 2 :
      4
    )

  const matchupCounts = countBy(safeRows, (row) => row?.matchup)
  const maxMatchupCount = Math.max(1, ...Object.values(matchupCounts))
  const bookStrength = getBookStrengthMap(safeRows)
  const primaryMarketIndex = buildPrimaryMarketIndex(safeRows)

  const scored = safeRows
    .map((row) => {
      const implied = impliedProbabilityFromAmerican(row?.odds)
      const impliedSignal = implied == null ? 0.18 : clamp((implied - 0.44) / 0.32, 0, 1)
      const valueBandSignal = implied == null
        ? 0.3
        : clamp(1 - (Math.abs(implied - 0.58) / 0.28), 0, 1)

      const odds = toNumberOrNull(row?.odds)
      const priceModerationSignal = Number.isFinite(odds)
        ? (odds > 0
          ? clamp(1 - ((odds - 125) / 700), 0.2, 0.95)
          : clamp(1 - ((Math.abs(odds) - 150) / 500), 0, 0.95))
        : 0.3

      const shapeSignal = normalizeMarketShapeSignal(row)
      const bookSignal = bookStrength[toKey(row?.book, "unknown")] || 0.25
      const matchupSignal = clamp(1 - ((Number(matchupCounts[toKey(row?.matchup, "unknown")] || 1) - 1) / maxMatchupCount), 0.35, 1)

      const marketKey = String(row?.marketKey || "")
      const baseKey = toMarketBaseKey(marketKey)
      const player = toKey(row?.player, "")
      const side = toKey(row?.side, "")
      const isAlt = isAlternateMarketKey(marketKey) || String(row?.marketFamily || "") === "ladder"
      const primaryMarketSignal = isAlt
        ? (primaryMarketIndex.has([player, baseKey, side].join("|")) ? 0.08 : 0.24)
        : 0.92

      const family = String(row?.marketFamily || "")
      const familyBonus =
        groupType === "specials" && family === "special" ? 0.14 :
        groupType === "game" && family === "game" ? 0.14 :
        groupType === "hitters" && row?.isPitcherMarket !== true ? 0.14 :
        groupType === "pitchers" && row?.isPitcherMarket === true ? 0.14 :
        0

      const trivialAltPenalty = computeTrivialAlternatePenalty(row)
      const heavyFavoritePenalty = computeHeavyFavoritePenalty(odds)
      const lowInformationPenalty = computeLowInformationPenalty(row)
      const negativeDirectionalPenalty = computeNegativeDirectionalPropPenalty(row)
      const positiveProductionBonus = computePositiveProductionBonus(row)

      const score = Number((
        (impliedSignal * 0.2) +
        (valueBandSignal * 0.22) +
        (priceModerationSignal * 0.15) +
        (shapeSignal * 0.15) +
        (primaryMarketSignal * 0.16) +
        (bookSignal * 0.06) +
        (matchupSignal * 0.06) +
        familyBonus +
        positiveProductionBonus -
        trivialAltPenalty -
        heavyFavoritePenalty -
        lowInformationPenalty -
        negativeDirectionalPenalty
      ).toFixed(4))

      return {
        row,
        surfaceScore: score
      }
    })
    .sort((a, b) => b.surfaceScore - a.surfaceScore)

  const deduped = []
  const seen = new Set()
  const perMatchup = {}
  const perPlayer = {}
  const perBook = {}
  const perMarketKey = {}

  for (const candidate of scored) {
    const row = candidate.row
    const key = buildCandidateKey(row)
    if (seen.has(key)) continue

    const matchup = toKey(row?.matchup, "unknown")
    const player = toKey(row?.player, "")
    const book = toKey(row?.book, "unknown")
    const marketKey = toKey(row?.marketKey, "unknown")

    if (Number(perMatchup[matchup] || 0) >= 2) continue
    if (player && Number(perPlayer[player] || 0) >= 1) continue
    if (Number(perBook[book] || 0) >= (groupType === "overall" ? 3 : 4)) continue
    if (Number(perMarketKey[marketKey] || 0) >= perMarketKeyMax) continue

    seen.add(key)
    perMatchup[matchup] = Number(perMatchup[matchup] || 0) + 1
    if (player) perPlayer[player] = Number(perPlayer[player] || 0) + 1
    perBook[book] = Number(perBook[book] || 0) + 1
    perMarketKey[marketKey] = Number(perMarketKey[marketKey] || 0) + 1

    deduped.push({
      ...compactMlbRow(row, { playerTeamIndex: options.playerTeamIndex }),
      surfaceScore: candidate.surfaceScore
    })

    if (deduped.length >= maxRows) break
  }

  return deduped
}

function isHomeRunMarketRow(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "").toLowerCase()
  return marketKey.includes("home_run") || marketKey.includes("home_runs") || propType.includes("home run")
}

function isFirstHomeRunSpecialRow(row) {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "").toLowerCase()
  return marketKey.includes("first_home_run") || propType.includes("first home run")
}

function isStandardHomeRunPropRow(row) {
  if (!isHomeRunMarketRow(row)) return false
  if (isFirstHomeRunSpecialRow(row)) return false

  const family = String(row?.marketFamily || "")
  return family === "standard" || family === "ladder"
}

function isHomeRunProxyCandidateRow(row) {
  if (row?.isPitcherMarket === true) return false
  if (isFirstHomeRunSpecialRow(row)) return false

  const family = String(row?.marketFamily || "")
  if (family !== "standard" && family !== "ladder") return false

  const marketKey = String(row?.marketKey || "").toLowerCase()
  const side = String(row?.side || "").toLowerCase()
  const line = toNumberOrNull(row?.line)
  const odds = toNumberOrNull(row?.odds)

  if (!(side === "over" || side === "yes")) return false
  if (!Number.isFinite(odds) || odds < 100 || odds > 1000) return false

  if (marketKey === "batter_total_bases" && Number.isFinite(line) && line >= 1.5) return true
  if (marketKey.includes("batter_total_bases_alternate") && Number.isFinite(line) && line >= 1.5) return true
  if (marketKey === "batter_rbis" && Number.isFinite(line) && line >= 0.5) return true
  if (marketKey === "batter_runs_scored" && Number.isFinite(line) && line >= 0.5) return true
  if (marketKey.includes("batter_hits_alternate") && Number.isFinite(line) && line >= 1.5) return true

  return false
}

function getHomeRunProxyTier(row) {
  if (isStandardHomeRunPropRow(row)) return "hr"
  if (!isHomeRunProxyCandidateRow(row)) return null

  const marketKey = String(row?.marketKey || "").toLowerCase()
  const line = toNumberOrNull(row?.line)

  if (marketKey.includes("batter_total_bases_alternate") && Number.isFinite(line) && line >= 2.5) return "strong"
  if (marketKey === "batter_total_bases" && Number.isFinite(line) && line >= 2.5) return "strong"

  if (marketKey.includes("batter_total_bases_alternate") && Number.isFinite(line) && line >= 1.5) return "medium"
  if (marketKey === "batter_total_bases" && Number.isFinite(line) && line >= 1.5) return "medium"
  if (marketKey === "batter_rbis" && Number.isFinite(line) && line >= 0.5) return "medium"
  if (marketKey === "batter_runs_scored" && Number.isFinite(line) && line >= 0.5) return "medium"

  if (marketKey.includes("batter_hits_alternate") && Number.isFinite(line) && line >= 1.5) return "soft"

  return null
}

function proxyTierWeight(tier) {
  if (tier === "hr") return 1
  if (tier === "strong") return 0.9
  if (tier === "medium") return 0.74
  if (tier === "soft") return 0.52
  return 0
}

function computeHomeRunPayoutSignal(odds) {
  const n = toNumberOrNull(odds)
  if (!Number.isFinite(n)) return 0

  // Keep bombs realistic: reward meaningful plus-money while discounting extreme tails.
  if (n >= 450 && n <= 1200) return 1
  if (n >= 300 && n < 450) return 0.82
  if (n > 1200 && n <= 1800) return 0.7
  if (n > 1800 && n <= 2200) return 0.42
  if (n >= 200 && n < 300) return 0.54
  return 0.2
}

function buildBestHomeRunPlays(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxRows = Number.isFinite(options.maxRows) ? Math.max(1, Number(options.maxRows)) : 6

  const trueHomeRunRows = safeRows.filter((row) => {
    if (!isStandardHomeRunPropRow(row)) return false

    const player = String(row?.player || "").trim()
    const side = String(row?.side || "").toLowerCase()
    const odds = toNumberOrNull(row?.odds)
    if (!player || !Number.isFinite(odds)) return false

    if (!(side === "yes" || side === "over" || side === "to hit" || side === "hit")) return false

    // Avoid fake bombs and dead chalk.
    if (odds < 200 || odds > 2200) return false

    return true
  })

  const strongProxyRows = safeRows.filter((row) => getHomeRunProxyTier(row) === "strong")
  const mediumProxyRows = safeRows.filter((row) => getHomeRunProxyTier(row) === "medium")
  const softProxyRows = safeRows.filter((row) => getHomeRunProxyTier(row) === "soft")

  let homeRunRows = [...trueHomeRunRows, ...strongProxyRows, ...mediumProxyRows]
  if (homeRunRows.length < maxRows) {
    homeRunRows = [...homeRunRows, ...softProxyRows]
  }

  // Hard correction: if the live feed has no standard HR markets tonight,
  // fall back to strong HR-proxy hitter production rows instead of surfacing an empty lane.
  if (!homeRunRows.length) {
    homeRunRows = safeRows.filter((row) => isHomeRunProxyCandidateRow(row))
  }

  const byBook = countBy(homeRunRows, (row) => row?.book)
  const maxBookCount = Math.max(1, ...Object.values(byBook))
  const playerMarketCounts = countBy(homeRunRows, (row) => [toKey(row?.player, ""), toMarketBaseKey(row?.marketKey), toKey(row?.side, "")].join("|"))
  const maxPlayerMarketCount = Math.max(1, ...Object.values(playerMarketCounts))

  const scored = homeRunRows
    .map((row) => {
      const odds = toNumberOrNull(row?.odds)
      const implied = impliedProbabilityFromAmerican(odds)
      const marketKey = String(row?.marketKey || "").toLowerCase()
      const line = toNumberOrNull(row?.line)
      const proxyTier = getHomeRunProxyTier(row)
      const isProxy = proxyTier !== "hr"

      const hrPathSignal = implied == null ? 0.25 : clamp((implied - 0.05) / 0.13, 0, 1)
      const payoutSignal = computeHomeRunPayoutSignal(odds)
      const marketTypeSignal = proxyTierWeight(proxyTier)
      const lineSignal = Number.isFinite(line)
        ? (line >= 0.5 && line <= 1.5 ? 1 : 0.68)
        : 0.88

      const consensusKey = [toKey(row?.player, ""), toMarketBaseKey(row?.marketKey), toKey(row?.side, "")].join("|")
      const consensusSignal = clamp(Number(playerMarketCounts[consensusKey] || 1) / maxPlayerMarketCount, 0.25, 1)
      const bookSignal = clamp(Number(byBook[toKey(row?.book, "unknown")] || 1) / maxBookCount, 0.2, 1)

      const extremeLongshotPenalty = Number.isFinite(odds) && odds > 1700 ? 0.14 : 0
      const proxyPenalty =
        proxyTier === "soft" ? 0.14 :
        proxyTier === "medium" ? 0.08 :
        proxyTier === "strong" ? 0.03 :
        0

      const homeRunPathScore = Number((
        (hrPathSignal * 0.28) +
        (payoutSignal * 0.24) +
        (marketTypeSignal * 0.2) +
        (consensusSignal * 0.14) +
        (lineSignal * 0.08) +
        (bookSignal * 0.06) -
        extremeLongshotPenalty -
        proxyPenalty
      ).toFixed(4))

      return {
        row,
        homeRunPathScore
      }
    })
    .sort((a, b) => b.homeRunPathScore - a.homeRunPathScore)

  const out = []
  const seen = new Set()
  const perPlayer = {}
  const perMatchup = {}
  const perMarket = {}

  for (const candidate of scored) {
    const row = candidate.row
    const key = buildCandidateKey(row)
    if (seen.has(key)) continue

    const player = toKey(row?.player, "")
    const matchup = toKey(row?.matchup, "unknown")
    const marketKey = toKey(row?.marketKey, "unknown")

    if (player && Number(perPlayer[player] || 0) >= 1) continue
    if (Number(perMatchup[matchup] || 0) >= 2) continue
    if (Number(perMarket[marketKey] || 0) >= 4) continue

    seen.add(key)
    if (player) perPlayer[player] = Number(perPlayer[player] || 0) + 1
    perMatchup[matchup] = Number(perMatchup[matchup] || 0) + 1
    perMarket[marketKey] = Number(perMarket[marketKey] || 0) + 1

    out.push({
      ...compactMlbRow(row, { playerTeamIndex: options.playerTeamIndex }),
      homeRunPathScore: candidate.homeRunPathScore,
      surfaceScore: candidate.homeRunPathScore
    })

    if (out.length >= maxRows) break
  }

  return out
}

function buildBestLongshotPlays(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxRows = Number.isFinite(options.maxRows) ? Math.max(1, Number(options.maxRows)) : 6

  const homeRunCore = buildBestHomeRunPlays(safeRows, { maxRows, playerTeamIndex: options.playerTeamIndex })
  const longshotCandidates = rankRows(
    safeRows.filter((row) => {
      if (String(row?.isPitcherMarket) === "true" || row?.isPitcherMarket === true) return false
      const odds = toNumberOrNull(row?.odds)
      if (!Number.isFinite(odds)) return false
      if (odds < 100 || odds > 900) return false
      if (isFirstHomeRunSpecialRow(row)) return false
      return true
    }),
    {
      groupType: "hitters",
      maxRows: maxRows * 2,
      perMarketKeyMax: 2
    }
  )

  const out = []
  const seen = new Set()

  for (const row of [...homeRunCore, ...longshotCandidates]) {
    const key = buildCandidateKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
    if (out.length >= maxRows) break
  }

  return out
}

function toDecimalOdds(odds) {
  const n = toNumberOrNull(odds)
  if (!Number.isFinite(n) || n === 0) return 1
  if (n > 0) return 1 + (n / 100)
  return 1 + (100 / Math.abs(n))
}

function buildTicketLegKey(row) {
  return [
    toKey(row?.player, ""),
    toKey(row?.marketKey, ""),
    toKey(row?.side, ""),
    String(row?.line ?? ""),
    toKey(row?.book, "")
  ].join("|")
}

function toTicketLeg(row, role) {
  return {
    role,
    player: row?.player || null,
    team: row?.team || null,
    matchup: row?.matchup || null,
    marketKey: row?.marketKey || null,
    side: row?.side || null,
    line: row?.line,
    odds: row?.odds,
    surfaceScore: toNumberOrNull(row?.surfaceScore),
    homeRunPathScore: toNumberOrNull(row?.homeRunPathScore),
    bombTier: row?.bombTier || null
  }
}

function buildTicketKeyFromLegs(legs) {
  const safeLegs = Array.isArray(legs) ? legs : []
  return safeLegs
    .map((leg) => [
      toKey(leg?.player, ""),
      toKey(leg?.marketKey, ""),
      toKey(leg?.side, ""),
      String(leg?.line ?? "")
    ].join("|"))
    .sort()
    .join("||")
}

function hasDuplicatePlayers(legs) {
  const seen = new Set()
  for (const leg of legs || []) {
    const player = String(leg?.player || "").trim()
    if (!player) continue
    if (seen.has(player)) return true
    seen.add(player)
  }
  return false
}

function isOverstackedByMarket(legs) {
  const marketCounts = countBy(legs || [], (leg) => leg?.marketKey)
  const values = Object.values(marketCounts)
  const maxCount = values.length ? Math.max(...values) : 0
  return maxCount >= Math.max(3, (legs || []).length)
}

function buildTicketCandidate(legs, ticketType) {
  const safeLegs = Array.isArray(legs) ? legs : []
  if (!safeLegs.length) return null
  if (hasDuplicatePlayers(safeLegs)) return null
  if (isOverstackedByMarket(safeLegs)) return null

  const qualityScores = safeLegs.map((leg) => {
    const hr = toNumberOrNull(leg?.homeRunPathScore)
    const surface = toNumberOrNull(leg?.surfaceScore)
    return clamp(hr != null ? hr : (surface != null ? surface : 0.45), 0.05, 1)
  })
  const avgQuality = qualityScores.reduce((sum, n) => sum + n, 0) / qualityScores.length

  const payoutDecimal = safeLegs.reduce((acc, leg) => acc * toDecimalOdds(leg?.odds), 1)
  const payoutSignal = clamp((payoutDecimal - 2.2) / 10, 0, 1)

  const bombLegs = safeLegs.filter((leg) => String(leg?.role || "") === "bomb")
  const bombSpecificity = bombLegs.length
    ? (bombLegs.reduce((sum, leg) => {
      const tier = String(leg?.bombTier || "")
      const tierWeight =
        tier === "hr" ? 1 :
        tier === "strong" ? 0.86 :
        tier === "medium" ? 0.7 :
        tier === "soft" ? 0.52 :
        0.64
      return sum + tierWeight
    }, 0) / bombLegs.length)
    : 0.64

  const matchupCounts = countBy(safeLegs, (leg) => leg?.matchup)
  const matchupValues = Object.values(matchupCounts)
  const maxMatchupShare = matchupValues.length ? (Math.max(...matchupValues) / safeLegs.length) : 1
  const diversitySignal = clamp(1 - maxMatchupShare + (1 / safeLegs.length), 0.2, 1)

  const ticketScore = Number((
    (avgQuality * 0.54) +
    (payoutSignal * 0.24) +
    (diversitySignal * 0.1) +
    (bombSpecificity * 0.12)
  ).toFixed(4))

  return {
    ticketType,
    legCount: safeLegs.length,
    legs: safeLegs,
    estimatedPayoutDecimal: Number(payoutDecimal.toFixed(2)),
    ticketScore
  }
}

function createTicketExposureState() {
  return {
    supportPlayerUses: {},
    pitcherSupportPlayerUses: {},
    bombPlayerUses: {},
    exactPlayerMarketComboUses: {},
    matchupUses: {}
  }
}

function uniqueList(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))]
}

function buildCandidateExposureKeys(ticket) {
  const safeLegs = Array.isArray(ticket?.legs) ? ticket.legs : []

  const supportPlayers = uniqueList(
    safeLegs
      .filter((leg) => String(leg?.role || "") === "support")
      .map((leg) => toKey(leg?.player, ""))
  )

  const pitcherSupportPlayers = uniqueList(
    safeLegs
      .filter((leg) => String(leg?.role || "") === "pitcherSupport")
      .map((leg) => toKey(leg?.player, ""))
  )

  const bombPlayers = uniqueList(
    safeLegs
      .filter((leg) => String(leg?.role || "") === "bomb")
      .map((leg) => toKey(leg?.player, ""))
  )

  const exactPlayerMarketCombos = uniqueList(
    safeLegs
      .map((leg) => [toKey(leg?.player, ""), toKey(leg?.marketKey, "")].join("|"))
  )

  const matchups = uniqueList(safeLegs.map((leg) => toKey(leg?.matchup, "")))

  return {
    supportPlayers,
    pitcherSupportPlayers,
    bombPlayers,
    exactPlayerMarketCombos,
    matchups
  }
}

function canAcceptCandidateWithExposureState(exposureKeys, exposureState, constraints) {
  const supportCap = Math.max(1, Number(constraints?.maxSupportPlayerUsesAfterFirst || 1))
  const pitcherSupportCap = Math.max(1, Number(constraints?.maxPitcherSupportPlayerUsesAfterFirst || 1))
  const bombCap = Math.max(1, Number(constraints?.maxBombPlayerUsesAfterFirst || 1))
  const exactComboCap = Math.max(1, Number(constraints?.maxExactPlayerMarketComboUses || 1))
  const matchupCap = Math.max(1, Number(constraints?.maxMatchupUsesAcrossSurfacedTickets || 2))

  for (const player of exposureKeys.supportPlayers) {
    if (Number(exposureState.supportPlayerUses[player] || 0) >= supportCap) return false
  }
  for (const player of exposureKeys.pitcherSupportPlayers) {
    if (Number(exposureState.pitcherSupportPlayerUses[player] || 0) >= pitcherSupportCap) return false
  }
  for (const player of exposureKeys.bombPlayers) {
    if (Number(exposureState.bombPlayerUses[player] || 0) >= bombCap) return false
  }
  for (const combo of exposureKeys.exactPlayerMarketCombos) {
    if (Number(exposureState.exactPlayerMarketComboUses[combo] || 0) >= exactComboCap) return false
  }
  for (const matchup of exposureKeys.matchups) {
    if (Number(exposureState.matchupUses[matchup] || 0) >= matchupCap) return false
  }

  return true
}

function recordCandidateExposureState(exposureKeys, exposureState) {
  for (const player of exposureKeys.supportPlayers) {
    exposureState.supportPlayerUses[player] = Number(exposureState.supportPlayerUses[player] || 0) + 1
  }
  for (const player of exposureKeys.pitcherSupportPlayers) {
    exposureState.pitcherSupportPlayerUses[player] = Number(exposureState.pitcherSupportPlayerUses[player] || 0) + 1
  }
  for (const player of exposureKeys.bombPlayers) {
    exposureState.bombPlayerUses[player] = Number(exposureState.bombPlayerUses[player] || 0) + 1
  }
  for (const combo of exposureKeys.exactPlayerMarketCombos) {
    exposureState.exactPlayerMarketComboUses[combo] = Number(exposureState.exactPlayerMarketComboUses[combo] || 0) + 1
  }
  for (const matchup of exposureKeys.matchups) {
    exposureState.matchupUses[matchup] = Number(exposureState.matchupUses[matchup] || 0) + 1
  }
}

function selectSurfacedTicketsHard(candidates, limit, constraints = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : []
  const maxRows = Math.max(1, Number(limit) || 6)
  const sorted = safeCandidates.sort((a, b) => Number(b?.ticketScore || 0) - Number(a?.ticketScore || 0))

  const seen = new Set()
  const exposureState = createTicketExposureState()
  const out = []

  for (const candidate of sorted) {
    const candidateKey = buildTicketKeyFromLegs(candidate?.legs || [])
    if (!candidateKey || seen.has(candidateKey)) continue

    const exposureKeys = buildCandidateExposureKeys(candidate)

    // Preserve strongest first ticket in each family.
    if (!out.length) {
      seen.add(candidateKey)
      out.push(candidate)
      recordCandidateExposureState(exposureKeys, exposureState)
      if (out.length >= maxRows) break
      continue
    }

    if (!canAcceptCandidateWithExposureState(exposureKeys, exposureState, constraints)) continue

    seen.add(candidateKey)
    out.push(candidate)
    recordCandidateExposureState(exposureKeys, exposureState)
    if (out.length >= maxRows) break
  }

  return out
}

function buildBestBombPairTickets({ bombRows, limit = 6 }) {
  const bombs = (Array.isArray(bombRows) ? bombRows : []).slice(0, 10)
  const candidates = []

  for (let i = 0; i < bombs.length; i += 1) {
    for (let j = i + 1; j < bombs.length; j += 1) {
      const ticket = buildTicketCandidate([
        toTicketLeg({ ...bombs[i], bombTier: getHomeRunProxyTier(bombs[i]) }, "bomb"),
        toTicketLeg({ ...bombs[j], bombTier: getHomeRunProxyTier(bombs[j]) }, "bomb")
      ], "bombPair")
      if (ticket) candidates.push(ticket)
    }
  }

  return selectSurfacedTicketsHard(candidates, limit, {
    maxSupportPlayerUsesAfterFirst: 1,
    maxPitcherSupportPlayerUsesAfterFirst: 1,
    maxBombPlayerUsesAfterFirst: 2,
    maxExactPlayerMarketComboUses: 1,
    maxMatchupUsesAcrossSurfacedTickets: 2
  })
}

function buildBestBombPlusSupportTickets({ bombRows, supportRows, pitcherRows, limit = 8 }) {
  const bombs = (Array.isArray(bombRows) ? bombRows : []).slice(0, 8)
  const supports = (Array.isArray(supportRows) ? supportRows : []).slice(0, 10)
  const pitchers = (Array.isArray(pitcherRows) ? pitcherRows : []).slice(0, 6)
  const candidates = []

  for (const bomb of bombs) {
    for (const support of supports) {
      const twoLeg = buildTicketCandidate([
        toTicketLeg({ ...bomb, bombTier: getHomeRunProxyTier(bomb) }, "bomb"),
        toTicketLeg(support, "support")
      ], "bombPlusSupport")
      if (twoLeg) candidates.push(twoLeg)
    }

    for (const support of supports.slice(0, 4)) {
      for (const pitcher of pitchers.slice(0, 3)) {
        const threeLeg = buildTicketCandidate([
          toTicketLeg({ ...bomb, bombTier: getHomeRunProxyTier(bomb) }, "bomb"),
          toTicketLeg(support, "support"),
          toTicketLeg(pitcher, "pitcherSupport")
        ], "bombPlusSupport")
        if (threeLeg) candidates.push(threeLeg)
      }
    }
  }

  return selectSurfacedTicketsHard(candidates, limit, {
    maxSupportPlayerUsesAfterFirst: 1,
    maxPitcherSupportPlayerUsesAfterFirst: 1,
    maxBombPlayerUsesAfterFirst: 1,
    maxExactPlayerMarketComboUses: 1,
    maxMatchupUsesAcrossSurfacedTickets: 2
  })
}

function buildBestPitcherPlusBombTickets({ bombRows, pitcherRows, limit = 6 }) {
  const bombs = (Array.isArray(bombRows) ? bombRows : []).slice(0, 10)
  const pitchers = (Array.isArray(pitcherRows) ? pitcherRows : []).slice(0, 10)
  const candidates = []

  for (const bomb of bombs) {
    for (const pitcher of pitchers) {
      const ticket = buildTicketCandidate([
        toTicketLeg(pitcher, "pitcherSupport"),
        toTicketLeg({ ...bomb, bombTier: getHomeRunProxyTier(bomb) }, "bomb")
      ], "pitcherPlusBomb")
      if (ticket) candidates.push(ticket)
    }
  }

  return selectSurfacedTicketsHard(candidates, limit, {
    maxSupportPlayerUsesAfterFirst: 1,
    maxPitcherSupportPlayerUsesAfterFirst: 1,
    maxBombPlayerUsesAfterFirst: 1,
    maxExactPlayerMarketComboUses: 1,
    maxMatchupUsesAcrossSurfacedTickets: 2
  })
}

function buildMlbSurfaceBoard(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxRowsPerGroup = Number.isFinite(options.maxRowsPerGroup)
    ? Math.max(1, Number(options.maxRowsPerGroup))
    : 10
  const playerTeamIndex = buildPlayerTeamIndex(safeRows)

  const gameRows = safeRows.filter((row) => String(row?.marketFamily || "") === "game")
  const specialRows = safeRows.filter((row) => String(row?.marketFamily || "") === "special")
  const hitterRows = safeRows.filter((row) => {
    const family = String(row?.marketFamily || "")
    return (family === "standard" || family === "ladder") && row?.isPitcherMarket !== true && String(row?.player || "").trim()
  })
  const pitcherRows = safeRows.filter((row) => {
    const family = String(row?.marketFamily || "")
    return (family === "standard" || family === "ladder") && row?.isPitcherMarket === true && String(row?.player || "").trim()
  })

  const bestHitters = rankRows(hitterRows, { groupType: "hitters", maxRows: maxRowsPerGroup, playerTeamIndex })
  const bestPitchers = rankRows(pitcherRows, { groupType: "pitchers", maxRows: maxRowsPerGroup, perMarketKeyMax: 2, playerTeamIndex })
  const bestSpecials = rankRows(specialRows, { groupType: "specials", maxRows: maxRowsPerGroup, playerTeamIndex })
  const bestHomeRunPlays = buildBestHomeRunPlays(safeRows, { maxRows: Math.min(maxRowsPerGroup, 6), playerTeamIndex })
  const bestLongshotPlays = buildBestLongshotPlays(hitterRows, { maxRows: Math.min(maxRowsPerGroup, 6), playerTeamIndex })
  const bestGameMarkets = rankRows(gameRows, { groupType: "game", maxRows: maxRowsPerGroup, playerTeamIndex })

  const bestOverall = buildBalancedOverallBoard({
    bestHitters,
    bestPitchers,
    bestSpecials,
    bestGameMarkets,
    maxRows: maxRowsPerGroup
  })

  // --- Phase 5: safe / upside sub-tiers ---
  // Pre-filter each prop pool by tier before ranking so the resulting lists are
  // meaningfully distinct rather than just score-ordered sub-slices of the same pool.

  const safeHitterPool = hitterRows.filter((r) => classifyRowTier(r) === "safe")
  const upsideHitterPool = hitterRows.filter((r) => classifyRowTier(r) === "upside")
  const safePitcherPool = pitcherRows.filter((r) => classifyRowTier(r) === "safe")
  const upsidePitcherPool = pitcherRows.filter((r) => classifyRowTier(r) === "upside")

  const tierMax = Math.max(3, Math.round(maxRowsPerGroup * 0.65))

  const safeHitters = rankRows(safeHitterPool, { groupType: "hitters", maxRows: tierMax, perMarketKeyMax: 2, playerTeamIndex })
  const safePitchers = rankRows(safePitcherPool, { groupType: "pitchers", maxRows: tierMax, perMarketKeyMax: 2, playerTeamIndex })
  const upsideHitters = rankRows(upsideHitterPool, { groupType: "hitters", maxRows: tierMax, perMarketKeyMax: 2, playerTeamIndex })
  const upsidePitchers = rankRows(upsidePitcherPool, { groupType: "pitchers", maxRows: tierMax, perMarketKeyMax: 2, playerTeamIndex })

  // Separate safe/upside pools for specials and game lines used in the combined overall boards.
  const safeSpecialPool = specialRows.filter((r) => {
    const o = toNumberOrNull(r?.odds)
    return o != null && o >= -250 && o <= 200
  })
  const upsideSpecialPool = specialRows.filter((r) => {
    const o = toNumberOrNull(r?.odds)
    return o != null && o >= 100 && o <= 600
  })
  const safeGamePool = gameRows.filter((r) => {
    const o = toNumberOrNull(r?.odds)
    return o != null && o >= -220 && o <= 120
  })
  const upsideGamePool = gameRows.filter((r) => {
    const o = toNumberOrNull(r?.odds)
    return o != null && o >= -160 && o <= 280
  })

  const overallTierMax = Math.max(4, Math.round(maxRowsPerGroup * 0.7))

  const bestOverallSafe = buildBalancedOverallBoard({
    bestHitters: safeHitters,
    bestPitchers: safePitchers,
    bestSpecials: rankRows(safeSpecialPool, { groupType: "specials", maxRows: 3, playerTeamIndex }),
    bestGameMarkets: rankRows(safeGamePool, { groupType: "game", maxRows: 2, playerTeamIndex }),
    maxRows: overallTierMax
  })

  const bestOverallUpside = buildBalancedOverallBoard({
    bestHitters: upsideHitters,
    bestPitchers: upsidePitchers,
    bestSpecials: rankRows(upsideSpecialPool, { groupType: "specials", maxRows: 3, playerTeamIndex }),
    bestGameMarkets: rankRows(upsideGamePool, { groupType: "game", maxRows: 2, playerTeamIndex }),
    maxRows: overallTierMax
  })

  const supportRows = rankRows(
    [...bestOverallSafe, ...bestHitters, ...bestPitchers],
    { groupType: "overall", maxRows: 14, perMarketKeyMax: 3, playerTeamIndex }
  )

  const bestBombPairTickets = buildBestBombPairTickets({
    bombRows: bestHomeRunPlays,
    limit: 6
  })
  const bestBombPlusSupportTickets = buildBestBombPlusSupportTickets({
    bombRows: bestHomeRunPlays,
    supportRows,
    pitcherRows: bestPitchers,
    limit: 8
  })
  const bestPitcherPlusBombTickets = buildBestPitcherPlusBombTickets({
    bombRows: bestHomeRunPlays,
    pitcherRows: bestPitchers,
    limit: 6
  })

  return {
    bestHitters,
    bestPitchers,
    bestSpecials,
    bestHomeRunPlays,
    bestLongshotPlays,
    bestGameMarkets,
    bestOverall,
    safeHitters,
    safePitchers,
    upsideHitters,
    upsidePitchers,
    bestOverallSafe,
    bestOverallUpside,
    bestBombPairTickets,
    bestBombPlusSupportTickets,
    bestPitcherPlusBombTickets,
    counts: {
      bestHitters: bestHitters.length,
      bestPitchers: bestPitchers.length,
      bestSpecials: bestSpecials.length,
      bestHomeRunPlays: bestHomeRunPlays.length,
      bestLongshotPlays: bestLongshotPlays.length,
      bestGameMarkets: bestGameMarkets.length,
      bestOverall: bestOverall.length,
      safeHitters: safeHitters.length,
      safePitchers: safePitchers.length,
      upsideHitters: upsideHitters.length,
      upsidePitchers: upsidePitchers.length,
      bestOverallSafe: bestOverallSafe.length,
      bestOverallUpside: bestOverallUpside.length,
      bestBombPairTickets: bestBombPairTickets.length,
      bestBombPlusSupportTickets: bestBombPlusSupportTickets.length,
      bestPitcherPlusBombTickets: bestPitcherPlusBombTickets.length
    }
  }
}

function buildGroupView(rows, sampleLimit) {
  const safeRows = Array.isArray(rows) ? rows : []
  const playerTeamIndex = buildPlayerTeamIndex(safeRows)
  return {
    count: safeRows.length,
    byBook: countBy(safeRows, (row) => row?.book),
    byMarketKey: countBy(safeRows, (row) => row?.marketKey),
    byMatchup: countBy(safeRows, (row) => row?.matchup),
    sampleRows: safeRows.slice(0, sampleLimit).map((row) => compactMlbRow(row, { playerTeamIndex }))
  }
}

function buildMlbInspectionBoard({ snapshot, sampleLimit = 10, topLimit = 20 }) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : []
  const surfaced = buildMlbSurfaceBoard(rows, { maxRowsPerGroup: sampleLimit })
  const allRowsPlayerTeamIndex = buildPlayerTeamIndex(rows)

  const gameRows = rows.filter((row) => String(row?.marketFamily || "") === "game")
  const specialRows = rows.filter((row) => String(row?.marketFamily || "") === "special")

  const standardOrLadderRows = rows.filter((row) => {
    const family = String(row?.marketFamily || "")
    return family === "standard" || family === "ladder"
  })

  const hitterRows = standardOrLadderRows.filter((row) => row?.isPitcherMarket !== true)
  const pitcherRows = standardOrLadderRows.filter((row) => row?.isPitcherMarket === true)

  const otherRows = rows.filter((row) => {
    const family = String(row?.marketFamily || "")
    return family !== "game" && family !== "special" && family !== "standard" && family !== "ladder"
  })

  const byMarketFamily = countBy(rows, (row) => row?.marketFamily)
  const byMarketKey = countBy(rows, (row) => row?.marketKey)
  const byBook = countBy(rows, (row) => row?.book)
  const byMatchup = countBy(rows, (row) => row?.matchup)

  return {
    counts: {
      events: Array.isArray(snapshot?.events) ? snapshot.events.length : 0,
      fetchedEventOdds: Array.isArray(snapshot?.rawOddsEvents) ? snapshot.rawOddsEvents.length : 0,
      rows: rows.length
    },
    diagnostics: {
      byMarketFamily,
      byMarketKey,
      byBook,
      byMatchup,
      topMarketKeys: sortCountEntries(byMarketKey, topLimit),
      topBooks: sortCountEntries(byBook, topLimit),
      topMatchups: sortCountEntries(byMatchup, topLimit)
    },
    groups: {
      gameMarkets: buildGroupView(gameRows, sampleLimit),
      specialMarkets: buildGroupView(specialRows, sampleLimit),
      hitterProps: buildGroupView(hitterRows, sampleLimit),
      pitcherProps: buildGroupView(pitcherRows, sampleLimit),
      otherMarkets: buildGroupView(otherRows, sampleLimit)
    },
    surfaced,
    sampleRows: rows.slice(0, sampleLimit).map((row) => compactMlbRow(row, { playerTeamIndex: allRowsPlayerTeamIndex }))
  }
}

module.exports = {
  buildMlbInspectionBoard,
  compactMlbRow,
  buildMlbSurfaceBoard
}
