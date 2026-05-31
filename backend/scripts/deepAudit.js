#!/usr/bin/env node
"use strict"

/**
 * deepAudit.js — 10-category trust audit.
 *
 * Built 2026-05-31 in response to operator's "100% trust" ask. sysAudit checks
 * data freshness + calibration. deepAudit goes deeper: date math correctness,
 * FE staleness signaling, schema stability, cross-engine consistency, engine
 * family completeness, LaunchAgent log error scrubbing, endpoint smoke tests,
 * live ingestion verification, persistence safety, disk/memory pressure.
 *
 * Output mirrors sysAudit format: [✓/!/✗] + section summary + RED/YELLOW/GREEN.
 *
 * Designed to be safe to run anytime (read-only on disk and against the
 * running backend; no mutations).
 */

const fs = require("fs")
const path = require("path")
const http = require("http")
const { execSync, spawnSync } = require("child_process")

const REPO = path.join(__dirname, "..", "..")
const TRACKING = path.join(REPO, "backend", "runtime", "tracking")
const DATA = path.join(REPO, "backend", "data")
const OPERATOR = path.join(REPO, "backend", "runtime", "operator")
const RUNTIME = path.join(REPO, "backend", "runtime")

let PASSED = 0, WARNED = 0, FAILED = 0
const P = (l) => { console.log("[✓]", l); PASSED++ }
const W = (l) => { console.log("[!]", l); WARNED++ }
const F = (l) => { console.log("[✗]", l); FAILED++ }
const I = (l) => { console.log("[—]", l) }
const H = (t) => { console.log("\n=== " + t + " ===") }

function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null } }
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function detectPort() {
  if (process.env.PORT) return Number(process.env.PORT)
  try {
    const facts = fs.readFileSync(path.join(REPO, "RUNTIME_FACTS.md"), "utf8")
    const m = facts.match(/\*\*Port:\*\*\s*`?(\d{2,5})`?/i)
    if (m) return Number(m[1])
  } catch {}
  return 4000
}
function fetchJson(p) {
  const port = detectPort()
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "GET", timeout: 5000 }, (res) => {
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
  console.log(`=== DEEP AUDIT — ${new Date().toISOString()} ===`)
  console.log(`Repo: ${REPO}\n`)

  // 1. DATE AWARENESS — does the backend's "today" match what we expect?
  H("1. DATE AWARENESS")
  const TK = todayKey()
  const serverNow = new Date()
  const utcKey = `${serverNow.getUTCFullYear()}-${String(serverNow.getUTCMonth() + 1).padStart(2, "0")}-${String(serverNow.getUTCDate()).padStart(2, "0")}`
  const etDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(serverNow)
  const localTooEarly = serverNow.getHours() < 6 || serverNow.getHours() > 23
  if (TK === etDateStr) P(`Server local-day-key (${TK}) matches Detroit ET date (${etDateStr})`)
  else W(`Server local-day-key (${TK}) DIFFERS from Detroit ET date (${etDateStr}) — may produce wrong tracked_bets filenames`)
  if (TK === utcKey) I(`UTC and local agree (${utcKey})`)
  else I(`UTC date (${utcKey}) ≠ local (${TK}) — expected ~12h overlap`)
  // Detect `new Date()` in slate-date math (a check for code-level dependencies)
  try {
    const slateFile = fs.readFileSync(path.join(REPO, "backend", "pipeline", "schedule", "buildSlateEvents.js"), "utf8")
    if (/America\/Detroit/.test(slateFile)) P("buildSlateEvents.js uses ET-aware date conversion (Intl.DateTimeFormat America/Detroit)")
    else W("buildSlateEvents.js may not be ET-aware — verify slate-date keys match operator local day")
  } catch {}

  // 2. FE FRESHNESS SIGNALING — does FE detect backend version mismatch and self-refresh?
  H("2. FE FRESHNESS SIGNALING")
  try {
    const fePath = path.join(REPO, "frontend", "mobile", "index.html")
    const fe = fs.readFileSync(fePath, "utf8")
    const hasVersionFetch = /api\/ws\/version/.test(fe)
    const hasReloadOnMismatch = /location\.reload|window\.location\.reload/.test(fe)
    if (hasVersionFetch && hasReloadOnMismatch) P("FE polls /api/ws/version AND has location.reload on mismatch")
    else if (hasVersionFetch) W("FE polls /api/ws/version but has no auto-reload on mismatch — operator must hard-refresh manually")
    else F("FE has NO version polling — PWA cache can serve infinitely-stale UI without operator knowing")
    // Check for cache-control headers being served
    if (/Cache-Control|cache-control/.test(fe)) I("Cache-Control headers referenced in FE source")
  } catch (e) { F(`Couldn't read frontend/mobile/index.html: ${e.message}`) }

  // 3. SCHEMA STABILITY — verify tracked_bets, tracked_best, personal_ledger, lessons.json shapes
  H("3. SCHEMA STABILITY (golden field check)")
  const SCHEMAS = {
    nba_tracked_bets: ["id", "date", "player", "eventId", "matchup", "gameTime", "statFamily", "side", "line", "oddsAmerican", "sportsbook", "modelProb", "edge", "tier", "result"],
    mlb_tracked_bets: ["id", "date", "player", "eventId", "matchup", "gameTime", "statFamily", "side", "line", "oddsAmerican", "sportsbook", "modelProb", "edge", "tier", "result"],
    personal_ledger:  ["id", "date", "sport", "sportsbook", "stake", "odds", "result", "decisionType"],
    lessons:          ["betId", "tracedAt", "sport", "date", "sportsbook", "legs"],
  }
  function checkShape(label, sampleObj, requiredFields) {
    if (!sampleObj) { F(`${label}: no sample to check`); return }
    const missing = requiredFields.filter((f) => !(f in sampleObj))
    if (missing.length === 0) P(`${label}: all ${requiredFields.length} required fields present`)
    else F(`${label}: missing fields → ${missing.join(", ")}`)
  }
  for (const sport of ["nba", "mlb"]) {
    const bets = readJsonSafe(path.join(TRACKING, `${sport}_tracked_bets_${TK}.json`))
    if (Array.isArray(bets) && bets.length) checkShape(`${sport} tracked_bets ${TK}`, bets[0], SCHEMAS[`${sport}_tracked_bets`])
    else I(`${sport} tracked_bets ${TK}: empty/missing, skipping shape check`)
  }
  const ledger = readJsonSafe(path.join(TRACKING, "personal_ledger.json"))
  if (ledger?.bets?.length) checkShape("personal_ledger.bets[0]", ledger.bets[0], SCHEMAS.personal_ledger)
  const lessons = readJsonSafe(path.join(OPERATOR, "lessons.json"))
  if (lessons?.entries?.length) checkShape("lessons.entries[0]", lessons.entries[0], SCHEMAS.lessons)

  // 4. CROSS-ENGINE CONSISTENCY — same prop in snapshot vs inspection paths
  H("4. CROSS-ENGINE CONSISTENCY")
  // 2026-05-31 — design-vs-drift distinction. tracked_best is a curated subset
  // (NBA: full coverage. MLB: BATTER-ONLY power families = Total Bases / Home Runs /
  // Hits / RBIs). Pitcher props (ks, outs) and non-power batter props (walks,
  // runs) intentionally have no tracked_best entries. So MLB "only-in-bets"
  // should be compared against BATTER-family players only, not all players.
  const MLB_BEST_COVERED_FAMILIES = new Set(["totalBases", "totalbases", "total_bases", "hr", "home_runs", "homeruns", "hits", "rbis"])
  for (const sport of ["nba", "mlb"]) {
    const bets = readJsonSafe(path.join(TRACKING, `${sport}_tracked_bets_${TK}.json`)) || []
    const best = readJsonSafe(path.join(TRACKING, `${sport}_tracked_best_${TK}.json`)) || { entries: [] }
    if (!bets.length && !best.entries.length) { I(`${sport.toUpperCase()} ${TK}: both empty, nothing to compare`); continue }
    // For MLB, restrict the bets-side comparison to families that tracked_best actually covers
    // AND exclude LONGSHOT/FADE tier (those are filtered from FE display, so missing reasoning blurbs doesn't matter for them)
    const relevantBets = sport === "mlb"
      ? bets.filter((b) => {
          const fam = String(b.statFamily || "").toLowerCase()
          const tier = String(b.tier || b.modelTier || "").toUpperCase()
          return MLB_BEST_COVERED_FAMILIES.has(fam) && tier !== "LONGSHOT" && tier !== "FADE"
        })
      : bets.filter((b) => {
          const tier = String(b.tier || b.modelTier || "").toUpperCase()
          return tier !== "LONGSHOT" && tier !== "FADE"
        })
    const betPlayers = new Set((relevantBets || []).map((b) => String(b.player || "").toLowerCase()))
    const bestPlayers = new Set((best.entries || []).map((e) => String(e.player || "").toLowerCase()))
    const onlyInBets = [...betPlayers].filter((p) => !bestPlayers.has(p)).length
    const onlyInBest = [...bestPlayers].filter((p) => !betPlayers.has(p)).length
    const overlap = [...betPlayers].filter((p) => bestPlayers.has(p)).length
    const scopeLabel = sport === "mlb" ? " (scope: batter-power-families only — pitcher props excluded by design)" : ""
    if (overlap > 0 && onlyInBets < Math.max(betPlayers.size * 0.3, 5)) {
      P(`${sport.toUpperCase()} ${TK}: ${overlap} players in BOTH bets+best${scopeLabel} (${onlyInBets} only-bets, ${onlyInBest} only-best)`)
    } else if (overlap > 0) {
      W(`${sport.toUpperCase()} ${TK}: ${overlap} overlap but ${onlyInBets} only in bets${scopeLabel} — check enrichment join for covered families`)
    } else if (betPlayers.size && bestPlayers.size) {
      F(`${sport.toUpperCase()} ${TK}: ZERO overlap between bets (${betPlayers.size}) and best (${bestPlayers.size})${scopeLabel} — pipelines diverged`)
    }
  }

  // 5. ENGINE FAMILY COMPLETENESS
  H("5. ENGINE FAMILY COMPLETENESS")
  const EXPECTED = {
    nba: ["points", "rebounds", "assists", "threes", "pra", "points_rebounds", "points_assists", "rebounds_assists", "steals", "blocks", "double_double"],
    mlb: ["hits", "totalBases", "hr", "rbis", "runs", "ks", "outs", "walks"],
  }
  for (const sport of Object.keys(EXPECTED)) {
    const bets = readJsonSafe(path.join(TRACKING, `${sport}_tracked_bets_${TK}.json`)) || []
    if (!bets.length) { I(`${sport.toUpperCase()} ${TK}: no picks to check families`); continue }
    const fams = new Set(bets.map((b) => b.statFamily))
    const missing = EXPECTED[sport].filter((f) => !fams.has(f))
    const expected = EXPECTED[sport].length
    if (missing.length === 0) P(`${sport.toUpperCase()} ${TK}: all ${expected} expected families present`)
    else if (missing.length <= 2) W(`${sport.toUpperCase()} ${TK}: ${expected - missing.length}/${expected} families · missing: ${missing.join(", ")}`)
    else F(`${sport.toUpperCase()} ${TK}: only ${expected - missing.length}/${expected} families · missing: ${missing.join(", ")}`)
  }

  // 6. LAUNCHAGENT LOG SCRUBBING
  H("6. LAUNCHAGENT LOG SCRUBBING (stderr / error patterns in last 200 lines)")
  const logPaths = [
    [`${process.env.HOME}/Library/Logs/com.motel666.backend.err`, "backend"],
    [`${process.env.HOME}/Library/Logs/com.motel666.scheduler.err`, "scheduler"],
    [`${process.env.HOME}/Library/Logs/com.motel666.cloudflared.err`, "cloudflared"],
    [`${process.env.HOME}/Library/Logs/com.motel666.caffeinate.err`, "caffeinate"],
    ["/tmp/motel666-backend.err", "backend (alt)"],
  ]
  // 2026-05-31 — distinguish "plist configured but quiet" from "not configured."
  // If the plist HAS StandardErrorPath but the file doesn't exist, the agent
  // has just been quiet (healthy). If the plist DOESN'T have it, the redirect
  // is missing and we need to run configureLaunchAgentLogs.sh.
  function plistHasStderrRedirect(label) {
    const plistPath = `${process.env.HOME}/Library/LaunchAgents/${label}.plist`
    try {
      const out = execSync(`/usr/libexec/PlistBuddy -c "Print :StandardErrorPath" "${plistPath}" 2>/dev/null`, { timeout: 2000 }).toString().trim()
      return out.length > 0 && !out.includes("Does Not Exist")
    } catch { return false }
  }
  for (const [p, label] of logPaths) {
    // Derive the agent label from the log path (com.motel666.backend.err → com.motel666.backend)
    const agentLabel = path.basename(p).replace(/\.(err|out)$/, "")
    try {
      const stat = fs.statSync(p)
      const tail = execSync(`tail -200 "${p}" | grep -ciE "error|fatal|exception|EADDR|ECONN|throw "`, { timeout: 2000 }).toString().trim()
      const errCount = Number(tail) || 0
      const ageH = Math.round(((Date.now() - stat.mtime.getTime()) / 3600000) * 10) / 10
      if (errCount === 0) P(`${label} log: 0 error patterns in last 200 lines (last write ${ageH}h ago)`)
      else if (errCount < 5) W(`${label} log: ${errCount} error patterns in last 200 lines (last write ${ageH}h ago)`)
      else F(`${label} log: ${errCount} error patterns in last 200 lines — investigate`)
    } catch (e) {
      if (e.code === "ENOENT") {
        // File missing — is the redirect configured or not?
        if (label.includes("alt")) { I(`${label} log: not found at ${p} (legacy alt path, ignore)`); continue }
        if (plistHasStderrRedirect(agentLabel)) {
          P(`${label} log: plist configured for ${p} but agent silent (no stderr written — healthy)`)
        } else {
          W(`${label} log: plist NOT configured to redirect stderr — run configureLaunchAgentLogs.sh`)
        }
      } else W(`${label} log: read failed (${e.message})`)
    }
  }

  // 7. ENDPOINT SMOKE TEST
  H("7. ENDPOINT SMOKE TEST (every /api/ws/* surface responds 200 + non-empty)")
  const ENDPOINTS = [
    ["/api/ws/version", (j) => j.commit?.length === 40],
    ["/api/ws/top-picks?limit=5", (j) => Array.isArray(j.picks)],
    ["/api/ws/games-browser", (j) => Array.isArray(j.games)],
    ["/api/ws/grades-health?days=7", (j) => j.sports?.nba && j.sports?.mlb],
    ["/api/ws/ledger/yesterday", (j) => j.tracking || j.totals || j.picks],
  ]
  for (const [url, validator] of ENDPOINTS) {
    const r = await fetchJson(url)
    if (!r.ok) F(`${url} → ${r.error || "HTTP " + r.status}`)
    else if (validator && !validator(r.json)) W(`${url} → 200 but unexpected shape`)
    else P(`${url} → 200 + shape valid`)
  }

  // 8. LIVE DATA INGESTION FRESHNESS
  H("8. LIVE DATA INGESTION (per-source last-write timestamps)")
  const ingestSources = [
    ["nbaInjuryReport.json", "NBA injuries", 6],          // ESPN, hourly fine
    ["mlbGameWeather.json", "MLB weather", 6],
    ["mlbBatterStats.json", "MLB batter season stats", 24],
    ["nbaPlayerGameLogs.json", "NBA game logs", 18],
  ]
  for (const [f, label, maxAgeH] of ingestSources) {
    const p = path.join(DATA, f)
    try {
      const ageH = Math.round(((Date.now() - fs.statSync(p).mtime.getTime()) / 3600000) * 10) / 10
      if (ageH <= maxAgeH) P(`${label}: ${ageH}h old (max ${maxAgeH}h) — fresh`)
      else W(`${label}: ${ageH}h old (max ${maxAgeH}h) — refresh recommended`)
    } catch (e) { F(`${label}: file missing (${e.code})`) }
  }

  // 9. PERSISTENCE SAFETY (verify placed-bet exemption is actually in effect)
  H("9. PERSISTENCE SAFETY")
  try {
    const buildSrc = fs.readFileSync(path.join(REPO, "backend", "pipeline", "shared", "buildPersonalLedger.js"), "utf8")
    if (/isPlaced.*decisionType.*placed.*realMoney/s.test(buildSrc) || /placed-bet protection/.test(buildSrc)) {
      P("buildPersonalLedger.js: placed-bet exemption in prune logic (real-money bets cannot be swept)")
    } else {
      F("buildPersonalLedger.js: NO placed-bet exemption found — FIFO prune can wipe real-money bets")
    }
    if (/MAX_BETS/.test(buildSrc)) {
      const m = buildSrc.match(/MAX_BETS\s*=\s*(\d+)/)
      if (m) I(`MAX_BETS = ${m[1]} (ledger soft cap)`)
    }
  } catch (e) { F(`Couldn't verify buildPersonalLedger.js: ${e.message}`) }
  const lpath = path.join(TRACKING, "personal_ledger.json")
  if (ledger) {
    const placed = (ledger.bets || []).filter((b) => b.decisionType === "placed" || b.realMoney === true)
    if (placed.length > 0) P(`personal_ledger: ${placed.length} placed bets present in ledger`)
    else W(`personal_ledger: 0 placed bets currently in ledger`)
  }

  // 10. DISK + MEMORY PRESSURE
  H("10. DISK + MEMORY PRESSURE")
  try {
    const ledgerSize = fs.statSync(lpath).size
    const sizeMb = Math.round(ledgerSize / 1024 / 1024 * 10) / 10
    if (sizeMb > 500) F(`personal_ledger.json: ${sizeMb}MB — RAM pressure on backend load, consider SQLite migration`)
    else if (sizeMb > 100) W(`personal_ledger.json: ${sizeMb}MB — getting large, expect slower reads`)
    else P(`personal_ledger.json: ${sizeMb}MB`)
  } catch {}
  // Recent file sizes
  try {
    const tracking = fs.readdirSync(TRACKING)
    const totalTrackingMb = tracking.reduce((sum, f) => {
      try { return sum + fs.statSync(path.join(TRACKING, f)).size } catch { return sum }
    }, 0) / 1024 / 1024
    I(`tracking/ total: ${Math.round(totalTrackingMb * 10) / 10}MB across ${tracking.length} files`)
    if (totalTrackingMb > 500) W(`tracking/ ${Math.round(totalTrackingMb)}MB — consider archival of slates older than 30 days`)
  } catch {}
  try {
    const df = execSync("df -h /", { timeout: 2000 }).toString().split("\n")[1]
    const pct = (df.match(/(\d+)%/) || [])[1]
    if (pct && Number(pct) < 80) P(`Disk usage: ${pct}% (root volume)`)
    else if (pct) W(`Disk usage: ${pct}% — getting tight`)
  } catch {}

  // SUMMARY
  H("SUMMARY")
  const total = PASSED + WARNED + FAILED
  console.log(`✓ ${PASSED} passed · ! ${WARNED} warnings · ✗ ${FAILED} failures (${total} checks)`)
  if (FAILED === 0 && WARNED === 0) console.log("STATUS: GREEN — deep audit clean, no drift detected")
  else if (FAILED === 0) console.log("STATUS: YELLOW — functional but freshness/drift concerns above")
  else console.log("STATUS: RED — at least one critical drift, see ✗ lines")

  // 2026-05-31 (g) — audit history JSONL for delta detector. Same shape as
  // sysAudit so auditDeltaCheck.js can compare hour-over-hour.
  try {
    const histFile = path.join(REPO, "backend", "runtime", "audits", "audit_history.jsonl")
    let commit = "unknown"
    try { commit = execSync("git rev-parse HEAD", { cwd: REPO, timeout: 2000 }).toString().trim() } catch {}
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      audit: "deep",
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
