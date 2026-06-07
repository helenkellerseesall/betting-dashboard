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
const slateEvidence = require("../pipeline/shared/slateGamesEvidence")  // Phase Status-CLV-Display-Honesty-1A

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
const ML_MODEL_JSON   = path.join(REPO_ROOT, "backend", "ml", "model.json")
// Phase Status-Overhaul-1C (2026-06-03) — ledger path for CLV completed-games view.
// personal_ledger is append-only, retains the day's full pick history even after
// tracked_bets Layer-1-filters tipped games out. Used by sectionClvCaptureToday
// to show "15 of 15 MLB games close-stamped" instead of "6 games loaded, none tipped".
const LEDGER_PATH     = path.join(REPO_ROOT, "backend", "runtime", "tracking", "personal_ledger.json")

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
  // Look at today's NBA + MLB tracked_bets and compute close-stamped %.
  //
  // Phase Status-CLV-Field-Fix-1A (2026-06-02) — FIELD-NAME BUG FIX.
  // Previous code checked `e.closingOdds != null || e.closeStamped === true`
  // but the actual schema (per captureClosingLines.js + leanBet) uses
  // `closeOdds` (no "ing"), `closeObservedAt`, `closeImpliedProb`, `clv`.
  // Result: /status reported fake 0% capture rate for weeks while real
  // capture rate was 40-90% depending on day. Real source: e.closeOdds.
  //
  // Also adds per-sport gamesToday + nextGameAt + nextGameLabel so the FE
  // can distinguish "no games scheduled today" (NBA tonight, Finals Game 1
  // is tomorrow) from "games scheduled, capture failed" — per
  // [[no-games-today-aware]] rule. Both backend and FE consumers can use
  // these to render honest "no games" messaging instead of fake red.
  //
  // Phase Status-Overhaul-1C (2026-06-03) — LEDGER-BACKED COMPLETED-GAMES view.
  // tracked_bets gets Layer-1-filtered as games tip (>1hr past tip drops from
  // the file). So at 00:07 ET Wednesday, Tuesday's 15 MLB games are GONE from
  // tracked_bets even though they were all close-stamped. Operator sees the
  // empty card and thinks something broke. Fix: read personal_ledger (append-
  // only, full history) for the day's true coverage and add gamesPlayedToday +
  // gamesCloseStamped + captureRate per sport. Existing fields stay for FE
  // backwards-compat.
  //
  // Slate-date semantics (etDateKey, 4 AM ET boundary): at 00:07 ET Wed, slate
  // is still 2026-06-02 (Tuesday). Operator's mental "tonight" matches slate.
  // ledger entries store .date = slate-date when pick was generated, so the
  // join is direct: filter ledger.date === etDateKey().
  try {
    const dateKey = etDateKey()
    const sports = ["nba", "mlb"]
    const results = {}
    let totalTipped = 0
    let totalStamped = 0
    let totalGamesToday = 0

    // Phase Status-Overhaul-1C — read ledger once, reuse for all sports.
    // Cost: ~100-200ms on 50K-entry ledger. Acceptable for /status poll cadence.
    // Future optimization: mtime-invalidated cache if /status fetch rate climbs.
    const ledger = safeReadJson(LEDGER_PATH)
    const ledgerEntries = ledger
      ? (Array.isArray(ledger) ? ledger : (ledger.entries || ledger.bets || []))
      : []
    for (const sport of sports) {
      const file = path.join(TRACKING_DIR, `${sport}_tracked_bets_${dateKey}.json`)
      // Phase Status-CLV-Display-Honesty-1A (2026-06-05) — do NOT early-return on a
      // missing/empty tracked_bets file. tracked_bets is written late and Layer-1-
      // filtered to empty as games age, so its absence is a BROKEN "no games" signal
      // (it produced a fake "no games today" on 2026-06-05 — a full slate). Always
      // fall through to the durable ledger loop + the curation-independent snapshot,
      // then classify the slate state (off_day / curation_gap / normal).
      const hasFile = fs.existsSync(file)
      const j = hasFile ? safeReadJson(file) : null
      const arr = Array.isArray(j) ? j : (j?.entries || j?.bets || [])
      const now = Date.now()
      // "tipped" = gameTime <= now (already in progress or finished)
      const tipped = arr.filter(e => {
        const gt = e.gameTime ? Date.parse(e.gameTime) : null
        return gt && gt <= now
      })
      // FIELD-NAME FIX: closeOdds (canonical) instead of closingOdds (never existed)
      const stamped = tipped.filter(e => e.closeOdds != null)
      const rate = tipped.length === 0 ? null : Math.round(stamped.length / tipped.length * 1000) / 10

      // Phase Status-CLV-Field-Fix-1A-fix1 — gamesToday must be CALENDAR-date
      // filtered. Previous version counted ALL distinct eventIds in tracked_bets,
      // which included tomorrow's games (e.g. NBA Finals Game 1 picks loaded
      // today for tomorrow's tipoff would falsely count as "1 NBA game today").
      // Real definition: a game IS today only if its gameTime falls on today's
      // ET calendar date. NBA tonight should be gamesToday=0 (Finals tomorrow).
      const todayCalEt = calendarDateKey()
      const eventIdsToday = new Set()
      // Phase Status-Overhaul-1C-fix2 — also build a per-event gameTime
      // calendar-date map so the ledger filter (below) can drop events whose
      // games are on a different ET calendar day than the slate-date. Without
      // this, at 02:27 ET Wed (slate = 2026-06-02), Wed-future games already
      // pre-picked under Tuesday's slate were counted in the CLV recap, giving
      // operator 21 instead of the meaningful 15.
      const eventIdToGameCalEt = new Map()
      // Phase Status-Overhaul-1C-fix4 (2026-06-03) — track which events on
      // CALENDAR-today are tipped + which have any close-stamped pick. These
      // power the dual-view rendering when slate-date != calendar-date (the
      // 12:01-3:59 AM ET window). Operator can see Tuesday's slate recap AND
      // today's (Wed's) calendar coverage in the same card.
      const eventTippedCalendarToday = new Set()
      const eventStampedCalendarToday = new Set()
      let nextGameAt = null
      let nextGameLabel = null
      for (const e of arr) {
        if (!e.gameTime) continue
        const gt = Date.parse(e.gameTime)
        if (!Number.isFinite(gt)) continue
        const gameDateEt = calendarDateForTimestamp(gt)
        if (e.eventId) eventIdToGameCalEt.set(e.eventId, gameDateEt)
        // Count toward gamesToday ONLY if game's ET calendar date == today
        if (gameDateEt === todayCalEt && e.eventId) {
          eventIdsToday.add(e.eventId)
          // Phase 1C-fix4 — also track tipped + stamped event sets for the
          // calendar-today view.
          if (gt <= now) eventTippedCalendarToday.add(e.eventId)
          if (e.closeOdds != null) eventStampedCalendarToday.add(e.eventId)
        }
        // Track earliest FUTURE gameTime + matchup for "next game" display
        // (independent of whether it's today — could be tomorrow's Finals)
        if (gt > now && (nextGameAt == null || gt < nextGameAt)) {
          nextGameAt = gt
          nextGameLabel = e.matchup || (e.awayTeam && e.homeTeam ? `${e.awayTeam} @ ${e.homeTeam}` : null)
        }
      }
      const gamesToday = eventIdsToday.size
      totalGamesToday += gamesToday
      // Phase 1C-fix4 — calendar-day view aggregates for this sport.
      const gamesCalendarToday        = gamesToday                           // alias for clarity
      const gamesCalendarTipped       = eventTippedCalendarToday.size
      const gamesCalendarStamped      = eventStampedCalendarToday.size
      const captureRateCalendar = gamesCalendarTipped > 0
        ? Math.round((gamesCalendarStamped / gamesCalendarTipped) * 1000) / 10
        : null

      // Phase Status-Overhaul-1C — ledger-backed completed-games view.
      // Source: personal_ledger entries with sport=X AND date=slateDate.
      // Distinct eventIds = games picked for today's slate; events with at
      // least 1 pick that has clvSnapshot.close.odds populated = stamped.
      // captureRate = stamped/played. This view survives Layer-1 drop so
      // operator sees yesterday's full capture even after games age out.
      //
      // Phase Status-Overhaul-1C-fix2 (2026-06-03) — filter out future-day
      // games pre-picked under today's slate. The slate engine sometimes
      // generates picks for tomorrow's games during late-night fires (e.g.
      // at 11 PM Tuesday, picks for some Wed games land under Tue's slate-
      // date). Those entries inflate gamesPlayedToday with games that
      // haven't tipped yet → fake-low captureRate. Filter rule: if we KNOW
      // the gameTime calendar (event is in slate-date tracked_bets file)
      // AND it's NOT on slate-date calendar → SKIP. If we DON'T know the
      // gameTime (event Layer-1-dropped from tracked_bets — i.e. already
      // played and aged out) → INCLUDE (assume slate-date past game).
      let gamesPlayedToday = 0
      let gamesCloseStamped = 0
      // Phase Status-CLV-Display-Honesty-1A (2026-06-05) — gamesFinal = games
      // GRADED (ledger result != "pending"), slate-scoped. Distinct from
      // gamesCloseStamped, which is the closing LINE captured at tipoff (CLV
      // input, pre-final). The card previously showed capture as if it were
      // completion ("8/9 close-stamped" when only 3/9 had finished).
      let gamesFinal = 0
      let captureRate = null
      let gamesFutureExcluded = 0
      if (ledgerEntries.length > 0) {
        const events = new Set()
        const eventsCloseStamped = new Set()
        const eventsFinal = new Set()
        const futureExcluded = new Set()
        for (const e of ledgerEntries) {
          if (String(e.sport || "").toLowerCase() !== sport) continue
          if (e.date !== dateKey) continue
          if (e.eventId == null) continue
          // Phase 1C-fix2 — exclude future-day pre-picked events
          const gameCalEt = eventIdToGameCalEt.get(e.eventId)
          if (gameCalEt != null && gameCalEt !== dateKey) {
            futureExcluded.add(e.eventId)
            continue
          }
          events.add(e.eventId)
          if (e.clvSnapshot && e.clvSnapshot.close && e.clvSnapshot.close.odds != null) {
            eventsCloseStamped.add(e.eventId)
          }
          // Phase Status-CLV-Display-Honesty-1A — graded/final signal, scoped by
          // the same `e.date === dateKey` filter above (= today's slate only).
          // result domain is pending|win|loss (allow push/void). settledAt is
          // UNRELIABLE (mostly null even when graded) so we key on result only.
          const res = String(e.result || "").toLowerCase()
          if (res && res !== "pending") eventsFinal.add(e.eventId)
        }
        gamesPlayedToday = events.size
        gamesCloseStamped = eventsCloseStamped.size
        gamesFinal = eventsFinal.size
        gamesFutureExcluded = futureExcluded.size
        captureRate = events.size > 0
          ? Math.round((eventsCloseStamped.size / events.size) * 1000) / 10
          : null
      }

      // Phase Status-CLV-Display-Honesty-1A — three-state classification from a UNION
      // of evidence. gamesScheduledLive is the curation-INDEPENDENT snapshot signal
      // (rolls forward, so 0 for a past/rolled slate — that is why the ledger union
      // matters). trackedBestEntries is the durable curated-picks signal. state ∈
      // { off_day, curation_gap, normal } via the shared classifier (same one the
      // verifySlateGamesControl gate tests every commit).
      const _snap = slateEvidence.countSnapshotEventsForSlate(sport, dateKey)
      const gamesScheduledLive   = _snap.total
      const gamesScheduledTipped = _snap.tipped
      const trackedBestEntries = slateEvidence.countTrackedBestEntries(sport, dateKey)
      const state = slateEvidence.classifySlateState({
        snapshotEvents:     gamesScheduledLive,
        ledgerEvents:       gamesPlayedToday,
        trackedBestEntries,
      })

      results[sport] = {
        tipped: tipped.length,
        stamped: stamped.length,
        rate,
        hasFile,
        state,                               // off_day | curation_gap | normal
        gamesScheduledLive,                  // curation-independent snapshot count for slate-date
        gamesScheduledTipped,                // subset already tipped (gates the curation-gap alert)
        trackedBestEntries,                  // durable curated-picks count
        gamesToday,
        nextGameAt: nextGameAt ? new Date(nextGameAt).toISOString() : null,
        nextGameLabel,
        // Phase Status-Overhaul-1C — new ledger-backed fields. Use these for
        // honest day-coverage display; existing tipped/stamped/rate kept for
        // FE backwards-compat. captureRate is the operator-meaningful number.
        // Phase 1C-fix2 — gamesFutureExcluded: count of events skipped because
        // their gameTime is on a different ET calendar day than slate-date
        // (e.g. Wed games pre-picked under Tue's slate). Surface for transparency.
        gamesPlayedToday,
        gamesOnSlate: gamesPlayedToday,   // honest denominator label for the FE (games picked on slate)
        gamesCloseStamped,
        gamesFinal,                        // graded count (result != pending), slate-scoped
        captureRate,
        gamesFutureExcluded,
        // Phase Status-Overhaul-1C-fix4 (2026-06-03) — CALENDAR-DAY view fields
        // (operator's wall-clock "today"). When slate-date != calendar-date
        // (between 12:01 and 4:00 AM ET), the FE renders a dual view: slate
        // recap above + calendar preview below. When slate == calendar, FE
        // merges to single view.
        //   gamesCalendarToday    = distinct events in tracked_bets with
        //                           gameTime on today's ET calendar
        //   gamesCalendarTipped   = subset whose gameTime <= now (already tipped)
        //   gamesCalendarStamped  = subset with at least 1 pick that has closeOdds
        //   captureRateCalendar   = stamped/tipped (null if tipped == 0)
        gamesCalendarToday,
        gamesCalendarTipped,
        gamesCalendarStamped,
        captureRateCalendar,
      }
      totalTipped += tipped.length
      totalStamped += stamped.length
    }
    return {
      ok: true,
      dateKey,
      // Phase Status-Overhaul-1C-fix4 — surface BOTH slate-date and calendar-date
      // so FE knows when to render the dual view (slate != calendar = 12:01-3:59 AM).
      slateDateKey:    dateKey,
      calendarDateKey: calendarDateKey(),
      totalTipped,
      totalStamped,
      totalGamesToday,
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
    //
    // Phase Status-OpenIssues-CompleteCoverage-1A-fix1 (2026-06-02) — DUAL SOURCE.
    // Phase #48 installed LaunchAgent versions of the 3 nightlies (populator-chain,
    // grading-nightly, audit-nightly). Their wrappers write to .scratch/autopilot.log
    // with markers like "AUTOPILOT <name> starting|OK|FAILED|finished" — NOT to
    // scheduler.log. Pre-fix1: scheduler-log-only check would fail-RED every day
    // even if LaunchAgents fired successfully. Now: EITHER source firing counts
    // as fired/completed. Source field on output identifies which path triggered.
    const dateKey = calendarDateKey()
    const schedTxt    = safeReadText(SCHEDULER_LOG)
    const autopilotTxt = safeReadText(path.join(REPO_ROOT, ".scratch", "autopilot.log"))

    if (!schedTxt && !autopilotTxt) {
      return { ok: false, error: "neither scheduler.log nor autopilot.log readable" }
    }
    const schedLines    = schedTxt ? schedTxt.split("\n").filter(l => l.includes(dateKey)) : []
    const autopilotLines = autopilotTxt ? autopilotTxt.split("\n").filter(l => l.includes(dateKey)) : []

    // Helper that checks BOTH log sources. EITHER firing = fired/completed.
    const findEvent = (schedStart, schedEnd, agentStart, agentEnd) => {
      const schedStartLine = schedLines.find(l => l.includes(schedStart))
      const schedEndLine   = schedLines.find(l => l.includes(schedEnd))
      const agentStartLine = autopilotLines.find(l => l.includes(agentStart))
      const agentEndLine   = autopilotLines.find(l => l.includes(agentEnd))
      const startedLine = schedStartLine || agentStartLine || null
      const endedLine   = schedEndLine   || agentEndLine   || null
      return {
        startedLine,
        endedLine,
        fired: !!startedLine,
        completed: !!endedLine,
        source: schedStartLine ? "scheduler.log" : (agentStartLine ? "autopilot.log (LaunchAgent)" : null),
      }
    }

    // populator chain — scheduler.log fires 5 named populators; autopilot.log fires
    // a single "AUTOPILOT populator-chain starting/finished" pair from the wrapper.
    // EITHER signal = chain fired.
    const popStarts = schedLines.filter(l =>
      l.includes("populateMlbBatterStats starting") ||
      l.includes("populateMlbBatterGameLogs starting") ||
      l.includes("populateMlbPitcherGameLogs starting") ||
      l.includes("deriveNbaDvP starting") ||
      l.includes("populateNbaTeamStats starting")
    )
    const popOks = schedLines.filter(l =>
      l.includes("populateMlbBatterStats OK") ||
      l.includes("populateMlbBatterGameLogs OK") ||
      l.includes("populateMlbPitcherGameLogs OK") ||
      l.includes("deriveNbaDvP OK") ||
      l.includes("populateNbaTeamStats OK")
    )
    const agentPopStart  = autopilotLines.find(l => l.includes("AUTOPILOT populator-chain starting"))
    const agentPopFinish = autopilotLines.find(l => l.includes("AUTOPILOT populator-chain finished"))
    const populatorChain = {
      startedLine: popStarts[0] || agentPopStart || null,
      endedLine: popOks[popOks.length - 1] || agentPopFinish || null,
      fired: popStarts.length > 0 || !!agentPopStart,
      completed: popOks.length >= 5 || !!agentPopFinish,
      okCount: popOks.length,
      source: popStarts.length > 0 ? "scheduler.log" : (agentPopStart ? "autopilot.log (LaunchAgent)" : null),
    }
    return {
      ok: true,
      dateKey,
      gradingBackfillAll: findEvent(
        "grading:backfill-all starting", "grading:backfill-all OK",
        "AUTOPILOT grading-nightly starting", "AUTOPILOT grading-nightly OK"
      ),
      auditNightly: findEvent(
        "audit:nightly starting", "audit:nightly OK",
        "AUTOPILOT audit-nightly starting", "AUTOPILOT audit-nightly OK"
      ),
      populatorChain,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

// Phase Wave-1-A1 (2026-06-04) — surface mlScorer staleness.
// scorer.js loads model.json once at boot and uses its coefficients to score
// every prop. If model.json is stale (training data drifts from current prop
// distribution), the scorer feeds outdated signal into 10 cognition modules
// (buildSlipAi, buildFeaturedPlays, survivabilityGate, etc.). The calibrationDampener
// provides per-family backstop but doesn't fix the underlying ranking shape.
// This section makes staleness VISIBLE so operator can decide retrain-or-disable.
//
// Source: file mtime of backend/ml/model.json (model.json itself has no
// trainingDate field; mtime is the only proxy).
function sectionMlScorer() {
  try {
    if (!fs.existsSync(ML_MODEL_JSON)) {
      return { ok: true, modelExists: false, note: "no model.json — scorer is disabled" }
    }
    const stat = fs.statSync(ML_MODEL_JSON)
    const trainingDateISO = stat.mtime.toISOString()
    const ageMs = Date.now() - stat.mtime.getTime()
    const ageDays = Math.round(ageMs / (24 * 60 * 60 * 1000))
    let featureCount = null
    let modelType = null
    try {
      const j = JSON.parse(fs.readFileSync(ML_MODEL_JSON, "utf8"))
      featureCount = Array.isArray(j.features) ? j.features.length : null
      modelType = j.type || null
    } catch (_) {
      // model.json unreadable — still report mtime
    }
    const STALE_THRESHOLD_DAYS = 30
    const isStale = ageDays > STALE_THRESHOLD_DAYS
    return {
      ok: true,
      modelExists: true,
      modelPath: "backend/ml/model.json",
      trainingDateISO,
      ageDays,
      featureCount,
      modelType,
      isStale,
      staleThresholdDays: STALE_THRESHOLD_DAYS,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

// Phase Wave-1-A3b (2026-06-04) — surface schema-golden drift for the 5 core
// JSON shapes (personal_ledger, tracked_bets, tracked_best, family_calibration,
// lessons). WARN-ONLY mirror: reports drift, NEVER blocks anything. Cached by a
// source-file mtime+size signature so a fresh write shows up immediately, but the
// 65 MB ledger parse doesn't run on every /status poll. Anti-fabrication: a
// missing/corrupt file is its own finding, never defaulted to clean.
let _schemaGoldenCache = { sig: null, val: null }
function _phraseFinding(shape, v) {
  switch (v.severity) {
    case "file_missing": return shape + " file not found"
    case "parse_fail":
    case "read_fail": return shape + " file unreadable/corrupt"
    case "root_drift": return shape + " wrong root type"
    case "missing_key": return shape + " missing " + v.where
    case "type_drift": return shape + " " + v.where + " wrong type"
    default: return shape + " " + v.severity + " " + v.where
  }
}
function _schemaGoldenHeadline(val) {
  if (val.status === "error") return "validator error: " + (val.error || "unknown")
  if (val.status === "clean") return val.filesChecked + "/" + val.filesChecked + " files clean"
  const more = val.totalFindings > 1 ? " (+" + (val.totalFindings - 1) + " more)" : ""
  return (val.topFinding || "schema drift") + more
}
function sectionSchemaGolden() {
  try {
    const validator = require("../pipeline/shared/schemaGoldenValidator")
    const sig = validator.getSourceSignature()
    if (_schemaGoldenCache.val && _schemaGoldenCache.sig === sig) {
      return Object.assign({}, _schemaGoldenCache.val, { cached: true })
    }
    const full = validator.runSchemaGoldenCheck()
    const files = []
    let topFinding = null
    for (const r of full.results) {
      for (const t of r.targets) {
        const findings = t.violations.map((v) => _phraseFinding(r.name, v))
        if (!topFinding && findings.length) topFinding = findings[0]
        files.push({ shape: r.name, file: t.file, ok: t.violations.length === 0, findings })
      }
    }
    const val = {
      ok: full.summary.status !== "error",
      status: full.summary.status, // clean | drift | error
      checkedAt: full.generatedAt,
      filesChecked: full.summary.filesChecked || 0,
      driftFiles: full.summary.driftFiles || 0,
      totalFindings: full.summary.totalViolations || 0,
      topFinding,
      files,
    }
    if (full.summary.status === "error") val.error = full.summary.message
    val.headline = _schemaGoldenHeadline(val)
    _schemaGoldenCache = { sig, val }
    return Object.assign({}, val, { cached: false })
  } catch (e) {
    const msg = String(e?.message || e)
    return { ok: false, status: "error", error: msg, headline: "validator error: " + msg }
  }
}

// Phase Calibration-LineAware-1A (5.3 surface) — live kill-switch state for /status.
// ON/OFF is read from the dampener module's exported LINEAWARE_ENABLED — the SINGLE
// authority (same boolean the running dampener uses; no parallel re-derivation of the
// flag logic, per Law 1). The raw env only labels default-vs-explicit. NOTE: the
// familyCalibration table itself comes from family_calibration.json (a sysAudit source),
// so this field is the ONLY thing on /status that reflects CALIB_LINEAWARE.
function readLineAwareState() {
  try {
    const { _constants } = require(path.join(REPO_ROOT, "backend", "pipeline", "shared", "calibrationDampener"))
    const enabled = _constants.LINEAWARE_ENABLED === true
    const raw = process.env.CALIB_LINEAWARE
    const state = !enabled ? "OFF (emergency revert)"
                : (raw == null ? "ON (default)" : "ON (explicit)")
    return { enabled, state, flag: (raw == null ? null : String(raw)) }
  } catch (e) {
    return { enabled: null, state: "unknown", error: String(e?.message || e) }
  }
}

function sectionFamilyCalibration() {
  const lineAware = readLineAwareState()
  try {
    const j = safeReadJson(FAMILY_CALIB)
    if (!j) return { ok: false, error: "family_calibration.json not found or unreadable", lineAware }
    return {
      ok: true,
      generatedAt: j.generatedAt,
      windowDays: j.windowDays,
      minSample: j.minSample,
      sports: j.sports,
      lineAware,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e), lineAware }
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

  // Phase Status-OpenIssues-CompleteCoverage-1A (2026-06-02) — Sources 5/6/7.
  //
  // Previously, sectionOpenIssues only checked 4 sources (calibration, drift,
  // git, uptime). Real failures in slate fires, CLV capture, and nightly
  // autopilots were visible in their own /status cards but NEVER drove the
  // live dot. Result: dot stayed green during the 2026-06-02 20:00 ET slate
  // failure + the all-day CLV capture gap (later traced to a field-name bug)
  // + today's missed nightly autopilots from the overnight scheduler crash.
  //
  // Adds 3 sources, all wired honestly per [[status-must-be-real]] +
  // [[no-games-today-aware]]:
  //   Source 5 slate_fires        — slate:nba/slate:mlb FAILED today (not recovered = RED, recovered = informational YELLOW)
  //   Source 6 clv_capture        — rate < 30% RED, < 70% YELLOW, no-games-aware skip
  //   Source 7 autopilot_fires    — past scheduled time AND fired:false = RED, with 30min grace

  // ── Source 5: slateFiresToday — slate fire failures (with recovery awareness) ──
  try {
    const sft = sectionSlateFiresToday()
    if (sft && sft.ok) {
      const parseLineTs = (line) => {
        if (!line) return null
        const m = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ET\]/)
        if (!m) return null
        // ET fixed offset for ordering (DST doesn't matter for relative comparison)
        return Date.parse(m[1] + "T" + m[2] + "-04:00")
      }
      for (const [sport, key] of [["nba", "slateNba"], ["mlb", "slateMlb"]]) {
        const fires = sft[key]
        if (!fires) continue
        const failTs = parseLineTs(fires.lastFailed)
        const okTs   = parseLineTs(fires.lastOk)
        if (failTs && (!okTs || failTs > okTs)) {
          // Current failure — most recent slate event for this sport is a FAILED
          red.push({
            source: "slate_fires",
            category: "infra",
            title: `${sport.toUpperCase()} slate fire FAILED today, not recovered`,
            detail: fires.lastFailed.trim(),
          })
        } else if (failTs && okTs && okTs > failTs) {
          // Recovered — show as informational yellow (operator wants to know it happened)
          const failTime = (fires.lastFailed.match(/\[([\d\-:\s]+ET)\]/) || [])[1] || "?"
          const okTime   = (fires.lastOk.match(/\[([\d\-:\s]+ET)\]/) || [])[1] || "?"
          yellow.push({
            source: "slate_fires",
            category: "infra",
            title: `${sport.toUpperCase()} slate had transient failure earlier today (recovered)`,
            detail: `Failed at ${failTime}, recovered at ${okTime} — investigate if pattern repeats.`,
          })
        }
      }
    } else {
      yellow.push({ source: "slate_fires", category: "infra", title: "Slate fires status unavailable", detail: sft?.error || "Could not read slate fires section" })
    }
  } catch (e) {
    yellow.push({ source: "slate_fires", category: "infra", title: "Slate fires read error", detail: String(e?.message || e) })
  }

  // ── Source 6: clvCaptureToday — close-stamp capture rate, no-games-aware ──
  try {
    const clv = sectionClvCaptureToday()
    if (clv && clv.ok) {
      for (const sport of ["nba", "mlb"]) {
        const s = clv.perSport?.[sport]
        if (!s) continue
        // Phase Status-CLV-Display-Honesty-1A — curation gap = games scheduled (the
        // curation-independent snapshot shows games) but no curated picks captured.
        // YELLOW (warning): the bettor should know picks are missing, but it is not an
        // outage — a total capture/curation failure stays RED on the autopilot-fires +
        // LaunchAgent surfaces. Fires regardless of hasFile (tracked_bets may be absent).
        if (s.state === "curation_gap" && (s.gamesScheduledTipped || 0) > 0) {
          yellow.push({
            source: "clv_capture",
            category: "infra",
            title: `${sport.toUpperCase()} curation gap — ${s.gamesScheduledLive} games scheduled, no curated picks captured`,
            detail: `The odds snapshot shows ${s.gamesScheduledLive} ${sport.toUpperCase()} game(s) on this slate (${s.gamesScheduledTipped} already tipped) but tracked_best + ledger are both empty. Curation likely did not produce picks — check the slate:${sport} autopilot. Warning class, not an outage.`,
          })
        }
        if (!s.hasFile) continue
        // No-games-aware: skip if no games today OR no picks tipped yet
        if (s.gamesToday === 0) continue
        if (s.tipped === 0) continue
        const rate = Number(s.rate)
        if (!Number.isFinite(rate)) continue
        if (rate < 30) {
          red.push({
            source: "clv_capture",
            category: "infra",
            title: `${sport.toUpperCase()} CLV capture broken — only ${rate}% of tipped picks have a closing line captured`,
            detail: `${s.stamped} of ${s.tipped} tipped ${sport.toUpperCase()} picks have a closing line captured (threshold 30%). This is CLV-capture health, not game grading. Capture loop may be missing snapshot matches or backend was down through tipoff windows.`,
          })
        } else if (rate < 70) {
          yellow.push({
            source: "clv_capture",
            category: "infra",
            title: `${sport.toUpperCase()} CLV capture degraded — ${rate}% closing-line capture rate`,
            detail: `${s.stamped} of ${s.tipped} tipped ${sport.toUpperCase()} picks have a closing line captured (healthy ≥70%). This is CLV-capture health, not game grading. Could indicate market-key drift between open and close, or snapshot stale at close window.`,
          })
        }
      }
    } else {
      yellow.push({ source: "clv_capture", category: "infra", title: "CLV capture status unavailable", detail: clv?.error || "Could not read tracked_bets files" })
    }
  } catch (e) {
    yellow.push({ source: "clv_capture", category: "infra", title: "CLV capture read error", detail: String(e?.message || e) })
  }

  // ── Source 7: autopilotFiresToday — nightly autopilots missed schedule ──
  try {
    const auto = sectionAutopilotFiresToday()
    if (auto && auto.ok) {
      // Get current ET hour:minute for "is it past the scheduled fire time?"
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" })
      const parts = fmt.formatToParts(new Date()).reduce((acc, p) => { if (p.type !== "literal") acc[p.type] = Number(p.value); return acc }, {})
      const nowMinutes = (parts.hour || 0) * 60 + (parts.minute || 0)
      const checks = [
        { key: "populatorChain",     name: "populator-chain", h: 3,  m: 5,  scheduledStr: "3:05 AM ET" },
        { key: "gradingBackfillAll", name: "grading-nightly", h: 4,  m: 0,  scheduledStr: "4:00 AM ET" },
        { key: "auditNightly",       name: "audit-nightly",   h: 5,  m: 0,  scheduledStr: "5:00 AM ET" },
      ]
      // Grace window: don't flag until 30 min past scheduled time (gives autopilot
      // time to actually execute before declaring missed).
      const grace = 30
      for (const c of checks) {
        const fired = auto[c.key]?.fired === true
        const completed = auto[c.key]?.completed === true
        const scheduledMin = c.h * 60 + c.m
        if (nowMinutes >= scheduledMin + grace && !fired) {
          red.push({
            source: "autopilot_fires",
            category: "infra",
            title: `${c.name} did NOT fire today (scheduled ${c.scheduledStr})`,
            detail: `Current ET time is past scheduled fire + ${grace}min grace, no "starting" log line found in scheduler.log. The Phase #48 LaunchAgent backup (~/Library/LaunchAgents/com.motel666.${c.name}.plist) fires the same job; check it loaded with launchctl list | grep com.motel666.${c.name}.`,
          })
        } else if (nowMinutes >= scheduledMin + grace && fired && !completed) {
          yellow.push({
            source: "autopilot_fires",
            category: "infra",
            title: `${c.name} started today but didn't complete`,
            detail: (auto[c.key]?.startedLine || "started line missing").trim(),
          })
        }
      }
    } else {
      yellow.push({ source: "autopilot_fires", category: "infra", title: "Autopilot fires status unavailable", detail: auto?.error || "Could not read scheduler.log" })
    }
  } catch (e) {
    yellow.push({ source: "autopilot_fires", category: "infra", title: "Autopilot fires read error", detail: String(e?.message || e) })
  }

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
      sourcesChecked: ["family_calibration", "drift_alerts", "git", "backend.uptime", "slate_fires", "clv_capture", "autopilot_fires"],
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
  out.mlScorer          = sectionMlScorer()
  out.schemaGolden      = sectionSchemaGolden()
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
  out.mlScorer          = sectionMlScorer()
    out.schemaGolden      = sectionSchemaGolden()
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
// Phase Calibration-LineAware-1A (5.3 surface) — attached for diagnostics/probes (router
// stays the default export; attaching properties does not change app.use behavior).
module.exports.sectionFamilyCalibration = sectionFamilyCalibration
module.exports._readLineAwareState = readLineAwareState
