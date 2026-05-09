"use strict"

/**
 * Daily Intelligence Review Engine (Session W)
 *
 * Orchestrates all intelligence review modules for one (sport, date).
 *
 * Answers the 18 daily intelligence questions:
 *
 *   DAILY REVIEW ANSWERS:
 *    1. What did we get right?
 *    2. What did we get wrong?
 *    3. WHY?
 *    4. Which ecosystems overperformed?
 *    5. Which ecosystems underperformed?
 *    6. Which props should have survived ranking?
 *    7. Which props should have died?
 *    8. Which volatility assumptions failed?
 *    9. Which offensive environments erupted?
 *   10. Which suppression environments held?
 *   11. Which books were sharp?
 *   12. Which books lagged?
 *   13. Which steam signals mattered?
 *   14. Which fake steam signals failed?
 *
 *   ECOLOGY REVIEW:
 *   15. HR ecosystem conversion rate + eruption miss detection
 *   16. Ladder conversion rates
 *   17. RBI chain hit rate
 *   18. Slip structure ecology performance
 *
 * Execution:
 *   1. Load tracked bets + slips for (sport, date)
 *   2. Run calibration metrics (Brier/ECE)
 *   3. Run ecology grader (bucket hit rates, HR suppression)
 *   4. Run volatility review (VRS, implied-vs-actual)
 *   5. Run offensive eruption analysis (eruption events)
 *   6. Run process classifier (per-bet archetypes)
 *   7. Assemble daily intelligence report
 *   8. Persist to SQLite (daily_intelligence_reports + supporting tables)
 *   9. Return structured report
 *
 * Design:
 *   - Additive only — never modifies existing tracking files
 *   - Graceful degradation — any module failure degrades to null, never crashes
 *   - Idempotent — can be re-run; SQLite uses INSERT OR REPLACE
 *   - JSON files remain canonical; this is analytics-only layer
 */

const fs   = require("fs")
const path = require("path")

const { computeCalibration, gradeCalibration }         = require("./buildCalibrationMetrics")
const { gradeEcologyForDay }                           = require("./buildEcologyGrader")
const { reviewVolatility }                             = require("./buildVolatilityReview")
const { analyzeOffensiveEruptions }                    = require("./buildOffensiveEruptionAnalysis")
const {
  classifyAllBets,
  buildSlippedSet,
  buildEruptionEventIds,
  summarizeProcessClassifications,
}                                                      = require("./buildProcessClassifier")

const TRACKING_DIR = path.join(__dirname, "..", "..", "runtime", "tracking")

// ── Utilities ─────────────────────────────────────────────────────────────────

function readJsonSafe(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch (_) {
    return fallback
  }
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function safeTry(label, fn) {
  try {
    return fn()
  } catch (err) {
    console.warn(`[daily-intel-review] ${label} failed (non-fatal):`, err.message)
    return null
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadTrackingData(sport, date) {
  const key = String(sport).toLowerCase()

  const bets = readJsonSafe(
    path.join(TRACKING_DIR, `${key}_tracked_bets_${date}.json`),
    []
  ) || []

  const best = (() => {
    const raw = readJsonSafe(
      path.join(TRACKING_DIR, `${key}_tracked_best_${date}.json`),
      null
    )
    return Array.isArray(raw) ? raw : (raw?.entries || raw?.bets || [])
  })()

  const slips = readJsonSafe(
    path.join(TRACKING_DIR, `${key}_tracked_slips_${date}.json`),
    []
  ) || []

  const review = readJsonSafe(
    path.join(TRACKING_DIR, `post_game_review_${key}_${date}.json`),
    null
  )

  return { bets, best, slips, review }
}

// ── Calibration samples prep ──────────────────────────────────────────────────

/**
 * Convert tracked bets to calibration samples.
 * Only bets with modelProb AND settled result are included.
 */
function betsToCalibrationSamples(bets) {
  return bets
    .map((b) => {
      const r = String(b.result || "").toLowerCase()
      let hit = null
      if (r === "win") hit = 1
      else if (r === "loss") hit = 0
      else {
        // Infer from actualStat vs line
        const stat = num(b.actualStat)
        const line = num(b.line)
        const side = String(b.side || "").toLowerCase()
        if (Number.isFinite(stat) && Number.isFinite(line)) {
          if (side.startsWith("o")) hit = stat > line ? 1 : 0
          else if (side.startsWith("u")) hit = stat < line ? 1 : 0
        }
      }

      const p = num(b.modelProb)
      if (hit === null || p === null) return null

      return {
        modelProb: p,
        hit,
        statFamily: b.statFamily,
        tier: b.tier,
        volatility: b.volatility,
        ecologyBucket: b.ecologyBucket,
      }
    })
    .filter(Boolean)
}

// ── Overall grade computation ─────────────────────────────────────────────────

function gradeToScore(g) {
  return g === "A" ? 5 : g === "B" ? 4 : g === "C" ? 3 : g === "D" ? 2 : g === "F" ? 1 : 3
}

function scoreToGrade(s) {
  return s >= 4.5 ? "A" : s >= 3.5 ? "B" : s >= 2.5 ? "C" : s >= 1.5 ? "D" : "F"
}

function computeOverallGrade(grades) {
  const validGrades = Object.values(grades).filter(
    (g) => g && g !== "N/A" && ["A", "B", "C", "D", "F"].includes(g)
  )
  if (!validGrades.length) return "N/A"
  const avg = validGrades.reduce((a, g) => a + gradeToScore(g), 0) / validGrades.length
  return scoreToGrade(avg)
}

// ── Answer the 18 daily questions ─────────────────────────────────────────────

function buildDailyAnswers({
  bets,
  slips,
  calibration,
  ecologyResult,
  volatilityResult,
  eruptionResult,
  processResult,
  sport,
  date,
}) {
  const settled = bets.filter((b) => {
    const r = String(b.result || "").toLowerCase()
    return r === "win" || r === "loss" || r === "push" || r === "void"
  })
  const wins = settled.filter((b) => String(b.result || "").toLowerCase() === "win")
  const losses = settled.filter((b) => String(b.result || "").toLowerCase() === "loss")
  const hitRate = settled.length > 0 ? round4(wins.length / settled.length) : null

  // Q1: What did we get right?
  const gotRight = []
  if (ecologyResult?.grade?.grade === "A" || ecologyResult?.grade?.grade === "B") {
    gotRight.push("Ecology selection quality above average")
  }
  if (calibration?.brierSkill != null && calibration.brierSkill > 0.05) {
    gotRight.push(`Model calibration beating baseline (BSS=${calibration.brierSkill.toFixed(3)})`)
  }
  if (volatilityResult?.volatilityRealizationScore != null && volatilityResult.volatilityRealizationScore >= 0.5) {
    gotRight.push(`Volatility tier ordering realized (VRS=${volatilityResult.volatilityRealizationScore.toFixed(3)})`)
  }
  if (eruptionResult?.summary?.coverageRate != null && eruptionResult.summary.coverageRate >= 0.7) {
    gotRight.push(`Covered ${Math.round(eruptionResult.summary.coverageRate * 100)}% of eruption games with slip exposure`)
  }

  // Q2: What did we get wrong?
  const gotWrong = []
  const majorFindings = [
    ...(ecologyResult?.majorFindings || []),
    ...(eruptionResult?.majorFindings || []),
  ]
  gotWrong.push(...majorFindings)
  if (calibration?.ece != null && calibration.ece > 0.10) {
    gotWrong.push(`Calibration drift: ECE=${calibration.ece.toFixed(4)} (poor confidence alignment)`)
  }
  if (volatilityResult?.impliedVsActual?.modelVsActual != null &&
      Math.abs(volatilityResult.impliedVsActual.modelVsActual) > 0.12) {
    const bias = volatilityResult.impliedVsActual.modelVsActual > 0 ? "overconfident" : "underconfident"
    gotWrong.push(`Model ${bias} by ${Math.abs(volatilityResult.impliedVsActual.modelVsActual * 100).toFixed(1)}% on average`)
  }

  // Q3: WHY? — process archetype breakdown
  const whyAnalysis = processResult?.summary?.counts || {}

  // Q4-5: Ecology over/underperformance
  const buckets = ecologyResult?.buckets || {}
  const ecologyRanked = Object.entries(buckets)
    .filter(([, v]) => v.settled >= 3)
    .sort(([, a], [, b]) => (b.hitRate || 0) - (a.hitRate || 0))

  const overperformingEcologies = ecologyRanked
    .filter(([, v]) => v.hitRate != null && v.hitRate >= 0.55)
    .map(([k, v]) => ({ bucket: k, hitRate: v.hitRate, count: v.settled }))

  const underperformingEcologies = ecologyRanked
    .filter(([, v]) => v.hitRate != null && v.hitRate < 0.45)
    .map(([k, v]) => ({ bucket: k, hitRate: v.hitRate, count: v.settled }))

  // Q6-7: Props that should have survived / died
  const suppressed = ecologyResult?.suppression?.topSuppressedWinners || []
  const propsToSurvive = suppressed.slice(0, 8)

  const badProcessWins = (processResult?.classified || [])
    .filter((c) => c.processPrimary === "bad_process_lucky_hit")
    .slice(0, 6)
  const propsToDie = badProcessWins.map((c) => ({
    player: c.player,
    statFamily: c.statFamily,
    side: c.side,
    edge: c.edge,
    reason: c.rationale,
  }))

  // Q8: Volatility failures
  const volFailures = []
  const { tierStats = {} } = volatilityResult || {}
  for (const [tier, stats] of Object.entries(tierStats)) {
    if (stats.hitRate != null && stats.hitRate < 0.40 && stats.settled >= 3) {
      volFailures.push({ tier, hitRate: stats.hitRate, count: stats.settled })
    }
  }

  // Q9: Erupting environments
  const eruptingEnvironments = (eruptionResult?.events || [])
    .filter((e) => e.eruptionScore >= 0.3)
    .slice(0, 8)
    .map((e) => ({
      matchup: e.matchup,
      type: e.eruptionType,
      score: e.eruptionScore,
      hittingOvers: e.hittingOvers,
      wasCovered: e.wasPredicted === 1,
    }))

  // Q10: Suppression environments that held
  const suppressionHeld = (processResult?.classified || [])
    .filter((c) => c.processPrimary === "good_process_bad_variance")
    .slice(0, 6)
    .map((c) => ({
      player: c.player,
      statFamily: c.statFamily,
      delta: c.delta,
      processScore: c.processScore,
    }))

  // Q11-14: Book / steam intelligence
  // (Placeholders — populated by buildLineShoppingIntelligence data when passed)
  const steamMatters = []
  const fakeSteem = []

  return {
    // High-level
    sport,
    date,
    totalBets: bets.length,
    settledCount: settled.length,
    hitCount: wins.length,
    missCount: losses.length,
    hitRate,
    // Answers
    gotRight,
    gotWrong,
    whyBreakdown: whyAnalysis,
    overperformingEcologies,
    underperformingEcologies,
    propsToSurvive,
    propsToDie,
    volatilityFailures: volFailures,
    eruptingEnvironments,
    suppressionHeld,
    steamMatters,
    fakeSteam: fakeSteem,
    // Major alert-level findings
    majorFindings,
  }
}

// ── SQLite persistence ────────────────────────────────────────────────────────

function persistToSqlite({ sport, date, report, calResult, ecoResult, volResult, eruptResult, procResult }) {
  try {
    const { tryGetDb } = require("../../storage/db")
    const { applyReviewSchema } = require("../../storage/reviewSchema")
    const db = tryGetDb()
    if (!db) return { ok: false, reason: "db_unavailable" }

    applyReviewSchema(db)

    const id = `${sport}_${date}`
    const now = new Date().toISOString()

    db.exec("BEGIN")
    try {
      // daily_intelligence_reports
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO daily_intelligence_reports (
          id, sport, run_date, generated_at,
          total_candidates, settled_count, hit_count, miss_count, hit_rate,
          brier_score, expected_cal_error, avg_confidence, avg_edge,
          model_grade, ecology_grade, calibration_grade, volatility_grade, overall_grade,
          ecology_grades_json, process_counts_json, volatility_summary_json,
          eruption_summary_json, suppressed_winners_json, major_findings_json,
          raw_json, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      stmt.run(
        id, sport, date, now,
        report.totalBets, report.settledCount, report.hitCount, report.missCount, report.hitRate,
        calResult?.brierScore ?? null,
        calResult?.ece ?? null,
        calResult?.avgConfidence ?? null,
        null,  // avg_edge computed from bets
        report.grades?.model ?? null,
        report.grades?.ecology ?? null,
        report.grades?.calibration ?? null,
        report.grades?.volatility ?? null,
        report.grades?.overall ?? null,
        JSON.stringify(ecoResult?.buckets ?? null),
        JSON.stringify(procResult?.summary?.counts ?? null),
        JSON.stringify(volResult?.tierStats ?? null),
        JSON.stringify(eruptResult?.summary ?? null),
        JSON.stringify(report.answers?.propsToSurvive ?? null),
        JSON.stringify(report.answers?.majorFindings ?? null),
        JSON.stringify(report),
        now
      )

      // calibration_records
      if (calResult && calResult.sampleCount >= 4) {
        const cStmt = db.prepare(`
          INSERT OR REPLACE INTO calibration_records (
            id, sport, run_date, sample_count,
            brier_score, brier_skill, ece, mce,
            avg_confidence, avg_hit_rate, sharpness, resolution,
            reliability_json, by_stat_json, by_tier_json,
            calibration_grade, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `)
        cStmt.run(
          id, sport, date, calResult.sampleCount,
          calResult.brierScore ?? null,
          calResult.brierSkill ?? null,
          calResult.ece ?? null,
          calResult.mce ?? null,
          calResult.avgConfidence ?? null,
          calResult.avgHitRate ?? null,
          calResult.sharpness ?? null,
          calResult.resolution ?? null,
          JSON.stringify(calResult.reliability ?? null),
          JSON.stringify(calResult.byStat ?? null),
          JSON.stringify(calResult.byTier ?? null),
          report.grades?.calibration ?? null,
          now
        )
      }

      // ecology_grades
      if (ecoResult) {
        const eco = ecoResult
        const buckets = eco.buckets || {}
        const eStmt = db.prepare(`
          INSERT OR REPLACE INTO ecology_grades (
            id, sport, run_date,
            anchors_hit_rate, anchors_count,
            tonight_best_hit_rate, tonight_best_count,
            smart_aggr_hit_rate, smart_aggr_count,
            safest_hit_rate, safest_count,
            ai_slip_hit_rate, ai_slip_count,
            pool_hit_rate, pool_count,
            hr_candidates, hr_in_slips, hr_hits,
            hr_conversion_rate, hr_suppressed_winners, hr_eruption_miss,
            ladder_candidates, ladder_hits, ladder_hit_rate,
            rbi_chain_candidates, rbi_chain_hits, rbi_chain_rate,
            suppressed_winners, suppressed_total, suppression_miss_rate,
            ecology_grade, major_findings_json, grade_rationale,
            raw_json, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `)
        eStmt.run(
          id, sport, date,
          buckets.anchors?.hitRate ?? null, buckets.anchors?.count ?? 0,
          (buckets.tonightsbest ?? buckets["tonight'sbest"])?.hitRate ?? null,
          (buckets.tonightsbest ?? buckets["tonight'sbest"])?.count ?? 0,
          buckets.smartaggression?.hitRate ?? null, buckets.smartaggression?.count ?? 0,
          buckets.safest?.hitRate ?? null, buckets.safest?.count ?? 0,
          buckets.aislip?.hitRate ?? null, buckets.aislip?.count ?? 0,
          buckets.pool?.hitRate ?? null, buckets.pool?.count ?? 0,
          eco.hr?.hrCandidates ?? 0,
          eco.hr?.hrInSlips ?? 0,
          eco.hr?.hrHits ?? 0,
          eco.hr?.hrConversionRate ?? null,
          eco.hr?.suppressedHrWinners ?? 0,
          eco.hr?.hrEruptionMiss ? 1 : 0,
          eco.ladder?.ladderCandidates ?? 0,
          eco.ladder?.ladderHits ?? 0,
          eco.ladder?.ladderHitRate ?? null,
          eco.rbi?.rbiChainCandidates ?? 0,
          eco.rbi?.rbiChainHits ?? 0,
          eco.rbi?.rbiChainRate ?? null,
          eco.suppression?.suppressedWinners ?? 0,
          eco.suppression?.suppressedTotal ?? 0,
          eco.suppression?.suppressionMissRate ?? null,
          report.grades?.ecology ?? null,
          JSON.stringify(eco.majorFindings ?? []),
          eco.grade?.rationale ?? null,
          JSON.stringify(eco),
          now
        )
      }

      // volatility_realizations
      if (volResult) {
        const vStmt = db.prepare(`
          INSERT OR REPLACE INTO volatility_realizations (
            id, sport, run_date,
            safe_json, balanced_json, aggressive_json, lotto_json,
            vrs,
            avg_implied_prob, avg_model_prob, avg_actual_rate,
            implied_vs_actual, model_vs_actual,
            volatility_grade, grade_rationale,
            raw_json, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `)
        const iva = volResult.impliedVsActual
        vStmt.run(
          id, sport, date,
          JSON.stringify(volResult.tierStats?.safe ?? null),
          JSON.stringify(volResult.tierStats?.balanced ?? null),
          JSON.stringify(volResult.tierStats?.aggressive ?? null),
          JSON.stringify(volResult.tierStats?.lotto ?? null),
          volResult.volatilityRealizationScore ?? null,
          iva?.avgImpliedProb ?? null,
          iva?.avgModelProb ?? null,
          iva?.avgActualRate ?? null,
          iva?.impliedVsActual ?? null,
          iva?.modelVsActual ?? null,
          report.grades?.volatility ?? null,
          volResult.grade?.rationale ?? null,
          JSON.stringify(volResult),
          now
        )
      }

      // eruption_events
      for (const event of eruptResult?.events || []) {
        const eid = `${sport}_${date}_${String(event.eventId || event.matchup || "unk").replace(/[^a-z0-9_]/gi, "_")}`
        const eeStmt = db.prepare(`
          INSERT OR REPLACE INTO eruption_events (
            id, sport, run_date, event_id, matchup,
            total_over_bets, settling_overs, hitting_overs, eruption_score,
            hr_eruption, hr_in_pool, hr_in_slips, hr_eruption_miss,
            implied_team_total, park_factor, wind_out,
            eruption_type, was_predicted, was_missed,
            eruptors_json, raw_json, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `)
        eeStmt.run(
          eid, sport, date,
          event.eventId ?? null, event.matchup ?? null,
          event.totalOverBets ?? 0, event.settlingOvers ?? 0, event.hittingOvers ?? 0,
          event.eruptionScore ?? null,
          event.hrEruption ?? 0, event.hrInPool ?? 0, event.hrInSlips ?? 0,
          event.hrEruptionMiss ?? 0,
          event.impliedTeamTotal ?? null, event.parkFactor ?? null, event.windOut ?? 0,
          event.eruptionType ?? null,
          event.wasPredicted ?? 0, event.wasMissed ?? 0,
          JSON.stringify(event.eruptors ?? []),
          JSON.stringify(event),
          now
        )
      }

      // process_classifications — persist top findings only to stay lean
      const processRows = (procResult?.classified || [])
        .filter((c) => c.processPrimary && c.processPrimary !== "pending")
        .slice(0, 200)  // cap at 200 rows per day

      for (const c of processRows) {
        const pid = c.id || `${sport}_${date}_${String(c.player || "").toLowerCase().replace(/\s+/g, "_")}_${String(c.statFamily || "").toLowerCase()}`
        const pStmt = db.prepare(`
          INSERT OR REPLACE INTO process_classifications (
            id, sport, run_date, player, stat_family, side, line,
            model_prob, edge, tier, volatility, ecology_bucket,
            hit, actual_value, delta, signed_delta,
            process_primary, process_secondary, process_score,
            is_suppressed_winner, is_eruption_miss, is_fake_sharp,
            is_stale_line, is_correlated,
            rationale, raw_json, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `)
        pStmt.run(
          pid, sport, date,
          c.player ?? null, c.statFamily ?? null, c.side ?? null, c.line ?? null,
          c.modelProb ?? null, c.edge ?? null, c.tier ?? null,
          c.volatility ?? null, c.ecologyBucket ?? null,
          c.hit ?? null, c.actualValue ?? null, c.delta ?? null, c.signedDelta ?? null,
          c.processPrimary ?? null, c.processSecondary ?? null, c.processScore ?? null,
          c.flags?.isSuppressedWinner ?? 0,
          c.flags?.isEruptionMiss ?? 0,
          c.flags?.isFakeSharp ?? 0,
          c.flags?.isStaleLine ?? 0,
          c.flags?.isCorrelated ?? 0,
          c.rationale ?? null,
          JSON.stringify(c),
          now
        )
      }

      db.exec("COMMIT")
      return { ok: true, tablesWritten: ["daily_intelligence_reports", "calibration_records", "ecology_grades", "volatility_realizations", "eruption_events", "process_classifications"] }
    } catch (inner) {
      db.exec("ROLLBACK")
      throw inner
    }
  } catch (err) {
    console.warn("[daily-intel-review] SQLite persistence failed (non-fatal):", err.message)
    return { ok: false, reason: err.message }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run the complete daily intelligence review for one (sport, date).
 *
 * @param {object}  opts
 * @param {string}  opts.sport      — "nba" | "mlb"
 * @param {string}  opts.date       — "YYYY-MM-DD"
 * @param {boolean} [opts.write]    — persist to SQLite (default true)
 * @param {boolean} [opts.dryRun]   — skip writes
 * @param {boolean} [opts.verbose]  — log step timings
 *
 * @returns {object} full intelligence report
 */
function runDailyIntelligenceReview(opts = {}) {
  const sport   = String(opts.sport || "mlb").toLowerCase()
  const date    = opts.date || new Date().toISOString().slice(0, 10)
  const write   = opts.dryRun ? false : (opts.write !== false)
  const verbose = !!opts.verbose

  const t0 = Date.now()
  const log = verbose ? (msg) => console.log(`[daily-intel-review/${sport}/${date}] ${msg}`) : () => {}

  log("Starting")

  // ── Load data ───────────────────────────────────────────────────────────────
  const { bets, best, slips } = safeTry("load", () => loadTrackingData(sport, date)) || { bets: [], best: [], slips: [] }

  if (!bets.length) {
    log("No tracking data found — returning empty report")
    return {
      ok: false,
      sport, date,
      reason: "no_tracking_data",
      report: null,
    }
  }

  log(`Loaded: ${bets.length} bets, ${slips.length} slips`)

  // ── Step 1: Calibration metrics ─────────────────────────────────────────────
  const calSamples = betsToCalibrationSamples(bets)
  const calResult  = safeTry("calibration", () => computeCalibration(calSamples))
  const calGrade   = safeTry("calibration_grade", () => gradeCalibration(calResult)) || { grade: "N/A" }
  log(`Calibration: BS=${calResult?.brierScore?.toFixed(4) ?? "N/A"}, ECE=${calResult?.ece?.toFixed(4) ?? "N/A"} grade=${calGrade.grade}`)

  // ── Step 2: Ecology grading ──────────────────────────────────────────────────
  const allCandidates = [...bets, ...best]
  const ecoResult = safeTry("ecology", () => gradeEcologyForDay({ bets, slips, candidatePool: allCandidates }))
  log(`Ecology: grade=${ecoResult?.grade?.grade ?? "N/A"} majorFindings=${ecoResult?.majorFindings?.length ?? 0}`)

  // ── Step 3: Volatility review ───────────────────────────────────────────────
  const volResult = safeTry("volatility", () => reviewVolatility({ bets }))
  log(`Volatility: VRS=${volResult?.volatilityRealizationScore?.toFixed(3) ?? "N/A"} grade=${volResult?.grade?.grade ?? "N/A"}`)

  // ── Step 4: Offensive eruption analysis ─────────────────────────────────────
  const eruptResult = safeTry("eruptions", () => analyzeOffensiveEruptions({ bets, slips }))
  log(`Eruptions: ${eruptResult?.events?.length ?? 0} events, ${eruptResult?.summary?.missedEruptions ?? 0} missed`)

  // ── Step 5: Process classification ──────────────────────────────────────────
  const slippedSet      = buildSlippedSet(slips)
  const eruptionIds     = buildEruptionEventIds(eruptResult)
  const classified      = safeTry("process", () => classifyAllBets(bets, { slippedSet, eruptionEventIds: eruptionIds })) || []
  const procSummary     = safeTry("process_summary", () => summarizeProcessClassifications(classified)) || {}
  const procResult      = { classified, summary: procSummary }
  log(`Process: ${classified.length} classified, avgScore=${procSummary.avgProcessScore?.toFixed(3) ?? "N/A"}`)

  // ── Step 6: Build grades ─────────────────────────────────────────────────────
  const grades = {
    model: (() => {
      const hr = calSamples.filter((s) => s.hit !== null).length > 0
        ? round4(calSamples.filter((s) => s.hit === 1).length / calSamples.filter((s) => s.hit !== null).length)
        : null
      if (hr === null) return "N/A"
      return hr >= 0.60 ? "A" : hr >= 0.52 ? "B" : hr >= 0.46 ? "C" : hr >= 0.40 ? "D" : "F"
    })(),
    ecology:     ecoResult?.grade?.grade     ?? "N/A",
    calibration: calGrade.grade              ?? "N/A",
    volatility:  volResult?.grade?.grade     ?? "N/A",
  }
  grades.overall = computeOverallGrade(grades)
  log(`Grades: model=${grades.model} eco=${grades.ecology} cal=${grades.calibration} vol=${grades.volatility} overall=${grades.overall}`)

  // ── Step 7: Build daily answers (18 questions) ───────────────────────────────
  const answers = safeTry("answers", () => buildDailyAnswers({
    bets, slips,
    calibration: calResult,
    ecologyResult: ecoResult,
    volatilityResult: volResult,
    eruptionResult: eruptResult,
    processResult: procResult,
    sport, date,
  })) || {}

  // ── Step 8: Assemble final report ────────────────────────────────────────────
  const elapsedMs = Date.now() - t0

  const report = {
    ok: true,
    sport,
    date,
    generatedAt: new Date().toISOString(),
    elapsedMs,
    grades,
    answers,
    calibration: calResult,
    ecology: ecoResult,
    volatility: volResult,
    eruptions: eruptResult,
    process: procResult,
    majorFindings: answers.majorFindings || [],
    stepHealth: {
      calibration: calResult ? "ok" : "failed",
      ecology:     ecoResult ? "ok" : "failed",
      volatility:  volResult ? "ok" : "failed",
      eruptions:   eruptResult ? "ok" : "failed",
      process:     classified.length > 0 ? "ok" : "empty",
    },
  }

  // ── Step 9: Persist to SQLite ─────────────────────────────────────────────
  let persistResult = { ok: false, reason: "write_disabled" }
  if (write) {
    persistResult = safeTry("persist", () => persistToSqlite({
      sport, date, report,
      calResult, ecoResult, volResult,
      eruptResult, procResult,
    })) || { ok: false, reason: "persist_threw" }
  }

  log(`Done in ${elapsedMs}ms. Persist: ${persistResult?.ok ? "ok" : persistResult?.reason}`)

  return {
    ...report,
    persist: persistResult,
  }
}

// ── Daily report file (JSON) ──────────────────────────────────────────────────

/**
 * Write daily intelligence report to JSON file at tracking dir.
 * Mirrors what the orchestrator does for other review files.
 */
function writeDailyReportFile(sport, date, report) {
  try {
    const outPath = path.join(
      TRACKING_DIR,
      `daily_intelligence_review_${String(sport).toLowerCase()}_${date}.json`
    )
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    const tmp = outPath + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(report))
    fs.renameSync(tmp, outPath)
    return { ok: true, path: outPath }
  } catch (err) {
    return { ok: false, reason: err.message }
  }
}

module.exports = {
  runDailyIntelligenceReview,
  writeDailyReportFile,
  loadTrackingData,
  betsToCalibrationSamples,
}
