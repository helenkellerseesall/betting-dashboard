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

  const ladderCandidatesOrdered = [...featuredLadders].sort((a, b) => {
    const nativeDiff = Number(isLaneNativeLadderRow(b)) - Number(isLaneNativeLadderRow(a))
    if (nativeDiff !== 0) return nativeDiff
    const variantDiff = ladderVariantRank(b) - ladderVariantRank(a)
    if (variantDiff !== 0) return variantDiff
    return featuredPlayScore(b) - featuredPlayScore(a)
  })

  const nativeLadderRows = ladderCandidatesOrdered.filter((row) => isLaneNativeLadderRow(row))
  const fallbackLadderRows = ladderCandidatesOrdered.filter((row) => !isLaneNativeLadderRow(row))

  const seenLadderKeys = new Set()
  const ladderRowsPerPlayer = new Map()
  const TONIGHTS_LADDER_MAX_PER_PLAYER = 2
  const tonightsLadders = []

  for (const row of nativeLadderRows) {
    const playerKey = normalizeLower(row?.player)
    const propTypeKey = normalizeLower(row?.propType)
    const ladderKey = `${playerKey}|${propTypeKey}`
    if (seenLadderKeys.has(ladderKey)) continue
    if ((ladderRowsPerPlayer.get(playerKey) || 0) >= TONIGHTS_LADDER_MAX_PER_PLAYER) continue

    seenLadderKeys.add(ladderKey)
    ladderRowsPerPlayer.set(playerKey, (ladderRowsPerPlayer.get(playerKey) || 0) + 1)
    tonightsLadders.push(row)

    if (tonightsLadders.length >= maxRows) break
  }

  if (tonightsLadders.length < maxRows) {
    for (const row of fallbackLadderRows) {
      const playerKey = normalizeLower(row?.player)
      const propTypeKey = normalizeLower(row?.propType)
      const ladderKey = `${playerKey}|${propTypeKey}`
      if (seenLadderKeys.has(ladderKey)) continue

      seenLadderKeys.add(ladderKey)
      tonightsLadders.push(row)

      if (tonightsLadders.length >= maxRows) break
    }
  }

  return tonightsLadders
}

module.exports = {
  buildBestLadders
}
