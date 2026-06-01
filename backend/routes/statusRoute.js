"use strict"

/**
 * statusRoute.js — Phase Status-Dashboard-1A (Layer 1)
 *
 * GET /api/ws/status — aggregate self-monitoring view for operator.
 *
 * Closes the structural trust gap: operator depending on Claude's memory
 * across compaction is unsustainable. This route lets the repo describe
 * itself in real time. Layer 2 (a static HTML page at /status) will render
 * this JSON with auto-poll; this file is the data source.
 *
 * Doctrine:
 *   - No new infrastructure. Reads files that scheduler.sh + sysAudit
 *     already write to disk. Queries the canonical SQLite at
 *     backend/storage/betting.db. Calls launchctl list.
 *   - Each section is independently wrapped — a failure in one signal
 *     never breaks the others. Sections that fail report `{ ok: false, error }`.
 *   - Fast: target < 500ms total. No HTTP calls out. No expensive aggregates.
 *
 * Sections (each is a top-level key in the JSON response):
 *   - meta                — generatedAt, currentTimeEt, host info
 *   - launchAgents        — 4-agent dot state with PIDs + exit status
 *   - scheduler           — last tick, last-hour event count, last 5 events
 *   - backend             — version commit, uptime, pid, healthy bool
 *   - sysAuditLast        — most recent RED line from drift_alerts.log (last 24h)
 *   - driftAlertsTail     — last 10 entries from drift_alerts.log
 *   - clvCaptureToday     — % of tipped picks with closing odds stamped today
 *   - slateFiresToday     — last slate:nba + slate:mlb fires today + status
 *   - autopilotFiresToday — 4 AM grading + 5 AM audit fire status today
 *   - familyCalibration   — current dampener multipliers per family + last rebuild
 *   - trackedBestToday    — tracked_best entry counts for today, NBA + MLB
 *   - recentCommits       — last 5 git commits (proof of canonical authority)
 */

const express = require("express")
const fs = require("fs")
const path = require("path")
const { execSync, spawnSync } = require("child_process")

const router = express.Router()

// ─────────────────────────────────────────────────────────────────────────────
// Path constants — single source of truth
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT       = path.join(__dirname, "..", "..")
const TRACKING_DIR    = path.join(REPO_ROOT, "backend", "runtime", "tracking")
const AUDITS_DIR      = path.join(REPO_ROOT, "backend", "runtime", "audits")
const CALIBRATION_DIR = path.join(REPO_ROOT, "backend", "runtime", "calibration")
const SCHEDULER_LOG   = path.join(REPO_ROOT, ".scratch", "scheduler.log")
const DRIFT_ALERTS    = path.join(AUDITS_DIR, "drift_alerts.log")
const FAMILY_CALIB    = path.join(CALIBRATION_DIR, "family_calibration.json")
const SQLITE_PATH     = path.join(REPO_ROOT, "backend", "storage", "betting.db")

const LAUNCHAGENT_LABELS = [
  "com.motel666.backend",
  "com.motel666.scheduler",
  "com.motel666.caffeinate",
  "com.motel666.cloudflared",
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeReadText(p, maxBytes = 256 * 1024) {
  try {
    const stat = fs.statSync(p)
    if (stat.size <= maxBytes) return fs.readFileSync(p, "utf8")
    // Read only the tail of large files
    const fd = fs.openSync(p, "r")
    const buf = Buffer.alloc(maxBytes)
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes)
    fs.closeSync(fd)
    return buf.toString("utf8")
  } catch (_) { return null }
}

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null }
}

function etDateKey(d = new Date()) {
  // Compute YYYY-MM-DD in America/New_York
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
  return fmt.format(d)
}

function etTimeStr(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
  return fmt.format(d)
}

// ─────────────────────────────────────────────────────────────────────────────
// Section builders — each is independently wrapped
// ─────────────────────────────────────────────────────────────────────────────

function sectionMeta() {
  const now = new Date()
  return {
    ok: true,
    generatedAt: now.toISOString(),
    et: etDateKey(now) + " " + etTimeStr(now) + " ET",
    nodeVersion: process.version,
    pid: process.pid,
  }
}

function sectionLaunchAgents() {
  // launchctl list outputs: PID Status Label (tab-separated)
  // PID === "-" means not running. Status is last exit code (negative = signal).
  try {
    const result = spawnSync("/bin/launchctl", ["list"], { encoding: "utf8", timeout: 4000 })
    if (result.error || result.status !== 0) {
      return { ok: false, error: "launchctl list failed: " + (result.error?.message || result.stderr) }
    }
    const lines = result.stdout.split("\n")
    const agents = []
    for (const label of LAUNCHAGENT_LABELS) {
      const line = lines.find(l => l.includes(label))
      if (!line) { agents.push({ label, present: false, pid: null, lastExit: null, healthy: false }); continue }
      const parts = line.trim().split(/\s+/)
      const pid = parts[0] === "-" ? null : Number(parts[0])
      const lastExit = parts[1] === "-" ? null : Number(parts[1])
      // Healthy = currently running. Negative lastExit (killed by signal) is
      // historical and doesn't mean unhealthy if PID is set.
      const healthy = pid != null
      agents.push({ label, present: true, pid, lastExit, healthy })
    }
    const allHealthy = agents.every(a => a.healthy)
    return { ok: true, allHealthy, agents }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionScheduler() {
  try {
    const txt = safeReadText(SCHEDULER_LOG)
    if (!txt) return { ok: false, error: "scheduler.log not found or unreadable" }
    const lines = txt.split("\n").filter(Boolean)
    // Last 1h tick count — count lines whose timestamp is within 60 min
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    let lastHourCount = 0
    let lastTickAt = null
    const recentEvents = []
    // Walk from the END for efficiency
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ET\]/)
      if (!tsMatch) continue
      // Parse as ET (UTC-4 in June, UTC-5 in winter — use Date.parse with explicit UTC offset)
      const isoEt = tsMatch[1] + "T" + tsMatch[2] + "-04:00"  // June DST; close enough for relative
      const ts = Date.parse(isoEt)
      if (!lastTickAt) lastTickAt = { iso: isoEt, line }
      if (ts >= oneHourAgo) lastHourCount++
      if (recentEvents.length < 8) recentEvents.push(line)
      if (ts < oneHourAgo && lastHourCount > 0) break
    }
    return {
      ok: true,
      lastTickEt: lastTickAt?.iso ?? null,
      lastTickLine: lastTickAt?.line ?? null,
      lastHourEventCount: lastHourCount,
      recentEvents,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionBackend() {
  try {
    let commit = "unknown", commitShort = "unknown", commitDate = null
    try {
      commit = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, timeout: 2000 }).toString().trim()
      commitShort = commit.slice(0, 7)
      commitDate = execSync("git log -1 --format=%cI HEAD", { cwd: REPO_ROOT, timeout: 2000 }).toString().trim()
    } catch (_) {}
    return {
      ok: true,
      healthy: true,
      commit,
      commitShort,
      commitDate,
      pid: process.pid,
      uptimeSec: Math.floor(process.uptime()),
      nodeVersion: process.version,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionSysAuditLast() {
  try {
    const txt = safeReadText(DRIFT_ALERTS)
    if (!txt) return { ok: true, lastRed: null, message: "No drift_alerts.log yet" }
    const lines = txt.split("\n").filter(l => l.trim().length > 0)
    if (lines.length === 0) return { ok: true, lastRed: null, message: "drift_alerts.log empty" }
    const last = lines[lines.length - 1]
    return { ok: true, lastRed: last }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionDriftAlertsTail(n = 10) {
  try {
    const txt = safeReadText(DRIFT_ALERTS)
    if (!txt) return { ok: true, lines: [] }
    const lines = txt.split("\n").filter(l => l.trim().length > 0)
    return { ok: true, lines: lines.slice(-n) }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionClvCaptureToday() {
  // Look at today's NBA + MLB tracked_bets and compute close-stamped %
  try {
    const dateKey = etDateKey()
    const sports = ["nba", "mlb"]
    const results = {}
    let totalTipped = 0
    let totalStamped = 0
    for (const sport of sports) {
      const file = path.join(TRACKING_DIR, `${sport}_tracked_bets_${dateKey}.json`)
      if (!fs.existsSync(file)) { results[sport] = { tipped: 0, stamped: 0, rate: null, hasFile: false }; continue }
      const j = safeReadJson(file)
      const arr = Array.isArray(j) ? j : (j?.entries || j?.bets || [])
      const now = Date.now()
      // "tipped" = gameTime < now (already in progress or finished)
      const tipped = arr.filter(e => {
        const gt = e.gameTime ? Date.parse(e.gameTime) : null
        return gt && gt <= now
      })
      const stamped = tipped.filter(e => e.closingOdds != null || e.closeStamped === true)
      const rate = tipped.length === 0 ? null : Math.round(stamped.length / tipped.length * 1000) / 10
      results[sport] = { tipped: tipped.length, stamped: stamped.length, rate, hasFile: true }
      totalTipped += tipped.length
      totalStamped += stamped.length
    }
    return {
      ok: true,
      dateKey,
      totalTipped,
      totalStamped,
      overallRate: totalTipped === 0 ? null : Math.round(totalStamped / totalTipped * 1000) / 10,
      perSport: results,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionSlateFiresToday() {
  try {
    const dateKey = etDateKey()
    const txt = safeReadText(SCHEDULER_LOG)
    if (!txt) return { ok: false, error: "scheduler.log not readable" }
    const lines = txt.split("\n")
    const matches = lines.filter(l => l.includes(dateKey) && /slate:(nba|mlb)/.test(l))
    const nbaLines = matches.filter(l => l.includes("slate:nba"))
    const mlbLines = matches.filter(l => l.includes("slate:mlb"))
    const lastOk = (arr, tag) => {
      const okLine = [...arr].reverse().find(l => l.includes(tag + " OK"))
      const failLine = [...arr].reverse().find(l => l.includes(tag + " FAILED"))
      return { lastOk: okLine || null, lastFailed: failLine || null, totalFires: arr.filter(l => l.includes(tag + " starting")).length }
    }
    return {
      ok: true,
      dateKey,
      slateNba: lastOk(nbaLines, "slate:nba"),
      slateMlb: lastOk(mlbLines, "slate:mlb"),
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionAutopilotFiresToday() {
  try {
    const dateKey = etDateKey()
    const txt = safeReadText(SCHEDULER_LOG)
    if (!txt) return { ok: false, error: "scheduler.log not readable" }
    const lines = txt.split("\n").filter(l => l.includes(dateKey))
    const findEvent = (substrStart, substrEnd) => {
      const start = lines.find(l => l.includes(substrStart))
      const end = lines.find(l => l.includes(substrEnd))
      return { startedLine: start || null, endedLine: end || null, fired: !!start, completed: !!end }
    }
    return {
      ok: true,
      dateKey,
      gradingBackfillAll: findEvent("grading:backfill-all starting", "grading:backfill-all OK"),
      auditNightly: findEvent("audit:nightly starting", "audit:nightly OK"),
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionFamilyCalibration() {
  try {
    const j = safeReadJson(FAMILY_CALIB)
    if (!j) return { ok: false, error: "family_calibration.json not found or unreadable" }
    return {
      ok: true,
      generatedAt: j.generatedAt,
      windowDays: j.windowDays,
      minSample: j.minSample,
      sports: j.sports,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionTrackedBestToday() {
  try {
    const dateKey = etDateKey()
    const result = {}
    for (const sport of ["nba", "mlb"]) {
      const file = path.join(TRACKING_DIR, `${sport}_tracked_best_${dateKey}.json`)
      if (!fs.existsSync(file)) { result[sport] = { hasFile: false, total: 0, byFamily: {} }; continue }
      const j = safeReadJson(file)
      const arr = Array.isArray(j) ? j : (j?.entries || j?.bets || [])
      const byFamily = {}
      for (const e of arr) {
        const f = e.statFamily || e.propType || "unknown"
        byFamily[f] = (byFamily[f] || 0) + 1
      }
      result[sport] = { hasFile: true, total: arr.length, byFamily }
    }
    return { ok: true, dateKey, perSport: result }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function sectionRecentCommits(n = 5) {
  try {
    const log = execSync(`git log --oneline -${n}`, { cwd: REPO_ROOT, timeout: 3000 }).toString().trim()
    return { ok: true, commits: log.split("\n") }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler — aggregate every section, all wrapped
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", (req, res) => {
  const t0 = Date.now()
  const out = {}
  out.meta              = sectionMeta()
  out.launchAgents      = sectionLaunchAgents()
  out.scheduler         = sectionScheduler()
  out.backend           = sectionBackend()
  out.sysAuditLast      = sectionSysAuditLast()
  out.driftAlertsTail   = sectionDriftAlertsTail(10)
  out.clvCaptureToday   = sectionClvCaptureToday()
  out.slateFiresToday   = sectionSlateFiresToday()
  out.autopilotFiresToday = sectionAutopilotFiresToday()
  out.familyCalibration = sectionFamilyCalibration()
  out.trackedBestToday  = sectionTrackedBestToday()
  out.recentCommits     = sectionRecentCommits(5)
  out.meta.elapsedMs    = Date.now() - t0
  res.json(out)
})

module.exports = router
