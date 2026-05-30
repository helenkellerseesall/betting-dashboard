"use strict"

/**
 * deriveNbaDvP.js — 2026-05-30
 *
 * Defense-vs-position cache derived from already-fetched ESPN game logs.
 * No new endpoints, no scraping — uses only:
 *   data/nbaPlayerGameLogs.json   (per-player game-by-game stats + opponent)
 *   data/nbaPlayerProjections.json (per-player role: guard/wing/big)
 *
 * For each team Y, for each role R, averages the per-game stats produced by
 * players of role R who played AGAINST team Y. Output:
 *
 *   data/nbaDvP.json:
 *   {
 *     "Oklahoma City Thunder": {
 *       guard: { points: {mean, gp}, rebounds: {...}, assists, threes, steals, blocks },
 *       wing:  { ... },
 *       big:   { ... },
 *     },
 *     ...
 *   }
 *
 * Consumers (wired in this PR):
 *   - nbaTeamStatsCache.enrichRowWithTeamStats → augment row.oppDef with
 *     role-specific points-allowed when the matchup's defender role aligns
 *     with the bettor's player role.
 *   - buildNbaDefensiveProps → opp TOV rate not in DvP yet, but DvP-by-role
 *     ALLOWED steals/blocks helps scale ranges by matchup.
 *
 * Run:
 *   node backend/scripts/deriveNbaDvP.js > .scratch/last.txt 2>&1
 *
 * Idempotent. Overwrites mlbDvP.json on each run.
 */

const fs = require("fs")
const path = require("path")

const GAME_LOGS = path.join(__dirname, "..", "data", "nbaPlayerGameLogs.json")
const PROJECTIONS = path.join(__dirname, "..", "data", "nbaPlayerProjections.json")
const OUT_PATH = path.join(__dirname, "..", "data", "nbaDvP.json")

const STATS = ["points", "rebounds", "assists", "threes", "steals", "blocks"]
const ROLES = ["guard", "wing", "big"]

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
function normName(s) { return String(s || "").trim().toLowerCase() }

function loadJson(p) {
	if (!fs.existsSync(p)) return null
	return JSON.parse(fs.readFileSync(p, "utf8"))
}

function classifyRole(projRole) {
	const r = String(projRole || "").toLowerCase().trim()
	if (!r) return null
	if (r === "guard" || r === "pg" || r === "sg" || r === "point guard" || r === "shooting guard") return "guard"
	if (r === "big" || r === "c" || r === "pf" || r === "center" || r === "power forward") return "big"
	if (r === "wing" || r === "sf" || r === "small forward") return "wing"
	return null
}

/**
 * Stats-based role fallback when projections don't list the player. Uses
 * the player's own L12 averages from the game logs.
 *   bigs: high rebounds, low threes
 *   guards: high assists, more threes
 *   wings: in between
 */
function classifyRoleFromStats(games) {
	if (!Array.isArray(games) || !games.length) return null
	let reb = 0, ast = 0, threes = 0, blk = 0, count = 0
	for (const g of games) {
		const s = g?.stats || {}
		const r = Number(s.rebounds); const a = Number(s.assists)
		const t = Number(s.threes);  const b = Number(s.blocks)
		if (Number.isFinite(r) && Number.isFinite(a) && Number.isFinite(t)) {
			reb += r; ast += a; threes += t; blk += (Number.isFinite(b) ? b : 0); count += 1
		}
	}
	if (count < 3) return null
	const avgReb = reb / count
	const avgAst = ast / count
	const avgThrees = threes / count
	const avgBlk = blk / count
	// Big signal: high rebounds + low threes + (often) shot-blocking
	if (avgReb >= 7 && avgThrees <= 1.5) return "big"
	if (avgBlk >= 1.2 && avgReb >= 6) return "big"
	// Guard signal: high assists, more threes, lower rebounds
	if (avgAst >= 4.5 || (avgThrees >= 2.0 && avgReb < 5)) return "guard"
	return "wing"
}

function main() {
	const logs = loadJson(GAME_LOGS)
	const proj = loadJson(PROJECTIONS)
	if (!logs?.players || !proj?.players) {
		console.error("[deriveDvP] missing data files")
		process.exit(1)
	}

	// Build role index — projections first (canonical when present), then fall
	// back to stats-derived classifier for players the projection file doesn't
	// cover. Projection file is only 56 players; game logs have ~130 players.
	const roleByPlayer = {}
	for (const [name, entry] of Object.entries(proj.players)) {
		const r = classifyRole(entry?.role)
		if (r) roleByPlayer[normName(name)] = r
	}
	let projCovered = Object.keys(roleByPlayer).length
	let derivedFallback = 0
	for (const [name, entry] of Object.entries(logs.players)) {
		const key = normName(name)
		if (roleByPlayer[key]) continue
		const r = classifyRoleFromStats(entry?.games)
		if (r) { roleByPlayer[key] = r; derivedFallback += 1 }
	}
	console.log(`[deriveDvP] role index: ${projCovered} from projections + ${derivedFallback} derived from stats = ${Object.keys(roleByPlayer).length} total`)

	// Aggregate: per opponent team, per role, sum + count per stat
	// agg[opp][role][stat] = { sum, count }
	const agg = {}
	let totalGames = 0
	let unmappedRole = 0
	for (const [playerName, entry] of Object.entries(logs.players)) {
		const role = roleByPlayer[normName(playerName)]
		if (!role) { unmappedRole += 1; continue }
		const games = Array.isArray(entry?.games) ? entry.games : []
		for (const g of games) {
			const opp = String(g?.opponent || "").trim()
			if (!opp) continue
			const stats = g?.stats || {}
			if (!agg[opp]) agg[opp] = {}
			if (!agg[opp][role]) agg[opp][role] = {}
			for (const s of STATS) {
				const v = toNum(stats[s])
				if (v == null) continue
				if (!agg[opp][role][s]) agg[opp][role][s] = { sum: 0, count: 0 }
				agg[opp][role][s].sum += v
				agg[opp][role][s].count += 1
			}
			totalGames += 1
		}
	}

	console.log(`[deriveDvP] aggregated ${totalGames} player-games`)
	console.log(`[deriveDvP] players without role mapping: ${unmappedRole}`)

	// Convert sums to means
	const out = {}
	for (const opp of Object.keys(agg)) {
		out[opp] = {}
		for (const role of ROLES) {
			const r = agg[opp][role]
			if (!r) continue
			const roleObj = {}
			for (const s of STATS) {
				if (!r[s]) continue
				roleObj[s] = {
					mean: Number((r[s].sum / r[s].count).toFixed(2)),
					gp: r[s].count,
				}
			}
			if (Object.keys(roleObj).length) out[opp][role] = roleObj
		}
	}

	// Quality: drop opponent-role buckets with <2 games (small sample). Keep
	// the bucket if MOST stats meet the threshold — partial coverage is still
	// useful, beats falling back to team-average defensive rating.
	const MIN_GP = 2
	const filtered = {}
	for (const opp of Object.keys(out)) {
		const keep = {}
		for (const role of ROLES) {
			const r = out[opp][role]
			if (!r) continue
			const okStats = {}
			for (const [s, v] of Object.entries(r)) {
				if (v.gp >= MIN_GP) okStats[s] = v
			}
			if (Object.keys(okStats).length) keep[role] = okStats
		}
		if (Object.keys(keep).length) filtered[opp] = keep
	}

	const meta = {
		generatedAt: new Date().toISOString(),
		teams: Object.keys(filtered).length,
		totalPlayerGames: totalGames,
		minGpPerRoleStat: MIN_GP,
		source: "derived_from_nbaPlayerGameLogs_+_nbaPlayerProjections",
	}

	const payload = { _meta: meta, teams: filtered }
	fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2))

	console.log(`\n[deriveDvP] team-DvP entries: ${Object.keys(filtered).length}`)
	// Sample output — Oklahoma City Thunder (Game 7 opponent)
	const sampleTeam = "Oklahoma City Thunder"
	if (filtered[sampleTeam]) {
		console.log(`\n[deriveDvP] sample — ${sampleTeam}:`)
		for (const role of ROLES) {
			if (filtered[sampleTeam][role]) {
				console.log(`  ${role}:`, JSON.stringify(filtered[sampleTeam][role]))
			}
		}
	}

	// Top 5 worst defensive teams vs guards (points-allowed)
	console.log("\n[deriveDvP] top 5 worst defenses vs guards (most points allowed):")
	const ranked = []
	for (const [opp, r] of Object.entries(filtered)) {
		if (r.guard?.points?.mean != null) ranked.push({ opp, ppg: r.guard.points.mean, gp: r.guard.points.gp })
	}
	ranked.sort((a, b) => b.ppg - a.ppg)
	for (const r of ranked.slice(0, 5)) console.log(`  ${r.opp.padEnd(28)} ${r.ppg} ppg vs guards (${r.gp} games)`)

	console.log(`\n[deriveDvP] wrote ${OUT_PATH}`)
}

main()
