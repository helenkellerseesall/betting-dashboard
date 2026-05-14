"use strict"

/**
 * Universal post-game review engine.
 *
 * One shared pipeline for NBA + MLB (and future NFL/NHL). Reads the existing
 * <sport>_tracked_bets_<date>.json + <sport>_tracked_slips_<date>.json files
 * (no duplicate storage), merges in optional `actuals` (e.g. supplied via the
 * update*Results.js CLI), classifies misses via a sport adapter, and updates
 * a compact rolling state file:
 *
 *   backend/runtime/tracking/post_game_review_<sport>_<date>.json   (per-night)
 *   backend/runtime/tracking/post_game_review_state_<sport>.json    (rolling)
 *
 * Lightweight: rolling state caps history to MAX_HISTORY_DAYS days and
 * MAX_PLAYER_TAGS players. No giant snapshot duplication.
 */

const fs = require("fs")
const path = require("path")

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")
const MAX_HISTORY_DAYS = 30
const MAX_PLAYER_TAGS = 250
const PLAYER_RECENT_RESULTS_CAP = 12

const ADAPTERS = {
  nba: require("./adapters/nbaAdapter"),
  mlb: require("./adapters/mlbAdapter"),
}

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

function fileFor(prefix, date) {
  return path.join(TRACKING_DIR, `${prefix}${date}.json`)
}

function reviewFile(sport, date) {
  return path.join(TRACKING_DIR, `post_game_review_${sport}_${date}.json`)
}

function stateFile(sport) {
  return path.join(TRACKING_DIR, `post_game_review_state_${sport}.json`)
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function emptyState() {
  return {
    version: "post-game-review-v1",
    updatedAt: null,
    history: [], // [{ date, totals, byStat, byTier, archetypeShifts }]
    players: {}, // playerKey -> { name, samples, recent: [...] }
    archetypes: {}, // archetypeKey -> { samples, hits, lastSeen }
    environments: {}, // envKey -> { samples, deltas: { sum, sumSq } }
    confidenceAdjustments: { byStat: {}, byTier: {} },
  }
}

function normalizeKey(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function pickAdapter(sport) {
  const a = ADAPTERS[String(sport || "").toLowerCase()]
  if (!a) throw new Error(`unsupported sport: ${sport}`)
  return a
}

/** Merge an `actuals` map onto a list of tracked bets without rewriting files. */
function mergeActualsOntoBets(bets, actuals = {}) {
  if (!Array.isArray(bets)) return []
  if (!actuals || typeof actuals !== "object") return bets
  return bets.map((b) => {
    const a = actuals[b.id] || actuals[b.legId] || null
    if (!a || typeof a !== "object") return b
    const stat = num(a.stat ?? a.actual ?? a.value)
    const out = { ...b }
    if (Number.isFinite(stat)) out.actualStat = stat
    if (a.environment && typeof a.environment === "object") {
      out.environment = { ...(b.environment || {}), ...a.environment }
    }
    if (a.archetype) out.archetypeHint = String(a.archetype)
    return out
  })
}

/** Pure: compute hit/miss + delta + adapter "why" tags. */
function classifyBet(sport, bet) {
  const adapter = pickAdapter(sport)
  const line = num(bet.line)
  // Phase 1E (INC-013 fix): gradeTrackedBets writes `actualValue`; legacy callers
  // (mergeActualsOntoBets) write `actualStat`. Read both so classification works
  // for tracked_bets (primary path) without breaking the legacy actuals merge path.
  const stat = num(bet.actualValue ?? bet.actualStat)
  const side = String(bet.side || "").toLowerCase()
  let hit = null
  let delta = null
  if (Number.isFinite(stat) && Number.isFinite(line)) {
    delta = stat - line
    if (side.startsWith("o") || side === "yes") hit = stat > line
    else if (side.startsWith("u") || side === "no") hit = stat < line
  }
  // Honor a graded `result` if it disagrees (e.g. push, void).
  const r = String(bet.result || "").toLowerCase()
  if (r === "push" || r === "void") hit = null

  const whyTags = adapter.classifyMiss(bet, { hit, delta }) || []
  const archetypes = adapter.detectArchetypes(bet, { hit, delta }) || []
  const environment = adapter.environmentTags(bet) || []

  return { hit, delta, whyTags, archetypes, environment }
}

function pushPlayerSample(state, bet, classification) {
  const key = normalizeKey(bet.player)
  if (!key) return
  const entry =
    state.players[key] || (state.players[key] = { name: bet.player, samples: 0, recent: [] })
  entry.samples += 1
  entry.recent.push({
    date: bet.date,
    statFamily: bet.statFamily,
    side: bet.side,
    line: bet.line,
    actualStat: bet.actualStat ?? null,
    delta: classification.delta,
    hit: classification.hit,
    why: classification.whyTags,
    archetype: classification.archetypes,
  })
  if (entry.recent.length > PLAYER_RECENT_RESULTS_CAP) {
    entry.recent.splice(0, entry.recent.length - PLAYER_RECENT_RESULTS_CAP)
  }
}

function bumpArchetype(state, archetypes, hit) {
  for (const a of Array.isArray(archetypes) ? archetypes : []) {
    const key = normalizeKey(a)
    if (!key) continue
    const e = state.archetypes[key] || (state.archetypes[key] = { samples: 0, hits: 0, lastSeen: null })
    e.samples += 1
    if (hit === true) e.hits += 1
    e.lastSeen = new Date().toISOString().slice(0, 10)
  }
}

function bumpEnvironment(state, env, delta) {
  for (const tag of Array.isArray(env) ? env : []) {
    const key = normalizeKey(tag)
    if (!key) continue
    const e =
      state.environments[key] || (state.environments[key] = { samples: 0, deltas: { sum: 0, sumSq: 0 } })
    e.samples += 1
    if (Number.isFinite(delta)) {
      e.deltas.sum += delta
      e.deltas.sumSq += delta * delta
    }
  }
}

function recomputeConfidenceAdjustments(state) {
  const byStat = {}
  const byTier = {}
  const seenStats = new Set()
  const seenTiers = new Set()
  for (const p of Object.values(state.players)) {
    for (const r of p.recent) {
      if (r.statFamily) seenStats.add(r.statFamily)
    }
  }
  for (const stat of seenStats) {
    let s = 0
    let h = 0
    for (const p of Object.values(state.players)) {
      for (const r of p.recent) {
        if (r.statFamily !== stat) continue
        if (r.hit === true || r.hit === false) {
          s += 1
          if (r.hit === true) h += 1
        }
      }
    }
    if (s >= 8) {
      const hitRate = h / s
      // Smooth toward 1.0 baseline (slight nudge, not aggressive).
      const mult = 0.7 * 1 + 0.3 * (hitRate / 0.5)
      byStat[stat] = {
        samples: s,
        hitRate: round4(hitRate),
        multiplier: round4(Math.max(0.7, Math.min(1.25, mult))),
        reason: "rolling hit-rate adjustment",
      }
    } else {
      byStat[stat] = { samples: s, hitRate: null, multiplier: 1, reason: "insufficient sample (<8)" }
    }
  }
  // Tier adjustment uses the daily history, not players (keeps it cheap).
  for (const day of state.history) {
    if (day?.byTier) for (const t of Object.keys(day.byTier)) seenTiers.add(t)
  }
  for (const tier of seenTiers) {
    let s = 0
    let h = 0
    for (const day of state.history) {
      const t = day?.byTier?.[tier]
      if (!t) continue
      s += t.settled || 0
      h += t.wins || 0
    }
    if (s >= 8) {
      const hitRate = h / Math.max(1, s)
      const mult = 0.7 * 1 + 0.3 * (hitRate / 0.5)
      byTier[tier] = {
        samples: s,
        hitRate: round4(hitRate),
        multiplier: round4(Math.max(0.7, Math.min(1.25, mult))),
        reason: "rolling tier hit-rate",
      }
    } else {
      byTier[tier] = { samples: s, hitRate: null, multiplier: 1, reason: "insufficient sample (<8)" }
    }
  }
  state.confidenceAdjustments = { byStat, byTier }
}

function trimState(state) {
  if (state.history.length > MAX_HISTORY_DAYS) {
    state.history.splice(0, state.history.length - MAX_HISTORY_DAYS)
  }
  // Keep most-active players; drop tail if we exceed the cap.
  const playerKeys = Object.keys(state.players)
  if (playerKeys.length > MAX_PLAYER_TAGS) {
    const ranked = playerKeys
      .map((k) => ({ k, samples: state.players[k]?.samples || 0 }))
      .sort((a, b) => b.samples - a.samples)
      .slice(MAX_PLAYER_TAGS)
    for (const r of ranked) delete state.players[r.k]
  }
}

function tierTotalsFromBets(bets) {
  const out = {}
  for (const b of bets) {
    const t = String(b.tier || "UNKNOWN")
    const r = String(b.result || "").toLowerCase()
    const e = out[t] || (out[t] = { total: 0, wins: 0, losses: 0, pushes: 0, voids: 0, settled: 0 })
    e.total += 1
    if (r === "win") {
      e.wins += 1
      e.settled += 1
    } else if (r === "loss") {
      e.losses += 1
      e.settled += 1
    } else if (r === "push") {
      e.pushes += 1
      e.settled += 1
    } else if (r === "void") {
      e.voids += 1
      e.settled += 1
    }
  }
  return out
}

function statTotalsFromBets(bets) {
  const out = {}
  for (const b of bets) {
    const f = String(b.statFamily || "unknown")
    const r = String(b.result || "").toLowerCase()
    const e = out[f] || (out[f] = { total: 0, wins: 0, losses: 0, settled: 0 })
    e.total += 1
    if (r === "win") {
      e.wins += 1
      e.settled += 1
    } else if (r === "loss") {
      e.losses += 1
      e.settled += 1
    }
  }
  return out
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function buildDailySummary(date, sport, classifiedBets) {
  const overperformers = []
  const underperformers = []
  const missedProjections = []
  const wellCalibrated = []
  const volatilitySpikes = []
  const archetypeCounts = {}

  for (const b of classifiedBets) {
    const c = b.__classification
    if (!c) continue
    const delta = c.delta
    if (Number.isFinite(delta)) {
      const sign = c.hit === true ? "+" : c.hit === false ? "-" : ""
      const row = {
        player: b.player,
        statFamily: b.statFamily,
        side: b.side,
        line: b.line,
        actualStat: b.actualStat ?? null,
        delta: round4(delta),
        result: b.result,
        why: c.whyTags,
        sign,
      }
      if (delta >= 1.5) overperformers.push(row)
      if (delta <= -1.5) underperformers.push(row)
      if (c.hit === false && Math.abs(delta) >= 1) missedProjections.push(row)
      if (c.hit === true && Math.abs(delta) <= 0.5 && Number.isFinite(b.confidence) && b.confidence >= 0.6)
        wellCalibrated.push(row)
      if (Number.isFinite(b.volatility) && b.volatility >= 0.4 && Math.abs(delta) >= 1.5)
        volatilitySpikes.push(row)
    }
    for (const a of c.archetypes || []) {
      const k = normalizeKey(a)
      if (k) archetypeCounts[k] = (archetypeCounts[k] || 0) + 1
    }
  }

  const order = (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
  overperformers.sort(order)
  underperformers.sort(order)
  missedProjections.sort(order)
  volatilitySpikes.sort(order)

  return {
    metadata: {
      sport,
      date,
      version: "post-game-review-v1",
      generatedAt: new Date().toISOString(),
    },
    totals: {
      bets: classifiedBets.length,
      settled: classifiedBets.filter((b) => {
        const r = String(b.result || "").toLowerCase()
        return r === "win" || r === "loss" || r === "push" || r === "void"
      }).length,
      withActuals: classifiedBets.filter((b) => Number.isFinite(num(b.actualStat))).length,
    },
    byTier: tierTotalsFromBets(classifiedBets),
    byStat: statTotalsFromBets(classifiedBets),
    archetypeCounts,
    topOverperformers: overperformers.slice(0, 12),
    topUnderperformers: underperformers.slice(0, 12),
    missedProjections: missedProjections.slice(0, 12),
    bestCalibrated: wellCalibrated.slice(0, 12),
    volatilitySpikes: volatilitySpikes.slice(0, 12),
  }
}

/**
 * Public — run the post-game review for one (sport, date).
 *
 *   sport:    "nba" | "mlb"
 *   date:     "YYYY-MM-DD"
 *   actuals:  optional { [betId]: { stat, environment?, archetype? } }
 *   write:    if true, persist daily review + rolling state files
 */
function runPostGameReview({ sport, date, actuals = {}, write = true } = {}) {
  if (!sport || !date) throw new Error("sport and date are required")
  const key = String(sport).toLowerCase()
  pickAdapter(key) // throws on unsupported

  const betsPath = fileFor(`${key}_tracked_bets_`, date)
  const slipsPath = fileFor(`${key}_tracked_slips_`, date)
  const bets = mergeActualsOntoBets(readJsonSafe(betsPath, []) || [], actuals)
  const slips = readJsonSafe(slipsPath, []) || []

  const classified = bets.map((b) => {
    const c = classifyBet(key, b)
    return Object.assign({}, b, { __classification: c })
  })

  // ── Intelligence outcome settlement (additive — never breaks review pipeline) ─
  try {
    const intel = require("../../storage/intelligence")
    // Bet outcomes — only settled (non-pending) entries
    const settlements = classified
      .filter((b) => b.result && b.result !== "pending")
      .map((b) => {
        const predId = intel.predictionId(
          b.date || date, key,
          b.player, b.statFamily, b.side, b.line, b.sportsbook
        )
        const hitFlag = b.__classification.hit
        return {
          id:          predId,
          hit:         hitFlag != null ? (hitFlag ? 1 : 0) : null,
          // Phase 1E (INC-013 fix): companion read so outcome_snapshots.actual_value
          // populates from gradeTrackedBets' `actualValue` (primary writer) while
          // preserving the legacy `actualStat` fallback used by mergeActualsOntoBets.
          actualValue: b.actualValue ?? b.actualStat ?? null,
          settledAt:   b.settledAt || new Date().toISOString(),
          notes:       b.result,
        }
      })
    if (settlements.length) {
      const r = intel.recordOutcomes(settlements, { sport: key, date })
      console.log(`[intel] ${key} outcomes: ${r?.recorded} recorded, ${r?.errors} errors`)
    }
    // Slip outcomes — only settled (non-pending) slips
    const settledSlips = slips.filter((s) => s.result && s.result !== "pending")
    for (const slip of settledSlips) {
      const legsHit = (slip.legs || []).filter((l) => l.result === "win").length
      intel.recordSlipOutcome(
        { ...slip, tier: slip.tier || slip.type },
        {
          legsHit,
          result:    slip.result,
          payoutDec: slip.result === "win" ? (slip.combinedDecimalOdds || 0) : 0,
          settledAt: slip.settledAt || null,
        },
        { sport: key, date }
      )
    }
    if (settledSlips.length) {
      console.log(`[intel] ${key} slip outcomes: ${settledSlips.length} processed`)
    }
  } catch (intelErr) {
    console.warn("[intel] outcome settlement skipped (non-fatal):", intelErr.message)
  }

  const state = readJsonSafe(stateFile(key), null) || emptyState()

  // Update rolling state.
  for (const b of classified) {
    const c = b.__classification
    pushPlayerSample(state, b, c)
    bumpArchetype(state, c.archetypes, c.hit)
    bumpEnvironment(state, c.environment, c.delta)
  }

  // Append per-day history (replace if already present).
  const daily = buildDailySummary(date, key, classified)
  state.history = state.history.filter((h) => h.date !== date)
  state.history.push({
    date,
    sport: key,
    totals: daily.totals,
    byStat: daily.byStat,
    byTier: daily.byTier,
    archetypeCounts: daily.archetypeCounts,
  })
  recomputeConfidenceAdjustments(state)
  trimState(state)
  state.updatedAt = new Date().toISOString()

  if (write) {
    writeJsonSync(reviewFile(key, date), daily)
    writeJsonSync(stateFile(key), state)
  }

  return {
    review: daily,
    state,
    counts: { bets: bets.length, slips: slips.length, classified: classified.length },
  }
}

module.exports = {
  runPostGameReview,
  // exported for tests / introspection
  classifyBet,
  mergeActualsOntoBets,
  buildDailySummary,
  emptyState,
  reviewFile,
  stateFile,
}
