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
  // 2026-08-15 FADE-TIER AUDIT §1 (CA queue addition): the single "fade_tier"
  // bucket contained ZERO FADE rows (3-week census: LONGSHOT 128,589 · FADE
  // 0) — the label lied, and a real FADE-quality leak would be invisible
  // inside it. Split. Zero behavior change: both tiers remain refusals.
  if (tier === "FADE") return "fade_tag"
  if (tier === "LONGSHOT") return "longshot_tier"
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
  // 2026-08-15 FADE-TIER AUDIT §2+§3 (CA queue addition) — NET beside gross.
  // The missed-winners line counts WINNERS only (survivorship glare); the
  // refused pool's whole-population net (winners AND losers, flat $1) is what
  // the bankroll would have seen if the gate opened. Watch segments per §3:
  // move = closeImpliedProb − openImpliedProb (toward >+0.5pp, away <−0.5pp);
  // breakevenWinsExpected = Σ implied-at-recorded-odds — the Poisson bar's E.
  const refused = decided.filter((r) => { const t = String(r.tier || r.modelTier || "").toUpperCase(); return t === "FADE" || t === "LONGSHOT" })
  const netAgg = () => ({ n: 0, wins: 0, grossWinnerUnits: 0, netUnits: 0 })
  const addTo = (a, r) => { a.n++; const u = unitsOf(r); if (r.result === "win") { a.wins++; a.grossWinnerUnits += u } a.netUnits += u }
  const moveOf = (r) => { const o = Number(r.openImpliedProb), c = Number(r.closeImpliedProb); if (!Number.isFinite(o) || !Number.isFinite(c)) return null; const d = c - o; return d > 0.005 ? "toward" : d < -0.005 ? "away" : "flat" }
  const breakevenProb = (r) => { const o = Number(r.oddsAmerican); if (!Number.isFinite(o) || o === 0) return null; return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100) }
  const refusedByFam = {}
  const refusedTotal = netAgg()
  const watch = { hrToward: { ...netAgg(), breakevenWinsExpected: 0 }, ksAway: { ...netAgg(), breakevenWinsExpected: 0 } }
  for (const r of refused) {
    const fam = String(r.statFamily || "?")
    refusedByFam[fam] = refusedByFam[fam] || netAgg()
    addTo(refusedByFam[fam], r)
    addTo(refusedTotal, r)
    const mv = moveOf(r)
    const be = breakevenProb(r)
    if (fam === "hr" && mv === "toward") { addTo(watch.hrToward, r); if (be != null) watch.hrToward.breakevenWinsExpected += be }
    if (fam === "ks" && mv === "away") { addTo(watch.ksAway, r); if (be != null) watch.ksAway.breakevenWinsExpected += be }
  }
  const finN = (a) => ({ ...a, grossWinnerUnits: +a.grossWinnerUnits.toFixed(1), netUnits: +a.netUnits.toFixed(1), ...(a.breakevenWinsExpected != null ? { breakevenWinsExpected: +a.breakevenWinsExpected.toFixed(2) } : {}) })

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
  // (e) 2026-07-28 LINE-FRESHNESS attribution — what did serve-time
  // revalidation do on this slate, and did serving MOVED lines cost or save
  // money? Events were logged AT SERVE (the only time serve state is
  // knowable); the re-measure joins each line_moved event to the graded
  // record at BOTH lines — record capture writes per-line rows, so the true
  // twin exists once graded. delta = units(served line) − units(original
  // line); positive = the move saved money. Pairs with a missing twin are
  // counted unmeasurable, never guessed. Events file read from TRACKING so
  // fixture runs (CRITIC_TRACKING_DIR) stay hermetic.
  const { readFreshnessEvents } = require("../pipeline/shared/lineFreshness")
  const lfEvents = readFreshnessEvents({ file: path.join(TRACKING, "line_freshness_events.jsonl"), slate })
  const lfCounts = {}
  for (const e of lfEvents) lfCounts[e.type] = (lfCounts[e.type] || 0) + 1
  const normBk = (s) => String(s || "").toLowerCase().replace(/\s+/g, "")
  const rowAt = (e, line) => {
    if (line == null) return null
    const cands = decided.filter((r) => String(r.player).toLowerCase() === String(e.player || "").toLowerCase() && r.statFamily === e.statFamily && String(r.side).toLowerCase() === String(e.side || "").toLowerCase() && String(r.line) === String(line))
    return cands.find((r) => normBk(r.sportsbook || r.book) === normBk(e.book)) || cands[0] || null
  }
  let lfMeasured = 0, lfUnmeasurable = 0, lfDeltaUnits = 0
  for (const e of lfEvents.filter((x) => x.type === "line_moved")) {
    const servedRow = e.current && rowAt(e, e.current.line)
    const origRow = e.original && rowAt(e, e.original.line)
    if (!servedRow || !origRow) { lfUnmeasurable++; continue }
    lfMeasured++
    lfDeltaUnits += unitsOf(servedRow) - unitsOf(origRow)
  }
  return {
    slate, generatedAt: new Date().toISOString(), readOnly: true,
    missedWinners: { byReason: missed, unitsAtFlat$1: +missedUnits.toFixed(1), samples, note: "static-gate replay; serve timing not retro-knowable — served_or_timing rows excluded, never guessed" },
    ceilingAudit: { checked: tailN, exceeded95th: tailExceed, ratePct: tailN ? +(100 * tailExceed / tailN).toFixed(1) : null, bar: "≤7% healthy (unconditional 95th-pct exceedance ≈5%)" },
    shownVsPool: { shownApprox: agg(shownApprox), pool: agg(decided) },
    refusedNet: { total: finN(refusedTotal), byFamily: Object.fromEntries(Object.entries(refusedByFam).map(([k, v]) => [k, finN(v)])), note: "whole refused pool (winners AND losers), flat $1 — the NET beside the gross (audit §2)" },
    watchSegments: { hrToward: finN(watch.hrToward), ksAway: finN(watch.ksAway), note: "audit §3 — refused rows only; move = closeImpliedProb − openImpliedProb, toward >+0.5pp, away <−0.5pp" },
    lineFreshness: { events: lfCounts, movedServeDelta: { measured: lfMeasured, unmeasurable: lfUnmeasurable, unitsSavedAtFlat$1: +lfDeltaUnits.toFixed(1) }, note: "delta = units(served line) − units(original line) on graded per-line twins; positive = serving the moved line saved money" },
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
  // 2026-07-28 LINE-FRESHNESS weekly aggregation (older artifacts lack the
  // section — guarded, never re-derived).
  const lfAgg = reports.reduce((a, r) => {
    const l = r.lineFreshness
    if (!l) return a
    for (const [k, v] of Object.entries(l.events || {})) a.events[k] = (a.events[k] || 0) + v
    a.measured += l.movedServeDelta?.measured || 0
    a.unmeasurable += l.movedServeDelta?.unmeasurable || 0
    a.units += l.movedServeDelta?.unitsSavedAtFlat$1 || 0
    return a
  }, { events: {}, measured: 0, unmeasurable: 0, units: 0 })
  // 2026-08-15 FADE-TIER AUDIT (CA queue addition) — weekly NET table + watch
  // lines. Cumulative watch numbers recompute STATELESSLY from every critic
  // artifact on disk that carries watchSegments (epoch = this pack's first
  // nightly; re-running --weekly can never double-count).
  const netFam = {}
  const netTot = { n: 0, wins: 0, grossWinnerUnits: 0, netUnits: 0 }
  for (const r of reports) {
    if (!r.refusedNet) continue
    for (const [f, v] of Object.entries(r.refusedNet.byFamily || {})) {
      netFam[f] = netFam[f] || { n: 0, wins: 0, grossWinnerUnits: 0, netUnits: 0 }
      netFam[f].n += v.n; netFam[f].wins += v.wins; netFam[f].grossWinnerUnits += v.grossWinnerUnits; netFam[f].netUnits += v.netUnits
    }
    const t = r.refusedNet.total
    netTot.n += t.n; netTot.wins += t.wins; netTot.grossWinnerUnits += t.grossWinnerUnits; netTot.netUnits += t.netUnits
  }
  const netMd = netTot.n
    ? `\n\nWhole-pool NET of the refused rows (same replay, winners AND losers, flat $1): **${netTot.netUnits >= 0 ? "+" : ""}${netTot.netUnits.toFixed(1)}u across ${netTot.n} refused rows** — the gross line above is survivorship glare; this is what un-gating would have done.\n\n| refused segment | n | win% | gross winner units | NET |\n|---|---|---|---|---|\n${Object.entries(netFam).sort((a, b) => b[1].n - a[1].n).map(([f, v]) => `| ${f} | ${v.n} | ${v.n ? (100 * v.wins / v.n).toFixed(1) : "—"}% | +${v.grossWinnerUnits.toFixed(1)} | **${v.netUnits >= 0 ? "+" : ""}${v.netUnits.toFixed(1)}u** |`).join("\n")}`
    : ""
  const allCritics = fs.readdirSync(TRACKING).filter((f) => /^critic_\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => rd(path.join(TRACKING, f))).filter((r) => r && r.watchSegments)
  const cum = { hrToward: { n: 0, wins: 0, netUnits: 0, breakevenWinsExpected: 0 }, ksAway: { n: 0, wins: 0, netUnits: 0, breakevenWinsExpected: 0 } }
  for (const r of allCritics) for (const k of ["hrToward", "ksAway"]) { const s = r.watchSegments[k]; if (!s) continue; cum[k].n += s.n; cum[k].wins += s.wins; cum[k].netUnits += s.netUnits; cum[k].breakevenWinsExpected += s.breakevenWinsExpected || 0 }
  // Promotion bar (audit §3, verbatim): n≥600 cumulative AND NET>0 AND
  // Poisson ratio ≥1.0 at 90% one-sided — LB90 = (W − 1.2816·√W)/E where
  // W = wins, E = Σ breakeven-implied win prob at recorded odds.
  const barOf = (s) => { const W = s.wins, E = s.breakevenWinsExpected; const lb = E > 0 && W > 0 ? (W - 1.2816 * Math.sqrt(W)) / E : null; return { nOk: s.n >= 600, netOk: s.netUnits > 0, lb: lb != null ? +lb.toFixed(2) : null, met: s.n >= 600 && s.netUnits > 0 && lb != null && lb >= 1.0 } }
  const watchLine = (label, s) => { const b = barOf(s); return `\n- ${label}: cumulative n=${s.n}, wins=${s.wins}${s.n ? ` (${(100 * s.wins / s.n).toFixed(1)}%)` : ""}, NET ${s.netUnits >= 0 ? "+" : ""}${s.netUnits.toFixed(1)}u · bar [n≥600: ${b.nOk ? "MET" : "not met"} · NET>0: ${b.netOk ? "MET" : "not met"} · Poisson LB90 ${b.lb != null ? b.lb : "—"} ≥1.0: ${b.lb != null && b.lb >= 1.0 ? "MET" : "not met"}] → ${b.met ? "**PROMOTION BAR MET — file the gate-adjustment ASK (hard-gated; nothing auto-changes)**" : "CLOSED (no gate change)"}` }
  const watchMd = `\n\nWatch segments (audit §3 — refused rows; epoch ${allCritics.length} artifact night${allCritics.length === 1 ? "" : "s"} on disk):${watchLine("hr × market-toward", cum.hrToward)}${watchLine("ks × market-away", cum.ksAway)}`
  const lfLine = Object.keys(lfAgg.events).length
    ? `\n\nLine-freshness at serve: ${Object.entries(lfAgg.events).map(([k, v]) => `${v} ${k}`).join(" · ")}. Moved-line serves re-measured on graded twins: ${lfAgg.measured} measured (${lfAgg.unmeasurable} unmeasurable) → **${lfAgg.units >= 0 ? "+" : ""}${lfAgg.units.toFixed(1)}u ${lfAgg.units >= 0 ? "saved" : "cost"}** vs serving the dead original line.`
    : ""
  const md = `# Weekly Critic — ${today}\n\nMONEY LEFT ON THE TABLE (7 graded nights, flat $1, static-gate replay): **${units >= 0 ? "+" : ""}${units.toFixed(1)}u of winning rows never reached the served board.**\n\n| gate | winners dropped |\n|---|---|\n${Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}${netMd}${watchMd}\n\nCeiling audit: ${tails.x}/${tails.n} outcomes (${tails.n ? (100 * tails.x / tails.n).toFixed(1) : "—"}%) exceeded the curves' 95th percentile — bar ≤7%.\n\nShown-vs-pool per night: ${reports.map((r) => `${r.slate}: shown ${r.shownVsPool.shownApprox.units}u/${r.shownVsPool.shownApprox.n} vs pool ${r.shownVsPool.pool.units}u/${r.shownVsPool.pool.n}`).join(" · ")}${lfLine}\n\nHONEST LIMITS: drop reasons replay STATIC gates only (serve timing is not retro-knowable); a "missed winner" is not automatically a mistake — some gates exist to refuse variance. The question this report keeps asking: which refusals are discipline, and which are leaks.\n`
  // CRITIC_DOCS_DIR override exists for the hermetic fixture only.
  const out = path.join(process.env.CRITIC_DOCS_DIR || path.join(ROOT, "..", "docs", "audits"), `weekly-critic-${today}.md`)
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
