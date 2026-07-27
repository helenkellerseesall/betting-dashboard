#!/usr/bin/env node
"use strict"

/**
 * nightlyCritic.js — THE NIGHTLY CRITIC ENGINE (2026-07-26, approved design).
 * READ-ONLY over graded slates. The board's adversary: what did the gates cost?
 *
 * (a) MISSED WINNERS w/ DROP-REASON: winning record rows that the serving lens
 *     would have dropped, attributed to the FIRST static gate that drops them
 *     (fade_tier / non_preferred_book / unpurchasable_under / dampened_edge /
 *     dedupe_lost_to_better_price). Timing gates (started-game at serve time)
 *     are not retro-knowable — rows passing all static gates are labeled
 *     served_or_timing, never guessed into a bucket.
 * (b) CEILING AUDIT: realized outcomes vs curve tail support — the share of
 *     outcomes EXCEEDING the fitted 95th-percentile rung (bar: ≤7% = healthy
 *     tails; >7% = curves clip reality).
 * (c) SHOWN-vs-POOL: flat-$1 units + win rate of the static-pass set vs the
 *     full record pool (labeled approximation — serve timing not replayable).
 * (d) WEEKLY SYNTHESIS (--weekly): 7-day plain-English "money left on the
 *     table, and which gate left it there" → committed docs/audits report.
 *
 * Artifacts: runtime/tracking/critic_<slate>.json nightly · weekly md.
 * Day-one alarm: criticNightly in componentHealthCheck. Zero writes to
 * scoring/serving/record files.
 */

const fs = require("fs")
const path = require("path")
const { fitPlayerFamilyCurve } = require("../pipeline/mlb/negBinomLadder")
const { buildJoinIndex, resolvePlayer } = require("../pipeline/shared/playerNameJoin")
const { formatFor } = require("../pipeline/shared/bookMarketFormats")
const { slateDateForTimestamp, currentSlateDateEt } = require("../pipeline/shared/slateDate")

const ROOT = path.join(__dirname, "..")
const TRACKING = process.env.CRITIC_TRACKING_DIR || path.join(ROOT, "runtime", "tracking")
const DATA_DIR = process.env.CRITIC_DATA_DIR || path.join(ROOT, "data")
const PREFERRED = new Set(["draftkings", "fanduel", "fanatics", "betmgm"])
const rd = (fp) => { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }
const normB = (s) => String(s || "").toLowerCase().replace(/\s+/g, "")
const unitsOf = (r) => (r.result === "win" ? (Number(r.oddsAmerican) > 0 ? Number(r.oddsAmerican) / 100 : 100 / Math.abs(Number(r.oddsAmerican))) : -1)

function dropReason(r, bestOddsByTuple, sellableTuples) {
  const tier = String(r.tier || r.modelTier || "").toUpperCase()
  if (tier === "FADE" || tier === "LONGSHOT") return "fade_tier"
  if (!PREFERRED.has(normB(r.sportsbook || r.book))) return "non_preferred_book"
  if (String(r.side || "").toLowerCase().startsWith("u")) {
    const fmt = formatFor(r.sportsbook || r.book, r.statFamily)
    // RE-POINT PASS 2 aware: if a VERIFIED-sellable row exists for this tuple,
    // the lens now re-points it — count as repointed_served, not missed.
    if (fmt && fmt.sides === "over_only") {
      const key = `${String(r.player).toLowerCase()}|${r.statFamily}|${r.side}|${r.line}`
      return sellableTuples && sellableTuples.has(key) ? "repointed_served" : "unpurchasable_under"
    }
  }
  if (r.modelProbRaw != null && Number(r.edge) < -0.10) return "dampened_edge"
  const key = `${String(r.player).toLowerCase()}|${r.statFamily}|${r.side}|${r.line}`
  if (bestOddsByTuple.get(key) > Number(r.oddsAmerican)) return "dedupe_lost_to_better_price"
  return "served_or_timing"
}

function criticSlate(slate) {
  const rows = rd(path.join(TRACKING, `mlb_tracked_bets_${slate}.json`)) || []
  const decided = rows.filter((r) => ["win", "loss"].includes(r.result))
  if (!decided.length) return null
  const bestOddsByTuple = new Map()
  const sellableTuples = new Set()
  for (const r of decided) {
    const key = `${String(r.player).toLowerCase()}|${r.statFamily}|${r.side}|${r.line}`
    if (!bestOddsByTuple.has(key) || Number(r.oddsAmerican) > bestOddsByTuple.get(key)) bestOddsByTuple.set(key, Number(r.oddsAmerican))
    const fmt = formatFor(r.sportsbook || r.book, r.statFamily)
    if (fmt && fmt.sides === "two_sided") sellableTuples.add(key)
  }
  // (a) missed winners
  const missed = {}
  let missedUnits = 0
  const samples = []
  for (const r of decided.filter((x) => x.result === "win")) {
    const reason = dropReason(r, bestOddsByTuple, sellableTuples)
    if (reason === "served_or_timing") continue
    missed[reason] = (missed[reason] || 0) + 1
    missedUnits += unitsOf(r)
    if (samples.length < 5) samples.push(`${r.player} ${r.side} ${r.line} ${r.statFamily} @ ${r.sportsbook} ${Number(r.oddsAmerican) > 0 ? "+" : ""}${r.oddsAmerican} [${reason}]`)
  }
  // (b) ceiling audit — realized vs curve 95th pct (curves fit strictly prior)
  const bat = rd(path.join(DATA_DIR, "mlbBatterGameLogsSeason.json"))
  const batIdx = bat ? buildJoinIndex(Object.entries(bat.players).map(([k, v]) => [v.fullName || k, (v.games || []).map((g) => ({ date: String(g.date), stats: g.stats }))])) : null
  let tailN = 0, tailExceed = 0
  const FAMS = { hits: "hits", totalBases: "totalBases", rbis: "rbi", runs: "runs" }
  const seen = new Set()
  for (const r of decided) {
    const sk = FAMS[r.statFamily]
    if (!sk || !batIdx) continue
    const pk = `${String(r.player).toLowerCase()}|${r.statFamily}`
    if (seen.has(pk)) continue
    seen.add(pk)
    const logs = resolvePlayer(batIdx, r.player)
    const gameRow = logs?.find((g) => g.date === slate)
    if (!gameRow) continue
    const prior = logs.filter((g) => g.date < slate)
    const curve = fitPlayerFamilyCurve(prior, r.statFamily, { minN: 15, halfLife: null })
    if (!curve) continue
    // 95th-pct rung = smallest k with P(≥k) < 0.05
    let k95 = curve.supportCap
    for (const [rung, p] of Object.entries(curve.ladder)) { if (p < 0.05) { k95 = Math.ceil(Number(rung)); break } }
    tailN++
    if (Number(gameRow.stats[sk]) >= k95) tailExceed++
  }
  // (c) shown vs pool
  const shownApprox = decided.filter((r) => dropReason(r, bestOddsByTuple, sellableTuples) === "served_or_timing")
  const agg = (set) => { let u = 0, w = 0; for (const r of set) { u += unitsOf(r); if (r.result === "win") w++ } return { n: set.length, units: +u.toFixed(1), winRate: set.length ? +(100 * w / set.length).toFixed(1) : null } }
  return {
    slate, generatedAt: new Date().toISOString(), readOnly: true,
    missedWinners: { byReason: missed, unitsAtFlat$1: +missedUnits.toFixed(1), samples, note: "static-gate replay; serve timing not retro-knowable — served_or_timing rows excluded, never guessed" },
    ceilingAudit: { checked: tailN, exceeded95th: tailExceed, ratePct: tailN ? +(100 * tailExceed / tailN).toFixed(1) : null, bar: "≤7% healthy (unconditional 95th-pct exceedance ≈5%)" },
    shownVsPool: { shownApprox: agg(shownApprox), pool: agg(decided) },
  }
}

// ── main ──
const today = currentSlateDateEt()
const args = process.argv.slice(2)
if (args.includes("--weekly")) {
  const reports = []
  for (let i = 1; i <= 7; i++) {
    const d = slateDateForTimestamp(Date.now() - i * 86400000)
    const r = rd(path.join(TRACKING, `critic_${d}.json`)) || criticSlate(d)
    if (r) reports.push(r)
  }
  const byReason = {}
  let units = 0
  for (const r of reports) { units += r.missedWinners.unitsAtFlat$1; for (const [k, v] of Object.entries(r.missedWinners.byReason)) byReason[k] = (byReason[k] || 0) + v }
  const tails = reports.reduce((a, r) => ({ n: a.n + r.ceilingAudit.checked, x: a.x + r.ceilingAudit.exceeded95th }), { n: 0, x: 0 })
  const md = `# Weekly Critic — ${today}\n\nMONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **${units >= 0 ? "+" : ""}${units.toFixed(1)}u of winning rows never reached the served board.**\n\n| gate | winners dropped |\n|---|---|\n${Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}\n\nCeiling audit: ${tails.x}/${tails.n} outcomes (${tails.n ? (100 * tails.x / tails.n).toFixed(1) : "—"}%) exceeded the curves' 95th percentile — bar ≤7%.\n\nShown-vs-pool per night: ${reports.map((r) => `${r.slate}: shown ${r.shownVsPool.shownApprox.units}u/${r.shownVsPool.shownApprox.n} vs pool ${r.shownVsPool.pool.units}u/${r.shownVsPool.pool.n}`).join(" · ")}\n\nHONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.\n`
  const out = path.join(ROOT, "..", "docs", "audits", `weekly-critic-${today}.md`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, md)
  console.log(`weekly critic → ${out} (${reports.length} nights · ${units.toFixed(1)}u missed-winner volume)`)
} else {
  const slate = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || slateDateForTimestamp(Date.now() - 86400000)
  const r = criticSlate(slate)
  if (!r) { console.log(`nightlyCritic: no decided rows for ${slate} — honest no-op`); process.exit(0) }
  const fp = path.join(TRACKING, `critic_${slate}.json`)
  fs.writeFileSync(`${fp}.tmp.${process.pid}`, JSON.stringify(r, null, 2)); fs.renameSync(`${fp}.tmp.${process.pid}`, fp)
  console.log(`nightlyCritic [${slate}]: missed winners ${JSON.stringify(r.missedWinners.byReason)} worth ${r.missedWinners.unitsAtFlat$1}u · ceiling ${r.ceilingAudit.exceeded95th}/${r.ceilingAudit.checked} (${r.ceilingAudit.ratePct}%) · shown ${r.shownVsPool.shownApprox.units}u/${r.shownVsPool.shownApprox.n} vs pool ${r.shownVsPool.pool.units}u/${r.shownVsPool.pool.n}`)
  for (const s of r.missedWinners.samples) console.log(`  MISSED: ${s}`)
}
