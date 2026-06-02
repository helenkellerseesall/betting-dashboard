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
const { currentSlateDateEt, slateDateForTimestamp } = require("../pipeline/shared/slateDate")

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
// Phase Date-Doctrine-1B — slateDate helper (ET 4 AM boundary)
function todayKey() { return currentSlateDateEt() }
function yesterdayKey() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return slateDateForTimestamp(d.getTime())
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
      // 2026-05-31 — distinguish "enrichment fires AND persists to tracked_best"
      // (e.g. recentForm, roleContext) from "enrichment fires at projection but
      // DOESN'T persist to tracked_best" (oppDef, restContext, homeAwaySplit,
      // gameContext). The latter are wiring gaps tracked as task #71 — the
      // pick-generation pipeline correctly uses these signals; only the FE's
      // post-hoc reasoning surface can't read them off disk. Flag as WARN
      // (visible but not stop-the-line RED) when 0%.
      const fields = [
        ["recentForm.last5_avg",         (e) => e.recentForm?.last5_avg != null, "persist"],
        ["roleContext (minutes_avg)",    (e) => e.roleContext?.minutes_avg_recent != null, "persist"],
        ["opponentStats populated",      (e) => e.opponentStats && Object.values(e.opponentStats).some((v) => v != null && v > 0), "persist"],
        ["oppDef grade",                 (e) => e.oppDef != null, "transient"],
        ["pace",                         (e) => e.pace != null, "persist"],
        ["displayBundle.tags",           (e) => (e.displayBundle?.tags || []).length > 0, "persist"],
        ["restContext",                  (e) => e.restContext != null, "transient"],
        ["homeAwaySplit",                (e) => e.homeAwaySplit != null, "transient"],
        ["gameContext (live lookup)",    (e) => e.gameContext != null, "transient"],
      ]
      for (const [name, pred, kind] of fields) {
        const n = has(pred)
        const ok = n / N >= 0.7
        if (ok) P(`  ${name}: ${pct(n)}`)
        else if (kind === "transient" && n === 0) {
          W(`  ${name}: ${pct(n)} — enrichment fires at projection, not persisted to tracked_best (#71 wiring gap, not pick-generation drift)`)
        } else if (n > 0) {
          W(`  ${name}: ${pct(n)} — partial coverage`)
        } else {
          F(`  ${name}: ${pct(n)} — field never populated, wiring may be missing`)
        }
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

  // 2026-06-01 Phase CLV-Resilience-1A — filesystem-direct CLV check.
  // The HTTP block above depends on /api/ws/grades-health returning per-sport
  // breakdowns. On 2026-05-31 that endpoint silently returned no sport entries
  // and section 7 fell through with NO fail line — losing the entire day of
  // CLV with zero alert. This filesystem-direct check reads today's tracked_bets
  // files and computes closeStamped/totalTippedToday. It cannot be silenced by
  // an HTTP shape mismatch: if today's tipped picks have 0% close stamping,
  // it fires F (RED) every time. The HTTP check above stays as informational
  // for the 7-day rollup; this is the canary for TODAY.
  try {
    const trackingDir = path.join(REPO, "backend", "runtime", "tracking")
    const dayKey = (() => {
      // ET-local date key — matches the captureClosingLines + slate writers
      const d = new Date()
      const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" })
      return fmt.format(d)
    })()
    const nowMs = Date.now()
    for (const sport of ["nba", "mlb"]) {
      const fp = path.join(trackingDir, `${sport}_tracked_bets_${dayKey}.json`)
      if (!fs.existsSync(fp)) {
        I(`  [today] ${sport.toUpperCase()}: no tracked_bets file for ${dayKey} (slate may not have run yet)`)
        continue
      }
      let arr
      try {
        const raw = JSON.parse(fs.readFileSync(fp, "utf8"))
        arr = Array.isArray(raw) ? raw : (raw?.entries || [])
      } catch (e) {
        W(`  [today] ${sport.toUpperCase()}: tracked_bets ${dayKey} unreadable (${e.message})`)
        continue
      }
      const total = arr.length
      // "tipped" = the game has started (gameTime is in the past). A pick whose
      // game already tipped should have a close stamped by now if CLV is healthy.
      const tipped = arr.filter((b) => {
        const t = b?.gameTime ? Date.parse(b.gameTime) : NaN
        return Number.isFinite(t) && t <= nowMs
      })
      const tippedCount = tipped.length
      const tippedWithClose = tipped.filter((b) => b.closeOdds != null && b.closeOdds !== "" && b.closeOdds !== 0).length
      const totalWithClose = arr.filter((b) => b.closeOdds != null && b.closeOdds !== "" && b.closeOdds !== 0).length
      const pctOfTipped = tippedCount > 0 ? (tippedWithClose / tippedCount) : null
      const stampStr = pctOfTipped != null ? `${(pctOfTipped * 100).toFixed(1)}%` : "n/a"
      // Anything with >= 50 tipped picks AND <30% close-stamping is RED — the
      // capture loop is dead. >=30% but <70% is WARN (degraded; missed some
      // windows due to bounces). >=70% is PASS. <50 tipped = not enough signal.
      const line = `  [today] ${sport.toUpperCase()} ${dayKey}: total=${total} tipped=${tippedCount} closeStamped(tipped)=${tippedWithClose} (${stampStr}) · closeStamped(all)=${totalWithClose}`
      if (tippedCount < 50) {
        I(line + ` · sample too small for CLV verdict`)
      } else if (pctOfTipped == null || pctOfTipped < 0.30) {
        F(line + ` · CLV LOOP DEAD — closeStamping below 30% on a tipped slate. captureClosingLines.js loop not firing or backend was down through tipoff windows.`)
      } else if (pctOfTipped < 0.70) {
        W(line + ` · CLV degraded — some tipoff windows missed (likely backend bounce). Investigate backend uptime during PM ET tipoff windows.`)
      } else {
        P(line + ` · CLV healthy`)
      }
    }
  } catch (e) {
    W(`CLV filesystem-direct check failed: ${e.message}`)
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

  // 2026-06-01 Phase Backend-Log-Audit-1A — verify LaunchAgent stderr/stdout
  // log paths are actually being WRITTEN at runtime, not just configured in
  // the plist. Tonight surfaced: plist had StandardErrorPath/StandardOutPath
  // set per Phase #86 PlistBuddy work, but the files DIDN'T EXIST until we
  // unload/reload'd the plist. Backend was crashing ~20x/day (runs=26) with
  // ZERO visible trace anywhere. Catches:
  //   (a) log files missing — Phase #86 doctrine gap
  //   (b) stdout mtime stale while backend reportedly running (silent log break)
  //   (c) backend.err has fresh crash trace in last hour — surface first line
  try {
    const homeDir = process.env.HOME || `/Users/${process.env.USER || ""}`
    const logDir = path.join(homeDir, "Library", "Logs")
    const BACKEND_LABEL = "com.motel666.backend"
    const errPath = path.join(logDir, `${BACKEND_LABEL}.err`)
    const outPath = path.join(logDir, `${BACKEND_LABEL}.out`)
    const FRESH_WINDOW_MS = 60 * 60 * 1000  // 1 hour
    const STALE_WARN_MIN = 30

    for (const [label, fp] of [["stderr", errPath], ["stdout", outPath]]) {
      if (!fs.existsSync(fp)) {
        F(`backend ${label} log MISSING — ${fp} (plist paths configured but files don't exist; LaunchAgent unload/load required)`)
        continue
      }
      const st = fs.statSync(fp)
      const ageMin = Math.round((Date.now() - st.mtimeMs) / 60000)
      if (label === "stdout" && ageMin > STALE_WARN_MIN) {
        W(`backend stdout log stale — ${ageMin}m old (${fp}). Backend appears running but no log writes — LaunchAgent may not be redirecting`)
      } else {
        I(`backend ${label} log: ${st.size}B, ${ageMin}m old`)
      }
    }

    // Scan backend.err for recent crash traces (canary for next crash)
    if (fs.existsSync(errPath)) {
      const errSize = fs.statSync(errPath).size
      if (errSize > 0) {
        const raw = fs.readFileSync(errPath, "utf8")
        const recent = raw.split("\n").slice(-200)
        const traceRegex = /^\s*(at\s|Error[\w]*:|TypeError|ReferenceError|throw |UnhandledPromiseRejection|FATAL|Segmentation fault|Abort trap)/
        const firstTraceLine = recent.find((l) => traceRegex.test(l))
        if (firstTraceLine) {
          const freshMs = Date.now() - fs.statSync(errPath).mtimeMs
          if (freshMs < FRESH_WINDOW_MS) {
            F(`backend.err FRESH CRASH TRACE in last hour: "${firstTraceLine.trim().slice(0, 200)}" — investigate ${errPath}`)
          } else {
            I(`backend.err has historical trace ("${firstTraceLine.trim().slice(0, 100)}") but file mtime > 1h old`)
          }
        } else {
          I(`backend.err non-empty (${errSize}B) but no crash marker pattern detected in recent slice`)
        }
      }
    }
  } catch (e) {
    W(`backend log audit failed: ${e.message}`)
  }

  // 9. CALIBRATION (model claim vs realized hit rate per family)
  // The bug class that cost the operator $10 on Game 7 (2026-05-31): model
  // said 65% UNDER rebounds, family hit 9.4%. Every settled pick in window
  // gives us {modelProb, actual win/loss}. Group by family, compare stated
  // mean model probability to realized win rate. Flag when |stated - realized|
  // > thresholds. PERSISTS calibration data to family_calibration.json so the
  // dampener (calibrationDampener.js) can apply the multiplier downstream.
  H("9. CALIBRATION (model claim vs realized hit rate per family)")
  const CAL_WINDOW_DAYS = 7
  const CAL_MIN_SAMPLE = 20
  const CALIBRATION_OUT = { generatedAt: new Date().toISOString(), windowDays: CAL_WINDOW_DAYS, minSample: CAL_MIN_SAMPLE, sports: {} }
  for (const sport of ["nba", "mlb"]) {
    const buckets = {}  // statFamily → { stated: [], wins: 0, losses: 0, pushes: 0 }
    for (let i = 0; i < CAL_WINDOW_DAYS; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const dk = slateDateForTimestamp(d.getTime())
      const arr = readJsonSafe(path.join(TRACKING, `${sport}_tracked_bets_${dk}.json`))
      if (!Array.isArray(arr)) continue
      for (const b of arr) {
        const fam = b.statFamily || "unknown"
        const r = String(b.result || "").toLowerCase()
        if (r !== "win" && r !== "loss" && r !== "push" && r !== "void") continue
        const mp = Number(b.modelProb)
        if (!Number.isFinite(mp)) continue
        if (!buckets[fam]) buckets[fam] = { stated: [], wins: 0, losses: 0, pushes: 0 }
        buckets[fam].stated.push(mp)
        if (r === "win") buckets[fam].wins++
        else if (r === "loss") buckets[fam].losses++
        else buckets[fam].pushes++
      }
    }
    console.log(`  ${sport.toUpperCase()} (window ${CAL_WINDOW_DAYS}d, min sample ${CAL_MIN_SAMPLE}):`)
    const fams = Object.keys(buckets).sort()
    if (!fams.length) { I(`  (no settled picks to calibrate against)`); continue }
    CALIBRATION_OUT.sports[sport] = {}
    for (const fam of fams) {
      const b = buckets[fam]
      const settled = b.wins + b.losses + b.pushes
      if (settled < CAL_MIN_SAMPLE) {
        I(`  ${fam}: n=${settled} (below min ${CAL_MIN_SAMPLE} — defer)`)
        continue
      }
      const meanStated = b.stated.reduce((s, v) => s + v, 0) / b.stated.length
      const realized = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0
      const gap = Math.abs(meanStated - realized) * 100  // percentage points
      // Persist multiplier for dampener — clipped to [0.20, 1.10] so we never
      // suppress to zero or amplify unreasonably. A family realized at 9.4%
      // and claimed at 41.4% yields multiplier 0.227 (apply: claim 65% → 14.8%).
      const rawMul = meanStated > 0 ? realized / meanStated : 1
      const multiplier = Math.max(0.20, Math.min(1.10, rawMul))
      CALIBRATION_OUT.sports[sport][fam] = {
        n: settled, stated: Math.round(meanStated * 10000) / 10000,
        realized: Math.round(realized * 10000) / 10000,
        gapPp: Math.round(gap * 10) / 10,
        multiplier: Math.round(multiplier * 10000) / 10000,
      }
      const fmt = `model ${(meanStated * 100).toFixed(1)}% / realized ${(realized * 100).toFixed(1)}% — gap ${gap.toFixed(1)}pp (n=${settled}) · mul ×${multiplier.toFixed(2)}`
      if (gap < 10) P(`  ${fam}: ${fmt}`)
      else if (gap < 20) W(`  ${fam}: ${fmt} — meaningful gap, dampen`)
      else if (gap < 35) W(`  ${fam}: ${fmt} — LARGE gap, dampen aggressively`)
      else F(`  ${fam}: ${fmt} — SEVERELY MISCALIBRATED, model claims overstated by ${gap.toFixed(0)}pp`)
    }
  }
  // Persist calibration data for the dampener (calibrationDampener.js reads this)
  try {
    const calOut = path.join(REPO, "backend", "runtime", "calibration")
    fs.mkdirSync(calOut, { recursive: true })
    fs.writeFileSync(path.join(calOut, "family_calibration.json"), JSON.stringify(CALIBRATION_OUT, null, 2))
    I(`  → persisted to backend/runtime/calibration/family_calibration.json`)
  } catch (e) { W(`  calibration persistence failed: ${e.message}`) }

  // 10. DRIFT MARKERS
  H("10. DRIFT MARKERS")
  const canonical = ["RUNTIME_FACTS.md", "PLAYBOOK.md", ".gitignore"]
  for (const f of canonical) {
    if (fs.existsSync(path.join(REPO, f))) P(`Canonical file present: ${f}`)
    else F(`Canonical file MISSING: ${f}`)
  }
  try {
    const status = execSync("git status -s", { cwd: REPO, timeout: 2000 }).toString().trim()
    const lines = status ? status.split("\n") : []
    // Exclude: data/, .scratch/, untracked debug probes (probe*.js), and any
    // untracked file (?? prefix) — those are work-in-progress, not drift.
    const codeChanges = lines.filter((l) => {
      if (!/\.(js|ts|html|css|sh|md)$/.test(l)) return false
      if (l.includes("data/") || l.includes(".scratch/")) return false
      if (l.startsWith("??")) return false  // untracked, not "uncommitted change"
      if (/\bprobe[A-Z][^/]*\.js$/.test(l)) return false  // debug probes
      return true
    })
    if (codeChanges.length === 0) P(`No uncommitted code changes (${lines.length} non-code or untracked paths)`)
    else {
      W(`${codeChanges.length} uncommitted code change(s) — review:`)
      for (const l of codeChanges) console.log("    " + l)
    }
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

  // 2026-05-31 (g) — audit history JSONL for delta detector. Append one line
  // per run so auditDeltaCheck.js can compare hour-over-hour and flag
  // regressions (the "radar" — fires when a fix breaks something we already
  // had right).
  try {
    const histFile = path.join(REPO, "backend", "runtime", "audits", "audit_history.jsonl")
    let commit = "unknown"
    try { commit = execSync("git rev-parse HEAD", { cwd: REPO, timeout: 2000 }).toString().trim() } catch {}
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      audit: "sys",
      commit: commit.slice(0, 7),
      commitFull: commit,
      totals: { passed: PASSED, warned: WARNED, failed: FAILED, total },
      status: FAILED === 0 && WARNED === 0 ? "GREEN" : (FAILED === 0 ? "YELLOW" : "RED"),
    })
    fs.mkdirSync(path.dirname(histFile), { recursive: true })
    fs.appendFileSync(histFile, line + "\n")
  } catch (e) { /* don't fail the audit because history append failed */ }

  process.exit(FAILED > 0 ? 2 : (WARNED > 0 ? 1 : 0))
}

main().catch((e) => { console.error("FATAL:", e); process.exit(3) })
