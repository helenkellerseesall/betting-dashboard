#!/usr/bin/env node
"use strict"

/**
 * Daily Intelligence Review CLI (Session W)
 *
 * Runs the full intelligence review pipeline for one or all sports.
 * Answers the 18 daily intelligence questions, computes calibration,
 * grades ecosystems, detects eruptions, classifies process quality.
 *
 * Usage:
 *   node backend/scripts/runDailyReview.js --sport=mlb --date=2026-05-08
 *   node backend/scripts/runDailyReview.js --sport=nba
 *   node backend/scripts/runDailyReview.js --sport=all
 *   node backend/scripts/runDailyReview.js --sport=mlb --dry-run
 *   node backend/scripts/runDailyReview.js --sport=mlb --verbose
 *
 * Flags:
 *   --sport=<nba|mlb|all>    Sport to review (default: all)
 *   --date=YYYY-MM-DD        Date to review (default: today)
 *   --dry-run                Skip SQLite writes
 *   --verbose                Print step-level timings
 *   --json                   Output full report JSON to stdout
 *   --summary                Print human-readable summary only
 *
 * Output:
 *   - SQLite: writes to daily_intelligence_reports + supporting tables
 *   - JSON file: backend/runtime/tracking/daily_intelligence_review_<sport>_<date>.json
 *   - Stdout: summary or JSON depending on flags
 */

const path = require("path")

const {
  runDailyIntelligenceReview,
  writeDailyReportFile,
} = require("../pipeline/review/buildDailyIntelligenceReview")

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {}
  for (const arg of argv.slice(2)) {
    const [key, val] = arg.replace(/^--/, "").split("=")
    args[key] = val !== undefined ? val : true
  }
  return args
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// ── Human-readable summary printer ───────────────────────────────────────────

function printSummary(report) {
  if (!report || !report.ok) {
    console.log(`\n[${report?.sport}/${report?.date}] ✗ No data or review failed: ${report?.reason || "unknown"}`)
    return
  }

  const { sport, date, grades, answers, calibration, ecology, volatility, eruptions, process: proc } = report

  console.log(`\n${"═".repeat(70)}`)
  console.log(`  DAILY INTELLIGENCE REVIEW — ${String(sport).toUpperCase()} — ${date}`)
  console.log(`${"═".repeat(70)}`)

  // Grades
  console.log(`\n  GRADES`)
  console.log(`    Model:       ${grades.model}`)
  console.log(`    Ecology:     ${grades.ecology}`)
  console.log(`    Calibration: ${grades.calibration}`)
  console.log(`    Volatility:  ${grades.volatility}`)
  console.log(`    Overall:     ${grades.overall}`)

  // Summary numbers
  const { settledCount, hitCount, hitRate } = answers
  console.log(`\n  OUTCOMES`)
  console.log(`    Settled: ${settledCount}  Hit: ${hitCount}  Rate: ${hitRate != null ? (hitRate * 100).toFixed(1) + "%" : "N/A"}`)

  // Calibration
  if (calibration && calibration.sampleCount >= 4) {
    console.log(`\n  CALIBRATION`)
    console.log(`    Brier Score: ${calibration.brierScore?.toFixed(4) ?? "N/A"}  (0=perfect, 0.25=no skill)`)
    console.log(`    ECE:         ${calibration.ece?.toFixed(4) ?? "N/A"}  (0=perfect)`)
    console.log(`    Brier Skill: ${calibration.brierSkill?.toFixed(4) ?? "N/A"}  (>0=beating baseline)`)
    console.log(`    Samples:     ${calibration.sampleCount}`)
  }

  // Ecology
  if (ecology && ecology.hr) {
    const hr = ecology.hr
    console.log(`\n  HR ECOLOGY`)
    console.log(`    Candidates: ${hr.hrCandidates}  In slips: ${hr.hrInSlips}  Hits: ${hr.hrHits}`)
    console.log(`    Conversion: ${hr.hrConversionRate != null ? (hr.hrConversionRate * 100).toFixed(1) + "%" : "N/A"}`)
    if (hr.hrEruptionMiss) {
      console.log(`    ⚠️  HR ERUPTION MISS DETECTED`)
    }
  }

  if (ecology && ecology.suppression) {
    const s = ecology.suppression
    console.log(`\n  SUPPRESSION ANALYSIS`)
    console.log(`    Suppressed winners: ${s.suppressedWinners} / ${s.suppressedTotal} filtered candidates`)
    if (s.suppressionMissRate != null) {
      console.log(`    Miss rate: ${(s.suppressionMissRate * 100).toFixed(1)}%`)
    }
  }

  // Volatility
  if (volatility) {
    console.log(`\n  VOLATILITY`)
    console.log(`    Realization Score (VRS): ${volatility.volatilityRealizationScore?.toFixed(3) ?? "N/A"}`)
    const iva = volatility.impliedVsActual
    if (iva) {
      console.log(`    Model vs Actual: ${iva.modelVsActual?.toFixed(4) ?? "N/A"} (${iva.interpretation?.modelOverconfident ? "overconfident" : "underconfident or calibrated"})`)
      console.log(`    Market vs Actual: ${iva.impliedVsActual?.toFixed(4) ?? "N/A"} (${iva.interpretation?.marketOverpriced ? "market overpriced" : "market underpriced"})`)
    }
    // Per-tier
    for (const tier of ["safe", "balanced", "aggressive", "lotto"]) {
      const t = volatility.tierStats?.[tier]
      if (t && t.settled >= 2) {
        console.log(`    ${tier.padEnd(10)}: hit=${t.hitRate != null ? (t.hitRate * 100).toFixed(1) + "%" : "N/A"}  |delta|=${t.avgAbsDelta ?? "N/A"}  n=${t.settled}`)
      }
    }
  }

  // Eruptions
  if (eruptions && eruptions.events.length > 0) {
    console.log(`\n  ERUPTION EVENTS (${eruptions.events.length})`)
    for (const e of eruptions.events.slice(0, 5)) {
      const missed = e.wasMissed ? "❌ MISSED" : "✓ covered"
      console.log(`    [${e.eruptionType}] ${e.matchup} — score=${e.eruptionScore} overs_hit=${e.hittingOvers} ${missed}`)
    }
  }

  // Process archetype breakdown
  if (proc && proc.summary && proc.summary.counts) {
    console.log(`\n  PROCESS ARCHETYPES`)
    const counts = proc.summary.counts
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a)
    for (const [arch, n] of sorted.slice(0, 8)) {
      console.log(`    ${arch.padEnd(35)}: ${n}`)
    }
    console.log(`    Avg process score: ${proc.summary.avgProcessScore?.toFixed(3) ?? "N/A"}`)
    if (proc.summary.suppressedWinners > 0) {
      console.log(`    ⚠️  Suppressed winners: ${proc.summary.suppressedWinners}`)
    }
  }

  // What we got right
  if (answers.gotRight?.length) {
    console.log(`\n  ✓ WHAT WE GOT RIGHT`)
    for (const r of answers.gotRight) console.log(`    • ${r}`)
  }

  // What we got wrong
  if (answers.gotWrong?.length) {
    console.log(`\n  ✗ WHAT WE GOT WRONG`)
    for (const r of answers.gotWrong) console.log(`    • ${r}`)
  }

  // Major findings
  const major = report.majorFindings || []
  if (major.length) {
    console.log(`\n  ⚠️  MAJOR INTELLIGENCE FINDINGS (${major.length})`)
    for (const f of major) console.log(`    🚨 ${f}`)
  }

  // Props to survive
  if (answers.propsToSurvive?.length) {
    console.log(`\n  PROPS THAT SHOULD HAVE SURVIVED RANKING`)
    for (const p of answers.propsToSurvive.slice(0, 5)) {
      console.log(`    ${p.player} ${p.statFamily} ${p.side} | edge=${p.edge?.toFixed(3)} tier=${p.tier}`)
    }
  }

  // Overperforming ecologies
  if (answers.overperformingEcologies?.length) {
    console.log(`\n  OVERPERFORMING ECOLOGY BUCKETS`)
    for (const e of answers.overperformingEcologies) {
      console.log(`    ${e.bucket.padEnd(20)}: ${(e.hitRate * 100).toFixed(1)}% (n=${e.count})`)
    }
  }

  // Underperforming ecologies
  if (answers.underperformingEcologies?.length) {
    console.log(`\n  UNDERPERFORMING ECOLOGY BUCKETS`)
    for (const e of answers.underperformingEcologies) {
      console.log(`    ${e.bucket.padEnd(20)}: ${(e.hitRate * 100).toFixed(1)}% (n=${e.count})`)
    }
  }

  // Persist status
  console.log(`\n  Persist: ${report.persist?.ok ? "✓ SQLite written" : "✗ " + (report.persist?.reason || "not written")}`)
  console.log(`  Elapsed: ${report.elapsedMs}ms`)
  console.log(`${"─".repeat(70)}\n`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv)
  const sportArg = args.sport || "all"
  const date     = args.date || todayKey()
  const dryRun   = !!args["dry-run"]
  const verbose  = !!args.verbose
  const jsonOut  = !!args.json
  const summaryOnly = !!args.summary

  const sports = sportArg === "all" ? ["nba", "mlb"] : [sportArg]

  if (!jsonOut) {
    console.log(`Daily Intelligence Review — ${sports.join(", ")} — ${date}${dryRun ? " (DRY RUN)" : ""}`)
  }

  const results = {}

  for (const sport of sports) {
    const result = runDailyIntelligenceReview({ sport, date, write: !dryRun, verbose })
    results[sport] = result

    // Write JSON file (atomic)
    if (!dryRun && result.ok) {
      const fw = writeDailyReportFile(sport, date, result)
      if (!jsonOut) {
        console.log(`[${sport}] Report file: ${fw.ok ? fw.path : "FAILED: " + fw.reason}`)
      }
    }

    if (jsonOut) {
      // JSON output — caller parses stdout
      process.stdout.write(JSON.stringify(result, null, 2) + "\n")
    } else if (summaryOnly) {
      printSummary(result)
    } else {
      printSummary(result)
    }
  }

  // Exit code: 0 if any sport succeeded
  const anyOk = Object.values(results).some((r) => r.ok)
  process.exitCode = anyOk ? 0 : 1
}

main().catch((err) => {
  console.error("runDailyReview fatal:", err)
  process.exit(1)
})
