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

function scale01(value, min, max) {
	if (max <= min) return 0
	return clamp((value - min) / (max - min), 0, 1)
}

function avgRisk(row) {
	const minutesRisk = toNumber(row.minutesRisk)
	const trendRisk = toNumber(row.trendRisk)
	const injuryRisk = toNumber(row.injuryRisk)
	return clamp((minutesRisk + trendRisk + injuryRisk) / 3, 0, 1)
}

function isObviouslyBadLeg(row) {
	const hitRate = parseHitRate(row.hitRate)
	const edge = toNumber(row.edge)
	const score = toNumber(row.score)

	return (
		hitRate < 0.47 ||
		edge < -1 ||
		score < 35 ||
		toNumber(row.minutesRisk) >= 0.8 ||
		toNumber(row.trendRisk) >= 0.8 ||
		toNumber(row.injuryRisk) >= 0.7
	)
}

function scoreAnchorLeg(row) {
	if (isObviouslyBadLeg(row)) {
		return 0
	}

	const hitRate = scale01(parseHitRate(row.hitRate), 0.5, 0.8)
	const avgMin = scale01(toNumber(row.avgMin), 20, 38)
	const minFloor = scale01(toNumber(row.minFloor), 14, 32)
	const edge = scale01(toNumber(row.edge), -2, 8)
	const score = scale01(toNumber(row.score), 35, 95)
	const risk = avgRisk(row)
	const odds = toNumber(row.odds)

	// Anchors should not be long-shot legs or over-juiced extremes.
	const oddsFit =
		odds >= -220 && odds <= 120
			? 1
			: odds > 120 && odds <= 170
				? 0.7
				: odds < -220 && odds >= -300
					? 0.6
					: 0.35

	const blended =
		hitRate * 34 +
		avgMin * 15 +
		minFloor * 12 +
		(1 - risk) * 22 +
		edge * 9 +
		score * 6 +
		oddsFit * 2

	return Number(clamp(blended, 0, 100).toFixed(2))
}

function scoreUpsideLeg(row) {
	if (isObviouslyBadLeg(row)) {
		return 0
	}

	const hitRateRaw = parseHitRate(row.hitRate)
	const hitRate = scale01(hitRateRaw, 0.48, 0.72)
	const edge = scale01(toNumber(row.edge), -1.5, 10)
	const score = scale01(toNumber(row.score), 35, 95)
	const risk = avgRisk(row)
	const odds = toNumber(row.odds)
	const propType = String(row.propType || "").toLowerCase()

	let payoutFit = 0.2
	if (odds >= 120 && odds <= 300) payoutFit = 1
	else if (odds > 300 && odds <= 500) payoutFit = 0.9
	else if (odds >= -110 && odds < 120) payoutFit = 0.5
	else if (odds > 500) payoutFit = 0.6

	const propTypeBoost =
		propType.includes("points") ||
		propType.includes("3pt") ||
		propType.includes("threes") ||
		propType.includes("pra")
			? 1
			: 0.8

	const upside =
		payoutFit * 38 +
		edge * 30 +
		hitRate * 20 +
		score * 8 +
		propTypeBoost * 8 +
		(1 - risk) * 2

	const fragilityPenalty = risk > 0.75 ? 8 : 0

	return Number(clamp(upside - fragilityPenalty, 0, 100).toFixed(2))
}

module.exports = {
	scoreAnchorLeg,
	scoreUpsideLeg
}
