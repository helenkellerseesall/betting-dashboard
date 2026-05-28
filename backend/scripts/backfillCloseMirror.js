"use strict"

/**
 * 2026-05-28 — Lane B Phase 3 v0.1.2 backfill helper.
 *
 * One-shot field-based mirror of tracked_bets close data into personal_ledger.
 *
 * Why this exists:
 *   Before today's v0.1.2 fix, captureClosingLines mirrored via stableId(),
 *   which embeds Date.now() in its suffix — so identical inputs returned
 *   different IDs and the ledger mirror matched 0/N silently for weeks.
 *   tracked_bets has hundreds of bets with closeOdds set whose ledger
 *   entries are still missing clvSnapshot.close. This script back-mirrors
 *   them using the new field-based batchSetClosingLinesByFields().
 *
 * Behavior:
 *   - Reads every {sport}_tracked_bets_{date}.json under runtime/tracking
 *   - For each bet with closeOdds set, builds a field entry tagged with
 *     sport from filename (tracked_bets bodies often have sport=null for MLB)
 *   - Calls batchSetClosingLinesByFields per sport
 *   - Prints applied counts and a per-file summary
 *
 * Idempotent: re-running just overwrites clvSnapshot.close with the same
 * values. Existing placed odds and clv results are recomputed identically.
 *
 * Usage:
 *   node backend/scripts/backfillCloseMirror.js
 */

const fs = require("fs")
const path = require("path")
const _personalLedger = require("../pipeline/shared/buildPersonalLedger")

const TRACKING_DIR = path.join(__dirname, "..", "runtime", "tracking")
const SUPPORTED_SPORTS = ["nba", "mlb"]

function listTrackedFiles(sport) {
  const re = new RegExp(`^${sport}_tracked_bets_(\\d{4}-\\d{2}-\\d{2})\\.json$`)
  if (!fs.existsSync(TRACKING_DIR)) return []
  return fs.readdirSync(TRACKING_DIR)
    .filter((f) => re.test(f))
    .map((f) => ({ file: f, date: f.match(re)[1], path: path.join(TRACKING_DIR, f) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function readBets(p) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"))
    if (Array.isArray(raw)) return raw
    if (Array.isArray(raw?.bets)) return raw.bets
    return []
  } catch (e) {
    console.warn(`[backfillCloseMirror] read failed: ${p} (${e.message})`)
    return []
  }
}

function entriesFromBets(bets, sport) {
  const entries = []
  for (const b of bets) {
    if (b?.closeOdds == null) continue
    if (!Number.isFinite(Number(b.closeOdds))) continue
    entries.push({
      sport,
      date:              b.date || null,
      player:            b.player || null,
      statFamily:        b.statFamily || null,
      side:              b.side || null,
      line:              b.line ?? null,
      sportsbook:        b.sportsbook || null,
      closingOdds:       Number(b.closeOdds),
      closingLine:       (b.line != null ? Number(b.line) : null),
      closingSportsbook: b.sportsbook || null,
      closedAt:          b.closeObservedAt || null,
    })
  }
  return entries
}

function main() {
  if (typeof _personalLedger.batchSetClosingLinesByFields !== "function") {
    console.error("[backfillCloseMirror] FATAL: batchSetClosingLinesByFields not exported. Aborting.")
    process.exit(2)
  }

  const overall = { byFile: [], bySport: {}, totalEntries: 0, totalApplied: 0 }

  for (const sport of SUPPORTED_SPORTS) {
    const files = listTrackedFiles(sport)
    overall.bySport[sport] = { files: files.length, entries: 0, applied: 0 }
    const sportEntries = []
    for (const f of files) {
      const bets = readBets(f.path)
      const entries = entriesFromBets(bets, sport)
      sportEntries.push(...entries)
      overall.byFile.push({
        sport,
        date: f.date,
        betsTotal: bets.length,
        entriesWithClose: entries.length,
      })
    }
    if (sportEntries.length === 0) {
      console.log(`[backfillCloseMirror] ${sport.toUpperCase()}: 0 entries with closeOdds, skipping.`)
      continue
    }
    console.log(`[backfillCloseMirror] ${sport.toUpperCase()}: mirroring ${sportEntries.length} entries with closeOdds across ${overall.bySport[sport].files} files`)
    const res = _personalLedger.batchSetClosingLinesByFields(sportEntries, { save: true })
    overall.bySport[sport].entries = sportEntries.length
    overall.bySport[sport].applied = res?.count || 0
    overall.totalEntries += sportEntries.length
    overall.totalApplied += res?.count || 0
    console.log(`[backfillCloseMirror] ${sport.toUpperCase()}: applied ${res?.count || 0} / ${sportEntries.length} requested`)
  }

  console.log("\n[backfillCloseMirror] per-file:")
  for (const r of overall.byFile) {
    console.log(`  ${r.sport} ${r.date}: ${r.betsTotal} bets, ${r.entriesWithClose} with closeOdds`)
  }
  console.log("\n[backfillCloseMirror] summary:")
  console.log(`  total entries seen:      ${overall.totalEntries}`)
  console.log(`  total ledger mirrors:    ${overall.totalApplied}`)
  console.log(`  mirror efficiency:       ${overall.totalEntries ? ((overall.totalApplied / overall.totalEntries) * 100).toFixed(1) : "n/a"}%`)
  console.log(`  (mirrors < entries means tracked_bet exists but no matching ledger entry — those bets were never imported)`)
}

if (require.main === module) {
  main()
}

module.exports = { main }
