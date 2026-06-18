"use strict"
/**
 * pinnacleBenchmark.js — SHARP GAME-LINE benchmark (Pinnacle via Odds API `eu` region).
 *
 * PURPOSE: measure our GAME-LINE closing-line value against a SHARP reference, so we can tell
 * whether a move is real or retail-vs-retail noise. Retail CLV/consensus stay exactly as-is;
 * this is an ADDITIVE benchmark only.
 *
 * HARD CONSTRAINTS:
 *   - BENCHMARK ONLY. Pinnacle is NOT US-legal / NOT bettable. It is NEVER added to the betting
 *     allowlist (sportsbookAllowlist.js — PRESERVED, untouched), the line-shop, or any display/
 *     /m surface. Output is a SEPARATE structure; callers must never merge it into bettable rows.
 *   - GAME-LINE ONLY: h2h (moneyline) + totals + spreads (run line). Pinnacle offers NO player
 *     props on the Odds API, so PROP CLV stays retail-benchmarked (documented, not faked).
 *   - eu-BOOK GUARD: the `eu` region returns many books; we keep ONLY Pinnacle and explicitly
 *     drop every other eu book (they must never reach the bettable/line-shop pool).
 *   - ANALYTICS ONLY: feeds NOTHING in scoring/selection/betting. De-vig via the canonical
 *     vigStripping (Law 1, no parallel math).
 *   - Kill-switch PINNACLE_BENCHMARK: default OFF ("1" = ON). The eu pull is a SECOND Odds API
 *     request per slate ⇒ extra credit cost; enable consciously.
 */
const axios = require("axios")
const vig = require("./vigStripping")

const ENABLED = String(process.env.PINNACLE_BENCHMARK ?? "0") === "1"
const PINNACLE_KEY = "pinnacle"                          // Odds API bookmaker key
const GAME_LINE_MARKETS = ["h2h", "totals", "spreads"]  // game-level ONLY — never prop markets
const ODDS_BASE = "https://api.the-odds-api.com/v4/sports"

const _norm = (k) => String(k || "").toLowerCase().trim()
const isPinnacle = (k) => _norm(k) === PINNACLE_KEY
// GUARD: explicit predicate — any non-Pinnacle book is benchmark-ineligible AND must be kept
// out of the bettable/line-shop pool. (This module never emits non-Pinnacle books at all.)
const isBenchmarkOnlyBook = (k) => isPinnacle(k)

/**
 * Pull Pinnacle game lines for the slate from the eu region, Pinnacle-only.
 * @returns { enabled, byEvent: { [eventId]: { eventId, commence, markets: { h2h:[{name,point,odds}], ... } } }, meta }
 * Never throws on a single event; never returns a non-Pinnacle book.
 */
async function fetchPinnacleGameLines({ oddsApiKey, events, sport = "baseball_mlb", timeoutMs = 15000 } = {}) {
  if (!ENABLED) return { enabled: false, byEvent: {}, meta: { reason: "PINNACLE_BENCHMARK!=1 (default OFF)" } }
  if (!oddsApiKey) return { enabled: true, byEvent: {}, meta: { error: "no oddsApiKey" } }
  const byEvent = {}
  const euBooksSeen = new Set()
  let pinnacleEvents = 0, eventsTried = 0
  for (const ev of (Array.isArray(events) ? events : [])) {
    const eventId = ev?.id || ev?.eventId
    if (!eventId) continue
    eventsTried++
    try {
      const res = await axios.get(`${ODDS_BASE}/${sport}/events/${encodeURIComponent(eventId)}/odds`, {
        params: { apiKey: oddsApiKey, regions: "eu", markets: GAME_LINE_MARKETS.join(","), oddsFormat: "american" },
        timeout: timeoutMs,
      })
      const books = Array.isArray(res.data?.bookmakers) ? res.data.bookmakers : []
      for (const b of books) euBooksSeen.add(_norm(b?.key))
      const pin = books.find((b) => isPinnacle(b?.key))   // GUARD: Pinnacle only — all other eu books dropped here
      if (!pin) continue
      pinnacleEvents++
      const markets = {}
      for (const m of (Array.isArray(pin.markets) ? pin.markets : [])) {
        if (!GAME_LINE_MARKETS.includes(_norm(m?.key))) continue   // GUARD: game-line markets only
        markets[_norm(m.key)] = (Array.isArray(m.outcomes) ? m.outcomes : [])
          .map((o) => ({ name: o?.name ?? null, point: o?.point ?? null, odds: Number(o?.price) }))
          .filter((o) => o.name != null && Number.isFinite(o.odds))
      }
      byEvent[eventId] = { eventId, commence: res.data?.commence_time || null, markets }
    } catch (_) { /* per-event skip — never throw the slate */ }
  }
  return {
    enabled: true,
    byEvent,
    meta: { eventsTried, pinnacleEvents, euBooksSeen: [...euBooksSeen], note: "BENCHMARK ONLY — never bettable/displayed; game-line only (no props)" },
  }
}

/**
 * De-vig a Pinnacle two-way market → fair prob per outcome (sums to ~1.0). Reuses vigStripping.
 * @param {Array<{name,odds}>} twoWay exactly 2 outcomes
 * @returns {{ [outcomeName]: fairProb, vig } | null}
 */
function pinnacleFairProbs(twoWay) {
  if (!Array.isArray(twoWay) || twoWay.length !== 2) return null
  const [a, b] = twoWay
  const r = vig.stripVigTwoWay(a.odds, b.odds)   // { overFair, underFair, vig }
  if (!r) return null
  return { [a.name]: r.overFair, [b.name]: r.underFair, vig: r.vig }
}

/**
 * Sharp CLV for a placed GAME-LINE bet vs the Pinnacle de-vigged close.
 * Mirrors buildClv sign: positive = Pinnacle's fair prob for your side > your placed implied
 * ⇒ you beat the sharp close. Returns null when inputs missing (never fabricated).
 */
function computeSharpClv({ placedImpliedProb, pinnacleFairProb } = {}) {
  // Explicit null/undefined guard FIRST — Number(null)===0 passes Number.isFinite, which would
  // fabricate a CLV from a missing input. Anti-fabrication: missing → null, never a number.
  if (placedImpliedProb == null || pinnacleFairProb == null) return null
  const a = Number(placedImpliedProb), p = Number(pinnacleFairProb)
  if (!Number.isFinite(a) || !Number.isFinite(p)) return null
  return Math.round((p - a) * 10000) / 10000
}

/**
 * Build a benchmark lookup keyed by eventId|market|outcomeName|point → { fairProb, vig }.
 * For joining a placed game-line bet to its sharp reference. SEPARATE store — never the bettable rows.
 */
function buildBenchmarkLookup(pinnacleResult) {
  const out = new Map()
  const byEvent = pinnacleResult?.byEvent || {}
  for (const [eventId, ev] of Object.entries(byEvent)) {
    for (const [mkey, outs] of Object.entries(ev.markets || {})) {
      const fair = pinnacleFairProbs(outs)
      if (!fair) continue
      for (const o of outs) {
        const k = [eventId, mkey, _norm(o.name), o.point ?? ""].join("|")
        out.set(k, { fairProb: fair[o.name] ?? null, vig: fair.vig, odds: o.odds })
      }
    }
  }
  return out
}

module.exports = {
  _enabled: ENABLED,
  PINNACLE_KEY, GAME_LINE_MARKETS,
  isPinnacle, isBenchmarkOnlyBook,
  fetchPinnacleGameLines, pinnacleFairProbs, computeSharpClv, buildBenchmarkLookup,
}
