"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA Performance Tracking + Lightweight Model Feedback.
 *
 *   - ALWAYS records bets/slips to disk (fire-and-forget, never blocks pipeline)
 *   - Reads only the last N days of tracking files to build a summary
 *   - Produces non-binding `confidenceAdjustments` (small multipliers 0.90–1.10)
 *
 * The bet/slip files are written to:
 *
 *   backend/runtime/tracking/nba_tracked_bets_YYYY-MM-DD.json
 *   backend/runtime/tracking/nba_tracked_slips_YYYY-MM-DD.json
 *   backend/runtime/tracking/nba_tracking_summary_YYYY-MM-DD.json
 *
 * Existing legacy `tracked_props_*` and `tracking_summary_*` filenames (used by
 * the slate snapshot system) are NOT touched, by design.
 *
 * Performance constraints:
 *   - Disk writes are async + non-awaited (pipeline never blocks)
 *   - Summary scan reads at most `windowDays` files (default 14)
 *   - Summary compute is O(totalBets in window)
 *   - Pruning runs async after summary
 *
 * Tracked fields (intentionally minimal — no projection objects, no raw rows):
 *   bet:  { id, date, player, eventId, prop, statFamily, side, line,
 *           oddsAmerican, sportsbook, modelProb, edge, confidence, tier,
 *           result }
 *   slip: { id, date, type, legs[{player,statFamily,side,line,oddsAmerican,result}],
 *           combinedAmericanOdds, combinedDecimalOdds, combinedModelProb, edge,
 *           result }
 */

const fs = require("fs")
const path = require("path")

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

const BETS_PREFIX = "nba_tracked_bets_"
const SLIPS_PREFIX = "nba_tracked_slips_"
const SUMMARY_PREFIX = "nba_tracking_summary_"

const DEFAULT_WINDOW_DAYS = 14
const DEFAULT_PRUNE_KEEP_DAYS = 14

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function fileFor(prefix, date) {
  return path.join(TRACKING_DIR, `${prefix}${date}.json`)
}

function ensureDirSync() {
  try {
    fs.mkdirSync(TRACKING_DIR, { recursive: true })
  } catch (_) {
    // Best effort.
  }
}

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback
    const s = fs.readFileSync(p, "utf8")
    if (!s) return fallback
    return JSON.parse(s)
  } catch (_) {
    return fallback
  }
}

/**
 * Atomic-ish write: write to .tmp then rename. Async, never throws into caller.
 */
function writeJsonAsync(p, obj) {
  try {
    ensureDirSync()
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
    const data = JSON.stringify(obj, null, 0)
    fs.writeFile(tmp, data, "utf8", (err) => {
      if (err) return // swallow
      fs.rename(tmp, p, () => {
        // swallow rename error
      })
    })
  } catch (_) {
    // never throw from tracking
  }
}

/**
 * Synchronous, atomic-ish write. Used ONLY for the small daily bets/slips
 * files that the immediate-next summary read depends on. Files are <100KB,
 * so the cost is sub-millisecond and does not violate the "never slow the
 * pipeline" rule.
 *
 * Wrapped in try/catch — any disk error becomes a no-op so tracking failures
 * cannot break the live pipeline.
 */
function writeJsonSync(p, obj) {
  try {
    ensureDirSync()
    const data = JSON.stringify(obj, null, 0)
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, data, "utf8")
    fs.renameSync(tmp, p)
  } catch (_) {
    // never throw from tracking
  }
}

/**
 * Stable id for a bet/leg so result ingestion can match without ordering.
 * Includes date so the same prop on different days is distinct.
 */
function idForBet(date, bet) {
  return [
    date,
    String(bet?.player || "").toLowerCase(),
    String(bet?.eventId || "").toLowerCase(),
    String(bet?.statFamily || "").toLowerCase(),
    String(bet?.side || "").toLowerCase(),
    Number(bet?.line),
    Number(bet?.oddsAmerican),
    String(bet?.sportsbook || "").toLowerCase(),
  ].join("|")
}

function idForSlipLeg(date, slipId, leg) {
  return [
    slipId,
    String(leg?.player || "").toLowerCase(),
    String(leg?.statFamily || "").toLowerCase(),
    String(leg?.side || "").toLowerCase(),
    Number(leg?.line),
  ].join("|")
}

function idForSlip(date, slip) {
  // Stable: type + sorted legs (player|stat|side|line)
  const legs = Array.isArray(slip?.legs) ? slip.legs : []
  const sig = legs
    .map((l) =>
      [
        String(l?.player || "").toLowerCase(),
        String(l?.statFamily || "").toLowerCase(),
        String(l?.side || "").toLowerCase(),
        Number(l?.line),
      ].join("|")
    )
    .sort()
    .join("__")
  return [date, String(slip?.type || ""), sig].join("##")
}

/**
 * Convert a bestBetsBoard play into the lean tracked-bet record.
 * Strips projection / range / reasoning to keep the file small.
 */
function leanBet(play, date) {
  return {
    id: idForBet(date, play),
    date,
    player: play.player,
    eventId: play.eventId || null,
    matchup: play.matchup || null,
    prop: `${play.statFamily} ${play.side} ${play.line}`,
    statFamily: play.statFamily,
    side: play.side,
    line: play.line,
    oddsAmerican: play.oddsAmerican,
    sportsbook: play.sportsbook || null,
    modelProb: play.modelProb,
    impliedProb: play.impliedProb,
    edge: play.edge,
    confidence: play.confidence,
    tier: play.tier,
    result: "pending",
    settledAt: null,
  }
}

function leanSlip(slip, date) {
  const id = idForSlip(date, slip)
  const legs = (slip.legs || []).map((l) => ({
    id: idForSlipLeg(date, id, l),
    player: l.player,
    statFamily: l.statFamily,
    side: l.side,
    line: l.line,
    oddsAmerican: l.oddsAmerican,
    result: "pending",
  }))
  return {
    id,
    date,
    type: slip.type,
    legCount: slip.legCount,
    legs,
    combinedDecimalOdds: slip.combinedDecimalOdds,
    combinedAmericanOdds: slip.combinedAmericanOdds,
    combinedModelProb: slip.combinedModelProb,
    combinedImpliedProb: slip.combinedImpliedProb,
    edge: slip.edge,
    ev: slip.ev,
    result: "pending",
    settledAt: null,
  }
}

/**
 * Public — fire-and-forget save of today's bets + slips. Never blocks.
 *
 * If a file already exists for today, merges by `id` keeping the existing
 * `result` for already-settled rows (so re-running the pipeline same day
 * doesn't reset graded results).
 */
function persistTrackedToday({ bestBetsBoard, date = todayKey() } = {}) {
  if (!bestBetsBoard) return
  const board = bestBetsBoard
  const allPlays = Array.isArray(board.allPlays) ? board.allPlays : []

  // -------- Bets --------
  const newBets = allPlays.map((p) => leanBet(p, date))
  const betsPath = fileFor(BETS_PREFIX, date)
  const existingBets = Array.isArray(readJsonSafe(betsPath, [])) ? readJsonSafe(betsPath, []) : []
  const mergedBetsById = new Map()
  for (const b of existingBets) mergedBetsById.set(b.id, b)
  for (const b of newBets) {
    const prev = mergedBetsById.get(b.id)
    if (prev && prev.result && prev.result !== "pending") {
      // Preserve graded result.
      mergedBetsById.set(b.id, { ...b, result: prev.result, settledAt: prev.settledAt })
    } else {
      mergedBetsById.set(b.id, b)
    }
  }
  writeJsonSync(betsPath, Array.from(mergedBetsById.values()))

  // -------- Slips --------
  const slips = board.slips || {}
  const slipBucket = []
  for (const t of ["safe", "balanced", "aggressive", "lotto"]) {
    for (const s of Array.isArray(slips[t]) ? slips[t] : []) {
      slipBucket.push({ ...s, type: s.type || t.toUpperCase() })
    }
  }
  const newSlips = slipBucket.map((s) => leanSlip(s, date))
  const slipsPath = fileFor(SLIPS_PREFIX, date)
  const existingSlips = Array.isArray(readJsonSafe(slipsPath, []))
    ? readJsonSafe(slipsPath, [])
    : []
  const mergedSlipsById = new Map()
  for (const s of existingSlips) mergedSlipsById.set(s.id, s)
  for (const s of newSlips) {
    const prev = mergedSlipsById.get(s.id)
    if (prev && prev.result && prev.result !== "pending") {
      mergedSlipsById.set(s.id, { ...s, result: prev.result, settledAt: prev.settledAt, legs: prev.legs })
    } else {
      mergedSlipsById.set(s.id, s)
    }
  }
  writeJsonSync(slipsPath, Array.from(mergedSlipsById.values()))
}

/**
 * Apply a results map to today's tracked file. Used by the result-ingestion CLI.
 *
 * resultsByBetId: { [id]: "win" | "loss" | "void" | "push" }
 * resultsByLegId: { [legId]: "win" | "loss" | "void" | "push" }   (slips)
 *
 * Slip result derives automatically from legs:
 *   - any "loss" leg → slip "loss"
 *   - all "win" → slip "win"
 *   - else → "pending" (or "void" if any void w/ rest unsettled)
 *
 * Synchronous — this runs from a CLI/admin tool, NOT in the live pipeline.
 */
function applyResults({ date = todayKey(), bets = {}, legs = {} } = {}) {
  const now = new Date().toISOString()
  const betsPath = fileFor(BETS_PREFIX, date)
  const slipsPath = fileFor(SLIPS_PREFIX, date)

  const trackedBets = readJsonSafe(betsPath, [])
  if (Array.isArray(trackedBets)) {
    for (const b of trackedBets) {
      const r = bets[b.id]
      if (r && b.result !== r) {
        b.result = r
        b.settledAt = now
      }
    }
    writeJsonSync(betsPath, trackedBets)
  }

  const trackedSlips = readJsonSafe(slipsPath, [])
  if (Array.isArray(trackedSlips)) {
    for (const slip of trackedSlips) {
      let anyLoss = false
      let allWin = true
      let anyPending = false
      for (const leg of slip.legs || []) {
        const lr = legs[leg.id]
        if (lr && leg.result !== lr) {
          leg.result = lr
        }
        if (leg.result === "loss") anyLoss = true
        if (leg.result !== "win") allWin = false
        if (!leg.result || leg.result === "pending") anyPending = true
      }
      if (anyLoss) {
        slip.result = "loss"
        slip.settledAt = now
      } else if (allWin) {
        slip.result = "win"
        slip.settledAt = now
      } else if (anyPending) {
        slip.result = "pending"
      } else {
        slip.result = "void"
        slip.settledAt = now
      }
    }
    writeJsonSync(slipsPath, trackedSlips)
  }

  return {
    date,
    betsUpdated: trackedBets.length,
    slipsUpdated: trackedSlips.length,
  }
}

/**
 * List YYYY-MM-DD strings for the last `windowDays` days, today inclusive.
 */
function recentDateKeys(windowDays = DEFAULT_WINDOW_DAYS) {
  const out = []
  const today = new Date()
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * Compute hit-rate metrics from settled bets.
 *
 *   hitRate = wins / (wins + losses)         (push/void excluded)
 *   roi     = sum(returnPerUnitStaked) / settledCount
 *
 * For ROI we approximate per-unit return using American odds:
 *   win:  decimalOdds - 1
 *   loss: -1
 *   void/push: 0
 */
function americanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n > 0) return 1 + n / 100
  return 1 + 100 / Math.abs(n)
}

function computeHitRoi(records, oddsKey = "oddsAmerican") {
  let wins = 0
  let losses = 0
  let pushes = 0
  let voids = 0
  let pending = 0
  let returnSum = 0
  let staked = 0
  for (const r of records || []) {
    const res = String(r.result || "pending").toLowerCase()
    if (res === "win") {
      wins += 1
      const d = americanToDecimal(r[oddsKey])
      if (Number.isFinite(d)) returnSum += d - 1
      staked += 1
    } else if (res === "loss") {
      losses += 1
      returnSum -= 1
      staked += 1
    } else if (res === "push") {
      pushes += 1
    } else if (res === "void") {
      voids += 1
    } else {
      pending += 1
    }
  }
  const settled = wins + losses
  return {
    total: records.length,
    wins,
    losses,
    pushes,
    voids,
    pending,
    settled,
    hitRate: settled > 0 ? wins / settled : null,
    roi: staked > 0 ? returnSum / staked : null,
  }
}

/**
 * Compute confidence adjustment multiplier from observed vs expected.
 *
 * For a group with N settled bets:
 *   expectedHitRate = mean(modelProb of settled bets)
 *   observedHitRate = wins / settled
 *
 *   ratio = observed / expected
 *   multiplier = clamp(0.90, 1.10, 1 + (ratio - 1) * smoothing)
 *
 * `smoothing` shrinks the adjustment toward 1.0 when sample is small.
 */
function adjustmentFromGroup(records, settledStats) {
  if (!settledStats || settledStats.settled < 8) {
    return { multiplier: 1.0, reason: "insufficient sample (<8 settled)" }
  }
  const settled = records.filter((r) => {
    const v = String(r.result || "").toLowerCase()
    return v === "win" || v === "loss"
  })
  const expected =
    settled.reduce((a, r) => a + Number(r.modelProb || 0), 0) / Math.max(1, settled.length)
  const observed = settledStats.hitRate
  if (!Number.isFinite(observed) || !Number.isFinite(expected) || expected <= 0) {
    return { multiplier: 1.0, reason: "no valid expectation" }
  }
  const ratio = observed / expected
  // Smoothing scales with sample size; >=40 bets → full effect, <8 → ~0.
  const smoothing = Math.min(1, settledStats.settled / 40)
  const raw = 1 + (ratio - 1) * smoothing
  const multiplier = Math.max(0.9, Math.min(1.1, raw))
  return {
    multiplier: Math.round(multiplier * 1000) / 1000,
    expected: Math.round(expected * 10000) / 10000,
    observed: Math.round(observed * 10000) / 10000,
    sample: settledStats.settled,
    reason:
      ratio > 1.05
        ? "underconfident — model lower than reality, multiplier > 1"
        : ratio < 0.95
        ? "overconfident — model higher than reality, multiplier < 1"
        : "calibrated within ±5%",
  }
}

/**
 * Build the rolling summary across the last `windowDays` days.
 *
 * Output is intentionally compact:
 *   {
 *     window: { days, dates },
 *     bets:   { hit, roi, byStat: { points, threes, ... }, byTier: { ELITE, ... } },
 *     slips:  { hit, roi, byType: { SAFE, BALANCED, ... } },
 *     confidenceAdjustments: { byStat, byTier, byBoard },
 *   }
 */
function buildNbaTrackingSummary({ windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const generatedAt = new Date().toISOString()
  const dates = recentDateKeys(windowDays)
  const bets = []
  const slips = []
  for (const d of dates) {
    const b = readJsonSafe(fileFor(BETS_PREFIX, d), [])
    if (Array.isArray(b)) for (const r of b) bets.push(r)
    const s = readJsonSafe(fileFor(SLIPS_PREFIX, d), [])
    if (Array.isArray(s)) for (const r of s) slips.push(r)
  }

  // Overall.
  const betsAll = computeHitRoi(bets)

  // By stat family.
  const families = ["points", "rebounds", "assists", "threes", "pra"]
  const byStat = {}
  for (const f of families) {
    const subset = bets.filter((r) => String(r.statFamily || "").toLowerCase() === f)
    const stats = computeHitRoi(subset)
    byStat[f] = {
      ...stats,
      adjustment: adjustmentFromGroup(subset, stats),
    }
  }

  // By tier.
  const tiers = ["ELITE", "STRONG", "PLAYABLE", "LONGSHOT"]
  const byTier = {}
  for (const t of tiers) {
    const subset = bets.filter((r) => String(r.tier || "").toUpperCase() === t)
    const stats = computeHitRoi(subset)
    byTier[t] = {
      ...stats,
      adjustment: adjustmentFromGroup(subset, stats),
    }
  }

  // Slips.
  const slipsAll = computeHitRoi(slips, "combinedAmericanOdds")
  const slipTypes = ["SAFE", "BALANCED", "AGGRESSIVE", "LOTTO"]
  const byType = {}
  for (const t of slipTypes) {
    const subset = slips.filter((r) => String(r.type || "").toUpperCase() === t)
    byType[t] = computeHitRoi(subset, "combinedAmericanOdds")
  }

  // Build the consolidated `confidenceAdjustments` block.
  const confidenceAdjustments = {
    byStat: Object.fromEntries(Object.entries(byStat).map(([k, v]) => [k, v.adjustment])),
    byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, v.adjustment])),
  }

  // Persist today's summary file (fire-and-forget).
  const today = todayKey()
  const summaryPayload = {
    metadata: {
      date: today,
      generatedAt,
      windowDays,
      version: "nba-tracking-v1",
    },
    window: { days: windowDays, dates },
    bets: {
      ...betsAll,
      byStat,
      byTier,
    },
    slips: {
      ...slipsAll,
      byType,
    },
    confidenceAdjustments,
  }
  writeJsonAsync(fileFor(SUMMARY_PREFIX, today), summaryPayload)

  return summaryPayload
}

/**
 * Async, fire-and-forget pruning. Removes any nba_tracked_bets_, nba_tracked_slips_
 * or nba_tracking_summary_ file older than `keepDays`. Other files in the
 * directory (legacy systems) are left untouched.
 */
function pruneOldTrackingFilesAsync({ keepDays = DEFAULT_PRUNE_KEEP_DAYS } = {}) {
  setImmediate(() => {
    try {
      ensureDirSync()
      const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
      const files = fs.readdirSync(TRACKING_DIR)
      for (const f of files) {
        if (
          !f.startsWith(BETS_PREFIX) &&
          !f.startsWith(SLIPS_PREFIX) &&
          !f.startsWith(SUMMARY_PREFIX)
        ) {
          continue
        }
        // Filename ends with YYYY-MM-DD.json — parse the date.
        const m = f.match(/(\d{4}-\d{2}-\d{2})\.json$/)
        if (!m) continue
        const t = Date.parse(m[1])
        if (!Number.isFinite(t)) continue
        if (t < cutoff) {
          fs.unlink(path.join(TRACKING_DIR, f), () => {})
        }
      }
    } catch (_) {
      // never throw
    }
  })
}

module.exports = {
  persistTrackedToday,
  applyResults,
  buildNbaTrackingSummary,
  pruneOldTrackingFilesAsync,
  // Internals exposed for tests / scripts.
  _internals: {
    TRACKING_DIR,
    BETS_PREFIX,
    SLIPS_PREFIX,
    SUMMARY_PREFIX,
    fileFor,
    readJsonSafe,
    leanBet,
    leanSlip,
    idForBet,
    idForSlip,
    computeHitRoi,
    adjustmentFromGroup,
  },
}
