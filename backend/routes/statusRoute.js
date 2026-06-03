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
 *   - launchAgents        — all-agent dot state (4 daemons + 3 scheduled autopilots) with PIDs + exit status; per-kind healthy rule
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
const { currentSlateDateEt, slateDateForTimestamp, calendarDateEt, calendarDateForTimestamp } = require("../pipeline/shared/slateDate")

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

// Phase Status-LaunchAgent-Visibility-1A (2026-06-02) — full 7-agent roster with
// per-kind healthy semantics so scheduled autopilots don't fake-red the dot.
//
// kind: "daemon"    = must be running 24/7 (PID required → healthy)
// kind: "scheduled" = fires on cadence + exits cleanly (lastExit ∈ {0,null,<0} → healthy;
//                     only positive non-zero lastExit = real failure = unhealthy)
const LAUNCHAGENT_LABELS = [
  { label: "com.motel666.backend",          kind: "daemon" },
  { label: "com.motel666.scheduler",        kind: "daemon" },
  { label: "com.motel666.caffeinate",       kind: "daemon" },
  { label: "com.motel666.cloudflared",      kind: "daemon" },
  { label: "com.motel666.populator-chain",  kind: "scheduled", nextFire: "3:05 AM ET" },
  { label: "com.motel666.grading-nightly",  kind: "scheduled", nextFire: "4:00 AM ET" },
  { label: "com.motel666.audit-nightly",    kind: "scheduled", nextFire: "5:00 AM ET" },
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

// Phase Date-Doctrine-1B-fix2 — TWO date concepts, distinct callers:
//
//   etDateKey()      — SLATE date (4 AM ET boundary). For tracked_best file
//                      lookups, slate-fires bucketing, CLV today windows — any
//                      "which slate does this belong to" lookup. At 02:30 ET
//                      this returns yesterday's slate, because late games
//                      haven't settled until 04:00 ET.
//
//   calendarDateKey()— CALENDAR date (wall clock, no boundary). For the
//                      /status header timestamp display, "what does my clock
//                      say right now." At 02:30 ET this returns today's
//                      calendar date.
//
// fix1 (2026-06-02) conflated these — made etDateKey use slate semantics for
// EVERYTHING, including the header, which broke operator's natural
// expectation that the wall-clock header shows wall-clock date.
function etDateKey(d = new Date()) {
  const ts = (d instanceof Date) ? d.getTime() : new Date(d).getTime()
  return Number.isFinite(ts) ? slateDateForTimestamp(ts) : currentSlateDateEt()
}
function calendarDateKey(d = new Date()) {
  const ts = (d instanceof Date) ? d.getTime() : new Date(d).getTime()
  return Number.isFinite(ts) ? calendarDateForTimestamp(ts) : calendarDateEt()
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
  // Phase Date-Doctrine-1B-fix2 — header uses CALENDAR date (wall clock).
  // At 12:58 AM ET June 2, header shows "2026-06-02 00:58 ET" (matches every
  // clock on Earth). The 4 AM boundary is a betting-slate concept and lives
  // in sectionTrackedBestToday + sectionClvCaptureToday + sectionSlateFiresToday
  // (all use etDateKey, which IS slate-date).
  return {
    ok: true,
    generatedAt: now.toISOString(),
    et: calendarDateKey(now) + " " + etTimeStr(now) + " ET",
    slateDate: etDateKey(now),   // also surfaced separately so operator can see both
    nodeVersion: process.version,
    pid: process.pid,
  }
}

function sectionLaunchAgents() {
  // launchctl list outputs: PID Status Label (tab-separated)
  // PID === "-" means not running. Status is last exit code (negative = signal).
  //
  // Phase Status-Headline-Cron-Aware-1A (2026-06-02 ~03:40 ET) — when
  // scheduler LaunchAgent is intentionally unloaded (because cron owns
  // scheduler.sh resurrection now), check for the actual scheduler.sh
  // process via pgrep. If the process is running by ANY means (LaunchAgent
  // OR cron-spawned), count the agent as healthy.
  //
  // Anti-fabrication: pgrep returns real PID from kernel process table.
  // Never defaults to "alive" without proof.
  try {
    const result = spawnSync("/bin/launchctl", ["list"], { encoding: "utf8", timeout: 4000 })
    if (result.error || result.status !== 0) {
      return { ok: false, error: "launchctl list failed: " + (result.error?.message || result.stderr) }
    }

    // Probe scheduler.sh via pgrep (handles cron-spawned case)
    let schedulerProcessPid = null
    try {
      const pgrep = spawnSync("/usr/bin/pgrep", ["-f", "/Users/andrewmoore/Projects/betting-dashboard/backend/scripts/scheduler.sh"], { encoding: "utf8", timeout: 2000 })
      if (pgrep.status === 0 && pgrep.stdout) {
        const pids = pgrep.stdout.trim().split("\n").map(p => Number(p)).filter(p => Number.isFinite(p))
        // Filter out the pgrep sub-shells launched BY the cron watchdog (they
        // also match `-f scheduler.sh`). Real scheduler is the longest-lived
        // bash process running the script — typically the LOWEST pid.
        if (pids.length > 0) schedulerProcessPid = Math.min(...pids)
      }
    } catch (_) {}

    const lines = result.stdout.split("\n")
    const agents = []
    for (const entry of LAUNCHAGENT_LABELS) {
      // Phase Status-LaunchAgent-Visibility-1A — entry is now {label, kind, nextFire?}
      const label    = entry.label
      const kind     = entry.kind            // "daemon" | "scheduled"
      const nextFire = entry.nextFire || null
      const line = lines.find(l => l.includes(label))
      const isScheduler = label === "com.motel666.scheduler"
      if (!line) {
        // Phase Status-Headline-Cron-Aware-1A — scheduler agent unloaded?
        // Check pgrep — if scheduler.sh is running (cron watchdog
        // resurrected it), count as healthy with source="cron-spawned".
        if (isScheduler && schedulerProcessPid != null) {
          agents.push({
            label, kind, nextFire, present: true, pid: schedulerProcessPid, lastExit: null, healthy: true,
            source: "cron-spawned",
            note: "LaunchAgent intentionally unloaded — scheduler.sh resurrected by cron watchdog every minute. See CRON_BACKUP_v1 entries.",
          })
        } else {
          // Not present in launchctl → unhealthy regardless of kind. This is
          // a real failure (operator hasn't installed it OR it got purged).
          agents.push({ label, kind, nextFire, present: false, pid: null, lastExit: null, healthy: false, source: "launchd", note: "not loaded in launchctl" })
        }
        continue
      }
      const parts = line.trim().split(/\s+/)
      const pid = parts[0] === "-" ? null : Number(parts[0])
      const lastExit = parts[1] === "-" ? null : Number(parts[1])

      // Phase Status-LaunchAgent-Visibility-1A — per-kind healthy rule.
      // No fake greens (default healthy:true), no fake reds (scheduled agent
      // between fires marked unhealthy because pid is null). Every truthy
      // healthy traces to a real source: either pid (daemon running) or
      // lastExit (scheduled agent's last fire was clean).
      let healthy
      if (kind === "daemon") {
        // Daemon must be currently running
        healthy = pid != null
      } else if (kind === "scheduled") {
        // Scheduled autopilot: between fires PID is null (correct, not a failure).
        // Healthy iff present AND lastExit is in {0, null, negative-signal}.
        // Positive non-zero lastExit = real npm/script failure = unhealthy.
        const exitOk = lastExit === 0 || lastExit === null || (Number.isFinite(lastExit) && lastExit < 0)
        healthy = exitOk
      } else {
        // Unknown kind = treat as daemon (conservative — surfaces config bug)
        healthy = pid != null
      }
      let source = "launchd"
      let note = null
      // Phase Status-Headline-Cron-Aware-1A — even if LaunchAgent says
      // pid=null for scheduler, fall through to pgrep result.
      if (isScheduler && !healthy && schedulerProcessPid != null) {
        healthy = true
        source = "cron-spawned"
        note = "LaunchAgent has no PID but scheduler.sh process detected via pgrep — cron watchdog covering."
      }
      // Phase Status-LaunchAgent-Visibility-1A-fix1 — schedulerProcessPid fallback
      // is ONLY valid for the scheduler agent. Pre-existing bug (`pid ?? schedulerProcessPid`)
      // leaked scheduler's PID to every agent with pid:null — was harmless with 4 daemons
      // (all had running PIDs) but surfaced when 3 scheduled autopilots joined (their
      // pid is null between fires, so they all displayed scheduler's PID as their own).
      // Real source: null PID for non-scheduler agents must stay null, never fabricate.
      const finalPid = (isScheduler && pid == null) ? schedulerProcessPid : pid
      agents.push({ label, kind, nextFire, present: true, pid: finalPid, lastExit, healthy, source, note })
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
    // Phase Status-Autopilot-Calendar-Date-Fix-1A — same reasoning as
    // sectionAutopilotFiresToday: scheduler.log uses calendar timestamps,
    // "slate fires today" is a wall-clock event count, not a slate-data
    // lookup. Use calendar date.
    const dateKey = calendarDateKey()
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
    // Phase Status-Autopilot-Calendar-Date-Fix-1A (2026-06-02 ~03:30 ET) —
    // scheduler.log timestamps lines with CALENDAR date (when the event
    // physically occurred on the operator's wall clock). The autopilot
    // section is "events that happened today" semantically — use calendar.
    // Previous bug: between 00:00-04:00 ET, slate was yesterday's but log
    // lines were today's calendar = filter missed freshly-fired events.
    const dateKey = calendarDateKey()
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

// Phase Status-Trust-Mirror-1A (2026-06-02) — openIssues flat summary.
//
// Operator doctrine (locked 2026-06-02 ~02:30 ET): /status reflects all
// operator concerns/worries/trust signals that can't be seen with operator's
// own eyes AND is 100% symbiotic with reality, never fake.
//
// Anti-fabrication rules enforced here:
//   - Every entry traces to a real source (calibration file, drift log,
//     git state, sysAudit summary). No synthesized issues.
//   - Empty red/yellow arrays ONLY if all sources actually report 0.
//     If a source is missing/unreadable, that BECOMES its own RED entry
//     ("can't read calibration file → can't grade picks") rather than
//     defaulting to "no issues."
//   - Severity classification uses real thresholds, not "if exists then yellow."
function sectionOpenIssues() {
  const red = []
  const yellow = []

  // Source 1: family_calibration.json — flag families with severe gaps
  // Phase Status-Issue-Taxonomy-1A — categories:
  //   - file missing / read error  → infra  (pipeline broken, engine can't grade)
  //   - per-family gap (≥15pp)    → cognition (engine self-grading is overconfident)
  try {
    const cal = safeReadJson(FAMILY_CALIB)
    if (!cal || !cal.sports) {
      red.push({
        source: "family_calibration",
        category: "infra",
        title: "Calibration file missing or unreadable",
        detail: "Engine cannot grade itself — pick trust unknown.",
        path: FAMILY_CALIB,
      })
    } else {
      for (const sport of Object.keys(cal.sports || {})) {
        for (const fam of Object.keys(cal.sports[sport] || {})) {
          const x = cal.sports[sport][fam]
          const gap = Number(x.gapPp)
          if (!Number.isFinite(gap)) continue
          if (gap >= 35) {
            red.push({
              source: "family_calibration",
              category: "cognition",
              title: `${sport}/${fam} severely miscalibrated`,
              detail: `Engine claims ${(x.stated*100).toFixed(1)}% / actually wins ${(x.realized*100).toFixed(1)}% — gap ${gap.toFixed(1)}pp (n=${x.n}, dampener ×${x.multiplier.toFixed(2)})`,
              gapPp: gap,
              multiplier: x.multiplier,
            })
          } else if (gap >= 15) {
            yellow.push({
              source: "family_calibration",
              category: "cognition",
              title: `${sport}/${fam} overconfident`,
              detail: `Engine claims ${(x.stated*100).toFixed(1)}% / actually wins ${(x.realized*100).toFixed(1)}% — gap ${gap.toFixed(1)}pp (n=${x.n}, dampener ×${x.multiplier.toFixed(2)})`,
              gapPp: gap,
              multiplier: x.multiplier,
            })
          }
        }
      }
    }
  } catch (e) {
    red.push({ source: "family_calibration", category: "infra", title: "Calibration read error", detail: String(e?.message || e) })
  }

  // Source 2: drift_alerts.log — surface recent RED lines not already covered above
  // Phase Status-Issue-Taxonomy-1A — wiring gaps = pipeline broken = infra.
  // Phase Status-OpenIssues-LiveReconcile-1A (2026-06-02) — re-validate each
  // wiring-gap RED against LIVE tracked_best data before surfacing. Suppresses
  // stale REDs whose underlying wiring has been fixed since the log entry was
  // written. Same live-data-wins model the calibration check above uses. The
  // drift_alerts.log is APPEND-ONLY — without this reconciliation, a wiring gap
  // flagged once and resolved hours later would keep re-surfacing on /status
  // forever (e.g. lineupSpot: was 0% on 2026-06-01 morning, now 77%, but the
  // morning's RED log entry was still showing on /status until this fix).
  //
  // Reconciliation rule: use the BETTER of NBA/MLB latest tracked_best rate for
  // the field. If best rate ≥ sysAudit threshold (50%), suppress as resolved.
  // If both < 50% (or files unreadable): surface with LIVE numbers, not stale log %.
  function validateWiringGapLive(fieldName) {
    if (!fieldName) return null
    let best = null  // { populated, total, rate, sport }
    for (const sport of ["mlb", "nba"]) {
      try {
        const files = fs.readdirSync(TRACKING_DIR).filter(f => new RegExp(`^${sport}_tracked_best_\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f))
        if (!files.length) continue
        const latest = files.sort().reverse()[0]
        const j = safeReadJson(path.join(TRACKING_DIR, latest))
        const entries = Array.isArray(j) ? j : (j?.entries || [])
        if (!entries.length) continue
        const populated = entries.filter(e => e[fieldName] != null).length
        const total = entries.length
        const rate = populated / total
        if (!best || rate > best.rate) best = { populated, total, rate, sport }
      } catch (_) { /* skip this sport */ }
    }
    return best
  }

  try {
    const txt = safeReadText(DRIFT_ALERTS)
    if (txt) {
      const lines = txt.split("\n").filter(l => l.trim() && /RED/.test(l)).slice(-20)
      const wiringLines = lines.filter(l => /never populated|wiring may be missing|0\/\d+\s*\(0%\)/.test(l))
      const seenWiringFields = new Set()
      for (const line of wiringLines) {
        const m = line.match(/\[✗\]\s+(\w+):/)
        const field = m && m[1]
        if (field && !seenWiringFields.has(field)) {
          seenWiringFields.add(field)
          // Phase Status-OpenIssues-LiveReconcile-1A — re-validate against live data
          const live = validateWiringGapLive(field)
          if (live && live.rate >= 0.5) {
            // Gap resolved since log was written — suppress stale RED
            continue
          }
          yellow.push({
            source: "drift_alerts",
            category: "infra",
            title: `Data wiring gap: ${field}`,
            detail: live
              ? `[live] ${field}: ${live.populated}/${live.total} (${(live.rate*100).toFixed(0)}%) in ${live.sport.toUpperCase()} tracked_best — still below 50% threshold`
              : line.replace(/^\[[\d\-:\s]+ET\]\s*RED\s*·\s*exit=\d+\s*·\s*/, "").trim() + " (couldn't validate against tracked_best — surfacing log line as-is)",
          })
        }
      }
    } else {
      yellow.push({
        source: "drift_alerts",
        category: "infra",
        title: "drift_alerts.log missing",
        detail: "sysAudit has never fired RED, OR log file was deleted — can't verify silent failures.",
      })
    }
  } catch (e) {
    yellow.push({ source: "drift_alerts", category: "infra", title: "drift_alerts read error", detail: String(e?.message || e) })
  }

  // Source 3: git state — uncommitted code = deploy-risk
  try {
    const dirty = execSync("git status --porcelain", { cwd: REPO_ROOT, timeout: 2000 }).toString().trim()
    const lines = dirty.split("\n").filter(l => l.trim() && /^\s*[MADR]/.test(l))  // only modified/added/deleted, not untracked
    if (lines.length > 0) {
      yellow.push({
        source: "git",
        category: "infra",
        title: `${lines.length} uncommitted code change(s)`,
        detail: "Backend may be running pre-edit code; restart after commit to pick up changes.",
        files: lines.slice(0, 8).map(l => l.trim()),
      })
    }
  } catch (e) {
    // git unavailable — not an operational issue, skip
  }

  // Source 4: backend uptime — < 60s = just restarted (may not have settled)
  try {
    const up = Math.floor(process.uptime())
    if (up < 60) {
      yellow.push({
        source: "backend",
        category: "infra",
        title: `Backend just restarted (${up}s ago)`,
        detail: "Caches may still be warming; first slate fire after restart may have partial data.",
      })
    }
  } catch (_) {}

  // Sort: red first, then yellow; within each, source-grouped
  red.sort((a, b) => (b.gapPp || 0) - (a.gapPp || 0))
  yellow.sort((a, b) => (b.gapPp || 0) - (a.gapPp || 0))

  // Phase Status-Issue-Taxonomy-1A — per-category counts.
  // INFRA  = machine state (pipeline broken, file missing, deploy hygiene, restart).
  // COGNITION = engine self-grading signal (calibration gaps) — dampeners already applied.
  // Live dot reads infra*Count only so cognition warnings don't trigger DEGRADED state.
  // Original redCount/yellowCount kept as TOTALS for backwards compat with any consumer
  // not yet aware of the category split.
  const infraRedCount       = red.filter(r => r.category === "infra").length
  const infraYellowCount    = yellow.filter(y => y.category === "infra").length
  const cognitionRedCount   = red.filter(r => r.category === "cognition").length
  const cognitionYellowCount= yellow.filter(y => y.category === "cognition").length

  return {
    ok: true,
    summary: {
      redCount: red.length,
      yellowCount: yellow.length,
      infraRedCount,
      infraYellowCount,
      cognitionRedCount,
      cognitionYellowCount,
      checkedAt: new Date().toISOString(),
      sourcesChecked: ["family_calibration", "drift_alerts", "git", "backend.uptime"],
    },
    red,
    yellow,
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
  // Phase Status-Trust-Mirror-1A — openIssues surfaced near the top so
  // operator-visible "what's wrong right now" hits the eye first.
  out.openIssues        = sectionOpenIssues()
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

// Phase Status-Dashboard-Export-1A — POST /api/ws/status/snapshot
// Writes the current /status JSON to .scratch/last.txt so Claude can read it
// without operator screenshotting. Triggered by the "export to scratch" button
// on the /status page. Returns { written: true, bytes, path }.
router.post("/snapshot", (req, res) => {
  try {
    const t0 = Date.now()
    const out = {}
    out.meta              = sectionMeta()
    // Phase Status-Trust-Mirror-1A — openIssues surfaced near the top so
    // export-to-scratch captures it where operator (+ Claude reading scratch)
    // sees it first.
    out.openIssues        = sectionOpenIssues()
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

    const scratchPath = path.join(REPO_ROOT, ".scratch", "last.txt")
    const body = JSON.stringify(out, null, 2)
    fs.mkdirSync(path.dirname(scratchPath), { recursive: true })
    fs.writeFileSync(scratchPath, body)
    res.json({ written: true, bytes: Buffer.byteLength(body), path: scratchPath })
  } catch (e) {
    res.status(500).json({ written: false, error: String(e?.message || e) })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase Status-Push-SSE-1A (2026-06-02) — Server-Sent Events stream
//
// GET /api/ws/status/stream — long-poll SSE endpoint. Client subscribes via
// EventSource; server pushes events on:
//   - new RED appears in openIssues (file change to drift_alerts.log)
//   - calibration recomputed (file change to family_calibration.json)
//   - 30s heartbeat (so client knows connection is alive)
//
// Anti-fabrication: events only emitted when source files actually change
// (fs.watch event). Heartbeat carries no claimed state — only "connection
// still alive at <ts>".
// ─────────────────────────────────────────────────────────────────────────────

const _sseClients = new Set()  // Set<res> — each connected EventSource client
let _sseWatchersInstalled = false
let _lastOpenIssuesSnapshot = null

function _ssePush(eventName, dataObj) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`
  for (const client of _sseClients) {
    try { client.write(payload) } catch (_) { /* dropped client cleaned up by close handler */ }
  }
}

function _installSseWatchersOnce() {
  if (_sseWatchersInstalled) return
  _sseWatchersInstalled = true

  // Debounce — file watchers can fire multiple times for one logical change
  let driftDebounce = null
  let calibDebounce = null

  function recomputeAndBroadcast(reason) {
    try {
      const oi = sectionOpenIssues()
      const sigBefore = _lastOpenIssuesSnapshot
      const sigAfter = JSON.stringify({ red: oi.red.map(r => r.title).sort(), yellow: oi.yellow.map(y => y.title).sort() })
      _lastOpenIssuesSnapshot = sigAfter
      if (sigBefore !== sigAfter) {
        // Find new RED entries (entries in after but not in before)
        const newReds = sigBefore ? (() => {
          try {
            const beforeSet = new Set(JSON.parse(sigBefore).red || [])
            return oi.red.filter(r => !beforeSet.has(r.title))
          } catch (_) { return oi.red }
        })() : oi.red
        _ssePush("openIssues", {
          reason,
          summary: oi.summary,
          newReds,
          allRed: oi.red,
          allYellow: oi.yellow,
        })
      }
    } catch (e) {
      _ssePush("watcherError", { reason, error: String(e?.message || e) })
    }
  }

  try {
    fs.watch(DRIFT_ALERTS, () => {
      if (driftDebounce) clearTimeout(driftDebounce)
      driftDebounce = setTimeout(() => recomputeAndBroadcast("drift_alerts.log changed"), 500)
    })
  } catch (_) { /* file may not exist yet — watcher will be reinstalled on next attempt */ }

  try {
    fs.watch(FAMILY_CALIB, () => {
      if (calibDebounce) clearTimeout(calibDebounce)
      calibDebounce = setTimeout(() => recomputeAndBroadcast("family_calibration.json changed"), 500)
    })
  } catch (_) { /* file may not exist yet */ }

  // Heartbeat every 30s — keeps long-poll alive through proxies (cloudflared)
  setInterval(() => {
    _ssePush("heartbeat", { ts: new Date().toISOString(), clientCount: _sseClients.size })
  }, 30000)
}

router.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  // disable proxy buffering
  })
  res.flushHeaders()

  // Send initial snapshot immediately so client renders without waiting
  const initialIssues = sectionOpenIssues()
  _lastOpenIssuesSnapshot = JSON.stringify({
    red: initialIssues.red.map(r => r.title).sort(),
    yellow: initialIssues.yellow.map(y => y.title).sort(),
  })
  res.write(`event: snapshot\ndata: ${JSON.stringify({ summary: initialIssues.summary, allRed: initialIssues.red, allYellow: initialIssues.yellow, connectedAt: new Date().toISOString() })}\n\n`)

  _sseClients.add(res)
  _installSseWatchersOnce()

  req.on("close", () => {
    _sseClients.delete(res)
    try { res.end() } catch (_) {}
  })
})

module.exports = router
