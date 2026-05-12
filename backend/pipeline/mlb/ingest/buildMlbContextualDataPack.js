"use strict"

/**
 * MLB Phase 1B — Contextual Data Pack Coordinator
 *
 * Runs the three Phase 1B environmental ingestion modules in parallel
 * (Promise.allSettled — partial failure is allowed) and returns a single
 * `overrides` object ready to feed into applyMlbContextualLayers.
 *
 * Layers:
 *   - refreshMlbWeatherForSlate     → weatherByEventId
 *   - refreshMlbPitcherStats        → pitcherStatsByName
 *   - refreshMlbBullpenWorkload     → bullpenByTeam
 *
 * Bounded behavior:
 *   - Global timeout (default 30s); on timeout, any layer that hasn't
 *     resolved yields an empty map + a "timeout" diagnostic.
 *   - Kill switch: env MLB_CTX_SKIP_INGEST=1 disables ALL ingestion. The
 *     individual layers also honor their own per-layer skip flags.
 *
 * Diagnostics shape (returned alongside maps):
 *   {
 *     enabled: boolean,
 *     globalTimeoutMs: number,
 *     timedOut: boolean,
 *     layers: { weather, pitchers, bullpen }   // each = per-layer diagnostics
 *     elapsedMs: number,
 *   }
 *
 * Failure mode: never throws. Worst case returns empty maps + diagnostics
 * detailing why. Callers must treat empty maps as a normal outcome (truthful
 * nulls in contextual layer).
 */

const { refreshMlbWeatherForSlate } = require("./refreshMlbWeatherForSlate")
const { refreshMlbPitcherStats }    = require("./refreshMlbPitcherStats")
const { refreshMlbBullpenWorkload } = require("./refreshMlbBullpenWorkload")

const DEFAULT_GLOBAL_TIMEOUT_MS = 30000

function timed(promiseFactory, timeoutMs, onTimeoutResult) {
	return new Promise((resolve) => {
		let settled = false
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			resolve(onTimeoutResult)
		}, timeoutMs)
		Promise.resolve()
			.then(promiseFactory)
			.then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } })
			.catch((e) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ __error: e?.message || String(e) }) } })
	})
}

async function buildMlbContextualDataPack({ events, slateDate, season, globalTimeoutMs = DEFAULT_GLOBAL_TIMEOUT_MS } = {}) {
	const startedAt = Date.now()
	const diagnostics = {
		enabled: true,
		globalTimeoutMs,
		timedOut: false,
		layers: { weather: null, pitchers: null, bullpen: null },
		elapsedMs: 0,
	}

	if (process.env.MLB_CTX_SKIP_INGEST === "1") {
		diagnostics.enabled = false
		diagnostics.elapsedMs = Date.now() - startedAt
		return {
			overrides: { weatherByEventId: {}, pitcherStatsByName: {}, bullpenByTeam: {} },
			diagnostics,
		}
	}

	const weatherP = timed(() => refreshMlbWeatherForSlate({ events }),
		globalTimeoutMs, { weatherByEventId: {}, diagnostics: { layer: "weather", __timeout: true } })
	const pitchersP = timed(() => refreshMlbPitcherStats({ slateDate, season }),
		globalTimeoutMs, { pitcherStatsByName: {}, diagnostics: { layer: "pitcher_stats", __timeout: true } })
	const bullpenP = timed(() => refreshMlbBullpenWorkload({ events }),
		globalTimeoutMs, { bullpenByTeam: {}, diagnostics: { layer: "bullpen_workload", __timeout: true } })

	const settled = await Promise.allSettled([weatherP, pitchersP, bullpenP])

	const overrides = {
		weatherByEventId: {},
		pitcherStatsByName: {},
		bullpenByTeam: {},
	}

	if (settled[0].status === "fulfilled" && settled[0].value) {
		overrides.weatherByEventId = settled[0].value.weatherByEventId || {}
		diagnostics.layers.weather = settled[0].value.diagnostics || { __error: "no_diagnostics" }
	} else {
		diagnostics.layers.weather = { __error: settled[0].reason?.message || "weather_rejected" }
	}

	if (settled[1].status === "fulfilled" && settled[1].value) {
		overrides.pitcherStatsByName = settled[1].value.pitcherStatsByName || {}
		diagnostics.layers.pitchers = settled[1].value.diagnostics || { __error: "no_diagnostics" }
	} else {
		diagnostics.layers.pitchers = { __error: settled[1].reason?.message || "pitchers_rejected" }
	}

	if (settled[2].status === "fulfilled" && settled[2].value) {
		overrides.bullpenByTeam = settled[2].value.bullpenByTeam || {}
		diagnostics.layers.bullpen = settled[2].value.diagnostics || { __error: "no_diagnostics" }
	} else {
		diagnostics.layers.bullpen = { __error: settled[2].reason?.message || "bullpen_rejected" }
	}

	diagnostics.timedOut = Boolean(
		diagnostics.layers.weather?.__timeout ||
		diagnostics.layers.pitchers?.__timeout ||
		diagnostics.layers.bullpen?.__timeout
	)
	diagnostics.elapsedMs = Date.now() - startedAt

	console.log("[MLB-CTX-DATA-PACK]", {
		elapsedMs: diagnostics.elapsedMs,
		weatherCount: Object.keys(overrides.weatherByEventId).length,
		pitcherStatCount: Object.keys(overrides.pitcherStatsByName).length,
		bullpenTeamCount: Object.keys(overrides.bullpenByTeam).length,
		timedOut: diagnostics.timedOut,
	})

	return { overrides, diagnostics }
}

module.exports = { buildMlbContextualDataPack }
