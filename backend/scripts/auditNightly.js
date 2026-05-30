#!/usr/bin/env node
"use strict"

/**
 * auditNightly — Lane C v0.1 (2026-05-27).
 *
 *   Usage:
 *     npm run audit:nightly                    # full audit: grade + report
 *     npm run audit:nightly -- --no-grade      # skip grading step (audit only)
 *     npm run audit:nightly -- --days=14       # widen window (default 7)
 *
 * Operator's daily proof loop. Surfaces:
 *   - Did grading actually run? How many picks pending vs settled?
 *   - Is CLV capturing closeOdds? What's the capture rate per slate?
 *   - Are all expected NBA prop families landing in tracked_bets?
 *   - Per-family hit rates where settled data exists
 *   - Repo state checkpoint (latest commits)
 *   - Anomaly flags screaming when the pipeline is broken
 *
 * Output: single dated markdown file at backend/runtime/audits/YYYY-MM-DD-audit.md
 * — operator scrolls through on iPhone, future Claude reads to recover state.
 *
 * Pre-Lane-C state: grading hadn't run since 2026-05-22 (5 days). 866 NBA
 * picks pending, 0 graded. CLV close-capture rate unknown. This script
 * closes that loop by making the gap auditable.
 */

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
const AUDIT_DIR    = path.join(__dirname, "..", "runtime", "audits")
const REPO_ROOT    = path.join(__dirname, "..", "..")

const EXPECTED_NBA_FAMILIES = new Set([
  "points", "threes", "rebounds", "assists", "pra",
  "steals", "blocks", "double_double", "triple_double", "first_basket",
])
// turnovers intentionally excluded — API gap, see memory project_nba_turnovers_api_unavailable

function parseArgs() {
  const out = { grade: true, days: 7 }
  for (const a of process.argv.slice(2)) {
    if (a === "--no-grade") out.grade = false
    if (a.startsWith("--days=")) out.days = Number(a.slice("--days=".length)) || 7
  }
  return out
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null }
}

function listTrackedFiles() {
  if (!fs.existsSync(TRACKING_DIR)) return []
  return fs.readdirSync(TRACKING_DIR)
    .filter(f => /^(nba|mlb)_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
}

function parseFileMeta(filename) {
  const m = filename.match(/^(nba|mlb)_tracked_bets_(\d{4}-\d{2}-\d{2})\.json$/)
  if (!m) return null
  return { sport: m[1], date: m[2], filename }
}

function statsFor(bets) {
  const total = bets.length
  let settled = 0, won = 0, lost = 0, push = 0
  let openStamped = 0, closeStamped = 0
  const byFamily = {}
  const byFamilyHits = {}
  for (const b of bets) {
    const fam = b.statFamily || "unknown"
    byFamily[fam] = (byFamily[fam] || 0) + 1
    if (b.openOdds != null) openStamped++
    if (b.closeOdds != null) closeStamped++
    const result = String(b.result || "").toLowerCase()
    if (result && result !== "pending") {
      settled++
      if (!byFamilyHits[fam]) byFamilyHits[fam] = { settled: 0, won: 0, lost: 0, push: 0 }
      byFamilyHits[fam].settled++
      if (result === "win" || result === "won") { won++; byFamilyHits[fam].won++ }
      else if (result === "loss" || result === "lost") { lost++; byFamilyHits[fam].lost++ }
      else if (result === "push") { push++; byFamilyHits[fam].push++ }
    }
  }
  // 2026-05-27 — Lane D.3 dedup. Multi-book proliferation inflates loss/win
  // counts when one conceptual pick (player+stat+side) appears across many books.
  // Dedup by (player|eventId|statFamily|side) — keep the BEST-EDGE version's
  // result. 130 raw bets on 2026-05-25 → 23 unique predictions after dedup.
  const groups = new Map()
  for (const b of bets) {
    const key = `${b.player || ""}|${b.eventId || ""}|${b.statFamily || ""}|${b.side || ""}`
    const cur = groups.get(key)
    const edge = Number(b.edge || 0)
    if (!cur || edge > Number(cur.edge || 0)) groups.set(key, b)
  }
  let dedupTotal = 0, dedupSettled = 0, dedupWon = 0, dedupLost = 0, dedupPush = 0
  const dedupByFamily = {}
  const dedupByFamilyHits = {}
  for (const b of groups.values()) {
    dedupTotal++
    const fam = b.statFamily || "unknown"
    dedupByFamily[fam] = (dedupByFamily[fam] || 0) + 1
    const result = String(b.result || "").toLowerCase()
    if (result && result !== "pending") {
      dedupSettled++
      if (!dedupByFamilyHits[fam]) dedupByFamilyHits[fam] = { settled: 0, won: 0, lost: 0, push: 0 }
      dedupByFamilyHits[fam].settled++
      if (result === "win" || result === "won") { dedupWon++; dedupByFamilyHits[fam].won++ }
      else if (result === "loss" || result === "lost") { dedupLost++; dedupByFamilyHits[fam].lost++ }
      else if (result === "push") { dedupPush++; dedupByFamilyHits[fam].push++ }
    }
  }
  return {
    total, settled, won, lost, push, openStamped, closeStamped, byFamily, byFamilyHits,
    dedup: {
      total: dedupTotal, settled: dedupSettled, won: dedupWon, lost: dedupLost, push: dedupPush,
      byFamily: dedupByFamily, byFamilyHits: dedupByFamilyHits,
    },
  }
}

function runGrading() {
  console.log("=== Step 1: backfill pending grades ===")
  const gradeTarget = path.join(__dirname, "gradingRun.js")
  if (!fs.existsSync(gradeTarget)) {
    console.warn("[audit:nightly] gradingRun.js missing — skipping grading step")
    return { ran: false, status: -1 }
  }
  const r = spawnSync("node", [gradeTarget, "--sport=all", "--backfill"], {
    stdio: "inherit",
    timeout: 5 * 60 * 1000, // 5 min hard cap
  })
  return { ran: true, status: r.status }
}

// 2026-05-29 — populators were NEVER auto-run. nbaPlayerGameLogs.json was
// 3.5 days stale when operator's instinct caught it (cards looking identical
// across Game 5 / Game 7 days). Wire all three populators into nightly chain
// so cache stays fresh. Each script is idempotent + bounded (last 21 days for
// game logs). If any fails, log and continue — never fatal to grading.
function runPopulators() {
  console.log("=== Step 0: refresh recent-form data ===")
  const populators = [
    { label: "NBA game logs",     script: "populateNbaGameLogs.js" },
    { label: "NBA team stats",    script: "populateNbaTeamStats.js" },
    { label: "NBA injury report", script: "populateNbaInjuryReport.js" },
    // 2026-05-30 — derives DvP cache from already-fetched game logs.
    // ORDER MATTERS: must run AFTER NBA game logs (it reads them).
    { label: "NBA DvP (derived)", script: "deriveNbaDvP.js" },
    // 2026-05-30 — biggest single MLB blind spot was missing per-batter HR/AB,
    // ISO, K%, BB%, OBP, SLG, handedness. Wire into nightly so HR + Hits + RBI
    // + Total Bases + Runs Scored engines (#21) have real per-batter signal.
    { label: "MLB batter stats",  script: "populateMlbBatterStats.js" },
    // 2026-05-30 — derives powerScore from the batter cache's iso + hrRate.
    // Replaces the 9-hardcoded-player mlbStatcastPower.json. ORDER MATTERS:
    // must run AFTER MLB batter stats; this script reads that cache.
    { label: "MLB Statcast power (derived)", script: "deriveMlbStatcastPower.js" },
    // 2026-05-30 — per-game hitting logs (L5/L15 streak detection) for every
    // batter in mlbBatterStats.json. ORDER MATTERS: must run AFTER batter
    // stats. Unlocks hot/cold streak signal across HR/Hits/RBI/TB/Runs.
    { label: "MLB batter game logs", script: "populateMlbBatterGameLogs.js" },
  ]
  const results = []
  for (const p of populators) {
    const target = path.join(__dirname, p.script)
    if (!fs.existsSync(target)) {
      console.warn(`[audit:nightly] ${p.script} missing — skipping ${p.label}`)
      results.push({ label: p.label, ran: false, status: -1, reason: "script_missing" })
      continue
    }
    console.log(`[audit:nightly] running populator: ${p.label} (${p.script})`)
    const r = spawnSync("node", [target], {
      stdio: "inherit",
      timeout: 5 * 60 * 1000,
    })
    const ok = r.status === 0
    results.push({ label: p.label, ran: true, status: r.status, ok })
    if (!ok) console.warn(`[audit:nightly] populator ${p.label} exit=${r.status}`)
  }
  return results
}

function gitCheckpoint() {
  const r = spawnSync("git", ["-C", REPO_ROOT, "log", "--oneline", "-5"], { encoding: "utf8" })
  const s = spawnSync("git", ["-C", REPO_ROOT, "status", "--short"], { encoding: "utf8" })
  return {
    recentCommits: (r.stdout || "").trim(),
    dirty: (s.stdout || "").trim(),
  }
}

function pct(n, d) {
  if (!d) return "n/a"
  return ((n / d) * 100).toFixed(1) + "%"
}

function buildReport({ window, args, gradingResult, perFile, totals, anomalies, git }) {
  const today = new Date().toISOString().slice(0, 10)
  const lines = []
  lines.push(`# Betting Dashboard — Nightly Audit`)
  lines.push("")
  lines.push(`**Generated**: ${new Date().toISOString()}`)
  lines.push(`**Window**: last ${args.days} days (${window.from} → ${window.to})`)
  lines.push(`**Grading step**: ${gradingResult.ran ? `ran (exit=${gradingResult.status})` : "skipped"}`)
  lines.push("")

  lines.push(`## Summary`)
  lines.push("")
  lines.push(`- **Total tracked**: ${totals.total} picks (NBA: ${totals.nba}, MLB: ${totals.mlb})`)
  lines.push(`- **Settled**: ${totals.settled} (${pct(totals.settled, totals.total)})`)
  lines.push(`- **Pending**: ${totals.pending} (${pct(totals.pending, totals.total)})`)
  lines.push(`- **Won / Lost / Push**: ${totals.won} / ${totals.lost} / ${totals.push}`)
  lines.push(`- **Open-side stamped**: ${totals.openStamped} (${pct(totals.openStamped, totals.total)})`)
  lines.push(`- **CLV close-stamped**: ${totals.closeStamped} (${pct(totals.closeStamped, totals.total)})`)
  if (totals.settled > 0) {
    const winRate = totals.won / (totals.won + totals.lost)
    lines.push(`- **Raw win rate (W / W+L, excludes pushes)**: ${(winRate * 100).toFixed(1)}%`)
  }
  lines.push("")
  lines.push(`## Deduped view (multi-book → 1 per player+stat+side, Lane D.3)`)
  lines.push("")
  lines.push(`- **Unique predictions**: ${totals.dedup.total} (NBA: ${totals.dedup.nba}, MLB: ${totals.dedup.mlb})`)
  lines.push(`- **Settled**: ${totals.dedup.settled}`)
  lines.push(`- **Won / Lost / Push**: ${totals.dedup.won} / ${totals.dedup.lost} / ${totals.dedup.push}`)
  if (totals.dedup.settled > 0) {
    const dwr = totals.dedup.won / (totals.dedup.won + totals.dedup.lost)
    lines.push(`- **Deduped win rate**: ${(dwr * 100).toFixed(1)}% (honest per-conceptual-pick measure)`)
  }
  lines.push("")

  if (anomalies.length > 0) {
    lines.push(`## ⚠ Anomalies`)
    lines.push("")
    for (const a of anomalies) lines.push(`- ${a}`)
    lines.push("")
  } else {
    lines.push(`## ✓ No anomalies detected`)
    lines.push("")
  }

  lines.push(`## Per-day breakdown`)
  lines.push("")
  // Group perFile by date, then list NBA + MLB
  const byDate = {}
  for (const f of perFile) {
    byDate[f.date] = byDate[f.date] || {}
    byDate[f.date][f.sport] = f
  }
  const dates = Object.keys(byDate).sort().reverse()
  for (const d of dates) {
    lines.push(`### ${d}`)
    for (const sport of ["nba", "mlb"]) {
      const f = byDate[d][sport]
      if (!f) continue
      lines.push(`- **${sport.toUpperCase()}**: ${f.stats.total} bets · settled ${f.stats.settled} · won ${f.stats.won} · lost ${f.stats.lost} · CLV close ${f.stats.closeStamped}/${f.stats.total}`)
      const fams = Object.keys(f.stats.byFamily).sort()
      const famLine = fams.map(k => `${k}:${f.stats.byFamily[k]}`).join(" · ")
      if (famLine) lines.push(`  - families: ${famLine}`)
    }
    lines.push("")
  }

  lines.push(`## Per-family hit rates (cumulative across window, settled only)`)
  lines.push("")
  lines.push(`Raw = every book entry; Deduped = 1 entry per unique (player+stat+side+event).`)
  lines.push("")
  lines.push("| Sport | Family | Raw S/W/L | Raw % | Dedup S/W/L | Dedup % |")
  lines.push("|---|---|---|---|---|---|")
  for (const sport of ["nba", "mlb"]) {
    const fams = totals.familyHits[sport] || {}
    const dfams = totals.dedup.familyHits[sport] || {}
    const allFams = new Set([...Object.keys(fams), ...Object.keys(dfams)])
    for (const fam of Array.from(allFams).sort()) {
      const h = fams[fam] || { settled: 0, won: 0, lost: 0, push: 0 }
      const d = dfams[fam] || { settled: 0, won: 0, lost: 0, push: 0 }
      const wr = h.won + h.lost > 0 ? `${((h.won / (h.won + h.lost)) * 100).toFixed(1)}%` : "n/a"
      const dwr = d.won + d.lost > 0 ? `${((d.won / (d.won + d.lost)) * 100).toFixed(1)}%` : "n/a"
      lines.push(`| ${sport} | ${fam} | ${h.settled}/${h.won}/${h.lost} | ${wr} | ${d.settled}/${d.won}/${d.lost} | ${dwr} |`)
    }
  }
  if (totals.settled === 0) lines.push(`*(no settled data yet)*`)
  lines.push("")

  lines.push(`## Repo state`)
  lines.push("")
  lines.push("**Recent commits**:")
  lines.push("```")
  lines.push(git.recentCommits || "(no commits)")
  lines.push("```")
  lines.push("")
  if (git.dirty) {
    lines.push("**Uncommitted changes** (data drift expected, code changes are red flags):")
    lines.push("```")
    lines.push(git.dirty)
    lines.push("```")
  } else {
    lines.push("**Working tree clean.**")
  }
  lines.push("")

  lines.push(`---`)
  lines.push(`*Generated by \`npm run audit:nightly\` (Lane C v0.1 — backend/scripts/auditNightly.js).*`)
  return lines.join("\n")
}

function main() {
  const args = parseArgs()
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true })

  // Step 0: refresh recent-form data (NBA game logs, team stats, injury report)
  // BEFORE grading so populator-pulled box scores can supplement grading data
  // and the next day's slate has fresh L5/L10 baselines.
  const populatorResults = args.grade ? runPopulators() : []

  // Step 1: grading backfill
  const gradingResult = args.grade ? runGrading() : { ran: false, status: 0 }

  // Step 2: collect files in window
  const today = new Date()
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - args.days + 1)
  const cutoffKey = cutoff.toISOString().slice(0, 10)
  const todayKey = today.toISOString().slice(0, 10)

  const files = listTrackedFiles()
    .map(parseFileMeta)
    .filter(m => m && m.date >= cutoffKey && m.date <= todayKey)

  const perFile = []
  for (const m of files) {
    const data = readJsonSafe(path.join(TRACKING_DIR, m.filename))
    if (!Array.isArray(data)) continue
    perFile.push({ ...m, stats: statsFor(data) })
  }

  // Step 3: roll up totals
  const totals = {
    total: 0, nba: 0, mlb: 0,
    settled: 0, pending: 0, won: 0, lost: 0, push: 0,
    openStamped: 0, closeStamped: 0,
    familyHits: { nba: {}, mlb: {} },
    dedup: {
      total: 0, nba: 0, mlb: 0, settled: 0, won: 0, lost: 0, push: 0,
      familyHits: { nba: {}, mlb: {} },
    },
  }
  for (const f of perFile) {
    totals.total += f.stats.total
    totals[f.sport] += f.stats.total
    totals.settled += f.stats.settled
    totals.pending += f.stats.total - f.stats.settled
    totals.won += f.stats.won
    totals.lost += f.stats.lost
    totals.push += f.stats.push
    totals.openStamped += f.stats.openStamped
    totals.closeStamped += f.stats.closeStamped
    for (const [fam, h] of Object.entries(f.stats.byFamilyHits)) {
      const t = (totals.familyHits[f.sport][fam] = totals.familyHits[f.sport][fam] || { settled: 0, won: 0, lost: 0, push: 0 })
      t.settled += h.settled; t.won += h.won; t.lost += h.lost; t.push += h.push
    }
    // Lane D.3 deduped roll-up
    totals.dedup.total += f.stats.dedup.total
    totals.dedup[f.sport] += f.stats.dedup.total
    totals.dedup.settled += f.stats.dedup.settled
    totals.dedup.won += f.stats.dedup.won
    totals.dedup.lost += f.stats.dedup.lost
    totals.dedup.push += f.stats.dedup.push
    for (const [fam, h] of Object.entries(f.stats.dedup.byFamilyHits)) {
      const t = (totals.dedup.familyHits[f.sport][fam] = totals.dedup.familyHits[f.sport][fam] || { settled: 0, won: 0, lost: 0, push: 0 })
      t.settled += h.settled; t.won += h.won; t.lost += h.lost; t.push += h.push
    }
  }

  // Step 4: anomaly detection
  const anomalies = []
  if (totals.total > 0 && totals.settled / totals.total < 0.10 && totals.total > 50) {
    anomalies.push(`Grading lag: only ${totals.settled}/${totals.total} (${pct(totals.settled, totals.total)}) settled across ${args.days} days. Run \`npm run grading:run -- --sport=all --backfill\` manually if audit's backfill failed.`)
  }
  // CLV gap check: for tracked_bets >24h old, expect closeStamped near openStamped
  const now = Date.now()
  for (const f of perFile) {
    const fileDate = new Date(f.date + "T00:00:00Z")
    const ageDays = (now - fileDate.getTime()) / (24 * 60 * 60 * 1000)
    if (ageDays > 1 && f.stats.openStamped > 10 && f.stats.closeStamped / f.stats.openStamped < 0.10) {
      anomalies.push(`${f.sport.toUpperCase()} ${f.date}: CLV close-capture rate only ${pct(f.stats.closeStamped, f.stats.openStamped)} — backend was likely down during the slate's tipoff windows.`)
    }
  }
  // NBA family coverage check (today's file)
  const todayNba = perFile.find(f => f.sport === "nba" && f.date === todayKey)
  if (todayNba) {
    const missing = []
    for (const fam of EXPECTED_NBA_FAMILIES) {
      if (!todayNba.stats.byFamily[fam] || todayNba.stats.byFamily[fam] === 0) missing.push(fam)
    }
    if (missing.length > 0) {
      anomalies.push(`NBA ${todayKey}: 0 picks in families [${missing.join(", ")}]. first_basket and triple_double commonly 0 (refinement / rarity). Others worth investigating.`)
    }
  }

  // Step 5: git checkpoint
  const git = gitCheckpoint()

  // Step 6: write report
  const report = buildReport({
    window: { from: cutoffKey, to: todayKey },
    args, gradingResult, perFile, totals, anomalies, git,
  })
  const reportPath = path.join(AUDIT_DIR, `${todayKey}-audit.md`)
  fs.writeFileSync(reportPath, report)

  // Step 7: summary to stdout
  console.log("")
  console.log("=== AUDIT SUMMARY ===")
  console.log(`window: ${cutoffKey} → ${todayKey}`)
  console.log(`total: ${totals.total} (nba=${totals.nba} mlb=${totals.mlb})`)
  console.log(`settled: ${totals.settled} (${pct(totals.settled, totals.total)})`)
  console.log(`won/lost/push: ${totals.won}/${totals.lost}/${totals.push}`)
  console.log(`clv closeStamped: ${totals.closeStamped}/${totals.openStamped} open (${pct(totals.closeStamped, totals.openStamped)})`)
  if (anomalies.length > 0) {
    console.log("")
    console.log(`⚠ ${anomalies.length} anomalies — see report`)
    for (const a of anomalies) console.log("  -", a)
  } else {
    console.log("✓ no anomalies")
  }
  console.log("")
  console.log(`report written → ${reportPath}`)
}

main()
