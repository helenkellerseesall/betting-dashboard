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
 *   SINGLE LEG (--sport / --book / --stat / --side / --line all REQUIRED + validated):
 *     node backend/scripts/addPlacedBet.js single \
 *       --sport=mlb --player="Juan Soto" --stat=totalBases \
 *       --line=1.5 --side=over --odds=-115 --book=fanduel --stake=5
 *
 *   PARLAY (multiple legs as a single entry):
 *     node backend/scripts/addPlacedBet.js parlay --sport=mlb --stake=5 --odds=656 --book=fanduel \
 *       --leg="Juan Soto|totalBases|1.5|over" \
 *       --leg="Aaron Judge|hits|1.5|over"
 *
 *   Add --dry-run to preview the exact row (incl. tuple stamps) without writing.
 *
 * 2026-07-05 SPINE-FIX 1 (GRADING_RULES.md §9): --sport is REQUIRED (the old
 * silent nba default made MLB bets unsettleable); --stat validated against the
 * canonical MLB tokens; --book validated + canonicalized to the tracked-row
 * display string; on add, the bet's tuple is looked up in today's tracked board
 * picks and the ledger row auto-stamped with calibVersion / modelProb /
 * modelProbRaw / selectionPolicy when matched; a LOUD warning fires when no
 * tuple match (bet will not auto-settle — manual settle via settlePlacedBet.js).
 *
 * Writes to backend/runtime/tracking/personal_ledger.json.
 */

const fs = require("fs")
const path = require("path")
const { addOrUpdateBet, stableId } = require("../pipeline/shared/buildPersonalLedger")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

// ── 2026-07-05 SPINE-FIX 1 (GRADING_RULES.md §9 — the v1 placement contract) ──
// A placed bet auto-settles + auto-CLVs ONLY when its tuple exactly matches a
// tracked row. Silent defaults broke that: --sport defaulted to "nba" (an MLB
// bet recorded as nba NEVER settles), --stat/"?" and free-text --book produced
// tuples nothing matches. All three are now validated LOUDLY at add time.
const VALID_SPORTS = ["mlb", "nba"]
// Canonical MLB statFamily tokens — must match tracked_bets rows byte-exactly
// (verified against runtime/tracking/mlb_tracked_bets_2026-07-05.json).
const MLB_STAT_TOKENS = ["runs", "hr", "hits", "ks", "rbis", "totalBases"]
// Known books → the canonical display string tracked rows carry (sportsbook
// field, verified same file: "FanDuel"/"DraftKings"/"Fanatics"/"Hard Rock Bet").
const KNOWN_BOOKS = {
	fanduel: "FanDuel",
	draftkings: "DraftKings",
	fanatics: "Fanatics",
	betmgm: "BetMGM",
	hardrock: "Hard Rock Bet",
	hardrockbet: "Hard Rock Bet",
	betrivers: "BetRivers",
}
function canonBook(input) {
	const k = String(input || "").toLowerCase().replace(/[^a-z]/g, "")
	return KNOWN_BOOKS[k] || null
}
function canonMlbStat(input) {
	const want = String(input || "").toLowerCase()
	return MLB_STAT_TOKENS.find((t) => t.toLowerCase() === want) || null
}
function reject(msg) {
	console.error(`[addPlacedBet] REJECTED: ${msg}`)
	process.exit(1)
}

// Tuple lookup against today's tracked board picks (mlb_tracked_bets_<slate>.json —
// written from the calibrated board every slate run). On a hit we auto-stamp the
// ledger row with the pick's version stamps (GRADING_RULES §7: history is
// interpreted by its stamps). Absence of a stamp on the tracked row = raw era —
// we stamp only what exists, never invent (anti-fabrication).
function lookupTrackedPick({ sport, date, player, statFamily, side, line, sportsbook }) {
	if (sport !== "mlb") return null
	const p = path.join(__dirname, "..", "runtime", "tracking", `mlb_tracked_bets_${date}.json`)
	let rows = []
	try { if (fs.existsSync(p)) rows = JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { rows = [] }
	if (!Array.isArray(rows)) return null
	const normP = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
	const hit = rows.find((t) =>
		t &&
		normP(t.player) === normP(player) &&
		String(t.statFamily) === String(statFamily) &&
		String(t.side || "").toLowerCase() === String(side || "").toLowerCase() &&
		Number(t.line) === Number(line) &&
		String(t.sportsbook || "").toLowerCase() === String(sportsbook || "").toLowerCase()
	)
	return hit || null
}

function stampFromTracked(bet, t) {
	if (!t) return false
	// Stamp ONLY fields that exist on the tracked pick — never invent.
	if (t.calibVersion != null) bet.calibVersion = t.calibVersion
	if (Number.isFinite(Number(t.modelProb))) bet.modelProb = Number(t.modelProb)
	if (t.modelProbRaw != null) bet.modelProbRaw = t.modelProbRaw
	const policy = t.selectionPolicy ?? t.tierPolicy ?? null
	if (policy != null) bet.selectionPolicy = policy
	if (t.tier != null) bet.tier = t.tier
	if (t.id != null) bet.matchedTrackedId = t.id
	return true
}

function warnNoTupleMatch(bet) {
	console.warn("")
	console.warn("  ⚠⚠⚠ NO TUPLE MATCH in today's tracked board picks ⚠⚠⚠")
	console.warn(`  (${bet.player} | ${bet.statFamily} | ${bet.side} | ${bet.line} | ${bet.sportsbook} | ${bet.date})`)
	console.warn("  This bet will NOT auto-settle and will NOT get auto-CLV (GRADING_RULES.md §9).")
	console.warn("  Check player spelling / stat / side / line / book against the board pick,")
	console.warn("  or settle it manually later: node backend/scripts/settlePlacedBet.js --list")
	console.warn("")
}

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

// 2026-07-05 SPINE-FIX 1 — shared validation for both modes. Kills the silent
// nba default (--sport now REQUIRED) and free-text books. Rejections list the
// valid values so the operator can fix the command without a doc lookup.
function validateCommonOrReject(o) {
	const sport = String(o.sport || "").toLowerCase()
	if (!sport) reject(`--sport is REQUIRED (no default — an MLB bet recorded as nba never settles). Valid: ${VALID_SPORTS.join(", ")}`)
	if (!VALID_SPORTS.includes(sport)) reject(`--sport="${o.sport}" is not valid. Valid: ${VALID_SPORTS.join(", ")}`)
	const book = canonBook(o.book)
	if (!o.book) reject(`--book is REQUIRED. Valid: ${[...new Set(Object.values(KNOWN_BOOKS))].join(", ")} (case-insensitive)`)
	if (!book) reject(`--book="${o.book}" is not a known book. Valid: ${[...new Set(Object.values(KNOWN_BOOKS))].join(", ")} (case-insensitive)`)
	return { sport, book }
}

// 2026-07-07 EXEC-CARD — the single-bet build/validate/stamp CORE, extracted so
// the CLI (below) and the /m execution card route (workstationRoutes POST
// /api/ws/place-bet) share ONE owner (Law 1). NEVER exits/throws on invalid
// input — returns { ok:false, error } so the route can 400 it; the CLI wrapper
// keeps the exact SPINE-FIX reject/exit behavior + messages.
// Returns { ok:true, bet, tupleMatch: <tracked pick or null>, noTupleMatch: bool }.
function buildValidatedSingleBet(o = {}) {
	const stake = Number(o.stake)
	const odds = Number(o.odds)
	const player = o.player
	if (!player || !stake || !odds) return { ok: false, error: "single requires --player, --stake, --odds" }
	const sport = String(o.sport || "").toLowerCase()
	if (!sport) return { ok: false, error: `--sport is REQUIRED (no default — an MLB bet recorded as nba never settles). Valid: ${VALID_SPORTS.join(", ")}` }
	if (!VALID_SPORTS.includes(sport)) return { ok: false, error: `--sport="${o.sport}" is not valid. Valid: ${VALID_SPORTS.join(", ")}` }
	const book = canonBook(o.book)
	if (!o.book) return { ok: false, error: `--book is REQUIRED. Valid: ${[...new Set(Object.values(KNOWN_BOOKS))].join(", ")} (case-insensitive)` }
	if (!book) return { ok: false, error: `--book="${o.book}" is not a known book. Valid: ${[...new Set(Object.values(KNOWN_BOOKS))].join(", ")} (case-insensitive)` }
	// 2026-07-05 SPINE-FIX 1 — stat/side/line validated so the tuple can match
	// (GRADING_RULES §9). MLB stats are the closed canonical token set; NBA
	// (off-season) passes through unvalidated.
	let statFamily = o.stat
	if (sport === "mlb") {
		statFamily = canonMlbStat(o.stat)
		if (!statFamily) return { ok: false, error: `--stat="${o.stat}" is not a canonical MLB token. Valid: ${MLB_STAT_TOKENS.join(", ")} (case-insensitive)` }
	} else if (!statFamily) {
		return { ok: false, error: `--stat is REQUIRED` }
	}
	const side = String(o.side || "").toLowerCase()
	if (!["over", "under", "yes", "no"].includes(side)) return { ok: false, error: `--side="${o.side || ""}" must be one of: over, under, yes, no` }
	const line = Number(o.line)
	if (!Number.isFinite(line)) return { ok: false, error: `--line="${o.line || ""}" must be a number` }

	// Phase Date-Doctrine-1B — canonical ET slate date
	const today = currentSlateDateEt()
	const bet = {
		date: today,
		sport,
		sportsbook: book,
		betType: "single",
		player,
		matchup: o.matchup || null,
		statFamily,
		prop: `${statFamily} ${side} ${line}`,
		side,
		line,
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
		notes: o.notes || null, // 2026-07-06 SPINE-FIX 1 — single-mode notes (parlay already had it); e2e/test rows self-identify
	}
	// Deterministic id up-front (same formula normalizeBet uses) so the operator
	// sees the id they'd pass to settlePlacedBet.js — no more undefined print.
	bet.id = stableId(bet.sport, bet.date, bet.player, bet.statFamily, bet.side, bet.line, bet.sportsbook)

	// 2026-07-05 SPINE-FIX 1 — tuple auto-stamp from the served/tracked board pick
	// (possible since G1-Serve-1A stamps landed on tracked rows).
	const t = lookupTrackedPick(bet)
	if (t) stampFromTracked(bet, t)
	return { ok: true, bet, tupleMatch: t || null, noTupleMatch: sport === "mlb" && !t }
}

function makeSingleLeg(args) {
	const r = buildValidatedSingleBet(args.opts)
	if (!r.ok) {
		// exact SPINE-FIX CLI behavior: print + exit(1) via reject (message unchanged)
		if (/requires --player/.test(r.error)) { console.error(`[addPlacedBet] ${r.error}`); process.exit(1) }
		reject(r.error)
	}
	const bet = r.bet
	if (r.tupleMatch) {
		console.log(`[addPlacedBet] tuple MATCHED tracked pick ${r.tupleMatch.id || "(no id)"} — stamped:`, {
			calibVersion: bet.calibVersion ?? null,
			modelProb: bet.modelProb ?? null,
			modelProbRaw: bet.modelProbRaw ?? null,
			selectionPolicy: bet.selectionPolicy ?? null,
			tier: bet.tier ?? null,
		})
		if (bet.calibVersion == null) console.warn("[addPlacedBet] note: matched pick carries NO calibVersion (raw-era or pre-injection row) — stamped what exists, invented nothing.")
	} else if (r.noTupleMatch) {
		warnNoTupleMatch(bet)
	}
	return [bet]
}

// 2026-07-07 DEEPLINK-2B — the parlay build/validate/stamp CORE, extracted like
// buildValidatedSingleBet (ONE owner; CLI + /api/ws/place-bet parlay mode share
// it). Errors return, never exit. Per-leg tuple stamps where matched. The id is
// now DETERMINISTIC (fnv32 over sport|date|book|sorted legs) so a double-tap
// upserts instead of duplicating — the old `placed_parlay_${Date.now()}` id
// duplicated on every re-run (CLI included); this fixes both entry points.
function _fnv32(s) {
	let h = 2166136261 >>> 0
	for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
	return (h >>> 0).toString(16)
}
function buildValidatedParlayBet(o = {}, legsIn = []) {
	const stake = Number(o.stake)
	const odds = Number(o.odds)
	const legs = Array.isArray(legsIn) ? legsIn.map((l) => ({ ...l })) : []
	if (!legs.length || !stake || !odds) return { ok: false, error: "parlay requires --stake, --odds, and ≥2 --leg=player|stat|line|side" }
	if (legs.length < 2) return { ok: false, error: "parlay requires ≥2 legs" }
	const sport = String(o.sport || "").toLowerCase()
	if (!sport) return { ok: false, error: `--sport is REQUIRED (no default — an MLB bet recorded as nba never settles). Valid: ${VALID_SPORTS.join(", ")}` }
	if (!VALID_SPORTS.includes(sport)) return { ok: false, error: `--sport="${o.sport}" is not valid. Valid: ${VALID_SPORTS.join(", ")}` }
	const book = canonBook(o.book)
	if (!o.book) return { ok: false, error: `--book is REQUIRED. Valid: ${[...new Set(Object.values(KNOWN_BOOKS))].join(", ")} (case-insensitive)` }
	if (!book) return { ok: false, error: `--book="${o.book}" is not a known book. Valid: ${[...new Set(Object.values(KNOWN_BOOKS))].join(", ")} (case-insensitive)` }

	const today = currentSlateDateEt()
	const legNotes = []
	for (const l of legs) {
		l.side = String(l.side || "").toLowerCase()
		if (sport === "mlb") {
			const tok = canonMlbStat(l.statFamily)
			if (!tok) return { ok: false, error: `leg "${l.player}" --stat="${l.statFamily}" is not a canonical MLB token. Valid: ${MLB_STAT_TOKENS.join(", ")}` }
			l.statFamily = tok
		}
		if (!["over", "under", "yes", "no"].includes(l.side)) return { ok: false, error: `leg "${l.player}" side="${l.side}" must be one of: over, under, yes, no` }
		if (!Number.isFinite(Number(l.line))) return { ok: false, error: `leg "${l.player}" line="${l.line}" must be a number` }
		const t = lookupTrackedPick({ sport, date: today, player: l.player, statFamily: l.statFamily, side: l.side, line: l.line, sportsbook: book })
		if (t) { stampFromTracked(l, t); legNotes.push({ leg: l.player, matched: true, calibVersion: l.calibVersion ?? null }) }
		else legNotes.push({ leg: l.player, matched: false })
	}
	const legKeyStr = legs.map((l) => `${String(l.player).toLowerCase()}|${l.statFamily}|${l.side}|${Number(l.line)}`).sort().join("~")
	const id = `placed_parlay_${_fnv32(`${sport}|${today}|${book}|${legKeyStr}`)}`
	return { ok: true, id, sport, book, today, legs, legNotes, stake, odds }
}

function makeParlay(args) {
	const r = buildValidatedParlayBet(args.opts, args.legs)
	if (!r.ok) {
		if (/parlay requires/.test(r.error)) { console.error(`[addPlacedBet] ${r.error}`); process.exit(1) }
		reject(r.error)
	}
	const { sport, book, legs } = r
	const o = args.opts
	for (const n of r.legNotes) {
		const l = legs.find((x) => x.player === n.leg)
		if (n.matched) console.log(`[addPlacedBet] leg tuple MATCHED: ${l.player} ${l.statFamily} ${l.side} ${l.line} (calibVersion: ${l.calibVersion ?? "none"})`)
		else if (sport === "mlb") console.warn(`[addPlacedBet] ⚠ leg NO tuple match: ${l.player} ${l.statFamily} ${l.side} ${l.line} @ ${book} — leg will NOT auto-settle (GRADING_RULES §9)`)
	}
	args.legs = legs // canonicalized + stamped legs flow into the parlay object below
	const stake = r.stake
	const odds = r.odds
	// Phase Date-Doctrine-1B — canonical ET slate date
	const today = currentSlateDateEt()
	const toWin = Number((stake * americanOddsToPayoutMultiple(odds)).toFixed(2))
	const legSummary = args.legs.map((l) => `${l.player.split(" ").slice(-1)[0]} ${l.side} ${l.line} ${l.statFamily}`).join(" + ")
	const parlay = {
		id: r.id, // 2026-07-07 DEEPLINK-2B — deterministic (was Date.now(): duplicated on re-run)
		date: today,
		sport,           // 2026-07-05 SPINE-FIX 1 — validated, no silent nba default
		sportsbook: book, // canonical display string (matches tracked rows)
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
	// 2026-07-05 SPINE-FIX 1 — --dry-run: validate + tuple-stamp + print WITHOUT
	// writing the ledger (fixture-safe + lets the operator preview the exact row).
	const dryRun = "dry-run" in args.opts || process.argv.includes("--dry-run")
	for (const b of bets) {
		if (dryRun) {
			console.log("[addPlacedBet] DRY RUN — nothing written. Row that WOULD be added:")
			console.log(JSON.stringify(b, null, 2))
			continue
		}
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

// 2026-07-07 EXEC-CARD — require-main guard (captureClosingLines precedent) so the
// /api/ws/place-bet route can require the shared core without running the CLI.
if (require.main === module) {
	main().catch((e) => { console.error("[addPlacedBet] fatal:", e?.message || e); process.exit(1) })
}

module.exports = {
	// 2026-07-07 EXEC-CARD — the ONE single-bet build/validate/stamp owner, shared
	// by this CLI and workstationRoutes POST /api/ws/place-bet.
	buildValidatedSingleBet,
	// 2026-07-07 DEEPLINK-2B — parlay core (same doctrine, parlay mode).
	buildValidatedParlayBet,
	lookupTrackedPick,
	canonBook,
	canonMlbStat,
	MLB_STAT_TOKENS,
	KNOWN_BOOKS,
}
