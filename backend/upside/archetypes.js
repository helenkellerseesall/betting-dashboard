function toNumber(value, fallback = 0) {
	if (typeof value === "string" && value.includes("/")) {
		const [hits, total] = value.split("/").map(Number)
		if (total) return hits / total
	}

	const n = Number(value)
	return Number.isFinite(n) ? n : fallback
}

function parseHitRate(value) {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
		return value
	}

	if (typeof value === "string" && value.includes("/")) {
		const [hits, total] = value.split("/").map(Number)
		if (Number.isFinite(hits) && Number.isFinite(total) && total > 0) return hits / total
	}

	const n = Number(value)
	if (Number.isFinite(n) && n >= 0 && n <= 1) return n
	return 0
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value))
}

function isFragileLeg(row) {
	const hitRate = parseHitRate(row.hitRate)
	const edge = toNumber(row.edge)
	const score = toNumber(row.score)
	const minutesRisk = toNumber(row.minutesRisk)
	const trendRisk = toNumber(row.trendRisk)
	const injuryRisk = toNumber(row.injuryRisk)

	return (
		hitRate < 0.47 ||
		edge < -1 ||
		score < 35 ||
		minutesRisk >= 0.8 ||
		trendRisk >= 0.8 ||
		injuryRisk >= 0.7
	)
}

function classifyLegArchetype(row) {
	const hitRate = parseHitRate(row.hitRate)
	const edge = toNumber(row.edge)
	const score = toNumber(row.score)
	const odds = toNumber(row.odds)
	const avgMin = toNumber(row.avgMin)
	const minFloor = toNumber(row.minFloor)

	const minutesRisk = toNumber(row.minutesRisk)
	const trendRisk = toNumber(row.trendRisk)
	const injuryRisk = toNumber(row.injuryRisk)
	const riskAvg = clamp((minutesRisk + trendRisk + injuryRisk) / 3, 0, 1)

	if (isFragileLeg(row)) {
		return "avoid"
	}

	const isAnchor =
		hitRate >= 0.62 &&
		avgMin >= 30 &&
		minFloor >= 24 &&
		riskAvg <= 0.35 &&
		edge >= 0 &&
		score >= 60 &&
		odds >= -240 &&
		odds <= 135

	if (isAnchor) {
		return "anchor"
	}

	const moderateRisk = riskAvg >= 0.25 && riskAvg <= 0.62
	const isLadder = odds >= 100 && odds <= 180 && hitRate >= 0.52 && moderateRisk

	if (isLadder) {
		return "ladder"
	}

	const isCeiling =
		odds >= 180 ||
		(odds >= 140 && edge > 1.5) ||
		(hitRate <= 0.55 && edge > 2) ||
		(score >= 70 && odds >= 125 && riskAvg <= 0.58)

	if (isCeiling) {
		return "ceiling"
	}

	if (odds >= 125) {
		return "ceiling"
	}

	return "ladder"
}

module.exports = {
	classifyLegArchetype
}
