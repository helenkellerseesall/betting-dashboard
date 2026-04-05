function buildFirstBasketBoard({
  allVisibleRowsForBoards,
  dedupeBoardRows,
  sortFirstBasketBoard,
  sortSpecialBoardSmart,
  isFirstBasketLikeRow,
  isSpecialLikeFallbackCandidate,
  specialLikeFallbackScore,
  specialLikeFallbackPromotionScore,
  isTeamFirstBasketMarketRow
}) {
  const trueTeamFirstBasketRowsForBoard = allVisibleRowsForBoards.filter(isTeamFirstBasketMarketRow)

  const rawFirstBasketBoard = sortFirstBasketBoard(
    allVisibleRowsForBoards.filter(isFirstBasketLikeRow)
  ).slice(0, 20)

  const specialLikeFallbackBoardRows = sortSpecialBoardSmart(
    allVisibleRowsForBoards
      .filter(isSpecialLikeFallbackCandidate)
      .sort((a, b) => specialLikeFallbackScore(b) - specialLikeFallbackScore(a))
  ).slice(0, 10)

  const teamFirstBasketSupplyThinForBoard = trueTeamFirstBasketRowsForBoard.length <= 1
  const useSpecialLikeFirstBasketFallback =
    teamFirstBasketSupplyThinForBoard && specialLikeFallbackBoardRows.length > 0

  const firstBasketBoard = useSpecialLikeFirstBasketFallback
    ? dedupeBoardRows([...rawFirstBasketBoard, ...specialLikeFallbackBoardRows])
      .sort((a, b) => specialLikeFallbackPromotionScore(b) - specialLikeFallbackPromotionScore(a))
      .slice(0, 20)
    : rawFirstBasketBoard

  return {
    trueTeamFirstBasketRowsForBoard,
    rawFirstBasketBoard,
    specialLikeFallbackBoardRows,
    teamFirstBasketSupplyThinForBoard,
    useSpecialLikeFirstBasketFallback,
    firstBasketBoard
  }
}

module.exports = {
  buildFirstBasketBoard
}
