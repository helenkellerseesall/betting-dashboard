"use strict"

/**
 * bettorProfilesUpdater.js — Phase Screenshot-Loop-Close-2A (2026-06-02)
 *
 * Post-classification hook. Every time a slip is classified, this updater
 * incrementally updates the bettor_profiles row that owns the slip.
 *
 * WHY this exists:
 *   The screenshot ingester (Phase Screenshot-Tab-Restore-1A) accepts slips
 *   and the classifier (Phase Screenshot-Classifier-Fix-1A) tags them with
 *   archetypes. Without THIS module, every classified slip is a one-shot —
 *   the engine learns nothing about the BETTOR who shared the slip.
 *
 * What it learns:
 *   - source_type / attribution → profile identity
 *   - archetype_dist            → which archetypes this source typically posts
 *   - sport_focus               → which sports they bet (mlb / nba / mixed)
 *   - slip_count                → total slips seen from this source
 *   - classified_count          → how many had valid archetypes (vs 'unknown')
 *   - preference_signals        → leg-count avg, odds avg, structural avg
 *   - last_updated              → freshness for read-back logic
 *
 * What it does NOT do:
 *   - Outcome stats (graded_count, outcome_stats) — that's Phase 2B
 *     (outcome_links populator); this module only handles classification-time
 *     signals, not post-game grading
 *   - Engine read-back — that's Phase 2C (buildSlipAi consults profiles)
 *
 * Profile identity scheme:
 *   profile_id = sha256("{source_type}|{attribution || 'anonymous'}"):16
 *   - Twitter slips with attribution="@dimers" → one profile
 *   - Twitter slips with no attribution → all collapse to one "twitter|anonymous"
 *     profile (catches operator's screenshots-without-attribution case)
 *   - Discord slips → separate profile per attribution (channel name)
 *
 * Anti-fabrication:
 *   - Never invents stats; counts only what was actually classified
 *   - Never collapses cross-source profiles (twitter|X != discord|X)
 *   - Idempotent: same slip re-classified updates counts only ONCE per slip_id
 *     (caller's responsibility to not re-call for same slip)
 */

const crypto = require("crypto")

function profileIdFor(sourceType, attribution) {
	const key = `${sourceType || "unknown"}|${(attribution || "anonymous").toLowerCase().trim()}`
	return "bp_" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)
}

function _safeParseJson(s, fb) {
	try { return s ? JSON.parse(s) : fb } catch (_) { return fb }
}

function _mergeArchetypeDist(existing, archetype) {
	const dist = (existing && typeof existing === "object") ? { ...existing } : {}
	dist[archetype] = (dist[archetype] || 0) + 1
	return dist
}

function _mergeSportFocus(existing, sport) {
	if (!sport) return existing
	const list = (existing && typeof existing === "object" && existing.sports) ? existing.sports : {}
	list[sport] = (list[sport] || 0) + 1
	return { sports: list }
}

function _mergePreferenceSignals(existing, slip, classification) {
	const prev = (existing && typeof existing === "object") ? existing : {}
	const n = (prev.sample_count || 0) + 1
	const legCount = (slip._legs || []).length

	function rollingMean(prevMean, prevN, newVal) {
		if (!Number.isFinite(newVal)) return prevMean
		const pm = Number.isFinite(prevMean) ? prevMean : 0
		return (pm * prevN + newVal) / (prevN + 1)
	}

	return {
		sample_count: n,
		avg_leg_count:           rollingMean(prev.avg_leg_count, n - 1, legCount),
		avg_combined_dec:        rollingMean(prev.avg_combined_dec, n - 1, slip.combined_dec),
		avg_structural_quality:  rollingMean(prev.avg_structural_quality, n - 1, classification.structural_quality),
		avg_hidden_sharpness:    rollingMean(prev.avg_hidden_sharpness, n - 1, classification.hidden_sharpness),
		avg_emotional_bait:      rollingMean(prev.avg_emotional_bait, n - 1, classification.emotional_bait),
		avg_payout_realism:      rollingMean(prev.avg_payout_realism, n - 1, classification.payout_realism),
		avg_appeal_score:        rollingMean(prev.avg_appeal_score, n - 1, classification.appeal_score),
		avg_composite_score:     rollingMean(prev.avg_composite_score, n - 1, classification.composite_score),
	}
}

/**
 * upsertBettorProfileForSlip — main entry point.
 *
 * Called immediately after a slip is classified + stored. Idempotency is
 * the caller's responsibility — if you call this twice for the same slip,
 * the slip will count twice.
 *
 * @param {DatabaseSync} db
 * @param {Object} normalizedSlip — from normalizeIngestedSlip
 * @param {Object} classification — from classifyIngestedSlip
 * @returns {Object} { profile_id, updated, sample_count, archetype_dist }
 */
function upsertBettorProfileForSlip(db, normalizedSlip, classification) {
	if (!db || !normalizedSlip || !classification) {
		return { profile_id: null, updated: false, error: "missing required arg" }
	}

	const source_type = normalizedSlip.source_type || "unknown"
	const attribution = normalizedSlip.attribution || null
	const sport = normalizedSlip.sport || null
	const archetype = classification.archetype || "unknown"

	const profile_id = profileIdFor(source_type, attribution)
	const display_name = attribution || `${source_type}-anonymous`
	const nowIso = new Date().toISOString()

	// Read existing profile (if any) so we can merge
	const existing = db.prepare("SELECT * FROM bettor_profiles WHERE id = ?").get(profile_id)

	const prevArchetypeDist = _safeParseJson(existing?.archetype_dist, {})
	const prevSportFocus    = _safeParseJson(existing?.sport_focus, { sports: {} })
	const prevPreferences   = _safeParseJson(existing?.preference_signals, {})

	const archetypeDist = _mergeArchetypeDist(prevArchetypeDist, archetype)
	const sportFocus    = _mergeSportFocus(prevSportFocus, sport)
	const preferences   = _mergePreferenceSignals(prevPreferences, normalizedSlip, classification)

	const slip_count        = (existing?.slip_count || 0) + 1
	const classified_count  = (existing?.classified_count || 0) + (archetype !== "unknown" ? 1 : 0)
	const graded_count      = existing?.graded_count || 0  // Phase 2B will increment
	const first_seen        = existing?.first_seen || nowIso

	// INSERT OR REPLACE — bettor_profiles is keyed by id
	db.prepare(`
		INSERT OR REPLACE INTO bettor_profiles (
			id, display_name, source_type, sport_focus,
			slip_count, classified_count, graded_count,
			archetype_dist, preference_signals, outcome_stats,
			ecology_alignment, first_seen, last_updated, notes, raw_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		profile_id,
		display_name,
		source_type,
		JSON.stringify(sportFocus),
		slip_count,
		classified_count,
		graded_count,
		JSON.stringify(archetypeDist),
		JSON.stringify(preferences),
		existing?.outcome_stats || null,         // preserved — Phase 2B owns this
		existing?.ecology_alignment || null,
		first_seen,
		nowIso,
		existing?.notes || null,
		JSON.stringify({ last_classification_id: classification.id || null }),
		existing?.created_at || nowIso
	)

	return {
		profile_id,
		display_name,
		updated: true,
		slip_count,
		classified_count,
		sample_count: preferences.sample_count,
		archetype_dist: archetypeDist,
		sport_focus: sportFocus,
	}
}

/**
 * Read a bettor profile by source + attribution (or by profile_id).
 * Returns null if no profile exists yet.
 */
function getBettorProfile(db, { sourceType, attribution, profileId } = {}) {
	if (!db) return null
	const id = profileId || profileIdFor(sourceType, attribution)
	const row = db.prepare("SELECT * FROM bettor_profiles WHERE id = ?").get(id)
	if (!row) return null
	return {
		...row,
		sport_focus:        _safeParseJson(row.sport_focus, {}),
		archetype_dist:     _safeParseJson(row.archetype_dist, {}),
		preference_signals: _safeParseJson(row.preference_signals, {}),
		outcome_stats:      _safeParseJson(row.outcome_stats, {}),
		ecology_alignment:  _safeParseJson(row.ecology_alignment, {}),
		raw_json:           _safeParseJson(row.raw_json, {}),
	}
}

/**
 * Backfill: re-run the updater for every existing classified slip.
 * Useful for the initial population since the updater didn't exist when
 * the first slips were ingested. Idempotent per slip_id — multiple calls
 * inflate counts (caller manages dedup).
 */
function backfillFromExistingClassifications(db, { resetFirst = true } = {}) {
	if (!db) return { ok: false, error: "no db" }
	if (resetFirst) {
		db.prepare("DELETE FROM bettor_profiles").run()
	}

	const rows = db.prepare(`
		SELECT
			c.archetype, c.realism_score, c.structural_quality, c.correlation_quality,
			c.hidden_sharpness, c.emotional_bait, c.volatility_structure,
			c.payout_realism, c.exploit_potential, c.appeal_score, c.ecology_fit,
			c.composite_score, c.id AS classification_id,
			p.id AS slip_id, p.source_type, p.attribution, p.sport,
			p.combined_dec, p.legs_json
		FROM slip_classifications c
		JOIN parsed_slips p ON p.id = c.slip_id
		ORDER BY c.classified_at ASC
	`).all()

	const results = []
	for (const r of rows) {
		let legs = []
		try { legs = JSON.parse(r.legs_json || "[]") } catch (_) {}
		const normalizedSlip = {
			id: r.slip_id,
			source_type: r.source_type,
			attribution: r.attribution,
			sport: r.sport,
			combined_dec: r.combined_dec,
			_legs: legs,
		}
		const classification = {
			id: r.classification_id,
			archetype: r.archetype,
			realism_score: r.realism_score,
			structural_quality: r.structural_quality,
			correlation_quality: r.correlation_quality,
			hidden_sharpness: r.hidden_sharpness,
			emotional_bait: r.emotional_bait,
			volatility_structure: r.volatility_structure,
			payout_realism: r.payout_realism,
			exploit_potential: r.exploit_potential,
			appeal_score: r.appeal_score,
			ecology_fit: r.ecology_fit,
			composite_score: r.composite_score,
		}
		results.push(upsertBettorProfileForSlip(db, normalizedSlip, classification))
	}

	return { ok: true, processed: rows.length, profiles: results }
}

module.exports = {
	profileIdFor,
	upsertBettorProfileForSlip,
	getBettorProfile,
	backfillFromExistingClassifications,
}
