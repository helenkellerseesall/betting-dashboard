"use strict"

/**
 * daily3.js — THE DAILY 3 (2026-07-14, break-window Part 3). The engine's
 * track-record lens and the SEED OF THE FUTURE PUBLIC RECORD — integrity first:
 *
 *   LOCK: every slate day, the top 3 board picks lock at FIRST PITCH − 60min
 *   (the same /top-picks lens the operator sees — capped-last, calibrated-edge
 *   order). After lock the card is IMMUTABLE (write-once file; the module
 *   REFUSES to overwrite — same doctrine as settled rows, no retroactive edits
 *   ever). If the lock window was missed (process down), it locks as soon as
 *   possible BEFORE first pitch with lockLate=true stamped; once the first
 *   pitch passes unlocked, that day gets NO card (integrity over continuity —
 *   we never lock picks whose games started).
 *
 *   GRADE: the EXISTING nightly (runHistoricalGrade) tuple-joins each locked
 *   pick against its graded tracked row — W/L/Push/Void per GRADING_RULES.
 *   Results are write-once (results!=null ⇒ never regraded). Net units at flat
 *   $1: win ⇒ +american profit, loss ⇒ −1, push/void ⇒ 0.
 *
 *   Zero new grading surface — curation + persistence over existing pipes.
 */

const fs = require("fs")
const path = require("path")
const http = require("http")
const { currentSlateDateEt } = require("./slateDate")

const TRACKING = path.join(__dirname, "..", "..", "runtime", "tracking")
const fileFor = (slate) => path.join(TRACKING, `daily3_${slate}.json`)

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "")

/**
 * First pitch (ms) of the slate; null when no games known.
 * PRIMARY: the slate's tracked_best file — written at slate build and KEEPS
 * started games (snapshot events drop a game once it begins — measured
 * 2026-07-14: 1 game on the slate, events[] empty post-start). Without this,
 * a mid-slate reboot on a multi-game day would see only unstarted games and
 * mistake game 2 for "first pitch" — locking late picks into the public
 * record (false-lock corner). FALLBACK: snapshot events (covers a missing
 * tracked_best pre-start).
 */
function firstPitchMs(slate) {
  const { slateDateForTimestamp } = require("./slateDate")
  const times = []
  const push = (raw) => {
    const t = new Date(raw || 0).getTime()
    if (Number.isFinite(t) && t > 0 && slateDateForTimestamp(t) === slate) times.push(t)
  }
  try {
    const tb = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_best_${slate}.json`), "utf8"))
    for (const e of tb?.entries || []) push(e?.gameTime)
  } catch (_) {}
  if (!times.length) {
    try {
      const wrap = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "snapshot-mlb.json"), "utf8"))
      for (const e of wrap?.data?.events || []) push(e?.commence_time || e?.gameTime)
    } catch (_) {}
  }
  return times.length ? Math.min(...times) : null
}

/** Self-HTTP to the served lens — the EXACT ranking the operator sees. */
function fetchTopPicks(cb) {
  const req = http.get("http://127.0.0.1:4000/api/ws/top-picks?limit=10", { timeout: 8000 }, (res) => {
    let d = ""
    res.on("data", (c) => (d += c))
    res.on("end", () => { try { cb(null, JSON.parse(d)) } catch (e) { cb(e) } })
  })
  req.on("error", cb)
  req.on("timeout", () => { req.destroy(new Error("timeout")) })
}

/**
 * Called every minute by the server loop. No-ops fast in every state except the
 * one minute-window where locking is due. Never throws.
 */
function maybeLockDaily3() {
  try {
    const slate = currentSlateDateEt()
    const fp = fileFor(slate)
    if (fs.existsSync(fp)) return // IMMUTABLE — locked already, never rewrite
    const pitch = firstPitchMs(slate)
    if (!pitch) return // no games this slate (break/off-day) — no card, honestly
    const now = Date.now()
    if (now < pitch - 60 * 60000) return // before the lock window
    if (now >= pitch) return // first pitch passed unlocked — NO card today (integrity)
    fetchTopPicks((err, j) => {
      try {
        if (err || !j || !Array.isArray(j.picks) || j.picks.length < 3) {
          console.log(`[daily3] lock window open but lens unavailable/thin (${err?.message || (j?.picks?.length ?? 0) + " picks"}) — retrying next minute`)
          return
        }
        if (fs.existsSync(fp)) return // race guard
        const picks = j.picks.slice(0, 3).map((p) => ({
          player: p.player, statFamily: p.statFamily, side: p.side, line: p.line,
          sportsbook: p.sportsbook || p.book, odds: p.oddsAmerican ?? p.odds,
          modelProb: p.modelProb ?? null, tier: p.displayTier || p.tier || null,
          calibVersion: p.calibVersion ?? null, selectionPolicy: p.selectionPolicy ?? p.tierPolicy ?? null,
          // 2026-07-17 CARD-IDENTITY — the operator never looks up who a
          // player plays for. Additive; older locked cards render without.
          team: p.team ?? null, matchup: p.matchup ?? null, gameTime: p.gameTime ?? null,
          marketFormat: p.marketFormat ?? null,
        }))
        const card = {
          slate, lockedAt: new Date().toISOString(), firstPitchAt: new Date(pitch).toISOString(),
          lockLate: now > pitch - 55 * 60000, // locked inside the final 55min = the window was missed at its opening
          picks, results: null,
          _doc: "THE DAILY 3 — locked and IMMUTABLE at write; results write-once by the nightly. No retroactive edits ever (public-record seed).",
        }
        const tmp = `${fp}.tmp.${process.pid}`
        fs.writeFileSync(tmp, JSON.stringify(card, null, 2))
        fs.renameSync(tmp, fp)
        console.log(`[daily3] LOCKED ${slate} at ${card.lockedAt} (first pitch ${card.firstPitchAt}${card.lockLate ? ", lockLate" : ""}): ${picks.map((p) => `${p.player} ${p.side} ${p.line} ${p.statFamily}`).join(" | ")}`)
      } catch (e) { console.log("[daily3] lock failed (non-fatal):", e?.message || e) }
    })
  } catch (e) { console.log("[daily3] tick failed (non-fatal):", e?.message || e) }
}

/** American odds → flat-$1 profit on a win. */
function unitProfit(odds) {
  const o = Number(odds)
  if (!Number.isFinite(o) || o === 0) return 0
  return o > 0 ? o / 100 : 100 / Math.abs(o)
}

/**
 * Grade a slate's card from its graded tracked file (tuple join). Write-once:
 * results already set ⇒ no-op. Called by runHistoricalGrade after bets grade.
 */
function gradeDaily3(slate) {
  try {
    const fp = fileFor(slate)
    if (!fs.existsSync(fp)) return { skipped: "no_card" }
    const card = JSON.parse(fs.readFileSync(fp, "utf8"))
    if (card.results) return { skipped: "already_graded" } // write-once
    let tracked = []
    try { tracked = JSON.parse(fs.readFileSync(path.join(TRACKING, `mlb_tracked_bets_${slate}.json`), "utf8")) } catch (_) {}
    const results = []
    let net = 0, decided = 0
    for (const p of card.picks) {
      const t = (Array.isArray(tracked) ? tracked : []).find((r) => r &&
        norm(r.player) === norm(p.player) && String(r.statFamily) === String(p.statFamily) &&
        String(r.side).toLowerCase() === String(p.side).toLowerCase() && Number(r.line) === Number(p.line) &&
        norm(r.sportsbook) === norm(p.sportsbook))
      const res = t ? String(t.result || "pending").toLowerCase() : "pending"
      if (!["win", "loss", "push", "void"].includes(res)) { results.push({ ...p, result: "pending" }); continue }
      decided += res === "win" || res === "loss" ? 1 : 0
      const units = res === "win" ? unitProfit(p.odds) : res === "loss" ? -1 : 0
      net += units
      results.push({ ...p, result: res, actualValue: t?.actualValue ?? null, units: Math.round(units * 100) / 100 })
    }
    if (results.some((r) => r.result === "pending")) return { skipped: "picks_still_pending" } // grade only when complete
    card.results = results
    card.netUnits = Math.round(net * 100) / 100
    card.gradedAt = new Date().toISOString()
    const tmp = `${fp}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(card, null, 2))
    fs.renameSync(tmp, fp)
    console.log(`[daily3] GRADED ${slate}: ${results.map((r) => r.result).join("/")} net ${card.netUnits > 0 ? "+" : ""}${card.netUnits}u`)
    return { graded: true, netUnits: card.netUnits }
  } catch (e) { return { error: String(e?.message || e) } }
}

/** Read API for the route: today's card + full history + honest aggregates. */
function readDaily3() {
  const files = fs.existsSync(TRACKING) ? fs.readdirSync(TRACKING).filter((f) => /^daily3_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse() : []
  const history = []
  for (const f of files) { try { history.push(JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8"))) } catch (_) {} }
  const today = currentSlateDateEt()
  const todayCard = history.find((c) => c.slate === today) || null
  let wins = 0, losses = 0, pushes = 0, net = 0, days = 0
  for (const c of history) {
    if (!c.results) continue
    days++
    for (const r of c.results) {
      if (r.result === "win") wins++
      else if (r.result === "loss") losses++
      else pushes++
    }
    net += Number(c.netUnits) || 0
  }
  const decided = wins + losses
  return {
    today: todayCard,
    todaySlate: today,
    firstPitchAt: todayCard ? todayCard.firstPitchAt : (firstPitchMs(today) ? new Date(firstPitchMs(today)).toISOString() : null),
    history: history.slice(0, 60),
    record: {
      days, wins, losses, pushes, decided,
      winRate: decided ? Math.round((wins / decided) * 1000) / 10 : null,
      netUnits: Math.round(net * 100) / 100,
      smallSample: decided < 30,
      honesty: decided < 30 ? `only ${decided} decided picks — win rate and units are not yet meaningful (needs ~30+)` : null,
    },
  }
}

module.exports = { maybeLockDaily3, gradeDaily3, readDaily3, unitProfit, firstPitchMs }
