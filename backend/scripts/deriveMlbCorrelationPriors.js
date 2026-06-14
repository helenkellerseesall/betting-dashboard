"use strict"
/**
 * deriveMlbCorrelationPriors.js — Phase T2-Correlation-1A (2026-06-14)
 *
 * Regenerates backend/config/mlbCorrelationPriors.json from the graded MLB
 * ledger. For each v1 structural leg-type pair it computes the empirical
 * (p_x, p_y, P(both)) over co-occurring SETTLED same-game pairs, then fits the
 * latent Gaussian-copula correlation ρ_Z via gaussianCopula.fitRhoZ so that
 * copulaJoint(p_x,p_y,ρ_Z) reproduces the historical P(both).
 *
 * NEVER fabricates: every ρ_Z traces to the ledger. Re-run as graded days accrue
 * to refine the priors. READ-ONLY on the ledger; writes only the config JSON.
 *
 *   node backend/scripts/deriveMlbCorrelationPriors.js          # writes config
 *   node backend/scripts/deriveMlbCorrelationPriors.js --dry    # print only
 */
const fs = require("fs"), path = require("path")
const { fitRhoZ } = require("../pipeline/shared/gaussianCopula")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const OUT = path.join(__dirname, "..", "config", "mlbCorrelationPriors.json")
const MIN_N = 150          // structural pools below this are excluded (too thin)
const PITCHER = new Set(["ks", "outs", "walks", "earnedRuns"])
const isPitcher = (f) => PITCHER.has(f)

// v1 structural classification — same logic as the discovery probe. Returns the
// canonical type key, or null for pairs outside v1 scope (over×over only).
function pairType(a, b) {
  if (a.side !== "over" || b.side !== "over") return null
  const ap = isPitcher(a.fam), bp = isPitcher(b.fam)
  if (ap !== bp) {
    const pitcher = ap ? a : b, hitter = ap ? b : a
    if (pitcher.fam === "ks" && !isPitcher(hitter.fam)) {
      const sameTeam = a.team && b.team && a.team === b.team
      return sameTeam ? null : "pitcherK_over__x__OPP_hitter_over"   // v1: opposing only (the trap)
    }
    return null
  }
  if (ap && bp) return null                                          // pitcher×pitcher out of v1 scope
  if (a.player === b.player) {
    return `SAMEhitter_over__${[a.fam, b.fam].sort().join("+")}`
  }
  const sameTeam = a.team && b.team && a.team === b.team
  return sameTeam ? "SAMEteam_2hitters_over_x_over" : null           // v1: same-team only (opp-hitters ~0)
}

function load() {
  const files = fs.readdirSync(TRACKING).filter(f => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const games = new Map()
  let settled = 0
  for (const f of files) {
    let a; try { const j = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")); a = Array.isArray(j) ? j : (j.entries || j.bets || Object.values(j)) } catch (_) { continue }
    for (const r of a) {
      if (!r || !r.player || !r.eventId) continue
      if (r.result !== "win" && r.result !== "loss") continue
      settled++
      const k = `${r.player}|${r.statFamily}|${r.side}|${r.line}`
      if (!games.has(r.eventId)) games.set(r.eventId, new Map())
      const g = games.get(r.eventId)
      if (!g.has(k)) g.set(k, { player: r.player, fam: r.statFamily, side: r.side, line: r.line, team: r.team, win: r.result === "win" ? 1 : 0 })
    }
  }
  return { files, games, settled }
}

const { files, games, settled } = load()
const agg = new Map()
for (const g of games.values()) {
  const legs = [...g.values()]
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const t = pairType(legs[i], legs[j]); if (!t) continue
    if (!agg.has(t)) agg.set(t, { n: 0, sx: 0, sy: 0, sboth: 0 })
    const o = agg.get(t); o.n++; o.sx += legs[i].win; o.sy += legs[j].win; o.sboth += (legs[i].win & legs[j].win)
  }
}

const phi = (px, py, pb) => { const d = Math.sqrt(px * (1 - px) * py * (1 - py)); return d === 0 ? 0 : (pb - px * py) / d }
const types = {}
for (const [t, o] of [...agg.entries()].sort((a, b) => b[1].n - a[1].n)) {
  if (o.n < MIN_N) continue
  const px = o.sx / o.n, py = o.sy / o.n, pBoth = o.sboth / o.n
  const rhoZ = Math.round(fitRhoZ(px, py, pBoth) * 1e4) / 1e4
  types[t] = { rhoZ, n: o.n, px: +px.toFixed(4), py: +py.toFixed(4), pBoth: +pBoth.toFixed(4), phi: +phi(px, py, pBoth).toFixed(4) }
}

const out = {
  _doc: "MLB same-game 2-leg correlation priors (Phase T2-Correlation-1A). rhoZ = latent Gaussian-copula correlation per STRUCTURAL leg-type pair, fit so copulaJoint(px,py,rhoZ)=pBoth on the graded ledger. CAVEAT: n counts co-occurring pairs (within-game clustered); effective independent sample ~= games below. rhoZ are PRIORS — sign is robust, magnitude is coarse — refine by re-running deriveMlbCorrelationPriors.js as graded days accrue. Consumed by backend/pipeline/mlb/mlbCorrelationEngine.js (SHADOW only; feeds nothing in scoring).",
  generatedAt: new Date().toISOString(),
  source: { ledgerFiles: files.length, settledLegs: settled, settledGames: games.size, minN: MIN_N },
  types,
}

if (process.argv.includes("--dry")) {
  console.log(JSON.stringify(out, null, 2))
} else {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8")
  console.log(`wrote ${OUT}`)
  console.log(`types: ${Object.keys(types).length} | ledger ${files.length} files / ${settled} settled legs / ${games.size} games`)
  for (const [t, v] of Object.entries(types)) console.log(`  ${t.padEnd(40)} rhoZ=${(v.rhoZ >= 0 ? "+" : "") + v.rhoZ}  n=${v.n}  phi=${v.phi}`)
}
