function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value))
}

function normalizeMustPlayContextScore(value) {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return 0
	if (numeric <= 1) return clamp(numeric, 0, 1)
	if (numeric <= 100) return clamp(numeric / 100, 0, 1)
	return 0
}

function decisionSignalScore(playDecision) {
	const normalized = String(playDecision || "").toLowerCase()
	if (!normalized) return 0
	if (normalized.includes("must-play")) return 1
	if (normalized.includes("strong")) return 0.8
	if (normalized.includes("playable")) return 0.55
	if (normalized.includes("viable")) return 0.45
	if (normalized.includes("special-only")) return 0.35
	if (normalized.includes("sit") || normalized.includes("avoid") || normalized.includes("fade")) return -0.4
	return 0.2
}

function tierSignalScore(confidenceTier) {
	const normalized = String(confidenceTier || "").toLowerCase()
	if (!normalized) return 0
	if (normalized.includes("elite")) return 0.9
	if (normalized.includes("strong")) return 0.7
	if (normalized.includes("playable")) return 0.45
	if (normalized.includes("thin")) return -0.35
	return 0.15
}

function reasonSignalScore(reasonTag) {
	const normalized = String(reasonTag || "").toLowerCase()
	if (!normalized) return 0
	if (normalized.includes("market-confirmed")) return 0.35
	if (normalized.includes("stable-market")) return 0.15
	if (normalized.includes("market-drifting")) return -0.25
	return 0.05
}

function contextTagSignalScore(contextTag) {
	const normalized = String(contextTag || "").toLowerCase()
	if (!normalized) return 0
	if (normalized.includes("context-strong")) return 0.45
	if (normalized.includes("context-viable")) return 0.2
	if (normalized.includes("context-thin")) return -0.3
	return 0.05
}

function laneSignalScore(sourceLane) {
	const normalized = String(sourceLane || "").toLowerCase()
	if (!normalized) return 0
	if (normalized === "mustplaycandidates") return 0.25
	if (normalized === "bestsingles" || normalized === "bestladders") return 0.1
	if (normalized === "bestspecials") return 0.04
	return 0
}

function variantRiskAdjustment(propVariant) {
	const normalized = String(propVariant || "base").toLowerCase()
	if (normalized === "base" || normalized === "default") return 0
	if (normalized.includes("alt-max") || normalized.includes("alt-high")) return -0.22
	if (normalized.includes("alt-mid")) return -0.15
	if (normalized.includes("alt-low")) return -0.08
	return -0.05
}

function volatilityAdjustment(volatilityFlag) {
	const normalized = String(volatilityFlag || "").toLowerCase()
	if (!normalized) return 0
	if (normalized === "high") return -0.25
	if (normalized === "medium") return -0.12
	return 0.04
}

function summarySignalScore(decisionSummary) {
	const summary = String(decisionSummary || "").trim()
	if (!summary) return 0
	if (summary.length >= 24) return 0.1
	return 0.05
}

function scoreContextEdge(row = {}) {
	const normalizedContextScore = normalizeMustPlayContextScore(row.mustPlayContextScore)

	const signals = {
		decisionSignal: decisionSignalScore(row.playDecision),
		tierSignal: tierSignalScore(row.confidenceTier),
		reasonSignal: reasonSignalScore(row.mustPlayReasonTag),
		contextTagSignal: contextTagSignalScore(row.mustPlayContextTag),
		mustPlayContextSignal: normalizedContextScore,
		laneSignal: laneSignalScore(row.sourceLane),
		variantAdjustment: variantRiskAdjustment(row.propVariant),
		volatilityAdjustment: volatilityAdjustment(row.volatilityFlag),
		summarySignal: summarySignalScore(row.decisionSummary)
	}

	const composite01 = clamp(
		(0.27 * signals.decisionSignal) +
		(0.17 * signals.tierSignal) +
		(0.08 * signals.reasonSignal) +
		(0.14 * signals.contextTagSignal) +
		(0.18 * signals.mustPlayContextSignal) +
		(0.06 * signals.laneSignal) +
		(0.05 * signals.summarySignal) +
		(0.03 * signals.variantAdjustment) +
		(0.02 * signals.volatilityAdjustment) +
		0.35,
		0,
		1
	)

	const contextEdgeScore = Number((composite01 * 100).toFixed(1))

	let contextSummary = "neutral-support"
	if (contextEdgeScore >= 78) contextSummary = "strong-support"
	else if (contextEdgeScore >= 62) contextSummary = "viable-support"
	else if (contextEdgeScore < 45) contextSummary = "thin-support"

	return {
		contextEdgeScore,
		contextSignals: {
			...signals,
			normalizedMustPlayContextScore: normalizedContextScore
		},
		contextSummary
	}
}

module.exports = {
	scoreContextEdge
}
