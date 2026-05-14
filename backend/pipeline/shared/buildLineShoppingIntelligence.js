"use strict"

/**
 * Line Shopping + Sportsbook Intelligence System.
 *
 * Pure-function core — no API calls, no polling, no giant storage.
 * Works from the EXISTING normalized snapshot rows that are already produced
 * nightly by fetchNbaOddsSnapshot / buildMlbBootstrapSnapshot.
 *
 * Three layers:
 *
 *   1. LINE SHOPPING  — per-prop: best line, best odds, best book, consensus.
 *   2. BOOK PROFILE   — rolling: per-book CLV, ROI, stale-line frequency,
 *                       best stat families. Updated from ledger + CLV data.
 *   3. LADDER SHOPPING — which book has deepest/cheapest alt lines per stat.
 *
 * Storage: ONE compact rolling JSON at
 *   backend/runtime/tracking/book_intelligence_state.json
 * Same rolling-window pattern as the post-game review engine.
 *
 * Call from:
 *   - board build scripts (buildNbaOpportunityBoard, buildMlbOpportunityBoard)
 *     after snapshot rows are in memory — ZERO extra API calls.
 *   - scripts/ledger.js `shop` command for manual inspection.
 *   - nightly after results: updateBookStateFromLedger()
 */

const fs = require("fs")
const path = require("path")

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")
const STATE_FILE = path.join(TRACKING_DIR, "book_intelligence_state.json")
const MAX_HISTORY_DAYS = 60
const STALE_THRESHOLD = 0.025       // book implied prob 2.5¢ worse than consensus = stale
const MIN_BOOK_SAMPLE = 5           // need ≥5 bets before surfacing book profile conclusions

// ─── helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(p, fb = null) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fb } catch (_) { return fb }
}
function writeJsonSync(p, d) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d)); return true } catch (_) { return false }
}
function num(v) { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
function r4(x) { return Math.round(Number(x) * 10000) / 10000 }
function r2(x) { return Math.round(Number(x) * 100) / 100 }
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` }

function impliedFromAmerican(a) {
  const n = num(a); if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}
function americanFromImplied(p) {
  const n = num(p); if (!Number.isFinite(n) || n <= 0 || n >= 1) return null
  return n > 0.5 ? Math.round(-n / (1 - n) * 100) : Math.round((1 - n) / n * 100)
}

// ─── canonical book names ─────────────────────────────────────────────────────

const BOOK_ALIASES = {
  draftkings: "DraftKings", dk: "DraftKings",
  fanduel: "FanDuel", fd: "FanDuel",
  bet365: "Bet365",
  caesars: "Caesars", williamhill: "Caesars",
  fanatics: "Fanatics",
  betrivers: "BetRivers",
  hardrock: "Hard Rock", hardrock_bet: "Hard Rock",
  "betonline.ag": "BetOnline", betonline: "BetOnline",
  betmgm: "BetMGM",
  pointsbet: "PointsBet",
  fliff: "Fliff",
  espnbet: "ESPN Bet",
  bally: "Bally Bet",
}
function canonicalBook(raw) {
  if (!raw) return null
  const k = String(raw).toLowerCase().replace(/[\s_-]/g, "")
  return BOOK_ALIASES[k] || String(raw).trim()
}

// ─── LAYER 1: LINE SHOPPING ───────────────────────────────────────────────────

/**
 * Grouping key: same prop across books.
 * We group on player + propFamilyKey + side + line so the "same bet"
 * at different books is comparable. Alt/ladder lines kept separate.
 */
function propGroupKey(row) {
  return [
    String(row.eventId || ""),
    String(row.player || "").toLowerCase().trim(),
    String(row.propFamilyKey || row.propType || "").toLowerCase(),
    String(row.side || "").toLowerCase(),
    String(row.line ?? "any"),
  ].join("|")
}

/**
 * Build line-shopping comparison for every unique prop across sportsbooks.
 *
 * @param {Array}  rows — normalized snapshot rows (from snapshot.data.rows or completeUniverse).
 *                        Must have: book, player, eventId, propFamilyKey, side, line, odds.
 * @param {object} opts
 * @param {string} opts.sport          For labelling only.
 * @param {object} opts.bookState      Optional rolling book state (for profile annotations).
 * @returns { byProp, bestByProp, staleRows, consensus, meta }
 */
function buildLineShopping(rows = [], { sport = "unknown", bookState = null } = {}) {
  const playerProps = rows.filter((r) =>
    r && r.player && r.book && r.eventId &&
    (r.line != null || r.marketFamily === "ladder") &&
    Number.isFinite(num(r.odds)) &&
    r.marketFamily !== "game"   // exclude moneyline / game totals
  )

  // Group by prop
  const groups = new Map()
  for (const row of playerProps) {
    const k = propGroupKey(row)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(row)
  }

  const bestByProp = []
  const staleRows = []
  const byProp = []

  for (const [key, bookRows] of groups) {
    if (bookRows.length < 1) continue
    const rep = bookRows[0]

    // Compute per-row implied prob
    const withImp = bookRows.map((r) => {
      const imp = num(r.impliedProbability) ?? impliedFromAmerican(r.odds)
      return { ...r, _imp: imp, _book: canonicalBook(r.book) }
    }).filter((r) => Number.isFinite(r._imp))

    if (!withImp.length) continue

    // Consensus: use existing consensusImpliedProbability if present, else average
    const existingConsensus = num(withImp[0]?.consensusImpliedProbability)
    const avgImp = withImp.reduce((s, r) => s + r._imp, 0) / withImp.length
    const consensus = existingConsensus ?? r4(avgImp)

    // Best odds: highest American odds for same line (= best price for bettor)
    const bestOddsRow = withImp.sort((a, b) => num(b.odds) - num(a.odds))[0]
    const worstOddsRow = withImp.sort((a, b) => num(a.odds) - num(b.odds))[0]

    // Stale detection: book offered implied prob that diverges from consensus
    const staleThreshold = STALE_THRESHOLD
    for (const r of withImp) {
      const delta = num(r.bookVsConsensusDelta) ?? r4(r._imp - consensus)
      if (Math.abs(delta) > staleThreshold) {
        const isStale = r._imp > consensus + staleThreshold  // book overprices = stale (offers worse odds)
        const isSoft = r._imp < consensus - staleThreshold   // book underprices = soft (bettor value)
        if (isStale || isSoft) {
          staleRows.push({
            eventId: r.eventId,
            player: r.player,
            prop: `${r.propType} ${r.side} ${r.line}`,
            book: r._book,
            odds: r.odds,
            impliedProb: r._imp,
            consensus,
            delta: r4(r._imp - consensus),
            tag: isSoft ? "soft_line" : "stale_line",
            dispersion: num(r.bookImpliedDispersion),
          })
        }
      }
    }

    // Edge vs consensus: best book's delta from consensus (negative delta = better odds for bettor)
    const bestImpDelta = r4((bestOddsRow._imp ?? consensus) - consensus)
    const lineDelta = null   // only meaningful when comparing across different lines (ladder section)

    // Phase Market-Ecology-1A (OBS-2): consensusConfidence derived metric.
    // Formula: clamp(0, 1, 1 - (marketDispersion / max(consensus, 0.001))).
    // Interpretation: 1.0 = books unanimous; 0.0 = wide disagreement.
    // Pure-derived from existing fields (consensus + marketDispersion). No
    // behavior change — additive output field only. Surfaced on every byProp
    // entry AND every bestByProp entry so downstream operators can rank by
    // disagreement-resolution clarity without re-computing the dispersion.
    const dispersion = num(withImp[0]?.bookImpliedDispersion) ?? r4(
      Math.sqrt(withImp.reduce((s, r) => s + (r._imp - avgImp) ** 2, 0) / withImp.length)
    )
    const consensusConfidence = r4(Math.max(0, Math.min(1, 1 - (dispersion / Math.max(consensus, 0.001)))))

    const entry = {
      key,
      eventId: rep.eventId,
      matchup: rep.matchup || null,
      player: rep.player,
      team: rep.team || null,
      propFamilyKey: rep.propFamilyKey || rep.propType,
      propType: rep.propType,
      side: rep.side,
      line: rep.line,
      // Best value
      bestBook: bestOddsRow._book,
      bestOdds: bestOddsRow.odds,
      bestImpliedProb: r4(bestOddsRow._imp),
      // Worst value
      worstBook: worstOddsRow._book,
      worstOdds: worstOddsRow.odds,
      // Market context
      consensus,
      bookCount: withImp.length,
      books: withImp.map((r) => ({ book: r._book, odds: r.odds, imp: r4(r._imp) })),
      bestImpDelta,    // negative = better for bettor than consensus
      marketDispersion: dispersion,
      consensusConfidence,   // Phase Market-Ecology-1A (OBS-2) — see comment above
      // Book profile annotation (if rolling state available)
      bookProfile: bookState ? annotateBookProfile(bestOddsRow._book, rep.propFamilyKey, bookState) : null,
    }
    byProp.push(entry)

    if (entry.bookCount >= 2) {
      bestByProp.push({
        player: entry.player,
        matchup: entry.matchup,
        prop: `${entry.propType} ${entry.side} ${entry.line}`,
        bestBook: entry.bestBook,
        bestOdds: entry.bestOdds,
        worstBook: entry.worstBook,
        worstOdds: entry.worstOdds,
        oddsSpread: entry.bestOdds != null && entry.worstOdds != null
          ? entry.bestOdds - entry.worstOdds : null,
        consensus,
        bestImpDelta,
        bookCount: entry.bookCount,
        consensusConfidence,   // Phase Market-Ecology-1A (OBS-2)
      })
    }
  }

  // Sort best plays by oddsSpread (biggest difference = most value to shop)
  bestByProp.sort((a, b) => Math.abs(b.oddsSpread ?? 0) - Math.abs(a.oddsSpread ?? 0))
  staleRows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return {
    byProp,
    bestByProp: bestByProp.slice(0, 50),
    staleRows: staleRows.slice(0, 30),
    meta: {
      sport,
      generatedAt: new Date().toISOString(),
      totalProps: groups.size,
      propsWithMultiBook: bestByProp.length,
      staleDetected: staleRows.length,
    },
  }
}

// ─── LAYER 2: LADDER / ALT LINE SHOPPING ─────────────────────────────────────

/**
 * Find which books offer the deepest / cheapest alt lines for a stat family.
 * Groups by player + stat without pinning to a specific line.
 */
function buildLadderShopping(rows = []) {
  const altRows = rows.filter((r) =>
    r && r.player && r.book && r.eventId &&
    Number.isFinite(num(r.odds)) &&
    (r.marketFamily === "ladder" || String(r.propType || "").includes("Ladder") ||
     String(r.marketKey || "").includes("alternate"))
  )

  // Group: player + stat + eventId (ladder rung comparison across books)
  const ladderGroups = new Map()
  for (const r of altRows) {
    const k = [
      r.eventId,
      String(r.player || "").toLowerCase(),
      String(r.propFamilyKey || r.propType || "").toLowerCase().replace(" ladder", ""),
      String(r.side || "").toLowerCase(),
    ].join("|")
    if (!ladderGroups.has(k)) ladderGroups.set(k, [])
    ladderGroups.get(k).push(r)
  }

  const ladderComparisons = []
  for (const [key, lrows] of ladderGroups) {
    if (lrows.length < 2) continue
    const byBook = new Map()
    for (const r of lrows) {
      const bk = canonicalBook(r.book)
      if (!byBook.has(bk)) byBook.set(bk, [])
      byBook.get(bk).push({ line: num(r.line), odds: num(r.odds) })
    }

    // Depth = number of alt rungs available
    const bookDepths = []
    for (const [book, rungs] of byBook) {
      const validRungs = rungs.filter((rg) => rg.line != null && rg.odds != null)
        .sort((a, b) => a.line - b.line)
      bookDepths.push({ book, depth: validRungs.length, rungs: validRungs })
    }
    bookDepths.sort((a, b) => b.depth - a.depth)

    const rep = lrows[0]
    ladderComparisons.push({
      eventId: rep.eventId,
      player: rep.player,
      statFamily: String(rep.propFamilyKey || "").replace(" ladder", ""),
      side: rep.side,
      books: bookDepths,
      deepestBook: bookDepths[0]?.book,
      deepestRungs: bookDepths[0]?.depth,
    })
  }

  ladderComparisons.sort((a, b) => b.deepestRungs - a.deepestRungs)

  // Aggregate: which book has the best ladder depth by stat?
  const bookLadderProfile = {}
  for (const lc of ladderComparisons) {
    for (const bd of lc.books) {
      const bk = bd.book
      const fam = lc.statFamily
      if (!bookLadderProfile[bk]) bookLadderProfile[bk] = {}
      if (!bookLadderProfile[bk][fam]) bookLadderProfile[bk][fam] = { totalDepth: 0, count: 0 }
      bookLadderProfile[bk][fam].totalDepth += bd.depth
      bookLadderProfile[bk][fam].count += 1
      bookLadderProfile[bk][fam].avgDepth = r4(bookLadderProfile[bk][fam].totalDepth / bookLadderProfile[bk][fam].count)
    }
  }

  return { ladderComparisons: ladderComparisons.slice(0, 40), bookLadderProfile }
}

// ─── LAYER 3: BOOK INTELLIGENCE STATE ────────────────────────────────────────

function emptyBookState() {
  return {
    version: "book-intel-v1",
    updatedAt: null,
    books: {},
    bookLadderProfiles: {},  // sport → book → stat → depth stats
  }
}

function emptyBookProfile() {
  return {
    totalBets: 0, settled: 0, wins: 0,
    totalStaked: 0, totalProfit: 0, roi: null,
    clvCount: 0, clvSum: 0, avgClv: null,
    staleDetectedCount: 0, softDetectedCount: 0,
    byStat: {},
  }
}

function emptyBookStatProfile() {
  return { bets: 0, wins: 0, staked: 0, profit: 0, roi: null, clvCount: 0, clvSum: 0, avgClv: null }
}

/**
 * Update rolling book intelligence from ledger bet array.
 * Call nightly after results are in.
 *
 * @param {Array}  ledgerBets  — from loadLedger().bets
 * @param {object} existingState — from loadBookState()
 * @param {string} date — YYYY-MM-DD for staleness pruning
 */
function updateBookStateFromLedger(ledgerBets = [], existingState = null, date = todayKey()) {
  const state = existingState || emptyBookState()
  if (!Array.isArray(ledgerBets)) return state

  const settled = ledgerBets.filter((b) => b.result && b.result !== "pending")

  for (const bet of settled) {
    const bookRaw = bet.sportsbook
    if (!bookRaw) continue
    const book = canonicalBook(bookRaw)
    if (!state.books[book]) state.books[book] = emptyBookProfile()
    const bp = state.books[book]

    const stake = num(bet.stake) ?? 0
    const toWin = num(bet.toWin) ?? 0
    const payout = num(bet.payout ?? null)
    const r = bet.result
    const profit = r === "win" ? (Number.isFinite(payout) ? payout - stake : toWin) : r === "loss" ? -stake : 0

    bp.totalBets++
    bp.settled++
    if (r === "win") bp.wins++
    bp.totalStaked = r2(bp.totalStaked + stake)
    bp.totalProfit = r2(bp.totalProfit + profit)
    bp.roi = bp.settled > 0 && bp.totalStaked > 0 ? r4(bp.totalProfit / bp.totalStaked) : null

    // CLV
    const clvScore = num(bet.clvSnapshot?.clv?.clvScore)
    if (clvScore != null) {
      bp.clvCount++
      bp.clvSum = r4(bp.clvSum + clvScore)
      bp.avgClv = r4(bp.clvSum / bp.clvCount)
    }

    // By stat
    const fam = bet.statFamily
    if (fam) {
      if (!bp.byStat[fam]) bp.byStat[fam] = emptyBookStatProfile()
      const bs = bp.byStat[fam]
      bs.bets++; if (r === "win") bs.wins++
      bs.staked = r2(bs.staked + stake)
      bs.profit = r2(bs.profit + profit)
      bs.roi = bs.bets > 0 && bs.staked > 0 ? r4(bs.profit / bs.staked) : null
      if (clvScore != null) { bs.clvCount++; bs.clvSum = r4(bs.clvSum + clvScore); bs.avgClv = r4(bs.clvSum / bs.clvCount) }
    }
  }

  state.updatedAt = new Date().toISOString()
  return state
}

/**
 * Update rolling ladder depth profiles from a nightly line-shopping pass.
 */
function updateLadderProfilesInState(state, ladderResult, { sport = "nba", date = todayKey() } = {}) {
  if (!state) state = emptyBookState()
  if (!state.bookLadderProfiles) state.bookLadderProfiles = {}
  if (!state.bookLadderProfiles[sport]) state.bookLadderProfiles[sport] = {}
  const sportProfiles = state.bookLadderProfiles[sport]

  for (const [book, statMap] of Object.entries(ladderResult.bookLadderProfile || {})) {
    if (!sportProfiles[book]) sportProfiles[book] = {}
    for (const [fam, data] of Object.entries(statMap)) {
      if (!sportProfiles[book][fam]) sportProfiles[book][fam] = { runningAvgDepth: data.avgDepth, samples: 1, lastDate: date }
      else {
        const prev = sportProfiles[book][fam]
        const n = prev.samples + 1
        prev.runningAvgDepth = r4((prev.runningAvgDepth * prev.samples + data.avgDepth) / n)
        prev.samples = Math.min(n, MAX_HISTORY_DAYS)   // cap rolling window
        prev.lastDate = date
      }
    }
  }
  return state
}

// ─── book profile annotation (for line shopping output) ───────────────────────

function annotateBookProfile(book, statFamily, bookState) {
  if (!book || !bookState?.books?.[book]) return null
  const bp = bookState.books[book]
  const bs = bp.byStat?.[statFamily]
  return {
    avgClv: bp.avgClv,
    roi: bp.roi,
    totalBets: bp.totalBets,
    statRoi: bs?.roi ?? null,
    statAvgClv: bs?.avgClv ?? null,
    confidence: bp.settled >= MIN_BOOK_SAMPLE ? "established" : "limited_sample",
  }
}

// ─── persistence helpers ──────────────────────────────────────────────────────

function loadBookState() {
  return readJsonSafe(STATE_FILE, null) || emptyBookState()
}
function saveBookState(state) {
  return writeJsonSync(STATE_FILE, state)
}

// ─── NIGHTLY REPORT ──────────────────────────────────────────────────────────

/**
 * Generate a compact nightly book intelligence report.
 *
 * @param {object} lineShopResult — from buildLineShopping()
 * @param {object} ladderResult   — from buildLadderShopping()
 * @param {object} bookState      — from loadBookState()
 * @param {Array}  ledgerBets     — for CLV-by-book breakdown
 */
function buildNightlyBookReport({ lineShopResult, ladderResult, bookState, ledgerBets = [] } = {}) {
  const state = bookState || loadBookState()

  // Top line-shopping opportunities
  const topShops = (lineShopResult?.bestByProp || []).slice(0, 10)

  // Stale books
  const stale = (lineShopResult?.staleRows || []).slice(0, 10)

  // Book profiles sorted by avg CLV
  const bookProfiles = Object.entries(state.books || {})
    .filter(([, bp]) => bp.settled >= MIN_BOOK_SAMPLE)
    .map(([book, bp]) => ({ book, avgClv: bp.avgClv, roi: bp.roi, settled: bp.settled, wins: bp.wins }))
    .sort((a, b) => (b.avgClv ?? -Infinity) - (a.avgClv ?? -Infinity))

  // Best ladder books
  const ladderSummary = {}
  for (const [book, statMap] of Object.entries(state.bookLadderProfiles?.nba || {})) {
    for (const [fam, data] of Object.entries(statMap)) {
      if (!ladderSummary[fam]) ladderSummary[fam] = []
      ladderSummary[fam].push({ book, avgDepth: data.runningAvgDepth, samples: data.samples })
    }
  }
  for (const fam of Object.keys(ladderSummary)) {
    ladderSummary[fam].sort((a, b) => b.avgDepth - a.avgDepth)
  }

  // Tonight's CLV by book from ledger
  const clvByBook = {}
  for (const b of ledgerBets) {
    const bk = canonicalBook(b.sportsbook)
    if (!bk) continue
    const clv = num(b.clvSnapshot?.clv?.clvScore)
    if (!clvByBook[bk]) clvByBook[bk] = { count: 0, sum: 0 }
    if (clv != null) { clvByBook[bk].count++; clvByBook[bk].sum += clv }
  }
  const clvByBookSorted = Object.entries(clvByBook)
    .filter(([, v]) => v.count > 0)
    .map(([book, v]) => ({ book, avgClv: r4(v.sum / v.count), avgClvPct: r2(v.sum / v.count * 100), count: v.count }))
    .sort((a, b) => b.avgClv - a.avgClv)

  return {
    generatedAt: new Date().toISOString(),
    topLineShopping: topShops,
    staleBooks: stale,
    bookProfiles: bookProfiles.slice(0, 10),
    clvByBook: clvByBookSorted,
    ladderProfiles: ladderSummary,
    meta: lineShopResult?.meta || {},
  }
}

module.exports = {
  buildLineShopping,
  buildLadderShopping,
  updateBookStateFromLedger,
  updateLadderProfilesInState,
  buildNightlyBookReport,
  loadBookState,
  saveBookState,
  canonicalBook,
  STATE_FILE,
}
