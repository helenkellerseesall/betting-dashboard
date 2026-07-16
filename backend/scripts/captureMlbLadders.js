#!/usr/bin/env node
"use strict"

/**
 * captureMlbLadders.js — G2 ENABLER: FULL LADDER CAPTURE (2026-07-16).
 *
 * From CC's full-spectrum ingestion audit (docs/research/2026-07-16-full-
 * spectrum-ingestion-audit.md §6): we request ZERO `_alternate` market keys
 * today — the NegBinom shadow models ladders we never price. This script
 * captures the MARKET side: every posted rung (alternate line) per
 * player/family/book, for our 8 board families' alternate suites.
 *
 * PATTERN: captureMlbTrueOpen (isolated, additive). Does NOT touch
 * snapshot-mlb.json, openOdds CLV baselines, scoring, selection, or serving.
 * Zero live consumers until G2 proper points at the store.
 *
 * SCHEDULE (3 passes/day — CC's quota math: ~8 keys × ~15 events ≈ 120
 * credits/pass ≈ +11k/mo; hourly would ≈ +54k/mo and blow the 100k plan):
 *   10:00 ET  post-slate-build — today's rungs incl. matinee near-close
 *             (~T-2h for 12:05 starts; the 9 AM board is up so the slate is real)
 *   17:00 ET  pre-lock — lineups posted, rungs firmed, ~T-2h for the 19:00 wave
 *   22:05 ET  night-owl — the slate builder has forward-rolled: TOMORROW's
 *             OPENING rungs (which is why no early-morning pass is needed —
 *             last night's 22:05 already captured today's openers)
 *   Every game gets ≥2 rung snapshots (prior-evening open + same-day) and
 *   evening games get 3 — open/mid/near-close rung history for G2 curves.
 *
 * QUOTA GUARD (never starve the hourly board):
 *   - DAILY_CAP credits/day for ladders (measured via the vendor's
 *     x-requests-last response header — real cost, not estimates); a pass
 *     stops mid-slate when the cap would be exceeded (honest partial, logged).
 *   - RESERVE_FLOOR: if x-requests-remaining ever reads below it, the pass
 *     aborts immediately — remaining quota belongs to the live board.
 *   - Per-day spend persisted in runtime/tracking/ladder_quota.json.
 *
 * STORE (game-date keyed — slate-date doctrine, one file per GAME date):
 *   runtime/tracking/mlb_ladders_<gameDate>.json
 *   { gameDate, updatedAt, passes:[{pass, capturedAt, requestsSpent, events,
 *     rungRows}], rows:[{eventId, matchup, commenceTime, player, family, side,
 *     line, oddsAmerican, book, capturedAt, pass}] }
 *   Rows APPEND per pass (full observation history — G2 wants rung movement,
 *   not just the latest board). Never fabricated: only priced outcomes stored.
 */

const path = require("path")
const fs = require("fs")
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }) } catch (_) { /* env may come from the LaunchAgent plist */ }
const axios = require("axios")
const { isSportEnabled } = require("../pipeline/shared/seasonGate")
const { buildMlbSlateEvents } = require("../pipeline/schedule/buildMlbSlateEvents")
const { slateDateForTimestamp, calendarDateForTimestamp } = require("../pipeline/shared/slateDate")

// The alternate suites for OUR board families (CC audit §6: vendor confirms
// full MLB alternate coverage; unsupported keys are stripped by the
// invalid-markets retry below, so vendor drift self-corrects).
const LADDER_MARKETS = [
  "batter_hits_alternate",
  "batter_total_bases_alternate",
  "batter_home_runs_alternate",
  "batter_rbis_alternate",
  "batter_runs_scored_alternate",
  "pitcher_strikeouts_alternate",
  "pitcher_hits_allowed_alternate",
  "pitcher_walks_alternate",
]
// Same request list the live MLB config uses (backend keeps 7+1 for line-shop).
const BOOKS = ["draftkings", "fanduel", "fanatics", "betmgm", "betrivers", "hardrockbet", "caesars", "bet365"]
const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
const QUOTA_FILE = path.join(TRACKING_DIR, "ladder_quota.json")

// Quota policy (CC math: ~120 credits/pass × 3 ≈ 360/day; cap leaves slack
// for deep slates without ever approaching board-relevant burn).
const DAILY_CAP = 600
const RESERVE_FLOOR = 5000

function readJson(fp, fb) { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return fb } }
function quotaSpentToday(dayKey) { return Number(readJson(QUOTA_FILE, {})[dayKey]) || 0 }
function recordQuotaSpend(dayKey, spent) {
  const q = readJson(QUOTA_FILE, {})
  q[dayKey] = (Number(q[dayKey]) || 0) + spent
  // keep the file small — retain ~35 day keys
  const keys = Object.keys(q).sort().slice(-35)
  const out = {}; for (const k of keys) out[k] = q[k]
  try { fs.mkdirSync(TRACKING_DIR, { recursive: true }) } catch (_) {}
  fs.writeFileSync(QUOTA_FILE, JSON.stringify(out, null, 2))
}

/** Per-event alternate-odds fetch with the invalid-markets retry (trueOpen
 *  pattern) — one unsupported family never drops the whole event. Returns
 *  { payload, cost, remaining } with cost read from x-requests-last (REAL). */
async function fetchEventLadderOdds(oddsApiKey, eventId, marketsCsv, booksCsv) {
  const endpoint = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`
  const params = { apiKey: oddsApiKey, regions: "us", oddsFormat: "american", markets: marketsCsv, bookmakers: booksCsv }
  const meta = (res) => ({
    cost: Number(res?.headers?.["x-requests-last"]) || 0,
    remaining: Number(res?.headers?.["x-requests-remaining"]) || null,
  })
  try {
    const res = await axios.get(endpoint, { params, timeout: 15000 })
    return { payload: res.data, ...meta(res) }
  } catch (err) {
    const msg = String(err?.response?.data?.message || "")
    if (msg.toLowerCase().includes("invalid markets:")) {
      const invalid = new Set(msg.split(":").slice(1).join(":").split(",").map((s) => s.trim()).filter(Boolean))
      const kept = marketsCsv.split(",").filter((k) => !invalid.has(k))
      if (kept.length) {
        try { const r2 = await axios.get(endpoint, { params: { ...params, markets: kept.join(",") }, timeout: 15000 }); return { payload: r2.data, ...meta(r2), droppedMarkets: [...invalid] } } catch (_) {}
      }
    }
    return { payload: null, cost: 0, remaining: null, error: String(err?.response?.status || err?.message || err) }
  }
}

/** Flatten a vendor event-odds payload into rung rows. Exported for the
 *  fixture (unit-tested against a synthetic multi-rung payload). Only priced
 *  outcomes are stored — a rung without a price does not exist for us. */
function rungRowsFromPayload(payload, ev, { capturedAt, pass } = {}) {
  const rows = []
  const eventId = payload?.id || ev?.id || ev?.eventId || null
  const commenceTime = payload?.commence_time || ev?.commence_time || ev?.gameTime || null
  const away = payload?.away_team || ev?.away_team || ev?.awayTeam || ""
  const home = payload?.home_team || ev?.home_team || ev?.homeTeam || ""
  const matchup = (away && home) ? `${away} @ ${home}` : (ev?.matchup || "")
  for (const bm of (Array.isArray(payload?.bookmakers) ? payload.bookmakers : [])) {
    const book = String(bm?.key || bm?.title || "").toLowerCase()
    for (const market of (Array.isArray(bm?.markets) ? bm.markets : [])) {
      const family = String(market?.key || "").trim()
      if (!LADDER_MARKETS.includes(family)) continue
      for (const o of (Array.isArray(market?.outcomes) ? market.outcomes : [])) {
        const player = String(o?.description || o?.participant || "").trim()
        const side = String(o?.name || "").trim() // "Over"/"Under" (alternates are usually Over-only milestones)
        const line = Number(o?.point)
        const oddsAmerican = Number(o?.price)
        if (!player || !Number.isFinite(oddsAmerican)) continue
        rows.push({ eventId, matchup, commenceTime, player, family, side, line: Number.isFinite(line) ? line : null, oddsAmerican, book, capturedAt, pass })
      }
    }
  }
  return rows
}

/** Append a pass's rows into per-GAME-date store files (slate-date doctrine). */
function appendLadderRows(allRows, passMeta) {
  const byGameDate = new Map()
  for (const r of allRows) {
    const ms = new Date(r.commenceTime || 0).getTime()
    const gd = Number.isFinite(ms) && ms > 0 ? slateDateForTimestamp(ms) : passMeta.fallbackDate
    if (!byGameDate.has(gd)) byGameDate.set(gd, [])
    byGameDate.get(gd).push(r)
  }
  const written = []
  for (const [gameDate, rows] of byGameDate) {
    const fp = path.join(TRACKING_DIR, `mlb_ladders_${gameDate}.json`)
    const store = readJson(fp, { gameDate, passes: [], rows: [] })
    store.updatedAt = passMeta.capturedAt
    store.passes.push({ pass: passMeta.pass, capturedAt: passMeta.capturedAt, requestsSpent: passMeta.requestsSpent, events: passMeta.events, rungRows: rows.length })
    store.rows.push(...rows)
    const tmp = `${fp}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(store))
    fs.renameSync(tmp, fp)
    written.push({ gameDate, file: path.basename(fp), rungRows: rows.length, totalRows: store.rows.length })
  }
  return written
}

function passLabel() {
  const arg = process.argv.find((a) => a.startsWith("--pass="))
  if (arg) return arg.split("=")[1]
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }))
  return h < 13 ? "morning" : h < 20 ? "preclose" : "nightowl"
}

async function main() {
  const now = Date.now()
  if (!isSportEnabled("mlb")) { console.log("captureMlbLadders SKIPPED — MLB season OFF. No calls, no files."); return }
  const oddsApiKey = process.env.ODDS_API_KEY
  if (!oddsApiKey) { console.log("captureMlbLadders SKIPPED — no ODDS_API_KEY in env. No files written."); return }

  const dayKey = calendarDateForTimestamp(now)
  const spent = quotaSpentToday(dayKey)
  if (spent >= DAILY_CAP) { console.log(`captureMlbLadders SKIPPED — daily ladder cap reached (${spent}/${DAILY_CAP} credits today). Board quota is protected; next pass tomorrow.`); return }

  let slate
  try { slate = await buildMlbSlateEvents({ oddsApiKey, now }) }
  catch (e) { console.error("captureMlbLadders: event fetch failed —", e?.message || e); process.exit(1) }
  const events = Array.isArray(slate?.scheduledEvents) ? slate.scheduledEvents : []
  if (!events.length) { console.log(`captureMlbLadders: no scheduled MLB events (slate ${slate?.slateDateKey || "?"}) — honest no-games skip, no files.`); return }

  const pass = passLabel()
  const capturedAt = new Date(now).toISOString()
  const marketsCsv = LADDER_MARKETS.join(",")
  const booksCsv = BOOKS.join(",")
  let allRows = []
  let passSpend = 0
  let okEvents = 0
  let aborted = null
  for (const ev of events) {
    const id = ev?.id || ev?.eventId
    if (!id) continue
    if (spent + passSpend >= DAILY_CAP) { aborted = `daily cap ${DAILY_CAP} reached mid-pass`; break }
    const r = await fetchEventLadderOdds(oddsApiKey, id, marketsCsv, booksCsv)
    passSpend += r.cost
    if (r.remaining != null && r.remaining < RESERVE_FLOOR) { aborted = `vendor remaining ${r.remaining} < reserve floor ${RESERVE_FLOOR} — quota belongs to the live board`; break }
    if (r.payload && !r.error) {
      const rows = rungRowsFromPayload(r.payload, ev, { capturedAt, pass })
      allRows = allRows.concat(rows)
      if (rows.length) okEvents++
    }
  }

  recordQuotaSpend(dayKey, passSpend)
  const written = allRows.length ? appendLadderRows(allRows, { pass, capturedAt, requestsSpent: passSpend, events: events.length, fallbackDate: slate?.slateDateKey || dayKey }) : []
  const books = [...new Set(allRows.map((r) => r.book))].sort()
  const players = new Set(allRows.map((r) => r.player)).size
  console.log(`captureMlbLadders [${pass}]: ${allRows.length} rung rows · ${players} players · ${okEvents}/${events.length} events · books: ${books.join(", ") || "none"}`)
  console.log(`  quota: pass cost ${passSpend} credits (real, x-requests-last) · today ${spent + passSpend}/${DAILY_CAP} cap${aborted ? ` · PASS STOPPED EARLY: ${aborted}` : ""}`)
  for (const w of written) console.log(`  → ${w.file}: +${w.rungRows} rungs (${w.totalRows} total)`)
  if (process.argv.includes("--sample") && allRows.length) {
    // real-output proof: the deepest single player/family/book ladder captured
    const byKey = new Map()
    for (const r of allRows) { const k = `${r.player}|${r.family}|${r.book}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r) }
    const deepest = [...byKey.entries()].sort((a, b) => b[1].length - a[1].length)[0]
    console.log(`  SAMPLE LADDER (deepest): ${deepest[0]}`)
    for (const r of deepest[1].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) console.log(`    ${r.side} ${r.line} @ ${r.oddsAmerican > 0 ? "+" : ""}${r.oddsAmerican}`)
  }
}

if (require.main === module) {
  main().catch((e) => { console.error("captureMlbLadders fatal:", e?.message || e); process.exit(1) })
}

module.exports = { rungRowsFromPayload, LADDER_MARKETS, DAILY_CAP, RESERVE_FLOOR }
