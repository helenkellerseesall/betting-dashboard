"use strict"

/**
 * Response-Authority Probe — canonical runtime-vs-endpoint observability.
 *
 * Purpose: surface the difference between
 *   (a) what the in-memory runtime state holds (mlbSnapshot.rows, etc.)
 *   (b) what the canonical board pipeline produced (bestAvailablePayload)
 *   (c) what the route actually sent down the wire (response body)
 *
 * When a populated runtime state coexists with an empty API response, this
 * probe makes the disconnect visible in TERM 1 logs and (optionally) in the
 * response itself via `responseAuthority` diagnostic envelope.
 *
 * Architectural rules honored:
 *   - Pure utility; no I/O, no module-load side effects.
 *   - Read-only: never mutates request/response state; only collects and logs.
 *   - Additive: callers OPT IN by calling captureAndCompare(...) and embedding
 *     the returned envelope in their response.
 *   - Rate-limited: each disconnect class logs at most once per process via
 *     a shared module-level flag set; bounded counters never spam.
 *   - Fail-open: every helper is defensive; returns shape-stable payload.
 *
 * Public API:
 *   captureRuntimeBoardCounts(snapshot, sport)        → counts of in-memory state
 *   captureCanonicalBoardCounts(bestAvailablePayload) → counts at the canonical pipeline boundary
 *   captureEndpointBoardCounts(responseBody)          → counts of what's being sent
 *   compareAuthority(runtime, canonical, endpoint)    → diff envelope + disconnect flags
 *   logCanonicalAuthorityProbe(envelope, opts)        → emit [CANONICAL-RESPONSE-AUTHORITY] line
 *
 * Diagnostics envelope shape:
 *   {
 *     sport,                                  // "baseball_mlb" | "basketball_nba"
 *     capturedAtIso,
 *     runtime: { rowsTotal, propsCount, hasMlbLiveState, snapshotUpdatedAt },
 *     canonical: { best, finalPlayableRows, safe, balanced, aggressive, lotto, parlaysCore },
 *     endpoint: { bestProps, allProps, hrSlipsCount, parlaysTopPlays },
 *     disconnects: {
 *       runtimePopulatedButCanonicalEmpty,
 *       canonicalPopulatedButEndpointEmpty,
 *       runtimePopulatedButEndpointEmpty,
 *     },
 *     responseHydrationSource,                // "canonical_best" | "canonical_finalPlayable" | "fallback_empty" | "unknown"
 *     responseSerializerSelected,             // identifier of the route owner
 *     fallbackPayloadUsed: boolean,
 *     stalePayloadDetected: boolean,
 *   }
 */

const MAX_LOG_PER_PROCESS = 5
let _logCount = 0
const _loggedKinds = new Set()

function safeLen(v) {
	return Array.isArray(v) ? v.length : 0
}

function captureRuntimeBoardCounts(snapshot, sport) {
	if (!snapshot || typeof snapshot !== "object") {
		return { rowsTotal: 0, propsCount: 0, hasMlbLiveState: false, snapshotUpdatedAt: null }
	}
	const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : []
	const props = Array.isArray(snapshot?.props) ? snapshot.props : []
	let hasMlbLiveState = false
	for (let i = 0; i < Math.min(rows.length, 25); i++) {
		if (rows[i] && rows[i].mlbLiveState) { hasMlbLiveState = true; break }
	}
	return {
		rowsTotal: rows.length,
		propsCount: props.length,
		hasMlbLiveState,
		snapshotUpdatedAt: snapshot?.updatedAt || snapshot?.snapshotGeneratedAt || null,
		snapshotSlateDateKey: snapshot?.snapshotSlateDateKey || null,
	}
}

function captureCanonicalBoardCounts(bestAvailablePayload) {
	if (!bestAvailablePayload || typeof bestAvailablePayload !== "object") {
		return {
			best: 0,
			finalPlayableRows: 0,
			safe: 0,
			balanced: 0,
			aggressive: 0,
			lotto: 0,
			parlaysCore: 0,
			parlaysTopPlays: 0,
			payloadShape: "missing",
		}
	}
	return {
		best:                safeLen(bestAvailablePayload?.best),
		finalPlayableRows:   safeLen(bestAvailablePayload?.finalPlayableRows),
		safe:                safeLen(bestAvailablePayload?.safe?.legs) || safeLen(bestAvailablePayload?.safe),
		balanced:            safeLen(bestAvailablePayload?.balanced?.legs) || safeLen(bestAvailablePayload?.balanced),
		aggressive:          safeLen(bestAvailablePayload?.aggressive?.legs) || safeLen(bestAvailablePayload?.aggressive),
		lotto:               safeLen(bestAvailablePayload?.lotto?.legs) || safeLen(bestAvailablePayload?.lotto),
		parlaysCore:         safeLen(bestAvailablePayload?.parlays?.core),
		parlaysTopPlays:     safeLen(bestAvailablePayload?.parlays?.topPlays) || safeLen(bestAvailablePayload?.topPlays),
		payloadShape:        "present",
	}
}

function captureEndpointBoardCounts(responseBody) {
	if (!responseBody || typeof responseBody !== "object") {
		return { bestProps: 0, allProps: 0, hrSlipsCount: 0, parlaysTopPlays: 0 }
	}
	const hrSlips = responseBody?.hrSlips
	const hrSlipsCount = Array.isArray(hrSlips) ? hrSlips.length
		: (hrSlips && typeof hrSlips === "object") ? Object.keys(hrSlips).length : 0
	return {
		bestProps:        safeLen(responseBody?.bestProps),
		allProps:         safeLen(responseBody?.allProps),
		hrSlipsCount,
		parlaysTopPlays:  safeLen(responseBody?.parlays?.topPlays),
	}
}

function compareAuthority({ runtime, canonical, endpoint, sport, owner }) {
	const runtimePopulated  = (runtime?.rowsTotal || 0) > 0
	const canonicalPopulated = (canonical?.best || 0) > 0 || (canonical?.finalPlayableRows || 0) > 0
	const endpointPopulated = (endpoint?.bestProps || 0) > 0

	const disconnects = {
		runtimePopulatedButCanonicalEmpty:  runtimePopulated && !canonicalPopulated,
		canonicalPopulatedButEndpointEmpty: canonicalPopulated && !endpointPopulated,
		runtimePopulatedButEndpointEmpty:   runtimePopulated && !endpointPopulated,
	}

	// Determine hydration source — which canonical field actually filled the response.
	let responseHydrationSource = "fallback_empty"
	if (endpointPopulated) {
		responseHydrationSource =
			(canonical?.finalPlayableRows || 0) >= (endpoint?.bestProps || 0)
				? "canonical_finalPlayable"
				: "canonical_best"
	}

	// "Stale payload" indicator — the snapshot updatedAt is far in the past
	// relative to the request time. We can't compute freshness threshold here;
	// the freshness layer handles that. We only set the flag when the timestamp
	// is suspicious (absent OR older than 60 minutes).
	let stalePayloadDetected = false
	const updatedAt = runtime?.snapshotUpdatedAt
	if (updatedAt) {
		const ageMs = Date.now() - new Date(updatedAt).getTime()
		if (Number.isFinite(ageMs) && ageMs > 60 * 60 * 1000) stalePayloadDetected = true
	} else {
		stalePayloadDetected = true
	}

	return {
		sport: sport || null,
		capturedAtIso: new Date().toISOString(),
		runtime,
		canonical,
		endpoint,
		disconnects,
		responseHydrationSource,
		responseSerializerSelected: owner || "unknown",
		fallbackPayloadUsed: responseHydrationSource === "fallback_empty",
		stalePayloadDetected,
	}
}

/**
 * Emit the [CANONICAL-RESPONSE-AUTHORITY] probe to TERM 1 logs.
 *
 * Three behaviors:
 *   - Always emits the AUTHORITY line (rate-limited at 5 total per process so
 *     a steady stream of API requests doesn't fill the log).
 *   - Additionally emits [CANONICAL-RESPONSE-DISCONNECT] when a disconnect is
 *     detected; one line per disconnect class per process.
 *   - Skips entirely when the runtime, canonical, AND endpoint are all empty
 *     (no signal worth logging in that case).
 */
function logCanonicalAuthorityProbe(envelope, { context = "request" } = {}) {
	if (!envelope) return envelope
	const r = envelope.runtime || {}
	const c = envelope.canonical || {}
	const e = envelope.endpoint || {}
	const allEmpty = (r.rowsTotal || 0) === 0 && (c.best || 0) === 0 && (e.bestProps || 0) === 0
	if (allEmpty) return envelope
	if (_logCount < MAX_LOG_PER_PROCESS) {
		_logCount += 1
		console.log("[CANONICAL-RESPONSE-AUTHORITY]", JSON.stringify({
			context,
			sport: envelope.sport,
			owner: envelope.responseSerializerSelected,
			runtime: r,
			canonical: c,
			endpoint: e,
			hydrationSource: envelope.responseHydrationSource,
			fallbackPayloadUsed: envelope.fallbackPayloadUsed,
			stalePayloadDetected: envelope.stalePayloadDetected,
		}))
	}
	for (const [kind, flagged] of Object.entries(envelope.disconnects || {})) {
		if (!flagged) continue
		if (_loggedKinds.has(kind)) continue
		_loggedKinds.add(kind)
		console.log("[CANONICAL-RESPONSE-DISCONNECT]", JSON.stringify({
			context,
			sport: envelope.sport,
			owner: envelope.responseSerializerSelected,
			disconnectKind: kind,
			runtime: r,
			canonical: c,
			endpoint: e,
			note: kind === "runtimePopulatedButCanonicalEmpty"
				? "in-memory snapshot has rows but canonical pipeline produced no best/finalPlayable rows — investigate buildMlbLiveDualBestAvailablePayload selection logic"
				: kind === "canonicalPopulatedButEndpointEmpty"
					? "canonical pipeline produced best/finalPlayable rows but route response carries 0 bestProps — investigate response serializer at owner above"
					: "in-memory snapshot has rows but route response is empty — disconnect somewhere between snapshot read and JSON serialization",
		}))
	}
	return envelope
}

/**
 * Build a compact API-safe summary suitable for embedding in the response
 * itself. Avoids dumping full counts arrays; exposes scalar counts so
 * clients can detect drift without inspecting probes.
 */
function buildResponseAuthoritySummary(envelope) {
	if (!envelope) return null
	return {
		sport: envelope.sport,
		canonicalOwner: envelope.responseSerializerSelected,
		hydrationSource: envelope.responseHydrationSource,
		fallbackPayloadUsed: envelope.fallbackPayloadUsed,
		stalePayloadDetected: envelope.stalePayloadDetected,
		counts: {
			runtimeRows: envelope.runtime?.rowsTotal || 0,
			canonicalBest: envelope.canonical?.best || 0,
			canonicalFinalPlayable: envelope.canonical?.finalPlayableRows || 0,
			endpointBestProps: envelope.endpoint?.bestProps || 0,
			endpointAllProps: envelope.endpoint?.allProps || 0,
		},
		disconnects: envelope.disconnects || {},
	}
}

/**
 * One-call convenience: capture + compare + log + return the summary in one go.
 * Designed for route handlers — minimizes surface area at the call site.
 */
function captureAndProbe({ snapshot, bestAvailablePayload, responseBody, sport, owner }) {
	const runtime  = captureRuntimeBoardCounts(snapshot, sport)
	const canonical = captureCanonicalBoardCounts(bestAvailablePayload)
	const endpoint = captureEndpointBoardCounts(responseBody)
	const envelope = compareAuthority({ runtime, canonical, endpoint, sport, owner })
	logCanonicalAuthorityProbe(envelope)
	return {
		envelope,
		summary: buildResponseAuthoritySummary(envelope),
	}
}

function emptyResponseAuthoritySummary() {
	return {
		sport: null,
		canonicalOwner: null,
		hydrationSource: null,
		fallbackPayloadUsed: false,
		stalePayloadDetected: false,
		counts: {
			runtimeRows: 0,
			canonicalBest: 0,
			canonicalFinalPlayable: 0,
			endpointBestProps: 0,
			endpointAllProps: 0,
		},
		disconnects: {},
	}
}

module.exports = {
	captureRuntimeBoardCounts,
	captureCanonicalBoardCounts,
	captureEndpointBoardCounts,
	compareAuthority,
	logCanonicalAuthorityProbe,
	buildResponseAuthoritySummary,
	captureAndProbe,
	emptyResponseAuthoritySummary,
}
