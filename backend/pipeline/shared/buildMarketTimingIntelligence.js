"use strict"

/**
 * Market Urgency + Timing Intelligence.
 *
 * Teaches the system WHEN to bet, not just WHAT has value.
 * Zero API calls — works entirely from existing snapshot rows.
 *
 * Layers:
 *   1. MARKET STATE — classify each prop: stable / drifting / steam / stale_window /
 *                     overcorrected / limited
 *   2. LINE MOVEMENT — compare current consensus vs stored previous snapshot
 *                      to derive direction and velocity
 *   3. URGENCY RECOMMENDATION — immediate / soon / patient / wait / avoid
 *   4. TIMING OUTCOMES — rolling CLV by (statFamily × timingBucket) to learn which
 *                        props decay fastest / reward early entry
 *   5. NIGHTLY REPORT — best urgency plays, stale windows, timing CLV leaders
 *
 * Rolling state: backend/runtime/tracking/timing_intelligence_state.json
 *
 * Integrate with:
 *   - buildLineShoppingIntelligence (lineShopping input)
 *   - buildNightlyOrchestrator (step in nightly flow)
 *   - board builders (annotate bets with urgency tags)
 */

const fs   = require("fs")
const path = require("path")

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")
const STATE_FILE   = path.join(TRACKING_DIR, "timing_intelligence_state.json")

// ── constants ─────────────────────────────────────────────────────────────────

// Urgency timing buckets (hours before game)
const TIMING_BUCKETS = {
  opening:   { min: 8,   max: Infinity, label: "opening",  urgencyBoost: 0.9 },
  morning:   { min: 4,   max: 8,        label: "morning",  urgencyBoost: 0.7 },
  afternoon: { min: 2,   max: 4,        label: "afternoon",urgencyBoost: 0.5 },
  closing:   { min: 0.5, max: 2,        label: "closing",  urgencyBoost: 0.2 },
  live:      { min: -Infinity, max: 0.5, label: "live",    urgencyBoost: 0   },
}

const STALE_DELTA_THRESHOLD = 0.025     // book 2.5¢ off consensus = stale window
const STEAM_DISPERSION      = 0.035     // books spread >3.5% = sharp disagreement
const DRIFT_DISPERSION      = 0.018     // moderate disagreement = drifting
const MOVEMENT_MEANINGFUL   = 0.012     // consensus moved ≥1.2¢ = meaningful shift

const MAX_PROP_HISTORY  = 14            // days to keep per-prop timing snapshots
const MAX_STAT_SAMPLES  = 200           // cap per stat family timing outcome

// ── helpers ───────────────────────────────────────────────────────────────────

function readJsonSafe(p, fb = null) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fb } catch (_) { return fb }
}
function writeJsonSync(p, d) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d)); return true } catch (_) { return false }
}
function num(v) { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
function r4(x)  { return Math.round(Number(x) * 10000) / 10000 }
function r2(x)  { return Math.round(Number(x) * 100) / 100 }
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
}

// ── LAYER 1: MARKET STATE CLASSIFICATION ─────────────────────────────────────

/**
 * hoursToGame — positive = before tip, negative = after tip.
 */
function hoursToGame(gameTimeStr, fetchedAtStr) {
  const game    = gameTimeStr ? new Date(gameTimeStr).getTime() : null
  const fetched = fetchedAtStr ? new Date(fetchedAtStr).getTime() : Date.now()
  if (!game || !Number.isFinite(game)) return null
  return (game - fetched) / 3_600_000
}

/**
 * Timing bucket label from hours-to-game.
 */
function timingBucket(hours) {
  if (hours == null) return "unknown"
  for (const [, b] of Object.entries(TIMING_BUCKETS)) {
    if (hours >= b.min && hours < b.max) return b.label
  }
  return "unknown"
}

/**
 * Classify the market state of a single prop group
 * (already grouped by player+prop+side+line by buildLineShopping).
 *
 * @param {object} entry    — one entry from lineShopping.byProp
 * @param {object} prevSnap — previous snapshot for this prop key (from timingState)
 * @param {object} bookState — rolling book intelligence
 * @returns {object}  { state, movement, urgency, timingBucket, hoursToGame, signals }
 */
function classifyMarketState(entry, prevSnap = null, bookState = null) {
  const dispersion = num(entry.marketDispersion) ?? 0
  const bestDelta  = num(entry.bestImpDelta) ?? 0
  const bookCount  = entry.bookCount || 1
  const consensus  = num(entry.consensus)

  // Time to game (use first book's gameTime from the underlying rows)
  const hours = null   // populated later from raw rows when available
  const bucket = "unknown"

  // ── Line movement (vs previous snapshot) ─────────────────────────────────
  let movement    = "stable"
  let movementDir = 0      // +ve = consensus implied prob rising (line moving up for overs)
  let velocity    = 0

  if (prevSnap && consensus != null && prevSnap.consensus != null) {
    const delta = consensus - prevSnap.consensus
    velocity = r4(Math.abs(delta))
    if (velocity >= MOVEMENT_MEANINGFUL) {
      movementDir = delta > 0 ? 1 : -1
      movement    = delta > 0 ? "drifting_up" : "drifting_down"
    }
  }

  // ── Market state ──────────────────────────────────────────────────────────
  let state = "stable"

  if (bookCount < 2) {
    state = "limited"
  } else if (dispersion >= STEAM_DISPERSION) {
    state = "steam"
  } else if (dispersion >= DRIFT_DISPERSION) {
    state = movement !== "stable" ? "drifting" : "contested"
  }

  // Stale-window detection: any book is outlier-soft (better than consensus)
  const hasSoftBook = entry.books && entry.books.some((b) => {
    const delta = (b.imp ?? 0) - (consensus ?? 0)
    return delta < -STALE_DELTA_THRESHOLD   // book underprices = soft = value
  })
  if (hasSoftBook) state = "stale_window"

  // Overcorrected: consensus has moved past model (bestDelta is now positive but model would have it lower)
  if (bestDelta > 0.035) state = "overcorrected"   // market has moved well ahead of where we'd bet

  // ── Urgency ───────────────────────────────────────────────────────────────
  let urgency = deriveUrgency(state, movement, bookCount, bestDelta, bookState, entry.propFamilyKey)

  // ── Signals list ─────────────────────────────────────────────────────────
  const signals = []
  if (state === "stale_window")   signals.push("stale_book_window_open")
  if (state === "steam")          signals.push("sharp_money_detected")
  if (state === "drifting")       signals.push(movementDir > 0 ? "line_moving_up" : "line_moving_down")
  if (state === "overcorrected")  signals.push("market_overcorrected")
  if (state === "limited")        signals.push("thin_market")
  if (movement !== "stable")      signals.push(`movement_velocity_${(velocity*100).toFixed(1)}c`)
  if (bookCount >= 4)             signals.push("deep_market")

  // Book profile signals
  if (bookState?.books) {
    const bestBookProfile = bookState.books[entry.bestBook]
    if (bestBookProfile?.avgClv != null && bestBookProfile.avgClv > 0.01) {
      signals.push(`${entry.bestBook}_historically_soft`)
    }
  }

  return {
    key:          entry.key,
    player:       entry.player,
    prop:         `${entry.propType} ${entry.side} ${entry.line}`,
    propFamilyKey:entry.propFamilyKey,
    bestBook:     entry.bestBook,
    bestOdds:     entry.bestOdds,
    state,
    movement,
    movementDir,
    velocity,
    urgency,
    timingBucket: bucket,
    hoursToGame:  hours,
    bookCount,
    dispersion:   r4(dispersion),
    signals,
  }
}

function deriveUrgency(state, movement, bookCount, bestDelta, bookState, statFamily) {
  // Hard stops
  if (state === "overcorrected")  return "avoid"
  if (state === "limited")        return "wait"

  // Stale window — value is fleeting
  if (state === "stale_window")   return "immediate"

  // Sharp steam — market correcting fast, bet before it closes
  if (state === "steam")          return "immediate"

  // Market moving against us
  if (movement === "drifting_up" && bestDelta < -0.01) return "wait"

  // Market moving in our favour — catch it
  if (movement === "drifting_down" && bestDelta < -0.01) return "soon"

  // Contested — books disagree but no clear direction
  if (state === "contested")      return "soon"

  // Stable with a real edge
  if (bestDelta != null && bestDelta < -0.008) return "soon"

  // Rolling stat-family urgency from historical timing outcomes
  const statUrgency = statFamilyUrgencyHint(statFamily, bookState)
  if (statUrgency === "immediate") return "immediate"
  if (statUrgency === "wait")      return "patient"

  return "patient"
}

/**
 * Stat-family timing hint from book state rolling history.
 * Over time: stat families where early CLV >> late CLV → "immediate"
 */
function statFamilyUrgencyHint(statFamily, bookState) {
  if (!statFamily || !bookState?.statTimingProfiles) return null
  const p = bookState.statTimingProfiles[statFamily]
  if (!p) return null
  if (p.earlyAvgClv != null && p.closingAvgClv != null) {
    const diff = p.earlyAvgClv - p.closingAvgClv
    if (diff > 0.015) return "immediate"   // early beats closing by >1.5¢
    if (diff < -0.015) return "wait"       // closing beats early
  }
  return null
}

// ── LAYER 2: RAW ROW ENRICHMENT ────────────────────────────────────────────────

/**
 * Enrich snapshot rows with per-row timing annotations.
 * Adds: hoursToGame, timingBucket, urgencyHint to each row.
 */
function enrichRowsWithTiming(rows = [], timingState = null, bookState = null) {
  const fetchedAt = rows[0]?.fetchedAt ?? new Date().toISOString()
  return rows.map((r) => {
    const h      = hoursToGame(r.gameTime, fetchedAt)
    const bucket = timingBucket(h)
    const fam    = String(r.propFamilyKey || r.propType || "").toLowerCase()
    const statHint = statFamilyUrgencyHint(fam, bookState)

    // Quick per-row urgency (no grouping needed)
    let rowUrgency = "patient"
    if (h != null && h < 0.5)                  rowUrgency = "avoid"   // game starting/started
    else if (Math.abs(r.bookVsConsensusDelta ?? 0) > STALE_DELTA_THRESHOLD) rowUrgency = "immediate"
    else if ((r.bookImpliedDispersion ?? 0) >= STEAM_DISPERSION)            rowUrgency = "immediate"
    else if (statHint === "immediate")                                       rowUrgency = "immediate"
    else if (statHint === "wait")                                            rowUrgency = "wait"
    else if (h != null && h < 2)               rowUrgency = "soon"    // closing window
    else if (bucket === "opening")             rowUrgency = "soon"    // opening = act early

    return { ...r, hoursToGame: h != null ? r4(h) : null, timingBucket: bucket, urgencyHint: rowUrgency }
  })
}

// ── LAYER 3: FULL TIMING PASS ─────────────────────────────────────────────────

/**
 * Main entry point.
 *
 * @param {Array}  rows         Normalized snapshot rows (enriched in place).
 * @param {object} lineShopping Result of buildLineShopping() for these rows.
 * @param {object} timingState  Existing rolling state from loadTimingState().
 * @param {object} bookState    Rolling book intelligence from loadBookState().
 * @returns { enrichedRows, timingClassifications, urgentPlays, timingReport }
 */
function buildMarketTiming(rows = [], { lineShopping = null, timingState = null, bookState = null } = {}) {
  const prevConsensusMap = timingState?.consensusSnapshot || {}
  const fetchedAt = rows[0]?.fetchedAt ?? new Date().toISOString()

  // Enrich raw rows with per-row timing tags
  const enrichedRows = enrichRowsWithTiming(rows, timingState, bookState)

  // Classify every prop group from line shopping
  const byProp = lineShopping?.byProp || []
  const timingClassifications = []
  const newConsensusMap = {}

  for (const entry of byProp) {
    // Attach per-row timing bucket from enriched rows (use representative game time)
    const repRow = enrichedRows.find(
      (r) => r.eventId === entry.eventId &&
             String(r.player || "").toLowerCase() === String(entry.player || "").toLowerCase()
    )
    const h      = repRow ? num(repRow.hoursToGame) : null
    const bucket = repRow?.timingBucket || timingBucket(h)

    const classification = classifyMarketState(entry, prevConsensusMap[entry.key] ?? null, bookState)
    classification.timingBucket = bucket
    classification.hoursToGame  = h
    classification.fetchedAt    = fetchedAt
    timingClassifications.push(classification)

    // Store consensus for next comparison
    newConsensusMap[entry.key] = {
      consensus: entry.consensus,
      fetchedAt,
      dispersion: entry.marketDispersion,
    }
  }

  // Urgent plays (immediate or soon, sorted by signal count + dispersion)
  const urgentPlays = timingClassifications
    .filter((c) => c.urgency === "immediate" || c.urgency === "soon")
    .sort((a, b) => {
      const scoreA = (a.urgency === "immediate" ? 2 : 1) + a.signals.length * 0.1 + (a.dispersion ?? 0)
      const scoreB = (b.urgency === "immediate" ? 2 : 1) + b.signals.length * 0.1 + (b.dispersion ?? 0)
      return scoreB - scoreA
    })
    .slice(0, 30)

  // Stat-family urgency summary
  const byStatFamily = {}
  for (const c of timingClassifications) {
    const fam = c.propFamilyKey || "other"
    if (!byStatFamily[fam]) byStatFamily[fam] = { immediate: 0, soon: 0, patient: 0, wait: 0, avoid: 0 }
    byStatFamily[fam][c.urgency] = (byStatFamily[fam][c.urgency] || 0) + 1
  }

  // Stale windows
  const staleWindows = timingClassifications
    .filter((c) => c.state === "stale_window")
    .slice(0, 20)

  // Steam plays
  const steamPlays = timingClassifications
    .filter((c) => c.state === "steam")
    .slice(0, 10)

  return {
    enrichedRows,
    timingClassifications,
    urgentPlays,
    staleWindows,
    steamPlays,
    byStatFamily,
    newConsensusMap,
    meta: {
      sport: rows[0]?.sport || "unknown",
      fetchedAt,
      totalClassified: timingClassifications.length,
      immediateCount: urgentPlays.filter((p) => p.urgency === "immediate").length,
      soonCount:      urgentPlays.filter((p) => p.urgency === "soon").length,
    },
  }
}

// ── LAYER 4: TIMING OUTCOMES FROM LEDGER ─────────────────────────────────────

/**
 * Learn which stat families / timing buckets produce the best CLV.
 * Call nightly after settling + CLV update.
 *
 * Updates statTimingProfiles in the timing state.
 */
function updateTimingOutcomesFromLedger(ledgerBets = [], existingState = null) {
  const state = existingState || emptyTimingState()
  if (!Array.isArray(ledgerBets)) return state

  // Only bets with CLV and a placed timestamp
  const clvBets = ledgerBets.filter(
    (b) => b.clvSnapshot?.clv?.clvScore != null && b.clvSnapshot?.placed?.timestamp
  )

  for (const bet of clvBets) {
    const statFamily = bet.statFamily
    if (!statFamily) continue

    const clv  = num(bet.clvSnapshot.clv.clvScore)
    if (clv == null) continue

    // Determine timing bucket from when bet was placed vs game time
    // Use bet.environment.gameTime if available, else skip bucketing
    const gameTime = bet.environment?.gameTime || null
    const placedAt = bet.clvSnapshot.placed.timestamp
    const h        = hoursToGame(gameTime, placedAt)
    const bucket   = timingBucket(h)

    if (!state.statTimingProfiles[statFamily]) {
      state.statTimingProfiles[statFamily] = {
        earlyClvSum: 0, earlyClvCount: 0, earlyAvgClv: null,
        closingClvSum: 0, closingClvCount: 0, closingAvgClv: null,
        allClvSum: 0, allClvCount: 0, avgClv: null,
        buckets: {},
      }
    }
    const p = state.statTimingProfiles[statFamily]

    // Bucket-level
    if (!p.buckets[bucket]) p.buckets[bucket] = { sum: 0, count: 0, avgClv: null }
    const bkt = p.buckets[bucket]
    if (bkt.count < MAX_STAT_SAMPLES) {
      bkt.sum   += clv; bkt.count++
      bkt.avgClv = r4(bkt.sum / bkt.count)
    }

    // Early vs closing
    if (["opening", "morning"].includes(bucket)) {
      if (p.earlyClvCount < MAX_STAT_SAMPLES) {
        p.earlyClvSum += clv; p.earlyClvCount++
        p.earlyAvgClv  = r4(p.earlyClvSum / p.earlyClvCount)
      }
    } else if (["closing"].includes(bucket)) {
      if (p.closingClvCount < MAX_STAT_SAMPLES) {
        p.closingClvSum += clv; p.closingClvCount++
        p.closingAvgClv  = r4(p.closingClvSum / p.closingClvCount)
      }
    }

    // All-time
    if (p.allClvCount < MAX_STAT_SAMPLES) {
      p.allClvSum += clv; p.allClvCount++
      p.avgClv     = r4(p.allClvSum / p.allClvCount)
    }
  }

  state.updatedAt = new Date().toISOString()
  return state
}

// ── LAYER 5: CONSENSUS SNAPSHOT STORE ────────────────────────────────────────

/**
 * Persist the current consensus snapshot so the NEXT run can compute movement.
 * Prune entries older than MAX_PROP_HISTORY days.
 */
function updateConsensusSnapshot(timingState, newConsensusMap, date = todayKey()) {
  if (!timingState) timingState = emptyTimingState()
  timingState.consensusSnapshot = Object.assign(timingState.consensusSnapshot || {}, newConsensusMap)

  // Prune stale entries (older than MAX_PROP_HISTORY days)
  const cutoff = new Date(Date.now() - MAX_PROP_HISTORY * 24 * 3600 * 1000).toISOString()
  const snap   = timingState.consensusSnapshot
  for (const k of Object.keys(snap)) {
    if (snap[k].fetchedAt && snap[k].fetchedAt < cutoff) delete snap[k]
  }

  timingState.updatedAt = new Date().toISOString()
  return timingState
}

// ── LAYER 6: NIGHTLY TIMING REPORT ───────────────────────────────────────────

function buildNightlyTimingReport({ timingResult, timingState, ledgerBets = [] } = {}) {
  const ur     = timingResult?.urgentPlays || []
  const stale  = timingResult?.staleWindows || []
  const steam  = timingResult?.steamPlays  || []
  const byFam  = timingResult?.byStatFamily || {}

  // Stat family timing profiles from state
  const statProfiles = Object.entries(timingState?.statTimingProfiles || {})
    .filter(([, p]) => p.allClvCount >= 3)
    .map(([fam, p]) => ({
      statFamily: fam,
      avgClv: p.avgClv,
      earlyAvgClv: p.earlyAvgClv,
      closingAvgClv: p.closingAvgClv,
      timingEdge: p.earlyAvgClv != null && p.closingAvgClv != null
        ? r4(p.earlyAvgClv - p.closingAvgClv) : null,
      verdict: timingVerdict(p),
    }))
    .sort((a, b) => Math.abs(b.timingEdge ?? 0) - Math.abs(a.timingEdge ?? 0))

  return {
    generatedAt: new Date().toISOString(),
    meta: timingResult?.meta || {},
    urgentPlays: ur.slice(0, 20),
    staleWindows: stale.slice(0, 10),
    steamPlays: steam.slice(0, 10),
    byStatFamily: byFam,
    statTimingProfiles: statProfiles.slice(0, 12),
  }
}

function timingVerdict(p) {
  if (p.earlyAvgClv == null || p.closingAvgClv == null) return "insufficient_data"
  const diff = p.earlyAvgClv - p.closingAvgClv
  if (diff > 0.02) return "bet_early"
  if (diff < -0.02) return "wait_for_close"
  return "neutral"
}

// ── PERSISTENCE ───────────────────────────────────────────────────────────────

function emptyTimingState() {
  return {
    version: "timing-intel-v1",
    updatedAt: null,
    consensusSnapshot: {},
    statTimingProfiles: {},
  }
}

function loadTimingState() {
  return readJsonSafe(STATE_FILE, null) || emptyTimingState()
}
function saveTimingState(state) {
  return writeJsonSync(STATE_FILE, state)
}

module.exports = {
  buildMarketTiming,
  enrichRowsWithTiming,
  classifyMarketState,
  updateTimingOutcomesFromLedger,
  updateConsensusSnapshot,
  buildNightlyTimingReport,
  loadTimingState,
  saveTimingState,
  hoursToGame,
  timingBucket,
  STATE_FILE,
}
