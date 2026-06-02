"use strict"

/**
 * bettorTasteSignal.js — Phase Screenshot-Loop-Close-2C (2026-06-02)
 *
 * Engine read-back. Loads bettor_profiles (populated by Phase 2A) +
 * outcome stats (populated by Phase 2B) and computes a single "operator
 * taste signal" object that buildSlipAi can consult during pick generation.
 *
 * WHY this exists:
 *   Phases 2A + 2B accumulate operator-source preferences and outcomes.
 *   Without THIS module, the engine never reads back what it learned —
 *   the loop is half-closed: data flows IN but never back OUT to influence
 *   pick generation.
 *
 * What it exposes:
 *   getOperatorTasteSignal(db) → {
 *     hasSignal: bool,
 *     sample_count: number,
 *     preferred_archetypes: [{archetype, weight, hit_rate}],
 *     avoid_archetypes:    [{archetype, weight, hit_rate}],
 *     preferred_leg_count_range: [min, max],
 *     preferred_combined_dec_range: [min, max],
 *     preferred_sports: {sport: weight},
 *     summary_for_log: string,  // one-line human-readable
 *     raw_profiles:    [...]
 *   }
 *
 * How weights work:
 *   - "preferred" = archetype with hit_rate > 0.35 AND sample_count >= 3
 *   - "avoid"     = archetype with hit_rate < 0.10 AND sample_count >= 5
 *   - When no graded outcomes exist yet, weights derive from FREQUENCY only
 *     (assume operator wants what they share most)
 *
 * Anti-fabrication:
 *   - Returns hasSignal=false if no bettor_profiles exist
 *   - Hit rates only computed when sample_count meets minimum
 *   - Never invents preferences; only surfaces what's in the data
 *
 * Phase 2C-1 (THIS PHASE):
 *   - Load + compute the signal
 *   - Attach to ctx as ctx.bettorTaste
 *   - Log a one-line summary at start of buildAiSlips
 *   - DOES NOT YET BIAS scoreLeg — that's Phase 2C-2 (requires careful
 *     threshold work + A/B testing to avoid overfitting to small samples)
 *
 * Phase 2C-2 (future):
 *   - scoreLeg adds small bonus/penalty based on bettorTaste
 *   - Per-archetype weighting in buildSlipsForTier
 *   - Operator-visible "this pick matched your taste pattern" tag
 */

function _safeParseJson(s, fb) {
	try { return s ? JSON.parse(s) : fb } catch (_) { return fb }
}

function getOperatorTasteSignal(db) {
	if (!db) return { hasSignal: false, reason: "no_db" }

	let profiles
	try {
		profiles = db.prepare(`
			SELECT id, display_name, source_type,
			       sport_focus, slip_count, classified_count, graded_count,
			       archetype_dist, preference_signals, outcome_stats
			FROM bettor_profiles
			ORDER BY slip_count DESC
		`).all()
	} catch (e) {
		return { hasSignal: false, reason: "table_missing_or_error", error: e?.message || String(e) }
	}

	if (!profiles || profiles.length === 0) {
		return { hasSignal: false, reason: "no_profiles_yet" }
	}

	// Aggregate across all profiles (operator's combined taste signal)
	const totalSlips = profiles.reduce((a, p) => a + (p.slip_count || 0), 0)
	const totalGraded = profiles.reduce((a, p) => a + (p.graded_count || 0), 0)

	const archetypeAgg = {}      // {archetype: {count, won, hit_rate}}
	const sportAgg     = {}      // {sport: count}
	const legCountSum  = { sum: 0, n: 0, min: Infinity, max: -Infinity }
	const combDecSum   = { sum: 0, n: 0, min: Infinity, max: -Infinity }

	for (const p of profiles) {
		const dist = _safeParseJson(p.archetype_dist, {})
		for (const [a, n] of Object.entries(dist)) {
			const entry = archetypeAgg[a] || (archetypeAgg[a] = { count: 0, won: 0 })
			entry.count += n
		}

		const sport = _safeParseJson(p.sport_focus, { sports: {} })
		for (const [s, n] of Object.entries(sport.sports || {})) {
			sportAgg[s] = (sportAgg[s] || 0) + n
		}

		const prefs = _safeParseJson(p.preference_signals, {})
		if (Number.isFinite(prefs.avg_leg_count) && prefs.sample_count > 0) {
			legCountSum.sum += prefs.avg_leg_count * prefs.sample_count
			legCountSum.n   += prefs.sample_count
			if (prefs.avg_leg_count < legCountSum.min) legCountSum.min = Math.floor(prefs.avg_leg_count)
			if (prefs.avg_leg_count > legCountSum.max) legCountSum.max = Math.ceil(prefs.avg_leg_count)
		}
		if (Number.isFinite(prefs.avg_combined_dec) && prefs.sample_count > 0) {
			combDecSum.sum += prefs.avg_combined_dec * prefs.sample_count
			combDecSum.n   += prefs.sample_count
			if (prefs.avg_combined_dec < combDecSum.min) combDecSum.min = prefs.avg_combined_dec
			if (prefs.avg_combined_dec > combDecSum.max) combDecSum.max = prefs.avg_combined_dec
		}

		// Outcome stats (per Phase 2B)
		const outcome = _safeParseJson(p.outcome_stats, {})
		if (outcome.by_archetype) {
			for (const [a, stat] of Object.entries(outcome.by_archetype)) {
				const entry = archetypeAgg[a] || (archetypeAgg[a] = { count: 0, won: 0 })
				entry.won = (entry.won || 0) + (stat.won || 0)
			}
		}
	}

	// Compute per-archetype hit rate + classify into preferred/avoid
	const preferred = []
	const avoid     = []
	for (const [a, e] of Object.entries(archetypeAgg)) {
		const hit_rate = e.count > 0 ? e.won / e.count : null
		const weight = e.count / totalSlips
		const item = { archetype: a, count: e.count, won: e.won, hit_rate, weight }
		if (Number.isFinite(hit_rate) && hit_rate >= 0.35 && e.count >= 3) preferred.push(item)
		else if (Number.isFinite(hit_rate) && hit_rate < 0.10 && e.count >= 5) avoid.push(item)
	}

	// When no outcomes graded yet, fall back to FREQUENCY-based preference
	// (operator shares what they're drawn to)
	const frequencyPreferred = totalGraded === 0
		? Object.entries(archetypeAgg)
				.sort(([, a], [, b]) => b.count - a.count)
				.slice(0, 3)
				.map(([a, e]) => ({ archetype: a, count: e.count, weight: e.count / totalSlips, hit_rate: null, source: "frequency_only" }))
		: []

	const avgLegCount = legCountSum.n > 0 ? legCountSum.sum / legCountSum.n : null
	const avgCombDec  = combDecSum.n > 0  ? combDecSum.sum  / combDecSum.n  : null

	const summary =
		`bettorTaste: ${totalSlips} slips · ${totalGraded} graded · ` +
		`top archetypes: ${(preferred.length ? preferred : frequencyPreferred).map(p => p.archetype).slice(0, 3).join("/") || "none"} · ` +
		`avg legs: ${avgLegCount?.toFixed(1) || "?"} · avg combinedDec: ${avgCombDec?.toFixed(1) || "?"} · ` +
		`sports: ${Object.entries(sportAgg).sort(([, a], [, b]) => b - a).slice(0, 2).map(([s, n]) => s + ":" + n).join(", ")}`

	return {
		hasSignal: true,
		sample_count: totalSlips,
		graded_count: totalGraded,
		preferred_archetypes: preferred.length ? preferred : frequencyPreferred,
		avoid_archetypes: avoid,
		preferred_leg_count_range: legCountSum.n > 0 ? [legCountSum.min, legCountSum.max] : null,
		preferred_leg_count_avg: avgLegCount,
		preferred_combined_dec_range: combDecSum.n > 0 ? [combDecSum.min, combDecSum.max] : null,
		preferred_combined_dec_avg: avgCombDec,
		preferred_sports: sportAgg,
		summary_for_log: summary,
		profile_count: profiles.length,
		raw_profiles: profiles.map(p => ({
			display_name: p.display_name,
			source_type: p.source_type,
			slip_count: p.slip_count,
			graded_count: p.graded_count,
		})),
	}
}

module.exports = { getOperatorTasteSignal }
