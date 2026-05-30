"use strict"

/**
 * deriveMlbStatcastPower.js — 2026-05-30
 *
 * Replaces the 9-hardcoded-player mlbStatcastPower.json (Apr 25 static) with a
 * computed powerScore for every batter in mlbBatterStats.json (~388 entries).
 *
 * The HR engine (buildMlbHrPredictionCandidates.js) looks up by
 * normalizeName(row.player) → reads powerScore. Pre-tonight, 379 of 388
 * batters had no entry and fell back to computeFallbackPowerScore (generic
 * formula off raw market data). Now every roster batter gets a real
 * iso/hrRate-driven powerScore.
 *
 *   node backend/scripts/deriveMlbStatcastPower.js > .scratch/last.txt 2>&1
 *
 * Persists to backend/data/mlbStatcastPower.json. Idempotent — re-running
 * overwrites with the latest derivation.
 *
 * --- Formula calibration ---
 * Existing hardcoded scores (Apr 25): Judge 48, Ohtani 47, Alvarez 48,
 * Schwarber 45, Acuña 45, Olson 46, Alonso 46, Vlad Jr. 44, Seager 43.
 * League-average batter: iso ≈ 0.140, hrRate ≈ 0.035 → target ~36.
 *
 *   powerScore = 36 + (iso - 0.140) * 40 + (hrRate - 0.035) * 150
 *
 * Clamped to [25, 58] to prevent small-sample outliers (low-PA call-ups
 * with one HR in 4 ABs would otherwise show as ~70).
 */

const fs = require("fs")
const path = require("path")

const BATTER_CACHE = path.join(__dirname, "..", "data", "mlbBatterStats.json")
const POWER_CACHE  = path.join(__dirname, "..", "data", "mlbStatcastPower.json")

const ISO_BASELINE  = 0.140
const HR_BASELINE   = 0.035
const POWER_BASELINE = 36
const ISO_WEIGHT    = 40
const HR_WEIGHT     = 150
const MIN_POWER     = 25
const MAX_POWER     = 58
const MIN_PA_FOR_RELIABLE = 30  // require at least 30 PA before we trust the rates

function clamp(lo, hi, x) { return Math.max(lo, Math.min(hi, x)) }

function derivePowerScore(stats) {
	const iso = Number(stats?.iso)
	const hr  = Number(stats?.hrRate)
	const pa  = Number(stats?.plateAppearances)
	if (!Number.isFinite(iso) || !Number.isFinite(hr)) return null
	if (!Number.isFinite(pa) || pa < MIN_PA_FOR_RELIABLE) {
		// Low-sample batter — anchor to league baseline + half-credit the deltas
		// so a small-sample slugger doesn't get an inflated power score.
		const score = POWER_BASELINE + (iso - ISO_BASELINE) * ISO_WEIGHT * 0.5 + (hr - HR_BASELINE) * HR_WEIGHT * 0.5
		return Math.round(clamp(MIN_POWER, MAX_POWER, score))
	}
	const score = POWER_BASELINE + (iso - ISO_BASELINE) * ISO_WEIGHT + (hr - HR_BASELINE) * HR_WEIGHT
	return Math.round(clamp(MIN_POWER, MAX_POWER, score))
}

function main() {
	if (!fs.existsSync(BATTER_CACHE)) {
		console.error("[derive-power] missing batter cache:", BATTER_CACHE)
		process.exit(1)
	}
	const batters = JSON.parse(fs.readFileSync(BATTER_CACHE, "utf8"))
	const keys = Object.keys(batters)
	console.log(`[derive-power] read batter cache: ${keys.length} batters`)

	const out = {}
	const histogram = {}
	let lowSample = 0
	let skipped = 0
	for (const k of keys) {
		const entry = batters[k]
		const score = derivePowerScore(entry)
		if (score == null) { skipped += 1; continue }
		const pa = Number(entry?.plateAppearances)
		if (Number.isFinite(pa) && pa < MIN_PA_FOR_RELIABLE) lowSample += 1
		// Keyed by normalized lowercase name to match the HR engine's lookup.
		out[k] = {
			avgExitVelocity: null,        // not derivable from season aggregates
			powerScore: score,
			plateAppearances: entry.plateAppearances,
			iso: entry.iso,
			hrRate: entry.hrRate,
			source: "derived_from_batter_cache_iso_hr",
			derivedAt: new Date().toISOString(),
		}
		const bucket = Math.floor(score / 5) * 5
		histogram[bucket] = (histogram[bucket] || 0) + 1
	}

	// Sort histogram for readable output
	const sortedHist = Object.keys(histogram).sort((a, b) => Number(a) - Number(b))
		.map((b) => `[${b}-${Number(b)+4}]:${histogram[b]}`)
		.join("  ")

	// Persist
	fs.writeFileSync(POWER_CACHE, JSON.stringify(out, null, 2))

	console.log(`[derive-power] derived powerScore for ${Object.keys(out).length} batters`)
	console.log(`[derive-power] low-sample (<${MIN_PA_FOR_RELIABLE} PA, half-credit): ${lowSample}`)
	console.log(`[derive-power] skipped (no iso/hrRate): ${skipped}`)
	console.log(`[derive-power] histogram (powerScore buckets): ${sortedHist}`)

	// Show top 10 + bottom 5 to sanity-check the formula
	const sorted = Object.entries(out).sort((a, b) => b[1].powerScore - a[1].powerScore)
	console.log("\n[derive-power] top 10 powerScore:")
	for (const [k, v] of sorted.slice(0, 10)) {
		console.log(`  ${k.padEnd(28)}  powerScore=${v.powerScore}  iso=${v.iso}  hrRate=${v.hrRate}  pa=${v.plateAppearances}`)
	}
	console.log("\n[derive-power] bottom 5 powerScore:")
	for (const [k, v] of sorted.slice(-5)) {
		console.log(`  ${k.padEnd(28)}  powerScore=${v.powerScore}  iso=${v.iso}  hrRate=${v.hrRate}  pa=${v.plateAppearances}`)
	}

	console.log(`\n[derive-power] wrote ${POWER_CACHE}`)
}

main()
