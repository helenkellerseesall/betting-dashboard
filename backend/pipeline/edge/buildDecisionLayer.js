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

function buildExternalDecisionAdjustment(row = {}) {
	const availabilityStatus = String(row.availabilityStatus || "").toLowerCase()
	const starterStatus = String(row.starterStatus || "").toLowerCase()
	const contextTag = String(row.contextTag || "").toLowerCase()
	const externalEdgeLabel = String(row.externalEdgeLabel || "").toLowerCase()
	const externalEdgeScore = Number(row.externalEdgeScore)
	const externalSitFlag = row.externalSitFlag === true

	if (availabilityStatus === "out") {
		return {
			scoreAdjustment: -35,
			forceSit: true,
			sitReason: String(row.externalSitReason || "").trim() || "external-availability-out"
		}
	}

	if (externalSitFlag) {
		return {
			scoreAdjustment: -25,
			forceSit: true,
			sitReason: String(row.externalSitReason || "").trim() || "external-sit-flag"
		}
	}

	let scoreAdjustment = 0

	if (availabilityStatus === "questionable") scoreAdjustment -= 8
	else if (availabilityStatus === "doubtful") scoreAdjustment -= 12
	else if (availabilityStatus === "probable") scoreAdjustment -= 2
	else if (availabilityStatus === "active" || availabilityStatus === "available") scoreAdjustment += 1

	if (starterStatus === "starter") scoreAdjustment += 4
	else if (starterStatus === "bench") scoreAdjustment -= 4

	if (contextTag.includes("uncertain") || contextTag.includes("minutes-watch") || contextTag.includes("bench-role")) scoreAdjustment -= 3
	else if (contextTag.includes("starter-confirmed")) scoreAdjustment += 2
	else if (contextTag.includes("likely-available")) scoreAdjustment += 1

	if (Number.isFinite(externalEdgeScore)) {
		scoreAdjustment += clamp(externalEdgeScore * 0.12, -6, 6)
	}

	if (externalEdgeLabel.includes("downgrade-strong")) scoreAdjustment -= 6
	else if (externalEdgeLabel.includes("downgrade")) scoreAdjustment -= 3
	else if (externalEdgeLabel.includes("upgrade")) scoreAdjustment += 3

	return {
		scoreAdjustment,
		forceSit: false,
		sitReason: null
	}
}

function buildSitReason(row, contextEdge, marketEdge, riskEdge, finalDecisionScore) {
	const playDecision = String(row.playDecision || "").toLowerCase()
	if (playDecision.includes("avoid") || playDecision.includes("fade") || playDecision.includes("sit")) {
		return "play-decision-blocked"
	}

	const availabilityStatus = String(row.availabilityStatus || "").toLowerCase()
	if (availabilityStatus === "out") {
		return String(row.externalSitReason || "").trim() || "external-availability-out"
	}

	if (row.externalSitFlag === true) {
		return String(row.externalSitReason || "").trim() || "external-sit-flag"
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
	const externalInfluence = buildExternalDecisionAdjustment(row)

	const baseDecisionScore = Number((
		(0.46 * contextEdge.contextEdgeScore) +
		(0.24 * marketEdge.marketEdgeScore) +
		(0.30 * riskEdge.riskEdgeScore)
	).toFixed(1))
	const finalDecisionScore = Number((baseDecisionScore + Number(externalInfluence.scoreAdjustment || 0)).toFixed(1))

	let finalDecisionLabel = toDecisionLabel(finalDecisionScore)
	const sitReason = buildSitReason(row, contextEdge, marketEdge, riskEdge, finalDecisionScore)
	if (sitReason || externalInfluence.forceSit) finalDecisionLabel = "sit"

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
