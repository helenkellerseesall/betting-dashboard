"use strict"

/**
 * MLB Phase 1 — Contextual Signal Composer
 *
 * Aggregates per-prop context layers (weather, park, handedness, pitcher_env,
 * bullpen, lineup) into a single observational shift + tag list.
 *
 * Phase 1 is OBSERVATIONAL ONLY — `mlbContextualShift` is attached to rows
 * but downstream `hydrateMlbProbabilityLayer` does not yet consume it.
 * That is intentional: we first prove the signal exists and the columns
 * persist longitudinally before any probability fusion.
 *
 * Output:
 *   contextualShift   — bounded [-0.10, +0.10]; null when no layer fired
 *   contextualTags    — short human-readable causal tags ("HR_FRIENDLY_PARK",
 *                       "WIND_OUT_TO_CF", "PLATOON_OPP", "LINEUP_HEART",
 *                       "PITCHER_KENV_FAVOR", "BULLPEN_FATIGUED", ...)
 *   contextualSignal  — flat summary object (numbers only) for diagnostics
 *                       and for raw_context_json in frozen state
 *
 * Per-family weighting is chosen to make the dominant causal layer
 * carry the most weight for that prop family:
 *
 *   HR props        → weather (0.45) + park (0.40) + handedness (0.10) + lineup (0.05)
 *   batter_k props  → pitcher_env (0.55) + handedness (0.30) + bullpen (0.10) + lineup (0.05)
 *   pitcher props   → pitcher_env (0.70) + handedness (0.20) + bullpen (0.10)
 *   rbi/runs/sb     → lineup (0.55) + handedness (0.20) + park (0.15) + weather (0.10)
 *   hits/tb         → lineup (0.30) + handedness (0.25) + weather (0.20) + park (0.15) + pitcher_env (0.10)
 *   other           → handedness (0.40) + lineup (0.30) + park (0.15) + weather (0.15)
 *
 * Weights always sum to 1.0; magnitudes are bounded so even all-on shifts
 * cap at ±0.10 — far below market-move thresholds. Observational only.
 */

const { propFamilyTag } = require("./deriveMlbLineupContext")
const { isPitcherPropFamily } = require("./deriveMlbPitcherEnvironmentContext")

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v))
}

function familyFor(row) {
	if (isPitcherPropFamily(row)) return "pitcher"
	const t = propFamilyTag(row)
	if (t === "hr") return "hr"
	if (t === "batter_k") return "batter_k"
	if (t === "rbi" || t === "runs" || t === "sb") return "rbi_runs_sb"
	if (t === "hits" || t === "tb") return "hits_tb"
	return "other"
}

function weightsFor(family) {
	switch (family) {
		case "hr":          return { weather: 0.45, park: 0.40, handedness: 0.10, pitcherEnv: 0.00, bullpen: 0.00, lineup: 0.05 }
		case "batter_k":    return { weather: 0.00, park: 0.00, handedness: 0.30, pitcherEnv: 0.55, bullpen: 0.10, lineup: 0.05 }
		case "pitcher":     return { weather: 0.00, park: 0.00, handedness: 0.20, pitcherEnv: 0.70, bullpen: 0.10, lineup: 0.00 }
		case "rbi_runs_sb": return { weather: 0.10, park: 0.15, handedness: 0.20, pitcherEnv: 0.00, bullpen: 0.00, lineup: 0.55 }
		case "hits_tb":     return { weather: 0.20, park: 0.15, handedness: 0.25, pitcherEnv: 0.10, bullpen: 0.00, lineup: 0.30 }
		default:            return { weather: 0.15, park: 0.15, handedness: 0.40, pitcherEnv: 0.00, bullpen: 0.00, lineup: 0.30 }
	}
}

function composeMlbContextualSignal({ row, weather, park, handedness, pitcherEnv, bullpen, lineup }) {
	if (!row) return { contextualShift: null, contextualTags: [], contextualSignal: null }

	const family = familyFor(row)
	const w = weightsFor(family)
	const side = String(row?.side || "").toLowerCase()
	const signFromSide = side === "under" ? -1 : 1

	const weatherShift     = weather?.carryShift ?? 0
	const parkShift        = park?.hrFactorShift ?? 0
	const handednessShift  = handedness?.batterPlatoonShift ?? 0
	const pitcherEnvShift  = pitcherEnv?.kEnvironmentShift ?? 0
	const bullpenShift     = bullpen?.bullpenShift ?? 0
	const lineupShift      = lineup?.opportunityShift ?? 0

	// For HR props and batter offensive props, side=over already aligns with positive
	// shifts produced by the derivers. For pitcher props (strikeout family), side=under
	// inverts — but kEnvironmentShift already encodes side direction internally.
	// We multiply by signFromSide ONLY for layers whose deriver did NOT bake side in:
	//   - weather/park/handedness for batter props inherit side via signFromSide
	//   - lineup already bakes side
	//   - pitcherEnv already bakes side
	//   - bullpen already bakes side

	const directionalWeather    = (family === "pitcher" ? 0 : weatherShift) * signFromSide
	const directionalPark       = (family === "pitcher" ? 0 : parkShift)    * signFromSide
	const directionalHandedness = (family === "pitcher" ? -handednessShift : handednessShift) * signFromSide

	let total =
		w.weather    * directionalWeather +
		w.park       * directionalPark +
		w.handedness * directionalHandedness +
		w.pitcherEnv * pitcherEnvShift +
		w.bullpen    * bullpenShift +
		w.lineup     * lineupShift

	total = clamp(total, -0.10, 0.10)

	const tags = []
	if (park?.hrEnvironmentTag === "HR_FRIENDLY")     tags.push("PARK_HR_FRIENDLY")
	if (park?.hrEnvironmentTag === "HR_SUPPRESSING")  tags.push("PARK_HR_SUPPRESSING")
	if (weather?.windDirectionTag === "out_to_cf")    tags.push("WIND_OUT")
	if (weather?.windDirectionTag === "in_from_cf")   tags.push("WIND_IN")
	if (weather?.temperatureF != null && weather.temperatureF >= 85) tags.push("HOT_AIR_CARRY")
	if (weather?.temperatureF != null && weather.temperatureF <= 55) tags.push("COLD_DEAD_AIR")
	if (handedness?.platoonRelation === "opp")        tags.push("PLATOON_OPP")
	if (handedness?.platoonRelation === "same")       tags.push("PLATOON_SAME")
	if (pitcherEnv?.fatigueFlag === true)             tags.push("PITCHER_FATIGUED")
	if (pitcherEnv?.kRate != null && pitcherEnv.kRate >= 0.27) tags.push("PITCHER_K_HEAVY")
	if (bullpen?.reliefFatigueScore != null && bullpen.reliefFatigueScore >= 0.6) tags.push("BULLPEN_FATIGUED")
	if (lineup?.depth === "middle" && (family === "rbi_runs_sb" || family === "hits_tb")) tags.push("LINEUP_HEART")
	if (lineup?.depth === "top"    && (family === "rbi_runs_sb")) tags.push("LINEUP_TABLE_SETTER")
	if (lineup?.depth === "back"   && (family === "hits_tb" || family === "rbi_runs_sb")) tags.push("LINEUP_BOTTOM")

	const fired =
		weather   != null ||
		park      != null ||
		handedness!= null ||
		(pitcherEnv && pitcherEnv.dataAvailable) ||
		(bullpen   && bullpen.dataAvailable) ||
		lineup    != null

	const contextualSignal = {
		family,
		side,
		weatherShift: Number(directionalWeather.toFixed(4)),
		parkShift: Number(directionalPark.toFixed(4)),
		handednessShift: Number(directionalHandedness.toFixed(4)),
		pitcherEnvShift: Number(pitcherEnvShift.toFixed(4)),
		bullpenShift: Number(bullpenShift.toFixed(4)),
		lineupShift: Number(lineupShift.toFixed(4)),
		total: Number(total.toFixed(4)),
		layersFired: {
			weather: weather != null,
			park: park != null,
			handedness: handedness != null,
			pitcherEnv: !!(pitcherEnv && pitcherEnv.dataAvailable),
			bullpen: !!(bullpen && bullpen.dataAvailable),
			lineup: lineup != null,
		},
	}

	return {
		contextualShift: fired ? Number(total.toFixed(4)) : null,
		contextualTags: tags,
		contextualSignal,
	}
}

module.exports = { composeMlbContextualSignal, familyFor, weightsFor }
