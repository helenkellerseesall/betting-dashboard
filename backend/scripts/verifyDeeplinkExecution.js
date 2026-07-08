"use strict"
// verifyDeeplinkExecution — DEEPLINK-2A/2B (2026-07-07) fixture.
//   1. Capture: includeLinks/includeSids gated by MLB_DEEPLINKS (OFF ⇒ params +
//      row fields ABSENT ⇒ byte-identical snapshots); row fields vendor-sourced.
//   2. Matrix: config exists, ALL books ship disabled (the kill-switch — matrix
//      disabled = no links anywhere), {state} null, Fanatics status none, ONLY
//      BetMGM multiStatus confirmed (official docs); GET /api/ws/deeplink-matrix.
//   3. Parlay core: shared owner exported, validation errors-not-exits,
//      DETERMINISTIC id (shuffle/stake-invariant — duplicate-tap safe at both
//      entry points), per-leg canon + stamp notes; CLI parity preserved.
//   4. Route: parlay mode wired, duplicate guard, honest §9/§5 warnings.
//   5. FE: matrix-gated anchors, {state}/never-prefill-stake fill rules,
//      cross-game-only compose + SGP-out note, book odds required for the
//      parlay record (real ticket, never our estimate), scripts parse.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// 1. capture gating
const snapSrc = rd("pipeline/mlb/buildMlbBootstrapSnapshot.js")
check("capture: MLB_DEEPLINKS flag (default ON, exact-0 off, boot line)", /MLB_DEEPLINKS = String\(process\.env\.MLB_DEEPLINKS \?\? "1"\) !== "0"/.test(snapSrc) && /\[MLB-DEEPLINKS-BOOT\]/.test(snapSrc))
check("capture: params gated (includeLinks+includeSids only when ON)", /if \(MLB_DEEPLINKS\) \{ params\.includeLinks = "true"; params\.includeSids = "true" \}/.test(snapSrc))
check("capture: row fields conditional-spread (OFF ⇒ keys absent, byte-identical)", /\.\.\.\(MLB_DEEPLINKS \? \{ betLink: outcome\?\.link \?\? null, betSid: /.test(snapSrc))

// 2. matrix config + route
let matrix = null
try { matrix = JSON.parse(rd("config/deeplinkMatrix.json")) } catch (_) {}
check("matrix config exists with the 6 books", !!matrix && ["fanduel", "draftkings", "betmgm", "hardrockbet", "betrivers", "fanatics"].every((k) => matrix.books && matrix.books[k]))
check("matrix ships ALL books DISABLED (operator flips after phone taps)", !!matrix && Object.values(matrix.books).every((b) => b.enabled === false))
check("matrix: only BetMGM multiStatus confirmed (official docs); Fanatics none", !!matrix && matrix.books.betmgm.multiStatus === "confirmed" && matrix.books.fanatics.multiStatus === "none" && ["fanduel", "draftkings", "hardrockbet", "betrivers"].every((k) => matrix.books[k].multiStatus === "unverified"))
const ws = rd("routes/workstationRoutes.js")
check("route: GET /api/ws/deeplink-matrix serves the config fresh-read", /router\.get\("\/deeplink-matrix"/.test(ws) && /deeplinkMatrix\.json/.test(ws))

// 3. parlay core
const apb = require("./addPlacedBet")
check("parlay core exported", typeof apb.buildValidatedParlayBet === "function")
const L = [{ player: "A Guy", statFamily: "hits", line: 1.5, side: "over" }, { player: "B Guy", statFamily: "totalbases", line: 1.5, side: "over" }]
const p1 = apb.buildValidatedParlayBet({ sport: "mlb", book: "fanduel", stake: 2, odds: 450 }, L)
const p2 = apb.buildValidatedParlayBet({ sport: "mlb", book: "fanduel", stake: 9, odds: 450 }, [L[1], L[0]])
check("parlay core: ok + legs canonicalized + per-leg notes", p1.ok && p1.legs[1].statFamily === "totalBases" && Array.isArray(p1.legNotes) && p1.legNotes.length === 2)
check("parlay core: DETERMINISTIC id — shuffle/stake-invariant (duplicate-tap safe)", p2.ok && p2.id === p1.id && /^placed_parlay_[0-9a-f]+$/.test(p1.id))
check("parlay core: <2 legs rejected without exit", apb.buildValidatedParlayBet({ sport: "mlb", book: "fanduel", stake: 2, odds: 450 }, [L[0]]).ok === false)
check("parlay core: missing sport rejected", apb.buildValidatedParlayBet({ book: "fanduel", stake: 2, odds: 450 }, L).ok === false)
check("parlay CLI: deterministic id wired into the parlay object (Date.now id code gone)", /id: r\.id, \/\/ 2026-07-07 DEEPLINK-2B — deterministic/.test(rd("scripts/addPlacedBet.js")) && !/id: `placed_parlay_\$\{Date\.now\(\)\}`/.test(rd("scripts/addPlacedBet.js")))

// 4. route parlay mode
check("route: parlay mode wired through the shared core", /body\.mode \|\| ""\) === "parlay"/.test(ws) && /buildValidatedParlayBet\(\{/.test(ws))
check("route: parlay duplicate guard on the deterministic id", /b\.id === pr\.id/.test(ws))
check("route: honest §5/§9 parlay warnings (manual settle either way)", /parlays settle manually via settlePlacedBet\.js either way/i.test(ws) || /Parlays settle manually via settlePlacedBet\.js/.test(ws))

// 5. FE
const fe = rd("../frontend/mobile/index.html")
check("FE: matrix fetched from /api/ws/deeplink-matrix; anchors gated on enabled", /api\/ws\/deeplink-matrix/.test(fe) && /if \(!cfg \|\| !cfg\.enabled \|\| !p\.betLink\) return ""/.test(fe))
check("FE: unfilled {state} placeholder ⇒ link never renders; stake NEVER prefilled", /if \(!cfg \|\| !cfg\.state\) return null/.test(fe) && /join\(""\); \/\/ NEVER prefill stakes/.test(fe))
check("FE: compose gated confirmed/verified + cross-game only + SGP-out note", /\["confirmed", "verified"\]\.includes\(String\(cfg\.multiStatus\)\)/.test(fe) && /SGP is a different pricing engine \(out of v1\)/.test(fe))
check("FE: parlay record requires the BOOK's combined odds (real ticket, not our estimate)", /the record must match the real ticket, never our estimate/.test(fe))
check("FE: slip tray add/remove/bar + record via mode:\"parlay\"", /window\._slipAdd/.test(fe) && /window\._slipRemove/.test(fe) && /mode: "parlay"/.test(fe))
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE: inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

// ── 6. TEST-LINKS panel (2026-07-07 field-test follow-up) ────────────────────
const dlc = require("../pipeline/shared/deeplinkCompose")
check("server-side composer module exported (composeSingle/composeMulti/fill)", typeof dlc.composeSingle === "function" && typeof dlc.composeMulti === "function" && typeof dlc.fillPlaceholders === "function")
check("composer: unfilled {state} ⇒ null; stake placeholder always stripped", dlc.fillPlaceholders("https://x/{state}/y", { state: null }) === null && dlc.fillPlaceholders("https://x?coupon=single|1|{wagerAmount}", {}) === "https://x?coupon=single|1|")
check("composer: MGM combo from parsed triplets, state-gated", (() => { const legs = [{ betLink: "https://sports.{state}.betmgm.com/en/sports?options=1-2-3&type=Single" }, { betLink: "https://sports.{state}.betmgm.com/en/sports?options=4-5-6&type=Single" }]; const m = dlc.composeMulti("BetMGM", legs, { state: "nj" }); const noState = dlc.composeMulti("BetMGM", legs, { state: null }); return m && m.url === "https://sports.nj.betmgm.com/en/sports?options=1-2-3,4-5-6&type=combo" && noState === null })())
const wsSrc2 = rd("routes/workstationRoutes.js")
check("testlinks route: FRESH composition + pre-game only + honest empty state (field-test lesson #1)", /router\.get\("\/deeplink-testlinks"/.test(wsSrc2) && /no PRE-GAME markets with link artifacts live right now/.test(wsSrc2))
check("verdict route: closed vocabulary + append-only JSONL (taps become data)", /router\.post\("\/deeplink-verdict"/.test(wsSrc2) && /opened_loaded \| opened_empty \| failed/.test(wsSrc2) && /appendFileSync/.test(wsSrc2))
const feSrc2 = rd("../frontend/mobile/index.html")
check("FE panel: dev-flagged (?dev=1), fresh-compose on open, verdict buttons wired", /\[?\?&\]dev=1/.test(feSrc2) && /deeplink-testlinks\?_t=/.test(feSrc2) && /_tlVerdict/.test(feSrc2))
check("FE my-bets fetch is cache-busted + no-store (stale-cache 0-bets class closed)", /ledger\/yesterday\?_t=\$\{Date\.now\(\)\}`, \{ cache: "no-store" \}/.test(feSrc2))
const docSrc = rd("../docs/research/2026-07-07-multileg-betslip-links.md")
check("research doc records BOTH field-test lessons (stale SIDs + desktop not a test surface)", /Stale SIDs are dead links/.test(docSrc) && /Desktop web is not a test surface/.test(docSrc))

console.log(`verifyDeeplinkExecution: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
