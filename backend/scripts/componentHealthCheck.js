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

// (j) 2026-07-29 DAILY3-RAILS — receipt-at-lock alarm (ships-with doctrine):
// a card locked ON/AFTER the rails epoch with no receipt = the receipt writer
// died silently = RED; a broken chain link = RED (tampering or a partial
// write). Pre-epoch cards NEVER alarm (labeled era, no backfill — binding).
function checkDaily3Receipt() {
  try {
    const { validateReceiptChain, RAILS_EPOCH } = require("../pipeline/shared/daily3")
    const RECEIPTS = path.join(BACKEND, "..", "docs", "receipts")
    const cards = fs.readdirSync(TRACKING).filter((f) => /^daily3_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    const newest = cards[cards.length - 1] || null
    const newestSlate = newest ? newest.slice(7, 17) : null
    const chain = validateReceiptChain(RECEIPTS)
    if (!chain.ok) return set("daily3Receipt", "fail", `Daily 3 receipts: CHAIN BROKEN at ${chain.breaks.map((b) => b.slate).join(", ")} — a past receipt or card was altered, or a write was partial`, "wired")
    if (newestSlate && newestSlate >= RAILS_EPOCH && !fs.existsSync(path.join(RECEIPTS, `daily3_receipt_${newestSlate}.md`))) {
      return set("daily3Receipt", "fail", `Daily 3 receipts: card ${newestSlate} is LOCKED but has NO receipt — the lock-time writer failed; the public chain has a hole`, "wired")
    }
    return set("daily3Receipt", "green", `Daily 3 receipts: chain intact (${chain.checked} link${chain.checked === 1 ? "" : "s"})${newestSlate ? ` · newest card ${newestSlate}${newestSlate < RAILS_EPOCH ? " (pre-receipt era)" : ""}` : " · no cards yet"}`, "wired")
  } catch (e) { return set("daily3Receipt", "not-run", `Daily 3 receipts: ${String(e?.message || e)}`, "wired") }
}
checkDaily3Receipt()

// (l) 2026-07-30 GRADUATION BOARD STALL (ASK f5ee1b6, operator directive:
// "running but not progressing" must scream like "not running") — recomputed
// from the RAW per-slate artifacts, NEVER from the sidecar this alarm guards.
// RED when any caged row's exam counters are unchanged across 2 consecutive
// slates-with-games (N=2 derived from the real 7/25-27 plateau, which this
// alarm would have caught the morning of 7/27). Family exams count as stalled
// when the exam artifact is ≥2 games-slates old while wired families sit
// STOP/absent (the day-one truth: SB/doubles/triples wired 07-26; artifact
// 07-16). Queued rows exempt.
function checkGradBoardStall() {
  try {
    const gb = require("./graduationBoard")
    const board = gb.buildBoard({ trackingDir: TRACKING })
    const stalled = board.stalledRows || []
    if (stalled.length) return set("gradBoardStall", "fail", `Graduation stall: ${stalled.join(", ")} — exam counters flat across 2+ games-slates; running but not progressing. Named rows need a human (re-run the exam / check the scan chain).`, "wired")
    return set("gradBoardStall", "green", `Graduation board: ${board.rows.length} caged surfaces all advancing (${board.gamesSlatesSeen} games-slates of history)`, "wired")
  } catch (e) { return set("gradBoardStall", "not-run", `Graduation stall: ${String(e?.message || e)}`, "wired") }
}
checkGradBoardStall()

// (25) 2026-08-15 NFL CAPTURE-FIRST (standing queue) — the pack's ships-with
// alarm: a capture that silently stops is invisible until September's paper
// machinery starts blind. Honest states: sport OFF ⇒ green idle-by-design;
// sport ON + zero artifacts ⇒ RED (windows never landed one); sport ON +
// newest artifact older than the widest window gap (4 days) ⇒ RED.
function checkNflCapture() {
  try {
    let enabled = true
    try { enabled = require("../pipeline/shared/seasonGate").isSportEnabled("nfl") } catch (_) {}
    if (!enabled) return set("nflCapture", "green", "NFL capture: OFF by season gate (seasonsActive.json nfl=false) — idle by design; flip at season start, windows arm with no restart", "wired")
    const files = fs.readdirSync(TRACKING).filter((f) => /^nfl_props_capture_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    if (!files.length) return set("nflCapture", "fail", "NFL capture: sport ON but ZERO capture artifacts — the Wed/Thu/Fri/Sun windows have not landed one; check scheduler.log for captureNflProps", "wired")
    const latest = files[files.length - 1]
    const d = (latest.match(/(\d{4}-\d{2}-\d{2})/) || [])[1]
    const ageDays = Math.round((Date.now() - Date.parse(d + "T12:00:00Z")) / 86400000)
    if (ageDays > 4) return set("nflCapture", "fail", `NFL capture: newest artifact ${latest} is ${ageDays}d old — wider than the widest window gap (4d); capture is dead`, "wired")
    let rows = 0
    try { rows = (JSON.parse(fs.readFileSync(path.join(TRACKING, latest), "utf8")).rows || []).length } catch (_) {}
    return set("nflCapture", "green", `NFL capture: ${latest} (${rows} rows, ${ageDays}d old) — inside the window cadence`, "wired")
  } catch (e) { return set("nflCapture", "not-run", `NFL capture: ${String(e?.message || e)}`, "wired") }
}
checkNflCapture()

// (26) 2026-08-16 MARKET-PRIOR SHADOW (GO on the 8/15 ASK) — ONE component
// folding both spec-§5 rails per CA: >20% model-only on the latest slate
// (the de-vig join is missing pairs) and w-drift >0.15 in one refit.
function checkMarketPrior() {
  try {
    const shadowP = path.join(TRACKING, "market_prior_shadow.jsonl")
    if (!fs.existsSync(shadowP)) return set("market_prior", "green", "Market-prior shadow: not logging yet — the tap arms on the next served board (kill switch MARKET_PRIOR_OFF honored)", "wired")
    const lines = fs.readFileSync(shadowP, "utf8").split("\n").filter(Boolean).slice(-5000).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
    const slates = [...new Set(lines.map((e) => e.slate).filter(Boolean))].sort()
    const latest = slates[slates.length - 1]
    const onSlate = lines.filter((e) => e.slate === latest)
    const mo = onSlate.filter((e) => /model_only/.test(e.label || "")).length
    const moPct = onSlate.length ? Math.round(100 * mo / onSlate.length) : 0
    if (onSlate.length >= 10 && moPct > 20) return set("market_prior", "fail", `Market-prior shadow: ${moPct}% model-only on ${latest} (${mo}/${onSlate.length}) — de-vig join missing pairs; >20% bar (spec §5)`, "wired")
    let drift = null
    try {
      const wj = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "market_prior_w.json"), "utf8"))
      const h = wj.history || []
      if (h.length >= 2) {
        const a = h[h.length - 2].byFamilyBand || {}, b = h[h.length - 1].byFamilyBand || {}
        for (const k of Object.keys(b)) if (a[k] && Math.abs(b[k].w - a[k].w) > 0.15) drift = `${k}: ${a[k].w}→${b[k].w}`
      }
    } catch (_) {}
    if (drift) return set("market_prior", "fail", `Market-prior w drift >0.15 in one refit (${drift}) — spec §5 drift alarm; HUMAN LOOK before the next fit commits`, "wired")
    return set("market_prior", "green", `Market-prior shadow: ${lines.length} recent rows over ${slates.length} slate(s); latest ${latest}: ${moPct}% model-only (bar 20%); w drift within 0.15`, "wired")
  } catch (e) { return set("market_prior", "not-run", `Market-prior: ${String(e?.message || e)}`, "wired") }
}
checkMarketPrior()

// (27) 2026-08-17 SCHEDULER-TRUTH — loop identity is EVIDENCE, never a guess.
// Reads the per-cycle heartbeat. Three honest reds: no heartbeat (pre-
// heartbeat loop or dead — one restart adopts it), frozen tick (sleep gap or
// crash — the 8/16 class: minute-exact windows in the gap were LOST), and
// loaded-vs-disk sha mismatch (running stale code — the exact lie the 8/16
// incident report assumed but could not prove).
function checkSchedulerIdentity() {
  try {
    const hb = path.join(TRACKING, "scheduler_heartbeat.json")
    if (!fs.existsSync(hb)) return set("schedulerIdentity", "fail", "Scheduler identity: NO heartbeat file — the running loop predates the heartbeat (or none runs); one restart adopts it. Which-script-is-running must never be a guess (8/16 incident)", "wired")
    const ageMin = Math.round((Date.now() - fs.statSync(hb).mtimeMs) / 60000)
    const j = JSON.parse(fs.readFileSync(hb, "utf8"))
    if (ageMin > 5) return set("schedulerIdentity", "fail", `Scheduler identity: heartbeat FROZEN ${ageMin}m (pid ${j.pid}, started ${j.loopStartedAt}) — sleep gap or dead loop; minute-exact windows inside the gap were LOST (8/16 class)`, "wired")
    if (j.loadedSha && j.diskSha && j.loadedSha !== j.diskSha) return set("schedulerIdentity", "fail", `Scheduler identity: RUNNING STALE CODE — pid ${j.pid} loaded a vintage that no longer matches scheduler.sh on disk; restart to adopt edits`, "wired")
    return set("schedulerIdentity", "green", `Scheduler identity: pid ${j.pid} · started ${j.loopStartedAt} · vintage matches disk · tick ${ageMin}m ago`, "wired")
  } catch (e) { return set("schedulerIdentity", "not-run", `Scheduler identity: ${String(e?.message || e)}`, "wired") }
}
checkSchedulerIdentity()

// ── sidecar write RELOCATED (2026-07-29 BETS-PAGE PACK 2 audit finding) ──
// The write used to happen HERE — above every check added since 07-14
// (boardServeParity → lineFreshness, 12 alarms). Those checks ran and printed
// to console but their states NEVER reached component_health.json, so /status
// showed 9 components while the script asserted 21 — silent instrument death
// of the alarm surface itself, live in the field for two weeks (found via a
// 9-component sidecar with lineFreshness ABSENT one cycle after it landed).
// The single write now sits at the END, after ALL checks. Doctrine addition:
// the sidecar write is LAST — any new check goes ABOVE it.

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

// 2026-07-16 LADDER-CAPTURE (G2 enabler) — did the 3-pass alternate-market
// capture run, and how many rungs are stored? Honest states: no games on the
// slate ⇒ green-skip with the reason; before the first pass window (10:00 ET)
// ⇒ not-run; games + past-window + zero passes ⇒ FAIL.
function checkLadderCapture() {
  try {
    const slate = currentSlateDateEt()
    let store = null
    try { store = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_ladders_${slate}.json`), "utf8")) } catch (_) {}
    let trackedRows = 0
    try { const a = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${slate}.json`), "utf8")); trackedRows = Array.isArray(a) ? a.length : 0 } catch (_) {}
    const etHour = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }))
    if (store && Array.isArray(store.passes) && store.passes.length) {
      const last = store.passes[store.passes.length - 1]
      return set("ladderCapture", "green", `Ladder capture: ${store.passes.length} pass(es), ${store.rows.length} rungs stored for ${slate} (last: ${last.pass}, ${last.rungRows} rungs, ${last.requestsSpent} credits)`, "shelf")
    }
    if (trackedRows === 0) return set("ladderCapture", "green", `Ladder capture: no games/board on slate ${slate} — honest skip (passes fire 10:00/17:00/22:05 ET on game days)`, "shelf")
    if (etHour < 11) return set("ladderCapture", "not-run", `Ladder capture: first pass fires 10:00 ET (slate ${slate} has ${trackedRows} tracked rows)`, "shelf")
    return set("ladderCapture", "fail", `Ladder capture: slate ${slate} has ${trackedRows} tracked rows but NO ladder pass ran after the 10:00 ET window — check scheduler + quota log`, "shelf")
  } catch (e) {
    return set("ladderCapture", "not-run", `Ladder capture: ${String(e?.message || e)}`, "shelf")
  }
}
checkLadderCapture()

// 2026-07-16 G2-L3 — shadow rung-EV scanner health: did it price rungs + how
// far along is the gate tally? Honest no-games/no-ladders skip; FAIL only when
// ladders exist for the slate but no scan ran after the 17:15 window.
function checkRungScan() {
  try {
    const slate = currentSlateDateEt()
    let scan = null
    try { scan = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_rung_scan_${slate}.json`), "utf8")) } catch (_) {}
    let ladders = null
    try { ladders = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_ladders_${slate}.json`), "utf8")) } catch (_) {}
    const etHour = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }))
    if (scan && scan.summary) {
      const g = scan.summary.gate || {}
      return set("rungScan", "green", `Rung scan (SHADOW): ${scan.summary.rungsPriced} rungs priced, ${scan.summary.flagged} flagged · gate ${g.nights ?? 0}/14 nights, ${g.decided ?? 0}/300 decided, ${g.flatUnits ?? 0}u`, "shelf")
    }
    if (!ladders || !(ladders.rows || []).length) return set("rungScan", "green", `Rung scan: no ladder store for slate ${slate} yet — honest skip (scans fire 17:15/22:20 ET after capture passes)`, "shelf")
    if (etHour < 18) return set("rungScan", "not-run", `Rung scan: ladders captured (${ladders.rows.length} rungs) — first scan fires 17:15 ET`, "shelf")
    return set("rungScan", "fail", `Rung scan: ${ladders.rows.length} captured rungs for ${slate} but NO scan artifact after the 17:15 window — check scheduler`, "shelf")
  } catch (e) {
    return set("rungScan", "not-run", `Rung scan: ${String(e?.message || e)}`, "shelf")
  }
}
checkRungScan()

// ── 2026-07-21 INSTRUMENT-REPAIR-PACK: instrument alarms (the meta-fix). ──
// STANDING DOCTRINE: every new instrument ships WITH its own health line —
// silent instrument death cost 3 N1 nights + 3 stalled Daily-3 cards before a
// human audit noticed. These three alarms make silence impossible:

// (a) Daily 3 grading — a LOCKED card still ungraded past its grading night is RED.
function checkDaily3Grading() {
  try {
    const files = fs.readdirSync(TRACKING).filter((f) => /^daily3_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    const today = currentSlateDateEt()
    let stuck = []
    for (const f of files.slice(-7)) {
      const d = f.slice(7, 17)
      if (d >= today) continue // current/future card — grades after its night
      const c = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8"))
      const ageDays = (Date.parse(today) - Date.parse(d)) / 86400000
      if (!c.results && ageDays >= 2) stuck.push(d) // grace: 1 full grading night
    }
    if (stuck.length) return set("daily3Grading", "fail", `DAILY 3: ${stuck.length} locked card(s) UNGRADED past their grading night (${stuck.join(", ")}) — grade join or scratch rule stalled`, "wired")
    return set("daily3Grading", "green", `Daily 3 grading current (${files.length} cards on file)`, "wired")
  } catch (e) { return set("daily3Grading", "not-run", `Daily 3 grading: ${String(e?.message || e)}`, "wired") }
}
checkDaily3Grading()

// (b) N1 instrument — night-file absent on a slate that HAD N1 rows = RED.
function checkN1Instrument() {
  try {
    const today = currentSlateDateEt()
    const prior = (() => { const [y, m, d] = today.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d, 12)); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10) })()
    let trackedN1 = 0
    try { trackedN1 = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${prior}.json`), "utf8")).filter((r) => ["hits", "totalBases", "rbis", "runs"].includes(r.statFamily)).length } catch (_) {}
    const fileExists = fs.existsSync(path.join(TRACKING, `n1_dual_scores_${prior}.jsonl`))
    if (trackedN1 > 0 && !fileExists) return set("n1Instrument", "fail", `N1 instrument: NO dual-score file for ${prior} despite ${trackedN1} N1-family rows — the 17:30 capture failed; gate window is losing nights`, "wired")
    if (fileExists) {
      const n = fs.readFileSync(path.join(TRACKING, `n1_dual_scores_${prior}.jsonl`), "utf8").split("\n").filter(Boolean).length
      return set("n1Instrument", "green", `N1 instrument: ${prior} captured (${n} dual-scored tuples)`, "wired")
    }
    return set("n1Instrument", "green", `N1 instrument: no N1 rows on ${prior} — honest no-op`, "wired")
  } catch (e) { return set("n1Instrument", "not-run", `N1 instrument: ${String(e?.message || e)}`, "wired") }
}
checkN1Instrument()

// (c) Rung ledger settles — zero settles while settleable flags exist on
// graded slates = RED (the join or the settle pass died).
function checkRungSettles() {
  try {
    const today = currentSlateDateEt()
    const L = fs.readFileSync(path.join(TRACKING, "rung_flag_ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
    const settled = new Set(L.filter((e) => e.type === "settle").map((e) => e.id))
    const settleable = L.filter((e) => e.type === "flag" && !settled.has(e.id) && e.gameDate < today && (Date.parse(today) - Date.parse(e.gameDate)) / 86400000 >= 2)
    if (settleable.length > 25 && settled.size === 0) return set("rungSettles", "fail", `Rung ledger: ${settleable.length} settleable flags, ZERO settles — settle pass dead`, "wired")
    if (settleable.length > 100) return set("rungSettles", "fail", `Rung ledger: ${settleable.length} flags ≥2 days old remain unsettled (settles exist: ${settled.size}) — join degrading`, "wired")
    return set("rungSettles", "green", `Rung ledger: ${settled.size} settles on file · ${settleable.length} aged-open (scratch/pending class)`, "wired")
  } catch (e) { return set("rungSettles", "not-run", `Rung ledger: ${String(e?.message || e)}`, "wired") }
}
checkRungSettles()

// (d) 2026-07-21 G3-L1 — pair corpus freshness (day-one alarm per doctrine):
// summary absent or >3 days stale while graded slates advance = RED.
function checkPairCorpus() {
  try {
    const p = path.join(TRACKING, "mlb_pair_corpus_summary.json")
    if (!fs.existsSync(p)) return set("pairCorpus", "not-run", "Pair corpus: not yet generated (G3-L1 lands, first 05:30 regen follows)", "shelf")
    const s = JSON.parse(fs.readFileSync(p, "utf8"))
    const ageDays = (Date.now() - Date.parse(s.generatedAt)) / 86400000
    const total = Object.values(s.classCounts || {}).reduce((a, b) => a + b, 0)
    if (ageDays > 3) return set("pairCorpus", "fail", `Pair corpus: STALE ${ageDays.toFixed(1)} days (regen fires 05:30 ET) — L2 fits would read old outcomes`, "shelf")
    if (!total) return set("pairCorpus", "fail", "Pair corpus: generated but ZERO pairs — extraction broken", "shelf")
    return set("pairCorpus", "green", `Pair corpus: ${total} pairs across ${Object.keys(s.classCounts).length} classes · ${s.slates} slates · ${ageDays.toFixed(1)}d old`, "shelf")
  } catch (e) { return set("pairCorpus", "not-run", `Pair corpus: ${String(e?.message || e)}`, "shelf") }
}
checkPairCorpus()

// (e) 2026-07-21 G3-L4 — parlay pricer day-one alarm: scans exist but no
// parlay artifact after the 17:20 window = RED; certification-refusal or
// no-scan days are honest greens.
function checkParlayScan() {
  try {
    const slate = currentSlateDateEt()
    let art = null
    try { art = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_parlay_scan_${slate}.json`), "utf8")) } catch (_) {}
    if (art && art.gate) return set("parlayScan", "green", `Parlay pricer (SHADOW): ${art.candidates} priced, ${art.newLedgered} ledgered · paper gate ${art.gate.nights}/14 nights, ${art.gate.decided}/100 settled, ${art.gate.flatUnits}u`, "shelf")
    const scanExists = fs.existsSync(path.join(TRACKING, `mlb_rung_scan_${slate}.json`))
    const etHour = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }))
    if (!scanExists) return set("parlayScan", "green", `Parlay pricer: no rung scan for ${slate} yet — honest upstream no-op`, "shelf")
    if (etHour < 18) return set("parlayScan", "not-run", `Parlay pricer: rung scan present — first pricing fires 17:20 ET`, "shelf")
    return set("parlayScan", "fail", `Parlay pricer: rung scan exists for ${slate} but NO parlay artifact after the 17:20 window — check scheduler/certification`, "shelf")
  } catch (e) { return set("parlayScan", "not-run", `Parlay pricer: ${String(e?.message || e)}`, "shelf") }
}
checkParlayScan()

// (f) 2026-07-26 NIGHTLY CRITIC day-one alarm: yesterday graded but no critic
// artifact after the 05:40 window = RED.
function checkCritic() {
  try {
    const today = currentSlateDateEt()
    const prior = (() => { const [y, m, d] = today.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d, 12)); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10) })()
    const artP = path.join(TRACKING, `critic_${prior}.json`)
    if (fs.existsSync(artP)) { const c = JSON.parse(fs.readFileSync(artP, "utf8")); return set("criticNightly", "green", `Critic: ${prior} audited — ${c.missedWinners.unitsAtFlat$1}u missed-winner volume, ceiling ${c.ceilingAudit.ratePct}%`, "wired") }
    let graded = false
    try { graded = (JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${prior}.json`), "utf8")) || []).some((r) => ["win", "loss"].includes(r.result)) } catch (_) {}
    const etHour = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }))
    if (graded && etHour >= 6) return set("criticNightly", "fail", `Critic: ${prior} is GRADED but no critic artifact after the 05:40 window — the adversary is asleep`, "wired")
    return set("criticNightly", graded ? "not-run" : "green", graded ? "Critic: fires 05:40 ET" : `Critic: ${prior} not graded yet — honest wait`, "wired")
  } catch (e) { return set("criticNightly", "not-run", `Critic: ${String(e?.message || e)}`, "wired") }
}
checkCritic()

// (g) 2026-07-28 RECORD-VISIBILITY parity — any realMoney ledger row absent
// from the served MY BETS lens = RED (boardServeParity pattern, bets surface).
function checkBetsParity() {
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(TRACKING, "personal_ledger.json"), "utf8"))
    const real = (ledger.bets || []).filter((b) => (b.decisionType === "placed" || b.realMoney) && Number(b.stake) >= 1 && !["smoke-test", "diag", "verify"].includes(String(b.sportsbook || "").toLowerCase()))
    const r = spawnSync("curl", ["-s", "-m", "8", "http://127.0.0.1:4000/api/ws/ledger/yesterday"], { encoding: "utf8", timeout: 12000 })
    if (r.status !== 0 || !r.stdout) return set("betsSurfaceParity", "not-run", "Bets parity: backend unreachable this cycle", "wired")
    let served; try { served = new Set((JSON.parse(r.stdout).placedBets?.bets || []).map((b) => b.id)) } catch (_) { return set("betsSurfaceParity", "fail", "Bets parity: lens returned unparseable JSON", "wired") }
    const missing = real.filter((b) => !served.has(b.id))
    if (missing.length) return set("betsSurfaceParity", "fail", `Bets parity: ${missing.length} realMoney row(s) ABSENT from MY BETS (${missing.slice(0, 2).map((b) => b.id).join(", ")}) — the record must never age out of its surface`, "wired")
    return set("betsSurfaceParity", "green", `Bets parity: all ${real.length} realMoney rows served (lifetime lens)`, "wired")
  } catch (e) { return set("betsSurfaceParity", "not-run", `Bets parity: ${String(e?.message || e)}`, "wired") }
}
checkBetsParity()

// (h) 2026-07-28 PARLAY SETTLE — 2026-07-30 BAR REWRITE (incident 7aae50f):
// the old ≥2-day grace let a ticket that can NEVER self-settle (twin-less leg,
// the Clement u0.5 class) sit green for two nights. New bar: a pending
// realMoney parlay is STALE the moment its slate has GRADED (the slate's
// tracked file carries win/loss rows — the settle pass had its chance) and
// the slate is at least 1 day old. No grace for the unsettleable.
function checkParlaySettle() {
  try {
    const today = currentSlateDateEt()
    const ledger = JSON.parse(fs.readFileSync(path.join(TRACKING, "personal_ledger.json"), "utf8"))
    const pendingP = (ledger.bets || []).filter((b) => (b.betType === "parlay" || b.betType === "slip") && (b.decisionType === "placed" || b.realMoney) && b.result === "pending" && (b.gameDate || b.date))
    // 2026-08-02 VOID-WAIT v3 (ASK 70cf06c): an alarm that fires a day before
    // the rule it polices is ALLOWED to act trains the operator to ignore red
    // (b62d25d6 sat red-stale a full day before the 2-day void window armed).
    // A pending parlay whose ONLY unresolved legs are VOID-CANDIDATES (one
    // authority: classifyLegs) is WAITING, not stale, until the window arms.
    const { classifyLegs, loadFinals } = require("./settleParlaysFromRecord")
    const waiting = []
    const stale = pendingP.filter((b) => {
      const d = b.gameDate || b.date
      const ageDays = (Date.parse(today) - Date.parse(d)) / 86400000
      if (ageDays < 1) return false
      let rows = []
      try { rows = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${d}.json`), "utf8")) } catch (_) {}
      const slateGraded = Array.isArray(rows) && rows.some((r) => ["win", "loss"].includes(String(r.result)))
      if (!slateGraded && ageDays < 2) return false
      if (ageDays < 2 && Array.isArray(b.legs) && b.legs.length) {
        const cls = classifyLegs(b, rows, loadFinals(d, TRACKING))
        const unresolved = cls.filter((c) => c.state !== "graded")
        if (unresolved.length && unresolved.every((c) => c.state === "void_candidate")) {
          const arms = new Date(Date.parse(d) + 2 * 86400000).toISOString().slice(0, 10)
          waiting.push(`${b.id} (void-confirming — window arms ${arms})`)
          return false
        }
      }
      return true // graded slate w/ non-void-candidate unresolved legs, or the window armed and it still didn't move
    })
    if (stale.length) return set("parlaySettle", "fail", `Parlay settle: ${stale.length} realMoney parlay(s) pending past a GRADED slate (${stale.slice(0, 2).map((b) => b.id).join(", ")}) — twin-less leg or settle stall; the finals-fallback should have caught it`, "wired")
    return set("parlaySettle", "green", `Parlay settle: ${pendingP.length} pending${waiting.length ? ` · ${waiting.join(" · ")}` : ""}, none past a graded slate the rule could act on`, "wired")
  } catch (e) { return set("parlaySettle", "not-run", `Parlay settle: ${String(e?.message || e)}`, "wired") }
}
checkParlaySettle()

// (k) 2026-07-30 LEG-DEATH DISAGREEMENT (incident ASK part E) — an official
// settle that CONTRADICTS a logged irreversible live call = RED loudly:
// either the live read or the grader is wrong, and both claim authority a
// bettor acted on. Events logged by the ledger lens (parlay_leg_death_events
// .jsonl); irreversible calls only (over-reached / under-breached / graded-
// twin loss), so a contradiction is never "the game moved on".
function checkLegDeathDisagreement() {
  try {
    const evP = path.join(TRACKING, "parlay_leg_death_events.jsonl")
    const events = fs.existsSync(evP) ? fs.readFileSync(evP, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean) : []
    // 2026-08-15 SEV-1 8a94621b — BOOK-TRUTH CORRECTIONS feed this alarm:
    // every one is an auto-settle the BOOK contradicted (the record lied
    // until a human fixed it). LOUD for 3 days per event (cry-wolf doctrine:
    // a red nobody can act on trains ignoring red — the root class gets fixed
    // in the same pack, so the loud window is for CA/operator review, then
    // the history stays visible in the green line).
    const ctP = path.join(TRACKING, "book_truth_corrections.jsonl")
    const corrections = fs.existsSync(ctP) ? fs.readFileSync(ctP, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean) : []
    const CORR_LOUD_DAYS = 3
    const recentCorr = corrections.filter((c) => Date.parse(c.ts) > Date.now() - CORR_LOUD_DAYS * 86400000)
    const ledger = JSON.parse(fs.readFileSync(path.join(TRACKING, "personal_ledger.json"), "utf8"))
    const byId = new Map((ledger.bets || []).map((b) => [b.id, b]))
    const contradictions = []
    for (const e of events) {
      const b = byId.get(e.betId)
      if (!b || b.result === "pending") continue
      // the call said the TICKET was effectively dead; a WIN settle contradicts it
      if (e.ticketCall === "dead" && b.result === "win") contradictions.push(`${e.betId} (called dead ${String(e.ts).slice(0, 10)}, settled WIN)`)
      // 2026-08-02 VOID-WAIT (b) — BIDIRECTIONAL: an effective-win call
      // contradicted by an official LOSS is the same class of lie.
      if (e.ticketCall === "won_confirming" && b.result === "loss") contradictions.push(`${e.betId} (called won-confirming ${String(e.ts).slice(0, 10)}, settled LOSS)`)
    }
    if (contradictions.length) return set("legDeathDisagreement", "fail", `Leg-death disagreement: ${contradictions.length} official settle(s) contradict an irreversible live call — ${contradictions.slice(0, 2).join("; ")} — the live read or the grader is wrong; HUMAN LOOK REQUIRED`, "wired")
    if (recentCorr.length) return set("legDeathDisagreement", "fail", `Book-truth corrections (${CORR_LOUD_DAYS}d loud window): ${recentCorr.length} auto-settle(s) the book contradicted — ${recentCorr.slice(-2).map((c) => `${c.id} (${c.prevResult}→${c.newResult}, slip ${c.slipId})`).join("; ")} — HUMAN LOOK: name the grader class that lied`, "wired")
    return set("legDeathDisagreement", "green", `Leg-death disagreement: ${events.length} irreversible call(s), zero contradictions; ${corrections.length} book-truth correction(s) on file, none in the ${CORR_LOUD_DAYS}d loud window`, "wired")
  } catch (e) { return set("legDeathDisagreement", "not-run", `Leg-death disagreement: ${String(e?.message || e)}`, "wired") }
}
checkLegDeathDisagreement()

// (i) 2026-07-28 LINE-FRESHNESS AT SERVE — the pack's ships-with alarm:
// RED when the serve pass stops stamping cards, revalidation errored recently,
// or the snapshot has outlived its REAL refresh cadence during a game window
// (cards may be serving dead lines — the Clement u1.5 class). PREMISE
// CORRECTION (measured at build, 2026-07-28): the 5-min close-capture loop
// READS the snapshot, it does not refresh it — snapshot-mlb.json is written
// by the HOURLY slate:mlb run, so intra-hour ages up to ~60m are NORMAL. The
// ASK's literal >15m bar would be RED most of every game night (cry-wolf);
// the bar here is hourly + grace = >75m, which means the refresher is
// actually dead. A true 15m bar needs a game-window snapshot refresher
// (quota-costed — its own ASK). Honest states: backend down ⇒ not-run; empty
// board ⇒ green (board emptiness is boardServeParity's beat, not ours).
const LF_GAME_WINDOW_MAX_AGE_MIN = 75
function checkLineFreshness() {
  try {
    const slate = currentSlateDateEt()
    const L = latestLedger()
    // Game window = any pick on the CURRENT slate with first pitch between
    // 4h ago and 30min from now (close-capture keeps snapshots ≤~5m in it).
    const inWindow = !!(L && L.slate === slate && L.rows.some((r) => {
      const gt = r.gameTime ? Date.parse(r.gameTime) : null
      return gt && gt >= now - 4 * 3600e3 && gt <= now + 30 * 60e3
    }))
    let ageMin = null
    try { ageMin = (now - fs.statSync(path.join(BACKEND, "snapshot-mlb.json")).mtimeMs) / 60000 } catch (_) {}
    let recentErrors = 0
    try {
      const lines = fs.readFileSync(path.join(TRACKING, "line_freshness_events.jsonl"), "utf8").split("\n").filter(Boolean).slice(-500)
      for (const l of lines) { try { const e = JSON.parse(l); if (e.type === "error" && now - Date.parse(e.ts) < 3600e3) recentErrors++ } catch (_) {} }
    } catch (_) {}
    const r = spawnSync("curl", ["-s", "-m", "8", "http://127.0.0.1:4000/api/ws/top-picks?limit=20"], { encoding: "utf8", timeout: 12000 })
    if (r.status !== 0 || !r.stdout) return set("lineFreshness", "not-run", "Line freshness: backend unreachable this cycle", "wired")
    let j; try { j = JSON.parse(r.stdout) } catch (_) { return set("lineFreshness", "fail", "Line freshness: top-picks returned unparseable JSON", "wired") }
    const served = Array.isArray(j.picks) ? j.picks.length : 0
    const summary = j.lineFreshness
    if (served > 0 && !summary) return set("lineFreshness", "fail", `Line freshness: ${served} cards served WITHOUT the revalidation stamp — the serve pass is not running`, "wired")
    if (summary && summary.error) return set("lineFreshness", "fail", `Line freshness: revalidation ERRORED at serve (${String(summary.error).slice(0, 100)})`, "wired")
    if (recentErrors) return set("lineFreshness", "fail", `Line freshness: ${recentErrors} revalidation error event(s) in the last hour — cards are serving stamped-stale`, "wired")
    if (inWindow && ageMin != null && ageMin > LF_GAME_WINDOW_MAX_AGE_MIN) return set("lineFreshness", "fail", `Line freshness: snapshot ${ageMin.toFixed(0)}m old during a game window (>${LF_GAME_WINDOW_MAX_AGE_MIN}m = the hourly slate refresher is dead) — cards are revalidating against a corpse; check scheduler slate:mlb`, "wired")
    const c = (summary && summary.counts) || {}
    const unconfirmed = (c.suspended || 0) + (c.unknown_stale || 0)
    return set("lineFreshness", "green", `Line freshness: ${served} card(s) stamped (${c.line_moved || 0} moved · ${c.price_drift || 0} drifted · ${unconfirmed} unconfirmed) · snapshot ${ageMin != null ? ageMin.toFixed(0) + "m" : "?"} old${inWindow ? " · game window" : ""}`, "wired")
  } catch (e) { return set("lineFreshness", "not-run", `Line freshness: ${String(e?.message || e)}`, "wired") }
}
checkLineFreshness()

// ── write sidecar (LAST — after every check; see relocation note above) ──
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

const order = ["devigAnalytics", "cashoutHedge", "pinnacleBenchmarkSelfTest", "shadowStack", "pinnacleSidecar", "forwardClvTracker", "closingLineCapture", "contextPersistence", "forwardCapture", "boardServeParity", "ladderCapture", "rungScan", "daily3Grading", "n1Instrument", "rungSettles", "pairCorpus", "parlayScan", "criticNightly", "betsSurfaceParity", "parlaySettle", "lineFreshness", "daily3Receipt", "legDeathDisagreement", "gradBoardStall", "nflCapture", "market_prior", "schedulerIdentity"]
console.log("=== component health (tested-green) " + nowIso + " ===")
for (const k of order) { const c = components[k]; if (!c) continue; console.log(`  ${k.padEnd(26)} ${c.state.toUpperCase().padEnd(8)} ${c.reason}`) }
console.log("summary: " + JSON.stringify(summary))
console.log("wrote: " + OUT)
process.exit(0)
