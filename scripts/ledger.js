#!/usr/bin/env node
"use strict"

/**
 * Personal Bet Ledger CLI
 *
 * Usage:
 *   node scripts/ledger.js add   --sport=nba --player="Cade Cunningham" --team=DET --opponent=PHI \
 *        --stat=firstbasket --side=yes --line=1 --odds=-130 --stake=25 --tier=STRONG --book=draftkings \
 *        --matchup="DET @ PHI" --eventId=nba_det_phi_20260506
 *   node scripts/ledger.js settle <betId> --result=win  [--payout=47.50] [--actual=1]
 *   node scripts/ledger.js import --sport=nba --date=2026-05-06 --stake=20
 *   node scripts/ledger.js report [--sport=nba] [--date=2026-05-06] [--window=30]
 *   node scripts/ledger.js list   [--pending] [--date=2026-05-06] [--sport=nba]
 *   node scripts/ledger.js bankroll --set=1500
 *
 * All flags accept --key=value or --key value formats.
 */

const path = require("path")
const {
  loadLedger,
  saveLedger,
  addOrUpdateBet,
  settleBet,
  batchSettle,
  buildNightlyReport,
  importFromTrackedBets,
  setClosingLine,
  batchSetClosingLines,
  snapshotFromPlay,
} = require("../backend/pipeline/shared/buildPersonalLedger")
const {
  buildLineShopping,
  buildLadderShopping,
  buildNightlyBookReport,
  updateBookStateFromLedger,
  updateLadderProfilesInState,
  loadBookState,
  saveBookState,
  canonicalBook,
} = require("../backend/pipeline/shared/buildLineShoppingIntelligence")
const {
  buildMarketTiming,
  buildNightlyTimingReport,
  loadTimingState,
} = require("../backend/pipeline/shared/buildMarketTimingIntelligence")

// ─── arg parser ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] }
  const rest = argv.slice(2)
  let i = 0
  while (i < rest.length) {
    const a = rest[i]
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        // Check if next token is a value (not a flag).
        const next = rest[i + 1]
        if (next && !next.startsWith("--")) {
          args[a.slice(2)] = next
          i++
        } else {
          args[a.slice(2)] = true
        }
      }
    } else {
      args._.push(a)
    }
    i++
  }
  return args
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function pp(obj) {
  console.log(JSON.stringify(obj, null, 2))
}

// ─── commands ─────────────────────────────────────────────────────────────────

function cmdAdd(args) {
  const bet = {
    date: args.date || today(),
    sport: args.sport || "nba",
    sportsbook: args.book || args.sportsbook || "unknown",
    betType: args.type || "single",
    player: args.player || "",
    team: args.team || null,
    opponent: args.opponent || null,
    // game context
    eventId: args.eventId || args.gameId || null,
    matchup: args.matchup || null,
    // prop
    statFamily: args.stat || args.statFamily || "",
    prop: args.prop || null,
    side: args.side || "over",
    line: num(args.line),
    odds: num(args.odds),
    stake: num(args.stake) ?? 10,
    // model reference
    modelLine: args.modelLine != null ? num(args.modelLine) : null,
    modelOdds: args.modelOdds != null ? num(args.modelOdds) : null,
    modelProb: args.modelProb != null ? num(args.modelProb) : null,
    modelTier: args.modelTier || null,
    confidenceTier: args.tier || "unknown",
    decisionType: args.decision || null,
    // projection snapshot (flat flags — CLI convenience)
    projectedStat: args.proj != null ? num(args.proj) : null,
    projectedRangeLow: args.low != null ? num(args.low) : null,
    projectedRangeHigh: args.high != null ? num(args.high) : null,
    confidenceRaw: args.confRaw != null ? num(args.confRaw) : null,
    calibratedConfidence: args.conf != null ? num(args.conf) : null,
    edge: args.edge != null ? num(args.edge) : null,
    archetype: args.archetype || null,
    note: args.note || null,
  }
  const { bet: saved, isNew } = addOrUpdateBet(bet)
  console.log(`[ledger] ${isNew ? "added" : "updated"} bet:`)
  pp({ id: saved.id, player: saved.player, prop: saved.prop, team: saved.team, matchup: saved.matchup,
    integrity: saved.integrity, odds: saved.odds, stake: saved.stake, result: saved.result })
  console.log(`[ledger] id: ${saved.id}`)
}

function cmdSettle(args) {
  const id = args._[1]
  if (!id) { console.error("[ledger] settle requires a bet id as second argument"); process.exit(1) }
  const result = settleBet(id, {
    result: args.result,
    payout: num(args.payout),
    actualStat: num(args.actual ?? args.actualStat),
    note: args.note || null,
  })
  if (!result.ok) {
    console.error("[ledger] settle error:", result.reason, result.valid || "")
    process.exit(1)
  }
  console.log(`[ledger] settled: ${result.bet.player} → ${result.bet.result}`)
  console.log(`[ledger] bankroll: $${result.prevBalance} → $${result.newBalance} (Δ $${(result.newBalance - result.prevBalance).toFixed(2)})`)
}

function cmdImport(args) {
  const sport = args.sport || "nba"
  const date = args.date || today()
  const stake = num(args.stake) ?? 10
  const result = importFromTrackedBets({ sport, date, defaultStake: stake })
  if (!result.ok) {
    console.error("[ledger] import error:", result.reason, result.trackedPath || "")
    process.exit(1)
  }
  console.log(`[ledger] imported ${result.added} bets (${result.skipped} already existed) from ${sport} tracked_bets ${date}`)
}

function cmdReport(args) {
  const sport = args.sport || null
  const date = args.date || today()
  const window = num(args.window) ?? 30
  const report = buildNightlyReport({ sport, date, windowDays: window })

  console.log("\n══════════════════════════════════════════")
  console.log(`  PERSONAL BET LEDGER REPORT`)
  console.log(`  Sport: ${report.metadata.sport.toUpperCase()}  |  Window: ${window}d  |  ${date}`)
  console.log("══════════════════════════════════════════\n")

  const b = report.bankroll
  console.log("── BANKROLL ─────────────────────────────")
  console.log(`  Current:  $${b.current}  (initial: $${b.initial})`)
  console.log(`  Delta:    ${b.delta >= 0 ? "+" : ""}$${b.delta}  (${b.deltaPct != null ? ((b.deltaPct * 100).toFixed(1) + "%") : "n/a"})`)
  console.log(`  Unit:     $${b.unitSize}`)

  const s = report.summary
  console.log("\n── SUMMARY ─────────────────────────────")
  console.log(`  Bets: ${s.totalBets}  |  Settled: ${s.settled}  |  Pending: ${s.pending}`)
  console.log(`  Record: ${s.wins}W-${s.losses}L  (Win rate: ${s.winRate != null ? (s.winRate * 100).toFixed(1) + "%" : "n/a"})`)
  console.log(`  Staked: $${s.totalStaked}  Profit: ${s.totalProfit >= 0 ? "+" : ""}$${s.totalProfit}  ROI: ${s.roi != null ? (s.roi * 100).toFixed(1) + "%" : "n/a"}`)

  console.log("\n── BEST BETS ────────────────────────────")
  for (const b of report.bestBets) {
    console.log(`  +$${b.profit.toFixed(2)}  ${b.player}  ${b.statFamily} ${b.side} ${b.line}  @${b.odds}  [${b.decisionType}]`)
  }

  console.log("\n── WORST BETS ───────────────────────────")
  for (const b of report.worstBets) {
    console.log(`  ${b.profit >= 0 ? "+" : ""}$${b.profit.toFixed(2)}  ${b.player}  ${b.statFamily} ${b.side} ${b.line}  @${b.odds}  [${b.decisionType}]`)
  }

  console.log("\n── DECISION QUALITY ─────────────────────")
  const d = report.decision
  console.log(`  Followed model:   ${d.followed.count} bets  (win rate: ${d.followed.winRate != null ? (d.followed.winRate * 100).toFixed(0) + "%" : "n/a"})`)
  console.log(`  Modified line:    ${d.modified.count} bets  (win rate: ${d.modified.winRate != null ? (d.modified.winRate * 100).toFixed(0) + "%" : "n/a"})`)
  console.log(`    ↳ Aggressive:   ${d.aggressiveMods.count}  Conservative: ${d.conservativeMods.count}`)
  console.log(`  Ignored model:    ${d.ignored.count} bets  (win rate: ${d.ignored.winRate != null ? (d.ignored.winRate * 100).toFixed(0) + "%" : "n/a"})`)
  console.log(`  Custom bets:      ${d.custom.count} bets  (win rate: ${d.custom.winRate != null ? (d.custom.winRate * 100).toFixed(0) + "%" : "n/a"})`)
  if (d.smartest.length) {
    console.log("  Smartest decisions:")
    for (const b of d.smartest) console.log(`    ✓ ${b.player}  ${b.prop}  @${b.odds}  +$${b.profit}`)
  }
  if (d.mistakes.length) {
    console.log("  Biggest mistakes:")
    for (const b of d.mistakes) console.log(`    ✗ ${b.player}  ${b.prop}  @${b.odds}  Δline:${b.aggressionDelta ?? "n/a"}  $${b.profit}`)
  }

  console.log("\n── PROP TYPE BREAKDOWN ──────────────────")
  for (const p of report.propBreakdown.slice(0, 12)) {
    const roi = p.roi != null ? (p.roi * 100).toFixed(1) + "%" : "n/a"
    console.log(`  ${p.stat.padEnd(18)} ${p.wins}W/${(p.settled - p.wins)}L  ROI: ${roi}  P/L: ${p.profit >= 0 ? "+" : ""}$${p.profit}`)
  }

  if (report.nearMisses.length) {
    console.log("\n── NEAR MISSES ──────────────────────────")
    for (const nm of report.nearMisses) {
      console.log(`  ${nm.date}  ${nm.player}  ${nm.statFamily} ${nm.side} ${nm.line} → actual: ${nm.actualStat}  [${nm.category}] ${nm.narrative || ""}`)
    }
  }

  const clv = report.clv
  if (clv && clv.count > 0) {
    console.log("\n── CLV (CLOSING LINE VALUE) ─────────────")
    console.log(`  Bets with CLV: ${clv.count}  |  Avg CLV: ${clv.avgClvPct >= 0 ? "+" : ""}${clv.avgClvPct}¢`)
    console.log(`  Beat market: ${clv.beatMarketCount}/${clv.count} (${(clv.beatMarketRate * 100).toFixed(0)}%)`)
    if (clv.posClvWinRate != null)
      console.log(`  Win rate — +CLV bets: ${(clv.posClvWinRate * 100).toFixed(0)}%  |  −CLV bets: ${clv.negClvWinRate != null ? (clv.negClvWinRate * 100).toFixed(0) + "%" : "n/a"}`)
    if (clv.processBreakdown && Object.keys(clv.processBreakdown).length) {
      console.log("  Process breakdown:")
      for (const [label, count] of Object.entries(clv.processBreakdown)) {
        const emoji = label === "good_process_good_result" ? "✅" : label === "good_process_variance_loss" ? "📉" : label === "lucky_win" ? "🍀" : "❌"
        console.log(`    ${emoji} ${label.replace(/_/g, " ")}: ${count}`)
      }
    }
    if (clv.bestClv?.length) {
      console.log("  Best CLV bets:")
      for (const b of clv.bestClv) console.log(`    +${(b.clvScore * 100).toFixed(1)}¢  ${b.player}  ${b.statFamily} ${b.side} ${b.line}  [${b.quality}]  result:${b.result}`)
    }
    if (clv.worstClv?.length) {
      console.log("  Worst CLV bets:")
      for (const b of clv.worstClv) console.log(`    ${(b.clvScore * 100).toFixed(1)}¢  ${b.player}  ${b.statFamily} ${b.side} ${b.line}  [${b.quality}]  result:${b.result}`)
    }
    if (clv.byStat && Object.keys(clv.byStat).length) {
      console.log("  CLV by stat:")
      for (const [stat, v] of Object.entries(clv.byStat).sort((a, b) => b[1].avgClv - a[1].avgClv)) {
        console.log(`    ${stat.padEnd(18)} avg CLV: ${v.avgClvPct >= 0 ? "+" : ""}${v.avgClvPct}¢  beat: ${(v.beatRate * 100).toFixed(0)}%  (${v.count})`)
      }
    }
  }

  console.log("\n══════════════════════════════════════════\n")
}

function cmdList(args) {
  const ledger = loadLedger()
  const sport = args.sport ? String(args.sport).toLowerCase() : null
  const date = args.date || null
  const pendingOnly = args.pending === true || args.pending === "true"

  let bets = ledger.bets
  if (sport) bets = bets.filter((b) => b.sport === sport)
  if (date) bets = bets.filter((b) => b.date === date)
  if (pendingOnly) bets = bets.filter((b) => b.result === "pending")

  if (!bets.length) { console.log("[ledger] no bets found"); return }

  console.log(`[ledger] ${bets.length} bet(s):\n`)
  for (const b of bets.slice(-50)) {
    const tag = b.result === "pending" ? "⏳" : b.result === "win" ? "✅" : b.result === "loss" ? "❌" : "➖"
    const iv = b.integrity && b.integrity.valid === false ? " ⚠" : ""
    console.log(`  ${tag}${iv} [${b.date}] ${b.sport.toUpperCase()} | ${b.player} | ${b.team || "?"} vs ${b.opponent || "?"} | ${b.matchup || "—"} | ${b.statFamily} ${b.side} ${b.line} @${b.odds} | ${b.result} | id:${b.id}`)
  }
}

function cmdClose(args) {
  // Single bet: node scripts/ledger.js close <id> --closeOdds=-105 [--closeLine=7.5] [--book=pinnacle]
  // Batch file: node scripts/ledger.js close --file=closing.json
  if (args.file) {
    let map
    try { map = JSON.parse(require("fs").readFileSync(args.file, "utf8")) } catch (e) {
      console.error("[ledger] cannot read closing file:", e.message); process.exit(1)
    }
    const result = batchSetClosingLines(map)
    console.log(`[ledger] closed ${result.count} bet(s):`)
    for (const r of result.applied) {
      const sign = r.clvScore >= 0 ? "+" : ""
      console.log(`  ${r.id.slice(0, 14)}…  CLV: ${sign}${(r.clvScore * 100).toFixed(1)}¢  [${r.quality}]`)
    }
    return
  }
  const id = args._[1]
  if (!id) { console.error("[ledger] close requires a bet id or --file=path"); process.exit(1) }
  const closeOdds = num(args.closeOdds ?? args.odds)
  if (!Number.isFinite(closeOdds)) { console.error("[ledger] --closeOdds is required"); process.exit(1) }
  const result = setClosingLine(id, {
    closingOdds: closeOdds,
    closingLine: args.closeLine != null ? num(args.closeLine) : undefined,
    closingSportsbook: args.book || args.closingSportsbook || null,
    closedAt: new Date().toISOString(),
  })
  if (!result.ok) { console.error("[ledger] close error:", result.reason); process.exit(1) }
  const clv = result.clv
  console.log(`[ledger] CLV recorded for: ${result.bet.player}  ${result.bet.statFamily} ${result.bet.side} ${result.bet.line}`)
  console.log(`  Placed: ${result.bet.clvSnapshot.placed.odds} → Close: ${clv.closingOdds}`)
  console.log(`  CLV: ${clv.clvPct >= 0 ? "+" : ""}${clv.clvPct}¢  [${clv.quality}]  ${clv.narrative || ""}`)
  console.log(`  Beat market: ${clv.beatMarket}`)
}

function cmdBankroll(args) {
  if (args.set) {
    const amount = num(args.set)
    if (!Number.isFinite(amount) || amount <= 0) {
      console.error("[ledger] --set must be a positive number")
      process.exit(1)
    }
    const ledger = loadLedger()
    ledger.bankroll.current = amount
    if (args.initial) ledger.bankroll.initial = num(args.initial) ?? ledger.bankroll.initial
    ledger.bankroll.unitSize = Math.round(ledger.bankroll.current * 0.01 * 100) / 100
    saveLedger(ledger)
    console.log(`[ledger] bankroll set to $${amount}  (unit: $${ledger.bankroll.unitSize})`)
  } else {
    const ledger = loadLedger()
    pp({
      initial: ledger.bankroll.initial,
      current: ledger.bankroll.current,
      unitSize: ledger.bankroll.unitSize,
      delta: Math.round((ledger.bankroll.current - ledger.bankroll.initial) * 100) / 100,
    })
  }
}

// ─── tonight smoke test ───────────────────────────────────────────────────────

function cmdSmoke(_args) {
  console.log("[ledger] running tonight smoke test...\n")
  const date = today()

  // Correct teams + games — shared OKC/DAL for SGA + Holmgren; DET @ PHI for Cade + Tobias.
  const exampleBets = [
    {
      sport: "nba", player: "Cade Cunningham", statFamily: "firstbasket",
      team: "DET", opponent: "PHI",
      side: "yes", line: 1, odds: -130, stake: 25,
      tier: "STRONG", modelTier: "STRONG",
      decisionType: "followed",
      eventId: "nba_det_phi_20260506", matchup: "DET @ PHI",
      modelLine: 1, modelOdds: -130, modelProb: 0.57,
      modelSnapshot: { projectedStat: 1, projectedRangeLow: 0, projectedRangeHigh: 1,
        confidenceRaw: 0.72, calibratedConfidence: 0.61, edge: 0.08, archetype: "heliocentric initiator" },
      firstBasketSnapshot: { projectedFirstShotProb: 0.34, projectedFirstTouchProb: 0.51,
        tipWinExpectation: 0.48, openingPossessionConf: 0.55 },
      result: "loss", actualStat: 0, payout: null,
      note: "Missed first basket — second scorer",
    },
    {
      sport: "nba", player: "SGA", statFamily: "firstbasket",
      team: "OKC", opponent: "DAL",
      side: "yes", line: 1, odds: -145, stake: 25,
      tier: "STRONG", modelTier: "STRONG",
      decisionType: "followed",
      eventId: "nba_okc_dal_20260506", matchup: "OKC @ DAL",
      modelLine: 1, modelOdds: -145, modelProb: 0.61,
      modelSnapshot: { projectedStat: 1, projectedRangeLow: 0, projectedRangeHigh: 1,
        confidenceRaw: 0.78, calibratedConfidence: 0.64, edge: 0.05, archetype: "heliocentric initiator" },
      firstBasketSnapshot: { projectedFirstShotProb: 0.38, projectedFirstTouchProb: 0.55,
        tipWinExpectation: 0.52, openingPossessionConf: 0.58 },
      result: "loss", actualStat: 0, payout: null,
      note: "SGA first basket — second attempt",
    },
    {
      sport: "nba", player: "James Harden", statFamily: "threes",
      team: "LAC", opponent: "HOU",
      side: "over", line: 2.5, odds: 115, stake: 30,
      tier: "PLAYABLE", modelTier: "PLAYABLE",
      decisionType: "modified",
      eventId: "nba_lac_hou_20260506", matchup: "LAC @ HOU",
      modelLine: 1.5, modelOdds: -110, modelProb: 0.54,
      modelSnapshot: { projectedStat: 2.1, projectedRangeLow: 1, projectedRangeHigh: 4,
        confidenceRaw: 0.53, calibratedConfidence: 0.47, edge: 0.04, archetype: "stable producer" },
      result: "loss", actualStat: 1, payout: null,
      note: "User took harder line (+1) — Harden threes",
    },
    {
      sport: "nba", player: "LeBron James", statFamily: "rebounds",
      team: "LAL", opponent: "MEM",
      side: "over", line: 7.5, odds: -110, stake: 20,
      tier: "PLAYABLE", modelTier: "PLAYABLE",
      decisionType: "followed",
      eventId: "nba_lal_mem_20260506", matchup: "LAL @ MEM",
      modelLine: 7.5, modelOdds: -110, modelProb: 0.51,
      modelSnapshot: { projectedStat: 7.8, projectedRangeLow: 5, projectedRangeHigh: 12,
        confidenceRaw: 0.49, calibratedConfidence: 0.44, edge: 0.03, archetype: "chaos rebounder" },
      result: "loss", actualStat: 7, payout: null,
      note: "Missed by 0.5 rebounds",
    },
    {
      sport: "nba", player: "Evan Mobley", statFamily: "rebounds",
      team: "CLE", opponent: "BOS",
      side: "over", line: 8.5, odds: -115, stake: 20,
      tier: "STRONG", modelTier: "STRONG",
      decisionType: "followed",
      eventId: "nba_cle_bos_20260506", matchup: "CLE @ BOS",
      modelLine: 8.5, modelOdds: -115, modelProb: 0.56,
      modelSnapshot: { projectedStat: 9.4, projectedRangeLow: 6, projectedRangeHigh: 14,
        confidenceRaw: 0.61, calibratedConfidence: 0.54, edge: 0.07, archetype: "chaos rebounder" },
      result: "win", actualStat: 11, payout: 37.39,
      note: "Rebound ladder hit",
    },
    {
      sport: "nba", player: "Tobias Harris", statFamily: "rebounds",
      team: "PHI", opponent: "DET",
      side: "over", line: 5.5, odds: 105, stake: 20,
      tier: "PLAYABLE", modelTier: "PLAYABLE",
      decisionType: "ignored",
      eventId: "nba_det_phi_20260506", matchup: "DET @ PHI",
      modelLine: 5.5, modelOdds: 105, modelProb: 0.53,
      modelSnapshot: { projectedStat: 6.1, projectedRangeLow: 4, projectedRangeHigh: 9,
        confidenceRaw: 0.55, calibratedConfidence: 0.48, edge: 0.06, archetype: "stable producer" },
      result: "win", actualStat: 8, payout: 41.00,
      note: "Model rec ignored — user regrets",
    },
    {
      sport: "nba", player: "Chet Holmgren", statFamily: "rebounds",
      team: "OKC", opponent: "DAL",
      side: "over", line: 9.5, odds: -108, stake: 18,
      tier: "PLAYABLE", modelTier: "PLAYABLE",
      decisionType: "followed",
      eventId: "nba_okc_dal_20260506", matchup: "OKC @ DAL",
      modelLine: 9.5, modelOdds: -108, modelProb: 0.52,
      modelSnapshot: { projectedStat: 10.2, projectedRangeLow: 7, projectedRangeHigh: 14,
        confidenceRaw: 0.52, calibratedConfidence: 0.46, edge: 0.04, archetype: "chaos rebounder" },
      result: "win", actualStat: 12, payout: 34.33,
      note: "Same slate as SGA — OKC/DAL",
    },
  ]

  const ledger = loadLedger()
  ledger.bets = ledger.bets.filter((b) => b.date !== date)

  let added = 0
  for (const b of exampleBets) {
    const input = { ...b, date, sportsbook: "draftkings" }
    addOrUpdateBet(input, { ledger, save: false })
    added++
  }
  saveLedger(ledger)
  console.log(`[ledger] inserted ${added} tonight examples\n`)

  const fresh = loadLedger().bets.filter((x) => x.date === date)
  console.log("INTEGRITY CHECK:")
  for (const b of fresh) {
    console.log(`  ${b.player.padEnd(22)} valid:${String(b.integrity?.valid).padEnd(5)} ${b.integrity?.matchupNormalized || "—"}  warnings:${JSON.stringify(b.integrity?.warnings || [])}`)
  }
  console.log("")

  // ── Simulate closing lines for tonight's bets ─────────────────────────────
  console.log("SIMULATING CLOSING LINES...\n")
  const closingScenarios = {
    // Harden threes: o2.5 at +115 → closes +105 = market moved against (bad CLV, lost = bad process)
    "harden":       { closingOdds: 105,  closingLine: 2.5, note: "market tightened on threes" },
    // Cade first basket: -130 → closes -155 = market more confident he gets it (beat market)
    "cade":         { closingOdds: -155, closingLine: 1,   note: "market moved in favour — still lost (variance)" },
    "cunningham":   { closingOdds: -155, closingLine: 1,   note: "market moved in favour — still lost (variance)" },
    // SGA first basket: -145 → closes -160 = slight market drift toward SGA
    "sga":          { closingOdds: -160, closingLine: 1,   note: "market agrees, slight drift" },
    // LeBron rebounds: 7.5 -110 → line drops to 6.5 = market moved line down = bad CLV for over
    "lebron":       { closingOdds: -120, closingLine: 6.5, note: "line moved down — bad CLV for over 7.5" },
    "james":        { closingOdds: -120, closingLine: 6.5, note: "line moved down — bad CLV for over 7.5" },
    // Mobley: 8.5 -115 → closes 9.5 = market moved line UP = neutral odds, bad CLV, won anyway
    "mobley":       { closingOdds: -115, closingLine: 9.5, note: "line moved up — lucky win on harder bar" },
    // Tobias: 5.5 +105 → closes 5.5 +125 = market drifted further toward under = better odds for over
    "harris":       { closingOdds: 125,  closingLine: 5.5, note: "market gave better price at close — won" },
    "tobias":       { closingOdds: 125,  closingLine: 5.5, note: "market gave better price at close — won" },
    // Holmgren: 9.5 -108 → closes 10.5 -108 = line moved up = harder bar, still won
    "holmgren":     { closingOdds: -108, closingLine: 10.5, note: "market moved line up — still won" },
  }

  const reloadedBets = loadLedger().bets.filter((x) => x.date === date)
  for (const bet of reloadedBets) {
    const full = bet.player.toLowerCase()
    const last = full.split(" ").pop()
    const first = full.split(" ")[0]
    const scenario = closingScenarios[last] || closingScenarios[first] || closingScenarios[full.replace(/\s+/g, "")]
    if (!scenario) continue
    const result = setClosingLine(bet.id, {
      closingOdds: scenario.closingOdds,
      closingLine: scenario.closingLine,
      closingSportsbook: "pinnacle",
    })
    if (result.ok) {
      const clv = result.clv
      const sign = clv.clvScore >= 0 ? "+" : ""
      console.log(`  ${bet.player.padEnd(20)} CLV: ${sign}${clv.clvPct}¢ [${clv.quality.padEnd(15)}]  beat:${String(clv.beatMarket).padEnd(5)}  result:${bet.result}  ← ${scenario.note}`)
    }
  }
  console.log("")

  const report = buildNightlyReport({ sport: "nba", date, windowDays: 1 })
  console.log("SUMMARY:", JSON.stringify(report.summary, null, 2))
  const clvA = report.clv
  console.log("\nCLV ANALYTICS:")
  console.log(`  count: ${clvA.count}  avgCLV: ${clvA.avgClvPct}¢  beatMarket: ${clvA.beatMarketCount}/${clvA.count}`)
  console.log("  processBreakdown:", JSON.stringify(clvA.processBreakdown, null, 2))
  console.log("  byStat:", JSON.stringify(clvA.byStat, null, 2))
  console.log("  bestClv:", JSON.stringify(clvA.bestClv?.slice(0, 3), null, 2))
  console.log("\n[ledger] smoke test complete ✓")
}

// ─── shop command ─────────────────────────────────────────────────────────────
//
//  node scripts/ledger.js shop --sport=mlb
//  node scripts/ledger.js shop --sport=nba --prop="Harden assists"
//  node scripts/ledger.js shop --ladder
//  node scripts/ledger.js shop --stale
//
function cmdShop(args) {
  const sport = String(args.sport || "mlb").toLowerCase()
  const propFilter = args.prop ? String(args.prop).toLowerCase() : null
  const ladderOnly = args.ladder === true || args.ladder === "true"
  const staleOnly = args.stale === true || args.stale === "true"

  // Load snapshot rows for the sport
  let rows = []
  try {
    if (sport === "mlb") {
      const snap = require("../backend/snapshot-mlb.json")
      rows = snap?.data?.rows || []
    } else {
      // NBA: load from external cache or mlb-external-cache
      const nbaCache = require("../backend/mlb-external-cache.json")
      rows = nbaCache?.rows || []
    }
  } catch (e) {
    // Fallback: try snapshot path
    try {
      const fs = require("fs")
      const snapPath = require("path").join(__dirname, `../backend/snapshot-${sport}.json`)
      if (fs.existsSync(snapPath)) {
        const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"))
        rows = snap?.data?.rows || snap?.rows || []
      }
    } catch (_) { /* no snapshot, use empty */ }
  }

  if (!rows.length) {
    console.log(`[shop] no snapshot rows found for sport=${sport}. Run the nightly ingest first.`)
    return
  }

  const bookState = loadBookState()

  if (ladderOnly) {
    const lr = buildLadderShopping(rows)
    console.log(`\n=== LADDER SHOPPING (${sport.toUpperCase()}) ===`)
    console.log(`Found ${lr.ladderComparisons.length} ladder comparisons\n`)
    for (const lc of lr.ladderComparisons.slice(0, 15)) {
      console.log(`  ${lc.player.padEnd(22)} ${lc.statFamily.padEnd(16)} ${lc.side}`)
      for (const bd of lc.books.slice(0, 4)) {
        console.log(`    ${bd.book.padEnd(14)} depth:${bd.depth}  rungs: ${bd.rungs.map((r) => `${r.line}@${r.odds > 0 ? "+" : ""}${r.odds}`).join("  ")}`)
      }
      console.log("")
    }
    console.log("\n--- LADDER PROFILES BY BOOK ---")
    for (const [book, statMap] of Object.entries(lr.bookLadderProfile)) {
      const stats = Object.entries(statMap).map(([fam, d]) => `${fam}(avg${d.avgDepth})`).join("  ")
      console.log(`  ${book.padEnd(14)} ${stats}`)
    }
    return
  }

  const result = buildLineShopping(rows, { sport, bookState })

  if (staleOnly) {
    console.log(`\n=== STALE / SOFT BOOKS (${sport.toUpperCase()}) ===`)
    console.log(`Detected ${result.staleRows.length} outlier lines\n`)
    for (const s of result.staleRows) {
      const tag = s.tag === "soft_line" ? "SOFT (value)" : "STALE (avoid)"
      console.log(`  [${tag.padEnd(14)}] ${s.book.padEnd(14)} ${s.player.padEnd(22)} ${s.prop.padEnd(30)} impl:${(s.impliedProb * 100).toFixed(1)}% vs consensus:${(s.consensus * 100).toFixed(1)}%  Δ${s.delta > 0 ? "+" : ""}${(s.delta * 100).toFixed(1)}¢`)
    }
    return
  }

  // Default: full line shopping summary
  let props = result.bestByProp
  if (propFilter) {
    props = props.filter((p) => `${p.player} ${p.prop}`.toLowerCase().includes(propFilter))
  }

  console.log(`\n=== LINE SHOPPING (${sport.toUpperCase()}) ===`)
  console.log(`Total props: ${result.meta.totalProps}  multi-book: ${result.meta.propsWithMultiBook}  stale detected: ${result.meta.staleDetected}`)
  console.log("\n--- BEST LINE-SHOPPING OPPORTUNITIES (sorted by odds spread) ---")
  for (const p of props.slice(0, 20)) {
    const spread = p.oddsSpread != null ? `spread ${p.oddsSpread > 0 ? "+" : ""}${p.oddsSpread}` : ""
    const deltaStr = p.bestImpDelta != null ? `  edge vs mkt: ${p.bestImpDelta > 0 ? "+" : ""}${(p.bestImpDelta * 100).toFixed(1)}¢` : ""
    console.log(`  ${p.player.padEnd(22)} ${p.prop.padEnd(35)}  BEST: ${p.bestBook.padEnd(12)} @${p.bestOdds > 0 ? "+" : ""}${p.bestOdds}  WORST: ${p.worstBook.padEnd(12)} @${p.worstOdds > 0 ? "+" : ""}${p.worstOdds}  ${spread}${deltaStr}`)
  }

  console.log("\n--- STALE / SOFT BOOKS ---")
  for (const s of result.staleRows.slice(0, 8)) {
    const tag = s.tag === "soft_line" ? "SOFT" : "STALE"
    console.log(`  [${tag}] ${s.book.padEnd(14)} ${s.player.padEnd(22)} ${s.prop.padEnd(30)}  Δ${(s.delta * 100).toFixed(1)}¢`)
  }

  // Rolling book profiles
  const profiles = Object.entries(bookState.books || {})
    .filter(([, bp]) => bp.settled >= 5)
    .sort((a, b) => (b[1].avgClv ?? -99) - (a[1].avgClv ?? -99))
  if (profiles.length) {
    console.log("\n--- BOOK INTELLIGENCE PROFILES ---")
    for (const [book, bp] of profiles.slice(0, 8)) {
      const clv = bp.avgClv != null ? `avgCLV:${(bp.avgClv * 100).toFixed(1)}¢` : "CLV:n/a"
      const roi = bp.roi != null ? `ROI:${(bp.roi * 100).toFixed(1)}%` : "ROI:n/a"
      console.log(`  ${book.padEnd(14)} ${clv.padEnd(16)} ${roi.padEnd(14)} bets:${bp.settled}`)
    }
  }
}

// ─── timing command ───────────────────────────────────────────────────────────
//
//  node scripts/ledger.js timing --sport=mlb
//  node scripts/ledger.js timing --sport=mlb --urgent
//  node scripts/ledger.js timing --sport=mlb --stale
//  node scripts/ledger.js timing --sport=mlb --prop="Harden assists"
//
function cmdTiming(args) {
  const sport      = String(args.sport || "mlb").toLowerCase()
  const urgentOnly = args.urgent === true || args.urgent === "true"
  const staleOnly  = args.stale  === true || args.stale  === "true"
  const propFilter = args.prop   ? String(args.prop).toLowerCase() : null

  let rows = []
  try {
    if (sport === "mlb") {
      const snap = require("../backend/snapshot-mlb.json")
      rows = snap?.data?.rows || []
    } else {
      const fs = require("fs")
      const snapPath = require("path").join(__dirname, `../backend/snapshot-${sport}.json`)
      if (fs.existsSync(snapPath)) {
        const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"))
        rows = snap?.data?.rows || snap?.rows || []
      }
    }
  } catch (_) { /* no snapshot */ }

  if (!rows.length) {
    console.log(`[timing] no snapshot rows for sport=${sport}. Run nightly ingest first.`)
    return
  }

  const bookState   = loadBookState()
  const timingState = loadTimingState()
  const lineShopping = buildLineShopping(rows, { sport, bookState })
  const result = buildMarketTiming(rows, { lineShopping, timingState, bookState })

  console.log(`\n=== MARKET TIMING (${sport.toUpperCase()}) ===`)
  console.log(`Total classified: ${result.meta.totalClassified}  immediate: ${result.meta.immediateCount}  soon: ${result.meta.soonCount}`)
  console.log(`Snapshot: ${result.meta.fetchedAt}`)

  if (staleOnly) {
    console.log("\n--- STALE WINDOWS (act now) ---")
    let stale = result.staleWindows
    if (propFilter) stale = stale.filter(c => `${c.player} ${c.prop}`.toLowerCase().includes(propFilter))
    stale.slice(0, 15).forEach((c) => {
      console.log(`  [${c.urgency.padEnd(9)}] ${c.player.padEnd(22)} ${c.prop.padEnd(35)}  book:${c.bestBook.padEnd(12)}  signals:${c.signals.slice(0,2).join(",")}`)
    })
    return
  }

  if (urgentOnly) {
    console.log("\n--- URGENT PLAYS (immediate + soon) ---")
    let urgent = result.urgentPlays
    if (propFilter) urgent = urgent.filter(c => `${c.player} ${c.prop}`.toLowerCase().includes(propFilter))
    urgent.slice(0, 20).forEach((c) => {
      const sigStr = c.signals.slice(0, 2).join(", ")
      console.log(`  [${c.urgency.padEnd(9)}] [${c.state.padEnd(14)}] ${c.player.padEnd(22)} ${c.prop.padEnd(35)}  ${sigStr}`)
    })
    return
  }

  // Default: full timing summary
  let plays = result.urgentPlays
  if (propFilter) plays = result.timingClassifications.filter(c => `${c.player} ${c.prop}`.toLowerCase().includes(propFilter))

  console.log("\n--- IMMEDIATE PLAYS ---")
  plays.filter((c) => c.urgency === "immediate").slice(0, 12).forEach((c) => {
    const sigStr = c.signals.slice(0,2).join(", ")
    console.log(`  ${c.player.padEnd(22)} ${c.prop.padEnd(35)}  [${c.state.padEnd(14)}]  ${sigStr}`)
  })

  console.log("\n--- SOON PLAYS ---")
  plays.filter((c) => c.urgency === "soon").slice(0, 12).forEach((c) => {
    const sigStr = c.signals.slice(0,2).join(", ")
    console.log(`  ${c.player.padEnd(22)} ${c.prop.padEnd(35)}  [${c.state.padEnd(14)}]  ${sigStr}`)
  })

  console.log("\n--- STAT FAMILY URGENCY SUMMARY ---")
  for (const [fam, counts] of Object.entries(result.byStatFamily)) {
    const parts = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  ")
    console.log(`  ${fam.padEnd(22)} ${parts}`)
  }

  // Historical timing profiles
  const report = buildNightlyTimingReport({ timingResult: result, timingState })
  if (report.statTimingProfiles.length) {
    console.log("\n--- HISTORICAL TIMING PROFILES ---")
    report.statTimingProfiles.forEach((p) => {
      const early   = p.earlyAvgClv  != null ? `early:${(p.earlyAvgClv*100).toFixed(1)}¢`  : "early:n/a"
      const closing = p.closingAvgClv != null ? `close:${(p.closingAvgClv*100).toFixed(1)}¢` : "close:n/a"
      console.log(`  ${p.statFamily.padEnd(22)} ${early.padEnd(14)} ${closing.padEnd(14)} verdict:${p.verdict}`)
    })
  }
}

// ─── booksync command ─────────────────────────────────────────────────────────
//
//  node scripts/ledger.js booksync [--sport=nba]
//  Updates rolling book intelligence state from settled ledger bets.
//
function cmdBookSync(args) {
  const sport = String(args.sport || "all").toLowerCase()
  const ledger = loadLedger()
  let state = loadBookState()

  // Update from ledger CLV / results
  state = updateBookStateFromLedger(ledger.bets, state)

  // Update ladder profiles from tonight's snapshot
  let rows = []
  try {
    if (sport === "mlb" || sport === "all") {
      const snap = require("../backend/snapshot-mlb.json")
      const r = snap?.data?.rows || []
      const lr = buildLadderShopping(r)
      state = updateLadderProfilesInState(state, lr, { sport: "mlb" })
      rows = r
    }
  } catch (_) { /* no snapshot */ }

  const ok = saveBookState(state)
  const profiles = Object.entries(state.books || {}).length
  console.log(`[booksync] saved=${ok}  book profiles tracked: ${profiles}  updatedAt:${state.updatedAt}`)

  // Print quick summary
  const topBooks = Object.entries(state.books || {})
    .filter(([, bp]) => bp.settled > 0)
    .sort((a, b) => b[1].settled - a[1].settled)
  for (const [book, bp] of topBooks.slice(0, 8)) {
    const clv = bp.avgClv != null ? `CLV:${(bp.avgClv * 100).toFixed(1)}¢` : "CLV:n/a"
    const roi = bp.roi != null ? `ROI:${(bp.roi * 100).toFixed(1)}%` : "ROI:n/a"
    console.log(`  ${book.padEnd(14)} settled:${bp.settled}  ${clv}  ${roi}`)
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv)
  const cmd = args._[0]

  if (!cmd || cmd === "help") {
    console.log([
      "Usage: node scripts/ledger.js <command> [options]",
      "",
      "Commands:",
      "  add       --sport --player --team --opponent --stat --side --line --odds --stake [--matchup] [--eventId] [--tier] [--book]",
      "  settle    <id>  --result=win|loss|push|void [--payout] [--actual]",
      "  close     <id>  --closeOdds=-105 [--closeLine=7.5] [--book=pinnacle]",
      "  close     --file=closing.json   (batch close from { id: { closingOdds, closingLine } })",
      "  import    --sport --date [--stake=10]   (bulk-import from tracked_bets)",
      "  report    [--sport] [--date] [--window=30]",
      "  list      [--sport] [--date] [--pending]",
      "  bankroll  [--set=1500]  [--initial=1500]",
      "  shop      [--sport=mlb] [--prop='Harden assists'] [--ladder] [--stale]",
      "  timing    [--sport=mlb] [--urgent] [--stale] [--prop='...']",
      "  booksync  [--sport=all]   (update book intelligence from settled bets)",
      "  smoke     (tonight verification test)",
    ].join("\n"))
    return
  }

  if (cmd === "add") return cmdAdd(args)
  if (cmd === "settle") return cmdSettle(args)
  if (cmd === "close") return cmdClose(args)
  if (cmd === "import") return cmdImport(args)
  if (cmd === "report") return cmdReport(args)
  if (cmd === "list") return cmdList(args)
  if (cmd === "bankroll") return cmdBankroll(args)
  if (cmd === "shop") return cmdShop(args)
  if (cmd === "timing") return cmdTiming(args)
  if (cmd === "booksync") return cmdBookSync(args)
  if (cmd === "smoke") return cmdSmoke(args)

  console.error(`[ledger] unknown command: ${cmd}`)
  process.exit(1)
}

main()
