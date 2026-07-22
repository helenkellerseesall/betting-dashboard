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

// ═══════════════════════════════════════════════════════════════════════════
// 2026-07-21 G3-L2 — structural-class fit + PASS-or-STOP validation (--g3).
// Law 1: EXTENDS this sanctioned derive script; without --g3 the legacy path
// below runs byte-identical and mlbCorrelationPriors.json semantics are
// untouched (the live shadow engine's input does NOT change here — engine
// re-pointing is a later, gated graduation step).
//
// Reads the L1 pair corpus (mlb_pair_corpus.jsonl — full history, era-free
// outcomes per CA answer i). WALK-FORWARD: chronological slate split (first
// 2/3 train, last 1/3 held-out test — no lookahead). Per class: fit ρ_Z on
// TRAIN pooled (px, py, pBoth) via the canonical fitRhoZ; validate on TEST
// with PER-PAIR marginals (served modelProb when finite, else the train-class
// empirical — hierarchy documented in the report) against the NAMED BARS:
//   n_test ≥ 500 · pooled |predicted−realized| joint gap ≤ 2pp ·
//   Brier(copula) ≤ Brier(independence) · cross_game additionally |ρ| < 0.05
//   to be CERTIFIED_INDEPENDENT (independence is proven, never assumed).
// ERA SLICE: ρ re-fit pre/post 2026-07-01 reported (stability, not a filter).
// Outputs: backend/config/g3_correlation_validation.json (committed verdicts)
//        + docs/audits/<date>-g3-l2-correlation-validation.md.
// ═══════════════════════════════════════════════════════════════════════════
const G3 = process.argv.includes("--g3")
if (G3) {
  const { copulaJoint } = require("../pipeline/shared/gaussianCopula")
  const CORPUS = process.env.G3_PAIR_OUT || path.join(TRACKING, "mlb_pair_corpus.jsonl")
  const OUT_VAL = process.env.G3_VAL_OUT || path.join(__dirname, "..", "config", "g3_correlation_validation.json")
  const OUT_MD = process.env.G3_VAL_MD || path.join(__dirname, "..", "..", "docs", "audits", `${new Date().toISOString().slice(0, 10)}-g3-l2-correlation-validation.md`)
  const FLIP = "2026-07-01"
  const BARS = { minTestN: 500, jointGapPp: 2.0, indepRhoAbs: 0.05 }

  const lines = fs.readFileSync(CORPUS, "utf8").split("\n").filter(Boolean)
  const slateSet = new Set()
  for (const l of lines) { const i = l.indexOf('"slate":"'); if (i > 0) slateSet.add(l.slice(i + 9, i + 19)) }
  const slates = [...slateSet].sort()
  const splitIdx = Math.floor(slates.length * 2 / 3)
  const trainSlates = new Set(slates.slice(0, splitIdx))
  console.log(`G3-L2: ${lines.length} pairs · ${slates.length} slates · train ${splitIdx} / test ${slates.length - splitIdx} (chronological, no lookahead)`)

  // pass 1: per-class pooled stats (train) + era fits + test pair lists
  const cls = {}
  const get = (c) => cls[c] || (cls[c] = { train: { n: 0, sx: 0, sy: 0, sb: 0 }, pre: { n: 0, sx: 0, sy: 0, sb: 0 }, post: { n: 0, sx: 0, sy: 0, sb: 0 }, test: [] })
  for (const l of lines) {
    let r; try { r = JSON.parse(l) } catch (_) { continue }
    const wa = r.a.w, wb = r.b.w
    const era = r.slate < FLIP ? "pre" : "post"
    // 2026-07-21 FAMILY-PAIR REFINEMENT (approved): same_player pairs ALSO
    // accumulate into sub-classes keyed by the sorted family pair — the
    // pooled class STOPPED on marginal heterogeneity (ρ=+0.450 real but too
    // coarse); each sub-class faces the SAME bars independently. hits×TB is
    // NESTED (TB contains hits) — flagged in output as mechanical overlap.
    const clsKeys = [r.cls]
    if (r.cls === "same_player_multi_family") clsKeys.push(`same_player__${[r.a.f, r.b.f].sort().join("x")}`)
    for (const ck of clsKeys) {
      const o = get(ck)
      o[era].n++; o[era].sx += wa; o[era].sy += wb; o[era].sb += (wa & wb)
      if (trainSlates.has(r.slate)) { o.train.n++; o.train.sx += wa; o.train.sy += wb; o.train.sb += (wa & wb) }
      else o.test.push({ pa: Number.isFinite(r.a.mp) && r.a.mp > 0 && r.a.mp < 1 ? r.a.mp : null, pb: Number.isFinite(r.b.mp) && r.b.mp > 0 && r.b.mp < 1 ? r.b.mp : null, wa, wb })
    }
  }

  const fitPool = (o) => { if (o.n < 50) return null; const px = o.sx / o.n, py = o.sy / o.n, pb = o.sb / o.n; return { n: o.n, px, py, pb, rhoZ: fitRhoZ(px, py, pb) } }
  const results = {}
  for (const [c, o] of Object.entries(cls)) {
    const train = fitPool(o.train)
    const pre = fitPool(o.pre)
    const post = fitPool(o.post)
    if (!train) { results[c] = { verdict: "STOP", reason: `train pool too thin (${o.train.n})` }; continue }
    const rho = train.rhoZ
    let sq = 0, sq0 = 0, sPred = 0, sReal = 0, nT = 0, mpUsed = 0
    for (const t of o.test) {
      const pa = t.pa ?? train.px, pb2 = t.pb ?? train.py
      if (t.pa != null && t.pb != null) mpUsed++
      const q = copulaJoint(pa, pb2, rho)
      const q0 = pa * pb2
      const both = t.wa & t.wb
      sq += (both - q) * (both - q); sq0 += (both - q0) * (both - q0)
      sPred += q; sReal += both; nT++
    }
    const gap = nT ? Math.abs(sPred / nT - sReal / nT) : null
    const brierCop = nT ? sq / nT : null
    const brierInd = nT ? sq0 / nT : null
    const bars = {
      n: nT >= BARS.minTestN,
      gap: gap != null && gap <= BARS.jointGapPp / 100,
      // Brier bar applies to CORRELATED classes (the copula must EARN its ρ).
      // For cross_game the comparison is DEGENERATE: at certified ρ≈0 the
      // copula ≡ the product, so float noise decides (measured: failed by
      // 2e-6). Independence certification = |ρ| < 0.05 AND gap AND n.
      ...(c === "cross_game" ? { indep: Math.abs(rho) < BARS.indepRhoAbs } : { brier: brierCop != null && brierCop <= brierInd + 1e-9 }),
    }
    const passed = Object.values(bars).every(Boolean)
    results[c] = {
      verdict: c === "cross_game" ? (passed ? "CERTIFIED_INDEPENDENT" : "STOP") : (passed ? "PASS" : "STOP"),
      rhoZ: +rho.toFixed(4), trainN: train.n, testN: nT, mpCoveragePct: nT ? +(100 * mpUsed / nT).toFixed(1) : null,
      jointGapPp: gap != null ? +(gap * 100).toFixed(2) : null,
      brierCopula: brierCop != null ? +brierCop.toFixed(6) : null,
      brierIndep: brierInd != null ? +brierInd.toFixed(6) : null,
      bars,
      era: { preRho: pre ? +pre.rhoZ.toFixed(4) : null, postRho: post ? +post.rhoZ.toFixed(4) : null, deltaRho: pre && post ? +(post.rhoZ - pre.rhoZ).toFixed(4) : null },
      ...(c === "same_player__hitsxtotalBases" ? { nested: "MECHANICAL OVERLAP — totalBases contains hits; dependence here is partly definitional, not run-environment" } : {}),
      reason: passed ? "all bars clear" : `failed: ${Object.entries(bars).filter(([, v]) => !v).map(([k]) => k).join(", ")}`,
    }
    console.log(`  ${c.padEnd(26)} ${results[c].verdict.padEnd(22)} ρ=${(rho >= 0 ? "+" : "") + rho.toFixed(3)} test n=${nT} gap=${results[c].jointGapPp}pp Brier cop/ind=${results[c].brierCopula}/${results[c].brierIndep} eraΔρ=${results[c].era.deltaRho}`)
  }

  const val = {
    generatedAt: new Date().toISOString(), version: "g3-l2-v1",
    method: "walk-forward chronological slate split 2/3-1/3; class rhoZ via canonical fitRhoZ on train pooled (px,py,pBoth); per-pair test marginals = served modelProb when finite in (0,1) else train-class empirical; copulaJoint via the sanctioned gaussianCopula.",
    bars: BARS, flipDay: FLIP, corpus: { pairs: lines.length, slates: slates.length, trainSlates: splitIdx },
    results,
    _doc: "G3-L2 committed verdicts. Consumers (L3 cure columns, L4 parlay pricer) may use ONLY classes with verdict PASS; cross-game parlay math requires CERTIFIED_INDEPENDENT. Engine re-pointing at these fits is a separate gated graduation step; mlbCorrelationPriors.json (the live shadow input) is UNCHANGED by this run.",
  }
  fs.writeFileSync(OUT_VAL, JSON.stringify(val, null, 2) + "\n")
  let md = `# G3-L2 Correlation Validation — ${new Date().toISOString().slice(0, 10)}\n\nWalk-forward (no lookahead): ${splitIdx} train / ${slates.length - splitIdx} held-out slates · ${lines.length} pairs. Bars: n≥${BARS.minTestN} · joint gap ≤${BARS.jointGapPp}pp · copula Brier ≤ independence · cross-game |ρ|<${BARS.indepRhoAbs} for certification. Era slice = report, not filter.\n\n| class | verdict | ρ_Z | test n | gap | Brier cop/ind | era Δρ | mp coverage |\n|---|---|---|---|---|---|---|---|\n`
  for (const [c, r] of Object.entries(results)) md += `| ${c} | **${r.verdict}** | ${r.rhoZ ?? "—"} | ${r.testN ?? "—"} | ${r.jointGapPp ?? "—"}pp | ${r.brierCopula ?? "—"}/${r.brierIndep ?? "—"} | ${r.era?.deltaRho ?? "—"} | ${r.mpCoveragePct ?? "—"}% |\n`
  md += `\nSTOP classes are ABSENT from every consumer until a re-run passes. The live shadow priors file is untouched by this validation.\n`
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true })
  fs.writeFileSync(OUT_MD, md)
  console.log(`wrote ${OUT_VAL} + ${OUT_MD}`)
  process.exit(0)
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
