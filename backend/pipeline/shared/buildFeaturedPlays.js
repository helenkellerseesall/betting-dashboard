"use strict"

/**
 * Featured Plays curator — the trust anchor of the workstation.
 *
 * Sits ON TOP of all existing intelligence (slip AI scoring, line shopping,
 * timing, book state, ledger CLV, portfolio). Never replaces them.
 *
 * Goal:
 *   Curate 5–15 plays per night that the user can ACTUALLY trust, organized
 *   into themed buckets. Each bucket uses a different scoring lens so no
 *   single variable dominates.
 *
 * Buckets:
 *   tonightsBest      — overall composite winners (cross-stat, diversified)
 *   bestHr            — strongest HR / power spots (MLB)
 *   bestLadders       — alt ladders w/ best EV vs realistic ladder height
 *   smartAggression   — high-EV aggressive plays w/ good process
 *   safest            — lowest-volatility, highest-confidence picks
 *   bestClv           — strongest historical CLV by stat family + timing
 *   marketAgreement   — market consensus aligns with model (low dispersion)
 *   timingWindows     — bet-now / stale-book / steam plays
 *   bestBooks         — best sportsbook by stat tonight
 *
 * Scoring lenses (each 0–1, capped weights):
 *   - edgeScore         (model edge × confidence, capped)
 *   - archetypeTrust    (rolling ROI by stat family from ledger)
 *   - clvHistory        (rolling CLV by stat family from ledger)
 *   - timingScore       (immediate / stale_window / steam → +)
 *   - bookScore         (book CLV history)
 *   - volatilityFit     (matches what the bucket wants)
 *   - marketAgreement   (low dispersion among multi-book lines)
 *
 * Featured plays MUST diversify — caps per player, per stat, per game.
 */

const { resolveNbaVolatility } = require("../nba/nbaVolatilityResolver")
const { isOffensiveAttackStat } = require("./normalizers")

// ── helpers ───────────────────────────────────────────────────────────────────

function num(v)  { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
function r4(x)   { return Math.round(Number(x) * 10000) / 10000 }
function clamp(lo, hi, x) { return Math.max(lo, Math.min(hi, Number(x))) }
function normFam(v) { return String(v || "").toLowerCase().replace(/[\s_]+/g, "") }
function gameKey(c) {
  if (c?.eventId) return String(c.eventId)
  if (c?.matchup) return String(c.matchup).toLowerCase().replace(/[^a-z0-9]/g, "")
  return null
}
function impliedFromAmerican(o) {
  const n = num(o); if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}

// isOffensiveAttackStat — imported from ./normalizers (canonical shared definition)

function normalizeCandidate(raw) {
  if (!raw) return null
  const player    = raw.player || raw.playerName
  const statFamily = normFam(raw.statFamily || raw.propFamilyKey || raw.propType)
  const side      = String(raw.side || "").toLowerCase()
  const line      = num(raw.line ?? raw.point)
  const odds      = num(raw.odds ?? raw.oddsAmerican)
  if (!player || !statFamily || odds == null) return null
  const modelProb   = num(raw.modelProb ?? raw.predictedProbability ?? raw.calibratedConfidence ?? raw.confidence)
  const impliedProb = impliedFromAmerican(odds)
  const edge        = num(raw.edge ?? raw.edgeProbability ?? (modelProb != null && impliedProb != null ? modelProb - impliedProb : null))
  return {
    id: raw.id || `${player}|${statFamily}|${side}|${line}|${odds}|${raw.book || raw.sportsbook || ""}`,
    player,
    team:        raw.team || raw.teamCode,
    eventId:     raw.eventId,
    matchup:     raw.matchup,
    statFamily,
    propType:    raw.propType || statFamily,
    side,
    line,
    odds,
    book:        raw.book || raw.sportsbook,
    modelProb,
    impliedProb,
    edge,
    confidence:  num(raw.calibratedConfidence ?? raw.confidence ?? raw.confidenceRaw),
    tier:        raw.tier || raw.confidenceTier || raw.bucket,
    // NBA-2.B: volatility resolved by canonical NBA volatility resolver.
    // pipeline/nba/nbaVolatilityResolver is the single source of truth for:
    //   - snapshot-sourced stamp preservation (PRA→lotto, threes→aggressive,
    //     points/rebounds/assists→balanced from buildNbaSnapshotCandidates FIX Q4)
    //   - future role-spike / eruption-environment hooks (NBA-6 scope)
    //   - VOLATILITY_RULES fallback for all other candidates
    // MLB candidates always reach the VOLATILITY_RULES fallback path.
    // VOLATILITY_RULES itself is NOT modified.
    volatility:  resolveNbaVolatility(raw),
    raw,
  }
}

// ── scoring lenses ────────────────────────────────────────────────────────────

function buildLedgerStats(ledgerState) {
  const out = { statFamilyClv: {}, statFamilyRoi: {} }
  if (!ledgerState?.bets?.length) return out
  const byStat = {}
  for (const b of ledgerState.bets) {
    const fam = normFam(b.statFamily || b.modelSnapshot?.propFamilyKey)
    if (!fam) continue
    if (!byStat[fam]) byStat[fam] = { clv: [], profit: 0, stake: 0 }
    if (Number.isFinite(b.clvSnapshot?.clv?.implied)) byStat[fam].clv.push(b.clvSnapshot.clv.implied)
    if (Number.isFinite(b.profit)) byStat[fam].profit += b.profit
    if (Number.isFinite(b.stake)) byStat[fam].stake  += b.stake
  }
  for (const [k, v] of Object.entries(byStat)) {
    if (v.clv.length) out.statFamilyClv[k] = v.clv.reduce((s, x) => s + x, 0) / v.clv.length
    if (v.stake > 0)  out.statFamilyRoi[k] = v.profit / v.stake
  }
  return out
}

function lookupTiming(c, timingMap) {
  if (!timingMap) return null
  const fullKey = [
    String(c.eventId || ""),
    String(c.player || "").toLowerCase().trim(),
    normFam(c.statFamily),
    String(c.side || "").toLowerCase(),
    String(c.line ?? "any"),
  ].join("|")
  const direct = timingMap.get(fullKey)
  if (direct) return direct
  const short = fullKey.split("|").slice(1).join("|")
  for (const [k, v] of timingMap) {
    if (k.split("|").slice(1).join("|") === short) return v
  }
  return null
}

function lookupShop(c, shopMap) {
  if (!shopMap) return null
  const k = [
    String(c.player || "").toLowerCase().trim(),
    normFam(c.statFamily),
    String(c.side || "").toLowerCase(),
    String(c.line ?? "any"),
  ].join("|")
  return shopMap.get(k) || null
}

/**
 * Multi-factor 0..1 score for a candidate.
 * Caps each lens so no single one dominates.
 */
function scoreCandidate(c, ctx) {
  const f = {}
  let total = 0, weight = 0

  // edge × confidence — cap edge contribution at 25% to avoid edge-chasing.
  //
  // ECOLOGY FIX: cap modelProb factor to [0.50, 0.55]. Without this cap, a
  // 9% edge under at 0.65 modelProb scores 0.234 while a 9% edge over at
  // 0.50 modelProb scores 0.180 — a 30% advantage to suppression bets that
  // is purely structural (probability compression on shorter under lines),
  // NOT a real quality difference. The cap neutralizes that compounding
  // while still penalizing very low confidence (modelProb < 0.50).
  const edge = c.edge ?? 0
  const conf = c.modelProb ?? c.confidence ?? 0
  const probFactor = Math.max(0.50, Math.min(0.55, conf || 0.5))
  f.edge = clamp(0, 1, (edge * 4) * probFactor)
  total += f.edge * 0.25; weight += 0.25

  // archetype trust (rolling ROI by stat family)
  const roi = ctx.ledgerStats?.statFamilyRoi?.[c.statFamily]
  f.archetype = roi == null ? 0.55 : roi > 0.10 ? 0.95 : roi > 0 ? 0.75 : roi > -0.05 ? 0.55 : 0.30
  total += f.archetype * 0.10; weight += 0.10

  // CLV history
  const histClv = ctx.ledgerStats?.statFamilyClv?.[c.statFamily]
  f.clv = histClv == null ? 0.55 : histClv > 0.01 ? 0.90 : histClv > 0 ? 0.70 : histClv > -0.01 ? 0.50 : 0.25
  total += f.clv * 0.12; weight += 0.12

  // timing
  const tc = lookupTiming(c, ctx.timingMap)
  let timingScore = 0.55
  if (tc) {
    if (tc.urgency === "immediate") timingScore = 0.95
    else if (tc.urgency === "soon")  timingScore = 0.75
    else if (tc.urgency === "patient") timingScore = 0.60
    else if (tc.urgency === "wait")    timingScore = 0.40
    else if (tc.urgency === "avoid")   timingScore = 0.15
    if (tc.state === "stale_window") timingScore = Math.min(1, timingScore + 0.10)
    if (tc.state === "steam")        timingScore = Math.min(1, timingScore + 0.05)
  }
  f.timing = timingScore
  total += f.timing * 0.10; weight += 0.10

  // book quality
  const bookProf = ctx.bookState?.books?.[String(c.book || "").toLowerCase()]
  f.book = !bookProf ? 0.55 :
    bookProf.avgClv > 0.015 ? 0.90 :
    bookProf.avgClv > 0     ? 0.70 :
    bookProf.avgClv > -0.01 ? 0.50 : 0.30
  total += f.book * 0.08; weight += 0.08

  // market agreement (low dispersion + multi-book)
  const ls = lookupShop(c, ctx.shopMap)
  let market = 0.55
  if (ls && ls.bookCount >= 3) {
    const disp = ls.marketDispersion ?? 0
    market = disp < 0.02 ? 0.90 : disp < 0.04 ? 0.70 : 0.55
  } else if (ls && ls.bookCount === 2) {
    market = 0.65
  }
  f.market = market
  total += f.market * 0.10; weight += 0.10

  // volatility realism — reward stable profiles without crushing balanced/aggressive
  // textures (prior hits/runs incorrectly classified "safe" and swept rankings;
  // classification fixed in buildPortfolioOptimizer — keep scoring sane here).
  //
  // NBA-1: lotto gets its own slot (0.65 ≈ aggressive 0.66) rather than the
  // generic 0.56 fallthrough. Without this, PRA candidates correctly preserved
  // as "lotto" via the snapshotSourced guard score ~0.01 lower than equivalent
  // aggressive plays — a scoring regression that would suppress PRA ecosystem
  // surfacing despite the classification fix. 0.65 reflects genuine high-upside
  // process (not noise), near-peer with aggressive, below balanced. The generic
  // fallthrough (any unknown classification) drops to 0.56.
  f.volRealism = c.volatility === "safe" ? 0.80 :
                 c.volatility === "balanced" ? 0.74 :
                 c.volatility === "aggressive" ? 0.66 :
                 c.volatility === "lotto" ? 0.65 :
                 0.56
  total += f.volRealism * 0.10; weight += 0.10

  // Upside-lane preservation: high-edge aggressive/lotto legs keep oxygen in
  // curated pools — does NOT inject overs; only lifts proven volatile edges.
  //
  // ECOLOGY FIX (extended): recognize TRUE offensive attack candidates
  // (hitter overs on offensive stats, not pitcher dominance). Without this,
  // the side-balance fill pass selects pitcher outs/Ks "overs" — which are
  // structurally suppression bets — to fill the over slot, leaving real
  // hitter offense (Trout runs over, Bichette HR over) ranked below them.
  //
  // The two boosts stack into a single value rather than fall-through —
  // aggressive offensive overs get a larger boost (0.030) to overcome the
  // built-in volRealism penalty (aggressive 0.63 vs balanced 0.74 = -0.011
  // weighted composite penalty), so that real attack edges can actually
  // surface against equal-edge suppression bets. Balanced offensive overs
  // get a smaller boost (0.020) since they have no volRealism penalty.
  let textureBoost = 0
  const isOffenseOver = c.side === "over" && (c.edge ?? 0) > 0.05 && isOffensiveAttackStat(c.statFamily)
  if ((c.volatility === "aggressive" || c.volatility === "lotto") && (c.edge ?? 0) > 0.045) {
    textureBoost = isOffenseOver ? 0.030 : 0.018
  } else if (isOffenseOver) {
    textureBoost = 0.020
  }
  f.textureBoost = textureBoost

  // Tier hint — small nudge from pipeline confidence tier.
  //
  // TRUST-CURATION FIX: halved tier boosts (was 0.08/0.04).
  // On MLB slates the ELITE/STRONG tiers are assigned exclusively to under
  // bets (33 ELITE unders, 0 ELITE overs today) because tier assignment is
  // modelProb-driven and modelProb is structurally higher on shorter under
  // lines. At full 0.08, the ELITE bonus creates a ~5.5-point composite gap
  // between low-edge ELITE unders and equal/higher-edge PLAYABLE overs.
  // Halving to 0.04/0.02 keeps the signal without letting it sweep the
  // trust-curation hierarchy — a 9.5% edge offensive over can now naturally
  // outrank a 5.5% edge ELITE under.
  const tier = String(c.tier || "").toUpperCase()
  let tierBoost = 0
  if (tier.includes("ELITE")) tierBoost = 0.04
  else if (tier.includes("STRONG")) tierBoost = 0.02
  else if (tier.includes("LOTTO")) tierBoost = -0.05
  else if (tier.includes("FADE"))  tierBoost = -0.30
  f.tier = tierBoost

  const composite = clamp(0, 1, (total / weight) + tierBoost + textureBoost)
  return { composite: r4(composite), factors: f, timingClass: tc, lineShop: ls }
}

// ── reasoning generators ──────────────────────────────────────────────────────

/**
 * Compact signal tags — sharp, operator-grade.
 * Reads as a scannable summary of WHY this play exists.
 */
function buildReason(c, score, ctx) {
  const tags = []
  const f = score.factors
  // Edge signal
  if (f.edge        >= 0.55) tags.push("model vs market")
  else if (f.edge   >= 0.35) tags.push("model edge")
  // Process / CLV history
  if (f.clv         >= 0.75) tags.push("+CLV historical")
  else if (f.clv    >= 0.60) tags.push("+CLV trend")
  // Archetype
  if (f.archetype   >= 0.80) tags.push("archetype proven")
  else if (f.archetype >= 0.65) tags.push("archetype trust")
  // Timing / urgency
  if (score.timingClass?.urgency === "immediate") tags.push("window closing")
  else if (score.timingClass?.urgency === "soon")  tags.push("act soon")
  if (score.timingClass?.state === "stale_window") tags.push("stale line")
  if (score.timingClass?.state === "steam")        tags.push("sharp steam")
  // Sportsbook
  if (f.book        >= 0.80) tags.push("soft book")
  // Market structure
  if (f.market      >= 0.80) tags.push("multi-book aligned")
  else if (f.market >= 0.70) tags.push("market agrees")
  // Texture
  if (c.volatility  === "safe")       tags.push("low variance")
  else if (c.volatility === "balanced") tags.push("medium variance")
  else if (c.volatility === "aggressive") tags.push("upside lane")
  else if (c.volatility === "lotto")  tags.push("max upside")
  if (score.lineShop?.bookCount >= 3) tags.push(`${score.lineShop.bookCount} books`)
  // Fallback — always surface something
  if (!tags.length) {
    if ((c.modelProb ?? 0) >= 0.5) tags.push("model favors")
    else if ((c.edge ?? 0) > 0.04) tags.push("+EV")
    else tags.push("model edge")
  }
  return tags.slice(0, 4).join(" · ")
}

/**
 * One-line process-quality note — explains the WHY behind the curation signal.
 * Slightly shaper than before; renders as italic supplement to the tag line.
 */
function processQualityNote(c, score, ctx) {
  const f = score.factors
  if (f.clv >= 0.80 && f.archetype >= 0.75) return "Strong CLV + proven archetype — historically profitable process"
  if (f.clv >= 0.80) return "This stat family beats closing line value historically"
  if (f.archetype >= 0.80) return "Consistent edge on this player type over time"
  if (score.timingClass?.state === "stale_window") return "Book hasn't adjusted — price lag relative to market"
  if (score.timingClass?.urgency === "immediate")  return "Timing signal: exploit now before line corrects"
  if (f.market >= 0.80) return "Multiple sharp books pointing the same direction"
  if (f.edge >= 0.70) return "Model probability significantly exceeds market implied"
  if (c.volatility === "safe") return "Low-variance profile — outcome predictable from model"
  return null
}

/**
 * Attack note — the sharp one-liner used on anchor cards.
 * Operator-grade, premium, decisive. NOT hypey. NOT gambling-bro.
 * Reads as: "Here is the specific reason this is worth acting on tonight."
 */
function buildAttackNote(c, score, ctx) {
  const f = score.factors
  const tc = score.timingClass

  // Timing-first: urgency is the most actionable dimension
  if (tc?.urgency === "immediate" && tc?.state === "stale_window") {
    return "Stale line with a closing window — book behind the market, act now"
  }
  if (tc?.urgency === "immediate") {
    return "Timing signal active — this line is moving, opportunity is closing"
  }
  if (tc?.state === "stale_window") {
    return "Book hasn't kept pace with market — price advantage while it lasts"
  }
  if (tc?.state === "steam") {
    return "Sharp steam detected across multiple books — market moving with the model"
  }

  // Multi-book market agreement
  if (f.market >= 0.80 && f.edge >= 0.50) {
    const n = score.lineShop?.bookCount
    const bookStr = n && n >= 3 ? `across ${n} books` : "across multiple books"
    return `Model and market aligned ${bookStr} — a rare consensus edge`
  }

  // CLV + archetype double signal
  if (f.clv >= 0.80 && f.archetype >= 0.75) {
    return "This archetype consistently beats the closing line — highest-process pick"
  }
  if (f.clv >= 0.80) {
    return "Positive CLV on this stat family historically — good process regardless of outcome"
  }

  // Strong model edge
  if (f.edge >= 0.65) {
    const probPct = c.modelProb != null ? `${Math.round(c.modelProb * 100)}%` : null
    const implPct = c.impliedProb != null ? `${Math.round(c.impliedProb * 100)}%` : null
    if (probPct && implPct) return `Model at ${probPct} vs market at ${implPct} — exploitable gap`
    return "Model probability significantly above market implied — structural edge"
  }
  if (f.edge >= 0.50) {
    return "Model diverges from market consensus — value present at current price"
  }

  // Archetype trust with safe volatility
  if (f.archetype >= 0.75 && c.volatility === "safe") {
    return "Proven archetype, low-variance outcome — highest-conviction process play"
  }
  if (f.archetype >= 0.75) {
    return "Proven archetype with historical edge — process-backed selection"
  }

  // Soft book / line shopping angle
  if (f.book >= 0.80) {
    return `Soft book historically positive CLV on this prop type — exploit the pricing`
  }

  // Generic fallback for when no strong single signal fires but composite is high
  const probPct = c.modelProb != null ? `${Math.round(c.modelProb * 100)}%` : null
  if (probPct) return `Model at ${probPct} — composite intelligence selects this as tonight's anchor`
  return "Multi-factor composite champion for tonight's slate"
}

// ── diversifying picker ───────────────────────────────────────────────────────

/**
 * Greedy pick top N with caps:
 *   maxPerPlayer (default 1), maxPerGame (2), maxPerStat (3)
 *   maxSideFraction (0.60) — no single over/under direction exceeds this
 *     fraction of the final picks. Prevents boards swept entirely by unders.
 *     Set to 1.0 to disable.
 *
 * Two-pass: strict pass first, then a relaxed fill pass if short.
 * Returns array of { c, score }.
 */
function pickDiversified(scored, count, opts = {}) {
  const maxPerPlayer    = opts.maxPerPlayer    ?? 1
  const maxPerGame      = opts.maxPerGame      ?? 2
  const maxPerStat      = opts.maxPerStat      ?? 3
  // Cap so neither "over" nor "under" accounts for more than this share.
  // ceil(count × 0.60) = 3 in a 5-card, 5 in an 8-card — enough room for
  // a dominant lean but prevents wholesale sweeps.
  const maxSideFraction = opts.maxSideFraction ?? 0.60
  const maxOneSide      = Math.ceil(count * maxSideFraction)

  const sorted = [...scored].sort((a, b) => b.score.composite - a.score.composite)
  const out         = []
  const playerCount = new Map()
  const gameCount   = new Map()
  const statCount   = new Map()
  const sideCount   = new Map()   // "over" | "under" | "other"

  function canAdd(item) {
    const p = String(item.c.player || "").toLowerCase()
    const g = gameKey(item.c) || ""
    const s = item.c.statFamily
    const side = String(item.c.side || "other").toLowerCase()
    const sd = side === "over" || side === "under" ? side : "other"
    if ((playerCount.get(p) || 0) >= maxPerPlayer) return false
    if (g && (gameCount.get(g) || 0) >= maxPerGame) return false
    if ((statCount.get(s) || 0) >= maxPerStat) return false
    // Side-balance gate: only apply to over/under (not "other")
    if (sd !== "other" && (sideCount.get(sd) || 0) >= maxOneSide) return false
    return true
  }

  function doAdd(item) {
    const p = String(item.c.player || "").toLowerCase()
    const g = gameKey(item.c) || ""
    const s = item.c.statFamily
    const side = String(item.c.side || "other").toLowerCase()
    const sd = side === "over" || side === "under" ? side : "other"
    out.push(item)
    playerCount.set(p, (playerCount.get(p) || 0) + 1)
    if (g) gameCount.set(g, (gameCount.get(g) || 0) + 1)
    statCount.set(s, (statCount.get(s) || 0) + 1)
    sideCount.set(sd, (sideCount.get(sd) || 0) + 1)
  }

  // Primary pass: full constraints including side-balance
  for (const item of sorted) {
    if (out.length >= count) break
    if (canAdd(item)) doAdd(item)
  }

  // Fill pass: if side-balance left us short, relax side cap only (keep
  // player/game/stat caps) so the board still fills rather than going empty.
  if (out.length < count) {
    const pickedIds = new Set(out.map((x) => x.c.id))
    for (const item of sorted) {
      if (out.length >= count) break
      if (pickedIds.has(item.c.id)) continue
      const p = String(item.c.player || "").toLowerCase()
      const g = gameKey(item.c) || ""
      const s = item.c.statFamily
      if ((playerCount.get(p) || 0) >= maxPerPlayer) continue
      if (g && (gameCount.get(g) || 0) >= maxPerGame) continue
      if ((statCount.get(s) || 0) >= maxPerStat) continue
      doAdd(item)
      pickedIds.add(item.c.id)
    }
  }

  return out
}

// ── bucket builders ───────────────────────────────────────────────────────────

/**
 * ANCHORS — the nightly trust tier (3–5 plays only).
 *
 * Strictly the top composite plays, with corroboration: at least one of
 * (positive CLV history, archetype trust, market agreement, timing immediate,
 *  edge factor strong) must fire. Falls back progressively so a thin slate
 * still yields 3 anchors when the data supports it.
 */
/**
 * Re-orders already-selected anchor plays so sides alternate in the display
 * (e.g. under → over → under → over → under). Composite scores are NOT
 * changed — only the rendering sequence. This prevents all unders from
 * stacking at positions #1-#3 even when the slate is suppression-heavy,
 * giving offensive attack plays visibility in the first three anchor slots.
 */
function sortAnchorsForDisplay(picks) {
  if (picks.length <= 2) return picks
  const result = [picks[0]] // always preserve highest composite as #1 anchor
  const remaining = picks.slice(1)
  while (remaining.length) {
    const lastSide = result[result.length - 1].c.side
    const altIdx   = remaining.findIndex((p) => p.c.side !== lastSide)
    if (altIdx >= 0) result.push(remaining.splice(altIdx, 1)[0])
    else             result.push(remaining.shift())
  }
  return result
}

function buildAnchors(scored, count = 5) {
  const sorted = [...scored].sort((a, b) => b.score.composite - a.score.composite)

  // Tier 1: composite >= 0.55 + at least one corroborating signal
  const strict = sorted.filter((x) => {
    const f = x.score.factors
    if ((x.score.composite ?? 0) < 0.55) return false
    const corrobs = [
      f.clv >= 0.70,
      f.archetype >= 0.75,
      f.market >= 0.75,
      f.edge >= 0.55,
      x.score.timingClass?.urgency === "immediate",
      x.score.timingClass?.state === "stale_window",
    ].filter(Boolean).length
    return corrobs >= 1
  })

  let pool = strict
  // Fallback: relax to top composite >= 0.50 if too few strict anchors
  if (pool.length < 3) {
    pool = sorted.filter((x) => (x.score.composite ?? 0) >= 0.50)
  }
  // Last fallback: just take the top composite plays
  if (pool.length < 3) {
    pool = sorted
  }

  // ECOLOGY FIX: allow 2 per game in anchors (was 1). On nights where one
  // game has a strong under AND a strong over (e.g. Montgomery TB under +
  // Trout runs over in CHW@LAA), the strict 1-per-game cap forces the
  // anchor pool into 5 unders even when Trout's offensive over has higher
  // composite than later under picks. Side-balance cap (0.55) still
  // prevents same-side same-game spam — this only helps when the second
  // pick adds genuine cross-side texture.
  const picks = pickDiversified(pool, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 2, maxSideFraction: 0.55 })

  // DISPLAY FIX: interleave anchors by side so the board alternates rather
  // than showing all unders first. Pure editorial sort — scores are
  // untouched. Greedy: always pick the next play whose side differs from the
  // last selected, falling back to remaining plays when no opposite exists.
  return sortAnchorsForDisplay(picks)
}

function buildTonightsBest(scored, count = 5, exclude = new Set()) {
  const filtered = scored.filter((x) => !exclude.has(x.c.id))
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 3, maxSideFraction: 0.60 })
}

function buildBestHr(scored, count = 4) {
  const filtered = scored.filter((x) => /home.?run|^hr$|homers/i.test(x.c.statFamily))
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 99 })
}

/** NBA: PRA (Points+Rebounds+Assists) combo plays — volatile upside, game-total sensitive */
function buildBestPra(scored, count = 4) {
  const filtered = scored.filter((x) => {
    const f = normFam(x.c.statFamily)
    return f === "pra" || f.includes("pra") || f === "pointsreboundsassists"
  })
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 99 })
}

/** NBA: First basket props — highest-upside lotto plays on the board */
function buildBestFirstBasket(scored, count = 4) {
  const filtered = scored.filter((x) => {
    const f = normFam(x.c.statFamily)
    return f.includes("firstbasket") || f.includes("firstteambasket")
  })
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 99 })
}

function buildBestLadders(scored, count = 5) {
  // Alt lines with realistic ladder height (line 2.5–4.5 for batter stats, plus high-EV unders)
  const filtered = scored.filter((x) => {
    const fam = x.c.statFamily
    const line = Number(x.c.line ?? 0)
    if (fam.includes("totalbase")) return line >= 1.5
    if (fam === "hits") return line >= 1.5
    if (fam.includes("rebound") || fam.includes("assist") || fam.includes("three") || fam.includes("point")) return line >= 1.5
    if (fam.includes("strikeout") || fam.includes("outs")) return true
    return false
  })
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 3, maxSideFraction: 0.60 })
}

function buildSmartAggression(scored, count = 4) {
  // Aggressive volatility, decent confidence, positive process indicators.
  // Falls back progressively if nothing strict matches.
  let filtered = scored.filter((x) =>
    (x.c.volatility === "aggressive" || x.c.volatility === "lotto") &&
    (x.c.modelProb ?? 0) >= 0.18 &&
    x.score.factors.archetype >= 0.55 &&
    x.score.factors.edge >= 0.40
  )
  if (filtered.length < count) {
    filtered = scored.filter((x) =>
      (x.c.volatility === "aggressive" || x.c.volatility === "lotto") &&
      (x.c.modelProb ?? 0) >= 0.15 &&
      x.score.factors.edge >= 0.30
    )
  }
  if (filtered.length < count) {
    filtered = scored.filter((x) => x.c.volatility === "aggressive" || x.c.volatility === "lotto")
  }
  // Texture fallback: balanced legs with plus-money / steam / urgent timing —
  // preserves "attack" spots that aren't classified aggressive/lotto but still
  // carry real offensive-market edge (common on hitter ladders).
  if (filtered.length < count) {
    filtered = scored.filter((x) =>
      x.c.volatility === "balanced" &&
      (x.c.edge ?? 0) > 0.042 &&
      (
        (num(x.c.odds) >= 125) ||
        x.score.timingClass?.state === "steam" ||
        x.score.timingClass?.urgency === "immediate"
      )
    )
  }
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 2 })
}

function buildSafest(scored, count = 5) {
  // Primary: proper safe-lane plays (low volatility, high modelProb).
  //
  // TRUST-QUALIFICATION FIX: PLUS premium-edge offensive ecosystems —
  // balanced/aggressive plays with edge >= 0.12 AND modelProb >= 0.50.
  // Without this, "safest" filled exclusively with pitcher dominance overs
  // (whose volatility was previously misclassified safe) and high-prob
  // unders. Premium hitter offense (Trout 22%-edge runs over) could never
  // qualify as a safest pick despite being a structurally high-conviction
  // play — its modelProb is compressed below 0.55 by line shape, not by
  // any actual confidence weakness. The override admits 12%+ edge plays at
  // a 50%+ probability floor as a process-quality-driven safety signal.
  let filtered = scored.filter((x) =>
    (
      x.c.volatility === "safe" &&
      (x.c.modelProb ?? 0) >= 0.55
    ) ||
    (
      (x.c.volatility === "balanced" || x.c.volatility === "aggressive") &&
      (x.c.modelProb ?? 0) >= 0.50 &&
      (x.c.edge ?? 0) >= 0.12
    )
  )
  filtered = filtered.filter((x) => Math.abs(x.c.odds) <= 250)
  // First fallback: any safe-volatility play
  if (filtered.length < count) {
    filtered = scored.filter((x) => x.c.volatility === "safe" && Math.abs(x.c.odds) <= 250)
  }
  // Second fallback: highest model prob non-lotto plays under reasonable odds
  if (filtered.length < count) {
    filtered = scored.filter((x) =>
      x.c.volatility !== "lotto" &&
      (x.c.modelProb ?? 0) >= 0.50 &&
      Math.abs(x.c.odds) <= 250
    )
  }
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 3, maxSideFraction: 0.60 })
}

function buildBestClv(scored, count = 4) {
  const filtered = scored.filter((x) => x.score.factors.clv >= 0.70)
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 2 })
}

function buildMarketAgreement(scored, count = 4) {
  const filtered = scored.filter((x) => x.score.factors.market >= 0.75 && (x.c.edge ?? 0) > 0.03)
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 3 })
}

function buildTimingWindows(scored, count = 4) {
  const filtered = scored.filter((x) =>
    x.score.timingClass?.urgency === "immediate" ||
    x.score.timingClass?.state === "stale_window" ||
    x.score.timingClass?.state === "steam"
  )
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 3 })
}

function buildBestBooksTonight(scored) {
  // Aggregate by book: avg composite of plays whose best book is X
  const byBook = {}
  for (const x of scored) {
    const lsBest = x.score.lineShop?.bestBook || x.c.book
    if (!lsBest) continue
    const k = String(lsBest)
    if (!byBook[k]) byBook[k] = { book: k, plays: 0, sumScore: 0, topPlay: null }
    byBook[k].plays += 1
    byBook[k].sumScore += x.score.composite
    if (!byBook[k].topPlay || x.score.composite > byBook[k].topPlay.score.composite) byBook[k].topPlay = x
  }
  return Object.values(byBook)
    .map((b) => ({ ...b, avgScore: r4(b.sumScore / b.plays) }))
    .sort((a, b) => b.avgScore - a.avgScore || b.plays - a.plays)
    .slice(0, 8)
}

// ── compact play serialization ────────────────────────────────────────────────

function compactPlay(item, ctx, { includeAttackNote = false } = {}) {
  const { c, score } = item
  const reason     = buildReason(c, score, ctx)
  const note       = processQualityNote(c, score, ctx)
  const attackNote = includeAttackNote ? buildAttackNote(c, score, ctx) : undefined
  return {
    id:           c.id,
    player:       c.player,
    team:         c.team,
    eventId:      c.eventId,
    matchup:      c.matchup,
    statFamily:   c.statFamily,
    propType:     c.propType,
    side:         c.side,
    line:         c.line,
    odds:         c.odds,
    book:         c.book,
    bestBook:     score.lineShop?.bestBook || c.book,
    bestOdds:     score.lineShop?.bestOdds ?? c.odds,
    bookCount:    score.lineShop?.bookCount ?? 1,
    modelProb:    c.modelProb,
    edge:         c.edge,
    volatility:   c.volatility,
    tier:         c.tier,
    timingState:  score.timingClass?.state,
    timingUrgency:score.timingClass?.urgency,
    reasoning:    reason,
    processNote:  note,
    ...(attackNote != null ? { attackNote } : {}),
    composite:    score.composite,
    factors:      score.factors,
  }
}

// ── main entry point ──────────────────────────────────────────────────────────

function buildFeaturedPlays(opts = {}) {
  const {
    candidates = [],
    timingResult = null,
    lineShopping = null,
    bookState = null,
    ledgerState = null,
    sport,
    date,
  } = opts

  const normalized = candidates.map(normalizeCandidate).filter(Boolean)
  if (!normalized.length) {
    return {
      sport, date,
      anchors: [],
      tonightsBest: [], bestHr: [], bestPra: [], bestFirstBasket: [], bestLadders: [], smartAggression: [],
      safest: [], bestClv: [], marketAgreement: [], timingWindows: [], bestBooks: [],
      summary: "No candidates available",
    }
  }

  const timingMap = new Map()
  for (const tc of timingResult?.timingClassifications || []) timingMap.set(tc.key, tc)

  const shopMap = new Map()
  const lsSource = lineShopping?.byProp || []
  for (const g of lsSource) {
    const k = [
      String(g.player || "").toLowerCase().trim(),
      normFam(g.propFamilyKey),
      String(g.side || "").toLowerCase(),
      String(g.line ?? "any"),
    ].join("|")
    shopMap.set(k, g)
  }

  const ledgerStats = buildLedgerStats(ledgerState)
  const ctx = { timingMap, shopMap, bookState, ledgerStats }

  const scored = normalized.map((c) => ({ c, score: scoreCandidate(c, ctx) }))

  // Two-tier hierarchy: anchors (3–5 highest-trust plays, must clear corroboration
  // gate) + supports (tonightsBest below the anchors). The tonightsBest pool
  // explicitly excludes anchor IDs so the dashboard reads as anchors → supports
  // rather than a flat wall of equally-weighted plays.
  const anchorsItems = buildAnchors(scored)
  const anchorIds    = new Set(anchorsItems.map((x) => x.c.id))
  const anchors      = anchorsItems.map((x) => compactPlay(x, ctx, { includeAttackNote: true }))

  const tonightsBest    = buildTonightsBest(scored, 5, anchorIds).map((x) => compactPlay(x, ctx))
  const bestHr          = buildBestHr(scored).map((x) => compactPlay(x, ctx))
  const bestPra         = buildBestPra(scored).map((x) => compactPlay(x, ctx))
  const bestFirstBasket = buildBestFirstBasket(scored).map((x) => compactPlay(x, ctx))
  const bestLadders     = buildBestLadders(scored).map((x) => compactPlay(x, ctx))
  const smartAggression = buildSmartAggression(scored).map((x) => compactPlay(x, ctx))
  const safest          = buildSafest(scored).map((x) => compactPlay(x, ctx))
  const bestClv         = buildBestClv(scored).map((x) => compactPlay(x, ctx))
  const marketAgreement = buildMarketAgreement(scored).map((x) => compactPlay(x, ctx))
  const timingWindows   = buildTimingWindows(scored).map((x) => compactPlay(x, ctx))
  const bestBooks       = buildBestBooksTonight(scored).map((b) => ({
    book: b.book, plays: b.plays, avgScore: b.avgScore,
    topPlay: b.topPlay ? compactPlay(b.topPlay, ctx) : null,
  }))

  // Count of UNIQUE plays surfaced (not bucket sum, which over-counts due to
  // the same play appearing in multiple lenses).
  const uniqueIds = new Set()
  for (const list of [anchors, tonightsBest, bestHr, bestPra, bestFirstBasket, bestLadders, smartAggression,
                      safest, bestClv, marketAgreement, timingWindows]) {
    for (const p of list) if (p?.id) uniqueIds.add(p.id)
  }

  return {
    sport, date,
    anchors,
    tonightsBest, bestHr, bestPra, bestFirstBasket, bestLadders, smartAggression,
    safest, bestClv, marketAgreement, timingWindows, bestBooks,
    summary: `${anchors.length} anchors · ${uniqueIds.size} curated plays across ${normalized.length} candidates`,
  }
}

module.exports = {
  buildFeaturedPlays,
  scoreCandidate,
  buildLedgerStats,
}
