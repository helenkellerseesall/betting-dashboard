const { normalizeLower } = require("./boardHelpers")

function buildBestLadders({
  featuredLadders,
  featuredPlayScore,
  isLaneNativeLadderCandidate,
  maxRows = 5
}) {
  if (!Array.isArray(featuredLadders)) return []

  const isLaneNativeLadderRow = (row) => {
    return isLaneNativeLadderCandidate(row)
  }

  const ladderVariantRank = (row) => {
    const variant = String(row?.propVariant || "base")
    if (variant === "alt-max") return 4
    if (variant === "alt-high") return 3
    if (variant === "alt-mid") return 2
    if (variant === "alt-low") return 1
    return 0
  }

  const ladderActionabilityScore = (row) => {
    const odds = Number(row?.odds || 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const variant = String(row?.propVariant || "base")

    let score = 0
    if (variant === "alt-high") score += 10
    else if (variant === "alt-mid") score += 8
    else if (variant === "alt-max") score += 8
    else if (variant === "alt-low") score += 2

    if (Number.isFinite(odds) && odds >= 145 && odds <= 700) score += 12
    else if (Number.isFinite(odds) && odds >= 120 && odds < 145) score += 4
    else if (Number.isFinite(odds) && odds > 900) score -= 6

    if (confidence >= 0.64) score += 7
    else if (confidence >= 0.52) score += 3

    return score
  }

  const ladderCandidatesOrdered = [...featuredLadders].sort((a, b) => {
    const nativeDiff = Number(isLaneNativeLadderRow(b)) - Number(isLaneNativeLadderRow(a))
    if (nativeDiff !== 0) return nativeDiff
    const actionableDiff = ladderActionabilityScore(b) - ladderActionabilityScore(a)
    if (actionableDiff !== 0) return actionableDiff
    const variantDiff = ladderVariantRank(b) - ladderVariantRank(a)
    if (variantDiff !== 0) return variantDiff
    return featuredPlayScore(b) - featuredPlayScore(a)
  })

  const nativeLadderRows = ladderCandidatesOrdered.filter((row) => isLaneNativeLadderRow(row))
  const fallbackLadderRows = ladderCandidatesOrdered.filter((row) => !isLaneNativeLadderRow(row))

  const seenLadderKeys = new Set()
  const ladderRowsPerPlayer = new Map()
  const ladderRowsPerMatchup = new Map()
  const TONIGHTS_LADDER_MAX_PER_PLAYER = 2
  const TONIGHTS_LADDER_MAX_PER_MATCHUP = 2
  const tonightsLadders = []

  for (const row of nativeLadderRows) {
    const playerKey = normalizeLower(row?.player)
    const propTypeKey = normalizeLower(row?.propType)
    const matchupKey = normalizeLower(row?.matchup || row?.eventId)
    const ladderKey = `${playerKey}|${propTypeKey}`
    if (seenLadderKeys.has(ladderKey)) continue
    if ((ladderRowsPerPlayer.get(playerKey) || 0) >= TONIGHTS_LADDER_MAX_PER_PLAYER) continue
    if (matchupKey && (ladderRowsPerMatchup.get(matchupKey) || 0) >= TONIGHTS_LADDER_MAX_PER_MATCHUP) continue

    seenLadderKeys.add(ladderKey)
    ladderRowsPerPlayer.set(playerKey, (ladderRowsPerPlayer.get(playerKey) || 0) + 1)
    if (matchupKey) ladderRowsPerMatchup.set(matchupKey, (ladderRowsPerMatchup.get(matchupKey) || 0) + 1)
    tonightsLadders.push(row)

    if (tonightsLadders.length >= maxRows) break
  }

  if (tonightsLadders.length < maxRows) {
    for (const row of fallbackLadderRows) {
      const playerKey = normalizeLower(row?.player)
      const propTypeKey = normalizeLower(row?.propType)
      const matchupKey = normalizeLower(row?.matchup || row?.eventId)
      const ladderKey = `${playerKey}|${propTypeKey}`
      if (seenLadderKeys.has(ladderKey)) continue
      if ((ladderRowsPerPlayer.get(playerKey) || 0) >= TONIGHTS_LADDER_MAX_PER_PLAYER) continue
      if (matchupKey && (ladderRowsPerMatchup.get(matchupKey) || 0) >= TONIGHTS_LADDER_MAX_PER_MATCHUP) continue

      seenLadderKeys.add(ladderKey)
      ladderRowsPerPlayer.set(playerKey, (ladderRowsPerPlayer.get(playerKey) || 0) + 1)
      if (matchupKey) ladderRowsPerMatchup.set(matchupKey, (ladderRowsPerMatchup.get(matchupKey) || 0) + 1)
      tonightsLadders.push(row)

      if (tonightsLadders.length >= maxRows) break
    }
  }

  return tonightsLadders
}

module.exports = {
  buildBestLadders
}
