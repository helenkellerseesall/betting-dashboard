"use strict"

/**
 * MLB-only HTTP handlers: snapshot + best-available branches that previously lived inline in server.js.
 * No NBA oddsSnapshot reads/writes here — only mlbSnapshot and MLB builders.
 */

function dedupeMlbBoardRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const out = []
  for (const row of safeRows) {
    const key = [
      String(row?.eventId || row?.matchup || ""),
      String(row?.player || ""),
      String(row?.propType || ""),
      String(row?.side || ""),
      String(row?.line ?? ""),
      String(row?.odds ?? ""),
      String(row?.book || ""),
      String(row?.marketKey || ""),
      String(row?.propVariant || "base"),
    ].join("|")
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * GET /api/best-available?sport=baseball_mlb
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {object} deps
 */
async function handleMlbBestAvailableGet(req, res, deps) {
  const {
    bestAvailableSportKey,
    lastSnapshotSource,
    snapshotLoadedFromDisk,
    oddsSnapshot,
    getMlbSnapshot,
    setMlbSnapshot,
    ODDS_API_KEY,
    buildMlbBootstrapSnapshot,
    saveMlbReplaySnapshotToDisk,
    buildLiveDualBestAvailablePayload,
    buildMlbParlays,
    buildSnapshotMeta,
  } = deps

  console.log("[TOP-DOWN-BEST-AVAILABLE-ENTRY]", {
    sport: bestAvailableSportKey,
    snapshotSource: lastSnapshotSource || "unknown",
    snapshotLoadedFromDisk,
    nba: {
      updatedAt: oddsSnapshot?.updatedAt || null,
      events: Array.isArray(oddsSnapshot?.events) ? oddsSnapshot.events.length : -1,
      rawProps: Array.isArray(oddsSnapshot?.rawProps) ? oddsSnapshot.rawProps.length : -1,
      props: Array.isArray(oddsSnapshot?.props) ? oddsSnapshot.props.length : -1,
      bestProps: Array.isArray(oddsSnapshot?.bestProps) ? oddsSnapshot.bestProps.length : -1,
    },
    mlb: {
      updatedAt: getMlbSnapshot()?.updatedAt || null,
      events: Array.isArray(getMlbSnapshot()?.events) ? getMlbSnapshot().events.length : -1,
      rows: Array.isArray(getMlbSnapshot()?.rows) ? getMlbSnapshot().rows.length : -1,
    },
  })

  try {
    const mlbSnap = getMlbSnapshot()
    const currentMlbRowCount = Array.isArray(mlbSnap?.rows) ? mlbSnap.rows.length : 0
    if (currentMlbRowCount === 0) {
      if (ODDS_API_KEY) {
        const snapshot = await buildMlbBootstrapSnapshot({
          oddsApiKey: ODDS_API_KEY,
          now: Date.now(),
        })
        setMlbSnapshot({
          ...snapshot,
          diagnostics: {
            ...(snapshot?.diagnostics && typeof snapshot.diagnostics === "object" ? snapshot.diagnostics : {}),
            bootstrapPhase: "phase-1-live",
          },
        })
        await saveMlbReplaySnapshotToDisk(getMlbSnapshot())
      } else {
        console.log("[MLB SNAPSHOT EMPTY] Missing ODDS_API_KEY; cannot refresh MLB snapshot")
      }
    }
  } catch (e) {
    console.log("[MLB SNAPSHOT AUTO-REFRESH FAILED]", e?.message || e)
  }

  const bestAvailablePayload = buildLiveDualBestAvailablePayload({ sport: bestAvailableSportKey })
  if (!bestAvailablePayload) {
    const snap = getMlbSnapshot()
    return res.status(503).json({
      ok: false,
      error: "bestAvailable MLB not ready",
      sport: bestAvailableSportKey,
      snapshotMeta: {
        ...buildSnapshotMeta(),
        sportKey: bestAvailableSportKey,
        mlb: {
          updatedAt: snap?.updatedAt || null,
          rowCount: Array.isArray(snap?.rows) ? snap.rows.length : 0,
        },
      },
      slateStateValidator: null,
      lineHistorySummary: null,
    })
  }

  const parlays = buildMlbParlays(Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best : [])
  console.log("[MLB PARLAYS]", {
    safe: Array.isArray(parlays?.safe) ? parlays.safe.length : 0,
    mixed: Array.isArray(parlays?.mixed) ? parlays.mixed.length : 0,
    lotto: Array.isArray(parlays?.lotto) ? parlays.lotto.length : 0,
  })

  const mlbSnap = getMlbSnapshot()
  const mlbBoardSourceRows =
    Array.isArray(bestAvailablePayload?.finalPlayableRows) && bestAvailablePayload.finalPlayableRows.length > 0
      ? bestAvailablePayload.finalPlayableRows
      : Array.isArray(bestAvailablePayload?.best) && bestAvailablePayload.best.length > 0
        ? bestAvailablePayload.best
        : Array.isArray(mlbSnap?.rows)
          ? mlbSnap.rows
          : []

  const MLB_CORE_PROP_TYPES = new Set(["Hits", "Home Runs", "Total Bases", "RBIs"])
  const isMlbBoardEligible = (row) =>
    Boolean(
      row &&
        String(row?.player || "").trim() &&
        String(row?.propType || "").trim() &&
        Number.isFinite(Number(row?.odds)),
    )

  const boardBase = dedupeMlbBoardRows(mlbBoardSourceRows.filter(isMlbBoardEligible))

  const coreStandardProps = boardBase.filter((row) => {
    const propType = String(row?.propType || "").trim()
    const family = String(row?.marketFamily || "").toLowerCase()
    if (family === "special") return false
    return MLB_CORE_PROP_TYPES.has(propType)
  })

  const ladderProps = boardBase.filter((row) => {
    const family = String(row?.marketFamily || "").toLowerCase()
    const variant = String(row?.propVariant || "base").toLowerCase()
    const marketKey = String(row?.marketKey || "").toLowerCase()
    if (family === "special") return false
    if (family === "ladder") return true
    if (variant.startsWith("alt-")) return true
    if (marketKey.includes("alternate")) return true
    return false
  })

  const specialPropsBoard = boardBase.filter((row) => String(row?.marketFamily || "").toLowerCase() === "special")

  const boardCounts = {
    coreStandardProps: coreStandardProps.length,
    ladderProps: ladderProps.length,
    specialProps: specialPropsBoard.length,
  }

  console.log("[MLB BOARD SOURCE]", {
    sourceRows: Array.isArray(mlbBoardSourceRows) ? mlbBoardSourceRows.length : 0,
    boardBase: boardBase.length,
    counts: boardCounts,
  })

  console.log("[MLB BEST TRACE] preResponse", {
    payloadBest: Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best.length : -1,
    payloadFinalPlayableRows: Array.isArray(bestAvailablePayload?.finalPlayableRows)
      ? bestAvailablePayload.finalPlayableRows.length
      : -1,
  })
  console.log("[MLB RESPONSE CHECK]", {
    payloadBest: Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best.length : 0,
  })

  return res.json({
    sport: bestAvailableSportKey,
    bestAvailable: {
      ...bestAvailablePayload,
      slateMode: "mlb",
    },
    parlays,
    ladderPool: [],
    routePlayableSeed: [],
    finalPlayableRows: Array.isArray(bestAvailablePayload?.finalPlayableRows)
      ? bestAvailablePayload.finalPlayableRows
      : Array.isArray(bestAvailablePayload?.best)
        ? bestAvailablePayload.best
        : [],
    standardCandidates: [],
    ladderCandidates: [],
    coreStandardProps,
    ladderProps,
    specialProps: specialPropsBoard,
    boardCounts,
    snapshotMeta: {
      ...buildSnapshotMeta(),
      sportKey: bestAvailableSportKey,
      mlb: {
        updatedAt: mlbSnap?.updatedAt || null,
        snapshotSlateDateKey: mlbSnap?.snapshotSlateDateKey || null,
        rowCount: Array.isArray(mlbSnap?.rows) ? mlbSnap.rows.length : 0,
        events: Array.isArray(mlbSnap?.events) ? mlbSnap.events.length : 0,
      },
    },
    slateStateValidator: null,
    lineHistorySummary: null,
  })
}

/**
 * GET /refresh-snapshot?sport=baseball_mlb
 */
async function handleMlbRefreshSnapshotGet(req, res, deps) {
  const {
    isMlbOddsReplayRequest,
    loadMlbReplaySnapshotFromDisk,
    hydrateMlbProbabilityLayer,
    ODDS_API_KEY,
    buildMlbBootstrapSnapshot,
    saveMlbReplaySnapshotToDisk,
    getMlbSnapshot,
    setMlbSnapshot,
  } = deps

  try {
    const replayModeRequested = isMlbOddsReplayRequest(req)
    if (replayModeRequested) {
      const replaySnapshot = await loadMlbReplaySnapshotFromDisk()
      if (!replaySnapshot) {
        return res.status(503).json({
          ok: false,
          sport: "baseball_mlb",
          error: "Replay mode requested but MLB snapshot replay file is missing or invalid",
          replay: true,
        })
      }
      setMlbSnapshot({
        ...replaySnapshot,
        rows: hydrateMlbProbabilityLayer(replaySnapshot?.rows),
      })
      const mlbRows = Array.isArray(getMlbSnapshot()?.rows) ? getMlbSnapshot().rows : []
      return res.status(200).json({
        ok: true,
        sport: "baseball_mlb",
        mlbSnapshot: {
          rowCount: mlbRows.length,
        },
      })
    }

    if (!ODDS_API_KEY) {
      return res.status(500).json({ ok: false, sport: "baseball_mlb", error: "Missing ODDS_API_KEY in .env" })
    }

    const snapshot = await buildMlbBootstrapSnapshot({
      oddsApiKey: ODDS_API_KEY,
      now: Date.now(),
    })

    setMlbSnapshot({
      ...snapshot,
      diagnostics: {
        ...(snapshot?.diagnostics && typeof snapshot.diagnostics === "object" ? snapshot.diagnostics : {}),
        bootstrapPhase: "phase-1-live",
      },
    })

    await saveMlbReplaySnapshotToDisk(getMlbSnapshot())

    const mlbRows = Array.isArray(getMlbSnapshot()?.rows) ? getMlbSnapshot().rows : []
    return res.status(200).json({
      ok: true,
      sport: "baseball_mlb",
      mlbSnapshot: {
        rowCount: mlbRows.length,
      },
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      sport: "baseball_mlb",
      error: error?.message || "MLB refresh-snapshot failed",
      details: error.response?.data || null,
    })
  }
}

module.exports = {
  handleMlbBestAvailableGet,
  handleMlbRefreshSnapshotGet,
}
