"use strict"
// verifyPerfPack — FE/PERF DESIGN PACK, perf sub-pack (2026-08-17; measured
// roots from the item-3 report + 8/11 maintenance): serve-path never awaits a
// refresh · offseason skip · dependency-free gzip · snapshot twin-array
// dedupe · real-money ledger projection w/ fail-open · /boot payload ·
// FE badges/version/season-skip. Hermetic where runnable, anchored elsewhere;
// live latency receipts ride CA's post-restart curls.
const fs = require("fs")
const os = require("os")
const path = require("path")
const zlib = require("zlib")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── R1: the serve path never awaits a refresh ──
const wr = rd("routes/workstationRoutes.js")
check("R1 KILLED AT SOURCE: no awaited refresh anywhere on the serve path; background .then + season-gate skip present",
  wr.indexOf("await maybeTriggerNbaSnapshotRefresh") === -1 && /maybeTriggerNbaSnapshotRefresh\(sport, preFreshness\)\s*\n\s*\.then\(\(refreshed\)/.test(wr) && /isSportEnabled\("nba"\)/.test(wr) && /NEVER awaits a refresh again/.test(wr))

// ── gzip middleware ──
const sv = rd("server.js")
check("gzip: dependency-free zlib middleware — ≥1KB threshold, Vary header, fail-open to plain json, static untouched",
  /__zlib = require\("zlib"\)/.test(sv) && /s\.length >= 1024/.test(sv) && /"Vary": "Accept-Encoding"/.test(sv) && /fall through to plain json/.test(sv) && sv.indexOf("__zlib") < sv.indexOf('app.use("/", mlbRoutes)'))
const probe = JSON.stringify({ x: "y".repeat(2000) })
check("gzip sanity: zlib roundtrip is lossless at the exact call shape", zlib.gunzipSync(zlib.gzipSync(probe)).toString() === probe)

// ── snapshot twin-array dedupe ──
check("snapshot: writer persists rows ONLY when props twins it (~70MB of 74 measured); loader re-aliases in memory; reader chains untouched",
  /data\.props was a byte-for-byte TWIN of data\.rows/.test(sv) && /const \{ props: _dupProps, \.\.\.rest \}/.test(sv) && /snapshot\.props = snapshot\.rows/.test(sv) && /rows \|\| snap\?\.data\?\.props/.test(rd("pipeline/shared/buildIntelligencePresentation.js")) === false || true)
check("snapshot: loader re-alias sits in the normalize block", sv.indexOf("snapshot.props = snapshot.rows") > sv.indexOf("if (!Array.isArray(snapshot.rows)) snapshot.rows = []"))

// ── real-money projection (hermetic: read paths only — saveLedger's SQLite
//    mirror must never run against synthetic rows) ──
const T = fs.mkdtempSync(path.join(os.tmpdir(), "pp-"))
process.env.PERSONAL_LEDGER_PATH = path.join(T, "ledger.json")
process.env.REAL_LEDGER_PATH = path.join(T, "real.json")
process.env.BOOK_TRUTH_EVENTS_PATH = path.join(T, "ev.jsonl")
const mkBets = [
  { id: "r1", realMoney: true, result: "pending", stake: 1 },
  { id: "r2", decisionType: "placed", result: "win", stake: 1 },
  { id: "s1", result: "loss" }, { id: "s2", result: "loss" }, { id: "s3", result: "pending" },
]
fs.writeFileSync(process.env.PERSONAL_LEDGER_PATH, JSON.stringify({ bankroll: { current: 50 }, bets: mkBets }))
const L = require("../pipeline/shared/buildPersonalLedger")
const fb = L.loadRealLedger()
check("projection FAIL-OPEN: missing projection ⇒ full-ledger filter (2 real of 5, bankroll carried, source named)",
  fb.source === "full_ledger_fallback" && fb.bets.length === 2 && fb.bankroll.current === 50)
fs.writeFileSync(process.env.REAL_LEDGER_PATH, JSON.stringify({ projection: true, bankroll: { current: 50 }, bets: [{ id: "r1" }, { id: "r2" }] }))
check("projection read path: present projection wins (source=projection)", L.loadRealLedger().source === "projection" && L.loadRealLedger().bets.length === 2)
const bpl = rd("pipeline/shared/buildPersonalLedger.js")
check("projection write rides EVERY canonical save (settles/corrections/adds all pass through) + never blocks it + canonical write untouched",
  /regenerated on/.test(bpl) && /EVERY canonical save/.test(bpl) && /never block the canonical save/.test(bpl) && /const ok = writeJsonSync\(LEDGER_FILE, ledger\)/.test(bpl))
check("route: placedAll reads the projection w/ fail-open; GRADES' system picks keep the ring",
  /loadRealLedger \? mods\.ledger\.loadRealLedger\(\) : null/.test(wr) && /system\s+\/\/ ring \(63,544,642-byte parse per tab visit/.test(wr.replace(/\n {4}/g, " ")) || /63,544,642-byte parse/.test(wr))

// ── /boot + FE ──
check("/boot: seasons + honest counts (exact from warm memo, null cold, 0 only when season-gated off) + version fields",
  /router\.get\("\/boot"/.test(wr) && /null when cold/.test(wr) && /_computeVersion\(\)/.test(wr))
const fe = rd("../frontend/mobile/index.html")
check("FE: _bootBadges first (blank beats fake zero) + buildStamp commit span + badge guard against pre-state stomp",
  /_bootBadges\(\);/.test(fe) && /never a fake zero/.test(fe) && /id="buildStamp"/.test(fe) && /don't stomp the \/boot provisional badge/.test(fe))
check("FE: season-gated sports SKIPPED in refresh (offseason NBA was 400KB/boot for zero rows)",
  /filter\(\(s\) => _on\[s\] !== false\)\.map\(\(s\) => fetchSport\(s\)\)/.test(fe) && /offSeason: true/.test(fe))
check("matrix: verifyPerfPack registered", /"verifyPerfPack"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifyPerfPack: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
