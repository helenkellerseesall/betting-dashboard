#!/usr/bin/env node
"use strict"

/**
 * sysAudit.js — one-shot system audit.
 *
 * Verifies the betting-dashboard repo is running as a single coherent
 * pipeline. Catches the silent failure modes that bit us across 2026-05-31
 * (stale code, stale data, date rollover, populator drift, fallback bugs).
 *
 * Output: operator-friendly markdown-ish report to stdout. Pipe to
 *   .scratch/last.txt and `check`.
 *
 * Sections:
 *   1. Backend state (commit vs HEAD, pid, uptime)
 *   2. Slate files (today + yesterday tracked_bets/tracked_best per sport)
 *   3. Personal ledger + lessons.json
 *   4. Populator freshness (mtime + age per cache file)
 *   5. Enrichment coverage on today's tracked_best (which signals fired)
 *   6. Family coverage on today's tracked_bets (which prop types surfaced)
 *   7. CLV health (from /api/ws/grades-health)
 *   8. Process state (port listeners)
 *   9. Drift markers (canonical files exist, no uncommitted code)
 *
 * Status legend: ✓ pass · ! warn · ✗ fail · — info / N/A
 */

const fs = require("fs")
const path = require("path")
const http = require("http")
const { execSync, spawnSync } = require("child_process")

const REPO = path.join(__dirname, "..", "..")
const TRACKING = path.join(REPO, "backend", "runtime", "tracking")
const DATA = path.join(REPO, "backend", "data")
const OPERATOR = path.join(REPO, "backend", "runtime", "operator")
const MEMORY = process.env.MEMORY_DIR || null  // optional override

let PASSED = 0, WARNED = 0, FAILED = 0
function P(line) { console.log("[✓]", line); PASSED++ }
function W(line) { console.log("[!]", line); WARNED++ }
function F(line) { console.log("[✗]", line); FAILED++ }
function I(line) { console.log("[—]", line) }
function H(title) { console.log("\n=== " + title + " ===") }

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null }
}
function mtimeIso(p) {
  try { return fs.statSync(p).mtime.toISOString() } catch { return null }
}
function ageHours(p) {
  try {
    const m = fs.statSync(p).mtime.getTime()
    return Math.round(((Date.now() - m) / 3600000) * 10) / 10
  } catch { return null }
}
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function yesterdayKey() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// HTTP fetch with port auto-detect
function detectPort() {
  if (process.env.PORT) return Number(process.env.PORT)
  try {
    const facts = fs.readFileSync(path.join(REPO, "RUNTIME_FACTS.md"), "utf8")
    const m = facts.match(/\*\*Port:\*\*\s*`?(\d{2,5})`?/i)
    if (m) return Number(m[1])
  } catch {}
  return 4000
}
async function fetchJson(p) {
  const port = detectPort()
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "GET", timeout: 8000 }, (res) => {
      let body = ""
      res.on("data", (c) => body += c)
      res.on("end", () => {
        try { resolve({ ok: res.statusCode === 200, status: res.statusCode, json: JSON.parse(body) }) }
        catch { resolve({ ok: false, status: res.statusCode, raw: body }) }
      })
    })
    req.on("error", (e) => resolve({ ok: false, error: String(e?.message || e) }))
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }) })
    req.end()
  })
}

async function main() {
  console.log(`=== SYS AUDIT — ${new Date().toISOString()} ===`)
  console.log(`Repo: ${REPO}`)
  const TK = todayKey(), YK = yesterdayKey()
  console.log(`Today: ${TK} · Yesterday: ${YK}`)

  // 1. BACKEND
  H("1. BACKEND STATE")
  const ver = await fetchJson("/api/ws/version")
  if (!ver.ok) {
    F(`Backend not responding (${ver.error || "HTTP " + ver.status}) — restart with: bash backend/scripts/restartBackend.sh`)
  } else {
    let head = null
    try { head = execSync("git rev-parse HEAD", { cwd: REPO, timeout: 2000 }).toString().trim() } catch {}
    const match = head && ver.json.commit === head
    if (match) P(`Backend pid ${ver.json.pid} on commit ${ver.json.commitShort} (matches local HEAD)`)
    else {
      // Distinguish "code that affects backend behavior" from script/doc-only commits.
      // Backend only needs a restart when files it actually loads at boot changed.
      let routeChanged = false
      try {
        const diff = execSync(`git diff --name-only ${ver.json.commit} ${head}`, { cwd: REPO, timeout: 3000 }).toString().trim().split("\n").filter(Boolean)
        routeChanged = diff.some((p) =>
          /^backend\/(routes|pipeline|server\.js|http|data\/[a-z]+\.json)/.test(p) ||
          /^backend\/(pipeline|routes)\/.+\.js$/.test(p)
        ) || diff.some((p) => /^frontend\//.test(p))
        if (routeChanged) F(`Backend serving ${ver.json.commitShort} but local HEAD is ${head?.slice(0,7)} — STALE CODE (route/pipeline change), restart needed`)
        else W(`Backend serving ${ver.json.commitShort} (1 commit behind ${head?.slice(0,7)}) — script/doc-only diff, no restart needed`)
      } catch {
        F(`Backend serving ${ver.json.commitShort} but local HEAD is ${head?.slice(0,7) || "?"} — STALE CODE, restart needed`)
      }
    }
    const bootAge = Math.round((Date.now() - new Date(ver.json.bootAt).getTime()) / 60000)
    I(`Booted ${ver.json.bootAt} (${bootAge} min ago)`)
  }

  // 2. SLATE FILES
  H("2. SLATE FILES")
  for (const sport of ["nba", "mlb"]) {
    for (const dk of [TK, YK]) {
      const betsFile = path.join(TRACKING, `${sport}_tracked_bets_${dk}.json`)
      const bestFile = path.join(TRACKING, `${sport}_tracked_best_${dk}.json`)
      const bets = readJsonSafe(betsFile)
      const best = readJsonSafe(bestFile)
      const betsLen = Array.isArray(bets) ? bets.length : null
      const bestLen = best?.entries?.length ?? null
      if (bets == null && best == null) {
        if (dk === TK) I(`${sport.toUpperCase()} ${dk}: no slate yet`)
        else W(`${sport.toUpperCase()} ${dk}: tracked files missing — scheduler may have skipped`)
        continue
      }
      const settled = Array.isArray(bets) ? bets.filter((b) => b.result && b.result !== "pending").length : 0
      const closeStamped = Array.isArray(bets) ? bets.filter((b) => b.closeOdds != null).length : 0
      if (betsLen > 0) {
        P(`${sport.toUpperCase()} ${dk} tracked_bets: ${betsLen} (settled ${settled}, close-stamped ${closeStamped})`)
      } else if (betsLen === 0 && bestLen > 0) {
        W(`${sport.toUpperCase()} ${dk} tracked_bets EMPTY but tracked_best has ${bestLen} — slate generated, no bets crossed cutoffs (or filter too strict)`)
      } else if (bestLen > 0) {
        I(`${sport.toUpperCase()} ${dk} tracked_best: ${bestLen} entries`)
      }
    }
  }

  // 3. PERSONAL LEDGER + LESSONS
  H("3. PERSONAL LEDGER + LESSONS")
  const ledger = readJsonSafe(path.join(TRACKING, "personal_ledger.json"))
  if (!ledger) F("personal_ledger.json missing or unreadable")
  else {
    const total = (ledger.bets || []).length
    const placed = (ledger.bets || []).filter((b) => b.decisionType === "placed" || b.realMoney === true)
    P(`personal_ledger.json: ${total} total bets · ${placed.length} placed (real money)`)
    const placedPending = placed.filter((b) => !b.result || b.result === "pending").length
    const placedSettled = placed.filter((b) => b.result && b.result !== "pending").length
    I(`Placed: ${placedSettled} settled · ${placedPending} pending`)
  }
  const lessons = readJsonSafe(path.join(OPERATOR, "lessons.json"))
  if (!lessons) W("lessons.json missing — run: node backend/scripts/traceMyBets.js after game-ends to populate")
  else {
    const ageH = ageHours(path.join(OPERATOR, "lessons.json"))
    P(`lessons.json: ${(lessons.entries || []).length} entries (last write ${ageH}h ago)`)
  }

  // 4. POPULATOR FRESHNESS
  H("4. POPULATOR FRESHNESS")
  const populators = [
    // [filename, friendly name, expected-max-age-hours, severity-when-stale (warn/fail)]
    ["mlbBatterStats.json",     "MLB batter season stats",     30, "warn"],
    ["mlbBatterGameLogs.json",  "MLB batter L5/L15 logs",       30, "warn"],
    ["mlbPitcherStats.json",    "MLB pitcher season stats",     30, "warn"],
    ["mlbPitcherGameLogs.json", "MLB pitcher L3/L5 logs",       30, "warn"],
    ["mlbBullpenWorkload.json", "MLB bullpen workload",         48, "warn"],
    ["mlbGameWeather.json",     "MLB game-day weather",         12, "warn"],
    ["mlbStatcastPower.json",   "MLB Statcast power scores",    48, "warn"],
    ["nbaInjuryReport.json",    "NBA injury report",            18, "warn"],
    ["nbaPlayerGameLogs.json",  "NBA player game logs",         48, "warn"],
    ["nbaTeamStats.json",       "NBA team stats",               48, "warn"],
    ["nbaDvP.json",             "NBA defense-vs-position",      48, "warn"],
    // Static seeds — hand-curated, not auto-refreshed by populators
    ["mlbParkFactors.json",     "MLB park factors (STATIC)",   null, "static"],
    ["mlbParkMeta.json",        "MLB park meta (STATIC)",      null, "static"],
    ["sportsbookTopology.json", "Sportsbook topology (STATIC)",null, "static"],
    ["nbaPlayerProjections.json","NBA projections seed (STATIC, defaults fallback when roleContext missing)",null, "static"],
  ]
  for (const [fname, label, maxAge, sev] of populators) {
    const p = path.join(DATA, fname)
    if (!fs.existsSync(p)) {
      if (sev === "static") F(`${label}: MISSING (seed file expected in repo)`)
      else W(`${label}: file missing — populator may need to run`)
      continue
    }
    const age = ageHours(p)
    const sizeKb = Math.round(fs.statSync(p).size / 102.4) / 10
    if (maxAge == null) {
      I(`${label}: ${sizeKb}KB`)
    } else if (age <= maxAge) {
      P(`${label}: ${age}h old · ${sizeKb}KB`)
    } else if (sev === "fail") {
      F(`${label}: ${age}h old (max ${maxAge}h) — STALE, refresh required`)
    } else {
      W(`${label}: ${age}h old (max ${maxAge}h) — getting stale, refresh recommended`)
    }
  }

  // 5. ENRICHMENT COVERAGE (today's tracked_best per sport)
  H("5. ENRICHMENT FIELD COVERAGE (today's tracked_best)")
  for (const sport of ["nba", "mlb"]) {
    const f = readJsonSafe(path.join(TRACKING, `${sport}_tracked_best_${TK}.json`))
    const entries = f?.entries || []
    if (!entries.length) {
      I(`${sport.toUpperCase()} ${TK}: no tracked_best entries yet to audit`)
      continue
    }
    const N = entries.length
    const has = (pred) => entries.filter(pred).length
    const pct = (k) => `${k}/${N} (${Math.round((k / N) * 100)}%)`
    console.log(`  ${sport.toUpperCase()} ${TK} (${N} entries):`)
    if (sport === "nba") {
      const fields = [
        ["recentForm.last5_avg",         (e) => e.recentForm?.last5_avg != null],
        ["roleContext (minutes_avg)",    (e) => e.roleContext?.minutes_avg_recent != null],
        ["opponentStats populated",      (e) => e.opponentStats && Object.values(e.opponentStats).some((v) => v != null && v > 0)],
        ["oppDef grade",                 (e) => e.oppDef != null],
        ["pace",                         (e) => e.pace != null],
        ["displayBundle.tags",           (e) => (e.displayBundle?.tags || []).length > 0],
        ["restContext",                  (e) => e.restContext != null],
        ["homeAwaySplit",                (e) => e.homeAwaySplit != null],
        ["gameContext (live lookup)",    (e) => e.gameContext != null],
      ]
      for (const [name, pred] of fields) {
        const n = has(pred)
        const ok = n / N >= 0.7
        const oneOf = ok ? "P" : (n === 0 ? "F" : "W")
        if (oneOf === "P") P(`  ${name}: ${pct(n)}`)
        else if (oneOf === "W") W(`  ${name}: ${pct(n)} — partial coverage`)
        else F(`  ${name}: ${pct(n)} — field never populated, wiring may be missing`)
      }
    } else if (sport === "mlb") {
      const fields = [
        ["impliedTeamTotal",             (e) => e.impliedTeamTotal != null],
        ["gameTotal",                    (e) => e.gameTotal != null],
        ["hrFactor",                     (e) => e.hrFactor != null],
        ["temperatureF",                 (e) => e.temperatureF != null],
        ["windDirectionTag",             (e) => e.windDirectionTag != null],
        ["contextualTags",               (e) => (e.contextualTags || []).length > 0],
        ["hrEnvironmentTag",             (e) => e.hrEnvironmentTag != null],
        ["lineupSpot",                   (e) => e.lineupSpot != null],
      ]
      for (const [name, pred] of fields) {
        const n = has(pred)
        const ok = n / N >= 0.5
        if (ok) P(`  ${name}: ${pct(n)}`)
        else if (n > 0) W(`  ${name}: ${pct(n)} — partial coverage`)
        else F(`  ${name}: ${pct(n)} — never populated`)
      }
    }
  }

  // 6. FAMILY COVERAGE (today's tracked_bets — what prop types surfaced)
  H("6. FAMILY COVERAGE (latest tracked_bets per sport)")
  for (const sport of ["nba", "mlb"]) {
    // Use latest date with bets — REJECT future-dated sentinel files (e.g.
    // 9999-12-31), match the production findLatestDateWithData guard.
    const files = fs.readdirSync(TRACKING).filter((f) => new RegExp(`^${sport}_tracked_bets_\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f))
    const latest = files
      .map((f) => f.match(/(\d{4}-\d{2}-\d{2})/)[1])
      .filter((dk) => dk <= TK)  // anti-sentinel
      .sort().reverse()[0]
    if (!latest) { I(`${sport.toUpperCase()}: no tracked_bets files`); continue }
    const bets = readJsonSafe(path.join(TRACKING, `${sport}_tracked_bets_${latest}.json`)) || []
    if (!bets.length) { I(`${sport.toUpperCase()} ${latest}: empty`); continue }
    const byFam = {}
    for (const b of bets) byFam[b.statFamily || "unknown"] = (byFam[b.statFamily || "unknown"] || 0) + 1
    const sorted = Object.entries(byFam).sort((a, b) => b[1] - a[1])
    console.log(`  ${sport.toUpperCase()} ${latest} (${bets.length} total):`)
    for (const [fam, n] of sorted) console.log(`    ${fam}: ${n}`)
    // Sanity flags
    if (sport === "nba" && !byFam["pra"] && !byFam["points_rebounds_assists"]) W(`  NBA: no PRA picks (worth a glance — usually best family)`)
    if (sport === "mlb" && !byFam["totalBases"]) W(`  MLB: no totalBases picks (usually high-volume family)`)
  }

  // 7. CLV HEALTH (delegate to grades-health endpoint)
  H("7. CLV / GRADING HEALTH (last 7 days)")
  const gh = await fetchJson("/api/ws/grades-health?days=7")
  if (!gh.ok) W(`grades-health endpoint failed (${gh.error || "HTTP " + gh.status})`)
  else {
    for (const sport of ["nba", "mlb"]) {
      const w = gh.json.sports?.[sport]
      if (!w) continue
      const stamp = w.clvStampRate != null ? `${(w.clvStampRate * 100).toFixed(1)}%` : "—"
      const hit = w.hitRate != null ? `${(w.hitRate * 100).toFixed(1)}%` : "—"
      const beat = w.beatMarketRate != null ? `${(w.beatMarketRate * 100).toFixed(1)}%` : "—"
      const ok = w.clvStampRate >= 0.4
      const fn = ok ? P : (w.clvStampRate > 0 ? W : F)
      fn(`${sport.toUpperCase()}: ${w.total} picks · CLV stamped ${stamp} · hit ${hit} · beat-mkt ${beat} (${w.wins}W ${w.losses}L ${w.pending} pending)`)
    }
  }

  // 8. PROCESS STATE
  H("8. PROCESS STATE")
  try {
    const out = spawnSync("/usr/sbin/lsof", ["-nP", "-iTCP:4000", "-sTCP:LISTEN"], { encoding: "utf8", timeout: 4000 })
    if (out.stdout && out.stdout.includes("LISTEN")) P("Backend listening on :4000")
    else F("Backend NOT listening on :4000")
  } catch { I("Could not run lsof to verify port listener") }
  try {
    const lc = spawnSync("/bin/launchctl", ["list"], { encoding: "utf8", timeout: 4000 })
    if (lc.stdout) {
      const motel = lc.stdout.split("\n").filter((l) => l.includes("motel666"))
      if (motel.length) {
        for (const line of motel) {
          const [pid, , label] = line.trim().split(/\s+/)
          if (pid === "-") W(`LaunchAgent ${label}: not running (pid=-)`)
          else P(`LaunchAgent ${label}: pid ${pid}`)
        }
      } else W("No motel666 LaunchAgents listed — check launchctl manually")
    }
  } catch { I("Could not enumerate LaunchAgents") }

  // 9. DRIFT MARKERS
  H("9. DRIFT MARKERS")
  const canonical = ["RUNTIME_FACTS.md", "PLAYBOOK.md", ".gitignore"]
  for (const f of canonical) {
    if (fs.existsSync(path.join(REPO, f))) P(`Canonical file present: ${f}`)
    else F(`Canonical file MISSING: ${f}`)
  }
  try {
    const status = execSync("git status -s", { cwd: REPO, timeout: 2000 }).toString().trim()
    const lines = status ? status.split("\n") : []
    const codeChanges = lines.filter((l) => /\.(js|ts|html|css|sh|md)$/.test(l) && !l.includes("data/") && !l.includes(".scratch/"))
    if (codeChanges.length === 0) P(`No uncommitted code changes (${lines.length} non-code paths)`)
    else W(`${codeChanges.length} uncommitted code change(s) — review:`) && codeChanges.forEach((l) => console.log("    " + l))
  } catch { I("Could not run git status") }
  try {
    const headCommit = execSync("git rev-parse HEAD", { cwd: REPO, timeout: 2000 }).toString().trim().slice(0, 7)
    const origin = execSync("git rev-parse origin/stable-nba-engine", { cwd: REPO, timeout: 2000 }).toString().trim().slice(0, 7)
    if (headCommit === origin) P(`Local HEAD ${headCommit} = origin/stable-nba-engine`)
    else W(`Local HEAD ${headCommit} ahead of origin ${origin} — git push pending`)
  } catch { I("Could not compare to origin") }

  // SUMMARY
  H("SUMMARY")
  const total = PASSED + WARNED + FAILED
  console.log(`✓ ${PASSED} passed · ! ${WARNED} warnings · ✗ ${FAILED} failures (${total} checks)`)
  if (FAILED === 0 && WARNED === 0) console.log("STATUS: GREEN — no drift detected, single pipeline intact")
  else if (FAILED === 0) console.log("STATUS: YELLOW — pipeline functional, freshness concerns above")
  else console.log("STATUS: RED — at least one critical failure, see ✗ lines")

  process.exit(FAILED > 0 ? 2 : (WARNED > 0 ? 1 : 0))
}

main().catch((e) => { console.error("FATAL:", e); process.exit(3) })
