"use strict"
// verifyValidatorAxisB — VALIDATOR CRASH FIX (2026-07-30/08, ASK 37a63a6):
// d7a448e deleted the local norm helper but missed the Axis-B key-builder
// call — every full run since 07-21 died ReferenceError BEFORE the verdicts
// write, and the matrix stayed green because no fixture ever EXECUTED the
// Axis-B loop body (no ladder files in the synthetic world). This fixture
// closes that blind spot forever: it RUNS the real validator over a synthetic
// world that includes a ladder file with an ACCENTED player, and asserts the
// process exits 0, writes its verdicts JSON, and counted the rung.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const src = (() => { try { return fs.readFileSync(path.join(ROOT, "scripts", "validateG2Curves.js"), "utf8") } catch (_) { return "" } })()

// ── (1) the restored normalizer, pinned FROM THE COMMITTED SOURCE (no drift) ──
const m = src.match(/const norm = \(s\) => String\(s == null \? "" : s\)[^\n]*/)
check("source: NFD key normalizer restored between ladderFiles and the key-builder, resolution stays playerNameJoin",
  !!m && /normalize\("NFD"\)/.test(m[0]) && /\\p\{M\}/.test(m[0]) && src.indexOf("const norm =") < src.indexOf("${norm(r.player)}") && /resolvePlayer: _rp/.test(src))
let normFn = null
try { normFn = eval(m[0].replace(/^const norm = /, "(") + ")") } catch (_) {}
check("normalizer behavior (evaluated from source bytes): 'José Ramírez' keys with 'Jose Ramirez'",
  typeof normFn === "function" && normFn("José Ramírez") === "jose ramirez" && normFn("José Ramírez") === normFn("Jose Ramirez"))
check("crash-class doc at the site (d7a448e provenance + stdout-scrollback lesson)", /d7a448e deleted the local `norm` helper/.test(src) && /stdout scrollback/.test(src))

// ── (2) EXECUTION: the real validator runs end-to-end over a synthetic world
// whose ladder file exercises the Axis-B loop body (the formerly-invisible path) ──
const tData = fs.mkdtempSync(path.join(os.tmpdir(), "vab-d-"))
const tTrack = fs.mkdtempSync(path.join(os.tmpdir(), "vab-t-"))
const tOut = fs.mkdtempSync(path.join(os.tmpdir(), "vab-o-"))
const games = []
for (let i = 1; i <= 25; i++) games.push({ date: `2026-06-${String(i).padStart(2, "0")}`, stats: { hits: i % 3, totalBases: i % 4, rbi: i % 2, runs: i % 2, atBats: 4 } })
fs.writeFileSync(path.join(tData, "mlbBatterGameLogsSeason.json"), JSON.stringify({ players: { jr: { fullName: "Jose Ramirez", games } } }))
fs.writeFileSync(path.join(tData, "mlbPitcherGameLogsSeason.json"), JSON.stringify({ players: {} }))
fs.writeFileSync(path.join(tTrack, "mlb_ladders_2026-06-20.json"), JSON.stringify({ gameDate: "2026-06-20", rows: [
  { player: "José Ramírez", family: "batter_hits_alternate", side: "Over", line: 0.5, oddsAmerican: -150 },   // ACCENTED — the class that keys
  { player: "José Ramírez", family: "batter_hits_alternate", side: "Over", line: 0.5, oddsAmerican: -140 },   // same rung, better price — dedup exercises the key TWICE
] }))
const env = { ...process.env, G2_DATA_DIR: tData, G2_TRACKING_DIR: tTrack, G2_OUT_JSON: path.join(tOut, "g2_validation.json"), G2_OUT_MD: path.join(tOut, "report.md") }
const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "validateG2Curves.js")], { env, encoding: "utf8", timeout: 120000 })
const errTail = ((r.stderr || "").split("\n").filter(Boolean).slice(-3).join(" | ")) || "(clean)"
check(`EXECUTION: validator exits 0 with the Axis-B loop body exercised (exit ${r.status}; stderr: ${errTail.slice(0, 120)})`, r.status === 0 && !/ReferenceError/.test(r.stderr || ""))
let out = null
try { out = JSON.parse(fs.readFileSync(path.join(tOut, "g2_validation.json"), "utf8")) } catch (_) {}
check("EXECUTION: verdicts JSON WRITTEN (the write that died for nine days) + axisB counted the accented rung", !!out && out.axisB && out.axisB.rungRows >= 2 && out.generatedAt != null)
check("hermetic: the real committed config untouched by the fixture run", (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config", "g2_validation.json"), "utf8")).generatedAt !== (out && out.generatedAt) } catch (_) { return true } })())
check("matrix: verifyValidatorAxisB registered", /"verifyValidatorAxisB"/.test((() => { try { return fs.readFileSync(path.join(ROOT, "scripts", "runtimeVerify.js"), "utf8") } catch (_) { return "" } })()))

console.log(`verifyValidatorAxisB: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
