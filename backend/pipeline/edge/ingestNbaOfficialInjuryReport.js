const { EDGE_SOURCE_CONFIG } = require("./sourceConfig")
const { toPlayerKey } = require("./buildAvailabilitySignalAdapter")

function normalizeText(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
}

function normalizeNbaOfficialAvailabilityStatus(rawStatus) {
	const status = normalizeText(rawStatus)
	if (!status) return "unknown"

	if (
		status.includes("out") ||
		status.includes("inactive") ||
		status.includes("suspended") ||
		status.includes("not with team") ||
		status.includes("dnp")
	) return "out"

	if (status.includes("doubtful")) return "doubtful"

	if (
		status.includes("questionable") ||
		status.includes("game time") ||
		status.includes("gtd")
	) return "questionable"

	if (
		status.includes("probable") ||
		status.includes("return") ||
		status.includes("limited")
	) return "probable"

	if (
		status.includes("active") ||
		status.includes("available") ||
		status.includes("cleared") ||
		status.includes("healthy")
	) return "active"

	return "unknown"
}

function buildContextTag(availabilityStatus, reportNote) {
	const note = normalizeText(reportNote)
	if (availabilityStatus === "out") return "context-player-out"
	if (availabilityStatus === "doubtful") return "context-very-risky-availability"
	if (availabilityStatus === "questionable") return "context-uncertain-availability"
	if (availabilityStatus === "probable") return "context-likely-available"
	if (availabilityStatus === "active") return "context-available"
	if (note.includes("game time") || note.includes("gtd")) return "context-uncertain-availability"
	return "context-neutral"
}

function toArray(rawInput) {
	if (Array.isArray(rawInput)) return rawInput
	if (!rawInput || typeof rawInput !== "object") return []

	const candidateKeys = ["reports", "injuries", "players", "rows", "data", "items", "entries"]
	for (const key of candidateKeys) {
		if (Array.isArray(rawInput[key])) return rawInput[key]
	}

	if (rawInput.player || rawInput.playerName || rawInput.name || rawInput.athlete) return [rawInput]
	return []
}

function extractPlayerName(row) {
	return String(
		row?.playerName ||
		row?.player ||
		row?.name ||
		row?.athlete ||
		row?.description ||
		""
	).trim()
}

function extractStatus(row) {
	return (
		row?.availabilityStatus ||
		row?.status ||
		row?.injuryStatus ||
		row?.reportStatus ||
		row?.gameStatus ||
		row?.playerStatus ||
		""
	)
}

function extractReportNote(row) {
	const value =
		row?.reportNote ||
		row?.note ||
		row?.reason ||
		row?.comment ||
		row?.details ||
		row?.description ||
		""
	return String(value).trim() || null
}

function statusStrength(status) {
	if (status === "out") return 5
	if (status === "doubtful") return 4
	if (status === "questionable") return 3
	if (status === "probable") return 2
	if (status === "active") return 1
	return 0
}

function ingestNbaOfficialInjuryReport(rawInput) {
	const rows = toArray(rawInput)
	const sourceName = "nba_official_injury_report"
	const sourcePriority = Number(EDGE_SOURCE_CONFIG?.sources?.[sourceName]?.priority || 1)
	const byPlayerKey = new Map()

	for (const row of rows) {
		const playerName = extractPlayerName(row)
		const playerKey = toPlayerKey(playerName)
		if (!playerKey) continue

		const availabilityStatus = normalizeNbaOfficialAvailabilityStatus(extractStatus(row))
		const reportNote = extractReportNote(row)
		const contextTag = buildContextTag(availabilityStatus, reportNote)

		const candidate = {
			playerKey,
			playerName,
			availabilityStatus,
			contextTag,
			sourceName,
			sourcePriority,
			reportNote
		}

		const existing = byPlayerKey.get(playerKey)
		if (!existing || statusStrength(candidate.availabilityStatus) > statusStrength(existing.availabilityStatus)) {
			byPlayerKey.set(playerKey, candidate)
		}
	}

	return Array.from(byPlayerKey.values())
}

module.exports = {
	ingestNbaOfficialInjuryReport,
	normalizeNbaOfficialAvailabilityStatus
}
