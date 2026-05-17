"use strict"

/**
 * Phase Visual-Betting-Intelligence-1A — buildSlipAnalysis.js (VBI-3 + VBI-8).
 *
 * Pure function — no I/O, no side-effects, no network, no SQLite.
 *
 * Unified screenshot-slip analysis engine. Consumes a parsed_slip (canonical
 * shape from `normalizeIngestedSlip.js`) plus optional live market /
 * availability context, and returns the canonical Phase 1A verdict payload
 * (shape exported by `resolveSlipLegToPrediction.VERDICT_PAYLOAD_SHAPE`).
 *
 * Reuses EXISTING canonical authorities ONLY:
 *   - `resolveSlipLegToPrediction()` — leg → canonical predictionId + canonicalRow.
 *   - `buildMlbCorrelationEngine.pairCorrelationScore()` — canonical -1.0 / -0.5
 *      / 0 / +0.5 pair cov truth (Phase MLB-Correlation-Engine-1A bridged).
 *   - `buildMlbCorrelationEngine.isHitterCountingProp / isUnderSide` —
 *      canonical role predicates (MLB-COV-2 same-game UNDER suppression).
 *   - `buildFeaturedPlays.marketSupportFor()` — Phase Market-Exploitation-1A
 *      EXPL-1 consensus-support gate.
 *   - `buildFeaturedPlays.candidateIsHardDropAvailability()` — Phase
 *      Market-Exploitation-1A EXPL-4 OUT-status detector.
 *   - `bettorLanguage.renderVerdictPhrases / composeVerdictSummary` — VBI-4
 *      deterministic phrase library.
 *
 * Doctrine (operator gate):
 *   - NO opaque ML.
 *   - NO fabricated survivability percentages.
 *   - NO GPT narration.
 *   - NO new scoring math beyond deterministic compositions of canonical signals.
 *   - ecologicalCoherence is a deterministic clamp([0,1]) of canonical-signal
 *     counts; documented formula at line 187 below.
 *   - Anti-fabrication: when live context is missing (no shopMap / no
 *     availabilityIndex), the relevant signal profile is emitted as EMPTY
 *     and a canonical `market_context_unavailable` /
 *     `availability_context_unavailable` signal is added.
 */

const { resolveSlipLegs, UNRESOLVED_REASONS } = require("./resolveSlipLegToPrediction")
const {
  pairCorrelationScore,
  isUnderSide,
  isHitterCountingProp,
} = require("../mlb/buildMlbCorrelationEngine")
const {
  marketSupportFor,
  candidateIsHardDropAvailability,
} = require("./buildFeaturedPlays")
const {
  SIGNAL_IDS,
  renderVerdictPhrases,
  composeVerdictSummary,
} = require("./bettorLanguage")

// ── helpers ──────────────────────────────────────────────────────────────────

function clamp01(x) { return Math.max(0, Math.min(1, Number(x))) }

function legRef(legIndex, payload = {}) {
  return { legIndex, ...payload }
}

// ── canonical leg/pair signal collectors ─────────────────────────────────────

/**
 * Per-leg signals: exploitability (EXPL-1), availability (EXPL-4).
 * Pure: only emits signals derivable from canonical helpers + provided context.
 */
function collectLegSignals(resolvedLegs, ctx) {
  const signals = []
  const exploit_marketSupported   = []
  const exploit_unsupportedSolo   = []
  const avail_hardDropOut         = []

  for (const r of resolvedLegs) {
    if (!r.resolved) continue
    const row = r.canonicalRow

    // EXPL-1 — market-support gate. Only meaningful when shopMap provided.
    if (ctx.shopMap) {
      const ms = marketSupportFor(row, ctx.shopMap)
      if (ms.supported) {
        exploit_marketSupported.push(
          legRef(r.legIndex, { bookCount: ms.bookCount, consensusConfidence: ms.consensusConfidence }),
        )
        signals.push({ id: SIGNAL_IDS.MARKET_SUPPORTED_DISAGREEMENT, scope: "leg",
          payload: { legIndex: r.legIndex, bookCount: ms.bookCount, consensusConfidence: ms.consensusConfidence } })
      } else if (ms.bookCount !== null) {
        // We HAVE market context but the leg failed the consensus-support gate.
        exploit_unsupportedSolo.push(legRef(r.legIndex, {
          reason: "below_market_support_floor",
          bookCount: ms.bookCount,
          consensusConfidence: ms.consensusConfidence,
        }))
        signals.push({ id: SIGNAL_IDS.UNSUPPORTED_SOLO_BOOK_EDGE, scope: "leg",
          payload: { legIndex: r.legIndex, bookCount: ms.bookCount, consensusConfidence: ms.consensusConfidence } })
      }
    }

    // EXPL-4 — availability hard-drop. canonicalRow doesn't carry playerStatus
    // unless the caller enriched the leg with availability beforehand. When
    // present, EXPL-4 fires deterministically.
    const enriched = { ...row, playerStatus: ctx.availabilityIndex?.get(String(row.player || "").toLowerCase().trim()) }
    if (ctx.availabilityIndex && candidateIsHardDropAvailability(enriched)) {
      avail_hardDropOut.push(legRef(r.legIndex, { player: row.player }))
      signals.push({ id: SIGNAL_IDS.HARD_DROP_OUT_PLAYER, scope: "leg",
        payload: { legIndex: r.legIndex, player: row.player } })
    }
  }

  return { signals, exploit_marketSupported, exploit_unsupportedSolo, avail_hardDropOut }
}

/**
 * Per-pair signals: covariance via canonical pairCorrelationScore + MLB-COV-2
 * shared-game suppression via canonical role predicates.
 */
function collectPairSignals(resolvedLegs) {
  const signals = []
  const positiveStacks         = []
  const pitcherHitterConflicts = []
  const sharedGameSuppression  = []
  const contradictionFlags     = []

  const resolved = resolvedLegs.filter((r) => r.resolved)
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const A = resolved[i]
      const B = resolved[j]
      const rowA = A.canonicalRow
      const rowB = B.canonicalRow

      // MLB-COV-1 / MLB-COV-3 — canonical pairCorrelationScore.
      const score = pairCorrelationScore(rowA, rowB)

      // Same scope as MLB-COV-3 hard block: both OVER + opposing-team
      // pitcher-K vs hitter-counting (canonical -1.0 case).
      if (score <= -0.99 && rowA.side === "over" && rowB.side === "over") {
        pitcherHitterConflicts.push({ legA: A.legIndex, legB: B.legIndex })
        contradictionFlags.push({ legA: A.legIndex, legB: B.legIndex,
          reason: SIGNAL_IDS.MLB_PITCHER_HITTER_CONFLICT })
        signals.push({ id: SIGNAL_IDS.MLB_PITCHER_HITTER_CONFLICT, scope: "pair",
          payload: { legA: A.legIndex, legB: B.legIndex } })
      }

      // Canonical +0.5: same-team hitter-OVER stacks (positive cov preserved).
      if (score === 0.5) {
        positiveStacks.push({ legA: A.legIndex, legB: B.legIndex, score })
        signals.push({ id: SIGNAL_IDS.POSITIVE_OFFENSIVE_STACK, scope: "pair",
          payload: { legA: A.legIndex, legB: B.legIndex } })
      }

      // MLB-COV-2 — shared-game hitter-counting UNDER suppression
      // (single ecological event masquerading as multiple safety paths).
      const sameGame = rowA.eventId && rowB.eventId && rowA.eventId === rowB.eventId
      if (sameGame
        && isUnderSide(rowA) && isUnderSide(rowB)
        && isHitterCountingProp(rowA) && isHitterCountingProp(rowB)
      ) {
        sharedGameSuppression.push({ legA: A.legIndex, legB: B.legIndex })
        contradictionFlags.push({ legA: A.legIndex, legB: B.legIndex,
          reason: SIGNAL_IDS.SHARED_GAME_SUPPRESSION_EXPOSURE })
        signals.push({ id: SIGNAL_IDS.SHARED_GAME_SUPPRESSION_EXPOSURE, scope: "pair",
          payload: { legA: A.legIndex, legB: B.legIndex } })
      }
    }
  }

  return { signals, positiveStacks, pitcherHitterConflicts, sharedGameSuppression, contradictionFlags }
}

// ── strongest / weakest leg picker ──────────────────────────────────────────
//
// Deterministic by definition: prefers legs with market-supported disagreement
// (strongest) or with unsupported-solo-book / availability-out (weakest).
// Falls back to "no clear strongest/weakest" (null) when signals are absent —
// anti-fabrication: never picks a leg by chance.

function pickStrongestLeg(resolvedLegs, exploit_marketSupported, avail_hardDropOut) {
  // Strongest = leg with highest consensusConfidence among market-supported.
  if (exploit_marketSupported.length) {
    const best = exploit_marketSupported.slice().sort(
      (a, b) => (b.consensusConfidence ?? 0) - (a.consensusConfidence ?? 0),
    )[0]
    // Disqualify if strongest is also hard-drop OUT (anti-fabrication: a hard-
    // drop player cannot be the "strongest" leg).
    const isOut = avail_hardDropOut.some((l) => l.legIndex === best.legIndex)
    if (!isOut) return { legIndex: best.legIndex, reason: SIGNAL_IDS.MARKET_SUPPORTED_DISAGREEMENT }
  }
  return null
}

function pickWeakestLeg(resolvedLegs, exploit_unsupportedSolo, avail_hardDropOut, contradictionFlags) {
  // Priority: OUT player → contradicting leg → unsupported solo edge.
  if (avail_hardDropOut.length) {
    return { legIndex: avail_hardDropOut[0].legIndex, reason: SIGNAL_IDS.HARD_DROP_OUT_PLAYER }
  }
  if (contradictionFlags.length) {
    // First leg in first contradiction flag.
    const f = contradictionFlags[0]
    return { legIndex: f.legA, reason: f.reason }
  }
  if (exploit_unsupportedSolo.length) {
    return { legIndex: exploit_unsupportedSolo[0].legIndex, reason: SIGNAL_IDS.UNSUPPORTED_SOLO_BOOK_EDGE }
  }
  return null
}

// ── ecological coherence formula (deterministic, traceable) ─────────────────
//
// Starting score: 1.0 (perfect coherence).
// Subtract per contradiction flag: -0.50 each (MLB-COV-2 + MLB-COV-3 cases).
// Subtract per unresolved leg: -0.10 each (uncertainty penalty).
// Subtract per unsupported-solo-book leg: -0.05 each.
// Subtract per hard-drop-OUT leg: -0.25 each.
// Add per positive offensive stack pair: +0.05 each (small bonus, capped at 1.0).
// Clamp [0, 1]. Pure function of canonical-signal counts.

function computeEcologicalCoherence({
  contradictionFlags, unresolvedLegs, exploit_unsupportedSolo, avail_hardDropOut, positiveStacks,
}) {
  let score = 1.0
  score -= 0.50 * (contradictionFlags?.length ?? 0)
  score -= 0.10 * (unresolvedLegs?.length ?? 0)
  score -= 0.05 * (exploit_unsupportedSolo?.length ?? 0)
  score -= 0.25 * (avail_hardDropOut?.length ?? 0)
  score += 0.05 * (positiveStacks?.length ?? 0)
  return clamp01(score)
}

// ── main entry point ────────────────────────────────────────────────────────

/**
 * Analyze a parsed_slip into the canonical Phase 1A verdict payload.
 *
 * @param {object} parsedSlip      — canonical parsed_slip from `normalizeIngestedSlip`.
 *                                    Expected fields: `legs_json` (string) OR `_legs` (array).
 * @param {object} opts
 * @param {string} opts.sport       — "mlb" | "nba" (required for canonical resolver).
 * @param {string} opts.slateDate   — YYYY-MM-DD (required for canonical resolver).
 * @param {Map} [opts.shopMap]      — optional live shopMap (from buildLineShopping).
 *                                    When absent, exploitability profile is empty +
 *                                    a `market_context_unavailable` signal is added.
 * @param {Map} [opts.availabilityIndex] — optional canonical availability index
 *                                    (Phase Market-Exploitation-1A).
 *                                    When absent, availability profile is empty +
 *                                    an `availability_context_unavailable` signal is added.
 *
 * @returns {object} — canonical Phase 1A verdict payload (see
 *                     resolveSlipLegToPrediction.VERDICT_PAYLOAD_SHAPE).
 */
function analyzeSlip(parsedSlip, opts = {}) {
  const sport     = opts.sport
  const slateDate = opts.slateDate
  const shopMap           = opts.shopMap           || null
  const availabilityIndex = opts.availabilityIndex || null

  // Extract legs. Tolerate both `_legs` (in-memory from normalizeIngestedSlip)
  // and `legs_json` (DB-shaped JSON string) and direct `legs` (array).
  let legs = []
  if (Array.isArray(parsedSlip?._legs)) legs = parsedSlip._legs
  else if (Array.isArray(parsedSlip?.legs)) legs = parsedSlip.legs
  else if (typeof parsedSlip?.legs_json === "string") {
    try { legs = JSON.parse(parsedSlip.legs_json) || [] } catch { legs = [] }
  }

  // Resolve every leg deterministically. Unresolved → explicit annotation.
  const resolvedLegs   = resolveSlipLegs(legs, { sport, slateDate })
  const unresolvedLegs = resolvedLegs
    .filter((r) => !r.resolved)
    .map((r) => ({ legIndex: r.legIndex, unresolvedReason: r.unresolvedReason }))

  // Per-leg signals (exploitability + availability).
  const ctx = { shopMap, availabilityIndex }
  const leg = collectLegSignals(resolvedLegs, ctx)

  // Per-pair signals (covariance + same-game suppression).
  const pair = collectPairSignals(resolvedLegs)

  // Compose per-slip signals.
  const slipSignals = []
  for (const u of unresolvedLegs) {
    slipSignals.push({ id: SIGNAL_IDS.UNRESOLVED_LEG, scope: "leg",
      payload: { legIndex: u.legIndex, unresolvedReason: u.unresolvedReason } })
  }
  if (!shopMap) {
    slipSignals.push({ id: SIGNAL_IDS.MARKET_CONTEXT_UNAVAILABLE, scope: "slip", payload: {} })
  }
  if (!availabilityIndex) {
    slipSignals.push({ id: SIGNAL_IDS.AVAILABILITY_CONTEXT_UNAVAILABLE, scope: "slip", payload: {} })
  }

  // Aggregate composite per-slip signals (derived purely from per-pair counts).
  if (pair.sharedGameSuppression.length > 0) {
    slipSignals.push({ id: SIGNAL_IDS.FAKE_SAFE_SAME_GAME_EXPOSURE, scope: "slip",
      payload: { pairs: pair.sharedGameSuppression.length } })
  }
  if (pair.contradictionFlags.length > 0) {
    slipSignals.push({ id: SIGNAL_IDS.STRUCTURAL_CONTRADICTION, scope: "slip",
      payload: { count: pair.contradictionFlags.length } })
  }
  if (pair.positiveStacks.length >= 2) {
    slipSignals.push({ id: SIGNAL_IDS.COHERENT_OFFENSIVE_STACK, scope: "slip",
      payload: { pairs: pair.positiveStacks.length } })
  }
  if (resolvedLegs.length > 0 && resolvedLegs.every((r) => !r.resolved)) {
    slipSignals.push({ id: SIGNAL_IDS.NO_REPO_INTELLIGENCE_AVAILABLE, scope: "slip", payload: {} })
  }

  const signals = [...leg.signals, ...pair.signals, ...slipSignals]

  const strongestLeg = pickStrongestLeg(resolvedLegs, leg.exploit_marketSupported, leg.avail_hardDropOut)
  const weakestLeg   = pickWeakestLeg(
    resolvedLegs, leg.exploit_unsupportedSolo, leg.avail_hardDropOut, pair.contradictionFlags,
  )

  const ecologicalCoherence = computeEcologicalCoherence({
    contradictionFlags: pair.contradictionFlags,
    unresolvedLegs,
    exploit_unsupportedSolo: leg.exploit_unsupportedSolo,
    avail_hardDropOut: leg.avail_hardDropOut,
    positiveStacks: pair.positiveStacks,
  })

  const fakeSafeRisk = {
    detected: pair.sharedGameSuppression.length > 0,
    reasons:  pair.sharedGameSuppression.length > 0
      ? [SIGNAL_IDS.SHARED_GAME_SUPPRESSION_EXPOSURE]
      : [],
  }

  // Bettor-language rendering (deterministic from canonical signals).
  const bettorLanguageSummary = renderVerdictPhrases(signals, { dedupe: true })
  const verdictSummary        = composeVerdictSummary(signals) ?? "No canonical signal fired."

  return {
    verdictSummary,
    strongestLeg,
    weakestLeg,
    contradictionFlags: pair.contradictionFlags,
    ecologicalCoherence,
    covarianceProfile: {
      positiveStacks:         pair.positiveStacks,
      pitcherHitterConflicts: pair.pitcherHitterConflicts,
      sharedGameSuppression:  pair.sharedGameSuppression,
    },
    exploitabilityProfile: {
      marketSupported:     leg.exploit_marketSupported,
      unsupportedSoloEdge: leg.exploit_unsupportedSolo,
    },
    availabilityProfile: {
      hardDropOut: leg.avail_hardDropOut,
    },
    fakeSafeRisk,
    unresolvedLegs,
    signals,
    bettorLanguageSummary,
  }
}

module.exports = {
  analyzeSlip,
  // Exposed for unit testing of internal pure helpers.
  computeEcologicalCoherence,
  pickStrongestLeg,
  pickWeakestLeg,
}
