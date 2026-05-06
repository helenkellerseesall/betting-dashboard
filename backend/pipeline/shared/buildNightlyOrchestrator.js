"use strict"

/**
 * Nightly Review Orchestrator.
 *
 * ONE shared flow that chains every post-slate intelligence system in the
 * correct order — zero API calls, zero polling, one pass.
 *
 * Execution order:
 *   1. Slate completion guard      — refuse to poison state on partial slates
 *   2. Apply tracked results       — optional: if caller passes new bet/leg results
 *   3. Post-game review            — projection vs actual, archetype evolution
 *   4. Ledger settlement           — match personal ledger to tracked results
 *   5. CLV closing lines           — optional: if caller passes closing odds
 *   6. Book intelligence sync      — rolling CLV/ROI/ladder profiles per book
 *   7. Line shopping refresh       — snapshot rows → best lines for report
 *   8. Nightly report generation   — combined output across all subsystems
 *   9. Write nightly summary file  — compact persist at runtime/tracking/
 *
 * Callers:
 *   - scripts/nightlyReview.js            (standalone CLI)
 *   - scripts/updateNbaResults.js --full  (results + review in one command)
 *   - scripts/updateMlbResults.js --full
 *   - cron: `0 23 * * * node scripts/nightlyReview.js --sport=nba`
 *
 * Nothing here rebuilds projections, hits an API, or runs in a loop.
 */

const fs   = require("fs")
const path = require("path")

// ── sub-engines ───────────────────────────────────────────────────────────────
const { runPostGameReview }        = require("./buildPostGameReview")
const {
  loadLedger,
  batchSettle,
  batchSetClosingLines,
  buildNightlyReport,
  importFromTrackedBets,
}                                  = require("./buildPersonalLedger")
const {
  updateBookStateFromLedger,
  updateLadderProfilesInState,
  buildNightlyBookReport,
  buildLineShopping,
  buildLadderShopping,
  loadBookState,
  saveBookState,
}                                  = require("./buildLineShoppingIntelligence")
const {
  buildMarketTiming,
  updateTimingOutcomesFromLedger,
  updateConsensusSnapshot,
  buildNightlyTimingReport,
  loadTimingState,
  saveTimingState,
}                                  = require("./buildMarketTimingIntelligence")

// Sport-specific tracking modules (lazy-loaded to keep require cost zero for unused sports)
const SPORT_TRACKING = {
  nba: () => require("../nba/buildNbaPerformanceTracking"),
  mlb: () => require("../mlb/phase4Tracking"),
}

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")
const SUMMARY_FILE = (date) => path.join(TRACKING_DIR, `nightly_review_${date}.json`)
const LOCK_FILE    = (sport, date) => path.join(TRACKING_DIR, `.nightly_lock_${sport}_${date}`)

// ── helpers ───────────────────────────────────────────────────────────────────

function readJsonSafe(p, fb = null) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fb } catch (_) { return fb }
}
function writeJsonSync(p, d) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d)); return true } catch (_) { return false }
}
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function elapsed(label, t0) {
  return `${label} +${Date.now() - t0}ms`
}

// ── slate completion detection ────────────────────────────────────────────────

/**
 * Determine whether a slate is safe to run post-review on.
 *
 * Checks (in order):
 *   a) Tracking file exists for (sport, date)
 *   b) At least one settled bet exists (non-pending)
 *   c) Snapshot game times: are all games ≥ GAME_END_BUFFER_HOURS past tip?
 *
 * Returns { ready: bool, reason: string, settledCount: int, pendingCount: int }
 */
const GAME_END_BUFFER_HOURS = 3.5   // assume all games done 3.5h after tip

function detectSlateCompletion(sport, date, { snapshotRows = null } = {}) {
  const key     = String(sport).toLowerCase()
  const betsFile = path.join(TRACKING_DIR, `${key}_tracked_bets_${date}.json`)

  if (!fs.existsSync(betsFile)) {
    return { ready: false, reason: "no_tracking_file", settledCount: 0, pendingCount: 0 }
  }

  const bets = readJsonSafe(betsFile, []) || []
  if (!bets.length) {
    return { ready: false, reason: "empty_tracking_file", settledCount: 0, pendingCount: 0 }
  }

  const settled = bets.filter((b) => b.result && b.result !== "pending").length
  const pending = bets.filter((b) => !b.result || b.result === "pending").length

  // If no bets settled yet, check game times from snapshot rows
  if (settled === 0 && snapshotRows && Array.isArray(snapshotRows)) {
    const now = Date.now()
    const gameTimes = snapshotRows
      .map((r) => r.gameTime)
      .filter(Boolean)
      .map((t) => new Date(t).getTime())
      .filter((t) => Number.isFinite(t))

    if (gameTimes.length) {
      const latestTip  = Math.max(...gameTimes)
      const bufferMs   = GAME_END_BUFFER_HOURS * 60 * 60 * 1000
      const gamesLikelyDone = now > latestTip + bufferMs

      if (!gamesLikelyDone) {
        const minsLeft = Math.round((latestTip + bufferMs - now) / 60000)
        return {
          ready: false,
          reason: `games_likely_in_progress (latest_tip +${GAME_END_BUFFER_HOURS}h in ~${minsLeft}min)`,
          settledCount: 0,
          pendingCount: pending,
        }
      }
    }

    // Games appear done but no results entered yet
    return {
      ready: "partial",
      reason: "games_complete_no_results_entered",
      settledCount: 0,
      pendingCount: pending,
    }
  }

  if (settled === 0) {
    return { ready: "partial", reason: "no_results_entered_yet", settledCount: 0, pendingCount: pending }
  }

  return { ready: true, reason: "ok", settledCount: settled, pendingCount: pending }
}

// ── duplicate-run guard ───────────────────────────────────────────────────────

function acquireLock(sport, date) {
  const lp = LOCK_FILE(sport, date)
  if (fs.existsSync(lp)) {
    const content = readJsonSafe(lp, {})
    const age = Date.now() - new Date(content.startedAt || 0).getTime()
    // Stale lock older than 30 min — override
    if (age < 30 * 60 * 1000) return { ok: false, reason: "already_running", pid: content.pid }
  }
  writeJsonSync(lp, { pid: process.pid, sport, date, startedAt: new Date().toISOString() })
  return { ok: true }
}

function releaseLock(sport, date) {
  try { fs.unlinkSync(LOCK_FILE(sport, date)) } catch (_) { /* already gone */ }
}

// ── individual steps (each wrapped in try/catch — one bad step never kills all) ─

function stepApplyResults(sport, date, { bets = {}, legs = {} } = {}) {
  if (!Object.keys(bets).length && !Object.keys(legs).length) return { skipped: true }
  try {
    const mod = SPORT_TRACKING[sport]?.()
    if (!mod?.applyResults) return { skipped: true, reason: "no_applyResults_for_sport" }
    const r = mod.applyResults({ date, bets, legs })
    return { ok: true, applied: r }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

function stepPostGameReview(sport, date, actuals = {}) {
  try {
    const r = runPostGameReview({ sport, date, actuals, write: true })
    return {
      ok: true,
      counts: r.counts,
      totals: r.review?.totals,
      topOver: (r.review?.topOverperformers || []).slice(0, 5),
      topUnder: (r.review?.topUnderperformers || []).slice(0, 5),
      archetypeShifts: r.review?.archetypeCounts,
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

function stepLedgerImport(sport, date, defaultStake) {
  // Import any tracked bets for this date that aren't in ledger yet
  try {
    const r = importFromTrackedBets({ sport, date, defaultStake })
    return { ok: true, imported: r?.imported ?? 0 }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

function stepLedgerSettle(sport, date, extraResults = {}) {
  // Build a resultsMap from the daily tracked bets file (source of truth)
  try {
    const betsFile = path.join(TRACKING_DIR, `${sport}_tracked_bets_${date}.json`)
    const tracked  = readJsonSafe(betsFile, []) || []
    const resultsMap = {}

    for (const t of tracked) {
      if (!t.id || !t.result || t.result === "pending") continue
      resultsMap[t.id] = { result: t.result, actualStat: t.actualStat ?? null }
    }
    // Merge any caller-supplied overrides
    Object.assign(resultsMap, extraResults)

    if (!Object.keys(resultsMap).length) return { skipped: true, reason: "no_settled_tracked_bets" }

    const r = batchSettle(resultsMap)
    return { ok: true, settled: r.count }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

function stepCLVUpdate(closingLines = {}) {
  if (!Object.keys(closingLines).length) return { skipped: true }
  try {
    const r = batchSetClosingLines(closingLines)
    return { ok: true, updated: r?.updated ?? 0 }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

function stepBookSync(sport, snapshotRows = []) {
  try {
    const ledger = loadLedger()
    let state    = loadBookState()
    state = updateBookStateFromLedger(ledger.bets, state)

    if (snapshotRows.length) {
      const ladderResult = buildLadderShopping(snapshotRows)
      state = updateLadderProfilesInState(state, ladderResult, { sport })
    }
    saveBookState(state)
    return { ok: true, booksTracked: Object.keys(state.books || {}).length }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

function stepTimingSync(sport, snapshotRows = []) {
  try {
    const ledger      = loadLedger()
    const bookState   = loadBookState()
    let   timingState = loadTimingState()

    // Update timing outcomes from settled ledger CLV data
    timingState = updateTimingOutcomesFromLedger(ledger.bets, timingState)

    let timingResult = null
    if (snapshotRows.length) {
      const lineShopping = buildLineShopping(snapshotRows, { sport, bookState })
      timingResult = buildMarketTiming(snapshotRows, { lineShopping, timingState, bookState })
      // Store current consensus as baseline for next nightly comparison
      timingState = updateConsensusSnapshot(timingState, timingResult.newConsensusMap)
    }

    saveTimingState(timingState)
    return {
      ok: true,
      immediateCount: timingResult?.meta?.immediateCount ?? 0,
      soonCount:      timingResult?.meta?.soonCount ?? 0,
      statProfiles:   Object.keys(timingState.statTimingProfiles || {}).length,
      timingResult,
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

function stepBuildReports(sport, date, snapshotRows = []) {
  try {
    // Ledger nightly report
    const ledgerReport = buildNightlyReport({ sport, date, windowDays: 30 })

    // Book intelligence report
    const bookState   = loadBookState()
    const timingState = loadTimingState()
    const ledger      = loadLedger()
    let lineShopping  = null
    let ladderResult  = null
    let timingResult  = null

    if (snapshotRows.length) {
      lineShopping = buildLineShopping(snapshotRows, { sport, bookState })
      ladderResult = buildLadderShopping(snapshotRows)
      timingResult = buildMarketTiming(snapshotRows, { lineShopping, timingState, bookState })
    }

    const bookReport = buildNightlyBookReport({
      lineShopResult: lineShopping,
      ladderResult,
      bookState,
      ledgerBets: ledger.bets.filter((b) => b.date === date),
    })

    const timingReport = buildNightlyTimingReport({ timingResult, timingState, ledgerBets: ledger.bets })

    // Portfolio optimization from today's curated plays (tracked_best) + slips
    let portfolioResult = null
    try {
      const { optimizePortfolio } = require("./buildPortfolioOptimizer")
      // Use tracked_best (curated 20-50 plays), not tracked_bets (full 900+ board)
      const bestFile  = path.join(TRACKING_DIR, `${sport}_tracked_best_${date}.json`)
      const slipsFile = path.join(TRACKING_DIR, `${sport}_tracked_slips_${date}.json`)
      const bestData  = readJsonSafe(bestFile, null)
      const bestBets  = bestData?.entries || bestData || []
      const trackedSlips = readJsonSafe(slipsFile, []) || []
      if (bestBets.length) {
        portfolioResult = optimizePortfolio({ bets: bestBets, slipBets: trackedSlips, timingResult, bookState })
      }
    } catch (_) {}

    // AI Slip construction from today's curated plays
    let aiSlipResult = null
    try {
      const { buildAiSlips } = require("./buildSlipAi")
      const bestFile  = path.join(TRACKING_DIR, `${sport}_tracked_best_${date}.json`)
      const bestData  = readJsonSafe(bestFile, null)
      const bestBets  = bestData?.entries || bestData || []
      const trackedBetsFile = path.join(TRACKING_DIR, `${sport}_tracked_bets_${date}.json`)
      const trackedBets     = readJsonSafe(trackedBetsFile, []) || []
      const candidates = [...trackedBets.filter((b) => Number(b.edge) > 0.04), ...bestBets]
      if (candidates.length) {
        aiSlipResult = buildAiSlips({
          candidates,
          timingResult,
          bookState,
          ledgerState: ledger,
          portfolioBaseline: { bets: bestBets },
          options: { sport, date, maxPerTier: 3 },
        })
      }
    } catch (_) {}

    return { ok: true, ledgerReport, bookReport, lineShopping, timingReport, portfolioResult, aiSlipResult }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

// ── MAIN ORCHESTRATOR ─────────────────────────────────────────────────────────

/**
 * Run the complete nightly review + evolution flow for one sport+date.
 *
 * @param {object}  opts
 * @param {string}  opts.sport           "nba" | "mlb"
 * @param {string}  [opts.date]          YYYY-MM-DD (defaults to today)
 * @param {object}  [opts.bets]          { [betId]: "win"|"loss"|"push"|"void" }
 * @param {object}  [opts.legs]          { [legId]: "win"|"loss"|... }
 * @param {object}  [opts.actuals]       { [betId]: { stat, environment? } }
 * @param {object}  [opts.closingLines]  { [betId]: { closingOdds, closingLine } }
 * @param {Array}   [opts.snapshotRows]  Normalized prop rows for line shopping
 * @param {number}  [opts.defaultStake]  Default stake for ledger import (default 10)
 * @param {boolean} [opts.force]         Skip slate-completion guard
 * @param {boolean} [opts.dryRun]        Run all steps but skip writes
 * @param {boolean} [opts.verbose]       Print step timings to stdout
 *
 * @returns {object}  { ok, sport, date, steps, summary, completionStatus }
 */
function runNightlyReview(opts = {}) {
  const sport        = String(opts.sport || "nba").toLowerCase()
  const date         = opts.date || todayKey()
  const bets         = opts.bets         && typeof opts.bets === "object"  ? opts.bets : {}
  const legs         = opts.legs         && typeof opts.legs === "object"  ? opts.legs : {}
  const actuals      = opts.actuals      && typeof opts.actuals === "object" ? opts.actuals : {}
  const closingLines = opts.closingLines && typeof opts.closingLines === "object" ? opts.closingLines : {}
  const snapshotRows = Array.isArray(opts.snapshotRows) ? opts.snapshotRows : []
  const defaultStake = Number.isFinite(Number(opts.defaultStake)) ? Number(opts.defaultStake) : 10
  const force        = !!opts.force
  const dryRun       = !!opts.dryRun
  const verbose      = !!opts.verbose

  if (!SPORT_TRACKING[sport]) {
    return { ok: false, error: `Unsupported sport: ${sport}`, sport, date }
  }

  const t0 = Date.now()
  const log = verbose ? (msg) => console.log(`[nightly-orchestrator] ${msg}`) : () => {}

  // ── 0. duplicate-run guard ──────────────────────────────────────────────────
  const lock = dryRun ? { ok: true } : acquireLock(sport, date)
  if (!lock.ok) {
    return { ok: false, error: `Already running: ${lock.reason}`, sport, date }
  }

  const steps = {}

  try {
    // ── 1. Slate completion guard ─────────────────────────────────────────────
    const completion = detectSlateCompletion(sport, date, { snapshotRows })
    steps.completion = completion

    if (!force && completion.ready === false) {
      log(`Deferred: ${completion.reason}`)
      return {
        ok: false,
        deferred: true,
        reason: completion.reason,
        sport,
        date,
        steps,
      }
    }

    if (completion.ready === "partial" && !force) {
      log(`Warning: partial completion — ${completion.reason}. Proceeding with available data.`)
    }

    log("Slate OK — starting orchestration")

    // ── 2. Apply tracking results ─────────────────────────────────────────────
    log("Step 2: apply results")
    steps.applyResults = dryRun
      ? { skipped: true, reason: "dry_run" }
      : stepApplyResults(sport, date, { bets, legs })
    log(elapsed("applyResults", t0))

    // ── 3. Post-game review ───────────────────────────────────────────────────
    log("Step 3: post-game review")
    steps.review = dryRun
      ? { skipped: true, reason: "dry_run" }
      : stepPostGameReview(sport, date, actuals)
    log(elapsed("review", t0))

    // ── 4. Ledger import (idempotent — only adds missing entries) ─────────────
    log("Step 4: ledger import")
    steps.ledgerImport = dryRun
      ? { skipped: true, reason: "dry_run" }
      : stepLedgerImport(sport, date, defaultStake)
    log(elapsed("ledgerImport", t0))

    // ── 5. Ledger settlement ──────────────────────────────────────────────────
    log("Step 5: ledger settle")
    steps.ledgerSettle = dryRun
      ? { skipped: true, reason: "dry_run" }
      : stepLedgerSettle(sport, date)
    log(elapsed("ledgerSettle", t0))

    // ── 6. CLV closing lines ──────────────────────────────────────────────────
    log("Step 6: CLV update")
    steps.clvUpdate = dryRun
      ? { skipped: true, reason: "dry_run" }
      : stepCLVUpdate(closingLines)
    log(elapsed("clvUpdate", t0))

    // ── 7. Book intelligence sync ─────────────────────────────────────────────
    log("Step 7: book sync")
    steps.bookSync = dryRun
      ? { skipped: true, reason: "dry_run" }
      : stepBookSync(sport, snapshotRows)
    log(elapsed("bookSync", t0))

    // ── 7.5. Timing intelligence sync ────────────────────────────────────────
    log("Step 7.5: timing sync")
    steps.timingSync = dryRun
      ? { skipped: true, reason: "dry_run" }
      : stepTimingSync(sport, snapshotRows)
    log(elapsed("timingSync", t0))

    // ── 8. Build all reports ──────────────────────────────────────────────────
    log("Step 8: build reports")
    steps.reports = stepBuildReports(sport, date, snapshotRows)
    log(elapsed("reports", t0))

    // ── 9. Write nightly summary ──────────────────────────────────────────────
    const summary = buildNightlySummary({ sport, date, steps, elapsed: Date.now() - t0 })
    steps.summary = summary

    if (!dryRun) {
      writeJsonSync(SUMMARY_FILE(date), {
        sport,
        date,
        generatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - t0,
        completion,
        steps: sanitizeForStorage(steps),
        summary,
      })
      log(`Summary written → nightly_review_${date}.json`)
    }

    return {
      ok: true,
      sport,
      date,
      elapsedMs: Date.now() - t0,
      completionStatus: completion,
      steps,
      summary,
    }

  } catch (fatal) {
    steps.fatalError = String(fatal?.message || fatal)
    return { ok: false, sport, date, error: steps.fatalError, steps }
  } finally {
    if (!dryRun) releaseLock(sport, date)
  }
}

// ── MULTI-SPORT WRAPPER ───────────────────────────────────────────────────────

/**
 * Run nightly review for multiple sports in sequence.
 * Used by scripts/nightlyReview.js --sport=all
 */
async function runNightlyReviewAll(opts = {}) {
  const sports = ["nba", "mlb"]
  const results = {}
  for (const sport of sports) {
    results[sport] = runNightlyReview({ ...opts, sport })
  }
  return results
}

// ── SUMMARY BUILDER ───────────────────────────────────────────────────────────

function buildNightlySummary({ sport, date, steps, elapsed: elapsedMs = 0 } = {}) {
  const review      = steps.review?.ok ? steps.review : null
  const reports     = steps.reports?.ok ? steps.reports : null
  const ledgerRpt   = reports?.ledgerReport
  const bookRpt     = reports?.bookReport

  // Top model outcomes
  const topOver  = review?.topOver  || []
  const topUnder = review?.topUnder || []

  // Ledger summary
  const ls = ledgerRpt?.summary || {}

  // Best CLV bets tonight
  const clvBets = (ledgerRpt?.clv?.bestClv || []).slice(0, 5).map((b) => ({
    player: b.player,
    prop: b.prop,
    clvPct: b.clvSnapshot?.clv?.clvPct,
    quality: b.clvSnapshot?.clv?.quality,
    result: b.result,
  }))

  // Top line-shopping ops
  const topShops = (bookRpt?.topLineShopping || []).slice(0, 5)

  // Stale books
  const stale = (bookRpt?.staleBooks || []).slice(0, 5)

  // Book CLV leaders
  const clvByBook = (bookRpt?.clvByBook || []).slice(0, 5)

  // Archetype shifts
  const archetypes = review?.archetypeShifts || {}

  return {
    sport,
    date,
    elapsedMs,
    bettingPnl: {
      settled: ls.totalSettled || 0,
      winRate: ls.winRate || null,
      roi: ls.roi || null,
      totalProfit: ls.totalProfit || null,
    },
    modelReview: {
      classified: review?.counts?.classified ?? 0,
      topOverperformers: topOver,
      topUnderperformers: topUnder,
    },
    clv: {
      bestBets: clvBets,
    },
    lineShoppingHighlights: topShops,
    staleBooks: stale,
    clvByBook,
    archetypeShifts: archetypes,
    stepHealth: {
      applyResults:  stepsOk(steps.applyResults),
      review:        stepsOk(steps.review),
      ledgerImport:  stepsOk(steps.ledgerImport),
      ledgerSettle:  stepsOk(steps.ledgerSettle),
      clvUpdate:     stepsOk(steps.clvUpdate),
      bookSync:      stepsOk(steps.bookSync),
      timingSync:    stepsOk(steps.timingSync),
      reports:       stepsOk(steps.reports),
    },
  }
}

function stepsOk(step) {
  if (!step) return "not_run"
  if (step.skipped) return "skipped"
  if (step.ok === false) return `error: ${step.error}`
  return "ok"
}

// Strip bulky report payloads before persisting summary JSON
function sanitizeForStorage(steps) {
  const out = {}
  for (const [k, v] of Object.entries(steps || {})) {
    if (k === "reports") {
      out[k] = {
        ok: v?.ok,
        error: v?.error,
        ledgerSummary: v?.ledgerReport?.summary || null,
        bookMeta: v?.bookReport?.meta || null,
      }
    } else {
      out[k] = v
    }
  }
  return out
}

module.exports = {
  runNightlyReview,
  runNightlyReviewAll,
  detectSlateCompletion,
  buildNightlySummary,
  SUMMARY_FILE,
}
