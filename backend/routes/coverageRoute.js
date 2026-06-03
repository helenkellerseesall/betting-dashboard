"use strict"

/**
 * coverageRoute.js — Phase MLB-Daily-Coverage-Surface-1A (2026-06-02)
 *
 * GET /api/ws/coverage-today
 *
 * Returns the TRUE per-sport per-date coverage breakdown from personal_ledger.json
 * (append-only, full historical record) — NOT from tracked_bets (which Layer-1-filters
 * out games whose tip time is >1 hour past per phase4Tracking.js:951).
 *
 * Closes the "10 vs 5 games today" trust gap the operator hit on 2026-06-02 ~22:00 ET:
 * tracked_bets showed 5 MLB games today even though the engine actually covered all
 * 15 (proven via personal_ledger which keeps the full record). This route surfaces
 * that full coverage so operator can verify "yes, we covered every game today."
 *
 * Output shape:
 *   {
 *     ok: true, generatedAt, todayEt, tomorrowEt,
 *     nba: { [dateKey]: { dateKey, gameCount, totalPicks, games: [{matchup, eventId, pickCount}] } },
 *     mlb: { [dateKey]: { same } },
 *     elapsedMs
 *   }
 *
 * Anti-fabrication: every count comes from a real entries iteration of personal_ledger.
 * No defaults, no stale caches. Date routing prefers explicit slateDate/date fields,
 * falls back to gameTime calendar-date conversion only if those are missing.
 *
 * Does NOT touch /status — operator wants /status surface stable. This is a separate
 * mount at /api/ws/coverage-today.
 */

const express = require("express")
const fs = require("fs")
const path = require("path")

const router = express.Router()

const REPO_ROOT       = path.join(__dirname, "..", "..")
const PERSONAL_LEDGER = path.join(REPO_ROOT, "backend", "runtime", "tracking", "personal_ledger.json")

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch (_) { return null }
}

function calendarDateEtFromMs(ms) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
  return fmt.format(new Date(ms))
}

// Resolve the "what day did this pick belong to?" for ledger entries.
// Trust explicit fields first (date / slateDate) — those are written by the
// pipeline with the slate-date doctrine in mind. Only fall back to gameTime
// calendar conversion when explicit fields are missing.
function entryDateKey(e) {
  if (e.slateDate) return e.slateDate
  if (e.date)      return e.date
  if (e.gameTime) {
    const ts = Date.parse(e.gameTime)
    if (Number.isFinite(ts)) return calendarDateEtFromMs(ts)
  }
  return null
}

// Unique game identity — eventId when present (canonical), matchup string as
// fallback for entries that pre-date eventId stamping.
function gameKeyFor(e) {
  return e.eventId || e.matchup || null
}

router.get("/", (req, res) => {
  const t0 = Date.now()

  const todayEt    = calendarDateEtFromMs(Date.now())
  const tomorrowEt = calendarDateEtFromMs(Date.now() + 86400000)

  const ledger = safeReadJson(PERSONAL_LEDGER)
  if (!ledger) {
    return res.status(500).json({ ok: false, error: "personal_ledger.json not readable", path: PERSONAL_LEDGER })
  }
  const entries = Array.isArray(ledger) ? ledger : (ledger?.entries || ledger?.bets || [])

  // Phase MLB-Daily-Coverage-Surface-1A-fix1 (2026-06-02) — group by MATCHUP
  // primary so that series-continuation games (same teams play tonight AND
  // tomorrow) collapse into one matchup entry. Each matchup tracks its
  // distinct eventIds + per-event pickCount underneath. This matches the
  // operator's mental model: "15 MLB games today" = 15 unique matchups. The
  // distinctEventCount metric stays exposed for transparency (when a series
  // is in flight, distinctEventCount > uniqueMatchupCount). The eventId-based
  // pre-fix1 dedup reported 18-MLB for today (15 unique matchups + 3 series
  // doubles like Dodgers @ Diamondbacks playing tonight + tomorrow).
  //
  // Anti-fabrication: every count derived from real ledger entries. The
  // distinctEventCount is summed from the same source as uniqueMatchupCount;
  // they're two views of the same set, not independent fabrications.
  //
  // Structure: buckets[sport][dateKey][matchup] = {
  //   matchup,
  //   pickCount,                       // total picks across all events in this matchup
  //   events: { [eventId]: pickCount } // distinct events under this matchup
  // }
  const buckets = { nba: {}, mlb: {} }
  let scannedEntries = 0
  let inScopeEntries = 0
  for (const e of entries) {
    scannedEntries++
    const sport = String(e.sport || "").toLowerCase()
    if (sport !== "nba" && sport !== "mlb") continue
    const dk = entryDateKey(e)
    if (!dk) continue
    // Scope: today + tomorrow only (the operator's forward-looking window)
    if (dk !== todayEt && dk !== tomorrowEt) continue
    // gameKey for routing — but matchup is the dedup primary
    const gk = gameKeyFor(e)
    if (!gk) continue
    const matchup = e.matchup || `(no matchup, eventId=${e.eventId || "unknown"})`
    inScopeEntries++
    if (!buckets[sport][dk])              buckets[sport][dk] = {}
    if (!buckets[sport][dk][matchup]) {
      buckets[sport][dk][matchup] = {
        matchup,
        pickCount: 0,
        events: {},
      }
    }
    const bucket = buckets[sport][dk][matchup]
    bucket.pickCount++
    const evKey = e.eventId || "no-eventId"
    bucket.events[evKey] = (bucket.events[evKey] || 0) + 1
  }

  // Shape the response
  const out = {
    ok: true,
    generatedAt: new Date().toISOString(),
    todayEt,
    tomorrowEt,
    diagnostics: {
      ledgerEntriesScanned: scannedEntries,
      inScopeEntries,
      _note: "uniqueMatchupCount = distinct team pairings (the operator-meaningful number). distinctEventCount = distinct eventIds (counts series-continuation games where same teams play tonight AND tomorrow as separate events). Difference = number of in-flight series.",
    },
  }
  for (const sport of ["nba", "mlb"]) {
    out[sport] = {}
    for (const dk of [todayEt, tomorrowEt]) {
      const matchupsObj = buckets[sport][dk] || {}
      const games = Object.values(matchupsObj)
        .map(m => ({
          matchup: m.matchup,
          pickCount: m.pickCount,
          distinctEventCount: Object.keys(m.events).length,
          events: Object.entries(m.events).map(([eventId, pickCount]) => ({ eventId, pickCount })),
        }))
        .sort((a, b) => (a.matchup || "").localeCompare(b.matchup || ""))
      out[sport][dk] = {
        dateKey: dk,
        uniqueMatchupCount: games.length,
        distinctEventCount: games.reduce((s, g) => s + g.distinctEventCount, 0),
        totalPicks: games.reduce((s, g) => s + g.pickCount, 0),
        games,
      }
    }
  }
  out.elapsedMs = Date.now() - t0
  res.json(out)
})

module.exports = router
