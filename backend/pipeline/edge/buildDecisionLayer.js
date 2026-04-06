const { scoreContextEdge } = require("./scoreContextEdge")
const { scoreMarketEdge } = require("./scoreMarketEdge")
const { scoreRiskEdge } = require("./scoreRiskEdge")

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value))
}

function toDecisionLabel(score) {
	if (score >= 80) return "must-play"
	if (score >= 68) return "strong-play"
	if (score >= 54) return "playable"
	if (score >= 42) return "special-only"
	return "sit"
}

function toDecisionBucket(label) {
	if (label === "must-play") return "must-play"
	if (label === "strong-play") return "strong-play"
	if (label === "playable") return "playable"
	if (label === "special-only") return "special-only"
	return "sit"
}

function buildSitReason(row, contextEdge, marketEdge, riskEdge, finalDecisionScore) {
	const playDecision = String(row.playDecision || "").toLowerCase()
	if (playDecision.includes("avoid") || playDecision.includes("fade") || playDecision.includes("sit")) {
		return "play-decision-blocked"
	}

	const isRiskFragile = riskEdge.riskSummary === "risk-fragile"
	const isMarketAdverse = marketEdge.marketSummary === "market-adverse"
	const isContextThin = contextEdge.contextSummary === "thin-support"

	if (finalDecisionScore < 38) return "overall-weak"
	if (isRiskFragile && isContextThin) return "risk-fragile-context-thin"
	if (isRiskFragile && isMarketAdverse) return "risk-fragile-market-adverse"
	if (isContextThin && isMarketAdverse && finalDecisionScore < 52) return "context-thin-market-adverse"
	return null
}

function buildDecisionLayer(row = {}) {
	const contextEdge = scoreContextEdge(row)
	const marketEdge = scoreMarketEdge(row)
	const riskEdge = scoreRiskEdge(row)

	const finalDecisionScore = Number((
		(0.46 * contextEdge.contextEdgeScore) +
		(0.24 * marketEdge.marketEdgeScore) +
		(0.30 * riskEdge.riskEdgeScore)
	).toFixed(1))

	let finalDecisionLabel = toDecisionLabel(finalDecisionScore)
	const sitReason = buildSitReason(row, contextEdge, marketEdge, riskEdge, finalDecisionScore)
	if (sitReason) finalDecisionLabel = "sit"

	return {
		finalDecisionScore: clamp(finalDecisionScore, 0, 100),
		finalDecisionLabel,
		decisionBucket: toDecisionBucket(finalDecisionLabel),
		supportEdge: contextEdge,
		marketEdge,
		riskEdge,
		sitReason
	}
}

module.exports = {
	buildDecisionLayer
}
