const { EDGE_SOURCE_CONFIG } = require("./sourceConfig")
const { normalizeExternalSignal } = require("./normalizeExternalSignals")

function normalizeKey(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
}

function toPlayerKey(playerName) {
	return String(playerName || "")
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
}

function resolveSourceName(rawInput = {}) {
	const requested = normalizeKey(rawInput?.sourceName || rawInput?.source || rawInput?.provider)
	if (requested === "nba" || requested === "nba_official" || requested === "official_injury_report") {
		return "nba_official_injury_report"
	}
	if (requested === "roto_wire") return "rotowire"
	if (requested === "roto_grinders") return "rotogrinders"
	if (EDGE_SOURCE_CONFIG?.sources?.[requested]) return requested
	return "nba_official_injury_report"
}

function getSourcePriority(sourceName) {
	return Number(EDGE_SOURCE_CONFIG?.sources?.[sourceName]?.priority || null) || null
}

function booleanStarterValue(value) {
	if (value === true) return "starter"
	if (value === false) return "bench"
	return null
}

function pickFirstNonEmpty(values) {
	for (const value of values) {
		if (typeof value === "boolean") return value
		if (value != null && String(value).trim()) return value
	}
	return null
}

function extractPlayerName(rawInput = {}) {
	return pickFirstNonEmpty([
		rawInput?.playerName,
		rawInput?.player,
		rawInput?.name,
		rawInput?.athlete,
		rawInput?.description
	]) || null
}

function adaptNbaOfficial(rawInput = {}) {
	return {
		availabilityStatus: pickFirstNonEmpty([
			rawInput?.availabilityStatus,
			rawInput?.status,
			rawInput?.injuryStatus,
			rawInput?.gameStatus,
			rawInput?.reportStatus
		]),
		starterStatus: pickFirstNonEmpty([
			booleanStarterValue(rawInput?.isStarter),
			rawInput?.starterStatus,
			rawInput?.startingStatus,
			rawInput?.lineupStatus,
			rawInput?.startingRole
		]),
		contextTag: pickFirstNonEmpty([
			rawInput?.contextTag,
			rawInput?.reportNote,
			rawInput?.statusNote,
			rawInput?.availabilityStatus,
			rawInput?.status
		])
	}
}

function adaptRotoWire(rawInput = {}) {
	return {
		availabilityStatus: pickFirstNonEmpty([
			rawInput?.availabilityStatus,
			rawInput?.status,
			rawInput?.injuryStatus,
			rawInput?.playerStatus,
			rawInput?.newsStatus
		]),
		starterStatus: pickFirstNonEmpty([
			booleanStarterValue(rawInput?.isStarter),
			booleanStarterValue(rawInput?.confirmedStarter),
			booleanStarterValue(rawInput?.expectedStarter),
			rawInput?.starterStatus,
			rawInput?.lineupStatus,
			rawInput?.startingStatus,
			rawInput?.startingRole
		]),
		contextTag: pickFirstNonEmpty([
			rawInput?.contextTag,
			rawInput?.lineupNote,
			rawInput?.news,
			rawInput?.blurb,
			rawInput?.status
		])
	}
}

function adaptRotoGrinders(rawInput = {}) {
	return {
		availabilityStatus: pickFirstNonEmpty([
			rawInput?.availabilityStatus,
			rawInput?.status,
			rawInput?.injuryStatus,
			rawInput?.playerStatus,
			rawInput?.newsStatus
		]),
		starterStatus: pickFirstNonEmpty([
			booleanStarterValue(rawInput?.isStarter),
			booleanStarterValue(rawInput?.confirmedStarter),
			booleanStarterValue(rawInput?.projectedStarter),
			rawInput?.starterStatus,
			rawInput?.lineupStatus,
			rawInput?.startingStatus,
			rawInput?.startingRole
		]),
		contextTag: pickFirstNonEmpty([
			rawInput?.contextTag,
			rawInput?.lineupNote,
			rawInput?.news,
			rawInput?.report,
			rawInput?.status
		])
	}
}

function extractSourceSpecificSignal(rawInput = {}, sourceName) {
	if (sourceName === "rotowire") return adaptRotoWire(rawInput)
	if (sourceName === "rotogrinders") return adaptRotoGrinders(rawInput)
	return adaptNbaOfficial(rawInput)
}

function adaptAvailabilitySignal(rawInput = {}) {
	const sourceName = resolveSourceName(rawInput)
	const playerName = extractPlayerName(rawInput)
	const playerKey = toPlayerKey(playerName)
	const extracted = extractSourceSpecificSignal(rawInput, sourceName)
	const normalized = normalizeExternalSignal({
		sourceName,
		availabilityStatus: extracted.availabilityStatus,
		starterStatus: extracted.starterStatus,
		contextTag: extracted.contextTag
	})

	return {
		playerKey,
		playerName,
		availabilityStatus: normalized.availabilityStatus,
		starterStatus: normalized.starterStatus,
		contextTag: normalized.contextTag,
		sourceName: normalized.sourceName,
		sourcePriority: getSourcePriority(normalized.sourceName)
	}
}

function adaptAvailabilitySignals(rawInputs) {
	if (Array.isArray(rawInputs)) return rawInputs.map((input) => adaptAvailabilitySignal(input))
	return adaptAvailabilitySignal(rawInputs || {})
}

module.exports = {
	adaptAvailabilitySignal,
	adaptAvailabilitySignals,
	toPlayerKey
}