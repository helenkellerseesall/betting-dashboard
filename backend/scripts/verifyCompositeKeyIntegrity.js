"use strict"

/**
 * Phase E1 — Composite-Key Integrity verification.
 *
 * Confirms the THREE canonical backstops in backend/storage/intelligence.js:
 *   1. normPlayer  — NFD + combining-mark strip + lowercase + trim
 *   2. normFam     — lowercase + collapse whitespace AND underscores
 *   3. normBook    — canonicalBook() + lowercase + trim
 *
 * The single most important property is REPLAY DETERMINISM: identical inputs
 * (across spelling/case/punctuation variants of the same logical prediction)
 * MUST produce byte-identical composite prediction IDs, so that grading and
 * freeze operations join cleanly.
 *
 *   node backend/scripts/verifyCompositeKeyIntegrity.js
 */

function assert(cond, msg, ctx) {
	if (!cond) {
		console.log("FAIL —", msg)
		if (ctx !== undefined) console.log("  ctx:", JSON.stringify(ctx, null, 2))
		process.exitCode = 1
		return false
	}
	console.log("  OK —", msg)
	return true
}

const intel = require("../storage/intelligence")
const {
	predictionId,
	normPlayer,
	normFam,
	normBook,
	getCanonicalizationDiagnostics,
	resetCanonicalizationDiagnostics,
} = intel

function part1_normPlayer() {
	console.log("\n=== PART 1 — normPlayer canonicalization ===\n")
	resetCanonicalizationDiagnostics()

	console.log("\n--- accents collapse identically ---")
	assert(normPlayer("Ronald Acuña Jr.") === normPlayer("Ronald Acuna Jr."),
		"Acuña vs Acuna collapse to same bytes",
		{ acuna: normPlayer("Ronald Acuña Jr."), acuna2: normPlayer("Ronald Acuna Jr.") })
	assert(normPlayer("ACUÑA JR") === normPlayer("acuna jr"), "case + accent variants identical")
	assert(normPlayer("Luka Dončić") === normPlayer("Luka Doncic"), "Dončić vs Doncic identical")
	assert(normPlayer("José Ramírez") === normPlayer("Jose Ramirez"), "José Ramírez canonical")
	assert(normPlayer("Núñez") === normPlayer("Nunez"), "double-accent (ñ) handled")
	assert(normPlayer("Béisbol Béisbol") === normPlayer("Beisbol Beisbol"), "diacritics on common-noun-like word")

	console.log("\n--- suffixes PRESERVED (Jr / Sr / II / III) ---")
	assert(normPlayer("Ken Griffey Jr.") !== normPlayer("Ken Griffey"),
		"Jr. preserved as distinct from non-suffix")
	assert(normPlayer("Ken Griffey Sr.") !== normPlayer("Ken Griffey Jr."),
		"Sr vs Jr preserved as distinct")
	assert(normPlayer("Cal Ripken Jr.") === normPlayer("Cal Ripken Jr."), "self-identity")
	assert(normPlayer("Fernando Tatis Jr.") !== normPlayer("Fernando Tatis"),
		"Tatis Jr distinct from Tatis Sr/absent")
	assert(normPlayer("Robert Griffin III") !== normPlayer("Robert Griffin II"),
		"III vs II preserved as distinct")
	assert(normPlayer("Henry Vandergriff III") === normPlayer("HENRY VANDERGRIFF iii"),
		"III case-insensitive but preserved")

	console.log("\n--- apostrophes + hyphens preserved (ASCII) ---")
	assert(normPlayer("Tyler O'Neill") !== normPlayer("Tyler ONeill"),
		"O'Neill apostrophe preserved")
	assert(normPlayer("Smith-Jones") !== normPlayer("Smith Jones"),
		"Smith-Jones hyphen preserved")

	console.log("\n--- null / empty / weird inputs ---")
	assert(normPlayer(null) === "", "null → empty string")
	assert(normPlayer(undefined) === "", "undefined → empty string")
	assert(normPlayer("") === "", "empty → empty")
	assert(normPlayer("   ") === "", "whitespace → empty")
	assert(normPlayer(42) === "42", "non-string coerces (no diacritics to strip)")

	console.log("\n--- diagnostics observed ---")
	const d = getCanonicalizationDiagnostics()
	assert(d.playerInputsCanonicalized >= 5,
		"≥5 player inputs flagged as canonicalization-altering",
		{ v: d.playerInputsCanonicalized })
	assert(d.firstPlayerCollision != null, "first sample captured")
}

function part2_normFam() {
	console.log("\n=== PART 2 — normFam canonicalization ===\n")
	resetCanonicalizationDiagnostics()

	console.log("\n--- three stat-family forms collapse identically ---")
	assert(normFam("Total Bases") === normFam("total_bases"), "Title-Case vs underscored")
	assert(normFam("total_bases") === normFam("totalbases"), "underscored vs no-separator")
	assert(normFam("TOTAL BASES") === normFam("totalbases"), "all caps vs no-separator")
	assert(normFam("Total_Bases") === normFam("total bases"), "mixed underscored+title vs spaced")
	assert(normFam("home_runs") === normFam("Home Runs"), "home runs variants")
	assert(normFam("pitcher_strikeouts") === normFam("PITCHER STRIKEOUTS"),
		"pitcher_strikeouts variants")

	console.log("\n--- output bytes are deterministic ---")
	assert(normFam("Total Bases") === "totalbases", "canonical output bytes")
	assert(normFam("home_runs") === "homeruns", "underscores stripped")
	assert(normFam("  Total Bases  ") === "totalbases", "outer whitespace stripped")

	console.log("\n--- distinct families NOT collapsed ---")
	assert(normFam("total_bases") !== normFam("home_runs"), "totalbases ≠ homeruns")
	assert(normFam("pitcher_strikeouts") !== normFam("batter_strikeouts"),
		"pitcher Ks ≠ batter Ks")
	assert(normFam("hits") !== normFam("walks"), "hits ≠ walks")

	console.log("\n--- null / empty ---")
	assert(normFam(null) === "", "null → empty")
	assert(normFam("") === "", "empty → empty")

	console.log("\n--- diagnostics observed ---")
	const d = getCanonicalizationDiagnostics()
	assert(d.statFamilyInputsCanonicalized >= 2,
		"≥2 stat-family inputs flagged",
		{ v: d.statFamilyInputsCanonicalized })
}

function part3_normBook() {
	console.log("\n=== PART 3 — normBook canonicalization ===\n")
	resetCanonicalizationDiagnostics()

	console.log("\n--- DraftKings alias variants ---")
	assert(normBook("DK") === normBook("DraftKings"), "DK == DraftKings")
	assert(normBook("DraftKings") === normBook("draftkings"), "case-insensitive")
	assert(normBook("Draft Kings") === normBook("DraftKings"), "spacing variants collapse")

	console.log("\n--- FanDuel alias variants ---")
	assert(normBook("FD") === normBook("FanDuel"), "FD == FanDuel")
	assert(normBook("FanDuel") === normBook("fanduel"), "case-insensitive")

	console.log("\n--- multi-word books ---")
	assert(normBook("ESPNBet") === normBook("espnbet"), "ESPNBet case-insensitive")
	assert(normBook("ESPN Bet") === normBook("espn-bet"), "ESPN Bet spacing variants")
	assert(normBook("Hard Rock") === normBook("HardRock"), "Hard Rock / HardRock collapse")
	assert(normBook("BetMGM") === normBook("betmgm"), "BetMGM case")

	console.log("\n--- unknown books pass through deterministically ---")
	assert(normBook("MyNewBook") === normBook("mynewbook"), "unknown book lowercases stably")
	assert(normBook("MyNewBook") === "mynewbook", "unknown book canonical form")

	console.log("\n--- distinct books NOT collapsed ---")
	assert(normBook("DK") !== normBook("FD"), "DK ≠ FD")
	assert(normBook("FanDuel") !== normBook("BetMGM"), "FanDuel ≠ BetMGM")

	console.log("\n--- null / empty ---")
	assert(normBook(null) === "", "null → empty")
	assert(normBook("") === "", "empty → empty")

	console.log("\n--- diagnostics observed ---")
	const d = getCanonicalizationDiagnostics()
	assert(d.bookInputsCanonicalized >= 4,
		"≥4 book inputs flagged",
		{ v: d.bookInputsCanonicalized })
}

function part4_predictionId() {
	console.log("\n=== PART 4 — predictionId byte-equality across variants ===\n")
	resetCanonicalizationDiagnostics()

	console.log("\n--- same logical prediction across variants → same id ---")
	const id1 = predictionId("2026-05-12", "mlb", "Ronald Acuña Jr.", "Total Bases", "over", 1.5, "DK")
	const id2 = predictionId("2026-05-12", "mlb", "Ronald Acuna Jr.", "total_bases", "Over", 1.5, "draftkings")
	const id3 = predictionId("2026-05-12", "MLB", "ronald acuña jr.", "totalbases", "OVER", 1.5, "Draft Kings")
	assert(id1 === id2, "Acuña/DK == Acuna/draftkings", { id1, id2 })
	assert(id2 === id3, "all-three variants collapse to same id", { id2, id3 })
	assert(id1 === id3, "by transitivity, all three identical")

	console.log("\n--- ID format is deterministic ---")
	const expected = "2026-05-12|mlb|ronald acuna jr.|totalbases|over|1.5|draftkings"
	assert(id1 === expected, "exact byte form", { actual: id1, expected })

	console.log("\n--- different player → different id (no false collisions) ---")
	const idA = predictionId("2026-05-12", "mlb", "Aaron Judge", "Home Runs", "over", 0.5, "DK")
	const idB = predictionId("2026-05-12", "mlb", "Ronald Acuña Jr.", "Home Runs", "over", 0.5, "DK")
	assert(idA !== idB, "Judge vs Acuña distinct")

	console.log("\n--- different line → different id ---")
	const idLine15 = predictionId("2026-05-12", "mlb", "Aaron Judge", "Home Runs", "over", 1.5, "DK")
	const idLine25 = predictionId("2026-05-12", "mlb", "Aaron Judge", "Home Runs", "over", 2.5, "DK")
	assert(idLine15 !== idLine25, "1.5 vs 2.5 distinct")

	console.log("\n--- different side → different id ---")
	const idOver = predictionId("2026-05-12", "mlb", "Aaron Judge", "Home Runs", "over", 0.5, "DK")
	const idUnder = predictionId("2026-05-12", "mlb", "Aaron Judge", "Home Runs", "under", 0.5, "DK")
	assert(idOver !== idUnder, "over vs under distinct")

	console.log("\n--- different sport → different id ---")
	const idMlb = predictionId("2026-05-12", "mlb", "Aaron Judge", "Home Runs", "over", 0.5, "DK")
	const idNba = predictionId("2026-05-12", "nba", "Aaron Judge", "Home Runs", "over", 0.5, "DK")
	assert(idMlb !== idNba, "mlb vs nba distinct")

	console.log("\n--- different date → different id ---")
	const idD1 = predictionId("2026-05-12", "mlb", "Aaron Judge", "Home Runs", "over", 0.5, "DK")
	const idD2 = predictionId("2026-05-13", "mlb", "Aaron Judge", "Home Runs", "over", 0.5, "DK")
	assert(idD1 !== idD2, "date isolates predictions")

	console.log("\n--- diagnostic counter for altered predictionIds ---")
	const d = getCanonicalizationDiagnostics()
	assert(d.predictionIdsBuilt >= 10, "≥10 predictionIds built in this fixture")
	assert(d.predictionIdsBytewiseAltered >= 1, "≥1 prediction bytewise-altered (Acuña variants)")
}

function part5_replayDeterminism() {
	console.log("\n=== PART 5 — replay determinism + idempotency ===\n")

	console.log("\n--- same input → same output, every call ---")
	const args = ["2026-05-12", "mlb", "Mookie Betts", "RBIs", "over", 0.5, "FanDuel"]
	const id1 = predictionId(...args)
	const id2 = predictionId(...args)
	const id3 = predictionId(...args)
	assert(id1 === id2 && id2 === id3, "three identical calls → three identical ids")

	console.log("\n--- diacritic order doesn't matter (NFD normalizes) ---")
	// Precomposed ñ (U+00F1) vs decomposed n + combining tilde (U+006E + U+0303)
	const precomposed = "Acuña"
	const decomposed = "Acuña"
	assert(normPlayer(precomposed) === normPlayer(decomposed),
		"precomposed ñ == decomposed n+U+0303",
		{ pre: normPlayer(precomposed), dec: normPlayer(decomposed) })

	console.log("\n--- line numeric formatting stable ---")
	const idA = predictionId("2026-05-12", "mlb", "X", "Hits", "over", 1.5, "DK")
	const idB = predictionId("2026-05-12", "mlb", "X", "Hits", "over", "1.5", "DK")
	const idC = predictionId("2026-05-12", "mlb", "X", "Hits", "over", 1.50, "DK")
	assert(idA === idB && idB === idC, "1.5 / '1.5' / 1.50 all canonical")
}

function part6_diagnosticsShape() {
	console.log("\n=== PART 6 — diagnostics export shape ===\n")
	const d = getCanonicalizationDiagnostics()
	for (const k of [
		"predictionIdsBuilt",
		"playerInputsCanonicalized",
		"statFamilyInputsCanonicalized",
		"bookInputsCanonicalized",
		"predictionIdsBytewiseAltered",
		"firstPlayerCollision",
		"firstStatFamilyCollision",
		"firstBookCollision",
		"firstPredictionIdCollision",
	]) {
		assert(Object.prototype.hasOwnProperty.call(d, k), `diagnostics has key: ${k}`)
	}
	resetCanonicalizationDiagnostics()
	const empty = getCanonicalizationDiagnostics()
	assert(empty.predictionIdsBuilt === 0, "reset clears counters")
	assert(empty.firstPlayerCollision === null, "reset clears first-sample fields")
}

function part7_historicalCompatNote() {
	console.log("\n=== PART 7 — historical compatibility note ===\n")
	// The patch documents that historical rows are NOT migrated. This test
	// confirms the BEHAVIORAL property: a row computed pre-fix would have
	// produced a DIFFERENT id from a row computed post-fix for the same
	// LOGICAL prediction if it involved diacritics or book aliases. The
	// asymmetry is intentional — see the comment block in intelligence.js.
	console.log("\n--- pre-fix simulation: lowercase+trim only ---")
	const preFixPlayer = "Ronald Acuña Jr.".toLowerCase().trim()
	const postFixPlayer = normPlayer("Ronald Acuña Jr.")
	assert(preFixPlayer !== postFixPlayer,
		"pre-fix and post-fix player bytes differ for diacritic names",
		{ preFix: preFixPlayer, postFix: postFixPlayer })

	const preFixBook = "DK".toLowerCase().trim()
	const postFixBook = normBook("DK")
	assert(preFixBook !== postFixBook,
		"pre-fix and post-fix book bytes differ for alias variants",
		{ preFix: preFixBook, postFix: postFixBook })

	console.log("  (info) Historical predictions persist under their pre-fix id and remain queryable.")
	console.log("  (info) New predictions and outcomes both compute the post-fix id and align canonically.")
}

function run() {
	try {
		part1_normPlayer()
		part2_normFam()
		part3_normBook()
		part4_predictionId()
		part5_replayDeterminism()
		part6_diagnosticsShape()
		part7_historicalCompatNote()
	} catch (err) {
		console.log("FAIL — unexpected exception:", err?.stack || err)
		process.exitCode = 1
	}
	console.log("\n=== verification finished ===")
	console.log(process.exitCode === 1 ? "RESULT: FAIL" : "RESULT: PASS")
}

run()
