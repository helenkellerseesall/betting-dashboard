#!/usr/bin/env node
"use strict"

/**
 * probeTrueOpenClv.js — Phase Early-CLV-Measurement-R1 (2026-06-25). READ-ONLY analytics.
 *
 * Measures whether the EARLY pitcher-prop opener (the trueOpen capture) is meaningfully softer than the
 * live 9 AM slate price, by comparing two CLVs on the SAME settled pitcher-prop bets:
 *   - 9AM-open → close   (the existing baseline: tracked openOdds → closeOdds)
 *   - trueOpen → close   (the early capture: mlb_true_open oddsAmerican → the same closeOdds)
 * DELTA = trueOpenCLV − 9amCLV. Positive = the opener was softer (more CLV captured by grabbing early).
 * Highlights OUR deep books (FanDuel + DraftKings). Uses the SAME clvMath.computeClv as the live baseline
 * so the two numbers are apples-to-apples. No writes, no scoring/selection — pure measurement.
 *
 * Honest null is a fine outcome: small/zero/negative delta → the opener isn't softer → stop at R1.
 * Until a few days of trueOpen captures accrue AND those games settle (closeOdds), it reports "not enough
 * data yet" rather than inventing a result.
 */

const path = require("path")
const fs = require("fs")
const { computeClv } = require("../pipeline/grading/clvMath")
const { calendarDateForTimestamp } = require("../pipeline/shared/slateDate")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
const PITCHER_FAMILIES = ["pitcher_strikeouts", "pitcher_outs", "pitcher_earned_runs", "pitcher_walks", "pitcher_hits_allowed"]
const DEEP_BOOKS = new Set(["fanduel", "draftkings"])

const normBook = (b) => String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "")   // "Hard Rock Bet" -> "hardrockbet"
const normName = (n) => String(n || "").toLowerCase().replace(/\s+/g, " ").trim()
const keyOf = (gameDate, player, family, side, line, book) =>
  [gameDate, normName(player), family, String(side || "").toLowerCase(), line == null ? "" : Number(line), normBook(book)].join("|")

function readJson(fp) { try { return JSON.parse(fs.readFileSync(fp, "utf8")) } catch (_) { return null } }

function loadTrueOpen() {
  const map = new Map()   // join-key -> { oddsAmerican, capturedAt }  (keep the EARLIEST capture = the true open)
  let files = []
  try { files = fs.readdirSync(TRACKING_DIR).filter((f) => /^mlb_true_open_\d{4}-\d{2}-\d{2}\.json$/.test(f)) } catch (_) {}
  for (const f of files) {
    const j = readJson(path.join(TRACKING_DIR, f))
    if (!j || !Array.isArray(j.rows)) continue
    for (const r of j.rows) {
      if (!PITCHER_FAMILIES.includes(r.family) || !Number.isFinite(Number(r.oddsAmerican))) continue
      const k = keyOf(r.gameDate, r.player, r.family, r.side, r.line, r.book)
      const prev = map.get(k)
      if (!prev || (j.capturedAt && prev.capturedAt && j.capturedAt < prev.capturedAt)) {
        map.set(k, { oddsAmerican: Number(r.oddsAmerican), capturedAt: j.capturedAt || null })
      }
    }
  }
  return { map, files }
}

function loadSettledPitchers() {
  const rows = []
  let files = []
  try { files = fs.readdirSync(TRACKING_DIR).filter((f) => /^mlb_tracked_bets_\d{4}-\d{2}-\d{2}\.json$/.test(f)) } catch (_) {}
  for (const f of files) {
    const j = readJson(path.join(TRACKING_DIR, f))
    const arr = Array.isArray(j) ? j : (j && (j.entries || j.bets)) || []
    for (const r of arr) {
      const family = String(r.marketKey || "").trim()
      if (!PITCHER_FAMILIES.includes(family)) continue
      if (r.openOdds == null || r.closeOdds == null) continue
      const gameDate = r.gameTime ? calendarDateForTimestamp(new Date(r.gameTime).getTime()) : null
      rows.push({ gameDate, player: r.player, family, side: r.side, line: r.line, book: r.sportsbook, openOdds: Number(r.openOdds), closeOdds: Number(r.closeOdds) })
    }
  }
  return { rows, files }
}

const agg = () => ({ n: 0, clv9: 0, clvTO: 0, delta: 0 })
const add = (a, clv9, clvTO) => { a.n++; a.clv9 += clv9; a.clvTO += clvTO; a.delta += (clvTO - clv9) }
const fin = (a) => a.n ? { n: a.n, clv9pp: +(a.clv9 / a.n * 100).toFixed(2), clvTOpp: +(a.clvTO / a.n * 100).toFixed(2), deltapp: +(a.delta / a.n * 100).toFixed(2) } : { n: 0 }
const sgn = (x) => (x >= 0 ? "+" : "") + x

function main() {
  const { map: to, files: toFiles } = loadTrueOpen()
  const { rows: settled, files: sFiles } = loadSettledPitchers()
  console.log("=== R1 early-CLV probe — trueOpen vs 9AM open, pitcher families → close ===")
  console.log(`trueOpen files: ${toFiles.length} (${to.size} priced rows) · settled tracked_bets files: ${sFiles.length} (${settled.length} pitcher rows w/ open+close)`)

  if (!to.size) {
    console.log("\nNOT ENOUGH DATA YET — no trueOpen captures on disk. The 6 AM capture starts writing")
    console.log("mlb_true_open_<date>.json from its next fire; re-run this probe after a few days, once those")
    console.log("games have also settled (closeOdds stamped). This is expected on day 0, not a failure.")
    return
  }

  const overall = agg(), deep = agg()
  const byFam = new Map(), byBook = new Map()
  let matched = 0
  for (const s of settled) {
    const t = to.get(keyOf(s.gameDate, s.player, s.family, s.side, s.line, s.book))
    if (!t || !Number.isFinite(t.oddsAmerican)) continue
    const clv9 = computeClv({ openOdds: s.openOdds, closeOdds: s.closeOdds })
    const clvTO = computeClv({ openOdds: t.oddsAmerican, closeOdds: s.closeOdds })
    if (clv9 == null || clvTO == null) continue
    matched++
    add(overall, clv9, clvTO)
    if (DEEP_BOOKS.has(normBook(s.book))) add(deep, clv9, clvTO)
    if (!byFam.has(s.family)) byFam.set(s.family, agg()); add(byFam.get(s.family), clv9, clvTO)
    const nb = normBook(s.book); if (!byBook.has(nb)) byBook.set(nb, agg()); add(byBook.get(nb), clv9, clvTO)
  }

  if (!matched) {
    console.log("\nNOT ENOUGH DATA YET — trueOpen captures exist but none join to a SETTLED pitcher bet")
    console.log("(matched on game-date · player · family · side · line · book, with open+close present) yet.")
    console.log("Re-run after those games settle. Not a failure — the overlap just hasn't accrued.")
    return
  }

  const o = fin(overall)
  console.log(`\nMATCHED pitcher bets: ${matched}`)
  console.log(`OVERALL  → 9AM-open CLV ${o.clv9pp}pp · trueOpen CLV ${o.clvTOpp}pp · DELTA ${sgn(o.deltapp)}pp  (positive = opener softer / more CLV grabbing early)`)
  const d = fin(deep)
  if (d.n) console.log(`OUR BOOKS (FanDuel+DraftKings, n=${d.n}) → 9AM ${d.clv9pp}pp · trueOpen ${d.clvTOpp}pp · DELTA ${sgn(d.deltapp)}pp`)

  console.log("\nby family:")
  for (const [fam, a] of byFam) { const x = fin(a); console.log(`  ${fam.padEnd(22)} n=${String(x.n).padStart(4)}  9AM ${x.clv9pp}pp  trueOpen ${x.clvTOpp}pp  Δ ${sgn(x.deltapp)}pp`) }
  console.log("\nby book:")
  for (const [bk, a] of byBook) { const x = fin(a); console.log(`  ${bk.padEnd(14)} n=${String(x.n).padStart(4)}  9AM ${x.clv9pp}pp  trueOpen ${x.clvTOpp}pp  Δ ${sgn(x.deltapp)}pp`) }

  console.log("\nHONEST READ: small/zero/negative DELTA on our books (FanDuel/DraftKings) = the opener is NOT")
  console.log("meaningfully softer → stop at R1 (no staged build). A clear positive delta = R2 worth building.")
  console.log("Needs several days of trueOpen↔settled overlap before n is large enough to trust.")
}

main()
