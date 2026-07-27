"use strict"
// verifyLadderCapture — G2 ENABLER: FULL LADDER CAPTURE (2026-07-16, CC audit §6).
// Claims under test:
//   1. ADDITIVE ISOLATION — the capture script never touches snapshot-mlb.json,
//      openOdds baselines, scoring, or serving; alternate keys ONLY (base
//      markets stay on the hourly path); trueOpen fetch pattern incl. the
//      invalid-markets retry.
//   2. QUOTA GUARD — hard DAILY_CAP with mid-pass stop, RESERVE_FLOOR abort
//      (board quota wins), REAL costs from x-requests-last (never estimates),
//      per-day spend persisted, honest logged skips (cap/no-games/off-season).
//   3. STORE — game-date-keyed files (slate-date doctrine via
//      slateDateForTimestamp on commence time), pass history APPENDED (rung
//      movement preserved), only priced outcomes stored (never fabricated).
//   4. WIRING — scheduler 3 passes (10:00 / 17:00 / 22:05 ET, dedupe vars),
//      componentHealthCheck ladderCapture line with honest no-games skip.
const fs = require("fs")
const path = require("path")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

const lad = rd("scripts/captureMlbLadders.js")
check("isolation: no snapshot write, no scoring/serving imports, alternates only", !/writeFileSync\([^)]*snapshot/.test(lad) && !/require\([^)]*(phase4Tracking|workstationRoutes)/.test(lad) && /_alternate/.test(lad) && !/"batter_hits",|"pitcher_strikeouts",/.test(lad))
check("isolation: invalid-markets retry (vendor drift self-corrects)", /invalid markets:/.test(lad) && /kept\.join\(","\)/.test(lad))
check("quota: DAILY_CAP + mid-pass stop + RESERVE_FLOOR abort (board wins)", /DAILY_CAP = 600/.test(lad) && /daily cap .* reached mid-pass|daily cap \$\{DAILY_CAP\} reached mid-pass/.test(lad) && /RESERVE_FLOOR = 5000/.test(lad) && /quota belongs to the live board/.test(lad))
check("quota: REAL cost from x-requests-last header + persisted per-day spend", /x-requests-last/.test(lad) && /ladder_quota\.json/.test(lad) && /recordQuotaSpend/.test(lad))
check("quota: honest skips (cap / no-games / season / no key) — no silent paths", /SKIPPED — daily ladder cap/.test(lad) && /honest no-games skip/.test(lad) && /MLB season OFF/.test(lad) && /no ODDS_API_KEY/.test(lad))
check("store: game-date keyed via slateDateForTimestamp(commence), pass history appended", /slateDateForTimestamp\(ms\)/.test(lad) && /mlb_ladders_\$\{gameDate\}\.json/.test(lad) && /store\.passes\.push/.test(lad) && /store\.rows\.push\(\.\.\.rows\)/.test(lad))
check("store: only priced outcomes (never fabricated rungs)", /if \(!player \|\| !Number\.isFinite\(oddsAmerican\)\) continue/.test(lad))

// unit: the payload→rungs flattener against a synthetic multi-rung payload
try {
  const { rungRowsFromPayload, LADDER_MARKETS } = require("./captureMlbLadders")
  const payload = {
    id: "ev1", commence_time: "2026-07-16T23:11:00Z", away_team: "Mets", home_team: "Phillies",
    bookmakers: [{ key: "fanduel", markets: [
      { key: "batter_total_bases_alternate", outcomes: [
        { description: "Juan Soto", name: "Over", point: 1.5, price: -180 },
        { description: "Juan Soto", name: "Over", point: 2.5, price: 150 },
        { description: "Juan Soto", name: "Over", point: 3.5, price: 400 },
        { description: "Juan Soto", name: "Over", point: 4.5 }, // NO price — must be dropped
      ] },
      { key: "batter_hits", outcomes: [{ description: "Juan Soto", name: "Over", point: 0.5, price: -250 }] }, // base key — not a ladder market
    ] }],
  }
  const rows = rungRowsFromPayload(payload, {}, { capturedAt: "t", pass: "unit" })
  check("unit: 3 priced rungs kept for one player/family/book; unpriced + base-market dropped", rows.length === 3 && rows.every((r) => r.player === "Juan Soto" && r.family === "batter_total_bases_alternate" && r.book === "fanduel") && new Set(rows.map((r) => r.line)).size === 3)
  check("unit: ladder market keys ≥8, all _alternate, covering batter+pitcher families", LADDER_MARKETS.length >= 8 && LADDER_MARKETS.every((k) => k.endsWith("_alternate")) && LADDER_MARKETS.some((k) => k.startsWith("batter_")) && LADDER_MARKETS.some((k) => k.startsWith("pitcher_"))) // 2026-07-26: family expansion grows the list — floor not exact-count (the anchor lesson, list-size edition)
} catch (e) { check(`unit: module loads (${e?.message})`, false) }

const sched = rd("scripts/scheduler.sh")
check("scheduler: 10:00 + 17:00 pass block with dedupe var", /-eq 10 \] \|\| \[ "\$HOUR" -eq 17/.test(sched) && /last_ladder_min/.test(sched))
check("scheduler: 22:05 night-owl pass (tomorrow's opening rungs)", /MIN" -eq 5 \] && \[ "\$HOUR" -eq 22/.test(sched) && /--pass=nightowl/.test(sched) && /last_ladder_no_min/.test(sched))
const chc = rd("scripts/componentHealthCheck.js")
check("health: ladderCapture component with honest no-games skip + fail-after-window", /function checkLadderCapture/.test(chc) && /honest skip \(passes fire 10:00\/17:00\/22:05 ET/.test(chc) && /NO ladder pass ran after the 10:00 ET window/.test(chc) && /"ladderCapture"/.test(chc)) // 2026-07-16: membership not tail-anchor (order array grew — rungScan); same lesson as verifyHonestComms

console.log(`verifyLadderCapture: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
