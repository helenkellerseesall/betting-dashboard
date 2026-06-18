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
    byEvent: attachFairProbs(byEvent),   // PERSIST de-vigged fairProb + per-market vig so the FILE is the benchmark
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
 * Decorate a raw byEvent map with the de-vigged fairProb on EACH outcome + per-market vig +
 * fairSumsTo, so the persisted sidecar IS the benchmark (not just raw odds). Pure/deterministic;
 * idempotent (accepts raw arrays or already-decorated {outcomes}). De-vig via canonical
 * vigStripping (multiplicative, Law 1 — NOT a parallel method). Two-way markets only get fairProb;
 * non-two-way markets keep null fairProb (anti-fabrication, never guessed).
 */
function attachFairProbs(byEvent) {
  const out = {}
  for (const [eventId, ev] of Object.entries(byEvent || {})) {
    const markets = {}
    for (const [mkey, raw] of Object.entries(ev.markets || {})) {
      const outs = Array.isArray(raw) ? raw : (raw?.outcomes || [])
      const fair = pinnacleFairProbs(outs)   // { [name]: fair, vig } | null (two-way only)
      const outcomes = outs.map((o) => ({ ...o, fairProb: fair ? (fair[o.name] ?? null) : null }))
      const fairSumsTo = fair
        ? Math.round(outcomes.reduce((s, o) => s + (Number.isFinite(o.fairProb) ? o.fairProb : 0), 0) * 1e6) / 1e6
        : null
      markets[mkey] = { outcomes, vig: fair ? fair.vig : null, fairSumsTo }
    }
    out[eventId] = Object.assign({}, ev, { markets })
  }
  return out
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
 * Build a benchmark lookup keyed by eventId|market|outcomeName|point → { fairProb, vig, odds }.
 * For joining a placed game-line bet to its sharp reference. SEPARATE store — never the bettable rows.
 * Reads the PERSISTED fairProb (post-attachFairProbs); falls back to computing if given raw arrays.
 */
function buildBenchmarkLookup(pinnacleResult) {
  const out = new Map()
  const byEvent = pinnacleResult?.byEvent || {}
  for (const [eventId, ev] of Object.entries(byEvent)) {
    for (const [mkey, raw] of Object.entries(ev.markets || {})) {
      const outs = Array.isArray(raw) ? raw : (raw?.outcomes || [])
      const marketVig = Array.isArray(raw) ? null : (raw?.vig ?? null)
      // Prefer persisted fairProb; if absent (raw arrays), compute via canonical de-vig.
      const hasPersisted = outs.some((o) => o.fairProb != null)
      const computed = hasPersisted ? null : pinnacleFairProbs(outs)
      if (!hasPersisted && !computed) continue
      for (const o of outs) {
        const fp = hasPersisted ? (o.fairProb ?? null) : (computed[o.name] ?? null)
        const vg = hasPersisted ? marketVig : computed.vig
        const k = [eventId, mkey, _norm(o.name), o.point ?? ""].join("|")
        out.set(k, { fairProb: fp, vig: vg, odds: o.odds })
      }
    }
  }
  return out
}

module.exports = {
  _enabled: ENABLED,
  PINNACLE_KEY, GAME_LINE_MARKETS,
  isPinnacle, isBenchmarkOnlyBook,
  fetchPinnacleGameLines, pinnacleFairProbs, attachFairProbs, computeSharpClv, buildBenchmarkLookup,
}

// ── Inline self-test (one-command proof): `node backend/pipeline/shared/pinnacleBenchmark.js` ──
// Mirrors cashoutHedge.js. De-vig = canonical MULTIPLICATIVE vigStripping (Law 1 — NOT Power);
// that is why -150/+130 → .5798/.4202 here (the Power .584/.416 lives in devigAnalytics.js).
if (require.main === module) {
  const approx = (a, b, t = 1e-3) => Math.abs(a - b) <= t
  const T = []; const c = (l, x) => T.push([l, x])
  const f1 = pinnacleFairProbs([{ name: "Over", odds: -110 }, { name: "Under", odds: -110 }])
  c("-110/-110 → .500/.500", approx(f1.Over, 0.5) && approx(f1.Under, 0.5))
  c("-110/-110 sums = 1.0", approx(f1.Over + f1.Under, 1, 1e-9))
  const f2 = pinnacleFairProbs([{ name: "Home", odds: -150 }, { name: "Away", odds: 130 }])
  c("-150/+130 (multiplicative) → .5798/.4202", approx(f2.Home, 0.5798) && approx(f2.Away, 0.4202))
  c("-150/+130 sums = 1.0", approx(f2.Home + f2.Away, 1, 1e-9))
  c("sharpClv +: placed .55 vs sharp .58 > 0", computeSharpClv({ placedImpliedProb: 0.55, pinnacleFairProb: 0.58 }) > 0)
  c("sharpClv −: placed .60 vs sharp .55 < 0", computeSharpClv({ placedImpliedProb: 0.60, pinnacleFairProb: 0.55 }) < 0)
  c("sharpClv null guard (missing input → null)", computeSharpClv({ placedImpliedProb: null, pinnacleFairProb: 0.55 }) === null)
  // PERSISTENCE: attachFairProbs writes fairProb on every outcome + per-market vig + fairSumsTo
  const raw = { E1: { eventId: "E1", markets: {
    h2h: [{ name: "Home", odds: -150 }, { name: "Away", odds: 130 }],
    totals: [{ name: "Over", point: 8.5, odds: -110 }, { name: "Under", point: 8.5, odds: -110 }],
  } } }
  const dec = attachFairProbs(raw)
  c("attachFairProbs persists fairProb on each h2h outcome", dec.E1.markets.h2h.outcomes.every((o) => o.fairProb != null))
  c("h2h fairSumsTo = 1.0 (persisted)", approx(dec.E1.markets.h2h.fairSumsTo, 1, 1e-6))
  c("totals fairSumsTo = 1.0 (persisted)", approx(dec.E1.markets.totals.fairSumsTo, 1, 1e-6))
  c("per-market vig persisted (h2h vig > 0)", dec.E1.markets.h2h.vig > 0)
  c("lookup reads persisted fairProb", buildBenchmarkLookup({ byEvent: dec }).get("E1|h2h|home|").fairProb != null)
  let ok = 0; for (const [l, x] of T) { console.log((x ? "PASS" : "FAIL") + " — " + l); if (x) ok++ }
  console.log(`pinnacleBenchmark self-test: ${ok}/${T.length}`)
  console.log("NOTE: BENCHMARK-only sidecar — NOT wired into live picks/CLV/line-shop/allowlist (post-freeze wiring by design).")
  process.exit(ok === T.length ? 0 : 1)
}
