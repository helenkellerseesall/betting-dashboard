"use strict"

/**
 * apiCallLogger.js — Phase Market-Ecology-1A (OBS-3) (2026-05-14)
 *
 * Append-only JSONL logger for Odds-API (and similar external-market) calls.
 * Pure-local. NEVER makes a network call. NEVER throws — every error is
 * swallowed silently so a logging hiccup cannot break the actual fetch path.
 *
 * Schema (one entry per line):
 *   { ts, sport, endpoint, eventId?, status, durationMs, httpStatus?, error? }
 *     ts          ISO timestamp at completion of the call.
 *     sport       "nba" | "mlb" | "unknown".
 *     endpoint    Short string (e.g. "odds-api/events/odds/base" or "odds-api/events/odds/extra").
 *     eventId     Optional — Odds-API event id when applicable.
 *     status      "ok" | "error".
 *     durationMs  Wall-clock duration of the network call.
 *     httpStatus  Optional — HTTP status code on success.
 *     error       Optional — short error code/message on failure.
 *
 * On disk:
 *   runtime/market/api_call_log.jsonl  — append-only, one entry per line.
 *
 * Retention: there is NO retention policy enforced here. The marketStatus.js
 * inspector (OBS-1) reads the trailing N entries and reports rolling windows.
 * If the file grows beyond a soft cap (default 50 MB) the logger will pause
 * appends to avoid runaway disk usage — operator can prune manually.
 *
 * Phase Market-Ecology-1A doctrine: observability first. This module surfaces
 * existing API behavior; it does NOT introduce polling, retry, rate-limiting,
 * or any new network calls.
 */

const fs   = require("fs")
const path = require("path")

// ODDS_API_LOG_DIR override exists for the hermetic fixture (verifyOddsUsage)
// — production never sets it.
const LOG_DIR  = process.env.ODDS_API_LOG_DIR || path.join(__dirname, "..", "..", "runtime", "market")
const LOG_FILE = path.join(LOG_DIR, "api_call_log.jsonl")
const SOFT_CAP_BYTES = 50 * 1024 * 1024  // 50 MB safety pause threshold

let _pausedReported = false

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch (_) { /* swallow */ }
}

/**
 * Append a single API-call entry. Never throws. Returns void.
 *
 * @param {object} meta
 * @param {string} meta.sport       "nba" | "mlb" | "unknown"
 * @param {string} meta.endpoint    Short identifier
 * @param {string} [meta.eventId]   Optional event id
 * @param {string} meta.status      "ok" | "error"
 * @param {number} meta.durationMs  Wall-clock duration
 * @param {number} [meta.httpStatus] HTTP status on success
 * @param {string} [meta.error]     Short error string on failure
 */
function logApiCall(meta) {
  if (!meta || typeof meta !== "object") return
  try {
    ensureLogDir()

    // Soft-cap guard — pause appends if log file exceeds threshold.
    try {
      const stat = fs.statSync(LOG_FILE)
      if (stat && stat.size > SOFT_CAP_BYTES) {
        if (!_pausedReported) {
          console.warn(`[apiCallLogger] log file exceeded soft cap (${(stat.size / 1024 / 1024).toFixed(1)} MB); pausing appends. Prune ${LOG_FILE} to resume.`)
          _pausedReported = true
        }
        return
      }
    } catch (_) { /* file may not exist yet — fine */ }

    const entry = {
      ts:         new Date().toISOString(),
      sport:      String(meta.sport || "unknown"),
      endpoint:   String(meta.endpoint || ""),
      ...(meta.eventId    ? { eventId: String(meta.eventId) } : {}),
      status:     meta.status === "error" ? "error" : "ok",
      durationMs: Number.isFinite(meta.durationMs) ? meta.durationMs : null,
      ...(Number.isFinite(meta.httpStatus) ? { httpStatus: Number(meta.httpStatus) } : {}),
      // 2026-08-11 ODDS-QUOTA LEDGER (GO on ASK 63f24e4): the vendor returns
      // spend truth on every response; nothing recorded it while the operator
      // paid $60/mo blind. Optional fields — absent on non-quota entries.
      ...(Number.isFinite(Number(meta.used)) ? { used: Number(meta.used) } : {}),
      ...(Number.isFinite(Number(meta.remaining)) ? { remaining: Number(meta.remaining) } : {}),
      ...(meta.caller     ? { caller: String(meta.caller) } : {}),
      ...(meta.error      ? { error: String(meta.error).slice(0, 220) } : {}),
    }
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n")
  } catch (_) {
    // Silent — never let logging break the caller.
  }
}

/**
 * Thin wrapper that times an async function (typically axios.get) and emits a
 * single logApiCall entry on both success and failure. Re-throws any error so
 * caller behavior is unchanged.
 *
 * Usage:
 *   const res = await logApiCallAsync({ sport: 'nba', endpoint: 'odds-api/events/odds/base', eventId },
 *                                     () => axios.get(url, opts))
 */
async function logApiCallAsync(meta, asyncFn) {
  const t0 = Date.now()
  try {
    const res = await asyncFn()
    logApiCall({
      ...meta,
      status:     "ok",
      durationMs: Date.now() - t0,
      httpStatus: Number.isFinite(res?.status) ? res.status : undefined,
      ...quotaFromHeaders(res?.headers),
    })
    return res
  } catch (err) {
    logApiCall({
      ...meta,
      status:     "error",
      durationMs: Date.now() - t0,
      httpStatus: Number.isFinite(err?.response?.status) ? err.response.status : undefined,
      error:      String(err?.code || err?.message || err),
    })
    throw err
  }
}

/**
 * Read the trailing N entries from the log file. Returns a sorted-newest-first
 * array. Used by marketStatus.js. Pure read; safe to call concurrently.
 */
function readRecentApiCalls(maxEntries = 2000) {
  let raw = ""
  try { raw = fs.readFileSync(LOG_FILE, "utf8") } catch (_) { return [] }
  if (!raw) return []
  const lines = raw.split("\n").filter(Boolean)
  const start = lines.length > maxEntries ? lines.length - maxEntries : 0
  const out = []
  for (let i = start; i < lines.length; i++) {
    try { out.push(JSON.parse(lines[i])) } catch (_) { /* skip malformed line */ }
  }
  return out.reverse()
}

/**
 * Roll up an array of api-call entries into per-sport / per-status / per-endpoint
 * counters. Returns counters plus durationMs percentile estimates.
 */
function summarizeApiCalls(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      total: 0, ok: 0, error: 0,
      bySport: {}, byEndpoint: {}, byHour: {},
      durationMs: { p50: null, p90: null, p99: null },
      windowStart: null, windowEnd: null,
    }
  }
  const summary = {
    total: entries.length, ok: 0, error: 0,
    bySport: {}, byEndpoint: {}, byHour: {},
    durationMs: { p50: null, p90: null, p99: null },
    windowStart: null, windowEnd: null,
  }
  const durations = []
  for (const e of entries) {
    if (e.status === "ok") summary.ok++
    else summary.error++
    const sport = e.sport || "unknown"
    summary.bySport[sport] = (summary.bySport[sport] || 0) + 1
    const ep = e.endpoint || "unknown"
    summary.byEndpoint[ep] = (summary.byEndpoint[ep] || 0) + 1
    if (e.ts) {
      const hour = String(e.ts).slice(0, 13)  // "YYYY-MM-DDTHH"
      summary.byHour[hour] = (summary.byHour[hour] || 0) + 1
    }
    if (Number.isFinite(e.durationMs)) durations.push(e.durationMs)
  }
  if (durations.length) {
    durations.sort((a, b) => a - b)
    const pct = (p) => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))]
    summary.durationMs = { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99) }
  }
  const stamps = entries.map((e) => e.ts).filter(Boolean).sort()
  summary.windowStart = stamps[0] || null
  summary.windowEnd   = stamps[stamps.length - 1] || null
  return summary
}

/**
 * 2026-08-11 ODDS-QUOTA LEDGER (GO on ASK 63f24e4).
 * quotaFromHeaders — extract x-requests-used / x-requests-remaining from an
 * axios headers object (plain, lower-cased keys) OR a fetch Headers instance.
 * Returns {} when absent/unparseable — never throws, never guesses.
 */
function quotaFromHeaders(headers) {
  try {
    if (!headers) return {}
    const get = (k) => (typeof headers.get === "function" ? headers.get(k) : headers[k])
    const used = Number(get("x-requests-used"))
    const remaining = Number(get("x-requests-remaining"))
    const out = {}
    if (Number.isFinite(used)) out.used = used
    if (Number.isFinite(remaining)) out.remaining = remaining
    return out
  } catch (_) { return {} }
}

/**
 * logOddsUsage — one-line quota logging for call sites that hold a raw
 * response (the logApiCallAsync wrapper captures the same fields itself).
 * Fail-open and fire-and-forget: must never break or slow an odds fetch.
 */
function logOddsUsage(headers, meta) {
  try {
    logApiCall({ ...(meta || {}), status: (meta && meta.status) || "ok", ...quotaFromHeaders(headers) })
  } catch (_) { /* never */ }
}

/**
 * readTailLines — read only the last N tail bytes of the log (default 2 MB), drop
 * the first partial line. The rollup must never re-read a 50 MB file
 * in-request (that is the exact per-request-whale disease the 8/11 perf
 * report measured elsewhere).
 */
function readTailLines(file, bytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file)
    const start = Math.max(0, stat.size - bytes)
    const fd = fs.openSync(file, "r")
    const buf = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const lines = buf.toString("utf8").split("\n").filter(Boolean)
    if (start > 0 && lines.length) lines.shift() // first line may be partial
    return lines
  } catch (_) { return [] }
}

/**
 * readOddsUsageRollup — daily+weekly quota rollup for /status.
 * Days are ET (the slate timezone). calls = every logged odds-api entry counted
 * that day; remaining = the newest quota reading. Projection is a
 * straight trailing-7-ET-day average × 30 — a ruler, not a model.
 */
function readOddsUsageRollup({ tailBytes = 2 * 1024 * 1024 } = {}) {
  const lines = readTailLines(LOG_FILE, tailBytes)
  if (!lines.length) return { ok: false, reason: "no api_call_log entries" }
  const etDay = (ts) => { try { return new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) } catch (_) { return null } }
  const byDay = new Map()
  let latest = null
  for (const ln of lines) {
    let e; try { e = JSON.parse(ln) } catch (_) { continue }
    const d = etDay(e.ts)
    if (!d) continue
    if (!byDay.has(d)) byDay.set(d, { date: d, calls: 0, lastRemaining: null })
    const rec = byDay.get(d)
    rec.calls++
    if (Number.isFinite(e.remaining)) { rec.lastRemaining = e.remaining; latest = { ts: e.ts, used: Number.isFinite(e.used) ? e.used : null, remaining: e.remaining } }
  }
  const days = Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? -1 : 1))
  const today = etDay(new Date().toISOString())
  const trailing7 = days.filter((d) => d.date !== today).slice(-7)
  const avg7 = trailing7.length ? Math.round(trailing7.reduce((a, d) => a + d.calls, 0) / trailing7.length) : null
  return {
    ok: true,
    latest,
    today: { date: today, calls: (byDay.get(today) || {}).calls || 0 },
    days: days.slice(-8),
    avg7DailyCalls: avg7,
    projectedMonthlyCalls: avg7 != null ? avg7 * 30 : null,
    windowNote: "tail-window rollup (last " + Math.round(tailBytes / 1048576) + "MB of log); quota fields appear only on entries logged after 2026-08-11",
  }
}

module.exports = {
  logApiCall,
  logApiCallAsync,
  readRecentApiCalls,
  summarizeApiCalls,
  quotaFromHeaders,
  logOddsUsage,
  readTailLines,
  readOddsUsageRollup,
  // exposed for tests / inspection
  LOG_FILE,
}
