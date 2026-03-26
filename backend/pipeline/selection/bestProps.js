"use strict"

// ---------------------------------------------------------------------------
// Private helpers (inlined from server.js — pure, stateless)
// ---------------------------------------------------------------------------

function parseHitRateInline(hitRate) {
  if (typeof hitRate === "number") return hitRate
  if (typeof hitRate !== "string") return 0
  const parts = hitRate.split("/").map((part) => Number(part))
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[1] > 0) {
    return parts[0] / parts[1]
  }
  const numeric = Number(hitRate)
  return Number.isFinite(numeric) ? numeric : 0
}

function normalizeBestPropVariant(row, propVariant = "base") {
  if (!row) return null
  return {
    ...row,
    isAlt: propVariant !== "base",
    propVariant
  }
}

function dedupeByLegSignature(rows = []) {
  const seen = new Set()
  const out = []

  for (const row of rows) {
    const key = [
      row?.eventId,
      row?.book,
      row?.player,
      row?.propType,
      row?.side,
      Number(row?.line),
      row?.propVariant || "base"
    ].join("|")

    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }

  return out
}

function normalizePlayerStatusValue(status) {
  return String(status || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isUnavailablePlayerStatus(status) {
  const normalized = normalizePlayerStatusValue(status)
  if (!normalized) return false

  return [
    "out",
    "dnp",
    "dnp coachs decision",
    "dnp coaches decision",
    "inactive",
    "suspended",
    "not with team"
  ].includes(normalized)
}

function shouldRemoveLegForPlayerStatus(row) {
  if (!row) return false
  if (row.__forceInclude) return false
  return isUnavailablePlayerStatus(row.playerStatus)
}

// ---------------------------------------------------------------------------
// Exported: scoreBestFallbackRow
// ---------------------------------------------------------------------------

function scoreBestFallbackRow(row) {
  const hitRate = parseHitRateInline(row?.hitRate)
  const edge = Number(row?.edge || row?.projectedValue || 0)
  const score = Number(row?.score || 0)
  const odds = Number(row?.odds || 0)
  const avgMin = Number(row?.avgMin || 0)

  const minutesRisk = String(row?.minutesRisk || "").toLowerCase()
  const trendRisk = String(row?.trendRisk || "").toLowerCase()
  const injuryRisk = String(row?.injuryRisk || "").toLowerCase()

  const minutesBonus =
    minutesRisk === "low" ? 0.08 :
    minutesRisk === "medium" ? 0.02 : -0.12

  const trendBonus =
    trendRisk === "low" ? 0.05 :
    trendRisk === "medium" ? 0.01 : -0.1

  const injuryBonus =
    injuryRisk === "low" ? 0.04 :
    injuryRisk === "medium" ? 0 : -0.12

  const oddsBonus =
    odds >= -160 && odds <= 140 ? 0.05 :
    odds > 140 ? -0.02 : 0

  const minutesFloorBonus = avgMin >= 28 ? 0.05 : avgMin >= 22 ? 0.02 : -0.05

  return hitRate * 0.52 + (edge / 12) * 0.18 + (score / 160) * 0.16 + minutesBonus + trendBonus + injuryBonus + oddsBonus + minutesFloorBonus
}

// ---------------------------------------------------------------------------
// Exported: buildBestPropsFallbackRows
// ---------------------------------------------------------------------------

function buildBestPropsFallbackRows(sourceRows = [], targetSize = 60) {
  const deduped = dedupeByLegSignature((Array.isArray(sourceRows) ? sourceRows : []).filter(Boolean))
  const missingFieldCounts = {
    team: deduped.filter((r) => !r?.team).length,
    hitRate: deduped.filter((r) => r?.hitRate == null || r?.hitRate === "").length,
    edge: deduped.filter((r) => r?.edge == null || r?.edge === "").length,
    score: deduped.filter((r) => r?.score == null || r?.score === "").length,
    eventId: deduped.filter((r) => !r?.eventId).length,
    gameTime: deduped.filter((r) => !r?.gameTime).length
  }
  const missingFieldCountsByBook = {
    FanDuel: {
      team: deduped.filter((r) => r?.book === "FanDuel" && !r?.team).length,
      hitRate: deduped.filter((r) => r?.book === "FanDuel" && (r?.hitRate == null || r?.hitRate === "")).length,
      edge: deduped.filter((r) => r?.book === "FanDuel" && (r?.edge == null || r?.edge === "")).length,
      score: deduped.filter((r) => r?.book === "FanDuel" && (r?.score == null || r?.score === "")).length
    },
    DraftKings: {
      team: deduped.filter((r) => r?.book === "DraftKings" && !r?.team).length,
      hitRate: deduped.filter((r) => r?.book === "DraftKings" && (r?.hitRate == null || r?.hitRate === "")).length,
      edge: deduped.filter((r) => r?.book === "DraftKings" && (r?.edge == null || r?.edge === "")).length,
      score: deduped.filter((r) => r?.book === "DraftKings" && (r?.score == null || r?.score === "")).length
    }
  }
  const eligibilityDropCounts = {
    missingCoreFields: 0,
    teamMismatch: 0,
    removedByPlayerStatus: 0,
    removedFlagged: 0,
    injuryRiskHigh: 0,
    missingHitRate: 0,
    usedFallbackNoHitRate: 0,
    avgMinTooLow: 0,
    minutesRiskHighLowHitRate: 0,
    trendRiskHighNonPositiveEdge: 0,
    hitRateTooLow: 0,
    survivedEligibility: 0,
    forceIncluded: 0
  }

  const filtered = deduped
    .filter((row) => {
      const keep = Boolean(row?.player && row?.propType && row?.book && row?.line != null)
      if (!keep) eligibilityDropCounts.missingCoreFields++
      return keep
    })
    .filter((row) => {
      const keep = !shouldRemoveLegForPlayerStatus(row)
      if (!keep) eligibilityDropCounts.removedByPlayerStatus++
      return keep
    })
    .filter((row) => {
      const keep = !row?.removed
      if (!keep) eligibilityDropCounts.removedFlagged++
      return keep
    })
    .filter((row) => {
      const keep = String(row?.injuryRisk || "").toLowerCase() !== "high"
      if (!keep) eligibilityDropCounts.injuryRiskHigh++
      return keep
    })
    .filter((row) => {
      if (row?.__forceInclude) {
        eligibilityDropCounts.forceIncluded++
        eligibilityDropCounts.survivedEligibility++
        return true
      }

      const rawHitRate = row?.hitRate
      const hitRate = parseHitRateInline(rawHitRate)
      const hasHitRate = (
        typeof rawHitRate === "number" ||
        (typeof rawHitRate === "string" && String(rawHitRate).trim() !== "")
      ) && Number.isFinite(hitRate) && hitRate > 0

      const avgMin = Number(row?.avgMin || 0)
      const edge = Number(row?.edge || row?.projectedValue || 0)
      const score = Number(row?.score || 0)
      const minutesRisk = String(row?.minutesRisk || "").toLowerCase()
      const trendRisk = String(row?.trendRisk || "").toLowerCase()

      if (avgMin > 0 && avgMin < 12) {
        eligibilityDropCounts.avgMinTooLow++
        return false
      }
      if (minutesRisk === "high" && hasHitRate && hitRate < 0.52) {
        eligibilityDropCounts.minutesRiskHighLowHitRate++
        return false
      }
      if (trendRisk === "high" && edge <= -1.5) {
        eligibilityDropCounts.trendRiskHighNonPositiveEdge++
        return false
      }

      if (hasHitRate) {
        if (hitRate < 0.4) {
          eligibilityDropCounts.hitRateTooLow++
          return false
        }
      } else {
        eligibilityDropCounts.missingHitRate++

        const hasFallbackStrength = (
          score >= 55 ||
          edge >= 0.75 ||
          avgMin >= 20 ||
          String(row?.book || "") === "FanDuel" ||
          String(row?.book || "") === "DraftKings"
        )

        if (!hasFallbackStrength) {
          eligibilityDropCounts.hitRateTooLow++
          return false
        }

        eligibilityDropCounts.usedFallbackNoHitRate++
      }

      eligibilityDropCounts.survivedEligibility++
      return true
    })
    .map((row) => {
      const rawHitRate = row?.hitRate
      const parsedHitRate = parseHitRateInline(rawHitRate)
      const hasHitRate = (
        typeof rawHitRate === "number" ||
        (typeof rawHitRate === "string" && String(rawHitRate).trim() !== "")
      ) && Number.isFinite(parsedHitRate) && parsedHitRate > 0

      const fallbackHitRate = (
        Number(row?.score || 0) >= 85 ? 0.66 :
        Number(row?.score || 0) >= 70 ? 0.61 :
        Number(row?.edge || row?.projectedValue || 0) >= 2 ? 0.59 :
        Number(row?.avgMin || 0) >= 28 ? 0.57 :
        0.52
      )

      const normalizedHitRate = hasHitRate ? parsedHitRate : fallbackHitRate

      const completenessBonus =
        (row?.team ? 6 : 0) +
        (row?.hitRate != null && row?.hitRate !== "" ? 8 : 0) +
        (row?.edge != null && row?.edge !== "" ? 8 : 0) +
        (row?.score != null && row?.score !== "" ? 8 : 0)

      return {
        ...row,
        __normalizedHitRate: normalizedHitRate,
        __bestFallbackScore: scoreBestFallbackRow({ ...row, hitRate: normalizedHitRate }) + completenessBonus
      }
    })
    .sort((a, b) => {
      const aEnriched = (a?.team && a?.edge != null && a?.edge !== "" && a?.score != null && a?.score !== "" && a?.hitRate != null && a?.hitRate !== "") ? 1 : 0
      const bEnriched = (b?.team && b?.edge != null && b?.edge !== "" && b?.score != null && b?.score !== "" && b?.hitRate != null && b?.hitRate !== "") ? 1 : 0
      if (bEnriched !== aEnriched) return bEnriched - aEnriched
      if (b.__bestFallbackScore !== a.__bestFallbackScore) return b.__bestFallbackScore - a.__bestFallbackScore
      return Number(b?.__normalizedHitRate || 0) - Number(a?.__normalizedHitRate || 0)
    })

  const filteredByGame = filtered.reduce((acc, row) => {
    const key = String(row?.matchup || row?.eventId || "unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const topRankedPreview = filtered.slice(0, 40)
  const topRankedByBook = {
    FanDuel: topRankedPreview.filter((r) => r?.book === "FanDuel").length,
    DraftKings: topRankedPreview.filter((r) => r?.book === "DraftKings").length
  }
  const topRankedSample = topRankedPreview.slice(0, 20).map((r) => ({
    player: r.player,
    team: r.team,
    matchup: r.matchup,
    book: r.book,
    propType: r.propType,
    side: r.side,
    line: r.line,
    odds: r.odds,
    hitRate: r.hitRate,
    normalizedHitRate: r.__normalizedHitRate,
    edge: r.edge,
    score: r.score
  }))

  const compressedByLegMap = new Map()
  const CLOSE_SCORE_EPSILON = 0.15
  for (const row of filtered) {
    const compressionKey = `${String(row?.player || "")}|${String(row?.propType || "")}|${String(row?.side || "")}|${Number(row?.line)}`
    const existing = compressedByLegMap.get(compressionKey)
    if (!existing) {
      compressedByLegMap.set(compressionKey, row)
      continue
    }

    const nextScore = Number(row?.__bestFallbackScore || 0)
    const existingScore = Number(existing?.__bestFallbackScore || 0)
    if (nextScore > existingScore) {
      compressedByLegMap.set(compressionKey, row)
      continue
    }

    const scoresAreClose = Math.abs(nextScore - existingScore) <= CLOSE_SCORE_EPSILON
    if (scoresAreClose && row?.book === "FanDuel" && existing?.book !== "FanDuel") {
      compressedByLegMap.set(compressionKey, row)
    }
  }

  const selectionSource = [...compressedByLegMap.values()]

  const cap = Math.max(12, Math.min(Number.isFinite(targetSize) ? targetSize : 60, selectionSource.length || 12))
  const selected = []
  const selectedKeys = new Set()
  const playerCounts = new Map()
  const propCounts = new Map()
  const playerPropCounts = new Map()
  const maxPerProp = Math.max(7, Math.ceil(cap / 3))
  const selectionDropCounts = {
    duplicateLeg: 0,
    playerCap: 0,
    playerPropCap: 0,
    propCap: 0,
    selectedFirstPass: 0,
    selectedSecondPass: 0,
    selectedFinalPass: 0
  }

  // STEP 4: Prioritize force-included watched players at the start
  const forceIncluded = selectionSource.filter((row) => row?.__forceInclude)
  for (const row of forceIncluded) {
    const player = String(row?.player || "")
    const propType = String(row?.propType || "")
    const playerPropKey = `${player}|${propType}`
    const legKey = `${player}|${propType}|${row?.book}|${row?.side}|${Number(row?.line)}`

    if (selectedKeys.has(legKey)) continue
    selected.push(row)
    selectionDropCounts.selectedFirstPass++
    selectedKeys.add(legKey)
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1)
    playerPropCounts.set(playerPropKey, (playerPropCounts.get(playerPropKey) || 0) + 1)
    propCounts.set(propType, (propCounts.get(propType) || 0) + 1)
  }

  // Fill remaining slots with regular rows - relaxed diversity restrictions
  for (const row of selectionSource) {
    const player = String(row?.player || "")
    const propType = String(row?.propType || "")
    const playerPropKey = `${player}|${propType}`
    const legKey = `${player}|${propType}|${row?.book}|${row?.side}|${Number(row?.line)}`
    const isFanDuel = row?.book === "FanDuel"
    const playerCapLimit = isFanDuel ? 5 : 4
    const playerPropCapLimit = isFanDuel ? 4 : 3
    const propCapLimit = isFanDuel ? maxPerProp + 2 : maxPerProp

    if (selectedKeys.has(legKey)) {
      selectionDropCounts.duplicateLeg++
      continue
    }
    if ((playerCounts.get(player) || 0) >= playerCapLimit) {
      selectionDropCounts.playerCap++
      continue
    }
    if ((playerPropCounts.get(playerPropKey) || 0) >= playerPropCapLimit) {
      selectionDropCounts.playerPropCap++
      continue
    }
    if ((propCounts.get(propType) || 0) >= propCapLimit) {
      selectionDropCounts.propCap++
      continue
    }

    selected.push(row)
    selectionDropCounts.selectedFirstPass++
    selectedKeys.add(legKey)
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1)
    playerPropCounts.set(playerPropKey, (playerPropCounts.get(playerPropKey) || 0) + 1)
    propCounts.set(propType, (propCounts.get(propType) || 0) + 1)

    if (selected.length >= cap) break
  }

  // Second refill pass - ignores playerPropCounts but avoids exact duplicate leg keys
  if (selected.length < cap) {
    for (const row of selectionSource) {
      const player = String(row?.player || "")
      const propType = String(row?.propType || "")
      const legKey = `${player}|${propType}|${row?.book}|${row?.side}|${Number(row?.line)}`
      const isFanDuel = row?.book === "FanDuel"
      const playerCapLimit = isFanDuel ? 5 : 4
      const propCapLimit = isFanDuel ? maxPerProp + 2 : maxPerProp
      if (selectedKeys.has(legKey)) {
        selectionDropCounts.duplicateLeg++
        continue
      }
      if ((playerCounts.get(player) || 0) >= playerCapLimit) {
        selectionDropCounts.playerCap++
        continue
      }
      if ((propCounts.get(propType) || 0) >= propCapLimit) {
        selectionDropCounts.propCap++
        continue
      }

      selected.push(row)
      selectionDropCounts.selectedSecondPass++
      selectedKeys.add(legKey)
      playerCounts.set(player, (playerCounts.get(player) || 0) + 1)
      propCounts.set(propType, (propCounts.get(propType) || 0) + 1)
      if (selected.length >= cap) break
    }
  }

  // Final refill - highest-ranked remaining rows, only avoiding exact duplicates
  if (selected.length < cap) {
    for (const row of selectionSource) {
      const legKey = `${String(row?.player || "")}|${String(row?.propType || "")}|${row?.book}|${row?.side}|${Number(row?.line)}`
      if (selectedKeys.has(legKey)) {
        selectionDropCounts.duplicateLeg++
        continue
      }
      selected.push(row)
      selectionDropCounts.selectedFinalPass++
      selectedKeys.add(legKey)
      if (selected.length >= cap) break
    }
  }

  const selectedByGame = selected.reduce((acc, row) => {
    const key = String(row?.matchup || row?.eventId || "unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const filteredByBook = {
    FanDuel: filtered.filter((r) => r?.book === "FanDuel").length,
    DraftKings: filtered.filter((r) => r?.book === "DraftKings").length
  }

  const selectedByBook = {
    FanDuel: selected.filter((r) => r?.book === "FanDuel").length,
    DraftKings: selected.filter((r) => r?.book === "DraftKings").length
  }

  console.log("[BEST-PROPS-BUILDER-DEBUG]", {
    sourceCount: deduped.length,
    filteredCount: filtered.length,
    compressedCount: selectionSource.length,
    cap,
    selectedCount: selected.length,
    filteredByBook,
    selectedByBook,
    filteredByGame,
    selectedByGame,
    topRankedByBook,
    topRankedSample,
    missingFieldCounts,
    missingFieldCountsByBook,
    eligibilityDropCounts,
    selectionDropCounts,
    byBook: {
      FanDuel: selected.filter(r => r.book === "FanDuel").length,
      DraftKings: selected.filter(r => r.book === "DraftKings").length
    },
    byProp: selected.reduce((acc, row) => {
      const key = String(row?.propType || "unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  })

  return selected.map(({ __bestFallbackScore, ...row }) => normalizeBestPropVariant(row, String(row?.propVariant || "base")))
}

module.exports = { scoreBestFallbackRow, buildBestPropsFallbackRows }
