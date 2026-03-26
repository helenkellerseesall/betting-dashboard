const { classifyLegArchetype } = require("./archetypes")
const { scoreAnchorLeg, scoreUpsideLeg } = require("./scoring")

function toNumber(value, fallback = 0) {
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

function isValidRow(row, book) {
	if (!row || row.book !== book) return false
	if (!row.player || !row.propType) return false
	return Number.isFinite(Number(row.odds))
}

function legKey(row) {
	const player = String(row.player || "").toLowerCase().trim()
	const stat = String(row.propType || "").toLowerCase().trim()
	const line = String(row.line ?? "")
	const side = String(row.side || "")
	const odds = String(row.odds ?? "")
	return [player, stat, line, side, odds].join("|")
}

function americanToDecimal(americanOdds) {
	const odds = Number(americanOdds)
	if (!Number.isFinite(odds) || odds === 0) return 1
	if (odds > 0) return 1 + odds / 100
	return 1 + 100 / Math.abs(odds)
}

function decimalToAmerican(decimalOdds) {
	const dec = Number(decimalOdds)
	if (!Number.isFinite(dec) || dec <= 1) return 0
	if (dec >= 2) return Math.round((dec - 1) * 100)
	return Math.round(-100 / (dec - 1))
}

function parlayDecimalFromLegs(legs) {
	if (!Array.isArray(legs) || legs.length === 0) return 1
	return legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1)
}

function roughTrueProbabilityFromLegs(legs) {
	if (!Array.isArray(legs) || legs.length === 0) return 0
	return legs.reduce((acc, leg) => {
		const hitRate = clamp(parseHitRate(leg.hitRate), 0.05, 0.95)
		const regressedHitRate = 0.55 + (hitRate - 0.55) * 0.65
		return acc * clamp(regressedHitRate, 0.05, 0.92)
	}, 1)
}

function confidenceFromAdjustedProbability(adjustedProbability) {
	if (adjustedProbability >= 0.6) return "High"
	if (adjustedProbability >= 0.4) return "Medium"
	if (adjustedProbability >= 0.25) return "Low"
	return "Very Low"
}

function adjustedProbabilityFromSelectedRows(selectedRows, rawProbability) {
	const legCount = Array.isArray(selectedRows) ? selectedRows.length : 0
	if (!legCount) return 0

	const legCountPenalty = Math.max(0.45, 1 - Math.max(0, legCount - 2) * 0.08)
	const matchupCounts = new Map()

	for (const row of selectedRows) {
		const matchup = String(row?.matchup || "").trim()
		if (!matchup) continue
		matchupCounts.set(matchup, (matchupCounts.get(matchup) || 0) + 1)
	}

	let sameGameExtraLegs = 0
	for (const count of matchupCounts.values()) {
		if (count > 1) sameGameExtraLegs += count - 1
	}

	const sameGamePenalty = Math.max(0.65, 1 - sameGameExtraLegs * 0.08)
	return clamp(rawProbability * legCountPenalty * sameGamePenalty, 0, 0.95)
}

function selectLegsFromPool(pool, neededCount, selected, usedPlayers, usedLegs, offset) {
	if (neededCount <= 0 || pool.length === 0) return

	for (let i = 0; i < pool.length && neededCount > 0; i += 1) {
		const idx = (i + offset) % pool.length
		const candidate = pool[idx]
		const playerKey = String(candidate.player || "").toLowerCase().trim()
		const key = legKey(candidate)

		if (!playerKey || usedPlayers.has(playerKey) || usedLegs.has(key)) {
			continue
		}

		selected.push(candidate)
		usedPlayers.add(playerKey)
		usedLegs.add(key)
		neededCount -= 1
	}
}

function ensureJuiceLeg(selected, pools, usedPlayers, usedLegs) {
	const hasJuice = selected.some((leg) => Number(leg.odds) >= 140)
	if (hasJuice) {
		return
	}

	const replacementPool = [...(pools.ceilings || []), ...(pools.ladders || [])].filter(
		(candidate) => Number(candidate.odds) >= 140
	)

	for (const candidate of replacementPool) {
		const playerKey = String(candidate.player || "").toLowerCase().trim()
		const key = legKey(candidate)
		const alreadySelected = usedLegs.has(key)
		const playerAlreadyUsed = usedPlayers.has(playerKey)

		if (alreadySelected || !playerKey) {
			continue
		}

		const replaceIndex = selected.findIndex((row) => Number(row.odds) < 140 && row.archetype !== "anchor")
		if (replaceIndex >= 0) {
			const removed = selected[replaceIndex]
			usedLegs.delete(legKey(removed))
			usedPlayers.delete(String(removed.player || "").toLowerCase().trim())
			selected[replaceIndex] = candidate
			usedLegs.add(key)
			usedPlayers.add(playerKey)
			return
		}

		if (!playerAlreadyUsed) {
			selected.push(candidate)
			usedLegs.add(key)
			usedPlayers.add(playerKey)
			return
		}
	}
}

function asLegOutput(row) {
	return {
		playerName: row.player,
		statType: row.propType,
		line: row.line,
		odds: toNumber(row.odds),
		book: row.book,
		hitRate: clamp(parseHitRate(row.hitRate), 0, 1),
		projectedValue: toNumber(row.projectedValue, toNumber(row.edge, toNumber(row.score, 0)))
	}
}

function buildOption(label, rank, stake, selectedRows) {
	const legs = selectedRows.map(asLegOutput)
	const oddsDecimalRaw = parlayDecimalFromLegs(legs)
	const oddsDecimal = Number(oddsDecimalRaw.toFixed(3))
	const oddsAmerican = decimalToAmerican(oddsDecimalRaw)
	const rawMultipliedProbability = roughTrueProbabilityFromLegs(legs)
	const adjustedProbability = adjustedProbabilityFromSelectedRows(selectedRows, rawMultipliedProbability)
	const trueProbability = Number(adjustedProbability.toFixed(4))
	const confidence = confidenceFromAdjustedProbability(adjustedProbability)
	const projectedReturn = Number((stake * oddsDecimalRaw).toFixed(2))
	const estimatedProfit = Number((projectedReturn - stake).toFixed(2))

	console.log("[MONEYMAKER-PROB-DEBUG] slip:", {
		legCount: legs.length,
		rawMultipliedProbability: Number(rawMultipliedProbability.toFixed(4)),
		adjustedProbability: trueProbability,
		assignedConfidence: confidence
	})

	return {
		rank,
		label,
		stake,
		projectedReturn,
		estimatedProfit,
		oddsAmerican,
		oddsDecimal,
		trueProbability,
		confidence,
		legCount: legs.length,
		legs
	}
}

function buildOptionsForGroup(groupLabel, stake, templates, pools, combinedSorted) {
	const options = []

	for (let variant = 0; variant < 5 && options.length < 3; variant += 1) {
		for (let t = 0; t < templates.length && options.length < 3; t += 1) {
			const template = templates[t]
			const selected = []
			const usedPlayers = new Set()
			const usedLegs = new Set()

			selectLegsFromPool(pools.anchors, template.anchors, selected, usedPlayers, usedLegs, variant)
			selectLegsFromPool(pools.ladders, template.ladders, selected, usedPlayers, usedLegs, variant + 1)
			selectLegsFromPool(pools.ceilings, template.ceilings, selected, usedPlayers, usedLegs, variant + 2)

			if (selected.length < template.minLegs) {
				selectLegsFromPool(
					combinedSorted,
					template.minLegs - selected.length,
					selected,
					usedPlayers,
					usedLegs,
					variant + 3
				)
			}

			ensureJuiceLeg(selected, pools, usedPlayers, usedLegs)

			if (selected.length < 2) {
				continue
			}

			options.push(buildOption(`${groupLabel} Option ${options.length + 1}`, options.length + 1, stake, selected))
		}
	}

	return options
}

function buildMoneyMakerPortfolio(book, rows) {
	const filtered = Array.isArray(rows) ? rows.filter((row) => isValidRow(row, book)) : []

	const enriched = filtered
		.map((row) => {
			const archetype = classifyLegArchetype(row)
			if (archetype === "avoid") return null

			const anchorScore = scoreAnchorLeg(row)
			const upsideScore = scoreUpsideLeg(row)
			const combinedScore = archetype === "anchor" ? anchorScore : upsideScore

			return {
				...row,
				archetype,
				anchorScore,
				upsideScore,
				combinedScore
			}
		})
		.filter(Boolean)

	console.log("[MONEYMAKER-DEBUG] enriched row count:", enriched.length)
	console.log(
		"[MONEYMAKER-DEBUG] enriched sample:",
		enriched.slice(0, 5).map((row) => ({
			player: row.player,
			propType: row.propType,
			rawHitRate: row.hitRate,
			parsedHitRate: parseHitRate(row.hitRate),
			archetype: row.archetype
		}))
	)

	const anchors = enriched
		.filter((row) => row.archetype === "anchor")
		.sort((a, b) => b.anchorScore - a.anchorScore)

	const ladders = enriched
		.filter((row) => row.archetype === "ladder")
		.sort((a, b) => b.upsideScore - a.upsideScore)

	const ceilings = enriched
		.filter((row) => row.archetype === "ceiling")
		.sort((a, b) => b.upsideScore - a.upsideScore)

	const combinedSorted = [...anchors, ...ladders, ...ceilings].sort((a, b) => b.combinedScore - a.combinedScore)

	const safeWithPopTemplates = [
		{ anchors: 2, ladders: 1, ceilings: 0, minLegs: 3 },
		{ anchors: 2, ladders: 0, ceilings: 1, minLegs: 3 },
		{ anchors: 1, ladders: 1, ceilings: 0, minLegs: 2 }
	]

	const midMoneyTemplates = [
		{ anchors: 1, ladders: 2, ceilings: 0, minLegs: 3 },
		{ anchors: 1, ladders: 1, ceilings: 1, minLegs: 3 },
		{ anchors: 0, ladders: 2, ceilings: 1, minLegs: 3 }
	]

	const bigSwingTemplates = [
		{ anchors: 1, ladders: 1, ceilings: 1, minLegs: 3 },
		{ anchors: 0, ladders: 1, ceilings: 2, minLegs: 3 },
		{ anchors: 1, ladders: 0, ceilings: 2, minLegs: 3 }
	]

	const lottoTemplates = [
		{ anchors: 0, ladders: 2, ceilings: 2, minLegs: 4 },
		{ anchors: 0, ladders: 1, ceilings: 3, minLegs: 4 },
		{ anchors: 0, ladders: 0, ceilings: 3, minLegs: 3 }
	]

	const pools = { anchors, ladders, ceilings }

	return {
		safeWithPop: {
			label: "Safe With Pop",
			description: "Safer core legs with one payout booster.",
			options: buildOptionsForGroup("Safe With Pop", 20, safeWithPopTemplates, pools, combinedSorted)
		},
		midMoney: {
			label: "Mid Money",
			description: "Balanced upside with realistic hit paths.",
			options: buildOptionsForGroup("Mid Money", 15, midMoneyTemplates, pools, combinedSorted)
		},
		bigSwing: {
			label: "Big Swing",
			description: "Aggressive blend featuring at least one ceiling leg.",
			options: buildOptionsForGroup("Big Swing", 10, bigSwingTemplates, pools, combinedSorted)
		},
		lotto: {
			label: "Lotto",
			description: "High-volatility builds for long-shot payout chasing.",
			options: buildOptionsForGroup("Lotto", 5, lottoTemplates, pools, combinedSorted)
		}
	}
}

module.exports = {
	buildMoneyMakerPortfolio
}
