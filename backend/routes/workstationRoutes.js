"use strict"

/**
 * Workstation Routes — read-only intelligence API for the frontend workstation.
 *
 * Sits ON TOP of the existing intelligence layers. Never duplicates business
 * logic. All routes are pure file readers + light computation.
 *
 * Endpoints (all GET except /preview):
 *   GET  /api/ws/health
 *   GET  /api/ws/state?sport=mlb&date=2026-05-06
 *   GET  /api/ws/ai-slips?sport=mlb&date=...
 *   GET  /api/ws/portfolio?sport=mlb&date=...
 *   GET  /api/ws/line-shopping?sport=mlb&date=...&limit=50
 *   GET  /api/ws/timing?sport=mlb&date=...&urgency=immediate
 *   GET  /api/ws/ledger?windowDays=30
 *   GET  /api/ws/first-basket?sport=nba&date=...
 *   POST /api/ws/bet-builder/preview
 *
 * Goals:
 *   - Lightweight: every route reads pre-computed files
 *   - Sport-agnostic: single shared shape
 *   - Cache-friendly: in-memory TTL cache (60s) per (sport,date)
 */

const express = require("express")
const fs = require("fs")
const path = require("path")
const { diversifyCandidates } = require("../pipeline/shared/buildCandidateDiversity")

const router = express.Router()

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")

// ── helpers ───────────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function readJsonSafe(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch (_) { return fallback }
}

function fileFor(sport, kind, date) {
  return path.join(TRACKING_DIR, `${sport}_${kind}_${date}.json`)
}

function findLatestDateWithData(sport) {
  try {
    const files = fs.readdirSync(TRACKING_DIR)
    const dayKeys = files
      .filter((f) => f.startsWith(`${sport}_tracked_`) && f.endsWith(".json"))
      .map((f) => (f.match(/_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
      .filter(Boolean)
      .sort()
      .reverse()
    for (const dk of dayKeys) {
      const bets = readJsonSafe(fileFor(sport, "tracked_bets", dk), [])
      const best = readJsonSafe(fileFor(sport, "tracked_best", dk), {})
      if ((Array.isArray(bets) && bets.length) || (best?.entries?.length)) return dk
    }
  } catch (_) {}
  return todayKey()
}

function resolveSportDate(req) {
  const sport = String(req.query.sport || req.body?.sport || "mlb").toLowerCase()
  const dateRaw = req.query.date || req.body?.date
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(String(dateRaw))
    ? String(dateRaw)
    : findLatestDateWithData(sport)
  return { sport, date }
}

// ── lightweight cache (60s TTL) ───────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 1000
const cache = new Map()

function cached(key, builder) {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.t < CACHE_TTL_MS) return hit.v
  const v = builder()
  cache.set(key, { t: now, v })
  return v
}

// ── candidate normalization (matches buildSlipAi expectations) ───────────────

function enrichBestEntry(e, betsById) {
  if (!e) return null
  const idGuess = `${e.slateDate || ""}|${(e.player || "").toLowerCase()}|${(e.eventId || "")}|${(e.propType || "").toLowerCase().replace(/\s+/g, "")}|${(e.side || "").toLowerCase()}|${e.line ?? ""}|${e.odds ?? ""}|${(e.book || "").toLowerCase()}`
  const tb = (betsById && betsById.get(idGuess)) || null
  return {
    ...e,
    edge:           e.edgeProbability,
    modelProb:      e.predictedProbability,
    statFamily:     String(e.propType || "").toLowerCase().replace(/\s+/g, ""),
    confidenceTier: e.bucket?.split(".").pop()?.toUpperCase() || "PLAYABLE",
    sportsbook:     e.book,
    odds:           e.odds,
    oddsAmerican:   e.odds,
    confidence:     tb?.confidence,
    tier:           tb?.tier,
  }
}

function buildCandidatePool(sport, date) {
  const trackedBets = readJsonSafe(fileFor(sport, "tracked_bets", date), []) || []
  const trackedBest = readJsonSafe(fileFor(sport, "tracked_best", date), null)
  const entries = trackedBest?.entries || []

  const betsById = new Map()
  for (const b of trackedBets) if (b?.id) betsById.set(b.id, b)

  const enrichedBest = entries.map((e) => enrichBestEntry(e, betsById)).filter(Boolean)
  // Filter tracked_bets to a sensible quality threshold so the pool is workable
  const eligibleBets = trackedBets
    .filter((b) => Number(b?.edge) > 0.04 && Number(b?.modelProb) > 0.20)
  return { trackedBets, trackedBest, enrichedBest, eligibleBets }
}

// ── Candidate diversification ────────────────────────────────────────────────
// Extracted to pipeline/shared/buildCandidateDiversity.js — imported above.

// ── load shared intelligence modules lazily ──────────────────────────────────

function loadSharedModules() {
  return {
    presentation:     require("../pipeline/shared/buildIntelligencePresentation"),
    slipAi:           require("../pipeline/shared/buildSlipAi"),
    portfolio:        require("../pipeline/shared/buildPortfolioOptimizer"),
    lineShop:         require("../pipeline/shared/buildLineShoppingIntelligence"),
    timing:           require("../pipeline/shared/buildMarketTimingIntelligence"),
    ledger:           require("../pipeline/shared/buildPersonalLedger"),
    featured:         require("../pipeline/shared/buildFeaturedPlays"),
  }
}

// ── routes ────────────────────────────────────────────────────────────────────

router.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

/**
 * Comprehensive sport+date snapshot for the workstation.
 * Returns everything needed to hydrate the main views in a single call.
 */
router.get("/state", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const key = `state:${sport}:${date}`
    const out = cached(key, () => {
      const mods = loadSharedModules()
      const pool = buildCandidatePool(sport, date)

      // Snapshot rows for line shopping/timing
      let snapshotRows = []
      try {
        const snap = readJsonSafe(path.join(__dirname, "..", `snapshot-${sport}.json`), null)
        snapshotRows = snap?.data?.rows || snap?.rows || []
      } catch (_) {}

      const bookState    = mods.lineShop.loadBookState ? mods.lineShop.loadBookState() : null
      const timingState  = mods.timing.loadTimingState ? mods.timing.loadTimingState() : null

      const lineShopping = snapshotRows.length
        ? mods.lineShop.buildLineShopping(snapshotRows, { sport, bookState })
        : null
      const timingResult = snapshotRows.length
        ? mods.timing.buildMarketTiming(snapshotRows, { lineShopping, timingState, bookState })
        : null

      const rawCandidates = pool.enrichedBest.length ? pool.enrichedBest : pool.eligibleBets
      // Diversify before downstream views — caps repeats per player/game so the
      // workstation isn't dominated by 17 Donovan Mitchell legs.
      const candidates = diversifyCandidates(rawCandidates, { maxPerPlayer: 3, maxPerGame: 7 })

      // Portfolio analysis runs against the diversified candidate pool only.
      // Persisted slip catalog is intentionally NOT merged in — those are
      // engine-generated slip suggestions, not the user's actual portfolio,
      // and including them inflates exposure 3-5x and produces noisy warnings.
      const portfolio = mods.portfolio.optimizePortfolio({
        bets: candidates,
        slipBets: [],
        timingResult,
        bookState,
      })

      const aiCandidatesRaw = [...pool.eligibleBets, ...pool.enrichedBest]
      const aiCandidates = diversifyCandidates(aiCandidatesRaw, { maxPerPlayer: 3, maxPerGame: 7 })
      let ledgerState = null
      try { ledgerState = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null } catch (_) {}
      const aiSlips = mods.slipAi.buildAiSlips({
        candidates: aiCandidates,
        timingResult,
        bookState,
        ledgerState,
        portfolioBaseline: { bets: candidates },
        options: { sport, date, maxPerTier: 4 },
      })

      // FEATURED — curated trust anchor (5–15 plays across themed buckets).
      const featured = mods.featured.buildFeaturedPlays({
        candidates: aiCandidates,
        timingResult,
        lineShopping,
        bookState,
        ledgerState,
        sport,
        date,
      })

      // Compact urgent + best-edge for the dashboard
      const urgent = (timingResult?.timingClassifications || [])
        .filter((tc) => tc.urgency === "immediate" || tc.state === "stale_window")
        .slice(0, 25)

      // Bankroll info from tracked_best metadata
      const bankrollInfo = pool.trackedBest?.metadata
        ? { bankroll: pool.trackedBest.metadata.bankroll, dailyRiskBudget: pool.trackedBest.metadata.dailyRiskBudget }
        : null

      // Counts for header
      const counts = {
        candidates:      candidates.length,
        urgent:          urgent.length,
        propsWithMultiBook: lineShopping?.meta?.propsWithMultiBook ?? 0,
        steam:           timingResult?.meta?.steamCount ?? 0,
        stale:           timingResult?.meta?.staleCount ?? 0,
      }

      return {
        sport,
        date,
        counts,
        bankrollInfo,
        candidates,
        slipBets: readJsonSafe(fileFor(sport, "tracked_slips", date), []) || [],
        lineShopping: compactLineShopping(lineShopping, 60),
        timing: compactTiming(timingResult, 60),
        portfolio: compactPortfolio(portfolio),
        aiSlips: aiSlips.slips || { safe: [], balanced: [], aggressive: [], lotto: [] },
        aiSlipsSummary: { summary: aiSlips.summary, warnings: aiSlips.warnings },
        featured,
      }
    })
    res.json(out)
  } catch (err) {
    console.error("[ws/state]", err)
    res.status(500).json({ error: String(err?.message || err) })
  }
})

/** AI Slips only (full payload). */
router.get("/ai-slips", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const mods = loadSharedModules()
    const pool = buildCandidatePool(sport, date)
    const rawCandidates = [...pool.eligibleBets, ...pool.enrichedBest]
    const candidates = diversifyCandidates(rawCandidates, { maxPerPlayer: 4, maxPerGame: 8 })
    let ledgerState = null
    try { ledgerState = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null } catch (_) {}
    const result = mods.slipAi.buildAiSlips({
      candidates,
      ledgerState,
      portfolioBaseline: { bets: pool.enrichedBest.length ? pool.enrichedBest : pool.eligibleBets },
      options: { sport, date, maxPerTier: 5 },
    })
    res.json({ sport, date, ...result })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/**
 * Featured plays — the workstation trust anchor.
 * Themed buckets: tonight's best, HRs, ladders, smart aggression, safest,
 * best CLV, market agreement, timing windows, best books.
 */
router.get("/featured", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const key = `featured:${sport}:${date}`
    const out = cached(key, () => {
      const mods = loadSharedModules()
      const pool = buildCandidatePool(sport, date)
      const rawCandidates = [...pool.eligibleBets, ...pool.enrichedBest]
      const candidates = diversifyCandidates(rawCandidates, { maxPerPlayer: 4, maxPerGame: 8 })

      let snapshotRows = []
      try {
        const snap = readJsonSafe(path.join(__dirname, "..", `snapshot-${sport}.json`), null)
        snapshotRows = snap?.data?.rows || snap?.rows || []
      } catch (_) {}
      const bookState   = mods.lineShop.loadBookState   ? mods.lineShop.loadBookState()   : null
      const timingState = mods.timing.loadTimingState   ? mods.timing.loadTimingState()   : null
      const lineShopping = snapshotRows.length
        ? mods.lineShop.buildLineShopping(snapshotRows, { sport, bookState })
        : null
      const timingResult = snapshotRows.length
        ? mods.timing.buildMarketTiming(snapshotRows, { lineShopping, timingState, bookState })
        : null
      let ledgerState = null
      try { ledgerState = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null } catch (_) {}
      return mods.featured.buildFeaturedPlays({
        candidates, timingResult, lineShopping, bookState, ledgerState, sport, date,
      })
    })
    res.json(out)
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** Line shopping detail. */
router.get("/line-shopping", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 80))
    const key = `lineshop:${sport}:${date}:${limit}`
    const out = cached(key, () => {
      const mods = loadSharedModules()
      const snap = readJsonSafe(path.join(__dirname, "..", `snapshot-${sport}.json`), null)
      const rows = snap?.data?.rows || snap?.rows || []
      if (!rows.length) return { sport, date, groups: [], meta: {} }
      const bookState = mods.lineShop.loadBookState ? mods.lineShop.loadBookState() : null
      const ls = mods.lineShop.buildLineShopping(rows, { sport, bookState })
      const compacted = compactLineShopping(ls, limit)
      return {
        sport, date,
        groups: compacted?.groups || [],
        meta:   ls.meta || {},
        ladders: [],
      }
    })
    res.json(out)
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** Timing detail. */
router.get("/timing", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const urgency = String(req.query.urgency || "").toLowerCase() || null
    const mods = loadSharedModules()
    const snap = readJsonSafe(path.join(__dirname, "..", `snapshot-${sport}.json`), null)
    const rows = snap?.data?.rows || snap?.rows || []
    if (!rows.length) return res.json({ sport, date, classifications: [], meta: {} })
    const bookState   = mods.lineShop.loadBookState ? mods.lineShop.loadBookState() : null
    const timingState = mods.timing.loadTimingState ? mods.timing.loadTimingState() : null
    const lineShopping = mods.lineShop.buildLineShopping(rows, { sport, bookState })
    const result = mods.timing.buildMarketTiming(rows, { lineShopping, timingState, bookState })
    let classifications = result.timingClassifications || []
    if (urgency) classifications = classifications.filter((c) => c.urgency === urgency || c.state === urgency)
    res.json({ sport, date, classifications: classifications.slice(0, 200), meta: result.meta || {} })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** Portfolio detail. */
router.get("/portfolio", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    const mods = loadSharedModules()
    const pool = buildCandidatePool(sport, date)
    const rawCandidates = pool.enrichedBest.length ? pool.enrichedBest : pool.eligibleBets
    const candidates = diversifyCandidates(rawCandidates, { maxPerPlayer: 3, maxPerGame: 7 })
    const bookState = mods.lineShop.loadBookState ? mods.lineShop.loadBookState() : null
    // slipBets intentionally omitted — see /state for rationale
    const result = mods.portfolio.optimizePortfolio({ bets: candidates, slipBets: [], bookState })
    res.json({ sport, date, ...result })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** Ledger summary. */
router.get("/ledger", (req, res) => {
  try {
    const windowDays = Math.min(180, Math.max(1, Number(req.query.windowDays) || 30))
    const mods = loadSharedModules()
    const sport = req.query.sport ? String(req.query.sport).toLowerCase() : null
    const report = mods.ledger.buildNightlyReport
      ? mods.ledger.buildNightlyReport({ sport, windowDays })
      : null
    const ledger = mods.ledger.loadLedger ? mods.ledger.loadLedger() : null
    const recent = (ledger?.bets || []).slice(-50).reverse()
    res.json({ windowDays, report, recent, totals: ledger?.totals || null, bankroll: ledger?.bankroll || null })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/** First basket (NBA-only, gracefully empty otherwise). */
router.get("/first-basket", (req, res) => {
  try {
    const { sport, date } = resolveSportDate(req)
    if (sport !== "nba") return res.json({ sport, date, supported: false, plays: [] })
    const pool = buildCandidatePool(sport, date)
    const fbBets = (pool.trackedBets || []).filter(
      (b) => String(b.statFamily || "").toLowerCase().includes("firstbasket") ||
             String(b.statFamily || "").toLowerCase() === "first_basket"
    )
    res.json({ sport, date, supported: true, plays: fbBets.slice(0, 100) })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

/**
 * Bet builder live preview.
 * POST { legs: [{ player, statFamily, side, line, odds, eventId, sportsbook, modelProb }, ...] }
 * Returns combined odds, payout estimate, exposure warnings, correlation flags.
 */
router.post("/bet-builder/preview", express.json(), (req, res) => {
  try {
    const legs = Array.isArray(req.body?.legs) ? req.body.legs : []
    const stake = Number(req.body?.stake) > 0 ? Number(req.body.stake) : 10
    if (!legs.length) return res.json({ legs: 0, summary: "Add legs to preview." })

    function americanToDecimal(o) {
      const n = Number(o); if (!Number.isFinite(n) || n === 0) return null
      return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)
    }
    function decimalToAmerican(d) {
      if (!Number.isFinite(d) || d <= 1) return null
      return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1))
    }

    let dec = 1
    let modelProb = 1
    for (const l of legs) {
      const d = americanToDecimal(l.odds)
      if (!Number.isFinite(d)) return res.status(400).json({ error: "Invalid odds on a leg" })
      dec *= d
      const mp = Number(l.modelProb)
      modelProb *= Number.isFinite(mp) && mp > 0 ? Math.min(0.999, Math.max(0.001, mp)) : 0.5
    }
    const americanCombined = decimalToAmerican(dec)
    const impliedCombined = 1 / dec
    const edge = modelProb - impliedCombined
    const ev   = (modelProb * (dec - 1)) - (1 - modelProb)
    const payout = stake * dec

    // Run portfolio analysis on the legs themselves
    const mods = loadSharedModules()
    const portfolio = mods.portfolio.optimizePortfolio({
      bets: legs.map((l) => ({
        player: l.player, team: l.team, statFamily: l.statFamily, side: l.side,
        line: l.line, odds: l.odds, eventId: l.eventId, matchup: l.matchup,
        sportsbook: l.sportsbook,
      })),
    })

    res.json({
      legs: legs.length,
      combinedDecimal: Math.round(dec * 1000) / 1000,
      combinedAmerican: americanCombined,
      modelProb: Math.round(modelProb * 10000) / 10000,
      impliedProb: Math.round(impliedCombined * 10000) / 10000,
      edge: Math.round(edge * 10000) / 10000,
      ev: Math.round(ev * 10000) / 10000,
      payout: Math.round(payout * 100) / 100,
      stake,
      portfolioScore: portfolio.score,
      portfolioGrade: portfolio.grade,
      warnings: portfolio.warnings,
      conflicts: portfolio.conflicts,
      correlations: (portfolio.correlations?.clusters || []).slice(0, 5),
    })
  } catch (err) { res.status(500).json({ error: String(err?.message || err) }) }
})

// ── compactors (drop heavy fields for transit) ───────────────────────────────

function compactLineShopping(ls, max = 60) {
  if (!ls) return null
  // Rank by IMPLIED-PROBABILITY spread, not raw American odds spread.
  //
  // American odds are a non-linear scale: a +16000 vs +4900 prop has a raw
  // spread of 11100 but represents only ~1.4% implied probability — vs
  // +110 vs -120 with a raw spread of just 230 representing ~7% implied
  // probability (5x more actionable). Sorting by raw spread caused the
  // line-shopping board to be dominated by novelty +10000+ longshots
  // (HR over 1.5, hits over 3.5) where book-to-book deltas are mathematical
  // noise, not bettable edge.
  //
  // We also drop novelty markets where consensus implied probability is
  // below ~9% (consensus odds worse than +1000) — those are not actionable
  // shopping opportunities, just lottery-ticket prices.
  function impliedFromAmerican(o) {
    const n = Number(o)
    if (!Number.isFinite(n) || n === 0) return null
    return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
  }
  const NOVELTY_IMPL_FLOOR = 0.09 // ~ +1000

  const source = (ls.byProp || []).slice()
  // Pre-compute spreads for each entry
  const enriched = source.map((g) => {
    const bestImp  = impliedFromAmerican(g.bestOdds)
    const worstImp = impliedFromAmerican(g.worstOdds)
    const consImp  = impliedFromAmerican(g.consensus)
    const impSpread = (bestImp != null && worstImp != null) ? Math.abs(bestImp - worstImp) : null
    const oddsSpread = Number.isFinite(Number(g.bestOdds)) && Number.isFinite(Number(g.worstOdds))
      ? Math.abs(Number(g.bestOdds) - Number(g.worstOdds)) : null
    return { g, impSpread, oddsSpread, consImp }
  })
  // Filter out novelty longshots
  const filtered = enriched.filter((x) => {
    if (x.consImp != null && x.consImp < NOVELTY_IMPL_FLOOR) return false
    return true
  })
  // Sort by implied-prob spread DESC (largest actionable delta first), then
  // by bookCount as a tie-breaker (more books = more confidence).
  filtered.sort((a, b) => {
    const sa = a.impSpread ?? 0
    const sb = b.impSpread ?? 0
    if (sb !== sa) return sb - sa
    return (b.g.bookCount || 0) - (a.g.bookCount || 0)
  })
  const groups = filtered.slice(0, max).map(({ g, impSpread, oddsSpread }) => {
    const flags = []
    if (g.bookProfile?.avgClv > 0.015) flags.push("soft_book")
    if (Math.abs(g.bestImpDelta || 0) > 0.05) flags.push("market_disagreement")
    if (oddsSpread != null && oddsSpread > 80) flags.push("stale_line")
    return {
      propGroupKey: g.key,
      player:    g.player,
      team:      g.team,
      statFamily: String(g.propFamilyKey || g.propType || "").toLowerCase().replace(/[\s_]+/g, ""),
      side:      String(g.side || "").toLowerCase(),
      line:      g.line,
      bookCount: g.bookCount,
      bestBook:  g.bestBook,
      bestOdds:  g.bestOdds,
      worstBook: g.worstBook,
      worstOdds: g.worstOdds,
      consensusOdds: g.consensus,
      oddsSpread,                                         // raw American spread (display)
      impliedSpread: impSpread != null ? Math.round(impSpread * 10000) / 10000 : null,
      flags,
    }
  })
  return { groups, meta: ls.meta || {} }
}

function compactTiming(t, max = 60) {
  if (!t) return null
  const classifications = (t.timingClassifications || []).slice(0, max).map((c) => ({
    key:        c.key,
    player:     c.player,
    statFamily: c.statFamily,
    side:       c.side,
    line:       c.line,
    state:      c.state,
    urgency:    c.urgency,
    eventId:    c.eventId,
    bookCount:  c.bookCount,
    hoursToGame: c.hoursToGame,
  }))
  return { classifications, meta: t.meta || {} }
}

function compactPortfolio(p) {
  if (!p) return null
  return {
    score:          p.score,
    grade:          p.grade,
    mood:           p.mood,
    warnings:       p.warnings || [],
    correlations:   p.correlations,
    conflicts:      p.conflicts || [],
    exposureMap:    p.exposureMap,
    nudges:         p.nudges,
  }
}

module.exports = router
