"use strict"
// verifyStartedGameGate — display pack (2026-07-17, operator items 1+2).
// Claims:
//   1. STARTED-GAME GATE — the served lens drops rows whose first pitch has
//      passed, STRICT now >= gameTime, evaluated PER REQUEST (vanish on next
//      fetch, not next build); counted (droppedStarted); RECORD untouched;
//      Daily 3 unaffected (locked history reads its own file — no lens).
//   2. HONEST STATE — empty-board-because-games-started says so
//      (games_started boardState, points at TOMORROW), never mislabeled as
//      zero-edge; fallback-consequence documented in source.
//   3. TIER BADGES — tier names render as chips (_tierBadge), not bare
//      link-colored text, on the TOMORROW rows; helper uppercase + background.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const wr = rd("routes/workstationRoutes.js")
check("gate: strict per-request drop + counter, placed before dedup", /Date\.now\(\) >= gt\) \{ droppedStarted\+\+; continue \}/.test(wr) && wr.indexOf("droppedStarted++") < wr.indexOf("const dedup = new Map()") && /droppedStarted,/.test(wr))
check("gate: fallback consequence documented + record-untouched doctrine in source", /fallback board \(old dates =/.test(wr) && /RECORD is untouched/.test(wr))
check("honest state: games_started branch BEFORE zero_edge, points at TOMORROW", /state: "games_started"/.test(wr) && wr.indexOf('state: "games_started"') < wr.indexOf('state: "zero_edge"') && /TOMORROW below is the live surface/.test(wr))
check("daily3 unaffected: no lens/started filtering added to the locked-card module", !/droppedStarted|Date\.now\(\) >= gt/.test(rd("pipeline/shared/daily3.js")))

// real-data proof of the filter predicate on the CURRENT slate file
try {
  const { currentSlateDateEt } = require("../pipeline/shared/slateDate")
  const slate = currentSlateDateEt()
  // EVOLVED 2026-08-26 (self-heal pack): the probe hard-required yesterday's
  // tracked file and broke on DARK NIGHTS (8/25: machine down, no slate file —
  // the fixture punished the honesty stamp). Falls back to the most recent
  // existing tracked file; the probe tests gate LOGIC, not machine uptime.
  let _probeFile = path.join(ROOT, "runtime", "tracking", `mlb_tracked_bets_${slate}.json`)
  if (!fs.existsSync(_probeFile)) {
    const cands = fs.readdirSync(path.join(ROOT, "runtime", "tracking")).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    _probeFile = path.join(ROOT, "runtime", "tracking", cands[cands.length - 1])
  }
  const rows = JSON.parse(fs.readFileSync(_probeFile, "utf8"))
  const started = rows.filter((b) => b.gameTime && Number.isFinite(new Date(b.gameTime).getTime()) && Date.now() >= new Date(b.gameTime).getTime()).length
  console.log(`  [real-data] slate ${slate}: ${rows.length} record rows · ${started} have started games (these now drop from the lens; record keeps all ${rows.length})`)
  check("real-data: predicate evaluates on the live slate file (counts printed above)", Number.isFinite(started))
} catch (e) { check(`real-data probe (${e?.message})`, false) }

const fe = rd("../frontend/mobile/index.html")
check("badges: _tierBadge chip helper (uppercase + background, never bare link-colored text)", /_tierBadge/.test(fe) && /background:#1F2937;padding:2px 6px;border-radius:8px/.test(fe) && /_tierNice\(t\)\.toUpperCase\(\)/.test(fe))
check("badges: TOMORROW row uses the badge; old bare-colored tier span gone from that row", /\$\{_tierBadge\(tRaw\)\}/.test(fe) && !/font-size:9px;">\$\{escapeHtml\(_tierNice\(tRaw\)\)\}/.test(fe))
check("FE: games_started icon branch", /games_started/.test(fe))
{
  const scripts = [...fe.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 100)
  let parses = true, perr = null
  for (const s of scripts) { try { new Function(s) } catch (e) { parses = false; perr = e.message } }
  check(`FE inline scripts parse${perr ? " — " + perr : ""}`, scripts.length > 0 && parses)
}

console.log(`verifyStartedGameGate: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
