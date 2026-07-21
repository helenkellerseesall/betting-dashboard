"use strict"
// verifyG2Scanner — G2-L3 shadow rung-EV scanner (2026-07-16, approved scope).
// Claims under test:
//   1. SHADOW DOCTRINE — writes ONLY mlb_rung_scan_* + the flag ledger; no
//      tracked_bets/best/picks writes, no serving imports, artifact stamped
//      shadow:true; nothing bettor-facing (no FE/route references anywhere).
//   2. ELIGIBILITY — PASS families from the COMMITTED verdicts JSON only, AND
//      the operator's hard-exclusion of totalBases/rbis; frozen constants
//      consumed, never re-chosen.
//   3. FLB MARGINS — flag requires edge > max(2pp, 1.5 × measured bucket gap);
//      thin buckets inherit the family's WORST eligible gap (conservative).
//   4. HONESTY — beyond-tail-support rungs unpriced; below-floor players
//      absent; unsettled flags stay pending (no gamelog row ⇒ no settle).
//   5. GATE — the named thresholds (14 nights / 300 decided / 1.5pp / ≥0u /
//      split-half) computed by the ledger tally and printed every run.
//   6. WIRING — scheduler 17:15 + 22:20 fires; componentHealthCheck rungScan.
//   7. E2E — synthetic tmp run: flags respect margins, ledger appends, settle
//      pass settles a played game + leaves an unplayed one pending.
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const src = fs.readFileSync(path.join(ROOT, "scripts", "scanRungEv.js"), "utf8")

check("shadow: only scan artifact + ledger written; artifact stamped shadow:true", /mlb_rung_scan_\$\{gameDate\}\.json/.test(src) && /shadow: true/.test(src) && !/workstationRoutes|persistTracked/.test(src) && !/writeFileSync\([^)]*tracked_(bets|best)/.test(src)) // 2026-07-21: reads of tracked_best (team truth, G3-L3) are legitimate; the doctrine bars WRITES
check("eligibility: verdict===PASS AND hard-excluded tb/rbis (commit-gated list)", /HARD_EXCLUDED = \["totalBases", "rbis"\]/.test(src) && /v\.verdict === "PASS" && !HARD_EXCLUDED\.includes\(fam\)/.test(src))
check("frozen constants consumed from committed verdicts (never re-chosen)", /verdicts\.frozenHalfLife/.test(src) && /effectiveMinN \|\| 8/.test(src) && /No scan\."\); process\.exit\(1\)/.test(src))
check("FLB margin: max(2pp, 1.5×bucket gap) + thin-bucket worst-gap fallback", /Math\.max\(0\.02, 1\.5 \* bucketGap/.test(src) && /worst/.test(src))
check("honesty: tail-support skip + floor absence + pending-never-guessed settle", /honestly unpriced/.test(src) && /honest absence/.test(src) && /PENDING, never guessed/.test(src))
check("gate: named thresholds in the tally (14/300/1.5pp/≥0u/split-half)", /needNights: 14, needDecided: 300, gapBarPp: 1\.5, unitsBar: 0/.test(src) && /halves/.test(src))
const sched = fs.readFileSync(path.join(ROOT, "scripts", "scheduler.sh"), "utf8")
check("scheduler: 17:15 + 22:20 fires w/ dedupe vars", /MIN" -eq 15 \] && \[ "\$HOUR" -eq 17/.test(sched) && /MIN" -eq 20 \] && \[ "\$HOUR" -eq 22/.test(sched) && /last_rungscan_min/.test(sched) && /last_rungscan_no_min/.test(sched))
const chc = fs.readFileSync(path.join(ROOT, "scripts", "componentHealthCheck.js"), "utf8")
check("health: rungScan line (green w/ gate tally · honest skip · fail-after-window)", /function checkRungScan/.test(chc) && /SHADOW\)/.test(chc) && /"rungScan"/.test(chc)) // 2026-07-21: membership not tail-anchor — third instance of the lesson; the order array grows

// ── synthetic e2e in tmp (mount untouched) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g2scan-"))
const track = path.join(tmp, "tracking"); fs.mkdirSync(track)
const mkGames = (counts, startDay) => counts.map((c, i) => ({ date: `2026-07-${String(startDay + i).padStart(2, "0")}`, stats: { hits: c, runs: c, strikeOuts: c + 4 } }))
// hot hitter: 16 games of mostly 2 hits ⇒ P(≥1) high, P(≥2) solid
const players = { "hot hitter": { fullName: "Hot Hitter", games: mkGames([2, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 2, 2, 1, 2, 2], 1) } }
fs.writeFileSync(path.join(tmp, "mlbBatterGameLogsSeason.json"), JSON.stringify({ players }))
fs.writeFileSync(path.join(tmp, "mlbPitcherGameLogsSeason.json"), JSON.stringify({ players: {} }))
// verdicts fixture: hits PASS w/ tight gaps; runs PASS; ks PASS; tb/rbis STOP
const rows = [[0, 0.02], [0.02, 0.05], [0.05, 0.10], [0.10, 0.20], [0.20, 0.35], [0.35, 0.50], [0.50, 1.001]].map((b, i) => ({ range: "r" + i, n: 1000, stated: (b[0] + b[1]) / 2, realized: (b[0] + b[1]) / 2, gap: 0.005 }))
fs.writeFileSync(path.join(tmp, "g2_validation.json"), JSON.stringify({ frozenHalfLife: null, bucketBounds: [[0, 0.02], [0.02, 0.05], [0.05, 0.10], [0.10, 0.20], [0.20, 0.35], [0.35, 0.50], [0.50, 1.001]], verdicts: { hits: { verdict: "PASS" }, runs: { verdict: "PASS" }, ks: { verdict: "PASS" }, totalBases: { verdict: "STOP" }, rbis: { verdict: "STOP" } }, famTables: { hits: rows, runs: rows, ks: rows } }))
// ladders: TODAY(-ish future) game: mispriced 1+ hits (+150 on a ~97% event ⇒ flag) + fair 2+ (no flag) + a tb rung (must be ignored)
// plus YESTERDAY's game with a flag to settle (played: 2026-07-17 log row exists? our hitter's games run 07-01..07-16)
const FUT = "2099-01-01" // far-future slate ⇒ always ≥ today
fs.writeFileSync(path.join(track, `mlb_ladders_${FUT}.json`), JSON.stringify({ gameDate: FUT, passes: [], rows: [
  { player: "Hot Hitter", family: "batter_hits_alternate", side: "Over", line: 0.5, oddsAmerican: 150, book: "fanduel" },
  { player: "Hot Hitter", family: "batter_hits_alternate", side: "Over", line: 1.5, oddsAmerican: -260, book: "fanduel" },
  { player: "Hot Hitter", family: "batter_total_bases_alternate", side: "Over", line: 0.5, oddsAmerican: 200, book: "fanduel" },
] }))
// pre-seed a settled-able flag: game 2026-07-10 (CLEARLY past any slate
// boundary; log row exists, hits=2 ⇒ 2+ hits HIT at +120 ⇒ +1.2u) + a
// missing-player flag that must stay PENDING.
fs.writeFileSync(path.join(track, "rung_flag_ledger.jsonl"), JSON.stringify({ type: "flag", id: "2026-07-10|hot hitter|hits|1.5|dk", gameDate: "2026-07-10", player: "Hot Hitter", family: "hits", line: 1.5, k: 2, book: "dk", oddsAmerican: 120, pFair: 0.6, implied: 0.4545, flaggedAt: "t" }) + "\n" + JSON.stringify({ type: "flag", id: "2026-07-09|missing player|hits|1.5|dk", gameDate: "2026-07-09", player: "Missing Player", family: "hits", line: 1.5, k: 2, book: "dk", oddsAmerican: 120, pFair: 0.6, implied: 0.4545, flaggedAt: "t" }) + "\n")
const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "scanRungEv.js")], { env: { ...process.env, G2_DATA_DIR: tmp, G2_TRACKING_DIR: track, G2_VERDICTS: path.join(tmp, "g2_validation.json"), RUNG_LEDGER: path.join(track, "rung_flag_ledger.jsonl") }, encoding: "utf8", timeout: 60000 })
check(`e2e: scanner exits 0 (${(r.stderr || "").split("\n")[0] || "ok"})`, r.status === 0)
let art = null
try { art = JSON.parse(fs.readFileSync(path.join(track, `mlb_rung_scan_${FUT}.json`), "utf8")) } catch (_) {}
check("e2e: artifact written, shadow-stamped, tb rung ABSENT (hard-excluded)", art && art.shadow === true && art.rows.every((x) => x.family !== "totalBases"))
const flagRow = art && art.rows.find((x) => x.line === 0.5 && x.family === "hits")
const fairRow = art && art.rows.find((x) => x.line === 1.5 && x.family === "hits")
check("e2e: mispriced rung FLAGGED past margin; fairly-priced rung NOT flagged", flagRow && flagRow.flagged === true && fairRow && fairRow.flagged === false)
const ledger = fs.readFileSync(path.join(track, "rung_flag_ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const settles = ledger.filter((e) => e.type === "settle")
check("e2e: settle pass — played flag settles (hit=1, +1.2u); missing-player flag stays PENDING", settles.length === 1 && settles[0].id.startsWith("2026-07-10") && settles[0].hit === 1 && Math.abs(settles[0].units - 1.2) < 0.001)
check("e2e: gate tally printed with named bars", /gate tally \[raw\]: .*\/14 nights .*\/300 decided/.test(r.stdout))

console.log(`verifyG2Scanner: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
