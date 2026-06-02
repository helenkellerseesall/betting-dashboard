"use strict"

/**
 * outcomeLinksPopulator.js — Phase Screenshot-Loop-Close-2B (2026-06-02)
 *
 * Nightly grader. For every ingested slip, links each leg to actual game
 * outcomes by matching against the engine's tracked_bets settled records.
 *
 * WHY this exists:
 *   Phase 2A (bettorProfilesUpdater) learns archetype distributions from
 *   classified slips — but never knows if those archetypes ACTUALLY WIN.
 *   Without grading, the engine can't differentiate "twitter lotto archetype
 *   that hits 8%" from "twitter lotto archetype that hits 25%".
 *
 * What it does:
 *   For each leg in each parsed_slip:
 *     1. Look up the matching tracked_bets record by (player, statFamily,
 *        side, line, slate_date) — case-insensitive, line-tolerant
 *     2. If found AND result is settled (win/loss/push):
 *        - Read actual_value from tracked_bets
 *        - hit = 1 if result==="win", 0 if loss, null if push
 *     3. Write outcome_links row per leg
 *     4. Compute slip_won = AND(all legs hit) — parlay logic
 *     5. After all legs settled, increment bettor_profile.graded_count +
 *        update outcome_stats per-archetype
 *
 * Match strategy (in priority order):
 *   1. Exact player + exact statFamily + exact side + exact line + slate_date
 *   2. Fuzzy player (normalized) + same statFamily/side/line/date
 *   3. (Future) game-log fallback when tracked_bets has no match
 *
 * Anti-fabrication:
 *   - Only writes outcome_links when a real tracked_bets match exists with
 *     settled result. Never synthesizes hit/miss from "feels like" data.
 *   - Leaves leg ungraded (no outcome_links row) if no match — better to
 *     learn from 30% of legs than fake the other 70%.
 *   - Push results recorded as hit=null (preserves push semantic)
 *
 * Idempotency:
 *   - DELETE existing outcome_links rows for slip_id before INSERT (full
 *     re-grade, captures cases where a result was updated post-initial-grade)
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { currentSlateDateEt, slateDateForTimestamp } = require("../shared/slateDate")

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

function safeReadJsonArray(p) {
	try {
		if (!fs.existsSync(p)) return null
		const d = JSON.parse(fs.readFileSync(p, "utf8"))
		return Array.isArray(d) ? d : (Array.isArray(d?.entries) ? d.entries : null)
	} catch (_) { return null }
}

function normPlayer(s) {
	return String(s || "").trim().toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ")
}

function normStatFamily(s) {
	const v = String(s || "").trim().toLowerCase()
	// Common aliases: "Home Runs" -> "hr", "Total Bases" -> "totalBases", "RBIs" -> "rbis"
	const alias = {
		"home runs": "hr", "homeruns": "hr", "home_runs": "hr",
		"total bases": "totalBases", "total_bases": "totalBases", "totalbases": "totalBases",
		"rbis": "rbis", "rbi": "rbis",
		"hits": "hits", "runs": "runs", "outs": "outs", "ks": "ks", "strikeouts": "ks",
		"points": "points", "rebounds": "rebounds", "assists": "assists",
		"threes": "threes", "3pt": "threes", "3-pointers": "threes",
		"steals": "steals", "blocks": "blocks",
		"pra": "pra", "points_rebounds_assists": "pra",
		"points_rebounds": "points_rebounds", "pr": "points_rebounds",
		"points_assists": "points_assists", "pa": "points_assists",
		"rebounds_assists": "rebounds_assists", "ra": "rebounds_assists",
	}
	return alias[v] || v
}

function normSide(s) {
	const v = String(s || "").trim().toLowerCase()
	if (v === "o" || v === "over") return "over"
	if (v === "u" || v === "under") return "under"
	return v
}

/**
 * Find a settled tracked_bets entry matching the given leg.
 * Returns the matched entry (with actual_value + result) or null.
 */
function findMatchingTrackedBet(leg, slateDate, indices) {
	if (!leg) return null
	const player = normPlayer(leg.player)
	const stat = normStatFamily(leg.statFamily)
	const side = normSide(leg.side)
	const line = Number(leg.line)
	if (!player || !stat || !side || !Number.isFinite(line)) return null

	// Try BOTH sport indices (slip may be either)
	for (const sport of ["nba", "mlb"]) {
		const key = `${slateDate}|${sport}`
		const ix = indices[key]
		if (!ix) continue
		const matchKey = `${player}|${stat}|${side}|${line}`
		const candidates = ix.byKey.get(matchKey) || []
		for (const c of candidates) {
			if (c.result && c.result !== "pending" && c.result !== "unknown") return { ...c, sport }
		}
	}

	return null
}

/**
 * Build an index of all tracked_bets entries for a slate, keyed by
 * (player|statFamily|side|line). One slate = up to ~2000 entries; index
 * makes per-leg lookup O(1).
 */
function buildTrackedBetsIndex(slateDate, sport) {
	const file = path.join(TRACKING_DIR, `${sport}_tracked_bets_${slateDate}.json`)
	const entries = safeReadJsonArray(file)
	if (!entries) return null
	const byKey = new Map()
	for (const e of entries) {
		const player = normPlayer(e.player)
		const stat = normStatFamily(e.statFamily || e.propType)
		const side = normSide(e.side)
		const line = Number(e.line)
		if (!player || !stat || !side || !Number.isFinite(line)) continue
		const key = `${player}|${stat}|${side}|${line}`
		if (!byKey.has(key)) byKey.set(key, [])
		byKey.get(key).push(e)
	}
	return { byKey, count: entries.length }
}

/**
 * Grade a single slip — find outcomes for each leg, write outcome_links rows.
 * Returns { gradedLegs, totalLegs, slipWon, allGraded }
 */
function gradeSlip(db, slip, indices, classification = null) {
	let legs = []
	try { legs = JSON.parse(slip.legs_json || "[]") } catch (_) {}

	const slateDate = slip.slate_date || currentSlateDateEt()
	const nowIso = new Date().toISOString()

	// Delete existing outcome_links for this slip (idempotent re-grade)
	db.prepare("DELETE FROM outcome_links WHERE slip_id = ?").run(slip.id)

	const insertLink = db.prepare(`
		INSERT INTO outcome_links (
			id, slip_id, leg_index, player, stat_family, side, line,
			slate_date, actual_value, hit, slip_won, source, settled_at,
			notes, raw_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)

	let gradedLegs = 0
	const legResults = []  // for parlay-won computation

	for (let i = 0; i < legs.length; i++) {
		const leg = legs[i]
		const match = findMatchingTrackedBet(leg, slateDate, indices)
		const legId = "ol_" + crypto.createHash("sha256")
			.update(`${slip.id}|${i}|${slateDate}`)
			.digest("hex").slice(0, 16)

		let actual_value = null
		let hit = null
		let source = "no_match"
		let settled_at = null
		let notes = null

		if (match) {
			actual_value = Number.isFinite(Number(match.actualValue)) ? Number(match.actualValue) : null
			if (match.result === "win") hit = 1
			else if (match.result === "loss") hit = 0
			else if (match.result === "push") { hit = null; notes = "push" }
			source = `tracked_bets_${match.sport || "?"}_match`
			settled_at = match.settledAt || nowIso
			gradedLegs++
			legResults.push(hit)
		} else {
			source = "ungraded_no_engine_match"
			legResults.push(null)  // unknown
		}

		insertLink.run(
			legId, slip.id, i,
			leg.player || null, normStatFamily(leg.statFamily), normSide(leg.side), Number(leg.line) || null,
			slateDate, actual_value, hit,
			null,  // slip_won — computed below and applied to first leg only
			source, settled_at, notes,
			JSON.stringify({ leg_raw: leg, match: match || null }),
			nowIso
		)
	}

	// slip_won: 1 only if ALL legs settled AND all hit. null if any leg ungraded or push.
	const totalLegs = legs.length
	const allHit = legResults.every(r => r === 1)
	const anyUngraded = legResults.some(r => r === null) || gradedLegs < totalLegs
	let slipWon = null
	if (!anyUngraded) slipWon = allHit ? 1 : 0

	// Update slip_won on the FIRST leg's outcome_links row (representative)
	if (slipWon !== null && totalLegs > 0) {
		db.prepare("UPDATE outcome_links SET slip_won = ? WHERE slip_id = ? AND leg_index = 0").run(slipWon, slip.id)
	}

	return { gradedLegs, totalLegs, slipWon, allGraded: !anyUngraded }
}

/**
 * Main entry — grade all slips, optionally filtered by date range.
 * Returns summary.
 */
function gradeAllUngraded(db, { dateFrom = null, dateTo = null } = {}) {
	if (!db) return { ok: false, error: "no db" }

	// Discover slates we need to load
	const slips = db.prepare(`
		SELECT id, slate_date, sport, source_type, attribution, combined_dec, legs_json, raw_json
		FROM parsed_slips
		WHERE ${dateFrom ? "slate_date >= ?" : "1=1"}
		  AND ${dateTo   ? "slate_date <= ?" : "1=1"}
		ORDER BY slate_date ASC
	`).all(...[dateFrom, dateTo].filter(Boolean))

	if (slips.length === 0) {
		return { ok: true, slipsProcessed: 0, message: "no slips to grade" }
	}

	// Pre-build all needed indices (one per slate_date × sport)
	const indices = {}
	const slateDates = [...new Set(slips.map(s => s.slate_date).filter(Boolean))]
	for (const d of slateDates) {
		for (const sport of ["nba", "mlb"]) {
			const ix = buildTrackedBetsIndex(d, sport)
			if (ix) indices[`${d}|${sport}`] = ix
		}
	}

	let totalSlips = 0
	let fullyGradedSlips = 0
	let totalLegs = 0
	let gradedLegs = 0
	const slipResults = []

	for (const slip of slips) {
		const result = gradeSlip(db, slip, indices)
		totalSlips++
		totalLegs += result.totalLegs
		gradedLegs += result.gradedLegs
		if (result.allGraded) fullyGradedSlips++
		slipResults.push({ slip_id: slip.id, ...result })
	}

	return {
		ok: true,
		slipsProcessed: totalSlips,
		fullyGradedSlips,
		legCoverage: totalLegs > 0 ? gradedLegs / totalLegs : 0,
		totalLegs,
		gradedLegs,
		slateIndicesLoaded: Object.keys(indices).length,
		slateIndicesIndex: Object.keys(indices),
		slipResults: slipResults.slice(0, 20),  // first 20 for diagnostic
	}
}

/**
 * After grading, refresh bettor_profiles.graded_count + outcome_stats
 * (per-archetype hit rates).
 */
function refreshBettorProfileOutcomeStats(db) {
	if (!db) return { ok: false }

	// Group settled outcomes by source_type + attribution + archetype
	const rows = db.prepare(`
		SELECT
			p.source_type, p.attribution,
			c.archetype,
			ol.slip_id, ol.slip_won
		FROM outcome_links ol
		JOIN parsed_slips p ON p.id = ol.slip_id
		JOIN slip_classifications c ON c.slip_id = ol.slip_id
		WHERE ol.slip_won IS NOT NULL AND ol.leg_index = 0
	`).all()

	const byProfile = {}
	for (const r of rows) {
		const key = `${r.source_type}|${(r.attribution || "anonymous").toLowerCase().trim()}`
		const profile = byProfile[key] || (byProfile[key] = { source_type: r.source_type, attribution: r.attribution, graded_count: 0, by_archetype: {} })
		profile.graded_count += 1
		const a = profile.by_archetype[r.archetype] || (profile.by_archetype[r.archetype] = { n: 0, won: 0 })
		a.n += 1
		if (r.slip_won === 1) a.won += 1
	}

	const { profileIdFor } = require("./bettorProfilesUpdater")
	let updated = 0
	for (const [_, profile] of Object.entries(byProfile)) {
		const id = profileIdFor(profile.source_type, profile.attribution)
		const outcomeStats = {
			by_archetype: profile.by_archetype,
			overall_hit_rate: profile.graded_count > 0
				? Object.values(profile.by_archetype).reduce((a, b) => a + b.won, 0) / profile.graded_count
				: null,
			sample_count: profile.graded_count,
			last_refreshed: new Date().toISOString(),
		}
		const result = db.prepare(`
			UPDATE bettor_profiles
			SET graded_count = ?, outcome_stats = ?, last_updated = ?
			WHERE id = ?
		`).run(profile.graded_count, JSON.stringify(outcomeStats), new Date().toISOString(), id)
		if (result.changes > 0) updated++
	}

	return { ok: true, profilesUpdated: updated, totalProfilesWithGradedSlips: Object.keys(byProfile).length }
}

module.exports = {
	gradeAllUngraded,
	gradeSlip,
	refreshBettorProfileOutcomeStats,
	buildTrackedBetsIndex,
	findMatchingTrackedBet,
	normPlayer,
	normStatFamily,
	normSide,
}
