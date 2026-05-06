"use strict"

/**
 * Portfolio Optimization + Exposure Intelligence.
 *
 * Sits ON TOP of the existing bankroll engine — never duplicates it.
 * The bankroll engine controls HOW MUCH per bet (Kelly + tier caps).
 * This engine controls HOW bets FIT TOGETHER across the full portfolio.
 *
 * Layers:
 *   1. EXPOSURE MAP      — player / team / game / stat / book / game-script
 *   2. CORRELATION        — detect clustered risk (same game, same stat, same script)
 *   3. VOLATILITY         — classify each bet: safe / balanced / aggressive / lotto
 *   4. SIZING NUDGES      — multipliers to pass back to the bankroll engine
 *                           (soft guidance, never hard override)
 *   5. CONFLICT DETECTION — contradictory directions, usage collisions
 *   6. PORTFOLIO SCORE    — 0–100 composite health score
 *   7. NIGHTLY REPORT     — warnings, diversification grade, sizing notes
 *
 * Usage:
 *   const result = optimizePortfolio({ bets, slipBets, timingResult, bookState })
 *   result.report   → human-readable section
 *   result.nudges   → { [betId]: sizingMultiplier }  (0.5 – 1.5)
 *   result.warnings → array of warning strings
 *   result.score    → 0–100
 */

// ── helpers ───────────────────────────────────────────────────────────────────

function num(v)  { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
function r2(x)   { return Math.round(Number(x) * 100) / 100 }
function r4(x)   { return Math.round(Number(x) * 10000) / 10000 }
function clamp(lo, hi, x) { return Math.max(lo, Math.min(hi, Number(x))) }

function normFam(v) {
  return String(v || "").toLowerCase().replace(/[\s_]+/g, "")
}
function betId(b) {
  return b.id || [b.player, b.statFamily || b.propType, b.side, b.line, b.book || b.sportsbook].join("|")
}
function gameKey(b) {
  // Prefer eventId, fallback to matchup text normalised
  if (b.eventId) return String(b.eventId)
  if (b.matchup) return String(b.matchup).toLowerCase().replace(/[^a-z0-9]/g, "")
  return null
}

// ── VOLATILITY CLASSIFICATION ─────────────────────────────────────────────────

const VOLATILITY_RULES = [
  // lotto first (high odds or inherently rare)
  { bucket: "lotto",      test: (b) => (num(b.odds || b.oddsAmerican) ?? 0) >= 350 },
  { bucket: "lotto",      test: (b) => normFam(b.statFamily || b.propType).includes("firstbasket") },
  { bucket: "lotto",      test: (b) => ["homeruns","hr","homers"].includes(normFam(b.statFamily||b.propType)) && (b.line ?? 0) >= 1.5 },
  { bucket: "lotto",      test: (b) => normFam(b.statFamily||b.propType) === "totalbases" && (b.line ?? 0) >= 3.5 },
  { bucket: "lotto",      test: (b) => normFam(b.statFamily||b.propType).includes("threes") && (b.line ?? 0) >= 3.5 },
  // aggressive
  { bucket: "aggressive", test: (b) => ["homeruns","hr","homers"].includes(normFam(b.statFamily||b.propType)) },
  { bucket: "aggressive", test: (b) => (num(b.odds || b.oddsAmerican) ?? 0) >= 200 },
  { bucket: "aggressive", test: (b) => normFam(b.statFamily||b.propType).includes("xbh") },
  { bucket: "aggressive", test: (b) => normFam(b.statFamily||b.propType).includes("combo") || normFam(b.statFamily||b.propType) === "pra" },
  // balanced — hitter/game stats that were falling through to "safe":
  // inflated featured volRealism + barred AGGRESSIVE slip legs.
  { bucket: "balanced",   test: (b) => ["totalbases","assists","threes","rbis","hits","runs","points","rebounds","steals","blocks","doubles","triples","stolenbases","stolenbase"].includes(normFam(b.statFamily||b.propType)) },
  { bucket: "balanced",   test: (b) => {
    const f = normFam(b.statFamily||b.propType)
    return (f.includes("h+r+rbi") || f.includes("hrrbi")) && !f.includes("pitcher")
  } },
  { bucket: "balanced",   test: (b) => normFam(b.statFamily||b.propType).includes("pitcherk") || normFam(b.statFamily||b.propType).includes("strikeout") },
  // safe (default fallback)
  { bucket: "safe",       test: () => true },
]

function classifyVolatility(bet) {
  for (const rule of VOLATILITY_RULES) {
    if (rule.test(bet)) return rule.bucket
  }
  return "balanced"
}

// ── EXPOSURE MAP ──────────────────────────────────────────────────────────────

/**
 * Build exposure counts across all dimensions.
 * "Exposure" = number of bets touching that dimension.
 */
function buildExposureMap(bets = [], slipBets = []) {
  const map = {
    byPlayer:     {},   // player → count
    byTeam:       {},   // team → count
    byGame:       {},   // gameKey → { count, players[], stats[] }
    byStat:       {},   // normFam(statFamily) → count
    bySide:       {},   // "over" | "under" → count
    byBook:       {},   // sportsbook/book → count
    byVolatility: { safe: 0, balanced: 0, aggressive: 0, lotto: 0 },
    byTier:       {},
    totalSingles: bets.length,
    totalSlips:   slipBets.length,
    totalLegs:    slipBets.reduce((s, sl) => s + (sl.legCount || (sl.legs||[]).length || 0), 0),
  }

  const add = (obj, key, extra) => {
    if (!key) return
    if (!obj[key]) obj[key] = { count: 0, ...(extra || {}) }
    obj[key].count++
  }

  for (const b of bets) {
    add(map.byPlayer, b.player)
    add(map.byTeam, b.team || b.teamCode)
    const gk = gameKey(b)
    if (gk) {
      if (!map.byGame[gk]) map.byGame[gk] = { count: 0, matchup: b.matchup || gk, players: [], stats: [] }
      map.byGame[gk].count++
      if (b.player && !map.byGame[gk].players.includes(b.player)) map.byGame[gk].players.push(b.player)
      const fam = normFam(b.statFamily || b.propType)
      if (fam && !map.byGame[gk].stats.includes(fam)) map.byGame[gk].stats.push(fam)
    }
    add(map.byStat, normFam(b.statFamily || b.propType))
    add(map.bySide, String(b.side || "").toLowerCase())
    add(map.byBook, String(b.book || b.sportsbook || "unknown").toLowerCase())
    add(map.byTier, String(b.tier || b.confidenceTier || b.bucket || "?").toUpperCase())
    map.byVolatility[classifyVolatility(b)]++
  }

  // Include slip legs in game/stat exposure
  for (const sl of slipBets) {
    for (const leg of sl.legs || []) {
      add(map.byPlayer, leg.player)
      const fam = normFam(leg.statFamily || leg.propType)
      add(map.byStat, fam)
      add(map.bySide, String(leg.side || "").toLowerCase())
    }
  }

  return map
}

// ── CORRELATION DETECTION ─────────────────────────────────────────────────────

// Thresholds intentionally permissive — multiple prop ladders on a single player
// (eg Bichette H over/under 1.5 + TB over 1.5) is a normal portfolio shape, not a
// 5-alarm correlation. Real correlation risk is when a single archetype OR game
// dominates the portfolio.
const CORRELATION_THRESHOLDS = {
  sameGame:    { warn: 5, critical: 8 },   // bets on same game (was 3/5)
  samePlayer:  { warn: 5, critical: 8 },   // bets on same player (was 2/3 — way too tight)
  sameStat:    { warn: 8, critical: 14 },  // bets on same stat family (was 5/8)
  sameScript:  { warn: 4, critical: 6 },   // overs in same game (pace-linked)
  fbConcentration: { warn: 3, critical: 5 }, // first basket bets (was 2/3)
  hrConcentration: { warn: 5, critical: 8 }, // HR bets (was 3/5)
  slipLegOverlap:  { warn: 3, critical: 5 }, // same player across multiple slips (was 2/3)
}

/**
 * Classify correlation level: "low" | "moderate" | "high"
 */
function correlationLevel(count, warn, critical) {
  if (count >= critical) return "high"
  if (count >= warn)     return "moderate"
  return "low"
}

function detectCorrelations(bets = [], slipBets = [], exposureMap = {}) {
  const clusters   = []
  const clusterMap = {}   // key → cluster

  // ── same-game clusters ────────────────────────────────────────────────────
  for (const [gk, gv] of Object.entries(exposureMap.byGame || {})) {
    if (gv.count < 2) continue
    // Count overs vs unders in this game
    const gameBets  = bets.filter((b) => gameKey(b) === gk)
    const overs     = gameBets.filter((b) => String(b.side || "").toLowerCase() === "over").length
    const unders    = gameBets.filter((b) => String(b.side || "").toLowerCase() === "under").length
    const level     = correlationLevel(gv.count, CORRELATION_THRESHOLDS.sameGame.warn, CORRELATION_THRESHOLDS.sameGame.critical)
    const scriptRisk = overs >= CORRELATION_THRESHOLDS.sameScript.warn
    // Use matchup name if it looks like a real matchup ("TEAM vs TEAM"); otherwise
    // fall back to a generic label. Avoid showing raw eventId hashes to the user.
    const friendlyLabel = (gv.matchup && /[A-Za-z]/.test(gv.matchup) && gv.matchup.length < 30)
      ? gv.matchup
      : "this game"
    const cluster   = {
      type:     "same_game",
      key:      gk,
      label:    friendlyLabel,
      count:    gv.count,
      level,
      players:  gv.players.slice(0, 6),
      stats:    gv.stats.slice(0, 6),
      overs,
      unders,
      scriptRisk,
      note: scriptRisk
        ? `${overs} overs dependent on same game pace`
        : `${gv.count} bets tied to same game`,
    }
    clusters.push(cluster)
    clusterMap[`game:${gk}`] = cluster
  }

  // ── same-player clusters ──────────────────────────────────────────────────
  for (const [player, pv] of Object.entries(exposureMap.byPlayer || {})) {
    if (pv.count < CORRELATION_THRESHOLDS.samePlayer.warn) continue
    const level = correlationLevel(pv.count, CORRELATION_THRESHOLDS.samePlayer.warn, CORRELATION_THRESHOLDS.samePlayer.critical)
    clusters.push({
      type:  "same_player",
      key:   player,
      label: player,
      count: pv.count,
      level,
      note:  `${pv.count} bets on ${player} (including slips)`,
    })
  }

  // ── same-stat concentration ───────────────────────────────────────────────
  for (const [stat, sv] of Object.entries(exposureMap.byStat || {})) {
    if (sv.count < CORRELATION_THRESHOLDS.sameStat.warn) continue
    const level = correlationLevel(sv.count, CORRELATION_THRESHOLDS.sameStat.warn, CORRELATION_THRESHOLDS.sameStat.critical)
    clusters.push({
      type:  "stat_concentration",
      key:   stat,
      label: stat,
      count: sv.count,
      level,
      note:  `${sv.count} bets on ${stat} — concentrated exposure`,
    })
  }

  // ── first basket concentration ─────────────────────────────────────────────
  const fbCount = bets.filter((b) => normFam(b.statFamily||b.propType).includes("firstbasket")).length
  if (fbCount >= CORRELATION_THRESHOLDS.fbConcentration.warn) {
    const level = correlationLevel(fbCount, CORRELATION_THRESHOLDS.fbConcentration.warn, CORRELATION_THRESHOLDS.fbConcentration.critical)
    clusters.push({ type: "fb_concentration", key: "firstbasket", label: "First Basket", count: fbCount, level,
      note: `${fbCount} first basket bets — opening-possession correlated` })
  }

  // ── HR concentration ──────────────────────────────────────────────────────
  const hrCount = bets.filter((b) => ["homeruns","hr"].includes(normFam(b.statFamily||b.propType))).length
  if (hrCount >= CORRELATION_THRESHOLDS.hrConcentration.warn) {
    const level = correlationLevel(hrCount, CORRELATION_THRESHOLDS.hrConcentration.warn, CORRELATION_THRESHOLDS.hrConcentration.critical)
    clusters.push({ type: "hr_concentration", key: "hr", label: "HR", count: hrCount, level,
      note: `${hrCount} HR bets — weather/park correlated` })
  }

  // ── slip leg overlap ──────────────────────────────────────────────────────
  const slipPlayerCount = {}
  for (const sl of slipBets) {
    for (const leg of sl.legs || []) {
      if (leg.player) slipPlayerCount[leg.player] = (slipPlayerCount[leg.player] || 0) + 1
    }
  }
  for (const [player, count] of Object.entries(slipPlayerCount)) {
    if (count < CORRELATION_THRESHOLDS.slipLegOverlap.warn) continue
    const level = correlationLevel(count, CORRELATION_THRESHOLDS.slipLegOverlap.warn, CORRELATION_THRESHOLDS.slipLegOverlap.critical)
    clusters.push({ type: "slip_player_overlap", key: `slip:${player}`, label: player, count, level,
      note: `${player} appears in ${count} slip legs` })
  }

  const highCount = clusters.filter((c) => c.level === "high").length
  const modCount  = clusters.filter((c) => c.level === "moderate").length

  return {
    clusters: clusters.sort((a, b) => {
      const ord = { high: 0, moderate: 1, low: 2 }
      return (ord[a.level] ?? 3) - (ord[b.level] ?? 3)
    }),
    highCount,
    modCount,
    overallCorrelation: highCount >= 2 ? "high" : highCount >= 1 || modCount >= 3 ? "moderate" : "low",
  }
}

// ── CONFLICT DETECTION ────────────────────────────────────────────────────────

function detectConflicts(bets = []) {
  const conflicts = []

  // Same player, same stat, opposite sides
  const byPlayerStat = {}
  for (const b of bets) {
    const k = `${String(b.player||"").toLowerCase()}|${normFam(b.statFamily||b.propType)}`
    if (!byPlayerStat[k]) byPlayerStat[k] = []
    byPlayerStat[k].push(b)
  }
  for (const [k, group] of Object.entries(byPlayerStat)) {
    if (group.length < 2) continue
    const sides = group.map((b) => String(b.side || "").toLowerCase())
    if (sides.includes("over") && sides.includes("under")) {
      conflicts.push({
        type:    "opposing_directions",
        players: [...new Set(group.map((b) => b.player))],
        stat:    k.split("|")[1],
        note:    `${k.split("|")[0]} — over AND under on same stat`,
      })
    }
  }

  // Usage collision: points over + assists under (shared ball-handling)
  const byPlayer = {}
  for (const b of bets) {
    if (!b.player) continue
    if (!byPlayer[b.player]) byPlayer[b.player] = []
    byPlayer[b.player].push(b)
  }
  for (const [player, playerBets] of Object.entries(byPlayer)) {
    const stats  = playerBets.map((b) => normFam(b.statFamily || b.propType))
    const sides  = playerBets.map((b) => String(b.side || "").toLowerCase())
    const hasPointsOver  = stats.some((s, i) => s.includes("point") && sides[i] === "over")
    const hasAssistUnder = stats.some((s, i) => s.includes("assist") && sides[i] === "under")
    const hasAssistOver  = stats.some((s, i) => s.includes("assist") && sides[i] === "over")
    const hasPointUnder  = stats.some((s, i) => s.includes("point") && sides[i] === "under")
    if ((hasPointsOver && hasAssistUnder) || (hasAssistOver && hasPointUnder)) {
      conflicts.push({
        type:    "usage_collision",
        player,
        note:    `${player} — conflicting usage (points ↑ vs assists ↓ or vice versa)`,
      })
    }
  }

  return conflicts
}

// ── SIZING NUDGES ─────────────────────────────────────────────────────────────

/**
 * Return a multiplier (0.5 – 1.5) per bet.
 * The bankroll engine applies these AFTER its own tier/Kelly calc.
 * 1.0 = no change. <1 = reduce. >1 = increase (capped at 1.3).
 */
function buildSizingNudges(bets = [], correlations = {}, timingResult = null, bookState = null) {
  const nudges  = {}
  const reasons = {}

  // Pre-compute per-bet timing urgency
  const timingMap = new Map()
  for (const tc of timingResult?.timingClassifications || []) {
    timingMap.set(tc.key, tc)
  }
  function timingKey(b) {
    return [
      String(b.eventId || ""),
      String(b.player || "").toLowerCase().trim(),
      normFam(b.statFamily || b.propType || ""),
      String(b.side || "").toLowerCase(),
      String(b.line ?? "any"),
    ].join("|")
  }
  function getTC(b) {
    const full  = timingMap.get(timingKey(b))
    if (full) return full
    const short = timingKey(b).split("|").slice(1).join("|")
    for (const [k, v] of timingMap) {
      if (k.split("|").slice(1).join("|") === short) return v
    }
    return null
  }

  // Count how many high-correlation clusters each bet participates in
  const betCorrelationLoad = {}
  for (const cluster of correlations.clusters || []) {
    if (cluster.level !== "high" && cluster.level !== "moderate") continue
    for (const b of bets) {
      const inCluster =
        (cluster.type === "same_game"         && gameKey(b) === cluster.key) ||
        (cluster.type === "same_player"        && b.player === cluster.key) ||
        (cluster.type === "stat_concentration" && normFam(b.statFamily || b.propType) === cluster.key) ||
        (cluster.type === "fb_concentration"   && normFam(b.statFamily || b.propType).includes("firstbasket")) ||
        (cluster.type === "hr_concentration"   && ["homeruns","hr"].includes(normFam(b.statFamily||b.propType)))
      if (inCluster) {
        const id = betId(b)
        betCorrelationLoad[id] = (betCorrelationLoad[id] || 0) + (cluster.level === "high" ? 2 : 1)
      }
    }
  }

  for (const b of bets) {
    const id   = betId(b)
    let mult   = 1.0
    const why  = []
    const vol  = classifyVolatility(b)
    const load = betCorrelationLoad[id] || 0
    const tc   = getTC(b)

    // Correlation reduction
    if (load >= 3) { mult *= 0.6; why.push("high_corr") }
    else if (load >= 2) { mult *= 0.75; why.push("mod_corr") }
    else if (load >= 1) { mult *= 0.875; why.push("low_corr") }

    // Volatility reduction for aggressive/lotto when correlation is also present
    if (vol === "lotto"      && load >= 1) { mult *= 0.8; why.push("lotto_corr") }
    if (vol === "aggressive" && load >= 2) { mult *= 0.85; why.push("aggr_corr") }

    // Timing boost
    if (tc?.urgency === "immediate" && tc?.state === "stale_window") { mult *= 1.2; why.push("stale_boost") }
    if (tc?.urgency === "immediate" && tc?.state === "steam")        { mult *= 1.15; why.push("steam_boost") }

    // CLV quality boost
    const clvQ = b.clvSnapshot?.clv?.quality || b.clvQuality
    if (clvQ === "positive") { mult *= 1.1; why.push("pos_clv_boost") }
    if (clvQ === "negative") { mult *= 0.85; why.push("neg_clv_reduce") }

    // Book profile boost (book historically shows positive CLV on this stat)
    const bookProf = bookState?.books?.[String(b.book || b.sportsbook || "").toLowerCase()]
    if (bookProf?.avgClv > 0.015) { mult *= 1.05; why.push("book_clv_boost") }

    mult = clamp(0.5, 1.3, r4(mult))
    nudges[id]  = mult
    reasons[id] = why
  }

  return { nudges, reasons }
}

// ── PORTFOLIO SCORE ───────────────────────────────────────────────────────────

/**
 * 0–100 portfolio health score.
 * 100 = perfectly diversified, low correlation, good volatility mix, no conflicts.
 */
/**
 * 0–100 portfolio health score.
 *
 * Grading is intentionally HELPFUL not punishing. We want users to understand
 * concentration, not feel scolded. A typical curated nightly pool will sit
 * 65–85 (B / B-).  Only true mistakes (multiple high-corr clusters with
 * conflicts) should fall below 50.
 */
function buildPortfolioScore(exposureMap, correlations, conflicts) {
  let score = 100

  // Correlation penalties — softened
  score -= correlations.highCount     * 8        // was 12
  score -= correlations.modCount      * 3        // was 5

  // Conflict penalties — softened slightly
  score -= conflicts.length * 6                  // was 8

  // Volatility imbalance: too many lotto bets
  const total    = exposureMap.totalSingles || 1
  const lottoPct = (exposureMap.byVolatility?.lotto   || 0) / total
  const aggrPct  = (exposureMap.byVolatility?.aggressive || 0) / total
  if (lottoPct > 0.55) score -= 8                // was >0.4 / -10
  else if (lottoPct > 0.40) score -= 4
  if (aggrPct  > 0.65) score -= 6                // was >0.5 / -8

  // Concentration: one stat > 50% of bets
  const maxStatCount = Math.max(...Object.values(exposureMap.byStat || {}).map((v) => v.count), 0)
  if (maxStatCount / total > 0.65) score -= 6    // was >0.5 / -8
  else if (maxStatCount / total > 0.50) score -= 3

  // Concentration: one game > 40% of bets
  const maxGameCount = Math.max(...Object.values(exposureMap.byGame || {}).map((v) => v.count), 0)
  if (maxGameCount / total > 0.55) score -= 8    // was >0.4 / -10
  else if (maxGameCount / total > 0.40) score -= 4

  // Sportsbook concentration: single book > 70%
  const maxBookCount = Math.max(...Object.values(exposureMap.byBook || {}).map((v) => v.count), 0)
  if (maxBookCount / total > 0.75) score -= 4    // was >0.7 / -5

  return Math.max(0, Math.min(100, Math.round(score)))
}

function portfolioGrade(score) {
  if (score >= 85) return "Balanced"
  if (score >= 72) return "Mostly Diversified"
  if (score >= 60) return "Moderate Concentration"
  if (score >= 45) return "Elevated Concentration"
  return "High Correlation"
}

function portfolioMood(score) {
  // Helpful tone for the UI — never "F" or "scolding"
  if (score >= 85) return { tone: "good",     headline: "Healthy diversification" }
  if (score >= 72) return { tone: "good",     headline: "Mostly diversified portfolio" }
  if (score >= 60) return { tone: "neutral",  headline: "Some concentration to consider" }
  if (score >= 45) return { tone: "watch",    headline: "Elevated game/player concentration" }
  return                   { tone: "watch",    headline: "High correlation — consider trimming" }
}

// ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {Array}  opts.bets            Single bet objects
 * @param {Array}  [opts.slipBets]      Slip bet objects (with .legs)
 * @param {object} [opts.timingResult]  From buildMarketTiming()
 * @param {object} [opts.bookState]     From loadBookState()
 * @param {object} [opts.bankrollInfo]  { bankroll, unitSize, dailyRiskBudget }
 */
function optimizePortfolio(opts = {}) {
  const {
    bets         = [],
    slipBets     = [],
    timingResult = null,
    bookState    = null,
    bankrollInfo = null,
  } = opts

  const exposureMap  = buildExposureMap(bets, slipBets)
  const correlations = detectCorrelations(bets, slipBets, exposureMap)
  const conflicts    = detectConflicts(bets)
  const { nudges, reasons } = buildSizingNudges(bets, correlations, timingResult, bookState)
  const score = buildPortfolioScore(exposureMap, correlations, conflicts)
  const grade = portfolioGrade(score)
  const mood  = portfolioMood(score)

  // Build warnings list (helpful, non-punishing tone)
  const warnings = []
  // Only surface notes when there is something genuinely actionable.
  // Cap to the top few so the UI doesn't feel spammy.
  const sortedClusters = (correlations.clusters || [])
    .filter((c) => c.level === "high" || c.level === "moderate")
    .slice(0, 5)
  for (const c of sortedClusters) {
    let label = c.note
    // Descriptive phrasing — counts the bets, doesn't scold the user.
    if (c.type === "same_game")          label = `${c.count} legs on ${c.label}`
    else if (c.type === "same_player")   label = `${c.count} bets on ${c.label}`
    else if (c.type === "stat_concentration") label = `${c.count} bets on ${c.label} (concentrated stat)`
    else if (c.type === "fb_concentration")   label = `${c.count} first-basket bets`
    else if (c.type === "hr_concentration")   label = `${c.count} HR bets`
    warnings.push({ level: c.level, type: c.type, label, count: c.count })
  }
  for (const c of conflicts) {
    warnings.push({ level: "high", type: "conflict", label: c.note })
  }
  const total     = exposureMap.totalSingles
  const lottoPct  = Math.round((exposureMap.byVolatility.lotto   / Math.max(total, 1)) * 100)
  const aggrPct   = Math.round((exposureMap.byVolatility.aggressive / Math.max(total, 1)) * 100)
  if (lottoPct > 40) warnings.push({ level: "moderate", type: "volatility", label: `${lottoPct}% lotto bets — aggressive variance mix` })
  if (aggrPct  > 55) warnings.push({ level: "moderate", type: "volatility", label: `${aggrPct}% aggressive bets — high-variance night` })

  const report = buildPortfolioReport({
    exposureMap, correlations, conflicts, score, grade, warnings, nudges, reasons,
    bets, slipBets, bankrollInfo,
  })

  return {
    exposureMap,
    correlations,
    conflicts,
    nudges,
    reasons,
    score,
    grade,
    mood,
    warnings,
    report,
  }
}

// ── REPORT BUILDER ────────────────────────────────────────────────────────────

function buildPortfolioReport({ exposureMap, correlations, conflicts, score, grade, warnings, nudges, reasons, bets, slipBets, bankrollInfo } = {}) {
  const lines = []
  const total = exposureMap?.totalSingles || 0
  const { divider } = require("./buildIntelligencePresentation")

  lines.push(divider("💰  PORTFOLIO OPTIMIZATION"))
  lines.push(`  SCORE  ${score}/100  [${grade}]`)
  lines.push("")

  // Volatility mix
  const vol = exposureMap?.byVolatility || {}
  const volParts = Object.entries(vol)
    .filter(([, c]) => c > 0)
    .map(([k, c]) => `${k}:${c}(${Math.round(c / Math.max(total, 1) * 100)}%)`)
    .join("  ")
  lines.push(`  VOLATILITY MIX   ${volParts}`)

  // Stat exposure
  const statParts = Object.entries(exposureMap?.byStat || {})
    .sort((a, b) => b[1].count - a[1].count)
    .map(([k, v]) => `${k}:${v.count}`)
    .join("  ")
  lines.push(`  STAT EXPOSURE    ${statParts}`)

  // Sportsbook spread
  const bookParts = Object.entries(exposureMap?.byBook || {})
    .sort((a, b) => b[1].count - a[1].count)
    .map(([k, v]) => `${k}:${v.count}`)
    .join("  ")
  if (bookParts) lines.push(`  BOOK SPREAD      ${bookParts}`)

  // Game concentration
  const gameClusters = Object.entries(exposureMap?.byGame || {})
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)
  if (gameClusters.length) {
    lines.push(`  GAME EXPOSURE:`)
    gameClusters.forEach(([, v]) => {
      lines.push(`    ${String(v.matchup || "").slice(0, 35).padEnd(36)} ${v.count} bets  overs likely: ${v.stats.includes("over") || (v.overs||0) > 0}`)
    })
  }

  // Correlation warnings
  if (correlations?.clusters?.length) {
    lines.push("")
    lines.push(`  CORRELATIONS:`)
    correlations.clusters.slice(0, 8).forEach((c) => {
      const icon = c.level === "high" ? "⚠️ " : "🔶"
      lines.push(`    ${icon} [${c.level.padEnd(8)}] ${c.note}`)
    })
  }

  // Conflicts
  if (conflicts?.length) {
    lines.push("")
    lines.push(`  CONFLICTS:`)
    conflicts.forEach((c) => lines.push(`    ❌ ${c.note}`))
  }

  // Sizing nudges (only show non-1.0 values)
  const nudgeEntries = Object.entries(nudges || {}).filter(([, m]) => Math.abs(m - 1.0) >= 0.05)
  if (nudgeEntries.length) {
    lines.push("")
    lines.push(`  SIZING NUDGES (multiply bankroll engine output):`)
    nudgeEntries.forEach(([id, mult]) => {
      const why  = (reasons[id] || []).join(", ")
      const dir  = mult >= 1 ? "↑" : "↓"
      const pct  = Math.round(Math.abs(mult - 1) * 100)
      const name = String(id).split("|")[0] || id
      lines.push(`    ${dir} ${String(name).slice(0, 22).padEnd(23)} ×${mult.toFixed(2)} (${why || pct + "%"})`)
    })
  }

  // Warnings
  if (warnings?.length) {
    lines.push("")
    lines.push(`  NOTES:`)
    warnings.forEach((w) => {
      const icon = w.level === "high" ? "⚠️ " : "🔶"
      const text = typeof w === "string" ? w : (w.label || "")
      lines.push(`    ${icon} ${text}`)
    })
  }

  // Bankroll
  if (bankrollInfo) {
    lines.push("")
    const riskStr = bankrollInfo.totalRisk != null ? `risk:$${bankrollInfo.totalRisk}` : ""
    const budgStr = bankrollInfo.dailyRiskBudget != null ? `budget:$${bankrollInfo.dailyRiskBudget}` : ""
    const utilStr = bankrollInfo.riskUtilization != null ? `util:${Math.round(bankrollInfo.riskUtilization * 100)}%` : ""
    lines.push(`  BANKROLL  ${[riskStr, budgStr, utilStr].filter(Boolean).join("  ")}`)
  }

  return lines.join("\n")
}

module.exports = {
  optimizePortfolio,
  buildExposureMap,
  detectCorrelations,
  detectConflicts,
  classifyVolatility,
  buildSizingNudges,
  buildPortfolioScore,
  portfolioGrade,
  portfolioMood,
}
