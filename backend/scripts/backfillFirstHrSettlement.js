#!/usr/bin/env node
"use strict"

/**
 * backfillFirstHrSettlement.js — F FIRST-HR CURE (2026-07-11) historical backfill.
 *
 *   node backend/scripts/backfillFirstHrSettlement.js --dry    # report only
 *   node backend/scripts/backfillFirstHrSettlement.js          # write
 *
 * Re-settles batter_first_home_run rows in the retained mlb_tracked_bets files
 * under the HONEST rule (play-by-play order): first-HR hitter ⇒ win · someone
 * else ⇒ loss · homerless final ⇒ void · non-final/unjoinable ⇒ left as-is.
 *
 * WHY settled rows are touched here (GRADING_RULES §6 exception, operator-
 * ordered): the v1 settlement of THIS market was mechanically wrong (line=0 +
 * box-score total ⇒ any-HR graded a FALSE WIN, no-HR graded PUSH instead of
 * loss). This is a rules-correction of known-wrong grades, not a re-grade under
 * new rules; every corrected row gets a note stamp. Runs dry→diff→write.
 * Game dates derive from each row's gameTime via the canonical ET calendar
 * helper (never UTC truncation — Game-Date-Timing doctrine).
 */

const fs = require("fs")
const path = require("path")
const { fetchMlbFirstHr, buildFirstHrCtx } = require("../pipeline/grading/fetchMlbFirstHr")
const { calendarDateForTimestamp } = require("../pipeline/shared/slateDate")

const TRACKING = path.join(__dirname, "..", "runtime", "tracking")
const DRY = process.argv.includes("--dry")

;(async () => {
  const files = fs.readdirSync(TRACKING).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const ctxByDate = new Map() // game-date → ctx
  async function ctxFor(gd) {
    if (!ctxByDate.has(gd)) ctxByDate.set(gd, buildFirstHrCtx(await fetchMlbFirstHr(gd)))
    return ctxByDate.get(gd)
  }
  const tally = { falseWinToLoss: 0, winConfirmed: 0, pushToLoss: 0, pushToVoid: 0, pendingSettled: 0, unresolvable: 0, filesTouched: 0 }
  for (const f of files) {
    let rows
    try { rows = JSON.parse(fs.readFileSync(path.join(TRACKING, f), "utf8")) } catch (_) { continue }
    if (!Array.isArray(rows)) continue
    let changed = 0
    for (const b of rows) {
      if (!b || String(b.marketKey || "") !== "batter_first_home_run") continue
      const res = String(b.result || "pending").toLowerCase()
      if (res === "loss" || res === "void") continue // already honest-or-final states
      const gtMs = b.gameTime ? new Date(b.gameTime).getTime() : NaN
      if (!Number.isFinite(gtMs)) { tally.unresolvable++; continue }
      const gd = calendarDateForTimestamp(gtMs)
      const ctx = await ctxFor(gd)
      const g = ctx.findGame(b)
      if (!g || !g.final) { tally.unresolvable++; continue }
      let want
      if (g.noHr) want = "void"
      else want = (g.firstHrBatter && g.firstHrBatter === ctx.normPlayer(b.player)) ? "win" : "loss"
      if (want === res) { if (res === "win") tally.winConfirmed++; continue }
      if (res === "win" && want === "loss") tally.falseWinToLoss++
      else if (res === "push" && want === "loss") tally.pushToLoss++
      else if (res === "push" && want === "void") tally.pushToVoid++
      else tally.pendingSettled++
      changed++
      if (!DRY) {
        b.result = want
        b.actualValue = want === "win" ? 1 : 0
        b.settledAt = new Date().toISOString()
        b.settleNote = "first-HR rules-correction 2026-07-11 (v1 settled this market mechanically wrong; play-by-play order is authoritative)"
      }
    }
    if (changed && !DRY) {
      const tmp = path.join(TRACKING, `${f}.tmp.${process.pid}`)
      fs.writeFileSync(tmp, JSON.stringify(rows, null, 0))
      fs.renameSync(tmp, path.join(TRACKING, f))
      tally.filesTouched++
    } else if (changed) {
      tally.filesTouched++
    }
  }
  console.log(`mode: ${DRY ? "DRY (no writes)" : "WRITE"}`)
  console.log(`first-HR backfill: ${JSON.stringify(tally, null, 1)}`)
  console.log(DRY ? "re-run without --dry to write." : "written. Corpus note: first-HR is EXCLUDED from calibration training (v3) regardless — this fixes the RECORD; the corpus re-fills forward from honest grading.")
})().catch((e) => { console.error("backfill failed:", e?.message || e); process.exit(1) })
