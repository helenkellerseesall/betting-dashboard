#!/usr/bin/env node
"use strict"

/**
 * captureClosingLines — periodic close-odds capture for CLV measurement.
 *
 * Created 2026-05-26 (Lane B). For every tracked NBA bet that:
 *   - Has openOdds stamped (Lane B persistTrackedToday change)
 *   - Has closeOdds NULL (not yet captured)
 *   - Has gameTime within next `CLOSE_WINDOW_MIN` minutes (or already started in last 5min)
 * this script fetches the current live odds for that exact prop signature
 * (player + statFamily + side + line + book) from the in-memory snapshot,
 * stamps closeOdds + closeObservedAt + computed CLV, and writes the file
 * back atomically.
 *
 * Run modes:
 *   node backend/scripts/captureClosingLines.js                 # one-shot
 *   node backend/scripts/captureClosingLines.js --watch         # every 5 min
 *
 * Or embed in server.js as setInterval — see captureClosingLinesLoop export.
 *
 * Design notes:
 *   - Reads tracked_bets via JSON file (not DB) — same source the FE reads.
 *     This is the canonical source of truth for in-flight picks.
 *   - Reads odds via /api/odds endpoint (returns the in-memory oddsSnapshot
 *     rawProps array). No new API calls — uses whatever the snapshot last
 *     refreshed.
 *   - Match logic: (player, statFamily, side, line, book) all must match.
 *     Books renaming between cycles would cause a miss — accept that gap
 *     (rare, and we record null closeOdds, which is honest).
 *   - Idempotent — running the script twice doesn't re-capture already-closed
 *     picks. Only captures when closeOdds is null.
 */

const fs = require("fs")
const path = require("path")
const clvMath = require("../pipeline/grading/clvMath")
// 2026-05-27 — Lane B Phase 3. After stamping closeOdds on tracked_bets,
// mirror the same close-line data into personal_ledger via the canonical
// batchSetClosingLines. The FE GRADES tab reads clvPct + beatMarket from
// personal_ledger (line 2209 of frontend/mobile/index.html), so without
// this mirror the FE CLV badges stay dormant even after CLV captures fire.
let _personalLedger = null
try { _personalLedger = require("../pipeline/shared/buildPersonalLedger") }
catch (e) { console.warn("[captureClosingLines] personal_ledger sync disabled (require failed):", e?.message) }

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
const CLOSE_WINDOW_MIN = 30                     // capture within 30min of tip
const POST_TIP_WINDOW_MIN = 10                  // also capture for games that started up to 10min ago

// 2026-05-26 — Date resolution: tracked_bets files are written under the
// Detroit (ET) slate date by buildNbaPerformanceTracking (matches the
// operator's market & nightly cycle), NOT UTC. UTC-based todayKey would
// miss the file at night (e.g. 00:12 UTC May 27 = 8:12pm ET May 26).
// Resolve both candidate dates and use whichever has a file.
function localDateKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
function utcDateKey() {
  return new Date().toISOString().slice(0, 10)
}
function resolveActiveDate() {
  // 2026-05-28 — Extended date resolution. Original only tried today's date in
  // ET/UTC. Bug: when picks for tonight's game tipping in CURRENT day were
  // persisted UNDER YESTERDAY's tracked_bets file (because persistTrackedToday
  // ran at write-time which was yesterday in slate terms), the CLV loop
  // looked at today's file (which doesn't exist yet) and skipped silently.
  // Example: May 28 picks for Game 5 (tip May 28 8:40 PM ET) live in
  // nba_tracked_bets_2026-05-27.json — CLV loop returning "skip_no_file"
  // because it looks for 2026-05-28. Fix: walk back up to 2 days; use the
  // first file that exists. The 30-min in_window check in captureEligibility
  // filters out stale picks naturally — old games are long_past.
  const todayLocal = localDateKey()
  const todayUtc   = utcDateKey()
  const yesterdayLocal = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
  })()
  const candidates = [todayLocal, todayUtc, yesterdayLocal]
  for (const d of candidates) {
    const p = path.join(TRACKING_DIR, `nba_tracked_bets_${d}.json`)
    if (fs.existsSync(p)) return d
  }
  return candidates[0]  // honest "today" even if no file yet
}

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return fb }
}

function writeJsonAtomic(p, data) {
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, p)
}

const SNAPSHOT_PATH = path.join(__dirname, "..", "snapshot.json")

/**
 * Read current odds directly from snapshot.json on disk. Backend writes this
 * file on every refresh. Avoids the /api/odds HTTP endpoint (which only
 * returns counts, not rawProps). Honest empty array on error / stale file.
 *
 * Returns { rawProps, events, updatedAt }. The on-disk snapshot uses a wrapper:
 *   { data: { updatedAt, events, rawProps, ... }, savedAt: <unix ms> }
 */
function loadSnapshotRawProps() {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return { rawProps: [], events: [], updatedAt: null }
    const wrap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"))
    const snap = wrap?.data || wrap
    return {
      rawProps: Array.isArray(snap?.rawProps) ? snap.rawProps : [],
      events:   Array.isArray(snap?.events)   ? snap.events   : [],
      updatedAt: snap?.updatedAt || null,
    }
  } catch (e) {
    console.warn("[captureClosingLines] snapshot read failed:", e?.message || e)
    return { rawProps: [], events: [], updatedAt: null }
  }
}

/**
 * 2026-05-27 — Lane B fallback. tracked_bets entries persist `eventId` but
 * `leanBet` upstream sometimes stamps `gameTime: null` (the play object
 * coming out of buildNbaBestBetsBoard drops it). Without gameTime we cannot
 * decide if a pick is in the close-capture window — every bet returns
 * "no_game_time" and CLV close-side capture is silently dead.
 *
 * Build an eventId → gameTime lookup from snapshot.events (events DO carry
 * commence_time / gameTime) and use it as a fallback in captureEligibility.
 * Tries common field names so renames upstream don't break this layer.
 */
function buildEventTimeMap(events) {
  const m = new Map()
  for (const e of (Array.isArray(events) ? events : [])) {
    const id = e?.id || e?.eventId
    if (!id) continue
    const gt = e?.gameTime || e?.commence_time || e?.commenceTime || e?.startTime || null
    if (gt) m.set(String(id), gt)
  }
  return m
}

/**
 * Resolve a bet's effective gameTime. Prefers bet.gameTime, falls back to the
 * eventId lookup. Returns null if neither is available.
 */
function resolveBetGameTime(bet, eventTimeMap) {
  if (bet?.gameTime) return bet.gameTime
  if (!bet?.eventId || !eventTimeMap) return null
  return eventTimeMap.get(String(bet.eventId)) || null
}

/**
 * Build a lookup index keyed by (player, statFamily, side, line, book) lowercase.
 * Match a tracked bet against this index to find its current live odds.
 */
function buildPropIndex(rawProps) {
  const ix = new Map()
  for (const r of (Array.isArray(rawProps) ? rawProps : [])) {
    const player = String(r?.player || "").toLowerCase().trim()
    const fam    = String(r?.statFamily || r?.propType || "").toLowerCase().trim()
    const side   = String(r?.side || "").toLowerCase().trim()
    const line   = String(r?.line ?? "")
    const book   = String(r?.book || r?.sportsbook || "").toLowerCase().trim()
    if (!player || !fam || !side) continue
    const key = `${player}|${fam}|${side}|${line}|${book}`
    // Prefer the freshest row (later observations win)
    ix.set(key, r)
  }
  return ix
}

function matchKeyForBet(bet) {
  const player = String(bet?.player || "").toLowerCase().trim()
  const fam    = String(bet?.statFamily || bet?.propType || "").toLowerCase().trim()
  const side   = String(bet?.side || "").toLowerCase().trim()
  const line   = String(bet?.line ?? "")
  const book   = String(bet?.sportsbook || bet?.book || "").toLowerCase().trim()
  return `${player}|${fam}|${side}|${line}|${book}`
}

/**
 * Decide whether a given bet is in the close-capture window right now.
 * Accepts optional eventTimeMap to recover gameTime when bet.gameTime is null
 * (see buildEventTimeMap doc — leanBet upstream sometimes drops the field).
 * Returns one of: "in_window", "too_early", "already_captured", "no_game_time", "long_past"
 */
function captureEligibility(bet, nowMs, eventTimeMap = null) {
  if (bet.closeOdds != null) return "already_captured"
  const gt = resolveBetGameTime(bet, eventTimeMap)
  if (!gt) return "no_game_time"
  const gtMs = new Date(gt).getTime()
  if (!Number.isFinite(gtMs)) return "no_game_time"
  const minutesUntilTip = (gtMs - nowMs) / 60000
  if (minutesUntilTip > CLOSE_WINDOW_MIN) return "too_early"
  if (minutesUntilTip < -POST_TIP_WINDOW_MIN) return "long_past"
  return "in_window"
}

async function runOnce({ date } = {}) {
  const resolvedDate = date || resolveActiveDate()
  const betsPath = path.join(TRACKING_DIR, `nba_tracked_bets_${resolvedDate}.json`)
  // Eslint-noop: keep the variable observable in logs
  const _date = resolvedDate
  const bets = readJsonSafe(betsPath, null)
  if (!Array.isArray(bets) || bets.length === 0) {
    console.log("[captureClosingLines]", { date: resolvedDate, bets: 0, action: "skip_no_file" })
    return { captured: 0, scanned: 0 }
  }

  // Load snapshot once up-front. We need events here (for eventTimeMap fallback
  // when bet.gameTime is null — see buildEventTimeMap doc) AND rawProps later
  // for live-odds matching. Single read, two consumers.
  const { rawProps, events, updatedAt } = loadSnapshotRawProps()
  const eventTimeMap = buildEventTimeMap(events)

  const nowMs = Date.now()
  const eligible = []
  const reasons = { in_window: 0, too_early: 0, already_captured: 0, no_game_time: 0, long_past: 0 }
  for (const b of bets) {
    const r = captureEligibility(b, nowMs, eventTimeMap)
    reasons[r] = (reasons[r] || 0) + 1
    if (r === "in_window") eligible.push(b)
  }

  console.log("[captureClosingLines] scan", {
    date: resolvedDate,
    total: bets.length,
    reasons,
    eventTimeMapSize: eventTimeMap.size,
  })

  if (eligible.length === 0) {
    return { captured: 0, scanned: bets.length }
  }

  const ix = buildPropIndex(rawProps)
  console.log("[captureClosingLines] snapshot rawProps:", rawProps.length, "indexed:", ix.size, "snapshotAt:", updatedAt)

  let captured = 0
  let unmatched = 0
  const matchedKeys = []
  // 2026-05-27 — Lane B Phase 3. Accumulate (bet.id, closeOdds) so we can
  // batch-mirror into personal_ledger via batchSetClosingLines after the loop.
  const ledgerClosingMap = {}
  for (const b of bets) {
    const elig = captureEligibility(b, nowMs, eventTimeMap)
    if (elig !== "in_window") continue
    const key = matchKeyForBet(b)
    const live = ix.get(key)
    if (!live) {
      unmatched++
      continue
    }
    const closeOdds = Number(live.odds ?? live.oddsAmerican)
    if (!Number.isFinite(closeOdds)) {
      unmatched++
      continue
    }
    const closeImp = clvMath.impliedFromAmerican(closeOdds)
    const clv      = clvMath.computeClv({ openOdds: b.openOdds, closeOdds })
    const quality  = clvMath.clvQualityLabel(clv)
    b.closeOdds         = closeOdds
    b.closeObservedAt   = new Date().toISOString()
    b.closeImpliedProb  = closeImp
    b.clv               = clv
    b.clvQuality        = quality
    captured++
    matchedKeys.push(`${b.player} ${b.statFamily} ${b.side} ${b.line}: ${b.openOdds}→${closeOdds} clv=${clv?.toFixed(4)} (${quality})`)
    if (b.id) {
      ledgerClosingMap[b.id] = {
        closingOdds:       closeOdds,
        closingLine:       (live.line != null ? Number(live.line) : (b.line != null ? Number(b.line) : null)),
        closingSportsbook: (live.book || live.sportsbook || b.sportsbook || null),
        closedAt:          b.closeObservedAt,
      }
    }
  }

  if (captured > 0) {
    writeJsonAtomic(betsPath, bets)
    console.log("[captureClosingLines] WROTE", { date, captured, unmatched })
    for (const m of matchedKeys) console.log("  ", m)
    // Lane B Phase 3 mirror — stamp the same close-line data on personal_ledger
    // so the FE GRADES tab's already-wired CLV badge (clvPct + beatMarket reading
    // from buildPersonalLedger's clvSnapshot at frontend/mobile/index.html line 2209)
    // lights up automatically. Without this, captureClosingLines stamps tracked_bets
    // and the FE never sees CLV.
    if (_personalLedger && typeof _personalLedger.batchSetClosingLines === "function") {
      try {
        const r = _personalLedger.batchSetClosingLines(ledgerClosingMap)
        console.log("[captureClosingLines] ledger mirror:", r?.count || 0, "of", Object.keys(ledgerClosingMap).length, "matched in personal_ledger")
      } catch (e) {
        console.warn("[captureClosingLines] ledger mirror failed (non-fatal):", e?.message || e)
      }
    }
  } else {
    console.log("[captureClosingLines] nothing to capture", { date, unmatched })
  }
  return { captured, scanned: bets.length, unmatched }
}

/**
 * Long-running loop — calls runOnce every interval. Used by server.js
 * setInterval embedding so the backend captures closing lines automatically
 * without operator running anything.
 */
function startBackgroundLoop({ intervalMs = 5 * 60 * 1000 } = {}) {
  const tick = async () => {
    try { await runOnce({}) }
    catch (e) { console.warn("[captureClosingLines] loop tick failed:", e?.message) }
  }
  // Fire immediately, then on interval
  tick()
  return setInterval(tick, intervalMs)
}

// CLI entry
if (require.main === module) {
  const watch = process.argv.includes("--watch")
  if (watch) {
    console.log("[captureClosingLines] watch mode — every 5 min")
    startBackgroundLoop()
  } else {
    runOnce({}).then(r => {
      console.log("[captureClosingLines] done", r)
      process.exit(0)
    }).catch(e => {
      console.error("[captureClosingLines] fatal:", e)
      process.exit(1)
    })
  }
}

module.exports = {
  runOnce,
  startBackgroundLoop,
  captureEligibility,
  buildPropIndex,
  matchKeyForBet,
  buildEventTimeMap,
  resolveBetGameTime,
}
