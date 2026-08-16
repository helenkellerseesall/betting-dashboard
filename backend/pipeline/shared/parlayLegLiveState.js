"use strict"

/**
 * parlayLegLiveState.js — BETS-PAGE PACK 2 item 4 (2026-07-29).
 *
 * LIVE LEG-DEATH INDICATOR — DISPLAY-ONLY. This module NEVER writes a result,
 * never touches the ledger, never feeds grading. The official grade happens at
 * the nightly (GRADING_RULES); this only tells the operator what the game
 * state has already made irreversible, so an open ticket whose leg is dead
 * stops LOOKING alive.
 *
 * Sources (Law 1 — reuse, don't reinvent): the sanctioned grading fetcher
 * fetchMlbGameResults (statsapi boxscores — live boxscores update in-game
 * from the same endpoint grading trusts at final) + the statsapi schedule for
 * per-date game statuses (all-Final detection).
 *
 * VERDICT RULES (irreversible-only; no probability guesses, ever):
 *   over  side: statNow >  line  ⇒ won_unofficial   (a counting stat never decreases)
 *   under side: statNow >  line  ⇒ lost_unofficial  (the under is already breached)
 *   ALL games of the slate FINAL ⇒ decided from the final stat:
 *     over : statNow > line win · statNow === line push · else loss (unofficial)
 *     under: statNow < line win · statNow === line push · else loss (unofficial)
 *   player absent from boxscores (scratched/benched) ⇒ open — NEVER guessed
 *   fetch failure / unknown ⇒ open (fail-open; display-only means silence is safe)
 *
 * TICKET VERDICT: any leg lost_unofficial ⇒ ticket lost_unofficial
 * ("effectively decided — losing"); every leg won_unofficial ⇒ won_unofficial;
 * all legs carry unofficial verdicts w/ no loss but a push in the mix ⇒
 * decided_mixed_unofficial; anything still open ⇒ null (ticket stays plain
 * pending).
 *
 * Caching: per-gameDate, 60s — the MY BETS page refresh never storms statsapi.
 */

const axios = require("axios")
const { fetchMlbGameResults, getStatValue, normName } = require("../grading/fetchMlbGameResults")

const CACHE_MS = 60e3
const SCHEDULE_TIMEOUT = 8000
const _cache = new Map() // gameDate → { at, results, statuses }

async function _fetchScheduleStatuses(date) {
  try {
    const r = await axios.get(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`, { timeout: SCHEDULE_TIMEOUT })
    const games = ((r.data && r.data.dates && r.data.dates[0]) || {}).games || []
    let finals = 0
    for (const g of games) if (String(g?.status?.abstractGameState || "") === "Final") finals++
    return { total: games.length, finals, allFinal: games.length > 0 && finals === games.length }
  } catch (_) { return { total: null, finals: null, allFinal: false } }
}

async function _contextForDate(date, injected) {
  if (injected) return injected // fixtures inject { results, statuses } — no network
  const hit = _cache.get(date)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit
  const [results, statuses] = await Promise.all([
    fetchMlbGameResults(date).catch(() => new Map()),
    _fetchScheduleStatuses(date),
  ])
  const ctx = { at: Date.now(), results, statuses }
  _cache.set(date, ctx)
  return ctx
}

/**
 * Pure per-leg verdict. statNow = resolved live stat value or null.
 * Exported for the fixture — no I/O in here.
 */
function assessLeg(leg, statNow, allFinal) {
  const line = Number(leg && leg.line)
  const side = String((leg && leg.side) || "").toLowerCase()
  const val = Number(statNow)
  if (!Number.isFinite(line) || !side || statNow == null || !Number.isFinite(val)) return { state: "open" }
  // 2026-08-15 SEV-1 8a94621b class: sides are an enum here too. A side
  // without over/under semantics ("yes" milestone legs) gets NO live read —
  // the display must never guess either (the effective lens ACTS on these
  // calls). Open = no claim.
  if (!(side === "over" || side === "o" || side === "under" || side === "u")) return { state: "open" }
  const over = side.startsWith("o")
  if (over && val > line) return { state: "won_unofficial", statNow: val }
  if (!over && val > line) return { state: "lost_unofficial", statNow: val }
  if (allFinal) {
    if (val === line) return { state: "push_unofficial", statNow: val }
    // val < line from here (val > line handled above)
    return { state: over ? "lost_unofficial" : "won_unofficial", statNow: val }
  }
  return { state: "open", statNow: val }
}

function ticketVerdict(legStates) {
  if (!Array.isArray(legStates) || !legStates.length) return null
  const states = legStates.map((l) => l.state)
  if (states.some((s) => s === "lost_unofficial")) return "lost_unofficial"
  if (states.some((s) => s === "open")) return null
  if (states.every((s) => s === "won_unofficial")) return "won_unofficial"
  return "decided_mixed_unofficial" // pushes in the mix — grades at the nightly
}

/**
 * Assess open parlays. bets: [{ id, gameDate, legs: [{player, statFamily, side, line}] }].
 * opts.inject: { [gameDate]: { results: Map, statuses: {allFinal} } } for fixtures.
 * Returns { [id]: { ticket, legs: [{state, statNow?}], allFinal, asOf, disclaimer } }.
 * NEVER throws — display-only means every failure collapses to "no annotation".
 */
async function assessOpenParlayLegs(bets, opts = {}) {
  const out = {}
  try {
    const byDate = new Map()
    for (const b of (bets || [])) {
      const d = String(b.gameDate || b.date || "")
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Array.isArray(b.legs) || !b.legs.length) continue
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d).push(b)
    }
    for (const [date, group] of byDate) {
      const ctx = await _contextForDate(date, opts.inject && opts.inject[date])
      const results = ctx.results instanceof Map ? ctx.results : new Map()
      const allFinal = !!(ctx.statuses && ctx.statuses.allFinal)
      for (const b of group) {
        const legStates = b.legs.map((leg) => {
          const st = results.get(normName(leg.player))
          const val = st ? getStatValue(st, leg.statFamily || leg.stat) : null
          return assessLeg(leg, val, allFinal)
        })
        out[b.id] = {
          ticket: ticketVerdict(legStates),
          legs: legStates,
          allFinal,
          asOf: new Date().toISOString(),
          disclaimer: "live read — official grade at the nightly",
        }
      }
    }
  } catch (_) { /* fail-open: partial or empty annotations */ }
  return out
}

module.exports = { assessOpenParlayLegs, assessLeg, ticketVerdict }
