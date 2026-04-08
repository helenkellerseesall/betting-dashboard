/**
 * Surface Row Builder
 *
 * Shapes emitted rows for readable surface output (bestSingles, bestLadders,
 * bestSpecials, mostLikelyToHit, bestValue, bestUpside, specialty lanes).
 *
 * All helpers in this file are pure (no closure or runtime state).
 * The finalizeRuntimeExternalOverlay and buildReadableSurfaceRow factory are
 * also exported so server.js can use them with minimal wire-up.
 *
 * Usage in server.js:
 *   const { createSurfaceRowBuilder, finalizeRuntimeExternalOverlay } =
 *     require("./pipeline/output/buildSurfaceRow")
 *   // ...after buildOverlayExternalSignalInput is available in-closure...
 *   const buildReadableSurfaceRow = createSurfaceRowBuilder({ buildOverlayExternalSignalInput })
 */

const { buildDecisionLayer } = require("../edge/buildDecisionLayer")
const { buildExternalEdgeOverlay } = require("../edge/buildExternalEdgeOverlay")

// ---------------------------------------------------------------------------
// Pure formatting helpers
// ---------------------------------------------------------------------------

const toReadablePercent = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  if (numeric <= 1) return Math.max(1, Math.min(99, Math.round(numeric * 100)))
  return Math.max(1, Math.min(99, Math.round(numeric)))
}

const formatReadableTag = (value) => {
  const raw = String(value || "").trim()
  if (!raw) return null
  return raw
    .split(/[+_]/)
    .filter(Boolean)
    .map((part) => part.replace(/-/g, " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(", ")
}

const formatLaneLabel = (lane) => {
  const key = String(lane || "").trim()
  if (!key) return null
  const labels = {
    bestSingles: "Singles",
    bestLadders: "Ladders",
    bestSpecials: "Specials",
    mustPlayCandidates: "Must Play",
    unknown: "Surfaced"
  }
  return labels[key] || formatReadableTag(key)
}

const formatVariantLabel = (variant) => {
  const key = String(variant || "base").toLowerCase()
  if (!key || key === "base" || key === "default") return "Base line"
  return formatReadableTag(key)
}

const formatTierWord = (tier) => {
  const key = String(tier || "").toLowerCase()
  if (!key) return null
  if (key.includes("elite")) return "Elite"
  if (key.includes("strong")) return "Strong"
  if (key.includes("playable")) return "Playable"
  if (key.includes("thin")) return "Thin"
  return formatReadableTag(key)
}

// ---------------------------------------------------------------------------
// Derive helpers (synopsis building blocks)
// ---------------------------------------------------------------------------

const deriveBetTypeLabel = (row, extra = {}) => {
  const explicitBetType = String(row?.mustPlayBetType || "").toLowerCase()
  if (explicitBetType === "single") return "single"
  if (explicitBetType === "ladder") return "ladder"
  if (explicitBetType === "special") return "special"

  const lane = String(extra?.sourceLane || row?.mustPlaySourceLane || extra?.defaultLane || "").toLowerCase()
  if (lane === "bestsingles") return "single"
  if (lane === "bestladders") return "ladder"
  if (lane === "bestspecials") return "special"
  return null
}

const deriveLeadSynopsis = (row, extra = {}) => {
  const tierWord = formatTierWord(row?.confidenceTier)
  const betType = deriveBetTypeLabel(row, extra)

  if (betType === "special" && tierWord) return `Special ${tierWord.toLowerCase()}`
  if (tierWord && betType) return `${tierWord} ${betType}`
  if (tierWord) return tierWord

  const laneLabel = formatLaneLabel(extra?.sourceLane || row?.mustPlaySourceLane || extra?.defaultLane)
  return laneLabel ? laneLabel.replace(/s$/, "") : null
}

const deriveShapeSynopsis = (row) => {
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "").trim()
  const odds = Number(row?.odds ?? 0)

  if (marketKey === "player_first_basket" || /first basket/i.test(propType)) return "first basket"
  if (marketKey === "player_first_team_basket" || /first team basket/i.test(propType)) return "first team basket"
  if (/triple double/i.test(propType)) return "triple double"
  if (/double double/i.test(propType)) return "double double"

  const variantKey = String(row?.propVariant || "base").toLowerCase()
  if (variantKey && variantKey !== "base" && variantKey !== "default") return formatVariantLabel(variantKey)?.toLowerCase() || null
  if (Number.isFinite(odds) && odds >= 100) return "plus-money upside"
  return "base line"
}

const deriveContextSynopsis = (row) => {
  const contextTag = String(row?.mustPlayContextTag || "").toLowerCase()
  if (contextTag === "context-strong") return "role and spot intact"
  if (contextTag === "context-viable") return "role holding up"
  if (contextTag === "context-thin") return "thin support"

  const playDecision = String(row?.playDecision || "").trim().toLowerCase()
  if (playDecision.includes("stable")) return "role holding up"
  if (playDecision.includes("viable")) return "path is live"
  return null
}

const deriveReasonSynopsis = (row) => {
  const reasonTag = String(row?.mustPlayReasonTag || "").toLowerCase()
  if (reasonTag.includes("market-confirmed")) return "market backing"
  if (reasonTag.includes("market-drifting")) return "market fading"
  if (reasonTag.includes("stable-market")) return "price holding"

  const decisionSummary = String(row?.decisionSummary || "").trim()
  if (decisionSummary) {
    const shortSummary = decisionSummary.replace(/^[A-Z\- ]+:\s*/, "").replace(/\.$/, "").trim()
    if (shortSummary && shortSummary.length <= 56) return shortSummary
  }
  return null
}

const deriveSupportSynopsis = (row, confidenceScore) => {
  const playDecision = String(row?.playDecision || "").toLowerCase()
  const tier = String(row?.confidenceTier || "").toLowerCase()
  const hitRatePct = Number.isFinite(Number(row?.hitRatePct))
    ? Number(row.hitRatePct)
    : toReadablePercent(confidenceScore)

  if (playDecision.includes("must-play")) return "must-play signal"
  if (tier.includes("elite")) return hitRatePct >= 55 ? `elite read | ${hitRatePct}% hit rate` : "elite read"
  if (tier.includes("strong")) return hitRatePct >= 55 ? `strong read | ${hitRatePct}% hit rate` : "strong read"
  if (playDecision.includes("playable") || tier.includes("playable")) return hitRatePct >= 55 ? `playable edge | ${hitRatePct}% hit rate` : "playable edge"
  if (tier.includes("thin")) return "thin support"
  if (hitRatePct >= 60) return `${hitRatePct}% hit rate`
  return null
}

const derivePriceSynopsis = (bookValueHint, movementLabel) => {
  if (bookValueHint === "value-live") return "price still live"
  if (bookValueHint === "value-lean") return "price worth a look"
  if (bookValueHint === "price-expensive") return "price already taxed"

  const movement = String(movementLabel || "").toLowerCase()
  if (movement.includes("backing")) return "market backing"
  if (movement.includes("drifting")) return "market fading"
  if (movement.includes("stable")) return "price holding"
  return null
}

const deriveRiskSynopsis = (row, volatilityFlag) => {
  const variant = String(row?.propVariant || "base").toLowerCase()
  const variantLabel = variant !== "base" && variant !== "default"
    ? formatVariantLabel(variant)?.toLowerCase()
    : null

  if (volatilityFlag === "high") return variantLabel ? `${variantLabel} | high vol` : "high vol payout"
  if (volatilityFlag === "medium") return variantLabel ? `${variantLabel} | medium vol` : "medium vol"
  if (variantLabel) return `${variantLabel} profile`
  return "low-vol base"
}

const deriveMovementLabel = (row) => {
  const explicitTag = formatReadableTag(row?.marketMovementTag)
  if (explicitTag) return explicitTag

  const lineMove = Number.isFinite(Number(row?.lineMove)) ? Number(row?.lineMove) : null
  const oddsMove = Number.isFinite(Number(row?.oddsMove)) ? Number(row?.oddsMove) : null
  const side = String(row?.side || "").toLowerCase()

  if (lineMove !== null) {
    if ((side === "over" && lineMove < 0) || (side === "under" && lineMove > 0)) return "Market backing"
    if ((side === "over" && lineMove > 0) || (side === "under" && lineMove < 0)) return "Market drifting"
  }

  if (oddsMove !== null) {
    if (oddsMove < -3) return "Market backing"
    if (oddsMove > 10) return "Market drifting"
    return "Stable market"
  }

  return null
}

// ---------------------------------------------------------------------------
// Composite synopsis builders
// ---------------------------------------------------------------------------

const buildWhySynopsis = (row, extra = {}, insights = {}) => {
  const movementLabel = deriveMovementLabel(row)
  const parts = [
    deriveShapeSynopsis(row),
    deriveSupportSynopsis(row, insights?.confidenceScore),
    deriveReasonSynopsis(row) || derivePriceSynopsis(insights?.bookValueHint, movementLabel),
    deriveContextSynopsis(row)
  ].filter(Boolean)
    .slice(0, 3)

  return parts.length ? parts.join(" | ") : null
}

// ---------------------------------------------------------------------------
// Edge / volatility scoring helpers
// ---------------------------------------------------------------------------

const normalizeConfidence01 = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  if (numeric <= 1) return Math.min(1, numeric)
  if (numeric <= 100) return Math.min(1, numeric / 100)
  return 0
}

const buildMarketEdgeScore = (row) => {
  const reasonTag = String(row?.mustPlayReasonTag || "").toLowerCase()
  const movementLabel = String(deriveMovementLabel(row) || "").toLowerCase()
  const side = String(row?.side || "").toLowerCase()
  const lineMove = Number.isFinite(Number(row?.lineMove)) ? Number(row.lineMove) : null
  const oddsMove = Number.isFinite(Number(row?.oddsMove)) ? Number(row.oddsMove) : null

  let score = 0

  if (reasonTag.includes("market-confirmed")) score += 0.22
  else if (reasonTag.includes("stable-market")) score += 0.06
  else if (reasonTag.includes("market-drifting")) score -= 0.20

  if (movementLabel.includes("backing")) score += 0.14
  else if (movementLabel.includes("drifting")) score -= 0.12
  else if (movementLabel.includes("stable")) score += 0.03

  if (lineMove !== null) {
    const supportive = (side === "over" && lineMove < 0) || (side === "under" && lineMove > 0)
    const adverse = (side === "over" && lineMove > 0) || (side === "under" && lineMove < 0)
    if (supportive) score += 0.08
    if (adverse) score -= 0.08
  }

  if (oddsMove !== null) {
    if (oddsMove < -3) score += 0.06
    if (oddsMove > 10) score -= 0.06
  }

  return Number(Math.max(-1, Math.min(1, score)).toFixed(3))
}

const buildContextEdgeScore = (row, confidenceScore) => {
  const confidence01 = normalizeConfidence01(confidenceScore)
  const contextScore = Math.max(0, Math.min(1, Number(row?.mustPlayContextScore || 0)))
  const tier = String(row?.confidenceTier || "").toLowerCase()
  const decision = String(row?.playDecision || "").toLowerCase()

  let tierBoost = 0
  if (tier.includes("elite")) tierBoost += 0.12
  else if (tier.includes("strong")) tierBoost += 0.08
  else if (tier.includes("playable")) tierBoost += 0.03
  else if (tier.includes("thin")) tierBoost -= 0.08

  if (decision.includes("must-play")) tierBoost += 0.06
  else if (decision.includes("playable")) tierBoost += 0.03
  else if (decision.includes("fade") || decision.includes("avoid")) tierBoost -= 0.08

  const score = (confidence01 * 0.58) + (contextScore * 0.32) + tierBoost
  return Number(Math.max(0, Math.min(1, score)).toFixed(3))
}

const buildVolatilityOverlay = (row) => {
  const variant = String(row?.propVariant || "base").toLowerCase()
  const odds = Number(row?.odds ?? 0)
  const tier = String(row?.confidenceTier || "").toLowerCase()
  const marketKey = String(row?.marketKey || "").toLowerCase()
  const propType = String(row?.propType || "")

  let penalty = 0
  if (variant === "alt-low") penalty += 0.06
  else if (variant === "alt-mid") penalty += 0.12
  else if (variant === "alt-high") penalty += 0.20
  else if (variant === "alt-max") penalty += 0.28

  if (Number.isFinite(odds) && odds >= 700) penalty += 0.10
  if (Number.isFinite(odds) && odds >= 1200) penalty += 0.12
  if (tier === "special-thin" || tier.includes("thin")) penalty += 0.16

  const isTripleOrDouble = marketKey === "player_triple_double" || marketKey === "player_double_double" || propType === "Triple Double" || propType === "Double Double"
  if (isTripleOrDouble && Number.isFinite(odds) && odds >= 1000) penalty += 0.10

  const volatilityPenalty = Number(Math.max(0, Math.min(1, penalty)).toFixed(3))
  let volatilityFlag = "low"
  if (volatilityPenalty >= 0.45) volatilityFlag = "high"
  else if (volatilityPenalty >= 0.20) volatilityFlag = "medium"

  return {
    volatilityPenalty,
    volatilityFlag
  }
}

const deriveBookValueHint = (marketEdgeScore, volatilityPenalty) => {
  if (marketEdgeScore >= 0.18 && volatilityPenalty <= 0.14) return "value-live"
  if (marketEdgeScore >= 0.10) return "value-lean"
  if (marketEdgeScore <= -0.12) return "price-expensive"
  return "fair-price"
}

const buildEdgeSynopsis = (row, contextEdgeScore, marketEdgeScore, volatilityFlag, bookValueHint) => {
  const contextPart = contextEdgeScore >= 0.72 ? "setup strong" : contextEdgeScore >= 0.56 ? "setup live" : "support thin"
  const marketPart = marketEdgeScore >= 0.14 ? "market backing" : marketEdgeScore <= -0.10 ? "market fading" : derivePriceSynopsis(bookValueHint, deriveMovementLabel(row)) || "price holding"
  const volPart = deriveRiskSynopsis(row, volatilityFlag)
  return `${contextPart} | ${marketPart} | ${volPart}`
}

const buildWhyTonight = (row, extra, bookValueHint, contextEdgeScore) => {
  const lead = deriveLeadSynopsis(row, extra)
  const movement = deriveMovementLabel(row)
  const context = deriveContextSynopsis(row)
  const support = deriveSupportSynopsis(row, row?.hitRatePct ?? row?.adjustedConfidenceScore ?? row?.playerConfidenceScore)
  const priceHint = derivePriceSynopsis(bookValueHint, movement)
  const confidenceTone = contextEdgeScore >= 0.72 ? "support is strong" : contextEdgeScore >= 0.56 ? "support is live" : null

  const parts = [lead, support, priceHint || context, confidenceTone]
    .filter(Boolean)
    .slice(0, 3)

  return parts.length ? parts.join(" | ") : null
}

const toUnitScore = (value, fallback = 0) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric <= 1) return Math.max(0, Math.min(1, numeric))
  if (numeric <= 100) return Math.max(0, Math.min(1, numeric / 100))
  return fallback
}

const buildCuratedLaneDecision = (row, sourceLane, metrics = {}) => {
  const lane = String(sourceLane || "").toLowerCase()
  if (!["mostlikelytohit", "bestvalue", "bestupside"].includes(lane)) return null

  const confidence = toUnitScore(metrics.confidenceScore, 0)
  const lineup = toUnitScore(row?.lineupContextScore, 0)
  const opportunity = toUnitScore(row?.opportunitySpikeScore, 0)
  const ceiling = toUnitScore(row?.ceilingScore, confidence)
  const roleSpike = toUnitScore(row?.roleSpikeScore, 0)
  const marketLag = toUnitScore(row?.marketLagScore, 0)
  const bookDisagreement = toUnitScore(row?.bookDisagreementScore, marketLag)
  const volatilityPenalty = toUnitScore(metrics.volatilityPenalty, 0)
  const odds = Number(row?.odds ?? 0)

  if (lane === "mostlikelytohit") {
    const priceSafety = odds <= 180 && odds >= -350 ? 1 : odds <= 250 ? 0.7 : 0.45
    const stabilityScore =
      (confidence * 0.5) +
      (lineup * 0.24) +
      (opportunity * 0.1) +
      ((1 - volatilityPenalty) * 0.1) +
      (priceSafety * 0.06)

    if (stabilityScore >= 0.7) {
      return {
        playDecision: "stable-strong",
        decisionSummary: "L2-STABLE: high-confidence baseline with stable role/context support.",
        finalDecisionLabel: "strong-play",
        decisionBucket: "strong-play"
      }
    }

    if (stabilityScore >= 0.56) {
      return {
        playDecision: "stable-playable",
        decisionSummary: "L2-STABLE: conservative setup remains playable with controlled risk.",
        finalDecisionLabel: "playable",
        decisionBucket: "playable"
      }
    }

    return {
      playDecision: "stable-thin",
      decisionSummary: "L2-STABLE: support is thinner than desired for a safest-lane entry.",
      finalDecisionLabel: "sit",
      decisionBucket: "sit"
    }
  }

  if (lane === "bestvalue") {
    const contextSupport = Math.max(0, ((lineup * 0.62) + (opportunity * 0.38)) - 0.42)
    const plusMoneyWindowBonus = odds >= 100 && odds <= 260 ? 0.08 : 0
    const valueIntentScore =
      (bookDisagreement * 0.3) +
      (marketLag * 0.28) +
      (confidence * 0.24) +
      (contextSupport * 0.12) +
      plusMoneyWindowBonus

    if (valueIntentScore >= 0.63) {
      return {
        playDecision: "value-strong",
        decisionSummary: "L2-VALUE: price inefficiency and support context align for stronger value conviction.",
        finalDecisionLabel: "strong-play",
        decisionBucket: "strong-play"
      }
    }

    if (valueIntentScore >= 0.5) {
      return {
        playDecision: "value-playable",
        decisionSummary: "L2-VALUE: market/value profile is favorable with context support.",
        finalDecisionLabel: "playable",
        decisionBucket: "playable"
      }
    }

    return {
      playDecision: "value-thin",
      decisionSummary: "L2-VALUE: current price edge is not strong enough for a value-lane push.",
      finalDecisionLabel: "sit",
      decisionBucket: "sit"
    }
  }

  const upsideSignal = (ceiling * 0.34) + (opportunity * 0.27) + (roleSpike * 0.19) + (lineup * 0.08)
  const upsideIntentScore = (upsideSignal * 0.74) + (confidence * 0.2) + (toUnitScore(odds, 0) * 0.06)

  if (upsideIntentScore >= 0.63) {
    return {
      playDecision: "upside-strong",
      decisionSummary: "L2-UPSIDE: ceiling and opportunity stack support an intentional boom-style entry.",
      finalDecisionLabel: "strong-play",
      decisionBucket: "strong-play"
    }
  }

  if (upsideIntentScore >= 0.5) {
    return {
      playDecision: "upside-playable",
      decisionSummary: "L2-UPSIDE: opportunity and ceiling profile remain playable for upside exposure.",
      finalDecisionLabel: "playable",
      decisionBucket: "playable"
    }
  }

  return {
    playDecision: "upside-thin",
    decisionSummary: "L2-UPSIDE: upside signal stack is currently too thin for this lane.",
    finalDecisionLabel: "sit",
    decisionBucket: "sit"
  }
}

// ---------------------------------------------------------------------------
// External overlay finalizer (pure — no closure deps)
// ---------------------------------------------------------------------------

const finalizeRuntimeExternalOverlay = (overlay, externalSignalInput) => {
  const inputSignals = Array.isArray(externalSignalInput)
    ? externalSignalInput.filter(Boolean)
    : (externalSignalInput ? [externalSignalInput] : [])
  const hasAvailabilityEvidence = inputSignals.some((signal) => Boolean(signal?.__hasAvailabilityEvidence))
  const hasStarterEvidence = inputSignals.some((signal) => Boolean(signal?.__hasStarterEvidence))
  const safeOverlay = overlay && typeof overlay === "object" ? overlay : {}
  const safeSignalsUsed = safeOverlay?.externalSignalsUsed && typeof safeOverlay.externalSignalsUsed === "object"
    ? safeOverlay.externalSignalsUsed
    : { count: 0, sources: [] }

  return {
    ...safeOverlay,
    availabilityStatus: hasAvailabilityEvidence ? (safeOverlay?.availabilityStatus || "unknown") : "unknown",
    starterStatus: hasStarterEvidence ? (safeOverlay?.starterStatus || "unknown") : "unknown",
    externalSignalsUsed: {
      ...safeSignalsUsed,
      sources: Array.isArray(safeSignalsUsed.sources)
        ? safeSignalsUsed.sources.map((signal, index) => {
            const inputSignal = inputSignals[index] || null
            const displaySourceName = inputSignal?.__runtimeLocalSourceName || inputSignal?.sourceName || signal?.sourceName || null
            return ({
            ...signal,
            sourceName: displaySourceName,
            sourcePriority: displaySourceName === "runtime_row_signal"
              ? null
              : (signal?.sourcePriority ?? null)
          })
        })
        : []
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — injects the one closure-dependent function
// ---------------------------------------------------------------------------

/**
 * Creates a buildReadableSurfaceRow function bound to the caller's
 * buildOverlayExternalSignalInput (which depends on runtime signal maps).
 *
 * @param {{ buildOverlayExternalSignalInput: Function }} deps
 * @returns {Function} buildReadableSurfaceRow(row, extra?) => shaped row object
 */
function createSurfaceRowBuilder({ buildOverlayExternalSignalInput }) {
  return function buildReadableSurfaceRow(row, extra = {}) {
    const sourceLane = extra?.sourceLane || extra?.defaultLane || row?.sourceLane || row?.mustPlaySourceLane || null
    const decisionLayerInput = {
      ...row,
      sourceLane
    }
    const externalSignalInput = buildOverlayExternalSignalInput(row, extra)
    const decisionLayer = buildDecisionLayer(decisionLayerInput)
    const externalOverlay = finalizeRuntimeExternalOverlay(buildExternalEdgeOverlay(decisionLayerInput, externalSignalInput), externalSignalInput)
    const confidenceScore = Number(row?.adjustedConfidenceScore ?? row?.playerConfidenceScore ?? row?.score ?? 0) || null
    const ceilingScore = Number(row?.ceilingScore)
    const roleSpikeScore = Number(row?.roleSpikeScore)
    const lineupContextScore = Number(row?.lineupContextScore)
    const opportunitySpikeScore = Number(row?.opportunitySpikeScore)
    const marketLagScore = Number(row?.marketLagScore)
    const bookDisagreementScore = Number(row?.bookDisagreementScore)
    const contextEdgeScore = buildContextEdgeScore(row, confidenceScore)
    const marketEdgeScore = buildMarketEdgeScore(row)
    const { volatilityPenalty, volatilityFlag } = buildVolatilityOverlay(row)
    const bookValueHint = deriveBookValueHint(marketEdgeScore, volatilityPenalty)
    const edgeSynopsis = buildEdgeSynopsis(row, contextEdgeScore, marketEdgeScore, volatilityFlag, bookValueHint)
    const whyTonight = buildWhyTonight(row, extra, bookValueHint, contextEdgeScore)
    const curatedLaneDecision = buildCuratedLaneDecision(row, sourceLane, {
      confidenceScore,
      volatilityPenalty
    })
    const hardStopFromDecisionLayer =
      String(decisionLayer?.finalDecisionLabel || "").toLowerCase() === "sit" &&
      Boolean(String(decisionLayer?.sitReason || "").trim())
    const availabilityBlock = ["out", "doubtful"].includes(String(externalOverlay?.availabilityStatus || "").toLowerCase())
    const shouldPreserveHardStop = hardStopFromDecisionLayer || availabilityBlock
    const surfacedPlayDecision = curatedLaneDecision && !shouldPreserveHardStop
      ? curatedLaneDecision.playDecision
      : (row?.playDecision || null)
    const surfacedDecisionSummary = curatedLaneDecision && !shouldPreserveHardStop
      ? curatedLaneDecision.decisionSummary
      : (row?.decisionSummary || null)
    const surfacedFinalDecisionLabel = curatedLaneDecision && !shouldPreserveHardStop
      ? curatedLaneDecision.finalDecisionLabel
      : (decisionLayer?.finalDecisionLabel || null)
    const surfacedDecisionBucket = curatedLaneDecision && !shouldPreserveHardStop
      ? curatedLaneDecision.decisionBucket
      : (decisionLayer?.decisionBucket || null)

    return {
      eventId: row?.eventId || null,
      matchup: row?.matchup || null,
      team: row?.team || null,
      book: row?.book || null,
      player: row?.player || null,
      marketKey: row?.marketKey || null,
      propType: row?.propType || null,
      side: row?.side || null,
      line: row?.line ?? null,
      odds: Number(row?.odds ?? 0) || null,
      propVariant: row?.propVariant || "base",
      specialtyRankScore: Number.isFinite(Number(row?.specialtyRankScore)) ? Number(Number(row.specialtyRankScore).toFixed(4)) : null,
      confidenceScore,
      ceilingScore: Number.isFinite(ceilingScore) ? Number(ceilingScore.toFixed(3)) : null,
      roleSpikeScore: Number.isFinite(roleSpikeScore) ? Number(roleSpikeScore.toFixed(3)) : null,
      lineupContextScore: Number.isFinite(lineupContextScore) ? Number(lineupContextScore.toFixed(3)) : null,
      opportunitySpikeScore: Number.isFinite(opportunitySpikeScore) ? Number(opportunitySpikeScore.toFixed(3)) : null,
      marketLagScore: Number.isFinite(marketLagScore) ? Number(marketLagScore.toFixed(3)) : null,
      bookDisagreementScore: Number.isFinite(bookDisagreementScore) ? Number(bookDisagreementScore.toFixed(3)) : null,
      hitRatePct: toReadablePercent(confidenceScore),
      adjustedConfidenceScore: Number(row?.adjustedConfidenceScore ?? 0) || null,
      playerConfidenceScore: Number(row?.playerConfidenceScore ?? 0) || null,
      confidenceTier: row?.confidenceTier || null,
      playDecision: surfacedPlayDecision,
      decisionSummary: surfacedDecisionSummary,
      mustPlayBetType: row?.mustPlayBetType || null,
      mustPlaySourceLane: row?.mustPlaySourceLane || null,
      mustPlayReasonTag: row?.mustPlayReasonTag || null,
      mustPlayContextTag: row?.mustPlayContextTag || null,
      mustPlayContextScore: Number(row?.mustPlayContextScore ?? 0) || null,
      finalDecisionScore: decisionLayer?.finalDecisionScore ?? null,
      finalDecisionLabel: surfacedFinalDecisionLabel,
      decisionBucket: surfacedDecisionBucket,
      supportEdge: decisionLayer?.supportEdge || null,
      marketEdge: decisionLayer?.marketEdge || null,
      riskEdge: decisionLayer?.riskEdge || null,
      sitReason: decisionLayer?.sitReason || null,
      externalEdgeScore: externalOverlay?.externalEdgeScore ?? null,
      externalEdgeLabel: externalOverlay?.externalEdgeLabel || null,
      availabilityStatus: externalOverlay?.availabilityStatus || null,
      starterStatus: externalOverlay?.starterStatus || null,
      marketValidity: externalOverlay?.marketValidity || null,
      contextTag: externalOverlay?.contextTag || null,
      externalSignalsUsed: externalOverlay?.externalSignalsUsed || null,
      externalSitFlag: Boolean(externalOverlay?.externalSitFlag),
      externalSitReason: externalOverlay?.externalSitReason || null,
      contextEdgeScore,
      marketEdgeScore,
      volatilityPenalty,
      volatilityFlag,
      bookValueHint,
      edgeSynopsis,
      whyTonight,
      whySynopsis: buildWhySynopsis(row, extra, { confidenceScore, bookValueHint }),
      ...extra
    }
  }
}

module.exports = {
  createSurfaceRowBuilder,
  finalizeRuntimeExternalOverlay
}
