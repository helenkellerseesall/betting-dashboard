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

function normalizeEdge01(value) {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return 0
	// Typical edge values are often around +/- 10 to 20 in this pipeline.
	return clamp((numeric + 20) / 40, 0, 1)
}

function movementSignalScore(marketMovementTag) {
	const movement = String(marketMovementTag || "").toLowerCase()
	if (!movement) return 0
	if (movement.includes("confirm") || movement.includes("steam") || movement.includes("back")) return 0.95
	if (movement.includes("stable")) return 0.55
	if (movement.includes("drift") || movement.includes("against")) return 0.15
	return 0.4
}

function bookValueSignalScore(bookValueHint) {
	const hint = String(bookValueHint || "").toLowerCase()
	if (!hint) return 0
	if (hint === "value-live") return 1
	if (hint === "value-lean") return 0.72
	if (hint === "fair-price") return 0.48
	if (hint === "price-expensive") return 0.1
	return 0.4
}

function oddsSignalScore(odds) {
	const value = Number(odds)
	if (!Number.isFinite(value)) return 0

	// Favor playable price ranges; lightly penalize extreme tails.
	if (value >= 130 && value <= 1100) return 0.75
	if (value > 0 && value < 130) return 0.52
	if (value > 1100 && value <= 1800) return 0.45
	if (value > 1800) return 0.3
	return 0.5
}

function variantSignalAdjustment(propVariant) {
	const variant = String(propVariant || "base").toLowerCase()
	if (variant === "base" || variant === "default") return 0
	if (variant.includes("alt-low")) return -0.02
	if (variant.includes("alt-mid")) return -0.08
	if (variant.includes("alt-high")) return -0.14
	if (variant.includes("alt-max")) return -0.2
	return -0.04
}

function laneSignalScore(sourceLane) {
	const lane = String(sourceLane || "").toLowerCase()
	if (!lane) return 0
	if (lane === "mustplaycandidates") return 0.12
	if (lane === "bestsingles" || lane === "bestladders") return 0.05
	if (lane === "bestspecials") return 0.02
	return 0
}

function scoreMarketEdge(row = {}) {
	const hitRate01 = normalizeHitRate01(row.hitRatePct)
	const edge01 = normalizeEdge01(row.edge)

	const signals = {
		movementSignal: movementSignalScore(row.marketMovementTag),
		bookValueSignal: bookValueSignalScore(row.bookValueHint),
		oddsSignal: oddsSignalScore(row.odds),
		hitRateSignal: hitRate01,
		edgeSignal: edge01,
		variantAdjustment: variantSignalAdjustment(row.propVariant),
		laneAdjustment: laneSignalScore(row.sourceLane)
	}

	const composite01 = clamp(
		(0.24 * signals.movementSignal) +
		(0.28 * signals.bookValueSignal) +
		(0.12 * signals.oddsSignal) +
		(0.16 * signals.hitRateSignal) +
		(0.16 * signals.edgeSignal) +
		(0.02 * signals.variantAdjustment) +
		(0.02 * signals.laneAdjustment),
		0,
		1
	)

	const marketEdgeScore = Number((composite01 * 100).toFixed(1))

	let marketSummary = "market-neutral"
	if (marketEdgeScore >= 76) marketSummary = "market-advantaged"
	else if (marketEdgeScore >= 60) marketSummary = "market-lean"
	else if (marketEdgeScore < 42) marketSummary = "market-adverse"

	return {
		marketEdgeScore,
		marketSignals: {
			...signals,
			normalizedHitRate: hitRate01,
			normalizedEdge: edge01
		},
		marketSummary
	}
}

module.exports = {
	scoreMarketEdge
}
