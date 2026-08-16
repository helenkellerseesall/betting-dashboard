"use strict"
// verifyNflCapture — NFL CAPTURE-FIRST (2026-08-15, standing queue; CC
// eee5b6f, CA triage 342262e): config-driven 8+3 key capture, verbatim-side
// rows, same-window idempotency, season-gate honesty, scheduler windows,
// ships-with alarm #25. Hermetic via NFL_STUB_DIR / NFL_TRACKING_DIR.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const ROOT = path.join(__dirname, "..")
let pass = 0, fail = 0; const failures = []
const check = (l, c) => { if (c) pass++; else { fail++; failures.push(l) } }
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8") } catch (_) { return "" } }

// ── config is the capture authority ──
const cfg = JSON.parse(rd("config/nflCaptureKeys.json"))
check("config: 8 base + 3 alt keys, receptions the beachhead, ranks 6-7 excluded, attempts-keys flag documented for CA",
  cfg.baseMarkets.length === 8 && cfg.altMarkets.length === 3 && cfg.baseMarkets[0] === "player_receptions" && cfg.altMarkets.every((k) => /_alternate$/.test(k)) && /FLAGGED for CA verification/.test(cfg._doc) && !cfg.baseMarkets.some((k) => /tackle|kicker|defense/.test(k)))

// ── hermetic capture run against a stub vendor ──
const stub = fs.mkdtempSync(path.join(os.tmpdir(), "nflS-"))
const track = fs.mkdtempSync(path.join(os.tmpdir(), "nflT-"))
const soon = new Date(Date.now() + 2 * 86400000).toISOString()
fs.writeFileSync(path.join(stub, "events.json"), JSON.stringify([
  { id: "ev1", commence_time: soon, home_team: "Kansas City Chiefs", away_team: "Baltimore Ravens" },
  { id: "evOld", commence_time: "2026-01-01T18:00:00Z", home_team: "X", away_team: "Y" },
]))
fs.writeFileSync(path.join(stub, "odds_ev1.json"), JSON.stringify({ id: "ev1", commence_time: soon, home_team: "Kansas City Chiefs", away_team: "Baltimore Ravens", bookmakers: [
  { key: "draftkings", markets: [
    { key: "player_receptions", outcomes: [
      { name: "Over", description: "Travis Kelce", point: 5.5, price: -115 },
      { name: "Under", description: "Travis Kelce", point: 5.5, price: -105 },
    ] },
    { key: "player_receptions_alternate", outcomes: [{ name: "Over", description: "Travis Kelce", point: 7.5, price: 220 }] },
    { key: "player_anytime_td", outcomes: [{ name: "Yes", description: "Isiah Pacheco", price: 130 }, { name: "No Price", description: "Ghost", point: 1 }] },
  ] },
] }))
const env = { ...process.env, NFL_STUB_DIR: stub, NFL_TRACKING_DIR: track }
const r1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "captureNflProps.js"), "thu_morning_open"], { env, encoding: "utf8", timeout: 30000 })
const day = require("../pipeline/shared/slateDate").calendarDateForTimestamp(Date.now())
const artP = path.join(track, `nfl_props_capture_${day}.json`)
const art = JSON.parse(fs.readFileSync(artP, "utf8"))
check(`capture e2e (exit ${r1.status}): 4 priced rows from the stub (unpriced outcome refused), past event filtered by horizon`,
  r1.status === 0 && art.rows.length === 4 && !art.rows.some((r) => r.player === "Ghost"))
const kelce = art.rows.find((r) => r.marketKey === "player_receptions" && r.side === "Over")
const td = art.rows.find((r) => r.marketKey === "player_anytime_td")
check("row shape: family mapping + matchup + pass label + capturedAt + line/odds numeric",
  kelce.family === "receptions" && kelce.line === 5.5 && kelce.oddsAmerican === -115 && kelce.pass === "thu_morning_open" && /Ravens @ Kansas City/.test(kelce.matchup) && !!kelce.capturedAt)
check("SEV-1 seam honored: anytime-TD side stored VERBATIM as \"Yes\" (capture = record-of-market; graders refuse unknown sides — pinned in verifyBookTruth)",
  td.side === "Yes" && td.family === "anytimeTd" && td.line === null)
// idempotency: same window re-run replaces, never duplicates
spawnSync(process.execPath, [path.join(ROOT, "scripts", "captureNflProps.js"), "thu_morning_open"], { env, encoding: "utf8", timeout: 30000 })
const art2 = JSON.parse(fs.readFileSync(artP, "utf8"))
check("idempotent: same-window re-run keeps 4 rows (dedupe by pass|event|market|player|side|line|book)", art2.rows.length === 4)
// second window appends
spawnSync(process.execPath, [path.join(ROOT, "scripts", "captureNflProps.js"), "fri_post_designation"], { env, encoding: "utf8", timeout: 30000 })
const art3 = JSON.parse(fs.readFileSync(artP, "utf8"))
check("multi-pass: a different window appends its own rows (8 total, passes tracked)", art3.rows.length === 8 && art3.passes.thu_morning_open === 4 && art3.passes.fri_post_designation === 4)

// ── season-gate honesty (real config: nfl=false ships) ──
const rGate = spawnSync(process.execPath, [path.join(ROOT, "scripts", "captureNflProps.js"), "probe"], { env: { ...process.env, NFL_TRACKING_DIR: track, NFL_STUB_DIR: "" }, encoding: "utf8", timeout: 30000 })
check("season gate: nfl=false ⇒ honest no-op BEFORE any network (no key needed, nothing written)",
  rGate.status === 0 && /nfl=false in seasonsActive\.json — honest no-op/.test(rGate.stdout))

// ── source anchors ──
check("scheduler: 4 windows on the NFL clock w/ dedupe var + self-gate doctrine",
  ["wed_tnf_open", "thu_morning_open", "fri_post_designation", "sun_prekick", "last_nfl_capture_min"].every((s) => rd("scripts/scheduler.sh").includes(s)))
const chc = rd("scripts/componentHealthCheck.js")
check("alarm #25 nflCapture: idle-by-design green when OFF, RED on zero artifacts or >4d staleness, registered before the sidecar write",
  /checkNflCapture/.test(chc) && /"nflCapture"/.test(chc) && /idle by design/.test(chc) && /wider than the widest window gap/.test(chc) && chc.indexOf("fs.writeFileSync(OUT") > chc.indexOf("checkNflCapture()"))
check("capture doctrine at source: capture-only, config authority (no hardcoded fallback), quota-ledgered, verbatim sides",
  /CAPTURE ONLY/.test(rd("scripts/captureNflProps.js")) && /no hardcoded fallback/.test(rd("scripts/captureNflProps.js")) && /caller: "captureNflProps"/.test(rd("scripts/captureNflProps.js")) && /VERBATIM/.test(rd("scripts/captureNflProps.js")))
check("matrix: verifyNflCapture registered", /"verifyNflCapture"/.test(rd("scripts/runtimeVerify.js")))

console.log(`verifyNflCapture: ${pass}/${pass + fail} checks PASS`)
if (fail > 0) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); process.exit(1) }
process.exit(0)
