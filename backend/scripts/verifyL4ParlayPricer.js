"use strict"
// verifyL4ParlayPricer — G3-L4 cross-game parlay pricer (2026-07-21).
// Claims: certification-license refusal · structural cross-game guard (≤3
// legs, distinct eventIds — same-game impossible) · blend-primary legs w/ raw
// recorded + policy labels · void/pending settle semantics (coverage-guarded,
// never guessed) · named paper gate verbatim (14/100/3pp/≥0u/split-half/
// operator; G4 unchanged) · shadow-only writes · scheduler + alarm wired ·
// synthetic e2e (composes cross-game only, prices correctly, refuses when
// uncertified).
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")

let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const src = fs.readFileSync(path.join(ROOT, "scripts", "scanParlayEv.js"), "utf8")

check("license: refuses without CERTIFIED_INDEPENDENT (exit 1, no writes)", /REFUSES: cross_game independence is NOT certified/.test(src) && src.indexOf("process.exit(1)") < src.indexOf("settleParlays"))
check("structure: distinct-eventId guard + ≤3 legs + pool/parlay caps", /legs\[i\]\.eventId === legs\[j\]\.eventId\) continue/.test(src) && /MAX_LEGS_POOL = 12/.test(src) && /MAX_PARLAYS = 120/.test(src))
check("legs: blend-primary + raw recorded + per-policy labels", /pBlend: l\.cures\.pBlend, pFair: l\.pFair, policies/.test(src))
check("settle: all-hit win = dec−1 · any miss −1 · coverage-proven no-appearance VOID · pending never guessed", /anyVoid = true \/\/ no appearance, coverage-proven/.test(src) && /if \(anyPending\) continue \/\/ never guessed/.test(src) && /units: \+\(p\.decCombined - 1\)\.toFixed\(3\)/.test(src))
check("gate verbatim: 14 nights / 100 settled / 3pp / ≥0u / split-half / operator; G4 unchanged", /needNights: 14, needSettled: 100, gapBarPp: 3, unitsBar: 0/.test(src) && /G4 live gate unchanged/.test(src))
check("shadow-only: artifact + ledger writes only; no serving/tracked writes", /shadow: true/.test(src) && !/workstationRoutes|persistTracked/.test(src) && !/writeFileSync\([^)]*tracked_(bets|best)/.test(src))
const sched = fs.readFileSync(path.join(ROOT, "scripts", "scheduler.sh"), "utf8")
check("wiring: 17:20 + 22:25 scheduler fires + parlayScan alarm", /MIN" -eq 20 \] && \[ "\$HOUR" -eq 17/.test(sched) && /last_parlayscan_min/.test(sched) && /checkParlayScan/.test(fs.readFileSync(path.join(ROOT, "scripts", "componentHealthCheck.js"), "utf8")))

// ── synthetic e2e ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l4parlay-"))
const track = path.join(tmp, "tracking"); fs.mkdirSync(track)
const FUT = "2099-01-02"
const mkRow = (player, fam, ev, pBlend, odds) => ({ player, family: fam, line: 0.5, k: 1, eventId: ev, book: "fanduel", oddsAmerican: odds, pFair: pBlend + 0.02, implied: 0.3, edgePp: 5, marginPp: 2, evPer$1: 0.2, flagged: true, cures: { pBlend, flagA: true, flagB: false, flagC: false }, curveN: 40, method: "negbinom" })
fs.writeFileSync(path.join(track, `mlb_rung_scan_${FUT}.json`), JSON.stringify({ gameDate: FUT, rows: [mkRow("P One", "hits", "e1", 0.6, 120), mkRow("P Two", "hits", "e1", 0.55, 150), mkRow("P Three", "runs", "e2", 0.5, 100), mkRow("P Four", "ks", "e3", 0.4, -110)] }))
fs.writeFileSync(path.join(tmp, "g3ok.json"), JSON.stringify({ results: { cross_game: { verdict: "CERTIFIED_INDEPENDENT" } } }))
fs.writeFileSync(path.join(tmp, "g3bad.json"), JSON.stringify({ results: { cross_game: { verdict: "STOP" } } }))
fs.writeFileSync(path.join(tmp, "mlbBatterGameLogsSeason.json"), JSON.stringify({ players: {} }))
fs.writeFileSync(path.join(tmp, "mlbPitcherGameLogsSeason.json"), JSON.stringify({ players: {} }))
const env = (verd) => ({ ...process.env, L4_TRACKING_DIR: track, L4_DATA_DIR: tmp, L4_VERDICTS: path.join(tmp, verd), L4_LEDGER: path.join(track, "ledger.jsonl") })
const rBad = spawnSync(process.execPath, [path.join(ROOT, "scripts", "scanParlayEv.js")], { env: env("g3bad.json"), encoding: "utf8", timeout: 60000 })
check("e2e: uncertified verdicts ⇒ REFUSAL exit 1, no ledger", rBad.status === 1 && !fs.existsSync(path.join(track, "ledger.jsonl")))
const rOk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "scanParlayEv.js")], { env: env("g3ok.json"), encoding: "utf8", timeout: 60000 })
let art = null
try { art = JSON.parse(fs.readFileSync(path.join(track, `mlb_parlay_scan_${FUT}.json`), "utf8")) } catch (_) {}
const ledger = fs.existsSync(path.join(track, "ledger.jsonl")) ? fs.readFileSync(path.join(track, "ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []
check(`e2e: certified ⇒ prices + ledgers (exit ${rOk.status})`, rOk.status === 0 && art && art.candidates > 0 && ledger.filter((e) => e.type === "parlay").length > 0)
check("e2e: NO parlay pairs P One × P Two (same event e1) — cross-game structural guard holds", ledger.filter((e) => e.type === "parlay").every((p) => new Set(p.legs.map((l) => l.eventId)).size === p.legs.length))
const two = ledger.find((e) => e.type === "parlay" && e.legs.length === 2 && e.legs.every((l) => ["P One", "P Three"].includes(l.player)))
check("e2e: product pricing exact (0.6×0.5 joint, 2.2×2.0 decimal)", two && Math.abs(two.joint - 0.3) < 1e-9 && Math.abs(two.decCombined - 4.4) < 1e-9)

console.log(`verifyL4ParlayPricer: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
