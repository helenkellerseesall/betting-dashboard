const { EDGE_SOURCE_CONFIG } = require("./sourceConfig")
const { normalizeExternalSignal, normalizeExternalSignals } = require("./normalizeExternalSignals")

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value))
}

function normalizeIncomingSignals(externalInput) {
	if (Array.isArray(externalInput)) {
		if (externalInput.length === 0) return []
		return normalizeExternalSignals(externalInput)
	}
	if (externalInput && typeof externalInput === "object") {
		return [normalizeExternalSignal(externalInput)]
	}
	return []
}

function rankSignal(signal) {
	const sourceName = String(signal?.sourceName || "")
	const sourcePriority = Number(signal?.sourcePriority)
	if (Number.isFinite(sourcePriority)) return sourcePriority

	const trustedStack = EDGE_SOURCE_CONFIG?.trustedSourceStack || []
	const index = trustedStack.indexOf(sourceName)
	if (index >= 0) return index + 1
return 999
}

function resolvePrimarySignal(signals) {
	const safeSignals = Array.isArray(signals) ? signals : []
	if (safeSignals.length === 0) return null
return [...safeSignals].sort((a, b) => rankSignal(a) - rankSignal(b))[0]
}

function buildExternalEdgeOverlay(row = {}, externalInput) {
	const normalizedSignals = normalizeIncomingSignals(externalInput)
	const primary = resolvePrimarySignal(normalizedSignals)

	const availabilityStatus = primary?.availabilityStatus || "unknown"
	const starterStatus = primary?.starterStatus || "unknown"
	const marketValidity = primary?.marketValidity || "unknown"
	const contextTag = primary?.contextTag || "context-neutral"

	let overlayDelta = 0
	let externalSitFlag = false
	let externalSitReason = null

	if (availabilityStatus === "out") {
		overlayDelta -= 55
		externalSitFlag = true
		externalSitReason = "player-out"
	}

	if (marketValidity === "invalid") {
		overlayDelta -= 45
		externalSitFlag = true
		externalSitReason = externalSitReason || "market-invalid"
	}

	if (marketValidity === "suspended" || marketValidity === "stale") {
		overlayDelta -= 25
		externalSitFlag = externalSitFlag || marketValidity === "suspended"
		externalSitReason = externalSitReason || (marketValidity === "suspended" ? "market-suspended" : "market-stale")
	}

	if (!externalSitFlag && starterStatus === "starter") overlayDelta += 10
	if (!externalSitFlag && marketValidity === "valid") overlayDelta += 8
	if (!externalSitFlag && (contextTag.includes("starter") || contextTag.includes("market-live"))) overlayDelta += 6

	const externalEdgeScore = clamp(overlayDelta, -100, 100)

	let externalEdgeLabel = "external-neutral"
	if (externalEdgeScore <= -35) externalEdgeLabel = "external-downgrade-strong"
	else if (externalEdgeScore < -5) externalEdgeLabel = "external-downgrade"
	else if (externalEdgeScore >= 18) externalEdgeLabel = "external-upgrade"

	return {
		externalEdgeScore,
		externalEdgeLabel,
		availabilityStatus,
		starterStatus,
		marketValidity,
		contextTag,
		externalSignalsUsed: {
			count: normalizedSignals.length,
			sources: normalizedSignals.map((signal) => ({
				sourceName: signal?.sourceName || null,
				sourcePriority: Number(signal?.sourcePriority || null) || null
			}))
		},
		externalSitFlag,
		externalSitReason
	}
}

module.exports = {
	buildExternalEdgeOverlay
}
