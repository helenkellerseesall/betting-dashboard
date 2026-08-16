"use strict"
/**
 * marketPrior.js — MARKET-PRIOR SHADOW v1 (2026-08-16, GO on the 8/15 ASK;
 * spec docs/specs/2026-08-16-market-prior-spec.md; hard-gate cleared by CA).
 *
 * p_final = w · p_market + (1 − w) · p_model — SHADOW COLUMN ONLY. Nothing
 * served changes until the three graduation bars pass and the operator flips
 * (its own mini-ASK). This module owns: de-vigged consensus p_market (median
 * of per-book fair probs — REPO CORRECTION #2 to the spec: sportsbookTopology
 * carries capability flags, NOT origination weights, so origination-weighting
 * is deferred until topology carries that data; median is the house consensus
 * pattern, cure column B precedent) · the shadow tap (append-only jsonl;
 * served picks NEVER mutated — byte-identical, fixture-pinned) · the
 * FORWARD-ONLY w fit (backward attempt THROWS) with committed history ·
 * the kill switch (MARKET_PRIOR_OFF=1 ⇒ tap disabled) · fail-open labels
 * ("model_only — no market consensus") everywhere p_market is unknowable.
 *
 * ERA-RULE PIN: p_market is EXOGENOUS. This module is imported by the serve
 * route ONLY — no pipeline/calibration module may require it (fixture-
 * enforced), and it writes only config/market_prior_w.json + the shadow
 * jsonl — never a calibration input.
 *
 * FIT-CORPUS HONESTY (spec correction #1, CA-verified): w seeds from graded
 * tracked_bets rows (modelProb + close/openImpliedProb + result). The fit's
 * market proxy is the CLOSE implied (vig-inclusive) — the shadow column logs
 * the true de-vigged p_market, and the §4 graduation Briers run on the shadow
 * column itself, never on this seed corpus.
 */
const fs = require("fs")
const path = require("path")
const { fairProbFromAmericanPair } = require("./vigStripping")

const BACKEND = path.join(__dirname, "..", "..")
const W_FILE = process.env.MARKET_PRIOR_W_PATH || path.join(BACKEND, "config", "market_prior_w.json")
const SHADOW_FILE = process.env.MARKET_PRIOR_SHADOW_PATH || path.join(BACKEND, "runtime", "tracking", "market_prior_shadow.jsonl")
const BOOKS = ["draftkings", "fanduel", "fanatics", "betmgm", "betrivers", "hardrockbet"]
const killed = () => process.env.MARKET_PRIOR_OFF === "1"

function bandOf(odds) { const o = Number(odds); if (!Number.isFinite(o)) return "unknown"; if (o <= -150) return "heavy_fav"; if (o < 0) return "fav"; if (o <= 200) return "plus_short"; if (o <= 500) return "plus_mid"; return "plus_long" }
function loadW() { try { return JSON.parse(fs.readFileSync(W_FILE, "utf8")) } catch (_) { return null } }
function wFor(family, band, wState) {
  const s = wState === undefined ? loadW() : wState
  const seg = s && s.current && s.current.byFamilyBand ? s.current.byFamilyBand[`${family}|${band}`] : null
  if (seg && Number.isFinite(seg.w)) return { w: seg.w, source: `fit ${s.current.asOf} (n=${seg.decided})` }
  return { w: 1, source: "no fit support — pure market (w=1), stamped per spec §2" }
}
function blend(pModel, pMarket, w) { return w * pMarket + (1 - w) * pModel }

/** De-vigged consensus for one served pick, via the ONE join authority the
 *  serve path already built (freshness ctx exactIx + matchKeyForBet). A side
 *  without over/under semantics gets NO market prob (SEV-1 seam: never guess). */
function marketProbForPick(pick, ctx, joins) {
  try {
    if (!ctx || !ctx.ok || !ctx.exactIx || typeof ctx.exactIx.get !== "function") return { p: null, reason: "no_context" }
    const side = String(pick.side || "").toLowerCase().trim()
    if (!(side === "over" || side === "under")) return { p: null, reason: "no_over_under_semantics" }
    const probs = []
    for (const book of BOOKS) {
      const q = (s) => ctx.exactIx.get(joins.matchKeyForBet({ player: pick.player, statFamily: pick.statFamily, side: s, line: pick.line, sportsbook: book }))
      const over = q("over"), under = q("under")
      const oOdds = over ? Number(over.oddsAmerican ?? over.odds) : NaN
      const uOdds = under ? Number(under.oddsAmerican ?? under.odds) : NaN
      if (Number.isFinite(oOdds) && Number.isFinite(uOdds)) {
        const p = fairProbFromAmericanPair(oOdds, uOdds, side)
        if (Number.isFinite(p)) probs.push(p)
      }
    }
    if (!probs.length) return { p: null, reason: "no_two_sided_pair" }
    probs.sort((a, b) => a - b)
    return { p: probs[Math.floor(probs.length / 2)], books: probs.length }
  } catch (e) { return { p: null, reason: String(e?.message || e) } }
}

/** The shadow tap. NEVER mutates picks; NEVER throws to the caller. */
function shadowTap(picks, ctx, joins, { slate } = {}) {
  if (killed()) return { logged: 0, killed: true }
  let logged = 0, modelOnly = 0
  try {
    const wState = loadW()
    const lines = []
    for (const pick of picks || []) {
      const pModel = Number(pick.modelProb)
      if (!Number.isFinite(pModel)) continue
      const fam = String(pick.statFamily || "?")
      const band = bandOf(pick.oddsAmerican ?? pick.odds)
      const m = marketProbForPick(pick, ctx, joins)
      const { w, source } = wFor(fam, band, wState)
      const pF = m.p != null ? blend(pModel, m.p, w) : pModel
      lines.push(JSON.stringify({ ts: new Date().toISOString(), slate: slate || null, player: pick.player, family: fam, side: pick.side ?? null, line: pick.line ?? null, odds: Number(pick.oddsAmerican ?? pick.odds), band, pModel: +pModel.toFixed(4), pMarket: m.p != null ? +m.p.toFixed(4) : null, books: m.books || 0, w, wSource: source, pFinal: +pF.toFixed(4), label: m.p != null ? "blended_shadow" : "model_only — no market consensus" }))
      if (m.p == null) modelOnly++
      logged++
    }
    if (lines.length) { fs.mkdirSync(path.dirname(SHADOW_FILE), { recursive: true }); fs.appendFileSync(SHADOW_FILE, lines.join("\n") + "\n") }
  } catch (_) { /* shadow must never block serving */ }
  return { logged, modelOnly }
}

/** FORWARD-ONLY w fit over graded tracked rows strictly BEFORE asOf.
 *  A backward asOf (earlier than the committed fit) THROWS — spec §2. */
function fitW({ asOf, trackingDir } = {}) {
  const dir = trackingDir || path.join(BACKEND, "runtime", "tracking")
  const asOfKey = String(asOf || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfKey)) throw new Error("fitW: asOf (YYYY-MM-DD) required")
  const prev = loadW()
  if (prev && prev.current && prev.current.asOf && asOfKey < prev.current.asOf) {
    throw new Error(`fitW REFUSED: backward fit (asOf ${asOfKey} < committed ${prev.current.asOf}) — forward-only by spec §2`)
  }
  const files = fs.readdirSync(dir).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).filter((f) => { const d = (f.match(/(\d{4}-\d{2}-\d{2})/) || [])[1]; return d && d < asOfKey })
  const seg = {}
  for (const f of files) {
    let rows; try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) } catch (_) { continue }
    for (const r of rows) {
      if (!["win", "loss"].includes(r.result)) continue
      const pm = Number(r.modelProb), pk = Number(r.closeImpliedProb ?? r.openImpliedProb)
      if (!Number.isFinite(pm) || !Number.isFinite(pk)) continue
      const k = `${r.statFamily}|${bandOf(r.oddsAmerican)}`
      ;(seg[k] = seg[k] || []).push({ pm, pk, y: r.result === "win" ? 1 : 0 })
    }
  }
  const byFamilyBand = {}
  for (const [k, rows] of Object.entries(seg)) {
    if (rows.length < 300) continue // below fit support ⇒ that segment runs w=1 pure-market, stamped
    let best = { w: 1, brier: Infinity }
    for (let w = 0; w <= 1.0001; w += 0.05) {
      let s = 0
      for (const r of rows) { const p = w * r.pk + (1 - w) * r.pm; s += (p - r.y) * (p - r.y) }
      const b = s / rows.length
      if (b < best.brier) best = { w: +w.toFixed(2), brier: +b.toFixed(6) }
    }
    byFamilyBand[k] = { w: best.w, brier: best.brier, decided: rows.length }
  }
  const entry = { asOf: asOfKey, fittedAt: new Date().toISOString(), byFamilyBand, decidedUsed: Object.values(seg).reduce((a, r) => a + r.length, 0), note: "forward-only grid min-Brier (w step 0.05) on graded tracked rows < asOf; market proxy = close implied (vig-in) — shadow column carries the true de-vigged p_market; segments <300 decided run w=1" }
  const state = { current: entry, history: [...((prev && prev.history) || []), entry].slice(-52) }
  fs.mkdirSync(path.dirname(W_FILE), { recursive: true })
  fs.writeFileSync(W_FILE, JSON.stringify(state, null, 1))
  return entry
}

if (require.main === module) {
  const { calendarDateForTimestamp } = require("./slateDate")
  const e = fitW({ asOf: calendarDateForTimestamp(Date.now()) })
  console.log(`marketPrior fitW [${e.asOf}]: ${Object.keys(e.byFamilyBand).length} segments fit from ${e.decidedUsed} graded rows`)
  for (const [k, v] of Object.entries(e.byFamilyBand)) console.log(`  ${k}: w=${v.w} (brier ${v.brier}, n=${v.decided})`)
}

module.exports = { bandOf, loadW, wFor, blend, marketProbForPick, shadowTap, fitW, W_FILE, SHADOW_FILE }
