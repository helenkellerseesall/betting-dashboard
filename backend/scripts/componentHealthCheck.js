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
  if (!r.ran) return set(key, "not-run", `${label}: ${r.detail}`, wired)
  if (r.passed) return set(key, "green", `${label} self-test passed${r.detail ? " " + r.detail : ""} this cycle`, wired)
  return set(key, "fail", `${label} self-test FAILED (exit ${r.exit})${r.detail ? " " + r.detail : ""}`, wired)
}
selfTest("devigAnalytics", "pipeline/shared/devigAnalytics.js", "devigAnalytics", "shelf")
selfTest("cashoutHedge", "pipeline/shared/cashoutHedge.js", "cashoutHedge", "wired")
selfTest("pinnacleBenchmarkSelfTest", "pipeline/shared/pinnacleBenchmark.js", "pinnacleBenchmark", "shelf")
selfTest("shadowStack", "scripts/verifyShadowStackIntact.js", "shadowStack", "shelf")

// ── (2) freshness components: GREEN iff the artifact exists, is correct, AND is fresh ──
// Pinnacle sidecar: latest pinnacle_benchmark_<slate>.json — every two-way market fairSumsTo==1.0
// AND mtime ≤ 24h. (Pre-persistence-fix files have no fairSumsTo → fail, not green.)
function checkPinnacleSidecar() {
  const slate = currentSlateDateEt()
  const fp = path.join(TRACKING, `pinnacle_benchmark_${slate}.json`)
  if (!fs.existsSync(fp)) return set("pinnacleSidecar", "not-run", `no pinnacle_benchmark_${slate}.json (capture is opt-in: PINNACLE_BENCHMARK=1)`, "shelf")
  let j; try { j = JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return set("pinnacleSidecar", "fail", "sidecar unreadable/corrupt", "shelf") }
  const ageH = (now - fs.statSync(fp).mtimeMs) / 3.6e6
  let markets = 0, sum1 = 0, hasFair = false
  for (const ev of Object.values(j.byEvent || {})) for (const m of Object.values(ev.markets || {})) {
    if (m && m.fairSumsTo != null) { hasFair = true; markets++; if (Math.abs(m.fairSumsTo - 1) < 1e-6) sum1++ }
  }
  if (!hasFair) return set("pinnacleSidecar", "fail", "no persisted fairProb (pre-fix sidecar) — re-run capture", "shelf")
  if (sum1 !== markets) return set("pinnacleSidecar", "fail", `${sum1}/${markets} markets fairSumsTo==1.0 (de-vig broken)`, "shelf")
  if (ageH > 24) return set("pinnacleSidecar", "stale", `${markets} markets OK but sidecar ${ageH.toFixed(1)}h old (>24h) — re-run capture`, "shelf")
  set("pinnacleSidecar", "green", `${markets} markets fairSumsTo==1.0, ${ageH.toFixed(1)}h old`, "shelf")
}
checkPinnacleSidecar()

// Forward-CLV sidecar: present, ledgerRows>0, mtime ≤ 30h (runs post-grade daily).
function checkForwardClv() {
  const fp = path.join(TRACKING, "forward_clv_slices.json")
  if (!fs.existsSync(fp)) return set("forwardClvTracker", "not-run", "forward_clv_slices.json not generated — run forwardClvSliceTracker.js", "shelf")
  let j; try { j = JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return set("forwardClvTracker", "fail", "sidecar unreadable/corrupt", "shelf") }
  const ageH = (now - fs.statSync(fp).mtimeMs) / 3.6e6
  if (!(Number(j.ledgerRows) > 0)) return set("forwardClvTracker", "fail", `ledgerRows=${j.ledgerRows} (no ledger data)`, "shelf")
  if (ageH > 30) return set("forwardClvTracker", "stale", `ledgerRows=${j.ledgerRows} but sidecar ${ageH.toFixed(1)}h old (>30h) — tracker hasn't run since last grade`, "shelf")
  set("forwardClvTracker", "green", `ledgerRows=${j.ledgerRows}, forwardRows=${j.forwardRows}, ${ageH.toFixed(1)}h old`, "shelf")
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
  if (!L || !L.rows.length) return set("closingLineCapture", "green", "idle — no ledger rows (no slate = healthy)", "wired")
  const tipped = L.rows.filter((r) => { const gt = r.gameTime ? Date.parse(r.gameTime) : null; return gt && gt <= now })
  if (tipped.length === 0) return set("closingLineCapture", "green", `idle — 0 of ${L.rows.length} games tipped yet on slate ${L.slate} (nothing to capture = healthy)`, "wired")
  const stamped = tipped.filter((r) => r.closeOdds != null)
  if (stamped.length === 0) return set("closingLineCapture", "fail", `${tipped.length} games tipped on ${L.slate} but 0 close-stamped — capture loop likely dead`, "wired")
  const rate = Math.round((stamped.length / tipped.length) * 100)
  set("closingLineCapture", "green", `${stamped.length}/${tipped.length} tipped picks close-stamped (${rate}%) on ${L.slate} — capture alive`, "wired")
}
checkClosingLineCapture()

// Context persistence — GREEN if recent rows carry the flattened matchup-context tags. 0% on a
// populated slate = wiring broken (FAIL); no rows = idle/healthy.
const CTX_TAGS = ["hrFactor", "windDirectionTag", "temperatureF", "carryShift", "runEnvironment", "rbiEnvironment", "hrEnvironmentTag"]
function checkContextPersistence() {
  const L = latestLedger()
  if (!L || !L.rows.length) return set("contextPersistence", "green", "idle — no rows on the latest slate (no games = healthy)", "wired")
  const withCtx = L.rows.filter((r) => CTX_TAGS.some((k) => r[k] != null)).length
  const pct = Math.round((withCtx / L.rows.length) * 100)
  if (withCtx === 0) return set("contextPersistence", "fail", `0% of ${L.rows.length} rows on ${L.slate} carry context tags — persistence wiring broken`, "wired")
  set("contextPersistence", "green", `${pct}% of ${L.rows.length} rows on ${L.slate} carry context tags`, "wired")
}
checkContextPersistence()

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

const order = ["devigAnalytics", "cashoutHedge", "pinnacleBenchmarkSelfTest", "shadowStack", "pinnacleSidecar", "forwardClvTracker", "closingLineCapture", "contextPersistence"]
console.log("=== component health (tested-green) " + nowIso + " ===")
for (const k of order) { const c = components[k]; if (!c) continue; console.log(`  ${k.padEnd(26)} ${c.state.toUpperCase().padEnd(8)} ${c.reason}`) }
console.log("summary: " + JSON.stringify(summary))
console.log("wrote: " + OUT)
process.exit(0)
