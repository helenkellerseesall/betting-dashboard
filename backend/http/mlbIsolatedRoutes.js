"use strict"

/**
 * MLB-only HTTP handlers: snapshot + best-available branches that previously lived inline in server.js.
 * No NBA oddsSnapshot reads/writes here — only mlbSnapshot and MLB builders.
 */

const { buildMlbAutoTickets } = require("../pipeline/mlb/buildMlbAutoTickets")
const { buildMlbHrPredictionCandidates } = require("../pipeline/mlb/buildMlbHrPredictionCandidates")
const { buildMlbHrStacks } = require("../pipeline/mlb/buildMlbHrStacks")
const buildMlbHrSlips = require("../pipeline/mlb/buildMlbHrSlips")
const trackMlbHrSlips = require("../pipeline/mlb/trackMlbHrSlips")
const gradeMlbHrSlips = require("../pipeline/mlb/gradeMlbHrSlips")

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
 * Top-level snapshotMeta fields (events, rowCount, ageMinutes) for MLB must come from
 * the MLB snapshot only — not from NBA oddsSnapshot inside buildSnapshotMeta().
 */
function buildMlbSnapshotMetaExtras(mlbSnap) {
  const rows = Array.isArray(mlbSnap?.rows) ? mlbSnap.rows : []
  const eventsArr = Array.isArray(mlbSnap?.events) ? mlbSnap.events : []

  const eventIds = new Set()
  for (const e of eventsArr) {
    const id = e?.id ?? e?.eventId ?? e?.event_id ?? e?.game_id ?? e?.gameId
    if (id != null && String(id).trim()) eventIds.add(String(id).trim())
  }
  if (eventIds.size === 0) {
    for (const r of rows) {
      const id = r?.eventId ?? r?.event_id ?? r?.gameId ?? r?.game_id
      if (id != null && String(id).trim()) eventIds.add(String(id).trim())
    }
  }

  const rowCount = rows.length
  const events = eventIds.size > 0 ? eventIds.size : eventsArr.length

  const updatedAt =
    mlbSnap?.updatedAt != null
      ? mlbSnap.updatedAt
      : mlbSnap?.snapshotGeneratedAt != null
        ? mlbSnap.snapshotGeneratedAt
        : null
  const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : NaN
  const hasSnapshot = rowCount > 0 || eventsArr.length > 0
  let ageMinutes = null
  if (Number.isFinite(updatedAtMs)) {
    ageMinutes = Math.max(0, Math.round((Date.now() - updatedAtMs) / 60000))
  } else if (hasSnapshot) {
    ageMinutes = 0
  }

  return { events, rowCount, ageMinutes }
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
    hydrateMlbProbabilityLayer,
    saveMlbReplaySnapshotToDisk,
    buildLiveDualBestAvailablePayload,
    buildMlbParlays,
    buildSnapshotMeta,
    recordMlbBestProps,
    evaluateMlbPerformance,
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
          rows: typeof hydrateMlbProbabilityLayer === "function"
            ? hydrateMlbProbabilityLayer(snapshot?.rows)
            : snapshot?.rows,
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
    const mlbExtra = buildMlbSnapshotMetaExtras(snap)
    const mlbTime = snap?.updatedAt ?? snap?.snapshotGeneratedAt ?? null
    return res.status(503).json({
      ok: false,
      error: "bestAvailable MLB not ready",
      sport: bestAvailableSportKey,
      snapshotMeta: {
        ...buildSnapshotMeta(),
        ...(mlbTime ? { updatedAt: mlbTime } : {}),
        ...mlbExtra,
        sportKey: bestAvailableSportKey,
        mlb: {
          updatedAt: snap?.updatedAt || null,
          snapshotSlateDateKey: snap?.snapshotSlateDateKey || null,
          rowCount: mlbExtra.rowCount,
          events: mlbExtra.events,
        },
      },
      slateStateValidator: null,
      lineHistorySummary: null,
    })
  }

  // Phase 4 tracking (MLB only): must execute before the response is returned.
  let perf = null
  try {
    const bestRows = Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best : []
    const tracking = typeof recordMlbBestProps === "function" ? recordMlbBestProps(bestRows) : null
    console.log("[MLB TRACK WRITE]", {
      count: bestRows.length,
      path: tracking?.path || null,
      ok: tracking?.ok ?? null,
      added: tracking?.added ?? null,
      totalMlbBest: tracking?.totalMlbBest ?? null,
    })
    perf = typeof evaluateMlbPerformance === "function" ? evaluateMlbPerformance() : null
    console.log("[MLB TRACK READ]", { file: perf?.file || null, count: perf?.totalBets ?? null })
  } catch (e) {
    console.log("[MLB TRACK ERROR]", e?.message || e)
  }

  const parlays =
    bestAvailablePayload?.parlays && typeof bestAvailablePayload.parlays === "object"
      ? bestAvailablePayload.parlays
      : { core: [], fun: [], lotto: [], topPlays: [] }

  const mlbSnap = getMlbSnapshot()
  const mlbSnapshotMetaExtras = buildMlbSnapshotMetaExtras(mlbSnap)
  const mlbSnapshotTime = mlbSnap?.updatedAt ?? mlbSnap?.snapshotGeneratedAt ?? null
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

  const topPlays =
    Array.isArray(bestAvailablePayload?.topPlays) ? bestAvailablePayload.topPlays :
    Array.isArray(parlays?.topPlays) ? parlays.topPlays :
    []

  const liveTickets =
    bestAvailablePayload?.liveTickets && typeof bestAvailablePayload.liveTickets === "object"
      ? bestAvailablePayload.liveTickets
      : (parlays?.liveTickets && typeof parlays.liveTickets === "object")
        ? parlays.liveTickets
        : { safe: [], leverage: [], value: [], spike: [] }

  const ceilingPlays =
    Array.isArray(bestAvailablePayload?.ceilingPlays) ? bestAvailablePayload.ceilingPlays :
    Array.isArray(parlays?.ceilingPlays) ? parlays.ceilingPlays :
    []

  const mlbSnapshot = getMlbSnapshot()
  const finalPlayableRows = Array.isArray(bestAvailablePayload?.finalPlayableRows) ? bestAvailablePayload.finalPlayableRows : null
  const payloadBest = Array.isArray(bestAvailablePayload?.best) ? bestAvailablePayload.best : null

  console.log("[MLB OUTPUT]", {
    raw: Array.isArray(mlbSnapshot?.rows) ? mlbSnapshot.rows.length : 0,
    best: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : (Array.isArray(payloadBest) ? payloadBest.length : 0)
  })

  console.log("[MLB STAGE]", {
    raw: Array.isArray(mlbSnap?.rows) ? mlbSnap.rows.length : 0,
    finalPlayableRows: Array.isArray(finalPlayableRows) ? finalPlayableRows.length : 0,
    payloadBest: Array.isArray(payloadBest) ? payloadBest.length : 0,
  })

  mlbSnapshot.props = finalPlayableRows || payloadBest || []
  mlbSnapshot.updatedAt = new Date().toISOString()
  console.log("[MLB FINAL ASSIGNMENT]", mlbSnapshot.props?.length)

  console.log("[MLB DEBUG]", {
    props: mlbSnapshot?.props?.length,
    sameRef: mlbSnapshot === getMlbSnapshot()
  })

  console.log("[MLB RETURN DEBUG]", {
    hasSnapshot: !!mlbSnapshot,
    props: mlbSnapshot?.props?.length
  })

  const coreProps = Array.isArray(mlbSnapshot?.props) ? mlbSnapshot.props : []
  const upsideProps = Array.isArray(mlbSnap?.rows) ? mlbSnap.rows : []

  let autoTickets = { ok: false, counts: { bestProps: 0, allProps: 0 }, buckets: { hits: 0, tb: 0, rbi: 0, hr: 0, alt: 0 }, tickets: [] }
  try {
    autoTickets = buildMlbAutoTickets({
      bestProps: finalPlayableRows || payloadBest || [],
      allProps: Array.isArray(mlbSnapshot?.rows) ? mlbSnapshot.rows : []
    })
  } catch (e) {
    console.log("[MLB AUTO TICKETS ERROR]", e?.message || e)
  }

  // HR prediction debug (safe execution)
  console.log("[HR DEBUG] snapshot rows:", mlbSnapshot?.rows?.length)

  let hrPredictionToday = { topHrCandidatesToday: [], mostLikelyHr: [] }
  try {
    if (mlbSnapshot?.rows?.length > 0) {
      hrPredictionToday = buildMlbHrPredictionCandidates({
        rows: mlbSnapshot.rows
      })
    } else {
      console.log("[HR DEBUG] No rows passed to HR builder")
    }
  } catch (err) {
    console.log("[HR ERROR]", err?.message || err)
  }

  console.log("[HR DEBUG] candidates:", hrPredictionToday.topHrCandidatesToday?.length)
  console.log("[HR DEBUG] mostLikely:", hrPredictionToday.mostLikelyHr?.length)

  let hrStacks = { sameGameStacks: [], crossGameLotto: [], hybridStacks: [] }
  try {
    if (hrPredictionToday?.topHrCandidatesToday?.length > 0) {
      hrStacks = buildMlbHrStacks({
        candidates: hrPredictionToday.topHrCandidatesToday,
        topHrCandidatesToday: hrPredictionToday.topHrCandidatesToday,
      })
    }
  } catch (err) {
    console.log("[HR STACK ERROR]", err?.message || err)
  }

  console.log("[HR STACK DEBUG ROUTE]", {
    sameGame: hrStacks.sameGameStacks?.length,
    crossGame: hrStacks.crossGameLotto?.length,
    hybrid: hrStacks.hybridStacks?.length,
  })

  hrPredictionToday.stacks = {
    sameGame: hrStacks.sameGameStacks || [],
    crossGame: hrStacks.crossGameLotto || [],
    hybrid: hrStacks.hybridStacks || [],
  }

  const hrSlips = buildMlbHrSlips({ hrPredictionToday })
  const today = new Date().toISOString().slice(0, 10)
  console.log('[TRACK VERIFY] hrSlips:', hrSlips)
  trackMlbHrSlips({
    hrSlips,
    date: today
  })

  console.log("[MLB RESPONSE KEYS]", Object.keys({
    snapshot: mlbSnapshot,
    bestProps: finalPlayableRows || payloadBest || [],
    allProps: mlbSnapshot.rows || [],
    hrPredictionToday,
    hrSlips,
  }))

  return res.json({
    snapshot: mlbSnapshot,
    bestProps: finalPlayableRows || payloadBest || [],
    allProps: mlbSnapshot.rows || [],
    hrPredictionToday,
    hrSlips,
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

/**
 * TEMP: manual HR grading route handler (replace later).
 * GET /grade-hr-test
 */
function handleMlbGradeHrTestGet(req, res) {
  const testDate = "2026-04-24"

  // TEMP MANUAL DATA (replace later with real feed)
  const actualHrPlayers = [
    "Aaron Judge",
    "Shohei Ohtani",
    "Kyle Schwarber"
  ]

  gradeMlbHrSlips({
    date: testDate,
    actualHrPlayers
  })

  return res.json({ success: true })
}

module.exports = {
  handleMlbBestAvailableGet,
  handleMlbRefreshSnapshotGet,
  handleMlbGradeHrTestGet,
}
