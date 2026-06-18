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
const TRACKING = path.join(BACKEND, "runtime", "tracking")
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

const order = ["devigAnalytics", "cashoutHedge", "pinnacleBenchmarkSelfTest", "shadowStack", "pinnacleSidecar", "forwardClvTracker"]
console.log("=== component health (tested-green) " + nowIso + " ===")
for (const k of order) { const c = components[k]; if (!c) continue; console.log(`  ${k.padEnd(26)} ${c.state.toUpperCase().padEnd(8)} ${c.reason}`) }
console.log("summary: " + JSON.stringify(summary))
console.log("wrote: " + OUT)
process.exit(0)
