const { EDGE_SOURCE_CONFIG } = require("./sourceConfig")
const { toPlayerKey } = require("./buildAvailabilitySignalAdapter")

function normalizeText(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
}

function toArray(rawInput) {
	if (Array.isArray(rawInput)) return rawInput
	if (!rawInput || typeof rawInput !== "object") return []

	const listKeys = [
		"lineups",
		"statuses",
		"news",
		"signals",
		"rows",
		"items",
		"entries",
		"data",
		"players"
	]

	for (const key of listKeys) {
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

function extractStatusText(row) {
	return String(
		row?.availabilityStatus ||
		row?.status ||
		row?.injuryStatus ||
		row?.playerStatus ||
		row?.newsStatus ||
		row?.gameStatus ||
		""
	)
}

function extractStarterHint(row) {
	const explicit = row?.starterStatus || row?.lineupStatus || row?.startingStatus || row?.startingRole || ""
	if (String(explicit).trim()) return String(explicit)
	if (row?.confirmedStarter === true || row?.isStarter === true || row?.projectedStarter === true || row?.expectedStarter === true) {
		return "confirmed starter"
	}
	if (row?.confirmedStarter === false || row?.isStarter === false || row?.projectedStarter === false || row?.expectedStarter === false) {
		return "bench"
	}
	return ""
}

function extractReportNote(row) {
	const note =
		row?.reportNote ||
		row?.lineupNote ||
		row?.note ||
		row?.news ||
		row?.blurb ||
		row?.context ||
		row?.description ||
		""
	return String(note).trim() || null
}

function normalizeAvailabilityStatus(statusText) {
	const status = normalizeText(statusText)
	if (!status) return "unknown"
	if (status.includes("out") || status.includes("inactive") || status.includes("suspended") || status.includes("dnp")) return "out"
	if (status.includes("doubtful")) return "doubtful"
	if (status.includes("questionable") || status.includes("game time") || status.includes("gtd")) return "questionable"
	if (status.includes("probable") || status.includes("returning") || status.includes("limited")) return "probable"
	if (status.includes("active") || status.includes("available") || status.includes("cleared")) return "active"
	return "unknown"
}

function normalizeStarterStatus(starterHint, reportNote) {
	const starter = normalizeText(starterHint)
	const note = normalizeText(reportNote)
	const merged = `${starter} ${note}`.trim()

	if (!merged) return "unknown"
	if (merged.includes("confirmed starter") || merged.includes("starting") || merged.includes("first unit") || merged.includes("will start")) return "starter"
	if (merged.includes("projected starter") || merged.includes("expected starter")) return "starter"
	if (merged.includes("bench") || merged.includes("reserve") || merged.includes("second unit") || merged.includes("non starter")) return "bench"
	return "unknown"
}

function buildContextTag(availabilityStatus, starterStatus, reportNote) {
	const note = normalizeText(reportNote)
	if (availabilityStatus === "out") return "context-player-out"
	if (availabilityStatus === "questionable" || availabilityStatus === "doubtful") return "context-uncertain-availability"
	if (starterStatus === "starter") return "context-starter-confirmed"
	if (starterStatus === "bench") return "context-bench-role"
	if (note.includes("minutes") || note.includes("restriction")) return "context-minutes-watch"
	if (availabilityStatus === "probable") return "context-likely-available"
	if (availabilityStatus === "active") return "context-available"
	return "context-neutral"
}

function starterStrength(status) {
	if (status === "starter") return 2
	if (status === "bench") return 1
	return 0
}

function availabilityStrength(status) {
	if (status === "out") return 5
	if (status === "doubtful") return 4
	if (status === "questionable") return 3
	if (status === "probable") return 2
	if (status === "active") return 1
	return 0
}

function ingestRotoWireSignals(rawInput) {
	const rows = toArray(rawInput)
	const sourceName = "rotowire"
	const sourcePriority = Number(EDGE_SOURCE_CONFIG?.sources?.[sourceName]?.priority || 3)
	const byPlayerKey = new Map()

	for (const row of rows) {
		const playerName = extractPlayerName(row)
		const playerKey = toPlayerKey(playerName)
		if (!playerKey) continue

		const statusText = extractStatusText(row)
		const starterHint = extractStarterHint(row)
		const reportNote = extractReportNote(row)
		const availabilityStatus = normalizeAvailabilityStatus(statusText)
		const starterStatus = normalizeStarterStatus(starterHint, reportNote)
		const contextTag = buildContextTag(availabilityStatus, starterStatus, reportNote)

		const candidate = {
			playerKey,
			playerName,
			availabilityStatus,
			starterStatus,
			contextTag,
			sourceName,
			sourcePriority,
			reportNote
		}

		const existing = byPlayerKey.get(playerKey)
		const candidateStrength = (availabilityStrength(candidate.availabilityStatus) * 10) + starterStrength(candidate.starterStatus)
		const existingStrength = existing
			? (availabilityStrength(existing.availabilityStatus) * 10) + starterStrength(existing.starterStatus)
			: -1

		if (!existing || candidateStrength > existingStrength) {
			byPlayerKey.set(playerKey, candidate)
		}
	}

	return Array.from(byPlayerKey.values())
}

module.exports = {
	ingestRotoWireSignals
}
