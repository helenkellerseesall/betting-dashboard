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
const { currentSlateDateEt, slateDateForTimestamp } = require("../pipeline/shared/slateDate")

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

// Phase Date-Doctrine-1B-fix1 — was a shadow Intl helper. Now routes through
// canonical slateDate.js so the /status dashboard honors the 4 AM ET rollover
// (was reporting the new calendar day immediately at 00:00 ET, but canonical
// slate doesn't roll until 04:00 ET, so the dashboard's "today" diverged from
// the writers' "today" between 00:00 ET and 04:00 ET).
function etDateKey(d = new Date()) {
  const ts = (d instanceof Date) ? d.getTime() : new Date(d).getTime()
  return Number.isFinite(ts) ? slateDateForTimestamp(ts) : currentSlateDateEt()
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
    // 2026-06-01 Phase Status-Dashboard-1C dashboard-feedback fix —
    // populator chain at 3:05-3:25 ET emits 5 named scripts (populateMlbBatterStats,
    // populateMlbBatterGameLogs, populateMlbPitcherGameLogs, deriveNbaDvP,
    // populateNbaTeamStats). Treat the chain as one event: first start = chain
    // started, last OK = chain ended. Catches the dashboard-row regression where
    // the populator chain showed "not fired yet today" even though it ran.
    const popStarts = lines.filter(l =>
      l.includes("populateMlbBatterStats starting") ||
      l.includes("populateMlbBatterGameLogs starting") ||
      l.includes("populateMlbPitcherGameLogs starting") ||
      l.includes("deriveNbaDvP starting") ||
      l.includes("populateNbaTeamStats starting")
    )
    const popOks = lines.filter(l =>
      l.includes("populateMlbBatterStats OK") ||
      l.includes("populateMlbBatterGameLogs OK") ||
      l.includes("populateMlbPitcherGameLogs OK") ||
      l.includes("deriveNbaDvP OK") ||
      l.includes("populateNbaTeamStats OK")
    )
    const populatorChain = {
      startedLine: popStarts[0] || null,
      endedLine: popOks[popOks.length - 1] || null,
      fired: popStarts.length > 0,
      completed: popOks.length >= 5,  // chain has 5 populators
      okCount: popOks.length,
    }
    return {
      ok: true,
      dateKey,
      gradingBackfillAll: findEvent("grading:backfill-all starting", "grading:backfill-all OK"),
      auditNightly: findEvent("audit:nightly starting", "audit:nightly OK"),
      populatorChain,
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

/**
 * Predict the next scheduled fires based on scheduler.sh's documented cadences.
 * Phase Status-Dashboard-1C — gives operator answer to "when's the next thing
 * supposed to fire?" so the dashboard surfaces forward-looking schedule, not
 * just historical.
 *
 * Known fires (per backend/scripts/scheduler.sh):
 *   - 03:05-03:25 ET each day: MLB batter stats + game logs, pitcher game logs,
 *     NBA DvP, NBA team stats (5 populators, 5 min apart).
 *   - 04:00 ET each day: grading:backfill-all (Phase Autonomous-Orchestrator-1A).
 *   - 05:00 ET each day: audit:nightly (Phase Audit-Nightly-Autopilot-1A).
 *   - :00 hourly 09:00-23:00 ET: slate:mlb + sysAudit (CLV resilience canary).
 *   - :00 / :30 hourly 16:00-23:30 ET: slate:nba.
 *   - :15 hourly 9:00-23:00 ET: populateNbaInjuryReport.
 *   - :45 hourly 9:00-23:00 ET: populateNbaGameLogs.
 */
function sectionSchedule() {
  try {
    const now = new Date()
    // Get current ET time as a JS Date — we use the ET-formatted year/month/day/hour/minute
    // to construct a "today in ET" anchor, then advance.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    })
    const parts = fmt.formatToParts(now).reduce((acc, p) => {
      if (p.type !== "literal") acc[p.type] = Number(p.value)
      return acc
    }, {})
    // parts = { year, month, day, hour, minute, second }
    const hr  = parts.hour
    const min = parts.minute

    // Helper — construct an ET-anchored Date for today at (h, m)
    const etDate = (h, m, dayOffset = 0) => {
      // We need an absolute UTC timestamp that corresponds to (today ET, h:m).
      // ET is UTC-4 in June (EDT). Use Date.UTC then offset.
      // For dayOffset, advance the date by adding days to parts.day.
      const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, h + 4, m, 0))
      return d
    }

    // Generate fires across today + tomorrow window, then pick those after `now`.
    const fires = []

    for (const dayOffset of [0, 1]) {
      // Populators 3:05-3:25 (treat the chain as one event at 3:05 AM)
      fires.push({ at: etDate(3, 5, dayOffset),  label: "populator chain", detail: "MLB batter+pitcher+game logs, NBA DvP+team stats (5 populators, 5 min apart)" })
      // 4 AM grading
      fires.push({ at: etDate(4, 0, dayOffset),  label: "grading:backfill-all", detail: "nightly grading autopilot — refreshes calibration corpus" })
      // 5 AM audit:nightly
      fires.push({ at: etDate(5, 0, dayOffset),  label: "audit:nightly", detail: "writes daily proof report to backend/runtime/audits/" })
      // Hourly events 9-23
      for (let h = 9; h <= 23; h++) {
        fires.push({ at: etDate(h, 0, dayOffset),  label: "hourly sysAudit + slate:mlb",  detail: "CLV canary + MLB slate refresh" })
        fires.push({ at: etDate(h, 15, dayOffset), label: "NBA injuries refresh", detail: "ESPN injuries scrape" })
        fires.push({ at: etDate(h, 45, dayOffset), label: "NBA game logs refresh", detail: "ESPN per-team game logs" })
      }
      // NBA slates every 30 min 16:00-23:30
      for (let h = 16; h <= 23; h++) {
        fires.push({ at: etDate(h, 0,  dayOffset), label: "slate:nba (:00)", detail: "NBA slate refresh" })
        fires.push({ at: etDate(h, 30, dayOffset), label: "slate:nba (:30)", detail: "NBA slate refresh" })
      }
    }

    const upcoming = fires
      .filter(f => f.at.getTime() > now.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, 8)
      .map(f => ({
        atIso: f.at.toISOString(),
        atEt: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(f.at),
        inSec: Math.round((f.at.getTime() - now.getTime()) / 1000),
        label: f.label,
        detail: f.detail,
      }))

    return { ok: true, upcoming, currentEt: `${parts.hour.toString().padStart(2,"0")}:${parts.minute.toString().padStart(2,"0")}` }
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
  out.schedule          = sectionSchedule()
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
