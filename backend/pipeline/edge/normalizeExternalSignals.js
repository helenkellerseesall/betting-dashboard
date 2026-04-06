const { EDGE_SOURCE_CONFIG } = require("./sourceConfig")

const AVAILABILITY_MAP = {
	active: "available",
	available: "available",
	in: "available",
	out: "out",
	unavailable: "out",
	questionable: "questionable",
	probable: "probable",
	doubtful: "doubtful",
	game_time_decision: "questionable"
}

const STARTER_MAP = {
	starter: "starter",
	starting: "starter",
	confirmed_starter: "starter",
	non_starter: "bench",
	bench: "bench",
	reserve: "bench",
	unknown: "unknown"
}

const MARKET_VALIDITY_MAP = {
	valid: "valid",
	live: "valid",
	suspended: "suspended",
	off_board: "invalid",
	invalid: "invalid",
	stale: "stale"
}

function normalizeKey(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "_")
}

function normalizeFromMap(rawValue, map, fallback) {
	const key = normalizeKey(rawValue)
	if (!key) return fallback
	return map[key] || fallback
}

function toContextTag(rawValue) {
	const key = normalizeKey(rawValue)
	if (!key) return "context-neutral"
	if (key.includes("out") || key.includes("inactive")) return "context-player-out"
	if (key.includes("question") || key.includes("doubtful") || key.includes("gtd")) return "context-uncertain-availability"
	if (key.includes("starter") || key.includes("starting")) return "context-starter-confirmed"
	if (key.includes("valid") || key.includes("live")) return "context-market-live"
	if (key.includes("stale") || key.includes("suspend") || key.includes("invalid")) return "context-market-uncertain"
	return `context-${key}`
}

function resolveSource(rawInput) {
	const trusted = EDGE_SOURCE_CONFIG?.trustedSourceStack || []
	const sourceMap = EDGE_SOURCE_CONFIG?.sources || {}
	const requested = normalizeKey(rawInput?.sourceName || rawInput?.source || rawInput?.provider)

	if (requested && sourceMap[requested]) {
		return {
			sourceName: requested,
			sourcePriority: Number(sourceMap[requested]?.priority || trusted.indexOf(requested) + 1 || null) || null,
			influences: sourceMap[requested]?.influences || {}
		}
	}

	const fallbackName = trusted[0] || null
	return {
		sourceName: fallbackName,
		sourcePriority: fallbackName ? Number(sourceMap[fallbackName]?.priority || 1) : null,
		influences: fallbackName ? (sourceMap[fallbackName]?.influences || {}) : {}
	}
}

function normalizeExternalSignal(rawInput = {}) {
	const source = resolveSource(rawInput)
	const rawAvailability = rawInput?.availabilityStatus || rawInput?.availability || rawInput?.injuryStatus
	const rawStarter = rawInput?.starterStatus || rawInput?.lineupStatus || rawInput?.startingStatus
	const rawMarket = rawInput?.marketValidity || rawInput?.marketStatus || rawInput?.boardStatus
	const rawContext = rawInput?.contextTag || rawInput?.context || rawInput?.noteTag

	const availabilityStatus = source.influences?.availability
		? normalizeFromMap(rawAvailability, AVAILABILITY_MAP, "unknown")
		: "not-influenced"

	const starterStatus = source.influences?.starterStatus
		? normalizeFromMap(rawStarter, STARTER_MAP, "unknown")
		: "not-influenced"

	const marketValidity = source.influences?.marketValidity
		? normalizeFromMap(rawMarket, MARKET_VALIDITY_MAP, "unknown")
		: "not-influenced"

	const contextTag = source.influences?.contextTag
		? toContextTag(rawContext || rawAvailability || rawStarter || rawMarket)
		: "context-neutral"

	return {
		availabilityStatus,
		starterStatus,
		marketValidity,
		contextTag,
		sourceName: source.sourceName,
		sourcePriority: source.sourcePriority
	}
}

function normalizeExternalSignals(rawInputs) {
	if (Array.isArray(rawInputs)) return rawInputs.map((input) => normalizeExternalSignal(input))
	return normalizeExternalSignal(rawInputs || {})
}

module.exports = {
	normalizeExternalSignal,
	normalizeExternalSignals
}
