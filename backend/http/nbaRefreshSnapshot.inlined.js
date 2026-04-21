  console.log("[TOP-DOWN-REFRESH-ENTRY]", {
    snapshotSource: lastSnapshotSource || "unknown",
    snapshotLoadedFromDisk,
    updatedAt: oddsSnapshot?.updatedAt || null,
    events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
    rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
    props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
    bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1,
    forceQuery: req.query.force || null
  })
  try {
    resetFragileFilterAdjustedLogCount()
    const previousSnapshot = oddsSnapshot && typeof oddsSnapshot === "object"
      ? {
          ...oddsSnapshot,
          events: Array.isArray(oddsSnapshot.events) ? [...oddsSnapshot.events] : [],
          rawProps: Array.isArray(oddsSnapshot.rawProps) ? [...oddsSnapshot.rawProps] : [],
          props: Array.isArray(oddsSnapshot.props) ? [...oddsSnapshot.props] : [],
          eliteProps: Array.isArray(oddsSnapshot.eliteProps) ? [...oddsSnapshot.eliteProps] : [],
          strongProps: Array.isArray(oddsSnapshot.strongProps) ? [...oddsSnapshot.strongProps] : [],
          playableProps: Array.isArray(oddsSnapshot.playableProps) ? [...oddsSnapshot.playableProps] : [],
          bestProps: Array.isArray(oddsSnapshot.bestProps) ? [...oddsSnapshot.bestProps] : [],
          flexProps: Array.isArray(oddsSnapshot.flexProps) ? [...oddsSnapshot.flexProps] : [],
          diagnostics: oddsSnapshot.diagnostics && typeof oddsSnapshot.diagnostics === "object"
            ? { ...oddsSnapshot.diagnostics }
            : {}
        }
      : null
    const previousSnapshotForCarry = {
      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? [...oddsSnapshot.rawProps] : [],
      props: Array.isArray(oddsSnapshot?.props) ? [...oddsSnapshot.props] : []
    }

    const cloneSnapshotForFallback = (snapshot) => (
      snapshot && typeof snapshot === "object"
        ? {
            ...snapshot,
            events: Array.isArray(snapshot.events) ? [...snapshot.events] : [],
            rawProps: Array.isArray(snapshot.rawProps) ? [...snapshot.rawProps] : [],
            props: Array.isArray(snapshot.props) ? [...snapshot.props] : [],
            eliteProps: Array.isArray(snapshot.eliteProps) ? [...snapshot.eliteProps] : [],
            strongProps: Array.isArray(snapshot.strongProps) ? [...snapshot.strongProps] : [],
            playableProps: Array.isArray(snapshot.playableProps) ? [...snapshot.playableProps] : [],
            bestProps: Array.isArray(snapshot.bestProps) ? [...snapshot.bestProps] : [],
            flexProps: Array.isArray(snapshot.flexProps) ? [...snapshot.flexProps] : [],
            diagnostics: snapshot.diagnostics && typeof snapshot.diagnostics === "object"
              ? { ...snapshot.diagnostics }
              : {},
            parlays: snapshot.parlays ?? null,
            dualParlays: snapshot.dualParlays ?? null
          }
        : null
    )

    const currentSnapshotFallback = cloneSnapshotForFallback(oddsSnapshot)

    let diskSnapshotFallback = null
    try {
      const snapshotPath = path.join(__dirname, "snapshot.json")
      if (fs.existsSync(snapshotPath)) {
        const rawDiskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"))
        diskSnapshotFallback = cloneSnapshotForFallback(rawDiskSnapshot?.data || null)
      }
    } catch (diskReadError) {
      console.log("[SNAPSHOT-FALLBACK-DISK-READ-FAILED]", {
        message: diskReadError?.message || null
      })
    }

    const getSnapshotStrength = (snapshot) => {
      const rawPropsCount = Array.isArray(snapshot?.rawProps) ? snapshot.rawProps.length : 0
      const bestPropsCount = Array.isArray(snapshot?.bestProps) ? snapshot.bestProps.length : 0
      const propsCount = Array.isArray(snapshot?.props) ? snapshot.props.length : 0
      return rawPropsCount * 1000000 + bestPropsCount * 1000 + propsCount
    }

    const preferredSnapshotFallback =
      getSnapshotStrength(diskSnapshotFallback) > getSnapshotStrength(currentSnapshotFallback)
        ? diskSnapshotFallback
        : currentSnapshotFallback

    const replayModeRequested = isNbaOddsReplayRequest(req)
    if (replayModeRequested) {
      return sendNbaReplayRefreshResponse(res, {
        routeTag: "refresh-snapshot",
        logTag: "[SLATE-SELECTION-DEBUG-REPLAY-MODE]"
      })
    }

    const forceRefresh = String(req.query.force || "").toLowerCase() === "1" ||
      String(req.query.force || "").toLowerCase() === "true"

    if (forceRefresh) {
      lastForceRefreshAt = new Date().toISOString()
    }
    console.log("[FORCE-REFRESH-DEBUG]", {
      forceFlag: forceRefresh,
      lastForceRefreshAt
    })

    if (forceRefresh) {
      console.log("[SNAPSHOT-DEBUG] FORCE REFRESH ROUTE HIT")
      // Force refresh: clear in-memory snapshot to ensure completely fresh rebuild
      oddsSnapshot = {
        updatedAt: null,
        events: [],
        rawProps: [],
        props: [],
        bestProps: [],
        eliteProps: [],
        strongProps: [],
        playableProps: [],
        flexProps: [],
        diagnostics: {},
        parlays: null,
        dualParlays: null
      }
    }

    const snapshotAgeMinutes = oddsSnapshot?.updatedAt
      ? (Date.now() - new Date(oddsSnapshot.updatedAt).getTime()) / 60000
      : null

    const buildCachedRefreshResponse = ({
      cacheReason = null,
      includePrimarySlateDateLocal = false,
      includeSnapshotSlateFields = false,
      includeLegacyFreshSnapshotReason = false
    } = {}) => {
      const cachedScheduledEvents = Array.isArray(oddsSnapshot.events) ? oddsSnapshot.events : []
      const cachedRawPropsRows = Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props : []
      const cachedEnrichedModelRows = dedupeByLegSignature([
        ...(Array.isArray(oddsSnapshot.eliteProps) ? oddsSnapshot.eliteProps : []),
        ...(Array.isArray(oddsSnapshot.strongProps) ? oddsSnapshot.strongProps : []),
        ...(Array.isArray(oddsSnapshot.playableProps) ? oddsSnapshot.playableProps : []),
        ...(Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : [])
      ])
      const cachedSurvivedFragileRows = cachedRawPropsRows.filter((row) => {
        try {
          return !isFragileLeg(row, "best")
        } catch (_) {
          return true
        }
      })
      const cachedBestPropsRawRows = Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []
      const cachedFinalBestVisibleRows = getAvailablePrimarySlateRows(cachedBestPropsRawRows)
      const __normalizedFamilySummary = summarizeInterestingNormalizedRows(cachedRawPropsRows || [])
      const __normalizedCoverageSummary = summarizeNormalizedMarketCoverage(cachedRawPropsRows || [])

      console.log("[NORMALIZATION-MARKET-FAMILY-DEBUG]", __normalizedFamilySummary)
      console.log("[NORMALIZATION-MARKET-KEYS-TOP-DEBUG]", {
        totalRows: __normalizedCoverageSummary.totalRows,
        topPropTypes: Object.entries(__normalizedCoverageSummary.byPropType || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15),
        topMarketKeys: Object.entries(__normalizedCoverageSummary.byMarketKey || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25),
        byBookAndPropType: __normalizedCoverageSummary.byBookAndPropType || {}
      })
      console.log("[COVERAGE-AUDIT-CALLSITE-DEBUG]", {
        path: cacheReason || "refresh-snapshot-cached",
        scheduledEvents: cachedScheduledEvents.length,
        rawPropsRows: cachedRawPropsRows.length,
        enrichedModelRows: cachedEnrichedModelRows.length,
        survivedFragileRows: cachedSurvivedFragileRows.length,
        survivedFragileRowsByBook: {
          FanDuel: cachedSurvivedFragileRows.filter((r) => r?.book === "FanDuel").length,
          DraftKings: cachedSurvivedFragileRows.filter((r) => r?.book === "DraftKings").length
        },
        bestPropsRawRows: cachedBestPropsRawRows.length,
        bestPropsRawRowsByBook: {
          FanDuel: cachedBestPropsRawRows.filter((r) => r?.book === "FanDuel").length,
          DraftKings: cachedBestPropsRawRows.filter((r) => r?.book === "DraftKings").length
        },
        finalBestVisibleRows: cachedFinalBestVisibleRows.length
      })
      runCurrentSlateCoverageDiagnostics({
        scheduledEvents: cachedScheduledEvents,
        rawPropsRows: cachedRawPropsRows,
        enrichedModelRows: cachedEnrichedModelRows,
        survivedFragileRows: cachedSurvivedFragileRows,
        bestPropsRawRows: cachedBestPropsRawRows,
        finalBestVisibleRows: cachedFinalBestVisibleRows
      })

      const slateMeta = getSlateModeFromEvents(oddsSnapshot.events || [])
      const response = {
        ok: true,
        cached: true,
        updatedAt: oddsSnapshot.updatedAt,
        snapshotGeneratedAt: oddsSnapshot?.snapshotGeneratedAt || oddsSnapshot?.updatedAt || null,
        snapshotSlateDateLocal:
          oddsSnapshot?.snapshotSlateDateLocal ||
          oddsSnapshot?.snapshotSlateDateKey ||
          (oddsSnapshot?.updatedAt ? toDetroitDateKey(oddsSnapshot.updatedAt) : null),
        updatedAtLocal: formatDetroitLocalTimestamp(oddsSnapshot.updatedAt),
        slateMode: slateMeta.slateMode,
        eligibleRemainingGames: slateMeta.eligibleRemainingGames,
        totalEligibleGames: slateMeta.totalEligibleGames,
        startedEligibleGames: slateMeta.startedEligibleGames,
        events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : 0,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0,
        slateStateValidator: oddsSnapshot?.slateStateValidator || null,
        lineHistorySummary: oddsSnapshot?.lineHistorySummary || null
      }

      if (cacheReason) response.cacheReason = cacheReason
      if (includePrimarySlateDateLocal) {
        response.primarySlateDateLocal = getPrimarySlateDateKeyFromRows(oddsSnapshot.props || [])
      }
      if (includeSnapshotSlateFields) {
        response.snapshotSlateDateKey = oddsSnapshot.snapshotSlateDateKey || null
        response.snapshotSlateGameCount = oddsSnapshot.snapshotSlateGameCount || 0
      }
      if (includeLegacyFreshSnapshotReason) {
        response.reason = "fresh_snapshot"
      }

      return response
    }

    const shouldSkipRebuild =
      snapshotLoadedFromDisk &&
      snapshotAgeMinutes !== null &&
      snapshotAgeMinutes < 10

    if (shouldSkipRebuild) {
      console.log("[TOP-DOWN-REFRESH-SKIP-REBUILD]", {
        reason: "shouldSkipRebuild",
        snapshotLoadedFromDisk,
        snapshotAgeMinutes,
        events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
        rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1
      })
      console.log("[SNAPSHOT-CACHE] skipping rebuild, using cached snapshot", {
        snapshotAgeMinutes
      })
      return res.json(buildCachedRefreshResponse({
        cacheReason: "refresh-snapshot-cached-skip-rebuild",
        includeLegacyFreshSnapshotReason: true
      }))
    }

    if (
      !forceRefresh &&
      oddsSnapshot.updatedAt &&
      oddsSnapshot.events.length &&
      oddsSnapshot.props.length &&
      (!snapshotLoadedFromDisk || (snapshotAgeMinutes !== null && snapshotAgeMinutes < 10))
    ) {
      console.log("[TOP-DOWN-REFRESH-SKIP-CACHED]", {
        reason: "cached_snapshot_still_valid",
        snapshotLoadedFromDisk,
        snapshotAgeMinutes,
        events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
        rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1
      })
      return res.json(buildCachedRefreshResponse({
        cacheReason: "refresh-snapshot-cached-shortcut",
        includePrimarySlateDateLocal: true
      }))
    }

    const now = Date.now()
    const msSinceLast = now - lastSnapshotRefreshAt

    if (msSinceLast < SNAPSHOT_COOLDOWN_MS && !forceRefresh) {
      return res.status(429).json({
        error: "Snapshot refresh cooldown active",
        retryInSeconds: Math.ceil((SNAPSHOT_COOLDOWN_MS - msSinceLast) / 1000),
        lastUpdatedAt: oddsSnapshot.updatedAt,
        lastUpdatedAtLocal: formatDetroitLocalTimestamp(oddsSnapshot.updatedAt),
        primarySlateDateLocal: getPrimarySlateDateKeyFromRows(oddsSnapshot.props || [])
      })
    }

    if (!ensureNbaRefreshEnvConfigured(res)) {
      return
    }

    // Same-slate cache guard: skip live API calls if snapshot is fresh and for a valid slate
    const slateCacheSnapshotAge = oddsSnapshot?.updatedAt
      ? (Date.now() - new Date(oddsSnapshot.updatedAt).getTime()) / 60000
      : null
    const slateCacheHasEvents = Array.isArray(oddsSnapshot?.events) && oddsSnapshot.events.length > 0
    const slateCacheHasSlateKey = Boolean(oddsSnapshot?.snapshotSlateDateKey)
    const slateCacheIsFresh = slateCacheSnapshotAge !== null && slateCacheSnapshotAge <= 10

    if (
      !forceRefresh &&
      slateCacheHasSlateKey &&
      slateCacheHasEvents &&
      slateCacheIsFresh
    ) {
      console.log("[REFRESH-CACHE-HIT-SAME-SLATE]", {
        snapshotSlateDateKey: oddsSnapshot.snapshotSlateDateKey,
        snapshotSlateGameCount: oddsSnapshot.snapshotSlateGameCount || 0,
        snapshotAgeMinutes: Math.round((slateCacheSnapshotAge || 0) * 10) / 10,
        events: oddsSnapshot.events.length,
        rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0
      })

      return res.json(buildCachedRefreshResponse({
        cacheReason: "same-slate-fresh",
        includeSnapshotSlateFields: true
      }))
    }

    const {
      allEvents,
      scheduledEvents: rawScheduledEvents
    } = await fetchNbaUnrestrictedSlateEvents()

    // Smart slate selection: today vs tomorrow
    const slateNow = Date.now()
    const todayDateKey = toDetroitDateKey(slateNow)
    const tomorrowDateKey = toDetroitDateKey(slateNow + 24 * 60 * 60 * 1000)

    const getEventTime = (event) =>
      event?.commence_time || event?.gameTime || event?.startTime || event?.start_time || event?.game_time || ""

    const todayEvents = (Array.isArray(allEvents) ? allEvents : []).filter((event) =>
      toDetroitDateKey(getEventTime(event)) === todayDateKey
    )
    const tomorrowEvents = (Array.isArray(allEvents) ? allEvents : []).filter((event) =>
      toDetroitDateKey(getEventTime(event)) === tomorrowDateKey
    )
    const todayPregameEligible = todayEvents.filter((event) => {
      const eventMs = new Date(getEventTime(event)).getTime()
      return Number.isFinite(eventMs) && eventMs > slateNow
    })
    // Live slate fallback: if games already started, "upcoming" can be empty even though
    // props are live and we still need a primary slate for downstream boards.
    // Keep events that started within the last ~8 hours (NBA window) so we don't resurrect stale games.
    const LIVE_SLATE_WINDOW_MS = 8 * 60 * 60 * 1000
    const todayLiveOrUpcoming = todayEvents.filter((event) => {
      const eventMs = new Date(getEventTime(event)).getTime()
      return Number.isFinite(eventMs) && eventMs > (slateNow - LIVE_SLATE_WINDOW_MS)
    })

    let chosenSlateDateKey = todayDateKey
    // Prefer true upcoming; otherwise fall back to live-or-upcoming within the same Detroit day.
    let scheduledEvents = todayPregameEligible.length ? todayPregameEligible : todayLiveOrUpcoming

    console.log("[TIME FILTER]", {
      now: new Date(slateNow).toISOString(),
      todayDateKey,
      tomorrowDateKey,
      sampleEventTimes: (Array.isArray(allEvents) ? allEvents : []).slice(0, 12).map((e) => getEventTime(e))
    })

    // Rollover rule:
    // - If today has ANY pregame games -> use today
    // - If today has ZERO pregame games and tomorrow has >0 pregame -> use tomorrow
    // - Otherwise fallback to today (including live-or-upcoming within today)
    const tomorrowPregameEligible = tomorrowEvents.filter((event) => {
      const eventMs = new Date(getEventTime(event)).getTime()
      return Number.isFinite(eventMs) && eventMs > slateNow
    })
    if (todayPregameEligible.length === 0 && tomorrowPregameEligible.length > 0) {
      console.log("[SLATE ROLLOVER]", { from: "today", to: "tomorrow", reason: "no_pregame_today" })
      chosenSlateDateKey = tomorrowDateKey
      scheduledEvents = tomorrowPregameEligible
    } else if (scheduledEvents.length === 0 && tomorrowEvents.length > 0) {
      // Only fall forward to tomorrow if there are truly no viable events for "today".
      chosenSlateDateKey = tomorrowDateKey
      scheduledEvents = tomorrowEvents
    }

    // Safety expansion: if date-key bucketing yields no slate but the API did return events,
    // fall back to a rolling 36h window to avoid timezone / "today-only" starvation.
    if (scheduledEvents.length === 0 && (Array.isArray(allEvents) ? allEvents.length : 0) > 0) {
      const EXPAND_WINDOW_MS = 36 * 60 * 60 * 1000
      const expanded = (Array.isArray(allEvents) ? allEvents : []).filter((event) => {
        const eventMs = new Date(getEventTime(event)).getTime()
        return Number.isFinite(eventMs) && eventMs > (slateNow - LIVE_SLATE_WINDOW_MS) && eventMs < (slateNow + EXPAND_WINDOW_MS)
      })
      if (expanded.length > 0) {
        scheduledEvents = expanded
        chosenSlateDateKey = toDetroitDateKey(getEventTime(expanded[0]) || slateNow)
      }
    }

    console.log("[SLATE-SELECTION-DEBUG]", {
      now: new Date(slateNow).toISOString(),
      todayDateKey,
      tomorrowDateKey,
      todayEventCount: todayEvents.length,
      todayPregameEligibleCount: todayPregameEligible.length,
      tomorrowEventCount: tomorrowEvents.length,
      chosenSlateDateKey,
      chosenEventCount: scheduledEvents.length,
      chosenEvents: scheduledEvents.map((e) => ({
        eventId: e?.id || e?.eventId || null,
        matchup: `${e?.away_team || e?.awayTeam || "?"} @ ${e?.home_team || e?.homeTeam || "?"}`
      }))
    })

    console.log("[REFRESH-STAGE-1-SCHEDULED-EVENTS]", {
      scheduledEvents: Array.isArray(scheduledEvents) ? scheduledEvents.length : -1,
      sampleEventIds: Array.isArray(scheduledEvents) ? scheduledEvents.slice(0, 5).map((e) => e?.id || e?.eventId || null) : [],
      sampleMatchups: Array.isArray(scheduledEvents) ? scheduledEvents.slice(0, 5).map((e) => `${e?.away_team || e?.awayTeam || "?"} @ ${e?.home_team || e?.homeTeam || "?"}`) : []
    })

    let dkScopedFetchedEvents = null
    if (ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH) {
      try {
        dkScopedFetchedEvents = await fetchDkScopedEventsForDebug(ODDS_API_KEY)
      } catch (error) {
        const outOfCredits =
          error?.response?.status === 401 &&
          String(error?.response?.data?.error_code || "") === "OUT_OF_USAGE_CREDITS"

        if (outOfCredits) {
          console.log("[DK-SCOPED-EVENTS-DEBUG-SKIPPED] out of usage credits", {
            status: error?.response?.status || null,
            errorCode: error?.response?.data?.error_code || null,
            message: error?.response?.data?.message || error?.message || null
          })
          dkScopedFetchedEvents = null
        } else {
          throw error
        }
      }
    } else {
      console.log("[DK-SCOPED-EVENTS-DEBUG-SKIPPED] disabled by ENABLE_DK_SCOPED_ODDS_DEBUG_FETCH=false")
    }
    const {
      scheduledEvents: dkScopedScheduledEvents
    } = dkScopedFetchedEvents != null ? await buildSlateEvents({
      oddsApiKey: ODDS_API_KEY,
      now: Date.now(),
      events: dkScopedFetchedEvents
    }) : { scheduledEvents: [] }

    const unrestrictedEventIds = [...new Set((Array.isArray(allEvents) ? allEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const scheduledEventIds = [...new Set((Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const dkScopedEventIds = [...new Set((Array.isArray(dkScopedScheduledEvents) ? dkScopedScheduledEvents : []).map((event) => getEventIdForDebug(event)).filter(Boolean))]
    const rawApiEventIds = dkScopedEventIds
    const missingFromDkButInScheduled = scheduledEventIds.filter((eventId) => !dkScopedEventIds.includes(eventId))
    if (!scheduledEvents.length) {
      return res.status(404).json({
        error: "No upcoming NBA games found for the primary slate"
      })
    }
    const primarySlateDateLocal = scheduledEvents[0]
      ? new Date(getEventTimeForDebug(scheduledEvents[0])).toLocaleDateString("en-US", {
          timeZone: "America/Detroit"
        })
      : null
    console.log("[EVENT-FETCH-INTEGRITY-DEBUG]", {
      unrestrictedEventFetchCount: unrestrictedEventIds.length,
      unrestrictedEventIds,
      scheduledEventCount: scheduledEvents.length,
      scheduledEventIds,
      dkScopedEventFetchCount: dkScopedEventIds.length,
      dkScopedEventIds,
      missingFromDkButInScheduled
    })
    console.log("[EVENT-FETCH-MATCHUP-INTEGRITY-DEBUG]", {
      scheduledMatchups: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => getEventMatchupForDebug(event)),
      dkScopedMatchups: (Array.isArray(dkScopedScheduledEvents) ? dkScopedScheduledEvents : []).map((event) => getEventMatchupForDebug(event)),
      missingScheduledMatchupsFromDk: (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .filter((event) => missingFromDkButInScheduled.includes(getEventIdForDebug(event)))
        .map((event) => getEventMatchupForDebug(event))
    })
    console.log("[RAW-PROPS-PIPELINE-START]", {
      scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      eventIds: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => String(event?.id || event?.eventId || "")).filter(Boolean),
      matchups: (Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => {
        const away = event?.away_team || event?.awayTeam || ""
        const home = event?.home_team || event?.homeTeam || ""
        return away && home ? `${away} @ ${home}` : String(event?.matchup || "")
      }).filter(Boolean)
    })
    console.log("[TOP-DOWN-RAW-PROPS-INPUT]", {
      inputCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : -1,
      sampleEventIds: Array.isArray(scheduledEvents)
        ? scheduledEvents.slice(0, 5).map((item) => item?.id || item?.eventId || null)
        : [],
      sampleMatchups: Array.isArray(scheduledEvents)
        ? scheduledEvents.slice(0, 5).map((item) => `${item?.away_team || item?.awayTeam || "?"} @ ${item?.home_team || item?.homeTeam || "?"}`)
        : []
    })
    let cleaned = []
    const eventIngestDebug = []
    const previousOpenMap = new Map(
      (oddsSnapshot.props || []).map((row) => {
        const key = [row.eventId, row.player, row.propType, row.side, row.book].join("|")
        return [
          key,
          {
            openingLine: Number.isFinite(Number(row.openingLine)) ? Number(row.openingLine) : Number(row.line),
            openingOdds: Number.isFinite(Number(row.openingOdds)) ? Number(row.openingOdds) : Number(row.odds)
          }
        ]
      })
    )
    const dkRequestedMarkets = ALL_DK_MARKETS
    const scheduledEventRecords = (Array.isArray(scheduledEvents) ? scheduledEvents : [])
      .map((event) => ({
        eventId: String(event?.eventId || event?.id || ""),
        matchup: String(event?.matchup || getEventMatchupForDebug(event) || ""),
        gameTime: event?.gameTime || event?.commence_time || event?.startTime || null
      }))
      .filter((event) => event.eventId)
    const scheduledEventMap = new Map(
      (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .map((event) => [String(event?.eventId || event?.id || ""), event])
        .filter(([eventId]) => Boolean(eventId))
    )
    const settledEventAttempts = await Promise.allSettled(
      scheduledEventRecords.map(async (scheduledRecord) => {
        const sourceEvent = scheduledEventMap.get(scheduledRecord.eventId)
        if (!sourceEvent) {
          return {
            eventId: scheduledRecord.eventId,
            matchup: scheduledRecord.matchup,
            ok: false,
            empty: false,
            errorMessage: "scheduled_event_not_found",
            responseBookmakersCount: 0,
            responseMarketsCount: 0,
            normalizedRowsCount: 0,
            normalizedRows: [],
            responseReceived: false,
            requestedMarkets: dkRequestedMarkets,
            _allRows: [],
            _fetchDebug: {}
          }
        }

        const fetched = await fetchEventPlayerPropsWithCoverage(sourceEvent, previousOpenMap, {
          pathLabel: "refresh-snapshot"
        })
        const allRows = Array.isArray(fetched?.rows) ? [...fetched.rows] : []
        if (Boolean(fetched?.extraMarketsFetchSucceeded)) {
          allRows.push(...(Array.isArray(fetched?.extraRawRows) ? fetched.extraRawRows : []))
        }
        const fetchDebug = fetched?.debug || {}
        const normalizedRows = allRows.filter((row) => isActiveBook(row?.book))
        const responseBookmakersCount = Number(fetchDebug?.dkBookmakerEntries || 0)
        const responseMarketsCount = Number(fetchDebug?.dkMarketEntries || 0)

        console.log("[DK-EVENT-COVERAGE-CHECK]", {
          eventId: sourceEvent?.id || sourceEvent?.eventId,
          matchup: `${sourceEvent?.away_team || sourceEvent?.awayTeam || "?"} @ ${sourceEvent?.home_team || sourceEvent?.homeTeam || "?"}`,
          hasResponse: Boolean(fetched),
          bookmakerCount: responseBookmakersCount,
          bookmakerKeys: Array.isArray(fetchDebug?.allBookmakerSummary)
            ? fetchDebug.allBookmakerSummary.map(b => b?.key || b?.title || null)
            : [],
          hasDraftKings: responseBookmakersCount > 0,
          marketCount: responseMarketsCount,
          dkMarketKeys: Array.isArray(fetchDebug?.dkMarketKeysSeen) ? fetchDebug.dkMarketKeysSeen : [],
          normalizedRowCount: normalizedRows.length,
          totalRowCount: allRows.length
        })

        if (responseBookmakersCount === 0 || responseMarketsCount === 0) {
          console.log("[DK-EVENT-NO-DATA]", {
            eventId: sourceEvent?.id || sourceEvent?.eventId,
            matchup: `${sourceEvent?.away_team || sourceEvent?.awayTeam || "?"} @ ${sourceEvent?.home_team || sourceEvent?.homeTeam || "?"}`,
            bookmakerCount: responseBookmakersCount,
            marketCount: responseMarketsCount,
            fetchDebugKeys: Object.keys(fetchDebug),
            primaryBooksSeen: fetchDebug?.primary?.booksSeen || [],
            primaryAccepted: fetchDebug?.primary?.acceptedRows || 0,
            primaryRejected: fetchDebug?.primary?.rejectedRows || 0,
            primaryDropReasons: fetchDebug?.primary?.dropReasonCounts || {}
          })
        }

        const normalizedRowsCount = normalizedRows.length
        const empty = responseBookmakersCount === 0 || responseMarketsCount === 0 || normalizedRowsCount === 0

        return {
          eventId: scheduledRecord.eventId,
          matchup: scheduledRecord.matchup,
          ok: true,
          empty,
          errorMessage: null,
          responseBookmakersCount,
          responseMarketsCount,
          normalizedRowsCount,
          normalizedRows,
          responseReceived: true,
          requestedMarkets: Array.isArray(fetchDebug?.requestedMarkets) && fetchDebug.requestedMarkets.length
            ? fetchDebug.requestedMarkets
            : dkRequestedMarkets,
          normalizedFirstBasketRows: Array.isArray(fetched?.normalizedFirstBasketRows) ? fetched.normalizedFirstBasketRows : [],
          _allRows: allRows,
          _fetchDebug: fetchDebug
        }
      })
    )
    const eventResults = settledEventAttempts.map((settled, index) => {
      const scheduledRecord = scheduledEventRecords[index] || { eventId: "", matchup: "" }
      if (settled.status === "fulfilled") {
        return settled.value
      }
      const reason = settled.reason || {}
      return {
        eventId: scheduledRecord.eventId,
        matchup: scheduledRecord.matchup,
        ok: false,
        empty: false,
        errorMessage: String(reason?.response?.data?.message || reason?.response?.data?.error || reason?.message || reason || "unknown_error"),
        responseBookmakersCount: 0,
        responseMarketsCount: 0,
        normalizedRowsCount: 0,
        normalizedRows: [],
        responseReceived: Boolean(reason?.response || reason?.__dkFetchMeta?.responseReceived),
        requestedMarkets: Array.isArray(reason?.__dkFetchMeta?.requestedMarkets) && reason.__dkFetchMeta.requestedMarkets.length
          ? reason.__dkFetchMeta.requestedMarkets
          : dkRequestedMarkets,
        normalizedFirstBasketRows: [],
        _allRows: [],
        _fetchDebug: {}
      }
    })
    console.log("[NBA FETCH]", {
      phase: "odds_batch",
      eventsScheduled: scheduledEventRecords.length,
      oddsResponsesReceived: eventResults.filter((r) => r.responseReceived).length,
      perEventOddsOk: eventResults.filter((r) => r.ok).length,
      normalizedRowsActiveBook: eventResults.reduce((sum, r) => sum + (Number(r.normalizedRowsCount) || 0), 0),
      fetchErrors: eventResults.filter((r) => !r.ok).length
    })
    console.log("[DK-EVENT-ATTEMPT-SUMMARY]", {
      scheduledEventCount: scheduledEventRecords.length,
      attemptedEventCount: eventResults.length,
      successCount: eventResults.filter((result) => result.ok).length,
      emptyCount: eventResults.filter((result) => result.ok && result.empty).length,
      errorCount: eventResults.filter((result) => !result.ok).length,
      rowBackedEventCount: eventResults.filter((result) => (result.normalizedRowsCount || 0) > 0).length,
      missingEventAttempts: scheduledEventRecords
        .filter((scheduledRecord) => !eventResults.some((result) => result.eventId === scheduledRecord.eventId))
        .map((scheduledRecord) => ({ eventId: scheduledRecord.eventId, matchup: scheduledRecord.matchup }))
    })
    console.log("[DK-EVENT-ATTEMPT-DETAILS]", eventResults.map((result) => ({
      eventId: result.eventId,
      matchup: result.matchup,
      ok: result.ok,
      empty: result.empty,
      errorMessage: result.errorMessage,
      responseBookmakersCount: result.responseBookmakersCount,
      responseMarketsCount: result.responseMarketsCount,
      normalizedRowsCount: result.normalizedRowsCount
    })))
    for (const eventResult of eventResults) {
      if (eventResult.ok && (eventResult.normalizedRowsCount || 0) > 0) {
        console.log("[DK-EVENT-FETCH-SUCCESS]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      } else if (eventResult.ok) {
        console.log("[DK-EVENT-FETCH-EMPTY]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      } else {
        console.log("[DK-EVENT-FETCH-ERROR]", {
          eventId: eventResult.eventId,
          matchup: eventResult.matchup,
          requestedMarkets: eventResult.requestedMarkets,
          responseReceived: eventResult.responseReceived,
          bookmakerEntries: eventResult.responseBookmakersCount,
          marketEntries: eventResult.responseMarketsCount,
          normalizedRowsProduced: eventResult.normalizedRowsCount
        })
      }
    }
    console.log("[REFRESH-STAGE-2-FETCHED-EVENT-ODDS]", {
      fetchedEvents: Array.isArray(eventResults) ? eventResults.length : -1,
      sampleEventIds: Array.isArray(eventResults) ? eventResults.slice(0, 5).map((e) => e?.eventId || null) : [],
      sampleBookmakerCounts: Array.isArray(eventResults) ? eventResults.slice(0, 5).map((e) => e?.responseBookmakersCount || 0) : [],
      sampleMarketCounts: Array.isArray(eventResults) ? eventResults.slice(0, 5).map((e) => e?.responseMarketsCount || 0) : [],
      sampleNormalizedRowCounts: Array.isArray(eventResults) ? eventResults.slice(0, 5).map((e) => e?.normalizedRowsCount || 0) : [],
      totalNormalizedRows: Array.isArray(eventResults) ? eventResults.reduce((sum, e) => sum + (e?.normalizedRowsCount || 0), 0) : 0,
      erroredEvents: Array.isArray(eventResults) ? eventResults.filter((e) => !e?.ok).map((e) => ({ eventId: e?.eventId, matchup: e?.matchup, error: e?.errorMessage })) : [],
      firstEventBookmakers: (() => {
        const first = eventResults[0]?._fetchDebug?.allBookmakerSummary
        return Array.isArray(first) ? first.map((b) => ({
          key: b?.key || null,
          title: b?.title || null,
          marketCount: b?.marketCount || 0,
          sampleMarketKeys: Array.isArray(b?.sampleMarketKeys) ? b.sampleMarketKeys.slice(0, 10) : []
        })) : []
      })()
    })
    const dkFetchAudit = Array.isArray(eventResults)
      ? eventResults.slice(0, 10).map((r) => {
          const debug = r._fetchDebug || {}
          return {
            eventId: r.eventId || null,
            matchup: r.matchup || null,
            bookmakerCount: debug.primary?.bookmakerCount || 0,
            booksSeen: debug.primary?.booksSeen || [],
            hasDraftKings: (debug.dkBookmakerEntries || 0) > 0,
            dkMarketCount: debug.dkMarketEntries || 0,
            dkNormalizedRows: debug.dkNormalizedRowsProduced || 0,
            dkSampleMarketKeys: Array.isArray(debug.dkMarketKeysSeen) ? debug.dkMarketKeysSeen.slice(0, 15) : [],
            requestedMarkets: debug.requestedMarkets || [],
            dropReasonCounts: debug.primary?.dropReasonCounts || {},
            acceptedRows: debug.primary?.acceptedRows || 0,
            rejectedRows: debug.primary?.rejectedRows || 0
          }
        })
      : []
    console.log("[REFRESH-STAGE-2B-DK-AUDIT]", dkFetchAudit)

    const quotaExceededDuringRefresh = Array.isArray(eventResults)
      ? eventResults.some((attempt) => {
          const message = String(attempt?.errorMessage || "")
          return message.includes("Usage quota has been reached") || message.includes("OUT_OF_USAGE_CREDITS")
        })
      : false

    if (quotaExceededDuringRefresh) {
      const fallbackRawProps = Array.isArray(preferredSnapshotFallback?.rawProps) ? preferredSnapshotFallback.rawProps.length : 0
      const fallbackBestProps = Array.isArray(preferredSnapshotFallback?.bestProps) ? preferredSnapshotFallback.bestProps.length : 0
      const fallbackProps = Array.isArray(preferredSnapshotFallback?.props) ? preferredSnapshotFallback.props.length : 0

      console.log("[REFRESH-QUOTA-PRESERVE-SNAPSHOT]", {
        fallbackRawProps,
        fallbackProps,
        fallbackBestProps,
        usingDiskFallback: getSnapshotStrength(diskSnapshotFallback) > getSnapshotStrength(currentSnapshotFallback),
        usingMemoryFallback: getSnapshotStrength(currentSnapshotFallback) >= getSnapshotStrength(diskSnapshotFallback)
      })

      if (preferredSnapshotFallback && (fallbackRawProps > 0 || fallbackBestProps > 0 || fallbackProps > 0)) {
        oddsSnapshot = preferredSnapshotFallback
        lastSnapshotSource = "quota-preserved-cache"

        return res.status(200).json({
          ok: true,
          message: "Live refresh skipped because Odds API quota is exhausted; preserved cached snapshot",
          snapshotMeta: buildSnapshotMeta({ source: "quota-preserved-cache" }),
          counts: {
            rawProps: fallbackRawProps,
            props: fallbackProps,
            bestProps: fallbackBestProps
          }
        })
      }

      return res.status(503).json({
        ok: false,
        error: "Odds API quota exhausted and no usable cached snapshot is available",
        snapshotMeta: buildSnapshotMeta({ source: "quota-exhausted-no-cache" })
      })
    }

    const rawDraftKingsRows = eventResults.flatMap((result) =>
      Array.isArray(result.normalizedRows) ? result.normalizedRows : []
    )
    const normalizedFirstBasketRows = eventResults.flatMap((result) =>
      Array.isArray(result.normalizedFirstBasketRows) ? result.normalizedFirstBasketRows : []
    )
    cleaned = dedupeByLegSignature([
      ...rawDraftKingsRows,
      ...normalizedFirstBasketRows
    ])
    console.log("[RAW-FIRST-BASKET-INGESTION-DEBUG]", {
      total: Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows.length : 0,
      byEventId: (Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : []).reduce((acc, row) => {
        const key = String(row?.eventId || "missing")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byMatchup: (Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : []).reduce((acc, row) => {
        const key = String(row?.matchup || "missing")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      sample: (Array.isArray(normalizedFirstBasketRows) ? normalizedFirstBasketRows : []).slice(0, 20).map((row) => ({
        eventId: row?.eventId || null,
        matchup: row?.matchup || null,
        player: row?.player || null,
        team: row?.team || null,
        marketKey: row?.marketKey || null,
        propType: row?.propType || null,
        odds: row?.odds ?? null
      }))
    })
    for (const eventResult of eventResults) {
      const allRows = Array.isArray(eventResult?._allRows) ? eventResult._allRows : []
      const fetchDebug = eventResult?._fetchDebug || {}
      eventIngestDebug.push({
        ...fetchDebug,
        path: "refresh-snapshot",
        eventId: eventResult.eventId,
        matchup: eventResult.matchup,
        requestedMarkets: eventResult.requestedMarkets,
        responseReceived: eventResult.responseReceived,
        dkRequestSucceeded: eventResult.ok,
        dkBookmakerEntries: eventResult.responseBookmakersCount,
        dkMarketEntries: eventResult.responseMarketsCount,
        dkNormalizedRowsProduced: eventResult.normalizedRowsCount,
        normalizedRowsProduced: allRows.length,
        dkFetchError: !eventResult.ok,
        error: eventResult.errorMessage,
        finalAcceptedRows: allRows.length
      })
    }
    const dkAttemptedEventIdSet = new Set(eventResults.map((result) => String(result?.eventId || "")).filter(Boolean))
    const dkRowBackedEventIdSetFromAttempts = new Set(
      eventResults
        .filter((result) => Number(result?.normalizedRowsCount || 0) > 0)
        .map((result) => String(result?.eventId || ""))
        .filter(Boolean)
    )
    console.log("[DK-ATTEMPT-VS-ROW-COVERAGE]", {
      scheduledEventCount: scheduledEventRecords.length,
      attemptedEventCount: dkAttemptedEventIdSet.size,
      rowBackedEventCount: dkRowBackedEventIdSetFromAttempts.size,
      attemptedWithoutRows: eventResults
        .filter((result) => result.ok && (result.normalizedRowsCount || 0) === 0)
        .map((result) => ({ eventId: result.eventId, matchup: result.matchup })),
      failedAttempts: eventResults
        .filter((result) => !result.ok)
        .map((result) => ({ eventId: result.eventId, matchup: result.matchup, errorMessage: result.errorMessage }))
    })

    const previousRowsForCarry = dedupeByLegSignature([
      ...(Array.isArray(previousSnapshotForCarry?.rawProps) ? previousSnapshotForCarry.rawProps : []),
      ...(Array.isArray(previousSnapshotForCarry?.props) ? previousSnapshotForCarry.props : [])
    ])
    const preCarryEventIds = [...new Set(cleaned.map((row) => String(row?.eventId || "")).filter(Boolean))]
    const slateDateKey = scheduledEvents[0] ? getLocalSlateDateKey(getEventTimeForDebug(scheduledEvents[0])) : ""
    const unstableMissingBeforeCarry = UNSTABLE_GAME_EVENT_IDS.filter((eventId) => {
      return scheduledEventIds.includes(eventId) && !preCarryEventIds.includes(eventId)
    })
    const carryForwardRows = previousRowsForCarry
      .filter((row) => unstableMissingBeforeCarry.includes(String(row?.eventId || "")))
      .filter((row) => {
        if (!slateDateKey) return true
        try {
          return getLocalSlateDateKey(row?.gameTime) === slateDateKey
        } catch (_) {
          return false
        }
      })
      .filter((row) => {
        try {
          return isPregameEligibleRow(row)
        } catch (_) {
          return false
        }
      })
      .map((row) => ({ ...row, staleCarryForward: true }))

    if (carryForwardRows.length > 0) cleaned.push(...carryForwardRows)

    console.log("[UNSTABLE-GAME-CARRY-FORWARD-DEBUG]", {
      path: "refresh-snapshot",
      events: UNSTABLE_GAME_EVENT_IDS.map((eventId) => ({
        eventId,
        carriedRows: carryForwardRows.filter((row) => String(row?.eventId || "") === eventId).length
      }))
    })

    let rawIngestedProps = dedupeByLegSignature(cleaned)
    let rawPropsRows = rawIngestedProps

    // Team field is required by multiple downstream gates/boards. If ingestion omitted it,
    // repair using existing per-row context without guessing stats.
    const countMissingBefore = (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
      return acc + (row && !row?.team ? 1 : 0)
    }, 0)

    if (countMissingBefore > 0) {
      rawPropsRows = (Array.isArray(rawPropsRows) ? rawPropsRows : []).map((row) => {
        if (!row || row.team) return row
        const playerTeam = String(row?.playerTeam || "").trim()
        if (playerTeam) return { ...row, team: playerTeam }
        if (row?.homeTeam && row?.awayTeam) {
          // Fallback: preserve pipeline continuity when feeds omit playerTeam.
          return { ...row, team: row.homeTeam }
        }
        return row
      })
    }

    const countMissingAfter = (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
      return acc + (row && !row?.team ? 1 : 0)
    }, 0)

    console.log("[TEAM FIX APPLIED]", {
      beforeMissing: countMissingBefore,
      afterMissing: countMissingAfter
    })

    console.log("[TOP-DOWN-RAW-PROPS-SOURCE]", {
      cleanedCount: Array.isArray(cleaned) ? cleaned.length : -1,
      rawPropsCount: Array.isArray(rawPropsRows) ? rawPropsRows.length : -1,
      byBook: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.book || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      byPropType: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.propType || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      byMarketKey: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.marketKey || "unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      sampleRows: Array.isArray(rawPropsRows)
        ? rawPropsRows.slice(0, 5).map((row) => ({
            eventId: row?.eventId || null,
            matchup: row?.matchup || null,
            book: row?.book || null,
            player: row?.player || null,
            propType: row?.propType || null,
            side: row?.side || null,
            line: row?.line ?? null,
            marketKey: row?.marketKey || null
          }))
        : []
    })

    console.log("[REFRESH-STAGE-3A-PRE-EXTRA-MARKETS]", {
      rawIngestedProps: Array.isArray(rawIngestedProps) ? rawIngestedProps.length : -1,
      byBook: Array.isArray(rawIngestedProps)
        ? rawIngestedProps.reduce((acc, row) => {
            const key = String(row?.book || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {}
    })

    const normalizeEventRowsFromPayload = (eventPayload, event) => {
      const matchup = buildMatchup(event?.away_team, event?.home_team)
      let rows = []
      const rejectReasonCounts = {}
      const books = Array.isArray(eventPayload?.bookmakers) ? eventPayload.bookmakers : []

      for (const book of books) {
        const markets = Array.isArray(book?.markets) ? book.markets : (Array.isArray(book?.props) ? book.props : [])

        for (const market of markets) {
          const marketKey = String(market?.key || market?.name || "").trim()
          const inferredMarket = inferMarketTypeFromKey(marketKey)
          const propType = normalizePropType(marketKey)
          let normalizedPropType = propType || inferredMarket.internalType || null
          const inferredFamily = inferredMarket.family
          const shouldKeep = Boolean(
            normalizedPropType ||
            inferredFamily === "standard" ||
            inferredFamily === "ladder" ||
            inferredFamily === "special"
          )

          if (!shouldKeep) continue

          const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : (Array.isArray(market?.selections) ? market.selections : [])
          for (const outcome of outcomes) {
            const eventId = String(
              event?.id ||
              event?.eventId ||
              market?.eventId ||
              book?.eventId ||
              ""
            ).trim()
            const sideRaw = String(outcome?.name || outcome?.label || outcome?.side || "").trim()
            const rawDescription = String(outcome?.description || "").trim()
            let side = sideRaw === "over" || sideRaw === "Over" ? "Over" : (sideRaw === "under" || sideRaw === "Under" ? "Under" : sideRaw)

            // For special/ladder markets, normalize Yes/No and treat player-name sides as "Yes"
            if (inferredFamily === "special" || inferredFamily === "ladder") {
              const sideLower = side.toLowerCase()
              if (sideLower === "yes") side = "Yes"
              else if (sideLower === "no") side = "No"
              else if (side !== "Over" && side !== "Under") side = "Yes"
            }

            let player = rawDescription || String(outcome?.participant || "").trim() || String(outcome?.player || "").trim()
            player = String(player || "").trim()

            const bookName = String(book?.title || book?.key || book?.name || "").trim()
            const currentLine = Number(outcome?.point ?? outcome?.line ?? outcome?.handicap ?? outcome?.total)
            const currentOdds = Number(outcome?.price ?? outcome?.odds ?? outcome?.american_odds)

            const draftRow = {
              eventId,
              matchup,
              awayTeam: event?.away_team || event?.awayTeam || event?.teams?.[0] || "",
              homeTeam: event?.home_team || event?.homeTeam || event?.teams?.[1] || "",
              gameTime: getEventTimeForDebug(event) || "",
              book: bookName,
              marketKey,
              marketFamily: inferredFamily,
              propType: normalizedPropType,
              player,
              side,
              playerStatus: getManualPlayerStatus(player),
              line: currentLine,
              odds: currentOdds,
              openingLine: currentLine,
              openingOdds: currentOdds,
              lineMove: 0,
              oddsMove: 0,
              marketMovementTag: "neutral",
              // line integrity fields (to be set below)
              currentLine: currentLine,
              isPrimaryLine: false,
              propVariant: outcome?.propVariant || null
            }

            const rejectReason = getIngestRejectReason(draftRow)
            if (rejectReason) {
              rejectReasonCounts[rejectReason] = (rejectReasonCounts[rejectReason] || 0) + 1
              continue
            }

            rows.push(draftRow)
          }
        }
      }

      const totalRejected = Object.values(rejectReasonCounts).reduce((s, n) => s + n, 0)
      if (totalRejected > 0 || rows.length === 0) {
        console.log("[INGEST-REJECT-REASONS-EXTRA-MKT]", {
          eventId: event?.id,
          matchup,
          accepted: rows.length,
          rejected: totalRejected,
          reasons: rejectReasonCounts
        })
      }

      return rows
    }

    let extraRawRows = []
    if (ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH) {
      extraRawRows = await buildExtraMarketRowsForEvents({
        scheduledEvents,
        oddsApiKey: ODDS_API_KEY,
        normalizeEventRows: normalizeEventRowsFromPayload
      })
    } else {
      console.log("[DK-EXTRA-MARKETS-REFETCH-SKIPPED] disabled by ENABLE_NBA_POST_EVENT_EXTRA_MARKET_REFETCH=false")
    }

    rawPropsRows = dedupeMarketRows([
      ...(Array.isArray(rawPropsRows) ? rawPropsRows : []),
      ...(Array.isArray(extraRawRows) ? extraRawRows : [])
    ])
    console.log("[REFRESH-STAGE-3-NORMALIZED-RAW-PROPS]", {
      rawProps: Array.isArray(rawPropsRows) ? rawPropsRows.length : -1,
      extraRawRows: Array.isArray(extraRawRows) ? extraRawRows.length : -1,
      byBook: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.book || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      byPropType: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.propType || "Unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      byMarketKey: Array.isArray(rawPropsRows)
        ? rawPropsRows.reduce((acc, row) => {
            const key = String(row?.marketKey || "unknown")
            acc[key] = (acc[key] || 0) + 1
            return acc
          }, {})
        : {},
      sampleRows: Array.isArray(rawPropsRows) ? rawPropsRows.slice(0, 5).map((row) => ({
        eventId: row?.eventId || null,
        matchup: row?.matchup || null,
        book: row?.book || null,
        player: row?.player || null,
        propType: row?.propType || null,
        side: row?.side || null,
        line: row?.line ?? null,
        marketKey: row?.marketKey || null
      })) : []
    })
    console.log("[NBA FILTER TRACE]", {
      stage: "rawProps",
      count: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0
    })
    const scheduledEventIdSet = new Set(
      (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .map((event) => String(event?.eventId || event?.id || ""))
        .filter(Boolean)
    )
    const rawDraftKingsEventIdSet = new Set(
      (Array.isArray(rawPropsRows) ? rawPropsRows : [])
        .filter((row) => String(row?.book || "") === "DraftKings")
        .map((row) => String(row?.eventId || ""))
        .filter(Boolean)
    )
    const missingDraftKingsEventIds = [...scheduledEventIdSet].filter((id) => !rawDraftKingsEventIdSet.has(id))
    console.log("[DK-RAW-COVERAGE-DEBUG]", {
      scheduledEventCount: scheduledEventIdSet.size,
      rawDraftKingsEventCount: rawDraftKingsEventIdSet.size,
      missingDraftKingsEventIds
    })
    console.log("[DK-RAW-COVERAGE-MATCHUPS]", {
      missingMatchups: (Array.isArray(scheduledEvents) ? scheduledEvents : [])
        .filter((event) => !rawDraftKingsEventIdSet.has(String(event?.eventId || event?.id || "")))
        .map((event) => ({
          eventId: String(event?.eventId || event?.id || ""),
          matchup: String(event?.matchup || getEventMatchupForDebug(event) || ""),
          gameTime: event?.gameTime || event?.commence_time || event?.startTime || null
        }))
    })
    const dkAttemptedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkFetchedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => item?.dkRequestSucceeded === true)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkRowBackedEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => Number(item?.dkNormalizedRowsProduced || 0) > 0)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    const dkErroredEventIds = new Set(
      (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
        .filter((item) => item?.dkFetchError === true)
        .map((item) => String(item?.eventId || ""))
        .filter(Boolean)
    )
    console.log("[DK-EVENT-FETCH-VS-ROWS]", {
      dkFetchedEventCount: dkFetchedEventIds.size,
      dkRowBackedEventCount: dkRowBackedEventIds.size,
      fetchedWithoutRows: [...dkFetchedEventIds].filter((id) => !dkRowBackedEventIds.has(id)),
      dkErroredEventIds: [...dkErroredEventIds],
      neverAttemptedEventIds: [...scheduledEventIdSet].filter((id) => !dkAttemptedEventIds.has(id))
    })

    console.log("[NORMALIZATION-MARKET-FAMILY-DEBUG]", summarizeInterestingNormalizedRows(rawPropsRows || []))
    const activeBookRawPropsRows = (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => isActiveBook(row?.book))
    console.log("[ACTIVE-BOOK-FILTER-DEBUG]", {
      activeBooks: ACTIVE_BOOKS,
      before: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      after: activeBookRawPropsRows.length,
      byBook: activeBookRawPropsRows.reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    console.log("[NBA FILTER TRACE]", {
      stage: "after_normalize",
      count: activeBookRawPropsRows.length,
      note: "active-book rows (isActiveBook)"
    })
    const coveredEventIds = new Set(
      (Array.isArray(rawPropsRows) ? rawPropsRows : [])
        .map((row) => String(row?.eventId || ""))
        .filter(Boolean)
    )

    const coveredEvents = (Array.isArray(scheduledEvents) ? scheduledEvents : []).filter((event) => {
      const eventId = getEventIdForDebug(event)
      return eventId && coveredEventIds.has(eventId)
    })

    const missingScheduledEvents = (Array.isArray(scheduledEvents) ? scheduledEvents : []).filter((event) => {
      const eventId = getEventIdForDebug(event)
      return !eventId || !coveredEventIds.has(eventId)
    })

    console.log("[EVENT-COVERAGE-SNAPSHOT-DEBUG]", {
      scheduledCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      coveredCount: coveredEvents.length,
      missingCount: missingScheduledEvents.length,
      coveredMatchups: coveredEvents.map((event) => getEventMatchupForDebug(event)),
      missingMatchups: missingScheduledEvents.map((event) => getEventMatchupForDebug(event))
    })
    console.log("[RAW-PROPS-EVENT-COVERAGE-DEBUG]", {
      totalRows: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      byBook: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.book || "Unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
      byEventId: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.eventId || "")
        if (!key) return acc
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    console.log("[RAW-PROPS-PIPELINE-END]", {
      scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
      totalRawRowsBuilt: Array.isArray(rawPropsRows) ? rawPropsRows.length : 0,
      byBook: {
        FanDuel: (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => row?.book === "FanDuel").length,
        DraftKings: (Array.isArray(rawPropsRows) ? rawPropsRows : []).filter((row) => row?.book === "DraftKings").length
      },
      byEventId: (Array.isArray(rawPropsRows) ? rawPropsRows : []).reduce((acc, row) => {
        const key = String(row?.eventId || "")
        if (!key) return acc
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    })
    if (scheduledEvents.length > 0 && rawPropsRows.length === 0) {
      console.log("[RAW-PROPS-ZERO-ROWS-DEBUG]", {
        scheduledEvents: scheduledEvents.map((event) => ({
          eventId: String(event?.id || event?.eventId || ""),
          matchup: (() => {
            const away = event?.away_team || event?.awayTeam || ""
            const home = event?.home_team || event?.homeTeam || ""
            return away && home ? `${away} @ ${home}` : String(event?.matchup || "")
          })()
        }))
      })
    }
    const ingestedEventIds = [...new Set(rawPropsRows.map((row) => String(row?.eventId || "")).filter(Boolean))]
    const missingEventIds = scheduledEventIds.filter((eventId) => !ingestedEventIds.includes(eventId))
    const propsPerEventId = Object.fromEntries(
      scheduledEventIds.map((eventId) => [
        eventId,
        rawPropsRows.filter((row) => String(row?.eventId || "") === eventId).length
      ])
    )

    const ingestApiEventIds = [...new Set(
      eventIngestDebug.flatMap((item) => [
        ...(Array.isArray(item?.apiEventIdsPrimary) ? item.apiEventIdsPrimary : []),
        ...(Array.isArray(item?.apiEventIdsFallback) ? item.apiEventIdsFallback : [])
      ].map((id) => String(id || "")).filter(Boolean))
    )]
    const targetMissingEventStages = UNSTABLE_GAME_EVENT_IDS.map((id) => ({
      eventId: id,
      inScheduledEvents: scheduledEventIds.includes(id),
      inRawApiResponse: rawApiEventIds.includes(id) || ingestApiEventIds.includes(id),
      inMappedRawProps: ingestedEventIds.includes(id),
      inFinalSavedRawProps: false,
      inFinalSavedProps: false,
      mappedRows: rawPropsRows.filter((row) => String(row?.eventId || "") === id).length
    }))

    console.log("[TARGET-MISSING-GAME-INGEST-DEBUG]", {
      path: "refresh-snapshot",
      targets: targetMissingEventStages
    })

    const normalizeIngestPlayer = (value) => String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
    const lukaRawApiCount = eventIngestDebug.reduce((sum, item) => {
      return sum + Number(item?.lukaRawPrimaryCount || 0) + Number(item?.lukaRawFallbackCount || 0)
    }, 0)
    const lukaMappedCount = rawPropsRows.filter((row) => normalizeIngestPlayer(row?.player).includes("doncic")).length

    console.log("[INGEST-LUKA-STAGE-DEBUG]", {
      path: "refresh-snapshot",
      inRawApiResponse: lukaRawApiCount > 0,
      rawApiCount: lukaRawApiCount,
      inMappedRawProps: lukaMappedCount > 0,
      mappedCount: lukaMappedCount
    })

    const debugPipelineStages = {}
    debugPipelineStages.rawNormalized = summarizePropPipelineRows(activeBookRawPropsRows)
    logPropPipelineStep("refresh-snapshot", "raw-normalized-props", activeBookRawPropsRows)
    const pregameStatusRowsForDebug = activeBookRawPropsRows.filter((row) => isPregameEligibleRow(row))
    debugPipelineStages.afterPregameStatus = summarizePropPipelineRows(pregameStatusRowsForDebug)
    logPropPipelineStep("refresh-snapshot", "after-pregame-status-filtering", pregameStatusRowsForDebug)
    const primarySlateRowsForDebug = filterRowsToPrimarySlate(pregameStatusRowsForDebug)
    debugPipelineStages.afterPrimarySlate = summarizePropPipelineRows(primarySlateRowsForDebug)
    logPropPipelineStep("refresh-snapshot", "after-primary-slate-filtering", primarySlateRowsForDebug)

    const playerRows = new Map()
    for (const row of activeBookRawPropsRows) {
      if (!row.player) continue
      if (!playerRows.has(row.player)) playerRows.set(row.player, row)
    }

    const statsCache = new Map()
    const playerTeamMap = new Map()
    const players = Array.from(playerRows.keys())
    const playerResolutionDebug = {
      totalRawPlayerNamesSeen: players.length,
      totalPlayerNamesWithResolvedIds: 0,
      unresolvedPlayerNames: [],
      manualOverrideHitCount: 0,
      looseMatchHitCount: 0,
      missCacheHitCount: 0
    }

    for (let i = 0; i < players.length; i += PLAYER_LOOKUP_CONCURRENCY) {
      const batch = players.slice(i, i + PLAYER_LOOKUP_CONCURRENCY)

      await Promise.all(
        batch.map(async (player) => {
          try {
            if (isManualOverridePlayer(player)) {
              playerResolutionDebug.manualOverrideHitCount += 1
            }

            const sourceRow = playerRows.get(player)
            const expectedTeamCodes = sourceRow
              ? [teamAbbr(sourceRow.awayTeam), teamAbbr(sourceRow.homeTeam)]
              : []

            const cachedPlayerInfo = playerIdCache.get(player)
            if (cachedPlayerInfo?.id && playerStatsCache.has(cachedPlayerInfo.id)) {
              const cachedStats = playerStatsCache.get(cachedPlayerInfo.id) || []
              const recentStats = cachedStats.slice(0, 10)

              const derivedTeamCode = String(
                getTeamOverride(player) ||
                teamAbbr(cachedPlayerInfo.team) ||
                getCurrentTeamCodeFromStats(recentStats) ||
                ""
              ).toUpperCase().trim()

              const expectedSet = new Set(
                expectedTeamCodes
                  .map((code) => String(code || "").toUpperCase().trim())
                  .filter(Boolean)
              )

              if (!expectedSet.size || !derivedTeamCode || expectedSet.has(derivedTeamCode)) {
                statsCache.set(player, recentStats)
                playerTeamMap.set(player, derivedTeamCode)
                playerResolutionDebug.totalPlayerNamesWithResolvedIds += 1
                if (isLooseResolvedMatch(player, cachedPlayerInfo.matchedName || "")) {
                  playerResolutionDebug.looseMatchHitCount += 1
                }
                return
              }

              playerIdCache.delete(player)
            }

            if (playerLookupMissCache.has(player)) {
              playerResolutionDebug.missCacheHitCount += 1
            }

            const playerInfo = await fetchApiSportsPlayerIdCached(player, expectedTeamCodes)
            if (!playerInfo || !playerInfo.id) return

            playerResolutionDebug.totalPlayerNamesWithResolvedIds += 1
            if (isLooseResolvedMatch(player, playerInfo.matchedName || "")) {
              playerResolutionDebug.looseMatchHitCount += 1
            }

            const stats = await fetchApiSportsPlayerStatsCached(playerInfo.id)
            const recentStats = (stats || []).slice(0, 10)

            const derivedTeamCode =
              getTeamOverride(player) ||
              teamAbbr(playerInfo.team) ||
              getCurrentTeamCodeFromStats(recentStats)

            statsCache.set(player, recentStats)
            playerTeamMap.set(player, String(derivedTeamCode || "").toUpperCase())
          } catch (err) {
            playerResolutionDebug.unresolvedPlayerNames.push(player)
            console.error(
              "Snapshot stats failed for",
              player,
              err.response?.data || err.message
            )
          }
        })
      )
    }

    for (const player of players) {
      if (!playerTeamMap.has(player)) {
        playerResolutionDebug.unresolvedPlayerNames.push(player)
      }
    }

    const uniqueUnresolved = Array.from(new Set(playerResolutionDebug.unresolvedPlayerNames))
    logPlayerResolutionDiagnostics("refresh-snapshot", {
      totalRawPlayerNamesSeen: playerResolutionDebug.totalRawPlayerNamesSeen,
      totalPlayerNamesWithResolvedIds: playerResolutionDebug.totalPlayerNamesWithResolvedIds,
      totalUnresolvedPlayerNames: uniqueUnresolved.length,
      sampleUnresolvedPlayerNames: uniqueUnresolved.slice(0, 20),
      manualOverrideHitCount: playerResolutionDebug.manualOverrideHitCount,
      looseMatchHitCount: playerResolutionDebug.looseMatchHitCount,
      missCacheHitCount: playerResolutionDebug.missCacheHitCount
    })

    const enriched = activeBookRawPropsRows.map((row) => {
  const playerName = row.player
  const manualStatus = row.playerStatus || getManualPlayerStatus(playerName) || ""
  const logs = statsCache.get(row.player) || []

  const values = logs
    .map((log) => propValueFromApiSportsLog(log, row.propType))
    .filter((v) => v !== null)

  const mins = logs
    .map((log) => Number(log.min || 0))
    .filter((v) => !Number.isNaN(v) && v > 0)

  const l10Avg = avg(values)
  const avgMin = avg(mins)

  const recent5Values = values.slice(-5)
  const recent3Values = values.slice(-3)
  const recent5Mins = mins.slice(-5)
  const recent3Mins = mins.slice(-3)

  const recent5Avg = avg(recent5Values)
  const recent3Avg = avg(recent3Values)
  const minStd = stddev(mins)
  const valueStd = stddev(values)
  const minFloor = minVal(mins)
  const minCeiling = maxVal(mins)
  const recent5MinAvg = avg(recent5Mins)
  const recent3MinAvg = avg(recent3Mins)

  let hitRate = null
  let edge = null

  if (l10Avg !== null && values.length) {
    if (row.side === "Over") {
      edge = l10Avg - row.line
      hitRate = `${values.filter((v) => v > row.line).length}/${values.length}`
    } else if (row.side === "Under") {
      edge = row.line - l10Avg
      hitRate = `${values.filter((v) => v < row.line).length}/${values.length}`
    }
  }

  const teamCode = String(playerTeamMap.get(row.player) || "").toUpperCase()
  const validTeam =
    teamCode && (
      teamCode === teamAbbr(row.awayTeam) ||
      teamCode === teamAbbr(row.homeTeam)
    )

  const fallbackTeam =
    teamCode ||
    teamAbbr(row.awayTeam) ||
    teamAbbr(row.homeTeam) ||
    ""

  const resolvedTeam = fallbackTeam

  const highTriggers = [
    minFloor !== null && minFloor < 18,
    avgMin !== null && avgMin < 24,
    minStd !== null && minStd >= 8.5
  ].filter(Boolean).length

  const mediumTriggers = [
    minFloor !== null && minFloor < 18,
    avgMin !== null && avgMin < 28,
    minStd !== null && minStd >= 6.5
  ].filter(Boolean).length

  let minutesRisk = "low"

  if (highTriggers >= 2) {
    minutesRisk = "high"
  } else if (highTriggers === 1 || mediumTriggers >= 2) {
    minutesRisk = "medium"
  }

  // apply manual injury / minutes overrides
  if (manualStatus === "out") minutesRisk = "high"
  if (manualStatus === "limited") minutesRisk = "high"
  if (manualStatus === "probable") minutesRisk = minutesRisk === "high" ? "medium" : minutesRisk

  // Trend risk (recent form vs bet direction)
  let trendRisk = "low"

  if (recent3Avg !== null && l10Avg !== null) {
    const trendDelta = recent3Avg - l10Avg

    if (row.side === "Over" && trendDelta < -2) {
      trendRisk = "high"
    } else if (row.side === "Under" && trendDelta > 2) {
      trendRisk = "high"
    } else if (row.side === "Over" && trendDelta < -1) {
      trendRisk = "medium"
    } else if (row.side === "Under" && trendDelta > 1) {
      trendRisk = "medium"
    }
  }

  let injuryRisk = "low"

  const status = String(row.playerStatus || manualStatus || "").toLowerCase()

  if (
    status.includes("questionable") ||
    status.includes("game-time") ||
    status.includes("gtd")
  ) {
    injuryRisk = "high"
  } else if (
    status.includes("probable") ||
    status.includes("returning") ||
    status.includes("minutes")
  ) {
    injuryRisk = "medium"
  }

  return {
    ...row,
    l10Avg: l10Avg === null ? null : Number(l10Avg.toFixed(1)),
    avgMin: avgMin === null ? null : Number(avgMin.toFixed(1)),
    hitRate,
    edge: edge === null ? null : Number(edge.toFixed(1)),
    gamesUsed: values.length,
    recent5Avg: recent5Avg === null ? null : Number(recent5Avg.toFixed(1)),
    recent3Avg: recent3Avg === null ? null : Number(recent3Avg.toFixed(1)),
    minStd: minStd === null ? null : Number(minStd.toFixed(1)),
    valueStd: valueStd === null ? null : Number(valueStd.toFixed(1)),
    minFloor: minFloor === null ? null : Number(minFloor.toFixed(1)),
    minCeiling: minCeiling === null ? null : Number(minCeiling.toFixed(1)),
    recent5MinAvg: recent5MinAvg === null ? null : Number(recent5MinAvg.toFixed(1)),
    recent3MinAvg: recent3MinAvg === null ? null : Number(recent3MinAvg.toFixed(1)),
    minutesRisk,
    trendRisk,
    injuryRisk,
    resolvedTeamCode: teamCode,
    player: row.player,
    team: resolvedTeam,
    eventId: row.eventId,
    matchup: row.matchup,
    awayTeam: row.awayTeam,
    homeTeam: row.homeTeam,
    gameTime: row.gameTime,
    book: row.book,
    propType: row.propType,
    side: row.side,
    line: row.line,
    odds: row.odds,
    openingLine: row.openingLine,
    openingOdds: row.openingOdds,
    marketMovementTag: row.marketMovementTag,
    playerStatus: row.playerStatus,
    isAlt: row.isAlt,
    propVariant: row.propVariant

  }
})

    const enrichedModelRows = Array.isArray(enriched) ? enriched : []

    console.log("[ENRICHMENT-IDENTITY-DEBUG]", summarizeIdentityChanges(rawPropsRows, enrichedModelRows, 25))
    console.log("[BAD-TEAM-RAW-DEBUG]", {
      count: getBadTeamAssignmentRows(rawPropsRows, 25).length,
      byBook: {
        FanDuel: rawPropsRows.filter((row) => row?.book === "FanDuel" && !rowTeamMatchesMatchup(row)).length,
        DraftKings: rawPropsRows.filter((row) => row?.book === "DraftKings" && !rowTeamMatchesMatchup(row)).length
      },
      sample: getBadTeamAssignmentRows(rawPropsRows, 25)
    })
    console.log("[BAD-TEAM-ENRICHED-DEBUG]", {
      count: getBadTeamAssignmentRows(enrichedModelRows, 25).length,
      byBook: {
        FanDuel: enrichedModelRows.filter((row) => row?.book === "FanDuel" && !rowTeamMatchesMatchup(row)).length,
        DraftKings: enrichedModelRows.filter((row) => row?.book === "DraftKings" && !rowTeamMatchesMatchup(row)).length
      },
      sample: getBadTeamAssignmentRows(enrichedModelRows, 25)
    })

    const allBadTeamAssignmentRows = (Array.isArray(enriched) ? enriched : []).filter((row) => !rowTeamMatchesMatchup(row))
    const badTeamAssignmentRows = getBadTeamAssignmentRows(enriched, 25)
    console.log("[BAD-TEAM-ASSIGNMENT-DEBUG]", {
      path: "refresh-snapshot",
      count: allBadTeamAssignmentRows.length,
      byBook: {
        FanDuel: allBadTeamAssignmentRows.filter((r) => r?.book === "FanDuel").length,
        DraftKings: allBadTeamAssignmentRows.filter((r) => r?.book === "DraftKings").length
      },
      sample: badTeamAssignmentRows
    })

    const deduped = dedupeBestProps(enriched)
    debugPipelineStages.afterDedupe = summarizePropPipelineRows(deduped)
  logPropPipelineStep("refresh-snapshot", "after-dedupe", deduped)
    console.log("[NBA FILTER TRACE]", {
      stage: "after_filters",
      count: Array.isArray(deduped) ? deduped.length : 0,
      note: "post enrichment + dedupeBestProps"
    })

// --- Funnel diagnostics: prove which filter drives afterDedupe -> afterScoringRanking drop ---
{
  const _sd0 = Array.isArray(deduped) ? deduped : []
  const _sd1 = _sd0.filter((row) => playerFitsMatchup(row))
  const _sd2 = _sd1.filter((row) => {
    const team = String(row.team || "").toUpperCase().trim()
    return Boolean(team) && (team === teamAbbr(row.awayTeam) || team === teamAbbr(row.homeTeam))
  })
  const _sd3 = _sd2.filter((row) => row.l10Avg !== null)
  const _sd4 = _sd3.filter((row) => row.avgMin !== null && row.avgMin >= 18)
  const _sd4_old = _sd3.filter((row) => row.avgMin !== null && row.avgMin >= 22)
  const _sd5 = _sd4.filter((row) => parseHitRate(row.hitRate) >= 0.5)
  const _sd6 = _sd5.filter((row) => row.gamesUsed >= 6)
  const _sd7 = _sd6.filter((row) => {
    const gameTime = new Date(row.gameTime)
    if (!(gameTime.getTime() > Date.now())) return false
    const localGameDate = gameTime.toLocaleDateString("en-US", { timeZone: "America/Detroit" })
    return !primarySlateDateLocal || localGameDate === primarySlateDateLocal
  })
  const _sd8 = _sd7.filter((row) => {
    const diff = Math.abs(Number(row.line) - Number(row.l10Avg))
    if (row.propType === "Points") return diff <= 10
    if (row.propType === "Rebounds") return diff <= 5
    if (row.propType === "Assists") return diff <= 5
    if (row.propType === "Threes") return diff <= 2.5
    if (row.propType === "PRA") return diff <= 12
    return true
  })
  const _sd9 = _sd8.filter((row) => {
    if (row.propType === "Assists" && Number(row.line) > 11.5) return false
    if (row.propType === "Rebounds" && Number(row.line) > 15.5) return false
    if (row.propType === "Points" && Number(row.line) > 36.5) return false
    if (row.propType === "PRA" && Number(row.line) > 47.5) return false
    return true
  })
  console.log("[SCORED-PROPS-FUNNEL-DEBUG]", {
    f0_deduped: _sd0.length,
    f1_playerFitsMatchup: _sd1.length,
    f2_teamAbbrValidation: _sd2.length,
    f3_l10AvgNotNull: _sd3.length,
    f4_avgMinGe18_new: _sd4.length,
    f4_avgMinGe22_old: _sd4_old.length,
    f4_recoveredByLowering: _sd4.length - _sd4_old.length,
    f5_hitRateGe50pct: _sd5.length,
    f6_gamesUsedGe6: _sd6.length,
    f7_gameDateFilter: _sd7.length,
    f8_lineDiffProximity: _sd8.length,
    f9_maxLineSanity: _sd9.length,
    drops: {
      f1_teamFit: _sd0.length - _sd1.length,
      f2_teamAbbr: _sd1.length - _sd2.length,
      f3_l10Avg: _sd2.length - _sd3.length,
      f4_avgMin_18: _sd3.length - _sd4.length,
      f4_avgMin_22_would_have_dropped: _sd3.length - _sd4_old.length,
      f5_hitRate_50: _sd4.length - _sd5.length,
      f6_gamesUsed: _sd5.length - _sd6.length,
      f7_gameDate: _sd6.length - _sd7.length,
      f8_lineDiff: _sd7.length - _sd8.length,
      f9_maxLine: _sd8.length - _sd9.length
    }
  })
}

const scoredPropsSlateMode = detectSlateMode({
  sportKey: "nba",
  snapshotMeta: { snapshotSlateGameCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0 },
  snapshot: { events: scheduledEvents, rawProps: rawPropsRows, props: activeBookRawPropsRows, bestProps: [] },
  runtime: { loadedSlateQualityPassEnabled: true }
})
const scoredPropsFilters = (() => {
  const m = String(scoredPropsSlateMode.mode || "").toLowerCase()
  // Thin slate: relax pre-tier eligibility slightly to avoid artificial collapse.
  if (m === "thin") {
    return { minAvgMin: 12, minHitRate: 0.35, minGamesUsed: 3, lineDiffScale: 1.5 }
  }
  return { minAvgMin: 18, minHitRate: 0.5, minGamesUsed: 6, lineDiffScale: 1.0 }
})()
console.log("[SCORED-PROPS-SLATE-FILTERS]", {
  path: "refresh-snapshot",
  mode: scoredPropsSlateMode.mode,
  filters: scoredPropsFilters
})

const scoredProps = deduped
  .filter((row) => playerFitsMatchup(row))
  .filter((row) => {
    const team = String(row.team || "").toUpperCase().trim()
    return Boolean(team) && (
      team === teamAbbr(row.awayTeam) ||
      team === teamAbbr(row.homeTeam)
    )
  })
  .filter((row) => row.l10Avg !== null)
  .filter((row) => row.avgMin !== null && row.avgMin >= scoredPropsFilters.minAvgMin)
  .filter((row) => parseHitRate(row.hitRate) >= scoredPropsFilters.minHitRate)
  .filter((row) => row.gamesUsed >= scoredPropsFilters.minGamesUsed)
  .filter((row) => {
    const thinBad = String(scoredPropsSlateMode.mode || "").toLowerCase() === "thinbad"
    const nowMs = Date.now()
    const gameTime = new Date(row.gameTime)
    const gameMs = gameTime.getTime()
    if (!Number.isFinite(gameMs)) return false

    // Pregame default: keep strict (pre-game only).
    // ThinBad fallback: allow active slate rows so we don't starve to zero.
    if (!thinBad) {
      if (!(gameMs > nowMs)) return false
    } else {
      const inLiveWindow = gameMs > (nowMs - LIVE_SLATE_WINDOW_MS)
      const marketOk = row?.marketValidity === "valid" && row?.odds != null
      if (!inLiveWindow || !marketOk) return false
    }

    const localGameDate = gameTime.toLocaleDateString("en-US", {
      timeZone: "America/Detroit"
    })

    return !primarySlateDateLocal || localGameDate === primarySlateDateLocal
  })
  .filter((row) => {
    const diff = Math.abs(Number(row.line) - Number(row.l10Avg))

    const scale = Number(scoredPropsFilters.lineDiffScale || 1)
    if (row.propType === "Points") return diff <= 10 * scale
    if (row.propType === "Rebounds") return diff <= 5 * scale
    if (row.propType === "Assists") return diff <= 5 * scale
    if (row.propType === "Threes") return diff <= 2.5 * scale
    if (row.propType === "PRA") return diff <= 12 * scale

    return true
  })
  .filter((row) => {
    const thin = String(scoredPropsSlateMode.mode || "").toLowerCase() === "thin"
    if (!thin) {
      if (row.propType === "Assists" && Number(row.line) > 11.5) return false
      if (row.propType === "Rebounds" && Number(row.line) > 15.5) return false
      if (row.propType === "Points" && Number(row.line) > 36.5) return false
      if (row.propType === "PRA" && Number(row.line) > 47.5) return false
      return true
    }
    // Thin: allow slightly wider high-line set to avoid empty boards.
    if (row.propType === "Assists" && Number(row.line) > 12.5) return false
    if (row.propType === "Rebounds" && Number(row.line) > 16.5) return false
    if (row.propType === "Points" && Number(row.line) > 38.5) return false
    if (row.propType === "PRA" && Number(row.line) > 50.5) return false
    return true
  })
  .map((row) => {
    const baseRow = {
      ...row,
      score: scorePropRow(row),
      dvpScore: getDvpScore(getOpponentForRow(row), row.propType)
    }
    const edgeProfile = {
      gameEnvironmentScore: inferGameEnvironmentScore(baseRow),
      matchupEdgeScore: inferMatchupEdgeScore(baseRow),
      bookValueScore: inferBookValueScore(baseRow),
      volatilityScore: inferVolatilityScore(baseRow)
    }
    const betTypeFit = inferBetTypeFit(baseRow, edgeProfile)
    const evidence = buildEvidence(baseRow)
    const whyItRates = buildDataDrivenWhyItRates(baseRow)
    const modelSummary = buildModelSummary(baseRow, evidence, whyItRates)
    const edgeRow = {
      ...baseRow,
      gameEnvironmentScore: edgeProfile.gameEnvironmentScore,
      matchupEdgeScore: edgeProfile.matchupEdgeScore,
      bookValueScore: edgeProfile.bookValueScore,
      volatilityScore: edgeProfile.volatilityScore,
      betTypeFit,
      edgeProfile,
      evidence,
      whyItRates,
      modelSummary
    }
    const ceilingRoleSignals = buildCeilingRoleSpikeSignals(edgeRow)
    const lineupRoleSignals = buildLineupRoleContextSignals(edgeRow)
    const marketContextSignals = buildMarketContextSignals(edgeRow)
    return enrichPredictionLayer({ ...edgeRow, ...ceilingRoleSignals, ...lineupRoleSignals, ...marketContextSignals })
  })
  .filter((row) => {
    const hasCoreData =
      row.team &&
      row.hitRate != null &&
      row.edge != null &&
      row.score != null

    return hasCoreData
  })
  .sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if ((b.edge ?? -999) !== (a.edge ?? -999)) return (b.edge ?? -999) - (a.edge ?? -999)
    return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
  })

console.log("[NBA FILTER TRACE]", {
  stage: "after_scoring",
  count: Array.isArray(scoredProps) ? scoredProps.length : 0,
  note: "tier funnel + scorePropRow + core-data filter"
})

console.log("[CEILING-SIGNAL-STAGE-DEBUG]", {
  path: "refresh-snapshot",
  scoredPropsCount: Array.isArray(scoredProps) ? scoredProps.length : 0,
  scoredWithCeilingScore: (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => Number.isFinite(Number(row?.ceilingScore))).length,
  scoredWithRoleSpikeScore: (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => Number.isFinite(Number(row?.roleSpikeScore))).length
})

console.log("[EDGE-PROFILE-DEBUG]", {
  totalRows: Array.isArray(scoredProps) ? scoredProps.length : 0,
  byBetTypeFit: Array.isArray(scoredProps)
    ? scoredProps.reduce((acc, row) => {
        const key = String(row?.betTypeFit || "unknown")
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    : {},
  sampleRows: Array.isArray(scoredProps)
    ? scoredProps.slice(0, 12).map((row) => ({
        player: row?.player || null,
        team: row?.team || null,
        matchup: row?.matchup || null,
        propType: row?.propType || null,
        marketKey: row?.marketKey || null,
        propVariant: row?.propVariant || "base",
        odds: row?.odds ?? null,
        hitRate: row?.hitRate ?? null,
        edge: row?.edge ?? null,
        gameEnvironmentScore: row?.gameEnvironmentScore ?? null,
        matchupEdgeScore: row?.matchupEdgeScore ?? null,
        bookValueScore: row?.bookValueScore ?? null,
        volatilityScore: row?.volatilityScore ?? null,
        betTypeFit: row?.betTypeFit || null,
        whyItRates: Array.isArray(row?.whyItRates) ? row.whyItRates : []
      }))
    : []
})

console.log("[BOOK-DATA-QUALITY-FILTER]", {
  totalAfterFilter: scoredProps.length,
  byBook: scoredProps.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
})

  debugPipelineStages.afterScoringRanking = summarizePropPipelineRows(scoredProps)
logPropPipelineStep("refresh-snapshot", "after-scoring-ranking", scoredProps)

console.log("[SCORED-PROPS-FILTER-RELAX-DEBUG]", {
  total: scoredProps.length,
  byBook: scoredProps.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  byGame: scoredProps.reduce((acc, row) => {
    const key = String(row?.matchup || row?.eventId || "unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  byProp: scoredProps.reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
})

const normalizeBestPropsEdge = (edge) => clamp((Number(edge || 0) + 2) / 8, 0, 1)
const normalizeBestPropsScore = (score) => clamp(Number(score || 0) / 120, 0, 1)
const getTierEdge = (row) => Number(row.edge ?? row.projectedValue ?? 0)
const getTierScore = (row) => Number(row.score || 0)
const getMinutesRisk = (row) => String(row.minutesRisk || "").toLowerCase()
const getInjuryRisk = (row) => String(row.injuryRisk || "").toLowerCase()
const TIER_BOOKS = ["FanDuel", "DraftKings"]
const TIER_STAT_TYPES = ["Points", "Rebounds", "Assists", "Threes", "PRA"]

const tierThresholdsForSlateMode = (mode) => {
  const m = String(mode || "").toLowerCase()
  // Defaults tuned for normal/light/heavy behavior.
  const base = {
    elite: { minHit: 0.72, minScore: 88, minFloor: 24, maxMinStd: 7.5, maxValueStdBig: 10.5, maxValueStdSmall: 5.5 },
    strong: { minHit: 0.61, minScore: 62, minFloor: 22, maxMinStd: 9.5, maxValueStdBig: 12, maxValueStdSmall: 6.5 },
    playable: { minHit: 0.5, minScore: 42, edgeBad: -0.75, edgeBadScore: 34, hitAlt1: 0.62, hitAlt2: 0.59, edgeAlt2: 0.2, hitAlt3: 0.57, scoreAlt3: 34 },
    bestSource: { minHit: 0.46, minScore: 30, edgeBad: -1.0, edgeBadScore: 30, hitAlt1: 0.53, hitAlt2: 0.56, edgeAlt2: 0.05 }
  }

  // Thin slates: relax proportionally to prevent collapse, without flat overriding.
  // We keep lane separation by only slightly lowering floors and allowing a
  // "ceiling-supported" elite/strong path.
  if (m === "thin") {
    return {
      ...base,
      elite: { ...base.elite, minHit: 0.69, minScore: 84, minFloor: 22, maxMinStd: 8.5, maxValueStdBig: 12.0, maxValueStdSmall: 6.2 },
      strong: { ...base.strong, minHit: 0.58, minScore: 56, minFloor: 20, maxMinStd: 10.5, maxValueStdBig: 13.5, maxValueStdSmall: 7.2 },
      playable: { ...base.playable, minScore: 38, hitAlt1: 0.60, hitAlt2: 0.57, hitAlt3: 0.55, scoreAlt3: 32, edgeBadScore: 32 },
      bestSource: { ...base.bestSource, minHit: 0.44, minScore: 26, hitAlt1: 0.50, hitAlt2: 0.54 }
    }
  }

  return base
}

const qualifiesEliteTier = (row, slateMode) => {
  const t = tierThresholdsForSlateMode(slateMode).elite
  const hit = parseHitRate(row.hitRate)
  const score = getTierScore(row)
  const valueStdCap = (row.propType === "Points" || row.propType === "PRA") ? t.maxValueStdBig : t.maxValueStdSmall

  const baseGate = (
    hit >= t.minHit &&
    score >= t.minScore &&
    (row.minFloor === null || row.minFloor >= t.minFloor) &&
    (row.minStd === null || row.minStd <= t.maxMinStd) &&
    (row.valueStd === null || row.valueStd <= valueStdCap)
  )

  if (baseGate) return true

  // Thin-slate exception: allow true ceiling-supported elites through (still quality gated).
  const m = String(slateMode || "").toLowerCase()
  if (m === "thin") {
    const ceilingScore = Number(row?.ceilingScore || 0)
    const lpi = Number(row?.longshotPredictiveIndex || 0)
    const roleSpike = Number(row?.roleSpikeScore || 0)
    if (
      ceilingScore >= 0.7 &&
      (lpi >= 0.18 || roleSpike >= 0.18) &&
      hit >= 0.6 &&
      score >= 74 &&
      (row.minFloor === null || row.minFloor >= 18) &&
      (row.minStd === null || row.minStd <= 10.5)
    ) {
      return true
    }
  }

  return false
}

const qualifiesStrongTier = (row, slateMode) => {
  const t = tierThresholdsForSlateMode(slateMode).strong
  const hit = parseHitRate(row.hitRate)
  const score = getTierScore(row)
  const valueStdCap = (row.propType === "Points" || row.propType === "PRA") ? t.maxValueStdBig : t.maxValueStdSmall

  const baseGate = (
    hit >= t.minHit &&
    score >= t.minScore &&
    (row.minFloor === null || row.minFloor >= t.minFloor) &&
    (row.minStd === null || row.minStd <= t.maxMinStd) &&
    (row.valueStd === null || row.valueStd <= valueStdCap)
  )

  if (baseGate) return true

  const m = String(slateMode || "").toLowerCase()
  if (m === "thin") {
    const ceilingScore = Number(row?.ceilingScore || 0)
    const lpi = Number(row?.longshotPredictiveIndex || 0)
    const roleSpike = Number(row?.roleSpikeScore || 0)
    if (
      ceilingScore >= 0.58 &&
      (lpi >= 0.18 || roleSpike >= 0.16) &&
      hit >= 0.54 &&
      score >= 50 &&
      (row.minFloor === null || row.minFloor >= 18)
    ) {
      return true
    }
  }

  return false
}

const bestPropsCompositeScore = (row) => {
  const hitRate = parseHitRate(row.hitRate)
  const edgeComponent = normalizeBestPropsEdge(row.edge ?? row.projectedValue ?? 0)
  const scoreComponent = normalizeBestPropsScore(row.score)
  const lowRiskBonuses =
    (String(row.minutesRisk || "").toLowerCase() === "low" ? 0.035 : 0) +
    (String(row.injuryRisk || "").toLowerCase() === "low" ? 0.03 : 0) +
    (String(row.trendRisk || "").toLowerCase() === "low" ? 0.02 : 0)

  return hitRate * 0.5 + edgeComponent * 0.25 + scoreComponent * 0.15 + lowRiskBonuses
}

const qualifiesPlayableTier = (row, slateMode) => {
  const t = tierThresholdsForSlateMode(slateMode).playable
  const hit = parseHitRate(row.hitRate)
  const edge = getTierEdge(row)
  const score = getTierScore(row)
  const minutesRisk = getMinutesRisk(row)
  const injuryRisk = getInjuryRisk(row)
  const avgMin = Number(row?.avgMin || 0)
  const recent5MinAvg = Number(row?.recent5MinAvg || 0)
  const roleSpike = Number(row?.roleSpikeScore || 0)
  const oppSpike = Number(row?.opportunitySpikeScore || 0)
  const spikeOverride = roleSpike >= 0.3 || oppSpike >= 0.38

  if (minutesRisk === "high") return false
  if (injuryRisk === "high") return false
  if (!spikeOverride) {
    if ((row?.avgMin != null && avgMin > 0 && avgMin < 18) || (row?.recent5MinAvg != null && recent5MinAvg > 0 && recent5MinAvg < 18)) return false
  }
  if (hit < t.minHit) return false
  if (edge < t.edgeBad && score < t.edgeBadScore) return false
  if (score >= t.minScore) return true
  if (hit >= t.hitAlt1) return true
  if (hit >= t.hitAlt2 && edge >= t.edgeAlt2) return true
  if (hit >= t.hitAlt3 && score >= t.scoreAlt3) return true
  return false
}

const qualifiesBestPropsSource = (row, slateMode) => {
  const t = tierThresholdsForSlateMode(slateMode).bestSource
  const hit = parseHitRate(row.hitRate)
  const edge = getTierEdge(row)
  const score = getTierScore(row)
  const minutesRisk = getMinutesRisk(row)
  const injuryRisk = getInjuryRisk(row)
  const avgMin = Number(row?.avgMin || 0)
  const recent5MinAvg = Number(row?.recent5MinAvg || 0)
  const roleSpike = Number(row?.roleSpikeScore || 0)
  const oppSpike = Number(row?.opportunitySpikeScore || 0)
  const ceiling = Number(row?.ceilingScore || 0)
  const spikeOverride = roleSpike >= 0.3 || oppSpike >= 0.38
  const propType = String(row?.propType || "")
  const line = Number(row?.line || 0)

  if (minutesRisk === "high") return false
  if (injuryRisk === "high") return false
  if (!spikeOverride) {
    if ((row?.avgMin != null && avgMin > 0 && avgMin < 18) || (row?.recent5MinAvg != null && recent5MinAvg > 0 && recent5MinAvg < 18)) return false
  } else if (ceiling < 0.5 && ((avgMin > 0 && avgMin < 18) || (recent5MinAvg > 0 && recent5MinAvg < 18))) {
    // bench spike without ceiling support should not enter bestProps
    return false
  }
  // Require minimum ceiling support for top board unless the play is truly elite by hit/score/edge.
  // This prevents low-impact / safe blend markets from dominating bestProps.
  if (ceiling > 0 && ceiling < 0.5) {
    const eliteException =
      (score >= 95 && hit >= 0.62) ||
      (Math.abs(edge) >= 6.5 && hit >= 0.6)
    if (!eliteException) return false
  }
  // Extra guard: very low threes lines are low-impact unless ceiling-supported.
  if (propType === "Threes" && line > 0 && line <= 1.5 && ceiling < 0.62 && !spikeOverride) {
    return false
  }
  if (hit < t.minHit) return false
  if (edge < t.edgeBad && score < t.edgeBadScore) return false
  return score >= t.minScore || hit >= t.hitAlt1 || (hit >= t.hitAlt2 && edge >= t.edgeAlt2)
}

const summarizeTierBucket = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const byBook = {}
  const byStat = {}

  for (const book of TIER_BOOKS) {
    byBook[book] = safeRows.filter((row) => String(row?.book || "Unknown") === book).length
  }

  for (const statType of TIER_STAT_TYPES) {
    byStat[statType] = safeRows.filter((row) => String(row?.propType || "Unknown") === statType).length
  }

  return {
    total: safeRows.length,
    byBook,
    byStat
  }
}

const buildSequentialFilterDropCounts = (rows, filters) => {
  let remaining = Array.isArray(rows) ? rows : []
  const droppedByFilter = {}

  for (const filter of filters) {
    const next = remaining.filter(filter.predicate)
    droppedByFilter[filter.key] = remaining.length - next.length
    remaining = next
  }

  return {
    droppedByFilter,
    survivors: remaining
  }
}

const logTierAssignmentDebug = (pathLabel, rawRows, tierRows, filterCounts = {}) => {
  const safeRawRows = Array.isArray(rawRows) ? rawRows : []
  const eliteRows = Array.isArray(tierRows.eliteRows) ? tierRows.eliteRows : []
  const strongRows = Array.isArray(tierRows.strongRows) ? tierRows.strongRows : []
  const playableRows = Array.isArray(tierRows.playableRows) ? tierRows.playableRows : []
  const bestSourceRows = Array.isArray(tierRows.bestSourceRows) ? tierRows.bestSourceRows : []
  const preCapBestRows = Array.isArray(tierRows.preCapBestRows) ? tierRows.preCapBestRows : []
  const bestRows = Array.isArray(tierRows.bestRows) ? tierRows.bestRows : []

  console.log("[TIER-ASSIGNMENT-DEBUG]", {
    path: pathLabel,
    rawCandidateCount: safeRawRows.length,
    rawPropsByBook: summarizeTierBucket(safeRawRows).byBook,
    rawPropsByStatType: summarizeTierBucket(safeRawRows).byStat,
    countRemovedByFilter: filterCounts,
    finalCounts: {
      eliteProps: eliteRows.length,
      strongProps: strongRows.length,
      playableProps: playableRows.length,
      bestPropsSource: bestSourceRows.length,
      bestPropsPreCap: preCapBestRows.length,
      bestProps: bestRows.length
    },
    perBookCounts: {
      eliteProps: summarizeTierBucket(eliteRows).byBook,
      strongProps: summarizeTierBucket(strongRows).byBook,
      playableProps: summarizeTierBucket(playableRows).byBook,
      bestPropsSource: summarizeTierBucket(bestSourceRows).byBook,
      bestProps: summarizeTierBucket(bestRows).byBook
    },
    perStatCounts: {
      eliteProps: summarizeTierBucket(eliteRows).byStat,
      strongProps: summarizeTierBucket(strongRows).byStat,
      playableProps: summarizeTierBucket(playableRows).byStat,
      bestPropsSource: summarizeTierBucket(bestSourceRows).byStat,
      bestProps: summarizeTierBucket(bestRows).byStat
    },
    playablePropsByBook: summarizeTierBucket(playableRows).byBook,
    bestPropsByBook: summarizeTierBucket(bestRows).byBook,
    bestPropsByStatType: summarizeTierBucket(bestRows).byStat,
    finalBestPropsTotal: bestRows.length
  })
}

const tierSlateMode = detectSlateMode({
  sportKey: "nba",
  snapshotMeta: { snapshotSlateGameCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0 },
  snapshot: { events: scheduledEvents, rawProps: rawPropsRows, props: activeBookRawPropsRows, bestProps: [] },
  runtime: { loadedSlateQualityPassEnabled: true }
})
console.log("[TIER-SLATE-MODE]", {
  path: "refresh-snapshot",
  mode: tierSlateMode.mode,
  metrics: tierSlateMode.metrics
})

const eliteProps = scoredProps.filter((row) => qualifiesEliteTier(row, tierSlateMode.mode))
logFunnelStage("refresh-snapshot", "eliteProps-from-scoredProps", scoredProps, eliteProps, { threshold: "hit>=0.72,score>=88,minFloor>=24,minStd<=7.5,valueStd<=10.5/5.5" })
logFunnelExcluded("refresh-snapshot", "eliteProps-from-scoredProps", scoredProps, eliteProps)

const strongProps = scoredProps.filter((row) => qualifiesStrongTier(row, tierSlateMode.mode))
logFunnelStage("refresh-snapshot", "strongProps-from-scoredProps", scoredProps, strongProps, { threshold: "hit>=0.61,score>=62,minFloor>=22,minStd<=9.5,valueStd<=12/6.5" })
logFunnelExcluded("refresh-snapshot", "strongProps-from-scoredProps", scoredProps, strongProps)

const playableProps = scoredProps.filter((row) => qualifiesPlayableTier(row, tierSlateMode.mode))
logFunnelStage("refresh-snapshot", "playableProps-from-scoredProps", scoredProps, playableProps, { threshold: "slateMode-aware playable gate" })
logFunnelExcluded("refresh-snapshot", "playableProps-from-scoredProps", scoredProps, playableProps)

const BEST_PROPS_BALANCE_CONFIG = {
  totalCap: 140,
  minPerBook: 60,
  maxPerPlayer: 8,
  maxPerMatchup: 12,
  maxPerType: {
    Assists: 40,
    Rebounds: 40,
    Points: 40,
    Threes: 24,
    PRA: 24
  }
}

const FLEX_PRIORITY_PROP_TYPES = new Set(["Threes", "Points", "PRA"])

const getFlexOddsBonus = (oddsValue) => {
  const odds = Number(oddsValue)
  if (!Number.isFinite(odds)) return 0
  if (odds >= 100 && odds <= 200) return 0.1
  if (odds >= -120 && odds < 100) return 0.05
  return 0
}

const getFlexTrendBonus = (row) => {
  const recent3 = Number(row?.recent3Avg)
  const recent5 = Number(row?.recent5Avg)
  const l10 = Number(row?.l10Avg)

  let bonus = 0
  if (Number.isFinite(recent3) && Number.isFinite(recent5) && recent3 > recent5) bonus += 0.08
  if (Number.isFinite(recent5) && Number.isFinite(l10) && recent5 > l10) bonus += 0.05
  return bonus
}

const isFlexEligible = (row) => {
  if (!row) return false
  if (!row.player || !row.propType || row.line == null) return false
  if (shouldRemoveLegForPlayerStatus(row)) return false
  if (isFragileLeg(row)) return false

  const hit = parseHitRate(row.hitRate)
  const avgMin = Number(row.avgMin || 0)
  const edge = Number(row.edge ?? row.projectedValue ?? 0)
  const minutesRisk = String(row.minutesRisk || "").toLowerCase()
  const injuryRisk = String(row.injuryRisk || "").toLowerCase()

  if (minutesRisk === "high") return false
  if (injuryRisk === "high") return false
  if (!Number.isFinite(hit) || hit < 0.45) return false
  if (!Number.isFinite(avgMin) || avgMin < 14) return false
  if (!Number.isFinite(edge) || edge < -2.5) return false

  return true
}

const flexScore = (row) => {
  const hit = parseHitRate(row.hitRate)
  const edge = Number(row.edge ?? row.projectedValue ?? 0)
  const score = Number(row.score || 0)
  const oddsBonus = getFlexOddsBonus(row.odds)
  const trendBonus = getFlexTrendBonus(row)

  return (
    hit * 0.4 +
    (edge / 12) * 0.2 +
    (score / 140) * 0.15 +
    oddsBonus * 0.15 +
    trendBonus * 0.1
  )
}

const getFlexPoolCap = (candidateCount) => {
  const safeCount = Number.isFinite(candidateCount) ? candidateCount : 0
  return Math.max(60, Math.min(80, 60 + Math.floor(safeCount / 40) * 5))
}

const countRowsByKey = (rows, keyFn) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return safeRows.reduce((acc, row) => {
    const key = keyFn(row)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

const buildFlexPropsPool = (pathLabel, sourceRows) => {
  const dedupedSource = dedupeByLegSignature(Array.isArray(sourceRows) ? sourceRows : [])
  const filtered = dedupedSource.filter((row) => isFlexEligible(row))
  const cap = getFlexPoolCap(filtered.length)

  const sorted = filtered.slice().sort((a, b) => {
    const scoreDiff = flexScore(b) - flexScore(a)
    if (scoreDiff !== 0) return scoreDiff

    const aVariancePriority = FLEX_PRIORITY_PROP_TYPES.has(String(a.propType || "")) ? 1 : 0
    const bVariancePriority = FLEX_PRIORITY_PROP_TYPES.has(String(b.propType || "")) ? 1 : 0
    if (bVariancePriority !== aVariancePriority) return bVariancePriority - aVariancePriority

    const aOddsWindow = Number.isFinite(Number(a.odds)) && Number(a.odds) >= -150 && Number(a.odds) <= 200 ? 1 : 0
    const bOddsWindow = Number.isFinite(Number(b.odds)) && Number(b.odds) >= -150 && Number(b.odds) <= 200 ? 1 : 0
    if (bOddsWindow !== aOddsWindow) return bOddsWindow - aOddsWindow

    return Number(b.score || 0) - Number(a.score || 0)
  })

  const finalPool = sorted.slice(0, cap)

  console.log("[FLEX-POOL-DEBUG]", {
    path: pathLabel,
    totalBeforeFilter: dedupedSource.length,
    totalAfterFilter: filtered.length,
    finalCount: finalPool.length,
    cap,
    beforeByPropType: countRowsByKey(dedupedSource, (row) => String(row?.propType || "Unknown")),
    afterByPropType: countRowsByKey(finalPool, (row) => String(row?.propType || "Unknown")),
    beforeByBook: countRowsByKey(dedupedSource, (row) => String(row?.book || "Unknown")),
    afterByBook: countRowsByKey(finalPool, (row) => String(row?.book || "Unknown"))
  })

  return finalPool
}

const selectBalancedPool = (rows, options = {}) => {
  const {
    totalCap = 120,
    minPerBook = 0,
    maxPerPlayer = 2,
    maxPerMatchup = 4,
    maxPerType = {},
    ranker = bestPropsCompositeScore
  } = options

  const sorted = dedupeSlipLegs(rows)
    .slice()
    .sort((a, b) => {
      const scoreDiff = ranker(b) - ranker(a)
      if (scoreDiff !== 0) return scoreDiff
      if (Number(b.edge || -999) !== Number(a.edge || -999)) return Number(b.edge || -999) - Number(a.edge || -999)
      return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
    })

  const selected = []
  const playerCounts = new Map()
  const matchupCounts = new Map()
  const typeCounts = new Map()
  const bookCounts = new Map()
  const books = ["FanDuel", "DraftKings"]

  const canTakeRow = (row) => {
    const player = String(row.player || "")
    const matchup = String(row.matchup || "")
    const propType = String(row.propType || "Unknown")
    const bookKey = String(row.book || "Unknown")
    if ((playerCounts.get(player) || 0) >= maxPerPlayer) return false
    if ((matchupCounts.get(matchup) || 0) >= maxPerMatchup) return false
    if ((typeCounts.get(propType) || 0) >= (maxPerType[propType] ?? 999)) return false
    if ((bookCounts.get(bookKey) || 0) >= totalCap) return false
    return true
  }

  const takeRow = (row) => {
    const player = String(row.player || "")
    const matchup = String(row.matchup || "")
    const propType = String(row.propType || "Unknown")
    const bookKey = String(row.book || "Unknown")
    selected.push(row)
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1)
    matchupCounts.set(matchup, (matchupCounts.get(matchup) || 0) + 1)
    typeCounts.set(propType, (typeCounts.get(propType) || 0) + 1)
    bookCounts.set(bookKey, (bookCounts.get(bookKey) || 0) + 1)
  }

  for (const bookKey of books) {
    for (const row of sorted) {
      if (selected.length >= totalCap) break
      if (String(row.book || "") !== bookKey) continue
      if ((bookCounts.get(bookKey) || 0) >= minPerBook) break
      if (!canTakeRow(row)) continue
      takeRow(row)
    }
  }

  for (const row of sorted) {
    if (selected.length >= totalCap) break
    const rowKey = `${row.player}|${row.propType}|${row.side}|${row.line}|${row.book}`
    const alreadySelected = selected.some((picked) => `${picked.player}|${picked.propType}|${picked.side}|${picked.line}|${picked.book}` === rowKey)
    if (alreadySelected) continue
    if (!canTakeRow(row)) continue
    takeRow(row)
  }

  return selected
}

function logBestStage(label, rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  console.log("[BEST-STAGE-DEBUG]", {
    label,
    total: safeRows.length,
    fanduel: safeRows.filter((row) => row?.book === "FanDuel").length,
    draftkings: safeRows.filter((row) => row?.book === "DraftKings").length
  })
  return rows
}

const buildBestPropsBalancedPool = (rows, options = {}) => {
  const config = {
    targetTotal: Number.isFinite(options.targetTotal) ? options.targetTotal : BEST_PROPS_BALANCE_CONFIG.totalCap,
    bestCap: Number.isFinite(options.bestCap)
      ? options.bestCap
      : (Number.isFinite(options.targetTotal) ? options.targetTotal : BEST_PROPS_BALANCE_CONFIG.totalCap),
    maxPerPlayer: Number.isFinite(options.maxPerPlayer) ? options.maxPerPlayer : BEST_PROPS_BALANCE_CONFIG.maxPerPlayer,
    maxPerMatchup: Number.isFinite(options.maxPerMatchup) ? options.maxPerMatchup : BEST_PROPS_BALANCE_CONFIG.maxPerMatchup,
    partialPostingMode: options.partialPostingMode === true,
    maxPerType: { ...BEST_PROPS_BALANCE_CONFIG.maxPerType, ...(options.maxPerType || {}) },
    ranker: options.ranker || bestPropsCompositeScore
  }
  const configuredMinPerBook = Number.isFinite(options.minPerBook)
    ? options.minPerBook
    : BEST_PROPS_BALANCE_CONFIG.minPerBook
  config.minPerBook = Math.max(0, Math.min(configuredMinPerBook, Math.floor(config.targetTotal / 2)))

  const bestBoardOrderingScore = (row) => {
    const baseScore = Number((options.ranker || bestPropsCompositeScore)(row) || 0)
    const side = String(row?.side || "")
    const propVariant = String(row?.propVariant || "base")
    const propType = String(row?.propType || "")
    const hitRate = parseHitRate(row?.hitRate)
    const edge = Number(row?.edge ?? row?.projectedValue ?? 0)

    let adjusted = baseScore

    if (side === "Under") adjusted -= 8
    if (side === "Over") adjusted += 3

    if (propVariant !== "base" && propVariant !== "default") adjusted -= 6

    if (propType === "Points") adjusted += 5
    if (propType === "PRA") adjusted += 6
    if (propType === "Assists") adjusted += 4
    if (propType === "Rebounds") adjusted -= 5

    if (side === "Over" && (propType === "Points" || propType === "PRA" || propType === "Assists")) adjusted += 3
    if (side === "Over" && propType === "Rebounds") adjusted -= 2

    if (side === "Under" && propType === "Rebounds") adjusted -= 8

    if (hitRate >= 0.75 && edge >= 3.0 && (propType === "Points" || propType === "PRA" || propType === "Assists")) adjusted += 4
    if (side === "Under" && hitRate >= 0.76 && edge >= 3.5) adjusted += 5
    if ((propVariant !== "base" && propVariant !== "default") && hitRate >= 0.8 && edge >= 4.0) adjusted += 4

    return adjusted
  }

  const pathLabel = String(options.pathLabel || "unknown")
  const isBestBoardPath =
    pathLabel === "refresh-snapshot" ||
    pathLabel === "refresh-snapshot-hard-reset" ||
    pathLabel.includes("bestProps")
  const rawSource = Array.isArray(rows) ? rows : []
  const sourceByBook = countByBookForRows(rawSource)
  logBestStage(`${pathLabel}:sourcePoolBeforeBestPropsFiltering`, rawSource)

  const sourceAfterPlayerStatus = rawSource
    .filter((row) => row && row.player && row.propType && row.line != null)
    .filter((row) => !shouldRemoveLegForPlayerStatus(row))
    .filter((row) => {
      if (!isBestBoardPath) return true
      return String(row?.minutesRisk || "").toLowerCase() !== "high"
    })
    .filter((row) => {
      if (!isBestBoardPath) return true
      const tier = String(row?.confidenceTier || "").toLowerCase()
      return tier !== "thin" || parseHitRate(row?.hitRate) >= 0.63 || Number(row?.edge ?? row?.projectedValue ?? 0) >= 2.25
    })
  logBestStage(`${pathLabel}:afterPlayerStatusFiltering`, sourceAfterPlayerStatus)

  const bestPropsAfterFragile = sourceAfterPlayerStatus
    .filter((row) => !isFragileLeg(row, "best"))
  logBestStage(`${pathLabel}:afterFragileFiltering`, bestPropsAfterFragile)
  console.log("[BEST-FRAGILE-MODE-DEBUG]", {
    mode: "best",
    remaining: bestPropsAfterFragile.length,
    fanduel: bestPropsAfterFragile.filter((row) => row?.book === "FanDuel").length,
    draftkings: bestPropsAfterFragile.filter((row) => row?.book === "DraftKings").length
  })
  const eligibleSource = bestPropsAfterFragile
    .filter((row) => playerFitsMatchup(row))
  logBestStage(`${pathLabel}:afterMatchupGameFiltering`, eligibleSource)
  const droppedByIneligible = Math.max(0, rawSource.length - eligibleSource.length)

  console.log("[BEST-PROPS-STAGE-COUNTS]", {
    path: pathLabel,
    stage: "beforeFragileFilter",
    total: sourceAfterPlayerStatus.length,
    byBook: countByBookForRows(sourceAfterPlayerStatus)
  })
  console.log("[BEST-PROPS-STAGE-COUNTS]", {
    path: pathLabel,
    stage: "afterFragileFilter",
    total: bestPropsAfterFragile.length,
    byBook: countByBookForRows(bestPropsAfterFragile)
  })

  const dedupedEligible = dedupeByLegSignature(eligibleSource)
  const droppedByDedupe = Math.max(0, eligibleSource.length - dedupedEligible.length)
  logBestStage(`${pathLabel}:afterDedupe`, dedupedEligible)
  console.log("[BEST-PROPS-STAGE-COUNTS]", {
    path: pathLabel,
    stage: "afterDedupe",
    total: dedupedEligible.length,
    byBook: countByBookForRows(dedupedEligible)
  })

  const candidates = dedupedEligible
    .slice()
    .sort((a, b) => {
      const scoreDiff = bestBoardOrderingScore(b) - bestBoardOrderingScore(a)
      if (scoreDiff !== 0) return scoreDiff
      if (Number(b.edge || -999) !== Number(a.edge || -999)) return Number(b.edge || -999) - Number(a.edge || -999)
      return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
    })

  // ensure FD + DK balance before final best selection
  const fd = candidates.filter((p) => p.book === "FanDuel")
  const dk = candidates.filter((p) => p.book === "DraftKings")
  const activeBooksInCandidates = [
    fd.length > 0 ? "FanDuel" : null,
    dk.length > 0 ? "DraftKings" : null
  ].filter(Boolean)
  const dualBookMode = activeBooksInCandidates.length > 1

  let bestPool = candidates

  if (dualBookMode) {
    const MAX_PER_BOOK = Math.ceil((config?.bestCap || 60) / 2)
    const balancedPool = [
      ...fd.slice(0, MAX_PER_BOOK),
      ...dk.slice(0, MAX_PER_BOOK)
    ]
    bestPool = balancedPool.length > 0 ? balancedPool : candidates
  }

  const sorted = bestPool
    .slice()
    .sort((a, b) => {
      const scoreDiff = bestBoardOrderingScore(b) - bestBoardOrderingScore(a)
      if (scoreDiff !== 0) return scoreDiff
      if (Number(b.edge || -999) !== Number(a.edge || -999)) return Number(b.edge || -999) - Number(a.edge || -999)
      return parseHitRate(b.hitRate) - parseHitRate(a.hitRate)
    })

  const eligibleByBook = countByBookForRows(sorted)
  const reserveTargetByBook = {
    FanDuel: Math.min(config.minPerBook, eligibleByBook.FanDuel || 0),
    DraftKings: Math.min(config.minPerBook, eligibleByBook.DraftKings || 0)
  }

  const bookBuckets = {
    FanDuel: sorted.filter((row) => String(row?.book || "") === "FanDuel"),
    DraftKings: sorted.filter((row) => String(row?.book || "") === "DraftKings")
  }
  const bookCursor = {
    FanDuel: 0,
    DraftKings: 0
  }
  // --- Single-book mode logic ---
  const activeCandidateBooks = Object.keys(eligibleByBook).filter((b) => eligibleByBook[b] > 0)
  const singleBookMode = activeCandidateBooks.length === 1
  if (singleBookMode && activeCandidateBooks[0] === "DraftKings") {
    config.maxPerPlayer = Math.max(config.maxPerPlayer, 8)
    config.maxPerMatchup = Math.max(config.maxPerMatchup, 12)
    config.maxPerType = {
      ...config.maxPerType,
      Assists: Math.max(Number(config.maxPerType?.Assists || 0), 40),
      Rebounds: Math.max(Number(config.maxPerType?.Rebounds || 0), 40),
      Points: Math.max(Number(config.maxPerType?.Points || 0), 40),
      Threes: Math.max(Number(config.maxPerType?.Threes || 0), 24),
      PRA: Math.max(Number(config.maxPerType?.PRA || 0), 24)
    }
  }

  const keyOf = (row) => `${row?.player || ""}|${row?.book || ""}|${row?.propType || ""}|${row?.matchup || ""}|${Number(row?.line)}|${row?.side || ""}`
  const selected = []
  const selectedKeys = new Set()
  const playerCounts = new Map()
  const matchupCounts = new Map()
  const typeCounts = new Map()
  const bookCounts = new Map()
  const sideCounts = new Map()
  const dropCounts = {
    droppedByBookCap: 0,
    droppedByPlayerCap: 0,
    droppedByMatchupCap: 0,
    droppedByStatCap: 0,
    droppedByQualityShape: 0,
    droppedByDedupe,
    droppedByIneligible
  }
  const dropReasonByKey = {}
  const droppedRowObjects = []
  let skippedLowQualityCount = 0
  let openFillAdded = 0

  const selectedByBook = () => countByBookForRows(selected)
  const getBookCount = (book) => bookCounts.get(book) || 0
  const finalDifferenceFDvsDK = () => Math.abs(getBookCount("FanDuel") - getBookCount("DraftKings"))
  const recordDrop = (row, reason) => {
    const key = keyOf(row)
    if (selectedKeys.has(key)) return
    if (dropReasonByKey[key]) return
    dropReasonByKey[key] = reason
      droppedRowObjects.push({ row, reason })
    if (reason === "droppedByBookCap") dropCounts.droppedByBookCap += 1
    if (reason === "droppedByPlayerCap") dropCounts.droppedByPlayerCap += 1
    if (reason === "droppedByMatchupCap") dropCounts.droppedByMatchupCap += 1
    if (reason === "droppedByStatCap") dropCounts.droppedByStatCap += 1
    if (reason === "droppedByQualityShape") dropCounts.droppedByQualityShape += 1
  }

  const normalizeBestPlayerKey = (value) =>
    String(value || "")
      .normalize("NFKD")
      .replace(/[’']/g, "")
      .replace(/\./g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()

  const canTakeRow = (row, mode = "reserve") => {
    const player = String(row.player || "")
    const normalizedPlayer = normalizeBestPlayerKey(player)
    const matchup = String(row.matchup || "")
    const propType = String(row.propType || "Unknown")
    const bookKey = String(row.book || "Unknown")
    const side = String(row?.side || "")
    const edge = Number(row?.edge ?? row?.projectedValue ?? 0)
    const hitRate = parseHitRate(row?.hitRate)
    const score = Number(row?.score ?? 0)

    if (selected.length >= config.targetTotal) return { ok: false, reason: "droppedByBookCap" }
    if ((playerCounts.get(player) || 0) >= config.maxPerPlayer) return { ok: false, reason: "droppedByPlayerCap" }
    if ((matchupCounts.get(matchup) || 0) >= config.maxPerMatchup) return { ok: false, reason: "droppedByMatchupCap" }
    if ((typeCounts.get(propType) || 0) >= (config.maxPerType[propType] ?? 999)) return { ok: false, reason: "droppedByStatCap" }

    if (mode === "open") {
      const projectedFD = getBookCount("FanDuel") + (bookKey === "FanDuel" ? 1 : 0)
      const projectedDK = getBookCount("DraftKings") + (bookKey === "DraftKings" ? 1 : 0)
      if (!singleBookMode && Math.abs(projectedFD - projectedDK) > 6) {
        return { ok: false, reason: "droppedByBookCap" }
      }
    }

    if (isBestBoardPath) {
      const sideLower = side.toLowerCase()
      if ((playerCounts.get(normalizedPlayer) || 0) >= 1) {
        const passesRepeatPlayerGate = config.partialPostingMode
          ? (hitRate >= 0.66 && edge >= 1.5 && score >= 78)
          : (hitRate >= 0.71 && edge >= 2.25 && score >= 88)
        if (!passesRepeatPlayerGate) {
          return { ok: false, reason: "droppedByQualityShape" }
        }
      }

      const passesUnderGate = config.partialPostingMode
        ? (hitRate >= 0.63 && edge >= 1.25 && score >= 70)
        : (hitRate >= 0.68 && edge >= 2.0 && score >= 78)
      if (side === "Under" && !passesUnderGate) {
        return { ok: false, reason: "droppedByQualityShape" }
      }

      // Soft composition guard: avoid under-heavy boards unless an under is truly elite.
      if (mode === "open" && sideLower === "under" && selected.length >= 12) {
        const projectedUnderCount = (sideCounts.get("under") || 0) + 1
        const projectedShare = projectedUnderCount / (selected.length + 1)
        const softUnderShareCap = config.partialPostingMode ? 0.58 : 0.55
        const eliteUnderException = config.partialPostingMode
          ? (hitRate >= 0.69 && edge >= 1.6 && score >= 82)
          : (hitRate >= 0.72 && edge >= 2.1 && score >= 88)

        if (projectedShare > softUnderShareCap && !eliteUnderException) {
          return { ok: false, reason: "droppedByQualityShape" }
        }
      }
    }

    return { ok: true }
  }

  const takeRow = (row) => {
    const player = String(row.player || "")
    const normalizedPlayer = normalizeBestPlayerKey(player)
    const matchup = String(row.matchup || "")
    const propType = String(row.propType || "Unknown")
    const bookKey = String(row.book || "Unknown")
    const sideKey = String(row?.side || "").toLowerCase()
    const key = keyOf(row)
    selected.push(row)
    selectedKeys.add(key)
    playerCounts.set(normalizedPlayer, (playerCounts.get(normalizedPlayer) || 0) + 1)
    matchupCounts.set(matchup, (matchupCounts.get(matchup) || 0) + 1)
    typeCounts.set(propType, (typeCounts.get(propType) || 0) + 1)
    bookCounts.set(bookKey, (bookCounts.get(bookKey) || 0) + 1)
    if (sideKey) sideCounts.set(sideKey, (sideCounts.get(sideKey) || 0) + 1)
  }

  const takeNextFromBook = (bookKey) => {
    const bucket = bookBuckets[bookKey] || []
    while ((bookCursor[bookKey] || 0) < bucket.length) {
      const row = bucket[bookCursor[bookKey]]
      bookCursor[bookKey] += 1
      if (selectedKeys.has(keyOf(row))) continue

      const projectedFD = getBookCount("FanDuel") + (bookKey === "FanDuel" ? 1 : 0)
      const projectedDK = getBookCount("DraftKings") + (bookKey === "DraftKings" ? 1 : 0)
      if (!singleBookMode && Math.abs(projectedFD - projectedDK) > 6) {
        recordDrop(row, "droppedByBookCap")
        continue
      }

      const decision = canTakeRow(row, "reserve")
      if (!decision.ok) {
        recordDrop(row, decision.reason)
        continue
      }
      takeRow(row)
      return true
    }
    return false
  }

  let selectedByBookAfterReservePass = {}
  if (singleBookMode) {
    // Only one book: skip per-book balancing, just take top N globally
    for (const row of sorted) {
      if (selected.length >= config.targetTotal) break
      if (selectedKeys.has(keyOf(row))) continue
      const decision = canTakeRow(row, "open")
      if (!decision.ok) {
        recordDrop(row, decision.reason)
        continue
      }
      takeRow(row)
    }
    selectedByBookAfterReservePass = selectedByBook()
    logBestStage(`${pathLabel}:afterPerBookBalancingAssignment`, selected)
    console.log("[BEST-PROPS-STAGE-COUNTS]", {
      path: pathLabel,
      stage: "afterPerBookBalancing",
      total: selected.length,
      byBook: selectedByBookAfterReservePass,
      singleBookMode,
      activeCandidateBooks
    })
    // In single-book mode, do not increment droppedByBookCap for per-book balancing
    dropCounts.droppedByBookCap = 0
  } else {
    const maxReserveRounds = Math.max(...TIER_BOOKS.map((book) => reserveTargetByBook[book] || 0), 0)
    for (let round = 0; round < maxReserveRounds; round += 1) {
      let madeProgress = false
      for (const bookKey of TIER_BOOKS) {
        if ((selectedByBook()[bookKey] || 0) >= (reserveTargetByBook[bookKey] || 0)) continue
        if (takeNextFromBook(bookKey)) madeProgress = true
      }
      if (!madeProgress) break
      if (selected.length >= config.targetTotal) break
    }
    selectedByBookAfterReservePass = selectedByBook()
    logBestStage(`${pathLabel}:afterPerBookBalancingAssignment`, selected)
    console.log("[BEST-PROPS-STAGE-COUNTS]", {
      path: pathLabel,
      stage: "afterPerBookBalancing",
      total: selected.length,
      byBook: selectedByBookAfterReservePass,
      singleBookMode,
      activeCandidateBooks
    })
  }

  for (const row of sorted) {
    if (selected.length >= config.targetTotal) break
    if (selectedKeys.has(keyOf(row))) continue

    const hitRate = parseHitRate(row.hitRate)
    const edge = Number(row.edge ?? row.projectedValue ?? 0)
    if (hitRate < 0.5 || edge < -1.0) {
      skippedLowQualityCount += 1
      continue
    }

    const decision = canTakeRow(row, "open")
    if (!decision.ok) {
      recordDrop(row, decision.reason)
      continue
    }
    takeRow(row)
    openFillAdded += 1
  }

  // Controlled fallback: if strict quality gating under-fills, admit only slightly lower quality rows.
  if (selected.length < config.targetTotal) {
    for (const row of sorted) {
      if (selected.length >= config.targetTotal) break
      if (selectedKeys.has(keyOf(row))) continue

      const hitRate = parseHitRate(row.hitRate)
      const edge = Number(row.edge ?? row.projectedValue ?? 0)
      if (hitRate < 0.47 || edge < -2.0) continue

      const decision = canTakeRow(row, "open")
      if (!decision.ok) {
        recordDrop(row, decision.reason)
        continue
      }
      takeRow(row)
      openFillAdded += 1
    }
  }

  const dedupeSelectedBestRowsByPlayer = (rows) => {
    if (!isBestBoardPath) return Array.isArray(rows) ? rows : []

    const safeRows = Array.isArray(rows) ? rows : []
    const perPlayerCap = config.partialPostingMode ? 2 : 1
    const playerCounts = new Map()
    const playerPropTypes = new Map()
    const out = []

    for (const row of safeRows) {
      const playerKey = normalizeBestPlayerKey(row?.player)
      if (!playerKey) continue
      const count = playerCounts.get(playerKey) || 0
      if (count >= perPlayerCap) continue
      if (config.partialPostingMode && count >= 1) {
        const currentPropType = String(row?.propType || "")
        const seenTypes = playerPropTypes.get(playerKey) || new Set()
        if (currentPropType && seenTypes.has(currentPropType)) continue
      }
      playerCounts.set(playerKey, count + 1)
      const propType = String(row?.propType || "")
      const nextSeenTypes = playerPropTypes.get(playerKey) || new Set()
      if (propType) nextSeenTypes.add(propType)
      playerPropTypes.set(playerKey, nextSeenTypes)
      out.push(row)
    }

    return out
  }

  let finalSelected = dedupeSelectedBestRowsByPlayer(selected)
  let partialDiversityFillAdded = 0
  if (config.partialPostingMode && finalSelected.length < Math.min(32, config.targetTotal)) {
    const refillTarget = Math.min(32, config.targetTotal)
    const refillRows = [...finalSelected]
    const refillKeys = new Set(refillRows.map((row) => keyOf(row)))
    const refillPlayerCounts = new Map()
    const refillMatchupCounts = new Map()
    const refillPlayerPropKeys = new Set()

    for (const row of refillRows) {
      const playerKey = normalizeBestPlayerKey(row?.player)
      const matchupKey = String(row?.matchup || "")
      const propType = String(row?.propType || "")
      if (playerKey) {
        refillPlayerCounts.set(playerKey, (refillPlayerCounts.get(playerKey) || 0) + 1)
        if (propType) refillPlayerPropKeys.add(`${playerKey}|${propType}`)
      }
      if (matchupKey) refillMatchupCounts.set(matchupKey, (refillMatchupCounts.get(matchupKey) || 0) + 1)
    }

    const matchupCapForRefill = Math.max(5, Math.min(8, Math.ceil(refillTarget / 4)))
    for (const row of sorted) {
      if (refillRows.length >= refillTarget) break
      const key = keyOf(row)
      if (refillKeys.has(key)) continue

      const hitRate = parseHitRate(row?.hitRate)
      const edge = Number(row?.edge ?? row?.projectedValue ?? 0)
      const score = Number(row?.score ?? 0)
      if (hitRate < 0.58 || edge < 0.75 || score < 72) continue

      const playerKey = normalizeBestPlayerKey(row?.player)
      const matchupKey = String(row?.matchup || "")
      const propType = String(row?.propType || "")
      const playerPropKey = `${playerKey}|${propType}`

      if (!playerKey || !matchupKey || !propType) continue
      if ((refillPlayerCounts.get(playerKey) || 0) >= 2) continue
      if (refillPlayerPropKeys.has(playerPropKey)) continue
      if ((refillMatchupCounts.get(matchupKey) || 0) >= matchupCapForRefill) continue

      refillRows.push(row)
      refillKeys.add(key)
      refillPlayerCounts.set(playerKey, (refillPlayerCounts.get(playerKey) || 0) + 1)
      refillPlayerPropKeys.add(playerPropKey)
      refillMatchupCounts.set(matchupKey, (refillMatchupCounts.get(matchupKey) || 0) + 1)
      partialDiversityFillAdded += 1
    }

    finalSelected = refillRows
  }
  const postCapByBook = summarizeBestPropsCapPool(finalSelected).byBook
  logBestStage(`${pathLabel}:afterPerBookBalancingFinal`, finalSelected)
  console.log("[BEST-PROPS-BALANCER-DEBUG]", {
    path: pathLabel,
    sourceTotal: rawSource.length,
    sourceByBook,
    eligibleByBookBeforeBalancing: eligibleByBook,
    reservedTargetByBook: reserveTargetByBook,
    selectedByBookAfterReservePass,
    selectedByBookAfterFinalFill: postCapByBook,
    targetTotal: config.targetTotal,
    minPerBook: config.minPerBook,
    openFillAdded,
    partialDiversityFillAdded,
    skippedLowQualityCount,
    finalDifferenceFDvsDK: finalDifferenceFDvsDK(),
    finalTotal: finalSelected.length,
    finalFD: finalSelected.filter((row) => row?.book === "FanDuel").length,
    finalDK: finalSelected.filter((row) => row?.book === "DraftKings").length
  })

  console.log("[BEST-PROPS-BALANCER-DROPS]", {
    path: pathLabel,
    droppedByBookCap: dropCounts.droppedByBookCap,
    droppedByPlayerCap: dropCounts.droppedByPlayerCap,
    droppedByMatchupCap: dropCounts.droppedByMatchupCap,
    droppedByStatCap: dropCounts.droppedByStatCap,
    droppedByDedupe: dropCounts.droppedByDedupe,
    droppedByIneligible: dropCounts.droppedByIneligible
  })

  const top15Dropped = droppedRowObjects
    .sort((a, b) => config.ranker(b.row) - config.ranker(a.row))
    .slice(0, 15)
    .map(({ row, reason }) => ({
      player: row?.player,
      team: row?.team,
      book: row?.book,
      propType: row?.propType,
      side: row?.side,
      line: row?.line,
      propVariant: row?.propVariant || "base",
      hitRate: parseHitRate(row?.hitRate),
      edge: Number(row?.edge || 0),
      score: Number(row?.score || 0),
      dropReason: reason
    }))
  console.log("[FINAL-BEST-THINNING-DEBUG]", {
    path: pathLabel,
    sourceCount: rawSource.length,
    afterSafetyFilters: eligibleSource.length,
    afterDedupe: dedupedEligible.length,
    afterBalancing: (selectedByBookAfterReservePass.FanDuel || 0) + (selectedByBookAfterReservePass.DraftKings || 0),
    afterCap: finalSelected.length,
    finalByBook: countByBookForRows(finalSelected),
    finalByPropVariant: finalSelected.reduce((acc, row) => {
      const v = String(row?.propVariant || "base")
      acc[v] = (acc[v] || 0) + 1
      return acc
    }, {}),
    top15Dropped
  })


  return {
    selected: finalSelected,
    diagnostics: {
      config,
      pathLabel,
      sourceRawCount: rawSource.length,
      eligibleCount: eligibleSource.length,
      dedupedCount: dedupedEligible.length,
      postBalancerCount: finalSelected.length,
      sourceCount: sorted.length,
      finalCount: finalSelected.length,
      beforeCapByBook: countByBookForRows(sorted),
      afterCapByBook: postCapByBook,
      beforeCapByStat: summarizeBestPropsCapPool(sorted).byPropType,
      afterCapByStat: summarizeBestPropsCapPool(finalSelected).byPropType,
      dropCounts: {
        ...dropCounts,
        totalCap: Math.max(0, sorted.length - selected.length),
        perBookBalancing: dropCounts.droppedByBookCap,
        perPlayerCap: dropCounts.droppedByPlayerCap,
        perMatchupCap: dropCounts.droppedByMatchupCap,
        perStatCap: dropCounts.droppedByStatCap
      },
      dropReasonByKey,
      reserveTargetByBook,
      eligibleByBook,
      selectedByBookAfterReservePass,
      targetTotal: config.targetTotal,
      minPerBook: config.minPerBook,
      openFillAdded,
      partialDiversityFillAdded,
      skippedLowQualityCount,
      finalDifferenceFDvsDK: finalDifferenceFDvsDK()
    }
  }
}

const countByBookForRows = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : []
  return {
    FanDuel: safeRows.filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: safeRows.filter((row) => String(row?.book || "") === "DraftKings").length
  }
}

const logPropStageByBookDebug = (path, stages = {}) => {
  console.log("[PROP-STAGE-BY-BOOK-DEBUG]", {
    path,
    elite: countByBookForRows(stages.elite),
    strong: countByBookForRows(stages.strong),
    playable: countByBookForRows(stages.playable),
    best: countByBookForRows(stages.best)
  })
}

const ensureBestPropsPlayableBookFloor = (bestRows, playableRows, options = {}) => {
  const targetBook = String(options?.targetBook || "FanDuel")
  const minCount = Number.isFinite(options?.minCount) ? options.minCount : 8
  const totalCap = Number.isFinite(options?.totalCap) ? options.totalCap : BEST_PROPS_BALANCE_CONFIG.totalCap
  const healthyTotal = Number.isFinite(options?.healthyTotal) ? options.healthyTotal : 20

  let safeBestRows = dedupeSlipLegs(Array.isArray(bestRows) ? bestRows : [])
  const safePlayableRows = dedupeSlipLegs(Array.isArray(playableRows) ? playableRows : [])

  const currentBookCount = safeBestRows.filter((row) => String(row?.book || "") === targetBook).length
  if (safeBestRows.length < healthyTotal || currentBookCount >= minCount) {
    return {
      rows: safeBestRows,
      promotedCount: 0,
      initialBookCount: currentBookCount,
      finalBookCount: currentBookCount
    }
  }

  const existingKeys = new Set(
    safeBestRows.map((row) => `${row?.player}-${row?.propType}-${row?.side}-${Number(row?.line)}-${row?.book}`)
  )

  const playableCandidates = safePlayableRows
    .filter((row) => String(row?.book || "") === targetBook)
    .filter((row) => playerFitsMatchup(row))
    .filter((row) => !shouldRemoveLegForPlayerStatus(row))
    .filter((row) => !existingKeys.has(`${row?.player}-${row?.propType}-${row?.side}-${Number(row?.line)}-${row?.book}`))
    .sort((a, b) => {
      const compositeDiff = bestPropsCompositeScore(b) - bestPropsCompositeScore(a)
      if (compositeDiff !== 0) return compositeDiff
      return Number(b?.score || 0) - Number(a?.score || 0)
    })

  let promotedCount = 0
  for (const candidate of playableCandidates) {
    if (safeBestRows.filter((row) => String(row?.book || "") === targetBook).length >= minCount) break
    safeBestRows.push(candidate)
    existingKeys.add(`${candidate?.player}-${candidate?.propType}-${candidate?.side}-${Number(candidate?.line)}-${candidate?.book}`)
    promotedCount += 1
  }

  safeBestRows = dedupeSlipLegs(safeBestRows)
    .sort((a, b) => {
      const compositeDiff = bestPropsCompositeScore(b) - bestPropsCompositeScore(a)
      if (compositeDiff !== 0) return compositeDiff
      return Number(b?.score || 0) - Number(a?.score || 0)
    })

  if (safeBestRows.length > totalCap) {
    const protectedRows = []
    const unprotectedRows = []
    let protectedFanDuelCount = 0

    for (const row of safeBestRows) {
      if (String(row?.book || "") === targetBook && protectedFanDuelCount < minCount) {
        protectedRows.push(row)
        protectedFanDuelCount += 1
      } else {
        unprotectedRows.push(row)
      }
    }

    safeBestRows = [...protectedRows, ...unprotectedRows].slice(0, totalCap)
  }

  const finalBookCount = safeBestRows.filter((row) => String(row?.book || "") === targetBook).length
  return {
    rows: safeBestRows,
    promotedCount,
    initialBookCount: currentBookCount,
    finalBookCount
  }
}

const ensureBestPropsBookPresence = (finalRows, sourceRows, options = {}) => {
  const targetBook = String(options?.targetBook || "DraftKings")
  const totalCap = Number.isFinite(options?.totalCap) ? options.totalCap : BEST_PROPS_BALANCE_CONFIG.totalCap
  const meaningfulFloor = Number.isFinite(options?.meaningfulFloor) ? options.meaningfulFloor : 8

  const safeFinalRows = dedupeSlipLegs(Array.isArray(finalRows) ? finalRows : [])
  const sourcePool = dedupeSlipLegs(Array.isArray(sourceRows) ? sourceRows : [])
  const sourceCandidatesForBook = sourcePool
    .filter((row) => String(row?.book || "") === targetBook)
    .filter((row) => playerFitsMatchup(row))
    .filter((row) => !shouldRemoveLegForPlayerStatus(row))
    .sort((a, b) => {
      const scoreDiff = bestPropsCompositeScore(b) - bestPropsCompositeScore(a)
      if (scoreDiff !== 0) return scoreDiff
      return Number(b.score || 0) - Number(a.score || 0)
    })

  const sourceHasBook = sourceCandidatesForBook.length > 0
  const finalBookCount = safeFinalRows.filter((row) => String(row?.book || "") === targetBook).length
  const targetBookCount = sourceCandidatesForBook.length >= meaningfulFloor
    ? Math.min(meaningfulFloor, sourceCandidatesForBook.length)
    : sourceCandidatesForBook.length

  if (!sourceHasBook || finalBookCount >= targetBookCount) {
    return {
      rows: safeFinalRows,
      rescuedBook: null
    }
  }

  let nextRows = [...safeFinalRows]
  let remainingNeed = Math.max(0, targetBookCount - finalBookCount)

  const candidateQueue = sourceCandidatesForBook.filter((candidate) => {
    const candidateKey = `${candidate.player}|${candidate.propType}|${candidate.side}|${Number(candidate.line)}|${candidate.book}`
    return !nextRows.some((row) => `${row.player}|${row.propType}|${row.side}|${Number(row.line)}|${row.book}` === candidateKey)
  })

  while (remainingNeed > 0 && candidateQueue.length > 0) {
    const replacementCandidate = candidateQueue.shift()
    const replaceIndex = nextRows
      .map((row, idx) => ({ idx, row }))
      .filter((entry) => String(entry.row?.book || "") !== targetBook)
      .sort((a, b) => {
        const scoreDiff = bestPropsCompositeScore(a.row) - bestPropsCompositeScore(b.row)
        if (scoreDiff !== 0) return scoreDiff
        return Number(a.row?.score || 0) - Number(b.row?.score || 0)
      })[0]?.idx

    if (!Number.isInteger(replaceIndex)) break
    nextRows.splice(replaceIndex, 1, replacementCandidate)
    remainingNeed -= 1
  }

  nextRows = dedupeSlipLegs(nextRows).slice(0, totalCap)

  const finalRescuedCount = nextRows.filter((row) => String(row?.book || "") === targetBook).length
  const rescuedBook = finalRescuedCount > finalBookCount ? targetBook : null

  return {
    rows: nextRows,
    rescuedBook
  }
}

debugPipelineStages.afterPlayableProps = summarizePropPipelineRows(playableProps)
debugPipelineStages.afterStrongProps = summarizePropPipelineRows(strongProps)
debugPipelineStages.afterEliteProps = summarizePropPipelineRows(eliteProps)
logPropPipelineStep("refresh-snapshot", "after-playableProps-assignment", playableProps)
logPropPipelineStep("refresh-snapshot", "after-strongProps-assignment", strongProps)
logPropPipelineStep("refresh-snapshot", "after-eliteProps-assignment", eliteProps)

const capPoolByType = (rows, caps) => {
  const counts = new Map()
  const out = []

  for (const row of rows) {
    const key = row.propType
    const current = counts.get(key) || 0
    const cap = caps[key] ?? 99

    if (current >= cap) continue

    out.push(row)
    counts.set(key, current + 1)
  }

  return out
}

const capPoolByPlayer = (rows, maxPerPlayer = 2) => {
  const counts = new Map()
  const out = []

  for (const row of rows) {
    const current = counts.get(row.player) || 0
    if (current >= maxPerPlayer) continue

    out.push(row)
    counts.set(row.player, current + 1)
  }

  return out
}

const eliteCapped = capPoolByPlayer(
  capPoolByType(eliteProps, {
    Assists: 4,
    Rebounds: 4,
    Points: 4,
    Threes: 3,
    PRA: 1
  }),
  2
)
logFunnelStage("refresh-snapshot", "eliteCapped-from-eliteProps", eliteProps, eliteCapped, { typeCaps: "Assists:4,Rebounds:4,Points:4,Threes:3,PRA:1", playerCap: 2 })
logFunnelExcluded("refresh-snapshot", "eliteCapped-from-eliteProps", eliteProps, eliteCapped)

const strongCapped = capPoolByPlayer(
  capPoolByType(
    strongProps.filter((row) =>
      !eliteCapped.some(
        (e) =>
          e.player === row.player &&
          e.propType === row.propType &&
          e.side === row.side &&
          Number(e.line) === Number(row.line)
      )
    ),
    {
      Assists: 6,
      Rebounds: 6,
      Points: 6,
      Threes: 4,
      PRA: 2
    }
  ),
  2
)
logFunnelStage("refresh-snapshot", "strongCapped-from-strongProps", strongProps, strongCapped, { typeCaps: "Assists:6,Rebounds:6,Points:6,Threes:4,PRA:2", playerCap: 2, note: "deduped-vs-eliteCapped" })
logFunnelExcluded("refresh-snapshot", "strongCapped-from-strongProps", strongProps, strongCapped)

const playableCapped = selectBalancedPool(
  playableProps.filter((row) =>
    !eliteCapped.some(
      (e) =>
        e.player === row.player &&
        e.propType === row.propType &&
        e.side === row.side &&
        Number(e.line) === Number(row.line)
    ) &&
    !strongCapped.some(
      (e) =>
        e.player === row.player &&
        e.propType === row.propType &&
        e.side === row.side &&
        Number(e.line) === Number(row.line)
    )
  ),
  {
    totalCap: 180,
    minPerBook: 80,
    maxPerPlayer: 3,
    maxPerMatchup: 6,
    maxPerType: {
      Assists: 32,
      Rebounds: 32,
      Points: 32,
      Threes: 22,
      PRA: 16
    }
  }
)
logFunnelStage("refresh-snapshot", "playableCapped-from-playableProps", playableProps, playableCapped, { totalCap: 180, minPerBook: 80, maxPerPlayer: 3, maxPerMatchup: 6 })
logFunnelExcluded("refresh-snapshot", "playableCapped-from-playableProps", playableProps, playableCapped)

const matchupValidProps = enriched.filter((row) => playerFitsMatchup(row))

const preBestStandardRows = (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => {
  const family = String(row?.marketFamily || "")
  const propType = String(row?.propType || "")
  return family === "standard" || ["Points", "Rebounds", "Assists", "Threes", "PRA"].includes(propType)
})

console.log("[PRE-BEST-STANDARD-COVERAGE-DEBUG]", {
  total: preBestStandardRows.length,
  byPropType: preBestStandardRows.reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  byBook: preBestStandardRows.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  sample: preBestStandardRows.slice(0, 20).map((row) => ({
    book: row?.book,
    propType: row?.propType,
    marketKey: row?.marketKey,
    player: row?.player,
    line: row?.line,
    hitRate: row?.hitRate,
    edge: row?.edge,
    score: row?.score
  }))
})


// --- Strict core bestProps promotion: only valid standard stat props ---
const STANDARD_PROP_TYPES = new Set(["Points", "Rebounds", "Assists", "Threes", "PRA"])
const bestPropsSourceRaw = Array.isArray(scoredProps) ? scoredProps : []
const bestPropsSource = []
const excludedSpecials = []
const excludedMalformed = []
const excludedLowRoleQuality = []
for (const row of bestPropsSourceRaw) {
  const isStandard = STANDARD_PROP_TYPES.has(String(row?.propType || ""))
  const hasAllFields = (
    row &&
    row.player &&
    row.team &&
    row.matchup &&
    row.propType &&
    Number.isFinite(row.line) &&
    row.hitRate != null &&
    Number.isFinite(row.score) &&
    row.book &&
    playerFitsMatchup(row)
  )
  if (!isStandard) {
    excludedSpecials.push(row)
    continue
  }
  if (!hasAllFields) {
    excludedMalformed.push(row)
    continue
  }
  // Role/minutes quality gate (slateMode-aware) to prevent low-minute mirages.
  if (!qualifiesBestPropsSource(row, tierSlateMode.mode)) {
    excludedLowRoleQuality.push(row)
    continue
  }
  bestPropsSource.push(row)
}
logBestStage("refresh-snapshot:sourcePool", bestPropsSource)
console.log(`[BEST-PROPS-SOURCE-DEBUG] path=refresh-snapshot sourceCount=${bestPropsSource.length}`)
console.log("[BEST-PROPS-EXCLUDED-DEBUG]", {
  excludedSpecials: excludedSpecials.length,
  excludedMalformed: excludedMalformed.length,
  excludedLowRoleQuality: excludedLowRoleQuality.length,
  sampleSpecials: excludedSpecials.slice(0, 5).map(r => ({ player: r?.player, propType: r?.propType, book: r?.book, line: r?.line })),
  sampleMalformed: excludedMalformed.slice(0, 5).map(r => ({ player: r?.player, propType: r?.propType, book: r?.book, line: r?.line, hitRate: r?.hitRate, score: r?.score, team: r?.team }))
})

const scheduledEventCountForBestBoard = Array.isArray(scheduledEvents) ? scheduledEvents.length : 0
const coveredEventCountForBestBoard = new Set(
  (Array.isArray(rawPropsRows) ? rawPropsRows : [])
    .map((row) => String(row?.eventId || ""))
    .filter(Boolean)
).size
const partialPostingModeForBestBoard =
  scheduledEventCountForBestBoard > 0 &&
  coveredEventCountForBestBoard > 0 &&
  coveredEventCountForBestBoard < scheduledEventCountForBestBoard

const bestPropsCapResult = buildBestPropsBalancedPool(bestPropsSource, {
  pathLabel: "refresh-snapshot",
  partialPostingMode: partialPostingModeForBestBoard
})
const preCapBestPropsPool = bestPropsCapResult.selected
logBestPropsCapDebug("refresh-snapshot", "pre-cap", bestPropsSource, preCapBestPropsPool, bestPropsCapResult.diagnostics)
let bestProps = preCapBestPropsPool.slice(0, BEST_PROPS_BALANCE_CONFIG.totalCap)
const sourceRows = Array.isArray(bestPropsSource) ? bestPropsSource : []
const fdRows = bestProps.filter((r) => r.book === "FanDuel")

if (fdRows.length < 10) {
  const fallbackFD = sourceRows
    .filter((r) => r.book === "FanDuel")
    .filter((r) => !shouldRemoveLegForPlayerStatus(r))
    .slice(0, 20)

  bestProps = [
    ...bestProps,
    ...fallbackFD.slice(0, 10 - fdRows.length)
  ]
}

console.log("[BEST-PROPS-BOOK-BALANCE]", {
  path: "refresh-snapshot",
  fanduel: bestProps.filter((r) => r.book === "FanDuel").length,
  draftkings: bestProps.filter((r) => r.book === "DraftKings").length
})
logBestStage("refresh-snapshot:afterRankingSortAndCap", bestProps)
logBestPropsCapExcluded("refresh-snapshot", bestPropsSource, bestProps, bestPropsCapResult.diagnostics)
logFunnelStage("refresh-snapshot", "bestProps-from-scoredProps", bestPropsSource, bestProps, { sortComposite: true, cap: BEST_PROPS_BALANCE_CONFIG.totalCap, minPerBook: BEST_PROPS_BALANCE_CONFIG.minPerBook, matchupCap: BEST_PROPS_BALANCE_CONFIG.maxPerMatchup, playerCap: BEST_PROPS_BALANCE_CONFIG.maxPerPlayer })
logFunnelExcluded("refresh-snapshot", "bestProps-from-scoredProps", bestPropsSource, bestProps)

// Thin slate adaptation: if bestProps collapses but we have playable-quality rows,
// promote a limited number to keep boards/tickets alive (no junk: playable gate).
{
  const mode = String(tierSlateMode?.mode || "").toLowerCase()
  const shouldPromote = mode === "thin" && Array.isArray(bestProps) && bestProps.length < 25 && Array.isArray(playableProps) && playableProps.length > 0
  if (shouldPromote) {
    const target = Math.min(32, Math.max(16, 25))
    const existing = new Set(bestProps.map((r) => `${r?.player}-${r?.propType}-${r?.side}-${Number(r?.line)}-${r?.book}`))
    let added = 0
    const rankedPlayable = [...playableProps].sort((a, b) => bestPropsCompositeScore(b) - bestPropsCompositeScore(a))
    for (const r of rankedPlayable) {
      if (bestProps.length >= target) break
      const key = `${r?.player}-${r?.propType}-${r?.side}-${Number(r?.line)}-${r?.book}`
      if (!key || existing.has(key)) continue
      if (!playerFitsMatchup(r) || shouldRemoveLegForPlayerStatus(r)) continue
      bestProps.push(r)
      existing.add(key)
      added += 1
    }
    bestProps = dedupeSlipLegs(bestProps).slice(0, BEST_PROPS_BALANCE_CONFIG.totalCap)
    console.log("[THIN-SLATE-BESTPROPS-PROMOTION]", {
      path: "refresh-snapshot",
      mode,
      target,
      added,
      finalBestProps: bestProps.length
    })
  }
}

// Final bestProps diversification (player cap + per-propType cap).
{
  const mode = String(tierSlateMode?.mode || "").toLowerCase()
  const before = Array.isArray(bestProps) ? bestProps.length : 0
  const diversified = diversifyBestProps(bestProps, {
    slateMode: mode,
    totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
    maxPerPlayer: mode === "thin" ? 3 : 2,
    maxPerPlayerPropType: 1
  })
  bestProps = diversified
  console.log("[BEST-PROPS-DIVERSIFY]", {
    path: "refresh-snapshot",
    mode,
    before,
    after: Array.isArray(bestProps) ? bestProps.length : 0
  })
}

const nextRawPropsCount = Array.isArray(rawPropsRows) ? rawPropsRows.length : 0
const nextPropsCount = Array.isArray(activeBookRawPropsRows) ? activeBookRawPropsRows.length : 0
const nextBestPropsCount = Array.isArray(bestProps) ? bestProps.length : 0
const scheduledEventsCount = Array.isArray(scheduledEvents) ? scheduledEvents.length : 0
const previousRawPropsCount = Array.isArray(previousSnapshot?.rawProps) ? previousSnapshot.rawProps.length : 0
const previousBestPropsCount = Array.isArray(previousSnapshot?.bestProps) ? previousSnapshot.bestProps.length : 0

const previousHadUsableData = previousRawPropsCount > 0 || previousBestPropsCount > 0
const newSnapshotIsEmptyButSlateExists =
  scheduledEventsCount > 0 &&
  nextRawPropsCount === 0 &&
  nextPropsCount === 0 &&
  nextBestPropsCount === 0

console.log("[SNAPSHOT-COMMIT-CHECK]", {
  scheduledEventsCount,
  nextRawPropsCount,
  nextPropsCount,
  nextBestPropsCount,
  previousRawPropsCount,
  previousBestPropsCount
})

if (newSnapshotIsEmptyButSlateExists && previousHadUsableData) {
  console.log("[SNAPSHOT-PRESERVE-PREVIOUS]", {
    scheduledEventsCount,
    nextRawPropsCount,
    nextPropsCount,
    nextBestPropsCount,
    previousRawPropsCount,
    previousBestPropsCount
  })

  oddsSnapshot = previousSnapshot
  lastSnapshotSource = "refresh-live-empty-preserved-previous"

  return res.status(200).json({
    ok: true,
    message: "Live refresh returned no props; preserved previous snapshot",
    snapshotMeta: buildSnapshotMeta({ source: "refresh-live-empty-preserved-previous" }),
    snapshotGeneratedAt: oddsSnapshot?.snapshotGeneratedAt || oddsSnapshot?.updatedAt || null,
    snapshotSlateDateLocal: oddsSnapshot?.snapshotSlateDateLocal || oddsSnapshot?.snapshotSlateDateKey || (oddsSnapshot?.updatedAt ? toDetroitDateKey(oddsSnapshot.updatedAt) : null),
    counts: {
      scheduledEvents: scheduledEventsCount,
      incomingRawProps: nextRawPropsCount,
      incomingProps: nextPropsCount,
      incomingBestProps: nextBestPropsCount,
      preservedRawProps: previousRawPropsCount,
      preservedBestProps: previousBestPropsCount
    }
  })
}

console.log("[TOP-DOWN-SNAPSHOT-PRE-COMMIT]", {
  events: Array.isArray(scheduledEvents) ? scheduledEvents.length : -1,
  rawProps: Array.isArray(rawPropsRows) ? rawPropsRows.length : -1,
  props: Array.isArray(activeBookRawPropsRows) ? activeBookRawPropsRows.length : -1,
  bestProps: Array.isArray(bestProps) ? bestProps.length : -1
})
console.log("[REFRESH-STAGE-4-SNAPSHOT-ASSEMBLY]", {
  events: Array.isArray(scheduledEvents) ? scheduledEvents.length : -1,
  rawProps: Array.isArray(rawPropsRows) ? rawPropsRows.length : -1,
  props: Array.isArray(activeBookRawPropsRows) ? activeBookRawPropsRows.length : -1,
  bestProps: Array.isArray(bestProps) ? bestProps.length : -1
})
oddsSnapshot.updatedAt = new Date().toISOString()
const lineHistoryObservedAt = oddsSnapshot.updatedAt
const previousRawPropsForHistory = Array.isArray(previousSnapshot?.rawProps) ? previousSnapshot.rawProps : []
const previousPropsForHistory = Array.isArray(previousSnapshot?.props) ? previousSnapshot.props : []
const previousBestPropsForHistory = Array.isArray(previousSnapshot?.bestProps) ? previousSnapshot.bestProps : []
const rawPropsRowsWithHistory = applyPersistentLineHistory(rawPropsRows, previousRawPropsForHistory, lineHistoryObservedAt)
let activeBookRawPropsRowsWithHistory = applyPersistentLineHistory(activeBookRawPropsRows, previousPropsForHistory, lineHistoryObservedAt)
bestProps = applyPersistentLineHistory(bestProps, previousBestPropsForHistory, lineHistoryObservedAt)
oddsSnapshot.events = Array.isArray(scheduledEvents) ? scheduledEvents : []
oddsSnapshot.rawProps = rawPropsRowsWithHistory
console.log("[NBA FETCH]", {
  phase: "snapshot_write",
  rowsWritten: Array.isArray(oddsSnapshot.rawProps) ? oddsSnapshot.rawProps.length : 0,
  eventsWritten: Array.isArray(oddsSnapshot.events) ? oddsSnapshot.events.length : 0
})

const beforeMissing = (Array.isArray(activeBookRawPropsRowsWithHistory) ? activeBookRawPropsRowsWithHistory : []).filter((r) => !r?.team).length
activeBookRawPropsRowsWithHistory = (Array.isArray(activeBookRawPropsRowsWithHistory) ? activeBookRawPropsRowsWithHistory : []).map((row) => {
  if (!row?.team) {
    if (row?.playerTeam) return { ...row, team: row.playerTeam }
    if (row?.homeTeam) return { ...row, team: row.homeTeam }
  }
  return row
})
const afterMissing = (Array.isArray(activeBookRawPropsRowsWithHistory) ? activeBookRawPropsRowsWithHistory : []).filter((r) => !r?.team).length
console.log("[TEAM FIX APPLIED FINAL]", {
  beforeMissing,
  afterMissing
})

oddsSnapshot.props = activeBookRawPropsRowsWithHistory
const slateStateForSanitize = chosenSlateDateKey === tomorrowDateKey ? "rolled_to_tomorrow" : "active_today"
console.log("[NBA FILTER TRACE]", {
  stage: "props_pre_sanitize",
  count: Array.isArray(activeBookRawPropsRowsWithHistory) ? activeBookRawPropsRowsWithHistory.length : 0,
  slateStateForSanitize
})
// Ensure sanitizeSnapshotRows can run in the correct slate context even before
// the full slateStateValidator object is assembled later in the pipeline.
oddsSnapshot.slateStateValidator = oddsSnapshot.slateStateValidator || { slateState: slateStateForSanitize }
oddsSnapshot.props = sanitizeSnapshotRows(oddsSnapshot.props, { slateState: slateStateForSanitize })
console.log("[NBA FILTER TRACE]", {
  stage: "final_props",
  count: Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props.length : 0
})
console.log("[RAW PROPS BUILT]", Array.isArray(oddsSnapshot.rawProps) ? oddsSnapshot.rawProps.length : 0)
console.log("[POST SANITIZE]", Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props.length : 0)

// ThinBad degraded mode: if strict sanitation/quality gates starve props to zero,
// allow a degraded-but-valid set instead of empty output.
if ((Array.isArray(oddsSnapshot.rawProps) ? oddsSnapshot.rawProps.length : 0) > 0 && (Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props.length : 0) === 0) {
  const snapshotSlateMode = detectSlateMode({
    sportKey: "nba",
    snapshotMeta: { snapshotSlateGameCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0 },
    snapshot: { events: scheduledEvents, rawProps: oddsSnapshot.rawProps, props: oddsSnapshot.props, bestProps: [] },
    runtime: { loadedSlateQualityPassEnabled: false }
  })

  if (String(snapshotSlateMode?.mode || "").toLowerCase() === "thinbad") {
    console.log("[QUALITY FAIL TRIGGERED]", {
      rawPropsCount: Array.isArray(oddsSnapshot.rawProps) ? oddsSnapshot.rawProps.length : 0,
      propsCountBefore: 0,
      reason: "loaded-slate-quality-pass-failed",
      slateMode: snapshotSlateMode.mode
    })

    const relaxed = (Array.isArray(oddsSnapshot.rawProps) ? oddsSnapshot.rawProps : []).filter((row) =>
      row &&
      row.marketValidity !== "invalid" &&
      row.odds != null &&
      Number(row.odds) > -10000 &&
      row.propType != null
    )

    oddsSnapshot.props = relaxed.slice(0, 250)
    console.log("[POST-FILTER COUNT]", Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props.length : 0)
  }
}
oddsSnapshot.snapshotGeneratedAt = oddsSnapshot.updatedAt || null
oddsSnapshot.snapshotSlateDateKey = chosenSlateDateKey || null
oddsSnapshot.snapshotSlateDateLocal = chosenSlateDateKey || (oddsSnapshot.updatedAt ? toDetroitDateKey(oddsSnapshot.updatedAt) : null)
oddsSnapshot.snapshotSlateGameCount = Array.isArray(scheduledEvents) ? scheduledEvents.length : 0
console.log("[INGESTION FINAL]", {
  events: Array.isArray(oddsSnapshot.events) ? oddsSnapshot.events.length : 0,
  rawProps: Array.isArray(oddsSnapshot.rawProps) ? oddsSnapshot.rawProps.length : 0
})
const chosenEventIds = new Set((Array.isArray(scheduledEvents) ? scheduledEvents : []).map((event) => String(event?.id || event?.eventId || "")).filter(Boolean))
const chosenEventIdsWithProps = new Set((Array.isArray(activeBookRawPropsRowsWithHistory) ? activeBookRawPropsRowsWithHistory : []).map((row) => String(row?.eventId || "")).filter((eventId) => chosenEventIds.has(eventId)))
const chosenEventIdsArray = Array.from(chosenEventIds)
const chosenEventIdsWithPropsArray = Array.from(chosenEventIdsWithProps)
const missingChosenEventIdsArray = chosenEventIdsArray.filter((eventId) => !chosenEventIdsWithProps.has(eventId))
const eventIngestDebugByEventId = new Map(
  (Array.isArray(eventIngestDebug) ? eventIngestDebug : [])
    .map((item) => [String(item?.eventId || ""), item])
    .filter(([eventId]) => Boolean(eventId))
)
const rawPropsRowsForCoverageDebug = Array.isArray(rawPropsRowsWithHistory)
  ? rawPropsRowsWithHistory
  : (Array.isArray(rawPropsRows) ? rawPropsRows : [])
const rawPropCountsByEventId = rawPropsRowsForCoverageDebug.reduce((acc, row) => {
  const eventId = String(row?.eventId || "")
  if (!eventId) return acc
  acc.set(eventId, (acc.get(eventId) || 0) + 1)
  return acc
}, new Map())
const chosenEventsById = (Array.isArray(scheduledEvents) ? scheduledEvents : []).reduce((acc, event) => {
  const eventId = String(event?.id || event?.eventId || "")
  if (eventId) acc.set(eventId, event)
  return acc
}, new Map())
const classifyChosenEventPostingState = (eventId, rawPropsCountBeforeFinalFiltering) => {
  const ingest = eventIngestDebugByEventId.get(eventId) || null
  const requestSucceeded = ingest?.dkRequestSucceeded === true
  const fetchError = ingest?.dkFetchError === true || ingest?.dkRequestSucceeded === false
  const dkBookmakerEntries = Number(ingest?.dkBookmakerEntries || 0)
  const dkMarketEntries = Number(ingest?.dkMarketEntries || 0)
  const acceptedRows = Number(ingest?.finalAcceptedRows || ingest?.normalizedRowsProduced || 0)

  if (rawPropsCountBeforeFinalFiltering > 0) {
    if (requestSucceeded && dkMarketEntries > 0 && dkMarketEntries <= 2) return "partial_props_posted"
    return "props_posted"
  }
  if (fetchError) return "ingest_error"
  if (requestSucceeded && dkBookmakerEntries === 0 && dkMarketEntries === 0) return "no_props_posted_yet"
  if (requestSucceeded && (dkBookmakerEntries > 0 || dkMarketEntries > 0) && acceptedRows === 0) return "fetched_but_zero_accepted_rows"
  return "true_unknown_gap"
}
const chosenEventCoverageStates = chosenEventIdsArray.map((eventId) => {
  const event = chosenEventsById.get(eventId) || null
  const rawPropsCountBeforeFinalFiltering = Number(rawPropCountsByEventId.get(eventId) || 0)
  return {
    eventId,
    matchup: event?.matchup || null,
    postingState: classifyChosenEventPostingState(eventId, rawPropsCountBeforeFinalFiltering),
    rawPropsCountBeforeFinalFiltering
  }
})
const missingChosenEventSummaries = missingChosenEventIdsArray.map((eventId) => {
  const event = chosenEventsById.get(eventId) || null
  const ingest = eventIngestDebugByEventId.get(eventId) || null
  const rawPropsCountBeforeFinalFiltering = Number(rawPropCountsByEventId.get(eventId) || 0)
  const postingState = classifyChosenEventPostingState(eventId, rawPropsCountBeforeFinalFiltering)
  return {
    eventId,
    matchup: event?.matchup || null,
    commenceTime: event ? (getEventTime(event) || event?.commenceTime || null) : null,
    homeTeam: event?.homeTeam || event?.home_team || null,
    awayTeam: event?.awayTeam || event?.away_team || null,
    postingState,
    dkFetchError: ingest?.dkFetchError === true,
    dkRequestSucceeded: ingest?.dkRequestSucceeded === true,
    dkBookmakerEntries: Number(ingest?.dkBookmakerEntries || 0),
    dkMarketEntries: Number(ingest?.dkMarketEntries || 0),
    rawPropsExistedBeforeFinalFiltering: rawPropsCountBeforeFinalFiltering > 0,
    rawPropsCountBeforeFinalFiltering
  }
})
const chosenEventCount = chosenEventIds.size
const chosenEventsWithPropsCount = chosenEventIdsWithProps.size
const partialPostedChosenEventCount = chosenEventCoverageStates.filter((item) => item.postingState === "partial_props_posted").length
const noPropsPostedChosenEventCount = chosenEventCoverageStates.filter((item) => item.postingState === "no_props_posted_yet").length
const ingestErrorChosenEventCount = chosenEventCoverageStates.filter((item) => item.postingState === "ingest_error").length
console.log("[CHOSEN-SLATE-PROP-COVERAGE-DEBUG]", {
  chosenSlateDateKey,
  chosenEventCount,
  chosenEventsWithPropsCount,
  partialPostedChosenEventCount,
  noPropsPostedChosenEventCount,
  ingestErrorChosenEventCount,
  chosenEventIds: chosenEventIdsArray,
  chosenEventIdsWithProps: chosenEventIdsWithPropsArray,
  missingChosenEventIds: missingChosenEventIdsArray,
  chosenEventCoverageStates,
  missingChosenEventSummaries
})
const chosenPropsPartiallyPosted = chosenEventCount > 0 && chosenEventsWithPropsCount > 0 && chosenEventsWithPropsCount < chosenEventCount
let slateState = "active_today"
if (todayPregameEligible.length > 0) {
  slateState = "active_today"
} else if (chosenSlateDateKey === tomorrowDateKey && chosenEventsWithPropsCount === 0) {
  slateState = "awaiting_posting"
} else if (chosenSlateDateKey === tomorrowDateKey) {
  slateState = "rolled_to_tomorrow"
}
oddsSnapshot.slateStateValidator = {
  currentDateKeyChosen: chosenSlateDateKey || null,
  currentPregameGameCount: todayPregameEligible.length,
  todayTotalGames: todayEvents.length,
  tomorrowTotalGames: tomorrowEvents.length,
  todayHasPregameGames: todayPregameEligible.length > 0,
  tomorrowPropsPartiallyPosted: chosenSlateDateKey === tomorrowDateKey ? chosenPropsPartiallyPosted : false,
  slateState,
  chosenEventsWithPropsCount,
  chosenEventCount,
  partialPostedChosenEventCount,
  noPropsPostedChosenEventCount,
  ingestErrorChosenEventCount,
  chosenEventCoverageStates,
  missingChosenEventIds: missingChosenEventIdsArray,
  missingChosenEventSummaries,
  rolloverApplied: chosenSlateDateKey !== todayDateKey,
  nextDateKeyConsidered: tomorrowDateKey,
  nextPregameGameCount: tomorrowEvents.filter(e => {
    const t = new Date(getEventTime(e)).getTime()
    return Number.isFinite(t) && t > slateNow
  }).length
}
console.log("[UNSTABLE-GAME-INGEST-DEBUG]", {
  path: "refresh-snapshot",
  targets: targetMissingEventStages.map((stage) => ({
    ...stage,
    inFinalSavedRawProps: (oddsSnapshot.rawProps || []).some((row) => String(row?.eventId || "") === stage.eventId),
    inFinalSavedProps: (oddsSnapshot.props || []).some((row) => String(row?.eventId || "") === stage.eventId)
  }))
})
oddsSnapshot.eliteProps = applyPersistentLineHistory(eliteCapped.filter((row) => playerFitsMatchup(row)), previousRawPropsForHistory, lineHistoryObservedAt)
oddsSnapshot.eliteProps = sanitizeSnapshotRows(oddsSnapshot.eliteProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
logFunnelStage("refresh-snapshot", "oddsSnapshot.eliteProps", eliteCapped, oddsSnapshot.eliteProps, { filter: "playerFitsMatchup" })
logFunnelExcluded("refresh-snapshot", "oddsSnapshot.eliteProps", eliteCapped, oddsSnapshot.eliteProps)
oddsSnapshot.strongProps = applyPersistentLineHistory(strongCapped.filter((row) => playerFitsMatchup(row)), previousRawPropsForHistory, lineHistoryObservedAt)
oddsSnapshot.strongProps = sanitizeSnapshotRows(oddsSnapshot.strongProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
logFunnelStage("refresh-snapshot", "oddsSnapshot.strongProps", strongCapped, oddsSnapshot.strongProps, { filter: "playerFitsMatchup" })
logFunnelExcluded("refresh-snapshot", "oddsSnapshot.strongProps", strongCapped, oddsSnapshot.strongProps)
oddsSnapshot.playableProps = applyPersistentLineHistory(playableCapped.filter((row) => playerFitsMatchup(row)), previousRawPropsForHistory, lineHistoryObservedAt)
oddsSnapshot.playableProps = sanitizeSnapshotRows(oddsSnapshot.playableProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
logFunnelStage("refresh-snapshot", "oddsSnapshot.playableProps", playableCapped, oddsSnapshot.playableProps, { filter: "playerFitsMatchup" })
logFunnelExcluded("refresh-snapshot", "oddsSnapshot.playableProps", playableCapped, oddsSnapshot.playableProps)
logPropStageByBookDebug("refresh-snapshot:afterTierAssignment", {
  elite: oddsSnapshot.eliteProps,
  strong: oddsSnapshot.strongProps,
  playable: oddsSnapshot.playableProps,
  best: bestProps
})

// STEP 5: Final visibility guarantee - ensure all watched players in rawProps make it to bestProps
const watchedNormalized = WATCHED_PLAYER_NAMES.map(normalizeDebugPlayerName)
const allRawPropsForWatchedCheck = dedupeByLegSignature([
  ...(Array.isArray(oddsSnapshot.props) ? oddsSnapshot.props : [])
])
const missingWatchedInBest = allRawPropsForWatchedCheck.filter(row => {
  const name = normalizeDebugPlayerName(row?.player || "")
  const isWatched = watchedNormalized.includes(name)
  const inBest = bestProps.some(p => normalizeDebugPlayerName(p?.player || "") === name)
  return isWatched && !inBest
})

for (const row of missingWatchedInBest) {
  const playerName = normalizeDebugPlayerName(row?.player || "")
  if (!bestProps.some(p => normalizeDebugPlayerName(p?.player || "") === playerName)) {
    bestProps.push(row)
    console.log("[WATCHED-PLAYER-FINAL-GUARANTEE]", {
      player: row?.player,
      reason: "missing_from_best_added_from_raw",
      propType: row?.propType,
      book: row?.book,
      line: row?.line
    })
  }
}

const finalBestPropsGateDebug = {
  finalBestPropsExcludedSpecial: 0,
  finalBestPropsExcludedNonStandard: 0,
  finalBestPropsExcludedInvalidCoreFields: 0,
  finalBestPropsExcludedInvalidLine: 0,
  finalBestPropsExcludedInvalidScore: 0,
  finalBestPropsForceIncludedBlocked: 0
}
const bestPropsAfterFinalLegacyGate = (Array.isArray(bestProps) ? bestProps : []).filter((row) => {
  if (!row) {
    finalBestPropsGateDebug.finalBestPropsExcludedInvalidCoreFields += 1
    return false
  }

  const blockForceIncluded = () => {
    if (row?.__forceInclude) finalBestPropsGateDebug.finalBestPropsForceIncludedBlocked += 1
  }

  if (String(row?.marketFamily || "") === "special") {
    finalBestPropsGateDebug.finalBestPropsExcludedSpecial += 1
    blockForceIncluded()
    return false
  }

  if (!STANDARD_PROP_TYPES.has(String(row?.propType || ""))) {
    finalBestPropsGateDebug.finalBestPropsExcludedNonStandard += 1
    blockForceIncluded()
    return false
  }

  if (!row?.player || !row?.team || !row?.matchup || !row?.propType || !row?.book) {
    finalBestPropsGateDebug.finalBestPropsExcludedInvalidCoreFields += 1
    blockForceIncluded()
    return false
  }

  if (!Number.isFinite(Number(row?.line))) {
    finalBestPropsGateDebug.finalBestPropsExcludedInvalidLine += 1
    blockForceIncluded()
    return false
  }

  if (!Number.isFinite(Number(row?.score))) {
    finalBestPropsGateDebug.finalBestPropsExcludedInvalidScore += 1
    blockForceIncluded()
    return false
  }

  return true
})

console.log("[BEST-PROPS-FINAL-GATE-DEBUG]", {
  inputCount: Array.isArray(bestProps) ? bestProps.length : 0,
  outputCount: bestPropsAfterFinalLegacyGate.length,
  ...finalBestPropsGateDebug
})

// Final-best shaping: enforce diversification and ceiling/impact exclusions after any
// force-includes and final gate logic.
{
  const mode = String(tierSlateMode?.mode || "").toLowerCase()
  const diversifiedFinal = diversifyBestProps(bestPropsAfterFinalLegacyGate, {
    slateMode: mode,
    totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
    maxPerPlayer: mode === "thin" ? 3 : 2,
    maxPerPlayerPropType: 1
  })
  oddsSnapshot.bestProps = dedupeByLegSignature(diversifiedFinal)
  oddsSnapshot.bestProps = sanitizeSnapshotRows(oddsSnapshot.bestProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
  console.log("[BEST-PROPS-FINAL-DIVERSIFY]", {
    path: "refresh-snapshot",
    mode,
    before: bestPropsAfterFinalLegacyGate.length,
    after: oddsSnapshot.bestProps.length
  })
}
oddsSnapshot.lineHistorySummary = buildLineHistorySummary(oddsSnapshot.bestProps)
const bestPropsBookSoftFloor = Math.max(
  4,
  Math.min(10, Math.floor((Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps.length : 0) * 0.3))
)
console.log("[FINAL-LEGACY-BESTPROPS-DEBUG]", {
  total: Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps.length : 0,
  bestPropsByPropType: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  bestPropsByMarketFamily: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).reduce((acc, row) => {
    const key = String(row?.marketFamily || "unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}),
  invalidLineCount: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((row) => !Number.isFinite(Number(row?.line))).length,
  invalidScoreCount: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((row) => !Number.isFinite(Number(row?.score))).length,
  missingTeamCount: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).filter((row) => !row?.team).length,
  sample: (Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : []).slice(0, 10).map((row) => ({
    player: row?.player || null,
    matchup: row?.matchup || null,
    propType: row?.propType || null,
    marketKey: row?.marketKey || null,
    marketFamily: row?.marketFamily || null,
    team: row?.team || null,
    line: row?.line ?? null,
    odds: row?.odds ?? null,
    score: row?.score ?? null,
    hitRate: row?.hitRate ?? null,
    __forceInclude: row?.__forceInclude === true
  }))
})
logBestStage("refresh-snapshot:afterDedupe", oddsSnapshot.bestProps)
const mainBestPropsBookRescue = ensureBestPropsBookPresence(oddsSnapshot.bestProps, bestPropsSource, {
  targetBook: "DraftKings",
  totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
  meaningfulFloor: bestPropsBookSoftFloor
})
const mainBestPropsFanDuelRescue = ensureBestPropsBookPresence(mainBestPropsBookRescue.rows, bestPropsSource, {
  targetBook: "FanDuel",
  totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap,
  meaningfulFloor: bestPropsBookSoftFloor
})
const refreshPlayableFanDuelPromotion = ensureBestPropsPlayableBookFloor(
  mainBestPropsFanDuelRescue.rows,
  oddsSnapshot.playableProps,
  {
    targetBook: "FanDuel",
    minCount: 8,
    totalCap: BEST_PROPS_BALANCE_CONFIG.totalCap
  }
)
oddsSnapshot.bestProps = dedupeByLegSignature(
  Array.isArray(refreshPlayableFanDuelPromotion.rows) ? refreshPlayableFanDuelPromotion.rows : []
)
oddsSnapshot.bestProps = sanitizeSnapshotRows(oddsSnapshot.bestProps, { slateState: oddsSnapshot?.slateStateValidator?.slateState })
console.log("[NBA FILTER TRACE]", {
  stage: "final_best",
  count: Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps.length : 0
})
oddsSnapshot.lineHistorySummary = buildLineHistorySummary(oddsSnapshot.bestProps)
logBestStage("refresh-snapshot:afterBookBalance", refreshPlayableFanDuelPromotion.rows)
console.log("[BEST-PROPS-PLAYABLE-PROMOTION-DEBUG]", {
  path: "refresh-snapshot",
  initialFanDuelCount: refreshPlayableFanDuelPromotion.initialBookCount,
  finalFanDuelCount: refreshPlayableFanDuelPromotion.finalBookCount,
  promotedCount: refreshPlayableFanDuelPromotion.promotedCount,
  playableFanDuelCount: countByBookForRows(oddsSnapshot.playableProps).FanDuel
})

const refreshSnapshotBestPropsRawRows = Array.isArray(refreshPlayableFanDuelPromotion.rows) ? refreshPlayableFanDuelPromotion.rows : []
console.log("[BEST-RAW-BY-PROP-DEBUG]", {
  total: Array.isArray(refreshSnapshotBestPropsRawRows) ? refreshSnapshotBestPropsRawRows.length : 0,
  byPropType: (Array.isArray(refreshSnapshotBestPropsRawRows) ? refreshSnapshotBestPropsRawRows : []).reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
})
const refreshSnapshotFinalBestVisibleRowsPreSave = getAvailablePrimarySlateRows(refreshSnapshotBestPropsRawRows)
const refreshSnapshotSurvivedFragileRowsPreSave = (Array.isArray(scoredProps) ? scoredProps : []).filter((row) => {
  try {
    return !isFragileLeg(row, "best")
  } catch (_) {
    return true
  }
})
console.log("[FRAGILE-FILTER-SUMMARY-DEBUG]", {
  inputCount: (Array.isArray(enriched) ? enriched : []).length,
  survivedCount: refreshSnapshotSurvivedFragileRowsPreSave.length,
  removedCount: Math.max(0, (Array.isArray(enriched) ? enriched : []).length - refreshSnapshotSurvivedFragileRowsPreSave.length),
  byBookInput: {
    FanDuel: (Array.isArray(enriched) ? enriched : []).filter((row) => row?.book === "FanDuel").length,
    DraftKings: (Array.isArray(enriched) ? enriched : []).filter((row) => row?.book === "DraftKings").length
  },
  byBookSurvived: {
    FanDuel: refreshSnapshotSurvivedFragileRowsPreSave.filter((row) => row?.book === "FanDuel").length,
    DraftKings: refreshSnapshotSurvivedFragileRowsPreSave.filter((row) => row?.book === "DraftKings").length
  }
})
const refreshSnapshotMissingStageNames = []
const targetEvents = Array.isArray(scheduledEvents)
  ? scheduledEvents
  : (Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events : [])
if (!Array.isArray(targetEvents)) refreshSnapshotMissingStageNames.push("scheduledEvents")
if (!Array.isArray(cleaned)) refreshSnapshotMissingStageNames.push("rawPropsRows")
if (!Array.isArray(enriched)) refreshSnapshotMissingStageNames.push("enrichedModelRows")
if (!Array.isArray(scoredProps)) refreshSnapshotMissingStageNames.push("survivedFragileRows")
if (!Array.isArray(refreshPlayableFanDuelPromotion.rows)) refreshSnapshotMissingStageNames.push("bestPropsRawRows")

const refreshRawPropsByBook = countByBookForRows(activeBookRawPropsRows)
const refreshSurvivedFragileByBook = countByBookForRows(refreshSnapshotSurvivedFragileRowsPreSave)
const refreshPreBestCandidateByBook = countByBookForRows(Array.isArray(bestPropsSource) ? bestPropsSource : [])
const refreshFinalBestRawByBook = countByBookForRows(refreshSnapshotBestPropsRawRows)

console.log("[BEST-PROPS-BOOK-STAGE-DEBUG]", {
  path: "refresh-snapshot",
  rawPropsRows: refreshRawPropsByBook,
  dedupedRows: countByBookForRows(deduped),
  scoredPropsRows: countByBookForRows(scoredProps),
  survivedFragileRows: refreshSurvivedFragileByBook,
  preBestPropsCandidates: refreshPreBestCandidateByBook,
  finalBestPropsRawRows: refreshFinalBestRawByBook,
  balancer: {
    minPerBook: bestPropsCapResult?.diagnostics?.minPerBook,
    reserveTargetByBook: bestPropsCapResult?.diagnostics?.reserveTargetByBook,
    selectedByBookAfterReservePass: bestPropsCapResult?.diagnostics?.selectedByBookAfterReservePass,
    finalDifferenceFDvsDK: bestPropsCapResult?.diagnostics?.finalDifferenceFDvsDK
  }
})

const refreshFdCandidates = (Array.isArray(bestPropsSource) ? bestPropsSource : []).filter((row) => String(row?.book || "") === "FanDuel")
const refreshFdFinal = refreshSnapshotBestPropsRawRows.filter((row) => String(row?.book || "") === "FanDuel")
const refreshFdDropReasons = {
  totalFdCandidates: refreshFdCandidates.length,
  finalFdRows: refreshFdFinal.length,
  droppedByBookBalancer: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perBookBalancing || 0),
  droppedByPlayerCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perPlayerCap || 0),
  droppedByMatchupCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perMatchupCap || 0),
  droppedByStatCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.perStatCap || 0),
  droppedByTotalCap: Number(bestPropsCapResult?.diagnostics?.dropCounts?.totalCap || 0),
  sourceHasFanDuelCandidates: refreshFdCandidates.length > 0
}

console.log("[BEST-PROPS-BOOK-EXCLUSION-DEBUG]", {
  path: "refresh-snapshot",
  fanduel: refreshFdDropReasons
})

const __normalizedFamilySummary = summarizeInterestingNormalizedRows(rawPropsRows || [])
const __normalizedCoverageSummary = summarizeNormalizedMarketCoverage(rawPropsRows || [])

console.log("[NORMALIZATION-MARKET-FAMILY-DEBUG]", __normalizedFamilySummary)
console.log("[NORMALIZATION-MARKET-KEYS-TOP-DEBUG]", {
  totalRows: __normalizedCoverageSummary.totalRows,
  topPropTypes: Object.entries(__normalizedCoverageSummary.byPropType || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15),
  topMarketKeys: Object.entries(__normalizedCoverageSummary.byMarketKey || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25),
  byBookAndPropType: __normalizedCoverageSummary.byBookAndPropType || {}
})

console.log("[COVERAGE-AUDIT-CALLSITE-DEBUG]", {
  path: "refresh-snapshot-pre-finalize",
  scheduledEvents: (Array.isArray(targetEvents) ? targetEvents : []).length,
  rawPropsRows: activeBookRawPropsRows.length,
  enrichedModelRows: (Array.isArray(enriched) ? enriched : []).length,
  survivedFragileRows: refreshSnapshotSurvivedFragileRowsPreSave.length,
  survivedFragileRowsByBook: {
    FanDuel: refreshSnapshotSurvivedFragileRowsPreSave.filter((r) => r?.book === "FanDuel").length,
    DraftKings: refreshSnapshotSurvivedFragileRowsPreSave.filter((r) => r?.book === "DraftKings").length
  },
  bestPropsRawRows: refreshSnapshotBestPropsRawRows.length,
  bestPropsRawRowsByBook: {
    FanDuel: refreshSnapshotBestPropsRawRows.filter((r) => r?.book === "FanDuel").length,
    DraftKings: refreshSnapshotBestPropsRawRows.filter((r) => r?.book === "DraftKings").length
  },
  finalBestVisibleRows: refreshSnapshotFinalBestVisibleRowsPreSave.length,
  missingStages: refreshSnapshotMissingStageNames
})
runCurrentSlateCoverageDiagnostics({
  scheduledEvents: Array.isArray(targetEvents) ? targetEvents : [],
  rawPropsRows: activeBookRawPropsRows,
  enrichedModelRows: Array.isArray(enriched) ? enriched : [],
  survivedFragileRows: refreshSnapshotSurvivedFragileRowsPreSave,
  bestPropsRawRows: refreshSnapshotBestPropsRawRows,
  finalBestVisibleRows: refreshSnapshotFinalBestVisibleRowsPreSave
})

const refreshPromotedBestProps = Array.isArray(refreshPlayableFanDuelPromotion.rows)
  ? refreshPlayableFanDuelPromotion.rows
  : []
logBestStage("refresh-snapshot:finalAssignedBestProps", oddsSnapshot.bestProps)
logPropStageByBookDebug("refresh-snapshot:finalPromotion", {
  elite: oddsSnapshot.eliteProps,
  strong: oddsSnapshot.strongProps,
  playable: oddsSnapshot.playableProps,
  best: oddsSnapshot.bestProps
})
const refreshWatchedRawApiCounts = aggregateWatchedCountsFromEventDebug(eventIngestDebug)
const refreshWatchedCoverage = buildWatchedPlayersCoverage(
  refreshWatchedRawApiCounts,
  activeBookRawPropsRows,
  oddsSnapshot.bestProps
)
oddsSnapshot.diagnostics = {
  ...(oddsSnapshot.diagnostics && typeof oddsSnapshot.diagnostics === "object" ? oddsSnapshot.diagnostics : {}),
  activeBooks: ACTIVE_BOOKS,
  scheduledEventCount: Array.isArray(scheduledEvents) ? scheduledEvents.length : 0,
  coveredEventCount: coveredEvents.length,
  missingScheduledEventCount: missingScheduledEvents.length,
  watchedPlayersCoverage: refreshWatchedCoverage
}
console.log("[WATCHED-PLAYER-COVERAGE-GUARD]", {
  path: "refresh-snapshot",
  players: refreshWatchedCoverage.map((row) => ({
    player: row.player,
    rawPropsPresent: row.rawPropsPresent,
    rawPropsCount: row.rawPropsCount,
    bestPropsPresent: row.bestPropsPresent,
    bestPropsCount: row.bestPropsCount,
    missingReason: row.missingReason
  }))
})
const bestPropsPoolForMixed = oddsSnapshot.bestProps || bestProps
const bestAvailable = buildMixedBestAvailableBuckets(bestPropsPoolForMixed, {
  thinSlateMode:
    (Array.isArray(bestPropsPoolForMixed) ? bestPropsPoolForMixed.length : 0) < 140 ||
    (Number(oddsSnapshot?.snapshotSlateGameCount || 0) > 0 && Number(oddsSnapshot.snapshotSlateGameCount) <= 4)
})
oddsSnapshot.safe = bestAvailable.safe
oddsSnapshot.balanced = bestAvailable.balanced
oddsSnapshot.aggressive = bestAvailable.aggressive
oddsSnapshot.lotto = bestAvailable.lotto
console.log("[PARLAY-BUILDER-RESULT]", {
  safe: !!oddsSnapshot.safe,
  balanced: !!oddsSnapshot.balanced,
  aggressive: !!oddsSnapshot.aggressive,
  lotto: !!oddsSnapshot.lotto
})
const refreshSnapshotFinalVisibleBest = getAvailablePrimarySlateRows(oddsSnapshot.bestProps || [])
logBestStage("refresh-snapshot:afterFinalVisibilityFiltering", refreshSnapshotFinalVisibleBest)
console.log("[PRIMARY-SLATE-DISCOVERY-DEBUG]", {
  path: "refresh-snapshot",
  unrestrictedEventFetchCount: unrestrictedEventIds.length,
  unrestrictedEventIds,
  scheduledEventCount: scheduledEventIds.length,
  scheduledEventIds,
  dkScopedEventFetchCount: dkScopedEventIds.length,
  dkScopedEventIds,
  missingFromDkButInScheduled,
  mappedRawPropGameCount: getDistinctGameCount(activeBookRawPropsRows),
  playablePropGameCount: getDistinctGameCount(oddsSnapshot.playableProps),
  bestPropGameCount: getDistinctGameCount(refreshSnapshotFinalVisibleBest)
})
console.log("[BEST-PROPS-STAGE-COUNTS]", {
  path: "refresh-snapshot",
  stage: "afterFinalVisibilityFilter",
  total: refreshSnapshotFinalVisibleBest.length,
  byBook: {
    FanDuel: refreshSnapshotFinalVisibleBest.filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: refreshSnapshotFinalVisibleBest.filter((row) => String(row?.book || "") === "DraftKings").length
  }
})
console.log("[BEST-PROPS-PIPELINE-COUNTS]", {
  path: "refresh-snapshot",
  sourceCandidates: bestPropsSource.length,
  postEligibility: bestPropsCapResult?.diagnostics?.eligibleCount || 0,
  postDedupe: bestPropsCapResult?.diagnostics?.dedupedCount || 0,
  postBalancer: preCapBestPropsPool.length,
  postFinalAssignment: oddsSnapshot.bestProps.length,
  finalVisibleByBook: {
    FanDuel: getAvailablePrimarySlateRows(oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: getAvailablePrimarySlateRows(oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length
  }
})
console.log("[BEST-PROPS-FINAL-DEBUG]", {
  finalBestPropsTotal: (oddsSnapshot.bestProps || []).length,
  finalFDCount: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
  finalDKCount: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length,
  first10Players: (oddsSnapshot.bestProps || []).slice(0, 10).map((row) => ({
    player: row?.player,
    book: row?.book,
    propType: row?.propType
  }))
})
console.log("[BEST-PROPS-SIZE-DEBUG]", {
  path: "refresh-snapshot",
  eligibleCount: bestPropsSource.length,
  selectedFinalCount: (oddsSnapshot.bestProps || []).length,
  byBook: {
    FanDuel: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "FanDuel").length,
    DraftKings: (oddsSnapshot.bestProps || []).filter((row) => String(row?.book || "") === "DraftKings").length
  }
})
logBestPropsCapDebug("refresh-snapshot", "post-cap", bestPropsSource, bestProps, bestPropsCapResult.diagnostics)
logFunnelStage("refresh-snapshot", "oddsSnapshot.bestProps", bestProps, oddsSnapshot.bestProps, { filter: "playerFitsMatchup" })
logFunnelExcluded("refresh-snapshot", "oddsSnapshot.bestProps", bestProps, oddsSnapshot.bestProps)
const flexPropsSource = dedupeByLegSignature([
  ...(Array.isArray(matchupValidProps) ? matchupValidProps : []),
  ...(Array.isArray(oddsSnapshot.playableProps) ? oddsSnapshot.playableProps : []),
  ...(Array.isArray(oddsSnapshot.strongProps) ? oddsSnapshot.strongProps : []),
  ...(Array.isArray(oddsSnapshot.bestProps) ? oddsSnapshot.bestProps : [])
])
oddsSnapshot.flexProps = []
oddsSnapshot.parlays = null
oddsSnapshot.dualParlays = null
console.log("[REFRESH-CORE-ONLY]", {
  raw: oddsSnapshot.props.length,
  best: oddsSnapshot.bestProps.length
})
const playableFilterCounts = buildSequentialFilterDropCounts(scoredProps, [
  { key: "playableHighMinutesRisk", predicate: (row) => getMinutesRisk(row) !== "high" },
  { key: "playableHighInjuryRisk", predicate: (row) => getInjuryRisk(row) !== "high" },
  { key: "playableSubfloorHitRate", predicate: (row) => parseHitRate(row.hitRate) >= 0.5 },
  { key: "playableThinEdgeAndScore", predicate: (row) => !(getTierEdge(row) < -0.75 && getTierScore(row) < 34) },
  { key: "playableMissedPromotionGate", predicate: qualifiesPlayableTier }
])
const bestFilterCounts = buildSequentialFilterDropCounts(scoredProps, [
  { key: "bestHighMinutesRisk", predicate: (row) => getMinutesRisk(row) !== "high" },
  { key: "bestHighInjuryRisk", predicate: (row) => getInjuryRisk(row) !== "high" },
  { key: "bestSubfloorHitRate", predicate: (row) => parseHitRate(row.hitRate) >= 0.48 },
  { key: "bestThinEdgeAndScore", predicate: (row) => !(getTierEdge(row) < -0.75 && getTierScore(row) < 32) },
  { key: "bestMissedPromotionGate", predicate: qualifiesBestPropsSource }
])
logTierAssignmentDebug(
  "refresh-snapshot",
  scoredProps,
  {
    eliteRows: oddsSnapshot.eliteProps,
    strongRows: oddsSnapshot.strongProps,
    playableRows: oddsSnapshot.playableProps,
    bestSourceRows: bestPropsSource,
    preCapBestRows: bestProps,
    bestRows: oddsSnapshot.bestProps,
    flexRows: oddsSnapshot.flexProps
  },
  {
    ...playableFilterCounts.droppedByFilter,
    ...bestFilterCounts.droppedByFilter,
    bestPoolSelectionDrop: Math.max(0, bestPropsSource.length - bestProps.length),
    bestPoolTotalCapDrop: bestPropsCapResult.diagnostics.dropCounts.totalCap,
    bestPoolPerBookBalancingDrop: bestPropsCapResult.diagnostics.dropCounts.perBookBalancing,
    bestPoolPerPlayerCapDrop: bestPropsCapResult.diagnostics.dropCounts.perPlayerCap,
    bestPoolPerMatchupCapDrop: bestPropsCapResult.diagnostics.dropCounts.perMatchupCap,
    bestPoolPerStatCapDrop: bestPropsCapResult.diagnostics.dropCounts.perStatCap,
    bestPostMatchupFilterDrop: Math.max(0, bestProps.length - oddsSnapshot.bestProps.length),
    flexPoolCount: oddsSnapshot.flexProps.length
  }
)
try {
  fs.writeFileSync(
    path.join(__dirname, "snapshot.json"),
    JSON.stringify({
      data: oddsSnapshot,
      savedAt: Date.now()
    })
  )
  console.log("[SNAPSHOT-CACHE] saved snapshot to disk")
} catch (e) {
  console.log("[SNAPSHOT-CACHE] failed to save snapshot", e.message)
}
console.log("[TOP-PROP-SAMPLE] bestProps count:", (oddsSnapshot.bestProps || []).length)
logTopPropSample("refresh-snapshot bestProps", oddsSnapshot.bestProps)
  debugPipelineStages.afterBestProps = summarizePropPipelineRows(oddsSnapshot.bestProps)
logPropPipelineStep("refresh-snapshot", "after-bestProps-assignment", oddsSnapshot.bestProps)
logFunnelDropSummary("refresh-snapshot", debugPipelineStages)
console.log("[BEST-PROPS-DEBUG] total bestProps:", oddsSnapshot.bestProps.length)
console.log("[FLEX-PROPS-DEBUG] total flexProps:", (oddsSnapshot.flexProps || []).length)
console.log(
  "[BEST-PROPS-DEBUG] bestProps by propType:",
  oddsSnapshot.bestProps.reduce((acc, row) => {
    const key = String(row?.propType || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
)
console.log(
  "[BEST-PROPS-DEBUG] bestProps by book:",
  oddsSnapshot.bestProps.reduce((acc, row) => {
    const key = String(row?.book || "Unknown")
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
)
lastSnapshotRefreshAt = Date.now()

    const refreshMeta = buildSnapshotMeta({ source: "refresh-live" })

	    console.log("[SNAPSHOT-REFRESH-SUCCESS]", {
	      updatedAt: oddsSnapshot?.updatedAt || null,
	      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
	      props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
	      bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0,
	      playableProps: Array.isArray(oddsSnapshot?.playableProps) ? oddsSnapshot.playableProps.length : 0,
	      strongProps: Array.isArray(oddsSnapshot?.strongProps) ? oddsSnapshot.strongProps.length : 0,
	      eliteProps: Array.isArray(oddsSnapshot?.eliteProps) ? oddsSnapshot.eliteProps.length : 0
	    })
	    const marketCoverageFocusDebug = aggregateMarketCoverageFocusDebug(eventIngestDebug)
	    lastMarketCoverageFocusDebug = marketCoverageFocusDebug

	    return res.json({
	      ok: true,
	      message: "Snapshot refreshed successfully",
	      snapshotMeta: refreshMeta,
        snapshotGeneratedAt: refreshMeta?.snapshotGeneratedAt || null,
        snapshotSlateDateLocal: refreshMeta?.snapshotSlateDateLocal || null,
	      marketCoverageFocusDebug,
	      snapshotSlateDateKey: oddsSnapshot.snapshotSlateDateKey || null,
	      snapshotSlateGameCount: oddsSnapshot.snapshotSlateGameCount || 0,
        slateStateValidator: oddsSnapshot?.slateStateValidator || null,
        lineHistorySummary: oddsSnapshot?.lineHistorySummary || null,
	      counts: {
        rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : 0,
        props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : 0,
        bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : 0,
        playableProps: Array.isArray(oddsSnapshot?.playableProps) ? oddsSnapshot.playableProps.length : 0,
        strongProps: Array.isArray(oddsSnapshot?.strongProps) ? oddsSnapshot.strongProps.length : 0,
        eliteProps: Array.isArray(oddsSnapshot?.eliteProps) ? oddsSnapshot.eliteProps.length : 0
      }
    })
  } catch (error) {
    const readableError =
      error?.stack ||
      error?.message ||
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      (typeof error?.response?.data === "string" ? error.response.data : "") ||
      (typeof error === "string" ? error : "") ||
      JSON.stringify(error, Object.getOwnPropertyNames(error || {}))

    console.error("[SNAPSHOT-REFRESH-ERROR]", {
      message: error?.message || null,
      stack: error?.stack || null,
      name: error?.name || null,
      code: error?.code || null,
      responseStatus: error?.response?.status || null,
      responseData: error?.response?.data || null,
      readableError
    })

    res.status(500).send(`Snapshot refresh failed (${readableError})`)
  }
