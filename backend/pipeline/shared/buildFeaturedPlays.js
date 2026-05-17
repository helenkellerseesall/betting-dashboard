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

// ── Phase Market-Exploitation-1A constants (EXPL-1 + EXPL-4) ─────────────────
//
// EXPL-1 (consensus-support gate on disagreement / stale-line surfaces):
// A staleRow surfaces into bestDisagreementEdges / staleLineOpportunities /
// inflatedSuperstarSpots ONLY when the underlying prop has BOTH meaningful
// market participation (>= EXPL1_MIN_BOOK_COUNT books quoting it) AND
// meaningful consensus among those books (consensusConfidence >=
// EXPL1_MIN_CONSENSUS_CONFIDENCE). This isolates real market disagreement
// from isolated single-book noise. Uses EXISTING canonical fields only
// (bookCount + consensusConfidence on the shopMap byProp entry). No new
// scoring, no new persistence, no ML.
//
// EXPL-4 (availability hard-filter): a candidate with canonical playerStatus
// === "out" is dropped at ingest. Reuses pipeline/nba/nbaAvailabilityCache
// canonical taxonomy (out | doubtful | questionable | probable | active |
// unknown). MLB candidates carry no playerStatus → filter no-ops honestly.
// Anti-fabrication: never invent status; never drop on unknown.
const EXPL1_MIN_BOOK_COUNT = 3
const EXPL1_MIN_CONSENSUS_CONFIDENCE = 0.6
const EXPL4_HARD_DROP_STATUSES = new Set(["out"])

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
    // Phase Market-Exploitation-1A (EXPL-4): preserve canonical availability
    // semantics through normalization so the hard-filter at ingest can act.
    // Source authority: pipeline/nba/nbaAvailabilityCache.enrichRowWithAvailability
    // (writes raw.playerStatus on snapshot rows before they reach this curator).
    // Anti-fabrication: when upstream did not set playerStatus, we propagate
    // undefined verbatim — never substitute "active" by default.
    playerStatus:        raw.playerStatus,
    availabilityContext: raw.availabilityContext,
    // Phase Bettor-Curation-Intelligence-1A (BC-1): preserve canonical MLB
    // realism / environment signals through normalization so the curation
    // layer (BC-2 playerLegitimacyFactor / BC-4 soft-demote / BC-5 believable
    // upside / BC-7 anchor corroborator / BC-8 realism score) can read them.
    // Canonical sources:
    //   - lineupSpot, depth, plateAppearancesProxy  → pipeline/mlb/context/deriveMlbLineupContext.js
    //   - impliedTeamTotal, gameTotal                → raw row from buildMlbBootstrapSnapshot.js
    //   - hrEnvironmentTag                           → pipeline/mlb/context/deriveMlbParkContext.js
    //   - contextualTags                              → pipeline/mlb/context/composeMlbContextualSignal.js
    // Anti-fabrication: every field propagates verbatim (undefined when
    // upstream did not set it). Never substitutes neutral / default values
    // here — those decisions live in the consumers (see BC-2 fallback logic).
    lineupSpot:           raw.lineupSpot ?? raw.battingOrderIndex,
    depth:                raw.depth,
    plateAppearancesProxy: raw.plateAppearancesProxy,
    impliedTeamTotal:     raw.impliedTeamTotal,
    gameTotal:            raw.gameTotal,
    hrEnvironmentTag:     raw.hrEnvironmentTag,
    contextualTags:       raw.contextualTags,
    // Phase Offensive-Ecology-Intelligence-1A (OE-1): lift remaining canonical
    // offensive-ecology signals so OE-2 / OE-3 / OE-4 / OE-5 / OE-6 / OE-8 can
    // read them. Canonical sources:
    //   - runEnvironment, rbiEnvironment       → pipeline/mlb/context/deriveMlbLineupContext.js
    //   - windDirectionTag, carryShift, temperatureF
    //                                           → pipeline/mlb/context/deriveMlbWeatherContext.js
    //   - hrFactor                              → pipeline/mlb/context/deriveMlbParkContext.js
    // Pure additive lift; never invents. Anti-fabrication: undefined when
    // upstream did not set the field. NO new fetches. NO ML.
    runEnvironment:       raw.runEnvironment,
    rbiEnvironment:       raw.rbiEnvironment,
    windDirectionTag:     raw.windDirectionTag,
    carryShift:           raw.carryShift,
    hrFactor:             raw.hrFactor,
    temperatureF:         raw.temperatureF,
    // Phase Offensive-Ecology-Intelligence-1B (OE-13 field lift): preserve
    // canonical bullpen-fragility signals from deriveMlbBullpenContext.js so
    // bullpenFragilityContext(c) can read them inside scoreCandidate and
    // ladderSurvivabilityFactor. Anti-fabrication: when upstream bullpen
    // feed is dormant (dataAvailable=false / bullpenShift=0), bullpenShift
    // propagates as 0 and OE-13 falls back to a neutral score derived from
    // runEnvironment + impliedTeamTotal only. NEVER fabricates bullpen quality.
    bullpenShift:          raw.bullpenShift,
    reliefFatigueScore:    raw.reliefFatigueScore,
    bullpenDataAvailable:  raw.bullpenDataAvailable,
    raw,
  }
}

// ── Phase Market-Exploitation-1A pure helpers (EXPL-1 + EXPL-4) ──────────────

/**
 * Compute the staleRow lookup key matching the shopMap keying convention used
 * in buildFeaturedPlays main entry. Parses the "Type over/under Line" prop
 * string identically to staleRowToCompactPlay. Pure function. Exported for
 * unit testing.
 */
function staleRowLookupKey(staleRow) {
  if (!staleRow || !staleRow.player) return null
  const propStr  = String(staleRow.prop || "")
  const m        = propStr.match(/^(.+?)\s+(over|under)\s+([\d.]+)$/i)
  const propType = m ? m[1] : propStr
  const side     = m ? m[2].toLowerCase() : ""
  const line     = m ? Number(m[3]) : null
  const player   = String(staleRow.player).toLowerCase().trim()
  return [player, normFam(propType), side, line ?? "any"].join("|")
}

/**
 * Phase Market-Exploitation-1A (EXPL-1): deterministic market-support resolver.
 *
 * Returns the canonical (bookCount, consensusConfidence) pair for the staleRow's
 * underlying prop, plus a deterministic `supported` boolean that gates whether
 * the row may enter the disagreement / stale-line surfaces. Uses EXISTING
 * canonical fields only — never invents scoring.
 *
 * Doctrine: a disagreement edge surfaces ONLY when BOTH
 *   bookCount           >= EXPL1_MIN_BOOK_COUNT
 *   consensusConfidence >= EXPL1_MIN_CONSENSUS_CONFIDENCE
 * are satisfied. Otherwise the row is a single-book outlier / sparse-coverage
 * noise event and is suppressed from operator-visible surfaces.
 *
 * @param {object} staleRow
 * @param {Map} shopMap   Key → byProp entry built in buildFeaturedPlays main entry.
 * @returns {{ bookCount, consensusConfidence, supported }}
 */
function marketSupportFor(staleRow, shopMap) {
  const key = staleRowLookupKey(staleRow)
  const g   = key && shopMap ? shopMap.get(key) : null
  const bookCount           = Number.isFinite(g?.bookCount)           ? g.bookCount           : null
  const consensusConfidence = Number.isFinite(g?.consensusConfidence) ? g.consensusConfidence : null
  // Anti-fabrication: when either canonical field is missing, the staleRow
  // CANNOT be proven market-supported → ineligible (suppressed).
  const supported =
    bookCount !== null &&
    consensusConfidence !== null &&
    bookCount >= EXPL1_MIN_BOOK_COUNT &&
    consensusConfidence >= EXPL1_MIN_CONSENSUS_CONFIDENCE
  return { bookCount, consensusConfidence, supported }
}

/**
 * Phase Market-Exploitation-1A (EXPL-4): canonical OUT-status detector.
 *
 * Returns true iff the candidate's preserved playerStatus (canonical taxonomy
 * from pipeline/nba/nbaAvailabilityCache) is in EXPL4_HARD_DROP_STATUSES.
 * Honest unknown returns false (anti-fabrication: never drop on absence).
 */
function candidateIsHardDropAvailability(c) {
  if (!c || c.playerStatus == null) return false
  return EXPL4_HARD_DROP_STATUSES.has(String(c.playerStatus).toLowerCase())
}

/**
 * Phase Market-Exploitation-1A (EXPL-4): build a player → playerStatus index
 * from the normalized (pre-filter) candidate list. Used to gate staleRow-derived
 * buckets — when a staleRow's player is canonical OUT in the index, the row is
 * dropped (anti-stale-player doctrine). Players absent from the index → no
 * signal → no drop (anti-fabrication).
 */
function buildAvailabilityIndex(normalizedCandidates) {
  const idx = new Map()
  if (!Array.isArray(normalizedCandidates)) return idx
  for (const c of normalizedCandidates) {
    if (!c?.player || c.playerStatus == null) continue
    const k = String(c.player).toLowerCase().trim()
    // Preserve first-seen status; if multiple candidates exist for same player
    // they all carry the same enriched playerStatus.
    if (!idx.has(k)) idx.set(k, String(c.playerStatus).toLowerCase())
  }
  return idx
}

/**
 * Phase Market-Exploitation-1A (EXPL-4): staleRow-side availability gate.
 * Returns true iff the staleRow's player is canonical OUT in the index.
 */
function staleRowIsHardDropAvailability(staleRow, availabilityIndex) {
  if (!staleRow?.player || !availabilityIndex) return false
  const k = String(staleRow.player).toLowerCase().trim()
  const status = availabilityIndex.get(k)
  return status != null && EXPL4_HARD_DROP_STATUSES.has(status)
}

// ── Phase Bettor-Curation-Intelligence-1A constants (BC-2 + BC-4 + BC-5/7/8) ─
//
// Doctrine: every weighting / threshold is a deterministic operator-approved
// constant derived from canonical signals. NO ML, NO LLM, NO celebrity scoring.
// Anti-fabrication: when canonical fields are absent, helpers fall back to a
// NEUTRAL (no-op) value rather than synthesizing one.

// BC-2 — playerLegitimacyFactor inside scoreCandidate
const BC2_LEGITIMACY_WEIGHT          = 0.07   // 7% of composite (operator-approved 5-8% band)
const BC2_NEUTRAL_LEGITIMACY         = 0.70   // fallback when canonical fields absent
const BC2_DEPTH_LEGITIMACY = Object.freeze({
  top:    1.00,
  middle: 0.80,
  back:   0.50,
})
// impliedTeamTotal ramp multiplier on depth base
function bc2TeamTotalMultiplier(impliedTeamTotal) {
  if (!Number.isFinite(impliedTeamTotal)) return 1.00
  if (impliedTeamTotal >= 5.0) return 1.00
  if (impliedTeamTotal >= 4.5) return 0.90
  if (impliedTeamTotal >= 3.5) return 0.75
  return 0.55
}

// BC-4 — believable-upside soft demote inside buildBestHr / buildBestLadders / buildBestAggressive
const BC4_HR_SUPPRESSING_TAG         = "HR_SUPPRESSING"
const BC4_DESERT_TEAM_TOTAL_FLOOR    = 3.5
const BC4_SOFT_DEMOTE                = 0.05   // -0.05 effective composite at sort-time only (never mutates)

// BC-5 — believable-upside ticket bucket gate
const BC5_BELIEVABLE_DEPTHS          = Object.freeze(new Set(["top", "middle"]))
const BC5_BELIEVABLE_TEAM_TOTAL_MIN  = 4.5

// BC-7 — anti-replacement corroborator on buildAnchors
const BC7_ANCHOR_TEAM_TOTAL_MIN      = 4.5

// BC-8 — bettorRealismScore weights (sum = 1.0)
const BC8_DEPTH_COVERAGE_WEIGHT      = 0.40
const BC8_AVG_TEAM_TOTAL_WEIGHT      = 0.30
const BC8_GAME_TOTAL_WEIGHT          = 0.15
const BC8_HR_ENV_WEIGHT              = 0.15

// BC-9 — operator-visible realism accounting (module-scoped, reset per run)
let _bc9Stats = { suppressedHrSuppressing: 0, suppressedDesertTeamTotal: 0 }
function resetBc1aStats() { _bc9Stats = { suppressedHrSuppressing: 0, suppressedDesertTeamTotal: 0 } }
function getBc1aStats() { return { ..._bc9Stats } }

/**
 * Phase BC-2: deterministic player-legitimacy factor.
 *
 * Returns a value in [0, 1] derived from canonical `depth` × `impliedTeamTotal`.
 * Anti-fabrication: when BOTH canonical fields are absent → BC2_NEUTRAL_LEGITIMACY
 * (no promote, no demote). When only one is present, the other multiplier is
 * neutral 1.00. Pure function. Exported for unit testing.
 *
 * Examples (with multiplier ramp applied):
 *   depth="top"    + teamTotal=5.5 → 1.00 × 1.00 = 1.00
 *   depth="middle" + teamTotal=4.5 → 0.80 × 0.90 = 0.72
 *   depth="back"   + teamTotal=3.0 → 0.50 × 0.55 = 0.275
 *   depth absent   + teamTotal=5.5 → BC2_NEUTRAL × 1.00 = 0.70
 *   both absent                    → BC2_NEUTRAL_LEGITIMACY = 0.70
 *
 * The factor enters scoreCandidate's composite at BC2_LEGITIMACY_WEIGHT (7%).
 */
function playerLegitimacyFactor(candidate) {
  if (!candidate) return BC2_NEUTRAL_LEGITIMACY
  const depthKey  = candidate.depth != null ? String(candidate.depth).toLowerCase() : null
  const teamTotal = num(candidate.impliedTeamTotal)
  const depthBase = depthKey && BC2_DEPTH_LEGITIMACY[depthKey] != null
    ? BC2_DEPTH_LEGITIMACY[depthKey]
    : BC2_NEUTRAL_LEGITIMACY  // depth absent → neutral
  const ramp = bc2TeamTotalMultiplier(teamTotal)
  return clamp(0, 1, depthBase * ramp)
}

/**
 * Phase BC-4: believable-upside soft-demote detector.
 *
 * Returns the BC4_SOFT_DEMOTE penalty (positive number to SUBTRACT from
 * effective composite at sort time) when the candidate sits in an environment
 * hostile to the upside thesis (HR_SUPPRESSING park OR desert team total).
 * Returns 0 when canonical signals are absent (anti-fabrication: no demote
 * when we can't prove the environment is hostile).
 *
 * Also increments BC-9 module-scoped counters for operator-visible accounting.
 * Pure-ish: the counter increment is the only side effect (rate-limited log
 * happens at end of buildFeaturedPlays run).
 */
function believableUpsideDemote(candidate) {
  if (!candidate) return 0
  const tag = candidate.hrEnvironmentTag
  const teamTotal = num(candidate.impliedTeamTotal)
  let demote = 0
  if (tag === BC4_HR_SUPPRESSING_TAG) {
    demote = BC4_SOFT_DEMOTE
    _bc9Stats.suppressedHrSuppressing++
  }
  if (teamTotal != null && teamTotal < BC4_DESERT_TEAM_TOTAL_FLOOR) {
    // Additive penalty even if HR-suppressing tag already fired — desert team
    // totals are a SEPARATE hostility signal. Bounded by BC4_SOFT_DEMOTE so
    // total demote never exceeds 2× BC4_SOFT_DEMOTE = 0.10.
    demote = Math.max(demote, BC4_SOFT_DEMOTE)
    _bc9Stats.suppressedDesertTeamTotal++
  }
  return demote
}

/**
 * Phase BC-5: believable-upside gate.
 *
 * Returns true when ALL three canonical conditions hold:
 *   depth ∈ {top, middle}  AND
 *   impliedTeamTotal >= 4.5 AND
 *   hrEnvironmentTag !== "HR_SUPPRESSING"
 *
 * Anti-fabrication: when any required signal is absent, returns false (the
 * candidate is NOT proven believable — the bucket stays auto-empty when
 * canonical context isn't available, never synthesizing membership).
 */
function isBelievableUpsideCandidate(candidate) {
  if (!candidate) return false
  const depthKey  = candidate.depth != null ? String(candidate.depth).toLowerCase() : null
  const teamTotal = num(candidate.impliedTeamTotal)
  if (!depthKey || !BC5_BELIEVABLE_DEPTHS.has(depthKey)) return false
  if (teamTotal == null || teamTotal < BC5_BELIEVABLE_TEAM_TOTAL_MIN) return false
  if (candidate.hrEnvironmentTag === BC4_HR_SUPPRESSING_TAG) return false
  return true
}

// ── Phase Offensive-Ecology-Intelligence-1A constants (OE-1..OE-10) ──────────
//
// Doctrine: every boost / demote / aggregator derives from CANONICAL fields
// already populated on row context by `derive*Context.js` modules and lifted
// via BC-1 / OE-1. Neutral fallback when canonical absent (anti-fabrication).
// NO opaque ML, NO GPT, NO celebrity scoring, NO fake explosion narratives.
// All weights are small (3-5% caps) — existing 10-factor composite UNCHANGED.

// OE-2 — offensivePressureIndex constants
const OE2_PRESSURE_WEIGHT       = 0.05  // 5% additive composite weight
const OE2_NEUTRAL_PRESSURE      = 0.50  // anti-fabrication neutral
// teamTotal multiplier ramp (mirrors BC-2 ramp shape)
function oe2TeamTotalMultiplier(impliedTeamTotal) {
  if (!Number.isFinite(impliedTeamTotal)) return null
  if (impliedTeamTotal >= 5.0) return 1.00
  if (impliedTeamTotal >= 4.5) return 0.90
  if (impliedTeamTotal >= 3.5) return 0.75
  return 0.55
}
// carryShift bonus: bounded ±0.10 from upstream → boost factor ∈ [0.95, 1.05]
function oe2CarryShiftBonus(carryShift) {
  if (!Number.isFinite(carryShift)) return 1.00
  return clamp(0.90, 1.10, 1.0 + carryShift * 0.5)
}

// OE-3 — hrCarryEnvironment constants
const OE3_HR_BOOST_CAP          = 0.03  // +0.03 additive composite boost on HR overs
const OE3_HR_FRIENDLY_TAG       = "HR_FRIENDLY"
const OE3_WIND_OUT_TAGS         = Object.freeze(new Set([
  "out_to_cf", "out_to_lf", "out_to_rf", "out_left", "out_center", "out_right",
]))
const OE3_TEMP_MIN_F            = 75

// OE-4 — correlatedRunProduction constants
const OE4_RUN_BOOST_CAP         = 0.03  // +0.03 additive composite boost on runs/RBIs top-of-order
const OE4_TOP_OF_ORDER_MAX_SPOT = 4     // lineupSpot 1-4 qualifies
const OE4_ENV_THRESHOLD         = 0.55  // both run/rbi env must clear the spot's natural midpoint

// OE-5 — explosiveEnvironmentTag constants
const OE5_GAME_TOTAL_MIN        = 9.5
const OE5_AVG_TEAM_TOTAL_MIN    = 4.5
const OE5_EXPLOSIVE_TAG         = "EXPLOSIVE"

// OE-6 — buildExplosiveUpsideTickets constants
const OE6_EXPLOSIVE_MAX_TICKETS = 5

// OE-8 — ladderSurvivabilityFactor constants
const OE8_LADDER_DEMOTE_CAP     = 0.04  // -0.04 effective composite penalty at sort time
const OE8_SURVIVABILITY_FLOOR   = 0.40
const OE8_NEUTRAL_PA_PROXY      = 4.2   // mid-of-lineup PA proxy

// OE-9 — module-scoped operator-visible counters (reset per buildFeaturedPlays run)
let _oe1aStats = {
  explosiveEventsTagged:      0,
  hrCarryBoostsApplied:       0,
  runProductionBoostsApplied: 0,
  pressureBoostsApplied:      0,
  survivabilityDemotesApplied:0,
}
function resetOe1aStats() {
  _oe1aStats = {
    explosiveEventsTagged:      0,
    hrCarryBoostsApplied:       0,
    runProductionBoostsApplied: 0,
    pressureBoostsApplied:      0,
    survivabilityDemotesApplied:0,
  }
}
function getOe1aStats() { return { ..._oe1aStats } }

/**
 * Phase OE-2 — offensivePressureIndex.
 *
 * Deterministic boost in [0, 1] for HITTER OVERS ONLY. Composes canonical
 * `runEnvironment` × team-total ramp × carry-shift bonus. Neutral fallback
 * OE2_NEUTRAL_PRESSURE when ANY canonical field absent — anti-fabrication
 * (never invents pressure when we can't prove the environment supports it).
 *
 * Side effect: increments _oe1aStats.pressureBoostsApplied when boost > neutral.
 * Pure-ish: side-effect is a per-run counter for operator observability.
 */
function offensivePressureIndex(candidate) {
  if (!candidate) return OE2_NEUTRAL_PRESSURE
  // Hitter OVERS only — under-side legs return neutral (no boost AND no demote).
  if (candidate.side !== "over") return OE2_NEUTRAL_PRESSURE
  if (!isOffensiveAttackStat(candidate.statFamily)) return OE2_NEUTRAL_PRESSURE
  const runEnv    = num(candidate.runEnvironment)
  const teamTotal = num(candidate.impliedTeamTotal)
  // Anti-fabrication: REQUIRE both canonical signals; otherwise neutral.
  if (runEnv == null || teamTotal == null) return OE2_NEUTRAL_PRESSURE
  const teamMult = oe2TeamTotalMultiplier(teamTotal)
  if (teamMult == null) return OE2_NEUTRAL_PRESSURE
  const carryMult = oe2CarryShiftBonus(num(candidate.carryShift))
  const score = clamp(0, 1, runEnv * teamMult * carryMult)
  if (score > OE2_NEUTRAL_PRESSURE) _oe1aStats.pressureBoostsApplied++
  return score
}

/**
 * Phase OE-3 — hrCarryEnvironment.
 *
 * Returns the additive composite boost (∈ [0, OE3_HR_BOOST_CAP]) for HR OVERS
 * in favorable HR environments. Positive symmetry to BC-4 hostile-environment
 * soft-demote. Anti-fabrication: returns 0 when any canonical signal absent.
 *
 * Activation gate (all four required):
 *   - candidate.side === "over"
 *   - candidate.statFamily indicates HR / home_runs (substring check)
 *   - windDirectionTag ∈ OE3_WIND_OUT_TAGS
 *   - carryShift > 0
 *   - hrEnvironmentTag === "HR_FRIENDLY"
 *   - temperatureF >= OE3_TEMP_MIN_F
 *
 * Side effect: increments _oe1aStats.hrCarryBoostsApplied when boost applied.
 */
function hrCarryEnvironment(candidate) {
  if (!candidate || candidate.side !== "over") return 0
  const fam = String(candidate.statFamily || "").toLowerCase()
  const isHr = /home.?run|^hr$|homers/.test(fam)
  if (!isHr) return 0
  // Anti-fabrication: every signal must be PRESENT (truthy or explicit).
  const wind = String(candidate.windDirectionTag || "").toLowerCase()
  if (!wind || !OE3_WIND_OUT_TAGS.has(wind)) return 0
  const carry = num(candidate.carryShift)
  if (carry == null || carry <= 0) return 0
  if (candidate.hrEnvironmentTag !== OE3_HR_FRIENDLY_TAG) return 0
  const temp = num(candidate.temperatureF)
  if (temp == null || temp < OE3_TEMP_MIN_F) return 0
  _oe1aStats.hrCarryBoostsApplied++
  return OE3_HR_BOOST_CAP
}

/**
 * Phase OE-4 — correlatedRunProduction.
 *
 * Returns additive composite boost (∈ [0, OE4_RUN_BOOST_CAP]) for runs / RBIs
 * hitter overs at top-of-order with strong canonical run/RBI environment.
 * Anti-fabrication: returns 0 when any canonical signal absent.
 *
 * Activation gate (all required):
 *   - candidate.side === "over"
 *   - candidate.statFamily ∈ {runs, rbis} (substring check)
 *   - lineupSpot ≤ OE4_TOP_OF_ORDER_MAX_SPOT (1-4)
 *   - runEnvironment OR rbiEnvironment ≥ OE4_ENV_THRESHOLD (0.55)
 */
function correlatedRunProduction(candidate) {
  if (!candidate || candidate.side !== "over") return 0
  const fam = String(candidate.statFamily || "").toLowerCase()
  const isRunRbi = fam.includes("rbi") || fam === "runs" || fam.includes("runsscored")
  if (!isRunRbi) return 0
  const spot = num(candidate.lineupSpot)
  if (spot == null || spot < 1 || spot > OE4_TOP_OF_ORDER_MAX_SPOT) return 0
  const runEnv = num(candidate.runEnvironment)
  const rbiEnv = num(candidate.rbiEnvironment)
  // Anti-fabrication: at least one canonical environment must be present AND
  // clear the threshold.
  const supported =
    (runEnv != null && runEnv >= OE4_ENV_THRESHOLD) ||
    (rbiEnv != null && rbiEnv >= OE4_ENV_THRESHOLD)
  if (!supported) return 0
  _oe1aStats.runProductionBoostsApplied++
  return OE4_RUN_BOOST_CAP
}

/**
 * Phase OE-5 — buildExplosiveEnvironmentIndex.
 *
 * Per-event aggregator. Returns a Map<eventId, true> for events satisfying ALL
 * canonical gates:
 *   - gameTotal >= OE5_GAME_TOTAL_MIN (9.5)
 *   - average(impliedTeamTotal) across candidates in that event >= 4.5
 *   - at least one row carries windDirectionTag ∈ OE3_WIND_OUT_TAGS
 *   - no row carries hrEnvironmentTag === "HR_SUPPRESSING"
 *
 * Pure observational. Auto-empty when canonical signals absent. Increments
 * _oe1aStats.explosiveEventsTagged per qualifying event.
 */
function buildExplosiveEnvironmentIndex(normalizedCandidates) {
  const idx = new Map()
  if (!Array.isArray(normalizedCandidates) || normalizedCandidates.length === 0) return idx

  // Aggregate per eventId
  const byEvent = new Map()
  for (const c of normalizedCandidates) {
    const eid = c?.eventId
    if (!eid) continue
    if (!byEvent.has(eid)) byEvent.set(eid, { rows: [], gameTotals: [], teamTotals: [], winds: [], hrTags: [] })
    const slot = byEvent.get(eid)
    slot.rows.push(c)
    const gt = num(c.gameTotal); if (gt != null) slot.gameTotals.push(gt)
    const tt = num(c.impliedTeamTotal); if (tt != null) slot.teamTotals.push(tt)
    if (c.windDirectionTag) slot.winds.push(String(c.windDirectionTag).toLowerCase())
    if (c.hrEnvironmentTag) slot.hrTags.push(c.hrEnvironmentTag)
  }

  for (const [eid, slot] of byEvent) {
    if (!slot.gameTotals.length || !slot.teamTotals.length) continue
    // Use max gameTotal in case of any per-row variance — gameTotal is a
    // per-game scalar, but anti-fabrication: read every row honestly.
    const maxGameTotal = Math.max(...slot.gameTotals)
    if (maxGameTotal < OE5_GAME_TOTAL_MIN) continue
    const avgTeamTotal = slot.teamTotals.reduce((s, v) => s + v, 0) / slot.teamTotals.length
    if (avgTeamTotal < OE5_AVG_TEAM_TOTAL_MIN) continue
    const hasWindOut = slot.winds.some((w) => OE3_WIND_OUT_TAGS.has(w))
    if (!hasWindOut) continue
    const hasHrSuppressing = slot.hrTags.includes("HR_SUPPRESSING")
    if (hasHrSuppressing) continue
    idx.set(eid, true)
    _oe1aStats.explosiveEventsTagged++
  }
  return idx
}

/**
 * Phase OE-6 — buildExplosiveUpsideTickets.
 *
 * Observational additive bucket mirroring BC-5 doctrine. Surfaces top-N hitter
 * OVERS from candidates whose eventId is tagged EXPLOSIVE per OE-5. Sort:
 * composite (no new ranking math). Anti-fabrication: auto-empty when no events
 * qualify. Uses pickDiversified to avoid same-player / single-game spam.
 */
function buildExplosiveUpsideTickets(scored, explosiveIndex, count = OE6_EXPLOSIVE_MAX_TICKETS, opts = {}) {
  if (!Array.isArray(scored) || !scored.length) return []
  if (!explosiveIndex || explosiveIndex.size === 0) return []
  const filtered = scored.filter((x) => {
    if (!x?.c) return false
    if (x.c.side !== "over") return false
    if (!isOffensiveAttackStat(x.c.statFamily)) return false
    return explosiveIndex.has(x.c.eventId)
  })
  // Phase Offensive-Ecology-Intelligence-1B (OE-12): lineup-turnover sort-time
  // soft boost on the explosive-upside surface. Mirrors aggressive/lotto.
  const turnoverIdx = opts.turnoverIndex || null
  const boosted = filtered
    .map((x) => ({ x, effComposite: (x.score.composite ?? 0) + lineupTurnoverBoost(x.c, turnoverIdx) }))
    .sort((a, b) => b.effComposite - a.effComposite)
    .map((d) => d.x)
  return pickDiversified(boosted, count, { maxPerPlayer: 1, maxPerGame: 3, maxPerStat: 3 })
}

/**
 * Phase OE-8 — ladderSurvivabilityFactor.
 *
 * Pure-function survivability score in [0, 1] for ladder candidates. Composes:
 *   ladderHeightFactor × plateAppearanceFactor × runEnvFactor × hrCarryFactor
 *
 * Sub-component math:
 *   ladderHeightFactor   = 1 / (1 + (line - 1.5) * 0.3)   when line >= 1.5; else 1
 *                           (a 1.5-line ladder = 1.0; a 3.5 ladder ≈ 0.625)
 *   plateAppearanceFactor= plateAppearancesProxy / OE8_NEUTRAL_PA_PROXY (clamped)
 *   runEnvFactor         = runEnvironment            (when present; else 1.0)
 *   hrCarryFactor        = 1 + (hrCarryEnvironment / OE3_HR_BOOST_CAP) * 0.2
 *                           (HR-favorable adds up to +0.2 multiplier for HR/TB ladders)
 *
 * Anti-fabrication: when canonical signals are absent, sub-factors degrade to
 * 1.0 (neutral). Never invents survivability.
 *
 * Returned to caller; demote application logic lives in buildBestLadders (sort-
 * time wrapper). Caller increments _oe1aStats.survivabilityDemotesApplied
 * only when the factor actually fires a demote.
 */
function ladderSurvivabilityFactor(candidate) {
  if (!candidate) return 1.00
  const line = num(candidate.line)
  const ladderHeightFactor = (line != null && line >= 1.5)
    ? clamp(0, 1.5, 1 / (1 + (line - 1.5) * 0.3))
    : 1.00
  const paProxy = num(candidate.plateAppearancesProxy)
  const paFactor = paProxy != null
    ? clamp(0.5, 1.5, paProxy / OE8_NEUTRAL_PA_PROXY)
    : 1.00
  const runEnv = num(candidate.runEnvironment)
  const runEnvFactor = runEnv != null ? clamp(0, 1.0, runEnv) + 0.5 : 1.00
  // hrCarryFactor: only meaningful for HR / total_bases families
  const fam = String(candidate.statFamily || "").toLowerCase()
  const isHrOrTb = /home.?run|^hr$|homers|totalbase/.test(fam)
  let hrCarryFactor = 1.00
  if (isHrOrTb) {
    const hrBoost = hrCarryEnvironment({ ...candidate, side: "over", statFamily: "hr" }) // probe only
    // Subtract the counter increment caused by the probe — it's not a real boost application.
    _oe1aStats.hrCarryBoostsApplied = Math.max(0, _oe1aStats.hrCarryBoostsApplied - (hrBoost > 0 ? 1 : 0))
    hrCarryFactor = 1.0 + (hrBoost / OE3_HR_BOOST_CAP) * 0.2
  }
  return clamp(0, 2, ladderHeightFactor * paFactor * runEnvFactor * hrCarryFactor)
}

/**
 * Phase OE-8 helper — returns the effective composite demote to subtract at
 * sort time. Returns 0 when factor >= OE8_SURVIVABILITY_FLOOR (neutral / no
 * demote). Returns OE8_LADDER_DEMOTE_CAP when factor < floor (max -0.04 demote).
 * Side effect: increments _oe1aStats.survivabilityDemotesApplied when demote fires.
 */
function ladderSurvivabilityDemote(candidate) {
  const factor = ladderSurvivabilityFactor(candidate)
  if (factor >= OE8_SURVIVABILITY_FLOOR) return 0
  _oe1aStats.survivabilityDemotesApplied++
  return OE8_LADDER_DEMOTE_CAP
}

// ── Phase Offensive-Ecology-Intelligence-1B constants (OE-11..OE-13) ─────────
//
// Doctrine: positive offensive REINFORCEMENT — same-team hitter-OVER pairs in
// EXPLOSIVE environments earn small joint-prob boosts; lineup-turnover-prone
// games softly elevate aggressive/lotto/explosive surfaces; bullpen fragility
// softly boosts hitter overs late-game. ALL CAPS VERY TIGHT.
//
// Critical anti-fabrication invariants (operator-enforced):
//   - NO exponential boosts. NO parlay payout chasing. NO blanket same-team bonuses.
//   - NO fake SGP inflation. NO sportsbook-behavior simulation.
//   - NEUTRAL fallback when canonical bullpen data absent (OE-13).
//   - Covariance hard blocks (MLB-COV-2/3) are PRESERVED — OE-11 only activates
//     when pairCorrelationScore === +0.5 (positive cov case the hard blocks
//     don't touch).
//   - Hidden-value unders UNTOUCHED — all OE-1B helpers require side === "over".

// OE-11 — Pair-reinforcement constants (VERY tight caps)
const OE11_PAIR_BOOST_CAP        = 0.02   // per-pair boost cap (max joint-prob multiplier contribution per pair)
const OE11_TOTAL_BOOST_CAP       = 0.03   // aggregate joint-prob multiplier cap (operator: ~+0.03 max)
const OE11_PRESSURE_FLOOR        = 0.60   // both legs must clear this offensivePressureIndex threshold

// OE-12 — Lineup-turnover constants
const OE12_TURNOVER_BOOST_CAP    = 0.02   // sort-time soft additive boost cap for aggressive/lotto/explosive buckets
const OE12_NEUTRAL_TURNOVER      = 0.50   // anti-fabrication neutral
const OE12_TOP_MIDDLE_DEPTHS     = Object.freeze(new Set(["top", "middle"]))

// OE-13 — Bullpen-fragility constants
const OE13_BULLPEN_BOOST_CAP     = 0.02   // ~+0.02 soft additive boost cap in scoreCandidate
const OE13_NEUTRAL_FRAGILITY     = 0.50   // anti-fabrication neutral
const OE13_FRAGILITY_THRESHOLD   = 0.55   // boost activates only above threshold

/**
 * Phase OE-11 — stackReinforcementScore (per-pair).
 *
 * Returns per-pair joint-prob boost ∈ [0, OE11_PAIR_BOOST_CAP] for same-team
 * hitter-OVER pairs that satisfy ALL canonical gates:
 *   - Both legs same eventId (same game).
 *   - Both legs same team (same offense).
 *   - Both legs side === "over".
 *   - Both legs isOffensiveAttackStat(statFamily).
 *   - Both legs cleared offensivePressureIndex > OE11_PRESSURE_FLOOR.
 *   - Both legs in EXPLOSIVE-tagged event per OE-5 gates (read directly from
 *     leg-level canonical fields: gameTotal >= OE5_GAME_TOTAL_MIN AND
 *     impliedTeamTotal >= OE5_AVG_TEAM_TOTAL_MIN AND windDirectionTag ∈
 *     OE3_WIND_OUT_TAGS AND hrEnvironmentTag !== HR_SUPPRESSING).
 *   - Canonical pairCorrelationScore === +0.5 (the positive same-team-hitter-
 *     OVER case the MLB-COV hard blocks DO NOT touch).
 *
 * Anti-fabrication: returns 0 when ANY gate fails. NO exponential boosts.
 * NO blanket same-team bonuses. NO fake SGP inflation.
 *
 * Pure function. Side effect: increments _oe1bStats.pairReinforcementBoosts
 * when boost fires (for operator-visible accounting).
 */
function stackReinforcementScore(legA, legB) {
  if (!legA || !legB) return 0
  if (legA.eventId !== legB.eventId) return 0
  if (!legA.eventId) return 0
  if (legA.team !== legB.team) return 0
  if (!legA.team) return 0
  if (legA.side !== "over" || legB.side !== "over") return 0
  if (!isOffensiveAttackStat(legA.statFamily) || !isOffensiveAttackStat(legB.statFamily)) return 0

  // Both must clear pressure floor (canonical OE-2 helper)
  const pA = offensivePressureIndex(legA)
  const pB = offensivePressureIndex(legB)
  if (pA <= OE11_PRESSURE_FLOOR || pB <= OE11_PRESSURE_FLOOR) return 0

  // EXPLOSIVE environment gate at the leg-level (mirrors OE-5 per-event aggregator):
  // both legs must carry gameTotal>=9.5, impliedTeamTotal>=4.5, wind-out tag, not HR_SUPPRESSING.
  const gameTotalA = num(legA.gameTotal)
  const gameTotalB = num(legB.gameTotal)
  if (gameTotalA == null || gameTotalA < OE5_GAME_TOTAL_MIN) return 0
  if (gameTotalB == null || gameTotalB < OE5_GAME_TOTAL_MIN) return 0
  const ttA = num(legA.impliedTeamTotal)
  const ttB = num(legB.impliedTeamTotal)
  if (ttA == null || ttA < OE5_AVG_TEAM_TOTAL_MIN) return 0
  if (ttB == null || ttB < OE5_AVG_TEAM_TOTAL_MIN) return 0
  const windA = String(legA.windDirectionTag || "").toLowerCase()
  const windB = String(legB.windDirectionTag || "").toLowerCase()
  if (!OE3_WIND_OUT_TAGS.has(windA) || !OE3_WIND_OUT_TAGS.has(windB)) return 0
  if (legA.hrEnvironmentTag === BC4_HR_SUPPRESSING_TAG || legB.hrEnvironmentTag === BC4_HR_SUPPRESSING_TAG) return 0

  // Canonical correlation engine consultation. pairCorrelationScore is the
  // authoritative truth-layer for same-team-hitter-OVER coherence (Phase
  // MLB-Correlation-Engine-1A). We REQUIRE === +0.5 — the positive case
  // that MLB-COV-2/3 hard blocks DO NOT touch.
  const score = _mlbPairCorrelationScore(legA, legB)
  if (score !== 0.5) return 0

  // Boost magnitude: small additive contribution scaling with average pressure
  // strength. Both legs cleared OE11_PRESSURE_FLOOR (0.60); scale linearly in
  // [floor, 1.0] → boost ∈ [0, OE11_PAIR_BOOST_CAP]. Clamped.
  const pressureStrength = clamp(0, 1, ((pA + pB) / 2 - OE11_PRESSURE_FLOOR) / (1 - OE11_PRESSURE_FLOOR))
  const boost = clamp(0, OE11_PAIR_BOOST_CAP, OE11_PAIR_BOOST_CAP * pressureStrength)
  if (boost > 0) _oe1bStats.pairReinforcementBoosts++
  return boost
}

// Lazy require of canonical MLB pair-correlation engine. Mirrors the lazy
// pattern used elsewhere; safe at module load time.
let __mlbCorrCached = null
function _mlbPairCorrelationScore(a, b) {
  if (!__mlbCorrCached) __mlbCorrCached = require("../mlb/buildMlbCorrelationEngine")
  return __mlbCorrCached.pairCorrelationScore(a, b)
}

/**
 * Phase OE-12 — lineupTurnoverPotential (per-event).
 *
 * Returns score ∈ [0, 1] aggregating canonical signals from candidates that
 * share an event:
 *   - Top/middle depth density   → fraction of event candidates with depth ∈ {top, middle}
 *   - impliedTeamTotal (avg)     → / 5.0, clamped
 *   - runEnvironment (avg)       → clamped [0, 1]
 *   - explosiveEnvironmentTag    → boolean upgrade (+0.20 to combined score)
 *
 * Anti-fabrication: neutral OE12_NEUTRAL_TURNOVER (0.50) when canonical
 * signals absent. NEVER fabricates turnover potential.
 *
 * Pure function. NO ML. NO GPT.
 */
function lineupTurnoverPotential(eventCandidates, isExplosive) {
  if (!Array.isArray(eventCandidates) || eventCandidates.length === 0) {
    return OE12_NEUTRAL_TURNOVER
  }
  let depthHits = 0
  let depthSeen = 0
  const teamTotals = []
  const runEnvs = []
  for (const c of eventCandidates) {
    if (c?.depth != null) {
      depthSeen++
      if (OE12_TOP_MIDDLE_DEPTHS.has(String(c.depth).toLowerCase())) depthHits++
    }
    const tt = num(c?.impliedTeamTotal)
    if (tt != null) teamTotals.push(tt)
    const re = num(c?.runEnvironment)
    if (re != null) runEnvs.push(re)
  }
  const depthFraction = depthSeen > 0 ? depthHits / depthSeen : 0
  const avgTeamTotalNorm = teamTotals.length > 0
    ? clamp(0, 1, (teamTotals.reduce((s, v) => s + v, 0) / teamTotals.length) / 5.0)
    : 0
  const avgRunEnv = runEnvs.length > 0
    ? clamp(0, 1, runEnvs.reduce((s, v) => s + v, 0) / runEnvs.length)
    : 0
  // Combined score: weighted aggregate + explosive upgrade
  let score = 0.35 * depthFraction + 0.30 * avgTeamTotalNorm + 0.35 * avgRunEnv
  if (isExplosive === true) score = clamp(0, 1, score + 0.20)
  // If NO canonical signals were available, return neutral instead of synthesized 0
  if (depthSeen === 0 && teamTotals.length === 0 && runEnvs.length === 0) {
    return OE12_NEUTRAL_TURNOVER
  }
  return clamp(0, 1, score)
}

/**
 * Phase OE-12 — buildLineupTurnoverIndex (per-event).
 *
 * Returns Map<eventId, turnoverScore ∈ [0,1]> for every event in the
 * normalized candidate pool. Consumed by aggressive / lotto / explosive
 * buckets as a soft additive sort-time boost (cap OE12_TURNOVER_BOOST_CAP).
 *
 * Anti-fabrication: empty Map when canonical signals absent.
 */
function buildLineupTurnoverIndex(normalizedCandidates, explosiveIndex) {
  const idx = new Map()
  if (!Array.isArray(normalizedCandidates) || normalizedCandidates.length === 0) return idx
  const byEvent = new Map()
  for (const c of normalizedCandidates) {
    const eid = c?.eventId
    if (!eid) continue
    if (!byEvent.has(eid)) byEvent.set(eid, [])
    byEvent.get(eid).push(c)
  }
  for (const [eid, rows] of byEvent) {
    const isExp = explosiveIndex ? explosiveIndex.has(eid) : false
    const score = lineupTurnoverPotential(rows, isExp)
    idx.set(eid, score)
  }
  return idx
}

/**
 * Phase OE-12 — turnover sort-time boost for aggressive / lotto / explosive
 * buckets. Returns additive composite boost ∈ [0, OE12_TURNOVER_BOOST_CAP]
 * scaling linearly with turnover score above neutral threshold. Anti-fabrication:
 * 0 when index absent or eventId not in index.
 */
function lineupTurnoverBoost(candidate, turnoverIndex) {
  if (!candidate?.eventId || !turnoverIndex) return 0
  const score = turnoverIndex.get(candidate.eventId)
  if (!Number.isFinite(score) || score <= OE12_NEUTRAL_TURNOVER) return 0
  // Scale linearly above neutral; cap at boost cap
  const above = (score - OE12_NEUTRAL_TURNOVER) / (1 - OE12_NEUTRAL_TURNOVER)
  const boost = clamp(0, OE12_TURNOVER_BOOST_CAP, OE12_TURNOVER_BOOST_CAP * above)
  if (boost > 0) _oe1bStats.turnoverBoostsApplied++
  return boost
}

/**
 * Phase OE-13 — bullpenFragilityContext.
 *
 * Returns ~+0.02 cap additive composite boost for HITTER OVERS when:
 *   - Canonical bullpen signals indicate fragility (high reliefFatigueScore
 *     or negative bullpenShift indicating weak relief), AND
 *   - Late-game offensive support exists (runEnvironment >= threshold AND
 *     impliedTeamTotal >= 4.5).
 *
 * Anti-fabrication: when canonical bullpen data absent (bullpenDataAvailable
 * !== true), the bullpen sub-component falls back to NEUTRAL (OE13_NEUTRAL_FRAGILITY).
 * Final boost reflects ONLY canonical run/teamTotal context — NEVER fabricates
 * fragility.
 *
 * Pure-ish: increments _oe1bStats.bullpenBoostsApplied when boost > 0.
 */
function bullpenFragilityContext(candidate) {
  if (!candidate || candidate.side !== "over") return 0
  if (!isOffensiveAttackStat(candidate.statFamily)) return 0

  // Component 1: bullpen fragility (anti-fabrication on missing data)
  let bullpenFragility = OE13_NEUTRAL_FRAGILITY
  if (candidate.bullpenDataAvailable === true) {
    // Canonical bullpenShift convention from deriveMlbBullpenContext.js:
    // bullpenShift > 0 indicates SUPPORTIVE for batters (bullpen weak / fatigued).
    // bullpenShift < 0 indicates SUPPRESSIVE (sharp bullpen).
    const shift = num(candidate.bullpenShift)
    const fatigue = num(candidate.reliefFatigueScore)
    if (shift != null && shift > 0) bullpenFragility = Math.min(1.0, OE13_NEUTRAL_FRAGILITY + shift * 5)
    if (fatigue != null && fatigue >= 0.6) bullpenFragility = Math.max(bullpenFragility, 0.70)
  }
  // When bullpen data absent: bullpenFragility stays at neutral 0.50 (anti-fabrication)

  // Component 2: late-game offensive support (canonical run + teamTotal)
  const runEnv = num(candidate.runEnvironment)
  const teamTotal = num(candidate.impliedTeamTotal)
  let support = 0
  if (runEnv != null && runEnv >= 0.55) support += 0.5
  if (teamTotal != null && teamTotal >= 4.5) support += 0.5

  // Combined fragility-with-support score
  const score = bullpenFragility * support  // ∈ [0, 1]
  if (score <= OE13_FRAGILITY_THRESHOLD) return 0
  const above = (score - OE13_FRAGILITY_THRESHOLD) / (1 - OE13_FRAGILITY_THRESHOLD)
  const boost = clamp(0, OE13_BULLPEN_BOOST_CAP, OE13_BULLPEN_BOOST_CAP * above)
  if (boost > 0) _oe1bStats.bullpenBoostsApplied++
  return boost
}

// Phase OE-1B operator-visible counters (reset per buildFeaturedPlays run)
let _oe1bStats = {
  pairReinforcementBoosts:  0,
  turnoverBoostsApplied:    0,
  bullpenBoostsApplied:     0,
  lineupTurnoverEventsHigh: 0,
}
function resetOe1bStats() {
  _oe1bStats = {
    pairReinforcementBoosts:  0,
    turnoverBoostsApplied:    0,
    bullpenBoostsApplied:     0,
    lineupTurnoverEventsHigh: 0,
  }
}
function getOe1bStats() { return { ..._oe1bStats } }

/**
 * Phase BC-7: anti-replacement corroborator predicate for buildAnchors.
 *
 * Returns true when the candidate satisfies either canonical legitimacy
 * signal: depth ∈ {top, middle} OR impliedTeamTotal >= 4.5. When both
 * canonical fields are absent, returns false (no contribution to corrobs
 * count — anti-fabrication: never invent legitimacy).
 *
 * This is an ADDITIVE corroborator to the existing 6 in buildAnchors. Never
 * removes any existing corroborator; never blocks an anchor that would have
 * cleared the gate on existing corroborators alone.
 */
function isAntiReplacementCorroborator(candidate) {
  if (!candidate) return false
  const depthKey  = candidate.depth != null ? String(candidate.depth).toLowerCase() : null
  const teamTotal = num(candidate.impliedTeamTotal)
  if (depthKey && BC5_BELIEVABLE_DEPTHS.has(depthKey)) return true
  if (teamTotal != null && teamTotal >= BC7_ANCHOR_TEAM_TOTAL_MIN) return true
  return false
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

  // Phase Bettor-Curation-Intelligence-1A (BC-2): deterministic legitimacy
  // factor — derives entirely from canonical depth × impliedTeamTotal signals
  // lifted in BC-1. Weight is BC2_LEGITIMACY_WEIGHT (7%) of composite.
  // Anti-fabrication: returns BC2_NEUTRAL_LEGITIMACY (0.70) when canonical
  // fields are absent — neither promotes nor demotes the candidate.
  // NO new fetches, NO ML, NO celebrity scoring.
  f.legitimacy = playerLegitimacyFactor(c)
  total += f.legitimacy * BC2_LEGITIMACY_WEIGHT
  weight += BC2_LEGITIMACY_WEIGHT

  // Phase Offensive-Ecology-Intelligence-1A (OE-2): deterministic offensive-
  // pressure index for HITTER OVERS ONLY. Composes canonical runEnvironment ×
  // impliedTeamTotal ramp × carryShift bonus. Neutral fallback 0.50 when any
  // canonical field absent (anti-fabrication). 5% additive composite weight.
  // NO opaque ML, NO GPT, NO celebrity scoring.
  f.pressure = offensivePressureIndex(c)
  total += f.pressure * OE2_PRESSURE_WEIGHT
  weight += OE2_PRESSURE_WEIGHT

  // Phase Offensive-Ecology-Intelligence-1A (OE-3 + OE-4): additive small-cap
  // boosts (positive symmetry to BC-4 hostile-environment soft-demote):
  //   - hrCarryEnvironment   → +0.03 cap on HR overs (wind-out + carryShift>0
  //     + HR_FRIENDLY park + temp >= 75)
  //   - correlatedRunProduction → +0.03 cap on runs/RBIs overs at top-of-order
  //     (lineupSpot 1-4 + runEnvironment OR rbiEnvironment >= 0.55)
  // Anti-fabrication: each returns 0 when canonical signals absent.
  // Combined cap: +0.06 across both (only one fires per candidate by family).
  const oeHrBoost  = hrCarryEnvironment(c)
  const oeRunBoost = correlatedRunProduction(c)
  // Phase Offensive-Ecology-Intelligence-1B (OE-13): bullpenFragilityContext
  // — soft additive boost (~+0.02 cap) for hitter overs when canonical bullpen
  // signals (or runEnv + teamTotal proxies, anti-fabrication when bullpen
  // dormant) indicate late-game offensive survivability. NO new fetches.
  const oeBullpenBoost = bullpenFragilityContext(c)
  const oeAdditive = oeHrBoost + oeRunBoost + oeBullpenBoost
  f.hrCarry = oeHrBoost
  f.runProd = oeRunBoost
  f.bullpen = oeBullpenBoost

  const composite = clamp(0, 1, (total / weight) + tierBoost + textureBoost + oeAdditive)
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
      // Phase Bettor-Curation-Intelligence-1A (BC-7): additive anti-replacement
      // corroborator. Fires when canonical depth ∈ {top, middle} OR canonical
      // impliedTeamTotal >= 4.5. ADDITIVE — never removes any existing corrob;
      // never blocks an anchor that would have cleared on the other corrobs.
      // Anti-fabrication: returns false when BOTH canonical fields absent.
      isAntiReplacementCorroborator(x.c),
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
  // Phase Bettor-Curation-Intelligence-1A (BC-4): believable-upside soft-demote.
  // Sort-time only — never mutates x.score.composite. HR-suppressing parks and
  // desert team totals (impliedTeamTotal < 3.5) demote effective composite by
  // BC4_SOFT_DEMOTE. Anti-fabrication: when canonical signals are absent, no
  // demote (believableUpsideDemote returns 0). pickDiversified still runs on
  // the post-sort order, preserving the diversification contract.
  const demoted = filtered
    .map((x) => ({ x, effComposite: (x.score.composite ?? 0) - believableUpsideDemote(x.c) }))
    .sort((a, b) => b.effComposite - a.effComposite)
    .map((d) => d.x)
  return pickDiversified(demoted, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 99 })
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
  // Phase Bettor-Curation-Intelligence-1A (BC-4) + Phase Offensive-Ecology-
  // Intelligence-1A (OE-8): combined sort-time soft-demote. BC-4 demotes
  // HR-suppressing parks + desert team totals. OE-8 ladderSurvivabilityFactor
  // demotes ladders with low survivability (high line + low PA proxy + weak
  // run env + non-HR-carry context). Both demotes are sort-time only — never
  // mutates x.score.composite. Anti-fabrication: zero demote when canonical
  // signals absent (degrades gracefully on incomplete row context).
  const demoted = filtered
    .map((x) => ({
      x,
      effComposite: (x.score.composite ?? 0)
        - believableUpsideDemote(x.c)
        - ladderSurvivabilityDemote(x.c),
    }))
    .sort((a, b) => b.effComposite - a.effComposite)
    .map((d) => d.x)
  return pickDiversified(demoted, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 3, maxSideFraction: 0.60 })
}

function buildSmartAggression(scored, count = 4, opts = {}) {
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
  // Phase Offensive-Ecology-Intelligence-1B (OE-12): lineup-turnover sort-time
  // soft boost (+0.02 cap) for candidates in high-turnover events. Anti-fabrication:
  // 0 boost when turnoverIndex absent.
  const turnoverIdx = opts.turnoverIndex || null
  const boosted = filtered
    .map((x) => ({ x, effComposite: (x.score.composite ?? 0) + lineupTurnoverBoost(x.c, turnoverIdx) }))
    .sort((a, b) => b.effComposite - a.effComposite)
    .map((d) => d.x)
  return pickDiversified(boosted, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 2 })
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

// ── Phase Operator-Experience-1A — 8 actionable operator buckets ─────────────
//
// Each bucket has a DETERMINISTIC selection rule grounded in existing scored /
// staleRows data. No fabrication. Empty bucket → empty array. Each bucket caps
// at maxRows; pickDiversified used where multi-player diversity matters.
//
// Buckets transform raw intelligence exhaust into operator-priority surfaces:
//   bestBalanced            — balanced volatility + multi-book + healthy edge
//   bestAggressive          — aggressive volatility + real edge (post Realism-1A AGG-2/TEXT-1)
//   bestUnders              — under-side picks with edge (operator-observed unders outperform)
//   bestAltLadders          — alt-line ladders with cross-book consensus
//   bestDisagreementEdges   — soft_line staleRows sorted by |delta| (sharp value)
//   staleLineOpportunities  — soft_line staleRows sorted by best-odds (cash value)
//   trapLadders             — alt-line candidates with low bookCount or low consensusConfidence (AVOID)
//   inflatedSuperstarSpots  — stale_line staleRows (book overprices = AVOID)

/** Phase Operator-1A: BALANCED ecology operator surface — sturdy multi-book picks */
function buildBestBalanced(scored, count = 5) {
  const filtered = scored.filter((x) =>
    x.c.volatility === "balanced" &&
    (x.c.modelProb ?? 0) >= 0.50 &&
    (x.c.edge ?? 0) >= 0.04 &&
    (x.score.lineShop?.bookCount ?? 1) >= 2
  )
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 2, maxSideFraction: 0.65 })
}

/** Phase Operator-1A: AGGRESSIVE operator surface — high-edge aggressive with real signal */
function buildBestAggressive(scored, count = 5, opts = {}) {
  let filtered = scored.filter((x) =>
    x.c.volatility === "aggressive" &&
    (x.c.modelProb ?? 0) >= 0.30 &&
    (x.c.edge ?? 0) >= 0.05
  )
  // Fallback: if no strict aggressive, accept high-edge lotto-volatility as alternate
  if (filtered.length < count) {
    filtered = scored.filter((x) =>
      (x.c.volatility === "aggressive" || x.c.volatility === "lotto") &&
      (x.c.edge ?? 0) >= 0.05
    )
  }
  // Phase Bettor-Curation-Intelligence-1A (BC-4): believable-upside soft-demote
  // on aggressive surface. Same doctrine as buildBestHr / buildBestLadders.
  // Phase Offensive-Ecology-Intelligence-1B (OE-12): additive sort-time soft
  // BOOST for candidates from lineup-turnover-prone events (operator-approved
  // aggressive/lotto/explosive-upside buckets only). Cap +0.02. Anti-fabrication:
  // 0 boost when turnoverIndex absent or eventId not in index.
  const turnoverIdx = opts.turnoverIndex || null
  const demoted = filtered
    .map((x) => ({
      x,
      effComposite: (x.score.composite ?? 0)
        - believableUpsideDemote(x.c)
        + lineupTurnoverBoost(x.c, turnoverIdx),
    }))
    .sort((a, b) => b.effComposite - a.effComposite)
    .map((d) => d.x)
  return pickDiversified(demoted, count, { maxPerPlayer: 1, maxPerGame: 1, maxPerStat: 2 })
}

/** Phase Operator-1A: UNDER-side operator surface — unders materially outperform per Realism-1 audit */
function buildBestUnders(scored, count = 5) {
  const filtered = scored.filter((x) =>
    x.c.side === "under" &&
    (x.c.edge ?? 0) >= 0.04 &&
    (x.c.modelProb ?? 0) >= 0.48
  )
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 2 })
}

/** Phase Operator-1A: alt-line ladder operator surface — calibration-friendly ecology */
function buildBestAltLadders(scored, count = 5) {
  const filtered = scored.filter((x) => {
    const raw = String(x.c.propVariant || "").toLowerCase()
    const isAlt = raw.startsWith("alt") || raw === "alternate" || x.c.isAlternate === true
    if (!isAlt) return false
    return (x.c.edge ?? 0) >= 0.04 && (x.score.lineShop?.consensusConfidence ?? 1) >= 0.5
  })
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 2 })
}

/**
 * Phase Operator-1A: DISAGREEMENT-edges operator surface — soft_line staleRows sorted
 * by mathematical sharpness (|delta from consensus|). Top candidates where one book
 * underprices the bettor's side relative to peer-book consensus.
 *
 * staleRows come from buildLineShopping output (lineShopping.staleRows). Each entry
 * already has tag: "soft_line" (bettor value) | "stale_line" (book overprices).
 * Anti-fabrication: when a staleRow has no matching scored candidate, we still
 * surface it with a minimal compact-play shape derived purely from staleRow fields.
 */
function buildBestDisagreementEdges(scoredById, staleRows, count = 5, opts = {}) {
  if (!Array.isArray(staleRows) || !staleRows.length) return []
  const { shopMap = null, availabilityIndex = null } = opts
  const candidates = staleRows
    .filter((s) => s && s.tag === "soft_line" && Number.isFinite(s.delta))
    // Phase Market-Exploitation-1A (EXPL-4): availability hard-filter — drop
    // staleRows whose player is canonical OUT in the slate's availability index.
    .filter((s) => !staleRowIsHardDropAvailability(s, availabilityIndex))
    // Phase Market-Exploitation-1A (EXPL-1): consensus-support gate — keep only
    // rows backed by EXPL1_MIN_BOOK_COUNT+ books and EXPL1_MIN_CONSENSUS_CONFIDENCE+
    // cross-book agreement. Ranking semantics (|delta| sort) preserved AFTER gate.
    .filter((s) => shopMap == null || marketSupportFor(s, shopMap).supported)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return candidates.slice(0, count * 2).map((s) => staleRowToCompactPlay(s, scoredById, { marketSupported: true })).filter(Boolean).slice(0, count)
}

/**
 * Phase Operator-1A: STALE-LINE-OPPORTUNITIES surface — same soft_line population
 * as bestDisagreementEdges but ranked by absolute payout magnitude (positive odds
 * = larger dollar payoff). Operator-friendly cash-value view; complements the
 * sharpness-ordered disagreement-edges bucket.
 */
function buildStaleLineOpportunities(scoredById, staleRows, count = 5, opts = {}) {
  if (!Array.isArray(staleRows) || !staleRows.length) return []
  const { shopMap = null, availabilityIndex = null } = opts
  const candidates = staleRows
    .filter((s) => s && s.tag === "soft_line" && Number.isFinite(num(s.odds)))
    // Phase Market-Exploitation-1A (EXPL-4 + EXPL-1): same gates as
    // bestDisagreementEdges — availability hard-drop + consensus-support floor.
    .filter((s) => !staleRowIsHardDropAvailability(s, availabilityIndex))
    .filter((s) => shopMap == null || marketSupportFor(s, shopMap).supported)
    .sort((a, b) => {
      // Prefer higher positive odds (better payoff); tie-break by |delta|.
      const oa = num(a.odds) ?? 0
      const ob = num(b.odds) ?? 0
      const ranka = oa > 0 ? oa : -1000  // negative odds rank lower
      const rankb = ob > 0 ? ob : -1000
      if (ranka !== rankb) return rankb - ranka
      return Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)
    })
  return candidates.slice(0, count * 2).map((s) => staleRowToCompactPlay(s, scoredById, { marketSupported: true })).filter(Boolean).slice(0, count)
}

/**
 * Phase Operator-1A: TRAP-LADDERS surface — alt-line candidates where the book
 * universe is thin (bookCount<2) OR consensus confidence is low (<0.5) OR archetype
 * trust is poor. These are bait-shaped ladders — large-payout but structurally
 * unreliable. Operator should AVOID. Single-line "why avoid" surfaced via processNote.
 */
function buildTrapLadders(scored, count = 5) {
  const filtered = scored.filter((x) => {
    const raw = String(x.c.propVariant || "").toLowerCase()
    const isAlt = raw.startsWith("alt") || raw === "alternate" || x.c.isAlternate === true
    if (!isAlt) return false
    const bookCount = x.score.lineShop?.bookCount ?? 1
    const conf = x.score.lineShop?.consensusConfidence
    const archetypeTrust = x.score.factors?.archetype ?? 0
    // Trap-shaped: thin book coverage OR low cross-book confidence OR no historical
    // archetype trust. Plus require positive odds >= +200 to limit to genuine
    // bait-payout shapes (operator doesn't need to "avoid" low-payout normal lines).
    const isBigPayout = (num(x.c.odds) ?? 0) >= 200
    if (!isBigPayout) return false
    return bookCount < 2 || (Number.isFinite(conf) && conf < 0.5) || archetypeTrust < 0.40
  })
  // Sort by largest payout first (most enticing trap to flag)
  return filtered
    .sort((a, b) => (num(b.c.odds) ?? 0) - (num(a.c.odds) ?? 0))
    .slice(0, count)
}

/**
 * Phase Operator-1A: INFLATED-SUPERSTAR-SPOTS surface — stale_line staleRows
 * (book overprices vs consensus = AVOID). Mirrors the bestDisagreementEdges shape
 * but for the AVOID-side stale tag. Tagged in compactPlay with processNote so the
 * operator knows WHY this surface flags the prop.
 */
/**
 * Phase Bettor-Curation-Intelligence-1A (BC-5): believable-upside tickets bucket.
 *
 * Observational additive surface — never blocks or removes other buckets.
 * Returns top-N scored candidates satisfying ALL three canonical gates:
 *   depth ∈ {top, middle}            (lineup legitimacy)
 *   impliedTeamTotal >= 4.5           (offensive context credible)
 *   hrEnvironmentTag !== "HR_SUPPRESSING"  (park not hostile)
 *
 * Anti-fabrication: auto-empty when canonical signals are absent. Never
 * synthesizes membership. Sort criterion: composite (existing canonical
 * score; no new math).
 */
function buildBelievableUpsideTickets(scored, count = 5) {
  if (!Array.isArray(scored) || !scored.length) return []
  const filtered = scored.filter((x) => isBelievableUpsideCandidate(x.c))
  return pickDiversified(filtered, count, { maxPerPlayer: 1, maxPerGame: 2, maxPerStat: 3 })
}

function buildInflatedSuperstarSpots(scoredById, staleRows, count = 5, opts = {}) {
  if (!Array.isArray(staleRows) || !staleRows.length) return []
  const { shopMap = null, availabilityIndex = null } = opts
  const candidates = staleRows
    .filter((s) => s && s.tag === "stale_line" && Number.isFinite(s.delta))
    // Phase Market-Exploitation-1A (EXPL-4 + EXPL-1): symmetric gates on the
    // AVOID surface — overpriced book flagging is only meaningful when the
    // consensus is itself well-supported. Single-book "overprice" claims with
    // no peer-book corroboration are suppressed (anti-noise doctrine).
    .filter((s) => !staleRowIsHardDropAvailability(s, availabilityIndex))
    .filter((s) => shopMap == null || marketSupportFor(s, shopMap).supported)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return candidates.slice(0, count * 2).map((s) => staleRowToCompactPlay(s, scoredById, { avoidTag: true, marketSupported: true })).filter(Boolean).slice(0, count)
}

// ── Phase Recommendation-Hierarchy-1A — buildRecommendationLadder (HIER-1) ───
//
// Deterministic, fixed-cardinality decision ladder derived PURELY from the
// already-computed bucket arrays. Pure observational layer — no new scoring,
// no new ranking math, no new heuristics, no fabricated fallback picks.
//
// SLOT DOCTRINE — every slot's value is the FIRST non-duplicate play from
// one canonical bucket. When a candidate is already taken by an earlier-
// priority slot (by id), walk that bucket's array until a unique id is
// found OR exhaust the bucket → slot resolves to null.
//
// PRIORITY ORDER (per operator approval gate):
//   1. bestOverall         ← anchors[0]                      (composite winner)
//   2. safestPlay          ← safest[i]                       (lowest-variance qualifier)
//   3. bestDisagreement    ← bestDisagreementEdges[i]        (book underprices vs consensus)
//   4. bestUpsidePlay      ← bestAggressive[i] ?? bestPra[i] ?? bestHr[i] ?? bestFirstBasket[i]
//   5. bestBalancedPlay    ← bestBalanced[i]                 (multi-book + healthy edge)
//   6. mostOverpricedAvoid ← inflatedSuperstarSpots[i]       (book overprices vs consensus)
//   7. highestTrapRiskAvoid← trapLadders[i]                  (thin coverage, big payout bait)
//
// EMPTY-SLOT DOCTRINE — when a canonical bucket is empty OR every entry was
// already taken by an earlier slot, the slot returns null. The frontend
// MUST render an honest "(no qualifying X tonight)" — never a fabricated
// placeholder. Anti-fabrication is the entire point of this layer.
//
// REPLAY/GRADING SAFETY — ladder is a downstream observational derivation;
// it never mutates upstream candidates, never touches lineage/calibration/
// grading, never adds API calls, never persists state. Pure additive output.
//
// CANONICAL BUCKET AUTHORITY — slot rules cite buckets BY NAME. If a
// bucket's selection rule evolves in a future phase, the ladder follows
// automatically; we never duplicate a bucket's filtering logic here.
function buildRecommendationLadder(featured) {
  if (!featured || typeof featured !== "object") {
    return {
      bestOverall: null, safestPlay: null, bestUpsidePlay: null,
      bestBalancedPlay: null, bestDisagreement: null,
      mostOverpricedAvoid: null, highestTrapRiskAvoid: null,
      // Phase Bettor-Curation-Intelligence-1A (BC-6): additive slot 8 — null
      // in the empty-featured branch (same honest-empty doctrine as the
      // other 7 slots — never fabricated).
      bestBelievableUpside: null,
      // Phase Offensive-Ecology-Intelligence-1A (OE-7): additive slot 9 — null
      // in the empty-featured branch (same honest-empty doctrine).
      bestExplosiveUpside: null,
    }
  }

  const takenIds = new Set()
  function pickFirstUnique(...bucketArrays) {
    for (const bucket of bucketArrays) {
      if (!Array.isArray(bucket)) continue
      for (const play of bucket) {
        const id = play?.id
        if (!id) continue
        if (takenIds.has(id)) continue
        takenIds.add(id)
        return play
      }
    }
    return null
  }

  // Priority order matters — earlier slots claim ids first, later slots
  // walk past already-taken ids until a unique entry surfaces or null.
  const bestOverall         = pickFirstUnique(featured.anchors)
  const safestPlay          = pickFirstUnique(featured.safest)
  const bestDisagreement    = pickFirstUnique(featured.bestDisagreementEdges)
  const bestUpsidePlay      = pickFirstUnique(
    featured.bestAggressive,
    featured.bestPra,
    featured.bestHr,
    featured.bestFirstBasket
  )
  const bestBalancedPlay    = pickFirstUnique(featured.bestBalanced)
  // Phase Bettor-Curation-Intelligence-1A (BC-6): NEW slot 8 surfaces the top
  // candidate from BC-5's believableUpsideTickets bucket. Dedup walk preserves
  // bucket-claim semantics — when the believable bucket's top pick was already
  // claimed by an earlier slot (e.g. anchor / aggressive), the slot walks the
  // bucket until a unique id is found OR resolves to null. Anti-fabrication:
  // null when bucket is empty (canonical signals absent or no qualifier).
  const bestBelievableUpside = pickFirstUnique(featured.believableUpsideTickets)
  // Phase Offensive-Ecology-Intelligence-1A (OE-7): NEW slot 9 surfaces the top
  // candidate from OE-6's explosiveUpsideTickets bucket. Same dedup walk
  // semantics as slot 8. Anti-fabrication: null when bucket is empty (no
  // event tagged EXPLOSIVE per OE-5 gates).
  const bestExplosiveUpside  = pickFirstUnique(featured.explosiveUpsideTickets)
  const mostOverpricedAvoid = pickFirstUnique(featured.inflatedSuperstarSpots)
  const highestTrapRiskAvoid= pickFirstUnique(featured.trapLadders)

  return {
    bestOverall,
    safestPlay,
    bestUpsidePlay,
    bestBalancedPlay,
    bestDisagreement,
    // Phase Bettor-Curation-Intelligence-1A (BC-6): slot 8 between balanced and
    // the AVOID slots. Surfaces believable offensive-upside environments per
    // BC-5 gates (depth + impliedTeamTotal + non-suppressing park).
    bestBelievableUpside,
    // Phase Offensive-Ecology-Intelligence-1A (OE-7): slot 9 — surfaces top
    // hitter-over candidate from per-event EXPLOSIVE-tagged environments.
    bestExplosiveUpside,
    mostOverpricedAvoid,
    highestTrapRiskAvoid,
  }
}

/**
 * Phase Operator-1A: bridge from a staleRow entry to a compactPlay-shaped object.
 * If the staleRow has a matching scored candidate, use the full compactPlay path.
 * Otherwise synthesize a minimal compactPlay from the staleRow's own fields —
 * anti-fabrication: we ONLY copy fields the staleRow already carries; never
 * invent edge, modelProb, or composite values.
 */
function staleRowToCompactPlay(s, scoredById, { avoidTag = false, marketSupported = false } = {}) {
  if (!s) return null
  const propStr = String(s.prop || "")
  const m = propStr.match(/^(.+?)\s+(over|under)\s+([\d.]+)$/i)
  const propType = m ? m[1] : propStr
  const side     = m ? m[2].toLowerCase() : null
  const line     = m ? Number(m[3]) : null
  const player   = String(s.player || "")
  const statFamilyNorm = normFam(propType)
  // Best-effort lookup of the full scored entry (so we can return a richer compactPlay).
  const lookupKey = [player.toLowerCase().trim(), statFamilyNorm, side ?? "", line ?? "any"].join("|")
  const item = scoredById.get(lookupKey)
  // Phase Market-Exploitation-1A (EXPL-1): canonical processNote for plays
  // that survived the consensus-support gate. Deterministic phrasing; never
  // applied to ungated plays (older call sites without the flag get unchanged
  // behavior — additive only).
  const expl1Note = marketSupported
    ? (avoidTag ? "market-supported overprice" : "market-supported disagreement")
    : null
  if (item) {
    const cp = compactPlay(item, item._ctx, { includeAttackNote: false })
    // Augment with staleRow-specific markers so the frontend can render the
    // disagreement context inline. Anti-fabrication: only adds fields from staleRow.
    cp.staleRowTag = s.tag
    cp.staleRowDelta = s.delta
    cp.consensus = s.consensus
    if (avoidTag) cp.avoidReason = `book overprices vs consensus by ${(Math.abs(s.delta) * 100).toFixed(1)}¢`
    // EXPL-1: append canonical market-support note. Preserve any existing
    // processNote from the underlying scored candidate via " · " separator.
    if (expl1Note) cp.processNote = cp.processNote ? `${cp.processNote} · ${expl1Note}` : expl1Note
    return cp
  }
  // Anti-fabrication minimal shape — every field comes from s.* directly.
  return {
    id:                  `${player}|${propType}|${side ?? "?"}|${line ?? "?"}|${s.book}|stale`,
    player,
    statFamily:          propType,
    side:                side,
    line,
    odds:                s.odds,
    book:                s.book,
    bestBook:            s.book,
    bestOdds:            s.odds,
    bookCount:           undefined,
    consensusConfidence: undefined,
    marketDispersion:    undefined,
    bestImpDelta:        Number.isFinite(s.delta) ? s.delta : undefined,
    modelProb:           undefined,
    edge:                undefined,
    volatility:          undefined,
    tier:                undefined,
    consensus:           s.consensus,
    staleRowTag:         s.tag,
    staleRowDelta:       s.delta,
    ...(avoidTag ? { avoidReason: `book overprices vs consensus by ${(Math.abs(s.delta) * 100).toFixed(1)}¢` } : {}),
    reasoning:           s.tag === "soft_line"
      ? `book underprices vs consensus by ${(Math.abs(s.delta) * 100).toFixed(1)}¢`
      : `book overprices vs consensus by ${(Math.abs(s.delta) * 100).toFixed(1)}¢`,
    // Phase Market-Exploitation-1A (EXPL-1): canonical processNote when row
    // cleared the consensus-support gate. null when caller did not pass the
    // marketSupported flag (preserves backward compatibility).
    processNote:         expl1Note,
    composite:           undefined,
    factors:             undefined,
  }
}

// ── compact play serialization ────────────────────────────────────────────────

function compactPlay(item, ctx, { includeAttackNote = false } = {}) {
  const { c, score } = item
  const reason     = buildReason(c, score, ctx)
  const note       = processQualityNote(c, score, ctx)
  const attackNote = includeAttackNote ? buildAttackNote(c, score, ctx) : undefined
  // Phase Operator-Experience-1A: lift Phase Market-1A fields to every compactPlay
  // so the Dashboard / HeroPickCard / SpotlightCard / FeaturedCard can surface
  // consensusConfidence + marketDispersion + bestImpDelta inline. Pure additive —
  // existing fields untouched, additive output keys.
  const ls = score.lineShop
  return {
    id:                  c.id,
    player:              c.player,
    team:                c.team,
    eventId:             c.eventId,
    matchup:             c.matchup,
    statFamily:          c.statFamily,
    propType:            c.propType,
    side:                c.side,
    line:                c.line,
    odds:                c.odds,
    book:                c.book,
    bestBook:            ls?.bestBook || c.book,
    bestOdds:            ls?.bestOdds ?? c.odds,
    bookCount:           ls?.bookCount ?? 1,
    // Phase Operator-Experience-1A — additive market-context fields:
    consensusConfidence: Number.isFinite(ls?.consensusConfidence) ? ls.consensusConfidence : undefined,
    marketDispersion:    Number.isFinite(ls?.marketDispersion)    ? ls.marketDispersion    : undefined,
    bestImpDelta:        Number.isFinite(ls?.bestImpDelta)        ? ls.bestImpDelta        : undefined,
    modelProb:           c.modelProb,
    edge:                c.edge,
    volatility:          c.volatility,
    tier:                c.tier,
    timingState:         score.timingClass?.state,
    timingUrgency:       score.timingClass?.urgency,
    reasoning:           reason,
    processNote:         note,
    ...(attackNote != null ? { attackNote } : {}),
    composite:           score.composite,
    factors:             score.factors,
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

  // Phase Bettor-Curation-Intelligence-1A (BC-9): reset module-scoped realism
  // accounting counters per buildFeaturedPlays invocation so the end-of-run
  // operator log reflects only THIS call.
  resetBc1aStats()
  // Phase Offensive-Ecology-Intelligence-1A (OE-9): reset module-scoped
  // offensive-ecology counters per run for operator-visible accounting at
  // end of run. Mirrors BC-9 discipline.
  resetOe1aStats()
  // Phase Offensive-Ecology-Intelligence-1B (OE-9 mirror): reset OE-1B
  // counters (pair reinforcement / turnover boosts / bullpen boosts) per
  // run. Same per-run discipline.
  resetOe1bStats()

  const normalizedAll = candidates.map(normalizeCandidate).filter(Boolean)
  // Phase Market-Exploitation-1A (EXPL-4): availability hard-filter at the
  // canonical featured-play ingest choke point. Drops candidates whose
  // preserved playerStatus is in EXPL4_HARD_DROP_STATUSES (currently {"out"}).
  // Reuses pipeline/nba/nbaAvailabilityCache canonical taxonomy. MLB candidates
  // carry no playerStatus → filter is honest no-op. Anti-fabrication: never
  // invent status; never drop on unknown. The pre-filter list is also used to
  // build the staleRow-side availability index BEFORE dropping (so a staleRow
  // for an OUT player is also suppressed even if no corresponding scored
  // candidate exists after the OUT drop).
  const availabilityIndex = buildAvailabilityIndex(normalizedAll)
  const normalized = normalizedAll.filter((c) => !candidateIsHardDropAvailability(c))
  const expl4DroppedCandidates = normalizedAll.length - normalized.length
  if (expl4DroppedCandidates > 0) {
    // Operator-visible annotation when stale candidates are removed due to
    // canonical availability invalidation. Rate-limited to one log per run.
    console.warn(`[EXPL-4] dropped ${expl4DroppedCandidates} candidate(s) at featured-play ingest — canonical playerStatus="out" (anti-stale-player doctrine)`)
  }
  if (!normalized.length) {
    // Phase Recommendation-Hierarchy-1A (HIER-1): when no candidates, every
    // ladder slot is null — honest empty doctrine, never fabricated picks.
    return {
      sport, date,
      anchors: [],
      tonightsBest: [], bestHr: [], bestPra: [], bestFirstBasket: [], bestLadders: [], smartAggression: [],
      safest: [], bestClv: [], marketAgreement: [], timingWindows: [], bestBooks: [],
      // Phase Operator-Experience-1A — 8 new operator buckets (empty when no candidates).
      bestBalanced: [], bestAggressive: [], bestUnders: [], bestAltLadders: [],
      bestDisagreementEdges: [], staleLineOpportunities: [], trapLadders: [], inflatedSuperstarSpots: [],
      // Phase Bettor-Curation-Intelligence-1A (BC-5): NEW believable-upside bucket — empty when no candidates.
      believableUpsideTickets: [],
      // Phase Offensive-Ecology-Intelligence-1A (OE-6): NEW explosive-upside bucket — empty when no candidates.
      explosiveUpsideTickets: [],
      // Phase Recommendation-Hierarchy-1A — deterministic decision ladder (all-null when no candidates).
      // Phase Bettor-Curation-Intelligence-1A (BC-6): NEW bestBelievableUpside slot — null when no candidates.
      // Phase Offensive-Ecology-Intelligence-1A (OE-7): NEW bestExplosiveUpside slot — null when no candidates.
      recommendationLadder: {
        bestOverall: null, safestPlay: null, bestUpsidePlay: null,
        bestBalancedPlay: null, bestDisagreement: null,
        mostOverpricedAvoid: null, highestTrapRiskAvoid: null,
        bestBelievableUpside: null,
        bestExplosiveUpside: null,
      },
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

  const scored = normalized.map((c) => ({ c, score: scoreCandidate(c, ctx), _ctx: ctx }))

  // Phase Operator-Experience-1A: pre-build a lookup map so staleRow-derived
  // buckets (bestDisagreementEdges, staleLineOpportunities, inflatedSuperstarSpots)
  // can match back to the full scored entry rather than synthesizing a thin
  // compactPlay. Key shape matches lookupShop's keying convention.
  const scoredById = new Map()
  for (const it of scored) {
    const k = [
      String(it.c.player || "").toLowerCase().trim(),
      normFam(it.c.statFamily),
      String(it.c.side || "").toLowerCase(),
      String(it.c.line ?? "any"),
    ].join("|")
    scoredById.set(k, it)
  }

  // Two-tier hierarchy: anchors (3–5 highest-trust plays, must clear corroboration
  // gate) + supports (tonightsBest below the anchors). The tonightsBest pool
  // explicitly excludes anchor IDs so the dashboard reads as anchors → supports
  // rather than a flat wall of equally-weighted plays.
  const anchorsItems = buildAnchors(scored)
  const anchorIds    = new Set(anchorsItems.map((x) => x.c.id))
  const anchors      = anchorsItems.map((x) => compactPlay(x, ctx, { includeAttackNote: true }))

  // Phase Offensive-Ecology-Intelligence-1A (OE-5) + 1B (OE-12): build per-event
  // indices EARLY (before any aggressive/lotto/explosive bucket builders) so
  // they can be threaded into the bucket calls below. Pure deterministic; both
  // auto-empty when canonical signals absent. The indices feed OE-6 explosive
  // bucket, OE-7 ladder slot 9, OE-12 sort-time boosts in aggressive/lotto/
  // explosive surfaces. Build once per buildFeaturedPlays run.
  const explosiveIndex = buildExplosiveEnvironmentIndex(normalized)
  const turnoverIndex  = buildLineupTurnoverIndex(normalized, explosiveIndex)
  for (const [_eid, tScore] of turnoverIndex) {
    if (tScore > 0.65) _oe1bStats.lineupTurnoverEventsHigh++
  }

  const tonightsBest    = buildTonightsBest(scored, 5, anchorIds).map((x) => compactPlay(x, ctx))
  const bestHr          = buildBestHr(scored).map((x) => compactPlay(x, ctx))
  const bestPra         = buildBestPra(scored).map((x) => compactPlay(x, ctx))
  const bestFirstBasket = buildBestFirstBasket(scored).map((x) => compactPlay(x, ctx))
  const bestLadders     = buildBestLadders(scored).map((x) => compactPlay(x, ctx))
  // Phase OE-12: smartAggression now consumes turnoverIndex (built above) for
  // sort-time soft boost on lotto-tier candidates from high-turnover events.
  const smartAggression = buildSmartAggression(scored, 4, { turnoverIndex }).map((x) => compactPlay(x, ctx))
  const safest          = buildSafest(scored).map((x) => compactPlay(x, ctx))
  const bestClv         = buildBestClv(scored).map((x) => compactPlay(x, ctx))
  const marketAgreement = buildMarketAgreement(scored).map((x) => compactPlay(x, ctx))
  const timingWindows   = buildTimingWindows(scored).map((x) => compactPlay(x, ctx))

  // Phase Operator-Experience-1A: 8 new actionable operator buckets.
  // Each derived deterministically from existing scored + staleRows data.
  // No fabrication; empty buckets return []. Existing buckets above unchanged.
  const staleRowsSourceRaw = Array.isArray(lineShopping?.staleRows) ? lineShopping.staleRows : []
  // Phase Market-Exploitation-1A (EXPL-4): pre-filter staleRows by the
  // availability index BEFORE the bucket builders see them, so the operator
  // sees a single deterministic "dropped" count rather than per-bucket
  // accounting. Bucket-level filters remain as defense-in-depth (idempotent).
  const staleRowsSource = staleRowsSourceRaw.filter((s) => !staleRowIsHardDropAvailability(s, availabilityIndex))
  const expl4DroppedStaleRows = staleRowsSourceRaw.length - staleRowsSource.length
  if (expl4DroppedStaleRows > 0) {
    console.warn(`[EXPL-4] dropped ${expl4DroppedStaleRows} staleRow(s) — canonical playerStatus="out" (stale availability invalidation)`)
  }
  // Phase Market-Exploitation-1A (EXPL-1): consensus-support gate counters.
  // Pre-compute eligible vs ineligible counts for operator visibility before
  // bucket builders apply the gate. Helps the operator quantify how much
  // single-book noise was suppressed in tonight's surface.
  const softCandidates  = staleRowsSource.filter((s) => s && s.tag === "soft_line"  && Number.isFinite(s.delta))
  const staleCandidates = staleRowsSource.filter((s) => s && s.tag === "stale_line" && Number.isFinite(s.delta))
  const softSupported   = softCandidates.filter((s)  => marketSupportFor(s, shopMap).supported)
  const staleSupported  = staleCandidates.filter((s) => marketSupportFor(s, shopMap).supported)
  const expl1SoftSuppressed  = softCandidates.length  - softSupported.length
  const expl1StaleSuppressed = staleCandidates.length - staleSupported.length
  if (expl1SoftSuppressed + expl1StaleSuppressed > 0) {
    console.warn(`[EXPL-1] suppressed ${expl1SoftSuppressed} soft + ${expl1StaleSuppressed} stale candidates lacking market-support floor (bookCount>=${EXPL1_MIN_BOOK_COUNT} & consensusConfidence>=${EXPL1_MIN_CONSENSUS_CONFIDENCE})`)
  }
  const bestBalanced            = buildBestBalanced(scored).map((x) => compactPlay(x, ctx))
  // Phase OE-12: pass turnoverIndex into the aggressive surface so
  // high-turnover candidates earn a small additive sort-time boost.
  const bestAggressive          = buildBestAggressive(scored, 5, { turnoverIndex }).map((x) => compactPlay(x, ctx))
  const bestUnders              = buildBestUnders(scored).map((x) => compactPlay(x, ctx))
  const bestAltLadders          = buildBestAltLadders(scored).map((x) => compactPlay(x, ctx))
  const bestDisagreementEdges   = buildBestDisagreementEdges(scoredById, staleRowsSource, 5, { shopMap, availabilityIndex })
  const staleLineOpportunities  = buildStaleLineOpportunities(scoredById, staleRowsSource, 5, { shopMap, availabilityIndex })
  const trapLadders             = buildTrapLadders(scored).map((x) => compactPlay(x, ctx))
  const inflatedSuperstarSpots  = buildInflatedSuperstarSpots(scoredById, staleRowsSource, 5, { shopMap, availabilityIndex })
  // Phase Bettor-Curation-Intelligence-1A (BC-5): believable-upside tickets —
  // pure observational additive bucket. Auto-empty when canonical signals
  // (depth / impliedTeamTotal / hrEnvironmentTag) are absent on candidates.
  const believableUpsideTickets = buildBelievableUpsideTickets(scored).map((x) => compactPlay(x, ctx))

  // Phase Offensive-Ecology-Intelligence-1A (OE-5 + OE-6) + 1B (OE-12):
  // explosiveIndex + turnoverIndex are now built earlier (right after anchors)
  // so smartAggression / bestAggressive / explosive-upside all consume them.
  // Build explosive-upside bucket NOW with both indices threaded.
  const explosiveUpsideTickets = buildExplosiveUpsideTickets(scored, explosiveIndex, OE6_EXPLOSIVE_MAX_TICKETS, { turnoverIndex }).map((x) => compactPlay(x, ctx))

  const bestBooks       = buildBestBooksTonight(scored).map((b) => ({
    book: b.book, plays: b.plays, avgScore: b.avgScore,
    topPlay: b.topPlay ? compactPlay(b.topPlay, ctx) : null,
  }))

  // Count of UNIQUE plays surfaced (not bucket sum, which over-counts due to
  // the same play appearing in multiple lenses).
  // Phase Operator-Experience-1A: include 8 new buckets in unique-id rollup.
  const uniqueIds = new Set()
  for (const list of [anchors, tonightsBest, bestHr, bestPra, bestFirstBasket, bestLadders, smartAggression,
                      safest, bestClv, marketAgreement, timingWindows,
                      bestBalanced, bestAggressive, bestUnders, bestAltLadders, trapLadders,
                      bestDisagreementEdges, staleLineOpportunities, inflatedSuperstarSpots]) {
    for (const p of list) if (p?.id) uniqueIds.add(p.id)
  }

  // Phase Recommendation-Hierarchy-1A (HIER-1): deterministic decision ladder.
  // Pure derivation from already-computed buckets above — no new scoring,
  // no new heuristics, no fabricated fallback picks. See buildRecommendationLadder
  // for slot-priority + dedup doctrine. Empty slots resolve to null.
  // Phase Bettor-Curation-Intelligence-1A (BC-6): BC-5's believableUpsideTickets
  // bucket is threaded into the ladder so slot 8 (bestBelievableUpside) can
  // surface the top believable offensive-upside environment.
  // Phase Offensive-Ecology-Intelligence-1A (OE-7): OE-6's explosiveUpsideTickets
  // bucket is threaded so slot 9 (bestExplosiveUpside) surfaces the top hitter-
  // over candidate from any EXPLOSIVE-tagged event.
  const recommendationLadder = buildRecommendationLadder({
    anchors,
    safest,
    bestDisagreementEdges,
    bestAggressive,
    bestPra,
    bestHr,
    bestFirstBasket,
    bestBalanced,
    believableUpsideTickets,
    explosiveUpsideTickets,
    inflatedSuperstarSpots,
    trapLadders,
  })

  // Phase Bettor-Curation-Intelligence-1A (BC-9): operator-visible realism
  // accounting log. Rate-limited (one emission per buildFeaturedPlays run);
  // emitted only when BC-4 demoted at least one candidate. Anti-fabrication:
  // counts reflect REAL canonical-signal-driven demotes via _bc9Stats —
  // never synthesized. BC-3 (back-of-order disagreement edges) is deferred
  // to 1B per operator approval; its counter is intentionally omitted here
  // rather than surfaced as a misleading "0".
  const bc1aStats = getBc1aStats()
  if (bc1aStats.suppressedHrSuppressing + bc1aStats.suppressedDesertTeamTotal > 0) {
    console.warn(
      `[BC-1A] realism gate: soft-demoted ${bc1aStats.suppressedHrSuppressing} HR-suppressing-park + ${bc1aStats.suppressedDesertTeamTotal} desert-team-total candidate(s) inside HR/ladder/aggressive buckets`,
    )
  }

  // Phase Offensive-Ecology-Intelligence-1A (OE-9): operator-visible offensive-
  // ecology accounting log. Rate-limited (one emission per buildFeaturedPlays
  // run); emitted only when ANY OE-1A counter fired. Anti-fabrication: counts
  // reflect REAL canonical-signal-driven activations / demotes via _oe1aStats —
  // never synthesized. Observational only; never blocks selection.
  const oe1aStats = getOe1aStats()
  const oeAnyActivity = oe1aStats.explosiveEventsTagged
    + oe1aStats.hrCarryBoostsApplied
    + oe1aStats.runProductionBoostsApplied
    + oe1aStats.pressureBoostsApplied
    + oe1aStats.survivabilityDemotesApplied
  if (oeAnyActivity > 0) {
    console.warn(
      `[OE-1A] offensive ecology: ${oe1aStats.explosiveEventsTagged} explosive event(s) tagged · ${oe1aStats.pressureBoostsApplied} pressure boost(s) · ${oe1aStats.hrCarryBoostsApplied} HR-carry boost(s) · ${oe1aStats.runProductionBoostsApplied} run-production boost(s) · ${oe1aStats.survivabilityDemotesApplied} ladder-survivability demote(s)`,
    )
  }

  // Phase Offensive-Ecology-Intelligence-1B (OE-9 mirror): operator-visible
  // OE-1B accounting log. Rate-limited (one emission per buildFeaturedPlays
  // run); emitted only when ANY OE-1B counter fires. Anti-fabrication:
  // counters reflect REAL canonical-signal-driven activations.
  const oe1bStats = getOe1bStats()
  const oe1bAnyActivity = oe1bStats.pairReinforcementBoosts
    + oe1bStats.turnoverBoostsApplied
    + oe1bStats.bullpenBoostsApplied
    + oe1bStats.lineupTurnoverEventsHigh
  if (oe1bAnyActivity > 0) {
    console.warn(
      `[OE-1B] offensive reinforcement: ${oe1bStats.lineupTurnoverEventsHigh} high-turnover event(s) · ${oe1bStats.pairReinforcementBoosts} pair-reinforcement boost(s) · ${oe1bStats.turnoverBoostsApplied} turnover-sort boost(s) · ${oe1bStats.bullpenBoostsApplied} bullpen-fragility boost(s)`,
    )
  }

  return {
    sport, date,
    anchors,
    tonightsBest, bestHr, bestPra, bestFirstBasket, bestLadders, smartAggression,
    safest, bestClv, marketAgreement, timingWindows, bestBooks,
    // Phase Operator-Experience-1A — 8 actionable operator buckets.
    bestBalanced, bestAggressive, bestUnders, bestAltLadders,
    bestDisagreementEdges, staleLineOpportunities, trapLadders, inflatedSuperstarSpots,
    // Phase Bettor-Curation-Intelligence-1A (BC-5): NEW believable-upside bucket.
    believableUpsideTickets,
    // Phase Offensive-Ecology-Intelligence-1A (OE-6): NEW explosive-upside bucket.
    explosiveUpsideTickets,
    // Phase Recommendation-Hierarchy-1A — fixed-cardinality deterministic decision ladder.
    // Phase Bettor-Curation-Intelligence-1A (BC-6): now includes slot 8 bestBelievableUpside.
    // Phase Offensive-Ecology-Intelligence-1A (OE-7): now includes slot 9 bestExplosiveUpside.
    recommendationLadder,
    // Phase Bettor-Curation-Intelligence-1A (BC-9): operator observability of
    // realism gate activity inside this run. Pure accounting; advisory only.
    bc1aStats,
    // Phase Offensive-Ecology-Intelligence-1A (OE-9): operator observability of
    // offensive-ecology activity inside this run. Pure accounting; advisory only.
    oe1aStats,
    // Phase Offensive-Ecology-Intelligence-1B (OE-9 mirror): operator observability
    // of OE-1B reinforcement activity inside this run. Pure accounting; advisory only.
    oe1bStats,
    summary: `${anchors.length} anchors · ${uniqueIds.size} curated plays across ${normalized.length} candidates`,
  }
}

module.exports = {
  buildFeaturedPlays,
  scoreCandidate,
  buildLedgerStats,
  // Phase Recommendation-Hierarchy-1A — exported for helper unit testing.
  buildRecommendationLadder,
  // Phase Market-Exploitation-1A (EXPL-1 + EXPL-4) — exported for helper unit testing.
  marketSupportFor,
  staleRowLookupKey,
  candidateIsHardDropAvailability,
  staleRowIsHardDropAvailability,
  buildAvailabilityIndex,
  EXPL1_MIN_BOOK_COUNT,
  EXPL1_MIN_CONSENSUS_CONFIDENCE,
  EXPL4_HARD_DROP_STATUSES,
  // Phase Bettor-Curation-Intelligence-1A (BC-2/4/5/7/9) — exported for unit testing.
  playerLegitimacyFactor,
  believableUpsideDemote,
  isBelievableUpsideCandidate,
  isAntiReplacementCorroborator,
  buildBelievableUpsideTickets,
  resetBc1aStats,
  getBc1aStats,
  BC2_LEGITIMACY_WEIGHT,
  BC2_NEUTRAL_LEGITIMACY,
  BC2_DEPTH_LEGITIMACY,
  BC4_SOFT_DEMOTE,
  BC4_HR_SUPPRESSING_TAG,
  BC4_DESERT_TEAM_TOTAL_FLOOR,
  BC5_BELIEVABLE_DEPTHS,
  BC5_BELIEVABLE_TEAM_TOTAL_MIN,
  BC7_ANCHOR_TEAM_TOTAL_MIN,
  // Phase Offensive-Ecology-Intelligence-1A (OE-1..OE-9) — exported for unit testing.
  offensivePressureIndex,
  hrCarryEnvironment,
  correlatedRunProduction,
  buildExplosiveEnvironmentIndex,
  buildExplosiveUpsideTickets,
  ladderSurvivabilityFactor,
  ladderSurvivabilityDemote,
  resetOe1aStats,
  getOe1aStats,
  OE2_PRESSURE_WEIGHT,
  OE2_NEUTRAL_PRESSURE,
  OE3_HR_BOOST_CAP,
  OE3_HR_FRIENDLY_TAG,
  OE3_WIND_OUT_TAGS,
  OE3_TEMP_MIN_F,
  OE4_RUN_BOOST_CAP,
  OE4_TOP_OF_ORDER_MAX_SPOT,
  OE4_ENV_THRESHOLD,
  OE5_GAME_TOTAL_MIN,
  OE5_AVG_TEAM_TOTAL_MIN,
  OE5_EXPLOSIVE_TAG,
  OE6_EXPLOSIVE_MAX_TICKETS,
  OE8_LADDER_DEMOTE_CAP,
  OE8_SURVIVABILITY_FLOOR,
  OE8_NEUTRAL_PA_PROXY,
  // Phase Offensive-Ecology-Intelligence-1B (OE-11..OE-13) — exported for unit testing.
  stackReinforcementScore,
  lineupTurnoverPotential,
  buildLineupTurnoverIndex,
  lineupTurnoverBoost,
  bullpenFragilityContext,
  resetOe1bStats,
  getOe1bStats,
  OE11_PAIR_BOOST_CAP,
  OE11_TOTAL_BOOST_CAP,
  OE11_PRESSURE_FLOOR,
  OE12_TURNOVER_BOOST_CAP,
  OE12_NEUTRAL_TURNOVER,
  OE12_TOP_MIDDLE_DEPTHS,
  OE13_BULLPEN_BOOST_CAP,
  OE13_NEUTRAL_FRAGILITY,
  OE13_FRAGILITY_THRESHOLD,
}
