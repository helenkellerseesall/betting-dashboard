function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value))
}

function normalizeHitRate01(value) {
	const numeric = Number(value)
	if (!Number.isFinite(numeric) || numeric <= 0) return 0
	if (numeric <= 1) return clamp(numeric, 0, 1)
	if (numeric <= 100) return clamp(numeric / 100, 0, 1)
	return 0
}

function volatilitySignalScore(volatilityFlag) {
	const flag = String(volatilityFlag || "").toLowerCase()
	if (!flag) return 0.5
	if (flag.includes("low") || flag.includes("stable")) return 0.85
	if (flag.includes("medium") || flag.includes("normal")) return 0.58
	if (flag.includes("high") || flag.includes("extreme") || flag.includes("spike")) return 0.18
	return 0.45
}

function confidenceSignalScore(confidenceTier) {
	const tier = String(confidenceTier || "").toLowerCase()
	if (!tier) return 0.5
	if (tier.includes("high") || tier.includes("strong") || tier === "a") return 0.9
	if (tier.includes("medium") || tier.includes("moderate") || tier === "b") return 0.62
	if (tier.includes("low") || tier.includes("weak") || tier === "c") return 0.22
	return 0.48
}

function variantSafetyScore(propVariant) {
	const variant = String(propVariant || "base").toLowerCase()
	if (variant === "base" || variant === "default") return 0.88
	if (variant.includes("alt-low")) return 0.72
	if (variant.includes("alt-mid")) return 0.55
	if (variant.includes("alt-high")) return 0.33
	if (variant.includes("alt-max")) return 0.15
	return 0.5
}

function laneRiskAdjustment(sourceLane) {
	const lane = String(sourceLane || "").toLowerCase()
	if (!lane) return 0
	if (lane === "mustplaycandidates") return 0.08
	if (lane === "bestsingles") return 0.06
	if (lane === "bestladders") return -0.03
	if (lane === "bestspecials") return -0.08
	return 0
}

function playDecisionSignalScore(playDecision) {
	const decision = String(playDecision || "").toLowerCase()
	if (!decision) return 0.5
	if (decision.includes("must") || decision.includes("play")) return 0.82
	if (decision.includes("lean") || decision.includes("small")) return 0.62
	if (decision.includes("pass") || decision.includes("watch")) return 0.38
	if (decision.includes("fade") || decision.includes("avoid")) return 0.08
	return 0.48
}

function movementStabilityScore(marketMovementTag) {
	const movement = String(marketMovementTag || "").toLowerCase()
	if (!movement) return 0.5
	if (movement.includes("confirm") || movement.includes("stable")) return 0.8
	if (movement.includes("steam") || movement.includes("back")) return 0.58
	if (movement.includes("drift") || movement.includes("against")) return 0.2
	return 0.45
}

function scoreRiskEdge(row = {}) {
	const hitRate01 = normalizeHitRate01(row.hitRatePct)

	const signals = {
		volatilitySignal: volatilitySignalScore(row.volatilityFlag),
		confidenceSignal: confidenceSignalScore(row.confidenceTier),
		variantSafetySignal: variantSafetyScore(row.propVariant),
		laneAdjustment: laneRiskAdjustment(row.sourceLane),
		decisionSignal: playDecisionSignalScore(row.playDecision),
		hitRateSignal: hitRate01,
		movementStabilitySignal: movementStabilityScore(row.marketMovementTag)
	}

	const composite01 = clamp(
		(0.23 * signals.volatilitySignal) +
		(0.22 * signals.confidenceSignal) +
		(0.14 * signals.variantSafetySignal) +
		(0.12 * signals.decisionSignal) +
		(0.13 * signals.hitRateSignal) +
		(0.12 * signals.movementStabilitySignal) +
		(0.04 * signals.laneAdjustment),
		0,
		1
	)

	const riskEdgeScore = Number((composite01 * 100).toFixed(1))

	let riskSummary = "risk-balanced"
	if (riskEdgeScore >= 74) riskSummary = "risk-stable"
	else if (riskEdgeScore >= 58) riskSummary = "risk-acceptable"
	else if (riskEdgeScore < 40) riskSummary = "risk-fragile"

	return {
		riskEdgeScore,
		riskSignals: {
			...signals,
			normalizedHitRate: hitRate01
		},
		riskSummary
	}
}

module.exports = {
	scoreRiskEdge
}
