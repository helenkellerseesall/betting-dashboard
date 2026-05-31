#!/usr/bin/env node
"use strict"

/**
 * restoreLostPlacedBets.js — one-shot recovery of placed bets that were
 * pruned by the FIFO cap in addOrUpdateBet (fixed 2026-05-31).
 *
 * Reads lessons.json (which preserved trace records of placed bets) and
 * reconstructs entries in personal_ledger.json with decisionType="placed"
 * so they survive future prunes (now protected by the placed-bet exemption).
 *
 * Idempotent: skips entries that already exist in the ledger.
 */

const fs = require("fs")
const path = require("path")

const REPO = path.join(__dirname, "..", "..")
const LEDGER = path.join(REPO, "backend", "runtime", "tracking", "personal_ledger.json")
const LESSONS = path.join(REPO, "backend", "runtime", "operator", "lessons.json")

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return fallback }
}

const ledger = readJson(LEDGER, { bets: [] })
const lessons = readJson(LESSONS, { entries: [] })

console.log(`Ledger before: ${(ledger.bets || []).length} bets`)
console.log(`Lessons entries: ${(lessons.entries || []).length}`)

let restored = 0
let skipped = 0
for (const lesson of (lessons.entries || [])) {
  if (!lesson.betId) continue
  const exists = ledger.bets.find((b) => b.id === lesson.betId)
  if (exists) { skipped++; continue }
  // Reconstruct a ledger-shape entry from the lesson record
  const reconstructed = {
    id: lesson.betId,
    date: lesson.date,
    sport: lesson.sport,
    sportsbook: lesson.sportsbook,
    betType: lesson.betType,
    stake: lesson.stake,
    odds: lesson.odds,
    toWin: lesson.stake > 0 && lesson.odds
      ? (Number(lesson.odds) > 0 ? lesson.stake * (Number(lesson.odds) / 100) : lesson.stake / (Math.abs(Number(lesson.odds)) / 100))
      : null,
    decisionType: "placed",
    realMoney: true,
    placedAt: lesson.tracedAt,
    result: lesson.overallVerdict === "LOST" ? "loss"
          : lesson.overallVerdict === "WON"  ? "win"
          : "pending",
    settledAt: lesson.overallVerdict !== "PENDING" ? lesson.tracedAt : null,
    payout: lesson.overallVerdict === "WON" ? Math.round((lesson.stake + (lesson.stake * Math.abs(Number(lesson.odds)) / 100)) * 100) / 100 : 0,
    matchup: (lesson.legs && lesson.legs[0]?.matchup) || null,
    legs: (lesson.legs || []).map((l) => ({
      player: l.player, statFamily: l.statFamily, side: l.side, line: l.line,
      actualStat: l.actual, result: l.verdict === "HIT" ? "win" : l.verdict === "MISS" ? "loss" : "pending",
    })),
    notes: `Restored 2026-05-31 from lessons.json after FIFO prune wiped original (commit fixes placed-bet exemption)`,
    restoredFrom: "lessons.json",
  }
  ledger.bets.push(reconstructed)
  console.log(`Restored: ${reconstructed.id} (${reconstructed.sport} ${reconstructed.sportsbook} $${reconstructed.stake} → ${reconstructed.result})`)
  restored++
}

if (restored > 0) {
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2))
  console.log(`\nLedger after: ${ledger.bets.length} bets (+${restored} restored, ${skipped} skipped)`)
} else {
  console.log(`\nNo restoration needed (${skipped} already present)`)
}
