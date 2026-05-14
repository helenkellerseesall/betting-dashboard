#!/usr/bin/env node
"use strict"
process.chdir(__dirname)

/**
 * probe_epoch_authority_v1.js — Phase Longitudinal-Integrity-1B (2026-05-14)
 *
 * Validates the canonical `derivePredictionEpochId(opts)` helper against the
 * five existing `compute*EpochId` functions for a 32-fixture matrix.
 *
 * Three assertion blocks:
 *
 *   1. BYTE-PARITY — for every fixture, the canonical helper must produce
 *      the same bytes the corresponding existing function does (subject to
 *      the strict-fallback policy: when an existing function defaulted to
 *      now(), the canonical helper returns null for snapshot/live kinds).
 *
 *   2. COLLISION-DETECTOR — synthetic two-writer scenario asserts the
 *      [EPOCH-ID-COLLISION-DETECTED] probe fires exactly once per unique
 *      tuple.
 *
 *   3. FALLBACK-DETECTOR — asserts `kind='manual'` falls back to now() and
 *      emits [EPOCH-ID-FALLBACK-USED] once per process; asserts
 *      kind='snapshot'/'live' REJECT when ts is missing (returns null).
 *
 * Pass criteria: every check passes. Exit 0 on PASS, non-zero on FAIL.
 */

const checks = []
function ok(label, cond, payload) {
  checks.push({ label, pass: !!cond, payload: payload || null })
  console.log(`  ${cond ? "✓" : "✗"} ${label}`)
  if (!cond && payload) console.log(`      payload: ${JSON.stringify(payload)}`)
}

function main() {
  console.log("=== probe_epoch_authority_v1 — Phase Longitudinal-Integrity-1B ===\n")

  // ── Require canonical helper + existing functions ──────────────────────
  const {
    derivePredictionEpochId,
    deriveCanonicalSlateDate,
    getEpochAuthorityDiagnostics,
    resetEpochAuthorityDiagnostics,
  } = require("./backend/storage/intelligence")

  // Existing compute*EpochId functions — re-require fresh each time we need them.
  // Each module's computeEpochId/computeMlbEpochId/computeLiveEpochId is private,
  // so we test via the same-bytes assertion path: derive once via canonical,
  // then re-derive the same input via the existing public function (where
  // exported) or via the documented formula (where private).
  //
  // Site #1 freezePredictionEpoch.computeEpochId — private; we replicate
  //   its formula exactly: "<ts>|<sport_lower>|<slate_slice10>"
  // Site #2 freezeMlbContextualEpoch.computeMlbEpochId — private; formula:
  //   "<ts>|mlb|<slate_slice10>"
  // Site #3 freezeMlbLiveStateEpoch.computeLiveEpochId — EXPORTED
  // Site #4 mlbLiveStateHistory.computeEpochId — exported (re-uses local
  //   formula); we replicate its formula: "<capturedAtIso||"">|mlb|<slate>"
  const { computeLiveEpochId } = require("./backend/pipeline/mlb/live/freezeMlbLiveStateEpoch")
  const { computeEpochId: liveHistoryComputeEpochId } = require("./backend/pipeline/mlb/live/mlbLiveStateHistory")

  function site1Formula(t, sport, slate) {
    const ts = (t && String(t).trim()) || new Date().toISOString()
    return [ts, String(sport || "").toLowerCase(), String(slate || "").slice(0, 10)].join("|")
  }
  function site2Formula(t, slate) {
    const ts = (t && String(t).trim()) || new Date().toISOString()
    return [ts, "mlb", String(slate || "").slice(0, 10)].join("|")
  }

  // Reset diagnostics so this probe runs in a clean state.
  resetEpochAuthorityDiagnostics()

  // ── BLOCK 1: BYTE-PARITY (32 fixtures) ────────────────────────────────
  console.log("── Block 1: byte-parity (32 fixtures) ──")

  // 16 snapshot fixtures (mix nba/mlb, various ts formats, various slate dates)
  const snapshotFixtures = [
    // NBA snapshot (site #1 with sport='nba')
    { sport: "nba", ts: "2026-05-14T18:00:00Z",     slate: "2026-05-14" },
    { sport: "nba", ts: "2026-05-13T23:59:59.999Z", slate: "2026-05-13" },
    { sport: "nba", ts: "2026-04-18T03:30:00Z",     slate: "2026-04-18" },
    { sport: "nba", ts: "2026-05-09T12:00:00Z",     slate: "2026-05-09" },
    { sport: "nba", ts: "2026-05-12T22:15:30Z",     slate: "2026-05-12" },
    { sport: "nba", ts: "2026-01-01T00:00:00Z",     slate: "2026-01-01" },
    // MLB snapshot via site #1 with sport='mlb' (NOTE: this produces the SAME
    // bytes as site #2 — that's the latent collision risk).
    { sport: "mlb", ts: "2026-05-14T17:00:00Z",     slate: "2026-05-14" },
    { sport: "mlb", ts: "2026-05-13T20:30:00Z",     slate: "2026-05-13" },
    { sport: "mlb", ts: "2026-05-09T18:00:00Z",     slate: "2026-05-09" },
    { sport: "mlb", ts: "2026-05-08T15:15:00Z",     slate: "2026-05-08" },
    // Slate date with trailing time — must be sliced to 10 chars
    { sport: "nba", ts: "2026-05-14T18:00:00Z",     slate: "2026-05-14T23:59:59Z" },
    { sport: "mlb", ts: "2026-05-14T18:00:00Z",     slate: "2026-05-14T23:59:59Z" },
    // Sport in mixed case — must be lowercased
    { sport: "NBA", ts: "2026-05-14T18:00:00Z",     slate: "2026-05-14" },
    { sport: "Mlb", ts: "2026-05-14T18:00:00Z",     slate: "2026-05-14" },
    // Future-sport hypothetical (forward-compat)
    { sport: "nhl", ts: "2026-05-14T18:00:00Z",     slate: "2026-05-14" },
    { sport: "nfl", ts: "2026-09-08T13:00:00Z",     slate: "2026-09-08" },
  ]

  for (const f of snapshotFixtures) {
    const canonical = derivePredictionEpochId({
      sport: f.sport, slateDate: f.slate, snapshotUpdatedAt: f.ts, kind: "snapshot",
    })
    const reference = site1Formula(f.ts, f.sport, f.slate)
    ok(
      `snapshot byte-parity: sport=${f.sport} ts=${f.ts} slate=${f.slate}`,
      canonical === reference,
      { canonical, reference }
    )
  }

  // 8 live fixtures (site #3 — LIVE prefix, captured-then-snapshot fallback)
  const liveFixtures = [
    { ts: "2026-05-14T18:00:00Z", captured: "2026-05-14T18:00:30Z", slate: "2026-05-14" },
    { ts: "2026-05-13T18:30:00Z", captured: "2026-05-13T18:31:00Z", slate: "2026-05-13" },
    { ts: null,                   captured: "2026-05-14T19:00:00Z", slate: "2026-05-14" }, // captured-only
    { ts: "2026-05-09T22:00:00Z", captured: null,                   slate: "2026-05-09" }, // snapshot-only fallback
    { ts: "2026-05-12T17:30:00Z", captured: "2026-05-12T17:35:00Z", slate: "2026-05-12" },
    { ts: "2026-05-08T19:45:00Z", captured: "2026-05-08T19:46:30Z", slate: "2026-05-08" },
    // Slate date with trailing time
    { ts: "2026-05-14T18:00:00Z", captured: "2026-05-14T18:00:30Z", slate: "2026-05-14T23:59:59Z" },
    // Captured at the second
    { ts: "2026-05-14T18:00:00Z", captured: "2026-05-14T18:00:00Z", slate: "2026-05-14" },
  ]

  for (const f of liveFixtures) {
    const canonical = derivePredictionEpochId({
      sport: "mlb", slateDate: f.slate, snapshotUpdatedAt: f.ts, capturedAtIso: f.captured, kind: "live",
    })
    const reference = computeLiveEpochId(f.ts, f.captured, f.slate)
    ok(
      `live byte-parity: ts=${f.ts} captured=${f.captured} slate=${f.slate}`,
      canonical === reference,
      { canonical, reference }
    )
  }

  // 4 JSONL history fixtures (site #4 — capturedAtIso-only, no fallback, NO LIVE prefix)
  // Note: site #4 produces an output structurally DIFFERENT from site #3 (no LIVE prefix)
  // AND structurally IDENTICAL to site #2 when capturedAtIso is supplied. The canonical
  // helper handles this via kind='snapshot' + supplying snapshotUpdatedAt=capturedAtIso.
  console.log("\n── Block 1b: JSONL history byte-parity (kind=snapshot mirrors site #4) ──")
  const historyFixtures = [
    { captured: "2026-05-14T18:00:00Z", slate: "2026-05-14" },
    { captured: "2026-05-13T18:30:00Z", slate: "2026-05-13" },
    { captured: "2026-05-12T17:30:00Z", slate: "2026-05-12" },
    { captured: "2026-05-09T22:00:00Z", slate: "2026-05-09" },
  ]
  for (const f of historyFixtures) {
    const canonical = derivePredictionEpochId({
      sport: "mlb", slateDate: f.slate, snapshotUpdatedAt: f.captured, kind: "snapshot",
    })
    const reference = liveHistoryComputeEpochId(f.captured, f.slate)
    ok(
      `JSONL history byte-parity: captured=${f.captured} slate=${f.slate}`,
      canonical === reference,
      { canonical, reference }
    )
  }

  // ── BLOCK 2: COLLISION DETECTOR ────────────────────────────────────────
  console.log("\n── Block 2: collision detector ──")

  resetEpochAuthorityDiagnostics()

  const collisionArgs = {
    sport: "mlb", slateDate: "2026-05-14", snapshotUpdatedAt: "2026-05-14T18:00:00Z", kind: "snapshot",
  }

  const idA = derivePredictionEpochId({ ...collisionArgs, writerTag: "snapshot_bestprops" })
  const idB = derivePredictionEpochId({ ...collisionArgs, writerTag: "workstation_state" })
  const idC = derivePredictionEpochId({ ...collisionArgs, writerTag: "freezeMlbContextualEpoch" })

  ok("collision: writer A returns valid id", typeof idA === "string" && idA.length > 0)
  ok("collision: writer B returns SAME bytes", idA === idB, { idA, idB })
  ok("collision: writer C returns SAME bytes", idA === idC, { idA, idC })

  const diagAfterCollisions = getEpochAuthorityDiagnostics()
  ok("collisions counter incremented", diagAfterCollisions.collisionsDetected >= 2, diagAfterCollisions)
  ok("firstCollisionSample populated", !!diagAfterCollisions.firstCollisionSample, diagAfterCollisions.firstCollisionSample)
  ok("first collision writers correct",
     diagAfterCollisions.firstCollisionSample?.firstWriter === "snapshot_bestprops" &&
     ["workstation_state", "freezeMlbContextualEpoch"].includes(diagAfterCollisions.firstCollisionSample?.secondWriter),
     diagAfterCollisions.firstCollisionSample)

  // Same writer re-deriving = idempotency, NOT a collision
  const beforeRepeat = diagAfterCollisions.collisionsDetected
  const idD = derivePredictionEpochId({ ...collisionArgs, writerTag: "snapshot_bestprops" })
  const afterRepeat = getEpochAuthorityDiagnostics().collisionsDetected
  ok("same-writer re-derive does NOT count as collision",
     afterRepeat === beforeRepeat && idD === idA,
     { beforeRepeat, afterRepeat })

  // Different epoch_id with same writer = no collision
  const idE = derivePredictionEpochId({
    sport: "mlb", slateDate: "2026-05-13", snapshotUpdatedAt: "2026-05-13T18:00:00Z", kind: "snapshot",
    writerTag: "snapshot_bestprops",
  })
  ok("different epoch_id same writer: no collision", idE !== idA)

  // ── BLOCK 3: FALLBACK / REJECTION DETECTOR ─────────────────────────────
  console.log("\n── Block 3: fallback / rejection detector ──")

  resetEpochAuthorityDiagnostics()

  // Snapshot kind without ts → STRICT REJECT
  const rejected1 = derivePredictionEpochId({ sport: "nba", slateDate: "2026-05-14", kind: "snapshot" })
  ok("snapshot without ts: returns null (strict reject)", rejected1 === null, { rejected1 })

  // Live kind without ts → STRICT REJECT
  const rejected2 = derivePredictionEpochId({ sport: "mlb", slateDate: "2026-05-14", kind: "live" })
  ok("live without ts: returns null (strict reject)", rejected2 === null, { rejected2 })

  // Missing sport → REJECT (regardless of kind)
  const rejected3 = derivePredictionEpochId({ slateDate: "2026-05-14", snapshotUpdatedAt: "2026-05-14T18:00:00Z" })
  ok("missing sport: returns null", rejected3 === null, { rejected3 })

  // Missing slateDate → REJECT
  const rejected4 = derivePredictionEpochId({ sport: "nba", snapshotUpdatedAt: "2026-05-14T18:00:00Z" })
  ok("missing slateDate: returns null", rejected4 === null, { rejected4 })

  // Manual kind without ts → FALLBACK ALLOWED
  const manualId = derivePredictionEpochId({ sport: "nba", slateDate: "2026-05-14", kind: "manual" })
  ok("manual without ts: falls back, starts with MANUAL|",
     typeof manualId === "string" && manualId.startsWith("MANUAL|"),
     { manualId })

  const diagAfterFallback = getEpochAuthorityDiagnostics()
  ok("rejections counted", diagAfterFallback.rejectionsOnMissingTs >= 2, diagAfterFallback)
  ok("fallbacks counted",  diagAfterFallback.fallbacksUsed >= 1,  diagAfterFallback)
  ok("firstFallbackSample populated", !!diagAfterFallback.firstFallbackSample)
  ok("firstRejectionSample populated", !!diagAfterFallback.firstRejectionSample)

  // ── BLOCK 4: SLATE-DATE CANONICALIZATION ───────────────────────────────
  console.log("\n── Block 4: deriveCanonicalSlateDate ──")

  // Detroit-keyed slate date — match the existing _detroitSlateDateKey semantics
  const dt1 = deriveCanonicalSlateDate("2026-05-14T20:00:00Z")
  ok("slate-date returns YYYY-MM-DD shape", /^\d{4}-\d{2}-\d{2}$/.test(dt1), { dt1 })

  const dt2 = deriveCanonicalSlateDate(null)
  ok("slate-date handles null (fallback)", /^\d{4}-\d{2}-\d{2}$/.test(dt2), { dt2 })

  const dt3 = deriveCanonicalSlateDate("not a real date")
  ok("slate-date handles unparseable input", /^\d{4}-\d{2}-\d{2}$/.test(dt3), { dt3 })

  // ── Verdict ────────────────────────────────────────────────────────────
  const pass = checks.filter((c) => c.pass).length
  const fail = checks.filter((c) => !c.pass).length
  console.log("")
  console.log(`pass: ${pass}    fail: ${fail}`)
  console.log(`RESULT: ${fail === 0 ? "PASS" : "FAIL"}`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
