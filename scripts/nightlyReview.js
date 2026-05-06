#!/usr/bin/env node
"use strict"

/**
 * Nightly Review CLI — automated post-slate orchestration.
 *
 * Usage:
 *   # Full nightly review after NBA slate completes:
 *   node scripts/nightlyReview.js --sport=nba --date=2026-05-06
 *
 *   # With bet results inline:
 *   node scripts/nightlyReview.js --sport=nba --date=2026-05-06 \
 *     --bet="<id>=win" --bet="<id2>=loss"
 *
 *   # With bet results file:
 *   node scripts/nightlyReview.js --sport=nba --date=2026-05-06 \
 *     --bets=results.json --actuals=actuals.json
 *
 *   # With closing lines for CLV:
 *   node scripts/nightlyReview.js --sport=nba --date=2026-05-06 \
 *     --closing=closing.json
 *
 *   # Force even if slate appears incomplete:
 *   node scripts/nightlyReview.js --sport=nba --date=2026-05-06 --force
 *
 *   # Dry run (all logic, no writes):
 *   node scripts/nightlyReview.js --sport=nba --date=2026-05-06 --dry
 *
 *   # Both sports:
 *   node scripts/nightlyReview.js --sport=all --date=2026-05-06
 *
 *   # Check completion status only:
 *   node scripts/nightlyReview.js --sport=nba --date=2026-05-06 --check
 *
 * Cron example (11 PM every night):
 *   0 23 * * * /usr/local/bin/node /path/to/scripts/nightlyReview.js --sport=nba >> /var/log/nightly.log 2>&1
 *   0 23 * * * /usr/local/bin/node /path/to/scripts/nightlyReview.js --sport=mlb >> /var/log/nightly.log 2>&1
 */

const fs   = require("fs")
const path = require("path")

const {
  runNightlyReview,
  runNightlyReviewAll,
  detectSlateCompletion,
} = require("../backend/pipeline/shared/buildNightlyOrchestrator")

// ── arg parser ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    sport: "nba",
    date: todayKey(),
    bets: {},
    legs: {},
    actuals: {},
    closingLines: {},
    files: [],
    actualsFiles: [],
    closingFiles: [],
    force: false,
    dryRun: false,
    verbose: true,
    checkOnly: false,
    defaultStake: 10,
  }

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--sport="))        args.sport = a.slice("--sport=".length)
    else if (a.startsWith("--date="))    args.date  = a.slice("--date=".length)
    else if (a.startsWith("--stake="))   args.defaultStake = Number(a.slice("--stake=".length)) || 10
    else if (a.startsWith("--bets="))    args.files.push({ kind: "bets",    file: a.slice("--bets=".length) })
    else if (a.startsWith("--legs="))    args.files.push({ kind: "legs",    file: a.slice("--legs=".length) })
    else if (a.startsWith("--actuals=")) args.actualsFiles.push(a.slice("--actuals=".length))
    else if (a.startsWith("--closing=")) args.closingFiles.push(a.slice("--closing=".length))
    else if (a === "--force")            args.force   = true
    else if (a === "--dry")              args.dryRun  = true
    else if (a === "--quiet")            args.verbose = false
    else if (a === "--check")            args.checkOnly = true
    else if (a.startsWith("--bet=")) {
      const s = a.slice("--bet=".length); const idx = s.lastIndexOf("=")
      if (idx > 0) args.bets[s.slice(0, idx)] = s.slice(idx + 1)
    } else if (a.startsWith("--leg=")) {
      const s = a.slice("--leg=".length); const idx = s.lastIndexOf("=")
      if (idx > 0) args.legs[s.slice(0, idx)] = s.slice(idx + 1)
    }
  }
  return args
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function loadJsonFile(p) {
  if (!fs.existsSync(p)) throw new Error(`file not found: ${p}`)
  return JSON.parse(fs.readFileSync(p, "utf8"))
}

// ── report printer ────────────────────────────────────────────────────────────

function printSummary(result) {
  if (!result.ok) {
    if (result.deferred) {
      console.log(`\n[nightly] DEFERRED — ${result.reason}`)
      console.log(`          Run again after slate completes, or use --force to proceed anyway.`)
      return
    }
    console.log(`\n[nightly] FAILED — ${result.error}`)
    return
  }

  const s     = result.summary
  const steps = result.steps || {}
  if (!s) return

  console.log(`\n${"─".repeat(60)}`)
  console.log(`  NIGHTLY REVIEW  ${s.sport?.toUpperCase()}  ${s.date}  (${s.elapsedMs}ms)`)
  console.log(`${"─".repeat(60)}`)

  // Betting P&L
  const pnl = s.bettingPnl
  if (pnl.settled > 0) {
    const roiStr  = pnl.roi  != null ? `${(pnl.roi * 100).toFixed(1)}%` : "n/a"
    const winStr  = pnl.winRate != null ? `${(pnl.winRate * 100).toFixed(0)}%` : "n/a"
    const profStr = pnl.totalProfit != null ? `${pnl.totalProfit >= 0 ? "+" : ""}$${pnl.totalProfit.toFixed(2)}` : "n/a"
    console.log(`\n  P&L        settled:${pnl.settled}  winRate:${winStr}  ROI:${roiStr}  profit:${profStr}`)
  } else {
    console.log(`\n  P&L        no settled bets this window`)
  }

  // Model review
  const mr = s.modelReview
  if (mr.classified > 0) {
    console.log(`\n  MODEL      classified:${mr.classified} bets`)
    if (mr.topOverperformers?.length) {
      console.log(`  OVERPERFORMERS:`)
      mr.topOverperformers.forEach((p) => {
        console.log(`    ${p.player?.padEnd(22) || "unknown".padEnd(22)} proj:${p.projected}  actual:${p.actual}  Δ${p.delta >= 0 ? "+" : ""}${p.delta}`)
      })
    }
    if (mr.topUnderperformers?.length) {
      console.log(`  UNDERPERFORMERS:`)
      mr.topUnderperformers.forEach((p) => {
        console.log(`    ${p.player?.padEnd(22) || "unknown".padEnd(22)} proj:${p.projected}  actual:${p.actual}  Δ${p.delta >= 0 ? "+" : ""}${p.delta}`)
      })
    }
  }

  // CLV
  if (s.clv?.bestBets?.length) {
    console.log(`\n  CLV LEADERS:`)
    s.clv.bestBets.forEach((b) => {
      const pct = b.clvPct != null ? `${b.clvPct >= 0 ? "+" : ""}${b.clvPct}¢` : "n/a"
      console.log(`    ${(b.player || "").padEnd(22)} ${(b.prop || "").padEnd(30)}  CLV:${pct.padEnd(8)} [${b.quality || ""}]  result:${b.result}`)
    })
  }

  // Line shopping
  if (s.lineShoppingHighlights?.length) {
    console.log(`\n  BEST LINE SHOPS:`)
    s.lineShoppingHighlights.slice(0, 5).forEach((p) => {
      console.log(`    ${(p.player || "").padEnd(22)} ${(p.prop || "").padEnd(35)}  BEST:${p.bestBook} @${p.bestOdds > 0 ? "+" : ""}${p.bestOdds}  vs ${p.worstBook} @${p.worstOdds > 0 ? "+" : ""}${p.worstOdds}`)
    })
  }

  // Stale books
  if (s.staleBooks?.length) {
    console.log(`\n  STALE BOOKS:`)
    s.staleBooks.slice(0, 4).forEach((b) => {
      console.log(`    [${b.tag === "soft_line" ? "SOFT " : "STALE"}] ${b.book?.padEnd(14)} ${b.player?.padEnd(22)} ${b.prop?.padEnd(28)}  Δ${(b.delta * 100).toFixed(1)}¢`)
    })
  }

  // Book CLV leaders (rolling)
  if (s.clvByBook?.length) {
    console.log(`\n  CLV BY BOOK (tonight):`)
    s.clvByBook.forEach((b) => {
      console.log(`    ${b.book?.padEnd(14)}  avgCLV:${b.avgClvPct >= 0 ? "+" : ""}${b.avgClvPct}¢  (${b.count} bets)`)
    })
  }

  // Archetype shifts
  const arch = s.archetypeShifts || {}
  const archEntries = Object.entries(arch).filter(([, v]) => v && (v.hit || v.miss))
  if (archEntries.length) {
    console.log(`\n  ARCHETYPE SHIFTS:`)
    archEntries.slice(0, 5).forEach(([type, v]) => {
      console.log(`    ${type.padEnd(28)} hit:${v.hit || 0}  miss:${v.miss || 0}`)
    })
  }

  // AI Slip construction
  const aiSlipResult = steps?.reports?.aiSlipResult
  if (aiSlipResult?.summary) {
    console.log(`\n  AI SLIPS  ${aiSlipResult.summary}`)
    for (const tier of ["safe", "balanced", "aggressive", "lotto"]) {
      const slips = aiSlipResult.slips?.[tier] || []
      if (!slips.length) continue
      const top = slips[0]
      const americ = top.combinedAmericanOdds >= 0 ? `+${top.combinedAmericanOdds}` : `${top.combinedAmericanOdds}`
      console.log(`    ${tier.toUpperCase().padEnd(11)} ${americ.padEnd(7)} ev:${(top.ev * 100).toFixed(0)}%  ${top.reasoning}`)
    }
  }

  // Portfolio optimization
  const portfolioResult = steps?.reports?.portfolioResult
  if (portfolioResult?.score != null) {
    console.log(`\n  PORTFOLIO SCORE  ${portfolioResult.score}/100  [${portfolioResult.grade}]`)
    if (portfolioResult.warnings?.length) {
      portfolioResult.warnings.slice(0, 4).forEach((w) => console.log(`    ${w}`))
    }
  }

  // Timing intelligence
  const timingReport = steps?.reports?.timingReport
  if (timingReport?.urgentPlays?.length) {
    console.log(`\n  TIMING — URGENT PLAYS:`)
    timingReport.urgentPlays.slice(0, 6).forEach((c) => {
      const sig = (c.signals || []).slice(0, 2).join(", ")
      console.log(`    [${(c.urgency || "").padEnd(9)}] ${(c.player || "").padEnd(22)} ${(c.prop || "").padEnd(30)}  ${sig}`)
    })
  }
  if (timingReport?.statTimingProfiles?.length) {
    console.log(`\n  TIMING PROFILES (early vs close CLV):`)
    timingReport.statTimingProfiles.slice(0, 5).forEach((p) => {
      const e = p.earlyAvgClv  != null ? `${(p.earlyAvgClv*100).toFixed(1)}¢`  : "n/a"
      const c2= p.closingAvgClv!= null ? `${(p.closingAvgClv*100).toFixed(1)}¢` : "n/a"
      console.log(`    ${(p.statFamily || "").padEnd(20)} early:${e.padEnd(8)} close:${c2.padEnd(8)} → ${p.verdict}`)
    })
  }

  // Step health
  const health = s.stepHealth || {}
  const errors = Object.entries(health).filter(([, v]) => String(v).startsWith("error"))
  if (errors.length) {
    console.log(`\n  STEP ERRORS:`)
    errors.forEach(([step, msg]) => console.log(`    ${step}: ${msg}`))
  }

  console.log(`\n${"─".repeat(60)}`)
  const summaryPath = path.join(__dirname, `../backend/runtime/tracking/nightly_review_${s.date}.json`)
  if (fs.existsSync(summaryPath)) console.log(`  Summary → ${summaryPath}`)
  console.log("")
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv)

  // Load bet/leg result files
  for (const f of args.files) {
    const obj = loadJsonFile(path.resolve(f.file))
    if (f.kind === "bets") Object.assign(args.bets, obj)
    else                   Object.assign(args.legs, obj)
  }
  for (const p of args.actualsFiles) {
    Object.assign(args.actuals, loadJsonFile(path.resolve(p)))
  }
  for (const p of args.closingFiles) {
    Object.assign(args.closingLines, loadJsonFile(path.resolve(p)))
  }

  // ── check-only mode ──────────────────────────────────────────────────────────
  if (args.checkOnly) {
    const sports = args.sport === "all" ? ["nba", "mlb"] : [args.sport]
    for (const sport of sports) {
      const c = detectSlateCompletion(sport, args.date)
      const icon = c.ready === true ? "✓" : c.ready === "partial" ? "⚠" : "✗"
      console.log(`[${icon}] ${sport.toUpperCase()}  ${args.date}  ready:${c.ready}  settled:${c.settledCount}  pending:${c.pendingCount}  — ${c.reason}`)
    }
    return
  }

  // ── single or multi-sport run ─────────────────────────────────────────────
  if (args.sport === "all") {
    console.log(`[nightly] Running both sports for ${args.date}...`)
    const results = await runNightlyReviewAll({
      date:         args.date,
      bets:         args.bets,
      legs:         args.legs,
      actuals:      args.actuals,
      closingLines: args.closingLines,
      defaultStake: args.defaultStake,
      force:        args.force,
      dryRun:       args.dryRun,
      verbose:      args.verbose,
    })
    for (const [sport, result] of Object.entries(results)) {
      printSummary(result)
    }
  } else {
    const result = runNightlyReview({
      sport:        args.sport,
      date:         args.date,
      bets:         args.bets,
      legs:         args.legs,
      actuals:      args.actuals,
      closingLines: args.closingLines,
      defaultStake: args.defaultStake,
      force:        args.force,
      dryRun:       args.dryRun,
      verbose:      args.verbose,
    })
    printSummary(result)
    if (!result.ok && !result.deferred) process.exitCode = 1
  }
}

main().catch((err) => {
  console.error("[nightlyReview] fatal:", err?.message || err)
  process.exitCode = 1
})
