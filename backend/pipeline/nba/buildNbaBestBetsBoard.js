"use strict"

console.log("ACTIVE:", __filename)

/**
 * NBA Best Bets Board — converts existing player outcome predictions + market props
 * into edge / EV / tiered ranked plays. No re-projection: consumes predictions only.
 *
 * Input:
 *   {
 *     predictions: <output of buildNbaPlayerOutcomePredictions>,
 *     marketProps: [{ player, eventId?, statFamily, line, oddsAmerican, side, sportsbook? }]
 *   }
 *
 * Output:
 *   {
 *     corePlays: [...],   // ELITE + STRONG only
 *     allPlays:  [...],   // PLAYABLE+ retained, FADE dropped
 *     meta: { generatedAt, evaluated, kept, dropped }
 *   }
 */

const STAT_FAMILIES = ["points", "threes", "rebounds", "assists", "pra"]

function americanOddsToImpliedProb(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100)
  return 100 / (n + 100)
}

function americanToDecimal(odds) {
  const n = Number(odds)
  if (!Number.isFinite(n) || n === 0) return null
  if (n < 0) return 1 + 100 / Math.abs(n)
  return 1 + n / 100
}

function minSigmaByFamily(family) {
  // 2026-05-24 — Lane 5 sigma tightening. Old values (5-7 for points/rebounds/pra)
  // produced ~12.5pt sigma for Wemby points (floor 20, ceiling 35). Combined with
  // a wide zScale, the model couldn't distinguish "line 6pts above L5" from
  // "line on L5" — all collapsed to ~50/50. Tighter sigma + tighter zScale below
  // let form actually dominate when the gap is meaningful.
  const f = String(family || "").toLowerCase()
  if (f === "points") return 4
  if (f === "rebounds") return 2.8
  if (f === "assists") return 2.0
  if (f === "threes") return 1.5
  if (f === "pra") return 5
  return 2
}

function zScaleByFamily(family) {
  // 2026-05-24 — Lane 5 sigma tightening. Same goal as minSigma above.
  // Old zScales (1.7-2.4) compounded with already-wide sigma to flatten the
  // logistic input. Now tighter scales let real signal magnitude show through.
  const f = String(family || "").toLowerCase()
  if (f === "rebounds") return 1.5
  if (f === "threes") return 1.4
  if (f === "assists") return 1.4
  if (f === "pra") return 1.3
  if (f === "points") return 1.2
  return 1.4
}

function probShrinkByFamily(family) {
  // 2026-05-24 — Lane 5 arithmetic fix (part 2). The old shrink values
  // (0.14–0.24) pulled 76-86% toward 0.50, clamping every modelProb into
  // ~[0.42, 0.58]. When market gave +300 (implied 0.25), the gap was always
  // +15-20pp = automatic ELITE edge regardless of whether the signal said
  // "this line is way above the player's L5." Operator caught this in
  // tracked_bets file 2026-05-24: SGA OVER 34.5 modelProb=0.489 with L5=27.6.
  //
  // Loosen shrink so the raw model probability dominates and the model can
  // produce honest sub-30% probabilities on inflated lines.
  const f = String(family || "").toLowerCase()
  if (f === "rebounds") return 0.50
  if (f === "threes") return 0.55
  if (f === "assists") return 0.55
  if (f === "pra") return 0.50
  if (f === "points") return 0.60
  return 0.55
}

/**
 * Estimate model probability of OVER `line` given a (floor, mostLikely, ceiling) band.
 * Calibrated to avoid overconfidence: sigma is intentionally wide.
 *
 * sigma = max(statMinSigma, (ceiling - floor) / 1.2)
 * z = (line - median) / (sigma * zScaleByFamily(family))  // family-specific flattening
 */
// 2026-05-25 — Hard sigma cap per family. Operator caught Mitchell UNDER
// pra 30.5 showing 43% model prob even though projection mostLikely was 45.3
// (model should say ~10% UNDER). Bug: sigma was computed as span/2.0, but
// range builder uses extreme percentiles so span (40+ PRA) inflates sigma to
// 20+, making the distribution useless. New approach: clamp sigma to
// reasonable per-family max + scale with projection magnitude.
function maxSigmaByFamily(family) {
  // 2026-05-25 — Loosened from earlier (6 → 9 pts, 2.8 → 3.5 reb, 8 → 12 pra)
  // because the prior cap combined with form-contradiction gate at 7% killed
  // ALL plays (Plays: 0 in last run). New values: still prevent sigma=20
  // pathology, but allow modelProb to actually beat implied prob on long odds.
  // Sweet spot — strict enough to fade obvious bads, loose enough to surface
  // legit +EV plays on +200 to +400 markets.
  const f = String(family || "").toLowerCase()
  if (f === "points")   return 9
  if (f === "rebounds") return 3.5
  if (f === "assists")  return 2.8
  if (f === "threes")   return 1.8
  if (f === "pra")      return 12
  return 4
}

function modelProbOver(family, stat, line, confidence = null) {
  if (!stat || !Number.isFinite(line)) return null
  const m = Number(stat.mostLikely)
  const f = Number(stat.floor)
  const c = Number(stat.ceiling)
  if (!Number.isFinite(m)) return null
  const lo = Number.isFinite(f) ? f : m * 0.7
  const hi = Number.isFinite(c) ? c : m * 1.3
  const span = Math.max(0.0001, hi - lo)
  // 2026-05-25 — Reconciled sigma. Three bounds:
  //   1. Floor: family minimum (prevents over-tight on low-volume players)
  //   2. Span-based estimate (preserves projection-band info)
  //   3. CEILING: family maximum (kills the "sigma=20" pathology)
  // Result: sigma stays in a sensible range so P(side) actually tracks the
  // gap between line and projection.
  const sigmaRaw = Math.max(minSigmaByFamily(family), span / 2.0)
  const sigma = Math.min(sigmaRaw, maxSigmaByFamily(family))
  const z = (line - m) / (sigma * zScaleByFamily(family))
  const pUnder = 1 / (1 + Math.exp(-z))
  const pOverRaw = 1 - pUnder
  return Math.max(0.0001, Math.min(0.9999, pOverRaw))
}

function modelProbForSide(family, stat, line, side, confidence = null) {
  const pOver = modelProbOver(family, stat, line, confidence)
  if (pOver == null) return null
  const s = String(side || "").toLowerCase()

  const m = Number(stat?.mostLikely)
  const f = Number(stat?.floor)
  const c = Number(stat?.ceiling)
  const lo = Number.isFinite(f) ? f : m * 0.7
  const hi = Number.isFinite(c) ? c : m * 1.3
  const span = Math.max(0.0001, hi - lo)
  // 2026-05-25 — Match the bounded sigma from modelProbOver. Cap prevents
  // the sigma=20 pathology that produced 43% UNDER prob on a 45-projection line.
  const sigmaRaw = Math.max(minSigmaByFamily(family), span / 2.0)
  const sigma = Math.min(sigmaRaw, maxSigmaByFamily(family))
  const dist = Math.abs(m - line)
  const conf = Number.isFinite(Number(confidence)) ? Number(confidence) : null

  // 2026-05-24 — Lane 5 fix: raised cap from 0.6/0.7 to 0.85. The old cap
  // mathematically prevented the model from ever saying "85% confident this
  // hits/misses" — combined with shrink toward 0.5, every prob was clamped
  // into ~[0.40, 0.60], guaranteeing fake edge on any long-odds market line.
  // Now cap is 0.85, allowing honest high-conviction picks when projection
  // strongly agrees with one side.
  const allowHigh = conf != null && conf >= 0.85 && dist >= sigma * 1.6
  const maxP = allowHigh ? 0.92 : 0.85
  const minP = 0.05

  const pSideRaw = s.startsWith("u") ? 1 - pOver : pOver
  const shrink = probShrinkByFamily(family)
  const pSideShrunk = 0.5 + (pSideRaw - 0.5) * shrink
  return Math.max(minP, Math.min(maxP, pSideShrunk))
}

/**
 * Confidence: how far the median sits from the line, scaled by band width.
 *   conf = clamp01(|median - line| / max(0.5, (ceiling - floor) / 2))
 */
function projectionConfidence(stat, line) {
  if (!stat || !Number.isFinite(line)) return 0
  const m = Number(stat.mostLikely)
  const f = Number(stat.floor)
  const c = Number(stat.ceiling)
  if (!Number.isFinite(m)) return 0
  const halfBand = Math.max(
    0.5,
    (Number.isFinite(c) && Number.isFinite(f) ? c - f : Math.abs(m) * 0.6) / 2
  )
  return Math.max(0, Math.min(1, Math.abs(m - line) / halfBand))
}

/**
 * Volatility: ceiling-minus-median gap normalized by median.
 * Higher = wider upside spread (rewarded slightly for overs near ceiling).
 */
function volatilityGap(stat) {
  if (!stat) return 0
  const m = Number(stat.mostLikely)
  const c = Number(stat.ceiling)
  if (!Number.isFinite(m) || !Number.isFinite(c) || m <= 0) return 0
  return Math.max(0, Math.min(1, (c - m) / m))
}

/**
 * Composite score for ranking. Combines edge, EV, confidence, volatility.
 */
function scorePlay({ edge, ev, conf, vol, side }) {
  const e = Number.isFinite(edge) ? edge : 0
  const v = Number.isFinite(ev) ? ev : 0
  const c = Number.isFinite(conf) ? conf : 0
  const g = Number.isFinite(vol) ? vol : 0
  const sideBoost = String(side || "").toLowerCase().startsWith("o") ? g * 0.15 : g * 0.05
  return e * 100 * 1.0 + v * 60 + c * 12 + sideBoost * 8
}

// 2026-05-24 — tierForPlay delegates to nbaTierClassifier. Previously this
// file had its own tier logic; now it's a thin wrapper preserving the call
// signature. See nbaTierClassifier.js for canonical rules.
// 2026-05-24 (later) — extended to pass side/line/l5Avg so the form-
// contradiction sanity gate inside the classifier can actually fire. The old
// signature dropped side/line/l5Avg → gate was structurally dead even though
// the code existed. Operator caught Wemby UNDER 20.5 / Champagnie OVER 3.5
// reaching PLAYABLE; this is the structural reason why.
const { classifyNbaTier: _classifyNbaTier } = require("./nbaTierClassifier")
function tierForPlay(edge, ev, conf, modelProb, side = null, line = null, l5Avg = null) {
  return _classifyNbaTier({ edge, ev, conf, modelProb, side, line, l5Avg })
}

// 2026-05-24 — buildPlayDisplayBundle is the canonical FE display payload.
// We stamp it onto every play (allPlays, longshotPlays, altPlays) so the FE
// never recomputes tags from raw row fields. Kills the shadow tag emitter in
// frontend/mobile/index.html.
const { buildPlayDisplayBundle } = require("./buildPlayDisplayBundle")

// 2026-05-24 — Real recent-form override. The upstream pipeline (nbaIsolatedRoutes
// applyProjectionRecentFormFallback) stamps row.recentForm with synthetic
// last5_avg = baseline = line whenever API-Sports has no data. That makes the
// form-contradiction gate impotent (overshoot = 0) AND puts misleading
// "L5 avg = line" tags on cards. The local nbaRecentFormCache reads from
// data/nbaPlayerGameLogs.json (espn source, real samples) and is the
// authoritative L5 truth for any star player. Call it here so the play.recentForm
// reflects reality before tier classification + display bundle.
let _enrichRowWithRecentFormLocal = null
try {
  _enrichRowWithRecentFormLocal = require("./nbaRecentFormCache").enrichRowWithRecentForm
} catch (_) { _enrichRowWithRecentFormLocal = null }

function overrideRecentFormFromLocalCache(mp, family) {
  if (!_enrichRowWithRecentFormLocal || !mp || typeof mp !== "object") return
  // Only override if the current recentForm is missing or is projection-fallback.
  const src = String(mp?.recentForm?.source || "").toLowerCase()
  const isProjFallback = src === "projection-fallback"
  const isMissingOrThin = !mp.recentForm || src === "" || mp.recentForm.sampleSize5 === 0
  if (!isProjFallback && !isMissingOrThin) return
  // The enricher reads row.statFamily or propType — make sure statFamily is set
  // so the cache lookup uses the canonical stat key.
  const probe = { player: mp.player, statFamily: family, propType: mp.propType }
  _enrichRowWithRecentFormLocal(probe)
  if (probe.recentForm && Number.isFinite(Number(probe.recentForm.last5_avg))) {
    mp.recentForm = probe.recentForm
    if (Number.isFinite(Number(probe.last5Avg))) mp.last5Avg = probe.last5Avg
    if (Number.isFinite(Number(probe.last10Avg))) mp.last10Avg = probe.last10Avg
  }
}

/**
 * Map opaque marketKey/propType strings to a normalized stat family used by predictions.
 */
function resolveStatFamily(marketProp) {
  const direct = String(marketProp?.statFamily || "").toLowerCase()
  if (STAT_FAMILIES.includes(direct)) return direct
  const s = `${marketProp?.propType || ""} ${marketProp?.marketKey || ""}`.toLowerCase()
  if (s.includes("points_rebounds_assists") || /\bpra\b/.test(s)) return "pra"
  // Combo markets we don't model as a first-class family yet (PR / PA / RA).
  // Returning null prevents mismatching them to single-stat bands (which creates fake edge).
  if (s.includes("points_rebounds") || /\bpr\b/.test(s)) return null
  if (s.includes("points_assists") || /\bpa\b/.test(s)) return null
  if (s.includes("rebounds_assists") || /\bra\b/.test(s)) return null
  if (s.includes("three") || s.includes("3pt") || s.includes("threes")) return "threes"
  if (s.includes("rebound")) return "rebounds"
  if (s.includes("assist")) return "assists"
  if (s.includes("point")) return "points"
  return null
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
}

/**
 * Index predictions.players by player + eventId for fast lookup.
 */
function indexPredictions(predictions) {
  const idx = new Map()
  const players = Array.isArray(predictions?.players) ? predictions.players : []
  for (const p of players) {
    if (!p?.player) continue
    const k1 = `${normalizeKey(p.player)}|${normalizeKey(p.eventId || "")}`
    const k2 = `${normalizeKey(p.player)}|`
    idx.set(k1, p)
    if (!idx.has(k2)) idx.set(k2, p)
  }
  return idx
}

function buildReasoning({ family, side, line, stat, edge, ev, conf, vol }) {
  const parts = []
  parts.push(
    `proj ${stat?.floor ?? "?"} / ${stat?.mostLikely ?? "?"} / ${stat?.ceiling ?? "?"} vs line ${line}`
  )
  parts.push(`edge ${(edge * 100).toFixed(1)}% • EV ${ev.toFixed(3)}`)
  if (conf >= 0.6) parts.push("high conf")
  else if (conf >= 0.35) parts.push("medium conf")
  else parts.push("low conf")
  if (side === "over" && vol >= 0.35) parts.push("upside band")
  if (side === "under" && vol <= 0.2) parts.push("tight ceiling")
  return parts.join(" | ")
}

/**
 * Build the bets board from predictions + market props.
 */
function buildNbaBestBetsBoard(input = {}) {
  const generatedAt = new Date().toISOString()
  const predictions = input?.predictions || null
  const marketProps = Array.isArray(input?.marketProps) ? input.marketProps : []

  if (!predictions || !Array.isArray(predictions.players) || !marketProps.length) {
    return {
      corePlays: [],
      allPlays: [],
      meta: {
        generatedAt,
        evaluated: 0,
        kept: 0,
        dropped: 0,
        reason: !predictions
          ? "no_predictions"
          : !marketProps.length
            ? "no_market_props"
            : "no_players",
      },
    }
  }

  const idx = indexPredictions(predictions)
  const allPlays = []
  const longshotPlays = []
  const altPlays = []
  let evaluated = 0
  let dropped = 0

  for (const mp of marketProps) {
    if (!mp || typeof mp !== "object") continue
    const family = resolveStatFamily(mp)
    if (!family) continue
    const player = mp.player
    const eventId = mp.eventId || ""
    const line = Number(mp.line)
    const side = String(mp.side || "").toLowerCase()
    const odds = Number(mp.oddsAmerican)
    if (!player || !Number.isFinite(line) || !Number.isFinite(odds)) continue
    if (side !== "over" && side !== "under") continue

    const k1 = `${normalizeKey(player)}|${normalizeKey(eventId)}`
    const k2 = `${normalizeKey(player)}|`
    const pred = idx.get(k1) || idx.get(k2)
    if (!pred) continue
    const stat = pred.stats?.[family]
    if (!stat) continue

    evaluated += 1

    const impliedProb = americanOddsToImpliedProb(odds)
    const decOdds = americanToDecimal(odds)
    const conf = projectionConfidence(stat, line)
    const modelProb = modelProbForSide(family, stat, line, side, conf)
    if (impliedProb == null || decOdds == null || modelProb == null) {
      dropped += 1
      continue
    }
    const edge = modelProb - impliedProb
    const ev = modelProb * (decOdds - 1) - (1 - modelProb)
    const vol = volatilityGap(stat)

    if (modelProb > 0.49 && modelProb < 0.51) {
      dropped += 1
      continue
    }
    const isLongshot = impliedProb < 0.1
    const inCoreOddsBand = odds >= -300 && odds <= 300
    const isAlternate =
      /alternate/i.test(String(mp?.marketKey || "")) ||
      /\bladder\b/i.test(String(mp?.propType || "")) ||
      /alternate/i.test(String(mp?.propType || "")) ||
      Boolean(mp?.ladder)

    // Keep longshots for optional display, but never allow them into corePlays.
    // Also filter them from normal edge/EV gating so they don't dominate rankings.
    if (!isLongshot && !isAlternate) {
      if (edge < 0.03 || ev <= 0) {
        dropped += 1
        continue
      }
      if (vol > 0.65 && edge < 0.05) {
        dropped += 1
        continue
      }
    }

    // 2026-05-24 — override projection-fallback recentForm with real local-cache
    // L5 BEFORE deriving l5Avg. Without this, mp.recentForm.last5_avg equals the
    // line (synthesized by applyProjectionRecentFormFallback) and the form-
    // contradiction gate inside classifyNbaTier sees overshoot=0 and never
    // FADEs. nbaRecentFormCache holds real espn-sourced game logs for any star.
    overrideRecentFormFromLocalCache(mp, family)

    // 2026-05-24 — wire l5Avg into tierForPlay so the form-contradiction
    // sanity gate fires. Reject projection-fallback as a valid source — its
    // last5_avg = baseline = line, which structurally masks the gate.
    const isRealForm = (rf) => {
      if (!rf || typeof rf !== "object") return false
      const src = String(rf.source || "").toLowerCase()
      return src !== "" && src !== "projection-fallback"
    }
    const mpRealRf   = isRealForm(mp?.recentForm)   ? mp.recentForm   : null
    const predRealRf = isRealForm(pred?.recentForm) ? pred.recentForm : null
    const l5Avg =
      (mpRealRf && (Number.isFinite(Number(mpRealRf.last5_avg)) ? Number(mpRealRf.last5_avg)
        : Number.isFinite(Number(mpRealRf.last10_avg)) ? Number(mpRealRf.last10_avg)
        : Number.isFinite(Number(mpRealRf.baseline))   ? Number(mpRealRf.baseline)
        : null)) ??
      (predRealRf && (Number.isFinite(Number(predRealRf.last5_avg)) ? Number(predRealRf.last5_avg)
        : Number.isFinite(Number(predRealRf.last10_avg)) ? Number(predRealRf.last10_avg)
        : null)) ??
      (Number.isFinite(Number(mp?.last5Avg)) ? Number(mp.last5Avg) : null)
    const tier = tierForPlay(edge, ev, conf, modelProb, side, line, l5Avg)
    if (!isLongshot && !isAlternate && tier === "FADE") {
      dropped += 1
      continue
    }

    const score = scorePlay({ edge, ev, conf, vol, side })
    // 2026-05-24 — matchup fallback. pred.matchup is often null when the
    // prediction shape doesn't carry the matchup string. Derive from
    // homeTeam/awayTeam on the marketProp when available.
    const matchupStr =
      pred.matchup ||
      mp.matchup ||
      (mp.awayTeam && mp.homeTeam ? `${mp.awayTeam} @ ${mp.homeTeam}` : null)
    const play = {
      player: pred.player,
      eventId: pred.eventId || eventId || null,
      matchup: matchupStr,
      team: mp.team || null,
      homeTeam: mp.homeTeam || null,
      awayTeam: mp.awayTeam || null,
      statFamily: family,
      side,
      line,
      oddsAmerican: odds,
      sportsbook: mp.sportsbook || mp.book || null,
      propType: mp.propType || null,
      marketKey: mp.marketKey || null,
      ladder: mp.ladder || null,
      impliedProb: round4(impliedProb),
      modelProb: round4(modelProb),
      edge: round4(edge),
      ev: round4(ev),
      confidence: round3(conf),
      volatility: round3(vol),
      tier: isLongshot ? "LONGSHOT" : tier,
      isLongshot,
      isAlternate,
      inCoreOddsBand,
      score: round2(score),
      range: {
        floor: stat.floor ?? null,
        mostLikely: stat.mostLikely ?? null,
        ceiling: stat.ceiling ?? null,
      },
      reasoning: buildReasoning({ family, side, line, stat, edge, ev, conf, vol }),
      // 2026-05-24 — Phase 2 enrichment passthrough. The enrichers stamp these
      // fields onto the market row (mp) and prediction row (pred) during cognition.
      // The play object now carries them so leanBestEntry can persist them and
      // the FE NBA tag emitter can render the new bullets.
      l5Avg: Number.isFinite(l5Avg) ? l5Avg : null,
      opponent: mp.opponent || pred.opponent || null,
      oppDef: Number.isFinite(mp.oppDef) ? mp.oppDef : (Number.isFinite(pred.oppDef) ? pred.oppDef : null),
      pace: Number.isFinite(mp.pace) ? mp.pace : (Number.isFinite(pred.pace) ? pred.pace : null),
      shots: Number.isFinite(mp.shots) ? mp.shots : null,
      astRate: Number.isFinite(mp.astRate) ? mp.astRate : null,
      rebRate: Number.isFinite(mp.rebRate) ? mp.rebRate : null,
      toRate: Number.isFinite(mp.toRate) ? mp.toRate : null,
      turnovers: Number.isFinite(mp.turnovers) ? mp.turnovers : null,
      playerSeasonStats: mp.playerSeasonStats || null,
      opponentStats: mp.opponentStats || null,
      recentForm: mp.recentForm || pred.recentForm || null,
      roleContext: mp.roleContext || pred.roleContext || null,
      // 2026-05-24 — also carry starter / projected-minutes / usage so the
      // displayBundle can compose role tags without re-mining roleContext.
      starterFlag: mp.starterFlag ?? pred.starterFlag ?? null,
      projectedMinutes: Number.isFinite(Number(mp.projectedMinutes))
        ? Number(mp.projectedMinutes)
        : (Number.isFinite(Number(pred.projectedMinutes)) ? Number(pred.projectedMinutes) : null),
      usageRate: Number.isFinite(Number(mp.usageRate))
        ? Number(mp.usageRate)
        : (Number.isFinite(Number(pred.usageRate)) ? Number(pred.usageRate) : null),
    }

    // 2026-05-24 — Stamp canonical display bundle. FE renders these tags as-is
    // (kills shadow tag emitter at frontend/mobile/index.html). Prop-aware:
    // points props get FG/3P/FT, rebounds props get OR/DR/rebRate, etc.
    try { play.displayBundle = buildPlayDisplayBundle(play) } catch (_) { play.displayBundle = null }

    if (isLongshot) longshotPlays.push(play)
    else if (isAlternate || !inCoreOddsBand) altPlays.push(play)
    else allPlays.push(play)
  }

  allPlays.sort((a, b) => b.score - a.score)
  const corePlays = allPlays.filter(
    (p) => p.inCoreOddsBand && !p.isAlternate && (p.tier === "ELITE" || p.tier === "STRONG")
  )

  return {
    corePlays,
    allPlays,
    longshotPlays,
    altPlays,
    meta: {
      generatedAt,
      evaluated,
      kept: allPlays.length,
      longshots: longshotPlays.length,
      alts: altPlays.length,
      dropped,
      tierCounts: tierCountsOf(allPlays),
    },
  }
}

function tierCountsOf(plays) {
  const out = { ELITE: 0, STRONG: 0, PLAYABLE: 0, FADE: 0 }
  for (const p of plays) out[p.tier] = (out[p.tier] || 0) + 1
  return out
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100
}
function round3(x) {
  return Math.round(Number(x) * 1000) / 1000
}
function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

/**
 * Helper: build marketProps from existing pool rows (e.g. completeUniverse) so callers
 * don't have to massage shapes. Skips rows without odds/line/side/player.
 *
 * 2026-05-24 — Phase 2 enrichment preservation. The play object in
 * buildNbaBestBetsBoard reads `mp.opponent`, `mp.oppDef`, `mp.pace`,
 * `mp.shots`, `mp.astRate`, `mp.rebRate`, `mp.toRate`, `mp.turnovers`,
 * `mp.playerSeasonStats`, `mp.opponentStats`, `mp.recentForm`,
 * `mp.roleContext` for downstream persistence to tracked_best (which the FE
 * card emitter reads). Upstream pipeline (runNbaNight + nbaRowModelProbability
 * → _ensureEnriched) stamps all these onto the row in-place; we MUST preserve
 * them when shaping the row into a marketProp or they're stripped before the
 * play object can carry them through. matchup/team also preserved for the FE
 * "team pending" / matchup-empty bug.
 */
function marketPropsFromPoolRows(rows) {
  if (!Array.isArray(rows)) return []
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const player = row.player
    if (!player) continue
    const family = resolveStatFamily(row)
    if (!family) continue
    const line = Number(row.line)
    const odds = Number(row.odds)
    const side = String(row.side || "").toLowerCase()
    if (!Number.isFinite(line) || !Number.isFinite(odds)) continue
    if (side !== "over" && side !== "under") continue
    out.push({
      player,
      eventId: row.eventId || null,
      statFamily: family,
      line,
      oddsAmerican: odds,
      side,
      sportsbook: row.book || row.sportsbook || null,
      propType: row.propType || null,
      marketKey: row.marketKey || null,
      ladder: row.ladder || null,
      // ── Phase 2 enrichment preservation ────────────────────────────────
      team:                row.team        || row.teamResolved || null,
      opponent:            row.opponent    || row.opponentTeam || null,
      homeTeam:            row.homeTeam    || null,
      awayTeam:            row.awayTeam    || null,
      matchup:             row.matchup     || null,
      oppDef:              Number.isFinite(Number(row.oppDef)) ? Number(row.oppDef) : null,
      pace:                Number.isFinite(Number(row.pace)) ? Number(row.pace) : null,
      shots:               Number.isFinite(Number(row.shots)) ? Number(row.shots) : null,
      astRate:             Number.isFinite(Number(row.astRate)) ? Number(row.astRate) : null,
      rebRate:             Number.isFinite(Number(row.rebRate)) ? Number(row.rebRate) : null,
      toRate:              Number.isFinite(Number(row.toRate)) ? Number(row.toRate) : null,
      turnovers:           Number.isFinite(Number(row.turnovers)) ? Number(row.turnovers) : null,
      starterFlag:         row.starterFlag ?? null,
      projectedMinutes:    Number.isFinite(Number(row.projectedMinutes)) ? Number(row.projectedMinutes) : null,
      playerSeasonStats:   row.playerSeasonStats || null,
      opponentStats:       row.opponentStats     || null,
      recentForm:          row.recentForm        || null,
      roleContext:         row.roleContext       || null,
    })
  }
  return out
}

module.exports = {
  buildNbaBestBetsBoard,
  marketPropsFromPoolRows,
  americanOddsToImpliedProb,
  americanToDecimal,
  modelProbOver,
}
