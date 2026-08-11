#!/usr/bin/env node
"use strict"

/**
 * captureMlbTrueOpen.js — Phase Early-CLV-Measurement-R1 (2026-06-25)
 *
 * ADDITIVE / SHADOW measurement. Captures an EARLY ("true open") snapshot of the 5 lineup-independent
 * MLB pitcher-prop families for the next slate's games into a SEPARATE store. It does NOT call
 * /refresh-snapshot, does NOT write snapshot-mlb.json, and does NOT touch the live 9 AM openOdds CLV
 * baseline (phase4Tracking.js openOdds). Its only job is to let us MEASURE (R1) whether the overnight /
 * early opener is meaningfully softer than the 9 AM slate price on our books — before building anything.
 *
 * Lineup-INDEPENDENT only (safe to grab early — starters announced ~1 day ahead):
 *   pitcher_strikeouts · pitcher_outs · pitcher_earned_runs · pitcher_walks · pitcher_hits_allowed.
 * Batter props are OUT OF SCOPE for R1 (need confirmed lineups ~2-4h pre-game).
 *
 * Output (additive): backend/runtime/tracking/mlb_true_open_<slateDate>.json
 *   { capturedAt, slateDate, source:"trueOpen-early-opener", families[], booksRequested[],
 *     events, eventsWithRows,
 *     rows:[ { eventId, commenceTime, gameDate, matchup, player, family, side, line, book, oddsAmerican } ] }
 *
 * Safety: season-gated (MLB OFF → no calls, no files, exit 0); no ODDS_API_KEY → skip cleanly (no files);
 * captures only whatever pitcher markets are actually posted (fewer rows early is honest, never fabricated);
 * each run overwrites only its OWN dated trueOpen file. Reads the SAME odds-API event/odds endpoints the
 * live slate uses, but writes to its own store — fully isolated from the launch-critical pipeline.
 */

const path = require("path")
const fs = require("fs")
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }) } catch (_) { /* env may come from the LaunchAgent plist */ }
const axios = require("axios")
const { logOddsUsage } = require("../pipeline/shared/apiCallLogger") // 2026-08-11 odds-quota ledger (GO 63f24e4)
const { isSportEnabled } = require("../pipeline/shared/seasonGate")
const { buildMlbSlateEvents } = require("../pipeline/schedule/buildMlbSlateEvents")
const { calendarDateForTimestamp } = require("../pipeline/shared/slateDate")

// The 5 lineup-independent pitcher families (Odds API market keys).
const PITCHER_FAMILIES = ["pitcher_strikeouts", "pitcher_outs", "pitcher_earned_runs", "pitcher_walks", "pitcher_hits_allowed"]
// Our requested books (same list the live MLB config requests; ~6 typically return per slate).
const BOOKS = ["draftkings", "fanduel", "fanatics", "betmgm", "betrivers", "hardrockbet", "caesars", "bet365"]
const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")

// Per-event pitcher-prop fetch (replicated, not reused, to keep this script fully isolated from the live
// ingest file). Same endpoint/params shape as buildMlbBootstrapSnapshot.fetchMlbEventOdds, incl. the
// invalid-markets retry so one unsupported family doesn't drop the whole event.
async function fetchEventPitcherOdds(oddsApiKey, eventId, marketsCsv, booksCsv) {
  const endpoint = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`
  const params = { apiKey: oddsApiKey, regions: "us", oddsFormat: "american", markets: marketsCsv, bookmakers: booksCsv }
  try {
    const res = await axios.get(endpoint, { params, timeout: 15000 })
    logOddsUsage(res.headers, { sport: "mlb", endpoint: "odds-api/events/odds/true-open", eventId, caller: "captureMlbTrueOpen" })
    return res.data
  } catch (err) {
    const msg = String(err?.response?.data?.message || "")
    if (msg.toLowerCase().includes("invalid markets:")) {
      const invalid = new Set(msg.split(":").slice(1).join(":").split(",").map((s) => s.trim()).filter(Boolean))
      const kept = marketsCsv.split(",").filter((k) => !invalid.has(k))
      if (kept.length) {
        try { const r2 = await axios.get(endpoint, { params: { ...params, markets: kept.join(",") }, timeout: 15000 }); logOddsUsage(r2.headers, { sport: "mlb", endpoint: "odds-api/events/odds/true-open-retry", eventId, caller: "captureMlbTrueOpen" }); return r2.data } catch (_) {}
      }
    }
    return { _error: String(err?.response?.status || err?.message || err) }
  }
}

function rowsFromPayload(payload, ev) {
  const rows = []
  const eventId = payload?.id || ev?.id || ev?.eventId || null
  const commenceTime = payload?.commence_time || ev?.commence_time || ev?.gameTime || null
  const gameDate = commenceTime ? calendarDateForTimestamp(new Date(commenceTime).getTime()) : null
  const away = payload?.away_team || ev?.away_team || ev?.awayTeam || ""
  const home = payload?.home_team || ev?.home_team || ev?.homeTeam || ""
  const matchup = (away && home) ? `${away} @ ${home}` : (ev?.matchup || "")
  for (const bm of (Array.isArray(payload?.bookmakers) ? payload.bookmakers : [])) {
    const book = String(bm?.key || bm?.title || "").toLowerCase()
    for (const market of (Array.isArray(bm?.markets) ? bm.markets : [])) {
      const family = String(market?.key || "").trim()
      if (!PITCHER_FAMILIES.includes(family)) continue
      for (const o of (Array.isArray(market?.outcomes) ? market.outcomes : [])) {
        const player = String(o?.description || o?.participant || "").trim()  // Odds API: player name in `description`
        const side = String(o?.name || "").trim()                            // "Over" / "Under"
        const line = Number(o?.point)
        const oddsAmerican = Number(o?.price)
        if (!player || !Number.isFinite(oddsAmerican)) continue               // never store a fabricated/blank price
        rows.push({ eventId, commenceTime, gameDate, matchup, player, family, side, line: Number.isFinite(line) ? line : null, book, oddsAmerican })
      }
    }
  }
  return rows
}

async function main() {
  const now = Date.now()
  if (!isSportEnabled("mlb")) { console.log("captureMlbTrueOpen SKIPPED — MLB season OFF. No calls, no files."); return }
  const oddsApiKey = process.env.ODDS_API_KEY
  if (!oddsApiKey) { console.log("captureMlbTrueOpen SKIPPED — no ODDS_API_KEY in env. No files written."); return }

  let slate
  try { slate = await buildMlbSlateEvents({ oddsApiKey, now }) }
  catch (e) { console.error("captureMlbTrueOpen: event fetch failed —", e?.message || e); process.exit(1) }

  const events = (Array.isArray(slate?.scheduledEvents) && slate.scheduledEvents.length) ? slate.scheduledEvents : (Array.isArray(slate?.allEvents) ? slate.allEvents : [])
  const slateDate = slate?.slateDateKey || calendarDateForTimestamp(now)
  if (!events.length) { console.log(`captureMlbTrueOpen: no scheduled MLB events — nothing to capture (slate ${slateDate}).`); return }

  // 2026-07-15 NIGHT-OWL-1 — evening pass (--evening, scheduler 22:00 ET).
  // Captures the NEXT slate's opener the night before (buildMlbSlateEvents
  // forward-rolls once today's games have all started). FUTURE-SLATE-ONLY
  // guard: if the resolved slate is still today's (e.g. late West-Coast games
  // haven't started yet), skip WITHOUT writing — the evening pass must never
  // overwrite the 6 AM same-day baseline file. Measured 2026-07-15: next-day
  // props were posted on our books by 16:00 ET on a break eve and by ~22:00 ET
  // on normal game nights (first forward-rolled look).
  const eveningMode = process.argv.includes("--evening")
  if (eveningMode && slateDate <= calendarDateForTimestamp(now)) {
    console.log(`captureMlbTrueOpen (--evening): resolved slate ${slateDate} is not a FUTURE slate — skipping (never overwrites the same-day 6 AM baseline).`)
    return
  }

  const marketsCsv = PITCHER_FAMILIES.join(",")
  const booksCsv = BOOKS.join(",")
  let allRows = []
  let okEvents = 0
  for (const ev of events) {
    const id = ev?.id || ev?.eventId
    if (!id) continue
    const payload = await fetchEventPitcherOdds(oddsApiKey, id, marketsCsv, booksCsv)
    if (payload && !payload._error) {
      const r = rowsFromPayload(payload, ev)
      allRows = allRows.concat(r)
      if (r.length) okEvents++
    }
  }

  const out = {
    capturedAt: new Date(now).toISOString(),
    slateDate,
    source: "trueOpen-early-opener",
    note: "ADDITIVE early pitcher-prop opener; SEPARATE from the live 9 AM openOdds CLV baseline. R1 measurement only.",
    families: PITCHER_FAMILIES,
    booksRequested: BOOKS,
    events: events.length,
    eventsWithRows: okEvents,
    rows: allRows,
  }
  try { fs.mkdirSync(TRACKING_DIR, { recursive: true }) } catch (_) {}
  const fp = path.join(TRACKING_DIR, `mlb_true_open_${slateDate}.json`)
  fs.writeFileSync(fp, JSON.stringify(out, null, 2))
  const booksSeen = [...new Set(allRows.map((r) => r.book))].sort()
  console.log(`captureMlbTrueOpen: ${allRows.length} pitcher-prop rows across ${okEvents}/${events.length} games → ${path.basename(fp)} (books: ${booksSeen.join(", ") || "none"})`)
}

main().catch((e) => { console.error("captureMlbTrueOpen fatal:", e?.message || e); process.exit(1) })
