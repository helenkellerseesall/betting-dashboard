#!/usr/bin/env node
"use strict"

/**
 * validateG2Curves.js — G2-L2 WALK-FORWARD VALIDATOR (2026-07-16, approved scope).
 *
 * READ-ONLY over: season gamelog caches (fitting + realized outcomes),
 * mlb_ladders_* store (Axis B market rungs). ZERO live-surface touch — no
 * scoring, no serving, no tracked writes. Deterministic.
 *
 * AXIS A — tail calibration, walk-forward (no lookahead, ever):
 *   For each player/family, games date-ASC; for each target index t, fit on
 *   games[0..t) ONLY (same floors as production: batters n≥15, pitchers n≥8),
 *   predict the rung survival P(X ≥ k) for k = 1..supportCap, score against
 *   the REALIZED count of game t. Pairs pool into stated-probability buckets;
 *   the PASS bar (approved): every bucket with n≥150 decided must have
 *   |stated − realized| ≤ max(1.5pp, 20% relative). Reported: season-pooled
 *   AND a last-30-days slice (CA answer i).
 *
 * HALF-LIFE BAKE-OFF (CA answer iii): configs {10, 20, 40, none} scored on
 *   out-of-sample tail calibration — primary = n-weighted mean |gap| over
 *   buckets with n≥50 (pooled across families), tiebreak = pooled Brier.
 *   The winner is FROZEN as the v1 constant (written to the verdicts JSON;
 *   L3 consumes it — never re-chosen silently).
 *
 * PITCHER Ks (CA answer ii): rides at n≥8; if the family FAILS at n≥8, ONE
 *   higher-floor retest at n≥12 runs before any exclusion verdict.
 *
 * AXIS B — the market-ladder scoreboard: join fitted curves (fit on games
 *   STRICTLY BEFORE the ladder's game date, frozen half-life) to captured
 *   rung prices; on settled games record who was closer (Brier, us vs the
 *   implied price) wherever we disagree by >2pp; unsettled rungs stay PENDING,
 *   never guessed. Thin store = thin table, stated honestly — it accumulates
 *   3 passes/day.
 *
 * OUTPUT: docs/audits/<date>-g2-l2-validation.md (the committed report) +
 *   backend/runtime/calibration/g2_validation.json (machine verdicts for L3).
 */

const fs = require("fs")
const path = require("path")
const { fitPlayerFamilyCurve } = require("../pipeline/mlb/negBinomLadder")

const ROOT = path.join(__dirname, "..")
const DATA_DIR = process.env.G2_DATA_DIR || path.join(ROOT, "data")
const TRACKING_DIR = process.env.G2_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
// Verdicts live in backend/config (TRACKED — the G1 precedent: committed
// model-governance artifacts like mlbMarginalCalibration.json), NOT gitignored
// runtime/: the frozen constant + family eligibility must be reviewable and
// only change via a committed report.
const OUT_JSON = process.env.G2_OUT_JSON || path.join(ROOT, "config", "g2_validation.json")
const OUT_MD = process.env.G2_OUT_MD || path.join(ROOT, "..", "docs", "audits", `${new Date().toISOString().slice(0, 10)}-g2-l2-validation.md`)

const CONFIGS = [{ label: "hl10", halfLife: 10 }, { label: "hl20", halfLife: 20 }, { label: "hl40", halfLife: 40 }, { label: "none", halfLife: null }]
const BUCKETS = [[0, 0.02], [0.02, 0.05], [0.05, 0.10], [0.10, 0.20], [0.20, 0.35], [0.35, 0.50], [0.50, 1.001]]
const PASS_MIN_N = 150
const BAKEOFF_MIN_N = 50
const FAMILIES = [
  { family: "hits", kind: "batter", minN: 15 },
  { family: "totalBases", kind: "batter", minN: 15 },
  { family: "rbis", kind: "batter", minN: 15 },
  { family: "runs", kind: "batter", minN: 15 },
  { family: "ks", kind: "pitcher", minN: 8 },
]
const STAT_KEY = { hits: "hits", totalBases: "totalBases", rbis: "rbi", runs: "runs", ks: "strikeOuts" }
const VENDOR_FAM = { batter_hits_alternate: "hits", batter_total_bases_alternate: "totalBases", batter_rbis_alternate: "rbis", batter_runs_scored_alternate: "runs", pitcher_strikeouts_alternate: "ks" }

const rd = (fp) => { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }
const pct = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%")
const pp = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "pp")

function playerRows(cache, kind) {
  const out = []
  for (const p of Object.values(cache?.players || {})) {
    const games = (kind === "batter" ? p.games : p.starts) || []
    const rows = games
      .map((g) => ({ date: String(g?.date || ""), stats: g?.stats || {} }))
      .filter((g) => g.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    if (rows.length) out.push({ name: p.fullName, rows })
  }
  return out
}

function bucketIdx(p) { for (let i = 0; i < BUCKETS.length; i++) if (p >= BUCKETS[i][0] && p < BUCKETS[i][1]) return i; return BUCKETS.length - 1 }

/** Walk-forward pairs for one family/config. Returns {pairs, brierSum, n} with
 *  per-pair {p, hit, date} routed into season + last-30d bucket tables. */
function walkForward(players, family, minN, halfLife, last30Cut) {
  const season = BUCKETS.map(() => ({ n: 0, statedSum: 0, hits: 0 }))
  const recent = BUCKETS.map(() => ({ n: 0, statedSum: 0, hits: 0 }))
  let brierSum = 0
  let nPairs = 0
  const statKey = STAT_KEY[family]
  for (const pl of players) {
    const rows = pl.rows.filter((r) => Number.isFinite(Number(r.stats[statKey])))
    for (let t = minN; t < rows.length; t++) {
      const priorGames = rows.slice(0, t).map((r) => ({ date: r.date, stats: r.stats }))
      const curve = fitPlayerFamilyCurve(priorGames, family, { minN, halfLife })
      if (!curve) continue
      const realized = Number(rows[t].stats[statKey])
      for (const [rung, p] of Object.entries(curve.ladder)) {
        const k = Math.ceil(Number(rung))
        const hit = realized >= k ? 1 : 0
        const bi = bucketIdx(p)
        season[bi].n++; season[bi].statedSum += p; season[bi].hits += hit
        if (rows[t].date >= last30Cut) { recent[bi].n++; recent[bi].statedSum += p; recent[bi].hits += hit }
        brierSum += (p - hit) * (p - hit)
        nPairs++
      }
    }
  }
  return { season, recent, brierSum, nPairs }
}

function tableStats(buckets) {
  return buckets.map((b, i) => {
    const stated = b.n ? b.statedSum / b.n : null
    const realized = b.n ? b.hits / b.n : null
    const gap = b.n ? Math.abs(stated - realized) : null
    return { range: `${(BUCKETS[i][0] * 100).toFixed(0)}-${(Math.min(BUCKETS[i][1], 1) * 100).toFixed(0)}%`, n: b.n, stated, realized, gap }
  })
}

function verdictFor(rows) {
  const eligible = rows.filter((r) => r.n >= PASS_MIN_N)
  if (!eligible.length) return { verdict: "STOP", reason: "no bucket reaches n≥150 — insufficient sample, no verdict weight" }
  const failing = eligible.filter((r) => r.gap > Math.max(0.015, 0.20 * r.stated))
  return failing.length
    ? { verdict: "STOP", reason: `${failing.length} bucket(s) breach |gap| ≤ max(1.5pp, 20% rel): ${failing.map((f) => `${f.range} gap ${pp(f.gap)} n=${f.n}`).join("; ")}` }
    : { verdict: "PASS", reason: `all ${eligible.length} eligible buckets within the bar` }
}

function bakeoffScore(rows, brierSum, nPairs) {
  const el = rows.filter((r) => r.n >= BAKEOFF_MIN_N)
  const wGap = el.length ? el.reduce((a, r) => a + r.n * r.gap, 0) / el.reduce((a, r) => a + r.n, 0) : null
  return { wGap, brier: nPairs ? brierSum / nPairs : null }
}

// ── main ──
const batCache = rd(path.join(DATA_DIR, "mlbBatterGameLogsSeason.json"))
const pitCache = rd(path.join(DATA_DIR, "mlbPitcherGameLogsSeason.json"))
if (!batCache || !pitCache) { console.error("validateG2Curves: season caches missing — run the L1 populators first"); process.exit(1) }
const batters = playerRows(batCache, "batter")
const pitchers = playerRows(pitCache, "pitcher")
const allDates = [...batters, ...pitchers].flatMap((p) => p.rows.map((r) => r.date)).sort()
const maxDate = allDates[allDates.length - 1]
const last30Cut = new Date(Date.parse(maxDate) - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
console.log(`validateG2Curves — batters ${batters.length} · pitchers ${pitchers.length} · newest game ${maxDate} · last-30d cut ${last30Cut}`)

// AXIS A + bake-off
const perConfig = {}
for (const cfg of CONFIGS) {
  const famResults = {}
  let pooledGapNum = 0, pooledGapDen = 0, pooledBrierSum = 0, pooledPairs = 0
  for (const fam of FAMILIES) {
    const players = fam.kind === "batter" ? batters : pitchers
    const wf = walkForward(players, fam.family, fam.minN, cfg.halfLife, last30Cut)
    const rows = tableStats(wf.season)
    const score = bakeoffScore(rows, wf.brierSum, wf.nPairs)
    famResults[fam.family] = { rows, recentRows: tableStats(wf.recent), nPairs: wf.nPairs, score }
    if (score.wGap != null) {
      const w = rows.filter((r) => r.n >= BAKEOFF_MIN_N).reduce((a, r) => a + r.n, 0)
      pooledGapNum += score.wGap * w; pooledGapDen += w
    }
    pooledBrierSum += wf.brierSum; pooledPairs += wf.nPairs
  }
  perConfig[cfg.label] = { halfLife: cfg.halfLife, famResults, pooled: { wGap: pooledGapDen ? pooledGapNum / pooledGapDen : null, brier: pooledPairs ? pooledBrierSum / pooledPairs : null, nPairs: pooledPairs } }
  console.log(`  bake-off ${cfg.label.padEnd(5)} pooled |gap| ${pp(perConfig[cfg.label].pooled.wGap)} · Brier ${perConfig[cfg.label].pooled.brier?.toFixed(5)} · pairs ${pooledPairs}`)
}
const winner = Object.entries(perConfig).sort((a, b) => {
  const d = a[1].pooled.wGap - b[1].pooled.wGap
  return Math.abs(d) > 0.001 ? d : a[1].pooled.brier - b[1].pooled.brier
})[0]
const frozenLabel = winner[0]
const frozenHalfLife = winner[1].halfLife
console.log(`  WINNER (frozen v1 constant): ${frozenLabel} (halfLife=${frozenHalfLife})`)

// verdicts at the frozen config (+ pitcher higher-floor retest if needed)
const verdicts = {}
for (const fam of FAMILIES) {
  const res = perConfig[frozenLabel].famResults[fam.family]
  let v = verdictFor(res.rows)
  let retest = null
  if (fam.family === "ks" && v.verdict === "STOP") {
    const wf12 = walkForward(pitchers, "ks", 12, frozenHalfLife, last30Cut)
    const rows12 = tableStats(wf12.season)
    const v12 = verdictFor(rows12)
    retest = { minN: 12, verdict: v12.verdict, reason: v12.reason, nPairs: wf12.nPairs }
    if (v12.verdict === "PASS") v = { verdict: "PASS", reason: `n≥8 STOPPED (${v.reason}) but the CA-approved higher-floor retest at n≥12 PASSES (${v12.reason}) — ks curves require n≥12`, effectiveMinN: 12 }
    else v = { verdict: "STOP", reason: `n≥8 STOP (${v.reason}); retest n≥12 also STOP (${v12.reason})` }
  }
  verdicts[fam.family] = { ...v, nPairs: res.nPairs, retest }
  console.log(`  ${fam.family.padEnd(11)} ${v.verdict} — ${v.reason}`)
}

// AXIS B — market-ladder scoreboard (honest about thinness)
const ladderFiles = fs.existsSync(TRACKING_DIR) ? fs.readdirSync(TRACKING_DIR).filter((f) => /^mlb_ladders_\d{4}-\d{2}-\d{2}\.json$/.test(f)) : []
// 2026-07-21 INSTRUMENT-REPAIR — canonical cross-source join (playerNameJoin;
// the local norm missed suffix/diacritic/nickname classes, 10% of players).
const { buildJoinIndex: _bji, resolvePlayer: _rp } = require("../pipeline/shared/playerNameJoin")
const batIdx = _bji(Object.entries(batCache.players).map(([k, v]) => [v.fullName || k, { kind: "batter", rows: (v.games || []) }]))
const pitIdx = _bji(Object.entries(pitCache.players).map(([k, v]) => [v.fullName || k, { kind: "pitcher", rows: (v.starts || []) }]))
const axisB = { rungRows: 0, joinedCurves: 0, settled: 0, pending: 0, disagreements: 0, usBrier: 0, mktBrier: 0, files: ladderFiles.length }
for (const f of ladderFiles) {
  const store = rd(path.join(TRACKING_DIR, f))
  const gameDate = store?.gameDate
  const best = new Map() // player|family|line → best odds row
  for (const r of store?.rows || []) {
    const fam = VENDOR_FAM[r.family]
    if (!fam || String(r.side).toLowerCase() !== "over" || !Number.isFinite(Number(r.line))) continue
    axisB.rungRows++
    const key = `${norm(r.player)}|${fam}|${r.line}`
    const prev = best.get(key)
    if (!prev || Number(r.oddsAmerican) > Number(prev.oddsAmerican)) best.set(key, { ...r, fam })
  }
  for (const r of best.values()) {
    const idx = r.fam === "ks" ? pitIdx : batIdx
    const pl = _rp(idx, r.player)
    if (!pl) continue
    const prior = pl.rows.filter((g) => String(g.date) < String(gameDate)).map((g) => ({ date: g.date, stats: g.stats }))
    const minN = r.fam === "ks" ? (verdicts.ks?.effectiveMinN || 8) : 15
    const curve = fitPlayerFamilyCurve(prior, r.fam, { minN, halfLife: frozenHalfLife })
    if (!curve) continue
    const k = Math.ceil(Number(r.line))
    const pFair = curve.ladder[String(k - 0.5)]
    if (pFair == null) continue // beyond tail support — honestly unpriced by us
    axisB.joinedCurves++
    const odds = Number(r.oddsAmerican)
    const implied = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100)
    const target = pl.rows.find((g) => String(g.date) === String(gameDate))
    if (!target) { axisB.pending++; continue }
    axisB.settled++
    const hit = Number(target.stats[STAT_KEY[r.fam]]) >= k ? 1 : 0
    if (Math.abs(pFair - implied) > 0.02) {
      axisB.disagreements++
      axisB.usBrier += (pFair - hit) * (pFair - hit)
      axisB.mktBrier += (implied - hit) * (implied - hit)
    }
  }
}
console.log(`  Axis B: ${axisB.files} ladder file(s) · ${axisB.rungRows} rung rows · ${axisB.joinedCurves} curve-joined · settled ${axisB.settled} · pending ${axisB.pending} · disagreements scored ${axisB.disagreements}`)

// ── write outputs ──
const out = {
  generatedAt: new Date().toISOString(),
  version: "g2-l2-v1",
  frozenHalfLife, frozenLabel,
  bakeoff: Object.fromEntries(Object.entries(perConfig).map(([k, v]) => [k, v.pooled])),
  verdicts,
  // Per-family bucket tables at the frozen config — the L3 scanner's FLB
  // margin reads each bucket's measured |gap| as its calibration uncertainty
  // (margin = max(2pp, 1.5 × bucketGap)). Bucket bounds ride along so the
  // scanner never re-derives them.
  bucketBounds: BUCKETS,
  famTables: Object.fromEntries(FAMILIES.map((f) => [f.family, perConfig[frozenLabel].famResults[f.family].rows])),
  axisB,
  bars: { passMinN: PASS_MIN_N, gapBar: "max(1.5pp, 20% relative)", bakeoffMinN: BAKEOFF_MIN_N, flbDisagreement: "2pp" },
}
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2))

let md = `# G2-L2 Walk-Forward Validation Report — ${new Date().toISOString().slice(0, 10)}\n\n`
md += `Read-only over season gamelog caches (${batters.length} batters, ${pitchers.length} pitchers, newest game ${maxDate}) + ${axisB.files} captured ladder file(s). No lookahead: every prediction fit on strictly-prior games at production floors.\n\n`
md += `## Half-life bake-off (out-of-sample tail calibration)\n\n| config | pooled n-weighted \\|gap\\| | pooled Brier | pairs |\n|---|---|---|---|\n`
for (const [k, v] of Object.entries(perConfig)) md += `| ${k}${k === frozenLabel ? " **← FROZEN v1**" : ""} | ${pp(v.pooled.wGap)} | ${v.pooled.brier?.toFixed(5)} | ${v.pooled.nPairs} |\n`
md += `\n**Frozen v1 constant: halfLife = ${frozenHalfLife === null ? "none (unweighted)" : frozenHalfLife}** — chosen on measured out-of-sample calibration, not assumption (CA answer iii).\n\n`
md += `## Per-family verdicts (at the frozen config)\n\nPASS bar: every bucket with n≥${PASS_MIN_N} must have |stated−realized| ≤ max(1.5pp, 20% relative).\n\n`
for (const fam of FAMILIES) {
  const res = perConfig[frozenLabel].famResults[fam.family]
  const v = verdicts[fam.family]
  md += `### ${fam.family} — **${v.verdict}** (${res.nPairs} walk-forward pairs)\n${v.reason}\n\n`
  md += `| stated bucket | n | stated | realized | gap | in verdict |\n|---|---|---|---|---|---|\n`
  for (const r of res.rows) md += `| ${r.range} | ${r.n} | ${pct(r.stated)} | ${pct(r.realized)} | ${pp(r.gap)} | ${r.n >= PASS_MIN_N ? "yes" : "thin"} |\n`
  const rec = res.recentRows.filter((r) => r.n > 0)
  md += `\nLast-30d slice (reporting only): ${rec.map((r) => `${r.range} n=${r.n} gap ${pp(r.gap)}`).join(" · ") || "no pairs"}\n\n`
  if (v.retest) md += `Pitcher higher-floor retest (n≥12): **${v.retest.verdict}** — ${v.retest.reason}\n\n`
}
md += `## Axis B — market-ladder scoreboard\n\n${axisB.rungRows} captured rung rows across ${axisB.files} file(s) → ${axisB.joinedCurves} joined to curves · **${axisB.settled} settled / ${axisB.pending} pending** · ${axisB.disagreements} disagreements scored${axisB.disagreements ? ` (our Brier ${(axisB.usBrier / axisB.disagreements).toFixed(4)} vs market ${(axisB.mktBrier / axisB.disagreements).toFixed(4)})` : ""}.\n\n${axisB.settled === 0 ? "HONEST STATUS: the ladder store is night-one thin — no settled rungs yet. The scoreboard is SEEDED and accumulates 3 passes/day; it becomes decision-grade with settled volume, and the L3 gate already requires it." : ""}\n\n`
md += `## Honest caveats\n\n- Axis A validates curves against the same gamelog source they fit from (different games — strictly prior fitting — but shared measurement); Axis B is the external check and is thin until the store accumulates.\n- Bake-off + verdicts recompute nightly-safe: deterministic over on-disk caches; the frozen half-life changes ONLY via a new committed report.\n- HR is not curve-fit in v1 (approved); pitcher outs excluded v1 (43pp engine-level miscalibration).\n`
fs.mkdirSync(path.dirname(OUT_MD), { recursive: true })
fs.writeFileSync(OUT_MD, md)
console.log(`wrote ${OUT_MD} + ${OUT_JSON}`)
