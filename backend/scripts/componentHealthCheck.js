#!/usr/bin/env node
"use strict"
/**
 * componentHealthCheck.js — TESTED-GREEN runner (status-must-be-real amendment 2026-06-18).
 *
 * Runs each freeze-window component's OWN self-test/probe THIS cycle and writes
 * component_health.json. A component is GREEN only if its check RAN now AND passed; if its
 * freshness window blew → stale; if it could not run → not-run; if it ran and failed → fail.
 * Anti-fabrication: a check that throws / can't execute is not-run or fail — NEVER green.
 *
 * Display/infra only: reads NOTHING from scoring/selection, writes only the health sidecar.
 * /status READS this file (sectionComponentHealth) — it never runs these checks in-request
 * (keeps /status fast). scheduler.sh runs THIS ~every 15 min (active hours) + post-grade ~4:15 AM.
 *
 *   node backend/scripts/componentHealthCheck.js
 */
const { spawnSync } = require("child_process")
const fs = require("fs"), path = require("path")
const { currentSlateDateEt } = require("../pipeline/shared/slateDate")

const BACKEND = path.join(__dirname, "..")
// Tracking dir is overridable for isolated testing (failure-path verification points it at a temp
// dir so tests never pollute the real ledger). Defaults to the canonical runtime/tracking.
const TRACKING = process.env.COMPONENT_HEALTH_TRACKING_DIR || path.join(BACKEND, "runtime", "tracking")
const OUT = path.join(TRACKING, "component_health.json")
const now = Date.now()
const nowIso = new Date(now).toISOString()

const components = {}
const set = (key, state, reason, wired) => { components[key] = { state, ranAt: nowIso, reason, wired } }

// Run a node file (cwd=BACKEND so deps + relative requires resolve exactly like runtime:verify).
function runNode(relFromBackend) {
  const fp = path.join(BACKEND, relFromBackend)
  if (!fs.existsSync(fp)) return { ran: false, passed: false, exit: null, detail: "file missing (" + relFromBackend + ")" }
  const r = spawnSync("node", [fp], { encoding: "utf8", timeout: 30000, cwd: BACKEND })
  if (r.error) return { ran: false, passed: false, exit: null, detail: "could not run (" + r.error.message + ")" }
  const out = (r.stdout || "") + (r.stderr || "")
  const m = out.match(/self-test:\s*(\d+)\/(\d+)/)
  return { ran: true, passed: r.status === 0, exit: r.status, detail: m ? `${m[1]}/${m[2]}` : "" }
}

// ── (1) self-test components: GREEN iff `node <file>` exits 0 this cycle ──
function selfTest(key, rel, label, wired) {
  const r = runNode(rel)
  if (!r.ran) return set(key, "not-run", `${label}: didn't run this cycle`, wired)
  if (r.passed) return set(key, "green", `${label}: checks passed just now${r.detail ? " (" + r.detail + ")" : ""}`, wired)
  return set(key, "fail", `${label}: checks FAILED (exit ${r.exit})${r.detail ? " " + r.detail : ""}`, wired)
}
selfTest("devigAnalytics", "pipeline/shared/devigAnalytics.js", "Fair-odds math", "shelf")
selfTest("cashoutHedge", "pipeline/shared/cashoutHedge.js", "Cash-out math", "wired")
selfTest("pinnacleBenchmarkSelfTest", "pipeline/shared/pinnacleBenchmark.js", "Sharp-line benchmark", "shelf")
selfTest("shadowStack", "scripts/verifyShadowStackIntact.js", "Backup math", "shelf")

// ── (2) freshness components: GREEN iff the artifact exists, is correct, AND is fresh ──
// Pinnacle sidecar: latest pinnacle_benchmark_<slate>.json — every two-way market fairSumsTo==1.0
// AND mtime ≤ 24h. (Pre-persistence-fix files have no fairSumsTo → fail, not green.)
function checkPinnacleSidecar() {
  const slate = currentSlateDateEt()
  const fp = path.join(TRACKING, `pinnacle_benchmark_${slate}.json`)
  if (!fs.existsSync(fp)) return set("pinnacleSidecar", "not-run", `no sharp-line snapshot for ${slate} yet (this capture is optional)`, "shelf")
  let j; try { j = JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return set("pinnacleSidecar", "fail", "sharp-line snapshot unreadable", "shelf") }
  const ageH = (now - fs.statSync(fp).mtimeMs) / 3.6e6
  let markets = 0, sum1 = 0, hasFair = false
  for (const ev of Object.values(j.byEvent || {})) for (const m of Object.values(ev.markets || {})) {
    if (m && m.fairSumsTo != null) { hasFair = true; markets++; if (Math.abs(m.fairSumsTo - 1) < 1e-6) sum1++ }
  }
  if (!hasFair) return set("pinnacleSidecar", "fail", "sharp-line snapshot is missing fair-odds data — re-run the capture", "shelf")
  if (sum1 !== markets) return set("pinnacleSidecar", "fail", `fair-odds math only checks out on ${sum1} of ${markets} markets — something's off`, "shelf")
  if (ageH > 24) return set("pinnacleSidecar", "stale", `${markets} markets look right, but the snapshot is ${ageH.toFixed(1)}h old (over 24h) — re-run the capture`, "shelf")
  set("pinnacleSidecar", "green", `${markets} markets check out · updated ${ageH.toFixed(1)}h ago`, "shelf")
}
checkPinnacleSidecar()

// Forward-CLV sidecar: present, ledgerRows>0, mtime ≤ 30h (runs post-grade daily).
function checkForwardClv() {
  const fp = path.join(TRACKING, "forward_clv_slices.json")
  if (!fs.existsSync(fp)) return set("forwardClvTracker", "not-run", "edge tracker hasn't run yet today", "shelf")
  let j; try { j = JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return set("forwardClvTracker", "fail", "edge tracker file unreadable", "shelf") }
  const ageH = (now - fs.statSync(fp).mtimeMs) / 3.6e6
  if (!(Number(j.ledgerRows) > 0)) return set("forwardClvTracker", "fail", "no bets tracked yet", "shelf")
  if (ageH > 30) return set("forwardClvTracker", "stale", `${Number(j.forwardRows).toLocaleString()} bets tracked, but last updated ${ageH.toFixed(1)}h ago (over 30h) — hasn't run since the last grading`, "shelf")
  set("forwardClvTracker", "green", `${Number(j.forwardRows).toLocaleString()} bets tracked · updated ${ageH.toFixed(1)}h ago`, "shelf")
}
checkForwardClv()

// ── (3) WIRED pipeline checks (no-games-aware) ──
// Load the latest mlb ledger day-file (rows + slate date).
function latestLedger() {
  let files
  try { files = fs.readdirSync(TRACKING).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() } catch (_) { return null }
  // Ignore far-future-dated files (test/garbage). Real slates are today or a day or two ahead
  // (late-night pre-picks); a file dated >7 days out is never real and must not shadow the latest.
  const horizon = new Date(now + 7 * 864e5).toISOString().slice(0, 10)
  files = files.filter((f) => f.slice("mlb_tracked_bets_".length, "mlb_tracked_bets_".length + 10) <= horizon)
  if (!files.length) return null
  const f = files[files.length - 1]
  const slate = f.replace("mlb_tracked_bets_", "").replace(".json", "")
  let rows = []
  try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")); rows = Array.isArray(j) ? j : (j.bets || j.rows || []) } catch (_) {}
  return { slate, rows }
}

// Closing-line capture — GREEN if alive (close-stamping once games tip). NO-GAMES-AWARE (binding):
// 0 captures + 0 games tipped = idle/HEALTHY (green); games tipped + 0 captures = loop dead (FAIL).
function checkClosingLineCapture() {
  const L = latestLedger()
  if (!L || !L.rows.length) return set("closingLineCapture", "green", "idle — no games on the slate (normal)", "wired")
  const tipped = L.rows.filter((r) => { const gt = r.gameTime ? Date.parse(r.gameTime) : null; return gt && gt <= now })
  if (tipped.length === 0) return set("closingLineCapture", "green", `idle — none of ${L.rows.length} picks have started yet on ${L.slate} (normal)`, "wired")
  const stamped = tipped.filter((r) => r.closeOdds != null)
  if (stamped.length === 0) return set("closingLineCapture", "fail", `${tipped.length} picks started on ${L.slate} but none had closing odds captured — capture may be down`, "wired")
  const rate = Math.round((stamped.length / tipped.length) * 100)
  set("closingLineCapture", "green", `${rate}% of started picks had closing odds captured (${stamped.length}/${tipped.length}) on ${L.slate}`, "wired")
}
checkClosingLineCapture()

// Context persistence — GREEN if recent rows carry the flattened matchup-context tags. 0% on a
// populated slate = wiring broken (FAIL); no rows = idle/healthy.
const CTX_TAGS = ["hrFactor", "windDirectionTag", "temperatureF", "carryShift", "runEnvironment", "rbiEnvironment", "hrEnvironmentTag"]
function checkContextPersistence() {
  const L = latestLedger()
  if (!L || !L.rows.length) return set("contextPersistence", "green", "idle — no picks on the latest slate (normal)", "wired")
  const withCtx = L.rows.filter((r) => CTX_TAGS.some((k) => r[k] != null)).length
  const pct = Math.round((withCtx / L.rows.length) * 100)
  if (withCtx === 0) return set("contextPersistence", "fail", `none of ${L.rows.length} picks on ${L.slate} have matchup tags — tagging may be broken`, "wired")
  set("contextPersistence", "green", `${pct}% of ${L.rows.length} picks on ${L.slate} have matchup tags`, "wired")
}
checkContextPersistence()

// Forward-capture freshness — newest signal_capture_<date>.json + its _meta (the authoritative
// record captureSignalSnapshot writes of which signals were FRESH when stamped). NO-GAMES-AWARE:
// off-day or before the ~10:30 ET chain window = idle-green (not red). GREEN = captured today, all
// signals fresh · AMBER(stale) = partial stale-skip OR no capture today yet (past window) · RED(fail)
// = captured today but ALL signals stale (vendor refresh failed), or past window with a slate + no
// capture ever. Reads only the capture sidecars (+ ledger for off-day) — never re-derives staging.
const CAPTURE_WINDOW_ET = 10 * 60 + 45   // chain fires 10:30 ET; 15-min grace
function etMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(now))
  const h = Number(parts.find((p) => p.type === "hour").value), m = Number(parts.find((p) => p.type === "minute").value)
  return h * 60 + m
}
function checkForwardCapture() {
  const today = currentSlateDateEt()
  let files
  try { files = fs.readdirSync(TRACKING).filter((f) => /^signal_capture_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() } catch (_) { files = [] }
  const newest = files[files.length - 1] || null
  const newestDate = newest ? newest.slice("signal_capture_".length, "signal_capture_".length + 10) : null
  const preWindow = etMinutesNow() < CAPTURE_WINDOW_ET
  const L = latestLedger()
  const hasSlate = !!(L && L.rows && L.rows.length)

  if (newestDate === today) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(TRACKING, newest), "utf8")) } catch (_) { j = null }
    const m = j && j._meta
    if (!m) return set("forwardCapture", "stale", `today's signal snapshot is missing its detail record — re-run it`, "wired")
    if (m.allStale) return set("forwardCapture", "fail", `today's snapshot ran (${m.betsStamped} bets) but all data was stale — the data feeds didn't refresh`, "wired")
    if (m.anyStale) return set("forwardCapture", "stale", `today's snapshot ran (${m.betsStamped} bets) but some feeds were stale and skipped (batted-ball ${m.staleSkipped.statcast}, pitching ${m.staleSkipped.fip}, weather ${m.staleSkipped.air})`, "wired")
    return set("forwardCapture", "green", `today's snapshot done: ${m.betsStamped} bets, all data fresh (batted-ball ${m.stamped.statcast}, pitching ${m.stamped.fip}, weather ${m.stamped.air})`, "wired")
  }
  // no capture for today yet
  if (preWindow) return set("forwardCapture", "green", `idle — runs around 10:30 AM ET; last snapshot ${newestDate || "none"}`, "wired")
  if (!hasSlate) return set("forwardCapture", "green", `idle — no games today; last snapshot ${newestDate || "none"}`, "wired")
  if (!newestDate) return set("forwardCapture", "fail", `it's past 10:30 AM ET and there are games, but no snapshot was made — the job isn't running`, "wired")
  return set("forwardCapture", "stale", `it's past 10:30 AM ET but no snapshot for today — newest is ${newestDate}; the job may have missed`, "wired")
}
checkForwardCapture()

// ── write sidecar + console ──
const summary = { green: 0, stale: 0, fail: 0, "not-run": 0 }
for (const c of Object.values(components)) summary[c.state] = (summary[c.state] || 0) + 1
const payload = {
  generatedAt: nowIso,
  cadenceNote: "scheduler.sh runs this ~every 15 min (active hours) + post-grade ~4:15 AM. GREEN = ran + passed THIS cycle.",
  summary,
  components,
}
fs.mkdirSync(TRACKING, { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2))

// ── 2026-07-14 HONEST-COMMS (b) — board serve-vs-record divergence watchdog ──
// RED condition (the All-Star-night class): the RECORD has rows for today but
// the SERVED board is empty WITHOUT a stated reason. Queries the live local
// endpoint (real e2e — the exact payload the phone sees); backend down ⇒ not-run.
function checkBoardServeParity() {
  try {
    const slate = currentSlateDateEt()
    let trackedRows = 0
    try { const a = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${slate}.json`), "utf8")); trackedRows = Array.isArray(a) ? a.length : 0 } catch (_) {}
    const r = spawnSync("curl", ["-s", "-m", "8", `http://127.0.0.1:4000/api/ws/top-picks?limit=50`], { encoding: "utf8", timeout: 12000 })
    if (r.status !== 0 || !r.stdout) return set("boardServeParity", "not-run", "Board parity: backend unreachable this cycle", "wired")
    let j; try { j = JSON.parse(r.stdout) } catch (_) { return set("boardServeParity", "fail", "Board parity: top-picks returned unparseable JSON", "wired") }
    const served = Array.isArray(j.picks) ? j.picks.length : 0
    if (served > 0) return set("boardServeParity", "green", `Board parity: ${served} picks served (record ${trackedRows} rows)`, "wired")
    const bs = j.boardState
    if (bs && !bs.alert) return set("boardServeParity", "green", `Board honestly empty with stated reason: ${String(bs.summary || "").slice(0, 140)}`, "wired")
    if (trackedRows > 0) return set("boardServeParity", "fail", `RECORD has ${trackedRows} rows for ${slate} but the served board is EMPTY ${bs ? "with an ALERT state: " + String(bs.summary || "").slice(0, 100) : "with NO stated reason"} — divergence`, "wired")
    return set("boardServeParity", bs && bs.alert ? "fail" : "green", bs ? `empty board, state: ${String(bs.summary || "").slice(0, 140)}` : "empty board and empty record with no boardState (older backend?)", "wired")
  } catch (e) {
    return set("boardServeParity", "not-run", `Board parity: ${String(e?.message || e)}`, "wired")
  }
}
checkBoardServeParity()

const order = ["devigAnalytics", "cashoutHedge", "pinnacleBenchmarkSelfTest", "shadowStack", "pinnacleSidecar", "forwardClvTracker", "closingLineCapture", "contextPersistence", "forwardCapture", "boardServeParity"]
console.log("=== component health (tested-green) " + nowIso + " ===")
for (const k of order) { const c = components[k]; if (!c) continue; console.log(`  ${k.padEnd(26)} ${c.state.toUpperCase().padEnd(8)} ${c.reason}`) }
console.log("summary: " + JSON.stringify(summary))
console.log("wrote: " + OUT)
process.exit(0)
