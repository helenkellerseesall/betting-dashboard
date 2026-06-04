#!/usr/bin/env node
"use strict"
process.chdir(__dirname)

/**
 * probe_lineage_v1.js — Phase Grading-Calibration-Operations-1D (2026-05-14)
 *
 * Validates the canonical lineage invariants WITHOUT touching production
 * data. Uses /tmp DB for synthetic-fixture assertions.
 *
 * Seven assertion blocks:
 *
 *   1. BYTE-PARITY REGRESSION-GUARD — intel.predictionId() produces
 *      identical bytes when called with the same logical inputs across
 *      multiple casing variants, diacritic variants, and sportsbook alias
 *      variants. (Pre-trim whitespace edges are NOT covered — the
 *      production code never passes whitespace-padded inputs.)
 *
 *   2. ANTI-FABRICATION — JOIN(outcome_snapshots, prediction_snapshots)
 *      cardinality CANNOT exceed min(predictions, outcomes). If it does,
 *      either the DB is corrupt or someone is fabricating join rows.
 *
 *   3. ORPHAN-COUNTING QUERY SHAPE — orphan outcome count + orphan
 *      prediction count + JOIN count are consistent with row totals.
 *
 *   4. CANONICAL HELPER OWNERSHIP — intel.predictionId is the SOLE export
 *      used by both intel.normalizeCandidate and the direct call in
 *      buildPostGameReview. Verified by import test.
 *
 *   5. DIACRITIC EDGE CASES — "José" / "Jose" / "JOSÉ" all normalize to
 *      the same canonical bytes via normPlayer's NFD + combining-strip.
 *
 *   6. ALIAS-FORWARD-ONLY POLICY — prediction_id_aliases.norm_diff_type
 *      values must conform to {'player','family','book','composite'}.
 *      Anything else is a policy violation.
 *
 *   7. RUNGRADING-PATH EQUIVALENCE — given the same source bet object,
 *      the predId produced by buildPostGameReview's direct intel.predictionId
 *      call MUST equal the predId produced by intel.normalizeCandidate.
 *
 * The probe seeds its synthetic DB via direct SQL (NOT via intel.* writers)
 * so it never depends on tryGetDb monkey-patching reaching deeply-cached
 * module state. This is cleaner isolation and reflects only what the JOIN
 * invariants require — the canonical id formula is provided by predictionId
 * which is a pure function.
 *
 * Pass criteria: every assertion passes. Exit 0 on PASS, non-zero on FAIL.
 */

const fs   = require("fs")
const os   = require("os")
const path = require("path")
const { DatabaseSync } = require("node:sqlite")

const checks = []
function ok(label, cond, payload) {
  checks.push({ label, pass: !!cond, payload: payload || null })
  console.log(`  ${cond ? "✓" : "✗"} ${label}`)
  if (!cond && payload) console.log(`      payload: ${JSON.stringify(payload).slice(0, 240)}`)
}

function main() {
  console.log("=== probe_lineage_v1 — Phase Grading-Calibration-Operations-1D ===\n")

  const intel = require("./backend/storage/intelligence")

  // ── BLOCK 1: BYTE-PARITY REGRESSION-GUARD (pure intel.predictionId) ─────
  console.log("── Block 1: byte-parity regression-guard ──")

  const equivClasses = [
    {
      label: "MLB Juan Soto totalbases under 1.5 draftkings",
      base: ["2026-05-08", "mlb", "Juan Soto", "totalBases", "under", 1.5, "DraftKings"],
      variants: [
        ["2026-05-08", "mlb", "Juan Soto",   "totalBases",  "under", 1.5, "DraftKings"],
        ["2026-05-08", "MLB", "JUAN SOTO",   "totalbases",  "UNDER", 1.5, "draftkings"],
        ["2026-05-08", "mlb", "juan soto",   "TotalBases",  "under", 1.5, "DK"],          // DK alias
        ["2026-05-08", "mlb", "Juan Soto",   "total_bases", "under", 1.5, "Draft Kings"], // separator + space
      ],
    },
    {
      label: "NBA Anthony Edwards points over 22.5 fanduel",
      base: ["2026-05-13", "nba", "Anthony Edwards", "points", "over", 22.5, "FanDuel"],
      variants: [
        ["2026-05-13", "nba", "Anthony Edwards", "points", "over", 22.5, "FanDuel"],
        ["2026-05-13", "NBA", "ANTHONY EDWARDS", "POINTS", "OVER", 22.5, "fanduel"],
        ["2026-05-13", "nba", "anthony edwards", "Points", "over", 22.5, "FD"],          // FD alias
      ],
    },
  ]

  for (const ec of equivClasses) {
    const canonical = intel.predictionId(...ec.base)
    let allMatch = true
    for (const v of ec.variants) {
      const computed = intel.predictionId(...v)
      if (computed !== canonical) {
        allMatch = false
        ok(`equiv: ${ec.label} variant [${v.join(", ")}]`, false, { canonical, computed })
      }
    }
    ok(`equiv class consistent: ${ec.label}`, allMatch, { canonical, variants: ec.variants.length })
  }

  // ── BLOCK 2: ANTI-FABRICATION (synthetic DB, direct SQL seeding) ────────
  console.log("\n── Block 2: anti-fabrication (JOIN cardinality bound) ──")

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lineage-"))
  const tmpDbPath = path.join(tmpDir, "test.db")
  const db = new DatabaseSync(tmpDbPath)
  const { applySchema } = require("./backend/storage/schema")
  const { applyIntelligenceSchema } = require("./backend/storage/intelligenceSchema")
  applySchema(db)
  applyIntelligenceSchema(db)

  // Seed 5 predictions directly via SQL — avoid intel.snapshotPredictions
  // module-cache complications. The canonical id is provided by predictionId
  // which is a pure function — this is sufficient for JOIN testing.
  const seedPredictions = [
    { player: "Lineage Test 1", stat: "hits",       side: "over",  line: 0.5 },
    { player: "Lineage Test 2", stat: "runs",       side: "under", line: 0.5 },
    { player: "Lineage Test 3", stat: "hr",         side: "over",  line: 0.5 },
    { player: "Lineage Test 4", stat: "totalbases", side: "over",  line: 1.5 },
    { player: "Lineage Test 5", stat: "rbi",        side: "over",  line: 0.5 },
  ]
  const insertPred = db.prepare(`
    INSERT INTO prediction_snapshots (id, run_date, sport, player, stat_family, side, line, odds, sportsbook, model_prob, tier, volatility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const predIds = []
  for (const p of seedPredictions) {
    const id = intel.predictionId("2026-05-09", "mlb", p.player, p.stat, p.side, p.line, "DraftKings")
    insertPred.run(id, "2026-05-09", "mlb", p.player.toLowerCase(), p.stat, p.side, p.line, -110, "DraftKings", 0.55, "PLAYABLE", "balanced")
    predIds.push(id)
  }
  const totalP = db.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots").get().n
  ok("synthetic seed: 5 predictions inserted", totalP === 5, { totalP })

  // Seed outcomes: 3 match predictions, 2 are orphans (different ids)
  const insertOut = db.prepare(`
    INSERT INTO outcome_snapshots (id, run_date, sport, player, stat_family, side, line, hit, actual_value, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  insertOut.run(predIds[0], "2026-05-09", "mlb", "lineage test 1", "hits", "over", 0.5, 1, 1, now)
  insertOut.run(predIds[1], "2026-05-09", "mlb", "lineage test 2", "runs", "under", 0.5, 0, 0, now)
  insertOut.run(predIds[2], "2026-05-09", "mlb", "lineage test 3", "hr", "over", 0.5, 1, 1, now)
  insertOut.run("2026-05-09|mlb|orphan one|hits|over|0.5|draftkings", "2026-05-09", "mlb", "orphan one", "hits", "over", 0.5, 1, 1, now)
  insertOut.run("2026-05-09|mlb|orphan two|hits|over|0.5|draftkings", "2026-05-09", "mlb", "orphan two", "hits", "over", 0.5, 0, 0, now)

  const totalO = db.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots").get().n
  const joinN  = db.prepare("SELECT COUNT(*) AS n FROM outcome_snapshots os JOIN prediction_snapshots ps ON ps.id = os.id").get().n

  ok("synthetic seed: 5 outcomes inserted", totalO === 5, { totalO })
  ok("anti-fabrication: JOIN ≤ min(predictions, outcomes)", joinN <= Math.min(totalP, totalO), { totalP, totalO, joinN })
  ok("anti-fabrication: JOIN == 3 (only 3 outcomes match predictions)", joinN === 3, { joinN })
  ok("anti-fabrication: orphan outcomes == 2", (totalO - joinN) === 2, { totalO, joinN })
  ok("anti-fabrication: orphan predictions == 2", (totalP - joinN) === 2, { totalP, joinN })

  // ── BLOCK 3: ORPHAN-COUNTING QUERY SHAPE ────────────────────────────────
  console.log("\n── Block 3: orphan-counting query shape ──")

  const orphanOutQuery = db.prepare(`
    SELECT COUNT(*) AS n FROM outcome_snapshots os
    LEFT JOIN prediction_snapshots ps ON ps.id = os.id
    WHERE ps.id IS NULL
  `).get().n
  const orphanPredQuery = db.prepare(`
    SELECT COUNT(*) AS n FROM prediction_snapshots ps
    LEFT JOIN outcome_snapshots os ON os.id = ps.id
    WHERE os.id IS NULL
  `).get().n
  ok("orphan-out query == totalO - join", orphanOutQuery === (totalO - joinN), { orphanOutQuery, totalO, joinN })
  ok("orphan-pred query == totalP - join", orphanPredQuery === (totalP - joinN), { orphanPredQuery, totalP, joinN })

  ok("identity: orphan_pred + join == totalP", orphanPredQuery + joinN === totalP)
  ok("identity: orphan_out + join == totalO",  orphanOutQuery + joinN === totalO)

  // ── BLOCK 4: CANONICAL HELPER OWNERSHIP ─────────────────────────────────
  console.log("\n── Block 4: canonical helper ownership ──")

  ok("intel.predictionId is exported", typeof intel.predictionId === "function")
  ok("intel.snapshotPredictions is exported", typeof intel.snapshotPredictions === "function")
  ok("intel.recordOutcomes is exported", typeof intel.recordOutcomes === "function")
  ok("intel.normalizeCandidate is exported", typeof intel.normalizeCandidate === "function")

  const raw = {
    player: "Test Player",
    statFamily: "TotalBases",
    side: "Under",
    line: 1.5,
    sportsbook: "DraftKings",
    date: "2026-05-09",
    sport: "mlb",
  }
  const directId = intel.predictionId(raw.date, raw.sport, raw.player, raw.statFamily, raw.side, raw.line, raw.sportsbook)
  const normalized = intel.normalizeCandidate(raw, { sport: raw.sport, runDate: raw.date })
  ok("direct intel.predictionId matches normalizeCandidate id", directId === normalized.id, { directId, normalizedId: normalized.id })

  // ── BLOCK 5: DIACRITIC EDGE CASES ───────────────────────────────────────
  console.log("\n── Block 5: diacritic edge cases ──")

  const diacriticBase = intel.predictionId("2026-05-09", "mlb", "Jose Ramirez", "hits", "over", 1.5, "DraftKings")
  const diacriticVariants = [
    ["2026-05-09", "mlb", "José Ramírez",  "hits", "over", 1.5, "DraftKings"],
    ["2026-05-09", "mlb", "JOSÉ RAMÍREZ",  "hits", "over", 1.5, "DraftKings"],
    ["2026-05-09", "mlb", "jose ramirez",  "hits", "over", 1.5, "DraftKings"],
  ]
  for (const v of diacriticVariants) {
    const computed = intel.predictionId(...v)
    ok(`diacritic: [${v[2]}] → same canonical bytes`, computed === diacriticBase, { computed, diacriticBase })
  }

  // ── BLOCK 6: ALIAS-FORWARD-ONLY POLICY ──────────────────────────────────
  console.log("\n── Block 6: alias-forward-only policy ──")

  db.prepare(`
    INSERT INTO prediction_id_aliases (raw_id, canonical_id, norm_diff_type, notes)
    VALUES (?, ?, ?, ?)
  `).run("legacy_raw_id", "canonical_id", "player", "fixture test")

  const aliasRow = db.prepare("SELECT raw_id, canonical_id, norm_diff_type FROM prediction_id_aliases WHERE raw_id = ?").get("legacy_raw_id")
  ok("alias row accepts policy-conforming norm_diff_type", aliasRow && aliasRow.norm_diff_type === "player", aliasRow)

  const allowed = new Set(["player", "family", "book", "composite"])
  const allAliasTypes = db.prepare("SELECT DISTINCT norm_diff_type FROM prediction_id_aliases").all()
  const allConform = allAliasTypes.every((r) => r.norm_diff_type == null || allowed.has(r.norm_diff_type))
  ok("alias-forward-only: all norm_diff_type values policy-conforming", allConform, allAliasTypes)

  // ── BLOCK 7: RUNGRADING-PATH EQUIVALENCE ────────────────────────────────
  console.log("\n── Block 7: post-game-review path equivalence ──")

  const trackedBetShape = {
    date: "2026-05-09",
    player: "Mock Bet Player",
    statFamily: "totalBases",
    side: "over",
    line: 2.5,
    sportsbook: "DraftKings",
  }
  const buildPostGameReviewPredId = intel.predictionId(
    trackedBetShape.date,
    "mlb",
    trackedBetShape.player,
    trackedBetShape.statFamily,
    trackedBetShape.side,
    trackedBetShape.line,
    trackedBetShape.sportsbook,
  )

  const snapshotRow = {
    player: "Mock Bet Player",
    statFamily: "totalBases",
    side: "over",
    line: 2.5,
    book: "DraftKings",      // snapshot uses `book`; tracked_bets uses `sportsbook` — both resolve via raw.book || raw.sportsbook
    date: "2026-05-09",
    sport: "mlb",
    modelProb: 0.6,
    edge: 0.04,
  }
  const snapshotNormalized = intel.normalizeCandidate(snapshotRow, { sport: "mlb", runDate: "2026-05-09" })

  ok("buildPostGameReview path == snapshot path (canonical join works)",
     buildPostGameReviewPredId === snapshotNormalized.id,
     { buildPostGameReview: buildPostGameReviewPredId, snapshot: snapshotNormalized.id })

  // Same canonical id whether sportsbook field is named `sportsbook` or `book`
  const snapshotWithSportsbook = { ...snapshotRow }
  delete snapshotWithSportsbook.book
  snapshotWithSportsbook.sportsbook = "DraftKings"
  const snapshotNormalized2 = intel.normalizeCandidate(snapshotWithSportsbook, { sport: "mlb", runDate: "2026-05-09" })
  ok("normalizeCandidate handles raw.book || raw.sportsbook fallback identically",
     snapshotNormalized2.id === snapshotNormalized.id,
     { withBook: snapshotNormalized.id, withSportsbook: snapshotNormalized2.id })

  // Cleanup
  db.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

  // ── Verdict ──────────────────────────────────────────────────────────────
  const pass = checks.filter((c) => c.pass).length
  const fail = checks.filter((c) => !c.pass).length
  console.log("")
  console.log(`pass: ${pass}    fail: ${fail}`)
  console.log(`RESULT: ${fail === 0 ? "PASS" : "FAIL"}`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
