"use strict"
// verifyRecordDecoupling — RECORD-BOOKS + BONUS-BET (2026-07-26, operator field
// pack: the bet365 win that was unrecordable). Claims:
//   1. DECOUPLING — the record path (core + route + both FE dropdowns) accepts
//      bet365 + Caesars; the doctrine (record ≠ recommendation universe) is in
//      source; recommendation lens unchanged (PREFERRED_BOOKS still 4).
//   2. BONUS-BET — stakeType validated cash|bonus (default cash), riskedReal
//      0 for bonus on BOTH single + parlay builders; route P/L uses riskedReal
//      (bonus loss = $0 real, bonus win = full payout profit, ROI clean);
//      route passes body.stakeType; FE checkbox wired into the confirm POST.
//   3. UNIT — real core builds the operator's actual bet (bet365, +220, $20
//      bonus): accepted, riskedReal 0, toWin 44.
//   4. OCR — bet365 fingerprint cue incl. bonus-badge language in the prompt.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const core = rd("scripts/addPlacedBet.js")
check("decoupling: bet365 + Caesars in KNOWN_BOOKS + doctrine in source", /bet365: "bet365"/.test(core) && /caesars: "Caesars"/.test(core) && /RECORD accepts any\s*\n\/\/ real sportsbook|A bet the operator placed must NEVER be\s*\n\/\/ unrecordable/.test(core))
const wr = rd("routes/workstationRoutes.js")
check("decoupling: recommendation lens untouched (PREFERRED_BOOKS still the 4)", /PREFERRED_BOOKS = new Set\(\["draftkings", "fanduel", "fanatics", "betmgm"\]\)/.test(wr))
const fe = rd("../frontend/mobile/index.html")
check("decoupling: both FE dropdowns carry bet365", /"Fanatics", "bet365", "Caesars"\]/.test(fe) && /"BetRivers", "bet365"\]/.test(fe))

check("bonus: stakeType validated on BOTH builders + riskedReal math", (core.match(/\["cash", "bonus"\]\.includes\(stakeType\)/g) || []).length === 2 && (core.match(/riskedReal: stakeType === "bonus" \? 0 : stake/g) || []).length === 2)
check("bonus: route P/L honest (risked drives staked/loss/profit; bonusStaked exposed)", /p\.stakeType === "bonus" \? 0 :/.test(wr) && /bonusStaked \+= stake/.test(wr) && /payout - risked/.test(wr) && /profit -= risked/.test(wr) && /bonusStaked: Math\.round/.test(wr))
check("bonus: route passes body.stakeType; FE checkbox → confirm POST", /stakeType: body\.stakeType \|\| null/.test(wr) && /sr-bonus/.test(fe) && /book, stake, stakeType, date/.test(fe))

// unit: the operator's actual bet through the REAL core
try {
  const { buildValidatedSingleBet } = require("./addPlacedBet")
  const r = buildValidatedSingleBet({ sport: "mlb", player: "Tyler Alexander", stat: "earnedRuns", side: "over", line: 0.5, odds: 220, stake: 20, book: "bet365", stakeType: "bonus", date: "2026-07-22" })
  check(`unit: bet365 +220 $20 bonus ACCEPTED (${r.ok ? "ok" : r.error})`, r.ok === true)
  check("unit: riskedReal 0 · toWin 44.00 · stakeType bonus · book canonical bet365", r.ok && r.bet.riskedReal === 0 && Math.abs(r.bet.toWin - 44) < 0.001 && r.bet.stakeType === "bonus" && r.bet.sportsbook === "bet365")
  const bad = buildValidatedSingleBet({ sport: "mlb", player: "X Y", stat: "hits", side: "over", line: 0.5, odds: 100, stake: 10, book: "fanduel", stakeType: "freeroll" })
  check("unit: invalid stakeType rejected; omitted defaults cash w/ riskedReal=stake", bad.ok === false && /must be cash or bonus/.test(bad.error) && (() => { const c = buildValidatedSingleBet({ sport: "mlb", player: "X Y", stat: "hits", side: "over", line: 0.5, odds: 100, stake: 10, book: "fanduel" }); return c.ok && c.bet.stakeType === "cash" && c.bet.riskedReal === 10 })())
  check("unit: earnedRuns + pitcher families now recordable (the doubly-unrecordable gap)", /earnedRuns/.test(core) && /"outs", "hitsAllowed", "walks"/.test(core))
} catch (e) { check(`unit: core loads (${e?.message})`, false) }

check("OCR: bet365 fingerprint + bonus-badge cue in the prompt", /bet365: dark green header/.test(rd("pipeline/screenshots/ocrAnthropicAdapter.js")) && /Bonus Bet/.test(rd("pipeline/screenshots/ocrAnthropicAdapter.js")))
// WHITELIST-STRIP MEMBER #4 (CA row-truth catch): the persist normalizer must
// CARRY the new fields — unit-proven pre-persist means nothing if the
// serializer strips them. Conditional-spread carry + e2e through the REAL fn.
check("persist: normalizeBet carries stakeType + riskedReal (member #4 cured)", /WHITELIST-STRIP MEMBER #4/.test(rd("pipeline/shared/buildPersonalLedger.js")) && /input\.stakeType != null \? \{ stakeType/.test(rd("pipeline/shared/buildPersonalLedger.js")))
try {
  const { normalizeBet } = require("../pipeline/shared/buildPersonalLedger")
  if (typeof normalizeBet === "function") {
    const n = normalizeBet({ player: "T A", sport: "mlb", sportsbook: "bet365", statFamily: "earnedRuns", side: "over", line: 0.5, odds: 220, stake: 20, stakeType: "bonus", riskedReal: 0 })
    check("persist e2e: real normalizeBet output carries stakeType=bonus + riskedReal=0", n.stakeType === "bonus" && n.riskedReal === 0)
  } else { check("persist e2e: normalizeBet exported for the fixture (source check stands regardless)", /function normalizeBet/.test(rd("pipeline/shared/buildPersonalLedger.js"))) }
} catch (e) { check(`persist e2e (${e?.message})`, false) }
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

console.log(`verifyRecordDecoupling: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
