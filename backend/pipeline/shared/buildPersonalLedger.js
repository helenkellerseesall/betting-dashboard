"use strict"

/**
 * Personal Bet Ledger + ROI Engine.
 *
 * Single file — no new sport-specific systems. Integrates with:
 *   - existin tracked_bets / tracked_slips (reads model recs for comparison)
 *   - post-game review engine state (confidence adjustments, archetype hints)
 *   - bankroll plan (units / Kelly sizing reference)
 *
 * Persists to ONE compact rolling JSON:
 *   backend/runtime/tracking/personal_ledger.json
 *
 * Storage design:
 *   { meta, bankroll, bets[], analytics }
 *
 *   bets[] — ring-buffer capped at MAX_BETS entries.
 *   analytics — incrementally updated on every write; never recomputed from scratch.
 *
 * Performance: all operations O(MAX_BETS) or better. No recomputation of full history.
 */

const fs = require("fs")
const path = require("path")
const { computeClv, buildClvAnalytics, classifyResultVsClv } = require("./buildClv")

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")
const LEDGER_FILE = path.join(TRACKING_DIR, "personal_ledger.json")
const MAX_BETS = 2000
const MAX_BETS_IN_REPORT = 50
const CURRENT_VERSION = "personal-ledger-v1"

// ─── helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch (_) {
    return fallback
  }
}

function writeJsonSync(p, data) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(data))
    return true
  } catch (_) {
    return false
  }
}

function num(v) {
  if (v == null) return null          // null / undefined stay null (not 0)
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo))
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function americanToDecimal(american) {
  const a = num(american)
  if (!Number.isFinite(a) || a === 0) return null
  if (a > 0) return 1 + a / 100
  return 1 + 100 / Math.abs(a)
}

function impliedProbFromAmerican(american) {
  const a = num(american)
  if (!Number.isFinite(a) || a === 0) return null
  if (a > 0) return 100 / (a + 100)
  return Math.abs(a) / (Math.abs(a) + 100)
}

function stableId(sport, date, player, statFamily, side, line, sportsbook) {
  const parts = [
    String(sport || "").toLowerCase(),
    date,
    String(player || "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
    String(statFamily || "").toLowerCase(),
    String(side || "").toLowerCase(),
    String(line ?? ""),
    String(sportsbook || "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
  ]
  // Simple hash so ids are reproducible without crypto.
  const raw = parts.join("|")
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `pl_${(h >>> 0).toString(16)}_${Date.now().toString(36)}`
}

// ─── event / team integrity (compact, no duplicate pipelines) ─────────────────

/** NBA-only substring hints → canonical abbrev. Single validation map — not a second roster DB. */
const NBA_TEAM_HINTS = {
  ATL: ["atlanta", "hawks"], BOS: ["boston", "celtics"], BKN: ["brooklyn", "nets"],
  CHA: ["charlotte", "hornets"], CHI: ["chicago", "bulls"], CLE: ["cleveland", "cavaliers", "cavs"],
  DAL: ["dallas", "mavericks", "mavs"], DEN: ["denver", "nuggets"], DET: ["detroit", "pistons"],
  GS: ["golden state", "warriors"], GSW: ["golden state", "warriors"],
  HOU: ["houston", "rockets"], IND: ["indiana", "pacers"],
  LAC: ["la clippers", "clippers"], LAL: ["lakers", "los angeles l"], MEM: ["memphis", "grizzlies"],
  MIA: ["miami", "heat"], MIL: ["milwaukee", "bucks"], MIN: ["minnesota", "timberwolves", "wolves"],
  NOP: ["orleans", "pelicans"], NO: ["orleans", "pelicans"], NYK: ["new york", "knicks"],
  OKC: ["oklahoma", "thunder"], ORL: ["orlando", "magic"], PHI: ["philadelphia", "76ers", "sixers"],
  PHX: ["phoenix", "suns"], PHO: ["phoenix", "suns"], POR: ["portland", "trail", "blazers"],
  SAC: ["sacramento", "kings"], SAS: ["san antonio", "spurs"], TOR: ["toronto", "raptors"],
  UTA: ["utah", "jazz"], WAS: ["washington", "wizards"],
}

function normalizeAbbrevToken(tok) {
  if (!tok || typeof tok !== "string") return null
  const t = tok.trim().toUpperCase()
  if (!/^[A-Z]{2,4}$/.test(t)) return null
  if (t === "GSW") return "GS"
  if (NBA_TEAM_HINTS[t]) return t
  return null
}

function labelToNbaAbbrev(label) {
  if (!label || typeof label !== "string") return null
  const ab = normalizeAbbrevToken(label)
  if (ab) return ab === "GSW" ? "GS" : ab
  const low = label.toLowerCase()
  for (const [abbr, hints] of Object.entries(NBA_TEAM_HINTS)) {
    for (const h of hints) {
      if (low.includes(h)) return abbr
    }
  }
  const m = label.trim().match(/^([A-Za-z]{2,4})\b/)
  if (m) return normalizeAbbrevToken(m[1])
  return null
}

function parseMatchupSides(matchup) {
  if (!matchup || typeof matchup !== "string") return null
  const s = matchup.trim()
  let parts = null
  if (s.includes(" @ ")) parts = s.split(" @ ").map((x) => x.trim())
  else if (/\s+@\s+/.test(s)) parts = s.split(/\s+@\s+/).map((x) => x.trim())
  else if (/\s+vs\.?\s+/i.test(s)) parts = s.split(/\s+vs\.?\s+/i).map((x) => x.trim())
  else if (/\s+at\s+/i.test(s)) parts = s.split(/\s+at\s+/i).map((x) => x.trim())
  if (!parts || parts.length !== 2) return null
  return { awayRaw: parts[0], homeRaw: parts[1] }
}

function abbrevPairFromEventId(eventId) {
  if (!eventId || typeof eventId !== "string") return null
  const lower = eventId.toLowerCase()
  // `nba_okc_dal_20260506` — skip generic hex ids (no sport_team_team pattern).
  const m = lower.match(/(?:nba|mlb|nfl)_([a-z]{2,4})_([a-z]{2,4})/)
  if (!m) return null
  const a = normalizeAbbrevToken(m[1])
  const b = normalizeAbbrevToken(m[2])
  if (!a || !b) return null
  return [a, b].sort().join("|")
}

function abbrevPairFromSides(sides) {
  if (!sides) return null
  const aa = labelToNbaAbbrev(sides.awayRaw)
  const ha = labelToNbaAbbrev(sides.homeRaw)
  if (!aa || !ha) return null
  return [aa, ha].sort().join("|")
}

function teamAbbrevMatchesSide(teamAbbr, sideRaw) {
  if (!teamAbbr || !sideRaw) return false
  const sideAbbr = labelToNbaAbbrev(sideRaw)
  return sideAbbr === teamAbbr
}

/**
 * Validates team ↔ matchup ↔ opponent ↔ eventId for NBA; MLB gets lenient substring checks only.
 * On hard mismatch: strips incorrect matchup/eventId (never persists a known-wrong game link).
 */
function applyIntegrityGate(baseBet, rawInput = {}) {
  const sport = String(baseBet.sport || "").toLowerCase()
  const warnings = []
  const stripped = []
  let matchup = baseBet.matchup
  let eventId = baseBet.eventId
  let team = baseBet.team
  let opponent = baseBet.opponent
  let discardedMatchup = null
  let discardedEventId = null

  const sides = parseMatchupSides(matchup)
  let teamAbbr = team ? (sport === "nba" ? labelToNbaAbbrev(team) : team.trim()) : null
  let oppAbbr = opponent ? (sport === "nba" ? labelToNbaAbbrev(opponent) : opponent.trim()) : null

  const fam = String(baseBet.statFamily || "").toLowerCase()
  const isFirstBasket = fam === "firstbasket" || fam.includes("first basket") || fam.includes("firstbucket")

  if (sport === "nba") {
    const muPair = abbrevPairFromSides(sides)
    const evPair = abbrevPairFromEventId(eventId)

    if (teamAbbr && sides) {
      const okSide = teamAbbrevMatchesSide(teamAbbr, sides.awayRaw) || teamAbbrevMatchesSide(teamAbbr, sides.homeRaw)
      if (!okSide) {
        warnings.push("team_not_in_matchup")
        discardedMatchup = matchup
        discardedEventId = eventId
        matchup = null
        eventId = null
        stripped.push("matchup", "eventId")
      }
    }

    if (teamAbbr && oppAbbr && sides && !stripped.length) {
      const aa = labelToNbaAbbrev(sides.awayRaw)
      const ha = labelToNbaAbbrev(sides.homeRaw)
      if (aa && ha) {
        const others = new Set([aa, ha])
        if (!others.has(teamAbbr) || !others.has(oppAbbr) || teamAbbr === oppAbbr) {
          warnings.push("opponent_team_inconsistent_with_matchup")
          discardedMatchup = discardedMatchup || matchup
          matchup = null
          stripped.push("matchup")
        }
      }
    }

    if (muPair && evPair && muPair !== evPair && !stripped.includes("eventId")) {
      warnings.push("eventId_matchup_mismatch")
      discardedEventId = eventId
      eventId = null
      stripped.push("eventId")
    }

    if (isFirstBasket && !teamAbbr) {
      warnings.push("first_basket_missing_team")
    }

    // Fill opponent from matchup when team is known and opponent empty.
    if (teamAbbr && sides && !opponent && !stripped.includes("matchup")) {
      const aa = labelToNbaAbbrev(sides.awayRaw)
      const ha = labelToNbaAbbrev(sides.homeRaw)
      if (aa && ha) {
        if (teamAbbr === aa) opponent = ha
        else if (teamAbbr === ha) opponent = aa
      }
    }
  } else if (sport === "mlb") {
    if (team && matchup && typeof matchup === "string") {
      const mt = matchup.toLowerCase()
      const tt = team.toLowerCase()
      if (!mt.includes(tt) && tt.length > 1) {
        warnings.push("team_not_substring_of_matchup_mlb")
        discardedMatchup = matchup
        matchup = null
        stripped.push("matchup")
      }
    }
  }

  let matchupNormalized = null
  if (sport === "nba" && matchup && parseMatchupSides(matchup)) {
    const ps = parseMatchupSides(matchup)
    const aa = labelToNbaAbbrev(ps.awayRaw)
    const ha = labelToNbaAbbrev(ps.homeRaw)
    if (aa && ha) matchupNormalized = `${aa} @ ${ha}`
  }

  // Re-resolve abbreviations after opponent auto-fill
  if (sport === "nba" && opponent) oppAbbr = labelToNbaAbbrev(opponent)

  if (isFirstBasket) {
    const fbOk = !!(teamAbbr && matchupNormalized && eventId && !stripped.includes("matchup"))
    if (!fbOk) warnings.push("first_basket_mapping_incomplete")
  }

  const uniqWarnings = [...new Set(warnings)]
  const BLOCKING = new Set([
    "team_not_in_matchup",
    "eventId_matchup_mismatch",
    "opponent_team_inconsistent_with_matchup",
    "team_not_substring_of_matchup_mlb",
    "first_basket_missing_team",
    "first_basket_mapping_incomplete",
  ])
  const integrityValid = !uniqWarnings.some((w) => BLOCKING.has(w))

  const teamOut = sport === "nba"
    ? (teamAbbr || (team ? labelToNbaAbbrev(team) : null) || team || baseBet.team)
    : (team || baseBet.team)
  const oppOut = sport === "nba"
    ? (oppAbbr || opponent || baseBet.opponent)
    : (opponent || baseBet.opponent)

  const integrity = {
    valid: integrityValid,
    warnings: uniqWarnings,
    matchupNormalized,
    teamAbbrev: sport === "nba" ? (teamAbbr || labelToNbaAbbrev(teamOut)) : (teamOut || null),
    opponentAbbrev: sport === "nba" ? (oppAbbr || labelToNbaAbbrev(oppOut)) : (oppOut || null),
    discardedMatchup,
    discardedEventId,
    strippedFields: [...new Set(stripped)],
  }

  return {
    ...baseBet,
    team: teamOut || null,
    opponent: oppOut || null,
    matchup,
    eventId,
    integrity,
  }
}

// ─── schema ───────────────────────────────────────────────────────────────────

function emptyLedger(initialBankroll = 1000) {
  return {
    version: CURRENT_VERSION,
    updatedAt: null,
    bankroll: {
      initial: initialBankroll,
      current: initialBankroll,
      currency: "USD",
      unitSize: round2(initialBankroll * 0.01), // 1% unit
    },
    bets: [],
    analytics: emptyAnalytics(),
  }
}

function emptyAnalytics() {
  return {
    totals: { bets: 0, settled: 0, wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0 },
    financial: {
      totalStaked: 0,
      totalPayout: 0,
      totalProfit: 0,
      roi: null,
      unitsWon: 0,
      unitsLost: 0,
    },
    bySport: {},
    byStat: {},
    bySportsbook: {},
    byTier: {},
    byDecision: {},     // followed / modified / ignored / custom
    byBetType: {},      // single / slip
    nearMisses: [],     // last 20 near-miss bets
    performance: {      // rolling accuracy
      bestStat: null,
      worstStat: null,
      bestSport: null,
      worstSport: null,
    },
    bankrollCurve: [],  // [{ date, balance }] — one entry per calendar day (capped 90 days)
  }
}

// ─── bet shape validation ─────────────────────────────────────────────────────

function normalizeBet(input) {
  const date = String(input.date || todayKey())
  const odds = num(input.odds ?? input.oddsAmerican)
  const stake = num(input.stake)
  const line = num(input.line)
  const decOdds = americanToDecimal(odds)
  const toWin = Number.isFinite(decOdds) && Number.isFinite(stake)
    ? round2(stake * (decOdds - 1))
    : num(input.toWin)
  const sbImpliedProb = impliedProbFromAmerican(odds)

  // Model comparison — how did user's line differ from the model's recommendation?
  // Guard: use explicit null check so unset fields stay null (not coerced to 0 via Number(null)).
  const modelLine = input.modelLine != null ? num(input.modelLine) : null
  const modelOdds = input.modelOdds != null ? num(input.modelOdds) : null
  const modelProb = input.modelProb != null ? num(input.modelProb) : null
  const modelTier = input.modelTier ? String(input.modelTier) : null
  const decisionType = resolveDecisionType(input)
  // aggressionDelta: positive = user took harder (higher) line than model
  const aggressionDelta = Number.isFinite(line) && Number.isFinite(modelLine)
    ? round4(line - modelLine)
    : null

  // ── compact model snapshot (projection context at bet time) ──────────────
  const snap = input.modelSnapshot && typeof input.modelSnapshot === "object"
    ? input.modelSnapshot : {}
  const modelSnapshot = {
    projectedStat: snap.projectedStat != null ? num(snap.projectedStat)
      : input.projectedStat != null ? num(input.projectedStat) : null,
    projectedRangeLow: snap.projectedRangeLow != null ? num(snap.projectedRangeLow)
      : input.projectedRangeLow != null ? num(input.projectedRangeLow) : null,
    projectedRangeHigh: snap.projectedRangeHigh != null ? num(snap.projectedRangeHigh)
      : input.projectedRangeHigh != null ? num(input.projectedRangeHigh) : null,
    confidenceRaw: snap.confidenceRaw != null ? num(snap.confidenceRaw)
      : input.confidenceRaw != null ? num(input.confidenceRaw) : null,
    calibratedConfidence: snap.calibratedConfidence != null ? num(snap.calibratedConfidence)
      : input.calibratedConfidence != null ? num(input.calibratedConfidence)
      : input.confidence != null ? num(input.confidence) : null,
    edge: snap.edge != null ? num(snap.edge)
      : input.edge != null ? num(input.edge) : null,
    modelRanking: snap.modelRanking != null ? num(snap.modelRanking)
      : input.modelRanking != null ? num(input.modelRanking) : null,
    archetype: snap.archetype || input.archetype || null,
  }

  // ── first basket specific snapshot (only populated when relevant) ─────────
  const fam = String(input.statFamily || "").toLowerCase()
  const isFirstBasket = fam === "firstbasket" || fam.includes("first basket") || fam.includes("firstbucket")
  const fbSnap = (input.firstBasketSnapshot && typeof input.firstBasketSnapshot === "object")
    ? input.firstBasketSnapshot : {}
  const firstBasketSnapshot = isFirstBasket ? {
    projectedFirstShotProb: fbSnap.projectedFirstShotProb != null ? num(fbSnap.projectedFirstShotProb) : null,
    projectedFirstTouchProb: fbSnap.projectedFirstTouchProb != null ? num(fbSnap.projectedFirstTouchProb) : null,
    tipWinExpectation: fbSnap.tipWinExpectation != null ? num(fbSnap.tipWinExpectation) : null,
    openingPossessionConf: fbSnap.openingPossessionConf != null ? num(fbSnap.openingPossessionConf) : null,
    // Intel layer fields (may be null if intel didn't run)
    archetype: fbSnap.archetype || null,
    pFirstBasket: fbSnap.pFirstBasket != null ? num(fbSnap.pFirstBasket) : null,
    components: fbSnap.components && typeof fbSnap.components === "object" ? {
      pTipWin: num(fbSnap.components.pTipWin),
      pFirstTouch: num(fbSnap.components.pFirstTouch),
      pFirstShotGivenTouch: num(fbSnap.components.pFirstShotGivenTouch),
      pMakeShot: num(fbSnap.components.pMakeShot),
    } : null,
  } : null

  const base = {
    id: input.id || stableId(input.sport, date, input.player, input.statFamily, input.side, line, input.sportsbook),
    date,
    sport: String(input.sport || "").toLowerCase(),
    sportsbook: String(input.sportsbook || "").toLowerCase(),
    betType: String(input.betType || "single").toLowerCase(),  // single | slip
    player: String(input.player || "").trim(),
    team: String(input.team || "").trim() || null,
    // game context
    eventId: input.eventId || input.gameId || null,
    matchup: input.matchup || null,
    opponent: input.opponent || null,
    // prop details
    statFamily: fam,
    prop: input.prop || `${input.statFamily} ${input.side} ${input.line}`,
    side: String(input.side || "").toLowerCase(),
    line,
    odds,
    stake,
    toWin,
    impliedProb: Number.isFinite(sbImpliedProb) ? round4(sbImpliedProb) : null,
    // Model reference
    modelLine,
    modelOdds,
    modelProb,
    modelTier,
    decisionType,             // "followed" | "modified" | "ignored" | "custom"
    aggressionDelta,
    confidenceTier: String(input.confidenceTier || input.tier || modelTier || "unknown"),
    // Compact projection snapshot stored at bet time
    modelSnapshot,
    firstBasketSnapshot,
    // Actuals (filled after game)
    actualStat: input.actualStat != null ? num(input.actualStat) : null,
    result: String(input.result || "pending").toLowerCase(),
    payout: input.payout != null ? num(input.payout) : null,
    cashout: input.cashout != null ? num(input.cashout) : null,
    settledAt: input.settledAt || null,
    // Context
    environment: input.environment && typeof input.environment === "object" ? input.environment : {},
    note: typeof input.note === "string" ? input.note.slice(0, 200) : null,
    // CLV snapshot — placed filled now, close filled later via setClosingLine()
    clvSnapshot: buildClvSnapshot(input, odds, line, sbImpliedProb),
  }

  return applyIntegrityGate(base, input)
}

function resolveDecisionType(input) {
  const raw = String(input.decisionType || "").toLowerCase()
  if (raw === "followed" || raw === "modified" || raw === "ignored" || raw === "custom") return raw
  // Infer from modelLine presence.
  const userLine = num(input.line)
  const modelLine = num(input.modelLine ?? null)
  if (!Number.isFinite(modelLine)) return "custom"
  if (!Number.isFinite(userLine)) return "followed"
  if (Math.abs(userLine - modelLine) < 0.01) return "followed"
  return "modified"
}

// ─── near-miss classification ─────────────────────────────────────────────────

function classifyNearMiss(bet) {
  const actual = num(bet.actualStat)
  const line = num(bet.line)
  const side = String(bet.side || "").toLowerCase()
  if (!Number.isFinite(actual) || !Number.isFinite(line)) return null
  const delta = actual - line
  const isOver = side.startsWith("o") || side === "yes"
  const isUnder = side.startsWith("u") || side === "no"

  if (bet.result === "win") return null  // not a miss

  let category = null
  if (isOver && delta >= -1.0 && delta < 0) category = "near-miss"
  else if (isUnder && delta > 0 && delta <= 1.0) category = "near-miss"
  else if (isOver && delta < -1.0) category = "total-miss"
  else if (isUnder && delta > 1.0) category = "total-miss"
  else category = "variance-loss"

  // Sport-specific narrative.
  const fam = String(bet.statFamily || "").toLowerCase()
  let narrative = null
  if (category === "near-miss") {
    if (fam === "rebounds") narrative = `missed by ${Math.abs(delta).toFixed(1)} rebound${Math.abs(delta) === 1 ? "" : "s"}`
    else if (fam === "assists") narrative = `missed by ${Math.abs(delta).toFixed(1)} assist${Math.abs(delta) === 1 ? "" : "s"}`
    else if (fam === "hr") narrative = "warning-track power"
    else if (fam === "firstbasket" || fam.includes("first basket")) narrative = "second-scorer loss"
    else narrative = `missed by ${Math.abs(delta).toFixed(1)}`
  }

  return { category, delta: round4(delta), narrative }
}

// ─── analytics incremental update ─────────────────────────────────────────────

function bucketFor(map, key, init) {
  if (!map[key]) map[key] = { ...(init || {}) }
  return map[key]
}

function emptyBucket() {
  return { bets: 0, settled: 0, wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0, staked: 0, profit: 0 }
}

function applyBetToAnalytics(analytics, bet) {
  const { totals, financial, bySport, byStat, bySportsbook, byTier, byDecision, byBetType } = analytics
  const r = String(bet.result || "pending").toLowerCase()
  const stake = num(bet.stake) ?? 0
  const payout = num(bet.payout ?? bet.cashout ?? null)
  const toWin = num(bet.toWin) ?? 0
  const profit = r === "win" ? (Number.isFinite(payout) ? payout - stake : toWin)
    : r === "loss" ? -stake
    : 0

  // Totals
  totals.bets += 1
  if (r === "win") { totals.wins += 1; totals.settled += 1 }
  else if (r === "loss") { totals.losses += 1; totals.settled += 1 }
  else if (r === "push") { totals.pushes += 1; totals.settled += 1 }
  else if (r === "void") { totals.voids += 1; totals.settled += 1 }
  else totals.pending += 1

  // Financial
  financial.totalStaked = round2(financial.totalStaked + stake)
  if (r === "win") {
    const pay = Number.isFinite(payout) ? payout : stake + toWin
    financial.totalPayout = round2(financial.totalPayout + pay)
  }
  financial.totalProfit = round2(financial.totalProfit + profit)
  financial.roi = totals.settled > 0 && financial.totalStaked > 0
    ? round4(financial.totalProfit / financial.totalStaked)
    : null

  // Buckets
  const buckets = [
    [bySport, bet.sport],
    [byStat, bet.statFamily],
    [bySportsbook, bet.sportsbook],
    [byTier, bet.confidenceTier],
    [byDecision, bet.decisionType],
    [byBetType, bet.betType],
  ]
  for (const [map, key] of buckets) {
    if (!key) continue
    const b = bucketFor(map, key, emptyBucket())
    b.bets += 1
    if (r === "win") { b.wins += 1; b.settled += 1; b.profit = round2(b.profit + profit) }
    else if (r === "loss") { b.losses += 1; b.settled += 1; b.profit = round2(b.profit + profit) }
    else if (r === "push") { b.pushes += 1; b.settled += 1 }
    else if (r === "void") { b.voids += 1; b.settled += 1 }
    else b.pending = (b.pending || 0) + 1
    b.staked = round2((b.staked || 0) + stake)
    if (b.settled > 0 && b.staked > 0) b.roi = round4(b.profit / b.staked)
  }
}

function rebuildAnalytics(bets, currentBankroll, initialBankroll) {
  const analytics = emptyAnalytics()
  for (const b of bets) {
    applyBetToAnalytics(analytics, b)
    const nm = classifyNearMiss(b)
    if (nm) {
      analytics.nearMisses.push({ id: b.id, date: b.date, player: b.player, statFamily: b.statFamily,
        side: b.side, line: b.line, actualStat: b.actualStat, ...nm })
      if (analytics.nearMisses.length > 20) analytics.nearMisses.shift()
    }
  }

  // Units won / lost (using stored unitSize).
  const unit = num(currentBankroll * 0.01) || 10
  analytics.financial.unitsWon = round2(analytics.financial.totalProfit / unit)

  // Performance: best/worst stat + sport.
  const statRoi = Object.entries(analytics.byStat)
    .filter(([, b]) => b.settled >= 5)
    .map(([k, b]) => ({ k, roi: b.roi ?? -Infinity }))
  if (statRoi.length) {
    analytics.performance.bestStat = statRoi.sort((a, b) => b.roi - a.roi)[0]?.k
    analytics.performance.worstStat = statRoi.sort((a, b) => a.roi - b.roi)[0]?.k
  }

  const sportRoi = Object.entries(analytics.bySport)
    .filter(([, b]) => b.settled >= 5)
    .map(([k, b]) => ({ k, roi: b.roi ?? -Infinity }))
  if (sportRoi.length) {
    analytics.performance.bestSport = sportRoi.sort((a, b) => b.roi - a.roi)[0]?.k
    analytics.performance.worstSport = sportRoi.sort((a, b) => a.roi - b.roi)[0]?.k
  }

  return analytics
}

function updateBankrollCurve(curve, date, balance) {
  // One entry per day; replace if already present.
  const filtered = curve.filter((e) => e.date !== date)
  filtered.push({ date, balance: round2(balance) })
  filtered.sort((a, b) => (a.date > b.date ? 1 : -1))
  if (filtered.length > 90) filtered.splice(0, filtered.length - 90)
  return filtered
}

function computeCurrentBankroll(ledger, bet) {
  const r = String(bet.result || "pending").toLowerCase()
  const stake = num(bet.stake) ?? 0
  const toWin = num(bet.toWin) ?? 0
  const payout = num(bet.payout ?? bet.cashout ?? null)
  let delta = 0
  if (r === "win") delta = Number.isFinite(payout) ? payout - stake : toWin
  else if (r === "loss") delta = -stake
  return round2(ledger.bankroll.current + delta)
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Load the personal ledger from disk. Returns emptyLedger if not found.
 */
function loadLedger() {
  return readJsonSafe(LEDGER_FILE, null) || emptyLedger()
}

/**
 * Persist ledger to disk. Returns true on success.
 */
function saveLedger(ledger) {
  return writeJsonSync(LEDGER_FILE, ledger)
}

/**
 * Add or update a bet.
 *
 * If `input.id` matches an existing entry, it updates that entry (useful for
 * settling later). Otherwise appends a new entry.
 *
 * Returns `{ ledger, bet, isNew }`.
 */
function addOrUpdateBet(input = {}, { ledger: existingLedger = null, save = true } = {}) {
  const ledger = existingLedger || loadLedger()
  const bet = normalizeBet(input)

  const existingIdx = ledger.bets.findIndex((b) => b.id === bet.id)
  const isNew = existingIdx === -1
  if (isNew) {
    ledger.bets.push(bet)
    if (ledger.bets.length > MAX_BETS) ledger.bets.splice(0, ledger.bets.length - MAX_BETS)
  } else {
    // Merge: keep settled results, allow updating pending fields.
    const prev = ledger.bets[existingIdx]
    const merged = { ...prev, ...bet }
    // Preserve a settled result if the incoming one is still "pending".
    if (prev.result && prev.result !== "pending" && bet.result === "pending") {
      merged.result = prev.result
      merged.settledAt = prev.settledAt
      merged.payout = prev.payout ?? bet.payout
    }
    ledger.bets[existingIdx] = merged
  }

  // Update bankroll current balance when a real result comes in.
  if (bet.result !== "pending" && isNew) {
    ledger.bankroll.current = computeCurrentBankroll(ledger, bet)
  }

  // Incremental analytics rebuild (fast: only when data changes).
  ledger.analytics = rebuildAnalytics(ledger.bets, ledger.bankroll.current, ledger.bankroll.initial)
  ledger.analytics.bankrollCurve = updateBankrollCurve(
    ledger.analytics.bankrollCurve || [],
    bet.date,
    ledger.bankroll.current,
  )
  ledger.updatedAt = new Date().toISOString()

  if (save) saveLedger(ledger)
  return { ledger, bet, isNew }
}

/**
 * Settle a bet by id: sets result, payout, actualStat.
 */
function settleBet(id, { result, payout, actualStat, note } = {}, { save = true } = {}) {
  const ledger = loadLedger()
  const bet = ledger.bets.find((b) => b.id === id)
  if (!bet) return { ok: false, reason: "not_found" }

  const r = String(result || "").toLowerCase()
  if (!["win", "loss", "push", "void"].includes(r)) {
    return { ok: false, reason: "invalid_result", valid: ["win", "loss", "push", "void"] }
  }

  bet.result = r
  bet.settledAt = new Date().toISOString()
  if (Number.isFinite(num(payout))) bet.payout = num(payout)
  if (Number.isFinite(num(actualStat))) bet.actualStat = num(actualStat)
  if (note) bet.note = (bet.note ? bet.note + " | " : "") + String(note).slice(0, 200)

  const prevBalance = ledger.bankroll.current
  ledger.bankroll.current = computeCurrentBankroll({ bankroll: { current: prevBalance } }, bet)
  ledger.analytics = rebuildAnalytics(ledger.bets, ledger.bankroll.current, ledger.bankroll.initial)
  ledger.analytics.bankrollCurve = updateBankrollCurve(
    ledger.analytics.bankrollCurve || [],
    bet.date,
    ledger.bankroll.current,
  )
  ledger.updatedAt = new Date().toISOString()

  if (save) saveLedger(ledger)
  return { ok: true, bet, prevBalance, newBalance: ledger.bankroll.current }
}

/**
 * Batch-settle multiple bets from a results map: { [id]: "win" | "loss" | ... }
 * Also accepts { actualStat, payout } per entry if passed as object.
 */
function batchSettle(resultsMap = {}, { save = true } = {}) {
  const ledger = loadLedger()
  const applied = []
  for (const [id, value] of Object.entries(resultsMap)) {
    const bet = ledger.bets.find((b) => b.id === id)
    if (!bet) continue
    const r = typeof value === "object" && value !== null ? String(value.result || "").toLowerCase() : String(value).toLowerCase()
    if (!["win", "loss", "push", "void"].includes(r)) continue
    const prevBalance = ledger.bankroll.current
    bet.result = r
    bet.settledAt = new Date().toISOString()
    if (typeof value === "object") {
      if (Number.isFinite(num(value.payout))) bet.payout = num(value.payout)
      if (Number.isFinite(num(value.actualStat))) bet.actualStat = num(value.actualStat)
    }
    ledger.bankroll.current = computeCurrentBankroll({ bankroll: { current: prevBalance } }, bet)
    applied.push({ id, result: r, prevBalance, newBalance: ledger.bankroll.current })
  }
  ledger.analytics = rebuildAnalytics(ledger.bets, ledger.bankroll.current, ledger.bankroll.initial)
  ledger.updatedAt = new Date().toISOString()
  if (save) saveLedger(ledger)
  return { applied, count: applied.length }
}

/**
 * Generate a nightly report from the current ledger.
 *
 * Returns a structured report; also uses the review engine state if available
 * to cross-reference model-vs-user outcomes.
 */
function buildNightlyReport({ sport = null, date = todayKey(), windowDays = 30 } = {}) {
  const ledger = loadLedger()
  const bets = ledger.bets
  const a = ledger.analytics

  // Date-windowed bets.
  const windowStart = (() => {
    const d = new Date()
    d.setDate(d.getDate() - windowDays)
    return d.toISOString().slice(0, 10)
  })()
  const recent = bets.filter(
    (b) => b.date >= windowStart && (!sport || b.sport === String(sport).toLowerCase()),
  )
  const settled = recent.filter((b) => b.result !== "pending")
  const wins = settled.filter((b) => b.result === "win")
  const losses = settled.filter((b) => b.result === "loss")

  // ROI over window.
  const windowStaked = settled.reduce((s, b) => s + (num(b.stake) ?? 0), 0)
  const windowProfit = settled.reduce((s, b) => {
    const r = b.result
    const stake = num(b.stake) ?? 0
    const toWin = num(b.toWin) ?? 0
    const payout = num(b.payout ?? b.cashout ?? null)
    if (r === "win") return s + (Number.isFinite(payout) ? payout - stake : toWin)
    if (r === "loss") return s - stake
    return s
  }, 0)
  const windowRoi = windowStaked > 0 ? round4(windowProfit / windowStaked) : null

  // Best / worst by profit.
  const byBet = settled.map((b) => {
    const stake = num(b.stake) ?? 0
    const toWin = num(b.toWin) ?? 0
    const payout = num(b.payout ?? null)
    const profit = b.result === "win"
      ? (Number.isFinite(payout) ? payout - stake : toWin)
      : b.result === "loss" ? -stake : 0
    return { ...b, profit: round2(profit) }
  })
  const sorted = [...byBet].sort((a, b) => b.profit - a.profit)
  const bestBets = sorted.slice(0, 5)
  const worstBets = [...byBet].sort((a, b) => a.profit - b.profit).slice(0, 5)

  // Decision analysis — user vs model.
  const followed = settled.filter((b) => b.decisionType === "followed")
  const modified = settled.filter((b) => b.decisionType === "modified")
  const ignored = settled.filter((b) => b.decisionType === "ignored")
  const custom = settled.filter((b) => b.decisionType === "custom")

  function winRate(arr) {
    const w = arr.filter((b) => b.result === "win").length
    return arr.length ? round4(w / arr.length) : null
  }

  // Ladder aggressiveness: bets where user went harder than model.
  const aggressive = modified.filter((b) => num(b.aggressionDelta) > 0)
  const conservative = modified.filter((b) => num(b.aggressionDelta) < 0)

  // Near misses in window.
  const nearMisses = settled
    .map((b) => {
      const nm = classifyNearMiss(b)
      return nm ? { ...b, ...nm } : null
    })
    .filter(Boolean)
    .slice(-12)

  // Prop type breakdown.
  const propRoi = Object.entries(a.byStat)
    .filter(([, v]) => v.settled >= 3)
    .map(([stat, v]) => ({ stat, settled: v.settled, wins: v.wins, roi: v.roi, profit: v.profit }))
    .sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity))

  // Bankroll curve delta.
  const curve = a.bankrollCurve || []
  const curveStart = curve.find((e) => e.date >= windowStart)?.balance ?? ledger.bankroll.initial
  const curveEnd = curve[curve.length - 1]?.balance ?? ledger.bankroll.current
  const bankrollDelta = round2(curveEnd - curveStart)
  const bankrollDeltaPct = curveStart > 0 ? round4(bankrollDelta / curveStart) : null

  // Smartest decisions: followed model, won, high odds.
  const withProfit = (arr) => arr.map((b) => {
    const stake = num(b.stake) ?? 0
    const toWin = num(b.toWin) ?? 0
    const payout = num(b.payout ?? null)
    const profit = b.result === "win" ? (Number.isFinite(payout) ? payout - stake : toWin)
      : b.result === "loss" ? -stake : 0
    return { ...b, profit: round2(profit) }
  })

  const smartest = withProfit(followed.filter((b) => b.result === "win"))
    .sort((a, b) => Math.abs(num(b.odds) ?? 0) - Math.abs(num(a.odds) ?? 0))
    .slice(0, 5)

  // Biggest mistakes: ignored model or overrode, lost.
  const mistakes = withProfit([...ignored.filter((b) => b.result === "loss"),
    ...aggressive.filter((b) => b.result === "loss")])
    .sort((a, b) => Math.abs(num(b.aggressionDelta) ?? 0) - Math.abs(num(a.aggressionDelta) ?? 0))
    .slice(0, 5)

  // Pull in review-engine confidence adjustments for comparison (optional).
  let reviewState = null
  if (sport) {
    const { stateFile } = require("./buildPostGameReview")
    reviewState = readJsonSafe(stateFile(sport), null)
  }
  const confAdj = reviewState?.confidenceAdjustments?.byStat || null

  return {
    metadata: {
      version: CURRENT_VERSION,
      generatedAt: new Date().toISOString(),
      windowDays,
      date,
      sport: sport || "all",
    },
    bankroll: {
      initial: ledger.bankroll.initial,
      current: round2(ledger.bankroll.current),
      delta: bankrollDelta,
      deltaPct: bankrollDeltaPct,
      unitSize: round2(ledger.bankroll.unitSize),
      curve: curve.filter((e) => e.date >= windowStart),
    },
    summary: {
      totalBets: recent.length,
      settled: settled.length,
      pending: recent.length - settled.length,
      wins: wins.length,
      losses: losses.length,
      winRate: winRate(settled),
      totalStaked: round2(windowStaked),
      totalProfit: round2(windowProfit),
      roi: windowRoi,
    },
    bestBets: bestBets.map(({ id, date, sport, player, statFamily, side, line, odds, stake, profit, decisionType }) =>
      ({ id, date, sport, player, statFamily, side, line, odds, stake, profit, decisionType })),
    worstBets: worstBets.map(({ id, date, sport, player, statFamily, side, line, odds, stake, profit, decisionType }) =>
      ({ id, date, sport, player, statFamily, side, line, odds, stake, profit, decisionType })),
    decision: {
      followed: { count: followed.length, winRate: winRate(followed) },
      modified: { count: modified.length, winRate: winRate(modified) },
      ignored: { count: ignored.length, winRate: winRate(ignored) },
      custom: { count: custom.length, winRate: winRate(custom) },
      aggressiveMods: { count: aggressive.length, winRate: winRate(aggressive) },
      conservativeMods: { count: conservative.length, winRate: winRate(conservative) },
      smartest: smartest.map(({ player, prop, odds, profit }) => ({ player, prop, odds, profit })),
      mistakes: mistakes.map(({ player, prop, odds, aggressionDelta, profit }) => ({ player, prop, odds, aggressionDelta, profit })),
    },
    propBreakdown: propRoi.slice(0, MAX_BETS_IN_REPORT),
    byTier: a.byTier,
    bySportsbook: a.bySportsbook,
    nearMisses: nearMisses.map(({ player, statFamily, side, line, actualStat, category, narrative, delta, date }) =>
      ({ date, player, statFamily, side, line, actualStat, category, narrative, delta })),
    modelComparison: confAdj || null,
    clv: buildClvAnalytics(recent),
  }
}

/**
 * Import model-recommended bets from an existing tracked_bets file and add
 * them to the ledger as "pending" with decisionType="followed" by default.
 * Useful to seed tonight's bets before tip-off.
 *
 * Only inserts bets not already in the ledger (id collision = skip).
 */
function importFromTrackedBets({ sport, date, stakes = {}, defaultStake = 10, overrideDecision = null } = {}) {
  const trackedPath = path.join(
    TRACKING_DIR,
    `${String(sport).toLowerCase()}_tracked_bets_${date}.json`,
  )
  const tracked = readJsonSafe(trackedPath, [])
  if (!Array.isArray(tracked) || !tracked.length) {
    return { ok: false, reason: "no_tracked_bets_for_date", trackedPath }
  }

  const ledger = loadLedger()
  const existingIds = new Set(ledger.bets.map((b) => b.id))
  const added = []

  for (const t of tracked) {
    // Build a personal ledger id from the tracked bet shape.
    const personId = stableId(sport, t.date, t.player, t.statFamily, t.side, t.line, t.sportsbook)
    if (existingIds.has(personId)) continue

    const stake = num(stakes[t.id] ?? stakes[personId] ?? defaultStake)
    addOrUpdateBet({
      id: personId,
      date: t.date,
      sport,
      sportsbook: t.sportsbook,
      player: t.player,
      // game context — both present in leanBet output
      eventId: t.eventId || null,
      matchup: t.matchup || null,
      statFamily: t.statFamily,
      prop: t.prop,
      side: t.side,
      line: t.line,
      odds: t.oddsAmerican,
      stake,
      // model reference — map all available tracked_bets fields
      modelLine: t.line,
      modelOdds: t.oddsAmerican,
      modelProb: t.modelProb != null ? t.modelProb : null,
      modelTier: t.tier,
      confidenceTier: t.tier,
      decisionType: overrideDecision || "followed",
      result: t.result || "pending",
      // compact projection snapshot from lean tracked_bets data
      modelSnapshot: {
        edge: t.edge != null ? t.edge : null,
        calibratedConfidence: t.confidence != null ? t.confidence : null,
        // impliedProb from sportsbook odds (already in tracked_bets)
        sbImpliedProb: t.impliedProb != null ? t.impliedProb : null,
      },
    }, { ledger, save: false })

    existingIds.add(personId)
    added.push(personId)
  }

  saveLedger(ledger)
  return { ok: true, added: added.length, skipped: tracked.length - added.length }
}

// ─── CLV snapshot helpers ─────────────────────────────────────────────────────

/**
 * Build the initial clvSnapshot for a new bet (placed fields only; close = null).
 * If input already has a pre-filled clvSnapshot (e.g. re-import), merge it in.
 */
function buildClvSnapshot(input, odds, line, sbImpliedProb) {
  const existing = input.clvSnapshot && typeof input.clvSnapshot === "object"
    ? input.clvSnapshot : null
  const placed = {
    line: line ?? null,
    odds: odds ?? null,
    impliedProb: Number.isFinite(sbImpliedProb) ? round4(sbImpliedProb) : null,
    sportsbook: String(input.sportsbook || "").toLowerCase() || null,
    timestamp: existing?.placed?.timestamp || new Date().toISOString(),
  }
  // Preserve any existing close / clv data (e.g. on updates)
  const close = existing?.close ?? null
  const clv = (close && placed.odds != null)
    ? existing?.clv ?? null
    : null
  return { placed, close, clv }
}

/**
 * Record the closing line/odds on a specific bet and compute CLV.
 *
 * @param {string} id — ledger bet id
 * @param {object} closeData
 *   { closingLine, closingOdds, closingSportsbook, closedAt }
 * @param {{ save?: boolean }} opts
 */
function setClosingLine(id, { closingLine, closingOdds, closingSportsbook, closedAt } = {}, { save = true } = {}) {
  const ledger = loadLedger()
  const bet = ledger.bets.find((b) => b.id === id)
  if (!bet) return { ok: false, reason: "not_found" }

  const cOdds = num(closingOdds)
  const cLine = num(closingLine)
  if (!Number.isFinite(cOdds)) return { ok: false, reason: "closingOdds_required" }

  const prev = bet.clvSnapshot || {}
  const placed = prev.placed || {}

  const clvResult = computeClv({
    placedOdds: placed.odds,
    closingOdds: cOdds,
    placedLine: placed.line,
    closingLine: cLine ?? placed.line,
    side: bet.side,
    sportsbook: placed.sportsbook,
    closingSportsbook: closingSportsbook || placed.sportsbook || null,
  })

  bet.clvSnapshot = {
    placed,
    close: {
      line: cLine ?? placed.line,
      odds: cOdds,
      impliedProb: clvResult.closingImpliedProb,
      sportsbook: closingSportsbook || placed.sportsbook || null,
      timestamp: closedAt || new Date().toISOString(),
    },
    clv: clvResult,
  }

  ledger.updatedAt = new Date().toISOString()
  if (save) saveLedger(ledger)
  return { ok: true, bet, clv: clvResult }
}

/**
 * Batch-set closing lines from a map: { [id]: { closingOdds, closingLine, closingSportsbook } }
 * Useful for nightly close capture from a snapshot file.
 */
function batchSetClosingLines(closingMap = {}, { save = true } = {}) {
  const ledger = loadLedger()
  const applied = []
  for (const [id, data] of Object.entries(closingMap)) {
    const bet = ledger.bets.find((b) => b.id === id)
    if (!bet) continue
    const cOdds = num(data.closingOdds ?? data.odds)
    if (!Number.isFinite(cOdds)) continue
    const cLine = num(data.closingLine ?? data.line)
    const prev = bet.clvSnapshot || {}
    const placed = prev.placed || {}
    const clvResult = computeClv({
      placedOdds: placed.odds,
      closingOdds: cOdds,
      placedLine: placed.line,
      closingLine: cLine ?? placed.line,
      side: bet.side,
      sportsbook: placed.sportsbook,
      closingSportsbook: data.closingSportsbook || placed.sportsbook || null,
    })
    bet.clvSnapshot = {
      placed,
      close: {
        line: cLine ?? placed.line,
        odds: cOdds,
        impliedProb: clvResult.closingImpliedProb,
        sportsbook: data.closingSportsbook || placed.sportsbook || null,
        timestamp: data.closedAt || new Date().toISOString(),
      },
      clv: clvResult,
    }
    applied.push({ id, clvScore: clvResult.clvScore, quality: clvResult.quality })
  }
  ledger.updatedAt = new Date().toISOString()
  if (save) saveLedger(ledger)
  return { applied, count: applied.length }
}

/**
 * Extract a compact modelSnapshot from a bestBetsBoard play object.
 * Use this when logging a bet directly from the board output rather than
 * from tracked_bets, so that richer projection context is captured.
 *
 * Returns an object suitable for passing as `input.modelSnapshot`.
 */
function snapshotFromPlay(play) {
  if (!play || typeof play !== "object") return {}
  const stats = play.stats || {}
  return {
    projectedStat: stats.median != null ? num(stats.median) : null,
    projectedRangeLow: stats.floor != null ? num(stats.floor) : null,
    projectedRangeHigh: stats.ceiling != null ? num(stats.ceiling) : null,
    confidenceRaw: play.confidenceRaw != null ? num(play.confidenceRaw) : null,
    calibratedConfidence: play.confidence != null ? num(play.confidence) : null,
    edge: play.edge != null ? num(play.edge) : null,
    modelRanking: play.rank != null ? num(play.rank) : null,
    archetype: play.archetype || play.tag || null,
  }
}

module.exports = {
  loadLedger,
  saveLedger,
  addOrUpdateBet,
  settleBet,
  batchSettle,
  buildNightlyReport,
  importFromTrackedBets,
  setClosingLine,
  batchSetClosingLines,
  snapshotFromPlay,
  applyIntegrityGate,
  LEDGER_FILE,
}
