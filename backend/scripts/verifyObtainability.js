"use strict"
// verifyObtainability — OBTAINABILITY-GATE-1 + CARD-IDENTITY (2026-07-17,
// operator field catch: served u1.5 hits @ DK -203, unpurchasable in-app).
// Claims:
//   1. CONFIG — committed, source-tagged, field-verified DK batter families
//      over_only; enforcement expands only via commit.
//   2. HELPER — explicit over_only ⇒ under not purchasable; UNKNOWN pairs are
//      NEVER restricted (real unders never wrongly stripped).
//   3. LENS — under@over_only dropped PRE-DEDUP (re-point-or-vanish), counted
//      (droppedUnpurchasable), RECORD untouched (tracked writers unmodified);
//      served picks tagged marketFormat.
//   4. DAILY-3 — lock mapper carries team/matchup/gameTime + marketFormat
//      (additive; older cards render without).
//   5. FE — milestone language ("2+") for over_only rows; identity line
//      (matchup · first pitch ET) on card, TOMORROW rows, Daily 3 rows, slip
//      tray; scripts parse.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const cfg = JSON.parse(rd("config/bookMarketFormats.json"))
check("config: DK batter families over_only, source-tagged, the Witt catch documented", ["hits", "totalBases", "rbis", "runs", "hr"].every((f) => cfg.draftkings?.[f]?.sides === "over_only" && cfg.draftkings[f].source && cfg.draftkings[f].verifiedAt) && /WITT CATCH/.test(cfg.draftkings.hits.note))
check("config: FD/MGM hits two_sided per operator statement (w/ vendor-coverage caveats noted)", cfg.fanduel?.hits?.sides === "two_sided" && cfg.betmgm?.hits?.sides === "two_sided" && /ZERO FD under rows/.test(cfg.fanduel.hits.note))

const { formatFor, underPurchasable } = require("../pipeline/shared/bookMarketFormats")
check("helper: DK hits under NOT purchasable (display-name + key forms both resolve)", underPurchasable("DraftKings", "hits") === false && underPurchasable("draftkings", "Hits") === false)
check("helper: UNKNOWN book/family never restricted (hardrockbet hits · DK pitcher ks · FD hits)", underPurchasable("Hard Rock Bet", "hits") === true && underPurchasable("draftkings", "ks") === true && underPurchasable("FanDuel", "hits") === true)
check("helper: formatFor returns the full source-tagged entry", formatFor("DraftKings", "hits")?.source === "operator-field")

const wr = rd("routes/workstationRoutes.js")
check("lens: under@over_only dropped PRE-DEDUP + counted + never-recommend doctrine", /droppedUnpurchasable\+\+; _repointTuples/.test(wr) && wr.indexOf("droppedUnpurchasable++") < wr.indexOf("const dedup = new Map()") && /droppedUnpurchasable,/.test(wr) && /never recommend an unpurchasable/i.test(wr)) // 2026-07-26: drop now also stashes the tuple for RE-POINT PASS 2 — same gate, added resolution
check("lens: served picks tagged marketFormat (unverified when unknown)", /pick\.marketFormat = fmt \? fmt\.sides : "unverified"/.test(wr))
check("record untouched: phase4Tracking writers unmodified by this gate", !/bookMarketFormats/.test(rd("pipeline/mlb/phase4Tracking.js")))

check("daily3: lock mapper carries identity + format (additive)", /team: p\.team \?\? null, matchup: p\.matchup \?\? null, gameTime: p\.gameTime \?\? null/.test(rd("pipeline/shared/daily3.js")) && /marketFormat: p\.marketFormat \?\? null/.test(rd("pipeline/shared/daily3.js")))

const fe = rd("../frontend/mobile/index.html")
check("FE: milestone language helper + identity line helper", /_pickLineNice/.test(fe) && /Math\.ceil\(Number\(p\.line\)\)/.test(fe) && /_gameIdLine/.test(fe) && /America\/New_York/.test(fe))
check("FE: wired on card + TOMORROW + Daily 3 + slip tray", (fe.match(/_pickLineNice\(/g) || []).length >= 5 && (fe.match(/_gameIdLine\(/g) || []).length >= 4 && /milestone/.test(fe))
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

console.log(`verifyObtainability: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
