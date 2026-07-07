"use strict"
// verifyPlaceBetRoute — EXEC-CARD (2026-07-07) fixture.
//
// One-tap real-money recording from /m. Guards:
//   1. addPlacedBet is require-safe (main guarded) and exports the ONE
//      build/validate/stamp core (buildValidatedSingleBet) — Law 1: the CLI and
//      the route share it; validation returns errors, never exits, in core.
//   2. Core behavior: required sport (no silent default), canonical MLB tokens,
//      known books, side/line validation, decisionType=placed + realMoney=true,
//      deterministic id, honest noTupleMatch flag.
//   3. CLI parity: the SPINE-FIX reject/exit behavior + messages survive the
//      refactor (spawn checks).
//   4. Route wiring: POST /api/ws/place-bet exists, express.json, uses the core,
//      already_recorded duplicate guard, loud §9 warning, propType resolution
//      via the canonical resolveStatFamily.
//   5. FE: modal panel + round-number stake chips (1/2/5) + confirm handler
//      POSTing to /api/ws/place-bet; inline script parses (new Function — the
//      node --check-on-html trap).
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// 1. require-safe + exports
let apb = null, requireSafe = true
try { apb = require("./addPlacedBet") } catch (_) { requireSafe = false }
check("addPlacedBet is require-safe (main() guarded, no CLI side effects)", requireSafe && !!apb)
check("core exported: buildValidatedSingleBet + canon helpers", !!apb && typeof apb.buildValidatedSingleBet === "function" && typeof apb.canonMlbStat === "function" && typeof apb.canonBook === "function")

// 2. core behavior (pure — fake player never matches a tuple, nothing written)
if (apb) {
  const good = apb.buildValidatedSingleBet({ sport: "mlb", book: "fanduel", stat: "totalbases", side: "over", line: 1.5, odds: -115, stake: 2, player: "Zz Fixture Nobody" })
  check("core: valid input → ok, placed, realMoney, canonical stat + book, deterministic id", good.ok && good.bet.decisionType === "placed" && good.bet.realMoney === true && good.bet.statFamily === "totalBases" && good.bet.sportsbook === "FanDuel" && typeof good.bet.id === "string" && good.bet.id.length > 4)
  check("core: honest noTupleMatch flag on an unmatched MLB bet", good.noTupleMatch === true && good.tupleMatch === null)
  const noSport = apb.buildValidatedSingleBet({ book: "fanduel", stat: "hits", side: "over", line: 1.5, odds: -110, stake: 1, player: "X" })
  check("core: missing sport → error (no exit), lists valid sports", noSport.ok === false && /--sport is REQUIRED/.test(noSport.error) && /mlb/.test(noSport.error))
  const badStat = apb.buildValidatedSingleBet({ sport: "mlb", book: "fanduel", stat: "rebounds", side: "over", line: 1.5, odds: -110, stake: 1, player: "X" })
  check("core: bad MLB stat → error listing the 6 tokens", badStat.ok === false && /canonical MLB token/.test(badStat.error))
  const badBook = apb.buildValidatedSingleBet({ sport: "mlb", book: "bovada", stat: "hits", side: "over", line: 1.5, odds: -110, stake: 1, player: "X" })
  check("core: unknown book → error listing known books", badBook.ok === false && /not a known book/.test(badBook.error) && /Hard Rock Bet/.test(badBook.error))
  const badSide = apb.buildValidatedSingleBet({ sport: "mlb", book: "fanduel", stat: "hits", side: "banana", line: 1.5, odds: -110, stake: 1, player: "X" })
  check("core: bad side → error", badSide.ok === false && /over, under, yes, no/.test(badSide.error))
  const sameId = apb.buildValidatedSingleBet({ sport: "mlb", book: "fanduel", stat: "totalbases", side: "over", line: 1.5, odds: -115, stake: 5, player: "Zz Fixture Nobody" })
  check("core: same pick same day → SAME deterministic id (duplicate-tap guard basis)", sameId.ok && sameId.bet.id === good.bet.id)
}

// 3. CLI parity (SPINE-FIX messages + exits survive the refactor)
const APB = path.join(ROOT, "scripts", "addPlacedBet.js")
let r = spawnSync(process.execPath, [APB, "single", "--player=X", "--stat=hits", "--line=1.5", "--side=over", "--odds=-110", "--book=fanduel", "--stake=1"], { encoding: "utf8", cwd: ROOT })
check("CLI parity: missing --sport still exits 1 with the SPINE-FIX message", r.status === 1 && /--sport is REQUIRED/.test(r.stderr))
r = spawnSync(process.execPath, [APB, "single", "--dry-run", "--sport=mlb", "--player=Zz Fixture Nobody", "--stat=hits", "--line=1.5", "--side=over", "--odds=-110", "--book=fanduel", "--stake=1"], { encoding: "utf8", cwd: ROOT })
check("CLI parity: --dry-run still prints DRY RUN + loud no-tuple warning", r.status === 0 && /DRY RUN — nothing written/.test(r.stdout) && /NO TUPLE MATCH/.test(r.stdout + r.stderr))

// 4. route wiring
const ws = rd("routes/workstationRoutes.js")
check("route: POST /api/ws/place-bet registered with express.json", /router\.post\("\/place-bet", express\.json\(\)/.test(ws))
check("route: uses the shared core (require ../scripts/addPlacedBet → buildValidatedSingleBet)", /require\("\.\.\/scripts\/addPlacedBet"\)/.test(ws) && /buildValidatedSingleBet\(\{/.test(ws))
check("route: duplicate-tap already_recorded guard on the deterministic id", /already_recorded/.test(ws) && /b\.id === r\.bet\.id/.test(ws))
check("route: loud §9 warning on noTupleMatch", /NO TUPLE MATCH in today's tracked board picks/.test(ws) && /GRADING_RULES §9/.test(ws))
check("route: propType resolution via canonical resolveStatFamily (no new map)", /resolveStatFamily\(\{ propType: body\.propType/.test(ws))

// 5. FE panel
const fe = rd("../frontend/mobile/index.html")
check("FE: modal renders the place-bet panel", /_renderPlaceBetPanel\(p\)/.test(fe) && /I bet this/.test(fe))
check("FE: ROUND-NUMBER stake presets 1/2/5 (no computed stake suggestions)", /\[1, 2, 5\]\.map/.test(fe))
check("FE: confirm handler POSTs to /api/ws/place-bet + disables in-flight", /fetch\(`\$\{API\}\/api\/ws\/place-bet`/.test(fe) && /btnEl\.disabled = true/.test(fe))
check("FE: renders the NO TUPLE MATCH warning + already_recorded state", /NO TUPLE MATCH<\/b> — this bet will NOT auto-settle/.test(fe) && /Already recorded today/.test(fe))
// inline-script parse (node --check chokes on HTML — new Function per the doctrine)
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE: inline scripts parse (new Function)${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

// ── 6. FEEDBACK PACK (2026-07-07, post-bet-#1) ───────────────────────────────
const ledgerSrc = rd("pipeline/shared/buildPersonalLedger.js")
check("A2: normalizeBet carries the version stamps (the third whitelist-strip of this class, fixed)", /input\.calibVersion != null \? \{ calibVersion: input\.calibVersion \}/.test(ledgerSrc) && /matchedTrackedId: input\.matchedTrackedId/.test(ledgerSrc) && /selectionPolicy: input\.selectionPolicy/.test(ledgerSrc))
const wsSrc = rd("routes/workstationRoutes.js")
check("C: top-picks orders EARNED above capped, both sort sites (board + ⭐ mirror)", (wsSrc.match(/const capA = a\.tierCapNote \? 1 : 0, capB = b\.tierCapNote \? 1 : 0/g) || []).length === 2)
const feSrc = rd("../frontend/mobile/index.html")
check("A1: modal has the editable 'Odds I got' field, prefilled with the card price; POST sends it", /id="pb-odds"/.test(feSrc) && /const oddsGot = Number\(document\.getElementById\("pb-odds"\)/.test(feSrc) && /odds:      oddsGot,/.test(feSrc))
check("B: MY BETS honest status map (void→VOID, push→PUSH — never PENDING)", /push: \["PUSH", "#9CA3AF"\], void: \["VOID", "#9CA3AF"\]/.test(feSrc))
check("B: MY BETS cards carry identity (player/prop/line) + slate date + stamp line", /identLine/.test(feSrc) && /stamped \$\{escapeHtml\(b\.calibVersion\)\}/.test(feSrc))

console.log(`verifyPlaceBetRoute: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
