#!/usr/bin/env node
"use strict"
/**
 * captureNflProps.js — NFL CAPTURE-FIRST WIRING (2026-08-15, standing queue;
 * CC research eee5b6f, CA triage 342262e; paper-first Week 1, same gates).
 *
 * CAPTURE ONLY. No model, no picks, no serving surface. The point: when the
 * September paper machinery arrives, it inherits a CLV-grade capture history
 * instead of starting blind — the trueOpen lesson on the NFL clock (early
 * props are soft + low-limit; the Thu/Fri morning window is the MLB-morning
 * analog, per CC §3.2).
 *
 * Keys are CONFIG (config/nflCaptureKeys.json) — receptions is the beachhead
 * family; CA/operator tune the set without code. Season gate:
 * isSportEnabled("nfl") — seasonsActive.json ships nfl=false; flipping it
 * arms the scheduler windows with no restart. Quota: every call rides the
 * odds-quota ledger (caller captureNflProps); CC §5 estimates ~2k credits/wk
 * at full 13-pass cadence — v1 wires 4 windows/wk (Wed TNF open 10:00 ·
 * Thu morning open 09:30 · Fri post-designation 15:30 · Sun pre-kick 11:50,
 * ET), well under 1k/wk; cadence ramps by CA call at season start.
 *
 * SIDE SEMANTICS NOTE (SEV-1 8a94621b seam): capture stores outcome sides
 * VERBATIM — including "Yes" on anytime-TD. Capture is record-of-market, not
 * grading; every grader in this repo now refuses sides it has no semantics
 * for, and that is where the never-guess rule lives.
 *
 * Hermetic fixture mode: NFL_STUB_DIR serves events.json + odds_<id>.json —
 * zero network, zero quota, zero season-gate dependence.
 */
const path = require("path")
const fs = require("fs")
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }) } catch (_) {}
const axios = require("axios")
const { logOddsUsage } = require("../pipeline/shared/apiCallLogger")
const { isSportEnabled } = require("../pipeline/shared/seasonGate")
const { calendarDateForTimestamp } = require("../pipeline/shared/slateDate")

const ROOT = path.join(__dirname, "..")
const TRACKING_DIR = process.env.NFL_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
const STUB = process.env.NFL_STUB_DIR || null

const FAMILY_OF = {
  player_receptions: "receptions", player_receptions_alternate: "receptions",
  player_reception_yds: "receivingYards", player_reception_yds_alternate: "receivingYards",
  player_rush_yds: "rushingYards", player_rush_yds_alternate: "rushingYards",
  player_pass_yds: "passingYards", player_pass_tds: "passingTds",
  player_anytime_td: "anytimeTd",
  player_rush_attempts: "rushAttempts", player_pass_attempts: "passAttempts",
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config", "nflCaptureKeys.json"), "utf8")) } catch (_) { return null }
}

async function fetchEvents(cfg, apiKey) {
  if (STUB) return JSON.parse(fs.readFileSync(path.join(STUB, "events.json"), "utf8"))
  const res = await axios.get(`https://api.the-odds-api.com/v4/sports/${cfg.sportKey}/events`, { params: { apiKey }, timeout: 15000 })
  logOddsUsage(res.headers, { sport: "nfl", endpoint: "odds-api/events/list", caller: "captureNflProps" })
  return Array.isArray(res.data) ? res.data : []
}

/** Per-event props fetch w/ the invalid-markets retry (trueOpen/ladders
 *  pattern) — one unsupported key never drops the whole event. */
async function fetchEventProps(cfg, apiKey, eventId, marketsCsv) {
  if (STUB) { try { return { payload: JSON.parse(fs.readFileSync(path.join(STUB, `odds_${eventId}.json`), "utf8")) } } catch (_) { return { payload: null, error: "stub missing" } } }
  const endpoint = `https://api.the-odds-api.com/v4/sports/${cfg.sportKey}/events/${eventId}/odds`
  const params = { apiKey, regions: "us", oddsFormat: "american", markets: marketsCsv, bookmakers: cfg.books.join(",") }
  try {
    const res = await axios.get(endpoint, { params, timeout: 20000 })
    logOddsUsage(res.headers, { sport: "nfl", endpoint: "odds-api/events/odds/nfl-props", eventId, caller: "captureNflProps" })
    return { payload: res.data }
  } catch (err) {
    const msg = String(err?.response?.data?.message || "")
    if (msg.toLowerCase().includes("invalid markets:")) {
      const invalid = new Set(msg.split(":").slice(1).join(":").split(",").map((s) => s.trim()).filter(Boolean))
      const kept = marketsCsv.split(",").filter((k) => !invalid.has(k))
      if (kept.length) {
        try {
          const r2 = await axios.get(endpoint, { params: { ...params, markets: kept.join(",") }, timeout: 20000 })
          logOddsUsage(r2.headers, { sport: "nfl", endpoint: "odds-api/events/odds/nfl-props-retry", eventId, caller: "captureNflProps" })
          return { payload: r2.data, droppedMarkets: [...invalid] }
        } catch (_) {}
      }
    }
    return { payload: null, error: String(err?.response?.status || err?.message || err) }
  }
}

/** Flatten a vendor payload into capture rows. Sides stored VERBATIM. */
function rowsFromPayload(payload, pass, capturedAt) {
  const rows = []
  if (!payload) return rows
  const eventId = payload.id || null
  const matchup = `${payload.away_team || "?"} @ ${payload.home_team || "?"}`
  for (const bk of payload.bookmakers || []) {
    for (const mkt of bk.markets || []) {
      const family = FAMILY_OF[mkt.key] || mkt.key
      for (const o of mkt.outcomes || []) {
        if (!Number.isFinite(Number(o.price))) continue // unpriced = does not exist for us
        rows.push({ eventId, matchup, commenceTime: payload.commence_time || null, player: o.description || o.name, marketKey: mkt.key, family, side: String(o.name || ""), line: Number.isFinite(Number(o.point)) ? Number(o.point) : null, oddsAmerican: Number(o.price), book: bk.key, capturedAt, pass })
      }
    }
  }
  return rows
}

const dedupeKey = (r) => `${r.pass}|${r.eventId}|${r.marketKey}|${String(r.player).toLowerCase()}|${r.side}|${r.line}|${r.book}`

async function main() {
  const pass = process.argv[2] || "manual"
  const cfg = loadConfig()
  if (!cfg || !Array.isArray(cfg.baseMarkets) || !cfg.baseMarkets.length) {
    console.error("captureNflProps: config/nflCaptureKeys.json missing/invalid — REFUSING (the config is the capture authority; no hardcoded fallback)")
    process.exit(1)
  }
  if (!STUB && !isSportEnabled("nfl")) { console.log("captureNflProps: nfl=false in seasonsActive.json — honest no-op (flip at season start; windows arm with no restart)"); return }
  const apiKey = STUB ? "stub" : process.env.ODDS_API_KEY
  if (!apiKey) { console.log("captureNflProps SKIPPED — no ODDS_API_KEY in env. No files written."); return }

  const capturedAt = new Date().toISOString()
  const horizonMs = (Number(cfg.eventHorizonDays) || 8) * 86400000
  let events = []
  try { events = await fetchEvents(cfg, apiKey) } catch (e) { console.error(`captureNflProps: events fetch failed (${e?.message || e}) — nothing written`); process.exit(1) }
  const upcoming = events.filter((e) => { const t = Date.parse(e.commence_time || 0); return Number.isFinite(t) && t > Date.now() - 3600000 && t < Date.now() + horizonMs })
  if (!upcoming.length) { console.log(`captureNflProps [${pass}]: 0 upcoming events inside ${cfg.eventHorizonDays}d — honest no-op (offseason or between slates)`); return }

  const marketsCsv = [...cfg.baseMarkets, ...cfg.altMarkets].join(",")
  const allRows = []
  let dropped = 0
  for (const ev of upcoming) {
    const r = await fetchEventProps(cfg, apiKey, ev.id, marketsCsv)
    if (!r.payload) { console.log(`  ${ev.id}: ERROR ${r.error || "?"}`); continue }
    if (r.droppedMarkets) console.log(`  ${ev.id}: vendor rejected ${r.droppedMarkets.join(",")} — captured the rest`)
    const rows = rowsFromPayload(r.payload, pass, capturedAt)
    dropped += r.droppedMarkets ? r.droppedMarkets.length : 0
    allRows.push(...rows)
  }

  const day = calendarDateForTimestamp(Date.now())
  const outPath = path.join(TRACKING_DIR, `nfl_props_capture_${day}.json`)
  let existing = { capturedDate: day, rows: [] }
  try { existing = JSON.parse(fs.readFileSync(outPath, "utf8")) } catch (_) {}
  const byKey = new Map((existing.rows || []).map((r) => [dedupeKey(r), r]))
  for (const r of allRows) byKey.set(dedupeKey(r), r) // same-window re-run replaces, never duplicates
  const merged = [...byKey.values()]
  const passes = {}
  for (const r of merged) passes[r.pass] = (passes[r.pass] || 0) + 1
  fs.mkdirSync(TRACKING_DIR, { recursive: true })
  const tmp = `${outPath}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify({ capturedDate: day, updatedAt: capturedAt, passes, rows: merged }, null, 1))
  fs.renameSync(tmp, outPath)
  console.log(`captureNflProps [${pass}]: ${upcoming.length} events → ${allRows.length} rows this pass (${merged.length} total on ${day}${dropped ? `; ${dropped} vendor-rejected keys` : ""}) → ${path.basename(outPath)}`)
}

main().catch((e) => { console.error("captureNflProps FATAL:", e?.message || e); process.exit(1) })
