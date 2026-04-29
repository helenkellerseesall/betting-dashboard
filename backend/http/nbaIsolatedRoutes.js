"use strict"

/**
 * NBA HTTP handlers — no `new Function`, no eval, no compiled `nbaRefreshSnapshot.inlined.js`.
 * Snapshot refresh uses `pipeline/nba/fetchNbaOddsSnapshot` (Odds API v4, same pattern as MLB bootstrap).
 */

const path = require("path")

const { buildNbaOpportunityBoard } = require("../pipeline/nba/buildNbaOpportunityBoard")
const { buildNbaInsightBoard } = require("../pipeline/nba/buildNbaInsightBoard")
const {
  buildNbaBoardSlicesFromSnapshot,
  loadNbaSnapshotFromDisk,
} = require("../pipeline/nba/buildNbaBoardSlicesFromSnapshot")
const { fetchNbaOddsSnapshot, saveNbaSnapshotToDisk } = require("../pipeline/nba/fetchNbaOddsSnapshot")

const DEFAULT_BACKEND_ROOT = path.join(__dirname, "..")

function snapshotHasBody(snap) {
  if (!snap || typeof snap !== "object") return false
  const ev = Array.isArray(snap.events) ? snap.events.length : 0
  const rp = Array.isArray(snap.rawProps) ? snap.rawProps.length : 0
  const pr = Array.isArray(snap.props) ? snap.props.length : 0
  const bp = Array.isArray(snap.bestProps) ? snap.bestProps.length : 0
  return ev > 0 || rp > 0 || pr > 0 || bp > 0
}

function isNbaReplayQuery(req) {
  const r = String(req?.query?.replay || "")
    .toLowerCase()
    .trim()
  return r === "1" || r === "true"
}

/**
 * GET /api/best-available?sport=basketball_nba
 */
async function handleNbaBestAvailableGet(req, res, deps) {
  const { axios, oddsSnapshot, normalizeBestAvailableSportKey, refreshGuard, snapshotPath } = deps

  const bestAvailableSportKey = normalizeBestAvailableSportKey(String(req.query?.sport || "").trim())
  const resolvedSnapshotPath = snapshotPath || path.join(__dirname, "..", "snapshot.json")

  let snap = oddsSnapshot && typeof oddsSnapshot === "object" ? oddsSnapshot : null

  const snapshotUpdatedAtMs = snap?.updatedAt ? new Date(snap.updatedAt).getTime() : null
  const snapshotAgeMinutes = Number.isFinite(snapshotUpdatedAtMs)
    ? (Date.now() - snapshotUpdatedAtMs) / 60000
    : Infinity

  const snapshotEventsCount = Array.isArray(snap?.events) ? snap.events.length : 0
  const snapshotRawPropsCount = Array.isArray(snap?.rawProps) ? snap.rawProps.length : 0

  const refreshReasons = []
  if (snapshotEventsCount === 0) refreshReasons.push("events_zero")
  if (snapshotRawPropsCount === 0) refreshReasons.push("rawProps_zero")
  if (snapshotAgeMinutes > 8) refreshReasons.push("stale_over_8m")

  if (refreshReasons.length) {
    console.log("[NBA SNAPSHOT POLICY]", {
      action: "refresh",
      reasons: refreshReasons,
      ageMinutes: Number.isFinite(snapshotAgeMinutes) ? Math.round(snapshotAgeMinutes * 10) / 10 : null,
      events: snapshotEventsCount,
      rawProps: snapshotRawPropsCount,
    })

    try {
      const now = Date.now()
      if (refreshGuard.inProgress) {
        console.log("[REFRESH GUARD]", { skipped: true, reason: "in_progress" })
      } else if (now - refreshGuard.lastRefreshTime < 2 * 60 * 1000) {
        console.log("[REFRESH GUARD]", { skipped: true, reason: "cooldown" })
      } else {
        refreshGuard.inProgress = true
        refreshGuard.lastRefreshTime = now
        console.log("[REFRESH GUARD]", { skipped: false, reason: null })

        const port = Number(process.env.PORT || 4000)
        const sportParam = encodeURIComponent(String(bestAvailableSportKey || "basketball_nba"))
        await axios.get(`http://127.0.0.1:${port}/refresh-snapshot?force=1&sport=${sportParam}`, { timeout: 120000 })
      }
    } catch (e) {
      console.warn("[NBA SNAPSHOT POLICY] refresh failed", {
        message: e?.message || String(e),
        status: e?.response?.status || null,
      })
    } finally {
      refreshGuard.inProgress = false
    }

    snap = oddsSnapshot && typeof oddsSnapshot === "object" ? oddsSnapshot : null
  } else {
    console.log("[NBA SNAPSHOT POLICY]", {
      action: "use_snapshot",
      reasons: [],
      ageMinutes: Number.isFinite(snapshotAgeMinutes) ? Math.round(snapshotAgeMinutes * 10) / 10 : null,
      events: snapshotEventsCount,
      rawProps: snapshotRawPropsCount,
    })
  }

  if (!snapshotHasBody(snap)) {
    const disk = loadNbaSnapshotFromDisk(resolvedSnapshotPath)
    if (disk) snap = disk
  }

  const slices = buildNbaBoardSlicesFromSnapshot(snap && typeof snap === "object" ? snap : {})
  const nbaOpportunityBoard = buildNbaOpportunityBoard({
    ladderBoard: slices.ladderBoard,
    corePropsBoard: slices.corePropsBoard,
    completeUniverse: slices.completeUniverse,
  })
  const nbaInsightBoard = buildNbaInsightBoard({
    ladderBoard: slices.ladderBoard,
    corePropsBoard: slices.corePropsBoard,
    specialBoard: slices.specialBoard,
    firstBasketBoard: slices.firstBasketBoard,
    nbaOpportunityBoard,
  })

  return res.json({
    nbaOpportunityBoard,
    nbaInsightBoard,
  })
}

/**
 * Rebuild NBA `oddsSnapshot` via Odds API (no legacy compiled refresh).
 * MLB sidecar refresh runs in `server.js` before this handler is invoked.
 */
async function handleNbaRefreshSnapshotAfterMlbBranch(req, res, deps) {
  const { ODDS_API_KEY, replaceOddsSnapshot, backendRoot } = deps

  const root = backendRoot || DEFAULT_BACKEND_ROOT

  if (typeof replaceOddsSnapshot !== "function") {
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: "replaceOddsSnapshot callback missing (server wiring)",
    })
  }

  if (isNbaReplayQuery(req)) {
    const diskPath = path.join(root, "snapshot.json")
    const replaySnap = loadNbaSnapshotFromDisk(diskPath)
    if (!replaySnap || !snapshotHasBody(replaySnap)) {
      return res.status(503).json({
        ok: false,
        sport: "basketball_nba",
        error: "Replay requested but snapshot.json is missing or empty",
        replay: true,
      })
    }
    replaceOddsSnapshot(replaySnap)
    try {
      saveNbaSnapshotToDisk(root, replaySnap)
    } catch (e) {
      console.log("[NBA-SNAPSHOT] replay disk save skipped", e?.message || e)
    }
    return res.status(200).json({
      ok: true,
      sport: "basketball_nba",
      replay: true,
      updatedAt: replaySnap.updatedAt || null,
      events: Array.isArray(replaySnap.events) ? replaySnap.events.length : 0,
      rawProps: Array.isArray(replaySnap.rawProps) ? replaySnap.rawProps.length : 0,
      props: Array.isArray(replaySnap.props) ? replaySnap.props.length : 0,
    })
  }

  if (!ODDS_API_KEY) {
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: "Missing ODDS_API_KEY in .env",
    })
  }

  try {
    const snap = await fetchNbaOddsSnapshot({ oddsApiKey: ODDS_API_KEY })
    replaceOddsSnapshot(snap)
    try {
      saveNbaSnapshotToDisk(root, snap)
    } catch (e) {
      console.log("[NBA-SNAPSHOT] disk save failed", e?.message || e)
    }
    return res.status(200).json({
      ok: true,
      sport: "basketball_nba",
      updatedAt: snap.updatedAt,
      events: Array.isArray(snap.events) ? snap.events.length : 0,
      rawProps: Array.isArray(snap.rawProps) ? snap.rawProps.length : 0,
      props: Array.isArray(snap.props) ? snap.props.length : 0,
    })
  } catch (e) {
    console.log("[NBA-SNAPSHOT-FETCH-FAILED]", e?.message || e)
    return res.status(500).json({
      ok: false,
      sport: "basketball_nba",
      error: e?.message || String(e),
    })
  }
}

module.exports = {
  handleNbaBestAvailableGet,
  handleNbaRefreshSnapshotAfterMlbBranch,
}
