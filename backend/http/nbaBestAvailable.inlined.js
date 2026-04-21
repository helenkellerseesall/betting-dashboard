  const currentSnapshot = oddsSnapshot
  console.log("[NBA SNAPSHOT LIVE]", {
    rawProps: currentSnapshot?.rawProps?.length
  })

  const bestAvailablePayload = buildLiveDualBestAvailablePayload({ sport: bestAvailableSportKey })

  if (!bestAvailablePayload) {
    return res.status(503).json({
      ok: false,
      error: "bestAvailable not ready",
      snapshotMeta: buildSnapshotMeta(),
      slateStateValidator: currentSnapshot?.slateStateValidator || null,
      lineHistorySummary: currentSnapshot?.lineHistorySummary || null
    })
  }

  const effectiveBestProps = (() => {
    const snapshotBest = Array.isArray(currentSnapshot.bestProps) ? currentSnapshot.bestProps : []
    const propsPool =
      Array.isArray(currentSnapshot.props) && currentSnapshot.props.length > 0
        ? currentSnapshot.props
        : (Array.isArray(currentSnapshot.rawProps) && currentSnapshot.rawProps.length > 0
          ? currentSnapshot.rawProps
          : (Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best : []))
    const fallbackBest = propsPool.length ? buildBestPropsFallbackRows(propsPool, 60) : []
    if (snapshotBest.length === 0) return Array.isArray(fallbackBest) ? fallbackBest : []
    // Non-empty but tiny bestProps (common ingestion glitch) must not starve the best board,
    // support/safe-pair seeds, or ticket builders — same recovery as empty bestProps.
    if (snapshotBest.length < 6 && Array.isArray(fallbackBest) && fallbackBest.length) {
      return dedupeSlipLegs([...snapshotBest, ...fallbackBest]).filter(Boolean)
    }
    return snapshotBest
  })()

  const LEGACY_STANDARD_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
  const legacyBestFilterDebug = {
    input: Array.isArray(effectiveBestProps) ? effectiveBestProps.length : 0,
    excludedSpecialMarketFamily: 0,
    excludedNonStandardPropType: 0,
    excludedMissingCoreFields: 0,
    forceIncludedSpecialExcluded: 0
  }
  const legacyStandardBestProps = (Array.isArray(effectiveBestProps) ? effectiveBestProps : []).filter((row) => {
    if (!row) return false

    const marketFamily = String(row?.marketFamily || "")
    if (marketFamily === "special") {
      legacyBestFilterDebug.excludedSpecialMarketFamily += 1
      if (row?.__forceInclude) legacyBestFilterDebug.forceIncludedSpecialExcluded += 1
      return false
    }

    const propType = String(row?.propType || "")
    if (!LEGACY_STANDARD_PROP_TYPES.has(propType)) {
      legacyBestFilterDebug.excludedNonStandardPropType += 1
      return false
    }

    // Team is nice-to-have on merged fallback legs; many props rows omit `team` while still
    // carrying matchup + book + line. Requiring team here was starving the board when bestProps
    // was merged up from `props`.
    if (!row?.player || !row?.matchup || !row?.propType || !row?.book) {
      legacyBestFilterDebug.excludedMissingCoreFields += 1
      return false
    }

    return true
  })

  console.log("[BEST-PROPS-ROUTE-GAME-DEBUG]", {
    total: effectiveBestProps.length,
    byBook: {
      FanDuel: effectiveBestProps.filter((row) => row?.book === "FanDuel").length,
      DraftKings: effectiveBestProps.filter((row) => row?.book === "DraftKings").length
    },
    byGame: effectiveBestProps.reduce((acc, row) => {
      const key = String(row?.matchup || row?.eventId || "unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  })

  const bestVisibleRows = Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best : []

  let standardCandidates = []
  let ladderCandidates = []
  let specialProps = []
  let routePlayableSeed = []
  let finalPlayableRows = []
  let ladderPool = []
  let expandedPoolDebug = null

  try {
    const FIRST_BASKET_MARKET_KEYS = new Set(["player_first_basket", "player_first_team_basket"])

    const normalizeExpandedPlayerKey = (value) =>
      String(value || "")
        .normalize("NFKD")
        .replace(/[’']/g, "")
        .replace(/\./g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()

    let expandedPoolInputRows = Array.isArray(currentSnapshot?.rawProps) && currentSnapshot.rawProps.length > 0
      ? currentSnapshot.rawProps
      : (Array.isArray(currentSnapshot?.props) && currentSnapshot.props.length > 0
        ? currentSnapshot.props
        : (Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best : []))

    const normalizedFirstBasketRows = (Array.isArray(expandedPoolInputRows) ? expandedPoolInputRows : [])
      .filter((row) => ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || "")))

    expandedPoolInputRows = dedupeMarketRows([
      ...(Array.isArray(expandedPoolInputRows) ? expandedPoolInputRows : []),
      ...(Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : [])
    ])

    const eventPlayerPool = new Map()
    for (const row of (Array.isArray(expandedPoolInputRows) ? expandedPoolInputRows : [])) {
      const eventKey = String(row?.eventId || row?.matchup || "")
      const playerKey = normalizeExpandedPlayerKey(row?.player)
      const marketFamily = String(row?.marketFamily || "")
      const propType = String(row?.propType || "")
      const marketKey = String(row?.marketKey || "")

      if (!eventKey || !playerKey) continue

      const isStandardLike =
        marketFamily === "standard" ||
        ["Points", "Rebounds", "Assists", "PRA", "Threes"].includes(propType) ||
        [
          "player_points",
          "player_rebounds",
          "player_assists",
          "player_points_rebounds_assists",
          "player_threes"
        ].includes(marketKey)

      if (!isStandardLike) continue

      if (!eventPlayerPool.has(eventKey)) eventPlayerPool.set(eventKey, new Set())
      eventPlayerPool.get(eventKey).add(playerKey)
    }

    const coerceFirstBasketExpandedRow = (row) => {
      if (!row) return null

      const marketKey = String(row?.marketKey || "")
      if (!FIRST_BASKET_MARKET_KEYS.has(marketKey)) return null

      const player = String(row?.player || "").trim()
      const team = String(row?.team || "").trim()
      const matchup = String(row?.matchup || "").trim()
      const awayTeam = String(row?.awayTeam || "").trim()
      const homeTeam = String(row?.homeTeam || "").trim()

      if (!player) return null
      if (!row?.eventId && !matchup) return null

      const hasTeamContext = Boolean(team && (awayTeam || homeTeam || matchup))
      if (hasTeamContext) {
        const matchupContainsTeam =
          (awayTeam && team === awayTeam) ||
          (homeTeam && team === homeTeam) ||
          (matchup && matchup.includes(team))

        if (!matchupContainsTeam) return null
      }

      const eventKey = String(row?.eventId || row?.matchup || "")
      const normalizedPlayer = normalizeExpandedPlayerKey(player)
      const knownPlayersForEvent = eventPlayerPool.get(eventKey)

      if (knownPlayersForEvent && knownPlayersForEvent.size > 0) {
        if (!knownPlayersForEvent.has(normalizedPlayer)) return null
      }

      const propType = marketKey === "player_first_team_basket" ? "First Team Basket" : "First Basket"
      const specialSubtype = marketKey === "player_first_team_basket" ? "teamFirstBasket" : "playerFirstBasket"

      return {
        ...row,
        marketFamily: "special",
        boardFamily: "special",
        propType,
        specialSubtype
      }
    }

    const expandedResult = buildExpandedMarketPools({
      ...currentSnapshot,
      rawProps: expandedPoolInputRows
    })
    standardCandidates = expandedResult.standardCandidates || []
    ladderCandidates = expandedResult.ladderCandidates || []
    specialProps = expandedResult.specialProps || []

    // --- Special props fallback: rebuild from snapshot if expandedPools returned empty ---
    // Also: always merge missing first basket / first team basket rows even if specialProps is non-empty
    const FIRST_BASKET_PROP_TYPES = new Set(["First Basket", "First Team Basket"])

    const hasFirstBasket = specialProps.some((row) => {
      const mk = String(row?.marketKey || "")
      const pt = String(row?.propType || "")
      return mk === "player_first_basket" || pt === "First Basket"
    })
    const hasFirstTeamBasket = specialProps.some((row) => {
      const mk = String(row?.marketKey || "")
      const pt = String(row?.propType || "")
      return mk === "player_first_team_basket" || pt === "First Team Basket"
    })

    if (!specialProps.length || !hasFirstBasket || !hasFirstTeamBasket) {
      const specialFallbackSource = dedupeMarketRows([
        ...(Array.isArray(currentSnapshot?.rawProps) && currentSnapshot.rawProps.length > 0
          ? currentSnapshot.rawProps
          : (Array.isArray(currentSnapshot?.props) && currentSnapshot.props.length > 0
            ? currentSnapshot.props
            : (Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best : []))),
        ...(Array.isArray(currentSnapshot?.playableProps) ? currentSnapshot.playableProps : []),
        ...(Array.isArray(currentSnapshot?.strongProps) ? currentSnapshot.strongProps : []),
        ...(Array.isArray(currentSnapshot?.eliteProps) ? currentSnapshot.eliteProps : []),
        ...(Array.isArray(currentSnapshot?.bestProps) ? currentSnapshot.bestProps : [])
      ])

      if (!specialProps.length) {
        // Full fallback: rebuild ALL special props from snapshot
        const specialFallbackRaw = specialFallbackSource.filter((row) => {
          if (row?.book !== "DraftKings") return false
          if (!row?.player) return false

          const marketKey = String(row?.marketKey || "")
          const isSpecialMarket = SPECIAL_MARKET_KEYS.has(marketKey)
          const isSpecialPropType = SPECIAL_PROP_TYPE_NAMES.has(String(row?.propType || ""))
          const shouldTreatAsSpecial = isSpecialMarket || isSpecialPropType

          if (!shouldTreatAsSpecial) return false

          // Relax metric requirements for special markets: only require player + matchup
          if (!row?.matchup && !row?.eventId) return false
          return true
        })

        specialFallbackRaw.sort((a, b) => {
          const scoreA = Number(a?.score || 0)
          const scoreB = Number(b?.score || 0)
          if (scoreB !== scoreA) return scoreB - scoreA
          return Number(b?.edge || 0) - Number(a?.edge || 0)
        })

        specialProps = specialFallbackRaw.slice(0, 40)

        console.log("[SPECIAL-PROPS-FALLBACK-DEBUG]", {
          fallbackSourceCount: specialFallbackSource.length,
          specialFallbackRawCount: specialFallbackRaw.length,
          finalSpecialPropsCount: specialProps.length
        })
      } else {
        // Partial fallback: specialProps exists but is missing first basket rows — merge them in
        const firstBasketFallback = specialFallbackSource.filter((row) => {
          if (row?.book !== "DraftKings") return false
          if (!row?.player) return false
          if (!row?.matchup && !row?.eventId) return false

          const mk = String(row?.marketKey || "")
          const pt = String(row?.propType || "")
          return FIRST_BASKET_MARKET_KEYS.has(mk) || FIRST_BASKET_PROP_TYPES.has(pt)
        })

        firstBasketFallback.sort((a, b) => {
          const oddsA = Number(a?.odds || 0)
          const oddsB = Number(b?.odds || 0)
          // Lower odds = higher implied probability = better
          return oddsA - oddsB
        })

        const firstBasketMerge = firstBasketFallback.slice(0, 30)
        specialProps = dedupeMarketRows([...specialProps, ...firstBasketMerge])

        console.log("[FIRST-BASKET-MERGE-DEBUG]", {
          firstBasketFallbackCount: firstBasketFallback.length,
          mergedCount: firstBasketMerge.length,
          totalSpecialPropsAfterMerge: specialProps.length
        })
      }
    }

    const directFirstBasketRows = dedupeMarketRows(
      (Array.isArray(expandedPoolInputRows) ? expandedPoolInputRows : [])
        .filter((row) =>
          FIRST_BASKET_MARKET_KEYS.has(String(row?.marketKey || ""))
        )
        .map(coerceFirstBasketExpandedRow)
        .filter(Boolean)
    )

    specialProps = dedupeMarketRows([
      ...(Array.isArray(specialProps) ? specialProps : []),
      ...directFirstBasketRows
    ])

    console.log("[SPECIAL-PROPS-DEBUG]", {
      totalSpecialProps: Array.isArray(specialProps) ? specialProps.length : 0,
      sampleSpecialProps: Array.isArray(specialProps)
        ? specialProps.slice(0, 10).map((row) => ({
            matchup: row?.matchup || null,
            player: row?.player || null,
            team: row?.team || null,
            marketKey: row?.marketKey || null,
            propType: row?.propType || null,
            side: row?.side || null,
            line: row?.line ?? null,
            odds: row?.odds ?? null,
            score: row?.score ?? null
          }))
        : []
    })

    console.log("[FIRST-BASKET-DEBUG]", {
      firstBasketCount: Array.isArray(specialProps)
        ? specialProps.filter((row) => String(row?.marketKey || "") === "player_first_basket").length
        : 0,
      firstTeamBasketCount: Array.isArray(specialProps)
        ? specialProps.filter((row) => String(row?.marketKey || "") === "player_first_team_basket").length
        : 0,
      sampleFirstBasketLike: Array.isArray(specialProps)
        ? specialProps
            .filter((row) =>
              ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
            )
            .slice(0, 12)
            .map((row) => ({
              matchup: row?.matchup || null,
              player: row?.player || null,
              team: row?.team || null,
              marketKey: row?.marketKey || null,
              propType: row?.propType || null,
              side: row?.side || null,
              odds: row?.odds ?? null,
              book: row?.book || null,
              eventId: row?.eventId || null
            }))
        : []
    })

    console.log("[EXPANDED-MARKET-POOLS-DEBUG]", {
      standardCount: standardCandidates.length,
      ladderCount: ladderCandidates.length,
      specialCount: specialProps.length,
      standardByProp: standardCandidates.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      ladderByProp: ladderCandidates.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      specialByProp: specialProps.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })

    // Special-props → standard pipeline fallback (thin/active slate starvation guard).
    // If standardCandidates is empty but we have valid special props, allow them to seed
    // the main playable pipeline so downstream doesn't collapse to 0.
    if (Array.isArray(standardCandidates) && standardCandidates.length === 0) {
      const specialFallback = (Array.isArray(specialProps) ? specialProps : [])
        .filter((row) => row && row.marketValidity === "valid" && row.odds != null)
        .map((row) => ({ ...row, pipelineSource: "special-fallback" }))

      if (specialFallback.length > 0) {
        standardCandidates = specialFallback
      }
    }

    routePlayableSeed = Array.isArray(standardCandidates) && standardCandidates.length > 0
      ? standardCandidates
      : buildSlipSeedPool(currentSnapshot)

    // Final-stage special fallback (must happen AFTER routePlayableSeed is built).
    if ((Array.isArray(routePlayableSeed) ? routePlayableSeed.length : 0) === 0 && (Array.isArray(specialProps) ? specialProps.length : 0) > 0) {
      console.log("[FINAL FALLBACK ACTIVATED]", specialProps.length)
      routePlayableSeed = (Array.isArray(specialProps) ? specialProps : [])
        .filter((r) => r && r.marketValidity === "valid" && r.odds != null)
        .map((r) => ({ ...r, pipelineSource: "special-final-fallback" }))
    }

    console.log("[ROUTE-PLAYABLE-SEED-DEBUG]", {
      total: routePlayableSeed.length,
      byPropType: routePlayableSeed.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byGame: routePlayableSeed.reduce((acc, row) => {
        const key = String(row?.matchup || row?.eventId || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      topSample: routePlayableSeed.slice(0, 20).map((row) => ({
        player: row?.player,
        propType: row?.propType,
        matchup: row?.matchup,
        line: row?.line,
        hitRate: row?.hitRate,
        edge: row?.edge,
        score: row?.score
      }))
    })

    const fallbackStandardCandidates = Array.isArray(standardCandidates) ? standardCandidates : []
    const fallbackRoutePlayableSeed = Array.isArray(routePlayableSeed) ? routePlayableSeed : []

    finalPlayableRows = dedupeMarketRows(
      fallbackStandardCandidates.length ? fallbackStandardCandidates : fallbackRoutePlayableSeed
    )

    if ((Array.isArray(finalPlayableRows) ? finalPlayableRows.length : 0) === 0 && (Array.isArray(specialProps) ? specialProps.length : 0) > 0) {
      console.log("[FINAL PLAYABLE FORCED]", specialProps.length)
      finalPlayableRows = (Array.isArray(specialProps) ? specialProps : []).slice(0, 10)
    }

    console.log("[FINAL-PLAYABLE-FALLBACK]", {
      standardCandidates: fallbackStandardCandidates.length,
      routePlayableSeed: fallbackRoutePlayableSeed.length,
      finalPlayableRows: finalPlayableRows.length,
      source:
        fallbackStandardCandidates.length ? "standardCandidates" :
        fallbackRoutePlayableSeed.length ? "routePlayableSeed" :
        "none"
    })

    const slipSeedPool = routePlayableSeed
    console.log("[SLIP-SEED-POOL-DEBUG]", {
      total: slipSeedPool.length,
      byPropType: slipSeedPool.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byGame: slipSeedPool.reduce((acc, row) => {
        const key = String(row?.matchup || row?.eventId || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      sample: slipSeedPool.slice(0, 15).map((row) => ({
        player: row?.player,
        propType: row?.propType,
        matchup: row?.matchup,
        line: row?.line,
        hitRate: row?.hitRate,
        edge: row?.edge,
        score: row?.score
      }))
    })

    ladderPool = slipSeedPool.flatMap((row) => getLadderVariantsForRow(row))
    console.log("[LADDER-POOL-DEBUG]", {
      baseBestCount: effectiveBestProps.length,
      ladderCount: ladderPool.length,
      incompleteBaseRows: effectiveBestProps.filter((row) => {
        return !(row && row.team && row.hitRate != null && row.hitRate !== "" && row.edge != null && row.score != null)
      }).length,
      byVariant: ladderPool.reduce((acc, row) => {
        const key = String(row?.propVariant || "base")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byProp: ladderPool.reduce((acc, row) => {
        const key = String(row?.propType || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })

    expandedPoolDebug = {
      ladderPool: Array.isArray(ladderPool) ? ladderPool.length : -1,
      routePlayableSeed: Array.isArray(routePlayableSeed) ? routePlayableSeed.length : -1,
      standardCandidates: Array.isArray(standardCandidates) ? standardCandidates.length : -1,
      finalPlayableRows: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : -1,
      ladderCandidates: Array.isArray(ladderCandidates) ? ladderCandidates.length : -1,
      specialProps: Array.isArray(specialProps) ? specialProps.length : -1
    }

    console.log("[EXPANDED-POOL-SUCCESS]", expandedPoolDebug)
  } catch (err) {
    const readableExpandedPoolError =
      err?.stack ||
      err?.message ||
      (typeof err === "string" ? err : "") ||
      JSON.stringify(err, Object.getOwnPropertyNames(err || {}))

    console.error("[EXPANDED-POOL-CRASH]", {
      message: err?.message || null,
      stack: err?.stack || null,
      expandedPoolDebug,
      readableExpandedPoolError
    })

    throw err
  }

  const oddsPropsForBaseRows = Array.isArray(currentSnapshot?.props) ? currentSnapshot.props : []
  const finalPlayableRowsForBase = Array.isArray(finalPlayableRows) ? finalPlayableRows : []
  const baseRows =
    oddsPropsForBaseRows.length > 0 ? oddsPropsForBaseRows : finalPlayableRowsForBase

  console.log("[PIPELINE SOURCE]", {
    usingProps: Array.isArray(currentSnapshot?.props) ? currentSnapshot.props.length : 0,
    usingPlayable: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : 0
  })

  const snapshotMeta = logSnapshotMeta("route=/api/best-available response")

  // === FORCE COVERAGE DEBUG ON LIVE RESPONSE PATH ===
  try {
    const scheduledEvents = Array.isArray(currentSnapshot?.events) ? currentSnapshot.events : []
    const rawPropsRows = Array.isArray(baseRows) ? baseRows : []

    console.log("[RAW-PROPS-BEFORE-FILTER]", {
      total: rawPropsRows.length,
      byBook: rawPropsRows.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    const enrichedModelRows = rawPropsRows
    const beforeFilter = rawPropsRows.length
    const survivedFragileRows = rawPropsRows.filter((r) => {
      let keep = true
      try {
        keep = !shouldRemoveLegForPlayerStatus(r) && !isFragileLeg(r)
      } catch (_) {
        keep = true
      }

      if (!keep && r?.book === "FanDuel") {
        console.log("[FANDUEL-DROPPED-DEBUG]", {
          player: r?.player,
          propType: r?.propType,
          matchup: r?.matchup,
          reason: "failed_first_filter"
        })
      }

      return keep
    })
    console.log("[RAW-PROPS-AFTER-FIRST-FILTER]", {
      before: beforeFilter,
      after: survivedFragileRows.length,
      byBook: survivedFragileRows.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    const bestPropsRawRows = Array.isArray(currentSnapshot?.bestProps) ? currentSnapshot.bestProps : []
    const finalBestVisibleRows = getAvailablePrimarySlateRows(bestPropsRawRows)

    console.log("[COVERAGE-AUDIT-CALLSITE-DEBUG]", {
      scheduledEvents: scheduledEvents.length,
      rawPropsRows: rawPropsRows.length,
      enrichedModelRows: enrichedModelRows.length,
      survivedFragileRows: survivedFragileRows.length,
      survivedFragileRowsByBook: {
        FanDuel: survivedFragileRows.filter((r) => r?.book === "FanDuel").length,
        DraftKings: survivedFragileRows.filter((r) => r?.book === "DraftKings").length
      },
      bestPropsRawRows: bestPropsRawRows.length,
      bestPropsRawRowsByBook: {
        FanDuel: bestPropsRawRows.filter((r) => r?.book === "FanDuel").length,
        DraftKings: bestPropsRawRows.filter((r) => r?.book === "DraftKings").length
      },
      finalBestVisibleRows: finalBestVisibleRows.length
    })

    runCurrentSlateCoverageDiagnostics({
      scheduledEvents,
      rawPropsRows,
      enrichedModelRows,
      survivedFragileRows,
      bestPropsRawRows,
      finalBestVisibleRows
    })
  } catch (e) {
    console.log("[COVERAGE-AUDIT-ERROR]", e?.message || e)
  }
  // === END FORCE COVERAGE DEBUG ===

  const scheduledEventsForBestPayload = Array.isArray(currentSnapshot?.events) ? currentSnapshot.events : []
  const scheduledBestEventIdSet = new Set(
    scheduledEventsForBestPayload
      .map((event) => String(event?.eventId || event?.id || ""))
      .filter(Boolean)
  )

  const bestPayloadRowsUnfiltered = legacyStandardBestProps.filter((row) => {
    if (!row) return false
    if (shouldRemoveLegForPlayerStatus(row)) return false

    const eventId = String(row?.eventId || "")
    if (!eventId) return false
    if (scheduledBestEventIdSet.size === 0) return true

    return scheduledBestEventIdSet.has(eventId)
  })

  // Final best board shaping: avoid low-impact / low-ceiling legs dominating "best".
  // (No fake fills; if slate is truly thin, list may be smaller.)
  const bestPayloadCandidates = bestPayloadRowsUnfiltered.filter((row) => {
    const ceiling = Number(row?.ceilingScore || 0)
    const propType = String(row?.propType || "")
    const line = Number(row?.line || 0)
    if (propType === "Threes" && line > 0 && line <= 1.5 && ceiling < 0.62) return false
    if (ceiling > 0 && ceiling < 0.5) return false
    return true
  })
  const exportSlateMode = detectSlateMode({
    sportKey: "nba",
    snapshotMeta: buildSnapshotMeta(),
    snapshot: currentSnapshot,
    runtime: {
      // Don't require loaded-slate pass; we only need games->mode behavior here.
      loadedSlateQualityPassEnabled: Boolean(
        (Array.isArray(currentSnapshot?.props) && currentSnapshot.props.length > 0) ||
          (Array.isArray(finalPlayableRows) && finalPlayableRows.length > 0)
      )
    }
  })
  // Ticket/longshot/support pools must NOT use export-shaped `best` (too small); use full export candidates.
  // `bestPayloadRows` / `bestPayloadRowsForTickets` are finalized after `boardSourceRowsWithGameRole` so we can
  // hydrate thin/fallback legs from the scored board row pool (export integrity).
  const bestExportCap = exportSlateMode.mode === "thin" || exportSlateMode.mode === "thinBad" ? 8 : 14
  let bestPayloadRowsForTickets = []
  let bestPayloadRows = []

  console.log("[FINAL-PLAYABLE-RUNTIME-CHECK]", {
    ladderPool: Array.isArray(ladderPool) ? ladderPool.length : -1,
    routePlayableSeed: Array.isArray(routePlayableSeed) ? routePlayableSeed.length : -1,
    standardCandidates: Array.isArray(standardCandidates) ? standardCandidates.length : -1,
    finalPlayableRows: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : -1,
    ladderCandidates: Array.isArray(ladderCandidates) ? ladderCandidates.length : -1,
    specialProps: Array.isArray(specialProps) ? specialProps.length : -1
  })

  // --- Build enriched board source pool ---
  const dedupeBoardRows = (rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    const seen = new Set()
    const out = []

    for (const row of safeRows) {
      const key = [
        String(row?.eventId || ""),
        String(row?.player || ""),
        String(row?.matchup || ""),
        String(row?.marketKey || ""),
        String(row?.propType || ""),
        String(row?.side || ""),
        String(row?.line ?? ""),
        String(row?.odds ?? ""),
        String(row?.propVariant || "base")
      ].join("|")

      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }

    return out
  }

  const enrichedSpecialProps = Array.isArray(specialProps)
    ? specialProps.map(enrichSpecialPredictionRow)
    : []

  const effectiveBestPropsForBoardSource = (Array.isArray(effectiveBestProps) ? effectiveBestProps : []).filter((row) => {
    const marketFamily = String(row?.marketFamily || "").toLowerCase()
    const marketKey = String(row?.marketKey || "")
    const propType = String(row?.propType || "")
    if (marketFamily === "special") return false
    if (SPECIAL_MARKET_KEYS.has(marketKey)) return false
    if (SPECIAL_PROP_TYPE_NAMES.has(propType)) return false
    return true
  })

  const boardSourceRows = dedupeBoardRows([
    ...(Array.isArray(baseRows) ? baseRows : []),
    ...(Array.isArray(standardCandidates) ? standardCandidates : []),
    ...(Array.isArray(ladderPool) ? ladderPool : []),
    ...(Array.isArray(enrichedSpecialProps) ? enrichedSpecialProps : []),
    ...effectiveBestPropsForBoardSource
  ])

  console.log("[BOARD-SOURCE-DEBUG]", {
    boardSourceRows: Array.isArray(boardSourceRows) ? boardSourceRows.length : 0,
    withEvidence: Array.isArray(boardSourceRows)
      ? boardSourceRows.filter((row) => row?.evidence).length
      : 0,
    withWhyItRates: Array.isArray(boardSourceRows)
      ? boardSourceRows.filter((row) => Array.isArray(row?.whyItRates) && row.whyItRates.length > 0).length
      : 0,
    withPredictionScores: Array.isArray(boardSourceRows)
      ? boardSourceRows.filter((row) =>
          row?.gamePriorityScore !== null &&
          row?.gamePriorityScore !== undefined &&
          row?.playerConfidenceScore !== null &&
          row?.playerConfidenceScore !== undefined
        ).length
      : 0,
    firstBasketLike: Array.isArray(boardSourceRows)
      ? boardSourceRows.filter((row) =>
          ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
        ).length
      : 0
  })

  // --- Build market-siloed boards ---
  const classifiedBoardSourceRows = boardSourceRows.map((row) => {
    const classified = classifyBoardRow(row)
    return {
      ...row,
      boardFamily: classified?.boardFamily || null,
      ladderSubtype: classified?.ladderSubtype || null,
      specialSubtype: classified?.specialSubtype || null
    }
  })
  const gameEdgeMap = buildGameEdgeMap(classifiedBoardSourceRows)
  const boardSourceRowsWithGameRole = applyGameAndRoleEdge(classifiedBoardSourceRows, gameEdgeMap).map((row) => ({
    ...row,
    playDecision: inferPlayDecision(row)
  })).map((row) => ({
    ...row,
    decisionSummary: buildDecisionSummary(row)
  }))
  const nbaEnrichmentHydrationSources = dedupeBoardRows([
    ...boardSourceRowsWithGameRole,
    ...(Array.isArray(baseRows) ? baseRows : []),
    ...(Array.isArray(currentSnapshot?.rawProps) ? currentSnapshot.rawProps : [])
  ])
  const nbaEnrichmentLegLookup = buildNbaEnrichmentLegLookup(nbaEnrichmentHydrationSources)
  const nbaTeamByPlayerEvent = buildNbaTeamByPlayerEventMap(currentSnapshot)
  const nbaTeamByPlayerSingleEvent = buildNbaTeamByPlayerSingleEventMap(currentSnapshot)
  // --- Build BROADER post-hydration COMPLETE universe (system rule) ---
  // We must not build core outputs off the small `bestProps` seed. Instead, use the full scored
  // board-source universe, then enforce dataState gates.
  const hydrateRowForState = (row) => {
    const merged = mergeNbaExportRowWithEnrichmentLookup(row, nbaEnrichmentLegLookup)
    const recovered = recoverNbaExportRowTeamAndVenue(merged)
    const indexed = fillNbaRowTeamFromSingleEventMap(
      fillNbaRowTeamFromPlayerEventMap(recovered, nbaTeamByPlayerEvent),
      nbaTeamByPlayerSingleEvent
    )
    if (String(indexed?.team || "").trim()) return withNbaRowDataState(indexed)
    const t = resolveCanonicalPlayerTeamForRow(indexed)
    return withNbaRowDataState(t ? { ...indexed, team: t } : indexed)
  }

  const isAllowedNbaBookInline = (row) => {
    const b = String(row?.book || "").trim().toLowerCase()
    return b === "draftkings" || b === "fanduel" || b === "fanatics" || b === "betmgm" || b === "caesars"
  }
  const isNbaSpecialMarketInline = (row) => {
    const marketKey = String(row?.marketKey || "").toLowerCase()
    const propType = String(row?.propType || "").toLowerCase()
    return (
      marketKey.includes("first_basket") ||
      marketKey.includes("first_team_basket") ||
      marketKey.includes("double_double") ||
      marketKey.includes("triple_double") ||
      propType.includes("first basket") ||
      propType.includes("first team basket") ||
      propType.includes("double double") ||
      propType.includes("triple double")
    )
  }

  const bestPropsCountSnapshot = Array.isArray(currentSnapshot?.bestProps) ? currentSnapshot.bestProps.length : 0
  // If bestProps is empty, generate a scored fallback pool from props so COMPLETE rows exist
  // for core outputs (still gated by dataState === "complete").
  const fallbackScoredCoreRows = (() => {
    if (bestPropsCountSnapshot > 0) return []
    const propsPool = Array.isArray(baseRows) ? baseRows : []
    if (!propsPool.length) return []
    const fb = buildBestPropsFallbackRows(propsPool, 80)
    const safe = Array.isArray(fb) ? fb : []
    const allowedBases = new Set(["points", "rebounds", "assists", "threes", "pra"])
    const out = []
    for (let i = 0; i < safe.length; i += 1) {
      const r = safe[i]
      if (!r) continue
      // Only bootstrap bettable standard props (specials like double-double don't help core best/safePair).
      if (!allowedBases.has(normalizePropTypeBase(r?.propType))) continue
      if (!Number.isFinite(Number(r?.line)) || !Number.isFinite(Number(r?.odds))) continue
      const scoreExisting = Number(r?.score)
      const edgeExisting = Number(r?.edge)
      const pv = Number(r?.projectedValue)
      // Use a deterministic rank-based score when the row lacks a model score.
      const score =
        Number.isFinite(scoreExisting)
          ? scoreExisting
          : Number((120 - (i * 0.35)).toFixed(1))
      const edge =
        Number.isFinite(edgeExisting)
          ? edgeExisting
          : (Number.isFinite(pv) ? pv : 0)
      out.push({
        ...r,
        score,
        edge,
        __fallbackScoredCore: true
      })
    }
    return out.slice(0, 60)
  })()

  const postHydrationUniverse = dedupeBoardRows(
    [
      ...fallbackScoredCoreRows,
      ...(Array.isArray(nbaEnrichmentHydrationSources) ? nbaEnrichmentHydrationSources : [])
    ].map(hydrateRowForState)
  )
  const stateCounts = postHydrationUniverse.reduce((acc, r) => {
    const k = String(r?.dataState || "unknown")
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  const completeUniverse = postHydrationUniverse.filter((r) => r?.dataState === "complete")
  const partialUniverse = postHydrationUniverse.filter((r) => r?.dataState === "partial")
  const invalidUniverse = postHydrationUniverse.filter((r) => r?.dataState === "invalid")

  const nbaRowStateDistForPayload = {
    complete: completeUniverse.length,
    partial: partialUniverse.length,
    invalid: invalidUniverse.length
  }

  // Core best universe: COMPLETE + standard props only (no ladders/specials).
  const allowedBestVariants = new Set(["base", "alt-low", "alt-mid", "alt-high"])
  const completeBettableNonSpecial = completeUniverse
    .filter((row) => isAllowedNbaBookInline(row))
    .filter((row) => !isNbaSpecialMarketInline(row))
    .filter((row) => allowedBestVariants.has(String(row?.propVariant || "base").toLowerCase()))
    // Core bettable requirement (separate from dataState): you can't export a core pick without line+odds.
    .filter((row) => Number.isFinite(Number(row?.line)) && Number.isFinite(Number(row?.odds)))

  // Keep legacy-core prop types as the preferred best universe.
  const allowedBestPropTypeBases = new Set(["points", "rebounds", "assists", "threes", "pra"])
  const completeCoreStandard = completeBettableNonSpecial
    .filter((row) => allowedBestPropTypeBases.has(normalizePropTypeBase(row?.propType)))

  const completeCoreBaseOnly = completeCoreStandard
    .filter((row) => String(row?.propVariant || "base").toLowerCase() === "base")

  const coreFallbackActivated = bestPropsCountSnapshot === 0 && (Array.isArray(fallbackScoredCoreRows) ? fallbackScoredCoreRows.length : 0) > 0

  // Permanent rule: exported core best uses COMPLETE rows only.
  // Diversify to avoid one-player domination on thin slates (without additional "ceiling" gates).
  const selectDiversifiedBestFromComplete = (rows, cap) => {
    const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
      const s = Number(b?.score || 0) - Number(a?.score || 0)
      if (s !== 0) return s
      const e = Number(b?.edge || 0) - Number(a?.edge || 0)
      if (e !== 0) return e
      return Number(b?.odds || 0) - Number(a?.odds || 0)
    })
    const out = []
    const perPlayer = new Map()
    const perPlayerProp = new Set()
    const maxPerPlayer = exportSlateMode.mode === "thin" || exportSlateMode.mode === "thinBad" ? 2 : 2
    const maxPerPlayerPropType = 1
    for (const r of sorted) {
      if (out.length >= cap) break
      const playerKey = normalizePlayerName(String(r?.player || ""))
      if (!playerKey) continue
      const pCount = perPlayer.get(playerKey) || 0
      if (pCount >= maxPerPlayer) continue
      const pt = normalizePropTypeBase(r?.propType)
      const ppKey = pt ? `${playerKey}|${pt}` : null
      if (ppKey && perPlayerProp.has(ppKey)) continue
      out.push(r)
      perPlayer.set(playerKey, pCount + 1)
      if (ppKey) perPlayerProp.add(ppKey)
    }
    return out
  }

  // If snapshot bestProps is empty but COMPLETE pool exists, build from COMPLETE pool anyway.
  const bestSelectionSource = completeCoreStandard.length ? completeCoreStandard : completeBettableNonSpecial
  const selectedBestComplete = selectDiversifiedBestFromComplete(bestSelectionSource, bestExportCap)

  bestPayloadRows = selectedBestComplete
    .map((row) => attachNbaPregameExportFields(stripStaleNbaPregameFieldsForRebuild(row)))

  // Ticket/support safe-pair path: COMPLETE only (system rule), but broader than best export.
  // Keep enough depth so safe pairs can populate when the slate truly has 2+ complete support legs.
  bestPayloadRowsForTickets = completeCoreBaseOnly.length ? completeCoreBaseOnly : completeBettableNonSpecial
    .slice()
    .sort((a, b) => {
      const s = Number(b?.score || 0) - Number(a?.score || 0)
      if (s !== 0) return s
      return Number(b?.edge || 0) - Number(a?.edge || 0)
    })
    .slice(0, 28)
    .map((row) => attachNbaPregameExportFields(stripStaleNbaPregameFieldsForRebuild(row)))

  const firstBestHydrationProbe = bestPayloadRows[0] || null
  const firstBestHydrationSourceKey = firstBestHydrationProbe
    ? (String(firstBestHydrationProbe?.marketKey || "").trim()
      ? buildNbaExportHydrationKey(firstBestHydrationProbe)
      : buildNbaExportHydrationKeyPropType(firstBestHydrationProbe))
    : null
  const firstBestHydrationSource =
    firstBestHydrationSourceKey && nbaEnrichmentLegLookup.byPrimary.has(firstBestHydrationSourceKey)
      ? nbaEnrichmentLegLookup.byPrimary.get(firstBestHydrationSourceKey)
      : firstBestHydrationSourceKey && nbaEnrichmentLegLookup.byPropType.has(firstBestHydrationSourceKey)
        ? nbaEnrichmentLegLookup.byPropType.get(firstBestHydrationSourceKey)
        : null

  console.log("[BEST-EXPORT-HYDRATION-DEBUG]", {
    hydrationSourceRows: nbaEnrichmentHydrationSources.length,
    lookupPrimarySize: nbaEnrichmentLegLookup.byPrimary.size,
    lookupPropTypeSize: nbaEnrichmentLegLookup.byPropType.size,
    teamIndexSize: nbaTeamByPlayerEvent.size,
    singleEventTeamIndexSize: nbaTeamByPlayerSingleEvent.size,
    exportGateIn: postHydrationUniverse.length,
    exportGatePass: completeUniverse.length,
    exportBestQuality: completeCoreStandard.length,
    exportGateOut: completeCoreStandard.length,
    completeUniverse: completeUniverse.length,
    completeBettableNonSpecial: completeBettableNonSpecial.length,
    completeCoreStandard: completeCoreStandard.length,
    bestPropsCountSnapshot,
    coreFallbackActivated,
    exportBestLen: bestPayloadRows.length,
    sampleSourceCeiling: firstBestHydrationSource ? Number(firstBestHydrationSource.ceilingScore) : null,
    sampleExportCeiling: firstBestHydrationProbe ? Number(firstBestHydrationProbe.ceilingScore) : null,
    sampleExportAvgMin: firstBestHydrationProbe ? firstBestHydrationProbe.avgMin : null
  })

  console.log("[NBA-ROW-DATASTATE-DISTRIBUTION]", {
    complete: completeUniverse.length,
    partial: partialUniverse.length,
    invalid: invalidUniverse.length,
    byState: stateCounts
  })

  console.log("[BEST-PROPS-VISIBILITY-FILTER-DEBUG]", {
    beforeTotal: Array.isArray(effectiveBestProps) ? effectiveBestProps.length : 0,
    afterLegacyStandardFilter: Array.isArray(legacyStandardBestProps) ? legacyStandardBestProps.length : 0,
    afterTotal: Array.isArray(bestPayloadRows) ? bestPayloadRows.length : 0,
    excludedSpecialFromLegacyBestProps: legacyBestFilterDebug.excludedSpecialMarketFamily,
    excludedNonStandardFromLegacyBestProps: legacyBestFilterDebug.excludedNonStandardPropType,
    excludedMissingCoreFieldsFromLegacyBestProps: legacyBestFilterDebug.excludedMissingCoreFields,
    forceIncludedSpecialExcludedFromLegacyBestProps: legacyBestFilterDebug.forceIncludedSpecialExcluded
  })

  if (bestAvailablePayload) {
    bestAvailablePayload.best = bestPayloadRows
    if (bestAvailablePayload.availableCounts) {
      bestAvailablePayload.availableCounts.best = {
        total: bestPayloadRows.length,
        fanduel: bestPayloadRows.filter((row) => row?.book === "FanDuel").length,
        draftkings: bestPayloadRows.filter((row) => row?.book === "DraftKings").length
      }
    }
  }

  const ladderPresentationAlternateMarketKeys = new Set([
    "player_points_alternate",
    "player_rebounds_alternate",
    "player_assists_alternate",
    "player_threes_alternate",
    "player_points_rebounds_assists_alternate"
  ])
  const ladderPresentationVariants = new Set(["alt-low", "alt-mid", "alt-high", "alt-max"])
  const ladderTypeByMarketKey = {
    player_points_alternate: "Points",
    player_rebounds_alternate: "Rebounds",
    player_assists_alternate: "Assists",
    player_threes_alternate: "Threes",
    player_points_rebounds_assists_alternate: "PRA"
  }
  const boardSourceRowsWithLadderPresentation = boardSourceRowsWithGameRole.map((row) => {
    const marketKey = String(row?.marketKey || "")
    const propVariant = String(row?.propVariant || "base")
    const isAlternateMarketRow = ladderPresentationAlternateMarketKeys.has(marketKey)
    const isSyntheticLadderVariant = ladderPresentationVariants.has(propVariant)
    const isLadderBoardRow = String(row?.boardFamily || "") === "ladder" || String(row?.ladderSubtype || "") !== ""
    const shouldAttachLadderPresentation = isAlternateMarketRow || isSyntheticLadderVariant || isLadderBoardRow
    if (!shouldAttachLadderPresentation) {
      return row
    }

    const side = String(row?.side || "")
    const lineValue = Number(row?.line)
    const hasMilestoneLikeShape = isAlternateMarketRow && side === "Over" && Number.isFinite(lineValue)
    const ladderPresentation = hasMilestoneLikeShape ? "milestoneLike" : "altLine"
    const ladderTarget = Number.isFinite(lineValue) ? lineValue : null
    const labelType = String(
      row?.propType ||
      ladderTypeByMarketKey[marketKey] ||
      "Ladder"
    ).replace(/\s+Ladder$/i, "").trim()
    const normalizedThreshold = Number.isFinite(lineValue)
      ? (Number.isInteger(lineValue) ? lineValue : Number(lineValue.toFixed(1)))
      : null
    const ladderLabel = hasMilestoneLikeShape
      ? `${normalizedThreshold}+ ${labelType}`.trim()
      : Number.isFinite(lineValue)
        ? `${side === "Under" ? "Under" : side === "Over" ? "Over" : "Alt"} ${normalizedThreshold} ${labelType}`.trim()
        : `Alt ${labelType}`.trim()

    return {
      ...row,
      ladderPresentation,
      ladderLabel,
      ladderTarget
    }
  })

  console.log("[BOARD-CLASSIFIER-DEBUG]", {
    boardFamily: boardSourceRowsWithGameRole.reduce((acc, row) => {
      const key = String(row?.boardFamily || "unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    ladderSubtype: boardSourceRowsWithGameRole.reduce((acc, row) => {
      const key = String(row?.ladderSubtype || "none")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    specialSubtype: boardSourceRowsWithGameRole.reduce((acc, row) => {
      const key = String(row?.specialSubtype || "none")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    teamFirstBasketCount: boardSourceRowsWithGameRole.filter((row) => isTeamFirstBasketRow(row)).length,
    milestoneLadderCount: boardSourceRowsWithGameRole.filter((row) => isMilestoneLadderRow(row)).length
  })

  const visibleInputRawProps = Array.isArray(baseRows) ? baseRows : []

  console.log("[VISIBLE INPUT COUNT]", visibleInputRawProps.length)
  console.log("[VISIBLE FILTER BEFORE]", visibleInputRawProps.slice(0, 20).map((r) => ({
    propType: r?.propType,
    marketKey: r?.marketKey,
    marketFamily: r?.marketFamily,
    propVariant: r?.propVariant,
    marketValidity: r?.marketValidity
  })))

  // Critical: do not starve boards to zero. Use a relaxed visibility filter that
  // keeps valid markets with odds + propType, including ladders/alts/live rows.
  const allVisibleRowsForBoards = visibleInputRawProps.filter((row) =>
    row &&
    row.marketValidity === "valid" &&
    row.odds != null &&
    row.propType != null
  )

  console.log("[VISIBLE OUTPUT COUNT]", allVisibleRowsForBoards.length)
  const ladderPresentationRows = allVisibleRowsForBoards.filter((row) =>
    String(row?.ladderPresentation || "").length > 0
  )
  console.log("[LADDER-PRESENTATION-DEBUG]", {
    totalLadderRows: ladderPresentationRows.length,
    milestoneLikeCount: ladderPresentationRows.filter((row) => row?.ladderPresentation === "milestoneLike").length,
    altLineCount: ladderPresentationRows.filter((row) => row?.ladderPresentation === "altLine").length,
    ladderLabelSample: [...new Set(
      ladderPresentationRows
        .map((row) => String(row?.ladderLabel || "").trim())
        .filter(Boolean)
    )].slice(0, 10)
  })

  const CORE_STANDARD_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
  const LADDER_PROP_VARIANTS = new Set(["alt-low", "alt-mid", "alt-high", "alt-max"])

  const hasCoreBoardFields = (row) =>
    Boolean(row?.player && row?.team && row?.matchup && row?.propType && row?.book)

  const hasSpecialBoardFields = (row) =>
    Boolean(row?.player && row?.matchup && row?.propType && row?.book)

  const isLaneNativeLadderCandidate = (row) => {
    const marketFamily = String(row?.marketFamily || "")
    const propVariant = String(row?.propVariant || "base")
    const propType = String(row?.propType || "")
    const side = String(row?.side || "")
    if (marketFamily === "special") return false
    if (!LADDER_PROP_VARIANTS.has(propVariant)) return false
    if (!CORE_STANDARD_PROP_TYPES.has(propType)) return false
    if (side !== "Over") return false
    if (isFirstBasketLikeRow(row)) return false
    return true
  }

  const TEAM_FIRST_BASKET_MARKET_KEY = "player_first_team_basket"
  const isTeamFirstBasketMarketRow = (row) => String(row?.marketKey || "") === TEAM_FIRST_BASKET_MARKET_KEY
  const isSpecialLikeFallbackCandidate = (row) => {
    if (!hasSpecialBoardFields(row)) return false
    if (isFirstBasketLikeRow(row)) return false
    if (isLaneNativeLadderCandidate(row)) return false
    const marketFamily = String(row?.marketFamily || "")
    const propVariant = String(row?.propVariant || "base")
    const odds = Number(row?.odds || 0)
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const tier = String(row?.confidenceTier || "").toLowerCase()
    const isSpecialTier = tier.startsWith("special-")
    const isAggressiveAlt = ["alt-mid", "alt-high", "alt-max"].includes(propVariant)
    const isInterestingPlusMoney = Number.isFinite(odds) && odds >= 140
    if (confidence < 0.20) return false
    return marketFamily === "special" || isSpecialTier || isAggressiveAlt || isInterestingPlusMoney
  }
  const specialLikeFallbackScore = (row) => {
    const confidence = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0)
    const volatility = Number(row?.volatilityScore || 0)
    const gamePriority = Number(row?.gamePriorityScore || 0)
    const odds = Number(row?.odds || 0)
    const propVariant = String(row?.propVariant || "base")
    const tier = String(row?.confidenceTier || "").toLowerCase()

    let score = (confidence * 100) + (volatility * 30) + (gamePriority * 20)
    if (tier === "special-elite") score += 10
    else if (tier === "special-strong") score += 7
    else if (tier === "special-playable") score += 4
    if (["alt-mid", "alt-high", "alt-max"].includes(propVariant)) score += 8
    if (Number.isFinite(odds) && odds >= 180 && odds <= 1200) score += 10
    else if (Number.isFinite(odds) && odds > 1200) score += 4
    return score
  }
  const specialLikeFallbackPromotionScore = (row) => {
    const marketKey = String(row?.marketKey || "")
    const propVariant = String(row?.propVariant || "base")
    const odds = Number(row?.odds || 0)

    let score = specialLikeFallbackScore(row)
    if (isFirstBasketLikeRow(row)) score += 90
    if (marketKey === TEAM_FIRST_BASKET_MARKET_KEY) score += 30
    if (marketKey === "player_first_basket") score += 24
    if (propVariant === "alt-max") score += 10
    else if (propVariant === "alt-high") score += 8
    else if (propVariant === "alt-mid") score += 6

    if (Number.isFinite(odds) && odds >= 180 && odds <= 950) score += 10
    else if (Number.isFinite(odds) && odds > 950) score += 5
    else if (Number.isFinite(odds) && odds > 0 && odds < 130) score -= 12

    return score
  }

  console.log("[RAW PROP TYPES]", (Array.isArray(allVisibleRowsForBoards) ? allVisibleRowsForBoards : []).map((r) => r?.propType).slice(0, 50))
  console.log("[MARKET KEYS]", (Array.isArray(allVisibleRowsForBoards) ? allVisibleRowsForBoards : []).map((r) => r?.marketKey).slice(0, 50))

  const finalPlayableForBoard = Array.isArray(finalPlayableRows) ? finalPlayableRows : []
  const isSpecialOnlySlate =
    finalPlayableForBoard.length > 0 &&
    finalPlayableForBoard.every((row) => String(row?.marketFamily) === "special")

  let coreStandardProps
  let ladderProps
  let specialPropsBoard

  if (isSpecialOnlySlate) {
    console.log("[SPECIAL ONLY SLATE MODE]", {
      rows: finalPlayableForBoard.length
    })
    specialPropsBoard = dedupeBoardRows(
      sortSpecialBoard(
        finalPlayableForBoard.map((r) => ({
          ...r,
          pipelineSource: "special-only-slate"
        }))
      )
    )
    coreStandardProps = []
    ladderProps = []
  } else {
    coreStandardProps = dedupeBoardRows(
      sortCorePropsBoard(
        allVisibleRowsForBoards.filter((row) => {
          if (!hasCoreBoardFields(row)) return false
          if (String(row?.marketFamily || "") === "special") return false
          if (!CORE_STANDARD_PROP_TYPES.has(String(row?.propType || ""))) return false
          const propVariant = String(row?.propVariant || "base")
          return propVariant === "base" || propVariant === "default"
        })
      )
    )

    ladderProps = dedupeBoardRows(
      sortLadderBoard(
        allVisibleRowsForBoards.filter((row) => {
          if (!hasCoreBoardFields(row)) return false
          if (String(row?.marketFamily || "") === "special") return false
          const propVariant = String(row?.propVariant || "base")
          return LADDER_PROP_VARIANTS.has(propVariant)
        })
      )
    )

    specialPropsBoard = dedupeBoardRows(
      sortSpecialBoard(
        allVisibleRowsForBoards.filter((row) => {
          if (!hasSpecialBoardFields(row)) return false
          return String(row?.marketFamily || "") === "special"
        })
      )
    )

    console.log("[CLASSIFICATION COUNTS]", {
      core: coreStandardProps.length,
      ladder: ladderProps.length,
      special: specialPropsBoard.length
    })

    // Thin/active slate guard: if core props starve to 0 but we still have raw board rows,
    // allow degraded-but-valid core rows (market validity + odds + propType) to seed the core board.
    if (coreStandardProps.length === 0 && (Array.isArray(allVisibleRowsForBoards) ? allVisibleRowsForBoards.length : 0) > 0) {
      const relaxedCore = (Array.isArray(allVisibleRowsForBoards) ? allVisibleRowsForBoards : []).filter((row) => {
        if (!row) return false
        if (String(row?.marketFamily || "") === "special") return false
        if (!CORE_STANDARD_PROP_TYPES.has(String(row?.propType || ""))) return false
        return row.marketValidity === "valid" && row.odds != null && row.propType != null
      })
      if (relaxedCore.length > 0) {
        coreStandardProps = dedupeBoardRows(sortCorePropsBoard(relaxedCore.map((r) => ({ ...r, pipelineSource: r?.pipelineSource || "core-relaxed-fallback" }))))
      }
    }

    // Connect boards to the playable pipeline when snapshot-visible rows do not classify
    // into core/ladder/special but `finalPlayableRows` already has valid legs.
    const playableBoardFallbackPool = finalPlayableForBoard.filter(
      (row) => row && row.propType != null && row.marketValidity === "valid"
    )

    const prePlayableBoardCounts = {
      core: coreStandardProps.length,
      ladder: ladderProps.length,
      special: specialPropsBoard.length
    }

    if (coreStandardProps.length === 0 && playableBoardFallbackPool.length > 0) {
      const coreFromPlayableStrict = playableBoardFallbackPool.filter((row) => {
        if (!hasCoreBoardFields(row)) return false
        if (String(row?.marketFamily || "") === "special") return false
        if (!CORE_STANDARD_PROP_TYPES.has(String(row?.propType || ""))) return false
        const propVariant = String(row?.propVariant || "base")
        return propVariant === "base" || propVariant === "default"
      })
      const coreFromPlayable =
        coreFromPlayableStrict.length > 0
          ? coreFromPlayableStrict
          : playableBoardFallbackPool
      coreStandardProps = dedupeBoardRows(
        sortCorePropsBoard(
          coreFromPlayable.map((r) => ({ ...r, pipelineSource: r?.pipelineSource || "playable-core-fallback" }))
        )
      )
    }

    if (ladderProps.length === 0 && playableBoardFallbackPool.length > 0) {
      const ladderFromPlayable = playableBoardFallbackPool.filter((row) => {
        if (!hasCoreBoardFields(row)) return false
        if (String(row?.marketFamily || "") === "special") return false
        const propVariant = String(row?.propVariant || "base")
        return LADDER_PROP_VARIANTS.has(propVariant)
      })
      if (ladderFromPlayable.length > 0) {
        ladderProps = dedupeBoardRows(
          sortLadderBoard(
            ladderFromPlayable.map((r) => ({ ...r, pipelineSource: r?.pipelineSource || "playable-ladder-fallback" }))
          )
        )
      }
    }

    if (specialPropsBoard.length === 0 && playableBoardFallbackPool.length > 0) {
      const specialFromPlayable = playableBoardFallbackPool.filter((row) => {
        if (!hasSpecialBoardFields(row)) return false
        return String(row?.marketFamily || "") === "special"
      })
      if (specialFromPlayable.length > 0) {
        specialPropsBoard = dedupeBoardRows(
          sortSpecialBoard(
            specialFromPlayable.map((r) => ({ ...r, pipelineSource: r?.pipelineSource || "playable-special-fallback" }))
          )
        )
      }
    }

    let boardCountsAfterPlayable = {
      coreStandardProps: coreStandardProps.length,
      ladderProps: ladderProps.length,
      specialProps: specialPropsBoard.length
    }

    if (
      playableBoardFallbackPool.length > 0 &&
      (boardCountsAfterPlayable.coreStandardProps > prePlayableBoardCounts.core ||
        boardCountsAfterPlayable.ladderProps > prePlayableBoardCounts.ladder ||
        boardCountsAfterPlayable.specialProps > prePlayableBoardCounts.special)
    ) {
      console.log("[BOARD FALLBACK ACTIVATED]", {
        finalPlayableRows: finalPlayableForBoard.length,
        coreAssigned: coreStandardProps.length
      })
    }
  }

  let boardCounts = {
    coreStandardProps: coreStandardProps.length,
    ladderProps: ladderProps.length,
    specialProps: specialPropsBoard.length
  }

  console.log("[NBA-BOARD-SHAPING-DEBUG]", {
    counts: boardCounts,
    coreStandardSample: coreStandardProps.slice(0, 5).map((row) => ({
      player: row?.player || null,
      matchup: row?.matchup || null,
      propType: row?.propType || null,
      marketKey: row?.marketKey || null,
      propVariant: row?.propVariant || "base"
    })),
    ladderSample: ladderProps.slice(0, 5).map((row) => ({
      player: row?.player || null,
      matchup: row?.matchup || null,
      propType: row?.propType || null,
      marketKey: row?.marketKey || null,
      propVariant: row?.propVariant || "base"
    })),
    specialSample: specialPropsBoard.slice(0, 5).map((row) => ({
      player: row?.player || null,
      matchup: row?.matchup || null,
      propType: row?.propType || null,
      marketKey: row?.marketKey || null,
      line: row?.line ?? null
    }))
  })

  const {
    trueTeamFirstBasketRowsForBoard,
    rawFirstBasketBoard,
    specialLikeFallbackBoardRows,
    teamFirstBasketSupplyThinForBoard,
    useSpecialLikeFirstBasketFallback,
    firstBasketBoard
  } = buildFirstBasketBoard({
    allVisibleRowsForBoards,
    dedupeBoardRows,
    sortFirstBasketBoard,
    sortSpecialBoardSmart,
    isFirstBasketLikeRow,
    isSpecialLikeFallbackCandidate,
    specialLikeFallbackScore,
    specialLikeFallbackPromotionScore,
    isTeamFirstBasketMarketRow
  })

  const corePropsBoard = sortCorePropsBoard(
    allVisibleRowsForBoards.filter((row) => isCorePropRow(row) && !isLadderRow(row))
  ).slice(0, 40)

  const ladderBoard = sortLadderBoard(
    allVisibleRowsForBoards.filter(isLadderRow)
  ).slice(0, 40)

  const specialBoardSourceRows = allVisibleRowsForBoards.filter(
    (row) => isSpecialButNotFirstBasketRow(row) || isFirstBasketLikeRow(row)
  )
  const sortedSpecialBoardRows = sortSpecialBoard(specialBoardSourceRows)
  const specialBoardFirstBasketRows = sortedSpecialBoardRows.filter(isFirstBasketLikeRow).slice(0, 6)
  const specialBoardNonFirstBasketRows = sortedSpecialBoardRows.filter((row) => !isFirstBasketLikeRow(row))
  const specialBoard = dedupeBoardRows([
    ...specialBoardFirstBasketRows,
    ...specialBoardNonFirstBasketRows
  ]).slice(0, 20)

  const lottoBoard = sortLottoBoard(
    allVisibleRowsForBoards.filter((row) => isLottoStyleRow(row) || isFirstBasketLikeRow(row))
  ).slice(0, 30)

  console.log("[BOARD-BUILDER-DEBUG]", {
    firstBasketBoard: Array.isArray(firstBasketBoard) ? firstBasketBoard.length : 0,
    trueTeamFirstBasketRows: trueTeamFirstBasketRowsForBoard.length,
    specialLikeFallbackActivated: useSpecialLikeFirstBasketFallback,
    specialLikeFallbackRows: specialLikeFallbackBoardRows.length,
    corePropsBoard: Array.isArray(corePropsBoard) ? corePropsBoard.length : 0,
    ladderBoard: Array.isArray(ladderBoard) ? ladderBoard.length : 0,
    specialBoard: Array.isArray(specialBoard) ? specialBoard.length : 0,
    specialBoardFirstBasketCount: (Array.isArray(specialBoard) ? specialBoard : []).filter((row) => String(row?.marketKey || "") === "player_first_basket").length,
    specialBoardFirstTeamBasketCount: (Array.isArray(specialBoard) ? specialBoard : []).filter((row) => String(row?.marketKey || "") === "player_first_team_basket").length,
    lottoBoard: Array.isArray(lottoBoard) ? lottoBoard.length : 0,
    firstBasketSample: Array.isArray(firstBasketBoard)
      ? firstBasketBoard.slice(0, 8).map((row) => ({
          player: row?.player || null,
          matchup: row?.matchup || null,
          marketKey: row?.marketKey || null,
          odds: row?.odds ?? null,
          whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
        }))
      : []
  })

  // --- Build prediction-layer selective picks ---
  const predictionSourceRows = boardSourceRowsWithGameRole

  let fbRows = predictionSourceRows.filter((row) => isFirstBasketLikeRow(row))
  const trueTeamFirstBasketRowsForPicks = predictionSourceRows.filter(isTeamFirstBasketMarketRow)
  const teamFirstBasketSupplyThinForPicks = trueTeamFirstBasketRowsForPicks.length <= 1
  let specialLikeFallbackPickRowsCount = 0
  let specialLikeFallbackActivatedForPicks = false
  if (teamFirstBasketSupplyThinForPicks) {
    const specialLikeFallbackPickRows = sortSpecialBoardSmart(
      predictionSourceRows
        .filter(isSpecialLikeFallbackCandidate)
        .sort((a, b) => specialLikeFallbackScore(b) - specialLikeFallbackScore(a))
    ).slice(0, 10)
    specialLikeFallbackPickRowsCount = specialLikeFallbackPickRows.length
    if (specialLikeFallbackPickRows.length > 0) {
      fbRows = dedupeBoardRows([...fbRows, ...specialLikeFallbackPickRows]).slice(0, 20)
      specialLikeFallbackActivatedForPicks = true
    }
  }

  fbRows = filterSpecialRowsForBoard(fbRows)
  fbRows = sortSpecialBoardSmart(fbRows)
  if (specialLikeFallbackActivatedForPicks) {
    fbRows = [...fbRows].sort((a, b) => specialLikeFallbackPromotionScore(b) - specialLikeFallbackPromotionScore(a))
  }

  // HARD CAP to top 5 only
  const firstBasketPicks = fbRows.slice(0, 5)

  console.log("[SPECIAL-BOARD-FILTER-DEBUG]", {
    originalFB: predictionSourceRows.filter(r => isFirstBasketLikeRow(r)).length,
    filteredFB: fbRows.length,
    specialLikeFallbackActivatedForPicks,
    specialLikeFallbackPickRows: specialLikeFallbackPickRowsCount,
    finalFB: firstBasketPicks.length,
    topFB: firstBasketPicks.map(r => ({
      player: r.player,
      odds: r.odds,
      confidence: r.playerConfidenceScore,
      tier: r.confidenceTier
    }))
  })

  const corePropPicks = buildSelectiveBoard(
    predictionSourceRows.filter((row) => isCorePropRow(row) && !isLadderRow(row)),
    20,
    sortByPredictionStrength
  )

  let lottoRows = predictionSourceRows.filter((row) =>
    isLottoStyleRow(row) || isFirstBasketLikeRow(row)
  )

  // allow longshots here, but still filter garbage
  lottoRows = lottoRows.filter((row) => {
    const odds = Number(row?.odds || 0)
    const confidence = Number(row?.playerConfidenceScore || 0)

    if (odds > 2000 && confidence < 0.15) return false
    return true
  })

  lottoRows = sortSpecialBoardSmart(lottoRows)

  const lottoPicks = lottoRows.slice(0, 10)

  console.log("[PREDICTION-LAYER-DEBUG]", {
    firstBasketPicks: Array.isArray(firstBasketPicks) ? firstBasketPicks.length : 0,
    corePropPicks: Array.isArray(corePropPicks) ? corePropPicks.length : 0,
    lottoPicks: Array.isArray(lottoPicks) ? lottoPicks.length : 0,
    firstBasketSample: Array.isArray(firstBasketPicks)
      ? firstBasketPicks.slice(0, 6).map((row) => ({
          player: row?.player || null,
          matchup: row?.matchup || null,
          odds: row?.odds ?? null,
          gamePriorityScore: row?.gamePriorityScore ?? null,
          playerConfidenceScore: row?.playerConfidenceScore ?? null,
          confidenceTier: row?.confidenceTier || null,
          whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
        }))
      : []
  })

  console.log("[FIRST-BASKET-CONTEXT-DEBUG]", {
    firstBasketLikeCount: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) =>
          ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
        ).length
      : 0,
    sample: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps
          .filter((row) =>
            ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
          )
          .slice(0, 8)
          .map((row) => ({
            player: row?.player || null,
            propType: row?.propType || null,
            odds: row?.odds ?? null,
            gamePriorityScore: row?.gamePriorityScore ?? null,
            playerConfidenceScore: row?.playerConfidenceScore ?? null,
            confidenceTier: row?.confidenceTier || null,
            whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : [],
            modelSummary: row?.modelSummary || null
          }))
      : []
  })

  console.log("[SPECIAL-CONTEXT-DEBUG]", {
    totalSpecialProps: Array.isArray(enrichedSpecialProps) ? enrichedSpecialProps.length : 0,
    bySubtype: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.reduce((acc, row) => {
          const key = String(row?.evidence?.subtype || "unknown")
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {})
      : {},
    sample: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.slice(0, 8).map((row) => ({
          player: row?.player || null,
          propType: row?.propType || null,
          marketKey: row?.marketKey || null,
          odds: row?.odds ?? null,
          playerConfidenceScore: row?.playerConfidenceScore ?? null,
          confidenceTier: row?.confidenceTier || null,
          whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : [],
          modelSummary: row?.modelSummary || null
        }))
      : []
  })

  console.log("[SPECIAL-MARKET-INTEL-DEBUG]", {
    count: enrichedSpecialProps.length,
    sample: enrichedSpecialProps.slice(0,5).map(r => ({
      player: r.player,
      odds: r.odds,
      confidence: r.playerConfidenceScore,
      why: r.whyItRates
    }))
  })

  console.log("[SPECIAL-ENRICHMENT-DEBUG]", {
    rawSpecialProps: Array.isArray(specialProps) ? specialProps.length : 0,
    enrichedSpecialProps: Array.isArray(enrichedSpecialProps) ? enrichedSpecialProps.length : 0,
    firstBasketLikeEnriched: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) =>
          ["player_first_basket", "player_first_team_basket"].includes(String(row?.marketKey || ""))
        ).length
      : 0,
    withEvidence: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) => row?.evidence).length
      : 0,
    withWhyItRates: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) => Array.isArray(row?.whyItRates) && row.whyItRates.length > 0).length
      : 0,
    withPredictionScores: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps.filter((row) =>
          row?.gamePriorityScore !== null &&
          row?.gamePriorityScore !== undefined &&
          row?.playerConfidenceScore !== null &&
          row?.playerConfidenceScore !== undefined
        ).length
      : 0,
    sampleFirstBasket: Array.isArray(enrichedSpecialProps)
      ? enrichedSpecialProps
          .filter((row) => String(row?.marketKey || "") === "player_first_basket")
          .slice(0, 6)
          .map((row) => ({
            player: row?.player || null,
            odds: row?.odds ?? null,
            gamePriorityScore: row?.gamePriorityScore ?? null,
            playerConfidenceScore: row?.playerConfidenceScore ?? null,
            confidenceTier: row?.confidenceTier || null,
            whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
          }))
      : []
  })

  const gameEdgeBoard = Object.values(gameEdgeMap)
    .sort((a, b) => Number(b?.gameEdgeScore || 0) - Number(a?.gameEdgeScore || 0))
    .slice(0, 8)

  const finalMustPlayRowsBeforeDedupe = sortByAdjustedConfidence(
    boardSourceRowsWithGameRole.filter((row) => String(row?.playDecision || "") === "must-play")
  )
  const normalizeMustPlayKeyPart = (value) =>
    value == null ? "" : String(value).trim().toLowerCase()

  const mustPlaySeen = new Set()
  const finalMustPlayRowsAfterDedupe = []
  for (const row of finalMustPlayRowsBeforeDedupe) {
    const normalizedLineValue = row?.line
    const normalizedLine =
      normalizedLineValue == null
        ? ""
        : normalizeMustPlayKeyPart(Number.isFinite(Number(normalizedLineValue)) ? Number(normalizedLineValue) : normalizedLineValue)
    const normalizedVariantRaw = normalizeMustPlayKeyPart(row?.propVariant)
    const normalizedVariant = normalizedVariantRaw || "base"
    const mustPlayKey = [
      normalizeMustPlayKeyPart(row?.player),
      normalizeMustPlayKeyPart(row?.matchup),
      normalizeMustPlayKeyPart(row?.marketKey),
      normalizeMustPlayKeyPart(row?.propType),
      normalizeMustPlayKeyPart(row?.side),
      normalizedLine,
      normalizedVariant,
      normalizeMustPlayKeyPart(row?.book)
    ].join("|")
    if (mustPlaySeen.has(mustPlayKey)) continue
    mustPlaySeen.add(mustPlayKey)
    finalMustPlayRowsAfterDedupe.push(row)
  }
  const mustPlayDuplicatesRemoved = finalMustPlayRowsBeforeDedupe.length - finalMustPlayRowsAfterDedupe.length
  const mustPlayBoard = finalMustPlayRowsAfterDedupe.slice(0, 15)

  const {
    featuredPlayScore,
    featuredCore,
    featuredLadders,
    featuredFirstBasket,
    featuredSpecials,
    featuredMustPlays,
    featuredPlays
  } = buildFeaturedPlays({
    corePropPicks,
    ladderBoard,
    enrichedSpecialProps,
    specialBoard,
    firstBasketBoard,
    mustPlayBoard,
    useSpecialLikeFirstBasketFallback,
    isSpecialLikeFallbackCandidate,
    isFirstBasketLikeRow,
    specialLikeFallbackPromotionScore,
    parseHitRate,
    dedupeBoardRows
  })

  const tonightsBestSingles = (() => {
    const candidates = (Array.isArray(corePropPicks) ? corePropPicks : [])
      .filter(Boolean)

    const picks = []
    const seenPropTypes = new Set()
    const propTypeCounts = new Map()
    const seenLegs = new Set()
    const seenPlayers = new Set()
    const TONIGHTS_SINGLES_MAX_PER_PROP_TYPE = 2

    for (const row of candidates) {
      const propTypeKey = String(row?.propType || "").trim().toLowerCase()
      const playerKey = String(row?.player || "").trim().toLowerCase()
      const legKey = [
        playerKey,
        propTypeKey,
        String(row?.side || ""),
        String(row?.line ?? ""),
        String(row?.marketKey || ""),
        String(row?.propVariant || "base")
      ].join("|")

      if (seenLegs.has(legKey)) continue
      if (seenPropTypes.has(propTypeKey)) continue
      if (seenPlayers.has(playerKey)) continue

      seenLegs.add(legKey)
      seenPropTypes.add(propTypeKey)
      seenPlayers.add(playerKey)
      propTypeCounts.set(propTypeKey, (propTypeCounts.get(propTypeKey) || 0) + 1)
      picks.push(row)

      if (picks.length >= 5) break
    }

    if (picks.length < 5) {
      for (const row of candidates) {
        const playerKey = String(row?.player || "").trim().toLowerCase()
        const propTypeKey = String(row?.propType || "").trim().toLowerCase()
        const legKey = [
          playerKey,
          propTypeKey,
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.marketKey || ""),
          String(row?.propVariant || "base")
        ].join("|")

        if (seenLegs.has(legKey)) continue
        if (seenPlayers.has(playerKey)) continue
        if ((propTypeCounts.get(propTypeKey) || 0) >= TONIGHTS_SINGLES_MAX_PER_PROP_TYPE) continue

        seenLegs.add(legKey)
        seenPlayers.add(playerKey)
        propTypeCounts.set(propTypeKey, (propTypeCounts.get(propTypeKey) || 0) + 1)
        picks.push(row)

        if (picks.length >= 5) break
      }
    }

    if (picks.length < 5) {
      for (const row of candidates) {
        const propTypeKey = String(row?.propType || "").trim().toLowerCase()
        const legKey = [
          String(row?.player || "").trim().toLowerCase(),
          propTypeKey,
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.marketKey || ""),
          String(row?.propVariant || "base")
        ].join("|")

        if (seenLegs.has(legKey)) continue
        if ((propTypeCounts.get(propTypeKey) || 0) >= TONIGHTS_SINGLES_MAX_PER_PROP_TYPE) continue

        seenLegs.add(legKey)
        propTypeCounts.set(propTypeKey, (propTypeCounts.get(propTypeKey) || 0) + 1)
        picks.push(row)

        if (picks.length >= 5) break
      }
    }

    if (picks.length < 5) {
      for (const row of candidates) {
        const legKey = [
          String(row?.player || "").trim().toLowerCase(),
          String(row?.propType || "").trim().toLowerCase(),
          String(row?.side || ""),
          String(row?.line ?? ""),
          String(row?.marketKey || ""),
          String(row?.propVariant || "base")
        ].join("|")

        if (seenLegs.has(legKey)) continue

        seenLegs.add(legKey)
        picks.push(row)

        if (picks.length >= 5) break
      }
    }

    return picks
  })()

  const tonightsBestLadders = buildBestLadders({
    featuredLadders,
    featuredPlayScore,
    isLaneNativeLadderCandidate,
    maxRows: 6
  })
  const liveSpecialCandidates = Array.isArray(specialBoard) ? specialBoard : []
  const tonightsBestSpecials = buildBestSpecials({
    featuredFirstBasket,
    featuredSpecials,
    liveSpecialRows: liveSpecialCandidates,
    featuredPlayScore,
    maxRows: 7
  })

  const MUST_PLAY_ELIGIBLE_TIERS = new Set(["elite", "strong"])

  const mustPlayCandidates = (() => {
    const mustPlayMarketScore = (row) => {
      const side = String(row?.side || "").toLowerCase()
      const lm = Number.isFinite(Number(row?.lineMove)) ? Number(row.lineMove) : null
      const om = Number.isFinite(Number(row?.oddsMove)) ? Number(row.oddsMove) : null
      let bonus = 0
      if (lm !== null) {
        if (side === "over" && lm < 0) bonus += 2   // line dropped — easier to hit
        if (side === "over" && lm > 0) bonus -= 2   // line rose — harder to hit
        if (side === "under" && lm > 0) bonus += 2  // line rose — easier to hit
        if (side === "under" && lm < 0) bonus -= 2  // line dropped — harder
      }
      if (om !== null) {
        if (om < -3) bonus += 1   // odds shortened — market backing it
        if (om > 10) bonus -= 1   // odds drifted — market fading it
      }
      return bonus
    }

    const laddersSet = new Set(Array.isArray(tonightsBestLadders) ? tonightsBestLadders : [])
    const specialsSet = new Set(Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials : [])
    const MUST_PLAY_SPECIAL_TIERS = new Set(["special-elite", "special-strong"])
    const MUST_PLAY_MAX_PER_MATCHUP = 2

    const eligibleSpecials = (Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials : []).filter((row) => {
      if (!row) return false
      const tier = String(row?.confidenceTier || "").toLowerCase()
      return MUST_PLAY_SPECIAL_TIERS.has(tier)
    })


    const eligible = [...tonightsBestSingles, ...tonightsBestLadders].filter((row) => {
      if (!row) return false
      const tier = String(row?.confidenceTier || "").toLowerCase()
      return MUST_PLAY_ELIGIBLE_TIERS.has(tier)
    })

    // Group by player|propType — prefer base/default variant, then better market score
    const groupMap = new Map()
    for (const row of eligible) {
      const groupKey = [
        String(row?.player || "").trim().toLowerCase(),
        String(row?.propType || "").trim().toLowerCase()
      ].join("|")
      const existing = groupMap.get(groupKey)
      if (!existing) {
        groupMap.set(groupKey, row)
        continue
      }
      const rowVariant = String(row?.propVariant || "base").toLowerCase()
      const existingVariant = String(existing?.propVariant || "base").toLowerCase()
      const rowIsBase = rowVariant === "base" || rowVariant === "default"
      const existingIsBase = existingVariant === "base" || existingVariant === "default"
      if (rowIsBase && !existingIsBase) {
        groupMap.set(groupKey, row)
      } else if (rowIsBase === existingIsBase) {
        if (mustPlayMarketScore(row) > mustPlayMarketScore(existing)) groupMap.set(groupKey, row)
      }
    }

    const mustPlayPriorityScore = (row) => {
      const conf = Number(row?.playerConfidenceScore || row?.adjustedConfidenceScore || row?.score || 0)
      const tier = String(row?.confidenceTier || "").toLowerCase()
      const tierBonus = tier === "elite" ? 8 : tier === "strong" ? 4 : 0
      const variant = String(row?.propVariant || "base").toLowerCase()
      const baseBonus = (variant === "base" || variant === "default") ? 3 : 0
      const laneBonus = laddersSet.has(row) ? 2 : 6
      return (conf * 100) + (mustPlayMarketScore(row) * 4) + tierBonus + baseBonus + laneBonus
    }

    const preferredEligible = Array.from(groupMap.values())
      .filter(Boolean)
      .sort((a, b) => mustPlayPriorityScore(b) - mustPlayPriorityScore(a))

    const out = []
    const seen = new Set()
    const seenPlayers = new Set()
    const matchupCounts = new Map()

    for (const row of preferredEligible) {
      const groupKey = [
        String(row?.player || "").trim().toLowerCase(),
        String(row?.propType || "").trim().toLowerCase()
      ].join("|")
      if (seen.has(groupKey)) continue
      if (groupMap.get(groupKey) !== row) continue
      const playerKey = String(row?.player || "").trim().toLowerCase()
      const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
      if (playerKey && seenPlayers.has(playerKey)) continue
      if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= MUST_PLAY_MAX_PER_MATCHUP) continue
      seen.add(groupKey)
      if (playerKey) seenPlayers.add(playerKey)
      if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
      out.push(row)
      if (out.length >= 6) break
    }

    if (out.length < 6) {
      for (const row of preferredEligible) {
        const groupKey = [
          String(row?.player || "").trim().toLowerCase(),
          String(row?.propType || "").trim().toLowerCase()
        ].join("|")
        if (seen.has(groupKey)) continue
        const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
        if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= MUST_PLAY_MAX_PER_MATCHUP) continue
        seen.add(groupKey)
        if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
        out.push(row)
        if (out.length >= 6) break
      }
    }

    // Append qualifying specials into remaining slots (up to 6 total)
    const seenSpecialKeys = new Set(out.map((r) => [String(r?.player || "").trim().toLowerCase(), String(r?.propType || "").trim().toLowerCase()].join("|")))
    for (const row of eligibleSpecials) {
      if (out.length >= 6) break
      const groupKey = [String(row?.player || "").trim().toLowerCase(), String(row?.propType || "").trim().toLowerCase()].join("|")
      if (seenSpecialKeys.has(groupKey)) continue
      const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
      if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= MUST_PLAY_MAX_PER_MATCHUP) continue
      seenSpecialKeys.add(groupKey)
      if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
      out.push(row)
    }

    // Secondary sort: strongest confidence first, market signal as tiebreaker
    out.sort((a, b) => {
      const confDiff = Number(b?.playerConfidenceScore || 0) - Number(a?.playerConfidenceScore || 0)
      if (confDiff !== 0) return confDiff
      return mustPlayMarketScore(b) - mustPlayMarketScore(a)
    })

    return out.map((row, index) => {
      const sourceLane = specialsSet.has(row) ? "bestSpecials" : laddersSet.has(row) ? "bestLadders" : "bestSingles"
      const betType = sourceLane === "bestSpecials" ? "special" : sourceLane === "bestLadders" ? "ladder" : "single"
      const tier = String(row?.confidenceTier || "").toLowerCase()
      const propVariant = String(row?.propVariant || "base").toLowerCase()
      const isAlt = propVariant !== "base" && propVariant !== "default"
      const side = String(row?.side || "")
      const line = row?.line ?? null
      const mks = mustPlayMarketScore(row)
      const gameEdgeScore = Number(row?.gameEdgeScore || 0)
      const roleSignalScore = Number(row?.roleSignalScore || 0)
      const matchupEdgeScore = Number(row?.matchupEdgeScore || 0)
      const mustPlayContextScore = Number(Math.min(1, Math.max(0,
        (gameEdgeScore * 0.45) +
        (roleSignalScore * 0.35) +
        (matchupEdgeScore * 0.20)
      )).toFixed(3))

      let mustPlayContextTag = "context-thin"
      if (mustPlayContextScore >= 0.60) mustPlayContextTag = "context-strong"
      else if (mustPlayContextScore >= 0.45) mustPlayContextTag = "context-viable"

      const reasonParts = []
      if (tier === "elite" || tier === "special-elite") reasonParts.push("elite-confidence")
      else if (tier === "strong" || tier === "special-strong") reasonParts.push("strong-confidence")
      reasonParts.push(betType)
      reasonParts.push(isAlt ? "alt" : "base")
      if (mks > 0) reasonParts.push("market-confirmed")
      else if (mks < 0) reasonParts.push("market-drifting")
      else reasonParts.push("stable-market")
      reasonParts.push(mustPlayContextTag)

      const displayLineParts = [side]
      if (line != null) displayLineParts.push(String(line))
      if (isAlt) displayLineParts.push(`(${propVariant})`)

      return {
        ...row,
        mustPlayRank: index + 1,
        mustPlayBetType: betType,
        mustPlaySourceLane: sourceLane,
        mustPlayReasonTag: reasonParts.join("+") || "qualified",
        mustPlayDisplayLine: displayLineParts.join(" ") || null,
        mustPlayContextScore,
        mustPlayContextTag
      }
    })
  })()

  const buildCuratedLayer2Buckets = () => buildCuratedLayer2BucketsHelper({
    corePropsBoard,
    ladderBoard,
    ladderProps,
    lottoBoard,
    parseHitRate,
    dedupeBoardRows,
    shouldRemoveLegForPlayerStatus,
    highestHitRateSortValue,
    bestValueSortValue,
    logger: console.log
  })

  const layer2CuratedBuckets = buildCuratedLayer2Buckets()

  console.log("[FEATURED-PLAYS-DEBUG]", {
    total: featuredPlays.length,
    sourceCounts: {
      core: featuredCore.length,
      ladders: featuredLadders.length,
      firstBasket: featuredFirstBasket.length,
      specials: featuredSpecials.length,
      mustPlays: featuredMustPlays.length
    },
    byPropType: featuredPlays.reduce((acc, row) => {
      const key = String(row?.propType || "Unknown")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    byPropVariant: featuredPlays.reduce((acc, row) => {
      const key = String(row?.propVariant || "base")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    byMarketFamily: featuredPlays.reduce((acc, row) => {
      const key = String(row?.marketFamily || "standard")
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    sample: featuredPlays.slice(0, 12).map((row) => ({
      player: row?.player || null,
      propType: row?.propType || null,
      side: row?.side || null,
      line: row?.line ?? null,
      marketKey: row?.marketKey || null,
      propVariant: row?.propVariant || "base",
      marketFamily: row?.marketFamily || null
    }))
  })

  console.log("[GAME-ROLE-EDGE-DEBUG]", {
    gameEdgeBoard: Array.isArray(gameEdgeBoard) ? gameEdgeBoard.length : 0,
    mustPlayBoard: Array.isArray(mustPlayBoard) ? mustPlayBoard.length : 0,
    mustPlayDuplicatesRemoved,
    gameEdgeTop: Array.isArray(gameEdgeBoard)
      ? gameEdgeBoard.slice(0, 5).map((row) => ({
          matchup: row?.matchup || null,
          gameEdgeScore: row?.gameEdgeScore ?? null,
          avgConfidence: row?.avgConfidence ?? null
        }))
      : [],
    mustPlayTop: Array.isArray(mustPlayBoard)
      ? mustPlayBoard.slice(0, 8).map((row) => ({
          player: row?.player || null,
          matchup: row?.matchup || null,
          propType: row?.propType || null,
          marketKey: row?.marketKey || null,
          adjustedConfidenceScore: row?.adjustedConfidenceScore ?? null,
          playDecision: row?.playDecision || null,
          decisionSummary: row?.decisionSummary || null
        }))
      : []
  })

  const buildTonightsLaneAuditRows = (lane, rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    return safeRows.map((row, index) => ({
      lane,
      rankWithinLane: index + 1,
      player: row?.player || null,
      propType: row?.propType || null,
      marketKey: row?.marketKey || null,
      propVariant: row?.propVariant || "base",
      odds: Number(row?.odds ?? 0) || null,
      confidenceTier: row?.confidenceTier || null,
      score: Number(row?.score ?? 0) || null,
      adjustedConfidenceScore: Number(row?.adjustedConfidenceScore ?? 0) || null,
      playerConfidenceScore: Number(row?.playerConfidenceScore ?? 0) || null
    }))
  }

  const boardProgress = {
    snapshotSlateDateKey: currentSnapshot?.snapshotSlateDateKey || null,
    snapshotSlateGameCount: Number(currentSnapshot?.snapshotSlateGameCount || 0),
    laneCounts: {
      bestSingles: tonightsBestSingles.length,
      bestLadders: tonightsBestLadders.length,
      bestSpecials: tonightsBestSpecials.length,
      mustPlayCandidates: mustPlayCandidates.length
    },
    curatedCounts: {
      mostLikelyToHit: Array.isArray(layer2CuratedBuckets?.mostLikelyToHit) ? layer2CuratedBuckets.mostLikelyToHit.length : 0,
      bestValue: Array.isArray(layer2CuratedBuckets?.bestValue) ? layer2CuratedBuckets.bestValue.length : 0,
      bestUpside: Array.isArray(layer2CuratedBuckets?.bestUpside) ? layer2CuratedBuckets.bestUpside.length : 0
    },
    mustPlayIncludesSpecials: mustPlayCandidates.some((row) => String(row?.mustPlayBetType || "") === "special" || String(row?.mustPlaySourceLane || "") === "bestSpecials"),
    lineHistoryPresent: Boolean(Number(currentSnapshot?.lineHistorySummary?.trackedLegs || 0) > 0)
  }

  const tonightsPlaysEvaluation = {
    bestSingles: buildTonightsLaneAuditRows("bestSingles", tonightsBestSingles),
    bestLadders: buildTonightsLaneAuditRows("bestLadders", tonightsBestLadders),
    bestSpecials: buildTonightsLaneAuditRows("bestSpecials", tonightsBestSpecials),
    mustPlayCandidates: buildTonightsLaneAuditRows("mustPlayCandidates", mustPlayCandidates)
  }

  const boards = {
    mustPlayCandidates,
    bestSingles: tonightsBestSingles,
    bestSpecials: tonightsBestSpecials,
    bestLadders: tonightsBestLadders,
    bestLongshots: Array.isArray(lottoPicks) ? lottoPicks : [],
    comboCandidates: Array.isArray(featuredPlays) ? featuredPlays : []
  }

  const {
    safe,
    balanced,
    aggressive,
    lotto,
    highestHitRate2,
    highestHitRate3,
    highestHitRate4,
    highestHitRate5,
    highestHitRate6,
    highestHitRate7,
    highestHitRate8,
    highestHitRate9,
    highestHitRate10,
    payoutFitPortfolio,
    moneyMakerPortfolio,
    ...bestAvailablePayloadBoardFirst
  } = bestAvailablePayload || {}

  const normalizeRuntimeAvailabilityStatus = (row) => {
    const rawStatus = row?.availabilityStatus || row?.playerStatus || row?.status || row?.injuryStatus || ""
    const normalized = normalizePlayerStatusValue(rawStatus)

    if (!normalized) return null
    if (normalized.includes("out") || normalized.includes("inactive") || normalized.includes("suspended") || normalized.includes("not with team") || normalized.includes("dnp")) return "out"
    if (normalized.includes("questionable") || normalized.includes("game time") || normalized.includes("gtd")) return "questionable"
    if (normalized.includes("doubtful")) return "doubtful"
    if (normalized.includes("probable") || normalized.includes("returning") || normalized.includes("minutes") || normalized.includes("limited")) return "probable"
    if (normalized.includes("available") || normalized.includes("active") || normalized.includes("cleared") || normalized.includes("healthy")) return "active"
    return null
  }

  const normalizeRuntimeStarterStatus = (row) => {
    const rawStarter = row?.starterStatus || row?.lineupStatus || row?.startingStatus || row?.startingRole || row?.roleTag || ""
    const normalizedStarter = normalizePlayerStatusValue(rawStarter)
    const normalizedContext = normalizePlayerStatusValue(row?.contextTag || row?.mustPlayContextTag || "")

    if (!normalizedStarter && !normalizedContext) return null
    if (normalizedStarter.includes("starter") || normalizedStarter.includes("starting") || normalizedStarter.includes("first unit")) return "starter"
    if (normalizedStarter.includes("bench") || normalizedStarter.includes("reserve") || normalizedStarter.includes("non starter") || normalizedStarter.includes("second unit")) return "bench"
    if (normalizedContext.includes("starter") || normalizedContext.includes("starting")) return "starter"
    return null
  }

  const buildRuntimeExternalContextTag = (row, availabilityStatus, starterStatus, marketValidity) => {
    const rawContext = normalizePlayerStatusValue(row?.contextTag || row?.mustPlayContextTag || row?.statusTag || "")

    if (availabilityStatus === "out") return "player out"
    if (availabilityStatus === "questionable" || availabilityStatus === "doubtful") return "questionable status"
    if (starterStatus === "starter") return "starter confirmed"
    if (starterStatus === "bench") return "bench role"
    if (rawContext.includes("context strong")) return "positive role context"
    if (rawContext.includes("context viable")) return "role holding"
    if (rawContext.includes("context thin")) return "thin support"
    if (marketValidity === "valid") return "market live"
    return null
  }

  const buildRuntimeExternalSignalInput = (row, extra = {}) => {
    const sourceLane = extra?.sourceLane || extra?.defaultLane || row?.sourceLane || row?.mustPlaySourceLane || null
    const book = String(row?.book || "")
    const isCurrentSurfacedMarket = Boolean(
      row &&
      (sourceLane || row?.marketKey || row?.propType) &&
      row?.odds != null &&
      row?.line != null
    )
    const availabilityStatus = normalizeRuntimeAvailabilityStatus(row)
    const starterStatus = normalizeRuntimeStarterStatus(row)
    const marketValidity = isCurrentSurfacedMarket ? "valid" : null
    const contextTag = buildRuntimeExternalContextTag(row, availabilityStatus, starterStatus, marketValidity)
    const hasRuntimeStatusEvidence = Boolean(availabilityStatus || starterStatus)
    const sourceName = book === "DraftKings" ? "draftkings_live_board" : null

    return {
      sourceName,
      availabilityStatus,
      starterStatus,
      marketValidity,
      contextTag,
      __runtimeLocalSourceName: hasRuntimeStatusEvidence ? "runtime_row_signal" : sourceName,
      __hasAvailabilityEvidence: Boolean(availabilityStatus),
      __hasStarterEvidence: Boolean(starterStatus)
    }
  }

  const buildSourceLevelAvailabilitySignalMap = () => {
    const sourceRows = [
      ...(Array.isArray(currentSnapshot?.rawProps) ? currentSnapshot.rawProps : []),
      ...(Array.isArray(baseRows) ? baseRows : [])
    ]

    const signalMap = new Map()
    const nbaOfficialRuntimeInputCandidates = [
      currentSnapshot?.nbaOfficialInjuryReport,
      currentSnapshot?.nbaOfficialInjuries,
      currentSnapshot?.injuryReports?.nbaOfficial,
      currentSnapshot?.externalInjuries?.nbaOfficial,
      currentSnapshot?.externalSignals?.nbaOfficialInjuryReport,
      currentSnapshot?.sourceFeeds?.nbaOfficialInjuryReport
    ]
    const nbaOfficialRuntimeInput = nbaOfficialRuntimeInputCandidates.find((value) => {
      if (Array.isArray(value)) return value.length > 0
      return Boolean(value && typeof value === "object")
    }) || null

    const countRuntimeInputRows = (value) => {
      if (!value) return 0
      if (Array.isArray(value)) return value.length
      if (typeof value !== "object") return 0
      const listKeys = ["reports", "injuries", "players", "rows", "data", "items", "entries"]
      for (const key of listKeys) {
        if (Array.isArray(value?.[key])) return value[key].length
      }
      return 1
    }

    const nbaOfficialRuntimeInputRows = countRuntimeInputRows(nbaOfficialRuntimeInput)
    const ingestedNbaOfficialRows = nbaOfficialRuntimeInput
      ? ingestNbaOfficialInjuryReport(nbaOfficialRuntimeInput)
      : []
    const rotoWireRuntimeInputCandidates = [
      currentSnapshot?.rotoWireSignals,
      currentSnapshot?.rotoWireStatus,
      currentSnapshot?.rotoWireLineups,
      currentSnapshot?.injuryReports?.rotoWire,
      currentSnapshot?.externalSignals?.rotoWire,
      currentSnapshot?.sourceFeeds?.rotoWire
    ]
    const dailyOverlayRuntimeFilePath = path.join(__dirname, "runtime_inputs", "daily_overlay.json")
    const legacyRotoWireRuntimeFilePath = path.join(__dirname, "runtime_inputs", "rotowire_signals.json")
    let rotoWireRuntimeFileChecked = true
    let rotoWireRuntimeFileExists = false
    let rotoWireRuntimeFileRows = 0
    let rotoWireRuntimeFileInput = null
    let manualOverlaySource = "manual-overlay-unavailable"
    let manualOverlayPath = "backend/runtime_inputs/daily_overlay.json"

    try {
      const parseRuntimeOverlayFile = (filePath) => {
        if (!fs.existsSync(filePath)) return null
        const rawFile = fs.readFileSync(filePath, "utf-8")
        const parsedFile = JSON.parse(rawFile)
        const hasData = Array.isArray(parsedFile)
          ? parsedFile.length > 0
          : Boolean(parsedFile && typeof parsedFile === "object")
        return hasData ? parsedFile : null
      }

      const preferredOverlayInput = parseRuntimeOverlayFile(dailyOverlayRuntimeFilePath)
      if (preferredOverlayInput) {
        rotoWireRuntimeFileInput = preferredOverlayInput
        rotoWireRuntimeFileExists = true
        manualOverlaySource = "manual-overlay-daily"
        manualOverlayPath = "backend/runtime_inputs/daily_overlay.json"
      } else {
        const legacyOverlayInput = parseRuntimeOverlayFile(legacyRotoWireRuntimeFilePath)
        if (legacyOverlayInput) {
          rotoWireRuntimeFileInput = legacyOverlayInput
          rotoWireRuntimeFileExists = true
          manualOverlaySource = "manual-overlay-legacy-rotowire"
          manualOverlayPath = "backend/runtime_inputs/rotowire_signals.json"
        } else {
          rotoWireRuntimeFileExists = fs.existsSync(dailyOverlayRuntimeFilePath) || fs.existsSync(legacyRotoWireRuntimeFilePath)
        }
      }
    } catch (_) {
      rotoWireRuntimeFileInput = null
      manualOverlaySource = "manual-overlay-unavailable"
      manualOverlayPath = "backend/runtime_inputs/daily_overlay.json"
    }

    const rotoWireRuntimeInput = rotoWireRuntimeInputCandidates.find((value) => {
      if (Array.isArray(value)) return value.length > 0
      return Boolean(value && typeof value === "object")
    }) || rotoWireRuntimeFileInput || null
    const rotoWireRuntimeInputRows = countRuntimeInputRows(rotoWireRuntimeInput)
    rotoWireRuntimeFileRows = countRuntimeInputRows(rotoWireRuntimeFileInput)
    const ingestedRotoWireRows = rotoWireRuntimeInput
      ? ingestRotoWireSignals(rotoWireRuntimeInput)
      : []

    let rowsWithStatusEvidence = 0
    let adaptedSignalsCreated = 0
    let adaptedSignalsWithAvailability = 0
    let adaptedSignalsWithStarter = 0
    let nbaOfficialSignalsWithAvailability = 0
    let nbaOfficialSignalsMerged = 0
    let rotoWireSignalsWithAvailability = 0
    let rotoWireSignalsWithStarter = 0
    let rotoWireSignalsMerged = 0
    let rotoWireRuntimeFileSignalsMerged = 0

    for (const ingested of ingestedNbaOfficialRows) {
      if (!ingested?.playerKey) continue

      const hasAvailabilityEvidence = ingested.availabilityStatus && ingested.availabilityStatus !== "unknown"
      if (hasAvailabilityEvidence) nbaOfficialSignalsWithAvailability += 1

      const candidateSignal = {
        sourceName: ingested.sourceName || "nba_official_injury_report",
        availabilityStatus: hasAvailabilityEvidence ? ingested.availabilityStatus : null,
        starterStatus: null,
        contextTag: ingested.contextTag || null,
        __runtimeLocalSourceName: ingested.sourceName || "nba_official_injury_report",
        __hasAvailabilityEvidence: Boolean(hasAvailabilityEvidence),
        __hasStarterEvidence: false,
        __adapterFed: true,
        __evidenceScore: hasAvailabilityEvidence ? 3 : 0
      }

      const existing = signalMap.get(ingested.playerKey)
      if (!existing || Number(candidateSignal.__evidenceScore) > Number(existing.__evidenceScore || 0)) {
        signalMap.set(ingested.playerKey, candidateSignal)
        nbaOfficialSignalsMerged += 1
      }
    }

    for (const ingested of ingestedRotoWireRows) {
      if (!ingested?.playerKey) continue

      const hasAvailabilityEvidence = ingested.availabilityStatus && ingested.availabilityStatus !== "unknown"
      const hasStarterEvidence = ingested.starterStatus && ingested.starterStatus !== "unknown"
      if (hasAvailabilityEvidence) rotoWireSignalsWithAvailability += 1
      if (hasStarterEvidence) rotoWireSignalsWithStarter += 1

      const candidateSignal = {
        sourceName: ingested.sourceName || "rotowire",
        availabilityStatus: hasAvailabilityEvidence ? ingested.availabilityStatus : null,
        starterStatus: hasStarterEvidence ? ingested.starterStatus : null,
        contextTag: ingested.contextTag || null,
        __runtimeLocalSourceName: ingested.sourceName || "rotowire",
        __hasAvailabilityEvidence: Boolean(hasAvailabilityEvidence),
        __hasStarterEvidence: Boolean(hasStarterEvidence),
        __adapterFed: true,
        __evidenceScore: (hasAvailabilityEvidence ? 2 : 0) + (hasStarterEvidence ? 2 : 0)
      }

      const existing = signalMap.get(ingested.playerKey)
      if (!existing || Number(candidateSignal.__evidenceScore) > Number(existing.__evidenceScore || 0)) {
        signalMap.set(ingested.playerKey, candidateSignal)
        rotoWireSignalsMerged += 1
        if (rotoWireRuntimeFileInput && !rotoWireRuntimeInputCandidates.some((value) => value === rotoWireRuntimeInput)) {
          rotoWireRuntimeFileSignalsMerged += 1
        }
      }
    }

    for (const row of sourceRows) {
      if (!row?.player) continue

      const rawAvailability = row?.availabilityStatus || row?.playerStatus || row?.status || row?.injuryStatus || null
      const rawStarter = row?.starterStatus || row?.lineupStatus || row?.startingStatus || row?.startingRole || row?.roleTag || null
      const rawContext = row?.contextTag || row?.mustPlayContextTag || row?.statusTag || null

      if (!rawAvailability && !rawStarter) continue
      rowsWithStatusEvidence += 1

      const sourceHint =
        row?.statusSource ||
        row?.availabilitySource ||
        row?.lineupSource ||
        row?.newsSource ||
        row?.sourceName ||
        row?.source ||
        row?.provider ||
        "nba_official_injury_report"

      const adaptedSignal = adaptAvailabilitySignal({
        sourceName: sourceHint,
        playerName: row.player,
        status: rawAvailability,
        starterStatus: rawStarter,
        contextTag: rawContext
      })

      if (!adaptedSignal?.playerKey) continue
      adaptedSignalsCreated += 1

      const hasAvailabilityEvidence = adaptedSignal.availabilityStatus && adaptedSignal.availabilityStatus !== "unknown"
      const hasStarterEvidence = adaptedSignal.starterStatus && adaptedSignal.starterStatus !== "unknown"
      if (hasAvailabilityEvidence) adaptedSignalsWithAvailability += 1
      if (hasStarterEvidence) adaptedSignalsWithStarter += 1

      const candidateSignal = {
        sourceName: adaptedSignal.sourceName,
        availabilityStatus: hasAvailabilityEvidence ? adaptedSignal.availabilityStatus : null,
        starterStatus: hasStarterEvidence ? adaptedSignal.starterStatus : null,
        contextTag: adaptedSignal.contextTag || null,
        __runtimeLocalSourceName: adaptedSignal.sourceName,
        __hasAvailabilityEvidence: Boolean(hasAvailabilityEvidence),
        __hasStarterEvidence: Boolean(hasStarterEvidence),
        __adapterFed: true,
        __evidenceScore: (hasAvailabilityEvidence ? 2 : 0) + (hasStarterEvidence ? 1 : 0)
      }

      const existing = signalMap.get(adaptedSignal.playerKey)
      if (!existing || Number(candidateSignal.__evidenceScore) > Number(existing.__evidenceScore || 0)) {
        signalMap.set(adaptedSignal.playerKey, candidateSignal)
      }
    }

    return {
      signalMap,
      diagnostics: {
        phase2bNbaOfficialRuntimeInputAvailable: Boolean(nbaOfficialRuntimeInput),
        phase2bNbaOfficialRuntimeInputRows: nbaOfficialRuntimeInputRows,
        phase2bNbaOfficialIngestedRows: ingestedNbaOfficialRows.length,
        phase2bNbaOfficialSignalsWithAvailability: nbaOfficialSignalsWithAvailability,
        phase2bNbaOfficialSignalsMerged: nbaOfficialSignalsMerged,
        phase2bNbaOfficialRuntimeInputMissing: !nbaOfficialRuntimeInput,
        phase2bRotoWireRuntimeInputAvailable: Boolean(rotoWireRuntimeInput),
        phase2bRotoWireRuntimeInputRows: rotoWireRuntimeInputRows,
        phase2bRotoWireIngestedRows: ingestedRotoWireRows.length,
        phase2bRotoWireSignalsWithAvailability: rotoWireSignalsWithAvailability,
        phase2bRotoWireSignalsWithStarter: rotoWireSignalsWithStarter,
        phase2bRotoWireSignalsMerged: rotoWireSignalsMerged,
        phase2bRotoWireRuntimeInputMissing: !rotoWireRuntimeInput,
        phase2bManualOverlayAvailable: Boolean(rotoWireRuntimeFileInput),
        phase2bManualOverlaySource: manualOverlaySource,
        phase2bManualOverlayRows: rotoWireRuntimeFileRows,
        phase2bManualOverlayPath: manualOverlayPath,
        phase2bRotoWireRuntimeFileChecked: rotoWireRuntimeFileChecked,
        phase2bRotoWireRuntimeFileExists: rotoWireRuntimeFileExists,
        phase2bRotoWireRuntimeFileRows: rotoWireRuntimeFileRows,
        phase2bRotoWireRuntimeFileSignalsMerged: rotoWireRuntimeFileSignalsMerged,
        phase2bExternalIngestionRowsScanned: sourceRows.length,
        phase2bExternalIngestionRowsWithStatusEvidence: rowsWithStatusEvidence,
        phase2bExternalIngestionSignalsAdapted: adaptedSignalsCreated,
        phase2bExternalIngestionSignalsWithAvailability: adaptedSignalsWithAvailability,
        phase2bExternalIngestionSignalsWithStarter: adaptedSignalsWithStarter,
        phase2bExternalIngestionUniquePlayerKeys: signalMap.size,
        phase2bExternalIngestionNoSourceStatusInputs: rowsWithStatusEvidence === 0
      }
    }
  }

  const externalAvailabilityIngestion = buildSourceLevelAvailabilitySignalMap()
  const externalAvailabilitySignalMap = externalAvailabilityIngestion.signalMap

  const buildAdapterAvailabilitySignalForRow = (row) => {
    const playerKey = toPlayerKey(row?.player)
    if (!playerKey) return null
    return externalAvailabilitySignalMap.get(playerKey) || null
  }

  const buildOverlayExternalSignalInput = (row, extra = {}) => {
    const existingSignals = row?.externalSignals || row?.externalSignal || row?.externalSources || null
    const adapterSignal = buildAdapterAvailabilitySignalForRow(row)
    const runtimeSignal = buildRuntimeExternalSignalInput(row, extra)
    const combinedSignals = []

    if (adapterSignal) combinedSignals.push(adapterSignal)
    if (Array.isArray(existingSignals)) combinedSignals.push(...existingSignals)
    else if (existingSignals && typeof existingSignals === "object") combinedSignals.push(existingSignals)
    if (runtimeSignal) combinedSignals.push(runtimeSignal)

    if (combinedSignals.length === 0) return null
    if (combinedSignals.length === 1) return combinedSignals[0]
    return combinedSignals
  }

  const resolveSurfaceTeam = (row) => {
    const canonicalTeam = resolveCanonicalPlayerTeamForRow(row)
    if (canonicalTeam && rowTeamMatchesMatchup({ ...row, team: canonicalTeam })) return canonicalTeam

    const playerTeam = String(row?.playerTeam || "").trim()
    if (playerTeam && rowTeamMatchesMatchup({ ...row, team: playerTeam })) return playerTeam

    const rawTeam = String(row?.team || "").trim()
    if (rawTeam && rowTeamMatchesMatchup(row)) return rawTeam

    return playerTeam || rawTeam || null
  }

  const buildReadableSurfaceRow = createSurfaceRowBuilder({ buildOverlayExternalSignalInput, resolveSurfaceTeam })

  const buildCompactPreviewRows = (rows, limit = 4) => {
    const safeRows = Array.isArray(rows) ? rows : []
    return safeRows.slice(0, limit).map((row) => {
      const isTrueFirstBasket = isFirstBasketLikeRow(row)
      const isFallbackSpecialLike = !isTrueFirstBasket && isSpecialLikeFallbackCandidate(row)
      return {
        player: row?.player || null,
        team: row?.team || null,
        marketKey: row?.marketKey || null,
        propType: row?.propType || null,
        line: row?.line ?? null,
        odds: Number(row?.odds ?? 0) || null,
        propVariant: row?.propVariant || "base",
        confidenceTier: row?.confidenceTier || null,
        adjustedConfidenceScore: Number(row?.adjustedConfidenceScore ?? 0) || null,
        playerConfidenceScore: Number(row?.playerConfidenceScore ?? 0) || null,
        rowKind: isTrueFirstBasket ? "true-first-basket" : isFallbackSpecialLike ? "fallback-special-like" : "other"
      }
    })
  }

  const surfacedRowsPreviewDiagnostics = {
    firstBasketBoardPreview: buildCompactPreviewRows(firstBasketBoard, 5),
    firstBasketPicksPreview: buildCompactPreviewRows(firstBasketPicks, 5),
    featuredPlaysPreview: buildCompactPreviewRows(featuredPlays, 5),
    tonightsPlaysPreview: {
      bestSingles: buildCompactPreviewRows(tonightsBestSingles, 4),
      bestLadders: buildCompactPreviewRows(tonightsBestLadders, 4),
      bestSpecials: buildCompactPreviewRows(tonightsBestSpecials, 4),
      mustPlayCandidates: buildCompactPreviewRows(mustPlayCandidates, 4)
    }
  }

  const firstBasketFallbackDiagnostics = {
    trueTeamFirstBasketRows: trueTeamFirstBasketRowsForBoard.length,
    specialLikeFallbackActivated: useSpecialLikeFirstBasketFallback,
    specialLikeFallbackRows: specialLikeFallbackBoardRows.length
  }

  const countByMarketKey = (rows, marketKey) =>
    (Array.isArray(rows) ? rows : []).filter((row) => String(row?.marketKey || "") === marketKey).length

  const rawFirstBasketSourceRows = Array.isArray(currentSnapshot?.rawProps) && currentSnapshot.rawProps.length > 0
    ? currentSnapshot.rawProps
    : (Array.isArray(baseRows) ? baseRows : [])

  const firstBasketPipelineDiagnostics = {
    rawFirstBasketRowsSeen: countByMarketKey(rawFirstBasketSourceRows, "player_first_basket"),
    rawFirstTeamBasketRowsSeen: countByMarketKey(rawFirstBasketSourceRows, "player_first_team_basket"),
    visibleFirstBasketRowsForBoards: countByMarketKey(allVisibleRowsForBoards, "player_first_basket"),
    visibleFirstTeamBasketRowsForBoards: countByMarketKey(allVisibleRowsForBoards, "player_first_team_basket"),
    specialBoardFirstBasketCount: countByMarketKey(specialBoard, "player_first_basket"),
    specialBoardFirstTeamBasketCount: countByMarketKey(specialBoard, "player_first_team_basket"),
    liveSpecialCandidatesFirstBasketCount: countByMarketKey(liveSpecialCandidates, "player_first_basket"),
    liveSpecialCandidatesFirstTeamBasketCount: countByMarketKey(liveSpecialCandidates, "player_first_team_basket"),
    firstBasketBoardFirstBasketCount: countByMarketKey(firstBasketBoard, "player_first_basket"),
    firstBasketBoardFirstTeamBasketCount: countByMarketKey(firstBasketBoard, "player_first_team_basket")
  }

  const externalAvailabilityIngestionDiagnostics = {
    ...(externalAvailabilityIngestion?.diagnostics && typeof externalAvailabilityIngestion.diagnostics === "object"
      ? externalAvailabilityIngestion.diagnostics
      : {})
  }

  const mergedBestAvailableDiagnostics = {
    ...(bestAvailablePayloadBoardFirst?.diagnostics && typeof bestAvailablePayloadBoardFirst.diagnostics === "object"
      ? bestAvailablePayloadBoardFirst.diagnostics
      : {}),
    ...firstBasketFallbackDiagnostics,
    ...firstBasketPipelineDiagnostics,
    ...externalAvailabilityIngestionDiagnostics,
    ...surfacedRowsPreviewDiagnostics
  }

  const mergedBestAvailablePoolDiagnostics = {
    ...(bestAvailablePayloadBoardFirst?.poolDiagnostics && typeof bestAvailablePayloadBoardFirst.poolDiagnostics === "object"
      ? bestAvailablePayloadBoardFirst.poolDiagnostics
      : {}),
    ...firstBasketFallbackDiagnostics,
    ...firstBasketPipelineDiagnostics,
    ...externalAvailabilityIngestionDiagnostics,
    ...surfacedRowsPreviewDiagnostics
  }

  let finalBettingNowNullDecisionSpecialsFiltered = 0
  let finalDecisionCalibratorPromotedStrong = 0
  let finalDecisionCalibratorPromotedMust = 0

  const buildBettingNowView = () => {
    finalBettingNowNullDecisionSpecialsFiltered = 0
    finalDecisionCalibratorPromotedStrong = 0
    finalDecisionCalibratorPromotedMust = 0
    const candidatePools = [
      { rows: mustPlayCandidates, getLane: (r) => r?.mustPlaySourceLane || "unknown", limit: 6 },
      { rows: tonightsBestSingles, getLane: () => "bestSingles", limit: 4 },
      { rows: tonightsBestLadders, getLane: () => "bestLadders", limit: 3 },
      { rows: tonightsBestSpecials, getLane: () => "bestSpecials", limit: 4 }
    ]

    // First pass: strict diversity (no duplicate players, max 1 per matchup)
    const strictPass = () => {
      const tempOut = []
      const seenPlayers = new Set()
      const seenMatchups = new Set()
      
      for (const pool of candidatePools) {
        const safeRows = Array.isArray(pool.rows) ? pool.rows : []
        for (let i = 0; i < Math.min(pool.limit, safeRows.length) && tempOut.length < 10; i++) {
          const row = safeRows[i]
          if (!row) continue
          
          const sourceLane = pool.getLane(row)
          const playerKey = String(row?.player || "").trim().toLowerCase()
          const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
          
          // Skip if player already in output
          if (playerKey && seenPlayers.has(playerKey)) continue
          
          // Skip if matchup already has a row
          if (matchupKey && seenMatchups.has(matchupKey)) continue
          
          seenPlayers.add(playerKey)
          seenMatchups.add(matchupKey)
          
          tempOut.push(buildReadableSurfaceRow(row, {
            rank: tempOut.length + 1,
            sourceLane,
            sourceRank: i + 1,
            _matchupKey: matchupKey
          }))
        }
      }
      return tempOut
    }

    // Fallback pass: lenient fill if strict pass didn't reach target
    const fallbackFill = (baseOut, baseTarget = 10) => {
      if (baseOut.length >= baseTarget) return baseOut
      
      const result = [...baseOut]
      const matchupCounts = new Map()
      
      for (const r of baseOut) {
        if (r._matchupKey) {
          matchupCounts.set(r._matchupKey, (matchupCounts.get(r._matchupKey) || 0) + 1)
        }
      }
      
      // Try to add remaining rows with max 2 per matchup, but allow duplicate players from different lanes
      for (const pool of candidatePools) {
        const safeRows = Array.isArray(pool.rows) ? pool.rows : []
        for (let i = 0; i < safeRows.length && result.length < baseTarget; i++) {
          const row = safeRows[i]
          if (!row) continue
          
          const sourceLane = pool.getLane(row)
          const matchupKey = String(row?.matchup || row?.eventId || "").trim().toLowerCase()
          
          // Check if this exact row is already in result (by checking all fields)
          const isDuplicate = result.some((r) => 
            r.player === row?.player && 
            r.propType === (row?.propType || null) && 
            r.marketKey === (row?.marketKey || null) &&
            r.side === (row?.side || null)
          )
          if (isDuplicate) continue
          
          // Allow max 2 per matchup in fallback
          if (matchupKey && (matchupCounts.get(matchupKey) || 0) >= 2) continue
          
          const newRow = buildReadableSurfaceRow(row, {
            rank: result.length + 1,
            sourceLane,
            sourceRank: i + 1
          })
          
          result.push(newRow)
          if (matchupKey) matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) || 0) + 1)
        }
      }
      
      return result
    }

    const strictPhaseOut = strictPass()
    const filled = fallbackFill(strictPhaseOut)
    const nonAvoidOrFade = filled.filter((row) => {
      const playDecision = String(row?.playDecision || "").toLowerCase()
      return !playDecision.includes("avoid") && !playDecision.includes("fade")
    })

    // Final gate: same definition as the smoke test so the check here = what the test sees
    const isSurfacedSpecialRow = (row) => {
      const text = [
        row?.marketKey,
        row?.propType,
        row?.sourceLane,
        row?.mustPlayBetType,
        row?.mustPlaySourceLane,
      ].filter(Boolean).join(" ").toLowerCase()
      return [
        "first_basket",
        "first basket",
        "first_team_basket",
        "first team basket",
        "double_double",
        "double double",
        "triple_double",
        "triple double",
        "special",
        "bestspecials",
      ].some((x) => text.includes(x))
    }

    const surfacedEligible = nonAvoidOrFade.filter((row) => {
      const hasDecisionBacking = Boolean(String(row?.playDecision || "").trim()) || Boolean(String(row?.decisionSummary || "").trim())
      if (isSurfacedSpecialRow(row) && !hasDecisionBacking) {
        finalBettingNowNullDecisionSpecialsFiltered += 1
        return false
      }
      return true
    })

    // Separate and rebuild so specials cannot occupy rank 1 or exceed 1 in top 3
  const corePool = surfacedEligible.filter((row) => !isSurfacedSpecialRow(row))
  const specialPool = surfacedEligible.filter((row) => isSurfacedSpecialRow(row))
    const rebuilt = []
    let cIdx = 0
    let sIdx = 0
    let specialsInTop3 = 0
    while (rebuilt.length < 10) {
      const rank = rebuilt.length + 1
      const nextCore = corePool[cIdx]
      const nextSpecial = specialPool[sIdx]
      if (!nextCore && !nextSpecial) break
      if (!nextCore) { rebuilt.push(nextSpecial); sIdx++; continue }
      if (!nextSpecial) { rebuilt.push(nextCore); cIdx++; continue }
      // Rank 1 must be core
      if (rank === 1) { rebuilt.push(nextCore); cIdx++; continue }
      // Top 3: max 1 special
      if (rank <= 3 && specialsInTop3 < 1) {
        rebuilt.push(nextSpecial); sIdx++; specialsInTop3++; continue
      }
      // Default: prefer core to keep singles/ladders anchored
      rebuilt.push(nextCore); cIdx++
    }

    const orderedRows = rebuilt.map(({ _matchupKey, rank: _r, ...row }, idx) => ({ ...row, rank: idx + 1 }))

    // Final post-ranking calibrator for surfaced bettingNow rows only.
    // Keeps order fixed and only adjusts decision labels/buckets conservatively for core rows.
    let promotedMustUsed = false
    return orderedRows.map((row, idx) => {
      const isSpecial = isSurfacedSpecialRow(row)
      if (isSpecial) return row

      const currentLabel = String(row?.finalDecisionLabel || "").toLowerCase()
      if (currentLabel === "sit" || currentLabel === "must-play") return row

      const hasSitReason = Boolean(String(row?.sitReason || "").trim())
      if (hasSitReason) return row

      const availability = String(row?.availabilityStatus || "").toLowerCase()
      if (availability === "out" || availability === "doubtful") return row
      const isQuestionable = availability === "questionable"

      const score = Number(row?.finalDecisionScore)
      if (!Number.isFinite(score)) return row

      const starterStatus = String(row?.starterStatus || "").toLowerCase()
      const externalEdgeLabel = String(row?.externalEdgeLabel || "").toLowerCase()
      const contextSummary = String(row?.supportEdge?.contextSummary || "").toLowerCase()
      const marketSummary = String(row?.marketEdge?.marketSummary || "").toLowerCase()
      const riskSummary = String(row?.riskEdge?.riskSummary || "").toLowerCase()
      const contextEdgeScore = Number(row?.supportEdge?.contextEdgeScore)

      let supportSignals = 0
      if (starterStatus === "starter") supportSignals += 1
      if (externalEdgeLabel.includes("upgrade")) supportSignals += 1
      if (contextSummary === "strong-support" || (Number.isFinite(contextEdgeScore) && contextEdgeScore >= 78)) supportSignals += 1
      if (contextSummary === "viable-support") supportSignals += 1
      if (marketSummary !== "market-adverse") supportSignals += 1
      if (riskSummary !== "risk-fragile") supportSignals += 1

      const isTopCoreSlot = idx < 4
      const questionableExceptionalEligible =
        isQuestionable &&
        isTopCoreSlot &&
        score >= 62 &&
        supportSignals >= 5 &&
        starterStatus === "starter" &&
        externalEdgeLabel.includes("upgrade") &&
        (contextSummary === "strong-support" || (Number.isFinite(contextEdgeScore) && contextEdgeScore >= 82)) &&
        marketSummary !== "market-adverse" &&
        riskSummary !== "risk-fragile"

      const strongEligible =
        isTopCoreSlot &&
        ((isQuestionable && questionableExceptionalEligible) || (!isQuestionable && score >= 49)) &&
        riskSummary !== "risk-fragile" &&
        supportSignals >= (isQuestionable ? 5 : 3) &&
        currentLabel === "playable"

      if (!strongEligible && currentLabel !== "strong-play") return row

      let nextLabel = currentLabel
      if (strongEligible) {
        nextLabel = "strong-play"
        finalDecisionCalibratorPromotedStrong += 1
      }

      const hasStrongContext =
        contextSummary === "strong-support" ||
        (Number.isFinite(contextEdgeScore) && contextEdgeScore >= 82)
      const hasSupportiveExternalState = externalEdgeLabel.includes("upgrade")
      const hasSafeMustAvailability =
        availability !== "out" &&
        availability !== "doubtful" &&
        availability !== "questionable"

      const mustEligible =
        !promotedMustUsed &&
        idx < 2 &&
        nextLabel === "strong-play" &&
        score >= 68 &&
        supportSignals >= 5 &&
        hasSafeMustAvailability &&
        starterStatus === "starter" &&
        hasStrongContext &&
        hasSupportiveExternalState &&
        marketSummary !== "market-adverse" &&
        riskSummary !== "risk-fragile"

      if (mustEligible) {
        nextLabel = "must-play"
        promotedMustUsed = true
        finalDecisionCalibratorPromotedMust += 1
      }

      const nextBucket =
        nextLabel === "must-play" ? "must-play"
        : nextLabel === "strong-play" ? "strong-play"
        : nextLabel === "playable" ? "playable"
        : nextLabel === "special-only" ? "special-only"
        : "sit"

      return {
        ...row,
        finalDecisionLabel: nextLabel,
        decisionBucket: nextBucket
      }
    })
  }

  const bettingNow = buildBettingNowView()
  mergedBestAvailableDiagnostics.finalBettingNowNullDecisionSpecialsFiltered = finalBettingNowNullDecisionSpecialsFiltered
  mergedBestAvailableDiagnostics.finalDecisionCalibratorPromotedStrong = finalDecisionCalibratorPromotedStrong
  mergedBestAvailableDiagnostics.finalDecisionCalibratorPromotedMust = finalDecisionCalibratorPromotedMust
  mergedBestAvailablePoolDiagnostics.finalBettingNowNullDecisionSpecialsFiltered = finalBettingNowNullDecisionSpecialsFiltered
  mergedBestAvailablePoolDiagnostics.finalDecisionCalibratorPromotedStrong = finalDecisionCalibratorPromotedStrong
  mergedBestAvailablePoolDiagnostics.finalDecisionCalibratorPromotedMust = finalDecisionCalibratorPromotedMust

  const buildSlateBoardView = () => {
    const lanePools = [
      { lane: "mustPlayCandidates", rows: Array.isArray(mustPlayBoard) ? mustPlayBoard : [], limit: 24 },
      { lane: "bestSingles", rows: Array.isArray(corePropsBoard) ? corePropsBoard : [], limit: 48 },
      { lane: "bestLadders", rows: Array.isArray(ladderBoard) ? ladderBoard : [], limit: 40 },
      { lane: "bestSpecials", rows: Array.isArray(specialBoard) ? specialBoard : [], limit: 40 }
    ]

    const buildSlateLegKey = (row) => {
      return [
        String(row?.matchup || row?.eventId || "").trim().toLowerCase(),
        String(row?.player || "").trim().toLowerCase(),
        String(row?.marketKey || "").trim().toLowerCase(),
        String(row?.propType || "").trim().toLowerCase(),
        String(row?.side || "").trim().toLowerCase(),
        String(row?.line ?? ""),
        String(row?.propVariant || "base").trim().toLowerCase()
      ].join("|")
    }

    const laneCapsByMatchup = {
      mustPlayCandidates: 2,
      bestSingles: 4,
      bestLadders: 3,
      bestSpecials: 3
    }

    const seenLegs = new Set()
    const groupedByMatchup = new Map()

    for (const pool of lanePools) {
      const lane = pool.lane
      const rows = Array.isArray(pool.rows) ? pool.rows : []
      const limit = Number(pool.limit || 0)

      for (let i = 0; i < rows.length && i < limit; i++) {
        const row = rows[i]
        if (!row) continue
        const legKey = buildSlateLegKey(row)
        if (seenLegs.has(legKey)) continue

        const matchup = String(row?.matchup || row?.eventId || "").trim() || "Unknown"
        const matchupKey = matchup.toLowerCase()
        const laneCap = laneCapsByMatchup[lane] || 2

        if (!groupedByMatchup.has(matchupKey)) {
          groupedByMatchup.set(matchupKey, {
            matchup,
            rows: [],
            laneCounts: new Map()
          })
        }

        const bucket = groupedByMatchup.get(matchupKey)
        const laneCount = bucket.laneCounts.get(lane) || 0
        if (laneCount >= laneCap) continue
        if (bucket.rows.length >= 12) continue

        seenLegs.add(legKey)
        bucket.laneCounts.set(lane, laneCount + 1)
        bucket.rows.push({
          ...buildReadableSurfaceRow(row, {
            sourceLane: lane,
            sourceRank: i + 1
          }),
          team: row?.team || null,
          matchup: row?.matchup || row?.eventId || null,
          eventId: row?.eventId || null
        })
      }
    }

    const matchups = Array.from(groupedByMatchup.values())
      .filter((bucket) => Array.isArray(bucket.rows) && bucket.rows.length > 0)
      .sort((a, b) => b.rows.length - a.rows.length)
      .map((bucket) => ({
        matchup: bucket.matchup,
        totalRows: bucket.rows.length,
        rows: bucket.rows
      }))

    return {
      totalMatchups: matchups.length,
      totalRows: matchups.reduce((acc, bucket) => acc + bucket.totalRows, 0),
      matchups
    }
  }

  const slateBoard = buildSlateBoardView()
  const specialtyPlayerTeamIndex = buildCanonicalSpecialtyPlayerTeamIndex(allVisibleRowsForBoards)

  const specialtyOutputs = buildSpecialtyOutputs({
    specialBoard,
    firstBasketBoard,
    tonightsBestSpecials,
    featuredPlays,
    countByMarketKey,
    specialtyPlayerTeamIndex,
    typeSliceLimit: 4,
    laneSliceLimit: 6
  })

  let finalTopSpecialsNullDecisionFilteredCount = Number(
    specialtyOutputs?.filteredTopSpecials?.nullDecisionFilteredCount || 0
  )

  const specialsAudit = specialtyOutputs?.specialsAudit || {
    totalCandidates: 0,
    countsByType: {
      firstBasket: 0,
      firstTeamBasket: 0,
      doubleDouble: 0,
      tripleDouble: 0,
      otherSpecials: 0
    },
    surfacedAuditFirstBasketCount: 0,
    surfacedAuditFirstTeamBasketCount: 0,
    auditSource: "specialBoard",
    auditSourceExcludesFirstBasketByDesign: true,
    routedFirstBasketRowsInFirstBasketBoard: 0,
    routedFirstTeamBasketRowsInFirstBasketBoard: 0,
    groupedByType: {
      firstBasket: [],
      firstTeamBasket: [],
      doubleDouble: [],
      tripleDouble: [],
      otherSpecials: []
    },
    surfacedBestSpecialsCount: 0
  }

  const mapSpecialRowsForSurface = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => buildReadableSurfaceRow(row, {
      defaultLane: "bestSpecials",
      sourceLane: row?.sourceLane || "bestSpecials"
    }))

  const typeAwareSpecialsRaw = specialtyOutputs?.typeAwareSpecials || {}
  const typeAwareSpecials = {
    bestDoubleDoubles: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestDoubleDoubles),
    bestTripleDoubles: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestTripleDoubles),
    bestFirstBasket: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestFirstBasket),
    bestFirstTeamBasket: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestFirstTeamBasket),
    bestLongshotPlays: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestLongshotPlays),
    bestLongshotSpecials: mapSpecialRowsForSurface(typeAwareSpecialsRaw.bestLongshotPlays)
  }

  const specialtyLaneOutputsRaw = specialtyOutputs?.specialtyLaneOutputs || {}
  const specialtyLaneOutputs = {
    firstBasket: mapSpecialRowsForSurface(specialtyLaneOutputsRaw.firstBasket),
    firstTeamBasket: mapSpecialRowsForSurface(specialtyLaneOutputsRaw.firstTeamBasket),
    specials: mapSpecialRowsForSurface(specialtyLaneOutputsRaw.specials),
    featured: mapSpecialRowsForSurface(specialtyLaneOutputsRaw.featured)
  }

  const buildTopCardView = () => {
    const compactRow = (row, defaultLane) => buildReadableSurfaceRow(row, { defaultLane })
    const filteredTopSpecials = specialtyOutputs?.filteredTopSpecials?.rows || []

    return {
      topSingles: (Array.isArray(tonightsBestSingles) ? tonightsBestSingles.slice(0, 4) : []).map((row) => compactRow(row, "bestSingles")),
      topLadders: (Array.isArray(tonightsBestLadders) ? tonightsBestLadders.slice(0, 4) : []).map((row) => compactRow(row, "bestLadders")),
      topSpecials: (Array.isArray(filteredTopSpecials) ? filteredTopSpecials.slice(0, 4) : []).map((row) => compactRow(row, "bestSpecials")),
      topMustPlays: (Array.isArray(mustPlayCandidates) ? mustPlayCandidates.slice(0, 4) : []).map((row) => compactRow(row, "mustPlayCandidates"))
    }
  }

  const topCard = buildTopCardView()
  mergedBestAvailableDiagnostics.finalTopSpecialsNullDecisionFilteredCount = finalTopSpecialsNullDecisionFilteredCount
  mergedBestAvailablePoolDiagnostics.finalTopSpecialsNullDecisionFilteredCount = finalTopSpecialsNullDecisionFilteredCount

  const surfacedBestSpecialRows = Array.isArray(specialtyOutputs?.normalizedBestSpecialRows)
    ? specialtyOutputs.normalizedBestSpecialRows
    : (Array.isArray(tonightsBestSpecials) ? tonightsBestSpecials : [])

  const surfacedBestSpecials = surfacedBestSpecialRows.map((row) => {
    const externalSignalInput = buildOverlayExternalSignalInput(row, { sourceLane: row?.sourceLane || "bestSpecials" })
    const decisionLayer = buildDecisionLayer({
      ...row,
      sourceLane: row?.sourceLane || "bestSpecials"
    })
    const externalOverlay = finalizeRuntimeExternalOverlay(buildExternalEdgeOverlay({
      ...row,
      sourceLane: row?.sourceLane || "bestSpecials"
    }, externalSignalInput), externalSignalInput)

    const baseDecisionLabel = decisionLayer?.finalDecisionLabel || null
    const baseDecisionBucket = decisionLayer?.decisionBucket || null
    const baseSitReason = decisionLayer?.sitReason || null
    const forceSpecialPlayable =
      String(row?.playDecision || "").toLowerCase() === "special-playable" &&
      String(row?.finalDecisionLabelHint || row?.decisionBucketHint || "").toLowerCase() === "special-only"

    const alignedDecisionLabel = forceSpecialPlayable && baseDecisionLabel === "sit"
      ? "special-only"
      : baseDecisionLabel
    const alignedDecisionBucket = forceSpecialPlayable && baseDecisionBucket === "sit"
      ? "special-only"
      : baseDecisionBucket
    const alignedSitReason = forceSpecialPlayable && baseSitReason === "play-decision-blocked"
      ? null
      : baseSitReason

    return {
      ...row,
      finalDecisionScore: decisionLayer?.finalDecisionScore ?? null,
      finalDecisionLabel: alignedDecisionLabel,
      decisionBucket: alignedDecisionBucket,
      supportEdge: decisionLayer?.supportEdge || null,
      marketEdge: decisionLayer?.marketEdge || null,
      riskEdge: decisionLayer?.riskEdge || null,
      sitReason: alignedSitReason,
      externalEdgeScore: externalOverlay?.externalEdgeScore ?? null,
      externalEdgeLabel: externalOverlay?.externalEdgeLabel || null,
      availabilityStatus: externalOverlay?.availabilityStatus || null,
      starterStatus: externalOverlay?.starterStatus || null,
      marketValidity: externalOverlay?.marketValidity || null,
      contextTag: externalOverlay?.contextTag || null,
      externalSignalsUsed: externalOverlay?.externalSignalsUsed || null,
      externalSitFlag: Boolean(externalOverlay?.externalSitFlag),
      externalSitReason: externalOverlay?.externalSitReason || null
    }
  })

  const buildCuratedSurfaceLane = ({ rows, sourceLane, defaultLane, thinDecision, isEligibleFallbackRow }) => {
    const surfacedRows = (Array.isArray(rows) ? rows : [])
      .map((row, index) => buildReadableSurfaceRow(row, {
        sourceLane,
        sourceRank: index + 1,
        defaultLane
      }))

    const primaryRows = surfacedRows.filter((row) => {
      const playDecision = String(row?.playDecision || "").toLowerCase()
      const finalDecisionLabel = String(row?.finalDecisionLabel || "").toLowerCase()
      return playDecision !== thinDecision && finalDecisionLabel !== "sit"
    })

    if (primaryRows.length > 0) return primaryRows

    return surfacedRows.filter((row) => {
      const playDecision = String(row?.playDecision || "").toLowerCase()
      return playDecision === thinDecision && isEligibleFallbackRow(row)
    }).slice(0, 3)
  }

  const curatedMostLikelyToHit = buildCuratedSurfaceLane({
    rows: Array.isArray(layer2CuratedBuckets?.mostLikelyToHit) ? layer2CuratedBuckets.mostLikelyToHit : [],
    sourceLane: "mostLikelyToHit",
    defaultLane: "bestSingles",
    thinDecision: "stable-thin",
    isEligibleFallbackRow: (row) => Number(row?.confidenceScore || 0) >= 0.58
  })
  const curatedBestValueRaw = buildCuratedSurfaceLane({
    rows: Array.isArray(layer2CuratedBuckets?.bestValue) ? layer2CuratedBuckets.bestValue : [],
    sourceLane: "bestValue",
    defaultLane: "bestSingles",
    thinDecision: "value-thin",
    isEligibleFallbackRow: (row) => {
      const odds = Number(row?.odds || 0)
      const confidenceScore = Number(row?.confidenceScore || 0)
      const marketLagScore = Number(row?.marketLagScore || 0)
      const bookDisagreementScore = Number(row?.bookDisagreementScore || 0)
      return odds >= -165 && odds <= 280 && confidenceScore >= 0.52 && (marketLagScore >= 0.18 || bookDisagreementScore >= 0.16 || odds >= 100)
    }
  })
  const curatedBestUpsideRaw = buildCuratedSurfaceLane({
    rows: Array.isArray(layer2CuratedBuckets?.bestUpside) ? layer2CuratedBuckets.bestUpside : [],
    sourceLane: "bestUpside",
    defaultLane: "bestLadders",
    thinDecision: "upside-thin",
    isEligibleFallbackRow: (row) => {
      const propVariant = String(row?.propVariant || "base").toLowerCase()
      const odds = Number(row?.odds || 0)
      const ceilingScore = Number(row?.ceilingScore || 0)
      const roleSpikeScore = Number(row?.roleSpikeScore || 0)
      const hasTrueUpsideShape = (propVariant !== "base" && propVariant !== "default") || odds >= 170
      return hasTrueUpsideShape && ceilingScore >= 0.18 && roleSpikeScore >= 0.12
    }
  })

  console.log("[CEILING-SIGNAL-EMIT-DEBUG]", {
    bestExportRows: Array.isArray(bestPayloadRows) ? bestPayloadRows.length : 0,
    bestTicketPoolRows: Array.isArray(bestPayloadRowsForTickets) ? bestPayloadRowsForTickets.length : 0,
    bestPayloadRowsWithCeiling: (Array.isArray(bestPayloadRowsForTickets) ? bestPayloadRowsForTickets : []).filter((row) =>
      Number.isFinite(Number(row?.ceilingScore))).length,
    bestPayloadRowsWithRoleSpike: (Array.isArray(bestPayloadRowsForTickets) ? bestPayloadRowsForTickets : []).filter((row) =>
      Number.isFinite(Number(row?.roleSpikeScore))).length,
    curatedMostLikelyWithCeiling: curatedMostLikelyToHit.filter((row) => Number.isFinite(Number(row?.ceilingScore))).length,
    curatedBestValueWithCeiling: curatedBestValueRaw.filter((row) => Number.isFinite(Number(row?.ceilingScore))).length,
    curatedBestUpsideWithCeiling: curatedBestUpsideRaw.filter((row) => Number.isFinite(Number(row?.ceilingScore))).length
  })

  const toFiniteNumber = (value, fallback = null) => {
    if (value == null) return fallback
    if (typeof value === "string" && !value.trim()) return fallback
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const toDecimalOddsForTicket = (americanOdds) => {
    const odds = Number(americanOdds)
    if (!Number.isFinite(odds) || odds === 0) return 1
    if (odds > 0) return 1 + (odds / 100)
    return 1 + (100 / Math.abs(odds))
  }

  const ALLOWED_NBA_BOOKS = new Set([
    "draftkings",
    "fanduel",
    "fanatics",
    "betmgm",
    "caesars"
  ])

  const isAllowedNbaBookRow = (row) => {
    const normalizedBook = String(row?.book || "").trim().toLowerCase()
    return normalizedBook && ALLOWED_NBA_BOOKS.has(normalizedBook)
  }

  const filterAllowedNbaBookRows = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => isAllowedNbaBookRow(row))

  const isLikelyMatchupText = (text) => {
    const t = String(text || "").trim().toLowerCase()
    if (!t) return false
    return t.includes("@") || t.includes(" vs ") || t.includes(" vs.")
  }

  const normalizeNbaSurfaceTeam = (row, candidateTeam) => {
    const team = String(candidateTeam || "").trim()
    if (!team) return null
    if (isLikelyMatchupText(team)) return null
    if (rowTeamMatchesMatchup({ ...row, team })) return team
    return null
  }

  const inferNbaOutcomeTier = (row, boardFamily = "") => {
    const family = String(boardFamily || "").toLowerCase()
    const marketKey = String(row?.marketKey || "").toLowerCase()
    const propVariant = String(row?.propVariant || "base").toLowerCase()
    const odds = Number(row?.odds)
    const isFirstEventFamily =
      marketKey.includes("first_basket") ||
      marketKey.includes("first_team_basket") ||
      family.includes("firstbasket") ||
      family.includes("firstteambasket")

    if (isFirstEventFamily) return "nuke"
    if (marketKey.includes("triple_double")) return "nuke"
    if (marketKey.includes("double_double")) return "ceiling"
    if (!Number.isFinite(odds)) return "ceiling"
    if (odds >= 360) return "nuke"
    if (odds >= 170) return "ceiling"
    if (propVariant !== "base" && propVariant !== "default") return "ceiling"
    return "support"
  }

  const isNbaSpecialMarketRow = (row) => {
    const marketKey = String(row?.marketKey || "").toLowerCase()
    return (
      marketKey.includes("first_basket") ||
      marketKey.includes("first_team_basket") ||
      marketKey.includes("double_double") ||
      marketKey.includes("triple_double")
    )
  }

  const toNbaSurfacedPlayRow = (row, options = {}) => {
    const boardFamily = String(options.boardFamily || "unknown")
    const sourceLane = options.sourceLane || boardFamily
    const outcomeTier = options.outcomeTier || inferNbaOutcomeTier(row, boardFamily)
    const readable = buildReadableSurfaceRow(row, { sourceLane, defaultLane: sourceLane })
    const impliedProb = impliedProbabilityFromAmerican(row?.odds)
    const confidenceScore = Number(
      Math.max(0, Math.min(1,
        toFiniteNumber(readable?.confidenceScore, null) != null
          ? Number(readable.confidenceScore)
          : (toFiniteNumber(row?.playerConfidenceScore, null) != null
            ? Number(row.playerConfidenceScore) / 100
            : (toFiniteNumber(row?.adjustedConfidenceScore, null) != null
              ? Number(row.adjustedConfidenceScore) / 100
              : 0.5)
          )
      )).toFixed(4)
    )

    const inferOpponentTeamFromMatchup = (matchup, team) => {
      const m = String(matchup || "").trim()
      if (!m) return null
      const parts = m.split("@").map((s) => String(s || "").trim()).filter(Boolean)
      if (parts.length !== 2) return null
      const away = parts[0]
      const home = parts[1]
      const t = String(team || "").trim().toLowerCase()
      if (!t) return null
      if (t === away.toLowerCase()) return home
      if (t === home.toLowerCase()) return away
      // looser includes-match fallback for cases like "Los Angeles Clippers"
      if (away.toLowerCase().includes(t) || t.includes(away.toLowerCase())) return home
      if (home.toLowerCase().includes(t) || t.includes(home.toLowerCase())) return away
      return null
    }

    const surfacedTeamRaw = normalizeNbaSurfaceTeam(row, readable?.team || row?.team || row?.playerTeam)
    const surfacedTeam =
      normalizeNbaExportTeamForRow({ ...row, team: surfacedTeamRaw }) || surfacedTeamRaw
    const matchupText = readable?.matchup || row?.matchup || row?.eventId || null
    const opponentTeam =
      row?.opponentTeam ||
      (row?.awayTeam || row?.homeTeam ? getOpponentForRow({ ...row, team: row?.team || surfacedTeam }) : null) ||
      inferOpponentTeamFromMatchup(matchupText, surfacedTeam)

    return {
      player: readable?.player || row?.player || null,
      team: surfacedTeam,
      book: readable?.book || row?.book || null,
      marketKey: readable?.marketKey || row?.marketKey || null,
      propType: readable?.propType || row?.propType || null,
      side: readable?.side || row?.side || null,
      line: readable?.line ?? row?.line ?? null,
      odds: readable?.odds ?? row?.odds ?? null,
      matchup: matchupText,
      opponentTeam: opponentTeam != null && String(opponentTeam).trim() ? String(opponentTeam).trim() : null,
      awayTeam: row?.awayTeam ?? null,
      homeTeam: row?.homeTeam ?? null,
      gameTime: row?.gameTime ?? null,
      confidenceScore,
      dataState: row?.dataState || null,
      qualitySignalCount: Number.isFinite(Number(row?.qualitySignalCount)) ? Number(row.qualitySignalCount) : null,
      modelHitProb: toFiniteNumber(row?.modelHitProb, null),
      impliedProb: Number.isFinite(impliedProb) ? Number(impliedProb.toFixed(4)) : null,
      edgeGap: toFiniteNumber(row?.edgeGap, null),
      outcomeTier,
      boardFamily,
      decisionSummary: readable?.decisionSummary || row?.decisionSummary || row?.playDecision || null,
      playDecision: row?.playDecision || readable?.playDecision || null,
      propVariant: row?.propVariant || null,
      ladderPresentation: Boolean(row?.ladderPresentation),
      hitRate: row?.hitRate ?? null,
      score: toFiniteNumber(row?.score, null),
      edge: toFiniteNumber(row?.edge, null),
      avgMin: toFiniteNumber(row?.avgMin, null),
      recent5MinAvg: toFiniteNumber(row?.recent5MinAvg, null),
      recent3MinAvg: toFiniteNumber(row?.recent3MinAvg, null),
      minutesRisk: row?.minutesRisk ?? null,
      trendRisk: row?.trendRisk ?? null,
      injuryRisk: row?.injuryRisk ?? null,
      playerStatus: row?.playerStatus ?? null,
      injuryStatus: row?.injuryStatus ?? null,
      availabilityStatus: row?.availabilityStatus ?? null,
      contextTag: row?.contextTag ?? null,
      matchupEdgeScore: toFiniteNumber(row?.matchupEdgeScore, null),
      gameEnvironmentScore: toFiniteNumber(row?.gameEnvironmentScore, null),
      dvpScore: toFiniteNumber(row?.dvpScore, null),
      ceilingScore: toFiniteNumber(row?.ceilingScore, null),
      roleSpikeScore: toFiniteNumber(row?.roleSpikeScore, null),
      marketLagScore: toFiniteNumber(row?.marketLagScore, null),
      bookDisagreementScore: toFiniteNumber(row?.bookDisagreementScore, null)
    }
  }

  const normalizeConfidence01 = (row) => {
    const values = [
      toFiniteNumber(row?.confidenceScore, null),
      toFiniteNumber(row?.playerConfidenceScore, null),
      toFiniteNumber(row?.adjustedConfidenceScore, null)
    ]
    for (const value of values) {
      if (!Number.isFinite(value)) continue
      if (value > 1) return Math.max(0, Math.min(1, value / 100))
      return Math.max(0, Math.min(1, value))
    }
    return 0.5
  }

  const getModelEdgeSignal = (row) => {
    const modelHitProb = toFiniteNumber(row?.modelHitProb, null)
    const impliedProbFromOdds = impliedProbabilityFromAmerican(row?.odds)
    if (Number.isFinite(modelHitProb) && Number.isFinite(impliedProbFromOdds)) {
      return modelHitProb - impliedProbFromOdds
    }
    const edgeGap = toFiniteNumber(row?.edgeGap, null)
    if (Number.isFinite(edgeGap)) {
      if (Math.abs(edgeGap) <= 1) return edgeGap
      return edgeGap / 100
    }
    return null
  }

  const getRowHitRate = (row) => {
    const parsed = parseHitRate(row?.hitRate)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    return toFiniteNumber(row?.modelHitProb, 0)
  }

  const buildNbaLegSignature = (row) => [
    String(row?.player || "").trim().toLowerCase(),
    String(row?.marketKey || "").trim().toLowerCase(),
    String(row?.side || "").trim().toLowerCase(),
    String(row?.line ?? ""),
    String(row?.book || "").trim().toLowerCase()
  ].join("|")

  const dedupeNbaRowsByLegSignature = (rows) => {
    const out = []
    const seen = new Set()
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = buildNbaLegSignature(row)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
    return out
  }

  const isLadderishUpsideRow = (row) => {
    const propVariant = String(row?.propVariant || "base").toLowerCase()
    return Boolean(row?.ladderPresentation) || propVariant === "alt-mid" || propVariant === "alt-high" || propVariant === "alt-max"
  }

  const liveRowsForQualityMode = dedupeNbaRowsByLegSignature([
    ...filterAllowedNbaBookRows(Array.isArray(curatedBestValueRaw) ? curatedBestValueRaw : []),
    ...filterAllowedNbaBookRows(Array.isArray(curatedBestUpsideRaw) ? curatedBestUpsideRaw : []),
    ...filterAllowedNbaBookRows(Array.isArray(tonightsBestSingles) ? tonightsBestSingles : []),
    ...filterAllowedNbaBookRows((Array.isArray(tonightsBestLadders) ? tonightsBestLadders : []).filter((row) => !isNbaSpecialMarketRow(row)))
  ]).filter((row) => Number.isFinite(Number(row?.line)) && Number.isFinite(Number(row?.odds)))
  const liveBooksForQualityMode = new Set(
    liveRowsForQualityMode
      .map((row) => String(row?.book || "").trim().toLowerCase())
      .filter(Boolean)
  )
  const snapshotSlateGameCount = Number(currentSnapshot?.snapshotSlateGameCount || 0)
  const nbaLoadedSlateQualityPassEnabled =
    liveRowsForQualityMode.length >= 18 &&
    liveBooksForQualityMode.size >= 2 &&
    snapshotSlateGameCount >= 3

  const applyLoadedSlateLaneQuality = (rows, config = {}) => {
    const safeRows = Array.isArray(rows) ? rows : []
    const maxRows = Math.max(1, Number(config?.maxRows || safeRows.length || 1))
    const relaxedFilter = typeof config?.relaxedFilter === "function" ? config.relaxedFilter : (() => true)
    const strictFilter = typeof config?.strictFilter === "function" ? config.strictFilter : (() => true)
    const rankFn = typeof config?.rankFn === "function" ? config.rankFn : (() => 0)
    const minStrictRows = Math.max(1, Number(config?.minStrictRows || 1))

    if (!nbaLoadedSlateQualityPassEnabled) {
      return {
        rows: safeRows.slice(0, maxRows),
        strictCount: safeRows.length,
        relaxedCount: safeRows.length,
        usedRelaxedFallback: false
      }
    }

    const strictRows = safeRows.filter((row) => strictFilter(row))
    const relaxedRows = safeRows.filter((row) => relaxedFilter(row))
    const useRelaxedFallback = strictRows.length < minStrictRows
    const sourceRows = useRelaxedFallback
      ? (relaxedRows.length > 0 ? relaxedRows : safeRows)
      : strictRows
    const ranked = dedupeNbaRowsByLegSignature(sourceRows)
      .sort((a, b) => rankFn(b) - rankFn(a))
      .slice(0, maxRows)

    return {
      rows: ranked,
      strictCount: strictRows.length,
      relaxedCount: relaxedRows.length,
      usedRelaxedFallback: useRelaxedFallback
    }
  }

  const bestValueQualityScore = (row) => {
    const confidence = normalizeConfidence01(row)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const bookDisagreementScore = toFiniteNumber(row?.bookDisagreementScore, 0)
    const edgeSignal = getModelEdgeSignal(row)
    const odds = Number(row?.odds || 0)
    const lowOddsPenalty = odds < -175 ? Math.min(18, (Math.abs(odds) - 175) * 0.08) : 0
    return bestValueSortValue(row) + (confidence * 26) + (marketLagScore * 16) + (bookDisagreementScore * 22) + ((edgeSignal || 0) * 65) - lowOddsPenalty
  }

  const isBestValueLaneRow = (row, strict = false) => {
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const odds = Number(row?.odds || 0)
    const confidence = normalizeConfidence01(row)
    const edgeSignal = getModelEdgeSignal(row)
    const decisionText = `${String(row?.playDecision || "")} ${String(row?.decisionSummary || "")}`.toLowerCase()
    if (!Number.isFinite(odds) || !Number.isFinite(score)) return false
    if (strict && decisionText.includes("thin")) return false
    if (odds < -220 || odds > 320) return false
    if (hitRate < (strict ? 0.53 : 0.5)) return false
    if (score < (strict ? 68 : 62)) return false
    if (edge < (strict ? 0.8 : 0.35)) return false
    if (confidence < (strict ? 0.54 : 0.5)) return false
    if (strict && Number.isFinite(edgeSignal) && edgeSignal < -0.02) return false
    return true
  }

  const bestUpsideQualityScore = (row) => {
    const odds = Number(row?.odds || 0)
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const confidence = normalizeConfidence01(row)
    const variant = String(row?.propVariant || "base").toLowerCase()
    const variantBonus =
      variant === "alt-max" ? 20 :
      variant === "alt-high" ? 15 :
      variant === "alt-mid" ? 9 : 0
    return (odds * 0.11) + (hitRate * 75) + (score * 0.9) + (edge * 16) + (ceilingScore * 18) + (roleSpikeScore * 14) + (marketLagScore * 10) + (confidence * 24) + variantBonus
  }

  const isBestUpsideLaneRow = (row, strict = false) => {
    const odds = Number(row?.odds || 0)
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const edge = Number(row?.edge || 0)
    const confidence = normalizeConfidence01(row)
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const side = String(row?.side || "").toLowerCase()
    const isUnder = side === "under"
    const ladderish = isLadderishUpsideRow(row)
    const strongUnderException =
      isUnder &&
      hitRate >= (strict ? 0.7 : 0.64) &&
      score >= (strict ? 84 : 78) &&
      edge >= (strict ? 1.7 : 1.2) &&
      (ceilingScore >= (strict ? 0.66 : 0.56) || roleSpikeScore >= (strict ? 0.58 : 0.46))
    const hasUpsideShape =
      odds >= (strict ? 170 : 145) ||
      ladderish ||
      ceilingScore >= (strict ? 0.3 : 0.2) ||
      roleSpikeScore >= (strict ? 0.22 : 0.14)

    if (!Number.isFinite(odds) || !Number.isFinite(score)) return false
    if (!hasUpsideShape) return false
    if (odds < 130 || odds > 1200) return false
    if (hitRate < (strict ? 0.46 : 0.42)) return false
    if (score < (strict ? 66 : 60)) return false
    if (edge < (strict ? 0.25 : 0.05)) return false
    if (confidence < (strict ? 0.48 : 0.45)) return false
    if (isUnder && !strongUnderException) return false
    if (strict && odds < 180 && !ladderish && ceilingScore < 0.34 && roleSpikeScore < 0.24) return false
    return true
  }

  const bestValueLaneQuality = applyLoadedSlateLaneQuality(curatedBestValueRaw, {
    maxRows: 8,
    minStrictRows: 4,
    strictFilter: (row) => isBestValueLaneRow(row, true),
    relaxedFilter: (row) => isBestValueLaneRow(row, false),
    rankFn: bestValueQualityScore
  })
  const bestUpsideLaneQuality = applyLoadedSlateLaneQuality(curatedBestUpsideRaw, {
    maxRows: 8,
    minStrictRows: 5,
    strictFilter: (row) => isBestUpsideLaneRow(row, true),
    relaxedFilter: (row) => isBestUpsideLaneRow(row, false),
    rankFn: bestUpsideQualityScore
  })

  const curatedBestValue = bestValueLaneQuality.rows
  const curatedBestUpside = bestUpsideLaneQuality.rows

  const layerBestValue = (Array.isArray(curatedBestValue) ? curatedBestValue : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestValue", sourceLane: "bestValue" }))
  const layerBestUpside = (Array.isArray(curatedBestUpside) ? curatedBestUpside : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestUpside", sourceLane: "bestUpside" }))
  const layerBestLadders = (Array.isArray(tonightsBestLadders) ? tonightsBestLadders : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .filter((row) => !isNbaSpecialMarketRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestLadders", sourceLane: "bestLadders" }))

  const layerFirstBasket = (Array.isArray(typeAwareSpecials.bestFirstBasket) ? typeAwareSpecials.bestFirstBasket : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestFirstBasket", sourceLane: "bestSpecials" }))
  const layerFirstTeamBasket = (Array.isArray(typeAwareSpecials.bestFirstTeamBasket) ? typeAwareSpecials.bestFirstTeamBasket : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestFirstTeamBasket", sourceLane: "bestSpecials" }))
  const layerDoubleDoubles = (Array.isArray(typeAwareSpecials.bestDoubleDoubles) ? typeAwareSpecials.bestDoubleDoubles : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestDoubleDoubles", sourceLane: "bestSpecials" }))
  const layerTripleDoubles = (Array.isArray(typeAwareSpecials.bestTripleDoubles) ? typeAwareSpecials.bestTripleDoubles : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestTripleDoubles", sourceLane: "bestSpecials" }))
  const layerBestSpecials = (Array.isArray(surfacedBestSpecials) ? surfacedBestSpecials : [])
    .filter((row) => isAllowedNbaBookRow(row))
    .filter((row) => !isNbaSpecialMarketRow(row))
    .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestSpecials", sourceLane: "bestSpecials" }))

  const isNbaChalkHeavyLeg = (row) => {
    const odds = Number(row?.odds)
    if (!Number.isFinite(odds)) return false
    if (odds <= -138) return true
    const hitRate = getRowHitRate(row)
    if (odds < -102 && odds > -138 && Number.isFinite(hitRate) && hitRate >= 0.55) return true
    return false
  }

  const isLongshotBoardBombShape = (row) => !isNbaChalkHeavyLeg(row) && isBombLikeRow(row, false)

  const isBombLikeRow = (row, strict = false) => {
    if (isNbaChalkHeavyLeg(row)) return false
    const odds = Number(row?.odds || 0)
    const outcomeTier = String(row?.outcomeTier || "").toLowerCase()
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const confidence = normalizeConfidence01(row)
    const propVariant = String(row?.propVariant || "base").toLowerCase()
    const hasAggressiveVariant = propVariant === "alt-high" || propVariant === "alt-max"
    if (!Number.isFinite(odds)) return false
    if (outcomeTier !== "nuke" && outcomeTier !== "ceiling") return false
    if (strict) {
      const strictBombShape =
        outcomeTier === "nuke" ||
        odds >= 280 ||
        (outcomeTier === "ceiling" && odds >= 230 && (odds >= 270 || hasAggressiveVariant || ceilingScore >= 0.4 || roleSpikeScore >= 0.28)) ||
        (odds >= 230 && hasAggressiveVariant && (ceilingScore >= 0.48 || roleSpikeScore >= 0.34))
      return strictBombShape && confidence >= 0.46
    }
    const relaxedBombShape =
      outcomeTier === "nuke" ||
      odds >= 220 ||
      (outcomeTier === "ceiling" && Number.isFinite(odds) && odds >= 100 && confidence >= 0.43) ||
      (odds >= 185 && (hasAggressiveVariant || ceilingScore >= 0.34 || roleSpikeScore >= 0.24))
    return relaxedBombShape && confidence >= 0.43
  }

  const computeNbaLongshotPredictiveIndex = (row) => {
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const bookDisagreementScore = toFiniteNumber(row?.bookDisagreementScore, 0)
    const opportunitySpikeScore = toFiniteNumber(row?.opportunitySpikeScore, 0)
    const lineupContextScore = toFiniteNumber(row?.lineupContextScore, 0)
    const edgeSignal = Math.abs(toFiniteNumber(getModelEdgeSignal(row), 0))
    const score = Number(row?.score)
    const pdText = `${row?.playDecision || ""} ${row?.decisionSummary || ""}`.toLowerCase()
    let idx =
      ceilingScore * 0.34 +
      roleSpikeScore * 0.28 +
      marketLagScore * 0.12 +
      bookDisagreementScore * 0.1 +
      Math.min(1, opportunitySpikeScore * 1.05) * 0.08 +
      Math.min(1, lineupContextScore * 1.05) * 0.06 +
      Math.min(1, edgeSignal * 12) * 0.06
    if (pdText.includes("ceiling") || pdText.includes("upside") || pdText.includes("spike") || pdText.includes("matchup")) {
      idx += 0.07
    }
    if (Number.isFinite(score) && score >= 85) idx += 0.05
    if (Number.isFinite(score) && score >= 78) idx += 0.02
    const line = Number(row?.line)
    const r5 = Number(row?.recent5Avg)
    const l10 = Number(row?.l10Avg)
    const ref = Number.isFinite(r5) ? r5 : l10
    const isUnder = String(row?.side || "").toLowerCase() === "under"
    if (Number.isFinite(line) && line > 0 && Number.isFinite(ref)) {
      const pace = ref / line
      if (!isUnder && pace >= 1.06) {
        idx += Math.min(0.12, (pace - 1.06) * 0.42)
      }
      if (isUnder && pace <= 0.94) {
        idx += Math.min(0.08, (0.94 - pace) * 0.35)
      }
    }
    const edgePts = Math.abs(toFiniteNumber(row?.edge, 0))
    if (edgePts >= 4) idx += 0.045
    if (edgePts >= 7.5) idx += 0.045
    return Math.min(1, idx)
  }

  const passesNbaLongshotPredictiveGate = (row) => {
    const idx = computeNbaLongshotPredictiveIndex(row)
    const c = toFiniteNumber(row?.ceilingScore, 0)
    const r = toFiniteNumber(row?.roleSpikeScore, 0)
    const o = Number(row?.odds)
    const edge = Math.abs(toFiniteNumber(getModelEdgeSignal(row), 0))
    const line = Number(row?.line)
    const r5 = Number(row?.recent5Avg)
    const l10 = Number(row?.l10Avg)
    const ref = Number.isFinite(r5) ? r5 : l10
    const isUnder = String(row?.side || "").toLowerCase() === "under"
    if (Number.isFinite(line) && line > 0 && Number.isFinite(ref)) {
      if (!isUnder && ref >= line * 1.12) return true
      if (isUnder && ref <= line * 0.88) return true
    }
    if (idx >= 0.235) return true
    if (c >= 0.38 || r >= 0.22) return true
    if (c + r >= 0.44) return true
    if (edge >= 0.048) return true
    if (Number.isFinite(o) && o >= 380 && (c >= 0.26 || r >= 0.16 || idx >= 0.19)) return true
    return false
  }

  const passesNbaLongshotPredictiveWeak = (row) => {
    const idx = computeNbaLongshotPredictiveIndex(row)
    const c = toFiniteNumber(row?.ceilingScore, 0)
    const r = toFiniteNumber(row?.roleSpikeScore, 0)
    const o = Number(row?.odds)
    const line = Number(row?.line)
    const r5 = Number(row?.recent5Avg)
    const l10 = Number(row?.l10Avg)
    const ref = Number.isFinite(r5) ? r5 : l10
    const isUnder = String(row?.side || "").toLowerCase() === "under"
    if (Number.isFinite(line) && line > 0 && Number.isFinite(ref)) {
      if (!isUnder && ref >= line * 1.07) return true
      if (isUnder && ref <= line * 0.93) return true
    }
    if (idx >= 0.128) return true
    if (c + r >= 0.34) return true
    if (Number.isFinite(o) && o >= 300 && idx >= 0.11) return true
    return false
  }

  const longshotQualityScore = (row) => {
    const rawOdds = Number(row?.odds || 0)
    const oddsForRank = Number.isFinite(rawOdds)
      ? (rawOdds > 0 ? Math.min(rawOdds, 580) : Math.max(rawOdds, -400))
      : 0
    const confidence = normalizeConfidence01(row)
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const edgeSignal = getModelEdgeSignal(row) || 0
    const predictiveIdx = computeNbaLongshotPredictiveIndex(row)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const bookDisagreementScore = toFiniteNumber(row?.bookDisagreementScore, 0)
    const nukeBonus = String(row?.outcomeTier || "").toLowerCase() === "nuke" ? 14 : 0
    const payoutBandBonus =
      rawOdds >= 550 ? 34 :
        rawOdds >= 400 ? 28 :
          rawOdds >= 300 ? 22 :
            rawOdds >= 250 ? 16 :
              rawOdds >= 200 ? 10 :
                rawOdds >= 180 ? 5 : 0
    const sweetSpotLift = rawOdds >= 200 && rawOdds <= 520 ? 24 : 0
    const upperBandPenalty = rawOdds > 680 ? (rawOdds - 680) * 0.11 : 0
    const oddsOnlyPenalty = predictiveIdx < 0.14 && rawOdds >= 200 ? (0.14 - predictiveIdx) * 55 : 0
    const ceilingTriggerTie =
      (Number(row?.pregameContext?.ceilingContext?.ceilingTriggerCount) || 0) * 0.002
    return (
      (oddsForRank * 0.082) +
      (confidence * 40) +
      (ceilingScore * 22) +
      (roleSpikeScore * 18) +
      (marketLagScore * 16) +
      (bookDisagreementScore * 12) +
      (edgeSignal * 62) +
      predictiveIdx * 52 +
      nukeBonus +
      payoutBandBonus * 0.88 +
      sweetSpotLift -
      upperBandPenalty -
      oddsOnlyPenalty +
      ceilingTriggerTie
    )
  }

  const inferNbaLongshotBoardOutcomeTier = (row) => {
    const marketKey = String(row?.marketKey || "").toLowerCase()
    if (
      marketKey.includes("first_basket") ||
      marketKey.includes("first_team_basket") ||
      marketKey.includes("double_double") ||
      marketKey.includes("triple_double")
    ) {
      return inferNbaOutcomeTier(row, "bestLongshotPlays")
    }
    const odds = Number(row?.odds)
    const variant = String(row?.propVariant || "base").toLowerCase()
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const baseTier = inferNbaOutcomeTier(row, "bestLongshotPlays")
    if (baseTier !== "support") return baseTier
    if (variant !== "base" && variant !== "default") return "ceiling"
    if (Number.isFinite(odds) && odds >= 150) return "ceiling"
    if (ceilingScore >= 0.58 || roleSpikeScore >= 0.36) return "ceiling"
    if (Number.isFinite(odds) && odds >= 125 && (ceilingScore >= 0.35 || roleSpikeScore >= 0.2)) return "ceiling"
    return "support"
  }

  const isNbaPlayerPropMarketForLongshotExplosion = (row) => {
    const mk = String(row?.marketKey || "").toLowerCase()
    if (
      mk.includes("first_basket") ||
      mk.includes("first_team_basket") ||
      mk.includes("double_double") ||
      mk.includes("triple_double")
    ) {
      return false
    }
    return (
      mk.startsWith("player_") ||
      mk.includes("points") ||
      mk.includes("rebounds") ||
      mk.includes("assists") ||
      mk.includes("threes") ||
      mk.includes("steals") ||
      mk.includes("blocks") ||
      mk.includes("turnovers") ||
      mk.includes("combo") ||
      mk.includes("pra")
    )
  }

  const isNbaLongshotExplosionUpstreamRow = (row) => {
    if (!row || !isNbaPlayerPropMarketForLongshotExplosion(row)) return false
    const odds = Number(row?.odds)
    if (!Number.isFinite(odds) || odds < -400 || odds > 950) return false
    if (isNbaChalkHeavyLeg(row)) return false
    const variant = String(row?.propVariant || "base").toLowerCase()
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const aggressive = variant === "alt-high" || variant === "alt-max"
    const rawScore = Number(row?.score)
    if (Number.isFinite(rawScore) && rawScore < 28 && odds < 200) return false
    if (!Number.isFinite(rawScore) && odds < 175) return false

    if (odds >= 185 && odds <= 900) return true
    if (aggressive && odds >= 125 && odds <= 950 && (ceilingScore >= 0.22 || roleSpikeScore >= 0.12)) return true
    if (aggressive && odds >= 105 && (ceilingScore >= 0.48 || roleSpikeScore >= 0.3)) return true
    if (odds >= 155 && odds < 185 && (ceilingScore >= 0.38 || roleSpikeScore >= 0.26)) return true
    return false
  }

  const snapshotPropsForLongshotExplosion = (Array.isArray(baseRows) ? baseRows : []).filter((row) => {
    const o = Number(row?.odds)
    if (!Number.isFinite(o)) return false
    if (o > 950 || o < -400) return false
    if (o >= 155 || o <= -240) return true
    const v = String(row?.propVariant || "base").toLowerCase()
    return v === "alt-high" || v === "alt-max" || (v === "alt-mid" && o >= 102)
  })

  const longshotExplosionFeed = dedupeNbaRowsByLegSignature(
    filterAllowedNbaBookRows([
      ...(Array.isArray(bestPayloadRowsForTickets) ? bestPayloadRowsForTickets : []),
      ...(Array.isArray(finalPlayableRows) ? finalPlayableRows : []),
      ...(Array.isArray(standardCandidates) ? standardCandidates : []),
      ...(Array.isArray(ladderPool) ? ladderPool : []),
      ...(Array.isArray(curatedBestUpsideRaw) ? curatedBestUpsideRaw : []),
      ...snapshotPropsForLongshotExplosion
    ]).filter((row) => isNbaLongshotExplosionUpstreamRow(row))
  )

  const layerBestLongshotPlays = (() => {
    const candidates = [
      ...longshotExplosionFeed,
      ...filterAllowedNbaBookRows(Array.isArray(lottoPicks) ? lottoPicks : []),
      ...filterAllowedNbaBookRows(Array.isArray(tonightsBestLadders) ? tonightsBestLadders : []).filter((row) => !isNbaSpecialMarketRow(row)),
      ...filterAllowedNbaBookRows(Array.isArray(curatedBestUpside) ? curatedBestUpside : []).filter((row) => !isNbaSpecialMarketRow(row)),
      ...filterAllowedNbaBookRows(Array.isArray(tonightsBestSingles) ? tonightsBestSingles : []).filter((row) => !isNbaSpecialMarketRow(row)),
      ...filterAllowedNbaBookRows((Array.isArray(mustPlayCandidates) ? mustPlayCandidates : []).filter((row) => !isNbaSpecialMarketRow(row)))
    ]
    const teamByPlayer = new Map()
    const registerPlayerTeam = (row) => {
      const playerKey = String(row?.player || "").trim().toLowerCase()
      if (!playerKey) return
      const rawTeam = row?.team || row?.playerTeam || row?.resolvedTeamCode
      if (!rawTeam) return
      const normalized = normalizeNbaSurfaceTeam(row, rawTeam)
      const finalTeam = normalized || (isLikelyMatchupText(rawTeam) ? null : String(rawTeam).trim())
      if (!finalTeam) return
      if (!teamByPlayer.has(playerKey)) teamByPlayer.set(playerKey, finalTeam)
    }
    for (const r of Array.isArray(baseRows) ? baseRows : []) registerPlayerTeam(r)
    for (const r of Array.isArray(bestPayloadRowsForTickets) ? bestPayloadRowsForTickets : []) registerPlayerTeam(r)
    for (const r of candidates) registerPlayerTeam(r)

    const ceilingContextByPlayer = new Map()
    const maybeSetCeilingContext = (r) => {
      const k = String(r?.player || "").trim().toLowerCase()
      if (!k) return
      const c = toFiniteNumber(r?.ceilingScore, 0)
      const prev = ceilingContextByPlayer.get(k)
      const prevC = toFiniteNumber(prev?.ceilingScore, 0)
      const prevHasTeam = Boolean(prev?.team)
      const nextHasTeam = Boolean(r?.team)
      if (!prev) return ceilingContextByPlayer.set(k, r)
      if (c > prevC) return ceilingContextByPlayer.set(k, r)
      if (!prevHasTeam && nextHasTeam && c >= prevC - 0.02) return ceilingContextByPlayer.set(k, r)
    }
    for (const r of liveRowsForQualityMode) maybeSetCeilingContext(r)
    for (const r of Array.isArray(bestPayloadRowsForTickets) ? bestPayloadRowsForTickets : []) maybeSetCeilingContext(r)
    for (const r of Array.isArray(baseRows) ? baseRows : []) maybeSetCeilingContext(r)
    for (const r of candidates) maybeSetCeilingContext(r)
    const getCeilingContextRow = (row) => {
      const k = String(row?.player || "").trim().toLowerCase()
      return k ? (ceilingContextByPlayer.get(k) || null) : null
    }
    const withCeilingContext = (row) => {
      const k = String(row?.player || "").trim().toLowerCase()
      const ctx = k ? ceilingContextByPlayer.get(k) : null
      if (!ctx) return row
      return {
        ...row,
        team: row.team ?? ctx.team,
        matchup: row.matchup ?? ctx.matchup,
        ceilingScore: row.ceilingScore ?? ctx.ceilingScore,
        roleSpikeScore: row.roleSpikeScore ?? ctx.roleSpikeScore,
        recent5Avg: row.recent5Avg ?? ctx.recent5Avg,
        recent3Avg: row.recent3Avg ?? ctx.recent3Avg,
        l10Avg: row.l10Avg ?? ctx.l10Avg,
        marketLagScore: row.marketLagScore ?? ctx.marketLagScore,
        bookDisagreementScore: row.bookDisagreementScore ?? ctx.bookDisagreementScore,
        opportunitySpikeScore: row.opportunitySpikeScore ?? ctx.opportunitySpikeScore,
        lineupContextScore: row.lineupContextScore ?? ctx.lineupContextScore,
        score: row.score ?? ctx.score,
        edge: row.edge ?? ctx.edge,
        modelHitProb: row.modelHitProb ?? ctx.modelHitProb,
        edgeGap: row.edgeGap ?? ctx.edgeGap
      }
    }
    const scored = []
    for (const raw of candidates) {
      const row = withCeilingContext(raw)
      if (!String(row?.player || "").trim()) continue
      const rawAmerican = Number(row?.odds)
      if (!Number.isFinite(rawAmerican) || rawAmerican <= 0) continue
      const marketKey = String(row?.marketKey || "").toLowerCase()
      if (marketKey.includes("first_basket") || marketKey.includes("first_team_basket") || marketKey.includes("double_double") || marketKey.includes("triple_double")) continue
      let surfaced = toNbaSurfacedPlayRow(row, {
        boardFamily: "bestLongshotPlays",
        sourceLane: "bestLadders",
        outcomeTier: inferNbaLongshotBoardOutcomeTier(row)
      })
      if (!surfaced?.team) {
        const ctx = getCeilingContextRow(row)
        const playerKey = String(row?.player || "").trim().toLowerCase()
        const ctxTeam = ctx?.team && !isLikelyMatchupText(ctx.team) ? String(ctx.team).trim() : null
        const mappedTeam = playerKey ? (teamByPlayer.get(playerKey) || null) : null
        const rawTeam = row?.team && !isLikelyMatchupText(row.team) ? String(row.team).trim() : null
        surfaced = { ...surfaced, team: ctxTeam || mappedTeam || rawTeam || surfaced.team || null }
      }
      const surfacedAmerican = Number(surfaced.odds)
      if (!Number.isFinite(surfacedAmerican) || surfacedAmerican <= 0) continue
      let tierEarly = String(surfaced.outcomeTier || "").trim().toLowerCase()
      if (!tierEarly || tierEarly === "support") {
        tierEarly = String(inferNbaLongshotBoardOutcomeTier(row) || "").trim().toLowerCase()
        surfaced = { ...surfaced, outcomeTier: tierEarly }
      }
      if (tierEarly === "support") continue
      if (isNbaChalkHeavyLeg(surfaced)) continue
      const am = Number(surfaced.odds)
      const co = Number(surfaced.confidenceScore)
      if (
        Number.isFinite(am) &&
        am >= 165 &&
        (!Number.isFinite(co) || co < 0.08)
      ) {
        const ceilingLift = toFiniteNumber(row?.ceilingScore ?? surfaced.ceilingScore, 0)
        const imputed = Number(Math.min(0.55, Math.max(0.43, 0.38 + ceilingLift * 0.2)).toFixed(4))
        surfaced = { ...surfaced, confidenceScore: imputed }
      }
      surfaced = {
        ...surfaced,
        ceilingScore: toFiniteNumber(row?.ceilingScore, surfaced.ceilingScore),
        roleSpikeScore: toFiniteNumber(row?.roleSpikeScore, surfaced.roleSpikeScore),
        marketLagScore: toFiniteNumber(row?.marketLagScore, surfaced.marketLagScore),
        bookDisagreementScore: toFiniteNumber(row?.bookDisagreementScore, surfaced.bookDisagreementScore),
        opportunitySpikeScore: toFiniteNumber(row?.opportunitySpikeScore, surfaced.opportunitySpikeScore),
        lineupContextScore: toFiniteNumber(row?.lineupContextScore, surfaced.lineupContextScore),
        modelHitProb: toFiniteNumber(row?.modelHitProb, surfaced.modelHitProb),
        edgeGap: toFiniteNumber(row?.edgeGap, surfaced.edgeGap),
        edge: toFiniteNumber(row?.edge, surfaced.edge),
        recent5Avg: row?.recent5Avg ?? surfaced.recent5Avg,
        recent3Avg: row?.recent3Avg ?? surfaced.recent3Avg,
        l10Avg: row?.l10Avg ?? surfaced.l10Avg,
        line: surfaced.line ?? row?.line,
        side: surfaced.side ?? row?.side
      }
      const longshotPredictiveIndex = Number(computeNbaLongshotPredictiveIndex(surfaced).toFixed(4))
      surfaced = { ...surfaced, longshotPredictiveIndex }
      const pregameContext = buildPregameContext({ sport: "nba", row: surfaced })
      surfaced = {
        ...surfaced,
        longshotPredictiveIndex,
        pregameContext,
        explanationTags: pregameContext.explanationTags
      }
      scored.push(surfaced)
    }
    const deduped = dedupeNbaRowsByLegSignature(scored)
    const strictRows = deduped.filter((row) => isBombLikeRow(row, true))
    const relaxedRows = deduped.filter((row) => isLongshotBoardBombShape(row))
    // Longshot board is payout-upside first: strict bomb gates skew hit-rate-shaped and can
    // hide real +200–600 legs that only pass relaxed shape. Prefer relaxed whenever non-empty.
    const chosenPool = relaxedRows.length ? relaxedRows : strictRows

    const finalizeLongshotBoardRow = (row) => {
      const o = Number(row?.odds)
      if (!Number.isFinite(o) || o <= 0) return null
      let tier = String(row?.outcomeTier ?? "").trim().toLowerCase()
      if (tier !== "nuke" && tier !== "ceiling") {
        tier = String(inferNbaLongshotBoardOutcomeTier({ ...row, odds: o }) || "").trim().toLowerCase()
      }
      if (tier === "support") return null
      if (tier !== "nuke" && tier !== "ceiling") {
        tier = o >= 360 ? "nuke" : "ceiling"
      }
      const shaped = { ...row, odds: o, outcomeTier: tier }
      if (!isLongshotBoardBombShape(shaped)) return null
      return shaped
    }

    const sortedChosen = [...chosenPool].sort((a, b) => longshotQualityScore(b) - longshotQualityScore(a))
    const finalizedOrdered = []
    const seenFinalize = new Set()
    for (const row of sortedChosen) {
      const fin = finalizeLongshotBoardRow(row)
      if (!fin) continue
      const key = buildNbaLegSignature(fin)
      if (seenFinalize.has(key)) continue
      seenFinalize.add(key)
      finalizedOrdered.push(fin)
    }
    const distinctTeamsAvailable = new Set(
      finalizedOrdered
        .map((r) => String(r?.team || "").trim().toLowerCase())
        .filter(Boolean)
    ).size
    // If we have enough distinct teams, cap repeats harder to prevent one-team domination.
    const maxTeamUses = distinctTeamsAvailable >= 3 ? 4 : 6
    const out = []
    const used = new Set()
    const playerUses = new Map()
    const teamUses = new Map()
    const matchupUses = new Map()
    const marketUsesByPlayer = new Map()

    const canAcceptLongshot = (row) => {
      const player = String(row?.player || "").trim().toLowerCase()
      const team = String(row?.team || "").trim().toLowerCase() || "__unknown__"
      const matchup = String(row?.matchup || "").trim().toLowerCase()
      const marketKey = String(row?.marketKey || "").trim().toLowerCase()

      const pCount = player ? (playerUses.get(player) || 0) : 0
      const tCount = team ? (teamUses.get(team) || 0) : 0
      const mCount = matchup ? (matchupUses.get(matchup) || 0) : 0

      // Prevent longshot board from collapsing into one team/player's repeated alts.
      // Keep depth by allowing some repeats, but cap them.
      if (player && pCount >= 2) return false
      if (team === "__unknown__" && tCount >= 2) return false
      if (team && tCount >= maxTeamUses) return false
      if (matchup && mCount >= 9) return false

      if (player && marketKey) {
        const set = marketUsesByPlayer.get(player) || new Set()
        if (set.has(marketKey)) return false
      }

      return true
    }

    const recordLongshotPick = (row) => {
      const player = String(row?.player || "").trim().toLowerCase()
      const team = String(row?.team || "").trim().toLowerCase() || "__unknown__"
      const matchup = String(row?.matchup || "").trim().toLowerCase()
      const marketKey = String(row?.marketKey || "").trim().toLowerCase()
      if (player) playerUses.set(player, (playerUses.get(player) || 0) + 1)
      if (team) teamUses.set(team, (teamUses.get(team) || 0) + 1)
      if (matchup) matchupUses.set(matchup, (matchupUses.get(matchup) || 0) + 1)
      if (player && marketKey) {
        const set = marketUsesByPlayer.get(player) || new Set()
        set.add(marketKey)
        marketUsesByPlayer.set(player, set)
      }
    }

    for (const r of finalizedOrdered) {
      if (out.length >= 14) break
      const k = buildNbaLegSignature(r)
      if (used.has(k)) continue
      if (passesNbaLongshotPredictiveGate(r) && canAcceptLongshot(r)) {
        used.add(k)
        out.push(r)
        recordLongshotPick(r)
      }
    }
    if (out.length < 14) {
      for (const r of finalizedOrdered) {
        if (out.length >= 14) break
        const k = buildNbaLegSignature(r)
        if (used.has(k)) continue
        if (passesNbaLongshotPredictiveWeak(r) && canAcceptLongshot(r)) {
          used.add(k)
          out.push(r)
          recordLongshotPick(r)
        }
      }
    }
    if (out.length < 6) {
      for (const r of finalizedOrdered) {
        if (out.length >= 14) break
        const k = buildNbaLegSignature(r)
        if (used.has(k)) continue
        if (!canAcceptLongshot(r)) continue
        used.add(k)
        out.push(r)
        recordLongshotPick(r)
      }
    }
    return out.slice(0, 14)
  })()

  const convictionRowsSource = [
    ...filterAllowedNbaBookRows((Array.isArray(mustPlayCandidates) ? mustPlayCandidates : []).filter((row) => !isNbaSpecialMarketRow(row))),
    ...filterAllowedNbaBookRows(Array.isArray(tonightsBestSingles) ? tonightsBestSingles : []),
    ...filterAllowedNbaBookRows((Array.isArray(tonightsBestLadders) ? tonightsBestLadders : []).filter((row) => !isNbaSpecialMarketRow(row)))
  ]

  const layeredConvictions = (() => {
    const byPlayer = new Map()
    for (const row of convictionRowsSource) {
      const player = String(row?.player || "").trim()
      if (!player) continue
      if (!byPlayer.has(player)) byPlayer.set(player, [])
      byPlayer.get(player).push(row)
    }

    const rows = []
    for (const [player, playerRows] of byPlayer.entries()) {
      const surfacedRows = playerRows
        .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "convictions", sourceLane: row?.mustPlaySourceLane || "bestSingles" }))
        .sort((a, b) => Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0))
      const top = surfacedRows[0] || {}
      const oddsValues = surfacedRows.map((r) => Number(r?.odds)).filter(Number.isFinite)
      const minOdds = oddsValues.length ? Math.min(...oddsValues) : 0
      const maxOdds = oddsValues.length ? Math.max(...oddsValues) : 0
      const volatilityScore = Number(Math.max(0, Math.min(1, Math.abs(maxOdds - minOdds) / 700)).toFixed(4))
      const confidenceScore = Number(top?.confidenceScore || 0.5)
      const ceilingScore = Number(Math.max(0, Math.min(1, ((maxOdds || 100) + 300) / 1100)).toFixed(4))
      const floorScore = Number(Math.max(0, Math.min(1, 1 - volatilityScore)).toFixed(4))
      const spikeScore = Number(Math.max(0, Math.min(1, (ceilingScore + confidenceScore) / 2)).toFixed(4))
      const playerConvictionScore = Number(((confidenceScore * 0.52) + (ceilingScore * 0.2) + (floorScore * 0.16) + (spikeScore * 0.12)).toFixed(4))

      rows.push({
        player,
        team: top?.team || null,
        playerConvictionScore,
        confidenceScore,
        ceilingScore,
        floorScore,
        spikeScore,
        volatilityScore,
        bestFamilyForPlayer: String(top?.boardFamily || "bestSingles"),
        topOutcomeCandidates: surfacedRows.slice(0, 3)
      })
    }

    return rows.sort((a, b) => Number(b.playerConvictionScore || 0) - Number(a.playerConvictionScore || 0)).slice(0, 10)
  })()

  const ladderCandidateRows = [
    ...filterAllowedNbaBookRows((Array.isArray(tonightsBestLadders) ? tonightsBestLadders : []).filter((row) => !isNbaSpecialMarketRow(row))),
    ...filterAllowedNbaBookRows((Array.isArray(curatedBestUpside) ? curatedBestUpside : []).filter((row) => !isNbaSpecialMarketRow(row))),
    ...filterAllowedNbaBookRows((Array.isArray(lottoPicks) ? lottoPicks : []).filter((row) => !isNbaSpecialMarketRow(row)))
  ]

  const buildLadderTierRows = (tier) => {
    const byPlayer = new Map()
    for (const row of ladderCandidateRows) {
      const player = String(row?.player || "").trim()
      if (!player) continue
      const surfaced = toNbaSurfacedPlayRow(row, { boardFamily: "bestLadders", sourceLane: "bestLadders" })
      if (surfaced.outcomeTier !== tier) continue
      const existing = byPlayer.get(player)
      if (!existing || Number(surfaced.confidenceScore || 0) > Number(existing.confidenceScore || 0)) {
        byPlayer.set(player, surfaced)
      }
    }
    return Array.from(byPlayer.values())
      .sort((a, b) => Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0))
      .slice(0, 10)
  }

  const layeredLadders = {
    bestSupportOutcomes: buildLadderTierRows("support"),
    bestCeilingOutcomes: buildLadderTierRows("ceiling"),
    bestNukeOutcomes: buildLadderTierRows("nuke")
  }

  const buildTicketLeg = (row, role) => {
    const base = row && typeof row === "object" ? { ...row } : {}
    const merged = { ...base, role }
    const teamNorm = normalizeNbaExportTeamForRow(merged)
    if (teamNorm) merged.team = teamNorm
    return {
      ...merged,
      role,
      player: merged.player ?? null,
      team: merged.team ?? null,
      book: merged.book ?? null,
      marketKey: merged.marketKey ?? null,
      propType: merged.propType ?? null,
      side: merged.side ?? null,
      line: merged.line ?? null,
      odds: merged.odds ?? null,
      outcomeTier: merged.outcomeTier || inferNbaOutcomeTier(merged, "tickets"),
      confidenceScore: toFiniteNumber(merged.confidenceScore, 0.5),
      matchup: merged.matchup ?? null,
      playDecision: merged.playDecision ?? null,
      propVariant: merged.propVariant ?? null,
      ceilingScore: toFiniteNumber(merged.ceilingScore, null),
      pregameContext: buildPregameContext({ sport: "nba", row: merged })
    }
  }

  const buildTicketCandidate = (legs, ticketType, options = {}) => {
    const safeLegs = (Array.isArray(legs) ? legs : []).filter(Boolean)
    if (safeLegs.length < 2) return null
    const players = safeLegs.map((leg) => String(leg?.player || "").trim().toLowerCase()).filter(Boolean)
    if (new Set(players).size !== players.length) return null

    const bookKey = (leg) => String(leg?.book || "").trim().toLowerCase()
    const uniqueBooks = [...new Set(safeLegs.map((leg) => bookKey(leg)).filter(Boolean))]

    if (options?.requireSameBook === true) {
      if (uniqueBooks.length !== 1) return null
    }

    const avgConfidence = safeLegs.reduce((sum, leg) => sum + Number(leg?.confidenceScore || 0), 0) / safeLegs.length
    const payoutDecimal = safeLegs.reduce((acc, leg) => acc * toDecimalOddsForTicket(leg?.odds), 1)
    const payoutSignal = Math.max(0, Math.min(1, (payoutDecimal - 2.2) / 8))
    const ticketScore = Number(((avgConfidence * 0.68) + (payoutSignal * 0.32)).toFixed(4))

    const ticketBook =
      uniqueBooks.length === 1
        ? String(safeLegs[0]?.book || "").trim() || uniqueBooks[0]
        : (String(safeLegs[0]?.book || "").trim() || null)

    return {
      ticketType,
      legCount: safeLegs.length,
      book: ticketBook,
      ticketScore,
      estimatedPayoutDecimal: Number(payoutDecimal.toFixed(2)),
      legs: safeLegs
    }
  }

  const selectLayeredTickets = (candidates, limit, constraints = {}) => {
    const safeCandidates = (Array.isArray(candidates) ? candidates : [])
      .filter(Boolean)
      .sort((a, b) => Number(b?.ticketScore || 0) - Number(a?.ticketScore || 0))

    const selected = []
    const seenTicketKeys = new Set()
    const playerUses = new Map()
    const matchupUses = new Map()
    const playerCap = Math.max(1, Number(constraints?.maxPlayerUsesAfterFirst || 1))
    const matchupCap = Math.max(1, Number(constraints?.maxMatchupUsesAcrossSurfacedTickets || 2))

    for (const ticket of safeCandidates) {
      const key = (Array.isArray(ticket?.legs) ? ticket.legs : [])
        .map((leg) => [String(leg?.player || ""), String(leg?.marketKey || ""), String(leg?.line ?? "")].join("|"))
        .sort()
        .join("||")
      if (!key || seenTicketKeys.has(key)) continue

      if (selected.length > 0) {
        let blocked = false
        for (const leg of ticket.legs || []) {
          const playerKey = String(leg?.player || "").trim().toLowerCase()
          const matchupKey = String(leg?.matchup || "").trim().toLowerCase()
          if (playerKey && (playerUses.get(playerKey) || 0) >= playerCap) {
            blocked = true
            break
          }
          if (matchupKey && (matchupUses.get(matchupKey) || 0) >= matchupCap) {
            blocked = true
            break
          }
        }
        if (blocked) continue
      }

      seenTicketKeys.add(key)
      selected.push(ticket)
      for (const leg of ticket.legs || []) {
        const playerKey = String(leg?.player || "").trim().toLowerCase()
        const matchupKey = String(leg?.matchup || "").trim().toLowerCase()
        if (playerKey) playerUses.set(playerKey, (playerUses.get(playerKey) || 0) + 1)
        if (matchupKey) matchupUses.set(matchupKey, (matchupUses.get(matchupKey) || 0) + 1)
      }

      if (selected.length >= Math.max(1, Number(limit || 6))) break
    }

    return selected
  }

  const bookCountsFromRows = (rows) => {
    const counts = new Map()
    for (const row of Array.isArray(rows) ? rows : []) {
      const bookKey = String(row?.book || "").trim().toLowerCase()
      if (!bookKey) continue
      counts.set(bookKey, (counts.get(bookKey) || 0) + 1)
    }
    return counts
  }

  const booksWithAtLeastRows = (rows, minRows) => {
    const out = new Set()
    for (const [bookKey, count] of bookCountsFromRows(rows).entries()) {
      if (count >= minRows) out.add(bookKey)
    }
    return out
  }

  const intersectBookSets = (a, b) => {
    const out = new Set()
    for (const value of a) {
      if (b.has(value)) out.add(value)
    }
    return out
  }

  const supportLegQualityScore = (row) => {
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const edgeSignal = getModelEdgeSignal(row) || 0
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const marketLagScore = toFiniteNumber(row?.marketLagScore, 0)
    const conservativeOddsBonus = odds >= -185 && odds <= 120 ? 8 : 0
    const longshotPenalty = odds > 160 ? Math.min(14, (odds - 160) * 0.08) : 0
    return (confidence * 44) + (hitRate * 36) + (score * 0.3) + (edgeSignal * 58) + (marketLagScore * 8) + conservativeOddsBonus - longshotPenalty
  }

  const isStrongSupportLeg = (row, strict = false) => {
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const hitRate = getRowHitRate(row)
    const score = Number(row?.score || 0)
    const edgeSignal = getModelEdgeSignal(row)
    const decisionText = `${String(row?.playDecision || "")} ${String(row?.decisionSummary || "")}`.toLowerCase()
    if (String(row?.outcomeTier || "").toLowerCase() !== "support") return false
    if (!Number.isFinite(odds)) return false
    if (odds < -260 || odds > 220) return false
    if (hitRate < (strict ? 0.54 : 0.5)) return false
    if (score < (strict ? 66 : 60)) return false
    if (confidence < (strict ? 0.56 : 0.5)) return false
    if (strict && decisionText.includes("thin")) return false
    if (strict && Number.isFinite(edgeSignal) && edgeSignal < -0.03) return false
    return true
  }

  const clusterNbaSupportPoolByBook = (rows, max = 12) => {
    const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => supportLegQualityScore(b) - supportLegQualityScore(a))
    const byBook = new Map()
    for (const row of sorted) {
      const key = String(row?.book || "").trim().toLowerCase()
      if (!key) continue
      if (!byBook.has(key)) byBook.set(key, [])
      byBook.get(key).push(row)
    }
    const keys = [...byBook.keys()].sort()
    if (!keys.length) return []
    const perBook = Math.max(2, Math.ceil(max / keys.length))
    const out = []
    for (const k of keys) {
      const bucket = byBook.get(k) || []
      out.push(...bucket.slice(0, perBook))
    }
    return dedupeNbaRowsByLegSignature(out).slice(0, max)
  }

  const nbaSameBookPairPossible = (pool) => {
    for (const count of bookCountsFromRows(pool).values()) {
      if (count >= 2) return true
    }
    return false
  }

  const isBombTicketLeg = (row, strict = false) => {
    if (!isBombLikeRow(row, strict)) return false
    if (isNbaChalkHeavyLeg(row)) return false
    const odds = Number(row?.odds || 0)
    const outcomeTier = String(row?.outcomeTier || "").toLowerCase()
    const ceilingScore = toFiniteNumber(row?.ceilingScore, 0)
    const roleSpikeScore = toFiniteNumber(row?.roleSpikeScore, 0)
    const propVariant = String(row?.propVariant || "base").toLowerCase()
    const hasAggressiveVariant = propVariant === "alt-high" || propVariant === "alt-max"
    if (!Number.isFinite(odds)) return false

    // Hard floor: bomb-ticket legs must be longshot shaped, not pick'em or heavy chalk.
    if (odds > 0 && odds < 118) return false
    if (odds <= 0 && odds > -108) return false
    if (odds <= -138) return false
    if (odds > 0 && odds < 190 && outcomeTier !== "nuke") return false

    if (!strict) {
      return (
        outcomeTier === "nuke" ||
        odds >= 275 ||
        (odds >= 220 && (hasAggressiveVariant || ceilingScore >= 0.44 || roleSpikeScore >= 0.3))
      )
    }

    return (
      outcomeTier === "nuke" ||
      odds >= 300 ||
      (odds >= 240 && (ceilingScore >= 0.52 || roleSpikeScore >= 0.36))
    )
  }

  const firstEventLegQualityScore = (row) => {
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const edgeSignal = getModelEdgeSignal(row) || 0
    const preferredOddsCenter = 520
    const distancePenalty = Number.isFinite(odds) ? Math.min(18, Math.abs(odds - preferredOddsCenter) * 0.02) : 0
    return (confidence * 58) + (edgeSignal * 54) + (Math.max(0, Math.min(1200, odds)) * 0.03) - distancePenalty
  }

  const isQualityFirstEventLeg = (row, strict = false) => {
    const marketKey = String(row?.marketKey || "").toLowerCase()
    const isFirstEventMarket = marketKey.includes("first_basket") || marketKey.includes("first_team_basket")
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const edgeSignal = getModelEdgeSignal(row)
    if (!isFirstEventMarket) return false
    if (!Number.isFinite(odds)) return false
    if (odds < 140 || odds > 1800) return false
    if (confidence < (strict ? 0.44 : 0.4)) return false
    if (strict && Number.isFinite(edgeSignal) && edgeSignal < -0.045) return false
    return true
  }

  const isFirstEventAnchorLeg = (row) => {
    const confidence = normalizeConfidence01(row)
    const odds = Number(row?.odds || 0)
    const edgeSignal = getModelEdgeSignal(row)
    return Number.isFinite(odds) &&
      odds <= 780 &&
      confidence >= 0.5 &&
      (!Number.isFinite(edgeSignal) || edgeSignal >= -0.03)
  }

  const hydrateForCoreTickets = (row) => {
    const merged = mergeNbaExportRowWithEnrichmentLookup(row, nbaEnrichmentLegLookup)
    const recovered = recoverNbaExportRowTeamAndVenue(merged)
    const indexed = fillNbaRowTeamFromSingleEventMap(
      fillNbaRowTeamFromPlayerEventMap(recovered, nbaTeamByPlayerEvent),
      nbaTeamByPlayerSingleEvent
    )
    if (String(indexed?.team || "").trim()) return withNbaRowDataState(indexed)
    const t = resolveCanonicalPlayerTeamForRow(indexed)
    return withNbaRowDataState(t ? { ...indexed, team: t } : indexed)
  }

  const supportBackfillCandidates = (() => {
    const source = Array.isArray(nbaEnrichmentHydrationSources) ? nbaEnrichmentHydrationSources : []
    const rows = source
      .filter((row) => isAllowedNbaBookRow(row))
      .filter((row) => !isNbaSpecialMarketRow(row))
      .map((row) => withNbaRowDataState(row))
      .filter((row) => String(row?.dataState || "") === "complete")
      .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestSingles", sourceLane: "supportBackfill" }))
      .filter((row) => String(row?.outcomeTier || "").toLowerCase() === "support")
      .sort((a, b) => supportLegQualityScore(b) - supportLegQualityScore(a))
    return rows.slice(0, 24)
  })()

  const supportCompleteBackfill = (() => {
    const source = Array.isArray(bestPayloadRowsForTickets) ? bestPayloadRowsForTickets : []
    const rows = source
      .map((row) => withNbaRowDataState(row))
      .filter((row) => String(row?.dataState || "") === "complete")
      .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestSingles", sourceLane: "completeCoreSupportBackfill" }))
      .filter((row) => String(row?.outcomeTier || "").toLowerCase() === "support")
      .sort((a, b) => supportLegQualityScore(b) - supportLegQualityScore(a))
    return rows.slice(0, 24)
  })()

  const ticketSupportCandidatesBase = dedupeNbaRowsByLegSignature([
    ...(Array.isArray(bestPayloadRowsForTickets) ? bestPayloadRowsForTickets : [])
      .filter((row) => isAllowedNbaBookRow(row))
      .filter((row) => !isNbaSpecialMarketRow(row))
      .map((row) => toNbaSurfacedPlayRow(row, { boardFamily: "bestSingles", sourceLane: "bestPayload" })),
    ...(Array.isArray(tonightsBestSingles) ? tonightsBestSingles : [])
      .filter((row) => isAllowedNbaBookRow(row))
      .filter((row) => !isNbaSpecialMarketRow(row))
      .map((row) => toNbaSurfacedPlayRow(hydrateForCoreTickets(row), { boardFamily: "bestSingles", sourceLane: "bestSingles" })),
    ...(Array.isArray(layerBestValue) ? layerBestValue : []).map((row) => hydrateForCoreTickets(row)),
    ...supportBackfillCandidates,
    ...supportCompleteBackfill
  ])
    .filter((row) => isAllowedNbaBookRow(row))
    .filter((row) => String(row?.outcomeTier || "").toLowerCase() === "support")

  // Support/safePair ticket seeds: never allow INVALID rows.
  // Prefer COMPLETE rows; allow PARTIAL only if needed to avoid empty safe pairs on thin slates.
  const ticketSupportCandidatesScored = ticketSupportCandidatesBase
    .filter((row) => String(row?.dataState || "") !== "invalid")
    .sort((a, b) => supportLegQualityScore(b) - supportLegQualityScore(a))

  const ticketBombCandidates = dedupeNbaRowsByLegSignature([
    ...layerBestLongshotPlays,
    ...layerBestUpside.filter((row) => row?.outcomeTier !== "support")
  ])
    .filter((row) => isAllowedNbaBookRow(row))
    .filter((row) => !isNbaSpecialMarketRow(row))
    .filter((row) => !isNbaChalkHeavyLeg(row))
    .sort((a, b) => longshotQualityScore(b) - longshotQualityScore(a))

  const ticketFirstEventCandidates = dedupeNbaRowsByLegSignature([
    ...layerFirstBasket,
    ...layerFirstTeamBasket
  ])
    .filter((row) => isAllowedNbaBookRow(row))
    .sort((a, b) => firstEventLegQualityScore(b) - firstEventLegQualityScore(a))

  const ticketSupportStrict = ticketSupportCandidatesScored.filter((row) => isStrongSupportLeg(row, true))
  const ticketSupportRelaxed = ticketSupportCandidatesScored.filter((row) => isStrongSupportLeg(row, false))
  const ticketBombStrict = ticketBombCandidates.filter((row) => isBombTicketLeg(row, true))
  const ticketBombRelaxed = ticketBombCandidates.filter((row) => isBombTicketLeg(row, false))
  const ticketFirstEventStrict = ticketFirstEventCandidates.filter((row) => isQualityFirstEventLeg(row, true))
  const ticketFirstEventRelaxed = ticketFirstEventCandidates.filter((row) => isQualityFirstEventLeg(row, false))

  let ticketSupportPool = (nbaLoadedSlateQualityPassEnabled && ticketSupportStrict.length >= 6 ? ticketSupportStrict : ticketSupportRelaxed).slice(0, 12)
  let ticketBombPool = ticketBombStrict.slice(0, 14)
  let ticketFirstEventPool = (nbaLoadedSlateQualityPassEnabled && ticketFirstEventStrict.length >= 6 ? ticketFirstEventStrict : ticketFirstEventRelaxed).slice(0, 10)

  const strictBombPoolTooThin =
    ticketBombPool.length < 2 ||
    booksWithAtLeastRows(ticketBombPool, 2).size === 0
  if (strictBombPoolTooThin) {
    ticketBombPool = ticketBombRelaxed.slice(0, 14)
  }

  if (ticketSupportPool.length === 0) ticketSupportPool = ticketSupportCandidatesScored.slice(0, 12)
  if (ticketBombPool.length === 0) {
    const shapeOk = ticketBombCandidates
      .filter((row) => !isNbaChalkHeavyLeg(row))
      .filter((row) => isBombLikeRow(row, false))
    const fallbackRows = shapeOk.length ? shapeOk : layerBestLongshotPlays
    ticketBombPool = fallbackRows
      .filter((row) => !isNbaChalkHeavyLeg(row))
      .filter((row) => isBombLikeRow(row, false))
      .slice(0, 14)
  }
  if (ticketFirstEventPool.length === 0) ticketFirstEventPool = ticketFirstEventCandidates.slice(0, 10)

  if (!nbaSameBookPairPossible(ticketSupportPool) && ticketSupportCandidatesScored.length >= 3) {
    const relaxedForPairs = ticketSupportRelaxed.length ? ticketSupportRelaxed : ticketSupportCandidatesScored
    ticketSupportPool = clusterNbaSupportPoolByBook(relaxedForPairs, 12)
  }

  const bombPlusSupportBooks = intersectBookSets(
    booksWithAtLeastRows(ticketBombPool, 1),
    booksWithAtLeastRows(ticketSupportPool, 1)
  )
  if (nbaLoadedSlateQualityPassEnabled && bombPlusSupportBooks.size === 0) {
    ticketSupportPool = ticketSupportRelaxed.slice(0, 12)
  }

  if (nbaLoadedSlateQualityPassEnabled && booksWithAtLeastRows(ticketFirstEventPool, 2).size === 0) {
    ticketFirstEventPool = ticketFirstEventRelaxed.slice(0, 10)
  }

  const buildableBombPairBooks = booksWithAtLeastRows(ticketBombPool, 2)
  const buildableBombPlusSupportBooks = intersectBookSets(
    booksWithAtLeastRows(ticketBombPool, 1),
    booksWithAtLeastRows(ticketSupportPool, 1)
  )
  const buildableFirstEventBooks = booksWithAtLeastRows(ticketFirstEventPool, 2)
  const ticketBuildableBooks = Array.from(new Set([
    ...Array.from(buildableBombPairBooks),
    ...Array.from(buildableBombPlusSupportBooks),
    ...Array.from(buildableFirstEventBooks)
  ]))

  const buildBombPairTickets = () => {
    const candidates = []
    for (let i = 0; i < ticketBombPool.length; i += 1) {
      for (let j = i + 1; j < ticketBombPool.length; j += 1) {
        const ticket = buildTicketCandidate([
          buildTicketLeg(ticketBombPool[i], "bomb"),
          buildTicketLeg(ticketBombPool[j], "bomb")
        ], "bombPair", { requireSameBook: true })
        if (ticket) candidates.push(ticket)
      }
    }
    return selectLayeredTickets(candidates, 6, { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
  }

  const buildBombPlusSupportTickets = () => {
    const candidates = []
    for (const bomb of ticketBombPool.slice(0, 8)) {
      for (const support of ticketSupportPool.slice(0, 10)) {
        const ticket = buildTicketCandidate([
          buildTicketLeg(bomb, "bomb"),
          buildTicketLeg(support, "support")
        ], "bombPlusSupport", { requireSameBook: true })
        if (ticket) candidates.push(ticket)
      }
    }
    return selectLayeredTickets(candidates, 8, { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
  }

  const buildSafePairTickets = () => {
    // `ticketSupportPool` can collapse to repeated players after strict/relaxed gates; safe pairs
    // need two different players. Prefer the pre-gate candidate stream (includes bestPayload + singles + value lane).
    const safeRows =
      ticketSupportCandidatesScored.length >= 2
        ? ticketSupportCandidatesScored.slice(0, 20)
        : ticketSupportPool.slice(0, 12)
    const buildPairs = (requireSameBook) => {
      const candidates = []
      for (let i = 0; i < safeRows.length; i += 1) {
        for (let j = i + 1; j < safeRows.length; j += 1) {
          const ticket = buildTicketCandidate(
            [
              buildTicketLeg(safeRows[i], "support"),
              buildTicketLeg(safeRows[j], "support")
            ],
            "safePair",
            { requireSameBook }
          )
          if (ticket) candidates.push(ticket)
        }
      }
      return selectLayeredTickets(candidates, 6, { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
    }

    const sameBook = buildPairs(true)
    if (sameBook.length) return sameBook

    // 1–2 game slates often split "support" legs across books 1+1; same-book pairs then vanish entirely.
    if (snapshotSlateGameCount <= 2 && safeRows.length >= 2) {
      return buildPairs(false)
    }

    return sameBook
  }

  const buildBangerTickets = () => {
    const slateModeRaw = nbaRowQualityAudit?.slateMode?.mode || "unknown"
    const slateReasons = Array.isArray(nbaRowQualityAudit?.slateMode?.reasons)
      ? nbaRowQualityAudit.slateMode.reasons
      : []
    const metrics = nbaRowQualityAudit?.slateMode?.metrics || {}
    const propsCount = Number(metrics.propsCount ?? 0)
    const slateGames = Number(metrics.games || snapshotSlateGameCount || 0)
    const deadSlate =
      slateReasons.includes("no-games") ||
      slateReasons.includes("no-props") ||
      slateReasons.includes("no-raw-props")
    // Quality-pass alone must not zero-out executable bangers when games+props are live.
    let slateMode = slateModeRaw
    const routePlayableCount = Array.isArray(finalPlayableRows) ? finalPlayableRows.length : 0
    if (slateModeRaw === "thinBad" && !deadSlate && slateGames > 0 && (propsCount > 0 || routePlayableCount > 0)) {
      slateMode = slateGames <= 2 ? "thin" : "light"
    }
    const isHeavy = slateMode === "heavy"
    const isLight = slateMode === "light"
    const isThin = slateMode === "thin"
    const isThinBad = slateMode === "thinBad"

    const limits = (() => {
      if (isThinBad) return { total: 0, bombPair: 0, bombSupport: 0, ceilingTriple: 0 }
      if (isThin) return { total: 3, bombPair: 1, bombSupport: 1, ceilingTriple: 1 }
      if (isLight) return { total: 6, bombPair: 2, bombSupport: 2, ceilingTriple: 2 }
      if (isHeavy) return { total: 10, bombPair: 4, bombSupport: 4, ceilingTriple: 3 }
      return { total: 6, bombPair: 2, bombSupport: 2, ceilingTriple: 2 }
    })()

    const legOutcomeKey = (leg) => [
      String(leg?.player || "").trim().toLowerCase(),
      String(leg?.marketKey || "").trim().toLowerCase(),
      String(leg?.side || "").trim().toLowerCase(),
      String(leg?.line ?? "")
    ].join("|")

    const legTicketSignal = (leg, legType) => {
      if (legType === "support") {
        const confidence = normalizeConfidence01(leg)
        const hitRate = getRowHitRate(leg)
        const edge = Math.max(0, Math.min(1, Math.abs(toFiniteNumber(getModelEdgeSignal(leg), 0)) * 10))
        return Math.max(0, Math.min(1, (confidence * 0.62) + (hitRate * 0.28) + (edge * 0.1)))
      }
      const confidence = normalizeConfidence01(leg)
      const ceilingIdx = computeNbaLongshotPredictiveIndex(leg)
      return Math.max(0, Math.min(1, (ceilingIdx * 0.72) + (confidence * 0.28)))
    }

    const buildLegReasoning = (leg) => {
      const fromCtx = Array.isArray(leg?.pregameContext?.explanationTags) ? leg.pregameContext.explanationTags : []
      if (fromCtx.length) {
        return Array.from(new Set(fromCtx.map((t) => String(t || "").trim()).filter(Boolean))).slice(0, 4)
      }

      const out = []
      const role = String(leg?.role || "").toLowerCase()
      const marketKey = String(leg?.marketKey || "").toLowerCase()
      const propType = String(leg?.propType || "").toLowerCase()
      const odds = Number(leg?.odds)
      const line = Number(leg?.line)
      const ceilingScore = toFiniteNumber(leg?.ceilingScore, null)
      const roleSpikeScore = toFiniteNumber(leg?.roleSpikeScore, null)
      const opportunitySpikeScore = toFiniteNumber(leg?.opportunitySpikeScore, null)
      const lineupContextScore = toFiniteNumber(leg?.lineupContextScore, null)
      const marketLagScore = toFiniteNumber(leg?.marketLagScore, null)
      const bookDisagreementScore = toFiniteNumber(leg?.bookDisagreementScore, null)
      const edgeGap = toFiniteNumber(getModelEdgeSignal(leg), null)
      const lpi = toFiniteNumber(leg?.longshotPredictiveIndex, null)
      const recent5 = toFiniteNumber(leg?.recent5Avg, null)
      const l10 = toFiniteNumber(leg?.l10Avg, null)
      const ref = Number.isFinite(recent5) ? recent5 : l10
      const isUnder = String(leg?.side || "").toLowerCase() === "under"

      if (role !== "support") {
        if (marketKey.includes("alternate") || propType.includes("ladder") || marketKey.includes("alt")) out.push("high-ceiling ladder/alt")
        if (Number.isFinite(odds) && odds >= 400) out.push("big payout band")
        if (Number.isFinite(lpi) && lpi >= 0.55) out.push("strong ceiling signal")
        else if (Number.isFinite(ceilingScore) && ceilingScore >= 0.68) out.push("high ceilingScore")
        if (Number.isFinite(roleSpikeScore) && roleSpikeScore >= 0.28) out.push("role/minutes spike signal")
        if (Number.isFinite(opportunitySpikeScore) && opportunitySpikeScore >= 0.35) out.push("opportunity spike")
        if (Number.isFinite(lineupContextScore) && lineupContextScore >= 0.28) out.push("lineup context boost")
        if (Number.isFinite(ref) && Number.isFinite(line) && line > 0) {
          if (!isUnder && ref >= line * 1.08) out.push("recent form over line")
          if (isUnder && ref <= line * 0.92) out.push("recent form under line")
        }
        if (Number.isFinite(marketLagScore) && marketLagScore >= 0.62) out.push("market lag signal")
        if (Number.isFinite(bookDisagreementScore) && bookDisagreementScore >= 0.35) out.push("book disagreement")
      } else {
        const confidence = normalizeConfidence01(leg)
        const hitRate = getRowHitRate(leg)
        if (confidence >= 0.58) out.push("high confidence")
        if (Number.isFinite(hitRate) && hitRate >= 0.55) out.push("high hit-rate")
        if (Number.isFinite(edgeGap) && edgeGap >= 0.03) out.push("positive model edge")
        if (Number.isFinite(odds) && odds <= 120 && odds >= -185) out.push("support-priced")
      }

      // Deduplicate + cap
      return Array.from(new Set(out)).slice(0, 4)
    }

    const buildTicketReasoningSummary = (ticketType, legs, meta) => {
      const safeLegs = Array.isArray(legs) ? legs : []
      const matchups = new Set(safeLegs.map((l) => String(l?.matchup || "").trim()).filter(Boolean))
      const books = new Set(safeLegs.map((l) => String(l?.book || "").trim()).filter(Boolean))
      const avg = toFiniteNumber(meta?.avgCeilingSignal, null)
      const min = toFiniteNumber(meta?.minLegSignal, null)
      const coherence = toFiniteNumber(meta?.coherence, null)
      const parts = []
      if (ticketType === "bombPair") parts.push("2 high-ceiling legs")
      if (ticketType === "bombSupport") parts.push("1 bomb + 1 support anchor")
      if (ticketType === "ceilingTriple") parts.push("3-leg ceiling stack")
      if (matchups.size >= 2) parts.push(`${matchups.size} games`)
      if (books.size === 1) parts.push("same-book executable")
      if (Number.isFinite(avg)) parts.push(`avgCeiling ${Number(avg).toFixed(2)}`)
      if (Number.isFinite(min)) parts.push(`minLeg ${Number(min).toFixed(2)}`)
      if (Number.isFinite(coherence)) parts.push(`coherence ${Number(coherence).toFixed(2)}`)
      const signalTags = []
      const seenTag = new Set()
      for (const l of safeLegs) {
        for (const t of Array.isArray(l?.pregameContext?.explanationTags) ? l.pregameContext.explanationTags : []) {
          const s = String(t || "").trim()
          if (!s) continue
          const k = s.toLowerCase()
          if (seenTag.has(k)) continue
          seenTag.add(k)
          signalTags.push(s)
          if (signalTags.length >= 2) break
        }
        if (signalTags.length >= 2) break
      }
      if (signalTags.length) parts.push(`signals: ${signalTags.join(", ")}`)
      return parts.slice(0, 5).join(" • ")
    }

    const buildBangerCandidate = (legs, ticketType) => {
      const safeLegs = (Array.isArray(legs) ? legs : []).filter(Boolean)
      if (safeLegs.length < 2) return null
      if (new Set(safeLegs.map((l) => String(l?.player || "").trim().toLowerCase()).filter(Boolean)).size !== safeLegs.length) return null
      if (new Set(safeLegs.map((l) => legOutcomeKey(l))).size !== safeLegs.length) return null

      // Prefer cross-game when slate allows, but don't force emptiness on thin slates.
      if (slateGames >= 3) {
        const matchups = new Set(safeLegs.map((l) => String(l?.matchup || "").trim().toLowerCase()).filter(Boolean))
        if (ticketType === "ceilingTriple" && matchups.size < Math.min(3, slateGames)) return null
        if (ticketType !== "ceilingTriple" && matchups.size < 2) return null
      }

      const base = buildTicketCandidate(legs, ticketType, { requireSameBook: true })
      if (!base) return null

      const legSignals = safeLegs.map((l) => {
        const type = ticketType === "bombSupport"
          ? (String(l?.role || "").toLowerCase() === "support" ? "support" : "bomb")
          : "bomb"
        return legTicketSignal(l, type)
      })
      const avgSignal = legSignals.reduce((a, b) => a + b, 0) / legSignals.length
      const minSignal = legSignals.length ? Math.min(...legSignals) : 0

      const matchups = safeLegs.map((l) => String(l?.matchup || "").trim().toLowerCase()).filter(Boolean)
      const teams = safeLegs.map((l) => String(l?.team || "").trim().toLowerCase()).filter(Boolean)
      const marketKeys = safeLegs.map((l) => String(l?.marketKey || "").trim().toLowerCase()).filter(Boolean)
      const propTypes = safeLegs.map((l) => String(l?.propType || "").trim().toLowerCase()).filter(Boolean)
      const uniqueMatchups = new Set(matchups)
      const uniqueTeams = new Set(teams)
      const uniquePropTypes = new Set(propTypes)

      let coherence = 1
      const sameMatchup = uniqueMatchups.size <= 1
      const sameTeam = uniqueTeams.size <= 1
      const altCount = marketKeys.filter((mk) => mk.includes("alternate") || mk.includes("alt")).length
      const altHeavy = altCount >= Math.max(1, Math.floor(safeLegs.length * 0.75))

      // Light coherence rules: avoid obvious over-correlation when avoidable.
      if (slateGames >= 3 && sameMatchup) coherence -= 0.22
      if (slateGames < 3 && sameMatchup) coherence -= 0.12
      if (sameTeam) coherence -= 0.12
      if (uniquePropTypes.size <= 1 && safeLegs.length >= 2) coherence -= 0.08
      if (altHeavy && safeLegs.length >= 2) coherence -= 0.06

      // Reward cross-game diversity when available.
      if (slateGames >= safeLegs.length && uniqueMatchups.size === safeLegs.length) coherence += 0.08
      if (uniquePropTypes.size >= Math.min(2, safeLegs.length)) coherence += 0.03

      coherence = Math.max(0, Math.min(1, coherence))
      const payoutDecimal = Number(base?.estimatedPayoutDecimal || 1)
      const payoutSignal = Math.max(0, Math.min(1, (payoutDecimal - 2.6) / 12))
      // Quality-first: prioritize ceiling signal + weakest-leg protection, with small payout + coherence.
      const ticketScore = Number(((avgSignal * 0.64) + (minSignal * 0.16) + (coherence * 0.12) + (payoutSignal * 0.08)).toFixed(4))
      const estimatedOddsAmerican = decimalToAmerican(payoutDecimal)

      return {
        ...base,
        ticketScore,
        estimatedOddsAmerican,
        ticketMeta: {
          slateMode,
          avgCeilingSignal: Number(avgSignal.toFixed(4)),
          minLegSignal: Number(minSignal.toFixed(4)),
          coherence: Number(coherence.toFixed(4)),
          uniqueMatchups: uniqueMatchups.size,
          uniqueTeams: uniqueTeams.size,
          uniquePropTypes: uniquePropTypes.size
        },
        legs: safeLegs.map((leg) => ({ ...leg, reasoning: buildLegReasoning(leg) })),
        ticketReasoningSummary: buildTicketReasoningSummary(ticketType, safeLegs, {
          avgCeilingSignal: Number(avgSignal.toFixed(4)),
          minLegSignal: Number(minSignal.toFixed(4)),
          coherence: Number(coherence.toFixed(4))
        })
      }
    }

    const bombRows = ticketBombPool.slice(0, 14)
    const supportRows = ticketSupportPool.slice(0, 12)

    const candidates = []

    // bombPair
    if (limits.bombPair > 0) {
      for (let i = 0; i < bombRows.length; i += 1) {
        for (let j = i + 1; j < bombRows.length; j += 1) {
          const ticket = buildBangerCandidate([
            buildTicketLeg(bombRows[i], "bomb"),
            buildTicketLeg(bombRows[j], "bomb")
          ], "bombPair")
          if (ticket) candidates.push(ticket)
        }
      }
    }

    // bombSupport
    if (limits.bombSupport > 0) {
      for (const bomb of bombRows.slice(0, 10)) {
        for (const support of supportRows.slice(0, 12)) {
          if (String(support?.book || "").trim() !== String(bomb?.book || "").trim()) continue
          const ticket = buildBangerCandidate([
            buildTicketLeg(bomb, "bomb"),
            buildTicketLeg(support, "support")
          ], "bombSupport")
          if (ticket) candidates.push(ticket)
        }
      }
    }

    // ceilingTriple (3 bombs/ceiling legs)
    if (limits.ceilingTriple > 0) {
      const triplePool = bombRows.slice(0, 12)
      const byBook = new Map()
      for (const row of triplePool) {
        const book = String(row?.book || "").trim()
        if (!book) continue
        if (!byBook.has(book)) byBook.set(book, [])
        byBook.get(book).push(row)
      }
      for (const rows of byBook.values()) {
        for (let i = 0; i < rows.length; i += 1) {
          for (let j = i + 1; j < rows.length; j += 1) {
            for (let k = j + 1; k < rows.length; k += 1) {
              const ticket = buildBangerCandidate([
                buildTicketLeg(rows[i], "bomb"),
                buildTicketLeg(rows[j], "bomb"),
                buildTicketLeg(rows[k], "bomb")
              ], "ceilingTriple")
              if (ticket) candidates.push(ticket)
            }
          }
        }
      }
    }

    const selected = selectLayeredTickets(candidates, Math.max(8, limits.total * 3), { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
    const caps = {
      bombPair: Math.max(0, Number(limits.bombPair || 0)),
      bombSupport: Math.max(0, Number(limits.bombSupport || 0)),
      ceilingTriple: Math.max(0, Number(limits.ceilingTriple || 0))
    }
    const usedByType = { bombPair: 0, bombSupport: 0, ceilingTriple: 0 }
    const out = []
    for (const t of selected) {
      if (out.length >= limits.total) break
      const type = String(t?.ticketType || "")
      if (!type) continue
      if (type in caps && usedByType[type] >= caps[type]) continue
      out.push(t)
      if (type in usedByType) usedByType[type] += 1
    }
    // If we couldn't fill due to type caps, relax caps but stay honest about quality.
    if (out.length < limits.total) {
      for (const t of selected) {
        if (out.length >= limits.total) break
        if (out.includes(t)) continue
        out.push(t)
      }
    }
    return out.slice(0, limits.total)
  }

  const buildFirstEventClusterTickets = () => {
    const candidates = []
    for (let i = 0; i < ticketFirstEventPool.length; i += 1) {
      for (let j = i + 1; j < ticketFirstEventPool.length; j += 1) {
        if (nbaLoadedSlateQualityPassEnabled) {
          const a = ticketFirstEventPool[i]
          const b = ticketFirstEventPool[j]
          const hasAnchorLeg = isFirstEventAnchorLeg(a) || isFirstEventAnchorLeg(b)
          if (!hasAnchorLeg) continue
        }
        const ticket = buildTicketCandidate([
          buildTicketLeg(ticketFirstEventPool[i], "firstEvent"),
          buildTicketLeg(ticketFirstEventPool[j], "firstEvent")
        ], "firstEventCluster", { requireSameBook: true })
        if (ticket) candidates.push(ticket)
      }
    }
    return selectLayeredTickets(candidates, 6, { maxPlayerUsesAfterFirst: 1, maxMatchupUsesAcrossSurfacedTickets: 2 })
  }

  const nbaRowQualityAudit = {
    loadedSlateQualityPassEnabled: nbaLoadedSlateQualityPassEnabled,
    liveRowsDetected: liveRowsForQualityMode.length,
    liveBooksDetected: liveBooksForQualityMode.size,
    snapshotSlateGameCount,
    slateMode: null,
    bottlenecks: {
      bestValueRowsBlockedByStrictGate: Math.max(0, curatedBestValueRaw.length - bestValueLaneQuality.strictCount),
      bestUpsideRowsBlockedByStrictGate: Math.max(0, curatedBestUpsideRaw.length - bestUpsideLaneQuality.strictCount),
      bombCandidatesBlockedByStrictGate: Math.max(0, ticketBombCandidates.length - ticketBombStrict.length),
      supportCandidatesBlockedByStrictGate: Math.max(0, ticketSupportCandidatesScored.length - ticketSupportStrict.length),
      firstEventCandidatesBlockedByStrictGate: Math.max(0, ticketFirstEventCandidates.length - ticketFirstEventStrict.length)
    },
    lanes: {
      bestValue: {
        rawCount: curatedBestValueRaw.length,
        strictEligibleCount: bestValueLaneQuality.strictCount,
        relaxedEligibleCount: bestValueLaneQuality.relaxedCount,
        finalCount: curatedBestValue.length,
        usedRelaxedFallback: bestValueLaneQuality.usedRelaxedFallback
      },
      bestUpside: {
        rawCount: curatedBestUpsideRaw.length,
        strictEligibleCount: bestUpsideLaneQuality.strictCount,
        relaxedEligibleCount: bestUpsideLaneQuality.relaxedCount,
        finalCount: curatedBestUpside.length,
        usedRelaxedFallback: bestUpsideLaneQuality.usedRelaxedFallback
      },
      bestLongshotPlays: {
        finalCount: layerBestLongshotPlays.length,
        explosionFeedCount: longshotExplosionFeed.length,
        snapshotPropCandidatesConsidered: snapshotPropsForLongshotExplosion.length
      },
      supportPool: {
        strictEligibleCount: ticketSupportStrict.length,
        relaxedEligibleCount: ticketSupportRelaxed.length,
        finalCount: ticketSupportPool.length
      }
    },
    tickets: {
      supportPool: {
        strictEligibleCount: ticketSupportStrict.length,
        relaxedEligibleCount: ticketSupportRelaxed.length,
        finalCount: ticketSupportPool.length
      },
      bombPool: {
        strictEligibleCount: ticketBombStrict.length,
        relaxedEligibleCount: ticketBombRelaxed.length,
        finalCount: ticketBombPool.length
      },
      firstEventPool: {
        strictEligibleCount: ticketFirstEventStrict.length,
        relaxedEligibleCount: ticketFirstEventRelaxed.length,
        finalCount: ticketFirstEventPool.length
      },
      buildableBooks: {
        bombPair: Array.from(buildableBombPairBooks).sort(),
        bombPlusSupport: Array.from(buildableBombPlusSupportBooks).sort(),
        firstEventCluster: Array.from(buildableFirstEventBooks).sort()
      }
    }
  }
  nbaRowQualityAudit.slateMode = detectSlateMode({
    sportKey: "nba",
    snapshotMeta: buildSnapshotMeta(),
    snapshot: currentSnapshot,
    runtime: {
      liveRowsDetected: liveRowsForQualityMode.length,
      liveBooksDetected: liveBooksForQualityMode.size,
      loadedSlateQualityPassEnabled: nbaLoadedSlateQualityPassEnabled
    }
  })

  const layeredSurfaced = {
    convictions: {
      bestPlayerConvictions: layeredConvictions
    },
    ladders: layeredLadders,
    boards: {
      bestValue: layerBestValue,
      bestUpside: layerBestUpside,
      bestLongshotPlays: layerBestLongshotPlays,
      bestLadders: layerBestLadders,
      bestFirstBasket: layerFirstBasket,
      bestFirstTeamBasket: layerFirstTeamBasket,
      bestDoubleDoubles: layerDoubleDoubles,
      bestTripleDoubles: layerTripleDoubles,
      bestSpecials: layerBestSpecials
    },
    tickets: {
      bestBombPairTickets: buildBombPairTickets(),
      bestBombPlusSupportTickets: buildBombPlusSupportTickets(),
      bestSafePairTickets: buildSafePairTickets(),
      bestFirstEventClusterTickets: buildFirstEventClusterTickets()
    },
    execution: {
      bestBookByPlay: [],
      bestBookByTicket: [],
      ticketBuildableBooks: ticketBuildableBooks
    },
    qualityAudit: nbaRowQualityAudit,
    recovery: {
      bestRecoveryPlay: [],
      bestRecoveryTicket: [],
      bestAnchorLeg: [],
      bestAnchorTicket: []
    }
  }

  const bestBangerTickets = buildBangerTickets()

  const nbaSurfacedLongshotTop = (Array.isArray(layerBestLongshotPlays) && layerBestLongshotPlays.length)
    ? layerBestLongshotPlays[0]
    : null
  const nbaSurfacedSafePairTickets = Array.isArray(layeredSurfaced?.tickets?.bestSafePairTickets)
    ? layeredSurfaced.tickets.bestSafePairTickets
    : []
  const nbaSurfacedSafePairTop = nbaSurfacedSafePairTickets[0] || null

  // === NBA OOMPH (superstarCeilingBoard): export-only mirror of longshot rows — no pools, no ladders, no ticket coupling.
  const superstarCeilingBoard = (() => {
    const raw = dedupeNbaRowsByLegSignature(
      filterAllowedNbaBookRows(Array.isArray(layerBestLongshotPlays) ? layerBestLongshotPlays : [])
    ).slice(0, 8)
    return raw.map((row) => {
      const teamOut = normalizeNbaExportTeamForRow(row) || row?.team || null
      const merged = { ...row, team: teamOut || row?.team }
      const ctx =
        merged.pregameContext && typeof merged.pregameContext === "object"
          ? merged.pregameContext
          : buildPregameContext({ sport: "nba", row: merged })
      const ce = Number(merged?.ceilingScore)
      const lpi = Number(merged?.longshotPredictiveIndex)
      return {
        player: merged.player ?? null,
        team: teamOut,
        book: merged.book ?? null,
        propType: merged.propType ?? null,
        side: merged.side ?? null,
        line: merged.line ?? null,
        odds: merged.odds ?? null,
        ceilingScore: Number.isFinite(ce) ? Number(ce.toFixed(3)) : null,
        longshotPredictiveIndex: Number.isFinite(lpi) ? Number(lpi.toFixed(3)) : null,
        pregameContext: ctx,
        explanationTags: Array.isArray(ctx?.explanationTags) ? [...ctx.explanationTags] : [],
        tags: ["oomph export mirror (longshot)"]
      }
    })
  })()

  // === MLB prediction board (Phase 3: sharper shaping + diversity) ===
  let teamResolutionDiagnostics = null
  let mlbDecisionBoardDiagnostics = null
  const mlbPredictionBoard = (() => {
    const rows = Array.isArray(mlbSnapshot?.rows) ? mlbSnapshot.rows : []
    if (!rows.length) return []

    const playerTeamIndex = buildPlayerTeamIndex(rows)

    const buildMlbPlayerEventTeamVote = (allRows) => {
      const tallies = new Map()
      for (const row of allRows) {
        const ev = String(row?.eventId || "").trim()
        const pl = String(row?.player || "").toLowerCase().trim()
        if (!ev || !pl) continue
        const key = `${ev}|${pl}`
        const candidates = [
          String(row?.team || "").trim(),
          inferSurfaceTeamLabel(row, playerTeamIndex),
          String(row?.teamResolved || "").trim(),
          resolveTeamNameForRowFromCode(row?.teamCode, row),
          resolveMlbTeamFromDiskCacheRow(row)
        ].filter((t) => t && String(t).trim())

        for (const t of candidates) {
          const label = String(t).trim()
          if (!tallies.has(key)) tallies.set(key, new Map())
          const m = tallies.get(key)
          m.set(label, (m.get(label) || 0) + 1)
        }
      }
      const winners = new Map()
      for (const [key, m] of tallies.entries()) {
        let bestLabel = null
        let bestCount = 0
        for (const [label, c] of m.entries()) {
          if (c > bestCount) {
            bestCount = c
            bestLabel = label
          }
        }
        if (bestLabel) winners.set(key, bestLabel)
      }
      return winners
    }

    const playerEventTeamVote = buildMlbPlayerEventTeamVote(rows)

    const normalizedMatchupTeams = (row) => {
      const parsed = parseMlbMatchupTeams(row?.matchup)
      const away = String(row?.awayTeam || parsed.away || "").trim()
      const home = String(row?.homeTeam || parsed.home || "").trim()
      return { away, home }
    }

    const teamTokensMatchEvent = (teamLabel, row) => {
      const t = String(teamLabel || "").trim()
      if (!t) return false
      const { away, home } = normalizedMatchupTeams(row)
      const awayTokens = getMlbTeamTokenSet(away)
      const homeTokens = getMlbTeamTokenSet(home)
      const teamTokens = getMlbTeamTokenSet(t)
      if (!awayTokens.size && !homeTokens.size) return false
      for (const tok of teamTokens) {
        if (awayTokens.has(tok) || homeTokens.has(tok)) return true
      }
      return false
    }

    const resolveMlbPredictionRowTeam = (row) => {
      const ev = String(row?.eventId || "").trim()
      const pl = String(row?.player || "").toLowerCase().trim()
      const voteKey = ev && pl ? `${ev}|${pl}` : null

      const candidateSources = [
        { source: "row.team", v: String(row?.team || "").trim(), confidence: 0.95, strong: true },
        { source: "inferSurfaceTeamLabel", v: inferSurfaceTeamLabel(row, playerTeamIndex), confidence: 0.75, strong: false },
        { source: "teamResolved", v: String(row?.teamResolved || "").trim(), confidence: 0.9, strong: true },
        { source: "teamCode", v: resolveTeamNameForRowFromCode(row?.teamCode, row), confidence: 0.85, strong: true },
        { source: "diskCache", v: resolveMlbTeamFromDiskCacheRow(row), confidence: 0.7, strong: true },
        { source: "playerEventVote", v: voteKey ? playerEventTeamVote.get(voteKey) : null, confidence: 0.55, strong: false }
      ]

      // Confidence rule: only assign a team if at least 2 independent sources
      // agree AND the team belongs to the event (away/home).
      const byTeam = new Map() // teamLc -> { teamLabel, hits, maxConf, sources:Set, strongHit }
      for (const c of candidateSources) {
        const team = String(c?.v || "").trim()
        if (!team) continue
        if (!teamTokensMatchEvent(team, row)) continue
        const key = team.toLowerCase()
        const cur = byTeam.get(key) || { teamLabel: team, hits: 0, maxConf: 0, sources: new Set(), strongHit: false }
        cur.hits += 1
        cur.maxConf = Math.max(cur.maxConf, Number(c.confidence) || 0)
        cur.sources.add(c.source)
        if (c.strong) cur.strongHit = true
        byTeam.set(key, cur)
      }

      let best = null
      for (const v of byTeam.values()) {
        // If we have corroboration, take it.
        if (v.hits >= 2 && v.strongHit) {
          if (!best) best = v
          else if (v.hits > best.hits) best = v
          else if (v.hits === best.hits && v.maxConf > best.maxConf) best = v
          continue
        }
        // Otherwise allow a single strong, event-consistent source (disk/teamCode/teamResolved/row.team).
        if (v.hits === 1 && v.strongHit && v.maxConf >= 0.7) {
          if (!best) best = v
          else if (v.maxConf > best.maxConf) best = v
        }
      }

      if (best) {
        return {
          team: best.teamLabel,
          teamConfidence: clamp(Number(best.maxConf || 0.7), 0.7, 0.98),
          teamSource: `multi:${Array.from(best.sources).sort().join("+")}`
        }
      }

      // Safe fallback: when we can’t map player→side, at least surface the matchup teams
      // (explicitly ambiguous) instead of inventing a single club.
      const { away, home } = normalizedMatchupTeams(row)
      if (away && home) {
        return {
          team: `${away} / ${home}`,
          teamConfidence: 0.15,
          teamSource: "matchup-ambiguous"
        }
      }

      return { team: null, teamConfidence: 0, teamSource: "unresolved" }
    }

    const classifyBoardPropFamily = (row) => {
      const mk = String(row?.marketKey || "").toLowerCase()
      const pt = String(row?.propType || "").toLowerCase()

      if (mk.includes("first_home_run") || pt.includes("first home run")) return "first_hr"
      if (mk.includes("home_run") || mk.includes("home_runs") || mk.includes("to_hit_home_run") || pt.includes("home run")) {
        return "hr"
      }
      if (mk.includes("stolen_bases") || pt.includes("stolen bases")) return "stolen_bases"
      if (mk.includes("pitcher_strikeouts") || pt === "strikeouts") return "pitcher_k"
      if (mk.includes("pitcher_outs") || pt === "outs") return "pitcher_outs"
      if (mk.includes("pitcher_earned_runs") || pt === "earned runs") return "pitcher_er"
      if (mk.includes("pitcher_walks") || pt === "walks") return "pitcher_walks"
      if (mk.includes("total_bases") || pt.includes("total bases")) return "tb"
      if (mk.includes("hits") || pt.includes("hits")) return "hits"
      if (mk.includes("rbi") || pt.includes("rbi")) return "rbi"
      if (mk.includes("runs") || pt.includes("runs")) return "runs"
      return "other"
    }

    const getMlbMarketImpactScore = (row) => {
      const fam = classifyBoardPropFamily(row)
      const line = toNumberOrNull(row?.line)
      const odds = toNumberOrNull(row?.odds)

      if (fam === "first_hr") return 0.98
      if (fam === "hr") {
        // Keep HR high-impact, but avoid a flat near-constant that compresses decisionScore.
        // Use odds/line to introduce natural variability (shorter HR odds = higher impact).
        let s = 0.9
        if (Number.isFinite(line) && line <= 0.5) s += 0.03
        if (Number.isFinite(odds)) {
          if (odds >= 250 && odds <= 550) s += 0.04
          else if (odds > 550 && odds <= 850) s += 0.02
          else if (odds > 850) s += 0.0
          else if (odds < 250) s += 0.02
        }
        return clamp(Number(s.toFixed(4)), 0.88, 0.96)
      }
      if (fam === "tb") {
        let s = 0.72
        if (Number.isFinite(line) && line >= 2.5) s = 0.85
        else if (Number.isFinite(line) && line >= 1.5) s = 0.8
        if (Number.isFinite(odds) && odds >= 450) s = Math.min(0.85, s + 0.03)
        return clamp(Number(s.toFixed(4)), 0.7, 0.85)
      }
      if (fam === "rbi") return clamp(0.68, 0.6, 0.75)
      if (fam === "runs") return clamp(0.64, 0.58, 0.72)
      if (fam === "hits") {
        let s = 0.58
        if (Number.isFinite(line) && line <= 0.5) s = 0.52
        return clamp(Number(s.toFixed(4)), 0.5, 0.65)
      }
      return 0.5
    }

    const getMlbPlayType = (row, fam) => {
      const odds = toNumberOrNull(row?.odds)
      if (fam === "hr" || fam === "first_hr") return "boom"
      if (fam === "tb" && Number.isFinite(odds) && odds >= 350) return "boom"
      if (fam === "stolen_bases") return "boom"
      if (fam === "pitcher_k" || fam === "pitcher_outs") return "safe"
      if (fam === "pitcher_er" || fam === "pitcher_walks") return "value"
      if (fam === "hits") return "safe"
      return "value"
    }

    const computeMlbDecisionScore = (edgeProbability, signalScore, marketImpactScore) => {
      // Preserve the decisionScore framework, but reduce compression:
      // - stretch edge/signal (non-linear)
      // - reduce the absolute “offset” contributed by marketImpactScore by centering it
      const edge = Number.isFinite(edgeProbability) ? edgeProbability : 0
      const sig = Number.isFinite(signalScore) ? signalScore : 0
      const mi = Number.isFinite(marketImpactScore) ? marketImpactScore : 0

      const edgeNorm = clamp(edge / 0.22, 0, 1) // typical MLB edge ranges fit here
      const sigNorm = clamp(sig, 0, 1)
      const miCentered = clamp(mi - 0.5, 0, 0.5) // 0..0.5 instead of 0.5..1.0

      // Slightly stronger stretching to widen top-10 separation.
      const edgeAdj = Math.pow(edgeNorm, 1.55)
      const sigAdj = Math.pow(sigNorm, 1.55)

      const score = edgeAdj * 0.58 + sigAdj * 0.34 + miCentered * 0.08
      return Number(score.toFixed(6))
    }

    const cmpDecisionBoardRows = (a, b) => {
      const dA = Number.isFinite(a?.decisionScore) ? a.decisionScore : -999
      const dB = Number.isFinite(b?.decisionScore) ? b.decisionScore : -999
      if (dB !== dA) return dB - dA
      const eA = Number.isFinite(a?.edgeProbability) ? a.edgeProbability : -999
      const eB = Number.isFinite(b?.edgeProbability) ? b.edgeProbability : -999
      if (eB !== eA) return eB - eA
      const sA = Number.isFinite(a?.signalScore) ? a.signalScore : -999
      const sB = Number.isFinite(b?.signalScore) ? b.signalScore : -999
      if (sB !== sA) return sB - sA
      const oA = Number.isFinite(Number(a?.odds)) ? Number(a.odds) : -999
      const oB = Number.isFinite(Number(b?.odds)) ? Number(b.odds) : -999
      return oB - oA
    }

    const isBoardCandidateRow = (row) => {
      if (!row) return false
      if (!String(row?.player || "").trim()) return false
      if (!String(row?.propType || "").trim()) return false
      if (row?.odds == null) return false

      const side = String(row?.side || "").trim().toLowerCase()
      if (!(side === "over" || side === "yes")) return false

      const family = classifyBoardPropFamily(row)
      return family !== "other"
    }

    const toRoundedLineKey = (line) => {
      const n = toNumberOrNull(line)
      if (!Number.isFinite(n)) return "na"
      return String(Number(n.toFixed(2)))
    }

    const rowQualityPenalty = (row) => {
      const mk = String(row?.marketKey || "").toLowerCase()
      const line = toNumberOrNull(row?.line)
      const dispersion = toNumberOrNull(row?.bookImpliedDispersion)
      const vsConsensus = Math.abs(toNumberOrNull(row?.bookVsConsensusDelta) || 0)

      let penalty = 0
      // Low-information / mushy shapes (common source of repetitive "looks good" rows)
      if ((mk.includes("batter_hits") || mk.includes("player_hits")) && Number.isFinite(line) && line <= 0.5) penalty += 0.12
      if ((mk.includes("batter_rbis") || mk.includes("player_rbis") || mk.includes("batter_rbi")) && Number.isFinite(line) && line <= 0.5) {
        penalty += 0.08
      }
      if ((mk.includes("runs") || mk.includes("runs_scored")) && Number.isFinite(line) && line <= 0.5) penalty += 0.08

      // If books basically agree, don't let tiny arithmetic gaps dominate the board.
      if (Number.isFinite(dispersion) && dispersion < 0.004 && vsConsensus < 0.006) penalty += 0.06

      return penalty
    }

    const marketPreferenceScore = (row) => {
      const family = classifyBoardPropFamily(row)
      const mk = String(row?.marketKey || "").toLowerCase()
      const line = toNumberOrNull(row?.line)
      const edge = toNumberOrNull(row?.edgeProbability) || 0
      const dispersion = toNumberOrNull(row?.bookImpliedDispersion) || 0

      // Base preference: prioritize true HR markets, then TB, then counting overs.
      const base =
        family === "hr" ? 0.95 :
        family === "first_hr" ? 0.78 :
        family === "tb" ? 0.62 :
        family === "hits" ? 0.52 :
        family === "rbi" ? 0.50 :
        family === "runs" ? 0.48 :
        0.40

      // TB spam control: TB is great, but it shouldn't drown the board unless it's clearly special.
      let tbAdjust = 0
      if (family === "tb") {
        const meaningfulLine = Number.isFinite(line) && line >= 1.5
        const strongEdge = edge >= 0.06
        const disagree = dispersion >= 0.01
        tbAdjust -= meaningfulLine ? 0 : 0.10
        tbAdjust += strongEdge ? 0.06 : 0
        tbAdjust += disagree ? 0.04 : 0
      }

      // HR yes/no thresholding: tiny HR thresholds are more actionable than generic TB ladders at similar edges.
      let hrAdjust = 0
      if (family === "hr" && Number.isFinite(line) && line <= 0.5) hrAdjust += 0.05

      // Slight preference for primary-ish markets vs obvious alt ladders when everything else is close.
      const altish = mk.includes("alternate") || mk.includes("_alternate") || mk.endsWith("_alt")
      const ladderish = String(row?.marketFamily || "").toLowerCase() === "ladder"
      const altPenalty = (altish || ladderish) ? 0.04 : 0

      return base + tbAdjust + hrAdjust - altPenalty - rowQualityPenalty(row)
    }

    const compositeRankScore = (row) => {
      const edge = toNumberOrNull(row?.edgeProbability) || 0
      const sig = toNumberOrNull(row?.signalScore) || 0
      const mp = marketPreferenceScore(row)
      // Tie-breakers are handled later; this is the scalar sort key for dedupe "best of group".
      return (edge * 1.0) + (sig * 0.35) + (mp * 0.08)
    }

    const buildMlbMatchupContext = (row, resolvedTeamLabel) => {
      const opposingTeamFromRow = String(row?.opponentTeam || "").trim() || null
      const opposingPitcherFromRow = String(row?.opposingPitcher || "").trim() || null
      const pitcherHandFromRow = String(row?.pitcherHand || "").trim().toUpperCase()
      const batterHandFromRow = String(row?.batterHand || "").trim().toUpperCase()
      const pitcherHand =
        pitcherHandFromRow === "L" || pitcherHandFromRow === "R" ? pitcherHandFromRow : null
      const batterHand =
        batterHandFromRow === "L" || batterHandFromRow === "R" ? batterHandFromRow : null
      if (opposingTeamFromRow) {
        return {
          opposingTeam: opposingTeamFromRow,
          opposingPitcher: opposingPitcherFromRow,
          pitcherHand,
          batterHand,
          pitcherKRate: null,
          pitcherHRRate: null,
          pitcherWalkRate: null
        }
      }

      const { away, home } = normalizedMatchupTeams(row)
      const resolved = String(resolvedTeamLabel || "").trim()
      let opposingTeam = null
      if (resolved && away && home) {
        const resolvedTokens = getMlbTeamTokenSet(resolved)
        const awayTokens = getMlbTeamTokenSet(away)
        const homeTokens = getMlbTeamTokenSet(home)
        let matchesAway = false
        let matchesHome = false
        for (const tok of resolvedTokens) {
          if (awayTokens.has(tok)) matchesAway = true
          if (homeTokens.has(tok)) matchesHome = true
        }
        if (matchesAway && !matchesHome) opposingTeam = home
        else if (matchesHome && !matchesAway) opposingTeam = away
      }

      if (!opposingTeam && away && home) {
        // When the batter's team can't be disambiguated, still surface the matchup context
        // (so consumers always have something stable to render/use).
        opposingTeam = `${away} / ${home}`
      }

      return {
        opposingTeam,
        opposingPitcher: opposingPitcherFromRow,
        pitcherHand,
        batterHand,
        pitcherKRate: null,
        pitcherHRRate: null,
        pitcherWalkRate: null
      }
    }

    teamResolutionDiagnostics = {
      confidentlyResolved: 0,
      ambiguousPrevented: 0,
      placeholderUsed: 0,
      matchupAmbiguousLabelUsed: 0
    }

    const candidates = rows
      .filter((row) => isBoardCandidateRow(row))
      .map((row) => {
        // Source-level invalid row guard: never admit poison rows into the board.
        // (Keep final sanitize too, but prevent bad rows from being created/appended.)
        if (row?.propType === 0 || String(row?.propType || "").trim() === "0") return null
        if (row?.team === 0 || String(row?.team || "").trim() === "0") return null
        if (row?.odds === 0 || (Number.isFinite(Number(row?.odds)) && Number(row.odds) === 0)) return null
        if (row?.line === 0 || (Number.isFinite(Number(row?.line)) && Number(row.line) === 0)) return null

        const impliedProbability =
          row?.impliedProbability != null ? Number(row.impliedProbability) : null
        const predictedProbability =
          row?.predictedProbability != null ? Number(row.predictedProbability) : null
        const edgeProbability =
          row?.edgeProbability != null ? Number(row.edgeProbability) : null
        const signalScore =
          row?.signalScore != null ? Number(row.signalScore) : null
        const signalStrengthTag =
          row?.signalStrengthTag != null ? String(row.signalStrengthTag) : null

        const fam = classifyBoardPropFamily(row)
        const teamRes = resolveMlbPredictionRowTeam(row)
        const matchup = buildMlbMatchupContext(row, teamRes.team)

        const currentOdds = Number(row?.odds)
        const sideKey = String(row?.side || row?.__side || "").trim().toLowerCase()
        const bookKey = String(row?.book || "").trim()
        const legKey = [
          String(row?.eventId || ""),
          String(row?.player || "").toLowerCase().trim(),
          String(row?.marketKey || row?.propType || "").toLowerCase().trim(),
          String(row?.line ?? ""),
          sideKey,
          bookKey
        ].join("|")
        let openingOdds = null
        if (legKey && Number.isFinite(currentOdds) && currentOdds != 0) {
          if (!mlbOpeningOddsByLegKey.has(legKey)) mlbOpeningOddsByLegKey.set(legKey, currentOdds)
          openingOdds = mlbOpeningOddsByLegKey.get(legKey) ?? null
        }
        const lineMovement =
          Number.isFinite(currentOdds) && Number.isFinite(Number(openingOdds))
            ? Number((currentOdds - Number(openingOdds)).toFixed(0))
            : null
        const isSteamMove = Number.isFinite(lineMovement) ? Math.abs(lineMovement) > 20 : null
        const movementDirection =
          Number.isFinite(lineMovement)
            ? (lineMovement > 0 ? "up" : lineMovement < 0 ? "down" : "flat")
            : null

        const gameTotal = row?.gameTotal ?? null
        const impliedTeamTotal = row?.impliedTeamTotal ?? null
        const parkFactor = row?.parkFactor ?? null
        const lineupPosition =
          Number(row?.lineupPosition) ||
          Number(row?.battingOrderIndex) ||
          null

        if (lineupPosition === 0) {
          console.log("[FINAL LINEUP CHECK]", {
            player: row?.player,
            raw: row?.lineupPosition,
            battingIndex: row?.battingOrderIndex,
            final: lineupPosition
          })
        }
        if (teamRes.team) {
          if (String(teamRes.teamSource) === "matchup-ambiguous") teamResolutionDiagnostics.matchupAmbiguousLabelUsed += 1
          else if (Number(teamRes.teamConfidence) >= 0.7) teamResolutionDiagnostics.confidentlyResolved += 1
        } else {
          teamResolutionDiagnostics.ambiguousPrevented += 1
        }
        const marketImpactScore = getMlbMarketImpactScore(row)
        const playType = getMlbPlayType(row, fam)
        const decisionScore = computeMlbDecisionScore(
          Number.isFinite(edgeProbability) ? edgeProbability : null,
          Number.isFinite(signalScore) ? signalScore : null,
          marketImpactScore
        )

        const pitcherHand = matchup?.pitcherHand ? String(matchup.pitcherHand).toUpperCase() : null
        const batterHand = matchup?.batterHand ? String(matchup.batterHand).toUpperCase() : null
        const isPlatoonAdvantage = pitcherHand && batterHand ? batterHand !== pitcherHand : null
        const isSameHand = pitcherHand && batterHand ? batterHand === pitcherHand : null

        return {
          __src: row,
          player: row?.player || null,
          team: teamRes.team,
          teamConfidence: teamRes.teamConfidence,
          teamSource: teamRes.teamSource,
          matchup,
          isPlatoonAdvantage,
          isSameHand,
          openingOdds,
          lineMovement,
          isSteamMove,
          movementDirection,
          gameTotal,
          impliedTeamTotal,
          parkFactor,
          lineupPosition,
          propType: row?.propType || null,
          marketKey: row?.marketKey || null,
          line: row?.line ?? null,
          odds: row?.odds ?? null,
          predictedProbability: Number.isFinite(predictedProbability) ? predictedProbability : null,
          impliedProbability: Number.isFinite(impliedProbability) ? impliedProbability : null,
          edgeProbability: Number.isFinite(edgeProbability) ? edgeProbability : null,
          signalScore: Number.isFinite(signalScore) ? signalScore : null,
          signalStrengthTag: signalStrengthTag || "neutral",
          marketImpactScore,
          decisionScore,
          playType,
          __family: fam,
          __rank: compositeRankScore(row)
        }
      })
      .filter((row) => row && row.player && row.propType && row.odds != null)

    // Dedupe: keep strongest row per player within the same surfaced prop family.
    // (Prevents alt-line / ladder spam within TB/Hits/etc before family-capped board selection.)
    const dedupMap = new Map()
    for (const row of candidates) {
      const side = String(row?.__src?.side || "").trim().toLowerCase()
      const fam = row.__family || "other"
      const key = [
        String(row.player || "").toLowerCase(),
        fam,
        side
      ].join("|")

      const prev = dedupMap.get(key)
      if (!prev || cmpDecisionBoardRows(prev, row) > 0) dedupMap.set(key, row)
    }
    const deduped = [...dedupMap.values()]

    const cmpBoardRows = cmpDecisionBoardRows

    // Global ranking + soft per-family caps + one surfaced pick per player per prop family.
    const target = 60
    const caps = {
      // TB is often the densest ladder lane; keep it represented without crowding out HR/counting markets.
      tb: 14,
      hits: 16,
      rbi: 14,
      runs: 14,
      hr: 14,
      first_hr: 8,
      other: 6
    }

    const ranked = deduped.sort(cmpBoardRows)

    const buildBoard = (ignoreCaps = false) => {
      const out = []
      const used = new Set()
      const counts = {}

      const capFor = (fam) => (ignoreCaps ? Infinity : (caps[fam] ?? caps.other))

      for (const row of ranked) {
        if (out.length >= target) break
        const fam = row.__family || "other"
        if (counts[fam] == null) counts[fam] = 0
        if (!ignoreCaps && counts[fam] >= capFor(fam)) continue

        const playerKey = String(row.player || "").toLowerCase()
        if (!playerKey) continue
        // One surfaced pick per player per prop family (prevents TB spam duplicates),
        // while still allowing the same player to appear across HR/TB/Hits/etc when warranted.
        const slotKey = `p:${playerKey}:fam:${fam}`
        if (used.has(slotKey)) continue

        used.add(slotKey)
        counts[fam] += 1
        out.push(row)
      }

      return out
    }

    let finalBoard = buildBoard(false)
    if (finalBoard.length < target) {
      finalBoard = buildBoard(true)
    }

    // If HRs exist but get crowded out by near-tie counting markets, swap a few tail rows in
    // the most over-represented families for close HR edges (no new data; board shaping only).
    const enrichUnderrepresentedHr = (board) => {
      if (!Array.isArray(board) || board.length < 10) return board

      const famCounts = {}
      for (const row of board) {
        const fam = row?.__family || "other"
        famCounts[fam] = (famCounts[fam] || 0) + 1
      }

      const hrPool = ranked.filter((r) => r.__family === "hr")
      if (!hrPool.length) return board

      const minHrWant = Math.min(6, hrPool.length, board.length)
      if ((famCounts.hr || 0) >= minHrWant) return board

      const donorOrder = ["tb", "hits", "rbi", "runs", "first_hr", "other"]
      const edgeDelta = 0.028

      const usedSlots = new Set(
        board.map((row) => {
          const fam = row?.__family || "other"
          const playerKey = String(row.player || "").toLowerCase()
          return `p:${playerKey}:fam:${fam}`
        })
      )

      const victimScore = (row) => (Number.isFinite(row?.decisionScore) ? row.decisionScore : -999)

      const nextHrCandidate = (victimEdge) => {
        for (const hrRow of hrPool) {
          const playerKey = String(hrRow.player || "").toLowerCase()
          if (!playerKey) continue
          const slotKey = `p:${playerKey}:fam:hr`
          if (usedSlots.has(slotKey)) continue

          const hrEdge = Number.isFinite(hrRow.edgeProbability) ? hrRow.edgeProbability : -999
          if (!Number.isFinite(victimEdge) || !Number.isFinite(hrEdge)) continue
          if (hrEdge < victimEdge - edgeDelta) continue

          return { hrRow, slotKey }
        }
        return null
      }

      const boardOut = [...board]
      let hrCount = famCounts.hr || 0

      for (const donorFam of donorOrder) {
        while (hrCount < minHrWant) {
          const donorIdx = boardOut
            .map((row, idx) => ({ row, idx }))
            .filter(({ row }) => (row?.__family || "other") === donorFam)
            .sort((a, b) => victimScore(a.row) - victimScore(b.row))[0]?.idx

          if (donorIdx == null) break

          const victim = boardOut[donorIdx]
          const victimEdge = Number.isFinite(victim?.edgeProbability) ? victim.edgeProbability : -999
          const pick = nextHrCandidate(victimEdge)
          if (!pick) break

          const donorFamOld = victim?.__family || "other"
          const donorPlayerKey = String(victim.player || "").toLowerCase()
          usedSlots.delete(`p:${donorPlayerKey}:fam:${donorFamOld}`)
          boardOut[donorIdx] = pick.hrRow
          usedSlots.add(pick.slotKey)
          hrCount += 1
        }
        if (hrCount >= minHrWant) break
      }

      return boardOut.sort(cmpBoardRows)
    }

    finalBoard = enrichUnderrepresentedHr(finalBoard)

    // Top-window power mix: allow HR/TB into the first rows when they are legitimately close on edge/signal
    // to counting overs, without re-ranking the full board or breaking per-player top-10 uniqueness.
    const shapeTopWindowForPowerMix = (board, windowSize = 10) => {
      if (!Array.isArray(board) || board.length <= windowSize) return board

      const countingFamilies = new Set(["hits", "rbi", "runs"])
      const tbFamily = new Set(["tb"])

      const rowMerit = (row) => (Number.isFinite(row?.decisionScore) ? row.decisionScore : -999)

      const isClosePowerVsVictim = (champ, victim, wantFam, edgeTol, sigTol) => {
        const eC = Number(champ?.edgeProbability)
        const eV = Number(victim?.edgeProbability)
        const sC = Number(champ?.signalScore)
        const sV = Number(victim?.signalScore)
        if (!Number.isFinite(eC) || !Number.isFinite(eV)) return false
        // HR vs TB: edges often line up while TB proxy signal runs hotter — trust edge-first closeness.
        if (wantFam === "hr" && victim?.__family === "tb") {
          if (!Number.isFinite(sC) || !Number.isFinite(sV)) return eC >= eV - edgeTol
          return eC >= eV - Math.max(edgeTol, 0.048) && sC >= sV - 0.34
        }
        if (!Number.isFinite(sC) || !Number.isFinite(sV)) return eC >= eV - edgeTol
        return eC >= eV - edgeTol && sC >= sV - sigTol
      }

      const tryPromoteFamily = (out, wantFam, { victimFamilies, edgeTol, sigTol }) => {
        if (out.slice(0, windowSize).some((r) => r.__family === wantFam)) return false

        let victimIdx = -1
        let victimMerit = Infinity
        for (let i = 0; i < windowSize; i++) {
          if (!victimFamilies.has(out[i]?.__family)) continue
          const m = rowMerit(out[i])
          if (m < victimMerit) {
            victimMerit = m
            victimIdx = i
          }
        }
        if (victimIdx < 0) return false

        const victim = out[victimIdx]
        const windowPlayers = new Set()
        for (let j = 0; j < windowSize; j++) {
          if (j === victimIdx) continue
          const pk = String(out[j]?.player || "").toLowerCase().trim()
          if (pk) windowPlayers.add(pk)
        }

        let bestIdx = -1
        let bestMerit = -Infinity
        for (let i = windowSize; i < out.length; i++) {
          if (out[i]?.__family !== wantFam) continue
          const pk = String(out[i]?.player || "").toLowerCase().trim()
          if (!pk || windowPlayers.has(pk)) continue
          if (!isClosePowerVsVictim(out[i], victim, wantFam, edgeTol, sigTol)) continue
          const m = rowMerit(out[i])
          if (m > bestMerit) {
            bestMerit = m
            bestIdx = i
          }
        }
        if (bestIdx < 0) return false

        const tmp = out[victimIdx]
        out[victimIdx] = out[bestIdx]
        out[bestIdx] = tmp
        return true
      }

      const out = [...board]

      // TB: tight closeness vs counting overs
      tryPromoteFamily(out, "tb", {
        victimFamilies: countingFamilies,
        edgeTol: 0.028,
        sigTol: 0.09
      })

      // HR: first pass vs counting
      tryPromoteFamily(out, "hr", {
        victimFamilies: countingFamilies,
        edgeTol: 0.03,
        sigTol: 0.095
      })

      // HR: second pass — allow bumping a weaker TB slot if HR is still missing from the window
      if (!out.slice(0, windowSize).some((r) => r.__family === "hr")) {
        tryPromoteFamily(out, "hr", {
          victimFamilies: new Set([...countingFamilies, ...tbFamily]),
          edgeTol: 0.045,
          sigTol: 0.11
        })
      }

      // Same-player TB -> HR in the window: HR signal runs colder than TB; edge closeness is the honest lever.
      if (!out.slice(0, windowSize).some((r) => r.__family === "hr")) {
        const tbIdx = out.slice(0, windowSize).findIndex((r) => r?.__family === "tb")
        if (tbIdx >= 0) {
          const victim = out[tbIdx]
          const pk = String(victim?.player || "").toLowerCase().trim()
          if (pk) {
            let hrIdx = -1
            for (let i = windowSize; i < out.length; i++) {
              if (out[i]?.__family !== "hr") continue
              if (String(out[i]?.player || "").toLowerCase().trim() !== pk) continue
              hrIdx = i
              break
            }
            if (hrIdx >= 0) {
              const champ = out[hrIdx]
              const eC = Number(champ?.edgeProbability)
              const eV = Number(victim?.edgeProbability)
              if (Number.isFinite(eC) && Number.isFinite(eV) && eC >= eV - 0.055) {
                const tmp = out[tbIdx]
                out[tbIdx] = out[hrIdx]
                out[hrIdx] = tmp
              }
            }
          }
        }
      }

      // Competitive power floor in top-10: keep 1–3 HR/TB rows when their edge is within ~0.05 of the window leader.
      {
        const power = new Set(["hr", "tb"])
        const countingOnly = new Set(["hits", "rbi", "runs"])
        const edgeTol = 0.05

        const powerCount = () => out.slice(0, windowSize).filter((r) => power.has(r?.__family)).length
        const refEdge = () => Math.max(0, ...out.slice(0, windowSize).map((r) => Number(r?.edgeProbability) || 0))

        const pickVictimIdx = (victimFamilies) => {
          let victimIdx = -1
          let worstD = Infinity
          for (let i = 0; i < windowSize; i++) {
            if (!victimFamilies.has(out[i]?.__family)) continue
            const d = Number(out[i]?.decisionScore) || 0
            if (d < worstD) {
              worstD = d
              victimIdx = i
            }
          }
          return victimIdx
        }

        const tryPowerSwap = (victimFamilies) => {
          const topRef = refEdge()
          const victimIdx = pickVictimIdx(victimFamilies)
          if (victimIdx < 0) return false

          const windowPlayers = new Set()
          for (let j = 0; j < windowSize; j++) {
            if (j === victimIdx) continue
            const pk = String(out[j]?.player || "").toLowerCase().trim()
            if (pk) windowPlayers.add(pk)
          }

          let bestIdx = -1
          let bestD = -Infinity
          for (let i = windowSize; i < out.length; i++) {
            if (!power.has(out[i]?.__family)) continue
            const pk = String(out[i]?.player || "").toLowerCase().trim()
            if (!pk || windowPlayers.has(pk)) continue
            const e = Number(out[i]?.edgeProbability)
            if (!Number.isFinite(e) || e < topRef - edgeTol) continue
            const d = Number(out[i]?.decisionScore) || 0
            if (d > bestD) {
              bestD = d
              bestIdx = i
            }
          }
          if (bestIdx < 0) return false

          const tmp = out[victimIdx]
          out[victimIdx] = out[bestIdx]
          out[bestIdx] = tmp
          return true
        }

        while (powerCount() < 1) {
          const victimFamilies = new Set([...countingFamilies, ...tbFamily])
          if (!tryPowerSwap(victimFamilies)) break
        }
        while (powerCount() < 3) {
          if (!tryPowerSwap(countingOnly)) break
        }
      }

      const head = out.slice(0, windowSize).sort(cmpBoardRows)
      return head.concat(out.slice(windowSize))
    }

    // Prevent a single player from occupying multiple top slots.
    // (Duplicates can still exist lower, but top-10 should read like decisions, not variants.)
    const enforceUniquePlayersInTopWindow = (board, windowSize = 10) => {
      const out = [...board]
      const seen = new Map() // playerLc -> keptIdx
      for (let i = 0; i < Math.min(windowSize, out.length); i++) {
        const p = String(out[i]?.player || "").toLowerCase().trim()
        if (!p) continue
        if (!seen.has(p)) {
          seen.set(p, i)
          continue
        }
        // Duplicate detected: try to swap with the next unique row.
        let j = i + 1
        while (j < out.length) {
          const pj = String(out[j]?.player || "").toLowerCase().trim()
          if (pj && !seen.has(pj)) break
          j++
        }
        if (j < out.length) {
          const tmp = out[i]
          out[i] = out[j]
          out[j] = tmp
          const pNew = String(out[i]?.player || "").toLowerCase().trim()
          if (pNew) seen.set(pNew, i)
        }
      }
      const head = out.slice(0, windowSize).sort(cmpBoardRows)
      return head.concat(out.slice(windowSize))
    }

    const applyMlbTop10Policy = (board, windowSize = 10) => {
      const policy = {
        windowSize,
        // Soft caps: enforced via swaps, with dominance exceptions.
        maxByFamily: { hr: 5, first_hr: 2, hits: 5, tb: 4 },
        // Soft targets for play type balance (min/max).
        playTypeTarget: { boom: { min: 2, max: 5 }, safe: { min: 2, max: 6 }, value: { min: 1, max: 7 } },
        // Swap tolerances (edge-first, then decisionScore).
        edgeTolFromBest: 0.06,
        decisionDegradeMax: 0.035,
        balanceEdgeTolFromBest: 0.09,
        balanceDecisionDegradeMax: 0.06,
        // “Dominant” rows are allowed to bust caps.
        dominance: { edgeDelta: 0.015, decisionDelta: 0.01 }
      }

      const out = [...board]
      if (out.length <= policy.windowSize) return out

      const head = () => out.slice(0, policy.windowSize)
      const tail = () => out.slice(policy.windowSize)
      const bestEdge = () => Math.max(...head().map((r) => (Number.isFinite(r?.edgeProbability) ? r.edgeProbability : -999)))
      const bestDecision = () => Math.max(...head().map((r) => (Number.isFinite(r?.decisionScore) ? r.decisionScore : -999)))

      const countBy = (fn) =>
        head().reduce((acc, r) => {
          const k = fn(r)
          acc[k] = Number(acc[k] || 0) + 1
          return acc
        }, {})

      const playerSetInHead = (skipIdx = -1) => {
        const s = new Set()
        for (let i = 0; i < policy.windowSize; i++) {
          if (i === skipIdx) continue
          const pk = String(out[i]?.player || "").toLowerCase().trim()
          if (pk) s.add(pk)
        }
        return s
      }

      const isDominant = (row) => {
        const e = Number.isFinite(row?.edgeProbability) ? row.edgeProbability : -999
        const d = Number.isFinite(row?.decisionScore) ? row.decisionScore : -999
        return e >= bestEdge() - policy.dominance.edgeDelta && d >= bestDecision() - policy.dominance.decisionDelta
      }

      const swapAt = (iHead, iTail) => {
        const tmp = out[iHead]
        out[iHead] = out[iTail]
        out[iTail] = tmp
      }

      const pickTailCandidate = ({
        wantFamily = null,
        excludeFamily = null,
        wantPlayType = null,
        excludePlayType = null,
        victimIdx,
        edgeTolFromBest = policy.edgeTolFromBest,
        decisionDegradeMax = policy.decisionDegradeMax
      }) => {
        const usedPlayers = playerSetInHead(victimIdx)
        const be = bestEdge()
        const victim = out[victimIdx]
        const vD = Number.isFinite(victim?.decisionScore) ? victim.decisionScore : -999

        let bestIdx = -1
        let bestRow = null
        for (let i = policy.windowSize; i < out.length; i++) {
          const r = out[i]
          const fam = String(r?.__family || "")
          const pt = String(r?.playType || "")
          if (wantFamily && fam !== wantFamily) continue
          if (excludeFamily && fam === excludeFamily) continue
          if (wantPlayType && pt !== wantPlayType) continue
          if (excludePlayType && pt === excludePlayType) continue

          const pk = String(r?.player || "").toLowerCase().trim()
          if (!pk || usedPlayers.has(pk)) continue

          const e = Number.isFinite(r?.edgeProbability) ? r.edgeProbability : -999
          if (e < be - edgeTolFromBest) continue

          const d = Number.isFinite(r?.decisionScore) ? r.decisionScore : -999
          if (d < vD - decisionDegradeMax) continue

          if (!bestRow || cmpBoardRows(r, bestRow) < 0) {
            bestRow = r
            bestIdx = i
          }
        }
        return bestIdx
      }

      const diagnostics = {
        policy: {
          maxByFamily: policy.maxByFamily,
          playTypeTarget: policy.playTypeTarget,
          edgeTolFromBest: policy.edgeTolFromBest,
          decisionDegradeMax: policy.decisionDegradeMax,
          balanceEdgeTolFromBest: policy.balanceEdgeTolFromBest,
          balanceDecisionDegradeMax: policy.balanceDecisionDegradeMax,
          dominance: policy.dominance
        },
        swaps: {
          familyCap: {},
          playTypeBalance: {},
          hrInclusion: 0
        },
        top10Before: null,
        top10After: null
      }

      // Start from unique players in the window.
      let shaped = enforceUniquePlayersInTopWindow(out, policy.windowSize)
      for (let i = 0; i < out.length; i++) out[i] = shaped[i]
      diagnostics.top10Before = head().map((r) => ({ fam: r?.__family, playType: r?.playType }))

      const enforceFamilyCap = (familyKey, maxAllowed, replacementFamilyPreference = null) => {
        const famCount = () =>
          head().filter((r) => String(r?.__family || "") === familyKey).length

        while (famCount() > maxAllowed) {
          const victims = head()
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => String(r?.__family || "") === familyKey)
            // For hits, prefer stability/readability over letting “near-ties” dominate.
            .filter(({ r }) => (familyKey === "hits" ? true : !isDominant(r)))
            .sort((a, b) => cmpBoardRows(b.r, a.r)) // strongest first
          const victim = victims[victims.length - 1]
          if (!victim) break

          // Prefer TB/RBI/Runs when trimming Hits; otherwise any non-dominant family.
          let tailIdx = -1
          if (replacementFamilyPreference) {
            for (const wantFam of replacementFamilyPreference) {
              tailIdx = pickTailCandidate({
                wantFamily: wantFam,
                victimIdx: victim.i,
                edgeTolFromBest: policy.balanceEdgeTolFromBest,
                decisionDegradeMax: policy.balanceDecisionDegradeMax
              })
              if (tailIdx >= 0) break
            }
          }
          if (tailIdx < 0) {
            tailIdx = pickTailCandidate({
              excludeFamily: familyKey,
              victimIdx: victim.i,
              edgeTolFromBest: policy.balanceEdgeTolFromBest,
              decisionDegradeMax: policy.balanceDecisionDegradeMax
            })
          }
          if (tailIdx < 0) break

          swapAt(victim.i, tailIdx)
          diagnostics.swaps.familyCap[familyKey] = Number(diagnostics.swaps.familyCap[familyKey] || 0) + 1
        }
      }

      const enforcePlayTypeMin = (playType, minWant) => {
        const ptCount = () => head().filter((r) => String(r?.playType || "") === playType).length
        while (ptCount() < minWant) {
          // Replace the weakest row of an overrepresented playType (or just weakest non-matching row).
          const counts = countBy((r) => String(r?.playType || ""))
          const overTypes = Object.entries(counts)
            .filter(([k, c]) => {
              const tgt = policy.playTypeTarget[k]
              return tgt && Number(c) > Number(tgt.max)
            })
            .map(([k]) => k)

          const victimPool = head()
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => String(r?.playType || "") !== playType)
            .filter(({ r }) => !isDominant(r))
            .sort((a, b) => cmpBoardRows(b.r, a.r))

          let victim = victimPool[victimPool.length - 1] || null
          if (overTypes.length) {
            const v2 = victimPool.filter(({ r }) => overTypes.includes(String(r?.playType || "")))[0]
            if (v2) victim = v2
          }
          if (!victim) break

          const tailIdx = pickTailCandidate({
            wantPlayType: playType,
            victimIdx: victim.i,
            edgeTolFromBest: policy.balanceEdgeTolFromBest,
            decisionDegradeMax: policy.balanceDecisionDegradeMax
          })
          if (tailIdx < 0) break

          swapAt(victim.i, tailIdx)
          diagnostics.swaps.playTypeBalance[playType] = Number(diagnostics.swaps.playTypeBalance[playType] || 0) + 1
        }
      }

      // 1) Family dominance control (prevents all-HR and all-Hits walls).
      enforceFamilyCap("hr", policy.maxByFamily.hr, ["tb", "rbi", "runs"])
      enforceFamilyCap("hits", policy.maxByFamily.hits, ["tb", "rbi", "runs"])
      enforceFamilyCap("tb", policy.maxByFamily.tb, ["rbi", "runs", "hits"])

      // 2) PlayType balance (keeps the board actionable).
      enforcePlayTypeMin("boom", policy.playTypeTarget.boom.min)
      enforcePlayTypeMin("value", policy.playTypeTarget.value.min)
      enforcePlayTypeMin("safe", policy.playTypeTarget.safe.min)

      // 3) Competitive HR inclusion rule:
      // If no HR is present in the top 10, include 1 HR when there's a competitive candidate.
      {
        const hrInWindow = head().some((r) => String(r?.__family || "") === "hr" || String(r?.__family || "") === "first_hr")
        if (!hrInWindow) {
          const be = bestEdge()
          const headRows = head()
          const tailWorstD = Math.min(
            ...headRows.map((r) => (Number.isFinite(r?.decisionScore) ? r.decisionScore : Infinity))
          )

          // find best competitive HR in tail
          let bestHrIdx = -1
          let bestHrRow = null
          const usedPlayers = playerSetInHead(-1)
          for (let i = policy.windowSize; i < out.length; i++) {
            const r = out[i]
            const fam = String(r?.__family || "")
            if (!(fam === "hr" || fam === "first_hr")) continue
            const pk = String(r?.player || "").toLowerCase().trim()
            if (!pk || usedPlayers.has(pk)) continue
            const e = Number.isFinite(r?.edgeProbability) ? r.edgeProbability : -999
            const d = Number.isFinite(r?.decisionScore) ? r.decisionScore : -999
            if (e < be - 0.085) continue
            if (d < tailWorstD - 0.065) continue
            if (!bestHrRow || cmpBoardRows(r, bestHrRow) < 0) {
              bestHrRow = r
              bestHrIdx = i
            }
          }

          if (bestHrIdx >= 0) {
            // swap with weakest non-dominant safe/hits (prefer trimming hits first)
            const victim = headRows
              .map((r, i) => ({ r, i }))
              .filter(({ r }) => !isDominant(r))
              .sort((a, b) => {
                const famA = String(a.r?.__family || "")
                const famB = String(b.r?.__family || "")
                const pri = (fam) => (fam === "hits" ? 3 : fam === "tb" ? 2 : 1)
                if (pri(famA) !== pri(famB)) return pri(famA) - pri(famB) // lower pri first = better victim
                return cmpBoardRows(a.r, b.r)
              })[0]

            if (victim && victim.i != null) {
              const vD = Number.isFinite(victim.r?.decisionScore) ? victim.r.decisionScore : -999
              const cD = Number.isFinite(bestHrRow?.decisionScore) ? bestHrRow.decisionScore : -999
              if (cD >= vD - 0.07) {
                swapAt(victim.i, bestHrIdx)
                diagnostics.swaps.hrInclusion += 1
              }
            }
          }
        }
      }

      // Re-apply uniqueness after swaps, and normalize head ordering.
      shaped = enforceUniquePlayersInTopWindow(out, policy.windowSize)
      for (let i = 0; i < out.length; i++) out[i] = shaped[i]
      diagnostics.top10After = head().map((r) => ({ fam: r?.__family, playType: r?.playType }))

      const finalHead = out.slice(0, policy.windowSize).sort(cmpBoardRows)
      const merged = finalHead.concat(out.slice(policy.windowSize))

      mlbDecisionBoardDiagnostics = mlbDecisionBoardDiagnostics && typeof mlbDecisionBoardDiagnostics === "object"
        ? { ...mlbDecisionBoardDiagnostics, top10Policy: diagnostics }
        : { top10Policy: diagnostics }

      return merged
    }

    // === MLB lane-based decision board (stable top-10 policy) ===
    // Replace ad hoc top-window shaping with explicit lanes.
    {
      const { board: laneTop10, diagnostics: laneDiagnostics } = buildMlbDecisionBoard(finalBoard, {
        topN: 10,
        power: 3,
        safe: 3,
        value: 3
      })

      const merged = [...laneTop10, ...finalBoard]
      const seen = new Set()
      const deduped = []
      for (const r of merged) {
        const key = String(r?.player || "").toLowerCase().trim()
        if (!key) continue
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(r)
      }
      finalBoard = deduped

      mlbDecisionBoardDiagnostics = {
        ...(mlbDecisionBoardDiagnostics && typeof mlbDecisionBoardDiagnostics === "object" ? mlbDecisionBoardDiagnostics : {}),
        laneDecisionBoard: laneDiagnostics
      }
    }

    // Ensure newly ingested markets (pitchers, specials) are represented in the surfaced board.
    // This is inclusion-only: it appends the best available row per family when missing.
    {
      const wantFamilies = ["pitcher_k", "pitcher_outs", "pitcher_er", "pitcher_walks", "stolen_bases"]
      const present = new Set(finalBoard.map((r) => String(r?.__family || "")))
      const usedPlayers = new Set(finalBoard.map((r) => String(r?.player || "").toLowerCase().trim()).filter(Boolean))

      const picks = []
      for (const fam of wantFamilies) {
        if (present.has(fam)) continue
        const candidate = ranked.find((r) => {
          if (String(r?.__family || "") !== fam) return false
          const pk = String(r?.player || "").toLowerCase().trim()
          if (!pk || usedPlayers.has(pk)) return false
          const side = String(r?.__src?.side || "").trim().toLowerCase()
          return side === "over" || side === "yes"
        })
        if (candidate) {
          picks.push(candidate)
          usedPlayers.add(String(candidate?.player || "").toLowerCase().trim())
          present.add(fam)
        }
      }
      if (picks.length) finalBoard = finalBoard.concat(picks)
    }

    // Minimal decision board diagnostics (for verification).
    const top10 = finalBoard.slice(0, 10)
    const scores = top10.map((r) => (Number.isFinite(r?.decisionScore) ? r.decisionScore : null)).filter((v) => v != null)
    const minS = scores.length ? Math.min(...scores) : null
    const maxS = scores.length ? Math.max(...scores) : null
    const hrTop10 = top10.filter((r) => String(r?.__family || "") === "hr" || String(r?.__family || "") === "first_hr").length
    const famCounts = top10.reduce((acc, r) => {
      const fam = String(r?.__family || "other")
      acc[fam] = Number(acc[fam] || 0) + 1
      return acc
    }, {})
    mlbDecisionBoardDiagnostics = {
      ...(mlbDecisionBoardDiagnostics && typeof mlbDecisionBoardDiagnostics === "object" ? mlbDecisionBoardDiagnostics : {}),
      top10DecisionScoreRange: scores.length ? Number((maxS - minS).toFixed(6)) : null,
      top10HrCount: hrTop10,
      top10NonHrCount: top10.length - hrTop10,
      top10FamilyMix: famCounts,
      top10PlayTypeMix: top10.reduce((acc, r) => {
        const k = String(r?.playType || "unknown")
        acc[k] = Number(acc[k] || 0) + 1
        return acc
      }, {})
    }

    const isValidMlbBoardExportRow = (row) => {
      if (!row || typeof row !== "object") return false
      const propType = row?.propType
      if (typeof propType !== "string") return false
      if (!propType.trim() || propType.trim() === "0") return false
      const player = String(row?.player || "").trim()
      if (!player) return false
      const team = String(row?.team || "").trim()
      if (!team || team === "0") return false
      const odds = Number(row?.odds)
      if (!Number.isFinite(odds) || odds === 0) return false
      const line = Number(row?.line)
      if (!Number.isFinite(line) || line === 0) return false
      return true
    }

    const exported = finalBoard.map((row, idx) => {
      const isHighUpside = Boolean(isMlbHighUpsideRow(row))
      const { __src, __family, __rank, ...rest } = row
      let teamOut = rest.team
      if (idx < 20 && (!teamOut || !String(teamOut).trim())) {
        // Prefer correctness over forced mapping. If we can't confirm a team
        // within the event context, keep a neutral placeholder instead of
        // silently assigning away/home.
        teamOut = "TBD"
        teamResolutionDiagnostics.placeholderUsed += 1
      }

      return {
        ...rest,
        team: teamOut,
        side: __src?.side ?? rest.side ?? null,
        eventId: __src?.eventId ?? rest.eventId ?? null,
        isHighUpside,
        // Preserve new matchup context object as `matchup`; keep the old text label separately.
        matchupLabel: __src?.matchup ?? (typeof rest.matchup === "string" ? rest.matchup : null),
        awayTeam: __src?.awayTeam ?? rest.awayTeam ?? null,
        homeTeam: __src?.homeTeam ?? rest.homeTeam ?? null
      }
    })
    // Hard final sanitize: drop any invalid/zero rows before downstream consumers.
    return exported.filter(isValidMlbBoardExportRow)
  })()

  const now = Date.now()
  function isGameBettable(row) {
    const rawTime = row.gameTime || row.commence_time
    const gameTime = rawTime ? new Date(rawTime).getTime() : null

    console.log("[TIME DEBUG]", {
      player: row.player,
      rawTime,
      parsedGameTime: gameTime,
      now,
      minutesSinceStart: gameTime ? (now - gameTime) / (1000 * 60) : null
    })

    if (!gameTime) return false

    // if game is in the future → ALWAYS allow
    if (gameTime > now) return true

    const minutesSinceStart = (now - gameTime) / (1000 * 60)

    if (minutesSinceStart > 15) return false

    return true
  }

  const bettableMlbBoard = (Array.isArray(mlbPredictionBoard) ? mlbPredictionBoard : []).filter(isGameBettable)

  console.log("[BETTABLE FILTER]", {
    before: Array.isArray(mlbPredictionBoard) ? mlbPredictionBoard.length : 0,
    after: bettableMlbBoard.length
  })

  // Auto-log MLB top-10 picks as bets (idempotent by player+prop+date).
  ;(async () => {
    try {
      const top10 = Array.isArray(mlbPredictionBoard) ? mlbPredictionBoard.slice(0, 10) : []
      if (!top10.length) return
      const dateKey = new Date().toISOString().slice(0, 10)
      for (const r of top10) {
        await logBet({
          date: dateKey,
          player: r?.player || null,
          team: r?.team || null,
          propType: r?.propType || null,
          odds: r?.odds ?? null,
          stake: 10,
          edge: r?.edgeProbability ?? null,
          playType: r?.playType || null
        })
      }
    } catch {
      // tracker failures must never break existing endpoints
    }
  })()

  // Cache MLB picks for /api/mlb/picks
  try {
    mlbPicks = buildMlbBetSelector(mlbPredictionBoard)
  } catch {
    mlbPicks = { safeCore: [], valueCore: [], powerCore: [] }
  }

  try {
    mlbSlips = buildMlbSlipEngine(mlbPicks)
  } catch {
    mlbSlips = []
  }

  try {
    mlbOomphSlips = buildMlbOomphEngine(mlbPredictionBoard)
  } catch {
    mlbOomphSlips = null
  }

  try {
    mlbSpikePlayers = buildMlbSpikeEngine(mlbPredictionBoard, { topN: 10 })
  } catch {
    mlbSpikePlayers = { spikePlayers: [] }
  }

  try {
    mlbCorrelationClusters = buildMlbCorrelationClusters(bettableMlbBoard, { maxClusters: 10, maxLegs: 3 })
  } catch {
    mlbCorrelationClusters = []
  }

  try {
    mlbUpsideClusters = buildMlbUpsideClusters(bettableMlbBoard, { maxClusters: 10, maxLegs: 4, minUpsideLegs: 2 })
  } catch {
    mlbUpsideClusters = []
  }

  // FINAL sanitize step (must be last mutation before response):
  // ensure no invalid rows leak into bestAvailable payload.
  const mlbPredictionBoardFinal = (Array.isArray(mlbPredictionBoard) ? mlbPredictionBoard : []).filter((row) =>
    row &&
    typeof row.propType === "string" &&
    row.propType !== "0" &&
    String(row.player || "").trim() &&
    typeof row.team === "string" &&
    String(row.team || "").trim() !== "0" &&
    Number.isFinite(Number(row.odds)) && Number(row.odds) !== 0 &&
    Number.isFinite(Number(row.line)) && Number(row.line) !== 0
  )

  let mlbPropClusters = {}
  try {
    mlbPropClusters = buildMlbPropClusters(bettableMlbBoard)

    console.log("[MLB PROP CLUSTERS DEBUG]", {
      inputRows: bettableMlbBoard.length,
      sampleRow: bettableMlbBoard[0],
      hr: Array.isArray(mlbPropClusters?.hrCluster) ? mlbPropClusters.hrCluster.length : 0,
      rbi: Array.isArray(mlbPropClusters?.rbiCluster) ? mlbPropClusters.rbiCluster.length : 0,
      tb: Array.isArray(mlbPropClusters?.tbCluster) ? mlbPropClusters.tbCluster.length : 0,
      hits: Array.isArray(mlbPropClusters?.hitsCluster) ? mlbPropClusters.hitsCluster.length : 0
    })

    if (bettableMlbBoard.length === 0) {
      console.log("[MLB PROP CLUSTERS ERROR] EMPTY INPUT BOARD")
    } else {
      const hrLen = Array.isArray(mlbPropClusters?.hrCluster) ? mlbPropClusters.hrCluster.length : 0
      const rbiLen = Array.isArray(mlbPropClusters?.rbiCluster) ? mlbPropClusters.rbiCluster.length : 0
      const tbLen = Array.isArray(mlbPropClusters?.tbCluster) ? mlbPropClusters.tbCluster.length : 0
      const hitsLen = Array.isArray(mlbPropClusters?.hitsCluster) ? mlbPropClusters.hitsCluster.length : 0

      if (hrLen === 0 && rbiLen === 0 && tbLen === 0 && hitsLen === 0) {
        console.log("[PROP TYPE DISTRIBUTION]",
          bettableMlbBoard.map((r) => r?.propType).slice(0, 50)
        )
      }
    }

  } catch (e) {
    console.log("[MLB PROP CLUSTERS ERROR]", e.message)
    mlbPropClusters = {
      hrCluster: [],
      rbiCluster: [],
      tbCluster: [],
      hitsCluster: []
    }
  }

  // === Tracking (Phase 1, NBA only): persist daily tracked + surfaced props to tracked_props_<date>.json. ===
  // MLB best picks + boards are isolated: see recordMlbBestProps / mlb_tracked_best_<date>.json (not mixed here).
  try {
    const slateDate = new Date().toISOString().slice(0, 10)

    const collections = [
      // NBA: track the scored universe and surfaced lanes when available.
      { sport: "nba", source: "nba.completeUniverse", rows: Array.isArray(completeUniverse) ? completeUniverse : [], recommended: false },
      { sport: "nba", source: "bestAvailable.safe", rows: Array.isArray(safe) ? safe : [], recommended: true },
      { sport: "nba", source: "bestAvailable.balanced", rows: Array.isArray(balanced) ? balanced : [], recommended: true },
      { sport: "nba", source: "bestAvailable.aggressive", rows: Array.isArray(aggressive) ? aggressive : [], recommended: true },
      { sport: "nba", source: "bestAvailable.lotto", rows: Array.isArray(lotto) ? lotto : [], recommended: true },
      { sport: "nba", source: "boards.corePropsBoard", rows: Array.isArray(corePropsBoard) ? corePropsBoard : [], recommended: true },
      { sport: "nba", source: "boards.ladderBoard", rows: Array.isArray(ladderBoard) ? ladderBoard : [], recommended: true },
      { sport: "nba", source: "boards.specialBoard", rows: Array.isArray(specialBoard) ? specialBoard : [], recommended: true },
      { sport: "nba", source: "boards.lottoBoard", rows: Array.isArray(lottoBoard) ? lottoBoard : [], recommended: true },
    ]

    // Fire-and-forget; must never block or break the endpoint.
    saveTrackedSlateSnapshot({ date: slateDate, collections }).catch(() => {})
  } catch {
    // bestAvailable must never fail due to tracking
  }

  return res.json({
    bestAvailable: {
      ...bestAvailablePayloadBoardFirst,
      // Preserve the full /api/best-available contract: these are generated by
      // buildLiveDualBestAvailablePayload() but were previously destructured
      // out and never re-attached to the response payload.
      safe,
      balanced,
      aggressive,
      lotto,
      slateMode: nbaRowQualityAudit?.slateMode || null,
      mlbPredictionBoard: mlbPredictionBoardFinal,
      mlbCorrelationClusters: Array.isArray(mlbCorrelationClusters) ? mlbCorrelationClusters : [],
      mlbUpsideClusters: Array.isArray(mlbUpsideClusters) ? mlbUpsideClusters : [],
      mlbPropClusters: mlbPropClusters || {},
      longshotTop: nbaSurfacedLongshotTop,
      safePairTop: nbaSurfacedSafePairTop,
      superstarCeilingBoard,
      highestHitRate2,
      highestHitRate3,
      highestHitRate4,
      highestHitRate5,
      highestHitRate6,
      highestHitRate7,
      highestHitRate8,
      highestHitRate9,
      highestHitRate10,
      payoutFitPortfolio,
      moneyMakerPortfolio,
      diagnostics: {
        ...(mergedBestAvailableDiagnostics && typeof mergedBestAvailableDiagnostics === "object"
          ? mergedBestAvailableDiagnostics
          : {}),
        nbaRowStateDist: typeof nbaRowStateDistForPayload === "object" ? nbaRowStateDistForPayload : null,
        mlbTeamResolution: typeof teamResolutionDiagnostics === "object" ? teamResolutionDiagnostics : null,
        mlbDecisionBoard: typeof mlbDecisionBoardDiagnostics === "object" ? mlbDecisionBoardDiagnostics : null,
        nbaCorePools: {
          bestPropsCountSnapshot: typeof bestPropsCountSnapshot === "number" ? bestPropsCountSnapshot : null,
          coreFallbackActivated: typeof coreFallbackActivated === "boolean" ? coreFallbackActivated : null,
          fallbackScoredCoreRows: typeof fallbackScoredCoreRows?.length === "number" ? fallbackScoredCoreRows.length : null,
          completeUniverse: typeof completeUniverse?.length === "number" ? completeUniverse.length : null,
          completeBettableNonSpecial: typeof completeBettableNonSpecial?.length === "number" ? completeBettableNonSpecial.length : null,
          completeCoreStandard: typeof completeCoreStandard?.length === "number" ? completeCoreStandard.length : null,
          selectedBestLen: typeof bestPayloadRows?.length === "number" ? bestPayloadRows.length : null,
          sampleCompleteUniverse: Array.isArray(completeUniverse)
            ? completeUniverse.slice(0, 6).map((r) => ({
                player: r?.player || null,
                propType: r?.propType || null,
                marketKey: r?.marketKey || null,
                propVariant: r?.propVariant || null,
                line: r?.line ?? null,
                odds: r?.odds ?? null,
                book: r?.book || null,
                matchup: r?.matchup || null,
                qualitySignalCount: r?.qualitySignalCount ?? null
              }))
            : []
        }
      },
      poolDiagnostics: mergedBestAvailablePoolDiagnostics,
      specialProps: enrichedSpecialProps,
      bettingNow,
      slateBoard,
      topCard,
      mostLikelyToHit: curatedMostLikelyToHit,
      bestValue: curatedBestValue,
      bestUpside: curatedBestUpside,
      boards,
      firstBasketBoard,
      corePropsBoard,
      ladderBoard,
      specialBoard,
      lottoBoard,
      firstBasketPicks,
      corePropPicks,
      lottoPicks,
      gameEdgeBoard,
      mustPlayBoard,
      featuredPlays,
      firstBasket: specialtyLaneOutputs.firstBasket,
      firstTeamBasket: specialtyLaneOutputs.firstTeamBasket,
      specials: specialtyLaneOutputs.specials,
      featured: specialtyLaneOutputs.featured,
      bestDoubleDoubles: typeAwareSpecials.bestDoubleDoubles,
      bestTripleDoubles: typeAwareSpecials.bestTripleDoubles,
      bestFirstBasket: typeAwareSpecials.bestFirstBasket,
      bestFirstTeamBasket: typeAwareSpecials.bestFirstTeamBasket,
      bestLongshotPlays: layerBestLongshotPlays,
      bestLongshotSpecials: layerBestLongshotPlays,
      bestBangerTickets,
      surfaced: layeredSurfaced,
      tonightsPlays: {
        bestSingles: tonightsBestSingles,
        bestLadders: tonightsBestLadders,
        bestSpecials: surfacedBestSpecials,
        mustPlayCandidates,
        curated: {
          mostLikelyToHit: curatedMostLikelyToHit,
          bestValue: curatedBestValue,
          bestUpside: curatedBestUpside
        },
        boardProgress,
        surfaced: layeredSurfaced,
        counts: {
          bestSingles: tonightsBestSingles.length,
          bestLadders: tonightsBestLadders.length,
          bestSpecials: tonightsBestSpecials.length,
          mustPlayCandidates: mustPlayCandidates.length,
          mostLikelyToHit: curatedMostLikelyToHit.length,
          bestValue: curatedBestValue.length,
          bestUpside: curatedBestUpside.length
        },
        evaluation: tonightsPlaysEvaluation
      },
      specialsAudit: specialsAudit
    },
    ladderPool,
    routePlayableSeed: routePlayableSeed,
    finalPlayableRows: finalPlayableRows,
    standardCandidates: standardCandidates,
    ladderCandidates: ladderCandidates,
    coreStandardProps,
    ladderProps,
    specialProps: specialPropsBoard,
    boardCounts,
    snapshotMeta,
    slateStateValidator: currentSnapshot?.slateStateValidator || null,
    lineHistorySummary: currentSnapshot?.lineHistorySummary || null
  })
