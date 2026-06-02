"use strict"

/**
 * addPlacedBet.js — manually record a placed bet to personal_ledger.
 *
 * Use after placing a real bet on a sportsbook. Distinguishes from
 * model-tracked picks via decisionType="placed" so the GRADES tab can
 * filter for real-money tracking only.
 *
 * Two modes:
 *
 *   SINGLE LEG:
 *     node backend/scripts/addPlacedBet.js single \
 *       --sport=nba --player="Victor Wembanyama" --stat=rebounds \
 *       --line=12.5 --side=under --odds=-110 --book=fanduel --stake=5
 *
 *   PARLAY (multiple legs as a single entry):
 *     node backend/scripts/addPlacedBet.js parlay --stake=5 --odds=656 --book=fanduel \
 *       --leg="Shai Gilgeous-Alexander|rebounds|3.5|under" \
 *       --leg="Victor Wembanyama|rebounds|12.5|under" \
 *       --leg="Alex Caruso|points_rebounds_assists|17.5|under"
 *
 * Writes to backend/runtime/tracking/personal_ledger.json.
 */

const path = require("path")
const { addOrUpdateBet } = require("../pipeline/shared/buildPersonalLedger")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

function parseArgs(argv) {
	const mode = argv[2]
	const out = { mode, legs: [], opts: {} }
	for (const a of argv.slice(3)) {
		if (a.startsWith("--leg=")) {
			const parts = a.slice(6).split("|")
			if (parts.length < 4) throw new Error(`--leg must be player|statFamily|line|side, got ${a}`)
			out.legs.push({
				player: parts[0].trim(),
				statFamily: parts[1].trim(),
				line: Number(parts[2]),
				side: parts[3].trim().toLowerCase(),
			})
		} else if (a.startsWith("--")) {
			const eq = a.indexOf("=")
			if (eq < 2) continue
			out.opts[a.slice(2, eq)] = a.slice(eq + 1)
		}
	}
	return out
}

function americanOddsToImpliedProb(odds) {
	const n = Number(odds)
	if (!Number.isFinite(n) || n === 0) return null
	if (n > 0) return 100 / (n + 100)
	return Math.abs(n) / (Math.abs(n) + 100)
}

function americanOddsToPayoutMultiple(odds) {
	const n = Number(odds)
	if (!Number.isFinite(n) || n === 0) return null
	if (n > 0) return n / 100
	return 100 / Math.abs(n)
}

function makeSingleLeg(args) {
	const o = args.opts
	const stake = Number(o.stake)
	const odds = Number(o.odds)
	const player = o.player
	if (!player || !stake || !odds) {
		console.error("[addPlacedBet] single requires --player, --stake, --odds")
		process.exit(1)
	}
	// Phase Date-Doctrine-1B — canonical ET slate date
	const today = currentSlateDateEt()
	const bet = {
		date: today,
		sport: o.sport || "nba",
		sportsbook: o.book || "unknown",
		betType: "single",
		player,
		matchup: o.matchup || null,
		statFamily: o.stat || "?",
		prop: `${o.stat} ${o.side} ${o.line}`,
		side: (o.side || "over").toLowerCase(),
		line: Number(o.line),
		odds,
		stake,
		toWin: Number((stake * americanOddsToPayoutMultiple(odds)).toFixed(2)),
		impliedProb: americanOddsToImpliedProb(odds),
		decisionType: "placed",      // distinguishes real-money from auto-tracked
		realMoney: true,             // explicit flag for GRADES filter
		placedAt: new Date().toISOString(),
		result: "pending",
		settledAt: null,
		payout: null,
	}
	return [bet]
}

function makeParlay(args) {
	const o = args.opts
	const stake = Number(o.stake)
	const odds = Number(o.odds)
	if (!args.legs.length || !stake || !odds) {
		console.error("[addPlacedBet] parlay requires --stake, --odds, and ≥2 --leg=player|stat|line|side")
		process.exit(1)
	}
	// Phase Date-Doctrine-1B — canonical ET slate date
	const today = currentSlateDateEt()
	const toWin = Number((stake * americanOddsToPayoutMultiple(odds)).toFixed(2))
	const legSummary = args.legs.map((l) => `${l.player.split(" ").slice(-1)[0]} ${l.side} ${l.line} ${l.statFamily}`).join(" + ")
	const parlay = {
		id: `placed_parlay_${Date.now()}`,
		date: today,
		sport: o.sport || "nba",
		sportsbook: o.book || "unknown",
		betType: "parlay",
		player: "PARLAY",
		matchup: o.matchup || null,
		statFamily: "parlay",
		prop: legSummary,
		side: "parlay",
		line: null,
		odds,
		stake,
		toWin,
		impliedProb: americanOddsToImpliedProb(odds),
		decisionType: "placed",
		realMoney: true,
		placedAt: new Date().toISOString(),
		legs: args.legs.map((l) => ({
			...l,
			result: "pending",
			settledAt: null,
		})),
		result: "pending",
		settledAt: null,
		payout: null,
		notes: o.notes || null,
	}
	return [parlay]
}

async function main() {
	const args = parseArgs(process.argv)
	if (!args.mode || (args.mode !== "single" && args.mode !== "parlay")) {
		console.error("Usage: node backend/scripts/addPlacedBet.js (single|parlay) [options]")
		process.exit(1)
	}
	const bets = args.mode === "single" ? makeSingleLeg(args) : makeParlay(args)
	for (const b of bets) {
		const r = addOrUpdateBet(b)
		console.log("[addPlacedBet] added:", b.betType, b.player || b.prop)
		console.log("  id:        ", b.id)
		console.log("  stake:     ", `$${b.stake}`)
		console.log("  odds:      ", b.odds > 0 ? `+${b.odds}` : b.odds)
		console.log("  toWin:     ", `$${b.toWin}`)
		console.log("  decisionType:", b.decisionType, "(realMoney:", b.realMoney, ")")
		if (b.legs) {
			console.log("  legs:")
			for (const l of b.legs) console.log(`    - ${l.player} ${l.statFamily} ${l.side} ${l.line}`)
		}
	}
}

main().catch((e) => { console.error("[addPlacedBet] fatal:", e?.message || e); process.exit(1) })
